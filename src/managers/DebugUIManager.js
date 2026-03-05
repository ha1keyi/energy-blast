// src/managers/DebugUIManager.js
// Minimal Debug UI manager; visible by default only for the room host.
import { LobbyManager } from './LobbyManager.js';

export class DebugUIManager {
  constructor(game) {
    this.game = game;
    this.isAutoResolve = true; // keep auto resolve default
    this.visible = false;
    this.forcedVisible = false; // 允许通过命令强制显示
  }

  startUpdating() {
    // 控制可见性：只有房主默认可见，且支持强制显示
    this.updateVisibility();
    // 订阅 Lobby 变化以动态调整
    LobbyManager.subscribe(() => this.updateVisibility());
    // 绑定面板控件与全局命令
    this.attachControls();
    if (typeof window !== 'undefined') {
      window.toggleDebugPanel = () => { this.toggleVisibility(); };
      window.togglevisibility = window.toggleDebugPanel; // 兼容旧命令
      window.setAutoResolve = (val) => { this.setAutoResolve(val); this.updateVisibility(); };
      window.resolveNow = async () => { if (this.game?.processRound) await this.game.processRound(); };
      // 非房主也允许手动触发一次结算（仅本地显示，不广播）
      window.resolveLocal = async () => { if (this.game?.processRound) await this.game.processRound(); };
      
      // Listen for Ctrl+Shift+D
      document.addEventListener('keydown', (e) => {
          if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
              e.preventDefault();
              this.toggleVisibility();
          }
      });
    }
  }

  updateVisibility() {
    const shouldShow = this.forcedVisible || (!!LobbyManager.roomId && LobbyManager.isHost());
    this.visible = shouldShow;
    const panel = document.getElementById('debug-panel');
    if (panel) {
      panel.style.display = shouldShow ? '' : 'none';
    }
  }

  toggleVisibility() {
    this.forcedVisible = !this.forcedVisible;
    this.updateVisibility();
    console.log(`Debug Panel ${this.forcedVisible ? 'Shown' : 'Hidden'}`);
  }

  setAutoResolve(val) {
    this.isAutoResolve = !!val;
    // 同步复选框状态
    const checkbox = document.getElementById('debug-auto-checkbox');
    if (checkbox) checkbox.checked = this.isAutoResolve;

    // 根据自动推进状态刷新下一次结算时间
    if (this.game) {
      const isHost = (typeof window !== 'undefined' && window.lobby && window.lobby.isHost && window.lobby.isHost());
      this.game.clearTimer?.();
      if (isHost && this.isAutoResolve && this.game.isRunning && this.game.gameState === 'selecting') {
        this.game.nextResolveAt = Date.now() + (this.game.roundTime || 5000);
        this.game.timer = setTimeout(async () => { await this.game.processRound(); }, (this.game.roundTime || 5000));
      } else {
        this.game.nextResolveAt = null;
      }
    }
  }

  attachControls() {
    const panel = document.getElementById('debug-panel');
    if (!panel) return; // 没有面板节点则跳过
    const checkbox = document.getElementById('debug-auto-checkbox');
    if (checkbox) {
      checkbox.checked = this.isAutoResolve;
      checkbox.onchange = () => this.setAutoResolve(checkbox.checked);
    }
    const resolveBtn = document.getElementById('debug-resolve-btn');
    if (resolveBtn) {
      resolveBtn.onclick = async () => { if (this.game?.processRound) await this.game.processRound(); };
    }
    
    // Player Stats Adjustment
    const setBtn = document.getElementById('debug-set-btn');
    if (setBtn) {
        setBtn.onclick = () => {
            const pidInput = document.getElementById('debug-pid');
            const propInput = document.getElementById('debug-prop');
            const valInput = document.getElementById('debug-val');
            
            if (!pidInput || !propInput || !valInput) return;
            
            const pid = parseInt(pidInput.value);
            const prop = propInput.value;
            const val = parseInt(valInput.value);
            
            if (isNaN(pid) || isNaN(val)) {
                alert('请输入有效的ID和数值');
                return;
            }
            
            const player = this.game.players.find(p => p.id === pid);
            if (player) {
                if (prop === 'health') player.health = val;
                if (prop === 'energy') player.energy = val;
                // Force update
                this.game.nextFrame();
                if (typeof window.showToast === 'function') window.showToast(`已更新玩家 ${player.name} ${prop} = ${val}`);
            } else {
                alert('未找到该ID的玩家');
            }
        };
    }
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