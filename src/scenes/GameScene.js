// src/scenes/GameScene.js
import Phaser from 'phaser';

// Resolve action images via Vite eager glob
const actionImages = import.meta.glob('../assets/images/*.jpg', { eager: true });
const actionImgMap = {};
for (const p in actionImages) {
    const mod = actionImages[p];
    const url = mod?.default || mod;
    const name = p.split('/').pop();
    actionImgMap[name] = url;
}

export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    preload() {
        // Preload action images with filename as key (e.g., attack_1.jpg)
        for (const name in actionImgMap) {
            this.load.image(name, actionImgMap[name]);
        }
    }

    create() {
        // Hand-drawn black/white scene frame
        const { width, height } = this.scale;
        const g = this.add.graphics();
        g.fillStyle(0xffffff, 0.9).fillRect(0, 0, width, height);
        g.lineStyle(6, 0x000000, 1).strokeRect(6, 6, width - 12, height - 12);
        // Title
        this.add.text(Math.round(width / 2), 28, 'Energy Blast', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '24px', color: '#000', stroke: '#fff', strokeThickness: 4
        }).setOrigin(0.5, 0);

        // HUD & action display
        this.hudItems = [];
        this.actionSprites = [];
        this.updateHUD();

        // Pending-attack hint text (center top)
        this.pendingHint = this.add.text(Math.round(width / 2), 56, '请选择攻击目标…', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '18px', color: '#000', backgroundColor: '#fff'
        }).setOrigin(0.5).setDepth(20).setVisible(false);

        // Poll to refresh HUD and show chosen actions on resolve
        this.time.addEvent({
            delay: 300,
            loop: true,
            callback: () => {
                this.updateHUD();
                this.updateActionSprites();
                this.updatePendingHint();
            }
        });
    }

    update() { }

    getCore() { return window.game; }

    updatePendingHint() {
        const show = !!window.pendingAttack && this.getCore()?.gameState === 'selecting';
        this.pendingHint?.setVisible(show);
    }

    // 统一的对手分布：在左/右边框的上75%区域，以及上边框内均匀分布
    getOpponentPositions(count, width, height) {
        const positions = [];
        if (count <= 0) return positions;

        // 轨道：上边、左上75%、右上75%
        const marginX = 70;
        const topY = 70;
        const leftX = marginX;
        const rightX = width - marginX;
        const sideTopY = 100;
        const sideBottomY = height * 0.75; // 上 75%

        // 当只有1人：上方正中
        if (count === 1) {
            positions.push({ x: width / 2, y: topY, align: 0.5 });
            return positions;
        }

        // 其余：按比例将序列分配到三条边：上、右、左，保证两人时落在左右上方
        const topCount = Math.ceil(count / 3);
        const rightCount = Math.floor((count - topCount) / 2);
        const leftCount = count - topCount - rightCount;

        // 顶部均匀分布（避开左右边距）
        for (let i = 0; i < topCount; i++) {
            const t = (i + 1) / (topCount + 1);
            const x = marginX + t * (width - marginX * 2);
            positions.push({ x, y: topY, align: 0.5 });
        }
        // 右侧从上到下（上75%范围）
        for (let i = 0; i < rightCount; i++) {
            const t = (i + 1) / (rightCount + 1);
            const y = sideTopY + t * (sideBottomY - sideTopY);
            positions.push({ x: rightX, y, align: 1 });
        }
        // 左侧从上到下（上75%范围）
        for (let i = 0; i < leftCount; i++) {
            const t = (i + 1) / (leftCount + 1);
            const y = sideTopY + t * (sideBottomY - sideTopY);
            positions.push({ x: leftX, y, align: 0 });
        }

        return positions;
    }

    // 改进的HUD更新方法
    updateHUD() {
        const core = this.getCore();
        if (!core) return;

        // Clear old
        this.hudItems.forEach(it => it.destroy());
        this.hudItems = [];

        const players = core.players || [];
        const selfId = window.localPlayerId || (players[0]?.id);
        const others = players.filter(p => p.id !== selfId);
        const { width, height } = this.scale;

        if (others.length === 0) return;

        const positions = this.getOpponentPositions(others.length, width, height);

        others.forEach((p, i) => {
            if (i >= positions.length) return;
            const pos = positions[i];
            const card = this.add.container(pos.x, pos.y);
            const shadow = this.add.rectangle(4, 4, 180, 80, 0x222222, 1);
            const bg = this.add.rectangle(0, 0, 180, 80, 0xffffff, 1).setStrokeStyle(3, 0x000000);
            const name = this.add.text(0, -22, p.name, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: '#000' }).setOrigin(pos.align, 0.5);
            const energy = this.add.text(0, 2, `气: ${p.energy}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: '#000' }).setOrigin(pos.align, 0.5);
            const health = this.add.text(0, 26, `❤️: ${p.health}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: p.health <= 0 ? '#ff0000' : '#000' }).setOrigin(pos.align, 0.5);
            card.add([shadow, bg, name, energy, health]);
            // 点击对手直接作为目标
            card.setSize(180, 80);
            card.setInteractive(new Phaser.Geom.Rectangle(0, 0, 180, 80), Phaser.Geom.Rectangle.Contains);
            // hover feedback when selecting
            card.on('pointerover', () => { if (window.pendingAttack) card.setScale(1.03); });
            card.on('pointerout', () => { if (window.pendingAttack) card.setScale(1.0); });
            card.on('pointerdown', () => {
                const pa = window.pendingAttack;
                const core2 = this.getCore();
                if (!pa || !core2) return;
                const me = core2.players.find(x => x.id === pa.selfId);
                if (!me || !p.isAlive) return;
                try {
                    me.selectAction(pa.actionKey, p);
                    window.pendingAttack = null;
                    if (window.debugUI) window.debugUI.updatePlayerList();
                    // small click feedback
                    this.tweens.add({ targets: card, scale: 1.06, yoyo: true, duration: 120, repeat: 1 });
                } catch (e) {
                    console.error(e);
                }
            });
            if (!p.isAlive || p.health <= 0) card.setAlpha(0.5);
            card.setDepth(10);
            this.hudItems.push(card);
        });

        // 玩家自己的HUD固定在底部中央
        this.addPlayerHUD(width, height);
    }

    // 玩家自己的HUD
    addPlayerHUD(width, height) {
        const core = this.getCore();
        if (!core) return;
        const players = core.players || [];
        const selfId = window.localPlayerId || (players[0]?.id);
        const self = players.find(p => p.id === selfId);
        if (!self) return;

        const playerHUD = this.add.container(width / 2, height - 80);
        const shadow = this.add.rectangle(4, 4, 260, 80, 0x222222, 1);
        const bg = this.add.rectangle(0, 0, 260, 80, 0xffffff, 1).setStrokeStyle(3, 0x000000);
        const name = this.add.text(0, -20, `${self.name} (你)`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '18px', color: '#000' }).setOrigin(0.5, 0.5);
        const energy = this.add.text(-50, 10, `气: ${self.energy}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: '#000' });
        const health = this.add.text(50, 10, `❤️: ${self.health}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: self.health <= 0 ? '#ff0000' : '#000' });
        playerHUD.add([shadow, bg, name, energy, health]);
        playerHUD.setDepth(15);
        this.hudItems.push(playerHUD);
    }

    // 动作精灵位置沿用同一分布（上、右、左），但与HUD错位避免遮挡
    getActionSpritePositions(count, width, height) {
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

    updateActionSprites() {
        const core = this.getCore();
        if (!core) return;
        const state = core.gameState;
        const shouldShow = state === 'resolving';

        if (!shouldShow && this.actionSprites.length) {
            this.actionSprites.forEach(s => s.destroy());
            this.actionSprites = [];
            return;
        }
        if (!shouldShow) return;
        if (this.actionSprites.length) return;

        const players = core.players || [];
        const selfId = window.localPlayerId || (players[0]?.id);
        const self = players.find(p => p.id === selfId);
        const others = players.filter(p => p.id !== selfId);
        const { width, height } = this.scale;

        const positions = this.getActionSpritePositions(others.length, width, height);

        others.forEach((p, i) => {
            if (i >= positions.length) return;
            const action = p.currentAction;
            const key = this.getActionImageKey(action);
            const pos = positions[i];
            if (!key) return;
            const sprite = this.add.image(pos.x, pos.y, key).setDisplaySize(64, 64).setDepth(12).setOrigin(0.5);
            this.actionSprites.push(sprite);
        });

        if (self) {
            const action = self.currentAction;
            const key = this.getActionImageKey(action);
            if (key) {
                const sx = width / 2;
                const sy = height - 160;
                const sprite = this.add.image(sx, sy, key).setDisplaySize(72, 72).setDepth(13).setOrigin(0.5);
                this.actionSprites.push(sprite);
            }
        }
    }

    getActionImageKey(action) {
        if (!action) return null;
        const type = action.type;
        const level = action.level || 1;
        const base = `${type.toLowerCase()}_${level}.jpg`;
        return actionImgMap[base] ? base : null;
    }
}


// todo 修改对手分布逻辑