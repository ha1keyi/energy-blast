// src/managers/CombatManager.js
// A minimal, robust combat/round manager to centralize round processing.

import { StrategyFactory } from '../strategies/StrategyFactory.js';
import { ActionType } from '../core/enums/ActionType.js';

export class CombatManager {
  constructor(game) {
    this.game = game;
  }

  // Process one round: validate selections, resolve interactions, update energy/health, advance round/state
  async processRound() {
    const core = this.game;
    if (!core || !core.isRunning) return;

    // Transition to resolving
    core.gameState = 'resolving';
    core.nextFrame();

    const players = core.players.filter(p => p.isAlive);
    // Safety: if less than 2 alive, end
    if (players.length < 2) {
      if (core.checkGameEnd()) return;
    }

    // Validate selections; if someone has no action, default to defend (energy cost 0 assumed) to keep flow robust
    players.forEach(p => {
      if (!p.currentAction) {
        try { p.selectAction('DEFEND', null); } catch(_) {}
      }
    });

    // Pairwise resolution: for each attacker with ATTACK target, resolve against target's action via strategy
    const logs = [];
    players.forEach(attacker => {
      if (!attacker.currentAction) return;
      if (attacker.currentAction.type === ActionType.ATTACK) {
        const target = attacker.target;
        if (target && target.isAlive) {
          const strategy = StrategyFactory.getStrategyForActions(attacker.currentAction, target.currentAction);
          const result = strategy.execute(attacker, target);
          if (result && result.message) logs.push(result.message);
        }
      }
    });

    // Post-resolution: adjust energy, clear selections
    players.forEach(p => {
      try { p.adjustEnergy(); } catch(_) {}
      p.resetRound?.();
    });

    // Append logs to core
    logs.forEach(msg => core.addLog(msg));

    // Check end
    if (core.checkGameEnd()) {
      // Sync final snapshot
      core.store?.updateState(core.getGameState());
      return;
    }

    // Prepare next round
    core.prepareNextRound();
    // Sync snapshot for UI/network
    core.store?.updateState(core.getGameState());
  }
}