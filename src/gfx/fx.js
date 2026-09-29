// Visual effects: GPU point particles, floating text, shockwave rings, light pillars.
import * as THREE from 'three';
import { mkCanvas, FONT_TITLE } from './draw.js';
import { ease } from './tween.js';

const vert = `
attribute vec3 aColor; attribute float aAlpha; attribute float aSize; varying vec3 vColor; varying float vAlpha; uniform float uScale;
void main(){ vColor = aColor; vAlpha = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`;
const frag = `
varying vec3 vColor; varying float vAlpha;
void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0; float a = smoothstep(1.0, 0.0, d); a *= a; if (a < 0.01) discard; gl_FragColor = vec4(vColor * (0.6 + 0.8 * a), a * vAlpha); }`;

export class Particles {
  constructor(scene, stage, capacity = 4000) {
    this.cap = capacity; this.n = 0; this.stage = stage;
    this.pos = new Float32Array(capacity * 3); this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3); this.alpha = new Float32Array(capacity); this.size = new Float32Array(capacity);
    this.age = new Float32Array(capacity); this.life = new Float32Array(capacity); this.grav = new Float32Array(capacity); this.drag = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity); this.fade = new Uint8Array(capacity);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 800 } } });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 10;
    scene.add(this.points);
  }
  emit(o) {
    const { pos, vel = [0, 0, 0], color = [1, 0.8, 0.4], life = 1, size = 0.2, gravity = 0, drag = 0, fade = 1 } = o;
    if (this.n >= this.cap) return;
    const i = this.n++, i3 = i * 3;
    this.pos.set(pos, i3); this.vel.set(vel, i3); this.col.set(color, i3);
    this.age[i] = 0; this.life[i] = life; this.size0[i] = size; this.size[i] = size; this.alpha[i] = 1; this.grav[i] = gravity; this.drag[i] = drag; this.fade[i] = fade;
  }
  /** spray of sparks from a point */
  burst({ pos, count = 40, color = [1, 0.8, 0.4], speed = 3, spread = 1, up = 1, gravity = 6, life = 1.1, size = 0.16, drag = 0.6, jitter = 0.35 }) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() * spread) * Math.PI / 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      const c = color.map(v => Math.min(1.5, v * (1 - jitter + Math.random() * jitter * 2)));
      this.emit({ pos: [pos[0], pos[1], pos[2]], vel: [Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s * up + 0.5, Math.sin(a) * Math.cos(e) * s], color: c, life: life * (0.6 + Math.random() * 0.8), size: size * (0.6 + Math.random() * 0.9), gravity, drag });
    }
  }
  /** column of rising glitter */
  glitter({ pos, count = 30, color = [1, 0.85, 0.5], radius = 0.6, height = 2, life = 1.6, size = 0.1 }) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
      this.emit({ pos: [pos[0] + Math.cos(a) * r, pos[1] + Math.random() * 0.2, pos[2] + Math.sin(a) * r], vel: [0, height / life * (0.5 + Math.random()), 0], color, life: life * (0.6 + Math.random() * 0.6), size: size * (0.5 + Math.random()), gravity: 0, drag: 0.2 });
    }
  }
  update(dt) {
    const s = this.stage;
    this.mat.uniforms.uScale.value = (s.h * (s.pixelRatio || 1)) / (2 * Math.tan(THREE.MathUtils.degToRad(s.rig.fov) / 2));
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { // swap-remove
        const l = --this.n;
        if (i !== l) {
          for (const a of [this.pos, this.vel, this.col]) for (let k = 0; k < 3; k++) a[i * 3 + k] = a[l * 3 + k];
          for (const a of [this.alpha, this.size, this.age, this.life, this.grav, this.drag, this.size0, this.fade]) a[i] = a[l];
        }
        continue;
      }
      const i3 = i * 3, dr = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const k = this.age[i] / this.life[i];
      this.alpha[i] = this.fade[i] ? Math.min(1, (1 - k) * 2.2) * Math.min(1, k * 14) : 1;
      this.size[i] = this.size0[i] * (1 - k * 0.5);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const a of ['position', 'aColor', 'aAlpha', 'aSize']) this.geo.attributes[a].needsUpdate = true;
  }
}

// ------------------------------------------------------------------ floating text
export function makeFloatText(text, { color = '#ffe9a8', size = 96, stroke = '#2a1600' } = {}) {
  const cv = mkCanvas(512, 160), ctx = cv.getContext('2d');
  ctx.font = `800 ${size}px ${FONT_TITLE}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round'; ctx.lineWidth = 14; ctx.strokeStyle = stroke; ctx.strokeText(text, 256, 84);
  ctx.fillStyle = color; ctx.fillText(text, 256, 80);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, fog: false }));
  sp.scale.set(2.6, 0.81, 1); sp.renderOrder = 20;
  return sp;
}

// ------------------------------------------------------------------ rings & pillars
export function makeShockwave(color = 0xffd36a) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  m.rotation.x = -Math.PI / 2; m.renderOrder = 8; return m;
}
export function makePillar(color = 0xffe6a0, h = 6, r = 0.7) {
  const cv = mkCanvas(4, 128), ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0.95)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(cv);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, h, 32, 1, true), new THREE.MeshBasicMaterial({ map: t, color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  m.position.y = h / 2; m.renderOrder = 8; return m;
}
