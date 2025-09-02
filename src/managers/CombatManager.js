// 负责整轮结算：解析行动、计算伤害与能量变化、产出 RoundReport、展示结算画面并推进下一回合
import { ActionType } from '../core/enums/ActionType.js';

export class CombatManager {
    constructor(game) {
        this.game = game; // window.game
    }

    async processRound() {
        const game = this.game;
        if (!game?.players?.length) return;

        // 1) 进入结算阶段，展示结算中标记
        game.gameState = 'resolving';
        game.roundResolutionManager?.onResolvingStart();
        game.debugUIManager?.updateGameState?.();

        // 2) 汇总统计（为回合报告做准备）
        const stats = new Map();
        game.players.forEach(p => {
            stats.set(p.id, {
                playerId: p.id,
                name: p.name,
                action: p.currentAction?.name || '无',
                actionType: p.currentAction?.type || null,
                targetId: p.target?.id || null,
                targetName: p.target?.name || null,
                damageDealt: 0,
                damageTaken: 0,
                reduced: 0,
                reboundDealt: 0,
                energyBefore: p.energy,
                energyAfter: p.energy,
                healthBefore: p.health,
                healthAfter: p.health,
                ko: false
            });
        });

        // 3) 防御/储能提示
        for (const player of game.players) {
            if (player.currentAction?.type === ActionType.DEFEND) {
                game.addLog(`${player.name} 进行了防御。`);
            } else if (player.currentAction?.type === ActionType.STORE) {
                game.addLog(`${player.name} 选择了储能。`);
            }
        }

        // 4) 攻击阶段
        for (const attacker of game.players) {
            if (!(attacker.currentAction && attacker.currentAction.type === ActionType.ATTACK && attacker.target)) continue;

            const attackee = attacker.target;
            const attackAction = attacker.currentAction;
            const result = attackee.handleAttack(attackAction, attacker);
            if (!result) continue;

            const segments = [];
            segments.push(`${attacker.name} 使用 ${attackAction.name} 对 ${attackee.name} 造成 ${result.actualDamage} 伤害`);
            if (result.reduction > 0) segments.push(`（被防御减免 ${result.reduction}）`);
            if (result.reboundToAttacker > 0) segments.push(`；反弹 ${result.reboundToAttacker} 伤害给 ${attacker.name}`);
            game.addLog(segments.join(''));

            const atkStat = stats.get(attacker.id);
            const defStat = stats.get(attackee.id);
            if (atkStat) {
                atkStat.damageDealt += result.actualDamage;
                atkStat.reboundDealt += result.reboundToAttacker || 0;
                atkStat.healthAfter = attacker.health;
            }
            if (defStat) {
                defStat.damageTaken += result.actualDamage;
                defStat.reduced += result.reduction || 0;
                defStat.healthAfter = attackee.health;
                defStat.ko = attackee.health <= 0;
            }
        }

        // 5) 能量阶段
        for (const player of game.players) {
            const a = player.currentAction;
            const st = stats.get(player.id);
            if (!st) continue;

            if (a && a.type === ActionType.STORE) {
                const before = player.energy;
                const gain = a.getEnergyGain();
                player.recoverEnergy(gain);
                game.addLog(`${player.name} 储能 +${gain} 气（${before} → ${player.energy}）`);
            } else if (a) {
                const before = player.energy;
                const cost = a.energyCost || 0;
                player.adjustEnergy();
                game.addLog(`${player.name} 消耗 ${cost} 气（${before} → ${player.energy}）`);
            }
            st.energyAfter = player.energy;
        }

        // 6) 生成本回合报告
        const report = {
            round: game.currentRound,
            entries: Array.from(stats.values())
        };
        game.store?.addRoundReport?.(report);

        // 7) 展示结算画面（自动/手动均可）
        await game.roundResolutionManager?.showRoundResult(report, {
            auto: !!game.debugUIManager?.isAutoResolve
        });

        // 8) 清理行动并刷新 UI
        game.players.forEach(p => p.resetRound());
        game.debugUIManager?.updatePlayerList?.();

        // 9) 检查结束并准备下一回合
        game.checkGameEnd();
        if (game.isRunning) {
            game.prepareNextRound();
        }
    }
}