/**
 * ui.js — 画面まわり（下のカード・数値表示・骨盤コンパス・推移グラフ・3D ラベル）
 *
 * ■ 毎フレーム書き換えるのは、見えているものだけ
 *   かんたん表示：下のカード（いま、やること）と小さなコンパスだけ（updateCoach / drawCompass mini）。
 *   くわしく表示：右パネルの開いているタブだけ（updateDetail）。狭い画面でシートを閉じているときは HUD だけ。
 *   以前は隠れたパネルの数値・グラフ・バーまで毎フレーム書き換えていた。
 */
import * as THREE from 'three';
import { BONE_COLORS, PHASES, LEVELS } from './constants.js';
import { MUSCLES } from './muscles.js';

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
  /**
   * @param {string} key
   * @param {string} text  HTML 可
   * @param {THREE.Vector3} pos
   * @param {string} cls   'small' / 'do' / 'inp'（入力）/ 'res'（物理で決まる）など
   * @param {number} prio  小さいほど大事。上限を超えたぶんは大きい順に消す
   */
  set(key, text, pos, cls = '', prio = 50) {
    let it = this.items.get(key);
    if (!it) {
      const d = document.createElement('div');
      this.el.appendChild(d);
      it = { d, pos: new THREE.Vector3(), cls: null };
      this.items.set(key, it);
    }
    if (it.cls !== cls) { it.d.className = 'lbl ' + cls; it.cls = cls; }
    if (it.html !== text) { it.d.innerHTML = text; it.html = text; }
    it.pos.copy(pos);
    it.prio = prio;
    it.live = true;
  }
  /**
   * ラベルを画面へ投影する。
   * focus（スキーヤーの位置）が与えられたら、その周りの一定半径より外へ押し出し、
   * さらに縦方向の重なりをほどいて読みやすくする。
   */
  render(camera, size, focus = null, minR = 96, max = Infinity, bottom = 54) {
    let fx = null, fy = null;
    if (focus) {
      this.v.copy(focus).project(camera);
      fx = (this.v.x * 0.5 + 0.5) * size.w;
      fy = (-this.v.y * 0.5 + 0.5) * size.h;
    }
    /* 一度に読めるラベルは 4 つくらいまで。大事な順に並べて、
     * 上限を超えたぶんは出さない（大事なものから場所を取るので、重なりも減る）。 */
    const order = [...this.items.values()].filter((it) => it.live)
      .sort((x, y) => x.prio - y.prio);
    const shown = new Set(order.slice(0, max));
    this.shownCount = shown.size;
    // 入力／結果の色分けラベルが 1 つでも出ていれば凡例を出す
    this.shownIO = [...shown].some((it) => /\b(inp|res)\b/.test(it.cls));
    const placed = [];
    for (const it of this.items.values()) if (!shown.has(it)) {
      if (it.d.style.display !== 'none') it.d.style.display = 'none';
      it.live = false;
    }
    for (const it of order) {
      if (!shown.has(it)) continue;
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
      // 画面からはみ出さないように収める（ラベルの幅を見て左右に余白をとる）
      const hw = (it.d.offsetWidth || 90) / 2 + 6;
      x = Math.max(hw, Math.min(size.w - hw, x));
      y = Math.max(46, Math.min(size.h - bottom, y));
      placed.push({ x, y });
      // 変わったときだけ書く（止めているときや、かんたん表示の 1 つだけのラベルで DOM を毎フレーム触らない）
      const px = Math.round(x), py = Math.round(y);
      if (it.d.style.display) it.d.style.display = '';
      if (it.px !== px) { it.d.style.left = `${px}px`; it.px = px; }
      if (it.py !== py) { it.d.style.top = `${py}px`; it.py = py; }
      it.live = false;
    }
  }

  clearAll() { for (const it of this.items.values()) it.d.style.display = 'none'; }
}

/* ============================================================ */
/* UI 本体                                                       */
/* ============================================================ */
const TABS = ['now', 'pelvis', 'nums', 'trend'];
const TAB_KEY = 'skiTrainer.tab';
/* 視点ボタンの名前。かんたん表示はカメラが「うしろから」に決まっているので、見え方そのものを書く。
 * くわしく表示はカメラ（正面・真横…）を別に選べるので、これまでの三人称／一人称／骨盤。 */
const VIEW_NAMES = {
  simple: { third: 'うしろから', first: '自分の目線', pelvis: '骨盤アップ' },
  detail: { third: '三人称', first: '一人称', pelvis: '骨盤' },
};
/* 再生ボタンの絵。文字の ❚❚ / ▶ は端末ごとに形と太さが変わるので SVG にする */
const ICON_PAUSE = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.6" y="2.6" width="3" height="10.8" rx="1" fill="currentColor"/><rect x="9.4" y="2.6" width="3" height="10.8" rx="1" fill="currentColor"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.6 2.9v10.2a.7.7 0 0 0 1.1.6l8-5.1a.7.7 0 0 0 0-1.2l-8-5.1a.7.7 0 0 0-1.1.6z" fill="currentColor"/></svg>';
const FAST_TEXT = '実際の速さ（スローにすると動きが読めます）';

function readTab() {
  try { const t = window.localStorage.getItem(TAB_KEY); return TABS.includes(t) ? t : 'now'; } catch { return 'now'; }
}
const stripTags = (h) => String(h).replace(/<[^>]*>/g, '');

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.mqNarrow = window.matchMedia('(max-width:820px)');
    /* 数値は 3 つに分けて出す。初心者がいちばん混乱するのは
     * 「どれが自分で変えられて、どれが勝手に決まるのか」なので、それを枠の線（実線・点線）と見出しで分ける。
     * 数字の色は全部同じ（以前は入力の欄の中で赤や緑にしていて、「入力＝青」の約束と食い違っていた）。
     *   inp : 入力 — 自分でつくる量（左のつまみ）
     *   res : 結果 — 入力とコースから力学・幾何で決まる量（つまみはない）
     *   asm : 想定 — お手本の滑りごとに置いたモデルの仮定
     * 名前は「いまの値」と分かるように付ける。つまみ（姿勢をいじる）は「ターン中の最大」なので数値が違う。 */
    this.readoutGroups = [
      { g: 'inp', title: '入力 — 自分でつくる', note: 'つまみで変えられる量' },
      { g: 'res', title: '結果 — 力学で決まる', note: '入力を変えると勝手に変わる。自分では選べない' },
      { g: 'asm', title: '想定 — モデルの仮定', note: 'お手本の滑りごとに置いた値（実測の範囲から）' },
    ];
    /* 力は「体重の X.X 倍」に統一する（以前は「1.2×」「1.24 体重比」「0.84×体重」の 3 通りがあった） */
    this.readoutDefs = [
      { k: 'counter', g: 'inp', label: '外向角（いま・骨盤）', unit: '°' },
      { k: 'counterSpine', g: 'inp', label: '外向角（いま・上体）', unit: '°' },
      { k: 'angulation', g: 'inp', label: '外傾角（いま）', unit: '°' },
      { k: 'speed', g: 'inp', label: '速度', unit: 'km/h' },
      { k: 'inclination', g: 'res', label: '内傾角', unit: '°' },
      { k: 'edge', g: 'res', label: 'エッジ角', unit: '°' },
      { k: 'radius', g: 'res', label: '旋回半径', unit: 'm' },
      { k: 'load', g: 'res', label: '雪から受ける力', pre: '体重の', unit: '倍' },
      { k: 'fOuter', g: 'res', label: '外スキー', pre: '体重の', unit: '倍' },
      { k: 'fInner', g: 'res', label: '内スキー', pre: '体重の', unit: '倍' },
      { k: 'lead', g: 'res', label: '内スキーの先行', unit: 'cm' },
      { k: 'hipLead', g: 'res', label: '内腰の先行', unit: 'cm' },
      { k: 'carve', g: 'res', label: 'カービング判定', unit: '', wide: true },
      { k: 'share', g: 'asm', label: '外脚の荷重配分', unit: '%' },
      { k: 'cp', g: 'asm', label: '圧の中心（ブーツ前）', unit: 'cm' },
    ];
    /* 骨盤タブの動き。骨盤の外向角（回旋）は同じタブのコンパスに大きく出るので、ここでは繰り返さない */
    this.motionDefs = [
      { k: 'spine', name: '外向角（いま・上体）', range: 50, color: '#ff9a7a',
        hint: (v) => v > 5 ? '肩は骨盤よりさらに谷を向きます（差は背骨のひねり）'
                   : v < -5 ? '肩もまだ前のターン向き' : '肩もほぼ正対' },
      { k: 'hip', name: '股関節の折れ（骨格から実測）', range: 30, color: 'var(--inner)',
        hint: (v) => (v > 3 ? '外脚の付け根で上体を起こしています'
                             : '股関節はまっすぐ（上体は脚の延長）')
          + '。外傾角とは測り方が違うので数値もずれます' },
      { k: 'shin', name: 'すねの前傾（前後バランス）', range: 45, color: '#a8c7ff',
        hint: (v) => v > 14 ? 'すねでブーツを押せています'
                   : v > 6 ? 'すねの前傾がやや浅い'
                           : 'すねが立って後傾ぎみ — 脛でブーツの前を押す' },
    ];
    this.hipDefs = [
      { k: 'flex', name: '屈曲（前へ曲げる）', range: 70, color: '#7be0ff',
        hint: (v) => v > 45 ? '深く曲げています' : v > 20 ? '適度に曲げています' : '脚が伸びています' },
      { k: 'abd', name: '外転（＋）／内転（−）', range: 40, color: 'var(--inner)',
        hint: (v) => v > 5 ? '外脚を外へ開いています（外傾が深い局面）'
                   : v < -5 ? '骨盤を外へ回したぶん、大腿骨は骨盤から見て内側を向きます'
                            : '骨盤の真下に脚があります' },
      { k: 'rot', name: '回旋：内旋（＋）／外旋（−）', range: 40, color: 'var(--outer)',
        hint: (v) => v > 5 ? '内旋 — 骨盤だけが外を向き、脚はスキーに沿ったまま（＝外向の正体）'
                   : v < -5 ? '外旋 — 骨盤がスキーより内を向いています' : 'ひねりなし' },
    ];
    this._buildReadouts();
    this._buildMotions();
    this._buildMotions('#hip-motions', 'hipDefs', 'hip');
    this._buildLegend();
    this._buildTicks();
    this._wire();
    this.compass = $('#compass');
    this.chart = $('#chart');
    this.coach = $('#coach-compass');
    this.cctx = this.compass.getContext('2d');
    this.chctx = this.chart.getContext('2d');
    this.coachCtx = this.coach.getContext('2d');
    this.hipDetails = $('#hip-motions')?.closest('details') ?? null;
    this.coachEls = {
      phase: $('#coach-phase'), dotBox: $('#coach-dots'),
      cue: $('#coach-cue'), sub: $('#coach-sub'), why: $('#coach-why'), keep: $('#coach-keep'),
    };
    this.setTab(readTab(), false);
    this._fitAll();
    window.addEventListener('resize', () => {
      this._fitAll();
      if (this.series) this.drawChart(this.series, this.lastPhase ?? 0);
    });
    // 狭い画面のガイドは下のカードの上に積む（CSS の --coach-h）。カードの高さは文の長さで変わる
    const card = $('#coach');
    if (card && window.ResizeObserver) {
      new ResizeObserver(() => {
        document.body.style.setProperty('--coach-h', `${Math.round(card.offsetHeight)}px`);
      }).observe(card);
    }
  }

  _fitCanvas(c, ctx) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // 狭い画面のシートでは高さが限られるので、コンパスは少し平たくする
    const ratio = c === this.chart ? 0.46 : (this.mqNarrow.matches ? 0.38 : 0.5);
    const w = c.clientWidth || 260, h = Math.round(w * ratio);
    c.width = w * dpr; c.height = h * dpr;
    c.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    c._w = w; c._h = h;
  }

  /** 下のカードの小さなコンパス：大きさは CSS が決める（広い画面 112×68、狭い画面 84×60） */
  _fitCoach() {
    const c = this.coach, g = this.coachCtx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth || 112, h = c.clientHeight || 68;
    if (c._w === w && c._h === h && c._dpr === dpr) return;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    c._w = w; c._h = h; c._dpr = dpr;
  }

  /** 隠れていた canvas は幅 0 のまま作られるので、見えるようになったら大きさを合わせ直す */
  _fitAll() {
    this._fitCanvas(this.compass, this.cctx);
    this._fitCanvas(this.chart, this.chctx);
    this._fitCoach();
  }

  _buildReadouts() {
    const box = $('#readouts');
    box.innerHTML = '';
    this.ro = {};
    for (const grp of this.readoutGroups) {
      const head = document.createElement('div');
      head.className = 'ro-group ' + grp.g;
      head.innerHTML = `<b>${grp.title}</b><small>${grp.note}</small>`;
      box.appendChild(head);
      for (const d of this.readoutDefs.filter((x) => x.g === grp.g)) {
        const el = document.createElement('div');
        el.className = `ro ${d.g}` + (d.wide ? ' wide' : '');
        const name = document.createElement('span');
        name.textContent = d.label;
        const b = document.createElement('b');
        if (d.pre) {
          const pre = document.createElement('i');
          pre.className = 'pre'; pre.textContent = d.pre;
          b.appendChild(pre);
        }
        const t = document.createTextNode('—');
        b.appendChild(t);
        const unit = document.createElement('i');
        unit.textContent = d.unit;
        b.appendChild(unit);
        el.append(name, b);
        box.appendChild(el);
        this.ro[d.k] = { b, t };
      }
    }
  }

  _buildMotions(sel = '#pelvis-motions', defs = 'motionDefs', store = 'mo') {
    const box = document.querySelector(sel);
    if (!box) return;
    box.innerHTML = '';
    this[store] = {};
    for (const d of this[defs]) {
      const el = document.createElement('div');
      el.className = 'mo';
      el.innerHTML = `<span class="mo-name">${d.name}</span><span class="mo-val" style="color:${d.color}">—</span>`
        + `<div class="mo-bar"><div class="mo-fill" style="background:${d.color}"></div></div>`
        + `<span class="mo-hint"></span>`;
      box.appendChild(el);
      this[store][d.k] = {
        val: el.querySelector('.mo-val'),
        fill: el.querySelector('.mo-fill'),
        hint: el.querySelector('.mo-hint'),
        def: d,
      };
    }
  }

  /** 骨盤・股関節の動きを更新する（角度は度） */
  updateMotions(m, store = 'mo') {
    const box = this[store];
    if (!box) return;
    for (const [k, o] of Object.entries(box)) {
      const v = m[k] ?? 0;
      const r = o.def.range;
      const t = Math.max(-1, Math.min(1, v / r));
      const txt = `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(0)}°`;
      if (o.val.textContent !== txt) o.val.textContent = txt;
      const half = Math.abs(t) * 50;
      o.fill.style.left = (t >= 0 ? 50 : 50 - half) + '%';
      o.fill.style.width = half + '%';
      const hint = o.def.hint(v);
      if (o.lastHint !== hint) { o.hint.innerHTML = hint; o.lastHint = hint; }
    }
  }

  /**
   * ヘルプの「骨盤の色分け」。list は [{ hex, name, note }]（いまの配色の凡例）。
   * 省くと constants.js の BONE_COLORS（部位ごとの色）で作る。
   */
  _buildLegend(list = null) {
    const ul = $('#bone-legend');
    if (!ul) return;
    const items = list ?? Object.values(BONE_COLORS).filter((v) => v.name)
      .map((v) => ({ hex: v.hex, name: v.name, note: v.note }));
    ul.innerHTML = '';
    for (const v of items) {
      const li = document.createElement('li');
      li.innerHTML = `<i style="background:#${v.hex.toString(16).padStart(6, '0')}"></i>${v.name}`;
      li.title = v.note || '';
      ul.appendChild(li);
    }
  }

  /** 再生バーの下の 5 つの局面。幅は局面の長さに比例し、押すとその局面の真ん中へ飛ぶ */
  _buildTicks() {
    const box = $('#phase-ticks');
    if (!box) return;
    box.innerHTML = '';
    this.tickBox = box;
    this.tickEls = PHASES.map((p) => {
      const i = document.createElement('i');
      i.style.setProperty('--w', String(p.to - p.from));
      i.title = `${p.name}へ`;
      const b = document.createElement('b');
      b.textContent = p.name;
      i.appendChild(b);
      i.addEventListener('click', () => this.h.onPhaseJump?.((p.from + p.to) / 2));
      box.appendChild(i);
      return i;
    });
    this._tickOn = -1;
  }

  _wire() {
    const h = this.h;
    document.querySelectorAll('[data-mode]').forEach((b) => {
      b.addEventListener('click', () => h.onMode?.(b.dataset.mode));
    });
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
    $('#sel-view')?.addEventListener('change', (e) => this.setView(e.target.value));
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
    document.querySelectorAll('input[name="look"]').forEach((r) => {
      r.addEventListener('change', () => { if (r.checked) h.onLook?.(r.value); });
    });
    document.querySelectorAll('#rp-tabs [data-tab]').forEach((b) => {
      b.addEventListener('click', () => this.setTab(b.dataset.tab));
    });
    // 股関節を開いたら、次のフレームを待たずに中身を出す（閉じている間は書き換えない）
    $('#hip-motions')?.closest('details')?.addEventListener('toggle', () => { this._phaseKey = null; });

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
    const toggles = ['forces', 'body', 'skeleton', 'pelvis', 'angles', 'track', 'gates',
                     'moves', 'muscles', 'ghost'];
    this.toggles = {};
    for (const t of toggles) {
      const el = $('#tg-' + t);
      this.toggles[t] = el;
      el.addEventListener('change', () => h.onToggle(t, el.checked));
    }

    $('#btn-play').addEventListener('click', () => h.onPlayToggle());
    $('#rng-phase').addEventListener('input', (e) => h.onScrub(parseFloat(e.target.value) / 1000));
    $('#sel-rate').addEventListener('change', (e) => h.onRate(parseFloat(e.target.value)));
    $('#btn-slow')?.addEventListener('click', () => h.onSlow?.());
    $('#btn-real')?.addEventListener('click', () => h.onReal?.());
    $('#btn-help').addEventListener('click', () => this.toggleHelp(true));
    $('#btn-help-close').addEventListener('click', () => this.toggleHelp(false));
    $('#help').addEventListener('click', (e) => { if (e.target.id === 'help') this.toggleHelp(false); });
    // 狭い画面：パネルは下から出るシート。同時に開くのは 1 枚だけ。
    this.sheets = { ctrl: $('#panel-left'), data: $('#panel-right') };
    this.sheetBtns = { ctrl: $('#btn-sheet-ctrl'), data: $('#btn-sheet-data') };
    for (const [k, b] of Object.entries(this.sheetBtns)) {
      b.addEventListener('click', () => this.openSheet(
        this.sheets[k].classList.contains('sheet-open') ? null : k));
    }
    $('#btn-panels').addEventListener('click', () =>
      document.body.classList.toggle('panels-hidden'));
    window.addEventListener('resize', () => {
      if (!this.mqNarrow.matches) this.openSheet(null);
    });
  }

  _paintSlider(el) {
    const pct = (el.value - el.min) / (el.max - el.min) * 100;
    el.style.setProperty('--pct', pct + '%');
  }

  /** 'simple' | 'detail'。body.mode-simple は main.js が付ける（CSS はそれで出し分ける） */
  setMode(m) {
    this.mode = m === 'detail' ? 'detail' : 'simple';
    document.querySelectorAll('[data-mode]').forEach((x) =>
      x.setAttribute('aria-pressed', String(x.dataset.mode === this.mode)));
    const names = VIEW_NAMES[this.mode];
    document.querySelectorAll('#view-group [data-view]').forEach((b) => {
      if (names[b.dataset.view]) b.textContent = names[b.dataset.view];
    });
    this._coachKey = null; this._phaseKey = null; this._coachDot = null;
    this._fitAll();
    if (this.series) this.drawChart(this.series, this.lastPhase ?? 0);
  }

  setView(v, silent = false) {
    document.querySelectorAll('[data-view]').forEach((x) =>
      x.setAttribute('aria-pressed', String(x.dataset.view === v)));
    const sel = $('#sel-view');
    if (sel && sel.value !== v) sel.value = v;
    if (!silent) this.h.onView(v);
  }

  /** 右パネルのタブ：'now' | 'pelvis' | 'nums' | 'trend'（選んだタブは次回も開く） */
  setTab(t, remember = true) {
    const tab = TABS.includes(t) ? t : 'now';
    this.tab = tab;
    document.querySelectorAll('#rp-tabs [data-tab]').forEach((b) =>
      b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('#panel-right section[data-tab]').forEach((sec) =>
      sec.classList.toggle('on', sec.dataset.tab === tab));
    if (remember) {
      try { window.localStorage.setItem(TAB_KEY, tab); } catch { /* 保存できなくても動く */ }
    }
    this._phaseKey = null;
    if (!this.compass) return;
    this._fitAll();
    if (tab === 'trend' && this.series) this.drawChart(this.series, this.lastPhase ?? 0);
  }

  /** 狭い画面のシートを開閉する（null で全部閉じる） */
  openSheet(which) {
    for (const [k, el] of Object.entries(this.sheets)) {
      const on = k === which;
      el.classList.toggle('sheet-open', on);
      this.sheetBtns[k].setAttribute('aria-pressed', String(on));
    }
    if (which) requestAnimationFrame(() => this._fitAll());
  }

  toggleHelp(on) {
    // 凡例はいまの配色に合わせる（かんたん表示は 3 色、骨盤アップ・くわしくは部位ごと）
    if (on) this._buildLegend(this.h.legend?.() ?? null);
    $('#help').hidden = !on;
  }

  setPlaying(on) {
    const b = $('#btn-play');
    if (b._on === on) return;
    b._on = on;
    b.innerHTML = on ? ICON_PAUSE : ICON_PLAY;
    b.setAttribute('aria-label', on ? '一時停止' : '再生');
  }

  /** 速さ：くわしくの選択（0.1〜1.0×）と、かんたんの「スロー｜実際の速さ」を両方合わせる */
  setRate(r) {
    const sel = $('#sel-rate');
    const opt = [...sel.options].find((o) => Math.abs(parseFloat(o.value) - r) < 1e-6);
    if (opt) sel.value = opt.value;
    const real = r >= 0.5;
    const slow = $('#btn-slow'), realBtn = $('#btn-real');
    if (!slow || !realBtn) return;
    realBtn.setAttribute('aria-pressed', String(real));
    slow.setAttribute('aria-pressed', String(!real));
    if (!real) slow.textContent = r <= 0.1 + 1e-6 ? 'もっとスロー' : 'スロー ¼';
  }

  /** 表示トグルをコードから切り替える（チェックボックスも合わせる） */
  setToggle(k, on) { if (this.toggles[k]) this.toggles[k].checked = on; }

  /** 見え方のラジオ（選手｜骨盤を透視｜X線）を合わせる */
  setLook(l) { const r = $('#look-' + l); if (r) r.checked = true; }
  /** 見え方の切り替えがまだない版では、効かないコントロールを出さない */
  setLookAvailable(on) { const el = document.querySelector('#blk-show .look'); if (el) el.hidden = !on; }
  /** この版にないカメラ（中継など）のボタンを隠す */
  setCameraAvailable(key, on) { const b = document.querySelector(`[data-cam="${key}"]`); if (b) b.hidden = !on; }

  /** 3D ラベルの凡例（入力／結果のラベルが出ているときだけ） */
  setLabelKey(on) { const el = $('#lbl-key'); if (el && el.hidden === on) el.hidden = !on; }

  setPhase(p) {
    const el = $('#rng-phase');
    const v = String(Math.round(p * 1000));
    if (el.value !== v) { el.value = v; this._paintSlider(el); }
    if (this.tickEls) {
      const q = Math.min(0.9999, Math.max(0, p));
      const k = PHASES.findIndex((x) => q >= x.from && q < x.to);
      if (k !== this._tickOn) {
        // いまの局面は箱の data-on 1 つで示す（帯ごとに class を付け替えると 2 ノード書くことになる）
        this.tickBox.dataset.on = String(k);
        this._tickOn = k;
      }
    }
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

  /** FIS 規定との照合結果（1 行。条文は title に入れて、指で長押し／マウスを載せると読める） */
  setFisCheck(dist, disc) {
    const el = $('#fis-check');
    const ok = dist >= disc.poleMin && dist <= disc.poleMax;
    el.classList.toggle('ng', !ok);
    const rule = disc.key === 'SL'
      ? `ICR 801.2.3：ターニングポール間 ${disc.poleMin}〜${disc.poleMax} m`
      : `ICR 901.2.3：ターニングポール間 ${disc.poleMin} m 以上（U16/U14 は ${disc.poleMax} m 以下）`;
    el.innerHTML = `ポール間 <b>${dist.toFixed(1)} m</b> ${ok ? '✓ 規定内' : '✗ 規定外'}`;
    el.title = rule;
  }

  /* ---------------- かんたん表示：下のカード ---------------- */
  /**
   * @param {Object} c { phaseIdx, phaseName, text, why, hold, sub, fast }
   *   fast（実際の速さで再生中）のときは指示を出さない。1 秒に何度も変わって読めないので。
   * 書き換えるのは中身が変わったときだけ（1 ターンに 5 回）。
   */
  updateCoach(c) {
    const el = this.coachEls;
    const key = c.fast ? 'fast' : `${c.phaseIdx}|${c.text}|${c.sub ?? ''}|${c.hold}`;
    if (key !== this._coachKey) {
      this._coachKey = key;
      // 同じ値を入れ直しても DOM は書き換わったことになるので、違うときだけ書く
      const text = (e, v) => { if (e.textContent !== v) e.textContent = v; };
      const hide = (e, v) => { if (e.hidden !== v) e.hidden = v; };
      if (c.fast) {
        text(el.phase, '');
        text(el.cue, FAST_TEXT);
        el.cue.classList.add('fast');
        hide(el.keep, true);
        hide(el.sub, true);
        text(el.why, '');
      } else {
        text(el.phase, c.phaseName);
        el.cue.classList.remove('fast');
        text(el.cue, c.text);
        // 「保つ」指示の印。文にもう「キープ」とあるときは繰り返さない
        hide(el.keep, !(c.hold && !/キープ/.test(c.text)));
        hide(el.sub, !c.sub);
        if (c.sub) text(el.sub, c.sub);
        text(el.why, c.why);
      }
    }
    if (c.phaseIdx !== this._coachDot) {
      el.dotBox.dataset.on = String(c.phaseIdx);
      this._coachDot = c.phaseIdx;
    }
  }

  /* ---------------- くわしく表示：見えているところだけ ---------------- */
  /**
   * @param {Object} s サンプル
   * @param {Object} x { hipLead, moves, movesOn, muscleAct, outerSide, musclesOn,
   *                     motions: () => 骨盤の動き, hip: () => 股関節 }（関数は見えているときだけ呼ぶ）
   */
  updateDetail(s, x) {
    const narrow = this.mqNarrow.matches;
    if (narrow) this._updateHud(s);
    const hidden = document.body.classList.contains('panels-hidden');
    const open = !hidden && (!narrow || this.sheets.data.classList.contains('sheet-open'));
    this.lastPhase = s.phase;
    if (!open) return;
    switch (this.tab) {
      case 'now':
        this._updatePhaseText(s);
        this.updateDoing(x.moves, x.movesOn);
        this.updateMuscles(x.muscleAct, x.outerSide, x.musclesOn);
        break;
      case 'pelvis':
        this.drawCompass(s);
        this.updateMotions(x.motions());
        if (this.hipDetails?.open) this.updateMotions(x.hip(), 'hip');
        break;
      case 'nums':
        this._updateReadouts(s, x);
        break;
      case 'trend':
        if (this.series) this.drawChart(this.series, s.phase);
        break;
      default: break;
    }
  }

  _updateReadouts(s, extra) {
    const set = (k, v) => {
      const r = this.ro[k];
      if (r && r.t.nodeValue !== v) r.t.nodeValue = v;
    };
    set('speed', (s.speed * 3.6).toFixed(0));
    set('radius', s.radius === Infinity || s.radius > 200 ? '∞' : s.radius.toFixed(1));
    set('counter', deg(s.counter).toFixed(0));
    set('counterSpine', deg(s.counterSpine ?? s.counter).toFixed(0));
    set('angulation', deg(s.angulation).toFixed(0));
    set('inclination', deg(s.inclination).toFixed(0));
    set('edge', deg(s.edgeAngle).toFixed(0));
    set('load', s.loadBW.toFixed(1));
    set('share', (s.outerShare * 100).toFixed(0));
    set('lead', ((s.innerLead ?? 0) * 100).toFixed(0));
    set('fOuter', (s.outerShare * s.loadBW).toFixed(1));
    set('fInner', ((1 - s.outerShare) * s.loadBW).toFixed(1));
    set('cp', ((s.cpOffset ?? 0) * 100).toFixed(0));
    set('hipLead', ((extra?.hipLead ?? 0) * 100).toFixed(0));
    set('carve', s.carving
      ? `カービング可（必要 ${deg(s.edgeNeeded).toFixed(0)}° ≦ 実際 ${deg(s.edgeAngle).toFixed(0)}°）`
      : `ずれる（必要 ${deg(s.edgeNeeded).toFixed(0)}° ＞ 実際 ${deg(s.edgeAngle).toFixed(0)}°）`);
  }

  /** 狭い画面の常時表示バー（くわしく表示） */
  _updateHud(s) {
    if (!this._hud) {
      this._hud = { phase: document.querySelector('#hud .hud-phase'),
        counter: $('#hud-counter'), incl: $('#hud-incl'), load: $('#hud-load') };
    }
    const H = this._hud;
    if (!H.phase) return;
    const put = (el, v) => { if (el.textContent !== v) el.textContent = v; };
    put(H.phase, s.phaseInfo.name);
    put(H.counter, `${deg(s.counter).toFixed(0)}°`);
    put(H.incl, `${deg(s.inclination).toFixed(0)}°`);
    put(H.load, `体重の${s.loadBW.toFixed(1)}倍`);
  }

  /** 局面の名前と、説明の最初の一文（全文は title） */
  _updatePhaseText(s) {
    const info = s.phaseInfo;
    if (this._phaseKey === info.name) return;
    this._phaseKey = info.name;
    $('#phase-name').textContent = info.name;
    const desc = info.desc;
    const i = desc.indexOf('。');
    const el = $('#phase-desc');
    el.innerHTML = i >= 0 ? desc.slice(0, i + 1) : desc;
    el.title = stripTags(desc);
  }

  /**
   * 「いま、やること」。動作ガイドが出した上位の動きを並べる。
   * @param {Array} moves [{ text, why, mag }]
   */
  updateDoing(moves, on) {
    const box = document.querySelector('#doing-list');
    const block = document.querySelector('#block-doing');
    if (!box || !block) return;
    if (block.hidden === on) block.hidden = !on;
    if (!on) return;
    if (!this._doRows) { box.innerHTML = ''; this._doRows = []; }
    while (this._doRows.length < 3) {
      const el = document.createElement('div');
      el.className = 'do-item';
      el.innerHTML = '<span class="do-num"></span><span class="do-text"></span>'
        + '<div class="do-bar"><div class="do-fill"></div></div>'
        + '<span class="do-why"></span>';
      box.appendChild(el);
      this._doRows.push({ el, num: el.querySelector('.do-num'),
        text: el.querySelector('.do-text'), why: el.querySelector('.do-why'),
        fill: el.querySelector('.do-fill') });
    }
    this._doRows.forEach((row, i) => {
      const m = moves && moves[i];
      const disp = m ? '' : 'none';
      if (row.el.style.display !== disp) row.el.style.display = disp;
      if (!m) return;
      row.num.textContent = String(i + 1);
      if (row.text.textContent !== m.text) row.text.textContent = m.text;
      if (row.why.textContent !== m.why) row.why.textContent = m.why;
      row.fill.style.width = `${Math.round(m.mag * 100)}%`;
    });
  }

  /** 働いている筋の一覧（活動度の高い順） */
  updateMuscles(act, outerSide, on) {
    const box = document.querySelector('#muscle-list');
    const block = document.querySelector('#block-muscles');
    if (!box || !block) return;
    if (block.hidden === on) block.hidden = !on;
    if (!on || !act) return;
    const inner = outerSide === 'R' ? 'L' : 'R';
    const rows = MUSCLES.map((d) => {
      const o = act[d.id + outerSide] ?? 0;
      const i = act[d.id + inner] ?? 0;
      return { d, v: Math.max(o, i), o, i, onOuter: o >= i };
    }).sort((a, b) => b.v - a.v).slice(0, 7);

    if (!this._musRows) { box.innerHTML = ''; this._musRows = []; }
    while (this._musRows.length < rows.length) {
      const el = document.createElement('div');
      el.className = 'mus';
      el.innerHTML = '<span class="mus-name"></span><span class="mus-val"></span>'
        + '<div class="mus-bar"><div class="mus-fill"></div></div>';
      box.appendChild(el);
      this._musRows.push({ el, name: el.querySelector('.mus-name'),
        val: el.querySelector('.mus-val'), fill: el.querySelector('.mus-fill') });
    }
    rows.forEach((r, k) => {
      const row = this._musRows[k];
      const col = '#' + r.d.color.toString(16).padStart(6, '0');
      row.name.innerHTML = `${r.d.name}<span class="mus-side">${r.onOuter ? '外脚側' : '内脚側'}</span>`;
      row.val.textContent = `${Math.round(r.v * 100)}%`;
      row.val.style.color = col;
      row.fill.style.width = `${Math.round(r.v * 100)}%`;
      row.fill.style.background = col;
    });
    const top = rows[0];
    const note = document.querySelector('#muscle-note');
    if (top && note) note.innerHTML = `<b>${top.d.name}</b>：${top.d.note}`;
  }

  /**
   * 骨盤の向きコンパス（真上から見た図。スキーの進行方向が上）。
   * @param {CanvasRenderingContext2D} [g] 描く先（省くと骨盤タブのコンパス）
   * @param {Object} [opts] { mini: true } で下のカード用：白＝スキー・青＝骨盤・赤い扇・「外向 13°」だけ。
   *   かんたん表示で数字が出るのはここだけ。
   */
  drawCompass(s, g = this.cctx, opts = {}) {
    const c = g.canvas;
    const w = c._w, h = c._h;
    if (!w || !h) return;
    g.clearRect(0, 0, w, h);
    const mini = !!opts.mini;

    // 絵の左右：外側が右なら +1（真上から見て、ターンの外へ開くのが見えるように）
    const sign = s.eLat.dot(s.outward) > 0 ? 1 : -1;
    const counter = deg(s.counter) * sign;
    const spine = deg(s.counterSpine ?? s.counter) * sign;
    const fall = -deg(s.turnAngle) * Math.sign(s.tangent.dot(s.eLat) || 1) * sign * sign;
    // 文字に出す値は左右に関係なく「外へ開いた角度」（数値パネルの外向角と同じ値）
    const shown = deg(s.counter);
    const label = `外向 ${shown >= 0 ? '' : '−'}${Math.abs(shown).toFixed(0)}°`;

    const cx = w / 2;
    const cy = mini ? h - 3 : h * 0.78;
    const R = mini ? h - 19 : Math.min(w * 0.38, h * 0.72);
    const head = mini ? 0.7 : 1;

    const arrow = (angDeg, len, color, width, dash = false) => {
      const a = (-90 + angDeg) * Math.PI / 180;
      const x = cx + Math.cos(a) * len, y = cy + Math.sin(a) * len;
      g.save();
      g.strokeStyle = color; g.fillStyle = color; g.lineWidth = width;
      g.setLineDash(dash ? [4, 3] : []);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke();
      g.setLineDash([]);
      g.translate(x, y); g.rotate(a + Math.PI / 2);
      g.beginPath(); g.moveTo(0, -7 * head); g.lineTo(-5 * head, 5 * head); g.lineTo(5 * head, 5 * head);
      g.closePath(); g.fill();
      g.restore();
    };

    // 背景の円弧
    g.strokeStyle = 'rgba(255,255,255,.12)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R, Math.PI, 2 * Math.PI); g.stroke();

    // 外向角の扇形
    if (Math.abs(counter) > 0.5) {
      g.beginPath();
      g.moveTo(cx, cy);
      const a0 = (-90) * Math.PI / 180, a1 = (-90 + counter) * Math.PI / 180;
      g.arc(cx, cy, R * (mini ? 0.86 : 0.55), Math.min(a0, a1), Math.max(a0, a1));
      g.closePath();
      g.fillStyle = mini ? 'rgba(255,107,87,.62)' : 'rgba(255,107,87,.28)';
      g.fill();
    }

    if (mini) {
      arrow(0, R, '#ffffff', 2.4);                 // スキーの進行方向
      arrow(counter, R * 0.92, '#4cc3ff', 3.2);    // 骨盤の正面
      g.font = `700 ${h < 64 ? 11 : 12}px system-ui, sans-serif`;
      g.fillStyle = '#eaf1fb';
      g.textAlign = 'center';
      g.textBaseline = 'top';
      g.fillText(label, cx, 1);
      /* 矢印の名前。白と青が何か分からないと、この絵は読めない。
       * 骨盤の矢印が開いていく側の反対にスキー、同じ側に骨盤と書く（重ならないように） */
      const side = counter >= 0 ? 1 : -1;
      const ty = cy - R * 0.62;
      g.font = '600 9px system-ui, sans-serif';
      g.textBaseline = 'middle';
      g.textAlign = side > 0 ? 'right' : 'left';
      g.fillStyle = 'rgba(255,255,255,.8)';
      g.fillText('スキー', cx - side * 5, ty);
      g.textAlign = side > 0 ? 'left' : 'right';
      g.fillStyle = '#7fd3ff';
      const pa = (-90 + counter) * Math.PI / 180;
      g.fillText('骨盤', cx + Math.cos(pa) * R * 0.62 + side * 6, ty);
      g.textBaseline = 'alphabetic';
      return;
    }

    arrow(0, R * 0.92, '#ffffff', 2.5);                     // スキーの進行方向
    arrow(spine, R * 0.88, 'rgba(255,154,122,.95)', 2.5);   // 肩（上体）の正面
    arrow(counter, R * 0.82, '#4cc3ff', 3.5);               // 骨盤の正面
    // フォールライン（破線）。黄色は「いま、やること」だけに使うので青みの灰にする
    arrow(fall, R * 0.6, 'rgba(143,176,208,.9)', 2, true);

    g.fillStyle = '#eaf1fb';
    g.font = '700 13px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText(label, 8, 16);
    g.font = '10px system-ui, sans-serif';
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.textAlign = 'center';
    g.fillText('スキー', cx, cy - R * 0.98 - 4);
    g.fillStyle = 'rgba(76,195,255,.9)';
    g.fillText('骨盤', cx + Math.cos((-90 + counter) * Math.PI / 180) * R * 0.95 + (sign > 0 ? 14 : -14),
      cy + Math.sin((-90 + counter) * Math.PI / 180) * R * 0.95);
    g.fillStyle = 'rgba(255,154,122,.95)';
    g.fillText('肩', cx + Math.cos((-90 + spine) * Math.PI / 180) * R * 1.02 + (sign > 0 ? 16 : -16),
      cy + Math.sin((-90 + spine) * Math.PI / 180) * R * 1.02);
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
    // 内傾角は「結果」の紫（黄色は「いま、やること」だけ）
    line('incl', '#b9a2f2');

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
