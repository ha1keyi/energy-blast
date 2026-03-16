export class ViewportManager {
    constructor({ dpr = 1 } = {}) {
        this.dpr = dpr;
        this.width = 1;
        this.height = 1;
        this.listeners = new Set();
        this._boundResize = null;
        this.refresh();
    }

    refresh() {
        this.width = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0, 1);
        this.height = Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0, 1);
        return this.snapshot();
    }

    snapshot() {
        return {
            width: this.width,
            height: this.height,
            dpr: this.dpr,
            backingWidth: Math.round(this.width * this.dpr),
            backingHeight: Math.round(this.height * this.dpr),
        };
    }

    applyToGame(phaserGame) {
        if (!phaserGame) return;
        const { width, height, dpr, backingWidth, backingHeight } = this.snapshot();
        const scaleManager = phaserGame.scale;
        const scene = phaserGame.scene?.keys?.GameScene;

        // Resize logical scale and cameras
        scaleManager?.resize?.(width, height);
        scene?.scale?.resize?.(width, height);
        scene?.cameras?.resize?.(width, height);

        // Ensure the renderer backing buffer matches the DPR-scaled size
        try {
            const renderer = phaserGame.renderer;
            const canvas = phaserGame.canvas || (renderer && renderer.canvas) || document.querySelector('#game-canvas canvas');
            if (canvas) {
                // CSS size should be the logical width/height in CSS pixels
                canvas.style.width = `${width}px`;
                canvas.style.height = `${height}px`;
            }

            if (renderer && typeof renderer.resize === 'function') {
                // Resize renderer's internal drawing buffer to backing (physical) pixels
                try {
                    // Inform renderer of desired resolution
                    if (typeof renderer.setResolution === 'function') renderer.setResolution(dpr);
                    renderer.resize(backingWidth, backingHeight);
                } catch {
                    // ignore renderer-specific failures
                }
            }

            // Always ensure canvas backing attributes match backing size (defensive)
            if (canvas && backingWidth && backingHeight) {
                canvas.width = backingWidth;
                canvas.height = backingHeight;
            }
        } catch (e) {
            // Non-critical: keep pipeline resilient if renderer operations fail
            // console.warn('Viewport applyToGame renderer resize failed', e);
        }
    }

    subscribe(listener) {
        if (typeof listener !== 'function') return () => { };
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify() {
        const state = this.snapshot();
        this.listeners.forEach((listener) => {
            try {
                listener(state);
            } catch {
                // Keep resize pipeline resilient if one listener fails.
            }
        });
    }

    bindWindowResize(onResizeApplied) {
        if (this._boundResize) return;
        this._boundResize = () => {
            this.refresh();
            onResizeApplied?.(this.snapshot());
            this.notify();
        };
        window.addEventListener('resize', this._boundResize);
    }

    destroy() {
        if (this._boundResize) {
            window.removeEventListener('resize', this._boundResize);
            this._boundResize = null;
        }
        this.listeners.clear();
    }
}
