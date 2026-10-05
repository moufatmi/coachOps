// Bump this whenever the shell or an icon changes. A new name makes the activate
// handler below delete the previous cache outright, so no stale asset survives.
const CACHE_NAME = "coachops-cache-v2";

self.addEventListener("install", (event) => {
  // skipWaiting is deliberately NOT called here. Without it an installed PWA
  // keeps serving the previous version indefinitely, which is how a coach ends
  // up staring at an old UI wondering why a fix never arrived. The new worker
  // takes over on the next navigation instead, which is immediate enough and
  // never swaps code out from under a screen mid-render.
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(["/"])));
});

self.addEventListener("activate", (event) => {
  // Bumping CACHE_NAME drops every older cache on activation, so the ball icon
  // and any previous asset cannot survive a release.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("/"))),
  );
});
