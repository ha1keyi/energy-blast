// src/managers/DebugUIManager.js
// Minimal Debug UI manager; visible by default only for the room host.
import { LobbyManager } from './LobbyManager.js';

export class DebugUIManager {
  constructor(game) {
    this.game = game;
    this.isAutoResolve = true; // keep auto resolve default
    this.visible = false;
    this.isCollapsed = false;
    this._editorBound = false;
    this._editorSignature = '';
  }

  startUpdating() {
    // 控制可见性：只有房主默认可见，且支持强制显示
    this.updateVisibility();
    // 订阅 Lobby 变化以动态调整
    LobbyManager.subscribe(() => this.updateVisibility());
    // 绑定面板控件与全局命令
    this.attachControls();
    if (typeof window !== 'undefined') {
      window.toggleDebugPanel = () => { this.toggleCollapsed(); };
      window.togglevisibility = window.toggleDebugPanel; // 兼容旧命令
      window.setAutoResolve = (val) => { this.setAutoResolve(val); this.updateVisibility(); };
      window.resolveNow = async () => { if (this.game?.processRound) await this.game.processRound(); };
      // 非房主也允许手动触发一次结算（仅本地显示，不广播）
      window.resolveLocal = async () => { if (this.game?.processRound) await this.game.processRound(); };

      // Listen for Ctrl+Shift+D
      document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
          e.preventDefault();
          this.toggleCollapsed();
        }
      });
    }

    // Keep debug data panel fresh while visible.
    setInterval(() => {
      this.renderPlayerEditor();
    }, 350);
  }

  updateVisibility() {
    const isHost = !!LobbyManager.roomId && LobbyManager.isHost();
    const shouldShow = isHost;
    this.visible = shouldShow;
    const panel = document.getElementById('debug-panel');
    if (panel) {
      panel.style.display = shouldShow ? '' : 'none';
    }
  }

  toggleCollapsed() {
    if (!(!!LobbyManager.roomId && LobbyManager.isHost())) return;
    this.isCollapsed = !this.isCollapsed;
    this.applyCollapsedState();
  }

  setAutoResolve(val) {
    this.isAutoResolve = !!val;
    // 同步复选框状态
    const checkbox = document.getElementById('debug-auto-checkbox');
    if (checkbox) checkbox.checked = this.isAutoResolve;

    // 根据自动推进状态刷新下一次结算时间
    if (this.game) {
      const isHost = (typeof window !== 'undefined' && window.lobby && window.lobby.isHost && window.lobby.isHost());
      this.game.clearTimer?.();
      if (isHost && this.isAutoResolve && this.game.isRunning && this.game.gameState === 'selecting') {
        this.game.nextResolveAt = Date.now() + (this.game.roundTime || 5000);
        this.game.timer = setTimeout(async () => { await this.game.processRound(); }, (this.game.roundTime || 5000));
      } else {
        this.game.nextResolveAt = null;
      }
    }
  }

  attachControls() {
    const panel = document.getElementById('debug-panel');
    if (!panel) return; // 没有面板节点则跳过

    const collapseBtn = document.getElementById('debug-collapse-btn');
    if (collapseBtn) {
      collapseBtn.onclick = () => this.toggleCollapsed();
    }

    const checkbox = document.getElementById('debug-auto-checkbox');
    if (checkbox) {
      checkbox.checked = this.isAutoResolve;
      checkbox.onchange = () => this.setAutoResolve(checkbox.checked);
    }
    const resolveBtn = document.getElementById('debug-resolve-btn');
    if (resolveBtn) {
      resolveBtn.onclick = async () => { if (this.game?.processRound) await this.game.processRound(); };
    }

    const refreshBtn = document.getElementById('debug-refresh-btn');
    if (refreshBtn) {
      refreshBtn.onclick = () => this.renderPlayerEditor(true);
    }

    this.bindPlayerEditorEvents();
    this.applyCollapsedState();
    this.renderPlayerEditor(true);
  }

  applyCollapsedState() {
    const body = document.getElementById('debug-panel-body');
    const btn = document.getElementById('debug-collapse-btn');
    if (!body || !btn) return;
    body.style.display = this.isCollapsed ? 'none' : '';
    btn.textContent = this.isCollapsed ? '展开' : '收起';
  }

  bindPlayerEditorEvents() {
    if (this._editorBound) return;
    const editor = document.getElementById('debug-player-editor');
    if (!editor) return;

    editor.addEventListener('change', (ev) => {
      const target = ev.target;
      const row = target?.closest?.('[data-player-id]');
      if (!row) return;
      const playerId = Number(row.getAttribute('data-player-id'));
      const player = this.game?.players?.find?.(p => p.id === playerId);
      if (!player) return;

      const field = target.getAttribute('data-field');
      if (!field) return;

      if (field === 'name') player.name = (target.value || '').trim() || player.name;
      if (field === 'health') player.health = Number(target.value || player.health);
      if (field === 'energy') player.energy = Number(target.value || player.energy);
      if (field === 'score') player.score = Number(target.value || player.score || 0);
      if (field === 'isAlive') player.isAlive = !!target.checked;
      if (field === 'isBot') player.isBot = !!target.checked;

      this.game?.nextFrame?.();
      this.renderPlayerEditor(true);
    });

    this._editorBound = true;
  }

  renderPlayerEditor(force = false) {
    const editor = document.getElementById('debug-player-editor');
    if (!editor || !this.visible || this.isCollapsed) return;

    const players = this.game?.players || [];
    const signature = JSON.stringify(players.map(p => ({
      id: p.id,
      name: p.name,
      hp: p.health,
      en: p.energy,
      alive: p.isAlive,
      bot: !!p.isBot,
      score: p.score || 0,
      action: p.currentAction?.name || '',
      target: p.target?.name || '',
    })));
    if (!force && signature === this._editorSignature) return;
    this._editorSignature = signature;

    if (!players.length) {
      editor.innerHTML = '<div style="font-size:12px;color:#666;">暂无玩家数据</div>';
      return;
    }

    const rows = players.map((p) => `
      <tr data-player-id="${p.id}">
        <td>${p.id}</td>
        <td><input data-field="name" value="${String(p.name || '').replace(/"/g, '&quot;')}" /></td>
        <td><input data-field="health" type="number" value="${Number(p.health ?? 0)}" /></td>
        <td><input data-field="energy" type="number" value="${Number(p.energy ?? 0)}" /></td>
        <td><input data-field="score" type="number" value="${Number(p.score ?? 0)}" /></td>
        <td><input data-field="isAlive" type="checkbox" ${p.isAlive ? 'checked' : ''} /></td>
        <td><input data-field="isBot" type="checkbox" ${p.isBot ? 'checked' : ''} /></td>
        <td>${p.currentAction?.name || '-'}</td>
        <td>${p.target?.name || '-'}</td>
      </tr>
    `).join('');

    editor.innerHTML = `
      <div class="debug-table-wrap">
        <table class="debug-player-table">
          <thead>
            <tr>
              <th>ID</th><th>名字</th><th>血</th><th>气</th><th>分</th><th>存活</th><th>Bot</th><th>行动</th><th>目标</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="font-size:11px;color:#666;margin-top:4px;">修改任意单元格后将立即生效</div>
    `;
  }

  updatePlayerList() {
    // no-op placeholder to avoid errors from callers
  }

  updateGameState() {
    this.renderPlayerEditor();
  }

  // Hook: host collects remote actions to drive resolution
  onRemoteAction(payload) {
    // reserved hook for host to collect remote actions; do not log frequently
  }
}

export const DebugUIManagerSingleton = DebugUIManager;