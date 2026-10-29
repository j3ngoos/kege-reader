#!/usr/bin/env python3
"""Dump rendered structure of kompege task page (vanilla, no extension)."""
import asyncio, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from bidi import connect

URL = sys.argv[1] if len(sys.argv) > 1 else "https://kompege.ru/task/31112"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/kp_dump.json"

EXPR = r"""
(() => {
  const css = (el, p) => getComputedStyle(el).getPropertyValue(p);
  const out = {title: document.title, url: location.href, vw: innerWidth, vh: innerHeight,
               docScrollW: document.documentElement.scrollWidth};
  const pick = (sel) => [...document.querySelectorAll(sel)].slice(0, 60).map(el => {
    const r = el.getBoundingClientRect();
    return {tag: el.tagName, cls: el.className && String(el.className).slice(0,80),
            id: el.id, w: Math.round(r.width), h: Math.round(r.height),
            x: Math.round(r.x), y: Math.round(r.y),
            text: (el.textContent || '').trim().slice(0, 60)};
  });
  // outline of #app: depth-limited class map
  function outline(el, d, maxd, acc) {
    for (const c of el.children) {
      const cls = c.className && String(c.className).trim();
      acc.push('  '.repeat(d) + c.tagName.toLowerCase() + (c.id ? '#'+c.id : '') + (cls ? '.'+cls.split(/\s+/).join('.') : '') + ' [' + Math.round(c.getBoundingClientRect().width) + 'x' + Math.round(c.getBoundingClientRect().height) + ']');
      if (d < maxd && (c.textContent||'').trim().length > 200) outline(c, d+1, maxd, acc);
      else if (d < maxd && c.tagName === 'DIV' && (c.textContent||'').trim().length) outline(c, d+1, maxd, acc);
    }
  }
  const acc = [];
  const app = document.querySelector('#app');
  if (app) outline(app, 0, 5, acc);
  out.outline = acc.slice(0, 120);
  out.startWrap = (() => { const el = document.querySelector('[class*=start-wrap]'); if (!el) return null;
    return {cols: css(el,'grid-template-columns'), rows: css(el,'grid-template-rows'), w: Math.round(el.getBoundingClientRect().width)}; })();
  out.main = pick('[class*="main"]');
  out.tables = [...document.querySelectorAll('table')].slice(0,8).map(t => { const r=t.getBoundingClientRect(); return {w: Math.round(r.width), x: Math.round(r.x), cols: t.querySelectorAll('tr')[0] ? t.querySelectorAll('tr')[0].children.length : 0, text: t.textContent.trim().slice(0,80)}; });
  out.imgs = [...document.querySelectorAll('img')].slice(0, 12).map(i => ({src: i.src.slice(-40), w: Math.round(i.getBoundingClientRect().width), x: Math.round(i.getBoundingClientRect().x)}));
  // number grid candidates: elements whose text is a 5-6 digit number
  out.numbers = [...document.querySelectorAll('span,div,a,button')].filter(e => {
    const t = (e.textContent||'').trim(); return /^\d{5,6}$/.test(t);
  }).slice(0, 15).map(e => { const r = e.getBoundingClientRect(); return {tag: e.tagName, cls: String(e.className).slice(0,60), id: e.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), text: e.textContent.trim()}; });
  out.numbersCount = [...document.querySelectorAll('span,div,a,button')].filter(e => /^\d{5,6}$/.test((e.textContent||'').trim())).length;
  return out;
})()
"""

async def main():
    b = await connect()
    await b.navigate(URL)
    await asyncio.sleep(1.5)
    data = await b.evaluate(EXPR, timeout=40)
    with open(OUT, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    await b.screenshot("/tmp/kp_vanilla.png")
    print("wrote", OUT, "numbers:", data.get("numbersCount"))
    print(json.dumps({k: data[k] for k in ("vw","vh","docScrollW","startWrap")}, ensure_ascii=False))
    await b.close()

asyncio.run(main())
