export class ActionStrategy {
    execute(attacker, attackee) {
        throw new Error('execute method must be implemented');
    }

    // 通用伤害计算
    calculateDamage(attackDamage, defenseReduction = 0) {
        return Math.max(0, attackDamage - defenseReduction);
    }
}
