/* 前タレ工房 — csv.js
   CSVの読み込み(文字コード判定・パース・見出し判定)とサンプル生成 */
(function (global) {
  'use strict';

  // UTF-8として読めなければ Shift_JIS(Excelの既定)として読む
  function decode(buffer) {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch (e) {
      text = new TextDecoder('shift_jis').decode(buffer);
    }
    return text.replace(/^\uFEFF/, '');
  }

  // ダブルクォート・改行入りセル・カンマ/タブ区切りに対応した簡易パーサ
  function parse(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuote = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuote) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else { inQuote = false; }
        } else {
          cell += c;
        }
      } else if (c === '"') {
        inQuote = true;
      } else if (c === ',' || c === '\t') {
        row.push(cell); cell = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row);
        row = []; cell = '';
      } else {
        cell += c;
      }
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }

    return rows.filter(function (r) {
      return r.some(function (c) { return c.trim() !== ''; });
    });
  }

  const ALIASES = {
    name: ['名前', '氏名', 'お名前', '登壇者', 'name', 'fullname'],
    title: ['肩書き', '肩書', '役職', '職名', '職位', 'title', 'position', 'role'],
    org: ['所属', '組織', '団体', '会社', '会社名', '機関', '所属先', 'org', 'organization', 'company', 'affiliation']
  };

  function normalize(s) {
    return String(s).replace(/[\s\u3000"]/g, '').toLowerCase();
  }

  function detectHeader(row) {
    const idx = {};
    row.forEach(function (h, i) {
      const n = normalize(h);
      Object.keys(ALIASES).forEach(function (key) {
        if (idx[key] === undefined && ALIASES[key].indexOf(n) !== -1) idx[key] = i;
      });
    });
    return idx;
  }

  // rows → [{org, title, name}]
  function toSlips(rows) {
    if (!rows.length) return { slips: [], hasHeader: false };

    let idx = detectHeader(rows[0]);
    const hasHeader = idx.name !== undefined || idx.title !== undefined;
    let body = rows;

    if (hasHeader) {
      body = rows.slice(1);
    } else {
      idx = { name: 0, title: 1, org: 2 };
    }

    const get = function (r, k) {
      return idx[k] === undefined ? '' : (r[idx[k]] || '').trim();
    };

    const slips = body
      .map(function (r) { return { org: get(r, 'org'), title: get(r, 'title'), name: get(r, 'name') }; })
      .filter(function (s) { return s.org || s.title || s.name; });

    return { slips: slips, hasHeader: hasHeader };
  }

  // Excelで文字化けしないよう BOM 付き UTF-8
  function sampleCsv() {
    return '\uFEFF' + [
      '名前,肩書き,所属',
      '山田 太郎,代表取締役社長,株式会社サンプル',
      '佐藤 花子,取締役 最高技術責任者,株式会社サンプル',
      '鈴木 一郎,教授,サンプル大学 工学部',
      '"高橋 由美","広報部長","一般社団法人 サンプル協会"'
    ].join('\r\n') + '\r\n';
  }

  global.CSV = { decode: decode, parse: parse, toSlips: toSlips, sampleCsv: sampleCsv };
})(window);
