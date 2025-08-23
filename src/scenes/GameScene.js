// src/scenes/GameScene.js
import Phaser from 'phaser';
export class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    preload() {
        // 这里预加载资源
        this.load.setBaseURL('https://labs.phaser.io');
        this.load.image('sky', 'assets/skies/space3.png');
        this.load.image('logo', 'assets/sprites/phaser3-logo.png');
    }

    create() {
        // 创建背景
        this.add.image(400, 300, 'sky');

        // 添加logo测试
        const logo = this.add.image(400, 150, 'logo');
        logo.setScale(0.5);

        // 添加文字说明
        this.add.text(400, 400, 'Energy Blast', {
            fontSize: '32px',
            fill: '#fff',
            align: 'center'
        }).setOrigin(0.5);

        console.log('GameScene created successfully!');

        // 监听游戏结束，回到大厅
        this.endWatcher = this.time.addEvent({
            delay: 500, loop: true, callback: () => {
                const core = window.game;
                if (core?.gameState === 'ended') {
                    this.scene.start('LobbyScene');
                }
            }
        });

        // 退出到主页按钮（可选）
        const { width } = this.scale;
        const quit = this.add.text(width - 120, 20, '退出到主页', { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '16px', color: '#fff' })
            .setInteractive({ useHandCursor: true });
        quit.on('pointerdown', () => {
            const core = window.game;
            core?.endGame();
            this.scene.start('HomeScene');
        });
    }

    update() {
        // 游戏循环
    }
}