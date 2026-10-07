/**
 * main.js — 全体の組み立て
 *
 * ■ 2 つの表示（app.mode）
 *   'simple'（かんたん・既定）：スキーヤー・黄色の指示 1 つ・下のカード・再生だけ。
 *     以前の既定画面は文字のかたまり 98・数字 25 個・パネルが画面の 34 % をふさいでいて、
 *     はじめての人はどこを見ればいいか分からなかった。
 *   'detail'（くわしく）：指導者向けのパネル（数値・グラフ・表示の切り替え）。
 *   選んだほうは localStorage に覚える。URL の ?mode=detail / ?mode=simple がそれより優先
 *   （授業で配るリンク用。URL で決めたときは覚えている設定を書き換えない）。キー D でも切り替わる。
 *
 * ■ ほかのファイルの新しい機能は ?.() で呼ぶ
 *   見え方（skier.setLook）・カメラ（camRig.setSimple）・旗の透け（course.updateOcclusion）などは
 *   別の作業で入る。名前付きの import は、相手のファイルにその名前がないと
 *   ES モジュールのリンクで失敗し、アプリ全体が真っ白になる。?.() なら、まだない機能は何もしないだけで済む。
 */
import * as THREE from 'three';
import { DISCIPLINES, LEVELS, ANTHRO, PHASES } from './constants.js';
import { TurnModel } from './kinematics.js';
import { createSkier } from './skier.js';
import { Course } from './course.js';
import { ForceView, AngleGuides } from './forces.js';
import { CameraRig } from './views.js';
import { UI, LabelLayer } from './ui.js';
import { MotionGuide } from './motion.js';
import { Tour } from './tour.js';
import { World } from './environment.js';

const deg = (r) => r * 180 / Math.PI;
/** 角度の表示（負の数はマイナス記号 −。カードのコンパスと同じ書き方にする） */
const fmtDeg = (r) => { const d = Math.round(deg(r)); return `${d < 0 ? '−' : ''}${Math.abs(d)}°`; };

const GHOST_OFFSET = 1.7;      // 比較ゴーストを横にずらす距離 [m]
const GHOST_ZOOM = 1.4;        // 比較表示のときに引く倍率（2 人が画面に入るように）

/* 再生の速さ。スロー ¼ が既定。0.5 倍以上を「速い」として文字を消す（下の fastPlay）。 */
const SLOW_RATE = 0.25, SLOWER_RATE = 0.1, REAL_RATE = 1, FAST_RATE = 0.5;
/* 起動直後の 2 ターンは実際の速さで見せてから、0.6 秒かけてスローへ落とす（調整値）。
 * ずっとスローのままだと、本物のターンのリズム（SL レーサーで 1 ターン約 0.9 秒）が一度も見えない。 */
const INTRO_TURNS = 2, INTRO_EASE = 0.6;

/* 表示の初期値。かんたん表示は「やることの矢印・身体・骨盤の色分け・ポール」だけで、ほかは出さない。
 * くわしく表示はこれまでの既定（骨格も出す）。くわしくで変えた表示は、かんたんへ行って戻っても覚えておく。 */
const SHOW_SIMPLE = { forces: false, body: true, skeleton: false, pelvis: true, angles: false,
  track: false, gates: true, moves: true, muscles: false, ghost: false };
const SHOW_DETAIL = { forces: false, body: true, skeleton: true, pelvis: true, angles: false,
  track: false, gates: true, moves: true, muscles: false, ghost: false };

const MODE_KEY = 'skiTrainer.mode';
function urlParam(k) {
  try { return new URLSearchParams(window.location.search).get(k); } catch { return null; }
}
function initialMode() {
  const q = urlParam('mode');
  if (q === 'detail' || q === 'simple') return q;
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    if (v === 'detail' || v === 'simple') return v;
  } catch { /* 保存できない環境でも既定で動く */ }
  return 'simple';
}
function writeMode(m) {
  try { window.localStorage.setItem(MODE_KEY, m); } catch { /* 保存できなくても動く */ }
}

const app = {
  discipline: 'SL',
  level: 'intermediate',
  playing: true,
  rate: SLOW_RATE,
  slowRate: SLOW_RATE,      // スローに戻すときの速さ（¼ か 1/10）
  u: 0,
  gateCount: 9,
  mode: initialMode(),
  look: 'window',           // くわしく表示の見え方：'window'（骨盤を透視）| 'racer' | 'xray'
  view: 'third',
  show: null,
  detailShow: { ...SHOW_DETAIL },
  intro: null,              // 起動直後の実際の速さ（startIntro）
  ghostZoom: 1,             // いまカメラの距離に掛けている比較表示の倍率
  tourHold: false,
  tourSlowed: false,
};
app.show = { ...(app.mode === 'simple' ? SHOW_SIMPLE : SHOW_DETAIL) };

/* 起動・種目切り替えのときに見せる位相。切り替え（0）から始めると
 * 外向も外傾もほぼ 0 で「ただ立っている人」に見えるので、
 * いちばん形が出ている山回り（後半）から始める。1 つ前のターンの旗門も画面に入るよう 2 ターン目にする。 */
const START_PHASE = 1.72;

/* ---------- 3D 基本セット ---------- */
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 900);
scene.add(camera);

/* 空・光・霧・地形・森・ネット・環境マップ（environment.js）。
 * スキーヤーを作る前に環境マップが要るので、ここで作っておく。 */
const world = new World(renderer, scene, camera);
let envMap = world.envMap;

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
  onMode(m) { setMode(m, true); },
  onDiscipline(key) { endIntro(); app.discipline = key; rebuild(true); },
  onView(v) { setView(v); },
  onCamera(c) {
    camRig.setPreset(c);
    // この版にない視点（中継はカメラの作業で入る）を押されたら追従に戻す
    if (camRig.preset !== c) { camRig.setPreset('follow'); ui.setCamera('follow'); }
    ui.setView('third', true);
    setView('third', true);
  },
  onLevel(l) { endIntro(); app.level = l; rebuild(false); },
  onParam(k, v) {
    const map = { counter: 'counterDeg', angulation: 'angulationDeg', speed: 'speedKmh',
                  slope: 'slopeDeg', gate: 'gateSpacing', offset: 'offset' };
    model.set({ [map[k]]: v });
    ghostModel.set({ [map[k]]: (k === 'counter' || k === 'angulation') ? 0 : v });
    gatesCache = null;
    if (k === 'slope' || k === 'gate' || k === 'offset') rebuildCourse();
    ui.syncParams(model.p);
    ui.setFisCheck(model.poleToPoleDistance(), disc);
    ui.setSeries(buildSeries());
  },
  onToggle(k, v) {
    app.show[k] = v;
    // 筋肉は不透明なスーツの中では見えないので、見え方を X線 に切り替える（コントロールも合わせる）
    if (k === 'muscles' && v && app.look !== 'xray') { app.look = 'xray'; ui.setLook('xray'); }
    applyVisibility();
  },
  onLook(l) { app.look = l; applyVisibility(); },
  onPlayToggle() {
    endIntro();
    app.tourHold = false; app.playing = !app.playing; ui.setPlaying(app.playing);
  },
  onScrub(p) {
    endIntro();
    app.tourHold = false;
    app.playing = false; ui.setPlaying(false);
    const cycle = Math.floor(app.u / model.halfCycle);
    app.u = (cycle + p) * model.halfCycle;
  },
  /** 局面の帯を押した：その局面の真ん中へ飛んで止める */
  onPhaseJump(p) {
    endIntro();
    app.tourHold = false;
    app.playing = false; ui.setPlaying(false);
    jumpToPhase(p);
  },
  onRate(r) { endIntro(); setRate(r); },
  /** 「スロー」：実際の速さからはスローへ。スロー中にもう一度押すと ¼ ⇄ 1/10 */
  onSlow() {
    endIntro();
    setRate(app.rate >= FAST_RATE ? app.slowRate : (app.rate > SLOWER_RATE ? SLOWER_RATE : SLOW_RATE));
    play();
  },
  /** 「実際の速さ」：押すと 1.0×、もう一度押すとスローへ戻る */
  onReal() {
    endIntro();
    setRate(app.rate >= FAST_RATE ? app.slowRate : REAL_RATE);
    play();
  },
  /** ヘルプの「骨盤の色分け」：いまの配色の凡例（骨盤の作業の legend がなければ ui.js が BONE_COLORS で作る） */
  legend() { return skier.pelvis.legend?.(paletteName()) ?? null; },
});

function play() { app.tourHold = false; app.playing = true; ui.setPlaying(true); }

function setRate(r) {
  app.rate = r;
  if (r < FAST_RATE) app.slowRate = r;
  ui.setRate(r);
}

/** 実際の速さに近い再生中か（0.5 倍以上）。止めているときは文字を出してよい（点滅しないので） */
function fastPlay() { return app.playing && app.rate >= FAST_RATE; }

function jumpToPhase(p) {
  app.u = (Math.floor(app.u / model.halfCycle) + p) * model.halfCycle;
  ui.setPhase(p);
}

/* ---------- 表示の切り替え ---------- */
/**
 * 骨盤の配色：かんたん表示は外＝赤・内＝緑・正面＝白の 3 色、くわしく表示は部位ごとの色。
 * かんたん表示の骨盤アップも 3 色にする。骨の名前を出さないので、部位ごとの 7 色は意味の分からない色が
 * 増えるだけで、恥骨の青が「骨盤の向き」の青い矢印とまぎれる。ラベルの「赤＝外側の腰骨」とも 3 色のほうが合う。
 */
function paletteName() { return app.mode === 'simple' ? 'simple' : 'anatomy'; }
/** 見え方：かんたん表示はいつも「骨盤を透視」。くわしく表示は選んだもの */
function effLook() { return app.mode === 'simple' ? 'window' : app.look; }

function setMode(m, persist = false) {
  const next = m === 'detail' ? 'detail' : 'simple';
  if (next !== app.mode) {
    if (app.mode === 'detail') app.detailShow = { ...app.show };
    app.mode = next;
    // かんたん表示には切り替えのつまみがないので、くわしくで足した表示を持ち込まない
    app.show = { ...(next === 'simple' ? SHOW_SIMPLE : app.detailShow) };
    if (persist) writeMode(next);
  }
  applyMode();
}

function applyMode() {
  const simple = app.mode === 'simple';
  document.body.classList.toggle('mode-simple', simple);
  ui.setMode(app.mode);
  for (const [k, v] of Object.entries(app.show)) ui.setToggle(k, v);
  ui.setLook(app.look);
  motion.setMode?.(simple ? 'cue' : 'rate');
  camRig.setSimple?.(simple);
  if (simple) ui.openSheet(null);
  // かんたん表示にはカメラの選択がなく、視点のボタンも「うしろから」と書いてある。
  // くわしくで正面・真横などにしていたら追従に戻す（ボタンの名前と見え方を食い違わせない）
  if (simple && app.view === 'third' && camRig.preset !== 'follow') {
    camRig.setPreset('follow'); ui.setCamera('follow'); setView('third', true);
    return;
  }
  applyVisibility();
}

function setView(v, fromPreset = false) {
  // 骨盤アップは止めて読む視点。実際の速さのままだとカメラ（views.js）の追従が
  // 速さ ÷ 6.5 ほど遅れ、1.0× では骨盤から 0.7 m まで寄ってしまう（測定）ので、起動直後の実速度は終える
  if (v === 'pelvis') endIntro();
  if (!fromPreset) {
    if (v === 'first') camRig.setMode('first');
    else if (v === 'pelvis') camRig.setMode('pelvis');
    else camRig.setMode('third');
  }
  app.view = v;
  // setMode / setPreset はカメラの距離を戻すので、比較表示の倍率は掛け直す
  app.ghostZoom = 1;
  const pv = v === 'pelvis';
  skier.setFirstPerson?.(v === 'first');
  guides.setScale(pv ? 0.42 : 1);
  guides.setPelvisMode(pv);
  world.setPelvisMode?.(pv);
  document.body.classList.toggle('view-first', v === 'first');
  applyVisibility();
}

/**
 * 比較の人（横に GHOST_OFFSET ずれて並走）を出したときのカメラ。
 * 2 人の真ん中を見て（pan）、両端に 0.9 m ずつ余白が入るまで引く（少なくとも 1.4 倍。0.9 m は内傾した上体と手が入る調整値）。
 * 縦長のスマホは横の画角が狭く、1.4 倍だけでは比較の人が画面の外にいた。
 */
function applyGhostZoom() {
  const on = app.show.ghost && camRig.mode === 'third';
  let want = 1;
  if (on) {
    const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.aspect || 1);
    const base = camRig.dist / app.ghostZoom;
    want = Math.max(GHOST_ZOOM, (GHOST_OFFSET / 2 + 0.9) / Math.max(0.05, base * halfW));
  }
  if (want !== app.ghostZoom) { camRig.dist *= want / app.ghostZoom; app.ghostZoom = want; }
  if (on) { camRig.pan.copy(model.C).multiplyScalar(GHOST_OFFSET / 2); app.ghostPan = true; }
  else if (app.ghostPan) { camRig.pan.set(0, 0, 0); app.ghostPan = false; }
}

function applyVisibility() {
  const simple = app.mode === 'simple';
  const pv = app.view === 'pelvis';
  const hasLook = typeof skier.setLook === 'function';
  skier.setVisible({
    // 見え方（setLook）がまだない版では、骨盤が骨格のグループの中にある。
    // 骨格ごと消すと骨盤まで消えるので、骨格は残して体幹の骨（肋骨・背骨）だけを消す
    skeleton: hasLook ? app.show.skeleton : true,
    body: app.show.body, pelvis: app.show.pelvis,
    // 重心の印は黄色。かんたん表示では「いま、やること」の黄色とまぎれるので出さない
    com: !pv && !simple,
  });
  if (!hasLook && skier.torso?.group) skier.torso.group.visible = app.show.skeleton;
  skier.setFocusPelvis(pv);
  skier.setLook?.(effLook());
  ghost.setLook?.(effLook());
  const pal = paletteName();
  skier.pelvis.setPalette?.(pal);
  ghost.pelvis?.setPalette?.(pal);
  forceView.setVisible(app.show.forces && !pv);
  // かんたん表示の骨盤アップ：骨盤の下の目盛り板に、白＝スキー・青＝骨盤・その間の赤＝外向だけを出す
  const dial = simple && pv;
  guides.setVisible(app.show.angles || dial);
  guides.setOnly?.(dial ? ['counter', 'dirs'] : null);
  skier.setMusclesVisible(app.show.muscles);
  motion.setVisible(app.show.moves && !pv);
  course.setVisible({ tracks: app.show.track, gates: app.show.gates });
  ghost.root.visible = app.show.ghost;
  applyGhostZoom();
  labels.clearAll();
}

let gatesCache = null;

function rebuildCourse() {
  course.build(model, { gateCount: app.gateCount, discipline: disc });
  gatesCache = null;
  world.build?.(model, { discipline: disc, gateCount: app.gateCount });
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
  motion.setDiscipline?.(disc.key);
  skier.setFirstPerson?.(app.view === 'first');
  applyVisibility();
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

/** 影：部品の側で決めた旗に従う（細かすぎる部品は影を落とさない・雪に近い面だけ影を受ける） */
function enableShadows(obj) {
  obj.traverse((o) => {
    if (o.isMesh) { o.castShadow = !o.userData.noShadow; o.receiveShadow = !!o.userData.receiveShadow; }
  });
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
 *   上体の外向 : スキーの進行方向に対する肩の向き（骨盤の外向角は同じタブのコンパスに出す）
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
 * かんたん表示は「いま、やること」の 1 つだけ（比較の人を並べたときはその名前も）、
 * 骨盤アップは「外向 13°」と「赤＝外側の腰骨」の 2 つだけ。骨の名前はくわしく表示で出す。
 * 色の約束：青い縁＝入力（スライダーで自分が決めた量）、
 *           紫の点線＝結果（力学で決まって自分では選べない量）。 */
const LABEL_MAX = { third: 4, narrow: 3, pelvis: 9, pelvisNarrow: 6, simple: 1, pelvisSimple: 2 };
const PRIO = { do0: 0, ghost: 1, counter: 2, incl: 3, fn: 4, do1: 5, do2: 6,
  angulation: 7, edge: 8, fni: 9, skidir: 10, pelvisdir: 10, fg: 12, fc: 12, cp: 13 };

function labelMax() {
  const narrow = size.w < 820;
  if (app.mode === 'simple') {
    if (camRig.mode === 'pelvis') return LABEL_MAX.pelvisSimple;
    return LABEL_MAX.simple + (app.show.ghost ? 1 : 0);
  }
  if (camRig.mode === 'pelvis') return narrow ? LABEL_MAX.pelvisNarrow : LABEL_MAX.pelvis;
  return narrow ? LABEL_MAX.narrow : LABEL_MAX.third;
}

function updateLabels(s) {
  // 実際の速さで再生中は文字を出さない。局面が 1 秒に何度も変わり、読めないまま点滅するだけなので
  if (fastPlay()) return;
  const a = skier.state.anchors;
  const simple = app.mode === 'simple';
  const pelvisView = camRig.mode === 'pelvis';
  const close = pelvisView || camRig.dist < 4;
  const narrow = size.w < 820;
  const L = (key, text, pos, cls, prio = PRIO[key] ?? 30) => labels.set(key, text, pos, cls, prio);
  const top = motion.active[0];

  if (camRig.mode === 'first') {
    // 一人称：自分の身体はほとんど見えないので、指示は目の前 1.5 m に出す（以前は何も出なかった）
    if (app.show.moves && top && a.eye && a.eyeDir) {
      L('do_0', (simple ? '' : '▶ ') + (top.short ?? top.text), a.eye.clone().addScaledVector(a.eyeDir, 1.5),
        top.hold ? 'do hold' : 'do', PRIO.do0);
    }
    return;
  }

  if (app.show.ghost && !pelvisView) {
    L('ghost', '外向・外傾なし（内傾だけ）',
      ghost.state.anchors.head.clone().addScaledVector(model.C, GHOST_OFFSET)
        .addScaledVector(model.N, 0.35), 'small', PRIO.ghost);
  }

  if (simple) {
    if (pelvisView) {
      // 骨盤アップ（かんたん）：数字は外向角の 1 つだけ。骨の名前は出さない
      L('counter', `外向 <b>${fmtDeg(s.counter)}</b>`, guides.anchors.counter ?? a.pelvis, 'inp', 0);
      L('outer', '赤＝外側の腰骨',
        a.pelvis.clone().addScaledVector(s.outward, 0.15).addScaledVector(a.pelvisUp, 0.075), 'small', 1);
      return;
    }
    // 吹き出しは短い言い方（文はカードに出す）。「保つ」指示は縁取りを変えて動かす指示と見分ける
    if (app.show.moves && top) L('do_0', top.short ?? top.text, top.anchor, top.hold ? 'do hold' : 'do', PRIO.do0);
    return;
  }

  // 動作ガイド：矢印の先に「何をするか」を出す（これが主役なので最優先）
  if (app.show.moves && !pelvisView) {
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
    // 力の書き方は「体重の X.X 倍」に統一（数値パネルと同じ式・同じ桁にして、同じ名前に 2 つの値を出さない）
    const fo = s.outerShare * s.loadBW, fi = (1 - s.outerShare) * s.loadBW;
    L('fn', `外スキー <b>体重の ${fo.toFixed(1)} 倍</b>`, forceView.anchors.snow, 'res');
    L('fni', `内スキー 体重の ${fi.toFixed(1)} 倍`, forceView.anchors.snowInner, 'res small');
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
const coachEl = document.getElementById('coach');
const sheetEls = [document.getElementById('panel-left'), document.getElementById('panel-right')];

/**
 * 画面の上下をふさいでいる高さ [px]。
 *   bottom：下のカード（いま、やること）・狭い画面のガイドのカード・開いたシートのうち、いちばん上まで来ているもの
 *   top   ：広い画面のガイドのカード（上に出る）の下端
 * 絵（スキーヤー）は上下の空いた所の真ん中へ寄せる（下の viewShift）。
 * 上を数えないと、広い画面では下のカードのぶん上へ寄せた頭が、ガイドのカードの下に隠れていた。
 */
const occ = { top: 0, bottom: 0 };
function measureOcclusion() {
  occ.top = 0; occ.bottom = 0;
  const take = (el) => {
    if (!el || el.hidden) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (r.bottom > size.h * 0.6) occ.bottom = Math.max(occ.bottom, size.h - r.top);
    else if (r.top < size.h * 0.4) occ.top = Math.max(occ.top, r.bottom);
  };
  take(tourEl);
  if (app.mode === 'simple' && !document.body.classList.contains('panels-hidden')) take(coachEl);
  for (const el of sheetEls) if (el.classList.contains('sheet-open')) take(el);
  return occ;
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

/**
 * 視線の先：1 つ先の旗門（レーサーは常に先を見る）。
 * 以前は「u + 0.9 ターンより先の最初の旗門」に一気に切り替えていたので、
 * 位相 0.69 で頭が 1 フレームに 10° 回っていた（監査 M8 の測定）。
 * いまは切り替え点（旗門の 0.9 ターン手前）の前後 0.2 ターンで、次の旗門へなめらかに移す。
 *   g = 「u + 0.7 ターンより先の最初の旗門」、w = smoothstep(g.u − 1.1, g.u − 0.7, u)（単位はターン）
 *   注視点 = (g の旗) と (その次の旗) を w で混ぜたもの ＋ 法線方向 1 m
 * g が次へ移る瞬間は w = 1 →（新しい g で）w = 0 になり、どちらも「次の旗」を指すので途切れない。
 * 旗門の間隔は u でちょうど 1 ターン（kinematics.js の gates）なので、窓どうしは重ならない。
 */
function lookTarget(u) {
  const hc = model.halfCycle;
  const gs = gatesCache ?? (gatesCache = model.gates(app.gateCount + 3, 0));
  let k = gs.findIndex((x) => x.u > u + 0.7 * hc);
  if (k < 0) k = gs.length - 1;
  const g0 = gs[k], g1 = gs[Math.min(k + 1, gs.length - 1)];
  const w = THREE.MathUtils.smoothstep(u, g0.u - 1.1 * hc, g0.u - 0.7 * hc);
  return g0.turning.clone().lerp(g1.turning, w).addScaledVector(model.N, 1.0);
}

/* ---------- 再生の速さ（起動直後だけ実際の速さ） ---------- */
function startIntro() {
  app.intro = { left: INTRO_TURNS, ease: -1 };
  app.rate = REAL_RATE;
  ui.setRate(REAL_RATE);
}
function updateIntro(dt) {
  const it = app.intro;
  if (!it) return;
  // 途中で止めたら、その場でスローにしておく（再開したときに読めるほうの速さで始める）
  if (!app.playing) { endIntro(); return; }
  if (it.ease < 0) {
    it.left -= model.v * dt * app.rate / model.halfCycle;
    if (it.left <= 0) it.ease = 0;
    return;
  }
  it.ease += dt;
  const k = THREE.MathUtils.smoothstep(it.ease, 0, INTRO_EASE);
  app.rate = REAL_RATE + (app.slowRate - REAL_RATE) * k;
  if (it.ease >= INTRO_EASE) endIntro();
}
function endIntro() {
  if (!app.intro) return;
  app.intro = null;
  setRate(app.slowRate);
}

/** かんたん表示のカード：局面・いま、やること・なぜ・真上から見た向き */
function updateCoach(s) {
  const top = motion.active[0];
  // 局面ごとの指示（motion の cue モード）。動作ガイドの作業がない版では表（PHASES[].cue）を直接読む
  const cue = (motion.mode === 'cue' ? top : null) ?? s.phaseInfo.cue ?? top;
  ui.updateCoach({
    phaseIdx: PHASES.indexOf(s.phaseInfo), phaseName: s.phaseInfo.name,
    text: cue?.text ?? '', why: cue?.why ?? '', hold: !!cue?.hold, sub: cue?.sub ?? null,
    fast: fastPlay(),
  });
  ui.drawCompass(s, ui.coachCtx, { mini: true });
}

function tick() {
  const dt = Math.min(0.05, clock.getDelta());
  resize();
  // DOM を書き換える前に読む（書いた後に読むと、毎フレームレイアウトをやり直させてしまう）
  measureOcclusion();

  updateIntro(dt);
  if (app.playing) {
    app.u += model.v * dt * app.rate;
    const total = model.halfCycle * (app.gateCount - 0.5);
    if (app.u > total) app.u -= total;
  }
  // 止めているときも合わせる（ガイドやキー操作で位相が飛んだとき、つまみと局面の帯がずれないように）。
  // 書き換えるのは値が変わったときだけ
  ui.setPhase((app.u % model.halfCycle) / model.halfCycle);

  const s = model.sample(app.u);
  const look = lookTarget(app.u);
  // 手の基準に使う「少し先の重心」。手はここを追うので運びが連続になる
  const ahead = model.sample(app.u + 0.42);
  skier.update(s, { lookTarget: look, ahead });
  if (app.show.ghost) {
    // 比較用のゴーストは横にずらして「並走」させる
    const gs = ghostModel.sample(app.u);
    ghost.update(gs, { lookTarget: look, ahead: ghostModel.sample(app.u + 0.42) });
    ghost.root.position.add(model.C.clone().multiplyScalar(GHOST_OFFSET));
  }
  course.updateGates(app.u);
  if (app.show.forces) forceView.update(s);
  guides.update(s, skier);
  // 動作ガイド：かんたんは局面ごとの指示、くわしくは少し先の姿勢との差（dt は表示を粘らせる実時間）
  const dPhase = 0.055;
  motion.update(s, model.sample(app.u + model.halfCycle * dPhase), dPhase, skier.state, dt);
  if (app.mode === 'simple') {
    // 隠れているパネルは書き換えない（カードだけ）
    updateCoach(s);
  } else {
    ui.updateDetail(s, {
      hipLead: skier.state.angles.hipLead ?? 0,
      moves: motion.active, movesOn: app.show.moves,
      muscleAct: skier.state.muscleAct, outerSide: skier.state.outerSide, musclesOn: app.show.muscles,
      motions: () => pelvisMotions(s), hip: () => hipMotions(),
    });
  }
  updateLabels(s);

  camRig.update(model, s, skier.state, dt);
  world.update?.(s, camera, { u: app.u, dt, model });
  // 手前のポールが骨盤を横切るときに薄くする（コースの作業で入る。一人称では自分の前の旗なので薄くしない）
  course.updateOcclusion?.(camera, skier.state.anchors.pelvis, camRig.mode !== 'first');
  // 下のカードやシートが下を覆っている間は、絵をその上の空いた所へ寄せる。
  // 一人称は視線の向きそのものなので寄せない（寄せると地平線が上のバーに隠れる）
  const want = camRig.mode === 'first' ? 0 : (occ.bottom - occ.top) / 2;
  viewShift += (want - viewShift) * (1 - Math.exp(-dt * 7));
  if (Math.abs(viewShift) > 0.5) camera.setViewOffset(size.w, size.h, 0, viewShift, size.w, size.h);
  else if (camera.view?.enabled) camera.clearViewOffset();
  renderer.render(scene, camera);
  labels.render(camera, size, camRig.mode === 'first' ? null : skier.state.anchors.pelvis,
                camRig.mode === 'pelvis' ? 130 : (size.w < 820 ? 76 : 96), labelMax(),
                Math.max(54, occ.bottom + 10));
  ui.setLabelKey(labels.shownIO);
  requestAnimationFrame(tick);
}

/* ---------- はじめのガイド ---------- */
function setShow(k, on) { app.show[k] = on; ui.setToggle(k, on); }
const tour = new Tour({
  onStart() {
    // 見る順番を案内するので、初期の表示・うしろから・山回りで止めた状態から始める
    endIntro();
    setShow('forces', false); setShow('angles', false); setShow('moves', true); setShow('ghost', false);
    if (app.view !== 'third') ui.setView('third');
    ui.setCamera('follow'); ui.h.onCamera('follow');
    app.playing = false; ui.setPlaying(false); app.tourHold = true;
    jumpToPhase(0.72);
    applyVisibility();
  },
  onSlow() {
    app.tourSlowed = true;
    setRate(SLOWER_RATE);
    play();
  },
  onPelvis() { ui.setView('pelvis'); },
  onGhost() {
    // 外向・外傾なしの人を横に並べ、上体の傾きの差がいちばん出る山回りで止める（カメラは 1.4 倍引く）
    if (app.view !== 'third') ui.setView('third');
    setShow('ghost', true);
    applyVisibility();
    app.playing = false; ui.setPlaying(false); app.tourHold = true;
    jumpToPhase(0.72);
  },
  onEnd() {
    // ガイドで足した表示は戻す（いちばん情報の多い画面のまま放り出さない）
    if (app.mode === 'simple') { for (const [k, v] of Object.entries(SHOW_SIMPLE)) setShow(k, v); }
    else setShow('ghost', false);
    applyVisibility();          // 比較表示で引いたカメラも戻る
    if (app.tourSlowed) { app.tourSlowed = false; setRate(SLOW_RATE); }
    // ガイドが止めたままなら動かしておく（止まった画面のまま放り出さない）
    if (app.tourHold) play();
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
  if (e.key === ' ' || e.key.startsWith('Arrow')) { app.tourHold = false; endIntro(); }
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
    case 'd': case 'D': setMode(app.mode === 'simple' ? 'detail' : 'simple', true); break;
    case 's': case 'S': {
      endIntro();
      app.discipline = app.discipline === 'SL' ? 'GS' : 'SL';
      document.querySelectorAll('[data-discipline]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b.dataset.discipline === app.discipline)));
      rebuild(true); break;
    }
    case 'f': case 'F':
      // 力のベクトルはくわしく表示だけ（かんたん表示には消すつまみがない）
      if (app.mode !== 'detail') return;
      ui.toggles.forces.checked = !ui.toggles.forces.checked;
      app.show.forces = ui.toggles.forces.checked; applyVisibility(); break;
    case 'h': case 'H': ui.toggleHelp(document.getElementById('help').hidden); break;
    case 'Tab': e.preventDefault(); document.body.classList.toggle('panels-hidden'); break;
    default: return;
  }
});

/* ---------- 起動 ---------- */
// デバッグ／授業用のハンドル（コンソールから触れるように）
window.skiTrainer = { app, get model() { return model; }, get skier() { return skier; },
  get ghost() { return ghost; },
  camRig, ui, scene, renderer, course, motion, tour, labels, guides, forceView, world,
  /** 'simple' | 'detail'（スクリプトから。覚えている設定は書き換えない） */
  setMode(m) { setMode(m, false); },
  /** 'window' | 'racer' | 'xray'（くわしく表示の見え方） */
  setLook(l) { app.look = l; ui.setLook(l); applyVisibility(); },
  /** 視線の先（検査用：頭の向きのなめらかさを測るとき） */
  lookTarget(u) { return lookTarget(u); },
};

try {
  // 中継の視点はカメラの作業（views.js の PRESETS.tv）で入る。この版にまだなければボタンを出さない
  camRig.setPreset('tv');
  ui.setCameraAvailable('tv', camRig.preset === 'tv');
  camRig.setPreset('follow');
  ui.setLevel(app.level);
  ui.setCamera('follow');
  rebuild(true);
  // 見え方（選手｜骨盤を透視｜X線）は身体の作業（skier.setLook）で入る。なければ切り替えを出さない
  ui.setLookAvailable(typeof skier.setLook === 'function');
  applyMode();
  ui.setPlaying(app.playing);
  ui.setRate(app.rate);
  resize();
  // ガイドが出ないときだけ、はじめの 2 ターンを実際の速さで見せる（ガイドは山回りで止めて始めるので）。
  // 最初のフレームより前に決めておく（1 フレームだけスローの表示が出ないように）
  if (!tour.maybeStart()) startIntro();
  tick();
  document.getElementById('loading').classList.add('done');
} catch (err) {
  const e = document.getElementById('error');
  e.hidden = false;
  e.textContent = '初期化に失敗しました:\n' + (err && err.stack ? err.stack : err);
  document.getElementById('loading').classList.add('done');
  throw err;
}
