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
  let FONTS_READY = null;
  let LAYOUT_W = 880; // canvas width; measure/band keep it in sync
  function fontsReady() {
    // canvas fillText only sees fonts the document has actually LOADED;
    // KaTeX fonts sit at status 'unloaded' until first use → snapshot would
    // fall back to serif ('lo'->'b', thin 'l', lost sup glyphs). Force-load all.
    if (FONTS_READY) return FONTS_READY;
    const p = (document.fonts && document.fonts.load)
      ? Promise.all([
          document.fonts.load('400 20px KaTeX_Main', 'log2∫∑√xyz0123456789+-=().'),
          document.fonts.load('italic 400 20px KaTeX_Math', 'xyz∑∫0123'),
          document.fonts.load('400 20px KaTeX_Size1', '\u239B\u239D\u239E\u239F\u23A0\u23A1\u23A2\u23A3\u23A4\u23A5\u23A6\u23A7\u23A8\u23A9\u23AA\u23AB\u23AC\u23AD\u23A0'),
          document.fonts.load('400 20px KaTeX_Size2', '\u239B\u239D\u239E\u239F\u23A0\u23A1\u23A2\u23A3\u23A4\u23A5\u23A6\u23A7\u23A8\u23A9'),
          document.fonts.load('400 20px KaTeX_Size3', '\u0028\u0029'),
          document.fonts.load('400 20px KaTeX_Size4', '\u239C\u239F\u23A7\u23AA'),
          document.fonts.load('400 20px KaTeX_Caligraphic', 'AB'),
          document.fonts.load('400 20px KaTeX_Fraktur', 'AB'),
          document.fonts.load('400 20px KaTeX_SansSerif', 'AB'),
          document.fonts.load('400 20px KaTeX_Script', 'AB'),
          document.fonts.load('400 20px KaTeX_Typewriter', '0123'),
          document.fonts.load('400 20px KaTeX_AMS', 'RNOZQCZ'),
          document.fonts.load('600 20px KaTeX_Main', 'log234567890'),
        ]).catch(() => {})
      : Promise.resolve();
    FONTS_READY = Promise.race([p, new Promise((r) => setTimeout(r, 2500))]);
    return FONTS_READY;
  }

  async function atomSnapshot(root) {
    await fontsReady(); // canvas fillText needs loaded webfonts, serif fallback mangles KaTeX glyphs
    // Wide display roots (KaTeX .base{width:100%} fills the page cell: 1198px
    // on wide screens) blit crushed into the 880 canvas — 'numbers swim'.
    // KaTeX is pure CSS flow: relayout a clone in a canvas-width offscreen
    // container, snapshot THAT 1:1 — glyphs keep native size, no resample.
    let src = root, host = null;
    if (root.getBoundingClientRect().width > LAYOUT_W - 4) {
      const disp = root.closest('.katex-display') || root;
      host = root.ownerDocument.createElement('div');
      host.style.cssText = 'position:fixed;left:-100000px;top:0;width:' + LAYOUT_W +
        'px;margin:0;padding:0;visibility:hidden;pointer-events:none';
      host.appendChild(disp.cloneNode(true));
      (root.ownerDocument.body || document.documentElement).appendChild(host);
      src = (disp === root) ? host.firstChild : host.querySelector('.katex');
      if (!src) { host.remove(); host = null; src = root; }
    }
    // Content bounds via a pre-pass union of every drawn glyph/border/surd:
    // display-mode roots inflate to container width (KaTeX centers .base in a
    // wide .katex-html → canvas mostly whitespace, blits crushed), and .base's
    // border box does NOT include position:relative vlist overflow (numerator
    // sits at top:-18 and would be clipped away). Union of rects is the truth.
    const base = src.querySelector('.base') || src.querySelector('.vlist-r');
    const rt = src.getBoundingClientRect();
    let ux0 = Infinity, uy0 = Infinity, ux1 = -Infinity, uy1 = -Infinity, gn = 0;
    const mark = (r, tag) => {
      if (r.width < 0.4 || r.height < 0.3) return;
      ux0 = Math.min(ux0, r.left); uy0 = Math.min(uy0, r.top);
      ux1 = Math.max(ux1, r.right); uy1 = Math.max(uy1, r.bottom); gn++;
    };
    const tw0 = src.ownerDocument.createTreeWalker(src, 4, null); // text nodes only; mask 4|1 is flaky across worlds
    let nd;
    while ((nd = tw0.nextNode())) {
      const p = nd.parentElement;
      if (!p || p.closest('.katex-mathml') || p.closest('svg')) continue;
      if (!nd.nodeValue || !nd.nodeValue.trim()) continue;
      mark(p.getBoundingClientRect(), 'txt:'+p.tagName+'.'+String(p.className||'').split(' ')[0]);
    }
    for (const el of [src, ...src.querySelectorAll('*')]) {
      if (el.closest('.katex-mathml')) continue;
      const cls = el.classList;
      if (cls && (cls.contains('frac-line') || cls.contains('sqrt-main') ||
          cls.contains('sqrt-sign') || cls.contains('overline-line') ||
          cls.contains('double-line'))) mark(el.getBoundingClientRect(), 'cls:'+String(el.className).split(' ')[0]);
      const bw0 = num(csOf(el).borderBottomWidth);
      if (bw0 >= 0.5 && csOf(el).borderBottomStyle !== 'none') mark(el.getBoundingClientRect(), 'bord:'+el.tagName+'.'+String(el.className||'').split(' ')[0]);
      const tw0w = num(csOf(el).borderTopWidth);
      if (tw0w >= 0.5 && csOf(el).borderTopStyle !== 'none') mark(el.getBoundingClientRect(), 'bordT:'+el.tagName+'.'+String(el.className||'').split(' ')[0]);
      if (String(el.tagName).toLowerCase() === 'svg' && !el.closest('.katex-mathml')) mark(el.getBoundingClientRect(), 'svg');
    }
    const br = base ? base.getBoundingClientRect() : null;
    let rr;
    if (gn >= 2 && isFinite(ux0)) rr = { left: ux0 - 1, top: uy0 - 1, width: ux1 - ux0 + 2, height: uy1 - uy0 + 2 };
    else if (br && br.width > 1 && br.width <= rt.width + 1 && br.top < rt.bottom && br.bottom > rt.top) rr = br;
    else rr = rt;
    const w = Math.max(2, Math.ceil(rr.width)), h = Math.max(2, Math.ceil(rr.height));
    root.__snapW = w; root.__snapH = h;
    root.__snapBaseY = base
      ? Math.max(4, Math.round(base.getBoundingClientRect().bottom - rr.top))
      : Math.round(h * 0.72);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) { if (host) host.remove(); return Promise.resolve(); }
    ctx.textBaseline = 'top';
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    const doc = src.ownerDocument;
    const tw = doc.createTreeWalker(src, 4, null);
    let tn;
    while ((tn = tw.nextNode())) {
      const p = tn.parentElement;
      if (!p || p.closest('.katex-mathml') || p.closest('svg')) continue;
      const txt = tn.nodeValue;
      if (!txt || !txt.trim()) continue;
      // Range.getClientRects from a content-script world reports parent-relative
      // coords inside position:relative KaTeX vlists and glyphs overprint;
      // element.getBoundingClientRect() is page-absolute and trustworthy.
      const pr = p.getBoundingClientRect();
      if (pr.width < 0.5 || pr.height < 1.5) continue;
      const cs = csOf(p);
      const fs = num(cs.fontSize) || 14;
      ctx.font = (cs.fontStyle === 'italic' ? 'italic ' : '') +
        (cs.fontWeight || '400') + ' ' + fs + 'px ' + (cs.fontFamily || 'serif');
      ctx.fillStyle = cs.color || '#000';
      ctx.fillText(txt, Math.round(pr.left - rr.left), Math.round(pr.top - rr.top));
    }
    for (const el of [src, ...src.querySelectorAll('*')]) {
      if (el.closest('.katex-mathml')) continue;
      const cs = csOf(el);
      const bw = num(cs.borderBottomWidth);
      if (bw >= 0.5 && cs.borderBottomStyle !== 'none') {
        const r = el.getBoundingClientRect();
        if (r.width < 0.5) continue;
        ctx.fillStyle = cs.borderBottomColor || '#000';
        // nudge fraction bars 1px up so the denominator glyphs breathe
        ctx.fillRect(r.left - rr.left, r.bottom - rr.top - bw - 1, r.width, bw);
      }
      const tw2 = num(cs.borderTopWidth);
      if (tw2 >= 0.5 && cs.borderTopStyle !== 'none') {
        // sqrt vinculum (overline) is a border-TOP on .sqrt-main — skipping it
        // left roots with no bar over the radicand
        const r2 = el.getBoundingClientRect();
        if (r2.width >= 0.5) {
          ctx.fillStyle = cs.borderTopColor || '#000';
          ctx.fillRect(r2.left - rr.left, r2.top - rr.top, r2.width, tw2);
        }
      }
      if (String(el.tagName).toLowerCase() === 'svg') {
        const r = el.getBoundingClientRect();
        if (r.width < 0.5) continue;
        ctx.fillStyle = csOf(el.parentElement || el).color || '#000';
        ctx.font = Math.round(r.height * 0.95) + 'px serif';
        ctx.fillText('√', r.left - rr.left, r.top - rr.top);
      }
    }
    if (host) host.remove(); // offscreen clone consumed synchronously by the paint pass
    // Firefox taints drawImage sources from foreign origins: a content-world
    // canvas element and a data: URI image both poison the captureStream.
    // blob: (registered by the content world) is the proven-clean channel.
    return new Promise((res) => {
      c.toBlob((b) => {
        if (!b) return res();
        const u = URL.createObjectURL(b);
        const img = new Image();
        img.onload = () => { root.__snap = img; URL.revokeObjectURL(u);
          if (location.hostname === 'localhost')
            document.documentElement.dataset.kpSnapDone = ((document.documentElement.dataset.kpSnapDone || 0) * 1 + 1) + '';
          try {
            if (location.hostname === 'localhost' && w <= 140 && h <= 80) {
              const dc = c.getContext('2d'); const dd = dc.getImageData(0, 0, w, h).data;
              const rs = [];
              for (let y = 0; y < h; y++) { let n = 0, xa = 9999, xb = -1;
                for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (dd[i + 3] > 40) { n++; if (x < xa) xa = x; if (x > xb) xb = x; } }
                if (n) rs.push(y + ':' + n + ':' + xa + '-' + xb); }
              document.documentElement.dataset.kpSnapDump = w + 'x' + h + 'b' + root.__snapBaseY + '|' + rs.join(';');
            }
          } catch (e) { document.documentElement.dataset.kpSnapDump = 'DERR' + (e.message || e).slice(0, 30); }
          res(); };
        img.onerror = () => res();
        img.src = u;
      }, 'image/png');
    });
  }

  const katexSnapshot = (k) => {
    try {
      if (location.hostname === 'localhost') {
        const r = k.getBoundingClientRect();
        document.documentElement.dataset.kpSnapLog =
          (document.documentElement.dataset.kpSnapLog || '') + Math.round(r.width) + 'x' + Math.round(r.height) + ' ';
      }
    } catch (e) {
      document.documentElement.dataset.kpSnapLog =
        (document.documentElement.dataset.kpSnapLog || '') + 'ERR:' + String(e && e.message || e).slice(0, 60) + ' ';
      return Promise.resolve();
    }
    const p = (() => {
      try { return atomSnapshot(k); } catch (e) {
        document.documentElement.dataset.kpSnapLog =
          (document.documentElement.dataset.kpSnapLog || '') + 'SYNC-THROW:' +
          String(e && e.message || e).slice(0, 80) + '@' + String(e && e.stack || '').split('\n')[1].trim().slice(0, 50) + ' ';
        return Promise.resolve();
      }
    })();
    Promise.resolve(p).catch((e) => {
      document.documentElement.dataset.kpSnapLog =
        (document.documentElement.dataset.kpSnapLog || '') + 'REJ:' + String(e && e.message || e).slice(0, 60) + ' ';
    });
    return p;
  };

  function preload(el) {
    const tryLoad = (im, u) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { im.__bmp = img; im.__w = img.naturalWidth; im.__h = img.naturalHeight; im.__ok = true; im.__fs = 'direct'; res(); };
      img.onerror = () => rej(new Error('img-load-fail'));
      img.src = u;
    });
    const list = [...el.querySelectorAll('img')].map(async (im) => {
      const src = im.currentSrc || im.src;
      if (!sameOrigin(src)) { im.__tainted = true; return; } // drawing it kills the PiP stream
      // 1) content-world direct Image (respects extension CSP)
      try { await tryLoad(im, src); return; } catch (e) { im.__err = String((e && e.message) || e).slice(0, 30); }
      // 2) page <img> itself: if the page already loaded it (non-lazy), drawing
      //    the element works for same-origin — the pixels live on the page side
      if (im.complete && im.naturalWidth) {
        im.__w = im.naturalWidth; im.__h = im.naturalHeight; im.__ok = true; im.__fs = 'page-el';
      }
    });
    const kx = [...el.querySelectorAll('.katex')].map((k) => katexSnapshot(k));
    // images: race the timeout (placeholder is an acceptable outcome).
    // katex snapshots: NEVER race — 21-atom tasks exceeded 3.5s and painted
    // textContent fallback ('217220+218'). Expose them as preload.snaps.
    Promise.all(list).catch(() => {});
    const snaps = Promise.all(kx.map((p) => Promise.resolve(p).catch(() => {})));
    preload.snaps = snaps;
    return Promise.race([Promise.all(list), new Promise((r) => setTimeout(r, 3500))]);
  }

  function painter(ctx, W) {
    const M = { x0: 0, x: 0, y: 0, lh: 0, base: 0, lineTop: 0 };
    let sctx = null;
    const scratch = () => {
      // measurement-only surface: nested cell layout must never touch the
      // real band canvas (fillText at y~0 would overpaint the top rows)
      if (!sctx) {
        const c = document.createElement('canvas');
        c.width = W; c.height = 16;
        sctx = c.getContext('2d');
        if (sctx) sctx.textBaseline = 'top';
      }
      return sctx || ctx;
    };

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
      if (location.hostname === 'localhost')
        document.documentElement.dataset.kpSnapProbe = (e.__snapW || '?') + 'x' + (e.__snapH || '?') + (e.__snap ? '+img' : '-img') + ' ';
      if (!e.__snap || !w0) {
        const t = ((e.querySelector('.katex-html') || e).textContent || '').replace(/\s+/g, ' ').trim();
        if (t) for (const p2 of t.split(' ')) word(p2, csOf(e));
        return;
      }
      const dw = Math.round(Math.min(w0, W)), dh = Math.round(h0 * dw / w0);
      const baseY = Math.round((e.__snapBaseY || h0 * 0.75) * dw / w0);
      if (M.x > M.x0 && M.x + dw > M.x0 + W) flush();
      const fresh = M.x === M.x0;
      // integer destination = 1:1 pixel blit: no resample, no glyph blur
      const dx = Math.round(M.x);
      const yTop = Math.round(fresh ? M.y : M.y + Math.max(M.base, 12) - baseY);
      try { ctx.drawImage(e.__snap, dx, yTop, dw, dh); } catch (_) {}
      M.x = dx + dw + 2;
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
        ctx.fillStyle = '#f4f0dc'; ctx.fillRect(M.x, M.y, Math.max(wantW, 140), 22);
        ctx.fillStyle = '#876'; ctx.font = '13px sans-serif';
        ctx.fillText('[картинка: ' + (e.__err || (e.__ok ? 'ok?' : 'нет данных')) + ']', M.x + 4, M.y + 4);
      }
      if (wBig) { M.x = M.x0; M.y += (e.__ok ? h : 22) + 10; M.lh = 0; }
      else { M.x += wantW + 6; M.lh = Math.max(M.lh, e.__ok ? h : 22); }
    }

    function measureCell(e, x0) {
      // REAL layout in a scratch painter (nested tables included): char-count
      // heuristics under-count and rows overlap once a cell contains a table
      return painter(scratch(), W).cellH(e, x0) + 8;
    }

    function table(e) {
      flush();
      const rows = [...e.querySelectorAll('tr')].filter(r => r.closest('table') === e);
      let maxCols = 1;
      rows.forEach(r => { maxCols = Math.max(maxCols, r.cells.length); });
      const x = M.x, x0save = M.x0;
      const colW = (M.x0 + W - x) / maxCols;
      for (const r of rows) {
        let cellH = 10;
        for (let c = 0; c < maxCols; c++)
          if (r.cells[c]) cellH = Math.max(cellH, measureCell(r.cells[c], x + c * colW + 5));
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
      M.y += 10; M.x = x; M.x0 = x0save; M.lh = 0;
    }

    function pre(e, css) {
      flush();
      const fs = num(css.fontSize) || 14;
      ctx.font = `${fs}px monospace`;
      ctx.fillStyle = css.color;
      const wmax = Math.max(24, W - M.x0 - 4);
      for (const raw of (e.textContent || '').split('\n')) {
        let ln = raw, guard = 0;
        // hard-wrap long code lines at any char (pre blocks scroll on the page,
        // in a canvas window they must wrap: clipped code is broken code)
        while (ctx.measureText(ln).width > wmax && ln.length > 1 && guard++ < 5000) {
          let lo = 1, hi = ln.length;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (ctx.measureText(ln.slice(0, mid)).width <= wmax) lo = mid; else hi = mid - 1;
          }
          if (lo < 3) lo = Math.min(12, ln.length); // cell narrower than ~3 glyphs: hard-cut (guarantees net -10 chars/iter, no infinite loop)
          ctx.fillText(ln.slice(0, lo), M.x, M.y);
          M.y += fs * 1.3;
          ln = '  ' + ln.slice(lo);
        }
        ctx.fillText(ln, M.x, M.y);
        M.y += fs * 1.3;
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
      cellH(e, x0, yStart = 0) {
        M.x0 = x0; M.x = x0; M.y = yStart; M.lh = 0; M.base = 0; M.lineTop = yStart;
        walk(e); flush();
        return M.y - yStart;
      },
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
    if (W) LAYOUT_W = W;
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
    if (W) LAYOUT_W = W;
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
