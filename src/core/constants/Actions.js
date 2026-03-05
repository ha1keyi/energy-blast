import { ActionType } from '../enums/ActionType.js';

export const ACTIONS = {
    STORE_1: {
        type: ActionType.STORE,
        level: 1,
        energyCost: 0,
        energyGain: 1,
        name: '储气',
        description: '增加1点气'
    },
    ATTACK_1: {
        type: ActionType.ATTACK,
        level: 1,
        energyCost: 1,
        damage: 1,
        name: '小波',
        description: '消耗1气，造成1点伤害'
    },
    DEFEND_1: {
        type: ActionType.DEFEND,
        level: 1,
        energyCost: 0,
        reduction: 1,
        name: '防御',
        description: '减少1点受到的伤害'
    },
    REBOUND_1: {
        type: ActionType.REBOUND,
        level: 1,
        energyCost: 2,
        reduction: 1,
        reboundDamage: 1,
        name: '反弹',
        description: '消耗2气，减少1点伤害并反弹1点伤害'
    },
    ATTACK_2: {
        type: ActionType.ATTACK,
        level: 2,
        energyCost: 3,
        damage: 1,
        name: '大波',
        description: '消耗3气，造成1点伤害'
    }
};

// 获取所有操作键名
export const ACTION_KEYS = Object.keys(ACTIONS);

// 按类型筛选操作
export const getActionsByType = (type) => {
    return Object.entries(ACTIONS)
        .filter(([key, action]) => action.type === type)
        .reduce((obj, [key, value]) => {
            obj[key] = value;
            return obj;
        }, {});
};
