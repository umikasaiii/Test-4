import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
/* Pure-JS build: NO WebAssembly (no physics engine / no mesh decoder), so it runs
   inside the strict artifact CSP. Arcade vehicle physics + a hand-built car. */

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);
const loadEl = $('#load'), barFill = $('#barFill'), loadTxt = $('#loadTxt'), errEl = $('#err');
const setProg = (f, t) => { barFill.style.width = Math.round(f * 100) + '%'; if (t) loadTxt.textContent = t; };
const IS_TOUCH = matchMedia('(pointer:coarse)').matches;

let renderer, scene, camera, composer, bloomPass, MAXA = 1;
let carRig, carTilt, wheels = [], bodyMat = null, tail = null, headEmis = [];
const clock = new THREE.Clock();
let started = false, boost = 1;
const PALETTE = [0xd8202a, 0x1652d8, 0xf5c518, 0x17b36a, 0x111318, 0xe8e8ec, 0xff6a1a, 0xb040e0];

const car = { x: 150, z: -10, yaw: 0, speed: 0 };
let steerVis = 0, wheelSpin = 0;
const SPEC = { maxSpeed: 52, boost: 76, accel: 24, brake: 46, drag: 9, rev: 15, turn: 2.5 };
const input = { throttle: false, brake: false, left: 0, right: 0, nitro: false };

const Grade = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.32 }, con: { value: 1.07 }, warm: { value: 1.16 }, vig: { value: 0.82 } },
  vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `varying vec2 v;uniform sampler2D tDiffuse;uniform float sat,con,warm,vig;
    void main(){vec3 c=texture2D(tDiffuse,v).rgb;float l=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(l),c,sat);
      c=(c-.5)*con+.5;c*=vec3(1.+(warm-1.)*.5,1.,1.-(warm-1.)*.5);
      float r=length(v-.5);c*=mix(.82,1.,smoothstep(.96,.34,r*vig));gl_FragColor=vec4(max(c,0.),1.);}`
};

function boot() {
  try {
    setProg(0.1, 'AVVIO 3D…');
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.06;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    MAXA = renderer.capabilities.getMaxAnisotropy(); $('#app').appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xbfe0f2, 300, 1050);
    camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.2, 3000);
    camera.position.set(150, 6, -30);

    setProg(0.25, 'CIELO E LUCE…'); buildSkyAndEnv();
    const sun = new THREE.DirectionalLight(0xfff1d4, 3.1);
    sun.position.set(80, 120, 50); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.camera.near = 1; sun.shadow.camera.far = 400;
    const S = 60; Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target); scene.userData.sun = sun;
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x5a6a40, 0.7));

    setProg(0.5, 'CIRCUITO…'); buildWorld();
    setProg(0.72, 'AUTO…'); buildCar(PALETTE[0]);

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.7, 0.9);
    composer.addPass(bloomPass); composer.addPass(new OutputPass()); composer.addPass(new ShaderPass(Grade));

    setProg(1, 'PRONTO'); bindInput(); buildMenu(); addEventListener('resize', onResize);
    loadEl.classList.add('hide'); setTimeout(() => loadEl.remove(), 700);
    $('#hud').classList.add('on'); $('#menu').classList.remove('hide');
    clock.start(); animate();
  } catch (e) { console.error(e); errEl.textContent = 'Errore: ' + (e && e.message ? e.message : e); }
}

/* ---------------- sky + IBL ---------------- */
function buildSkyAndEnv() {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x1f7ae6) }, mid: { value: new THREE.Color(0x8fc4f2) }, bot: { value: new THREE.Color(0xeef4f4) }, sun: { value: new THREE.Vector3(80, 120, 50).normalize() } },
    vertexShader: `varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 p;uniform vec3 top,mid,bot,sun;
      float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5);}
      float n(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 q){float v=0.,a=.5;for(int i=0;i<6;i++){v+=a*n(q);q*=2.02;a*=.5;}return v;}
      void main(){vec3 d=normalize(p);float y=clamp(d.y*.5+.5,0.,1.);
        vec3 c=mix(bot,mid,smoothstep(0.,.5,y));c=mix(c,top,smoothstep(.4,1.,y));
        float sd=max(dot(d,normalize(sun)),0.);c+=vec3(1.,.96,.82)*(pow(sd,350.)*3.5+pow(sd,14.)*.45);
        if(d.y>.01){vec2 uv=d.xz/(d.y+.14)*.6;float f=fbm(uv*1.0),f2=fbm(uv*2.6+7.);float fld=f*.7+f2*.3;
          float cov=smoothstep(.44,.72,fld)*smoothstep(.01,.2,d.y);
          vec3 cc=mix(vec3(.66),vec3(1.),smoothstep(.4,.95,fld));cc+=vec3(1.,.95,.82)*pow(sd,5.)*.35*cov;
          c=mix(c,cc,cov*.92);}
        gl_FragColor=vec4(c,1.);}`
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1400, 40, 20), skyMat));
  const es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), new THREE.MeshBasicMaterial({ color: 0x9fc6f2, side: THREE.BackSide })));
  const gr = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshBasicMaterial({ color: 0x88ab5a })); gr.rotation.x = -Math.PI / 2; gr.position.y = -8; es.add(gr);
  const sd = new THREE.Mesh(new THREE.SphereGeometry(7, 16, 16), new THREE.MeshBasicMaterial({ color: 0xfff0d0 })); sd.position.set(24, 24, 14); es.add(sd);
  const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(es, 0.03).texture; pm.dispose();
}

/* ---------------- geometry helpers ---------------- */
function roundedBox(w, h, d, r, s = 4) {
  const g = new THREE.BoxGeometry(w, h, d, s, s, s), p = g.attributes.position;
  const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r, v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); c.set(clamp(v.x, -hw, hw), clamp(v.y, -hh, hh), clamp(v.z, -hd, hd));
    const dir = v.clone().sub(c); if (dir.lengthSq() > 1e-6) { dir.normalize().multiplyScalar(r); v.copy(c).add(dir); } else v.copy(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals(); return g;
}
function grassTex() {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
  x.fillStyle = '#5f9a3c'; x.fillRect(0, 0, N, N);
  for (let i = 0; i < 45000; i++) { const v = (Math.random() * 2 - 1) * 34; x.fillStyle = `rgba(${(70 + v) | 0},${(150 + v) | 0},${(56 + v * .6) | 0},.5)`; x.fillRect(Math.random() * N, Math.random() * N, 1.4, 3); }
  for (let i = 0; i < 70; i++) { x.fillStyle = 'rgba(0,0,0,.05)'; x.beginPath(); x.arc(Math.random() * N, Math.random() * N, 8 + Math.random() * 28, 0, 7); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(120, 120); t.anisotropy = MAXA; return t;
}
function asphaltTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#2f343b'; x.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 8000; i++) { const g = 38 + Math.random() * 26 | 0; x.fillStyle = `rgba(${g},${g + 3},${g + 8},.5)`; x.fillRect(Math.random() * 128, Math.random() * 256, 1.5, 1.5); }
  // red/white rumble-strip kerbs baked at both edges
  const kw = 13; for (let y = 0; y < 256; y += 26) { x.fillStyle = ((y / 26) & 1) ? '#d23636' : '#eef0f0'; x.fillRect(0, y, kw, 26); x.fillRect(128 - kw, y, kw, 26); }
  // solid white edge lines + dashed centre line
  x.fillStyle = 'rgba(238,240,240,.92)'; x.fillRect(kw + 3, 0, 4, 256); x.fillRect(128 - kw - 7, 0, 4, 256);
  for (let y = 0; y < 256; y += 46) x.fillRect(62, y, 5, 26);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 10); t.anisotropy = MAXA; return t;
}
function checkerTex() {
  const N = 128, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); const s = N / 8;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { x.fillStyle = ((i + j) & 1) ? '#141414' : '#f0f0f0'; x.fillRect(i * s, j * s, s, s); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 1); return t;
}
function roundedRectPath(rx, rz) {
  const pts = [], N = 140;
  for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; pts.push(new THREE.Vector3(Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), .5) * rx, 0, Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), .5) * rz)); }
  return pts;
}
function ribbon(pts, width, mat, yoff) {
  const pos = [], uv = [], idx = []; let cum = 0;
  for (let i = 0; i <= pts.length; i++) {
    const cur = pts[i % pts.length], prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
    const dx = next.x - prev.x, dz = next.z - prev.z; const l = Math.hypot(dx, dz) || 1; const px = -dz / l, pz = dx / l;
    if (i > 0) cum += Math.hypot(cur.x - pts[(i - 1) % pts.length].x, cur.z - pts[(i - 1) % pts.length].z);
    pos.push(cur.x + px * width / 2, yoff, cur.z + pz * width / 2); pos.push(cur.x - px * width / 2, yoff, cur.z - pz * width / 2);
    const vv = cum / 14; uv.push(0, vv, 1, vv);
    if (i < pts.length) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}
function buildTree() {
  const g = new THREE.Group(); const th = rand(2.6, 4.4);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.36, th, 7), new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9, flatShading: true }));
  trunk.position.y = th / 2; trunk.castShadow = true; g.add(trunk);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x49a336, roughness: 0.8, flatShading: true });
  for (let i = 0; i < 3; i++) { const r = rand(1.5, 2.4); const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leaf); b.position.set(rand(-0.8, 0.8), th + rand(-0.2, 1.3), rand(-0.8, 0.8)); b.scale.y = 0.85; b.castShadow = true; g.add(b); }
  return g;
}
function buildRock() {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(1, 2.3), 0), new THREE.MeshStandardMaterial({ color: 0x8a8276, roughness: 1, flatShading: true }));
  m.scale.set(rand(.8, 1.5), rand(.5, 1), rand(.8, 1.5)); m.position.y = m.scale.y * 0.5; m.castShadow = true; m.receiveShadow = true; const g = new THREE.Group(); g.add(m); return g;
}

/* ---------------- world ---------------- */
function buildWorld() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ map: grassTex(), roughness: 1, metalness: 0 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pts = roundedRectPath(150, 100);
  scene.add(ribbon(pts, 19, roadMat, 0.02));

  const barrier = new THREE.MeshStandardMaterial({ color: 0xe4e8ee, roughness: 0.6, metalness: 0.1 });
  const barrierR = new THREE.MeshStandardMaterial({ color: 0xd83a3a, roughness: 0.6 });
  for (let i = 0; i < pts.length; i += 6) {
    const a = pts[i], b = pts[(i + 1) % pts.length]; const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const nrm = new THREE.Vector2(-(b.z - a.z), b.x - a.x).normalize();
    for (const side of [-1, 1]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.7, 0.4), (i / 6) % 2 ? barrierR : barrier);
      bar.position.set(mx + nrm.x * 12.0 * side, 0.55, mz + nrm.y * 12.0 * side); bar.lookAt(mx, 0.55, mz); bar.castShadow = true; scene.add(bar);
    }
  }
  const startLine = new THREE.Mesh(new THREE.PlaneGeometry(19, 3.4), new THREE.MeshStandardMaterial({ map: checkerTex(), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  startLine.rotation.x = -Math.PI / 2; startLine.position.set(150, 0.06, 0); startLine.receiveShadow = true; scene.add(startLine);
  // start gantry
  const gMat = new THREE.MeshStandardMaterial({ color: 0x1a1f27, roughness: 0.7, metalness: 0.3 });
  [-11, 11].forEach(x => { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 9, 10), gMat); p.position.set(150 + x, 4.5, 0); p.castShadow = true; scene.add(p); });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(23, 1.4, 1.2), gMat); beam.position.set(150, 8.8, 0); beam.castShadow = true; scene.add(beam);
  const banner = new THREE.Mesh(new THREE.BoxGeometry(23, 1.0, 0.1), new THREE.MeshStandardMaterial({ color: 0x111318, emissive: 0xffffff, emissiveMap: checkerTex(), emissiveIntensity: 0.9 })); banner.position.set(150, 7.7, 0.05); scene.add(banner);
  const lightMat = i => new THREE.MeshStandardMaterial({ color: 0x110000, emissive: i ? 0x18d43a : 0xff2a12, emissiveIntensity: 3, roughness: 0.4 });
  [-3, 0, 3].forEach(x => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.6, 14, 12), lightMat(1)); l.position.set(150 + x, 8.2, 0.7); scene.add(l); });

  for (const gz of [-46, 0, 46]) {
    const gs = new THREE.Mesh(new THREE.BoxGeometry(6, 8, 34), new THREE.MeshStandardMaterial({ color: 0x717d8d, roughness: 0.9 }));
    gs.position.set(188, 4, gz); gs.castShadow = true; gs.receiveShadow = true; scene.add(gs);
    const rf = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 36), new THREE.MeshStandardMaterial({ color: 0x2a3340, roughness: 0.8 })); rf.position.set(189.5, 8.5, gz); rf.castShadow = true; scene.add(rf);
    // crowd specks
    for (let i = 0; i < 60; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.5), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.6, 0.55) })); s.position.set(186.6, rand(1, 7), gz + rand(-16, 16)); scene.add(s); }
  }
  for (let i = 0; i < 150; i++) {
    const x = rand(-800, 800), z = rand(-800, 800); if (Math.abs(Math.hypot(x, z * 1.5) - 150) < 40) continue;
    const o = Math.random() < 0.7 ? buildTree() : buildRock(); o.position.set(x, 0, z); o.rotation.y = rand(0, 6.28); o.scale.multiplyScalar(rand(0.8, 1.6)); scene.add(o);
  }
}

/* ---------------- car (procedural, detailed) ---------------- */
function buildWheel() {
  const g = new THREE.Group(), spin = new THREE.Group(); g.add(spin);
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.32, 26), new THREE.MeshStandardMaterial({ color: 0x0c0c10, roughness: 0.85 }));
  tyre.rotation.z = Math.PI / 2; tyre.castShadow = true; spin.add(tyre);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd0d6de, metalness: 1, roughness: 0.22, envMapIntensity: 1.8 });
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.34, 20), rimMat); rim.rotation.z = Math.PI / 2; spin.add(rim);
  for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.06), rimMat); s.rotation.x = i / 6 * Math.PI * 2; spin.add(s); }
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.28, 18), new THREE.MeshStandardMaterial({ color: 0x33373d, metalness: 0.6, roughness: 0.4, emissive: 0xff2a00, emissiveIntensity: 0 }));
  disc.rotation.z = Math.PI / 2; spin.add(disc); g.userData.disc = disc;
  return { grp: g, spin };
}
function buildCar(color) {
  const rig = new THREE.Group(); scene.add(rig);
  const tilt = new THREE.Group(); rig.add(tilt);
  carRig = rig; carTilt = tilt; wheels = []; headEmis = [];

  bodyMat = new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.55 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a0e14, metalness: 0.1, roughness: 0.05, opacity: 0.62, transparent: true, envMapIntensity: 2 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.5, roughness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: 0x08090c, metalness: 0.4, roughness: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe6ebf0, metalness: 1, roughness: 0.16, envMapIntensity: 2 });
  const yb = 0.42;

  const floor = new THREE.Mesh(roundedBox(1.86, 0.28, 4.3, 0.14, 3), carbon); floor.position.y = yb - 0.02; tilt.add(floor);
  const body = new THREE.Mesh(roundedBox(1.94, 0.5, 3.8, 0.3, 6), bodyMat); body.position.y = yb + 0.26; body.castShadow = true; tilt.add(body);
  const haunch = new THREE.Mesh(roundedBox(2.02, 0.52, 1.7, 0.32, 5), bodyMat); haunch.position.set(0, yb + 0.28, -1.2); haunch.castShadow = true; tilt.add(haunch);
  const nose = new THREE.Mesh(roundedBox(1.82, 0.42, 1.7, 0.24, 5), bodyMat); nose.position.set(0, yb + 0.16, 1.7); nose.rotation.x = -0.05; nose.castShadow = true; tilt.add(nose);
  const cabin = new THREE.Mesh(roundedBox(1.4, 0.56, 1.9, 0.34, 5), bodyMat); cabin.position.set(0, yb + 0.86, -0.15); cabin.castShadow = true; tilt.add(cabin);
  const gh = new THREE.Mesh(roundedBox(1.32, 0.54, 1.96, 0.32, 5), glass); gh.position.set(0, yb + 0.9, -0.1); tilt.add(gh);
  const wsh = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.04, 1.02), glass); wsh.position.set(0, yb + 0.92, 0.72); wsh.rotation.x = -0.9; tilt.add(wsh);
  // rocker sills + intakes
  [-1, 1].forEach(s => { const sill = new THREE.Mesh(roundedBox(0.16, 0.22, 2.4, 0.06, 2), carbon); sill.position.set(s * 0.98, yb + 0.02, -0.1); tilt.add(sill);
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, 0.7), black); intake.position.set(s * 0.95, yb + 0.32, -0.8); tilt.add(intake); });
  // rear + diffuser + quad exhaust
  const rear = new THREE.Mesh(roundedBox(1.9, 0.5, 0.5, 0.18, 4), bodyMat); rear.position.set(0, yb + 0.3, -2.1); tilt.add(rear);
  const diff = new THREE.Mesh(roundedBox(1.8, 0.3, 0.5, 0.1, 3), black); diff.position.set(0, yb - 0.02, -2.2); tilt.add(diff);
  [-0.5, -0.18, 0.18, 0.5].forEach(x => { const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.2, 10), chrome); ex.rotation.x = Math.PI / 2; ex.position.set(x, yb - 0.04, -2.4); tilt.add(ex); });
  // wing
  const wingP = new THREE.MeshStandardMaterial({ color: 0x0a0c11, metalness: 0.6, roughness: 0.4 });
  const wy = yb + 0.95; const wing = new THREE.Mesh(roundedBox(1.95, 0.06, 0.52, 0.03, 2), wingP); wing.position.set(0, wy, -2.2); wing.rotation.x = 0.12; tilt.add(wing);
  [-0.85, 0.85].forEach(x => { const ep = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.32, 0.5), wingP); ep.position.set(x, wy - 0.15, -2.2); tilt.add(ep); });
  // splitter + mirrors
  const sp = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.05, 0.5), black); sp.position.set(0, yb - 0.12, 2.4); tilt.add(sp);
  [-1, 1].forEach(s => { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), black); arm.position.set(s * 0.95, yb + 0.7, 0.5); tilt.add(arm);
    const mir = new THREE.Mesh(roundedBox(0.16, 0.12, 0.08, 0.03, 1), bodyMat); mir.position.set(s * 1.1, yb + 0.72, 0.5); tilt.add(mir); });
  // headlights (emissive) + taillight bar
  [-0.6, 0.6].forEach(x => { const hl = new THREE.Mesh(roundedBox(0.4, 0.16, 0.1, 0.05, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d0, emissiveIntensity: 2.4, roughness: 0.3 })); hl.position.set(x, yb + 0.34, 2.44); tilt.add(hl); headEmis.push(hl.material); });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x1a0000, emissive: 0xff1a08, emissiveIntensity: 3, roughness: 0.4 });
  const tl = new THREE.Mesh(roundedBox(1.5, 0.14, 0.08, 0.04, 1), tailMat); tl.position.set(0, yb + 0.4, -2.36); tilt.add(tl); tail = tailMat;

  // wheels
  const wp = [[-0.86, 1.32, true], [0.86, 1.32, true], [-0.9, -1.4, false], [0.9, -1.4, false]];
  for (const [x, z, front] of wp) { const w = buildWheel(); w.grp.position.set(x, yb, z); tilt.add(w.grp); wheels.push({ ...w, front }); }

  // headlight spots for night-ish pop (cheap: 2)
  rig.position.set(car.x, 0, car.z);
}

/* ---------------- menu ---------------- */
function buildMenu() {
  const sw = $('#swatches');
  PALETTE.forEach((c, i) => {
    const d = document.createElement('div'); d.className = 'swatch' + (i === 0 ? ' sel' : '');
    d.style.background = '#' + c.toString(16).padStart(6, '0');
    d.addEventListener('click', () => { if (bodyMat) bodyMat.color.setHex(c); [...sw.children].forEach(x => x.classList.remove('sel')); d.classList.add('sel'); });
    sw.appendChild(d);
  });
  $('#play').addEventListener('click', () => {
    started = true; $('#menu').classList.add('hide'); if (IS_TOUCH) $('#touch').classList.add('on');
    const el = document.documentElement; const fn = el.requestFullscreen || el.webkitRequestFullscreen; if (fn) { try { const r = fn.call(el); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
  });
}

/* ---------------- input ---------------- */
function bindInput() {
  addEventListener('keydown', e => { const k = e.key.toLowerCase(); if (e.repeat) return;
    if (k === 'arrowup' || k === 'w') input.throttle = true; if (k === 'arrowdown' || k === 's') input.brake = true;
    if (k === 'arrowleft' || k === 'a') input.left = 1; if (k === 'arrowright' || k === 'd') input.right = 1;
    if (k === ' ') { input.nitro = true; e.preventDefault(); } if (k === 'r') resetCar(); if (k === 'enter' && !started) $('#play').click(); });
  addEventListener('keyup', e => { const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') input.throttle = false; if (k === 'arrowdown' || k === 's') input.brake = false;
    if (k === 'arrowleft' || k === 'a') input.left = 0; if (k === 'arrowright' || k === 'd') input.right = 0; if (k === ' ') input.nitro = false; });
  const bt = (id, on, off) => { const el = $(id); if (!el) return; const d = e => { e.preventDefault(); on(); }, u = e => { e.preventDefault(); off(); };
    el.addEventListener('touchstart', d, { passive: false }); el.addEventListener('touchend', u); el.addEventListener('touchcancel', u);
    el.addEventListener('mousedown', d); el.addEventListener('mouseup', u); el.addEventListener('mouseleave', u); };
  bt('#tGas', () => input.throttle = true, () => input.throttle = false); bt('#tBrake', () => input.brake = true, () => input.brake = false);
  bt('#tLeft', () => input.left = 1, () => input.left = 0); bt('#tRight', () => input.right = 1, () => input.right = 0);
}
function resetCar() { car.speed = 0; car.x = 150; car.z = -10; car.yaw = 0; boost = 1; }

/* ---------------- loop ---------------- */
const camPos = new THREE.Vector3(150, 6, -30), camLook = new THREE.Vector3();
let shake = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.033);
  const nitro = input.nitro && boost > 0 && input.throttle && car.speed > 3;
  if (nitro) boost = Math.max(0, boost - dt * 0.35); else boost = Math.min(1, boost + dt * 0.12);

  if (started) {
    const topSpeed = nitro ? SPEC.boost : SPEC.maxSpeed;
    if (input.throttle) car.speed += SPEC.accel * (nitro ? 1.6 : 1) * dt;
    else if (input.brake) { if (car.speed > 0.3) car.speed -= SPEC.brake * dt; else car.speed -= SPEC.accel * 0.6 * dt; }
    else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), SPEC.drag * dt);
    car.speed = clamp(car.speed, -SPEC.rev, topSpeed);
    const dir = input.right - input.left;
    const turnF = clamp(Math.abs(car.speed) / 7, 0, 1);
    car.yaw -= dir * SPEC.turn * turnF * dt;
  }
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
  car.x += fx * car.speed * dt; car.z += fz * car.speed * dt;
  // soft world bound
  const r = Math.hypot(car.x, car.z); if (r > 1000) { car.x *= 1000 / r; car.z *= 1000 / r; car.speed *= 0.5; }

  const spd01 = clamp(Math.abs(car.speed) / SPEC.boost, 0, 1);
  const targetSteer = (input.right - input.left);
  steerVis += (targetSteer - steerVis) * Math.min(1, dt * 9);
  wheelSpin += car.speed / 0.42 * dt;

  // rig transform + body tilt (squat/roll)
  carRig.position.set(car.x, 0.02 + Math.sin(performance.now() * 0.02) * 0.004 * spd01, car.z);
  carRig.rotation.y = car.yaw;
  const accelFactor = (input.throttle ? 1 : 0) - (input.brake ? 1 : 0);
  carTilt.rotation.x += ((-accelFactor * 0.05) - carTilt.rotation.x) * Math.min(1, dt * 6);
  carTilt.rotation.z += ((-steerVis * 0.06 * clamp(car.speed / 14, 0, 1)) - carTilt.rotation.z) * Math.min(1, dt * 6);
  for (const w of wheels) { w.spin.rotation.x = wheelSpin; if (w.front) w.grp.rotation.y = steerVis * 0.5; if (w.grp.userData.disc) w.grp.userData.disc.material.emissiveIntensity = input.brake ? 2.2 : 0; }
  if (tail) tail.emissiveIntensity = input.brake ? 6 : 3;

  // camera (aspect-aware FOV so the car stays big on ultrawide)
  const back = 9 + spd01 * 0.6, hgt = 4.6 + spd01 * 0.3;
  const desired = new THREE.Vector3(car.x - fx * back, hgt, car.z - fz * back);
  camPos.lerp(desired, Math.min(1, dt * 4));
  shake = Math.max(0, shake - dt * 5) + (nitro ? 0.02 : 0);
  camera.position.set(camPos.x + rand(-shake, shake), camPos.y + rand(-shake, shake), camPos.z);
  const aspect = camera.aspect || innerWidth / innerHeight;
  const hFov = (80 + spd01 * 5 + (nitro ? 4 : 0)) * Math.PI / 180;
  camera.fov += (clamp(2 * Math.atan(Math.tan(hFov / 2) / aspect) * 180 / Math.PI, 42, 64) - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  camLook.lerp(new THREE.Vector3(car.x + fx * 5.5, 0.9, car.z + fz * 5.5), Math.min(1, dt * 6));
  camera.lookAt(camLook);

  if (bloomPass) bloomPass.strength = 0.3 + (nitro ? 0.25 : 0);
  $('#spd').textContent = Math.round(Math.abs(car.speed) * 3.6);
  composer.render();
}
function onResize() { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); }
boot();
