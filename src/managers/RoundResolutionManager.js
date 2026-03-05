// src/managers/RoundResolutionManager.js
// Visualizes chosen actions during the resolving phase and can show simple results.
// Expected to be dynamically imported and instantiated from GameScene.

import Phaser from 'phaser';

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
    } else if (core.gameState === 'resolving' && this.sprites.length > 0) {
      // Rebuild once per resolve step when actions changed.
      const hasAnyAction = (core.players || []).some(p => !!p.currentAction);
      if (!hasAnyAction) {
        this.clearSprites();
      }
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
    const tinyEnemyMarkers = [];
    others.forEach((p, i) => {
      if (i >= positions.length) return;
      const action = p.currentAction;
      const key = this.getActionImageKey(action);
      if (!key) return;
      const pos = positions[i];
      const sprite = this.scene.add.image(pos.x, pos.y, key)
        .setDisplaySize(100, 100)
        .setDepth(12)
        .setOrigin(0.5);

      const targetScale = sprite.scaleX;
      sprite.setScale(0).setAlpha(0);

      this.sprites.push(sprite);
      this.scene.tweens.add({ targets: sprite, alpha: 1, scale: targetScale, duration: 180, ease: 'Quad.easeOut' });
      tinyEnemyMarkers.push({ key, idx: i });

      // 添加黑白手绘风格特效
      this.playActionEffect(p, pos.x, pos.y);
    });

    // Self action icon (near bottom center)
    if (self) {
      const action = self.currentAction;
      const key = this.getActionImageKey(action);
      if (key) {
        // 己方占据较大比例，营造第一人称视角
        const selfSize = Math.max(250, Math.min(width, height) * 0.5);
        const sx = width / 2;
        const sy = height - selfSize / 2 + 20; // 稍微靠下一点
        const sprite = this.scene.add.image(sx, sy, key)
          .setDisplaySize(selfSize, selfSize)
          .setDepth(13)
          .setOrigin(0.5);

        const targetScale = sprite.scaleX;
        sprite.setScale(0).setAlpha(1);

        this.sprites.push(sprite);
        this.scene.tweens.add({ targets: sprite, alpha: 1, scale: targetScale, duration: 180, ease: 'Quad.easeOut' });

        // Overlay tiny enemy action markers above self icon to make opponents' actions always visible.
        const markerCount = Math.min(4, tinyEnemyMarkers.length);
        for (let i = 0; i < markerCount; i++) {
          const marker = tinyEnemyMarkers[i];
          const spacing = 45;
          const mx = sx + (i - (markerCount - 1) / 2) * spacing;
          const my = sy - selfSize / 2 - 30; // 放在自己大图标的上方
          const tiny = this.scene.add.image(mx, my, marker.key)
            .setDisplaySize(40, 40)
            .setDepth(14)
            .setOrigin(0.5);

          const tinyTargetScale = tiny.scaleX;
          tiny.setScale(0).setAlpha(0);

          this.sprites.push(tiny);
          this.scene.tweens.add({ targets: tiny, alpha: 1, scale: tinyTargetScale, duration: 140, ease: 'Quad.easeOut', delay: i * 40 });
        }

        // 添加黑白手绘风格特效
        this.playActionEffect(self, sx, sy);
      }
    }
  }

  // 播放黑白手绘风格特效
  playActionEffect(player, x, y) {
    const action = player.currentAction;
    if (!action) return;

    const type = action.type;
    const level = action.level || 1;

    if (type === 'ATTACK') {
      const target = player.target;
      if (target) {
        const targetPos = this.getPlayerPosition(target);
        if (targetPos) {
          if (level === 1) {
            // 小波 (Level 1): 手枪形态，类似发射子弹
            this.createPistolBlast(x, y, targetPos.x, targetPos.y);
          } else {
            // 大波 (Level 2): 气功波，当前版本最强技能
            this.createQigongWave(x, y, targetPos.x, targetPos.y);
          }
        }
      }
    } else if (type === 'DEFEND' || type === 'REBOUND') {
      // 防御/反弹特效：手绘圆圈盾牌
      this.createSketchShield(x, y);
    } else if (action.energyGain > 0 || type === 'STORE') {
      // 储气特效：中国武术概念的聚气
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

  // 小波特效：手绘风子弹射击
  createPistolBlast(x1, y1, x2, y2) {
    // 绘制手枪发射的枪口火光（粗糙的爆炸星形）
    const flash = this.scene.add.graphics().setDepth(15);
    flash.lineStyle(3, 0x000000, 1);
    flash.fillStyle(0xffffff, 1);
    flash.beginPath();
    for (let j = 0; j < 8; j++) {
      const angle = (j / 8) * Math.PI * 2;
      const r = j % 2 === 0 ? 25 : 10;
      const px = x1 + Math.cos(angle) * r;
      const py = y1 + Math.sin(angle) * r;
      if (j === 0) flash.moveTo(px, py);
      else flash.lineTo(px, py);
    }
    flash.closePath();
    flash.fillPath();
    flash.strokePath();

    this.scene.tweens.add({
      targets: flash,
      scale: 1.5,
      alpha: 0,
      duration: 200,
      onComplete: () => flash.destroy()
    });

    // 绘制高速子弹轨迹
    const bullet = this.scene.add.graphics().setDepth(15);
    bullet.lineStyle(4, 0x000000, 1);

    // 子弹头部和尾部
    const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const angle = Phaser.Math.Angle.Between(x1, y1, x2, y2);

    const bulletLine = { t: 0 };
    this.scene.tweens.add({
      targets: bulletLine,
      t: 1,
      duration: 300,
      ease: 'Cubic.easeIn',
      onUpdate: () => {
        bullet.clear();
        bullet.lineStyle(4, 0x000000, 1);
        const currentDist = bulletLine.t * dist;
        const tailDist = Math.max(0, currentDist - 40);

        const bx1 = x1 + Math.cos(angle) * tailDist;
        const by1 = y1 + Math.sin(angle) * tailDist;
        const bx2 = x1 + Math.cos(angle) * currentDist;
        const by2 = y1 + Math.sin(angle) * currentDist;

        // 带有随机抖动的子弹线
        bullet.beginPath();
        bullet.moveTo(bx1 + (Math.random() - 0.5) * 4, by1 + (Math.random() - 0.5) * 4);
        bullet.lineTo(bx2 + (Math.random() - 0.5) * 4, by2 + (Math.random() - 0.5) * 4);
        bullet.strokePath();
      },
      onComplete: () => bullet.destroy()
    });

    // 几条平行的速度线产生冲击感
    for (let i = 0; i < 3; i++) {
      this.scene.time.addEvent({
        delay: i * 60,
        callback: () => {
          const lines = this.scene.add.graphics().setDepth(14);
          lines.lineStyle(1.5, 0x000000, 0.6);
          const ox = (Math.random() - 0.5) * 40;
          const oy = (Math.random() - 0.5) * 40;
          lines.beginPath();
          lines.moveTo(x1 + ox, y1 + oy);
          lines.lineTo(x2 + ox, y2 + oy);
          lines.strokePath();
          this.scene.tweens.add({ targets: lines, alpha: 0, duration: 150, onComplete: () => lines.destroy() });
        }
      });
    }
  }

  // 大波特效：强力气功波（手绘波动感）
  createQigongWave(x1, y1, x2, y2) {
    const wave = this.scene.add.graphics().setDepth(15);
    const particles = this.scene.add.graphics().setDepth(16);

    const dist = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const angle = Phaser.Math.Angle.Between(x1, y1, x2, y2);

    // 气功波从发射者到目标逐渐变宽
    const waveProg = { t: 0 };
    this.scene.tweens.add({
      targets: waveProg,
      t: 1,
      duration: 250,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        wave.clear();
        particles.clear();

        // 粗墨迹内填充
        wave.lineStyle(1, 0x000000, 1);
        wave.fillStyle(0xffffff, 1);
        wave.beginPath();

        const currDist = waveProg.t * dist;

        // 构建不规则的波动多边形
        const steps = 10;
        const leftPoints = [];
        const rightPoints = [];

        for (let i = 0; i <= steps; i++) {
          const stepDist = (i / steps) * currDist;
          const cx = x1 + Math.cos(angle) * stepDist;
          const cy = y1 + Math.sin(angle) * stepDist;

          // 越靠近波头越粗，加上波动随机性
          const thickness = 10 + (i / steps) * 40 + (Math.random() * 15);

          leftPoints.push({
            x: cx + Math.cos(angle - Math.PI / 2) * thickness,
            y: cy + Math.sin(angle - Math.PI / 2) * thickness
          });
          rightPoints.unshift({
            x: cx + Math.cos(angle + Math.PI / 2) * thickness,
            y: cy + Math.sin(angle + Math.PI / 2) * thickness
          });

          // 画气功波周围散溢的墨滴（手绘粒子）
          if (Math.random() > 0.4) {
            const px = cx + (Math.random() - 0.5) * thickness * 3;
            const py = cy + (Math.random() - 0.5) * thickness * 3;
            particles.fillStyle(0x000000, 1);
            particles.fillCircle(px, py, 1 + Math.random() * 3);
          }
        }

        wave.moveTo(leftPoints[0].x, leftPoints[0].y);
        for (let i = 1; i < leftPoints.length; i++) wave.lineTo(leftPoints[i].x, leftPoints[i].y);
        // 波头呈圆弧
        wave.lineTo(rightPoints[0].x, rightPoints[0].y);
        for (let i = 1; i < rightPoints.length; i++) wave.lineTo(rightPoints[i].x, rightPoints[i].y);

        wave.closePath();
        wave.fillPath();
        wave.strokePath();

        // 核心高能墨线
        wave.lineStyle(3, 0x000000, 1);
        wave.beginPath();
        wave.moveTo(x1, y1);
        const coreWaveEndX = x1 + Math.cos(angle) * currDist;
        const coreWaveEndY = y1 + Math.sin(angle) * currDist;
        wave.lineTo(coreWaveEndX + (Math.random() - 0.5) * 10, coreWaveEndY + (Math.random() - 0.5) * 10);
        wave.strokePath();
      },
      onComplete: () => {
        this.scene.tweens.add({
          targets: [wave, particles],
          alpha: 0,
          scale: 1.1,
          duration: 300,
          onComplete: () => {
            wave.destroy();
            particles.destroy();
          }
        });
      }
    });

    // 波头爆炸闪光
    this.scene.time.delayedCall(250, () => {
      const boom = this.scene.add.graphics().setDepth(16);
      boom.lineStyle(4, 0x000000, 1);
      boom.beginPath();
      // 手绘爆炸
      for (let a = 0; a < 360; a += 30) {
        const rad = a * Math.PI / 180;
        const rLength = 30 + Math.random() * 50;
        boom.moveTo(x2, y2);
        boom.lineTo(x2 + Math.cos(rad) * rLength, y2 + Math.sin(rad) * rLength);
      }
      boom.strokePath();

      this.scene.tweens.add({
        targets: boom,
        alpha: 0,
        duration: 300,
        onComplete: () => boom.destroy()
      });
    });
  }

  createSketchShield(x, y) {
    const shieldGrp = this.scene.add.container(x, y).setDepth(15);

    // 绘制几层不规则的同心圆，像毛笔画的盾
    for (let i = 0; i < 4; i++) {
      const g = this.scene.add.graphics();
      g.lineStyle(3 + Math.random() * 2, 0x000000, 0.8);

      const radius = 35 + i * 8;
      g.beginPath();
      // 每一圈不完全闭合
      const startAngle = Math.random() * Math.PI * 2;
      const endAngle = startAngle + Math.PI * 1.5 + Math.random() * Math.PI * 0.4;

      for (let a = startAngle; a < endAngle; a += 0.2) {
        const r = radius + (Math.random() - 0.5) * 8;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (a === startAngle) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.strokePath();

      // 给每一层都加一点不同的旋转动画以增强动态感
      this.scene.tweens.add({
        targets: g,
        angle: 360 * (i % 2 === 0 ? 1 : -1),
        duration: 2000,
        repeat: -1
      });
      shieldGrp.add(g);
    }

    // 盾牌整体闪烁出现并逐渐消散
    shieldGrp.setScale(0.5);
    this.scene.tweens.add({
      targets: shieldGrp,
      scale: 1.2,
      alpha: { from: 1, to: 0 },
      duration: 600,
      ease: 'Quad.easeOut',
      onComplete: () => shieldGrp.destroy()
    });
  }

  createEnergyRise(x, y) {
    // 气功聚气特效（中国武术概念）
    // 产生大量细墨线从向外汇聚到中心的过程，伴随上升的效果
    const numParticles = 12;
    for (let i = 0; i < numParticles; i++) {
      // 起始点在玩家周围随机位置
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 40;
      const startX = x + Math.cos(angle) * dist;
      const startY = y + Math.sin(angle) * dist;

      const particle = this.scene.add.graphics().setDepth(15);
      particle.lineStyle(2, 0x000000, 1);

      // 画一个带有尾迹的聚气点（类似蝌蚪逗号）
      particle.beginPath();
      particle.moveTo(0, 0);
      particle.lineTo(Math.cos(angle) * 15, Math.sin(angle) * 15);
      particle.strokePath();

      particle.setPosition(startX, startY);

      // 汇聚到中心并发光
      this.scene.tweens.add({
        targets: particle,
        x: x,
        y: y - 20, // 略微上升
        alpha: { from: 0, to: 1 },
        duration: 300 + Math.random() * 200,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          particle.clear();
          particle.fillStyle(0xffffff, 1);
          particle.lineStyle(2, 0x000000, 1);
          particle.fillCircle(0, 0, 5);
          particle.strokeCircle(0, 0, 5);

          // 中心爆发
          this.scene.tweens.add({
            targets: particle,
            y: y - 60,
            scale: 2,
            alpha: 0,
            duration: 200,
            onComplete: () => particle.destroy()
          });
        }
      });
    }

    // 底部的上升气流线
    for (let i = 0; i < 5; i++) {
      const line = this.scene.add.graphics().setDepth(14);
      line.lineStyle(2, 0x000000, 0.5);
      const ox = (Math.random() - 0.5) * 60;

      line.beginPath();
      line.moveTo(x + ox, y + 20);
      // 曲折上升
      line.lineTo(x + ox + (Math.random() - 0.5) * 10, y - 20);
      line.lineTo(x + ox + (Math.random() - 0.5) * 15, y - 60);
      line.strokePath();

      this.scene.tweens.add({
        targets: line,
        y: -40,
        alpha: { from: 1, to: 0 },
        duration: 400 + Math.random() * 200,
        ease: 'Quad.easeOut',
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
