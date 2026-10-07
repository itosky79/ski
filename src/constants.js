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
/* 黄色は「いま、これをする」（動作ガイド）だけに使う約束なので、仙骨は骨の色（黄土）にする。
 * 以前は 0xffb703 の黄色で、ガイドの黄色い矢印と重なると骨盤が黄色い塊に見えていた。 */
export const BONE_COLORS = {
  sacrum:      { hex: 0xd9b38c, name: '仙骨',        note: '背骨の土台。ここが向いた方向＝骨盤の向き' },
  iliumOuter:  { hex: 0xff6b57, name: '腸骨（外側）', note: 'ターン外側の腸骨。外向で前に出る' },
  iliumInner:  { hex: 0x59d9a4, name: '腸骨（内側）', note: 'ターン内側の腸骨。引けると外向が崩れる' },
  ischium:     { hex: 0x9b8cff, name: '坐骨',        note: '座面。後傾すると坐骨が後ろへ落ちる' },
  pubis:       { hex: 0x4cc3ff, name: '恥骨',        note: '左右をつなぐ前側の骨' },
  femurHead:   { hex: 0xffffff, name: '大腿骨頭',    note: '股関節の球。ここで外傾を作る' },
  asis:        { hex: 0xff2d78, name: '上前腸骨棘',  note: '腰骨の出っぱり。左右を結ぶ線が骨盤の正面' },
  spine:       { hex: 0xd8e4f2, name: '脊柱・その他', note: '' },
};

/* ============================================================
 * 骨盤の配色（pelvis.js の setPalette が使う）
 *   simple  : かんたん表示。外側の寛骨はぜんぶ赤、内側はぜんぶ緑、仙骨は骨の色、
 *             左右の ASIS を結ぶ線（＝骨盤の正面）は白。<b>見分けるのは 3 色だけ</b>。
 *             7 色の解剖の色分けは、ターンの外と内を見分けるには多すぎる。
 *   anatomy : くわしく表示・骨盤ビュー。部位ごとの 7 色（BONE_COLORS と同じ）。
 * 色の意味はほかの表示と合わせてある：赤＝外側、緑＝内側、白＝基準の向き、
 * 黄色は使わない（動作ガイド専用）。
 * legend は凡例（ヘルプ）に出す順。ここに無い部位は凡例に出さない。
 * ============================================================ */
const BONE = 0xd9b38c;          // 骨の色（仙骨・目立たせない部位）
export const PELVIS_PALETTES = {
  simple: {
    iliumOuter: BONE_COLORS.iliumOuter.hex, iliumInner: BONE_COLORS.iliumInner.hex,
    ischiumOuter: BONE_COLORS.iliumOuter.hex, ischiumInner: BONE_COLORS.iliumInner.hex,
    pubisOuter: BONE_COLORS.iliumOuter.hex, pubisInner: BONE_COLORS.iliumInner.hex,
    sacrum: BONE, sacrumDark: 0xa98a6a,
    asis: 0xffffff, asisLine: 0xffffff,
    facing: null,               // 骨盤の正面の矢印は出さない（正面は白い線で示す）
    legend: [
      { hex: BONE_COLORS.iliumOuter.hex, name: '外側の腰骨',
        note: 'ターンの外側の寛骨。外向で前に出る' },
      { hex: BONE_COLORS.iliumInner.hex, name: '内側の腰骨',
        note: 'ターンの内側の寛骨。引けると外向が崩れる' },
      { hex: 0xffffff, name: '骨盤の正面',
        note: '左右の腰骨の出っぱり（上前腸骨棘）を結ぶ線。この線の向きが骨盤の向き' },
    ],
  },
  anatomy: {
    iliumOuter: BONE_COLORS.iliumOuter.hex, iliumInner: BONE_COLORS.iliumInner.hex,
    ischiumOuter: BONE_COLORS.ischium.hex, ischiumInner: BONE_COLORS.ischium.hex,
    pubisOuter: BONE_COLORS.pubis.hex, pubisInner: BONE_COLORS.pubis.hex,
    sacrum: BONE_COLORS.sacrum.hex, sacrumDark: 0xa98a6a,
    asis: BONE_COLORS.asis.hex, asisLine: BONE_COLORS.asis.hex,
    facing: 0x4cc3ff,           // 青＝骨盤の向き（角度ガイドの矢印・コンパスと同じ）
    legend: Object.values(BONE_COLORS).filter((v) => v.name)
      .map((v) => ({ hex: v.hex, name: v.name, note: v.note })),
  },
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
    angulationDeg: 42,      // 脚と上体の角度差。上体を立てるのはこの角度      // 外傾角の最大値
    platformDeg: 13,        // エッジ角 = 内傾角 + これ（板を噛ませる角度）
    stanceWidth: 0.26,      // 基準のスタンス幅 [m]（エッジ角に応じて 0.7〜1.2 倍になる）
    glideFactor: 0.45,      // 重力の斜面成分のうち加速に回る割合（前後のポジションを決める）
    glideAmp: 0.30,         // その位相変化（前半は前に乗り、後半は後ろに残る）
    skew: 0.03,             // 軌跡のわずかな非対称（荷重のピークがフォールラインの少し後に来る）
    gateLag: 0.09,
    // ポール処理：SL はポールをはたいて通る
    blockSigmaBefore: 1.30, blockSigmaAfter: 0.55, blockStrength: 1.00, blockHeight: 0.95,
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
    angulationDeg: 33,
    platformDeg: 11,
    stanceWidth: 0.32,
    glideFactor: 0.55,
    glideAmp: 0.28,
    skew: 0.03,
    gateLag: 0.10,
    // GS はパネルが遠いので、たたくというより肩でよける
    blockSigmaBefore: 2.60, blockSigmaAfter: 1.20, blockStrength: 0.42, blockHeight: 1.15,
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

/* お手本の滑りのプリセット（初心者指導用）。
 * 「初級・中級」だと見る人が<b>自分の</b>レベルを選ぶものと取り違えるので、
 * お手本の滑りの速さ・大きさで呼ぶ。キー（data-level）は変えない。 */
export const LEVELS = {
  beginner:     { label: 'ゆっくり・小さめ', speedScale: 0.45, counterScale: 0.55, angulationScale: 0.6 },
  intermediate: { label: 'ふつう',           speedScale: 0.72, counterScale: 0.8,  angulationScale: 0.82 },
  racer:        { label: 'レーサー',         speedScale: 1.0,  counterScale: 1.0,  angulationScale: 1.0 },
};

/* ターンの局面（位相 0..1、0 = 切り替え）
 *
 * cue：かんたん表示の「いま、やること」。局面ごとに 1 つだけ決めておく。
 *   動作ガイドの「くわしく」は変化の速さの順に並べるので、<b>保つ</b>動き（外向を保つ等）は
 *   速さ 0 になって決して 1 位に来ない。山回りで「外傾をほどく」と出ていたのはそのため。
 *   そこで初心者向けには、局面ごとの指示を表にして固定する。
 *     move : 矢印を出す動作（motion.js の MOVES の key、または 'cross'＝次の内側へ）
 *     sign : +1 増やす向き／−1 減らす向き（矢印の向き）
 *     hold : true なら「保つ」指示（矢印の大きさを変えず、キープの印を付ける）
 *     text : カードに出す一文   short : 3D の吹き出しに出す短い言い方
 *     why  : なぜそうするか（MOVES の why と同じ文。cross だけはこの表の desc から）
 *     block: true なら SL のポール処理の一行を添える（文言は motion.js の BLOCK 表）
 *   文言はすべて下の desc の言い方から取っている。指導者が言い方を変えたいときはここだけ直す。 */
export const PHASES = [
  {
    from: 0.00, to: 0.12, name: '切り替え',
    desc: '両スキーがフラットになる瞬間。骨盤も肩もまだ前のターンの向きに残っているので、'
      + '新しいターンから見た外向角は<b>マイナス</b>です。ここから身体がスキーを越えて次の内側へ移り、'
      + '荷重は左右 50:50。トップの前後差もこの瞬間にそろいます。',
    cue: { move: 'cross', sign: 1, hold: false,
      text: '体をスキーの上から次の内側へ', short: '次の内側へ',
      why: '身体がスキーを越えて次の内側へ移る。荷重は左右 50:50 から始まる。' },
  },
  {
    from: 0.12, to: 0.38, name: '谷回り（前半）',
    desc: 'スキーが身体の下を回り込んでくるので、外向角はマイナスから 0 へ戻っていきます。'
      + '上体は谷を向いたまま待つのが仕事。外脚への荷重が 50 % から 80 % へ増え、エッジ角も立ち上がります。',
    cue: { move: 'share', sign: 1, hold: false,
      text: '上体は谷へ向けたまま、外スキーに乗っていく', short: '外スキーへ',
      why: '外脚が仕事をする。内脚は次のターンの準備。' },
  },
  {
    from: 0.38, to: 0.62, name: 'フォールライン',
    desc: 'スキーが最大傾斜線を向き、骨盤・肩とも<b>ほぼ正対</b>（外向角 ≒ 0）。'
      + '回転半径が最小・荷重が最大になります。外傾で上体を起こし、外脚に乗り切る局面です。',
    cue: { move: 'fold', sign: 1, hold: true, block: true,
      text: '外脚の付け根を折って上体を起こす（外傾）', short: '腰を折る',
      why: '身体を倒さずにエッジ角だけ足せるのは、腰を折ったぶんだけ。' },
  },
  {
    from: 0.62, to: 0.88, name: '山回り（後半）',
    desc: '外向角が増えていく局面。脚がさらに回るのに上体は谷を向き続けるので、'
      + '<b>骨盤より肩のほうが約 2 倍</b>大きく開きます。内スキーにも乗り始め、荷重配分は 80:20 から 60:40 へ。',
    cue: { move: 'pelvis', sign: 1, hold: true,
      text: '骨盤は外へ向けたまま（外向キープ）', short: '骨盤は外へ',
      why: 'スキーだけが回って上体は谷に残る。その差が外向角。' },
  },
  {
    from: 0.88, to: 1.00, name: '解放（切り替えへ）',
    desc: '外脚を曲げて圧を抜き、身体がスキーを越えて次のターンの内側へ移動します。'
      + '外向を保ったまま解放するのがポイント。エッジが寝るとトップの前後差も自然に消えます。',
    cue: { move: 'leg', sign: -1, hold: false,
      text: '外脚を曲げて圧を抜く（外向は保ったまま）', short: '圧を抜く',
      why: '伸ばせば圧が増え、曲げれば抜ける。切り替えは「抜く」から始まる。' },
  },
];

