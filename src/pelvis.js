/**
 * pelvis.js — 解剖学的な骨盤モデル（部位ごとに色分け）
 *
 * ■ 座標系（骨盤ローカル）
 *   +x : 右   +y : 上   +z : 前（骨盤の正面）
 *   原点は左右の股関節中心を結んだ線の中点より少し上（骨盤の中心）。
 *
 * ■ 寛骨（かんこつ）の作り方
 *   寛骨は「腸骨・坐骨・恥骨」が寛骨臼（股関節のソケット）で癒合した 1 つの骨です。
 *   そこで、外側から見た輪郭（ランドマークを結んだ閉曲線）＋ 閉鎖孔（穴）を押し出して
 *   立体にし、あとから 3 方向へねじって実際の形に近づけています。
 *     ・腸骨翼は上へ行くほど外へ開く
 *     ・恥骨は前下方から内側へ回り込み、正中の恥骨結合で合わさる
 *     ・坐骨は下方でやや内側に寄る
 *     ・腸骨の後ろは内側へ回り込み、仙骨と仙腸関節をつくる
 *   色は頂点カラーで塗り分けているので、寛骨臼のまわりでは 3 つの骨が
 *   なめらかに移り変わります（実際に癒合しているため）。
 *
 * ■ 寸法
 *   身長 1.75 m を基準にした実測的な値（寛骨の高さ約 21 cm、上前腸骨棘幅約 24 cm）。
 */
import * as THREE from 'three';
import { BONE_COLORS } from './constants.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/* ================================================================
 * 寛骨の輪郭（右側・外側から見た図）
 *   a = 前方(+) / s = 上方(+)、原点は寛骨臼の中心
 * ================================================================ */
const OUTLINE = [
  ['ASIS',            0.074,  0.076],   // 上前腸骨棘
  ['crest_ant',       0.050,  0.102],   // 腸骨稜（前部）
  ['crest_top',       0.010,  0.114],   // 腸骨結節あたり
  ['crest_post',     -0.036,  0.108],   // 腸骨稜（後部）
  ['PSIS',           -0.072,  0.082],   // 上後腸骨棘
  ['PIIS',           -0.079,  0.048],   // 下後腸骨棘
  ['sciatic_notch',  -0.058,  0.012],   // 大坐骨切痕（へこみ）
  ['ischial_spine',  -0.072, -0.016],   // 坐骨棘
  ['lesser_notch',   -0.062, -0.042],   // 小坐骨切痕
  ['tuber_post',     -0.055, -0.074],   // 坐骨結節（後）
  ['tuber_inf',      -0.036, -0.092],   // 坐骨結節（下）
  ['ischial_ramus',   0.000, -0.098],   // 坐骨枝
  ['pubic_ramus_inf', 0.036, -0.084],   // 恥骨下枝
  ['symph_inf',       0.070, -0.062],   // 恥骨結合（下）
  ['symph_sup',       0.078, -0.038],   // 恥骨結合（上）
  ['pubic_tubercle',  0.068, -0.024],   // 恥骨結節
  ['ramus_sup',       0.056, -0.008],   // 恥骨上枝
  ['acet_ant',        0.046,  0.004],   // 寛骨臼の前縁
  ['AIIS',            0.060,  0.034],   // 下前腸骨棘
  ['spine_notch',     0.058,  0.054],   // ASIS と AIIS の間のくぼみ
];

/* 閉鎖孔（楕円） */
const FORAMEN = { a: 0.012, s: -0.048, ra: 0.032, rs: 0.028, rot: -0.25 };

/** 輪郭をなめらかな閉曲線にして Shape を作る */
function innominateShape() {
  const pts = OUTLINE.map(([, a, s]) => new THREE.Vector2(a, s));
  const curve = new THREE.SplineCurve(pts);
  const smooth = curve.getPoints(120);
  const shape = new THREE.Shape(smooth);
  // 閉じるために始点へ戻す
  shape.closePath();

  const hole = new THREE.Path();
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const a0 = Math.cos(t) * FORAMEN.ra, s0 = Math.sin(t) * FORAMEN.rs;
    const a = FORAMEN.a + a0 * Math.cos(FORAMEN.rot) - s0 * Math.sin(FORAMEN.rot);
    const s = FORAMEN.s + a0 * Math.sin(FORAMEN.rot) + s0 * Math.cos(FORAMEN.rot);
    i ? hole.lineTo(a, s) : hole.moveTo(a, s);
  }
  shape.holes.push(hole);
  return shape;
}

/* 腸骨翼が前後に開く角度（扇のひらき）。実際の骨盤では腸骨翼は
   前方が外、後方が内を向くように約 30° ねじれている。 */
const YAW_MAX = 0.50;   // rad ≒ 29°

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * 側面の輪郭 (a, s) と厚み t を、実際の寛骨の立体へ写す。
 * 戻り値は寛骨臼中心を原点とした (x = 外側, y = 上, z = 前)。
 * ※ ランドマークの位置計算にも同じ関数を使うので、ラベルと形が必ず一致する。
 */
function warpInnominate(a, s, t) {
  const upW = smoothstep(-0.020, 0.030, s);
  const bladeH = Math.max(0, s - 0.005);

  // 1) 腸骨翼のねじれ（前が外、後ろが内へ開く扇）
  const yaw = YAW_MAX * clamp01((s - 0.005) / 0.090) * upW;
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  let X = t * ca + a * sa;
  let A = -t * sa + a * ca;

  // 2) 腸骨翼の外面はふくらんだ曲面（内面は腸骨窩のくぼみ）
  const across = THREE.MathUtils.clamp(A / 0.060, -1, 1);
  X += upW * 0.39 * bladeH * (1 - across * across);

  // 3) 腸骨の後部は仙骨へ向かって内側へ（仙腸関節）
  X -= upW * 0.80 * Math.max(0, -A - 0.020);

  // 4) 恥骨は前下方から内側へ回り込み、正中の恥骨結合で合わさる
  X -= (1 - upW) * 1.85 * Math.pow(Math.max(0, A - 0.005), 1.15);
  // 5) 坐骨は下方でやや内側へ
  X -= (1 - upW) * 0.68 * Math.max(0, -A - 0.005) * 0.9;
  X -= (1 - upW) * 0.32 * Math.max(0, -s - 0.030);

  return { x: X, y: s, z: A };
}

/** 厚み（部位で変える）：腸骨稜と坐骨結節は厚く、腸骨翼は薄い */
function thicknessAt(s) {
  const blade = Math.max(0, s - 0.005);
  let th = 0.55 + 0.45 * (1 - Math.min(1, blade * 10));
  if (s > 0.090) th *= 1.5;
  if (s < -0.055) th *= 1.15;
  return th;
}

/** 側面の輪郭上の点（名前つき）を立体に写した位置 */
export function innominateLandmark(name, S = 1) {
  const row = OUTLINE.find((r) => r[0] === name);
  if (!row) return null;
  const [, a, s] = row;
  const p = warpInnominate(a, s, 0.011 * thicknessAt(s));
  return new THREE.Vector3(p.x * S, p.y * S, p.z * S);
}

/**
 * 大きな三角形を分割して面をなめらかにする（立体化の前に行う）。
 * 押し出した面は内部の三角形が粗いので、そのまま曲げると折れ線が目立つ。
 */
function subdivideLarge(geo, maxEdge, passes = 3) {
  let pos = (geo.index ? geo.toNonIndexed() : geo).attributes.position.array;
  for (let p = 0; p < passes; p++) {
    const out = [];
    let split = 0;
    for (let i = 0; i < pos.length; i += 9) {
      const A = [pos[i], pos[i + 1], pos[i + 2]];
      const B = [pos[i + 3], pos[i + 4], pos[i + 5]];
      const C = [pos[i + 6], pos[i + 7], pos[i + 8]];
      const d = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
      if (Math.max(d(A, B), d(B, C), d(C, A)) <= maxEdge) {
        out.push(...A, ...B, ...C);
        continue;
      }
      split++;
      const m = (u, v) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2];
      const AB = m(A, B), BC = m(B, C), CA = m(C, A);
      out.push(...A, ...AB, ...CA, ...AB, ...B, ...BC, ...CA, ...BC, ...C, ...AB, ...BC, ...CA);
    }
    pos = new Float32Array(out);
    if (!split) break;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return g;
}

/**
 * 寛骨のジオメトリ。
 * 押し出した板を warpInnominate で立体にし、部位の重み（腸骨/坐骨/恥骨）を持たせる。
 */
const GEO_CACHE = new Map();

/** 同じ身長・同じ側のジオメトリは使い回す（スキーヤー生成のたびに作らない） */
function innominateGeometryCached(S, side) {
  const key = S.toFixed(4) + ':' + side;
  let g = GEO_CACHE.get(key);
  if (!g) { g = innominateGeometry(S, side); GEO_CACHE.set(key, g); }
  // 色は個体ごとに違うので、色属性だけ複製する
  const clone = g.clone();
  clone.userData.weights = g.userData.weights;
  return clone;
}

function innominateGeometry(S, side) {
  const raw = new THREE.ExtrudeGeometry(innominateShape(), {
    depth: 0.011, bevelEnabled: true, bevelThickness: 0.0032,
    bevelSize: 0.0032, bevelSegments: 2, curveSegments: 3,
  });
  // 立体化で曲げるので、先に面を細かくしておく
  const geo = subdivideLarge(raw, 0.011, 4);
  raw.dispose();
  // (a, s, t) → (x = t, y = s, z = a)
  geo.rotateY(-Math.PI / 2);
  geo.scale(-1, 1, 1);

  const pos = geo.attributes.position;
  const w = { ilium: [], ischium: [], pubis: [] };

  for (let i = 0; i < pos.count; i++) {
    const t = pos.getX(i);          // 厚み方向（外側が +）
    const s = pos.getY(i);          // 上下
    const a = pos.getZ(i);          // 前後

    /* 部位の重み（寛骨臼のまわりでなめらかに移る） */
    const up = smoothstep(-0.020, 0.002, s);
    const front = smoothstep(0.002, 0.020, a);
    w.ilium.push(up);
    w.pubis.push((1 - up) * front);
    w.ischium.push((1 - up) * (1 - front));

    const p = warpInnominate(a, s, t * thicknessAt(s));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  geo.computeVertexNormals();

  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3));
  geo.userData.weights = w;
  geo.scale(S, S, S);
  if (side < 0) geo.scale(-1, 1, 1);     // 左側は鏡像
  return geo;
}

/** 輪郭の一部（名前の並び）を立体に写した点列を返す */
function landmarkPath(names, S, side, t = 0.006) {
  return names.map((n) => {
    const row = OUTLINE.find((r) => r[0] === n);
    const p = warpInnominate(row[1], row[2], t * thicknessAt(row[2]));
    return new THREE.Vector3(p.x * S * side, p.y * S, p.z * S);
  });
}

/** 点列に沿った丸い隆起（腸骨稜など） */
function ridgeTube(points, radius, seg = 40) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, seg, radius, 10, false);
}

/** 部位の重みから頂点カラーを塗る */
function paintRegions(geo, colors) {
  const w = geo.userData.weights;
  const col = geo.attributes.color;
  const c = new THREE.Color();
  for (let i = 0; i < col.count; i++) {
    const wi = w.ilium[i], ws = w.ischium[i], wp = w.pubis[i];
    c.setRGB(
      colors.ilium.r * wi + colors.ischium.r * ws + colors.pubis.r * wp,
      colors.ilium.g * wi + colors.ischium.g * ws + colors.pubis.g * wp,
      colors.ilium.b * wi + colors.ischium.b * ws + colors.pubis.b * wp,
    );
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

/** 仙骨：上が広く下が細い、前に凹んだくさび */
function sacrumGeometry(S) {
  const nu = 14, nv = 12, pos = [], idx = [];
  const P = (u, v) => {
    // u: 上(0) → 下(1)、v: 左(0) → 右(1)
    const y = 0.048 - 0.155 * u;
    const zc = -0.032 - 0.030 * u - 0.030 * u * u;      // 下へ行くほど後ろへ反る
    const halfW = (0.054 - 0.044 * u) * (1 - 0.15 * u * u);
    const x = (v - 0.5) * 2 * halfW;
    const k = (v - 0.5) * 2;
    const hollow = 0.020 * (1 - k * k) * (1 - 0.4 * u);  // 前面のくぼみ
    return V3(x, y, zc + hollow);
  };
  const grid = [];
  for (let i = 0; i <= nu; i++) {
    grid[i] = [];
    for (let j = 0; j <= nv; j++) grid[i][j] = P(i / nu, j / nv);
  }
  const thick = 0.026;
  const push = (p) => { pos.push(p.x * S, p.y * S, p.z * S); return pos.length / 3 - 1; };
  const front = [], back = [];
  for (let i = 0; i <= nu; i++) {
    front[i] = []; back[i] = [];
    for (let j = 0; j <= nv; j++) {
      const p = grid[i][j];
      const d = thick * (0.5 - 0.25 * (i / nu));
      front[i][j] = push(V3(p.x, p.y, p.z + d));
      back[i][j] = push(V3(p.x, p.y, p.z - d));
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    idx.push(front[i][j], front[i + 1][j], front[i + 1][j + 1]);
    idx.push(front[i][j], front[i + 1][j + 1], front[i][j + 1]);
    idx.push(back[i][j], back[i + 1][j + 1], back[i + 1][j]);
    idx.push(back[i][j], back[i][j + 1], back[i + 1][j + 1]);
  }
  const rim = (a, b, c, d) => { idx.push(a, b, c); idx.push(a, c, d); };
  for (let i = 0; i < nu; i++) {
    rim(front[i][0], back[i][0], back[i + 1][0], front[i + 1][0]);
    rim(front[i + 1][nv], back[i + 1][nv], back[i][nv], front[i][nv]);
  }
  for (let j = 0; j < nv; j++) {
    rim(front[0][j + 1], back[0][j + 1], back[0][j], front[0][j]);
    rim(front[nu][j], back[nu][j], back[nu][j + 1], front[nu][j + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function boneMat(hex, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: hex, roughness: 0.52, metalness: 0.02,
    emissive: new THREE.Color(hex).multiplyScalar(0.10), ...opts,
  });
}

/* ================================================================ */
export function createPelvis(height = 1.75) {
  const S = height / 1.75;
  const group = new THREE.Group();
  group.name = 'pelvis';

  const W = 0.092 * S;          // 股関節中心の左右半幅
  const HIP = V3(W, -0.040 * S, 0.004 * S);   // 右股関節中心（＝寛骨臼の中心）

  const colors = {
    ilium: new THREE.Color(BONE_COLORS.iliumOuter.hex),
    iliumIn: new THREE.Color(BONE_COLORS.iliumInner.hex),
    ischium: new THREE.Color(BONE_COLORS.ischium.hex),
    pubis: new THREE.Color(BONE_COLORS.pubis.hex),
  };

  const mats = {
    hipR: new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.48, metalness: 0.02, side: THREE.DoubleSide,
      emissive: 0x1c2330, emissiveIntensity: 1,
    }),
    hipL: new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.48, metalness: 0.02, side: THREE.DoubleSide,
      emissive: 0x1c2330, emissiveIntensity: 1,
    }),
    sacrum: boneMat(BONE_COLORS.sacrum.hex, { side: THREE.DoubleSide }),
    sacrumDark: boneMat(0xb07d00, { roughness: 0.7 }),
    crestR: boneMat(BONE_COLORS.iliumOuter.hex),
    crestL: boneMat(BONE_COLORS.iliumInner.hex),
    acetabulum: boneMat(0xb4c2d4, { roughness: 0.55, side: THREE.DoubleSide,
      transparent: true, opacity: 0.55, depthWrite: false }),
    asis: new THREE.MeshStandardMaterial({
      color: BONE_COLORS.asis.hex, roughness: 0.35,
      emissive: new THREE.Color(BONE_COLORS.asis.hex).multiplyScalar(0.5),
    }),
  };

  const parts = { hip: [], sacrum: [], asis: [] };
  const crestMeshes = {};
  const geos = {};
  const hips = {};

  /* ---- 寛骨（左右） ---- */
  // ローカル +x は身体の「左」側（three.js のオブジェクトは +Z を向くため）
  for (const side of [1, -1]) {
    const key = side > 0 ? 'L' : 'R';
    const geo = innominateGeometryCached(S, side);
    geos[key] = geo;
    const mesh = new THREE.Mesh(geo, side > 0 ? mats.hipR : mats.hipL);
    mesh.name = 'innominate_' + key;
    mesh.position.set(side * W, HIP.y, HIP.z);
    group.add(mesh);
    parts.hip.push(mesh);
    hips[key] = mesh;

    /* 寛骨臼（ソケット）：外向きの半球 */
    // 寛骨臼は完全な球ではなく、下側に切れ込み（寛骨臼切痕）がある馬蹄形
    const cup = new THREE.Mesh(
      new THREE.SphereGeometry(0.030 * S, 28, 16, Math.PI * 0.18, Math.PI * 1.64,
        0, Math.PI * 0.54),
      mats.acetabulum);
    cup.position.set(side * (W + 0.004 * S), HIP.y, HIP.z);
    cup.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(cup);

    /* 腸骨稜：太い縁の隆起（ここに手が当たる「腰骨」） */
    const crestGeo = ridgeTube(
      landmarkPath(['ASIS', 'crest_ant', 'crest_top', 'crest_post', 'PSIS'], S, side),
      0.009 * S);
    const crest = new THREE.Mesh(crestGeo, side > 0 ? mats.crestL : mats.crestR);
    crest.name = 'crest_' + key;
    crest.position.set(side * W, HIP.y, HIP.z);
    group.add(crest);
    crestMeshes[key] = crest;

    /* 坐骨棘（骨盤の内側に突き出す小さな棘） */
    const spineLM = innominateLandmark('ischial_spine', S);
    const ischialSpine = new THREE.Mesh(
      new THREE.SphereGeometry(0.010 * S, 12, 10), mats.ischium);
    ischialSpine.scale.set(1, 1.3, 0.7);
    ischialSpine.position.set(side * (W + spineLM.x - 0.004 * S), HIP.y + spineLM.y, HIP.z + spineLM.z);
    group.add(ischialSpine);

    /* 恥骨結節（下腹部で触れる出っぱり） */
    const tubLM = innominateLandmark('pubic_tubercle', S);
    const pubicTub = new THREE.Mesh(
      new THREE.SphereGeometry(0.009 * S, 12, 10), mats.pubis);
    pubicTub.position.set(side * (W + tubLM.x), HIP.y + tubLM.y, HIP.z + tubLM.z);
    group.add(pubicTub);

    /* ASIS（上前腸骨棘）マーカー：立体化したあとの実際の位置に置く */
    const lm = innominateLandmark('ASIS', S);
    const asis = new THREE.Mesh(new THREE.SphereGeometry(0.0135 * S, 16, 12), mats.asis);
    asis.position.set(side * (W + lm.x), HIP.y + lm.y, HIP.z + lm.z);
    group.add(asis);
    parts.asis.push(asis);
  }

  /* ---- 仙骨・尾骨 ---- */
  const sacrum = new THREE.Mesh(sacrumGeometry(S), mats.sacrum);
  sacrum.name = 'sacrum';
  group.add(sacrum);
  parts.sacrum.push(sacrum);

  /* 正中仙骨稜（背面のとげとげした隆起）と前仙骨孔（4 対の穴） */
  const crestPts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    crestPts.push(new THREE.Vector3(0, (0.044 - 0.150 * t) * S,
      (-0.036 - 0.030 * t - 0.030 * t * t) * S));
  }
  const sacralCrest = new THREE.Mesh(
    ridgeTube(crestPts, 0.007 * S, 24), mats.sacrumDark);
  sacralCrest.name = 'sacralCrest';
  group.add(sacralCrest);
  parts.sacrum.push(sacralCrest);

  for (let i = 0; i < 4; i++) {
    const t = 0.13 + i * 0.20;
    const y = (0.044 - 0.150 * t) * S;
    const z = (-0.030 - 0.030 * t - 0.030 * t * t) * S;
    const halfW = (0.054 - 0.044 * t) * (1 - 0.15 * t * t) * S;
    for (const sx of [1, -1]) {
      const hole = new THREE.Mesh(
        new THREE.SphereGeometry(0.0062 * S, 10, 8), mats.sacrumDark);
      hole.scale.set(1, 1.15, 0.5);
      hole.position.set(sx * halfW * 0.52, y, z + 0.012 * S);
      group.add(hole);
      parts.sacrum.push(hole);
    }
  }

  const coccyx = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.009 * S, 0.026 * S, 4, 8), mats.sacrum);
  coccyx.position.set(0, -0.118 * S, -0.094 * S);
  coccyx.rotation.x = -0.5;
  group.add(coccyx);
  parts.sacrum.push(coccyx);

  /* ---- ASIS を結ぶ線（骨盤の正面を示す基準線） ---- */
  const asisLM = innominateLandmark('ASIS', S);
  const asisY = HIP.y + asisLM.y, asisZ = HIP.z + asisLM.z;
  const asisLine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0038 * S, 0.0038 * S, (W + asisLM.x) * 2, 8),
    new THREE.MeshBasicMaterial({ color: BONE_COLORS.asis.hex, transparent: true, opacity: 0.9 }));
  asisLine.rotation.z = Math.PI / 2;
  asisLine.position.set(0, asisY, asisZ);
  group.add(asisLine);

  /* ---- 骨盤の正面を示す矢印 ---- */
  const facing = new THREE.Group();
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0x4cc3ff });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0035 * S, 0.0035 * S, 0.15 * S, 10), arrowMat);
  shaft.position.set(0, 0, 0.145 * S); shaft.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.012 * S, 0.042 * S, 14), arrowMat);
  tip.position.set(0, 0, 0.241 * S); tip.rotation.x = Math.PI / 2;
  facing.add(shaft, tip);
  facing.position.set(0, -0.010 * S, 0.02 * S);
  group.add(facing);

  /* ---- ラベルのアンカー（骨盤ローカル座標） ---- */
  const labels = [
    { key: 'crest', name: '腸骨稜', pos: (() => { const c = innominateLandmark('crest_top', S); return V3(W + c.x + 0.010 * S, HIP.y + c.y + 0.012 * S, HIP.z + c.z); })() },
    { key: 'asis', name: '上前腸骨棘（ASIS）', pos: V3(W + asisLM.x + 0.012 * S, asisY + 0.010 * S, asisZ + 0.012 * S) },
    { key: 'sacrum', name: '仙骨', pos: V3(0, HIP.y + 0.050 * S, -0.070 * S) },
    { key: 'acetabulum', name: '寛骨臼（股関節のソケット）', pos: V3(W + 0.048 * S, HIP.y + 0.010 * S, HIP.z) },
    { key: 'trochanter', name: '大転子', pos: V3(W + 0.075 * S, HIP.y - 0.030 * S, HIP.z) },
    { key: 'ischium', name: '坐骨結節', pos: (() => { const c = innominateLandmark('tuber_inf', S); return V3(W + c.x, HIP.y + c.y - 0.014 * S, HIP.z + c.z); })() },
    { key: 'pubis', name: '恥骨結合', pos: V3(0, HIP.y - 0.058 * S, HIP.z + 0.062 * S) },
    { key: 'foramen', name: '閉鎖孔', pos: V3(W * 0.62, HIP.y - 0.050 * S, HIP.z + 0.022 * S) },
  ];

  /* 初期配色 */
  const applyColors = (outerIsRight) => {
    mats.crestR.color.set(outerIsRight ? BONE_COLORS.iliumOuter.hex : BONE_COLORS.iliumInner.hex);
    mats.crestL.color.set(outerIsRight ? BONE_COLORS.iliumInner.hex : BONE_COLORS.iliumOuter.hex);
    mats.crestR.emissive.copy(mats.crestR.color).multiplyScalar(0.10);
    mats.crestL.emissive.copy(mats.crestL.color).multiplyScalar(0.10);
    paintRegions(geos.R, {
      ilium: outerIsRight ? colors.ilium : colors.iliumIn,
      ischium: colors.ischium, pubis: colors.pubis,
    });
    paintRegions(geos.L, {
      ilium: outerIsRight ? colors.iliumIn : colors.ilium,
      ischium: colors.ischium, pubis: colors.pubis,
    });
  };
  let lastOuter = null;
  applyColors(true); lastOuter = true;

  return {
    group, parts, labels, facing, asisLine, hipHalfWidth: W, scale: S,

    /** ターン外側の腸骨を強調色（赤）にする */
    setOuterSide(outerIsRight) {
      if (outerIsRight === lastOuter) return;
      lastOuter = outerIsRight;
      applyColors(outerIsRight);
    },

    /** ラベルのアンカーをワールド座標で返す */
    labelPoints() {
      group.updateWorldMatrix(true, false);
      return labels.map((l) => ({
        key: l.key, name: l.name,
        pos: l.pos.clone().applyMatrix4(group.matrixWorld),
      }));
    },

    setOpacity(o) {
      for (const m of Object.values(mats)) {
        const t = o < 1;
        if (m.transparent !== t) m.needsUpdate = true;
        m.transparent = t; m.opacity = o; m.depthWrite = o > 0.85;
      }
    },
  };
}
