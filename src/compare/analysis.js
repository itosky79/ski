/**
 * compare/analysis.js — 動画から取った 2D の骨格を、ターンの位相ごとの角度にする（画面にもネットにも触れない計算だけ）
 *
 * ■ 入力
 *   frames: [{ t: 秒, kp: { lsh: [x, y, 見えている度合い 0..1], ... } | null }]
 *   座標は動画の画素（x は右、y は下が +）。左右（l／r）は<b>人の</b>左右（MediaPipe と同じ）。
 *
 * ■ 測るもの（どれも画面の上の角度 [deg]。カメラの向きで数度は変わる）
 *   体の傾き（lean）：足首の中点 → 肩の中点 の線が、画面の鉛直から何度倒れているか。画面の右へ倒れると +
 *   外傾（angu）    ：脚（足首の中点 → 腰の中点）と上体（腰の中点 → 肩の中点）の傾きの差。
 *                     上体が脚より起きていると +（傾いている向きでそろえる）
 *   肩・腰のライン   ：左右の肩（腰）を結ぶ線の傾き。傾いている側（ターンの内側）の端が下がると +
 *
 * ■ ターンの区切り
 *   体の傾きの符号が変わるところ＝切り替え。0.5 秒より近い往復はノイズとして捨てる。
 *   切り替えから次の切り替えまでを位相 0 → 1（0.5 がターンの頂点付近）にする。
 *
 * 手順と数値の決め方は Python の試作（YOLO で骨格を取ったもの）と同じ。docs/REFERENCES.md 4.18。
 */

/** 使う関節（人の左右） */
export const JOINTS = ['nose', 'lsh', 'rsh', 'lel', 'rel', 'lwr', 'rwr', 'lhip', 'rhip', 'lkn', 'rkn', 'lan', 'ran'];
/** 描く骨（肘は お手本にないので、肩 → 手首 を 1 本で描く） */
export const EDGES = [['lsh', 'rsh'], ['lhip', 'rhip'], ['lsh', 'lhip'], ['rsh', 'rhip'], ['lsh', 'lwr'], ['rsh', 'rwr'],
  ['lhip', 'lkn'], ['lkn', 'lan'], ['rhip', 'rkn'], ['rkn', 'ran']];

/* 調整値 */
export const VIS_MIN = 0.4;        // これより見えていない関節は使わず、前後のコマから補う
const SMOOTH_W = 5;                // 関節のならし（コマ数）
const LEAN_SMOOTH_W = 9;           // 切り替えを探すときの体の傾きのならし（コマ数）
const MIN_HALF_TURN = 0.5;         // これより短い切り替えの往復はノイズ [s]
const SIZE_WIN = 1.0;              // 大きさの移動中央値の幅 [s]

const deg = (r) => r * 180 / Math.PI;
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (v) => Math.hypot(v[0], v[1]);
/** 画面の鉛直からの傾き。画面の右へ倒れると + */
const angV = (v) => deg(Math.atan2(v[0], -v[1]));
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
export function median(a) {
  const b = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!b.length) return NaN;
  const m = b.length >> 1;
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

/** 2 点を結ぶ線の傾き：画面の右の端が下がると +（どちらが人の左かには関係しない） */
function lineTilt(a, b) {
  const [L, R] = a[0] <= b[0] ? [a, b] : [b, a];
  return deg(Math.atan2(R[1] - L[1], R[0] - L[0]));
}

/** 1 コマの角度。P は { 関節名: [x, y] }、dir はターンの向き（画面の右へ傾くターンが +1。0 ならそのコマの傾きから） */
export function measures(P, dir = 0) {
  const sm = mid(P.lsh, P.rsh), hm = mid(P.lhip, P.rhip), am = mid(P.lan, P.ran);
  const lean = angV(sub(sm, am));
  const leg = angV(sub(hm, am)), trunk = angV(sub(sm, hm));
  // 向きの符号：ターンの向き（dir）が分かっていればそれを使う。切り替えの近くで
  // 1 コマごとの傾きの符号で決めると、外傾などの符号がコマごとに裏返って跳ぶため
  const s = dir ? Math.sign(dir) : (lean >= 0 ? 1 : -1);
  return {
    lean,
    incl: lean * s,                 // ターンの内側へ倒れていると +
    angu: (leg - trunk) * s,
    shoulder: lineTilt(P.lsh, P.rsh) * s,
    hip: lineTilt(P.lhip, P.rhip) * s,
  };
}

/** 胴＋両方の太もも＋両方のすねの長さ（画面の上）。お手本の大きさを選手に合わせるのに使う */
export function bodySize(P) {
  return len(sub(mid(P.lsh, P.rsh), mid(P.lhip, P.rhip)))
    + len(sub(P.lhip, P.lkn)) + len(sub(P.lkn, P.lan))
    + len(sub(P.rhip, P.rkn)) + len(sub(P.rkn, P.ran));
}

/** 足首の中点 */
export const ankleMid = (P) => mid(P.lan, P.ran);

/* ---------- 時系列の下ごしらえ ---------- */

/** 欠けた値（NaN）を前後から直線で補う。両端は最寄りの値で埋める */
function interpGaps(v) {
  const n = v.length, idx = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(v[i])) idx.push(i);
  if (idx.length < 2) return v.slice();
  const out = new Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (i <= idx[0]) { out[i] = v[idx[0]]; continue; }
    if (i >= idx[idx.length - 1]) { out[i] = v[idx[idx.length - 1]]; continue; }
    while (idx[k + 1] < i) k++;
    const a = idx[k], b = idx[k + 1];
    out[i] = v[a] + (v[b] - v[a]) * (i - a) / (b - a);
  }
  return out;
}

/** 移動平均（両端は端の値をのばす） */
export function smooth(v, w) {
  const h = w >> 1, n = v.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -h; j <= h; j++) s += v[Math.min(n - 1, Math.max(0, i + j))];
    out[i] = s / (2 * h + 1);
  }
  return out;
}

/**
 * 選手の関節の時系列を作る。
 *  1. 使えないコマを外す：骨格がない／膝・足首が見えていない（画面の外、上半身だけのアップなど）
 *  2. 場面の切り替わり（カット）を見つける：となりのコマから体の位置や大きさが急に跳んだら、
 *     そこから 0.3 秒は使わず、そのカットをまたぐターンは位相を付けない（別の人に移った場合も同じ扱い）
 *  3. 見えていない関節は前後のコマから補い、5 コマでならす
 * w, h は動画の画素数（画面の外の判定に使う。なければ判定しない）。
 * 戻り値：{ T, P: [{関節: [x, y]}], valid: [bool], cuts: [コマ番号] }
 */
export function buildTrack(frames, { visMin = VIS_MIN, w = 0, h = 0 } = {}) {
  const n = frames.length;
  const T = frames.map((f) => f.t);
  const inFrame = (q) => !w || !h || (q[0] >= 0 && q[0] <= w && q[1] >= 0 && q[1] <= h);
  const seen = (kp, k) => kp[k] && kp[k][2] >= visMin && inFrame(kp[k]);
  // 1. 肩・腰は 4 点のうち 3 点、膝と足首は 4 点とも見えているコマだけ使う
  const valid = frames.map((f) => !!(f.kp
    && ['lsh', 'rsh', 'lhip', 'rhip'].filter((k) => seen(f.kp, k)).length >= 3
    && ['lkn', 'rkn', 'lan', 'ran'].every((k) => seen(f.kp, k))));

  // 2. カット：近いコマ（0.2 秒以内）どうしで、腰の中点が体の大きさの 0.6 倍より跳ぶか、大きさが 1.4 倍以上変わる
  const cuts = [];
  const dt = n > 1 ? (T[n - 1] - T[0]) / (n - 1) : 1 / 30;
  const hold = Math.max(1, Math.round(0.3 / dt));
  let prev = null;
  for (let i = 0; i < n; i++) {
    if (!valid[i]) continue;
    const kp = frames[i].kp;
    const c = mid(kp.lhip, kp.rhip);
    const size = Math.max(1, len(sub(mid(kp.lsh, kp.rsh), mid(kp.lan, kp.ran))));
    if (prev && T[i] - T[prev.i] <= 0.2) {
      const r = size / prev.size;
      if (len(sub(c, prev.c)) > 0.6 * prev.size || r > 1.4 || r < 1 / 1.4) {
        cuts.push(i);
        for (let j = i; j < Math.min(n, i + hold); j++) valid[j] = false;
      }
    }
    prev = { i, c, size };
  }

  // 3. 関節ごとに補間 → ならす
  const series = {};
  for (const k of JOINTS) {
    for (const c of [0, 1]) {
      const v = frames.map((f, i) => (valid[i] && f.kp[k] && f.kp[k][2] >= visMin) ? f.kp[k][c] : NaN);
      series[k + c] = smooth(interpGaps(v), SMOOTH_W);
    }
  }
  const P = [];
  for (let i = 0; i < n; i++) {
    const p = {};
    for (const k of JOINTS) p[k] = [series[k + 0][i], series[k + 1][i]];
    P.push(p);
  }
  return { T, P, valid, cuts };
}

/**
 * 切り替え（体の傾きの符号が変わる時刻）でターンを区切り、位相を付ける。
 * 戻り値：{ transitions: [コマ番号], phase: [0..1 か NaN], sign: [+1|-1]（ターンの向き。画面の右へ傾くターンが +1） }
 */
export function segmentTurns(T, lean, valid, cuts = []) {
  const n = T.length;
  const raw = lean.map((x, i) => (valid[i] ? x : NaN));
  const ls = smooth(interpGaps(raw), LEAN_SMOOTH_W);
  const tr = [];
  for (let i = 1; i < n; i++) {
    // 使えないコマのあいだを補間した所でできた符号の変化は切り替えとみなさない
    if (Math.sign(ls[i]) === Math.sign(ls[i - 1]) || !valid[i] || !valid[i - 1]) continue;
    // 0.5 秒以内の往復はノイズ：1 つ前の切り替えごと取り消す
    if (!tr.length || T[i] - T[tr[tr.length - 1]] > MIN_HALF_TURN) tr.push(i);
    else tr.pop();
  }
  // 長すぎる区間は「途中で見失った」とみなす。スロー撮影では 1 ターンが数秒になるので、
  // 決まった秒数ではなく区間の長さの中央値の 2 倍を上限にする（少なくとも 2.5 秒）
  const durs = [];
  for (let k = 1; k < tr.length; k++) durs.push(T[tr[k]] - T[tr[k - 1]]);
  const maxDur = Math.max(2.5, 2 * (median(durs) || 0));
  const phase = new Array(n).fill(NaN);
  const sign = ls.map((x) => (x >= 0 ? 1 : -1));
  for (let k = 1; k < tr.length; k++) {
    const a = tr[k - 1], b = tr[k];
    let ok = 0;
    for (let i = a; i < b; i++) ok += valid[i] ? 1 : 0;
    if (T[b] - T[a] > maxDur || ok / (b - a) < 0.8) continue;
    if (cuts.some((c) => c > a && c < b)) continue;   // カットをまたぐ区間は使わない
    // ターンの向き＝区間のまん中のならした傾きの向き（区間の中では変えない）
    const dir = ls[(a + b) >> 1] >= 0 ? 1 : -1;
    for (let i = a; i < b; i++) { phase[i] = (T[i] - T[a]) / (T[b] - T[a]); sign[i] = dir; }
  }
  return { transitions: tr, phase, sign };
}

/** 大きさの移動中央値（約 1 秒の幅）。パンやズームで選手の大きさが変わっても追える */
export function rollingSize(T, P, valid) {
  const n = T.length;
  const sz = P.map((p, i) => (valid[i] ? bodySize(p) : NaN));
  const dt = n > 1 ? (T[n - 1] - T[0]) / (n - 1) : 1 / 30;
  const h = Math.max(1, Math.round(SIZE_WIN / 2 / dt));
  return sz.map((_, i) => median(sz.slice(Math.max(0, i - h), i + h + 1)));
}

/** 選手が画面の方を向いているか（人の左肩が画面の右にあれば正面を向いている） */
export function facingCamera(P, valid) {
  const d = P.filter((_, i) => valid[i]).map((p) => p.lsh[0] - p.rsh[0]);
  return (median(d) || 0) >= 0;
}

/* ---------- 位相ごとのまとめ ---------- */

/**
 * 位相の区間ごとの平均。rec は [{ ph, sgn, you: measures, model: measures }]
 * 戻り値：{ n, you, model }（区間に入るコマがなければ null）
 */
export function binStats(rec, sgn, lo, hi, key) {
  const R = rec.filter((r) => r.sgn === sgn && r.ph >= lo && r.ph < hi);
  if (!R.length) return null;
  return { n: R.length, you: mean(R.map((r) => r.you[key])), model: mean(R.map((r) => r.model[key])) };
}

/** 頂点付近（位相 0.4〜0.6）の選手の体の傾き（左右のターンをまとめた平均）。お手本の速さを合わせるのに使う */
export function apexLean(rec) {
  return mean(rec.filter((r) => r.ph >= 0.4 && r.ph < 0.6).map((r) => r.you.incl));
}

/* ---------- ことばのまとめ ---------- */

const MIN_FRAMES = 8;      // これより少ないコマの区間からは言わない
const r5 = (x) => Math.round(Math.abs(x));
/** 角度の表示（負の数はマイナス記号 −。3D の画面と同じ書き方） */
export const fmtDeg = (x) => { const d = Math.round(x); return `${d < 0 ? '−' : ''}${Math.abs(d)}°`; };

/**
 * いちばん大きな違いを、ことばで最大 4 つ。
 * dirName(sgn) はターンの向きの名前（'左ターン' など）。
 * 戻り値：{ items: [文], warnings: [文] }
 *
 * 左右のターンで頂点付近の外傾か体の傾きが 15° 以上違うときは、カメラが斜面の真下ではなく
 * 横から撮っている可能性が高い（片方のターンでは選手が正面を、もう片方では横を向いて写る）。
 * そのときは注意を出し、左右差は技術の違いとしては言わない。
 */
export function summarize(rec, dirName) {
  const out = [], warnings = [];
  let offAxis = false;
  for (const key of ['angu', 'incl']) {
    const a = binStats(rec, 1, 0.4, 0.6, key), b = binStats(rec, -1, 0.4, 0.6, key);
    if (a && b && a.n >= MIN_FRAMES && b.n >= MIN_FRAMES && Math.abs(a.you - b.you) > 15) offAxis = true;
  }
  if (offAxis) {
    warnings.push('左右のターンで値が大きく違います。カメラが斜面の真下ではなく横から撮っている可能性があります'
      + '（左右差の判断は控えてください）');
  }
  const both = (lo, hi, key) => {
    const a = binStats(rec, 1, lo, hi, key), b = binStats(rec, -1, lo, hi, key);
    const parts = [a, b].filter((x) => x && x.n >= MIN_FRAMES);
    if (!parts.length) return null;
    const n = parts.reduce((s, x) => s + x.n, 0);
    const w = (k) => parts.reduce((s, x) => s + x[k] * x.n, 0) / n;
    return { n, you: w('you'), model: w('model'), d: w('you') - w('model') };
  };
  const more = (d) => (d < 0 ? '少ない' : '多い');

  const apex = both(0.4, 0.6, 'angu');
  if (apex && Math.abs(apex.d) >= 5) {
    out.push({ size: Math.abs(apex.d), text: `頂点付近（位相 0.4〜0.6）で、外傾がお手本より約 ${r5(apex.d)}° ${more(apex.d)}`
      + `（選手 ${fmtDeg(apex.you)}／お手本 ${fmtDeg(apex.model)}）` });
  }
  const late = both(0.6, 0.8, 'angu');
  if (late && Math.abs(late.d) >= 5) {
    const why = late.d < 0 ? '。外傾が早く抜けている可能性があります' : '。外傾が長く残っている可能性があります';
    out.push({ size: Math.abs(late.d), text: `ターン後半（位相 0.6〜0.8）で、外傾がお手本より約 ${r5(late.d)}° ${more(late.d)}`
      + `（選手 ${fmtDeg(late.you)}／お手本 ${fmtDeg(late.model)}）${why}` });
  }
  const early = both(0.2, 0.4, 'angu');
  if (early && Math.abs(early.d) >= 5) {
    out.push({ size: Math.abs(early.d), text: `ターン前半（位相 0.2〜0.4）で、外傾がお手本より約 ${r5(early.d)}° ${more(early.d)}`
      + `（選手 ${fmtDeg(early.you)}／お手本 ${fmtDeg(early.model)}）` });
  }
  // 体の傾きは頂点付近で合わせてあるので、前半・後半のずれだけを見る
  for (const [lo, hi, name] of [[0.2, 0.4, 'ターン前半（位相 0.2〜0.4）'], [0.6, 0.8, 'ターン後半（位相 0.6〜0.8）']]) {
    const s = both(lo, hi, 'incl');
    if (s && Math.abs(s.d) >= 6) {
      const how = s.d < 0 ? (lo > 0.5 ? '（早く起きている）' : '（傾きの立ち上がりが遅い）') : '';
      out.push({ size: Math.abs(s.d) * 0.9, text: `${name}で、体の傾きがお手本より約 ${r5(s.d)}° ${s.d < 0 ? '小さい' : '大きい'}${how}` });
    }
  }
  // 左右差（お手本は左右対称なので、選手の左右の差をそのまま見る）
  for (const [key, name, lim] of offAxis ? [] : [['shoulder', '肩のラインの傾き', 8], ['angu', '外傾', 8], ['hip', '腰のラインの傾き', 8]]) {
    const a = binStats(rec, 1, 0.3, 0.7, key), b = binStats(rec, -1, 0.3, 0.7, key);
    if (!a || !b || a.n < MIN_FRAMES || b.n < MIN_FRAMES) continue;
    const d = a.you - b.you;
    if (Math.abs(d) >= lim) {
      const small = d < 0 ? dirName(1) : dirName(-1);
      out.push({ size: Math.abs(d) * 0.85, text: `左右のターンで${name}が約 ${r5(d)}° 違う（${small}のほうが小さい。`
        + `${dirName(1)} ${fmtDeg(a.you)}／${dirName(-1)} ${fmtDeg(b.you)}、位相 0.3〜0.7）` });
    }
  }
  out.sort((x, y) => y.size - x.size);
  return { items: out.slice(0, 4).map((x) => x.text), warnings };
}
