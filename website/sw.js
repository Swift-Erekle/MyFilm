const CACHE_VERSION = 'myfilm-shell-v1.1.3';
const APP_SHELL = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/css/style.css',
  '/js/config.js',
  '/js/custom_animes.js',
  '/js/router.js',
  '/js/api.js',
  '/js/platform.js',
  '/js/player_v3.js',
  '/js/ui.js',
  '/js/home.js',
  '/js/browse.js',
  '/js/detail_v3.js',
  '/js/search_v3.js',
  '/js/pwa.js',
  '/js/tv-navigation.js'
];

const NEVER_CACHE_PATHS = [
  '/api/', '/imovs', '/imovs-series', '/animeb', '/animes', '/animetv',
  '/animetv_page', '/play', '/hls', '/hlsseg', '/hlskey'
];

function mustUseNetwork(url, request) {
  if (request.method !== 'GET') return true;
  if (request.destination === 'video' || request.headers.has('range')) return true;
  return NEVER_CACHE_PATHS.some(path => url.pathname === path || url.pathname.startsWith(path));
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || mustUseNetwork(url, request)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request)
      .then(response => response.ok ? response : Promise.reject(new Error(`navigation_${response.status}`)))
      .catch(async () => (await caches.match(request)) || (await caches.match('/')) || caches.match('/offline.html')));
    return;
  }

  if (!['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)) return;
  event.respondWith(caches.match(request).then(cached => {
    const refreshed = fetch(request).then(response => {
      if (response.ok) caches.open(CACHE_VERSION).then(cache => cache.put(request, response.clone()));
      return response;
    }).catch(() => cached);
    return cached || refreshed;
  }));
});
