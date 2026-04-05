#!/usr/bin/env node
'use strict';

/**
 * HYPOTHESIS TEST: Quizás CONTROL START no es necesario
 * Intenta registrarse directamente con CAP/NICK/USER sin mandar CONTROL START
 */

const { WebSocket } = require('ws');
const crypto = require('crypto');

const KIWI_HOST = 'kiwi.chathispano.com';
const KIWI_PATH = '/webirc/kiwiirc/';

function kiwiUrl(port) {
  const srv = String(Math.floor(Math.random() * 900) + 100);
  const session = crypto.randomBytes(8).toString('hex');
  return `wss://${KIWI_HOST}:${port}${KIWI_PATH}${srv}/${session}/websocket`;
}

async function test() {
  return new Promise((resolve) => {
    console.log('TEST: Conexión SIN CONTROL START');
    console.log('Hipótesis: CONTROL START no es necesario, o el proxy lo ignora');

    const url = kiwiUrl(9000);
    let receivedOpen = false;
    let receivedIrcData = false;
    const allFrames = [];

    const timeout = setTimeout(() => {
      console.log(`\n[TIMEOUT] 25 segundos sin datos IRC`);
      if (ws) ws.terminate();
      resolve({ receivedIrcData, frames: allFrames });
    }, 25000);

    const ws = new WebSocket(url, {
      headers: {
        Origin: 'https://chathispano.com',
        Referer: 'https://chathispano.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
      },
      rejectUnauthorized: false
    });

    ws.on('message', (data) => {
      const frame = typeof data === 'string' ? data : data.toString('utf8');
      allFrames.push(frame.substring(0, 100));

      if (frame === 'o') {
        receivedOpen = true;
        console.log(`[RX] SockJS OPEN`);
        
        // SIN CONTROL START, envía directamente CAP
        console.log(`[TX] Enviando directamente CAP LS 302 (sin CONTROL START previamente)`);
        setTimeout(() => {
          ws.send(JSON.stringify(['CAP LS 302\r\n']));
          console.log(`[TX] NICK TestNoControl`);
          setTimeout(() => {
            ws.send(JSON.stringify(['NICK TestNoControl\r\n']));
            console.log(`[TX] USER kiwi 0 * :Test`);
            setTimeout(() => {
              ws.send(JSON.stringify(['USER kiwi 0 * :Test\r\n']));
            }, 100);
          }, 100);
        }, 100);
      }

      if (frame === 'h') {
        console.log(`[RX] Heartbeat`);
      }

      if (frame.startsWith('a')) {
        console.log(`[RX] *** IRC DATA RECEIVED ***`);
        console.log(`[RX] ${frame.substring(0, 200)}`);
        receivedIrcData = true;
        clearTimeout(timeout);
        ws.close();
        resolve({ receivedIrcData, frames: allFrames });
      }

      if (frame.startsWith('c')) {
        console.log(`[RX] SockJS CLOSE`);
        clearTimeout(timeout);
        resolve({ receivedIrcData, frames: allFrames });
      }
    });

    ws.on('error', (err) => {
      console.log(`[ERROR] ${err.message}`);
      clearTimeout(timeout);
      resolve({ error: true, frames: allFrames });
    });

    ws.on('close', (code) => {
      console.log(`[CLOSE] Code ${code}`);
      clearTimeout(timeout);
    });
  });
}

test().then(result => {
  console.log(`\n${'='.repeat(70)}`);
  console.log('RESULTADO:');
  console.log(`${'='.repeat(70)}`);
  if (result.receivedIrcData) {
    console.log('✓ ¡FUNCIONA! Sin CONTROL START podemos recibir datos IRC');
  } else {
    console.log('✗ Sin CONTROL START tampoco funciona');
  }
  console.log(`Frames recibidos: ${result.frames.length}`);
  console.log(`Frames: ${result.frames}`);
});
