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