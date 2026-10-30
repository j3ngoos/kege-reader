#!/usr/bin/env python3
"""Focused probe: iframe PiP fallback for a task not in the DOM."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from wd import WD

XPI = os.path.join(os.path.dirname(__file__), "ffext.xpi")
wd = WD()
wd.new_session()
wd.timeouts("script", 30000)
try:
    wd.call("POST", "/moz/addon/uninstall", {"id": "kege-reader@hermes.local"})
except Exception:
    pass
wd.install_addon(XPI)

BASE = "http://localhost:8899"
wd.get(BASE + "/task?nc=" + str(int(time.time())))
for _ in range(15):
    time.sleep(1)
    if int(wd.js("return document.querySelectorAll('.kp-pip-btn').length")) >= 4:
        break
print("parent rows ready:", wd.js("return document.querySelectorAll('.kp-pip-btn').length"))
wd.js("""
  const td=document.querySelector('.taskList tbody tr:last-child td:nth-child(2)');
  const b=document.createElement('button');
  b.className='kp-pip-btn'; b.textContent='PiP400001'; b.dataset.task='400001';
  (td||document.body).appendChild(b);
""")
time.sleep(1.5)
p = json.loads(wd.js("""
  const b=[...document.querySelectorAll('.kp-pip-btn')].find(b=>b.dataset.task==='400001');
  b.scrollIntoView({block:'center'});
  const r=b.getBoundingClientRect();
  return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});
"""))
wd.click_xy(p["x"], p["y"])
for i in range(30):
    time.sleep(1)
    st = json.loads(wd.js("""
      const de=document.documentElement;
      const f=document.querySelector('iframe[src*="kpip"]');
      let idoc=null, iinfo='noframe';
      if (f) { try { idoc=f.contentDocument; iinfo=JSON.stringify({
        ready:idoc.readyState, tl:!!(idoc&&idoc.querySelector('.taskList')),
        tbl:!!(idoc&&idoc.querySelector('.taskList table')),
        tt:!!(idoc&&idoc.querySelector('.task-text')),
        title:idoc&&idoc.title}); } catch(e){ iinfo='X:'+e.message; } }
      return JSON.stringify({
        rendered: de.dataset.kpRendered||null, err: de.dataset.kpRenderErr||null,
        msg: (de.dataset.kpMsg||'').slice(-140),
        pip: document.pictureInPictureElement? 'VID':'none',
        frame: f? f.src.slice(-40):null, iinfo,
        vid: (v=>v?({ct:+v.currentTime.toFixed(2),rs:v.readyState}):null)(document.querySelector('video')),
      });
    """))
    print(i, json.dumps(st, ensure_ascii=False))
    if st["rendered"]:
        break
