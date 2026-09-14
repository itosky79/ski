/**
 * ui.js — 画面まわり（数値表示・骨盤コンパス・推移グラフ・3D ラベル）
 */
import * as THREE from 'three';
import { BONE_COLORS, PHASES, LEVELS } from './constants.js';

const deg = (r) => r * 180 / Math.PI;
const $ = (s) => document.querySelector(s);

/* ============================================================ */
/* 3D → 画面 のラベル                                            */
/* ============================================================ */
export class LabelLayer {
  constructor(el) {
    this.el = el;
    this.items = new Map();
    this.v = new THREE.Vector3();
  }
  set(key, text, pos, cls = '') {
    let it = this.items.get(key);
    if (!it) {
      const d = document.createElement('div');
      d.className = 'lbl ' + cls;
      this.el.appendChild(d);
      it = { d, pos: new THREE.Vector3() };
      this.items.set(key, it);
    }
    if (it.d.textContent !== text) it.d.innerHTML = text;
    it.pos.copy(pos);
    it.live = true;
  }
  /**
   * ラベルを画面へ投影する。
   * focus（スキーヤーの位置）が与えられたら、その周りの一定半径より外へ押し出し、
   * さらに縦方向の重なりをほどいて読みやすくする。
   */
  render(camera, size, focus = null, minR = 96) {
    let fx = null, fy = null;
    if (focus) {
      this.v.copy(focus).project(camera);
      fx = (this.v.x * 0.5 + 0.5) * size.w;
      fy = (-this.v.y * 0.5 + 0.5) * size.h;
    }
    const placed = [];
    for (const [, it] of this.items) {
      if (!it.live) { it.d.style.display = 'none'; continue; }
      this.v.copy(it.pos).project(camera);
      if (this.v.z >= 1) { it.d.style.display = 'none'; it.live = false; continue; }
      let x = (this.v.x * 0.5 + 0.5) * size.w;
      let y = (-this.v.y * 0.5 + 0.5) * size.h;
      if (fx !== null) {
        let dx = x - fx, dy = y - fy;
        const d = Math.hypot(dx, dy);
        if (d < 1) { dx = 0; dy = -1; }
        if (d < minR) {
          const k = minR / Math.max(1, d);
          x = fx + dx * k; y = fy + dy * k;
        }
      }
      // 縦の重なりをほどく
      for (const q of placed) {
        if (Math.abs(x - q.x) < 88 && Math.abs(y - q.y) < 19) {
          y = q.y + (y >= q.y ? 19 : -19);
        }
      }
      placed.push({ x, y });
      it.d.style.display = '';
      it.d.style.left = `${Math.round(x)}px`;
      it.d.style.top = `${Math.round(y)}px`;
      it.live = false;
    }
  }

  clearAll() { for (const it of this.items.values()) it.d.style.display = 'none'; }
}

/* ============================================================ */
/* UI 本体                                                       */
/* ============================================================ */
export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.readoutDefs = [
      { k: 'speed', label: '速度', unit: 'km/h' },
      { k: 'radius', label: '旋回半径', unit: 'm' },
      { k: 'counter', label: '外向角（骨盤）', unit: '°', hi: '--outer' },
      { k: 'angulation', label: '外傾角（腰）', unit: '°', hi: '--inner' },
      { k: 'inclination', label: '内傾角（力学）', unit: '°' },
      { k: 'edge', label: 'エッジ角', unit: '°' },
      { k: 'load', label: '外脚が支える力', unit: '体重比' },
      { k: 'share', label: '外脚の荷重配分', unit: '%' },
      { k: 'carve', label: 'カービング判定', unit: '', wide: true },
    ];
    this._buildReadouts();
    this._buildLegend();
    this._buildTicks();
    this._wire();
    this.compass = $('#compass');
    this.chart = $('#chart');
    this.cctx = this.compass.getContext('2d');
    this.chctx = this.chart.getContext('2d');
    this._fitCanvas(this.compass, this.cctx);
    this._fitCanvas(this.chart, this.chctx);
    window.addEventListener('resize', () => {
      this._fitCanvas(this.compass, this.cctx);
      this._fitCanvas(this.chart, this.chctx);
      if (this.series) this.drawChart(this.series, this.lastPhase ?? 0);
    });
  }

  _fitCanvas(c, ctx) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth || 260, h = Math.round(w * (c === this.chart ? 0.46 : 0.5));
    c.width = w * dpr; c.height = h * dpr;
    c.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    c._w = w; c._h = h;
  }

  _buildReadouts() {
    const box = $('#readouts');
    box.innerHTML = '';
    this.ro = {};
    for (const d of this.readoutDefs) {
      const el = document.createElement('div');
      el.className = 'ro' + (d.wide ? ' wide' : '');
      el.innerHTML = `<span>${d.label}</span><b>—<i>${d.unit}</i></b>`;
      box.appendChild(el);
      this.ro[d.k] = el.querySelector('b');
      if (d.hi) this.ro[d.k].style.color = `var(${d.hi})`;
    }
  }

  _buildLegend() {
    const ul = $('#bone-legend');
    if (!ul) return;
    for (const [, v] of Object.entries(BONE_COLORS)) {
      if (!v.name) continue;
      const li = document.createElement('li');
      li.innerHTML = `<i style="background:#${v.hex.toString(16).padStart(6, '0')}"></i>${v.name}`;
      li.title = v.note || '';
      ul.appendChild(li);
    }
  }

  _buildTicks() {
    const box = $('#phase-ticks');
    if (!box) return;
    for (const p of PHASES) {
      const i = document.createElement('i');
      i.textContent = p.name;
      i.style.left = `${((p.from + p.to) / 2) * 100}%`;
      box.appendChild(i);
    }
  }

  _wire() {
    const h = this.h;
    document.querySelectorAll('[data-discipline]').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('[data-discipline]').forEach((x) =>
          x.setAttribute('aria-pressed', String(x === b)));
        h.onDiscipline(b.dataset.discipline);
      });
    });
    document.querySelectorAll('[data-view]').forEach((b) => {
      b.addEventListener('click', () => this.setView(b.dataset.view));
    });
    document.querySelectorAll('[data-cam]').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('[data-cam]').forEach((x) =>
          x.setAttribute('aria-pressed', String(x === b)));
        this.setView('third', true);
        h.onCamera(b.dataset.cam);
      });
    });
    document.querySelectorAll('[data-level]').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('[data-level]').forEach((x) =>
          x.setAttribute('aria-pressed', String(x === b)));
        h.onLevel(b.dataset.level);
      });
    });

    this.sliders = {
      counter: $('#rng-counter'), angulation: $('#rng-angulation'),
      speed: $('#rng-speed'), slope: $('#rng-slope'),
      gate: $('#rng-gate'), offset: $('#rng-offset'),
    };
    for (const [k, el] of Object.entries(this.sliders)) {
      el.addEventListener('input', () => {
        this._paintSlider(el);
        h.onParam(k, parseFloat(el.value));
      });
    }
    const toggles = ['forces', 'body', 'skeleton', 'pelvis', 'angles', 'track', 'gates', 'ghost'];
    this.toggles = {};
    for (const t of toggles) {
      const el = $('#tg-' + t);
      this.toggles[t] = el;
      el.addEventListener('change', () => h.onToggle(t, el.checked));
    }

    $('#btn-play').addEventListener('click', () => h.onPlayToggle());
    $('#rng-phase').addEventListener('input', (e) => h.onScrub(parseFloat(e.target.value) / 1000));
    $('#sel-rate').addEventListener('change', (e) => h.onRate(parseFloat(e.target.value)));
    $('#btn-help').addEventListener('click', () => this.toggleHelp(true));
    $('#btn-help-close').addEventListener('click', () => this.toggleHelp(false));
    $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') this.toggleHelp(false); });
    $('#btn-panels').addEventListener('click', () => document.body.classList.toggle('panels-hidden'));
  }

  _paintSlider(el) {
    const pct = (el.value - el.min) / (el.max - el.min) * 100;
    el.style.setProperty('--pct', pct + '%');
  }

  setView(v, silent = false) {
    document.querySelectorAll('[data-view]').forEach((x) =>
      x.setAttribute('aria-pressed', String(x.dataset.view === v)));
    if (!silent) this.h.onView(v);
  }

  toggleHelp(on) { $('#help').hidden = !on; }

  setPlaying(on) { $('#btn-play').textContent = on ? '❚❚' : '▶'; }

  setPhase(p) {
    const el = $('#rng-phase');
    el.value = String(Math.round(p * 1000));
    this._paintSlider(el);
  }

  setLevel(key) {
    document.querySelectorAll('[data-level]').forEach((x) =>
      x.setAttribute('aria-pressed', String(x.dataset.level === key)));
  }
  setCamera(key) {
    document.querySelectorAll('[data-cam]').forEach((x) =>
      x.setAttribute('aria-pressed', String(x.dataset.cam === key)));
  }

  /** スライダーの値をモデルに合わせる */
  syncParams(p, ranges = {}) {
    const map = {
      counter: p.counterDeg, angulation: p.angulationDeg, speed: p.speedKmh,
      slope: p.slopeDeg, gate: p.gateSpacing, offset: p.offset,
    };
    for (const [k, v] of Object.entries(map)) {
      const el = this.sliders[k];
      if (ranges[k]) { el.min = ranges[k][0]; el.max = ranges[k][1]; }
      el.value = String(v);
      this._paintSlider(el);
    }
    $('#out-counter').textContent = `${Math.round(p.counterDeg)}°`;
    $('#out-angulation').textContent = `${Math.round(p.angulationDeg)}°`;
    $('#out-speed').textContent = `${Math.round(p.speedKmh)} km/h`;
    $('#out-slope').textContent = `${Math.round(p.slopeDeg)}°（${Math.round(Math.tan(p.slopeDeg * Math.PI / 180) * 100)}%）`;
    $('#out-gate').textContent = `${p.gateSpacing.toFixed(1)} m`;
    $('#out-offset').textContent = `${p.offset.toFixed(2)} m`;
  }

  /** FIS 規定との照合結果 */
  setFisCheck(dist, disc) {
    const el = $('#fis-check');
    const ok = dist >= disc.poleMin && dist <= disc.poleMax;
    el.classList.toggle('ng', !ok);
    const rule = disc.key === 'SL'
      ? `ICR 801.2.3：ターニングポール間 ${disc.poleMin}〜${disc.poleMax} m`
      : `ICR 901.2.3：ターニングポール間 ${disc.poleMin} m 以上（U16/U14 は ${disc.poleMax} m 以下）`;
    el.innerHTML = `ポール間 <b>${dist.toFixed(1)} m</b> — ${ok ? '規定内 ✓' : '規定外 ✗'}<br>${rule}`;
  }

  /** 毎フレームの数値更新 */
  update(s, extra) {
    const set = (k, v) => {
      const b = this.ro[k]; if (!b) return;
      const i = b.querySelector('i');
      b.firstChild.nodeValue = v;
      if (i) b.appendChild(i);
    };
    set('speed', (s.speed * 3.6).toFixed(0));
    set('radius', s.radius === Infinity || s.radius > 200 ? '∞' : s.radius.toFixed(1));
    set('counter', deg(s.counter).toFixed(0));
    set('angulation', deg(s.angulation).toFixed(0));
    set('inclination', deg(s.inclination).toFixed(0));
    set('edge', deg(s.edgeAngle).toFixed(0));
    set('load', s.loadBW.toFixed(2));
    set('share', (s.outerShare * 100).toFixed(0));
    const carveTxt = s.carving
      ? `カービング可（必要 ${deg(s.edgeNeeded).toFixed(0)}° ≦ 実際 ${deg(s.edgeAngle).toFixed(0)}°）`
      : `ずれる（必要 ${deg(s.edgeNeeded).toFixed(0)}° ＞ 実際 ${deg(s.edgeAngle).toFixed(0)}°）`;
    set('carve', carveTxt);
    this.ro.carve.style.color = s.carving ? 'var(--inner)' : 'var(--outer)';

    $('#phase-name').textContent = s.phaseInfo.name;
    $('#phase-desc').textContent = s.phaseInfo.desc;

    this.drawCompass(s);
    if (this.series) this.drawChart(this.series, s.phase);
    this.lastPhase = s.phase;
  }

  /** 骨盤の向きコンパス（真上から見た図） */
  drawCompass(s) {
    const c = this.compass, g = this.cctx;
    const w = c._w, h = c._h;
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h * 0.78, R = Math.min(w * 0.38, h * 0.72);

    // 背景の円弧
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R, Math.PI, 2 * Math.PI); g.stroke();

    const sign = s.eLat.dot(s.outward) > 0 ? 1 : -1;   // 外側が右なら +1
    const counter = deg(s.counter) * sign;
    const fall = -deg(s.turnAngle) * Math.sign(s.tangent.dot(s.eLat) || 1) * sign * sign;

    const arrow = (angDeg, len, color, width, dash = false) => {
      const a = (-90 + angDeg) * Math.PI / 180;
      const x = cx + Math.cos(a) * len, y = cy + Math.sin(a) * len;
      g.save();
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width;
      g.setLineDash(dash ? [4, 3] : []);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke();
      g.setLineDash([]);
      g.translate(x, y); g.rotate(a + Math.PI / 2);
      g.beginPath(); g.moveTo(0, -7); g.lineTo(-5, 5); g.lineTo(5, 5); g.closePath(); g.fill();
      g.restore();
    };

    // 外向角の扇形
    if (Math.abs(counter) > 0.5) {
      g.beginPath();
      g.moveTo(cx, cy);
      const a0 = (-90) * Math.PI / 180, a1 = (-90 + counter) * Math.PI / 180;
      g.arc(cx, cy, R * 0.55, Math.min(a0, a1), Math.max(a0, a1));
      g.closePath();
      g.fillStyle = 'rgba(255,107,87,.28)';
      g.fill();
    }

    arrow(0, R * 0.92, '#ffffff', 2.5);                     // スキーの進行方向
    arrow(counter, R * 0.82, '#4cc3ff', 3.5);               // 骨盤の正面
    arrow(fall, R * 0.6, 'rgba(255,209,102,.85)', 2, true); // フォールライン

    g.fillStyle = '#eaf1fb';
    g.font = '700 13px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText(`外向 ${Math.abs(counter).toFixed(0)}°`, cx, 16);
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.fillText('スキー', cx + (sign > 0 ? -34 : 34), cy - R * 0.9);
    g.fillStyle = 'rgba(76,195,255,.9)';
    g.fillText('骨盤', cx + Math.cos((-90 + counter) * Math.PI / 180) * R * 0.95 + (sign > 0 ? 14 : -14),
      cy + Math.sin((-90 + counter) * Math.PI / 180) * R * 0.95);
  }

  /** 1 ターンの推移グラフ */
  setSeries(series) { this.series = series; }

  drawChart(series, phase) {
    const c = this.chart, g = this.chctx;
    const w = c._w, h = c._h;
    g.clearRect(0, 0, w, h);
    const pad = { l: 4, r: 4, t: 8, b: 13 };
    const X = (p) => pad.l + p * (w - pad.l - pad.r);
    const Y = (v) => h - pad.b - v * (h - pad.t - pad.b);

    // 局面の帯
    for (let i = 0; i < PHASES.length; i++) {
      const p = PHASES[i];
      g.fillStyle = i % 2 ? 'rgba(255,255,255,.035)' : 'rgba(255,255,255,.015)';
      g.fillRect(X(p.from), pad.t, X(p.to) - X(p.from), h - pad.t - pad.b);
    }
    const line = (key, color) => {
      g.beginPath();
      series.forEach((s, i) => {
        const x = X(s.phase), y = Y(s[key]);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
    };
    line('load', '#7be0ff');
    line('counter', '#ff6b57');
    line('incl', '#ffd166');

    // 現在位置
    const x = X(phase);
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, h - pad.b); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.font = '9px system-ui, sans-serif';
    g.textAlign = 'left'; g.fillText('切り替え', 2, h - 3);
    g.textAlign = 'center'; g.fillText('フォールライン', w / 2, h - 3);
    g.textAlign = 'right'; g.fillText('切り替え', w - 2, h - 3);
  }
}

export { deg, LEVELS };
