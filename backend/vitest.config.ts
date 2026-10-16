import { defineConfig } from "vitest/config";

// Os testes usam os emuladores de verdade do Firestore e do Auth (sem
// simulação) -- estas variáveis precisam estar valendo antes de qualquer
// teste importar o db/firestore.ts, que chama initializeApp() assim que é
// carregado. O Vitest aplica o `test.env` antes de carregar os arquivos de
// teste, então dá tempo.
//
// Pra rodar os testes: os emuladores precisam já estar ligados
// (`npm run emulators` na raiz do repositório, ou `npm run dev`), igual aos
// scripts de conferência que o projeto sempre usou -- OU rode pelo
// `firebase emulators:exec` (ver o script "test:backend" no package.json da
// raiz), que liga os emuladores, roda tudo e desliga de novo, de uma vez
// (é assim no CI).
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 20_000,
    env: {
      FIREBASE_PROJECT_ID: "demo-par",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    },
  },
});
