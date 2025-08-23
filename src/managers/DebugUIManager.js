import { ACTION_KEYS } from '../core/constants/Actions.js';

export class DebugUIManager {
    constructor(game) {
        this.game = game;
        this.debugPanel = null;
        this.isAutoResolve = false; // 默认不自动解析
        this.setupDebugUI();
    }

    setupDebugUI() {
        this.createDebugPanel();
        this.bindEvents();
        this.updatePlayerList();
    }

    createDebugPanel() {
        // 创建调试面板
        this.debugPanel = document.createElement('div');
        this.debugPanel.id = 'debug-panel';
        this.debugPanel.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 15px;
            border-radius: 8px;
            font-family: 'Arial', sans-serif;
            z-index: 10000;
            max-width: 400px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
        `;

        this.debugPanel.innerHTML = `
            <h3 style="margin: 0 0 15px 0; color: #4ecdc4;">🎮 游戏调试面板</h3>
            
            <div style="margin-bottom: 15px;">
                <label style="display: flex; align-items: center; gap: 8px;">
                    <input type="checkbox" id="auto-resolve" ${this.isAutoResolve ? 'checked' : ''}>
                    自动轮次结算 (5秒)
                </label>
            </div>

            <div style="margin-bottom: 15px;">
                <button id="start-game" style="background: #27ae60; margin-right: 8px;">开始游戏</button>
                <button id="resolve-now" style="background: #f39c12;">立即结算</button>
                <button id="end-game" style="background: #e74c3c; margin-left: 8px;">结束游戏</button>
            </div>

            <div style="margin-bottom: 15px;">
                <h4 style="margin: 0 0 10px 0; color: #3498db;">玩家管理</h4>
                <div style="display: flex; gap: 8px; margin-bottom: 10px;">
                    <input type="text" id="new-player-name" placeholder="玩家名称" style="flex: 1; padding: 5px;">
                    <button id="add-player" style="background: #2ecc71;">新增玩家</button>
                </div>
                <div id="player-list"></div>
            </div>

            <div style="margin-bottom: 15px;">
                <h4 style="margin: 0 0 10px 0; color: #9b59b6;">游戏状态</h4>
                <div>当前回合: <span id="current-round">0</span></div>
                <div>游戏状态: <span id="game-state">idle</span></div>
                <div>存活玩家: <span id="alive-count">0</span></div>
            </div>

            <div>
                <h4 style="margin: 0 0 10px 0; color: #e67e22;">操作日志</h4>
                <div id="game-logs" style="max-height: 150px; overflow-y: auto; background: rgba(255,255,255,0.1); padding: 8px; border-radius: 4px; font-size: 12px;"></div>
            </div>
        `;

        document.body.appendChild(this.debugPanel);
    }

    bindEvents() {
        // 自动解析开关
        document.getElementById('auto-resolve').addEventListener('change', (e) => {
            this.isAutoResolve = e.target.checked;
            if (!this.isAutoResolve && this.game.timer) {
                clearTimeout(this.game.timer);
            }
        });

        // 游戏控制按钮
        document.getElementById('start-game').addEventListener('click', () => {
            try {
                this.game.startGame();
                this.updateGameState();
            } catch (error) {
                alert(error.message);
            }
        });

        document.getElementById('resolve-now').addEventListener('click', () => {
            if (this.game.gameState === 'selecting') {
                this.game.resolveActions();
                this.updateGameState();
            }
        });

        document.getElementById('end-game').addEventListener('click', () => {
            this.game.endGame();
            this.updateGameState();
        });

        // 新增玩家
        document.getElementById('add-player').addEventListener('click', () => {
            const nameInput = document.getElementById('new-player-name');
            const name = nameInput.value.trim() || `玩家 ${this.game.players.length + 1}`;

            this.game.addPlayer(name);
            nameInput.value = '';
        });
    }

    updatePlayerList() {
        const playerList = document.getElementById('player-list');
        playerList.innerHTML = '';

        this.game.players.forEach((player, index) => {
            const playerCard = document.createElement('div');
            playerCard.style.cssText = `
                background: rgba(255, 255, 255, 0.1);
                padding: 10px;
                margin-bottom: 8px;
                border-radius: 4px;
                border-left: 4px solid ${player.isAlive ? '#2ecc71' : '#e74c3c'};
            `;

            // Action and Target selection dropdowns
            const actionOptions = ACTION_KEYS.map(key => `<option value="${key}">${key}</option>`).join('');

            let targetOptions = '<option value="">-- 无目标 --</option>';
            this.game.players.forEach(p => {
                if (p.id !== player.id) {
                    targetOptions += `<option value="${p.id}">${p.name}</option>`;
                }
            });

            const actionSelectionHTML = `
                <div style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.2);">
                    <div style="display: flex; gap: 5px; align-items: center;">
                        <select id="action-select-${player.id}" class="action-select" data-index="${index}" style="flex: 1;">${actionOptions}</select>
                        <select id="target-select-${player.id}" class="target-select" data-index="${index}" style="flex: 1;">${targetOptions}</select>
                        <button id="set-action-btn-${player.id}" class="set-action-btn" data-index="${index}" style="background: #3498db; padding: 4px 8px;">设置</button>
                    </div>
                </div>
            `;


            playerCard.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong>${player.name} ${!player.isAlive ? '💀' : ''}</strong>
                    <button id="remove-player-btn-${player.id}" class="remove-player" data-id="${player.id}" style="background: #e74c3c; padding: 2px 6px; font-size: 12px;">删除</button>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 12px;">
                    <div>生命: <input type="number" id="health-input-${player.id}" class="health-input" data-index="${index}" value="${player.health}" min="0" max="10" style="width: 40px;"></div>
                    <div>气量: <input type="number" id="energy-input-${player.id}" class="energy-input" data-index="${index}" value="${player.energy}" min="0" max="10" style="width: 40px;"></div>
                    <div>分数: ${player.score}</div>
                    <div>状态: ${player.isAlive ? '存活' : '死亡'}</div>
                </div>
                <div style="margin-top: 5px; font-size: 11px; color: #bbb;">
                    当前操作: ${player.currentAction ? `${player.currentAction.name} -> ${player.target ? player.target.name : '无'}` : '未选择'}
                </div>
                ${player.isAlive && this.game.gameState === 'selecting' ? actionSelectionHTML : ''}
            `;

            playerList.appendChild(playerCard);
        });

        // 绑定删除和输入事件
        this.bindPlayerEvents();
    }

    bindPlayerEvents() {
        // 删除玩家
        document.querySelectorAll('.remove-player').forEach(button => {
            button.addEventListener('click', (e) => {
                const playerId = parseInt(e.target.dataset.id);
                const player = this.game.players.find(p => p.id === playerId);
                if (confirm(`确定要删除玩家 ${player.name} 吗？`)) {
                    this.game.removePlayer(player.id);
                }
            });
        });

        // 修改生命值
        document.querySelectorAll('.health-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index);
                const health = parseInt(e.target.value);
                this.game.players[index].health = health;
                this.game.players[index].isAlive = health > 0;
                this.updatePlayerList();
            });
        });

        // 修改气量
        document.querySelectorAll('.energy-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index);
                const energy = parseInt(e.target.value);
                this.game.players[index].energy = energy;
                this.updatePlayerList();
            });
        });

        document.querySelectorAll('.set-action-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index);
                const player = this.game.players[index];

                const actionSelect = e.target.closest('div').querySelector('.action-select');
                const targetSelect = e.target.closest('div').querySelector('.target-select');

                const actionKey = actionSelect.value;
                const targetId = targetSelect.value ? parseInt(targetSelect.value) : null;
                const targetPlayer = targetId ? this.game.players.find(p => p.id === targetId) : null;

                try {
                    player.selectAction(actionKey, targetPlayer);
                    console.log(`${player.name} set action to ${actionKey} targeting ${targetPlayer ? targetPlayer.name : 'none'}`);
                    this.updatePlayerList(); // Refresh UI to show selected action
                } catch (error) {
                    alert(error.message);
                    console.error(error);
                }
            });
        });
    }

    updateGameState() {
        document.getElementById('current-round').textContent = this.game.currentRound;
        document.getElementById('game-state').textContent = this.game.gameState;
        document.getElementById('alive-count').textContent = this.game.playerManager.getAlivePlayers().length;

        // 更新日志
        const logsContainer = document.getElementById('game-logs');
        logsContainer.innerHTML = this.game.logs
            .slice(-10)
            .map(log => `<div style="margin-bottom: 2px;">[${log.round}] ${log.message}</div>`)
            .join('');
        logsContainer.scrollTop = logsContainer.scrollHeight;
    }

    // 定期更新界面
    startUpdating() {
        setInterval(() => {
            this.updateGameState();
        }, 1000);
    }

    // 切换显示/隐藏
    toggleVisibility() {
        this.debugPanel.style.display = this.debugPanel.style.display === 'none' ? 'block' : 'none';
    }
}