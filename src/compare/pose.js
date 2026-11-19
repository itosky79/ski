/**
 * compare/pose.js — 動画の各コマから人の骨格（2D）を取る（MediaPipe Pose Landmarker）
 *
 * ■ すべてブラウザの中で動く
 *   ネットから読むのは、検出のプログラム（cdn.jsdelivr.net）と学習済みモデル（storage.googleapis.com）だけ。
 *   動画そのものはどこにも送らない（<video> に読み込んだコマを、その場で検出にかける）。
 *
 * ■ コマの取り方
 *   動画を止めたまま 1/30 秒ずつ currentTime を進め、seeked を待ってから検出する（VIDEO モード）。
 *   再生しながら取るより遅いが、端末の速さに関係なく同じコマが取れる。
 *   重ねて描くときも、ここで取った時刻（t）の骨格をそのコマに描く（描く時刻と解析した時刻をずらさない）。
 */

export const MP_VERSION = '0.10.14';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
export const MODEL_URLS = {
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

/* MediaPipe の 33 点のうち使うもの（人の左右） */
const MP_INDEX = { nose: 0, lsh: 11, rsh: 12, lel: 13, rel: 14, lwr: 15, rwr: 16,
  lhip: 23, rhip: 24, lkn: 25, rkn: 26, lan: 27, ran: 28 };

let visionModule = null;
const landmarkers = {};

/** 検出器を用意する（初回だけ読み込む）。GPU で作れなければ CPU で作り直す */
export async function loadLandmarker(quality = 'full') {
  if (landmarkers[quality]) return landmarkers[quality];
  if (!visionModule) visionModule = await import(`${MP_BASE}/vision_bundle.mjs`);
  const { FilesetResolver, PoseLandmarker } = visionModule;
  const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URLS[quality], delegate },
    runningMode: 'VIDEO',
    numPoses: 1,                       // いちばん大きく写っている 1 人（＝選手）を追う
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let lm;
  try { lm = await make('GPU'); } catch { lm = await make('CPU'); }
  landmarkers[quality] = lm;
  return lm;
}

function seek(video, t) {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

/**
 * 動画の全コマ（step 秒おき）から骨格を取る。
 * onProgress(0..1) で進み具合を返す。cancel() が true を返したら途中でやめる。
 * 戻り値：[{ t, kp: { 関節: [x, y, 見えている度合い] } | null }]（座標は動画の画素）
 */
export async function extractPoses(video, landmarker, { step = 1 / 30, onProgress, cancel } = {}) {
  const W = video.videoWidth, H = video.videoHeight;
  const dur = video.duration;
  const n = Math.max(1, Math.floor(dur / step));
  const frames = [];
  video.pause();
  for (let i = 0; i < n; i++) {
    if (cancel && cancel()) break;
    const t = i * step;
    await seek(video, t);
    // VIDEO モードは時刻が増えていく必要がある（ミリ秒の整数）
    const res = landmarker.detectForVideo(video, Math.round(t * 1000) + 1);
    const L = res && res.landmarks && res.landmarks[0];
    let kp = null;
    if (L) {
      kp = {};
      for (const [k, j] of Object.entries(MP_INDEX)) {
        const p = L[j];
        kp[k] = [p.x * W, p.y * H, p.visibility ?? 1];
      }
    }
    frames.push({ t, kp });
    if (onProgress && (i % 5 === 0 || i === n - 1)) {
      onProgress((i + 1) / n);
      await new Promise((r) => setTimeout(r, 0));   // 画面を更新させる
    }
  }
  return frames;
}
