/// <reference types="vitest/config" />
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { onDemandFiles, stampOnDemand } from './scripts/sw-on-demand.mjs'
import tailwindcss from '@tailwindcss/vite'

// The service worker gets the build hash (its cache name) and the on-demand chunks to precache.
let onDemand: string[] = []
const swStamp: Plugin = {
  name: 'perf-sw-stamp',
  apply: 'build',
  generateBundle(_options, bundle) {
    onDemand = onDemandFiles(bundle)
  },
  closeBundle() {
    const dir = new URL('./dist/', import.meta.url)
    const html = new URL('index.html', dir), sw = new URL('sw.js', dir)
    if (!existsSync(html) || !existsSync(sw)) return
    const stamp = createHash('sha256').update(readFileSync(html)).digest('hex').slice(0, 10)
    writeFileSync(sw, stampOnDemand(readFileSync(sw, 'utf8').replace('__BUILD__', stamp), onDemand))
  }
}

const appVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react(), tailwindcss(), swStamp],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
  // The full suite runs ~300 files in parallel, including PGlite databases and the big exercise
  // datasets; on a loaded machine the 5 s / 10 s defaults fail tests that pass on their own.
  test: { testTimeout: 20_000, hookTimeout: 30_000 }
})
