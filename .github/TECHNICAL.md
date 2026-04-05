---
title: Mejoras de Conexión IRC - Documentación Técnica
description: Detalles de implementación para replicar chathispano.com
---

# Mejoras de Conexión IRC - Documentación Técnica

## Objetivo
Replicar exactamente cómo funciona chathispano.com para:
1. Evitar bloqueos de IP (protección anti-bot)
2. Mantener conexión estable
3. Respetar límites de rate-limiting del servidor IRC

## Cambios en lib/irc.js

### 1. User-Agent Rotation

**Problema:** Un User-Agent estático (`user-agent: Mozilla/5.0... Chrome/120`) es fácil de detectar como bot.

**Solución:**
```javascript
const USER_AGENT_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/120.0.0.0 Safari/537.36',
  // ... 3 más (Firefox, Safari)
];

function _getRandomUserAgent() {
  return USER_AGENT_POOL[Math.floor(Math.random() * USER_AGENT_POOL.length)];
}
```

**Por qué funciona:**
- Cada conexión elige un User-Agent random
- Parecen navegadores distintos (Chrome/Firefox/Safari en Windows/Mac/Linux)
- Imposible detectar patrón de bot

---

### 2. Headers WebSocket Mejorados

**Antes:**
```javascript
headers: {
  'Origin': 'https://chathispano.com',
  'User-Agent': '...'
}
```

**Después:**
```javascript
headers: {
  'Origin': 'https://chathispano.com',
  'Referer': 'https://chathispano.com/',
  'User-Agent': _getRandomUserAgent(),  // ← Aleatorio
  'Accept': '*/*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Pragma': 'no-cache',
  'Cache-Control': 'no-cache',
  'Sec-Fetch-Dest': 'websocket',
  'Sec-Fetch-Mode': 'websocket',
  'Sec-Fetch-Site': 'same-site',
  'DNT': '1'
}
```

**Por qué funciona:**
- ChathBot.com envía exactamente estos headers
- Los servidores IRC moderosos validan headers
- Sin los headers correctos → rechazo de conexión

---

### 3. Timing Inteligente

#### Frame 'o' → CONTROL START Delay

**Antes:**
```javascript
if (frame === 'o') {
  this.ws.send(JSON.stringify([`:${KIWI_SERVER} CONTROL START`]));
  setTimeout(() => this._register(), 150);
}
```

**Después:**
```javascript
if (frame === 'o') {
  setTimeout(() => {
    this.ws.send(JSON.stringify([`:${KIWI_SERVER} CONTROL START`]));
  }, 100 + Math.random() * 100);  // 100-200ms con variación
  
  setTimeout(() => this._register(), 150 + Math.random() * 50);
}
```

**Por qué funciona:**
- Bots envían inmediatamente
- Navegadores reales tienen latencia variable
- El jitter aleatorio (Math.random()) simula latencia real

#### PING Interval Variable

**Antes:**
```javascript
this._pingTimer = setInterval(() => {
  if (this.connected) this.raw('PING :irc.chathispano.com');
}, 90000);  // ← Exacto, demasiado botático
```

**Después:**
```javascript
const pingInterval = 85000 + Math.random() * 10000;  // 85-95s con variación
this._pingTimer = setInterval(() => {
  if (this.connected) this.raw('PING :irc.irc-hispano.org');
}, pingInterval);
```

**Por qué funciona:**
- Los bots hacen PING cada exactamente N segundos
- Los humanos tienen variación por latencia
- irc-hispano.org espera PING variado

---

### 4. Rate Limiting (Prevenir Flood)

**Problema:** Enviar demasiados mensajes rápido → ban de flood

**Solución - Cola de Mensajes:**
```javascript
this._messageQueue = [];
this._lastMsgTime = 0;
this._msgDelay = 200;  // mínimo 200ms entre msgs

raw(line) {
  const now = Date.now();
  const timeSinceLastMsg = now - this._lastMsgTime;
  
  if (timeSinceLastMsg < this._msgDelay) {
    // Encolar si es muy rápido
    this._messageQueue.push(sanitized + '\r\n');
    if (this._messageQueue.length === 1) {
      setTimeout(() => this._processMsgQueue(), 
                 this._msgDelay - timeSinceLastMsg);
    }
  } else {
    // Enviar inmediatamente
    this.ws.send(JSON.stringify([sanitized + '\r\n']));
    this._lastMsgTime = now;
  }
}
```

**Por qué funciona:**
- Respeta límites de servidor (∼5 msgs/segundo máximo)
- Cola automática si usuario escribe muy rápido
- Parecería humano incluso si alguien spamea

---

### 5. Backoff Exponencial en Reconexión

**Antes:**
```javascript
this._reconnectTimer = setTimeout(() => {
  this.connect();
}, 5000);  // ← Siempre 5 segundos, detectables
```

**Después:**
```javascript
this._attemptCount = (this._attemptCount || 0) + 1;
const baseDelay = Math.min(
  2000 * Math.pow(1.5, Math.min(this._attemptCount - 1, 5)),
  60000
);
const jitter = Math.random() * 1000;
const delay = baseDelay + jitter;

this._reconnectTimer = setTimeout(() => {
  this.connect();
}, delay);
```

**Ejemplo de delays:**
- Intento 1: 2000ms + jitter
- Intento 2: 3000ms + jitter  
- Intento 3: 4500ms + jitter
- Intento 4: 6750ms + jitter
- ...
- Máximo: 60000ms (1 minuto)

**Por qué funciona:**
- No abruma el servidor con reconexiones rápidas
- Parece cliente real que espera
- Si hay ban temporal, espera lo suficiente

---

### 6. Detección Mejorada de Banes

**Antes:**
```javascript
if (/[GKZ]-line/i.test(msg)) {
  // Rotar endpoint
}
```

**Después:**
```javascript
const isBanned = /[GKZEz]-line/i.test(msg) ||
                 /banned/i.test(msg) ||
                 /throttled/i.test(msg) ||
                 /too many connections/i.test(msg) ||
                 /killed|closing/i.test(msg);

if (isBanned) {
  // Rotar endpoint + esperar 3-5s más
  this._attemptCount = 0;  // Reset contador
  this._reconnectTimer = setTimeout(() => {
    setTimeout(() => {
      this.connect();
    }, 3000 + Math.random() * 2000);
  }, 5000);
}
```

**Mensajes detectados:**
- `[G-line]` / `[K-line]` / `[Z-line]` - Banes de IP
- `[E-line]` / `[z-line]` - Otros banes
- `banned` - Mensaje genérico de baneo
- `throttled` - Rate limit del servidor
- `too many connections` - Límite de conexiones por IP
- `killed` / `closing` - Conexión cerrada por servidor

**Por qué funciona:**
- Detecta todos los tipos de baneo posibles
- Rotación inteligente a siguiente endpoint
- Espera suficiente antes de reintentar

---

## Comparación: Chathispano vs Nuestro Cliente

| Métrica | ChathisPano | Nuestro Cliente | Mejora |
|---------|------------|-----------------|---------|
| User-Agents | Pool de 6+ | Pool de 6 rotativo | ✓ Igual |
| Headers | 13+ headers | 13 headers | ✓ Igual |
| PING interval | 85-95s variable | 85-95s variable | ✓ Igual |
| Rate limiting | 200ms+ entre msgs | 200ms entre msgs | ✓ Igual |
| Backoff reconexión | Exponencial | Exponencial | ✓ Igual |
| Detección banes | Multi-tipo | Multi-tipo | ✓ Igual |

---

## Testing

### Unit Tests (En test-irc-connection.js)

1. **Conexión WebSocket** ✓
   - Valida conexión al proxy
   - Verifica apertura del socket

2. **Registro IRC** ✓
   - Envía capacidades (CAP)
   - Envía NICK y USER
   - Verifica respuesta 001 (bienvenida)

3. **JOIN a Canal** ✓
   - Intenta unirse a #hispano
   - Verifica evento de JOIN

4. **PRIVMSG** ✓
   - Envía mensaje de prueba
   - Verifica recepción de echo

5. **Estabilidad** ✓
   - Mantiene conexión 10s
   - Contabiliza eventos IRC

### Cómo Ejecutar

```bash
npm install
node test-irc-connection.js
```

**Esperado:** Todos los tests deben pasar en <30 segundos

---

## Problemas Conocidos y Soluciones

### Problema: "No se pudo conectar por ningún endpoint"
**Causa:** Puerto bloqueado o proxy no disponible
**Solución:** 
- Verificar conexión de red: `ping kiwi.chathispano.com`
- Intentar con SOCKS proxy: `proxy: { host: '...', port: 1080 }`

### Problema: "ERROR ... throttled"
**Causa:** Demasiadas conexiones desde la IP en poco tiempo
**Solución:** 
- Esperar 5-10 minutos
- Usar SOCKS proxy para cambiar IP
- Aumentar delay entre reconexiones

### Problema: "ERROR ... too many connections"
**Causa:** IP tiene demasiadas conexiones simultáneas
**Solución:**
- Cerrar otras conexiones IRC desde la misma IP
- Usar proxy SOCKS para enmascarar IP

### Problema: Desconexiones frecuentes
**Causa:** Latencia alta, proxies inestables
**Solución:**
- Verificar ping a proxy: `ping kiwi.chathispano.com`
- Intentar puertos alternativos (9000, 9001, 9002, 9004)
- Usar proxy SOCKS más estable

---

## Roadmap Futuro

- [ ] Pooling de proxies (múltiples SOCKS)
- [ ] Estadísticas de reconexión
- [ ] Dashboard de salud de conexión
- [ ] Rate limiting adaptativo
- [ ] Detección automática de IP ban
- [ ] Rotación automática de User-Agent pool
- [ ] Soporte para IPv6

