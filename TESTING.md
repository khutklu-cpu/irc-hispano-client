# Guía de Pruebas: Conexión IRC Mejorada

## Resumen de Cambios

Se han implementado mejoras significativas en `lib/irc.js` para replicar exactamente cómo funciona chathispano.com:

### ✓ Cambios Realizados

#### 1. **Headers WebSocket Realistas**
- User-Agent rotation (6 navegadores reales diferentes)
- Headers HTTP estándar: Accept, Referer, DNT, Pragma, Cache-Control
- Headers Sec-Fetch para parecer navegador legítimo

#### 2. **Timing Inteligente (Anti-Bot)**
- Delays variables entre comandos (random jitter)
- PING interval aleatorio (85-95s, no exacto)
- Simula comportamiento humano, no patrón robótico

#### 3. **Rate Limiting "Humano"**
- Cola de mensajes con delay de 200ms entre envíos
- Backoff exponencial: 2s → 60s máximo
- Jitter de 0-1000ms para evitar sincronización

#### 4. **Detección Mejorada de Banes**
Antes: solo detectaba G/K/Z-line
Ahora: detectable "banned", "throttled", "too many connections", etc.

#### 5. **Script de Prueba Completo**
`test-irc-connection.js` - Valida:
- ✓ Conexión WebSocket al proxy
- ✓ Registro como invitado
- ✓ Unión a canal (#hispano)
- ✓ Envío/recepción de mensajes
- ✓ Estabilidad de conexión

---

## Cómo Probar

### Opción 1: Test Automático (Recomendado)

```bash
# Instalar dependencias (si no están)
npm install

# Ejecutar prueba de conexión
node test-irc-connection.js
```

**Esperado:**
```
═══ PRUEBA DE CONEXIÓN IRC - irc-hispano-client ═══

ℹ Iniciando pruebas de conexión al proxy KiwiIRC...

═══ TEST 1: Conectar al proxy KiwiIRC ═══
ℹ Intentando conexión...
✓ Conexión WebSocket establecida

═══ TEST 2: Registro como invitado ═══
✓ Registrado con nick: Leon-Veloz

═══ TEST 3: Unirse a canal (#hispano) ═══
✓ Unido a canal: #hispano

═══ TEST 4: Enviar mensaje de prueba ═══
✓ Mensaje enviado y recibido: "Test desde irc-hispano-client"

═══ TEST 5: Estabilidad de conexión ═══
✓ Conexión estable (12 eventos IRC recibidos)

═══════════════════════════════════
✓ Pruebas completadas: 5 OK, 0 fallos
✓ Conexión IRC operativa ✓
```

### Opción 2: Test Manual en Navegador

```bash
# Iniciar servidor
npm run dev

# Abrir en navegador
# http://localhost:3000
```

**Pasos:**
1. Click en "Conectar"
2. Observar que se conecta (nick aleatorio generado)
3. En "Canales de entrada", escribir: `#hispano,#general`
4. Click en "Conectar" nuevamente
5. Si aparecer canales en la izquierda → ✓ Funcionando
6. Escribir mensaje en el canal y enviar

---

## Interpretación de Resultados

### ✓ Conexión Exitosa
- Conecta en <5 segundos
- Nick se registra sin errores
- Puede unirse a canales
- Mensajes se envían y reciben
- Sin errores de baneo (ERROR lines)

### ⚠ Advertencias Normales
- "timeout en puerto X" → Sistema intentando siguiente endpoint (normal)
- "Reconexión en 5s..." → Desconexión, reintentando (normal)
- "canal puede no aceptar" → Canal requiere registro o invitación (ok)

### ✗ Problemas a Reportar
- "No se pudo conectar por ningún endpoint" → Problema de proxy
- "ERROR ... [GKZ]-line" → Baneo (rotar IPs o esperar)
- Desconexiones frecuentes → Revisar conexión de red

---

## Próximos Pasos

Una vez que la prueba **pase exitosamente**:

1. **Control de Calidad** 
   - Revisar logs del servidor
   - Verificar protocolo SockJS
   - Test de carga (múltiples usuarios)

2. **Seguridad**
   - Rate limiting adicional en servidor
   - Validación de inputs de usuario
   - Sanitización de mensajes IRC
   - Protección contra injection attacks

3. **Estabilidad**
   - Monitorear reconexiones
   - Alertas de baneo
   - Rotación automática de proxies

4. **Optimizaciones**
   - Refresco de User-Agent pool periódicamente
   - Estadísticas de conexión
   - Dashboard de salud

---

## Archivos Modificados

- `lib/irc.js` - Lógica IRC mejorada (headers, timing, rate-limiting)
- `test-irc-connection.js` - Suite de pruebas automatizadas (NEW)

## Archivos Sin Cambios

- `server.js` - Ya correctamente configurado
- `public/js/app.js` - UI funcional
- `lib/files.js` - Uploads OK
- `package.json` - Dependencias OK
