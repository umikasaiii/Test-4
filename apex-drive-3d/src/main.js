import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import RAPIER from '@dimforge/rapier3d-compat';

const A = (p) => import.meta.env.BASE_URL + p;
const $ = (s) => document.querySelector(s);
const loadEl = $('#load'), barFill = $('#barFill'), loadTxt = $('#loadTxt'), errEl = $('#err');
const setProg = (f, t) => { barFill.style.width = Math.round(f * 100) + '%'; if (t) loadTxt.textContent = t; };

const IS_TOUCH = matchMedia('(pointer:coarse)').matches;

let renderer, scene, camera, composer, bloomPass;
let world, chassisBody, vehicle, RAPIERG;
let carBody, wheels = [];
const WHEELS = [
  { x: -0.86, y: -0.18, z: 1.34, front: true },
  { x: 0.86, y: -0.18, z: 1.34, front: true },
  { x: -0.86, y: -0.18, z: -1.42, front: false },
  { x: 0.86, y: -0.18, z: -1.42, front: false },
];
const RADIUS = 0.36, SUSP_REST = 0.30;
const input = { throttle: false, brake: false, left: 0, right: 0, hand: false };
let steer = 0, wheelSpin = 0;
const clock = new THREE.Clock();

/* -------------------------------------------------- grade post-pass */
const Grade = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.28 }, con: { value: 1.06 }, warm: { value: 1.12 }, vig: { value: 0.86 } },
  vertexShader: `varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `varying vec2 v;uniform sampler2D tDiffuse;uniform float sat,con,warm,vig;
    void main(){vec3 c=texture2D(tDiffuse,v).rgb;
      float l=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(l),c,sat);
      c=(c-.5)*con+.5;c*=vec3(1.+ (warm-1.)*.5,1.,1.-(warm-1.)*.5);
      float r=length(v-.5);c*=mix(.82,1.,smoothstep(.95,.35,r*vig));
      gl_FragColor=vec4(max(c,0.),1.);}`
};

async function boot() {
  try {
    setProg(0.05, 'AVVIO MOTORE FISICO…');
    await RAPIER.init(); RAPIERG = RAPIER;

    // ---------- renderer / scene ----------
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    $('#app').appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xe6d8c2, 260, 950);
    camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.2, 2000);
    camera.position.set(0, 6, -12);

    // ---------- HDRI environment (real image-based lighting + reflections) ----------
    setProg(0.15, 'CIELO E LUCE (HDRI)…');
    const hdr = await new RGBELoader().loadAsync(A('assets/hdr/venice_sunset_1k.hdr'));
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envMap = pmrem.fromEquirectangular(hdr).texture;
    scene.environment = envMap;
    scene.background = envMap;
    scene.backgroundBlurriness = 0.22;
    hdr.dispose(); pmrem.dispose();

    // sun
    const sun = new THREE.DirectionalLight(0xfff2d8, 3.1);
    sun.position.set(60, 90, 40); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 320;
    const S = 90; Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    scene.add(new THREE.HemisphereLight(0xbfe2ff, 0x4a5238, 0.5));

    // ---------- physics world ----------
    world = new RAPIER.World({ x: 0, y: -9.81 * 1.6, z: 0 });

    // ---------- ground ----------
    setProg(0.35, 'TERRENO E PISTA…');
    buildGround();

    // ---------- composer ----------
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.7, 0.95);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(Grade));

    // ---------- car ----------
    setProg(0.6, 'AUTO (FERRARI GLTF)…');
    await buildCar();

    setProg(1, 'PRONTO');
    bindInput();
    addEventListener('resize', onResize);
    loadEl.classList.add('hide'); setTimeout(() => loadEl.remove(), 700);
    $('#hud').classList.add('on'); if (IS_TOUCH) $('#touch').classList.add('on');
    clock.start(); animate();
  } catch (e) {
    console.error(e); errEl.textContent = 'Errore: ' + (e && e.message ? e.message : e);
  }
}

/* ============================ GROUND / WORLD ============================ */
function buildGround() {
  // visual grass
  const tex = new THREE.TextureLoader().load(A('assets/tex/grass.jpg'));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(80, 80);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1600, 1600),
    new THREE.MeshStandardMaterial({ map: tex, color: 0x9fc46a, roughness: 1, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // physics floor
  const gb = world.createRigidBody(RAPIERG.RigidBodyDesc.fixed());
  world.createCollider(RAPIERG.ColliderDesc.cuboid(800, 1, 800).setTranslation(0, -1, 0).setFriction(1.4), gb);

  // ---- road: a big rounded rectangle loop drawn on the ground ----
  const roadMat = new THREE.MeshStandardMaterial({ map: asphaltTex(), roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pts = roundedRectPath(150, 100, 46);
  scene.add(ribbon(pts, 16, roadMat, 0.02));

  // decorative barriers along the outer edge of the loop
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.6, metalness: 0.1 });
  const redMat = new THREE.MeshStandardMaterial({ color: 0xd83a3a, roughness: 0.6 });
  for (let i = 0; i < pts.length; i += 4) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
    const nrm = new THREE.Vector2(-(b.z - a.z), b.x - a.x).normalize();
    for (const side of [-1, 1]) {
      const px = mx + nrm.x * 9.6 * side, pz = mz + nrm.y * 9.6 * side;
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 0.5), (i / 4) % 2 ? redMat : barrierMat);
      m.position.set(px, 0.45, pz); m.lookAt(mx, 0.45, mz); m.castShadow = true; scene.add(m);
    }
  }

  // trees & rocks scattered on the grass (kept off the loop)
  for (let i = 0; i < 120; i++) {
    const x = THREE.MathUtils.randFloatSpread(600), z = THREE.MathUtils.randFloatSpread(600);
    if (Math.abs(Math.hypot(x, z * 1.5) - 150) < 40) continue; // rough loop keep-out
    const o = Math.random() < 0.72 ? buildTree() : buildRock();
    o.position.set(x, 0, z); o.rotation.y = Math.random() * 6.28;
    o.scale.multiplyScalar(THREE.MathUtils.randFloat(0.8, 1.5)); scene.add(o);
  }
}

function asphaltTex() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#33383f'; x.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 6000; i++) { const g = 40 + Math.random() * 26 | 0; x.fillStyle = `rgba(${g},${g + 3},${g + 8},.5)`; x.fillRect(Math.random() * 128, Math.random() * 256, 1.5, 1.5); }
  x.fillStyle = 'rgba(240,240,240,.9)'; for (let y = 0; y < 256; y += 46) x.fillRect(61, y, 6, 26);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 8);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
}
function roundedRectPath(rx, rz, r) {
  const pts = [], N = 120;
  for (let i = 0; i < N; i++) {
    const a = i / N * Math.PI * 2;
    // superellipse-ish rounded rectangle
    const cx = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.5);
    const cz = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.5);
    pts.push(new THREE.Vector3(cx * rx, 0, cz * rz));
  }
  return pts;
}
function ribbon(pts, width, mat, yoff) {
  const pos = [], uv = [], idx = []; let cum = 0;
  for (let i = 0; i <= pts.length; i++) {
    const cur = pts[i % pts.length], prev = pts[(i - 1 + pts.length) % pts.length], next = pts[(i + 1) % pts.length];
    const dx = next.x - prev.x, dz = next.z - prev.z; const l = Math.hypot(dx, dz) || 1;
    const px = -dz / l, pz = dx / l;
    if (i > 0) cum += Math.hypot(cur.x - pts[(i - 1) % pts.length].x, cur.z - pts[(i - 1) % pts.length].z);
    pos.push(cur.x + px * width / 2, yoff, cur.z + pz * width / 2);
    pos.push(cur.x - px * width / 2, yoff, cur.z - pz * width / 2);
    const vv = cum / 14; uv.push(0, vv, 1, vv);
    if (i < pts.length) { const o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true; return m;
}
function addRamp(x, z, rotY, w, h, len) {
  const geo = new THREE.BoxGeometry(w, h, len);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.9 }));
  m.position.set(x, 0, z); m.rotation.y = rotY; m.rotation.x = -Math.atan2(h, len); m.position.y = h / 2 * Math.cos(Math.atan2(h, len));
  m.castShadow = true; m.receiveShadow = true; scene.add(m);
  const body = world.createRigidBody(RAPIERG.RigidBodyDesc.fixed().setTranslation(m.position.x, m.position.y, m.position.z)
    .setRotation(new THREE.Quaternion().setFromEuler(m.rotation)));
  world.createCollider(RAPIERG.ColliderDesc.cuboid(w / 2, h / 2, len / 2).setFriction(1.2), body);
}
function buildTree() {
  const g = new THREE.Group();
  const th = THREE.MathUtils.randFloat(2.6, 4.2);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, th, 7), new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9, flatShading: true }));
  trunk.position.y = th / 2; trunk.castShadow = true; g.add(trunk);
  const leaf = new THREE.MeshStandardMaterial({ color: 0x49a336, roughness: 0.8, flatShading: true });
  for (let i = 0; i < 3; i++) { const r = THREE.MathUtils.randFloat(1.5, 2.3); const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leaf); b.position.set(THREE.MathUtils.randFloatSpread(1.4), th + THREE.MathUtils.randFloat(-0.2, 1.2), THREE.MathUtils.randFloatSpread(1.4)); b.scale.y = 0.85; b.castShadow = true; g.add(b); }
  return g;
}
function buildRock() {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(THREE.MathUtils.randFloat(1, 2.2), 0), new THREE.MeshStandardMaterial({ color: 0x8a8276, roughness: 1, flatShading: true }));
  m.scale.set(THREE.MathUtils.randFloat(.8, 1.5), THREE.MathUtils.randFloat(.5, 1), THREE.MathUtils.randFloat(.8, 1.5));
  m.position.y = m.scale.y * 0.5; m.castShadow = true; m.receiveShadow = true; const g = new THREE.Group(); g.add(m); return g;
}

/* ============================ CAR ============================ */
async function buildCar() {
  const draco = new DRACOLoader(); draco.setDecoderPath(A('assets/draco/'));
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(A('assets/models/ferrari.glb'));
  const model = gltf.scene;
  const bodyMat = new THREE.MeshPhysicalMaterial({ color: 0xd8202a, metalness: 0.7, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.6 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x111418, metalness: 0, roughness: 0.05, transmission: 0.0, opacity: 0.5, transparent: true, envMapIntensity: 2 });
  const detail = new THREE.MeshStandardMaterial({ color: 0x111318, metalness: 0.7, roughness: 0.4 });

  const b = model.getObjectByName('body'); if (b) b.material = bodyMat;
  ['glass'].forEach(n => { const o = model.getObjectByName(n); if (o) o.material = glassMat; });
  ['rim_fl', 'rim_fr', 'rim_rl', 'rim_rr', 'trim'].forEach(n => { const o = model.getObjectByName(n); if (o) o.material = detail; });
  model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // extract wheels to sync independently
  const names = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
  for (const n of names) { const w = model.getObjectByName(n); if (w) { w.parent.remove(w); scene.add(w); wheels.push(w); } }

  carBody = new THREE.Group(); carBody.add(model); scene.add(carBody);
  model.position.set(0, -0.52, 0); // seat body onto the chassis

  // ---- physics chassis + raycast vehicle ----
  const desc = RAPIERG.RigidBodyDesc.dynamic().setTranslation(0, 1.4, 90).setLinearDamping(0.12).setAngularDamping(0.5)
    .setCanSleep(false);
  chassisBody = world.createRigidBody(desc);
  const col = RAPIERG.ColliderDesc.cuboid(0.86, 0.34, 1.9).setDensity(190).setFriction(0.7).setRestitution(0.1)
    .setTranslation(0, 0.0, 0);
  world.createCollider(col, chassisBody);

  vehicle = world.createVehicleController(chassisBody);
  const down = { x: 0, y: -1, z: 0 }, axle = { x: -1, y: 0, z: 0 };
  for (const w of WHEELS) {
    vehicle.addWheel({ x: w.x, y: w.y, z: w.z }, down, axle, SUSP_REST, RADIUS);
  }
  for (let i = 0; i < 4; i++) {
    vehicle.setWheelSuspensionStiffness(i, 26);
    vehicle.setWheelMaxSuspensionTravel(i, 0.22);
    vehicle.setWheelFrictionSlip(i, 2.6);
    if (vehicle.setWheelSideFrictionStiffness) vehicle.setWheelSideFrictionStiffness(i, 0.9);
    if (vehicle.setWheelSuspensionCompression) vehicle.setWheelSuspensionCompression(i, 0.85);
    if (vehicle.setWheelSuspensionRelaxation) vehicle.setWheelSuspensionRelaxation(i, 0.9);
  }
  // snap camera behind
  camera.position.set(0, 5, 78);
}

/* ============================ INPUT ============================ */
function bindInput() {
  addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') input.throttle = true;
    if (k === 'arrowdown' || k === 's') input.brake = true;
    if (k === 'arrowleft' || k === 'a') input.left = 1;
    if (k === 'arrowright' || k === 'd') input.right = 1;
    if (k === ' ') { input.hand = true; e.preventDefault(); }
    if (k === 'r') resetCar();
  });
  addEventListener('keyup', e => {
    const k = e.key.toLowerCase();
    if (k === 'arrowup' || k === 'w') input.throttle = false;
    if (k === 'arrowdown' || k === 's') input.brake = false;
    if (k === 'arrowleft' || k === 'a') input.left = 0;
    if (k === 'arrowright' || k === 'd') input.right = 0;
    if (k === ' ') input.hand = false;
  });
  const bt = (id, on, off) => { const el = $(id); const d = e => { e.preventDefault(); on(); }; const u = e => { e.preventDefault(); off(); };
    el.addEventListener('touchstart', d, { passive: false }); el.addEventListener('touchend', u); el.addEventListener('touchcancel', u);
    el.addEventListener('mousedown', d); el.addEventListener('mouseup', u); el.addEventListener('mouseleave', u); };
  bt('#tGas', () => input.throttle = true, () => input.throttle = false);
  bt('#tBrake', () => input.brake = true, () => input.brake = false);
  bt('#tLeft', () => input.left = 1, () => input.left = 0);
  bt('#tRight', () => input.right = 1, () => input.right = 0);
}
function resetCar() {
  chassisBody.setTranslation({ x: chassisBody.translation().x, y: 1.6, z: chassisBody.translation().z }, true);
  chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true); chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  const q = new THREE.Quaternion(); chassisBody.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
}

/* ============================ LOOP ============================ */
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const camPos = new THREE.Vector3(0, 6, 80), camLook = new THREE.Vector3();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.033);

  // steering (smoothed)
  const target = (input.right - input.left) * 0.55;
  steer += (target - steer) * Math.min(1, dt * 8);
  vehicle.setWheelSteering(0, steer); vehicle.setWheelSteering(1, steer);

  const vel = chassisBody.linvel();
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  // forward sign relative to car
  const cq = chassisBody.rotation(); _q.set(cq.x, cq.y, cq.z, cq.w);
  const fwd = _v.set(0, 0, 1).applyQuaternion(_q);
  const goingFwd = (vel.x * fwd.x + vel.z * fwd.z) >= 0;

  const engine = input.throttle ? 1150 : (input.brake && goingFwd && speed > 1 ? 0 : (input.brake ? -650 : 0));
  vehicle.setWheelEngineForce(2, engine); vehicle.setWheelEngineForce(3, engine);
  const brake = (input.brake && goingFwd && speed > 1) ? 34 : 0;
  const hb = input.hand ? 90 : 0;
  for (let i = 0; i < 4; i++) vehicle.setWheelBrake(i, brake + (i >= 2 ? hb : 0));

  vehicle.updateVehicle(dt);
  world.step();

  // sync chassis body mesh
  const ct = chassisBody.translation();
  carBody.position.set(ct.x, ct.y, ct.z); carBody.quaternion.copy(_q);
  _m.compose(carBody.position, _q, _v.set(1, 1, 1));

  // wheels
  wheelSpin += (goingFwd ? 1 : -1) * speed / RADIUS * dt;
  for (let i = 0; i < 4; i++) {
    const w = wheels[i]; if (!w) continue;
    const conn = WHEELS[i];
    const susp = (vehicle.wheelSuspensionLength ? vehicle.wheelSuspensionLength(i) : SUSP_REST) || SUSP_REST;
    const local = _v.set(conn.x, conn.y - susp, conn.z).applyMatrix4(_m);
    w.position.copy(local);
    const st = conn.front ? steer : 0;
    _q.set(cq.x, cq.y, cq.z, cq.w);
    const steerQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), st);
    const spinQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), wheelSpin);
    w.quaternion.copy(_q).multiply(steerQ).multiply(spinQ);
  }

  // auto-reset if fallen / flipped for too long
  if (ct.y < -6) resetCar();

  // ---- chase camera ----
  _q.set(cq.x, cq.y, cq.z, cq.w);
  const back = _v.set(0, 0, 1).applyQuaternion(_q); // car faces +z
  const desired = new THREE.Vector3(ct.x - back.x * 10, ct.y + 4.4, ct.z - back.z * 10);
  camPos.lerp(desired, Math.min(1, dt * 4));
  camera.position.copy(camPos);
  camLook.lerp(new THREE.Vector3(ct.x + back.x * 4, ct.y + 0.8, ct.z + back.z * 4), Math.min(1, dt * 6));
  camera.lookAt(camLook);

  $('#spd').textContent = Math.round(speed * 3.6);
  composer.render();
}
function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
}

boot();
