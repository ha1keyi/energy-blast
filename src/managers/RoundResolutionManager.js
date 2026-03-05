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

    // 当游戏结束时，确保已生成的特效不会被立即清除，
    // 而是允许它们自然播放完毕（通过 tween 或 timer）。
    // 只有当进入 idle/selecting 状态时才强制清理。
    const shouldShow = (core.gameState === 'resolving' || core.gameState === 'ended');
    if (!shouldShow) {
      // Hide when not resolving or ended
      if (this.sprites.length) this.clearSprites();
      return;
    }

    // Only build if not already built for this resolution step
    // 注意：如果是 ended 状态，通常是在 resolving 之后，所以 sprite 应该已经存在
    // 如果 resolving 期间没有构建（比如直接结束），这里可以构建
    if (this.sprites.length === 0 && core.gameState === 'resolving') {
      this.buildSprites();
    }
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

      // 添加黑白手绘风格特效
      this.playActionEffect(p, pos.x, pos.y);
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

        // 添加黑白手绘风格特效
        this.playActionEffect(self, sx, sy);
      }
    }
  }

  // 播放黑白手绘风格特效
  playActionEffect(player, x, y) {
    const action = player.currentAction;
    if (!action) return;

    const { width, height } = this.scene.scale;
    const type = action.type;

    if (type === 'ATTACK') {
      // 攻击特效：黑白线条冲击波
      const target = player.target;
      if (target) {
        // 找到目标的位置（如果是自己，在底部；如果是别人，在 positions 中）
        const targetPos = this.getPlayerPosition(target);
        if (targetPos) {
          this.createLineBlast(x, y, targetPos.x, targetPos.y);
        }
      }
    } else if (type === 'DEFEND' || type === 'REBOUND') {
      // 防御/反弹特效：手绘圆圈盾牌
      this.createSketchShield(x, y);
    } else if (action.energyGain > 0) {
      // 储气特效：向上升起的线条
      this.createEnergyRise(x, y);
    }
  }

  getPlayerPosition(player) {
    const core = this.core;
    const players = core.players || [];
    const selfId = (window && window.localPlayerId) || (players[0]?.id);
    const { width, height } = this.scene.scale;

    if (player.id === selfId) {
      return { x: width / 2, y: height - 80 };
    }

    const others = players.filter(p => p.id !== selfId);
    const idx = others.findIndex(p => p.id === player.id);
    if (idx === -1) return null;

    const positions = this.computePositions(others.length, width, height);
    return positions[idx] || null;
  }

  createLineBlast(x1, y1, x2, y2) {
    const graphics = this.scene.add.graphics().setDepth(15);
    const lineCount = 5;

    for (let i = 0; i < lineCount; i++) {
      this.scene.time.addEvent({
        delay: i * 50,
        callback: () => {
          graphics.lineStyle(2, 0x000000, 1);
          // 稍微随机化线条位置，模拟手绘感
          const ox = (Math.random() - 0.5) * 20;
          const oy = (Math.random() - 0.5) * 20;
          graphics.beginPath();
          graphics.moveTo(x1 + ox, y1 + oy);
          graphics.lineTo(x2 + ox, y2 + oy);
          graphics.strokePath();

          this.scene.tweens.add({
            targets: graphics,
            alpha: 0,
            duration: 300,
            onComplete: () => graphics.destroy()
          });
        }
      });
    }
  }

  createSketchShield(x, y) {
    const graphics = this.scene.add.graphics().setDepth(15);
    graphics.lineStyle(3, 0x000000, 1);

    // 绘制多个不规则圆圈模拟手绘盾牌
    for (let i = 0; i < 3; i++) {
      const radius = 40 + i * 5;
      graphics.beginPath();
      for (let angle = 0; angle < 360; angle += 10) {
        const rad = Phaser.Math.DegToRad(angle);
        const r = radius + (Math.random() - 0.5) * 10;
        const px = x + Math.cos(rad) * r;
        const py = y + Math.sin(rad) * r;
        if (angle === 0) graphics.moveTo(px, py);
        else graphics.lineTo(px, py);
      }
      graphics.closePath();
      graphics.strokePath();
    }

    this.scene.tweens.add({
      targets: graphics,
      alpha: 0,
      scale: 1.2,
      duration: 500,
      onComplete: () => graphics.destroy()
    });
  }

  createEnergyRise(x, y) {
    for (let i = 0; i < 8; i++) {
      const line = this.scene.add.line(
        x + (Math.random() - 0.5) * 40,
        y,
        0, 0, 0, -20,
        0x000000
      ).setDepth(15).setLineWidth(2);

      this.scene.tweens.add({
        targets: line,
        y: y - 50,
        alpha: 0,
        duration: 600,
        delay: Math.random() * 300,
        onComplete: () => line.destroy()
      });
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
