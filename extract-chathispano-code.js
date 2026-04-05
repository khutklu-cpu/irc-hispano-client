#!/usr/bin/env node
'use strict';

/**
 * EXTRACT: Descarga chathispano.com y extrae el código JavaScript de conexión IRC
 * Busca referencias a "CONTROL START", "kiwi", WebSocket, SockJS
 */

const https = require('https');
const fs = require('fs');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  console.log('Descargando https://chathispano.com/...');
  
  const html = await httpsGet('https://chathispano.com/');
  
  // Buscar referencias a JavaScript files
  const scriptMatches = html.match(/<script\s+src="([^"]+)"/g) || [];
  console.log(`\nEncontrados ${scriptMatches.length} scripts:`);
  scriptMatches.forEach(m => console.log(`  ${m}`));

  // Buscar CONTROL START en el HTML
  if (html.includes('CONTROL START')) {
    console.log('\n✓ FOUND: "CONTROL START" en HTML inline');
    const start = html.indexOf('CONTROL START');
    console.log(`  Context: ${html.substring(Math.max(0, start - 100), start + 150)}`);
  }

  // Buscar kiwi en el HTML
  const kiwiMatches = html.match(/kiwi[^<\s]*/gi) || [];
  if (kiwiMatches.length > 0) {
    console.log(`\n✓ FOUND: ${kiwiMatches.length} referencias a "kiwi"`);
    console.log(`  ${[...new Set(kiwiMatches)].slice(0, 5).join(', ')}`);
  }

  // Buscar WebSocket en el HTML
  if (html.includes('WebSocket') || html.includes('websocket')) {
    console.log('\n✓ FOUND: WebSocket en HTML');
  }

  // Extractar inline scripts grandes (probablemente sea IRC connection code)
  const inlineScripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
  console.log(`\nEncontrados ${inlineScripts.length} inline scripts`);

  // Buscar líneas que mencionen CONTROL, START, NICK, USER, CAP en inline scripts
  inlineScripts.forEach((script, idx) => {
    if (script.includes('CONTROL') || script.includes('NICK') || script.includes('CAP LS')) {
      const lines = script.split('\n');
      console.log(`\n[SCRIPT ${idx}] Líneas relevantes:`);
      lines.forEach((line, lineIdx) => {
        if (line.includes('CONTROL') || line.includes('NICK') || line.includes('CAP') || 
            line.includes('USER ') || line.includes('kiwi') || line.includes('webirc')) {
          console.log(`  L${lineIdx}: ${line.substring(0, 120)}`);
        }
      });
    }
  });

  // Guardar HTML completo para inspección manual
  fs.writeFileSync('/tmp/chathispano-source.html', html);
  console.log(`\nHTML completo guardado en /tmp/chathispano-source.html (${html.length} bytes)`);

  // Buscar patrones específicos de conexión
  console.log(`\n${'='.repeat(70)}`);
  console.log('ANÁLISIS DE PATRONES IRC:');
  console.log(`${'='.repeat(70)}`);

  const patterns = {
    'new WebSocket': html.match(/new\s+WebSocket\([^)]+\)/g),
    'wss://': html.match(/wss:\/\/[^\s"']+/g),
    'webirc/': html.match(/webirc\/[^\s"']+/g),
    'CONTROL START': html.match(/CONTROL\s+START[^\n]*/g),
    'CAP LS': html.match(/CAP\s+LS[^\n]*/g),
  };

  Object.entries(patterns).forEach(([name, matches]) => {
    if (matches && matches.length > 0) {
      console.log(`\n✓ ${name}:`);
      matches.slice(0, 3).forEach(m => {
        console.log(`  ${m.substring(0, 100)}`);
      });
    }
  });
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
