/**
 * kinematics.js — ターンの軌跡と力学
 *
 * 座標系（three.js 右手系、Y が鉛直上向き）
 *   D : フォールライン方向の単位ベクトル = (0, -sinθ, -cosθ)
 *   C : 斜面を横切る方向             = (1, 0, 0)
 *   N : 斜面法線                     = (0,  cosθ, -sinθ)
 *   斜面上の点 P(u, w) = u·D + w·C
 *
 * 軌跡（両スキーの中心線）
 *   w(u) = A·sin(2πu/L)     A = 振り幅（片振幅）、L = 波長 = ポール間隔 × 2
 *   変曲点（w=0）＝切り替え、頂点（|w|=A）＝フォールライン通過
 *
 * ■ 力学（準静的モデル）
 *   加速度 a は軌跡の曲率から求まる。ニュートンの法則より
 *       F_snow = m (a − g)
 *   剛体の回転平衡から F_snow の作用線は「接雪点 → 重心」に一致する。
 *   → 内傾角 λ は自分で選べない。速度と半径と斜度で決まる。
 *
 * ■ 外傾（腰の横曲げ）がエッジ角を作るしくみ
 *   前額面（進行方向に垂直な面）で
 *       脚の傾き   φ_leg
 *       上体の傾き φ_torso = φ_leg − α      （α ＝ 外傾角）
 *   重心は下肢と上体の質量加重平均なので、上体を起こす（α を大きくする）と
 *   同じ内傾角 λ を保つために脚はより倒れる。つまり
 *       エッジ角 ψ = φ_leg + 膝の角度 > λ
 *   「身体を倒さずにエッジを立てる」ことが外傾の力学的な意味になる。
 */
import * as THREE from 'three';
import { G, PHASES, SEGMENT_MASS } from './constants.js';

const TAU = Math.PI * 2;
const smoothstep = (e0, e1, x) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const deg = (r) => r * 180 / Math.PI;
export const rad = (d) => d * Math.PI / 180;

/* 前額面モデルの質量配分（Dempster） */
const M_LOWER = 2 * (SEGMENT_MASS.thigh + SEGMENT_MASS.shank + SEGMENT_MASS.foot);  // 両脚
const M_UPPER = SEGMENT_MASS.trunkHead + 2 * (SEGMENT_MASS.upperArm + SEGMENT_MASS.foreArmHand);

export class TurnModel {
  constructor(params) {
    this.p = Object.assign({
      slopeDeg: 20,
      speedKmh: 45,
      gateSpacing: 11,
      offset: 1.5,
      gateWidth: 5,
      counterDeg: 30,
      angulationDeg: 24,
      kneeAngulationDeg: 8,
      stanceWidth: 0.26,
      innerLead: 0.16,
      height: 1.75,
      mass: 75,
      skiSidecutR: 12.8,
      poleClearance: 0.35,
      // 重力の斜面方向成分のうち、加速に使われる割合（残りはエッジで受け止める）。
      // 1 なら自由滑降＝身体は斜面に垂直、0 なら等速＝身体は斜面の角度ぶん後ろに残る。
      glideFactor: 0.45,
      // 前後のポジションの変化。ターン前半は加速して身体が前に、
      // 後半はエッジで減速して後ろに残る。実際のレーサーも同じように前後に動く。
      glideAmp: 0.30,
      // 軌跡のゆがみ。0 なら左右対称の正弦波。正の値で「方向転換を旗門の上で終える」
      // 現代のライン取りになる（前半がきつく、後半は伸びる）。
      skew: 0.03,
      // 旗門を軌跡の頂点よりどれだけ下に置くか（1 ターンに対する割合）
      gateLag: 0.09,
      // 外脚の荷重配分：フォールライン付近の最大値と、山回り後半の値
      outerShareMax: 0.80,
      outerShareLate: 0.60,
      // 外向の作られ方（幾何ぶん × gamma ＋ 意識的なぶん × active）
      gammaPelvis: 0.55, activePelvis: 0.25,
      gammaSpine: 1.15, activeSpine: 0.45,
      // 内スキーは外スキーより少し多く傾ける
      innerEdgeExtraDeg: 5,
      // トップの前後差（ステップ量）は、スタンス幅とエッジ角から決まる
      leadFactor: 0.35,
      // 内足の先行が骨盤の向きに伝わる割合（残りは膝と股関節が吸収する）
      leadToPelvis: 0.30,
      // 重心をブーツ中心のどれだけ前に置くか [m]。位相で変わる（前半は前、後半は少し戻す）。
      // これを決めると、力の釣り合いから圧の中心（CP）が板のどこに乗るかが決まる。
      foreTarget: 0.01,
      foreAmp: 0.05,
      /* --- ポール処理 ---
       * SL はターニングポールを手・前腕・すねではたいて通る（ブロッキング）。
       * GS はパネルが遠いので、たたくというより肩でよける。
       * blockSigmaBefore/After: 旗門までの距離（m）に対する効き方の広がり。
       *   近づくときはゆっくり、通り過ぎたら素早く戻すので前後で非対称。
       * blockStrength : 手をポールまで出す割合（1 = ポールに触れる）
       * blockHeight   : ポールのどの高さをたたくか（雪面から m） */
      blockSigmaBefore: 1.30,
      blockSigmaAfter: 0.55,
      blockStrength: 1.0,
      blockHeight: 0.95,
    }, params);
    this.rebuild();
  }

  set(params) { Object.assign(this.p, params); this.rebuild(); }

  rebuild() {
    const th = rad(this.p.slopeDeg);
    this.D = new THREE.Vector3(0, -Math.sin(th), -Math.cos(th));
    this.C = new THREE.Vector3(1, 0, 0);
    this.N = new THREE.Vector3(0, Math.cos(th), -Math.sin(th));
    this.slopeRad = th;

    this.L = this.p.gateSpacing * 2;
    this.A = this.p.offset;
    this.k = TAU / this.L;
    this.v = this.p.speedKmh / 3.6;
    this.halfCycle = this.L / 2;          // 1 ターンの進行距離

    // 1 ターンを走査して正規化に使う最小・最大値を得る
    const NS = 121;
    let loadMin = Infinity, loadMax = -Infinity, rMin = Infinity, shapeMax = 1e-6;
    const raw = [];
    for (let i = 0; i < NS; i++) {
      const d = this._dynamics((i / (NS - 1)) * this.halfCycle);
      raw.push(d);
      loadMin = Math.min(loadMin, d.loadBW);
      loadMax = Math.max(loadMax, d.loadBW);
      rMin = Math.min(rMin, d.radius);
    }
    this.loadMin = loadMin; this.loadMax = loadMax; this.radiusMin = rMin;
    this.geomMax = Math.max(...raw.map((d) => Math.abs(d.counterGeom)), 1e-6);
    for (let i = 0; i < raw.length; i++) {
      const ph = i / (NS - 1);
      // 絶対値で正規化する。外向は前半が負・後半が正の非対称な形なので、
      // 片側だけ見て正規化すると振幅が counterDeg に届かない。
      shapeMax = Math.max(shapeMax,
        Math.abs(this._counterShape(raw[i], ph, this._leadYaw(raw[i], ph)).pelvis));
    }
    this.counterShapeMax = Math.max(shapeMax, 1e-6);
  }

  /**
   * その位相でのスタンス幅・内足の先行量・足のラインの角度を返す。
   * どれもエッジ角から決まる「結果」であって、意識して作る量ではない。
   */
  /**
   * スタンス幅とトップの前後差。
   *
   * 見ているのは「板がどれだけ傾いているか」なので<b>エッジ角の絶対値</b>を使う。
   * 符号（どちらのエッジに乗っているか）で場合分けすると、
   * 切り替えでエッジ角の符号が変わった瞬間にスタンスが跳ぶ。
   */
  _footGeom(edgeAngle) {
    const P = this.p;
    const e = Math.min(Math.abs(edgeAngle), rad(78));
    const stance = P.stanceWidth * (0.72 + 0.48 * Math.sin(e));
    const lead = Math.min(0.32, stance * Math.tan(e) * P.leadFactor);
    return { stance, lead, yaw: Math.atan2(lead, stance) };
  }

  /** 荷重から推定したエッジ角で足元の角度を求める（正規化用の近似） */
  _leadYaw(d, phase) {
    const alpha = rad(this.p.angulationDeg) * Math.pow(
      THREE.MathUtils.clamp((d.loadBW - this.loadMin) / Math.max(1e-6, this.loadMax - this.loadMin), 0, 1), 0.75);
    const legLen = this.p.height * 0.46, torsoLen = this.p.height * 0.288;
    const fr = this.solveFrontal(d.lambda, alpha, legLen, torsoLen);
    return this._footGeom(fr.phiLeg).yaw;
  }

  /**
   * 外向の形。骨盤と上体（肩）で大きさが違う。
   *   幾何ぶん  : 身体はフォールラインを向き続けるので、スキーとの差がそのまま外向になる
   *   意識ぶん  : 山回りでさらに骨盤を外へ向ける動き（後半で立ち上がる）
   */
  /**
   * 外向の形。
   *   幾何ぶん g : スキーとフォールラインのずれ。ターンの向きで符号が変わる。
   *   意識ぶん act: 山回りで自分から作る（＝筋でひねる）ぶん。符号を持たない。
   *   足元ぶん   : 内足が前に出たぶん骨盤も引っぱられる。符号を持たない。
   *
   * 符号を持たない 2 つは、<b>切り替えまでに 0 へ戻して</b>おかないといけない。
   * 外向は「いまのターンの外側はどちらか」を基準に測る量なので、
   * 切り替えでその基準が裏返る。基準が裏返る瞬間に 0 でない値が残っていると、
   * 身体は動いていないのに骨盤の向きが跳ぶ（実際に 7°ほど跳んでいた）。
   * ひねりを切り替えでほどくのは、滑りとしても正しい。
   */
  _counterShape(d, phase, leadYaw = 0) {
    const P = this.p;
    const g = d.counterGeom;
    // 切り替えの前後どちらでも 0 にする（片側だけだと裏返る瞬間に跳ぶ）
    const rel = smoothstep(0.00, 0.14, phase) * (1 - smoothstep(0.86, 1.00, phase));
    const act = smoothstep(0.15, 0.78, phase) * this.geomMax * rel;
    const ly = leadYaw * rel;
    return {
      pelvis: P.gammaPelvis * g + P.activePelvis * act + P.leadToPelvis * ly,
      spine: P.gammaSpine * g + P.activeSpine * act + P.leadToPelvis * 0.6 * ly,
    };
  }

  /* ---------- 軌跡 ----------
   * θ(u) = k·u + ε·sin(2k·u) と位相をゆがませることで、
   * 左右の対称性を保ったまま「前半がきつく後半が伸びる」弧にする。
   * ε = 0 なら従来どおりの正弦波。 */
  theta(u)  { return this.k * u + this.p.skew * Math.sin(2 * this.k * u); }
  dtheta(u) { return this.k * (1 + 2 * this.p.skew * Math.cos(2 * this.k * u)); }
  ddtheta(u) { return -4 * this.k * this.k * this.p.skew * Math.sin(2 * this.k * u); }
  w(u)   { return this.A * Math.sin(this.theta(u)); }
  dw(u)  { return this.A * Math.cos(this.theta(u)) * this.dtheta(u); }
  ddw(u) {
    const th = this.theta(u), d = this.dtheta(u);
    return -this.A * Math.sin(th) * d * d + this.A * Math.cos(th) * this.ddtheta(u);
  }

  onSlope(u, w, lift = 0) {
    return new THREE.Vector3()
      .addScaledVector(this.D, u)
      .addScaledVector(this.C, w)
      .addScaledVector(this.N, lift);
  }
  trackPoint(u, lift = 0) { return this.onSlope(u, this.w(u), lift); }

  /* ---------- 力学（内部） ---------- */
  _dynamics(u) {
    const w1 = this.dw(u), w2 = this.ddw(u);
    const den = 1 + w1 * w1;

    const tangent = new THREE.Vector3()
      .addScaledVector(this.D, 1).addScaledVector(this.C, w1).normalize();

    // 斜面内で進行方向に垂直な単位ベクトル（符号は連続）
    const eLat = new THREE.Vector3()
      .addScaledVector(this.D, -w1).addScaledVector(this.C, 1).normalize();

    // 符号つき曲率（+ は eLat 側へ曲がる）
    const kappa = w2 / Math.pow(den, 1.5);
    const radius = Math.abs(kappa) > 1e-6 ? 1 / Math.abs(kappa) : Infinity;
    // ターン方向は「いま何ターン目か」で決める（変曲点でも符号が揺れない）
    const cycle = Math.floor(u / this.halfCycle + 1e-9);
    const turnSign = (((cycle % 2) + 2) % 2 === 0) ? -1 : 1;   // +1: eLat 側がターン内側

    // 求心加速度
    const accel = eLat.clone().multiplyScalar(this.v * this.v * kappa);
    // 進行方向の加速度：重力の斜面成分のうち glide ぶんが加速に回る。
    // glide は位相で変わる（前半は加速＝前に乗る、後半は減速＝後ろに残る）。
    const phase = (((u % this.halfCycle) + this.halfCycle) % this.halfCycle) / this.halfCycle;
    const glide = this.p.glideFactor
      + this.p.glideAmp * Math.cos(TAU * (phase - 0.25));
    const gAlong = G * Math.sin(this.slopeRad) / Math.sqrt(den);
    accel.addScaledVector(tangent, glide * gAlong);

    // 雪面反力（単位質量）
    const gVec = new THREE.Vector3(0, -G, 0);
    const fPerMass = accel.clone().sub(gVec);
    const loadBW = fPerMass.length() / G;
    const uLeg = fPerMass.clone().normalize();        // 接雪点 → 重心

    const inward = eLat.clone().multiplyScalar(turnSign);   // ターン内側（斜面内）
    const outward = inward.clone().negate();                // ターン外側
    // 内傾角：前額面で見た「脚の線」と斜面法線のなす角（+ が内側）
    const lambda = Math.atan2(uLeg.dot(inward), uLeg.dot(this.N));
    const turnAngle = Math.abs(Math.atan(w1));        // スキーとフォールラインの角度
    // 符号つきの「スキーとフォールラインのずれ」。
    // ターン前半は負（上体はまだ次のターンの内側を向いている）、
    // フォールラインで 0、後半で正（＝外向）になる。身体はフォールラインを向き続けるので、
    // この量がそのまま外向の素になる。
    const counterGeom = Math.atan(w1) * turnSign;

    return { u, cycle, tangent, eLat, inward, outward, kappa, radius, turnSign, accel,
             fPerMass, loadBW, uLeg, lambda, turnAngle, counterGeom, glide };
  }

  /**
   * 前額面の姿勢を解く。
   * 与えられた内傾角 λ と外傾角 α に対し、質量加重重心が λ の線上に来るような
   * 脚の傾き φ_leg を二分法で求める。戻り値の comDist は接雪点から重心までの距離。
   */
  solveFrontal(lambda, alpha, legLen, torsoLen) {
    const cLow = 0.45 * legLen;             // 下肢重心（接雪点から）
    const cUp = 0.58 * torsoLen;            // 上体重心（股関節から）
    const angleOf = (phiLeg) => {
      const phiT = phiLeg - alpha;
      const x = M_LOWER * cLow * Math.cos(phiLeg)
              + M_UPPER * (legLen * Math.cos(phiLeg) + cUp * Math.cos(phiT));
      const y = M_LOWER * cLow * Math.sin(phiLeg)
              + M_UPPER * (legLen * Math.sin(phiLeg) + cUp * Math.sin(phiT));
      return { ang: Math.atan2(y, x), dist: Math.hypot(x, y) / (M_LOWER + M_UPPER) };
    };
    let lo = lambda - 0.1, hi = lambda + alpha + 0.2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (angleOf(mid).ang < lambda) lo = mid; else hi = mid;
    }
    const phiLeg = (lo + hi) / 2;
    const r = angleOf(phiLeg);
    return { phiLeg, phiTorso: phiLeg - alpha, comDist: r.dist };
  }

  /* ---------- 公開 API ---------- */
  sample(u) {
    const d = this._dynamics(u);
    const P = this.p;

    const loadNorm = THREE.MathUtils.clamp(
      (d.loadBW - this.loadMin) / Math.max(1e-6, this.loadMax - this.loadMin), 0, 1);

    /* 曲率がほぼ 0 の窓＝切り替え。ここでは「ターンのために」する動きが
     * すべて意味を失う（曲がっていないのだから外側も内側もない）。
     * 外傾も膝の傾けも内傾もこの窓で 0 へ寄せる。そうしないと、
     * 基準が裏返る瞬間に「外側へ折った 7°」が一気に反対側へ飛ぶ。 */
    const kn = Math.min(1, Math.abs(d.kappa) * this.radiusMin);   // 曲率（0〜1）
    const flat = Math.exp(-((kn / 0.11) ** 2));
    const turning = 1 - 0.97 * flat;

    // 外傾角・膝の角度は荷重に応じて深くなる
    const angulation = rad(P.angulationDeg) * Math.pow(loadNorm, 0.75) * turning;
    const kneeAng = rad(P.kneeAngulationDeg) * Math.pow(loadNorm, 0.75) * turning;

    // 脚の長さ（接雪点→股関節）。荷重が高いほど伸ばす
    const legLen = P.height * (0.455 + 0.075 * loadNorm);
    const torsoLen = P.height * 0.288;

    /* --- 切り替えでは板はフラットを通る ---
     * 準静的な釣り合いだけで内傾角を決めると、切り替えの瞬間でも
     * 「脚の線＝力の線＝ほぼ鉛直」になる。斜面をナナメに横切っている間、
     * 鉛直に立つと板は斜度の横成分ぶん（ここでは約 8.5°）エッジが立ったままで、
     * しかもターンの内外が裏返るので、17° の持ち替えが一瞬で起きてしまう。
     *
     * 実際の切り替えは、身体が板を乗り越えていく間に板が<b>フラットを通る</b>。
     * 曲がっていない瞬間は求心力の要求が 0 で、そもそも横に傾く理由がない。
     * そこで<b>曲率がほぼ 0 の窓でだけ</b>脚の線を斜面法線へ寄せる。
     * 曲率がある間（＝釣り合いの主張が効く間）は何も変えない。 */
    const lambda = d.lambda * turning;

    const fr = this.solveFrontal(lambda, angulation, legLen, torsoLen);

    // 3D 姿勢ベクトル：uLeg を進行方向軸まわりに回して脚・上体の向きを作る
    const axis = d.tangent;
    const legDir = rotateToward(d.uLeg, d.inward, axis, fr.phiLeg - lambda);
    const torsoDir = rotateToward(d.uLeg, d.inward, axis, fr.phiTorso - lambda);

    /* 膝の傾け（ニーアンギュレーション）は、いま乗っているエッジをさらに立てる。
     * 符号をそのまま足すと、切り替えでエッジの向きが変わったとき
     * 「エッジ角の大きさ」が跳ぶ。tanh でなめらかな符号にして足す。 */
    const edgeSign = Math.tanh(fr.phiLeg / rad(4));
    const edgeAngle = fr.phiLeg + kneeAng * edgeSign;       // 外スキーのエッジ角
    const edgeAngleInner = edgeAngle
      + rad(P.innerEdgeExtraDeg) * loadNorm * edgeSign;
    const ratio = THREE.MathUtils.clamp(d.radius / P.skiSidecutR, 0, 1);
    const edgeNeeded = Math.acos(ratio);              // サイドカット理論の必要エッジ角
    const carving = edgeAngle >= edgeNeeded - rad(2);

    /* --- 足もと ---
     * スタンス幅とトップの前後差（内スキーの先行）は、意識して作るものではなく
     * エッジ角の結果として現れる。エッジが寝れば自然に消える。 */
    const phase0 = (((u % this.halfCycle) + this.halfCycle) % this.halfCycle) / this.halfCycle;
    const fg = this._footGeom(edgeAngle);
    const stance = fg.stance;
    const innerLead = fg.lead;

    /* --- 外向角 ---
     * 幾何ぶん（身体は谷を向き続ける）＋ 意識ぶん（山回りで作る）
     * ＋ 足元ぶん（内足が前に出たぶん骨盤も引っぱられる）*/
    const cs = this._counterShape(d, phase0, fg.yaw);
    const counter = rad(P.counterDeg) * cs.pelvis / this.counterShapeMax;
    const counterSpine = rad(P.counterDeg) * cs.spine / this.counterShapeMax;

    const trackCenter = this.trackPoint(u);
    const half = stance / 2;
    const footR = trackCenter.clone().addScaledVector(d.eLat, half);   // 右足（進行方向に対して右）
    const footL = trackCenter.clone().addScaledVector(d.eLat, -half);

    /* 外脚の荷重配分：切り替えで 50 %、フォールライン手前で最大、
       山回り後半は内スキーにも乗るので下がる（実測でも 80:20 → 60:40） */
    /* 切り替えの瞬間は必ず 50:50。外脚・内脚の区別そのものが入れ替わるので、
     * ここで 60:40 のまま残すと「同じ脚の荷重が 0.60 から 0.40 へ跳ぶ」ことになり、
     * 脚も手も一瞬カクつく。山回り後半の 60:40 は、戻り方の途中として出す。 */
    const rise = smoothstep(0.02, 0.40, phase0);
    const fall = smoothstep(0.50, 1.00, phase0);
    const outerShare = 0.5 + (P.outerShareMax - 0.5) * rise * (1 - fall);
    const lateralCp = trackCenter.clone()
      .addScaledVector(d.outward, half * (2 * outerShare - 1));

    /* --- 圧の中心（CP）の前後位置 ---
     * 身体の前後位置（重心をブーツのどれだけ前に置くか）を決めると、
     * 「雪面反力の作用線は接雪点と重心を結ぶ」という条件から
     * 圧が板のどこに乗るかが決まる。エッジで強く減速するほど圧はトップへ寄る。 */
    const foreTarget = P.foreTarget + P.foreAmp * Math.cos(TAU * (phase0 - 0.25));
    const foreShift = foreTarget - fr.comDist * d.uLeg.dot(d.tangent);
    const pressure = lateralCp.clone().addScaledVector(d.tangent, foreShift);

    const com = pressure.clone().addScaledVector(d.uLeg, fr.comDist);
    const hip = pressure.clone().addScaledVector(legDir, legLen);      // 骨盤中心
    const outerFoot = d.eLat.dot(d.outward) > 0 ? footR : footL;
    const innerFoot = d.eLat.dot(d.outward) > 0 ? footL : footR;
    const outerIsRight = d.eLat.dot(d.outward) > 0;

    const phase = (((u % this.halfCycle) + this.halfCycle) % this.halfCycle) / this.halfCycle;

    /* --- ポール処理 ---
     * いま向かっているターニングポールまでの距離（進行方向に沿った m）から、
     * 「手をポールへ出している度合い」を 0〜1 で出す。
     * 近づくときはゆっくり、通り過ぎたら素早く戻すので前後で非対称にしてある。 */
    const pole = this.turningPole(d.cycle);
    const gateDu = u - pole.u;
    /* σ を前後で切り替えると、ちょうど旗門のところで折れる（2 階微分が飛ぶ）。
     * σ 自体を tanh でなめらかにつなぐと、窓全体が C∞ になる。 */
    const sig = P.blockSigmaBefore
      + (P.blockSigmaAfter - P.blockSigmaBefore) * 0.5 * (1 + Math.tanh(gateDu / 0.45));
    const gateBlock = Math.exp(-((gateDu / sig) ** 2)) * P.blockStrength;

    return {
      gateDu, gateBlock,
      gatePos: pole.pos,
      gateContact: pole.pos.clone().addScaledVector(this.N, P.blockHeight),
      u, phase, phaseInfo: phaseInfo(phase), cycle: d.cycle,
      pos: trackCenter, pressure, com, hip, legLen, torsoLen,
      footL, footR, outerFoot, innerFoot, outerIsRight, outerShare,
      outerShareMax: P.outerShareMax,
      stance, innerLead, edgeAngleInner, counterSpine,
      cpOffset: foreShift,            // ブーツ中心から前へ何 m か
      comFore: foreTarget,            // 重心のブーツからの前後位置 [m]
      forceOuter: d.fPerMass.clone().multiplyScalar(P.mass * outerShare),
      forceInner: d.fPerMass.clone().multiplyScalar(P.mass * (1 - outerShare)),
      tangent: d.tangent, eLat: d.eLat, inward: d.inward, outward: d.outward,
      turnSign: d.turnSign,
      normal: this.N, fallLine: this.D,
      radius: d.radius, accel: d.accel, loadBW: d.loadBW, loadNorm, uLeg: d.uLeg,
      legDir, torsoDir,
      inclination: lambda, counter, angulation, kneeAng,
      phiLeg: fr.phiLeg, phiTorso: fr.phiTorso,
      edgeAngle, edgeNeeded, carving, turnAngle: d.turnAngle,
      speed: this.v, gForce: d.accel.length() / G,
      forces: {
        gravity: new THREE.Vector3(0, -G * P.mass, 0),
        snow: d.fPerMass.clone().multiplyScalar(P.mass),
        centrifugal: d.accel.clone().multiplyScalar(-P.mass),
      },
    };
  }

  uFromPhase(phase, cycle = 0) { return (phase + cycle) * this.halfCycle; }

  /* ---------- 旗門 ---------- */
  /**
   * その周回のターニングポール（u と位置）。gates() と同じ式で 1 本だけ求める。
   * @param {number} cycle 何ターン目か
   */
  turningPole(cycle) {
    const uApex = this.L / 4 + cycle * this.halfCycle;
    const u = uApex + this.p.gateLag * this.halfCycle;
    const side = Math.sign(Math.sin(this.theta(uApex))) || 1;
    const wTurn = side * Math.max(0.1, Math.abs(this.w(u)) - this.p.poleClearance);
    return { u, side, wTurn, pos: this.onSlope(u, wTurn) };
  }

  gates(count = 8, startCycle = 0) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const cycle = startCycle + i;
      // 現代のライン取りでは方向転換を旗門の上で終えるので、
      // 旗門は軌跡の頂点より少し下に立つ
      const uApex = this.L / 4 + cycle * this.halfCycle;
      const u = uApex + this.p.gateLag * this.halfCycle;
      const s = Math.sign(Math.sin(this.theta(uApex))) || 1;
      const wTurn = s * Math.max(0.1, Math.abs(this.w(u)) - this.p.poleClearance);
      out.push({
        index: cycle, u, side: s,
        color: (((cycle % 2) + 2) % 2 === 0) ? 'red' : 'blue',
        turning: this.onSlope(u, wTurn),
        outer: this.onSlope(u, wTurn + s * this.p.gateWidth),
        wTurn,
      });
    }
    return out;
  }

  poleToPoleDistance() {
    const g = this.gates(2, 0);
    return g[0].turning.distanceTo(g[1].turning);
  }
}

/**
 * base を axis まわりに回して、inward 方向へ delta [rad] 倒す。
 * delta が負なら inward と逆向きへ倒す（外傾で上体を起こす場合など）。
 */
function rotateToward(base, inward, axis, delta) {
  const eps = 1e-3;
  const probe = base.clone().applyAxisAngle(axis, eps);
  const sign = probe.dot(inward) > base.dot(inward) ? 1 : -1;
  return base.clone().applyAxisAngle(axis, sign * delta);
}

export function phaseInfo(phase) {
  const p = THREE.MathUtils.clamp(phase, 0, 0.9999);
  return PHASES.find((x) => p >= x.from && p < x.to) || PHASES[PHASES.length - 1];
}
