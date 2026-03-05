import { ActionStrategy } from './ActionStrategy.js';

export class DefaultStrategy extends ActionStrategy {
    execute(attacker, attackee) {
        // 默认情况：直接造成伤害
        const damage = attacker.currentAction.getActualDamage();
        attackee.handleAttack(damage);

        return {
            message: `${attacker.name}对${attackee.name}造成${damage}点伤害`,
            damage: damage,
            type: 'direct-hit'
        };
    }
}
