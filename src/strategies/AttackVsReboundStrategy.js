import { ActionStrategy } from './ActionStrategy.js';

export class AttackVsReboundStrategy extends ActionStrategy {
    execute(attacker, attackee) {
        const attackAction = attacker.currentAction;
        const defenseAction = attackee.currentAction;

        if (defenseAction.level >= attackAction.level) {
            // 成功反弹（更名为反弹 Rebound）
            const attackDamage = attackAction.getActualDamage();
            const defenseReduction = defenseAction.getActualReduction();
            const actualDamage = this.calculateDamage(attackDamage, defenseReduction);
            const reboundDamage = defenseAction.getActualReboundDamage();

            attackee.takeDamage(actualDamage);
            attacker.takeDamage(reboundDamage);

            return {
                message: `${attackee.name}反弹了${attacker.name}的攻击，受到${actualDamage}点伤害，并反弹${reboundDamage}点伤害`,
                damage: actualDamage,
                reboundDamage: reboundDamage,
                type: 'rebound-success'
            };
        } else {
            // 反弹失败
            const damage = attackAction.getActualDamage();
            attackee.takeDamage(damage);

            return {
                message: `${attackee.name}的反弹失败，受到${damage}点伤害`,
                damage: damage,
                type: 'rebound-fail'
            };
        }
    }
}
