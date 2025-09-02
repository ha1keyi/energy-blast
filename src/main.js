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
  type: Phaser.AUTO,
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
const readyBtn = document.getElementById('ready-btn');
const shareBtn = document.getElementById('share-link-btn');
const playerListEl = document.getElementById('player-list');
const lobbyStatusEl = document.getElementById('lobby-status');
const actionBarEl = document.getElementById('action-bar');

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
  const me = gameCore.players.find(p => p.id === localPlayerId);
  if (!me || !me.isAlive) return hideActionBar();

  actionBarEl.classList.remove('hidden');
  // no target overlay; direct click on opponents in canvas

  // Build buttons for: STORE_1, ATTACK_1, DEFEND_1, REBOUND_1, ATTACK_2 (if exists)
  const keys = ['STORE_1', 'ATTACK_1', 'DEFEND_1', 'REBOUND_1', 'ATTACK_2'].filter(k => ACTIONS[k]);
  actionBarEl.innerHTML = '';
  keys.forEach(key => {
    const cfg = ACTIONS[key];
    let can = me.energy >= (cfg.energyCost || 0);
    if (cfg.type === ActionType.ATTACK) {
      const hasTarget = gameCore.players.some(p => p.id !== me.id && p.isAlive);
      can = can && hasTarget;
    }
    const btn = document.createElement('button');
    btn.className = 'action-btn' + (can ? '' : ' disabled');
    const imgName = key.toLowerCase() + '.jpg';
    const imgSrc = imageMap[imgName] || '';
    btn.innerHTML = `<img alt="${cfg.name}" src="${imgSrc}"/><span>${cfg.name}</span>`;
    if (can) {
      btn.onclick = () => onChooseAction(me, key);
    }
    actionBarEl.appendChild(btn);
  });
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
  } else {
    LobbyManager.socket.emit('selectAction', LobbyManager.roomId, actionKey, null);
    try {
      player.selectAction(actionKey, null);
      debugUI.updatePlayerList();
      showActionBar();
    } catch (e) { showToast(e.message); }
  }
}

function renderLobby() {
  playerListEl.innerHTML = '';
  LobbyManager.list().forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p.name}${p.isBot ? ' (虚拟)' : ''}</span><span class="player-status ${p.ready ? 'ready' : ''}">${p.ready ? '已准备' : '未准备'}</span>`;
    playerListEl.appendChild(li);
  });
  // 根据是否已加入/创建房间控制按钮可用性
  shareBtn?.toggleAttribute('disabled', !LobbyManager.roomId);
  readyBtn?.toggleAttribute('disabled', !LobbyManager.roomId);
  const self = LobbyManager.getSelf?.();
  if (self && readyBtn) {
    readyBtn.textContent = self.ready ? '取消准备' : '准备';
    readyBtn.style.borderColor = self.ready ? '#2ecc71' : '#222';
  }

  const allReady = LobbyManager.allReady();
  lobbyStatusEl.textContent = allReady ? '所有玩家已准备！即将开始...' : '等待所有玩家准备...';
  if (allReady) setTimeout(startGame, 600);
}

startBtn?.addEventListener('click', () => {
  // 仅在确认名字后才进入房间页
  openNameModal(`玩家${Math.floor(Math.random() * 100)}`, (playerName) => {
    LobbyManager.createRoom(playerName);
    homeScreen.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
  }, () => {
    // 取消则留在首页
  });
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
  const url = `${location.origin}?room=${LobbyManager.roomId}`;
  navigator.clipboard.writeText(url).then(() => showToast('邀请链接已复制')).catch(() => showToast('复制失败，请手动复制地址栏链接'));
});

function startGame() {
  if (!LobbyManager.allReady()) return;
  // Hide DOM UI; game runs on canvas
  document.getElementById('ui-container')?.classList.add('hidden');
  // Inject lobby players into core game and start
  // Avoid duplicate players when starting via different paths
  gameCore.players = [];
  LobbyManager.list().forEach(p => gameCore.addPlayer(p.name, { isBot: !!p.isBot }));
  gameCore.startGame();
  // Start Phaser GameScene on demand
  if (!phaserGame.scene.isActive('GameScene')) {
    phaserGame.scene.start('GameScene');
  }
  // Show action bar when selecting
  // Determine local player by matching lobby self name to core players to avoid wrong self-id
  const selfLobby = (LobbyManager.getSelf && LobbyManager.getSelf()) || null;
  if (selfLobby) {
    const me = gameCore.players.find(p => p.name === selfLobby.name);
    localPlayerId = (me && me.id) || (gameCore.players[0] && gameCore.players[0].id) || 1;
  } else {
    localPlayerId = (gameCore.players[0] && gameCore.players[0].id) || 1;
  }
  window.localPlayerId = localPlayerId;
  const syncUI = () => {
    if (gameCore.gameState === 'selecting') {
      showActionBar();
    } else {
      hideActionBar();
    }
    // Game over -> return to lobby UI
    if (gameCore.gameState === 'ended') {
      window.pendingAttack = null;
      document.getElementById('ui-container')?.classList.remove('hidden');
      homeScreen?.classList.add('hidden');
      lobbyScreen?.classList.remove('hidden');
      // Update lobby status
      if (lobbyStatusEl) lobbyStatusEl.textContent = '游戏结束，等待所有玩家准备…';
      // Stop scene
      if (phaserGame.scene.isActive('GameScene')) phaserGame.scene.stop('GameScene');
      // stop polling
      if (gameSyncIntervalId) { clearInterval(gameSyncIntervalId); gameSyncIntervalId = null; }
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
}