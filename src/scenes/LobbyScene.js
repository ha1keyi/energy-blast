import Phaser from 'phaser';
import { LobbyManager } from '../managers/LobbyManager.js';
import { Game } from '../core/Game.js';

export class LobbyScene extends Phaser.Scene {
    constructor() { super('LobbyScene'); }

    // 集成socket到LobbyScene
    // 修改create方法以处理在线房间
    create() {
        const { width, height } = this.scale;

        // Fallback background: white fill with black dashed border
        // Draw UI container panel on transparent background
        const containerW = Math.round(Math.min(640, width * 0.8));
        const containerH = Math.round(Math.min(480, height * 0.75));
        const cx = Math.round((width - containerW) / 2);
        const cy = Math.round((height - containerH) / 2);
        const radius = 16;
        const graphics = this.add.graphics();
        // Shadow
        graphics.fillStyle(0x222222, 1).fillRoundedRect(cx + 6, cy + 6, containerW, containerH, radius);
        // Container background
        graphics.fillStyle(0xffffff, 1).fillRoundedRect(cx, cy, containerW, containerH, radius);
        // Border
        graphics.lineStyle(3, 0x222222, 1).strokeRoundedRect(cx, cy, containerW, containerH, radius);

        this.add.text(Math.round(width / 2), cy + 32, '对战房间', {
            fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '40px', color: '#000', stroke: '#fff', strokeThickness: 6
        }).setOrigin(0.5);

        // Buttons: Back, Share, Ready
        const uiY = cy + 72;
        const makeBtn = (x, text, onClick) => {
            const rect = this.add.rectangle(x, uiY, 160, 46, 0xffffff, 0.92).setStrokeStyle(3, 0x000000).setInteractive({ useHandCursor: true });
            const label = this.add.text(x, uiY, text, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '22px', color: '#000' }).setOrigin(0.5);
            rect.on('pointerover', () => rect.setFillStyle(0xf8f8f8, 1));
            rect.on('pointerout', () => rect.setFillStyle(0xffffff, 0.92));
            rect.on('pointerdown', onClick);
            return { rect, label };
        };

        makeBtn(width * 0.25, '返回主页', () => this.scene.start('HomeScene'));
        makeBtn(width * 0.5, '分享链接', () => {
            if (navigator?.clipboard?.writeText) {
                navigator.clipboard.writeText(location.href).then(() => this.showToast('邀请链接已复制')).catch(() => this.showToast('复制失败'));
            } else {
                this.showToast('请手动复制地址栏链接');
            }
        });
        const readyBtn = makeBtn(width * 0.75, '准备', () => {
            const self = LobbyManager.get(1) || LobbyManager.add('玩家1 (你)');
            LobbyManager.toggleReady(self.id);
            this.refresh();
            this.tryStartGame();
        });
        this.readyBtnLabel = readyBtn.label;

        // Player list panel
        // Player list panel
        const listW = containerW - 40;
        const listH = containerH - 200;
        const listX = cx + 20;
        const listY = cy + 120;
        const panel = this.add.rectangle(listX + listW / 2, listY + listH / 2, listW, listH, 0xffffff, 0)
            .setInteractive();
        this.listOrigin = { x: listX, y: listY, w: listW };

        this.listItems = [];
        this.refresh();

        // Bridge for debug panel (optional): allow triggering start from outside
        if (typeof window !== 'undefined') {
            window.startGameFromLobby = () => this.tryStartGame();
        }

        // Subscribe to lobby changes
        this.unsubscribe = LobbyManager.subscribe(() => this.refresh());
    }

    shutdown() {
        if (this.unsubscribe) this.unsubscribe();
        if (typeof window !== 'undefined' && window.startGameFromLobby === this.tryStartGame) {
            try { delete window.startGameFromLobby; } catch { }
        }
    }

    // 修改refresh以从socket更新
    refresh() {
        // 使用LobbyManager.players
        // Clear existing list items
        this.listItems.forEach(it => it.destroy());
        this.listItems = [];

        const { x, y, w } = this.listOrigin;
        const rowH = 36;
        const players = LobbyManager.list();
        players.forEach((p, i) => {
            const oy = y + i * (rowH + 6);
            const row = this.add.rectangle(x + w / 2, oy + rowH / 2, w, rowH, 0xffffff, 1).setStrokeStyle(2, 0x000000);
            const name = this.add.text(x + 10, oy + 8, p.name, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '18px', color: '#000' });
            const status = this.add.text(x + w - 220, oy + 8, p.ready ? '已准备' : '未准备', { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '18px', color: p.ready ? '#27ae60' : '#333' });
            this.listItems.push(row, name, status);
        });

        // Update ready button text based on self ready
        const self = LobbyManager.get(1);
        const ready = self?.ready;
        if (this.readyBtnLabel) this.readyBtnLabel.setText(ready ? '取消准备' : '准备');
    }

    tryStartGame() {
        if (LobbyManager.allReady()) {
            // Prepare core game and start GameScene
            const core = window.game; // created in main.js and shared
            core.players = [];
            LobbyManager.list().forEach(p => core.addPlayer(p.name));
            core.startGame();
            this.scene.start('GameScene');
        }
    }

    showToast(text) {
        const { width } = this.scale;
        const toast = this.add.text(width / 2, 60, text, { fontFamily: 'ZCOOL KuaiLe, sans-serif', fontSize: '18px', color: '#000', backgroundColor: '#fff' }).setOrigin(0.5);
        this.tweens.add({ targets: toast, alpha: 0, duration: 1400, delay: 800, onComplete: () => toast.destroy() });
    }
}
