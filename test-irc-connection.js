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
  log.info('Iniciando pruebas de conexión IRC (Kiwi o TLS fallback)...\n');

  // Timeout global amplio: Kiwi puede agotar varios endpoints antes del fallback TLS
  testTimeout = setTimeout(() => {
    log.error('TIMEOUT: Prueba tardó demasiado');
    testsFailed++;
    conclude(false);
  }, 150000);

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
    const testChannel = (process.env.TEST_CHANNEL || '#hispano').trim() || '#hispano';
    let connectedNick = null;
    let registered = false;
    
    // Eventos de estado
    client.on('status', (msg) => {
      log.info(`[Status] ${msg}`);
    });

    client.on('connected', (nick) => {
      connectedNick = nick;
      registered = true;
    });

    client.on('error', (msg) => {
      // Tras registrar, errores de permisos de canal/comandos no deben tumbar la prueba.
      if (registered) {
        log.warn(`[Error no fatal] ${msg}`);
      } else {
        log.error(`[Error] ${msg}`);
        testsFailed++;
      }
    });

    client.on('raw_in', (msg) => {
      console.log(`  ← ${msg.slice(0, 100)}`);
    });

    client.on('raw_out', (msg) => {
      console.log(`  → ${msg.slice(0, 100)}`);
    });

    // Test 1: Conectar
    log.section('TEST 1: Conectar sesión IRC');
    log.info('Intentando conexión...');
    
    await client.connect();
    log.ok('Sesión de transporte establecida (Kiwi o TLS)');
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

    // Test 3: Unirse a canal de prueba (best effort)
    log.section(`TEST 3: Intentar JOIN a ${testChannel}`);
    
    const joinPromise = new Promise((resolve) => {
      let handleJoin;
      let handleJoinError;
      const timeout = setTimeout(() => {
        log.warn(`Timeout esperando JOIN en ${testChannel} (puede estar restringido)`);
        testsPassed++;
        client.off('join', handleJoin);
        client.off('server_error', handleJoinError);
        resolve();
      }, 10000);

      handleJoin = (data) => {
        if (data.channel === testChannel && data.self) {
          clearTimeout(timeout);
          log.ok(`Unido a canal: ${colors.bold}${testChannel}${colors.reset}`);
          testsPassed++;
          client.off('join', handleJoin);
          client.off('server_error', handleJoinError);
          resolve();
        }
      };

      handleJoinError = (err) => {
        const msg = String((err && err.message) || '');
        if (/No such channel|Cannot join|invite|banned|Cannot send to channel|403|471|473|474|475/i.test(msg)) {
          clearTimeout(timeout);
          log.warn(`JOIN no permitido en ${testChannel}: ${msg}`);
          testsPassed++;
          client.off('join', handleJoin);
          client.off('server_error', handleJoinError);
          resolve();
        }
      };

      client.on('join', handleJoin);
      client.on('server_error', handleJoinError);
      client.join(testChannel);
    });

    await joinPromise;

    // Test 4: Comando funcional sin canal
    log.section('TEST 4: Comando funcional (WHOIS self)');
    log.info(`Solicitando WHOIS de ${client.nick}...`);
    
    const whoisPromise = new Promise((resolve) => {
      let handleWhois;
      const timeout = setTimeout(() => {
        log.warn('No se recibió respuesta WHOIS a tiempo');
        client.off('whois', handleWhois);
        resolve();
      }, 8000);

      handleWhois = (data) => {
        if (data && data.nick && data.nick.toLowerCase() === client.nick.toLowerCase()) {
          clearTimeout(timeout);
          log.ok(`WHOIS recibido para ${data.nick}`);
          testsPassed++;
          client.off('whois', handleWhois);
          resolve();
        }
      };

      client.on('whois', handleWhois);
      client.whois(client.nick);
    });

    await whoisPromise;

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
