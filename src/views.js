/**
 * views.js — カメラ（三人称／一人称／骨盤クローズアップ）
 *
 * 三人称の位置は斜面フレーム（フォールライン D・横方向 C・法線 N）を基準にした
 * 方位角 az と仰角 el で決めるので、斜度を変えても見え方が破綻しない。
 * ただし画面の「上」は世界の鉛直（重力の反対）にそろえる。以前は斜面の法線を上にしていたので、
 * 横から見ると 22° の斜面が水平に見え、身体が重力に逆らって傾いているのが読めなかった。
 * 骨盤アップだけは骨盤（かんたん表示では板の向き）の座標系を基準にする。
 */
import * as THREE from 'three';

const PRESETS = {
  follow: { az: 172, el: 15, dist: 5.0, fov: 46 },
  behind: { az: 168, el: 7, dist: 3.8, fov: 52 },
  front:  { az: 8, el: 10, dist: 5.2, fov: 44 },
  side:   { az: 90, el: 6, dist: 5.4, fov: 40 },
  top:    { az: 176, el: 82, dist: 10, fov: 45 },
  free:   { az: 145, el: 16, dist: 5.6, fov: 46 },
  pelvis: { az: 34, el: 14, dist: 1.25, fov: 36 },
  /* 中継：遠くの斜面の下から長いレンズで（テレビ中継のような圧縮された遠近）。
   * 距離は種目で伸ばさない（GS でも選手が画面の高さの 1/4〜1/3、カメラがネットの内側に収まる）。
   * dist·sin(az) = 12 m で、ピステの縁（半幅 20 m 以上）まで十分ある */
  tv:     { az: 24, el: 5, dist: 30, fov: 9, fovNarrow: 14, fixedDist: true },
};

/* かんたん表示の追従：少し寄せ（選手が約 1.5 倍に）、ターンの外側から見る。
 * 外側から見ると外向（骨盤の正面が谷へ開く）と外の腰骨が見え、ターニングポールは身体の向こうへ回る。
 * 振る向きは「ターン外側の符号 × sin(π·位相)」。外側の符号は位相 1 → 0 で入れ替わり、sin も同時に
 * 符号が変わるので、切り替えで跳ばない（位相 0 と 1 でちょうど真後ろ）。
 * さらに実時間 1.2 s で慣らすので、ターンごとに大きく振られない（実測：SL 等倍速で ±6°、0.25 倍速で ±15°）。
 * 等倍速では振りが小さく、山回りの後半（位相 0.6 より後）は軌跡の向きのぶんカメラが内側に来る。
 * 距離は画面の幅で決める（狭い画面の 0.78 倍はかけない）。 */
const SIMPLE = {
  follow: { az: 180, swing: 18, el: 14, dist: 3.9, distNarrow: 3.6, fov: 46 },
};
const SIDE_TAU = 1.2;         // 回り込みを慣らす時定数 [s]（実時間。短いと酔いやすい）

/* 一人称：頭の向き（次の旗門の少し上を見ている）から少しだけ下を見る。
 * 以前の −24° では画面の 7 割が足もとの雪で、次の旗門は画面の上の端にあった。
 * −5° で次の旗門が画面の高さの真ん中 1/3 に入る（旗門の中ほどが NDC y +0.17〜+0.36、
 * 根元が −0.20〜+0.26。位相 0.2〜0.8、1440×900 と 390×844 で実測）。
 * 板の先は画面の下の外（NDC y −1.1〜−3）。入れるには大きく下を向くか縦の画角を 100° 以上にする必要があり、
 * 旗門が画面の上へ逃げるか端がゆがむので、入れない。 */
const FP_PITCH = -5;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.mode = 'third';           // 'third' | 'first' | 'pelvis'
    this.preset = 'follow';
    this.az = PRESETS.follow.az;
    this.el = PRESETS.follow.el;
    this.dist = PRESETS.follow.dist;
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.pan = new THREE.Vector3();
    this.fpYaw = 0; this.fpPitch = 0;
    this.scale = 1;              // 種目に応じた距離倍率
    // 縦長の画面では、全身は寄って大きく、骨盤（横に広い）は引いて収める
    this.aspectScale = (name) => (window.innerWidth < 820
      ? (name === 'pelvis' ? 1.45 : 0.78) : 1);
    this.simple = false;          // かんたん表示（setSimple）
    this._side = 0;               // 追従カメラを振る量（−1〜1、なめらか）
    this._phRate = 0;             // 位相の進む速さ（回り込みの先回りに使う）
    this._initInput();
    this.first = true;
  }

  _narrow() { return window.innerWidth < 820; }

  /** いまの表示（かんたん／くわしく）でのプリセットの値 */
  _preset(name) {
    return (this.simple && SIMPLE[name]) || PRESETS[name];
  }

  /** プリセットの距離（種目の倍率・画面の縦横を含む） */
  _presetDist(name) {
    const p = this._preset(name);
    if (!p) return this.dist;
    if (name === 'pelvis') return p.dist * this.aspectScale(name);
    if (p.distNarrow !== undefined) return (this._narrow() ? p.distNarrow : p.dist) * this.scale;
    if (p.fixedDist) return p.dist;
    return p.dist * this.scale * this.aspectScale(name);
  }

  _initInput() {
    const el = this.canvas;
    let dragging = 0, lx = 0, ly = 0;
    const down = (e) => {
      dragging = e.button === 2 || e.shiftKey ? 2 : 1;
      lx = e.clientX; ly = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      if (this.mode === 'first') {
        this.fpYaw = THREE.MathUtils.clamp(this.fpYaw - dx * 0.25, -70, 70);
        this.fpPitch = THREE.MathUtils.clamp(this.fpPitch - dy * 0.2, -45, 35);
        return;
      }
      if (dragging === 2) {
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
        const k = this.dist * 0.0016;
        this.pan.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
      } else {
        this.az -= dx * 0.35;
        this.el = THREE.MathUtils.clamp(this.el + dy * 0.28, -12, 88);
        if (this.preset !== 'pelvis') this.preset = 'free';
        this.onUserRotate?.();
      }
    };
    const up = () => { dragging = 0; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.exp(e.deltaY * 0.0012);
      this.dist = THREE.MathUtils.clamp(this.dist * f, this.mode === 'pelvis' ? 0.7 : 2.2, 60);
    }, { passive: false });

    // ピンチ操作
    let pinch = 0;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) pinch = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && pinch) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        this.dist = THREE.MathUtils.clamp(this.dist * (pinch / d), 0.7, 60);
        pinch = d;
      }
    }, { passive: true });
  }

  setPreset(name) {
    const p = this._preset(name);
    if (!p) return;
    this.preset = name;
    this.mode = name === 'pelvis' ? 'pelvis' : 'third';
    this.az = p.az; this.el = p.el;
    this.dist = this._presetDist(name);
    // 縦長の画面は横の画角がとても狭くなるので、望遠でも縦を少し広げる
    this.camera.fov = (this._narrow() && p.fovNarrow) || p.fov;
    this.camera.updateProjectionMatrix();
    this.pan.set(0, 0, 0);
    this.first = true;            // 切り替えたらすぐその位置へ
    this._prevT = null; this._prevEye = null;
  }

  setScale(k) {
    const old = this.scale || 1;
    this.scale = k;
    if (this.preset !== 'pelvis' && !this._preset(this.preset)?.fixedDist) this.dist *= k / old;
  }

  /**
   * かんたん表示のカメラにする／戻す。
   *   追従：ターンの外側から少し寄って見る（SIMPLE.follow）
   *   骨盤アップ：骨盤ではなく板の向き（進行方向・斜面の法線）を基準にする。
   *     こうすると板の矢印は画面の中で止まり、骨盤がそれに対して回るのが見える
   * 利用者のズーム（や比較表示の引き）は、プリセットの距離との比で引き継ぐ。
   */
  setSimple(on) {
    on = !!on;
    if (on === this.simple) return;
    const ratio = this.dist / (this._presetDist(this.preset) || this.dist || 1);
    this.simple = on;
    if (this.mode === 'third' && this.preset === 'follow') {
      const p = this._preset('follow');
      this.el = p.el;
      this.az = p.az;
      this.dist = this._presetDist('follow') * ratio;
      this.camera.fov = p.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  setMode(mode) {
    if (mode === 'first') {
      this.mode = 'first';
      // 頭につけたカメラくらいの広さ（調整値）。縦長の画面は横が狭いので、縦は少しだけ絞る
      this.camera.fov = this._narrow() ? 80 : 84;
      this.camera.updateProjectionMatrix();
      this.fpYaw = 0; this.fpPitch = 0;
      this.first = true;
      this._prevT = null; this._prevEye = null;
    } else if (mode === 'pelvis') {
      this.setPreset('pelvis');
    } else {
      this.setPreset(this.preset === 'pelvis' ? 'follow' : this.preset);
      this.mode = 'third';
    }
  }

  /**
   * 三人称の「上」：世界の鉛直を視線に垂直に落としたもの。
   * 真上から見る近く（真上ビューの el 82° など）では鉛直が視線とほぼ重なって決まらないので、
   * 斜面の法線（以前の上）へなめらかに寄せる。天頂を越えても画面が 180° 回らないよう、
   * 符号は斜面の法線の側にそろえる。
   */
  _worldUp(dir, slopeUp) {
    const yp = WORLD_UP.clone().addScaledVector(dir, -dir.y);
    const np = slopeUp.clone().addScaledVector(dir, -slopeUp.dot(dir));
    if (yp.dot(np) < 0) yp.negate();
    const k = THREE.MathUtils.smoothstep(0.25 - yp.length(), 0, 0.2);
    return yp.addScaledVector(np, k * 2).normalize();
  }

  /** 毎フレーム呼ぶ。model は TurnModel、rigState は skier.state */
  update(model, s, rigState, dt) {
    const cam = this.camera;
    const lerp = this.first ? 1 : 1 - Math.exp(-dt * 6.5);

    if (this.mode === 'first') {
      const a = rigState.anchors;
      const eye = a.eye.clone();
      const fwd = a.eyeDir.clone(), up = a.eyeUp.clone();
      const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
      const dir = fwd.clone()
        .applyAxisAngle(up, THREE.MathUtils.degToRad(this.fpYaw))
        .applyAxisAngle(right, THREE.MathUtils.degToRad(this.fpPitch + FP_PITCH))
        .normalize();
      // 滑走ぶんを先に足してから滑らかにする（でないと常に後ろへ取り残される）
      if (!this.first && this._prevEye) cam.position.add(eye.clone().sub(this._prevEye));
      this._prevEye = eye.clone();
      cam.position.lerp(eye, this.first ? 1 : 1 - Math.exp(-dt * 22));
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(cam.position, cam.position.clone().add(dir), up));
      cam.quaternion.slerp(q, this.first ? 1 : 1 - Math.exp(-dt * 18));
      this.first = false;
      return;
    }

    // 注視点
    const t = this.mode === 'pelvis'
      // 骨盤ビューは股関節が見えるよう、骨盤中心と外側の股関節の間を見る
      ? rigState.anchors.pelvis.clone().lerp(
        rigState.anchors.outerHip ?? rigState.anchors.pelvis, 0.45)
      : s.com.clone().addScaledVector(model.D, 0.5);
    /* 注視点の追従。
     * 単純な lerp だと、動いている的を追うときに
     *     遅れ ＝ 速さ ÷ 追従係数
     * の<b>ずれが残り続ける</b>。30 km/h（8.3 m/s）で係数 5 なら 1.7 m。
     * 骨盤ビューはカメラ距離が 1.25 m しかないので、数秒で骨盤が画面の外へ出ていた。
     * そこで「前のフレームからの移動ぶん」を先に足してから滑らかにする。
     * こうすると等速で動く的には遅れずに付いていき、
     * 揺れだけが滑らかになる。 */
    let moved = null;
    if (!this.first && this._prevT) {
      moved = t.clone().sub(this._prevT);
      this.smoothTarget.add(moved);
    }
    this._prevT = t.clone();
    this.smoothTarget.lerp(t, this.first ? 1 : 1 - Math.exp(-dt * 5));
    const target = this.smoothTarget.clone().add(this.pan);

    // かんたん表示の追従：ターンの外側へ少し回り込む（切り替えでは真後ろ）
    if (this.simple && this.mode === 'third' && this.preset === 'follow') {
      /* 1.2 s で慣らすと、そのぶん回り込みが遅れる（0.25 倍速で位相 0.2 ほど。
       * ターンの後半はカメラが内側に来ていた）。目標は sin の形なので、1 次遅れの遅れ
       *   atan(ωτ) / ω   （ω：振る量の角周波数＝π × 位相の進む速さ）
       * だけ先の位相で目標を作って打ち消す。止めているときは先回りしない。
       * 位相 1 を越えた先は次のターン（外側が逆）なので、sin の符号がそのまま合う。 */
      const ph = s.phase ?? 0;
      if (!this.first && this._lastPh !== undefined && dt > 0) {
        let d = ph - this._lastPh;
        if (d < -0.5) d += 1; else if (d > 0.5) d -= 1;           // ターンの継ぎ目
        const rate = THREE.MathUtils.clamp(d / dt, 0, 3);         // 位相 / 秒
        this._phRate += (rate - this._phRate) * (1 - Math.exp(-dt / 0.5));
      } else this._phRate = 0;
      this._lastPh = ph;
      const w = Math.PI * this._phRate;
      const lead = w > 1e-3 ? (Math.atan(w * SIDE_TAU) / w) * this._phRate : 0;
      const raw = Math.sign(s.outward.dot(model.C)) * Math.sin(Math.PI * (ph + lead));
      this._side += (raw - this._side) * (this.first ? 1 : 1 - Math.exp(-dt / SIDE_TAU));
      const p = SIMPLE.follow;
      this.az = p.az - p.swing * this._side;
    }

    const az = THREE.MathUtils.degToRad(this.az);
    const el = THREE.MathUtils.degToRad(this.el);
    // 骨盤ビューでは骨盤の座標系（かんたん表示では板の向き）を基準にするので、ターン中も同じ向きから見える
    const a = rigState.anchors;
    let base;
    if (this.mode === 'pelvis' && this.simple && s.tangent) {
      const r = new THREE.Vector3().crossVectors(s.tangent, model.N).normalize();
      base = { f: s.tangent, r, u: model.N };
    } else if (this.mode === 'pelvis' && a.pelvisFwd) {
      base = { f: a.pelvisFwd, r: a.pelvisRight, u: a.pelvisUp };
    } else {
      base = { f: model.D, r: model.C, u: model.N };
    }
    const dir = base.f.clone().multiplyScalar(Math.cos(az))
      .addScaledVector(base.r, Math.sin(az))
      .multiplyScalar(Math.cos(el))
      .addScaledVector(base.u, Math.sin(el))
      .normalize();
    const want = target.clone().addScaledVector(dir, this.dist);

    /* カメラの位置も、的の移動ぶんを先に足してから滑らかにする（注視点と同じ）。
     * 足さないと遅れ ＝ 速さ ÷ 6.5 が残り、30 km/h で 1.3 m 遠く、再生速度で画角が変わっていた。 */
    if (moved) cam.position.add(moved);
    cam.position.lerp(want, lerp);
    const up = this.mode === 'pelvis' ? base.u : this._worldUp(dir, base.u);
    const q = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(cam.position, target, up));
    cam.quaternion.slerp(q, lerp);
    this.first = false;
  }
}
