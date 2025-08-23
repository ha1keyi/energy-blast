// src/managers/LobbyManager.js
// Lightweight lobby manager singleton with simple change notifications.

class LobbyManagerImpl {
    constructor() {
        this.players = [];
        this.nextId = 1;
        this._subs = new Set();
    }

    subscribe(cb) { this._subs.add(cb); return () => this._subs.delete(cb); }
    _emit() { this._subs.forEach(cb => { try { cb(this.players); } catch { } }); }

    reset() { this.players = []; this.nextId = 1; this._emit(); }
    list() { return [...this.players]; }
    get(id) { return this.players.find(p => p.id === id); }

    add(name) {
        const p = { id: this.nextId++, name, ready: false };
        this.players.push(p);
        this._emit();
        return p;
    }

    remove(id) {
        this.players = this.players.filter(p => p.id !== id);
        this._emit();
    }

    toggleReady(id) {
        const p = this.get(id);
        if (p) { p.ready = !p.ready; this._emit(); }
        return p;
    }

    allReady() {
        return this.players.length > 1 && this.players.every(p => p.ready);
    }
}

export const LobbyManager = new LobbyManagerImpl();
// Back-compat for debug tools that expect window.lobby
if (typeof window !== 'undefined') {
    window.lobby = LobbyManager;
}
