#!/usr/bin/env node
/**
 * Script de prueba: Validar conexión IRC
 * Uso: node test-irc-connection.js
 * 
 * Prueba los siguientes aspectos:
 * 1. Conexión al proxy KiwiIRC
 * 2. Registro como invitado
 * 3. Unión a canal
 * 4. Envío de mensaje
 * 5. Recepción de respuestas
 */

'use strict';

const { IRCClient } = require('./lib/irc');

const colors = {
  reset:   '\x1b[0m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  bold:    '\x1b[1m'
};

const log = {
  info:    (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
  ok:      (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
  warn:    (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error:   (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
  section: (msg) => console.log(`\n${colors.bold}${colors.cyan}═══ ${msg} ═══${colors.reset}\n`)
};

let testsPassed = 0;
let testsFailed = 0;
let client = null;
let testTimeout = null;

function conclude(success, message) {
  clearTimeout(testTimeout);
  if (client) {
    try { client.destroy(); } catch (_) {}
  }
  
  console.log('\n' + colors.bold + '═══════════════════════════════════' + colors.reset);
  if (success) {
    log.ok(`Pruebas completadas: ${testsPassed} OK, ${testsFailed} fallos`);
    if (testsFailed === 0) {
      log.ok('Conexión IRC operativa ✓');
      process.exit(0);
    }
  } else {
    log.error(`Pruebas fallidas: ${testsFailed} errores`);
  }
  process.exit(testsFailed > 0 ? 1 : 0);
}

async function runTests() {
  log.section('PRUEBA DE CONEXIÓN IRC - irc-hispano-client');
  log.info('Iniciando pruebas de conexión al proxy KiwiIRC...\n');

  // Timeout global de 60 segundos
  testTimeout = setTimeout(() => {
    log.error('TIMEOUT: Prueba tardó demasiado');
    testsFailed++;
    conclude(false);
  }, 60000);

  try {
    const proxyPool = String(process.env.SOCKS_POOL || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((item) => {
        try {
          const u = new URL(item);
          if (!/^socks4:|^socks5:/i.test(u.protocol)) return null;
          const host = u.hostname;
          const port = parseInt(u.port, 10);
          if (!host || !(port >= 1 && port <= 65535)) return null;
          return {
            host,
            port,
            type: /^socks4:/i.test(u.protocol) ? 4 : 5,
            username: u.username ? decodeURIComponent(u.username) : undefined,
            password: u.password ? decodeURIComponent(u.password) : undefined
          };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);

    const proxyHost = (process.env.SOCKS_HOST || '').trim();
    const proxyPort = parseInt(process.env.SOCKS_PORT || '0', 10);
    const proxyUser = (process.env.SOCKS_USER || '').trim();
    const proxyPass = (process.env.SOCKS_PASS || '').trim();

    const proxy = (proxyHost && proxyPort > 0)
      ? {
          host: proxyHost,
          port: proxyPort,
          type: 5,
          username: proxyUser || undefined,
          password: proxyPass || undefined
        }
      : null;

    if (proxyPool.length > 0) {
      log.info(`Usando pool SOCKS (${proxyPool.length} salidas) para la prueba`);
    } else if (proxy) {
      log.info(`Usando SOCKS5 ${proxy.host}:${proxy.port} para la prueba`);
    }

    client = new IRCClient({
      proxy: proxy || proxyPool[0] || null,
      proxies: proxyPool.length > 0 ? proxyPool : (proxy ? [proxy] : [])
    });
    let connectedNick = null;
    
    // Eventos de estado
    client.on('status', (msg) => {
      log.info(`[Status] ${msg}`);
    });

    client.on('connected', (nick) => {
      connectedNick = nick;
    });

    client.on('error', (msg) => {
      log.error(`[Error] ${msg}`);
      testsFailed++;
    });

    client.on('raw_in', (msg) => {
      console.log(`  ← ${msg.slice(0, 100)}`);
    });

    client.on('raw_out', (msg) => {
      console.log(`  → ${msg.slice(0, 100)}`);
    });

    // Test 1: Conectar
    log.section('TEST 1: Conectar al proxy KiwiIRC');
    log.info('Intentando conexión...');
    
    await client.connect();
    log.ok('Conexión WebSocket establecida');
    testsPassed++;

    // Test 2: Esperar registro
    log.section('TEST 2: Registro como invitado');

    if (client.connected || connectedNick) {
      log.ok(`Registrado con nick: ${colors.bold}${connectedNick || client.nick}${colors.reset}`);
      testsPassed++;
    } else {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          log.error('Timeout en registro');
          testsFailed++;
          resolve();
        }, 15000);

        const onConnected = (nick) => {
          clearTimeout(timeout);
          log.ok(`Registrado con nick: ${colors.bold}${nick}${colors.reset}`);
          testsPassed++;
          client.off('connected', onConnected);
          resolve();
        };

        client.on('connected', onConnected);
      });
    }

    // Test 3: Unirse a canal de prueba
    log.section('TEST 3: Unirse a canal (#hispano)');
    
    const joinPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log.warn('Timeout esperando JOIN (canal puede no aceptar)');
        resolve();
      }, 10000);

      const handleJoin = (data) => {
        if (data.channel === '#hispano' && data.self) {
          clearTimeout(timeout);
          log.ok(`Unido a canal: ${colors.bold}#hispano${colors.reset}`);
          testsPassed++;
          client.off('join', handleJoin);
          resolve();
        }
      };

      client.on('join', handleJoin);
      client.join('#hispano');
    });

    await joinPromise;

    // Test 4: Enviar mensaje
    log.section('TEST 4: Enviar mensaje de prueba');
    log.info('Enviando: "Test desde irc-hispano-client"');
    
    const msgPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => {
        log.warn('No se recibió echo del mensaje (posible moderación)');
        resolve();
      }, 8000);

      const handleMsg = (data) => {
        if (data.target === '#hispano' && data.from === client.nick) {
          clearTimeout(timeout);
          log.ok(`Mensaje enviado y recibido: "${data.text}"`);
          testsPassed++;
          client.off('message', handleMsg);
          resolve();
        }
      };

      client.on('message', handleMsg);
      client.privmsg('#hispano', 'Test desde irc-hispano-client');
    });

    await msgPromise;

    // Test 5: Monitorear conexión
    log.section('TEST 5: Estabilidad de conexión');
    log.info('Manteniendo conexión por 10 segundos...');
    
    let eventsReceived = 0;
    const eventHandler = () => eventsReceived++;
    
    client.on('message', eventHandler);
    client.on('join', eventHandler);
    client.on('part', eventHandler);
    client.on('connected', eventHandler);

    await new Promise((resolve) => {
      setTimeout(() => {
        if (client.connected) {
          log.ok(`Conexión estable (${eventsReceived} eventos IRC recibidos)`);
          testsPassed++;
        } else {
          log.error('Conexión perdida durante test');
          testsFailed++;
        }
        resolve();
      }, 10000);
    });

    client.off('message', eventHandler);
    client.off('join', eventHandler);
    client.off('part', eventHandler);
    client.off('connected', eventHandler);

    // Resumen
    log.section('RESUMEN');
    conclude(testsFailed === 0);

  } catch (err) {
    log.error(`Excepción: ${err.message}`);
    if (/ENOTFOUND|EAI_AGAIN/i.test(String(err.message || ''))) {
      log.info('Tip: en SOCKS_POOL usa hosts reales, no valores de ejemplo como proxy1/proxy2/proxy3');
      log.info('Formato: SOCKS_POOL=socks5://ip-real:puerto,socks5://usuario:clave@ip-real:puerto');
    }
    if (!process.env.SOCKS_HOST && !process.env.SOCKS_POOL) {
      log.info('Tip: prueba con SOCKS5 para evitar filtro IP del datacenter');
      log.info('Ejemplo: SOCKS_HOST=127.0.0.1 SOCKS_PORT=9050 node test-irc-connection.js');
    }
    testsFailed++;
    conclude(false);
  }
}

// Iniciar pruebas
runTests().catch(err => {
  log.error(err.message);
  testsFailed++;
  conclude(false);
});
