import { ActionStrategy } from './ActionStrategy.js';

export class AttackVsDefendStrategy extends ActionStrategy {
    execute(attacker, attackee) {
        const attackAction = attacker.currentAction;
        const attackeeAction = attackee.currentAction;

        if (attackeeAction.level < attackAction.level) {
            // 防御等级低于攻击等级
            const attackDamage = attackAction.getActualDamage();
            const defenseReduction = attackeeAction.getActualReduction();
            const actualDamage = this.calculateDamage(attackDamage, defenseReduction);

            attackee.handleAttack(actualDamage);

            return {
                message: `${attacker.name}的攻击突破了${attackee.name}的防御，造成${actualDamage}点伤害`,
                damage: actualDamage,
                type: 'attack-break-defense'
            };
        } else {
            // 成功防御
            return {
                message: `${attackee.name}成功防御了${attacker.name}的攻击`,
                damage: 0,
                type: 'defense-success'
            };
        }
    }
}
