/**
 * compare/main.js — 「動画とお手本を比べる」ページの組み立て
 *
 * 流れ
 *   1. 動画ファイルを選ぶ（<video> に読み込むだけ。どこにも送らない）
 *   2. 解析する：1/30 秒ずつ骨格を取る（pose.js）→ 角度とターンの位相（analysis.js）
 *      → 頂点付近の体の傾きが合う速さでお手本を作る（ideal.js）
 *   3. 動画に選手（オレンジ）とお手本（水色）を重ねて再生。下に位相ごとのグラフと、ことばのまとめ
 *
 * 試験用に window.skiCompare から、骨格を外から入れて解析できる（analyzeFrames）。
 */
import { loadLandmarker, extractPoses } from './pose.js';
import { buildTrack, measures, segmentTurns, rollingSize, facingCamera, ankleMid, apexLean, summarize, fmtDeg } from './analysis.js';
import { IdealModel, SPEED_MIN, SPEED_MAX } from './ideal.js';
import { drawSkeleton, drawPhasePlot, COLORS } from './draw.js';

const STEP = 1 / 30;          // 骨格を取る間隔 [s]
const $ = (id) => document.getElementById(id);

const st = {
  disc: 'GS',
  quality: 'full',
  file: null,
  frames: null,               // 取った骨格（生のまま。種目や速さを変えたら、ここから計算し直す）
  meta: null,                 // { w, h }
  ideal: null,
  autoSpeed: true,
  speed: null,
  res: null,                  // 解析の結果
  cancel: false,
  rate: 0.25,
};

/* ---------- 1. 動画を選ぶ ---------- */
const video = $('video');
$('file').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  st.file = f;
  $('file-name').textContent = f.name;
  loadVideoURL(URL.createObjectURL(f));
});

function loadVideoURL(url) {
  st.frames = null; st.res = null;
  video.src = url;
  video.playbackRate = st.rate;
  $('sec-video').hidden = false;
  $('sec-result').hidden = true;
  $('readout').textContent = '解析すると、ここに今のコマの角度が出ます。';
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      $('btn-run').disabled = false;
      st.meta = { w: video.videoWidth, h: video.videoHeight };
      resizeOverlay();
      resolve(st.meta);
    };
    video.onerror = () => {
      showError('この動画はブラウザで再生できない形式のようです。MP4（H.264）か WebM に変換してから選んでください。');
      reject(new Error('video error'));
    };
  });
}

/* 種目・検出の精度 */
function bindSeg(groupId, attr, cb) {
  const btns = [...document.querySelectorAll(`#${groupId} [data-${attr}]`)];
  btns.forEach((b) => b.addEventListener('click', () => {
    btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    cb(b.dataset[attr]);
  }));
  return (v) => btns.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset[attr] === String(v))));
}
const setDiscUI = bindSeg('disc-group', 'discipline', (d) => setDiscipline(d));
bindSeg('quality-group', 'quality', (q) => { st.quality = q; });
bindSeg('rate-group', 'rate', (r) => { st.rate = +r; video.playbackRate = st.rate; });

function setDiscipline(d) {
  st.disc = d;
  setDiscUI(d);
  st.ideal = null;
  st.autoSpeed = true;
  if (st.frames) analyze();
}

/* ---------- 2. 解析 ---------- */
function progress(frac, text) {
  const p = $('progress');
  p.hidden = frac === null;
  if (frac === null) return;
  p.querySelector('i').style.width = `${Math.round(frac * 100)}%`;
  p.querySelector('span').textContent = text;
}

$('btn-run').addEventListener('click', async () => {
  hideError();
  $('btn-run').disabled = true;
  $('btn-cancel').hidden = false;
  st.cancel = false;
  try {
    progress(0, st.quality === 'heavy'
      ? '骨格の検出プログラムを読み込み中（初回だけ 約 30 MB）…'
      : '骨格の検出プログラムを読み込み中（初回だけ 約 10 MB）…');
    let lm;
    try { lm = await loadLandmarker(st.quality); } catch (err) {
      throw new Error('骨格の検出プログラムを読み込めませんでした。インターネットに接続しているか確かめてください。\n'
        + '（動画は送っていません。読み込むのは検出プログラムと学習済みモデルだけです）\n' + (err && err.message ? err.message : err));
    }
    const t0 = performance.now();
    const frames = await extractPoses(video, lm, {
      step: STEP,
      cancel: () => st.cancel,
      onProgress: (f) => {
        const el = (performance.now() - t0) / 1000;
        const left = f > 0.02 ? Math.round(el / f - el) : null;
        progress(f, `骨格を取っています… ${Math.round(f * 100)}%${left !== null ? `（あと約 ${left} 秒）` : ''}`);
      },
    });
    if (st.cancel) { progress(null); return; }
    st.frames = frames;
    progress(1, 'お手本を合わせています…');
    await new Promise((r) => setTimeout(r, 30));
    analyze();
    progress(null);
    video.currentTime = 0;
  } catch (err) {
    progress(null);
    showError(err && err.message ? err.message : String(err));
  } finally {
    $('btn-run').disabled = false;
    $('btn-cancel').hidden = true;
  }
});
$('btn-cancel').addEventListener('click', () => { st.cancel = true; });

/** 取った骨格から、角度・位相・お手本・まとめを計算して画面に出す */
function analyze() {
  hideError();
  const { frames, meta } = st;
  const tr = buildTrack(frames, meta);
  const { T, P, valid, cuts } = tr;
  const lean = P.map((p, i) => (valid[i] ? measures(p).lean : NaN));
  const seg = segmentTurns(T, lean, valid, cuts);
  const sizes = rollingSize(T, P, valid);
  const facing = facingCamera(P, valid);

  // 選手の値（位相が付いたコマだけ）
  const rec = [];
  for (let i = 0; i < T.length; i++) {
    if (!valid[i] || !Number.isFinite(seg.phase[i])) continue;
    rec.push({ i, t: T[i], ph: seg.phase[i], sgn: seg.sign[i], you: measures(P[i], seg.sign[i]) });
  }
  if (rec.length < 10) {
    st.res = null;
    $('sec-result').hidden = true;
    showError('ターンを区切れませんでした。選手の全身（足首まで）が写り、2 ターン以上入っている動画で試してください。'
      + `\n（骨格が取れたコマ ${valid.filter(Boolean).length} / ${T.length}、切り替え ${seg.transitions.length} 回）`);
    return;
  }

  // お手本：頂点付近の体の傾きが選手と同じになる速さ
  if (!st.ideal || st.ideal.discKey !== st.disc) st.ideal = new IdealModel(st.disc);
  const ideal = st.ideal;
  const target = apexLean(rec);
  if (st.autoSpeed) st.speed = ideal.matchSpeed(target);
  else ideal.setSpeed(st.speed);
  ideal.build();

  // お手本を同じ位相・同じ向きで取り、足首の中点と体の大きさを合わせて動画の上に置く
  const byFrame = new Array(T.length).fill(null);
  for (const r of rec) {
    const M = ideal.at(r.ph, r.sgn);
    const am = ankleMid(M), ar = ankleMid(P[r.i]);
    const s = sizes[r.i] / ideal.size;
    const Q = {};
    for (const k in M) Q[k] = [ar[0] + (M[k][0] - am[0]) * s, ar[1] + (M[k][1] - am[1]) * s];
    r.model = measures(M, r.sgn);
    r.Q = Q;
    byFrame[r.i] = r;
  }

  const dirName = (sgn) => (((sgn > 0) === facing) ? '左ターン' : '右ターン');
  st.res = { T, P, valid, seg, rec, byFrame, facing, dirName, target, cuts };
  renderResult();
  drawOverlay();
}

/* ---------- 3. 結果 ---------- */
function renderResult() {
  const { rec, dirName, target, seg } = st.res;
  const ideal = st.ideal;
  $('sec-result').hidden = false;
  const modelApex = ideal.apexLean();
  $('speed-line').innerHTML = `お手本（${ideal.disc.label}）の速さ：<b>${st.speed} km/h</b>`
    + `（${st.autoSpeed ? '自動' : '手で指定'}。頂点付近の体の傾き 選手 ${fmtDeg(target)}／お手本 ${fmtDeg(modelApex)}）`
    + (Math.abs(modelApex - target) > 3
      ? `<br><span class="warn-inline">速さの範囲（${SPEED_MIN}〜${SPEED_MAX} km/h）の中では体の傾きを合わせきれませんでした。`
        + '体の傾きの違いの一部は速さ（または撮り方）によるものです。</span>' : '')
    + `<br><span class="dim small">ターン ${seg.transitions.filter((i, k) => k > 0 && Number.isFinite(seg.phase[seg.transitions[k - 1]])).length} 回分を比べました（解析したコマ ${rec.length}）。</span>`;
  $('speed').value = st.speed;
  $('speed-val').textContent = `${st.speed} km/h`;

  const { items, warnings } = summarize(rec, dirName);
  $('warnings').innerHTML = warnings.map((w) => `<p class="warn">${w}</p>`).join('');
  $('summary').innerHTML = (items.length ? items : ['お手本との大きな違い（5° 以上）は見つかりませんでした。'])
    .map((t) => `<li>${t}</li>`).join('');

  renderPlots();
}

const PLOT_KEYS = [['incl', '体の傾き'], ['angu', '外傾'], ['shoulder', '肩のラインの傾き']];

function renderPlots() {
  const { rec, dirName } = st.res;
  const ideal = st.ideal;
  const box = $('plots');
  box.innerHTML = '';
  for (const [key, name] of PLOT_KEYS) {
    for (const sgn of [1, -1]) {
      const R = rec.filter((r) => r.sgn === sgn);
      const outer = dirName(sgn) === '左ターン' ? '右脚が外' : '左脚が外';
      const div = document.createElement('div');
      div.className = 'plot';
      div.innerHTML = `<h4>${name} — ${dirName(sgn)}（${outer}）<span class="dim">　${R.length} コマ</span></h4>`
        + '<canvas></canvas><div class="dim small hover">&nbsp;</div>';
      box.appendChild(div);
      const canvas = div.querySelector('canvas');
      const pts = R.map((r) => ({ ph: r.ph, v: r.you[key] }));
      const bins = [];
      for (let b = 0; b < 10; b++) {
        const B = R.filter((r) => r.ph >= b / 10 && r.ph < (b + 1) / 10);
        if (B.length >= 3) bins.push({ ph: (b + 0.5) / 10, n: B.length, v: B.reduce((s, r) => s + r.you[key], 0) / B.length });
      }
      const curve = [];
      for (let i = 0; i <= 40; i++) curve.push({ ph: i / 40, v: measures(ideal.at(i / 40, sgn), sgn)[key] });
      const g = drawPhasePlot(canvas, { pts, bins, curve });
      // マウス（指）を重ねると、その位相の値を出す
      const hover = div.querySelector('.hover');
      canvas.addEventListener('pointermove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const ph = Math.min(0.999, Math.max(0, (e.clientX - rect.left - g.L) / (g.W - g.L - g.R)));
        const b = bins.find((x) => Math.abs(x.ph - (Math.floor(ph * 10) + 0.5) / 10) < 1e-6);
        const m = curve[Math.round(ph * 40)].v;
        hover.innerHTML = `位相 ${(Math.floor(ph * 10) / 10).toFixed(1)}〜${((Math.floor(ph * 10) + 1) / 10).toFixed(1)}：`
          + `選手 ${b ? `${fmtDeg(b.v)}（${b.n} コマ）` : '—'}　お手本 ${fmtDeg(m)}`;
      });
      canvas.addEventListener('pointerleave', () => { hover.innerHTML = '&nbsp;'; });
    }
  }
}

/* お手本の速さを手で変える */
$('speed').addEventListener('input', (e) => { $('speed-val').textContent = `${e.target.value} km/h`; });
$('speed').addEventListener('change', (e) => {
  if (!st.frames) return;
  st.autoSpeed = false; st.speed = +e.target.value; analyze();
});
$('btn-auto').addEventListener('click', () => { if (!st.frames) return; st.autoSpeed = true; analyze(); });

/* ---------- 重ね描きと再生 ---------- */
const overlay = $('overlay');
function resizeOverlay() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  overlay.width = Math.round(overlay.clientWidth * dpr);
  overlay.height = Math.round(overlay.clientHeight * dpr);
  drawOverlay();
}
window.addEventListener('resize', resizeOverlay);

/** いま映っているコマの解析結果（解析した時刻のうち、いまの時刻以下でいちばん近いもの） */
function frameAt(t) {
  const T = st.res && st.res.T;
  if (!T || !T.length) return -1;
  let lo = 0, hi = T.length - 1;
  if (t < T[0]) return -1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (T[m] <= t + 1e-3) lo = m; else hi = m - 1; }
  return t - T[lo] <= STEP * 1.5 ? lo : -1;
}

function drawOverlay(mediaTime) {
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const t = mediaTime ?? video.currentTime;
  $('time').textContent = `${t.toFixed(1)} 秒`;
  if (video.duration) $('scrub').value = Math.round(t / video.duration * 1000);
  if (!st.res || !st.meta) return;
  // object-fit: contain で縮めて映っている範囲へ写す
  const W = overlay.width, H = overlay.height;
  const sc = Math.min(W / st.meta.w, H / st.meta.h);
  const ox = (W - st.meta.w * sc) / 2, oy = (H - st.meta.h * sc) / 2;
  const map = (p) => [ox + p[0] * sc, oy + p[1] * sc];
  const lw = Math.max(2, Math.round(W / 400));
  const i = frameAt(t);
  if (i < 0 || !st.res.valid[i]) { $('readout').textContent = 'このコマは解析に使っていません（骨格が取れない・足が切れている・場面の切り替わりなど）。'; return; }
  drawSkeleton(ctx, st.res.P[i], COLORS.you, lw + 1, map);
  const r = st.res.byFrame[i];
  if (!r) { $('readout').textContent = 'このコマはターンの区切りの外です（お手本は重ねません）。'; return; }
  drawSkeleton(ctx, r.Q, COLORS.model, lw, map);
  const f = fmtDeg;
  $('readout').innerHTML = `${st.res.dirName(r.sgn)}・位相 ${r.ph.toFixed(2)}　`
    + `体の傾き <b class="you">${f(r.you.incl)}</b>／<b class="model">${f(r.model.incl)}</b>　`
    + `外傾 <b class="you">${f(r.you.angu)}</b>／<b class="model">${f(r.model.angu)}</b>　`
    + `肩のライン <b class="you">${f(r.you.shoulder)}</b>／<b class="model">${f(r.model.shoulder)}</b>`
    + '<span class="dim">（選手／お手本）</span>';
}

// 再生中は映ったコマごとに描き直す（requestVideoFrameCallback がない端末は毎フレーム）
function onFrame(_, meta) {
  drawOverlay(meta && meta.mediaTime);
  if (!video.paused) schedule();
}
function schedule() {
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(onFrame);
  else requestAnimationFrame(() => onFrame());
}
video.addEventListener('play', () => { $('btn-play').textContent = '❚❚ 止める'; schedule(); });
video.addEventListener('pause', () => { $('btn-play').textContent = '▶ 再生'; drawOverlay(); });
video.addEventListener('seeked', () => { if (video.paused) drawOverlay(); });
$('btn-play').addEventListener('click', () => {
  if (video.paused) { video.playbackRate = st.rate; video.play(); } else video.pause();
});
$('scrub').addEventListener('input', (e) => {
  if (!video.duration) return;
  video.pause();
  video.currentTime = (+e.target.value / 1000) * video.duration;
});

/* ---------- エラー ---------- */
function showError(msg) { const e = $('cmp-error'); e.hidden = false; e.textContent = msg; }
function hideError() { $('cmp-error').hidden = true; }

/* 試験・授業用のハンドル（コンソールから触れるように） */
window.skiCompare = {
  st,
  loadVideoURL,
  setDiscipline,
  /** 骨格を外から入れて解析する：frames = [{ t, kp: { lsh: [x, y, 見えている度合い], ... } | null }] */
  analyzeFrames(frames, meta) {
    st.frames = frames; st.meta = meta; st.autoSpeed = true;
    analyze();
    return st.res && { speed: st.speed, rec: st.res.rec, transitions: st.res.seg.transitions.map((i) => st.res.T[i]) };
  },
  drawOverlay,
};
