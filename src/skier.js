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

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

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
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0x4f7ab0, roughness: 0.7, transparent: true, opacity: 0.32,
    depthWrite: false, side: THREE.DoubleSide,
  });
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

  /* 脊柱 */
  const spineSegs = [];
  for (let i = 0; i < 6; i++) {
    const m = makeLink(new THREE.MeshStandardMaterial({
      color: BONE_COLORS.spine.hex, roughness: 0.5,
    }), 0.019 * (1 - i * 0.05));
    skeleton.add(m); spineSegs.push(m);
  }
  /* 胸郭 */
  const ribCage = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0xdde6f2, roughness: 0.6, transparent: true, opacity: 0.55 }),
  );
  skeleton.add(ribCage);

  /* 下肢：大腿骨・膝蓋骨・脛骨・腓骨（解剖学的な形） */
  const legs = { L: createLegBones(H, -1, legMat), R: createLegBones(H, 1, legMat) };
  skeleton.add(legs.L.group, legs.R.group);
  const kneePos = { L: new THREE.Vector3(), R: new THREE.Vector3() };

  /* 上肢の骨 */
  const humerus = { L: makeLink(boneMat, 0.017), R: makeLink(boneMat, 0.017) };
  const ulna = { L: makeLink(boneMat, 0.014), R: makeLink(boneMat, 0.014) };
  const elbow = { L: makeBall(jointMat, 0.023), R: makeBall(jointMat, 0.023) };
  const shoulderB = { L: makeBall(jointMat, 0.028), R: makeBall(jointMat, 0.028) };
  const clavicle = makeLink(boneMat, 0.013);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(seg.headR, 18, 14), boneMat);
  for (const s of ['L', 'R']) {
    skeleton.add(humerus[s], ulna[s], elbow[s], shoulderB[s]);
  }
  skeleton.add(clavicle, skull);

  /* 身体（半透明） */
  const fleshThigh = { L: makeLink(skinMat, 0.085, 0.8), R: makeLink(skinMat, 0.085, 0.8) };
  const fleshShank = { L: makeLink(skinMat, 0.062, 0.7), R: makeLink(skinMat, 0.062, 0.7) };
  const fleshArm = { L: makeLink(skinMat, 0.048, 0.85), R: makeLink(skinMat, 0.048, 0.85) };
  const fleshFore = { L: makeLink(skinMat, 0.040, 0.85), R: makeLink(skinMat, 0.040, 0.85) };
  const torsoMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), skinMat);
  const hipMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), skinMat);
  bodyG.add(torsoMesh, hipMesh);
  for (const s of ['L', 'R']) bodyG.add(fleshThigh[s], fleshShank[s], fleshArm[s], fleshFore[s]);

  /* 装備：ヘルメット・ブーツ・スキー・ストック */
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(seg.headR * 1.22, 20, 16), helmetMat);
  helmet.scale.set(1, 1.05, 1.12);
  gearG.add(helmet);

  const boots = {
    L: new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.21, 0.30), gearMat),
    R: new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.21, 0.30), gearMat),
  };
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

      boots[side].position.copy(center).addScaledVector(skiNormal, 0.125);
      boots[side].quaternion.copy(ski.quaternion);
    }
    const skiNormal = skiNormalOuter;

    /* --- 脚（2 リンク IK） --- */
    const kneeHint = s.tangent.clone().addScaledVector(skiNormal, 0.72).normalize();
    const hips = { L: hipL, R: hipR };
    const legBasis = {};
    for (const side of ['L', 'R']) {
      const kp = solveIK(hips[side], ankles[side], seg.thigh, seg.shank, kneeHint);
      kneePos[side].copy(kp);
      legBasis[side] = legs[side].update(hips[side], kp, ankles[side], kneeHint);
      fleshThigh[side].userData.set(hips[side], kp);
      fleshShank[side].userData.set(kp, ankles[side]);
      state.angles[`knee${side}`] = Math.PI - angleBetween(
        hips[side].clone().sub(kp), ankles[side].clone().sub(kp));
    }

    /* --- 脊柱・胸郭 --- */
    const lumbarBase = pelvisPos.clone().addScaledVector(pelvisUp, 0.055 * pelvis.scale);
    const chestPos = lumbarBase.clone().addScaledVector(s.torsoDir, seg.trunk * 0.92);
    // 肩は骨盤よりさらに大きく谷を向く（実測でも上体の外向は骨盤の約 2 倍）
    const spineExtra = (s.counterSpine ?? s.counter) - s.counter;
    let chestFwd = rotateToward(fwd, s.outward, s.torsoDir, spineExtra).normalize();
    chestFwd = chestFwd.projectOnPlane(s.torsoDir).normalize();
    const chestRight = new THREE.Vector3().crossVectors(chestFwd, s.torsoDir).normalize();
    const chestLeft = chestRight.clone().negate();

    for (let i = 0; i < spineSegs.length; i++) {
      const t0 = i / spineSegs.length, t1 = (i + 1) / spineSegs.length;
      const a = lumbarBase.clone().lerp(chestPos, t0);
      const b = lumbarBase.clone().lerp(chestPos, t1);
      // 腰椎側屈を少し曲線にする
      const bow = Math.sin(Math.PI * (t0 + t1) / 2) * 0.03 * pelvis.scale;
      a.addScaledVector(chestFwd, bow); b.addScaledVector(chestFwd, bow);
      spineSegs[i].userData.set(a, b);
    }
    ribCage.position.copy(lumbarBase.clone().lerp(chestPos, 0.62));
    ribCage.scale.set(seg.shoulderW * 0.42, seg.trunk * 0.33, seg.shoulderW * 0.30);
    ribCage.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(chestLeft, s.torsoDir, chestFwd));

    torsoMesh.position.copy(lumbarBase.clone().lerp(chestPos, 0.52));
    torsoMesh.scale.set(seg.shoulderW * 0.46, seg.trunk * 0.62, seg.shoulderW * 0.34);
    torsoMesh.quaternion.copy(ribCage.quaternion);
    hipMesh.position.copy(pelvisPos);
    hipMesh.scale.set(0.17, 0.13, 0.15);
    hipMesh.quaternion.copy(pelvisNode.quaternion);

    /* --- 肩・腕・ストック --- */
    const shoulderR = chestPos.clone().addScaledVector(chestRight, seg.shoulderW / 2);
    const shoulderL = chestPos.clone().addScaledVector(chestRight, -seg.shoulderW / 2);
    clavicle.userData.set(shoulderL, shoulderR);
    shoulderB.R.position.copy(shoulderR); shoulderB.L.position.copy(shoulderL);

    const shoulders = { L: shoulderL, R: shoulderR };
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
      fleshArm[side].userData.set(shoulders[side], el);
      fleshFore[side].userData.set(el, hand);
      // ストック：手から後方斜め下へ
      const tip = hand.clone()
        .addScaledVector(s.tangent, -1.00)
        .addScaledVector(s.normal, -0.40)
        .addScaledVector(chestRight, sgn * 0.10);
      poles[side].userData.shaft.userData.set(hand, tip);
    }

    /* --- 頭：次の旗門を見る --- */
    const headPos = chestPos.clone().addScaledVector(s.torsoDir, seg.headR * 2.05);
    skull.position.copy(headPos);
    helmet.position.copy(headPos);
    const lookDir = (cfg.lookTarget ? cfg.lookTarget.clone().sub(headPos) : s.tangent.clone()).normalize();
    // 頭は身体ほど傾けない（実際のスキーヤーも視線の水平を保つ）
    const headUp = s.normal.clone().lerp(s.torsoDir, 0.3).normalize();
    const headRight = new THREE.Vector3().crossVectors(lookDir, headUp).normalize();
    const headFwd = new THREE.Vector3().crossVectors(headUp, headRight).normalize();
    helmet.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(headRight.clone().negate(), headUp, headFwd));

    /* --- 重心：Dempster の質量比で実際の重心を求め、力学的な重心に合わせる --- */
    const actual = computeCoM({ hips, knees: { L: kneePos.L, R: kneePos.R },
      ankles, chestPos, lumbarBase, headPos, shoulders,
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
      eye: headPos.clone().addScaledVector(headFwd, seg.headR * 0.85)
        .addScaledVector(headUp, seg.headR * 0.25).add(off),
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
    // 体幹＋頭：腰椎基部〜頭の間に分布
    add(p.lumbarBase.clone().lerp(p.chestPos, 0.55), SEGMENT_MASS.trunkHead * 0.86);
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
    root, pelvis, update, state,
    groups: { skeleton, body: bodyG, gear: gearG, com: comMarker },
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
