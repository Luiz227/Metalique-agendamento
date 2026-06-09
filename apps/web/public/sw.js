const CACHE_NAME = "agenda-metalique-v3";
const APP_SHELL = ["/", "/login", "/manifest.webmanifest", "/images/logo-metalique-256.png", "/favicon.ico"];

function isNavigationRequest(request) {
  return request.mode === "navigate" || request.headers.get("accept")?.includes("text/html");
}

async function updateCache(request, response) {
  if (!response || !response.ok) return response;
  if (request.method !== "GET") return response;
  if (new URL(request.url).origin !== self.location.origin) return response;

  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch {
    // Ignora erros de cache para nao quebrar a renderizacao do app.
  }

  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => updateCache(request, response))
        .catch(async () => (await caches.match(request)) || (await caches.match("/")) || Response.error())
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => updateCache(request, response))
      .catch(async () => (await caches.match(request)) || Response.error())
  );
});
