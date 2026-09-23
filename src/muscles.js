/**
 * muscles.js — 主要な筋（起始・停止・作用）と、その表示
 *
 * ■ 考え方
 *   筋は「骨のどこからどこへ付いているか（起始・停止）」で働きが決まる。
 *   そこで各筋を、骨のローカル座標で定義した付着部どうしを結ぶ帯として描く。
 *   骨が動けば筋の走行も自動的に変わる。
 *   活動度（色）は biomech.js が外力から計算した関節モーメントから決まる。
 *
 * ■ 付着部の座標系
 *   pelvis : 骨盤ローカル（+x 左・+y 上・+z 前、原点は骨盤中心）
 *   femur  : 大腿骨ローカル（原点＝骨頭、−y が膝方向、+x が外側）
 *   shank  : 脛骨ローカル（原点＝膝、−y が足首方向、+x が外側）
 *   shoulder: 肩関節ローカル（胸郭に連結。+x 左・+y 上・+z 前）
 *   humerus : 上腕骨ローカル（原点＝肩、−y が肘方向、+x が外側）
 *   forearm : 前腕ローカル（原点＝肘、−y が手方向、+x が外側）
 *   spineXX: その椎骨のローカル
 *
 * ■ 出典
 *   起始・停止・作用は標準的な解剖学の記載（Gray's Anatomy / Kendall,
 *   Muscles: Testing and Function）に基づく。座標は本モデルの骨格に合わせた近似。
 */
import * as THREE from 'three';

const P = (x, y, z) => [x, y, z];

/**
 * 筋の定義。
 *   pull: この筋が担う関節モーメントの種類（biomech.js が参照）
 *   side: 'both' なら左右対称に作る
 */
export const MUSCLES = [
  /* ---------------- 股関節まわり ---------------- */
  {
    id: 'gluteusMax', name: '大殿筋', short: '大殿筋', color: 0xd94f4f, w: 0.072, th: 0.024,
    origin: { node: 'pelvis', p: P(0.045, 0.035, -0.088) },      // 腸骨後部・仙骨
    via: [{ node: 'pelvis', p: P(0.098, -0.025, -0.060) }],
    insertion: { node: 'femur', p: P(0.030, -0.125, -0.022) },   // 殿筋粗面
    pull: [['hipExtension', 1.0], ['hipExternalRot', 0.5], ['hipAbduction', 0.25]],
    note: '股関節を伸ばす・外へ回す。山回りで外脚を支える主役。',
  },
  {
    id: 'gluteusMed', name: '中殿筋', short: '中殿筋', color: 0xff8f3f, w: 0.050, th: 0.019,
    origin: { node: 'pelvis', p: P(0.092, 0.050, -0.012) },      // 腸骨外面
    insertion: { node: 'femur', p: P(0.050, -0.016, -0.004) },   // 大転子
    pull: [['hipAbduction', 1.0]],
    note: '片脚で立ったとき骨盤が落ちないよう支える。外傾を保つ要。',
  },
  {
    id: 'adductors', name: '内転筋群', short: '内転筋', color: 0x59b0e0, w: 0.044, th: 0.027,
    origin: { node: 'pelvis', p: P(0.022, -0.098, 0.030) },      // 恥骨・坐骨
    insertion: { node: 'femur', p: P(-0.012, -0.230, -0.022) },  // 粗線
    pull: [['hipAdduction', 1.0]],
    note: '脚を内へ引きつける。内スキーを引き寄せ、両脚をそろえる。',
  },
  {
    id: 'iliopsoas', name: '腸腰筋', short: '腸腰筋', color: 0xc77dff, w: 0.029, th: 0.021,
    origin: { node: 'spineL3', p: P(0.018, 0.010, 0.004) },      // 腰椎
    via: [{ node: 'pelvis', p: P(0.048, -0.045, 0.055) }],
    insertion: { node: 'femur', p: P(-0.014, -0.060, -0.020) },  // 小転子
    pull: [['hipFlexion', 1.0]],
    note: '股関節を曲げる。前に構える姿勢と、腰椎の安定を担う。',
  },
  {
    id: 'tfl', name: '大腿筋膜張筋・腸脛靭帯', short: '腸脛靭帯', color: 0xffd166, w: 0.029, th: 0.010,
    origin: { node: 'pelvis', p: P(0.112, 0.038, 0.082) },       // 上前腸骨棘
    via: [{ node: 'femur', p: P(0.046, -0.210, 0.006) }],
    insertion: { node: 'shank', p: P(0.028, -0.058, 0.012) },    // ゲルディ結節
    pull: [['hipAbduction', 0.6], ['hipInternalRot', 0.4], ['kneeExtension', 0.2]],
    note: '骨盤から膝の外側までをつなぐ帯。外側から膝を支える。',
  },
  /* ---------------- 膝まわり ---------------- */
  {
    id: 'rectusFemoris', name: '大腿直筋', short: '大腿直筋', color: 0xff5f5f, w: 0.037, th: 0.025,
    origin: { node: 'pelvis', p: P(0.058, -0.008, 0.068) },      // 下前腸骨棘
    via: [{ node: 'femur', p: P(0.004, -0.300, 0.038) }],
    insertion: { node: 'shank', p: P(0, -0.048, 0.026) },        // 膝蓋腱→脛骨粗面
    pull: [['kneeExtension', 1.0], ['hipFlexion', 0.4]],
    note: '膝を伸ばし股関節を曲げる。前に構えたまま脚を支える。',
  },
  {
    id: 'vastusLat', name: '外側広筋', short: '外側広筋', color: 0xff7a5f, w: 0.050, th: 0.029,
    origin: { node: 'femur', p: P(0.032, -0.095, -0.004) },
    via: [{ node: 'femur', p: P(0.024, -0.330, 0.030) }],
    insertion: { node: 'shank', p: P(0, -0.048, 0.026) },
    pull: [['kneeExtension', 1.0]],
    note: '太ももの外側。ターン中いちばん働く筋のひとつ。',
  },
  {
    id: 'vastusMed', name: '内側広筋', short: '内側広筋', color: 0xffa07a, w: 0.039, th: 0.025,
    origin: { node: 'femur', p: P(-0.016, -0.185, 0.004) },
    via: [{ node: 'femur', p: P(-0.022, -0.360, 0.028) }],
    insertion: { node: 'shank', p: P(0, -0.048, 0.026) },
    pull: [['kneeExtension', 1.0]],
    note: '太ももの内側。膝のすぐ上で膝蓋骨を安定させる。',
  },
  {
    id: 'hamstrings', name: 'ハムストリング', short: 'ハム', color: 0x7a5fd9, w: 0.048, th: 0.027,
    origin: { node: 'pelvis', p: P(0.056, -0.148, -0.052) },     // 坐骨結節
    insertion: { node: 'shank', p: P(0.026, -0.052, -0.012) },   // 腓骨頭・脛骨内側
    pull: [['kneeFlexion', 1.0], ['hipExtension', 0.6]],
    note: '膝を曲げ股関節を伸ばす。後傾を止めるブレーキ。',
  },
  /* ---------------- 足首まわり ---------------- */
  {
    id: 'tibialisAnt', name: '前脛骨筋', short: '前脛骨筋', color: 0x4cc3ff, w: 0.025, th: 0.016,
    origin: { node: 'shank', p: P(0.018, -0.095, 0.022) },
    insertion: { node: 'shank', p: P(0.004, -0.400, 0.034) },    // 足首前面（内側楔状骨）
    pull: [['ankleDorsi', 1.0]],
    note: 'すねの前。ブーツのベロを押し続ける筋。',
  },
  {
    id: 'triceps', name: '下腿三頭筋', short: 'ふくらはぎ', color: 0x59d9a4, w: 0.048, th: 0.027,
    origin: { node: 'femur', p: P(0.010, -0.415, -0.022) },      // 大腿骨顆（腓腹筋）
    via: [{ node: 'shank', p: P(0.002, -0.140, -0.034) }],
    insertion: { node: 'shank', p: P(0.002, -0.408, -0.040) },   // 踵骨
    pull: [['anklePlantar', 1.0]],
    note: 'ふくらはぎ。ブーツの中で踵を押さえる。',
  },
  /* ---------------- 体幹 ---------------- */
  {
    id: 'obliques', name: '腹斜筋', short: '腹斜筋', color: 0xff6bd6, w: 0.046, th: 0.020,
    origin: { node: 'spineT9', p: P(0.082, 0.014, 0.062) },      // 第5〜12肋骨の外面
    via: [{ node: 'spineT12', p: P(0.112, 0.004, 0.052) }],      // 脇腹をまわり込む
    insertion: { node: 'pelvis', p: P(0.070, 0.058, 0.066) },    // 腸骨稜・鼠径靭帯
    pull: [['trunkRotation', 1.0], ['trunkLateral', 0.6]],
    note: '体幹をひねる主役。外向はこの筋が作る。',
  },
  {
    id: 'rectusAbd', name: '腹直筋', short: '腹直筋', color: 0xffa3d8, w: 0.033, th: 0.017,
    origin: { node: 'spineT9', p: P(0.022, 0.020, 0.120) },
    insertion: { node: 'pelvis', p: P(0.018, -0.062, 0.078) },   // 恥骨
    pull: [['trunkFlexion', 1.0]],
    note: '前に曲げる・骨盤を後ろに倒す。',
  },
  {
    id: 'erector', name: '脊柱起立筋', short: '起立筋', color: 0x9b8cff, w: 0.033, th: 0.022,
    origin: { node: 'pelvis', p: P(0.030, 0.030, -0.080) },      // 仙骨・腸骨稜
    via: [{ node: 'spineT12', p: P(0.026, 0, -0.040) }],
    insertion: { node: 'spineT6', p: P(0.024, 0, -0.045) },
    pull: [['trunkExtension', 1.0], ['trunkLateral', 0.4]],
    note: '背骨を立てる。前に潰れないよう支え続ける。',
  },
  {
    id: 'piriformis', name: '梨状筋', short: '梨状筋', color: 0xb388ff, w: 0.024, th: 0.014,
    origin: { node: 'pelvis', p: P(0.014, -0.012, -0.092) },     // 仙骨前面
    insertion: { node: 'femur', p: P(0.046, -0.012, -0.012) },   // 大転子の上
    pull: [['hipExternalRot', 1.0]],
    note: '股関節を外へ回す。骨盤を外向へ向けるのはこの筋のしごと。',
  },
  {
    id: 'sartorius', name: '縫工筋', short: '縫工筋', color: 0x8fd98f, w: 0.020, th: 0.012,
    origin: { node: 'pelvis', p: P(0.108, 0.034, 0.080) },       // 上前腸骨棘
    via: [{ node: 'femur', p: P(0.006, -0.235, 0.044) }],
    insertion: { node: 'shank', p: P(-0.026, -0.062, 0.016) },   // 鵞足（脛骨内側）
    pull: [['hipFlexion', 0.45], ['hipExternalRot', 0.35], ['kneeFlexion', 0.25]],
    note: '身体でいちばん長い筋。太ももを斜めに横切って膝の内側へ。',
  },
  {
    id: 'quadratus', name: '腰方形筋', short: '腰方形筋', color: 0x59d9c8, w: 0.027, th: 0.017,
    origin: { node: 'pelvis', p: P(0.056, 0.068, -0.028) },      // 腸骨稜
    insertion: { node: 'spineT12', p: P(0.042, 0.012, -0.018) }, // 第12肋骨・腰椎横突起
    pull: [['trunkLateral', 1.0]],
    note: '骨盤と肋骨をつなぐ横の支え。外傾で骨盤の高さを保つ。',
  },
  /* ---------------- 背中・胸・肩・腕 ---------------- */
  {
    id: 'latissimus', name: '広背筋', short: '広背筋', color: 0x7fb2ff, w: 0.062, th: 0.016,
    origin: { node: 'pelvis', p: P(0.038, 0.072, -0.076) },      // 腸骨稜・胸腰筋膜
    via: [{ node: 'spineT9', p: P(0.062, 0, -0.056) }],
    insertion: { node: 'humerus', p: P(0.006, -0.052, 0.018) },  // 上腕骨小結節稜
    pull: [['trunkRotation', 0.55], ['trunkExtension', 0.45], ['armHold', 0.40]],
    note: '骨盤から上腕までをつなぐ大きな三角形。上体のひねりを腕まで伝える。',
  },
  {
    id: 'trapezius', name: '僧帽筋', short: '僧帽筋', color: 0x9fd4ff, w: 0.050, th: 0.014,
    origin: { node: 'spineT6', p: P(0.014, 0.004, -0.050) },
    via: [{ node: 'spineT1', p: P(0.048, 0, -0.046) }],
    insertion: { node: 'shoulder', p: P(0.004, 0.022, -0.024) }, // 肩甲棘・肩峰
    pull: [['armHold', 0.55], ['trunkExtension', 0.30]],
    note: '肩甲骨を引き寄せて支える。腕を前に構えたまま保つのに要る。',
  },
  {
    id: 'pectoralis', name: '大胸筋', short: '大胸筋', color: 0xffb3a7, w: 0.054, th: 0.017,
    origin: { node: 'spineT6', p: P(0.026, 0.006, 0.136) },      // 胸骨・肋軟骨
    insertion: { node: 'humerus', p: P(0.026, -0.050, 0.020) },  // 大結節稜
    pull: [['armHold', 0.65], ['trunkRotation', 0.35]],
    note: '腕を身体の前へ引きつける。ストックを前に構える形を保つ。',
  },
  {
    id: 'deltoid', name: '三角筋', short: '三角筋', color: 0xffc46b, w: 0.038, th: 0.019,
    origin: { node: 'shoulder', p: P(0.008, 0.026, -0.010) },    // 肩峰・鎖骨外側
    via: [{ node: 'humerus', p: P(0.038, -0.058, 0.006) }],
    insertion: { node: 'humerus', p: P(0.016, -0.132, 0.006) },  // 三角筋粗面
    pull: [['armHold', 1.0]],
    note: '肩の丸み。腕を上げたまま保つ筋。',
  },
  {
    id: 'biceps', name: '上腕二頭筋', short: '上腕二頭筋', color: 0xff9f8a, w: 0.030, th: 0.019,
    origin: { node: 'shoulder', p: P(-0.006, 0.004, 0.026) },    // 肩甲骨関節上結節
    via: [{ node: 'humerus', p: P(0.002, -0.110, 0.032) }],
    insertion: { node: 'forearm', p: P(0.002, -0.046, 0.022) },  // 橈骨粗面
    pull: [['elbowFlexion', 1.0]],
    note: '肘を曲げて保つ。ストックを構える腕の形をつくる。',
  },
  {
    id: 'tricepsBrachii', name: '上腕三頭筋', short: '上腕三頭筋', color: 0xc9a0ff, w: 0.032, th: 0.020,
    origin: { node: 'shoulder', p: P(0.010, -0.006, -0.026) },
    via: [{ node: 'humerus', p: P(0.004, -0.120, -0.028) }],
    insertion: { node: 'forearm', p: P(0.000, -0.018, -0.030) }, // 肘頭
    pull: [['elbowExtension', 1.0]],
    note: '肘を伸ばす。ストックを突いて身体を押し出すときに働く。',
  },
];

/* ============================================================
 * 帯（チューブ）の生成と更新
 * ============================================================ */
function createStrap(material, segs = 22, radial = 10) {
  const geo = new THREE.BufferGeometry();
  const count = (segs + 1) * (radial + 1);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const idx = [];
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.userData.segs = segs;
  mesh.userData.radial = radial;
  return mesh;
}

const _t = new THREE.Vector3(), _r = new THREE.Vector3(), _w = new THREE.Vector3();
const _p = new THREE.Vector3(), _tmp = new THREE.Vector3();

/**
 * 制御点（ワールド座標）に沿って筋腹の頂点を更新する。
 *
 * 筋は丸い紐ではなく、骨に貼りついた<b>平たい肉のかたまり</b>なので、
 * 断面を楕円にして、薄いほうを骨の側（out）に向ける。
 * 両端は腱になって細くなるので、紡錘形にテーパーをかける。
 *
 * @param {THREE.Vector3} out 骨の軸から外向きの方向（薄い側の向き）
 */
function updateStrap(mesh, points, halfW, halfT, out) {
  const { segs, radial } = mesh.userData;
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.3);
  const pos = mesh.geometry.attributes.position;
  const nor = mesh.geometry.attributes.normal;

  let k = 0;
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, _p);
    curve.getTangentAt(u, _t).normalize();
    // 薄い側の向きを接線に直交化する
    _r.copy(out).addScaledVector(_t, -out.dot(_t));
    if (_r.lengthSq() < 1e-8) _r.set(0, 1, 0).addScaledVector(_t, -_t.y);
    _r.normalize();
    _w.crossVectors(_t, _r).normalize();
    // 紡錘形：真ん中が筋腹、両端は腱
    const taper = 0.34 + 0.66 * Math.pow(Math.sin(Math.PI * u), 0.62);
    const a = halfW * taper, b = halfT * taper;
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      const c = Math.cos(th), sn = Math.sin(th);
      // 楕円の外向き法線（= (c/a, s/b) を正規化した向き）
      _tmp.copy(_w).multiplyScalar(c / a).addScaledVector(_r, sn / b).normalize();
      pos.setXYZ(k,
        _p.x + _w.x * a * c + _r.x * b * sn,
        _p.y + _w.y * a * c + _r.y * b * sn,
        _p.z + _w.z * a * c + _r.z * b * sn);
      nor.setXYZ(k, _tmp.x, _tmp.y, _tmp.z);
      k++;
    }
  }
  pos.needsUpdate = true;
  nor.needsUpdate = true;
}

/**
 * 筋のセットを作る。
 * @param {number} H 身長
 * @param {(name:string, side:string)=>THREE.Object3D} resolve 付着部の骨ノードを返す関数
 */
export function createMuscles(H, resolve) {
  const S = H / 1.75;
  const group = new THREE.Group();
  group.name = 'muscles';
  const items = [];

  for (const def of MUSCLES) {
    for (const side of ['L', 'R']) {
      const mat = new THREE.MeshStandardMaterial({
        color: def.color, roughness: 0.55, metalness: 0.0,
        transparent: true, opacity: 0.92,
        emissive: new THREE.Color(def.color).multiplyScalar(0.10),
      });
      const mesh = createStrap(mat);
      group.add(mesh);
      items.push({ def, side, mesh, mat, base: new THREE.Color(def.color) });
    }
  }

  const tmp = new THREE.Vector3();
  const _axisP = new THREE.Vector3(), _axisY = new THREE.Vector3(), _out = new THREE.Vector3();
  /** 付着部（ローカル）をワールド座標へ */
  function world(att, side) {
    const node = resolve(att.node, side);
    if (!node) return null;
    // 骨盤・脊柱のローカル +x は「左」なので右側は反転する。
    // 大腿骨・脛骨は右脚のノード自体が鏡像になっているので反転しない。
    const mirrored = att.node === 'femur' || att.node === 'shank';
    const sx = mirrored ? 1 : (side === 'L' ? 1 : -1);
    tmp.set(att.p[0] * sx * S, att.p[1] * S, att.p[2] * S);
    return node.localToWorld(tmp.clone());
  }

  /**
   * 位置と色を更新する。
   * @param {Object} act 筋 id → 活動度 0..1
   */
  function update(act = {}) {
    for (const it of items) {
      const { def, side, mesh } = it;
      const pts = [];
      const o = world(def.origin, side);
      if (!o) { mesh.visible = false; continue; }
      pts.push(o);
      for (const v of def.via || []) { const w = world(v, side); if (w) pts.push(w); }
      const ins = world(def.insertion, side);
      if (!ins) { mesh.visible = false; continue; }
      pts.push(ins);
      mesh.visible = true;
      // 「骨の軸から外向き」の方向を、起始側の骨ノードから求める。
      // これを断面の薄いほうに向けると、筋が骨に貼りついて見える。
      const host = resolve(def.origin.node, side);
      const mid = pts[Math.floor(pts.length / 2)];
      host.getWorldPosition(_axisP);
      _axisY.set(0, 1, 0).transformDirection(host.matrixWorld).normalize();
      _out.copy(mid).sub(_axisP);
      _out.addScaledVector(_axisY, -_out.dot(_axisY));
      if (_out.lengthSq() < 1e-8) _out.set(0, 0, 1);
      _out.normalize();
      updateStrap(mesh, pts, def.w * S, def.th * S, _out);

      // 活動度に応じて色を変える（休んでいる＝くすんだ色、働く＝鮮やか）
      const a = THREE.MathUtils.clamp(act[def.id + side] ?? act[def.id] ?? 0, 0, 1);
      it.mat.color.copy(it.base).lerp(new THREE.Color(0x6a7482), 1 - a).lerp(it.base, a);
      it.mat.color.copy(new THREE.Color(0x5b6472).lerp(it.base, 0.25 + 0.75 * a));
      it.mat.emissive.copy(it.base).multiplyScalar(0.05 + 0.45 * a);
      it.mat.opacity = 0.55 + 0.42 * a;
    }
  }

  return {
    group, items, update,
    setOpacity(o) {
      for (const it of items) { it.mat.opacity = o; it.mat.transparent = o < 1; }
    },
  };
}
