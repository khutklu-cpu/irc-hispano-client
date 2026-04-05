#!/usr/bin/env node
'use strict';

/**
 * DEEP PROBE: Diagnostica exactamente qué está pasando con el proxy IRC
 * - Muestra TODOS los bytes recibidos en hex
 * - Envía de forma más lenta con más logging
 * - Extiende el timeout para dar más tiempo de respuesta
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
  const url = `wss://${KIWI_HOST}:${port}${KIWI_PATH}${srv}/${session}/websocket`;
  console.log(`[URL] ${url}`);
  return url;
}

async function probe(port) {
  return new Promise((resolve) => {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[PROBE] Puerto ${port}`);
    console.log(`${'='.repeat(70)}`);

    const url = kiwiUrl(port);
    let bytesReceived = 0;
    let frameCount = 0;
    let hasIrcData = false;
    const frames = [];

    const timeout = setTimeout(() => {
      console.log(`[TIMEOUT] Después de 30 segundos, cerrando...`);
      if (ws) ws.terminate();
      resolve({ port, timeout: true, frames, bytesReceived, frameCount, hasIrcData });
    }, 30000);

    const ws = new WebSocket(url, {
      headers: {
        Origin: 'https://chathispano.com',
        Referer: 'https://chathispano.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0',
        Accept: '*/*',
        'Accept-Language': 'es-ES,es;q=0.9',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache'
      },
      rejectUnauthorized: false
    });

    let sentControStart = false;
    let sentRegistration = false;
    let receivedOpen = false;

    ws.on('open', () => {
      console.log(`[OPEN] WebSocket abierto`);
    });

    ws.on('message', (data) => {
      const frame = typeof data === 'string' ? data : data.toString('utf8');
      bytesReceived += data.length;
      frameCount++;

      console.log(`[FRAME ${frameCount}] Length=${data.length} bytes`);
      console.log(`  Raw:  ${JSON.stringify(frame)}`);
      console.log(`  Hex:  ${Buffer.from(frame).toString('hex')}`);

      frames.push({ frame, length: data.length });

      // Frame 'o' = SockJS open
      if (frame === 'o') {
        receivedOpen = true;
        console.log(`[SockJS] Open frame recibido - enviando CONTROL START en 50ms...`);
        
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const msg = JSON.stringify([`:${KIWI_SERVER} CONTROL START`]);
            console.log(`[SEND] CONTROL START`);
            console.log(`  Raw:  ${msg}`);
            console.log(`  Hex:  ${Buffer.from(msg).toString('hex')}`);
            ws.send(msg);
            sentControStart = true;
            
            // Enviar registro después de más tiempo
            setTimeout(() => {
              console.log(`[SEND] Registración (CAP LS 302)`);
              const cap = JSON.stringify(['CAP LS 302\r\n']);
              console.log(`  Raw:  ${cap}`);
              ws.send(cap);
              
              setTimeout(() => {
                console.log(`[SEND] NICK TestDeep`);
                const nick = JSON.stringify(['NICK TestDeep\r\n']);
                console.log(`  Raw:  ${nick}`);
                ws.send(nick);
                
                setTimeout(() => {
                  console.log(`[SEND] USER kiwi 0 * :Test`);
                  const user = JSON.stringify(['USER kiwi 0 * :Test\r\n']);
                  console.log(`  Raw:  ${user}`);
                  ws.send(user);
                  sentRegistration = true;
                }, 150);
              }, 150);
            }, 200);
          }
        }, 50);
      }

      // Frame 'h' = heartbeat
      if (frame === 'h') {
        console.log(`[SockJS] Heartbeat`);
        return;
      }

      // Frame que comienza con 'c' = close
      if (frame.startsWith('c')) {
        console.log(`[SockJS] Close frame`);
        clearTimeout(timeout);
        ws.close();
        resolve({ port, timeout: false, frames, bytesReceived, frameCount, hasIrcData });
        return;
      }

      // Frame que comienza con 'a' = data con IRC messages
      if (frame.startsWith('a')) {
        console.log(`[SockJS] Data frame - CONTIENE DATOS IRC`);
        hasIrcData = true;
        try {
          const msgs = JSON.parse(frame.slice(1));
          console.log(`  Parsed: ${JSON.stringify(msgs)}`);
        } catch (e) {
          console.log(`  Error parsing: ${e.message}`);
        }
        return;
      }

      console.log(`[UNKNOWN] Frame type desconocido`);
    });

    ws.on('error', (err) => {
      console.log(`[ERROR] WebSocket error: ${err.message}`);
      clearTimeout(timeout);
      resolve({ port, error: err.message, frames, bytesReceived, frameCount, hasIrcData });
    });

    ws.on('close', (code, reason) => {
      console.log(`[CLOSE] WebSocket cerrado. Code: ${code}, Reason: ${reason}`);
      clearTimeout(timeout);
      if (!hasIrcData) {
        resolve({ port, timeout: false, closedEarly: true, frames, bytesReceived, frameCount, hasIrcData });
      }
    });
  });
}

async function main() {
  console.log(`DEEP PROBE: Diagnóstico detallado de conexión IRC`);
  console.log(`Probando puerto 9000 únicamente con logging exhaustivo...\n`);

  const result = await probe(9000);
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`RESULTADO FINAL`);
  console.log(`${'='.repeat(70)}`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
