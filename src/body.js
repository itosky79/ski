/**
 * body.js — 身体の表面（レーシングスーツ／X 線表示では皮膚）
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
 *   四肢は関節の 3 点（股関節・膝・足首、肩・肘・手首）から毎フレーム輪切りを並べ直す。
 *
 * ■ 膝と肘を 1 本の筒にした理由
 *   以前は大腿と下腿、上腕と前腕を別々の筒（端に蓋）で作って関節で重ねていたので、
 *   膝と肘が「球のつなぎ目」になり、内側にしわが割り込んでいた。
 *   不透明なスーツにすると、これがいちばん目立つ「人形らしさ」になる。
 *   いまは 1 本の筒で、関節のまわり（区間長の ±22 %）だけ輪の中心を 2 次ベジエ曲線に乗せ、
 *   輪の向きを曲線の接線に合わせる。曲げたときの輪は二等分面に並ぶので、内側で
 *   輪どうしが交差しない。膝の前には膝蓋骨のふくらみ、後ろは膝窩で少し平らにする。
 *
 * ■ スーツの配色（頂点色・描画コールは増えない）
 *   グラファイトの地に、脇から太ももの外側へ白い帯、肩は濃紺、前腕とすねの下は灰。
 *   指導用の色（赤・緑・ティール・黄・マゼンタ・紫・シアン）は使わない。
 *   胸と背中にはゼッケン（白地に黒い番号、ロゴなし）を 1 枚重ねる。
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
 *   スーツの配色・ゼッケン・すねの膨らみなどの見た目の量は調整値。
 */
import * as THREE from 'three';
import { GLOVE_COLOR } from './gear.js';

/* 頭と用具は gear.js に移した（以前ここから読み込んでいたコードのための再輸出） */
export { createHeadGear } from './gear.js';

/* ------------------------------------------------------------------ */
/* 輪切りの形                                                          */
/* ------------------------------------------------------------------ */

/**
 * 輪切りの 1 点（ローカル座標）。θ = 0 が前、θ = 90° が +x（左）。
 * @param {Object} p {w 半幅, df 前の深さ, db 後ろの深さ, cx 横のずれ, cz 前後のずれ, n 角ばり, nb 後ろ半分の角ばり}
 */
function ringPoint(t, p, out) {
  const { w, df, db = df, cx = 0, cz = 0, n = 2.3, nb = n } = p;
  const ct = Math.cos(t), st = Math.sin(t);
  const front = ct >= 0;
  const e = 2 / (front ? n : nb);
  out[0] = cx + w * Math.sign(st) * Math.pow(Math.abs(st), e);
  out[1] = 0;
  out[2] = cz + (front ? df : db) * Math.sign(ct) * Math.pow(Math.abs(ct), e);
  return out;
}

/** 1 枚の輪切りの頂点（ローカル座標）を作る */
function ringPoints(radial, p) {
  const out = new Float32Array(radial * 3);
  const q = [0, 0, 0];
  for (let j = 0; j < radial; j++) {
    ringPoint((j / radial) * Math.PI * 2, p, q);
    out[j * 3] = q[0]; out[j * 3 + 1] = q[1]; out[j * 3 + 2] = q[2];
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

/**
 * 筒のメッシュ。頂点色（スーツの配色）は作るときに 1 回だけ塗る。
 * @param {(ring:number, theta:number) => THREE.Color} [colorAt] 輪 ring の角度 θ の色
 */
function makeTube(nRings, radial, material, colorAt) {
  const geo = new THREE.BufferGeometry();
  const count = nRings * radial + 2;
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const col = new Float32Array(count * 3).fill(1);
  if (colorAt) {
    for (let i = 0; i < nRings; i++) {
      for (let j = 0; j < radial; j++) {
        const c = colorAt(i, (j / radial) * Math.PI * 2);
        const o = (i * radial + j) * 3;
        col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b;
      }
    }
    // 蓋の中心は端の輪の最初の点と同じ色
    for (const [cap, ring] of [[nRings * radial, 0], [nRings * radial + 1, nRings - 1]]) {
      col[cap * 3] = col[ring * radial * 3]; col[cap * 3 + 1] = col[ring * radial * 3 + 1];
      col[cap * 3 + 2] = col[ring * radial * 3 + 2];
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
 * 輪切りの表を s で引けるようにする（区分 3 次エルミート、傾きは前後の差分）。
 * 表の点の間隔が不ぞろいでも、値は表の点を必ず通る。
 */
function profileFn(table) {
  const keys = ['w', 'df', 'db', 'cx', 'cz', 'n'];
  const T = table.map((p) => ({ s: p.s, w: p.w, df: p.df, db: p.db ?? p.df,
    cx: p.cx ?? 0, cz: p.cz ?? 0, n: p.n ?? 2.3 }));
  const slope = (k, j) => {
    const a = T[Math.max(0, j - 1)], b = T[Math.min(T.length - 1, j + 1)];
    return (b[k] - a[k]) / (b.s - a.s);
  };
  return (s) => {
    if (s <= T[0].s) return { ...T[0], s };
    if (s >= T[T.length - 1].s) return { ...T[T.length - 1], s };
    let i = 0;
    while (s > T[i + 1].s) i++;
    const p0 = T[i], p1 = T[i + 1], h = p1.s - p0.s, u = (s - p0.s) / h;
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const out = { s };
    for (const k of keys) out[k] = h00 * p0[k] + h10 * h * slope(k, i) + h01 * p1[k] + h11 * h * slope(k, i + 1);
    return out;
  };
}

/* ------------------------------------------------------------------ */
/* 骨にぶら下げる筒（胴体・首）                                        */
/* ------------------------------------------------------------------ */

class NodeLoft {
  /**
   * @param {Array} rings [{ host: Object3D, y: number, ...profile }]
   * @param {number} radial
   * @param {(ring:number, theta:number) => THREE.Color} [colorAt] スーツの配色
   */
  constructor(rings, radial, material, colorAt) {
    this.radial = radial;
    this.rings = rings.map((r) => {
      const pts = ringPoints(radial, r);
      if (r.y) for (let j = 0; j < radial; j++) pts[j * 3 + 1] = r.y;
      return { host: r.host, pts };
    });
    this.mesh = makeTube(this.rings.length, radial, material, colorAt);
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
/* 3 点（根元・中間の関節・先端）に張る 1 本の筒（四肢）              */
/* ------------------------------------------------------------------ */

class LimbLoft {
  /**
   * @param {Array} profiles [{ s, w, df, db, cx, cz, n }] s = 0 根元の関節 → 1 中間の関節 → 2 先端
   * @param {number} blend 中間の関節のまわりで曲線にする範囲（s の ±、各区間長に対する割合）
   * @param {(s:number, theta:number) => THREE.Color} [colorAt] スーツの配色
   */
  constructor(profiles, radial, material, blend, colorAt) {
    this.radial = radial;
    this.blend = blend;
    // 面の向きをそろえるため、先端（s=2）から根元（s=0）の順に積む（以前の筒と同じ巻き方）
    this.profiles = profiles.slice().sort((a, b) => b.s - a.s)
      .map((p) => ({ s: p.s, pts: ringPoints(radial, p) }));
    this.mesh = makeTube(this.profiles.length, radial, material,
      colorAt ? (i, th) => colorAt(this.profiles[i].s, th) : null);
    this._X = new THREE.Vector3(); this._Y = new THREE.Vector3(); this._Z = new THREE.Vector3();
    this._c = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._ax = new THREE.Vector3(); this._bx = new THREE.Vector3();
    this._P0 = new THREE.Vector3(); this._P2 = new THREE.Vector3();
    this._prevZ = new THREE.Vector3(0, 0, 1);
  }

  /**
   * @param {THREE.Vector3} a 根元（股関節・肩）
   * @param {THREE.Vector3} k 中間の関節（膝・肘）
   * @param {THREE.Vector3} b 先端（足首・手首）
   * @param {THREE.Vector3} ant 前方の目安（ローカル +z）
   */
  set(a, k, b, ant) {
    const B = this.blend;
    const ax = this._ax.copy(k).sub(a), bx = this._bx.copy(b).sub(k);
    const P0 = this._P0.copy(k).addScaledVector(ax, -B), P2 = this._P2.copy(k).addScaledVector(bx, B);
    const { _X: X, _Y: Y, _Z: Z, _c: c, _p: p } = this;
    const pos = this.mesh.geometry.attributes.position;
    const { radial } = this;
    let n = 0;
    for (const pr of this.profiles) {
      const s = pr.s;
      if (s <= 1 - B) { c.copy(a).addScaledVector(ax, s); Y.copy(ax); }
      else if (s >= 1 + B) { c.copy(k).addScaledVector(bx, s - 1); Y.copy(bx); }
      else {
        // 関節のまわり：2 次ベジエ（P0 → 関節 → P2）。両端で接線が区間の向きと一致する
        const u = (s - (1 - B)) / (2 * B), q = 1 - u;
        c.copy(P0).multiplyScalar(q * q).addScaledVector(k, 2 * u * q).addScaledVector(P2, u * u);
        Y.copy(k).sub(P0).multiplyScalar(q).addScaledVector(this._p.copy(P2).sub(k), u);
      }
      Y.normalize().negate();                                   // 軸（根元向き）
      Z.copy(ant).addScaledVector(Y, -ant.dot(Y));
      // 前方の目安が軸とほぼ平行なら、ひとつ前の輪の向きを使う（向きが裏返らない）
      if (Z.lengthSq() < 1e-6) Z.copy(this._prevZ).addScaledVector(Y, -this._prevZ.dot(Y));
      if (Z.lengthSq() < 1e-9) Z.set(0, 0, 1).addScaledVector(Y, -Y.z);
      Z.normalize();
      this._prevZ.copy(Z);
      X.crossVectors(Y, Z).normalize();
      for (let j = 0; j < radial; j++) {
        const lx = pr.pts[j * 3], lz = pr.pts[j * 3 + 2];
        p.copy(c).addScaledVector(X, lx).addScaledVector(Z, lz);
        pos.setXYZ(n++, p.x, p.y, p.z);
      }
    }
    setCaps(this.mesh, this.profiles.length, radial);
    pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }
}

/* ------------------------------------------------------------------ */
/* ゼッケン（胸と背中の 2 枚の帯。椎骨にぶら下げる）                  */
/* ------------------------------------------------------------------ */

let _bibTex = null;
/** ゼッケンの模様：上半分が胸、下半分が背中。白地に黒い番号、細い縁と脇のひも。ロゴは入れない */
function bibTexture() {
  if (_bibTex) return _bibTex;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#1f2631';
  g.fillRect(0, 0, 256, 256);
  for (const y0 of [0, 128]) {
    // 白い地と細い縁
    g.fillStyle = '#f4f6f8';
    g.fillRect(10, y0 + 4, 236, 120);
    g.strokeStyle = '#2b2f36'; g.lineWidth = 3;
    g.strokeRect(12, y0 + 6, 232, 116);
    // 上下の灰色の帯（実物では大会名などが入るところ。ここは無地）
    g.fillStyle = '#c9ced6';
    g.fillRect(14, y0 + 8, 228, 14);
    g.fillRect(14, y0 + 106, 228, 14);
    // 脇のひも
    g.fillStyle = '#2b2f36';
    g.fillRect(0, y0 + 50, 12, 28);
    g.fillRect(244, y0 + 50, 12, 28);
    // 番号
    g.fillStyle = '#111317';
    g.font = 'bold 84px "Helvetica Neue", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('7', 128, y0 + 66);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _bibTex = t;
  return t;
}

class BibLoft {
  /**
   * @param {Array} rings 胴体と同じ輪切りの定義（host・寸法）。下から上の順
   * @param {number} inflate スーツの表面から浮かせる量 [m]
   */
  constructor(rings, inflate, seg = 12) {
    this.seg = seg;
    const strips = [[-55, 55, 0.5], [125, 235, 0]];   // [θ0, θ1, v の下端]（度）
    const nR = rings.length, per = seg + 1;
    this.count = nR * per * 2;
    const pts = new Float32Array(this.count * 3), uv = new Float32Array(this.count * 2);
    this.hosts = [];
    const q = [0, 0, 0];
    let k = 0;
    for (const [d0, d1, v0] of strips) {
      for (let i = 0; i < nR; i++) {
        const r = rings[i];
        const pr = { ...r, w: r.w + inflate, df: r.df + inflate, db: (r.db ?? r.df) + inflate };
        for (let j = 0; j <= seg; j++) {
          const t = THREE.MathUtils.degToRad(d0 + (d1 - d0) * (j / seg));
          ringPoint(t, pr, q);
          pts[k * 3] = q[0]; pts[k * 3 + 1] = r.y ?? 0; pts[k * 3 + 2] = q[2];
          uv[k * 2] = j / seg; uv[k * 2 + 1] = v0 + 0.5 * (i / (nR - 1));
          this.hosts.push(r.host);
          k++;
        }
      }
    }
    const idx = [];
    for (let st = 0; st < 2; st++) {
      const o = st * nR * per;
      for (let i = 0; i < nR - 1; i++) {
        for (let j = 0; j < seg; j++) {
          const a = o + i * per + j, b = a + 1, c = a + per, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
    }
    this.pts = pts;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.count * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.count * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.material = new THREE.MeshStandardMaterial({ map: bibTexture(), roughness: 0.75, metalness: 0 });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.name = 'bib';
    // skier.js へ：スーツの材質に差し替えない／X 線表示では消す
    this.mesh.userData.keepMaterial = true;
    this.mesh.userData.hideInXray = true;
    this._v = new THREE.Vector3();
  }

  update(offset) {
    const pos = this.mesh.geometry.attributes.position;
    for (let k = 0; k < this.count; k++) {
      this._v.set(this.pts[k * 3], this.pts[k * 3 + 1], this.pts[k * 3 + 2])
        .applyMatrix4(this.hosts[k].matrixWorld).sub(offset);
      pos.setXYZ(k, this._v.x, this._v.y, this._v.z);
    }
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

/* 大腿：t=0 が股関節、t=1 が膝。cx は外側へのずれ（大腿骨頭は内側にあるため）。
 * 以前は左右とも +x（左）へずらしていたので、右の太ももだけ内側へ寄っていた */
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
  // 肩の丸み（胴体に少し食い込ませる）。根元を細くして、腕の端が肩の上へ球のように出ないようにする
  { t: -0.16, w: 0.034, df: 0.036, db: 0.034 },
  { t: -0.08, w: 0.052, df: 0.052, db: 0.050 },
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
/* スーツの配色                                                        */
/* ------------------------------------------------------------------ */

/* 地はグラファイト、差し色は白〜銀と濃紺だけ。指導用の色とまぎれない無彩色に寄せる */
const SUIT = {
  base: new THREE.Color(0x1f2631),    // グラファイト
  panel: new THREE.Color(0xd9dee6),   // 白〜銀：脇から太ももの外側への帯
  navy: new THREE.Color(0x1b3a6b),    // 濃紺：肩と襟（ただ一つの有彩色の差し色）
  lower: new THREE.Color(0x3a4352),   // 前腕・すねの下のほう
  glove: new THREE.Color(GLOVE_COLOR),// グローブのカフ（前腕の先にかぶせる）
};
const smooth01 = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _sc = new THREE.Color();

/**
 * 胴体の色。ring は輪切りの定義（part: 'pelvis' | 'spine'、k: 骨盤の輪の番号か椎骨の番号）。
 *   脇の白い帯：|sinθ| > 0.92（体側の幅 9 cm ほど）。殿溝から胸椎 T4 まで。太ももの外側の帯へ続く
 *   肩と襟：胸椎 T2 から上は濃紺
 */
function trunkColor(ring, th) {
  const s = Math.abs(Math.sin(th));
  let flank = smooth01(s, 0.90, 0.95);
  if (ring.part === 'spine') flank *= 1 - smooth01(ring.k, 12, 14);
  const yoke = ring.part === 'spine' ? smooth01(ring.k, 14, 15.5) : 0;
  return _sc.copy(SUIT.base).lerp(SUIT.panel, flank).lerp(SUIT.navy, yoke);
}

/** 脚の色。lat は外側の x の符号（左脚 +1、右脚 −1）。外側の白い帯は膝の上まで */
function legColor(s, th, lat) {
  const panel = smooth01(Math.sin(th) * lat, 0.90, 0.95) * (1 - smooth01(s, 0.80, 0.90));
  const lower = smooth01(s, 1.50, 1.58);
  return _sc.copy(SUIT.base).lerp(SUIT.panel, panel).lerp(SUIT.lower, lower);
}

/** 腕の色：肩は濃紺、前腕の先は灰、手首から先はグローブのカフ */
function armColor(s) {
  const navy = 1 - smooth01(s, 0.22, 0.34);
  const lower = smooth01(s, 1.40, 1.48);
  const glove = smooth01(s, 1.665, 1.69);
  return _sc.copy(SUIT.base).lerp(SUIT.navy, navy).lerp(SUIT.lower, lower).lerp(SUIT.glove, glove);
}

/* ------------------------------------------------------------------ */
/* 四肢の輪切りの並べ方                                                */
/* ------------------------------------------------------------------ */

/* 関節のまわりで曲線にする範囲（区間長に対する割合）。膝は大きめ、肘は小さめ（調整値） */
const KNEE_BLEND = 0.22, ELBOW_BLEND = 0.20;

/** 根元・関節・先端の 3 区間の s を並べる（関節のまわりは細かく） */
function limbSamples(head, blend, tail) {
  const zone = [];
  for (let k = 0; k <= 8; k++) zone.push(1 - blend + (2 * blend * k) / 8);
  return [...head, ...zone, ...tail];
}

/** 脚の表（大腿 0..1 と下腿 1..2 をつなぐ。膝の輪は両方の平均） */
function legTable() {
  const th = THIGH.filter((p) => p.t < 1).map((p) => ({ ...p, s: p.t }));
  const k0 = THIGH[THIGH.length - 1], k1 = SHANK[0];
  const knee = { s: 1 };
  for (const key of ['w', 'df', 'db', 'cx', 'cz']) knee[key] = ((k0[key] ?? 0) + (k1[key] ?? 0)) / 2;
  const sh = SHANK.filter((p) => p.t > 0).map((p) => ({ ...p, s: 1 + p.t }));
  return [...th, knee, ...sh];
}

/** 腕の表（上腕 0..1 と前腕 1..2）。手首から先は少し太いグローブのカフ */
function armTable() {
  const up = UPPER_ARM.filter((p) => p.t < 1).map((p) => ({ ...p, s: p.t }));
  const e0 = UPPER_ARM[UPPER_ARM.length - 1], e1 = FOREARM[0];
  const elbow = { s: 1 };
  for (const key of ['w', 'df', 'db']) elbow[key] = (e0[key] + e1[key]) / 2;
  const fo = FOREARM.filter((p) => p.t > 0).map((p) => ({ ...p, s: 1 + p.t }));
  return [...up, elbow, ...fo];
}

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
/* 組み立て                                                            */
/* ------------------------------------------------------------------ */

/**
 * 身体の表面を作る。
 * @param {number} H 身長 [m]
 * @param {THREE.Material} mat 皮膚のマテリアル（skier.js が見え方に合わせてスーツと差し替える）
 * @param {Object} nodes { pelvis: Object3D, verts: Object3D[] } 追従する骨のノード
 * @param {Object} [opts] { disc: 'SL' | 'GS' }
 * @returns {{group, update, hasVertexColors: boolean, extraMats: THREE.Material[]}}
 */
export function createBody(H, mat, nodes, opts = {}) {
  const S = H / 1.75;
  const group = new THREE.Group();
  group.name = 'bodySkin';
  const isGS = opts.disc === 'GS';

  const scaleRing = (r, host) => ({
    host, y: (r.y ?? 0) * S,
    w: r.w * S, df: r.df * S, db: (r.db ?? r.df) * S,
    cx: (r.cx ?? 0) * S, cz: (r.cz ?? 0) * S, n: r.n, nb: r.nb,
  });
  /* GS：スーツの下の背中のプロテクター。胸椎 T11〜T3 の背中を 14 mm 厚く、平らにする。
   * 端の輪は半分だけ効かせて段にしない。 */
  const PROTECT = { 5: 0.25, 6: 0.7, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 13: 1, 14: 0.7, 15: 0.25 };
  const spineRing = (r) => {
    const k = isGS ? (PROTECT[r.i] ?? 0) : 0;
    if (!k) return r;
    const n = r.n ?? 2.3;
    return { ...r, db: (r.db ?? r.df) + 0.014 * k, nb: n + (3.0 - n) * k };
  };

  /* 胴体：骨盤 → 腰椎 → 胸椎 → 頸椎 を 1 本の筒でつなぐ */
  const trunkDefs = [
    ...PELVIS_RINGS.map((r, k) => ({ r, host: nodes.pelvis, part: 'pelvis', k })),
    ...SPINE_RINGS.map((r) => ({ r: spineRing(r), host: nodes.verts[r.i], part: 'spine', k: r.i })),
  ];
  const trunkRings = trunkDefs.map((d) => scaleRing(d.r, d.host));
  const trunk = new NodeLoft(trunkRings, 28, mat, (i, th) => trunkColor(trunkDefs[i], th));
  group.add(trunk.mesh);

  /* ゼッケン：胸椎 T10〜T3 の高さで、胸と背中に 1 枚ずつ（スーツから 6 mm 浮かせる） */
  const bibRings = trunkDefs.map((d, i) => ({ d, ring: trunkRings[i] }))
    .filter(({ d }) => d.part === 'spine' && d.k >= 7 && d.k <= 14).map(({ ring }) => ring);
  const bib = new BibLoft(bibRings, 0.006 * S);
  group.add(bib.mesh);

  /* 四肢：股関節〜膝〜足首、肩〜肘〜手首をそれぞれ 1 本の筒にする */
  const legProfile = profileFn(legTable());
  const armProfile = profileFn(armTable());
  const LEG_S = limbSamples([-0.09, 0.02, 0.10, 0.20, 0.32, 0.45, 0.58, 0.70],
    KNEE_BLEND, [1.32, 1.45, 1.58, 1.70, 1.82, 1.92, 2.0]);
  const ARM_S = limbSamples([-0.16, -0.08, 0.0, 0.10, 0.25, 0.42, 0.58, 0.72],
    ELBOW_BLEND, [1.32, 1.46, 1.60, 1.655, 1.70, 1.80, 1.90, 2.0]);
  const legRings = (lat) => LEG_S.map((s) => {
    const p = legProfile(s);
    // 膝の前は膝蓋骨でふくらみ、後ろ（膝窩）は少し平ら
    const g = Math.exp(-(((s - 1) / 0.07) ** 2)), gb = Math.exp(-(((s - 1) / 0.09) ** 2));
    return {
      s, w: p.w * S, df: (p.df + 0.012 * g) * S, db: (p.db - 0.008 * gb) * S,
      // cx は「外側へのずれ」。ローカル +x は左なので、右脚では向きを裏返す
      cx: p.cx * lat * S, cz: p.cz * S, n: p.n + 0.3 * g, nb: p.n,
    };
  });
  const armRings = () => ARM_S.map((s) => {
    const p = armProfile(s);
    // 手首から先：前腕より 7 mm ほど太い筒（グローブのカフ）
    const gl = smooth01(s, 1.655, 1.70);
    const r = 0.040 + 0.004 * Math.max(0, (s - 1.70) / 0.30);
    // 肘の後ろ（肘頭）を少しとがらせる
    const ol = 0.005 * Math.exp(-(((s - 1) / 0.06) ** 2));
    return {
      s, w: (p.w + (r - p.w) * gl) * S, df: (p.df + (r - p.df) * gl) * S,
      db: (p.db + (r - p.db) * gl + ol) * S, cx: 0, cz: 0, n: p.n,
    };
  });
  const limbs = {};
  for (const side of ['L', 'R']) {
    const lat = side === 'L' ? 1 : -1;
    limbs[side] = {
      leg: new LimbLoft(legRings(lat), 22, mat, KNEE_BLEND, (s, th) => legColor(s, th, lat)),
      arm: new LimbLoft(armRings(), 16, mat, ELBOW_BLEND, (s) => armColor(s)),
    };
    group.add(limbs[side].leg.mesh, limbs[side].arm.mesh);
  }

  const _mid = new THREE.Vector3(), _ant = new THREE.Vector3();
  /**
   * 腕の前方の目安。肘が曲がっていれば「肘から肩と手首の中点へ」（肘の内側）。
   * まっすぐに近いときは胸の正面に戻す（2〜8° でなめらかに切り替える）。
   */
  function armAnt(sh, el, ha, fallback) {
    _mid.copy(sh).add(ha).multiplyScalar(0.5).sub(el);
    const d = _mid.length();
    const bend = d / Math.max(1e-6, sh.distanceTo(el));
    const w = smooth01(bend, 0.02, 0.08);
    _ant.copy(fallback).multiplyScalar(1 - w);
    if (d > 1e-8) _ant.addScaledVector(_mid, w / d);
    return _ant;
  }

  /**
   * 毎フレームの更新。
   * @param {Object} p 関節の位置など
   */
  function update(p, offset) {
    trunk.update(offset);
    bib.update(offset);
    for (const side of ['L', 'R']) {
      const l = limbs[side];
      l.leg.set(p.hips[side], p.knees[side], p.ankles[side], p.legAnt[side]);
      l.arm.set(p.shoulders[side], p.elbows[side], p.hands[side],
        armAnt(p.shoulders[side], p.elbows[side], p.hands[side], p.armAnt));
    }
  }

  return { group, update, hasVertexColors: true, extraMats: [bib.material] };
}
