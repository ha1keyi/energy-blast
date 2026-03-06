import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Player } from '../src/core/Player.js';
import { Game } from '../src/core/Game.js';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: false,
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
      ready: p.ready || false,
      isBot: !!p.isBot,
      // Include game state if game is running
      health: p.health,
      energy: p.energy,
      isAlive: p.isAlive
    })),
    gameStarted: !!room.game
  };
}

io.on('connection', (socket) => {
  // Minimal connect log
  console.info('Client connected:', socket.id);

  socket.on('createRoom', ({ name }) => {
    const roomId = Math.random().toString(36).substring(2, 8);
    // Initialize server-side game instance
    const game = new Game();
    rooms[roomId] = {
      players: [],
      game: null, // We keep the 'game' flag for lobby status, but we could use the actual game instance
      gameInstance: game
    };

    // Add creator as first player
    // Note: Player class constructor: id, name, health, energy
    // We use socket.id as ID for mapping, but Player class expects number ID usually? 
    // Let's check Player.js: constructor(id, name...) -> id can be anything?
    // Player.js: this.id = id;
    // However, Game.js addPlayer generates numeric IDs.
    // For simplicity in this legacy refactor, we keep the room player list separate from Game instance players for now, 
    // or we try to map them. 
    // The current frontend manages its own Game instance.
    // To support "Adjust all players", the server needs to know about players.

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

      }
    }
  });

  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    // Only room host (creator, first player) can start.
    const isHost = room.players[0] && room.players[0].id === socket.id;
    if (!isHost) return;

    const allReady = room.players.length >= 2 && room.players.every(p => p.ready);
    if (!allReady) {
      socket.emit('error', 'Not all players are ready');
      return;
    }

    if (room.game) return;
    room.game = { started: true };
    io.to(roomId).emit('gameStarted', getRoomState(roomId));
  });

  socket.on('addBot', ({ roomId, name }) => {
    const room = rooms[roomId];
    if (!room) return;

    const isHost = room.players[0] && room.players[0].id === socket.id;
    if (!isHost) return;

    const botId = `bot-${Math.random().toString(36).slice(2, 8)}`;
    const botName = (name || '').trim() || `虚拟玩家${Math.floor(Math.random() * 1000)}`;
    room.players.push({
      id: botId,
      name: botName,
      ready: true,
      isBot: true,
      health: 1,
      energy: 0,
      isAlive: true,
    });

    io.to(roomId).emit('roomState', getRoomState(roomId));
  });

  socket.on('selectAction', (roomId, actionKey, targetId) => {
    // Broadcast action to all (client-side logic handles the rest)
    // action broadcast received (suppress verbose logging in production)
    io.to(roomId).emit('actionSelected', { playerId: socket.id, actionKey, targetId });
  });

  // Host sends the resolved state
  socket.on('roundResolved', (roomId, state) => {
    const room = rooms[roomId];
    if (!room) return;
    // console.log(`[roundResolved] room=${roomId} by host=${socket.id} round=${state?.round}`);
    // Broadcast to others
    io.to(roomId).emit('roundResolved', state || {});

    const nextState = state?.state || state?.gameState;
    if (nextState === 'ended') {
      room.game = null;
      io.to(roomId).emit('roomState', getRoomState(roomId));
    }

    // Update server-side state cache if needed (omitted for now as we rely on host)
  });

  socket.on('requestRematch', (roomId) => {
    console.info('Rematch requested in room', roomId);
    const room = rooms[roomId];
    if (room) {
      // 重置房间游戏状态
      room.game = null;
      // 重置所有玩家状态
      room.players.forEach(p => {
        p.ready = p.isBot ? true : false;
        // 重置游戏内属性（如果需要同步给客户端）
        p.health = 1; // 初始血量
        p.energy = 0; // 初始气量
        p.isAlive = true;
      });

      // 通知房间内所有玩家回到准备状态
      io.to(roomId).emit('rematchStarted');
      io.to(roomId).emit('roomState', getRoomState(roomId));
    }
  });

  socket.on('leaveRoom', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    socket.leave(roomId);
    const playerIndex = room.players.findIndex(p => p.id === socket.id);
    if (playerIndex !== -1) {
      room.players.splice(playerIndex, 1);
    }

    if (room.players.length === 0) {
      delete rooms[roomId];
      return;
    }

    if (room.game && room.players.length < 2) {
      room.game = null;
      io.to(roomId).emit('gameEnded', 'Player left room');
    }

    io.to(roomId).emit('playerLeft', socket.id);
    io.to(roomId).emit('roomState', getRoomState(roomId));
  });

  socket.on('disconnect', () => {
    console.info('Client disconnected:', socket.id);
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
