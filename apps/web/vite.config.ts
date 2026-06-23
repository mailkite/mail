import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The SPA. In dev, /api + /webhook proxy to the Hono backend (npm run dev).
// In prod, the built dist/ is served by the Worker (Phase 5) or Node static.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8788',
      '/webhook': 'http://localhost:8788',
    },
  },
  build: { outDir: 'dist' },
})
