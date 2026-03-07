import { io } from 'socket.io-client';

const SERVER_URL = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3000';
const TIMEOUT_MS = 8000;

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, label, timeoutMs = TIMEOUT_MS) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: ${label}`)), timeoutMs)),
    ]);
}

function createClient(name) {
    const socket = io(SERVER_URL, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        timeout: 5000,
        reconnection: false,
    });

    const events = [];
    const onAny = (event, ...args) => {
        events.push({ event, args, at: Date.now() });
    };
    socket.onAny(onAny);

    return {
        name,
        socket,
        events,
        async connected() {
            await withTimeout(new Promise((resolve, reject) => {
                if (socket.connected) return resolve();
                socket.once('connect', resolve);
                socket.once('connect_error', reject);
            }), `${name} connect`);
        },
        destroy() {
            socket.offAny(onAny);
            socket.disconnect();
        },
    };
}

function waitForEvent(client, eventName, predicate = () => true, timeoutMs = TIMEOUT_MS) {
    return withTimeout(new Promise((resolve) => {
        const existing = client.events.find((entry) => entry.event === eventName && predicate(...entry.args));
        if (existing) {
            resolve(existing.args);
            return;
        }

        const handler = (...args) => {
            if (!predicate(...args)) return;
            client.socket.off(eventName, handler);
            resolve(args);
        };
        client.socket.on(eventName, handler);
    }), `${client.name} -> ${eventName}`, timeoutMs);
}

async function setupRoom(modeLabel, settings) {
    const host = createClient(`${modeLabel}-host`);
    const guest = createClient(`${modeLabel}-guest`);

    await Promise.all([host.connected(), guest.connected()]);

    host.socket.emit('createRoom', { name: `${modeLabel}-Host`, playerKey: `${modeLabel}-host-key` });
    const [roomId] = await waitForEvent(host, 'roomCreated');

    guest.socket.emit('joinRoom', { roomId, name: `${modeLabel}-Guest`, playerKey: `${modeLabel}-guest-key` });
    await waitForEvent(guest, 'roomState', (roomState) => roomState.roomId === roomId && roomState.players.length >= 2);
    await waitForEvent(host, 'roomState', (roomState) => roomState.roomId === roomId && roomState.players.length >= 2);

    host.socket.emit('toggleReady');
    guest.socket.emit('toggleReady');

    await waitForEvent(host, 'roomState', (roomState) => roomState.players.length >= 2 && roomState.players.every((player) => player.ready));
    await waitForEvent(guest, 'roomState', (roomState) => roomState.players.length >= 2 && roomState.players.every((player) => player.ready));

    host.socket.emit('startGame', roomId, settings);
    await Promise.all([
        waitForEvent(host, 'gameStarted', (roomState) => roomState.roomId === roomId),
        waitForEvent(guest, 'gameStarted', (roomState) => roomState.roomId === roomId),
    ]);

    return { host, guest, roomId };
}

async function runAutoScenario() {
    const settings = { autoResolve: true, roundTimeMs: 4000 };
    const { host, guest } = await setupRoom('auto', settings);

    try {
        const [[hostRoundStarted], [guestRoundStarted]] = await Promise.all([
            waitForEvent(host, 'roundStarted'),
            waitForEvent(guest, 'roundStarted'),
        ]);

        if (!hostRoundStarted.autoResolve || !guestRoundStarted.autoResolve) {
            throw new Error('Auto scenario did not propagate autoResolve=true');
        }
        if (typeof hostRoundStarted.resolveAt !== 'number' || typeof guestRoundStarted.resolveAt !== 'number') {
            throw new Error('Auto scenario did not provide numeric resolveAt');
        }
        if (hostRoundStarted.roundTimeMs !== settings.roundTimeMs || guestRoundStarted.roundTimeMs !== settings.roundTimeMs) {
            throw new Error('Auto scenario roundTimeMs mismatch');
        }

        console.log('[auto] roundStarted ok', {
            hostResolveAt: hostRoundStarted.resolveAt,
            guestResolveAt: guestRoundStarted.resolveAt,
            deltaMs: Math.abs(hostRoundStarted.resolveAt - guestRoundStarted.resolveAt),
        });
    } finally {
        host.destroy();
        guest.destroy();
    }
}

async function runManualScenario() {
    const settings = { autoResolve: false, roundTimeMs: 4000 };
    const { host, guest, roomId } = await setupRoom('manual', settings);

    try {
        const [[hostRoundStarted], [guestRoundStarted]] = await Promise.all([
            waitForEvent(host, 'roundStarted'),
            waitForEvent(guest, 'roundStarted'),
        ]);

        if (hostRoundStarted.autoResolve || guestRoundStarted.autoResolve) {
            throw new Error('Manual scenario did not propagate autoResolve=false');
        }
        if (hostRoundStarted.resolveAt != null || guestRoundStarted.resolveAt != null) {
            throw new Error('Manual scenario should not include resolveAt');
        }

        host.socket.emit('setRoundReady', roomId, true);
        guest.socket.emit('setRoundReady', roomId, true);

        const [[hostResolveRequested], [guestResolveRequested]] = await Promise.all([
            waitForEvent(host, 'roundResolveRequested', ({ reason }) => reason === 'all-ready'),
            waitForEvent(guest, 'roundResolveRequested', ({ reason }) => reason === 'all-ready'),
        ]);

        console.log('[manual] roundResolveRequested ok', {
            hostReason: hostResolveRequested.reason,
            guestReason: guestResolveRequested.reason,
        });
    } finally {
        host.destroy();
        guest.destroy();
    }
}

async function main() {
    console.log(`Running multiplayer smoke test against ${SERVER_URL}`);
    await runAutoScenario();
    await wait(150);
    await runManualScenario();
    console.log('Smoke test passed');
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});