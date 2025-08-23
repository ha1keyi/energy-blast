import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene.js';
import { Game } from './core/Game.js';
import { Player } from './core/Player.js';
import { DebugUIManager } from './managers/DebugUIManager.js';
import './style.css';

// 创建游戏实例
const game = new Game();

// 添加示例玩家
game.addPlayer('玩家1');
game.addPlayer('玩家2');

// 创建调试UI
const debugUIManager = new DebugUIManager(game);
game.setDebugUIManager(debugUIManager);

// 启动UI更新
debugUIManager.startUpdating();

// Phaser 游戏配置
const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game-container',
  backgroundColor: '#2c3e50',
  scene: [GameScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  }
};

// 创建 Phaser 游戏实例
const phaserGame = new Phaser.Game(config);

// 暴露游戏实例到全局，便于调试
window.game = game;

// 将调试UI管理器也暴露到全局
window.debugUI = debugUIManager;

console.log('Energy Blast initialized!');