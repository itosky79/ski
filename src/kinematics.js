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
    for (const d of raw) {
      const ln = (d.loadBW - loadMin) / Math.max(1e-6, loadMax - loadMin);
      shapeMax = Math.max(shapeMax, d.turnAngle * (0.55 + 0.45 * ln));
    }
    this.counterShapeMax = shapeMax;
  }

  /* ---------- 軌跡 ---------- */
  w(u)   { return this.A * Math.sin(this.k * u); }
  dw(u)  { return this.A * this.k * Math.cos(this.k * u); }
  ddw(u) { return -this.A * this.k * this.k * Math.sin(this.k * u); }

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

    return { u, cycle, tangent, eLat, inward, outward, kappa, radius, turnSign, accel,
             fPerMass, loadBW, uLeg, lambda, turnAngle };
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

    // 外向角：骨盤はスキーほど回らない。その差が外向角。
    const shape = d.turnAngle * (0.55 + 0.45 * loadNorm) / this.counterShapeMax;
    const counter = rad(P.counterDeg) * shape;

    // 外傾角・膝の角度は荷重に応じて深くなる
    const angulation = rad(P.angulationDeg) * Math.pow(loadNorm, 0.75);
    const kneeAng = rad(P.kneeAngulationDeg) * Math.pow(loadNorm, 0.75);

    // 脚の長さ（接雪点→股関節）。荷重が高いほど伸ばす
    const legLen = P.height * (0.42 + 0.08 * loadNorm);
    const torsoLen = P.height * 0.288;

    const fr = this.solveFrontal(d.lambda, angulation, legLen, torsoLen);

    // 3D 姿勢ベクトル：uLeg を進行方向軸まわりに回して脚・上体の向きを作る
    const axis = d.tangent;
    const legDir = rotateToward(d.uLeg, d.inward, axis, fr.phiLeg - d.lambda);
    const torsoDir = rotateToward(d.uLeg, d.inward, axis, fr.phiTorso - d.lambda);

    const edgeAngle = fr.phiLeg + kneeAng;            // スキーのエッジ角
    const ratio = THREE.MathUtils.clamp(d.radius / P.skiSidecutR, 0, 1);
    const edgeNeeded = Math.acos(ratio);              // サイドカット理論の必要エッジ角
    const carving = edgeAngle >= edgeNeeded - rad(2);

    // 両スキーの中心線（軌跡）と、実際の圧の中心
    //   切り替えでは荷重が左右に分かれるので圧中心はスタンス中央、
    //   フォールラインでは外スキーに集中する（外脚荷重 50 % → 95 %）
    const trackCenter = this.trackPoint(u);
    const half = P.stanceWidth / 2;
    const footR = trackCenter.clone().addScaledVector(d.eLat, half);   // 右足（進行方向に対して右）
    const footL = trackCenter.clone().addScaledVector(d.eLat, -half);
    const outerShare = 0.5 + 0.45 * Math.pow(loadNorm, 0.6);           // 外脚の荷重配分
    const pressure = trackCenter.clone()
      .addScaledVector(d.outward, half * (2 * outerShare - 1));

    const com = pressure.clone().addScaledVector(d.uLeg, fr.comDist);
    const hip = pressure.clone().addScaledVector(legDir, legLen);      // 骨盤中心
    const outerFoot = d.eLat.dot(d.outward) > 0 ? footR : footL;
    const innerFoot = d.eLat.dot(d.outward) > 0 ? footL : footR;
    const outerIsRight = d.eLat.dot(d.outward) > 0;

    const phase = (((u % this.halfCycle) + this.halfCycle) % this.halfCycle) / this.halfCycle;

    return {
      u, phase, phaseInfo: phaseInfo(phase), cycle: d.cycle,
      pos: trackCenter, pressure, com, hip, legLen, torsoLen,
      footL, footR, outerFoot, innerFoot, outerIsRight, outerShare,
      tangent: d.tangent, eLat: d.eLat, inward: d.inward, outward: d.outward,
      turnSign: d.turnSign,
      normal: this.N, fallLine: this.D,
      radius: d.radius, accel: d.accel, loadBW: d.loadBW, loadNorm, uLeg: d.uLeg,
      legDir, torsoDir,
      inclination: d.lambda, counter, angulation, kneeAng,
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
  gates(count = 8, startCycle = 0) {
    const out = [];
    for (let i = 0; i < count; i++) {
      const cycle = startCycle + i;
      const u = this.L / 4 + cycle * this.halfCycle;
      const s = Math.sign(Math.sin(this.k * u)) || 1;
      const wTurn = s * Math.max(0.1, this.A - this.p.poleClearance);
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
