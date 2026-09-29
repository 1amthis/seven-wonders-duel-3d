// Tiny promise-based tween engine driven by the render loop.
export const ease = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: t => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
  outBounce: t => { const n1 = 7.5625, d1 = 2.75; if (t < 1 / d1) return n1 * t * t; if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75; if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375; return n1 * (t -= 2.625 / d1) * t + 0.984375; },
};

export class Tweens {
  constructor() { this.items = []; this.speed = 1; }
  /** run(duration, update(k, eased), {delay, ease}) -> Promise resolved when finished */
  run(dur, update, { delay = 0, ease: e = ease.inOutCubic } = {}) {
    return new Promise(resolve => {
      this.items.push({ dur: Math.max(0.0001, dur), t: -delay, update, ease: e, resolve, started: false });
    });
  }
  wait(sec) { return this.run(sec, () => {}, { ease: ease.linear }); }
  update(dt) {
    dt = Math.min(dt, 0.1) * this.speed;
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      it.t += dt;
      if (it.t < 0) continue;
      const k = Math.min(1, it.t / it.dur);
      it.update(k, it.ease(k));
      if (k >= 1) { items.splice(i, 1); i--; it.resolve(); }
    }
  }
  clear() { for (const it of this.items) it.resolve(); this.items.length = 0; }
}
