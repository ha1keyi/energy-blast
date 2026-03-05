# Energy Blast 网络升级指南

## 🚀 广域网联机升级方案

### 方案一：云服务器部署（推荐）

**优点**：
- 稳定可靠，24小时在线
- 全球访问，低延迟
- 专业运维支持

**实施步骤**：
1. 购买云服务器（阿里云、腾讯云、AWS等）
2. 部署Node.js服务端代码
3. 配置域名和HTTPS证书
4. 开放3000端口或配置反向代理

**代码修改**：
```javascript
// LobbyManager.js 中修改服务器地址
const serverUrl = 'https://your-domain.com:3000';
```

### 方案二：内网穿透（适合个人开发者）

**工具推荐**：
- **frp (Fast Reverse Proxy)** - 免费开源
- **ngrok** - 简单易用，有免费版
- **花生壳** - 国内用户友好

**frp配置示例**：
```ini
# frps.ini (服务器端)
[common]
bind_port = 7000
vhost_http_port = 8080

# frpc.ini (客户端)
[common]
server_addr = your-server-ip
server_port = 7000

[energy-blast]
type = http
local_port = 3000
custom_domains = your-domain.com
```

### 方案三：P2P直连（技术难度较高）

**技术栈**：
- WebRTC数据通道
- STUN/TURN服务器
- 信令服务器（可用现有Socket.io）

**优势**：
- 无需中心服务器转发游戏数据
- 延迟更低
- 成本更低

**挑战**：
- NAT穿透复杂
- 需要处理连接失败回退
- 开发工作量大

## 📱 微信小程序移植方案

### 技术可行性分析

**✅ 可行部分**：
- 游戏逻辑代码（JavaScript）可复用
- 回合制玩法适合微信小游戏的异步特性
- UI界面可以适配小程序尺寸

**⚠️ 需要修改部分**：
- Phaser 3 → 微信小程序Canvas API
- Socket.io → 微信WebSocket API
- DOM操作 → 小程序WXML/WXSS

### 移植架构

```
微信小程序
├── pages/
│   ├── index/          # 主页
│   ├── room/           # 房间列表
│   ├── game/           # 游戏页面
│   └── result/         # 结果页面
├── utils/
│   ├── game-logic.js   # 复用现有游戏逻辑
│   ├── websocket.js  # 微信WebSocket封装
│   └── canvas-renderer.js # Canvas渲染器
└── app.js
```

### 关键适配点

1. **渲染系统替换**：
```javascript
// 原Phaser 3代码
this.add.text(x, y, text, style);

// 微信小程序Canvas
ctx.fillText(text, x, y);
```

2. **网络通信替换**：
```javascript
// 原Socket.io
socket.emit('joinRoom', data);

// 微信小程序WebSocket
wx.connectSocket({
  url: 'wss://your-server.com'
});
```

3. **用户系统集成**：
```javascript
// 获取微信用户信息
wx.getUserProfile({
  desc: '用于游戏内显示用户名',
  success: (res) => {
    const userInfo = res.userInfo;
    // 使用微信头像和昵称
  }
});
```

## 🏫 校园网联机分析

### 校园网特点
- **NAT限制**：多数校园网使用NAT，阻止直接连接
- **端口限制**：可能封锁部分端口
- **防火墙**：可能有严格的安全策略

### 解决方案

#### 1. 校园网内部署服务器
**适用场景**：同一校园网内联机
```bash
# 在宿舍电脑或实验室服务器上运行
npm run start:server
# 其他同学通过内网IP连接
http://192.168.x.x:3000
```

#### 2. 使用学校VPN
很多高校提供VPN服务，连接后相当于在同一局域网

#### 3. 反向代理绕过端口限制
```nginx
# Nginx配置，将80端口映射到3000
server {
    listen 80;
    server_name your-domain.com;
    
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

## 🔧 立即实施的简单方案

### 1. 当前局域网优化
```bash
# 查看本机IP
ipconfig  # Windows
ifconfig  # Mac/Linux

# 告诉同学通过IP连接
http://192.168.1.100:5173
```

### 2. 免费内网穿透（推荐）
使用ngrok免费版：
```bash
# 安装ngrok
npm install -g ngrok

# 启动穿透
ngrok http 3000

# 获得外网地址，如：https://abc123.ngrok.io
# 分享给朋友即可
```

### 3. 微信小程序快速体验
可以先制作简化版：
- 单机对战AI
- 本地双人轮流
- 后续再添加网络功能

## 📋 实施建议

1. **短期**（1-2周）：
   - 使用ngrok实现广域网测试
   - 优化现有局域网体验

2. **中期**（1-2月）：
   - 云服务器部署
   - 微信小程序单机版

3. **长期**（3-6月）：
   - 完整微信小程序
   - P2P网络优化
   - 移动端适配