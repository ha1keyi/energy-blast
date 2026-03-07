import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: true, // 允许所有网络接口访问
    port: 5173,
    strictPort: true,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
        secure: false,
      }
    },
    allowedHosts: [
      '.ngrok-free.dev',
      '.ngrok.io',
      'localhost',
      '127.0.0.1'
    ],
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('phaser')) return 'vendor-phaser';
          if (id.includes('socket.io-client') || id.includes('engine.io-client')) return 'vendor-socket';
          return 'vendor-core';
        },
      },
    },
  }
})
