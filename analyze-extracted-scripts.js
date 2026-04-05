#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

// Listar archivos en /tmp/
const tmpFiles = fs.readdirSync('/tmp/').filter(f => f.startsWith('chathispano-script'));
console.log(`Encontrados ${tmpFiles.length} scripts extraídos:\n`);

tmpFiles.forEach(filename => {
  const filepath = path.join('/tmp/', filename);
  const content = fs.readFileSync(filepath, 'utf8');
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`FILE: ${filename} (${content.length} bytes)`);
  console.log(`${'='.repeat(70)}`);
  
  // Si es muy largo, mostrar solo primeros 500 chars y búsquedas específicas
  if (content.length > 2000) {
    console.log('[PREVIEW - First 500 chars]');
    console.log(content.substring(0, 500));
    console.log('...\n');
    
    // Buscar palabras clave en el contenido largo
    const keywords = [
      'webirc', 'kiwi', 'websocket', 'WebSocket', 'NICK', 'CAP LS', 
      'CONTROL START', 'USER ', 'irc.', 'chatsocket', 'connect'
    ];
    
    console.log('[PALABRAS CLAVE ENCONTRADAS]');
    keywords.forEach(kw => {
      if (content.toLowerCase().includes(kw.toLowerCase())) {
        // Encontrar el índice y mostrar contexto
        const idx = content.toLowerCase().indexOf(kw.toLowerCase());
        const start = Math.max(0, idx - 100);
        const end = Math.min(content.length, idx + 200);
        const context = content.substring(start, end);
        console.log(`\n  "${kw}" found at position ${idx}:`);
        console.log(`  ...${context}...`);
      }
    });
  } else {
    console.log(content);
  }
});

// También buscar en el HTML directamente por patrones específicos
console.log(`\n${'='.repeat(70)}`);
console.log('BÚSQUEDA DIRECTA EN HTML POR PATRONES ESPECÍFICOS');
console.log(`${'='.repeat(70)}`);

const html = fs.readFileSync('/tmp/chathispano-source.html', 'utf8');

// Buscar la palabra clave CRITICAL: número de puerto 
console.log('\n[Buscando números de puerto]');
const portMatches = html.match(/:\d{4}[\/"]/g) || [];
const uniquePorts = [...new Set(portMatches)];
console.log(`Puertos encontrados: ${uniquePorts.join(', ')}`);

// Buscar URLs completas que mencionen kiwi
console.log('\n[Buscando URLs de kiwi]');
const kiwiUrls = html.match(/wss?:\/\/[^"\s]*kiwi[^"\s]*/gi) || [];
kiwiUrls.forEach(url => console.log(`  ${url}`));

// Buscar la ruta /webirc/
console.log('\n[Buscando URLs con /webirc/]');
const webircPaths = html.match(/\/webirc\/[^"\s]*/g) || [];
const uniqueWebircPaths = [...new Set(webircPaths)];
uniqueWebircPaths.forEach(path => console.log(`  ${path}`));
