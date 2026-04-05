#!/usr/bin/env node
'use strict';

/**
 * ESTRATEGIA NUCLEAR: Usar Puppeteer para ver exactamente qué hace chathispano.com
 * - Abre la página en un navegador
 * - Intercepa WebSocket connections
 * - Captura cada frame enviado y recibido
 * - Muestra la URL exacta que conecta
 */

const puppeteer = require('puppeteer');

async function main() {
  console.log('Iniciando Puppeteer para analizar chathispano.com en tiempo real...\n');

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Logging de WebSocket
    let wsConnections = [];

    // Interceptar requests para ver WebSocket connections
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('websocket') || url.includes('webirc') || url.includes('kiwi')) {
        console.log(`[REQUEST] ${url}`);
      }
    });

    // Interceptar console messages
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('websocket') || text.includes('webirc') || text.includes('kiwi') || 
          text.includes('IRC') || text.includes('CONTROL')) {
        console.log(`[CONSOLE] ${text}`);
      }
    });

    console.log('Navegando a https://chathispano.com/...');
    await page.goto('https://chathispano.com/', { waitUntil: 'networkidle2', timeout: 30000 });

    console.log('Página cargada. Esperando 5 segundos por conexiones IRC...');
    await page.waitForTimeout(5000);

    // Ejecutar JavaScript en la página para obtener info
    const info = await page.evaluate(() => {
      const results = {
        location: window.location.href,
        scripts: document.querySelectorAll('script[src]').length,
        variables: []
      };

      // Buscar variables globales relacionadas con IRC
      const iocVars = ['chathispano', 'IRCClient', 'IRCHispanoChat', 'kiwi', 'irc', 'ws', 'websocket'];
      for (const varName of iocVars) {
        if (typeof window[varName] !== 'undefined') {
          results.variables.push({
            name: varName,
            type: typeof window[varName],
            keys: Object.keys(window[varName] || {}).slice(0, 10)
          });
        }
      }

      return results;
    });

    console.log('\n[PAGE INFO]');
    console.log(JSON.stringify(info, null, 2));

    // Intentar acceder a DevTools Protocol para ver WebSocket frames
    console.log('\nIntentando capturar WebSocket frames mediante CDP...');
    
    const cdpSession = await page.target().createCDPSession();
    await cdpSession.send('Network.enable');

    // Listener para eventos de red
    cdpSession.on('Network.webSocketCreated', (params) => {
      console.log(`[WebSocket CREATED] URL: ${params.url}`);
    });

    cdpSession.on('Network.webSocketFrameReceived', (params) => {
      const payload = params.response.payloadData || '';
      console.log(`[WebSocket RX] ${payload.substring(0, 100)}`);
    });

    cdpSession.on('Network.webSocketFrameSent', (params) => {
      const payload = params.response.payloadData || '';
      console.log(`[WebSocket TX] ${payload.substring(0, 100)}`);
    });

    console.log('Esperando 10 segundos por actividad WebSocket...');
    await page.waitForTimeout(10000);

    await browser.close();
  } catch (error) {
    console.error('Error:', error.message);
    if (browser) await browser.close();
    process.exit(1);
  }
}

// Verificar si Puppeteer está instalado
try {
  require.resolve('puppeteer');
  main();
} catch (e) {
  console.error('ERROR: Puppeteer no está instalado');
  console.error('Instala con: npm install --save-dev puppeteer');
  process.exit(1);
}
