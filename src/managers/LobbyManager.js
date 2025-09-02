// src/managers/LobbyManager.js
// Lightweight lobby manager singleton with simple change notifications.

import { io } from 'socket.io-client';

class LobbyManagerImpl {
  constructor() {
    // Separate server-synced players and local bots
    this.serverPlayers = [];
    this.bots = [];
    this.nextId = 1;
    this._subs = new Set();
    this.roomId = null;
    this.socket = null;
    this.playerId = null;
    this.connected = false; // 新增：连接状态
  }

  connect() {
    if (this.socket) return;
    // Prefer env-configured server URL, fallback to current host:3000 for LAN
    const defaultUrl = (typeof window !== 'undefined')
      ? `${window.location.protocol}//${window.location.hostname}:3000`
      : 'http://localhost:3000';
    const serverUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SERVER_URL)
      ? import.meta.env.VITE_SERVER_URL
      : defaultUrl;

    this.socket = io(serverUrl, { transports: ['websocket'] });

    this.socket.on('connect', () => {
      console.log('Connected to server with id', this.socket.id);
      this.playerId = this.socket.id;
      this.connected = true; // 标记为已连接
    });

    // 新增：断线/连错处理
    this.socket.on('disconnect', () => {
      this.connected = false;
    });
    this.socket.on('connect_error', () => {
      this.connected = false;
    });

    this.socket.on('roomState', (roomState) => {
      // Only update server player list; keep local bots intact
      this.serverPlayers = roomState.players || [];
      this.roomId = roomState.roomId;
      this._emit();
    });

    this.socket.on('playerJoined', (player) => {
      if (!this.serverPlayers.some(p => p.id === player.id)) {
        this.serverPlayers.push(player);
      }
      this._emit();
    });

    this.socket.on('playerLeft', (playerId) => {
      this.serverPlayers = this.serverPlayers.filter(p => p.id !== playerId);
      this._emit();
    });

    this.socket.on('playerReady', (playerId, isReady) => {
      const player = this.serverPlayers.find(p => p.id === playerId);
      if (player) {
        player.ready = isReady;
      }
      this._emit();
    });
  }

  subscribe(fn) {
    this._subs.add(fn);
  }

  unsubscribe(fn) {
    this._subs.delete(fn);
  }

  _emit() {
    this._subs.forEach(fn => fn());
  }

  // Combined list of server players and local bots
  list() {
    return [...this.serverPlayers, ...this.bots];
  }

  get(id) {
    return this.list().find(p => p.id === id);
  }

  getSelf() {
    return this.serverPlayers.find(p => p.id === this.playerId);
  }

  // Host is the first player (room creator)
  isHost() {
    return !!(this.serverPlayers[0] && this.serverPlayers[0].id === this.playerId);
  }

  // Local-only: add a virtual player in lobby
  add(name) {
    const newPlayer = { id: `bot-${this.nextId++}`, name, ready: true, isBot: true };
    this.bots.push(newPlayer);
    this._emit();
    return newPlayer;
  }

  // Alias for clarity
  addBot(name) { return this.add(name); }

  // Set ready state for a specific player (bots locally; self via server toggle)
  setReady(id, ready) {
    // Bot case
    if (typeof id === 'string' && id.startsWith('bot-')) {
      const bot = this.bots.find(b => b.id === id);
      if (bot) {
        bot.ready = !!ready;
        this._emit();
        return true;
      }
      return false;
    }
    // Server self case (others not allowed)
    if (id === this.playerId) {
      const me = this.getSelf();
      if (!me) return false;
      if (!!me.ready !== !!ready) {
        this.toggleReady();
      }
      return true;
    }
    return false;
  }

  // Remove a player (bots only)
  remove(id) {
    if (typeof id === 'string' && id.startsWith('bot-')) {
      const before = this.bots.length;
      this.bots = this.bots.filter(b => b.id !== id);
      if (this.bots.length !== before) this._emit();
      return true;
    }
    return false;
  }

  reset() {
    this.serverPlayers = [];
    this.bots = [];
    this.nextId = 1;
    this.roomId = null;
    this._emit();
  }

  joinRoom(roomId, name) {
    this.roomId = roomId;
    this.socket.emit('joinRoom', { roomId, name });
    // 乐观更新：把自己先加入本地列表以便立即显示
    if (this.playerId && !this.serverPlayers.some(p => p.id === this.playerId)) {
      this.serverPlayers = [...this.serverPlayers, { id: this.playerId, name, ready: false }];
      this._emit();
    }
  }

  createRoom(name) {
    // 新增：离线/未连时的本地回退与乐观更新
    if (!this.socket || !this.connected) {
      if (!this.playerId) this.playerId = `local-${Math.random().toString(36).slice(2, 8)}`;
      if (!this.roomId) this.roomId = `local-${Date.now()}`;
      if (!this.serverPlayers.some(p => p.id === this.playerId)) {
        this.serverPlayers = [{ id: this.playerId, name, ready: false }];
      }
      this._emit();
      return;
    }

    this.socket.emit('createRoom', { name });
    // 乐观：把自己先放入列表，等服务器 roomState 覆盖
    if (this.playerId && !this.serverPlayers.some(p => p.id === this.playerId)) {
      this.serverPlayers.push({ id: this.playerId, name, ready: false });
      this._emit();
    }
  }

  joinRoom(roomId, name) {
    this.roomId = roomId;
    // 离线/未连：本地加入
    if (!this.socket || !this.connected) {
      if (!this.playerId) this.playerId = `local-${Math.random().toString(36).slice(2, 8)}`;
      if (!this.serverPlayers.some(p => p.id === this.playerId)) {
        this.serverPlayers.push({ id: this.playerId, name, ready: false });
      }
      this._emit();
      return;
    }
    this.socket.emit('joinRoom', { roomId, name });
    // 乐观：把自己先放入列表
    if (this.playerId && !this.serverPlayers.some(p => p.id === this.playerId)) {
      this.serverPlayers.push({ id: this.playerId, name, ready: false });
      this._emit();
    }
  }

  toggleReady() {
    // 离线/未连：本地切换自己的 ready
    if (!this.socket || !this.connected) {
      const meIdx = this.serverPlayers.findIndex(p => p.id === this.playerId);
      if (meIdx >= 0) {
        this.serverPlayers[meIdx] = { ...this.serverPlayers[meIdx], ready: !this.serverPlayers[meIdx].ready };
      } else if (this.playerId) {
        this.serverPlayers.push({ id: this.playerId, name: '我', ready: true });
      }
      this._emit();
      return;
    }
    this.socket.emit('toggleReady');
  }

  isHost() {
    return !!(this.serverPlayers[0] && this.serverPlayers[0].id === this.playerId);
  }
  allReady() {
    const players = this.list();
    if (players.length < 2) return false; // 至少两名玩家才能开始
    return players.every(p => p.ready);
  }
}

export const LobbyManager = new LobbyManagerImpl();
// Back-compat for debug tools that expect window.lobby
if (typeof window !== 'undefined') {
  window.lobby = LobbyManager;
}
