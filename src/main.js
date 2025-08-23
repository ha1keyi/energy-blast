import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene.js';
import { Game } from './core/Game.js';
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
  scene: [GameScene],
  // Render crisp: match device resolution, disable smoothing
  resolution: DPR,
  render: { antialias: true, pixelArt: false, roundPixels: false },
  // Let canvas always match container size (no CSS scaling)
  scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } }
};

const phaserGame = new Phaser.Game(config);
console.log('Energy Blast initialized (hybrid UI + Phaser canvas)!');

// Restore DOM-driven Home/Lobby over the canvas
const homeScreen = document.getElementById('home-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const startBtn = document.getElementById('start-game-btn');
const readyBtn = document.getElementById('ready-btn');
const shareBtn = document.getElementById('share-link-btn');
const playerListEl = document.getElementById('player-list');
const lobbyStatusEl = document.getElementById('lobby-status');

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
  LobbyManager.list().forEach(p => gameCore.addPlayer(p.name));
  gameCore.startGame();
}

// Keep DOM lobby in sync with debug panel
LobbyManager.subscribe(renderLobby);
window.renderLobby = renderLobby;