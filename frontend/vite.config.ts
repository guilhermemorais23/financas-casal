import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The version lives in the repo root's package.json (bumped automatically
// by semantic-release), not this package's own -- frontend/package.json
// stays at 0.0.0 since it's never published on its own.
const rootPackageJson = JSON.parse(readFileSync('../package.json', 'utf-8'))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(rootPackageJson.version),
  },
})
