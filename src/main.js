/**
 * main.js — 全体の組み立て
 */
import * as THREE from 'three';
import { DISCIPLINES, LEVELS, ANTHRO } from './constants.js';
import { TurnModel } from './kinematics.js';
import { createSkier } from './skier.js';
import { Course } from './course.js';
import { ForceView, AngleGuides } from './forces.js';
import { CameraRig } from './views.js';
import { UI, LabelLayer } from './ui.js';

const deg = (r) => r * 180 / Math.PI;

const GHOST_OFFSET = 1.7;      // 比較ゴーストを横にずらす距離 [m]

const app = {
  discipline: 'SL',
  level: 'intermediate',
  playing: true,
  rate: 0.25,
  u: 0,
  gateCount: 9,
  show: { forces: true, body: true, skeleton: true, pelvis: true, angles: true,
          track: true, gates: true, ghost: false },
};

/* ---------- 3D 基本セット ---------- */
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe3f7, 60, 240);

const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 900);
scene.add(camera);

/* 空（グラデーション） */
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color(0x2f6fb5) }, bottom: { value: new THREE.Color(0xdfeefc) } },
      vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float h; uniform vec3 top; uniform vec3 bottom; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.1,0.65,h)), 1.0); }',
    }));
  scene.add(sky);
}

/* 光源 */
const hemi = new THREE.HemisphereLight(0xdcefff, 0xb9c9d8, 1.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff6e8, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 40;
sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
sun.shadow.bias = -0.0012;
scene.add(sun, sun.target);

/* ---------- モデル ---------- */
let disc = DISCIPLINES[app.discipline];
let model = makeModel(disc);
let ghostModel = makeModel(disc, true);

function makeModel(d, ghost = false) {
  const lv = LEVELS[app.level];
  return new TurnModel({
    slopeDeg: d.slopeDeg,
    speedKmh: Math.round(d.speedKmh * lv.speedScale),
    gateSpacing: d.gateSpacing,
    offset: d.offset,
    gateWidth: d.gateWidth,
    counterDeg: ghost ? 0 : Math.round(d.counterDeg * lv.counterScale),
    angulationDeg: ghost ? 0 : Math.round(d.angulationDeg * lv.angulationScale),
    kneeAngulationDeg: ghost ? 0 : d.kneeAngulationDeg,
    stanceWidth: d.stanceWidth,
    innerLead: d.innerLead,
    glideFactor: d.glideFactor,
    skiSidecutR: d.skiSidecutR,
    height: ANTHRO.height, mass: ANTHRO.mass,
  });
}

const course = new Course(scene);
let skier = createSkier({ height: ANTHRO.height, discipline: disc });
scene.add(skier.root);
let ghost = createSkier({ height: ANTHRO.height, discipline: disc });
ghost.setGhost(true);
ghost.root.visible = false;
scene.add(ghost.root);

const forceView = new ForceView(scene, ANTHRO.mass);
const guides = new AngleGuides(scene);
const camRig = new CameraRig(canvas, camera);
const labels = new LabelLayer(document.getElementById('labels'));

/* ---------- UI ---------- */
const ui = new UI({
  onDiscipline(key) { app.discipline = key; rebuild(true); },
  onView(v) {
    if (v === 'first') camRig.setMode('first');
    else if (v === 'pelvis') camRig.setMode('pelvis');
    else camRig.setMode('third');
    app.view = v;
    const pv = v === 'pelvis';
    skier.setFocusPelvis(pv);
    skier.setVisible({ com: !pv });
    guides.setScale(pv ? 0.42 : 1);
    guides.setPelvisMode(pv);
    forceView.setVisible(!pv && app.show.forces);
    labels.clearAll();
  },
  onCamera(c) {
    camRig.setPreset(c); ui.setView('third', true); app.view = 'third';
    skier.setFocusPelvis(false);
    skier.setVisible({ com: true });
    guides.setScale(1); guides.setPelvisMode(false);
    forceView.setVisible(app.show.forces);
  },
  onLevel(l) { app.level = l; rebuild(false); },
  onParam(k, v) {
    const map = { counter: 'counterDeg', angulation: 'angulationDeg', speed: 'speedKmh',
                  slope: 'slopeDeg', gate: 'gateSpacing', offset: 'offset' };
    model.set({ [map[k]]: v });
    ghostModel.set({ [map[k]]: (k === 'counter' || k === 'angulation') ? 0 : v });
    if (k === 'slope' || k === 'gate' || k === 'offset') rebuildCourse();
    ui.syncParams(model.p);
    ui.setFisCheck(model.poleToPoleDistance(), disc);
    ui.setSeries(buildSeries());
  },
  onToggle(k, v) {
    app.show[k] = v;
    // 比較表示のときは 2 人が入るように少し引く
    if (k === 'ghost') camRig.dist *= v ? 1.4 : 1 / 1.4;
    applyVisibility();
  },
  onPlayToggle() { app.playing = !app.playing; ui.setPlaying(app.playing); },
  onScrub(p) {
    app.playing = false; ui.setPlaying(false);
    const cycle = Math.floor(app.u / model.halfCycle);
    app.u = (cycle + p) * model.halfCycle;
  },
  onRate(r) { app.rate = r; },
});

function applyVisibility() {
  skier.setVisible({ skeleton: app.show.skeleton, body: app.show.body,
                     pelvis: app.show.pelvis, com: app.view !== 'pelvis' });
  forceView.setVisible(app.show.forces && app.view !== 'pelvis');
  guides.setVisible(app.show.angles);
  course.setVisible({ tracks: app.show.track, gates: app.show.gates });
  ghost.root.visible = app.show.ghost;
  labels.clearAll();
}

function rebuildCourse() {
  course.build(model, { gateCount: app.gateCount, discipline: disc });
  scene.fog.near = disc.key === 'GS' ? 90 : 55;
  scene.fog.far = disc.key === 'GS' ? 320 : 220;
}

function rebuild(resetPosition) {
  disc = DISCIPLINES[app.discipline];
  model = makeModel(disc);
  ghostModel = makeModel(disc, true);
  // スキーヤーを作り直す（板の長さが種目で変わるため）
  scene.remove(skier.root); scene.remove(ghost.root);
  skier = createSkier({ height: ANTHRO.height, discipline: disc });
  ghost = createSkier({ height: ANTHRO.height, discipline: disc });
  ghost.setGhost(true);
  scene.add(skier.root, ghost.root);
  enableShadows(skier.root);
  if (resetPosition) app.u = 0;
  rebuildCourse();
  camRig.setScale(disc.key === 'GS' ? 1.35 : 1);
  applyVisibility();
  skier.setFocusPelvis(app.view === 'pelvis');
  ui.syncParams(model.p, {
    gate: disc.key === 'SL' ? [6, 16] : [12, 30],
    offset: disc.key === 'SL' ? [0.8, 4] : [2, 8],
    speed: disc.key === 'SL' ? [12, 60] : [20, 90],
  });
  ui.setFisCheck(model.poleToPoleDistance(), disc);
  ui.setSeries(buildSeries());
  ui.setLevel(app.level);
  camRig.first = true;
}

function enableShadows(obj) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
}

/** グラフ用に 1 ターンぶんを走査 */
function buildSeries() {
  const out = [];
  for (let i = 0; i <= 60; i++) {
    const p = i / 60;
    const s = model.sample(model.uFromPhase(p, 0));
    out.push({
      phase: p,
      load: THREE.MathUtils.clamp((s.loadBW - 0.8) / 2.2, 0, 1),
      counter: THREE.MathUtils.clamp(deg(s.counter) / 45, 0, 1),
      incl: THREE.MathUtils.clamp((deg(s.inclination) + 15) / 90, 0, 1),
    });
  }
  return out;
}

/**
 * 腰まわりの動きを 3 つに分けて数値にする。
 *   回旋       : スキーの進行方向に対する骨盤の向き（＝外向角）
 *   腰の折れ   : 骨盤の上下軸と外脚の線のなす角（股関節での外傾）
 *   すねの前傾 : 外脚のすねが斜面法線からどれだけ前に倒れているか（前後バランス）
 */
function pelvisMotions(s) {
  const a = skier.state.anchors;
  if (!a.pelvisFwd || !a.outerAnkle) return { yaw: 0, hip: 0, shin: 0 };
  const yaw = deg(s.counter);
  const hip = deg(Math.acos(THREE.MathUtils.clamp(a.pelvisUp.dot(s.legDir), -1, 1)));
  const shinDir = a.outerKnee.clone().sub(a.outerAnkle).normalize();
  const shin = deg(Math.asin(THREE.MathUtils.clamp(shinDir.dot(s.tangent), -1, 1)));
  return { yaw, hip, shin };
}

/* ---------- ラベル ---------- */
function updateLabels(s) {
  const a = skier.state.anchors;
  const close = camRig.mode === 'pelvis' || camRig.dist < 4;
  if (app.show.angles) {
    labels.set('counter', `外向角 <b>${deg(s.counter).toFixed(0)}°</b>`, guides.anchors.counter ?? a.pelvis);
    labels.set('angulation', `外傾 ${deg(s.angulation).toFixed(0)}°`, guides.anchors.angulation ?? a.pelvis, 'small');
    labels.set('incl', `内傾 ${deg(s.inclination).toFixed(0)}°`, guides.anchors.inclination ?? a.com, 'small');
    labels.set('edge', `エッジ ${deg(s.edgeAngle).toFixed(0)}°`, guides.anchors.edge ?? a.outerFoot, 'small');
    if (close || camRig.preset === 'top') {
      labels.set('skidir', 'スキーの向き', guides.anchors.skiDir, 'small');
      labels.set('pelvisdir', '骨盤の向き', guides.anchors.pelvisDir, 'small');
    }
  }
  if (app.show.forces) {
    const v = forceView.values;
    labels.set('fn', `雪面反力 <b>${v.snowBW.toFixed(1)}×体重</b>`, forceView.anchors.snow);
    labels.set('fg', `重力 ${(v.gravity / 9.80665).toFixed(0)} kgf`, forceView.anchors.gravity, 'small');
    if (forceView.anchors.centrifugal) {
      labels.set('fc', `遠心力 ${(v.centrifugal / 9.80665).toFixed(0)} kgf`, forceView.anchors.centrifugal, 'small');
    }
  }
  if (camRig.mode === 'pelvis') {
    for (const l of skier.pelvis.labelPoints()) {
      labels.set('bone_' + l.key, l.name, l.pos, 'small');
    }
    labels.set('bone_iliumO', '腸骨（外）', a.pelvis.clone()
      .addScaledVector(skier.state.anchors.pelvisRight,
        (skier.state.anchors.pelvisRight.dot(s.outward) > 0 ? 1 : -1) * 0.17)
      .addScaledVector(skier.state.anchors.pelvisUp, 0.06), 'small');
  }
}

/* ---------- ループ ---------- */
const clock = new THREE.Clock();
let size = { w: 1, h: 1 };

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  if (w === size.w && h === size.h) return;
  size = { w, h };
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

/** 視線の先：1.5 旗門ぶん先を見る（レーサーは常に先を見る） */
function nextGateTarget(u) {
  const gs = model.gates(app.gateCount + 3, 0);
  const ahead = u + model.halfCycle * 0.9;
  const g = gs.find((x) => x.u > ahead) || gs[gs.length - 1];
  return g.turning.clone().addScaledVector(model.N, 1.0);
}

function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  resize();

  if (app.playing) {
    app.u += model.v * dt * app.rate;
    const total = model.halfCycle * (app.gateCount - 0.5);
    if (app.u > total) app.u -= total;
    ui.setPhase((app.u % model.halfCycle) / model.halfCycle);
  }

  const s = model.sample(app.u);
  const look = nextGateTarget(app.u);
  skier.update(s, { lookTarget: look, innerLead: disc.innerLead });
  if (app.show.ghost) {
    // 比較用のゴーストは横に 2.6 m ずらして「並走」させる
    const gs = ghostModel.sample(app.u);
    ghost.update(gs, { lookTarget: look, innerLead: disc.innerLead });
    ghost.root.position.add(model.C.clone().multiplyScalar(GHOST_OFFSET));
    labels.set('ghost', '外向・外傾なし（内傾だけ）',
      ghost.state.anchors.head.clone().addScaledVector(model.C, GHOST_OFFSET)
        .addScaledVector(model.N, 0.35), 'small');
  }
  forceView.update(s);
  guides.update(s, skier);
  ui.update(s);
  ui.updateMotions(pelvisMotions(s));
  updateLabels(s);

  // 太陽を追従させて影を出す
  sun.target.position.copy(s.com);
  sun.position.copy(s.com).add(new THREE.Vector3(6, 12, 5));

  camRig.update(model, s, skier.state, dt);
  renderer.render(scene, camera);
  labels.render(camera, size, skier.state.anchors.pelvis,
                camRig.mode === 'pelvis' ? 130 : 96);
  requestAnimationFrame(tick);
}

/* ---------- キーボード ---------- */
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const step = model.halfCycle / 60;
  switch (e.key) {
    case ' ': e.preventDefault(); app.playing = !app.playing; ui.setPlaying(app.playing); break;
    case 'ArrowRight': app.playing = false; ui.setPlaying(false); app.u += step; break;
    case 'ArrowLeft': app.playing = false; ui.setPlaying(false); app.u = Math.max(0, app.u - step); break;
    case '1': ui.setView('third'); break;
    case '2': ui.setView('first'); break;
    case '3': ui.setView('pelvis'); break;
    case 's': case 'S': {
      app.discipline = app.discipline === 'SL' ? 'GS' : 'SL';
      document.querySelectorAll('[data-discipline]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.discipline === app.discipline)));
      rebuild(true); break;
    }
    case 'f': case 'F': ui.toggles.forces.checked = !ui.toggles.forces.checked;
      app.show.forces = ui.toggles.forces.checked; applyVisibility(); break;
    case 'h': case 'H': ui.toggleHelp(document.getElementById('help').hidden); break;
    case 'Tab': e.preventDefault(); document.getElementById('btn-panels').click(); break;
    default: return;
  }
});

/* ---------- 起動 ---------- */
// デバッグ／授業用のハンドル（コンソールから触れるように）
window.skiTrainer = { app, get model() { return model; }, get skier() { return skier; },
  camRig, ui, scene, renderer };

try {
  ui.setLevel(app.level);
  ui.setCamera('follow');
  rebuild(true);
  resize();
  tick();
  document.getElementById('loading').classList.add('done');
} catch (err) {
  const e = document.getElementById('error');
  e.hidden = false;
  e.textContent = '初期化に失敗しました:\n' + (err && err.stack ? err.stack : err);
  document.getElementById('loading').classList.add('done');
  throw err;
}
