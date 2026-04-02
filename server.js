'use strict';
/**
 * Servidor principal — IRC Hispano Web Client
 * Express + Socket.IO + IRC bridge
 */

const express  = require('express');
const http     = require('http');
const { Server: SocketIO } = require('socket.io');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const mime     = require('mime-types');
const helmet   = require('helmet');

const { IRCClient } = require('./lib/irc');
const { ensureDir, isAllowedMime, isImage, MAX_SIZE, UPLOADS_DIR } = require('./lib/files');

ensureDir();

const APP_HOST = process.env.HOST || '0.0.0.0';
const APP_PORT = parseInt(process.env.PORT || '3000', 10);
const IRC_SERVER_LABEL = process.env.IRC_HOST || 'irc.irc-hispano.org';

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

/* ── Error handler multer ── */

app.use((err, req, res, _next) => {
  if (err && err.message) {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Error interno' });
});

/* ─── HTTP server + Socket.IO ─── */

const server = http.createServer(app);
const io     = new SocketIO(server);

// Mapa de sesiones socket → IRCClient
const sessions = new Map();

io.on('connection', socket => {
  const clientIp = socket.handshake.address;
  console.log(`[WS] Nueva conexion desde ${clientIp}`);

  let irc = null;

  /* ── Enviar evento al browser ── */
  const send = (type, payload) => {
    socket.emit('msg', { type, ...payload });
  };

  /* ── Recibir mensajes del browser ── */
  socket.on('msg', async msg => {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {

      /* ── Conectar al IRC ── */
      case 'CONNECT': {
        if (irc) { irc.destroy(); }

        // Validar proxy: solo hostname/IP válido, puerto en rango
        const proxyHostRaw = msg.proxy && msg.proxy.host ? String(msg.proxy.host).slice(0, 253) : '';
        const proxyHostValid = /^[a-zA-Z0-9.\-]+$/.test(proxyHostRaw);
        const proxyPort = parseInt(msg.proxy?.port, 10);
        const proxy = (proxyHostValid && proxyPort >= 1 && proxyPort <= 65535) ? {
          host:     proxyHostRaw,
          port:     proxyPort,
          type:     5,
          username: msg.proxy.username ? String(msg.proxy.username).slice(0, 64) : undefined,
          password: msg.proxy.password ? String(msg.proxy.password).slice(0, 64) : undefined
        } : null;

        irc = new IRCClient({ proxy });
        sessions.set(socket, irc);

        // ── Eventos IRC → Browser ──

        irc.on('connected', nick => {
          send('CONNECTED', { nick });
        });

        irc.on('disconnected', () => {
          send('DISCONNECTED', {});
        });

        irc.on('error', msg => {
          send('ERROR', { message: msg });
        });

        irc.on('banned', msg => {
          send('BANNED', { message: msg });
        });
        irc.on('status', msg => {
          send('STATUS', { message: msg });
        });

        irc.on('motd', text => {
          send('MOTD', { text });
        });

        irc.on('server_info', text => {
          send('SERVER_INFO', { text });
        });

        irc.on('message', data => {
          send('MESSAGE', data);
        });

        irc.on('action', data => {
          send('ACTION', data);
        });

        irc.on('notice', data => {
          send('NOTICE', data);
        });

        irc.on('join', data => {
          send('JOIN', data);
        });

        irc.on('part', data => {
          send('PART', data);
        });

        irc.on('quit', data => {
          send('QUIT', data);
        });

        irc.on('kick', data => {
          send('KICK', data);
        });

        irc.on('nick_change', data => {
          send('NICK_CHANGE', data);
        });

        irc.on('topic', data => {
          send('TOPIC', data);
        });

        irc.on('names', data => {
          send('NAMES', data);
        });

        irc.on('names_end', data => {
          send('NAMES_END', data);
        });

        irc.on('mode', data => {
          send('MODE', data);
        });

        irc.on('whois', data => {
          send('WHOIS', data);
        });

        irc.on('server_error', data => {
          send('SERVER_ERROR', data);
        });

        irc.on('raw_in', line => {
          send('RAW_IN', { line });
        });

        // Conectar
        send('STATUS', { message: 'Conectando via proxy ChatHispano...' });
        irc.connect().catch(e => {
          send('ERROR', { message: `Error de conexion: ${e.message}` });
        });
        break;
      }

      /* ── Desconectar ── */
      case 'DISCONNECT':
        irc?.quit('Hasta luego');
        irc = null;
        break;

      /* ── Comandos IRC ── */
      case 'JOIN':
        if (irc && msg.channel) irc.join(sanitizeChan(msg.channel));
        break;

      case 'PART':
        if (irc && msg.channel) irc.part(sanitizeChan(msg.channel), msg.message || '');
        break;

      case 'PRIVMSG':
        if (irc && msg.target && msg.text) {
          // Sanitizar texto: eliminar caracteres de control para prevenir CRLF injection
          const text = sanitizeText(String(msg.text), 450);
          irc.privmsg(sanitizeTarget(msg.target), text);
        }
        break;

      case 'ACTION':
        if (irc && msg.target && msg.text) {
          irc.action(sanitizeTarget(msg.target), sanitizeText(String(msg.text), 440));
        }
        break;

      case 'TOPIC':
        if (irc && msg.channel) irc.topic(sanitizeChan(msg.channel), sanitizeText(msg.topic || '', 250));
        break;

      case 'KICK':
        if (irc && msg.channel && msg.nick) {
          irc.kick(sanitizeChan(msg.channel), sanitizeNick(msg.nick), sanitizeText(msg.reason || '', 120));
        }
        break;

      case 'MODE':
        if (irc && msg.target) irc.mode(sanitizeTarget(msg.target), String(msg.mode || '').slice(0, 32));
        break;

      case 'WHOIS':
        if (irc && msg.nick) irc.whois(sanitizeNick(msg.nick));
        break;

      case 'WHO':
        if (irc && msg.channel) irc.who(sanitizeChan(msg.channel));
        break;

      case 'NICK':
        if (irc && msg.nick) irc.changeNick(sanitizeNick(msg.nick));
        break;

      case 'RAW':
        // Solo para debug — solo se permite en modo debug
        if (irc && msg.line && process.env.IRC_DEBUG === '1') {
          irc.raw(String(msg.line).slice(0, 512));
        }
        break;

      default:
        send('ERROR', { message: 'Comando WS desconocido: ' + msg.type });
    }
  });

  /* ── Desconexion socket ── */
  socket.on('disconnect', () => {
    console.log(`[WS] Conexion cerrada desde ${clientIp}`);
    const irc = sessions.get(socket);
    if (irc) { irc.destroy(); sessions.delete(socket); }
  });

  socket.on('error', err => {
    console.error('[WS] Error:', err.message);
  });
});

/* ─── Iniciar servidor ─── */

server.listen(APP_PORT, APP_HOST, () => {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${APP_HOST}:${APP_PORT}`;
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║   IRC Hispano Web Client             ║`);
  console.log(`║   ${publicBaseUrl}             ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});

/* ─── Sanitizers ─── */

function sanitizeChan(c) {
  return String(c).replace(/[^\w#&!+.-]/g, '').slice(0, 50) || '#general';
}
function sanitizeTarget(t) {
  return String(t).replace(/[^\w#&!+.@-]/g, '').slice(0, 50);
}
function sanitizeNick(n) {
  return String(n).replace(/[^\w\[\]\\`^{|-]/g, '').slice(0, 30);
}
// Elimina caracteres de control IRC (\r, \n, \x00) y limita longitud
function sanitizeText(t, maxLen = 450) {
  return String(t).replace(/[\r\n\x00]/g, '').slice(0, maxLen);
}

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
  for (const [socket, irc] of sessions) {
    irc.quit('Servidor reiniciando');
    socket.disconnect(true);
  }
  server.close(() => process.exit(0));
});
