import { ACTIONS, ACTION_KEYS } from '../core/constants/Actions.js';

export class DebugUIManager {
    constructor(game) {
        this.game = game;
        this.debugPanel = null;
        this.isAutoResolve = false; // 默认不自动解析
        // 新增：用于暂存玩家在下拉框中的临时选择，避免刷新覆盖
        this._pendingSelections = new Map();
        this.setupDebugUI();
    }

    setupDebugUI() {
        this.createDebugPanel();
        this.bindEvents();
        this.updateLobbyList();
        this.updatePlayerList();
        // 新增：初始化时同步一次游戏状态
        this.updateGameState();

        // 新增：订阅 LobbyManager 的变化，实时刷新 DebugUI 的大厅列表
        if (window.lobby && typeof window.lobby.subscribe === 'function') {
            window.lobby.subscribe(() => this.updateLobbyList());
        }
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
                <button id="start-game" style="background: #27ae60; margin-right: 8px;">开始游戏</button>
                <button id="resolve-round" style="background: #f39c12; margin-left: 8px;">手动结算</button>
               <label style="margin-left:12px; font-size:13px;">
                   <input type="checkbox" id="auto-resolve" style="vertical-align:middle; margin-right:4px;">自动结算
               </label>
            </div>

            <div style="margin-bottom: 15px;">
                <h4 style="margin: 0 0 10px 0; color: #3498db;">大厅玩家</h4>
                <button id="add-player" style="background: #2980b9; margin-bottom: 8px;">添加虚拟玩家</button>
                <div id="debug-lobby-list"></div>
            </div>

            <!-- 新增：游戏内玩家列表（本地 Game 管理） -->
            <div style="margin-bottom: 15px;">
                <h4 style="margin: 0 0 10px 0; color: #16a085;">游戏内玩家</h4>
                <div id="debug-player-list"></div>
            </div>

            <div style="margin-bottom: 15px;">
                <h4 style="margin: 0 0 10px 0; color: #9b59b6;">游戏状态</h4>
                <div>房间ID: <span id="room-id">-</span></div>
                <div>玩家ID: <span id="player-id">-</span></div>
                <div>游戏状态: <span id="game-state">idle</span></div>
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
        const autoResolveEl = document.getElementById('auto-resolve');
        if (autoResolveEl) {
            autoResolveEl.checked = this.isAutoResolve;
            autoResolveEl.addEventListener('change', (e) => {
                this.isAutoResolve = e.target.checked;
                if (!this.isAutoResolve && this.game.timer) {
                    clearTimeout(this.game.timer);
                    this.game.timer = null;
                }
                // 若开启自动结算且当前在选择阶段、没有定时器，则补上定时器
                if (this.isAutoResolve && this.game.isRunning && this.game.gameState === 'selecting' && !this.game.timer) {
                    this.game.timer = setTimeout(async () => {
                        await this.game.processRound();
                    }, this.game.roundTime);
                }
                (window.showToast || alert)(`已切换为${this.isAutoResolve ? '自动' : '手动'}结算`);
            });
        }

        // 开始游戏
        const startBtn = document.getElementById('start-game');
        startBtn?.addEventListener('click', () => {
            try {
                if (window.lobby && typeof window.lobby.list === 'function' && window.lobby.list()?.length) {
                    if (window.lobby.allReady() && typeof window.startGameFromLobby === 'function') {
                        window.startGameFromLobby();
                    } else {
                        (window.showToast || alert)('请在大厅中让所有玩家准备好再开始');
                    }
                } else {
                    if (this.game.players.length < 2) throw new Error('至少需要2名玩家才能开始游戏');
                    this.game.startGame();
                }
                this.updateGameState();
            } catch (error) {
                (window.showToast || alert)(error.message);
            }
        });

        // 添加虚拟玩家（仅房主可在大厅添加虚拟玩家；无大厅时则直接向本地游戏添加）
        const addPlayerBtn = document.getElementById('add-player');
        addPlayerBtn?.addEventListener('click', () => {
            if (window.lobby && typeof window.lobby.isHost === 'function') {
                if (!window.lobby.roomId) {
                    (window.showToast || alert)('请先创建或加入房间');
                    return;
                }
                if (!window.lobby.isHost()) {
                    (window.showToast || alert)('只有房主可以添加虚拟玩家');
                    return;
                }
                const name = `虚拟玩家${Math.floor(Math.random() * 1000)}`;
                window.lobby.addBot?.(name);
                if (typeof window.renderLobby === 'function') window.renderLobby();
                this.updateLobbyList();
                return;
            }
            // 无大厅：直接向本地游戏添加一个演示玩家
            this.addVirtualPlayer();
        });

        const resolveRoundBtn = document.getElementById('resolve-round');
        resolveRoundBtn?.addEventListener('click', () => {
            if (this.isAutoResolve) {
                (window.showToast || alert)('请先关闭自动结算');
                return;
            }
            // 修复：手动结算应执行完整流程
            if (typeof this.game.processRound === 'function') {
                this.game.processRound();
            }
        });

        // 动态绑定玩家相关事件
        this.debugPanel.addEventListener('click', async (e) => {
            // 删除玩家（游戏内）
            if (e.target.classList.contains('remove-player')) {
                const playerId = parseInt(e.target.dataset.id);
                const player = this.game.players.find(p => p.id === playerId);
                if (player) {
                    const ok = window.showConfirm ? await window.showConfirm(`确定要删除玩家 ${player.name} 吗？`) : confirm(`确定要删除玩家 ${player.name} 吗？`);
                    if (ok) {
                        this.game.removePlayer(player.id);
                    }
                }
            }
            // 设置玩家行动
            if (e.target.classList.contains('set-action-btn')) {
                const playerCard = e.target.closest('.player-card');
                const index = parseInt(playerCard.dataset.index);
                const player = this.game.players[index];

                const actionSelect = playerCard.querySelector('.action-select');
                const targetSelect = playerCard.querySelector('.target-select');

                const actionKey = actionSelect.value;
                const targetId = targetSelect.value ? parseInt(targetSelect.value) : null;
                const targetPlayer = targetId ? this.game.players.find(p => p.id === targetId) : null;

                try {
                    player.selectAction(actionKey, targetPlayer);
                    // 设定成功后清除该玩家的 pending 缓冲
                    (this._pendingSelections || (this._pendingSelections = new Map())).delete(player.id);
                    console.log(`${player.name} set action to ${actionKey} targeting ${targetPlayer ? targetPlayer.name : 'none'}`);
                    this.updatePlayerList(); // 只在设定后刷新
                } catch (error) {
                    (window.showToast || alert)(error.message);
                    console.error(error);
                }
            }

        });

        this.debugPanel.addEventListener('change', (e) => {
            const playerCard = e.target.closest('.player-card');
            if (!playerCard) return;

            const index = parseInt(playerCard.dataset.index);
            const player = this.game.players[index];

            // 修改生命值
            if (e.target.classList.contains('health-input')) {
                const health = parseInt(e.target.value);
                player.health = health;
                player.isAlive = health > 0;
                this.updatePlayerList();
                return;
            }

            // 修改气量
            if (e.target.classList.contains('energy-input')) {
                const energy = parseInt(e.target.value);
                player.energy = energy;
                this.updatePlayerList();
                return;
            }

            // 新增：当行动或目标下拉选择变化时，不立刻提交，只记录到 pending 中，防止刷新覆盖
            if (e.target.classList.contains('action-select') || e.target.classList.contains('target-select')) {
                const card = e.target.closest('.player-card');
                const actionSel = card.querySelector('.action-select');
                const targetSel = card.querySelector('.target-select');
                const actionKey = actionSel?.value || '';
                const targetId = targetSel?.value ? parseInt(targetSel.value) : null;
                (this._pendingSelections || (this._pendingSelections = new Map())).set(player.id, { actionKey, targetId });
                // 不触发 updatePlayerList，避免重建 DOM 导致视觉闪动
                return;
            }
        });
    }

    updateLobbyList() {
        const container = document.getElementById('debug-lobby-list');
        if (!container) return;
        if (!window.lobby) {
            container.innerHTML = '<div style="opacity:.7;">无大厅（直接向游戏添加玩家）</div>';
            return;
        }
        const players = (typeof window.lobby.list === 'function') ? window.lobby.list() : (window.lobby.players || []);
        if (!players.length) {
            container.innerHTML = '<div style="opacity:.7;">暂无玩家</div>';
            return;
        }
        const selfId = window.lobby.playerId;
        const isHost = typeof window.lobby.isHost === 'function' ? window.lobby.isHost() : false;
        container.innerHTML = players.map(p => {
            const canToggle = p.isBot || p.id === selfId; // 只能切换自己或虚拟玩家
            const canRemove = !!p.isBot && isHost; // 仅房主可删除虚拟玩家
            return `
                    <div style="display:flex; justify-content:space-between; align-items:center; padding:6px; background: rgba(255,255,255,0.08); border-radius:4px; margin-bottom:6px;">
                        <div>
                            <strong>${p.name}${p.isBot ? ' (虚拟)' : ''}</strong>
                            <span style="margin-left:8px; font-size:12px; color:${p.ready ? '#2ecc71' : '#bdc3c7'};">${p.ready ? '已准备' : '未准备'}</span>
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button class="lobby-toggle-ready" data-id="${p.id}" style="background:#8e44ad; padding:4px 8px;" ${canToggle ? '' : 'disabled'}>切换准备</button>
                            <button class="lobby-remove" data-id="${p.id}" style="background:#e74c3c; padding:4px 8px;" ${canRemove ? '' : 'disabled'}>删除</button>
                        </div>
                    </div>
                `;
        }).join('');

        // 绑定事件
        container.querySelectorAll('.lobby-toggle-ready').forEach(btn => {
            btn.onclick = (e) => {
                const id = e.currentTarget.dataset.id; // id 可以是字符串
                const p = (typeof window.lobby.get === 'function') ? window.lobby.get(id) : (players.find(x => String(x.id) === String(id)));
                if (!p) return;
                if (p.isBot && typeof window.lobby.setReady === 'function') {
                    window.lobby.setReady(id, !p.ready);
                } else if (String(id) === String(selfId)) {
                    window.lobby.toggleReady();
                } else {
                    (window.showToast || alert)('不能修改其他真实玩家的准备状态');
                    return;
                }
                if (typeof window.renderLobby === 'function') window.renderLobby();
                this.updateLobbyList();
                if (window.lobby.allReady && window.lobby.allReady() && typeof window.startGameFromLobby === 'function') {
                    window.startGameFromLobby();
                }
            };
        });
        container.querySelectorAll('.lobby-remove').forEach(btn => {
            btn.onclick = async (e) => {
                const id = e.currentTarget.dataset.id; // 可能是字符串
                const p = (typeof window.lobby.get === 'function') ? window.lobby.get(id) : (players.find(x => String(x.id) === String(id)));
                if (!p) return;
                if (!p.isBot) {
                    (window.showToast || alert)('只能删除虚拟玩家');
                    return;
                }
                if (!(typeof window.lobby.isHost === 'function' && window.lobby.isHost())) {
                    (window.showToast || alert)('只有房主可以删除虚拟玩家');
                    return;
                }
                const ok = window.showConfirm ? await window.showConfirm(`确定要删除 ${p.name} 吗？`) : confirm(`确定要删除 ${p.name} 吗？`);
                if (!ok) return;
                if (typeof window.lobby.remove === 'function') {
                    window.lobby.remove(id);
                }
                if (typeof window.renderLobby === 'function') window.renderLobby();
                this.updateLobbyList();
            };
        });
    }

    // 新增：同步游戏状态（回合、状态、日志等）
    updateGameState() {
        try {
            const state = typeof this.game.getGameState === 'function' ? this.game.getGameState() : null;
            if (!state) return;

            const roomIdEl = document.getElementById('room-id');
            if (roomIdEl) roomIdEl.textContent = (window.lobby && window.lobby.roomId) ? window.lobby.roomId : '-';

            const playerIdEl = document.getElementById('player-id');
            if (playerIdEl) playerIdEl.textContent = (window.myPlayerId) ? window.myPlayerId : '-';

            const gameStateEl = document.getElementById('game-state');
            if (gameStateEl) gameStateEl.textContent = `${state.state}${state.round ? ` (第${state.round}轮)` : ''}`;

            const logsEl = document.getElementById('game-logs');
            if (logsEl) {
                const logs = Array.isArray(state.logs) ? state.logs : [];
                logsEl.innerHTML = logs.map(l => {
                    if (typeof l === 'string') {
                        return `<div>${l}</div>`;
                    }
                    const msg = l && typeof l.message !== 'undefined' ? l.message : '';
                    const rd = l && typeof l.round !== 'undefined' ? l.round : '';
                    const prefix = rd !== '' ? `[${rd}] ` : '';
                    return `<div>${prefix}${msg}</div>`;
                }).join('');
                logsEl.scrollTop = logsEl.scrollHeight;
            }
        } catch (e) {
            console.warn('updateGameState error:', e);
        }
    }

    updatePlayerList() {
        const playerListContainer = document.getElementById('debug-player-list');
        if (!playerListContainer) return;

        // 防御：确保 _pendingSelections 存在
        if (!this._pendingSelections) this._pendingSelections = new Map();

        const players = this.game.players || [];
        playerListContainer.innerHTML = players.map((player, index) => {
            const isVirtual = player.name.includes('虚拟');
            const otherPlayers = players.filter(p => p.id !== player.id);

            // 新增：从 pendingSelections 读取临时选择，优先使用（加固防御）
            const pendingMap = (this._pendingSelections && this._pendingSelections instanceof Map) ? this._pendingSelections : null;
            const pending = pendingMap ? pendingMap.get(player.id) : null;
            const pendingActionKey = pending?.actionKey ?? null;
            const pendingTargetId = pending?.targetId ?? null;

            // 生成动作下拉选项（优先 pending，其次 currentAction）
            let actionOptions = '<option value="" ' + (!pendingActionKey && !player.currentAction ? 'selected' : '') + '>无</option>';
            actionOptions += ACTION_KEYS.map((key) => {
                const cfg = ACTIONS[key];
                const selectedByPending = pendingActionKey ? (key === pendingActionKey) : false;
                const selectedByCurrent = !pendingActionKey && player.currentAction && cfg && (cfg.type === player.currentAction.type) && (cfg.level === player.currentAction.level);
                const selected = (selectedByPending || selectedByCurrent) ? 'selected' : '';
                return `<option value="${key}" ${selected}>${cfg?.name || key}</option>`;
            }).join('');

            return `
                <div class="player-card" data-index="${index}" style="border: 1px solid ${isVirtual ? '#f39c12' : '#3498db'}; padding: 10px; margin-bottom: 10px; border-radius: 5px;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong>${player.name} (ID: ${player.id})</strong>
                        <button class="remove-player" data-id="${player.id}" style="background: #e74c3c; padding: 4px 8px;">删除</button>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">
                        <div>
                            <label>HP:</label>
                            <input type="number" class="health-input" value="${player.health}" style="width: 60px;">
                        </div>
                        <div>
                            <label>气:</label>
                            <input type="number" class="energy-input" value="${player.energy}" style="width: 60px;">
                        </div>
                    </div>
                    <div style="margin-top: 8px;">
                        <label>行动:</label>
                        <select class="action-select">
                            ${actionOptions}
                        </select>
                        <select class="target-select">
                            <option value="">--选择目标--</option>
                            ${otherPlayers.map(p => {
                const selected = (pendingTargetId != null)
                    ? (pendingTargetId === p.id ? 'selected' : '')
                    : (player.target && player.target.id === p.id ? 'selected' : '');
                return `<option value="${p.id}" ${selected}>${p.name}</option>`;
            }).join('')}
                        </select>
                        <button class="set-action-btn" style="background: #2ecc71; margin-left: 8px;">设定</button>
                    </div>
                    <div style="font-size: 12px; margin-top: 5px; color: #bdc3c7;">
                        当前行动: ${player.currentAction ? player.currentAction.name : '-'} | 目标: ${player.target ? player.target.name : '-'}
                    </div>
                </div>
            `;
        }).join('');
    }

    addVirtualPlayer() {
        const name = `玩家${this.game.players.length + 1}`;
        this.game.addPlayer(name);
        this.updatePlayerList();
        this.updateGameState();
        (window.showToast || alert)(`已添加 ${name}`);
    }

    // 定时刷新（供外部调用）
    startUpdating(intervalMs = 2000) {
        if (this._updateTimer) clearInterval(this._updateTimer);
        this._updateTimer = setInterval(() => {
            try {
                this.updateGameState();
                // this.updatePlayerList(); // 移除定时刷新玩家列表，避免覆盖未设定的选择
                this.updateLobbyList();
            } catch (e) {
                console.warn('DebugUI auto update error:', e);
            }
        }, intervalMs);
    }

    stopUpdating() {
        if (this._updateTimer) {
            clearInterval(this._updateTimer);
            this._updateTimer = null;
        }
    }
}