/* 前タレ工房 — app.js
   状態管理・UI・プレビュー・CSV取り込み・PDF出力。すべて端末内で完結します。 */
(function () {
  'use strict';

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  const STORE_KEY = 'maetare-kobo.settings.v3';
  const THEME_KEY = 'maetare-kobo.theme';
  const FIELD_KEYS = ['org', 'title', 'name'];

  /* ---------- 初期値 ---------- */
  function defaults() {
    return {
      page: { size: 'A3', orient: 'portrait', customW: 210, customH: 297, bg: '#ffffff', fg: '#111111', border: false, borderWidth: 2, borderInset: 12 },
      autoFit: true,
      scaleOnPaperChange: true,
      dpi: 200,
      persistSlips: false,
      fields: {
        // 参考写真(mae_assist_01.jpg)の寸法から決めた初期配置。名前は用紙の正中央。
        org:   { label: '所属',   show: true, writing: 'vertical', font: 'gothic', size: 90,  weight: 'bold', spacing: 0,  align: 'left',   x: 89, y: 10.7 },
        title: { label: '肩書き', show: true, writing: 'vertical', font: 'gothic', size: 80,  weight: 'bold', spacing: 13, align: 'left',   x: 70, y: 10.7 },
        name:  { label: '名前',   show: true, writing: 'vertical', font: 'gothic', size: 155, weight: 'bold', spacing: 40, align: 'center', x: 50, y: 50 }
      }
    };
  }

  function sampleSlips() {
    return [
      { org: '株式会社印刷', title: '代表取締役', name: '斎藤 太郎' },
      { org: '株式会社サンプル', title: '取締役 最高技術責任者', name: '佐藤 花子' }
    ];
  }

  let state = defaults();
  let slips = sampleSlips();
  let current = 0;
  let sampleUntouched = true;
  let highlight = null;
  let dragging = null;
  let dragMode = false;
  let boxes = [];

  /* ---------- 保存 / 復元(この端末のlocalStorageのみ) ---------- */
  function merge(base, saved) {
    Object.keys(base).forEach(function (k) {
      if (saved && saved[k] !== undefined) {
        if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) merge(base[k], saved[k]);
        else base[k] = saved[k];
      }
    });
    return base;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      state = merge(defaults(), saved.state);
      if (Array.isArray(saved.slips) && saved.slips.length) {
        slips = saved.slips;
        sampleUntouched = false;
      }
    } catch (e) { /* 保存データが壊れていても起動する */ }
  }

  function save() {
    try {
      const data = { state: state };
      if (state.persistSlips) data.slips = slips;
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) { /* 保存不可の環境でも動作は継続 */ }
  }

  /* ---------- 小物 ---------- */
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }
  function getPath(o, p) { return p.split('.').reduce(function (a, k) { return a[k]; }, o); }
  function setPath(o, p, v) {
    const ks = p.split('.');
    const last = ks.pop();
    ks.reduce(function (a, k) { return a[k]; }, o)[last] = v;
  }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#status');
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.textContent = ''; }, 6000);
  }

  /* ---------- テーマ ---------- */
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('#themeBtn').textContent = t === 'dark' ? 'ホワイトモード' : 'ダークモード';
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* noop */ }
  }

  function initTheme() {
    let t = 'light'; // 初期値はホワイトモード
    try { if (localStorage.getItem(THEME_KEY) === 'dark') t = 'dark'; } catch (e) { /* noop */ }
    applyTheme(t);
    $('#themeBtn').addEventListener('click', function () {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
  }

  /* ---------- 設定パネル ---------- */
  function fieldCard(k) {
    const f = state.fields[k];
    const p = 'fields.' + k + '.';
    return '' +
      '<details class="card" open>' +
        '<summary><label class="switch" title="表示 / 非表示"><input type="checkbox" data-path="' + p + 'show" aria-label="' + f.label + 'を表示"><span></span></label>' + f.label + '</summary>' +
        '<div class="grid">' +
          '<label class="ctl wide">フォント<select data-path="' + p + 'font" data-font></select></label>' +
          '<div class="ctl wide">文字サイズ (pt)<div class="pair">' +
            '<input type="range" min="10" max="400" step="1" data-path="' + p + 'size" aria-label="' + f.label + 'のサイズ">' +
            '<input type="number" min="1" max="1000" step="1" data-path="' + p + 'size" aria-label="' + f.label + 'のサイズ(数値)"></div></div>' +
          '<div class="ctl wide">横位置 (%) ※縦書きでは列の中心<div class="pair">' +
            '<input type="range" min="0" max="100" step="0.1" data-path="' + p + 'x" aria-label="' + f.label + 'の横位置">' +
            '<input type="number" min="0" max="100" step="0.1" data-path="' + p + 'x" aria-label="' + f.label + 'の横位置(数値)"></div></div>' +
          '<div class="ctl wide">縦位置 (%)<div class="pair">' +
            '<input type="range" min="0" max="100" step="0.1" data-path="' + p + 'y" aria-label="' + f.label + 'の縦位置">' +
            '<input type="number" min="0" max="100" step="0.1" data-path="' + p + 'y" aria-label="' + f.label + 'の縦位置(数値)"></div></div>' +
          '<label class="ctl">書字方向<select data-path="' + p + 'writing"><option value="vertical">縦書き</option><option value="horizontal">横書き</option></select></label>' +
          '<label class="ctl">太さ<select data-path="' + p + 'weight"><option value="normal">標準</option><option value="bold">太字</option></select></label>' +
          '<label class="ctl wide">揃え(基準位置に対して)<select data-path="' + p + 'align">' +
            '<option value="center">中央</option><option value="left">先頭を基準(横書き: 左 / 縦書き: 上)</option><option value="right">末尾を基準(横書き: 右 / 縦書き: 下)</option></select></label>' +
          '<div class="ctl wide">字間 (%)<div class="pair">' +
            '<input type="range" min="-10" max="60" step="1" data-path="' + p + 'spacing" aria-label="' + f.label + 'の字間">' +
            '<input type="number" min="-10" max="60" step="1" data-path="' + p + 'spacing" aria-label="' + f.label + 'の字間(数値)"></div></div>' +
        '</div>' +
      '</details>';
  }

  function buildFieldCards() {
    $('#fieldCards').innerHTML = FIELD_KEYS.map(fieldCard).join('');
    refreshFontOptions();
  }

  function refreshFontOptions() {
    const fonts = Renderer.allFonts();
    $$('select[data-font]').forEach(function (sel) {
      sel.innerHTML = '';
      fonts.forEach(function (f) {
        const o = document.createElement('option');
        o.value = f.id;
        o.textContent = f.name;
        sel.appendChild(o);
      });
    });
    syncControls();
  }

  function syncControls() {
    $$('[data-path]').forEach(function (el) {
      const v = getPath(state, el.dataset.path);
      if (el.type === 'checkbox') {
        el.checked = !!v;
      } else if (el !== document.activeElement || el.tagName === 'SELECT') {
        el.value = v;
      }
    });
    $('#customSize').hidden = state.page.size !== 'custom';
    const mm = Renderer.pageMm(state.page);
    $('#paperInfo').textContent = (state.page.size === 'custom' ? 'カスタム' : state.page.size) +
      ' ' + (state.page.orient === 'landscape' ? '横' : '縦') + ' / ' + mm[0] + ' × ' + mm[1] + ' mm';
  }

  function onSettingInput(e) {
    const el = e.target.closest('[data-path]');
    if (!el) return;
    const path = el.dataset.path;
    let v;
    if (el.type === 'checkbox') {
      v = el.checked;
    } else if (el.type === 'number' || el.type === 'range' || el.hasAttribute('data-number')) {
      v = parseFloat(el.value);
      if (isNaN(v)) return;
    } else {
      v = el.value;
    }

    // 用紙サイズ・向きの変更時は文字サイズを幅の比率で調整
    if ((path === 'page.size' || path === 'page.orient') && state.scaleOnPaperChange) {
      const before = Renderer.pageMm(state.page)[0];
      setPath(state, path, v);
      const ratio = Renderer.pageMm(state.page)[0] / before;
      FIELD_KEYS.forEach(function (k) {
        state.fields[k].size = clamp(Math.round(state.fields[k].size * ratio), 1, 1000);
      });
    } else {
      setPath(state, path, v);
    }

    syncControls();
    save();
    redraw();
  }

  /* ---------- 登壇者リスト ---------- */
  function renderList() {
    const ol = $('#slipList');
    ol.innerHTML = '';
    slips.forEach(function (s, i) {
      const li = document.createElement('li');
      li.className = 'row' + (i === current ? ' active' : '');
      li.dataset.i = i;
      li.innerHTML =
        '<span class="idx">' + (i + 1) + '</span>' +
        '<div class="fields">' +
          '<input type="text" data-k="org" placeholder="所属" aria-label="所属">' +
          '<input type="text" data-k="title" placeholder="肩書き" aria-label="肩書き">' +
          '<input type="text" data-k="name" placeholder="名前" aria-label="名前">' +
        '</div>' +
        '<div class="acts">' +
          '<button type="button" class="icon" data-act="up" aria-label="上へ移動">↑</button>' +
          '<button type="button" class="icon" data-act="down" aria-label="下へ移動">↓</button>' +
          '<button type="button" class="icon" data-act="del" aria-label="この行を削除">✕</button>' +
        '</div>';
      FIELD_KEYS.forEach(function (k) { $('[data-k="' + k + '"]', li).value = s[k] || ''; });
      ol.appendChild(li);
    });
    $('#countBadge').textContent = slips.length + '名';
    updatePager();
  }

  function markActiveRow() {
    $$('#slipList .row').forEach(function (li, i) { li.classList.toggle('active', i === current); });
  }

  function setCurrent(i) {
    if (i === current || i < 0 || i >= slips.length) return;
    current = i;
    markActiveRow();
    updatePager();
    redraw();
  }

  function updatePager() {
    $('#pageInfo').textContent = (slips.length ? current + 1 : 0) + ' / ' + slips.length;
  }

  function ensureOneRow() {
    if (!slips.length) slips.push({ org: '', title: '', name: '' });
    current = clamp(current, 0, slips.length - 1);
  }

  function initList() {
    const ol = $('#slipList');

    ol.addEventListener('input', function (e) {
      const input = e.target.closest('[data-k]');
      if (!input) return;
      const i = +input.closest('.row').dataset.i;
      slips[i][input.dataset.k] = input.value;
      sampleUntouched = false;
      if (state.persistSlips) save();
      redraw();
    });

    ol.addEventListener('focusin', function (e) {
      const row = e.target.closest('.row');
      if (row) setCurrent(+row.dataset.i);
    });

    ol.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const i = +btn.closest('.row').dataset.i;
      const act = btn.dataset.act;
      sampleUntouched = false;
      if (act === 'del') {
        slips.splice(i, 1);
        ensureOneRow();
        if (current > i) current--;
      } else if (act === 'up' && i > 0) {
        slips.splice(i - 1, 0, slips.splice(i, 1)[0]);
        current = i - 1;
      } else if (act === 'down' && i < slips.length - 1) {
        slips.splice(i + 1, 0, slips.splice(i, 1)[0]);
        current = i + 1;
      }
      renderList();
      if (state.persistSlips) save();
      redraw();
    });

    $('#addBtn').addEventListener('click', function () {
      slips.push({ org: '', title: '', name: '' });
      current = slips.length - 1;
      sampleUntouched = false;
      renderList();
      const last = $$('#slipList .row').pop();
      if (last) $('[data-k="name"]', last).focus();
      redraw();
    });

    $('#clearBtn').addEventListener('click', function () {
      if (!confirm('登壇者リストをすべて削除します。よろしいですか?')) return;
      slips = [];
      ensureOneRow();
      sampleUntouched = false;
      renderList();
      if (state.persistSlips) save();
      redraw();
    });

    $('#prevBtn').addEventListener('click', function () { setCurrent(current - 1); });
    $('#nextBtn').addEventListener('click', function () { setCurrent(current + 1); });
  }

  /* ---------- CSV ---------- */
  async function importCsv(file) {
    try {
      const text = CSV.decode(await file.arrayBuffer());
      const result = CSV.toSlips(CSV.parse(text));
      if (!result.slips.length) {
        toast('読み込めるデータがありませんでした。見出し行と1行以上のデータがあるか確認してください。');
        return;
      }
      const hasData = !sampleUntouched && slips.some(function (s) { return s.org || s.title || s.name; });
      let append = false;
      if (hasData) {
        append = !confirm('現在のリストを CSV の内容で置き換えますか?\n[OK] 置き換える / [キャンセル] 末尾に追加する');
      }
      slips = append
        ? slips.filter(function (s) { return s.org || s.title || s.name; }).concat(result.slips)
        : result.slips;
      sampleUntouched = false;
      current = 0;
      renderList();
      if (state.persistSlips) save();
      redraw();
      toast(result.slips.length + '名を読み込みました' + (result.hasHeader ? '' : '(見出しなし: 名前, 肩書き, 所属 の順で解釈)'));
    } catch (err) {
      toast('CSVを読み込めませんでした: ' + err.message);
    }
  }

  function initCsv() {
    const input = $('#csvInput');
    const zone = $('#dropZone');

    input.addEventListener('change', function () {
      if (input.files[0]) importCsv(input.files[0]);
      input.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      zone.addEventListener(t, function (e) { e.preventDefault(); zone.classList.remove('over'); });
    });
    zone.addEventListener('drop', function (e) {
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) importCsv(f);
    });

    $('#sampleBtn').addEventListener('click', function () {
      download(new Blob([CSV.sampleCsv()], { type: 'text/csv' }), 'maetare-sample.csv');
    });
  }

  /* ---------- プレビュー ---------- */
  let raf = 0;
  function redraw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(draw);
  }

  function draw() {
    const canvas = $('#preview');
    const mm = Renderer.pageMm(state.page);
    const availW = $('#stageBox').clientWidth || 400;
    const maxH = Math.max(320, window.innerHeight * 0.7);
    const cssW = Math.min(availW, maxH * mm[0] / mm[1]);
    const cssH = cssW * mm[1] / mm[0];
    const dpr = window.devicePixelRatio || 1;

    boxes = Renderer.render(canvas, state, slips[current], cssW * dpr / mm[0], { guides: true, highlight: highlight });
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
  }

  function pointerInfo(e) {
    const canvas = $('#preview');
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width * 100,
      y: (e.clientY - r.top) / r.height * 100,
      px: (e.clientX - r.left) * canvas.width / r.width,
      py: (e.clientY - r.top) * canvas.height / r.height
    };
  }

  function hitTest(px, py) {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.key;
    }
    return null;
  }

  function setDragMode(on) {
    dragMode = on;
    $('#dragMode').checked = on;
    document.body.classList.toggle('drag-on', on);
  }

  function initPreview() {
    const canvas = $('#preview');

    // タッチ端末では画面スクロールを優先するため、既定ではドラッグ移動をオフにする
    setDragMode(window.matchMedia('(pointer: fine)').matches);
    $('#dragMode').addEventListener('change', function (e) { setDragMode(e.target.checked); });

    canvas.addEventListener('pointerdown', function (e) {
      if (!dragMode) return;
      const p = pointerInfo(e);
      const key = hitTest(p.px, p.py);
      if (!key) return;
      const f = state.fields[key];
      dragging = { key: key, dx: p.x - f.x, dy: p.y - f.y };
      highlight = key;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
      redraw();
    });

    canvas.addEventListener('pointermove', function (e) {
      const p = pointerInfo(e);
      if (dragging) {
        const f = state.fields[dragging.key];
        let x = clamp(p.x - dragging.dx, 0, 100);
        const y = clamp(p.y - dragging.dy, 0, 100);
        if (Math.abs(x - 50) < 1) x = 50; // 中央に吸着
        f.x = round1(x);
        f.y = round1(y);
        syncControls();
        redraw();
      } else if (dragMode) {
        const key = hitTest(p.px, p.py);
        canvas.style.cursor = key ? 'grab' : 'default';
        if (key !== highlight) { highlight = key; redraw(); }
      }
    });

    function endDrag() {
      if (!dragging) return;
      dragging = null;
      highlight = null;
      canvas.style.cursor = 'default';
      save();
      redraw();
    }
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', function () {
      if (!dragging && highlight) { highlight = null; redraw(); }
    });

    if (window.ResizeObserver) new ResizeObserver(redraw).observe($('#stageBox'));
    window.addEventListener('resize', redraw);
  }

  /* ---------- PDF出力 ---------- */
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  function stamp() {
    const d = new Date();
    const z = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '-' + z(d.getHours()) + z(d.getMinutes());
  }

  async function exportPdf(indices) {
    indices = indices.filter(function (i) {
      const s = slips[i];
      return s && (s.org || s.title || s.name);
    });
    if (!indices.length) {
      toast('出力できる内容がありません。名前や肩書きを入力してください。');
      return;
    }

    const buttons = $$('#pdfAllBtn, #pdfOneBtn');
    buttons.forEach(function (b) { b.disabled = true; });

    try {
      const mm = Renderer.pageMm(state.page);
      let pxPerMm = state.dpi / 25.4;
      const LIMIT = 16000000; // ブラウザのCanvas上限(iOS Safari 対策)
      let reduced = false;
      if (mm[0] * mm[1] * pxPerMm * pxPerMm > LIMIT) {
        pxPerMm = Math.sqrt(LIMIT / (mm[0] * mm[1]));
        reduced = true;
      }

      const canvas = document.createElement('canvas');
      const pages = [];
      for (let n = 0; n < indices.length; n++) {
        toast('PDFを生成中… ' + (n + 1) + ' / ' + indices.length);
        await tick();
        Renderer.render(canvas, state, slips[indices[n]], pxPerMm, {});
        const blob = await new Promise(function (res) { canvas.toBlob(res, 'image/jpeg', 0.92); });
        if (!blob) throw new Error('画像の生成に失敗しました。解像度を下げてお試しください。');
        pages.push({
          jpeg: new Uint8Array(await blob.arrayBuffer()),
          wPx: canvas.width,
          hPx: canvas.height,
          wPt: mm[0] * 72 / 25.4,
          hPt: mm[1] * 72 / 25.4
        });
      }

      download(PDFWriter.build(pages), 'maetare-' + stamp() + '.pdf');
      toast(pages.length + '枚のPDFを書き出しました' + (reduced ? '(用紙が大きいため解像度を自動で下げました)' : ''));
    } catch (err) {
      toast('PDFの書き出しに失敗しました: ' + err.message);
    } finally {
      buttons.forEach(function (b) { b.disabled = false; });
    }
  }

  function initExport() {
    $('#pdfAllBtn').addEventListener('click', function () {
      exportPdf(slips.map(function (_, i) { return i; }));
    });
    $('#pdfOneBtn').addEventListener('click', function () { exportPdf([current]); });
  }

  /* ---------- フォント追加 / 初期化 ---------- */
  function initMisc() {
    $('#fontInput').addEventListener('change', async function (e) {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const font = await Renderer.addCustomFont(file);
        refreshFontOptions();
        toast('フォント「' + font.name + '」を追加しました。各項目のフォント欄から選べます。');
        redraw();
      } catch (err) {
        toast('フォントを読み込めませんでした: ' + err.message);
      }
    });

    $('#resetBtn').addEventListener('click', function () {
      if (!confirm('レイアウト設定を初期化し、この端末に保存したデータを削除します。よろしいですか?')) return;
      try { localStorage.removeItem(STORE_KEY); } catch (e) { /* noop */ }
      state = defaults();
      syncControls();
      save();
      redraw();
      toast('設定を初期化しました');
    });

    document.addEventListener('input', onSettingInput);
  }

  /* ---------- 起動 ---------- */
  load();
  initTheme();
  buildFieldCards();
  initList();
  initCsv();
  initPreview();
  initExport();
  initMisc();
  renderList();
  syncControls();
  redraw();
})();
