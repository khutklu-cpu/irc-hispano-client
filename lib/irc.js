'use strict';
/**
 * Cliente IRC via proxy SockJS/KiwiIRC de ChatHispano
 * Fixes: CONTROL START URL correcta, race condition en _tryConnect,
 *        reconexion no se solapa con connect()
 */

const EventEmitter = require('events');
const { WebSocket } = require('ws');
const crypto = require('crypto');

const KIWI_HOST   = 'kiwi.chathispano.com';
const KIWI_PORTS  = [9000, 9001, 9002, 9004];
const KIWI_PATH   = '/webirc/kiwiirc/';
const KIWI_SERVER = `https://${KIWI_HOST}:9000${KIWI_PATH}`;

function _kiwiUrl(port) {
  const srv     = String(Math.floor(Math.random() * 900) + 100);
  const session = crypto.randomBytes(8).toString('hex');
  return `wss://${KIWI_HOST}:${port}${KIWI_PATH}${srv}/${session}/websocket`;
}

class IRCClient extends EventEmitter {
  constructor({ nick, proxy } = {}) {
    super();
    this.nick            = nick || _guestNick();
    this.proxy           = proxy || null;
    this.ws              = null;
    this.buffer          = '';
    this.channels        = new Map();
    this.connected       = false;
    this._pingTimer      = null;
    this._reconnectTimer = null;
    this._destroyed      = false;
    this._portIdx        = 0;
    this._connecting     = false;
    this.desiredChannels = new Set();
  }

  async connect() {
    this._destroyed  = false;
    this._connecting = true;
    this._portIdx    = 0;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;

    for (let i = 0; i < KIWI_PORTS.length; i++) {
      if (this._destroyed) break;
      try {
        await this._tryConnect(KIWI_PORTS[i]);
        this._portIdx    = i;
        this._connecting = false;
        return;
      } catch (e) {
        this.emit('status', `Fallando endpoint ${i + 1}/${KIWI_PORTS.length}: ${e.message}`);
      }
    }
    this._connecting = false;
    if (!this._destroyed) {
      throw new Error('No se pudo conectar al proxy de ChatHispano por ningun endpoint');
    }
  }

  async _tryConnect(port) {
    return new Promise((resolve, reject) => {
      const url = _kiwiUrl(port);
      this.emit('status', `Conectando a proxy ChatHispano (puerto ${port})...`);

      let settled = false;
      const doResolve = () => { if (!settled) { settled = true; clearTimeout(timeout); resolve(); } };
      const doReject  = (e) => { if (!settled) { settled = true; clearTimeout(timeout); reject(e); } };

      const timeout = setTimeout(() => {
        doReject(new Error(`timeout en puerto ${port}`));
        try { ws.terminate(); } catch (_) {}
      }, 12000);

      const ws = new WebSocket(url, {
        headers: {
          'Origin':     'https://chathispano.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        },
        rejectUnauthorized: false
      });
      this.ws = ws;

      ws.once('error', (e) => doReject(e));

      ws.once('open', () => {
        ws.removeAllListeners('error');
        ws.on('error', (e) => { if (!this._destroyed) this.emit('error', e.message); });

        ws.on('message', (data) => {
          const frame = typeof data === 'string' ? data : data.toString('utf8');
          this._onSockJSFrame(frame, doResolve);
        });

        ws.on('close', (code) => {
          if (this.connected) {
            this._handleRuntimeClose();
          } else if (settled) {
            this.emit('disconnected');
          } else {
            doReject(new Error(`WebSocket cerrado (${code}) antes de SockJS open`));
          }
        });
      });
    });
  }

  _onSockJSFrame(frame, doResolve) {
    if (frame === 'o') {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify([`:${KIWI_SERVER} CONTROL START`]));
      }
      setTimeout(() => this._register(), 150);
      doResolve();
      return;
    }
    if (frame === 'h') return;

    if (frame.startsWith('c')) {
      try {
        const [code, reason] = JSON.parse(frame.slice(1));
        this.emit('error', `SockJS cerrado: ${reason} (${code})`);
      } catch (_) {}
      return;
    }

    if (frame.startsWith('a')) {
      let msgs;
      try { msgs = JSON.parse(frame.slice(1)); } catch (_) { return; }
      for (const msg of msgs) {
        const lines = (this.buffer + msg).split('\r\n');
        this.buffer = lines.pop();
        for (const l of lines) { if (l) this._parseLine(l); }
      }
    }
  }

  _register() {
    this.raw('CAP LS 302');
    this.raw(`NICK ${this.nick}`);
    this.raw('USER kiwi 0 * :Usuario Kiwi de Chat Hispano - https://chathispano.com/');
  }

  raw(line) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const sanitized = String(line).replace(/[\r\n\x00]/g, '').slice(0, 510);
      this.ws.send(JSON.stringify([sanitized + '\r\n']));
      this.emit('raw_out', sanitized);
    }
  }

  _handleRuntimeClose() {
    this.connected = false;
    clearInterval(this._pingTimer);
    this.emit('disconnected');
    if (!this._destroyed && !this._connecting) {
      this._portIdx = (this._portIdx + 1) % KIWI_PORTS.length;
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => {
        if (this._destroyed || this._connecting) return;
        this.emit('status', `Reconectando (endpoint ${this._portIdx + 1})...`);
        this._tryConnect(KIWI_PORTS[this._portIdx]).catch(e => {
          this.emit('error', e.message);
          if (!this._destroyed && !this._connecting) {
            this._reconnectTimer = setTimeout(() => {
              this.connect().catch(e2 => this.emit('error', e2.message));
            }, 10000);
          }
        });
      }, 5000);
    }
  }

  _parseLine(line) {
    this.emit('raw_in', line);

    if (line.startsWith('PING')) { this.raw('PONG ' + line.slice(5)); return; }
    if (/^(?::[^ ]+ )?CAP [^ ]+ LS/.test(line)) { this.raw('CAP END'); return; }

    const m = line.match(/^(?::([^ ]+) )?([A-Z0-9]+)(?: (.+))?$/);
    if (!m) return;

    const prefix  = m[1] || '';
    const command = m[2];
    const rest    = m[3] || '';

    let params = [], trailing = null;
    const trailIdx = rest.indexOf(' :');
    if (trailIdx >= 0) {
      params   = rest.slice(0, trailIdx).split(' ').filter(Boolean);
      trailing = rest.slice(trailIdx + 2);
    } else if (rest.startsWith(':')) {
      trailing = rest.slice(1);
    } else {
      params = rest.split(' ').filter(Boolean);
    }

    const nick = prefix.split('!')[0];
    const host = prefix.includes('@') ? prefix.split('@')[1] : '';

    switch (command) {
      case '001':
        this.connected = true;
        this.nick = params[0] || this.nick;
        this._startPing();
        this.emit('connected', this.nick);
        this._rejoinDesiredChannels();
        break;
      case '002': case '003': case '004': case '005':
        this.emit('server_info', trailing || rest); break;
      case '372': case '375': case '376':
        this.emit('motd', trailing || ''); break;

      case 'ERROR': {
        const msg = trailing || rest;
        if (/[GKZ]-line/i.test(msg)) {
          this.emit('banned', msg);
          if (!this._destroyed) {
            clearTimeout(this._reconnectTimer);
            this._portIdx = (this._portIdx + 1) % KIWI_PORTS.length;
            this._reconnectTimer = setTimeout(() => {
              this.emit('status', 'Rotando endpoint por ban...');
              this.connect().catch(e => this.emit('error', e.message));
            }, 5000);
          }
        } else { this.emit('error', msg); }
        break;
      }

      case '433': this.nick += '_'; this.raw('NICK ' + this.nick); break;
      case '432': case '436': this.nick = _guestNick(); this.raw('NICK ' + this.nick); break;

      case 'JOIN': {
        const chan = trailing || params[0];
        if (!this.channels.has(chan)) this.channels.set(chan, new Set());
        this.channels.get(chan).add(nick);
        this.emit('join', { nick, host, channel: chan, self: nick === this.nick });
        break;
      }
      case 'PART': {
        const chan = params[0], msg = trailing || '';
        if (this.channels.has(chan)) {
          this.channels.get(chan).delete(nick);
          if (nick === this.nick) this.channels.delete(chan);
        }
        if (nick === this.nick) this.desiredChannels.delete(chan);
        this.emit('part', { nick, host, channel: chan, message: msg, self: nick === this.nick });
        break;
      }
      case 'QUIT':
        for (const [chan, nicks] of this.channels) {
          if (nicks.has(nick)) { nicks.delete(nick); this.emit('quit', { nick, host, channel: chan, message: trailing || '' }); }
        }
        break;
      case 'KICK': {
        const chan = params[0], kicked = params[1];
        this.channels.get(chan)?.delete(kicked);
        if (kicked === this.nick) this.desiredChannels.delete(chan);
        this.emit('kick', { nick, channel: chan, kicked, message: trailing || '' });
        break;
      }
      case 'NICK': {
        const newNick = trailing || params[0];
        for (const [, nicks] of this.channels) {
          if (nicks.has(nick)) { nicks.delete(nick); nicks.add(newNick); }
        }
        if (nick === this.nick) this.nick = newNick;
        this.emit('nick_change', { old: nick, new: newNick });
        break;
      }
      case 'PRIVMSG': case 'NOTICE': {
        const target = params[0], text = trailing || '';
        const isPriv = target === this.nick;
        const chan   = isPriv ? nick : target;
        if (text.startsWith('\x01') && text.endsWith('\x01')) {
          this._handleCTCP(nick, host, chan, text.slice(1, -1), isPriv);
          break;
        }
        this.emit('message', { from: nick, host, target: chan, text, private: isPriv, notice: command === 'NOTICE' });
        break;
      }
      case 'TOPIC':
        this.emit('topic', { nick, channel: params[0], topic: trailing || '' }); break;
      case '332':
        this.emit('topic', { nick: '', channel: params[1], topic: trailing || '' }); break;
      case '353': {
        const chan = params[2], names = (trailing || '').split(' ').filter(Boolean);
        if (!this.channels.has(chan)) this.channels.set(chan, new Set());
        const set = this.channels.get(chan);
        const prefixed = [];
        for (const n of names) {
          const clean = n.replace(/^[@+%&~!]/, '');
          set.add(clean);
          prefixed.push(n);
        }
        this.emit('names', { channel: chan, nicks: prefixed });
        break;
      }
      case '366':
        if (this.channels.has(params[1]))
          this.emit('names_end', { channel: params[1], nicks: [...this.channels.get(params[1])] });
        break;
      case 'MODE':
        this.emit('mode', { nick, target: params[0], mode: params[1] || trailing || '' }); break;
      case '311':
        this.emit('whois', { nick: params[1], user: params[2], host: params[3], realname: trailing }); break;
      case '401': case '403': case '404': case '421':
      case '461': case '471': case '473': case '474': case '475':
        this.emit('server_error', { code: command, message: trailing || rest }); break;
      default:
        this.emit('unknown', { command, prefix, params, trailing });
    }
  }

  _handleCTCP(nick, host, chan, ctcp, isPriv) {
    const [type, ...rest] = ctcp.split(' ');
    switch (type) {
      case 'ACTION':
        this.emit('action', { from: nick, target: chan, text: rest.join(' '), private: isPriv }); break;
      case 'VERSION':
        this.raw(`NOTICE ${nick} :\x01VERSION ChatHispano WebClient 1.0\x01`); break;
      case 'PING': {
        const pingData = rest.join(' ').replace(/[\r\n\x00\x01]/g, '').slice(0, 32);
        this.raw(`NOTICE ${nick} :\x01PING ${pingData}\x01`);
        break;
      }
      default:
        this.emit('ctcp', { from: nick, type, args: rest, private: isPriv });
    }
  }

  _startPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      if (this.connected) this.raw('PING :irc.chathispano.com');
    }, 90000);
  }

  join(channel)               { this.raw(`JOIN ${channel}`); }
  part(channel, msg = '')     { this.raw(`PART ${channel}${msg ? ' :' + msg : ''}`); }
  privmsg(target, text)       { this.raw(`PRIVMSG ${target} :${text}`); }
  notice(target, text)        { this.raw(`NOTICE ${target} :${text}`); }
  action(target, text)        { this.raw(`PRIVMSG ${target} :\x01ACTION ${text}\x01`); }
  topic(channel, t)           { this.raw(t ? `TOPIC ${channel} :${t}` : `TOPIC ${channel}`); }
  _rejoinDesiredChannels() {
    const chans = [...this.desiredChannels];
    chans.forEach((chan, idx) => {
      setTimeout(() => {
        if (this.connected) this.raw(`JOIN ${chan}`);
      }, idx * 500);
    });
  }

  join(channel)               { this.desiredChannels.add(channel); this.raw(`JOIN ${channel}`); }
  part(channel, msg = '')     { this.desiredChannels.delete(channel); this.raw(`PART ${channel}${msg ? ' :' + msg : ''}`); }
  privmsg(target, text)       { this.raw(`PRIVMSG ${target} :${text}`); }
  notice(target, text)        { this.raw(`NOTICE ${target} :${text}`); }
  action(target, text)        { this.raw(`PRIVMSG ${target} :\x01ACTION ${text}\x01`); }
  topic(channel, t)           { this.raw(t ? `TOPIC ${channel} :${t}` : `TOPIC ${channel}`); }
  kick(channel, nick, r = '') { this.raw(`KICK ${channel} ${nick}${r ? ' :' + r : ''}`); }
  mode(target, mode)          { this.raw(`MODE ${target} ${mode}`); }
  whois(nick)                 { this.raw(`WHOIS ${nick}`); }
  who(channel)                { this.raw(`WHO ${channel}`); }
  list(channel = '')          { this.raw(channel ? `LIST ${channel}` : 'LIST'); }
  changeNick(nick)            { this.raw(`NICK ${nick}`); this.nick = nick; }

  quit(msg = 'Bye') {
    this._destroyed = true;
    this._connecting = false;
    clearInterval(this._pingTimer);
    clearTimeout(this._reconnectTimer);
    this.raw(`QUIT :${msg}`);
    setTimeout(() => { try { this.ws && this.ws.terminate(); } catch (_) {} }, 500);
  }

  destroy() {
    this._destroyed = true;
    this._connecting = false;
    clearInterval(this._pingTimer);
    clearTimeout(this._reconnectTimer);
    try { this.ws && this.ws.terminate(); } catch (_) {}
  }
}

const ANIMALS    = ['Leon','Tigre','Caracol','Perro','Mosquito','Pez','Pajaro','Lince','Elefante',
  'Rinoceronte','Avestruz','Grillo','Tiburon','Mapache','Murcielago','Topo','Bufalo','Buho',
  'Cocodrilo','Caiman','Flamenco','Oso','Lobo','Pinguino','Raton','Delfin','Pantera','Rana',
  'Ardilla','Aguila','Hormiga'];
const SEPARATORS = ['-', '_', '{', '}', ''];
const ADJECTIVES = ['Verde','Azul','Naranja','Fugaz','Veloz','Feroz','Paciente','Elocuente',
  'Tenaz','Fuerte','Humilde','Agil','Torpe','Eficiente','Suave','Feliz','Brillante','Sensible'];

function _guestNick() {
  const a = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const s = SEPARATORS[Math.floor(Math.random() * SEPARATORS.length)];
  const j = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  return `${a}${s}${j}`;
}

module.exports = { IRCClient, KIWI_PORTS, KIWI_HOST };
