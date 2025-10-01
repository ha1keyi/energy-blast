import { Player } from './Player.js';

export class GameClient {
  constructor(socket, roomId) {
    this.socket = socket;
    this.roomId = roomId;
    this.players = [];
    this.currentRound = 0;
    this.gameState = 'idle';
    this.logs = [];
    this.setupListeners();
  }

  setupListeners() {
    this.socket.on('gameStarted', () => {
      this.gameState = 'selecting';
      // 更新UI
    });

    this.socket.on('roundResolved', (state) => {
      this.players = state.players.map(p => new Player(p.id, p.name, p.health, p.energy));
      this.currentRound = state.round;
      this.gameState = state.state;
      this.logs = state.logs;
      // 更新UI
    });

    this.socket.on('gameEnded', (reason) => {
      this.gameState = 'ended';
      // 处理游戏结束
    });

    // 新增：其他端动作选择广播
    this.socket.on('actionSelected', ({ playerId, actionKey, targetId, targetName }) => {
      // 仅主机端负责结算，因此这里只记录/更新 UI 或者交给宿主回合处理器
      if (window.lobby && typeof window.lobby.isHost === 'function' && window.lobby.isHost()) {
        // 主机：可以在 CombatManager 中收集并触发结算（此处预留，由 DebugUI/CombatManager 接入）
        if (window.debugUI && typeof window.debugUI.onRemoteAction === 'function') {
          window.debugUI.onRemoteAction({ playerId, actionKey, targetId, targetName });
        }
      }
    });
  }

  selectAction(actionKey, targetName) {
    this.socket.emit('selectAction', this.roomId, actionKey, targetName);
  }

  getGameState() {
    return {
      round: this.currentRound,
      state: this.gameState,
      players: this.players.map(p => p.getStatus()),
      logs: this.logs
    };
  }
}