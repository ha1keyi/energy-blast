// src/scenes/GameScene.js
import Phaser from 'phaser';
export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    preload() { }

    create() {
        // Hand-drawn black/white scene frame
        const { width, height } = this.scale;
        const g = this.add.graphics();
        g.fillStyle(0xffffff, 0.9).fillRect(0, 0, width, height);
        g.lineStyle(6, 0x000000, 1).strokeRect(6, 6, width - 12, height - 12);
        // Title
        this.add.text(Math.round(width / 2), 28, 'Energy Blast', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '24px', color: '#000', stroke: '#fff', strokeThickness: 4
        }).setOrigin(0.5, 0);

        console.log('GameScene created successfully!');

        // In hybrid mode, DOM (lobby/home) controls navigation; GameScene stays focused on gameplay.
    }

    update() {
        // 游戏循环
    }
}