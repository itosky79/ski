/**
 * environment.js — まわりの世界（空・山並み・光・地形・森・ネット・雪煙）
 *
 * 以前は「空に浮いた白い板」の上を滑っていた。板の端が地平線に見え、
 * 木も山もないので斜度もスピードも伝わらなかった。ここではコースのまわりに
 *   霧の向こうまで続く地形（コースの両側は土手）・針葉樹の森・B ネット・
 *   山並みのパノラマ・太陽のある空・横からの日差しと青い影
 * を置く。素材はすべてコードで作り、実行中にネットワークから何も取らない。
 *
 * 描画コールは 地形 1・木 1・ネット 2・空とパノラマ 2・雪煙 1（影のパスでは木も地形も描かない）。
 * 狭い画面（スマホ）では木と雪煙を半分、影の解像度を 1024 にする。
 *
 * main.js からの使い方（スキーヤーを作る前に new する。envMap を金属に渡すため）
 *   const world = new World(renderer, scene, camera);   // envMap ができる
 *   world.build(model, { discipline, gateCount });       // コースを作り直すたび
 *   world.update(s, camera, { u, dt, model });            // 毎フレーム（カメラを動かしたあと）
 *   world.setPelvisMode(on);                              // 骨盤アップでは背景を無地の霞にする
 */
import * as THREE from 'three';
import { pisteHalfWidth, courseExtent } from './course.js';

/* 霞（地平線より下の空・霧）の色。空の下半分・霧・パノラマの裾を同じ色にすると、
 * 地形の端も山並みの裾も境目が見えなくなる */
const HAZE = 0xdfe9f3;
/* 太陽の向き（重心からのずれ）。横から、少し谷側から当てる（仰角 約 37°）。
 * 後ろから当てると影がスキーヤーの真下に隠れ、雪面の凹凸も見えない */
const SUN_OFFSET = new THREE.Vector3(9, 7.5, -4);
/* 霧の距離 [m]。GS は旗門の間が長いので遠くまで見せる（調整値） */
const FOG = { SL: [80, 420], GS: [120, 520] };
/* 骨盤アップの霧：骨盤の色分けだけが鮮やかな色になるよう、背景を霞に沈める */
const FOG_PELVIS = [3, 25];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const isNarrow = () => window.innerWidth < 820
  || !!window.matchMedia?.('(pointer: coarse)').matches;

/* ---------------------------------------------------------------
 * 空：地平線の白っぽい青 → 天頂の青。地平線より下は霞の色（＝霧の色）。
 * 太陽の円盤とまわりのにじみも 1 回の描画で出す。
 * ShaderMaterial はトーンマッピングと sRGB 変換を自分で入れないと
 * 色が暗く沈む（以前の空の上が紺色に見えていたのはこのため）。
 * --------------------------------------------------------------- */
function skyMaterial(sunDir) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x3d7cc9) },
      horizon: { value: new THREE.Color(0xd9e8f6) },
      haze: { value: new THREE.Color(HAZE) },
      sunDir: { value: sunDir.clone().normalize() },
      neutral: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 top, horizon, haze, sunDir;
      uniform float neutral;
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        // 天頂へ向かって青くなる。仰角 30° でまだ中間の青（以前は 0.55 で飽和して紺が強すぎた）
        vec3 col = mix(horizon, top, pow(smoothstep(0.0, 0.95, h), 0.8));
        // 地平線のすぐ下から霞に変わる（地形の遠い端・パノラマの裾と同じ色）
        col = mix(haze, col, smoothstep(-0.03, 0.05, h));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.95, 0.86) * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.18) * (1.0 - neutral);
        // 骨盤アップ：空も霞に寄せて、色を骨盤だけにする
        col = mix(col, haze, neutral * 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/* ---------------------------------------------------------------
 * 山並みのパノラマ（2048×256、狭い画面は 1024×256）
 * 遠い山（雪をかぶった淡い青灰）・中くらいの尾根（灰）・近い尾根（暗い森）の 3 層を
 * 奥から順に描き、どれも裾ほど霞の色へ溶かす（空気遠近）。
 * 稜線は中点変位法で、0° と 360° で必ずつながるよう周期的に作る（継ぎ目なし）。
 * 以前の試作は空のシェーダーの中でノイズから岩肌を作っていたが、
 * 縦の筋（ストリーク）になって見えた。ここでは面の陰影を稜線の傾きから付け、
 * 稜線から下へ向かって薄くすることで筋を出さない。
 * --------------------------------------------------------------- */
function ridgeLine(n, seed, amp, rough, start = 8) {
  const R = rng(seed);
  const y = new Float32Array(n + 1);
  let step = n / start;
  for (let i = 0; i < n; i += step) y[i] = (R() - 0.5) * amp;
  y[n] = y[0];
  let a = amp * rough;
  while (step > 1) {
    const half = step / 2;
    for (let i = half; i < n; i += step) y[i] = (y[i - half] + y[i + half]) / 2 + (R() - 0.5) * a;
    a *= rough;
    step = half;
  }
  return y;
}

function panoramaTexture(W) {
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const d = img.data;
  const haze = [223, 233, 243];
  const R = rng(11);
  /* 行 → 仰角：円筒は半径 450 m、高さはカメラの 60 m 下〜100 m 上（仰角 −7.6°〜+12.5°） */
  /* 何 km も先の山なので、森も岩も空気で青白くかすむ（近い層ほど濃いが、それでも灰青）。
   * 稜線の高さを 0〜1 にならしてから 1.5 乗すると、谷は広く峰は尖る（アルプスらしい形）。
   * 色は「稜線からの深さ」で雪の帽子（上ほど白）→ 山肌、さらに下は霞。
   * 列ごとの陰影は入れない（隣の列と傾きが違うと縦の筋になるため）。 */
  const layers = [
    // 基準行（いちばん低い稜線）・高さ（行）・粗さ・初めの点数・雪・山肌・霞の基本量
    { base: 150, amp: 96, rough: 0.58, start: 6, snow: [248, 250, 254], rock: [172, 188, 210], cap: 20, haze0: 0.40, seed: 3 },
    { base: 184, amp: 62, rough: 0.55, start: 10, snow: [222, 230, 240], rock: [140, 157, 176], cap: 16, haze0: 0.28, seed: 5 },
    { base: 214, amp: 36, rough: 0.52, start: 16, snow: [132, 150, 158], rock: [104, 122, 130], cap: 6, haze0: 0.22, forest: true, seed: 9 },
  ];
  for (const L of layers) {
    const ry = ridgeLine(W, L.seed, 1, L.rough, L.start);
    let lo = Infinity, hi = -Infinity;
    for (let x = 0; x < W; x++) { lo = Math.min(lo, ry[x]); hi = Math.max(hi, ry[x]); }
    for (let x = 0; x < W; x++) {
      const hh = Math.pow((ry[x] - lo) / (hi - lo || 1), 1.5);
      const ridgeY = L.base - hh * L.amp;               // 稜線の行（小数）
      for (let y = Math.max(0, Math.floor(ridgeY)); y < H; y++) {
        const depth = y - ridgeY;                       // 稜線からの深さ [px]
        const sn = Math.exp(-Math.max(0, depth) / L.cap);
        let r = L.rock[0] + (L.snow[0] - L.rock[0]) * sn;
        let gg = L.rock[1] + (L.snow[1] - L.rock[1]) * sn;
        let b = L.rock[2] + (L.snow[2] - L.rock[2]) * sn;
        if (L.forest && R() < 0.03 * Math.exp(-depth / 18)) { r += 34; gg += 34; b += 34; }
        // 裾ほど霞へ（下端で完全に霞の色）
        const hz = Math.min(1, L.haze0 + (1 - L.haze0) * smooth(L.base - 12, H - 6, y));
        // 稜線の 1 画素だけアンチエイリアス
        const a = THREE.MathUtils.clamp(y + 1 - ridgeY, 0, 1);
        const o = (y * W + x) * 4;
        const pa = d[o + 3] / 255;
        const nr = r + (haze[0] - r) * hz, ng = gg + (haze[1] - gg) * hz, nb = b + (haze[2] - b) * hz;
        d[o] = d[o] * (1 - a) + nr * a; d[o + 1] = d[o + 1] * (1 - a) + ng * a; d[o + 2] = d[o + 2] * (1 - a) + nb * a;
        d[o + 3] = Math.round(255 * (pa * (1 - a) + a));
      }
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/* ---------------------------------------------------------------
 * 針葉樹（トウヒ・モミ）1 本ぶんのジオメトリ（高さ 1、インスタンスで 9〜20 m に伸ばす）
 * 以前の試作は太い円錐を 4 段重ねて面ごとの法線にしたので、
 * 明るい緑の「積み木のクリスマスツリー」に見えた。実物の森は遠目にはほぼ黒に近い緑で、
 * 幅は高さの 1/3 ほどの細い尖塔形、枝先は垂れて輪郭がぎざぎざになる。そこで
 *   ・5 段の「枝の段」。各段の下の縁は 6 本の枝先（外へ出て少し垂れる）と
 *     その間のくぼみ（内へ入って少し上がる）を交互に並べて輪郭をぎざぎざにする
 *   ・段ごとに頂点を共有して法線をなめらかに（面の角が見えない）
 *   ・色は暗い緑。段の上側ほど雪が乗り、枝先はところどころだけ白い
 * 三角形は 1 本 68 枚。
 * --------------------------------------------------------------- */
function coniferGeometry() {
  const pos = [], col = [], idx = [];
  const R = rng(21);
  const needle = [0.008, 0.026, 0.014];      // 線形の値（sRGB で約 #102c1f）
  const snow = [0.80, 0.85, 0.92];
  const mixc = (k) => needle.map((v, i) => v + (snow[i] - v) * k);
  const push = (x, y, z, c) => { pos.push(x, y, z); col.push(...c); return pos.length / 3 - 1; };

  // 幹（4 面・ふたなし）：下の段のすき間から少しだけ見える
  const t0 = pos.length / 3;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    push(Math.cos(a) * 0.016, 0, Math.sin(a) * 0.016, [0.05, 0.035, 0.025]);
    push(Math.cos(a) * 0.010, 0.30, Math.sin(a) * 0.010, [0.04, 0.03, 0.022]);
  }
  for (let i = 0; i < 4; i++) {
    const a = t0 + i * 2, b = t0 + ((i + 1) % 4) * 2;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }

  const tiers = [
    // 下端・上端・枝先の半径
    [0.05, 0.40, 0.165],
    [0.24, 0.56, 0.136],
    [0.41, 0.71, 0.106],
    [0.57, 0.85, 0.076],
    [0.72, 1.00, 0.046],
  ];
  const TIPS = 6;
  tiers.forEach(([y0, y1, r], ti) => {
    const h = y1 - y0;
    const apex = push(0, y1, 0, mixc(ti === tiers.length - 1 ? 0.12 : 0.04));
    const ring = [];
    const twist = ti * 0.55 + R() * 0.3;
    for (let k = 0; k < TIPS * 2; k++) {
      const a = (k / (TIPS * 2)) * Math.PI * 2 + twist;
      const tip = k % 2 === 0;
      const rr = tip ? r * (0.86 + R() * 0.26) : r * (0.50 + R() * 0.08);
      // 枝先は垂れ、くぼみは上がる → 段の下の縁がぎざぎざの輪郭になる
      const yy = tip ? y0 - h * (0.04 + R() * 0.05) : y0 + h * (0.10 + R() * 0.06);
      // 雪は枝の段の上（くぼみ側）に乗り、枝先はところどころだけ白い
      const sn = tip ? (R() < 0.18 ? 0.12 + R() * 0.18 : 0.0) : 0.02 + R() * 0.12;
      const c = mixc(sn).map((v) => v * (0.85 + R() * 0.3));
      ring.push(push(Math.cos(a) * rr, yy, Math.sin(a) * rr, c));
    }
    for (let k = 0; k < ring.length; k++) idx.push(apex, ring[(k + 1) % ring.length], ring[k]);
  });

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------------------------------------------------------------
 * B ネット（オレンジの網）。セル 6 cm 相当（実物は 5 cm 角）。
 * 遠くではミップマップで半透明のオレンジの帯になる。
 * 旗門の赤と張り合わないよう、少し黄みに寄せて彩度を落とし、不透明度 0.6。
 * --------------------------------------------------------------- */
function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(236,98,38,1)';
  for (let i = 0; i < 64; i += 4) { g.fillRect(i, 0, 1, 64); g.fillRect(0, i, 64, 1); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------------------------------------------------------
 * 雪煙：外スキーのテールから外へ飛ぶ粒（THREE.Points 1 回の描画）
 * 時刻の状態を持たず、<b>滑走距離 u だけの関数</b>にしてある。
 * 粒の番号 i は「u をきざんだ番号」で、生まれた位置と速度は番号ごとに 1 回だけ計算して
 * 覚えておく。だからタイムラインを前後にドラッグしても、同じ位相では同じ雪煙になる。
 * 強さは荷重とエッジ角から（切り替えではどちらも小さいので出ない）。
 * --------------------------------------------------------------- */
class Spray {
  constructor(n) {
    this.n = n;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 800 }, maxPx: { value: 96 } },
      vertexShader: /* glsl */`
        attribute float aAlpha; attribute float aSize;
        uniform float scale, maxPx;
        varying float vA;
        void main() {
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = min(aSize * scale / max(-mv.z, 0.05), maxPx);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          if (d > 1.0 || vA < 0.003) discard;
          gl_FragColor = vec4(0.96, 0.975, 1.0, vA * (1.0 - d) * (1.0 - d));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;          // スキーヤーのあと
    this.cache = new Map();
    this._p = new THREE.Vector3();
  }

  reset(model, disc) {
    this.cache.clear();
    this.life = disc?.key === 'GS' ? 0.28 : 0.27;      // [s]（調整値）
    // 寿命のあいだに粒が足りなくならない刻み
    this.step = Math.max(0.025, (model.v * this.life) / (this.n * 0.92));
    this.skiLen = disc?.skiLength ?? 1.65;
    this.out = disc?.key === 'GS' ? [3.2, 5.0] : [2.5, 4.5];   // 外への速さ [m/s]（調整値）
  }

  _emit(model, idx) {
    const ue = idx * this.step;
    const s = model.sample(Math.max(0, ue));
    // 番号から決まる乱数（同じ番号なら毎回同じ）
    const h1 = Math.abs(Math.sin(idx * 12.9898) * 43758.5453) % 1;
    const h2 = Math.abs(Math.sin(idx * 78.233) * 12345.678) % 1;
    const h3 = Math.abs(Math.sin(idx * 39.425) * 24634.633) % 1;
    /* 強さ：荷重が大きく、エッジが立っているときだけ（どちらも調整値）。
     * 位相 0.33 ごろから出始め、0.82 ごろで止まる。寿命 0.3 s ぶん尾を引くので、
     * 切り替え（位相 0〜0.1）には残らない */
    const strength = smooth(0.5, 0.8, s.loadNorm) * smooth(0.70, 0.86, s.edgeAngle);
    const p0 = s.outerFoot.clone()
      .addScaledVector(s.tangent, -this.skiLen * (0.18 + 0.30 * h1))
      .addScaledVector(s.outward, 0.04);
    const vel = s.outward.clone().multiplyScalar(this.out[0] + (this.out[1] - this.out[0]) * h2)
      .addScaledVector(model.N, 0.9 + 1.2 * h1)
      // 板に押し出されて少しだけ前へも進む（地面に置き去りの線にならないように）
      .addScaledVector(s.tangent, model.v * 0.22 + (h3 - 0.5) * 1.6);
    return { ue, p0, vel, strength, size: 0.035 + 0.05 * h3 };
  }

  update(model, u, viewH) {
    if (!this.step) return;
    this.mat.uniforms.scale.value = viewH;
    this.mat.uniforms.maxPx.value = Math.max(48, viewH * 0.09);
    const geo = this.points.geometry;
    const pos = geo.attributes.position, al = geo.attributes.aAlpha, sz = geo.attributes.aSize;
    const i0 = Math.floor(u / this.step);
    const g = 9.80665;
    for (let i = 0; i < this.n; i++) {
      const idx = i0 - i;
      let e = this.cache.get(idx);
      if (!e) {
        e = this._emit(model, idx);
        this.cache.set(idx, e);
        if (this.cache.size > this.n * 3) this.cache.delete(this.cache.keys().next().value);
      }
      const age = (u - e.ue) / model.v;
      const k = age / this.life;
      if (k < 0 || k > 1 || e.strength <= 0) { al.setX(i, 0); continue; }
      const p = this._p.copy(e.p0).addScaledVector(e.vel, age);
      p.y -= 0.5 * g * age * age;
      pos.setXYZ(i, p.x, p.y, p.z);
      // 終わりほど早く薄れる（ふくらみながら消える）。切り替えまで尾を引かない
      al.setX(i, e.strength * Math.pow(1 - k, 1.5) * 0.95);
      sz.setX(i, e.size * (1 + 2.5 * k));
    }
    pos.needsUpdate = al.needsUpdate = sz.needsUpdate = true;
  }
}

/* =============================================================== */
export class World {
  /**
   * スキーヤーより先に作る（envMap を金属の映り込みに渡すため）。
   * レンダラーのトーンマッピングと影、霧、空、光、環境マップをここで用意する。
   */
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.narrow = isNarrow();
    this.pelvisMode = false;
    this.discKey = 'SL';

    /* --- レンダラー ---
     * ACES は雪を灰色に沈め、影の青みも消していた。Neutral は白をほぼそのまま出す。 */
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 0.96;
    renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap は r186 で廃止され、指定すると警告つきで PCF に置き換わる
    renderer.shadowMap.type = THREE.PCFShadowMap;

    scene.fog = new THREE.Fog(HAZE, FOG.SL[0], FOG.SL[1]);
    // 地形は霧の外まで続くので、遠い端が描画距離で切れて空がのぞかないようにする
    if (camera) { camera.far = Math.max(camera.far, 1600); camera.updateProjectionMatrix(); }

    this.sunDir = SUN_OFFSET.clone().normalize();

    /* --- 空（カメラについて動く） --- */
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMaterial(this.sunDir));
    this.sky.renderOrder = -2;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    /* --- 山並み（空のすぐあとに描く・深度は書かない） --- */
    const pano = new THREE.CylinderGeometry(450, 450, 160, 64, 1, true);
    pano.translate(0, 80 - 60, 0);                // 下端をカメラの 60 m 下に
    this.pano = new THREE.Mesh(pano, new THREE.MeshBasicMaterial({
      map: panoramaTexture(this.narrow ? 1024 : 2048), transparent: true, depthWrite: false,
      fog: false, side: THREE.BackSide }));
    this.pano.renderOrder = -1;
    this.pano.frustumCulled = false;
    scene.add(this.pano);

    /* --- 光 ---
     * 空の光（青み）＋ 横からの日差し（暖色）。日なたは白く、影は空の青だけで照らされて青くなる。
     * 強さは調整値。既定の追従ビューで、日なたの雪が RGB 約 (222, 232, 246)、
     * スキーヤーの影が約 (191, 211, 238)（青 > 赤）になるように合わせた（スクリーンショットで実測）。
     * 日差しは横から（斜面の法線から約 47°、水平から約 37°）当てるので、雪面に届く日差しは 7 割ほど。
     * 空の光を強めにしないと、日なたの雪まで灰色に沈む。 */
    this.hemi = new THREE.HemisphereLight(0xcfdff5, 0xe8eef5, 3.4);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xfff3e2, 2.4);
    sun.castShadow = true;
    const ms = this.narrow ? 1024 : 2048;
    sun.shadow.mapSize.set(ms, ms);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -8; sun.shadow.camera.right = 8;
    sun.shadow.camera.top = 8; sun.shadow.camera.bottom = -8;
    sun.shadow.bias = -0.0012;
    sun.shadow.normalBias = 0.02;
    sun.shadow.radius = 2;
    scene.add(sun, sun.target);
    this.sun = sun;
    // 逆光側の弱い補助光。輪郭が黒く潰れないように（日差しを横にしたぶん弱める）
    this.fill = new THREE.DirectionalLight(0xd6e6ff, 0.3);
    this.fill.position.set(-5, 4, -7);
    scene.add(this.fill);

    /* --- 環境マップ：空と雪面から作る ---
     * 以前は fromScene(…, 0.02) で far が既定の 100 m だったため、半径 500 m の空が
     * 映らず真っ黒になり、ゴーグルのレンズが黒い穴に見えていた。far = 1000 にする。
     * scene.environment にすると全マテリアルが IBL を引いて重くなるので、
     * 金属（レンズ・バックル・エッジ）にだけ個別に渡す。 */
    {
      const envScene = new THREE.Scene();
      envScene.add(new THREE.Mesh(this.sky.geometry, this.sky.material));
      const ground = new THREE.Mesh(
        new THREE.SphereGeometry(400, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0xeef4fb, side: THREE.BackSide }));
      envScene.add(ground);
      const pmrem = new THREE.PMREMGenerator(renderer);
      this.envMap = pmrem.fromScene(envScene, 0.02, 0.1, 1000).texture;
      pmrem.dispose();
      ground.geometry.dispose(); ground.material.dispose();
    }

    /* --- コースのまわり（骨盤アップでは隠す） --- */
    this.group = new THREE.Group();
    this.group.name = 'world';
    scene.add(this.group);
    this.treeGeo = coniferGeometry();
    this.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    /* 自由カメラで横へ大きく引くと、カメラが森の中に入り、目の前の幹と枝で何も見えなくなる。
     * カメラから 3〜7 m の木は、画面の点ごとのしきい値で少しずつ抜いて（ディザ）透かす。
     * 半透明にしないので並べ替えも深度の書き込みもいらない。 */
    this.treeMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          float camD = length(vViewPosition);
          float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (camD < 7.0 && smoothstep(3.0, 7.0, camD) < ign) discard;
        }`);
    };
    this.netTex = netTexture();
    this.netMat = new THREE.MeshLambertMaterial({ map: this.netTex, transparent: true, opacity: 0.6,
      side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05 });
    /* 支柱は明るい灰。暗い色だと、ネットを真横から見たときに支柱が重なって黒い 1 本の線に見えた */
    this.postMat = new THREE.MeshLambertMaterial({ color: 0x9aa3ad });
    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });

    this.spray = new Spray(this.narrow ? 120 : 240);
    scene.add(this.spray.points);
    this._size = new THREE.Vector2();
  }

  /**
   * コースに合わせて地形・森・ネットを作り直す（スライダーで斜度や旗門を変えたときも）。
   * 地形は斜面座標（u：フォールライン方向、w：横方向、h：法線方向）で作る。
   */
  build(model, { discipline, gateCount = 9 } = {}) {
    this.model = model;
    this.discKey = discipline?.key === 'GS' ? 'GS' : 'SL';
    this._applyFog();
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      if (c.geometry !== this.treeGeo) c.geometry?.dispose?.();
      c.dispose?.();
    }
    const pisteHalf = pisteHalfWidth(model, discipline);
    this.pisteHalf = pisteHalf;
    // 雪面（course.snow）と同じ範囲。uTop より上はピステも地形が覆って尾根になる
    const { u0, u1, uTop, uStart: U0, uEnd: U1 } = courseExtent(model, gateCount);
    const R = rng(3);
    const ph = Array.from({ length: 8 }, () => R() * Math.PI * 2);

    /* 斜面からの高さ h(u, w)：ピステの外は土手（最初は 0.22 m/m、遠くで 0.10 m/m へ
     * なめらかに移る）＋ ゆるい起伏。上の端は尾根にして、霞の中の稜線に見せる */
    const height = (u, w) => {
      const a = Math.abs(w) - pisteHalf;
      // 上の端：斜面が少し急になり、ぎざぎざの尾根で終わる（霧の中なので霞の稜線に見える）
      const ridge = Math.max(0, uTop - u);
      // 稜線のぎざぎざ：折り返した正弦（|sin|）を重ねると、丸い丘ではなく尖った峰と鞍部になる
      const crest = 22 + 26 * (1 - Math.abs(Math.sin(w * 0.0105 + ph[4])))
        + 13 * (1 - Math.abs(Math.sin(w * 0.031 + ph[5]))) + 5 * Math.sin(w * 0.083 + ph[6]);
      const top = ridge * 0.14 + crest * smooth(0, 280, ridge) * smooth(0, 60, ridge);
      if (a < 0) return -0.012 + top;
      const bank = 0.10 * a + 0.72 * (1 - Math.exp(-a / 6));
      const bumps = 1.6 * Math.sin(u * 0.021 + ph[0]) * Math.sin(w * 0.045 + ph[1])
        + 0.8 * Math.sin(u * 0.07 + ph[2] + w * 0.03)
        + 7 * Math.sin(w * 0.011 + ph[3]) * smooth(40, 200, a);
      return bank + bumps * smooth(0, 14, a) + top;
    };
    this._height = height;
    /* 森の濃さ（0〜1）：ピステの縁から 3 m あけ、尾根や沢のようにまだらにする */
    const forest = (u, w) => {
      const a = Math.abs(w) - pisteHalf;
      const side = w > 0 ? 1 : 0;
      const clump = 0.72 + 0.18 * Math.sin(u * 0.027 + ph[6] + side * 2.1)
        + 0.12 * Math.sin(u * 0.081 + w * 0.05 + ph[7]);
      return smooth(3, 8, a) * THREE.MathUtils.clamp(clump, 0, 1) * (0.35 + 0.65 * Math.exp(-Math.max(0, a - 8) / 70));
    };

    /* --- 地形 ---
     * ピステの下には作らない（雪面と 2 cm しか離れていないので、遠くで重なりがちらつく）。
     * 土手はピステの縁から外へ広がる間隔の列で作る（縁は 0.3 m だけ雪面の下に重ねる）。
     * ピステの上の端（uTop）より上だけは、ピステの幅も地形で覆って尾根までつなぐ。 */
    {
      const cols = [-0.3, 0.6, 1.6, 2.8, 4.2, 5.8, 7.8, 10.2, 13, 16.5, 21, 26.5, 33, 41, 51, 63,
        78, 96, 118, 145, 178, 218, 266, 324, 394, 470, 540, 600];
      const inner = pisteHalf - 0.3;
      const ws = [];
      for (let i = cols.length - 1; i >= 0; i--) ws.push(-(pisteHalf + cols[i]));
      ws.push(-inner / 2, 0, inner / 2);                       // ピステの中（尾根の部分だけ使う）
      for (const c of cols) ws.push(pisteHalf + c);
      const us = [];
      // 行の間隔（起伏の波長は 90 m 以上あるので粗くてよい）。狭い画面はさらに粗く
      const du = THREE.MathUtils.clamp(model.halfCycle / 2.5, 4, 9) * (this.narrow ? 1.5 : 1);
      for (let u = u0 - 90; u <= u1 + 160; u += du) us.push(u);
      for (let s = du, u = u0 - 90; u > U0; s *= 1.25) { u = Math.max(U0, u - s); us.unshift(u); }
      for (let s = du, u = us[us.length - 1]; u < U1; s *= 1.25) { u = Math.min(U1, u + s); us.push(u); }
      // 雪面の上の端にちょうど 1 行置く（ここで雪面と地形がつながる）
      if (!us.some((u) => Math.abs(u - uTop) < 1e-6)) { us.push(uTop); us.sort((a, b) => a - b); }
      const pos = [], colr = [], idx = [];
      const nw = ws.length;
      for (const u of us) {
        for (const w of ws) {
          const p = model.onSlope(u, w, height(u, w));
          pos.push(p.x, p.y, p.z);
          const a = Math.abs(w) - pisteHalf;
          // 圧雪していない雪：ほんの少し青く、場所でむらがある。森の下は木陰と落ち葉で暗い
          const v = 0.95 + 0.03 * Math.sin(u * 0.13 + w * 0.2) * smooth(0, 6, a);
          const f = forest(u, w) * 0.6;
          colr.push(v * (0.965 - f * 0.55), v * (0.98 - f * 0.47), v * (1.0 - f * 0.38));
        }
      }
      for (let i = 0; i < us.length - 1; i++) {
        const capped = us[i + 1] <= uTop + 1e-6;              // 尾根の部分（ピステの上の端より上）
        for (let j = 0; j < nw - 1; j++) {
          const inPiste = Math.abs(ws[j]) <= inner + 1e-6 && Math.abs(ws[j + 1]) <= inner + 1e-6;
          if (inPiste && !capped) continue;
          const k = i * nw + j;
          idx.push(k, k + 1, k + nw, k + 1, k + nw + 1, k + nw);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      // 法線の向きをそろえる（面の巻き方向で裏返っていたら反転）
      const nrm = g.attributes.normal;
      let sgn = 0;
      for (let i = 0; i < nrm.count; i++) sgn += nrm.getX(i) * model.N.x + nrm.getY(i) * model.N.y + nrm.getZ(i) * model.N.z;
      if (sgn < 0) {
        for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
        g.setIndex(idx);
        g.computeVertexNormals();
      }
      const terrain = new THREE.Mesh(g, this.terrainMat);
      terrain.receiveShadow = true;
      terrain.name = 'terrain';
      this.group.add(terrain);
    }

    /* --- 森（1 回の描画）。木は斜面の法線ではなく鉛直に立てる --- */
    {
      const nTrees = this.narrow ? 350 : 700;
      const trees = new THREE.InstancedMesh(this.treeGeo, this.treeMat, nTrees);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      const Y = new THREE.Vector3(0, 1, 0);
      const color = new THREE.Color();
      // カメラがよく向くあたり（コースの少し上〜下）に多めに置く
      const nearU0 = u0 - 140, nearU1 = u1 + 340;
      /* 上の尾根（uTop より上）には置かない。霧で白くなった木が青空を背に立つと、
       * 稜線に白い尖塔が並んだように見えた */
      const farU0 = uTop + 30;
      let k = 0;
      for (let tries = 0; k < nTrees && tries < nTrees * 12; tries++) {
        const u = R() < 0.68 ? nearU0 + (nearU1 - nearU0) * R() : farU0 + (U1 - farU0) * R();
        const side = R() < 0.5 ? -1 : 1;
        // 縁の近くに密に、奥へはまばらに（2 つの指数分布を混ぜる）
        const a = 3.5 + (-Math.log(1 - R() * 0.995)) * (R() < 0.6 ? 16 : 48);
        const w = side * (pisteHalf + a);
        if (R() > forest(u, w) * 1.25) continue;
        const p = model.onSlope(u, w, height(u, w) - 0.3);
        const h = 9 + R() * 11;
        q.setFromAxisAngle(Y, R() * Math.PI * 2);
        const wide = 0.85 + R() * 0.3;
        sc.set(h * wide, h, h * wide * (0.9 + R() * 0.2));
        m.compose(p, q, sc);
        trees.setMatrixAt(k, m);
        // 1 本ずつ明るさと色みを少し変える（±8 %）
        const j = 0.92 + R() * 0.16;
        color.setRGB(j * (0.96 + R() * 0.08), j, j * (0.96 + R() * 0.08));
        trees.setColorAt(k, color);
        k++;
      }
      trees.count = k;
      trees.instanceMatrix.needsUpdate = true;
      if (trees.instanceColor) trees.instanceColor.needsUpdate = true;
      trees.computeBoundingSphere();
      trees.castShadow = false;
      trees.name = 'trees';
      this.group.add(trees);
    }

    /* --- B ネット（両側、高さ 2.0 m、鉛直） ---
     * 高さ 2 m・網目 50 mm・PVC の支柱は Alpine Canada の WCS B-Net ガイドラインによる
     * （監査で検索結果の要約として見たもの。本文は確認できていない）。 */
    {
      const H = 2.0, netW = pisteHalf - 1.5;
      const nu0 = u0 - 150, nu1 = u1 + 300;
      const Y = new THREE.Vector3(0, 1, 0);
      const pos = [], uv = [], idx = [];
      let base = 0;
      const n = 140;
      for (const side of [-1, 1]) {
        for (let i = 0; i <= n; i++) {
          const u = nu0 + (nu1 - nu0) * (i / n);
          const b = model.onSlope(u, side * netW, -0.01);
          const t = b.clone().addScaledVector(Y, H);
          pos.push(b.x, b.y, b.z, t.x, t.y, t.z);
          uv.push(u / 1.0, 0, u / 1.0, H / 1.0);
          if (i < n) { const kk = base + i * 2; idx.push(kk, kk + 2, kk + 1, kk + 1, kk + 2, kk + 3); }
        }
        base += (n + 1) * 2;
      }
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      ng.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      ng.setIndex(idx);
      ng.computeVertexNormals();
      const nets = new THREE.Mesh(ng, this.netMat);
      nets.renderOrder = 1;
      nets.name = 'nets';
      this.group.add(nets);
      // 支柱：4 m おき
      // 細い支柱なので三角柱で足りる（何百本もあるので三角形を節約）
      const postGeo = new THREE.CylinderGeometry(0.022, 0.026, H + 0.15, 3, 1, true);
      postGeo.translate(0, (H + 0.15) / 2, 0);
      const nPost = Math.floor((nu1 - nu0) / 4) + 1;
      const posts = new THREE.InstancedMesh(postGeo, this.postMat, nPost * 2);
      const m = new THREE.Matrix4();
      let k = 0;
      for (const side of [-1, 1]) {
        for (let i = 0; i < nPost; i++) {
          m.makeTranslation(model.onSlope(nu0 + i * 4, side * netW, -0.01));
          posts.setMatrixAt(k++, m);
        }
      }
      posts.count = k;
      posts.computeBoundingSphere();
      posts.name = 'netPosts';
      this.group.add(posts);
    }

    this.spray.reset(model, discipline);
    this._applyPelvis();
    return this;
  }

  /** 毎フレーム（カメラを動かしたあとに呼ぶ） */
  update(s, camera = this.camera, { u, model = this.model } = {}) {
    if (s?.com) {
      this.sun.target.position.copy(s.com);
      this.sun.position.copy(s.com).add(SUN_OFFSET);
    }
    if (camera) {
      // 空と山並みはカメラについて動く（無限遠に見せる）
      this.sky.position.copy(camera.position);
      this.pano.position.copy(camera.position);
    }
    if (model && u !== undefined && this.spray.step) {
      this.renderer.getDrawingBufferSize(this._size);
      const fov = THREE.MathUtils.degToRad(camera?.fov ?? 45);
      const viewH = this._size.y / (2 * Math.tan(fov / 2));
      this.spray.update(model, u, viewH);
    }
  }

  /** 骨盤アップ：森・ネット・地形・山並みを隠し、霧を近くして背景を無地の霞にする */
  setPelvisMode(on) {
    this.pelvisMode = !!on;
    this._applyPelvis();
  }

  _applyPelvis() {
    const on = this.pelvisMode;
    this.group.visible = !on;
    this.pano.visible = !on;
    this.sky.material.uniforms.neutral.value = on ? 1 : 0;
    this._applyFog();
  }

  _applyFog() {
    const f = this.pelvisMode ? FOG_PELVIS : FOG[this.discKey];
    this.scene.fog.color.set(HAZE);
    this.scene.fog.near = f[0];
    this.scene.fog.far = f[1];
  }
}
