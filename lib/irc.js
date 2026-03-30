'use strict';
/**
 * Cliente IRC completo — RFC 1459
 * Soporta: TCP plano, TLS, SOCKS5
 */

const net       = require('net');
const tls       = require('tls');
const EventEmitter = require('events');

let SocksClient;
try { ({ SocksClient } = require('socks')); } catch (_) {}

const IRC_HOST = 'irc.irc-hispano.org';
const PORTS    = { plain: [6667, 6668, 6669, 7000], ssl: [6697, 7070] };

class IRCClient extends EventEmitter {
  constructor({ nick, proxy } = {}) {
    super();
    this.nick     = nick || _guestNick();
    this.proxy    = proxy || null;   // { host, port, type:5, username?, password? }
    this.socket   = null;
    this.buffer   = '';
    this.channels = new Map();       // name → Set<nick>
    this.connected = false;
    this.useSSL   = true;
    this._pingTimer = null;
    this._reconnectTimer = null;
    this._destroyed = false;
  }

  /* ─────────────────────── conexión ─────────────────────── */

  async connect() {
    this._destroyed = false;
    // Intentar SSL primero, luego plano
    for (const ssl of [true, false]) {
      const ports = ssl ? PORTS.ssl : PORTS.plain;
      for (const port of ports) {
        try {
          await this._tryConnect(IRC_HOST, port, ssl);
          this.useSSL = ssl;
          return; // conexión exitosa
        } catch (e) {
          this.emit('status', `Fallando ${ssl ? 'SSL' : 'plain'} :${port} — ${e.message}`);
        }
      }
    }
    throw new Error('No se pudo conectar a irc-hispano.org por ningún puerto');
  }

  async _tryConnect(host, port, ssl) {
    return new Promise((resolve, reject) => {
      const onReady = () => {
        this.socket.removeListener('error', onErr);
        this.socket.setEncoding('utf8');
        this.socket.on('data',  d => this._onData(d));
        this.socket.on('close', () => this._onClose());
        this.socket.on('error', e => this.emit('error', e.message));
        this._register();
        resolve();
      };
      const onErr = e => reject(e);

      if (this.proxy && SocksClient) {
        SocksClient.createConnection({
          proxy: {
            host:     this.proxy.host,
            port:     this.proxy.port,
            type:     this.proxy.type || 5,
            userId:   this.proxy.username,
            password: this.proxy.password
          },
          command:     'connect',
          destination: { host, port }
        }).then(({ socket: rawSocket }) => {
          if (ssl) {
            this.socket = tls.connect({ socket: rawSocket, servername: host, rejectUnauthorized: false });
            this.socket.once('secureConnect', onReady);
          } else {
            this.socket = rawSocket;
            onReady();
          }
          this.socket.once('error', onErr);
        }).catch(onErr);
      } else {
        // Conexión directa
        const timeout = setTimeout(() => {
          reject(new Error('timeout'));
          this.socket && this.socket.destroy();
        }, 8000);

        if (ssl) {
          this.socket = tls.connect(port, host, { rejectUnauthorized: false });
          this.socket.once('secureConnect', () => { clearTimeout(timeout); onReady(); });
        } else {
          this.socket = net.connect(port, host);
          this.socket.once('connect', () => { clearTimeout(timeout); onReady(); });
        }
        this.socket.once('error', e => { clearTimeout(timeout); onErr(e); });
      }
    });
  }

  _register() {
    // Enviar NICK y USER al servidor
    this.raw(`NICK ${this.nick}`);
    this.raw(`USER guest 0 * :IRC Hispano Client`);
  }

  /* ─────────────────────── datos raw ─────────────────────── */

  _onData(data) {
    this.buffer += data;
    const lines = this.buffer.split('\r\n');
    this.buffer = lines.pop(); // línea incompleta al final
    for (const line of lines) {
      if (line) this._parseLine(line);
    }
  }

  _onClose() {
    this.connected = false;
    clearInterval(this._pingTimer);
    this.emit('disconnected');
    if (!this._destroyed) {
      // Reconectar en 15s
      this._reconnectTimer = setTimeout(() => {
        this.emit('status', 'Reconectando...');
        this.connect().catch(e => this.emit('error', e.message));
      }, 15000);
    }
  }

  /* ─────────────────────── parser IRC ─────────────────────── */

  _parseLine(line) {
    this.emit('raw_in', line);

    // PING :server
    if (line.startsWith('PING')) {
      const srv = line.slice(5);
      this.raw(`PONG ${srv}`);
      return;
    }

    // :prefix COMMAND params :trailing
    const m = line.match(/^(?::([^ ]+) )?([A-Z0-9]+)(?: (.+))?$/);
    if (!m) return;

    const prefix  = m[1] || '';
    const command = m[2];
    const rest    = m[3] || '';

    // Separar params y trailing
    let params = [];
    let trailing = null;
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
      /* ── Bienvenida ── */
      case '001': // RPL_WELCOME
        this.connected = true;
        this.nick = params[0]; // el server puede ajustar el nick
        this._startPing();
        this.emit('connected', this.nick);
        break;

      case '002': case '003': case '004': case '005':
        this.emit('server_info', trailing || rest);
        break;

      /* ── MOTD ── */
      case '372': case '375': case '376':
        this.emit('motd', trailing || '');
        break;

      /* ── ERROR / KILL ── */
      case 'ERROR':
        this.emit('error', trailing || rest);
        break;

      /* ── Nick en uso ── */
      case '433':
        this.nick = this.nick + '_';
        this.raw(`NICK ${this.nick}`);
        break;

      case '432': case '436':
        this.nick = _guestNick();
        this.raw(`NICK ${this.nick}`);
        break;

      /* ── JOIN ── */
      case 'JOIN': {
        const chan = trailing || params[0];
        if (!this.channels.has(chan)) this.channels.set(chan, new Set());
        this.channels.get(chan).add(nick);
        this.emit('join', { nick, host, channel: chan, self: nick === this.nick });
        break;
      }

      /* ── PART ── */
      case 'PART': {
        const chan = params[0];
        const msg  = trailing || '';
        if (this.channels.has(chan)) {
          this.channels.get(chan).delete(nick);
          if (nick === this.nick) this.channels.delete(chan);
        }
        this.emit('part', { nick, host, channel: chan, message: msg, self: nick === this.nick });
        break;
      }

      /* ── QUIT ── */
      case 'QUIT':
        for (const [chan, nicks] of this.channels) {
          if (nicks.has(nick)) {
            nicks.delete(nick);
            this.emit('quit', { nick, host, channel: chan, message: trailing || '' });
          }
        }
        break;

      /* ── KICK ── */
      case 'KICK': {
        const chan   = params[0];
        const kicked = params[1];
        this.channels.get(chan)?.delete(kicked);
        this.emit('kick', { nick, channel: chan, kicked, message: trailing || '' });
        break;
      }

      /* ── NICK change ── */
      case 'NICK': {
        const newNick = trailing || params[0];
        for (const [, nicks] of this.channels) {
          if (nicks.has(nick)) { nicks.delete(nick); nicks.add(newNick); }
        }
        if (nick === this.nick) this.nick = newNick;
        this.emit('nick_change', { old: nick, new: newNick });
        break;
      }

      /* ── PRIVMSG / NOTICE ── */
      case 'PRIVMSG': case 'NOTICE': {
        const target  = params[0];
        const text    = trailing || '';
        const isPriv  = target === this.nick;
        const chan     = isPriv ? nick : target; // sala o nick del pm

        // CTCP
        if (text.startsWith('\x01') && text.endsWith('\x01')) {
          this._handleCTCP(nick, host, chan, text.slice(1, -1), isPriv);
          break;
        }

        this.emit('message', {
          from:    nick,
          host,
          target:  chan,
          text,
          private: isPriv,
          notice:  command === 'NOTICE'
        });
        break;
      }

      /* ── TOPIC ── */
      case 'TOPIC':
        this.emit('topic', { nick, channel: params[0], topic: trailing || '' });
        break;
      case '332':
        this.emit('topic', { nick: '', channel: params[1], topic: trailing || '' });
        break;

      /* ── NAMES ── */
      case '353': { // RPL_NAMREPLY
        const chan  = params[2];
        const names = (trailing || '').split(' ').filter(Boolean);
        if (!this.channels.has(chan)) this.channels.set(chan, new Set());
        const set = this.channels.get(chan);
        for (const n of names) set.add(n.replace(/^[@+%&~!]/, ''));
        this.emit('names', { channel: chan, nicks: [...set] });
        break;
      }
      case '366': // RPL_ENDOFNAMES
        if (this.channels.has(params[1])) {
          this.emit('names_end', { channel: params[1], nicks: [...this.channels.get(params[1])] });
        }
        break;

      /* ── MODE ── */
      case 'MODE':
        this.emit('mode', { nick, target: params[0], mode: params[1] || trailing || '' });
        break;

      /* ── WHOIS ── */
      case '311':
        this.emit('whois', { nick: params[1], user: params[2], host: params[3], realname: trailing });
        break;

      /* ── Errores genéricos ── */
      case '401': case '403': case '404': case '421':
      case '461': case '471': case '473': case '474': case '475':
        this.emit('server_error', { code: command, message: trailing || rest });
        break;

      default:
        this.emit('unknown', { command, prefix, params, trailing });
    }
  }

  /* ─────────────────────── CTCP ─────────────────────── */

  _handleCTCP(nick, host, chan, ctcp, isPriv) {
    const [type, ...rest] = ctcp.split(' ');
    switch (type) {
      case 'ACTION':
        this.emit('action', { from: nick, target: chan, text: rest.join(' '), private: isPriv });
        break;
      case 'VERSION':
        this.raw(`NOTICE ${nick} :\x01VERSION IRC-Hispano WebClient 1.0\x01`);
        break;
      case 'PING': {
        // Sanitizar datos CTCP PING para evitar inyección
        const pingData = rest.join(' ').replace(/[\r\n\x00\x01]/g, '').slice(0, 32);
        this.raw(`NOTICE ${nick} :\x01PING ${pingData}\x01`);
        break;
      }
      default:
        this.emit('ctcp', { from: nick, type, args: rest, private: isPriv });
    }
  }

  /* ─────────────────────── keepalive ─────────────────────── */

  _startPing() {
    clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => {
      if (this.connected) this.raw(`PING :${IRC_HOST}`);
    }, 90000);
  }

  /* ─────────────────────── comandos IRC ─────────────────────── */

  raw(line) {
    if (this.socket && !this.socket.destroyed) {
      // Prevenir CRLF injection: eliminar \r y \n de la línea
      const sanitized = String(line).replace(/[\r\n\x00]/g, '').slice(0, 510);
      this.socket.write(sanitized + '\r\n');
      this.emit('raw_out', sanitized);
    }
  }

  join(channel)              { this.raw(`JOIN ${channel}`); }
  part(channel, msg = '')    { this.raw(`PART ${channel}${msg ? ' :' + msg : ''}`); }
  privmsg(target, text)      { this.raw(`PRIVMSG ${target} :${text}`); }
  notice(target, text)       { this.raw(`NOTICE ${target} :${text}`); }
  action(target, text)       { this.raw(`PRIVMSG ${target} :\x01ACTION ${text}\x01`); }
  topic(channel, t)          { this.raw(t ? `TOPIC ${channel} :${t}` : `TOPIC ${channel}`); }
  kick(channel, nick, r = '') { this.raw(`KICK ${channel} ${nick}${r ? ' :' + r : ''}`); }
  mode(target, mode)         { this.raw(`MODE ${target} ${mode}`); }
  whois(nick)                { this.raw(`WHOIS ${nick}`); }
  who(channel)               { this.raw(`WHO ${channel}`); }
  list(channel = '')         { this.raw(channel ? `LIST ${channel}` : 'LIST'); }
  changeNick(nick)           { this.raw(`NICK ${nick}`); this.nick = nick; }

  quit(msg = 'Bye') {
    this._destroyed = true;
    clearInterval(this._pingTimer);
    clearTimeout(this._reconnectTimer);
    this.raw(`QUIT :${msg}`);
    setTimeout(() => this.socket?.destroy(), 500);
  }

  destroy() {
    this._destroyed = true;
    clearInterval(this._pingTimer);
    clearTimeout(this._reconnectTimer);
    this.socket?.destroy();
  }
}

/* ── helpers ── */

function _guestNick() {
  const n = Math.floor(Math.random() * 9000) + 1000;
  return `Invitado${n}`;
}

module.exports = { IRCClient, IRC_HOST };
