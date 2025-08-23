import { ActionStrategy } from './ActionStrategy.js';

export class AttackVsAttackStrategy extends ActionStrategy {
    execute(attacker, attackee) {
        const attackAction = attacker.currentAction;
        const attackeeAction = attackee.currentAction;

        if (attackAction.level > attackeeAction.level) {
            // 攻击者等级更高
            const damage = attackAction.getActualDamage();
            attackee.takeDamage(damage);
            return {
                message: `${attacker.name}的攻击命中${attackee.name}，造成${damage}点伤害`,
                damage: damage,
                type: 'attack-hit'
            };
        } else if (attackeeAction.level > attackAction.level) {
            // 防御者等级更高
            const damage = attackeeAction.getActualDamage();
            attacker.takeDamage(damage);
            return {
                message: `${attackee.name}反击${attacker.name}，造成${damage}点伤害`,
                damage: damage,
                type: 'counter-attack'
            };
        } else {
            // 等级相同
            return {
                message: `${attacker.name}和${attackee.name}的攻击相互抵消`,
                damage: 0,
                type: 'mutual-cancel'
            };
        }
    }
}
