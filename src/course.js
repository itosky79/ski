/**
 * course.js — 斜面・旗門・シュプールの生成
 *
 * 旗門の寸法は FIS ICR に準拠
 *   SL  旗門幅 4〜6 m、ターニングポールはフレックスポール（雪面上 約 1.8 m）[ICR 801.2.3 / 680.2.1.1]
 *   GS  旗門幅 4〜8 m、パネルは約 75 × 50 cm、下端は雪面から約 1 m       [ICR 901.2.2 / 901.2.3]
 *
 * 雪面の上の「ライン」は記号の線ではなく、実際のレースで見える跡で見せる。
 *   ・削れたレースライン：何十人も同じところを滑るので、ラインの帯だけ雪が削れて青く光る
 *   ・カービングの溝：このスキーヤーの 2 本のエッジの跡（滑ったところだけ伸びる）
 * 以前の等高線 31 本と黄色のフォールラインは、図面のように見えるうえ描画コールも多いのでやめた。
 *
 * 旗門のポールは 1 本 1 メッシュ（GS は旗門の片側の 2 本で 1 メッシュ）。しなりは頂点を曲げて出す。
 * 以前は 1 本を 3 節（3 メッシュ）に分けていた。まとめたことで、既定の画面の描画コールが
 * GS で 75 回、SL で 29 回減った（影のパス込み、1440×900 で実測）。
 * カメラと骨盤の間に入ったポール・パネルは薄くする（updateOcclusion）。
 */
import * as THREE from 'three';

const POLE_H = 1.8;          // 雪面から出ているポールの高さ [m]
const POLE_R = 0.014;
/* 雪面（this.snow）は斜面の基準面より 1 cm 下（skier.js の SNOW_N と同じ） */
const SNOW_N = -0.010;

/** ピステ（圧雪したコース）の半幅 [m]。ネットはこの 1.5 m 内側に立つ */
export function pisteHalfWidth(model, disc) {
  return Math.max(20, model.A + (disc?.gateWidth ?? model.p.gateWidth ?? 5) + 12);
}

/**
 * コースと雪面・地形の前後の範囲（斜面座標 u [m]）。environment.js と同じ値を使う。
 *   u0〜u1   ：旗門のある区間（スタートの少し上〜ゴールの少し下）
 *   uTop     ：ここより上はピステも地形で覆い、尾根にする（霞の中の稜線）
 *   uEnd     ：下の端。霧の外まで続ける
 */
export function courseExtent(model, gateCount = 9) {
  const u0 = -2 * model.halfCycle;
  const u1 = model.halfCycle * (gateCount + 2);
  return { u0, u1, uTop: u0 - 260, uStart: u0 - 600, uEnd: u1 + 700 };
}

/** 雪面テクスチャ（手続き生成）：細かい粒感だけ。整備跡はシェーダーで足す */
function snowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f7fd';
  g.fillRect(0, 0, 512, 512);
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 整備跡（コーデュロイ）：横 1 方向の縞。3 m に 57 本（約 5 cm 間隔） */
function corduroyTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 4;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 512, 4);
  g.fillStyle = '#fff';
  for (let x = 0; x < 512; x += 9) g.fillRect(x, 0, 2, 4);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** 大きなむら（100 m ほどの周期）。繰り返し模様がタイル状に見えないように明るさを ±4 % 揺らす */
function macroTexture() {
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  let seed = 7;
  const R = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const ph = Array.from({ length: 6 }, () => R() * Math.PI * 2);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = (x / n) * Math.PI * 2, b = (y / n) * Math.PI * 2;
    const v = 0.5 + 0.22 * Math.sin(a + ph[0]) * Math.cos(b * 2 + ph[1])
      + 0.16 * Math.sin(a * 3 + b + ph[2]) + 0.12 * Math.cos(a * 2 - b * 3 + ph[3]);
    const o = (y * n + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255);
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 削れたレースラインの帯：中央の 1/2 はほぼ一様に濃く、縁へなめらかに薄く。滑走方向に淡い筋 */
function raceLineTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  let seed = 5;
  const R = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const img = g.createImageData(64, 256);
  /* 横方向のむら：乱数をならして 20〜30 cm の幅にし、濃淡は ±12 % に抑える。
   * 列ごとの濃淡が強い（以前は 0.6〜1.0）と、低いカメラからは遠近で 1 点に集まる
   * 「放射状の光線」に見えた */
  const raw = Array.from({ length: 64 }, () => R());
  const lane = raw.map((_, x) => {
    let s = 0, w = 0;
    for (let k = -3; k <= 3; k++) { const kw = 4 - Math.abs(k); s += raw[(x + k + 64) % 64] * kw; w += kw; }
    return 0.88 + 0.24 * (s / w - 0.5);
  });
  // 何十人ぶんのエッジの跡（細い筋）を少しだけ濃く
  for (let i = 0; i < 16; i++) lane[4 + Math.floor(R() * 56)] += 0.06 + 0.06 * R();
  for (let y = 0; y < 256; y++) for (let x = 0; x < 64; x++) {
    const across = Math.abs(x / 63 - 0.5) * 2;           // 0：中央 … 1：縁
    const edge = 1 - THREE.MathUtils.smoothstep(across, 0.45, 1.0);
    const streak = lane[x] * (0.92 + 0.08 * Math.sin(y * 0.05 + x * 0.21));
    const o = (y * 64 + x) * 4;
    img.data[o] = 150; img.data[o + 1] = 172; img.data[o + 2] = 200;
    img.data[o + 3] = Math.round(edge * streak * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * 軌跡に沿った細長い帯（レースライン・溝）。
 * off(u) は軌跡からの横ずれ [m]（eLat 方向）。頂点の並びは u の順なので、
 * setDrawRange で「ここまで」を切れる。
 */
function ribbon(model, u0, u1, n, hw, lift, off = () => 0, vScale = 3) {
  const pos = new Float32Array((n + 1) * 6), uv = [], idx = [];
  const lat = new THREE.Vector3();
  for (let i = 0; i <= n; i++) {
    const u = u0 + (u1 - u0) * (i / n);
    lat.set(0, 0, 0).addScaledVector(model.D, -model.dw(u)).addScaledVector(model.C, 1).normalize();
    const c = model.trackPoint(u, lift).addScaledVector(lat, off(u));
    pos.set([c.x - lat.x * hw, c.y - lat.y * hw, c.z - lat.z * hw,
             c.x + lat.x * hw, c.y + lat.y * hw, c.z + lat.z * hw], i * 6);
    uv.push(0, u / vScale, 1, u / vScale);
    if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------
 * ポール 1 本 ＝ 1 メッシュ（以前は 3 節 × 1 メッシュで、1 本に描画コール 3 回＋影 3 回）。
 * 根元の黒いヒンジ（ゴム）と先端の黒いキャップは頂点色で塗る（色ごとのメッシュを足さない）。
 * ヒンジの高さ・キャップの長さは見た目の調整値（実物の寸法は確かめていない）。
 * --------------------------------------------------------------- */
const HINGE_H = 0.12;
const CAP_H = 0.025;
/* スマホでは円周の分割を 10 → 8 に（三角形の予算。2.8 cm の太さでは見た目はほぼ同じ） */
const poleRadial = () => ((window.innerWidth < 820
  || window.matchMedia?.('(pointer: coarse)').matches) ? 8 : 10);

/**
 * ポールのジオメトリ（根元が原点、+y が軸、高さ h、半径 r0 → r1 に細くなる）。
 * 色の境目には同じ高さの輪を 2 つ重ねて置き、色がにじまないようにする。
 * geometry.userData に輪の高さと頂点の位置（曲げる前）を残し、しなりで曲げ直す。
 */
function poleGeometry(h, r0, r1, radial = 10) {
  const dark = [0.05, 0.05, 0.06], body = [1, 1, 1];
  const rings = [[0, dark], [HINGE_H, dark], [HINGE_H, body]];
  const nMid = 8;
  for (let i = 1; i <= nMid; i++) rings.push([HINGE_H + (h - CAP_H - HINGE_H) * (i / (nMid + 1)), body]);
  rings.push([h - CAP_H, body], [h - CAP_H, dark], [h, dark]);
  const pos = [], nrm = [], col = [], idx = [], info = [];
  for (const [y, c] of rings) {
    const r = r0 + (r1 - r0) * (y / h);
    info.push({ y, start: pos.length / 3, n: radial + 1 });
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      pos.push(Math.cos(a) * r, y, Math.sin(a) * r);
      nrm.push(Math.cos(a), 0, Math.sin(a));
      col.push(...c);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    if (rings[k + 1][0] - rings[k][0] < 1e-6) continue;          // 色の境目はつながない
    const a = info[k].start, b = info[k + 1].start;
    for (let j = 0; j < radial; j++) idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
  }
  // 先端のふた
  const top = info[info.length - 1].start, cIdx = pos.length / 3;
  pos.push(0, h, 0); nrm.push(0, 1, 0); col.push(...dark);
  info.push({ y: h, start: cIdx, n: 1 });
  for (let j = 0; j < radial; j++) idx.push(cIdx, top + j + 1, top + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.userData = { h, rings: info, rest: Float32Array.from(pos), restN: Float32Array.from(nrm), bent: false };
  // しなっても先端は根元から h より遠くへ行かないので、根元を中心に半径 h の球で十分
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), h * 1.02);
  return g;
}

/** 何本かのポールを 1 つのジオメトリにまとめる（GS の旗門の片側：曲げないので行列ごと焼き込む） */
function mergePoles(list) {
  const pos = [], nrm = [], col = [], idx = [];
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  let off = 0;
  for (const [g, m] of list) {
    nm.getNormalMatrix(m);
    const P = g.attributes.position, Nn = g.attributes.normal, Cc = g.attributes.color;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(Nn, i).applyMatrix3(nm).normalize(); nrm.push(v.x, v.y, v.z);
      col.push(Cc.getX(i), Cc.getY(i), Cc.getZ(i));
    }
    for (const k of g.index.array) idx.push(k + off);
    off += P.count;
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * フレックスポールのしなり（頂点を CPU で曲げ直す）。
 * 曲がり角（軸がローカル +y から +z へ倒れる角）を高さ s の関数で
 *   θ(s) = b · (0.55 + 0.45 · (s/h)²)
 * とする。根元のヒンジで 55 %、残りは上ほど大きく曲がる弓なり（先端の角は b で、以前の 3 節と同じ）。
 * 軸の中心は θ を高さに沿って積分して求め、各輪をその点で θ だけ傾ける。
 * |b| が小さいときは曲げる前の形に戻すだけ（毎フレームの計算をしない）。
 * mesh.userData.axes[0] に軸の点（ローカル）を入れ直す：骨盤の手前判定で使う。
 */
function bendPole(mesh, b) {
  const g = mesh.geometry, ud = g.userData;
  const P = g.attributes.position, Nn = g.attributes.normal;
  const pa = P.array, na = Nn.array;
  const axis = mesh.userData.axes[0];
  if (Math.abs(b) < 1e-3) {
    if (!ud.bent) return;
    pa.set(ud.rest); na.set(ud.restN);
    ud.bent = false;
    axis.forEach((p, i) => p.set(0, (ud.h * i) / (axis.length - 1), 0));
    P.needsUpdate = Nn.needsUpdate = true;
    return;
  }
  const h = ud.h;
  const th = (s) => b * (0.55 + 0.45 * (s / h) * (s / h));
  let s = 0, cy = 0, cz = 0;
  const centers = [];
  for (const r of ud.rings) {
    // 前の輪から この輪の高さまで、4 分割の中点則で積分
    const ds = (r.y - s) / 4;
    for (let k = 0; k < 4; k++) { const t = th(s + ds * (k + 0.5)); cy += Math.cos(t) * ds; cz += Math.sin(t) * ds; }
    s = r.y;
    const t = th(s), c = Math.cos(t), sn = Math.sin(t);
    centers.push([cy, cz]);
    for (let j = r.start; j < r.start + r.n; j++) {
      const o = j * 3;
      const x = ud.rest[o], z = ud.rest[o + 2], nx = ud.restN[o], ny = ud.restN[o + 1], nz = ud.restN[o + 2];
      pa[o] = x; pa[o + 1] = cy - z * sn; pa[o + 2] = cz + z * c;
      na[o] = nx; na[o + 1] = ny * c - nz * sn; na[o + 2] = ny * sn + nz * c;
    }
  }
  ud.bent = true;
  P.needsUpdate = Nn.needsUpdate = true;
  // 軸の点：根元・各段・先端（輪の中心から等間隔に拾う）
  for (let i = 0; i < axis.length; i++) {
    const k = Math.round((i / (axis.length - 1)) * (centers.length - 1));
    axis[i].set(0, centers[k][0], centers[k][1]);
  }
}

export class Course {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'course';
    scene.add(this.group);

    /* 雪面：粒感のテクスチャ ＋ シェーダーで「整備跡」と「大きなむら」を足す。
     * 整備跡はレースラインの左右 5 m では消す（滑走で削られ、横滑りでならされるため）。 */
    this.snowTex = snowTexture();
    this._snowU = {
      cordMap: { value: corduroyTexture() },
      macroMap: { value: macroTexture() },
      line: { value: new THREE.Vector4(0, 1, 0, 0) },      // A, k, skew, —
      frame: { value: new THREE.Vector4(0, 20, 0, 1e6) },   // u の始まり, 半幅, 区間の始まり, 終わり
    };
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.snowTex, roughness: 0.92,
      side: THREE.DoubleSide });
    snowMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this._snowU);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D cordMap; uniform sampler2D macroMap;
          uniform vec4 line; uniform vec4 frame;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
          {
            // vMapUv は 1 = 3 m。斜面座標（u：下へ、w：横）へ戻す
            float su = frame.x + vMapUv.y * 3.0;
            float sw = vMapUv.x * 3.0 - frame.y;
            float th = line.y * su + line.z * sin(2.0 * line.y * su);
            float dLine = abs(sw - line.x * sin(th));
            float inCourse = smoothstep(frame.z - 6.0, frame.z, su) * (1.0 - smoothstep(frame.w, frame.w + 6.0, su));
            float keep = 1.0 - inCourse * (1.0 - smoothstep(2.0, 5.0, dLine));
            float cord = texture2D(cordMap, vMapUv).r;
            diffuseColor.rgb *= 1.0 - 0.055 * cord * keep;
            float mac = texture2D(macroMap, vMapUv * 0.03).r;
            diffuseColor.rgb *= 0.96 + 0.08 * mac;
          }`);
    };
    this.snow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), snowMat);
    this.snow.receiveShadow = true;
    this.group.add(this.snow);

    this.gatesG = new THREE.Group(); this.group.add(this.gatesG);
    this.tracksG = new THREE.Group(); this.group.add(this.tracksG);
    // 自然な手がかり（削れたライン・溝）。「3D の線」の表示とは別で、いつも出す
    this.cuesG = new THREE.Group(); this.group.add(this.cuesG);

    this.lineTex = raceLineTexture();
    this.lineMat = new THREE.MeshStandardMaterial({ map: this.lineTex, transparent: true, opacity: 0.42,
      roughness: 0.35, metalness: 0, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.rutMat = new THREE.MeshBasicMaterial({ color: 0x7f97b3, transparent: true, opacity: 0.45,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this._fadeT = 0;
  }

  /** モデルに合わせてコースを作り直す */
  build(model, { gateCount = 9, discipline }) {
    const { D, C, N } = model;
    this._fall = D.clone();
    this._across = C.clone();
    const len = model.halfCycle * (gateCount + 4);
    const ext = courseExtent(model, gateCount);
    this.extent = ext;
    /* ピステの幅：振り幅＋旗門幅の外に 12 m の余裕（SL で片側 20 m、両側で 40 m）。
     * 外側はまわりの地形（environment.js）が土手になって続く。 */
    const pisteHalf = pisteHalfWidth(model, discipline);
    this.pisteHalf = pisteHalf;
    const width = pisteHalf * 2;

    /* --- 雪面（ピステ） ---
     * 霧の外まで続けて、板の端が地平線に見えないようにする。上の端（uTop）から先は地形の尾根が覆う。 */
    const sLen = ext.uEnd - ext.uTop;
    this.snow.geometry.dispose();
    this.snow.geometry = new THREE.PlaneGeometry(width, sLen, 1, 1);
    // 平面を斜面に合わせる：+X→C, +Y→D, +Z→N（右手系になる組み合わせ）
    const m = new THREE.Matrix4().makeBasis(C, D.clone(), N);
    this.snow.quaternion.setFromRotationMatrix(m);
    this.snow.position.copy(model.onSlope((ext.uTop + ext.uEnd) / 2, 0, SNOW_N));
    this.snowTex.repeat.set(width / 3, sLen / 3);
    this._snowU.line.value.set(model.A, model.k, model.p.skew ?? 0, 0);
    this._snowU.frame.value.set(ext.uTop, pisteHalf, ext.u0, ext.u1);

    /* --- 旗門 --- */
    // 作り直すたびに前のポールのジオメトリとマテリアルを捨てる（スライダーで何度も作り直すため）
    this.gatesG.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.gatesG.clear();
    const gates = model.gates(gateCount, 0);
    const turning = [];                 // SL：たたかれてしなるポール
    this.fadeUnits = [];                // 骨盤の手前に来たら薄くする単位（旗門の片側ずつ）
    for (const g of gates) {
      const color = g.color === 'red' ? 0xe03131 : 0x1c6fd6;
      if (discipline.hasPanel) {
        // GS：旗門は 4 本のポールと 2 枚のパネルで構成される [ICR 901.2.1]
        const across = g.outer.clone().sub(g.turning).normalize();
        const pw = discipline.panelW ?? 0.75;
        for (const base of [g.turning, g.outer]) {
          const a = base.clone().addScaledVector(across, -pw / 2);
          const b = base.clone().addScaledVector(across, pw / 2);
          // 2 本のポールは曲げないので 1 つのメッシュにまとめる（片側 7 メッシュ → 2）
          const parts = [this._polePair(a, b, N, color), this._panel(a, b, N, color, discipline)];
          if (base === g.turning) {
            // ターニング側は選手が肩で押していくので、旗門ごと傾く
            const unit = this._pivot(base, N, Math.sign(g.wTurn) || 1, parts);
            unit.userData.turning = g;
            unit.userData.bend = (v) => { unit.userData.tilt.rotation.x = v * 0.20; };
            turning.push(unit);
            this.gatesG.add(unit);
            this._addFade(unit, parts, base);
          } else {
            for (const p of parts) this.gatesG.add(p);
            this._addFade(null, parts, base);
          }
        }
      } else {
        const t = this._pole(g.turning, N, color, 1, Math.sign(g.wTurn) || 1);
        t.userData.turning = g;
        t.userData.bend = (v) => { t.userData.bendValue = v; bendPole(t, v); };
        turning.push(t);
        this.gatesG.add(t);
        this._addFade(t, [t], g.turning);
        const o = this._pole(g.outer, N, color, 0.85, Math.sign(g.wTurn) || 1);
        this.gatesG.add(o);
        this._addFade(o, [o], g.outer);
      }
    }
    this.gates = gates;
    this.turningPoles = turning;
    this.hasPanel = !!discipline.hasPanel;

    /* --- 削れたレースラインとカービングの溝（いつも出す自然な手がかり） --- */
    for (const c of [...this.cuesG.children]) { this.cuesG.remove(c); c.geometry.dispose(); }
    const lift = SNOW_N + 0.002;
    const line = new THREE.Mesh(ribbon(model, ext.u0, ext.u1, 500, 1.6, lift), this.lineMat);
    line.receiveShadow = true;
    line.renderOrder = 1;
    this.cuesG.add(line);
    /* 溝：両スキーのエッジの通り道。skier.js は板を「下がっているほうのエッジが
     * モデルの足の位置（軌跡 ± スタンス幅の半分）に来る」ように置くので、溝もそこに引く。 */
    const rutN = Math.round((ext.u1 - ext.u0) / 0.25);
    this.ruts = [];
    for (const sgn of [1, -1]) {
      const off = (u) => sgn * model.sample(Math.max(0, u)).stance / 2;
      const g = ribbon(model, ext.u0, ext.u1, rutN, 0.0135, SNOW_N + 0.003, off);
      const r = new THREE.Mesh(g, this.rutMat);
      r.renderOrder = 2;
      r.userData.rest = g.attributes.position.array.slice();
      r.userData.tip = -1;
      this.ruts.push(r);
      this.cuesG.add(r);
    }
    this._rut = { u0: ext.u0, u1: ext.u1, n: rutN };
    this.updateRuts(-Infinity);

    /* --- シュプール（両スキーの通り道）。「3D の線」の表示のときだけ --- */
    this.tracksG.traverse((o) => { if (o.isLine) { o.geometry.dispose(); o.material.dispose(); } });
    this.tracksG.clear();
    for (const sgn of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 400; i++) {
        const u = -model.halfCycle + (len + model.halfCycle) * (i / 400);
        const w1 = model.dw(u);
        const eLat = new THREE.Vector3().addScaledVector(D, -w1).addScaledVector(C, 1).normalize();
        // スタンス幅はエッジ角とともに変わるので、シュプールの間隔も一定ではない
        const half = model.sample(Math.max(0, u)).stance / 2;
        pts.push(model.trackPoint(u, 0.012).addScaledVector(eLat, sgn * half));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.tracksG.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0x8fb0d0, transparent: true, opacity: 0.6,
      })));
    }
    // 重心の軌跡（黄色は「いまやる動作」専用にしたので白に近い灰）
    const comPts = [];
    for (let i = 0; i <= 400; i++) {
      const u = (len + model.halfCycle) * (i / 400) - model.halfCycle * 0.5;
      comPts.push(model.sample(Math.max(0, u)).com);
    }
    this.comLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(comPts),
      new THREE.LineBasicMaterial({ color: 0xe6e9ef, transparent: true, opacity: 0.6 }));
    this.tracksG.add(this.comLine);

    return this;
  }

  /** 骨盤の手前で薄くする単位を登録する（root は毎フレーム行列を更新するノード） */
  _addFade(root, parts, base) {
    const mats = [], poles = [], panels = [];
    for (const p of parts) {
      p.traverse((o) => {
        if (!o.isMesh) return;
        if (!mats.includes(o.material)) mats.push(o.material);
        if (o.userData.axes) poles.push(o);
        if (o.userData.panel) panels.push(o);
      });
    }
    this.fadeUnits.push({ root: root ?? parts, poles, panels, mats, base: base.clone(), op: 1 });
  }

  /**
   * ポール 1 本（1 メッシュ）。根元を原点にして、ローカル +y を雪面法線に合わせる。
   * ローカル +z は「たたかれたときに倒れる向き」＝斜面下方向に、
   * コースの外側へ少し振ったもの。こうしておくと、しなりは
   * ローカル +x まわりに軸を曲げるだけで出せる（bendPole）。
   *
   * 1 本の棒を根元で倒すと「折れた」ように見えるが、実物のフレックスポールは
   * 根元のヒンジで倒れつつ弓なりにしなるため、頂点を高さに沿って曲げる。
   */
  _pole(base, N, color, scale = 1, away = 0) {
    const h = POLE_H * scale;
    /* 1 本ずつ自分のマテリアルを持つ（骨盤の手前に来たものだけ薄くするため）。
     * transparent は最初から立てておく：あとで切り替えるとシェーダーを作り直すことになる */
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, vertexColors: true, transparent: true });
    const mesh = new THREE.Mesh(poleGeometry(h, POLE_R * 1.15, POLE_R * 0.85, poleRadial()), mat);
    mesh.castShadow = true;
    // 軸の点（ローカル）。しなると bendPole が入れ直す
    mesh.userData.axes = [Array.from({ length: 5 }, (_, i) => new THREE.Vector3(0, (h * i) / 4, 0))];
    mesh.position.copy(base);
    // 倒れる向き：フォールライン ＋ コースの外側へ少し
    const D = this._fall ?? new THREE.Vector3(0, 0, 1);
    const C = this._across ?? new THREE.Vector3(1, 0, 0);
    const dir = D.clone().addScaledVector(C, away * 0.55);
    const Z = dir.addScaledVector(N, -dir.dot(N)).normalize();
    const X = new THREE.Vector3().crossVectors(N, Z).normalize();
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, N, Z));
    return mesh;
  }

  /** GS の旗門の片側の 2 本（パネルの両端）。曲げないので 1 つのメッシュに焼き込む（ワールド座標） */
  _polePair(a, b, N, color) {
    const h = POLE_H;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), N);
    const one = new THREE.Vector3(1, 1, 1);
    const geo = mergePoles([a, b].map((p) => [poleGeometry(h, POLE_R * 1.15, POLE_R * 0.85, poleRadial()),
      new THREE.Matrix4().compose(p, q, one)]));
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, vertexColors: true, transparent: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.userData.axes = [a, b].map((p) => [p.clone(), p.clone().addScaledVector(N, h / 2), p.clone().addScaledVector(N, h)]);
    return mesh;
  }

  /**
   * すでにワールド座標で作った部品を、ポールの根元を中心にした
   * ヒンジの下へ付け替える。GS は旗門ごと傾くのでこれが要る。
   */
  _pivot(base, N, away, parts) {
    const pivot = new THREE.Group();
    // 基準姿勢（quaternion）を持つノードに rotation.x を書くと、
    // Euler ↔ quaternion が連動しているせいで基準姿勢そのものが壊れる。
    // 傾ける用のノードを内側にもう 1 つ作って、そちらだけ回す。
    const tilt = new THREE.Group();
    pivot.add(tilt);
    pivot.userData.tilt = tilt;
    pivot.position.copy(base);
    const D = this._fall ?? new THREE.Vector3(0, 0, 1);
    const C = this._across ?? new THREE.Vector3(1, 0, 0);
    const dir = D.clone().addScaledVector(C, away * 0.55);
    const Z = dir.addScaledVector(N, -dir.dot(N)).normalize();
    const X = new THREE.Vector3().crossVectors(N, Z).normalize();
    pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, N, Z));
    pivot.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(pivot.matrixWorld).invert();
    for (const p of parts) {
      p.updateMatrix();            // position/quaternion を matrix に反映してから変換する
      p.applyMatrix4(inv);
      tilt.add(p);
    }
    return pivot;
  }

  /** パネル：約 75 × 50 cm、下端は雪面から約 1 m [ICR 901.2.2] */
  _panel(a, b, N, color, disc) {
    const g = new THREE.Group();
    const mid = a.clone().lerp(b, 0.5);
    const dir = b.clone().sub(a).normalize();
    const w = a.distanceTo(b) * 0.98;
    /* 布のパネルは日が透けるので、日陰の裏側でも赤／青のまま見える。
     * 自発光を色の 25 % 入れてそれをまねる（入れないと影の側がえんじ色に沈む） */
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, disc.panelH ?? 0.5),
      new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: THREE.DoubleSide, transparent: true,
        emissive: new THREE.Color(color).multiplyScalar(0.25) }));
    panel.userData.panel = true;
    panel.userData.size = [w, disc.panelH ?? 0.5];
    const up = N.clone();
    const fwd = new THREE.Vector3().crossVectors(dir, up).normalize();
    panel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, up, fwd));
    panel.position.copy(mid).addScaledVector(up, (disc.panelBottom ?? 1.0) + (disc.panelH ?? 0.5) / 2);
    g.add(panel);
    return g;
  }

  /**
   * ポールのしなり。SL のターニングポールは根元がヒンジになっていて、
   * たたかれると倒れ、通り過ぎたあと減衰しながら揺れて戻る。
   *
   * 時刻の状態を持たず、<b>滑走距離 u だけの関数</b>にしてある。
   * こうするとタイムラインを手でドラッグしても矛盾なく再現される。
   *
   *   x = u − ポールの u
   *   x < 0            : 近づくぶんだけ倒れていく
   *   x ≥ 0            : maxBend · exp(−x/L) · cos(2πx/P)   （減衰振動）
   *
   * @param {number} u いまの滑走距離
   */
  updateGates(u) {
    if (!this.turningPoles) return;
    const maxBend = 1.45;                // rad（先端まで合計でおよそ 83°）
    const hitAt = -0.12;                 // 手が当たるのは身体が並ぶ少し手前
    const rise = 0.85;                   // 当たるまでに倒れていく距離 [m]
    const L = 2.4, P = 2.0;              // 戻りの減衰距離と揺れの周期 [m]
    for (const g of this.turningPoles) {
      const x = u - g.userData.turning.u;
      let bend;
      if (x < hitAt - rise) bend = 0;
      else if (x < hitAt) bend = maxBend * ((x - hitAt + rise) / rise) ** 3;
      else {
        const t = x - hitAt;
        bend = maxBend * Math.exp(-t / L) * Math.cos((Math.PI * 2 * t) / P);
      }
      g.userData.bend(bend);
    }
    this.updateRuts(u);
  }

  /**
   * カービングの溝は、滑ったところ（いまの足もとより後ろ）にだけある。
   * 頂点は u の順に並んでいるので、描く範囲を足もとで切り、
   * いちばん先の 1 組の頂点だけを足もとの位置へ寄せる（0.25 m ごとの段にならない）。
   * u だけで決まるので、タイムラインを戻せば溝も戻る（ループで先頭に戻ると消える）。
   */
  updateRuts(u) {
    if (!this.ruts || !this._rut) return;
    const { u0, u1, n } = this._rut;
    const f = THREE.MathUtils.clamp((u - u0) / (u1 - u0), 0, 1) * n;
    const i = Math.min(n - 1, Math.floor(f));
    const t = f - i;
    for (const r of this.ruts) {
      const pos = r.geometry.attributes.position;
      const a = pos.array, rest = r.userData.rest;
      const prev = r.userData.tip;
      if (prev >= 0 && prev !== i + 1) a.set(rest.subarray(prev * 6, prev * 6 + 6), prev * 6);
      if (f <= 0) { r.geometry.setDrawRange(0, 0); r.userData.tip = -1; pos.needsUpdate = true; continue; }
      const j = i + 1;
      for (let k = 0; k < 6; k++) a[j * 6 + k] = rest[i * 6 + k] + (rest[j * 6 + k] - rest[i * 6 + k]) * t;
      r.userData.tip = j;
      r.geometry.setDrawRange(0, 6 * (i + 1));
      pos.needsUpdate = true;
    }
  }

  /**
   * カメラと骨盤の間に入ったポール・パネルを薄くする（骨盤＝教える主役を隠さない）。
   * 見え方で判定する：カメラから骨盤へ向かう視線のまわりに、骨盤の位置で半径 0.32 m の円錐を考え、
   * ポールのどこかがその中にあって骨盤より手前なら、不透明度を 0.25 へ（時定数 0.15 s）。
   * 外れたら 1 へ戻す。一人称（enabled = false）では自分の前の旗なので薄くしない。
   * main.js が camRig.update のあとに呼ぶ。
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} focusW 守りたい点（骨盤）
   * @param {boolean} enabled
   */
  updateOcclusion(camera, focusW, enabled = true) {
    if (!this.fadeUnits || !camera) return;
    const now = performance.now();
    const dt = this._fadeT ? Math.min(0.1, (now - this._fadeT) / 1000) : 0.016;
    this._fadeT = now;
    const k = 1 - Math.exp(-dt / 0.15);
    const C = camera.position;
    const dir = this._v1 ??= new THREE.Vector3();
    const p = this._v2 ??= new THREE.Vector3();
    const q = this._v3 ??= new THREE.Vector3();
    let L = 0;
    if (focusW) { dir.copy(focusW).sub(C); L = dir.length(); dir.divideScalar(L || 1); }
    const tanR = L > 0 ? 0.32 / L : 0;
    const hit = (pt) => {
      p.copy(pt).sub(C);
      const t = p.dot(dir);
      if (t < 0.05 || t > L - 0.12) return false;          // カメラの後ろ／骨盤より奥
      return p.addScaledVector(dir, -t).length() < tanR * t + 0.02;
    };
    const seg = (a, b) => {
      for (let s = 0; s <= 8; s++) if (hit(q.copy(a).lerp(b, s / 8))) return true;
      return false;
    };
    for (const f of this.fadeUnits) {
      let want = 1;
      if (enabled && L > 0.3 && f.base.distanceToSquared(focusW) < 144 && this.gatesG.visible) {
        const roots = Array.isArray(f.root) ? f.root : [f.root];
        for (const r of roots) r.updateMatrixWorld(true);
        let occ = false;
        for (const pole of f.poles) {
          for (const ax of pole.userData.axes) {
            let prev = null;
            for (const pt of ax) {
              const w = (this._v4 ??= new THREE.Vector3()).copy(pt).applyMatrix4(pole.matrixWorld);
              if (prev && seg(prev, w)) { occ = true; break; }
              prev = (this._v5 ??= new THREE.Vector3()).copy(w);
            }
            if (occ) break;
          }
          if (occ) break;
        }
        for (const pn of f.panels) {
          if (occ) break;
          const [w, h] = pn.userData.size;
          for (let y = -1; y <= 1 && !occ; y++) {
            const a = pn.localToWorld(new THREE.Vector3(-w / 2, y * h / 2, 0));
            const b = pn.localToWorld(new THREE.Vector3(w / 2, y * h / 2, 0));
            occ = seg(a, b);
          }
        }
        if (occ) want = 0.25;
      }
      if (Math.abs(f.op - want) < 1e-3 && f.op === want) continue;
      f.op += (want - f.op) * (enabled ? k : 1);
      if (Math.abs(f.op - want) < 0.005) f.op = want;
      for (const m of f.mats) { m.opacity = f.op; m.depthWrite = f.op > 0.995; }
    }
  }

  setVisible({ tracks, gates }) {
    if (tracks !== undefined) this.tracksG.visible = tracks;
    if (gates !== undefined) this.gatesG.visible = gates;
  }
}
