/* kompege-pip mini-renderer: task DOM -> canvas (content-script world).
   Real inline text flow (words across lines, inline spans, sup/sub, KaTeX
   spans), blocks, tables, lists, images. Canvas height = painted height. */
'use strict';
const KP = (function () {
  const num = (s) => parseFloat(s) || 0;
  const BLOCK = /^(DIV|P|H[1-6]|UL|OL|SECTION|ARTICLE|BLOCKQUOTE|TABLE|PRE|TR|FORM|HEADER|FOOTER|NAV|ASIDE|CENTER|FIELDSET|FIGURE|DL|DD|DT|HR|TBODY|THEAD|LI)$/;
  const MAX_H = 30000;

  /* styles must be resolved by the element's OWN window (iframe-safe):
     parent-window getComputedStyle on an iframe element throws
     "parameter 1 is not of type 'Element'" in Firefox */
  const DEFAULT_CS = {
    display: 'inline', visibility: 'visible', opacity: '1', color: '#000',
    fontFamily: 'sans-serif', fontSize: '16px', lineHeight: 'normal',
    fontStyle: 'normal', fontWeight: '400', verticalAlign: 'baseline',
    position: 'static', top: '0px', textAlign: 'left', width: 'auto',
    paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px',
    borderLeftStyle: 'none', borderLeftWidth: '0px', borderColor: '#000',
    listStyleType: 'none', textDecoration: 'none none'
  };
  const FAKE_CS = new Proxy({}, {
    get: (t, k) =>
      k === 'getPropertyValue' ? () => '' : (k in DEFAULT_CS ? DEFAULT_CS[k] : '0px')
  });

  const csOf = (e) => {
    if (!e || e.nodeType !== 1) return FAKE_CS;
    const d = e.ownerDocument;
    const w = d && d.defaultView;
    if (!w) return FAKE_CS;
    try {
      return w.getComputedStyle(e);
    } catch (err) {
      // cross-document/sandbox edge: default styles are better than a dead frame
      document.documentElement.dataset.kpCsFail =
        String(err && err.message || err).slice(0, 120);
      return FAKE_CS;
    }
  };

  function visible(e, cs) {
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== 0 &&
      !['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT'].includes(e.tagName);
  }
  const isBlock = (e, cs) =>
    (BLOCK.test(e.tagName) && cs.display !== 'inline') ||
    cs.display === 'block' || cs.display === 'list-item' ||
    cs.display === 'flex' || cs.display === 'grid' || cs.display === 'table';

  function sameOrigin(src) {
    try { return new URL(src, location.href).origin === location.origin; }
    catch { return false; }
  }

  /* ---- KaTeX: render each .katex as an ATOMIC canvas snapshot built from the
     browser's OWN layout rects (text runs + fraction lines + surds).
     Descent into KaTeX's nested inline-blocks flattens vertical-align and the
     numbers "swim"; SVG foreignObject snapshots TAINt the canvas in Firefox.
     A rect-based canvas keeps geometry exact and the captureStream clean. */
  function atomSnapshot(root) {
    const rr = root.getBoundingClientRect();
    const w = Math.max(2, Math.ceil(rr.width)), h = Math.max(2, Math.ceil(rr.height));
    root.__snapW = w; root.__snapH = h;
    const base = root.querySelector('.base') || root.querySelector('.vlist-r');
    root.__snapBaseY = base
      ? Math.max(4, Math.round(base.getBoundingClientRect().bottom - rr.top))
      : Math.round(h * 0.72);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return Promise.resolve();
    ctx.textBaseline = 'top';
    const doc = root.ownerDocument;
    const range = doc.createRange();
    const tw = doc.createTreeWalker(root, 4, null);
    let tn;
    while ((tn = tw.nextNode())) {
      const p = tn.parentElement;
      if (!p || p.closest('.katex-mathml') || p.closest('svg')) continue;
      const txt = tn.nodeValue;
      if (!txt || !txt.trim()) continue;
      range.selectNodeContents(tn);
      const rects = range.getClientRects();
      const cs = csOf(p);
      const fs = num(cs.fontSize) || 14;
      ctx.font = (cs.fontStyle === 'italic' ? 'italic ' : '') +
        (cs.fontWeight || '400') + ' ' + fs + 'px ' + (cs.fontFamily || 'serif');
      ctx.fillStyle = cs.color || '#000';
      for (const r of rects) {
        if (r.width < 0.5 || r.height < 1.5) continue;
        ctx.fillText(txt, Math.round(r.left - rr.left), Math.round(r.top - rr.top));
      }
    }
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (el.closest('.katex-mathml')) continue;
      const cs = csOf(el);
      const bw = num(cs.borderBottomWidth);
      if (bw >= 0.5 && cs.borderBottomStyle !== 'none') {
        const r = el.getBoundingClientRect();
        if (r.width < 0.5) continue;
        ctx.fillStyle = cs.borderBottomColor || '#000';
        ctx.fillRect(r.left - rr.left, r.bottom - rr.top - bw, r.width, bw);
      }
      if (String(el.tagName).toLowerCase() === 'svg') {
        const r = el.getBoundingClientRect();
        if (r.width < 0.5) continue;
        ctx.fillStyle = csOf(el.parentElement || el).color || '#000';
        ctx.font = Math.round(r.height * 0.95) + 'px serif';
        ctx.fillText('√', r.left - rr.left, r.top - rr.top);
      }
    }
    // Firefox taints drawImage sources from foreign origins: a content-world
    // canvas element and a data: URI image both poison the captureStream.
    // blob: (registered by the content world) is the proven-clean channel.
    return new Promise((res) => {
      c.toBlob((b) => {
        if (!b) return res();
        const u = URL.createObjectURL(b);
        const img = new Image();
        img.onload = () => { root.__snap = img; URL.revokeObjectURL(u); res(); };
        img.onerror = () => res();
        img.src = u;
      }, 'image/png');
    });
  }

  const katexSnapshot = atomSnapshot;

  function preload(el) {
    const list = [...el.querySelectorAll('img')].map(async (im) => {
      const src = im.currentSrc || im.src;
      try {
        // fetch the bytes: drawing the fetched copy keeps the canvas UNTAINTED
        // (drawImage of the page <img> taints the canvas on cross-origin src,
        //  which kills canvas.captureStream — PiP freezes on the last frame)
        const r = await fetch(src, { cache: 'force-cache' });
        if (!r.ok) throw new Error('http ' + r.status);
        const bmpUrl = URL.createObjectURL(await r.blob());
        const img = new Image();
        await new Promise((res, rej) => {
          img.onload = () => res(); img.onerror = rej; img.src = bmpUrl;
        });
        URL.revokeObjectURL(bmpUrl);
        im.__bmp = img;
        im.__w = img.naturalWidth; im.__h = img.naturalHeight; im.__ok = true;
      } catch (e) {
        if (sameOrigin(src) && im.complete && im.naturalWidth) {
          im.__w = im.naturalWidth; im.__h = im.naturalHeight; im.__ok = true;
        } else {
          im.__tainted = true; // never draw: taint kills the PiP stream
        }
      }
    });
    const kx = [...el.querySelectorAll('.katex')].map((k) => katexSnapshot(k));
    return Promise.race([Promise.all([...list, ...kx]), new Promise((r) => setTimeout(r, 3500))]);
  }

  function painter(ctx, W) {
    const M = { x0: 0, x: 0, y: 0, lh: 0, base: 0, lineTop: 0 };

    const setFont = (css, mul) => {
      const fs = (num(css.fontSize) || 16) * (mul || 1);
      ctx.font = `${css.fontStyle === 'italic' ? 'italic ' : ''}${css.fontWeight} ${fs}px ${css.fontFamily}`;
      return fs;
    };
    const flush = () => { M.x = M.x0; M.y += Math.max(M.lh, 8) * 1.22; M.lh = 0; M.base = 0; M.lineTop = M.y; };
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
      M.lh = Math.max(M.lh, fs * (mul < 1 ? 1 : 1.15) + (dy < 0 ? -dy : 0));
      M.base = Math.max(M.base, fs * 0.78 + Math.max(0, dy));
    }

    function katexBox(e) {
      const w0 = e.__snapW || 0, h0 = e.__snapH || 0;
      if (!e.__snap || !w0) {
        const t = ((e.querySelector('.katex-html') || e).textContent || '').replace(/\s+/g, ' ').trim();
        if (t) for (const p2 of t.split(' ')) word(p2, csOf(e));
        return;
      }
      const dw = Math.min(w0, W), dh = Math.round(h0 * dw / w0);
      const baseY = Math.round((e.__snapBaseY || h0 * 0.75) * dw / w0);
      if (M.x > M.x0 && M.x + dw > M.x0 + W) flush();
      const fresh = M.x === M.x0;
      const yTop = fresh ? M.y : M.y + Math.max(M.base, 12) - baseY;
      try { ctx.drawImage(e.__snap, M.x, yTop, dw, dh); } catch (_) {}
      M.x += dw + 2;
      M.base = Math.max(M.base, baseY);
      M.lh = Math.max(M.lh, yTop + dh - M.y, 14);
    }

    function inlineImg(e, css) {
      const wantW = Math.min(num(css.width) || 80, W);
      const h = wantW * ((e.__h || 1) / (e.__w || 1));
      const wBig = wantW > W * 0.6 || h > 200;
      if (wBig) flush();
      else if (M.x > M.x0 && M.x + wantW > M.x0 + W) flush();
      if (e.__bmp) {
        try { ctx.drawImage(e.__bmp, M.x, M.y, wantW, h); } catch (_) {}
      } else if (e.__ok && !e.__tainted) {
        try { ctx.drawImage(e, M.x, M.y, wantW, h); } catch (_) {}
      } else {
        ctx.fillStyle = '#f4f0dc'; ctx.fillRect(M.x, M.y, Math.max(wantW, 90), 22);
        ctx.fillStyle = '#876'; ctx.font = '13px sans-serif';
        ctx.fillText('[картинка опущена]', M.x + 4, M.y + 4);
      }
      if (wBig) { M.x = M.x0; M.y += (e.__ok ? h : 22) + 10; M.lh = 0; }
      else { M.x += wantW + 6; M.lh = Math.max(M.lh, e.__ok ? h : 22); }
    }

    function measureCell(e, w) {
      const cs = csOf(e);
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
      const cs = csOf(e);
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
      const cs = csOf(e);
      if (!visible(e, cs)) return;
      const tag = e.tagName;
      if (tag === 'BR') { flush(); return; }
      if (tag === 'IMG') { inlineImg(e, cs); return; }
      if (tag === 'SPAN' && String(e.className || '').includes('katex')) { katexBox(e); return; }
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
