// Night-time Mediterranean terrace: sky dome, marble floor, columns, braziers with living flames, embers and dust.
import * as THREE from 'three';
import { mkCanvas, makeNoise, rng, lin, rad, rgba, FONT_TITLE } from './draw.js';
import { TABLE } from './layout.js';

const skyVert = `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const skyFrag = `
varying vec3 vDir; uniform float uTime;
float hash(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
              mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 zen = vec3(0.012,0.02,0.09), mid = vec3(0.07,0.06,0.2), hor = vec3(0.9,0.38,0.22);
  vec3 col = mix(hor, mid, smoothstep(0.0, 0.22, h)); col = mix(col, zen, smoothstep(0.18, 0.85, h));
  col = mix(col, vec3(0.015,0.015,0.03), smoothstep(0.0, -0.2, h));
  // milky way band
  float band = exp(-pow(dot(d, normalize(vec3(0.3,0.5,-0.8)))*4.0, 2.0));
  float mw = noise(d*9.0)*noise(d*22.0); col += vec3(0.25,0.22,0.4)*band*mw*0.9*smoothstep(0.02,0.4,h);
  // stars
  vec3 p = d*260.; vec3 ip = floor(p); vec3 fp = fract(p)-0.5; float r = hash(ip);
  float st = step(0.982, r) * smoothstep(0.32, 0.0, length(fp)) * (0.55+0.45*sin(uTime*(1.5+r*3.)+r*60.));
  col += vec3(1.0,0.95,0.85)*st*1.4*smoothstep(0.03,0.35,h);
  // moon
  vec3 md = normalize(vec3(-0.42,0.36,-0.83)); float m = dot(d, md);
  col += vec3(1.,0.94,0.78)*smoothstep(0.9987, 0.9992, m)*2.2;
  col += vec3(0.55,0.6,0.95)*pow(max(m,0.),180.)*0.7 + vec3(0.3,0.35,0.7)*pow(max(m,0.),18.)*0.22;
  gl_FragColor = vec4(col, 1.0);
}`;

function marbleCanvas() {
  const S = 1024, cv = mkCanvas(S, S), ctx = cv.getContext('2d');
  const img = ctx.createImageData(S, S), n = makeNoise(21);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = n.fbm(x * 0.006, y * 0.006, 5), vein = Math.abs(Math.sin((x * 0.011 + y * 0.007) + n.fbm(x * 0.01, y * 0.01, 4) * 9));
    const t = 0.16 + 0.12 * v + 0.05 * Math.pow(1 - vein, 8);
    const i = (y * S + x) * 4; img.data[i] = 34 * t * 3.2; img.data[i + 1] = 32 * t * 3.2; img.data[i + 2] = 42 * t * 3.2; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
  for (let i = 0; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(i * S / 8, 0); ctx.lineTo(i * S / 8, S); ctx.moveTo(0, i * S / 8); ctx.lineTo(S, i * S / 8); ctx.stroke(); }
  return cv;
}

function flameTexture() {
  const cv = mkCanvas(128, 256), ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 170, 4, 64, 150, 90);
  g.addColorStop(0, 'rgba(255,255,220,1)'); g.addColorStop(0.25, 'rgba(255,200,90,0.95)'); g.addColorStop(0.6, 'rgba(255,110,30,0.55)'); g.addColorStop(1, 'rgba(255,60,10,0)');
  ctx.save(); ctx.scale(1, 1.7); ctx.translate(0, -60); ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(64, 6); ctx.bezierCurveTo(110, 70, 118, 120, 64, 150); ctx.bezierCurveTo(10, 120, 18, 70, 64, 6); ctx.fill(); ctx.restore();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function softDot() {
  const cv = mkCanvas(64, 64), ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildEnvironment(scene, renderer) {
  const env = { updaters: [] };
  const R = rng(77);
  scene.fog = new THREE.FogExp2(0x0b0813, 0.011);

  // ---- sky
  const skyMat = new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { uTime: { value: 0 } } });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 32), skyMat); sky.renderOrder = -10; scene.add(sky);
  env.sky = sky; env.updaters.push((t) => { skyMat.uniforms.uTime.value = t; });

  // ---- environment map for reflections
  {
    const pm = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMat.clone()));
    for (const [x, y, z, c, s] of [[-14, 18, 10, 0xffd8a0, 26], [16, 14, -6, 0x88a8ff, 16], [0, 22, 0, 0xffe6c0, 20]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s, s), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); m.material.color.multiplyScalar(2.2); es.add(m);
    }
    scene.environment = pm.fromScene(es, 0.03).texture; scene.environmentIntensity = 0.55; pm.dispose();
  }

  // ---- floor
  const floorY = -4.05;
  const marble = new THREE.CanvasTexture(marbleCanvas()); marble.wrapS = marble.wrapT = THREE.RepeatWrapping; marble.repeat.set(8, 8); marble.colorSpace = THREE.SRGBColorSpace; marble.anisotropy = 8;
  const floorMat = new THREE.MeshStandardMaterial({ map: marble, roughness: 0.32, metalness: 0.15, envMapIntensity: 0.6 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 64), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.set(0, floorY, TABLE.cz); floor.receiveShadow = true; scene.add(floor);
  // gold inlay rings
  const goldM = new THREE.MeshStandardMaterial({ color: 0xd9a93a, metalness: 0.95, roughness: 0.3 });
  for (const [r, w] of [[19, 0.16], [19.9, 0.05], [33, 0.2]]) { const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + w, 96), goldM); ring.rotation.x = -Math.PI / 2; ring.position.set(0, floorY + 0.01, TABLE.cz); scene.add(ring); }
  // rug under the table
  const rugC = mkCanvas(512, 512), rc = rugC.getContext('2d');
  rc.fillStyle = '#4a0e18'; rc.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9; i++) { rc.strokeStyle = i % 2 ? 'rgba(230,190,90,0.7)' : 'rgba(230,190,90,0.25)'; rc.lineWidth = i % 2 ? 4 : 10; rc.strokeRect(14 + i * 18, 14 + i * 18, 484 - i * 36, 484 - i * 36); }
  const rugT = new THREE.CanvasTexture(rugC); rugT.colorSpace = THREE.SRGBColorSpace;
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.w + 9, TABLE.d + 9), new THREE.MeshStandardMaterial({ map: rugT, roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, floorY + 0.02, TABLE.cz); rug.receiveShadow = true; scene.add(rug);

  // ---- colonnade ring
  const colM = new THREE.MeshStandardMaterial({ color: 0xcfc3a6, roughness: 0.7 });
  const N = 14, colR = 27;
  const shaft = new THREE.CylinderGeometry(0.85, 1.0, 15, 20), cap = new THREE.BoxGeometry(2.4, 0.6, 2.4), base = new THREE.BoxGeometry(2.4, 0.5, 2.4);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + Math.PI / N;
    if (Math.abs(Math.cos(a)) < 0.0 && Math.sin(a) < 0) continue;
    const x = Math.cos(a) * colR, z = TABLE.cz + Math.sin(a) * colR;
    const s = new THREE.Mesh(shaft, colM); s.position.set(x, floorY + 7.75, z); s.castShadow = false; scene.add(s);
    const c = new THREE.Mesh(cap, colM); c.position.set(x, floorY + 15.3, z); c.rotation.y = -a; scene.add(c);
    const b = new THREE.Mesh(base, colM); b.position.set(x, floorY + 0.25, z); b.rotation.y = -a; scene.add(b);
  }
  // architrave ring
  const arch = new THREE.Mesh(new THREE.TorusGeometry(colR, 0.9, 6, 96), colM); arch.rotation.x = Math.PI / 2; arch.position.set(0, floorY + 16.2, TABLE.cz); arch.scale.set(1, 1, 1); scene.add(arch);
  // distant pyramids & obelisk silhouettes
  const pyrM = new THREE.MeshStandardMaterial({ color: 0x1a1830, roughness: 1, emissive: 0x0a0812 });
  for (const [x, z, s] of [[-90, -150, 46], [40, -170, 70], [130, -130, 34], [-160, -60, 30]]) {
    const p = new THREE.Mesh(new THREE.ConeGeometry(s, s * 0.95, 4), pyrM); p.rotation.y = Math.PI / 4; p.position.set(x, floorY + s * 0.45 - 6, z); scene.add(p);
  }
  const groundFar = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshBasicMaterial({ color: 0x07060c, fog: true })); groundFar.rotation.x = -Math.PI / 2; groundFar.position.y = floorY - 0.05; scene.add(groundFar);

  // ---- lights
  const hemi = new THREE.HemisphereLight(0x7d8fd8, 0x3a2410, 0.75); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffdcae, 2.9);
  key.position.set(-9, 20, 13); key.target.position.set(0, 0, -1.5);
  key.castShadow = true; key.shadow.mapSize.set(4096, 4096);
  const sc = key.shadow.camera; sc.left = -17; sc.right = 17; sc.top = 12; sc.bottom = -12; sc.near = 4; sc.far = 55;
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012; key.shadow.radius = 3;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x86a6ff, 0.9); rim.position.set(12, 10, -18); scene.add(rim);
  const spot = new THREE.SpotLight(0xfff0d0, 90, 40, 0.55, 0.85, 1.6); spot.position.set(0, 17, -0.5); spot.target.position.set(0, 0, -0.6); scene.add(spot, spot.target);
  env.lights = { hemi, key, rim, spot };

  // ---- braziers with flames
  const flameTex = flameTexture(), dotTex = softDot();
  const braziers = [];
  const standProfile = [[0, 0], [0.7, 0], [0.7, 0.2], [0.4, 0.35], [0.22, 0.7], [0.3, 1.5], [0.2, 1.7], [0.36, 2.2], [0.75, 2.75], [0.85, 3.0], [0.7, 3.05], [0.6, 2.85], [0, 2.75]].map(([x, y]) => new THREE.Vector2(x, y));
  const standGeo = new THREE.LatheGeometry(standProfile, 28);
  const bronze = new THREE.MeshStandardMaterial({ color: 0x9a6a2a, metalness: 0.9, roughness: 0.35 });
  const spots = [[-TABLE.w / 2 - 2.6, TABLE.cz + TABLE.d / 2 + 0.6], [TABLE.w / 2 + 2.6, TABLE.cz + TABLE.d / 2 + 0.6], [-TABLE.w / 2 - 2.6, TABLE.cz - TABLE.d / 2 - 0.6], [TABLE.w / 2 + 2.6, TABLE.cz - TABLE.d / 2 - 0.6]];
  spots.forEach(([x, z], bi) => {
    const grp = new THREE.Group(); grp.position.set(x, floorY, z); scene.add(grp);
    const stand = new THREE.Mesh(standGeo, bronze); stand.scale.setScalar(1.3); stand.castShadow = false; grp.add(stand);
    const fy = 3.05 * 1.3;
    const flames = [];
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flameTex, color: 0xffb060, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sp.position.y = fy + 0.45; sp.scale.set(1.6, 2.6, 1); grp.add(sp); flames.push(sp);
    }
    const light = new THREE.PointLight(0xff8a3a, 26, 26, 1.7); light.position.y = fy + 0.6; grp.add(light);
    // embers
    const cnt = 26, geo = new THREE.BufferGeometry(), pos = new Float32Array(cnt * 3), seeds = [];
    for (let i = 0; i < cnt; i++) { seeds.push({ t: R() * 4, sp: 0.6 + R() * 0.9, ox: (R() - 0.5) * 0.6, oz: (R() - 0.5) * 0.6, sw: R() * 6 }); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, color: 0xffa050, size: 0.22, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false }));
    pts.position.y = fy; grp.add(pts);
    braziers.push({ grp, flames, light, pts, seeds, phase: bi * 1.7, base: light.intensity });
  });
  env.braziers = braziers;
  env.updaters.push((t, dt) => {
    for (const b of braziers) {
      const f = 0.85 + 0.15 * Math.sin(t * 9 + b.phase) + 0.1 * Math.sin(t * 23 + b.phase * 2) + (Math.random() - 0.5) * 0.06;
      b.light.intensity = b.base * f;
      b.flames.forEach((s, i) => {
        const k = 1 - i * 0.16;
        s.scale.set((1.5 + 0.2 * Math.sin(t * (7 + i * 2) + b.phase + i)) * k, (2.5 + 0.55 * Math.sin(t * (9 + i * 1.7) + b.phase * 3 + i)) * k, 1);
        s.position.x = Math.sin(t * (5 + i) + b.phase) * 0.08 * (i + 1);
        s.material.rotation = Math.sin(t * 3 + i + b.phase) * 0.1;
      });
      const pos = b.pts.geometry.attributes.position;
      b.seeds.forEach((sd, i) => {
        sd.t += dt * sd.sp * 0.5; if (sd.t > 1) sd.t = 0;
        pos.setXYZ(i, sd.ox + Math.sin(sd.t * 8 + sd.sw) * 0.5 * sd.t, 0.3 + sd.t * 5.5, sd.oz + Math.cos(sd.t * 6 + sd.sw) * 0.4 * sd.t);
      });
      pos.needsUpdate = true;
    }
  });

  // ---- floating dust motes
  {
    const cnt = 260, geo = new THREE.BufferGeometry(), pos = new Float32Array(cnt * 3), vel = [];
    for (let i = 0; i < cnt; i++) { pos[i * 3] = (R() - 0.5) * 34; pos[i * 3 + 1] = R() * 12; pos[i * 3 + 2] = TABLE.cz + (R() - 0.5) * 22; vel.push([(R() - 0.5) * 0.12, 0.03 + R() * 0.08, (R() - 0.5) * 0.12]); }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dotTex, color: 0xffe0b0, size: 0.11, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    scene.add(pts);
    env.updaters.push((t, dt) => {
      const p = geo.attributes.position;
      for (let i = 0; i < cnt; i++) {
        let x = p.getX(i) + vel[i][0] * dt + Math.sin(t * 0.3 + i) * 0.002, y = p.getY(i) + vel[i][1] * dt, z = p.getZ(i) + vel[i][2] * dt;
        if (y > 12) y = 0; p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;
    });
  }

  env.update = (t, dt) => env.updaters.forEach(u => u(t, dt));
  return env;
}
