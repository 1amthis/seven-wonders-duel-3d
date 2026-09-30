// The game's side of an online match: owns the room and the MatchSync, turns what the other browser sends into game
// events, and remembers the match in sessionStorage so that reloading the tab (or a phone killing it in the background)
// drops you back into the same duel instead of ending it.
//
// The host owns the match: it picks the seed, who begins and the names, and its log is the reference whenever the two
// sides disagree. Seat 0 is the host, seat 1 the guest. Both browsers run the full game; see protocol.js.
import { MatchSync, cleanName, parseCode } from './protocol.js';

const KEY = 'sw-duel-online';
export function loadSaved() { try { const v = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return v && parseCode(v.code) === v.code && (v.role === 'host' || v.role === 'guest') ? v : null; } catch { return null; } }
export function clearSaved() { try { sessionStorage.removeItem(KEY); } catch { /* storage blocked */ } }
const save = v => { try { sessionStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ } };

export class Online {
  constructor(game, room, role) {
    this.g = game; this.room = room; this.role = role;
    this.seat = role === 'host' ? 0 : 1;
    this.left = false;                      // the match is over for this connection (we left, or they did)
    this.again = { me: false, peer: false }; // who has asked for a rematch
    this.sync = new MatchSync({ seat: this.seat, send: m => room.send(m) });
    this.sync.onGap = () => this.trouble('a move went missing');
    this.sync.onBad = () => this.trouble('an illegal move');
    this.sync.onDesync = () => this.trouble('the games drifted apart');
    this.sync.onChange = () => this.persist();
    room.on('msg', m => this.onMsg(m));
    room.on('status', s => this.onStatus(s));
  }
  get peerName() { const st = this.sync.state; return st ? st.players[1 - this.seat].name : 'Your rival'; }

  // ---------------------------------------------------------------- starting
  /** Host: the set-up of a new match. `rematch` picks a fresh seed and lets the other player begin. */
  makeCfg(guestName, { rematch = false } = {}) {
    const pf = this.g.prefs, prev = this.sync.cfg;
    const host = rematch ? prev.names[0] : cleanName(pf.name, 'Host');
    let guest = rematch ? prev.names[1] : cleanName(guestName, 'Guest');
    if (guest.toLowerCase() === host.toLowerCase()) guest = cleanName(guest.slice(0, 12) + ' 2');
    const first = rematch ? 1 - prev.first : pf.first === 'me' ? 0 : pf.first === 'rival' ? 1 : (Math.random() < 0.5 ? 0 : 1);
    return { seed: rematch ? (Math.random() * 1e9) | 0 : this.g.pickSeed(), first, names: [host, guest] };
  }
  /** Host: start a match (or a rematch) and tell the guest. */
  hostBegin(cfg) {
    this.again = { me: false, peer: false };
    this.sync.begin(cfg);
    this.room.send(this.sync.startMsg({ force: true }));
    this.persist();
    this.g.enterOnline(this, false);
  }
  /** Host: pick a saved match back up. The guest's hello makes us send it the match again. */
  hostResume(saved) {
    this.sync.begin(saved.cfg, saved.log);
    this.g.enterOnline(this, saved.log.length > 0);
    this.onStatus(this.room.status);
  }
  /** Guest: the host described the match. */
  onStart(msg) {
    const r = this.sync.receiveStart(msg);
    if (r === 'rebuild') {
      this.again = { me: false, peer: false };
      this.persist();
      this.g.enterOnline(this, this.sync.log.length > 0);
      this.onStatus(this.room.status);
    } else if (r === null) this.g.hud.toast('The host sent a match this version cannot read');
  }

  // ---------------------------------------------------------------- messages
  onMsg(m) {
    if (this.left) return;
    switch (m.t) {
      case 'hello': // the guest (re)connected: give it the whole match, it works out what it is missing
        if (this.role === 'host' && this.sync.state) this.room.send(this.sync.startMsg());
        break;
      case 'start': if (this.role === 'guest') this.onStart(m); break;
      case 'move': this.sync.receiveMove(m); break;
      case 'desync': if (this.role === 'host' && this.sync.state) this.room.send(this.sync.startMsg({ force: true })); break;
      case 'sel': this.g.remoteSel(m.slot); break;
      case 'again':
        this.again.peer = true;
        this.g.onRematchAsked(this);
        this.maybeRematch();
        break;
      case 'bye': this.peerLeft(); break;
      default: break;
    }
  }
  onStatus(s) {
    const prev = this._status; this._status = s;
    this.g.hud.setPeerStatus(1 - this.seat, s === 'connected' ? '' : s === 'stalled' ? 'slow' : 'off');
    if (this.left) return;
    if (s === 'lost') this.g.hud.toast(this.role === 'host' ? `${this.peerName} lost connection. Waiting for them to come back…` : `Lost the connection to ${this.peerName}. Reconnecting…`);
    else if (s === 'connected' && (prev === 'lost' || prev === 'stalled')) this.g.hud.toast(this.role === 'host' ? `${this.peerName} is back` : 'Connection restored');
  }
  /** A move was missing, illegal, or led to a different state. The host's match is the reference: the guest asks for it. */
  trouble(what) {
    console.warn('online:', what);
    if (this.role === 'host') this.room.send(this.sync.startMsg({ force: true }));
    else this.room.send({ t: 'desync' });
    this.g.hud.toast('Resynchronising…');
  }
  sendSel(slot) { this.room.send({ t: 'sel', slot }); }

  // ---------------------------------------------------------------- rematch and leaving
  requestRematch() {
    if (this.left) return;
    this.again.me = true;
    this.room.send({ t: 'again' });
    this.maybeRematch();
  }
  maybeRematch() {
    if (this.role === 'host' && this.again.me && this.again.peer) this.hostBegin(this.makeCfg(null, { rematch: true }));
  }
  peerLeft() {
    if (this.left) return;
    const name = this.peerName;
    this.left = true; clearSaved(); this.sync.cancel(); this.room.close();
    this.g.onPeerLeft(name);
  }
  /** Walk away. With `bye` the other player is told it was on purpose; without, it looks like a dropped connection. */
  leave({ bye = false } = {}) {
    this.left = true; clearSaved(); this.sync.cancel(); this.room.close({ bye });
    this.g.hud.setPeerStatus(1 - this.seat, '');
  }

  persist() {
    if (this.left || !this.sync.cfg) return;
    const base = { role: this.role, code: this.room.code };
    save(this.role === 'host' ? { ...base, cfg: this.sync.cfg, log: this.sync.log } : { ...base, name: this.sync.cfg.names[1] });
  }
}
