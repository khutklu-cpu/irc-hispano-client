'use strict';
/* ═══════════════════════════════════════════════════════════
   IRC Hispano Web Client — Frontend principal
   Comunicación con backend via WebSocket
   ═══════════════════════════════════════════════════════════ */

/* ─── Estado global ─── */
const state = {
  ws:          null,
  nick:        '',
  currentWin:  '*status*',
  windows:     {},      // id → { type, title, messages, nicks, unread, mentions }
  histIdx:     -1,
  history:     []       // historial de comandos
};

/* ─── Inicialización ─── */

window.addEventListener('DOMContentLoaded', () => {
  // Generar nick de vista previa
  const ANIMALS=['Leon','Tigre','Caracol','Perro','Pez','Pajaro','Lince','Elefante','Tiburon','Mapache','Murcielago','Topo','Bufalo','Buho','Cocodrilo','Flamenco','Oso','Lobo','Pinguino','Raton','Delfin','Pantera','Rana','Ardilla','Aguila','Hormiga'];const SEPS=['-','_','{','}',''];const ADJS=['Verde','Azul','Naranja','Fugaz','Veloz','Feroz','Paciente','Elocuente','Tenaz','Fuerte','Humilde','Agil','Torpe','Eficiente','Suave','Feliz','Brillante','Sensible'];const previewNick=ANIMALS[Math.floor(Math.random()*ANIMALS.length)]+SEPS[Math.floor(Math.random()*SEPS.length)]+ADJS[Math.floor(Math.random()*ADJS.length)];
  byId('preview-nick').textContent = previewNick;

  // Crear ventana de status
  createWindow('*status*', 'Status', 'status');

  // Teclado en input
  byId('chat-input').addEventListener('keydown', onInputKeyDown);

  // Cerrar ctx menu
  document.addEventListener('click', () => closeCtxMenu());

  // Botones — reemplazan onclick inline (bloqueados por CSP)
  byId('btn-connect')  .addEventListener('click', doConnect);
  byId('btn-tor')      ?.addEventListener('click', useTor);
  byId('send-btn')     .addEventListener('click', sendInput);
  byId('file-input')   .addEventListener('change', e => uploadFile(e.target));
  document.querySelector('[data-target="*status*"]') ?.addEventListener('click', () => switchWindow('*status*'));
  document.querySelector('.tb-btn.danger')           ?.addEventListener('click', doDisconnect);
  document.querySelectorAll('.tb-btn')[0]            ?.addEventListener('click', showJoinDialog);
  document.querySelectorAll('.tb-btn')[1]            ?.addEventListener('click', showQueryDialog);
  byId('modal-overlay')  ?.addEventListener('click', closeModal);
  byId('modal-box')      ?.addEventListener('click', e => e.stopPropagation());
});

/* ─── Conexión ─── */

function doConnect() {
  const proxyHost = byId('proxy-host').value.trim();
  const proxyPort = parseInt(byId('proxy-port').value, 10) || 0;
  const proxyUser = byId('proxy-user').value.trim();
  const proxyPass = byId('proxy-pass').value.trim();

  const proxy = proxyHost ? {
    host: proxyHost, port: proxyPort || 1080,
    username: proxyUser || undefined, password: proxyPass || undefined
  } : null;

  const channels = byId('input-channels').value.trim()
    .split(',').map(c => c.trim()).filter(c => c.startsWith('#'));

  byId('btn-connect').disabled = true;
  setConnectStatus('Conectando...', false);

  // Reutilizar socket si ya está conectado
  if (state.ws && state.ws.connected) {
    state.ws.emit('msg', { type: 'CONNECT', proxy });
    state.pendingChannels = channels;
    return;
  }

  // Desconectar socket anterior si existe
  if (state.ws) {
    state.ws.disconnect();
    state.ws = null;
  }

  // Socket.IO: polling primero (funciona con proxies corporativos), luego upgrade a WS
  const socket = io({ transports: ['polling', 'websocket'] });
  state.ws = socket;

  socket.on('connect', () => {
    socket.emit('msg', { type: 'CONNECT', proxy });
    state.pendingChannels = channels;
  });

  socket.on('msg', msg => {
    handleServerMsg(msg);
  });

  socket.on('disconnect', () => {
    if (state.ws === socket) {
      setStatus('Desconectado');
      byId('sb-status').textContent = 'Desconectado';
      byId('btn-connect').disabled = false;
      state.ws = null;
    }
  });

  socket.on('connect_error', () => {
    setConnectStatus('Error de conexión', true);
    byId('btn-connect').disabled = false;
  });
}

function doDisconnect() {
  send({ type: 'DISCONNECT' });
  state.ws?.disconnect();
  state.ws = null;
  byId('main-screen').classList.add('hidden');
  byId('connect-screen').classList.remove('hidden');
  byId('btn-connect').disabled = false;
  // Reset state
  state.windows = {};
  state.nick    = '';
  state.currentWin = '*status*';
  byId('chan-list').innerHTML = '';
  byId('priv-list').innerHTML = '';
  byId('windows').innerHTML   = '';
  byId('nicklist').innerHTML  = '';
  createWindow('*status*', 'Status', 'status');
}

function useTor() {
  byId('proxy-host').value = '127.0.0.1';
  byId('proxy-port').value = '9050';
  byId('proxy-user').value = '';
  byId('proxy-pass').value = '';
}

/* ─── Mensajes del servidor ─── */

function handleServerMsg(msg) {
  switch (msg.type) {

    case 'CONNECTED':
      state.nick = msg.nick;
      byId('connect-screen').classList.add('hidden');
      byId('main-screen').classList.remove('hidden');
      byId('tb-nick').textContent = msg.nick;
      setStatus('Conectado como ' + msg.nick);
      addSystemMsg('*status*', `Conectado a ChatHispano como ${msg.nick}`);
      // Unirse a canales pendientes
      (state.pendingChannels || []).forEach((ch, idx) => {
        setTimeout(() => send({ type: 'JOIN', channel: ch }), idx * 700);
      });
      state.pendingChannels = [];
      break;

    case 'DISCONNECTED':
      setStatus('Desconectado');
      addSystemMsg('*status*', 'Conexión perdida. El servidor intentará reconectar automáticamente...');
      byId('btn-connect').disabled = false;
      break;

    case 'STATUS':
      setStatus(msg.message);
      addSystemMsg('*status*', msg.message);
      setConnectStatus(msg.message, false);
      break;

    case 'ERROR':
      setStatus('Error: ' + msg.message);
      addErrMsg('*status*', msg.message);
      setConnectStatus(msg.message, true);
      byId('btn-connect').disabled = false;
      break;

    case 'BANNED':
      setStatus('IP bloqueada (G-line) — usa un proxy SOCKS5');
      addErrMsg('*status*', `Tu IP ha sido baneada por irc-hispano: ${esc(msg.message)}`);
      addSystemMsg('*status*', 'Configura un proxy SOCKS5 o VPN en la pantalla de conexión y vuelve a intentarlo.');
      byId('btn-connect').disabled = false;
      // Cerrar WebSocket actual para que el próximo intento arranque limpio
      if (state.ws) { state.ws.disconnect(); state.ws = null; }
      // Volver a pantalla de conexión
      setTimeout(() => {
        byId('main-screen').classList.add('hidden');
        byId('connect-screen').classList.remove('hidden');
      }, 4000);
      break;
    case 'SERVER_ERROR':
      addErrMsg(state.currentWin, `[${msg.code}] ${msg.message}`);
      break;

    case 'SERVER_INFO':
    case 'MOTD':
      addMotdMsg(msg.text || msg.message || '');
      break;

    case 'MESSAGE': {
      const win = getOrCreateChatWindow(msg.target, msg.private ? 'private' : 'channel');
      addChatMsg(win, msg.from, msg.text, msg.from === state.nick, false);
      break;
    }

    case 'ACTION': {
      const win = getOrCreateChatWindow(msg.target, msg.private ? 'private' : 'channel');
      addActionMsg(win, msg.from, msg.text);
      break;
    }

    case 'NOTICE': {
      const win = msg.target && msg.target !== state.nick ? msg.target : state.currentWin;
      addNoticeMsg(win, msg.from, msg.text);
      break;
    }

    case 'JOIN':
      if (msg.self) {
        ensureWindow(msg.channel, 'channel');
        switchWindow(msg.channel);
        addSystemMsg(msg.channel, `Entraste al canal ${msg.channel}`);
      } else {
        addSystemMsg(msg.channel, `→ ${msg.nick} ha entrado al canal`);
      }
      break;

    case 'PART':
      if (msg.self) {
        addSystemMsg(msg.channel, `Saliste de ${msg.channel}`);
        removeWindow(msg.channel);
      } else {
        addSystemMsg(msg.channel, `← ${msg.nick} ha salido${msg.message ? ' (' + esc(msg.message) + ')' : ''}`);
      }
      break;

    case 'QUIT':
      addSystemMsg(msg.channel, `✕ ${msg.nick} se ha desconectado${msg.message ? ' (' + esc(msg.message) + ')' : ''}`);
      updateNickList(msg.channel);
      break;

    case 'KICK': {
      const kickWin = msg.channel;
      addErrMsg(kickWin, `✕ ${msg.kicked} fue expulsado por ${msg.nick}${msg.message ? ' (' + esc(msg.message) + ')' : ''}`);
      if (msg.kicked === state.nick) removeWindow(kickWin);
      break;
    }

    case 'NICK_CHANGE':
      if (msg.old === state.nick) {
        state.nick = msg.new;
        byId('tb-nick').textContent = msg.new;
        addSystemMsg(state.currentWin, `Tu nick cambió a ${msg.new}`);
      } else {
        addSystemMsg(state.currentWin, `${msg.old} ahora es ${msg.new}`);
      }
      break;

    case 'TOPIC':
      byId('topicbar-chan').textContent = msg.channel;
      byId('topicbar-topic').textContent = msg.topic || '(sin topic)';
      addSystemMsg(msg.channel, `Topic${msg.nick ? ' por ' + msg.nick : ''}: ${msg.topic || '(sin topic)'}`);
      break;

    case 'NAMES': case 'NAMES_END':
      updateNickListFromData(msg.channel, msg.nicks);
      break;

    case 'MODE':
      addSystemMsg(msg.target || state.currentWin, `Modo ${msg.mode} establecido por ${msg.nick || 'servidor'}`);
      break;

    case 'WHOIS': {
      const w = `${msg.nick} [${msg.user}@${msg.host}] — ${msg.realname}`;
      addSystemMsg(state.currentWin, `Whois: ${w}`);
      break;
    }

    case 'RAW_IN':
      // Solo mostrar en modo debug — no enviar al usuario normal
      break;

    default:
      break;
  }
}

/* ─── Ventanas de chat ─── */

function createWindow(id, title, type) {
  if (state.windows[id]) return;
  state.windows[id] = { id, title, type, messages: [], nicks: [], unread: 0, mentions: 0 };

  // Crear div en DOM
  const div = document.createElement('div');
  div.className = 'chat-window hidden';
  div.id = 'win-' + cssId(id);
  byId('windows').appendChild(div);
}

function ensureWindow(id, type) {
  if (!state.windows[id]) {
    createWindow(id, id, type);
    if (type === 'channel') addToSidebar('chan-list', id);
    else if (type === 'private') { addToSidebar('priv-list', id); byId('priv-section').style.display = ''; }
  }
}

function getOrCreateChatWindow(id, type) {
  ensureWindow(id, type);
  return id;
}

function removeWindow(id) {
  const w = state.windows[id];
  if (!w) return;
  delete state.windows[id];
  const dom = byId('win-' + cssId(id));
  dom?.parentNode?.removeChild(dom);
  // Quitar del sidebar
  byId('chan-list').querySelector(`[data-target="${CSS.escape(id)}"]`)?.remove();
  byId('priv-list').querySelector(`[data-target="${CSS.escape(id)}"]`)?.remove();
  if (state.currentWin === id) switchWindow('*status*');
}

function switchWindow(id) {
  if (!state.windows[id]) { id = '*status*'; }

  // Ocultar anterior
  const prev = byId('win-' + cssId(state.currentWin));
  prev?.classList.add('hidden');

  // Mostrar nuevo
  state.currentWin = id;
  const curr = byId('win-' + cssId(id));
  curr?.classList.remove('hidden');

  // Reset unread
  if (state.windows[id]) {
    state.windows[id].unread   = 0;
    state.windows[id].mentions = 0;
  }

  // Actualizar sidebar seleccionado
  document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('active', 'unread', 'mention'));
  const sideItem = document.querySelector(`.tree-item[data-target="${CSS.escape(id)}"]`);
  sideItem?.classList.add('active');
  // Quitar badge
  const badge = sideItem?.querySelector('.ti-badge');
  if (badge) badge.remove();

  // Topic bar
  const w = state.windows[id];
  if (w?.type === 'channel') {
    byId('topicbar-chan').textContent = id;
    updateNickListPanel(id);
  } else {
    byId('topicbar-chan').textContent  = '';
    byId('topicbar-topic').textContent = '';
    byId('nicklist').innerHTML = '';
    byId('nl-count').textContent = '';
  }

  // Label input
  byId('input-target-label').textContent = id === '*status*' ? '' : id;

  scrollToBottom(id);
  byId('chat-input').focus();
}

function addToSidebar(listId, chanId) {
  const el = document.createElement('div');
  el.className  = 'tree-item';
  el.dataset.target = chanId;

  // Usar textContent y addEventListener en lugar de innerHTML con onclick inline
  // para prevenir XSS independientemente del contenido de chanId
  const icon = document.createElement('span');
  icon.className = 'ti-icon';
  icon.textContent = listId === 'chan-list' ? '#' : '\uD83D\uDC64';

  const name = document.createElement('span');
  name.className   = 'ti-name';
  name.textContent = chanId;

  const close = document.createElement('span');
  close.className   = 'ti-close';
  close.textContent = '✕';
  close.addEventListener('click', e => { e.stopPropagation(); partOrClose(chanId); });

  el.appendChild(icon);
  el.appendChild(name);
  el.appendChild(close);
  el.addEventListener('click', () => switchWindow(chanId));

  byId(listId).appendChild(el);
}

function partOrClose(id) {
  const w = state.windows[id];
  if (!w) return;
  if (w.type === 'channel') send({ type: 'PART', channel: id });
  else removeWindow(id);
}

/* ─── Mensajes ─── */

function appendMsg(winId, html, classes = '') {
  const w = state.windows[winId];
  if (!w) return;
  const el = byId('win-' + cssId(winId));
  if (!el) return;

  const div = document.createElement('div');
  div.className = 'msg-line ' + classes;
  div.innerHTML = html;

  // Imágenes — abrir ampliadas al clic
  div.querySelectorAll('.inline-img').forEach(img => {
    img.addEventListener('click', () => showImageViewer(img.src));
  });

  el.appendChild(div);

  if (state.currentWin === winId) {
    scrollToBottom(winId);
  } else {
    // Incrementar unread en sidebar
    w.unread++;
    updateSidebarBadge(winId, w.unread);
  }
}

function ts() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function addChatMsg(winId, nick, text, isSelf, isHighlight) {
  const nickColor = nickToColor(nick);
  const rendText  = renderText(text, winId);
  const cls       = (isSelf ? 'own' : '') + (isHighlight ? ' highlight' : '');
  appendMsg(winId,
    `<span class="msg-ts">${ts()}</span>
     <span class="msg-nick" style="color:${nickColor}">${esc(nick)}</span>
     <span class="msg-sep">│</span>
     <span class="msg-text">${rendText}</span>`,
    cls
  );

  // Detección de menciones
  if (!isSelf && state.nick && text.toLowerCase().includes(state.nick.toLowerCase())) {
    markMention(winId);
    // Notificación
    if (document.hidden) notifyMention(nick, text);
  }
}

function addActionMsg(winId, nick, text) {
  const rendText = renderText(text, winId);
  appendMsg(winId,
    `<span class="msg-ts">${ts()}</span>
     <span class="msg-nick" style="color:${nickToColor(nick)};font-style:italic">* ${esc(nick)}</span>
     <span class="msg-sep"> </span>
     <span class="msg-text">${rendText}</span>`,
    'action'
  );
}

function addNoticeMsg(winId, nick, text) {
  appendMsg(winId,
    `<span class="msg-ts">${ts()}</span>
     <span class="msg-nick">[${esc(nick || 'server')}]</span>
     <span class="msg-sep">!</span>
     <span class="msg-text">${renderText(text, winId)}</span>`,
    'notice'
  );
}

function addSystemMsg(winId, text) {
  if (!state.windows[winId]) ensureWindow(winId, 'status');
  appendMsg(winId,
    `<span class="msg-ts">${ts()}</span>
     <span class="msg-nick">---</span>
     <span class="msg-sep"> </span>
     <span class="msg-text">${esc(text)}</span>`,
    'system'
  );
}

function addErrMsg(winId, text) {
  if (!state.windows[winId]) winId = '*status*';
  appendMsg(winId,
    `<span class="msg-ts">${ts()}</span>
     <span class="msg-nick">ERR</span>
     <span class="msg-sep">!</span>
     <span class="msg-text">${esc(text)}</span>`,
    'error'
  );
}

function addMotdMsg(text) {
  appendMsg('*status*',
    `<span class="msg-ts">${ts()}</span>
     <span class="msg-nick"></span>
     <span class="msg-sep"> </span>
     <span class="msg-text">${esc(text)}</span>`,
    'motd'
  );
}

/* ─── Input y comandos ─── */

function onInputKeyDown(e) {
  if (e.key === 'Enter') { sendInput(); return; }

  // Historial
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (state.histIdx < state.history.length - 1) {
      state.histIdx++;
      byId('chat-input').value = state.history[state.histIdx] || '';
    }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (state.histIdx > 0) {
      state.histIdx--;
      byId('chat-input').value = state.history[state.histIdx] || '';
    } else {
      state.histIdx = -1;
      byId('chat-input').value = '';
    }
    return;
  }

  // Tab-complete de nicks
  if (e.key === 'Tab') {
    e.preventDefault();
    tabComplete();
  }
}

function sendInput() {
  const input = byId('chat-input');
  const raw   = input.value.trim();
  if (!raw) return;

  // Historial
  state.history.unshift(raw);
  if (state.history.length > 50) state.history.pop();
  state.histIdx = -1;
  input.value = '';

  // Comandos /
  if (raw.startsWith('/')) {
    processCommand(raw);
  } else {
    // Mensaje normal
    const target = state.currentWin;
    if (!target || target === '*status*') { addErrMsg('*status*', 'Únete a un canal primero'); return; }
    send({ type: 'PRIVMSG', target, text: raw });
    addChatMsg(target, state.nick, raw, true, false);
  }
}

function processCommand(raw) {
  const parts = raw.slice(1).split(' ');
  const cmd   = parts[0].toUpperCase();
  const args  = parts.slice(1);

  switch (cmd) {
    case 'JOIN':
      if (args[0]) send({ type: 'JOIN', channel: args[0] });
      else addErrMsg(state.currentWin, 'Uso: /join #canal');
      break;

    case 'PART': case 'LEAVE':
      send({ type: 'PART', channel: args[0] || state.currentWin, message: args.slice(1).join(' ') });
      break;

    case 'MSG': case 'QUERY': {
      const target = args[0];
      const text   = args.slice(1).join(' ');
      if (!target) { addErrMsg(state.currentWin, 'Uso: /msg nick mensaje'); break; }
      ensureWindow(target, 'private');
      if (text) {
        send({ type: 'PRIVMSG', target, text });
        addChatMsg(target, state.nick, text, true, false);
      }
      switchWindow(target);
      break;
    }

    case 'ME':
      if (state.currentWin !== '*status*') {
        const text = args.join(' ');
        send({ type: 'ACTION', target: state.currentWin, text });
        addActionMsg(state.currentWin, state.nick, text);
      }
      break;

    case 'TOPIC':
      send({ type: 'TOPIC', channel: state.currentWin, topic: args.join(' ') });
      break;

    case 'KICK':
      send({ type: 'KICK', channel: state.currentWin, nick: args[0], reason: args.slice(1).join(' ') });
      break;

    case 'MODE':
      send({ type: 'MODE', target: args[0] || state.currentWin, mode: args.slice(1).join(' ') });
      break;

    case 'WHOIS':
      send({ type: 'WHOIS', nick: args[0] || '' });
      break;

    case 'WHO':
      send({ type: 'WHO', channel: args[0] || state.currentWin });
      break;

    case 'NICK':
      if (args[0]) {
        send({ type: 'NICK', nick: args[0] });
      } else {
        addErrMsg(state.currentWin, 'Uso: /nick NuevoNick');
      }
      break;

    case 'CLEAR':
      clearWindow(state.currentWin);
      break;

    case 'CLOSE':
      partOrClose(state.currentWin);
      break;

    case 'HELP':
      showHelp();
      break;

    case 'LIST':
      addSystemMsg(state.currentWin, 'Para ver canales usa /list en un cliente IRC tradicional. Aquí usa el botón "+ Canal"');
      break;

    case 'NOTICE':
      if (args[0] && args[1]) send({ type: 'PRIVMSG', target: args[0], text: `/NOTICE: ${args.slice(1).join(' ')}` });
      break;

    default:
      addErrMsg(state.currentWin, `Comando desconocido: /${cmd}. Escribe /help para ver comandos disponibles.`);
  }
}

function showHelp() {
  const cmds = [
    '/join #canal        — Entrar al canal',
    '/part [#canal]      — Salir del canal',
    '/msg nick texto     — Mensaje privado',
    '/me texto           — Acción (/me baila)',
    '/topic texto        — Cambiar topic',
    '/kick nick [razón]  — Expulsar usuario',
    '/nick NuevoNick     — Cambiar nick',
    '/whois nick         — Info de usuario',
    '/clear              — Limpiar ventana',
    '/close              — Cerrar ventana',
    '/help               — Esta ayuda'
  ];
  for (const c of cmds) addSystemMsg(state.currentWin, c);
}

/* ─── Tab-complete ─── */

function tabComplete() {
  const input = byId('chat-input');
  const val   = input.value;
  const word  = val.split(' ').pop();
  if (!word) return;

  const w = state.windows[state.currentWin];
  if (!w || !w.nicks || !w.nicks.length) return;

  const matches = w.nicks.filter(n => n.toLowerCase().startsWith(word.toLowerCase()));
  if (matches.length === 1) {
    const prefix = val.slice(0, val.length - word.length);
    input.value  = prefix + matches[0] + (prefix === '' ? ': ' : ' ');
  } else if (matches.length > 1) {
    addSystemMsg(state.currentWin, 'Completar: ' + matches.join('  '));
  }
}

/* ─── Nick list ─── */

function updateNickListFromData(channel, nicks) {
  if (!state.windows[channel]) return;
  state.windows[channel].nicks = nicks || [];
  if (state.currentWin === channel) updateNickListPanel(channel);
}

function updateNickListPanel(channel) {
  const w = state.windows[channel];
  if (!w) return;
  const nicks = w.nicks || [];
  byId('nl-title').textContent = channel;
  byId('nl-count').textContent = nicks.length;

  const nl = byId('nicklist');
  nl.innerHTML = '';
  // Ordenar: ops primero
  const sorted = [...nicks].sort((a, b) => {
    const oa = '@+%&~!'.includes(a[0]) ? 0 : 1;
    const ob = '@+%&~!'.includes(b[0]) ? 0 : 1;
    return oa - ob || a.toLowerCase().localeCompare(b.toLowerCase());
  });

  for (const nick of sorted) {
    const prefix = '@+%&~!'.includes(nick[0]) ? nick[0] : '';
    const name   = prefix ? nick.slice(1) : nick;
    const isOp   = prefix === '@';
    const isVoice= prefix === '+';
    const isSelf = name === state.nick;

    const el = document.createElement('div');
    el.className = 'nick-item' + (isOp ? ' nick-op' : '') + (isVoice ? ' nick-voice' : '') + (isSelf ? ' nick-self' : '');
    el.innerHTML = `<span class="nick-prefix">${esc(prefix)}</span><span>${esc(name)}</span>`;
    el.addEventListener('contextmenu', e => { e.preventDefault(); showCtxMenu(e, name); });
    el.addEventListener('click', () => showCtxMenu({ clientX: el.getBoundingClientRect().right, clientY: el.getBoundingClientRect().top }, name));
    nl.appendChild(el);
  }
}

function updateNickList(channel) {
  // Solicitar NAMES actualizado al servidor
  send({ type: 'WHO', channel });
}

/* ─── Menú contextual nicks ─── */

function showCtxMenu(e, nick) {
  const menu = byId('ctx-menu');
  byId('ctx-nick-header').textContent = nick;
  menu.classList.remove('hidden');

  let x = e.clientX, y = e.clientY;
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';

  // Ajustar si sale de pantalla
  const r = menu.getBoundingClientRect();
  if (r.right  > window.innerWidth)  menu.style.left = (x - r.width)  + 'px';
  if (r.bottom > window.innerHeight) menu.style.top  = (y - r.height) + 'px';

  byId('ctx-query').onclick   = () => { closeCtxMenu(); openQuery(nick); };
  byId('ctx-whois').onclick   = () => { closeCtxMenu(); send({ type: 'WHOIS', nick }); };
  byId('ctx-mention').onclick = () => { closeCtxMenu(); byId('chat-input').value += nick + ': '; byId('chat-input').focus(); };
  byId('ctx-kick').onclick    = () => { closeCtxMenu(); send({ type: 'KICK', channel: state.currentWin, nick, reason: '' }); };
}

function closeCtxMenu() {
  byId('ctx-menu').classList.add('hidden');
}

/* ─── Privados ─── */

function openQuery(nick) {
  ensureWindow(nick, 'private');
  switchWindow(nick);
}

/* ─── Diálogos ─── */

function showJoinDialog() {
  showModal('Unirse a canal', `
    <label>Nombre del canal</label>
    <input type="text" id="md-chan" placeholder="#hispano" autocomplete="off">
  `, () => {
    const ch = byId('md-chan').value.trim();
    if (ch) send({ type: 'JOIN', channel: ch.startsWith('#') ? ch : '#' + ch });
  });
  setTimeout(() => byId('md-chan')?.focus(), 50);
}

function showQueryDialog() {
  showModal('Mensaje privado', `
    <label>Nick destino</label>
    <input type="text" id="md-nick" placeholder="Nick del usuario" autocomplete="off">
  `, () => {
    const nick = byId('md-nick').value.trim();
    if (nick) openQuery(nick);
  });
  setTimeout(() => byId('md-nick')?.focus(), 50);
}

function showModal(title, body, onOk) {
  byId('modal-title').textContent = title;
  byId('modal-body').innerHTML    = body;
  byId('modal-ok').onclick        = () => { onOk(); closeModal(); };
  byId('modal-overlay').classList.remove('hidden');
  // Enter en inputs del modal
  byId('modal-body').querySelectorAll('input').forEach(inp => {
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { onOk(); closeModal(); } });
  });
}

function closeModal() {
  byId('modal-overlay').classList.add('hidden');
}

/* ─── Subida de archivos ─── */

async function uploadFile(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  if (file.size > 25 * 1024 * 1024) { addErrMsg(state.currentWin, 'El archivo supera el límite de 25 MB'); return; }

  const target = state.currentWin;
  if (!target || target === '*status*') { addErrMsg(state.currentWin, 'Únete a un canal primero'); return; }

  addSystemMsg(target, `Subiendo ${esc(file.name)}...`);

  try {
    const form = new FormData();
    form.append('file', file);

    const resp = await fetch('/upload', { method: 'POST', body: form });
    if (!resp.ok) { const err = await resp.json(); throw new Error(err.error || 'Error al subir'); }

    const data = await resp.json();
    const url  = location.origin + data.url;
    const msg  = data.isImage
      ? `[Imagen] ${esc(data.filename)} → ${url}`
      : `[Archivo] ${esc(data.filename)} (${(data.size/1024).toFixed(1)} KB) → ${url}`;

    // Enviar URL al canal
    send({ type: 'PRIVMSG', target, text: msg });

    // Mostrar localmente
    if (data.isImage) {
      addImageMsg(target, state.nick, data.url, data.filename);
    } else {
      addChatMsg(target, state.nick, msg, true, false);
    }
  } catch (e) {
    addErrMsg(target, 'Error subiendo archivo: ' + e.message);
  }
}

function addImageMsg(winId, nick, url, filename) {
  const safeUrl  = encodeURI(url).replace(/'/g, '%27');
  const safeName = esc(filename);
  appendMsg(winId,
    `<span class="msg-ts">${ts()}</span>
     <span class="msg-nick own" style="color:${nickToColor(nick)}">${esc(nick)}</span>
     <span class="msg-sep">│</span>
     <span class="msg-text">
       <a href="${safeUrl}" class="file-link" target="_blank" rel="noopener noreferrer">${safeName}</a><br>
       <img class="inline-img" src="${safeUrl}" alt="${safeName}" loading="lazy">
     </span>`,
    'own'
  );
  scrollToBottom(winId);
}

/* ─── Renderizado de texto ─── */

function renderText(text, winId) {
  // 1. Escapar HTML
  let out = esc(text);

  // 2. URLs — validar protocolo explícitamente (solo http/https)
  out = out.replace(
    /https?:\/\/[^\s<>"'&]+/g,
    url => {
      // Verificar que es una URL http/https válida (doble comprobación de protocolo)
      try {
        const parsed = new URL(url.replace(/&amp;/g, '&'));
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url;
      } catch { return url; }

      const safeUrl = url.replace(/'/g, '%27');
      // Si es imagen, mostrar inline
      if (/\.(jpg|jpeg|png|gif|webp|svg)(\?[^\s<>"'&]*)?$/i.test(url)) {
        return `<a href="${safeUrl}" class="file-link" target="_blank" rel="noopener noreferrer">${url}</a><br>` +
               `<img class="inline-img" src="${safeUrl}" alt="imagen" loading="lazy">`;
      }
      return `<a href="${safeUrl}" class="file-link" target="_blank" rel="noopener noreferrer">${url}</a>`;
    }
  );

  // 3. Colores mIRC (\x03CC,CC texto \x03)
  out = parseMIRCColors(out);

  // 4. Bold \x02, italic \x1D, underline \x1F, reset \x0F
  out = out
    .replace(/\x02([^\x02]*)\x02?/g, '<span class="mirc-bold">$1</span>')
    .replace(/\x1D([^\x1D]*)\x1D?/g, '<span class="mirc-italic">$1</span>')
    .replace(/\x1F([^\x1F]*)\x1F?/g, '<span class="mirc-underline">$1</span>')
    .replace(/\x0F/g, '</span>');

  // 5. Highlight de menciones
  if (state.nick) {
    const re = new RegExp(`(${escapeRegex(state.nick)})`, 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  }

  return out;
}

function parseMIRCColors(text) {
  // \x03[fg][,bg]text
  return text.replace(/\x03(\d{1,2})(?:,(\d{1,2}))?([^\x03]*)/g, (_, fg, bg, t) => {
    const cls = `mirc-${parseInt(fg, 10)}`;
    return `<span class="${cls}">${t}</span>`;
  });
}

/* ─── Utilidades ─── */

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function byId(id) { return document.getElementById(id); }

function cssId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function scrollToBottom(winId) {
  const el = byId('win-' + cssId(winId));
  if (el) el.scrollTop = el.scrollHeight;
}

function clearWindow(winId) {
  const el = byId('win-' + cssId(winId));
  if (el) el.innerHTML = '';
}

function setStatus(msg) {
  byId('sb-status').textContent = msg;
}

function setConnectStatus(msg, isError) {
  const el = byId('connect-status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? 'var(--red)' : 'var(--text-dim)';
}

function updateSidebarBadge(winId, count) {
  const el = document.querySelector(`.tree-item[data-target="${CSS.escape(winId)}"]`);
  if (!el) return;
  el.classList.add('unread');
  let badge = el.querySelector('.ti-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'ti-badge';
    el.appendChild(badge);
  }
  badge.textContent = count > 99 ? '99+' : count;
}

function markMention(winId) {
  const el = document.querySelector(`.tree-item[data-target="${CSS.escape(winId)}"]`);
  el?.classList.add('mention');
}

function send(obj) {
  if (state.ws && state.ws.connected) {
    state.ws.emit('msg', obj);
  }
}

// Nick → color determinista
function nickToColor(nick) {
  const COLORS = ['#79c0ff','#3fb950','#d29922','#f78166','#bc8cff','#56d364','#e3b341','#58a6ff','#ff9f77','#ffa657'];
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) & 0xffff;
  return COLORS[h % COLORS.length];
}

/* ─── Visor de imágenes ─── */

function showImageViewer(src) {
  let viewer = byId('img-viewer');
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'img-viewer';
    viewer.addEventListener('click', () => viewer.remove());
    document.body.appendChild(viewer);
  }
  viewer.innerHTML = `<img src="${encodeURI(src).replace(/'/g,'%27')}" alt="imagen ampliada">`;
  viewer.style.display = 'flex';
}

/* ─── Notificaciones ─── */

function notifyMention(nick, text) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(`IRC — ${nick}`, { body: text.slice(0, 100), tag: 'irc-mention' });
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
}
