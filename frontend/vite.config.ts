import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// The version lives in the repo root's package.json (bumped automatically
// by semantic-release), not this package's own -- frontend/package.json
// stays at 0.0.0 since it's never published on its own.
const rootPackageJson = JSON.parse(readFileSync('../package.json', 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // manifest.json + its <link> tag already exist by hand in
      // public/manifest.json and index.html (icons, name, theme color) --
      // this plugin only needs to generate and register the service
      // worker, not a second manifest.
      manifest: false,
      injectRegister: 'auto',
      workbox: {
        // Precache only this build's own static output (JS/CSS/fonts/
        // icons) -- deliberately no runtimeCaching entries, so /api/*
        // requests are untouched by the service worker and always hit the
        // network. This app already has its own per-user
        // stale-while-revalidate cache (utils/pageCache.ts) for API data;
        // letting a service worker cache API responses too would be a
        // second, uncoordinated cache in front of a finance app's numbers.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // autoUpdate already calls skipWaiting/clientsClaim so a new
        // deploy (backend+frontend now ship on every push to master, see
        // .github/workflows/ci.yml) takes effect on next navigation
        // instead of someone getting stuck on a stale bundle indefinitely.
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(rootPackageJson.version),
  },
})
