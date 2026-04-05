#!/usr/bin/env node
/**
 * Debug de conexión IRC - inspeccionar frames SockJS
 * Uso: node debug-connection.js
 */

'use strict';

const { WebSocket } = require('ws');
const crypto = require('crypto');

const KIWI_HOST = 'kiwi.chathispano.com';
const KIWI_PORTS = [9000, 9001, 9002, 9004];
const KIWI_PATH = '/webirc/kiwiirc/';
const KIWI_SERVER = `https://${KIWI_HOST}:9000${KIWI_PATH}`;

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m'
};

function log(type, msg) {
  const now = new Date().toLocaleTimeString();
  switch (type) {
    case 'info':
      console.log(`${colors.cyan}[${now}] ℹ ${msg}${colors.reset}`);
      break;
    case 'frame':
      console.log(`${colors.magenta}[${now}] 🔹 FRAME: ${msg}${colors.reset}`);
      break;
    case 'send':
      console.log(`${colors.yellow}[${now}] → SEND: ${msg}${colors.reset}`);
      break;
    case 'recv':
      console.log(`${colors.green}[${now}] ← RECV: ${msg}${colors.reset}`);
      break;
    case 'error':
      console.log(`${colors.red}[${now}] ✗ ERROR: ${msg}${colors.reset}`);
      break;
    case 'debug':
      console.log(`${colors.cyan}[${now}] 🐛 DEBUG: ${msg}${colors.reset}`);
      break;
  }
}

function _kiwiUrl(port) {
  const srv = String(Math.floor(Math.random() * 900) + 100);
  const session = crypto.randomBytes(8).toString('hex');
  return `wss://${KIWI_HOST}:${port}${KIWI_PATH}${srv}/${session}/websocket`;
}

async function debugConnection() {
  console.log(`\n${colors.bold}═══ IRC Connection Debug ═══${colors.reset}\n`);

  for (const port of KIWI_PORTS) {
    log('info', `Intentando puerto ${port}...`);
    
    try {
      const url = _kiwiUrl(port);
      log('debug', `URL: ${url}`);
      
      const ws = new WebSocket(url, {
        headers: {
          'Origin': 'https://chathispano.com',
          'Referer': 'https://chathispano.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        rejectUnauthorized: false
      });

      let buffer = '';
      let frameCount = 0;
      let ircMessageCount = 0;

      ws.on('open', () => {
        log('info', 'WebSocket abierto');
      });

      ws.on('message', (data) => {
        frameCount++;
        const frame = typeof data === 'string' ? data : data.toString('utf8');
        
        // Mostrar frame crudo
        log('frame', `#${frameCount}: "${frame}"`);

        // Parsear frame
        if (frame === 'o') {
          log('debug', 'Frame "o" - SockJS open, enviando CONTROL START...');
          
          ws.send(JSON.stringify([`:${KIWI_SERVER} CONTROL START`]));
          log('send', `[${KIWI_SERVER} CONTROL START]`);
          
          setTimeout(() => {
            log('debug', 'Enviando comandos de registro...');
            ws.send(JSON.stringify(['CAP LS 302\r\n']));
            log('send', 'CAP LS 302');
            
            ws.send(JSON.stringify(['NICK TestDebug\r\n']));
            log('send', 'NICK TestDebug');
            
            ws.send(JSON.stringify(['USER kiwi 0 * :DebugClient\r\n']));
            log('send', 'USER kiwi 0 * :DebugClient');
          }, 150);
        } else if (frame === 'h') {
          log('debug', 'Frame "h" - heartbeat');
        } else if (frame.startsWith('c')) {
          log('error', `SockJS close: ${frame}`);
          ws.terminate();
        } else if (frame.startsWith('a')) {
          // Mensajes IRC
          try {
            const msgs = JSON.parse(frame.slice(1));
            log('debug', `Recibidos ${msgs.length} mensaje(s) IRC`);
            
            for (const msg of msgs) {
              ircMessageCount++;
              buffer += msg;
              const lines = buffer.split('\r\n');
              buffer = lines.pop() || '';
              
              for (const line of lines) {
                if (line) {
                  log('recv', line);
                }
              }
            }
          } catch (e) {
            log('error', `No se puede parsear frame: ${e.message}`);
            log('debug', `Frame completo: ${frame}`);
          }
        } else {
          log('debug', `Frame desconocido: "${frame.slice(0, 50)}..."`);
        }
      });

      ws.on('close', (code) => {
        log('info', `WebSocket cerrado (code: ${code}), frames recibidos: ${frameCount}, mensajes IRC: ${ircMessageCount}`);
      });

      ws.on('error', (err) => {
        log('error', `WebSocket error: ${err.message}`);
      });

      // Esperar 20 segundos
      await new Promise((resolve) => {
        setTimeout(() => {
          log('info', 'Cerrando conexión...');
          ws.terminate();
          resolve();
        }, 20000);
      });

      return; // Éxito, salir

    } catch (err) {
      log('error', `Puerto ${port} falló: ${err.message}`);
    }
  }

  log('error', 'No se pudo conectar a ningún puerto');
}

debugConnection().catch(err => {
  log('error', `Excepción: ${err.message}`);
  process.exit(1);
});
