/**
 * torso.js — 体幹（脊柱・胸郭・肩甲帯）
 *
 * ■ なぜ 1 つの塊ではだめか
 *   上体は「傾ける」だけでなく、どこで曲げ、どこでひねるかで重心の位置が変わる。
 *   しかも部位ごとに動ける量がまったく違う。
 *     ・回旋（ひねり）：腰椎はほとんど回らない（全体で 5〜13°）。回旋の主役は胸椎（35〜40°）。
 *     ・側屈（横曲げ）：腰椎と胸椎が半々。
 *     ・屈曲（前後）  ：腰椎が大きい。
 *   つまり「骨盤と肩の向きの差」は、腰ではなく<b>胸椎と股関節</b>で作られる。
 *   これを見せるために、椎骨を 1 個ずつ連結した鎖として作る。
 *
 * ■ 構成
 *   腰椎 5 + 胸椎 12 + 頸椎 7 ＝ 24 個の椎骨（椎体＋棘突起）
 *   肋骨 12 対（胸椎に連結）、胸骨、鎖骨、肩甲骨
 *
 * ■ 座標系（各椎骨のローカル）
 *   +x = 左、+y = 上（脊柱の軸）、+z = 前
 */
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rad = (d) => d * Math.PI / 180;

/**
 * 複数のジオメトリを 1 つにまとめる（描画コールを減らすため）。
 * 互いに動かない部品どうしだけをまとめること。
 */
function mergeGeos(entries) {
  let total = 0;
  const parts = entries.map(({ geo, matrix }) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (matrix) g.applyMatrix4(matrix);
    g.computeVertexNormals();
    total += g.attributes.position.count;
    return g;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o);
    nor.set(g.attributes.normal.array, o);
    o += g.attributes.position.count * 3;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

/** 位置と回転を与えてジオメトリの行列を作る */
function mat(px, py, pz, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4();
  m.makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  m.setPosition(px, py, pz);
  return m;
}

/* 椎骨の region 定義：[名前, 本数, 節の高さ, 椎体半径, 基本の前後カーブ(度/椎骨)] */
const REGIONS = [
  { key: 'lumbar',   n: 5,  h: 0.040, r: 0.025, curve: -7.5 },   // 腰椎前弯
  { key: 'thoracic', n: 12, h: 0.025, r: 0.018, curve: +3.0 },   // 胸椎後弯
  { key: 'cervical', n: 7,  h: 0.020, r: 0.012, curve: -3.2 },   // 頸椎前弯
];

/* 可動域の配分（合計 1.0）。実際の脊柱の可動域比に合わせてある */
const SHARE = {
  axial:   { lumbar: 0.10, thoracic: 0.65, cervical: 0.25 },   // 回旋
  lateral: { lumbar: 0.50, thoracic: 0.42, cervical: 0.08 },   // 側屈
  flexion: { lumbar: 0.45, thoracic: 0.30, cervical: 0.25 },   // 屈曲
};

/* 胸郭の形（T1〜T12 の半幅と前方への到達距離） */
/* 実測の胸郭：横径 約 28 cm、前後径 約 21 cm（T6〜T8 が最大） */
const THORAX_W = [0.070, 0.086, 0.100, 0.114, 0.126, 0.134, 0.140, 0.140, 0.133, 0.120, 0.100, 0.080];
const THORAX_A = [0.070, 0.086, 0.100, 0.112, 0.124, 0.134, 0.140, 0.140, 0.132, 0.118, 0.086, 0.060];

/**
 * 断面が楕円のチューブ。肋骨は丸い棒ではなく<b>平たい板</b>なので、
 * 厚みの薄いほうを胸郭の外向きに合わせる。
 * @param {THREE.Curve} curve 中心線
 * @param {number} hUp  上下方向の半径（肋骨の「高さ」）
 * @param {number} hOut 外向きの半径（肋骨の「厚み」）
 */
function flatTube(curve, segs, hUp, hOut, radial = 8) {
  const pos = [], idx = [];
  const T = new THREE.Vector3(), R = new THREE.Vector3(), U = new THREE.Vector3();
  const P = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, P);
    curve.getTangentAt(u, T).normalize();
    // 脊柱の軸（x=0,z=0 の縦線）から見た外向き
    R.set(P.x, 0, P.z);
    if (R.lengthSq() < 1e-8) R.set(0, 0, -1);
    R.addScaledVector(T, -R.dot(T)).normalize();
    U.crossVectors(T, R).normalize();
    // 前端（胸骨側）は細くする
    const taper = 0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, u * 1.15));
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const c = Math.cos(th) * hUp * taper, sn = Math.sin(th) * hOut * taper;
      pos.push(P.x + U.x * c + R.x * sn, P.y + U.y * c + R.y * sn, P.z + U.z * c + R.z * sn);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function ribCurve(i, side, S) {
  const w = THORAX_W[i] * S, a = THORAX_A[i] * S;
  const floating = i >= 10;
  const pts = [
    V(side * 0.018 * S, 0, -0.012 * S),
    V(side * w * 0.55, -0.012 * S, -0.032 * S),
    V(side * w, -0.030 * S, 0.012 * S),
    V(side * w * 0.72, -0.046 * S, a * 0.72),
  ];
  if (!floating) pts.push(V(side * 0.024 * S, -0.054 * S, a));
  else pts[3] = V(side * w * 0.80, -0.050 * S, a * 0.45);
  return new THREE.CatmullRomCurve3(pts);
}

/**
 * 体幹を作る。
 * @param {number} H 身長 [m]
 * @param {THREE.Material} boneMat 骨のマテリアル
 */
export function createTorso(H, boneMat, discMat) {
  const S = H / 1.75;
  const root = new THREE.Group();
  root.name = 'torso';

  const verts = [];          // 椎骨のグループ（下から順）
  let parent = root;
  for (const reg of REGIONS) {
    for (let i = 0; i < reg.n; i++) {
      const g = new THREE.Group();
      g.userData.region = reg.key;
      g.userData.height = reg.h * S;
      g.userData.curve = rad(reg.curve);
      g.position.y = reg.h * S;          // 1 つ下の椎骨からの積み上げ
      parent.add(g);
      parent = g;

      // 椎体・棘突起・横突起は互いに動かないので 1 つにまとめる
      const spNlen = (reg.key === 'thoracic' ? 0.040 : reg.key === 'lumbar' ? 0.034 : 0.022) * S;
      const parts = [
        { geo: new THREE.CylinderGeometry(reg.r * S, reg.r * S * 1.04, reg.h * S * 0.68, 14) },
        { geo: new THREE.CylinderGeometry(0.004 * S, 0.006 * S, spNlen, 8),
          matrix: mat(0, -0.004 * S, -(reg.r * S + spNlen * 0.42),
            rad(reg.key === 'thoracic' ? -68 : -80), 0, 0) },
      ];
      for (const sx of [1, -1]) {
        parts.push({ geo: new THREE.CylinderGeometry(0.004 * S, 0.005 * S, 0.026 * S, 8),
          matrix: mat(sx * (reg.r * S + 0.012 * S), 0, -0.006 * S, 0, 0, Math.PI / 2) });
      }
      g.add(new THREE.Mesh(mergeGeos(parts), boneMat));
      // 椎間板（色が違うので別）
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(reg.r * S * 0.97, reg.r * S * 0.97, reg.h * S * 0.30, 14), discMat);
      disc.position.y = reg.h * S * 0.49;
      g.add(disc);
      verts.push(g);
    }
  }

  const L = REGIONS[0].n, T = REGIONS[1].n;
  const thoracic = verts.slice(L, L + T);           // T12(下) → T1(上) の順

  /* ---- 肋骨：各胸椎にぶら下げる ---- */
  const ribMeshes = [];
  for (let k = 0; k < T; k++) {
    const level = T - 1 - k;                         // thoracic[k] は T(12-k)
    const vg = thoracic[k];
    // 肋骨の断面：高さ 約 12 mm × 厚み 約 5 mm（実際の肋骨と同じく平たい板）
    const pair = [1, -1].map((side) => ({
      geo: flatTube(ribCurve(level, side, S), 26, 0.0062 * S, 0.0026 * S),
    }));
    const rib = new THREE.Mesh(mergeGeos(pair), boneMat);
    vg.add(rib);
    ribMeshes.push(rib);
  }

  /* ---- 胸骨（T4 あたりにぶら下げる） ---- */
  const sternumHost = thoracic[T - 5] || thoracic[0];
  const sternum = new THREE.Mesh(mergeGeos([
    { geo: new THREE.BoxGeometry(0.048 * S, 0.042 * S, 0.010 * S),
      matrix: mat(0, 0.052 * S, 0.128 * S) },
    { geo: new THREE.BoxGeometry(0.034 * S, 0.100 * S, 0.009 * S),
      matrix: mat(0, -0.020 * S, 0.134 * S) },
    { geo: new THREE.ConeGeometry(0.012 * S, 0.026 * S, 8),
      matrix: mat(0, -0.082 * S, 0.128 * S, Math.PI, 0, 0) },
  ]), boneMat);
  sternumHost.add(sternum);

  /* ---- 鎖骨・肩甲骨（T1〜T2 にぶら下げる） ---- */
  const girdleHost = thoracic[T - 2] || thoracic[T - 1];
  const shoulders = {};
  for (const side of [1, -1]) {
    const key = side > 0 ? 'L' : 'R';
    const g = new THREE.Group();
    // 鎖骨：胸骨端から肩峰へ S 字
    const clav = new THREE.Mesh(new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        V(side * 0.012 * S, 0.026 * S, 0.112 * S),
        V(side * 0.060 * S, 0.034 * S, 0.104 * S),
        V(side * 0.125 * S, 0.030 * S, 0.062 * S),
        V(side * 0.172 * S, 0.020 * S, 0.014 * S),
      ]), 16, 0.007 * S, 8, false), boneMat);
    g.add(clav);
    // 肩甲骨：背中側の三角形の板
    const scap = new THREE.Mesh(shoulderBlade(S, side), boneMat);
    scap.position.set(0, 0, 0);
    g.add(scap);
    girdleHost.add(g);
    // 肩関節（肩峰の少し下）の位置を保持
    const joint = new THREE.Object3D();
    joint.position.set(side * 0.190 * S, 0.004 * S, 0.000 * S);
    g.add(joint);
    shoulders[key] = joint;
  }

  /* ---- 頭がのる位置（C1 の上） ---- */
  const headMount = new THREE.Object3D();
  headMount.position.set(0, 0.020 * S, 0.004 * S);
  verts[verts.length - 1].add(headMount);

  /**
   * 体幹の姿勢を更新する。
   * @param {number} lateral 側屈の合計 [rad]（+ で右へ倒れる）
   * @param {number} axial   回旋の合計 [rad]（+ で右へひねる）
   * @param {number} flexion 屈曲の合計 [rad]（+ で前屈）
   */
  function update(lateral, axial, flexion) {
    for (const g of verts) {
      const reg = g.userData.region;
      const n = REGIONS.find((r) => r.key === reg).n;
      const roll = lateral * SHARE.lateral[reg] / n;
      const yaw = axial * SHARE.axial[reg] / n;
      const pitch = flexion * SHARE.flexion[reg] / n + g.userData.curve;
      g.rotation.set(pitch, yaw, roll, 'YXZ');
    }
    root.updateMatrixWorld(true);
  }
  update(0, 0, 0);

  return {
    group: root, verts, thoracic, shoulders, headMount, ribMeshes, update,
    /** 脊柱の総高さ（仙骨上端から C1 まで） */
    height: verts.reduce((a, g) => a + g.userData.height, 0),
  };
}

/**
 * 肩甲骨。平らな板ではなく<b>胸郭に沿って湾曲した三角形の骨</b>なので、
 * 外側ほど前へ回り込ませる（z を x² に比例して前に出す）。
 * 肩甲棘（背中側に出っ張る稜線）と肩峰も付ける。これがないと凧にしか見えない。
 * 実測の目安：内外径 約 10 cm、上下径 約 14 cm、上角が T2・下角が T7 の高さ。
 */
function shoulderBlade(S, side) {
  const shape = new THREE.Shape();
  shape.moveTo(0.016, 0.036);          // 上角
  shape.quadraticCurveTo(0.070, 0.036, 0.100, 0.020);   // 上縁 → 肩峰側
  shape.quadraticCurveTo(0.104, -0.010, 0.086, -0.036); // 外側縁（関節窩の下）
  shape.quadraticCurveTo(0.052, -0.092, 0.028, -0.104); // 下角へ
  shape.quadraticCurveTo(0.012, -0.070, 0.010, -0.014); // 内側縁（脊柱側）
  shape.closePath();
  const blade = new THREE.ExtrudeGeometry(shape, {
    depth: 0.0045, curveSegments: 6,
    bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0016, bevelSegments: 1,
  });
  // 肩甲棘：上のほうを横切る稜線（背中側へ出っ張る）
  const spine = new THREE.BoxGeometry(0.088, 0.012, 0.014);
  spine.translate(0.056, 0.012, -0.010);
  // 肩峰：肩の上をおおう出っ張り
  const acro = new THREE.BoxGeometry(0.030, 0.011, 0.020);
  acro.translate(0.103, 0.019, -0.006);
  const geo = mergeGeos([{ geo: blade }, { geo: spine }, { geo: acro }]);

  // 形状 (x=外, y=上, 厚み=前後) → ワールド：x=左右, y=上, z=前
  geo.scale(side * S, S, S);
  // 胸郭に巻きつける：外側ほど前へ
  const K = 2.6 / S;
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, pos.getZ(i) + K * x * x);
  }
  geo.computeVertexNormals();
  geo.translate(0, 0.012 * S, -0.048 * S);
  return geo;
}
