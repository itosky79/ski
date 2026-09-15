/**
 * biomech.js — 外力から関節モーメントを求め、それを担う筋の活動度を出す
 *
 * ■ 考え方（逆動力学の簡易版）
 *   雪面反力 F が接雪点 cp に働いているとき、関節 J まわりの外部モーメントは
 *       M_ext = (cp − J) × F
 *   身体はこれに釣り合うだけの内部モーメント（＝筋の力）を出す必要がある。
 *   M_ext を関節の運動軸に投影すれば、「どの向きのモーメントがどれだけ必要か」が出る。
 *   その向きを作れる筋（起始・停止から決まる）に割り当てれば、活動度になる。
 *
 * ■ 関節軸の約束（+x = 左、+y = 上、+z = 前）
 *   屈曲／伸展 : 左向きの軸まわり（+x）。正の回転が屈曲。
 *   外転／内転 : 前向きの軸まわり（+z）。右脚は負、左脚は正が外転。
 *   回旋       : 上向きの軸まわり（+y）。
 *
 * ■ 体幹
 *   上半身の質量に働く慣性力（m(a − g)）が L5/S1 まわりに作るモーメントを使う。
 *   ひねりを保つ働き（等尺性）は外力からは出てこないので、
 *   ねじれ角に比例する分を別に足している（hold 項）。
 *
 * ■ 正規化
 *   体重あたりの関節モーメントで割る。目安は股関節・膝 3.0、足関節 1.5、
 *   体幹 2.0 N·m/kg（競技スキーの実測はこの程度まで達する）。
 */
import * as THREE from 'three';

const REF = { hip: 3.0, knee: 3.0, ankle: 1.5, trunk: 2.0 };   // N·m/kg
/* 足関節まわりのモーメントは、その多くをブーツのシェルが受け持つ。
   筋が負担するのは残りだけなので、この割合を掛ける。 */
const BOOT_SHARE = 0.55;
const rad = (d) => d * Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * @param {Object} s   TurnModel.sample() の結果
 * @param {Object} j   関節位置など（skier.js が用意する）
 * @param {number} mass 体重 [kg]
 */
export function computeMuscleLoad(s, j, mass) {
  const demand = {};                 // 例: demand.R.kneeExtension
  const out = {};                    // 筋 id + 側 → 活動度
  const moments = {};

  for (const side of ['L', 'R']) {
    const isOuter = side === j.outerSide;
    const F = (isOuter ? s.forceOuter : s.forceInner).clone();
    const cp = isOuter ? j.cpOuter : j.cpInner;
    const d = {};

    const axFlex = j.pelvisLeft;                  // 屈曲軸（左向き）
    const axAbd = j.pelvisFwd;                    // 外転軸（前向き）
    const axRot = j.pelvisUp;                     // 回旋軸（上向き）
    const sideSign = side === 'R' ? 1 : -1;

    /* --- 股関節 --- */
    const Mh = new THREE.Vector3().subVectors(cp, j['hip' + side]).cross(F);
    const hipFlex = Mh.dot(axFlex);               // + なら外力が股関節を曲げる
    const hipAbd = sideSign * Mh.dot(axAbd);      // + なら内転させる向き
    const hipRot = Mh.dot(axRot) * sideSign;
    d.hipExtension = clamp01(hipFlex / (REF.hip * mass));
    d.hipFlexion = clamp01(-hipFlex / (REF.hip * mass));
    d.hipAbduction = clamp01(hipAbd / (REF.hip * mass));
    d.hipAdduction = clamp01(-hipAbd / (REF.hip * mass));
    d.hipExternalRot = clamp01(hipRot / (REF.hip * mass * 0.5));
    d.hipInternalRot = clamp01(-hipRot / (REF.hip * mass * 0.5));

    /* --- 膝 --- */
    const kneeAxis = j.legAxis[side];             // 脚の左向き軸
    const Mk = new THREE.Vector3().subVectors(cp, j['knee' + side]).cross(F);
    const kneeFlex = Mk.dot(kneeAxis);
    d.kneeExtension = clamp01(kneeFlex / (REF.knee * mass));
    d.kneeFlexion = clamp01(-kneeFlex / (REF.knee * mass));

    /* --- 足関節 ---
     * 圧の中心がくるぶしより前にあると、外力は足首を背屈させる向きに回す。
     * これに抗うのは底屈筋（ふくらはぎ）。ただし大半はブーツが受け持つ。 */
    const Ma = new THREE.Vector3().subVectors(cp, j['ankle' + side]).cross(F);
    const ankleFlex = Ma.dot(kneeAxis);          // + なら底屈させる向き
    const ankleRef = REF.ankle * mass / (1 - BOOT_SHARE);
    d.ankleDorsi = clamp01(ankleFlex / ankleRef);
    d.anklePlantar = clamp01(-ankleFlex / ankleRef);

    /* --- 姿勢を保つ働き（等尺性）---
     * 釣り合いがとれていると関節モーメントは小さくなるが、
     * 曲げた姿勢・開いた姿勢を保つこと自体に筋の収縮が要る。 */
    const ang = j.angles[side] || {};
    // その脚が実際に受け持っている荷重の割合で重みづけする
    const share = isOuter ? s.outerShare : 1 - s.outerShare;
    const ld = s.loadNorm * clamp01(share / 0.5);
    d.hipExtension = Math.max(d.hipExtension,
      clamp01((ang.hipFlexion ?? 0) / rad(55)) * ld * 0.75);
    d.hipAbduction = Math.max(d.hipAbduction,
      clamp01(Math.abs(s.angulation) / rad(25)) * ld * (isOuter ? 0.8 : 0.3));
    d.hipAdduction = Math.max(d.hipAdduction, isOuter ? 0 : ld * 0.45);
    d.kneeExtension = Math.max(d.kneeExtension,
      clamp01((ang.knee ?? 0) / rad(90)) * ld * 0.5);
    d.ankleDorsi = Math.max(d.ankleDorsi, clamp01((ang.shin ?? 0) / rad(35)) * ld * 0.5);

    demand[side] = d;
    moments[side] = { hip: Mh.length(), knee: Mk.length(), ankle: Ma.length() };
  }

  /* --- 体幹（L5/S1 まわり） --- */
  const aMinusG = s.accel.clone().sub(new THREE.Vector3(0, -9.80665, 0));
  const upMass = mass * 0.678;                        // 体幹＋頭＋両腕
  const Fup = aMinusG.multiplyScalar(upMass);         // 上半身に働く合力
  const Mt = new THREE.Vector3().subVectors(j.comUpper, j.l5s1).cross(Fup);
  const tFlex = Mt.dot(j.pelvisLeft);                 // + なら前へ倒す向き
  const tLat = Mt.dot(j.pelvisFwd);                   // 横に倒す向き
  const dt = {
    trunkExtension: Math.max(clamp01(tFlex / (REF.trunk * mass)),
      clamp01((j.spineFlex ?? 0) / rad(30)) * 0.5),
    trunkFlexion: clamp01(-tFlex / (REF.trunk * mass)),
    // 上体は遠心力と重力の合力で内側へ倒れようとするので、外側の筋が支える
    trunkLateral: Math.max(clamp01(Math.abs(tLat) / (REF.trunk * mass)),
      clamp01(Math.abs(s.angulation) / rad(25)) * 0.6),
    // ひねりを保つ働きは外力からは出ないので、ねじれ角から見積もる
    trunkRotation: clamp01(Math.abs(s.counterSpine - s.counter) / rad(30)),
  };
  // 側屈を支えるのは外側の筋
  const latOuterSide = j.outerSide;

  /* --- 筋への割り当て --- */
  const assign = (id, side, value) => {
    const k = id + side;
    out[k] = Math.max(out[k] ?? 0, clamp01(value));
  };
  return { demand, trunk: dt, moments, latOuterSide, assign, out };
}

/**
 * 筋の定義（pull）に従って活動度を割り当てる。
 */
export function applyMuscleActivation(muscleDefs, load, outerSide) {
  const act = {};
  const set = (id, side, v) => {
    const k = id + side;
    act[k] = Math.max(act[k] ?? 0, clamp01(v));
  };
  for (const def of muscleDefs) {
    for (const side of ['L', 'R']) {
      let v = 0;
      for (const [key, w] of def.pull) {
        let demandValue = 0;
        if (key.startsWith('trunk')) {
          demandValue = load.trunk[key] ?? 0;
          // 側屈は外側の筋が支える
          if (key === 'trunkLateral' && side !== load.latOuterSide) demandValue *= 0.35;
        } else {
          demandValue = load.demand[side][key] ?? 0;
        }
        v = Math.max(v, demandValue * w);
      }
      set(def.id, side, v);
    }
  }
  return act;
}
