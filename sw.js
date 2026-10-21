/**
 * Service worker. Network-first, falling back to cache.
 *
 * Cache-first is the usual advice for an app shell, but it serves a stale
 * exercise library forever while the project is still being edited, and the
 * failure is silent — you get a short workout and no error. Network-first keeps
 * the gym case working (the cache is populated on every successful load, and a
 * basement with no signal falls straight through to it) at the cost of a slower
 * first paint when online. For a personal tool that is the right trade.
 */

var CACHE = 'singularity-v5';

var SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './engine.js',
  './stats.js',
  './exercise-library.json',
  './program.json',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      // offline: serve whatever we last saw, and fall back to the shell for navigations
      return caches.match(e.request).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
