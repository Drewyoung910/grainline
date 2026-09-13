const CACHE_NAME = "grainline-offline-v2";
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [OFFLINE_URL, "/manifest.json", "/favicon.png", "/icon-192.png", "/icon-512.png"];
const STATIC_ASSET_PATHS = new Set(PRECACHE_URLS.filter((url) => url !== OFFLINE_URL));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(OFFLINE_URL)) || Response.error();
      }),
    );
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin && STATIC_ASSET_PATHS.has(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const fresh = await fetch(new Request(request, { cache: "reload" }));
          if (fresh.ok) await cache.put(request, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(request)) || Response.error();
        }
      })(),
    );
  }
});
