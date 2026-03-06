import { StrategyFactory } from '../strategies/StrategyFactory.js';
import { ActionType } from './enums/ActionType.js';
import { Player } from './Player.js';

import { CombatManager } from '../managers/CombatManager.js';
import { GameStateStore } from './GameStateStore.js';

const ROUND_TIME = 5000; // 默认回合时间

export class Game {
    constructor(players = [], roundTime = ROUND_TIME) {
        this.players = players;
        this.roundTime = roundTime;
        this.currentRound = 0;
        this.isRunning = false;
        this.timer = null;
        this.nextResolveAt = null; // 下次自动结算的目标时间戳，用于倒计时显示
        this.logs = [];
        this.gameState = 'idle'; // idle, selecting, resolving, ended
        this.debugUIManager = null;
        this.playerManager = this;

        // 新增：集中状态存储 + 结算管理器
        // 注意：保持 this.logs 作为单一真值来源，store.logs 引用它
        this.store = new GameStateStore(this);
        this.combatManager = new CombatManager(this);
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
        if (options && options.networkId != null) player.networkId = options.networkId;
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
        // 防止重复开始导致“开始”日志出现两次
        if (this.isRunning) return;

        if (this.players.length < 2) {
            this.addLog('需要至少2名玩家才能开始游戏');
            return;
        }
        // 标记游戏开始，便于 DebugUI 的自动结算逻辑生效
        this.isRunning = true;
        this.gameState = 'selecting';
        this.currentRound = 1;
        this.players.forEach(p => p.resetForNewRound());
        this.addLog(`第 ${this.currentRound} 回合开始`);

        // Sync initial state with the store
        if (this.store) {
            this.store.updateState({
                round: this.currentRound,
                state: this.gameState,
                players: this.players.map(p => p.getStatus()),
                logs: this.logs,
            });
        }

        // 仅房主自动推进；非房主由网络同步
        this.clearTimer();
        const isHost = (typeof window !== 'undefined' && window.lobby && window.lobby.isHost && window.lobby.isHost());
        if (isHost && this.debugUIManager?.isAutoResolve) {
            this.nextResolveAt = Date.now() + this.roundTime;
            this.timer = setTimeout(async () => {
                await this.processRound();
            }, this.roundTime);
        } else {
            this.nextResolveAt = null;
        }
    }

    startRound() {
        if (!this.isRunning) return;

        this.currentRound++;
        this.gameState = 'selecting';

        this.clearTimer();
        this.nextFrame();

        // 记录新回合开始日志
        this.addLog(`第 ${this.currentRound} 回合开始`);

        // 仅在房主且自动结算开启时才定时推进
        const isHost = (typeof window !== 'undefined' && window.lobby && window.lobby.isHost && window.lobby.isHost());
        if (isHost && this.debugUIManager?.isAutoResolve) {
            this.nextResolveAt = Date.now() + this.roundTime;
            this.timer = setTimeout(async () => {
                await this.processRound();
            }, this.roundTime);
        } else {
            this.nextResolveAt = null;
        }

        if (this.debugUIManager) {
            this.debugUIManager.updateGameState();
        }
    }

    async processRound() {
        // 交给 CombatManager 统一处理整轮
        await this.combatManager.processRound();
    }

    prepareNextRound() {
        // 改为统一走 startRound，确保回合号递增与日志一致
        this.startRound();
    }

    addLog(message) {
        // 统一通过 store 写入，保证 UI 一致性
        this.store.addLog(message);
        if (this.debugUIManager) {
            this.debugUIManager.updateGameState();
        }
    }

    // 新增：安全清理定时器
    clearTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    // 新增：同步当前帧状态到 Store/UI（用于刚进入选择阶段时刷新 HUD 等）
    nextFrame() {
        if (this.store) {
            this.store.updateState({
                round: this.currentRound,
                state: this.gameState,
                players: this.players.map(p => p.getStatus()),
                logs: this.logs,
            });
        }
        if (this.debugUIManager) {
            this.debugUIManager.updateGameState();
        }
    }

    // 新增：检测游戏是否结束（仅剩 0 或 1 名存活者）
    checkGameEnd() {
        const alive = this.getAlivePlayers();
        if (alive.length <= 1) {
            if (alive.length === 1) {
                this.addLog(`胜者：${alive[0].name}`);
            } else {
                this.addLog('所有玩家被击倒，无人获胜');
            }
            this.endGame();
            return true;
        }
        return false;
    }

    getGameState() {
        return {
            round: this.currentRound,
            isRunning: this.isRunning,
            nextResolveAt: this.nextResolveAt,
            gameState: this.gameState,
            state: this.gameState,
            logs: this.logs,
            players: this.players.map(p => ({
                ...p.getStatus(),
                currentAction: p.currentAction ? {
                    type: p.currentAction.type,
                    level: p.currentAction.level,
                    name: p.currentAction.name,
                    energyCost: p.currentAction.energyCost,
                    energyGain: p.currentAction.energyGain,
                } : null,
                networkId: p.networkId,
                targetId: p.target ? p.target.id : null,
                targetNetworkId: p.target ? p.target.networkId : null,
                targetName: p.target ? p.target.name : null,
            })),
        };
    }

    endGame() {
        this.isRunning = false;
        this.clearTimer();
        this.nextResolveAt = null;
        this.gameState = 'ended';
        if (this.debugUIManager) {
            this.debugUIManager.updateGameState();
        }
    }
}
