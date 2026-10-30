import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, isRunnableDevEnvironment, lazyPlugins, type Plugin } from 'vite-plus'

// The scan runs in the SSR environment so its in-memory caches are the ones server functions reuse.
function scanOnStart(): Plugin {
  return {
    name: 'token-calc:scan-on-start',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const environment = server.environments.ssr
        if (!isRunnableDevEnvironment(environment)) return
        const startedAt = performance.now()
        environment.runner
          .import<typeof import('@token-calc/core')>('@token-calc/core')
          .then((core) => core.loadDashboardSnapshot('90'))
          .then((snapshot) => {
            const seconds = ((performance.now() - startedAt) / 1000).toFixed(1)
            server.config.logger.info(
              `  token-calc: scanned ${snapshot.totalEventCount.toLocaleString()} events in ${seconds}s`,
              { timestamp: true },
            )
          })
          .catch((error: unknown) => {
            server.config.logger.warn(`  token-calc: startup scan failed: ${String(error)}`, { timestamp: true })
          })
      })
    },
  }
}

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
  plugins: lazyPlugins(async () => [tanstackStart(), tailwindcss(), react(), scanOnStart()]),
})
