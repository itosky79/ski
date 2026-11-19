/**
 * tour.js — はじめのガイド（初回だけ・3 ステップ）
 *
 * ■ なぜ要るか
 *   画面を開いた初心者は、どこを見ればいいかが分からない。
 *   説明を読ませるのではなく、<b>ボタンを 1 つ押すと画面がその通りに変わる</b>ように、
 *   見る順番を 3 つだけ案内する。
 *     1. ゆっくり再生して、黄色い矢印と下のカード（いまやること）を見る
 *     2. 骨盤アップで、白い矢印（スキー）と青い矢印（骨盤）の向きを比べる（＝外向）
 *     3. 外向・外傾なしの人を横に並べて、何が違うかを見る
 *   文は 1 ステップ 1 文まで（読ませるのではなく、ボタンを押して見せる）。
 *
 * ■ 文言の約束
 *   その画面幅で隠れているパネル（「左の」「数値の」など）は書かない。
 *   カードと矢印はどの幅でも出ているので、そこだけを指す。
 *
 * ■ 一度だけ
 *   閉じたら localStorage に印をつけて、次からは出さない（ヘルプからもう一度出せる）。
 *   プライベートウィンドウなどで保存できなくても、ガイドが毎回出るだけで壊れはしない。
 *   URL に ?tour=0 を付けると出さない、?tour=1 で必ず出す（授業で配るとき用）。
 *   中身を変えたので印は v2（v1 を見た人にも、新しいガイドを一度だけ出す）。
 */
const KEY = 'skiTrainer.tour.v2';

const STEPS = [
  {
    title: '① ゆっくり見る',
    text: '<b>黄色い矢印と下のカード</b>が「いま、やること」です。',
    action: '▶ ゆっくり再生', done: '✓ ゆっくり再生中', run: 'onSlow',
  },
  {
    title: '② 骨盤を見る',
    text: '<b>白＝スキー</b>、<b>青＝骨盤</b>の向き。青が外へ開いた分が<b>外向</b>です。',
    action: '骨盤アップにする', done: '✓ 骨盤アップ', run: 'onPelvis',
  },
  {
    title: '③ 外向なしと比べる',
    text: '薄い人は<b>外向・外傾なし</b>。体を大きく倒すしかないのが分かります。',
    action: '並べて比べる', done: '✓ 並べました', run: 'onGhost',
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
   * @param {Object} h  { onStart, onSlow, onPelvis, onGhost, onEnd }（どれも省略可）
   */
  constructor(h) {
    this.h = h || {};
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
    // パネルは画面幅で隠れるので、文言はどの幅でも見えているもの（矢印・カード）だけを指す
    this.$('tour-text').innerHTML = st.text;
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
