#!/usr/bin/env node
'use strict';

/**
 * TEST: Enviar CONTROL START como RAW text, no como JSON array
 * Teoría: Quizás CONTROL START es un comando de protocolo SockJS, no un IRC message
 */

const { WebSocket } = require('ws');
const crypto = require('crypto');

const KIWI_HOST = 'kiwi.chathispano.com';
const KIWI_PORTS = [9000, 9001, 9002, 9004];
const KIWI_PATH = '/webirc/kiwiirc/';
const KIWI_SERVER = `https://${KIWI_HOST}:9000${KIWI_PATH}`;

function kiwiUrl(port) {
  const srv = String(Math.floor(Math.random() * 900) + 100);
  const session = crypto.randomBytes(8).toString('hex');
  return `wss://${KIWI_HOST}:${port}${KIWI_PATH}${srv}/${session}/websocket`;
}

async function testVariant(name, sendRaw) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[TEST] ${name}`);
    console.log(`${'='.repeat(70)}`);

    const url = kiwiUrl(9000);
    let receivedOpen = false;
    let receivedIrcData = false;
    const frames = [];

    const timeout = setTimeout(() => {
      console.log(`[TIMEOUT] 20 segundos sin respuesta`);
      if (ws) ws.terminate();
      resolve({ name, receivedOpen, receivedIrcData, frames: frames.length });
    }, 20000);

    const ws = new WebSocket(url, {
      headers: {
        Origin: 'https://chathispano.com',
        Referer: 'https://chathispano.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
        Accept: '*/*',
        'Accept-Language': 'es-ES,es;q=0.9',
      },
      rejectUnauthorized: false
    });

    ws.on('message', (data) => {
      const frame = typeof data === 'string' ? data : data.toString('utf8');
      frames.push(frame);

      console.log(`[RX] ${frame.substring(0, 50)}`);

      if (frame === 'o') {
        receivedOpen = true;
        console.log(`[SockJS OPEN] Enviando CONTROL START...`);
        
        setTimeout(() => {
          if (sendRaw) {
            console.log(`[TX] RAW: ${KIWI_SERVER} CONTROL START`);
            ws.send(`${KIWI_SERVER} CONTROL START`);
          } else {
            const msg = JSON.stringify([`:${KIWI_SERVER} CONTROL START`]);
            console.log(`[TX] JSON: [":${KIWI_SERVER} CONTROL START"]`);
            ws.send(msg);
          }

          setTimeout(() => {
            console.log(`[TX] Cap: ${JSON.stringify(['CAP LS 302\r\n'])}`);
            ws.send(JSON.stringify(['CAP LS 302\r\n']));
            
            setTimeout(() => {
              console.log(`[TX] Nick: ${JSON.stringify(['NICK Test\r\n'])}`);
              ws.send(JSON.stringify(['NICK Test\r\n']));
              
              setTimeout(() => {
                console.log(`[TX] User: ${JSON.stringify(['USER kiwi 0 * :Test\r\n'])}`);
                ws.send(JSON.stringify(['USER kiwi 0 * :Test\r\n']));
              }, 100);
            }, 100);
          }, 100);
        }, 50);
      }

      if (frame.startsWith('a')) {
        console.log(`[IRC DATA RECEIVED!] ${frame.substring(0, 100)}`);
        receivedIrcData = true;
        clearTimeout(timeout);
        ws.close();
        resolve({ name, receivedOpen, receivedIrcData, frames: frames.length });
      }
    });

    ws.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ name, receivedOpen, receivedIrcData, frames: frames.length, closed: code });
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ name, error: err.message });
    });
  });
}

async function main() {
  console.log(`TEST: CONTROL START Variants`);
  console.log(`Comparando: JSON array vs RAW text\n`);

  const result1 = await testVariant('CONTROL START as JSON array', false);
  const result2 = await testVariant('CONTROL START as RAW text', true);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`RESULTADOS`);
  console.log(`${'='.repeat(70)}`);
  console.log('JSON Array:', result1);
  console.log('RAW Text:  ', result2);

  if (result2.receivedIrcData && !result1.receivedIrcData) {
    console.log(`\n✓ ¡EUREKA! RAW text funciona - CONTROL START debe ser raw, no JSON`);
  } else if (result1.receivedIrcData && !result2.receivedIrcData) {
    console.log(`\n✓ JSON array funciona - el formato actual es correcto`);
  } else {
    console.log(`\nNinguno recibió datos IRC - el problema está en otro lado`);
  }
}

main().catch(console.error);
