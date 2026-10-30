'use strict';
/* Fetch relay for content scripts. Cross-origin task images (CDNs, image
   hosts without CORS headers) must be drawn WITHOUT tainting the PiP
   captureStream canvas; the proven-clean repack is blob: in the content
   world, and the proven-clean fetch is the extension background (host
   permissions bypass page CORS; credentials keep the site session cookies).
   Bytes travel as ArrayBuffer; content side wraps into new Blob → objectURL
   → Image. Never returns data URIs (Firefox treats data: as opaque → taint). */
browser.runtime.onMessage.addListener((m) => {
  if (!m || !m.kpFetch) return undefined;
  const u = String(m.kpFetch);
  if (!/^https?:/i.test(u)) return Promise.resolve({ err: 'bad-scheme' });
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  return fetch(u, { credentials: 'include', signal: ctl.signal })
    .then((r) => {
      clearTimeout(t);
      if (!r.ok) throw new Error('http-' + r.status);
      return Promise.all([r.arrayBuffer(), r.headers.get('content-type')]);
    })
    .then(([b, ct]) => ({ buf: b, type: ct }))
    .catch((e) => { clearTimeout(t); return { err: String((e && e.message) || e).slice(0, 60) }; });
});
