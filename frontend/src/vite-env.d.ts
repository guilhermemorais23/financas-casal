/// <reference types="vite/client" />

// Diz ao TypeScript quais variáveis de ambiente o app usa e de que tipo são.
// Os valores vêm do frontend/.env no seu PC (copiado do .env.example) e dos
// secrets do GitHub no build de produção (.github/workflows/ci.yml). Se você
// criar uma variável nova, declare aqui também -- senão o editor não sabe que
// ela existe e não avisa quando o nome está errado.
interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_AUTH_EMULATOR_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
