// src/managers/RoundResolutionManager.js
// Visualizes chosen actions during the resolving phase and can show simple results.
// Expected to be dynamically imported and instantiated from GameScene.

export class RoundResolutionManager {
  constructor(core, scene) {
    this.core = core;
    this.scene = scene;
    this.sprites = [];
    this._active = true;

    // Periodically refresh display following GameScene's polling cadence
    this.timer = this.scene.time.addEvent({ delay: 300, loop: true, callback: () => this.refresh() });

    // Cleanup on scene shutdown/destroy
    this.scene.events.on('shutdown', this.cleanup, this);
    this.scene.events.on('destroy', this.cleanup, this);
  }

  cleanup() {
    if (!this._active) return;
    this._active = false;
    if (this.timer) { this.timer.remove(false); this.timer = null; }
    this.clearSprites();
  }

  refresh() {
    const core = this.core;
    if (!core || !this._active) return;

    const shouldShow = core.gameState === 'resolving';
    if (!shouldShow) {
      // Hide when not resolving
      if (this.sprites.length) this.clearSprites();
      return;
    }

    // Only build if not already built for this resolution step
    if (this.sprites.length === 0) this.buildSprites();
  }

  clearSprites() {
    this.sprites.forEach(s => s?.destroy());
    this.sprites = [];
  }

  buildSprites() {
    const core = this.core;
    const { width, height } = this.scene.scale;

    const players = core.players || [];
    if (!players.length) return;

    const selfId = (window && window.localPlayerId) || (players[0]?.id);
    const self = players.find(p => p.id === selfId);
    const others = players.filter(p => p.id !== selfId);

    const positions = this.computePositions(others.length, width, height);

    // Opponents' action icons
    others.forEach((p, i) => {
      if (i >= positions.length) return;
      const action = p.currentAction;
      const key = this.getActionImageKey(action);
      if (!key) return;
      const pos = positions[i];
      const sprite = this.scene.add.image(pos.x, pos.y, key)
        .setDisplaySize(64, 64)
        .setDepth(12)
        .setOrigin(0.5)
        .setAlpha(0)
        .setScale(0.85);
      this.sprites.push(sprite);
      this.scene.tweens.add({ targets: sprite, alpha: 1, scale: 1, duration: 180, ease: 'Quad.easeOut' });
    });

    // Self action icon (near bottom center)
    if (self) {
      const action = self.currentAction;
      const key = this.getActionImageKey(action);
      if (key) {
        const sx = width / 2;
        const sy = Math.max(100, height - 160);
        const sprite = this.scene.add.image(sx, sy, key)
          .setDisplaySize(72, 72)
          .setDepth(13)
          .setOrigin(0.5)
          .setAlpha(0)
          .setScale(0.85);
        this.sprites.push(sprite);
        this.scene.tweens.add({ targets: sprite, alpha: 1, scale: 1, duration: 180, ease: 'Quad.easeOut' });
      }
    }
  }

  getActionImageKey(action) {
    if (!action) return null;
    const type = (action.type || '').toLowerCase();
    const level = action.level || 1;
    const key = `${type}_${level}.jpg`;
    // GameScene preloads all images by filename as keys, so we can directly use them
    return key;
  }

  computePositions(count, width, height) {
    const positions = [];
    if (count <= 0) return positions;
    const marginX = 100;
    const topY = 120;
    const rightX = width - marginX;
    const leftX = marginX;
    const sideTopY = 130;
    const sideBottomY = height * 0.75 - 40;

    const topCount = Math.ceil(count / 3);
    const rightCount = Math.floor((count - topCount) / 2);
    const leftCount = count - topCount - rightCount;

    for (let i = 0; i < topCount; i++) {
      const t = (i + 1) / (topCount + 1);
      const x = marginX + t * (width - marginX * 2);
      positions.push({ x, y: topY });
    }
    for (let i = 0; i < rightCount; i++) {
      const t = (i + 1) / (rightCount + 1);
      const y = sideTopY + t * (sideBottomY - sideTopY);
      positions.push({ x: rightX, y });
    }
    for (let i = 0; i < leftCount; i++) {
      const t = (i + 1) / (leftCount + 1);
      const y = sideTopY + t * (sideBottomY - sideTopY);
      positions.push({ x: leftX, y });
    }

    return positions;
  }

  // Reserved API: show actions alongside result texts (can be extended later)
  showActionsAndResults(results = []) {
    // Results could be animated text near icons; kept minimal for now
  }
}
