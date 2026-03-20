import { defineConfig } from 'vite'

function jannalServer() {
  let started = false
  return {
    name: 'jannal-server',
    configureServer() {
      if (started) return
      started = true
      import('./server.js').then(({ createServer }) => {
        createServer().start()
      })
    },
  }
}

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api/': 'http://localhost:4455',
      '/health': 'http://localhost:4455',
      '/v1': 'http://localhost:4455',
    },
  },
  plugins: [jannalServer()],
})
