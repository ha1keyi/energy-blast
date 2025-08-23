import Phaser from 'phaser';
import { LobbyManager } from '../managers/LobbyManager.js';

export class HomeScene extends Phaser.Scene {
    constructor() { super('HomeScene'); }

    // No preload: load background dynamically in create with fallback

    create() {
        const { width, height } = this.scale;
        // Background: white fill with solid black border
        const graphics = this.add.graphics();
        graphics.fillStyle(0xffffff, 1).fillRect(0, 0, width, height);
        graphics.lineStyle(8, 0x000000, 1).strokeRect(0, 0, width, height);

        // Title
        this.add.text(width / 2, height * 0.28, 'Energy Blast', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif',
            fontSize: '48px',
            color: '#000',
            stroke: '#fff',
            strokeThickness: 6
        }).setOrigin(0.5);

        // '进入房间' button
        const btn = this.add.rectangle(width / 2, height * 0.55, 220, 56, 0xffffff, 0.9)
            .setStrokeStyle(3, 0x000000)
            .setInteractive({ useHandCursor: true });
        const label = this.add.text(btn.x, btn.y, '进入房间', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif',
            fontSize: '28px',
            color: '#000'
        }).setOrigin(0.5);

        btn.on('pointerover', () => btn.setFillStyle(0xf8f8f8, 1));
        btn.on('pointerout', () => btn.setFillStyle(0xffffff, 0.9));
        btn.on('pointerdown', () => {
            // Reset and add self, then go to LobbyScene
            LobbyManager.reset();
            LobbyManager.add('玩家1 (你)');
            this.scene.start('LobbyScene');
        });
    }
}
