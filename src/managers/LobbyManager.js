// src/managers/LobbyManager.js
// Lightweight lobby manager singleton with simple change notifications.

import { io } from 'socket.io-client';

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
    this.playerName = '';
    this.playerKey = this._ensurePlayerKey();
    this.connected = false;
    this.gameStarted = false;
    this.lastSnapshot = null;
    this.roomSettings = { ...DEFAULT_ROOM_SETTINGS };
    this._pendingAction = null; // Action to run upon connection
    this._sessionKey = 'energy-blast-room-session';
  }

  _ensurePlayerKey() {
    if (typeof window === 'undefined') return `player-${Date.now().toString(36)}`;
    const storageKey = 'energy-blast-player-key';
    let existing = '';
    try { existing = window.sessionStorage.getItem(storageKey) || ''; } catch (_) { }
    if (existing) return existing;
    const next = `player-${Math.random().toString(36).slice(2, 10)}`;
    try { window.sessionStorage.setItem(storageKey, next); } catch (_) { }
    return next;
  }

  _readSession() {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(this._sessionKey);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  _writeSession(partial = {}) {
    if (typeof window === 'undefined') return;
    const next = {
      ...this._readSession(),
      roomId: this.roomId || '',
      name: this.playerName || '',
      gameStarted: !!this.gameStarted,
      ...partial,
    };
    if (!next.roomId || !next.name) return;
    try {
      window.sessionStorage.setItem(this._sessionKey, JSON.stringify(next));
    } catch (_) { }
  }

  clearSession() {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.removeItem(this._sessionKey);
    } catch (_) { }
  }

  getSavedSession() {
    return this._readSession();
  }

  _isNgrokHost(hostname) {
    return !!hostname && (hostname.endsWith('ngrok-free.dev') || hostname.endsWith('ngrok.io'));
  }

  _isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  }

  _resolveServerUrl() {
    if (typeof window === 'undefined') return 'http://localhost:3000';

    const { protocol, hostname, origin, search } = window.location;
    const params = new URLSearchParams(search);
    const serverParam = params.get('server') || params.get('serverUrl');
    const serverPortParam = params.get('serverPort');

    // Explicit URL/query override takes highest priority for debugging.
    if (serverParam) {
      return serverParam.startsWith('http')
        ? serverParam
        : `${protocol}//${serverParam}`;
    }
    if (serverPortParam) {
      return `${protocol}//${hostname}:${serverPortParam}`;
    }

    const envUrl = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SERVER_URL)
      ? String(import.meta.env.VITE_SERVER_URL).trim()
      : '';

    // Public hosts should always prefer same-origin proxy to avoid pointing clients to localhost.
    if (!this._isLocalHost(hostname) || this._isNgrokHost(hostname)) {
      return origin;
    }

    if (envUrl) return envUrl;
    return `${protocol}//${hostname}:3000`;
  }

  connect() {
    if (this.socket) return;
    const serverUrl = this._resolveServerUrl();

    this.socket = io(serverUrl, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    this.socket.on('connect', () => {
      console.info('Socket connected:', this.socket.id);
      this.playerId = this.socket.id;
      this.connected = true; // 标记为已连接
      this._writeSession({});

      // Execute any pending action
      if (this._pendingAction) {
        this._pendingAction();
        this._pendingAction = null;
      }
      this._emit();
    });

    // 新增：断线/连错处理
    this.socket.on('disconnect', () => {
      this.connected = false;
      this._emit();
    });
    this.socket.on('connect_error', (err) => {
      console.error('Connection Error:', err);
      this.connected = false;
      this._emit();
    });

    // 处理加入房间等服务端返回的错误，避免进入空房间
    this.socket.on('error', (msg) => {
      console.warn('[Lobby error]', msg);
      // 清理 roomId，保持在首页或当前界面
      this.roomId = null;
      this.gameStarted = false;
      this.lastSnapshot = null;
      if (String(msg || '').includes('Room not found')) {
        this.clearSession();
      }
      if (typeof window !== 'undefined' && window.showToast) {
        try { window.showToast(`加入失败：${msg}`); } catch (_) { }
      }
      this._emit();
    });

    this.socket.on('roomState', (roomState) => {
      // Only update server player list; keep local bots intact
      this.serverPlayers = roomState.players || [];
      this.roomId = roomState.roomId;
      this.gameStarted = !!roomState.gameStarted;
      this.lastSnapshot = roomState.snapshot || null;
      this.roomSettings = normalizeRoomSettings(roomState.settings);
      const self = this.serverPlayers.find(p => p.id === this.playerId);
      if (self?.name) this.playerName = self.name;
      this._writeSession({ roomId: this.roomId, name: this.playerName, gameStarted: this.gameStarted });
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
    if (typeof fn !== 'function') return () => { };
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  unsubscribe(fn) {
    this._subs.delete(fn);
  }

  _emit() {
    this._subs.forEach(fn => { try { fn(); } catch (_) { } });
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
    if (this.connected && this.socket && this.roomId && this.isHost()) {
      this.socket.emit('addBot', { roomId: this.roomId, name });
      return null;
    }

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
    this.gameStarted = false;
    this.lastSnapshot = null;
    this.roomSettings = { ...DEFAULT_ROOM_SETTINGS };
    this._emit();
  }

  getRoomSettings() {
    return normalizeRoomSettings(this.roomSettings);
  }

  updateRoomSettings(partial = {}) {
    const next = normalizeRoomSettings({ ...this.roomSettings, ...partial });
    this.roomSettings = next;

    if (!this.connected || !this.socket || !this.roomId || String(this.roomId).startsWith('local-')) {
      this._emit();
      return next;
    }

    if (this.isHost()) {
      this.socket.emit('updateRoomSettings', this.roomId, next);
    }
    this._emit();
    return next;
  }

  startGame(settings = this.getRoomSettings()) {
    if (!this.roomId) return false;
    this.roomSettings = normalizeRoomSettings(settings);
    if (String(this.roomId).startsWith('local-') || !this.socket || !this.connected) {
      this._emit();
      return false;
    }
    this.socket.emit('startGame', this.roomId, this.roomSettings);
    return true;
  }

  createRoom(name) {
    const action = () => {
      this.playerName = name;
      this.socket.emit('createRoom', { name, playerKey: this.playerKey });
      // Optimistic update: add self to list immediately
      if (this.playerId && !this.serverPlayers.some(p => p.id === this.playerId)) {
        this.serverPlayers.push({ id: this.playerId, name, ready: false });
        this._emit();
      }
    };

    if (this.connected) {
      action();
    } else {
      this._pendingAction = action;
      if (!this.socket) {
        this.connect();
      }
    }
  }

  joinRoom(roomId, name) {
    const action = () => {
      this.playerName = name;
      this.roomId = roomId;
      this._writeSession({ roomId, name, gameStarted: this.gameStarted });
      this.socket.emit('joinRoom', { roomId, name, playerKey: this.playerKey });
      // Optimistic update: add self to list immediately
      if (this.playerId && !this.serverPlayers.some(p => p.id === this.playerId)) {
        this.serverPlayers.push({ id: this.playerId, name, ready: false });
        this._emit();
      }
    };

    if (this.connected) {
      action();
    } else {
      this.roomId = roomId; // Remember which room to join
      this._pendingAction = action;
      if (!this.socket) {
        this.connect();
      }
    }
  }

  toggleReady() {
    if (!this.socket || !this.connected) {
      console.warn('Cannot toggle ready: not connected.');
      // For local testing, we can allow toggling ready status
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

  allReady() {
    const players = this.list();
    if (players.length < 2) return false; // 至少两名玩家才能开始
    return players.every(p => p.ready);
  }

  resumeSavedSession() {
    const saved = this.getSavedSession();
    if (!saved?.roomId || !saved?.name) return false;
    if (this.roomId && this.serverPlayers.length) return false;
    this.joinRoom(saved.roomId, saved.name);
    return true;
  }
}

export const LobbyManager = new LobbyManagerImpl();
// Back-compat for debug tools that expect window.lobby
if (typeof window !== 'undefined') {
  window.lobby = LobbyManager;
}

