/* kompege-pip mini-renderer: task DOM -> canvas (content-script world).
   Enough of html2canvas for the job: text wrapping, lists, tables, images. */
'use strict';
const KP = (function () {
  const num = (s) => parseFloat(s) || 0;

  function visible(e, cs) {
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== 0 &&
      !['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'].includes(e.tagName);
  }

  function preload(el) {
    const list = [...el.querySelectorAll('img')].map((im) => {
      const img = new Image();
      const p = new Promise((r) => {
        img.onload = () => { im.__w = img.naturalWidth; im.__h = img.naturalHeight; im.__ok = true; r(); };
        img.onerror = () => r();
      });
      img.src = im.currentSrc || im.src;
      return p;
    });
    return Promise.race([
      Promise.all(list),
      new Promise((r) => setTimeout(r, 1500))
    ]);
  }

  function render(el, opts) {
    const W = opts.width || 880;
    const scale = opts.scale || 1;

    const clone = el.cloneNode(true);
    const host = document.createElement('div');
    Object.assign(host.style, {
      position: 'fixed', left: '-10000px', top: '0',
      width: W + 'px', overflow: 'visible',
      background: '#fff', color: '#111',
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '16px'
    });
    host.appendChild(clone);
    document.body.appendChild(host);
    const H = Math.min(9000, Math.ceil(host.getBoundingClientRect().height + 40));

    const cv = document.createElement('canvas');
    cv.width = Math.round(W * scale);
    cv.height = Math.round(H * scale);
    const ctx = cv.getContext('2d');
    ctx.scale(scale, scale);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'top';

    const fontOf = (css) =>
      `${css.fontStyle === 'italic' ? 'italic ' : ''}${css.fontWeight} ${num(css.fontSize) || 16}px ${css.fontFamily}`;

    function paintText(node, css, x, y, w) {
      const text = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!text) return y;
      const fs = num(css.fontSize) || 16;
      ctx.font = fontOf(css);
      ctx.fillStyle = css.color;
      const lh = num(css.lineHeight) || Math.round(fs * 1.4);
      let line = '';
      for (const word of text.split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > w && line) {
          ctx.fillText(line, x, y);
          y += lh;
          line = word;
        } else line = test;
      }
      if (line) { ctx.fillText(line, x, y); y += lh; }
      return y;
    }

    function rowHeight(row, colW) {
      const fs = 15;
      let maxLines = 1;
      for (const c of row.cells) {
        const t = (c.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t) continue;
        const perLine = Math.max(4, (colW - 8) / (fs * 0.52));
        maxLines = Math.max(maxLines, Math.ceil(t.length / perLine));
      }
      return maxLines * fs * 1.4 + 10;
    }

    const BLOCK = /^(DIV|P|H[1-6]|UL|OL|LI|SECTION|ARTICLE|BLOCKQUOTE|TR)$/;

    function paint(e, x, y, w) {
      const cs = getComputedStyle(e);
      if (!visible(e, cs)) return y;
      const tag = e.tagName;
      if (tag === 'BR') return y + (num(cs.fontSize) || 16);

      if (tag === 'IMG') {
        const targetW = Math.min(num(cs.width) || w, w);
        if (e.__ok) {
          const h = Math.min(620, targetW * ((e.__h || 1) / (e.__w || 1)));
          try { ctx.drawImage(e, x, y, targetW, h); } catch (_) { /* tainted */ }
          return y + h + 8;
        }
        ctx.fillStyle = '#999';
        ctx.font = '13px sans-serif';
        ctx.fillText('[изображение]', x, y + 4);
        return y + 24;
      }

      if (tag === 'TABLE') {
        const rows = [...e.querySelectorAll('tr')].filter(r => r.closest('table') === e);
        let maxCols = 1;
        rows.forEach(r => { maxCols = Math.max(maxCols, r.cells.length); });
        const colW = w / maxCols;
        let yy = y + 4;
        for (const r of rows) {
          const cellH = rowHeight(r, colW);
          ctx.fillStyle = '#fff';
          ctx.fillRect(x, yy, w, cellH);
          ctx.strokeStyle = '#c9c9c9';
          for (let c = 0; c < maxCols; c++) ctx.strokeRect(x + c * colW, yy, colW, cellH);
          for (let c = 0; c < Math.min(r.cells.length, maxCols); c++)
            paint(r.cells[c], x + c * colW + 5, yy + 4, colW - 10);
          yy += cellH;
        }
        return yy + 8;
      }

      if (tag === 'PRE') {
        const fs = num(cs.fontSize) || 14;
        ctx.font = `${fs}px monospace`;
        ctx.fillStyle = cs.color;
        let yy = y;
        for (const ln of (e.textContent || '').split('\n')) { ctx.fillText(ln, x, yy); yy += fs * 1.3; }
        return yy + 6;
      }

      const isBlock = BLOCK.test(tag) || cs.display === 'block';
      let yy = y + (isBlock ? num(cs.marginTop) : 0);
      const pad = num(cs.paddingLeft) + num(cs.borderLeftWidth);
      const bw = Math.max(20, w - pad - num(cs.paddingRight) - num(cs.borderRightWidth));

      for (const child of e.childNodes) {
        if (child.nodeType === 3) {
          yy = paintText(child, cs, x + pad, yy, bw);
        } else if (child.nodeType === 1) {
          yy = paint(child, x + pad, yy, bw);
          const ccs = getComputedStyle(child);
          if (BLOCK.test(child.tagName) || ccs.display === 'block')
            yy += num(ccs.marginBottom) || (child.tagName === 'P' ? 12 : 5);
        }
      }
      if (isBlock) yy += num(cs.paddingBottom) + num(cs.marginBottom);
      return yy;
    }

    return preload(el).then(() => {
      paint(el, 0, 8, W);
      host.remove();
      return cv;
    });
  }

  return { render };
})();
window.KP = KP;
