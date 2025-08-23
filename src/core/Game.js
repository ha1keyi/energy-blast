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
    }

    setDebugUIManager(manager) {
        this.debugUIManager = manager;
        if (this.debugUIManager) {
            this.debugUIManager.updatePlayerList();
            this.debugUIManager.updateGameState();
        }
    }

    addPlayer(name) {
        const newId = this.players.length > 0 ? Math.max(...this.players.map(p => p.id)) + 1 : 1;
        const player = new Player(newId, name);
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

        this.addLog(`第 ${this.currentRound} 轮开始！`);
        this.addLog('请玩家选择操作...');

        this.players.forEach(player => {
            if (player.isAlive) {
                player.resetForNewRound();
            }
        });

        if (this.debugUIManager) {
            this.debugUIManager.updateGameState();
            this.debugUIManager.updatePlayerList(); // Ensure controls are visible
        }

        // Clear any existing timer before starting a new round decision
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        // Only set a new timer if auto-resolve is enabled
        if (this.debugUIManager && this.debugUIManager.isAutoResolve) {
            this.timer = setTimeout(() => {
                this.resolveActions();
            }, this.roundTime);
        }
    }

    resolveActions() {
        if (this.gameState !== 'selecting') return;

        this.gameState = 'resolving';
        // It's possible to get here via manual "Resolve Now" button, so ensure timer is cleared.
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.addLog('解析操作...');

        this.players.forEach(player => {
            if (player.isAlive && player.currentAction) {
                player.adjustEnergy();
            }
        });

        const attackResults = [];
        this.players.forEach(attacker => {
            if (attacker.isAlive &&
                attacker.currentAction &&
                attacker.currentAction.type === ActionType.ATTACK &&
                attacker.target) {

                const attackee = attacker.target;
                if (!attackee.isAlive) {
                    this.addLog(`${attacker.name}攻击了已经倒下的${attackee.name}，无效！`);
                    return;
                }

                let result;

                if (attackee.target && attackee.target.id !== attacker.id) {
                    const damage = attacker.currentAction.getActualDamage();
                    attackee.takeDamage(damage);
                    result = {
                        message: `${attacker.name}偷袭了正在攻击他人的${attackee.name}，造成${damage}点伤害`,
                        damage: damage,
                        type: 'sneak-attack'
                    };
                } else {
                    const strategy = StrategyFactory.getStrategyForActions(
                        attacker.currentAction,
                        attackee.currentAction
                    );
                    result = strategy.execute(attacker, attackee);
                }

                attackResults.push(result);
                this.addLog(result.message);
            }
        });

        this.checkGameEnd();

        this.prepareNextRound();
    }

    checkGameEnd() {
        const alivePlayers = this.players.filter(player => player.isAlive);

        if (alivePlayers.length <= 1) {
            this.gameState = 'ended';
            this.isRunning = false;

            if (alivePlayers.length === 1) {
                const winner = alivePlayers[0];
                winner.score++;
                this.addLog(`游戏结束！${winner.name}获胜！`);
            } else {
                this.addLog('游戏结束！平局！');
            }

            return true;
        }

        return false;
    }

    prepareNextRound() {
        if (this.gameState === 'ended') {
            if (this.debugUIManager) {
                this.debugUIManager.updateGameState();
                this.debugUIManager.updatePlayerList();
            }
            return;
        }

        this.players.forEach(player => {
            if (player.isAlive) {
                player.resetForNewRound();
            }
        });

        this.gameState = 'idle';

        setTimeout(() => {
            this.startRound();
        }, 2000);
    }

    addLog(message) {
        this.logs.push({
            round: this.currentRound,
            message: message,
            timestamp: Date.now()
        });

        if (this.logs.length > 100) {
            this.logs.shift();
        }

        console.log(`[Round ${this.currentRound}] ${message}`);
        if (this.debugUIManager) {
            this.debugUIManager.updateGameState();
        }
    }

    getGameState() {
        return {
            round: this.currentRound,
            state: this.gameState,
            players: this.players.map(player => player.getStatus()),
            logs: this.logs.slice(-10)
        };
    }

    endGame() {
        this.isRunning = false;
        this.gameState = 'ended';
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.addLog('游戏被强制结束');
    }
}