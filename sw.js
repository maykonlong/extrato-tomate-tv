/* Cache do casco (HTML/CSS/JS). Vídeo nunca é cacheado: HLS em cache quebra a retomada. */
var CACHE = 'extrato-shell-v1';
var SHELL = ['./','./index.html','./styles.css','./app.js','./config.js','./catalog.json',
             './manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) {
    return cache.addAll(SHELL).catch(function () {});
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (event) {
  var url = event.request.url;
  if (url.indexOf('.m3u8') >= 0 || url.indexOf('.ts') >= 0 || url.indexOf('.mp4') >= 0) {
    return; // mídia: direto da rede
  }
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request).then(function (response) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); }).catch(function () {});
        return response;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
