// Testes do frontend: os componentes de verdade, num Chromium de verdade
// (Vitest no modo navegador + Playwright). Num navegador real dá pra medir a
// tela -- é o que pega botão por cima de texto, coisa que jsdom não vê.
// A API e o login são falsos (src/test/), então não precisa de backend nem
// do emulador. Rodar: `npm test` (ou `npm run test:watch`).
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify("test") },
  // O app não usa PostCSS. Sem isto o Vite sai procurando a config nas
  // pastas de cima e, no OneDrive, esbarra em arquivo que não dá pra ler.
  css: { postcss: {} },
  test: {
    include: ["src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
      // Celular comum; cada teste pode mudar com page.viewport().
      viewport: { width: 390, height: 844 },
    },
  },
});
