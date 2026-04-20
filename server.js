'use strict';
/**
 * Servidor principal — IRC Hispano Web Client
 * Express + Upload/Download de archivos + Gateway WebSocket a IRC
 */

const express  = require('express');
const http     = require('http');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const mime     = require('mime-types');
const helmet   = require('helmet');
const { WebSocketServer } = require('ws');

const { ensureDir, isAllowedMime, isImage, MAX_SIZE, UPLOADS_DIR } = require('./lib/files');
const { IRCClient } = require('./lib/irc');

ensureDir();

const APP_HOST = process.env.HOST || '0.0.0.0';
const APP_PORT = parseInt(process.env.PORT || '3000', 10);

/* ─── Express ─── */

const app = express();

// Helmet con CSP relajada solo para lo que necesitamos
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:'],
      fontSrc:    ["'self'"],
      objectSrc:  ["'none'"],
      frameSrc:   ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: '16kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true });
});

/* ── Multer (subida de archivos) ── */

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const id   = crypto.randomUUID();
    const ext  = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
    const safe = id + (ext ? ext : '');
    req._fileId   = id;
    req._fileName = safe;
    cb(null, safe);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    const detected = mime.lookup(file.originalname) || file.mimetype;
    if (!isAllowedMime(detected)) {
      return cb(new Error('Tipo de archivo no permitido'));
    }
    cb(null, true);
  }
});

/* ── Endpoint upload ── */

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  const detected  = mime.lookup(req.file.originalname) || 'application/octet-stream';
  const url       = `/files/${req.file.filename}`;
  const isImg     = isImage(detected);

  // Programar borrado en 2h
  setTimeout(() => fs.unlink(req.file.path, () => {}), 2 * 60 * 60 * 1000);

  res.json({
    url,
    filename: req.file.originalname,
    size:     req.file.size,
    mime:     detected,
    isImage:  isImg
  });
});

/* ── Endpoint descarga de archivos ── */

app.get('/files/:filename', (req, res) => {
  // Solo caracteres seguros en el nombre
  const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!filename) return res.status(400).end();

  const filePath = path.normalize(path.join(UPLOADS_DIR, filename));
  // Path traversal check: la ruta normalizada debe empezar exactamente por UPLOADS_DIR
  const uploadsNorm = path.normalize(UPLOADS_DIR) + path.sep;
  if (!filePath.startsWith(uploadsNorm)) {
    return res.status(400).end();
  }
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const mimeType = mime.lookup(filename) || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(filePath).pipe(res);
});

/* ─── Error handler multer ── */

app.use((err, req, res, _next) => {
  if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Error interno' });
});

/* ─── Iniciar servidor ─── */

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const sessions = new Map();

function parseSocksProxy(item) {
  try {
    const u = new URL(String(item));
    if (!/^socks4:|^socks5:/i.test(u.protocol)) return null;
    const host = u.hostname;
    const port = parseInt(u.port, 10);
    if (!host || Number.isNaN(port) || port < 1 || port > 65535) return null;
    return {
      host,
      port,
      type: /^socks4:/i.test(u.protocol) ? 4 : 5,
      username: u.username ? decodeURIComponent(u.username) : undefined,
      password: u.password ? decodeURIComponent(u.password) : undefined
    };
  } catch (_) {
    return null;
  }
}

function parseSocksPool(raw) {
  return String(raw || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map(parseSocksProxy)
    .filter(Boolean);
}

const envSocksPool = parseSocksPool(process.env.SOCKS_POOL);

function wsSend(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(payload));
}

function destroySession(session) {
  if (!session || !session.irc) return;
  try { session.irc.destroy(); } catch (_) {}
  session.irc = null;
}

function wireIrcEvents(ws, session, irc) {
  irc.on('status', (message) => wsSend(ws, { type: 'STATUS', message }));
  irc.on('error', (message) => wsSend(ws, { type: 'ERROR', message: String(message || 'Error IRC') }));
  irc.on('banned', (message) => wsSend(ws, {
    type: 'ERROR',
    message: `Posible ban/filtro de IP detectado: ${String(message || '')}`.trim()
  }));
  irc.on('connected', (nick) => wsSend(ws, { type: 'CONNECTED', nick }));
  irc.on('disconnected', () => wsSend(ws, { type: 'DISCONNECTED' }));

  irc.on('message', (m) => wsSend(ws, {
    type: 'MESSAGE',
    from: m.from,
    target: m.target,
    text: m.text,
    private: !!m.private,
    notice: !!m.notice
  }));
  irc.on('action', (m) => wsSend(ws, {
    type: 'ACTION',
    from: m.from,
    target: m.target,
    text: m.text,
    private: !!m.private
  }));
  irc.on('notice', (m) => wsSend(ws, {
    type: 'NOTICE',
    from: m.from,
    target: m.target,
    text: m.text
  }));
  irc.on('join', (m) => wsSend(ws, {
    type: 'JOIN',
    nick: m.nick,
    channel: m.channel,
    self: !!m.self
  }));
  irc.on('part', (m) => wsSend(ws, {
    type: 'PART',
    nick: m.nick,
    channel: m.channel,
    message: m.message,
    self: !!m.self
  }));
  irc.on('quit', (m) => wsSend(ws, {
    type: 'QUIT',
    nick: m.nick,
    channel: m.channel,
    message: m.message
  }));
  irc.on('kick', (m) => wsSend(ws, {
    type: 'KICK',
    nick: m.nick,
    channel: m.channel,
    kicked: m.kicked,
    message: m.message
  }));
  irc.on('nick_change', (m) => wsSend(ws, {
    type: 'NICK_CHANGE',
    old: m.old,
    new: m.new
  }));
  irc.on('topic', (m) => wsSend(ws, {
    type: 'TOPIC',
    nick: m.nick,
    channel: m.channel,
    topic: m.topic
  }));
  irc.on('names', (m) => wsSend(ws, {
    type: 'NAMES',
    channel: m.channel,
    nicks: m.nicks
  }));
  irc.on('names_end', (m) => wsSend(ws, {
    type: 'NAMES_END',
    channel: m.channel,
    nicks: m.nicks
  }));
  irc.on('mode', (m) => wsSend(ws, {
    type: 'MODE',
    nick: m.nick,
    target: m.target,
    mode: m.mode
  }));
  irc.on('whois', (m) => wsSend(ws, {
    type: 'WHOIS',
    nick: m.nick,
    user: m.user,
    host: m.host,
    realname: m.realname
  }));
  irc.on('server_error', (m) => wsSend(ws, {
    type: 'ERROR',
    message: `[${m.code}] ${m.message}`
  }));
}

function startIrcSession(ws, session, payload) {
  destroySession(session);

  const payloadProxy = payload && payload.proxy ? parseSocksProxy(payload.proxy) : null;
  const proxies = envSocksPool.length > 0
    ? envSocksPool
    : (payloadProxy ? [payloadProxy] : []);

  const irc = new IRCClient({
    nick: payload && payload.nick ? String(payload.nick) : undefined,
    proxy: proxies[0] || null,
    proxies
  });

  session.irc = irc;
  wireIrcEvents(ws, session, irc);
  irc.connect().catch((err) => {
    wsSend(ws, {
      type: 'ERROR',
      message: `No se pudo abrir sesion IRC: ${err.message}`
    });
  });
}

function handleClientCommand(ws, session, msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'CONNECT') {
    startIrcSession(ws, session, msg);
    return;
  }

  const irc = session.irc;
  if (!irc) {
    wsSend(ws, { type: 'ERROR', message: 'Sesion IRC no inicializada' });
    return;
  }

  switch (msg.type) {
    case 'DISCONNECT':
      irc.quit('Bye');
      destroySession(session);
      wsSend(ws, { type: 'DISCONNECTED' });
      break;
    case 'JOIN':
      if (msg.channel) irc.join(String(msg.channel));
      break;
    case 'PART':
      if (msg.channel) irc.part(String(msg.channel), msg.message ? String(msg.message) : '');
      break;
    case 'PRIVMSG':
      if (msg.target && msg.text) irc.privmsg(String(msg.target), String(msg.text));
      break;
    case 'ACTION':
      if (msg.target && msg.text) irc.action(String(msg.target), String(msg.text));
      break;
    case 'TOPIC':
      if (msg.channel) irc.topic(String(msg.channel), msg.topic ? String(msg.topic) : '');
      break;
    case 'KICK':
      if (msg.channel && msg.nick) irc.kick(String(msg.channel), String(msg.nick), msg.reason ? String(msg.reason) : '');
      break;
    case 'MODE':
      if (msg.target && msg.mode) irc.mode(String(msg.target), String(msg.mode));
      break;
    case 'WHOIS':
      if (msg.nick) irc.whois(String(msg.nick));
      break;
    case 'WHO':
      if (msg.channel) irc.who(String(msg.channel));
      break;
    case 'NICK':
      if (msg.nick) irc.changeNick(String(msg.nick));
      break;
    default:
      wsSend(ws, { type: 'ERROR', message: `Comando no soportado: ${msg.type}` });
      break;
  }
}

wss.on('connection', (ws) => {
  const session = { irc: null };
  sessions.set(ws, session);
  wsSend(ws, { type: 'STATUS', message: 'Canal de control listo' });

  ws.on('message', (data) => {
    try {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      const msg = JSON.parse(text);
      handleClientCommand(ws, session, msg);
    } catch (_) {
      wsSend(ws, { type: 'ERROR', message: 'Payload invalido' });
    }
  });

  ws.on('close', () => {
    destroySession(session);
    sessions.delete(ws);
  });

  ws.on('error', () => {
    destroySession(session);
    sessions.delete(ws);
  });
});

server.listen(APP_PORT, APP_HOST, () => {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${APP_HOST}:${APP_PORT}`;
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   IRC Hispano Web Client             ║`);
  console.log(`║   ${publicBaseUrl}             ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});

/* ─── Proteccion anti-crash ─── */

process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException:', err.message, err.stack);
  // No terminamos el proceso — el servidor sigue vivo
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH] unhandledRejection:', reason);
});

/* ─── Apagado limpio ─── */

process.on('SIGINT', () => {
  console.log('\nApagando servidor...');
  for (const [, session] of sessions) {
    destroySession(session);
  }
  try { wss.close(); } catch (_) {}
  server.close(() => process.exit(0));
});
