import { ACTIONS } from '../core/constants/Actions.js';
import { ActionType } from '../core/enums/ActionType.js';

export class BattleFlowCoordinator {
    constructor({
        gameCore,
        phaserGame,
        lobbyManager,
        debugUI,
        elements,
        imageMap,
        showToast,
        renderLobby,
    }) {
        this.gameCore = gameCore;
        this.phaserGame = phaserGame;
        this.lobbyManager = lobbyManager;
        this.debugUI = debugUI;
        this.elements = elements;
        this.imageMap = imageMap;
        this.showToast = showToast;
        this.renderLobby = renderLobby;

        this.localPlayerId = null;
        this.gameSyncIntervalId = null;
        this.endHandled = false;
        this.endReturnTimerId = null;
        this.lastBroadcast = { round: 0, state: '', logs: 0 };
        this.lastBroadcastAt = 0;
        this.lastSocket = null;
    }

    init() {
        window.startGameFromLobby = (options) => this.startGame(options);
        window.returnToLobby = (options) => this.returnToLobby(options);
        this.bindNetworkSync();
        this.lobbyManager.subscribe(() => this.syncFromLobbyState());
        this.syncFromLobbyState();
    }

    clearEndReturnTimer() {
        if (this.endReturnTimerId) {
            clearTimeout(this.endReturnTimerId);
            this.endReturnTimerId = null;
        }
    }

    scheduleReturnToRoom() {
        if (this.endReturnTimerId) return;
        this.endReturnTimerId = setTimeout(() => {
            this.endReturnTimerId = null;
            if (this.gameCore.gameState === 'ended') {
                this.returnToLobby();
            }
        }, 2200);
    }

    findCorePlayerByRemoteId(remoteId) {
        if (remoteId == null) return null;
        return this.gameCore.players.find((player) => (
            player.networkId === remoteId ||
            String(player.id) === String(remoteId) ||
            player.name === String(remoteId)
        )) || null;
    }

    bindNetworkSync() {
        const tryBind = () => {
            const sock = this.lobbyManager.socket;
            if (!sock || sock === this.lastSocket) return;

            this.lastSocket = sock;

            sock.off?.('roundResolved');
            sock.on('roundResolved', (state) => {
                if (this.gameCore && (!this.lobbyManager.isHost() || !this.gameCore.isRunning)) {
                    this.gameCore.store?.applySnapshot?.(state);
                }
            });

            sock.off?.('actionSelected');
            sock.on('actionSelected', ({ playerId, actionKey, targetId }) => {
                if (!this.lobbyManager.isHost() || !this.gameCore) return;

                const player = this.findCorePlayerByRemoteId(playerId);
                if (!player) return;

                let target = null;
                if (targetId) {
                    target = this.findCorePlayerByRemoteId(targetId);
                }

                try {
                    player.selectAction(actionKey, target);
                    this.debugUI?.updatePlayerList?.();
                } catch (e) {
                    console.warn('[Host] Failed to sync action:', e);
                }
            });

            sock.off?.('gameStarted');
            sock.on('gameStarted', (roomState) => {
                this.lobbyManager.gameStarted = true;
                if (roomState?.snapshot) this.lobbyManager.lastSnapshot = roomState.snapshot;
                if (roomState?.settings) this.lobbyManager.roomSettings = roomState.settings;
                this.startGame({
                    force: true,
                    snapshot: roomState?.snapshot || this.lobbyManager.lastSnapshot,
                    settings: roomState?.settings || this.lobbyManager.getRoomSettings?.(),
                });
            });

            sock.off?.('gameEnded');
            sock.on('gameEnded', (reason) => {
                this.lobbyManager.gameStarted = false;
                if (reason) this.showToast(`对局结束：${reason}`);
                this.returnToLobby();
            });

            sock.off?.('rematchStarted');
            sock.on('rematchStarted', () => {
                this.clearEndReturnTimer();
                this.lobbyManager.lastSnapshot = null;
                if (this.gameCore) {
                    this.gameCore.isRunning = false;
                    this.gameCore.gameState = 'idle';
                    this.gameCore.currentRound = 0;
                    this.gameCore.nextResolveAt = null;
                    this.gameCore.logs = [];
                    this.gameCore.store?.clearLogs?.();
                }
                this.returnToLobby();
            });
        };

        this.lobbyManager.subscribe(tryBind);
        tryBind();

        setInterval(() => this.broadcastTick(), 400);
    }

    broadcastTick() {
        const core = this.gameCore;
        if (!core || !this.lobbyManager.connected || !this.lobbyManager.roomId || !this.lobbyManager.isHost()) return;

        const snap = { round: core.currentRound, state: core.gameState, logs: core.logs?.length || 0 };
        const shouldHeartbeat = (Date.now() - this.lastBroadcastAt) > 1200;
        if (
            snap.round !== this.lastBroadcast.round ||
            snap.state !== this.lastBroadcast.state ||
            snap.logs !== this.lastBroadcast.logs ||
            shouldHeartbeat
        ) {
            this.lobbyManager.socket.emit('roundResolved', this.lobbyManager.roomId, core.getGameState());
            this.lastBroadcast = snap;
            this.lastBroadcastAt = Date.now();
        }
    }

    applyMatchSettings(settings, { reschedule = false } = {}) {
        this.gameCore.applyMatchSettings?.(settings || this.lobbyManager.getRoomSettings?.(), { reschedule });
        this.debugUI?.syncControlStateFromGame?.();
    }

    cleanupMatchState({ clearLogs = true, clearPlayers = true } = {}) {
        window.pendingAttack = null;
        window.localPlayerId = null;
        this.localPlayerId = null;
        this.clearEndReturnTimer();
        if (clearLogs) this.lobbyManager.lastSnapshot = null;

        if (this.gameSyncIntervalId) {
            clearInterval(this.gameSyncIntervalId);
            this.gameSyncIntervalId = null;
        }

        this.gameCore.clearTimer?.();
        if (this.gameCore.battlePresentationManager?.cleanup) {
            this.gameCore.battlePresentationManager.cleanup();
            this.gameCore.battlePresentationManager = null;
        }
        this.gameCore.battleAnimationManager = null;
        this.gameCore.players.forEach((player) => player.resetRound?.());
        if (clearPlayers) this.gameCore.players = [];
        this.gameCore.isRunning = false;
        this.gameCore.gameState = 'idle';
        this.gameCore.currentRound = 0;
        this.gameCore.nextResolveAt = null;

        if (clearLogs) {
            this.gameCore.logs = [];
            this.gameCore.store?.clearLogs?.();
        }

        this.gameCore.store?.updateState?.({
            round: this.gameCore.currentRound,
            state: this.gameCore.gameState,
            isRunning: this.gameCore.isRunning,
            players: clearPlayers ? [] : this.gameCore.players.map((player) => player.getStatus()),
            logs: this.gameCore.logs,
        });

        this.hideActionBar();
    }

    ensureHostRoundTimer() {
        if (!this.gameCore?.isRunning || this.gameCore.gameState !== 'selecting') return;
        const isHost = this.lobbyManager.isHost && this.lobbyManager.isHost();
        if (!isHost) {
            this.gameCore.clearResolveTimer?.(false);
            return;
        }

        if (!this.gameCore.autoResolveEnabled) {
            this.gameCore.clearResolveTimer?.();
            return;
        }

        this.gameCore.scheduleResolveTimer?.();
    }

    returnToLobby({ resetRoom = false } = {}) {
        this.endHandled = false;
        this.lobbyManager.gameStarted = false;
        this.lobbyManager.lastSnapshot = null;
        this.cleanupMatchState({ clearLogs: true, clearPlayers: true });

        if (this.phaserGame.scene.isActive('GameScene')) {
            this.phaserGame.scene.stop('GameScene');
        }
        this.elements.gameCanvasEl?.classList.add('hidden');

        if (resetRoom) {
            this.lobbyManager.roomId = null;
            this.lobbyManager.clearSession?.();
            this.lobbyManager.reset();
        }

        document.getElementById('ui-container')?.classList.remove('hidden');
        this.elements.homeScreen?.classList.add('hidden');
        this.elements.lobbyScreen?.classList.remove('hidden');
        this.renderLobby?.();
    }

    syncFromLobbyState() {
        const snapshotState = this.lobbyManager.lastSnapshot?.state || this.lobbyManager.lastSnapshot?.gameState || '';
        const canResumeActiveMatch = snapshotState === 'selecting' || snapshotState === 'resolving';
        if (this.lobbyManager.gameStarted && this.lobbyManager.roomId && !this.gameCore.isRunning && canResumeActiveMatch) {
            setTimeout(() => {
                if (this.lobbyManager.gameStarted && !this.gameCore.isRunning) {
                    this.startGame({
                        force: true,
                        snapshot: this.lobbyManager.lastSnapshot,
                        settings: this.lobbyManager.lastSnapshot?.matchSettings || this.lobbyManager.getRoomSettings?.(),
                    });
                }
            }, 0);
        }

        this.ensureHostRoundTimer();
    }

    startUiSync() {
        let lastRound = this.gameCore.currentRound;
        const syncUI = () => {
            if (this.gameCore.gameState === 'selecting' && this.gameCore.currentRound !== lastRound) {
                window.pendingAttack = null;
                lastRound = this.gameCore.currentRound;
            }

            if (this.gameCore.gameState === 'selecting') {
                this.ensureHostRoundTimer();
                this.showActionBar();
            } else {
                this.hideActionBar();
            }

            if (this.gameCore.gameState === 'ended') {
                window.pendingAttack = null;
                if (!this.endHandled) {
                    this.endHandled = true;
                    this.scheduleReturnToRoom();
                }
            }
        };

        if (this.gameSyncIntervalId) clearInterval(this.gameSyncIntervalId);
        this.gameSyncIntervalId = setInterval(syncUI, 300);
    }

    startGame({ force = false, snapshot = null, settings = null } = {}) {
        if (!force && !this.lobbyManager.allReady()) return;

        this.clearEndReturnTimer();
        const snapshotState = snapshot?.state || snapshot?.gameState || '';
        const resumeSnapshot = snapshot && (snapshotState === 'selecting' || snapshotState === 'resolving') ? snapshot : null;
        const effectiveSettings = settings || resumeSnapshot?.matchSettings || this.lobbyManager.getRoomSettings?.();

        if (this.phaserGame.scene.isActive('GameScene')) {
            this.phaserGame.scene.stop('GameScene');
        }

        document.getElementById('ui-container')?.classList.add('hidden');
        this.elements.gameCanvasEl?.classList.remove('hidden');

        this.cleanupMatchState({ clearLogs: true, clearPlayers: true });
        this.applyMatchSettings(effectiveSettings, { reschedule: false });

        const lobbyPlayers = this.lobbyManager.list();
        const selfLobby = this.lobbyManager.getSelf?.() || null;
        lobbyPlayers.forEach((player, idx) => {
            this.gameCore.addPlayer(player.name, { isBot: !!player.isBot, networkId: player.id });
            const added = this.gameCore.players[idx];
            if (selfLobby && player.id === selfLobby.id && added) {
                this.localPlayerId = added.id;
            }
        });

        this.gameCore.startGame();
        this.endHandled = false;

        if (!this.phaserGame.scene.isActive('GameScene')) {
            this.phaserGame.scene.start('GameScene');
        }

        if (!this.localPlayerId) {
            this.localPlayerId = (this.gameCore.players[0] && this.gameCore.players[0].id) || 1;
        }
        window.localPlayerId = this.localPlayerId;

        if (resumeSnapshot) {
            this.gameCore.store?.applySnapshot?.(resumeSnapshot);
        } else {
            this.lobbyManager.lastSnapshot = null;
            this.gameCore.store?.updateState?.(this.gameCore.getGameState());
        }

        this.startUiSync();
    }

    getSelectedActionLabel(player) {
        if (!player) return '未选择';
        if (window.pendingAttack && window.pendingAttack.selfId === player.id) {
            const pendingCfg = ACTIONS[window.pendingAttack.actionKey];
            return pendingCfg ? `${pendingCfg.name} (待选目标)` : '攻击 (待选目标)';
        }
        if (!player.currentAction) return '未选择';
        return player.target?.name ? `${player.currentAction.name} -> ${player.target.name}` : player.currentAction.name;
    }

    getActionHeaderLabel(isHost) {
        if (!this.gameCore.autoResolveEnabled) {
            return isHost ? '结算：手动' : '结算：等待房主';
        }

        const remain = this.gameCore.nextResolveAt ? Math.max(0, this.gameCore.nextResolveAt - Date.now()) : 0;
        const secLabel = !isHost && !this.gameCore.nextResolveAt ? '同步中' : `${Math.ceil(remain / 1000)}s`;
        return `倒计时：${secLabel}`;
    }

    onChooseAction(player, actionKey) {
        const cfg = ACTIONS[actionKey];
        if (cfg.type === ActionType.ATTACK) {
            window.pendingAttack = { selfId: player.id, actionKey };
            this.showActionBar();
            return;
        }

        try {
            player.selectAction(actionKey, null);
            this.debugUI?.updatePlayerList?.();
        } catch (e) {
            this.showToast(e.message);
            return;
        }

        this.lobbyManager.socket?.emit('selectAction', this.lobbyManager.roomId, actionKey, null);
        this.showActionBar();
    }

    showActionBar() {
        if (!this.gameCore.isRunning || this.gameCore.gameState !== 'selecting') return this.hideActionBar();
        const players = this.gameCore.players || [];
        const selfId = window.localPlayerId || players[0]?.id;
        const me = players.find((player) => player.id === selfId);
        if (!me || !me.isAlive) return this.hideActionBar();

        const keys = ['STORE_1', 'ATTACK_1', 'DEFEND_1', 'REBOUND_1', 'ATTACK_2'].filter((key) => ACTIONS[key]);
        const availability = keys.map((key) => {
            const cfg = ACTIONS[key];
            let can = me.energy >= (cfg.energyCost || 0);
            if (cfg.type === ActionType.ATTACK) {
                const hasTarget = this.gameCore.players.some((player) => player.id !== me.id && player.isAlive);
                can = can && hasTarget;
            }
            return { key, can };
        });

        const sig = JSON.stringify({
            round: this.gameCore.currentRound,
            meId: me.id,
            energy: me.energy,
            autoResolveEnabled: this.gameCore.autoResolveEnabled,
            availability,
        });
        const isHost = this.lobbyManager.isHost && this.lobbyManager.isHost();
        const actionBarEl = this.elements.actionBarEl;

        if (actionBarEl.dataset && actionBarEl.dataset.sig === sig && !actionBarEl.classList.contains('hidden')) {
            const header = document.getElementById('action-bar-header');
            const statusEl = document.getElementById('action-bar-status');
            if (header) {
                header.textContent = `回合 ${this.gameCore.currentRound} · 状态：选择阶段 · ${this.getActionHeaderLabel(isHost)}`;
            }
            if (statusEl) {
                statusEl.textContent = `我：生命 ${me.health} 气 ${me.energy} · Selected: ${this.getSelectedActionLabel(me)}`;
            }
            return;
        }

        if (actionBarEl.dataset) actionBarEl.dataset.sig = sig;
        actionBarEl.classList.remove('hidden');
        actionBarEl.innerHTML = '';

        const header = document.createElement('div');
        header.id = 'action-bar-header';
        header.className = 'action-bar-header';
        header.textContent = `回合 ${this.gameCore.currentRound} · 状态：选择阶段 · ${this.getActionHeaderLabel(isHost)}`;
        actionBarEl.appendChild(header);

        const statusEl = document.createElement('div');
        statusEl.id = 'action-bar-status';
        statusEl.className = 'action-bar-status';
        statusEl.textContent = `我：生命 ${me.health} 气 ${me.energy} · Selected: ${this.getSelectedActionLabel(me)}`;
        actionBarEl.appendChild(statusEl);

        const buttonRow = document.createElement('div');
        buttonRow.className = 'action-buttons';

        availability.forEach(({ key, can }) => {
            const cfg = ACTIONS[key];
            const btn = document.createElement('button');
            btn.className = `action-btn${can ? '' : ' disabled'}`;
            const imgName = `${key.toLowerCase()}.jpg`;
            const imgSrc = this.imageMap[imgName] || '';
            btn.innerHTML = `<img alt="${cfg.name}" src="${imgSrc}"/><span>${cfg.name}</span><em class="energy">耗气:${cfg.energyCost}</em>`;
            if (can) {
                btn.onclick = () => this.onChooseAction(me, key);
            }
            buttonRow.appendChild(btn);
        });

        actionBarEl.appendChild(buttonRow);
    }

    hideActionBar() {
        this.elements.actionBarEl?.classList.add('hidden');
    }
}