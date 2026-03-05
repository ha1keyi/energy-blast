import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    host: '0.0.0.0', // 允许所有网络接口访问
    port: 5173,
    cors: true, // 启用CORS
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    allowedHosts: [
      'faintheartedly-unmilted-arlinda.ngrok-free.dev',  // 添加你的 ngrok 域名
      '.ngrok-free.dev',  // 允许所有 ngrok-free.dev 子域名
      '.ngrok.io',        // 也允许老的 ngrok.io 域名
      'localhost',
      '127.0.0.1'
    ],
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets'
  }
})