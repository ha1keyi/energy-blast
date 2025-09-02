const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
// 移除对前端 ESM 模块的依赖，避免在 Node CJS 环境下 require 失败
// const { Player } = require('../src/core/Player');
// const { Game } = require('../src/core/Game');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
  }
});

let rooms = {};

function getRoomState(roomId) {
  const room = rooms[roomId];
  if (!room) return null;
  return {
    roomId,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready || false
    }))
  };
}

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('createRoom', ({ name }) => {
    const roomId = Math.random().toString(36).substring(2, 8);
    rooms[roomId] = { players: [], game: null };
    
    // Add creator as first player
    const player = { id: socket.id, name, ready: false };
    rooms[roomId].players.push(player);
    
    socket.join(roomId);
    socket.emit('roomCreated', roomId);
    
    // Send initial room state
    io.to(roomId).emit('roomState', getRoomState(roomId));
  });

  socket.on('joinRoom', ({ roomId, name }) => {
    if (!rooms[roomId]) {
      return socket.emit('error', 'Room not found');
    }
    
    // Check if player is already in room
    if (!rooms[roomId].players.some(p => p.id === socket.id)) {
      const player = { id: socket.id, name, ready: false };
      rooms[roomId].players.push(player);
      socket.join(roomId);
      
      // Send updated room state to all players
      io.to(roomId).emit('roomState', getRoomState(roomId));
    }
  });

  socket.on('toggleReady', () => {
    // Find player's room
    const roomId = Object.keys(rooms).find(id => 
      rooms[id].players.some(p => p.id === socket.id)
    );
    
    if (roomId) {
      const player = rooms[roomId].players.find(p => p.id === socket.id);
      if (player) {
        player.ready = !player.ready;
        io.to(roomId).emit('roomState', getRoomState(roomId));
        
        // Check if all players are ready to start
        const allReady = rooms[roomId].players.length >= 2 && 
                        rooms[roomId].players.every(p => p.ready);
        if (allReady && !rooms[roomId].game) {
          // 简化：服务端只广播开始游戏事件，不在服务端运行游戏逻辑
          rooms[roomId].game = { started: true };
          io.to(roomId).emit('gameStarted', getRoomState(roomId));
        }
      }
    }
  });

  // 开发期占位：避免调用不存在的 player.selectAction 导致错误
  socket.on('selectAction', (roomId, actionKey, targetId) => {
    // 在当前架构中，客户端本地模拟战斗逻辑；这里仅占位/日志
    console.log(`[selectAction] room=${roomId} player=${socket.id} action=${actionKey} target=${targetId}`);
    // 可扩展：将选择广播给房间，或进行校验
    // io.to(roomId).emit('playerSelectedAction', { playerId: socket.id, actionKey, targetId });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Find and clean up rooms where the player was
    for (let roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        
        if (room.players.length === 0) {
          // Delete empty rooms
          delete rooms[roomId];
        } else {
          // Notify remaining players
          io.to(roomId).emit('playerLeft', socket.id);
          io.to(roomId).emit('roomState', getRoomState(roomId));
          
          // End game if too few players
          if (room.game && room.players.length < 2) {
            room.game = null;
            io.to(roomId).emit('gameEnded', 'Player disconnected');
          }
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});