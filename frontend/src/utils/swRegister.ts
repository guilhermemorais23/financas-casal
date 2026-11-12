// Registra o service worker e liga a checagem de versão nova a cada volta
// pro app (a lógica e o porquê estão em ./swUpdate.ts). Separado pra os
// testes não precisarem do módulo virtual do vite-plugin-pwa.
import { registerSW } from "virtual:pwa-register";
import { createUpdateWatcher, type Watcher } from "./swUpdate";

export function initServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  let watcher: Watcher | null = null;
  registerSW({
    immediate: true,
    onNeedReload: () => watcher?.needReload() ?? window.location.reload(),
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      watcher = createUpdateWatcher({ update: () => registration.update(), reload: () => window.location.reload() });
      const check = () => {
        if (document.visibilityState === "visible") watcher?.check();
      };
      document.addEventListener("visibilitychange", check);
      window.addEventListener("focus", check);
      window.addEventListener("pageshow", check);
    },
  });
}
