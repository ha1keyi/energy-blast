// src/scenes/GameScene.js
import Phaser from 'phaser';
import { LobbyManager } from '../managers/LobbyManager.js';
import { BattleLayoutManager } from '../managers/BattleLayoutManager.js';
import { BattlePresentationManager } from '../managers/BattlePresentationManager.js';

// Resolve action images via Vite eager glob
const actionImages = import.meta.glob('../assets/images/*.jpg', { eager: true });
const actionImgMap = {};
for (const p in actionImages) {
    const mod = actionImages[p];
    const url = mod?.default || mod;
    const name = p.split('/').pop();
    actionImgMap[name] = url;
}

export class GameScene extends Phaser.Scene {
    constructor() {
        super('GameScene');
    }

    preload() {
        // Preload action images with filename as key (e.g., attack_1.jpg)
        for (const name in actionImgMap) {
            this.load.image(name, actionImgMap[name]);
        }
    }

    create() {
        const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0, 1);
        const viewportHeight = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 1);
        this.scale.resize(viewportWidth, viewportHeight);
        this.cameras.resize(viewportWidth, viewportHeight);

        // Hand-drawn black/white scene frame
        const { width, height } = this.scale;
        this.layoutManager = new BattleLayoutManager(this);
        const g = this.add.graphics();
        g.fillStyle(0xffffff, 0.9).fillRect(0, 0, width, height);
        g.lineStyle(6, 0x000000, 1).strokeRect(6, 6, width - 12, height - 12);
        // Title
        this.add.text(Math.round(width / 2), 28, 'Energy Blast', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '24px', color: '#000', stroke: '#fff', strokeThickness: 4
        }).setOrigin(0.5, 0);

        // 新增：战斗表现管理器（动画 + 日志）
        const core = this.getCore && this.getCore();
        if (core) {
            if (core.battlePresentationManager && typeof core.battlePresentationManager.cleanup === 'function') {
                core.battlePresentationManager.cleanup();
            }
            core.battlePresentationManager = null;
            core.battleAnimationManager = null;
            this.battlePresentationManager = new BattlePresentationManager(core, this, {
                layoutManager: this.layoutManager,
                onChooseTarget: (player) => this.chooseTarget(player),
                onReturnLobby: () => this.handleReturnLobby(),
            });
            this.battleAnimationManager = this.battlePresentationManager.animationManager;
            core.battlePresentationManager = this.battlePresentationManager;
            core.battleAnimationManager = this.battleAnimationManager;
            this.battlePresentationManager.refresh();
        }

        // 去重：仅保留一个定时器轮询 HUD / 日志 / 待选提示
        this.uiRefreshEvent = this.time.addEvent({
            delay: 300,
            loop: true,
            callback: () => {
                this.battlePresentationManager?.refresh?.();
            }
        });

        this.events.once('shutdown', () => this.cleanupScene());
        this.events.once('destroy', () => this.cleanupScene());
    }

    update() { }

    getCore() { return window.game; }

    handleExitRoom() {
        // exit room (kept minimal logging)
        const socket = LobbyManager.socket;
        const roomId = LobbyManager.roomId;
        if (socket && roomId) {
            socket.emit('leaveRoom', roomId);
        }
        // 返回大厅
        if (typeof window.returnToLobby === 'function') {
            window.returnToLobby({ resetRoom: true });
        } else {
            // Fallback
            this.scene.stop();
            document.getElementById('home-screen')?.classList.remove('hidden');
            document.getElementById('lobby-screen')?.classList.add('hidden');
            document.getElementById('ui-container')?.classList.add('hidden');
        }
    }

    handleReturnLobby() {
        if (typeof window.returnToLobby === 'function') {
            window.returnToLobby();
        }
    }

    cleanupScene() {
        if (this.uiRefreshEvent) {
            this.uiRefreshEvent.remove(false);
            this.uiRefreshEvent = null;
        }
        if (this.battlePresentationManager && typeof this.battlePresentationManager.cleanup === 'function') {
            this.battlePresentationManager.cleanup();
            this.battlePresentationManager = null;
        }
        const core = this.getCore && this.getCore();
        if (core?.battlePresentationManager && typeof core.battlePresentationManager.cleanup === 'function') {
            core.battlePresentationManager.cleanup();
            core.battlePresentationManager = null;
        }
        this.battleAnimationManager = null;
        if (core) {
            core.battleAnimationManager = null;
        }
    }

    chooseTarget(targetPlayer) {
        if (window.battleFlow && typeof window.battleFlow.onTargetChosen === 'function') {
            window.battleFlow.onTargetChosen(targetPlayer);
        }
    }

}