// Renderer, post-processing chain, orbit camera rig with cinematic presets, picking.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { TABLE } from './layout.js';

// Runs on linear HDR colour, before the OutputPass tone-maps it.
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 1.35 }, uAberr: { value: 0.006 }, uFlash: { value: new THREE.Vector3() }, uSat: { value: 1.08 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette, uAberr, uSat; uniform vec3 uFlash; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c, c);
      vec2 off = c * d * uAberr;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114)); col = mix(vec3(l), col, uSat);
      col *= 1.0 - d * uVignette;
      col += uFlash * (1.0 - d * 1.2);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Film grain, applied after the OutputPass so uAmount is a plain display-space level (0.01 is about 2.5 of 255). Added
// before tone-mapping it is stretched by the sRGB curve: on this dark scene the same noise looked like TV static.
const GrainShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAmount: { value: 0.016 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uAmount; varying vec2 vUv;
    float hash(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
    void main(){
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float frame = mod(floor(uTime * 24.), 97.); // re-drawn 24 times a second, like film; mod keeps the hash input small enough for fp32
      col += (hash(gl_FragCoord.xy + frame * vec2(37., 59.)) - 0.5) * uAmount;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
    this.shadowDirty = true; this.lastShadow = -9;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 900);
    this._last = performance.now();
    this.time = 0;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2(-9, -9);
    this.quality = 'high';
    this.viewInsets = { top: 96, bottom: 0 };
    // rig
    this.rig = { target: new THREE.Vector3(0, 0, -1.5), yaw: 0, pitch: 0.92, dist: 26, fov: 34 };
    this.goal = { target: new THREE.Vector3(0, 0, -1.5), yaw: 0, pitch: 0.92, dist: 26 };
    this.user = { yaw: 0, pitch: 0, zoom: 1, pan: new THREE.Vector3() };
    this.shakeAmt = 0; this.shakeT = 0;
    this.fitZoom = 1;
    this.frameCbs = [];
    this._buildComposer(1, 1);
    this._bindInput();
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  _buildComposer(w, h) {
    const r = this.renderer;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.quality === 'low' ? 0 : 4 });
    this.composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), 0.42, 0.7, 0.88);
    this.final = new ShaderPass(FinalShader);
    this.grain = new ShaderPass(GrainShader);
    for (const p of [this.renderPass, this.bloom, this.final, new OutputPass(), this.grain]) this.composer.addPass(p);
  }

  setQuality(q) {
    this.quality = q;
    const pr = q === 'high' ? Math.min(devicePixelRatio, 1.5) : q === 'medium' ? Math.min(devicePixelRatio, 1.15) : 1;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.bloom.enabled = q !== 'low';
    const samples = q === 'high' ? 4 : q === 'medium' ? 2 : 0;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) { if (rt.samples !== samples) { rt.samples = samples; rt.dispose(); } }
    const light = this.scene.getObjectByProperty('isDirectionalLight', true);
    this.scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) { const s = q === 'high' ? 3072 : q === 'medium' ? 2048 : 1024; if (o.shadow.mapSize.x !== s) { o.shadow.mapSize.set(s, s); if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; } this.shadowDirty = true; } } });
    this.resize();
  }

  resize() {
    const w = this.forceSize?.w || this.canvas.clientWidth || innerWidth, h = this.forceSize?.h || this.canvas.clientHeight || innerHeight;
    const pr = this.pixelRatio || Math.min(devicePixelRatio, 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    this.bloom.setSize(w * pr / 2, h * pr / 2);
    this.camera.aspect = w / h;
    this.w = w; this.h = h;
    // vertical shift to account for HUD bars
    if (this.getInsets) this.viewInsets = this.getInsets();
    const shift = (this.viewInsets.top - this.viewInsets.bottom) / 2;
    this.camera.setViewOffset(w, h, 0, -shift, w, h);
    // camera distance that fits the table width
    const vfov = THREE.MathUtils.degToRad(this.rig.fov), hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const availH = h - this.viewInsets.top - this.viewInsets.bottom;
    const needW = (TABLE.w + 0.2) / 2 / Math.tan(hfov / 2);
    const needH = ((TABLE.d + 1) * 0.81) / (2 * Math.tan(vfov / 2)) * (h / Math.max(200, availH));
    this.fitDist = Math.max(needW, needH);
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ camera
  goto(name, opts = {}) {
    const P = { ...this.presets()[name], ...opts };
    const fin = (v, d) => (Number.isFinite(v) ? v : d);
    Object.assign(this.goal, { target: P.target.clone(), yaw: fin(P.yaw, this.goal.yaw), pitch: fin(P.pitch, this.goal.pitch), dist: fin(P.dist, this.goal.dist) });
    this.user.yaw = 0; this.user.pitch = 0; this.user.zoom = 1; this.user.pan.set(0, 0, 0);
    this.viewName = opts.name || name;
    if (opts.snap) { this.rig.target.copy(this.goal.target); this.rig.yaw = this.goal.yaw; this.rig.pitch = this.goal.pitch; this.rig.dist = this.goal.dist; }
  }
  presets() {
    const f = this.fitDist || 24;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    return {
      overview: { target: V(0, 0, -1.2), yaw: 0, pitch: 1.0, dist: f },
      structure: { target: V(0, 0, 0.2), yaw: 0, pitch: 1.0, dist: f * 0.46 },
      left: { target: V(-7.4, 0, -1.2), yaw: 0.05, pitch: 1.0, dist: f * 0.5 },
      right: { target: V(7.4, 0, -1.2), yaw: -0.05, pitch: 1.0, dist: f * 0.5 },
      wondersLeft: { target: V(-7.9, 0, 3.6), yaw: 0.08, pitch: 0.72, dist: f * 0.42 },
      wondersRight: { target: V(7.9, 0, 3.6), yaw: -0.08, pitch: 0.72, dist: f * 0.42 },
      military: { target: V(0, 0, -6.2), yaw: 0, pitch: 0.85, dist: f * 0.55 },
      draft: { target: V(0, 0, 0.3), yaw: 0, pitch: 0.95, dist: f * 0.4 },
      cinematic: { target: V(0, 0.5, -1.4), yaw: 0.6, pitch: 0.42, dist: f * 0.9 },
      low: { target: V(0, 0.5, -1.4), yaw: -0.5, pitch: 0.3, dist: f * 1.1 },
      pawn: { target: V(0, 0, -6.4), yaw: 0, pitch: 0.6, dist: f * 0.34 },
    };
  }
  shake(a = 0.3, t = 0.6) { this.shakeAmt = Math.max(this.shakeAmt, a); this.shakeT = Math.max(this.shakeT, t); this._shakeDur = t; }

  _bindInput() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointermove', e => {
      this.pointer.set((e.clientX / this.w) * 2 - 1, -(e.clientY / this.h) * 2 + 1);
      this.pointerPx = { x: e.clientX, y: e.clientY };
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          if (drag.button === 2 || e.shiftKey) { // pan
            const k = this.rig.dist * 0.0011;
            this.user.pan.x -= dx * k; this.user.pan.z -= dy * k * 1.4;
          } else { this.user.yaw -= dx * 0.005; this.user.pitch += dy * 0.004; }
          this.user.pitch = Math.max(-0.7, Math.min(0.5, this.user.pitch)); this.user.yaw = Math.max(-1.6, Math.min(1.6, this.user.yaw));
          drag.x = e.clientX; drag.y = e.clientY;
        }
      }
    });
    const setPtr = e => { this.pointer.set((e.clientX / this.w) * 2 - 1, -(e.clientY / this.h) * 2 + 1); this.pointerPx = { x: e.clientX, y: e.clientY }; };
    c.addEventListener('pointerdown', e => { setPtr(e); drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false }; try { c.setPointerCapture(e.pointerId); } catch { /* synthetic events */ } });
    c.addEventListener('pointerup', e => { const was = drag; drag = null; setPtr(e); if (was && !was.moved && e.button === 0) this.onClick?.(e); });
    c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.pointer.set(-9, -9); });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('wheel', e => { e.preventDefault(); this.user.zoom = Math.max(0.28, Math.min(1.35, this.user.zoom * Math.exp(e.deltaY * 0.001))); }, { passive: false });
    this.onClick = null;
  }

  pick(objs) {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(objs, false);
    return hits[0] || null;
  }

  // ------------------------------------------------------------ frame
  frame() {
    const now = performance.now(); const dt = Math.min((now - this._last) / 1000, 0.1); this._last = now;
    this.time += dt;
    const g = this.goal, r = this.rig, u = this.user;
    const k = 1 - Math.exp(-dt * 3.2);
    r.target.lerp(g.target.clone().add(u.pan), k);
    r.yaw += ((g.yaw + u.yaw) - r.yaw) * k;
    r.pitch += ((g.pitch + u.pitch) - r.pitch) * k;
    r.dist += ((g.dist * u.zoom) - r.dist) * k;
    const pitch = Math.max(0.16, Math.min(1.45, r.pitch));
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const t = this.time;
    let sx = 0, sy = 0;
    if (this.shakeT > 0) { this.shakeT -= dt; const a = this.shakeAmt * Math.max(0, this.shakeT / this._shakeDur); sx = (Math.random() - 0.5) * a; sy = (Math.random() - 0.5) * a; if (this.shakeT <= 0) this.shakeAmt = 0; }
    const sway = 0.05;
    this.camera.position.set(
      r.target.x + Math.sin(r.yaw) * cp * r.dist + Math.sin(t * 0.21) * sway + sx,
      r.target.y + sp * r.dist + Math.sin(t * 0.17) * sway * 0.6 + sy,
      r.target.z + Math.cos(r.yaw) * cp * r.dist + Math.cos(t * 0.19) * sway,
    );
    this.camera.lookAt(r.target.x, r.target.y, r.target.z);
    this.grain.uniforms.uTime.value = t;
    const fl = this.final.uniforms.uFlash.value;
    fl.multiplyScalar(Math.exp(-dt * 5));
    for (const cb of this.frameCbs) cb(dt, t);
    if (this.shadowDirty || t - this.lastShadow > 0.4) { this.renderer.shadowMap.needsUpdate = true; this.lastShadow = t; this.shadowDirty = false; }
    this.composer.render(dt);
  }
  flash(r, g, b) { this.final.uniforms.uFlash.value.add(new THREE.Vector3(r, g, b)); }
}
