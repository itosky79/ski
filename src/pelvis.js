/**
 * pelvis.js — 色分けした骨盤モデル
 *
 * 骨盤ローカル座標
 *   +x : 右   +y : 上   +z : 前（骨盤の正面）
 * 寸法は身長 1.75 m を基準にした実測的な比率で作り、身長でスケールする。
 *
 * 部位と色は constants.js の BONE_COLORS に対応（凡例と一致させること）。
 *   仙骨 / 腸骨（外側・内側で色が入れ替わる）/ 坐骨 / 恥骨 / 大腿骨頭 / 上前腸骨棘(ASIS)
 */
import * as THREE from 'three';
import { BONE_COLORS } from './constants.js';

/** 骨っぽい質感のマテリアル */
function boneMat(hex, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: hex, roughness: 0.55, metalness: 0.02,
    emissive: new THREE.Color(hex).multiplyScalar(0.12),
    ...opts,
  });
}

/**
 * パラメトリック曲面から厚みのある「殻」ジオメトリを作る。
 * fn(u,v) -> Vector3 （u,v ∈ [0,1]）
 */
function shellGeometry(fn, nu = 14, nv = 14, thickness = 0.008) {
  const pos = [], idx = [];
  const P = (u, v) => fn(THREE.MathUtils.clamp(u, 0, 1), THREE.MathUtils.clamp(v, 0, 1));
  const normalAt = (u, v) => {
    const e = 1e-3;
    const du = P(u + e, v).sub(P(u - e, v));
    const dv = P(u, v + e).sub(P(u, v - e));
    const n = du.cross(dv);
    return n.lengthSq() > 1e-12 ? n.normalize() : new THREE.Vector3(0, 0, 1);
  };
  const grid = [];
  for (let i = 0; i <= nu; i++) {
    grid[i] = [];
    for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv;
      const p = P(u, v), n = normalAt(u, v);
      grid[i][j] = { p, n };
    }
  }
  const push = (p) => { pos.push(p.x, p.y, p.z); return pos.length / 3 - 1; };
  const front = [], back = [];
  for (let i = 0; i <= nu; i++) {
    front[i] = []; back[i] = [];
    for (let j = 0; j <= nv; j++) {
      const { p, n } = grid[i][j];
      front[i][j] = push(p.clone().addScaledVector(n, thickness / 2));
      back[i][j] = push(p.clone().addScaledVector(n, -thickness / 2));
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      idx.push(front[i][j], front[i + 1][j], front[i + 1][j + 1]);
      idx.push(front[i][j], front[i + 1][j + 1], front[i][j + 1]);
      idx.push(back[i][j], back[i + 1][j + 1], back[i + 1][j]);
      idx.push(back[i][j], back[i][j + 1], back[i + 1][j + 1]);
    }
  }
  // 縁を閉じる
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

/** 制御点列から Catmull-Rom 曲線上の点を返す関数を作る */
function curveFn(points) {
  const c = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return (t) => c.getPoint(THREE.MathUtils.clamp(t, 0, 1));
}

/** 制御点列に沿ったチューブ */
function tube(points, radius, seg = 24) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, seg, radius, 10, false);
}

/**
 * 骨盤を生成する。
 * 戻り値の group は身長 1 m 基準。呼び出し側で height を掛ける。
 */
export function createPelvis(height = 1.75) {
  const S = height / 1.75;                 // 1.75 m 基準のスケール
  const group = new THREE.Group();
  group.name = 'pelvis';

  const W = 0.086 * S;      // 股関節中心の左右半幅
  const labels = [];        // ラベルのアンカー
  const parts = {};

  const mats = {
    sacrum: boneMat(BONE_COLORS.sacrum.hex),
    iliumR: boneMat(BONE_COLORS.iliumOuter.hex),
    iliumL: boneMat(BONE_COLORS.iliumInner.hex),
    ischium: boneMat(BONE_COLORS.ischium.hex),
    pubis: boneMat(BONE_COLORS.pubis.hex),
    femurHead: boneMat(BONE_COLORS.femurHead.hex, { roughness: 0.3 }),
    asis: new THREE.MeshStandardMaterial({
      color: BONE_COLORS.asis.hex, roughness: 0.35,
      emissive: new THREE.Color(BONE_COLORS.asis.hex).multiplyScalar(0.55),
    }),
  };

  /* ---- 仙骨：腸骨の間に挟まるくさび形。前に凹んだ曲面 ---- */
  const sacrum = new THREE.Mesh(shellGeometry((u, v) => {
    // u: 上(0) → 下・尾骨(1)、v: 左(0) → 右(1)
    const y = 0.088 - 0.170 * u;
    const z = -0.050 - 0.042 * u + 0.030 * u * u;
    const halfW = 0.052 - 0.040 * u;
    const x = (v - 0.5) * 2 * halfW;
    const hollow = 0.018 * (1 - Math.pow((v - 0.5) * 2, 2));   // 前面のくぼみ
    return new THREE.Vector3(x * S, y * S, (z + hollow) * S);
  }, 12, 12, 0.024 * S), mats.sacrum);
  sacrum.name = 'sacrum';
  group.add(sacrum);
  parts.sacrum = [sacrum];
  labels.push({ key: 'sacrum', pos: new THREE.Vector3(0, 0.03 * S, -0.085 * S) });

  /* ---- 寛骨（腸骨・坐骨・恥骨）---- */
  for (const side of [1, -1]) {
    // 腸骨稜：PSIS → 腸骨結節 → ASIS
    const crest = curveFn([
      [0.040, 0.076, -0.074], [0.092, 0.090, -0.028],
      [0.126, 0.072, 0.026], [0.112, 0.036, 0.082],
    ]);
    // 下縁：仙腸関節 → 大坐骨切痕 → 寛骨臼
    const lower = curveFn([
      [0.026, -0.010, -0.066], [0.050, -0.034, -0.048],
      [0.074, -0.048, -0.016], [0.086, -0.042, 0.012],
    ]);

    const ilium = new THREE.Mesh(shellGeometry((u, v) => {
      const a = lower(u), b = crest(u);
      const p = a.clone().lerp(b, v);
      // 外側へふくらむ（腸骨の外面は凸、内面＝腸骨窩は凹）
      const bow = Math.sin(Math.PI * Math.pow(v, 0.85)) * (0.009 + 0.015 * u);
      p.x = (p.x + bow) * side;
      p.y *= 1; p.z += bow * 0.35;
      return p.multiply(new THREE.Vector3(S, S, S));
    }, 18, 14, 0.009 * S), side > 0 ? mats.iliumR : mats.iliumL);
    ilium.name = side > 0 ? 'ilium_R' : 'ilium_L';
    group.add(ilium);
    (side > 0 ? (parts.iliumR = []) : (parts.iliumL = [])).push(ilium);

    /* ASIS（上前腸骨棘） */
    const asis = new THREE.Mesh(new THREE.SphereGeometry(0.015 * S, 16, 12), mats.asis);
    asis.position.set(side * 0.114 * S, 0.036 * S, 0.084 * S);
    asis.name = side > 0 ? 'asis_R' : 'asis_L';
    group.add(asis);
    (parts.asis || (parts.asis = [])).push(asis);

    /* 坐骨：寛骨臼の下から後下方の坐骨結節へ */
    const isch = new THREE.Mesh(tube([
      [side * 0.084 * S, -0.050 * S, 0.002 * S],
      [side * 0.082 * S, -0.086 * S, -0.020 * S],
      [side * 0.066 * S, -0.112 * S, -0.028 * S],
      [side * 0.044 * S, -0.104 * S, 0.004 * S],
    ], 0.014 * S), mats.ischium);
    isch.name = side > 0 ? 'ischium_R' : 'ischium_L';
    group.add(isch);
    (parts.ischium || (parts.ischium = [])).push(isch);

    /* 恥骨：上枝（寛骨臼前方 → 恥骨結合）と下枝（坐骨から恥骨結合へ） */
    const pubSup = new THREE.Mesh(tube([
      [side * 0.080 * S, -0.038 * S, 0.026 * S],
      [side * 0.052 * S, -0.058 * S, 0.052 * S],
      [side * 0.016 * S, -0.068 * S, 0.058 * S],
      [side * 0.003 * S, -0.070 * S, 0.055 * S],
    ], 0.011 * S), mats.pubis);
    const pubInf = new THREE.Mesh(tube([
      [side * 0.044 * S, -0.104 * S, 0.004 * S],
      [side * 0.026 * S, -0.092 * S, 0.034 * S],
      [side * 0.006 * S, -0.076 * S, 0.052 * S],
    ], 0.010 * S), mats.pubis);
    pubSup.name = side > 0 ? 'pubis_R' : 'pubis_L';
    group.add(pubSup, pubInf);
    (parts.pubis || (parts.pubis = [])).push(pubSup, pubInf);

    /* 大腿骨頭（股関節の球） */
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.027 * S, 20, 16), mats.femurHead);
    head.position.set(side * W, -0.042 * S, 0.008 * S);
    head.name = side > 0 ? 'femurHead_R' : 'femurHead_L';
    group.add(head);
    (parts.femurHead || (parts.femurHead = [])).push(head);
  }
  labels.push({ key: 'asis', pos: new THREE.Vector3(0, 0.040 * S, 0.092 * S) });
  labels.push({ key: 'ischium', pos: new THREE.Vector3(0, -0.118 * S, -0.028 * S) });
  labels.push({ key: 'pubis', pos: new THREE.Vector3(0, -0.076 * S, 0.066 * S) });

  /* ---- ASIS を結ぶ線（骨盤の正面を示す基準線） ---- */
  const asisLine = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004 * S, 0.004 * S, 0.228 * S, 8),
    new THREE.MeshBasicMaterial({ color: BONE_COLORS.asis.hex, transparent: true, opacity: 0.85 }),
  );
  asisLine.rotation.z = Math.PI / 2;
  asisLine.position.set(0, 0.036 * S, 0.084 * S);
  asisLine.name = 'asisLine';
  group.add(asisLine);

  /* ---- 骨盤の正面を示す矢印 ---- */
  const facing = new THREE.Group();
  facing.name = 'facing';
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.010 * S, 0.010 * S, 0.30 * S, 10),
    new THREE.MeshBasicMaterial({ color: 0x4cc3ff }),
  );
  shaft.position.set(0, 0, 0.15 * S);
  shaft.rotation.x = Math.PI / 2;
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.026 * S, 0.075 * S, 14),
    new THREE.MeshBasicMaterial({ color: 0x4cc3ff }),
  );
  tip.position.set(0, 0, 0.335 * S);
  tip.rotation.x = Math.PI / 2;
  facing.add(shaft, tip);
  facing.position.set(0, 0.01 * S, 0);
  group.add(facing);

  return {
    group, parts, labels, facing, asisLine, hipHalfWidth: W, scale: S,
    /** ラベルのアンカーをワールド座標で返す */
    labelPoints() {
      group.updateWorldMatrix(true, false);
      return labels.map((l) => ({
        key: l.key,
        name: BONE_COLORS[l.key]?.name ?? l.key,
        pos: l.pos.clone().applyMatrix4(group.matrixWorld),
      }));
    },
    /** ターン外側の腸骨を強調色にする */
    setOuterSide(outerIsRight) {
      const oc = new THREE.Color(BONE_COLORS.iliumOuter.hex);
      const ic = new THREE.Color(BONE_COLORS.iliumInner.hex);
      mats.iliumR.color.copy(outerIsRight ? oc : ic);
      mats.iliumL.color.copy(outerIsRight ? ic : oc);
      mats.iliumR.emissive.copy(mats.iliumR.color).multiplyScalar(0.12);
      mats.iliumL.emissive.copy(mats.iliumL.color).multiplyScalar(0.12);
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
