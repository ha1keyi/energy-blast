import { Game } from '../src/core/Game.js';
import { BattleFlowCoordinator } from '../src/managers/BattleFlowCoordinator.js';

function createClassList() {
    const values = new Set();
    return {
        add: (...names) => names.forEach((name) => values.add(name)),
        remove: (...names) => names.forEach((name) => values.delete(name)),
        contains: (name) => values.has(name),
    };
}

function createElementStub() {
    return {
        dataset: {},
        classList: createClassList(),
        innerHTML: '',
        appendChild() { },
    };
}

function setupGlobals() {
    globalThis.window = {
        pendingAttack: null,
        localPlayerId: null,
        lobby: {
            connected: true,
            roomId: 'room-test',
            isHost: () => false,
        },
    };

    globalThis.document = {
        getElementById: () => null,
        createElement: () => ({
            id: '',
            className: '',
            textContent: '',
            disabled: false,
            innerHTML: '',
            onclick: null,
            appendChild() { },
        }),
    };
}

function createCoordinator(gameCore) {
    const lobbyManager = {
        connected: true,
        roomId: 'room-test',
        socket: { emit() { }, on() { }, off() { } },
        isHost: () => false,
        getSelf: () => ({ id: 'guest-socket', name: 'Guest' }),
        playerId: 'guest-socket',
        playerName: 'Guest',
        list: () => [
            { id: 'host-socket', name: 'Host', ready: true },
            { id: 'guest-socket', name: 'Guest', ready: true },
        ],
        getRoomSettings: () => ({ autoResolve: true, roundTimeMs: 4000 }),
        subscribe() { return () => { }; },
    };

    return new BattleFlowCoordinator({
        gameCore,
        phaserGame: { scene: { isActive: () => false, stop() { }, start() { } } },
        lobbyManager,
        debugUI: { updateGameState() { }, updatePlayerList() { }, syncControlStateFromGame() { } },
        elements: {
            gameCanvasEl: createElementStub(),
            actionBarEl: createElementStub(),
            homeScreen: createElementStub(),
            lobbyScreen: createElementStub(),
        },
        imageMap: {},
        showToast() { },
        renderLobby() { },
    });
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function seedPlayers(game) {
    game.addPlayer('Host', { networkId: 'host-socket' });
    game.addPlayer('Guest', { networkId: 'guest-socket' });
}

function testAutoModeProvisionalCountdown() {
    const game = new Game();
    game.applyMatchSettings({ autoResolve: true, roundTimeMs: 4000 }, { reschedule: false });
    seedPlayers(game);
    game.startGame();

    assert(typeof game.nextResolveAt === 'number', 'Auto mode should set a provisional display deadline');
    assert(game.nextResolveAt > Date.now(), 'Auto mode display deadline should be in the future');
}

function testManualModeHeader() {
    const game = new Game();
    seedPlayers(game);
    game.startGame();
    const coordinator = createCoordinator(game);
    coordinator.applyNetworkRoundStart({ round: 1, autoResolve: false, roundTimeMs: 4000, resolveAt: null });
    const label = coordinator.getActionHeaderLabel(false);

    assert(game.autoResolveEnabled === false, 'Manual mode should disable auto resolve');
    assert(game.nextResolveAt == null, 'Manual mode should not set a display deadline');
    assert(label.includes('等待全员结束'), 'Manual mode header should show end-turn status');
    assert(!label.includes('同步中'), 'Manual mode header should not show syncing countdown');
}

function main() {
    setupGlobals();
    testAutoModeProvisionalCountdown();
    testManualModeHeader();
    console.log('Battle flow headless test passed');
}

main();