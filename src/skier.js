/**
 * skier.js — スキーヤーのリグ（骨格・身体・スキー）と姿勢計算
 *
 * 姿勢の決め方
 *   1. kinematics が「接雪点 → 重心」の向き uLeg と、脚の傾き φ_leg、上体の傾き φ_torso を返す
 *   2. 骨盤の上下軸は脚と上体の中間（外傾の約 2/3 が股関節、1/3 が腰椎という配分）
 *   3. 骨盤の向き（ヨー）はスキーの進行方向から外向角ぶん外側へ回す ← これが「外向」
 *   4. 足位置は雪面上で決まっているので、股関節から足首まで 2 リンク IK で膝を求める
 *   5. Dempster の質量比で実際の重心を計算し、力学的な重心とのずれを<b>腰の位置</b>で吸収する
 *      （スキーと足は雪面に置いたまま。全体を平行移動すると板が雪に埋まる）
 */
import * as THREE from 'three';
import { ANTHRO, SEGMENT_MASS, BONE_COLORS } from './constants.js';
import { createPelvis } from './pelvis.js';
import { createLegBones } from './leg.js';
import { createTorso } from './torso.js';
import { createBody, createSkinMaterial, createHeadGear } from './body.js';
import { createSuitMaterial, updateSuitWindow } from './suit.js';
import { createMuscles, MUSCLES } from './muscles.js';
import { computeMuscleLoad, applyMuscleActivation } from './biomech.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/* 椎骨に分散した側屈が「腰→肩の線」に出てくる割合の逆数（実測で調整） */
const SPINE_LAT_GAIN = 2.4;
/* 骨盤の前傾 [deg]（斜面法線から前へ）：切り替えで浅く、荷重が乗るほど深く */
const PELVIS_TILT0 = 10, PELVIS_TILT1 = 18;
/* 骨盤の上での上体の前傾 [deg] と、骨盤の前傾を打ち消す割合 */
const LUMBAR0 = 6, LUMBAR1 = 10, LUMBAR_COMP = 0.80;
/* 骨盤から見た仙骨の前傾（torso.js と同じ値） */
const SACRAL_SLOPE = 28.6 * Math.PI / 180;
const rad = (d) => d * Math.PI / 180;

/* 重心合わせで腰を動かすときの倍率。脚（質量の約 32 %）は足を雪面に残したまま
 * 一部しか動かないので、重心を 1 動かすには腰を 1 より少し多く動かす必要がある。 */
const HIP_SHIFT_GAIN = 1.3;
/* 腰の前後の補正の上限 [m]（調整値）。これより大きく腰を引くと「腰が引けた」形になる */
const HIP_SHIFT_FORE_MAX = 0.13;
/* 雪面（course.snow）は斜面の基準面より 1 cm 下にある */
const SNOW_N = -0.010;
/* 板の裏のいちばん低い点をどこに置くか（雪面より 1 mm 上。同じ高さだと面がちらつく） */
const SKI_BASE_N = SNOW_N + 0.001;
/* ブーツの底（ビンディングの上面）の高さ [m]。gear.js の板は userData.standHeight で上書きする */
const STAND_DEFAULT = 0.030;
/* ブーツの底から足関節中心まで [m] */
const SOLE_TO_ANKLE = 0.085;
/* ストックの長さ（グリップ〜先端）：身長 × 0.66。
 * 一般的な目安（身長 × 0.66〜0.70、SL は少し短め）による値で、規定や計測で確かめたものではない。 */
const POLE_LEN_RATIO = 0.66;
/* 頭のひねり（胸の正面に対するヨー）の上限 */
const HEAD_YAW_KNEE = rad(35), HEAD_YAW_MAX = rad(45);

/* ------------------------------------------------------------------ */
/* 汎用パーツ                                                          */
/* ------------------------------------------------------------------ */

/** 2 点間に伸びる円柱（骨・四肢に使用） */
function makeLink(material, radius, taper = 1) {
  const geo = new THREE.CylinderGeometry(radius * taper, radius, 1, 12, 1, true);
  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.set = (a, b) => {
    const d = b.clone().sub(a);
    const len = d.length() || 1e-4;
    mesh.position.copy(a).addScaledVector(d, 0.5);
    mesh.scale.set(1, len, 1);
    mesh.quaternion.setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
  };
  return mesh;
}

function makeBall(material, radius) {
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
}

/**
 * 2 リンク IK：根本 a、先端 b、長さ l1/l2、hint 方向へ関節を曲げる
 */
function solveIK(a, b, l1, l2, hint) {
  const ab = b.clone().sub(a);
  let d = ab.length();
  const max = (l1 + l2) * 0.999, min = Math.abs(l1 - l2) * 1.001 + 1e-4;
  d = THREE.MathUtils.clamp(d, min, max);
  const dir = ab.clone().normalize();
  const x = (d * d + l1 * l1 - l2 * l2) / (2 * d);          // 根本から関節までの投影長
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));         // 横方向のオフセット
  let perp = hint.clone().sub(dir.clone().multiplyScalar(hint.dot(dir)));
  if (perp.lengthSq() < 1e-8) {
    perp = new THREE.Vector3(0, 1, 0).cross(dir);
    if (perp.lengthSq() < 1e-8) perp = new THREE.Vector3(1, 0, 0);
  }
  perp.normalize();
  return a.clone().addScaledVector(dir, x).addScaledVector(perp, h);
}

/**
 * base を axis まわりに回し、target 方向へ angle だけ倒す。
 * angle が負なら target と逆向きへ倒す。
 */
function rotateToward(base, target, axis, angle) {
  const eps = 1e-3;
  const probe = base.clone().applyAxisAngle(axis, eps);
  const sign = probe.dot(target) > base.dot(target) ? 1 : -1;
  return base.clone().applyAxisAngle(axis, sign * angle);
}

/** なめらかな上限：|x| が max を超えないよう tanh で寄せる（境界で折れない） */
const softLimit = (x, max) => max * Math.tanh(x / max);

/**
 * なめらかな角度の上限。knee までは素通しにして、その先を tanh で max へ寄せる。
 * 1 階微分まで連続なので、上限に入る瞬間に首がカクッと止まらない。
 */
function softClampAngle(x, knee, max) {
  const ax = Math.abs(x);
  if (ax <= knee) return x;
  return Math.sign(x) * (knee + (max - knee) * Math.tanh((ax - knee) / (max - knee)));
}

/** 線分 p0-p1 と q0-q1 の最近点（[線分 p 上の点, 線分 q 上の点]） */
function closestSegSeg(p0, p1, q0, q1) {
  const d1 = p1.clone().sub(p0), d2 = q1.clone().sub(q0), r = p0.clone().sub(q0);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r);
  let sP = 0, tQ = 0;
  if (a > 1e-9 && e > 1e-9) {
    const c = d1.dot(r), b = d1.dot(d2), den = a * e - b * b;
    sP = den > 1e-9 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
    tQ = (b * sP + f) / e;
    if (tQ < 0) { tQ = 0; sP = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else if (tQ > 1) { tQ = 1; sP = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
  }
  return [p0.clone().addScaledVector(d1, sP), q0.clone().addScaledVector(d2, tQ)];
}

/* ------------------------------------------------------------------ */
/* 用具（gear.js に置き換える前提の簡易版）                            */
/*   呼び出し側は userData のセッター（setRole / setShank / setPose）を */
/*   通して動かすので、同じ形の関数を差し替えれば作り直しはいらない。   */
/* ------------------------------------------------------------------ */
function makeSki(len, waist, shoulder, tail, color) {
  const half = len / 2;
  // 形状はローカル座標 (x = 幅, y = −板の長さ) で作り、
  // rotateX(-90°) で「+Z が前・+Y が上」に直す
  const pts = [];
  const N = 30;
  for (let i = 0; i <= N; i++) {
    const t = i / N;                       // 0: テール → 1: トップ
    const z = -half + len * t;
    // サイドカット：テール幅 → ウエスト（中央）→ トップ幅
    const edge = t < 0.5
      ? THREE.MathUtils.lerp(tail, waist, Math.sin(t * Math.PI))
      : THREE.MathUtils.lerp(waist, shoulder, Math.sin((t - 0.5) * Math.PI));
    let w = edge / 2;
    if (t > 0.94) w *= (1 - t) / 0.06 * 0.75 + 0.25;   // トップを丸める
    if (t < 0.03) w *= t / 0.03 * 0.6 + 0.4;
    pts.push([z, w]);
  }
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][1], -pts[0][0]);
  for (const [z, w] of pts) shape.lineTo(w, -z);
  for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(-pts[i][1], -pts[i][0]);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);          // 長手 → +Z、厚み → +Y
  // トップとテールを反らせる
  const rise = (z) => {
    const tTip = Math.max(0, (z - half * 0.70) / (half * 0.30));
    const tTail = Math.max(0, (-z - half * 0.84) / (half * 0.16));
    return 0.075 * tTip * tTip + 0.020 * tTail * tTail;
  };
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + rise(pos.getZ(i)));
  geo.computeVertexNormals();

  const ski = new THREE.Group();
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color, roughness: 0.32, metalness: 0.25, side: THREE.DoubleSide,
  }));
  ski.add(body);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(waist * 1.3, 0.020, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x1b2634, roughness: 0.6 }));
  plate.position.set(0, 0.026, 0.01);
  ski.add(plate);
  ski.userData.mat = body.material;
  ski.userData.mats = [body.material, plate.material];
  ski.userData.standHeight = STAND_DEFAULT;
  // 板の裏の縁（ローカル座標）。雪面にいちばん近い点を探すのに使う
  const outline = [];
  for (const [z, w] of pts) outline.push(w, rise(z), z, -w, rise(z), z);
  ski.userData.baseOutline = new Float32Array(outline);
  return ski;
}

/**
 * スキーブーツ。箱ひとつだと「板の上に載った四角」にしか見えないので、
 * ソール・ロアシェル・カフ（前傾したすねの筒）・バックルに分ける。
 * ローカル軸はスキーと同じ x=横・y=上・z=前で、原点はソール下面。
 * 3 番目の引数（すねのガードなど）は gear.js 版で使う。
 */
function makeBoot(shellMat, buckleMat) {
  const g = new THREE.Group();
  const add = (geo, mat, [x, y, z], rx = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true;
    g.add(m); return m;
  };
  // ソール（ビンディングに噛む板。前後にコバが出る）
  add(new THREE.BoxGeometry(0.104, 0.020, 0.308), shellMat, [0, 0.010, 0]);
  // ロアシェル（足を包む部分。つま先へ向かって低く細くなる）
  add(new THREE.BoxGeometry(0.098, 0.085, 0.250), shellMat, [0, 0.062, -0.006]);
  add(new THREE.BoxGeometry(0.086, 0.052, 0.090), shellMat, [0, 0.042, 0.118]);
  // カフ（すねを包む筒。前傾角ぶん傾いている）
  add(new THREE.BoxGeometry(0.092, 0.150, 0.115), shellMat, [0, 0.168, -0.028], 0.30);
  // バックル 4 個（外側に並ぶ）
  for (let i = 0; i < 4; i++) {
    const y = 0.048 + i * 0.056, z = 0.052 - i * 0.026;
    add(new THREE.BoxGeometry(0.106, 0.014, 0.030), buckleMat, [0, y, z], i >= 2 ? 0.30 : 0);
  }
  g.userData.mats = [shellMat, buckleMat];
  return g;
}

/** グローブ（簡易版）：前腕の向きにのばした楕円体 */
function makeGlove(mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
  m.scale.set(0.038, 0.042, 0.062);
  m.castShadow = true;
  m.userData.mats = [mat];
  /** @param hand 手首の位置 @param poleDir ストックの向き @param forearmDir 肘→手 */
  m.userData.setPose = (hand, poleDir, forearmDir) => {
    m.position.copy(hand).addScaledVector(forearmDir, 0.026);
    m.quaternion.setFromUnitVectors(V(0, 0, 1), forearmDir);
  };
  return m;
}

/** ストック（簡易版）：グリップから先端までの 1 本の円柱 */
function makePole(disc, mat) {
  const g = new THREE.Group();
  const shaft = makeLink(mat, 0.008);
  g.add(shaft);
  g.userData.shaft = shaft;
  g.userData.mats = [mat];
  /** @param grip 握り @param dir 先端への向き（単位） @param len 長さ @param towardBody 身体へ向く単位ベクトル */
  g.userData.setPose = (grip, dir, len) => {
    shaft.userData.set(grip, grip.clone().addScaledVector(dir, len));
  };
  return g;
}

/* ------------------------------------------------------------------ */
/* スキーヤー本体                                                      */
/* ------------------------------------------------------------------ */
export function createSkier(opts = {}) {
  const height = opts.height ?? ANTHRO.height;
  const disc = opts.discipline;
  const H = height;
  const S = H / 1.75;
  const seg = {
    thigh: ANTHRO.thigh * H,
    shank: ANTHRO.shank * H,
    trunk: ANTHRO.trunk * H,
    upperArm: ANTHRO.upperArm * H,
    foreArm: ANTHRO.foreArm * H,
    headR: ANTHRO.headR * H,
    shoulderW: ANTHRO.shoulderW * H,
  };
  const POLE_LEN = POLE_LEN_RATIO * H;
  /* SL は外側の手で旗門を払う（クロスブロック）。GS は内側の肩と腕でパネルをよける */
  const crossBlock = disc.key === 'SL';

  const root = new THREE.Group();
  root.name = 'skier';

  /* --- マテリアル --- */
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xe8eef7, roughness: 0.5 });
  // 下肢の骨は骨盤ビューでも見せたいので別マテリアルにする
  const legMat = new THREE.MeshStandardMaterial({ color: 0xeef3fa, roughness: 0.45 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0xc7d4e4, roughness: 0.45 });
  const skinMat = createSkinMaterial(0x7799c6, 0.36);
  const gearMat = new THREE.MeshStandardMaterial({ color: 0x27354a, roughness: 0.55 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf2f6fb, roughness: 0.18, metalness: 0.1 });

  /* --- 骨格グループ --- */
  const skeleton = new THREE.Group(); skeleton.name = 'skeleton'; root.add(skeleton);
  const bodyG = new THREE.Group(); bodyG.name = 'body'; root.add(bodyG);
  const gearG = new THREE.Group(); gearG.name = 'gear'; root.add(gearG);

  /* 骨盤。骨格グループには入れない：「骨格」を消しても骨盤は残したいので。
     毎フレーム置き直すので、親が root でも skeleton でも位置は同じ。 */
  const pelvis = createPelvis(H);
  const pelvisNode = new THREE.Group();
  pelvisNode.name = 'pelvisNode';
  pelvisNode.add(pelvis.group);
  root.add(pelvisNode);

  /* 体幹：椎骨 24 個・肋骨 12 対・胸骨・鎖骨・肩甲骨 */
  const spineMat = new THREE.MeshStandardMaterial({ color: BONE_COLORS.spine.hex, roughness: 0.5 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x8fa8c4, roughness: 0.75 });
  const torso = createTorso(H, spineMat, discMat);
  skeleton.add(torso.group);

  /* 下肢：大腿骨・膝蓋骨・脛骨・腓骨（解剖学的な形） */
  const legs = { L: createLegBones(H, -1, legMat), R: createLegBones(H, 1, legMat) };
  skeleton.add(legs.L.group, legs.R.group);
  const kneePos = { L: new THREE.Vector3(), R: new THREE.Vector3() };

  /* 上肢の骨 */
  const humerus = { L: makeLink(boneMat, 0.017), R: makeLink(boneMat, 0.017) };
  const ulna = { L: makeLink(boneMat, 0.014), R: makeLink(boneMat, 0.014) };
  const elbow = { L: makeBall(jointMat, 0.023), R: makeBall(jointMat, 0.023) };
  const shoulderB = { L: makeBall(jointMat, 0.028), R: makeBall(jointMat, 0.028) };
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), boneMat);
  skull.scale.set(0.072 * S, 0.104 * S, 0.090 * S);
  for (const s of ['L', 'R']) {
    skeleton.add(humerus[s], ulna[s], elbow[s], shoulderB[s]);
  }
  skeleton.add(skull);
  const armBones = [humerus.L, humerus.R, ulna.L, ulna.R, elbow.L, elbow.R, shoulderB.L, shoulderB.R];

  /* 身体：骨盤と椎骨にぶら下げた輪切りの列として作る。
     骨盤が回り、腰椎が曲がり、胸椎がひねれば、表面もそのとおりに変形する。
     ふだんは不透明のスーツ（骨盤のまわりだけ透視窓）、X 線表示では半透明の皮膚。 */
  const body = createBody(H, skinMat, { pelvis: pelvisNode, verts: torso.verts }, { disc: disc.key });
  bodyG.add(body.group);
  const suitMat = createSuitMaterial({ vertexColors: !!body.hasVertexColors });
  suitMat.userData.uniforms.uAsisY.value = pelvis.asisLine?.position.y ?? -0.02 * S;
  const bodyMeshes = [];
  body.group.traverse((o) => { if (o.isMesh) bodyMeshes.push(o); });

  /* 装備：ヘルメット・ゴーグル・ブーツ・スキー・ストック */
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xe8c9a8, roughness: 0.75 });
  // レンズはミラー。金属の色が映り込みの色になるので、青みのある銀にする
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0xb9c8ec, roughness: 0.06, metalness: 1.0,
    emissive: 0x000000, side: THREE.DoubleSide,
    envMap: opts.env ?? null, envMapIntensity: 1.4 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf24b3d, roughness: 0.45 });
  const strapMat = new THREE.MeshStandardMaterial({
    color: 0xf24b3d, roughness: 0.75, side: THREE.DoubleSide });
  const head = createHeadGear(H, { skin: faceMat, helmet: helmetMat,
    lens: lensMat, frame: frameMat, strap: strapMat });
  head.setChinGuard(disc.key === 'SL');   // SL はチンガード付きヘルメット
  gearG.add(head.group);
  const headMats = head.mats ?? [helmetMat, faceMat, lensMat, frameMat, strapMat];

  /* グローブ */
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x2b3a52, roughness: 0.7 });
  const gloves = { L: makeGlove(gloveMat), R: makeGlove(gloveMat) };
  for (const k of ['L', 'R']) gearG.add(gloves[k]);

  const buckleMat = new THREE.MeshStandardMaterial({
    color: 0xc9d4e2, roughness: 0.32, metalness: 0.6,
    envMap: opts.env ?? null, envMapIntensity: 1.0 });
  const bootOpts = { shinGuard: disc.key === 'SL', shankLen: seg.shank };
  const boots = { L: makeBoot(gearMat, buckleMat, bootOpts), R: makeBoot(gearMat, buckleMat, bootOpts) };
  const skis = {
    L: makeSki(disc.skiLength, disc.skiWaist, disc.skiShoulder, disc.skiTail, 0x1e6bd6),
    R: makeSki(disc.skiLength, disc.skiWaist, disc.skiShoulder, disc.skiTail, 0x1e6bd6),
  };
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xd9dee6, roughness: 0.3, metalness: 0.5 });
  const poles = { L: makePole(disc, poleMat, opts.env), R: makePole(disc, poleMat, opts.env) };
  for (const s of ['L', 'R']) gearG.add(boots[s], skis[s], poles[s]);

  /* 上肢の骨のノード（筋の付着部を引くための座標系）。
     ローカル軸は下肢と同じ x=左・y=骨の軸（近位向き）・z=前。 */
  const armNode = { L: { upper: new THREE.Object3D(), fore: new THREE.Object3D() },
                    R: { upper: new THREE.Object3D(), fore: new THREE.Object3D() } };
  for (const sd of ['L', 'R']) skeleton.add(armNode[sd].upper, armNode[sd].fore);

  /* 筋（骨のノードを名前で引けるようにして渡す） */
  const muscleGroup = new THREE.Group();
  muscleGroup.name = 'muscleLayer';
  root.add(muscleGroup);
  const resolveNode = (name, side) => {
    if (name === 'pelvis') return pelvisNode;
    if (name === 'femur') return legs[side].femur;
    if (name === 'shank') return legs[side].shank;
    if (name === 'shoulder') return torso.shoulders[side];
    if (name === 'humerus') return armNode[side].upper;
    if (name === 'forearm') return armNode[side].fore;
    if (name.startsWith('spine')) {
      const map = { spineL3: 2, spineT12: 5, spineT10: 7, spineT9: 8, spineT8: 9,
                    spineT6: 11, spineT4: 13, spineT2: 15, spineT1: 16 };
      return torso.verts[map[name] ?? 5];
    }
    return null;
  };
  const muscles = createMuscles(H, resolveNode);
  muscleGroup.add(muscles.group);
  muscleGroup.visible = false;

  /* 重心マーカー。不透明なスーツの中にあるので、奥行き判定をせず最後に描く。
     黄色は「いまやる動作」専用にしたので白にする。 */
  const comMarker = new THREE.Group();
  const comMats = [
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false }),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false }),
  ];
  const comBall = new THREE.Mesh(new THREE.SphereGeometry(0.045, 20, 14), comMats[0]);
  const comRing = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.007, 8, 32), comMats[1]);
  comBall.renderOrder = 15; comRing.renderOrder = 15;
  comMarker.add(comBall, comRing);
  root.add(comMarker);

  /* --- 影の旗 ---
   * 骨・骨盤・筋・重心マーカーは影を落とさない（スーツが落とす）。
   * 身体は自分の影を受けると立体感が出るが、狭い画面・タッチ端末では重いので切る。 */
  for (const g of [skeleton, pelvisNode, muscleGroup, comMarker]) {
    g.traverse((o) => { if (o.isMesh) o.userData.noShadow = true; });
  }
  const lowPower = typeof window !== 'undefined'
    && (window.innerWidth < 820 || !!window.matchMedia?.('(pointer:coarse)').matches);
  for (const m of bodyMeshes) m.userData.receiveShadow = !lowPower;
  /** 旗に合わせて castShadow / receiveShadow を立て直す。
   *  外側（main.js）が全メッシュに castShadow を立てたあとでも、ここで揃う。 */
  function applyShadowFlags() {
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = !o.userData.noShadow;
      o.receiveShadow = !!o.userData.receiveShadow;
    });
  }

  /* ---------------------------------------------------------------- */
  const state = { anchors: {}, angles: {}, blockSide: crossBlock ? 'outer' : 'inner' };
  /* 表示の状態：外から来るトグル（flags）と見え方（look）を合わせて決める */
  const flags = { skeleton: true, body: true, pelvis: true, com: true };
  let look = 'window';
  let focusPelvis = false, ghostOn = false, firstPerson = false;

  /** 板の裏の点（板のローカル座標）。gear.js の板が持っていなければ全頂点から作る */
  function baseOutline(ski) {
    if (ski.userData.baseOutline) return ski.userData.baseOutline;
    const pts = [], v = new THREE.Vector3();
    ski.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(ski.matrixWorld).invert();
    const m = new THREE.Matrix4();
    ski.traverse((o) => {
      if (!o.isMesh) return;
      m.multiplyMatrices(inv, o.matrixWorld);
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); pts.push(v.x, v.y, v.z); }
    });
    ski.userData.baseOutline = new Float32Array(pts);
    return ski.userData.baseOutline;
  }

  /** 姿勢を更新する。s は TurnModel.sample() の戻り値 */
  function update(s, cfg = {}) {
    /* root は常に原点。以前は最後に重心のずれぶん root ごと平行移動していたが、
     * それだとスキーとブーツまで一緒に動き、板が雪面の下 8〜12 cm に埋まっていた。
     * いまは足を雪面に残したまま、ずれを腰の位置で吸収する（下の「重心合わせ」）。 */
    root.position.set(0, 0, 0);
    const N = s.normal;
    const outwardIsRight = s.eLat.dot(s.outward) > 0;
    pelvis.setOuterSide(outwardIsRight);

    /* --- 骨盤のフレーム --- */
    /* 上下軸：脚と上体の中間。外傾のほとんどは<b>股関節</b>で折る。
     * 背骨を横に曲げて作ると上体が倒れ、腰椎の可動域（左右 25〜30°）も足りない。
     * 競技者が「脚だけ角度をつけて上体は立てて」見えるのは、
     * 曲げている場所が腰ではなく股関節だから。 */
    const hipShare = 0.78;
    const pelvisUp = s.legDir.clone().lerp(s.torsoDir, hipShare).normalize();
    // 前後軸：進行方向を骨盤面に投影し、外向角ぶん外側へ回す
    let fwd = s.tangent.clone().projectOnPlane(pelvisUp).normalize();
    fwd = rotateToward(fwd, s.outward, pelvisUp, s.counter).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, pelvisUp).normalize();
    // three.js のオブジェクトは +Z を向くので、右手系の基底は（左, 上, 前）になる
    const left = right.clone().negate();

    /* --- 骨盤の前傾＝股関節の屈曲 ---
     * 以前は前傾を<b>骨盤の上（腰椎）</b>で作っていたので、上体は前に倒れているのに
     * 骨盤そのものは 1 ターン中ずっと −4〜−16° <b>後ろへ倒れていた</b>。
     * 「腰が引けた」姿勢で、初心者が真っ先に直される形そのもの。
     * 骨盤を見せる教材でこれを見せるわけにはいかない。
     *
     * 実際の前傾は、骨盤ごと大腿骨の上で前へ倒す（＝股関節の屈曲）。
     * 背骨は骨盤に乗ったまま、ほぼまっすぐ。
     * 左右軸まわりに回すので、外向（骨盤の向き）は変わらない。 */
    /* 狙いは「斜面に対して骨盤が何度前へ倒れているか」で決める。
     * 脚の線の前後の傾きは減速の強さで変わる（SL は後ろへ −20°、GS は −14° 程度）ので、
     * 脚に対して一定量倒すと種目によって骨盤の向きがばらつく。 */
    const tiltOf = () => Math.atan2(pelvisUp.dot(s.tangent), pelvisUp.dot(N));
    const tiltWant = rad(PELVIS_TILT0 + PELVIS_TILT1 * s.loadNorm);
    // 骨盤は内傾しているので、左右軸まわりの回転は前後の傾きに 1:1 では効かない。
    // 1 回回して残りをもう 1 回回す（2 回でほぼ一致する）。
    let pelvisTilt = 0;
    for (let k = 0; k < 2; k++) {
      const d = tiltWant - tiltOf();
      pelvisUp.applyAxisAngle(left, d);
      fwd.applyAxisAngle(left, d);
      pelvisTilt += d;
    }
    const pelvisM = new THREE.Matrix4().makeBasis(left, pelvisUp, fwd);
    pelvisNode.quaternion.setFromRotationMatrix(pelvisM);
    pelvisNode.position.copy(s.hip);

    /* --- スキーと足首（1 フレームに 1 回だけ。以降は動かさない） ---
     * 内スキーは外スキーより少し多く傾き、トップが前に出る（＝内足の先行）。
     * 先行量はエッジ角から決まる量なので、切り替えでは自然にそろう。 */
    const skiNormalOuter = rotateToward(N, s.inward, s.tangent, s.edgeAngle).normalize();
    const feet = { R: s.footR.clone(), L: s.footL.clone() };
    const ankles = {}, skiCenters = {}, skiNormals = {}, contacts = {};
    for (const side of ['L', 'R']) {
      const isOuter = (side === 'R') === outwardIsRight;
      const edge = isOuter ? s.edgeAngle : s.edgeAngleInner;
      const skiNormal = rotateToward(N, s.inward, s.tangent, edge).normalize();
      // スキーのローカル軸：x = skiSide, y = skiNormal, z = tangent（右手系）
      const skiSide = new THREE.Vector3().crossVectors(skiNormal, s.tangent).normalize();
      skiNormals[side] = skiNormal;

      /* トップの前後差を荷重で振り分ける。
       * 以前は前後へ半分ずつ（外足を lead/2 だけ下げる）だったので、80 % 乗っている
       * 外足のほうが重心より後ろへ下がり、重心が外の足首より前に出すぎる一因になっていた。
       * 荷重の重み付き平均がモデルの足の位置に来るように分けると、
       *   外足 −(1−外の配分)·先行量、内足 ＋外の配分·先行量
       * になる。先行量は切り替えで 0 なので、外脚・内脚の入れ替わりでも跳ばない。 */
      const lead = isOuter
        ? -(1 - s.outerShare) * s.innerLead
        : s.outerShare * s.innerLead;
      const contact = feet[side].clone().addScaledVector(s.tangent, lead);
      contacts[side] = contact;
      /* 接雪しているのは「下がっているほうのエッジ」。板がフラットなら差はない。
       * ターンの内外（符号が裏返る量）を使わず、板の横軸が雪面法線に対して
       * どれだけ下がっているかだけで決めれば、エッジの入れ替わりを
       * 0 を通ってなめらかに越えられる。 */
      const lowering = -skiSide.dot(N);
      const center = contact.clone().addScaledVector(skiSide,
        -disc.skiWaist * 0.5 * Math.tanh(lowering / Math.sin(rad(8))));

      /* 板の高さ：板の裏のいちばん低い点を雪面に合わせる。
       * 板は曲がらない（たわまない）ので、エッジを立てるとウエストより幅の広い
       * ショルダーとテールの縁のほうが下に出る（エッジ 70° で SL 約 1.3 cm・GS 約 1.6 cm）。
       * ウエストのエッジを雪面に置くと、その分だけトップとテールが雪に刺さって見える。
       * 最低点は「左の縁か右の縁か」で切り替わり、フラットのところで折れるので、
       * sqrt(h² + δ²) − δ でならしておく（δ = 2 mm 以内のずれ）。 */
      const ski = skis[side];
      const P = baseOutline(ski);
      const a = skiSide.dot(N), b = skiNormal.dot(N), c = s.tangent.dot(N);
      let hMin = 0;
      for (let i = 0; i < P.length; i += 3) hMin = Math.min(hMin, P[i] * a + P[i + 1] * b + P[i + 2] * c);
      const delta = 0.002;
      const hSmooth = -(Math.sqrt(hMin * hMin + delta * delta) - delta);
      const centerN = center.clone().sub(s.pos).dot(N);
      center.addScaledVector(N, SKI_BASE_N - (centerN + hSmooth));
      skiCenters[side] = center;

      const stand = ski.userData.standHeight ?? STAND_DEFAULT;
      ankles[side] = center.clone().addScaledVector(skiNormal, stand + SOLE_TO_ANKLE);

      ski.position.copy(center);
      ski.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(skiSide, skiNormal, s.tangent));
      if (ski.userData.setRole) ski.userData.setRole(isOuter);
      else {
        ski.userData.mat.color.set(isOuter ? 0xff6b57 : 0x2f7fe0);
        ski.userData.mat.emissive.set(isOuter ? 0x3a0f08 : 0x03101f);
      }

      boots[side].position.copy(center).addScaledVector(skiNormal, stand);
      boots[side].quaternion.copy(ski.quaternion);
    }
    const skiNormal = skiNormalOuter;
    // 脚を畳んでいるときほど、膝は前ではなく上（板の法線方向）へ抜ける
    const kneeHint = s.tangent.clone()
      .addScaledVector(skiNormal, 0.72 + 1.1 * (1 - s.loadNorm)).normalize();

    /* --- 体幹 ---
     * 骨盤の上に脊柱を積み、側屈・回旋・屈曲を部位ごとの可動域比で配分する。
     * 回旋の主役は胸椎（腰椎はほとんど回らない）ので、
     * 「骨盤と肩の向きの差」は自然と胸のあたりで作られる。
     * 体幹の<b>向き</b>は骨盤の向きだけで決まり、腰の位置には依存しない。
     * そこで向きはここで 1 回だけ解き、重心合わせでは体幹ごと平行移動する。 */
    const sacralOff = pelvisUp.clone().multiplyScalar(0.050 * pelvis.scale)
      .addScaledVector(fwd, -0.028 * pelvis.scale);
    torso.group.position.copy(s.hip).add(sacralOff);
    torso.group.quaternion.copy(pelvisNode.quaternion);

    /* 側屈：外傾のうち脊柱が担うぶん（残りは股関節）。
     * 外傾は「脚より上体を<b>起こす</b>」動きなので、胸は骨盤より
     * ターンの<b>外側</b>へ戻る向きに曲がる。符号が逆だと、脊柱が傾きを
     * 足す側に働いて上体がよけいに寝る（実際にそうなっていた）。
     *
     * さらに、曲がりを椎骨に分散すると「腰から肩を結んだ線」は
     * 曲がり角の半分ぶんしか起きない。前額面の解が想定しているのは
     * この線なので、分散ぶんを見込んで倍率を掛ける。 */
    const spineLateral = SPINE_LAT_GAIN * (1 - hipShare) * s.angulation
      * (right.dot(s.outward) > 0 ? 1 : -1);
    // 回旋：肩と骨盤の差。外側へ回す向きが +
    // ブロックの反作用：ポールを押した反動で肩はさらに谷を向く。
    // 「上体は動かさない」のではなく、動かないように支えている（modeled）。
    const blockNow = THREE.MathUtils.clamp(s.gateBlock ?? 0, 0, 1);
    const spineAxial = (((s.counterSpine ?? s.counter) - s.counter)
      + rad(3.0) * blockNow)
      * (right.dot(s.outward) > 0 ? -1 : 1);
    /* 前傾は「背中を丸める」のではなく「股関節で折る」。
     * 前傾の大半は骨盤ごと倒した（上の pelvisTilt）ので、骨盤の上では
     * そのぶんを戻して背中をまっすぐに保つ（腰を丸めない）。 */
    const hipFlexSag = rad(LUMBAR0 + LUMBAR1 * s.loadNorm) - LUMBAR_COMP * pelvisTilt;
    torso.setHipFlex(hipFlexSag);
    const spineFlex = rad(5 + 8 * s.loadNorm);

    /* 側屈は 24 個の椎骨に分散するので、入れた角度どおりには
     * 「腰→肩の線」は動かない（しかも股関節の前屈量で応答が変わる）。
     * 骨盤から見た肩の位置は幾何だけで出せるので、2 点試して応答を求め、
     * 必要な入力を逆算する。シーングラフは最後に 1 回だけ更新する。 */
    /* 前額面（進行方向に垂直な面）へ落として測る。前額面の解はこの面の話なので、
     * 前傾ぶんを含めた 3D の向きで比べても合わない。 */
    const latOf = (x) => {
      const v = torso.shoulderLocal(x, spineAxial, spineFlex, hipFlexSag + SACRAL_SLOPE)
        .applyQuaternion(pelvisNode.quaternion);
      return Math.atan2(v.dot(s.outward), v.dot(N));
    };
    const targetLat = Math.atan2(s.torsoDir.dot(s.outward), s.torsoDir.dot(N));
    const lat0 = latOf(0);
    const probe = rad(12);
    const resp = (latOf(probe) - lat0) / probe;
    const spineLateralUsed = Math.abs(resp) > 1e-3
      ? THREE.MathUtils.clamp((targetLat - lat0) / resp, -rad(40), rad(40))
      : spineLateral;
    torso.setGirdleRoll(0);
    root.updateMatrixWorld(false);
    skeleton.updateMatrixWorld(false);
    torso.update(spineLateralUsed, spineAxial, spineFlex);

    /* 体幹から出てくるフレーム（腰を動かす前の値。向きは以後変わらない） */
    const chestPos0 = new THREE.Vector3();
    torso.thoracic[torso.thoracic.length - 1].getWorldPosition(chestPos0);
    const midThorax0 = new THREE.Vector3();
    torso.thoracic[Math.floor(torso.thoracic.length / 2)].getWorldPosition(midThorax0);

    const chestQuat = new THREE.Quaternion();
    torso.thoracic[torso.thoracic.length - 1].getWorldQuaternion(chestQuat);
    const chestFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chestQuat).normalize();
    const chestUp = new THREE.Vector3(0, 1, 0).applyQuaternion(chestQuat).normalize();
    const chestLeft = new THREE.Vector3(1, 0, 0).applyQuaternion(chestQuat).normalize();
    const chestRight = chestLeft.clone().negate();

    /* --- 肩の線の傾き ---
     * 側屈を椎骨に分散すると、上の胸椎ほど傾きが積み重なり、肩の線は
     * 体幹の線（腰→肩）より大きく傾く（実測で内肩が 5〜12° 余計に落ちていた）。
     * 体幹の傾き＋3° を超えたぶんだけ、肩甲帯を回して内肩を上げる。
     * 外傾が 0 になる切り替えでは効きも 0 にする（外側基準の量なので）。 */
    const readShoulders = () => {
      const R = new THREE.Vector3(), L = new THREE.Vector3();
      torso.shoulders.R.getWorldPosition(R);
      torso.shoulders.L.getWorldPosition(L);
      return { L, R };
    };
    let sh0 = readShoulders();
    {
      const shOut = outwardIsRight ? sh0.R : sh0.L, shIn = outwardIsRight ? sh0.L : sh0.R;
      const line = shOut.clone().sub(shIn);
      // 外肩が上がっている角度（＋）。体幹が内へ φ 傾けば、垂直な肩の線も φ 傾く
      const roll = Math.atan2(line.dot(N), line.dot(s.outward));
      const trunk = sh0.L.clone().add(sh0.R).multiplyScalar(0.5).sub(torso.group.position);
      const incl = Math.atan2(-trunk.dot(s.outward), trunk.dot(N));
      const w = THREE.MathUtils.smoothstep(s.angulation, 0, rad(8));
      const over = roll - incl - rad(3);
      // softplus（幅 1°）でなめらかに「超えたぶん」を取る
      const k = rad(1);
      const excess = w * k * Math.log1p(Math.exp(over / k));
      // 胸の前後軸と進行方向がずれているぶん（上体のひねり）だけ効きが落ちる
      const gain = 1 / Math.max(0.6, Math.abs(chestFwd.dot(s.tangent)));
      // +z まわりの回転で左肩が上がる。内肩を上げたいので、内が左なら +。
      // 肩甲帯の挙上・下制で無理なく作れる範囲として 14° で頭打ち（調整値・なめらかに）
      const roll2 = softClampAngle(excess * gain, rad(9), rad(14)) * (outwardIsRight ? 1 : -1);
      torso.setGirdleRoll(roll2);
      state.shoulderRoll = { roll, incl, corr: roll2 };
      if (roll2 !== 0) sh0 = readShoulders();
    }
    const headMount0 = new THREE.Vector3();
    torso.headMount.getWorldPosition(headMount0);

    const hip0 = {
      R: s.hip.clone().addScaledVector(right, pelvis.hipHalfWidth)
        .addScaledVector(pelvisUp, -0.040 * pelvis.scale),
      L: s.hip.clone().addScaledVector(right, -pelvis.hipHalfWidth)
        .addScaledVector(pelvisUp, -0.040 * pelvis.scale),
    };
    const sternum0 = sh0.L.clone().add(sh0.R).multiplyScalar(0.5)
      .addScaledVector(chestUp, -0.06 * S).addScaledVector(chestFwd, 0.09 * S);

    /* --- 手の運びの準備 ---
     * 上体が「ポールに向かうまでスムーズでない」のは、手を
     * 「胸のフレームに対する固定オフセット」で置いていたから。
     * 外脚・内脚が入れ替わる瞬間にそのオフセットも入れ替わるので、
     * 身体は動いていないのに手が 10 cm ほど跳んでいた。
     *
     * 実際のレーサーの手は、身体の前で<b>谷へ向かって流れ続ける</b>。
     * そこで基準点を「重心の軌跡を少し先へ進めた点」にする。
     * 軌跡はモデルが持っている連続な曲線なので、手の運びも自然に連続になり、
     * 身体がその下で回り込むぶんだけ、手が身体に対して動いて見える。
     *
     * 外脚側／内脚側の区別も真偽値ではなく<b>荷重配分</b>で連続に混ぜる。
     * 切り替えでは配分が 50:50 なので、左右の役割がなめらかに入れ替わる。 */
    const block = THREE.MathUtils.clamp(s.gateBlock ?? 0, 0, 1);
    state.block = block;
    const ahead = cfg.ahead ?? s;                 // u ＋ 約 0.4 m のサンプル
    const handBase0 = ahead.com.clone()
      .addScaledVector(N, 0.16)
      .addScaledVector(s.tangent, 0.06);
    const reach = (seg.upperArm + seg.foreArm) * 0.97;
    /** 届く範囲へなめらかに収める（clamp だと境界で折れる） */
    const softReach = (from, to) => {
      const v = to.clone().sub(from);
      const d = v.length();
      if (d < 1e-6) return to.clone();
      return from.clone().addScaledVector(v, reach * Math.tanh(d / reach) / d);
    };
    const armRole = {};
    for (const side of ['L', 'R']) {
      const isOuter = (side === 'R') === outwardIsRight;
      // この脚が受け持っている荷重の割合。切り替えでは左右とも 0.5 になる
      const share = isOuter ? s.outerShare : 1 - s.outerShare;
      const outerness = THREE.MathUtils.smoothstep(share, 0.35, 0.60);
      const innerness = THREE.MathUtils.smoothstep(1 - share, 0.35, 0.60);
      // 旗門を受け持つ腕：SL は外側の腕、GS は内側の肩と腕
      const role = crossBlock ? outerness : innerness;
      armRole[side] = { sgn: side === 'R' ? 1 : -1, share, innerness, pull: block * role };
    }

    /**
     * 腰を hipShift だけ動かしたときの関節位置を返す（シーングラフは触らない）。
     * 体幹は向きが変わらないので平行移動するだけ。足首は雪面の板の上に固定なので、
     * 膝の曲がりが腰の移動を吸収する。腕は肩から解き直す。
     */
    function posePass(dlt) {
      const hips = { L: hip0.L.clone().add(dlt), R: hip0.R.clone().add(dlt) };
      const knees = {
        L: solveIK(hips.L, ankles.L, seg.thigh, seg.shank, kneeHint),
        R: solveIK(hips.R, ankles.R, seg.thigh, seg.shank, kneeHint),
      };
      const shoulders = { L: sh0.L.clone().add(dlt), R: sh0.R.clone().add(dlt) };
      const sternum = sternum0.clone().add(dlt);
      const handBase = handBase0.clone().add(dlt);
      const elbows = {}, hands = {};
      for (const side of ['L', 'R']) {
        const { sgn, share, innerness, pull } = armRole[side];
        /* 構え：肩から「どの向きへ」「どれだけ伸ばすか」で決める。
         * 目標点を置いて届く範囲へ縮めると、縮めたぶん左右の開きまで
         * つぶれてしまい、手が胸の前で団子になる。
         * 向きは胸のフレームで作り、そこへ「谷へ流れる向き」を混ぜる。
         * 手は前へ、左右の開きは肩幅くらい（肘を張って開くと「手羽先」に見える）。 */
        /* 肩から手までの長さ。下の softReach が tanh で縮めるので、
         * 実際の長さが腕の 0.80 倍（払う腕は 0.95 倍）になるよう逆算しておく。 */
        const ext = reach * Math.atanh(0.80 + 0.15 * pull);
        const aim = chestFwd.clone().multiplyScalar(0.95)
          .addScaledVector(chestRight, sgn * (0.42 - 0.08 * share))
          .addScaledVector(N, -0.16 + 0.12 * share)
          .normalize();
        const flow = handBase.clone().sub(shoulders[side]);
        if (flow.lengthSq() > 1e-6) aim.lerp(flow.normalize(), 0.35).normalize();
        if (crossBlock) {
          /* 外の腕で払っている間、内側の手は前へ、胸の高さに出しておく。
           * 胸の正面は前傾ぶん下を向いているので、斜面に沿った前（水平な前）を使う。 */
          const fwdLevel = chestFwd.clone().projectOnPlane(N).normalize();
          const fwdUp = fwdLevel.multiplyScalar(0.95).addScaledVector(N, 0.05).normalize();
          aim.lerp(fwdUp, block * innerness).normalize();
        }
        const ready = shoulders[side].clone().addScaledVector(aim, ext);

        let hand = ready;
        if (s.gatePos && pull > 1e-6) {
          if (crossBlock) {
            /* SL のクロスブロック：脚は旗門の外を回り、上体は旗門の上へ傾けて、
             * 外側の手（腕）で肩の高さあたりのポールを払う。
             * 手は横からではなく胸の前（胸骨の 30 cm ほど前）を通ってポールへ向かう。
             * 腕は伸ばしたまま、突き（パンチ）はしない。身体の中心線は越えない
             * （実測で外の手は常に中心線より 12 cm 以上外側。ポールは上体の傾きで外側へ来る）。
             * 高さとタイミングは設計値で、指導者の目での確認が要る。 */
            const hUp = THREE.MathUtils.clamp(
              shoulders[side].clone().sub(s.gatePos).dot(N), 0.9, 1.4);
            const contact = s.gatePos.clone().addScaledVector(N, hUp)
              // 払う前は手が先行し、払ったあとは後ろへ流れる
              .addScaledVector(s.tangent, -0.30 * Math.tanh((s.gateDu ?? 0) / 0.8));
            const via = sternum.clone().addScaledVector(chestFwd, 0.32);
            const p = pull, q = 1 - pull;
            // 2 次ベジエ：構え → 胸の前 → ポール
            hand = ready.clone().multiplyScalar(q * q)
              .addScaledVector(via, 2 * p * q).addScaledVector(contact, p * p);
          } else {
            /* GS：内側の手と肩でパネルをよける。狙うのは決まった高さではなく、
             * 肩からいちばん近いポール上の点（＝自然に当たるところ）。 */
            const hUp = THREE.MathUtils.clamp(
              shoulders[side].clone().sub(s.gatePos).dot(N), 0.45, 1.35);
            const contact = s.gatePos.clone().addScaledVector(N, hUp)
              // たたく前は手が先行し、たたいたあとは後ろへ流れる
              .addScaledVector(s.tangent, -0.30 * Math.tanh((s.gateDu ?? 0) / 0.8));
            hand = ready.clone().lerp(contact, pull);
          }
        }
        hand = softReach(shoulders[side], hand);

        // 肘の抜ける向き：下へ、少しだけ外へ。旗門を受けるときは肘を下げて前腕で受ける
        // （後ろへ引くと上腕が体幹に沿って垂れ、肘を横へ張ると「手羽先」になる）
        const hint = chestRight.clone().multiplyScalar(sgn * 0.3)
          .addScaledVector(s.torsoDir, -0.8 - pull * 0.6).normalize();
        elbows[side] = solveIK(shoulders[side], hand, seg.upperArm, seg.foreArm, hint);
        hands[side] = hand;
      }
      return {
        dlt, pelvisPos: s.hip.clone().add(dlt), hips, knees, ankles, shoulders, elbows, hands,
        chestPos: chestPos0.clone().add(dlt), midThorax: midThorax0.clone().add(dlt),
        lumbarBase: torso.group.position.clone().add(dlt),
        headPos: headMount0.clone().add(dlt).addScaledVector(chestUp, seg.headR * 0.85),
        sternum,
      };
    }

    /* --- 重心合わせ ---
     * Dempster の質量比で描いている身体の重心を求め、力学モデルの重心とのずれを
     * 腰の位置で吸収する（足は雪面に置いたまま）。
     *   ・力の線（uLeg）に沿ったずれは「接雪点から重心までの距離」を変えるだけで
     *     内傾角には効かないので無視する（ここを詰めると脚がつぶれて板が埋まる）。
     *   ・残りを「横（前額面で力の線に垂直）」と「前後」に分けて腰で動かす。
     *     脚は足を残して一部しか動かないので倍率 1.3 を掛ける。
     *   ・前後は<b>斜面に沿って</b>まっすぐ後ろへ動かす。力の線に垂直に動かすと、
     *     力の線が後ろへ傾いているぶん腰が下がり、膝がさらに 5° ほど曲がってしまう。
     *     上限 13 cm（調整値）を tanh でなめらかに効かせる。
     * 回数を固定して 2 回直すので、補正量は位相の連続関数のまま（条件分岐で跳ばない）。 */
    const latAxis = new THREE.Vector3().crossVectors(s.uLeg, s.tangent).normalize();
    const foreAxis = new THREE.Vector3().crossVectors(latAxis, s.uLeg).normalize();
    const foreGain = 1 / Math.max(0.5, foreAxis.dot(s.tangent));   // 斜面方向に動かしたときの効き
    const shift = new THREE.Vector3();
    let rawLat = 0, rawFore = 0;
    let P = posePass(shift);
    let actual = computeCoM(P);
    for (let it = 0; it < 2; it++) {
      const fix = s.com.clone().sub(actual);
      rawLat += HIP_SHIFT_GAIN * fix.dot(latAxis);
      rawFore += HIP_SHIFT_GAIN * fix.dot(foreAxis) * foreGain;
      shift.copy(latAxis).multiplyScalar(rawLat)
        .addScaledVector(s.tangent, softLimit(rawFore, HIP_SHIFT_FORE_MAX));
      P = posePass(shift);
      actual = computeCoM(P);
    }
    const residual = s.com.clone().sub(actual);
    state.hipShift = shift.clone();
    state.comResidual = {
      vec: residual, along: residual.dot(s.uLeg),
      lateral: residual.dot(latAxis), fore: residual.dot(foreAxis),
    };

    /* --- ここから最終の姿勢を書き込む（1 回だけ） --- */
    const { pelvisPos, hips, knees, shoulders, elbows, hands, chestPos, midThorax,
      lumbarBase, headPos } = P;
    const hipL = hips.L, hipR = hips.R;
    pelvisNode.position.copy(pelvisPos);
    torso.group.position.add(shift);
    const legBasis = {};
    for (const side of ['L', 'R']) {
      kneePos[side].copy(knees[side]);
      legBasis[side] = legs[side].update(hips[side], knees[side], ankles[side], kneeHint);
      state.angles[`knee${side}`] = Math.PI - angleBetween(
        hips[side].clone().sub(knees[side]), ankles[side].clone().sub(knees[side]));
      boots[side].userData.setShank?.(ankles[side], knees[side]);
    }
    state.blockPull = Math.max(armRole.L.pull, armRole.R.pull);
    state.spine = { lateral: spineLateralUsed, axial: spineAxial, flex: spineFlex,
      hipFlex: hipFlexSag, pelvisTilt };

    for (const side of ['L', 'R']) {
      shoulderB[side].position.copy(shoulders[side]);
      elbow[side].position.copy(elbows[side]);
      humerus[side].userData.set(shoulders[side], elbows[side]);
      ulna[side].userData.set(elbows[side], hands[side]);
      // 筋の付着用ノード（x=左・y=骨の軸・z=前）
      const setArm = (node, from, to) => {
        const Y = from.clone().sub(to).normalize();
        let Z = chestFwd.clone().addScaledVector(Y, -chestFwd.dot(Y));
        if (Z.lengthSq() < 1e-8) Z = new THREE.Vector3(0, 0, 1);
        Z.normalize();
        const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
        node.position.copy(from);
        node.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
      };
      setArm(armNode[side].upper, shoulders[side], elbows[side]);
      setArm(armNode[side].fore, elbows[side], hands[side]);
    }

    /* --- 身体の表面 ---
     * 胴体は骨（骨盤・椎骨）の matrixWorld から輪切りを並べ直す。
     * 四肢は関節の 2 点から。 */
    root.updateMatrixWorld(true);
    updateSuitWindow(suitMat, pelvisNode.matrixWorld, S);
    suitMat.userData.uniforms.uOuterSign.value = outwardIsRight ? -1 : 1;
    body.update({
      hips, knees: { L: kneePos.L, R: kneePos.R }, ankles,
      legAnt: { L: legBasis.L.Z, R: legBasis.R.Z },
      shoulders, elbows, hands, armAnt: chestFwd,
    }, root.position);

    /* --- 頭：頸椎の上にのせ、次の旗門を見る --- */
    skull.position.copy(headPos);
    head.group.position.copy(headPos);
    let lookDir = (cfg.lookTarget ? cfg.lookTarget.clone().sub(headPos) : s.tangent.clone()).normalize();
    // 頭は身体ほど傾けない（実際のスキーヤーも視線の水平を保つ）
    const headUp = N.clone().lerp(chestUp, 0.3).normalize();
    /* 首のひねりは胸の正面から ±45° まで。視線の先が真横に飛んでも、
     * 頭だけが胸に対して真後ろ近くまで回るような形にはしない。 */
    {
      const cf = chestFwd.clone().projectOnPlane(headUp).normalize();
      const lf = lookDir.clone().projectOnPlane(headUp);
      if (lf.lengthSq() > 1e-8 && cf.lengthSq() > 1e-8) {
        lf.normalize();
        const yaw = Math.atan2(new THREE.Vector3().crossVectors(cf, lf).dot(headUp), cf.dot(lf));
        const yawC = softClampAngle(yaw, HEAD_YAW_KNEE, HEAD_YAW_MAX);
        if (yawC !== yaw) {
          const pitch = THREE.MathUtils.clamp(lookDir.dot(headUp), -0.95, 0.95);
          lookDir = cf.applyAxisAngle(headUp, yawC).multiplyScalar(Math.sqrt(1 - pitch * pitch))
            .addScaledVector(headUp, pitch).normalize();
        }
      }
    }
    const headRight = new THREE.Vector3().crossVectors(lookDir, headUp).normalize();
    const headFwd = new THREE.Vector3().crossVectors(headUp, headRight).normalize();
    head.group.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(headRight.clone().negate(), headUp, headFwd));
    {
      const cf = chestFwd.clone().projectOnPlane(headUp).normalize();
      state.headYaw = Math.atan2(new THREE.Vector3().crossVectors(cf, headFwd).dot(headUp), cf.dot(headFwd));
    }

    /* --- グローブとストック ---
     * ストックは長さ一定（グリップ〜先端 = 身長 × 0.66）。以前は「手から決まった
     * オフセットの点」まで円柱を伸ばしていたので、長さが 1.1 m → 0.25 m と変わり、
     * ブロック中は先端がヘルメットより上へ立っていた。 */
    const poleInfo = {};
    for (const side of ['L', 'R']) {
      const { sgn, pull } = armRole[side];
      const hand = hands[side];
      const forearm = hand.clone().sub(elbows[side]).normalize();
      /* ふだん：手から後ろ斜め下へ（斜面に対して約 33°）、少し外へ開く。
       * 拳は胸と一緒に谷を向いているので、「後ろ」は板の進行方向と胸の正面の中間にとる。
       * 前腕の向きを混ぜると、腕の形しだいでストックが真下や前へ向いてしまうので混ぜない。 */
      const back = s.tangent.clone().add(chestFwd).normalize().negate();
      const dir = back.multiplyScalar(0.80)
        .addScaledVector(N, -0.55)
        .addScaledVector(chestRight, sgn * 0.22).normalize();
      /* 旗門を受けている腕：シャフトは前腕に沿って肘の側へ流し、25° 下へ向ける。
       * 旗門を過ぎると手が後ろへ流れて前腕が前を向くことがあるので、
       * 前腕の向きの「横と上下」だけ借りて、前後は必ず後ろ向きにする。 */
      if (pull > 1e-4) {
        const along = elbows[side].clone().sub(hand);
        along.addScaledVector(s.tangent, -along.dot(s.tangent));
        const back = along.lengthSq() > 1e-8 ? along.normalize().multiplyScalar(0.6) : new THREE.Vector3();
        back.addScaledVector(s.tangent, -0.8).normalize();
        const ax = new THREE.Vector3().crossVectors(back, N);
        const trail = ax.lengthSq() > 1e-8
          ? rotateToward(back, N.clone().negate(), ax.normalize(), rad(25)) : back;
        dir.lerp(trail, pull).normalize();
      }
      /* 雪面より下へは入れない：向き（斜面内の成分）は保ったまま、
       * 先端が雪面をこするように法線成分だけ決め直す。
       * 当たり始めで折れないよう softplus でならす（幅 3 cm）。 */
      const fitSnow = () => {
        const floor = SNOW_N + 0.005;
        const handN = hand.clone().sub(s.pos).dot(N);
        const rawN = handN + POLE_LEN * dir.dot(N);
        const w = 0.03;
        const want = floor + w * Math.log1p(Math.exp((rawN - floor) / w));
        const dn = THREE.MathUtils.clamp((want - handN) / POLE_LEN, -1, 1);
        const inPlane = dir.clone().addScaledVector(N, -dir.dot(N));
        if (inPlane.lengthSq() < 1e-8) inPlane.copy(s.tangent).multiplyScalar(-1);
        inPlane.normalize().multiplyScalar(Math.sqrt(1 - dn * dn));
        dir.copy(inPlane).addScaledVector(N, dn);
      };
      fitSnow();
      /* 同じ側の脚（大腿・下腿）に刺さらないよう、近すぎたら外へよける */
      for (let it = 0; it < 2; it++) {
        let push = null, worst = 0;
        for (const [a, b, clr] of [[hips[side], knees[side], 0.11], [knees[side], ankles[side], 0.075]]) {
          const tip = hand.clone().addScaledVector(dir, POLE_LEN);
          const [pp, qq] = closestSegSeg(hand, tip, a, b);
          const d = pp.distanceTo(qq);
          const k = 1 - THREE.MathUtils.smoothstep(d, clr * 0.4, clr);
          if (k > worst) {
            worst = k;
            // よける向きは斜面に沿った横方向だけ（上へ逃がすとストックが立ってしまう）
            push = pp.clone().sub(qq);
            push.addScaledVector(N, -push.dot(N));
            if (push.lengthSq() < 1e-8) push = chestRight.clone().multiplyScalar(sgn);
            push.addScaledVector(dir, -push.dot(dir));
            if (push.lengthSq() < 1e-8) push = chestRight.clone().multiplyScalar(sgn);
            push.normalize();
          }
        }
        if (!push || worst <= 0) break;
        dir.addScaledVector(push, 0.5 * worst).normalize();
        fitSnow();
      }
      const toBody = chestPos.clone().sub(hand).normalize();
      gloves[side].userData.setPose(hand, dir, forearm);
      poles[side].userData.setPose(hand, dir, POLE_LEN, toBody);
      poleInfo[side] = { grip: hand.clone(), dir: dir.clone(), tip: hand.clone().addScaledVector(dir, POLE_LEN) };
    }
    state.poles = poleInfo;
    state.poleLength = POLE_LEN;
    // 板の位置（シュプールや雪煙を板に合わせるとき用）
    state.gear = { skiCenters, skiNormals, contacts };

    /* --- 重心マーカー：描いている身体の重心（＝力の線の上） --- */
    comMarker.position.copy(actual);
    comRing.quaternion.setFromUnitVectors(V(0, 0, 1), s.uLeg.clone());

    /* --- ラベルのアンカー（ワールド座標。root は原点なのでそのまま） --- */
    state.anchors = {
      pelvis: pelvisPos.clone(),
      com: s.com.clone(),
      comRig: actual.clone(),
      head: headPos.clone(),
      outerFoot: (outwardIsRight ? feet.R : feet.L).clone(),
      innerFoot: (outwardIsRight ? feet.L : feet.R).clone(),
      // 板が実際に雪に触れているところ（内足の先行ぶんを含む）
      outerContact: (outwardIsRight ? contacts.R : contacts.L).clone(),
      innerContact: (outwardIsRight ? contacts.L : contacts.R).clone(),
      outerKnee: (outwardIsRight ? kneePos.R : kneePos.L).clone(),
      outerHip: (outwardIsRight ? hipR : hipL).clone(),
      innerHip: (outwardIsRight ? hipL : hipR).clone(),
      outerAnkle: (outwardIsRight ? ankles.R : ankles.L).clone(),
      chest: chestPos.clone(),
      asisMid: pelvisPos.clone().addScaledVector(fwd, 0.10),
      // ゴーグルとチンガードの外に出す（中に入ると視界が塞がる）
      eye: headPos.clone().addScaledVector(headFwd, seg.headR * 1.30)
        .addScaledVector(headUp, seg.headR * 0.20),
      innerHand: (outwardIsRight ? hands.L : hands.R).clone(),
      outerHand: (outwardIsRight ? hands.R : hands.L).clone(),
      blockHand: ((crossBlock === outwardIsRight) ? hands.R : hands.L).clone(),
      handL: hands.L.clone(), handR: hands.R.clone(),
      kneeLw: kneePos.L.clone(), kneeRw: kneePos.R.clone(),
      shoulderLw: shoulders.L.clone(), shoulderRw: shoulders.R.clone(),
      eyeDir: headFwd.clone(),
      eyeUp: headUp.clone(),
      pelvisFwd: fwd.clone(),
      pelvisUp: pelvisUp.clone(),
      pelvisRight: right.clone(),
      skiNormal: skiNormal.clone(),
    };
    state.angles.hipShare = hipShare;

    /* --- 外脚の股関節の角度（骨盤に対する大腿骨の向き） --- */
    const outerSide = outwardIsRight ? 'R' : 'L';
    const sgnOut = outwardIsRight ? 1 : -1;
    const fem = kneePos[outerSide].clone().sub(hips[outerSide]).normalize();
    const fx = fem.dot(right) * sgnOut;      // 外側成分（外転が +）
    const fy = fem.dot(pelvisUp);            // 上下成分（下向きが −）
    const fz = fem.dot(fwd);                 // 前後成分（屈曲が +）
    state.angles.hipFlexion = Math.atan2(fz, -fy);
    state.angles.hipAbduction = Math.atan2(fx, -fy);
    // 回旋：膝の横軸が骨盤の横軸からどれだけ回っているか（内旋が +）
    const femAxis = fem.clone();
    const proj = (v) => v.clone().sub(femAxis.clone().multiplyScalar(v.dot(femAxis))).normalize();
    const kneeRight = legBasis[outerSide].X.clone().negate();   // 基底の X は「左」
    const a1 = proj(right), a2 = proj(kneeRight);
    const sgn = Math.sign(new THREE.Vector3().crossVectors(a1, a2).dot(femAxis)) || 1;
    const rot = sgn * Math.acos(THREE.MathUtils.clamp(a1.dot(a2), -1, 1));
    state.angles.hipRotation = -rot * sgnOut;   // 内旋を + にする
    state.outerSide = outerSide;

    /* --- 筋：外力から関節モーメントを求めて活動度を出す --- */
    if (muscleGroup.visible) {
      const comUpper = lumbarBase.clone().lerp(midThorax, 0.55).multiplyScalar(0.46)
        .addScaledVector(midThorax.clone().lerp(chestPos, 0.45), 0.40)
        .addScaledVector(headPos, 0.14);
      // 圧の中心は、実際に板が雪に触れている位置（内足の先行ぶんを含む）から前後にずらす
      const cpOuter = (outwardIsRight ? contacts.R : contacts.L).clone()
        .addScaledVector(s.tangent, s.cpOffset ?? 0);
      const cpInner = (outwardIsRight ? contacts.L : contacts.R).clone()
        .addScaledVector(s.tangent, s.cpOffset ?? 0);
      const angByside = {};
      for (const sd of ['L', 'R']) {
        const femS = kneePos[sd].clone().sub(hips[sd]).normalize();
        angByside[sd] = {
          hipFlexion: Math.atan2(femS.dot(fwd), -femS.dot(pelvisUp)),
          knee: state.angles[`knee${sd}`] ?? 0,
          shin: Math.asin(THREE.MathUtils.clamp(
            kneePos[sd].clone().sub(ankles[sd]).normalize().dot(s.tangent), -1, 1)),
        };
      }
      const joints = {
        angles: angByside, spineFlex,
        hipL, hipR, kneeL: kneePos.L, kneeR: kneePos.R,
        ankleL: ankles.L, ankleR: ankles.R,
        legAxis: { L: legBasis.L.X, R: legBasis.R.X },
        cpOuter, cpInner, outerSide, outerIsRight: outwardIsRight,
        pelvisLeft: left, pelvisFwd: fwd, pelvisUp,
        l5s1: lumbarBase, comUpper,
        shoulders, elbows, hands,
      };
      const load = computeMuscleLoad(s, joints, opts.mass ?? ANTHRO.mass);
      state.muscleLoad = load;
      state.muscleAct = applyMuscleActivation(MUSCLES, load, outerSide);
      muscles.update(state.muscleAct);
    }
    // 内腰がどれだけ前に出ているか（足元の先行が骨盤に伝わった量）
    const innerHip = outwardIsRight ? hipL : hipR;
    const outerHip = outwardIsRight ? hipR : hipL;
    state.angles.hipLead = innerHip.clone().sub(outerHip).dot(s.tangent);

    return state;
  }

  /** Dempster の質量比で全身重心を求める */
  function computeCoM(p) {
    const acc = new THREE.Vector3();
    let total = 0;
    const add = (pos, m) => { acc.addScaledVector(pos, m); total += m; };
    // 体幹：骨盤〜胸椎中央〜胸椎上端に分けて分布（腹部が重い）
    add(p.lumbarBase.clone().lerp(p.midThorax, 0.55), SEGMENT_MASS.trunkHead * 0.46);
    add(p.midThorax.clone().lerp(p.chestPos, 0.45), SEGMENT_MASS.trunkHead * 0.40);
    add(p.headPos, SEGMENT_MASS.trunkHead * 0.14);
    for (const s of ['L', 'R']) {
      add(p.hips[s].clone().lerp(p.knees[s], 0.433), SEGMENT_MASS.thigh);      // 大腿
      add(p.knees[s].clone().lerp(p.ankles[s], 0.433), SEGMENT_MASS.shank);     // 下腿
      add(p.ankles[s].clone(), SEGMENT_MASS.foot);                              // 足
      add(p.shoulders[s].clone().lerp(p.elbows[s], 0.436), SEGMENT_MASS.upperArm);
      add(p.elbows[s].clone(), SEGMENT_MASS.foreArmHand);
    }
    return acc.divideScalar(total);
  }

  function angleBetween(a, b) {
    return Math.acos(THREE.MathUtils.clamp(a.clone().normalize().dot(b.clone().normalize()), -1, 1));
  }

  /* ---------------------------------------------------------------- */
  /* 表示                                                              */
  /* ---------------------------------------------------------------- */

  /**
   * 見え方とトグルを合わせて、何を描くかを決める。
   *   window : 不透明なスーツ＋骨盤の透視窓（既定）。胸や腕の骨はスーツの中で
   *            見えないので描かない（描画コールもおよそ半分になる）
   *   racer  : 不透明なスーツだけ。腰の高さに骨盤の向きを示すラインを描く
   *   xray   : 半透明の皮膚と骨格すべて（以前の見え方）
   * 筋を出しているときは X 線にする。不透明なスーツの中の筋は奥行きで消えてしまうため。
   * 身体を消しているとき（と骨盤ビュー）は、骨を隠す理由がないので骨を出す。
   */
  function applyLook() {
    const eff = muscleGroup.visible ? 'xray' : look;
    const xray = eff === 'xray', racer = eff === 'racer';
    const bodyShown = flags.body && !focusPelvis;
    const seeThrough = xray || !bodyShown;
    for (const m of bodyMeshes) {
      if (m.userData.keepMaterial) continue;     // gear.js のゼッケンなど、自前の色を持つもの
      m.material = xray ? skinMat : suitMat;
      // スーツは窓のために半透明扱い。骨盤と脚の骨（不透明）を先に描いておく
      m.renderOrder = xray ? 0 : 2;
    }
    const u = suitMat.userData.uniforms;
    u.uWinOn.value = (eff === 'window' && !ghostOn) ? 1 : 0;
    u.uHipOn.value = (racer && !ghostOn) ? 1 : 0;
    // 「骨格」トグルが受け持つのは体幹・腕・頭蓋の骨だけ（骨盤は「骨盤」トグル）
    const bones = flags.skeleton && seeThrough;
    torso.group.visible = bones;
    for (const b of armBones) b.visible = bones;
    skull.visible = bones && !firstPerson;
    for (const sd of ['L', 'R']) {
      legs[sd].group.visible = !racer || !bodyShown;
      // 窓に入るのは大腿骨の上のほうだけ。すねと膝の皿はスーツの中に隠れている
      legs[sd].shank.visible = seeThrough;
      legs[sd].patella.visible = seeThrough;
    }
    pelvisNode.visible = flags.pelvis && (!racer || !bodyShown);
    bodyG.visible = bodyShown;
    comMarker.visible = flags.com;
    // 一人称：自分の頭（ゴーグルの裏）とストックが視界をふさがないようにする。手は残す
    head.group.visible = !firstPerson;
    for (const sd of ['L', 'R']) poles[sd].visible = !firstPerson && !focusPelvis;
    bodyG.traverse((o) => { if (o.userData.hideInFirstPerson) o.visible = !firstPerson; });
    applyShadowFlags();
  }

  /** 骨盤ビュー・ゴーストで薄くする用具のマテリアル（gear.js の用具は userData.mats を持つ） */
  function gearMats() {
    const set = new Set([boneMat, jointMat, gearMat, poleMat, gloveMat, ...headMats]);
    for (const sd of ['L', 'R']) {
      for (const o of [skis[sd], boots[sd], poles[sd], gloves[sd]]) {
        for (const m of (o.userData.mats ?? (o.userData.mat ? [o.userData.mat] : []))) set.add(m);
      }
    }
    for (const m of (body.extraMats ?? [])) set.add(m);
    return [...set];
  }
  /** 元の透明度を覚えておいて薄くする／戻す（もともと半透明の部品を壊さない） */
  function fade(m, o) {
    const base = m.userData.fadeBase ?? (m.userData.fadeBase =
      { t: m.transparent, o: m.opacity, d: m.depthWrite });
    const on = o < 1;
    const t = on ? true : base.t;
    if (m.transparent !== t) m.needsUpdate = true;
    m.transparent = t;
    m.opacity = on ? base.o * o : base.o;
    m.depthWrite = on ? false : base.d;
  }

  applyLook();

  return {
    root, pelvis, torso, muscles, update, state,
    groups: { skeleton, body: bodyG, gear: gearG, com: comMarker, muscles: muscleGroup, pelvis: pelvisNode },
    materials: { suit: suitMat, skin: skinMat },
    setMusclesVisible(v) { muscleGroup.visible = v; applyLook(); },
    setVisible({ skeleton: sk, body: bd, pelvis: pv, com }) {
      if (sk !== undefined) flags.skeleton = sk;
      if (bd !== undefined) flags.body = bd;
      if (pv !== undefined) flags.pelvis = pv;
      if (com !== undefined) flags.com = com;
      applyLook();
    },
    /** 見え方：'window'（既定）| 'racer' | 'xray'。戻り値はいまの見え方 */
    setLook(mode) {
      if (mode === 'window' || mode === 'racer' || mode === 'xray') { look = mode; applyLook(); }
      return look;
    },
    getLook() { return look; },
    /** 一人称ビュー用：頭とストックを隠す（グローブは残す） */
    setFirstPerson(on) { firstPerson = !!on; applyLook(); },
    /** 骨盤クローズアップ用に、骨盤以外を薄くする */
    setFocusPelvis(on) {
      focusPelvis = !!on;
      skinMat.opacity = on ? 0.07 : 0.32;
      for (const m of gearMats()) fade(m, on ? 0.18 : 1);
      // 大腿骨は股関節の主役なので、骨盤ビューでもはっきり見せる
      if (legMat.transparent !== !!on) legMat.needsUpdate = true;
      legMat.transparent = !!on; legMat.opacity = on ? 0.92 : 1; legMat.depthWrite = true;
      // 骨盤ビューでは身体とストックを隠す（applyLook で）
      pelvis.setOpacity(1);
      applyLook();
    },
    setGhost(on) {
      ghostOn = !!on;
      skinMat.opacity = on ? 0.10 : 0.32;
      // ゴーストは窓なしの薄いスーツ。奥のものを隠さないよう depthWrite も切る
      suitMat.opacity = on ? 0.18 : 1;
      suitMat.depthWrite = !on;
      for (const m of [...gearMats(), legMat]) fade(m, on ? 0.18 : 1);
      for (const m of comMats) m.opacity = on ? 0.25 : 0.5;
      pelvis.setOpacity(on ? 0.25 : 1);
      applyLook();
    },
  };
}
