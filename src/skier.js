/**
 * skier.js — スキーヤーのリグ（骨格・身体・スキー）と姿勢計算
 *
 * 姿勢の決め方
 *   1. kinematics が「接雪点 → 重心」の向き uLeg と、脚の傾き φ_leg、上体の傾き φ_torso を返す
 *   2. 骨盤の上下軸は脚と上体の中間（外傾の約 2/3 が股関節、1/3 が腰椎という配分）
 *   3. 骨盤の向き（ヨー）はスキーの進行方向から外向角ぶん外側へ回す ← これが「外向」
 *   4. 足位置は雪面上で決まっているので、股関節から足首まで 2 リンク IK で膝を求める
 *   5. 最後に Dempster の質量比で実際の重心を計算し、力学的な重心と一致するよう全体を平行移動
 */
import * as THREE from 'three';
import { ANTHRO, SEGMENT_MASS, BONE_COLORS } from './constants.js';
import { createPelvis } from './pelvis.js';
import { createLegBones } from './leg.js';
import { createTorso } from './torso.js';
import { createBody, createSkinMaterial, createHeadGear } from './body.js';
import { createMuscles, MUSCLES } from './muscles.js';
import { computeMuscleLoad, applyMuscleActivation } from './biomech.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rad = (d) => d * Math.PI / 180;

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

/* ------------------------------------------------------------------ */
/* スキー板                                                            */
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
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const tTip = Math.max(0, (z - half * 0.70) / (half * 0.30));
    const tTail = Math.max(0, (-z - half * 0.84) / (half * 0.16));
    pos.setY(i, pos.getY(i) + 0.075 * tTip * tTip + 0.020 * tTail * tTail);
  }
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
  return ski;
}

/**
 * スキーブーツ。箱ひとつだと「板の上に載った四角」にしか見えないので、
 * ソール・ロアシェル・カフ（前傾したすねの筒）・バックルに分ける。
 * ローカル軸はスキーと同じ x=横・y=上・z=前で、原点はソール下面。
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
  return g;
}

/* ------------------------------------------------------------------ */
/* スキーヤー本体                                                      */
/* ------------------------------------------------------------------ */
export function createSkier(opts = {}) {
  const height = opts.height ?? ANTHRO.height;
  const disc = opts.discipline;
  const H = height;
  const seg = {
    thigh: ANTHRO.thigh * H,
    shank: ANTHRO.shank * H,
    trunk: ANTHRO.trunk * H,
    upperArm: ANTHRO.upperArm * H,
    foreArm: ANTHRO.foreArm * H,
    headR: ANTHRO.headR * H,
    shoulderW: ANTHRO.shoulderW * H,
    ankle: 0.115,          // ソール上面〜足関節中心
  };

  const root = new THREE.Group();
  root.name = 'skier';

  /* --- マテリアル --- */
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xe8eef7, roughness: 0.5 });
  // 下肢の骨は骨盤ビューでも見せたいので別マテリアルにする
  const legMat = new THREE.MeshStandardMaterial({ color: 0xeef3fa, roughness: 0.45 });
  const jointMat = new THREE.MeshStandardMaterial({ color: 0xc7d4e4, roughness: 0.45 });
  const outerMat = new THREE.MeshStandardMaterial({ color: BONE_COLORS.iliumOuter.hex, roughness: 0.45 });
  const innerMat = new THREE.MeshStandardMaterial({ color: BONE_COLORS.iliumInner.hex, roughness: 0.45 });
  const skinMat = createSkinMaterial(0x7799c6, 0.36);
  const gearMat = new THREE.MeshStandardMaterial({ color: 0x27354a, roughness: 0.55 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf2f6fb, roughness: 0.3, metalness: 0.1 });

  /* --- 骨格グループ --- */
  const skeleton = new THREE.Group(); skeleton.name = 'skeleton'; root.add(skeleton);
  const bodyG = new THREE.Group(); bodyG.name = 'body'; root.add(bodyG);
  const gearG = new THREE.Group(); gearG.name = 'gear'; root.add(gearG);

  /* 骨盤 */
  const pelvis = createPelvis(H);
  const pelvisNode = new THREE.Group();
  pelvisNode.add(pelvis.group);
  skeleton.add(pelvisNode);

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
  skull.scale.set(0.072 * (H / 1.75), 0.104 * (H / 1.75), 0.090 * (H / 1.75));
  for (const s of ['L', 'R']) {
    skeleton.add(humerus[s], ulna[s], elbow[s], shoulderB[s]);
  }
  skeleton.add(skull);

  /* 身体（半透明）：骨盤と椎骨にぶら下げた輪切りの列として作る。
     骨盤が回り、腰椎が曲がり、胸椎がひねれば、表面もそのとおりに変形する。 */
  const body = createBody(H, skinMat, { pelvis: pelvisNode, verts: torso.verts });
  bodyG.add(body.group);

  /* 装備：ヘルメット・ゴーグル・ブーツ・スキー・ストック */
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xe8c9a8, roughness: 0.75 });
  // レンズはミラー。金属度を上げて空を映す
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0x2a3d5c, roughness: 0.10, metalness: 0.92,
    emissive: 0x0d1a2e, side: THREE.DoubleSide,
    envMap: opts.env ?? null, envMapIntensity: 1.15 });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf24b3d, roughness: 0.45 });
  const strapMat = new THREE.MeshStandardMaterial({
    color: 0xf24b3d, roughness: 0.75, side: THREE.DoubleSide });
  const head = createHeadGear(H, { skin: faceMat, helmet: helmetMat,
    lens: lensMat, frame: frameMat, strap: strapMat });
  head.setChinGuard(disc.key === 'SL');   // SL はチンガード付きヘルメット
  gearG.add(head.group);

  /* グローブ */
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0x2b3a52, roughness: 0.7 });
  const gloves = { L: new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), gloveMat),
                   R: new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), gloveMat) };
  for (const k of ['L', 'R']) {
    gloves[k].scale.set(0.038, 0.042, 0.062);
    gloves[k].castShadow = true;
    gearG.add(gloves[k]);
  }

  const buckleMat = new THREE.MeshStandardMaterial({
    color: 0xc9d4e2, roughness: 0.32, metalness: 0.6,
    envMap: opts.env ?? null, envMapIntensity: 0.9 });
  const boots = { L: makeBoot(gearMat, buckleMat), R: makeBoot(gearMat, buckleMat) };
  const skis = {
    L: makeSki(disc.skiLength, disc.skiWaist, disc.skiShoulder, disc.skiTail, 0x1e6bd6),
    R: makeSki(disc.skiLength, disc.skiWaist, disc.skiShoulder, disc.skiTail, 0x1e6bd6),
  };
  const poles = {
    L: new THREE.Group(), R: new THREE.Group(),
  };
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xd9dee6, roughness: 0.3, metalness: 0.5 });
  for (const s of ['L', 'R']) {
    const shaft = makeLink(poleMat, 0.008);
    poles[s].userData.shaft = shaft;
    poles[s].add(shaft);
    gearG.add(boots[s], skis[s], poles[s]);
  }

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

  /* 重心マーカー */
  const comMarker = new THREE.Group();
  const comBall = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0xffd166 }),
  );
  const comRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.075, 0.007, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.8 }),
  );
  comMarker.add(comBall, comRing);
  root.add(comMarker);

  /* ---------------------------------------------------------------- */
  const state = { anchors: {}, angles: {} };
  let bodyVisible = true;       // 「身体」トグルの状態を覚えておく

  /** 姿勢を更新する。s は TurnModel.sample() の戻り値 */
  function update(s, cfg = {}) {
    const outwardIsRight = s.eLat.dot(s.outward) > 0;
    pelvis.setOuterSide(outwardIsRight);

    /* --- 骨盤のフレーム --- */
    // 上下軸：脚と上体の中間（外傾の 65 % を股関節、35 % を腰椎が担う想定）
    const hipShare = 0.65;
    const pelvisUp = s.legDir.clone().lerp(s.torsoDir, hipShare).normalize();
    // 前後軸：進行方向を骨盤面に投影し、外向角ぶん外側へ回す
    let fwd = s.tangent.clone().projectOnPlane(pelvisUp).normalize();
    fwd = rotateToward(fwd, s.outward, pelvisUp, s.counter).normalize();
    const right = new THREE.Vector3().crossVectors(fwd, pelvisUp).normalize();
    // three.js のオブジェクトは +Z を向くので、右手系の基底は（左, 上, 前）になる
    const left = right.clone().negate();
    const pelvisM = new THREE.Matrix4().makeBasis(left, pelvisUp, fwd);

    const pelvisPos = s.hip.clone();
    pelvisNode.position.copy(pelvisPos);
    pelvisNode.quaternion.setFromRotationMatrix(pelvisM);

    /* --- 股関節 --- */
    const hipR = pelvisPos.clone().addScaledVector(right, pelvis.hipHalfWidth)
      .addScaledVector(pelvisUp, -0.040 * pelvis.scale);
    const hipL = pelvisPos.clone().addScaledVector(right, -pelvis.hipHalfWidth)
      .addScaledVector(pelvisUp, -0.040 * pelvis.scale);

    /* --- スキーと足首 ---
     * 内スキーは外スキーより少し多く傾き、トップが前に出る（＝内足の先行）。
     * 先行量はエッジ角から決まる量なので、切り替えでは自然にそろう。 */
    const skiNormalOuter = rotateToward(s.normal, s.inward, s.tangent, s.edgeAngle).normalize();
    const feet = { R: s.footR.clone(), L: s.footL.clone() };
    const ankles = {}, skiCenters = {}, skiNormals = {};
    for (const side of ['L', 'R']) {
      const isOuter = (side === 'R') === outwardIsRight;
      const edge = isOuter ? s.edgeAngle : s.edgeAngleInner;
      const skiNormal = rotateToward(s.normal, s.inward, s.tangent, edge).normalize();
      // スキーのローカル軸：x = skiSide, y = skiNormal, z = tangent（右手系）
      const skiSide = new THREE.Vector3().crossVectors(skiNormal, s.tangent).normalize();
      skiNormals[side] = skiNormal;

      const lead = isOuter ? 0 : s.innerLead;
      const contact = feet[side].clone().addScaledVector(s.tangent, lead);
      // 接雪しているのはエッジ。板の中心はそこから半幅ぶん外側
      const toOutward = skiSide.dot(s.outward) > 0 ? 1 : -1;
      const center = contact.clone().addScaledVector(skiSide, toOutward * disc.skiWaist * 0.5);
      skiCenters[side] = center;
      ankles[side] = center.clone().addScaledVector(skiNormal, seg.ankle);

      const ski = skis[side];
      ski.position.copy(center);
      ski.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(skiSide, skiNormal, s.tangent));
      ski.userData.mat.color.set(isOuter ? 0xff6b57 : 0x2f7fe0);
      ski.userData.mat.emissive.set(isOuter ? 0x3a0f08 : 0x03101f);

      boots[side].position.copy(center).addScaledVector(skiNormal, 0.030);
      boots[side].quaternion.copy(ski.quaternion);
    }
    const skiNormal = skiNormalOuter;

    /* --- 脚（2 リンク IK） --- */
    // 脚を畳んでいるときほど、膝は前ではなく上（板の法線方向）へ抜ける
    const kneeHint = s.tangent.clone()
      .addScaledVector(skiNormal, 0.72 + 1.1 * (1 - s.loadNorm)).normalize();
    const hips = { L: hipL, R: hipR };
    const legBasis = {};
    for (const side of ['L', 'R']) {
      const kp = solveIK(hips[side], ankles[side], seg.thigh, seg.shank, kneeHint);
      kneePos[side].copy(kp);
      legBasis[side] = legs[side].update(hips[side], kp, ankles[side], kneeHint);
      state.angles[`knee${side}`] = Math.PI - angleBetween(
        hips[side].clone().sub(kp), ankles[side].clone().sub(kp));
    }

    /* --- 体幹 ---
     * 骨盤の上に脊柱を積み、側屈・回旋・屈曲を部位ごとの可動域比で配分する。
     * 回旋の主役は胸椎（腰椎はほとんど回らない）ので、
     * 「骨盤と肩の向きの差」は自然と胸のあたりで作られる。 */
    const sacralTop = pelvisPos.clone()
      .addScaledVector(pelvisUp, 0.050 * pelvis.scale)
      .addScaledVector(fwd, -0.028 * pelvis.scale);
    torso.group.position.copy(sacralTop);
    torso.group.quaternion.copy(pelvisNode.quaternion);

    // 側屈：外傾のうち脊柱が担うぶん（残りは股関節）。外側へ倒す向きが +
    const spineLateral = (1 - hipShare) * s.angulation
      * (right.dot(s.outward) > 0 ? -1 : 1);
    // 回旋：肩と骨盤の差。外側へ回す向きが +
    const spineAxial = ((s.counterSpine ?? s.counter) - s.counter)
      * (right.dot(s.outward) > 0 ? -1 : 1);
    // 屈曲：前傾の深さ（荷重が高いほど深く構える）
    const spineFlex = rad(14 + 16 * s.loadNorm);
    torso.update(spineLateral, spineAxial, spineFlex);

    /* 体幹から出てくるフレーム */
    const chestPos = new THREE.Vector3();
    torso.thoracic[torso.thoracic.length - 1].getWorldPosition(chestPos);
    const midThorax = new THREE.Vector3();
    torso.thoracic[Math.floor(torso.thoracic.length / 2)].getWorldPosition(midThorax);
    const lumbarBase = sacralTop.clone();

    const chestQuat = new THREE.Quaternion();
    torso.thoracic[torso.thoracic.length - 1].getWorldQuaternion(chestQuat);
    const chestFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chestQuat).normalize();
    const chestUp = new THREE.Vector3(0, 1, 0).applyQuaternion(chestQuat).normalize();
    const chestLeft = new THREE.Vector3(1, 0, 0).applyQuaternion(chestQuat).normalize();
    const chestRight = chestLeft.clone().negate();

    /* --- 肩・腕・ストック --- */
    const shoulderR = new THREE.Vector3(), shoulderL = new THREE.Vector3();
    torso.shoulders.R.getWorldPosition(shoulderR);
    torso.shoulders.L.getWorldPosition(shoulderL);
    shoulderB.R.position.copy(shoulderR); shoulderB.L.position.copy(shoulderL);

    const shoulders = { L: shoulderL, R: shoulderR };
    const elbows = {}, hands = {};
    for (const side of ['L', 'R']) {
      const sgn = side === 'R' ? 1 : -1;
      const isOuter = (side === 'R') === outwardIsRight;
      // 手は前方やや外側。外側の手は前に、内側の手は旗門をブロックする位置に
      const hand = shoulders[side].clone()
        .addScaledVector(chestFwd, isOuter ? 0.46 : 0.38)
        .addScaledVector(chestRight, sgn * 0.17)
        .addScaledVector(s.torsoDir, isOuter ? 0.00 : 0.06);
      const hint = chestFwd.clone().multiplyScalar(-0.4).addScaledVector(chestRight, sgn * 0.6)
        .addScaledVector(s.torsoDir, -0.5).normalize();
      const el = solveIK(shoulders[side], hand, seg.upperArm, seg.foreArm, hint);
      elbow[side].position.copy(el);
      humerus[side].userData.set(shoulders[side], el);
      ulna[side].userData.set(el, hand);
      elbows[side] = el; hands[side] = hand;
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
      setArm(armNode[side].upper, shoulders[side], el);
      setArm(armNode[side].fore, el, hand);
      // ストック：手から後方斜め下へ
      const tip = hand.clone()
        .addScaledVector(s.tangent, -1.00)
        .addScaledVector(s.normal, -0.40)
        .addScaledVector(chestRight, sgn * 0.10);
      poles[side].userData.shaft.userData.set(hand, tip);
    }

    /* --- 身体の表面 ---
     * 胴体は骨（骨盤・椎骨）の matrixWorld から輪切りを並べ直す。
     * 四肢は関節の 2 点から。 */
    root.updateMatrixWorld(true);
    body.update({
      hips, knees: { L: kneePos.L, R: kneePos.R }, ankles,
      legAnt: { L: legBasis.L.Z, R: legBasis.R.Z },
      shoulders, elbows, hands, armAnt: chestFwd,
    }, root.position);

    /* --- 頭：頸椎の上にのせ、次の旗門を見る --- */
    const headPos = new THREE.Vector3();
    torso.headMount.getWorldPosition(headPos);
    headPos.addScaledVector(chestUp, seg.headR * 0.85);
    skull.position.copy(headPos);
    head.group.position.copy(headPos);
    const lookDir = (cfg.lookTarget ? cfg.lookTarget.clone().sub(headPos) : s.tangent.clone()).normalize();
    // 頭は身体ほど傾けない（実際のスキーヤーも視線の水平を保つ）
    const headUp = s.normal.clone().lerp(chestUp, 0.3).normalize();
    const headRight = new THREE.Vector3().crossVectors(lookDir, headUp).normalize();
    const headFwd = new THREE.Vector3().crossVectors(headUp, headRight).normalize();
    head.group.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(headRight.clone().negate(), headUp, headFwd));

    /* グローブ：手の位置に、前腕の向きで置く */
    for (const side of ['L', 'R']) {
      const dir = hands[side].clone().sub(elbows[side]).normalize();
      gloves[side].position.copy(hands[side]).addScaledVector(dir, 0.026);
      gloves[side].quaternion.setFromUnitVectors(V(0, 0, 1), dir);
    }

    /* --- 重心：Dempster の質量比で実際の重心を求め、力学的な重心に合わせる --- */
    const actual = computeCoM({ hips, knees: { L: kneePos.L, R: kneePos.R },
      ankles, chestPos, lumbarBase, headPos, shoulders, midThorax,
      elbows: { L: elbow.L.position, R: elbow.R.position } });
    const fix = s.com.clone().sub(actual);
    if (fix.lengthSq() < 0.25) root.position.copy(fix);   // 誤差は数 cm 程度
    else root.position.set(0, 0, 0);

    comMarker.position.copy(s.com).sub(root.position);
    comRing.quaternion.setFromUnitVectors(V(0, 0, 1), s.uLeg.clone());

    /* --- ラベルのアンカー（ワールド座標。root の移動ぶんを足す） --- */
    const off = root.position;
    state.anchors = {
      pelvis: pelvisPos.clone().add(off),
      com: s.com.clone(),
      head: headPos.clone().add(off),
      outerFoot: (outwardIsRight ? feet.R : feet.L).clone().add(off),
      innerFoot: (outwardIsRight ? feet.L : feet.R).clone().add(off),
      outerKnee: (outwardIsRight ? kneePos.R : kneePos.L).clone().add(off),
      outerHip: (outwardIsRight ? hipR : hipL).clone().add(off),
      innerHip: (outwardIsRight ? hipL : hipR).clone().add(off),
      outerAnkle: (outwardIsRight ? ankles.R : ankles.L).clone().add(off),
      chest: chestPos.clone().add(off),
      asisMid: pelvisPos.clone().addScaledVector(fwd, 0.10).add(off),
      // ゴーグルとチンガードの外に出す（中に入ると視界が塞がる）
      eye: headPos.clone().addScaledVector(headFwd, seg.headR * 1.30)
        .addScaledVector(headUp, seg.headR * 0.20).add(off),
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
      const cpOuter = (outwardIsRight ? feet.R : feet.L).clone()
        .addScaledVector(s.tangent, s.cpOffset ?? 0);
      const cpInner = (outwardIsRight ? feet.L : feet.R).clone()
        .addScaledVector(s.tangent, (s.cpOffset ?? 0) + (s.innerLead ?? 0));
      const angByside = {};
      for (const sd of ['L', 'R']) {
        const fem = kneePos[sd].clone().sub(hips[sd]).normalize();
        const shin = ankles[sd].clone().sub(kneePos[sd]).normalize().negate();
        angByside[sd] = {
          hipFlexion: Math.atan2(fem.dot(fwd), -fem.dot(pelvisUp)),
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
        l5s1: sacralTop, comUpper,
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
      add(p.knees[s].clone().lerp(p.ankles[s], 0.433), SEGMENT_MASS.shank);    // 下腿
      add(p.ankles[s].clone(), SEGMENT_MASS.foot);                             // 足
      add(p.shoulders[s].clone().lerp(p.elbows[s], 0.436), SEGMENT_MASS.upperArm);
      add(p.elbows[s].clone(), SEGMENT_MASS.foreArmHand);
    }
    return acc.divideScalar(total);
  }

  function angleBetween(a, b) {
    return Math.acos(THREE.MathUtils.clamp(a.clone().normalize().dot(b.clone().normalize()), -1, 1));
  }

  return {
    root, pelvis, torso, muscles, update, state,
    groups: { skeleton, body: bodyG, gear: gearG, com: comMarker, muscles: muscleGroup },
    setMusclesVisible(v) { muscleGroup.visible = v; },
    setVisible({ skeleton: sk, body: bd, pelvis: pv, com }) {
      if (sk !== undefined) skeleton.visible = sk;
      if (bd !== undefined) { bodyVisible = bd; bodyG.visible = bd; }
      if (pv !== undefined) pelvisNode.visible = pv;
      if (com !== undefined) comMarker.visible = com;
    },
    /** 骨盤クローズアップ用に、骨盤以外を薄くする */
    setFocusPelvis(on) {
      skinMat.opacity = on ? 0.07 : 0.32;
      const list = [boneMat, jointMat, helmetMat, gearMat,
        skis.L.userData.mat, skis.R.userData.mat, poleMat];
      for (const m of list) {
        if (m.transparent !== on) m.needsUpdate = true;
        m.transparent = on; m.opacity = on ? 0.18 : 1; m.depthWrite = !on;
      }
      // 大腿骨は股関節の主役なので、骨盤ビューでもはっきり見せる
      if (legMat.transparent !== on) legMat.needsUpdate = true;
      legMat.transparent = on; legMat.opacity = on ? 0.92 : 1; legMat.depthWrite = true;
      // 骨盤ビューでは身体（半透明シェル）とストックを隠す
      bodyG.visible = on ? false : bodyVisible;
      for (const s2 of ['L', 'R']) { poles[s2].visible = !on; }
      pelvis.setOpacity(1);
    },
    setGhost(on) {
      const o = on ? 0.18 : 1;
      skinMat.opacity = on ? 0.10 : 0.32;
      for (const m of [boneMat, jointMat, helmetMat, gearMat, legMat,
        skis.L.userData.mat, skis.R.userData.mat, poleMat]) {
        if (m.transparent !== on) m.needsUpdate = true;
        m.transparent = on; m.opacity = o; m.depthWrite = !on;
      }
      pelvis.setOpacity(on ? 0.25 : 1);
    },
  };
}
