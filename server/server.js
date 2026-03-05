import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Player } from '../src/core/Player.js';
import { Game } from '../src/core/Game.js';

const app = express();
const server = createServer(app);
const io = new Server(server, {
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
      ready: p.ready || false,
      // Include game state if game is running
      health: p.health,
      energy: p.energy,
      isAlive: p.isAlive
    })),
    gameStarted: !!room.game
  };
}

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

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

        // Check if all players are ready to start
        const allReady = rooms[roomId].players.length >= 2 &&
          rooms[roomId].players.every(p => p.ready);
        if (allReady && !rooms[roomId].game) {
          rooms[roomId].game = { started: true };
          // Initialize server-side game players if we wanted to run logic here
          // rooms[roomId].gameInstance.players = ...
          io.to(roomId).emit('gameStarted', getRoomState(roomId));
        }
      }
    }
  });

  socket.on('selectAction', (roomId, actionKey, targetId) => {
    // Broadcast action to all (client-side logic handles the rest)
    console.log(`[selectAction] room=${roomId} player=${socket.id} action=${actionKey} target=${targetId}`);
    io.to(roomId).emit('actionSelected', { playerId: socket.id, actionKey, targetId });
  });

  // Host sends the resolved state
  socket.on('roundResolved', (roomId, state) => {
    // console.log(`[roundResolved] room=${roomId} by host=${socket.id} round=${state?.round}`);
    // Broadcast to others
    io.to(roomId).emit('roundResolved', state || {});

    // Update server-side state cache if needed (omitted for now as we rely on host)
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
