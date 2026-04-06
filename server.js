'use strict';
/**
 * Servidor principal — IRC Hispano Web Client
 * Express + Upload/Download de archivos
 * 
 * TODO: La conexión IRC ocurre directamente desde el navegador
 * Este servidor se encarga únicamente de servir archivos estáticos y gestionar uploads
 */

const express  = require('express');
const http     = require('http');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const mime     = require('mime-types');
const helmet   = require('helmet');

const { ensureDir, isAllowedMime, isImage, MAX_SIZE, UPLOADS_DIR } = require('./lib/files');

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
  server.close(() => process.exit(0));
});
