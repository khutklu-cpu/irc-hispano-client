# Guía de Depuración Interactiva — WebSocket Directo

Cuando prubes la conexión viva, si algo no funciona, sigue esta guía paso a paso.

---

## Escenario 1: npm install Falla

### Síntoma
```bash
$ npm install
ERR! code ENOENT
ERR! ENOENT: no such file or directory, open 'package-lock.json'
```

### Prueba Primero
```bash
cd /workspaces/irc-hispano-client
ls -la package.json
# Debe existir y mostrar tamaño > 0
```

### Solución
```bash
# Limpiar cachés
rm -rf node_modules package-lock.json
npm cache clean --force

# Reinstalar
npm install
```

### Si persiste
```bash
# Ver qué error exacto hay
npm install --verbose

# O instalar directamente las 4 dependencias
npm install express helmet mime-types multer
```

---

## Escenario 2: npm start Falla o No Inicia Servidor

### Síntoma
```bash
$ npm start
Error: Cannot find module 'express'
```

### Verificación
```bash
ls -la node_modules/express
# Debe existir

npm list express
# Debe mostrar express@4.18.2
```

### Solución
```bash
# Si node_modules está incompleto
rm -rf node_modules
npm install --no-optional

# Si persiste error de módulo, verificar Node version
node --version  # Debe ser v16 o superior
```

---

## Escenario 3: Servidor Inicia Pero No Responde

### Síntoma
```bash
$ npm start
✓ Servidor iniciado en puerto 3000
# ... pero navegador: "No se puede conectar a localhost:3000"
```

### Verificación
```bash
# ¿Está escuchando?
lsof -i :3000
# O
netstat -an | grep 3000
# Debe mostrar LISTEN en puerto 3000

# ¿Es localhost o 0.0.0.0?
ss -tlnp | grep 3000
# Debe mostrar 0.0.0.0:3000
```

### Solución
```bash
# Puerto ocupado → cambiar puerto
PORT=3001 npm start
# Luego abrir http://localhost:3001

# O ver qué está usando el puerto
lsof -i :3000
kill -9 <PID>
npm start
```

---

## Escenario 4: Página Carga Pero Sin Botón o CSS Roto

### Síntoma
- Página blanca
- Solo texto sin estilos
- Botones no aparecen

### Verificación en DevTools
```javascript
// Console:
console.log(document.querySelector('#btn-connect'))
// Debe retornar <button id="btn-connect">
```

### Solución
```bash
# ¿El HTML está correcto?
curl http://localhost:3000/index.html | grep btn-connect

# ¿El CSS carga?
curl -I http://localhost:3000/css/style.css
# Debe retornar 200 OK

# Si no:
ls -la public/index.html
ls -la public/css/style.css
# Deben existir
```

---

## Escenario 5: Botón "Conectar" No Responde

### Síntoma
- Click en botón → nada sucede
- DevTools Console: no hay errores

### Verificación
```javascript
// Console:
state
// Debe mostrar: {direct: null, nick: '', currentWin: '*status*', windows: ...}

// ¿El listener está registrado?
document.querySelector('#btn-connect').onclick
// Debe ser null (porque usamos addEventListener)

// ¿El evento se dispara?
document.querySelector('#btn-connect').addEventListener('click', () => {
  console.log('Click detectado!');
});
// Luego click — debe aparecer "Click detectado!"
```

### Solución
```javascript
// En Console, llamar manualmente:
doConnect();
// Debe ver "Conectando directo desde navegador..." en status

// Si error:
// Ver qué falla
try { doConnect(); } catch(e) { console.error(e); }
```

---

## Escenario 6: WebSocket No Se Abre

### Síntoma
- DevTools Network tab: no hay conexión WebSocket
- Status dice "Conectando..." pero se queda
- Tras 14s: se resetea y reintenta

### Verificación
```javascript
// Console, durante conexión:
state.direct
// Debe mostrar: {ws: WebSocket, nick: '...', connected: false, ...}

// ¿WebSocket existe?
state.direct.ws
// Debe ser: WebSocket {url: 'wss://...', readyState: 0, ...}
// readyState: 0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED

// ¿Qué readyState tiene?
state.direct.ws.readyState
// Si 3, se cerró. Si 0, está intentando. Si 1, abierto.
```

### Depuración Avanzada
```javascript
// Ver todos los eventos del WebSocket
const ws = state.direct.ws;
ws.addEventListener('open', () => console.log('OPEN'));
ws.addEventListener('close', e => console.log('CLOSE', e.code, e.reason));
ws.addEventListener('error', e => console.log('ERROR', e));
ws.addEventListener('message', e => console.log('MESSAGE', e.data));

// Luego esperar eventos en Console
```

### Soluciones

**Si readyState = 3 (CLOSED):**
```javascript
// WebSocket cerrado. Intentó conectar pero no pudo.
// Posibles razones:
// 1. Servidor no responde (proxy caído)
// 2. Certificado HTTPS inválido
// 3. CORS/CSP bloqueando (poco probable con conexión directa)
// 4. Firewall/router bloqueando puerto 9000-9004

// Probar conectando manualmente:
fetch('https://kiwi.chathispano.com:9000').catch(e => console.error(e.message));
// Si error: servidor no alcanzable

// O mejor, hacer ping:
// (No hay herramienta de ping en navegador, pero curl funciona)
```

**Si readyState = 0 (CONNECTING) por > 5s:**
```javascript
// Timeout de conexión. El servidor tarda.
// Esperar más o reportar lentitud
```

---

## Escenario 7: WebSocket Abre (readyState=1) Pero No Registra

### Síntoma
- Network tab: WebSocket 101 (abierto)
- Status: "WebSocket abierto en puerto 9000"
- Pero nunca dice "Conectado como..."

### Verificación
```javascript
// ¿Qué frames llegan?
state.direct.ws.addEventListener('message', e => {
  console.log('Frame recibido:', e.data.slice(0, 100));  // primeros 100 chars
});

// Esperar a que llegue primer frame. Debería ser 'o' (SockJS open):
// Frame recibido: o

// ¿Se envió CONTROL START?
// Ver en Network tab, pestaña "Messages"
// Debe haber mensaje: [":https://kiwi.chathispano.com:9000/webirc/kiwiirc/ CONTROL START"]
```

### Depuración Paso a Paso

1. **Verifica que frame 'o' se reciba:**
   ```javascript
   // Console, durante conexión:
   // Espera a ver en logs: "Frame recibido: o"
   // Si no llega en 5s, el servidor no envía open frame (muy raro)
   ```

2. **Verifica que NICK se envíe:**
   ```javascript
   // Mira Network tab > Messages:
   // Debe haber (en orden):
   // 1. a["::... CONTROL START"]
   // 2. a["CAP LS 302\r\n"]
   // 3. a["NICK Tigre-Veloz\r\n"]
   // 4. a["USER kiwi 0 * :...\r\n"]
   ```

3. **¿Qué responde el servidor?**
   ```javascript
   // En Network > Messages, busca respuesta:
   // Algo como: a[":server 001 Tigre-Veloz :Welcome..."
   // Si no hay 001, el servidor no reconoce el handshake
   ```

### Solución
```javascript
// Si llega frame 'o' pero no se envía CONTROL START:
// Bug en código. Verificar:
// app.js:132-138 — evento 'open' del WebSocket

// Si se envía CONTROL START pero no llega respuesta 001:
// Servidor rechaza el handshake. Quizá formato incorrecto o servidor sobrecargado.
// Esperar y reintentar, o contactar administrador KiwiIRC.
```

---

## Escenario 8: Registra (001) Pero No Ve #hispano

### Síntoma
- Status dice "Conectado como Tigre-Veloz" ✅
- Pero lista de canales está vacía ❌
- No hay #hispano visible

### Verificación
```javascript
// ¿Se intentó JOIN?
state.direct.desiredChannels
// Debe contener: Set { '#hispano' }

// ¿Se envió comando JOIN?
// Network tab > Messages, buscar: a["JOIN #hispano\r\n"]

// ¿Existe la ventana?
state.windows
// Debe tener '#hispano': {...}

// ¿Llegó respuesta JOIN?
// Network tab, buscar: a[":... JOIN :#hispano"]
```

### Depuración

```javascript
// Hacer JOIN manual:
directRaw('JOIN #hispano');

// Esperar 2s y revisar:
state.windows['#hispano']
// Debe existir ahora
```

### Solución

**Si JOIN se envía pero no se recibe confirmación:**
```javascript
// Posibles razones:
// 1. Canal no existe (RFC devuelve ERROR)
// 2. Servidor tiene issue
// 3. Buffer de recepción incompleto

// Revisar si hay ERROR:
// Console: buscar handleServerMsg({ type: 'ERROR', ...
```

---

## Escenario 9: Ve #hispano Pero Nicks Vacío

### Síntoma
- Canal #hispano aparece
- Pero no hay nombres de usuarios

### Verificación
```javascript
// ¿Llegó NAMES (353)?
state.windows['#hispano'].nicks
// Debe ser array con nicks: ['usuario1', 'usuario2', ...]

// ¿El RFC 353 se parsea?
// Añade debug al parser:
// Busca en Network > Messages: a[":server 353 ..."]

// ¿Cómo se ve el mensaje?
// Algo como: a[":server 353 Tigre-Veloz = #hispano :admin op bot ..."]
```

### Depuración

```javascript
// Manualmente, ejecutar una WHO para refrescar:
directRaw('WHO #hispano');

// Esperar 2s y verificar:
state.windows['#hispano'].nicks

// Si sigue vacío, hay bug en parser RFC 353
// Revisar app.js:245-254 — directParseLine() case '353'
```

### Solución

**Si RFC 353 no se recibe:**
```javascript
// Quizá el servidor no lo envía (raro)
// Intentar manualmente: /names #hispano
```

**Si se recibe pero no se parsea:**
```javascript
// Debug línea por línea:
window.addEventListener = ((...original) => {
  return function(type, listener) {
    if (type === 'message') {
      return original.call(this, type, (ev) => {
        const data = ev.data;
        if (data.includes('353')) {
          console.log('DEBUG RFC353:', data);
        }
        return listener.call(this, ev);
      });
    }
    return original.call(this, type, listener);
  };
})(window.addEventListener);

// Luego, cuando llegue 353, verás exactamente cómo se parece
```

---

## Escenario 10: Envía Mensaje Pero No Aparece

### Síntoma
- Escribes "Hola"
- Presionas Enter
- Aparece localmente en UI
- Pero no aparece en otros clientes
- Y no lo ves de vuelta

### Verificación
```javascript
// ¿Se envió PRIVMSG?
// Network > Messages, buscar: a["PRIVMSG #hispano :Hola\r\n"]

// ¿El queue respeta delay?
state.direct.queue  // debe estar vacía si se envió
state.direct.lastSent  // debe ser Date.now() - algunos ms

// ¿Recibió eco?
// Network, buscar respuesta: a[":Tigre-Veloz!... PRIVMSG #hispano :Hola"]
```

### Depuración

```javascript
// Enviar manualmente:
directRaw('PRIVMSG #hispano :Test manual');

// Monitor respuestas:
state.direct.ws.onmessage = (e) => console.log('Response:', e.data);

// Esperar respuesta
```

### Solución

**Si PRIVMSG se envía pero servidor no eco:**
```javascript
// Posibles razones:
// 1. Nick no registrado (poco probable si 001 llegó)
// 2. Servidor rechaza mensajes (canaleta flood?)
// 3. Issue en servidor IRC

// Intentar comando simple:
directRaw('PRIVMSG #hispano :Hello');
// Esperar 5s sin meter más comandos
```

**Si se recibe PRIVMSG en server pero no aparece en UI:**
```javascript
// handleServerMsg no la procesa
// Revisar app.js:264-273 — case 'PRIVMSG'

// Debug manual:
handleServerMsg({type: 'PRIVMSG', nick: 'Test', target: '#hispano', text: 'Hola'});
// Debe aparecer en chat
```

---

## Escenario 11: Se Desconecta Cada 90 Segundos

### Síntoma
- Conecta bien
- Todo funciona
- A los ~90s: WebSocket se cierra
- Intenta reconectar automáticamente

### Verificación
```javascript
// ¿PING timer está activo?
state.direct.pingTimer
// Debe ser número > 0 (el ID del interval)

// ¿Se envían PINGs?
// Network > Messages, buscar: a["PING :irc.chathispano.com\r\n"]
// Debe haber uno cada ~90s
```

### Solución

**Si pingTimer es null o 0:**
```javascript
// Bug en startDirectPing()
// Revisar app.js:319-322

// Ejecutar manualmente:
startDirectPing();
console.log(state.direct.pingTimer);  // debe ser > 0
```

**Si PING se envía pero server no responde (desconexión):**
```javascript
// Servidor rechaza o no reconoce formato PING
// Probar diferentes formatos:
directRaw('PING :server');
directRaw('PING');
// Esperar PONG
```

---

## Escenario 12: CSP Bloquea Conexión

### Síntoma
- DevTools Console error: "Refused to connect to ... because it violates the Content-Security-Policy directive"

### Verificación
```javascript
// Ver headers CSP:
fetch('/').then(r => {
  console.log(r.headers.get('content-security-policy'));
});
```

### Solución

**Si CSP bloquea wss://**
```javascript
// En server.js:29, debe estar:
connectSrc: ["'self'", 'ws:', 'wss:']

// Reiniciar servidor:
npm start
```

---

## Checklist Rápido de Prueba Viva

Antes de debuggear, verifica esto:

```javascript
// Ejecuta en Console después de conectar:

// 1. ¿State está listo?
console.assert(state.direct !== null, 'direct es nulo');
console.assert(state.direct.ws !== null, 'ws es nulo');

// 2. ¿WebSocket abierto?
console.assert(state.direct.ws.readyState === 1, 'WS no abierto');

// 3. ¿Registrado?
console.assert(state.direct.connected === true, 'No conectado');

// 4. ¿Nick asignado?
console.assert(state.direct.nick !== '', 'Nick vacío');

// 5. ¿Ventana status existe?
console.assert(state.windows['*status*'] !== undefined, 'Status vacía');

// 6. ¿Canal existe?
console.assert(state.windows['#hispano'] !== undefined, 'Canal no existe');

// 7. ¿Timer PING existe?
console.assert(state.direct.pingTimer !== null, 'PING timer nulo');

// Si todo pasa, sistema está LISTO
// Si algo falla, revisar ese punto específico
```

---

## Contacto / Escalación

Si nada funciona tras esta guía:

1. **Toma captura de Network tab** (salva como HAR)
2. **Copia Console errors** completos
3. **Estado exacto de** `state.direct`
4. **Toma README o issue en GitHub**

Eso ayuda a diagnosticar rápido.
