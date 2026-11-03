import http from 'node:http';
import { t } from './i18n.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Watcher } from './watcher.js';

export async function createApp({ watcher = new Watcher(), port = 8989, host = '127.0.0.1', savePreferences = async () => {} } = {}) {
  const pageUrl = new URL('./ui.html', import.meta.url);
  const subscribers = new Set();
  const controls = new Set();
  let closeTimer;
  let closing = false;
  let transition = false;
  const server = http.createServer(async (request, response) => {
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'");
    const send = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };
    if (request.headers.host !== `127.0.0.1:${address.port}`) { send(403, { error: t('localOnly') }); return; }
    if (request.method === 'GET' && ['/', '/overlay'].includes(request.url)) {
      try {
        const page = await readFile(pageUrl);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(page);
      } catch { send(500, { error: 'Could not load the control page.' }); }
      return;
    }
    if (request.method === 'GET' && request.url === '/api/state') { send(200, watcher.publicState()); return; }
    if (request.method === 'GET' && ['/events', '/events?overlay=1'].includes(request.url)) {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive' });
      subscribers.add(response);
      if (request.url === '/events') { controls.add(response); clearTimeout(closeTimer); }
      response.write('data: ' + JSON.stringify(watcher.publicState()) + '\n\n');
      request.on('close', () => {
        subscribers.delete(response); controls.delete(response);
        if (!controls.size && !closing) closeTimer = setTimeout(() => {
          if (!controls.size && watcher.running) watcher.stop(t('controlPageClosed'));
        }, 5000);
      }); return;
    }
    if (request.method === 'POST' && ['/api/start', '/api/stop', '/api/language'].includes(request.url)) {
      if (request.headers.origin !== origin) { send(403, { error: t('sameOriginOnly') }); return; }
      if (transition) { send(409, { error: t('busySwitching') }); return; }
      transition = true;
      try {
        let body = '';
        for await (const chunk of request) { body += chunk; if (body.length > 4096) throw new Error(t('inputTooLong')); }
        const data = body ? JSON.parse(body) : {};
        if (request.url === '/api/start') {
          await watcher.start(data.frequency, { includedOnlyConfirmed: data.includedOnlyConfirmed === true, model: data.model, tone: data.tone, language: data.language });
          await savePreferences({ model: watcher.model, tone: watcher.tone, language: watcher.language, includedOnlyConfirmed: watcher.includedOnlyConfirmed });
        } else if (request.url === '/api/language') {
          // Switches the page language while stopped; the watcher refuses while running.
          watcher.setLanguage(data.language);
          await savePreferences({ language: watcher.language });
        } else watcher.stop();
        send(200, watcher.publicState());
      } catch (error) { if (request.url === '/api/language') { send(400, { error: error.message }); return; }
        if (watcher.running) watcher.stop(error.message); else { watcher.message = error.message; watcher.publish(); } send(400, { error: error.message }); }
      finally { transition = false; }
      return;
    }
    send(404, { error: t('notFound') });
  });
  const listener = state => {
    for (const response of subscribers) response.write('data: ' + JSON.stringify(state) + '\n\n');
  };
  watcher.listeners.add(listener);
  await watcher.connect();
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  } catch (error) { await watcher.close(); throw error; }
  const timer = setInterval(() => { void watcher.poll(); }, 2500);
  const keepalive = setInterval(() => { for (const response of subscribers) response.write(': alive\n\n'); }, 15000);
  void watcher.poll();
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      closing = true;
      clearInterval(timer); clearInterval(keepalive); clearTimeout(closeTimer); watcher.listeners.delete(listener);
      for (const response of subscribers) response.end();
      await watcher.close();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.COMMENTATOR_PORT ?? 8989);
  const bridgePort = Number(process.env.BIZHAWK_PORT ?? 8766);
  if (![port, bridgePort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)) throw new Error(t('badPort'));
  let preferences = {};
  try { preferences = JSON.parse(await readFile(new URL('../runtime/commentator/preferences.json', import.meta.url), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const app = await createApp({ port, watcher: new Watcher({ port: bridgePort, includedOnlyConfirmed: preferences.includedOnlyConfirmed === true, model: preferences.model ?? 'sonnet', tone: preferences.tone, language: preferences.language }),
    savePreferences: async update => {
      preferences = { ...preferences, ...update };
      await mkdir(new URL('../runtime/commentator/', import.meta.url), { recursive: true });
      await writeFile(new URL('../runtime/commentator/preferences.json', import.meta.url), JSON.stringify(preferences, null, 2), 'utf8');
    },
  });
  console.log(`BizHawk Commentator: ${app.url}`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await app.close(); };
  process.on('SIGINT', () => { void close(); });
  process.on('SIGTERM', () => { void close(); });
}
