// Captura as telas do vídeo de apresentação (promo/video/public/telas/).
// Não é teste e não roda no CI: `npm run promo:telas`.
// Mesmo esquema dos testes (telas de verdade, API e login falsos), com
// densidade 2x pra ficar nítido em 1080p.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? "1.51.0"), __APP_COMMIT__: JSON.stringify("") },
  css: { postcss: {} },
  // As capturas vão pra pasta do vídeo, fora do frontend/.
  server: { fs: { allow: [".", "../promo/video/public"] } },
  test: {
    include: ["src/promo/**/*.promo.tsx"],
    setupFiles: ["src/test/setup.ts"],
    testTimeout: 30000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ contextOptions: { deviceScaleFactor: 2, viewport: { width: 1280, height: 1400 } } }),
      instances: [{ browser: "chromium" }],
      viewport: { width: 430, height: 932 },
    },
  },
});
