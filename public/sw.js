/* Service worker do Portal B2B (app instalável).
   Regra de segurança: NADA da API, do Supabase ou das telas com dados do cliente
   é guardado aqui. Tudo vai direto para a rede; o único arquivo guardado é a
   página "Sem conexão" e os ícones, usados quando o celular está sem internet. */
const CACHE = 'sr-app-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/icones/icone-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  // Só as aberturas de página (navegação) recebem a tela "Sem conexão" quando falham.
  // Qualquer outra chamada não passa pelo service worker.
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
