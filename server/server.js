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

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

let rooms = {};

const DISCONNECT_GRACE_MS = 12000;
const DEFAULT_ROOM_SETTINGS = Object.freeze({
  autoResolve: true,
  roundTimeMs: 5000,
});

function normalizeRoomSettings(input = {}) {
  const autoResolve = typeof input.autoResolve === 'boolean'
    ? input.autoResolve
    : DEFAULT_ROOM_SETTINGS.autoResolve;
  const rawRoundTime = typeof input.roundTimeMs === 'number' && Number.isFinite(input.roundTimeMs)
    ? input.roundTimeMs
    : DEFAULT_ROOM_SETTINGS.roundTimeMs;

  return {
    autoResolve,
    roundTimeMs: Math.max(2000, Math.min(30000, Math.round(rawRoundTime))),
  };
}

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

function clearRoundTimer(room) {
  if (room?.roundTimer) {
    clearTimeout(room.roundTimer);
    room.roundTimer = null;
  }
}

function getActiveReadyPlayerIds(room) {
  return (room?.players || [])
    .filter(player => !player.isBot && player.disconnected !== true)
    .map(player => player.id);
}

function beginRound(roomId, roundNumber) {
  const room = rooms[roomId];
  if (!room || !room.game) return;

  clearRoundTimer(room);
  room.game.round = roundNumber;
  room.game.phase = 'selecting';
  room.game.readyByPlayerId = {};

  const resolveAt = room.settings.autoResolve ? Date.now() + room.settings.roundTimeMs : null;
  room.game.resolveAt = resolveAt;

  if (room.settings.autoResolve && resolveAt) {
    room.roundTimer = setTimeout(() => {
      const latestRoom = rooms[roomId];
      if (!latestRoom?.game || latestRoom.game.phase !== 'selecting') return;
      latestRoom.game.phase = 'resolving';
      latestRoom.game.resolveAt = null;
      latestRoom.roundTimer = null;
      io.to(roomId).emit('roundResolveRequested', { round: latestRoom.game.round, reason: 'timer' });
    }, room.settings.roundTimeMs);
  }

  io.to(roomId).emit('roundStarted', {
    round: roundNumber,
    autoResolve: !!room.settings.autoResolve,
    roundTimeMs: room.settings.roundTimeMs,
    resolveAt,
  });
}

function maybeResolveManualRound(roomId) {
  const room = rooms[roomId];
  if (!room?.game || room.game.phase !== 'selecting' || room.settings.autoResolve) return;

  const playerIds = getActiveReadyPlayerIds(room);
  if (!playerIds.length) return;

  const allReady = playerIds.every(playerId => room.game.readyByPlayerId?.[playerId]);
  if (!allReady) return;

  room.game.phase = 'resolving';
  room.game.resolveAt = null;
  clearRoundTimer(room);
  io.to(roomId).emit('roundResolveRequested', { round: room.game.round, reason: 'all-ready' });
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
    clearRoundTimer(room);
    delete rooms[roomId];
    return;
  }

  if (room.game && room.players.length < 2) {
    clearRoundTimer(room);
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
    settings: normalizeRoomSettings(room.settings),
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
      settings: { ...DEFAULT_ROOM_SETTINGS },
      roundTimer: null,
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
      if (room.game) {
        socket.emit('gameStarted', getRoomState(roomId));
        if (room.game.phase === 'selecting') {
          socket.emit('roundStarted', {
            round: room.game.round,
            autoResolve: !!room.settings.autoResolve,
            roundTimeMs: room.settings.roundTimeMs,
            resolveAt: room.game.resolveAt,
          });
        } else if (room.game.phase === 'resolving') {
          socket.emit('roundResolveRequested', { round: room.game.round, reason: 'sync' });
        }
      }
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
        if (room.game.phase === 'selecting') {
          socket.emit('roundStarted', {
            round: room.game.round,
            autoResolve: !!room.settings.autoResolve,
            roundTimeMs: room.settings.roundTimeMs,
            resolveAt: room.game.resolveAt,
          });
        } else if (room.game.phase === 'resolving') {
          socket.emit('roundResolveRequested', { round: room.game.round, reason: 'sync' });
        }
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

  socket.on('startGame', (roomId, settings = {}) => {
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
    room.settings = normalizeRoomSettings(settings || room.settings);
    room.game = { started: true, round: 1, phase: 'selecting', resolveAt: null, readyByPlayerId: {} };
    room.lastState = null;
    io.to(roomId).emit('gameStarted', getRoomState(roomId));
    beginRound(roomId, 1);
    emitRoomState(roomId);
  });

  socket.on('updateRoomSettings', (roomId, settings = {}) => {
    const room = rooms[roomId];
    if (!room) return;

    const isHost = room.players[0] && room.players[0].id === socket.id;
    if (!isHost || room.game) return;

    room.settings = normalizeRoomSettings(settings);
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

  socket.on('setRoundReady', (roomId, ready) => {
    const room = rooms[roomId];
    if (!room || !room.players.some(player => player.id === socket.id)) return;
    if (!room.game || room.game.phase !== 'selecting') return;
    room.game.readyByPlayerId[socket.id] = !!ready;
    io.to(roomId).emit('roundReadyChanged', { playerId: socket.id, ready: !!ready });
    maybeResolveManualRound(roomId);
  });

  // Host sends the resolved state
  socket.on('roundResolved', (roomId, state) => {
    const room = rooms[roomId];
    if (!room) return;
    clearRoundTimer(room);
    room.lastState = state || null;
    io.to(roomId).emit('roundResolved', state || {});

    const nextState = state?.state || state?.gameState;
    if (nextState === 'ended') {
      room.game.phase = 'ended';
      room.game.resolveAt = null;
      room.game = null;
      emitRoomState(roomId);
      return;
    }

    if (nextState === 'selecting' && typeof state?.round === 'number') {
      if (!room.game) {
        room.game = { started: true, round: state.round, phase: 'selecting', resolveAt: null, readyByPlayerId: {} };
      }
      beginRound(roomId, state.round);
      emitRoomState(roomId);
    } else if (room.game) {
      room.game.phase = nextState || room.game.phase;
      room.game.resolveAt = null;
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
