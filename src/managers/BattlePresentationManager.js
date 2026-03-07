import { BattleAnimationManager } from './RoundResolutionManager.js';
import { BattleLayoutManager } from './BattleLayoutManager.js';

export class BattlePresentationManager {
    constructor(core, scene, options = {}) {
        this.core = core;
        this.scene = scene;
        this.layoutManager = options.layoutManager || new BattleLayoutManager(scene);
        this.onChooseTarget = options.onChooseTarget || (() => { });
        this.onReturnLobby = options.onReturnLobby || (() => { });
        this.animationManager = new BattleAnimationManager(core, scene);
        this.logContainer = this.scene.add.container(0, 0).setDepth(25);
        this.hudContainer = this.scene.add.container(0, 0).setDepth(15);
        this.pendingHint = this.scene.add.text(0, 0, '请选择攻击目标…', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '18px', color: '#000', backgroundColor: '#fff'
        }).setOrigin(0.5).setDepth(20).setVisible(false);
        this.endScreenContainer = this.scene.add.container(0, 0).setDepth(100).setVisible(false);
        this._disposed = false;
        this._logSignature = '';
        this._hudSignature = '';
        this._endSignature = '';
        this.unsubscribeStore = this.core?.store?.subscribe?.(() => {
            if (this._disposed || !this.scene?.sys?.isActive?.()) return;
            this.refresh();
        }) || null;
    }

    ensureAnimationManager() {
        const needsRecreate = !this.animationManager || this.animationManager._active === false || this.animationManager.scene !== this.scene;
        if (!needsRecreate) return;

        this.animationManager = new BattleAnimationManager(this.core, this.scene);
        if (this.core) {
            this.core.battleAnimationManager = this.animationManager;
        }
    }

    refresh() {
        if (this._disposed) return;
        this.ensureAnimationManager();
        this.refreshHUD();
        this.refreshPendingHint();
        this.refreshBattleLogPanel();
        this.animationManager.refresh();
        this.refreshEndScreen();
    }

    reset() {
        if (this._disposed) return;
        this.animationManager.reset();
        this._logSignature = '';
        this._hudSignature = '';
        this._endSignature = '';
        this.clearHud();
        this.logContainer.removeAll(true);
        this.pendingHint.setVisible(false);
        this.hideEndScreen();
    }

    refreshPendingHint() {
        const position = this.layoutManager.getPendingHintPosition();
        this.pendingHint.setPosition(position.x, position.y);
        this.pendingHint.setVisible(!!window.pendingAttack && this.core?.gameState === 'selecting');
    }

    refreshHUD() {
        if (!this.core) return;
        const players = this.core.players || [];
        const localPlayerId = window.localPlayerId || players[0]?.id || null;
        const self = players.find(player => player.id === localPlayerId) || null;
        const others = players.filter(player => player.id !== localPlayerId);
        const metrics = this.layoutManager.getMetrics();

        const signature = JSON.stringify({
            round: this.core.currentRound,
            state: this.core.gameState,
            players: players.map(player => ({
                id: player.id,
                networkId: player.networkId,
                name: player.name,
                health: player.health,
                energy: player.energy,
                alive: player.isAlive,
            })),
            size: { width: metrics.width, height: metrics.height },
            localPlayerId,
        });
        if (signature === this._hudSignature) return;
        this._hudSignature = signature;

        this.clearHud();
        if (!players.length) return;

        const positions = this.layoutManager.getOpponentPositions(others.length);
        others.forEach((player, index) => {
            const position = positions[index];
            if (!position) return;
            const node = this.buildOpponentHud(player, position);
            this.hudContainer.add(node);
        });

        if (self) {
            const selfHud = this.buildSelfHud(self);
            this.hudContainer.add(selfHud);
        }

        const roundStatePosition = this.layoutManager.getRoundStatusPosition();
        const roundState = this.scene.add.text(roundStatePosition.x, roundStatePosition.y, this.getRoundStateText(), {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: '#000', backgroundColor: '#fff'
        }).setOrigin(0.5, 1).setDepth(15);
        this.hudContainer.add(roundState);
    }

    buildOpponentHud(player, position) {
        const container = this.scene.add.container(position.x, position.y).setDepth(10);
        const width = 160;
        const height = 60;
        const baseX = position.align === 1 ? -width : (position.align === 0.5 ? -width / 2 : 0);

        const shadow = this.scene.add.rectangle(baseX + 4, 4, width, height, 0x222222, 1).setOrigin(0, 0);
        const bg = this.scene.add.rectangle(baseX, 0, width, height, 0xffffff, 1).setStrokeStyle(3, 0x000000).setOrigin(0, 0);
        const name = this.scene.add.text(baseX + 12, 8, player.name, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: '#000' }).setOrigin(0, 0);
        const hpText = this.scene.add.text(baseX + 12, 32, `❤️ ${player.health}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '14px', color: player.health <= 0 ? '#e74c3c' : '#000' }).setOrigin(0, 0);
        const energyText = this.scene.add.text(baseX + 80, 32, `气 ${player.energy}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '14px', color: '#000' }).setOrigin(0, 0);
        const hit = this.scene.add.rectangle(baseX, 0, width, height, 0x000000, 0.001).setOrigin(0, 0).setInteractive({ cursor: 'pointer' });

        hit.on('pointerover', () => bg.setFillStyle(0xfafafa, 1));
        hit.on('pointerout', () => bg.setFillStyle(0xffffff, 1));
        hit.on('pointerdown', () => this.onChooseTarget(player));

        container.add([shadow, bg, name, hpText, energyText, hit]);
        return container;
    }

    buildSelfHud(player) {
        const position = this.layoutManager.getSelfHudPosition();
        const compact = this.layoutManager.getMetrics().compact;
        const width = compact ? 220 : 260;
        const height = compact ? 68 : 80;
        const container = this.scene.add.container(position.x, position.y).setDepth(15);
        const shadow = this.scene.add.rectangle(4, 4, width, height, 0x222222, 1);
        const bg = this.scene.add.rectangle(0, 0, width, height, 0xffffff, 1).setStrokeStyle(3, 0x000000);
        const name = this.scene.add.text(0, -20, `${player.name} (你)`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: compact ? '16px' : '18px', color: '#000' }).setOrigin(0.5, 0.5);
        const energy = this.scene.add.text(-50, 10, `气: ${player.energy}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: compact ? '14px' : '16px', color: '#000' });
        const health = this.scene.add.text(50, 10, `❤️: ${player.health}`, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: compact ? '14px' : '16px', color: player.health <= 0 ? '#ff0000' : '#000' });
        container.add([shadow, bg, name, energy, health]);
        return container;
    }

    clearHud() {
        this.hudContainer.removeAll(true);
    }

    refreshBattleLogPanel() {
        if (this._disposed || !this.core) return;

        const logs = Array.isArray(this.core.logs) ? this.core.logs : [];
        const bounds = this.layoutManager.getBattleLogPanelBounds();
        const compact = this.layoutManager.getMetrics().compact;
        const maxLines = compact ? 4 : Math.max(4, Math.floor((bounds.height - 38) / 18));
        const recent = logs.slice(-maxLines).map((entry) => {
            const hasRound = entry && typeof entry === 'object' && entry.round != null;
            const round = hasRound ? entry.round : '';
            const message = (entry && typeof entry === 'object' && entry.message != null)
                ? String(entry.message)
                : String(entry);
            return round === '' ? message : `R${round}: ${message}`;
        });

        const signature = JSON.stringify({ bounds, compact, state: this.core.gameState, recent });
        if (signature === this._logSignature) return;
        this._logSignature = signature;

        this.logContainer.removeAll(true);

        const frame = this.scene.add.graphics().setDepth(25);
        frame.fillStyle(0xffffff, 0.94);
        frame.lineStyle(3, 0x000000, 1);
        frame.fillRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, compact ? 12 : 16);
        frame.strokeRoundedRect(bounds.x, bounds.y, bounds.width, bounds.height, compact ? 12 : 16);

        const title = this.scene.add.text(bounds.x + 12, bounds.y + 10, compact ? '本回合记录' : '战斗日志', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif',
            fontSize: compact ? '14px' : '16px',
            color: '#000',
        }).setOrigin(0, 0);

        const hint = this.scene.add.text(bounds.x + bounds.width - 12, bounds.y + 12, this.describeState(), {
            fontFamily: 'ZCOOL KuaiLe, sans-serif',
            fontSize: compact ? '11px' : '12px',
            color: '#555',
        }).setOrigin(1, 0);

        this.logContainer.add([frame, title, hint]);

        if (!recent.length) {
            const empty = this.scene.add.text(bounds.x + 12, bounds.y + 40, '等待玩家选择行动...', {
                fontFamily: 'ZCOOL KuaiLe, sans-serif',
                fontSize: compact ? '12px' : '14px',
                color: '#666',
            }).setOrigin(0, 0);
            this.logContainer.add(empty);
            return;
        }

        let offsetY = bounds.y + 40;
        recent.forEach((lineText, index) => {
            const rowBg = this.scene.add.rectangle(
                bounds.x + bounds.width / 2,
                offsetY + (compact ? 8 : 9),
                bounds.width - 22,
                compact ? 18 : 20,
                index % 2 === 0 ? 0xf8f8f8 : 0xffffff,
                0.9,
            ).setOrigin(0.5, 0.5).setDepth(25);

            const line = this.scene.add.text(bounds.x + 12, offsetY, lineText, {
                fontFamily: 'ZCOOL KuaiLe, sans-serif',
                fontSize: compact ? '12px' : '13px',
                color: '#111',
                wordWrap: { width: bounds.width - 30 },
                maxLines: 1,
            }).setOrigin(0, 0);

            this.logContainer.add([rowBg, line]);
            offsetY += compact ? 20 : 22;
        });
    }

    refreshEndScreen() {
        if (!this.core || this._disposed) return;

        if (this.core.gameState !== 'ended') {
            this.hideEndScreen();
            return;
        }

        const alivePlayers = this.core.getAlivePlayers();
        const winner = alivePlayers[0] || null;
        const signature = JSON.stringify({
            state: this.core.gameState,
            winner: winner?.id || null,
            title: alivePlayers.length === 1 ? '胜 负 已 分' : '同 归 于 尽',
            size: this.layoutManager.getEndScreenBox(),
        });
        if (signature === this._endSignature && this.endScreenContainer.visible) return;
        this._endSignature = signature;

        const { width, height } = this.scene.scale;
        const box = this.layoutManager.getEndScreenBox();
        this.endScreenContainer.removeAll(true);
        this.endScreenContainer.setVisible(true);

        const overlay = this.scene.add.rectangle(0, 0, width, height, 0xffffff, 0.8).setOrigin(0, 0);
        const graphics = this.scene.add.graphics();
        graphics.lineStyle(4, 0x000000, 1);
        graphics.fillStyle(0xffffff, 1);

        const points = [
            { x: box.x - box.width / 2, y: box.y - box.height / 2 },
            { x: box.x + box.width / 2, y: box.y - box.height / 2 },
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
            { x: box.x - box.width / 2, y: box.y + box.height / 2 }
        ];

        graphics.beginPath();
        graphics.moveTo(points[0].x + (Math.random() - 0.5) * 5, points[0].y + (Math.random() - 0.5) * 5);
        for (let i = 1; i <= points.length; i++) {
            const point = points[i % points.length];
            graphics.lineTo(point.x + (Math.random() - 0.5) * 5, point.y + (Math.random() - 0.5) * 5);
        }
        graphics.closePath();
        graphics.fillPath();
        graphics.strokePath();

        const titleText = alivePlayers.length === 1 ? '胜 负 已 分' : '同 归 于 尽';
        const title = this.scene.add.text(box.x, box.y - 100, titleText, {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '40px', color: '#000'
        }).setOrigin(0.5);

        const resultText = winner ? `获胜者: ${winner.name}` : '没有活下来的玩家';
        const result = this.scene.add.text(box.x, box.y - 28, resultText, {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '24px', color: '#000'
        }).setOrigin(0.5);

        const hint = this.scene.add.text(box.x, box.y + 18, '5 秒后自动返回房间', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '18px', color: '#444'
        }).setOrigin(0.5);

        const exitBtn = this.createHandDrawnButton(box.x, box.y + 84, 180, 52, '返回房间', () => this.onReturnLobby());

        this.endScreenContainer.add([overlay, graphics, title, result, hint, ...exitBtn]);
        this.endScreenContainer.setAlpha(0);
        this.scene.tweens.add({ targets: this.endScreenContainer, alpha: 1, duration: 500, ease: 'Power2' });
    }

    hideEndScreen() {
        this.endScreenContainer.setVisible(false);
        this.endScreenContainer.removeAll(true);
        this._endSignature = '';
    }

    createHandDrawnButton(x, y, width, height, text, onClick) {
        const container = this.scene.add.container(x, y);
        const bg = this.scene.add.rectangle(0, 0, width, height, 0xffffff, 1).setStrokeStyle(3, 0x000000).setInteractive({ cursor: 'pointer' });
        const label = this.scene.add.text(0, 0, text, {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '20px', color: '#000'
        }).setOrigin(0.5);
        bg.on('pointerover', () => bg.setFillStyle(0xeeeeee, 1));
        bg.on('pointerout', () => bg.setFillStyle(0xffffff, 1));
        bg.on('pointerdown', onClick);
        container.add([bg, label]);
        return [container];
    }

    getRoundStateText() {
        const stateText = this.core.gameState === 'selecting'
            ? '选择行动'
            : this.core.gameState === 'resolving'
                ? '结算中'
                : this.core.gameState === 'idle'
                    ? '准备中'
                    : '已结束';
        return `第 ${this.core.currentRound} 轮 · ${stateText}`;
    }

    describeState() {
        if (this.core.gameState === 'selecting') return '选择阶段';
        if (this.core.gameState === 'resolving') return '结算阶段';
        if (this.core.gameState === 'ended') return '对局结束';
        return '准备中';
    }

    cleanup() {
        if (this._disposed) return;
        this._disposed = true;
        this.unsubscribeStore?.();
        this.unsubscribeStore = null;
        this.hideEndScreen();
        this.animationManager.cleanup();
        this.clearHud();
        this.hudContainer.destroy();
        this.pendingHint.destroy();
        this.logContainer.removeAll(true);
        this.logContainer.destroy();
        this.endScreenContainer.destroy();
        this.logContainer = null;
        this.hudContainer = null;
        this.pendingHint = null;
        this.endScreenContainer = null;
        this._logSignature = '';
        this._hudSignature = '';
        this._endSignature = '';
    }
}
