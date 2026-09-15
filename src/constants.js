/**
 * constants.js — 公式規定・文献に基づく定数
 *
 * 出典（詳細は docs/REFERENCES.md）:
 *  [ICR]  FIS, The International Ski and Snowboard Competition Rules (ICR), Book IV
 *         Alpine Skiing, 2025-05-21 版
 *         - 801.2.3 SL: 旗門幅 4〜6 m、ターニングポール間 6〜13 m
 *         - 801.2.4 SL: 方向転換数 = 標高差の 30〜35 %
 *         - 901.2.2 GS: パネルは約 75 cm × 50 cm、下端は雪面から約 1 m
 *         - 901.2.3 GS: 旗門幅 4〜8 m、ターニングポール間 最小 10 m
 *         - 901.2.4 GS: 方向転換数 = 標高差の 11〜15 %
 *  [EQP]  FIS, Specifications for Alpine Competition Equipment 2024/2025
 *         - 最小板長  SL 男 165 cm / 女 155 cm、GS 男 193 cm / 女 188 cm
 *         - 最小サイドカット半径 GS 男女とも 30 m（SL は規定なし）
 *         - ウエスト幅 最大 65 mm、ショルダー幅 最大 GS 103 mm
 *  [ANT]  Drillis & Contini (1966) の身体寸法比（Winter, Biomechanics and Motor
 *         Control of Human Movement, 4th ed., Table 4.1 に再録）
 *  [DEM]  Dempster (1955) の身体分節質量比（同 Table 4.1）
 *  [GRF]  実測研究の報告値：GS のピーク雪面反力 ≈ 3.2 体重、SL ≈ 4 体重
 */

export const G = 9.80665;              // 重力加速度 [m/s^2]

/* ============================================================
 * 身体寸法 [ANT] — すべて身長 H に対する比
 * ============================================================ */
export const ANTHRO = {
  height: 1.75,          // 既定の身長 [m]
  mass: 75,              // 既定の体重 [kg]
  // 分節長（身長比）
  foot: 0.152,           // 足長
  ankleHeight: 0.039,    // 床〜足関節
  shank: 0.246,          // 足関節〜膝
  thigh: 0.245,          // 膝〜股関節
  trunk: 0.288,          // 股関節〜肩
  headNeck: 0.182,       // 肩〜頭頂
  headR: 0.065,          // 頭半径
  upperArm: 0.186,
  foreArm: 0.146,
  hand: 0.108,
  shoulderW: 0.259,      // 肩峰幅
  hipW: 0.191,           // 大転子間幅
  pelvisH: 0.095,        // 骨盤の高さ（腸骨稜〜坐骨結節）
};

/* 分節質量比 [DEM]（左右合計。重心計算に使用） */
export const SEGMENT_MASS = {
  trunkHead: 0.578,      // 体幹 0.497 + 頭頸 0.081
  thigh: 0.100,
  shank: 0.0465,
  foot: 0.0145,
  upperArm: 0.028,
  foreArmHand: 0.022,
};

/* ============================================================
 * 骨盤の色分け — 指導用の凡例と一致させること
 * ============================================================ */
export const BONE_COLORS = {
  sacrum:      { hex: 0xffb703, name: '仙骨',        note: '背骨の土台。ここが向いた方向＝骨盤の向き' },
  iliumOuter:  { hex: 0xff6b57, name: '腸骨（外側）', note: 'ターン外側の腸骨。外向で前に出る' },
  iliumInner:  { hex: 0x59d9a4, name: '腸骨（内側）', note: 'ターン内側の腸骨。引けると外向が崩れる' },
  ischium:     { hex: 0x9b8cff, name: '坐骨',        note: '座面。後傾すると坐骨が後ろへ落ちる' },
  pubis:       { hex: 0x4cc3ff, name: '恥骨',        note: '左右をつなぐ前側の骨' },
  femurHead:   { hex: 0xffffff, name: '大腿骨頭',    note: '股関節の球。ここで外傾を作る' },
  asis:        { hex: 0xff2d78, name: '上前腸骨棘',  note: '腰骨の出っぱり。左右を結ぶ線が骨盤の正面' },
  spine:       { hex: 0xd8e4f2, name: '脊柱・その他', note: '' },
};

/* ============================================================
 * 種目プリセット
 * ============================================================ */
export const DISCIPLINES = {
  SL: {
    key: 'SL',
    label: 'スラローム',
    labelEn: 'Slalom',
    // コースセット [ICR 801.2.3]
    gateSpacing: 11.0,      // 進行方向のポール間隔 [m]（規定は直線距離 6〜13 m）
    offset: 1.5,            // 振り幅の片振幅 [m]
    gateWidth: 5.0,         // 旗門幅 [m]（規定 4〜6 m）
    poleMin: 6, poleMax: 13,
    hasPanel: false,
    // 用具 [EQP]
    skiLength: 1.65,        // 最小板長（男子）
    skiSidecutR: 12.8,      // 実勢値（FIS に SL の半径規定はない）
    skiWaist: 0.065, skiShoulder: 0.095, skiTail: 0.088,
    // 滑走
    speedKmh: 42,           // ワールドカップの平均的な滑走速度
    slopeDeg: 22,
    counterDeg: 18,         // 骨盤の外向角の最大値（上体はこの約 2 倍になる）
    angulationDeg: 24,      // 外傾角の最大値
    kneeAngulationDeg: 8,
    stanceWidth: 0.26,      // 基準のスタンス幅 [m]（エッジ角に応じて 0.7〜1.2 倍になる）
    glideFactor: 0.45,      // 重力の斜面成分のうち加速に回る割合（前後のポジションを決める）
    glideAmp: 0.30,         // その位相変化（前半は前に乗り、後半は後ろに残る）
    skew: 0.03,             // 軌跡のわずかな非対称（荷重のピークがフォールラインの少し後に来る）
    gateLag: 0.09,
    outerShareMax: 0.80,    // 外脚荷重の最大配分（実測の 80:20）
    outerShareLate: 0.60,   // 山回り後半（60:40）
    gammaPelvis: 0.55, activePelvis: 0.25,
    gammaSpine: 1.15, activeSpine: 0.45,
    innerEdgeExtraDeg: 5,   // 内スキーは外より少し多く傾ける
    leadToPelvis: 0.30,     // 内足の先行が骨盤の向きに伝わる割合
    leadFactor: 0.32,
    desc: '小さく速いターン。上体を谷へ向けたまま脚だけを切り替えるので、外向が大きく出ます。骨盤より肩のほうが大きく谷を向きます。',
  },
  GS: {
    key: 'GS',
    label: '大回転',
    labelEn: 'Giant Slalom',
    // コースセット [ICR 901.2.3]
    gateSpacing: 26,        // 進行方向のポール間隔 [m]（規定は最小 10 m）
    offset: 3.6,
    gateWidth: 6.0,         // 旗門幅 [m]（規定 4〜8 m）
    poleMin: 10, poleMax: 27,
    hasPanel: true,
    panelW: 0.75, panelH: 0.50, panelBottom: 1.0,   // [ICR 901.2.2]
    // 用具 [EQP]
    skiLength: 1.93,
    skiSidecutR: 30,        // FIS 最小サイドカット半径
    skiWaist: 0.065, skiShoulder: 0.103, skiTail: 0.095,
    // 滑走
    speedKmh: 65,
    slopeDeg: 19,
    counterDeg: 11,         // GS は骨盤の外向が小さい
    angulationDeg: 20,
    kneeAngulationDeg: 6,
    stanceWidth: 0.32,
    glideFactor: 0.55,
    glideAmp: 0.28,
    skew: 0.03,
    gateLag: 0.10,
    outerShareMax: 0.72,    // 実測の 70:30
    outerShareLate: 0.60,
    gammaPelvis: 0.38, activePelvis: 0.18,
    gammaSpine: 0.85, activeSpine: 0.32,
    innerEdgeExtraDeg: 4,
    leadToPelvis: 0.26,
    leadFactor: 0.32,
    desc: '大きく長いターン。内傾が深くなる一方で骨盤の外向は控えめで、スキーに対してほぼ正対したまま外傾で外スキーを押し続けます。',
  },
};

/* レベル別プリセット（初心者指導用） */
export const LEVELS = {
  beginner:     { label: '初級', speedScale: 0.45, counterScale: 0.55, angulationScale: 0.6 },
  intermediate: { label: '中級', speedScale: 0.72, counterScale: 0.8,  angulationScale: 0.82 },
  racer:        { label: '競技', speedScale: 1.0,  counterScale: 1.0,  angulationScale: 1.0 },
};

/* ターンの局面（位相 0..1、0 = 切り替え） */
export const PHASES = [
  {
    from: 0.00, to: 0.12, name: '切り替え',
    desc: '両スキーがフラットになる瞬間。骨盤も肩もまだ前のターンの向きに残っているので、'
      + '新しいターンから見た外向角は<b>マイナス</b>です。ここから身体がスキーを越えて次の内側へ移り、'
      + '荷重は左右 50:50。トップの前後差もこの瞬間にそろいます。',
  },
  {
    from: 0.12, to: 0.38, name: '谷回り（前半）',
    desc: 'スキーが身体の下を回り込んでくるので、外向角はマイナスから 0 へ戻っていきます。'
      + '上体は谷を向いたまま待つのが仕事。外脚への荷重が 50 % から 80 % へ増え、エッジ角も立ち上がります。',
  },
  {
    from: 0.38, to: 0.62, name: 'フォールライン',
    desc: 'スキーが最大傾斜線を向き、骨盤・肩とも<b>ほぼ正対</b>（外向角 ≒ 0）。'
      + '回転半径が最小・荷重が最大になります。外傾で上体を起こし、外脚に乗り切る局面です。',
  },
  {
    from: 0.62, to: 0.88, name: '山回り（後半）',
    desc: '外向角が増えていく局面。脚がさらに回るのに上体は谷を向き続けるので、'
      + '<b>骨盤より肩のほうが約 2 倍</b>大きく開きます。内スキーにも乗り始め、荷重配分は 80:20 から 60:40 へ。',
  },
  {
    from: 0.88, to: 1.00, name: '解放（切り替えへ）',
    desc: '外脚を曲げて圧を抜き、身体がスキーを越えて次のターンの内側へ移動します。'
      + '外向を保ったまま解放するのがポイント。エッジが寝るとトップの前後差も自然に消えます。',
  },
];

