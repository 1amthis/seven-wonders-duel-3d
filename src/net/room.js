// A room is one PeerJS data connection between two browsers: the host opens it and shows its code, the guest dials it.
// This file only moves JSON messages and keeps the link healthy (heartbeat, automatic reconnection); what the messages
// mean lives in protocol.js and game.js. PeerJS brings the matchmaking (a free public signalling server) and, for
// players behind strict NATs, free TURN relays, so nothing has to be hosted for this to work.
import { Peer } from 'peerjs';
import { makeCode, peerIdFor, PROTOCOL } from './protocol.js';

const PING_MS = 2500;   // we say "still here" this often
const STALL_MS = 9000;  // nothing heard for this long: show the other player as slow
const DEAD_MS = 22000;  // ...and for this long: give up on the connection and dial again
const OPEN_MS = 15000;  // how long a dial, or opening the room, may take
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => performance.now();
const fail = (type, message) => Object.assign(new Error(message || type), { type });

/** Signalling-server override for tests (?peer=localhost:9000); only honoured when the page itself is on localhost. */
export function signalConfig() {
  try {
    const p = new URLSearchParams(location.search).get('peer');
    if (p && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { const [host, port] = p.split(':'); return { host, port: +port || 9000, path: '/', secure: false }; }
  } catch { /* no location: not in a page */ }
  return {};
}

export class Room {
  constructor(role, code, opts = {}) {
    this.role = role; this.code = code; this.opts = opts;
    this.peer = null; this.conn = null;
    this.status = 'connecting'; // connecting | connected | stalled | lost
    this.closed = false;
    this.lastSeen = 0; this.lastPing = 0;
    this.handlers = {};
  }

  // ---------------------------------------------------------------- events
  /** Events: 'msg' (message), 'status' (status), 'busy' (the host already has a guest). Returns an unsubscribe function. */
  on(type, fn) { (this.handlers[type] ||= []).push(fn); return () => { this.handlers[type] = this.handlers[type].filter(f => f !== fn); }; }
  emit(type, ...a) { for (const f of [...(this.handlers[type] || [])]) { try { f(...a); } catch (e) { console.error(e); } } }
  off() { this.handlers = {}; }
  _setStatus(s) { if (s !== this.status) { this.status = s; this.emit('status', s); } }

  // ---------------------------------------------------------------- creating
  /** Open a room under a fresh code (or re-open `code`, after a reload). */
  static async host({ code = null, signal = signalConfig() } = {}) {
    const fixed = !!code;
    let last;
    for (let i = 0; i < (fixed ? 8 : 5); i++) {
      const room = new Room('host', code || makeCode(), { signal });
      try { await room._openPeer(); return room; } catch (e) {
        last = e; room.destroy();
        if (e.type !== 'unavailable-id') throw e;
        if (fixed) await sleep(2500); // our own old page may not have let go of the id yet
      }
    }
    throw last;
  }
  /** Dial a room. `hello()` builds the message sent each time the connection (re)opens. */
  static async join(code, { hello, signal = signalConfig() }) {
    const room = new Room('guest', code, { hello, signal });
    try { await room._openPeer(); await room._dial(); } catch (e) { room.destroy(); throw e; }
    return room;
  }

  _openPeer() {
    return new Promise((resolve, reject) => {
      const peer = new Peer(this.role === 'host' ? peerIdFor(this.code) : undefined, { debug: 0, ...this.opts.signal });
      this.peer = peer;
      let settled = false;
      const t = setTimeout(() => { if (!settled) { settled = true; try { peer.destroy(); } catch { /* */ } reject(fail('network', 'The matchmaking server did not answer')); } }, OPEN_MS);
      peer.on('open', () => { if (settled) return; settled = true; clearTimeout(t); resolve(); });
      peer.on('error', err => {
        if (!settled) { settled = true; clearTimeout(t); try { peer.destroy(); } catch { /* */ } reject(err); return; }
        this._peerError(err);
      });
      peer.on('disconnected', () => { if (this.peer === peer) this._signalLost(); });
      peer.on('connection', conn => { if (this.peer === peer) this._incoming(conn); });
    });
  }
  _peerError(err) {
    if (err.type === 'peer-unavailable') this._dialFail?.(err);
    else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) this._signalLost();
  }
  /** The link to the signalling server dropped. Established connections live on, but nobody new can join until it is back. */
  _signalLost() {
    if (this.closed) return;
    clearTimeout(this._sigT);
    this._sigT = setTimeout(() => {
      if (this.closed || !this.peer) return;
      if (this.peer.destroyed) { if (this.role === 'host') this._openPeer().catch(() => this._signalLost()); return; }
      if (this.peer.disconnected) { try { this.peer.reconnect(); } catch { /* */ } this._signalLost(); }
    }, 3000);
  }

  // ---------------------------------------------------------------- connections
  _incoming(conn) {
    conn.on('open', () => {
      const busy = this.conn?.open && now() - this.lastSeen < 8000;
      if (busy) { try { conn.send({ t: 'busy' }); } catch { /* */ } setTimeout(() => { try { conn.close(); } catch { /* */ } }, 400); return; }
      this._adopt(conn);
    });
  }
  _dial() {
    return new Promise((resolve, reject) => {
      const conn = this.peer.connect(peerIdFor(this.code), { reliable: true, serialization: 'json', metadata: { v: PROTOCOL } });
      let done = false;
      const end = e => { if (done) return; done = true; clearTimeout(t); this._dialFail = null; try { conn.close(); } catch { /* */ } reject(e); };
      const t = setTimeout(() => end(fail('timeout', 'No answer from that room')), OPEN_MS);
      this._dialFail = end;
      conn.on('open', () => { if (done) return; done = true; clearTimeout(t); this._dialFail = null; this._adopt(conn); resolve(); });
      conn.on('error', end);
      conn.on('close', () => end(fail('closed', 'The room closed the connection')));
    });
  }
  _adopt(conn) {
    const old = this.conn;
    this.conn = conn;
    if (old && old !== conn) { try { old.close(); } catch { /* */ } }
    this.lastSeen = this.lastPing = now();
    conn.on('data', d => this._onData(conn, d));
    conn.on('close', () => this._onClose(conn));
    conn.on('error', () => this._onClose(conn));
    this._setStatus('connected');
    this._startTimers();
    if (this.role === 'guest' && this.opts.hello) this.send(this.opts.hello());
  }
  _onData(conn, d) {
    if (conn !== this.conn || !d || typeof d !== 'object') return;
    this.lastSeen = now();
    if (this.status !== 'connected') this._setStatus('connected');
    if (d.t === 'ping') return;
    if (d.t === 'busy') { this.emit('busy'); return; }
    this.emit('msg', d);
  }
  _onClose(conn) {
    if (conn !== this.conn) return; // an old connection we replaced, or one already written off
    this.conn = null;
    if (this.closed) return;
    this._setStatus('lost');
    if (this.role === 'guest') this._redial(800);
  }
  /** Guest: keep dialling until the host answers again. */
  _redial(delay) {
    if (this.closed || this._redialing) return;
    this._redialing = true;
    setTimeout(async () => {
      for (let n = 0; !this.closed && !this.conn?.open; n++) {
        try {
          if (!this.peer || this.peer.destroyed) await this._openPeer();
          else if (this.peer.disconnected) { this.peer.reconnect(); await sleep(1200); }
          await this._dial();
          break;
        } catch (e) {
          if (this.closed) break;
          await sleep(Math.min(1000 + n * 700, 4000));
        }
      }
      this._redialing = false;
    }, delay);
  }

  // ---------------------------------------------------------------- health
  _startTimers() {
    if (this._tm) return;
    this._tm = setInterval(() => {
      if (!this.conn) return;
      const t = now(), quiet = t - this.lastSeen;
      if (t - this.lastPing >= PING_MS) { this.lastPing = t; this.send({ t: 'ping' }); }
      if (quiet > DEAD_MS) { const c = this.conn; try { c.close(); } catch { /* */ } this._onClose(c); }
      else if (quiet > STALL_MS && this.status === 'connected') this._setStatus('stalled');
    }, 1000);
  }

  // ---------------------------------------------------------------- using
  get open() { return !!this.conn?.open; }
  /** Returns false when there is no connection: the move log makes up for anything lost (see MatchSync). */
  send(msg) {
    if (!this.conn?.open) return false;
    try { this.conn.send(msg); return true; } catch { return false; }
  }
  /** Leave. With `bye`, the other player is told it was on purpose (a reload or a dropped connection sends nothing). */
  close({ bye = false } = {}) {
    if (this.closed) return;
    if (bye) this.send({ t: 'bye' });
    this.closed = true;
    clearInterval(this._tm); clearTimeout(this._sigT);
    this.off();
    setTimeout(() => this.destroy(), bye ? 300 : 0);
  }
  destroy() {
    try { this.conn?.close(); } catch { /* */ }
    try { this.peer?.destroy(); } catch { /* */ }
    clearInterval(this._tm);
  }
}

/** A friendly sentence for what went wrong while hosting or joining. */
export function describeError(e) {
  switch (e?.type) {
    case 'peer-unavailable': return 'No duel found with that code. Check it and try again.';
    case 'timeout': case 'closed': return 'The host did not answer. Is their room still open?';
    case 'unavailable-id': return 'That room name is taken. Please try again.';
    case 'browser-incompatible': return 'This browser cannot do peer-to-peer connections. Try a recent Chrome, Edge, Firefox or Safari.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed': return 'Could not reach the matchmaking server. Check your internet connection and try again.';
    default: return 'Something went wrong while connecting. Please try again.';
  }
}
