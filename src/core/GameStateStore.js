// 轻量状态存储：集中管理日志与回合报告，便于后续扩展和复用
export class GameStateStore {
    constructor(game) {
        this.game = game;
        // 与 game.logs 保持引用一致，兼容现有 UI
        this.logs = game.logs;
        this.roundReports = [];
    }

    // 初始化/同步快照（保持 logs 引用不变）
    updateState(state = {}) {
        this.round = state.round ?? this.round;
        this.state = state.state ?? this.state;
        this.playersSnapshot = Array.isArray(state.players) ? state.players : this.playersSnapshot;
        if (Array.isArray(state.logs)) {
            // 不替换引用：清空后逐个推入
            this.logs.length = 0;
            for (const item of state.logs) this.logs.push(item);
        }
    }

    addLog(message) {
        this.logs.push({ round: this.game.currentRound, message });
    }

    addRoundReport(report) {
        this.roundReports.push(report);
    }

    getLatestRoundReport() {
        return this.roundReports[this.roundReports.length - 1] || null;
    }
}