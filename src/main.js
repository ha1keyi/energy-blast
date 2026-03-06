import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene.js';
import { Game } from './core/Game.js';
import { ACTIONS } from './core/constants/Actions.js';
import { ActionType } from './core/enums/ActionType.js';
import { DebugUIManager } from './managers/DebugUIManager.js';
import { LobbyManager } from './managers/LobbyManager.js';
import './style.css';

// 早期 UI 助手垫片，防止在完整初始化前调用到不受支持的 alert/confirm
if (typeof window !== 'undefined') {
  if (!window.showToast) window.showToast = (msg) => console.warn('[toast]', msg);
  if (!window.showConfirm) window.showConfirm = (msg) => Promise.resolve(false);
}

// Connect to the server
LobbyManager.connect();

// 附加网络同步监听
(function setupNetworkSync() {
  let lastBroadcast = { round: 0, state: '', logs: 0 };
  let lastBroadcastAt = 0;

  // 当 socket 可用时绑定一次
  const tryBind = () => {
    const sock = LobbyManager.socket;
    if (!sock) return;
    // 非房主：收到服务器转发的结算结果，应用到本地 game
    sock.off && sock.off('roundResolved');
    sock.on('roundResolved', (state) => {
      if (!LobbyManager.isHost() && window.game) {
        const core = window.game;
        if (core.store && typeof core.store.applySnapshot === 'function') {
          core.store.applySnapshot(state);
        } else {
          // Fallback legacy path
          const snapshot = state || {};
          core.currentRound = snapshot.round ?? core.currentRound;
          core.gameState = snapshot.state || snapshot.gameState || core.gameState;
          if (Array.isArray(snapshot.logs)) core.logs = snapshot.logs.slice();
          const byName = new Map(core.players.map(pl => [pl.name, pl]));
          (snapshot.players || []).forEach(sp => {
            let lp = byName.get(sp.name);
            if (!lp) {
              try { core.addPlayer(sp.name); lp = core.players.find(p => p.name === sp.name); } catch (_) { }
            }
            if (lp) {
              if (typeof sp.health === 'number') lp.health = sp.health;
              if (typeof sp.energy === 'number') lp.energy = sp.energy;
              if (typeof sp.isAlive === 'boolean') lp.isAlive = sp.isAlive;
            }
          });
          if (window.debugUI && typeof window.debugUI.updateGameState === 'function') {
            window.debugUI.updateGameState();
          }
        }
      }
    });

    sock.off && sock.off('actionSelected');
    sock.on('actionSelected', ({ playerId, actionKey, targetId }) => {
      if (LobbyManager.isHost() && window.game) {
        const core = window.game;
        const player = findCorePlayerByRemoteId(core, playerId);
        if (player) {
          let target = null;
          if (targetId) {
            target = findCorePlayerByRemoteId(core, targetId);
          }
          try {
            player.selectAction(actionKey, target);
            console.log(`[Host] Synced action for ${player.name}: ${actionKey} -> ${target?.name}`);
            if (window.debugUI && typeof window.debugUI.updatePlayerList === 'function') {
              window.debugUI.updatePlayerList();
            }
          } catch (e) {
            console.warn('[Host] Failed to sync action:', e);
          }
        }
      }
    });

    sock.off && sock.off('gameEnded');
    sock.on('gameEnded', (reason) => {
      if (typeof window.showToast === 'function' && reason) {
        window.showToast(`对局结束：${reason}`);
      }
      if (typeof window.returnToLobby === 'function') {
        window.returnToLobby();
      }
    });

    // 所有客户端：收到服务端开局事件后进入游戏
    sock.off && sock.off('gameStarted');
    sock.on('gameStarted', () => {
      if (typeof window.startGameFromLobby === 'function') {
        window.startGameFromLobby({ force: true });
      }
    });

    // 收到再来一局通知
    sock.off && sock.off('rematchStarted');
    sock.on('rematchStarted', () => {
      clearEndReturnTimer();
      if (window.game) {
        window.game.isRunning = false;
        window.game.gameState = 'idle';
        window.game.currentRound = 0;
        window.game.logs = [];
        if (window.game.store) window.game.store.clearLogs();
      }
      if (typeof window.returnToLobby === 'function') {
        window.returnToLobby();
      }
    });
  };
  LobbyManager.subscribe(tryBind);
  tryBind();

  // 房主：定期广播状态变化（最小化方案）
  const broadcastTick = () => {
    const core = window.game;
    if (!core || !LobbyManager.connected || !LobbyManager.roomId || !LobbyManager.isHost()) return;
    const snap = { round: core.currentRound, state: core.gameState, logs: core.logs?.length || 0 };
    const shouldHeartbeat = (Date.now() - lastBroadcastAt) > 1200;
    if (snap.round !== lastBroadcast.round || snap.state !== lastBroadcast.state || snap.logs !== lastBroadcast.logs || shouldHeartbeat) {
      // broadcast minimal snapshot to others
      LobbyManager.socket.emit('roundResolved', LobbyManager.roomId, core.getGameState ? core.getGameState() : {
        round: core.currentRound,
        state: core.gameState,
        logs: core.logs || [],
        players: core.players.map(p => ({ id: p.id, name: p.name, health: p.health, energy: p.energy, isAlive: p.isAlive }))
      });
      lastBroadcast = snap;
      lastBroadcastAt = Date.now();
    }
  };
  setInterval(broadcastTick, 400);
})();

// Core game instance shared across scenes
const gameCore = new Game();
const debugUI = new DebugUIManager(gameCore);
gameCore.setDebugUIManager(debugUI);
debugUI.startUpdating();
window.debugUI = debugUI;
window.game = gameCore;
window.lobby = LobbyManager; // back-compat for debug panel

const DPR = Math.max(1, window.devicePixelRatio || 1);
const config = {
  // Force Canvas renderer to avoid WebGL framebuffer issues on some devices
  type: Phaser.CANVAS,
  parent: 'game-canvas',
  transparent: true, // canvas sits under DOM UI
  backgroundColor: '#00000000', // fully transparent
  // Render crisp: match device resolution, disable smoothing
  resolution: DPR,
  render: { antialias: true, pixelArt: false, roundPixels: false },
  // Let canvas always match container size (no CSS scaling)
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } }
};

const phaserGame = new Phaser.Game(config);
window.phaserGame = phaserGame;
// Register GameScene but do not start automatically
phaserGame.scene.add('GameScene', GameScene, false);
console.log('Energy Blast initialized (hybrid UI + Phaser canvas)!');

// Restore DOM-driven Home/Lobby over the canvas
const homeScreen = document.getElementById('home-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const startBtn = document.getElementById('start-game-btn');
const joinToggleBtn = document.getElementById('join-room-toggle-btn');
const joinRoomFormEl = document.getElementById('join-room-form');
const joinRoomInput = document.getElementById('join-room-input');
const joinRoomConfirmBtn = document.getElementById('join-room-confirm-btn');
const readyBtn = document.getElementById('ready-btn');
const shareBtn = document.getElementById('share-link-btn');
const connStatus = document.getElementById('connection-status');
const playerListEl = document.getElementById('player-list');
const lobbyStatusEl = document.getElementById('lobby-status');
const roomMetaEl = document.getElementById('room-meta');
const roomIdDisplayEl = document.getElementById('room-id-display');
const roomLinkDisplayEl = document.getElementById('room-link-display');
const actionBarEl = document.getElementById('action-bar');
const gameCanvasEl = document.getElementById('game-canvas');

// Default to lobby/home first; game canvas is shown only while a match is running.
gameCanvasEl?.classList.add('hidden');

// 动态添加“添加虚拟玩家”按钮
(function ensureAddBotButton() {
  const actions = lobbyScreen?.querySelector('.lobby-actions');
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
    // 只有房主可以添加虚拟玩家
    const enable = LobbyManager.isHost && LobbyManager.isHost();
    addBotBtn.toggleAttribute('disabled', !enable);
  };
  addBotBtn.onclick = () => {
    if (!(LobbyManager.isHost && LobbyManager.isHost())) {
      (window.showToast || alert)('只有房主可以添加虚拟玩家');
      return;
    }
    const n = `虚拟玩家${Math.floor(Math.random() * 1000)}`;
    LobbyManager.addBot(n); // 本地只加到 Lobby，不发到服务器
    renderLobby();
  };
  // 动态根据房主状态更新
  LobbyManager.subscribe(refreshBtn);
  refreshBtn();
})();

// 名字输入弹窗元素
const nameModal = document.getElementById('name-modal');
const nameInput = document.getElementById('player-name-input');
const nameConfirmBtn = document.getElementById('name-confirm-btn');
const nameCancelBtn = document.getElementById('name-cancel-btn');

function openNameModal(defaultName = `玩家${Math.floor(Math.random() * 100)}`, onConfirm, onCancel) {
  if (!nameModal || !nameInput || !nameConfirmBtn || !nameCancelBtn) {
    console.warn('Name modal elements missing');
    onConfirm?.(defaultName);
    return;
  }
  nameInput.value = defaultName;
  nameModal.classList.remove('hidden');
  nameModal.style.display = 'flex';

  const cleanup = () => {
    nameModal.classList.add('hidden');
    nameModal.style.display = '';
    nameConfirmBtn.onclick = null;
    nameCancelBtn.onclick = null;
    nameInput.onkeydown = null;
  };

  nameConfirmBtn.onclick = () => {
    const val = (nameInput.value || '').trim() || defaultName;
    cleanup();
    onConfirm?.(val);
  };
  nameCancelBtn.onclick = () => {
    cleanup();
    onCancel?.();
  };
  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter') nameConfirmBtn.click();
    if (e.key === 'Escape') nameCancelBtn.click();
  };

  // 聚焦输入框
  setTimeout(() => { nameInput.focus(); nameInput.select(); }, 0);
}
let localPlayerId = 1; // assume host is player 1 in this demo
let gameSyncIntervalId = null;
let endHandled = false;
let endReturnTimerId = null;

function clearEndReturnTimer() {
  if (endReturnTimerId) {
    clearTimeout(endReturnTimerId);
    endReturnTimerId = null;
  }
}

function scheduleReturnToRoom() {
  if (endReturnTimerId) return;
  endReturnTimerId = setTimeout(() => {
    endReturnTimerId = null;
    if (gameCore.gameState === 'ended' && typeof window.returnToLobby === 'function') {
      window.returnToLobby();
    }
  }, 2200);
}

function findCorePlayerByRemoteId(core, remoteId) {
  if (!core || remoteId == null) return null;
  return core.players.find(p => p.networkId === remoteId || String(p.id) === String(remoteId) || p.name === String(remoteId)) || null;
}

function getSelectedActionLabel(player) {
  if (!player) return '未选择';
  if (window.pendingAttack && window.pendingAttack.selfId === player.id) {
    const pendingCfg = ACTIONS[window.pendingAttack.actionKey];
    return pendingCfg ? `${pendingCfg.name} (待选目标)` : '攻击 (待选目标)';
  }
  if (!player.currentAction) return '未选择';
  const targetSuffix = player.target?.name ? ` -> ${player.target.name}` : '';
  return `${player.currentAction.name}${targetSuffix}`;
}

function buildShareUrl(roomId) {
  if (!roomId) return '';
  let origin = location.origin;
  const isNgrok = location.hostname.endsWith('ngrok-free.dev') || location.hostname.endsWith('ngrok.io');

  if (!isNgrok && LobbyManager.socket && LobbyManager.connected) {
    try {
      const socketUrl = new URL(LobbyManager.socket.io.uri);
      if (socketUrl.hostname !== 'localhost' && socketUrl.hostname !== '127.0.0.1') {
        origin = `${location.protocol}//${socketUrl.hostname}:${location.port}`;
      }
    } catch (e) {
      console.error('Could not parse socket URL for sharing:', e);
    }
  }

  return `${origin}?room=${roomId}`;
}

function ensureHostRoundTimer() {
  if (!gameCore?.isRunning || gameCore.gameState !== 'selecting') return;
  const isHost = LobbyManager.isHost && LobbyManager.isHost();
  if (!isHost) {
    gameCore.clearTimer?.();
    gameCore.nextResolveAt = null;
    return;
  }
  if (gameCore.timer || !debugUI?.isAutoResolve) return;
  gameCore.nextResolveAt = Date.now() + (gameCore.roundTime || 5000);
  gameCore.timer = setTimeout(async () => {
    await gameCore.processRound();
  }, gameCore.roundTime || 5000);
}

function returnToLobby({ resetRoom = false } = {}) {
  window.pendingAttack = null;
  endHandled = false;
  clearEndReturnTimer();
  LobbyManager.gameStarted = false;

  if (gameSyncIntervalId) {
    clearInterval(gameSyncIntervalId);
    gameSyncIntervalId = null;
  }

  if (window.phaserGame && window.phaserGame.scene.isActive('GameScene')) {
    window.phaserGame.scene.stop('GameScene');
  }

  gameCore.clearTimer?.();
  gameCore.isRunning = false;
  gameCore.gameState = 'idle';
  gameCore.nextResolveAt = null;
  hideActionBar();
  if (gameCanvasEl) gameCanvasEl.classList.add('hidden');

  if (resetRoom) {
    LobbyManager.roomId = null;
    LobbyManager.clearSession?.();
    LobbyManager.reset();
  }

  document.getElementById('ui-container')?.classList.remove('hidden');
  homeScreen?.classList.add('hidden');
  lobbyScreen?.classList.remove('hidden');

  renderLobby();
}

window.returnToLobby = returnToLobby;

// Map image filenames to resolved URLs via Vite asset pipeline
const imageModules = import.meta.glob('./assets/images/*.jpg', { eager: true });
const imageMap = {};
for (const path in imageModules) {
  const mod = imageModules[path];
  const url = mod?.default || mod;
  const name = path.split('/').pop();
  imageMap[name] = url;
}

function showActionBar() {
  if (!gameCore.isRunning || gameCore.gameState !== 'selecting') return hideActionBar();
  const players = gameCore.players || [];
  const selfId = window.localPlayerId || (players[0]?.id);
  const me = players.find(p => p.id === selfId);
  if (!me || !me.isAlive) return hideActionBar();

  // Build availability signature to avoid unnecessary DOM rebuilds
  const keys = ['STORE_1', 'ATTACK_1', 'DEFEND_1', 'REBOUND_1', 'ATTACK_2'].filter(k => ACTIONS[k]);
  const availability = keys.map(k => {
    const cfg = ACTIONS[k];
    let can = me.energy >= (cfg.energyCost || 0);
    if (cfg.type === ActionType.ATTACK) {
      const hasTarget = gameCore.players.some(p => p.id !== me.id && p.isAlive);
      can = can && hasTarget;
    }
    return { k, can };
  });
  const sig = JSON.stringify({ round: gameCore.currentRound, meId: me.id, energy: me.energy, availability });
  if (actionBarEl.dataset && actionBarEl.dataset.sig === sig && !actionBarEl.classList.contains('hidden')) {
    // Signature unchanged: keep existing buttons, prevent hover/active animation from being retriggered by rebuilds
    // 更新倒计时与状态文本（无需重建按钮）
    const header = document.getElementById('action-bar-header');
    const statusEl = document.getElementById('action-bar-status');
    const remain = (gameCore.nextResolveAt ? Math.max(0, gameCore.nextResolveAt - Date.now()) : 0);
    const sec = Math.ceil(remain / 1000);
    if (header) {
      header.textContent = `回合 ${gameCore.currentRound} · 状态：选择阶段 · 倒计时：${sec}s`;
    }
    if (statusEl) {
      statusEl.textContent = `我：生命 ${me.health} 气 ${me.energy} · Selected: ${getSelectedActionLabel(me)}`;
    }
    return;
  }
  if (actionBarEl.dataset) actionBarEl.dataset.sig = sig; else actionBarEl.setAttribute('data-sig', sig);

  actionBarEl.classList.remove('hidden');
  // Rebuild buttons only when signature changes
  actionBarEl.innerHTML = '';

  // 顶部状态与倒计时（采用与动作卡片相似的风格）
  const header = document.createElement('div');
  header.id = 'action-bar-header';
  header.className = 'action-bar-header';
  const remain = (gameCore.nextResolveAt ? Math.max(0, gameCore.nextResolveAt - Date.now()) : 0);
  const sec = Math.ceil(remain / 1000);
  header.textContent = `回合 ${gameCore.currentRound} · 状态：选择阶段 · 倒计时：${sec}s`;
  actionBarEl.appendChild(header);

  // 我的状态与已选动作（风格与对手图案相同）
  const statusEl = document.createElement('div');
  statusEl.id = 'action-bar-status';
  statusEl.className = 'action-bar-status';
  statusEl.textContent = `我：生命 ${me.health} 气 ${me.energy} · Selected: ${getSelectedActionLabel(me)}`;
  actionBarEl.appendChild(statusEl);

  // 操作按钮行，横向排列并居中
  const buttonRow = document.createElement('div');
  buttonRow.className = 'action-buttons';

  availability.forEach(({ k, can }) => {
    const cfg = ACTIONS[k];
    const btn = document.createElement('button');
    btn.className = 'action-btn' + (can ? '' : ' disabled');
    const imgName = k.toLowerCase() + '.jpg';
    const imgSrc = imageMap[imgName] || '';
    // 按钮内展示动作名与耗气要求、已选择提示
    const chosen = (me.currentAction && me.currentAction.name === cfg.name);
    btn.innerHTML = `<img alt="${cfg.name}" src="${imgSrc}"/><span>${cfg.name}</span><em class="energy">耗气:${cfg.energyCost}</em>`;
    if (can) {
      btn.onclick = () => onChooseAction(me, k);
    }
    buttonRow.appendChild(btn);
  });

  actionBarEl.appendChild(buttonRow);

  // 移除“立即结算”按钮：玩家不应控制其他玩家的结算时机
}

function hideActionBar() {
  actionBarEl.classList.add('hidden');
}

// Toast & Confirm helpers
function showToast(message, duration = 1600) {
  const el = document.getElementById('toast');
  if (!el) { console.warn('[toast]', message); return; }
  el.textContent = message;
  el.classList.remove('hidden');
  el.style.opacity = '0';
  el.style.transition = 'opacity .2s ease';
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.classList.add('hidden'), 220);
  }, duration);
}

function showConfirm(message) {
  const modal = document.getElementById('confirm-modal');
  const msg = document.getElementById('confirm-message');
  const ok = document.getElementById('confirm-ok-btn');
  const cancel = document.getElementById('confirm-cancel-btn');
  if (!modal || !msg || !ok || !cancel) return Promise.resolve(false);
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  msg.textContent = message;
  return new Promise((resolve) => {
    const cleanup = () => {
      modal.classList.add('hidden');
      modal.style.display = '';
      ok.onclick = null; cancel.onclick = null;
    };
    ok.onclick = () => { cleanup(); resolve(true); };
    cancel.onclick = () => { cleanup(); resolve(false); };
  });
}
// 将助手暴露到全局，供 DebugUIManager 等模块调用
window.showToast = showToast;
window.showConfirm = showConfirm;

function onChooseAction(player, actionKey) {
  const cfg = ACTIONS[actionKey];
  if (cfg.type === ActionType.ATTACK) {
    window.pendingAttack = { selfId: player.id, actionKey };
    showActionBar();
  } else {
    // 将行动选择同步到本地核心（保证倒计时栏能显示“已选”）并广播到服务器
    try {
      player.selectAction(actionKey, null);
      debugUI.updatePlayerList();
    } catch (e) { showToast(e.message); }
    LobbyManager.socket.emit('selectAction', LobbyManager.roomId, actionKey, null);
    showActionBar();
  }
}

function renderLobby() {
  playerListEl.innerHTML = '';
  LobbyManager.list().forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p.name}${p.isBot ? ' (虚拟)' : ''}</span><span class="player-status ${p.ready ? 'ready' : ''}">${p.ready ? '已准备' : '未准备'}</span>`;
    playerListEl.appendChild(li);
  });
  const shareUrl = buildShareUrl(LobbyManager.roomId);
  roomMetaEl?.classList.toggle('hidden', !LobbyManager.roomId);
  if (roomIdDisplayEl) roomIdDisplayEl.textContent = LobbyManager.roomId ? `房间 ID：${LobbyManager.roomId}` : '';
  if (roomLinkDisplayEl) roomLinkDisplayEl.textContent = shareUrl ? `邀请链接：${shareUrl}` : '';
  // 按钮状态：仅在已连接且在房间内时可用
  shareBtn?.toggleAttribute('disabled', !(LobbyManager.roomId && LobbyManager.connected));
  readyBtn?.toggleAttribute('disabled', !(LobbyManager.roomId && LobbyManager.connected));
  const self = LobbyManager.getSelf?.();
  if (self && readyBtn) {
    readyBtn.textContent = self.ready ? '取消准备' : '准备';
    readyBtn.style.borderColor = self.ready ? '#2ecc71' : '#222';
  }

  const allReady = LobbyManager.allReady();
  const isHost = LobbyManager.isHost && LobbyManager.isHost();

  // 清除旧的动态按钮（防止重复或状态不一致）
  const oldBtn = document.getElementById('start-game-btn-active');
  if (oldBtn) oldBtn.remove();

  if (allReady) {
    if (isHost) {
      lobbyStatusEl.textContent = '所有玩家已准备！等待房主开始...';
      // 创建“开始游戏”按钮
      const btn = document.createElement('button');
      btn.id = 'start-game-btn-active';
      btn.textContent = '开始游戏';
      // 使用与现有交互按钮一致的样式类
      btn.className = 'interactive';
      btn.style.cssText = 'background-color: #2ecc71; color: white; border: none; margin-left: 10px;';

      btn.onclick = () => {
        // 二次检查状态
        if (!LobbyManager.allReady()) return showToast('有玩家取消了准备');
        if (!LobbyManager.roomId || !LobbyManager.socket) return;
        LobbyManager.socket.emit('startGame', LobbyManager.roomId);
        btn.remove();
      };

      // 插入到准备按钮之后
      if (readyBtn && readyBtn.parentNode) {
        readyBtn.parentNode.insertBefore(btn, readyBtn.nextSibling);
      }
    } else {
      lobbyStatusEl.textContent = '等待房主开始游戏...';
    }
  } else {
    lobbyStatusEl.textContent = LobbyManager.connected ? '等待所有玩家准备...' : '未连接，无法开始';
  }

  if (LobbyManager.gameStarted && LobbyManager.roomId && !gameCore.isRunning) {
    setTimeout(() => {
      if (LobbyManager.gameStarted && !gameCore.isRunning) {
        startGame({ force: true });
      }
    }, 0);
  }

  ensureHostRoundTimer();
}

// 连接状态文案与“离线房间”入口
(function bindConnectionUI() {
  const refresh = () => {
    if (!connStatus) return;
    if (LobbyManager.connected) {
      connStatus.textContent = `已连接：${LobbyManager.socket?.io?.uri || ''}`;
    } else {
      connStatus.textContent = '未连接';
    }
  };
  LobbyManager.subscribe(refresh);
  refresh();
})();

// 离线房间入口：使用不与分享链接冲突的占位ID
// [已移除 offline 按钮 UI]


startBtn?.addEventListener('click', async () => {
  const goOnlineFlow = async (playerName) => {
    LobbyManager.createRoom(playerName);
    homeScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
  };

  const goOfflineFlow = async (playerName) => {
    const offlineRoomId = `local-${Date.now().toString(36)}`;
    LobbyManager.roomId = offlineRoomId;
    LobbyManager.serverPlayers = [{ id: 'local-self', name: playerName, ready: true }];
    homeScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    renderLobby();
  };

  const askNameThen = (cb) => openNameModal(`玩家${Math.floor(Math.random() * 100)}`, (playerName) => cb(playerName), () => { });

  if (LobbyManager.connected) {
    // 已连接：走在线流程
    askNameThen(goOnlineFlow);
  } else {
    // 未连接：弹窗询问是否进入离线模式
    const ok = await showConfirm('当前未连接服务器，是否进入离线模式？');
    if (ok) {
      askNameThen(goOfflineFlow);
    } else {
      // 保持在首页，并建议检查网络
      showToast('已取消进入，建议检查网络连接');
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
  const nextRoomId = (joinRoomInput?.value || '').trim();
  if (!nextRoomId) return showToast('请输入房间 ID');
  openNameModal(`玩家${Math.floor(Math.random() * 100)}`, (playerName) => {
    LobbyManager.joinRoom(nextRoomId, playerName);
    homeScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    joinRoomFormEl?.classList.add('hidden');
  }, () => { });
};

joinRoomConfirmBtn?.addEventListener('click', submitJoinRoom);
joinRoomInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitJoinRoom();
});

readyBtn?.addEventListener('click', () => {
  LobbyManager.toggleReady();
  const self = LobbyManager.getSelf();
  if (self) {
    readyBtn.textContent = self.ready ? '取消准备' : '准备';
    readyBtn.style.borderColor = self.ready ? '#2ecc71' : '#222';
  }
});

shareBtn?.addEventListener('click', () => {
  if (!(LobbyManager.roomId && LobbyManager.connected)) {
    return showToast('未连接服务器，无法分享房间');
  }
  const url = buildShareUrl(LobbyManager.roomId);

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url)
      .then(() => showToast('邀请链接已复制'))
      .catch(() => showToast('复制失败，请手动复制地址栏链接'));
  } else {
    // Fallback for insecure contexts or older browsers
    window.prompt('请手动复制此链接:', url);
  }
});

function startGame({ force = false } = {}) {
  if (!force && !LobbyManager.allReady()) return;
  if (gameCore.isRunning && phaserGame.scene.isActive('GameScene')) return;
  clearEndReturnTimer();

  // Hide DOM UI; game runs on canvas
  document.getElementById('ui-container')?.classList.add('hidden');
  if (gameCanvasEl) gameCanvasEl.classList.remove('hidden');
  // Inject lobby players into core game and start
  // Avoid duplicate players when starting via different paths
  gameCore.players = [];
  const lobbyPlayers = LobbyManager.list();
  const selfLobby = (LobbyManager.getSelf && LobbyManager.getSelf()) || null;
  lobbyPlayers.forEach((p, idx) => {
    gameCore.addPlayer(p.name, { isBot: !!p.isBot, networkId: p.id });
    const added = gameCore.players[idx];
    if (selfLobby && p.id === selfLobby.id && added) {
      localPlayerId = added.id;
    }
  });
  gameCore.startGame();
  endHandled = false;
  // Start Phaser GameScene on demand
  if (!phaserGame.scene.isActive('GameScene')) {
    phaserGame.scene.start('GameScene');
  }
  // Show action bar when selecting
  // Determine local player by matching lobby self name to core players to avoid wrong self-id
  if (!localPlayerId) {
    localPlayerId = (gameCore.players[0] && gameCore.players[0].id) || 1;
  }
  window.localPlayerId = localPlayerId;
  let lastRound = gameCore.currentRound;
  const syncUI = () => {
    // 回合推进：进入新一轮选择阶段时清理待选目标状态，避免显示旧的“(待选目标)”
    if (gameCore.gameState === 'selecting' && gameCore.currentRound !== lastRound) {
      window.pendingAttack = null;
      lastRound = gameCore.currentRound;
    }

    if (gameCore.gameState === 'selecting') {
      ensureHostRoundTimer();
      showActionBar();
    } else {
      hideActionBar();
    }
    // Game over -> return to lobby UI
    if (gameCore.gameState === 'ended') {
      window.pendingAttack = null;
      if (!endHandled) {
        endHandled = true;
        scheduleReturnToRoom();
      }
    }
  };
  // Observe game state via polling simple interval (Dev)
  if (gameSyncIntervalId) clearInterval(gameSyncIntervalId);
  gameSyncIntervalId = setInterval(syncUI, 300);
}

// Expose for DebugUIManager interop
window.startGameFromLobby = startGame;

// Keep DOM lobby in sync with debug panel
LobbyManager.subscribe(renderLobby);
window.renderLobby = renderLobby;
renderLobby();

// Check for a room ID in the URL
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
if (roomId) {
  openNameModal(`玩家${Math.floor(Math.random() * 100)}`, (playerName) => {
    LobbyManager.joinRoom(roomId, playerName);
    homeScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
  }, () => {
    // 取消加入，保持在首页
  });
} else {
  const resumed = LobbyManager.resumeSavedSession?.();
  if (resumed) {
    homeScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
    showToast('已恢复上次房间，正在同步状态...');
  }
}