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
import { MotionGuide } from './motion.js';
import { Tour } from './tour.js';

const deg = (r) => r * 180 / Math.PI;

const GHOST_OFFSET = 1.7;      // 比較ゴーストを横にずらす距離 [m]

const app = {
  discipline: 'SL',
  level: 'intermediate',
  playing: true,
  rate: 0.25,
  u: 0,
  gateCount: 9,
  /* はじめに出すのは「動作ガイド・身体・骨盤の色分け」の 3 つだけ。
   * 力・角度・シュプールまで最初から全部出すと、初心者はどこを見ればいいか分からない。
   * 必要になったら左の「表示」から足す（はじめのガイドでも順に足していく）。 */
  show: { forces: false, body: true, skeleton: true, pelvis: true, angles: false,
          track: false, gates: true, moves: true, muscles: false, ghost: false },
};

/* 起動・種目切り替えのときに見せる位相。切り替え（0）から始めると
 * 外向も外傾もほぼ 0 で「ただ立っている人」に見えるので、
 * いちばん形が出ている山回り（後半）から始める。1 つ前のターンの旗門も画面に入るよう 2 ターン目にする。 */
const START_PHASE = 1.72;

/* ---------- 3D 基本セット ---------- */
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfe3f7, 60, 240);

const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 900);
scene.add(camera);

/* 空（グラデーション） */
let skyMesh;
let envMap = null;
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
  skyMesh = sky;
}

/* 環境マップ：空と雪面から作る。これがないと金属（ゴーグルのレンズ・
   ブーツのバックル・エッジ）が真っ黒になり、プラスチックにしか見えない。 */
{
  const envScene = new THREE.Scene();
  envScene.add(skyMesh.clone());
  const ground = new THREE.Mesh(
    new THREE.SphereGeometry(400, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xeef4fb, side: THREE.BackSide }));
  envScene.add(ground);
  const pmrem = new THREE.PMREMGenerator(renderer);
  // scene.environment にすると全マテリアルが IBL を引いて重くなるので、
  // 金属（ゴーグルのレンズ・バックル）にだけ個別に渡す。
  envMap = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
}

/* 光源 */
const hemi = new THREE.HemisphereLight(0xdcefff, 0xb9c9d8, 2.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff6e8, 2.9);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 40;
sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
sun.shadow.bias = -0.0012;
scene.add(sun, sun.target);
// 逆光側の弱い補助光。輪郭が黒く潰れないように
const fill = new THREE.DirectionalLight(0xd6e6ff, 0.65);
fill.position.set(-5, 4, -7);
scene.add(fill);

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
    platformDeg: d.platformDeg,
    stanceWidth: d.stanceWidth,
    glideFactor: d.glideFactor, glideAmp: d.glideAmp,
    skew: d.skew, gateLag: d.gateLag,
    outerShareMax: d.outerShareMax, outerShareLate: d.outerShareLate,
    gammaPelvis: d.gammaPelvis, activePelvis: d.activePelvis,
    gammaSpine: d.gammaSpine, activeSpine: d.activeSpine,
    innerEdgeExtraDeg: d.innerEdgeExtraDeg, leadFactor: d.leadFactor,
    blockSigmaBefore: d.blockSigmaBefore, blockSigmaAfter: d.blockSigmaAfter,
    blockStrength: d.blockStrength, blockHeight: d.blockHeight,
    leadToPelvis: d.leadToPelvis,
    skiSidecutR: d.skiSidecutR,
    height: ANTHRO.height, mass: ANTHRO.mass,
  });
}

const course = new Course(scene);
let skier = createSkier({ height: ANTHRO.height, discipline: disc, env: envMap });
scene.add(skier.root);
let ghost = createSkier({ height: ANTHRO.height, discipline: disc, env: envMap });
ghost.setGhost(true);
ghost.root.visible = false;
scene.add(ghost.root);

const forceView = new ForceView(scene, ANTHRO.mass);
const guides = new AngleGuides(scene);
const motion = new MotionGuide(scene);
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
    motion.setVisible(app.show.moves && !pv);
    guides.setPelvisMode(pv);
    forceView.setVisible(!pv && app.show.forces);
    labels.clearAll();
  },
  onCamera(c) {
    camRig.setPreset(c); ui.setView('third', true); app.view = 'third';
    skier.setFocusPelvis(false);
    skier.setVisible({ com: true });
    guides.setScale(1); guides.setPelvisMode(false);
    motion.setVisible(app.show.moves);
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
  onPlayToggle() { app.tourHold = false; app.playing = !app.playing; ui.setPlaying(app.playing); },
  onScrub(p) {
    app.tourHold = false;
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
  skier.setMusclesVisible(app.show.muscles);
  motion.setVisible(app.show.moves && app.view !== 'pelvis');
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
  skier = createSkier({ height: ANTHRO.height, discipline: disc, env: envMap });
  ghost = createSkier({ height: ANTHRO.height, discipline: disc, env: envMap });
  ghost.setGhost(true);
  scene.add(skier.root, ghost.root);
  enableShadows(skier.root);
  if (resetPosition) app.u = START_PHASE * model.halfCycle;
  ui.setPhase((app.u % model.halfCycle) / model.halfCycle);
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
  if (!a.pelvisFwd || !a.outerAnkle) return { yaw: 0, spine: 0, hip: 0, shin: 0 };
  const yaw = deg(s.counter);
  const spine = deg(s.counterSpine ?? s.counter);
  // 腰の折れ＝前額面だけで見る（骨盤の前傾ぶんが混ざらないよう、進行方向の成分を落とす）
  const pu = a.pelvisUp.clone().addScaledVector(s.tangent, -a.pelvisUp.dot(s.tangent)).normalize();
  const lg = s.legDir.clone().addScaledVector(s.tangent, -s.legDir.dot(s.tangent)).normalize();
  const hip = deg(Math.acos(THREE.MathUtils.clamp(pu.dot(lg), -1, 1)));
  const shinDir = a.outerKnee.clone().sub(a.outerAnkle).normalize();
  const shin = deg(Math.asin(THREE.MathUtils.clamp(shinDir.dot(s.tangent), -1, 1)));
  return { yaw, spine, hip, shin };
}

/** 外脚の股関節（骨盤から見た大腿骨の向き） */
function hipMotions() {
  const a = skier.state.angles;
  return {
    flex: deg(a.hipFlexion ?? 0),
    abd: deg(a.hipAbduction ?? 0),
    rot: deg(a.hipRotation ?? 0),
  };
}

/* ---------- ラベル ---------- */
/* 一度に出すラベルの上限。7 つも 8 つも出すと、初心者はどれも読まない。
 * 大事な順（prio が小さい順）に上限まで出す。
 *   動作ガイドの 1 位 → 外向角（入力） → 内傾角（結果） → 外スキーの力 → 動作ガイドの 2 位 → …
 * 色の約束：青い縁＝入力（スライダーで自分が決めた量）、
 *           紫の点線＝結果（力学で決まって自分では選べない量）。 */
const LABEL_MAX = { third: 4, narrow: 3, pelvis: 9, pelvisNarrow: 6 };
const PRIO = { do0: 0, ghost: 1, counter: 2, incl: 3, fn: 4, do1: 5, do2: 6,
  angulation: 7, edge: 8, fni: 9, skidir: 10, pelvisdir: 10, fg: 12, fc: 12, cp: 13 };

function labelMax() {
  const narrow = size.w < 820;
  if (camRig.mode === 'pelvis') return narrow ? LABEL_MAX.pelvisNarrow : LABEL_MAX.pelvis;
  return narrow ? LABEL_MAX.narrow : LABEL_MAX.third;
}

function updateLabels(s) {
  const a = skier.state.anchors;
  const pelvisView = camRig.mode === 'pelvis';
  const close = pelvisView || camRig.dist < 4;
  const narrow = size.w < 820;
  const L = (key, text, pos, cls, prio = PRIO[key] ?? 30) => labels.set(key, text, pos, cls, prio);

  // 動作ガイド：矢印の先に「何をするか」を出す（これが主役なので最優先）
  if (app.show.moves && !pelvisView && camRig.mode !== 'first') {
    motion.active.forEach((m, i) => {
      if (narrow && i > 0) return;          // 狭い画面は 1 位だけ（残りはパネルの文字で）
      L('do_' + i, (i === 0 ? '▶ ' : '') + m.text, m.anchor, i === 0 ? 'do' : 'do small',
        PRIO['do' + i]);
    });
  }

  if (pelvisView) {
    // 骨盤クローズアップ：骨の名前と、骨盤まわりの角度だけ
    if (app.show.angles) {
      L('counter', `外向角 <b>${deg(s.counter).toFixed(0)}°</b>`,
        guides.anchors.counter ?? a.pelvis, 'inp', 0);
      L('angulation', `外傾 ${deg(s.angulation).toFixed(0)}°`,
        guides.anchors.angulation ?? a.pelvis, 'inp small', 3);
    }
    // どちらの腸骨が「外側」かを示す
    L('bone_ilium', '腸骨（外側＝赤）',
      a.pelvis.clone().addScaledVector(s.outward, 0.15)
        .addScaledVector(a.pelvisUp, 0.075), 'small', 1);
    const first = ['crest', 'asis', 'sacrum', 'acetabulum', 'ischium'];
    for (const l of skier.pelvis.labelPoints()) {
      const k = first.indexOf(l.key);
      L('bone_' + l.key, l.name, l.pos, 'small', k >= 0 ? 4 + k : 20);
    }
    return;
  }

  if (app.show.angles) {
    L('counter', `外向角 <b>${deg(s.counter).toFixed(0)}°</b>`, guides.anchors.counter ?? a.pelvis, 'inp');
    L('angulation', `外傾 ${deg(s.angulation).toFixed(0)}°`, guides.anchors.angulation ?? a.pelvis, 'inp small');
    L('incl', `内傾 ${deg(s.inclination).toFixed(0)}°`, guides.anchors.inclination ?? a.com, 'res small');
    L('edge', `エッジ ${deg(s.edgeAngle).toFixed(0)}°`, guides.anchors.edge ?? a.outerFoot, 'res small');
    if (!narrow && (close || camRig.preset === 'top')) {
      L('skidir', 'スキーの向き', guides.anchors.skiDir, 'small');
      L('pelvisdir', '骨盤の向き', guides.anchors.pelvisDir, 'small');
    }
  }
  if (app.show.forces) {
    const v = forceView.values;
    L('fn', `外スキー <b>${v.outerBW.toFixed(2)}×体重</b>`, forceView.anchors.snow, 'res');
    L('fni', `内スキー ${v.innerBW.toFixed(2)}×体重`, forceView.anchors.snowInner, 'res small');
    L('fg', `重力 ${(v.gravity / 9.80665).toFixed(0)} kgf`, forceView.anchors.gravity, 'res small');
    if (forceView.anchors.centrifugal) {
      L('fc', `遠心力 ${(v.centrifugal / 9.80665).toFixed(0)} kgf`, forceView.anchors.centrifugal, 'res small');
    }
    L('cp', `圧の中心 ブーツ前 ${(v.cpOffset * 100).toFixed(0)}cm`, forceView.anchors.cp, 'res small');
  }
}

/* ---------- ループ ---------- */
const clock = new THREE.Clock();
let size = { w: 1, h: 1 };
let viewShift = 0;
const tourEl = document.getElementById('tour');

/** 画面の下をふさいでいる高さ [px]（狭い画面でガイドのカードが出ているときだけ） */
function bottomOcclusion() {
  if (size.w >= 820 || !tourEl || tourEl.hidden) return 0;
  return Math.max(0, size.h - tourEl.getBoundingClientRect().top);
}

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
  // 手の基準に使う「少し先の重心」。手はここを追うので運びが連続になる
  const ahead = model.sample(app.u + 0.42);
  skier.update(s, { lookTarget: look, ahead });
  if (app.show.ghost) {
    // 比較用のゴーストは横に 2.6 m ずらして「並走」させる
    const gs = ghostModel.sample(app.u);
    ghost.update(gs, { lookTarget: look, ahead: ghostModel.sample(app.u + 0.42) });
    ghost.root.position.add(model.C.clone().multiplyScalar(GHOST_OFFSET));
    labels.set('ghost', '外向・外傾なし（内傾だけ）',
      ghost.state.anchors.head.clone().addScaledVector(model.C, GHOST_OFFSET)
        .addScaledVector(model.N, 0.35), 'small', PRIO.ghost);
  }
  course.updateGates(app.u);
  forceView.update(s);
  guides.update(s, skier);
  // 動作ガイド：少し先の姿勢との差＝「いま何をしているか」
  const dPhase = 0.055;
  motion.update(s, model.sample(app.u + model.halfCycle * dPhase), dPhase, skier.state);
  ui.update(s, { hipLead: skier.state.angles.hipLead ?? 0 });
  ui.updateMuscles(skier.state.muscleAct, skier.state.outerSide, app.show.muscles);
  ui.updateDoing(motion.active, app.show.moves);
  ui.updateMotions(pelvisMotions(s));
  ui.updateMotions(hipMotions(), 'hip');
  updateLabels(s);

  // 太陽を追従させて影を出す
  sun.target.position.copy(s.com);
  sun.position.copy(s.com).add(new THREE.Vector3(6, 12, 5));

  camRig.update(model, s, skier.state, dt);
  // 狭い画面でガイドのカードが下を覆っている間は、絵をカードの上の空いた所へ寄せる
  const occ = bottomOcclusion();
  viewShift += (occ / 2 - viewShift) * (1 - Math.exp(-dt * 7));
  if (Math.abs(viewShift) > 0.5) camera.setViewOffset(size.w, size.h, 0, viewShift, size.w, size.h);
  else if (camera.view?.enabled) camera.clearViewOffset();
  renderer.render(scene, camera);
  labels.render(camera, size, skier.state.anchors.pelvis,
                camRig.mode === 'pelvis' ? 130 : (size.w < 820 ? 76 : 96), labelMax(),
                Math.max(54, occ + 10));
  ui.setLabelKey(labels.shownIO);
  requestAnimationFrame(tick);
}

/* ---------- はじめのガイド ---------- */
function setShow(k, on) { app.show[k] = on; ui.setToggle(k, on); }
const tour = new Tour({
  onStart() {
    // 見る順番を案内するので、初期の 3 つの表示・三人称・山回りで止めた状態から始める
    setShow('forces', false); setShow('angles', false); setShow('moves', true);
    if (app.view && app.view !== 'third') ui.setView('third');
    ui.setCamera('follow'); ui.h.onCamera('follow');
    app.playing = false; ui.setPlaying(false); app.tourHold = true;
    app.u = (Math.floor(app.u / model.halfCycle) + 0.72) * model.halfCycle;
    ui.setPhase(0.72);
    applyVisibility();
  },
  onSlow() {
    app.rate = 0.1; ui.setRate(0.1);
    app.tourHold = false; app.playing = true; ui.setPlaying(true);
  },
  onPelvis() { ui.setView('pelvis'); },
  onForces() {
    if (app.view !== 'third') ui.setView('third');
    setShow('forces', true); setShow('angles', true);
    applyVisibility();
  },
  onEnd() {
    // ガイドが止めたままなら動かしておく（止まった画面のまま放り出さない）
    if (app.tourHold) { app.tourHold = false; app.playing = true; ui.setPlaying(true); }
  },
});
document.getElementById('btn-tour-again')?.addEventListener('click', () => {
  ui.toggleHelp(false);
  tour.start();
});

/* ---------- キーボード ---------- */
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const step = model.halfCycle / 60;
  if (e.key === ' ' || e.key.startsWith('Arrow')) app.tourHold = false;
  switch (e.key) {
    case ' ':
      // ガイドのボタンにフォーカスがあるときの Space はボタンを押す（再生と二重に効かせない）
      if (e.target.closest?.('#tour')) return;
      e.preventDefault(); app.playing = !app.playing; ui.setPlaying(app.playing); break;
    case 'ArrowRight': app.playing = false; ui.setPlaying(false); app.u += step; break;
    case 'ArrowLeft': app.playing = false; ui.setPlaying(false); app.u = Math.max(0, app.u - step); break;
    case 'Escape':
      if (!document.getElementById('help').hidden) ui.toggleHelp(false);
      break;
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
    case 'Tab': e.preventDefault(); document.body.classList.toggle('panels-hidden'); break;
    default: return;
  }
});

/* ---------- 起動 ---------- */
// デバッグ／授業用のハンドル（コンソールから触れるように）
window.skiTrainer = { app, get model() { return model; }, get skier() { return skier; },
  camRig, ui, scene, renderer, course, motion, tour, labels };

try {
  ui.setLevel(app.level);
  ui.setCamera('follow');
  rebuild(true);
  resize();
  tick();
  document.getElementById('loading').classList.add('done');
  tour.maybeStart();
} catch (err) {
  const e = document.getElementById('error');
  e.hidden = false;
  e.textContent = '初期化に失敗しました:\n' + (err && err.stack ? err.stack : err);
  document.getElementById('loading').classList.add('done');
  throw err;
}
