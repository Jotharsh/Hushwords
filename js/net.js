// Peer to peer rooms. The host's browser is the game: it holds the secret key and sends each player only their own view.
// Guests connect straight to it over WebRTC. PeerJS's free public broker only introduces the devices.
import { PEER_PREFIX } from './config.js';
import { createRoom, restore, join, disconnect, act, viewFor, HOST } from './game.js';
import { ClockSync } from './sync.js';

const ICE = { config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const safeSend = (conn, data) => { try { if (conn.open) conn.send(data); } catch (e) { console.warn('send failed', e); } };

class Emitter {
  #h = {};
  on(type, fn) { (this.#h[type] ??= new Set()).add(fn); return () => this.#h[type].delete(fn); }
  emit(type, payload) { for (const fn of this.#h[type] ?? []) { try { fn(payload); } catch (e) { console.error(e); } } }
}

export class HostSession extends Emitter {
  isHost = true;
  token = HOST;
  constructor(room) { super(); this.room = room; this.conns = new Map(); this.peer = null; this.timers = []; this.closed = false; }

  get state() { return viewFor(this.room, HOST, Date.now()); }
  hostNow() { return Date.now(); }

  async start({ retryFor = 0 } = {}) {
    const until = Date.now() + retryFor;
    for (;;) {
      try { await this.#open(); break; }
      catch (error) { if (error.reason !== 'taken' || Date.now() > until) throw error; await wait(1500); }
    }
    this.timers.push(setInterval(() => this.#tick(), 500));
    this.timers.push(setInterval(() => this.#each((t) => ({ t: 'beat', rev: this.room.rev, hostNow: Date.now() })), 2000));
  }

  #open() {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PEER_PREFIX + this.room.code, ICE);
      const timer = setTimeout(() => { peer.destroy(); reject({ reason: 'offline' }); }, 15000);
      peer.on('open', () => { clearTimeout(timer); this.peer = peer; peer.on('connection', (c) => this.#onConnection(c)); peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); }); resolve(); });
      peer.on('error', (e) => { if (!this.peer) { clearTimeout(timer); peer.destroy(); reject({ reason: e.type === 'unavailable-id' ? 'taken' : 'offline' }); } else console.warn('peer error', e.type); });
    });
  }

  #onConnection(conn) {
    let token = null;
    conn.on('data', (data) => {
      if (!data || typeof data !== 'object') return;
      if (!token) {
        if (data.t !== 'hello' || typeof data.token !== 'string' || data.token.length < 8 || data.token.length > 64 || data.token === HOST) return;
        const result = join(this.room, data.token, data.nick);
        if (!result.ok) { safeSend(conn, { t: 'denied', reason: result.error }); setTimeout(() => conn.close(), 300); return; }
        token = data.token;
        const old = this.conns.get(token); this.conns.set(token, conn);
        if (old && old !== conn) { try { old.close(); } catch {} }       // the same person came back from a new connection
        safeSend(conn, { t: 'welcome', view: viewFor(this.room, token, Date.now()) });
        this.#changed();
        return;
      }
      if (data.t === 'ping') safeSend(conn, { t: 'pong', c: data.c, h: Date.now() });
      else if (data.t === 'need') safeSend(conn, { t: 'state', view: viewFor(this.room, token, Date.now()) });
      else if (data.t === 'act') {
        const result = act(this.room, token, data.msg, Date.now());
        if (!result.ok) { safeSend(conn, { t: 'rejected', error: result.error, what: data.msg?.type }); return; }
        if (result.kick) { const k = this.conns.get(result.kick); if (k) { safeSend(k, { t: 'kicked' }); setTimeout(() => k.close(), 300); this.conns.delete(result.kick); } }
        this.#changed();
      }
    });
    conn.on('close', () => {
      if (!token || this.conns.get(token) !== conn) return;              // a newer connection already replaced this one
      this.conns.delete(token);
      if (disconnect(this.room, token)) this.#changed();
    });
    conn.on('error', (e) => console.warn('connection error', e));
  }

  #each(make) { for (const [token, conn] of this.conns) safeSend(conn, make(token)); }
  #changed() {
    this.#each((token) => ({ t: 'state', view: viewFor(this.room, token, Date.now()) }));
    this.emit('update', this.state);
  }
  #tick() {
    const g = this.room.game;
    if (this.room.phase === 'play' && g?.deadline && Date.now() >= g.deadline) {
      if (act(this.room, HOST, { type: 'timeout' }, Date.now()).ok) this.#changed();
    }
  }

  request(msg) {
    const result = act(this.room, HOST, msg, Date.now());
    if (result.ok) {
      if (result.kick) { const k = this.conns.get(result.kick); if (k) { safeSend(k, { t: 'kicked' }); setTimeout(() => k.close(), 300); this.conns.delete(result.kick); } }
      this.#changed();
    }
    return result;
  }

  close() {
    if (this.closed) return;
    this.closed = true; this.timers.forEach(clearInterval);
    this.#each(() => ({ t: 'closed' }));
    setTimeout(() => this.peer?.destroy(), 400);
  }
}

export class GuestSession extends Emitter {
  isHost = false;
  constructor({ code, nick, token }) {
    super(); Object.assign(this, { code, nick, token });
    this.state = null; this.clock = new ClockSync(); this.peer = null; this.conn = null;
    this.timers = []; this.closed = false; this.pings = 0; this.heard = 0; this.reconnecting = false;
  }
  hostNow() { return this.clock.hostNow(); }

  /** Resolves when we are in. Rejects with { reason: 'notfound' | 'full' | 'offline' }. */
  async connect() { await this.#dial(15000); this.#afterJoin(); }

  #dial(timeoutMs) {
    return new Promise((resolve, reject) => {
      this.#teardown();
      const peer = new Peer(undefined, ICE); this.peer = peer;
      let settled = false;
      const fail = (reason) => { if (settled) return; settled = true; clearTimeout(timer); peer.destroy(); reject({ reason }); };
      const timer = setTimeout(() => fail('offline'), timeoutMs);
      peer.on('error', (e) => { if (!settled) fail(e.type === 'peer-unavailable' ? 'notfound' : 'offline'); });
      peer.on('open', () => {
        const conn = peer.connect(PEER_PREFIX + this.code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => safeSend(conn, { t: 'hello', nick: this.nick, token: this.token }));
        conn.on('data', (d) => {
          if (!d || typeof d !== 'object' || conn !== this.conn) return;
          this.heard = Date.now();
          if (!settled && d.t === 'welcome') { settled = true; clearTimeout(timer); this.state = d.view; this.clock.offset = d.view.hostNow - Date.now(); resolve(); }
          else if (!settled && d.t === 'denied') fail(d.reason);
          else if (settled) this.#onData(d);
        });
        conn.on('close', () => { if (conn !== this.conn) return; if (!settled) fail('offline'); else this.#lost(); });
      });
    });
  }

  #afterJoin() {
    this.heard = Date.now(); this.pings = 0; this.#ping();
    this.timers.push(setInterval(() => { this.#ping(); if (Date.now() - this.heard > 9000) this.#lost(); }, 1000));
  }
  #ping() { if (this.pings++ > 6 && this.pings % 8 !== 0) return; if (this.conn) safeSend(this.conn, { t: 'ping', c: Date.now() }); }

  #onData(d) {
    switch (d.t) {
      case 'pong': this.clock.addSample(d.c, d.h, Date.now()); break;
      case 'state': this.state = d.view; this.emit('update', this.state); break;
      case 'beat': if (this.state && d.rev !== this.state.rev) safeSend(this.conn, { t: 'need' }); break;
      case 'rejected': this.emit('rejected', d); break;
      case 'kicked': this.closed = true; this.#teardown(); this.emit('closed', { reason: 'kicked' }); break;
      case 'closed': this.closed = true; this.#teardown(); this.emit('closed', { reason: 'ended' }); break;
    }
  }

  async #lost() {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true; this.emit('status', 'reconnecting'); this.#clearTimers();
    const until = Date.now() + 45000;
    while (!this.closed && Date.now() < until) {
      await wait(3000);
      if (this.closed) return;
      try { await this.#dial(10000); this.reconnecting = false; this.#afterJoin(); this.emit('status', 'live'); this.emit('update', this.state); return; }
      catch (e) { if (e.reason === 'full') break; }
    }
    this.reconnecting = false;
    if (!this.closed) { this.closed = true; this.#teardown(); this.emit('closed', { reason: 'lost' }); }
  }

  request(msg) { if (this.conn) safeSend(this.conn, { t: 'act', msg }); return { ok: true }; }
  #clearTimers() { this.timers.splice(0).forEach(clearInterval); }
  #teardown() { this.#clearTimers(); try { this.conn?.close(); } catch {} try { this.peer?.destroy(); } catch {} this.conn = null; this.peer = null; }
  close() { this.closed = true; this.#teardown(); }
}

export { createRoom, restore };
