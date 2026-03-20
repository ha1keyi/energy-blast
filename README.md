# Energy Blast

简单介绍
- `Energy Blast` 是一个基于浏览器的多人策略对战小游戏，客户端使用 Phaser + Vite，使用 Socket.IO 进行多人通信。该仓库包含前端代码和一个可选的 Node.js 后端（位于 `server/`）。

快速启动

1. 安装依赖（根目录）：

```bash
npm install
```

2. 启动开发服务器（客户端）：

```bash
npm run dev
```

3. 启动后端（可选）：

```bash
cd server
npm install
npm start
```

（仓库中也包含 `start.js` 脚本，可用于同时启动前后端：`node start.js`）

更多信息
- 若需运行 E2E 测试：`npm run test:e2e`。
- 若想构建发布包：`npm run build`。

如果需要我把 README 翻译成英文或补充开发者文档，请告诉我。