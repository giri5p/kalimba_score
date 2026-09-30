/* カリンバ楽譜メーカー ― 個人用ローカルツール */
(function () {
'use strict';

/* サイトの版。
   ここを書き換えると、すでに読んだ人にも使い方モーダルがもう一度出ます。
   機能を足したときや説明を直したときに、日付を今日にしてください。
   （読んだかどうかは、この文字列そのものを覚えておく形で判定しています） */
const APP_VERSION = '2026-09-30';

/* index.html の <title> と同じもの。曲名が付いていないときはこれに戻す */
const SITE_TITLE = 'カリンバ楽譜メーカー｜初心者でもドレミ・数字譜つきの楽譜を無料で作成';

/* ============================================================
   1. 音階まわりの基礎データ
   ------------------------------------------------------------
   音高は「C4 を 0 とする全音階(ダイアトニック)ステップ番号」で持つ。
   step 0=C4, 1=D4, ... 7=C5。カリンバは半音を持たないのでこれで足りる。
   ============================================================ */
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SOLFEGE = ['ド', 'レ', 'ミ', 'ファ', 'ソ', 'ラ', 'シ'];
const SEMITONE = [0, 2, 4, 5, 7, 9, 11];

const octOf = s => 4 + Math.floor(s / 7);
const degOf = s => ((s % 7) + 7) % 7;
const midiOf = s => (octOf(s) + 1) * 12 + SEMITONE[degOf(s)];
const vexKeyOf = s => LETTERS[degOf(s)].toLowerCase() + '/' + octOf(s);
const solfegeOf = s => SOLFEGE[degOf(s)];
/* オクターブ記号: 基準オクターブ(4)は無印、上は * 、下は . を付け足す */
function octMark(s) {
  const o = octOf(s);
  return o > 4 ? '*'.repeat(o - 4) : o < 4 ? '.'.repeat(4 - o) : '';
}
/* カリンバ数字譜 (1〜7) と音名 (C〜B) は同じオクターブ記号でそろえる */
const numberOf = s => String(degOf(s) + 1) + octMark(s);
const letterOf = s => LETTERS[degOf(s)] + octMark(s);

/* カリンバのプリセット: base = 最低音のステップ番号, count = キー数 */
const PRESETS = [
  { id: '17', label: '17キー (C〜E**)',  base: 0, count: 17 },
  { id: '21', label: '21キー (C〜B**)',  base: 0, count: 21 },
  { id: '15', label: '15キー (C〜C**)',  base: 0, count: 15 },
  { id: '10', label: '10キー (C*〜E**)', base: 7, count: 10 },
  { id: '8',  label: '8キー (C*〜C**)',  base: 7, count: 8 }
];
const presetById = id => PRESETS.find(p => p.id === id) || PRESETS[0];

/* 実物のカリンバの並び: 中央が最低音で、左右に交互に高くなる */
function tineOrder(count) {
  const left = [], right = [];
  for (let i = 1; i < count; i++) (i % 2 ? left : right).push(i);
  return left.reverse().concat([0], right);
}

/* ============================================================
   2. 音符の長さ
   ============================================================ */
const DURS = [
  { c: '32', dot: false }, { c: '16', dot: false }, { c: '16', dot: true },
  { c: '8',  dot: false }, { c: '8',  dot: true },
  { c: 'q',  dot: false }, { c: 'q',  dot: true },
  { c: 'h',  dot: false }, { c: 'h',  dot: true },
  { c: 'w',  dot: false }
];
const DEN = { w: 1, h: 2, q: 4, '8': 8, '16': 16, '32': 32 };
const DNAME = { w: '全', h: '2分', q: '4分', '8': '8分', '16': '16分', '32': '32分' };

/* パレット用の音符アイコン (音楽フォントに依存しないよう SVG で描く) */
function durIcon(code, dot) {
  const filled = code !== 'w' && code !== 'h';
  const nFlags = { '8': 1, '16': 2, '32': 3 }[code] || 0;
  let flags = '';
  for (let i = 0; i < nFlags; i++) {
    flags += '<path d="M12.6 ' + (4.5 + i * 4.6) + ' q6.4 2.4 5.4 8.2" fill="none" ' +
             'stroke="currentColor" stroke-width="1.5"/>';
  }
  return '<svg width="24" height="26" viewBox="0 0 24 26">' +
    '<ellipse cx="7.6" cy="19" rx="5.2" ry="3.7" transform="rotate(-20 7.6 19)" ' +
      (filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="1.7"') + '/>' +
    (code !== 'w' ? '<path d="M12.6 18.4 V4" stroke="currentColor" stroke-width="1.5"/>' : '') +
    flags +
    (dot ? '<circle cx="16.8" cy="19.4" r="1.7" fill="currentColor"/>' : '') +
    '</svg>';
}

const noteValue = n => (1 / DEN[n.d]) * (n.dot ? 1.5 : 1);   // 全音符を 1 とした長さ
const durIndex = n => DURS.findIndex(d => d.c === n.d && d.dot === !!n.dot);

/* 実測した長さ(4分音符いくつ分か)を、いちばん近い音符の長さに丸める。
   32分は細かすぎて誤検出のもとなので候補から外す */
const QDURS = DURS.filter(d => d.c !== '32');
const quarterLenOf = d => (4 / DEN[d.c]) * (d.dot ? 1.5 : 1);
function quantizeToDur(q) {
  q = Math.max(0.13, Math.min(4.5, q));
  let best = QDURS[0], bestErr = Infinity;
  QDURS.forEach(d => {
    const err = Math.abs(Math.log(q / quarterLenOf(d)));   // 比で近さを測る
    if (err < bestErr) { bestErr = err; best = d; }
  });
  return best;
}

/* ============================================================
   3. 状態
   ============================================================ */
const STORE_KEY = 'kalimba-score-v1';
const state = {
  title: '無題の曲',
  tempo: 90,
  beats: 4,
  beatValue: 4,
  preset: '17',
  notes: [],
  showSol: true, showNum: true, showLet: true,
  perLine: 4,            // 1 段に並べる小節数
  /* 数字キー / カリンバ鍵盤を押したときの動作
     'edit' = 選択中の音符の音程を変える
     'add'  = 新しい音符を追加する
     'tap'  = 新しい音符を追加し、押した間隔から長さも決める */
  inputMode: 'edit'
};
const MODES = ['edit', 'add', 'tap'];
let cursor = 0;
/* anchor < 0 なら 1 個だけの選択。0 以上なら anchor〜cursor が選択範囲 */
let anchor = -1;
/* tone < 0 なら和音まるごと。0 以上なら「低い順に数えた何番目の音」だけを対象にする */
let tone = -1;
let clipboard = [];
const undoStack = [], redoStack = [];

const selStart = () => anchor < 0 ? cursor : Math.min(anchor, cursor);
const selEnd   = () => anchor < 0 ? cursor : Math.max(anchor, cursor);
const selCount = () => selEnd() - selStart() + 1;
function clearSel() { anchor = -1; }
function selectRange(a, b) {
  anchor = Math.max(0, Math.min(a, state.notes.length - 1));
  cursor = Math.max(0, Math.min(b, state.notes.length - 1));
  if (anchor === cursor) anchor = -1;
}
/* 選択中の音符すべてに処理を適用する */
function eachSel(fn) { for (let i = selStart(); i <= selEnd(); i++) fn(state.notes[i], i); }

const P = () => presetById(state.preset);
const minStep = () => P().base;
const maxStep = () => P().base + P().count - 1;
const clampStep = s => Math.max(minStep(), Math.min(maxStep(), s));

/* fresh = まだ音を決めていない仮置きの音符。追加モードではこれだけ上書きする
   （新規作成した 1 個目で数字を押したときに、余計な音符が増えないようにするため） */
function newNote(pitch, d, dot, fresh) {
  return { p: [pitch], d: d || 'q', dot: !!dot, rest: false, tie: false, fresh: !!fresh };
}
const cur = () => state.notes[cursor];

function pushUndo() {
  undoStack.push(JSON.stringify(state.notes));
  if (undoStack.length > 300) undoStack.shift();
  redoStack.length = 0;
}
function undo() {
  resetTap();
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(state.notes));
  state.notes = JSON.parse(undoStack.pop());
  cursor = Math.min(cursor, state.notes.length - 1);
  refresh();
}
function redo() {
  resetTap();
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state.notes));
  state.notes = JSON.parse(redoStack.pop());
  cursor = Math.min(cursor, state.notes.length - 1);
  refresh();
}

function serialize() {
  return JSON.stringify({ v: 1, title: state.title, tempo: state.tempo,
    beats: state.beats, beatValue: state.beatValue, preset: state.preset,
    showSol: state.showSol, showNum: state.showNum, showLet: state.showLet,
    inputMode: state.inputMode, perLine: state.perLine, notes: state.notes }, null, 1);
}
function deserialize(json) {
  const o = JSON.parse(json);
  if (!o || !Array.isArray(o.notes)) throw new Error('形式が違います');
  state.title = o.title || '無題の曲';
  state.tempo = o.tempo || 90;
  state.beats = o.beats || 4;
  state.beatValue = o.beatValue || 4;
  state.preset = o.preset || '17';
  if (typeof o.showSol === 'boolean') state.showSol = o.showSol;
  if (typeof o.showNum === 'boolean') state.showNum = o.showNum;
  if (typeof o.showLet === 'boolean') state.showLet = o.showLet;
  if (o.perLine >= 1 && o.perLine <= 8) state.perLine = o.perLine | 0;
  if (MODES.indexOf(o.inputMode) >= 0) state.inputMode = o.inputMode;
  else if (typeof o.addMode === 'boolean') state.inputMode = o.addMode ? 'add' : 'edit';
  state.notes = o.notes.map(n => ({
    p: (n.p && n.p.length ? n.p : [0]).map(x => clampStep(x | 0)),
    d: DEN[n.d] ? n.d : 'q', dot: !!n.dot, rest: !!n.rest, tie: !!n.tie
  }));
  if (!state.notes.length) state.notes = [newNote(clampStep(0), 'q', false, true)];
  cursor = 0;
}
function autosave() { try { localStorage.setItem(STORE_KEY, serialize()); } catch (e) {} }

/* ============================================================
   4. 小節分割
   ============================================================ */
function buildMeasures() {
  const cap = state.beats / state.beatValue;
  const out = [];
  let bag = [], acc = 0;
  state.notes.forEach((n, i) => {
    bag.push(i); acc += noteValue(n);
    if (acc >= cap - 1e-9) { out.push({ idx: bag, filled: acc }); bag = []; acc = 0; }
  });
  if (bag.length) out.push({ idx: bag, filled: acc });
  if (!out.length) out.push({ idx: [], filled: 0 });
  return out;
}

/* 余りの長さ(全音符=1)を、標準的な音符の長さに分解する。
   入力途中の小節をこれで見えない音符で埋めると、
   すでに入れた音符が「本来の拍の位置」に並ぶ（1段目と2段目で間隔がそろう） */
const PAD_UNITS = [
  { n: 32, d: 'w',  dot: false }, { n: 24, d: 'h',  dot: true },
  { n: 16, d: 'h',  dot: false }, { n: 12, d: 'q',  dot: true },
  { n: 8,  d: 'q',  dot: false }, { n: 6,  d: '8',  dot: true },
  { n: 4,  d: '8',  dot: false }, { n: 3,  d: '16', dot: true },
  { n: 2,  d: '16', dot: false }, { n: 1,  d: '32', dot: false }
];
function padDurations(remaining) {
  let left = Math.round(remaining * 32);          // 32分音符いくつ分か
  const out = [];
  if (left <= 0) return out;
  PAD_UNITS.forEach(u => {
    while (left >= u.n) { out.push(u); left -= u.n; }
  });
  return out;
}

/* ============================================================
   5. 楽譜の描画 (VexFlow)
   ============================================================ */
const SVGNS = 'http://www.w3.org/2000/svg';
const FONT_JP = '"Yu Gothic UI","Meiryo","Hiragino Kaku Gothic ProN",sans-serif';

/* 五線譜と数字譜（簡譜）の切り替え。曲そのものには保存せず、
   この端末の設定として覚えます */
const NUM_VIEW_KEY = 'kalimba-number-view';
let numberView = false;

function syncViewButtons() {
  const a = document.getElementById('viewStaff');
  const b = document.getElementById('viewNum');
  if (a) a.classList.toggle('on', !numberView);
  if (b) b.classList.toggle('on', numberView);
  /* 数字譜のときは数字そのものが本体なので、「数字」のチェックは効きません */
  const c = document.getElementById('sNum');
  const l = document.getElementById('sNumLabel');
  if (c) c.disabled = numberView;
  if (l) l.style.opacity = numberView ? '.4' : '';
}
function setNumberView(on) {
  numberView = !!on;
  syncViewButtons();
  try { localStorage.setItem(NUM_VIEW_KEY, numberView ? '1' : '0'); } catch (e) { /* 無視 */ }
  render();
}

let geom = [];          // geom[音符index] = {x, line, top, bot}
let sysGeom = [];       // sysGeom[段] = {top, bot, left, right}
let seekRects = [];     // 段ごとの「ここまで再生した」帯
let seekEdge = null;    // 再生位置を示す縦線
let anchorLine = -1;    // いま画面の上端に合わせている段
let booted = false;     // 起動時の1回目の描画が終わったか
let selGroup = null;

function svgEl(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function svgText(parent, x, y, str, size, fill, weight) {
  const t = svgEl('text', {
    x: x, y: y, 'text-anchor': 'middle', 'font-family': FONT_JP,
    'font-size': size, fill: fill, 'font-weight': weight || 'normal'
  });
  t.textContent = str;
  parent.appendChild(t);
  return t;
}

/* 1つの音符に付けるラベル。和音は高い音が上になるよう縦に積む。
   休符には何も書かない（0 は書かない） */
function labelsFor(n) {
  if (n.rest) return { sol: [], num: [], let: [] };
  const ps = n.p.slice().sort((a, b) => b - a);      // 上が高い音
  return { sol: ps.map(solfegeOf), num: ps.map(numberOf), let: ps.map(letterOf) };
}

/* ステータス行など、1 行で書きたいとき用 */
function labelText(n) {
  if (n.rest) return '休符';
  const ps = n.p.slice().sort((a, b) => a - b);
  const j = f => ps.length === 1 ? f(ps[0]) : '(' + ps.map(f).join('・') + ')';
  return j(solfegeOf) + '　' + j(numberOf) + '　' + j(letterOf);
}

/* 和音の段数に応じたラベル行の間隔と高さ */
const LINE_H = 14;                                   // 和音を積むときの行送り
const rowStepOf = t => t === 1 ? 19 : t * LINE_H + 12;   // 和音のときは行の区切りを広めに
const labelsHOf = (rows, t) =>
  rows ? 24 + (rows - 1) * rowStepOf(t) + (t - 1) * LINE_H + 8 : 6;

function render() {
  const host = document.getElementById('score');
  /* 描き直すと中身がいったん空になってスクロール位置が先頭へ飛ぶので、
     元の位置を覚えておいて最後に戻す */
  const paper = document.getElementById('paper');
  cancelScrollAnim();
  const keepScroll = paper ? paper.scrollTop : 0;
  host.innerHTML = '';
  geom = []; sysGeom = []; seekRects = []; seekEdge = null; selGroup = null;

  /* 五線譜か、数字だけの簡単な表示か。
     どちらも geom / sysGeom を同じ形で埋めるので、
     選択枠・再生位置・クリック判定から先は共通のものが使えます */
  const svg = numberView ? drawNumberView(host) : drawStaffView(host);
  addOverlays(svg);

  if (paper) paper.scrollTop = keepScroll;
  drawSelection();          // 選択中の音符が画面外に出たときだけ追いかける
}

/* ---- 五線譜の表示 ---------------------------------------------- */
function drawStaffView(host) {
  const F = window.Vex.Flow;
  const rows = (state.showSol ? 1 : 0) + (state.showNum ? 1 : 0) + (state.showLet ? 1 : 0);
  const W = Math.max(300, host.clientWidth || 900);   // スマホ幅でも画面内に収める
  const measures = buildMeasures();
  /* 1段の小節数は固定。すべての小節を同じ幅にし、
     段の先頭に確保する記号ぶん(HEAD_W)もどの段でも同じにして、
     小節線と音符の位置が段をまたいでそろうようにする */
  const HEAD_W = 76, MARGIN = 14;
  const perLine = Math.max(1, Math.min(state.perLine, Math.floor((W - MARGIN * 2 - HEAD_W) / 130)));
  const noteW = (W - MARGIN * 2 - HEAD_W) / perLine;
  const lines = [];
  for (let i = 0; i < measures.length; i += perLine) lines.push(measures.slice(i, i + perLine));

  /* 段ごとに「その段で一番音数の多い和音」を調べ、ラベルの高さを決める */
  const lineTones = lines.map(lineMs => {
    let t = 1;
    lineMs.forEach(m => m.idx.forEach(i => {
      const n = state.notes[i];
      if (!n.rest) t = Math.max(t, Math.min(4, n.p.length));
    }));
    return t;
  });
  /* 1段の高さ: VexFlow が五線の上に確保する 40px + 五線 40px + ラベル + 段間 */
  const sysHOf = t => 80 + labelsHOf(rows, t) + 16;
  const H = 10 + lineTones.reduce((a, t) => a + sysHOf(t), 0) + 6;

  const renderer = new F.Renderer(host, F.Renderer.Backends.SVG);
  renderer.resize(W, H);
  const ctx = renderer.getContext();
  const svg = host.querySelector('svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

  const drawn = [];                 // drawn[音符index] = {sn, stave}
  let measureNo = 1;
  let y = 10;

  lines.forEach((lineMs, li) => {
    const staveTop = y;
    let x = MARGIN;
    sysGeom[li] = { top: staveTop + 6, left: MARGIN + HEAD_W - 6,
                    bot: staveTop + 80 + labelsHOf(rows, lineTones[li]), right: 0 };

    lineMs.forEach((m, mi) => {
      /* 段の先頭だけ記号ぶん広げる。音符が並ぶ幅は、どの小節でも noteW で一定 */
      const w = noteW + (mi === 0 ? HEAD_W : 0);
      const stave = new F.Stave(x, staveTop, w);
      if (mi === 0) { stave.addClef('treble'); stave.setMeasure(measureNo); }
      if (li === 0 && mi === 0) stave.addTimeSignature(state.beats + '/' + state.beatValue);
      if (li === lines.length - 1 && mi === lineMs.length - 1) {
        stave.setEndBarType(F.Barline.type.END);
      }
      stave.setContext(ctx).draw();
      /* 描画後に音符の開始位置を固定する（拍子記号の有無で段がずれないように） */
      if (mi === 0) stave.setNoteStartX(x + HEAD_W);
      measureNo++;
      if (m.idx.length) drawMeasure(F, ctx, svg, stave, m, noteW, rows, drawn, li, lineTones[li]);
      x += w;
    });
    sysGeom[li].right = x;
    y += sysHOf(lineTones[li]);
  });

  /* タイ。和音は「両方に共通する音」ごとに 1 本ずつ結ぶ。
     小節をまたいでも同じ段なら 1 本で結び、段をまたぐときは行末と行頭に分けて引く */
  state.notes.forEach((n, i) => {
    const nx = state.notes[i + 1];
    if (!n.tie || n.rest || !nx || nx.rest) return;
    const a = drawn[i], b = drawn[i + 1];
    if (!a || !b) return;
    const pa = n.p.slice().sort((x, y) => x - y);
    const pb = nx.p.slice().sort((x, y) => x - y);
    const fi = [], li = [];
    pa.forEach((step, k) => {
      const j = pb.indexOf(step);
      if (j >= 0) { fi.push(k); li.push(j); }
    });
    if (!fi.length) return;                    // 共通の音がなければタイは引けない
    const sameLine = geom[i] && geom[i + 1] && geom[i].line === geom[i + 1].line;
    try {
      if (sameLine) {
        new F.StaveTie({ first_note: a.sn, last_note: b.sn,
                         first_indices: fi, last_indices: li }).setContext(ctx).draw();
      } else {                                 // 段またぎ: 行末までと行頭からに分ける
        new F.StaveTie({ first_note: a.sn,
                         first_indices: fi, last_indices: fi }).setContext(ctx).draw();
        new F.StaveTie({ last_note: b.sn,
                         first_indices: li, last_indices: li }).setContext(ctx).draw();
      }
    } catch (e) { /* 描けない組み合わせは無視 */ }
  });

  return svg;
}

/* ---- 選択枠・再生位置・クリック判定（どちらの表示でも同じもの） ---- */
function addOverlays(svg) {
  /* 選択枠と、再生済みを塗るシークバーは最背面へ */
  selGroup = svgEl('g', { class: 'cursor' });
  svg.insertBefore(selGroup, svg.firstChild);
  seekEdge = svgEl('rect', { width: 2.5, rx: 1.25, fill: '#0e9fd4',
    class: 'seek', visibility: 'hidden' });
  svg.insertBefore(seekEdge, svg.firstChild);
  sysGeom.forEach((sg, li) => {
    const r = svgEl('rect', { x: sg.left, y: sg.top, width: 0, height: sg.bot - sg.top,
      rx: 3, fill: '#5ec8ef', 'fill-opacity': 0.28, class: 'seek', visibility: 'hidden' });
    seekRects[li] = r;
    svg.insertBefore(r, svg.firstChild);
  });

  /* クリック用の透明な当たり判定を最前面に */
  geom.forEach((g, i) => {
    if (!g) return;
    const hit = svgEl('rect', { x: g.x - 14, y: g.top, width: 28, height: g.bot - g.top,
      fill: '#000', 'fill-opacity': 0, stroke: 'none', 'pointer-events': 'all',
      class: 'hit', 'data-i': i });
    hit.addEventListener('mousedown', ev => {
      ev.preventDefault();
      if (ev.shiftKey) { setCursor(i, true); return; }   // Shift+クリックで範囲を広げる
      setCursor(i);
      dragFrom = i;                                      // ここからドラッグで範囲選択
    });
    hit.addEventListener('mouseenter', () => {
      if (dragFrom >= 0 && dragFrom !== i) { anchor = dragFrom; setCursor(i, true); }
    });
    svg.appendChild(hit);
  });

  /* 和音は玉ごとにもクリックできるようにする（その音だけを選ぶ） */
  geom.forEach((g, i) => {
    if (!g || !g.heads || g.heads.length < 2) return;
    g.heads.forEach((hy, k) => {
      const hh = svgEl('rect', { x: g.x - 9, y: hy - 7, width: 18, height: 14,
        fill: '#000', 'fill-opacity': 0, stroke: 'none', 'pointer-events': 'all', class: 'hit' });
      hh.addEventListener('mousedown', ev => {
        if (readOnly) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (cursor !== i || anchor >= 0) setCursor(i);
        setTone(k);
      });
      svg.appendChild(hh);
    });
  });
}

/* ---- 数字譜（簡譜）の表示 --------------------------------------------
   五線譜の代わりに、カリンバのキーの数字だけを並べた簡単な楽譜を描きます。

     数字        弾くキー（* が1つで1オクターブ上、2つで2オクターブ上）
     0           休み
     −           前の音をのばす（1拍ぶん）
     数字の下の線 1本で「1拍の半分」、2本で「4分の1」の長さ
     ・           付点。その音を半分だけ長くする

   和音は数字を縦に積みます。ドレミ・CDE は、上のチェックが入っていれば
   数字の下に並べます（数字そのものがこの表示の本体なので、
   「数字」のチェックはここでは見ません）。 */

const NV = {
  margin: 14,       // 左右の余白
  headW: 34,        // 段の左に置く小節番号のぶん
  minW: 110,        // 1小節の最小の幅
  numSize: 17,      // 数字の大きさ
  toneH: 17,        // 和音を積むときの行送り
  subH: 14          // ドレミ・CDE の行送り
};

/* 付点を付ける前の長さを拍数で。4分の4 なら4分音符が1拍 */
const nvBeats = n => (1 / DEN[n.d]) * state.beatValue;
/* のばし棒「−」の本数。2拍以上の音にだけ付く */
const nvDashes = n => Math.max(0, Math.round(nvBeats(n)) - 1);
/* 数字の下に引く線の本数。1拍より短い音に付く */
const nvUnder = n => Math.max(0, Math.round(Math.log2(DEN[n.d] / state.beatValue)));

function drawNumberView(host) {
  const W = Math.max(300, host.clientWidth || 900);
  const measures = buildMeasures();
  const perLine = Math.max(1, Math.min(state.perLine,
                  Math.floor((W - NV.margin * 2 - NV.headW) / NV.minW)));
  const mW = (W - NV.margin * 2 - NV.headW) / perLine;  // 1小節の幅
  const lines = [];
  for (let i = 0; i < measures.length; i += perLine) lines.push(measures.slice(i, i + perLine));

  /* 段ごとに、その段でいちばん音数の多い和音を調べて高さを決める */
  const lineTones = lines.map(ms => {
    let t = 1;
    ms.forEach(m => m.idx.forEach(i => {
      const n = state.notes[i];
      if (!n.rest) t = Math.max(t, Math.min(4, n.p.length));
    }));
    return t;
  });
  const legendH = 34;                                   // いちばん下に置く記号の説明
  const H = 12 + lineTones.reduce((a, t) => a + nvRows(t).h, 0) + 8 + legendH;

  const svg = svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H });
  host.appendChild(svg);

  const bar = (x, y0, y1, w) => svg.appendChild(svgEl('rect', {
    x: x - (w || 1) / 2, y: y0, width: w || 1, height: y1 - y0, fill: '#1c2024' }));

  let measureNo = 1;
  let y = 12;

  lines.forEach((lineMs, li) => {
    const t = lineTones[li];
    const r = nvRows(t);
    const numTop = y + r.numTop;                 // 1段目の数字のベースライン
    const numBot = y + r.numBot;                 // いちばん下の数字のベースライン
    const blockTop = y + 4;
    const blockBot = y + r.h - 8;
    const left = NV.margin + NV.headW;

    sysGeom[li] = { top: blockTop, left: left - 6, bot: blockBot,
                    right: left + lineMs.length * mW };

    /* 段の先頭に小節番号。1段目だけ拍子も出す。
       拍子は、ふつうの音符と同じ行（いちばん下）にそろえる */
    svgText(svg, NV.margin + 8, numTop - 14, String(measureNo), 10.5, '#8a919b');
    if (li === 0) {
      svgText(svg, NV.margin + NV.headW / 2, numBot + 2,
              state.beats + '/' + state.beatValue, 12, '#8a919b', '600');
    }

    lineMs.forEach((m, mi) => {
      const mx = left + mi * mW;
      bar(mx, blockTop + 4, blockBot - 4);               // 小節の頭の縦線
      nvDrawMeasure(svg, m, mx + 10, mW - 20, li, numBot,
                    y + r.sol, y + r.let, blockTop, blockBot);
      measureNo++;
    });

    /* 段の終わりの縦線。曲の終わりだけ太くする */
    bar(left + lineMs.length * mW, blockTop + 4, blockBot - 4,
        li === lines.length - 1 ? 3 : 1);

    y += r.h;
  });

  /* タイ。同じ段にある隣どうしだけ、数字の上に弧を描く */
  state.notes.forEach((n, i) => {
    const nx = state.notes[i + 1];
    if (!n.tie || n.rest || !nx || nx.rest) return;
    const a = geom[i], b = geom[i + 1];
    if (!a || !b || a.line !== b.line || b.x <= a.x) return;
    const top = Math.min(a.heads[0] != null ? a.heads[0] : a.top,
                         b.heads[0] != null ? b.heads[0] : b.top) - 9;
    svg.appendChild(svgEl('path', {
      d: 'M' + (a.x + 7) + ' ' + top + ' Q' + ((a.x + b.x) / 2) + ' ' + (top - 7) +
         ' ' + (b.x - 7) + ' ' + top,
      fill: 'none', stroke: '#1c2024', 'stroke-width': 1.3 }));
  });

  /* 記号の読み方。印刷や PNG にもそのまま入るよう、楽譜の中に書いておきます */
  svgText(svg, W / 2, H - 20,
    '数字 = 弾くキー（* は1オクターブ上）　0 = 休み　− = のばす',
    10.5, '#9aa1ab');
  svgText(svg, W / 2, H - 6,
    '数字の下の線 = 短い音（1本で半分、2本で4分の1）　・ = 付点',
    10.5, '#9aa1ab');

  return svg;
}

/* 1段ぶんの行の位置（段の上端からの相対値）。
   高さの計算と実際の描画で同じものを使うため、1か所にまとめてあります。 */
function nvRows(t) {
  const numTop = 26;
  const numBot = numTop + (t - 1) * NV.toneH;
  let y = numBot + 12;                                  // 下線のぶんを空ける
  /* 数字譜では CDE が上、ドレミが下。
     どの段も「いちばん低い音」を下にそろえて、和音は上へ積んでいくので、
     返すのはそれぞれの“いちばん下の行”の位置です */
  let lt = 0, sol = 0;
  if (state.showLet) { y += 12 + (t - 1) * 10; lt = y; }
  if (state.showSol) { y += 13 + (t - 1) * 11; sol = y; }
  return { numTop: numTop, numBot: numBot, sol: sol, let: lt, h: y + 20 };
}

/* 1小節ぶんを描く。

   音符の横位置は「拍どおり」にすると、16分音符が並んだところで
   数字が重なってしまいます。そこで
     その音符に最低限ほしい幅 ＋ 余った幅を長さの比で分ける
   という配り方にしています。音数が少ない小節ではほぼ拍どおりになり、
   詰まった小節でも最低限の間隔が残ります。 */
function nvDrawMeasure(svg, m, x0, span, line, numBot, solY, letY, top, bot) {
  if (!m.idx.length) return;

  const durs = m.idx.map(i => noteValue(state.notes[i]));
  /* その音符の文字幅ぶん。「1**」のような長い数字は広めに取る */
  const mins = m.idx.map(i => {
    const n = state.notes[i];
    const len = n.rest ? 1 : Math.max.apply(null, labelsFor(n).num.map(s => s.length));
    return Math.max(16, len * 8 + 6);
  });
  const totalMin = mins.reduce((a, b) => a + b, 0);
  const totalDur = durs.reduce((a, b) => a + b, 0);
  /* 最低限の幅すら入らないときは、その小節だけ全体を縮める。
     縮めるときは文字も小さくして、数字どうしが重ならないようにする */
  const shrink = totalMin > span ? span / totalMin : 1;
  const sc = Math.min(1, Math.max(0.7, shrink));
  const extra = Math.max(0, span - totalMin * shrink);
  const numSize = NV.numSize * sc;

  const cxs = [];                     // 下線をつなぐのに、あとでまとめて使う
  let x = x0;
  m.idx.forEach((i, k) => {
    const n = state.notes[i];
    const slot = mins[k] * shrink + (totalDur > 0 ? extra * durs[k] / totalDur : 0);
    const cx = x + mins[k] * shrink / 2;
    cxs[k] = cx;
    const heads = [];

    if (n.rest) {
      svgText(svg, cx, numBot, '0', numSize, '#1c2024', '600');
      heads.push(numBot - 6);
    } else {
      /* いちばん低い音を下の行に置き、和音で足した音は上へ積む。
         こうすると、ふつうの音符・休符・のばし棒と同じ行に主旋律がそろいます。
         labelsFor は高い音が先頭なので、後ろから数えて行を決めます */
      const nums = labelsFor(n).num;
      nums.forEach((txt, j) => {
        const ny = numBot - (nums.length - 1 - j) * NV.toneH;
        svgText(svg, cx, ny, txt, numSize, '#1c2024', '600');
        /* heads は「低い順」に入れる（[ ] キーで選ぶ tone と同じ数え方） */
        heads[nums.length - 1 - j] = ny - 6;
      });
    }

    /* のばし棒「−」。その音符に配られた幅の中へ等間隔に置く */
    const d = nvDashes(n);
    for (let j = 1; j <= d; j++) {
      svgText(svg, cx + slot * j / (d + 1), numBot, '−', numSize, '#1c2024');
    }
    /* 付点は「最後ののばし棒の右」。のばし棒がなければ数字のすぐ右 */
    if (n.dot) {
      const base = d ? cx + slot * d / (d + 1) : cx;
      svgText(svg, base + 12 * sc, numBot - 4, '・', 11 * sc, '#1c2024');
    }

    /* ドレミ・CDE。数字と同じく、いちばん低い音を下にそろえて上へ積む */
    const lab = labelsFor(n);
    const last = lab.sol.length - 1;
    if (state.showSol) lab.sol.forEach((s, j) => svgText(svg, cx, solY - (last - j) * 11, s, 11 * sc, '#6b7280'));
    if (state.showLet) lab.let.forEach((s, j) => svgText(svg, cx, letY - (last - j) * 10, s, 10 * sc, '#9aa1ab'));

    geom[i] = { x: cx, line: line, top: top, bot: bot, heads: heads };
    x += slot;
  });

  /* 下線（1拍より短い音）。五線譜で連桁がつながるところは、
     ここでも1本の線につなぐ。
     2本目・3本目の線は、その本数が要る音符が続いているところだけに引く
     （8分＋16分＋16分 なら、1本目は3つ通しで、2本目は後ろ2つぶん）。 */
  const half = 8 * sc;
  const line1 = (ka, kb, j) => svg.appendChild(svgEl('rect', {
    x: cxs[ka] - half, y: numBot + 4 + j * 3.5,
    width: (cxs[kb] - cxs[ka]) + half * 2, height: 1.2, fill: '#1c2024' }));

  const runs = beamRuns(m);
  const joined = {};
  runs.forEach(run => run.forEach(k => { joined[k] = true; }));
  runs.forEach(run => {
    const uOf = k => nvUnder(state.notes[m.idx[k]]);
    const maxU = Math.max.apply(null, run.map(uOf));
    for (let j = 0; j < maxU; j++) {
      let a = -1;
      run.forEach((k, r) => {
        const has = uOf(k) > j;
        if (has && a < 0) a = r;
        if (a >= 0 && (!has || r === run.length - 1)) {
          line1(run[a], run[has ? r : r - 1], j);
          a = -1;
        }
      });
    }
  });
  /* まとまりに入らなかった音符（単独の8分音符や、短い休符）はその音符ぶんだけ */
  m.idx.forEach((i, k) => {
    if (joined[k]) return;
    const u = nvUnder(state.notes[i]);
    for (let j = 0; j < u; j++) line1(k, k, j);
  });
}

const staveTopOf = st => st.getYForLine(0) - 40;

/* 連桁を何拍ぶんまで繋ぐか。
   ・8分の6・8分の3 … 付点4分（8分音符3つ）ぶん
   ・16分より細かい音符を含むまとまり … 1拍ぶん（繋ぎすぎると読みにくい）
   ・8分音符だけのまとまり … 2拍ぶん（4分の3 は1小節ぶん） */
function beamUnits(hasShort) {
  if (state.beatValue === 8 && state.beats % 3 === 0) return 3;
  if (hasShort) return 1;
  return state.beats === 3 ? 3 : 2;
}

/* 連桁を自分で組み立てる。

   まず、休符と4分音符より長い音符で区切って「続けて弾く8分音符などのまとまり」を作り、
   まとまりが長いときだけ途中で切る。

   切る位置は「小節の頭から2拍ごと」ではなく「そのまとまりが始まったところから」で数える。
   小節の頭を基準にすると、たとえば 4分 → 8分×3 → 4分 という並びで、
   3つ続く8分音符が2拍目の区切り線をまたいで 1個＋2個 に割れてしまう。

   ・休符と、4分音符より長い音符でいったん切る
   ・まとまりの頭から beamUnits 拍ぶんを超えたら、そこで切る
   ・2つ以上つながるときだけ連桁にする（1つだけなら旗が付く）

   VexFlow の generateBeams には任せていない。区切りを渡す方式だと、
   休符が同じ区切りに入ったときにその区切りの連桁がまるごと作られなくなる。 */
/* つなぐまとまりを、小節の中の何番目どうしかで返す。
   五線譜の連桁と、数字譜の下線で同じものを使うので、
   どちらの表示でも同じところが繋がります。 */
function beamRuns(m) {
  /* 休符と長い音符で区切って、まとまりを作る */
  const segs = [];
  let seg = [];
  const endSeg = () => { if (seg.length) segs.push(seg); seg = []; };
  m.idx.forEach((i, k) => {
    const n = state.notes[i];
    if (n.rest || DEN[n.d] < 8) endSeg();
    else seg.push({ k: k, len: noteValue(n), den: DEN[n.d] });
  });
  endSeg();

  /* まとまりごとに、頭から数えて長すぎるところで切る */
  const runs = [];
  segs.forEach(sg => {
    const unit = beamUnits(sg.some(x => x.den >= 16)) / state.beatValue;
    let run = [], acc = 0;
    const flush = () => {
      if (run.length > 1) runs.push(run);   // 1つだけのときは繋がない
      run = []; acc = 0;
    };
    sg.forEach(x => {
      if (run.length && acc + x.len > unit + 1e-9) flush();
      run.push(x.k); acc += x.len;
    });
    flush();
  });
  return runs;
}

function buildBeams(F, m, vfNotes) {
  const beams = [];
  beamRuns(m).forEach(run => {
    /* 第2引数の true で、つないだ音符ぜんたいを見て棒の向きを決めさせる */
    try { beams.push(new F.Beam(run.map(k => vfNotes[k]), true)); } catch (e) { /* 無視 */ }
  });
  return beams;
}

function drawMeasure(F, ctx, svg, stave, m, noteW, rows, drawn, line, tones) {
  const vfNotes = m.idx.map(i => {
    const n = state.notes[i];
    let sn;
    if (n.rest) {
      sn = new F.StaveNote({ keys: ['b/4'], duration: n.d + 'r' });
    } else {
      /* auto_stem を付けないと、VexFlow は棒を全部上向きにする。
         付けると、真ん中の線より上の音は下向き・下の音は上向きになる */
      sn = new F.StaveNote({ keys: n.p.slice().sort((a, b) => a - b).map(vexKeyOf),
                             duration: n.d, auto_stem: true });
    }
    if (n.dot) F.Dot.buildAndAttach([sn], { all: true });
    return sn;
  });

  let beams = [];
  try { beams = buildBeams(F, m, vfNotes); } catch (e) { beams = []; }

  /* 入力途中の小節は、見えない音符で残りを埋めて拍の位置をそろえる */
  const pad = padDurations(state.beats / state.beatValue - m.filled);
  const tickables = vfNotes.concat(pad.map(u => {
    const gn = new F.GhostNote({ duration: u.d });
    if (u.dot) { try { F.Dot.buildAndAttach([gn], { all: true }); } catch (e) {} }
    return gn;
  }));

  const voice = new F.Voice({ num_beats: state.beats, beat_value: state.beatValue,
                              numBeats: state.beats, beatValue: state.beatValue });
  try { voice.setMode(F.Voice.Mode.SOFT); } catch (e) { voice.setStrict(false); }
  voice.addTickables(tickables);

  new F.Formatter().joinVoices([voice]).format([voice], Math.max(40, noteW - 14));
  voice.draw(ctx, stave);
  beams.forEach(b => b.setContext(ctx).draw());

  /* ドレミ / 数字譜 / CDE の 3 行ラベル (五線の実座標を基準にする) */
  const topY = stave.getYForLine(0);
  const botY = stave.getYForLine(4);
  const base = botY + 24;
  const step = rowStepOf(tones);
  m.idx.forEach((i, k) => {
    const sn = vfNotes[k];
    let cx;
    try { cx = (sn.getNoteHeadBeginX() + sn.getNoteHeadEndX()) / 2; } catch (e) { cx = NaN; }
    if (!isFinite(cx)) cx = sn.getAbsoluteX() + 6;

    const lab = labelsFor(state.notes[i]);
    let r = 0;
    const put = (arr, size, fill, weight) => {          // 和音は上から順に積む
      arr.forEach((txt, t) => svgText(svg, cx, base + r * step + t * LINE_H, txt, size, fill, weight));
      r++;                                              // 休符でも行はそろえる
    };
    if (state.showSol) put(lab.sol, 12, '#1c2024');
    if (state.showNum) put(lab.num, 12, '#1c2024', '600');
    if (state.showLet) put(lab.let, 10.5, '#8a919b');

    let heads = [];
    try { if (!state.notes[i].rest) heads = sn.getYs().slice(); } catch (e) { heads = []; }
    geom[i] = { x: cx, line: line, top: topY - 34, heads: heads,
                bot: rows ? staveTopOf(stave) + 80 + labelsHOf(rows, tones) : botY + 10 };
    drawn[i] = { sn: sn, stave: stave };
  });
}

/* 選択範囲の帯を描き直す (楽譜の再描画は不要)。同じ段のぶんは 1 本にまとめる */
let dragFrom = -1;
function drawSelection(scroll) {
  if (!selGroup) return;
  while (selGroup.firstChild) selGroup.removeChild(selGroup.firstChild);
  const a = selStart(), b = selEnd();
  let i = a;
  while (i <= b) {
    const g = geom[i];
    if (!g) { i++; continue; }
    let j = i;
    while (j + 1 <= b && geom[j + 1] && geom[j + 1].line === g.line) j++;
    const gz = geom[j];
    selGroup.appendChild(svgEl('rect', {
      x: g.x - 15, y: g.top, width: (gz.x - g.x) + 30, height: g.bot - g.top,
      rx: 4, fill: '#2f6fed', 'fill-opacity': 0.12,
      stroke: '#2f6fed', 'stroke-opacity': 0.45
    }));
    i = j + 1;
  }
  const gc = geom[cursor];
  if (gc && tone >= 0 && gc.heads && gc.heads[tone] != null) {
    selGroup.appendChild(svgEl('circle', {
      cx: gc.x, cy: gc.heads[tone], r: 9,
      fill: 'none', stroke: '#2f6fed', 'stroke-width': 2
    }));
  }
  if (gc && scroll !== false) scrollIntoView(gc);
}
function scrollIntoView(g, follow) {
  /* 開いた直後はページのいちばん上（広告や曲名）が見えていてほしいので、
     起動時の描画では動かさない */
  if (!booted) return;
  const paper = document.getElementById('paper');
  const svg = document.querySelector('#score svg');
  if (!svg) return;
  const off = svg.getBoundingClientRect().top - paper.getBoundingClientRect().top + paper.scrollTop;
  const yTop = off + g.top, yBot = off + g.bot;
  const view = paper.scrollTop;
  const outOfView = yTop < view + 8 || yBot > view + paper.clientHeight - 8;
  /* follow = 再生中の追従。段が変わったら、見えていてもその段を上端へ持ってくる。
     編集中(follow なし)は、対象が画面の外に出てしまったときだけ動かす */
  if (!outOfView && !(follow && g.line !== anchorLine)) { anchorLine = g.line; return; }
  anchorLine = g.line;
  smoothScrollTo(paper, yTop - 16);
}

/* 演奏中に場所を見失わないよう、スクロールは短いアニメーションで動かす */
let scrollAnim = 0;
function cancelScrollAnim() { cancelAnimationFrame(scrollAnim); scrollAnim = 0; }
function smoothScrollTo(el, to) {
  cancelScrollAnim();
  to = Math.max(0, Math.min(to, el.scrollHeight - el.clientHeight));
  const from = el.scrollTop;
  const dist = to - from;
  /* 裏のタブでは requestAnimationFrame が止まるので、その場合は一気に動かす */
  if (Math.abs(dist) < 2 || document.hidden) { el.scrollTop = to; return; }
  const dur = Math.min(400, Math.max(160, Math.abs(dist) * 0.7));
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    el.scrollTop = from + dist * (1 - Math.pow(1 - p, 3));   // ease-out
    scrollAnim = p < 1 ? requestAnimationFrame(step) : 0;
  };
  scrollAnim = requestAnimationFrame(step);
}
/* 再生位置までを塗る。line = いま鳴っている段, x = その段の中での現在位置 */
function drawSeek(line, x) {
  seekRects.forEach((r, li) => {
    const sg = sysGeom[li];
    if (!r || !sg) return;
    if (li < line) {
      r.setAttribute('width', Math.max(0, sg.right - sg.left));
      r.setAttribute('visibility', 'visible');
    } else if (li === line) {
      r.setAttribute('width', Math.max(0, Math.min(sg.right, x) - sg.left));
      r.setAttribute('visibility', 'visible');
    } else {
      r.setAttribute('visibility', 'hidden');
    }
  });
  const sg = sysGeom[line];
  if (seekEdge && sg) {
    seekEdge.setAttribute('x', Math.max(sg.left, Math.min(sg.right, x)) - 1.25);
    seekEdge.setAttribute('y', sg.top);
    seekEdge.setAttribute('height', sg.bot - sg.top);
    seekEdge.setAttribute('visibility', 'visible');
  }
}
function hidePlayhead() {
  seekRects.forEach(r => r && r.setAttribute('visibility', 'hidden'));
  if (seekEdge) seekEdge.setAttribute('visibility', 'hidden');
}

/* ============================================================
   6. 編集操作
   ============================================================ */
function refresh() {
  if (!state.notes.length) { state.notes = [newNote(clampStep(0), 'q', false, true)]; cursor = 0; }
  cursor = Math.max(0, Math.min(cursor, state.notes.length - 1));
  if (anchor >= state.notes.length) anchor = state.notes.length - 1;
  if (anchor === cursor) anchor = -1;
  render();
  syncPanel();
  autosave();
}

function setCursor(i, extend) {
  resetTap();
  tone = -1;
  if (extend) { if (anchor < 0) anchor = cursor; }
  else clearSel();
  cursor = Math.max(0, Math.min(i, state.notes.length - 1));
  if (anchor === cursor) anchor = -1;
  drawSelection();
  syncPanel();
}

/* [ ] キー / 音符の玉クリックで、和音の中の 1 音だけを選ぶ */
function setTone(k) {
  const n = cur();
  tone = (k < 0 || !n || n.rest || n.p.length < 2)
    ? -1                                           // -1 は「和音まるごと」に戻す
    : Math.max(0, Math.min(n.p.length - 1, k));
  drawSelection();
  syncPanel();
}
function moveTone(d) {
  const n = cur();
  if (!n || n.rest || n.p.length < 2) { setTone(-1); return; }
  const k = tone < 0 ? 0 : tone + d;
  setTone(Math.max(0, Math.min(n.p.length - 1, k)));   // 端では止まる（解除は Esc）
}

function movePitch(delta) {
  pushUndo();
  const one = cur();
  if (tone >= 0 && selCount() === 1 && !one.rest && tone < one.p.length) {
    const ps = one.p.slice().sort((a, b) => a - b);
    const moved = clampStep(ps[tone] + delta);
    ps.splice(tone, 1);
    if (ps.indexOf(moved) >= 0) { refresh(); return; }   // 同じ音が既にある
    ps.push(moved);
    ps.sort((a, b) => a - b);
    one.p = ps;
    one.fresh = false;
    tone = ps.indexOf(moved);
    refresh();
    return;
  }
  eachSel(n => {
    if (n.rest) return;                 // 休符は音程を持たないので飛ばす
    n.fresh = false;
    n.p = Array.from(new Set(n.p.map(s => clampStep(s + delta)))).sort((a, b) => a - b);
  });
  const c = cur();
  if (c.rest && selCount() === 1) { c.rest = false; c.fresh = false; c.p = c.p.map(s => clampStep(s + delta)); }
  refresh();
}

function changeDur(dir, noUndo) {    // dir: +1 = 長く, -1 = 短く
  let changed = false;
  eachSel(n => {
    const i = durIndex(n);
    const j = Math.max(0, Math.min(DURS.length - 1, (i < 0 ? 5 : i) + dir));
    if (n.d !== DURS[j].c || n.dot !== DURS[j].dot) changed = true;
  });
  if (!changed) return false;                  // どれも端まで来ている
  if (!noUndo) pushUndo();
  eachSel(n => {
    const i = durIndex(n);
    const j = Math.max(0, Math.min(DURS.length - 1, (i < 0 ? 5 : i) + dir));
    n.d = DURS[j].c; n.dot = DURS[j].dot;
  });
  refresh();
  return true;
}
function setDur(code, dot) {
  pushUndo();
  eachSel(n => { n.d = code; n.dot = !!dot; });
  refresh();
}

function gotoNext() {
  clearSel();
  if (cursor < state.notes.length - 1) { setCursor(cursor + 1); return; }
  const n = cur();
  pushUndo();
  state.notes.push({ p: n.p.slice(), d: n.d, dot: n.dot, rest: false, tie: false });
  cursor = state.notes.length - 1;
  refresh();
}
function gotoPrev() { setCursor(cursor - 1); }

function insertNote() {
  resetTap();
  clearSel();
  const n = cur();
  pushUndo();
  state.notes.splice(cursor + 1, 0, { p: n.p.slice(), d: n.d, dot: n.dot, rest: n.rest, tie: false });
  cursor++;
  refresh();
}
function deleteNote() {
  resetTap();
  const one = cur();
  if (tone >= 0 && selCount() === 1 && !one.rest && one.p.length > 1) {
    pushUndo();
    const ps = one.p.slice().sort((a, b) => a - b);
    ps.splice(tone, 1);
    one.p = ps;
    tone = Math.min(tone, ps.length - 1);
    if (ps.length < 2) tone = -1;
    refresh();
    return;
  }
  const a = selStart(), b = selEnd();
  if (b - a + 1 >= state.notes.length) {      // 全部消すときは 1 個だけ残す
    pushUndo();
    state.notes = [newNote(clampStep(0), 'q', false, true)];
    cursor = 0; clearSel(); refresh();
    return;
  }
  pushUndo();
  state.notes.splice(a, b - a + 1);
  cursor = Math.min(a, state.notes.length - 1);
  clearSel();
  refresh();
}

/* まとめて切り替えるときは、先頭の音符の状態を反転した値に全部そろえる */
function toggleRest() {
  pushUndo();
  const to = !cur().rest;
  eachSel(n => { n.rest = to; n.fresh = false; if (to) n.tie = false; });
  refresh();
}
function toggleDot() {
  pushUndo();
  const to = !cur().dot;
  eachSel(n => { n.dot = to; });
  refresh();
}
function toggleTie() {
  pushUndo();
  const to = !cur().tie;
  eachSel(n => { n.tie = to && !n.rest; });
  refresh();
}

function addChordTone() {
  pushUndo();
  eachSel(n => {
    if (n.rest || n.p.length >= 4) return;
    const add = clampStep(Math.max.apply(null, n.p) + 2);
    if (n.p.indexOf(add) < 0) n.p = n.p.concat([add]).sort((a, b) => a - b);
  });
  refresh();
}
function removeChordTone() {
  const one = cur();
  if (tone >= 0 && selCount() === 1 && !one.rest && one.p.length > 1) { deleteNote(); return; }
  pushUndo();
  eachSel(n => {
    if (n.p.length > 1) n.p = n.p.slice().sort((a, b) => a - b).slice(0, -1);
  });
  refresh();
}

/* ---------- コピー / 切り取り / 貼り付け ---------- */
function copySel() {
  clipboard = state.notes.slice(selStart(), selEnd() + 1)
                .map(n => JSON.parse(JSON.stringify(n)));
  clipboard.forEach(n => { delete n.fresh; });
  syncPanel();
}
function cutSel() { copySel(); deleteNote(); }
function pasteClip() {
  if (!clipboard.length) return;
  resetTap();
  pushUndo();
  const copy = clipboard.map(n => JSON.parse(JSON.stringify(n)));
  const a = selStart(), b = selEnd();
  if (anchor >= 0) {                       // 範囲を選んでいたら置き換える
    state.notes.splice(a, b - a + 1, ...copy);
    selectRange(a, a + copy.length - 1);
  } else if (cur().fresh) {                // 仮置きの音符しかないときは差し替える
    state.notes.splice(cursor, 1, ...copy);
    selectRange(cursor, cursor + copy.length - 1);
  } else {
    state.notes.splice(cursor + 1, 0, ...copy);
    selectRange(cursor + 1, cursor + copy.length);
  }
  refresh();
}
function selectAll() {
  selectRange(0, state.notes.length - 1);
  drawSelection();
  syncPanel();
}

/* リズム入力モード用: 直前に音を入れた時刻と、その音符の位置 */
let tapAt = 0, tapIdx = -1;
function resetTap() { tapAt = 0; tapIdx = -1; }

/* 追加 / リズム入力モード共通: 新しい音符（休符も）をカーソルの後ろに足す。
   リズム入力モードでは、直前の音符の長さを「そこから今までの間隔」で決める */
function appendInMode(build) {
  const n = cur();
  const tap = state.inputMode === 'tap';
  const now = tap ? performance.now() : 0;
  if (tap && tapAt && tapIdx >= 0 && tapIdx < state.notes.length) {
    const q = quantizeToDur((now - tapAt) / (60000 / state.tempo));
    state.notes[tapIdx].d = q.c;
    state.notes[tapIdx].dot = q.dot;
  }
  const made = build(n);
  if (n.fresh) {                        // 仮置きの 1 個目はそこに書き込む
    n.p = made.p; n.rest = made.rest; n.tie = false; n.fresh = false;
  } else {
    state.notes.splice(cursor + 1, 0, made);
    cursor++;
  }
  if (tap) { tapIdx = cursor; tapAt = now; }
}

/* 0 キー: 1〜7 と同じくモードに従う。
   「音程を変更」なら休符に切り替え、「音符を追加」「リズム入力」なら休符を追加する */
function inputRest() {
  if (state.inputMode === 'edit') { toggleRest(); return; }
  clearSel();
  pushUndo();
  appendInMode(prev => ({ p: prev.p.slice(), d: prev.d, dot: prev.dot, rest: true, tie: false }));
  refresh();
}

/* 音高を直接指定。toggleChord=true なら和音として足す/外す */
function applyStep(step, toggleChord) {
  clearSel();
  const n = cur();
  step = clampStep(step);
  pushUndo();

  /* 追加 / リズム入力モード: 選択中の音符の後ろに足してそこへ移る */
  if (!toggleChord && state.inputMode !== 'edit') {
    appendInMode(prev => ({ p: [step], d: prev.d, dot: prev.dot, rest: false, tie: false }));
    refresh();
    return;
  }

  n.rest = false;
  n.fresh = false;
  if (!toggleChord && tone >= 0 && n.p.length > 1 && tone < n.p.length) {
    const ps = n.p.slice().sort((a, b) => a - b);
    ps.splice(tone, 1);
    if (ps.indexOf(step) < 0) ps.push(step);
    ps.sort((a, b) => a - b);
    n.p = ps;
    tone = ps.indexOf(step);
    refresh();
    return;
  }
  if (toggleChord) {
    const at = n.p.indexOf(step);
    if (at >= 0) { if (n.p.length > 1) n.p.splice(at, 1); }
    else if (n.p.length < 4) n.p = n.p.concat([step]).sort((a, b) => a - b);
  } else {
    n.p = [step];
  }
  refresh();
}

/* 1〜7 キー: いまの音のオクターブでその階名にする */
function setDegree(deg) {
  const n = cur();
  const ref = n.p.length ? Math.max.apply(null, n.p) : 0;
  let s = Math.floor(ref / 7) * 7 + deg;
  if (s < minStep()) s += 7;
  if (s > maxStep()) s -= 7;
  applyStep(s, false);
}

/* ============================================================
   7. 画面パネルの同期
   ============================================================ */
function syncPanel() {
  const n = cur();
  /* 長さパレット */
  document.querySelectorAll('#durs button').forEach(b => {
    b.classList.toggle('on', b.dataset.c === n.d && (b.dataset.dot === '1') === !!n.dot);
  });
  /* トグル系ボタン */
  document.getElementById('btnRest').style.background = n.rest ? 'var(--accent-soft)' : '';
  document.getElementById('btnDot').style.background = n.dot ? 'var(--accent-soft)' : '';
  document.getElementById('btnTie').style.background = n.tie ? 'var(--accent-soft)' : '';
  /* カリンバのキー */
  document.querySelectorAll('#tines button').forEach(b => {
    b.classList.toggle('on', !n.rest && n.p.indexOf(+b.dataset.step) >= 0);
  });
  /* ステータス */
  const dn = DNAME[n.d] + (n.dot ? '付点' : '') + (n.rest ? '休符' : '音符');
  document.getElementById('status').textContent = selCount() > 1
    ? (selStart() + 1) + '〜' + (selEnd() + 1) + ' 個目を選択中（' + selCount() + ' 個）　' +
      '↑↓ で全部の音程　←→ で全部の長さ　Ctrl+C / Ctrl+V' +
      (clipboard.length ? '　［コピー済み ' + clipboard.length + ' 個］' : '')
    : (cursor + 1) + ' / ' + state.notes.length + ' 個目　' +
      labelText(n) +
      (tone >= 0 && !n.rest && n.p.length > 1
        ? '　→ ' + solfegeOf(n.p.slice().sort((a, b) => a - b)[tone]) +
          ' だけを選択中（↑↓ で移動 / Delete で外す / Esc で解除）' : '') +
      '　' + dn +
      (n.tie ? '　タイ' : '') +
      (clipboard.length ? '　［コピー済み ' + clipboard.length + ' 個］' : '');
  /* 見出し */
  document.getElementById('sheetTitle').textContent = state.title;
  document.getElementById('sheetMeta').textContent =
    '♩= ' + state.tempo + '　' + state.beats + '/' + state.beatValue + '　' + P().label;
  /* 曲に名前が付いていないうちは、ページ本来のタイトルのままにしておく。
     ここで毎回書き換えていたせいで、検索エンジンからは
     「無題の曲 - カリンバ楽譜」というページに見えていた */
  document.title = (state.title && state.title !== '無題の曲')
    ? state.title + '｜カリンバ楽譜メーカー'
    : SITE_TITLE;
}

function buildDurPalette() {
  const host = document.getElementById('durs');
  host.innerHTML = '';
  DURS.forEach(d => {
    const b = document.createElement('button');
    b.dataset.c = d.c; b.dataset.dot = d.dot ? '1' : '0';
    b.innerHTML = durIcon(d.c, d.dot) +
                  '<small>' + DNAME[d.c] + (d.dot ? '．' : '') + '</small>';
    b.title = DNAME[d.c] + (d.dot ? '付点' : '') + '音符';
    b.addEventListener('click', () => { setDur(d.c, d.dot); blurAll(); });
    host.appendChild(b);
  });
}

function buildTines() {
  const host = document.getElementById('tines');
  host.innerHTML = '';

  /* 休符キー。0 で休符が入れられることが見てわかるように鍵盤の隣に置く */
  const rest = document.createElement('button');
  rest.className = 'restkey';
  rest.innerHTML = '<span class="num">0</span><span class="sol">休符</span>';
  rest.title = '休符（0 キー）。「音符を追加」「リズム入力」では休符を追加します';
  rest.addEventListener('click', () => { inputRest(); blurAll(); });
  host.appendChild(rest);

  const p = P();
  const order = tineOrder(p.count);
  const center = (order.length - 1) / 2;
  order.forEach((k, pos) => {
    const step = p.base + k;
    const b = document.createElement('button');
    b.dataset.step = step;
    b.style.height = (84 - Math.abs(pos - center) * 3.6) + 'px';
    b.innerHTML = '<span class="num">' + numberOf(step) + '</span>' +
                  '<span class="sol">' + solfegeOf(step) + '</span>' +
                  '<span class="let">' + letterOf(step) + '</span>';
    b.title = solfegeOf(step) + ' / ' + numberOf(step) + ' / ' + letterOf(step) +
              '（Shift+クリックで和音）';
    b.addEventListener('click', ev => {
      applyStep(step, ev.shiftKey);
      previewTone(step);
      blurAll();
    });
    host.appendChild(b);
  });
}
function blurAll() { if (document.activeElement) document.activeElement.blur(); }

/* ============================================================
   8. 再生 (Web Audio でカリンバ風の音)
   ============================================================ */
let audio = null, playing = false, timers = [], stopAt = 0, bus = null, playMode = 'here';
let seekAnim = 0, playInfo = null;
/* 無音再生: 音は出さず、シークバーとスクロールだけ動かす（自分で弾く練習用） */
const SILENT_KEY = 'kalimba-silent';
let silent = false;
function setSilent(on) {
  silent = !!on;
  document.getElementById('btnSilent').classList.toggle('on', silent);
  try { localStorage.setItem(SILENT_KEY, silent ? '1' : '0'); } catch (e) {}
  if (silent && playing) {                 // 再生中に切り替えたら今の音も止める
    const wasFrom = playMode;
    const at = playInfo ? playInfo.list[playInfo.k].i : cursor;
    stop();
    playMode = wasFrom;
    play(at);
  }
}
function ac() {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume();
  return audio;
}
function pluck(midi, at, dur, vol, dest) {
  const c = ac();
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const len = Math.min(3.2, Math.max(0.35, dur * 1.35 + 0.35));
  const out = c.createGain();
  out.gain.value = (vol == null ? 0.9 : vol);
  out.connect(dest || c.destination);
  [[1, 1], [2, 0.38], [3, 0.14], [4.16, 0.07], [5.4, 0.035]].forEach(pair => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * pair[0];
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.22 * pair[1], at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len / (1 + pair[0] * 0.25));
    o.connect(g); g.connect(out);
    o.start(at); o.stop(at + len + 0.05);
  });
}
function previewTone(step) { pluck(midiOf(step), ac().currentTime + 0.01, 0.5, 0.7); }

/* 再生用のイベント列。音符 1 個につき 1 イベント。
   タイは「同じ高さの音が次の音符にもある」ときだけ効く。和音の一部だけタイでも、
   その音だけ伸ばし、残りは次の音符で鳴らし直す（表示のタイと一致する） */

/* その音符から step の音がタイで何秒伸びるか */
function tiedLength(i, step, spq) {
  const ns = state.notes;
  let d = noteValue(ns[i]) * 4 * spq, j = i;
  while (!ns[j].rest && ns[j].tie && ns[j + 1] && !ns[j + 1].rest &&
         ns[j + 1].p.indexOf(step) >= 0) {
    j++;
    d += noteValue(ns[j]) * 4 * spq;
  }
  return d;
}

function buildEvents() {
  const spq = 60 / state.tempo;                 // 4分音符 1つの秒数
  const ns = state.notes;
  const evs = [];
  let t = 0;
  let held = [];                                // 前の音符からタイで伸びている音
  for (let i = 0; i < ns.length; i++) {
    const n = ns[i];
    const step = noteValue(n) * 4 * spq;
    const fresh = n.rest ? [] : n.p.filter(p => held.indexOf(p) < 0);   // 新しく鳴らす音
    evs.push({ i: i, t: t, dur: step, rest: n.rest, p: fresh,
               durs: fresh.map(p => tiedLength(i, p, spq)) });
    held = (!n.rest && n.tie && ns[i + 1] && !ns[i + 1].rest)
      ? n.p.filter(p => ns[i + 1].p.indexOf(p) >= 0)
      : [];
    t += step;
  }
  return { evs: evs, total: t };
}

/* startAt は「何番目の音符から」。fromTime を渡すと「曲の何秒目から」になり、
   画面の時計もその秒数から進む（練習画面の一時停止・シークで使う） */
function play(startAt, leadIn, fromTime) {
  if (mic.on) micStop();
  stop();
  const c = ac();
  const r = buildEvents();
  const t0 = c.currentTime + 0.12 + (leadIn || 0);
  let list;
  if (fromTime != null) {
    const i0 = r.evs.findIndex(e => e.t >= fromTime - 1e-6);
    list = i0 < 0 ? [] : r.evs.slice(i0);
  } else {
    const from = r.evs.findIndex(e => e.i >= startAt);
    list = from > 0 ? r.evs.slice(from) : r.evs.slice();
  }
  if (!list.length) return;
  /* タイの途中から鳴らすときは、伸びてきている音をここで鳴らし直す */
  if (!list[0].rest && !list[0].p.length) {
    const spq = 60 / state.tempo;
    const n = state.notes[list[0].i];
    list[0] = Object.assign({}, list[0], {
      p: n.p.slice(), durs: n.p.map(p => tiedLength(list[0].i, p, spq))
    });
  }
  const offset = fromTime != null ? fromTime : list[0].t;
  playing = true;
  anchorLine = -1;              // 再生を始める段を必ず上端に出す
  bus = c.createGain();
  bus.gain.value = 1;
  bus.connect(c.destination);
  const myBus = bus;
  syncPlayButtons();
  if (!silent) {
    list.forEach(e => {
      e.p.forEach((s, k) => pluck(midiOf(s), t0 + e.t - offset, e.durs[k], null, myBus));
    });
  }
  const endT = list.reduce((m, e) =>
    Math.max(m, e.t + Math.max(e.dur, e.durs.length ? Math.max.apply(null, e.durs) : 0)), 0);
  /* leadIn のぶん鳴り始めが遅れるので、止める時刻もその分うしろにずらす。
     入れ忘れると、練習画面で曲の最後 leadIn 秒ぶんが切れてしまう */
  stopAt = setTimeout(stop, (endT - offset + 0.4 + (leadIn || 0)) * 1000);

  /* シークバーは音の時計に合わせて毎フレーム描き直す */
  playInfo = { list: list, t0: t0, offset: offset, k: 0, line: -1 };
  seekTick();
}

/* 現在の再生位置を求めて、そこまでを塗る */
function seekTick() {
  if (!playing || !playInfo) return;
  seekAnim = requestAnimationFrame(seekTick);
  const list = playInfo.list;
  const el = ac().currentTime - playInfo.t0 + playInfo.offset;   // 楽譜上の経過時間
  if (el < list[0].t) return;                                    // 鳴り出す前
  let k = playInfo.k;
  while (k < list.length - 1 && el >= list[k + 1].t) k++;
  playInfo.k = k;

  const e = list[k];
  const g = geom[e.i];
  const sg = g && sysGeom[g.line];
  if (!g || !sg) return;

  const next = list[k + 1] ? geom[list[k + 1].i] : null;
  const x0 = g.x - 9;
  const x1 = (next && next.line === g.line) ? next.x - 9 : sg.right;
  const p = e.dur > 0 ? Math.min(1, Math.max(0, (el - e.t) / e.dur)) : 1;
  drawSeek(g.line, x0 + (x1 - x0) * p);

  if (g.line !== playInfo.line) {        // 段が変わったらスクロールで追う
    playInfo.line = g.line;
    scrollIntoView(g, true);
  }
}
function stop() {
  timers.forEach(clearTimeout); timers = [];
  clearTimeout(stopAt);
  cancelAnimationFrame(seekAnim); seekAnim = 0; playInfo = null;
  if (bus && audio) {                       // 予約済みの音も素早くフェードアウトさせる
    const b = bus, now = audio.currentTime;
    try {
      b.gain.cancelScheduledValues(now);
      b.gain.setValueAtTime(b.gain.value, now);
      b.gain.linearRampToValueAtTime(0, now + 0.06);
    } catch (e) { /* 無視 */ }
    setTimeout(() => { try { b.disconnect(); } catch (e) {} }, 300);
    bus = null;
  }
  playing = false;
  hidePlayhead();
  syncPlayButtons();
  if (fall.on) syncFallButtons();
}

/* 「最初から」「ここから」の 2 つのボタン。鳴っている側が停止ボタンになる */
function syncPlayButtons() {
  const all = document.getElementById('btnPlayAll');
  const here = document.getElementById('btnPlayHere');
  if (!all || !here) return;
  all.textContent  = (playing && playMode === 'all')  ? '■ 停止' : '▶ 最初から';
  here.textContent = (playing && playMode === 'here') ? '■ 停止' : '▶ ここから';
}
function togglePlay(mode) {
  if (playing && playMode === mode) { stop(); return; }
  playMode = mode;
  play(mode === 'all' ? 0 : selStart());
}

/* ============================================================
   9. 保存 / 読込 / 書き出し
   ============================================================ */
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function saveJson() {
  download((state.title || 'score') + '.json',
    new Blob([serialize()], { type: 'application/json' }));
}
function exportPng() {
  const svg = document.querySelector('#score svg');
  if (!svg) return;
  const clone = svg.cloneNode(true);
  clone.querySelectorAll('.cursor,.playhead,.hit').forEach(e => e.remove());
  clone.setAttribute('xmlns', SVGNS);
  const w = +svg.getAttribute('width'), h = +svg.getAttribute('height');
  const src = 'data:image/svg+xml;charset=utf-8,' +
              encodeURIComponent(new XMLSerializer().serializeToString(clone));
  const img = new Image();
  img.onload = () => {
    const sc = 2, pad = 24, th = 46;
    const cv = document.createElement('canvas');
    cv.width = (w + pad * 2) * sc;
    cv.height = (h + pad * 2 + th) * sc;
    const g = cv.getContext('2d');
    g.setTransform(sc, 0, 0, sc, 0, 0);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w + pad * 2, h + pad * 2 + th);
    g.fillStyle = '#1c2024';
    g.textAlign = 'center';
    g.font = '600 20px ' + FONT_JP;
    g.fillText(state.title, (w + pad * 2) / 2, pad + 6);
    g.fillStyle = '#6b7280';
    g.font = '12px ' + FONT_JP;
    g.fillText('♩= ' + state.tempo + '　' + state.beats + '/' + state.beatValue + '　' + P().label,
               (w + pad * 2) / 2, pad + 26);
    g.drawImage(img, pad, pad + th);
    cv.toBlob(b => download((state.title || 'score') + '.png', b));
  };
  img.onerror = () => alert('PNG の書き出しに失敗しました。印刷から PDF 保存をお試しください。');
  img.src = src;
}

/* ============================================================
   10. キーボード
   ============================================================ */
function onKey(e) {
  if (adModalOpen()) {                             // 広告モーダル中は閉じるだけ
    if (e.key === 'Escape') { e.preventDefault(); closeAdModal(); }
    return;
  }
  if (fall.on) {                                   // 練習画面では再生と終了だけ
    if (e.key === 'Escape') { e.preventDefault(); closeFall(); }
    else if (e.key === ' ') { e.preventDefault(); fallTogglePlay(); }
    return;
  }
  if (!document.getElementById('tutorial').hidden) {
    if (e.key === 'Escape') { e.preventDefault(); closeTutorial(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); tutMove(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); tutMove(-1); }
    return;
  }
  if (e.key === 'Escape' && !document.getElementById('songs').hidden) {
    e.preventDefault(); closeSongs(); return;
  }
  if (!document.getElementById('songs').hidden) return;   // 曲パネル表示中は譜面の操作をしない
  if (readOnly && e.key !== ' ' && e.key !== 'Escape') return;   // 閲覧モードは再生だけ
  const t = e.target;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) {
    if (e.key === 'Escape' || e.key === 'Enter') t.blur();
    return;
  }
  const k = e.key;
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
  if (ctrl && (k === 's' || k === 'S')) { e.preventDefault(); saveJson(); return; }
  if (ctrl && (k === 'a' || k === 'A')) { e.preventDefault(); selectAll(); return; }
  if (ctrl && (k === 'c' || k === 'C')) { e.preventDefault(); copySel(); return; }
  if (ctrl && (k === 'x' || k === 'X')) { e.preventDefault(); cutSel(); return; }
  if (ctrl && (k === 'v' || k === 'V')) { e.preventDefault(); pasteClip(); return; }
  if (ctrl) return;

  switch (k) {
    case 'ArrowUp':    e.preventDefault(); movePitch(e.shiftKey ? 7 : 1); return;
    case 'ArrowDown':  e.preventDefault(); movePitch(e.shiftKey ? -7 : -1); return;
    case 'ArrowRight':
      e.preventDefault();
      if (e.shiftKey) setCursor(cursor + 1, true); else changeDur(1);
      return;
    case 'ArrowLeft':
      e.preventDefault();
      if (e.shiftKey) setCursor(cursor - 1, true); else changeDur(-1);
      return;
    case 'Tab':        e.preventDefault(); e.shiftKey ? gotoPrev() : gotoNext(); return;
    case 'Enter':      e.preventDefault(); insertNote(); return;
    case 'Backspace':
    case 'Delete':     e.preventDefault(); deleteNote(); return;
    case 'Home':       e.preventDefault(); setCursor(0, e.shiftKey); return;
    case 'End':        e.preventDefault(); setCursor(state.notes.length - 1, e.shiftKey); return;
    case 'Escape':
      e.preventDefault();
      if (tone >= 0) setTone(-1); else { clearSel(); drawSelection(); syncPanel(); }
      return;
    case '[':
    case '「':       e.preventDefault(); moveTone(-1); return;
    case ']':
    case '」':       e.preventDefault(); moveTone(1); return;
    case ' ':          e.preventDefault(); togglePlay(e.shiftKey ? 'all' : 'here'); return;
    case '.':
    case '。':         e.preventDefault(); toggleDot(); return;
    case '0':          e.preventDefault(); inputRest(); return;
  }
  if (k >= '1' && k <= '7') { e.preventDefault(); setDegree(+k - 1); previewTone(cur().p[0]); return; }
  const low = k.toLowerCase();
  if (low === 'm') {
    e.preventDefault();
    setInputMode(MODES[(MODES.indexOf(state.inputMode) + 1) % MODES.length]);
    return;
  }
  if (low === 'r') { e.preventDefault(); toggleRest(); return; }
  if (low === 't') { e.preventDefault(); toggleTie(); return; }
  if (low === 'c') { e.preventDefault(); e.shiftKey ? removeChordTone() : addChordTone(); return; }
}

/* ------------------------------------------------------------
   マウスホイール: 音符の上で回すと長さを変える
   一度回し始めたら、音符が動いてもその音符を掴んだままにする
   ------------------------------------------------------------ */
const WHEEL_STEP = 90;      // ホイール 1 ノッチ (deltaY≒100) で 1 段階
const WHEEL_HOLD = 700;     // ms: この間は同じ音符を掴み続ける
let wheelAt = 0, wheelAcc = 0;

function onWheel(e) {
  if (readOnly) return;                     // 閲覧モードでは長さを変えない
  if (e.ctrlKey || e.shiftKey) return;      // ブラウザの拡大縮小・横スクロールは邪魔しない
  const t = e.target;
  const onNote = t && t.classList && t.classList.contains('hit');
  const now = Date.now();
  const holding = now - wheelAt < WHEEL_HOLD;
  if (!onNote && !holding) return;          // 音符の外ならページのスクロールに任せる
  e.preventDefault();

  if (!holding) {                           // ジェスチャの開始
    if (onNote) {
      const i = +t.getAttribute('data-i');
      if (!isNaN(i)) setCursor(i);
    }
    wheelAcc = 0;
    pushUndo();                             // 1 回の操作をまとめて元に戻せるように
  }
  wheelAt = now;

  let d = e.deltaY;
  if (e.deltaMode === 1) d *= 33;           // 行単位
  else if (e.deltaMode === 2) d *= 300;     // ページ単位
  wheelAcc += d;

  while (wheelAcc <= -WHEEL_STEP) { wheelAcc += WHEEL_STEP; changeDur(1, true); }
  while (wheelAcc >= WHEEL_STEP)  { wheelAcc -= WHEEL_STEP; changeDur(-1, true); }
}


/* ============================================================
   12. メトロノーム
   （リズム入力・マイク入力ではテンポが基準になるので、
     拍を聞きながら弾けるようにしておく）
   ============================================================ */
let metroOn = false, metroTimer = null, metroNext = 0, metroBeat = 0;

function metroClick(at, accent) {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1600 : 1050;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(accent ? 0.15 : 0.08, at + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
  o.connect(g); g.connect(c.destination);
  o.start(at); o.stop(at + 0.07);
}
function metroSchedule() {
  const c = ac();
  const beat = (60 / state.tempo) * (4 / state.beatValue);
  while (metroNext < c.currentTime + 0.2) {
    metroClick(metroNext, metroBeat % state.beats === 0);
    metroNext += beat;
    metroBeat++;
  }
}
function setMetro(on) {
  metroOn = !!on;
  clearInterval(metroTimer);
  metroTimer = null;
  if (metroOn) {
    metroNext = ac().currentTime + 0.12;
    metroBeat = 0;
    metroSchedule();
    metroTimer = setInterval(metroSchedule, 50);
  }
  document.getElementById('btnMetro').classList.toggle('on', metroOn);
}

/* ============================================================
   13. マイク入力（単音の聞き取り）
   ------------------------------------------------------------
   自己相関で基本周波数を拾い、いちばん近いカリンバのキーに丸める。
   音が変わったところ / 音量が立ち上がったところを音符の切れ目とみなし、
   その間隔をテンポに合わせて音符の長さに丸める。
   和音には対応しない（単音のみ）。
   ============================================================ */
let micGate = 0.012;                 // これ以下の音量は無音とみなす
const mic = { on: false, stream: null, src: null, an: null, buf: null,
              raf: 0, seg: null, env: 0, cand: -1, candN: 0, lastVoice: 0, restFrom: 0 };

/* 自己相関による基本周波数の推定。見つからなければ -1 */
function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < micGate) return -1;

  /* 前後の無音部分を落とす */
  let r1 = 0, r2 = SIZE - 1;
  const thres = 0.2;
  for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
  const b = buf.subarray(r1, r2);
  const S = b.length;
  if (S < 128) return -1;

  const c = new Float32Array(S);
  for (let i = 0; i < S; i++) {
    let sum = 0;
    for (let j = 0; j < S - i; j++) sum += b[j] * b[j + i];
    c[i] = sum;
  }
  let d = 0;
  while (d < S - 1 && c[d] > c[d + 1]) d++;      // 最初の谷まで飛ばす
  let maxVal = -1, maxPos = -1;
  for (let i = d; i < S; i++) if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
  if (maxPos <= 0 || maxPos >= S - 1) return -1;
  if (c[0] > 0 && maxVal / c[0] < 0.25) return -1;   // 相関が弱ければ不採用

  /* 放物線補間でピークを精密化 */
  const x1 = c[maxPos - 1], x2 = c[maxPos], x3 = c[maxPos + 1];
  const a = (x1 + x3 - 2 * x2) / 2, bb = (x3 - x1) / 2;
  const T0 = a ? maxPos - bb / (2 * a) : maxPos;
  const hz = sampleRate / T0;
  return (hz > 60 && hz < 3000) ? hz : -1;
}

/* 周波数をいちばん近いカリンバのキーに。音域外はオクターブを折り返す */
function nearestStep(hz) {
  let midi = 69 + 12 * Math.log2(hz / 440);
  const lo = midiOf(minStep()), hi = midiOf(maxStep());
  while (midi < lo - 0.5) midi += 12;
  while (midi > hi + 0.5) midi -= 12;
  let best = -1, bestErr = Infinity;
  for (let s = minStep(); s <= maxStep(); s++) {
    const e = Math.abs(midiOf(s) - midi);
    if (e < bestErr) { bestErr = e; best = s; }
  }
  return bestErr <= 0.8 ? best : -1;
}

function micMsg(text, isError) {
  const bar = document.getElementById('micbar');
  bar.hidden = false;
  bar.classList.toggle('err', !!isError);
  document.getElementById('micState').textContent = text;
  document.getElementById('micStop').textContent = isError ? '閉じる' : '■ 停止';
}
function micLevel(rms) {
  const pct = Math.min(100, Math.round(Math.sqrt(rms) * 320));
  document.getElementById('micLevel').style.width = pct + '%';
}

async function micStart() {
  if (mic.on) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    micMsg('このブラウザ／開き方ではマイクを使えません。README の「マイクが使えないとき」をご覧ください。', true);
    return;
  }
  stop();                       // 再生とは同時に使わない
  micMsg('マイクの使用を許可してください…', false);
  try {
    mic.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    });
  } catch (err) {
    micMsg('マイクを使えませんでした（' + err.name + '）。ブラウザのマイク許可を確認してください。', true);
    return;
  }
  const c = ac();
  mic.src = c.createMediaStreamSource(mic.stream);
  attachMicSource(mic.src);
  pushUndo();                   // 録音した分をまとめて Ctrl+Z で戻せるように
  micMsg('録音中 — カリンバを弾いてください', false);
  document.getElementById('btnMic').classList.add('on');
  micLoop();
}

/* 入力ノードを差し替えられるようにしておく（テスト用にも使う） */
function attachMicSource(node) {
  const c = ac();
  mic.an = c.createAnalyser();
  mic.an.fftSize = 1024;
  mic.an.smoothingTimeConstant = 0;
  node.connect(mic.an);
  mic.buf = new Float32Array(mic.an.fftSize);
  mic.on = true;
  mic.seg = null; mic.env = 0; mic.cand = -1; mic.candN = 0; mic.restFrom = 0;
  mic.lastVoice = performance.now();
}

function micStop() {
  const bar = document.getElementById('micbar');
  if (!mic.on) { bar.hidden = true; bar.classList.remove('err'); return; }
  mic.on = false;
  cancelAnimationFrame(mic.raf);
  if (mic.seg) emitSeg(mic.seg.lastVoice);
  if (mic.stream) { try { mic.stream.getTracks().forEach(t => t.stop()); } catch (e) {} }
  if (mic.src) { try { mic.src.disconnect(); } catch (e) {} }
  mic.stream = null; mic.src = null; mic.an = null;
  bar.hidden = true; bar.classList.remove('err');
  document.getElementById('btnMic').classList.remove('on');
}

function micFrame() {
  const an = mic.an, buf = mic.buf;
  an.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / buf.length);
  const now = performance.now();
  micLevel(rms);

  const voiced = rms > micGate;
  const attack = voiced && rms > mic.env * 2.2;      // 同じ音を弾き直したとき用
  mic.env = Math.max(rms, mic.env * 0.86);

  let step = -1, hz = -1;
  if (voiced) {
    hz = autoCorrelate(buf, ac().sampleRate);
    if (hz > 0) step = nearestStep(hz);
  }

  /* 同じ音が 2 フレーム続いたら確定（一瞬のノイズを弾く） */
  if (step >= 0) {
    if (mic.cand === step) mic.candN++;
    else { mic.cand = step; mic.candN = 1; }
  } else if (!voiced) {
    mic.cand = -1; mic.candN = 0;
  }
  const fixed = mic.candN >= 2 ? mic.cand : -1;

  document.getElementById('micPitch').textContent = fixed >= 0
    ? solfegeOf(fixed) + '　' + numberOf(fixed) + '　' + letterOf(fixed) +
      '　' + Math.round(hz) + 'Hz'
    : '—';

  if (voiced) {
    mic.lastVoice = now;
    if (mic.seg) mic.seg.lastVoice = now;
    if (fixed >= 0) {
      if (!mic.seg) openSeg(fixed, now);
      else if (mic.seg.step !== fixed) openSeg(fixed, now);
      else if (attack && now - mic.seg.t0 > 100) openSeg(fixed, now);
    }
  } else if (mic.seg && now - mic.lastVoice > 120) {
    emitSeg(mic.seg.lastVoice);       // 鳴り終わったところまでを音符の長さにする
    mic.restFrom = mic.lastVoice;     // ここから先は休符として数える
  }
}

function micLoop() {
  if (!mic.on) return;
  mic.raf = requestAnimationFrame(micLoop);
  micFrame();
}

function openSeg(step, t) {
  const spq = 60000 / state.tempo;
  if (mic.seg) {
    emitSeg(t);                                   // 前の音は「次の音まで」が長さ
  } else if (mic.restFrom && t - mic.restFrom >= spq * 0.4) {
    addRecorded(step, quantizeToDur((t - mic.restFrom) / spq), true);   // 間が空いた分は休符
  }
  mic.restFrom = 0;
  mic.seg = { step: step, t0: t, lastVoice: t };
}

/* 1 音ぶんを楽譜に書き出す。endT は次の音の始まり（または鳴り終わり） */
function emitSeg(endT) {
  const s = mic.seg;
  mic.seg = null;
  if (!s) return;
  const spq = 60000 / state.tempo;                // 4分音符のミリ秒
  const span = Math.max(60, endT - s.t0);
  addRecorded(s.step, quantizeToDur(span / spq), false);
}

function addRecorded(step, q, isRest) {
  const note = { p: [step], d: q.c, dot: q.dot, rest: !!isRest, tie: false };
  const n = cur();
  if (n && n.fresh) state.notes[cursor] = note;
  else { state.notes.splice(cursor + 1, 0, note); cursor++; }
  refresh();
}

/* ============================================================
   15. 曲ライブラリ と URL 共有
   ------------------------------------------------------------
   スマホではファイルの出し入れがしづらいので、
   ・曲はブラウザの中に名前を付けて何曲でも保存できるようにする
   ・端末をまたぐときは、曲の中身を URL に埋め込んで共有する
   ============================================================ */
const LIB_KEY = 'kalimba-library-v1';

function libLoad() {
  try { return JSON.parse(localStorage.getItem(LIB_KEY)) || {}; } catch (e) { return {}; }
}
function libStore(obj) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(obj));
    return true;
  } catch (e) {
    alert('保存できませんでした。ブラウザの保存容量がいっぱいかもしれません。');
    return false;
  }
}

/* ---------- URL 用の短い書き方 ----------
   1音 = [長さ1文字][休符/タイ+音数 1文字][音の高さ ×音数]
   というふうに 1 文字ずつに詰めて、JSON より短い URL にする */
const A64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const PITCH_OFFSET = 8;                     // 下のオクターブ(マイナス)も入るように下駄をはかせる
const c64 = v => A64[Math.max(0, Math.min(63, v | 0))];
const v64 = ch => A64.indexOf(ch);

function encodeScore() {
  const body = state.notes.map(n => {
    const di = Math.max(0, durIndex(n));
    const ps = n.rest ? [] : n.p.slice().sort((a, b) => a - b).slice(0, 4);
    const flags = (n.rest ? 1 : 0) + (n.tie ? 2 : 0);
    return c64(di) + c64(flags * 8 + ps.length) +
           ps.map(p => c64(p + PITCH_OFFSET)).join('');
  }).join('');
  const show = (state.showSol ? 1 : 0) + (state.showNum ? 2 : 0) + (state.showLet ? 4 : 0);
  return ['1', encodeURIComponent(state.title), state.tempo, state.beats, state.beatValue,
          state.preset, state.perLine, show, state.inputMode, body].join(',');
}

function decodeScore(str) {
  const f = String(str).split(',');
  if (f[0] !== '1' || f.length < 10) throw new Error('形式が違います');
  const notes = [];
  const body = f[9] || '';
  let i = 0;
  while (i < body.length) {
    const di = v64(body[i++]);
    const h = v64(body[i++]);
    if (di < 0 || h < 0) throw new Error('形式が違います');
    const count = h % 8, flags = Math.floor(h / 8);
    const p = [];
    for (let k = 0; k < count; k++) p.push(v64(body[i++]) - PITCH_OFFSET);
    const d = DURS[di] || DURS[5];
    notes.push({ p: p.length ? p : [0], d: d.c, dot: d.dot,
                 rest: !!(flags & 1), tie: !!(flags & 2) });
  }
  const show = +f[7] || 0;
  return JSON.stringify({
    v: 1, title: decodeURIComponent(f[1] || '無題の曲'), tempo: +f[2] || 90,
    beats: +f[3] || 4, beatValue: +f[4] || 4, preset: f[5] || '17', perLine: +f[6] || 4,
    showSol: !!(show & 1), showNum: !!(show & 2), showLet: !!(show & 4),
    inputMode: f[8] || 'edit', notes: notes
  });
}

function shareUrl() {
  return location.origin + scorePath() + '#s=' + encodeScore();
}

/* ============================================================
   18b. かんたんアカウント（クラウド保存）
   ------------------------------------------------------------
   別の端末からも同じ曲を開けるようにするための、ごく小さな仕組み。
   /api/... は Cloudflare Workers 側（src/index.js）が受け持つ。

   パスワードそのものは送らない。この端末の中で時間のかかる計算
   （PBKDF2 を 15 万回）をして、その結果だけを送っている。
   サーバー側は無料枠で 1 リクエスト CPU 10ms までなので、
   重い計算をあちらに置けないため。
   ============================================================ */
const AUTH_KEY = 'kalimba-auth-v1';
const PBKDF2_ROUNDS = 150000;
let auth = null;          // {token, id}。ログインしていなければ null
let cloudSongs = [];      // クラウドにある曲の一覧

function authLoad() {
  try { auth = JSON.parse(localStorage.getItem(AUTH_KEY)) || null; } catch (e) { auth = null; }
  if (auth && !(auth.token && auth.id)) auth = null;
}
function authStore(v) {
  auth = v;
  try {
    if (v) localStorage.setItem(AUTH_KEY, JSON.stringify(v));
    else localStorage.removeItem(AUTH_KEY);
  } catch (e) { /* 保存できなくても、この画面を閉じるまでは使える */ }
}

/* 塩にログインIDを混ぜているので、同じパスワードでも人ごとに別の値になる */
async function derivePw(id, pw) {
  const e = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', e.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: e.encode('kalimba-score:' + id),
      iterations: PBKDF2_ROUNDS, hash: 'SHA-256' }, key, 256);
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function apiCall(path, opts) {
  const o = Object.assign({}, opts || {});
  o.headers = Object.assign({}, o.headers);
  if (auth) o.headers.authorization = 'Bearer ' + auth.token;
  if (o.body !== undefined && typeof o.body !== 'string') {
    o.headers['content-type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }
  let res;
  try { res = await fetch(path, o); }
  catch (e) { throw new Error('つながりませんでした。通信の状態を確かめてください。'); }
  let body = {};
  try { body = await res.json(); } catch (e) { /* 本文がないこともある */ }
  if (!res.ok) {
    /* 期限切れなどでログイン状態が切れていたら、こちらも忘れる */
    if (res.status === 401 && auth) { authStore(null); renderAccount(); }
    const err = new Error(body.error || ('うまくいきませんでした（' + res.status + '）'));
    err.status = res.status;
    throw err;
  }
  return body;
}

/* ---------- 画面 ---------- */
function acctMsg(text, kind) {
  const p = document.getElementById('acctMsg');
  if (!p) return;
  p.textContent = text || '';
  p.className = 'msg' + (kind ? ' ' + kind : '');
  p.hidden = !text;
}
function acctBusy(on) {
  ['acctLogin', 'acctRegister', 'acctLogout', 'cloudSave', 'cloudReload',
   'acctDelete'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.disabled = on;
  });
}
function renderAccount() {
  const out = document.getElementById('acctOut');
  const inn = document.getElementById('acctIn');
  const who = document.getElementById('acctWho');
  if (!out || !inn) return;
  const on = !!auth;
  out.hidden = on;
  inn.hidden = !on;
  who.textContent = on ? auth.id + ' でログイン中' : '';
  if (on) renderCloudList();
}

/* 日付は「9/27」くらいの粗さで十分 */
function shortDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

function renderCloudList() {
  const host = document.getElementById('cloudList');
  if (!host) return;
  host.innerHTML = '';
  if (!cloudSongs.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'クラウドにはまだ曲がありません。上の欄に名前を入れて「この名前でクラウドに保存」。';
    host.appendChild(e);
    return;
  }
  cloudSongs.forEach(song => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span class="nm"></span><span class="sub"></span>';
    row.querySelector('.nm').textContent = song.name;
    row.querySelector('.sub').textContent = song.notes + '音・' + shortDate(song.updated);
    const open = document.createElement('button');
    open.textContent = '開く';
    open.addEventListener('click', () => cloudOpen(song.name));
    const del = document.createElement('button');
    del.textContent = '削除';
    del.addEventListener('click', () => cloudDelete(song.name));
    row.appendChild(open);
    row.appendChild(del);
    host.appendChild(row);
  });
}

/* ---------- 操作 ---------- */
async function acctSubmit(kind) {
  const id = document.getElementById('acctId').value.trim();
  const pw = document.getElementById('acctPw').value;
  const codeRow = document.getElementById('acctCodeRow');
  const code = document.getElementById('acctCode').value.trim();

  if (!id || !pw) { acctMsg('ログインIDとパスワードを入れてください。', 'err'); return; }

  acctBusy(true);
  acctMsg(kind === 'register' ? '登録しています…' : 'ログインしています…');
  try {
    const body = { id: id, pw: await derivePw(id, pw) };
    if (kind === 'register' && code) body.code = code;
    const r = await apiCall('/api/' + kind, { method: 'POST', body: body });
    authStore({ token: r.token, id: r.id });
    document.getElementById('acctPw').value = '';
    document.getElementById('acctCode').value = '';
    codeRow.hidden = true;
    renderAccount();
    await cloudReload();
    acctMsg(r.id + ' でログインしました。', 'ok');
  } catch (e) {
    /* ふだんは誰でも登録できるが、合言葉制にしてあるときだけ欄を出す */
    if (e.status === 403) codeRow.hidden = false;
    acctMsg(e.message, 'err');
  } finally {
    acctBusy(false);
  }
}

async function acctLogout() {
  try { await apiCall('/api/logout', { method: 'POST' }); } catch (e) { /* 手元だけでも切る */ }
  authStore(null);
  cloudSongs = [];
  renderAccount();
  acctMsg('ログアウトしました。', 'ok');
}

/* 退会。押し間違いで消えないように、ログインIDを打ってもらう */
async function acctDelete() {
  if (!auth) return;
  const typed = prompt('アカウントと、クラウドに入れた曲をすべて消します。元に戻せません。\n\n' +
                       '消してよければ、ログインID「' + auth.id + '」を入力してください。');
  if (typed === null) return;
  if (typed.trim() !== auth.id) {
    acctMsg('ログインIDが一致しませんでした。削除はしていません。', 'err');
    return;
  }
  acctBusy(true);
  acctMsg('削除しています…');
  try {
    const r = await apiCall('/api/account', { method: 'DELETE' });
    authStore(null);
    cloudSongs = [];
    renderAccount();
    acctMsg('アカウントを削除しました（曲 ' + (r.deleted || 0) + ' 件）。', 'ok');
  } catch (e) { acctMsg(e.message, 'err'); }
  finally { acctBusy(false); }
}

async function cloudReload() {
  if (!auth) return;
  try {
    const r = await apiCall('/api/songs');
    cloudSongs = r.songs || [];
  } catch (e) { cloudSongs = []; acctMsg(e.message, 'err'); }
  renderCloudList();
}

async function cloudSave() {
  if (!auth) return;
  const name = document.getElementById('songName').value.trim() || state.title || '無題の曲';
  if (cloudSongs.some(x => x.name === name) &&
      !confirm('クラウドの「' + name + '」を上書きしますか？')) return;
  acctBusy(true);
  acctMsg('保存しています…');
  try {
    await apiCall('/api/songs', { method: 'PUT', body: { name: name, data: serialize() } });
    state.title = name;
    document.getElementById('title').value = name;
    autosave();
    syncPanel();
    await cloudReload();
    acctMsg('クラウドに「' + name + '」を保存しました。', 'ok');
  } catch (e) { acctMsg(e.message, 'err'); }
  finally { acctBusy(false); }
}

async function cloudOpen(name) {
  acctBusy(true);
  acctMsg('読み込んでいます…');
  try {
    const r = await apiCall('/api/songs?name=' + encodeURIComponent(name));
    pushUndo();
    deserialize(r.data);
    syncInputs();
    buildTines();
    refresh();
    acctMsg(null);
    closeSongs();
  } catch (e) { acctMsg('開けませんでした: ' + e.message, 'err'); }
  finally { acctBusy(false); }
}

async function cloudDelete(name) {
  if (!confirm('クラウドの「' + name + '」を削除しますか？')) return;
  acctBusy(true);
  try {
    await apiCall('/api/songs?name=' + encodeURIComponent(name), { method: 'DELETE' });
    await cloudReload();
    acctMsg('クラウドの「' + name + '」を削除しました。', 'ok');
  } catch (e) { acctMsg(e.message, 'err'); }
  finally { acctBusy(false); }
}

/* ---------- 曲パネル ---------- */
function openSongs() {
  document.getElementById('songUrl').hidden = true;
  document.getElementById('songName').value = state.title;
  renderSongList();
  acctMsg(null);
  renderAccount();
  document.getElementById('songs').hidden = false;
  if (auth) cloudReload();      // 開くたびに最新の一覧をとり直す
}
function closeSongs() { document.getElementById('songs').hidden = true; }

function renderSongList() {
  const host = document.getElementById('songList');
  const lib = libLoad();
  const names = Object.keys(lib).sort((a, b) => a.localeCompare(b, 'ja'));
  host.innerHTML = '';
  if (!names.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'まだ保存した曲はありません。上の欄に名前を入れて「この名前で保存」。';
    host.appendChild(e);
    return;
  }
  names.forEach(name => {
    let count = '';
    try { count = JSON.parse(lib[name]).notes.length + '音'; } catch (e) {}
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = '<span class="nm"></span><span class="sub"></span>';
    row.querySelector('.nm').textContent = name;
    row.querySelector('.sub').textContent = count;
    const open = document.createElement('button');
    open.textContent = '開く';
    open.addEventListener('click', () => { loadSong(name); });
    const del = document.createElement('button');
    del.textContent = '削除';
    del.addEventListener('click', () => {
      if (!confirm('「' + name + '」を削除しますか？')) return;
      const l = libLoad();
      delete l[name];
      libStore(l);
      renderSongList();
    });
    row.appendChild(open);
    row.appendChild(del);
    host.appendChild(row);
  });
}

function saveSong() {
  const name = document.getElementById('songName').value.trim() || state.title || '無題の曲';
  const lib = libLoad();
  if (lib[name] && !confirm('「' + name + '」はすでにあります。上書きしますか？')) return;
  state.title = name;
  document.getElementById('title').value = name;
  lib[name] = serialize();
  if (!libStore(lib)) return;
  autosave();
  syncPanel();
  renderSongList();
  songMsg('「' + name + '」を保存しました。');
}

function loadSong(name) {
  const lib = libLoad();
  if (!lib[name]) return;
  try {
    pushUndo();
    deserialize(lib[name]);
    syncInputs();
    buildTines();
    refresh();
    closeSongs();
  } catch (err) { alert('開けませんでした: ' + err.message); }
}

let songMsgTimer = 0;
function songMsg(text) {
  const el = document.getElementById('songNote');
  if (!el) return;
  el.dataset.orig = el.dataset.orig || el.innerHTML;
  el.innerHTML = '<b>' + text + '</b>';
  clearTimeout(songMsgTimer);
  songMsgTimer = setTimeout(() => { el.innerHTML = el.dataset.orig; }, 4000);
}

async function copyShareUrl() {
  const url = shareUrl();
  const box = document.getElementById('songUrl');   // 目でも確認・長押しコピーできるように出す
  box.hidden = false;
  box.value = url;
  box.focus();
  box.setSelectionRange(0, url.length);
  try {
    await navigator.clipboard.writeText(url);
    songMsg('リンクをコピーしました（' + url.length + '文字）。メールやLINEで送れば、そのまま開けます。');
  } catch (e) {
    /* 権限がないブラウザ向けの保険 */
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e2) {}
    ta.remove();
    songMsg(ok ? 'リンクをコピーしました。'
               : '自動コピーできませんでした。上の欄のURLを選んでコピーしてください。');
  }
}

/* ページを開いたとき、URL に曲が入っていれば読み込む。
   同じリンクを 2 回目以降に開いたときは、そのあとの自分の編集のほうを優先する
   （URL を書き換える方法はブラウザによって効かないことがあるので、こちらで覚えておく） */
const HASH_KEY = 'kalimba-last-hash';
function loadFromHash() {
  const h = location.hash || '';
  if (h.indexOf('#s=') !== 0) return false;
  try {
    if (localStorage.getItem(HASH_KEY) === h && localStorage.getItem(STORE_KEY)) return false;
  } catch (e) {}
  try {
    const json = decodeScore(decodeURIComponent(h.slice(3)));
    /* いま編集中の内容を失わないよう、控えをライブラリに残す */
    const prev = localStorage.getItem(STORE_KEY);
    if (prev) {
      try {
        const o = JSON.parse(prev);
        if (o.notes && o.notes.length > 1) {
          const lib = libLoad();
          lib['（リンクを開く前の編集）'] = prev;
          libStore(lib);
        }
      } catch (e) {}
    }
    deserialize(json);
    try { localStorage.setItem(HASH_KEY, h); } catch (e) {}
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- 画面の広さで「見るだけ」か「編集できる」かを決める ----------
   スマホ幅では入力パネルを CSS ごと消しているので、編集操作も受け付けない。
   音符を選ぶ（＝そこから再生する）操作だけは残す */
const NARROW = '(max-width:760px)';
let readOnly = window.matchMedia(NARROW).matches;
function syncMode() {
  const ro = window.matchMedia(NARROW).matches;
  if (ro === readOnly) return false;
  readOnly = ro;
  if (readOnly) { setMetro(false); if (mic.on) micStop(); }
  return true;
}

/* ============================================================
   17. 使い方チュートリアル
   ------------------------------------------------------------
   はじめて開いた人向けに、一通りを順番に説明する。
   あとからでも「❓ 使い方」でいつでも開ける。
   ============================================================ */
/* 覚えておくのは「読んだかどうか」ではなく「どの版を読んだか」 */
const TUT_KEY = 'kalimba-tutorial-seen';

const TUT = [
  {
    title: 'はじめに ― このページについて',
    html:
      '<p><b>カリンバ（親指ピアノ）で弾くための楽譜</b>を作って、印刷したりスマホで見たりできるページです。' +
      '五線譜が読めなくても弾けるように、音符の下に<b>ドレミ</b>と<b>カリンバの数字</b>を並べて書き出します。</p>' +
      '<div class="tip"><b>音楽の知識がない人間が、自分と初心者のために作ったもの</b>です。' +
      '市販の楽譜ソフトのようなことはできません。弾きたい曲のドレミを書き出して、' +
      '印刷したりスマホで見たりする、くらいの道具だと思ってください。</div>' +
      '<p><b>できないこと</b></p>' +
      '<ul>' +
      '<li><b>半音（♯ ♭）は使えません。</b>カリンバに半音のキーがないためで、ハ長調（白鍵）の音だけです</li>' +
      '<li>調号・転調・3連符・声部の分かれた譜・歌詞・強弱記号・繰り返し記号などはありません</li>' +
      '<li>テンポと拍子は曲の途中で変えられません</li>' +
      '<li>和音は「同時に鳴らす音」として扱うだけで、パート分けはできません</li>' +
      '</ul>' +
      '<div class="tip"><b>スマホはほぼ閲覧専用です。</b>' +
      '画面が狭い端末では音符の書き換えができません。' +
      '<b>作るのはパソコン、見るのはスマホ</b>（できた曲はリンクにして送れます）という想定です。</div>' +
      '<p style="margin:0"><a href="about.html">作った経緯やデータの扱いについて（このサイトについて）</a></p>'
  },
  {
    title: '楽譜の読み方（3つの表記）',
    html:
      '<p>カリンバ用の楽譜を作って、印刷したり、スマホで見たりできるページです。' +
      '五線譜が読めなくても大丈夫なように、音符の下に <b>3 つの読み方</b>を並べて表示します。</p>' +
      '<div class="fig">' +
      '<svg width="300" height="132" viewBox="0 0 300 132" aria-hidden="true">' +
      '<g stroke="#1c2024" stroke-width="1">' +
      '<line x1="20" y1="14" x2="280" y2="14"/><line x1="20" y1="24" x2="280" y2="24"/>' +
      '<line x1="20" y1="34" x2="280" y2="34"/><line x1="20" y1="44" x2="280" y2="44"/>' +
      '<line x1="20" y1="54" x2="280" y2="54"/></g>' +
      '<ellipse cx="96" cy="54" rx="6" ry="4.4" transform="rotate(-20 96 54)" fill="#1c2024"/>' +
      '<path d="M101.6 53.4 V22" stroke="#1c2024" stroke-width="1.6"/>' +
      '<ellipse cx="186" cy="39" rx="6" ry="4.4" transform="rotate(-20 186 39)" fill="#1c2024"/>' +
      '<path d="M191.6 38.4 V7" stroke="#1c2024" stroke-width="1.6"/>' +
      '<g font-family="sans-serif" text-anchor="middle">' +
      '<text x="96" y="78" font-size="13">ド</text>' +
      '<text x="96" y="98" font-size="13" font-weight="600">1</text>' +
      '<text x="96" y="116" font-size="11" fill="#8a919b">C</text>' +
      '<text x="186" y="78" font-size="13">ソ</text>' +
      '<text x="186" y="98" font-size="13" font-weight="600">5</text>' +
      '<text x="186" y="116" font-size="11" fill="#8a919b">G</text>' +
      '<text x="252" y="78" font-size="10.5" fill="#6b7280" text-anchor="start">← ドレミ</text>' +
      '<text x="252" y="98" font-size="10.5" fill="#6b7280" text-anchor="start">← 数字譜</text>' +
      '<text x="252" y="116" font-size="10.5" fill="#6b7280" text-anchor="start">← 音名</text>' +
      '</g></svg></div>' +
      '<p><b>数字譜</b>はカリンバのキーに書いてある番号です。' +
      '高いオクターブは <kbd>1*</kbd> <kbd>1**</kbd> のように <code>*</code> が付きます。</p>' +
      '<div class="tip">作った曲は<b>お使いの端末の中だけ</b>に保存されます。どこかに送られることはありません。</div>'
  },
  {
    title: '五線譜と数字譜を切り替える',
    html:
      '<p>上の<b>「表示」</b>で、<b>五線譜</b>と<b>数字譜</b>を切り替えられます。' +
      '数字譜にすると五線が消えて、<b>カリンバの数字だけが並んだかんたんな楽譜</b>になります。' +
      '五線譜が苦手なときや、スマホの狭い画面で見るときに向いています。</p>' +
      '<div class="fig">' +
      '<svg width="300" height="78" viewBox="0 0 300 78" aria-hidden="true">' +
      '<g fill="#1c2024">' +
      '<rect x="17" y="12" width="1" height="42"/>' +
      '<rect x="151" y="12" width="1" height="42"/>' +
      '<rect x="281" y="12" width="3" height="42"/></g>' +
      '<g font-family="sans-serif" text-anchor="middle" fill="#1c2024" font-size="17" font-weight="600">' +
      '<text x="40" y="38">5</text><text x="72" y="38">5</text>' +
      '<text x="106" y="38">6</text><text x="136" y="38">5</text>' +
      '<text x="178" y="38">1*</text><text x="214" y="38">7</text>' +
      '<text x="250" y="38" font-weight="400">−</text></g>' +
      '<rect x="32" y="43" width="48" height="1.2" fill="#1c2024"/>' +
      '<g font-family="sans-serif" text-anchor="middle" font-size="11" fill="#6b7280">' +
      '<text x="40" y="68">ソ</text><text x="72" y="68">ソ</text>' +
      '<text x="106" y="68">ラ</text><text x="136" y="68">ソ</text>' +
      '<text x="178" y="68">ド</text><text x="214" y="68">シ</text></g>' +
      '</svg>' +
      '<p class="cap">数字譜の表示。音の長さは、数字の下の線（短い音）と − （のばす）で表します</p>' +
      '</div>' +
      '<p><b>記号の読み方</b></p>' +
      '<ul>' +
      '<li><b>数字</b> … 弾くキー。<kbd>1*</kbd> は1オクターブ上、<kbd>1**</kbd> は2オクターブ上です</li>' +
      '<li><b>0</b> … 休み</li>' +
      '<li><b>−</b> … 前の音を1拍ぶんのばします。2分音符なら <kbd>1 −</kbd>、全音符なら <kbd>1 − − −</kbd></li>' +
      '<li><b>数字の下の線</b> … 1本で半分の長さ（8分音符）、2本で4分の1（16分音符）。' +
      '五線譜で音符がつながるところは、この線もつながります</li>' +
      '<li><b>・</b> … 付点。その音を半分だけ長くします</li>' +
      '</ul>' +
      '<p><b>和音</b>は数字を縦に積みます。五線譜の玉と同じように、' +
      '<b>数字をクリックすればその音だけ</b>選んで直せます。</p>' +
      '<div class="tip"><b>ドレミ</b>・<b>CDE</b> のチェックはそのまま効きます。' +
      '印刷や PNG も、切り替えた表示のまま書き出されます。' +
      '記号の読み方は楽譜のいちばん下にも入るので、印刷したものを人に渡しても伝わります。</div>'
  },
  {
    title: '① 音符を入れる',
    html:
      '<p>画面のいちばん下に<b>カリンバの鍵盤</b>が並んでいます。実物と同じ並び（真ん中が低い音）です。' +
      'ここを<b>クリック</b>するか、<kbd>1</kbd>〜<kbd>7</kbd> のキーで音を入れます。' +
      '<kbd>0</kbd>（鍵盤のいちばん左）は休符です。</p>' +
      '<p>キーを押したときの動きは、上の<b>「数字キー・鍵盤」</b>で 3 つから選べます（<kbd>M</kbd> でも切り替え）。</p>' +
      '<ul>' +
      '<li><b>音程を変更</b> … 今えらんでいる音符の高さを変える（直すとき用）</li>' +
      '<li><b>音符を追加</b> … 押すたびに音符が増える。<kbd>1234567</kbd> と打てばドレミファソラシ</li>' +
      '<li><b>リズム入力</b> … 追加に加えて、<b>押した間隔で音符の長さ</b>も決まります</li>' +
      '</ul>'
  },
  {
    title: '② 高さと長さを直す',
    html:
      '<p>音符をクリックして選び、キーで直します。</p>' +
      '<ul>' +
      '<li><kbd>↑</kbd> <kbd>↓</kbd> … 高さを 1 つ上下（<kbd>Shift</kbd>+ で 1 オクターブ）</li>' +
      '<li><kbd>←</kbd> <kbd>→</kbd> … 長さを短く / 長く。<b>音符の上でマウスホイール</b>でも変わります</li>' +
      '<li><kbd>Tab</kbd> … 次の音符へ（いちばん最後なら音符を 1 つ足します）</li>' +
      '<li><kbd>.</kbd> 付点　<kbd>T</kbd> タイ　<kbd>Delete</kbd> 削除　<kbd>Ctrl</kbd>+<kbd>Z</kbd> 元に戻す</li>' +
      '</ul>' +
      '<p><b>和音</b>は <kbd>C</kbd> で 1 音足せます。' +
      '和音の中の 1 音だけ直したいときは、<b>その音符の玉をクリック</b>してください。' +
      '青い丸が付き、<kbd>↑</kbd><kbd>↓</kbd> でその音だけ動き、<kbd>Delete</kbd> でその音だけ外せます。</p>'
  },
  {
    title: '③ まとめて直す',
    html:
      '<p>同じフレーズを繰り返すときに便利です。</p>' +
      '<ul>' +
      '<li><b>楽譜の上をドラッグ</b>、または <kbd>Shift</kbd>+音符クリックで<b>範囲を選択</b></li>' +
      '<li>選んだ状態で <kbd>↑</kbd> <kbd>↓</kbd> … <b>まとめて移調</b>（全部の音を同じだけ上下）</li>' +
      '<li><kbd>←</kbd> <kbd>→</kbd> … 選んだ音符すべての長さを変更</li>' +
      '<li><kbd>Ctrl</kbd>+<kbd>C</kbd> コピー　<kbd>Ctrl</kbd>+<kbd>V</kbd> 貼り付け　<kbd>Ctrl</kbd>+<kbd>A</kbd> 全選択</li>' +
      '</ul>' +
      '<div class="tip">1 小節コピーして貼り付け、そのまま <kbd>↑</kbd> を押せば「4 度上で繰り返し」がすぐ作れます。</div>'
  },
  {
    title: '④ 聞く・練習する',
    html:
      '<ul>' +
      '<li><b>▶ 最初から</b> … 曲の頭から鳴らします（<kbd>Shift</kbd>+<kbd>Space</kbd>）</li>' +
      '<li><b>▶ ここから</b> … えらんだ音符から鳴らします（<kbd>Space</kbd>）</li>' +
      '<li><b>🔔 拍</b> … メトロノーム。テンポに合わせてクリック音が鳴ります</li>' +
      '<li><b>🎵 練習</b> … ノーツが降ってくる練習モードです（次のページでくわしく）</li>' +
      '<li><b>🔇 無音</b> … <b>音を出さずに譜面の進行だけ</b>動きます。' +
      '自分でカリンバを弾きながら、今どこを弾いているか目で追うためのモードです</li>' +
      '</ul>' +
      '<p>再生中は、鳴り終わったところまで<b>背景が水色に塗られて</b>いきます。' +
      '段が変わると、その段が画面の上に来るように自動でスクロールします。</p>' +
      '<p>🎤 <b>マイク</b>を押すと、弾いた音を拾って楽譜にすることもできます（単音のみ・下書き用）。</p>'
  },
  {
    title: '⑤ 練習モード（ノーツが降ってくる）',
    html:
      '<p><b>🎵 練習</b>を押すと、画面いっぱいに<b>カリンバの絵</b>が出て、' +
      '楽譜どおりのノーツが上から降ってきます。' +
      '<b>黄色い線に届いた瞬間</b>が、そのキーを弾くタイミングです。</p>' +
      '<div class="fig">' +
      '<img src="practice-demo.gif" width="380" height="207" alt="ノーツが降ってきて、カリンバのキーに届く様子">' +
      '<p class="cap">実際の画面です。キーの並びは実物のカリンバと同じ（真ん中が低い音）で、' +
      'ノーツに書いてある数字が、弾くキーの番号です</p>' +
      '</div>' +
      '<ul>' +
      '<li><b>▶ 開始 / ⏸ 一時停止 / ▶ 再開</b> … <kbd>Space</kbd> でも切り替えられます。' +
      '止めた場所から続けられます</li>' +
      '<li><b>■</b> … 曲の先頭に戻します</li>' +
      '<li><b>画面を上下にドラッグ</b> … 聞きたい場所へ移動できます。' +
      'ノーツをつかんで下へ引くと先に進みます。鳴らしている途中でもつかめます</li>' +
      '<li><b>速さ</b> … ノーツの落ちる速さ。遅くすると、先の音符まで見えます</li>' +
      '<li><b>🔇</b> … 音を出しません。<b>自分でカリンバを弾きながら使うとき</b>用です</li>' +
      '</ul>' +
      '<p>ノーツの<b>色はオクターブ</b>（青＝基準、緑＝1つ上、紫＝2つ上）。</p>' +
      '<div class="tip"><b>当たり判定や点数はありません</b>。「いつ・どのキーを弾くか」の目安です。</div>'
  },
  {
    title: '⑥ 保存して持ち出す',
    html:
      '<p><b>📁 曲・保存</b>を押すと、保存のパネルが開きます。</p>' +
      '<ul>' +
      '<li><b>この名前で保存</b> … ブラウザの中に何曲でも保存できます。一覧から開いたり消したり</li>' +
      '<li><b>🔗 リンクをコピー</b> … 曲の中身が入った URL が作られます。' +
      '<b>これをスマホに送れば、同じ楽譜がそのまま開きます</b></li>' +
      '<li><b>PNG</b> … 画像として保存　<b>印刷</b> … 紙や PDF へ（操作パネルは印刷されません）</li>' +
      '</ul>' +
      '<p><b>スマホで開いたとき</b>は、画面が狭いので<b>見るための表示</b>になります。' +
      '下の入力パネルは消え、上は <kbd>☰</kbd> と再生ボタンだけ。' +
      '<kbd>☰</kbd> を押すとテンポや表示の設定が開きます。</p>' +
      '<div class="tip">この説明は、右上の <b>❓ 使い方</b> からいつでも読み直せます。</div>'
  }
];

let tutStep = 0;

function openTutorial(step) {
  const box = document.getElementById('tutorial');
  if (!box) return;
  tutStep = step || 0;
  box.hidden = false;
  renderTutorial();
}
function closeTutorial() {
  document.getElementById('tutorial').hidden = true;
  try { localStorage.setItem(TUT_KEY, APP_VERSION); } catch (e) {}
}
function renderTutorial() {
  const t = TUT[tutStep];
  document.getElementById('tutTitle').textContent = t.title;
  /* スマホは見る専用なので、最初にそれを伝えておく */
  const note = (readOnly && tutStep === 0)
    ? '<p style="margin:0;font-size:12.5px;color:#31415c">' +
      '↑ いま開いているこの画面が、その<b>見るための表示</b>です。</p>'
    : '';
  document.getElementById('tutBody').innerHTML = t.html + note;
  const dots = document.getElementById('tutDots');
  dots.innerHTML = '';
  TUT.forEach((_, i) => {
    const d = document.createElement('i');
    if (i === tutStep) d.className = 'on';
    dots.appendChild(d);
  });
  document.getElementById('tutPrev').disabled = tutStep === 0;
  document.getElementById('tutNext').textContent =
    tutStep === TUT.length - 1 ? 'はじめる' : '次へ →';
  document.getElementById('tutBody').scrollTop = 0;
}
function tutMove(d) {
  if (tutStep + d < 0) return;
  if (tutStep + d >= TUT.length) { closeTutorial(); return; }
  tutStep += d;
  renderTutorial();
}

/* ============================================================
   19. ノーツ練習画面
   ------------------------------------------------------------
   カリンバの実物と同じキーの並びでレーンを作り、楽譜どおりに
   ノーツを上から落とす。下の判定ラインに届いた瞬間がその音を
   弾くタイミング。弾くのは人間なので、当たり判定や採点はしない。
   ============================================================ */
const PANEL_KEY = 'kalimba-panel-open';

/* 下のパネル（音符の長さ・編集・鍵盤・操作の説明）をまとめて開け閉めする。
   閉じておくと、そのぶん楽譜が広く見える */
function setPanel(open) {
  const p = document.getElementById('panel');
  const body = document.getElementById('panelBody');
  const b = document.getElementById('panelToggle');
  if (!p || !body || !b) return;
  body.hidden = !open;
  p.classList.toggle('closed', !open);
  b.textContent = open ? '▼' : '▲';
  b.title = open ? '下のパネルを隠す' : '下のパネルを出す';
  b.setAttribute('aria-label', b.title);
  b.setAttribute('aria-expanded', open ? 'true' : 'false');
  try { localStorage.setItem(PANEL_KEY, open ? '1' : '0'); } catch (e) { /* 無視 */ }
}

const FALL_SPEED_KEY = 'kalimba-fall-speed';
const fall = {
  on: false, raf: 0, canvas: null, ctx: null,
  w: 0, h: 0, dpr: 1,
  notes: [],          // {t, dur, lanes:[..], steps:[..]}
  order: [],          // 画面左から右へ並べたキーの step
  speed: 4,           // 1〜10。大きいほど速く落ちる
  hit: [],            // レーンごとの「光らせる残り時間」
  pos: 0,             // いま見ている位置（曲の先頭からの秒数）
  total: 0,           // 曲全体の長さ（秒）
  paused: false,      // 一時停止して位置を保っている
  wasPlaying: false,  // 前のフレームで鳴っていたか
  drag: null          // ドラッグ中の情報
};

const FALL_KEY_H = 132;                          // 下のカリンバ本体の高さ
/* 1 秒あたり何 px 落ちるか。ドラッグの移動量を秒に直すのにも使う */
const fallPps = () => Math.max(1, fall.h - FALL_KEY_H) / fallLead();

const fallLead = () => 6 - fall.speed * 0.5;      // 何秒先まで見えるか

/* 練習画面は /practice という別の URL にしておく。
   こうしておくと、リロードしても練習画面のまま開けるし、
   ブラウザの「戻る」でも楽譜ページにもどれる。
   file:// で開いているときは履歴を書き換えられないので、そのときは何もしない */
const FALL_SEG = 'practice';

function dirPath() {                    // いま開いているページのあるフォルダ
  const p = location.pathname;
  return p.slice(0, p.lastIndexOf('/') + 1);
}
function fallPath()  { return dirPath() + FALL_SEG; }
function isFallPath(){ return location.pathname === fallPath(); }
/* 楽譜ページ側のパス（共有リンクなどはこちらを使う） */
function scorePath() { return isFallPath() ? dirPath() : location.pathname; }

function goPath(path, state, replace) {
  const url = path + location.search + location.hash;
  try {
    if (replace) history.replaceState(state || null, "", url);
    else history.pushState(state || null, "", url);
  } catch (e) { /* file:// などでは URL を変えられない */ }
}

/* 秒を 0:00 の形にする */
function mmss(sec) {
  const t = Math.max(0, Math.round(sec));
  return (t / 60 | 0) + ':' + String(t % 60).padStart(2, '0');
}

/* 画面に並べるキー（実物と同じ、中央が最低音） */
function fallLanes() {
  const p = P();
  return tineOrder(p.count).map(k => p.base + k);
}

/* 練習画面を開いたときに出す広告モーダル。
   ページを開いてから1回だけ。閉じたあとは練習の邪魔をしない。

   忍者AD MAX のタグは document.write を使うので、あとから差し込めない。
   そこで広告だけを載せた ad-frame.html を iframe で読み込んでいる。
   練習画面の HTML に直接書いてしまうと、練習画面を開かない人にも
   広告が読み込まれてしまうため。

   どのタグを使うかは、こちら（本物の画面幅が分かる側）で決めて
   ad-frame.html に渡す。iframe の幅は広告ぴったりにするので、
   あちら側で画面幅を測ると違う答えになってしまう。 */
let adModalDone = false;
function showAdModal() {
  const m = document.getElementById('adModal');
  const slot = document.getElementById('adModalSlot');
  if (!m || !slot || adModalDone) return;
  adModalDone = true;
  const sp   = /Android|iPhone|iPod|Mobile|Silk|Kindle/i.test(navigator.userAgent);
  const wide = window.matchMedia('(min-width: 820px)').matches;
  const kind = sp ? 'sp' : (wide ? 'pc' : 'narrow');
  const w = sp ? 320 : (wide ? 728 : 300);   // ad-frame.html が出すタグの大きさ
  const h = sp ? 100 : (wide ?  90 : 250);
  const f = document.createElement('iframe');
  f.src = 'ad-frame.html?s=' + kind;
  f.title = '広告';
  f.setAttribute('scrolling', 'no');
  f.style.width = w + 'px';
  f.style.height = h + 'px';
  slot.style.width = w + 'px';
  slot.style.height = h + 'px';
  slot.appendChild(f);
  m.hidden = false;
}
function closeAdModal() {
  const m = document.getElementById('adModal');
  if (m) m.hidden = true;
}
function adModalOpen() {
  const m = document.getElementById('adModal');
  return !!m && !m.hidden;
}

/* back は「ブラウザの戻る／進むで来た」ときに true。そのときは URL をいじらない */
function openFall(back) {
  const box = document.getElementById('fall');
  if (!box) return;
  if (!back) goPath(fallPath(), { fall: 1 });
  box.hidden = false;
  showAdModal();
  fall.on = true;
  fall.canvas = document.getElementById('fallCanvas');
  fall.ctx = fall.canvas.getContext('2d');
  fall.order = fallLanes();
  fall.hit = fall.order.map(() => 0);
  fall.pos = 0;
  fall.paused = false;
  fall.drag = null;
  buildFallNotes();
  document.getElementById('fallTempo').value = state.tempo;
  document.getElementById('fallSpeed').value = fall.speed;
  syncFallButtons();
  fallResize();
  fallLoop();
}

function closeFall(back) {
  closeAdModal();
  fall.on = false;
  cancelAnimationFrame(fall.raf);
  stop();
  const box = document.getElementById('fall');
  if (box) box.hidden = true;
  if (back) return;
  if (history.state && history.state.fall) history.back();   // 履歴を増やさない
  else goPath(scorePath(), null, true);
}

/* ブラウザの戻る／進むに合わせて開け閉めする */
window.addEventListener('popstate', () => {
  if (isFallPath() && !fall.on) openFall(true);
  else if (!isFallPath() && fall.on) closeFall(true);
});

/* 楽譜から「弾く音」だけを取り出す（タイで伸びている音は弾き直さない） */
function buildFallNotes() {
  const lane = {};
  fall.order.forEach((step, i) => { lane[step] = i; });
  fall.notes = buildEvents().evs
    .filter(e => !e.rest && e.p.length)
    .map(e => ({
      t: e.t,
      dur: Math.max.apply(null, e.durs.concat([e.dur])),
      steps: e.p.slice(),
      lanes: e.p.map(s => (lane[s] === undefined ? -1 : lane[s]))
    }));
  const last = fall.notes.length ? fall.notes[fall.notes.length - 1] : null;
  fall.total = last ? last.t + last.dur : 0;
}

function fallResize() {
  if (!fall.canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const r = fall.canvas.getBoundingClientRect();
  fall.dpr = dpr;
  fall.w = r.width;
  fall.h = r.height;
  fall.canvas.width = Math.round(r.width * dpr);
  fall.canvas.height = Math.round(r.height * dpr);
  fall.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* オクターブごとに色を変えて、高い音・低い音を見分けやすくする */
function laneColor(step) {
  const o = octOf(step);
  return o <= 4 ? '#4f8bf0' : o === 5 ? '#27b0a6' : '#b072e8';
}

function fallLoop() {
  if (!fall.on) return;
  fall.raf = requestAnimationFrame(fallLoop);
  const c = fall.ctx;
  if (!c) return;
  const cr = fall.canvas.getBoundingClientRect();
  if (Math.abs(cr.width - fall.w) > 1 || Math.abs(cr.height - fall.h) > 1) fallResize();

  const W = fall.w, H = fall.h;
  const keyH = FALL_KEY_H;
  const judgeY = H - keyH;
  const lead = fallLead();
  const pps = judgeY / lead;             // 1 秒あたり何 px 落ちるか
  const n = fall.order.length;
  const botPad = 12;                                       // 本体の下の余白
  const bodyW = Math.min(W - 16, n * 46);                  // 実物に近い幅で頭打ちにする
  const bodyX = (W - bodyW) / 2;                           // 残りが左右の余白になる
  const laneW = bodyW / n;
  const tineW = Math.max(7, Math.min(laneW * 0.72, 32));   // キー1本の幅

  /* いまの時刻。鳴っていないときは fall.pos（一時停止した位置やドラッグ先）を見せる */
  let now = fall.pos;
  if (playing && playInfo) {
    now = ac().currentTime - playInfo.t0 + playInfo.offset;
    fall.pos = Math.max(0, now);
  } else if (fall.wasPlaying && !fall.drag && fall.pos >= fall.total - 0.05) {
    now = fall.pos = 0;              // 最後まで鳴り終わったら先頭に戻す
    fall.paused = false;
  }
  fall.wasPlaying = playing;

  c.clearRect(0, 0, W, H);
  c.fillStyle = '#0f1420';
  c.fillRect(0, 0, W, H);

  /* レーンの縞 */
  for (let i = 0; i < n; i++) {
    c.fillStyle = i % 2 ? '#141b2a' : '#121826';
    c.fillRect(bodyX + i * laneW, 0, laneW, judgeY);
  }

  /* 拍の線（小節のあたまは太く） */
  const beat = (60 / state.tempo) * (4 / state.beatValue);
  const barBeats = state.beats;
  for (let b = Math.ceil(now / beat); b * beat < now + lead; b++) {
    const y = judgeY - (b * beat - now) * pps;
    if (y < 0) break;
    const isBar = ((b % barBeats) + barBeats) % barBeats === 0;
    c.strokeStyle = isBar ? '#33415e' : '#1e2739';
    c.lineWidth = isBar ? 2 : 1;
    c.beginPath(); c.moveTo(bodyX, y + 0.5); c.lineTo(bodyX + bodyW, y + 0.5); c.stroke();
  }

  /* ノーツ */
  /* カリンバは弾いたら鳴りっぱなしで、押さえ続ける奏法がない。
     そのためノーツは音の長さで伸ばさず、一定の高さにする */
  const hgt = 30;
  const noteFs = Math.max(11, Math.min(16, tineW * 0.55));
  fall.notes.forEach(nt => {
    const dy = (nt.t - now) * pps;
    if (dy > judgeY + 40 || dy < -hgt - 40) return;
    const y = judgeY - dy;
    nt.lanes.forEach((ln, k) => {
      if (ln < 0) return;
      const w = tineW;
      const x = bodyX + ln * laneW + (laneW - w) / 2;
      /* 角は丸めない。上だけ丸いと、どこを弾くのかがかえって読みにくい */
      c.fillStyle = laneColor(nt.steps[k]);
      c.fillRect(x, y - hgt, w, hgt);
      c.fillStyle = 'rgba(255,255,255,.9)';          // 弾く瞬間の側を明るく
      c.fillRect(x, y - 4, w, 4);
      if (w >= 15) {
        c.fillStyle = '#fff';
        c.font = '700 ' + noteFs.toFixed(1) + 'px ' + FONT_JP;
        c.textAlign = 'center';
        c.fillText(numberOf(nt.steps[k]), x + w / 2, y - 10);
      }
      if (playing && Math.abs(dy) < 0.05 * pps) fall.hit[ln] = 0.2;   // 判定ラインを通過
    });
  });


  /* 下は実物のカリンバに似せて描く。
     木の本体の上に、中央ほど長い金属のキーが並ぶ形 */
  const wood = c.createLinearGradient(0, judgeY, 0, H - botPad);
  wood.addColorStop(0, '#e0bd94');
  wood.addColorStop(0.45, '#cda173');
  wood.addColorStop(1, '#b6885a');
  c.fillStyle = wood;
  roundRect(c, bodyX, judgeY, bodyW, keyH - botPad, 14);
  c.fill();

  const mid = (n - 1) / 2;
  const tineMax = keyH - 18;
  const tineStep = Math.min(6, (tineMax - 46) / Math.max(1, mid));
  for (let i = 0; i < n; i++) {
    const step = fall.order[i];
    const len = tineMax - Math.abs(i - mid) * tineStep;   // 中央ほど長い
    const w = tineW;
    const x = bodyX + i * laneW + (laneW - w) / 2;
    const glow = fall.hit[i] > 0;

    /* キー（金属板）。上端は判定ラインにそろえ、下へ伸ばす */
    const metal = c.createLinearGradient(x, 0, x + w, 0);
    if (glow) {
      metal.addColorStop(0, '#ffffff');
      metal.addColorStop(0.5, laneColor(step));
      metal.addColorStop(1, '#9fb4d8');
    } else {
      metal.addColorStop(0, '#6f7c8e');
      metal.addColorStop(0.35, '#e8eef6');
      metal.addColorStop(0.7, '#aab7c8');
      metal.addColorStop(1, '#6b7788');
    }
    c.fillStyle = metal;
    roundRect(c, x, judgeY, w, len, [0, 0, w / 2, w / 2]);
    c.fill();

    /* 番号と階名はキーの上のほうに書く。
       キーの幅に合わせて、収まる範囲でできるだけ大きくする */
    if (w >= 13) {
      c.textAlign = 'center';
      c.fillStyle = '#23303f';
      c.font = '700 ' + Math.max(11, Math.min(17, w * 0.58)).toFixed(1) + 'px ' + FONT_JP;
      c.fillText(numberOf(step), x + w / 2, judgeY + 25);
      if (w >= 22) {
        c.fillStyle = '#5c6a7e';
        c.font = Math.max(10, Math.min(14, w * 0.46)).toFixed(1) + 'px ' + FONT_JP;
        c.fillText(solfegeOf(step), x + w / 2, judgeY + 43);
      }
    }
    if (fall.hit[i] > 0) fall.hit[i] -= 1 / 60;
  }

  /* キーを押さえている金具（ブリッジ）。実物のカリンバにある横棒 */
  const bar = c.createLinearGradient(0, judgeY + 50, 0, judgeY + 61);
  bar.addColorStop(0, '#a9834f');
  bar.addColorStop(1, '#7d5a33');
  c.fillStyle = bar;
  c.fillRect(bodyX + 4, judgeY + 50, bodyW - 8, 11);

  /* 判定ライン。キーの上端に重ねて、いちばん手前に描く */
  c.strokeStyle = 'rgba(255,196,40,.35)';
  c.lineWidth = 6;
  c.beginPath(); c.moveTo(bodyX, judgeY); c.lineTo(bodyX + bodyW, judgeY); c.stroke();
  c.strokeStyle = '#ffc428';
  c.lineWidth = 2;
  c.beginPath(); c.moveTo(bodyX, judgeY); c.lineTo(bodyX + bodyW, judgeY); c.stroke();

  const info = document.getElementById('fallInfo');
  if (info) {
    info.textContent = mmss(Math.max(0, now)) + ' / ' + mmss(fall.total) +
                       '\u3000' + fall.notes.length + ' 音';
  }
}

/* r は数値か [左上, 右上, 右下, 左下] */
function roundRect(c, x, y, w, h, r) {
  const a = Array.isArray(r) ? r : [r, r, r, r];
  const m = Math.min(w, h) / 2;
  const q = a.map(v => Math.max(0, Math.min(v, m)));
  c.beginPath();
  c.moveTo(x + q[0], y);
  c.lineTo(x + w - q[1], y);
  c.quadraticCurveTo(x + w, y, x + w, y + q[1]);
  c.lineTo(x + w, y + h - q[2]);
  c.quadraticCurveTo(x + w, y + h, x + w - q[2], y + h);
  c.lineTo(x + q[3], y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - q[3]);
  c.lineTo(x, y + q[0]);
  c.quadraticCurveTo(x, y, x + q[0], y);
  c.closePath();
}

function syncFallButtons() {
  const p = document.getElementById('fallPlay');
  if (p) p.textContent = playing ? '⏸ 一時停止' : (fall.paused ? '▶ 再開' : '▶ 開始');
  const m = document.getElementById('fallMetro');
  if (m) m.classList.toggle('on', metroOn);
  const s = document.getElementById('fallSilent');
  if (s) s.classList.toggle('on', silent);
}

/* 練習画面の再生ボタン。鳴っているときは一時停止（いまの位置を残す）。
   止まっているときは、いま画面に出ている位置から鳴らす。
   一時停止からの再開以外は、ノーツが落ちてくるぶんの待ち時間を入れる */
function fallTogglePlay() {
  if (playing) {
    fall.paused = true;
    stop();                       // stop() の中から syncFallButtons が呼ばれる
    return;
  }
  buildFallNotes();
  if (fall.pos >= fall.total - 0.05) { fall.pos = 0; fall.paused = false; }
  playMode = 'all';
  play(0, fall.paused ? 0 : fallLead(), fall.pos);
  fall.paused = false;
  syncFallButtons();
}

/* 曲の先頭に戻す */
function fallReset() {
  stop();
  fall.paused = false;
  fall.pos = 0;
  syncFallButtons();
}

/* 画面を上下にドラッグして再生位置を動かす。
   ノーツをつかんで下へ引くと先へ、上へ戻すと前へ進む */
function bindFallDrag(cv) {
  cv.addEventListener('pointerdown', e => {
    if (!fall.on) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* 無視 */ }
    cv.classList.add('drag');
    fall.drag = { y: e.clientY, pos: fall.pos, was: playing };
    if (playing) { fall.paused = true; stop(); }
  });
  cv.addEventListener('pointermove', e => {
    if (!fall.drag) return;
    const t = fall.drag.pos + (e.clientY - fall.drag.y) / fallPps();
    fall.pos = Math.max(0, Math.min(fall.total, t));
  });
  const end = () => {
    if (!fall.drag) return;
    const was = fall.drag.was;
    fall.drag = null;
    cv.classList.remove('drag');
    if (was && fall.pos < fall.total - 0.05) {   // 鳴らしていたならそのまま続ける
      buildFallNotes();
      playMode = 'all';
      play(0, 0, fall.pos);
      fall.paused = false;
    } else {
      fall.paused = fall.pos > 0;
    }
    syncFallButtons();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

/* ============================================================
   20. 起動
   ============================================================ */
function bindUi() {
  const $ = id => document.getElementById(id);

  const ps = $('preset');
  PRESETS.forEach(p => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.label;
    ps.appendChild(o);
  });

  $('title').addEventListener('input', e => { state.title = e.target.value; syncPanel(); autosave(); });
  $('tempo').addEventListener('change', e => {
    state.tempo = Math.max(30, Math.min(240, +e.target.value || 90));
    e.target.value = state.tempo; syncPanel(); autosave();
  });
  $('timesig').addEventListener('change', e => {
    const a = e.target.value.split('/');
    state.beats = +a[0]; state.beatValue = +a[1];
    refresh();
  });
  ps.addEventListener('change', e => {
    pushUndo();                       // 音域外の音は丸められるので戻せるようにしておく
    state.preset = e.target.value;
    state.notes.forEach(n => { n.p = Array.from(new Set(n.p.map(clampStep))).sort((a, b) => a - b); });
    buildTines();
    refresh();
  });

  const tog = (id, key) => $(id).addEventListener('change', e => {
    state[key] = e.target.checked;
    refresh();
  });
  tog('sSol', 'showSol'); tog('sNum', 'showNum'); tog('sLet', 'showLet');

  $('viewStaff').addEventListener('click', () => { setNumberView(false); blurAll(); });
  $('viewNum').addEventListener('click',   () => { setNumberView(true);  blurAll(); });

  $('modeEdit').addEventListener('click', () => { setInputMode('edit'); blurAll(); });
  $('modeAdd').addEventListener('click',  () => { setInputMode('add');  blurAll(); });
  $('modeTap').addEventListener('click',  () => { setInputMode('tap');  blurAll(); });
  $('btnMetro').addEventListener('click', () => { setMetro(!metroOn); blurAll(); });
  $('btnSilent').addEventListener('click', () => { setSilent(!silent); blurAll(); });
  $('btnMic').addEventListener('click',   () => { micStart(); blurAll(); });
  $('micStop').addEventListener('click',  () => { micStop(); blurAll(); });
  $('micSens').addEventListener('input',  e => { micGate = +e.target.value / 1000; });

  $('btnPlayAll').addEventListener('click',  () => { togglePlay('all');  blurAll(); });
  $('btnPlayHere').addEventListener('click', () => { togglePlay('here'); blurAll(); });
  $('perline').addEventListener('change', e => {
    state.perLine = +e.target.value || 4;
    refresh();
  });
  $('btnRest').addEventListener('click', () => { toggleRest(); blurAll(); });
  $('btnDot').addEventListener('click', () => { toggleDot(); blurAll(); });
  $('btnTie').addEventListener('click', () => { toggleTie(); blurAll(); });
  $('btnChord').addEventListener('click', () => { addChordTone(); blurAll(); });
  $('btnChordDel').addEventListener('click', () => { removeChordTone(); blurAll(); });
  $('btnIns').addEventListener('click', () => { insertNote(); blurAll(); });
  $('btnDel').addEventListener('click', () => { deleteNote(); blurAll(); });
  $('btnCopy').addEventListener('click',  () => { copySel(); blurAll(); });
  $('btnPaste').addEventListener('click', () => { pasteClip(); blurAll(); });
  $('btnAll').addEventListener('click',   () => { selectAll(); blurAll(); });
  $('btnUndo').addEventListener('click', () => { undo(); blurAll(); });
  $('songExport').addEventListener('click', () => { saveJson(); blurAll(); });
  $('btnPng').addEventListener('click', () => { exportPng(); blurAll(); });
  $('btnPrint').addEventListener('click', () => { closeSongs(); blurAll(); setTimeout(() => window.print(), 60); });
  $('songImport').addEventListener('click', () => $('file').click());
  $('acctLogin').addEventListener('click', () => acctSubmit('login'));
  $('acctRegister').addEventListener('click', () => acctSubmit('register'));
  $('acctLogout').addEventListener('click', () => acctLogout());
  $('acctDelete').addEventListener('click', () => acctDelete());
  $('cloudSave').addEventListener('click', () => cloudSave());
  $('cloudReload').addEventListener('click', () => cloudReload());
  /* パスワード欄で Enter を押したらログイン */
  $('acctPw').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); acctSubmit('login'); }
  });
  $('btnMenu').addEventListener('click', () => {
    document.body.classList.toggle('menuopen');
    $('btnMenu').classList.toggle('on', document.body.classList.contains('menuopen'));
    render();                       // 高さが変わるので譜面を描き直す
    blurAll();
  });
  $('panelToggle').addEventListener('click', () => {
    setPanel(document.getElementById('panelBody').hidden);
    render();                     // 楽譜の高さが変わるので描き直す
    blurAll();
  });
  $('btnFall').addEventListener('click', () => { openFall(); blurAll(); });
  $('fallClose').addEventListener('click', () => { closeFall(); blurAll(); });
  $('fallPlay').addEventListener('click', () => { fallTogglePlay(); blurAll(); });
  $('fallStop').addEventListener('click', () => { fallReset(); blurAll(); });
  bindFallDrag($('fallCanvas'));
  $('adModalClose').addEventListener('click', () => { closeAdModal(); blurAll(); });
  $('adModal').addEventListener('click', e => {   // 背景を押しても閉じる
    if (e.target === document.getElementById('adModal')) closeAdModal();
  });
  $('fallMetro').addEventListener('click', () => { setMetro(!metroOn); syncFallButtons(); blurAll(); });
  $('fallSilent').addEventListener('click', () => { setSilent(!silent); syncFallButtons(); blurAll(); });
  $('fallTempo').addEventListener('change', e => {
    state.tempo = Math.max(30, Math.min(240, +e.target.value || 90));
    e.target.value = state.tempo;
    $('tempo').value = state.tempo;
    buildFallNotes();
    syncPanel(); autosave();
  });
  $('fallSpeed').addEventListener('input', e => {
    fall.speed = +e.target.value;
    try { localStorage.setItem(FALL_SPEED_KEY, String(fall.speed)); } catch (err) {}
  });
  $('btnSongs').addEventListener('click', () => { openSongs(); blurAll(); });
  $('btnHelp').addEventListener('click', () => { openTutorial(0); blurAll(); });
  $('tutClose').addEventListener('click', () => { closeTutorial(); blurAll(); });
  $('tutPrev').addEventListener('click', () => { tutMove(-1); });
  $('tutNext').addEventListener('click', () => { tutMove(1); });
  $('tutorial').addEventListener('mousedown', e => { if (e.target.id === 'tutorial') closeTutorial(); });
  $('songsClose').addEventListener('click', () => { closeSongs(); blurAll(); });
  $('songs').addEventListener('mousedown', e => { if (e.target.id === 'songs') closeSongs(); });
  $('songSave').addEventListener('click', () => { saveSong(); });
  $('songLink').addEventListener('click', () => { copyShareUrl(); });
  $('songName').addEventListener('keydown', e => { if (e.key === 'Enter') saveSong(); });
  $('songNew').addEventListener('click', () => {
    if (!confirm('今の楽譜を消して新規作成しますか？')) return;
    pushUndo();
    state.title = '無題の曲';
    state.notes = [newNote(clampStep(0), 'q', false, true)];
    cursor = 0;
    $('title').value = state.title;
    refresh();
    closeSongs();
  });
  $('file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        pushUndo();
        deserialize(rd.result);
        syncInputs();
        buildTines();
        refresh();
        closeSongs();
      } catch (err) { alert('読み込めませんでした: ' + err.message); }
    };
    rd.readAsText(f);
    e.target.value = '';
  });

  document.addEventListener('keydown', onKey);
  document.addEventListener('mouseup', () => { dragFrom = -1; });
  /* 開いたまま別の共有URLを貼られたときも読み込む */
  window.addEventListener('hashchange', () => {
    if (loadFromHash()) { syncInputs(); buildTines(); refresh(); }
  });
  $('score').addEventListener('wheel', onWheel, { passive: false });
  ['wheel', 'touchstart', 'pointerdown'].forEach(ev =>
    $('paper').addEventListener(ev, cancelScrollAnim, { passive: true }));

  let rt = null;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { syncMode(); render(); if (fall.on) fallResize(); }, 150);
  });
}

function syncInputs() {
  document.getElementById('title').value = state.title;
  document.getElementById('tempo').value = state.tempo;
  document.getElementById('timesig').value = state.beats + '/' + state.beatValue;
  document.getElementById('preset').value = state.preset;
  document.getElementById('perline').value = state.perLine;
  document.getElementById('sSol').checked = state.showSol;
  document.getElementById('sNum').checked = state.showNum;
  document.getElementById('sLet').checked = state.showLet;
  syncModeButtons();
}

function setInputMode(mode) {
  if (MODES.indexOf(mode) < 0) mode = 'edit';
  state.inputMode = mode;
  resetTap();
  syncModeButtons();
  syncPanel();
  autosave();
}
function syncModeButtons() {
  document.getElementById('modeEdit').classList.toggle('on', state.inputMode === 'edit');
  document.getElementById('modeAdd').classList.toggle('on', state.inputMode === 'add');
  document.getElementById('modeTap').classList.toggle('on', state.inputMode === 'tap');
}

function boot() {
  bindUi();
  authLoad();
  if (!loadFromHash()) {                    // URL に曲が入っていればそれを開く
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) deserialize(saved);
    } catch (e) { /* 壊れていたら初期状態 */ }
  }
  /* 前に閉じていたら閉じたままにする。初めての人には開いて見せる */
  let panelOpen = true;
  try { panelOpen = localStorage.getItem(PANEL_KEY) !== '0'; } catch (e) { /* 無視 */ }
  setPanel(panelOpen);
  /* 前に数字譜で見ていたら、そのまま数字譜で開く。
     この時点ではまだ描いていないので、ボタンの見た目だけそろえます */
  try { numberView = localStorage.getItem(NUM_VIEW_KEY) === '1'; } catch (e) { /* 無視 */ }
  syncViewButtons();
  readOnly = window.matchMedia(NARROW).matches;   // 画面の広さだけで決める
  try { setSilent(localStorage.getItem(SILENT_KEY) === '1'); } catch (e) {}
  try {
    const sp = +localStorage.getItem(FALL_SPEED_KEY);
    if (sp >= 1 && sp <= 10) fall.speed = sp;
  } catch (e) {}
  /* 初めての人と、前に読んだあと版が上がった人に出す */
  let unread = true;
  try { unread = localStorage.getItem(TUT_KEY) !== APP_VERSION; } catch (e) {}
  /* 練習画面の URL で来た人には、使い方モーダルを重ねない */
  if (unread && !isFallPath()) setTimeout(() => openTutorial(0), 350);
  if (!state.notes.length) state.notes = [newNote(clampStep(0), 'q', false, true)];
  syncInputs();
  buildDurPalette();
  buildTines();
  refresh();
  booted = true;
  if (isFallPath()) openFall(true);       // /practice で来たらそのまま練習画面
}

function start() {
  if (window.Vex && window.Vex.Flow) { boot(); return; }
  /* ローカルの vendor/ が無い場合だけ CDN から取りに行く */
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/vexflow@4.2.2/build/cjs/vexflow-bravura.js';
  s.onload = boot;
  s.onerror = () => {
    document.getElementById('score').innerHTML =
      '<p id="empty">楽譜描画ライブラリ (vendor/vexflow-bravura.js) を読み込めませんでした。</p>';
  };
  document.head.appendChild(s);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();





})();
