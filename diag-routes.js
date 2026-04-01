'use strict';
module.exports = function(app) {
  const net = require('net');
  const tls = require('tls');

  app.get('/diag', async (req, res) => {
    const tcp = (h, p, ssl) => new Promise(r => {
      const t = setTimeout(() => r({ ok: false, e: 'timeout' }), 6000);
      try {
        const s = ssl ? tls.connect(p, h, { rejectUnauthorized: false }) : net.connect(p, h);
        s.once('connect', () => { clearTimeout(t); s.destroy(); r({ ok: true }); });
        s.once('error', e => { clearTimeout(t); r({ ok: false, e: e.message }); });
      } catch(e) { clearTimeout(t); r({ ok: false, e: e.message }); }
    });
    const [a, b, c] = await Promise.all([
      tcp('irc.irc-hispano.org', 6667, false),
      tcp('irc.irc-hispano.org', 6697, true),
      tcp('kiwi.chathispano.com', 9000, false),
    ]);
    res.json({ 'irc-6667': a, 'irc-6697ssl': b, 'kiwi-9000': c });
  });

  app.get('/test-irc', async (req, res) => {
    const CRLF = Buffer.from([13, 10]);
    const lines = [];
    await new Promise(resolve => {
      const t = setTimeout(() => resolve(), 18000);
      const nick = 'Diag' + (Date.now() % 9999);
      try {
        const s = tls.connect(6697, 'irc.irc-hispano.org', { rejectUnauthorized: false }, () => {
          s.write(Buffer.concat([Buffer.from('NICK ' + nick), CRLF]));
          s.write(Buffer.concat([Buffer.from('USER diag 0 * :Test'), CRLF]));
        });
        let buf = Buffer.alloc(0);
        s.on('data', chunk => {
          buf = Buffer.concat([buf, chunk]);
          let idx;
          while ((idx = buf.indexOf('\r\n')) !== -1) {
            const line = buf.slice(0, idx).toString('utf8');
            buf = buf.slice(idx + 2);
            lines.push(line);
            if (line.startsWith('PING ')) {
              s.write(Buffer.concat([Buffer.from('PONG ' + line.slice(5)), CRLF]));
            }
            if (lines.length >= 35 || /^ERROR| 001 | 465 | 464 /.test(line)) {
              clearTimeout(t); s.destroy(); resolve();
            }
          }
        });
        s.on('error', e => { lines.push('ERR: ' + e.message); clearTimeout(t); resolve(); });
      } catch(e) { lines.push('CATCH: ' + e.message); resolve(); }
    });
    res.json({ lines });
  });

  // Test el flujo EXACTO de la app (usa el mismo IRCClient)
  app.get('/test-app', async (req, res) => {
    const { IRCClient } = require('./lib/irc');
    const result = await new Promise(resolve => {
      const t = setTimeout(() => resolve({ error: 'timeout 25s' }), 25000);
      const irc = new IRCClient({});

      irc.on('connected', nick => {
        clearTimeout(t);
        irc.quit('test');
        resolve({ ok: true, nick, msg: 'Conectado correctamente' });
      });
      irc.on('error', msg => {
        clearTimeout(t);
        irc.destroy();
        resolve({ error: msg });
      });
      irc.on('banned', msg => {
        clearTimeout(t);
        irc.destroy();
        resolve({ banned: true, msg });
      });
      irc.on('status', msg => console.log('[test-app status]', msg));

      irc.connect().catch(e => {
        clearTimeout(t);
        resolve({ error: 'connect() threw: ' + e.message });
      });
    });
    res.json(result);
  });
};
