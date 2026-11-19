/**
 * compare/draw.js — 重ね描き（骨格）と、位相ごとのグラフ
 */
import { EDGES } from './analysis.js';

export const COLORS = { you: '#ff9f40', model: '#4cc3ff' };

/**
 * 骨格を描く。P は動画の画素の座標。map(x, y) で canvas の座標へ写す。
 * 選手は太い実線、お手本は少し細い線（色だけに頼らず見分けられるように）。
 */
export function drawSkeleton(ctx, P, color, width, map) {
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 3;
  for (const [a, b] of EDGES) {
    const p = map(P[a]), q = map(P[b]);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
  }
  for (const k of ['lsh', 'rsh', 'lhip', 'rhip', 'lkn', 'rkn', 'lan', 'ran', 'lwr', 'rwr']) {
    const p = map(P[k]);
    ctx.beginPath(); ctx.arc(p[0], p[1], width + 1, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/**
 * 位相のグラフ 1 枚。
 *  pts   : 選手の 1 コマずつの点 [{ph, v}]
 *  bins  : 選手の位相 0.1 ごとの平均 [{ph, v, n}]
 *  curve : お手本 [{ph, v}]
 * 戻り値：マウスを重ねたときの読み取り用に、描いたときの座標の変換を返す
 */
export function drawPhasePlot(canvas, { pts, bins, curve }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const all = [...pts.map((p) => p.v), ...curve.map((p) => p.v), 0].filter(Number.isFinite);
  let lo = Math.min(...all), hi = Math.max(...all);
  lo = Math.floor((lo - 3) / 10) * 10; hi = Math.ceil((hi + 3) / 10) * 10;
  const L = 34, R = 8, T = 8, B = 22;
  const X = (ph) => L + ph * (W - L - R);
  const Y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);

  // 目盛り（控えめに）
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(159,176,198,.9)';
  ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 1;
  const stepY = (hi - lo) > 60 ? 20 : 10;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = Math.ceil(lo / stepY) * stepY; v <= hi; v += stepY) {
    ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke();
    ctx.fillText(`${v < 0 ? '−' : ''}${Math.abs(v)}°`, L - 4, Y(v));   // マイナスは記号 −
  }
  ctx.strokeStyle = 'rgba(255,255,255,.22)';
  ctx.beginPath(); ctx.moveTo(L, Y(0)); ctx.lineTo(W - R, Y(0)); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const [ph, t] of [[0, '切り替え'], [0.5, '頂点'], [1, '切り替え']]) {
    ctx.fillText(t, Math.min(W - R - 20, Math.max(L + 20, X(ph))), H - B + 6);
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.moveTo(X(ph), T); ctx.lineTo(X(ph), H - B); ctx.stroke();
  }

  // 選手の 1 コマずつ（薄く）
  ctx.fillStyle = 'rgba(255,159,64,.22)';
  for (const p of pts) { ctx.beginPath(); ctx.arc(X(p.ph), Y(p.v), 1.6, 0, Math.PI * 2); ctx.fill(); }
  // お手本の線
  ctx.strokeStyle = COLORS.model; ctx.lineWidth = 2;
  ctx.beginPath();
  curve.forEach((p, i) => (i ? ctx.lineTo(X(p.ph), Y(p.v)) : ctx.moveTo(X(p.ph), Y(p.v))));
  ctx.stroke();
  // 選手の平均（点。縁取りで線と重なっても見える）
  for (const b of bins) {
    ctx.beginPath(); ctx.arc(X(b.ph), Y(b.v), 4.5, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.you; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#0d1420'; ctx.stroke();
  }
  return { X, Y, L, R, W };
}
