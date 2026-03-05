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

        // Use LobbyManager's socket and roomId instead of undefined globals
        const socket = LobbyManager.socket;
        const roomId = LobbyManager.roomId || 'default';
        if (!socket) {
            console.warn('[GameScene] Socket not connected yet. GameClient listeners will attach after connection.');
        }
        this.gameClient = new GameClient(socket, roomId);

        // 新增：结算表现管理器（在 window.game 就绪后挂载）
        const core = this.getCore && this.getCore();
        if (core) {
            if (core.roundResolutionManager && typeof core.roundResolutionManager.cleanup === 'function') {
                core.roundResolutionManager.cleanup();
            }
            core.roundResolutionManager = null;
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

        // 初始化结算画面容器
        this.endScreenContainer = this.add.container(0, 0).setDepth(100).setVisible(false);

        // 去重：仅保留一个定时器轮询 HUD / 日志 / 待选提示
        this.time.addEvent({
            delay: 300,
            loop: true,
            callback: () => {
                this.updateHUD();
                // 动作图标+文本由 RoundResolutionManager 管理
                this.updateBattleLogPanel();
                this.updatePendingHint();
                this.updateEndScreen();
            }
        });
    }

    update() { }

    getCore() { return window.game; }

    updatePendingHint() {
        const show = !!window.pendingAttack && this.getCore()?.gameState === 'selecting';
        this.pendingHint?.setVisible(show);
    }

    // 渲染游戏结束结算画面
    updateEndScreen() {
        const core = this.getCore();
        if (!core || core.gameState !== 'ended') {
            this.endScreenContainer?.setVisible(false);
            return;
        }

        if (this.endScreenContainer.visible) return; // 已经显示了

        const { width, height } = this.scale;
        this.endScreenContainer.removeAll(true);
        this.endScreenContainer.setVisible(true);

        // 半透明背景
        const overlay = this.add.rectangle(0, 0, width, height, 0xffffff, 0.8).setOrigin(0, 0);

        // 结算框（手绘风格）
        const boxW = 500, boxH = 300;
        const boxX = width / 2, boxY = height / 2;

        const graphics = this.add.graphics();
        graphics.lineStyle(4, 0x000000, 1);
        graphics.fillStyle(0xffffff, 1);

        // 绘制带抖动手绘感的矩形
        const points = [
            { x: boxX - boxW / 2, y: boxY - boxH / 2 },
            { x: boxX + boxW / 2, y: boxY - boxH / 2 },
            { x: boxX + boxW / 2, y: boxY + boxH / 2 },
            { x: boxX - boxW / 2, y: boxY + boxH / 2 }
        ];

        graphics.beginPath();
        graphics.moveTo(points[0].x + (Math.random() - 0.5) * 5, points[0].y + (Math.random() - 0.5) * 5);
        for (let i = 1; i <= points.length; i++) {
            const p = points[i % points.length];
            graphics.lineTo(p.x + (Math.random() - 0.5) * 5, p.y + (Math.random() - 0.5) * 5);
        }
        graphics.closePath();
        graphics.fillPath();
        graphics.strokePath();

        const titleText = core.getAlivePlayers().length === 1 ? '胜 负 已 分' : '同 归 于 尽';
        const title = this.add.text(boxX, boxY - 100, titleText, {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '40px', color: '#000'
        }).setOrigin(0.5);

        const winner = core.getAlivePlayers()[0];
        const resultText = winner ? `获胜者: ${winner.name}` : '没有活下来的玩家';
        const result = this.add.text(boxX, boxY - 20, resultText, {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '24px', color: '#000'
        }).setOrigin(0.5);

        const btnW = 160, btnH = 50;
        const btnX = boxX, btnY = boxY + 80;

        // “再来一局”按钮（手绘风格）
        const rematchBtn = this.createHandDrawnButton(btnX - 90, btnY, btnW, btnH, '再来一局', () => this.handleRematch());

        // “退出房间”按钮（手绘风格）
        const exitBtn = this.createHandDrawnButton(btnX + 90, btnY, btnW, btnH, '退出房间', () => this.handleExitRoom());

        this.endScreenContainer.add([overlay, graphics, title, result, ...rematchBtn, ...exitBtn]);

        // 入场动画
        this.endScreenContainer.setAlpha(0);
        this.scene.tweens.add({
            targets: this.endScreenContainer,
            alpha: 1,
            duration: 500,
            ease: 'Power2'
        });

        // 自动超时保护：5秒后若无操作，提示或执行默认行为（这里仅作为保护，不强制退出）
        // 如果需要强制返回，可以在这里添加 delayedCall
    }

    createHandDrawnButton(x, y, w, h, text, onClick) {
        // 使用Container组合，便于事件处理和层级
        const container = this.add.container(x, y);
        // 背景，基于中心点定位，传入的x,y是中心点
        // 注意：add.rectangle默认Origin是0.5, 0.5
        const bg = this.add.rectangle(0, 0, w, h, 0xffffff, 1).setStrokeStyle(3, 0x000000).setInteractive({ cursor: 'pointer' });
        const label = this.add.text(0, 0, text, {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '20px', color: '#000'
        }).setOrigin(0.5);

        bg.on('pointerover', () => { bg.setFillStyle(0xeeeeee, 1); });
        bg.on('pointerout', () => { bg.setFillStyle(0xffffff, 1); });
        bg.on('pointerdown', onClick);

        container.add([bg, label]);
        return [container];
    }

    handleExitRoom() {
        // exit room (kept minimal logging)
        const socket = LobbyManager.socket;
        const roomId = LobbyManager.roomId;
        if (socket && roomId) {
            socket.emit('leaveRoom', roomId);
        }
        // 返回大厅
        if (typeof window.returnToLobby === 'function') {
            window.returnToLobby({ resetRoom: true });
        } else {
            // Fallback
            this.scene.stop();
            document.getElementById('home-screen')?.classList.remove('hidden');
            document.getElementById('lobby-screen')?.classList.add('hidden');
            document.getElementById('ui-container')?.classList.add('hidden');
        }
    }

    handleRematch() {
        // request rematch
        const socket = LobbyManager.socket;
        const roomId = LobbyManager.roomId;
        if (socket && roomId) {
            socket.emit('requestRematch', roomId);
        } else {
            // 本地模式重置
            this.getCore()?.startGame();
        }
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
                const targetName = target?.name || targetPlayer?.name;
                LobbyManager.socket.emit('selectAction', LobbyManager.roomId, pending.actionKey, targetName);
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
        const panelWidth = Math.min(420, Math.max(240, Math.floor(width * 0.44)));
        const panelHeight = Math.min(170, Math.max(120, Math.floor(height * 0.28)));
        const x = width - panelWidth - 16;

        // Prefer high placement so it never collides with bottom action bar on desktop/mobile.
        const y = 76;

        const bg = this.add.rectangle(x, y, panelWidth, panelHeight, 0xffffff, 0.95)
            .setStrokeStyle(3, 0x000000)
            .setOrigin(0, 0);
        const title = this.add.text(x + 12, y + 8, '战斗日志', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: '#000'
        }).setOrigin(0, 0);

        this.battleLogContainer.add([bg, title]);

        const maxLines = Math.max(4, Math.floor((panelHeight - 38) / 18));
        const recent = logs.slice(-maxLines);
        let offsetY = y + 34;
        recent.forEach(entry => {
            const hasRound = entry && typeof entry === 'object' && entry.round != null;
            const r = hasRound ? entry.round : '';
            const msg = (entry && typeof entry === 'object' && entry.message != null) ? String(entry.message) : String(entry);
            const text = (r === '' ? `${msg}` : `R${r}: ${msg}`);
            const line = this.add.text(x + 12, offsetY, text, {
                fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '14px', color: '#000'
            }).setOrigin(0, 0);
            this.battleLogContainer.add(line);
            offsetY += 18;
        });
    }
}