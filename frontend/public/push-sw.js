// Notificações do PAR. (Web Push). Carregado pelo service worker do app
// (vite.config.ts > workbox.importScripts).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "PAR.", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "PAR.";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/favicon-32.png",
      tag: data.tag || undefined,
      // Botões ("Já paguei" / "Lembrar depois"): cada um abre a sua tela.
      // No iPhone não aparecem; tocar na notificação abre `url`.
      actions: Array.isArray(data.actions)
        ? data.actions.slice(0, 2).map((a) => ({ action: String(a.action), title: String(a.title) }))
        : [],
      data: {
        url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/dashboard",
        actionUrls: Array.isArray(data.actions)
          ? Object.fromEntries(
              data.actions
                .filter((a) => typeof a.url === "string" && a.url.startsWith("/"))
                .map((a) => [String(a.action), a.url])
            )
          : {},
      },
    })
  );
});

// Tocar na notificação abre (ou traz pra frente) o app na tela certa.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = (event.action && data.actionUrls && data.actionUrls[event.action]) || data.url || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if (new URL(win.url).origin === self.location.origin && "focus" in win) {
          win.navigate(url);
          return win.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
