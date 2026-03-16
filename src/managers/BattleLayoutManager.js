export class BattleLayoutManager {
    constructor(scene) {
        this.scene = scene;
    }

    snap(value) {
        return Math.round(value);
    }

    getMetrics() {
        const { width, height } = this.scene.scale;
        const compact = width <= 820 || height <= 720 || width < height;
        const safeBottom = compact ? 172 : 108;
        const topInset = compact ? 88 : 76;
        return { width, height, compact, safeBottom, topInset };
    }

    getPendingHintPosition() {
        const { width, compact } = this.getMetrics();
        return { x: this.snap(width / 2), y: this.snap(compact ? 64 : 56) };
    }

    getOpponentPositions(count) {
        const positions = [];
        if (count <= 0) return positions;

        const { width, height, compact, safeBottom, topInset } = this.getMetrics();
        const marginX = compact ? 58 : 70;
        const topY = compact ? topInset + 32 : topInset + 10;
        const sideTopY = topY + (compact ? 22 : 28);
        const sideBottomY = Math.max(sideTopY + 60, height - safeBottom - (compact ? 138 : 96));

        if (count === 1) {
            positions.push({ x: this.snap(width / 2), y: this.snap(topY), align: 0.5 });
            return positions;
        }

        const topCount = compact ? Math.min(2, count) : Math.ceil(count / 3);
        const sideCount = count - topCount;
        const rightCount = Math.ceil(sideCount / 2);
        const leftCount = sideCount - rightCount;

        for (let i = 0; i < topCount; i++) {
            const t = (i + 1) / (topCount + 1);
            positions.push({ x: this.snap(marginX + t * (width - marginX * 2)), y: this.snap(topY), align: 0.5 });
        }
        for (let i = 0; i < rightCount; i++) {
            const t = (i + 1) / (rightCount + 1);
            positions.push({ x: this.snap(width - marginX), y: this.snap(sideTopY + t * (sideBottomY - sideTopY)), align: 1 });
        }
        for (let i = 0; i < leftCount; i++) {
            const t = (i + 1) / (leftCount + 1);
            positions.push({ x: this.snap(marginX), y: this.snap(sideTopY + t * (sideBottomY - sideTopY)), align: 0 });
        }

        return positions;
    }

    getActionSpritePositions(count) {
        return this.getOpponentPositions(count).map((position) => ({
            x: this.snap(position.x),
            y: this.snap(position.y + (position.align === 0.5 ? 58 : 0)),
        }));
    }

    getSelfHudPosition() {
        const { width, height, compact, safeBottom } = this.getMetrics();
        return { x: this.snap(width / 2), y: this.snap(height - safeBottom + (compact ? 8 : 28)) };
    }

    getSelfActionPosition(size = 160) {
        const selfHud = this.getSelfHudPosition();
        return { x: this.snap(selfHud.x), y: this.snap(selfHud.y - Math.max(82, Math.round(size * 0.62))) };
    }

    getRoundStatusPosition() {
        const { width, height, safeBottom } = this.getMetrics();
        return { x: this.snap(width / 2), y: this.snap(height - safeBottom - 14) };
    }

    getBattleLogPanelBounds() {
        const { width, height, compact, safeBottom, topInset } = this.getMetrics();

        if (compact) {
            const panelWidth = Math.min(width - 24, 360);
            const panelHeight = Math.min(112, Math.max(84, Math.floor(height * 0.15)));
            const x = this.snap((width - panelWidth) / 2);
            const y = this.snap(Math.max(topInset, height - safeBottom - panelHeight - 116));
            return { x, y, width: this.snap(panelWidth), height: this.snap(panelHeight) };
        }

        return {
            x: 16,
            y: 76,
            width: this.snap(Math.min(420, Math.max(240, Math.floor(width * 0.44)))),
            height: this.snap(Math.min(170, Math.max(120, Math.floor(height * 0.28)))),
        };
    }

    getEndScreenBox() {
        const { width, height, compact } = this.getMetrics();
        return {
            x: this.snap(width / 2),
            y: this.snap(height / 2),
            width: this.snap(compact ? Math.min(width - 32, 360) : 500),
            height: this.snap(compact ? 280 : 300),
        };
    }
}
