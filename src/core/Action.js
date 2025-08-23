export class Action {
    constructor(type, level, energyCost, damage = 0, reduction = 0, reflectDamage = 0, name = '', description = '') {
        this.type = type;
        this.level = level;
        this.energyCost = energyCost;
        this.damage = damage;
        this.reduction = reduction;
        this.reflectDamage = reflectDamage;
        this.name = name;
        this.description = description;
    }

    getActualDamage() {
        return this.damage * this.level;
    }

    getActualReduction() {
        return this.reduction * this.level;
    }

    getActualReflectDamage() {
        return this.reflectDamage * this.level;
    }

    getEnergyGain() {
        return this.level;
    }

    // 检查是否可以执行（气量是否足够）
    canExecute(currentEnergy) {
        return currentEnergy >= this.energyCost;
    }

    // 克隆方法
    clone() {
        return new Action(
            this.type,
            this.level,
            this.energyCost,
            this.damage,
            this.reduction,
            this.reflectDamage,
            this.name,
            this.description
        );
    }
}
