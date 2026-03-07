// src/managers/CombatManager.js
// A minimal, robust combat/round manager to centralize round processing.

import { StrategyFactory } from '../strategies/StrategyFactory.js';
import { ActionType } from '../core/enums/ActionType.js';

export class CombatManager {
  constructor(game) {
    this.game = game;
    this.resolveDisplayMs = 900;
  }

  // Process one round: validate selections, resolve interactions, update energy/health, advance round/state
  async processRound() {
    const core = this.game;
    if (!core || !core.isRunning) return;
    if (core.gameState === 'resolving') return;

    const lifecycleVersion = core.lifecycleVersion;
    core.clearResolveTimer();

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
        try {
          // default silently to STORE_1 to keep flow smooth
          p.selectAction('STORE_1', null);
        } catch (e) {
          console.warn('[Combat] Failed to set default action for', p.name);
        }
      }
    });

    // Log each player's selected action for the battle log panel.
    players.forEach(p => {
      const actionName = p.currentAction?.name || '储气';
      const targetName = p.target?.name ? ` -> ${p.target.name}` : '';
      core.addLog(`${p.name} 选择了 ${actionName}${targetName}`);
    });

    // Pairwise resolution: for each attacker with ATTACK target, resolve against target's action via strategy
    const logs = [];
    players.forEach(attacker => {
      if (!attacker.currentAction) return;
      if (attacker.currentAction.type === ActionType.ATTACK) {
        const target = attacker.target;
        // Debug log
        // attack resolution (no verbose log)

        if (target && typeof target === 'object' && target.isAlive) {
          const strategy = StrategyFactory.getStrategyForActions(attacker.currentAction, target.currentAction);
          const result = strategy.execute(attacker, target);
          if (result && result.message) logs.push(result.message);
        } else {
          console.warn(`[Combat] Target invalid or dead:`, target);
        }
      }
    });

    // Post-resolution: adjust energy, keep selected actions for a short resolving window.
    players.forEach(p => {
      try { p.adjustEnergy(); } catch (_) { }
    });

    // Append logs to core
    logs.forEach(msg => core.addLog(msg));

    // If this round can end the game, keep resolving visuals visible for a short beat.
    const willEnd = core.getAlivePlayers().length <= 1;
    if (willEnd) {
      const isStillValid = await core.wait(this.resolveDisplayMs, lifecycleVersion);
      if (!isStillValid) return;
      core.checkGameEnd();
      core.store?.updateState(core.getGameState());
      return;
    }

    // Keep resolving state visible to ensure animation managers can render effects.
    const isStillValid = await core.wait(this.resolveDisplayMs, lifecycleVersion);
    if (!isStillValid || !core.isRunning || core.gameState !== 'resolving') return;

    players.forEach(p => {
      p.resetRound?.();
    });

    // Prepare next round
    core.prepareNextRound();
    // Sync snapshot for UI/network
    core.store?.updateState(core.getGameState());
  }
}