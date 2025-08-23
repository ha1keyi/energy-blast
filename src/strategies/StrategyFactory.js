import { AttackVsAttackStrategy } from './AttackVsAttackStrategy.js';
import { AttackVsDefendStrategy } from './AttackVsDefendStrategy.js';
import { AttackVsReflectStrategy } from './AttackVsReflectStrategy.js';
import { DefaultStrategy } from './DefaultStrategy.js';
import { ActionType } from '../core/enums/ActionType.js';

export class StrategyFactory {
    static getStrategy(attackerActionType, attackeeActionType) {
        if (!attackeeActionType) {
            return new DefaultStrategy();
        }

        switch (attackeeActionType) {
            case ActionType.ATTACK:
                return new AttackVsAttackStrategy();
            case ActionType.DEFEND:
                return new AttackVsDefendStrategy();
            case ActionType.REFLECT:
                return new AttackVsReflectStrategy();
            default:
                return new DefaultStrategy();
        }
    }

    // 根据操作对象获取策略
    static getStrategyForActions(attackerAction, attackeeAction) {
        const attackeeType = attackeeAction ? attackeeAction.type : null;
        return this.getStrategy(attackerAction.type, attackeeType);
    }
}
