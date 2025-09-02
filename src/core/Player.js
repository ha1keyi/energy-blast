import { ACTIONS } from './constants/Actions.js';
import { Action } from './Action.js';
import { ActionType } from './enums/ActionType.js';

export class Player {
    constructor(id, name = `Player ${id}`, health = 1, energy = 0) {
        this.id = id;
        this.name = name;
        this.health = health;
        this.maxHealth = health;
        this.energy = energy;
        this.currentAction = null;
        this.target = null;
        this.isAlive = true;
        this.score = 0;
        // 预留：虚拟玩家与AI控制支持
        this.isBot = false;
        this.controller = null; // 可选：用于未来AI控制的控制器对象
    }

    // 设置AI控制器（可选）
    setController(controller) {
        this.controller = controller || null;
    }

    // 获取当前可用的操作列表
    getAvailableActions() {
        return Object.entries(ACTIONS)
            .filter(([key, action]) => this.energy >= action.energyCost)
            .reduce((obj, [key, value]) => {
                obj[key] = value;
                return obj;
            }, {});
    }

    // 选择操作
    selectAction(actionKey, target = null) {
        const actionConfig = ACTIONS[actionKey];
        if (!actionConfig) {
            throw new Error(`Invalid action: ${actionKey}`);
        }

        if (!this.canAffordAction(actionConfig)) {
            throw new Error(`Not enough energy for ${actionKey}. Need ${actionConfig.energyCost}, have ${this.energy}`);
        }

        if (actionConfig.type === ActionType.ATTACK) {
            if (!target) {
                throw new Error(`攻击动作 '${actionConfig.name}' 必须选择一个目标。`);
            }
        }
        else {
            if (target) {
                throw new Error(`非攻击动作 '${actionConfig.name}' 不能选择目标。`);
            }
        }

        this.currentAction = new Action(
            actionConfig.type,
            actionConfig.level,
            actionConfig.energyCost,
            actionConfig.damage,
            actionConfig.reduction,
            actionConfig.reboundDamage,
            actionConfig.name,
            actionConfig.description
        );

        this.target = target;

        return true;
    }

    // 检查是否可以承担操作消耗
    canAffordAction(actionConfig) {
        return this.energy >= actionConfig.energyCost;
    }

    // 执行操作后的气量调整
    adjustEnergy() {
        if (this.currentAction) {
            this.energy -= this.currentAction.energyCost;
        }
    }

    // 受到攻击时的处理
    handleAttack(attackAction, attacker) {
        const damage = attackAction.damage || 0;
        const reduction = this.currentAction && this.currentAction.reduction ? this.currentAction.reduction : 0;
        const actualDamage = Math.max(0, damage - reduction);
        this.health -= actualDamage;

        if (this.health <= 0) {
            this.isAlive = false;
        }

        // 反弹伤害
        let reboundApplied = 0;
        if (this.currentAction && this.currentAction.reboundDamage) {
            attacker.health -= this.currentAction.reboundDamage;
            reboundApplied = this.currentAction.reboundDamage;
            if (attacker.health <= 0) {
                attacker.isAlive = false;
            }
        }

        // 返回伤害明细，便于 Game 侧记录日志
        return {
            damage,
            reduction,
            actualDamage,
            reboundToAttacker: reboundApplied,
            defenderRemaining: this.health,
            attackerRemaining: attacker.health
        };
    }

    // 清理回合数据
    resetRound() {
        this.currentAction = null;
        this.target = null;
    }

    // 开局/新回合重置（与 resetRound 类似，预留将来扩展）
    resetForNewRound() {
        this.currentAction = null;
        this.target = null;
    }

    // 回合结束时的气量调整
    recoverEnergy(amount) {
        this.energy += amount;
    }

    // 获取状态信息
    getStatus() {
        return {
            id: this.id,
            name: this.name,
            health: this.health,
            energy: this.energy,
            isAlive: this.isAlive,
            isBot: !!this.isBot,
            currentAction: this.currentAction ? this.currentAction.name : '无',
            target: this.target ? this.target.name : '无'
        };
    }
}
