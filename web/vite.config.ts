import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The API serves the built app from wwwroot; in development Vite proxies API calls to it.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: { outDir: '../server/wwwroot', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { port: 5183, strictPort: true, proxy: { '/api': 'http://localhost:5283' } },
})
