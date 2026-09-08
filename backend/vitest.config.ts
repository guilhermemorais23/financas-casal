import { defineConfig } from "vitest/config";

// Tests hit the real Firestore/Auth emulators (no mocking) -- these env
// vars have to land before any test file imports db/firestore.ts, which
// calls initializeApp() at module load time. Vitest applies `test.env`
// before loading test files, so this is early enough.
//
// Running tests: the emulators must already be up (`npm run emulators` at
// the repo root, or `npm run dev`), same as every scratch verification
// script this project has used all along -- OR run via
// `firebase emulators:exec` (see root package.json's "test:backend"
// script), which starts them, runs the suite, and tears them down again
// for a one-shot/CI run.
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
