import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/health': { target: 'http://localhost:8000', changeOrigin: true },
      '/worker': { target: 'http://localhost:8000', changeOrigin: true },
      '/llm': { target: 'http://localhost:8000', changeOrigin: true },
      '/top': { target: 'http://localhost:8000', changeOrigin: true },
      '/views': { target: 'http://localhost:8000', changeOrigin: true },
      '/view': { target: 'http://localhost:8000', changeOrigin: true },
      '/universe': { target: 'http://localhost:8000', changeOrigin: true },
      '/synthesize': { target: 'http://localhost:8000', changeOrigin: true },
      '/prefilter': { target: 'http://localhost:8000', changeOrigin: true },
      '/refresh': { target: 'http://localhost:8000', changeOrigin: true },
      '/stocks': { target: 'http://localhost:8000', changeOrigin: true },
      '/pipeline': { target: 'http://localhost:8000', changeOrigin: true },
      '/tasks': { target: 'http://localhost:8000', changeOrigin: true },
      '/analysis': { target: 'http://localhost:8000', changeOrigin: true },
      '/stock': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
