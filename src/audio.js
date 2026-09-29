/* ============================================================================
 *  audio.js  -  fully procedural Web Audio engine for the 7 Wonders Duel tribute
 *
 *  No audio files, no libraries.  Everything is built from oscillators, FM,
 *  filtered noise, envelopes and a few pre-computed buffers (a shared noise
 *  buffer, a generated convolution "stone hall" impulse and Karplus-Strong
 *  plucks for the music).
 *
 *  Public API  (all methods are safe no-ops if Web Audio is unavailable):
 *
 *     const audio = new GameAudio();
 *     audio.init();                 // from a user gesture (also auto-unlocks on first input)
 *     audio.play('coin', { pan, vol, pitch, delay, count });
 *     audio.startMusic('calm'); audio.setMood('tense'); audio.stopMusic(1.5);
 *
 *  Extras: GameAudio.SFX_NAMES, GameAudio.MOODS, audio.stats, audio.has(name),
 *          GameAudio.renderToBuffer / renderScenario / renderMusic (offline, for tests).
 *
 *  Graph:   voices -> sfxBus --+
 *           music  -> musicBus-+--> pre -> compressor -> soft-clip -> master -> out
 *           sends  -> reverb (highpass -> convolver -> return) -^
 * ==========================================================================*/

const TAU = Math.PI * 2;
const EPS = 1e-4;
const MAX_VOICES = 40;        // simultaneous SFX voices (play() calls)
const SOFT_VOICES = 30;       // above this, "soft" sounds (hover, deal, tick...) are dropped
const MAX_SOURCES = 300;      // simultaneous oscillator / buffer sources spawned by SFX

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const semi = (s) => Math.pow(2, s / 12);
const lerp = (a, b, u) => a + (b - a) * u;
const lgLerp = (a, b, u) => a * Math.pow(b / a, u);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const DEFAULT_LEVELS = { master: 0.85, sfx: 0.9, music: 0.75 };
const cnt = (v, d, lo, hi) => clamp(Number.isFinite(+v) && v !== null && v !== '' ? Math.round(+v) : d, lo, hi);
const taper = (v) => { v = clamp(+v || 0, 0, 1); return v * v; };

/* ---------------------------------------------------------------------------
 *  Shared buffers
 * -------------------------------------------------------------------------*/
function makeNoise(ctx, rand, secs) {
  const sr = ctx.sampleRate, n = Math.floor(sr * secs);
  const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = rand() * 2 - 1;
  return b;
}

// Procedural "stone hall" impulse: decaying noise that darkens over time, pre-delay + sparse early reflections.
function makeImpulse(ctx, rand, rt) {
  const sr = ctx.sampleRate, n = Math.floor(sr * rt);
  const buf = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(sr * 0.014);
  const taps = [0.017, 0.024, 0.033, 0.045, 0.06, 0.077];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.9 * t) / (rt * 0.82));
      const fc = 1300 + 7200 * Math.exp(-t * 2.4);
      const a = Math.exp((-TAU * fc) / sr);
      lp = (1 - a) * (rand() * 2 - 1) + a * lp;
      d[i] = lp * env * Math.min(1, t / 0.025) * 2.0;
    }
    taps.forEach((tp, k) => {
      const idx = pre + Math.floor(sr * (tp + (ch ? 0.0023 : 0)));
      if (idx < n) d[idx] += (rand() < 0.5 ? -1 : 1) * (0.7 - k * 0.09);
    });
    const fo = Math.floor(n * 0.06);
    for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo;
  }
  return buf;
}

// Soft knee limiter curve, always < 0.9 in magnitude.
function makeClipCurve() {
  const N = 2048, c = new Float32Array(N), k = 0.55;
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1, ax = Math.abs(x);
    const y = ax <= k ? ax : k + (1 - k) * Math.tanh((ax - k) / (1 - k));
    c[i] = Math.sign(x) * y * 0.98;
  }
  return c;
}

function buildGraph(ctx, o = {}) {
  const rand = o.rand || Math.random;
  const g = {
    ctx, rand,
    stats: { voices: 0, sources: 0, peakVoices: 0, peakSources: 0, played: 0, dropped: 0 },
    levels: { ...DEFAULT_LEVELS }, muted: false,
    pluckCache: new Map(),
  };
  g.noise = makeNoise(ctx, rand, 3);
  g.sfxBus = ctx.createGain();
  g.musicBus = ctx.createGain();
  g.revIn = ctx.createGain();
  const rhp = ctx.createBiquadFilter(); rhp.type = 'highpass'; rhp.frequency.value = 230; rhp.Q.value = 0.6;
  const conv = ctx.createConvolver(); conv.buffer = makeImpulse(ctx, rand, 2.6);
  g.revOut = ctx.createGain(); g.revOut.gain.value = 1.6;
  g.pre = ctx.createGain();
  g.comp = ctx.createDynamicsCompressor();
  g.comp.threshold.value = -12; g.comp.knee.value = 12; g.comp.ratio.value = 4;
  g.comp.attack.value = 0.003; g.comp.release.value = 0.25;
  g.shaper = ctx.createWaveShaper(); g.shaper.curve = makeClipCurve(); try { g.shaper.oversample = '2x'; } catch (e) { /* ignore */ }
  g.master = ctx.createGain();
  g.sfxBus.connect(g.pre); g.musicBus.connect(g.pre);
  g.revIn.connect(rhp); rhp.connect(conv); conv.connect(g.revOut); g.revOut.connect(g.pre);
  g.pre.connect(g.comp); g.comp.connect(g.shaper); g.shaper.connect(g.master); g.master.connect(ctx.destination);
  g.nodes = [g.sfxBus, g.musicBus, g.revIn, rhp, conv, g.revOut, g.pre, g.comp, g.shaper, g.master];
  applyLevels(g, 0, 0);
  return g;
}

function applyLevels(g, now, tc) {
  const L = g.levels;
  const set = (p, v) => { if (tc > 0) p.setTargetAtTime(v, now, tc); else p.value = v; };
  set(g.master.gain, g.muted ? 0 : taper(L.master));
  set(g.sfxBus.gain, taper(L.sfx));
  set(g.musicBus.gain, taper(L.music));
}

/* ---------------------------------------------------------------------------
 *  Synth: small helper toolkit. Every node it creates is tracked and disconnected
 *  once the last source it started has ended, so nothing leaks.
 * -------------------------------------------------------------------------*/
class Synth {
  constructor(g, dest, o = {}) {
    this.g = g; this.c = g.ctx; this.dest = dest; this.rand = g.rand;
    this.pf = o.pf || 1;
    this.count = o.count !== false;      // count sources in global stats (SFX only)
    this.counted = !!o.counted;          // counts as a "voice"
    this.nodes = []; this.srcs = [];
    this.live = 0; this.sealed = false; this.freed = false; this.dead = false;
  }
  _n(node) { this.nodes.push(node); return node; }
  _go(src, t0, t1, off) {
    this.live++;
    if (this.count) { const st = this.g.stats; st.sources++; if (st.sources > st.peakSources) st.peakSources = st.sources; }
    src.onended = () => {
      if (this.dead) return;
      this.live--;
      if (this.count) this.g.stats.sources--;
      if (this.sealed && this.live <= 0) this._free();
    };
    if (off === undefined) src.start(t0); else src.start(t0, off);
    src.stop(Math.max(t1, t0 + 0.01));
    this.nodes.push(src); this.srcs.push(src);
  }
  _free() {
    if (this.freed) return;
    this.freed = true;
    for (const n of this.nodes) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    this.nodes.length = 0; this.srcs.length = 0;
    if (this.counted) this.g.stats.voices--;
  }
  seal() { this.sealed = true; if (this.live <= 0) this._free(); }
  kill() {
    if (this.dead) return;
    this.dead = true;
    for (const s of this.srcs) { try { s.stop(); } catch (e) { /* ignore */ } }
    if (this.count) this.g.stats.sources -= this.live;
    this.live = 0;
    this._free();
  }

  gain(v = 1) { const n = this._n(this.c.createGain()); n.gain.value = v; return n; }
  // sub-bus into dest with optional static pan
  bus(pan, v = 1) {
    const c = this.c, gn = this.gain(v);
    if (pan && c.createStereoPanner) {
      const p = this._n(c.createStereoPanner()); p.pan.value = clamp(pan, -1, 1);
      gn.connect(p); p.connect(this.dest);
    } else gn.connect(this.dest);
    return gn;
  }
  _out(node, o) {
    if (o.out) { node.connect(o.out); return; }
    if (o.pan && this.c.createStereoPanner) {
      const p = this._n(this.c.createStereoPanner()); p.pan.value = clamp(o.pan, -1, 1);
      node.connect(p); p.connect(this.dest);
    } else node.connect(this.dest);
  }
  _fq(f) { return clamp(f, 20, this.c.sampleRate * 0.45); }

  /* oscillator with attack/hold/release envelope, optional glide, lowpass sweep, FM, vibrato bus */
  tone(type, f, t, o = {}) {
    const c = this.c, pf = this.pf;
    const a = Math.max(o.a === undefined ? 0.004 : o.a, 0.0015), h = o.h || 0, r = o.r === undefined ? 0.3 : o.r;
    const pk = Math.max(o.pk === undefined ? 0.3 : o.pk, 0.0003);
    const tEnd = t + a + h + r;
    const osc = c.createOscillator(); osc.type = type;
    const f0 = this._fq(f * pf);
    osc.frequency.setValueAtTime(f0, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(this._fq(o.f2 * pf), t + Math.max(0.005, o.gt === undefined ? a + h + r : o.gt));
    if (o.dt) osc.detune.value = o.dt;
    if (o.dm) o.dm.connect(osc.detune);
    let node = osc;
    if (o.lp) {
      const fl = this._n(c.createBiquadFilter()); fl.type = 'lowpass'; fl.Q.value = o.q === undefined ? 0.5 : o.q;
      fl.frequency.setValueAtTime(this._fq(o.lp * pf), t);
      if (o.lp2) fl.frequency.exponentialRampToValueAtTime(this._fq(o.lp2 * pf), t + Math.max(0.005, o.lpt === undefined ? a + h + r : o.lpt));
      osc.connect(fl); node = fl;
    }
    const gn = this._n(c.createGain()), p = gn.gain;
    p.setValueAtTime(EPS, t);
    p.linearRampToValueAtTime(pk, t + a);
    if (h > 0) p.setValueAtTime(pk, t + a + h);
    p.exponentialRampToValueAtTime(EPS, tEnd);
    node.connect(gn);
    this._out(gn, o);
    this._go(osc, t, tEnd + 0.03);
    if (o.fm) {
      const fm = o.fm, m = c.createOscillator(); m.type = 'sine';
      const fmod = f0 * fm.r; m.frequency.setValueAtTime(this._fq(fmod), t);
      const mg = this._n(c.createGain()), dev = fmod * fm.i;
      mg.gain.setValueAtTime(dev, t);
      mg.gain.exponentialRampToValueAtTime(Math.max(0.01, dev * (fm.end || 0.04)), t + (fm.dec || (a + h + r) * 0.6));
      m.connect(mg); mg.connect(osc.frequency);
      this._go(m, t, tEnd + 0.03);
    }
    return gn;
  }

  /* filtered noise burst (peak level ~= pk regardless of filter bandwidth) */
  noise(t, o = {}) {
    const c = this.c, g = this.g, pf = this.pf;
    const a = Math.max(o.a === undefined ? 0.003 : o.a, 0.0015), h = o.h || 0, r = o.r === undefined ? 0.2 : o.r;
    const type = o.type || 'bandpass', q = o.q === undefined ? 1 : o.q;
    const f = this._fq((o.f || 1000) * pf), tEnd = t + a + h + r;
    const src = c.createBufferSource(); src.buffer = g.noise; src.loop = true;
    const fl = this._n(c.createBiquadFilter()); fl.type = type; fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (o.f2) {
      fl.frequency.exponentialRampToValueAtTime(this._fq(o.f2 * pf), t + Math.max(0.005, o.gt === undefined ? a + h + r : o.gt));
      if (o.f3) fl.frequency.exponentialRampToValueAtTime(this._fq(o.f3 * pf), tEnd);
    }
    const k = o.raw ? 1 : this._noiseNorm(type, o.f2 ? Math.sqrt(f * o.f2 * pf) : f, q);
    const pk = Math.max((o.pk === undefined ? 0.3 : o.pk) * k, 0.0003);
    const gn = this._n(c.createGain()), p = gn.gain;
    p.setValueAtTime(EPS, t);
    p.linearRampToValueAtTime(pk, t + a);
    if (h > 0) p.setValueAtTime(pk, t + a + h);
    p.exponentialRampToValueAtTime(EPS, tEnd);
    src.connect(fl); fl.connect(gn);
    this._out(gn, o);
    this._go(src, t, tEnd + 0.03, this.rand() * (g.noise.duration - 0.1));
    return gn;
  }
  _noiseNorm(type, f, q) {
    const nyq = this.c.sampleRate / 2;
    let bw = type === 'bandpass' ? (1.5 * f) / Math.max(q, 0.3) : type === 'lowpass' ? 1.4 * f : type === 'highpass' ? nyq - f : nyq;
    bw = clamp(bw, 40, nyq);
    return Math.min(40, 1 / (3 * 0.577 * Math.sqrt(bw / nyq)));
  }

  /* one noise source driving many tiny bursts: crumple, riffle, fire, debris */
  crackle(t, o = {}) {
    const c = this.c, g = this.g, R = this.rand, pf = this.pf;
    const span = o.span || 0.3, dec = o.dec || 0.01, rise = o.rise || 0.0008, type = o.type || 'bandpass', q = o.q === undefined ? 1.2 : o.q;
    const fLo = this._fq((o.f ? o.f[0] : 1500) * pf), fHi = this._fq((o.f ? o.f[1] : 5000) * pf);
    const pLo = o.pk ? o.pk[0] : 0.15, pHi = o.pk ? o.pk[1] : 0.5;
    let ts = [];
    if (o.times) ts = o.times.map((x) => t + x);
    else {
      const n = o.n || 12, cv = o.curve || 1;
      for (let i = 0; i < n; i++) ts.push(t + span * Math.pow(R(), cv));
      ts.sort((x, y) => x - y);
    }
    const gap = rise + dec + 0.002;
    for (let i = 1; i < ts.length; i++) if (ts[i] < ts[i - 1] + gap) ts[i] = ts[i - 1] + gap;
    const src = c.createBufferSource(); src.buffer = g.noise; src.loop = true;
    const fl = this._n(c.createBiquadFilter()); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(fLo, t);
    const k = this._noiseNorm(type, Math.sqrt(fLo * fHi), q);
    const gn = this._n(c.createGain()), p = gn.gain;
    p.setValueAtTime(EPS, t);
    for (const tt of ts) {
      const u = clamp((tt - t) / span, 0, 1);
      const sh = o.shape ? o.shape(u) : 1;
      const amp = Math.max(lerp(pLo, pHi, R()) * k * sh, 0.0005);
      fl.frequency.setValueAtTime(lgLerp(fLo, fHi, R()), tt);
      p.setValueAtTime(EPS, tt);
      p.linearRampToValueAtTime(amp, tt + rise);
      p.exponentialRampToValueAtTime(EPS, tt + rise + dec);
    }
    const end = (ts.length ? ts[ts.length - 1] : t) + rise + dec + 0.03;
    src.connect(fl); fl.connect(gn);
    this._out(gn, o);
    this._go(src, t, end, R() * (g.noise.duration - 0.1));
    return gn;
  }

  /* inharmonic partial bank [[ratio, amp, decayScale], ...] */
  partials(f, t, set, o = {}) {
    const lim = this.c.sampleRate * 0.42;
    for (const [ratio, amp, dec] of set) {
      if (f * ratio * this.pf > lim) continue;
      const po = { a: o.a === undefined ? 0.0015 : o.a, r: (o.r === undefined ? 0.6 : o.r) * dec, pk: (o.pk === undefined ? 0.2 : o.pk) * amp, out: o.out, pan: o.pan };
      this.tone('sine', f * ratio, t, po);
      if (o.twin) this.tone('sine', f * ratio, t, { ...po, pk: po.pk * 0.5, dt: o.twin });
    }
  }
  bell(f, t, o = {}) { this.partials(f, t, BELL, o); }
  glass(f, t, o = {}) { this.partials(f, t, GLASS, { twin: 4, ...o }); }

  /* harp / lyre style pluck */
  pluck(f, t, o = {}) {
    const pk = o.pk === undefined ? 0.3 : o.pk, r = o.r === undefined ? 0.9 : o.r;
    this.tone('triangle', f, t, { a: 0.002, r, pk: pk * 0.6, lp: f * 7, lp2: f * 2.2, lpt: r * 0.6, q: 0.5, out: o.out, pan: o.pan });
    this.tone('sine', f, t, { a: 0.002, r: r * 1.2, pk: pk * 0.75, out: o.out, pan: o.pan });
    this.tone('sine', f * 2, t, { a: 0.002, r: r * 0.45, pk: pk * 0.18, out: o.out, pan: o.pan });
  }

  lfo(rate, depth, t, dur) {
    const c = this.c, osc = c.createOscillator(); osc.type = 'sine'; osc.frequency.value = rate;
    const gn = this._n(c.createGain()); gn.gain.value = depth;
    osc.connect(gn); this._go(osc, t, t + dur);
    return gn;
  }
  formants(input, list) {
    const c = this.c;
    for (const [f, q, v] of list) {
      const fl = this._n(c.createBiquadFilter()); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q;
      const gn = this.gain(v); input.connect(fl); fl.connect(gn); gn.connect(this.dest);
    }
  }

  /* one-shot buffer playback (music plucks) */
  sample(buffer, rate, t, o = {}) {
    const c = this.c, src = c.createBufferSource(); src.buffer = buffer; src.playbackRate.value = rate;
    let node = src;
    if (o.lp) { const fl = this._n(c.createBiquadFilter()); fl.type = 'lowpass'; fl.frequency.value = this._fq(o.lp); fl.Q.value = 0.5; src.connect(fl); node = fl; }
    const gn = this._n(c.createGain()); gn.gain.value = o.vol === undefined ? 1 : o.vol;
    node.connect(gn); this._out(gn, o);
    this._go(src, t, t + buffer.duration / rate + 0.05);
  }
}

/* partial sets */
const BELL = [[1, 1, 1], [2.76, 0.42, 0.55], [5.4, 0.18, 0.35], [8.93, 0.08, 0.2]];
const GLASS = [[1, 1, 1], [2, 0.3, 0.6], [3.01, 0.13, 0.4], [4.02, 0.06, 0.25]];
const WARM = [[1, 1, 1], [2, 0.38, 0.55], [2.98, 0.16, 0.4], [4.2, 0.08, 0.25]];
const GONG = [[1, 1, 1], [1.47, 0.62, 0.92], [2.09, 0.55, 0.8], [2.55, 0.38, 0.65], [3.4, 0.3, 0.5], [4.3, 0.2, 0.35], [5.6, 0.12, 0.25]];
const BRONZE = [[1, 1, 1], [1.59, 0.7, 0.85], [2.14, 0.6, 0.7], [2.3, 0.5, 0.6], [2.65, 0.5, 0.55], [3.6, 0.4, 0.4], [4.2, 0.3, 0.3]];
const COINP = [[1.52, 0.45, 0.65], [2.76, 0.4, 0.42], [4.07, 0.22, 0.24]];

/* ---------------------------------------------------------------------------
 *  Shared sound building blocks
 * -------------------------------------------------------------------------*/
function clink(s, t, f, pk, o = {}) {
  const dull = !!o.dull, out = o.pan ? s.bus(o.pan) : undefined;
  s.tone('sine', f, t, { a: 0.0012, r: dull ? 0.3 : 0.55, pk: pk * 0.55, fm: { r: 1.41, i: dull ? 0.35 : 0.9, dec: 0.09 }, out });
  s.partials(f, t, COINP, { a: 0.0012, r: dull ? 0.28 : 0.5, pk: pk * 0.5, out });
  if (!dull) s.noise(t, { type: 'highpass', f: 6500, a: 0.0004, r: 0.007, pk: pk * 0.35, out });
}
function tom(s, t, f, vel) {
  s.tone('sine', f * 1.8, t, { f2: f, gt: 0.06, a: 0.002, r: 0.6, pk: 0.75 * vel });
  s.tone('sine', f * 1.55, t, { f2: f * 1.3, gt: 0.08, a: 0.002, r: 0.22, pk: 0.22 * vel });
  s.noise(t, { type: 'lowpass', f: 700, q: 0.7, a: 0.001, r: 0.05, pk: 0.5 * vel });
  s.noise(t, { type: 'highpass', f: 2500, a: 0.0005, r: 0.012, pk: 0.14 * vel });
}
function timp(s, t, f, vel) {
  s.tone('sine', f * 1.3, t, { f2: f, gt: 0.07, a: 0.002, r: 1.5, pk: 0.7 * vel });
  s.tone('sine', f * 1.5, t, { a: 0.002, r: 0.6, pk: 0.28 * vel });
  s.tone('sine', f * 2.0, t, { a: 0.002, r: 0.35, pk: 0.16 * vel });
  s.noise(t, { type: 'lowpass', f: 600, q: 0.7, a: 0.001, r: 0.05, pk: 0.4 * vel });
}
function brass(s, f, t, dur, pk, vib) {
  const a = 0.045;
  for (const dt of [-6, 6]) {
    s.tone('sawtooth', f, t, { a, h: Math.max(0, dur - a), r: 0.18, pk: pk * 0.5, dt, dm: vib, lp: f * 3, lp2: f * 9, lpt: 0.1, q: 0.9 });
  }
}
function thump(s, t, f, pk, r) {
  s.tone('sine', f, t, { f2: f * 0.45, gt: 0.07, a: 0.002, r: r || 0.2, pk });
}

/* ---------------------------------------------------------------------------
 *  SFX recipes   (s = Synth rooted at the voice, t = start time, o = opts, R = rand)
 *  rev: reverb send, trim: loudness trim, soft: droppable under load,
 *  gap: min seconds between identical sounds, len: approx length incl. tail
 * -------------------------------------------------------------------------*/
const SFX = {
  hover: { rev: 0.05, soft: true, gap: 0.05, len: 0.15, trim: 1.7, fn(s, t, o, R) {
    s.noise(t, { type: 'bandpass', f: 3300 + R() * 500, f2: 5400, q: 0.9, a: 0.012, r: 0.05, pk: 0.14 });
    s.tone('sine', 2100 + R() * 200, t, { a: 0.004, r: 0.03, pk: 0.03 });
  } },

  select: { rev: 0.12, gap: 0.04, len: 0.3, trim: 1.3, fn(s, t, o, R) {
    const f = 380 + R() * 40;
    s.tone('sine', f * 1.3, t, { f2: f * 0.75, gt: 0.05, a: 0.002, r: 0.11, pk: 0.5 });
    s.tone('triangle', f * 3.3, t, { f2: f * 2.4, gt: 0.03, a: 0.001, r: 0.04, pk: 0.18 });
    s.noise(t, { type: 'bandpass', f: 1900, q: 2.5, a: 0.001, r: 0.02, pk: 0.4 });
  } },

  click: { rev: 0.06, gap: 0.03, len: 0.15, trim: 1.3, fn(s, t, o, R) {
    s.tone('sine', 1180, t, { f2: 900, gt: 0.03, a: 0.001, r: 0.05, pk: 0.3 });
    s.tone('sine', 2360, t, { a: 0.001, r: 0.02, pk: 0.08 });
    s.noise(t, { type: 'highpass', f: 3500, a: 0.0005, r: 0.012, pk: 0.2 });
  } },

  error: { rev: 0.1, len: 0.6, trim: 0.42, fn(s, t, o, R) {
    [0, 1].forEach((i) => {
      const tt = t + i * 0.135, f = i ? 92 : 118;
      s.tone('triangle', f * 1.7, tt, { f2: f, gt: 0.06, a: 0.003, r: 0.2, pk: 0.7, lp: 1100 });
      s.tone('triangle', f * 2.02, tt, { f2: f * 1.1, gt: 0.05, a: 0.003, r: 0.1, pk: 0.22, lp: 500 });
      s.noise(tt, { type: 'lowpass', f: 350, q: 0.7, a: 0.002, r: 0.06, pk: 0.5 });
    });
  } },

  flip: { rev: 0.15, len: 0.3, trim: 1.45, fn(s, t, o, R) {
    s.noise(t, { type: 'bandpass', f: 2200, f2: 6800, gt: 0.08, q: 0.8, a: 0.02, r: 0.09, pk: 0.4 });
    s.noise(t + 0.07, { type: 'highpass', f: 4200, a: 0.001, r: 0.03, pk: 0.25 });
    s.noise(t, { type: 'bandpass', f: 520, q: 0.8, a: 0.015, r: 0.06, pk: 0.14 });
  } },

  slide: { rev: 0.1, soft: true, len: 0.6, trim: 0.79, fn(s, t, o, R) {
    s.noise(t, { type: 'bandpass', f: 600, f2: 1500, gt: 0.32, q: 0.7, a: 0.07, h: 0.06, r: 0.2, pk: 0.3 });
    s.noise(t, { type: 'lowpass', f: 300, q: 0.5, a: 0.09, r: 0.22, pk: 0.14 });
  } },

  place: { rev: 0.2, len: 0.4, trim: 0.97, fn(s, t, o, R) {
    s.tone('sine', 150, t, { f2: 58, gt: 0.07, a: 0.002, r: 0.2, pk: 0.6 });
    s.noise(t, { type: 'lowpass', f: 420, a: 0.001, r: 0.06, pk: 0.4 });
    s.noise(t, { type: 'bandpass', f: 2400, q: 0.9, a: 0.001, r: 0.035, pk: 0.45 });
    s.noise(t + 0.006, { type: 'highpass', f: 5000, a: 0.001, r: 0.02, pk: 0.12 });
  } },

  deal: { rev: 0, soft: true, gap: 0.012, len: 0.1, trim: 1.47, fn(s, t, o, R) {
    const f = 3400 + R() * 1800;
    s.noise(t, { type: 'bandpass', f, f2: f * 0.55, gt: 0.03, q: 1.3, a: 0.001, r: 0.032, pk: 0.4 });
    s.tone('sine', 900 + R() * 300, t, { f2: 400, gt: 0.02, a: 0.001, r: 0.03, pk: 0.06 });
  } },

  shuffle: { rev: 0.12, len: 1.4, cost: 12, trim: 0.9, fn(s, t, o, R) {
    const times = []; let x = 0.01;
    while (x < 0.93) { times.push(x); const u = x / 0.93; x += Math.max(0.021, 0.022 + 0.018 * (0.5 + 0.5 * Math.cos(u * TAU)) + (R() - 0.5) * 0.008); }
    s.crackle(t, { times, span: 0.93, type: 'bandpass', f: [2600, 6500], q: 1.1, pk: [0.15, 0.4], dec: 0.016, rise: 0.002, shape: (u) => 0.35 + 0.65 * Math.sin(Math.PI * clamp(u * 0.9 + 0.05, 0, 1)) });
    s.noise(t, { type: 'bandpass', f: 1300, q: 0.8, a: 0.1, h: 0.7, r: 0.15, pk: 0.05 });
    // bridge tap at the end
    const te = t + 1.0;
    s.tone('sine', 140, te, { f2: 65, gt: 0.06, a: 0.002, r: 0.14, pk: 0.35 });
    s.noise(te, { type: 'bandpass', f: 2200, q: 0.9, a: 0.001, r: 0.03, pk: 0.3 });
  } },

  coin: { rev: 0.3, len: 0.9, trim: 1.6, fn(s, t, o, R) {
    clink(s, t, 2350 + R() * 500, 0.42);
  } },

  coins: { rev: 0.35, len: 2.2, cost: 100, trim: 1.5, fn(s, t, o, R) {
    const n = cnt(o.count, 4, 1, 16);
    const span = n > 1 ? Math.min(1.1, 0.07 * n + 0.15) : 0;
    const norm = 1 / Math.sqrt(1 + n * 0.22);
    for (let i = 0; i < n; i++) {
      const tt = t + (n > 1 ? span * Math.pow(i / (n - 1), 0.85) : 0) + (i ? (R() - 0.5) * 0.02 : 0);
      clink(s, tt, 2150 + R() * 900, 0.5 * norm * (0.7 + 0.3 * R()) * (1 - 0.3 * (i / n)), { pan: (R() - 0.5) * 0.7 });
    }
    s.tone('sine', 4300, t + span, { a: 0.01, r: 0.6, pk: 0.05 * norm, fm: { r: 1.6, i: 0.5, dec: 0.2 } });
  } },

  coinloss: { rev: 0.3, len: 1.6, cost: 40, trim: 1.12, fn(s, t, o, R) {
    const n = cnt(o.count, 3, 1, 8);
    const norm = 1 / Math.sqrt(1 + n * 0.15);
    for (let i = 0; i < n; i++) clink(s, t + i * 0.115, 2500 * semi(-2.3 * i), 0.4 * norm * (1 - 0.06 * i), { dull: true, pan: (R() - 0.5) * 0.3 });
    const te = t + n * 0.115;
    s.tone('sine', 230, te, { f2: 130, gt: 0.16, a: 0.005, r: 0.4, pk: 0.3 });
    s.noise(te, { type: 'lowpass', f: 500, a: 0.002, r: 0.08, pk: 0.2 });
  } },

  build: { rev: 0.35, len: 1.9, cost: 30, trim: 0.51, fn(s, t, o, R) {
    thump(s, t, 120, 0.75, 0.28);
    s.noise(t, { type: 'lowpass', f: 900, f2: 250, gt: 0.08, q: 0.8, a: 0.001, r: 0.09, pk: 0.6 });
    s.noise(t, { type: 'bandpass', f: 2200, q: 1.2, a: 0.001, r: 0.03, pk: 0.35 });
    const notes = [62, 69, 74, 78, 81];
    notes.forEach((m, i) => s.pluck(mtof(m), t + 0.14 + i * 0.075, { pk: 0.3 + 0.02 * i, r: 0.9 + 0.12 * i }));
    s.bell(mtof(93), t + 0.14 + notes.length * 0.075, { pk: 0.06, r: 1.2 });
  } },

  wonder: { rev: 0.6, len: 4.2, cost: 80, trim: 0.98, fn(s, t, o, R) {
    s.tone('sine', 73.4, t, { f2: 55, gt: 0.8, a: 0.01, r: 2.2, pk: 0.5 });
    s.noise(t, { type: 'lowpass', f: 300, q: 0.7, a: 0.005, r: 0.5, pk: 0.35 });
    [50, 57, 62, 66, 69].forEach((m, i) => [-7, 7].forEach((dt) =>
      s.tone('sawtooth', mtof(m), t + 0.02 * i, { a: 0.6, h: 0.8, r: 1.2, pk: 0.055, dt, lp: 380, lp2: 2600, lpt: 1.1, q: 1 })));
    const mix = s.gain(1), vib = s.lfo(5.1, 10, t + 0.3, 3.2);
    s.formants(mix, [[720, 4, 2.6], [1200, 5, 1.8], [2700, 6, 0.8]]);
    [62, 66, 69, 74, 57].forEach((m, i) => [-9, 9].forEach((dt) =>
      s.tone('sawtooth', mtof(m), t + 0.15 + 0.03 * i, { a: 0.75, h: 0.9, r: 1.2, pk: 0.05, dt, dm: vib, out: mix })));
    [86, 90, 93, 98].forEach((m, i) => s.bell(mtof(m), t + 0.85 + i * 0.11, { pk: 0.06, r: 1.9 }));
    s.noise(t + 0.8, { type: 'highpass', f: 6000, a: 0.4, r: 1.6, pk: 0.04 });
  } },

  discard: { rev: 0.2, len: 0.9, cost: 20, trim: 1.45, fn(s, t, o, R) {
    s.crackle(t, { n: 16, span: 0.28, curve: 1.2, type: 'bandpass', f: [1200, 5000], q: 1.2, pk: [0.15, 0.5], dec: 0.01 });
    s.noise(t, { type: 'bandpass', f: 900, q: 0.8, a: 0.05, r: 0.25, pk: 0.12 });
    clink(s, t + 0.3, 1950 + R() * 200, 0.25, { dull: true });
    clink(s, t + 0.4, 1700 + R() * 200, 0.15, { dull: true });
  } },

  military: { rev: 0.35, len: 2.2, cost: 40, trim: 0.53, fn(s, t, o, R) {
    const n = cnt(o.count, 3, 1, 5);
    const times = [0, 0.27, 0.53, 0.75, 0.95], freqs = [96, 108, 84, 100, 78], vels = [0.85, 0.65, 1.0, 0.7, 0.95];
    for (let i = 0; i < n; i++) tom(s, t + times[i], freqs[i], vels[i]);
    s.noise(t, { type: 'lowpass', f: 110, q: 1, a: 0.06, h: 0.5, r: 1.1, pk: 0.3 });
  } },

  shield: { rev: 0.35, len: 1.6, cost: 30, trim: 1.16, fn(s, t, o, R) {
    const n = cnt(o.count, 1, 1, 3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * 0.13, f = 470 * semi(i * 0.7) * (0.97 + 0.06 * R());
      s.partials(f, tt, BRONZE, { r: 1.1, pk: 0.13 });
      s.noise(tt, { type: 'highpass', f: 3000, a: 0.0005, r: 0.03, pk: 0.35 });
      s.tone('sine', 170, tt, { f2: 110, gt: 0.05, a: 0.002, r: 0.1, pk: 0.4 });
    }
  } },

  loot: { rev: 0.3, len: 1.8, cost: 60, trim: 0.46, fn(s, t, o, R) {
    s.tone('sine', 95, t, { f2: 42, gt: 0.14, a: 0.003, r: 0.4, pk: 0.8 });
    s.noise(t, { type: 'lowpass', f: 500, q: 0.7, a: 0.002, r: 0.12, pk: 0.6 });
    for (let i = 0; i < 4; i++) clink(s, t + 0.03 + i * 0.045, 1900 + R() * 700, 0.22, { pan: (R() - 0.5) * 0.4 });
    tom(s, t + 0.22, 92, 0.8);
    tom(s, t + 0.44, 78, 1.0);
    s.noise(t + 0.2, { type: 'lowpass', f: 110, q: 1, a: 0.05, r: 0.9, pk: 0.25 });
  } },

  science: { rev: 0.55, len: 3.0, cost: 95, trim: 0.64, fn(s, t, o, R) {
    const sc = [74, 76, 78, 81, 83, 86, 88, 90, 93];
    sc.forEach((m, i) => s.glass(mtof(m), t + i * 0.052, { pk: 0.13 + 0.012 * i, r: 0.5 + 0.05 * i, pan: (i / 8 - 0.5) * 0.6 }));
    const tl = t + sc.length * 0.052;
    s.glass(mtof(86), tl, { pk: 0.16, r: 1.9 }); s.glass(mtof(93), tl + 0.03, { pk: 0.12, r: 2.0 });
    s.noise(t, { type: 'bandpass', f: 2500, f2: 9000, gt: 0.5, q: 1.5, a: 0.15, r: 0.5, pk: 0.07 });
  } },

  token: { rev: 0.45, len: 2.0, cost: 40, trim: 1.06, fn(s, t, o, R) {
    thump(s, t, 210, 0.3, 0.1);
    s.noise(t, { type: 'bandpass', f: 1500, q: 1.5, a: 0.001, r: 0.02, pk: 0.2 });
    const notes = [69, 74, 78, 81, 86];
    notes.forEach((m, i) => {
      const tt = t + 0.05 + i * 0.09, last = i === notes.length - 1;
      s.bell(mtof(m), tt, { pk: 0.16, r: last ? 1.6 : 0.6 });
      s.tone('triangle', mtof(m), tt, { a: 0.002, r: 0.25, pk: 0.08, lp: 3500 });
    });
    s.noise(t + 0.4, { type: 'highpass', f: 7000, a: 0.02, r: 0.6, pk: 0.03 });
  } },

  destroy: { rev: 0.4, len: 2.6, cost: 30, trim: 0.46, fn(s, t, o, R) {
    s.noise(t, { type: 'highpass', f: 2000, a: 0.001, r: 0.06, pk: 0.4 });
    s.tone('sine', 62, t, { f2: 28, gt: 1.0, a: 0.02, r: 1.3, pk: 0.75 });
    s.noise(t, { type: 'lowpass', f: 420, f2: 90, gt: 1.2, q: 0.8, a: 0.03, h: 0.2, r: 1.1, pk: 0.7 });
    s.noise(t, { type: 'bandpass', f: 900, f2: 250, gt: 1.0, q: 0.6, a: 0.02, r: 1.0, pk: 0.3 });
    s.crackle(t + 0.05, { n: 26, span: 1.1, curve: 0.7, type: 'bandpass', f: [500, 3500], q: 1, pk: [0.15, 0.45], dec: 0.03 });
    [0, 0.22, 0.5, 0.85].forEach((d, i) => {
      const tt = t + 0.04 + d + R() * 0.04;
      s.tone('sine', 120 - i * 15, tt, { f2: 55, gt: 0.08, a: 0.002, r: 0.2, pk: 0.5 - 0.08 * i });
      s.noise(tt, { type: 'lowpass', f: 600, a: 0.001, r: 0.06, pk: 0.3 });
    });
  } },

  ageStart: { rev: 0.55, len: 5.0, cost: 50, trim: 0.89, fn(s, t, o, R) {
    const vib = s.lfo(5.2, 6, t, 3.6);
    const horn = (f0, f1, at, dur, pk) => {
      for (const dt of [-9, 9]) s.tone('sawtooth', f0, t + at, { f2: f1, gt: 0.28, a: 0.14, h: dur - 0.64, r: 0.5, pk: pk * 0.5, dt, dm: vib, lp: 420, lp2: 1500, lpt: 0.5, q: 2.2 });
      s.tone('square', f0 / 2, t + at, { f2: f1 / 2, gt: 0.28, a: 0.16, h: dur - 0.66, r: 0.5, pk: pk * 0.18, lp: 300, lp2: 700, lpt: 0.5 });
      s.noise(t + at, { type: 'bandpass', f: 900, q: 1.2, a: 0.12, h: dur - 0.62, r: 0.5, pk: 0.05 });
    };
    horn(110, 146.8, 0.05, 1.5, 0.34);
    horn(98, 146.8, 1.7, 1.7, 0.4);
    s.partials(146.8, t, GONG, { a: 0.03, r: 2.4, pk: 0.05 });
    s.partials(146.8, t + 1.7, GONG, { a: 0.006, r: 3.2, pk: 0.11 });
    thump(s, t + 1.7, 90, 0.5, 0.5);
  } },

  turn: { rev: 0.45, len: 2.2, cost: 12, trim: 0.9, fn(s, t, o, R) {
    s.partials(mtof(62), t, WARM, { a: 0.006, r: 1.1, pk: 0.24 });
    s.partials(mtof(69), t + 0.17, WARM, { a: 0.006, r: 1.5, pk: 0.22 });
  } },

  victory: { rev: 0.55, len: 6.0, cost: 145, trim: 0.52, fn(s, t, o, R) {
    const vib = s.lfo(5.4, 8, t + 0.6, 3.8);
    const B = (m, at, dur, pk, v) => { brass(s, mtof(m), t + at, dur, pk, v); brass(s, mtof(m - 12), t + at, dur, pk * 0.5, v); };
    const T = (m, at, vel) => timp(s, t + at, mtof(m), vel);
    // pickup phrase
    B(62, 0.0, 0.17, 0.28); T(38, 0, 0.9);
    B(62, 0.22, 0.17, 0.28);
    B(62, 0.44, 0.17, 0.3); T(38, 0.44, 0.7);
    B(69, 0.66, 0.6, 0.34, vib); B(66, 0.66, 0.6, 0.2, vib); T(33, 0.66, 0.85);
    B(66, 1.32, 0.16, 0.28); B(69, 1.52, 0.16, 0.3);
    // timpani roll into the climax
    [1.2, 1.3, 1.38, 1.45, 1.52, 1.58, 1.64, 1.69].forEach((at, i) => T(38, at, 0.3 + 0.05 * i));
    // climax chord
    B(74, 1.72, 2.3, 0.36, vib);
    [50, 57, 62, 66, 69].forEach((m, i) => brass(s, mtof(m), t + 1.72 + i * 0.012, 2.3, 0.2, vib));
    T(38, 1.72, 1.0); T(45, 1.72, 0.6);
    s.noise(t + 1.72, { type: 'highpass', f: 6500, a: 0.005, r: 1.6, pk: 0.14 });
    s.noise(t + 1.72, { type: 'bandpass', f: 3200, q: 1, a: 0.005, r: 0.9, pk: 0.05 });
    T(38, 2.7, 0.7); T(45, 3.05, 0.6);
    // chimes
    [86, 90, 93, 98].forEach((m, i) => s.bell(mtof(m), t + 2.0 + i * 0.09, { pk: 0.14, r: 1.8 }));
    [98, 93, 90, 86].forEach((m, i) => s.bell(mtof(m), t + 3.0 + i * 0.09, { pk: 0.1, r: 1.6 }));
    s.bell(mtof(98), t + 3.7, { pk: 0.06, r: 1.8 });
  } },

  defeat: { rev: 0.6, len: 5.6, cost: 30, trim: 0.61, fn(s, t, o, R) {
    for (const dt of [-8, 8]) s.tone('sawtooth', 147, t, { f2: 73, gt: 3.3, a: 0.35, h: 2.6, r: 1.0, pk: 0.14, dt, lp: 900, lp2: 320, lpt: 3.4, q: 2.5 });
    s.tone('sawtooth', 155.6, t + 0.25, { f2: 77.8, gt: 3.2, a: 0.5, h: 2.3, r: 1.0, pk: 0.09, lp: 800, lp2: 300, lpt: 3.2, q: 2 });
    s.tone('sine', 73, t, { f2: 36.7, gt: 3.5, a: 0.3, h: 2.6, r: 1.0, pk: 0.3 });
    s.noise(t, { type: 'lowpass', f: 100, q: 1.2, a: 0.4, h: 2.0, r: 1.6, pk: 0.35 });
    tom(s, t, 58, 0.9); tom(s, t + 1.7, 52, 0.75); tom(s, t + 3.0, 46, 0.65);
    s.bell(mtof(62), t + 0.1, { pk: 0.06, r: 2.4 });
    s.bell(mtof(56), t + 1.8, { pk: 0.05, r: 2.4 });
  } },

  tick: { rev: 0.04, soft: true, gap: 0.03, len: 0.1, trim: 1.3, fn(s, t, o, R) {
    s.tone('sine', 1500, t, { a: 0.001, r: 0.035, pk: 0.22 });
    s.noise(t, { type: 'highpass', f: 5000, a: 0.0005, r: 0.01, pk: 0.1 });
  } },

  whoosh: { rev: 0.2, soft: true, len: 0.9, trim: 0.48, fn(s, t, o, R) {
    s.noise(t, { type: 'bandpass', f: 250, f2: 2600, f3: 600, gt: 0.28, q: 1.1, a: 0.22, r: 0.32, pk: 0.4 });
    s.noise(t, { type: 'lowpass', f: 400, a: 0.2, r: 0.3, pk: 0.15 });
  } },

  pick: { rev: 0.25, len: 1.4, cost: 16, trim: 1.26, fn(s, t, o, R) {
    s.tone('sine', 210, t, { f2: 105, gt: 0.05, a: 0.003, r: 0.14, pk: 0.5 });
    s.noise(t, { type: 'bandpass', f: 750, q: 0.9, a: 0.004, r: 0.07, pk: 0.45 });
    s.noise(t + 0.01, { type: 'bandpass', f: 2600, q: 1.2, a: 0.001, r: 0.02, pk: 0.18 });
    s.bell(mtof(81), t + 0.04, { pk: 0.13, r: 0.9 });
    s.bell(mtof(86), t + 0.11, { pk: 0.11, r: 1.0 });
  } },

  flame: { rev: 0.15, len: 0.9, cost: 12, trim: 0.72, fn(s, t, o, R) {
    s.noise(t, { type: 'bandpass', f: 180, f2: 900, gt: 0.25, q: 0.7, a: 0.03, r: 0.55, pk: 0.3 });
    s.noise(t, { type: 'highpass', f: 1800, a: 0.05, r: 0.5, pk: 0.1 });
    s.crackle(t, { n: 22, span: 0.6, curve: 0.8, type: 'bandpass', f: [1500, 6500], q: 1.4, pk: [0.15, 0.55], dec: 0.006 });
  } },
};

const SFX_NAMES = Object.keys(SFX);

function makeRoot(g, t, o, def) {
  const c = g.ctx, out = c.createGain();
  out.gain.value = clamp(o.vol === undefined ? 1 : +o.vol || 0, 0, 1.5) * (def.trim || 1);
  const s = new Synth(g, out, { pf: semi(clamp(+o.pitch || 0, -36, 36)), counted: true });
  s._n(out);
  let tail = out;
  const pan = clamp(+o.pan || 0, -1, 1), panTo = o.panTo === undefined ? null : clamp(+o.panTo || 0, -1, 1);
  if ((pan || panTo !== null) && c.createStereoPanner) {
    const p = s._n(c.createStereoPanner()); p.pan.setValueAtTime(pan, t);
    if (panTo !== null) p.pan.linearRampToValueAtTime(panTo, t + Math.max(0.1, +o.panDur || def.len || 0.6));
    out.connect(p); tail = p;
  }
  tail.connect(g.sfxBus);
  if (def.rev > 0.01) { const send = s._n(c.createGain()); send.gain.value = def.rev; tail.connect(send); send.connect(g.revIn); }
  g.stats.voices++;
  if (g.stats.voices > g.stats.peakVoices) g.stats.peakVoices = g.stats.voices;
  return s;
}

function playOn(g, name, opts, t, caps) {
  const def = SFX[name];
  if (!def) return false;
  const st = g.stats;
  if (caps) {
    if (st.voices >= MAX_VOICES || (def.soft && st.voices >= SOFT_VOICES) || st.sources + (def.cost || 10) > MAX_SOURCES) { st.dropped++; return false; }
    if (def.gap) {
      const last = g.lastPlay || (g.lastPlay = {});
      if (last[name] !== undefined && Math.abs(t - last[name]) < def.gap) { st.dropped++; return false; }
      last[name] = t;
    }
  }
  const s = makeRoot(g, t, opts, def);
  try { def.fn(s, t, opts, g.rand); } catch (e) { s.kill(); st.dropped++; return false; }
  s.seal(); st.played++;
  return true;
}

/* ---------------------------------------------------------------------------
 *  Music: generative ambient bed.
 * -------------------------------------------------------------------------*/
const SCALES = {
  phryg: [0, 1, 4, 5, 7, 8, 10],     // D Phrygian dominant
  pent: [0, 4, 5, 7, 10],            // D F# G A C
  major: [0, 2, 4, 7, 9],            // D major pentatonic
  dim: [0, 1, 4, 6, 7, 8, 10],       // phrygian dominant + tritone
};
const MOODS = {
  menu: { tempo: 52, density: 0.24, bright: 0.42, reg: 66, spread: 9, drone: 0.9, cut: 380, fifth: 0.55, b2: 0.3, maj3: 0, sub: 0.3, det: 9, drum: 0.06, heart: 0, pad: 0.9, sparkle: 0, rest: 0.28, clash: 0.04, oct: 0.1,
    scale: 'phryg', padGap: [5, 9], chords: [[50, 57, 64], [50, 57, 63], [46, 53, 62], [50, 55, 62], [45, 52, 60, 64]] },
  calm: { tempo: 66, density: 0.3, bright: 0.58, reg: 69, spread: 8, drone: 0.75, cut: 520, fifth: 0.5, b2: 0.05, maj3: 0, sub: 0.25, det: 6, drum: 0.22, heart: 0, pad: 0.7, sparkle: 0.02, rest: 0.2, clash: 0, oct: 0.12,
    scale: 'pent', padGap: [7, 12], chords: [[50, 57, 64, 69], [55, 62, 69], [50, 54, 57, 64], [48, 55, 62, 64], [53, 57, 60, 64]] },
  tense: { tempo: 60, density: 0.42, bright: 0.5, reg: 60, spread: 10, drone: 0.8, cut: 340, fifth: 0.12, b2: 0.55, maj3: 0, sub: 0.55, det: 16, drum: 0.3, heart: 1, pad: 0.7, sparkle: 0, rest: 0.1, clash: 0.22, oct: 0.05,
    scale: 'dim', padGap: [5, 8], chords: [[50, 56, 63], [50, 57, 63, 68], [48, 54, 60, 66], [46, 52, 58, 62]] },
  triumph: { tempo: 88, density: 0.5, bright: 0.95, reg: 74, spread: 9, drone: 0.8, cut: 1100, fifth: 0.55, b2: 0, maj3: 0.5, sub: 0.2, det: 5, drum: 0.6, heart: 0, pad: 0.9, sparkle: 0.2, rest: 0.06, clash: 0, oct: 0.15,
    scale: 'major', padGap: [4, 7], chords: [[50, 57, 62, 66], [55, 62, 66, 71], [57, 61, 64, 69], [50, 57, 64, 66, 69]] },
};
const MOOD_NAMES = Object.keys(MOODS);
const NUM_KEYS = ['tempo', 'density', 'bright', 'reg', 'spread', 'drone', 'cut', 'fifth', 'b2', 'maj3', 'sub', 'det', 'drum', 'heart', 'pad', 'sparkle', 'rest', 'clash', 'oct'];

// Karplus-Strong pluck rendered into a buffer (oud/lyre-like).  Cached per midi note.
function makePluck(ctx, rand, freq) {
  const sr = ctx.sampleRate;
  const L = Math.max(4, Math.round(sr / freq - 0.5));
  const fa = sr / (L + 0.5);
  const T60 = clamp(2.5 - freq / 450, 1.0, 2.3);
  const N = Math.floor(sr * Math.min(2.2, T60 * 1.05 + 0.15));
  const buf = ctx.createBuffer(1, N, sr), d = buf.getChannelData(0);
  const ex = new Float32Array(L);
  let prev = 0, mean = 0;
  for (let i = 0; i < L; i++) { prev = 0.55 * (rand() * 2 - 1) + 0.45 * prev; ex[i] = prev; mean += prev; }
  mean /= L;
  const pp = Math.max(1, Math.round(L * 0.17));
  for (let i = 0; i < L; i++) d[i] = ex[i] - mean - 0.85 * (ex[(i - pp + L) % L] - mean);
  const rho = Math.pow(0.001, 1 / (T60 * fa));
  for (let n = L; n < N; n++) {
    const a = d[n - L], b = n > L ? d[n - L - 1] : a;
    d[n] = rho * 0.5 * (a + b);
  }
  let pk = 0;
  for (let i = 0; i < N; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }
  const sc = pk > 0 ? 0.9 / pk : 1;
  const fo = Math.floor(sr * 0.12);
  for (let i = 0; i < N; i++) {
    let m = sc;
    if (i < 12) m *= i / 12;
    if (i > N - fo) m *= (N - i) / fo;
    d[i] *= m;
  }
  return { buffer: buf, fa };
}

class Music {
  constructor(g, mood, now, o = {}) {
    const c = g.ctx;
    this.g = g; this.c = c; this.rand = g.rand;
    this.look = 0.5;
    this.all = [];
    this.stopping = false; this.disposed = false;
    mood = MOODS[mood] ? mood : 'calm';
    this.moodName = mood; this.tg = MOODS[mood];
    this.p = {}; for (const k of NUM_KEYS) this.p[k] = this.tg[k];

    const gn = (v) => { const n = c.createGain(); if (v !== undefined) n.gain.value = v; this.all.push(n); return n; };
    // session fades (dry / wet together)
    this.fadeDry = gn(0); this.fadeWet = gn(0);
    this.fadeDry.connect(g.musicBus); this.fadeWet.connect(g.revIn);
    const fin = o.fadeIn === undefined ? 2.5 : o.fadeIn;
    this.fadeDry.gain.setValueAtTime(0.0001, now); this.fadeWet.gain.setValueAtTime(0.0001, now);
    this.fadeDry.gain.setTargetAtTime(1, now, Math.max(0.05, fin / 4));
    this.fadeWet.gain.setTargetAtTime(1, now, Math.max(0.05, fin / 4));
    const bus = (send) => { const b = gn(1); b.connect(this.fadeDry); const s = gn(send); b.connect(s); s.connect(this.fadeWet); return b; };
    this.droneBus = bus(0.25); this.noteBus = bus(0.6); this.padBus = bus(0.95);
    // wooden body warmth for plucks / drums
    this.body = c.createBiquadFilter(); this.body.type = 'peaking'; this.body.frequency.value = 260; this.body.Q.value = 1; this.body.gain.value = 3;
    this.all.push(this.body); this.body.connect(this.noteBus);
    this.pluckIn = this.body;

    // ---- drone ----
    const mk = (type, m, det) => { const os = c.createOscillator(); os.type = type; os.frequency.value = mtof(m); if (det) os.detune.value = det; this.all.push(os); return os; };
    this.osc = { a: mk('sawtooth', 38, -7), b: mk('sawtooth', 38, 7), sub: mk('sine', 26), fifth: mk('sine', 45), b2: mk('sine', 51), maj3: mk('sine', 54) };
    this.dg = { saw: gn(0.06), sub: gn(0), fifth: gn(0), b2: gn(0), maj3: gn(0) };
    this.dFilter = c.createBiquadFilter(); this.dFilter.type = 'lowpass'; this.dFilter.Q.value = 0.9; this.all.push(this.dFilter);
    this.dAmp = gn(0.82); this.dLvl = gn(0);
    this.osc.a.connect(this.dg.saw); this.osc.b.connect(this.dg.saw); this.dg.saw.connect(this.dFilter);
    this.osc.sub.connect(this.dg.sub); this.dg.sub.connect(this.dFilter);
    this.osc.fifth.connect(this.dg.fifth); this.dg.fifth.connect(this.dFilter);
    this.osc.b2.connect(this.dg.b2); this.dg.b2.connect(this.dFilter);
    this.osc.maj3.connect(this.dg.maj3); this.dg.maj3.connect(this.dFilter);
    this.dFilter.connect(this.dAmp); this.dAmp.connect(this.dLvl); this.dLvl.connect(this.droneBus);
    // slow LFOs: filter sweep, amplitude swell, detune drift
    const lfo = (rate, ph) => { const l = c.createOscillator(); l.type = 'sine'; l.frequency.value = rate; this.all.push(l); return l; };
    this.lfoF = lfo(0.043); this.lfoFG = gn(0); this.lfoF.connect(this.lfoFG); this.lfoFG.connect(this.dFilter.frequency);
    this.lfoA = lfo(0.031); const lag = gn(0.16); this.lfoA.connect(lag); lag.connect(this.dAmp.gain);
    this.lfoD = lfo(0.021); const ldA = gn(4), ldB = gn(-4); this.lfoD.connect(ldA); this.lfoD.connect(ldB); ldA.connect(this.osc.a.detune); ldB.connect(this.osc.b.detune);
    this._applyDrone(now, 0);
    for (const k in this.osc) this.osc[k].start(now);
    this.lfoF.start(now); this.lfoA.start(now + 3); this.lfoD.start(now + 7);

    // scheduler state
    this.lastNow = now;
    this.nextStep = now + 0.15; this.si = 0; this.slots = null; this.last = 62;
    this.nextHeart = now + 1.5; this.nextPad = now + 0.5; this.lastChord = -1;
    this._poolKey = ''; this._pool = [];
  }

  _applyDrone(now, tc) {
    const T = this.tg, set = (p, v) => { if (tc > 0) p.setTargetAtTime(v, now, tc); else p.setValueAtTime(v, now); };
    set(this.dLvl.gain, 1.15 * T.drone);
    set(this.dFilter.frequency, T.cut); set(this.lfoFG.gain, T.cut * 0.45);
    set(this.dg.sub.gain, 0.075 * T.sub); set(this.dg.fifth.gain, 0.055 * T.fifth);
    set(this.dg.b2.gain, 0.05 * T.b2); set(this.dg.maj3.gain, 0.05 * T.maj3);
    set(this.osc.a.detune, -T.det); set(this.osc.b.detune, T.det);
  }

  setMood(mood, now) {
    if (!MOODS[mood] || this.stopping || mood === this.moodName) return;
    this.moodName = mood; this.tg = MOODS[mood];
    this._applyDrone(now, 2.4);
    this._poolKey = '';
    this.nextPad = Math.min(this.nextPad, now + 1 + this.rand() * 1.5);   // bring the new mood's harmony in soon
  }

  stop(now, fade) {
    if (this.stopping) return;
    this.stopping = true;
    const tc = Math.max(0.03, fade / 6);
    this.fadeDry.gain.setTargetAtTime(0, now, tc); this.fadeWet.gain.setTargetAtTime(0, now, tc);
    this.stopAt = now + fade * 1.3 + 0.2;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.stopping = true;
    for (const k in this.osc) { try { this.osc[k].stop(); } catch (e) { /* ignore */ } }
    try { this.lfoF.stop(); this.lfoA.stop(); this.lfoD.stop(); } catch (e) { /* ignore */ }
    for (const n of this.all) { try { n.disconnect(); } catch (e) { /* ignore */ } }
    this.all.length = 0;
  }

  /* ----- scheduler ----- */
  update(now) {
    if (this.disposed || this.stopping) return;
    const R = this.rand, p = this.p, tg = this.tg;
    const dt = clamp(now - this.lastNow, 0, 1); this.lastNow = now;
    const k = 1 - Math.exp(-dt / 3);
    for (const key of NUM_KEYS) p[key] += (tg[key] - p[key]) * k;
    if (this.nextStep < now - 0.25) {    // resume after mute / suspend
      this.nextStep = now + 0.05;
      this.nextPad = Math.max(this.nextPad, now + 1);
      this.nextHeart = Math.max(this.nextHeart, now + 0.2);
    }
    const horizon = now + this.look;
    while (this.nextStep < horizon) {
      this.step(this.nextStep);
      this.nextStep += 30 / p.tempo; this.si++;
    }
    while (this.nextHeart < horizon) {
      if (p.heart > 0.08) this.heartbeat(this.nextHeart, p.heart);
      this.nextHeart += 1.15 + R() * 0.05;
    }
    while (this.nextPad < horizon) {
      this.pad(this.nextPad);
      const [lo, hi] = tg.padGap; this.nextPad += lo + R() * (hi - lo);
    }
  }

  pool() {
    const p = this.p, key = this.tg.scale + Math.round(p.reg) + Math.round(p.spread);
    if (key === this._poolKey) return this._pool;
    const sc = SCALES[this.tg.scale], out = [];
    for (let o = -3; o <= 5; o++) for (const d of sc) {
      const m = 50 + o * 12 + d;
      if (m >= p.reg - p.spread && m <= p.reg + p.spread) out.push(m);
    }
    out.sort((a, b) => a - b);
    this._poolKey = key; this._pool = out;
    return out;
  }

  nextNote(last, anchor) {
    const R = this.rand, pool = this.pool();
    if (!pool.length) return last;
    if (anchor && R() < 0.35) {
      const tones = pool.filter((m) => { const d = (((m - 50) % 12) + 12) % 12; return d === 0 || d === 7; });
      if (tones.length) return tones[(R() * tones.length) | 0];
    }
    let idx = 0, best = 1e9;
    pool.forEach((m, i) => { const dd = Math.abs(m - last); if (dd < best) { best = dd; idx = i; } });
    const bias = (this.p.reg - last) / this.p.spread;
    let step = Math.round((R() + R() + R() - 1.5) * 3.0 + bias * 1.5);
    if (step === 0 && R() < 0.5) step = R() < 0.5 ? -1 : 1;
    idx += step;
    if (idx < 0) idx = -idx; if (idx > pool.length - 1) idx = 2 * (pool.length - 1) - idx;
    return pool[clamp(idx, 0, pool.length - 1)];
  }

  newBar() {
    const R = this.rand, p = this.p;
    this.slots = null;
    if (R() < this.tg.rest) return;
    let n = clamp(Math.round(p.density * 8 * (0.55 + R() * 0.9)), 1, 6);
    const slots = new Array(8).fill(null);
    let cnt = 0;
    if (R() < 0.6) { slots[0] = true; cnt++; }
    let guard = 0;
    while (cnt < n && guard++ < 40) { const i = (R() * 8) | 0; if (!slots[i]) { slots[i] = true; cnt++; } }
    let last = this.last;
    for (let i = 0; i < 8; i++) if (slots[i]) {
      last = this.nextNote(last, i === 0);
      slots[i] = { midi: last, vel: (i === 0 ? 0.75 : 0.5) + R() * 0.35 };
    }
    this.last = last;
    this.slots = slots;
  }

  step(t) {
    const R = this.rand, p = this.p, s8 = this.si % 8, stepDur = 30 / p.tempo;
    if (s8 === 0) this.newBar();
    const sl = this.slots && this.slots[s8];
    if (sl) {
      const tt = t + (R() - 0.5) * 0.04 + (s8 & 1 ? 0.02 : 0);
      this.pluck(tt, sl.midi, sl.vel);
      if (R() < p.oct) this.pluck(tt + stepDur * (1 + ((R() * 2) | 0)), sl.midi + 12, sl.vel * 0.3);
      if (R() < p.clash) this.pluck(tt + 0.035, sl.midi + 1, sl.vel * 0.4);
    }
    // frame drum
    if (p.drum > 0.05) {
      if (s8 === 0 && R() < p.drum) this.drum(t, 0.8 + R() * 0.2);
      else if (s8 === 4 && R() < p.drum * 0.7) this.drum(t + (R() - 0.5) * 0.02, 0.5 + R() * 0.15);
      else if ((s8 === 2 || s8 === 6) && R() < p.drum * 0.15) this.drum(t, 0.28);
    }
    // glassy sparkle
    if (p.sparkle > 0.01 && R() < p.sparkle * 0.25) {
      const pen = SCALES.major, m = 74 + 12 * ((R() * 2) | 0) + pen[(R() * pen.length) | 0];
      this.bellNote(t + R() * 0.1, m, 0.05 + R() * 0.04);
    }
  }

  getPluck(midi) {
    const cache = this.g.pluckCache, key = Math.round(midi);
    let e = cache.get(key);
    if (!e) {
      e = makePluck(this.c, this.rand, mtof(key));
      cache.set(key, e);
      if (cache.size > 30) cache.delete(cache.keys().next().value);
    } else { cache.delete(key); cache.set(key, e); }
    return e;
  }

  pluck(t, midi, vel) {
    const R = this.rand, p = this.p, f = mtof(midi), e = this.getPluck(midi);
    const s = new Synth(this.g, this.pluckIn, { count: false });
    const lp = clamp(f * (2.5 + 9 * p.bright * (0.4 + 0.6 * vel)), 500, 9000);
    s.sample(e.buffer, f / e.fa, t, { lp, vol: vel * 0.8, pan: (R() - 0.5) * 0.9 });
    s.seal();
  }

  bellNote(t, midi, pk) {
    const s = new Synth(this.g, this.noteBus, { count: false });
    s.bell(mtof(midi), t, { pk, r: 2.4, pan: (this.rand() - 0.5) * 0.8 });
    s.seal();
  }

  drum(t, vel) {
    const s = new Synth(this.g, this.pluckIn, { count: false });
    s.tone('sine', 170, t, { f2: 95, gt: 0.09, a: 0.002, r: 0.35, pk: 0.22 * vel });
    s.tone('sine', 250, t, { f2: 150, gt: 0.05, a: 0.002, r: 0.12, pk: 0.07 * vel });
    s.noise(t, { type: 'bandpass', f: 700, q: 1.2, a: 0.001, r: 0.04, pk: 0.12 * vel });
    s.seal();
  }

  heartbeat(t, lvl) {
    const s = new Synth(this.g, this.noteBus, { count: false });
    s.tone('sine', 72, t, { f2: 42, gt: 0.08, a: 0.004, r: 0.22, pk: 0.34 * lvl });
    s.tone('sine', 62, t + 0.25, { f2: 40, gt: 0.08, a: 0.004, r: 0.2, pk: 0.22 * lvl });
    s.noise(t, { type: 'lowpass', f: 200, a: 0.003, r: 0.06, pk: 0.12 * lvl });
    s.seal();
  }

  pad(t) {
    const R = this.rand, p = this.p, chords = this.tg.chords;
    let ci = (R() * chords.length) | 0; if (ci === this.lastChord) ci = (ci + 1) % chords.length; this.lastChord = ci;
    const ch = chords[ci], dur = 6 + R() * 3, lp = 700 + 2400 * p.bright;
    const s = new Synth(this.g, this.padBus, { count: false });
    const base = 0.032 * p.pad;
    ch.forEach((m, i) => {
      const f = mtof(m), pan = (R() - 0.5) * 1.0, tt = t + i * 0.25;
      s.tone('triangle', f, tt, { a: 2.2, h: Math.max(0.1, dur - 3), r: 3.6, pk: base * 0.6, dt: -5, lp, pan });
      s.tone('sine', f, tt, { a: 2.2, h: Math.max(0.1, dur - 3), r: 3.6, pk: base * 0.8, dt: 5, lp, pan });
    });
    if (R() < 0.4) s.noise(t, { type: 'bandpass', f: mtof(ch[ch.length - 1] + 12), q: 10, a: 2.5, h: 1, r: 3.5, pk: 0.035 * p.pad });
    s.seal();
  }
}

/* ---------------------------------------------------------------------------
 *  Public class
 * -------------------------------------------------------------------------*/
export class GameAudio {
  constructor() {
    this._ctx = null; this._g = null;
    this._levels = { ...DEFAULT_LEVELS };
    this._muted = false;
    this._music = null; this._mood = 'calm'; this._wantMusic = false; this._timer = null;
    this._unlockArmed = false;
    this._pend = [];
  }

  static get SFX_NAMES() { return SFX_NAMES.slice(); }
  static get MOODS() { return MOOD_NAMES.slice(); }

  get muted() { return this._muted; }
  set muted(v) { this.setMuted(v); }
  get context() { return this._ctx; }
  get stats() {
    const st = this._g ? this._g.stats : { voices: 0, sources: 0, peakVoices: 0, peakSources: 0, played: 0, dropped: 0 };
    return { ...st, state: this._ctx ? this._ctx.state : 'none', musicRunning: !!this._music, mood: this._mood };
  }
  has(name) { return !!SFX[name]; }

  init() {
    if (this._ctx) return true;
    try {
      const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
      if (!AC) return false;
      let ctx;
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
      this._ctx = ctx;
      this._g = buildGraph(ctx);
      this._g.levels = { ...this._levels }; this._g.muted = this._muted;
      applyLevels(this._g, 0, 0);
      this._armUnlock();
      try { ctx.onstatechange = () => { if (ctx.state === 'running') this._onRunning(); }; } catch (e) { /* ignore */ }
      if (this._wantMusic) this._launchMusic();
      return true;
    } catch (e) {
      this._ctx = null; this._g = null;
      return false;
    }
  }

  resume() {
    try {
      if (!this._ctx) this.init();
      const c = this._ctx;
      if (c && c.state !== 'running' && c.state !== 'closed') {
        const p = c.resume();
        if (p && p.catch) p.catch(() => {});
        return p;
      }
    } catch (e) { /* ignore */ }
    return undefined;
  }

  _onRunning() {
    if (this._wantMusic && !this._music) this._launchMusic();
    const now = typeof performance !== 'undefined' ? performance.now() : 0, pend = this._pend.splice(0);
    for (const [n, o, ts] of pend) if (now - ts < 500) this.play(n, o);   // sounds requested during the unlock click
  }

  _armUnlock() {
    if (this._unlockArmed || typeof window === 'undefined' || !window.addEventListener) return;
    this._unlockArmed = true;
    const evs = ['pointerdown', 'keydown', 'touchend', 'click'];
    const h = () => {
      this.resume();
      if (this._ctx && this._ctx.state === 'running') { evs.forEach((e) => window.removeEventListener(e, h, true)); this._unlockArmed = false; }
    };
    evs.forEach((e) => window.addEventListener(e, h, true));
  }

  _applyLevels(tc) {
    if (!this._ctx || !this._g) return;
    try {
      this._g.levels = { ...this._levels }; this._g.muted = this._muted;
      applyLevels(this._g, this._ctx.currentTime, tc);
    } catch (e) { /* ignore */ }
  }

  setMuted(m) {
    this._muted = !!m;
    this._applyLevels(0.03);
    if (!this._muted && this._ctx) this.resume();
  }
  setVolume(v) { this._levels.master = clamp(+v || 0, 0, 1); this._applyLevels(0.03); }
  setMusicVolume(v) { this._levels.music = clamp(+v || 0, 0, 1); this._applyLevels(0.05); }
  setSfxVolume(v) { this._levels.sfx = clamp(+v || 0, 0, 1); this._applyLevels(0.03); }

  play(name, opts = {}) {
    try {
      const def = SFX[name];
      if (!def || this._muted) return false;
      if (!this._ctx) this.init();
      const ctx = this._ctx;
      if (!ctx) return false;
      if (ctx.state !== 'running') {
        this.resume();
        this._pend.push([name, opts, typeof performance !== 'undefined' ? performance.now() : 0]);
        if (this._pend.length > 4) this._pend.shift();
        return false;
      }
      opts = opts || {};
      const t = ctx.currentTime + Math.max(0, +opts.delay || 0) + 0.008;
      return playOn(this._g, name, opts, t, true);
    } catch (e) { return false; }
  }

  /* ----- music ----- */
  startMusic(mood = 'calm') {
    try {
      this._mood = MOODS[mood] ? mood : 'calm';
      this._wantMusic = true;
      if (!this._ctx) this.init();
      if (!this._ctx) return;
      if (this._music) { this.setMood(this._mood); return; }
      this._launchMusic();
    } catch (e) { /* ignore */ }
  }

  _launchMusic() {
    if (!this._ctx || !this._g || this._music) return;
    try {
      const m = new Music(this._g, this._mood, this._ctx.currentTime);
      this._music = m;
      this._timer = setInterval(() => this._tick(), 100);
    } catch (e) { this._music = null; }
  }

  _tick() {
    const m = this._music, ctx = this._ctx;
    if (!m || !ctx) return;
    try {
      if (this._muted || ctx.state !== 'running') return;
      m.look = typeof document !== 'undefined' && document.hidden ? 1.6 : 0.5;
      m.update(ctx.currentTime);
    } catch (e) { /* ignore */ }
  }

  stopMusic(fadeSeconds = 1.5) {
    try {
      this._wantMusic = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      const m = this._music;
      if (!m) return;
      this._music = null;
      const fade = Math.max(0.05, +fadeSeconds || 0);
      if (this._ctx) m.stop(this._ctx.currentTime, fade);
      setTimeout(() => m.dispose(), (fade * 1.3 + 0.4) * 1000);
    } catch (e) { /* ignore */ }
  }

  setMood(mood) {
    try {
      if (!MOODS[mood]) return;
      this._mood = mood;
      if (this._music && this._ctx) this._music.setMood(mood, this._ctx.currentTime);
    } catch (e) { /* ignore */ }
  }

  /* ----- offline rendering (tests) ----- */
  static _oac(channels, secs, sr) {
    const OAC = typeof globalThis !== 'undefined' ? (globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext) : null;
    if (!OAC) return null;
    return new OAC(channels, Math.ceil(sr * secs), sr);
  }

  // Renders one sound through the full master chain. The sound starts at 0.05 s (+ opts.delay).
  static async renderToBuffer(name, opts = {}, o = {}) {
    const def = SFX[name]; if (!def) return null;
    opts = opts || {};
    const sr = o.sampleRate || 44100;
    const secs = o.seconds || Math.min(9, (def.len || 3) + 1.5 + (+opts.delay || 0));
    const ctx = GameAudio._oac(2, secs, sr); if (!ctx) return null;
    const g = buildGraph(ctx, { rand: mulberry32(o.seed === undefined ? hashStr(name) : o.seed) });
    playOn(g, name, opts, 0.05 + (+opts.delay || 0), false);
    const buf = await ctx.startRendering();
    buf.sfxStats = { ...g.stats };
    return buf;
  }

  // events: [{ name, opts, at }] -> AudioBuffer (no voice caps; use for mix / limiter tests)
  static async renderScenario(events, seconds, o = {}) {
    const sr = o.sampleRate || 44100;
    const ctx = GameAudio._oac(2, seconds, sr); if (!ctx) return null;
    const g = buildGraph(ctx, { rand: mulberry32(o.seed === undefined ? 1234 : o.seed) });
    let maxOverlap = 0;
    events.forEach((e) => playOn(g, e.name, e.opts || {}, 0.05 + (e.at || 0), false));
    // analytic overlap estimate
    const iv = events.filter((e) => SFX[e.name]).map((e) => [e.at || 0, (e.at || 0) + SFX[e.name].len]);
    iv.forEach(([a]) => { const n = iv.filter(([x, y]) => x <= a && y > a).length; if (n > maxOverlap) maxOverlap = n; });
    let m = null;
    if (o.music) {
      m = new Music(g, o.music, 0, {});
      for (let t = 0; t < seconds; t += 0.1) m.update(t);
    }
    const buf = await ctx.startRendering();
    buf.maxOverlap = maxOverlap;
    if (m) m.dispose();
    return buf;
  }

  // Renders `seconds` of the music bed. changes: [[time, mood], ...] to test crossfades.
  static async renderMusic(mood, seconds = 20, o = {}) {
    const sr = o.sampleRate || 44100;
    const ctx = GameAudio._oac(2, seconds, sr); if (!ctx) return null;
    const g = buildGraph(ctx, { rand: mulberry32(o.seed === undefined ? hashStr(mood) : o.seed) });
    const m = new Music(g, mood, 0, { fadeIn: o.fadeIn });
    (o.mute || []).forEach((k) => { if (m[k + 'Bus']) m[k + 'Bus'].gain.value = 0; });   // debug: 'drone' | 'note' | 'pad'
    const changes = (o.changes || []).slice().sort((a, b) => a[0] - b[0]);
    for (let t = 0; t < seconds; t += 0.1) {
      while (changes.length && changes[0][0] <= t) m.setMood(changes.shift()[1], t);
      m.update(t);
    }
    const buf = await ctx.startRendering();
    buf.pluckCacheSize = g.pluckCache.size;
    m.dispose();
    return buf;
  }
}

export default GameAudio;
