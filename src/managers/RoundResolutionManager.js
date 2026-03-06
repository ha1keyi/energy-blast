// src/managers/RoundResolutionManager.js
// Visualizes chosen actions during the resolving phase with explicit lifecycle cleanup.

import { BattleLayoutManager } from './BattleLayoutManager.js';

export class BattleAnimationManager {
  constructor(core, scene) {
    this.core = core;
    this.scene = scene;
    this.layout = new BattleLayoutManager(scene);
    this.nodes = [];
    this.timers = [];
    this._active = true;
    this._signature = '';

    this.timer = this.scene.time.addEvent({ delay: 220, loop: true, callback: () => this.refresh() });
    this.scene.events.on('shutdown', this.cleanup, this);
    this.scene.events.on('destroy', this.cleanup, this);
  }

  cleanup() {
    if (!this._active) return;
    this._active = false;
    if (this.timer) {
      this.timer.remove(false);
      this.timer = null;
    }
    this.timers.forEach(timer => timer?.remove?.(false));
    this.timers = [];
    this.clearSprites();
    this._signature = '';
  }

  reset() {
    if (!this._active) return;
    this.clearSprites();
    this._signature = '';
  }

  trackNode(node) {
    if (node) this.nodes.push(node);
    return node;
  }

  trackTimer(timer) {
    if (timer) this.timers.push(timer);
    return timer;
  }

  refresh() {
    const core = this.core;
    if (!core || !this._active) return;

    const shouldShow = core.gameState === 'resolving' || core.gameState === 'ended';
    if (!shouldShow) {
      this.clearSprites();
      this._signature = '';
      return;
    }

    const signature = JSON.stringify((core.players || []).map(player => ({
      id: player.networkId ?? player.id,
      action: player.currentAction?.name || '',
      type: player.currentAction?.type || '',
      level: player.currentAction?.level || 0,
      target: player.target?.networkId ?? player.target?.id ?? null,
      state: core.gameState,
      round: core.currentRound,
    })));

    if (signature === this._signature) return;
    this._signature = signature;
    this.clearSprites();
    this.buildSprites();
  }

  clearSprites() {
    this.nodes.forEach(node => {
      this.scene.tweens.killTweensOf(node);
      node?.destroy?.();
    });
    this.nodes = [];
    this.timers.forEach(timer => timer?.remove?.(false));
    this.timers = [];
  }

  buildSprites() {
    const core = this.core;
    const players = core.players || [];
    if (!players.length) return;

    const selfId = (window && window.localPlayerId) || players[0]?.id;
    const self = players.find(player => player.id === selfId);
    const others = players.filter(player => player.id !== selfId);
    const positions = this.layout.getActionSpritePositions(others.length);

    others.forEach((player, index) => {
      const position = positions[index];
      if (!position || !player.currentAction) return;
      const key = this.getActionImageKey(player.currentAction);
      if (!key) return;

      const sprite = this.trackNode(this.scene.add.image(position.x, position.y, key)
        .setDisplaySize(84, 84)
        .setDepth(22)
        .setOrigin(0.5));
      const targetScale = sprite.scaleX;
      sprite.setScale(0).setAlpha(0);
      this.scene.tweens.add({ targets: sprite, alpha: 1, scale: targetScale, duration: 180, ease: 'Quad.easeOut' });
      this.playActionEffect(player, position.x, position.y);
    });

    if (self?.currentAction) {
      const key = this.getActionImageKey(self.currentAction);
      if (key) {
        const { width } = this.scene.scale;
        const selfSize = Math.max(112, Math.min(width * 0.24, 220));
        const selfPosition = this.layout.getSelfActionPosition(selfSize);
        const sx = selfPosition.x;
        const sy = selfPosition.y;
        const sprite = this.trackNode(this.scene.add.image(sx, sy, key)
          .setDisplaySize(selfSize, selfSize)
          .setDepth(23)
          .setOrigin(0.5));
        const targetScale = sprite.scaleX;
        sprite.setScale(0).setAlpha(0);
        this.scene.tweens.add({ targets: sprite, alpha: 1, scale: targetScale, duration: 180, ease: 'Quad.easeOut' });
        this.playActionEffect(self, sx, sy);
      }
    }
  }

  playActionEffect(player, x, y) {
    const action = player.currentAction;
    if (!action) return;

    if (action.type === 'ATTACK') {
      const target = player.target;
      if (!target) return;
      const targetPos = this.getPlayerPosition(target);
      if (targetPos) this.createLineBlast(x, y, targetPos.x, targetPos.y);
      return;
    }

    if (action.type === 'DEFEND' || action.type === 'REBOUND') {
      this.createSketchShield(x, y);
      return;
    }

    if (action.energyGain > 0) {
      this.createEnergyRise(x, y);
    }
  }

  getPlayerPosition(player) {
    const players = this.core.players || [];
    const selfId = (window && window.localPlayerId) || players[0]?.id;

    if (player.id === selfId) {
      return this.layout.getSelfActionPosition();
    }

    const others = players.filter(p => p.id !== selfId);
    const index = others.findIndex(p => p.id === player.id);
    if (index === -1) return null;
    return this.layout.getActionSpritePositions(others.length)[index] || null;
  }

  createLineBlast(x1, y1, x2, y2) {
    for (let i = 0; i < 4; i++) {
      this.trackTimer(this.scene.time.addEvent({
        delay: i * 45,
        callback: () => {
          const graphics = this.trackNode(this.scene.add.graphics().setDepth(24));
          graphics.lineStyle(2, 0x000000, 1);
          const ox = (Math.random() - 0.5) * 16;
          const oy = (Math.random() - 0.5) * 16;
          graphics.beginPath();
          graphics.moveTo(x1 + ox, y1 + oy);
          graphics.lineTo(x2 + ox, y2 + oy);
          graphics.strokePath();
          this.scene.tweens.add({ targets: graphics, alpha: 0, duration: 220, onComplete: () => graphics.destroy() });
        }
      }));
    }
  }

  createSketchShield(x, y) {
    const graphics = this.trackNode(this.scene.add.graphics().setDepth(24));
    graphics.lineStyle(3, 0x000000, 1);
    for (let i = 0; i < 3; i++) {
      const radius = 34 + i * 7;
      graphics.beginPath();
      for (let angle = 0; angle < 360; angle += 12) {
        const rad = angle * (Math.PI / 180);
        const r = radius + (Math.random() - 0.5) * 8;
        const px = x + Math.cos(rad) * r;
        const py = y + Math.sin(rad) * r;
        if (angle === 0) graphics.moveTo(px, py);
        else graphics.lineTo(px, py);
      }
      graphics.closePath();
      graphics.strokePath();
    }
    this.scene.tweens.add({ targets: graphics, alpha: 0, scale: 1.12, duration: 420, onComplete: () => graphics.destroy() });
  }

  createEnergyRise(x, y) {
    for (let i = 0; i < 8; i++) {
      const line = this.trackNode(this.scene.add.line(
        x + (Math.random() - 0.5) * 34,
        y,
        0, 0, 0, -24,
        0x000000,
      ).setDepth(24).setLineWidth(2));

      this.scene.tweens.add({
        targets: line,
        y: y - 44,
        alpha: 0,
        duration: 520,
        delay: Math.random() * 180,
        onComplete: () => line.destroy(),
      });
    }
  }

  getActionImageKey(action) {
    if (!action) return null;
    const type = (action.type || '').toLowerCase();
    const level = action.level || 1;
    return `${type}_${level}.jpg`;
  }

  showActionsAndResults(results = []) {
    return results;
  }
}

export class RoundResolutionManager extends BattleAnimationManager { }
