// Lightweight no-op Debug UI manager used to avoid keeping large debug DOM code in production.
// This stub preserves the public API expected by other modules but performs no DOM operations.
export class DebugUIManager {
  constructor() { }
  isNetworkMatchActive() { return false; }
  startUpdating() { }
  updateVisibility() { }
  toggleCollapsed() { }
  setAutoResolve() { }
  syncControlStateFromGame() { }
  attachControls() { }
  applyCollapsedState() { }
  bindPlayerEditorEvents() { }
  getActionKeyByPlayer() { return ''; }
  applyActionEdit() { }
  renderPlayerEditor() { }
  updatePlayerList() { }
  updateGameState() { }
  onRemoteAction() { }
}

export const DebugUIManagerSingleton = DebugUIManager;