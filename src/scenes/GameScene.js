// src/scenes/GameScene.js
import Phaser from 'phaser';
import { GameClient } from '../core/GameClient.js';
import { LobbyManager } from '../managers/LobbyManager.js';
import { GameStateStore } from '../core/GameStateStore.js';

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
        super('GameScene');
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
                this.updateBattleLogPanel();
                this.updatePendingHint();
            }
        });

        // Use LobbyManager's socket and roomId instead of undefined globals
        const socket = LobbyManager.socket;
        const roomId = LobbyManager.roomId || 'default';
        if (!socket) {
            console.warn('[GameScene] Socket not connected yet. GameClient listeners will attach after connection.');
        }
        this.gameClient = new GameClient(socket, roomId);

        // 新增：结算表现管理器（在 window.game 就绪后挂载）
        const core = this.getCore && this.getCore();
        if (core && !core.roundResolutionManager) {
            import('../managers/RoundResolutionManager.js').then(mod => {
                const { RoundResolutionManager } = mod;
                this.roundResolutionManager = new RoundResolutionManager(core, this);
                core.roundResolutionManager = this.roundResolutionManager;
            }).catch(err => {
                console.warn('[GameScene] Failed to init RoundResolutionManager:', err);
            });
        }

        // 初始化战斗日志面板容器
        this.battleLogContainer = this.add.container(0, 0).setDepth(25);
        this._lastLogCount = 0;

        // 去重：仅保留一个定时器轮询 HUD / 日志 / 待选提示
        this.time.addEvent({
            delay: 300,
            loop: true,
            callback: () => {
                this.updateHUD();
                // 动作图标+文本由 RoundResolutionManager 管理
                this.updateBattleLogPanel();
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

    // 改进的HUD更新方法：渲染对手与自己HUD，并提供对手点击选目标
    updateHUD() {
        const core = this.getCore();
        if (!core) return;
        const { width, height } = this.scale;

        // 清除旧HUD
        this.hudItems.forEach(it => it.destroy());
        this.hudItems = [];

        const players = core.players || [];
        if (!players.length) return;
        const selfId = window.localPlayerId || (players[0]?.id);
        const self = players.find(p => p.id === selfId);
        const others = players.filter(p => p.id !== selfId);

        // 顶部/左右分布对手头像卡片
        const positions = this.getOpponentPositions(others.length, width, height);
        others.forEach((p, i) => {
            if (i >= positions.length) return;
            const pos = positions[i];

            // Create a container for each opponent
            const c = this.add.container(pos.x, pos.y).setDepth(10);
            // Shadow + Card
            const w = 160, h = 60;
            // 基于对齐方式计算容器内元素的起始x（左上角）
            const baseX = pos.align === 1 ? -w : (pos.align === 0.5 ? -w / 2 : 0);

            const shadow = this.add.rectangle(baseX + 4, 4, w, h, 0x222222, 1).setOrigin(0, 0);
            const bg = this.add.rectangle(baseX, 0, w, h, 0xffffff, 1).setStrokeStyle(3, 0x000000).setOrigin(0, 0);
            // Name + HP + Energy（统一以 baseX 作为左侧起点，避免错位）
            const name = this.add.text(baseX + 12, 8, p.name, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: '#000' }).setOrigin(0, 0);
            const hpText = this.add.text(baseX + 12, 32, `❤️ ${p.health}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '14px', color: p.health <= 0 ? '#e74c3c' : '#000' }).setOrigin(0, 0);
            const enText = this.add.text(baseX + 80, 32, `气 ${p.energy}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '14px', color: '#000' }).setOrigin(0, 0);

            c.add([shadow, bg, name, hpText, enText]);
            // Hit area for clicking as target
            const hit = this.add.rectangle(baseX, 0, w, h, 0x000000, 0.001).setOrigin(0, 0).setInteractive({ cursor: 'pointer' });
            c.add(hit);

            hit.on('pointerover', () => { bg.setFillStyle(0xfafafa, 1); });
            hit.on('pointerout', () => { bg.setFillStyle(0xffffff, 1); });
            hit.on('pointerdown', () => this.chooseTarget(p));

            this.hudItems.push(c);
        });

        // 自己的HUD
        if (self) this.addPlayerHUD(width, height);

        // 底部状态条（轮数/阶段）
        const roundState = this.add.text(Math.round(width / 2), height - 26, `第 ${core.currentRound} 轮 · ${core.gameState === 'selecting' ? '选择行动' : core.gameState === 'resolving' ? '结算中' : core.gameState === 'idle' ? '准备中' : '已结束'}`, {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: '#000', backgroundColor: '#fff'
        }).setOrigin(0.5, 1).setDepth(15);
        this.hudItems.push(roundState);
    }

    // 类似修改其他方法
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
        // 已交由 RoundResolutionManager 统一管理；避免重复渲染
        if (this.roundResolutionManager) return;

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

    chooseTarget(targetPlayer) {
        const core = this.getCore();
        if (!core) return;
        const pending = window.pendingAttack;
        if (!pending) return;

        const me = core.players.find(p => p.id === (window.localPlayerId || core.players[0]?.id));
        const target = core.players.find(p => p.id === targetPlayer.id);
        if (!me || !target) return;
        try {
            me.selectAction(pending.actionKey, target);
            // 同步给可能存在的服务器（占位）
            if (LobbyManager?.socket && LobbyManager?.roomId) {
                LobbyManager.socket.emit('selectAction', LobbyManager.roomId, pending.actionKey, targetPlayer.id);
            }
            if (window.debugUI && typeof window.debugUI.updatePlayerList === 'function') {
                window.debugUI.updatePlayerList();
            }
            window.pendingAttack = null;
            if (typeof window.showToast === 'function') window.showToast(`目标已选择：${target.name}`);
        } catch (e) {
            console.error(e);
            if (typeof window.showToast === 'function') window.showToast(e.message || '选择失败');
        }
    }

    // 最近战斗日志面板：显示最近 8 条
    updateBattleLogPanel() {
        const core = this.getCore && this.getCore();
        if (!core) return;

        const logs = core.logs || [];
        if (!this.battleLogContainer) return;

        // 仅当日志数量变化时重绘，减少开销
        if (logs.length === this._lastLogCount) return;
        this._lastLogCount = logs.length;

        // 清理旧 panel
        this.battleLogContainer.removeAll(true);

        const { width, height } = this.scale;
        const panelWidth = 420;
        const panelHeight = 170;
        const x = width - panelWidth - 20;
        const y = height - panelHeight - 100;

        const bg = this.add.rectangle(x, y, panelWidth, panelHeight, 0xffffff, 0.95)
            .setStrokeStyle(3, 0x000000)
            .setOrigin(0, 0);
        const title = this.add.text(x + 12, y + 8, '战斗日志', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: '#000'
        }).setOrigin(0, 0);

        this.battleLogContainer.add([bg, title]);

        const recent = logs.slice(-8);
        let offsetY = y + 34;
        recent.forEach(entry => {
            const line = this.add.text(x + 12, offsetY, `R${entry.round}: ${entry.message}`, {
                fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '14px', color: '#000'
            }).setOrigin(0, 0);
            this.battleLogContainer.add(line);
            offsetY += 18;
        });
    }
}