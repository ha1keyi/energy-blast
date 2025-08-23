import { ActionStrategy } from './ActionStrategy.js';

export class AttackVsReflectStrategy extends ActionStrategy {
    execute(attacker, attackee) {
        const attackAction = attacker.currentAction;
        const attackeeAction = attackee.currentAction;

        if (attackeeAction.level >= attackAction.level) {
            // 成功反弹
            const attackDamage = attackAction.getActualDamage();
            const defenseReduction = attackeeAction.getActualReduction();
            const actualDamage = this.calculateDamage(attackDamage, defenseReduction);
            const reflectDamage = attackeeAction.getActualReflectDamage();

            attackee.takeDamage(actualDamage);
            attacker.takeDamage(reflectDamage);

            return {
                message: `${attackee.name}反弹了${attacker.name}的攻击，受到${actualDamage}点伤害，反弹${reflectDamage}点伤害`,
                damage: actualDamage,
                reflectDamage: reflectDamage,
                type: 'reflect-success'
            };
        } else {
            // 反弹失败
            const damage = attackAction.getActualDamage();
            attackee.takeDamage(damage);

            return {
                message: `${attackee.name}的反弹失败，受到${damage}点伤害`,
                damage: damage,
                type: 'reflect-fail'
            };
        }
    }
}
