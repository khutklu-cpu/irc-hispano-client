'use strict';

const EventEmitter = require('events');
const { WebSocket } = require('ws');
const crypto = require('crypto');
const https = require('https');
const { SocksProxyAgent } = require('socks-proxy-agent');

const KIWI_HOST = 'kiwi.chathispano.com';
const KIWI_PORTS = [9000, 9001, 9002, 9004];
const KIWI_PATH = '/webirc/kiwiirc/';
const KIWI_SERVER = `https://${KIWI_HOST}:9000${KIWI_PATH}`;

const USER_AGENT_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
];

const ANIMALS = [
  'Leon', 'Tigre', 'Caracol', 'Perro', 'Mosquito', 'Pez', 'Pajaro', 'Lince', 'Elefante',
  'Rinoceronte', 'Avestruz', 'Grillo', 'Tiburon', 'Mapache', 'Murcielago', 'Topo', 'Bufalo', 'Buho',
  'Cocodrilo', 'Caiman', 'Flamenco', 'Oso', 'Lobo', 'Pinguino', 'Raton', 'Delfin', 'Pantera', 'Rana',
  'Ardilla', 'Aguila', 'Hormiga'
];
const SEPARATORS = ['-', '_', '{', '}', ''];
const ADJECTIVES = [
  'Verde', 'Azul', 'Naranja', 'Fugaz', 'Veloz', 'Feroz', 'Paciente', 'Elocuente',
  'Tenaz', 'Fuerte', 'Humilde', 'Agil', 'Torpe', 'Eficiente', 'Suave', 'Feliz', 'Brillante', 'Sensible'
];

function randomUserAgent() {
  return USER_AGENT_POOL[Math.floor(Math.random() * USER_AGENT_POOL.length)];
}

function guestNick() {
  const a = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  const s = SEPARATORS[Math.floor(Math.random() * SEPARATORS.length)];
  const j = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  return `${a}${s}${j}`;
}

function kiwiUrl(port) {
  const srv = String(Math.floor(Math.random() * 900) + 100);
  const session = crypto.randomBytes(8).toString('hex');
  return `wss://${KIWI_HOST}:${port}${KIWI_PATH}${srv}/${session}/websocket`;
}

function extractCookieHeader(setCookieHeaders) {
  if (!Array.isArray(setCookieHeaders) || setCookieHeaders.length === 0) return '';
  return setCookieHeaders
    .map((h) => String(h).split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function httpsGet(url, options = {}) {
  const headers = options.headers || options;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers,
      ...(options.agent ? { agent: options.agent } : {})
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk.toString('utf8'); });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers || {},
          body
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(7000, () => {
      req.destroy(new Error('timeout preflight https'));
    });
  });
}

function buildSocksAgent(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return null;
  const type = Number(proxy.type) === 4 ? 'socks4' : 'socks5';
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
    : '';
  const proxyUrl = `${type}://${auth}${proxy.host}:${proxy.port}`;
  return {
    type,
    label: `${proxy.host}:${proxy.port}`,
    agent: new SocksProxyAgent(proxyUrl)
  };
}

function controlStartVariants(port) {
  const currentPortServer = `https://${KIWI_HOST}:${port}${KIWI_PATH}`;
  return [
    { name: 'static-9000', payload: `:${KIWI_SERVER} CONTROL START` },
    { name: 'dynamic-port', payload: `:${currentPortServer} CONTROL START` },
    { name: 'no-colon', payload: `${KIWI_SERVER} CONTROL START` }
  ];
}

class IRCClient extends EventEmitter {
  constructor({ nick, proxy, proxies } = {}) {
    super();
    this.nick = nick || guestNick();
    this.proxy = proxy || null;
    this.proxies = Array.isArray(proxies) ? proxies.filter(Boolean) : [];
    if (this.proxies.length === 0 && this.proxy) this.proxies = [this.proxy];
    this._activeProxy = this.proxies[0] || null;
    this.ws = null;
    this.buffer = '';
    this.channels = new Map();
    this.desiredChannels = new Set();

    this.connected = false;
    this._connecting = false;
    this._destroyed = false;

    this._pingTimer = null;
    this._reconnectTimer = null;
    this._portIdx = 0;

    this._messageQueue = [];
    this._lastMsgTime = 0;
    this._msgDelay = 220;
  }

  async connect() {
    this._destroyed = false;
    this._connecting = true;
    this._portIdx = 0;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;

    for (let i = 0; i < KIWI_PORTS.length; i++) {
      if (this._destroyed) break;
      this._activeProxy = this.proxies.length > 0 ? this.proxies[i % this.proxies.length] : null;
      const port = KIWI_PORTS[i];
      try {
        await this._tryConnect(port);
        this._portIdx = i;
        this._connecting = false;
        return;
      } catch (err) {
        this.emit('status', `Fallando endpoint ${i + 1}/${KIWI_PORTS.length}: ${err.message}`);
        if (
          this._activeProxy &&
          /ENOTFOUND|EAI_AGAIN/i.test(String(err.message || ''))
        ) {
          this._connecting = false;
          throw new Error(
            `Proxy SOCKS invalido o no resoluble (${this._activeProxy.host}:${this._activeProxy.port}): ${err.message}`
          );
        }
        if (
          this._activeProxy &&
          /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/i.test(String(err.message || '')) &&
          this.proxies.length <= 1
        ) {
          this._connecting = false;
          throw new Error(
            `Proxy SOCKS no disponible (${this._activeProxy.host}:${this._activeProxy.port}): ${err.message}`
          );
        }
      }
    }

    this._connecting = false;
    if (!this._destroyed) {
      if (this._activeProxy && this._activeProxy.host) {
        throw new Error(
          `No se pudo registrar en ChatHispano por ningun endpoint usando proxy ${this._activeProxy.host}:${this._activeProxy.port}`
        );
      }
      throw new Error(
        'No se pudo conectar al proxy de ChatHispano por ningun endpoint (posible filtro de IP; configura SOCKS5)'
      );
    }
  }

  async _tryConnect(port) {
    const ua = randomUserAgent();
    let cookieHeader = '';
    const socks = buildSocksAgent(this._activeProxy);

    try {
      // SockJS normalmente hace /info antes de abrir websocket; algunas pasarelas usan
      // esa petición para affinity/cookies del backend.
      const infoUrl = `https://${KIWI_HOST}:${port}${KIWI_PATH}info?t=${Date.now()}`;
      const infoRes = await httpsGet(infoUrl, {
        headers: {
          Origin: 'https://chathispano.com',
          Referer: 'https://chathispano.com/',
          'User-Agent': ua,
          Accept: '*/*',
          'Accept-Language': 'es-ES,es;q=0.9',
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache'
        },
        ...(socks ? { agent: socks.agent } : {})
      });

      cookieHeader = extractCookieHeader(infoRes.headers['set-cookie']);
      if (cookieHeader) {
        this.emit('status', `Preflight OK en ${port} con cookies de sesion`);
      } else {
        this.emit('status', `Preflight OK en ${port} sin cookies`);
      }
    } catch (_) {
      // No bloquear la conexión si el preflight falla; intentamos igualmente websocket.
      this.emit('status', `Preflight no disponible en ${port}, continuando`);
    }

    return new Promise((resolve, reject) => {
      const url = kiwiUrl(port);
      this.emit('status', `Conectando a proxy ChatHispano (puerto ${port})...`);

      let agent = undefined;
      if (socks) {
        agent = socks.agent;
        this.emit('status', `Usando salida ${socks.type.toUpperCase()} ${socks.label}`);
      }

      let settled = false;
      let openedSockJs = false;
      let registerWatchdog = null;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          clearTimeout(registerWatchdog);
          this.removeListener('connected', onRegistered);
          try { ws.terminate(); } catch (_) {}
          reject(new Error(`timeout en puerto ${port}`));
        }
      }, 22000);

      const onRegistered = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          clearTimeout(registerWatchdog);
          this.removeListener('connected', onRegistered);
          resolve();
        }
      };

      this.once('connected', onRegistered);

      const ws = new WebSocket(url, {
        headers: {
          Origin: 'https://chathispano.com',
          Referer: 'https://chathispano.com/',
          'User-Agent': ua,
          Accept: '*/*',
          'Accept-Language': 'es-ES,es;q=0.9',
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
          'Sec-Fetch-Site': 'same-site',
          'Sec-Fetch-Mode': 'websocket',
          'Sec-Fetch-Dest': 'empty',
          DNT: '1',
          ...(cookieHeader ? { Cookie: cookieHeader } : {})
        },
        ...(agent ? { agent } : {}),
        rejectUnauthorized: false
      });

      this.ws = ws;

      ws.once('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          clearTimeout(registerWatchdog);
          this.removeListener('connected', onRegistered);
          reject(err);
        }
      });

      ws.once('open', () => {
        ws.removeAllListeners('error');
        ws.on('error', (err) => {
          if (!this._destroyed) this.emit('error', err.message);
        });

        ws.on('message', (data) => {
          const frame = typeof data === 'string' ? data : data.toString('utf8');

          if (frame === 'o') {
            openedSockJs = true;

            const variants = controlStartVariants(port);
            const schedule = [0, 1500, 3000];

            variants.forEach((variant, idx) => {
              setTimeout(() => {
                if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.connected) return;
                this.emit('status', `Handshake ${variant.name} en puerto ${port}`);
                this.ws.send(JSON.stringify([variant.payload]));
                setTimeout(() => {
                  if (!this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this._register();
                  }
                }, 120);
              }, schedule[idx] || 0);
            });

            // Si SockJS abre pero nunca llega 001, probablemente IP filtrada o handshake
            // incompleto en ese endpoint. Forzamos rotación para probar el siguiente puerto.
            registerWatchdog = setTimeout(() => {
              if (!settled && !this.connected) {
                this.emit('status', `Sin registro IRC en puerto ${port}, rotando endpoint...`);
                try { ws.terminate(); } catch (_) {}
              }
            }, 10000);
            return;
          }

          if (!openedSockJs) return;
          this._onSockJSFrame(frame);
        });

        ws.on('close', (code) => {
          if (this.connected) {
            this._handleRuntimeClose();
            return;
          }
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            clearTimeout(registerWatchdog);
            this.removeListener('connected', onRegistered);
            reject(new Error(
              openedSockJs
                ? `WebSocket cerrado (${code}) antes del registro IRC`
                : `WebSocket cerrado (${code}) antes de SockJS open`
            ));
          } else {
            this.emit('disconnected');
          }
        });
      });
    });
  }

  _onSockJSFrame(frame) {
    if (frame === 'h') return;

    if (frame.startsWith('c')) {
      try {
        const [code, reason] = JSON.parse(frame.slice(1));
        this.emit('error', `SockJS cerrado: ${reason} (${code})`);
      } catch (_) {}
      return;
    }

    if (!frame.startsWith('a')) return;

    let msgs;
    try {
      msgs = JSON.parse(frame.slice(1));
    } catch (_) {
      return;
    }

    for (const msg of msgs) {
      const lines = (this.buffer + msg).split('\r\n');
      this.buffer = lines.pop();
      for (const l of lines) {
        if (l) this._parseLine(l);
      }
    }
  }

  _register() {
    this.raw('CAP LS 302');
    this.raw(`NICK ${this.nick}`);
    this.raw('USER kiwi 0 * :Usuario Kiwi ChatHispano');
  }

  raw(line) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const sanitized = String(line).replace(/[\r\n\x00]/g, '').slice(0, 510);
    const now = Date.now();
    const elapsed = now - this._lastMsgTime;

    if (elapsed < this._msgDelay) {
      this._messageQueue.push(sanitized + '\r\n');
      if (this._messageQueue.length === 1) {
        setTimeout(() => this._processMsgQueue(), this._msgDelay - elapsed);
      }
      return;
    }

    this.ws.send(JSON.stringify([sanitized + '\r\n']));
    this._lastMsgTime = now;
    this.emit('raw_out', sanitized);
  }

  _processMsgQueue() {
    if (this._messageQueue.length === 0) return;

    const msg = this._messageQueue.shift();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify([msg]));
      this._lastMsgTime = Date.now();
      this.emit('raw_out', msg.slice(0, -2));
    }

    if (this._messageQueue.length > 0) {
      setTimeout(() => this._processMsgQueue(), this._msgDelay);
    }
  }

  _handleRuntimeClose() {
    this.connected = false;
    clearInterval(this._pingTimer);
    this.emit('disconnected');

    if (this._destroyed || this._connecting) return;

    this._portIdx = (this._portIdx + 1) % KIWI_PORTS.length;
    clearTimeout(this._reconnectTimer);

    this._reconnectTimer = setTimeout(() => {
      if (this._destroyed || this._connecting) return;
      this.emit('status', `Reconectando (endpoint ${this._portIdx + 1})...`);
      this._tryConnect(KIWI_PORTS[this._portIdx]).catch((e) => {
        this.emit('error', e.message);
        if (!this._destroyed && !this._connecting) {
          this._reconnectTimer = setTimeout(() => {
            this.connect().catch((e2) => this.emit('error', e2.message));
          }, 10000);
        }
      });
    }, 5000);
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

    const prefix = m[1] || '';
    const command = m[2];
    const rest = m[3] || '';

    let params = [];
    let trailing = null;
    const trailIdx = rest.indexOf(' :');

    if (trailIdx >= 0) {
      params = rest.slice(0, trailIdx).split(' ').filter(Boolean);
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
      case '002':
      case '003':
      case '004':
      case '005':
        this.emit('server_info', trailing || rest);
        break;
      case '372':
      case '375':
      case '376':
        this.emit('motd', trailing || '');
        break;
      case 'ERROR': {
        const msg = trailing || rest;
        if (/[GKZEz]-line|banned|throttled|too many connections|killed|closing/i.test(msg)) {
          this.emit('banned', msg);
          if (!this._destroyed) {
            clearTimeout(this._reconnectTimer);
            this._portIdx = (this._portIdx + 1) % KIWI_PORTS.length;
            this._reconnectTimer = setTimeout(() => {
              this.emit('status', 'Rotando endpoint por ban...');
              this.connect().catch((e) => this.emit('error', e.message));
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
      case '432':
      case '436':
        this.nick = guestNick();
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
        const chan = params[0];
        const msg = trailing || '';
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
          if (nicks.has(nick)) {
            nicks.delete(nick);
            this.emit('quit', { nick, host, channel: chan, message: trailing || '' });
          }
        }
        break;
      case 'KICK': {
        const chan = params[0];
        const kicked = params[1];
        this.channels.get(chan)?.delete(kicked);
        if (kicked === this.nick) this.desiredChannels.delete(chan);
        this.emit('kick', { nick, channel: chan, kicked, message: trailing || '' });
        break;
      }
      case 'NICK': {
        const newNick = trailing || params[0];
        for (const [, nicks] of this.channels) {
          if (nicks.has(nick)) {
            nicks.delete(nick);
            nicks.add(newNick);
          }
        }
        if (nick === this.nick) this.nick = newNick;
        this.emit('nick_change', { old: nick, new: newNick });
        break;
      }
      case 'PRIVMSG':
      case 'NOTICE': {
        const target = params[0];
        const text = trailing || '';
        const isPriv = target === this.nick;
        const chan = isPriv ? nick : target;

        if (text.startsWith('\x01') && text.endsWith('\x01')) {
          this._handleCTCP(nick, host, chan, text.slice(1, -1), isPriv);
          break;
        }

        this.emit('message', {
          from: nick,
          host,
          target: chan,
          text,
          private: isPriv,
          notice: command === 'NOTICE'
        });
        break;
      }
      case 'TOPIC':
        this.emit('topic', { nick, channel: params[0], topic: trailing || '' });
        break;
      case '332':
        this.emit('topic', { nick: '', channel: params[1], topic: trailing || '' });
        break;
      case '353': {
        const chan = params[2];
        const names = (trailing || '').split(' ').filter(Boolean);
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
        if (this.channels.has(params[1])) {
          this.emit('names_end', { channel: params[1], nicks: [...this.channels.get(params[1])] });
        }
        break;
      case 'MODE':
        this.emit('mode', { nick, target: params[0], mode: params[1] || trailing || '' });
        break;
      case '311':
        this.emit('whois', { nick: params[1], user: params[2], host: params[3], realname: trailing });
        break;
      case '401':
      case '403':
      case '404':
      case '421':
      case '461':
      case '471':
      case '473':
      case '474':
      case '475':
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

  _rejoinDesiredChannels() {
    const chans = [...this.desiredChannels];
    chans.forEach((chan, idx) => {
      setTimeout(() => {
        if (this.connected) this.raw(`JOIN ${chan}`);
      }, idx * 500);
    });
  }

  join(channel) { this.desiredChannels.add(channel); this.raw(`JOIN ${channel}`); }
  part(channel, msg = '') { this.desiredChannels.delete(channel); this.raw(`PART ${channel}${msg ? ' :' + msg : ''}`); }
  privmsg(target, text) { this.raw(`PRIVMSG ${target} :${text}`); }
  notice(target, text) { this.raw(`NOTICE ${target} :${text}`); }
  action(target, text) { this.raw(`PRIVMSG ${target} :\x01ACTION ${text}\x01`); }
  topic(channel, t) { this.raw(t ? `TOPIC ${channel} :${t}` : `TOPIC ${channel}`); }
  kick(channel, nick, r = '') { this.raw(`KICK ${channel} ${nick}${r ? ' :' + r : ''}`); }
  mode(target, mode) { this.raw(`MODE ${target} ${mode}`); }
  whois(nick) { this.raw(`WHOIS ${nick}`); }
  who(channel) { this.raw(`WHO ${channel}`); }
  list(channel = '') { this.raw(channel ? `LIST ${channel}` : 'LIST'); }
  changeNick(nick) { this.raw(`NICK ${nick}`); this.nick = nick; }

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

module.exports = { IRCClient, KIWI_PORTS, KIWI_HOST };
