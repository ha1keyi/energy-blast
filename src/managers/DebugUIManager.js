// src/managers/DebugUIManager.js
// Minimal Debug UI manager; visible by default only for the room host.
import { LobbyManager } from './LobbyManager.js';

export class DebugUIManager {
  constructor(game) {
    this.game = game;
    this.isAutoResolve = true; // keep auto resolve default
    this.visible = false;
  }

  startUpdating() {
    // 控制可见性：只有房主默认可见
    this.updateVisibility();
    // 订阅 Lobby 变化以动态调整
    LobbyManager.subscribe(() => this.updateVisibility());
  }

  updateVisibility() {
    const shouldShow = !!LobbyManager.roomId && LobbyManager.isHost();
    this.visible = shouldShow;
    const panel = document.getElementById('debug-panel');
    if (panel) {
      panel.style.display = shouldShow ? '' : 'none';
    }
  }

  setAutoResolve(val) {
    this.isAutoResolve = !!val;
  }

  updatePlayerList() {
    // no-op placeholder to avoid errors from callers
  }

  updateGameState() {
    // no-op placeholder
  }

  // Hook: host collects remote actions to drive resolution
  onRemoteAction(payload) {
    // 可在此处接入 CombatManager/RoundResolutionManager
    // 目前仅记录日志
    if (window && typeof window.console !== 'undefined') {
      console.log('[DebugUI] remote action', payload);
    }
  }
}

export const DebugUIManagerSingleton = DebugUIManager;