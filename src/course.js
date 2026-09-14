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
    for (const g of gates) {
      const color = g.color === 'red' ? 0xe03131 : 0x1c6fd6;
      if (discipline.hasPanel) {
        // GS：旗門は 4 本のポールと 2 枚のパネルで構成される [ICR 901.2.1]
        const across = g.outer.clone().sub(g.turning).normalize();
        const pw = discipline.panelW ?? 0.75;
        for (const base of [g.turning, g.outer]) {
          const a = base.clone().addScaledVector(across, -pw / 2);
          const b = base.clone().addScaledVector(across, pw / 2);
          this.gatesG.add(this._pole(a, N, color), this._pole(b, N, color));
          this.gatesG.add(this._panel(a, b, N, color, discipline));
        }
      } else {
        this.gatesG.add(this._pole(g.turning, N, color));
        this.gatesG.add(this._pole(g.outer, N, color, 0.85));
      }
    }
    this.gates = gates;

    /* --- シュプール（両スキーの通り道） --- */
    this.tracksG.clear();
    const half = model.p.stanceWidth / 2;
    for (const sgn of [1, -1]) {
      const pts = [];
      for (let i = 0; i <= 400; i++) {
        const u = -model.halfCycle + (len + model.halfCycle) * (i / 400);
        const w1 = model.dw(u);
        const eLat = new THREE.Vector3().addScaledVector(D, -w1).addScaledVector(C, 1).normalize();
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

  _pole(base, N, color, scale = 1) {
    const g = new THREE.Group();
    const h = POLE_H * scale;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(POLE_R, POLE_R * 1.15, h, 10),
      new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
    shaft.position.set(0, h / 2, 0);
    g.add(shaft);
    g.position.copy(base);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), N);
    return g;
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

  setVisible({ tracks, gates }) {
    if (tracks !== undefined) this.tracksG.visible = tracks;
    if (gates !== undefined) this.gatesG.visible = gates;
  }
}
