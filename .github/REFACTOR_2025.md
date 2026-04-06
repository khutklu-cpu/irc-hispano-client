# Refactorización 2025 — Arquitectura de Conexión Directa

## Cambio Principal

**Antes**: La aplicación tenía dos caminos de conexión:
- Navegador → Socket.IO → Servidor Node → IRCClient → proxy KiwiIRC
- Navegador → WebSocket directo → proxy KiwiIRC

**Ahora**: Un solo camino, limpio y eficiente:
- Navegador → WebSocket directo → proxy KiwiIRC
- Servidor Node → Solo sirve archivos estáticos y uploads/downloads

## Archivos Cambiados

### Frontend (`public/js/app.js`)
✅ **Eliminado**:
- `connectViaBackend()` — función que creaba Socket.IO
- `state.ws` — variable Socket.IO
- `state.connMode` — ya no hay dos modos
- Manejo de eventos `'BANNED'`, `'STATUS'`, `'SERVER_ERROR'`desde backend

✅ **Mejorado**:
- `directParseLine()` — nuevo parser de RFC 353 (NAMES) y 366 (NAMES_END)
- `send()` — ahora solo envía IRC directo, sin lógica de puente

### Backend (`server.js`)
✅ **Eliminado**:
- Lógica completa de Socket.IO (`io.on('connection'...)`)
- Importación de `IRCClient` desde `lib/irc.js`
- Toda la maquinaria de proxy SOCKS, parseo de sesiones, etc.

✅ **Mantenido**:
- Express + Helmet para seguridad
- Endpoints `/upload` y `/files/:filename` para compartir archivos
- Health check `/healthz`

### Dependencias (`package.json`)
✅ **Eliminadas**:
- `socket.io`
- `socks` (SocksProxyAgent está en Node, no se usa)
- `socks-proxy-agent`
- `uuid` (no usado en server)
- `ws` (no usado por Express)

✅ **Mantenidas**:
- `express` — servidor web
- `helmet` — seguridad CSP
- `mime-types` — detección de tipos
- `multer` — upload de archivos

### Utilidades (`lib/files.js`)
✅ **Eliminado**:
- `registerFile()` — no necesario
- `resolvePath()` — no necesario

## Cómo Funciona Ahora

### 1. Página se carga
- Servidor Express sirve `public/index.html` + `public/css/style.css` + `public/js/app.js`

### 2. Usuario clickea "Conectar"
- JavaScript genera nick aleatorio
- Abre WebSocket directo a `wss://kiwi.chathispano.com:9000/webirc/kiwiirc/{srv}/{session}/websocket`

### 3. SockJS handshake
- Recibe frame `'o'` (open)
- Envía: `JSON.stringify([":https://kiwi.chathispano.com:9000/webirc/kiwiirc/ CONTROL START"])`
- Luego: `CAP LS 302`, `NICK`, `USER`

### 4. IRC eventos
- Recibe frames SockJS tipo `'a[...]'` con líneas IRC
- Parser convierte en eventos (`CONNECTED`, `JOIN`, `MESSAGE`, etc.)
- Frontend renderiza en ventanas de chat

### 5. Envio de mensajes
- Usuario escribe en input
- `send()` llama `directRaw()` que envía via WebSocket
- Todo en el navegador, sin intermediarios

## Ventajas de Este Cambio

1. **Menor latencia** — sin saltos servidor intermediario
2. **Menos complejidad** — un solo código path
3. **Mejor mantenibilidad** — menos código que cambiar
4. **Más escalable** — múltiples usuarios sin cargar servidor Node
5. **Seguridad igual** — Helmet sigue protegiéndote en archivos estáticos

## Cómo Debuear

### En navegador (DevTools)
```javascript
// Ver nick actual
state.nick

// Ver canales abiertos
Object.keys(state.windows)

// Ver ese WebSocket
state.direct.ws

// Enviar comando IRC raw
directRaw("PRIVMSG #hispano :test")

// Ver último parse IRC
state.direct.buffer
```

### Logs del servidor
```bash
npm run dev
# Verás solo logs de Express + uploads, no de IRC
```

## Próximos Pasos Recomendados

1. **Probar conexión en vivo** — asegúrate de que la conexión mantiene abierta
2. **Monitorear PING/PONG** — verifica que no se desconecta a los 90s
3. **Test de múltiples usuarios** — asegúrate de que cada uno abre su WS propio
4. **Eliminar código muerto** — los archivos en raíz (test-*.js, debug-*.js, etc.) pueden quitarse
5. **Documentar handshake en TESTING.md** — cómo reproducir si algo falla

## Referencias

- Análisis original: `ANALYSIS_CHATHISPANO.md`
- Conexión: `public/js/app.js` líneas 1-360 (estado + conexión)
- Parser IRC: `public/js/app.js` líneas 260-390 (directParseLine)
- Servidor: `server.js` (ahora limpio)
