import { ACTIONS } from '../core/constants/Actions.js';
import { ActionType } from '../core/enums/ActionType.js';

const DEFAULT_ACTION_KEYS = ['STORE_1', 'ATTACK_1', 'DEFEND_1', 'REBOUND_1', 'ATTACK_2'];

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
        this.pendingResolveRound = null;
        this.pendingRoundStart = null;
        this.lastSocket = null;
    }

    refreshGameViewport() {
        const width = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0, 1);
        const height = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 1);
        const scaleManager = this.phaserGame?.scale;
        const scene = this.phaserGame?.scene?.keys?.GameScene;

        scaleManager?.resize?.(width, height);
        scene?.scale?.resize?.(width, height);
        scene?.cameras?.resize?.(width, height);
    }

    showGameCanvas() {
        this.elements.gameCanvasEl?.classList.remove('game-canvas-hidden');
        this.refreshGameViewport();
        requestAnimationFrame(() => this.refreshGameViewport());
    }

    hideGameCanvas() {
        this.elements.gameCanvasEl?.classList.add('game-canvas-hidden');
    }

    init() {
        window.startGameFromLobby = (options) => this.startGame(options);
        window.returnToLobby = (options) => this.returnToLobby(options);
        window.battleFlow = this;
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
        }, 5000);
    }

    findCorePlayerByRemoteId(remoteId) {
        if (remoteId == null) return null;
        return this.gameCore.players.find((player) => (
            player.networkId === remoteId ||
            String(player.id) === String(remoteId) ||
            player.name === String(remoteId)
        )) || null;
    }

    getLocalPlayer() {
        const players = this.gameCore.players || [];
        if (!players.length) return null;

        const resolvedId = this.resolveLocalPlayerId();
        if (resolvedId != null) {
            const found = players.find((player) => player.id === resolvedId);
            if (found) return found;
        }

        if (!this.isNetworkAuthoritativeMatch()) {
            return players[0] || null;
        }
        return null;
    }

    resolveLocalPlayerId() {
        const players = this.gameCore.players || [];
        if (!players.length) return null;

        const candidates = [];
        if (window.localPlayerId != null) candidates.push(window.localPlayerId);
        if (this.localPlayerId != null) candidates.push(this.localPlayerId);

        const lobbySelf = this.lobbyManager.getSelf?.();
        if (lobbySelf?.id != null) {
            const mapped = players.find((player) => player.networkId === lobbySelf.id);
            if (mapped) {
                this.localPlayerId = mapped.id;
                window.localPlayerId = mapped.id;
                return mapped.id;
            }
        }

        if (this.lobbyManager.playerId != null) {
            const mapped = players.find((player) => player.networkId === this.lobbyManager.playerId);
            if (mapped) {
                this.localPlayerId = mapped.id;
                window.localPlayerId = mapped.id;
                return mapped.id;
            }
        }

        if (this.lobbyManager.playerName) {
            const mapped = players.find((player) => player.name === this.lobbyManager.playerName);
            if (mapped) {
                this.localPlayerId = mapped.id;
                window.localPlayerId = mapped.id;
                return mapped.id;
            }
        }

        for (const id of candidates) {
            const found = players.find((player) => player.id === id);
            if (found) {
                this.localPlayerId = found.id;
                window.localPlayerId = found.id;
                return found.id;
            }
        }

        if (!this.isNetworkAuthoritativeMatch()) {
            const fallback = players[0] || null;
            if (!fallback) return null;
            this.localPlayerId = fallback.id;
            window.localPlayerId = fallback.id;
            return fallback.id;
        }

        return null;
    }

    getActionKeyByPlayer(player) {
        if (!player?.currentAction) return '';
        const { type, level, name } = player.currentAction;
        const entry = Object.entries(ACTIONS).find(([, cfg]) => (
            cfg.type === type && cfg.level === level && cfg.name === name
        ));
        return entry ? entry[0] : '';
    }

    getReadySummary() {
        return this.gameCore.getRoundReadySummary?.() || { readyCount: 0, totalCount: 0, allReady: false, pendingPlayers: [] };
    }

    isNetworkAuthoritativeMatch() {
        return !!this.gameCore.isNetworkAuthoritativeTimer?.();
    }

    applyNetworkRoundStart({ round, autoResolve, roundTimeMs, resolveAt } = {}) {
        this.gameCore.applyMatchSettings?.({ autoResolve, roundTimeMs }, { reschedule: false });
        if (typeof round === 'number') {
            this.gameCore.currentRound = round;
        }
        if (this.gameCore.gameState !== 'ended') {
            this.gameCore.gameState = 'selecting';
            this.gameCore.isRunning = true;
            this.clearPendingAttack();
        }
        this.resolveLocalPlayerId();
        this.gameCore.scheduleResolveTimer?.({ force: true, deadlineAt: resolveAt });
        this.gameCore.nextFrame?.();
    }

    flushPendingRoundStart() {
        if (!this.pendingRoundStart) return;
        const payload = this.pendingRoundStart;
        this.pendingRoundStart = null;
        this.applyNetworkRoundStart(payload);
    }

    canResolveOnHost() {
        return !!(
            this.lobbyManager.isHost?.() &&
            this.gameCore.isRunning &&
            this.gameCore.gameState === 'selecting'
        );
    }

    maybeResolveRound() {
        if (this.isNetworkAuthoritativeMatch()) return;
        if (!this.canResolveOnHost()) return;
        if (!this.getReadySummary().allReady) return;
        this.gameCore.clearResolveTimer?.();
        this.gameCore.processRound?.();
        this.broadcastStateNow();
    }

    setPlayerRoundReady(player, ready, { emit = false } = {}) {
        if (!player) return false;
        const changed = !!player.roundReady !== !!ready;
        player.roundReady = !!ready;
        if (changed) {
            this.gameCore.nextFrame?.();
            this.debugUI?.updateGameState?.();
            if (emit && this.lobbyManager.socket && this.lobbyManager.roomId) {
                this.lobbyManager.socket.emit('setRoundReady', this.lobbyManager.roomId, !!ready);
            }
        }
        return changed;
    }

    clearPendingAttack(playerId = null) {
        const pending = window.pendingAttack;
        if (!pending) return false;
        if (playerId != null && pending.selfId !== playerId) return false;
        window.pendingAttack = null;
        return true;
    }

    ensurePlayerHasAction(player) {
        if (!player) return false;
        if (player.currentAction) return true;
        try {
            player.selectAction('STORE_1', null);
            return true;
        } catch (error) {
            console.warn('[BattleFlow] Failed to auto-select STORE_1:', error);
            return false;
        }
    }

    emitCurrentAction(player) {
        if (!player || !this.lobbyManager.socket || !this.lobbyManager.roomId) return;
        const actionKey = this.getActionKeyByPlayer(player);
        if (!actionKey) return;
        const targetNetworkId = player.target?.networkId ?? player.target?.id ?? null;
        this.lobbyManager.socket.emit('selectAction', this.lobbyManager.roomId, actionKey, targetNetworkId);
    }

    markLocalPlayerActionDirty() {
        const player = this.getLocalPlayer();
        if (!player) return;
        if (!this.gameCore.autoResolveEnabled) {
            this.setPlayerRoundReady(player, false, { emit: true });
        } else {
            this.setPlayerRoundReady(player, false, { emit: false });
            this.gameCore.nextFrame?.();
        }
    }

    finishLocalRound() {
        if (this.gameCore.autoResolveEnabled) return;
        const player = this.getLocalPlayer();
        if (!player || !player.isAlive) return;
        this.clearPendingAttack(player.id);
        if (!this.ensurePlayerHasAction(player)) {
            this.showToast('当前无法结束回合');
            return;
        }

        this.emitCurrentAction(player);
        this.setPlayerRoundReady(player, true, { emit: true });
        this.maybeResolveRound();
    }

    applyRemoteRoundReady(playerId, ready) {
        if (this.gameCore.autoResolveEnabled) return;
        const player = this.findCorePlayerByRemoteId(playerId);
        if (!player) return;
        this.setPlayerRoundReady(player, ready, { emit: false });
        this.maybeResolveRound();
    }

    broadcastStateNow() {
        const core = this.gameCore;
        if (!core || !this.lobbyManager.connected || !this.lobbyManager.roomId || !this.lobbyManager.isHost?.()) return;
        const state = core.getGameState();
        this.lobbyManager.socket.emit('roundResolved', this.lobbyManager.roomId, state);
    }

    bindNetworkSync() {
        const tryBind = () => {
            const sock = this.lobbyManager.socket;
            if (!sock || sock === this.lastSocket) return;

            this.lastSocket = sock;

            sock.off?.('roundResolved');
            sock.on('roundResolved', (state) => {
                if (this.gameCore && (!this.lobbyManager.isHost?.() || !this.gameCore.isRunning)) {
                    this.gameCore.store?.applySnapshot?.(state);
                }
                if ((state?.state || state?.gameState) === 'ended') {
                    this.scheduleReturnToRoom();
                }
                this.pendingResolveRound = null;
            });

            sock.off?.('actionSelected');
            sock.on('actionSelected', ({ playerId, actionKey, targetId }) => {
                if (!this.lobbyManager.isHost?.() || !this.gameCore) return;
                const player = this.findCorePlayerByRemoteId(playerId);
                if (!player) return;

                let target = null;
                if (targetId) {
                    target = this.findCorePlayerByRemoteId(targetId);
                }

                try {
                    player.selectAction(actionKey, target);
                    this.debugUI?.updatePlayerList?.();
                } catch (error) {
                    console.warn('[Host] Failed to sync action:', error);
                }
            });

            sock.off?.('roundStarted');
            sock.on('roundStarted', ({ round, autoResolve, roundTimeMs, resolveAt }) => {
                const payload = { round, autoResolve, roundTimeMs, resolveAt };
                if (!this.gameCore.isRunning || !(this.gameCore.players || []).length) {
                    this.pendingRoundStart = payload;
                    this.gameCore.applyMatchSettings?.({ autoResolve, roundTimeMs }, { reschedule: false });
                    return;
                }
                this.applyNetworkRoundStart(payload);
            });

            sock.off?.('roundResolveRequested');
            sock.on('roundResolveRequested', async ({ round }) => {
                this.gameCore.clearResolveTimer?.();
                if (!this.lobbyManager.isHost?.()) {
                    if (this.gameCore.isRunning && this.gameCore.gameState === 'selecting') {
                        this.gameCore.gameState = 'resolving';
                        this.gameCore.nextFrame?.();
                    }
                    return;
                }

                if (this.pendingResolveRound === round || this.gameCore.gameState === 'resolving') return;
                this.pendingResolveRound = round;
                await this.gameCore.processRound?.();
                this.broadcastStateNow();
            });

            sock.off?.('roundReadyChanged');
            sock.on('roundReadyChanged', ({ playerId, ready }) => {
                this.applyRemoteRoundReady(playerId, ready);
            });

            sock.off?.('gameStarted');
            sock.on('gameStarted', (roomState) => {
                const hasSnapshot = !!(roomState && Object.prototype.hasOwnProperty.call(roomState, 'snapshot'));
                const nextSnapshot = hasSnapshot ? (roomState.snapshot || null) : this.lobbyManager.lastSnapshot;
                this.lobbyManager.gameStarted = true;
                this.lobbyManager.lastSnapshot = nextSnapshot;
                if (roomState?.settings) this.lobbyManager.roomSettings = roomState.settings;
                this.startGame({
                    force: true,
                    snapshot: nextSnapshot,
                    settings: roomState?.settings || this.lobbyManager.getRoomSettings?.(),
                    players: Array.isArray(roomState?.players) ? roomState.players : null,
                });
            });

            sock.off?.('gameEnded');
            sock.on('gameEnded', (reason) => {
                this.lobbyManager.gameStarted = false;
                if (reason) this.showToast(`对局结束：${reason}`);
                this.returnToLobby();
            });
        };

        this.lobbyManager.subscribe(tryBind);
        tryBind();
    }

    applyMatchSettings(settings, { reschedule = false } = {}) {
        this.gameCore.applyMatchSettings?.(settings || this.lobbyManager.getRoomSettings?.(), { reschedule });
        this.debugUI?.syncControlStateFromGame?.();
    }

    cleanupMatchState({ clearLogs = true, clearPlayers = true } = {}) {
        this.clearPendingAttack();
        window.localPlayerId = null;
        this.localPlayerId = null;
        this.pendingRoundStart = null;
        this.clearEndReturnTimer();
        if (clearLogs) this.lobbyManager.lastSnapshot = null;

        if (this.gameSyncIntervalId) {
            clearInterval(this.gameSyncIntervalId);
            this.gameSyncIntervalId = null;
        }

        this.gameCore.invalidateAsyncWork?.();
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
        if (this.isNetworkAuthoritativeMatch()) return;
        if (!this.gameCore?.isRunning || this.gameCore.gameState !== 'selecting') return;
        if (!this.lobbyManager.isHost?.()) {
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
        this.hideGameCanvas();

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
        const canResumeActiveMatch = ['selecting', 'resolving', 'ended'].includes(snapshotState);
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
                this.clearPendingAttack();
                lastRound = this.gameCore.currentRound;
            }

            if (this.gameCore.gameState === 'selecting') {
                this.ensureHostRoundTimer();
                this.showActionBar();
            } else {
                this.hideActionBar();
            }

            if (this.gameCore.gameState === 'ended') {
                this.clearPendingAttack();
                if (!this.endHandled) {
                    this.endHandled = true;
                    this.scheduleReturnToRoom();
                }
            }
        };

        if (this.gameSyncIntervalId) clearInterval(this.gameSyncIntervalId);
        this.gameSyncIntervalId = setInterval(syncUI, 250);
    }

    startGame({ force = false, snapshot = null, settings = null, players = null } = {}) {
        if (!force && !this.lobbyManager.allReady()) return;

        this.clearEndReturnTimer();
        this.endHandled = false;
        const snapshotState = snapshot?.state || snapshot?.gameState || '';
        const resumeSnapshot = snapshot && ['selecting', 'resolving', 'ended'].includes(snapshotState) ? snapshot : null;
        const effectiveSettings = settings || resumeSnapshot?.matchSettings || this.lobbyManager.getRoomSettings?.();

        if (this.phaserGame.scene.isActive('GameScene')) {
            this.phaserGame.scene.stop('GameScene');
        }

        document.getElementById('ui-container')?.classList.add('hidden');
        this.showGameCanvas();

        this.cleanupMatchState({ clearLogs: true, clearPlayers: true });
        this.applyMatchSettings(effectiveSettings, { reschedule: false });

        const lobbyPlayers = Array.isArray(players) && players.length
            ? players
            : this.lobbyManager.list();
        const selfLobby = this.lobbyManager.getSelf?.() || null;
        lobbyPlayers.forEach((player, index) => {
            this.gameCore.addPlayer(player.name, { isBot: !!player.isBot, networkId: player.id });
            const added = this.gameCore.players[index];
            if (selfLobby && player.id === selfLobby.id && added) {
                this.localPlayerId = added.id;
            }
        });

        this.gameCore.startGame();
        if (!this.phaserGame.scene.isActive('GameScene')) {
            try {
                this.phaserGame.scene.start('GameScene');
                this.refreshGameViewport();
                requestAnimationFrame(() => this.refreshGameViewport());
            } catch (error) {
                console.error('[BattleFlow] Failed to start GameScene:', error);
                this.showToast('战斗场景加载失败，已返回房间');
                this.returnToLobby();
                return;
            }
        }

        if (!this.localPlayerId) {
            this.localPlayerId = this.resolveLocalPlayerId() || (this.gameCore.players[0] && this.gameCore.players[0].id) || 1;
        }
        window.localPlayerId = this.localPlayerId;

        if (resumeSnapshot) {
            this.gameCore.store?.applySnapshot?.(resumeSnapshot);
            if (snapshotState === 'ended') {
                this.endHandled = true;
                this.scheduleReturnToRoom();
            }
        } else {
            this.lobbyManager.lastSnapshot = null;
            this.gameCore.store?.updateState?.(this.gameCore.getGameState());
        }

        this.startUiSync();
        this.flushPendingRoundStart();
        this.ensureHostRoundTimer();
        if (!this.isNetworkAuthoritativeMatch()) {
            this.broadcastStateNow();
        }
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
        const summary = this.getReadySummary();
        const readyLabel = `已结束 ${summary.readyCount}/${summary.totalCount}`;
        if (!this.gameCore.autoResolveEnabled) {
            return `${isHost ? '手动结算' : '等待全员结束'} · ${readyLabel}`;
        }

        const remain = this.gameCore.nextResolveAt ? Math.max(0, this.gameCore.nextResolveAt - Date.now()) : 0;
        const secLabel = !this.gameCore.nextResolveAt ? '同步中' : `${Math.ceil(remain / 1000)}s`;
        return `倒计时：${secLabel}`;
    }

    onChooseAction(player, actionKey) {
        if (!player || player.roundReady) return;
        const cfg = ACTIONS[actionKey];
        if (!cfg) return;

        if (cfg.type === ActionType.ATTACK) {
            window.pendingAttack = { selfId: player.id, actionKey };
            this.markLocalPlayerActionDirty();
            this.showActionBar();
            return;
        }

        this.clearPendingAttack(player.id);

        try {
            player.selectAction(actionKey, null);
            this.debugUI?.updatePlayerList?.();
        } catch (error) {
            this.showToast(error.message);
            return;
        }

        this.emitCurrentAction(player);
        this.markLocalPlayerActionDirty();
        this.showActionBar();
    }

    onTargetChosen(targetPlayer) {
        const core = this.gameCore;
        const pending = window.pendingAttack;
        if (!core || !pending) return;

        const me = this.getLocalPlayer();
        const target = core.players.find((player) => player.id === targetPlayer.id);
        if (!me || !target || me.roundReady) return;

        try {
            me.selectAction(pending.actionKey, target);
            this.emitCurrentAction(me);
            this.markLocalPlayerActionDirty();
            this.debugUI?.updatePlayerList?.();
            this.clearPendingAttack(me.id);
            if (typeof window.showToast === 'function') window.showToast(`目标已选择：${target.name}`);
        } catch (error) {
            console.error(error);
            if (typeof window.showToast === 'function') window.showToast(error.message || '选择失败');
        }
    }

    showActionBar() {
        if (!this.gameCore.isRunning || this.gameCore.gameState !== 'selecting') return this.hideActionBar();
        const players = this.gameCore.players || [];
        const me = this.getLocalPlayer();
        if (!me || !me.isAlive) return this.hideActionBar();

        const availability = DEFAULT_ACTION_KEYS.filter((key) => ACTIONS[key]).map((key) => {
            const cfg = ACTIONS[key];
            let can = !me.roundReady && me.energy >= (cfg.energyCost || 0);
            if (cfg.type === ActionType.ATTACK) {
                const hasTarget = players.some((player) => player.id !== me.id && player.isAlive);
                can = can && hasTarget;
            }
            return { key, can };
        });

        const readySummary = this.getReadySummary();
        const sig = JSON.stringify({
            round: this.gameCore.currentRound,
            meId: me.id,
            energy: me.energy,
            autoResolveEnabled: this.gameCore.autoResolveEnabled,
            nextResolveAt: this.gameCore.nextResolveAt,
            meReady: !!me.roundReady,
            pendingAttack: window.pendingAttack?.actionKey || '',
            readySummary,
            players: players.map((player) => ({ id: player.id, ready: !!player.roundReady })),
            availability,
        });
        const isHost = this.lobbyManager.isHost?.();
        const actionBarEl = this.elements.actionBarEl;

        if (actionBarEl.dataset && actionBarEl.dataset.sig === sig && !actionBarEl.classList.contains('hidden')) {
            const header = document.getElementById('action-bar-header');
            const statusEl = document.getElementById('action-bar-status');
            const readySummaryEl = document.getElementById('action-ready-summary');
            const finishBtn = document.getElementById('action-finish-round-btn');
            if (header) {
                header.textContent = `回合 ${this.gameCore.currentRound} · 状态：选择阶段 · ${this.getActionHeaderLabel(isHost)}`;
            }
            if (statusEl) {
                statusEl.textContent = `我：生命 ${me.health} 气 ${me.energy} · 已选：${this.getSelectedActionLabel(me)}${me.roundReady ? ' · 已结束回合' : ''}`;
            }
            if (readySummaryEl && !this.gameCore.autoResolveEnabled) {
                const pendingNames = readySummary.pendingPlayers.map((player) => player.name).join('、');
                readySummaryEl.textContent = readySummary.allReady
                    ? '所有玩家都已结束回合。'
                    : `等待：${pendingNames || '无'}`;
            }
            if (finishBtn && !this.gameCore.autoResolveEnabled) {
                finishBtn.textContent = me.roundReady ? '已结束回合' : '结束回合';
                finishBtn.disabled = !!me.roundReady;
                finishBtn.className = `action-round-btn${me.roundReady ? ' done' : ''}`;
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
        statusEl.textContent = `我：生命 ${me.health} 气 ${me.energy} · 已选：${this.getSelectedActionLabel(me)}${me.roundReady ? ' · 已结束回合' : ''}`;
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
            btn.disabled = !can;
            if (can) {
                btn.onclick = () => this.onChooseAction(me, key);
            }
            buttonRow.appendChild(btn);
        });
        actionBarEl.appendChild(buttonRow);

        if (!this.gameCore.autoResolveEnabled) {
            const controls = document.createElement('div');
            controls.className = 'action-bar-controls';

            const readySummaryEl = document.createElement('div');
            readySummaryEl.id = 'action-ready-summary';
            readySummaryEl.className = 'action-ready-summary';
            const pendingNames = readySummary.pendingPlayers.map((player) => player.name).join('、');
            readySummaryEl.textContent = readySummary.allReady
                ? '所有玩家都已结束回合。'
                : `等待：${pendingNames || '无'}`;
            controls.appendChild(readySummaryEl);

            const finishBtn = document.createElement('button');
            finishBtn.id = 'action-finish-round-btn';
            finishBtn.className = `action-round-btn${me.roundReady ? ' done' : ''}`;
            finishBtn.textContent = me.roundReady ? '已结束回合' : '结束回合';
            finishBtn.disabled = !!me.roundReady;
            finishBtn.onclick = () => this.finishLocalRound();
            controls.appendChild(finishBtn);

            actionBarEl.appendChild(controls);
        }
    }

    hideActionBar() {
        this.elements.actionBarEl?.classList.add('hidden');
    }
}