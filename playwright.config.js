import { existsSync } from 'fs';
import { defineConfig, devices } from '@playwright/test';

const HOST = '127.0.0.1';
const APP_PORT = 33173;
const SERVER_PORT = 33100;
const STACK_PORT = 33400;
const edgeCandidates = [
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const hasEdgeChannel = process.platform === 'win32' && edgeCandidates.some((path) => existsSync(path));

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: `http://${HOST}:${APP_PORT}`,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        headless: true,
    },
    webServer: {
        command: 'node scripts/playwright-dev-stack.mjs',
        url: `http://${HOST}:${STACK_PORT}/ready`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
            ...process.env,
            HOST,
            PW_APP_PORT: String(APP_PORT),
            PW_STACK_PORT: String(STACK_PORT),
            PW_SERVER_PORT: String(SERVER_PORT),
        },
    },
    projects: [
        hasEdgeChannel
            ? {
                name: 'msedge',
                use: { ...devices['Desktop Chrome'], channel: 'msedge' },
            }
            : {
                name: 'chromium',
                use: { ...devices['Desktop Chrome'] },
            },
    ],
});