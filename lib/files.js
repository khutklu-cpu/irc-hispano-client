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

/**
 * Registra un archivo subido y programa su borrado
 * @param {string} filename  - nombre sanitizado
 * @param {string} mimetype  - MIME type validado
 * @returns {string} fileId  - ID único del archivo
 */
function registerFile(filename, mimetype) {
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();

  // Borrar tras TTL
  setTimeout(() => {
    const full = path.join(UPLOADS_DIR, id + '_' + filename);
    fs.unlink(full, () => {});
  }, TTL_MS);

  return id;
}

/**
 * Devuelve la ruta absoluta de un archivo por ID + nombre
 */
function resolvePath(id, filename) {
  // Validar que id y filename no contengan '..' ni separadores de ruta
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const safe = path.basename(filename);
  const full = path.join(UPLOADS_DIR, id + '_' + safe);
  // Doble verificación: la ruta debe estar dentro de UPLOADS_DIR
  if (!full.startsWith(UPLOADS_DIR + path.sep)) return null;
  if (!fs.existsSync(full)) return null;
  return full;
}

function isAllowedMime(mime) {
  return ALLOWED_MIME.has(mime);
}

function isImage(mime) {
  return mime && mime.startsWith('image/');
}

module.exports = { ensureDir, registerFile, resolvePath, isAllowedMime, isImage, MAX_SIZE, UPLOADS_DIR };
