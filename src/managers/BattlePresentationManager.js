import { BattleAnimationManager } from './RoundResolutionManager.js';
import { BattleLayoutManager } from './BattleLayoutManager.js';

export class BattlePresentationManager {
    constructor(core, scene, layoutManager = null) {
        this.core = core;
        this.scene = scene;
        this.layoutManager = layoutManager || new BattleLayoutManager(scene);
        this.animationManager = new BattleAnimationManager(core, scene);
        this.logContainer = this.scene.add.container(0, 0).setDepth(25);
        this._disposed = false;
        this._logSignature = '';
    }

    refresh() {
        if (this._disposed) return;
        this.animationManager.refresh();
        this.refreshBattleLogPanel();
    }

    reset() {
        if (this._disposed) return;
        this.animationManager.reset();
        this._logSignature = '';
        this.logContainer.removeAll(true);
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

        const signature = JSON.stringify({
            bounds,
            compact,
            state: this.core.gameState,
            recent,
        });
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

    describeState() {
        if (this.core.gameState === 'selecting') return '选择阶段';
        if (this.core.gameState === 'resolving') return '结算阶段';
        if (this.core.gameState === 'ended') return '对局结束';
        return '准备中';
    }

    cleanup() {
        if (this._disposed) return;
        this._disposed = true;
        this.animationManager.cleanup();
        this.logContainer.removeAll(true);
        this.logContainer.destroy();
        this.logContainer = null;
        this._logSignature = '';
    }
}
