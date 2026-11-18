/**
 * forces.js — 力のベクトルと角度ガイド
 *
 * 表示する力（回転座標系での自由体図）
 *   重力     m·g            重心から鉛直下向き
 *   遠心力   m·v²/R         重心からターン外向き（慣性力）
 *   合力     重力＋遠心力    重心から脚の線に沿って下向き
 *   雪面反力 −(重力＋遠心力) 接雪点から重心へ向かう ＝ 脚で支えている力
 *
 * 角度ガイド
 *   内傾角 λ：斜面法線と「接雪点→重心」の線
 *   エッジ角 ψ：雪面とスキーの滑走面
 *   外向角 φ：スキーの進行方向と骨盤の正面（＝この教材の主役）
 *   外傾角 α：脚の線と上体の線
 *
 * 色の約束：黄色は「いま、これをする」（動作ガイド）だけ。重力・圧の中心は淡い灰白、
 * 内傾角は「結果」の紫（入力＝青い枠／結果＝紫の点線と同じ紫）にする。
 * 矢印・扇形・線はどれも重心や骨盤（＝身体の中）から出るので、不透明な身体に
 * 隠れないよう深度テストを切って上に描く（renderOrder 15。動作ガイドの 20 より下）。
 */
import * as THREE from 'three';
import { G } from './constants.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

const OVERLAY_ORDER = 15;
const DIAL_DROP = 0.15;         // 目盛り板を骨盤の中心から下げる量 [m]（坐骨結節の少し下）

/** 身体に隠れないオーバーレイにする（深度テストなし・後から描く） */
function overlay(obj) {
  obj.traverse((o) => {
    o.renderOrder = OVERLAY_ORDER;
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) { m.depthTest = false; m.depthWrite = false; m.transparent = true; }
  });
  return obj;
}

/* ---------------- 矢印 ---------------- */
function makeArrow(color, radius = 0.028) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 12), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(radius * 2.7, radius * 7, 14), mat);
  g.add(shaft, head);
  g.userData.set = (origin, dir, len) => {
    const d = dir.clone().normalize();
    const headLen = Math.min(radius * 7, len * 0.32);
    const shaftLen = Math.max(1e-3, len - headLen);
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d);
    g.position.copy(origin);
    g.quaternion.copy(q);
    shaft.position.set(0, shaftLen / 2, 0);
    shaft.scale.set(1, shaftLen, 1);
    head.position.set(0, shaftLen + headLen / 2, 0);
    head.scale.setScalar(1);
    head.geometry.dispose();
    head.geometry = new THREE.ConeGeometry(radius * 2.7, headLen, 14);
  };
  g.userData.mat = mat;
  return g;
}

/* ---------------- 角度の扇形 ---------------- */
function makeSector(color, opacity = 0.3) {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  const edgeMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const edge = new THREE.Line(new THREE.BufferGeometry(), edgeMat);
  const g = new THREE.Group();
  g.add(mesh, edge);
  /** center を頂点に、a→b の間を radius の扇形で塗る */
  // enabled：表示モード（骨盤ビュー・setOnly）で出すかどうか。毎フレームの set で上書きしない
  g.userData.enabled = true;
  g.userData.set = (center, a, b, radius) => {
    const A = a.clone().normalize(), B = b.clone().normalize();
    let axis = new THREE.Vector3().crossVectors(A, B);
    if (axis.lengthSq() < 1e-10) { g.visible = false; return; }
    g.visible = g.userData.enabled;
    axis.normalize();
    const ang = Math.acos(THREE.MathUtils.clamp(A.dot(B), -1, 1));
    const N = Math.max(3, Math.ceil(ang / 0.06));
    const verts = [center.x, center.y, center.z];
    const rim = [];
    for (let i = 0; i <= N; i++) {
      const p = center.clone().addScaledVector(A.clone().applyAxisAngle(axis, ang * i / N), radius);
      verts.push(p.x, p.y, p.z);
      rim.push(p);
    }
    const idx = [];
    for (let i = 1; i <= N; i++) idx.push(0, i, i + 1);
    const geo = mesh.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    edge.geometry.dispose();
    edge.geometry = new THREE.BufferGeometry().setFromPoints([center, ...rim, center]);
    g.userData.mid = center.clone().addScaledVector(
      A.clone().applyAxisAngle(axis, ang / 2), radius * 1.16);
    g.userData.angle = ang;
  };
  return g;
}

/* ================================================================= */
export class ForceView {
  constructor(scene, mass = 75) {
    this.mass = mass;
    this.group = new THREE.Group();
    this.group.name = 'forces';
    scene.add(this.group);
    this.arrows = {
      gravity: makeArrow(0xe6e9ef),
      centrifugal: makeArrow(0xff8fd0),
      resultant: makeArrow(0xc6a4ff, 0.022),
      snowOuter: makeArrow(0x7be0ff, 0.030),
      snowInner: makeArrow(0x4aa8cc, 0.020),
    };
    for (const a of Object.values(this.arrows)) this.group.add(overlay(a));

    /* 圧の中心（CP）：板のどこに力が乗っているか */
    this.cp = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.008, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xe6e9ef }));
    ring.rotation.x = Math.PI / 2;
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xe6e9ef }));
    this.cp.add(ring, dot);
    this.group.add(overlay(this.cp));
    this.anchors = {};
    this.refLen = 1.15;         // 体重 1 倍ぶんの矢印長 [m]
    this.scale = 1;             // 骨盤クローズアップでは短くする
  }

  update(s) {
    const m = this.mass;
    const unit = this.refLen * this.scale / (m * G);
    const { gravity, centrifugal, snow } = s.forces;
    const resultant = gravity.clone().add(centrifugal);      // = −雪面反力

    this.arrows.gravity.userData.set(s.com, V(0, -1, 0), gravity.length() * unit);
    if (centrifugal.length() > 1) {
      this.arrows.centrifugal.visible = true;
      this.arrows.centrifugal.userData.set(s.com, centrifugal, centrifugal.length() * unit);
    } else this.arrows.centrifugal.visible = false;
    this.arrows.resultant.userData.set(s.com, resultant, resultant.length() * unit);

    /* 外スキーと内スキーに分けて力を描く */
    const fo = s.forceOuter ?? snow, fi = s.forceInner ?? snow.clone().multiplyScalar(0);
    const outerFoot = s.outerFoot.clone();
    const innerFoot = s.innerFoot.clone().addScaledVector(s.tangent, s.innerLead ?? 0);
    this.arrows.snowOuter.userData.set(outerFoot, s.uLeg, fo.length() * unit);
    this.arrows.snowInner.visible = fi.length() > 1;
    if (this.arrows.snowInner.visible) {
      this.arrows.snowInner.userData.set(innerFoot, s.uLeg, fi.length() * unit);
    }

    /* 圧の中心 */
    this.cp.position.copy(s.pressure);
    this.cp.quaternion.setFromUnitVectors(V(0, 1, 0), s.normal);

    this.anchors = {
      gravity: s.com.clone().addScaledVector(V(0, -1, 0), gravity.length() * unit + 0.12),
      centrifugal: centrifugal.length() > 1
        ? s.com.clone().addScaledVector(centrifugal.clone().normalize(), centrifugal.length() * unit + 0.12) : null,
      snow: outerFoot.clone().addScaledVector(s.uLeg, fo.length() * unit + 0.12),
      snowInner: innerFoot.clone().addScaledVector(s.uLeg, fi.length() * unit + 0.10),
      resultant: s.com.clone().addScaledVector(resultant.clone().normalize(), resultant.length() * unit * 0.55),
      cp: s.pressure.clone().addScaledVector(s.normal, 0.10),
    };
    this.values = {
      gravity: gravity.length(),
      centrifugal: centrifugal.length(),
      snow: snow.length(),
      snowBW: snow.length() / (m * G),
      outerBW: fo.length() / (m * G),
      innerBW: fi.length() / (m * G),
      cpOffset: s.cpOffset ?? 0,
    };
  }

  setVisible(v) { this.group.visible = v; }
  setScale(k) { this.scale = k; }
}

/* ================================================================= */
export class AngleGuides {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'guides';
    scene.add(this.group);

    this.sectors = {
      inclination: makeSector(0xb9a2f2, 0.22),   // 内傾角（結果なので紫）
      edge: makeSector(0x7be0ff, 0.30),          // エッジ角
      counter: makeSector(0xff6b57, 0.32),       // 外向角
      angulation: makeSector(0x59d9a4, 0.28),    // 外傾角
    };
    for (const s of Object.values(this.sectors)) this.group.add(overlay(s));

    // 雪面に描く方向マーカー（スキーの向き / 骨盤の向き）
    this.skiDirArrow = overlay(makeArrow(0xffffff, 0.018));
    this.pelvisDirArrow = overlay(makeArrow(0x4cc3ff, 0.018));
    this.group.add(this.skiDirArrow, this.pelvisDirArrow);

    // 脚の線（接雪点→重心）
    this.legLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.08, gapSize: 0.05, transparent: true, opacity: 0.75 }));
    this.group.add(overlay(this.legLine));

    /* 骨盤の高さの目盛り板（setOnly で 'dirs' のときだけ）。
     * 雪面の矢印は骨盤から 1 m 近く下にあって、骨盤のアップでは画面の外に出る。
     * スキーの向き（白）と骨盤の向き（青）を骨盤のすぐ下の板に並べると、
     * 外向角の赤い扇がちょうど 2 本の矢印の間に入る。
     * 板は深度テストありで描く（骨の手前・奥が分かるように）。矢印と扇はその上に描く。 */
    this.dial = new THREE.Group();
    const dialMat = new THREE.MeshBasicMaterial({ color: 0x0d1520, transparent: true, opacity: 0.38,
      side: THREE.DoubleSide, depthWrite: false });
    const dialFace = new THREE.Mesh(new THREE.CircleGeometry(1, 48), dialMat);
    const rimPts = [];
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      rimPts.push(V(Math.cos(t), Math.sin(t), 0));
    }
    const dialRim = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(rimPts),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
    dialFace.renderOrder = dialRim.renderOrder = OVERLAY_ORDER - 1;
    this.dial.add(dialFace, dialRim);
    this.dial.visible = false;
    this.group.add(this.dial);

    this.anchors = {};
    this.scale = 1;          // 骨盤クローズアップでは小さくする
    this.pelvisMode = false;
    this.only = null;        // setOnly で絞った表示（null なら通常）
  }

  setScale(k) { this.scale = k; }

  update(s, rig) {
    const K = this.scale;
    const a = rig.state.anchors;
    const pelvisPos = a.pelvis;

    /* 内傾角：斜面法線 vs 脚の線（接雪点を頂点に） */
    this.sectors.inclination.userData.set(s.pressure, s.normal, s.uLeg, 0.62 * K);

    /* エッジ角：雪面（外向き水平）vs スキーの滑走面 */
    const snowDir = s.outward.clone();
    const skiPlaneDir = new THREE.Vector3().crossVectors(s.tangent, a.skiNormal).normalize();
    const outSign = skiPlaneDir.dot(s.outward) > 0 ? 1 : -1;
    this.sectors.edge.userData.set(
      s.outerFoot, snowDir, skiPlaneDir.multiplyScalar(outSign), 0.42 * K);

    /* 外向角：骨盤の位置で「スキーの向き」と「骨盤の正面」 */
    const up = a.pelvisUp;
    const skiFwdOnPelvis = s.tangent.clone().projectOnPlane(up).normalize();
    const dial = this.dial.visible;
    let dialC = null, dialLen = 0;
    if (dial) {
      // 目盛り板は骨盤のすぐ下（坐骨より下）。骨盤の高さに置くと板が色分けした骨を横切って隠す
      dialC = pelvisPos.clone().addScaledVector(up, -DIAL_DROP);
      dialLen = 0.75 * K;
      this.dial.position.copy(dialC);
      this.dial.quaternion.setFromUnitVectors(V(0, 0, 1), up);
      this.dial.scale.setScalar(dialLen * 1.12);
      const pf = a.pelvisFwd.clone().projectOnPlane(up).normalize();
      // 扇は 2 本の矢印のあいだを、矢印とほぼ同じ長さで塗る（斜めから見ても開きが読めるように）
      this.sectors.counter.userData.set(dialC, skiFwdOnPelvis, pf, dialLen * 0.92);
    } else {
      this.sectors.counter.userData.set(pelvisPos, skiFwdOnPelvis, a.pelvisFwd, 0.55 * K);
    }

    /* 外傾角：股関節を頂点に、脚の線と上体の線 */
    this.sectors.angulation.userData.set(pelvisPos, s.legDir, s.torsoDir, 0.40 * K);

    /* 方向マーカー：通常は雪面、setOnly の 'dirs' では骨盤の下の目盛り板の上 */
    let base, skiDir, pelvisDir, dirLen;
    if (dial) {
      base = dialC;
      skiDir = skiFwdOnPelvis;
      pelvisDir = a.pelvisFwd.clone().projectOnPlane(up).normalize();
      dirLen = dialLen;
    } else {
      base = s.pos.clone().addScaledVector(s.normal, 0.02);
      skiDir = s.tangent;
      pelvisDir = a.pelvisFwd.clone().projectOnPlane(s.normal).normalize();
      dirLen = 1.5 * K;
    }
    // 板の上では細くする（雪面用の太さのままだと、骨盤のアップで矢印が骨より太く見える）
    const w = dial ? 0.6 : 1;
    this.skiDirArrow.userData.set(base, skiDir, dirLen / w);
    this.skiDirArrow.scale.setScalar(w);
    this.pelvisDirArrow.userData.set(base, pelvisDir, dirLen / w);
    this.pelvisDirArrow.scale.setScalar(w);
    const pelvisOnSnow = pelvisDir;

    /* 脚の線 */
    this.legLine.geometry.dispose();
    this.legLine.geometry = new THREE.BufferGeometry().setFromPoints([
      s.pressure.clone(), s.com.clone(),
    ]);
    this.legLine.computeLineDistances();

    this.anchors = {
      inclination: this.sectors.inclination.userData.mid,
      edge: this.sectors.edge.userData.mid,
      counter: this.sectors.counter.userData.mid,
      angulation: this.sectors.angulation.userData.mid,
      skiDir: base.clone().addScaledVector(skiDir, dirLen * 1.08),
      pelvisDir: base.clone().addScaledVector(pelvisOnSnow, dirLen * 1.08),
    };
  }

  setVisible(v) { this.group.visible = v; }

  /** 骨盤クローズアップでは、骨盤まわりの角度だけを残す */
  setPelvisMode(on) {
    this.pelvisMode = on;
    this._applyVisibility();
  }

  /**
   * 出すものを絞る。keys は 'inclination' | 'edge' | 'counter' | 'angulation' |
   * 'dirs'（スキーと骨盤の向きの矢印。骨盤の高さの板の上に出す）| 'leg'（脚の線）。
   * null で通常（setPelvisMode に従う）に戻す。
   * かんたん表示の骨盤アップは ['counter', 'dirs']：白＝スキー、青＝骨盤、その間の赤＝外向。
   */
  setOnly(keys) {
    this.only = keys && keys.length ? new Set(keys) : null;
    this._applyVisibility();
  }

  _applyVisibility() {
    const only = this.only, pv = this.pelvisMode;
    const on = (k, normal) => (only ? only.has(k) : normal);
    const sec = this.sectors;
    sec.inclination.userData.enabled = on('inclination', !pv);
    sec.edge.userData.enabled = on('edge', !pv);
    sec.counter.userData.enabled = on('counter', true);
    // 目盛り板の上では扇を濃くする（板の暗い地の上で赤が沈まないように）
    sec.counter.children[0].material.opacity = only && only.has('dirs') ? 0.55 : 0.32;
    sec.angulation.userData.enabled = on('angulation', true);
    for (const g of Object.values(sec)) g.visible = g.userData.enabled;
    const dirs = on('dirs', !pv);
    this.skiDirArrow.visible = this.pelvisDirArrow.visible = dirs;
    this.legLine.visible = on('leg', !pv);
    this.dial.visible = !!only && only.has('dirs');
  }
}
