/* Casco em cache, mas sempre tentando a rede primeiro: JS velho em TV dá bug fantasma. */
var CACHE = 'extrato-shell-v2';
var SHELL = ['./','./index.html','./styles.css','./app.js','./tomato.js','./config.js',
             './catalog.json','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];

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
    return; // mídia nunca em cache
  }
  if (event.request.method !== 'GET' || url.indexOf('prod-api') >= 0) {
    return; // API sempre na rede
  }
  event.respondWith(
    fetch(event.request).then(function (response) {
      var copy = response.clone();
      caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); }).catch(function () {});
      return response;
    }).catch(function () {
      return caches.match(event.request).then(function (cached) {
        return cached || caches.match('./index.html');
      });
    })
  );
});
