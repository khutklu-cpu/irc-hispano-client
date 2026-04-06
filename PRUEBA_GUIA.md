# Guía de Prueba — Conexión IRC Directa

## Paso 1: Prepare el Entorno

```bash
cd /workspaces/irc-hispano-client

# Limpiar node_modules antigua
rm -rf node_modules package-lock.json

# Instalar solo lo necesario
npm install
```

**Salida esperada:**
```
up to date, audited 4 packages in 1s
```
(Solo 4 paquetes: express, helmet, mime-types, multer)

---

## Paso 2: Arrancar el Servidor

```bash
npm start
```

**Salida esperada:**
```
╔══════════════════════════════════════╗
║   IRC Hispano Web Client             ║
║   http://0.0.0.0:3000               ║
╚══════════════════════════════════════╝
```

---

## Paso 3: Abrir en Navegador

Abre: `http://localhost:3000`

**Deberías ver:**
- Logo "IRC Hispano" grande
- Nick generado aleatoriamente (ej: "Tigre-Veloz")
- Botón "Conectar como Invitado"

---

## Paso 4: Hacer Clic en "Conectar"

1. Click en "Conectar como Invitado"
2. Abre DevTools (F12) → tab "Red" (Network)
3. Filtra por "WS" para ver WebSockets

**Deberías ver:**
- Conexión WebSocket a `wss://kiwi.chathispano.com:9000/webirc/kiwiirc/...`
- Estado: `101 Switching Protocols` (éxito)

---

## Paso 5: Validar Handshake IRC

En DevTools → Console, escribe:

```javascript
// Ver nick tras conectar
console.log("Nick:", state.nick)

// Ver WebSocket abierto
console.log("WS:", state.direct.ws)

// Ver estado de conexión
console.log("Conectado:", state.direct.connected)

// Ver ventanas
console.log("Ventanas:", Object.keys(state.windows))
```

**Esperado tras conectar:**
```
Nick: Tigre-Veloz  (o similar)
WS: WebSocket {readyState: 1, ...}  (1 = OPEN)
Conectado: true
Ventanas: ["*status*", "#hispano"]
```

---

## Paso 6: Probar Envío de Mensajes

1. Verifica que estés en el canal `#hispano` (icono `#` en la izquierda)
2. Escribe en el input: "¡Hola desde el cliente web!"
3. Presiona Enter

**Deberías ver:**
- Tu mensaje aparece en el chat
- Color único para tu nick
- Timestamp correcto

---

## Paso 7: Validar PING/PONG

En Console:

```javascript
// Ver último PING enviado
state.direct.pingTimer

// Esperar 90 segundos y verificar que no desconecta
// (el cliente envía PING automáticamente cada 90s)
```

---

## Si Algo Falla

### Problema: "No se pudo registrar IRC"

**Significa:** El proxy no responde. Posibles causas:
1. Sin internet o bloqueado
2. IP filtrada (el servidor te ve como bot)
3. Proxy KiwiIRC caído (poco probable)

**Solución:**
- Espera 1-2 minutos
- Recarga la página
- Intenta en navegador incógnito
- Si persiste, reporta en Discord

### Problema: Conecta pero no ve mensajes

**Significa:** El parser IRC tiene un bug.

**Debug en Console:**
```javascript
// Ver buffer crudo
state.direct.buffer

// Ver último comando enviado
directRaw("WHO #hispano")

// Ver si llegan frames
state.direct.ws.onmessage = function(e) {
  console.log("Frame:", e.data)
}
```

### Problema: Se desconecta a los 90-120 segundos

**Significa:** El WebSocket se cierra (posiblemente sin PING).

**Debug:**
```javascript
// Ver si pingTimer está activo
state.direct.pingTimer  // debe ser > 0

// Ver últimas líneas IRC recibidas
state.direct.buffer
```

---

## Validación Rápida de Código

Si no puedes probar en navegador, estos puntos te dicen si está bien:

✅ Server arranca sin errores: `npm start` sale limpio  
✅ No hay warnings de módulos faltantes  
✅ El archivo `public/js/app.js` carga sin Syntax Error (DevTools)  
✅ State inicial tiene `state.direct: null` (no `state.ws`)  
✅ Click en "Conectar" abre WebSocket visible en Network tab  

---

## Flujo Esperado Completo

```
1. Página carga
   → app.js se ejecuta
   → createWindow('*status*') genera ventana inicial
   → setTimeout(() => doConnect(), 80) espera 80ms

2. Usuario ve "Conectando directo desde navegador..."
   → connectDirectBrowser() crea state.direct
   → tryDirectPort(0) intenta puerto 9000

3. WebSocket abre (evento 'open')
   → directHandleSockJsFrame recibe frame 'o'
   → Envía: JSON.stringify([":https://kiwi.chathispano.com:9000/webirc/kiwiirc/ CONTROL START"])
   → Espera 120ms

4. Envía comandos IRC:
   → CAP LS 302
   → NICK Tigre-Veloz
   → USER kiwi 0 * :Usuario Kiwi ChatHispano

5. Servidor responde con 001 (Connected)
   → directParseLine reconoce comando 001
   → state.direct.connected = true
   → Dispara onConnected callback
   → UI muestra "Conectado como Tigre-Veloz"

6. Se une a #hispano automáticamente
   → Recibe JOIN reply
   → Usuario ve canal en lista izquierda

7. Listo para chatear
```

---

## Próxima Revisión Si Falla

Si la conexión no funciona después de probar, revisar:

1. **El handshake SockJS** — ver frames exactos intercambiados
2. **El parser del servidor KiwiIRC** — quizá requiere headers específicos
3. **Rate limiting** — quizá hay límite de conexiones por IP
4. **CSP/CORS** — aunque poco probable con conexión directa

Reporta qué ves en cada paso y debuguamos.
