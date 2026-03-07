// src/core/GameStateStore.js
// Minimal observable store for game state snapshots with basic robustness.

export class GameStateStore {
  constructor(game) {
    this.game = game;
    this.state = { round: 0, state: 'idle', players: [], logs: [], isRunning: false };
    this._subs = new Set();
  }

  subscribe(fn) {
    if (typeof fn === 'function') {
      this._subs.add(fn);
      return () => this._subs.delete(fn);
    }
    return () => { };
  }
  _emit() { this._subs.forEach(fn => { try { fn(this.state); } catch (_) { } }); }

  updateState(partial) {
    if (!partial || typeof partial !== 'object') return;
    const prev = this.state;
    const next = { ...prev, ...partial };
    if (Array.isArray(partial.logs)) next.logs = partial.logs.slice();
    if (Array.isArray(partial.players)) next.players = partial.players.map(p => ({ ...p }));

    const prevLogsSignature = JSON.stringify(Array.isArray(prev.logs) ? prev.logs : []);
    const nextLogsSignature = JSON.stringify(Array.isArray(next.logs) ? next.logs : []);
    const prevPlayersSignature = JSON.stringify(Array.isArray(prev.players) ? prev.players : []);
    const nextPlayersSignature = JSON.stringify(Array.isArray(next.players) ? next.players : []);

    const changed = (
      prev.round !== next.round ||
      prev.state !== next.state ||
      prev.isRunning !== next.isRunning ||
      prevLogsSignature !== nextLogsSignature ||
      prevPlayersSignature !== nextPlayersSignature
    );

    if (!changed) return;
    this.state = next;
    this._emit();
  }

  addLog(message) {
    // 统一结构：{ round, message }，向后兼容字符串或对象输入
    const round = (this.game && typeof this.game.currentRound === 'number') ? this.game.currentRound : 0;
    let entry;
    if (message && typeof message === 'object') {
      const msgText = message.message != null ? String(message.message) : (message.text != null ? String(message.text) : String(message));
      const r = (message.round != null ? message.round : round);
      entry = { round: r, message: msgText };
    } else {
      entry = { round, message: String(message) };
    }

    // Keep Game.logs in sync to ensure getGameState() reflects logs correctly
    if (this.game) {
      if (!Array.isArray(this.game.logs)) this.game.logs = [];
      this.game.logs.push(entry);
    }
    const logs = Array.isArray(this.state.logs) ? this.state.logs.slice() : [];
    logs.push(entry);
    this.state = { ...this.state, logs };
    this._emit();
  }

  clearLogs() {
    if (this.game && Array.isArray(this.game.logs)) this.game.logs.length = 0;
    this.state = { ...this.state, logs: [] };
    this._emit();
  }

  // Apply a full snapshot from network safely and sync both core and store
  applySnapshot(snap) {
    if (!snap || typeof snap !== 'object' || !this.game) return;
    const core = this.game;
    const prevRound = core.currentRound;
    if (snap.matchSettings && typeof snap.matchSettings === 'object') {
      core.applyMatchSettings?.(snap.matchSettings, { reschedule: false });
    }
    // Basic fields
    if (typeof snap.round === 'number') core.currentRound = snap.round;
    const nextState = snap.state || snap.gameState;
    if (typeof nextState === 'string') core.gameState = nextState;
    if (typeof snap.isRunning === 'boolean') core.isRunning = snap.isRunning;
    else if (typeof nextState === 'string') core.isRunning = nextState === 'selecting' || nextState === 'resolving';
    const isHost = !!(typeof window !== 'undefined' && window.lobby?.isHost?.());
    const useServerDisplayTimer = !!(typeof window !== 'undefined' && window.lobby?.connected && window.lobby?.roomId && !String(window.lobby.roomId).startsWith('local-'));
    if (typeof snap.nextResolveAt === 'number' && Number.isFinite(snap.nextResolveAt) && !(useServerDisplayTimer && core.gameState === 'selecting')) {
      if (!isHost && core.gameState === 'selecting' && typeof core.nextResolveAt === 'number' && prevRound === snap.round) {
        core.nextResolveAt = Math.min(core.nextResolveAt, snap.nextResolveAt);
      } else {
        core.nextResolveAt = snap.nextResolveAt;
      }
    } else if (core.gameState !== 'selecting') core.nextResolveAt = null;
    if (Array.isArray(snap.logs)) core.logs = snap.logs.slice();

    // Players by name preferred (fallback to id)
    const localByName = new Map(core.players.map(p => [p.name, p]));
    const localById = new Map(core.players.map(p => [p.id, p]));
    const localByNetworkId = new Map(core.players.filter(p => p.networkId != null).map(p => [p.networkId, p]));
    if (Array.isArray(snap.players)) {
      const pendingTargets = [];
      snap.players.forEach(sp => {
        let lp = null;
        if (sp && typeof sp === 'object') {
          if (sp.networkId != null && localByNetworkId.has(sp.networkId)) lp = localByNetworkId.get(sp.networkId);
          else if (sp.name && localByName.has(sp.name)) lp = localByName.get(sp.name);
          else if (sp.id != null && localById.has(sp.id)) lp = localById.get(sp.id);
          if (!lp && sp.name) {
            try {
              core.addPlayer(sp.name, { networkId: sp.networkId, isBot: !!sp.isBot });
              lp = core.players.find(p => p.name === sp.name);
            } catch (_) { }
          }
          if (lp) {
            if (sp.networkId != null) lp.networkId = sp.networkId;
            if (typeof sp.health === 'number') lp.health = sp.health;
            if (typeof sp.energy === 'number') lp.energy = sp.energy;
            if (typeof sp.isAlive === 'boolean') lp.isAlive = sp.isAlive;
            lp.isBot = !!sp.isBot;
            lp.roundReady = !!sp.roundReady;

            // Keep action details for remote animation rendering.
            if (sp.currentAction && typeof sp.currentAction === 'object') {
              lp.currentAction = { ...sp.currentAction };
            } else {
              lp.currentAction = null;
            }

            pendingTargets.push({
              player: lp,
              targetId: sp.targetId,
              targetNetworkId: sp.targetNetworkId,
              targetName: sp.targetName,
            });
          }
        }
      });

      pendingTargets.forEach(({ player, targetId, targetNetworkId, targetName }) => {
        let target = null;
        if (targetId != null) target = core.players.find(p => p.id === targetId) || null;
        if (!target && targetNetworkId != null) target = core.players.find(p => p.networkId === targetNetworkId) || null;
        if (!target && targetName) target = core.players.find(p => p.name === targetName) || null;
        player.target = target;
      });
    }

    // Sync store with canonical core snapshot
    const storePlayers = core.players.map(p => p.getStatus());
    this.updateState({
      round: core.currentRound,
      state: core.gameState,
      isRunning: !!core.isRunning,
      logs: core.logs,
      players: storePlayers,
    });

    if (core.debugUIManager && typeof core.debugUIManager.updateGameState === 'function') {
      core.debugUIManager.updateGameState();
    }
  }

  getState() { return this.state; }
}