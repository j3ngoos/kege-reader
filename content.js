/* KEGE Reader — content script (v0.1)
   1) читаемая раскладка (CSS включаем), 2) кнопки «PiP» у каждого номера,
   3) вынос задачи в нативное picture-in-picture окно Firefox (поверх всех окон),
   4) зум, прокрутка кадра с клавиатуры. */
(() => {
  if (window.__kpLoaded) return;
  window.__kpLoaded = true;

  const IS_FRAME = location.search.includes('kpip=1') || window.top !== window.self;
  document.documentElement.classList.add('kp-read', 'kp-examfix');
  document.documentElement.dataset.kpBoot = 'h2c@boot=' + typeof window.html2canvas +
    ' def=' + (window.html2canvas && typeof window.html2canvas.default) +
    ' err=' + (window.__kpH2cErr || 'none');

  /* ---------- iframe-режим: кадр для PiP ---------- */
  if (IS_FRAME && window.top !== window.self) {
    document.documentElement.classList.add('kp-frame');
    const notifyReady = () => {
      const el = document.querySelector('.taskList');
      const m = location.pathname.match(/\/task\/(\d+)/);
      try {
        document.title = 'KPR:' + (m ? m[1] : '?');
        window.parent.postMessage({ kp: 'ready', task: m ? m[1] : '' }, location.origin);
      } catch (e) { document.title = 'KPF:' + e.message; }
      if (!el) setTimeout(notifyReady, 300);
    };
    notifyReady();
    const mo = new MutationObserver(() => {
      if (document.querySelector('.taskList')) { notifyReady(); mo.disconnect(); }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    return;
  }

  /* ================== верхний фрейм ================== */

  const state = {
    zoom: parseFloat(localStorage.kp_zoom || '1') || 1,
    read: localStorage.kp_read !== '0',
    pip: { taskId: null, iframe: null, scrollTop: 0, maxScroll: 0, band: null,
           el: null, totalH: 0, iframeReady: false },
    pipTask: null,
    stream: null,
  };
  window.addEventListener('message', (e) => {
    document.documentElement.dataset.kpMsg =
      (document.documentElement.dataset.kpMsg || '') + '|' + e.origin + ':' + JSON.stringify(e.data).slice(0, 40);
    // the iframe frame is same-origin; sandbox proxies defeat e.source ===
    // iframe.contentWindow identity, so rely on origin + payload marker
    if (e.origin === location.origin && e.data?.kp === 'ready' && state.pip?.iframe)
      state.pip.iframeReady = true;
  }, true);
  const applyZoom = () => {
    state.zoom = Math.min(2.2, Math.max(0.6, state.zoom));
    localStorage.kp_zoom = String(state.zoom);
    document.documentElement.style.setProperty('--kp-zoom', String(state.zoom));
  };
  const applyRead = () => {
    localStorage.kp_read = state.read ? '1' : '0';
    document.documentElement.classList.toggle('kp-read', state.read);
  };
  applyZoom(); applyRead();

  /* ---------- панель ---------- */
  function buildBar() {
    if (document.getElementById('kp-bar')) return;
    const bar = document.createElement('div');
    bar.id = 'kp-bar';
    bar.innerHTML = `
      <button data-a="minus" title="Мельче">A−</button>
      <button data-a="plus" title="Крупнее">A+</button>
      <button data-a="read" title="Режим чтения вкл/выкл">⤢</button>
      <button data-a="pip" title="Вынести текущую задачу в плавающее окно">▶ PiP</button>
      <span class="kp-hint">PiP: Alt+↑/↓ прокрутка, Alt+←/→ № задачи</span>
      <button class="kp-close" data-a="close" title="Скрыть панель">✕</button>`;
    document.body.appendChild(bar);
    bar.addEventListener('click', (e) => {
      const a = e.target?.dataset?.a;
      if (!a) return;
      if (a === 'minus') { state.zoom -= 0.1; applyZoom(); if (state.pipTask) renderFrame(); }
      else if (a === 'plus') { state.zoom += 0.1; applyZoom(); if (state.pipTask) renderFrame(); }
      else if (a === 'read') { state.read = !state.read; applyRead(); }
      else if (a === 'pip') { openPipCurrent(); }
      else if (a === 'close') { bar.remove(); hideFallbackPanel(); }
    });
    bar.addEventListener('dblclick', (e) => {
      if (e.target?.dataset?.a === 'minus') { state.zoom = 1; applyZoom(); if (state.pipTask) renderFrame(); }
    });
  }

  /* ---------- задачи на странице ---------- */
  const rowOf = (el) => el.closest('tr');
  function taskIdOf(row) {
    const d = row.querySelector('.details');
    const m = d && d.textContent.match(/№\s*(\d{4,6})/);
    if (m) return m[1];
    const u = location.pathname.match(/\/task\/(\d+)/);
    return u ? u[1] : null;
  }
  function taskRows() {
    return [...document.querySelectorAll('.taskList tr')]
      .filter(r => r.querySelector('div[class*="number" i], .number'))
      .filter(r => r.querySelector('.task-text'));
  }
  function injectButtons() {
    for (const row of taskRows()) {
      const cell = row.querySelector('.number')?.parentElement;
      if (!cell || cell.querySelector('.kp-pip-btn')) continue;
      const id = taskIdOf(row);
      if (!id) continue;
      const b = document.createElement('button');
      b.className = 'kp-pip-btn';
      b.textContent = 'PiP';
      b.title = `Открыть задачу № ${id} в плавающем окне`;
      b.dataset.task = id;
      cell.appendChild(b);
    }
  }

  /* ---------- PiP движок ---------- */
  const CW = 880, CH = 1240, HEAD = 76, FW = 860;
  let canvas, video, pipWin;

  function ensureMedia() {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = CW; canvas.height = CH;
      canvas.style.cssText = 'position:fixed;left:-9999px;top:200px;width:1px;height:1px';
      document.body.appendChild(canvas);
      video = document.createElement('video');
      video.muted = true; video.playsInline = true;
      video.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px';
      document.body.appendChild(video);
      state.stream = canvas.captureStream(20);
      video.srcObject = state.stream;
    }
    drawCanvas('загрузка…');
    return new Promise((res) => {
      video.play().catch(() => {});
      if (video.readyState >= 2) return res();
      const to = setTimeout(res, 2000);
      video.addEventListener('loadeddata', () => { clearTimeout(to); res(); }, { once: true });
    });
  }

  function findRow(taskId) {
    return taskRows().find(r => taskIdOf(r) === String(taskId)) || null;
  }

  function ensureFrame(taskId) {
    const cur = state.pip?.iframe;
    const url = `${location.origin}/task/${taskId}?kpip=1`;
    if (cur) {
      state.pip.iframeReady = false;
      cur.src = url;
      return cur;
    }
    const fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;height:1400px;border:0;';
    fr.src = url;
    document.body.appendChild(fr);
    state.pip.iframe = fr;
    return fr;
  }

  function drawHeader(ctx, taskId, note, info) {
    ctx.fillStyle = '#1e325a';
    ctx.fillRect(0, 0, CW, HEAD);
    ctx.fillStyle = '#fff';
    ctx.font = '700 30px Roboto, sans-serif';
    ctx.fillText(`№ ${taskId}`, 18, 44);
    ctx.font = '16px Roboto, sans-serif';
    ctx.fillStyle = '#cfe3ff';
    ctx.fillText('КЕГЭ · Alt+↑/↓ — прокрутка · Alt+←/→ — другой №', 18, 66);
    if (info) {
      ctx.fillStyle = '#9fb8e8';
      ctx.font = '13px Roboto, sans-serif';
      ctx.fillText(info, 620, 66);
    }
    if (note) {
      ctx.fillStyle = '#ffb400';
      ctx.font = '700 20px Roboto, sans-serif';
      ctx.fillText(note, 560, 44);
    }
  }

  function drawCanvas(note) {
    const st = state.pip;
    if (!canvas || !st) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, CW, CH);
    drawHeader(ctx, st.taskId, note,
      'v3.2 H=' + (st.totalH || 0) + ' y=' + (st.scrollTop || 0) + (st.band ? '' : ' noband'));
    if (st.band) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, HEAD, CW, CH - HEAD); ctx.clip();
      ctx.drawImage(st.band, 0, HEAD);
      ctx.restore();
    }
  }

  function html2canvasReady() {
    // kp-render.js ships as the first content-script file: same world, no CSP games
    return Promise.resolve(window.KP && window.KP.band ? window.KP : null)
      .then((r) => r || Promise.reject(new Error('KP renderer missing')));
  }

  function redrawBand() {
    const st = state.pip;
    if (!st.el || !window.KP) { drawCanvas(); return; }
    try {
      const b = window.KP.band(st.el, CW, st.scrollTop, CH - HEAD + 40);
      if (b) st.band = b.canvas;
    } catch (e) {
      document.documentElement.dataset.kpRenderErr = String(e && e.message || e).slice(0, 200);
    }
    drawCanvas();
  }

  async function renderFrame() {
    const st = state.pip;
    if (!st || st.rendering) return;
    let el = null;
    const row = findRow(st.taskId);
    if (row) {
      el = row.querySelector('td:nth-child(2)') || row;
    } else if (st.iframe) {
      let doc;
      try { doc = st.iframe.contentDocument; } catch { doc = null; }
      el = doc?.querySelector('.taskList');
      if (el && !st.iframeReady) return;
    }
    if (!el) return;
    st.rendering = true;
    drawCanvas('рисуем…');
    try {
      const kp = await html2canvasReady();
      await kp.preload(el);
      st.el = el;
      st.totalH = kp.measure(el, CW);
      st.maxScroll = Math.max(0, st.totalH - (CH - HEAD));
      st.scrollTop = Math.min(st.scrollTop, st.maxScroll);
      const b = kp.band(el, CW, st.scrollTop, CH - HEAD + 40);
      if (!b) throw new Error('canvas band alloc fail');
      st.band = b.canvas;
      document.documentElement.dataset.kpRendered = CW + 'x' + b.total;
      drawCanvas();
    } catch (e) {
      window.__kpErrStack = String(e && e.stack || e).split('\n').slice(0, 8).join(' | ');
      const msg = String(e && e.message || e).slice(0, 200);
      document.documentElement.dataset.kpRenderErr = msg;
      drawCanvas('ошибка: ' + msg.slice(0, 40));
    } finally {
      st.rendering = false;
    }
  }

  function sigOf(taskId) {
    const row = findRow(taskId);
    let t = row ? row.querySelector('.task-text')?.textContent : null;
    if (t == null && state.pip.iframe) {
      try {
        t = state.pip.iframe.contentDocument?.querySelector('.task-text')?.textContent;
      } catch { t = null; }
    }
    return t == null ? '' : String(t.length);
  }

  function showFallbackPanel(msg) {
    if (!video) return;
    video.play().catch(() => {});
    video.style.cssText = 'position:fixed;right:12px;bottom:56px;width:420px;' +
      'max-height:80vh;z-index:2147483646;background:#000;box-shadow:0 4px 24px rgba(0,0,0,.5);' +
      'border:2px solid #ffb400;border-radius:6px;';
    video.dataset.kpPanel = '1';
    let n = document.getElementById('kp-pipnote');
    if (!n) {
      n = document.createElement('div');
      n.id = 'kp-pipnote';
      n.style.cssText = 'position:fixed;right:12px;bottom:44px;z-index:2147483646;' +
        'background:#8a5a00;color:#fff;font:12px Roboto,sans-serif;padding:3px 8px;' +
        'border-radius:6px;max-width:430px;';
      document.body.appendChild(n);
    }
    n.textContent = 'PiP-окно отбито браузером (' + String(msg).slice(0, 60) +
      ') — кадр показан здесь; ▶ PiP повторить, ✕ скрыть';
  }
  function hideFallbackPanel() {
    const n = document.getElementById('kp-pipnote');
    if (n) n.remove();
    if (video && video.dataset.kpPanel === '1') {
      video.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px';
      delete video.dataset.kpPanel;
    }
  }

  async function openPip(taskId) {
    const st = state.pip;
    st.taskId = taskId;
    st.scrollTop = 0;
    st.band = null;
    st.el = null;
    st.maxScroll = 0;
    if (!findRow(taskId)) ensureFrame(taskId);
    markActive(taskId);
    state.pipTask = taskId;
    await ensureMedia();
    // открываем PiP сразу под user gesture, контент дорисуется асинхронно
    let pipOpenedHere = false;
    if (!document.pictureInPictureElement) {
      try {
        pipWin = await video.requestPictureInPicture();
        pipOpenedHere = true;
        document.documentElement.dataset.kpPipError = '';
      } catch (e) {
        document.documentElement.dataset.kpPipError = (e && e.message) || String(e);
        console.warn('KPip: PiP request failed', e);
        showFallbackPanel((e && e.message) || String(e));
        // не выходим: кадр дорисуется, пользователь увидит задачу в странице
      }
      pipWin.addEventListener('leavepictureinpicture', () => {
        state.pipTask = null;
        markActive(null);
      }, { once: true });
    }
    // ждём стабильного кадра (SPA-рендер может доигрывать)
    const t0 = Date.now();
    let lastSig = '';
    while (Date.now() - t0 < 25000) {
      await renderFrame();
      const sig = sigOf(st.taskId);
      if (st.band && sig && sig === lastSig) break;
      lastSig = sig;
      await new Promise(r => setTimeout(r, 700));
    }
    return pipOpenedHere;
  }

  function markActive(taskId) {
    document.querySelectorAll('.kp-pip-btn').forEach(b =>
      b.classList.toggle('kp-active', b.dataset.task === String(taskId)));
  }

  function currentTaskId() {
    const u = location.pathname.match(/\/task\/(\d+)/);
    if (u) return u[1];
    const first = taskRows()[0];
    return first ? taskIdOf(first) : null;
  }

  async function openPipCurrent() {
    const id = currentTaskId();
    if (!id) return;
    await openPip(id);
  }

  async function switchPip(delta) {
    if (!state.pipTask) return;
    const ids = taskRows().map(taskIdOf).filter(Boolean);
    let next;
    const i = ids.indexOf(String(state.pipTask));
    if (i >= 0) next = ids[Math.min(ids.length - 1, Math.max(0, i + delta))];
    if (!next) next = String(parseInt(state.pipTask, 10) + delta);
    if (next === state.pipTask) return;
    await openPip(next);
  }

  /* ---------- клавиатура ---------- */
  window.addEventListener('keydown', (e) => {
    if (!e.altKey || !state.pipTask) return;
    const map = {
      ArrowDown: 320, ArrowUp: -320,
      PageDown: 900, PageUp: -900,
    };
    if (e.key in map) {
      e.preventDefault();
      const st = state.pip;
      st.scrollTop = Math.max(0, Math.min(st.maxScroll || 99999, st.scrollTop + map[e.key]));
      redrawBand();
    } else if (e.key === 'ArrowRight') { e.preventDefault(); switchPip(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); switchPip(-1); }
  }, true);

  /* ---------- делегирование кликов по кнопкам ---------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.kp-pip-btn');
    if (!btn) return;
    e.preventDefault();
    openPip(btn.dataset.task);
  }, true);

  /* ---------- живой DOM (Vue SPA) ---------- */
  let scheduled = false;
  const scan = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; buildBar(); injectButtons(); }, 150);
  };
  new MutationObserver(scan).observe(document.documentElement,
    { childList: true, subtree: true });
  scan();
})();
