import Phaser from 'phaser';

function isMobileDevice() {
    if (typeof navigator === 'undefined') return false;
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

function detectWebGLSupport() {
    if (typeof document === 'undefined') return false;
    try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
        return false;
    }
}

export function buildRenderProfile() {
    const mobile = isMobileDevice();
    const maxDpr = mobile ? 2 : 2;
    const deviceDpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    const dpr = Math.max(1, Math.min(maxDpr, mobile ? deviceDpr : Math.max(deviceDpr, 2)));
    const hasWebGL = detectWebGLSupport();

    return {
        id: mobile ? 'mobile-balanced' : 'desktop-balanced',
        hasWebGL,
        dpr,
        maxDpr,
        // AUTO prefers WebGL when available and falls back to Canvas.
        phaserType: Phaser.AUTO,
        render: {
            antialias: true,
            pixelArt: false,
            roundPixels: true,
            antialiasGL: true,
        },
    };
}

export function getRenderDiagnostics(profile) {
    return {
        profile: profile.id,
        hasWebGL: profile.hasWebGL,
        dpr: profile.dpr,
        maxDpr: profile.maxDpr,
    };
}
