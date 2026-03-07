import { Player } from '../src/core/Player.js';
import { StrategyFactory } from '../src/strategies/StrategyFactory.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function createPlayer(id, name, energy = 5) {
    return new Player(id, name, 1, energy);
}

function select(player, actionKey, target = null) {
    player.selectAction(actionKey, target);
}

function runStrategy(attacker, defender) {
    const strategy = StrategyFactory.getStrategyForActions(attacker.currentAction, defender.currentAction);
    return strategy.execute(attacker, defender);
}

function testAttackVsAttackHigherLevel() {
    const attacker = createPlayer(1, 'Attacker');
    const defender = createPlayer(2, 'Defender');
    select(attacker, 'ATTACK_2', defender);
    select(defender, 'ATTACK_1', attacker);

    const result = runStrategy(attacker, defender);

    assert(result.type === 'attack-hit', 'ATTACK_2 vs ATTACK_1 should be attack-hit');
    assert(result.damage === 2, 'ATTACK_2 should deal 2 damage against weaker attack');
    assert(defender.health === -1, 'Defender should lose 2 health');
    assert(defender.isAlive === false, 'Defender should die from stronger attack');
}

function testAttackVsAttackSameLevel() {
    const attacker = createPlayer(1, 'Attacker');
    const defender = createPlayer(2, 'Defender');
    select(attacker, 'ATTACK_1', defender);
    select(defender, 'ATTACK_1', attacker);

    const result = runStrategy(attacker, defender);

    assert(result.type === 'mutual-cancel', 'Equal attacks should cancel');
    assert(attacker.health === 1, 'Attacker health should remain unchanged on cancel');
    assert(defender.health === 1, 'Defender health should remain unchanged on cancel');
}

function testAttackVsDefend() {
    const attacker = createPlayer(1, 'Attacker');
    const defender = createPlayer(2, 'Defender');
    select(attacker, 'ATTACK_2', defender);
    select(defender, 'DEFEND_1');

    const result = runStrategy(attacker, defender);

    assert(result.type === 'attack-break-defense', 'ATTACK_2 should break DEFEND_1');
    assert(result.damage === 1, 'ATTACK_2 against DEFEND_1 should deal 1 net damage');
    assert(defender.health === 0, 'Defender should lose 1 health');
    assert(defender.isAlive === false, 'Defender should be dead after net damage 1');
}

function testAttackVsRebound() {
    const attacker = createPlayer(1, 'Attacker');
    const defender = createPlayer(2, 'Defender');
    select(attacker, 'ATTACK_1', defender);
    select(defender, 'REBOUND_1');

    const result = runStrategy(attacker, defender);

    assert(result.type === 'rebound-success', 'ATTACK_1 vs REBOUND_1 should rebound successfully');
    assert(result.damage === 0, 'Successful rebound should reduce ATTACK_1 damage to 0');
    assert(result.reboundDamage === 1, 'Successful rebound should deal 1 reflected damage');
    assert(attacker.health === 0, 'Attacker should lose 1 reflected health');
    assert(attacker.isAlive === false, 'Attacker should die from reflected damage');
    assert(defender.health === 1, 'Defender should take no damage after full reduction');
}

function testDefaultStrategyWithoutDefenseAction() {
    const attacker = createPlayer(1, 'Attacker');
    const defender = createPlayer(2, 'Defender');
    select(attacker, 'ATTACK_1', defender);

    const strategy = StrategyFactory.getStrategyForActions(attacker.currentAction, null);
    const result = strategy.execute(attacker, defender);

    assert(result.type === 'direct-hit', 'Missing defense action should use direct-hit strategy');
    assert(result.damage === 1, 'Default direct hit should deal 1 damage');
    assert(defender.health === 0, 'Defender should lose 1 health from direct hit');
    assert(defender.isAlive === false, 'Defender should die from direct hit');
}

function main() {
    testAttackVsAttackHigherLevel();
    testAttackVsAttackSameLevel();
    testAttackVsDefend();
    testAttackVsRebound();
    testDefaultStrategyWithoutDefenseAction();
    console.log('Strategy regression test passed');
}

main();