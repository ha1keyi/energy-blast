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

    async processRound() {
        // 交给 CombatManager 统一处理整轮
        await this.combatManager.processRound();
    }

    // 保留接口：由 CombatManager 内部直接处理，避免重复逻辑
    async resolveActions() { /* 迁移至 CombatManager */ }
    async resolveCombat() { /* 迁移至 CombatManager */ }
    async finalizeRound() { /* 迁移至 CombatManager */ }
    executeAttack(attacker, attackee) { /* 迁移至 CombatManager */ }

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