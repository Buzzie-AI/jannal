import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4455',
      '/health': 'http://localhost:4455',
      '/v1': 'http://localhost:4455',
    },
  },
})
