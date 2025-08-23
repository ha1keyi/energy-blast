// src/scenes/GameScene.js
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
    }

    update() {
        // 游戏循环
    }
}