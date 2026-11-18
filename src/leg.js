/**
 * leg.js — 下肢の骨（大腿骨・膝蓋骨・脛骨・腓骨）
 *
 * ■ なぜ棒ではなく骨の形にするか
 *   股関節は「骨盤のソケット（寛骨臼）に大腿骨頭がはまった球関節」で、
 *   大腿骨の軸は骨頭から外へ出っぱった頸部を介して斜めに下りている。
 *   この形を描かないと、外向・外傾のときに股関節で何が起きているのかが見えない。
 *
 * ■ ローカル座標（右脚）
 *   大腿骨グループ：原点＝大腿骨頭の中心、−Y＝膝へ向かう軸、+X＝左（＝左脚では外側）、+Z＝前
 *   脛骨グループ  ：原点＝膝関節中心、−Y＝足首へ向かう軸、+X＝左、+Z＝前
 *   （three.js のオブジェクトは +Z を向くので、右手系の基底は「左・上・前」になる）
 *   右脚は x を反転して使う。
 *
 * ■ 寸法（身長 1.75 m のとき、成人男性の実測値の目安）
 *   大腿骨長 42.9 cm／頸体角 約 126°／骨頭径 4.8 cm／顆部幅 7.5 cm
 *   脛骨長 43.1 cm／脛骨近位幅 7.2 cm
 */
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** 制御点に沿ったチューブ（骨幹に使用） */
function tube(points, r0, r1, seg = 20, radial = 10) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => V(...p)));
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false);
  // 半径を先端に向かって変える
  const pos = g.attributes.position;
  const tmp = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const t = (i / radial | 0) / seg;          // 0..1（チューブの進行方向）
    const c = curve.getPoint(Math.min(1, t));
    tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(c);
    tmp.setLength(THREE.MathUtils.lerp(r0, r1, t));
    tmp.add(c);
    pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  g.computeVertexNormals();
  return g;
}

function ellipsoid(rx, ry, rz, seg = 16) {
  const g = new THREE.SphereGeometry(1, seg, Math.max(8, seg - 4));
  g.scale(rx, ry, rz);
  return g;
}

/**
 * 片脚の骨を作る。
 * @param {number} H   身長 [m]
 * @param {number} side +1 = 右、−1 = 左
 * @param {THREE.Material} mat 骨のマテリアル
 */
export function createLegBones(H, side, mat) {
  const S = H / 1.75;
  const L = 0.245 * H;       // 大腿骨長（骨頭中心〜膝関節中心）
  const Ls = 0.246 * H;      // 脛骨長（膝関節中心〜足関節中心）
  const meshes = [];
  const add = (parent, geo, pos, rot) => {
    const m = new THREE.Mesh(geo, mat);
    if (pos) m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    parent.add(m); meshes.push(m);
    return m;
  };

  /* ---------------- 大腿骨 ---------------- */
  const femur = new THREE.Group();
  femur.name = 'femur';

  // 骨頭（球）— 寛骨臼にはまる部分
  add(femur, new THREE.SphereGeometry(0.024 * S, 22, 16), [0, 0, 0]);
  // 頸部：骨頭から外下方へ（頸体角 約126°）
  const neckEnd = [0.042 * S, -0.026 * S, -0.004 * S];
  add(femur, tube([[0, 0, 0], [0.022 * S, -0.014 * S, -0.002 * S], neckEnd],
    0.017 * S, 0.015 * S, 8), null);
  // 大転子：外側上方の大きな出っぱり（中殿筋が付く）
  add(femur, ellipsoid(0.019 * S, 0.028 * S, 0.018 * S), [0.052 * S, -0.012 * S, -0.004 * S]);
  // 小転子：内側後方の小さな出っぱり（腸腰筋が付く）
  add(femur, ellipsoid(0.011 * S, 0.013 * S, 0.010 * S), [0.012 * S, -0.058 * S, -0.018 * S]);
  // 骨幹：前へわずかに弓なり、内側へ下る
  add(femur, tube([
    [0.046 * S, -0.050 * S, -0.002 * S],
    [0.030 * S, -L * 0.35, 0.008 * S],
    [0.014 * S, -L * 0.70, 0.006 * S],
    [0.002 * S, -L + 0.020 * S, -0.002 * S],
  ], 0.016 * S, 0.014 * S, 24), null);
  // 内側顆・外側顆（膝の関節面）
  add(femur, ellipsoid(0.019 * S, 0.021 * S, 0.024 * S), [-0.021 * S, -L + 0.004 * S, -0.004 * S]);
  add(femur, ellipsoid(0.019 * S, 0.021 * S, 0.024 * S), [0.021 * S, -L + 0.004 * S, -0.004 * S]);
  // 膝蓋面（顆の前の滑車）
  add(femur, ellipsoid(0.022 * S, 0.016 * S, 0.012 * S), [0, -L + 0.012 * S, 0.016 * S]);

  /* ---------------- 脛骨・腓骨・膝蓋骨 ---------------- */
  const shank = new THREE.Group();
  shank.name = 'shank';
  // 脛骨高原（上の平らな関節面）
  add(shank, ellipsoid(0.030 * S, 0.010 * S, 0.026 * S), [0, -0.008 * S, -0.002 * S]);
  // 脛骨粗面（膝下の出っぱり。膝蓋腱が付く）
  add(shank, ellipsoid(0.010 * S, 0.014 * S, 0.008 * S), [0, -0.045 * S, 0.022 * S]);
  // 脛骨体
  add(shank, tube([
    [0, -0.020 * S, 0.004 * S],
    [-0.002 * S, -Ls * 0.45, 0.006 * S],
    [-0.006 * S, -Ls * 0.80, 0.002 * S],
    [-0.008 * S, -Ls + 0.008 * S, 0],
  ], 0.017 * S, 0.012 * S, 20), null);
  // 内果（内くるぶし）
  add(shank, ellipsoid(0.012 * S, 0.016 * S, 0.012 * S), [-0.016 * S, -Ls + 0.004 * S, 0]);
  // 腓骨（外側の細い骨）と外果（外くるぶし）
  add(shank, tube([
    [0.024 * S, -0.038 * S, -0.008 * S],
    [0.026 * S, -Ls * 0.5, -0.006 * S],
    [0.024 * S, -Ls + 0.004 * S, -0.002 * S],
  ], 0.007 * S, 0.008 * S, 14, 8), null);
  add(shank, ellipsoid(0.010 * S, 0.016 * S, 0.011 * S), [0.024 * S, -Ls + 0.002 * S, 0]);

  // 膝蓋骨（膝の皿）
  const patella = new THREE.Mesh(ellipsoid(0.021 * S, 0.023 * S, 0.010 * S, 14), mat);
  meshes.push(patella);

  /* ローカル +x は「左」なので、鏡像にするのは右脚のほう */
  if (side > 0) { femur.scale.x = -1; shank.scale.x = -1; }

  const group = new THREE.Group();
  group.add(femur, shank, patella);

  /** 股関節・膝・足首の位置から骨を配置する */
  function update(hip, knee, ankle, kneeAxisHint) {
    // 前方（膝が向いている側）を推定する
    const mid = hip.clone().add(ankle).multiplyScalar(0.5);
    let ant = knee.clone().sub(mid);
    if (ant.lengthSq() < 1e-8) ant = kneeAxisHint.clone();
    ant.normalize();

    const setBasis = (obj, from, to) => {
      const Y = from.clone().sub(to).normalize();            // 骨の軸（上向き）
      const Z = ant.clone().sub(Y.clone().multiplyScalar(ant.dot(Y))).normalize();
      const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
      obj.position.copy(from);
      obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
      return { X, Y, Z };
    };
    const fb = setBasis(femur, hip, knee);
    setBasis(shank, knee, ankle);

    // 膝蓋骨は膝の少し前、大腿と下腿の中間の向き
    patella.position.copy(knee)
      .addScaledVector(ant, 0.040 * S)
      .addScaledVector(fb.Y, 0.012 * S);
    patella.quaternion.copy(femur.quaternion);
    return fb;
  }

  return { group, femur, shank, patella, update, meshes, femurLength: L, shankLength: Ls };
}
