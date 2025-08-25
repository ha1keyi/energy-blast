import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene.js';
import { Game } from './core/Game.js';
import { ACTIONS } from './core/constants/Actions.js';
import { ActionType } from './core/enums/ActionType.js';
import { DebugUIManager } from './managers/DebugUIManager.js';
import { LobbyManager } from './managers/LobbyManager.js';
import './style.css';

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

function onChooseAction(player, actionKey) {
  const cfg = ACTIONS[actionKey];
  if (cfg.type === ActionType.ATTACK) {
    // Enter direct target selection mode; GameScene will handle clicks on opponents
    window.pendingAttack = { selfId: player.id, actionKey };
  } else {
    try {
      player.selectAction(actionKey, null);
      debugUI.updatePlayerList();
      showActionBar();
    } catch (e) { alert(e.message); }
  }
}

function renderLobby() {
  playerListEl.innerHTML = '';
  LobbyManager.list().forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${p.name}</span><span class="player-status ${p.ready ? 'ready' : ''}">${p.ready ? '已准备' : '未准备'}</span>`;
    playerListEl.appendChild(li);
  });
  const allReady = LobbyManager.allReady();
  lobbyStatusEl.textContent = allReady ? '所有玩家已准备！即将开始...' : '等待所有玩家准备...';
  if (allReady) setTimeout(startGame, 600);
}

startBtn?.addEventListener('click', () => {
  homeScreen.classList.add('hidden');
  lobbyScreen.classList.remove('hidden');
  LobbyManager.reset();
  LobbyManager.add('玩家1 (你)');
  setTimeout(() => { LobbyManager.add('玩家2'); renderLobby(); }, 300);
  renderLobby();
});

readyBtn?.addEventListener('click', () => {
  const self = LobbyManager.get(1) || LobbyManager.add('玩家1 (你)');
  LobbyManager.toggleReady(self.id);
  readyBtn.textContent = self.ready ? '取消准备' : '准备';
  readyBtn.style.borderColor = self.ready ? '#2ecc71' : '#222';
  renderLobby();
});

shareBtn?.addEventListener('click', () => {
  navigator.clipboard.writeText(location.href).then(() => alert('邀请链接已复制')).catch(() => alert('复制失败，请手动复制地址栏链接'));
});

function startGame() {
  if (!LobbyManager.allReady()) return;
  // Hide DOM UI; game runs on canvas
  document.getElementById('ui-container')?.classList.add('hidden');
  // Inject lobby players into core game and start
  // Avoid duplicate players when starting via different paths
  gameCore.players = [];
  LobbyManager.list().forEach(p => gameCore.addPlayer(p.name));
  gameCore.startGame();
  // Start Phaser GameScene on demand
  if (!phaserGame.scene.isActive('GameScene')) {
    phaserGame.scene.start('GameScene');
  }
  // Show action bar when selecting
  localPlayerId = (gameCore.players[0] && gameCore.players[0].id) || 1;
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