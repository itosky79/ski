/**
 * compare/ideal.js — お手本（このアプリの力学モデル）の骨格を、動画と同じ 2D の画面に写す
 *
 * 3D の画面（main.js）と同じ TurnModel と全身リグ（createSkier）を、画面に出さずにそのまま動かす。
 * 関節の位置（skier.state.anchors、ワールド座標）を
 *   斜面の真下から水平に見上げるカメラ（正射影）
 * へ写す：画面の右 = −x、画面の下 = −y（ワールドは +y が上、−z が下り）。
 * 動画の座標（y が下向き）とそろえるため、y も符号を反転して持つ。
 *
 * 関節の左右は<b>人の</b>左右（MediaPipe と同じ）。
 * 足首：外足は outerAnkle、内足は innerFoot に（outerAnkle − outerFoot）を足した点。
 *
 * 位相 0 ＝ 切り替え（u = halfCycle × k）、0.5 ＝ 頂点付近。
 * 続けて 2 ターン（右回り・左回り）を書き出しておき、選手と同じ向きに傾いているほうを使う。
 */
import { TurnModel } from '../kinematics.js';
import { createSkier } from '../skier.js';
import { DISCIPLINES, ANTHRO, turnModelParams } from '../constants.js';
import { measures, bodySize, median } from './analysis.js';

const STEPS = 40;          // 1 ターンあたりのコマ数
const CYCLE0 = 2;          // 書き出しは 3 ターン目から（はじめのターンは手の運びが落ち着いていない）
export const SPEED_MIN = 25, SPEED_MAX = 80;   // 速さ合わせで探す範囲 [km/h]

export class IdealModel {
  constructor(discKey = 'GS') {
    this.setDiscipline(discKey);
  }

  setDiscipline(discKey) {
    this.discKey = discKey;
    this.disc = DISCIPLINES[discKey];
    this.model = new TurnModel(turnModelParams(this.disc, 'racer'));
    // 画面には出さない（シーンに入れない）。関節の位置を計算するためだけに使う
    this.skier = createSkier({ height: ANTHRO.height, discipline: this.disc });
    this.defaultSpeed = this.model.p.speedKmh;
    this.gates = null;
    this.frames = null;
  }

  get speedKmh() { return this.model.p.speedKmh; }

  setSpeed(kmh) {
    this.model.set({ speedKmh: kmh });
    this.frames = null;
  }

  /** 視線の先（main.js の lookTarget と同じ：次の旗門の少し先を見る） */
  _lookTarget(u) {
    const m = this.model, hc = m.halfCycle;
    const gs = this.gates ?? (this.gates = m.gates(CYCLE0 + 8, 0));
    let k = gs.findIndex((x) => x.u > u + 0.7 * hc);
    if (k < 0) k = gs.length - 1;
    const g0 = gs[k], g1 = gs[Math.min(k + 1, gs.length - 1)];
    const t = Math.min(1, Math.max(0, (u - (g0.u - 1.1 * hc)) / (0.4 * hc)));
    const w = t * t * (3 - 2 * t);
    return g0.turning.clone().lerp(g1.turning, w).addScaledVector(m.N, 1.0);
  }

  /** 位相 ph（0..2、整数が切り替え）の 2D 関節 */
  pose(ph) {
    const m = this.model, sk = this.skier;
    const u = m.halfCycle * (CYCLE0 + ph);
    const s = m.sample(u);
    sk.update(s, { lookTarget: this._lookTarget(u), ahead: m.sample(u + 0.42) });
    const a = sk.state.anchors;
    const P = (v) => [-v.x, -v.y];
    const ankO = a.outerAnkle;
    const ankI = a.innerFoot.clone().add(a.outerAnkle.clone().sub(a.outerFoot));
    // 人の右脚が外脚か：右膝が外足に近いか
    const rOuter = a.kneeRw.distanceTo(a.outerFoot) < a.kneeLw.distanceTo(a.outerFoot);
    const kp = {
      nose: P(a.head),
      lsh: P(a.shoulderLw), rsh: P(a.shoulderRw),
      lwr: P(a.handL), rwr: P(a.handR),
      lkn: P(a.kneeLw), rkn: P(a.kneeRw),
      lhip: P(rOuter ? a.innerHip : a.outerHip), rhip: P(rOuter ? a.outerHip : a.innerHip),
      lan: P(rOuter ? ankI : ankO), ran: P(rOuter ? ankO : ankI),
    };
    // 肘はお手本にないので、肩と手首の中点で代わりにする（描かないが、関節名はそろえておく）
    kp.lel = [(kp.lsh[0] + kp.lwr[0]) / 2, (kp.lsh[1] + kp.lwr[1]) / 2];
    kp.rel = [(kp.rsh[0] + kp.rwr[0]) / 2, (kp.rsh[1] + kp.rwr[1]) / 2];
    return kp;
  }

  /** 2 ターン分（位相 0..2）を書き出す。halfSign[h] は h ターン目の傾きの向き（画面の右へ倒れると +1） */
  build() {
    if (this.frames) return;
    this.frames = [];
    for (let i = 0; i <= 2 * STEPS; i++) this.frames.push(this.pose(i / STEPS));
    this.halfSign = [0, 1].map((h) => Math.sign(measures(this.frames[h * STEPS + STEPS / 2]).lean) || 1);
    this.size = median(this.frames.map(bodySize));
  }

  /**
   * 位相 ph（0..1）で、画面の傾きの向きが sgn のお手本の 2D 関節。
   * 同じ向きのターンがなければ左右を入れ替えて鏡に映す（ふつうは 2 ターンのどちらかが合う）。
   */
  at(ph, sgn) {
    this.build();
    let h = this.halfSign[0] === sgn ? 0 : (this.halfSign[1] === sgn ? 1 : -1);
    const mirror = h < 0;
    if (mirror) h = 0;
    const x = (h + Math.min(1, Math.max(0, ph))) * STEPS;
    const i0 = Math.min(2 * STEPS - 1, Math.floor(x)), f = x - i0;
    const A = this.frames[i0], B = this.frames[i0 + 1];
    const out = {};
    for (const k in A) out[k] = [A[k][0] + (B[k][0] - A[k][0]) * f, A[k][1] + (B[k][1] - A[k][1]) * f];
    return mirror ? mirrorPose(out) : out;
  }

  /** 頂点付近（位相 0.4〜0.6）の体の傾き [deg]（左右のターンの平均）。build せずに少ないコマで測る */
  apexLean() {
    const v = [];
    for (const h of [0, 1]) for (const ph of [0.4, 0.45, 0.5, 0.55, 0.6]) v.push(measures(this.pose(h + ph)).incl);
    return v.reduce((s, x) => s + x, 0) / v.length;
  }

  /**
   * 頂点付近の体の傾きが target [deg] にいちばん近くなる速さを探す（25〜80 km/h）。
   * 内傾は速さでほぼ決まるので、速さをそろえておけば、残りの違いは技術の違いとして見られる。
   */
  matchSpeed(target, { min = SPEED_MIN, max = SPEED_MAX } = {}) {
    const tryV = (v) => { this.setSpeed(v); return Math.abs(this.apexLean() - target); };
    let best = min, bestErr = Infinity;
    for (let v = min + 1; v <= max; v += 2) { const e = tryV(v); if (e < bestErr) { bestErr = e; best = v; } }
    for (const v of [best - 1, best + 1]) {
      if (v < min || v > max) continue;
      const e = tryV(v); if (e < bestErr) { bestErr = e; best = v; }
    }
    this.setSpeed(best);
    return best;
  }
}

/** 左右を入れ替えて鏡に映す（画面の x の符号を反転） */
export function mirrorPose(P) {
  const out = {};
  for (const k in P) {
    const k2 = k[0] === 'l' && k !== 'lean' ? 'r' + k.slice(1) : (k[0] === 'r' ? 'l' + k.slice(1) : k);
    out[k2] = [-P[k][0], P[k][1]];
  }
  return out;
}
