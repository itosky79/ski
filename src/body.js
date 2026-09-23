/**
 * body.js — 身体の表面（皮膚）
 *
 * ■ なぜ球を並べるのをやめたか
 *   胴体を「腹の球＋胸の球」で近似すると、外傾（横曲げ）も外向（ひねり）も
 *   形に出ない。上体は椎骨 24 個の鎖として動いているのに、表面がそれを
 *   写していなければ「腰から上で何が起きているか」が見えない。
 *
 * ■ どう作るか
 *   胴体の表面を、骨盤と各椎骨に <b>ぶら下げた輪切り（リング）</b> の列として持つ。
 *   リングの座標はその骨のローカル座標で固定してあるので、
 *   骨盤が回り、腰椎が横に曲がり、胸椎がひねれば、表面もそのとおりに変形する。
 *   四肢は関節の 2 点から毎フレーム輪切りを並べ直す。
 *
 * ■ 輪切りの形
 *   人の胴体の断面は楕円ではない。背中は平ら、腹は丸く、前後で深さが違う。
 *   そこで「前後で半径を変えた超楕円」で近似する。
 *       x = w  · sgn(sinθ)|sinθ|^(2/n)          （横幅）
 *       z = cz + d(θ) · sgn(cosθ)|cosθ|^(2/n)   （前後、d は前後で切替）
 *   n = 2 で楕円、n を大きくすると角ばる（胸郭は 2.5 前後）。
 *
 * ■ 寸法の出典
 *   胸郭・腰・腰まわりの周径は成人男性の人体計測値に合わせている。
 *   胸幅 約 32 cm・胸厚 約 21 cm、腰幅 約 27 cm・腰厚 約 20 cm、
 *   腰まわり（大転子の高さ）幅 約 35 cm。
 *   （D. A. Winter, *Biomechanics and Motor Control of Human Movement*, 4th ed.,
 *    および NASA-STD-3000 Man-Systems Integration Standards の成人男性値）
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* 輪切りの形                                                          */
/* ------------------------------------------------------------------ */

/**
 * 1 枚の輪切りの頂点（ローカル座標）を作る。
 * @param {number} radial 分割数
 * @param {Object} p {w 半幅, df 前の深さ, db 後ろの深さ, cx 横のずれ, cz 前後のずれ, n 角ばり}
 */
function ringPoints(radial, p) {
  const { w, df, db = df, cx = 0, cz = 0, n = 2.3 } = p;
  const e = 2 / n;
  const out = new Float32Array(radial * 3);
  for (let j = 0; j < radial; j++) {
    const t = (j / radial) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    const d = ct >= 0 ? df : db;
    out[j * 3] = cx + w * Math.sign(st) * Math.pow(Math.abs(st), e);
    out[j * 3 + 1] = 0;
    out[j * 3 + 2] = cz + d * Math.sign(ct) * Math.pow(Math.abs(ct), e);
  }
  return out;
}

/** リングを積み上げた閉じた筒のインデックスを作る（両端はファンで塞ぐ） */
function tubeIndex(nRings, radial) {
  const idx = [];
  for (let i = 0; i < nRings - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial;
      const a = i * radial + j, b = i * radial + j1;
      const c = (i + 1) * radial + j, d = (i + 1) * radial + j1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const capA = nRings * radial, capB = capA + 1;
  for (let j = 0; j < radial; j++) {
    const j1 = (j + 1) % radial;
    idx.push(capA, j1, j);                                     // 下の蓋
    const o = (nRings - 1) * radial;
    idx.push(capB, o + j, o + j1);                             // 上の蓋
  }
  return idx;
}

function makeTube(nRings, radial, material) {
  const geo = new THREE.BufferGeometry();
  const count = nRings * radial + 2;
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setIndex(tubeIndex(nRings, radial));
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  return mesh;
}

/** リングの重心を返す */
function centroid(arr, ring, radial, out) {
  let x = 0, y = 0, z = 0;
  for (let j = 0; j < radial; j++) {
    const o = (ring * radial + j) * 3;
    x += arr[o]; y += arr[o + 1]; z += arr[o + 2];
  }
  out[0] = x / radial; out[1] = y / radial; out[2] = z / radial;
}

/* 端の蓋の中心を、端のリングの重心から外へ少し押し出して丸く見せる */
const _c0 = [0, 0, 0], _c1 = [0, 0, 0];
const CAP_ROUND = 0.35;

function setCaps(mesh, nRings, radial) {
  const pos = mesh.geometry.attributes.position;
  const a = pos.array;
  for (const [ring, nb, capIdx] of [[0, 1, nRings * radial], [nRings - 1, nRings - 2, nRings * radial + 1]]) {
    centroid(a, ring, radial, _c0);
    centroid(a, nb, radial, _c1);
    pos.setXYZ(capIdx,
      _c0[0] + (_c0[0] - _c1[0]) * CAP_ROUND,
      _c0[1] + (_c0[1] - _c1[1]) * CAP_ROUND,
      _c0[2] + (_c0[2] - _c1[2]) * CAP_ROUND);
  }
}

/**
 * 輪切りの表を、なめらかな曲線で n 枚に取り直す。
 * 表は要点だけ書けばよくなり、面のカクつきも消える。
 */
function resample(profiles, n) {
  const keys = ['w', 'df', 'db', 'cx', 'cz', 'n'];
  const src = profiles.map((p) => ({ ...p, db: p.db ?? p.df, cx: p.cx ?? 0, cz: p.cz ?? 0, n: p.n ?? 2.3 }));
  const curves = {};
  for (const k of keys) {
    curves[k] = new THREE.CatmullRomCurve3(
      src.map((p) => new THREE.Vector3(p.t, p[k], 0)), false, 'catmullrom', 0.5);
  }
  const t0 = src[0].t, t1 = src[src.length - 1].t;
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const o = { t: t0 + (t1 - t0) * u };
    for (const k of keys) o[k] = curves[k].getPoint(u).y;
    out.push(o);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 骨にぶら下げる筒（胴体・首）                                        */
/* ------------------------------------------------------------------ */

class NodeLoft {
  /**
   * @param {Array} rings [{ host: Object3D, y: number, ...profile }]
   * @param {number} radial
   */
  constructor(rings, radial, material) {
    this.radial = radial;
    this.rings = rings.map((r) => {
      const pts = ringPoints(radial, r);
      if (r.y) for (let j = 0; j < radial; j++) pts[j * 3 + 1] = r.y;
      return { host: r.host, pts };
    });
    this.mesh = makeTube(this.rings.length, radial, material);
    this._v = new THREE.Vector3();
  }

  /**
   * @param {THREE.Vector3} offset 親（skier root）の平行移動ぶん。
   *   骨の matrixWorld はこの平行移動を含むが、頂点は root の子として
   *   描かれるので、ここで引いておかないと二重にずれる。
   */
  update(offset) {
    const pos = this.mesh.geometry.attributes.position;
    const { radial } = this;
    let k = 0;
    for (const r of this.rings) {
      const m = r.host.matrixWorld;
      for (let j = 0; j < radial; j++) {
        this._v.set(r.pts[j * 3], r.pts[j * 3 + 1], r.pts[j * 3 + 2]).applyMatrix4(m).sub(offset);
        pos.setXYZ(k++, this._v.x, this._v.y, this._v.z);
      }
    }
    setCaps(this.mesh, this.rings.length, radial);
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

/* ------------------------------------------------------------------ */
/* 2 点のあいだに張る筒（四肢）                                        */
/* ------------------------------------------------------------------ */

class SegLoft {
  /**
   * @param {Array} profiles [{ t: 0..1, w, df, db, cx, cz }] t=0 が始点
   */
  constructor(profiles, radial, material) {
    this.radial = radial;
    // 面の向きをそろえるため、遠位（t=1）から近位（t=0）の順に積む
    this.profiles = profiles.slice().reverse().map((p) => ({ t: p.t, pts: ringPoints(radial, p) }));
    this.mesh = makeTube(profiles.length, radial, material);
    this._X = new THREE.Vector3(); this._Y = new THREE.Vector3(); this._Z = new THREE.Vector3();
    this._p = new THREE.Vector3();
  }

  /**
   * @param {THREE.Vector3} a 始点（近位）
   * @param {THREE.Vector3} b 終点（遠位）
   * @param {THREE.Vector3} ant 前方の目安（ローカル +z）
   */
  set(a, b, ant) {
    const Y = this._Y.copy(a).sub(b).normalize();             // 骨の軸（近位向き）
    const Z = this._Z.copy(ant).addScaledVector(Y, -ant.dot(Y));
    if (Z.lengthSq() < 1e-9) Z.set(0, 0, 1).addScaledVector(Y, -Y.z);
    Z.normalize();
    const X = this._X.crossVectors(Y, Z).normalize();
    const pos = this.mesh.geometry.attributes.position;
    const { radial } = this;
    let k = 0;
    for (const pr of this.profiles) {
      for (let j = 0; j < radial; j++) {
        const lx = pr.pts[j * 3], lz = pr.pts[j * 3 + 2];
        this._p.copy(a).lerp(b, pr.t).addScaledVector(X, lx).addScaledVector(Z, lz);
        pos.setXYZ(k++, this._p.x, this._p.y, this._p.z);
      }
    }
    setCaps(this.mesh, this.profiles.length, radial);
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

/* ------------------------------------------------------------------ */
/* 寸法表（身長 1.75 m のときの値・単位 m）                            */
/* ------------------------------------------------------------------ */

/* 骨盤にぶら下げる輪切り（骨盤ローカル：原点は寛骨臼の高さ、+y 上・+z 前） */
const PELVIS_RINGS = [
  { y: -0.178, w: 0.152, df: 0.080, db: 0.094, cz: -0.012, n: 2.2 },  // 殿溝（太ももの付け根）
  { y: -0.115, w: 0.168, df: 0.092, db: 0.116, cz: -0.008, n: 2.2 },  // 殿部のいちばん出るところ
  { y: -0.050, w: 0.176, df: 0.098, db: 0.108, cz: -0.002, n: 2.3 },  // 大転子の高さ＝いちばん広い
  { y: 0.012, w: 0.168, df: 0.106, db: 0.100, cz: 0.006, n: 2.3 },
  { y: 0.074, w: 0.152, df: 0.108, db: 0.090, cz: 0.010, n: 2.3 },    // 腸骨稜
];

/* 椎骨にぶら下げる輪切り（椎体の中心が原点） */
const SPINE_RINGS = [
  // 腰椎 L5 → L1
  { i: 0, w: 0.146, df: 0.112, db: 0.082, cz: 0.012 },
  { i: 1, w: 0.140, df: 0.116, db: 0.080, cz: 0.014 },
  { i: 2, w: 0.136, df: 0.118, db: 0.078, cz: 0.014 },   // ウエスト
  { i: 3, w: 0.137, df: 0.118, db: 0.078, cz: 0.014 },
  { i: 4, w: 0.141, df: 0.118, db: 0.076, cz: 0.012 },
  // 胸椎 T12 → T1
  { i: 5, w: 0.147, df: 0.116, db: 0.074, cz: 0.014, n: 2.4 },
  { i: 6, w: 0.152, df: 0.120, db: 0.074, cz: 0.016, n: 2.4 },
  { i: 7, w: 0.157, df: 0.124, db: 0.074, cz: 0.018, n: 2.5 },
  { i: 8, w: 0.160, df: 0.128, db: 0.074, cz: 0.020, n: 2.5 },
  { i: 9, w: 0.163, df: 0.130, db: 0.074, cz: 0.022, n: 2.5 },
  { i: 10, w: 0.164, df: 0.130, db: 0.074, cz: 0.024, n: 2.5 },
  { i: 11, w: 0.163, df: 0.128, db: 0.074, cz: 0.026, n: 2.5 },
  { i: 12, w: 0.160, df: 0.124, db: 0.074, cz: 0.026, n: 2.5 },
  { i: 13, w: 0.155, df: 0.118, db: 0.076, cz: 0.026, n: 2.4 },
  { i: 14, w: 0.148, df: 0.110, db: 0.078, cz: 0.024, n: 2.4 },
  { i: 15, w: 0.137, df: 0.100, db: 0.080, cz: 0.020, n: 2.3 },
  { i: 16, w: 0.120, df: 0.088, db: 0.080, cz: 0.014, n: 2.2 },   // T1（僧帽筋の稜線）
  // 頸椎
  { i: 17, w: 0.090, df: 0.072, db: 0.066, cz: 0.006, n: 2.1 },
  { i: 19, w: 0.064, df: 0.058, db: 0.050, cz: 0.006, n: 2.0 },
  { i: 22, w: 0.059, df: 0.054, db: 0.048, cz: 0.006, n: 2.0 },
];

/* 大腿：t=0 が股関節、t=1 が膝。cx は外側へのずれ（大腿骨頭は内側にあるため） */
const THIGH = [
  { t: 0.02, w: 0.086, df: 0.078, db: 0.082, cx: 0.028, cz: 0.004 },
  { t: 0.16, w: 0.091, df: 0.082, db: 0.090, cx: 0.016, cz: 0.004 },
  { t: 0.40, w: 0.085, df: 0.078, db: 0.082, cx: 0.007, cz: 0.002 },
  { t: 0.68, w: 0.073, df: 0.069, db: 0.067, cx: 0.002, cz: 0 },
  { t: 0.88, w: 0.061, df: 0.059, db: 0.053, cx: 0, cz: 0.002 },
  { t: 1.00, w: 0.056, df: 0.056, db: 0.046, cx: 0, cz: 0.006 },
];

/* 下腿：t=0 が膝、t=1 が足首。ふくらはぎは後ろへ、やや下寄りに膨らむ */
const SHANK = [
  { t: 0.00, w: 0.058, df: 0.054, db: 0.050, cz: 0.004 },
  { t: 0.14, w: 0.059, df: 0.052, db: 0.064, cz: 0 },
  { t: 0.30, w: 0.056, df: 0.048, db: 0.066, cz: -0.002 },   // 腓腹筋の最大
  { t: 0.55, w: 0.046, df: 0.042, db: 0.046, cz: -0.002 },
  { t: 0.82, w: 0.035, df: 0.033, db: 0.030, cz: 0 },
  { t: 1.00, w: 0.032, df: 0.032, db: 0.026, cz: 0.002 },
];

/* 上腕：t=0 が肩（三角筋）、t=1 が肘 */
const UPPER_ARM = [
  { t: -0.16, w: 0.050, df: 0.050, db: 0.048 },   // 肩の丸み（胴体に少し食い込ませる）
  { t: -0.06, w: 0.060, df: 0.058, db: 0.056 },
  { t: 0.00, w: 0.061, df: 0.059, db: 0.057 },
  { t: 0.22, w: 0.056, df: 0.054, db: 0.054 },
  { t: 0.60, w: 0.046, df: 0.046, db: 0.045 },
  { t: 1.00, w: 0.038, df: 0.040, db: 0.038 },
];

/* 前腕：t=0 が肘、t=1 が手首 */
const FOREARM = [
  { t: 0.00, w: 0.042, df: 0.044, db: 0.042 },
  { t: 0.28, w: 0.044, df: 0.046, db: 0.044 },
  { t: 0.70, w: 0.033, df: 0.034, db: 0.032 },
  { t: 1.00, w: 0.026, df: 0.027, db: 0.024 },
];

/* ------------------------------------------------------------------ */
/* 皮膚のマテリアル                                                    */
/* ------------------------------------------------------------------ */

/**
 * 半透明だが「体積がある」ように見えるマテリアル。
 * 視線に対して斜めを向いた面（＝輪郭）ほど不透明にする（フレネル）ので、
 * シルエットははっきり出るのに、正面を向いた面は透けて中の骨が見える。
 */
export function createSkinMaterial(color = 0x5b86bf, opacity = 0.34) {
  const m = new THREE.MeshStandardMaterial({
    color, roughness: 0.62, metalness: 0.0,
    transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       #ifndef FLAT_SHADED
         float rim = 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) );
         gl_FragColor.a *= 0.22 + 1.35 * pow( rim, 2.2 );
         gl_FragColor.a = min( gl_FragColor.a, 0.96 );
       #endif`);
  };
  m.customProgramCacheKey = () => 'skinFresnel';
  return m;
}

/* ------------------------------------------------------------------ */
/* 頭と装備                                                            */
/* ------------------------------------------------------------------ */

/**
 * ヘルメットのシェル。顔の前は開いていて、後ろと横は耳の下まで下りる形を
 * 「方位角ごとに下端の高さを変えた回転楕円体」として作る。
 */
function helmetShell(rx, ry, rz, seg = 40, rows = 14) {
  const pos = [], idx = [];
  const yTop = ry;                 // てっぺんは 1 点に集めて穴をふさぐ
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;         // 0 = 前（+z）
    const ca = Math.cos(a), sa = Math.sin(a);
    // 下端：前は眉の高さで止め、横と後ろは耳の下まで下ろす
    const front = Math.max(0, ca), back = Math.max(0, -ca);
    const side = 1 - front - back;
    const yBot = ry * (0.32 * front - 0.84 * back - 0.72 * side);
    for (let j = 0; j <= rows; j++) {
      const y = yTop + (yBot - yTop) * (j / rows);
      const k = Math.sqrt(Math.max(0, 1 - (y / ry) ** 2));
      pos.push(rx * k * sa, y, rz * k * ca);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j, b = a + rows + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * ゴーグルの縁（方位角 a における上端・下端の高さ）。
 * 横へ行くほど細くなり、真ん中は鼻を避けて下端が持ち上がる。
 */
function goggleEdge(a, A, p) {
  const t = a / A;
  const yTop = p.yc + p.hT * (1 - 0.34 * t * t);
  const yBot = p.yc - p.hB * (1 - 0.10 * t * t) + p.nose * Math.exp(-((a / 0.42) ** 2));
  return [yTop, yBot];
}

/** 頭の楕円体に貼りつくレンズの曲面 */
function goggleLens(R, A, p, seg = 48, rows = 6) {
  const pos = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = -A + 2 * A * (i / seg);
    const [yT, yB] = goggleEdge(a, A, p);
    for (let j = 0; j <= rows; j++) {
      const y = yT + (yB - yT) * (j / rows);
      const k = Math.sqrt(Math.max(0, 1 - (y / R.y) ** 2));
      pos.push(R.x * k * Math.sin(a), y, R.z * k * Math.cos(a));
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < rows; j++) {
      const b = i * (rows + 1) + j, c = b + rows + 1;
      idx.push(b, c, b + 1, b + 1, c, c + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** レンズの縁をなぞる閉じた線（フレームのスイープに使う） */
function goggleOutline(R, A, p, grow = 1.0, seg = 30) {
  const pts = [];
  const at = (a, y) => {
    const k = Math.sqrt(Math.max(0, 1 - (y / R.y) ** 2));
    return new THREE.Vector3(R.x * grow * k * Math.sin(a), y, R.z * grow * k * Math.cos(a));
  };
  for (let i = 0; i <= seg; i++) {            // 上の縁：左 → 右
    const a = -A + 2 * A * (i / seg);
    pts.push(at(a, goggleEdge(a, A, p)[0]));
  }
  for (let i = seg; i >= 0; i--) {            // 下の縁：右 → 左
    const a = -A + 2 * A * (i / seg);
    pts.push(at(a, goggleEdge(a, A, p)[1]));
  }
  return pts;
}

/**
 * ゴーグルのストラップ。実物は後頭部に回っていて、前から見えるのは
 * こめかみのところだけなので、レンズが占める範囲（±A）には作らない。
 */
function strapBand(rxx, rzz, h, A, seg = 44) {
  const pos = [], idx = [];
  const a0 = A - 0.10, a1 = Math.PI * 2 - A + 0.10;
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (a1 - a0) * (i / seg);
    const x = rxx * Math.sin(a), z = rzz * Math.cos(a);
    // 後頭部で少し太くする（実物と同じく後ろが幅広）
    const hh = h * (1 + 0.30 * Math.max(0, -Math.cos(a)));
    pos.push(x, hh * 0.5, z, x, -hh * 0.5, z);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = a + 2;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 頭（顔＋ヘルメット＋ゴーグル）。
 * ローカル座標は +x 左・+y 上・+z 前、原点は頭の中心（耳の高さ）。
 */
export function createHeadGear(H, mats) {
  const S = H / 1.75;
  const g = new THREE.Group();
  g.name = 'head';
  const rx = 0.078 * S, ry = 0.112 * S, rz = 0.097 * S;

  // 顔（頭蓋＋下顎）
  const cranium = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), mats.skin);
  cranium.scale.set(rx * 0.97, ry * 0.94, rz * 0.97);
  cranium.position.set(0, 0.008 * S, -0.004 * S);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), mats.skin);
  jaw.scale.set(rx * 0.72, ry * 0.42, rz * 0.66);
  jaw.position.set(0, -ry * 0.50, rz * 0.16);
  g.add(cranium, jaw);

  // ヘルメット（顔の前が開いた殻）
  const helmet = new THREE.Mesh(helmetShell(rx * 1.15, ry * 1.12, rz * 1.13), mats.helmet);
  helmet.position.set(0, 0.004 * S, -0.005 * S);
  helmet.material.side = THREE.DoubleSide;
  g.add(helmet);

  // ゴーグル：レンズ・フレーム・ストラップを別々に作る
  //   レンズは頭の楕円体に貼りつく曲面。縁は横で低く、鼻のところで持ち上がる。
  const gg = { yc: -0.002 * S, hT: 0.038 * S, hB: 0.034 * S, nose: 0.014 * S };
  const RL = { x: rx * 1.05, y: ry * 1.06, z: rz * 1.07 };
  const A = 1.30;                                   // 左右への回り込み（±74°）
  const lens = new THREE.Mesh(goggleLens(RL, A, gg), mats.lens);
  lens.position.set(0, ry * 0.02, 0.002 * S);
  g.add(lens);
  // フレーム：レンズの縁をぐるりと囲む細い枠
  const frame = new THREE.Mesh(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(goggleOutline(RL, A, gg, 1.015), true, 'catmullrom', 0.5),
    76, 0.0052 * S, 7, true), mats.frame);
  frame.position.copy(lens.position);
  g.add(frame);
  // ストラップ：こめかみから後頭部へ回るバンド
  const strap = new THREE.Mesh(
    strapBand(rx * 1.17, rz * 1.17, 0.030 * S, A), mats.strap);
  strap.position.set(0, ry * 0.05, -0.004 * S);
  g.add(strap);

  // チンガード（SL 用ヘルメットの顎バー）。SL のときだけ出す
  const ca = 1.9;
  const chin = new THREE.Mesh(new THREE.TorusGeometry(
    rx * 1.06, 0.016 * S, 8, 24, ca), mats.helmet);
  chin.rotation.set(Math.PI / 2, 0, -ca / 2 + Math.PI / 2);
  chin.scale.set(1, 1, 0.85);
  chin.position.set(0, -ry * 0.70, rz * 0.20);
  g.add(chin);
  // チンガードをヘルメットにつなぐ支柱
  for (const sx of [1, -1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008 * S, 0.008 * S, ry * 0.72, 8), mats.helmet);
    post.position.set(sx * rx * 0.86, -ry * 0.34, rz * 0.42);
    post.rotation.z = sx * 0.16;
    g.add(post);
  }

  for (const m of g.children) m.castShadow = true;

  return {
    group: g, chinGuard: chin,
    setChinGuard(on) { chin.visible = on; },
  };
}

/* ------------------------------------------------------------------ */
/* 組み立て                                                            */
/* ------------------------------------------------------------------ */

/**
 * 身体の表面を作る。
 * @param {number} H 身長 [m]
 * @param {THREE.Material} mat 皮膚のマテリアル
 * @param {Object} nodes { pelvis: Object3D, verts: Object3D[] } 追従する骨のノード
 */
export function createBody(H, mat, nodes) {
  const S = H / 1.75;
  const group = new THREE.Group();
  group.name = 'bodySkin';

  const scaleRing = (r, host) => ({
    host, y: (r.y ?? 0) * S,
    w: r.w * S, df: r.df * S, db: (r.db ?? r.df) * S,
    cx: (r.cx ?? 0) * S, cz: (r.cz ?? 0) * S, n: r.n,
  });
  const scaleProf = (r) => ({
    t: r.t, w: r.w * S, df: r.df * S, db: (r.db ?? r.df) * S,
    cx: (r.cx ?? 0) * S, cz: (r.cz ?? 0) * S, n: r.n,
  });

  /* 胴体：骨盤 → 腰椎 → 胸椎 → 頸椎 を 1 本の筒でつなぐ */
  const trunkRings = [
    ...PELVIS_RINGS.map((r) => scaleRing(r, nodes.pelvis)),
    ...SPINE_RINGS.map((r) => scaleRing(r, nodes.verts[r.i])),
  ];
  const trunk = new NodeLoft(trunkRings, 28, mat);
  group.add(trunk.mesh);

  /* 四肢 */
  const limbs = {};
  for (const side of ['L', 'R']) {
    limbs[side] = {
      thigh: new SegLoft(resample(THIGH, 14).map(scaleProf), 22, mat),
      shank: new SegLoft(resample(SHANK, 14).map(scaleProf), 20, mat),
      arm: new SegLoft(resample(UPPER_ARM, 11).map(scaleProf), 16, mat),
      fore: new SegLoft(resample(FOREARM, 9).map(scaleProf), 14, mat),
    };
    for (const k of Object.keys(limbs[side])) group.add(limbs[side][k].mesh);
  }

  /**
   * 毎フレームの更新。
   * @param {Object} p 関節の位置など
   */
  function update(p, offset) {
    trunk.update(offset);
    for (const side of ['L', 'R']) {
      const l = limbs[side];
      l.thigh.set(p.hips[side], p.knees[side], p.legAnt[side]);
      l.shank.set(p.knees[side], p.ankles[side], p.legAnt[side]);
      l.arm.set(p.shoulders[side], p.elbows[side], p.armAnt);
      l.fore.set(p.elbows[side], p.hands[side], p.armAnt);
    }
  }

  return { group, update };
}
