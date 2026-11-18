/**
 * suit.js — レーシングスーツ（不透明）と「骨盤の透視窓」
 *
 * ■ なぜ半透明の皮膚をやめたか
 *   半透明の殻の中に椎骨 24 個と肋骨が透けていると、選手ではなく
 *   解剖模型に見える（遠目には白い雪の上の薄い影にしかならない）。
 *   本物の選手はワンピースのスーツを着ていて、輪郭は暗くはっきりしている。
 *
 * ■ それでも骨盤は見せたい
 *   この教材の主役は骨盤なので、骨盤のまわりだけスーツを透かす。
 *   骨盤のローカル座標に置いた楕円体の中だけ不透明度を下げる
 *   （＝<b>わざと切り抜いた窓</b>）。縁に白い輪を描いて、
 *   「ここは中を見せるために切ってある」と分かるようにする。
 *   輪を金色にしないのは、黄色を「いまやる動作」の印だけに使うため。
 *
 *   窓の中もフレネル（輪郭ほど濃い）にしておくと、スーツの丸みは残る。
 *   窓の外は完全に不透明なので、胸や背中の骨は描かなくてよい（描画も軽くなる）。
 *
 * ■ 「選手」表示の腰のライン
 *   窓を閉じた表示では骨盤が見えないので、上前腸骨棘（ASIS）の高さに
 *   前半周だけ細い線を描く。外側＝赤・内側＝緑で、骨盤の色分けと同じ約束。
 *
 * 描画の順番：スーツは transparent（窓のため）で depthWrite も行う。
 *   骨盤と下肢の骨は不透明パスで先に描かれるので、窓越しに見える。
 *   後から描く半透明物（筋など）はスーツより renderOrder を小さくしておくこと。
 */
import * as THREE from 'three';

/* 窓の縁の色（白〜銀）。黄色は「いまやる動作」専用にしてある */
const RIM_COLOR = new THREE.Vector3(0.90, 0.94, 1.0);

/**
 * スーツのマテリアルを作る。
 * @param {Object} o
 * @param {boolean} [o.vertexColors] 身体の頂点色（スーツの配色）を使うか。
 *   使うときは地色を白にして頂点色をそのまま出す。使わないときはグラファイト。
 * @returns {THREE.MeshStandardMaterial} userData.uniforms に窓とラインの uniform を持つ
 */
export function createSuitMaterial({ vertexColors = false } = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: vertexColors ? 0xffffff : 0x1f2631,
    vertexColors,
    roughness: 0.40, metalness: 0.0,
    transparent: true, depthWrite: true, side: THREE.FrontSide,
  });
  const uniforms = {
    uWin: { value: new THREE.Matrix4() },      // ワールド → 窓の単位球
    uWinOn: { value: 1 },
    uHip: { value: new THREE.Matrix4() },      // ワールド → 骨盤ローカル（スケールなし）
    uHipOn: { value: 0 },
    uAsisY: { value: 0 },                      // 骨盤ローカルでの ASIS の高さ
    uOuterSign: { value: 1 },                  // 骨盤ローカル x の符号がこれと同じ側が外
    uOuterCol: { value: new THREE.Color(0xff6b57) },
    uInnerCol: { value: new THREE.Color(0x59d9a4) },
  };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform mat4 uWin; uniform float uWinOn;
        uniform mat4 uHip; uniform float uHipOn; uniform float uAsisY;
        uniform float uOuterSign; uniform vec3 uOuterCol; uniform vec3 uInnerCol;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          /* 骨盤の窓：単位球の中ほど透かす（縁は 0.82〜1.0 でなめらかに閉じる） */
          vec3 q = (uWin * vec4(vWPos, 1.0)).xyz;
          float d = length(q);
          float m = uWinOn * (1.0 - smoothstep(0.82, 1.0, d));
          float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
          gl_FragColor.a *= mix(1.0, 0.08 + 0.85 * pow(rim, 2.5), m);
          /* 窓の縁の輪：切り抜きであることを示す */
          float ring = smoothstep(0.80, 0.86, d) * (1.0 - smoothstep(0.90, 0.97, d)) * uWinOn;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(${RIM_COLOR.toArray().map((v) => v.toFixed(3)).join(', ')}), ring * 0.85);
          gl_FragColor.a = max(gl_FragColor.a, ring * 0.85 * opacity);
          /* 「選手」表示の腰のライン（ASIS の高さ・前半周だけ） */
          vec3 h = (uHip * vec4(vWPos, 1.0)).xyz;
          float band = (1.0 - smoothstep(0.006, 0.012, abs(h.y - uAsisY))) * step(0.0, h.z) * uHipOn;
          vec3 hipCol = (sign(h.x) * uOuterSign > 0.0) ? uOuterCol : uInnerCol;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hipCol, band);
        }`);
  };
  m.customProgramCacheKey = () => 'suitWin';
  return m;
}

/* 窓の大きさ（骨盤ローカル・身長 1.75 m のとき）。骨盤と大腿骨頭・大転子が入る大きさ */
export const WINDOW_RADII = { x: 0.21, y: 0.19, z: 0.17, yOffset: -0.01 };

const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _s = new THREE.Matrix4();

/**
 * 骨盤のワールド行列から、窓と腰のラインの uniform を更新する。
 * @param {THREE.Material} suit createSuitMaterial の戻り値
 * @param {THREE.Matrix4} pelvisWorld 骨盤ノードの matrixWorld
 * @param {number} S 身長比（H / 1.75）
 */
export function updateSuitWindow(suit, pelvisWorld, S) {
  const u = suit.userData.uniforms;
  if (!u) return;
  _t.makeTranslation(0, WINDOW_RADII.yOffset * S, 0);
  _s.makeScale(WINDOW_RADII.x * S, WINDOW_RADII.y * S, WINDOW_RADII.z * S);
  _m.copy(pelvisWorld).multiply(_t).multiply(_s);
  u.uWin.value.copy(_m).invert();
  u.uHip.value.copy(pelvisWorld).invert();
}
