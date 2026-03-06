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

const DISCONNECT_GRACE_MS = 12000;

function normalizeRoomId(input) {
  const normalized = String(input || '').trim().toLowerCase();
  if (!normalized) return '';
  if (!/^[a-z0-9_-]{3,24}$/.test(normalized)) return null;
  return normalized;
}

function generateRoomId() {
  let roomId = '';
  do {
    roomId = Math.random().toString(36).substring(2, 8);
  } while (rooms[roomId]);
  return roomId;
}

function getPlayerKey(payload = {}, socket) {
  return String(payload.playerKey || socket.id);
}

function findRoomBySocketId(socketId) {
  return Object.entries(rooms).find(([, room]) => room.players.some(player => player.id === socketId)) || null;
}

function emitRoomState(roomId) {
  io.to(roomId).emit('roomState', getRoomState(roomId));
}

function clearDisconnectTimer(room, playerKey) {
  const timer = room?.disconnectTimers?.[playerKey];
  if (timer) {
    clearTimeout(timer);
    delete room.disconnectTimers[playerKey];
  }
}

function removePlayerFromRoom(roomId, playerId, reason = 'Player left room') {
  const room = rooms[roomId];
  if (!room) return;
  const playerIndex = room.players.findIndex(player => player.id === playerId);
  if (playerIndex === -1) return;

  const [removed] = room.players.splice(playerIndex, 1);
  if (removed?.playerKey) clearDisconnectTimer(room, removed.playerKey);

  if (room.players.length === 0) {
    delete rooms[roomId];
    return;
  }

  if (room.game && room.players.length < 2) {
    room.game = null;
    room.lastState = null;
    io.to(roomId).emit('gameEnded', reason);
  }

  io.to(roomId).emit('playerLeft', playerId);
  emitRoomState(roomId);
}

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
      isAlive: p.isAlive,
      connected: p.disconnected !== true,
    })),
    gameStarted: !!room.game,
    snapshot: room.lastState || null,
  };
}

io.on('connection', (socket) => {
  // Minimal connect log
  console.info('Client connected:', socket.id);

  socket.on('createRoom', (payload = {}) => {
    const roomId = generateRoomId();

    const playerKey = getPlayerKey(payload, socket);
    // Initialize server-side game instance
    const game = new Game();
    rooms[roomId] = {
      players: [],
      game: null,
      gameInstance: game,
      lastState: null,
      disconnectTimers: {},
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

    const player = { id: socket.id, name: payload.name, ready: false, playerKey, disconnected: false };
    rooms[roomId].players.push(player);

    socket.join(roomId);
    socket.emit('roomCreated', roomId);

    // Send initial room state
    emitRoomState(roomId);
  });

  socket.on('joinRoom', (payload = {}) => {
    const roomId = normalizeRoomId(payload.roomId) || String(payload.roomId || '').trim().toLowerCase();
    if (!rooms[roomId]) {
      return socket.emit('error', 'Room not found');
    }

    const room = rooms[roomId];
    const playerKey = getPlayerKey(payload, socket);
    const existing = room.players.find(player => player.playerKey === playerKey);

    socket.join(roomId);

    if (existing) {
      clearDisconnectTimer(room, playerKey);
      existing.id = socket.id;
      existing.name = payload.name || existing.name;
      existing.disconnected = false;
      emitRoomState(roomId);
      if (room.game) socket.emit('gameStarted', getRoomState(roomId));
      if (room.lastState) socket.emit('roundResolved', room.lastState);
      return;
    }

    // Check if player is already in room
    if (!room.players.some(p => p.id === socket.id)) {
      const player = { id: socket.id, name: payload.name, ready: false, playerKey, disconnected: false };
      room.players.push(player);

      // Send updated room state to all players
      emitRoomState(roomId);
      if (room.game && room.lastState) {
        socket.emit('gameStarted', getRoomState(roomId));
        socket.emit('roundResolved', room.lastState);
      }
    }
  });

  socket.on('toggleReady', () => {
    // Find player's room
    const roomEntry = findRoomBySocketId(socket.id);
    const roomId = roomEntry?.[0];

    if (roomId) {
      const player = rooms[roomId].players.find(p => p.id === socket.id);
      if (player) {
        player.ready = !player.ready;
        emitRoomState(roomId);

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
    room.lastState = null;
    io.to(roomId).emit('gameStarted', getRoomState(roomId));
    emitRoomState(roomId);
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
    const room = rooms[roomId];
    if (!room || !room.players.some(player => player.id === socket.id)) return;
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
    room.lastState = state || null;
    io.to(roomId).emit('roundResolved', state || {});

    const nextState = state?.state || state?.gameState;
    if (nextState === 'ended') {
      room.game = null;
      emitRoomState(roomId);
    }

    // Update server-side state cache if needed (omitted for now as we rely on host)
  });

  socket.on('requestRematch', (roomId) => {
    console.info('Rematch requested in room', roomId);
    const room = rooms[roomId];
    if (room) {
      // 重置房间游戏状态
      room.game = null;
      room.lastState = null;
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
      emitRoomState(roomId);
    }
  });

  socket.on('leaveRoom', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;

    socket.leave(roomId);
    removePlayerFromRoom(roomId, socket.id, 'Player left room');
  });

  socket.on('disconnect', () => {
    console.info('Client disconnected:', socket.id);
    const roomEntry = findRoomBySocketId(socket.id);
    if (!roomEntry) return;
    const [roomId, room] = roomEntry;
    const player = room.players.find(entry => entry.id === socket.id);
    if (!player) return;

    player.disconnected = true;
    clearDisconnectTimer(room, player.playerKey);
    room.disconnectTimers[player.playerKey] = setTimeout(() => {
      const currentRoom = rooms[roomId];
      if (!currentRoom) return;
      const pendingPlayer = currentRoom.players.find(entry => entry.playerKey === player.playerKey && entry.disconnected);
      if (!pendingPlayer) return;
      removePlayerFromRoom(roomId, pendingPlayer.id, 'Player disconnected');
    }, DISCONNECT_GRACE_MS);
  });
});

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
});
