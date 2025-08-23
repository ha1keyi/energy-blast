import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene.js';
import { HomeScene } from './scenes/HomeScene.js';
import { LobbyScene } from './scenes/LobbyScene.js';
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

const config = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  parent: 'game-container',
  transparent: true, // keep transparent to preserve existing hand-drawn page style
  scene: [HomeScene, LobbyScene, GameScene],
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } }
};

const phaserGame = new Phaser.Game(config);
console.log('Energy Blast initialized with scenes!');