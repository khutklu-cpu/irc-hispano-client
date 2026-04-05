#!/usr/bin/env node
'use strict';

const fs = require('fs');

const html = fs.readFileSync('/tmp/chathispano-source.html', 'utf8');

console.log('Buscando IRCHispanoChat y código relacionado...\n');

// Buscar dónde se define IRCHispanoChat
const ircHispanoChatIndex = html.indexOf('IRCHispanoChat');
if (ircHispanoChatIndex !== -1) {
  console.log(`\n✓ FOUND: IRCHispanoChat at position ${ircHispanoChatIndex}`);
  
  // Ver contexto alrededor
  const start = Math.max(0, ircHispanoChatIndex - 500);
  const end = Math.min(html.length, ircHispanoChatIndex + 3000);
  const context = html.substring(start, end);
  
  console.log(`\n${'='.repeat(70)}`);
  console.log('CONTEXTO DE IRCHispanoChat:');
  console.log(`${'='.repeat(70)}`);
  console.log(context);
  console.log(`${'='.repeat(70)}\n`);
}

// Buscar el objeto completo
const objectMatch = html.match(/IRCHispanoChat\s*=\s*\{[^}]+\}/);
if (objectMatch) {
  console.log(`\n✓ FOUND: IRCHispanoChat object`);
  console.log(objectMatch[0]);
}

// Buscar configuración JSON
const jsonMatch = html.match(/\{[\s\S]*?"kiwi"[\s\S]*?"webirc"[\s\S]*?\}/);
if (jsonMatch) {
  console.log(`\n✓ FOUND: JSON config with kiwi and webirc`);
  console.log(jsonMatch[0].substring(0, 500));
}

// Buscar cualquier línea que contenga tanto "kiwi" como "webirc"
console.log(`\n${'='.repeat(70)}`);
console.log('LÍNEAS CON "kiwi" Y "webirc":');
console.log(`${'='.repeat(70)}`);
const lines = html.split('\n');
lines.forEach((line, idx) => {
  if (line.includes('kiwi') && line.includes('webirc')) {
    console.log(`Line ${idx}: ${line.substring(0, 150)}`);
  }
});

// Buscar la palabra START en contexto
console.log(`\n${'='.repeat(70)}`);
console.log('CONTEXTO ALREDEDOR DE "START":');
console.log(`${'='.repeat(70)}`);
const startIndex = html.indexOf('START');
if (startIndex !== -1) {
  const startContext = html.substring(
    Math.max(0, startIndex - 200),
    Math.min(html.length, startIndex + 200)
  );
  console.log(startContext);
}

// Buscar NICK en contexto
console.log(`\n${'='.repeat(70)}`);
console.log('CONTEXTO ALREDEDOR DE "NICK":');
console.log(`${'='.repeat(70)}`);
const nickIndex = html.indexOf('NICK');
if (nickIndex !== -1) {
  const nickContext = html.substring(
    Math.max(0, nickIndex - 200),
    Math.min(html.length, nickIndex + 200)
  );
  console.log(nickContext);
}

// Extraer todos los inline scripts y guardarlos
console.log(`\n${'='.repeat(70)}`);
console.log('EXTRAYENDO INLINE SCRIPTS...');
console.log(`${'='.repeat(70)}`);

const scriptMatches = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
scriptMatches.forEach((script, idx) => {
  const content = script.replace(/<script[^>]*>/, '').replace(/<\/script>/, '');
  
  // Solo guardar si tiene contenido sustancial (>100 caracteres) y menciona palabras clave
  if (content.length > 100 && (
    content.includes('kiwi') || 
    content.includes('WebSocket') || 
    content.includes('IRC') ||
    content.includes('chat')
  )) {
    const filename = `/tmp/chathispano-script-${idx}.js`;
    fs.writeFileSync(filename, content);
    console.log(`✓ Guardado: ${filename} (${content.length} bytes)`);
  }
});

// Buscar una línea que sea especialmente larga (probablemente sea minificada)
console.log(`\n${'='.repeat(70)}`);
console.log('LÍNEAS LARGAS (probablemente código minificado):');
console.log(`${'='.repeat(70)}`);
lines.filter(line => line.length > 1000).forEach((line, idx) => {
  const searchIdx = lines.indexOf(line);
  console.log(`Line ${searchIdx}: ${line.substring(0, 200)}...`);
});
