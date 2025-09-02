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
  }

  selectAction(actionKey, targetId) {
    this.socket.emit('selectAction', this.roomId, actionKey, targetId);
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