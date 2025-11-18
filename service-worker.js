const CACHE_NAME = "chris-diary-cache-v1.2.1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./crypto.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Install event: cache core assets
self.addEventListener("install", event => {
  console.log("[SW] Installing...");

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );

  // 🟢 Force this service worker to become active immediately
  self.skipWaiting();
});

// Activate event: clean old caches
self.addEventListener("activate", event => {
  console.log("[SW] Activating...");

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );

  // 🟢 Take control of existing pages right away
  self.clients.claim();
});

// Fetch event: serve from cache, then network fallback
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => 
      response || fetch(event.request)
    )
  );
});

