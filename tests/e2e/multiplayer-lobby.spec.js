import { test, expect } from '@playwright/test';

async function waitForApp(page) {
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/app-ready/);
    await expect(page.locator('#home-screen')).toBeVisible();
    await expect(page.locator('#connection-status')).toContainText('已连接', { timeout: 20_000 });
}

async function confirmName(page, name) {
    await expect(page.locator('#name-modal')).toBeVisible();
    await page.locator('#player-name-input').fill(name);
    await page.getByRole('button', { name: '确定' }).click();
}

async function createRoom(page, name) {
    await waitForApp(page);
    await page.getByRole('button', { name: '创建房间' }).click();
    await confirmName(page, name);
    await expect(page.locator('#lobby-screen')).toBeVisible();
    await expect(page.locator('#room-id-display')).toContainText('房间 ID：');
    const roomText = (await page.locator('#room-id-display').textContent()) || '';
    const roomId = roomText.replace('房间 ID：', '').trim();
    expect(roomId).not.toBe('');
    return roomId;
}

async function joinRoomByUrl(page, roomId, name) {
    await page.goto(`/?room=${roomId}`);
    await expect(page.locator('body')).toHaveClass(/app-ready/);
    await confirmName(page, name);
    await expect(page.locator('#lobby-screen')).toBeVisible();
}

// Helper: create host and guest contexts/pages and join them to the same room
async function setupHostGuest(browser, hostName = 'Host', guestName = 'Guest', opts = {}) {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomId = await createRoom(hostPage, hostName);
    if (opts.autoMode) await hostPage.locator('#lobby-auto-resolve-select').selectOption(opts.autoMode);
    if (opts.roundTime) {
        await hostPage.locator('#lobby-round-time-input').fill(String(opts.roundTime));
        await hostPage.locator('#lobby-round-time-input').blur();
    }
    await joinRoomByUrl(guestPage, roomId, guestName);

    return {
        hostContext,
        guestContext,
        hostPage,
        guestPage,
        roomId,
        async cleanup() {
            await hostContext.close();
            await guestContext.close();
        }
    };
}

async function readyBothPlayers(hostPage, guestPage) {
    await hostPage.getByRole('button', { name: '准备' }).click();
    await guestPage.getByRole('button', { name: '准备' }).click();
    await expect(hostPage.locator('#start-game-btn-active')).toBeVisible({ timeout: 10_000 });
    await expect(guestPage.locator('#lobby-status')).toContainText('等待房主开始游戏');
}

async function startMatch(hostPage) {
    await hostPage.locator('#start-game-btn-active').click();
    await expect(hostPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });
}

async function expectRoundHeader(page, round) {
    await expect(page.locator('#action-bar-header')).toContainText(`回合 ${round}`, { timeout: 20_000 });
}

async function expectAutoCountdownReady(page) {
    await expect(page.locator('#action-bar-header')).toContainText('倒计时：', { timeout: 20_000 });
    await expect(page.locator('#action-bar-header')).not.toContainText('同步中');
    await expect(page.locator('#action-finish-round-btn')).toHaveCount(0);
}

async function expectOpponentHudLoaded(page) {
    await expect.poll(async () => page.evaluate(() => {
        const core = window.game;
        const presentation = core?.battlePresentationManager;
        const canvas = document.querySelector('#game-canvas canvas');
        const scene = window.phaserGame?.scene?.keys?.GameScene;
        const canvasRect = canvas?.getBoundingClientRect?.();
        const hudNodes = (presentation?.hudContainer?.list || []).map((node) => ({
            x: node.x,
            y: node.y,
            visible: node.visible !== false,
            alpha: typeof node.alpha === 'number' ? node.alpha : 1,
            childCount: node.list?.length || 0,
            text: node.text || '',
        }));
        const opponentNodes = hudNodes.filter((node) => node.childCount >= 4);
        return {
            playerCount: (core?.players || []).length,
            hudCount: presentation?.hudContainer?.list?.length || 0,
            sceneWidth: scene?.scale?.width || 0,
            sceneHeight: scene?.scale?.height || 0,
            canvasWidth: Math.round(canvasRect?.width || 0),
            canvasHeight: Math.round(canvasRect?.height || 0),
            opponentVisible: opponentNodes.some((node) => node.visible && node.alpha > 0 && node.x > 0 && node.y > 0),
        };
    }), { timeout: 10_000 }).toEqual({
        playerCount: 2,
        hudCount: 3,
        sceneWidth: 1280,
        sceneHeight: 720,
        canvasWidth: 1280,
        canvasHeight: 720,
        opponentVisible: true,
    });
}

async function expectResolvingAnimation(page) {
    await expect.poll(async () => page.evaluate(() => window.game?.gameState || ''), { timeout: 10_000 }).toBe('resolving');
    await expect.poll(async () => page.evaluate(() => window.game?.battleAnimationManager?.nodes?.length || 0), { timeout: 10_000 }).toBeGreaterThan(0);
}

async function waitForCanvasPaint(page) {
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

async function selectAttackTarget(page, targetName) {
    await page.getByRole('button', { name: /小波/ }).click();
    await expect(page.locator('#action-bar-status')).toContainText('待选目标');
    await page.evaluate((name) => {
        const target = window.game?.players?.find((player) => player.name === name);
        if (!target) throw new Error(`Target not found: ${name}`);
        if (!window.battleFlow?.onTargetChosen) throw new Error('battleFlow.onTargetChosen unavailable');
        window.battleFlow.onTargetChosen({ id: target.id });
    }, targetName);
    await expect(page.locator('#action-bar-status')).toContainText(targetName);
}

async function waitForLobbyReturn(page) {
    await expect(page.locator('#lobby-screen')).toBeVisible({ timeout: 12_000 });
    await expect(page.locator('#home-screen')).toHaveClass(/hidden/);
    await expect(page.locator('#action-bar')).toHaveClass(/hidden/);
}

async function finishRoundForBoth(hostPage, guestPage) {
    await hostPage.locator('#action-finish-round-btn').click();
    await guestPage.locator('#action-finish-round-btn').click();
}

test('host and guest can join the same lobby and become ready', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomId = await createRoom(hostPage, 'Host');
    await joinRoomByUrl(guestPage, roomId, 'Guest');

    await expect(hostPage.locator('#player-list li')).toHaveCount(2, { timeout: 10_000 });
    await expect(guestPage.locator('#player-list li')).toHaveCount(2, { timeout: 10_000 });

    await readyBothPlayers(hostPage, guestPage);

    await hostContext.close();
    await guestContext.close();
});

test('manual mode exposes finish-round button to both players after start', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomId = await createRoom(hostPage, 'Host');
    await hostPage.locator('#lobby-auto-resolve-select').selectOption('manual');
    await joinRoomByUrl(guestPage, roomId, 'Guest');

    await readyBothPlayers(hostPage, guestPage);
    await startMatch(hostPage);

    await expect(guestPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });
    await expect(hostPage.locator('#action-finish-round-btn')).toBeVisible({ timeout: 20_000 });
    await expect(guestPage.locator('#action-finish-round-btn')).toBeVisible({ timeout: 20_000 });
    await expect(hostPage.locator('#action-bar-header')).toContainText('手动结算');
    await expect(guestPage.locator('#action-bar-header')).toContainText('等待全员结束');

    await hostPage.locator('#action-finish-round-btn').click();
    await expect(hostPage.locator('#action-finish-round-btn')).toContainText('已结束回合');
    await expect(hostPage.locator('#action-finish-round-btn')).toBeDisabled();
    await expect(hostPage.locator('#action-ready-summary')).toContainText('Guest');
    await expect(guestPage.locator('#action-ready-summary')).toContainText('Guest');

    await guestPage.locator('#action-finish-round-btn').click();

    await expectRoundHeader(hostPage, 2);
    await expectRoundHeader(guestPage, 2);
    await expect(hostPage.locator('#action-finish-round-btn')).toContainText('结束回合');
    await expect(guestPage.locator('#action-finish-round-btn')).toContainText('结束回合');

    await hostContext.close();
    await guestContext.close();
});

test('pending attack selection can be replaced by another action without getting stuck', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomId = await createRoom(hostPage, 'Host');
    await hostPage.locator('#lobby-auto-resolve-select').selectOption('manual');
    await joinRoomByUrl(guestPage, roomId, 'Guest');

    await readyBothPlayers(hostPage, guestPage);
    await startMatch(hostPage);
    await finishRoundForBoth(hostPage, guestPage);
    await expectRoundHeader(hostPage, 2);

    await hostPage.getByRole('button', { name: /小波/ }).click();
    await expect(hostPage.locator('#action-bar-status')).toContainText('小波 (待选目标)');

    await hostPage.getByRole('button', { name: /防御/ }).click();
    await expect(hostPage.locator('#action-bar-status')).toContainText('防御');
    await expect(hostPage.locator('#action-bar-status')).not.toContainText('待选目标');

    await hostContext.close();
    await guestContext.close();
});

test('auto mode shows countdown on both players and advances to the next round', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomId = await createRoom(hostPage, 'Host');
    await hostPage.locator('#lobby-auto-resolve-select').selectOption('auto');
    await hostPage.locator('#lobby-round-time-input').fill('2');
    await hostPage.locator('#lobby-round-time-input').blur();
    await joinRoomByUrl(guestPage, roomId, 'Guest');

    await readyBothPlayers(hostPage, guestPage);
    await startMatch(hostPage);

    await expect(guestPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });
    await expectAutoCountdownReady(hostPage);
    await expectAutoCountdownReady(guestPage);
    await expectRoundHeader(hostPage, 2);
    await expectRoundHeader(guestPage, 2);
    await expectAutoCountdownReady(hostPage);
    await expectAutoCountdownReady(guestPage);

    await hostContext.close();
    await guestContext.close();
});

test('manual attack flow ends the match and returns both players to the lobby', async ({ browser }, testInfo) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomId = await createRoom(hostPage, 'Host');
    await hostPage.locator('#lobby-auto-resolve-select').selectOption('manual');
    await joinRoomByUrl(guestPage, roomId, 'Guest');

    await readyBothPlayers(hostPage, guestPage);
    await startMatch(hostPage);
    await expect(guestPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });

    await finishRoundForBoth(hostPage, guestPage);
    await expectRoundHeader(hostPage, 2);
    await expectRoundHeader(guestPage, 2);
    await expect(hostPage.locator('#action-bar-status')).toContainText('气 1', { timeout: 10_000 });
    await expect(guestPage.locator('#action-bar-status')).toContainText('气 1', { timeout: 10_000 });

    await selectAttackTarget(hostPage, 'Guest');
    await finishRoundForBoth(hostPage, guestPage);

    await expect.poll(async () => hostPage.evaluate(() => window.game?.gameState), { timeout: 10_000 }).toBe('ended');
    await expect.poll(async () => guestPage.evaluate(() => window.game?.gameState), { timeout: 10_000 }).toBe('ended');

    await hostPage.screenshot({ path: testInfo.outputPath('manual-end-host.png'), fullPage: true });
    await guestPage.screenshot({ path: testInfo.outputPath('manual-end-guest.png'), fullPage: true });

    await waitForLobbyReturn(hostPage);
    await waitForLobbyReturn(guestPage);
    await expect(hostPage.locator('#start-game-btn-active')).toBeVisible({ timeout: 10_000 });
    await expect(hostPage.locator('#lobby-status')).toContainText('所有玩家已准备', { timeout: 10_000 });
    await expect(guestPage.locator('#lobby-status')).toContainText('等待房主开始游戏', { timeout: 10_000 });

    await hostContext.close();
    await guestContext.close();
});

test('players can start a second match after returning to the lobby', async ({ browser }, testInfo) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomId = await createRoom(hostPage, 'Host');
    await hostPage.locator('#lobby-auto-resolve-select').selectOption('manual');
    await joinRoomByUrl(guestPage, roomId, 'Guest');

    await readyBothPlayers(hostPage, guestPage);
    await startMatch(hostPage);
    await finishRoundForBoth(hostPage, guestPage);
    await expectRoundHeader(hostPage, 2);

    await selectAttackTarget(hostPage, 'Guest');
    await finishRoundForBoth(hostPage, guestPage);
    await waitForLobbyReturn(hostPage);
    await waitForLobbyReturn(guestPage);

    await hostPage.locator('#start-game-btn-active').click();
    await expect(hostPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });
    await expect(guestPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });
    await expect(hostPage.locator('#action-bar-header')).toContainText('回合 1');
    await expect(guestPage.locator('#action-bar-header')).toContainText('回合 1');

    await hostPage.screenshot({ path: testInfo.outputPath('second-match-host.png'), fullPage: true });
    await guestPage.screenshot({ path: testInfo.outputPath('second-match-guest.png'), fullPage: true });

    await hostContext.close();
    await guestContext.close();
});

test('stale ended snapshot does not poison the next game start', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomId = await createRoom(hostPage, 'Host');
    await hostPage.locator('#lobby-auto-resolve-select').selectOption('manual');
    await joinRoomByUrl(guestPage, roomId, 'Guest');

    await readyBothPlayers(hostPage, guestPage);
    await startMatch(hostPage);
    await finishRoundForBoth(hostPage, guestPage);
    await expectRoundHeader(hostPage, 2);
    await selectAttackTarget(hostPage, 'Guest');
    await finishRoundForBoth(hostPage, guestPage);
    await waitForLobbyReturn(hostPage);
    await waitForLobbyReturn(guestPage);

    await hostPage.evaluate(() => {
        window.lobby.lastSnapshot = {
            round: 99,
            state: 'ended',
            gameState: 'ended',
            isRunning: false,
            logs: [{ round: 99, message: 'stale-ended' }],
            players: [],
        };
    });

    await hostPage.locator('#start-game-btn-active').click();
    await expect(hostPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });
    await expect(guestPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });
    await expect(hostPage.locator('#action-bar-header')).toContainText('回合 1');
    await expect(guestPage.locator('#action-bar-header')).toContainText('回合 1');
    await expect.poll(async () => hostPage.evaluate(() => window.game?.gameState), { timeout: 10_000 }).toBe('selecting');

    await hostContext.close();
    await guestContext.close();
});

test('manual match end then switch to auto still loads opponent and animations on next start', async ({ browser }, testInfo) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomId = await createRoom(hostPage, 'Host');
    await hostPage.locator('#lobby-auto-resolve-select').selectOption('manual');
    await joinRoomByUrl(guestPage, roomId, 'Guest');

    await readyBothPlayers(hostPage, guestPage);
    await startMatch(hostPage);
    await finishRoundForBoth(hostPage, guestPage);
    await expectRoundHeader(hostPage, 2);
    await selectAttackTarget(hostPage, 'Guest');
    await finishRoundForBoth(hostPage, guestPage);
    await waitForLobbyReturn(hostPage);
    await waitForLobbyReturn(guestPage);

    await hostPage.locator('#lobby-auto-resolve-select').selectOption('auto');
    await hostPage.locator('#lobby-round-time-input').fill('2');
    await hostPage.locator('#lobby-round-time-input').blur();

    await expect(hostPage.locator('#player-list li')).toHaveCount(2, { timeout: 10_000 });
    await expect(guestPage.locator('#player-list li')).toHaveCount(2, { timeout: 10_000 });
    await hostPage.locator('#start-game-btn-active').click();

    await expect(hostPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });
    await expect(guestPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });
    await expect(hostPage.locator('#action-bar-header')).toContainText('倒计时：', { timeout: 20_000 });
    await expect(guestPage.locator('#action-bar-header')).toContainText('倒计时：', { timeout: 20_000 });
    await expectOpponentHudLoaded(hostPage);
    await expectOpponentHudLoaded(guestPage);
    await waitForCanvasPaint(hostPage);
    await waitForCanvasPaint(guestPage);

    await hostPage.screenshot({ path: testInfo.outputPath('second-match-auto-host-hud.png'), fullPage: true });
    await guestPage.screenshot({ path: testInfo.outputPath('second-match-auto-guest-hud.png'), fullPage: true });

    await expect.poll(async () => hostPage.evaluate(() => (window.game?.players || []).length), { timeout: 10_000 }).toBe(2);
    await expect.poll(async () => guestPage.evaluate(() => (window.game?.players || []).length), { timeout: 10_000 }).toBe(2);

    await expectRoundHeader(hostPage, 2);
    await expectRoundHeader(guestPage, 2);
    await selectAttackTarget(hostPage, 'Guest');
    await guestPage.getByRole('button', { name: /防御/ }).click();
    await expectResolvingAnimation(hostPage);
    await expectResolvingAnimation(guestPage);
    await waitForCanvasPaint(hostPage);
    await waitForCanvasPaint(guestPage);

    await hostPage.screenshot({ path: testInfo.outputPath('second-match-auto-host-animation.png'), fullPage: true });
    await guestPage.screenshot({ path: testInfo.outputPath('second-match-auto-guest-animation.png'), fullPage: true });

    await hostContext.close();
    await guestContext.close();
});

test('second start uses server players even if local lobby cache is stale', async ({ browser }) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const hostPage = await hostContext.newPage();
    const guestPage = await guestContext.newPage();

    const roomId = await createRoom(hostPage, 'Host');
    await hostPage.locator('#lobby-auto-resolve-select').selectOption('manual');
    await joinRoomByUrl(guestPage, roomId, 'Guest');

    await readyBothPlayers(hostPage, guestPage);
    await startMatch(hostPage);
    await finishRoundForBoth(hostPage, guestPage);
    await expectRoundHeader(hostPage, 2);
    await selectAttackTarget(hostPage, 'Guest');
    await finishRoundForBoth(hostPage, guestPage);
    await waitForLobbyReturn(hostPage);
    await waitForLobbyReturn(guestPage);

    await hostPage.evaluate(() => {
        const self = window.lobby.serverPlayers.find((player) => player.id === window.lobby.playerId);
        window.lobby.serverPlayers = self ? [self] : [];
    });

    await hostPage.locator('#start-game-btn-active').click();
    await expect(hostPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });
    await expect(guestPage.locator('#action-bar')).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => hostPage.evaluate(() => (window.game?.players || []).length), { timeout: 10_000 }).toBe(2);
    await expect.poll(async () => guestPage.evaluate(() => (window.game?.players || []).length), { timeout: 10_000 }).toBe(2);

    await hostContext.close();
    await guestContext.close();
});

test('three-match loop stability (start → play → end) repeated 3 times', async ({ browser }) => {
    const s = await setupHostGuest(browser, 'Host', 'Guest', { autoMode: 'manual' });

    try {
        for (let match = 1; match <= 3; match++) {
            // Make sure both players ready and start
            await readyBothPlayers(s.hostPage, s.guestPage);
            await startMatch(s.hostPage);

            // Play two-round sequence: first round finish, then decisive attack
            await finishRoundForBoth(s.hostPage, s.guestPage);
            await expectRoundHeader(s.hostPage, 2);

            await selectAttackTarget(s.hostPage, 'Guest');
            await finishRoundForBoth(s.hostPage, s.guestPage);

            // Wait for match to end and both return to lobby
            await expect.poll(async () => s.hostPage.evaluate(() => window.game?.gameState), { timeout: 10_000 }).toBe('ended');
            await expect.poll(async () => s.guestPage.evaluate(() => window.game?.gameState), { timeout: 10_000 }).toBe('ended');

            await waitForLobbyReturn(s.hostPage);
            await waitForLobbyReturn(s.guestPage);
        }
    } finally {
        await s.cleanup();
    }
});