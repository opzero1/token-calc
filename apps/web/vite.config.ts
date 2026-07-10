import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, lazyPlugins } from 'vite-plus'

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 6767,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: lazyPlugins(async () => [tanstackStart(), tailwindcss(), react()]),
})
