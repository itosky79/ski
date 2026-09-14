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
 */
import * as THREE from 'three';
import { G } from './constants.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

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
  g.userData.set = (center, a, b, radius) => {
    const A = a.clone().normalize(), B = b.clone().normalize();
    let axis = new THREE.Vector3().crossVectors(A, B);
    if (axis.lengthSq() < 1e-10) { g.visible = false; return; }
    g.visible = true;
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
      gravity: makeArrow(0xffd166),
      centrifugal: makeArrow(0xff8fd0),
      resultant: makeArrow(0xc6a4ff, 0.022),
      snow: makeArrow(0x7be0ff),
    };
    for (const a of Object.values(this.arrows)) this.group.add(a);
    this.anchors = {};
    this.refLen = 1.15;         // 体重 1 倍ぶんの矢印長 [m]
  }

  update(s) {
    const m = this.mass;
    const unit = this.refLen / (m * G);
    const { gravity, centrifugal, snow } = s.forces;
    const resultant = gravity.clone().add(centrifugal);      // = −雪面反力

    this.arrows.gravity.userData.set(s.com, V(0, -1, 0), gravity.length() * unit);
    if (centrifugal.length() > 1) {
      this.arrows.centrifugal.visible = true;
      this.arrows.centrifugal.userData.set(s.com, centrifugal, centrifugal.length() * unit);
    } else this.arrows.centrifugal.visible = false;
    this.arrows.resultant.userData.set(s.com, resultant, resultant.length() * unit);
    this.arrows.snow.userData.set(s.pressure, s.uLeg, snow.length() * unit);

    this.anchors = {
      gravity: s.com.clone().addScaledVector(V(0, -1, 0), gravity.length() * unit + 0.12),
      centrifugal: centrifugal.length() > 1
        ? s.com.clone().addScaledVector(centrifugal.clone().normalize(), centrifugal.length() * unit + 0.12) : null,
      snow: s.pressure.clone().addScaledVector(s.uLeg, snow.length() * unit + 0.12),
      resultant: s.com.clone().addScaledVector(resultant.clone().normalize(), resultant.length() * unit * 0.55),
    };
    this.values = {
      gravity: gravity.length(),
      centrifugal: centrifugal.length(),
      snow: snow.length(),
      snowBW: snow.length() / (m * G),
    };
  }

  setVisible(v) { this.group.visible = v; }
}

/* ================================================================= */
export class AngleGuides {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'guides';
    scene.add(this.group);

    this.sectors = {
      inclination: makeSector(0xffd166, 0.22),   // 内傾角
      edge: makeSector(0x7be0ff, 0.30),          // エッジ角
      counter: makeSector(0xff6b57, 0.32),       // 外向角
      angulation: makeSector(0x59d9a4, 0.28),    // 外傾角
    };
    for (const s of Object.values(this.sectors)) this.group.add(s);

    // 雪面に描く方向マーカー（スキーの向き / 骨盤の向き）
    this.skiDirArrow = makeArrow(0xffffff, 0.018);
    this.pelvisDirArrow = makeArrow(0x4cc3ff, 0.018);
    this.group.add(this.skiDirArrow, this.pelvisDirArrow);

    // 脚の線（接雪点→重心）
    this.legLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.08, gapSize: 0.05, transparent: true, opacity: 0.75 }));
    this.group.add(this.legLine);

    this.anchors = {};
    this.scale = 1;          // 骨盤クローズアップでは小さくする
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
    this.sectors.counter.userData.set(pelvisPos, skiFwdOnPelvis, a.pelvisFwd, 0.55 * K);

    /* 外傾角：股関節を頂点に、脚の線と上体の線 */
    this.sectors.angulation.userData.set(pelvisPos, s.legDir, s.torsoDir, 0.40 * K);

    /* 雪面の方向マーカー */
    const base = s.pos.clone().addScaledVector(s.normal, 0.02);
    this.skiDirArrow.userData.set(base, s.tangent, 1.5 * K);
    const pelvisOnSnow = a.pelvisFwd.clone().projectOnPlane(s.normal).normalize();
    this.pelvisDirArrow.userData.set(base, pelvisOnSnow, 1.5 * K);

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
      skiDir: base.clone().addScaledVector(s.tangent, 1.62 * K),
      pelvisDir: base.clone().addScaledVector(pelvisOnSnow, 1.62 * K),
    };
  }

  setVisible(v) { this.group.visible = v; }
}
