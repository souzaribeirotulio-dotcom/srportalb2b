/* Service worker do Portal B2B (app instalável).
   Regra de segurança: NADA da API, do Supabase ou das telas com dados do cliente
   é guardado aqui. Tudo vai direto para a rede; o único arquivo guardado é a
   página "Sem conexão" e os ícones, usados quando o celular está sem internet. */
const CACHE = 'sr-app-v4';
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

/* Avisos no celular: mostra a notificação que chegou e, ao tocar, abre o portal na página do aviso. */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { texto: e.data ? e.data.text() : '' }; }
  const titulo = d.titulo || 'Souza Ribeiro';
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.texto || '',
    icon: '/icones/icone-192.png',
    badge: '/icones/icone-192.png',
    tag: typeof d.tag === 'string' ? d.tag : undefined,
    data: { url: typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/' },
    // Aviso de venda do executivo: vibra no Android (o som é o padrão de notificação do celular)
    // e toca de novo mesmo com o mesmo "tag".
    ...(d.som === 'venda' ? { vibrate: [180, 90, 180, 90, 320], renotify: !!d.tag, silent: false } : {}),
  }).then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    // App aberto na tela: avisa a página, que toca o "plim" de venda.
    .then((lista) => { if (d.som === 'venda') for (const c of lista) c.postMessage({ tipo: 'sr-aviso', som: 'venda' }); }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    for (const c of lista) { if ('focus' in c) { c.navigate(destino).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(destino);
  }));
});
