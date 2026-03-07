export class LobbyFlowCoordinator {
    constructor({
        lobbyManager,
        elements,
        showToast,
        showConfirm,
        openNameModal,
        onSettingsChanged,
    }) {
        this.lobbyManager = lobbyManager;
        this.elements = elements;
        this.showToast = showToast;
        this.showConfirm = showConfirm;
        this.openNameModal = openNameModal;
        this.onSettingsChanged = onSettingsChanged;
    }

    init() {
        this.bindConnectionUI();
        this.bindActions();
        this.ensureAddBotButton();
        this.renderLobby();
    }

    normalizeRoundTimeSeconds(value) {
        const next = Number(value);
        if (!Number.isFinite(next)) return 5;
        return Math.max(2, Math.min(30, Math.round(next)));
    }

    getDraftMatchSettings() {
        const autoResolve = this.elements.lobbyAutoResolveSelect?.value !== 'manual';
        const roundTimeSeconds = this.normalizeRoundTimeSeconds(this.elements.lobbyRoundTimeInput?.value || 5);
        return {
            autoResolve,
            roundTimeMs: roundTimeSeconds * 1000,
        };
    }

    applyRoomSettingsToControls(force = false) {
        const { roomId, gameStarted } = this.lobbyManager;
        const isHost = this.lobbyManager.isHost?.();
        const settings = this.lobbyManager.getRoomSettings?.() || { autoResolve: true, roundTimeMs: 5000 };
        const canEdit = !!(roomId && isHost && !gameStarted);
        const panel = this.elements.lobbyMatchSettings;
        const select = this.elements.lobbyAutoResolveSelect;
        const input = this.elements.lobbyRoundTimeInput;
        const hint = this.elements.lobbyMatchSettingsHint;

        panel?.classList.toggle('hidden', !roomId);

        if (select && (force || document.activeElement !== select)) {
            select.value = settings.autoResolve ? 'auto' : 'manual';
        }
        if (input && (force || document.activeElement !== input)) {
            input.value = String(Math.round((settings.roundTimeMs || 5000) / 1000));
        }

        if (select) select.disabled = !canEdit;
        if (input) input.disabled = !canEdit || !settings.autoResolve;

        if (hint) {
            if (!roomId) {
                hint.textContent = '进入房间后可查看本局结算设置。';
            } else if (canEdit) {
                hint.textContent = settings.autoResolve
                    ? '房主可在开局前配置自动结算与倒计时时长。'
                    : '当前为手动结算，所有玩家点击“结束回合”后才会结算。';
            } else if (isHost && gameStarted) {
                hint.textContent = '对局进行中，结算模式已锁定。';
            } else {
                hint.textContent = settings.autoResolve
                    ? `本局由房主自动结算，倒计时 ${Math.round(settings.roundTimeMs / 1000)} 秒。`
                    : '本局为手动结算，需要所有玩家结束回合。';
            }
        }
    }

    commitRoomSettingsFromControls() {
        const next = this.getDraftMatchSettings();
        const applied = this.lobbyManager.updateRoomSettings?.(next) || next;
        this.onSettingsChanged?.(applied);
        this.applyRoomSettingsToControls(true);
    }

    buildShareUrl(roomId) {
        if (!roomId) return '';
        let origin = window.location.origin;
        const isNgrok = window.location.hostname.endsWith('ngrok-free.dev') || window.location.hostname.endsWith('ngrok.io');

        if (!isNgrok && this.lobbyManager.socket && this.lobbyManager.connected) {
            try {
                const socketUrl = new URL(this.lobbyManager.socket.io.uri);
                if (socketUrl.hostname !== 'localhost' && socketUrl.hostname !== '127.0.0.1') {
                    origin = `${window.location.protocol}//${socketUrl.hostname}:${window.location.port}`;
                }
            } catch (e) {
                console.error('Could not parse socket URL for sharing:', e);
            }
        }

        return `${origin}?room=${roomId}`;
    }

    renderLobby() {
        const {
            playerListEl,
            roomMetaEl,
            roomIdDisplayEl,
            roomLinkDisplayEl,
            shareBtn,
            readyBtn,
            lobbyStatusEl,
        } = this.elements;

        if (playerListEl) {
            playerListEl.innerHTML = '';
            this.lobbyManager.list().forEach((player) => {
                const li = document.createElement('li');
                li.innerHTML = `<span>${player.name}${player.isBot ? ' (虚拟)' : ''}</span><span class="player-status ${player.ready ? 'ready' : ''}">${player.ready ? '已准备' : '未准备'}</span>`;
                playerListEl.appendChild(li);
            });
        }

        const shareUrl = this.buildShareUrl(this.lobbyManager.roomId);
        roomMetaEl?.classList.toggle('hidden', !this.lobbyManager.roomId);
        if (roomIdDisplayEl) roomIdDisplayEl.textContent = this.lobbyManager.roomId ? `房间 ID：${this.lobbyManager.roomId}` : '';
        if (roomLinkDisplayEl) roomLinkDisplayEl.textContent = shareUrl ? `邀请链接：${shareUrl}` : '';

        shareBtn?.toggleAttribute('disabled', !(this.lobbyManager.roomId && this.lobbyManager.connected));
        readyBtn?.toggleAttribute('disabled', !(this.lobbyManager.roomId && this.lobbyManager.connected));

        const self = this.lobbyManager.getSelf?.();
        if (self && readyBtn) {
            readyBtn.textContent = self.ready ? '取消准备' : '准备';
            readyBtn.style.borderColor = self.ready ? '#2ecc71' : '#222';
        }

        const allReady = this.lobbyManager.allReady();
        const isHost = this.lobbyManager.isHost?.();
        const oldBtn = document.getElementById('start-game-btn-active');
        if (oldBtn) oldBtn.remove();

        if (allReady) {
            if (isHost) {
                if (lobbyStatusEl) lobbyStatusEl.textContent = '所有玩家已准备！检查结算设置后即可开始。';
                const btn = document.createElement('button');
                btn.id = 'start-game-btn-active';
                btn.textContent = '开始游戏';
                btn.className = 'interactive';
                btn.style.cssText = 'background-color: #2ecc71; color: white; border: none; margin-left: 10px;';
                btn.onclick = () => {
                    const settings = this.getDraftMatchSettings();
                    const started = this.lobbyManager.startGame?.(settings);
                    if (!started && String(this.lobbyManager.roomId || '').startsWith('local-')) {
                        this.lobbyManager.gameStarted = true;
                        this.lobbyManager.lastSnapshot = null;
                        if (typeof window.startGameFromLobby === 'function') {
                            window.startGameFromLobby({ force: true, settings });
                        }
                    }
                };
                if (readyBtn?.parentNode) {
                    readyBtn.parentNode.insertBefore(btn, readyBtn.nextSibling);
                }
            } else if (lobbyStatusEl) {
                lobbyStatusEl.textContent = '等待房主开始游戏...';
            }
        } else if (lobbyStatusEl) {
            lobbyStatusEl.textContent = this.lobbyManager.connected ? '等待所有玩家准备...' : '未连接，无法开始';
        }

        this.applyRoomSettingsToControls(true);
    }

    bindConnectionUI() {
        const refresh = () => {
            const { connStatus } = this.elements;
            if (!connStatus) return;
            if (this.lobbyManager.connected) {
                connStatus.textContent = `已连接：${this.lobbyManager.socket?.io?.uri || ''}`;
            } else {
                connStatus.textContent = '未连接';
            }
            this.renderLobby();
        };

        this.lobbyManager.subscribe(refresh);
        refresh();
    }

    ensureAddBotButton() {
        const actions = this.elements.lobbyScreen?.querySelector('.lobby-actions');
        if (!actions) return;
        let addBotBtn = document.getElementById('add-bot-btn');
        if (!addBotBtn) {
            addBotBtn = document.createElement('button');
            addBotBtn.id = 'add-bot-btn';
            addBotBtn.className = 'interactive';
            addBotBtn.textContent = '添加虚拟玩家';
            actions.appendChild(addBotBtn);
        }

        const refreshBtn = () => {
            const enable = this.lobbyManager.isHost && this.lobbyManager.isHost();
            addBotBtn.toggleAttribute('disabled', !enable);
        };

        addBotBtn.onclick = () => {
            if (!(this.lobbyManager.isHost && this.lobbyManager.isHost())) {
                this.showToast('只有房主可以添加虚拟玩家');
                return;
            }
            const name = `虚拟玩家${Math.floor(Math.random() * 1000)}`;
            this.lobbyManager.addBot(name);
            this.renderLobby();
        };

        this.lobbyManager.subscribe(refreshBtn);
        refreshBtn();
    }

    bindActions() {
        const {
            startBtn,
            joinToggleBtn,
            joinRoomFormEl,
            joinRoomInput,
            joinRoomConfirmBtn,
            readyBtn,
            shareBtn,
            homeScreen,
            lobbyScreen,
            lobbyAutoResolveSelect,
            lobbyRoundTimeInput,
        } = this.elements;

        startBtn?.addEventListener('click', async () => {
            const goOnlineFlow = (playerName) => {
                this.lobbyManager.createRoom(playerName);
                homeScreen?.classList.add('hidden');
                lobbyScreen?.classList.remove('hidden');
            };

            const goOfflineFlow = (playerName) => {
                const offlineRoomId = `local-${Date.now().toString(36)}`;
                this.lobbyManager.roomId = offlineRoomId;
                this.lobbyManager.serverPlayers = [{ id: 'local-self', name: playerName, ready: true }];
                this.lobbyManager.gameStarted = false;
                this.lobbyManager.roomSettings = this.lobbyManager.getRoomSettings?.() || { autoResolve: true, roundTimeMs: 5000 };
                homeScreen?.classList.add('hidden');
                lobbyScreen?.classList.remove('hidden');
                this.renderLobby();
            };

            const askNameThen = (cb) => this.openNameModal(`玩家${Math.floor(Math.random() * 100)}`, cb, () => { });

            if (this.lobbyManager.connected) {
                askNameThen(goOnlineFlow);
            } else {
                const ok = await this.showConfirm('当前未连接服务器，是否进入离线模式？');
                if (ok) {
                    askNameThen(goOfflineFlow);
                } else {
                    this.showToast('已取消进入，建议检查网络连接');
                }
            }
        });

        joinToggleBtn?.addEventListener('click', () => {
            joinRoomFormEl?.classList.toggle('hidden');
            if (joinRoomFormEl && !joinRoomFormEl.classList.contains('hidden')) {
                setTimeout(() => joinRoomInput?.focus(), 0);
            }
        });

        const submitJoinRoom = () => {
            const nextRoomId = (joinRoomInput?.value || '').trim().toLowerCase();
            if (!nextRoomId) return this.showToast('请输入房间 ID');
            this.openNameModal(`玩家${Math.floor(Math.random() * 100)}`, (playerName) => {
                this.lobbyManager.joinRoom(nextRoomId, playerName);
                homeScreen?.classList.add('hidden');
                lobbyScreen?.classList.remove('hidden');
                joinRoomFormEl?.classList.add('hidden');
            }, () => { });
        };

        joinRoomConfirmBtn?.addEventListener('click', submitJoinRoom);
        joinRoomInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitJoinRoom();
        });

        readyBtn?.addEventListener('click', () => {
            this.lobbyManager.toggleReady();
            const self = this.lobbyManager.getSelf?.();
            if (self && readyBtn) {
                readyBtn.textContent = self.ready ? '取消准备' : '准备';
                readyBtn.style.borderColor = self.ready ? '#2ecc71' : '#222';
            }
        });

        shareBtn?.addEventListener('click', () => {
            if (!(this.lobbyManager.roomId && this.lobbyManager.connected)) {
                return this.showToast('未连接服务器，无法分享房间');
            }

            const url = this.buildShareUrl(this.lobbyManager.roomId);
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(url)
                    .then(() => this.showToast('邀请链接已复制'))
                    .catch(() => this.showToast('复制失败，请手动复制地址栏链接'));
            } else {
                window.prompt('请手动复制此链接:', url);
            }
        });

        lobbyAutoResolveSelect?.addEventListener('change', () => this.commitRoomSettingsFromControls());
        lobbyRoundTimeInput?.addEventListener('change', () => this.commitRoomSettingsFromControls());
        lobbyRoundTimeInput?.addEventListener('blur', () => this.commitRoomSettingsFromControls());
    }
}