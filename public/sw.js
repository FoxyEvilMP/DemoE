// Online-first PWA. Do not cache documents, API calls, sessions or personal data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Е-Шлюз</title><body style="font:18px system-ui;background:#122d26;color:white;padding:12vw"><h1>Нет подключения</h1><p>Для обмена документами нужен интернет. Восстановите соединение и обновите страницу.</p><button onclick="location.reload()">Повторить</button></body></html>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )));
});
