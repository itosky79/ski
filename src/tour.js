/**
 * tour.js — はじめのガイド（初回だけ・3 ステップ）
 *
 * ■ なぜ要るか
 *   画面を開いた初心者は、どこを見ればいいかが分からない。
 *   説明を読ませるのではなく、<b>ボタンを 1 つ押すと画面がその通りに変わる</b>ように、
 *   見る順番を 3 つだけ案内する。
 *     1. ゆっくり再生して、黄色い矢印（いま動かしている場所）を見る
 *     2. 骨盤ビューで、骨盤がスキーより外を向くのを見る（＝外向）
 *     3. 力と角度を足して、「自分でつくる量」と「力学で決まる量」を分ける
 *
 * ■ 一度だけ
 *   閉じたら localStorage に印をつけて、次からは出さない（ヘルプからもう一度出せる）。
 *   プライベートウィンドウなどで保存できなくても、ガイドが毎回出るだけで壊れはしない。
 *   URL に ?tour=0 を付けると出さない、?tour=1 で必ず出す（授業で配るとき用）。
 */
const KEY = 'skiTrainer.tour.v1';

const STEPS = [
  {
    title: '① ゆっくり動かして、黄色い矢印を見る',
    text: '黄色い矢印と吹き出しが<b>「いま動かしているところ」</b>です。'
      + 'まず 0.1 倍速で 1 ターン見てみましょう。{R}「いま、やること」にも同じ言葉が出ます。',
    action: '▶ 0.1 倍速で再生', done: '✓ 0.1 倍速で再生中', run: 'onSlow',
  },
  {
    title: '② 骨盤だけを見る',
    text: '外向は<b>骨盤の向き</b>です。骨盤ビューにすると、ターンの後半で骨盤が'
      + '<b>スキーより外側</b>を向いていくのが見えます。<b>赤い腸骨</b>がターンの外側です。',
    action: '骨盤ビューにする', done: '✓ 骨盤ビュー', run: 'onPelvis',
  },
  {
    title: '③ 力を足して、「つくる量」と「決まる量」を分ける',
    text: '<b>内傾</b>（身体全体の傾き）は力で決まるので、自分では選べません（紫の点線）。'
      + '自分でつくれるのは<b>外向と外傾</b>だけ（青い枠）。{L}つまみで変えると、紫の値が勝手に変わります。',
    action: '力と角度を表示する', done: '✓ 表示しました', run: 'onForces',
  },
];

function readFlag() {
  try { return window.localStorage.getItem(KEY); } catch { return null; }
}
function writeFlag() {
  try { window.localStorage.setItem(KEY, 'done'); } catch { /* 保存できなくても動く */ }
}

export class Tour {
  /**
   * @param {Object} h  { onStart, onSlow, onPelvis, onForces, onEnd }
   */
  constructor(h) {
    this.h = h;
    this.el = document.getElementById('tour');
    this.$ = (id) => document.getElementById(id);
    this.i = 0;
    this.did = [];
    if (!this.el) return;
    this.$('tour-do').addEventListener('click', () => this._act());
    this.$('tour-next').addEventListener('click', () => this._next());
    this.$('tour-close').addEventListener('click', () => this.close());
    this.$('tour-skip').addEventListener('click', () => this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) { e.preventDefault(); this.close(); }
    });
  }

  get open() { return !!this.el && !this.el.hidden; }

  /** 初回なら出す。出したら true */
  maybeStart() {
    let q = null;
    try { q = new URLSearchParams(window.location.search).get('tour'); } catch { /* なし */ }
    if (q === '0') return false;
    if (q !== '1' && readFlag() === 'done') return false;
    this.start();
    return true;
  }

  start() {
    if (!this.el) return;
    this.i = 0;
    this.did = STEPS.map(() => false);
    this.el.hidden = false;
    document.body.classList.add('tour-on');
    this.h.onStart?.();
    this._render();
  }

  close() {
    if (!this.open) return;
    this.el.hidden = true;
    document.body.classList.remove('tour-on');
    writeFlag();
    this.h.onEnd?.(this.i, this.did);
  }

  _act() {
    const st = STEPS[this.i];
    this.h[st.run]?.();
    this.did[this.i] = true;
    this._render();
    this.$('tour-next').focus();
  }

  _next() {
    if (this.i >= STEPS.length - 1) { this.close(); return; }
    this.i++;
    this._render();
  }

  _render() {
    const st = STEPS[this.i];
    const last = this.i === STEPS.length - 1;
    this.$('tour-title').textContent = st.title;
    // 狭い画面ではパネルが左右ではなく「操作」「数値」のシートになる
    const narrow = window.matchMedia?.('(max-width:820px)').matches;
    this.$('tour-text').innerHTML = st.text
      .replace('{L}', narrow ? '「操作」の' : '左の')
      .replace('{R}', narrow ? '「数値」の' : '右の');
    this.$('tour-count').textContent = `${this.i + 1} / ${STEPS.length}`;
    const doBtn = this.$('tour-do');
    doBtn.textContent = this.did[this.i] ? st.done : st.action;
    doBtn.classList.toggle('done', this.did[this.i]);
    const next = this.$('tour-next');
    next.textContent = last ? (this.did[this.i] ? 'はじめる' : '閉じる') : '次へ';
    next.classList.toggle('ready', this.did[this.i]);
    this.$('tour-dots').querySelectorAll('i').forEach((d, k) => {
      d.classList.toggle('on', k === this.i);
      d.classList.toggle('done', k < this.i);
    });
  }
}
