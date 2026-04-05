#!/usr/bin/env node
'use strict';

const fs = require('fs');

const html = fs.readFileSync('/tmp/chathispano-source.html', 'utf8');

console.log('Análisis exhaustivo del HTML...\n');

// 1. Búsqueda por TODOS los patrones posibles de puerto
console.log('='.repeat(70));
console.log('1. BUSCANDO NÚMEROS DE PUERTO EN CUALQUIER CONTEXTO');
console.log('='.repeat(70));

const portRegex = /:\d{4}(?:[\/"]|(?:[\s,}]))/g;
const ports = html.match(portRegex) || [];
console.log(`Encontrados: ${ports.length} puertos`);
[...new Set(ports)].forEach(p => console.log(`  ${p}`));

// 2. Búsqueda por ANY mención de "kiwi"
console.log('\n' + '='.repeat(70));
console.log('2. TODAS LAS MENCIONES DE "kiwi" (case insensitive)');
console.log('='.repeat(70));

const kiwiRegex = /[^\w]*kiwi[^\w]*/gi;
const kiwiMatches = html.match(kiwiRegex) || [];
const uniqueKiwi = [...new Set(kiwiMatches)];
console.log(`Encontradas: ${uniqueKiwi.length} menciones`);
uniqueKiwi.slice(0, 20).forEach(m => console.log(`  "${m.trim()}"`));

// 3. Búsqueda por "9000", "9001", "9002", "9004" específicamente
console.log('\n' + '='.repeat(70));
console.log('3. PUERTOS ESPECÍFICOS DE KIWI');
console.log('='.repeat(70));

[9000, 9001, 9002, 9004].forEach(port => {
  const regex = new RegExp(`\\b${port}\\b`, 'g');
  const matches = html.match(regex) || [];
  if (matches.length > 0) {
    console.log(`✓ Puerto ${port}: ${matches.length} menciones`);
    // Mostrar contexto
    const idx = html.indexOf(port.toString());
    if (idx !== -1) {
      console.log(`  Contexto: ...${html.substring(idx - 50, idx + 50)}...`);
    }
  }
});

// 4. Buscar ANY URL que empiece con wss:// o ws://
console.log('\n' + '='.repeat(70));
console.log('4. TODAS LAS URLs WebSocket (wss://, ws://)');
console.log('='.repeat(70));

const wsRegex = /wss?:\/\/[^\s"'<>]+/gi;
const wsUrls = html.match(wsRegex) || [];
const uniqueWs = [...new Set(wsUrls)];
console.log(`Encontradas: ${uniqueWs.length} URLs`);
uniqueWs.forEach(url => console.log(`  ${url}`));

// 5. Buscar configuraciones JSON que podrían contener URLs
console.log('\n' + '='.repeat(70));
console.log('5. OBJETOS JSON QUE MENCIONAN "url", "proxy", "server", "socket"');
console.log('='.repeat(70));

const jsonObjectPatterns = [
  /\{[^}]*"(?:url|proxy|server|socket|endpoint)"[^}]*\}/gi,
  /\{[^}]*(?:url|proxy|server|socket|endpoint)[^}]*\}/gi
];

jsonObjectPatterns.forEach((pattern, idx) => {
  const matches = html.match(pattern) || [];
  if (matches.length > 0) {
    console.log(`\nPatrón ${idx + 1}: ${matches.length} matches`);
    matches.slice(0, 3).forEach(m => {
      console.log(`  ${m.substring(0, 150)}...`);
    });
  }
});

// 6. Búsqueda por palabra completa "webirc"
console.log('\n' + '='.repeat(70));
console.log('6. BÚSQUEDA DE "webirc"');
console.log('='.repeat(70));

const webircIdx = html.indexOf('webirc');
if (webircIdx !== -1) {
  console.log(`✓ Encontrado en posición ${webircIdx}`);
  console.log(`  Contexto: ${html.substring(webircIdx - 100, webircIdx + 150)}`);
} else {
  console.log('✗ NO encontrado');
}

// 7. Variables JavaScript globales que podrían contener configuración
console.log('\n' + '='.repeat(70));
console.log('7. PATRONES DE ASIGNACIÓN DE VARIABLES');
console.log('='.repeat(70));

const varPatterns = [
  /var\s+\w*(?:irc|chat|socket|kiwi|proxy)\w*\s*=\s*[{"\w]/gi,
  /const\s+\w*(?:irc|chat|socket|kiwi|proxy)\w*\s*=\s*[{"\w]/gi,
  /\w*(?:irc|chat|socket|kiwi|proxy)\w*\s*:\s*[{"\w]/gi
];

varPatterns.forEach((pattern, idx) => {
  const matches = html.match(pattern) || [];
  if (matches.length > 0) {
    console.log(`\nPatrón ${idx + 1}: ${matches.length} matches`);
    matches.slice(0, 5).forEach(m => {
      console.log(`  ${m}`);
    });
  }
});

console.log('\n' + '='.repeat(70));
console.log('RESUMEN: Si ninguno de los anteriores encontró configuración,');
console.log('significa que la conexión IRC se establece DINÁMICAMENTE');
console.log('(probablemente en JavaScript que se ejecuta en el navegador)');
console.log('='.repeat(70));
