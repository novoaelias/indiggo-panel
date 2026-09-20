self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// No se cachean /api ni respuestas privadas. El service worker sólo recibe push.
self.addEventListener("push", (event) => {
  let data = {
    title: "Indiggo Store",
    body: "Hay algo nuevo que necesita tu atención.",
    url: "/",
  };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: "/brand/logo-full.png",
        badge: "/brand/logo-full.png",
        data: { url: data.url || "/" },
        tag: data.url || "indiggo",
      }),
      data.badge != null && self.registration.setAppBadge
        ? self.registration.setAppBadge(data.badge)
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => client.url.startsWith(self.location.origin));
      if (open) {
        open.navigate(target);
        return open.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
