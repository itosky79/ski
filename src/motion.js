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
 * ■ 2 つの出し方（setMode）
 *   'rate'（くわしく・既定）: 上の「速さの順」。ただし 1 位はすぐには入れ替えない
 *       （sticky leader）。速さの順をそのまま出すと 1 ターンで 1 位が 8〜11 回、
 *       短いものは 0.04 秒で入れ替わり、読む前に消えていた。
 *       挑戦者が 1 位の 1.3 倍を位相 0.04 以上続け、かつ 1 位が 0.8 秒（実時間）以上
 *       出ていたときだけ入れ替える（どれも調整値）。
 *   'cue'（かんたん）: 局面ごとに決めた指示を 1 つだけ出す（constants.js の PHASES[].cue）。
 *       速さの順では、外向を<b>保つ</b>ような「止めておく」動きは速さ 0 なので決して
 *       1 位に来ない。山回りで「腰を起こして外傾をほどく」と、教えたいことの逆が出ていた。
 *       指示が変わるのは局面の境目だけ（1 ターン 5 回）。
 *
 * ■ 矢印の向き
 *   回転は右ねじ。軸は「その動作で増える向き」を作る軸を幾何から決める。
 *     腰を折る   : 軸 = 上 × 外側      （上体が外側へ倒れる回転）
 *     エッジ     : 軸 = 板の法線 × 内側（板が内側へ倒れる回転）
 *     骨盤の回旋 : 軸 = 上（外側が左なら +、右なら −）
 */
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/* ポール処理の言い方と、矢印を出す手（種目ごと）。
 *   SL : 外側の手で旗門を払う（クロスブロック）。外脚側の腕を胸の前へ伸ばして
 *        ポールを払う。いまの SL で一般的とされる処理（docs/REFERENCES.md 4.10。
 *        出典は Web 検索の要約だけで、映像では確かめていない）。
 *   GS : パネルが遠いので、たたくより内側の肩・腕で押しのける（constants.js の GS の設定と同じ考え）。
 *   side : 'outer' ＝外側の手、'inner' ＝内側の手。skier.state.blockSide があればそちらを優先。
 *   sub  : かんたん表示のフォールラインで、指示の下に添える一行（SL だけ）。
 * スキーヤー側が外側の手のクロスブロックになっていない版と組み合わせるときは、
 * SL の行を内側の手の言い方に戻すこと（この表の 1 行だけ）。 */
const BLOCK = {
  SL: { side: 'outer', up: '外側の手で旗門を払う（クロスブロック）', dn: '払った手を前へ戻す',
        sub: '＋ 外側の手で旗門を払う' },
  GS: { side: 'inner', up: '内側の肩・腕でパネルを押しのける', dn: '押しのけた腕を前へ戻す',
        sub: null },
};

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
    // 文言と手は種目で変わる（下の BLOCK 表。setDiscipline で切り替える）
    up: BLOCK.SL.up, dn: BLOCK.SL.dn,
    why: 'アルペンは全身。上体は伸びているのではなく、旗門を処理している。',
  },
  {
    key: 'spine', kind: 'turn', ref: 1.4,
    get: (s) => (s.counterSpine ?? s.counter) - s.counter,
    up: 'みぞおちを谷へ向ける', dn: '上体のひねりをほどく',
    why: '外向の約 2/3 は胸椎でつくる。腰だけでは回らない。',
  },
];

const MOVE_BY_KEY = Object.fromEntries(MOVES.map((m) => [m.key, m]));

/* 黄色は「いま、これをする」だけの色（ほかの表示では使わない約束）。
 * 2 位・3 位は同じ黄色の淡い色にする。別の色にすると別の意味に読まれる。 */
const COLOR = 0xffc93c;
const COLOR_SUB = 0xffe49e;

/* sticky leader（くわしく表示の 1 位）の入れ替え条件。調整値。 */
const LEAD_RATIO = 1.3;         // 挑戦者が 1 位の何倍なら入れ替え候補か
const LEAD_PHASE = 0.04;        // その状態が位相でこれだけ続いたら
const LEAD_DWELL = 0.8;         // 1 位は少なくともこれだけ出しておく [s・実時間]
const MAG_MIN = 0.07;           // これより遅い動きは「止まっている」とみなして出さない
const HOLD_SCALE = 0.9;         // 「保つ」指示の矢印の大きさ（速さで変えない）
const FADE_IN = 0.15;           // 指示が変わったときの矢印のフェードイン [s]
const WAIST_LIFT = 0.13;        // かんたん表示で骨盤まわりの矢印を上げる量 [m]（腸骨稜の少し上）

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

/**
 * 曲がった矢印（+y 軸まわりに反時計回り＝右ねじ、xz 平面上）。
 * 弧は +z（基準の向き：骨盤なら正面、腰を折るなら上）を中心に回り込み、
 * 矢じりは +z を lead だけ過ぎたところで +x 側（回る向き）を指す。
 * 「正面がどちらへ動くか」がそのまま矢じりの向きになる。
 * 以前は弧を +z 側に、矢じりを −z 側の鏡像の位置に置いていたので、
 * 矢じりが弧から離れ、しかも弧の流れと逆向きに見えていた。
 */
function curvedArrow(mat, R = 0.17, tube = 0.0135, arc = 2.2, lead = 0.35) {
  const g = new THREE.Group();
  const phi1 = Math.PI / 2 - lead;      // 矢じりの位置（+x から測った角度）
  const geo = new THREE.TorusGeometry(R, tube, 8, 40, arc);
  geo.rotateX(Math.PI / 2);             // xy 平面 → xz 平面：角度 u の点は (cos u, 0, sin u)
  geo.rotateY(-phi1);                   // u = 0 を φ1 へ（弧は φ1 … φ1 + arc）
  const ring = new THREE.Mesh(geo, mat);
  g.add(ring);
  const head = new THREE.Mesh(new THREE.ConeGeometry(tube * 3.0, tube * 7.5, 16), mat);
  // +y まわりの正の回転で点 (cos φ, 0, sin φ) が動く向きは (sin φ, 0, −cos φ)
  const dir = V(Math.sin(phi1), 0, -Math.cos(phi1));
  head.position.set(R * Math.cos(phi1), 0, R * Math.sin(phi1)).addScaledVector(dir, tube * 2.5);
  head.quaternion.setFromUnitVectors(V(0, 1, 0), dir);
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
   * @param {number} shown 同時に出す矢印の数（くわしく表示のとき）
   */
  constructor(scene, shown = 3) {
    this.shown = shown;
    this.group = new THREE.Group();
    this.group.name = 'motionGuide';
    scene.add(this.group);
    this.slots = [];
    for (let i = 0; i < shown; i++) {
      const col = i === 0 ? COLOR : COLOR_SUB;
      const mat = new THREE.MeshStandardMaterial({
        color: col, roughness: 0.35, metalness: 0.1,
        emissive: new THREE.Color(col).multiplyScalar(0.35),
        transparent: true, opacity: i === 0 ? 0.96 : 0.85,
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
      this.slots.push({ mat, turn, push, opacity: mat.opacity });
    }
    this.mats = this.slots.map((S) => S.mat);
    this.active = [];        // [{ key, text, short, why, hold, mag, anchor, sub? }]
    this.scale = 1;
    this.mode = 'rate';      // 'rate'（くわしく）| 'cue'（かんたん）
    this.block = BLOCK.SL;
    this.disc = 'SL';
    this.clock = 0;          // 実時間 [s]（dt を積算。dt が来なければ performance.now）
    this._lastNow = null;
    this._resetLeader();
    this.cueKey = null;      // かんたん表示でいま出している指示（フェードイン用）
    this.cueSince = 0;
  }

  setVisible(v) { this.group.visible = v; }
  setScale(k) { this.scale = k; }

  /** 'cue'＝局面ごとの指示を 1 つ（かんたん）、'rate'＝速さの順に 3 つ（くわしく） */
  setMode(m) {
    const mode = m === 'cue' ? 'cue' : 'rate';
    if (mode === this.mode) return;
    this.mode = mode;
    this._resetLeader();
    this.cueKey = null;
    this._hideFrom(0);
    this.active = [];
  }

  /** 種目でポール処理の言い方と手を変える（BLOCK 表） */
  setDiscipline(key) {
    this.disc = BLOCK[key] ? key : 'SL';
    this.block = BLOCK[this.disc];
    this._resetLeader();
  }

  _resetLeader() {
    this.leaderKey = null;   // 'pelvis+' のように key と向き。'none' は「何も出さない」
    this.leaderSince = 0;
    this.challengeFrom = null;
    this.lastPh = null;
  }

  _hideFrom(i) {
    for (; i < this.slots.length; i++) {
      this.slots[i].turn.visible = false;
      this.slots[i].push.visible = false;
    }
  }

  /** 実時間を進める。dt があればそれを積算し、なければ performance.now の差分 */
  _advance(dt) {
    if (typeof dt === 'number' && Number.isFinite(dt)) {
      this.clock += Math.max(0, dt);
      this._lastNow = null;
    } else {
      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      if (this._lastNow !== null) this.clock += Math.min(0.25, Math.max(0, now - this._lastNow));
      this._lastNow = now;
    }
    return this.clock;
  }

  /**
   * 矢印の置き場所。key の分だけ作る（かんたん表示では 1 つだけ）。
   * waist：かんたん表示では骨盤まわりの矢印を骨盤の少し上（腰の高さ）へ上げる。
   * 骨盤の中心に置くと、後ろから見て黄色い矢印が色分けした骨盤の上にちょうど重なり、
   * いちばん見せたい赤と緑を隠してしまう。
   */
  _place(key, s, a, st, waist = false) {
    const up = a.pelvisUp;
    switch (key) {
      case 'pelvis': case 'spine': {
        const outSign = a.pelvisRight.dot(s.outward) > 0 ? -1 : 1;
        const at = key === 'pelvis' ? a.pelvis : a.chest;
        return { kind: 'turn', at: waist ? at.clone().addScaledVector(up, WAIST_LIFT) : at,
          axis: up.clone().multiplyScalar(outSign) };
      }
      case 'fold':
        return { kind: 'turn', at: a.outerHip, axis: new THREE.Vector3().crossVectors(up, s.outward) };
      case 'edge':
        return { kind: 'turn', at: a.outerFoot,
          axis: new THREE.Vector3().crossVectors(a.skiNormal ?? s.normal, s.inward) };
      case 'leg':
        return { kind: 'push', at: a.outerKnee.clone().lerp(a.outerHip, 0.35),
          dir: a.outerHip.clone().sub(a.outerFoot).normalize() };
      case 'share':
        return { kind: 'push', at: a.outerFoot.clone().lerp(a.innerFoot, 0.5)
          .addScaledVector(s.normal, 0.26), dir: s.outward.clone() };
      case 'fore':
        return { kind: 'push', at: a.outerAnkle.clone().addScaledVector(s.normal, 0.14),
          dir: s.tangent.clone() };
      case 'cross':
        // 切り替え：身体（骨盤）がスキーの上を越えて、次のターンの内側へ
        return { kind: 'push', at: waist ? a.pelvis.clone().addScaledVector(up, WAIST_LIFT) : a.pelvis,
          dir: s.inward.clone() };
      case 'block': {
        const side = st.blockSide ?? this.block.side;
        const hand = side === 'outer' ? (a.outerHand ?? a.innerHand) : a.innerHand;
        if (!hand || !s.gatePos) return null;
        const toPole = (s.gateContact
          ? s.gateContact.clone() : s.gatePos.clone().addScaledVector(s.normal, 0.95)).sub(hand);
        if (toPole.lengthSq() < 1e-6) return null;
        return { kind: 'push', at: hand.clone(), dir: toPole.normalize() };
      }
      default: return null;
    }
  }

  /** 1 本の矢印を置いて、ラベルの位置を返す */
  _draw(S, p, sign, k, s) {
    if (p.kind === 'turn') {
      S.turn.visible = true; S.push.visible = false;
      S.turn.position.copy(p.at);
      S.turn.scale.setScalar(k);
      const axis = p.axis.clone().multiplyScalar(sign).normalize();
      orientY(S.turn, axis, s.tangent);
      // ラベルは弧のてっぺんあたり
      return p.at.clone().addScaledVector(axis, 0.02)
        .addScaledVector(new THREE.Vector3().crossVectors(axis, s.tangent).normalize(),
          0.18 * k);
    }
    S.turn.visible = false; S.push.visible = true;
    const dir = p.dir.clone().multiplyScalar(sign).normalize();
    // 矢印は付着部を中心に置く（根元から伸ばすと身体の外へ飛び出す）
    S.push.position.copy(p.at).addScaledVector(dir, -0.18 * k);
    S.push.scale.setScalar(k);
    orientY(S.push, dir, s.tangent);
    return p.at.clone().addScaledVector(dir, 0.20 * k);
  }

  _text(m, sign) {
    if (m.key === 'block') return sign > 0 ? this.block.up : this.block.dn;
    return sign > 0 ? m.up : m.dn;
  }

  /**
   * @param {Object} s     いまのサンプル
   * @param {Object} sNext 少し先のサンプル
   * @param {number} dPhase 位相の刻み
   * @param {Object} st    skier.state（anchors を使う）
   * @param {number} [dt]  前のフレームからの実時間 [s]（なければ performance.now で測る）
   */
  update(s, sNext, dPhase, st, dt) {
    const t = this._advance(dt);
    const a = st.anchors;
    if (!a || !a.pelvis) { this.active = []; this._hideFrom(0); return; }
    if (this.mode === 'cue') this._updateCue(s, sNext, dPhase, st, a, t);
    else this._updateRate(s, sNext, dPhase, st, a, t);
  }

  /* ---------------- かんたん：局面ごとの指示を 1 つ ---------------- */
  _updateCue(s, sNext, dPhase, st, a, t) {
    const cue = s.phaseInfo?.cue;
    const p = cue ? this._place(cue.move, s, a, st, true) : null;
    if (!p) { this.active = []; this._hideFrom(0); return; }

    const m = MOVE_BY_KEY[cue.move];
    // 指示の向きに実際どれだけ動いているか（逆向きなら 0）。矢印の大きさにだけ使う
    let mag = 1;
    if (m) mag = THREE.MathUtils.clamp(cue.sign * (m.get(sNext) - m.get(s)) / dPhase / m.ref, 0, 1);
    const k = (cue.hold || !m ? HOLD_SCALE : 0.62 + 0.55 * mag) * this.scale;
    // 「次の内側へ」は身体から内側へ伸ばす（中心に置くと半分が外側に出て、向きが読めない）
    if (cue.move === 'cross') p.at.addScaledVector(p.dir, 0.18 * k * cue.sign);

    // 指示が変わったら矢印をふわっと出す（局面の境目で矢印が飛ぶのを和らげる）
    const key = s.phaseInfo.name;
    if (key !== this.cueKey) { this.cueKey = key; this.cueSince = t; }
    const S = this.slots[0];
    S.mat.opacity = S.opacity * THREE.MathUtils.clamp((t - this.cueSince) / FADE_IN, 0.15, 1);

    const tip = this._draw(S, p, cue.sign, k, s);
    this._hideFrom(1);
    this.active = [{
      key: cue.move, text: cue.text, short: cue.short ?? cue.text, why: cue.why ?? m?.why ?? '',
      hold: !!cue.hold, mag: cue.hold ? 1 : mag, anchor: tip,
      sub: cue.block ? this.block.sub : null,
    }];
  }

  /* ---------------- くわしく：速さの順に 3 つ（1 位は粘る） ---------------- */
  _updateRate(s, sNext, dPhase, st, a, t) {
    this.slots[0].mat.opacity = this.slots[0].opacity;

    /* --- 各動作の速さ（位相あたりの変化を基準値で割ったもの） --- */
    const rated = MOVES.map((m) => {
      const rate = (m.get(sNext) - m.get(s)) / dPhase / m.ref;
      return { m, rate, mag: Math.min(1, Math.abs(rate)), p: null };
    }).sort((x, y) => y.mag - x.mag);
    for (const r of rated) r.p = this._place(r.m.key, s, a, st);

    /* --- 1 位を決める（sticky leader） ---
     * 位相が大きく飛んだ（スクラブ・コースの先頭に戻った）ときは粘らずに選び直す。 */
    const ph = (s.cycle ?? 0) + s.phase;
    if (this.lastPh === null || Math.abs(ph - this.lastPh) > 0.15) this.leaderKey = null;
    this.lastPh = ph;
    const idOf = (r) => r.m.key + (r.rate >= 0 ? '+' : '-');
    let best = null;
    for (const r of rated) { if (r.p) { best = r; break; } }
    const bestId = best && best.mag >= MAG_MIN ? idOf(best) : 'none';
    const bestMag = best && best.mag >= MAG_MIN ? best.mag : MAG_MIN;
    let lead = null;
    if (this.leaderKey && this.leaderKey !== 'none') {
      const lk = this.leaderKey.slice(0, -1);
      lead = rated.find((r) => r.m.key === lk && r.p) ?? null;
      if (!lead) this.leaderKey = null;           // 置き場所が消えた（旗門がない等）
    }
    if (this.leaderKey === null) {
      this.leaderKey = bestId; this.leaderSince = t; this.challengeFrom = null;
    } else if (bestId !== this.leaderKey) {
      // 1 位のいまの強さ（向きが逆になっていたら 0 とみなす）
      let cur = MAG_MIN;
      if (this.leaderKey !== 'none') cur = idOf(lead) === this.leaderKey ? lead.mag : 0;
      if (bestMag > LEAD_RATIO * cur) {
        if (this.challengeFrom === null) this.challengeFrom = ph;
        if (ph - this.challengeFrom >= LEAD_PHASE && t - this.leaderSince >= LEAD_DWELL) {
          this.leaderKey = bestId; this.leaderSince = t; this.challengeFrom = null;
        }
      } else this.challengeFrom = null;
    } else this.challengeFrom = null;

    this.active = [];
    if (this.leaderKey === 'none') { this._hideFrom(0); return; }
    const lk = this.leaderKey.slice(0, -1);
    const leadSign = this.leaderKey.endsWith('+') ? 1 : -1;
    lead = rated.find((r) => r.m.key === lk);

    let slot = 0;
    const put = (r, sign) => {
      const S = this.slots[slot];
      const k = (0.62 + 0.55 * r.mag) * this.scale;
      const tip = this._draw(S, r.p, sign, k, s);
      const text = this._text(r.m, sign);
      this.active.push({ key: r.m.key, text, short: text, why: r.m.why, hold: false,
        mag: r.mag, anchor: tip });
      slot++;
    };
    put(lead, leadSign);
    for (const r of rated) {
      if (slot >= this.shown) break;
      if (r.mag < MAG_MIN) break;                 // 止まっているものは出さない
      if (!r.p || r.m.key === lk) continue;
      put(r, r.rate >= 0 ? 1 : -1);
    }
    this._hideFrom(slot);
  }
}
