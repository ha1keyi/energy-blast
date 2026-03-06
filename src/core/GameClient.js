export class GameClient {
  constructor(socket, roomId) {
    this.socket = socket;
    this.roomId = roomId;
    this.active = !!socket;
  }

  selectAction(actionKey, targetId) {
    if (!this.socket || typeof this.socket.emit !== 'function') return;
    this.socket.emit('selectAction', this.roomId, actionKey, targetId);
  }

  getGameState() {
    return null;
  }
}