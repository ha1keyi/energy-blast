// 结算表现管理器：在回合结算阶段为每个玩家显示本回合选择的动作（含目标），并管理图标与文本标签
import { ActionType } from '../core/enums/ActionType.js';

export class RoundResolutionManager {
    constructor(game, scene) {
        this.game = game;     // window.game（核心逻辑）
        this.scene = scene;   // Phaser.Scene（GameScene）
        this.container = null;
        this.sprites = [];
        this.labels = [];
    }

    clear() {
        this.sprites.forEach(s => s.destroy());
        this.labels.forEach(l => l.destroy());
        this.sprites = [];
        this.labels = [];
        if (this.container) {
            this.container.destroy();
            this.container = null;
        }
    }

    onResolvingStart() {
        const core = this.game;
        const scene = this.scene;
        if (!core || !scene) return;

        const players = core.players || [];
        if (!players.length) return;

        this.clear();
        const { width, height } = scene.scale;
        this.container = scene.add.container(0, 0).setDepth(22);

        const selfId = window.localPlayerId || (players[0]?.id);
        const self = players.find(p => p.id === selfId);
        const others = players.filter(p => p.id !== selfId);

        // 与 GameScene 的分布保持一致
        const positions = scene.getActionSpritePositions(others.length, width, height);

        // 其他玩家：图标 + 文本
        others.forEach((p, i) => {
            if (i >= positions.length) return;
            const pos = positions[i];
            const key = this._getActionImageKey(p.currentAction);
            if (key) {
                const sprite = scene.add.image(pos.x, pos.y, key).setDisplaySize(64, 64).setDepth(12).setOrigin(0.5);
                this.container.add(sprite);
                this.sprites.push(sprite);
            }
            const label = scene.add.text(pos.x, pos.y + 40, this._formatActionText(p), {
                fontFamily: 'ZCOOL KuaiLe, sans-serif',
                fontSize: '14px',
                color: '#000',
                backgroundColor: '#fff',
                padding: { left: 6, right: 6, top: 2, bottom: 2 }
            }).setOrigin(0.5, 0);
            this.container.add(label);
            this.labels.push(label);
        });

        // 自己：图标 + 文本
        if (self) {
            const sx = width / 2;
            const sy = height - 160;
            const key = this._getActionImageKey(self.currentAction);
            if (key) {
                const sprite = scene.add.image(sx, sy, key).setDisplaySize(72, 72).setDepth(13).setOrigin(0.5);
                this.container.add(sprite);
                this.sprites.push(sprite);
            }
            const label = scene.add.text(sx, sy + 44, this._formatActionText(self), {
                fontFamily: 'ZCOOL KuaiLe, sans-serif',
                fontSize: '15px',
                color: '#000',
                backgroundColor: '#fff',
                padding: { left: 8, right: 8, top: 3, bottom: 3 }
            }).setOrigin(0.5, 0);
            this.container.add(label);
            this.labels.push(label);
        }
    }

    onResolvingEnd() {
        // 结算结束后清理表现
        this.clear();
    }

    _formatActionText(player) {
        const a = player.currentAction;
        if (!a) return `${player.name}: 无`;
        if (a.type === ActionType.ATTACK) {
            const targetName = player.target?.name || '-';
            return `${player.name}: ${a.name} → ${targetName}`;
        }
        return `${player.name}: ${a.name}`;
    }

    _getActionImageKey(action) {
        if (!action) return null;
        // 映射策略：与 GameScene.getActionImageKey 类似（按命名规则拼图）
        const typeMap = {
            [ActionType.ATTACK]: 'attack',
            [ActionType.DEFEND]: 'defend',
            [ActionType.STORE]: 'store',
        };
        const base = typeMap[action.type];
        if (!base) return null;
        const level = action.level || 1;
        const key = `${base}_${level}.jpg`;
        return key;
    }
}