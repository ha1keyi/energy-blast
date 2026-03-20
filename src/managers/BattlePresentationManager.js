import { BattleAnimationManager } from './RoundResolutionManager.js';
import { BattleLayoutManager } from './BattleLayoutManager.js';

function setAbsolutePosition(element, { x, y, width, height }) {
    if (!element) return;
    if (x != null) element.style.left = `${Math.round(x)}px`;
    if (y != null) element.style.top = `${Math.round(y)}px`;
    if (width != null) element.style.width = `${Math.round(width)}px`;
    if (height != null) element.style.height = `${Math.round(height)}px`;
}

function toggleHidden(element, hidden) {
    if (!element) return;
    element.classList.toggle('hidden', !!hidden);
}

export class BattlePresentationManager {
    constructor(core, scene, options = {}) {
        this.core = core;
        this.scene = scene;
        this.layoutManager = options.layoutManager || new BattleLayoutManager(scene);
        this.onChooseTarget = options.onChooseTarget || (() => { });
        this.onReturnLobby = options.onReturnLobby || (() => { });
        this.animationManager = new BattleAnimationManager(core, scene);
        this._disposed = false;
        this._logSignature = '';
        this._hudSignature = '';
        this._endSignature = '';

        this.ensureOverlayElements();

        this.unsubscribeStore = this.core?.store?.subscribe?.(() => {
            if (this._disposed || !this.scene?.sys?.isActive?.()) return;
            this.refresh();
        }) || null;
    }

    ensureOverlayElements() {
        const uiLayer = document.getElementById('ui-layer') || document.body;

        let overlay = document.getElementById('battle-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'battle-overlay';
            overlay.className = 'hidden';
            overlay.innerHTML = [
                '<div id="battle-hud"></div>',
                '<div id="battle-pending-hint" class="hidden"></div>',
                '<div id="battle-log-panel"></div>',
                '<div id="battle-end-screen" class="hidden"></div>',
            ].join('');
            uiLayer.appendChild(overlay);
        }

        this.overlay = overlay;
        this.hudRoot = overlay.querySelector('#battle-hud');
        this.pendingHintEl = overlay.querySelector('#battle-pending-hint');
        this.logRoot = overlay.querySelector('#battle-log-panel');
        this.endScreenEl = overlay.querySelector('#battle-end-screen');
    }

    ensureAnimationManager() {
        const needsRecreate = !this.animationManager || this.animationManager._active === false || this.animationManager.scene !== this.scene;
        if (!needsRecreate) return;

        this.animationManager = new BattleAnimationManager(this.core, this.scene);
        if (this.core) {
            this.core.battleAnimationManager = this.animationManager;
        }
    }

    refresh() {
        if (this._disposed) return;
        this.ensureAnimationManager();
        toggleHidden(this.overlay, false);
        this.refreshHUD();
        this.refreshPendingHint();
        this.refreshBattleLogPanel();
        this.animationManager.refresh();
        this.refreshEndScreen();
    }

    reset() {
        if (this._disposed) return;
        this.animationManager.reset();
        this._logSignature = '';
        this._hudSignature = '';
        this._endSignature = '';
        this.clearHud();
        if (this.logRoot) this.logRoot.innerHTML = '';
        if (this.pendingHintEl) {
            this.pendingHintEl.textContent = '';
            toggleHidden(this.pendingHintEl, true);
        }
        this.hideEndScreen();
    }

    refreshPendingHint() {
        const position = this.layoutManager.getPendingHintPosition();
        setAbsolutePosition(this.pendingHintEl, position);
        if (this.pendingHintEl) {
            this.pendingHintEl.textContent = '请选择攻击目标...';
        }
        toggleHidden(this.pendingHintEl, !(window.pendingAttack && this.core?.gameState === 'selecting'));
    }

    refreshHUD() {
        if (!this.core || !this.hudRoot) return;
        const players = this.core.players || [];
        const localPlayerId = window.localPlayerId || players[0]?.id || null;
        const others = players.filter((player) => player.id !== localPlayerId);
        const metrics = this.layoutManager.getMetrics();

        const signature = JSON.stringify({
            round: this.core.currentRound,
            state: this.core.gameState,
            players: players.map((player) => ({
                id: player.id,
                networkId: player.networkId,
                name: player.name,
                health: player.health,
                energy: player.energy,
                alive: player.isAlive,
            })),
            size: { width: metrics.width, height: metrics.height },
            localPlayerId,
        });
        if (signature === this._hudSignature) return;
        this._hudSignature = signature;

        this.clearHud();
        if (!players.length) return;

        const positions = this.layoutManager.getOpponentPositions(others.length);
        others.forEach((player, index) => {
            const position = positions[index];
            if (!position) return;
            this.hudRoot.appendChild(this.buildOpponentHud(player, position));
        });
    }

    buildOpponentHud(player, position) {
        const card = document.createElement('button');
        const alignClass = position.align === 1 ? 'align-right' : (position.align === 0.5 ? 'align-center' : 'align-left');
        card.type = 'button';
        card.className = `battle-card battle-opponent-card interactive ${alignClass}`;
        setAbsolutePosition(card, position);

        const title = document.createElement('div');
        title.className = 'battle-card-title';
        title.textContent = player.name;

        const stats = document.createElement('div');
        stats.className = 'battle-card-stats';

        const hp = document.createElement('span');
        hp.className = player.health <= 0 ? 'danger' : '';
        hp.textContent = `❤ ${player.health}`;

        const energy = document.createElement('span');
        energy.textContent = `气 ${player.energy}`;

        stats.append(hp, energy);
        card.append(title, stats);
        card.onclick = () => this.onChooseTarget(player);
        return card;
    }

    clearHud() {
        if (this.hudRoot) this.hudRoot.innerHTML = '';
    }

    refreshBattleLogPanel() {
        if (this._disposed || !this.core || !this.logRoot) return;

        const logs = Array.isArray(this.core.logs) ? this.core.logs : [];
        const bounds = this.layoutManager.getBattleLogPanelBounds();
        const compact = this.layoutManager.getMetrics().compact;
        const maxLines = compact ? 4 : Math.max(4, Math.floor((bounds.height - 38) / 22));
        const recent = logs.slice(-maxLines).map((entry) => {
            const hasRound = entry && typeof entry === 'object' && entry.round != null;
            const round = hasRound ? entry.round : '';
            const message = (entry && typeof entry === 'object' && entry.message != null)
                ? String(entry.message)
                : String(entry);
            return round === '' ? message : `R${round}: ${message}`;
        });

        const signature = JSON.stringify({ bounds, compact, state: this.core.gameState, recent });
        if (signature === this._logSignature) return;
        this._logSignature = signature;

        this.logRoot.innerHTML = '';

        const shell = document.createElement('div');
        shell.className = 'battle-log-shell';
        setAbsolutePosition(shell, bounds);

        const header = document.createElement('div');
        header.className = 'battle-log-header';

        const title = document.createElement('div');
        title.className = 'battle-log-title';
        title.textContent = compact ? '本回合记录' : '战斗日志';

        const hint = document.createElement('div');
        hint.className = 'battle-log-state';
        hint.textContent = this.describeState();

        header.append(title, hint);
        shell.appendChild(header);

        if (!recent.length) {
            const empty = document.createElement('div');
            empty.className = 'battle-log-empty';
            empty.textContent = '等待玩家选择行动...';
            shell.appendChild(empty);
        } else {
            recent.forEach((lineText, index) => {
                const row = document.createElement('div');
                row.className = `battle-log-row${index % 2 === 0 ? ' alt' : ''}`;
                row.textContent = lineText;
                shell.appendChild(row);
            });
        }

        this.logRoot.appendChild(shell);
    }

    refreshEndScreen() {
        if (!this.core || this._disposed || !this.endScreenEl) return;

        if (this.core.gameState !== 'ended') {
            this.hideEndScreen();
            return;
        }

        const alivePlayers = this.core.getAlivePlayers();
        const winner = alivePlayers[0] || null;
        const box = this.layoutManager.getEndScreenBox();
        const signature = JSON.stringify({
            state: this.core.gameState,
            winner: winner?.id || null,
            title: alivePlayers.length === 1 ? '胜 负 已 分' : '同 归 于 尽',
            box,
        });
        if (signature === this._endSignature && !this.endScreenEl.classList.contains('hidden')) return;
        this._endSignature = signature;

        this.endScreenEl.innerHTML = '';
        toggleHidden(this.endScreenEl, false);

        const overlay = document.createElement('div');
        overlay.className = 'battle-end-overlay';

        const card = document.createElement('div');
        card.className = 'battle-end-card';
        setAbsolutePosition(card, box);

        const title = document.createElement('div');
        title.className = 'battle-end-title';
        title.textContent = alivePlayers.length === 1 ? '胜 负 已 分' : '同 归 于 尽';

        const result = document.createElement('div');
        result.className = 'battle-end-result';
        result.textContent = winner ? `获胜者: ${winner.name}` : '没有活下来的玩家';

        const hint = document.createElement('div');
        hint.className = 'battle-end-hint';
        hint.textContent = '5 秒后自动返回房间';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'battle-end-action interactive';
        button.textContent = '返回房间';
        button.onclick = () => this.onReturnLobby();

        card.append(title, result, hint);
        this.endScreenEl.append(overlay, card, button);
    }

    hideEndScreen() {
        if (!this.endScreenEl) return;
        this.endScreenEl.innerHTML = '';
        toggleHidden(this.endScreenEl, true);
        this._endSignature = '';
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
        this.unsubscribeStore?.();
        this.unsubscribeStore = null;
        this.hideEndScreen();
        this.animationManager.cleanup();
        this.clearHud();
        if (this.logRoot) this.logRoot.innerHTML = '';
        if (this.pendingHintEl) {
            this.pendingHintEl.textContent = '';
            toggleHidden(this.pendingHintEl, true);
        }
        toggleHidden(this.overlay, true);
        this.overlay = null;
        this.hudRoot = null;
        this.pendingHintEl = null;
        this.logRoot = null;
        this.endScreenEl = null;
        this._logSignature = '';
        this._hudSignature = '';
        this._endSignature = '';
    }
}