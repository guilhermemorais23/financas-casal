import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Configuração do Vite: a ferramenta que roda o app no seu PC (`npm run dev`,
// em http://localhost:5173) e monta a versão final pra publicar (`npm run
// build`, que gera a pasta dist/). As variáveis VITE_* dos arquivos .env são
// lidas pelo Vite sozinho; não precisa configurar nada aqui pra elas.

// A versão fica no package.json da raiz do repositório (o semantic-release
// sobe sozinho), não no deste pacote -- o frontend/package.json fica em
// 0.0.0 porque nunca é publicado sozinho.
const rootPackageJson = JSON.parse(readFileSync('../package.json', 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // O manifest.json e a tag <link> dele já existem feitos à mão em
      // public/manifest.json e no index.html (ícones, nome, cor do tema) --
      // este plugin só precisa gerar e registrar o service worker, não um
      // segundo manifest.
      manifest: false,
      injectRegister: 'auto',
      workbox: {
        // Guarda de antemão só os arquivos estáticos deste build (JS, CSS,
        // fontes, ícones) -- de propósito sem runtimeCaching, então os
        // pedidos /api/* passam direto pelo service worker e sempre vão à
        // rede. O app já tem o próprio cache por usuário, que mostra o velho
        // enquanto busca o novo (utils/pageCache.ts), pros dados da API;
        // deixar o service worker guardar respostas da API também seria um
        // segundo cache, sem combinação com o primeiro, na frente dos números
        // de um app de finanças.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // O autoUpdate já chama skipWaiting/clientsClaim, então um deploy
        // novo (backend e frontend saem a cada push no master, ver
        // .github/workflows/ci.yml) vale na próxima navegação, em vez de
        // alguém ficar preso num pacote velho pra sempre.
        cleanupOutdatedCaches: true,
        // Notificações no celular: push + clique (public/push-sw.js).
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(rootPackageJson.version),
  },
})
