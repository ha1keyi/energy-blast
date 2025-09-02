import { StrategyFactory } from '../strategies/StrategyFactory.js';
import { ActionType } from './enums/ActionType.js';
import { Player } from './Player.js';

const ROUND_TIME = 5000; // 默认回合时间

export class Game {
    constructor(players = [], roundTime = ROUND_TIME) {
        this.players = players;
        this.roundTime = roundTime;
        this.currentRound = 0;
        this.isRunning = false;
        this.timer = null;
        this.logs = [];
        this.gameState = 'idle'; // idle, selecting, resolving, ended
        this.debugUIManager = null;
        this.playerManager = this;
        // 可选挂载：由 GameScene 在运行时创建并注入
        this.roundResolutionManager = this.roundResolutionManager || null;
    }

    setDebugUIManager(manager) {
        this.debugUIManager = manager;
        if (this.debugUIManager) {
            this.debugUIManager.updatePlayerList();
            this.debugUIManager.updateGameState();
        }
    }

    addPlayer(name, options = {}) {
        // Enforce unique player names in game
        if (this.players.some(p => p.name === name)) {
            throw new Error('玩家不能重名');
        }
        const newId = this.players.length > 0 ? Math.max(...this.players.map(p => p.id)) + 1 : 1;
        const player = new Player(newId, name);
        // 预留：虚拟玩家/AI 控制
        if (options && typeof options.isBot === 'boolean') player.isBot = !!options.isBot;
        if (options && options.controller) {
            if (typeof player.setController === 'function') {
                player.setController(options.controller);
            } else {
                player.controller = options.controller;
            }
        }
        this.players.push(player);
        if (this.debugUIManager) {
            this.debugUIManager.updatePlayerList();
        }
    }

    removePlayer(playerId) {
        this.players = this.players.filter(p => p.id !== playerId);
        if (this.debugUIManager) {
            this.debugUIManager.updatePlayerList();
        }
    }

    getAlivePlayers() {
        return this.players.filter(p => p.isAlive);
    }

    startGame() {
        if (this.players.length < 2) {
            throw new Error('至少需要2名玩家才能开始游戏');
        }

        this.currentRound = 0;
        this.isRunning = true;
        this.gameState = 'idle';
        this.logs = [];

        this.players.forEach(player => {
            player.health = 1;
            player.energy = 0;
            player.isAlive = true;
            player.resetForNewRound();
        });

        this.addLog('游戏开始！');
        this.startRound();
    }

    startRound() {
        if (!this.isRunning) return;

        this.currentRound++;
        this.gameState = 'selecting';

        this.clearTimer();
        this.nextFrame();
        // 仅在自动结算下才定时推进
        if (this.debugUIManager?.isAutoResolve) {
            this.timer = setTimeout(async () => {
                await this.processRound();
            }, this.roundTime);
        }

        if (this.debugUIManager) {
            this.debugUIManager.updateGameState();
        }
    }

    async resolveActions() {
        this.gameState = 'resolving';
        // 通知结算表现：开始展示动作
        this.roundResolutionManager?.onResolvingStart();

        const actionResults = [];

        // 先结算防御，确保减伤生效
        for (const player of this.players) {
            if (player.currentAction && player.currentAction.type === ActionType.DEFEND) {
                actionResults.push(`${player.name} 进行了防御。`);
            }
        }

        // 然后结算攻击
        for (const player of this.players) {
            if (player.currentAction && player.currentAction.type === ActionType.ATTACK && player.target) {
                this.executeAttack(player, player.target);
                actionResults.push(`${player.name} 攻击了 ${player.target.name}！`);
            }
        }

        // 后结算储能
        for (const player of this.players) {
            if (player.currentAction && player.currentAction.type === ActionType.STORE) {
                actionResults.push(`${player.name} 选择了储能。`);
            }
        }

        this.addLog(actionResults.join(' '));
    }

    async processRound() {
        await this.resolveActions();
        await this.resolveCombat();
        await this.finalizeRound();
    }

    async adjustPlayerEnergies() {
        // 统一在 finalizeRound 中按当前动作扣费/结算
        for (const player of this.players) {
            const a = player.currentAction;
            if (a && a.type === ActionType.STORE) {
                const before = player.energy;
                const gain = a.getEnergyGain();
                player.recoverEnergy(gain);
                this.addLog(`${player.name} 储能 +${gain} 气（${before} → ${player.energy}）`);
            } else if (a) {
                const before = player.energy;
                const cost = a.energyCost || 0;
                player.adjustEnergy();
                this.addLog(`${player.name} 消耗 ${cost} 气（${before} → ${player.energy}）`);
            }
        }
    }

    async resolveCombat() {
        for (const player of this.players) {
            if (player.currentAction && player.currentAction.type === ActionType.ATTACK && player.target) {
                this.executeAttack(player, player.target);
            }
        }
    }

    executeAttack(attacker, attackee) {
        const attackAction = attacker.currentAction;
        if (!attackAction || attackAction.type !== ActionType.ATTACK) return;
        // 让被攻击方处理并返回明细，用于日志
        const result = attackee.handleAttack(attackAction, attacker);
        if (result) {
            const segments = [];
            const base = `${attacker.name} 使用 ${attackAction.name} 对 ${attackee.name} 造成 ${result.actualDamage} 伤害`;
            segments.push(base);
            if (result.reduction > 0) {
                segments.push(`（被防御减免 ${result.reduction}）`);
            }
            if (result.reboundToAttacker > 0) {
                segments.push(`；反弹 ${result.reboundToAttacker} 伤害给 ${attacker.name}`);
            }
            this.addLog(segments.join(''));
        }
    }

    async finalizeRound() {
        // 结算阶段结束：先让表现管理器清理（动作/目标尚未被清空）
        this.roundResolutionManager?.onResolvingEnd();

        await this.adjustPlayerEnergies();

        // 清理动作/目标
        this.players.forEach(p => p.resetRound());

        if (this.debugUIManager) {
            this.debugUIManager.updatePlayerList();
        }

        this.checkGameEnd();
        if (this.isRunning) {
            this.prepareNextRound();
        }
    }

    nextFrame() {
        // 预留：与渲染层联动
    }

    clearTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    checkGameEnd() {
        const alivePlayers = this.players.filter(p => p.isAlive);
        if (alivePlayers.length <= 1) {
            this.isRunning = false;
            this.gameState = 'ended';
            if (alivePlayers.length === 1) {
                this.addLog(`${alivePlayers[0].name} 获胜！`);
            } else {
                this.addLog('所有玩家被淘汰，平局。');
            }
            this.clearTimer();
            if (this.debugUIManager) {
                this.debugUIManager.updateGameState();
            }
        }
    }

    prepareNextRound() {
        this.gameState = 'selecting';
        this.clearTimer();
        if (this.debugUIManager?.isAutoResolve) {
            this.timer = setTimeout(async () => {
                await this.processRound();
            }, this.roundTime);
        }
        if (this.debugUIManager) {
            this.debugUIManager.updateGameState();
        }
    }

    addLog(message) {
        this.logs.push({ round: this.currentRound, message });
        if (this.debugUIManager) {
            this.debugUIManager.updateGameState();
        }
    }

    getGameState() {
        return {
            round: this.currentRound,
            isRunning: this.isRunning,
            gameState: this.gameState,
            state: this.gameState,
            logs: this.logs,
            players: this.players.map(p => p.getStatus()),
        };
    }

    endGame() {
        this.isRunning = false;
        this.clearTimer();
        this.gameState = 'ended';
        if (this.debugUIManager) {
            this.debugUIManager.updateGameState();
        }
    }
}