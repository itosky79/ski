/**
 * views.js — カメラ（三人称／一人称／骨盤クローズアップ）
 *
 * 三人称は斜面フレーム（フォールライン D・横方向 C・法線 N）を基準にした
 * 方位角 az と仰角 el で位置を決めるので、斜度を変えても見え方が破綻しない。
 */
import * as THREE from 'three';

const PRESETS = {
  follow: { az: 172, el: 15, dist: 5.0, fov: 46 },
  behind: { az: 168, el: 7, dist: 3.8, fov: 52 },
  front:  { az: 8, el: 10, dist: 5.2, fov: 44 },
  side:   { az: 90, el: 6, dist: 5.4, fov: 40 },
  top:    { az: 176, el: 82, dist: 10, fov: 45 },
  free:   { az: 145, el: 16, dist: 5.6, fov: 46 },
  pelvis: { az: 44, el: 14, dist: 1.45, fov: 36 },
};

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
    this._initInput();
    this.first = true;
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
    const p = PRESETS[name];
    if (!p) return;
    this.preset = name;
    this.mode = name === 'pelvis' ? 'pelvis' : 'third';
    this.az = p.az; this.el = p.el;
    this.dist = p.dist * (name === 'pelvis' ? 1 : this.scale);
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
    this.pan.set(0, 0, 0);
  }

  setScale(k) {
    const old = this.scale || 1;
    this.scale = k;
    if (this.preset !== 'pelvis') this.dist *= k / old;
  }

  setMode(mode) {
    if (mode === 'first') {
      this.mode = 'first';
      this.camera.fov = 78;
      this.camera.updateProjectionMatrix();
      this.fpYaw = 0; this.fpPitch = 0;
    } else if (mode === 'pelvis') {
      this.setPreset('pelvis');
    } else {
      this.setPreset(this.preset === 'pelvis' ? 'follow' : this.preset);
      this.mode = 'third';
    }
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
        .applyAxisAngle(right, THREE.MathUtils.degToRad(this.fpPitch - 24))
        .normalize();
      cam.position.lerp(eye, this.first ? 1 : 1 - Math.exp(-dt * 22));
      const q = new THREE.Quaternion().setFromRotationMatrix(
        new THREE.Matrix4().lookAt(cam.position, cam.position.clone().add(dir), up));
      cam.quaternion.slerp(q, this.first ? 1 : 1 - Math.exp(-dt * 18));
      this.first = false;
      return;
    }

    // 注視点
    const t = this.mode === 'pelvis'
      ? rigState.anchors.pelvis.clone()
      : s.com.clone().addScaledVector(model.D, 0.5);
    this.smoothTarget.lerp(t, this.first ? 1 : 1 - Math.exp(-dt * 5));
    const target = this.smoothTarget.clone().add(this.pan);

    const az = THREE.MathUtils.degToRad(this.az);
    const el = THREE.MathUtils.degToRad(this.el);
    const dir = model.D.clone().multiplyScalar(Math.cos(az))
      .addScaledVector(model.C, Math.sin(az))
      .multiplyScalar(Math.cos(el))
      .addScaledVector(model.N, Math.sin(el))
      .normalize();
    const want = target.clone().addScaledVector(dir, this.dist);

    cam.position.lerp(want, lerp);
    const q = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().lookAt(cam.position, target, model.N));
    cam.quaternion.slerp(q, lerp);
    this.first = false;
  }
}
