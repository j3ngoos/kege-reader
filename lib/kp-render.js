/* kompege-pip mini-renderer: task DOM -> canvas (content-script world).
   Real inline text flow (words across lines, inline spans, sup/sub, KaTeX
   spans), blocks, tables, lists, images. Canvas height = painted height. */
'use strict';
const KP = (function () {
  const num = (s) => parseFloat(s) || 0;
  const BLOCK = /^(DIV|P|H[1-6]|UL|OL|SECTION|ARTICLE|BLOCKQUOTE|TABLE|PRE|TR|FORM|HEADER|FOOTER|NAV|ASIDE|CENTER|FIELDSET|FIGURE|DL|DD|DT|HR|TBODY|THEAD|LI)$/;
  const MAX_H = 30000;

  function visible(e, cs) {
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== 0 &&
      !['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'].includes(e.tagName);
  }
  const isBlock = (e, cs) =>
    (BLOCK.test(e.tagName) && cs.display !== 'inline') ||
    cs.display === 'block' || cs.display === 'list-item' ||
    cs.display === 'flex' || cs.display === 'grid' || cs.display === 'table';

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
    return Promise.race([Promise.all(list), new Promise((r) => setTimeout(r, 1500))]);
  }

  function painter(ctx, W) {
    const M = { x0: 0, x: 0, y: 0, lh: 0 };

    const setFont = (css, mul) => {
      const fs = (num(css.fontSize) || 16) * (mul || 1);
      ctx.font = `${css.fontStyle === 'italic' ? 'italic ' : ''}${css.fontWeight} ${fs}px ${css.fontFamily}`;
      return fs;
    };
    const flush = () => { M.x = M.x0; M.y += Math.max(M.lh, 8) * 1.22; M.lh = 0; };
    const space = (css) => { setFont(css); return ctx.measureText(' ').width; };

    function word(str, css) {
      const baseFs = num(css.fontSize) || 16;
      const va = css.verticalAlign || '';
      let dy = 0, mul = 1;
      if (va === 'super') { dy = -baseFs * 0.45; mul = 0.68; }
      else if (va === 'sub') { dy = baseFs * 0.22; mul = 0.68; }
      else if (/^-?[\d.]+(px|em)$/.test(va)) { dy = /em$/.test(va) ? num(va) * baseFs : num(va); }
      // KaTeX shifts sup/sub with position:relative + top offset (huge em values)
      if (css.position === 'relative' && css.top && css.top !== 'auto') {
        const shift = num(css.top) * 0.7;
        dy += Math.max(-11, Math.min(5, shift));
      }
      const fs = setFont(css, mul);
      const ww = ctx.measureText(str).width;
      if (M.x > M.x0 && M.x + ww > M.x0 + W) flush();
      ctx.fillStyle = css.color;
      ctx.fillText(str, M.x, M.y + dy);
      M.x += ww + space(css) * mul;
      M.lh = Math.max(M.lh, fs * (mul < 1 ? 1 : 1.15));
    }

    function inlineImg(e, css) {
      const wantW = Math.min(num(css.width) || 80, W);
      const h = wantW * ((e.__h || 1) / (e.__w || 1));
      const wBig = wantW > W * 0.6 || h > 200;
      if (wBig) flush();
      else if (M.x > M.x0 && M.x + wantW > M.x0 + W) flush();
      if (e.__ok) {
        try { ctx.drawImage(e, M.x, M.y, wantW, h); } catch (_) {}
      } else {
        ctx.fillStyle = '#999'; ctx.font = '13px sans-serif';
        ctx.fillText('[изображение]', M.x, M.y);
      }
      if (wBig) { M.x = M.x0; M.y += h + 10; M.lh = 0; }
      else { M.x += wantW + 6; M.lh = Math.max(M.lh, h); }
    }

    function measureCell(e, w) {
      const cs = getComputedStyle(e);
      const fs = num(cs.fontSize) || 15;
      const per = Math.max(4, w / (fs * 0.55));
      const t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      return Math.max(1, Math.ceil(t.length / per)) * fs * 1.3 + 12;
    }

    function table(e) {
      flush();
      const rows = [...e.querySelectorAll('tr')].filter(r => r.closest('table') === e);
      let maxCols = 1;
      rows.forEach(r => { maxCols = Math.max(maxCols, r.cells.length); });
      const x = M.x;
      const colW = (M.x0 + W - x) / maxCols;
      for (const r of rows) {
        let cellH = 10;
        for (let c = 0; c < maxCols; c++)
          if (r.cells[c]) cellH = Math.max(cellH, measureCell(r.cells[c], colW - 10));
        ctx.fillStyle = '#fff'; ctx.fillRect(x, M.y, colW * maxCols, cellH);
        ctx.strokeStyle = '#c9c9c9';
        for (let c = 0; c < maxCols; c++) ctx.strokeRect(x + c * colW, M.y, colW, cellH);
        for (let c = 0; c < Math.min(r.cells.length, maxCols); c++) {
          const save = { ...M };
          M.x0 = x + c * colW + 5; M.x = M.x0; M.y += 4; M.lh = 0;
          walk(r.cells[c]);
          M.x = save.x; M.y = save.y; M.lh = 0;
        }
        M.y += cellH;
      }
      M.y += 10; M.x = M.x0; M.lh = 0;
    }

    function pre(e, css) {
      flush();
      const fs = num(css.fontSize) || 14;
      ctx.font = `${fs}px monospace`;
      ctx.fillStyle = css.color;
      for (const ln of (e.textContent || '').split('\n')) {
        ctx.fillText(ln, M.x, M.y); M.y += fs * 1.3;
      }
      M.x = M.x0; M.lh = 0; M.y += 8;
    }

    function block(e, cs) {
      if (M.x > M.x0) flush();
      if (e.tagName === 'HR') {
        ctx.strokeStyle = '#bbb';
        ctx.beginPath(); ctx.moveTo(M.x, M.y + 6); ctx.lineTo(M.x0 + W, M.y + 6); ctx.stroke();
        M.y += 14; return;
      }
      if (e.tagName === 'TABLE') { table(e); return; }
      if (e.tagName === 'PRE') { pre(e, cs); return; }
      if (e.tagName === 'IMG') { inlineImg(e, cs); return; }

      M.y += num(cs.marginTop);
      const pad = num(cs.paddingLeft) + num(cs.borderLeftWidth);
      const bullet = cs.display === 'list-item' && cs.listStyleType !== 'none';
      const indent = bullet ? Math.max(pad, 16) : pad;
      if (num(cs.borderLeftWidth) > 1 && cs.borderLeftStyle !== 'none' &&
          cs.borderLeftStyle !== 'hidden') {
        ctx.strokeStyle = cs.borderLeftColor;
        ctx.beginPath();
        ctx.moveTo(M.x + pad / 2, M.y); ctx.lineTo(M.x + pad / 2, M.y + 40);
        ctx.stroke();
      }
      const savedX0 = M.x0;
      M.x0 = M.x + indent; M.x = M.x0;
      if (bullet) {
        const fs = num(cs.fontSize) || 15;
        ctx.fillStyle = cs.color; ctx.font = `${fs}px sans-serif`;
        ctx.fillText('•', M.x0 - indent + 3, M.y);
      }
      walkChildren(e);
      M.x0 = savedX0; M.x = M.x0;
      flush();
      M.y += num(cs.marginBottom) + num(cs.paddingBottom);
    }

    function walkChildren(e) {
      const cs = getComputedStyle(e);
      for (const n of e.childNodes) {
        if (n.nodeType === 3) {
          for (const p of (n.nodeValue || '').split(/(\s+)/)) {
            if (!p) continue;
            if (/^\s+$/.test(p)) { if (M.x > M.x0) M.x += space(cs); }
            else word(p, cs);
          }
        } else walk(n);
      }
    }

    function walk(e) {
      const cs = getComputedStyle(e);
      if (!visible(e, cs)) return;
      const tag = e.tagName;
      if (tag === 'BR') { flush(); return; }
      if (tag === 'IMG') { inlineImg(e, cs); return; }
      if (isBlock(e, cs)) { block(e, cs); return; }
      for (const n of e.childNodes) {
        if (n.nodeType === 3) {
          for (const p of (n.nodeValue || '').split(/(\s+)/)) {
            if (!p) continue;
            if (/^\s+$/.test(p)) { if (M.x > M.x0) M.x += space(cs); }
            else word(p, cs);
          }
        } else walk(n);
      }
    }

    return {
      rootAt(e, yStart) { M.x0 = 0; M.x = 0; M.y = yStart; M.lh = 0; walk(e); flush(); return M.y + 16; },
    };
  }

  function render(el, opts) {
    const W = opts.width || 880;
    const scale = opts.scale || 1;
    return preload(el).then(() => {
      const H = measureCanvas(el, W);
      const cv = document.createElement('canvas');
      cv.width = Math.round(W * scale);
      cv.height = Math.round(H * scale);
      const ctx = cv.getContext('2d');
      ctx.scale(scale, scale);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.textBaseline = 'top';
      painter(ctx, W).rootAt(el, 12);
      return cv;
    });
  }

  /* layout-only pass: small canvas, fillText off-canvas is free */
  function measure(el, W) {
    const c = document.createElement('canvas');
    c.width = W; c.height = 16;
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    ctx.textBaseline = 'top';
    return Math.ceil(painter(ctx, W || 880).rootAt(el, 12));
  }

  /* render a viewport band [yTop, yTop+h] of the laid-out task onto a small
     canvas (Firefox caps canvas area ~12.5M px — never make huge canvases) */
  function band(el, W, yTop, h) {
    const c = document.createElement('canvas');
    c.width = W; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, h);
    const end = painter(ctx, W).rootAt(el, -yTop + 4);
    return { canvas: c, total: Math.ceil(end + yTop) };
  }

  function measureCanvas(el, W) {
    return Math.min(measure(el, W), 30000);
  }

  return { render, measure, band, preload };
})();
window.KP = KP;
