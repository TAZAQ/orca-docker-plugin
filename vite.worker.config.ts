import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The worker runs as plain Node (ELECTRON_RUN_AS_NODE) and imports main.mjs as ESM.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: fileURLToPath(new URL('src/worker/main.ts', import.meta.url)),
    outDir: fileURLToPath(new URL('dist', import.meta.url)),
    emptyOutDir: false,
    target: 'node24',
    rollupOptions: {
      output: { format: 'es', entryFileNames: 'main.mjs' }
    }
  }
})
