'use strict';
/**
 * Gestión de archivos temporales para compartir en IRC
 * Archivos se borran automáticamente tras TTL (2h por defecto)
 */

const path  = require('path');
const fs    = require('fs');
const mime  = require('mime-types');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const TTL_MS      = 2 * 60 * 60 * 1000; // 2 horas
const MAX_SIZE    = 25 * 1024 * 1024;    // 25 MB

const ALLOWED_MIME = new Set([
  // Imágenes
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/svg+xml', 'image/bmp',
  // Documentos
  'text/plain', 'application/pdf',
  // Archivos
  'application/zip', 'application/x-tar', 'application/gzip',
  'application/x-7z-compressed', 'application/x-rar-compressed',
  // Audio/vídeo (pequeños)
  'audio/mpeg', 'audio/ogg', 'video/mp4', 'video/webm'
]);

function ensureDir() {
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function isAllowedMime(mime) {
  return ALLOWED_MIME.has(mime);
}

function isImage(mime) {
  return mime && mime.startsWith('image/');
}

module.exports = { ensureDir, isAllowedMime, isImage, MAX_SIZE, UPLOADS_DIR };
