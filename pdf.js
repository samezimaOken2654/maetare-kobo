/* 前タレ工房 — pdf.js
   外部ライブラリなしで「1ページ=1枚のJPEG画像」のPDFを組み立てる。
   pages: [{ jpeg: Uint8Array, wPx, hPx, wPt, hPt }] */
(function (global) {
  'use strict';

  const enc = new TextEncoder();

  function fmt(n) { return (Math.round(n * 100) / 100).toString(); }

  function build(pages) {
    const chunks = [];
    let offset = 0;
    const offsets = [];

    function push(d) {
      const u = typeof d === 'string' ? enc.encode(d) : d;
      chunks.push(u);
      offset += u.length;
    }

    function object(num, writeBody) {
      offsets[num] = offset;
      push(num + ' 0 obj\n');
      writeBody();
      push('\nendobj\n');
    }

    const n = pages.length;
    const total = 2 + 3 * n; // 1:Catalog 2:Pages 以降 ページ・内容・画像 の3つ組

    push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');

    object(1, function () { push('<< /Type /Catalog /Pages 2 0 R >>'); });

    object(2, function () {
      const kids = pages.map(function (_, i) { return (3 + 3 * i) + ' 0 R'; }).join(' ');
      push('<< /Type /Pages /Kids [' + kids + '] /Count ' + n + ' >>');
    });

    pages.forEach(function (p, i) {
      const pageNo = 3 + 3 * i;
      const contentNo = pageNo + 1;
      const imageNo = pageNo + 2;

      object(pageNo, function () {
        push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + fmt(p.wPt) + ' ' + fmt(p.hPt) + '] ' +
          '/Resources << /XObject << /Im0 ' + imageNo + ' 0 R >> >> /Contents ' + contentNo + ' 0 R >>');
      });

      object(contentNo, function () {
        const content = 'q ' + fmt(p.wPt) + ' 0 0 ' + fmt(p.hPt) + ' 0 0 cm /Im0 Do Q';
        push('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
      });

      object(imageNo, function () {
        push('<< /Type /XObject /Subtype /Image /Width ' + p.wPx + ' /Height ' + p.hPx +
          ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.jpeg.length + ' >>\nstream\n');
        push(p.jpeg);
        push('\nendstream');
      });
    });

    const xrefOffset = offset;
    let xref = 'xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n';
    for (let i = 1; i <= total; i++) {
      xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    push(xref);
    push('trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n');

    return new Blob(chunks, { type: 'application/pdf' });
  }

  global.PDFWriter = { build: build };
})(window);
