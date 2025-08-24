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
        if (this.currentAction && this.currentAction.type === 'STORE') {
            this.energy += this.currentAction.getEnergyGain();
        } else if (this.currentAction) {
            this.energy -= this.currentAction.energyCost;
        }

        // 确保气量不为负
        this.energy = Math.max(0, this.energy);
    }

    // 受到伤害
    takeDamage(amount) {
        if (amount <= 0) return;

        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            this.isAlive = false;
        }
    }

    // 治疗
    heal(amount) {
        this.health = Math.min(this.maxHealth, this.health + amount);
        if (this.health > 0) {
            this.isAlive = true;
        }
    }

    // 增加气量
    addEnergy(amount) {
        this.energy += amount;
    }

    // 重置为新一轮
    resetForNewRound() {
        this.currentAction = null;
        this.target = null;
    }

    // 获取状态信息
    getStatus() {
        return {
            id: this.id,
            name: this.name,
            health: this.health,
            energy: this.energy,
            isAlive: this.isAlive,
            currentAction: this.currentAction ? this.currentAction.name : '无',
            target: this.target ? this.target.name : '无'
        };
    }
}
