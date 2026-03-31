'use strict';
/**
 * Cliente IRC — conecta via proxy WebIRC de ChatHispano (KiwiIRC)
 * El proxy kiwi.chathispano.com tiene IP whitelisted en la red IRC,
 * evitando G-lines sobre IPs de hosting cloud.
 *
 * Protocolo: IRC puro sobre WebSocket (un mensaje WS = una linea IRC)
 * Igual que hace el cliente KiwiIRC de chathispano.com
 */

const EventEmitter = require('events');
const { WebSocket } = require('ws');

// Endpoints del proxy KiwiIRC de ChatHispano (en orden de preferencia)
const KIWI_ENDPOINTS = [
  'wss://kiwi.chathispano.com:9000/webirc/kiwiirc/',
  'wss://kiwi.chathispano.com:9001/webirc/kiwiirc/',
  'wss://kiwi.chathispano.com:9002/webirc/kiwiirc/',
  'wss://kiwi.chathispano.com:9004/webirc/kiwiirc/',
];

class IRCClient extends EventEmitter {
  constructor({ nick, proxy } = {}) {
    super();
    this.nick     = nick || _guestNick();
    this.proxy    = proxy || null;
    this.ws       = null;
    this.buffer   = '';
    this.channels = new Map();
    this.connected = false;
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._destroyed = false;
    this._endpointIdx = 0;
  }

  async connect() {
    this._destroyed = false;
    this._endpointIdx = 0;
    for (let i = 0; i < KIWI_ENDPOINTS.length; i++) {
      try {
        await this._tryKiwiConnect(KIWI_ENDPOINTS[i]);
        this._endpointIdx = i;
        return;
      } catch (e) {
        this.emit('status', `Fallando endpoint ${i + 1}/${KIWI_ENDPOINTS.length}: ${e.message}`);
      }
    }
    throw new Error('No se pudo conectar al proxy de ChatHispano por ningun endpoint');
  }

  async _tryKiwiConnect(endpoint) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('timeout'));
        try { this.ws && this.ws.terminate(); } catch (_) {}
      }, 12000);

      const ws = new WebSocket(endpoint, {
        headers: {
          'Origin':     'https://chathispano.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        },
        rejectUnauthorized: false
      });
      this.ws = ws;

      ws.once('open', () => {
        clearTimeout(timeout);
        ws.removeListener('error', onErr);
        ws.on('message', (data) => {
          const text = typeof data === 'string' ? data : data.toString('utf8');
          const lines = (this.buffer + text).split('\r\n');
          this.buffer = lines.pop();
          for (const l of lines) { if (l) this._parseLine(l); }
        });
        ws.on('close', () => this._onClose());
        ws.on('error', (e) => this.emit('error', e.message));
        this._register();
        resolve();
      });

      const onErr = (e) => { clearTimeout(timeout); reject(e); };
      ws.once('error', onErr);
    });
  }

  _register() {
    this.raw('CAP LS 302');
    this.raw(`NICK ${this.nick}`);
    this.raw('USER kiwi 0 * :Usuario Kiwi de Chat Hispano - https://chathispano.com/');
  }

  _onClose() {
    this.connected = false;
    clearInterval(this._pingTimer);
    this.emit('disconnected');
    if (!this._destroyed) {
      this._endpointIdx = (this._endpointIdx + 1) % KIWI_ENDPOINTS.length;
      this._reconnectTimer = setTimeout(() => {
        const ep = KIWI_ENDPOINTS[this._endpointIdx];
        this.emit('status', `Reconectando (endpoint ${this._endpointIdx + 1})...`);
        this._tryKiwiConnect(ep).catch(e => {
          this.emit('error', e.message);
          if (!this._destroyed) {
            this._reconnectTimer = setTimeout(() => {
              this.connect().catch(e2 => this.emit('error', e2.message));
            }, 10000);
          }
        });
      }, 8000);
    }
  }

  _parseLine(line) {
    this.emit('raw_in', line);

    if (line.startsWith('PING')) {
      this.raw('PONG ' + line.slice(5));
      return;
    }

    if (/^(?::[^ ]+ )?CAP [^ ]+ LS/.test(line)) {
      this.raw('CAP END');
      return;
    }

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
        this.nick = params[0];
        this._startPing();
        this.emit('connected', this.nick);
        break;

      case '002': case '003': case '004': case '005':
        this.emit('server_info', trailing || rest);
        break;

      case '372': case '375': case '376':
        this.emit('motd', trailing || '');
        break;

      case 'ERROR': {
        const msg = trailing || rest;
        if (/[GKZ]-line/i.test(msg)) {
          this.emit('banned', msg);
          if (!this._destroyed) {
            this._endpointIdx = (this._endpointIdx + 1) % KIWI_ENDPOINTS.length;
            this._reconnectTimer = setTimeout(() => {
              this.emit('status', 'Rotando endpoint por ban...');
              this.connect().catch(e => this.emit('error', e.message));
            }, 5000);
          }
        } else {
          this.emit('error', msg);
        }
        break;
      }

      case '433':
        this.nick += '_';
        this.raw('NICK ' + this.nick);
        break;

      case '432': case '436':
        this.nick = _guestNick();
        this.raw('NICK ' + this.nick);
        break;

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
        this.emit('part', { nick, host, channel: chan, message: msg, self: nick === this.nick });
        break;
      }

      case 'QUIT':
        for (const [chan, nicks] of this.channels) {
          if (nicks.has(nick)) {
            nicks.delete(nick);
            this.emit('quit', { nick, host, channel: chan, message: trailing || '' });
          }
        }
        break;

      case 'KICK': {
        const chan = params[0], kicked = params[1];
        this.channels.get(chan)?.delete(kicked);
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
        this.emit('topic', { nick, channel: params[0], topic: trailing || '' });
        break;
      case '332':
        this.emit('topic', { nick: '', channel: params[1], topic: trailing || '' });
        break;

      case '353': {
        const chan = params[2], names = (trailing || '').split(' ').filter(Boolean);
        if (!this.channels.has(chan)) this.channels.set(chan, new Set());
        const set = this.channels.get(chan);
        for (const n of names) set.add(n.replace(/^[@+%&~!]/, ''));
        this.emit('names', { channel: chan, nicks: [...set] });
        break;
      }
      case '366':
        if (this.channels.has(params[1]))
          this.emit('names_end', { channel: params[1], nicks: [...this.channels.get(params[1])] });
        break;

      case 'MODE':
        this.emit('mode', { nick, target: params[0], mode: params[1] || trailing || '' });
        break;

      case '311':
        this.emit('whois', { nick: params[1], user: params[2], host: params[3], realname: trailing });
        break;

      case '401': case '403': case '404': case '421':
      case '461': case '471': case '473': case '474': case '475':
        this.emit('server_error', { code: command, message: trailing || rest });
        break;

      default:
        this.emit('unknown', { command, prefix, params, trailing });
    }
  }

  _handleCTCP(nick, host, chan, ctcp, isPriv) {
    const [type, ...rest] = ctcp.split(' ');
    switch (type) {
      case 'ACTION':
        this.emit('action', { from: nick, target: chan, text: rest.join(' '), private: isPriv });
        break;
      case 'VERSION':
        this.raw(`NOTICE ${nick} :\x01VERSION ChatHispano WebClient 1.0\x01`);
        break;
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

  raw(line) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const sanitized = String(line).replace(/[\r\n\x00]/g, '').slice(0, 510);
      this.ws.send(sanitized + '\r\n');
      this.emit('raw_out', sanitized);
    }
  }

  join(channel)               { this.raw(`JOIN ${channel}`); }
  part(channel, msg = '')     { this.raw(`PART ${channel}${msg ? ' :' + msg : ''}`); }
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
    clearInterval(this._pingTimer);
    clearTimeout(this._reconnectTimer);
    this.raw(`QUIT :${msg}`);
    setTimeout(() => { try { this.ws && this.ws.terminate(); } catch (_) {} }, 500);
  }

  destroy() {
    this._destroyed = true;
    clearInterval(this._pingTimer);
    clearTimeout(this._reconnectTimer);
    try { this.ws && this.ws.terminate(); } catch (_) {}
  }
}

const ANIMALS    = ['Leon','Tigre','Caracol','Perro','Pez','Pajaro','Lince','Elefante','Tiburon',
  'Mapache','Murcielago','Topo','Bufalo','Buho','Cocodrilo','Flamenco','Oso','Lobo',
  'Pinguino','Raton','Delfin','Pantera','Rana','Ardilla','Aguila','Hormiga'];
const SEPARATORS = ['-', '_', '{', '}', ''];
const ADJECTIVES = ['Verde','Azul','Naranja','Fugaz','Veloz','Feroz','Paciente','Elocuente',
  'Tenaz','Fuerte','Humilde','Agil','Torpe','Eficiente','Suave','Feliz','Brillante','Sensible'];

function _guestNick() {
  const a = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const s = SEPARATORS[Math.floor(Math.random() * SEPARATORS.length)];
  const j = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  return `${a}${s}${j}`;
}

module.exports = { IRCClient, KIWI_ENDPOINTS };
