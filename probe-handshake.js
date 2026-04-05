#!/usr/bin/env node
'use strict';

const { WebSocket } = require('ws');
const crypto = require('crypto');

const KIWI_HOST = 'kiwi.chathispano.com';
const KIWI_PORTS = [9000, 9001, 9002, 9004];
const KIWI_PATH = '/webirc/kiwiirc/';
const KIWI_SERVER = `https://${KIWI_HOST}:9000${KIWI_PATH}`;

const CONTROL_VARIANTS = [
  { name: 'A_colon_no_crlf', payload: () => `:${KIWI_SERVER} CONTROL START` },
  { name: 'B_colon_with_crlf', payload: () => `:${KIWI_SERVER} CONTROL START\r\n` },
  { name: 'C_no_colon_no_crlf', payload: () => `${KIWI_SERVER} CONTROL START` },
  { name: 'D_no_colon_with_crlf', payload: () => `${KIWI_SERVER} CONTROL START\r\n` },
  { name: 'E_plain_control', payload: () => 'CONTROL START' },
  { name: 'F_plain_control_crlf', payload: () => 'CONTROL START\r\n' }
];

function kiwiUrl(port) {
  const srv = String(Math.floor(Math.random() * 900) + 100);
  const session = crypto.randomBytes(8).toString('hex');
  return `wss://${KIWI_HOST}:${port}${KIWI_PATH}${srv}/${session}/websocket`;
}

function now() {
  return new Date().toLocaleTimeString();
}

function log(msg) {
  console.log(`[${now()}] ${msg}`);
}

function runAttempt(port, variant) {
  return new Promise((resolve) => {
    const url = kiwiUrl(port);
    const nick = `Probe${Math.floor(Math.random() * 9999)}`;

    let gotIrcData = false;
    let frameCount = 0;
    let closeCode = null;
    let closeReason = '';

    const ws = new WebSocket(url, {
      headers: {
        Origin: 'https://chathispano.com',
        Referer: 'https://chathispano.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: '*/*',
        'Accept-Language': 'es-ES,es;q=0.9',
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache'
      },
      rejectUnauthorized: false
    });

    const done = (result) => {
      try { ws.terminate(); } catch (_) {}
      resolve(result);
    };

    const timeout = setTimeout(() => {
      done({
        ok: gotIrcData,
        gotIrcData,
        frameCount,
        closeCode,
        closeReason,
        note: 'timeout'
      });
    }, 12000);

    ws.on('open', () => {
      log(`OPEN port=${port} variant=${variant.name}`);
    });

    ws.on('message', (data) => {
      const frame = typeof data === 'string' ? data : data.toString('utf8');
      frameCount += 1;

      if (frame === 'o') {
        const control = variant.payload();
        ws.send(JSON.stringify([control]));

        setTimeout(() => ws.send(JSON.stringify(['CAP LS 302\r\n'])), 120);
        setTimeout(() => ws.send(JSON.stringify([`NICK ${nick}\r\n`])), 220);
        setTimeout(() => ws.send(JSON.stringify(['USER kiwi 0 * :Probe Client\r\n'])), 320);
        return;
      }

      if (frame === 'h') return;

      if (frame.startsWith('a')) {
        try {
          const arr = JSON.parse(frame.slice(1));
          const raw = arr.join(' ');
          if (raw.includes(' 001 ') || raw.includes(' NOTICE ') || raw.includes(' CAP ') || raw.includes(' AUTH ')) {
            gotIrcData = true;
          }
        } catch (_) {}
      }

      if (frame.startsWith('c')) {
        closeReason = frame;
      }
    });

    ws.on('close', (code) => {
      clearTimeout(timeout);
      closeCode = code;
      done({
        ok: gotIrcData,
        gotIrcData,
        frameCount,
        closeCode,
        closeReason,
        note: 'closed'
      });
    });

    ws.on('error', (err) => {
      clearTimeout(timeout);
      done({
        ok: false,
        gotIrcData,
        frameCount,
        closeCode,
        closeReason: err.message,
        note: 'error'
      });
    });
  });
}

async function main() {
  log('Iniciando probe de handshake...');
  const results = [];

  for (const port of KIWI_PORTS) {
    for (const variant of CONTROL_VARIANTS) {
      const res = await runAttempt(port, variant);
      results.push({ port, variant: variant.name, ...res });
      log(`RESULT port=${port} variant=${variant.name} ok=${res.ok} irc=${res.gotIrcData} frames=${res.frameCount} close=${res.closeCode || '-'} note=${res.note}`);
    }
  }

  console.log('\nResumen:');
  for (const r of results) {
    console.log(`- port=${r.port} variant=${r.variant} ok=${r.ok} irc=${r.gotIrcData} frames=${r.frameCount} close=${r.closeCode || '-'} note=${r.note}`);
  }

  const winners = results.filter((r) => r.ok);
  console.log('\nGanadores:');
  if (!winners.length) {
    console.log('- Ninguno produjo datos IRC.');
  } else {
    winners.forEach((w) => {
      console.log(`- port=${w.port} variant=${w.variant}`);
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
