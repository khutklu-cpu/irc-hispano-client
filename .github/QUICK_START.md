# Guía de Inicio Rápido - IRC Hispano Client

## 🚀 Inicio en 3 Pasos

### 1. Instalar dependencias
```bash
npm install
```

### 2. Ejecutar test de conexión
```bash
node test-irc-connection.js
```

### 3. Si el test pasa ✓, iniciar servidor
```bash
npm run dev
```
Luego abre http://localhost:3000 en el navegador.

---

## 📋 Qué se cambió

Hemos replicado **exactamente cómo funciona chathispano.com** para evitar el baneo de IPs:

### Mejoras Implementadas

✅ **Headers realistas** - User-Agent rotation, Referer, Pragma, etc.
✅ **Timing inteligente** - Delays variables para parecer navegador real
✅ **Rate limiting** - Cola de mensajes para respetar límites del servidor
✅ **Backoff exponencial** - Reconexión progresiva (no abruma)
✅ **Detección mejorada de banes** - Detecta todo tipo de bloqueos
✅ **Test suite** - Validación automatizada de conexión

---

## 🧪 Ejecutar Pruebas

### Test Automatizado (Recomendado)
```bash
node test-irc-connection.js
```

**Valida:**
- ✓ Conexión al proxy KiwiIRC
- ✓ Registro como invitado
- ✓ Unión a canal (#hispano)
- ✓ Envío/recepción de mensajes
- ✓ Estabilidad de conexión (10 segundos)

**Tiempo:** ~20-30 segundos
**Resultado:** Debe mostrar "✓ Conexión IRC operativa"

### Test Manual (Navegador)
```bash
npm run dev
```
1. Click en "Conectar"
2. En "Canales", escribir: `#hispano`
3. Click en "Conectar" nuevamente
4. Escribir y enviar mensaje

---

## 📚 Documentación

- **TESTING.md** - Guía de pruebas detallada
- **.github/TECHNICAL.md** - Documentación técnica de cambios
- **.github/copilot-instructions.md** - Instrucciones del agente IA
- **test-irc-connection.js** - Script de prueba con fuente

---

## 🔧 Configuración del Servidor

Variables de entorno disponibles:

```bash
PORT=3000                          # Puerto del servidor (default: 3000)
HOST=0.0.0.0                       # Host del servidor (default: 0.0.0.0)
IRC_HOST=irc.irc-hispano.org       # Label del servidor IRC (default: irc.irc-hispano.org)
```

Ejemplo:
```bash
PORT=8080 npm run dev
```

---

## 🛡️ Seguridad

La conexión usa:
- SSL/TLS al proxy (wss://)
- Helmet.js con Content-Security-Policy
- Validación de inputs de usuario
- Sanitización de mensajes IRC
- Rate limiting anti-flood

---

## ⚠️ Problemas Comunes

### "No se pudo conectar por ningún endpoint"
→ El proxy no está disponible. Intenta:
```bash
ping kiwi.chathispano.com
```

### "ERROR ... throttled" o "... too many connections"
→ Tu IP está limitada. Espera 5-10 minutos o usa un proxy SOCKS:
```javascript
{
  proxy: {
    host: 'tu-proxy.com',
    port: 1080,
    username: 'user',
    password: 'pass'
  }
}
```

### Desconexiones frecuentes
→ Latencia/proxy inestable. El cliente reintentará automáticamente con backoff.

---

## 📞 Próximos Pasos

Una vez que **pruebas pasen exitosamente**:

1. **Control de Calidad** - Revisar logs y protocolo
2. **Seguridad** - Validación addicioinales, protección contra injection
3. **Optimización** - Estadísticas, monitoreo, alertas

---

## 📁 Estructura

```
.
├── server.js                     # Express + Socket.IO
├── lib/
│   ├── irc.js                   # Cliente IRC (MEJORADO ✓)
│   └── files.js                 # Manejo de subidas
├── public/
│   ├── index.html               # UI
│   ├── css/style.css            # Estilos
│   └── js/app.js                # Cliente JavaScript
├── test-irc-connection.js        # Test automatizado (NEW ✓)
├── TESTING.md                    # Guía de pruebas (NEW ✓)
└── .github/
    ├── TECHNICAL.md             # Docs técnicas (NEW ✓)
    └── copilot-instructions.md  # Instrucciones IA (NEW ✓)
```

---

## ✨ Changelog

### Versión 1.1 (Actual)
- ✅ Replicación exacta de chathispano.com
- ✅ User-Agent rotation
- ✅ Headers realistas
- ✅ Timing inteligente
- ✅ Rate limiting
- ✅ Test suite
- ✅ Documentación técnica

---

**¿Listo?** Comienza con:
```bash
npm install && node test-irc-connection.js
```
