import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene.js';
import { Game } from './core/Game.js';
import { DebugUIManager } from './managers/DebugUIManager.js';
import { LobbyManager } from './managers/LobbyManager.js';
import { LobbyFlowCoordinator } from './managers/LobbyFlowCoordinator.js';
import { BattleFlowCoordinator } from './managers/BattleFlowCoordinator.js';
import './style.css';

if (typeof window !== 'undefined') {
  if (!window.showToast) window.showToast = (msg) => console.warn('[toast]', msg);
  if (!window.showConfirm) window.showConfirm = () => Promise.resolve(false);
}

LobbyManager.connect();

const gameCore = new Game();
const debugUI = new DebugUIManager(gameCore);
gameCore.setDebugUIManager(debugUI);
debugUI.startUpdating();
window.debugUI = debugUI;
window.game = gameCore;
window.lobby = LobbyManager;

const DPR = Math.max(1, window.devicePixelRatio || 1);
const config = {
  type: Phaser.CANVAS,
  parent: 'game-canvas',
  transparent: true,
  backgroundColor: '#00000000',
  resolution: DPR,
  render: { antialias: true, pixelArt: false, roundPixels: false },
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
};

const phaserGame = new Phaser.Game(config);
window.phaserGame = phaserGame;
phaserGame.scene.add('GameScene', GameScene, false);

const elements = {
  homeScreen: document.getElementById('home-screen'),
  lobbyScreen: document.getElementById('lobby-screen'),
  startBtn: document.getElementById('start-game-btn'),
  joinToggleBtn: document.getElementById('join-room-toggle-btn'),
  joinRoomFormEl: document.getElementById('join-room-form'),
  joinRoomInput: document.getElementById('join-room-input'),
  joinRoomConfirmBtn: document.getElementById('join-room-confirm-btn'),
  readyBtn: document.getElementById('ready-btn'),
  shareBtn: document.getElementById('share-link-btn'),
  connStatus: document.getElementById('connection-status'),
  playerListEl: document.getElementById('player-list'),
  lobbyStatusEl: document.getElementById('lobby-status'),
  roomMetaEl: document.getElementById('room-meta'),
  roomIdDisplayEl: document.getElementById('room-id-display'),
  roomLinkDisplayEl: document.getElementById('room-link-display'),
  lobbyMatchSettings: document.getElementById('lobby-match-settings'),
  lobbyAutoResolveSelect: document.getElementById('lobby-auto-resolve-select'),
  lobbyRoundTimeInput: document.getElementById('lobby-round-time-input'),
  lobbyMatchSettingsHint: document.getElementById('lobby-match-settings-hint'),
  actionBarEl: document.getElementById('action-bar'),
  gameCanvasEl: document.getElementById('game-canvas'),
  appLoadingScreenEl: document.getElementById('app-loading-screen'),
  uiLayerEl: document.getElementById('ui-layer'),
};

let appReady = false;

function markAppReady() {
  if (appReady) return;
  appReady = true;
  elements.uiLayerEl?.removeAttribute('hidden');
  document.body.classList.remove('app-loading');
  document.body.classList.add('app-ready');
  elements.appLoadingScreenEl?.classList.add('hidden');
}

function waitForAppReady() {
  const pageLoaded = document.readyState === 'complete'
    ? Promise.resolve()
    : new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  const fontsReady = document.fonts?.ready?.catch?.(() => { }) || Promise.resolve();

  Promise.all([pageLoaded, fontsReady]).finally(() => {
    requestAnimationFrame(() => setTimeout(markAppReady, 120));
  });

  setTimeout(markAppReady, 1800);
}

waitForAppReady();
elements.gameCanvasEl?.classList.add('hidden');

const nameModal = document.getElementById('name-modal');
const nameInput = document.getElementById('player-name-input');
const nameConfirmBtn = document.getElementById('name-confirm-btn');
const nameCancelBtn = document.getElementById('name-cancel-btn');

function openNameModal(defaultName = `玩家${Math.floor(Math.random() * 100)}`, onConfirm, onCancel) {
  if (!nameModal || !nameInput || !nameConfirmBtn || !nameCancelBtn) {
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
    const value = (nameInput.value || '').trim() || defaultName;
    cleanup();
    onConfirm?.(value);
  };

  nameCancelBtn.onclick = () => {
    cleanup();
    onCancel?.();
  };

  nameInput.onkeydown = (e) => {
    if (e.key === 'Enter') nameConfirmBtn.click();
    if (e.key === 'Escape') nameCancelBtn.click();
  };

  setTimeout(() => {
    nameInput.focus();
    nameInput.select();
  }, 0);
}

function showToast(message, duration = 1600) {
  const el = document.getElementById('toast');
  if (!el) {
    console.warn('[toast]', message);
    return;
  }

  el.textContent = message;
  el.classList.remove('hidden');
  el.style.opacity = '0';
  el.style.transition = 'opacity .2s ease';
  requestAnimationFrame(() => {
    el.style.opacity = '1';
  });

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
      ok.onclick = null;
      cancel.onclick = null;
    };

    ok.onclick = () => {
      cleanup();
      resolve(true);
    };

    cancel.onclick = () => {
      cleanup();
      resolve(false);
    };
  });
}

window.showToast = showToast;
window.showConfirm = showConfirm;

const imageModules = import.meta.glob('./assets/images/*.jpg', { eager: true });
const imageMap = {};
for (const path in imageModules) {
  const mod = imageModules[path];
  const url = mod?.default || mod;
  const name = path.split('/').pop();
  imageMap[name] = url;
}

const lobbyCoordinator = new LobbyFlowCoordinator({
  lobbyManager: LobbyManager,
  elements,
  showToast,
  showConfirm,
  openNameModal,
  onSettingsChanged: (settings) => {
    gameCore.applyMatchSettings(settings, { reschedule: false });
    debugUI.syncControlStateFromGame?.();
  },
});

const battleCoordinator = new BattleFlowCoordinator({
  gameCore,
  phaserGame,
  lobbyManager: LobbyManager,
  debugUI,
  elements,
  imageMap,
  showToast,
  renderLobby: () => lobbyCoordinator.renderLobby(),
});

battleCoordinator.init();
lobbyCoordinator.init();
window.renderLobby = () => lobbyCoordinator.renderLobby();

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
if (roomId) {
  openNameModal(`玩家${Math.floor(Math.random() * 100)}`, (playerName) => {
    LobbyManager.joinRoom(roomId.toLowerCase(), playerName);
    elements.homeScreen?.classList.add('hidden');
    elements.lobbyScreen?.classList.remove('hidden');
  }, () => { });
} else {
  const resumed = LobbyManager.resumeSavedSession?.();
  if (resumed) {
    elements.homeScreen?.classList.add('hidden');
    elements.lobbyScreen?.classList.remove('hidden');
    showToast('已恢复上次房间，正在同步状态...');
  }
}