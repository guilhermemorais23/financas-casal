// Mantém o app instalado no celular (tela de início) na versão mais nova.
//
// O service worker já se atualiza sozinho (autoUpdate), mas o navegador só
// PROCURA uma versão nova quando a página carrega do zero -- e o app da tela
// de início quase nunca recarrega: no iPhone ele volta do segundo plano de
// onde parou. Resultado: o PC já tinha a versão nova e o celular continuava
// na antiga por dias.
//
// Aqui: toda vez que o app volta pra tela (abrir de novo, trocar de app e
// voltar) ele pergunta se há versão nova. Quando a nova assume, recarrega --
// mas nunca com a pessoa digitando: aí espera ela sair do campo ou do app.
// No máximo uma consulta por minuto (voltar pro app várias vezes seguidas
// não vira várias idas ao servidor).
const MIN_INTERVAL_MS = 60_000;

export type Watcher = {
  // Chamar quando o app volta a ficar visível/focado.
  check: () => void;
  // A versão nova assumiu: recarrega agora ou assim que der.
  needReload: () => void;
};

function isTyping(doc: Document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}

export function createUpdateWatcher(deps: {
  update: () => Promise<unknown>;
  reload: () => void;
  doc?: Document;
  now?: () => number;
}): Watcher {
  const doc = deps.doc ?? document;
  const now = deps.now ?? Date.now;
  let lastCheck = -Infinity;
  let pendingReload = false;

  const reloadIfSafe = () => {
    if (pendingReload && !isTyping(doc)) {
      pendingReload = false;
      deps.reload();
    }
  };

  // Saiu do campo ou do app: se a versão nova estava esperando, é a hora.
  doc.addEventListener("focusout", () => setTimeout(reloadIfSafe, 0));
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "hidden") reloadIfSafe();
  });

  return {
    check() {
      if (now() - lastCheck < MIN_INTERVAL_MS) return;
      lastCheck = now();
      deps.update().catch(() => {
        // sem rede ou servidor fora: tenta de novo na próxima volta
      });
      reloadIfSafe();
    },
    needReload() {
      pendingReload = true;
      reloadIfSafe();
    },
  };
}
