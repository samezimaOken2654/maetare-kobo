/* 前タレ工房 — renderer.js
   Canvasに前タレ1枚を描画する。プレビューとPDF出力で同じ関数を使う。 */
(function (global) {
  'use strict';

  const PT_TO_MM = 25.4 / 72;

  // 用紙サイズ [短辺, 長辺] mm
  const PAPERS = {
    A2: [420, 594],
    A3: [297, 420],
    A4: [210, 297],
    A5: [148, 210],
    B3: [364, 515],
    B4: [257, 364],
    B5: [182, 257]
  };

  // 端末にインストールされているフォントを優先順に指定(無い場合は次の候補へ)
  const BUILTIN_FONTS = [
    { id: 'gothic', name: 'ゴシック体', css: '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","YuGothic","Meiryo","Noto Sans JP","Noto Sans CJK JP",sans-serif' },
    { id: 'mincho', name: '明朝体', css: '"Hiragino Mincho ProN","Yu Mincho","YuMincho","MS PMincho","Noto Serif JP","Noto Serif CJK JP",serif' },
    { id: 'bizgothic', name: 'BIZ UDゴシック', css: '"BIZ UDPGothic","BIZ UDGothic","Hiragino Sans","Yu Gothic","Meiryo",sans-serif' },
    { id: 'bizmincho', name: 'BIZ UD明朝', css: '"BIZ UDPMincho","BIZ UDMincho","Hiragino Mincho ProN","Yu Mincho",serif' },
    { id: 'maru', name: '丸ゴシック', css: '"Hiragino Maru Gothic ProN","Hiragino Maru Gothic Pro","Yu Gothic UI","M PLUS Rounded 1c","Meiryo UI",sans-serif' },
    { id: 'meiryo', name: 'メイリオ', css: '"Meiryo","メイリオ","Hiragino Sans","Yu Gothic",sans-serif' },
    { id: 'kyokasho', name: '教科書体', css: '"UD Digi Kyokasho NP-R","UD デジタル 教科書体 NP-R","Hiragino Mincho ProN","YuKyokasho","Klee",serif' },
    { id: 'latin', name: '欧文 (Helvetica / Arial)', css: '"Helvetica Neue",Helvetica,Arial,"Hiragino Sans","Yu Gothic",sans-serif' }
  ];

  const customFonts = [];

  function allFonts() { return BUILTIN_FONTS.concat(customFonts); }

  function fontCss(id) {
    const f = allFonts().find(function (x) { return x.id === id; }) || BUILTIN_FONTS[0];
    return f.css;
  }

  // ユーザーが選んだフォントファイルを端末内で読み込む(送信はしない)
  async function addCustomFont(file) {
    const buf = await file.arrayBuffer();
    const n = customFonts.length + 1;
    const family = 'UserFont' + n;
    const face = new FontFace(family, buf);
    await face.load();
    document.fonts.add(face);
    const font = {
      id: 'custom' + n,
      name: '追加: ' + file.name.replace(/\.[^.]+$/, ''),
      css: '"' + family + '",sans-serif'
    };
    customFonts.push(font);
    return font;
  }

  // 用紙サイズ(mm) [幅, 高さ]
  function pageMm(page) {
    let w, h;
    if (page.size === 'custom') {
      w = +page.customW || 210;
      h = +page.customH || 297;
    } else {
      const p = PAPERS[page.size] || PAPERS.A3;
      w = p[0]; h = p[1];
    }
    const s = Math.min(w, h);
    const l = Math.max(w, h);
    return page.orient === 'landscape' ? [l, s] : [s, l];
  }

  function measure(ctx, chars, spacing) {
    if (!spacing) return ctx.measureText(chars.join('')).width;
    let w = 0;
    chars.forEach(function (c) { w += ctx.measureText(c).width; });
    return w + spacing * (chars.length - 1);
  }

  // 1項目分のレイアウトを計算(はみ出し時の縮小を含む)
  function layout(ctx, f, text, W, H, pxPerMm, autoFit) {
    const chars = Array.from(text);
    const css = fontCss(f.font);
    const weight = f.weight === 'bold' ? '700' : '400';
    const setFont = function (px) { ctx.font = weight + ' ' + px + 'px ' + css; };

    let size = f.size * PT_TO_MM * pxPerMm;
    setFont(size);
    let sp = size * f.spacing / 100;
    let w = measure(ctx, chars, sp);

    const ax = W * f.x / 100;
    const ay = H * f.y / 100;

    if (autoFit) {
      const margin = W * 0.03;
      let avail;
      if (f.align === 'left') avail = W - ax - margin;
      else if (f.align === 'right') avail = ax - margin;
      else avail = 2 * Math.min(ax, W - ax) - 2 * margin;
      if (avail > 0 && w > avail) {
        size *= avail / w;
        setFont(size);
        sp = size * f.spacing / 100;
        w = measure(ctx, chars, sp);
      }
    }

    let x0 = ax;
    if (f.align === 'center') x0 = ax - w / 2;
    else if (f.align === 'right') x0 = ax - w;

    return { chars: chars, size: size, sp: sp, w: w, x0: x0, y: ay };
  }

  function drawText(ctx, L) {
    if (!L.sp) {
      ctx.fillText(L.chars.join(''), L.x0, L.y);
      return;
    }
    let x = L.x0;
    L.chars.forEach(function (c) {
      ctx.fillText(c, x, L.y);
      x += ctx.measureText(c).width + L.sp;
    });
  }

  /* ---------- 縦書き ---------- */
  const ROTATE = 'ー―—－-〜～…（）()[]【】〈〉《》＜＞<>＝=';
  const PUNCT = '、。，．';
  const SMALL = 'ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ';

  function advanceUnit(c) { return c === ' ' ? 0.5 : 1; }

  // 縦書きのレイアウト。x は列の中心、y は「揃え」の基準(上 / 中央 / 下)
  function layoutVertical(ctx, f, text, W, H, pxPerMm, autoFit) {
    const chars = Array.from(text);
    let units = 0;
    chars.forEach(function (c) { units += advanceUnit(c); });
    let k = units + Math.max(0, chars.length - 1) * f.spacing / 100; // 全長(em単位)
    if (k < 0.1) k = 0.1;

    let size = f.size * PT_TO_MM * pxPerMm;
    const ax = W * f.x / 100;
    const ay = H * f.y / 100;

    if (autoFit) {
      const margin = H * 0.03;
      let avail;
      if (f.align === 'left') avail = H - ay - margin;          // 上を基準
      else if (f.align === 'right') avail = ay - margin;        // 下を基準
      else avail = 2 * Math.min(ay, H - ay) - 2 * margin;
      if (avail > 0 && k * size > avail) size = avail / k;
    }

    const len = k * size;
    let y0 = ay;
    if (f.align === 'center') y0 = ay - len / 2;
    else if (f.align === 'right') y0 = ay - len;

    ctx.font = (f.weight === 'bold' ? '700' : '400') + ' ' + size + 'px ' + fontCss(f.font);
    return { vertical: true, chars: chars, size: size, sp: size * f.spacing / 100, len: len, x: ax, y0: y0 };
  }

  function drawVertical(ctx, L) {
    ctx.textAlign = 'center';
    let y = L.y0;
    L.chars.forEach(function (c) {
      const adv = advanceUnit(c) * L.size;
      if (c !== ' ') {
        const cx = L.x;
        const cy = y + adv / 2;
        ctx.save();
        if (ROTATE.indexOf(c) !== -1) {
          ctx.translate(cx, cy);
          ctx.rotate(Math.PI / 2);
          ctx.fillText(c, 0, 0);
        } else {
          let dx = 0, dy = 0;
          if (PUNCT.indexOf(c) !== -1) { dx = 0.6 * L.size; dy = -0.6 * L.size; }
          else if (SMALL.indexOf(c) !== -1) { dx = 0.12 * L.size; dy = -0.12 * L.size; }
          ctx.fillText(c, cx + dx, cy + dy);
        }
        ctx.restore();
      }
      y += adv + L.sp;
    });
    ctx.textAlign = 'left';
  }

  /**
   * @param canvas   描画先
   * @param state    { page, fields, autoFit }
   * @param slip     { org, title, name }
   * @param pxPerMm  1mmあたりのピクセル数
   * @param opts     { guides: プレビュー用の補助表示, highlight: 強調する項目キー }
   * @returns        ヒットテスト用の枠 [{key,x,y,w,h}]
   */
  function render(canvas, state, slip, pxPerMm, opts) {
    opts = opts || {};
    slip = slip || {};
    const mm = pageMm(state.page);
    const W = Math.round(mm[0] * pxPerMm);
    const H = Math.round(mm[1] * pxPerMm);
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = state.page.bg;
    ctx.fillRect(0, 0, W, H);

    if (state.page.border) {
      const lw = Math.max(1, state.page.borderWidth * pxPerMm);
      const inset = state.page.borderInset * pxPerMm + lw / 2;
      ctx.strokeStyle = state.page.fg;
      ctx.lineWidth = lw;
      ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
    }

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const boxes = [];
    ['org', 'title', 'name'].forEach(function (key) {
      const f = state.fields[key];
      if (!f || !f.show) return;

      let text = String(slip[key] || '').trim();
      let placeholder = false;
      if (!text) {
        if (!opts.guides) return;
        text = f.label;
        placeholder = true;
      }

      const L = f.writing === 'horizontal'
        ? layout(ctx, f, text, W, H, pxPerMm, state.autoFit)
        : layoutVertical(ctx, f, text, W, H, pxPerMm, state.autoFit);
      ctx.save();
      ctx.fillStyle = state.page.fg;
      ctx.globalAlpha = placeholder ? 0.18 : 1;
      if (L.vertical) drawVertical(ctx, L); else drawText(ctx, L);
      ctx.restore();

      const box = L.vertical
        ? { key: key, x: L.x - L.size * 0.62, y: L.y0, w: L.size * 1.24, h: L.len }
        : { key: key, x: L.x0, y: L.y - L.size * 0.62, w: L.w, h: L.size * 1.24 };
      boxes.push(box);

      if (opts.highlight === key) {
        ctx.save();
        ctx.strokeStyle = '#0f8bb0';
        ctx.lineWidth = Math.max(1, W / 600);
        ctx.setLineDash([W / 120, W / 160]);
        ctx.strokeRect(box.x - 6, box.y, box.w + 12, box.h);
        if (Math.abs(state.fields[key].x - 50) < 0.05) {
          ctx.beginPath();
          ctx.moveTo(W / 2, 0);
          ctx.lineTo(W / 2, H);
          ctx.stroke();
        }
        ctx.restore();
      }
    });

    return boxes;
  }

  global.Renderer = {
    PT_TO_MM: PT_TO_MM,
    PAPERS: PAPERS,
    allFonts: allFonts,
    addCustomFont: addCustomFont,
    pageMm: pageMm,
    render: render
  };
})(window);
