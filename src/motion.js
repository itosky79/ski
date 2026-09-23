/**
 * motion.js — 動作ガイド（いま何をするか）
 *
 * ■ なぜ要るか
 *   角度や力を出しても、初心者には「で、自分は何をすればいいのか」が分からない。
 *   姿勢の<b>スナップショット</b>ではなく<b>変化</b>を見せないと、動作は伝わらない。
 *
 * ■ どう作るか
 *   いまの位相と、少し先の位相のモデルをそれぞれ計算して差をとる。
 *   つまり矢印は手で描いた振り付けではなく、<b>モデルそのものの時間微分</b>。
 *   姿勢パラメータを変えれば矢印も自動で変わる。
 *
 *       速さ = （少し先の値 − いまの値） / 位相の刻み
 *
 *   それを動作ごとの基準値で割って 0〜1 にし、大きい順に 3 つだけ出す。
 *   一度に 7 つ出しても読めないので、「いまいちばん大事な 3 つ」に絞る。
 *
 * ■ 矢印の向き
 *   回転は右ねじ。軸は「その動作で増える向き」を作る軸を幾何から決める。
 *     腰を折る   : 軸 = 上 × 外側      （上体が外側へ倒れる回転）
 *     エッジ     : 軸 = 板の法線 × 内側（板が内側へ倒れる回転）
 *     骨盤の回旋 : 軸 = 上（外側が左なら +、右なら −）
 */
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/* 動作の定義。
 *   get   : モデルのサンプルから量を取り出す
 *   ref   : 位相 1.0 あたりの変化量がこれなら「速さ 1.0」とみなす基準。
 *           1 ターンで実際に出る最大の速さに合わせてあるので、
 *           バーの長さがそのまま「いまどれだけ急いでやる動きか」になる。
 *   up/dn : 増えるとき／減るときの言い方（初心者向けの命令形）
 *   why   : なぜそれをするのか（パネル用の一行）
 */
export const MOVES = [
  {
    key: 'pelvis', kind: 'turn', ref: 1.5,
    get: (s) => s.counter,
    up: '骨盤を外側へ向けていく', dn: '骨盤を正対へ戻す',
    why: 'スキーだけが回って上体は谷に残る。その差が外向角。',
  },
  {
    key: 'fold', kind: 'turn', ref: 1.5,
    get: (s) => s.angulation,
    up: '外脚の付け根を折る（外傾をつくる）', dn: '腰を起こして外傾をほどく',
    why: '身体を倒さずにエッジ角だけ足せるのは、腰を折ったぶんだけ。',
  },
  {
    key: 'leg', kind: 'push', ref: 0.42,
    get: (s) => s.legLen,
    up: '外脚を伸ばして雪を押す', dn: '外脚を曲げて圧を抜く',
    why: '伸ばせば圧が増え、曲げれば抜ける。切り替えは「抜く」から始まる。',
  },
  {
    key: 'edge', kind: 'turn', ref: 2.8,
    get: (s) => s.edgeAngle,
    up: 'エッジを立てる', dn: 'エッジを寝かせる',
    why: 'エッジ角が立つほど回転半径が小さくなる。',
  },
  {
    key: 'share', kind: 'push', ref: 1.0,
    get: (s) => s.outerShare,
    up: '外スキーへ乗り移る', dn: '内スキーにも乗っていく',
    why: '外脚が仕事をする。内脚は次のターンの準備。',
  },
  {
    key: 'fore', kind: 'push', ref: 0.40,
    get: (s) => s.comFore,
    up: 'すねでブーツの前を押す', dn: '圧を足裏の真下へ戻す',
    why: '前に乗るとトップが噛む。後ろに残ると板が抜ける。',
  },
  {
    key: 'block', kind: 'push', ref: 7.5,
    get: (s) => s.gateBlock ?? 0,
    up: '内側の手でポールをたたきに行く', dn: 'たたいた手を前へ戻す',
    why: 'アルペンは全身。上体は伸びているのではなく、旗門を処理している。',
  },
  {
    key: 'spine', kind: 'turn', ref: 1.4,
    get: (s) => (s.counterSpine ?? s.counter) - s.counter,
    up: 'みぞおちを谷へ向ける', dn: '上体のひねりをほどく',
    why: '外向の約 2/3 は胸椎でつくる。腰だけでは回らない。',
  },
];

const COLOR = 0xffc93c;         // 「これをする」の色
const COLOR_DIM = 0xff9f1c;

/* ------------------------------------------------------------------ */
/* 矢印の部品                                                          */
/* ------------------------------------------------------------------ */

/** まっすぐな矢印（軸 +y 方向、原点が根元） */
function straightArrow(mat, len = 0.36, r = 0.016, headR = 0.042, headL = 0.095) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, len - headL, 12), mat);
  shaft.position.y = (len - headL) / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(headR, headL, 16), mat);
  head.position.y = len - headL / 2;
  g.add(shaft, head);
  return g;
}

/** 曲がった矢印（+y 軸まわりに反時計回り、xz 平面上） */
function curvedArrow(mat, R = 0.17, tube = 0.0135, arc = 2.2) {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(R, tube, 8, 40, arc), mat);
  ring.rotation.x = Math.PI / 2;      // xy 平面 → xz 平面
  g.add(ring);
  const head = new THREE.Mesh(new THREE.ConeGeometry(tube * 3.0, tube * 7.5, 16), mat);
  // 弧の終端に、接線方向を向けて置く
  head.position.set(R * Math.cos(arc), 0, -R * Math.sin(arc));
  head.quaternion.setFromUnitVectors(V(0, 1, 0),
    V(-Math.sin(arc), 0, -Math.cos(arc)));
  g.add(head);
  return g;
}

/** 基準ベクトルから回転行列を作る（local +y を axis に合わせる） */
function orientY(obj, axis, ref) {
  const Y = axis.clone().normalize();
  let Z = ref.clone().addScaledVector(Y, -ref.dot(Y));
  if (Z.lengthSq() < 1e-8) Z = Math.abs(Y.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
  Z.normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z).normalize();
  obj.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}

/* ------------------------------------------------------------------ */
/* 本体                                                                */
/* ------------------------------------------------------------------ */

export class MotionGuide {
  /**
   * @param {THREE.Scene} scene
   * @param {number} shown 同時に出す矢印の数
   */
  constructor(scene, shown = 3) {
    this.shown = shown;
    this.group = new THREE.Group();
    this.group.name = 'motionGuide';
    scene.add(this.group);
    this.mats = [];
    this.slots = [];
    for (let i = 0; i < shown; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: i === 0 ? COLOR : COLOR_DIM, roughness: 0.35, metalness: 0.1,
        emissive: new THREE.Color(i === 0 ? COLOR : COLOR_DIM).multiplyScalar(0.35),
        transparent: true, opacity: 0.96,
        // 教材のオーバーレイなので、身体や板に隠れず常に読めるようにする
        depthTest: false, depthWrite: false,
      });
      const turn = curvedArrow(mat);
      const push = straightArrow(mat);
      turn.visible = push.visible = false;
      turn.renderOrder = push.renderOrder = 20;
      turn.traverse((o) => { o.renderOrder = 20; });
      push.traverse((o) => { o.renderOrder = 20; });
      this.group.add(turn, push);
      this.slots.push({ mat, turn, push });
      this.mats.push(mat);
    }
    this.active = [];        // [{ key, text, why, mag, dir, anchor }]
    this.scale = 1;
  }

  setVisible(v) { this.group.visible = v; }
  setScale(k) { this.scale = k; }

  /**
   * @param {Object} s     いまのサンプル
   * @param {Object} sNext 少し先のサンプル
   * @param {number} dPhase 位相の刻み
   * @param {Object} st    skier.state（anchors を使う）
   */
  update(s, sNext, dPhase, st) {
    const a = st.anchors;
    if (!a || !a.pelvis) { this.active = []; return; }

    /* --- 各動作の速さ（位相あたりの変化を基準値で割ったもの） --- */
    const rated = MOVES.map((m) => {
      const rate = (m.get(sNext) - m.get(s)) / dPhase / m.ref;
      return { m, rate, mag: Math.min(1, Math.abs(rate)) };
    }).sort((x, y) => y.mag - x.mag);

    /* --- 幾何：その動作で「増える」向きの軸／方向 --- */
    const up = a.pelvisUp, right = a.pelvisRight;
    const outSign = right.dot(s.outward) > 0 ? -1 : 1;
    const legDir = a.outerHip.clone().sub(a.outerFoot).normalize();
    const place = {
      pelvis: { kind: 'turn', at: a.pelvis, axis: up.clone().multiplyScalar(outSign) },
      spine: { kind: 'turn', at: a.chest, axis: up.clone().multiplyScalar(outSign) },
      fold: { kind: 'turn', at: a.outerHip,
        axis: new THREE.Vector3().crossVectors(up, s.outward) },
      edge: { kind: 'turn', at: a.outerFoot,
        axis: new THREE.Vector3().crossVectors(a.skiNormal ?? s.normal, s.inward) },
      leg: { kind: 'push', at: a.outerKnee.clone().lerp(a.outerHip, 0.35), dir: legDir },
      share: { kind: 'push', at: a.outerFoot.clone().lerp(a.innerFoot, 0.5)
        .addScaledVector(s.normal, 0.26), dir: s.outward.clone() },
      fore: { kind: 'push', at: a.outerAnkle.clone().addScaledVector(s.normal, 0.14),
        dir: s.tangent.clone() },
    };
    if (a.innerHand && s.gatePos) {
      const toPole = s.gatePos.clone().addScaledVector(s.normal, 0.95).sub(a.innerHand);
      if (toPole.lengthSq() > 1e-6) {
        place.block = { kind: 'push', at: a.innerHand.clone(), dir: toPole.normalize() };
      }
    }

    this.active = [];
    let slot = 0;
    for (const r of rated) {
      if (slot >= this.shown) break;
      if (r.mag < 0.07) break;                 // 止まっているものは出さない
      const p = place[r.m.key];
      if (!p) continue;
      const sign = r.rate >= 0 ? 1 : -1;
      const text = sign > 0 ? r.m.up : r.m.dn;
      const S = this.slots[slot];
      const k = (0.62 + 0.55 * r.mag) * this.scale;

      let tip;
      if (p.kind === 'turn') {
        S.turn.visible = true; S.push.visible = false;
        S.turn.position.copy(p.at);
        S.turn.scale.setScalar(k);
        const axis = p.axis.clone().multiplyScalar(sign).normalize();
        orientY(S.turn, axis, s.tangent);
        // ラベルは弧のてっぺんあたり
        tip = p.at.clone().addScaledVector(axis, 0.02)
          .addScaledVector(new THREE.Vector3().crossVectors(axis, s.tangent).normalize(),
            0.18 * k);
      } else {
        S.turn.visible = false; S.push.visible = true;
        const dir = p.dir.clone().multiplyScalar(sign).normalize();
        // 矢印は付着部を中心に置く（根元から伸ばすと身体の外へ飛び出す）
        S.push.position.copy(p.at).addScaledVector(dir, -0.18 * k);
        S.push.scale.setScalar(k);
        orientY(S.push, dir, s.tangent);
        tip = p.at.clone().addScaledVector(dir, 0.20 * k);
      }
      this.active.push({ key: r.m.key, text, why: r.m.why, mag: r.mag, anchor: tip });
      slot++;
    }
    for (let i = slot; i < this.shown; i++) {
      this.slots[i].turn.visible = false;
      this.slots[i].push.visible = false;
    }
  }
}
