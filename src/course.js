/**
 * course.js — 斜面・旗門・シュプールの生成
 *
 * 旗門の寸法は FIS ICR に準拠
 *   SL  旗門幅 4〜6 m、ターニングポールはフレックスポール（雪面上 約 1.8 m）[ICR 801.2.3 / 680.2.1.1]
 *   GS  旗門幅 4〜8 m、パネルは約 75 × 50 cm、下端は雪面から約 1 m       [ICR 901.2.2 / 901.2.3]
 */
import * as THREE from 'three';

const POLE_H = 1.8;          // 雪面から出ているポールの高さ [m]
const POLE_R = 0.014;

/** 雪面テクスチャ（手続き生成） */
function snowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f7fd';
  g.fillRect(0, 0, 512, 512);
  // 粗い粒感
  const img = g.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.6;
  }
  g.putImageData(img, 0, 0);
  // 整備跡（コーデュロイ）
  g.globalAlpha = 0.10;
  g.strokeStyle = '#9fb6cf';
  g.lineWidth = 2;
  for (let x = 0; x < 512; x += 9) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

export class Course {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'course';
    scene.add(this.group);

    this.snowTex = snowTexture();
    this.snow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.snowTex, roughness: 0.92,
        side: THREE.DoubleSide }),
    );
    this.snow.receiveShadow = true;
    this.group.add(this.snow);

    this.gatesG = new THREE.Group(); this.group.add(this.gatesG);
    this.tracksG = new THREE.Group(); this.group.add(this.tracksG);
    this.guidesG = new THREE.Group(); this.group.add(this.guidesG);
  }

  /** モデルに合わせてコースを作り直す */
  build(model, { gateCount = 9, discipline }) {
    const { D, C, N } = model;
    this._fall = D.clone();
    this._across = C.clone();
    const len = model.halfCycle * (gateCount + 4);
    const width = Math.max(70, model.A * 8 + 60);

    /* --- 雪面 --- */
    this.snow.geometry.dispose();
    this.snow.geometry = new THREE.PlaneGeometry(width, len, 1, 1);
    // 平面を斜面に合わせる：+X→C, +Y→D, +Z→N（右手系になる組み合わせ）
    const m = new THREE.Matrix4().makeBasis(C, D.clone(), N);
    this.snow.quaternion.setFromRotationMatrix(m);
    this.snow.position.copy(model.onSlope(len / 2 - model.halfCycle * 2, 0, -0.01));
    this.snowTex.repeat.set(width / 3, len / 3);

    /* --- 等高線（斜度を感じるためのガイド） --- */
    this.guidesG.clear();
    const lineMat = new THREE.LineBasicMaterial({ color: 0x8fb0d0, transparent: true, opacity: 0.35 });
    for (let u = -model.halfCycle * 2; u < len; u += model.halfCycle / 2) {
      const pts = [model.onSlope(u, -width / 2, 0.005), model.onSlope(u, width / 2, 0.005)];
      this.guidesG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
    }
    // フォールライン
    const fl = new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.5 });
    this.guidesG.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      [model.onSlope(-model.halfCycle * 2, 0, 0.01), model.onSlope(len, 0, 0.01)]), fl));

    /* --- 旗門 --- */
    this.gatesG.clear();
    const gates = model.gates(gateCount, 0);
    const turning = [];                 // SL：たたかれてしなるポール
    for (const g of gates) {
      const color = g.color === 'red' ? 0xe03131 : 0x1c6fd6;
      if (discipline.hasPanel) {
        // GS：旗門は 4 本のポールと 2 枚のパネルで構成される [ICR 901.2.1]
        const across = g.outer.clone().sub(g.turning).normalize();
        const pw = discipline.panelW ?? 0.75;
        for (const base of [g.turning, g.outer]) {
          const a = base.clone().addScaledVector(across, -pw / 2);
          const b = base.clone().addScaledVector(across, pw / 2);
          const parts = [this._pole(a, N, color), this._pole(b, N, color),
            this._panel(a, b, N, color, discipline)];
          if (base === g.turning) {
            // ターニング側は選手が肩で押していくので、旗門ごと傾く
            const unit = this._pivot(base, N, Math.sign(g.wTurn) || 1, parts);
            unit.userData.turning = g;
            unit.userData.bend = (v) => { unit.userData.tilt.rotation.x = v * 0.20; };
            turning.push(unit);
            this.gatesG.add(unit);
          } else {
            for (const p of parts) this.gatesG.add(p);
          }
        }
      } else {
        const t = this._pole(g.turning, N, color, 1, Math.sign(g.wTurn) || 1);
        t.userData.turning = g;
        t.userData.bend = (v) => {
          const share = [0.26, 0.34, 0.40];      // 上の節ほど大きく＝弓なり
          t.userData.joints.forEach((j, i) => { j.rotation.x = v * share[i]; });
        };
        turning.push(t);
        this.gatesG.add(t);
        this.gatesG.add(this._pole(g.outer, N, color, 0.85, Math.sign(g.wTurn) || 1));
      }
    }
    this.gates = gates;
    this.turningPoles = turning;
    this.hasPanel = !!discipline.hasPanel;

    /* --- シュプール（両スキーの通り道） --- */
    this.tracksG.clear();
    for (const sgn of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 400; i++) {
        const u = -model.halfCycle + (len + model.halfCycle) * (i / 400);
        const w1 = model.dw(u);
        const eLat = new THREE.Vector3().addScaledVector(D, -w1).addScaledVector(C, 1).normalize();
        // スタンス幅はエッジ角とともに変わるので、シュプールの間隔も一定ではない
        const half = model.sample(Math.max(0, u)).stance / 2;
        pts.push(model.trackPoint(u, 0.012).addScaledVector(eLat, sgn * half));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      this.tracksG.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0x2e6fa8, transparent: true, opacity: 0.55,
      })));
    }
    // 重心の軌跡
    const comPts = [];
    for (let i = 0; i <= 400; i++) {
      const u = (len + model.halfCycle) * (i / 400) - model.halfCycle * 0.5;
      comPts.push(model.sample(Math.max(0, u)).com);
    }
    this.comLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(comPts),
      new THREE.LineBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.6 }));
    this.tracksG.add(this.comLine);

    return this;
  }

  /**
   * ポール 1 本。根元を原点にして、ローカル +y を雪面法線に合わせる。
   * ローカル +z は「たたかれたときに倒れる向き」＝斜面下方向に、
   * コースの外側へ少し振ったもの。こうしておくと、しなりは
   * ローカル +x まわりの回転だけで出せる。
   *
   * 軸は 3 節に分けてあり、上の節ほど大きく曲げる。
   * 1 本の棒を根元で倒すと「折れた」ように見えるが、
   * 実物のフレックスポールは弓なりにしなるため。
   */
  _pole(base, N, color, scale = 1, away = 0) {
    const g = new THREE.Group();
    const h = POLE_H * scale;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
    const nSeg = 3;
    const joints = [];
    let parent = g;
    for (let i = 0; i < nSeg; i++) {
      const j = new THREE.Group();
      if (i > 0) j.position.y = h / nSeg;
      const r0 = POLE_R * (1.15 - 0.10 * i), r1 = POLE_R * (1.15 - 0.10 * (i + 1));
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, h / nSeg, 10), mat);
      seg.position.y = h / nSeg / 2;
      seg.castShadow = true;
      j.add(seg);
      parent.add(j);
      parent = j;
      joints.push(j);
    }
    g.userData.joints = joints;
    g.position.copy(base);
    // 倒れる向き：フォールライン ＋ コースの外側へ少し
    const D = this._fall ?? new THREE.Vector3(0, 0, 1);
    const C = this._across ?? new THREE.Vector3(1, 0, 0);
    const dir = D.clone().addScaledVector(C, away * 0.55);
    const Z = dir.addScaledVector(N, -dir.dot(N)).normalize();
    const X = new THREE.Vector3().crossVectors(N, Z).normalize();
    g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, N, Z));
    return g;
  }

  /**
   * すでにワールド座標で作った部品を、ポールの根元を中心にした
   * ヒンジの下へ付け替える。GS は旗門ごと傾くのでこれが要る。
   */
  _pivot(base, N, away, parts) {
    const pivot = new THREE.Group();
    // 基準姿勢（quaternion）を持つノードに rotation.x を書くと、
    // Euler ↔ quaternion が連動しているせいで基準姿勢そのものが壊れる。
    // 傾ける用のノードを内側にもう 1 つ作って、そちらだけ回す。
    const tilt = new THREE.Group();
    pivot.add(tilt);
    pivot.userData.tilt = tilt;
    pivot.position.copy(base);
    const D = this._fall ?? new THREE.Vector3(0, 0, 1);
    const C = this._across ?? new THREE.Vector3(1, 0, 0);
    const dir = D.clone().addScaledVector(C, away * 0.55);
    const Z = dir.addScaledVector(N, -dir.dot(N)).normalize();
    const X = new THREE.Vector3().crossVectors(N, Z).normalize();
    pivot.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, N, Z));
    pivot.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(pivot.matrixWorld).invert();
    for (const p of parts) {
      p.updateMatrix();            // position/quaternion を matrix に反映してから変換する
      p.applyMatrix4(inv);
      tilt.add(p);
    }
    return pivot;
  }

  /** パネル：約 75 × 50 cm、下端は雪面から約 1 m [ICR 901.2.2] */
  _panel(a, b, N, color, disc) {
    const g = new THREE.Group();
    const mid = a.clone().lerp(b, 0.5);
    const dir = b.clone().sub(a).normalize();
    const w = a.distanceTo(b) * 0.98;
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(w, disc.panelH ?? 0.5),
      new THREE.MeshStandardMaterial({ color, roughness: 0.75, side: THREE.DoubleSide }));
    const up = N.clone();
    const fwd = new THREE.Vector3().crossVectors(dir, up).normalize();
    panel.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, up, fwd));
    panel.position.copy(mid).addScaledVector(up, (disc.panelBottom ?? 1.0) + (disc.panelH ?? 0.5) / 2);
    g.add(panel);
    return g;
  }

  /**
   * ポールのしなり。SL のターニングポールは根元がヒンジになっていて、
   * たたかれると倒れ、通り過ぎたあと減衰しながら揺れて戻る。
   *
   * 時刻の状態を持たず、<b>滑走距離 u だけの関数</b>にしてある。
   * こうするとタイムラインを手でドラッグしても矛盾なく再現される。
   *
   *   x = u − ポールの u
   *   x < 0            : 近づくぶんだけ倒れていく
   *   x ≥ 0            : maxBend · exp(−x/L) · cos(2πx/P)   （減衰振動）
   *
   * @param {number} u いまの滑走距離
   */
  updateGates(u) {
    if (!this.turningPoles) return;
    const maxBend = 1.45;                // rad（先端まで合計でおよそ 83°）
    const hitAt = -0.12;                 // 手が当たるのは身体が並ぶ少し手前
    const rise = 0.85;                   // 当たるまでに倒れていく距離 [m]
    const L = 2.4, P = 2.0;              // 戻りの減衰距離と揺れの周期 [m]
    for (const g of this.turningPoles) {
      const x = u - g.userData.turning.u;
      let bend;
      if (x < hitAt - rise) bend = 0;
      else if (x < hitAt) bend = maxBend * ((x - hitAt + rise) / rise) ** 3;
      else {
        const t = x - hitAt;
        bend = maxBend * Math.exp(-t / L) * Math.cos((Math.PI * 2 * t) / P);
      }
      g.userData.bend(bend);
    }
  }

  setVisible({ tracks, gates }) {
    if (tracks !== undefined) this.tracksG.visible = tracks;
    if (gates !== undefined) this.gatesG.visible = gates;
  }
}
