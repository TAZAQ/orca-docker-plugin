import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Browser clients still load a panel as one opaque document, so every script and
// style is inlined into panel.html; the desktop app serves the same file as is.
export default defineConfig({
  root: fileURLToPath(new URL('src/panel', import.meta.url)),
  publicDir: false,
  plugins: [vue(), viteSingleFile()],
  build: {
    outDir: fileURLToPath(new URL('dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: fileURLToPath(new URL('src/panel/panel.html', import.meta.url))
    }
  }
})
