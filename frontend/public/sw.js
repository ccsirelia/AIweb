const CACHE_VERSION = "aiweb-pwa-v2";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [OFFLINE_URL, "/icon.svg", "/icons/icon-192.png"];
const PUBLIC_SHELL_PATHS = new Set(["/", "/login", "/register"]);

function isForbiddenPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function isCacheableResponse(response) {
  if (!response || !response.ok || response.type !== "basic") return false;

  const cacheControl = response.headers.get("Cache-Control") || "";
  return !/no-store|private/i.test(cacheControl);
}

function isStaticAsset(request, url) {
  if (url.origin !== self.location.origin) return false;

  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/images/") ||
    url.pathname === "/icon.svg" ||
    ["font", "image", "script", "style"].includes(request.destination)
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("aiweb-pwa-") && key !== SHELL_CACHE && key !== STATIC_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (
    url.origin !== self.location.origin ||
    isForbiddenPath(url.pathname) ||
    request.headers.has("Authorization")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (PUBLIC_SHELL_PATHS.has(url.pathname) && isCacheableResponse(response)) {
            const copy = response.clone();
            event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)));
          }
          return response;
        })
        .catch(async () => {
          const cachedPage = PUBLIC_SHELL_PATHS.has(url.pathname)
            ? await caches.match(request, { ignoreSearch: true })
            : undefined;
          return cachedPage || caches.match(OFFLINE_URL);
        })
    );
    return;
  }

  if (!isStaticAsset(request, url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        if (isCacheableResponse(response)) {
          const copy = response.clone();
          event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      });
    })
  );
});
