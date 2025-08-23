import Phaser from 'phaser';

export class HomeScene extends Phaser.Scene {
    constructor() { super('HomeScene'); }

    create() {
        // UI is entirely handled by HTML overlay
        console.log('HomeScene is ready. UI is handled by HTML.');
    }
}
