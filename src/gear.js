/**
 * gear.js — 用具（板とビンディング・ブーツ・グローブ・ストック・ヘルメット）
 *
 * ■ なぜ作り直したか
 *   身体を不透明なスーツにして板を雪の上に出すと、残る「おもちゃっぽさ」は用具だった。
 *   箱を積んだブーツ、ビンディングのない一色の板、楕円体の手袋、ただの棒のストック、
 *   てっぺんがとがった卵形のヘルメットと、顎の下に浮いたチンガード。
 *   どれもレースの映像と並べると一目で違う。
 *
 * ■ 方針
 *   ・形はすべてコードで作る（画像やモデルの読み込みはしない）。メーカーのロゴや名前は入れない。
 *   ・部品はできるだけ 1 つのジオメトリにまとめ、色は頂点色で塗り分ける（描画コールを減らす）。
 *       板：ビンディングごと 1 メッシュ／ブーツ：シェルとカフの 2 メッシュ（SL はすね当て +1）
 *       グローブ・ストック：各 1 メッシュ／頭：顔・ヘルメット・レンズ・枠とストラップの 4 メッシュ
 *   ・指導用の色（赤・緑・ティール・黄・マゼンタ・紫・シアン）は使わない。
 *     例外は板のストライプだけで、「外スキー＝コーラル、内スキー＝青」の約束をここに残す。
 *   ・毎フレーム形を作り直さない。動くのはカフの回転とストック・グローブの姿勢（変換）だけ。
 *
 * ■ 座標の約束（skier.js と同じ）
 *   板・ブーツ：x＝左、y＝上（板の法線）、z＝前。板の原点は「足首の真下の板の裏」、
 *   ブーツの原点はソールの下面（＝ビンディングの上面）。
 *   頭：x＝左、y＝上、z＝前、原点は頭の中心（耳の高さ）。
 *
 * 寸法は監査メモの提案値と一般的な目安による調整値。写真・動画・規定で確かめたものではない。
 */
import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* 色（sRGB の 16 進。THREE.Color が線形に直すので頂点色にそのまま使える） */
/* ------------------------------------------------------------------ */
const COL = {
  skiBase: 0x0c0d10,      // 板の裏（滑走面）：黒
  steel: 0xaeb6c0,        // エッジの鋼
  plate: 0x1b1f27,        // プレート・ビンディングの本体
  plateHi: 0x8c96a3,      // ビンディングの差し色（灰）
  shell: 0xe9edf2,        // ブーツのシェル（白）
  sole: 0x2b2f36,         // ブーツのソール
  liner: 0x2a2e35,        // ブーツの内張り
  buckle: 0xaab4c0,       // バックル（銀）
  strap: 0x101216,        // パワーストラップ（黒）
  guard: 0xf0f3f7,        // すね当て（白いプラスチック）
  handGuard: 0x8c96a3,    // ハンドガード（灰のプラスチック）
  grip: 0x15171b,         // ストックのグリップ・バスケット
  shaft: 0xc9d0d8,        // ストックのシャフト（アルミの銀）
  tip: 0x5b6168,          // 石突き
  helmet: 0x1d2a44,       // ヘルメットの地色（濃紺）
  helmetStripe: 0xe9edf2, // ヘルメットの中央の白線
  pad: 0x2a2e35,          // ヘルメットの内側のパッド
  frame: 0x15181d,        // ゴーグルの枠
  gStrap: 0x2b2f36,       // ゴーグルのストラップ（暗い灰。白にすると後ろから見て十字に見える）
};
/** グローブの色。body.js が前腕の先（ガントレット）を同じ色で塗る */
export const GLOVE_COLOR = 0x1a1d23;
const GLOVE_KNUCKLE = 0x3a4150;
/** 板のストライプ（指導用の約束：外スキー＝コーラル、内スキー＝青） */
const STRIPE_OUTER = 0xff6b57, STRIPE_INNER = 0x2f7fe0;

/* ------------------------------------------------------------------ */
/* ジオメトリの小道具                                                  */
/* ------------------------------------------------------------------ */
const _col = new THREE.Color();

/** 頂点色を一色で塗る。UV は「上面の模様を使わない」印の (-1, -1) */
function paint(geo, hex) {
  const n = geo.attributes.position.count;
  _col.set(hex);
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo;
}

/** 平行移動・回転・拡大をジオメトリに焼き込む */
function place(geo, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1] } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)),
    new THREE.Vector3(...s));
  geo.applyMatrix4(m);
  return geo;
}

/**
 * ジオメトリを 1 つにまとめる（位置・法線・頂点色・UV）。
 * インデックスのないもの（ExtrudeGeometry など）は 0, 1, 2, … を振ってからまとめる。
 */
function merge(geos) {
  let nv = 0, ni = 0;
  for (const g of geos) {
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
  const clr = new Float32Array(nv * 3).fill(1), uv = new Float32Array(nv * 2).fill(-1);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v0 = 0, i0 = 0;
  for (const g of geos) {
    const n = g.attributes.position.count;
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position, N = g.attributes.normal, Cc = g.attributes.color, T = g.attributes.uv;
    for (let i = 0; i < n; i++) {
      pos[(v0 + i) * 3] = P.getX(i); pos[(v0 + i) * 3 + 1] = P.getY(i); pos[(v0 + i) * 3 + 2] = P.getZ(i);
      nor[(v0 + i) * 3] = N.getX(i); nor[(v0 + i) * 3 + 1] = N.getY(i); nor[(v0 + i) * 3 + 2] = N.getZ(i);
      if (Cc) { clr[(v0 + i) * 3] = Cc.getX(i); clr[(v0 + i) * 3 + 1] = Cc.getY(i); clr[(v0 + i) * 3 + 2] = Cc.getZ(i); }
      if (T && g.userData.keepUV) { uv[(v0 + i) * 2] = T.getX(i); uv[(v0 + i) * 2 + 1] = T.getY(i); }
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) idx[i0 + k] = g.index.getX(k) + v0;
    else for (let k = 0; k < n; k++) idx[i0 + k] = v0 + k;
    v0 += n; i0 += g.index ? g.index.count : n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(clr, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * 輪切りの列から筒を張る（ブーツのシェル・カフ・ストラップ・チンガード）。
 * @param {THREE.Vector3[][]} rings 各輪切りの点（点の数はそろえる）
 * @param {Object} o
 * @param {boolean} [o.closed=true] 輪切りが閉じているか（すね当てのような開いた帯なら false）
 * @param {boolean} [o.capStart] [o.capEnd] 端を蓋でふさぐ（中心を少し外へ押し出して丸める）
 * @param {(i:number, j:number) => number} [o.color] 頂点の色（16 進）
 * 面の向きは、中ほどの輪切りで「法線が外を向いているか」を調べて自動でそろえる。
 */
function loft(rings, { closed = true, capStart = false, capEnd = false, color = null, round = 0.35, probe = 0 } = {}) {
  const nR = rings.length, nP = rings[0].length;
  const pos = [], clr = [], idx = [];
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j < nP; j++) {
      const p = rings[i][j];
      pos.push(p.x, p.y, p.z);
      _col.set(color ? color(i, j) : 0xffffff);
      clr.push(_col.r, _col.g, _col.b);
    }
  }
  const jMax = closed ? nP : nP - 1;
  for (let i = 0; i < nR - 1; i++) {
    for (let j = 0; j < jMax; j++) {
      const j1 = (j + 1) % nP;
      const a = i * nP + j, b = i * nP + j1, c = (i + 1) * nP + j, d = (i + 1) * nP + j1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const centroid = (ring) => {
    const c = new THREE.Vector3();
    for (const p of ring) c.add(p);
    return c.multiplyScalar(1 / ring.length);
  };
  const addCap = (ri, nb, flip) => {
    const c0 = centroid(rings[ri]), c1 = centroid(rings[nb]);
    const cp = c0.clone().addScaledVector(c0.clone().sub(c1), round);
    const ci = pos.length / 3;
    pos.push(cp.x, cp.y, cp.z);
    const k = ri * nP;
    clr.push(clr[k * 3], clr[k * 3 + 1], clr[k * 3 + 2]);
    for (let j = 0; j < nP; j++) {
      const j1 = (j + 1) % nP;
      if (flip) idx.push(ci, k + j, k + j1); else idx.push(ci, k + j1, k + j);
    }
  };
  if (closed && capStart) addCap(0, 1, false);
  if (closed && capEnd) addCap(nR - 1, nR - 2, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // 面の向きの確認：中ほどの輪切りで、法線が輪の中心から外を向いているか。
  // 三日月形（すね当て）のように内側の面もある輪切りは、外側の点（先頭 probe 個）だけで調べる
  if (closed && nR > 1) {
    const mi = Math.floor(nR / 2);
    const c = centroid(rings[mi]);
    const N = geo.attributes.normal;
    let s = 0;
    for (let j = 0; j < (probe || nP); j++) {
      const p = rings[mi][j];
      s += (p.x - c.x) * N.getX(mi * nP + j) + (p.y - c.y) * N.getY(mi * nP + j) + (p.z - c.z) * N.getZ(mi * nP + j);
    }
    if (s < 0) {
      const ix = geo.index.array;
      for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; }
      geo.index.needsUpdate = true;
      geo.computeVertexNormals();
    }
  }
  return geo;
}

/**
 * 超楕円の輪切り（θ=0 が「前」または「上」）。
 * 前半と後半で深さと角ばりを変えられる（ブーツの底は平ら、甲は丸い）。
 * @returns {number[][]} [[u, v], …]  u = 横、v = 前後（または上下）
 */
function superRing(n, { w, d0, d1 = d0, c = 0, e0 = 2.4, e1 = e0 }) {
  const out = [];
  for (let j = 0; j < n; j++) {
    const t = Math.PI * 2 * (j / n);
    const s = Math.sin(t), co = Math.cos(t);
    const front = co >= 0;
    const e = 2 / (front ? e0 : e1);
    out.push([w * Math.sign(s) * Math.pow(Math.abs(s), e),
      c + (front ? d0 : d1) * Math.sign(co) * Math.pow(Math.abs(co), e)]);
  }
  return out;
}

/**
 * 曲面に沿った帯（バックル・ストラップ）。
 * path[i] に沿って、across[i] 方向に幅 width、nrm[i] 方向に厚み thick の角棒を張る。
 */
function band(path, nrm, across, width, thick, hex) {
  const rings = path.map((p, i) => {
    const a = across[i], n = nrm[i];
    return [
      p.clone().addScaledVector(a, -width / 2),
      p.clone().addScaledVector(a, width / 2),
      p.clone().addScaledVector(a, width / 2).addScaledVector(n, thick),
      p.clone().addScaledVector(a, -width / 2).addScaledVector(n, thick),
    ];
  });
  return loft(rings, { capStart: true, capEnd: true, color: () => hex, round: 0 });
}

/** 頂点色を使う複製（左右の部品で共有する。ゴースト用に薄くしても元の材質を壊さない） */
const _vcCache = new WeakMap();
function vcMaterial(src) {
  let m = _vcCache.get(src);
  if (!m) {
    m = src.clone();
    m.vertexColors = true;
    m.color.set(0xffffff);
    _vcCache.set(src, m);
  }
  return m;
}

const smooth01 = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** なめらかな上下限：範囲の内側 k までは素通し、その先は tanh で限界へ寄せる（1 階微分まで連続） */
function softClamp(x, lo, hi, k) {
  if (x < lo + k) return lo + k - k * Math.tanh((lo + k - x) / k);
  if (x > hi - k) return hi - k + k * Math.tanh((x - hi + k) / k);
  return x;
}

/* ------------------------------------------------------------------ */
/* 板とビンディング                                                    */
/* ------------------------------------------------------------------ */

/* ブーツとビンディングで共有する寸法 [m]（ブーツの原点＝足首の真下のソール下面） */
const BOOT = {
  heel: -0.105,     // かかとの端（足首の 10.5 cm 後ろ）
  toe: 0.200,       // つま先の端。足首は足の後ろ寄りにあるので、ブーツの中心は足首より前
  sole: 0.018,      // ソールの厚み
  pivotY: 0.085,    // カフの回転軸（足首の高さ）
  pivotZ: -0.005,
};
const BOOT_MID = (BOOT.heel + BOOT.toe) / 2;
/* 板の厚み 18 mm ＋ プレート 16 mm ＋ ビンディングの台 12 mm。
 * 板の裏からブーツのソールまでの高さ（スタンドハイト）。FIS の規定値はここでは使わない
 * （確かめられていないので、画面にも数値は出さない）。 */
const SKI_THICK = 0.018, PLATE_H = 0.016, AFD_H = 0.012;
const STAND = SKI_THICK + PLATE_H + AFD_H;
/* 板の中心は足首より 6 cm 前。足首はブーツの中心より後ろにあり、ブーツの中心は
 * 板のほぼ中央に付くので、「足首の真下が板の中央」だと前が短く見える。 */
const SKI_FWD = 0.06;
/* 上面の模様の横幅 [m]（UV の u = x / これ + 0.5）。SL と GS で同じ見え方にするため m で固定 */
const SKI_TEX_SPAN = 0.11;

let _skiTex = null;
/**
 * 板の上面の模様（64×1024、全ての板で共有）。
 *   R＝地の明るさ（グラファイト、トップとテールは黒、細い銀のピンストライプ）
 *   G＝ストライプのマスク（ここだけ外／内の色に染める）
 * 色そのものを入れないのは、外／内の切り替えを uniform 1 つで済ませるため。
 * アルファに入れないのは、ブラウザがアルファ 0 の画素の色を捨てることがあるため。
 */
function skiTopTexture() {
  if (_skiTex) return _skiTex;
  const W = 64, HT = 1024;
  const data = new Uint8Array(W * HT * 4);
  const px = SKI_TEX_SPAN / W;                    // 1 画素の幅 [m]
  const cov = (d, half) => smooth01(half - Math.abs(d), -px * 0.7, px * 0.7);   // 線の被覆率
  for (let y = 0; y < HT; y++) {
    const v = (y + 0.5) / HT;                     // 0 = トップ → 1 = テール
    const body = smooth01(v, 0.055, 0.075) * (1 - smooth01(v, 0.955, 0.97));
    for (let x = 0; x < W; x++) {
      const xm = ((x + 0.5) / W - 0.5) * SKI_TEX_SPAN;
      // 地：グラファイト。トップとテールは黒
      let lum = 14 + (52 - 14) * body;
      // 細い銀のピンストライプ（ウエストの内側）
      const pin = cov(Math.abs(xm) - 0.0262, 0.0007) * smooth01(v, 0.09, 0.11) * (1 - smooth01(v, 0.92, 0.94));
      lum += (175 - lum) * pin;
      // ストライプ：中央の 30 mm。トップ寄りで少し太らせて、遠目でも色が読めるようにする
      const half = 0.015 + 0.007 * Math.exp(-(((v - 0.20) / 0.07) ** 2));
      const mask = cov(xm, half) * smooth01(v, 0.08, 0.095) * (1 - smooth01(v, 0.93, 0.945));
      const o = (y * W + x) * 4;
      data[o] = Math.round(lum); data[o + 1] = Math.round(255 * mask); data[o + 2] = 0; data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, HT, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  _skiTex = t;
  return t;
}

/**
 * プレートとビンディング（板のローカル座標、y は板の裏から）。
 * つま先側：トウピース（両側にウイング）、かかと側：ヒールピース（後ろにレバー、脇にブレーキ）。
 */
function bindingParts(waist) {
  const D = COL.plate, G = COL.plateHi;
  const y0 = SKI_THICK, y1 = SKI_THICK + PLATE_H;      // プレートの下面・上面
  const box = (w, h, l, p, hex, r) => paint(place(new THREE.BoxGeometry(w, h, l), { p, r }), hex);
  /** 上が丸いかぶせ（半円柱を z 方向へ寝かせて、高さを潰す） */
  const hood = (r, l, p, sy, hex) => paint(place(
    new THREE.CylinderGeometry(r, r, l, 14, 1, false, -Math.PI / 2, Math.PI),
    { p, r: [-Math.PI / 2, 0, 0], s: [1, 1, sy] }), hex);
  const zt = BOOT.toe, zh = BOOT.heel;
  const parts = [
    // プレート（16 mm）と側面の灰色の線
    box(0.068, PLATE_H, 0.56, [0, y0 + PLATE_H / 2, BOOT_MID], D),
    box(0.0688, 0.003, 0.50, [0, y0 + PLATE_H * 0.55, BOOT_MID], G),
    // つま先とかかとの台（ブーツのソールが乗る面）
    box(0.056, AFD_H, 0.065, [0, y1 + AFD_H / 2, zt - 0.040], G),
    box(0.058, AFD_H, 0.080, [0, y1 + AFD_H / 2, zh + 0.045], D),
    // トウピース：本体・丸いかぶせ・両側のウイング
    box(0.066, 0.034, 0.078, [0, y1 + 0.017, zt + 0.036], D),
    hood(0.033, 0.078, [0, y1 + 0.034, zt + 0.036], 0.42, D),
    box(0.010, 0.026, 0.034, [0.036, y1 + 0.030, zt + 0.004], G, [0, 0, -0.18]),
    box(0.010, 0.026, 0.034, [-0.036, y1 + 0.030, zt + 0.004], G, [0, 0, 0.18]),
    // ヒールピース：ハウジング・かぶせ・後ろのレバー
    box(0.070, 0.050, 0.110, [0, y1 + 0.025, zh - 0.047], D),
    hood(0.035, 0.110, [0, y1 + 0.050, zh - 0.047], 0.45, D),
    box(0.040, 0.010, 0.075, [0, y1 + 0.060, zh - 0.120], G, [0.45, 0, 0]),
    // ブレーキのアーム（たたんだ状態で板の両脇に沿う）
    box(0.006, 0.006, 0.120, [waist / 2 + 0.003, y0 + 0.010, zh - 0.010], G, [0.10, 0, 0]),
    box(0.006, 0.006, 0.120, [-(waist / 2 + 0.003), y0 + 0.010, zh - 0.010], G, [0.10, 0, 0]),
  ];
  return parts;
}

/**
 * レース用の板（ビンディングとプレートを含めて 1 メッシュ）。
 * @param {number} len 板の長さ  @param {number} waist ウエスト幅
 * @param {number} shoulder トップ側の最大幅  @param {number} tail テール側の最大幅
 * @param {number} color ストライプの初期色
 * userData: mat（上面のマテリアル）・mats・setRole(isOuter)・standHeight・baseOutline
 */
export function makeSki(len, waist, shoulder, tail, color = STRIPE_INNER) {
  const half = len / 2;
  // 形はローカル座標 (x = 幅, y = −板の長さ) の 2D 形状で作り、rotateX(-90°) で「+Z が前・+Y が上」に直す
  const pts = [];
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N;                       // 0: テール → 1: トップ
    const zl = -half + len * t;            // 板の中心からの位置
    // サイドカット：テール幅 → ウエスト（中央）→ トップ幅
    const edge = t < 0.5
      ? THREE.MathUtils.lerp(tail, waist, Math.sin(t * Math.PI))
      : THREE.MathUtils.lerp(waist, shoulder, Math.sin((t - 0.5) * Math.PI));
    let w = edge / 2;
    if (t > 0.94) w *= (1 - t) / 0.06 * 0.75 + 0.25;   // トップを丸める
    if (t < 0.03) w *= t / 0.03 * 0.6 + 0.4;
    pts.push([zl, w]);
  }
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][1], -pts[0][0]);
  for (const [z, w] of pts) shape.lineTo(w, -z);
  for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(-pts[i][1], -pts[i][0]);
  shape.closePath();

  /* 厚みは 1 で押し出して、あとで頂点ごとに置き直す。
   * 側面は 3 段にして、いちばん下の 1.8 mm だけをエッジの銀にする。 */
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, steps: 3, bevelEnabled: false, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2);          // 長手 → +Z、厚み → +Y
  // トップとテールを反らせる
  const rise = (z) => {
    const tTip = Math.max(0, (z - half * 0.70) / (half * 0.30));
    const tTail = Math.max(0, (-z - half * 0.84) / (half * 0.16));
    return 0.075 * tTip * tTip + 0.020 * tTail * tTail;
  };
  // 厚み：足元 18 mm、トップとテールへ 9 mm まで薄くする
  const thick = (z) => 0.009 + (SKI_THICK - 0.009) * (1 - smooth01(Math.abs(z) / half, 0.40, 0.92));
  const EDGE = 0.0018;
  const pos = geo.attributes.position;
  const uvA = geo.attributes.uv;
  const nV = pos.count;
  const capEnd = geo.groups[0] ? geo.groups[0].start + geo.groups[0].count : 0;   // 0..capEnd が上下の面
  const cBase = new THREE.Color(COL.skiBase);
  const cSteel = new THREE.Color(COL.steel);
  const clr = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    const zl = pos.getZ(i), yp = pos.getY(i);   // yp：0（裏）〜 1（上面）
    const th = thick(zl);
    let y, c, u = -1, v = -1;
    if (i < capEnd) {
      if (yp < 0.5) { y = 0; c = cBase; }                     // 滑走面
      else {                                                  // 上面：模様を貼る
        y = th; c = null;
        u = pos.getX(i) / SKI_TEX_SPAN + 0.5;
        v = 0.5 - zl / len;
      }
    } else {
      // 側面：下から エッジ（銀）→ サイドウォール（外／内の色。uv.x = −2 の印でシェーダーが染める）。
      // 板をエッジングすると横からは上面が見えないので、色の約束を側面にも残す
      if (yp < 0.2) { y = 0; c = cSteel; }
      else if (yp < 0.5) { y = EDGE; c = cSteel; }
      else if (yp < 0.8) { y = EDGE + 0.0008; c = null; u = -2; }
      else { y = th; c = null; u = -2; }
    }
    pos.setY(i, y + rise(zl));
    pos.setZ(i, zl + SKI_FWD);
    uvA.setXY(i, u, v);
    const cc = c ?? { r: 1, g: 1, b: 1 };
    clr[i * 3] = cc.r; clr[i * 3 + 1] = cc.g; clr[i * 3 + 2] = cc.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(clr, 3));
  geo.clearGroups();
  geo.computeVertexNormals();
  geo.userData.keepUV = true;

  const merged = merge([geo, ...bindingParts(waist)]);
  const uStripe = { value: new THREE.Color(color) };
  const mat = new THREE.MeshStandardMaterial({
    map: skiTopTexture(), vertexColors: true, roughness: 0.30, metalness: 0.15,
  });
  /* 上面だけ模様を使う（UV が負の頂点＝裏・エッジ・ビンディングは頂点色だけ）。
   * 模様の G をマスクにして、ストライプを外／内の色に染める。サイドウォール（uv.x = −2）も同じ色。 */
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uStripe = uStripe;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uStripe;')
      .replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 texelColor = texture2D( map, vMapUv );
          float onTop = step( 0.0, vMapUv.x );                 // 上面：模様
          float onSide = 1.0 - step( -1.5, vMapUv.x );         // サイドウォール：外／内の色
          vec3 design = mix( vec3( texelColor.r ), uStripe, texelColor.g );
          diffuseColor.rgb *= mix( mix( vec3( 1.0 ), uStripe * 0.85, onSide ), design, onTop );
        #endif`);
  };
  mat.customProgramCacheKey = () => 'skiTopStripe';

  const ski = new THREE.Group();
  ski.name = 'ski';
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true;
  ski.add(mesh);
  let role = null;
  ski.userData.mat = mat;
  ski.userData.mats = [mat];
  ski.userData.standHeight = STAND;
  /** 外スキーか内スキーかでストライプの色を変える（光らせない） */
  ski.userData.setRole = (isOuter) => {
    if (role === isOuter) return;
    role = isOuter;
    uStripe.value.setHex(isOuter ? STRIPE_OUTER : STRIPE_INNER);
  };
  // 板の裏の縁（ローカル座標）。skier.js が雪面にいちばん近い点を探すのに使う
  const outline = [];
  for (const [z, w] of pts) outline.push(w, rise(z), z + SKI_FWD, -w, rise(z), z + SKI_FWD);
  ski.userData.baseOutline = new Float32Array(outline);
  return ski;
}

/* ------------------------------------------------------------------ */
/* ブーツ                                                              */
/* ------------------------------------------------------------------ */

/* ロアシェル（足を包む部分）の輪切り：[z, 半幅, 上端の高さ]。つま先へ向かって低く細くなる */
const SHELL = [
  [BOOT.heel, 0.030, 0.100],
  [BOOT.heel + 0.008, 0.040, 0.116],
  [-0.070, 0.046, 0.130],
  [-0.030, 0.050, 0.138],
  [0.020, 0.052, 0.132],
  [0.070, 0.052, 0.106],
  [0.120, 0.049, 0.082],
  [0.160, 0.044, 0.064],
  [0.188, 0.036, 0.052],
  [BOOT.toe, 0.022, 0.044],
];
/* カフ（すねを包む筒）の輪切り：[カフの軸に沿った高さ, 半幅, 前の深さ, 後ろの深さ, 色]。
 * 高さは足首の軸から。上端 0.215 m はソールから約 30 cm（ふくらはぎの中ほど） */
const CUFF = [
  [-0.040, 0.049, 0.050, 0.058, COL.shell],
  [-0.010, 0.054, 0.057, 0.064, COL.shell],
  [0.040, 0.056, 0.060, 0.066, COL.shell],
  [0.120, 0.056, 0.060, 0.066, COL.shell],
  [0.163, 0.056, 0.060, 0.065, COL.shell],
  [0.166, 0.0585, 0.0625, 0.0675, COL.strap],    // パワーストラップ（4 cm）
  [0.202, 0.0585, 0.0625, 0.0675, COL.strap],
  [0.205, 0.056, 0.060, 0.065, COL.shell],
  [0.215, 0.055, 0.059, 0.064, COL.shell],       // 上端
  [0.215, 0.047, 0.051, 0.056, COL.liner],       // 縁を内側へ折り返す（厚みに見せる）
  [0.180, 0.046, 0.050, 0.055, COL.liner],
];

/* すねの表面の目安（body.js の SHANK 表と同じ値。t=0 が膝、1 が足首） */
const SHIN = [[0.0, 0.058, 0.054], [0.14, 0.059, 0.052], [0.30, 0.056, 0.048],
  [0.55, 0.046, 0.042], [0.82, 0.035, 0.033], [1.0, 0.032, 0.032]];
function shinAt(t) {
  for (let i = 0; i < SHIN.length - 1; i++) {
    const [t0, w0, d0] = SHIN[i], [t1, w1, d1] = SHIN[i + 1];
    if (t <= t1) { const u = Math.max(0, (t - t0) / (t1 - t0)); return [w0 + (w1 - w0) * u, d0 + (d1 - d0) * u]; }
  }
  return SHIN[SHIN.length - 1].slice(1);
}

/**
 * スキーブーツ（ロアシェル＋カフの 2 メッシュ、SL はすね当て +1）。
 * @param {THREE.Material} shellMat シェルの材質（頂点色で塗るので複製して使う）
 * @param {THREE.Material} buckleMat 使わない（バックルは頂点色でシェルにまとめた）。互換のため残す
 * @param {Object} opts { shinGuard: SL のすね当て, shankLen: 下腿長 [m], side: 'L' | 'R' }
 * userData.setShank(ankleW, kneeW)：カフを下腿の向きに合わせて回す
 */
export function makeBoot(shellMat, buckleMat, opts = {}) {
  const lat = opts.side === 'R' ? -1 : 1;     // 外側（バックルが並ぶ側）の x の符号
  const mat = vcMaterial(shellMat);
  const g = new THREE.Group();
  g.name = 'boot';

  /* --- ロアシェル ---
   * 横断面は超楕円。上半分は丸く、下半分は平ら（ソールに乗る）。 */
  const R = 18;
  const yb = BOOT.sole - 0.002;
  const shellRings = SHELL.map(([z, w, yt]) => {
    const hy = (yt - yb) / 2, yc = (yt + yb) / 2;
    return superRing(R, { w, d0: hy, c: yc, e0: 2.6, e1: 6 })
      .map(([x, y]) => new THREE.Vector3(x, y, z));
  });
  const shellGeo = loft(shellRings, { capStart: true, capEnd: true, color: () => COL.shell, round: 0.5 });
  const parts = [shellGeo];
  // ソールと前後のコバ（ビンディングに噛む出っ張り）
  const box = (w, h, l, p, hex, r) => paint(place(new THREE.BoxGeometry(w, h, l), { p, r }), hex);
  parts.push(box(0.090, BOOT.sole, BOOT.toe - BOOT.heel, [0, BOOT.sole / 2, BOOT_MID], COL.sole));
  parts.push(box(0.064, 0.016, 0.024, [0, 0.010, BOOT.toe + 0.004], COL.sole));
  parts.push(box(0.066, 0.016, 0.022, [0, 0.010, BOOT.heel - 0.004], COL.sole));
  /* 甲のバックル 2 個：内側から甲を越えて外側へ回るストラップと、外側のレバー */
  const shellAt = (z) => {
    for (let i = 0; i < SHELL.length - 1; i++) {
      const [z0, w0, t0] = SHELL[i], [z1, w1, t1] = SHELL[i + 1];
      if (z <= z1) { const u = (z - z0) / (z1 - z0); return [w0 + (w1 - w0) * u, t0 + (t1 - t0) * u]; }
    }
    return SHELL[SHELL.length - 1].slice(1);
  };
  for (const z of [0.115, 0.060]) {
    const [w, yt] = shellAt(z);
    const hy = (yt - yb) / 2, yc = (yt + yb) / 2;
    const th0 = -0.9 * lat, th1 = 1.45 * lat;
    const path = [], nrm = [], acr = [];
    for (let k = 0; k <= 6; k++) {
      const t = th0 + (th1 - th0) * k / 6;
      const s = Math.sin(t), c = Math.cos(t);
      const e = 2 / 2.6;
      const p = new THREE.Vector3(w * Math.sign(s) * Math.abs(s) ** e, yc + hy * Math.sign(c) * Math.abs(c) ** e, z);
      const n = new THREE.Vector3(p.x / (w * w), (p.y - yc) / (hy * hy), 0).normalize();
      path.push(p.addScaledVector(n, 0.0015)); nrm.push(n); acr.push(new THREE.Vector3(0, 0, 1));
    }
    parts.push(band(path, nrm, acr, 0.014, 0.003, COL.buckle));
    // レバー（外側の端）
    const pe = path[path.length - 1], ne = nrm[nrm.length - 1];
    parts.push(paint(place(new THREE.BoxGeometry(0.007, 0.030, 0.018),
      { p: [pe.x + ne.x * 0.004, pe.y - 0.010, z], r: [0, 0, -lat * 0.25] }), COL.buckle));
  }
  const shell = new THREE.Mesh(merge(parts), mat);
  shell.castShadow = true;
  g.add(shell);

  /* --- カフ（足首の高さを軸に回る子グループ） --- */
  const cuffG = new THREE.Group();
  cuffG.position.set(0, BOOT.pivotY, BOOT.pivotZ);
  g.add(cuffG);
  const RC = 20;
  const cuffRings = CUFF.map(([y, w, df, db]) =>
    superRing(RC, { w, d0: df, d1: db, e0: 2.4 }).map(([x, z]) => new THREE.Vector3(x, y, z)));
  const cuffParts = [loft(cuffRings, { capStart: true, color: (i) => CUFF[i][4] })];
  /* カフのバックル 2 個：前を回って外側のレバーへ */
  for (const y of [0.035, 0.105]) {
    const w = 0.056, df = 0.060, db = 0.066;
    const th0 = -1.25 * lat, th1 = 1.6 * lat;
    const path = [], nrm = [], acr = [];
    for (let k = 0; k <= 7; k++) {
      const t = th0 + (th1 - th0) * k / 7;
      const s = Math.sin(t), c = Math.cos(t);
      const d = c >= 0 ? df : db, e = 2 / 2.4;
      const p = new THREE.Vector3(w * Math.sign(s) * Math.abs(s) ** e, y, d * Math.sign(c) * Math.abs(c) ** e);
      const n = new THREE.Vector3(p.x / (w * w), 0, p.z / (d * d)).normalize();
      path.push(p.addScaledVector(n, 0.0012)); nrm.push(n); acr.push(new THREE.Vector3(0, 1, 0));
    }
    cuffParts.push(band(path, nrm, acr, 0.013, 0.003, COL.buckle));
    const pe = path[path.length - 1], ne = nrm[nrm.length - 1];
    cuffParts.push(paint(place(new THREE.BoxGeometry(0.007, 0.034, 0.016),
      { p: [pe.x + ne.x * 0.004, y - 0.008, pe.z + ne.z * 0.004], r: [0, 0, 0] }), COL.buckle));
  }
  const cuff = new THREE.Mesh(merge(cuffParts), mat);
  cuff.castShadow = true;
  cuffG.add(cuff);

  const mats = [mat];
  /* --- SL のすね当て ---
   * 前 200° だけの開いた殻。カフの上端の少し内側から、膝の 11 cm 下まで。
   * すねの表面から 1 cm 浮かせ、縦に稜線を入れる（硬いプラスチックに見せる）。 */
  if (opts.shinGuard) {
    const shank = opts.shankLen ?? 0.43;
    const S = shank / 0.4305;                    // 身長比（身長 1.75 m で 1）
    const gMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.0 });
    mats.push(gMat);
    // 上端は膝の 11 cm 下。それより上は body.js が膝の曲がりに合わせて輪を回すので、すねの表面が前へ出る
    const y0 = 0.190, y1 = shank - 0.110 * S;
    const rings = [];
    const NR = 6, NP = 12, TH = (200 / 2) * Math.PI / 180;
    for (let i = 0; i <= NR; i++) {
      const y = y0 + (y1 - y0) * i / NR;
      const [w0, d0] = shinAt(1 - y / shank);
      // 上端は弧を少し狭めて角を丸める（幅を細めるとすねの表面が突き抜ける）
      const th = TH * (1 - 0.22 * smooth01(i / NR, 0.6, 1));
      const out = [], inn = [];
      for (let j = 0; j <= NP; j++) {
        const t = -th + 2 * th * j / NP;
        const s = Math.sin(t), c = Math.cos(t);
        const ridge = 0.004 * S * Math.exp(-((t / 0.32) ** 2));
        const gap = (0.010 + 0.004 * (i / NR)) * S;           // 上ほど少し浮かせる
        const w = w0 * S + gap, d = d0 * S + gap + ridge;
        out.push(new THREE.Vector3(w * s, y, d * c));
        inn.push(new THREE.Vector3((w - 0.003) * s, y, (d - 0.003 - ridge) * c));
      }
      // 外の弧 → 内の弧（逆向き）で、厚みのある三日月形の輪切りにする
      rings.push([...out, ...inn.reverse()]);
    }
    const guard = new THREE.Mesh(loft(rings, { color: () => COL.guard, probe: NP + 1 }), gMat);
    guard.castShadow = true;
    cuffG.add(guard);
  }

  const _inv = new THREE.Matrix4(), _d = new THREE.Vector3();
  g.userData.mats = mats;
  g.userData.cuff = cuffG;
  /**
   * カフを下腿の向きに合わせる。前傾は 0〜43°、横は ±17° の範囲へなめらかに収める（調整値）。
   * 実物のカフは前傾が十数度に決まっていて、すねはその中でほとんど動かない。
   * ここでは「すねの表面がカフから突き抜けない」ことを優先して下腿に沿わせる
   * （実測で下腿は板の法線から前へ 4〜36°、横へ −10〜+2°。この範囲ではほぼ素通し）。
   */
  g.userData.setShank = (ankleW, kneeW) => {
    g.updateMatrixWorld(true);
    _inv.copy(g.matrixWorld).invert();
    _d.copy(kneeW).sub(ankleW).transformDirection(_inv);
    const sag = Math.atan2(_d.z, _d.y);
    const side = Math.asin(THREE.MathUtils.clamp(_d.x, -1, 1));
    cuffG.rotation.set(softClamp(sag, 0.0, 0.75, 0.08), 0, -softClamp(side, -0.30, 0.30, 0.08));
  };
  return g;
}

/* ------------------------------------------------------------------ */
/* グローブとストック                                                  */
/* ------------------------------------------------------------------ */

/**
 * グローブ：グリップを握った拳と親指（1 メッシュ）。
 * 手首から先のカフ（ガントレット）は前腕の表面（body.js）に同じ色で描くので、ここには作らない。
 * 前腕とストックの角度は姿勢で変わるので、固い 1 つの形にすると、どちらかに必ずずれるため。
 * userData.setPose(hand, poleDir, forearmDir)：ストックの軸が拳の中を通る向きに置く
 */
export function makeGlove(mat) {
  const m0 = vcMaterial(mat);
  // ローカル：y＝グリップの軸（上向き）、z＝拳の正面（前腕の向き）、x＝横
  const fist = paint(place(new THREE.CapsuleGeometry(0.027, 0.036, 3, 10),
    { p: [0, -0.006, 0.008], s: [1.0, 1.0, 1.28] }), GLOVE_COLOR);
  const thumb = paint(place(new THREE.CapsuleGeometry(0.011, 0.026, 2, 6),
    { p: [0, 0.040, 0.016], r: [Math.PI / 2 + 0.5, 0, 0] }), GLOVE_COLOR);
  // 拳の正面（指の背）の当て布：少し明るい灰
  const knuckle = paint(place(new THREE.CapsuleGeometry(0.012, 0.050, 2, 6),
    { p: [0, -0.004, 0.036], s: [1.6, 1.0, 0.7] }), GLOVE_KNUCKLE);
  const geo = merge([fist, thumb, knuckle]);
  const m = new THREE.Mesh(geo, m0);
  m.castShadow = true;
  m.userData.mats = [m0];
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M = new THREE.Matrix4();
  /** @param hand 手（グリップを握る点） @param poleDir グリップから先への向き @param forearmDir 肘→手 */
  m.userData.setPose = (hand, poleDir, forearmDir) => {
    Y.copy(poleDir).negate().normalize();
    Z.copy(forearmDir).addScaledVector(Y, -forearmDir.dot(Y));
    if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1).addScaledVector(Y, -Y.z);
    Z.normalize();
    X.crossVectors(Y, Z).normalize();
    m.position.copy(hand);
    m.quaternion.setFromRotationMatrix(M.makeBasis(X, Y, Z));
  };
  return m;
}

/**
 * SL のハンドガード（盾形に曲がった殻、厚み 3 mm）。
 * 拳の正面を覆い、上はグリップの頭の高さまで、下は拳の下まで。上ほど狭く丸める。
 */
function handGuardGeo(A) {
  const rows = 7, cols = 10;
  const y0 = 0.050, y1 = -0.070;                 // 握る点からの軸方向の範囲（上 → 下）
  const outer = [], inner = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const s = -y0 + (y0 - y1) * t;               // 軸の長さ s（握る点から先へ）
    const c = A.at(s);
    const r = 0.046 + 0.010 * t;                 // 下へ行くほど拳から離れる
    const half = 0.55 + 0.45 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2);   // 上は狭く
    const o = [], n = [];
    for (let j = 0; j <= cols; j++) {
      const a = -half + 2 * half * (j / cols);
      o.push(new THREE.Vector3(r * Math.sin(a), 0, r * Math.cos(a)).add(c));
      n.push(new THREE.Vector3((r - 0.003) * Math.sin(a), 0, (r - 0.003) * Math.cos(a)).add(c));
    }
    outer.push(o); inner.push(n);
  }
  // 外の面 → 内の面（逆向き）で厚みのある輪切りにして、ロフトで張る
  const rings = outer.map((o, i) => [...o, ...inner[i].slice().reverse()]);
  return loft(rings, { color: () => COL.handGuard, probe: cols + 1, capStart: false, capEnd: false });
}

/**
 * ストック（1 メッシュ）。ローカル座標は原点＝握る点、−Y＝先端への向き（弦）、+Z＝身体と反対側。
 *   グリップ（黒、握りの 5 cm 上まで）・シャフト（先へ細くなる）・小さな円錐のバスケット・石突き。
 *   GS：グリップの 30 cm 下から約 15° 曲がった「ベント」ストック。弦（握り→先端）を
 *       skier.js が決めた向きに合わせるので、曲がりは身体の外へふくらみ、身体を回り込んで見える。
 *   SL：拳の前にハンドガード（旗門を払う手を守る灰色の殻）。
 * @param {Object} disc 種目（disc.key === 'GS' でベント）
 * @param {THREE.Material} mat 使わない（頂点色で塗り分けるので自前の材質を作る）。互換のため残す
 * @param {THREE.Texture} env 金属の映り込み用の環境マップ
 */
export function makePole(disc, mat, env) {
  const isGS = disc?.key === 'GS';
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.32, metalness: 0.35,
    envMap: env ?? null, envMapIntensity: 0.8, side: THREE.DoubleSide,
  });
  const g = new THREE.Group();
  g.name = 'pole';
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.castShadow = true;
  g.add(mesh);
  let builtLen = 0;
  const upperDir = new THREE.Vector3(0, -1, 0);   // グリップ付近の軸の向き（ローカル）

  /** 軸を長さ s（握る点からの距離、上が負）で引けるようにする：at(s) 位置、dirAt(s) 先への向き */
  function axis(len) {
    const BEND_AT = 0.11 + 0.30, BEND_LEN = 0.25, BEND = isGS ? 15 * Math.PI / 180 : 0;
    // 曲がる前は −Y へまっすぐ、曲がったあとは −Z 側へ BEND だけ傾ける（円弧でつなぐ）
    const at = (s) => {
      if (s <= BEND_AT) return new THREE.Vector3(0, -s, 0);
      const r = BEND > 0 ? BEND_LEN / BEND : 0;
      const sb = Math.min(s, BEND_AT + BEND_LEN) - BEND_AT;
      const ang = BEND > 0 ? sb / r : 0;
      const p = new THREE.Vector3(0, -BEND_AT, 0);
      if (BEND > 0) p.add(new THREE.Vector3(0, -r * Math.sin(ang), -r * (1 - Math.cos(ang))));
      if (s > BEND_AT + BEND_LEN) {
        const rest = s - BEND_AT - BEND_LEN;
        p.add(new THREE.Vector3(0, -Math.cos(BEND), -Math.sin(BEND)).multiplyScalar(rest));
      }
      return p;
    };
    // 弦（握る点 → 先端）が −Y を向くように全体を x 軸まわりに回す
    const tip = at(len);
    const alpha = Math.atan2(tip.z, -tip.y);          // 弦が −Y から +Z 側へ倒れている角
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), alpha);
    const dirAt = (s) => at(s + 0.005).sub(at(s - 0.005)).normalize().applyQuaternion(q);
    return { at: (s) => at(s).applyQuaternion(q), dirAt, q };
  }

  function build(len) {
    builtLen = len;
    const A = axis(len);
    const parts = [];
    /** 軸上の s0〜s1 に沿った円柱（半径 r0 → r1） */
    const along = (s0, s1, r0, r1, hex, radial = 10) => {
      const mid = A.at((s0 + s1) / 2), d = A.dirAt((s0 + s1) / 2);
      const geo = new THREE.CylinderGeometry(r0, r1, s1 - s0, radial, 1);
      // 円柱の +Y を「握る側」（−d）へ向ける
      geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().negate()));
      geo.translate(mid.x, mid.y, mid.z);
      return paint(geo, hex);
    };
    // グリップ（握りの 5 cm 上から 11 cm 下まで）と頭の丸み
    parts.push(along(-0.05, 0.11, 0.0135, 0.0120, COL.grip, 10));
    parts.push(paint(place(new THREE.SphereGeometry(0.0145, 10, 5),
      { p: A.at(-0.05).toArray(), s: [1, 0.55, 1] }), COL.grip));
    // シャフト：曲がりを含めた管。先へ向かって 9 mm → 5.5 mm に細くする
    const s0 = 0.10, s1 = len - 0.02;
    const pts = [];
    for (let s = s0; s <= s1 + 1e-6; s += (s1 - s0) / 40) pts.push(A.at(s));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
    const TUB = isGS ? 20 : 3, RAD = 8;
    const tube = new THREE.TubeGeometry(curve, TUB, 0.009, RAD, false);
    const tp = tube.attributes.position, c = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= TUB; i++) {
      curve.getPointAt(i / TUB, c);
      const k = 1 - 0.39 * (i / TUB);
      for (let j = 0; j <= RAD; j++) {
        const o = i * (RAD + 1) + j;
        v.fromBufferAttribute(tp, o).sub(c).multiplyScalar(k).add(c);
        tp.setXYZ(o, v.x, v.y, v.z);
      }
    }
    parts.push(paint(tube, COL.shaft));
    // バスケット（先端の 10 cm 上の小さな円錐）と石突き
    {
      const d = A.dirAt(len - 0.10), p = A.at(len - 0.10);
      const cone = new THREE.ConeGeometry(0.034, 0.014, 12, 1, true);
      cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().negate()));
      cone.translate(p.x, p.y, p.z);
      parts.push(paint(cone, COL.grip));
      parts.push(along(len - 0.106, len - 0.094, 0.010, 0.010, COL.grip, 10));
      // 石突き：円錐の先（ConeGeometry の +Y）を先端の向きへ
      const tipG = new THREE.ConeGeometry(0.0055, 0.024, 8);
      tipG.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), A.dirAt(len - 0.012)));
      const pt = A.at(len - 0.012);
      tipG.translate(pt.x, pt.y, pt.z);
      parts.push(paint(tipG, COL.tip));
    }
    // SL：拳の前のハンドガード。拳の正面（+Z 側）を覆う盾形の殻で、
    // 上はグリップの頭まで、下へ行くほど広く、拳から 1 cm ほど離す
    if (!isGS) parts.push(handGuardGeo(A));
    mesh.geometry.dispose();
    mesh.geometry = merge(parts);
    upperDir.copy(A.dirAt(0.02));
  }

  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M = new THREE.Matrix4();
  g.userData.shaft = mesh;
  g.userData.mats = [material];
  g.userData.gripDir = new THREE.Vector3(0, -1, 0);
  /**
   * @param grip 握る点 @param dir 先端への向き（単位）@param len 長さ（1 cm 以上変わったら作り直す）
   * @param towardBody 身体へ向く単位ベクトル。GS の曲がりは身体と反対側へふくらませる
   */
  g.userData.setPose = (grip, dir, len, towardBody) => {
    if (Math.abs(len - builtLen) > 0.01) build(len);
    Y.copy(dir).negate().normalize();
    Z.copy(towardBody ?? new THREE.Vector3(0, 0, 1)).negate();
    Z.addScaledVector(Y, -Z.dot(Y));
    if (Z.lengthSq() < 1e-8) Z.set(1, 0, 0).addScaledVector(Y, -Y.x);
    Z.normalize();
    X.crossVectors(Y, Z).normalize();
    g.position.copy(grip);
    g.quaternion.setFromRotationMatrix(M.makeBasis(X, Y, Z));
    // グリップ付近の軸の向き（ワールド）。グローブの拳をこの向きに合わせる
    g.userData.gripDir.copy(upperDir).applyQuaternion(g.quaternion);
  };
  return g;
}

/* ------------------------------------------------------------------ */
/* 頭（顔・ヘルメット・ゴーグル）                                      */
/* ------------------------------------------------------------------ */

/**
 * ヘルメットの殻。顔の前は開き、横と後ろは耳の下まで下りる。
 * 行を「てっぺんからの角度 φ」で刻む（以前は高さで刻んでいたので、
 * てっぺんのすぐ下の輪がもう半径の半分あり、頂点がとがって見えた）。
 * 後ろには小さなスポイラー（稜線）、横には耳のふくらみ。中央の白い線はマテリアル側で描く。
 */
function helmetShellPoint(a, phi, hx, hy, hz) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const spoiler = 0.06 * Math.exp(-(((phi - 1.9) / 0.22) ** 2)) * smooth01(-ca, 0.3, 0.8);
  const ear = 0.035 * Math.exp(-(((phi - 1.85) / 0.25) ** 2)) * sa * sa;
  const k = Math.sin(phi) * (1 + spoiler + ear);
  return new THREE.Vector3(hx * k * sa, hy * Math.cos(phi), hz * k * ca);
}
function helmetBottom(a) {
  const ca = Math.cos(a);
  const front = Math.max(0, ca), back = Math.max(0, -ca);
  const side = 1 - front - back;
  // 下端：前は眉の高さで止め、横と後ろは耳の下まで下ろす（以前と同じ線）
  return Math.acos(THREE.MathUtils.clamp(0.32 * front - 0.84 * back - 0.72 * side, -1, 1));
}
function helmetGeo(hx, hy, hz, seg = 44, rows = 14) {
  const pos = [], clr = [], idx = [];
  const cBase = new THREE.Color(COL.helmet), cPad = new THREE.Color(COL.pad);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;         // 0 = 前（+z）
    const pb = helmetBottom(a);
    for (let j = 0; j <= rows + 1; j++) {
      let p;
      if (j <= rows) p = helmetShellPoint(a, (j / rows) * pb, hx, hy, hz);
      else {
        // 縁を内側へ 6 mm 折り返して、殻の厚みに見せる
        p = helmetShellPoint(a, pb, hx, hy, hz);
        p.multiplyScalar(0.93);
        p.y += 0.004;
      }
      pos.push(p.x, p.y, p.z);
      const c = j > rows ? cPad : cBase;
      clr.push(c.r, c.g, c.b);
    }
  }
  const R = rows + 2;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < R - 1; j++) {
      const a = i * R + j, b = a + R;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(clr, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // つなぎ目（a = 0 と 2π）の法線をそろえ、てっぺんは真上にする
  const N = geo.attributes.normal;
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  for (let j = 0; j < R; j++) {
    const a0 = j, a1 = seg * R + j;
    v.fromBufferAttribute(N, a0).add(w.fromBufferAttribute(N, a1)).normalize();
    N.setXYZ(a0, v.x, v.y, v.z); N.setXYZ(a1, v.x, v.y, v.z);
  }
  for (let i = 0; i <= seg; i++) N.setXYZ(i * R, 0, 1, 0);
  return geo;
}

/**
 * SL のチンガード：耳のところで殻に入り、口の前を通る 1 本のバー。
 * 断面は縦長の角丸長方形（約 34 × 14 mm）。以前のトーラスは顎の下に浮いていた。
 */
function chinBarGeo(rx, ry, rz, S) {
  const ctrl = [
    [0.95, -0.36, 0.02], [0.92, -0.46, 0.55], [0.62, -0.53, 1.08], [0, -0.55, 1.30],
    [-0.62, -0.53, 1.08], [-0.92, -0.46, 0.55], [-0.95, -0.36, 0.02],
  ].map(([x, y, z]) => new THREE.Vector3(x * rx, y * ry, z * rz));
  const curve = new THREE.CatmullRomCurve3(ctrl, false, 'catmullrom', 0.5);
  const H = 0.017 * S, T = 0.007 * S, rc = 0.005 * S;     // 半分の高さ・半分の厚み・角の丸み
  // 角丸長方形の断面（u = 外向き、v = 上）
  const sec = [];
  const corners = [[T - rc, H - rc], [-(T - rc), H - rc], [-(T - rc), -(H - rc)], [T - rc, -(H - rc)]];
  for (let q = 0; q < 4; q++) {
    for (let k = 0; k <= 2; k++) {
      const ang = (q * Math.PI) / 2 + (k / 2) * (Math.PI / 2);
      sec.push([corners[q][0] + rc * Math.cos(ang), corners[q][1] + rc * Math.sin(ang)]);
    }
  }
  const up = new THREE.Vector3(0, 1, 0);
  const rings = [];
  const NS = 24;
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const p = curve.getPointAt(t), T3 = curve.getTangentAt(t);
    const V = up.clone().addScaledVector(T3, -up.dot(T3)).normalize();
    const U = new THREE.Vector3().crossVectors(V, T3).normalize();
    // U が外（顔と反対）を向くようにそろえる
    if (U.dot(new THREE.Vector3(p.x, 0, p.z)) < 0) U.negate();
    rings.push(sec.map(([u, v]) => p.clone().addScaledVector(U, u).addScaledVector(V, v)));
  }
  return loft(rings, { capStart: true, capEnd: true, color: () => COL.helmet, round: 0 });
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

/** 頭の楕円体に貼りつくレンズの曲面（UV：u＝左右、v＝上端 0 → 下端 1） */
function goggleLens(R, A, p, seg = 32, rows = 5) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = -A + 2 * A * (i / seg);
    const [yT, yB] = goggleEdge(a, A, p);
    for (let j = 0; j <= rows; j++) {
      const y = yT + (yB - yT) * (j / rows);
      const k = Math.sqrt(Math.max(0, 1 - (y / R.y) ** 2));
      pos.push(R.x * k * Math.sin(a), y, R.z * k * Math.cos(a));
      uv.push(i / seg, 1 - j / rows);
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
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
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

/* レンズの映り込みの色（イリジウムミラーの縦のグラデーション：濃紺 → 地平線の白 → 琥珀） */
let _lensTex = null;
function lensGradient() {
  if (_lensTex) return _lensTex;
  const n = 128, data = new Uint8Array(n * 4);
  const stops = [[0, [0x0a, 0x1a, 0x40]], [0.45, [0x3a, 0x5a, 0x9a]], [0.62, [0xff, 0xf3, 0xd0]], [1, [0xff, 0x8a, 0x2a]]];
  for (let i = 0; i < n; i++) {
    const v = 1 - i / (n - 1);                  // 行 0 が UV の v = 0（下端）
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1];
    const u = THREE.MathUtils.clamp((v - t0) / (t1 - t0), 0, 1);
    for (let ch = 0; ch < 3; ch++) data[i * 4 + ch] = Math.round(c0[ch] + (c1[ch] - c0[ch]) * u);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, 1, n, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  _lensTex = t;
  return t;
}

/**
 * 頭（顔＋ヘルメット＋ゴーグル）。描画は 4 メッシュ。
 * ローカル座標は +x 左・+y 上・+z 前、原点は頭の中心（耳の高さ）。
 * @param {Object} mats { skin, lens }（以前の helmet / frame / strap は渡されても使わない）。
 *   ヘルメット・枠・ストラップは頂点色で塗るので自前の材質を作る。
 *   レンズの映り込み（envMap）はヘルメットにも少し使う。
 * @returns {{group, chinGuard, setChinGuard(on), mats}}
 */
export function createHeadGear(H, mats) {
  const S = H / 1.75;
  const g = new THREE.Group();
  g.name = 'head';
  const rx = 0.078 * S, ry = 0.112 * S, rz = 0.097 * S;

  // 顔（頭蓋＋下顎を 1 つに）
  const cran = paint(place(new THREE.SphereGeometry(1, 20, 14),
    { p: [0, 0.008 * S, -0.004 * S], s: [rx * 0.97, ry * 0.94, rz * 0.97] }), 0xffffff);
  const jaw = paint(place(new THREE.SphereGeometry(1, 14, 10),
    { p: [0, -ry * 0.50, rz * 0.16], s: [rx * 0.72, ry * 0.42, rz * 0.66] }), 0xffffff);
  const face = new THREE.Mesh(merge([cran, jaw]), mats.skin);
  g.add(face);

  // ヘルメット：殻（＋SL はチンガード）。地は濃紺で、雪の上でも輪郭が出る
  const env = mats.lens?.envMap ?? null;
  const helmetMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.18, metalness: 0.1,
    envMap: env, envMapIntensity: 0.6, side: THREE.DoubleSide,
  });
  const hx = rx * 1.15, hy = ry * 1.12, hz = rz * 1.13;
  /* 中央の白い線（幅 3 cm）。頂点色だと三角形の大きさで縁がぎざぎざになるので、
   * ヘルメットのローカル座標の |x| から画素ごとに塗る。チンガード（前の低いところ）と
   * 内側のパッド（青みのない灰）には塗らない。 */
  const stripeCol = new THREE.Color(COL.helmetStripe);
  helmetMat.onBeforeCompile = (sh) => {
    sh.uniforms.uStripeW = { value: 0.17 * hx };
    sh.uniforms.uStripeCol = { value: stripeCol };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHPos;\nuniform float uStripeW;\nuniform vec3 uStripeCol;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float aa = fwidth( vHPos.x ) + 1e-4;
          float st = 1.0 - smoothstep( uStripeW - aa, uStripeW + aa, abs( vHPos.x ) );
          st *= 1.0 - step( 0.5, float( vHPos.y < 0.0 && vHPos.z > 0.0 ) );   // チンガード
          st *= step( 0.02, vColor.b - vColor.r );                           // パッドは除く
          diffuseColor.rgb = mix( diffuseColor.rgb, uStripeCol, st );
        }`);
  };
  helmetMat.customProgramCacheKey = () => 'helmetStripe';
  const shellGeo = helmetGeo(hx, hy, hz);
  shellGeo.translate(0, 0.004 * S, -0.005 * S);
  const geoNoChin = merge([shellGeo]);
  const geoChin = merge([shellGeo, chinBarGeo(rx, ry, rz, S)]);
  const helmet = new THREE.Mesh(geoNoChin, helmetMat);
  g.add(helmet);

  // ゴーグル：レンズ（ミラー）と、枠＋ストラップ（1 メッシュ）
  const gg = { yc: -0.002 * S, hT: 0.038 * S, hB: 0.034 * S, nose: 0.014 * S };
  const RL = { x: rx * 1.05, y: ry * 1.06, z: rz * 1.07 };
  const A = 1.30;                                   // 左右への回り込み（±74°）
  const lens = new THREE.Mesh(goggleLens(RL, A, gg), mats.lens);
  lens.position.set(0, ry * 0.02, 0.002 * S);
  g.add(lens);
  /* 環境マップがまだ暗い（空が映らない）ときでも黒い穴に見えないよう、
   * イリジウムミラーのグラデーションを弱く自発光させる。 */
  if (mats.lens && !mats.lens.emissiveMap) {
    mats.lens.emissiveMap = lensGradient();
    mats.lens.emissive?.set(0xffffff);
    mats.lens.emissiveIntensity = 0.25;
    mats.lens.needsUpdate = true;
  }
  const frameGeo = paint(new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(goggleOutline(RL, A, gg, 1.015), true, 'catmullrom', 0.5),
    48, 0.008 * S, 6, true), COL.frame);
  frameGeo.translate(0, ry * 0.02, 0.002 * S);
  /* ストラップ：こめかみから後頭部へ、ヘルメットの表面から 3 mm 浮かせて回す。
   * 前から見えるのはこめかみのところだけなので、レンズの範囲（±A）には作らない。 */
  const strapY = ry * 0.05;
  const strapPath = [], strapN = [], strapA = [];
  const a0 = A - 0.10, a1 = Math.PI * 2 - A + 0.10;
  for (let i = 0; i <= 28; i++) {
    const a = a0 + (a1 - a0) * (i / 28);
    const phi = Math.acos(THREE.MathUtils.clamp((strapY - 0.004 * S) / hy, -1, 1));
    const p = helmetShellPoint(a, phi, hx, hy, hz).add(new THREE.Vector3(0, 0.004 * S, -0.005 * S));
    const n = new THREE.Vector3(p.x / (hx * hx), 0, p.z / (hz * hz)).normalize();
    strapPath.push(p.addScaledVector(n, 0.003));
    strapN.push(n);
    strapA.push(new THREE.Vector3(0, 1, 0));
  }
  const strapGeo = band(strapPath, strapN, strapA, 0.032 * S, 0.0025, COL.gStrap);
  const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.0 });
  const trim = new THREE.Mesh(merge([frameGeo, strapGeo]), trimMat);
  g.add(trim);

  for (const m of g.children) m.castShadow = true;

  let chinOn = false;
  const chinGuard = {
    get visible() { return chinOn; },
    set visible(v) { setChinGuard(v); },
  };
  function setChinGuard(on) {
    chinOn = !!on;
    helmet.geometry = chinOn ? geoChin : geoNoChin;
  }
  return {
    group: g, chinGuard, setChinGuard,
    mats: [helmetMat, mats.skin, mats.lens, trimMat],
  };
}
