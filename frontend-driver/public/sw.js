/**
 * قُفّة — Service Worker بسيط.
 *
 * مبادئ الأمان:
 *  - لا نخزّن أي استجابة من /api في الكاش (بيانات الطلبات والحسابات حسّاسة).
 *  - لا ننفّذ أي عملية إنشاء أو تعديل أثناء انقطاع الشبكة.
 *  - الكاش مخصّص لملفات الواجهة الثابتة فقط + صفحة بديلة عند انقطاع الاتصال.
 */
const CACHE = 'qoffa-driver-v1';
const APP_SHELL = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // لا نتدخّل في POST/PATCH إطلاقًا

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return; // بيانات حسّاسة: شبكة فقط، بلا كاش

  // التنقّل: الشبكة أولًا، وعند الانقطاع صفحة بديلة
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  // الأصول الثابتة: من الكاش أولًا ثم تحديثه في الخلفية
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
