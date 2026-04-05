#!/usr/bin/env node
/**
 * Quick test - apenas intentar conexion sin todo el boilerplate
 */

'use strict';

const { IRCClient } = require('./lib/irc');

console.log('Creando cliente IRC...');
const client = new IRCClient();

console.log('Eventos disponibles en cliente:');
console.log('- "status"');
console.log('- "error"');
console.log('- "connected"');
console.log('- "raw_in"');
console.log('- "raw_out"');
console.log('');

let receivedData = false;

client.on('status', (msg) => {
  console.log(`[STATUS] ${msg}`);
});

client.on('error', (msg) => {
  console.log(`[ERROR] ${msg}`);
});

client.on('connected', (nick) => {
  console.log(`[SUCCESS] Conectado como: ${nick}`);
  receivedData = true;
});

client.on('raw_in', (msg) => {
  if (!receivedData) {
    console.log(`[RAW IN] ${msg.slice(0, 100)}`);
    receivedData = true;
  }
});

console.log('Intentando conectar...\n');

client.connect()
  .then(() => {
    console.log('\n✓ Conexión establecida');
  })
  .catch((err) => {
    console.error(`\n✗ Error: ${err.message}`);
    process.exit(1);
  });

// Timeout de 30 segundos
setTimeout(() => {
  console.log('\n[TIMEOUT] 30 segundos sin respuesta del servidor');
  if (!receivedData) {
    console.log('ℹ No se recibieron datos del servidor');
  }
  client.destroy();
  process.exit(receivedData ? 0 : 1);
}, 30000);
