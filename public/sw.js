// Service Worker: macht die App-Shell offline verfügbar.
// Trainingsdaten selbst liegen in IndexedDB (Outbox) und werden von der App synchronisiert –
// der Service Worker cached bewusst KEINE API-Antworten.

const VERSION = "v1";
const PAGES = `gym-pages-${VERSION}`;
const STATIC = `gym-static-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== PAGES && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Nur erfolgreiche, nicht umgeleitete Antworten cachen (z. B. keine Weiterleitung zum Login).
function cacheable(response) {
  return response.ok && response.type === "basic" && !response.redirected;
}

// Seiten: Netz zuerst (immer aktuell), offline die zuletzt gesehene Version.
async function handleNavigation(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (cacheable(response)) cache.put(request.url.split("?")[0], response.clone());
    return response;
  } catch {
    return (await cache.match(request.url.split("?")[0])) ?? (await cache.match(OFFLINE_URL)) ?? Response.error();
  }
}

// Gehashte Build-Dateien ändern sich nie → Cache zuerst.
async function handleStatic(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (cacheable(response)) cache.put(request, response.clone());
  return response;
}

// Icons, Manifest: sofort aus dem Cache, im Hintergrund aktualisieren.
async function handleAsset(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (cacheable(response)) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached ?? Response.error());
  return cached ?? network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
  } else if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStatic(request));
  } else if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(handleAsset(request));
  }
});
