#!/usr/bin/env node
'use strict';

const fs = require('fs');

const html = fs.readFileSync('/tmp/chathispano-source.html', 'utf8');

console.log('Analizando HTML descargado...\n');

// Buscar scripts externos
const externalScripts = html.match(/<script\s+src="([^"]+)"/g) || [];
console.log(`\n${'='.repeat(70)}`);
console.log('EXTERNAL SCRIPTS:');
console.log(`${'='.repeat(70)}`);
externalScripts.forEach(s => {
  const match = s.match(/src="([^"]+)"/);
  if (match) {
    console.log(`  ${match[1]}`);
  }
});

// Buscar inline scripts
const inlineScriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
console.log(`\nEncontrados ${inlineScriptMatches.length} inline scripts`);

// Para cada inline script, busca líneas con palabras clave
console.log(`\n${'='.repeat(70)}`);
console.log('INLINE SCRIPTS CON PALABRAS CLAVE:');
console.log(`${'='.repeat(70)}`);

const keywords = ['CONTROL START', 'webirc/', 'kiwi.chathispano', 'WebSocket', 'CAP LS', 'NICK', 'USER '];

inlineScriptMatches.forEach((script, idx) => {
  const hasKeyword = keywords.some(kw => script.includes(kw));
  if (hasKeyword) {
    console.log(`\n[INLINE SCRIPT ${idx}]`);
    const lines = script.split('\n');
    lines.forEach((line, lIdx) => {
      if (keywords.some(kw => line.includes(kw))) {
        // Limpiar y mostrar
        const cleaned = line.replace(/<[^>]+>/g, '').substring(0, 150);
        if (cleaned.trim()) {
          console.log(`  L${lIdx}: ${cleaned}`);
        }
      }
    });
  }
});

// Buscar todo lo que mire "kiwi"
console.log(`\n${'='.repeat(70)}`);
console.log('TODAS LAS REFERENCIAS A "KIWI":');
console.log(`${'='.repeat(70)}`);
const kiwiRegex = /[^\w]kiwi[^\w<]*/gi;
const kiwiMatches = html.match(kiwiRegex) || [];
const uniqueKiwi = [...new Set(kiwiMatches)].slice(0, 20);
uniqueKiwi.forEach(k => console.log(`  "${k.trim()}"`));

// Buscar URLs que mencionan webirc
console.log(`\n${'='.repeat(70)}`);
console.log('URLS CON "WEBIRC":');
console.log(`${'='.repeat(70)}`);
const webircUrls = html.match(/[^"\s]*webirc[^"\s]*/gi) || [];
const uniqueUrls = [...new Set(webircUrls)];
uniqueUrls.forEach(u => console.log(`  ${u}`));

// Buscar la palabra CONTROL en cualquier contexto
console.log(`\n${'='.repeat(70)}`);
console.log('REFERENCIAS A "CONTROL":');
console.log(`${'='.repeat(70)}`);
const controlMatches = html.match(/[^\s]*CONTROL[^\s]*/g) || [];
const uniqueControl = [...new Set(controlMatches)];
uniqueControl.slice(0, 10).forEach(c => console.log(`  ${c}`));

// Intentar encontrar la URL de WebSocket real usada
console.log(`\n${'='.repeat(70)}`);
console.log('URLS CON WSS://');
console.log(`${'='.repeat(70)}`);
const wssUrls = html.match(/wss:\/\/[^\s"']+/g) || [];
const uniqueWss = [...new Set(wssUrls)];
uniqueWss.forEach(u => console.log(`  ${u}`));

// Buscar configuración JSON que podría contener IRC config
console.log(`\n${'='.repeat(70)}`);
console.log('VARIABLES CON "irc", "chat", "socket":');
console.log(`${'='.repeat(70)}`);
const configMatches = html.match(/[\w]*(?:irc|chat|socket|proxy|kiwi)[:\s]*[\{\"\']/gi) || [];
const uniqueConfig = [...new Set(configMatches)].slice(0, 15);
uniqueConfig.forEach(c => console.log(`  ${c}`));

console.log('\nHTML completo: cat /tmp/chathispano-source.html');
console.log(`HTML tamaño: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
