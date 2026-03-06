// src/scenes/GameScene.js
import Phaser from 'phaser';
import { LobbyManager } from '../managers/LobbyManager.js';
import { BattleLayoutManager } from '../managers/BattleLayoutManager.js';
import { BattlePresentationManager } from '../managers/BattlePresentationManager.js';

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
        this.layoutManager = new BattleLayoutManager(this);
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
        const hintPosition = this.layoutManager.getPendingHintPosition();
        this.pendingHint = this.add.text(hintPosition.x, hintPosition.y, '请选择攻击目标…', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '18px', color: '#000', backgroundColor: '#fff'
        }).setOrigin(0.5).setDepth(20).setVisible(false);

        // 新增：战斗表现管理器（动画 + 日志）
        const core = this.getCore && this.getCore();
        if (core) {
            if (core.battlePresentationManager && typeof core.battlePresentationManager.cleanup === 'function') {
                core.battlePresentationManager.cleanup();
            }
            if (core.battleAnimationManager && typeof core.battleAnimationManager.cleanup === 'function') {
                core.battleAnimationManager.cleanup();
            }
            if (core.roundResolutionManager && typeof core.roundResolutionManager.cleanup === 'function') {
                core.roundResolutionManager.cleanup();
            }
            core.battlePresentationManager = null;
            core.battleAnimationManager = null;
            core.roundResolutionManager = null;
            this.battlePresentationManager = new BattlePresentationManager(core, this, this.layoutManager);
            this.battleAnimationManager = this.battlePresentationManager.animationManager;
            core.battlePresentationManager = this.battlePresentationManager;
            core.battleAnimationManager = this.battleAnimationManager;
            core.roundResolutionManager = this.battleAnimationManager;
        }

        // 初始化结算画面容器
        this.endScreenContainer = this.add.container(0, 0).setDepth(100).setVisible(false);
        this.endAutoReturnTimer = null;

        // 去重：仅保留一个定时器轮询 HUD / 日志 / 待选提示
        this.uiRefreshEvent = this.time.addEvent({
            delay: 300,
            loop: true,
            callback: () => {
                this.updateHUD();
                this.battlePresentationManager?.refresh?.();
                this.updatePendingHint();
                this.updateEndScreen();
            }
        });

        this.events.once('shutdown', () => this.cleanupScene());
        this.events.once('destroy', () => this.cleanupScene());
    }

    update() { }

    getCore() { return window.game; }

    updatePendingHint() {
        const show = !!window.pendingAttack && this.getCore()?.gameState === 'selecting';
        const hintPosition = this.layoutManager?.getPendingHintPosition?.();
        if (hintPosition) {
            this.pendingHint?.setPosition(hintPosition.x, hintPosition.y);
        }
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
        const box = this.layoutManager.getEndScreenBox();
        this.endScreenContainer.removeAll(true);
        this.endScreenContainer.setVisible(true);

        // 半透明背景
        const overlay = this.add.rectangle(0, 0, width, height, 0xffffff, 0.8).setOrigin(0, 0);

        // 结算框（手绘风格）
        const boxW = box.width, boxH = box.height;
        const boxX = box.x, boxY = box.y;

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
        const exitBtn = this.createHandDrawnButton(btnX + 90, btnY, btnW, btnH, '返回大厅', () => this.handleReturnLobby());

        this.endScreenContainer.add([overlay, graphics, title, result, ...rematchBtn, ...exitBtn]);

        // 入场动画
        this.endScreenContainer.setAlpha(0);
        this.scene.tweens.add({
            targets: this.endScreenContainer,
            alpha: 1,
            duration: 500,
            ease: 'Power2'
        });

        // 自动兜底：避免卡在结束动画，8 秒后自动回大厅
        if (this.endAutoReturnTimer) {
            this.endAutoReturnTimer.remove(false);
        }
        this.endAutoReturnTimer = this.time.delayedCall(8000, () => {
            if (this.getCore()?.gameState === 'ended') {
                this.handleReturnLobby();
            }
        });
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

    handleReturnLobby() {
        if (this.endAutoReturnTimer) {
            this.endAutoReturnTimer.remove(false);
            this.endAutoReturnTimer = null;
        }
        if (typeof window.returnToLobby === 'function') {
            window.returnToLobby();
        }
    }

    cleanupScene() {
        if (this.uiRefreshEvent) {
            this.uiRefreshEvent.remove(false);
            this.uiRefreshEvent = null;
        }
        if (this.endAutoReturnTimer) {
            this.endAutoReturnTimer.remove(false);
            this.endAutoReturnTimer = null;
        }
        if (this.battlePresentationManager && typeof this.battlePresentationManager.cleanup === 'function') {
            this.battlePresentationManager.cleanup();
            this.battlePresentationManager = null;
        }
        if (this.battleAnimationManager && typeof this.battleAnimationManager.cleanup === 'function') {
            this.battleAnimationManager.cleanup();
            this.battleAnimationManager = null;
        }
        const core = this.getCore && this.getCore();
        if (core?.battlePresentationManager && typeof core.battlePresentationManager.cleanup === 'function') {
            core.battlePresentationManager.cleanup();
            core.battlePresentationManager = null;
        }
        if (core?.battleAnimationManager && typeof core.battleAnimationManager.cleanup === 'function') {
            core.battleAnimationManager.cleanup();
            core.battleAnimationManager = null;
        }
        if (core?.roundResolutionManager && typeof core.roundResolutionManager.cleanup === 'function') {
            core.roundResolutionManager.cleanup();
            core.roundResolutionManager = null;
        }
        this.hudItems?.forEach(item => item?.destroy?.());
        this.hudItems = [];
        this.actionSprites?.forEach(item => item?.destroy?.());
        this.actionSprites = [];
        this.pendingHint?.destroy?.();
        this.pendingHint = null;
        this.endScreenContainer?.removeAll?.(true);
        this.endScreenContainer?.destroy?.();
        this.endScreenContainer = null;
    }

    handleRematch() {
        if (this.endAutoReturnTimer) {
            this.endAutoReturnTimer.remove(false);
            this.endAutoReturnTimer = null;
        }
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
        return this.layoutManager.getOpponentPositions(count, width, height);
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
        const roundStatePosition = this.layoutManager.getRoundStatusPosition();
        const roundState = this.add.text(roundStatePosition.x, roundStatePosition.y, `第 ${core.currentRound} 轮 · ${core.gameState === 'selecting' ? '选择行动' : core.gameState === 'resolving' ? '结算中' : core.gameState === 'idle' ? '准备中' : '已结束'}`, {
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

        const selfHudPosition = this.layoutManager.getSelfHudPosition();
        const compact = this.layoutManager.getMetrics().compact;
        const hudWidth = compact ? 220 : 260;
        const hudHeight = compact ? 68 : 80;
        const playerHUD = this.add.container(selfHudPosition.x, selfHudPosition.y);
        const shadow = this.add.rectangle(4, 4, hudWidth, hudHeight, 0x222222, 1);
        const bg = this.add.rectangle(0, 0, hudWidth, hudHeight, 0xffffff, 1).setStrokeStyle(3, 0x000000);
        const name = this.add.text(0, -20, `${self.name} (你)`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '18px', color: '#000' }).setOrigin(0.5, 0.5);
        const energy = this.add.text(-50, 10, `气: ${self.energy}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: '#000' });
        const health = this.add.text(50, 10, `❤️: ${self.health}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: self.health <= 0 ? '#ff0000' : '#000' });
        playerHUD.add([shadow, bg, name, energy, health]);
        playerHUD.setDepth(15);
        this.hudItems.push(playerHUD);
    }

    // 动作精灵位置沿用同一分布（上、右、左），但与HUD错位避免遮挡
    getActionSpritePositions(count, width, height) {
        return this.layoutManager.getActionSpritePositions(count, width, height);
    }

    updateActionSprites() {
        // 已交由 RoundResolutionManager 统一管理；避免重复渲染
        if (this.battleAnimationManager) return;

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
                const selfPos = this.layoutManager.getSelfActionPosition(72);
                const sx = selfPos.x;
                const sy = selfPos.y;
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
                const targetNetworkId = target?.networkId ?? target?.id ?? targetPlayer?.id;
                LobbyManager.socket.emit('selectAction', LobbyManager.roomId, pending.actionKey, targetNetworkId);
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
        this.battlePresentationManager?.refreshBattleLogPanel?.();
    }
}