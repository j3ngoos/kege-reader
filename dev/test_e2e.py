#!/usr/bin/env python3
"""E2E: install ext, open mock, check fluid layout, PiP button click -> PiP, scroll."""
import json, sys, time, os
sys.path.insert(0, os.path.dirname(__file__))
from wd import WD

BASE = "http://localhost:8899"

import time as _t
def bust(u):
    return u + ("&" if "?" in u else "?") + "nc=" + str(int(_t.time() * 1000))


wd = WD()
wd.new_session()
wd.timeouts("script", 30000)

# 0) baseline: open mock WITHOUT extension first is impossible (shared session);
#    measure "before" by disabling ext styles via removing html.kp-read later.
r = {"steps": []}
def step(name, ok, detail=""):
    r["steps"].append({"step": name, "ok": bool(ok), "detail": str(detail)[:300]})
    print(("PASS " if ok else "FAIL ") + name + (" — " + str(detail)[:200] if detail else ""))
    return ok

# 1) install extension (archive)
try:
    wd.call("POST", "/moz/addon/uninstall",
            {"id": "kege-reader@hermes.local"})
except Exception:
    pass
try:
    wd.install_addon(os.path.join(os.path.dirname(__file__), "ffext.xpi"))
    step("install_addon", True)
except Exception as e:
    step("install_addon", False, e)
    sys.exit(1)

# 2) open mock task page
wd.get(bust(f"{BASE}/task/31112"))
time.sleep(2.5)
step("page_open", "31112" in (wd.current_url() or ""), wd.current_url())

# 3) fluid layout: no horizontal overflow at viewport width
m = wd.js("""
  const de = document.documentElement;
  const bar = document.getElementById('kp-bar');
  const btns = document.querySelectorAll('.kp-pip-btn');
  const t = document.querySelector('.task-text');
  const img = document.querySelector('.task-text img');
  const table = document.querySelector('.task-text table');
  return JSON.stringify({
    vw: innerWidth, docSW: de.scrollWidth, bodySW: document.body.scrollWidth,
    bar: !!bar, btnCount: btns.length,
    imgW: img ? img.getBoundingClientRect().width : null,
    tableW: table ? table.getBoundingClientRect().width : null,
    textRight: t ? Math.round(t.getBoundingClientRect().right) : null,
    read: de.classList.contains('kp-read'),
  });
""")
print("layout:", m)
L = json.loads(m)
fit = L["docSW"] <= L["vw"] + 2
step("fluid_no_hscroll", fit, f"docSW={L['docSW']} vw={L['vw']}")
step("bar_present", L["bar"])
step("pip_buttons", L["btnCount"] >= 2, f"count={L['btnCount']}")
step("img_fits", L["imgW"] is not None and L["imgW"] <= L["vw"], f"imgW={L['imgW']}")

# 3b) "before" check: simulate vanilla (styles off) overflow to prove the fix matters
m2 = wd.js("""
  const de = document.documentElement;
  de.classList.remove('kp-read');
  const sw = document.documentElement.scrollWidth;
  de.classList.add('kp-read');
  return JSON.stringify({vanillaSW: sw});
""")
L2 = json.loads(m2)
print("vanillaSW:", L2["vanillaSW"])
step("fix_really_helps", L2["vanillaSW"] > L["vw"] + 40,
     f"vanillaSW={L2['vanillaSW']} vw={L['vw']} (vanilla должен вылезать за окно)")

wd.screenshot("/tmp/kp_fluid.png")

# 4) click first PiP button (trusted input)
pos = wd.js("""
  const b = document.querySelectorAll('.kp-pip-btn')[0];
  b.scrollIntoView({block: 'center'});
  const r = b.getBoundingClientRect();
  return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2});
""")
P = json.loads(pos)
wd.click_xy(P["x"], P["y"])

# 5) PiP opened?
opened = None
for _ in range(20):
    time.sleep(1)
    opened = wd.js("return JSON.stringify({pip: document.pictureInPictureElement ? document.pictureInPictureElement.tagName : null, vids: document.querySelectorAll('video').length, err: document.documentElement.dataset.kpPipError || null, vW: (document.querySelector('video')||{}).videoWidth})")
    o = json.loads(opened)
    if o["pip"] == "VIDEO":
        break
step("pip_opened", o["pip"] == "VIDEO", o)

# 6) canvas has content (frame rendered), task number drawn
rend = None
for _ in range(30):
    d = wd.js("return JSON.stringify({r:document.documentElement.dataset.kpRendered||null,e:document.documentElement.dataset.kpRenderErr||null})")
    j = json.loads(d)
    if j["r"] or j["e"]:
        rend = j
        break
    time.sleep(1)
step("frame_rendered", bool(rend and rend.get("r")), rend)
c = wd.js("""
  const cv = [...document.querySelectorAll('canvas')].find(c => c.width === 880);
  if (!cv) return JSON.stringify({err: 'no canvas'});
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 80, cv.width, cv.height - 80).data;
  let nonwhite = 0;
  for (let i = 0; i < d.length; i += 4*97) {
    if (d[i] < 240 || d[i+1] < 240 || d[i+2] < 240) nonwhite++;
  }
  return JSON.stringify({w: cv.width, h: cv.height, nonwhiteSamples: nonwhite, totalSamples: Math.floor(d.length/(4*97))});
""")
cc = json.loads(c)
print("canvas:", cc)
step("canvas_has_content", cc.get("nonwhiteSamples", 0) > 50, cc)

# 6b) cross-origin image must NOT kill the captureStream (canvas taint guard)
time.sleep(3)
alive = wd.js("""
  const v = document.querySelector('video');
  return JSON.stringify({t: v.currentTime, rs: v.readyState, pip: !!document.pictureInPictureElement});
""")
a = json.loads(alive)
step("pip_stream_alive_after_img", a["t"] > 0.3 and a["rs"] >= 2, alive)

wd.screenshot("/tmp/kp_pip.png")

# 7) keyboard scroll changes frame — switch to the scrollable long task (31024)
for _ in range(3):
    wd.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}))")
    time.sleep(1.0)
rend = None
for _ in range(20):
    time.sleep(1)
    d = wd.js("const de=document.documentElement;return de.dataset.kpRendered||de.dataset.kpRenderErr||null")
    if d and d != "None": rend = d; break
step("switched_to_31024", rend and "880x5" in rend, str(rend))
bands = "const cv=[...document.querySelectorAll('canvas')].find(c=>c.width===880); if(!cv) return JSON.stringify({e:'nocv'}); const ctx=cv.getContext('2d'); const b=(y)=>{const hh=Math.min(420,cv.height-y-6);if(hh<80)return -1;const d=ctx.getImageData(0,y,880,hh).data;let n=0; for(let i=0;i<d.length;i+=4){if(d[i]<200)n++}return n}; return JSON.stringify([b(90),b(520),b(800)]);"
b1 = wd.js(bands)
wd.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true}))")
wd.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true}))")
wd.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true}))")
time.sleep(1.5)
b2 = wd.js(bands)
step("scroll_changes_frame", b1 != b2, f"{b1} vs {b2}")

# 8) switch task via Alt+Right
wd.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',altKey:true,bubbles:true}))")
time.sleep(3)
hdr = wd.js("""
  const cv=[...document.querySelectorAll('canvas')].find(c=>c.width===880);
  const ctx=cv.getContext('2d');
  const d=ctx.getImageData(18,20,220,50).data;
  let dark=0; for(let i=0;i<d.length;i+=4){ if(d[i]>200) dark++; }
  return JSON.stringify({lightPixels:dark});
""")
step("task_switch_header", json.loads(hdr)["lightPixels"] > 100, hdr)
wd.screenshot("/tmp/kp_switch.png")

# 9) zoom: reset persisted state, reopen, press A+
wd.js("localStorage.removeItem('kp_zoom'); localStorage.removeItem('kp_read')")
wd.get(bust(BASE + "/task/31112"))
time.sleep(1.5)
p9 = json.loads(wd.js("""
  const b=document.querySelector('.kp-pip-btn');
  const r=b.getBoundingClientRect();
  return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});
"""))
wd.click_xy(p9["x"], p9["y"])
for i in range(10):
    time.sleep(1)
    o9 = wd.js("return document.pictureInPictureElement ? 'VIDEO' : (document.documentElement.dataset.kpRenderErr||'')")
    if o9 == "VIDEO":
        break
z0 = wd.js("return JSON.stringify({zoom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kp-zoom'))})")
wd.js("""
  const b=[...document.querySelectorAll('#kp-bar button')].find(b=>b.dataset.a==='plus');
  b.click();
  return true;
""")
time.sleep(0.5)
z = wd.js("return JSON.stringify({zoom: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--kp-zoom'))})")
dz = json.loads(z)["zoom"] - json.loads(z0)["zoom"]
step("zoom_works", abs(dz - 0.1) < 0.02, f"{z0} -> {z}")

# 10) inline flow: formula task -> compact canvas, top filled (no column-per-char, no miles of blank)
def open_pip_btn(idx):
    wd.js("document.documentElement.dataset.kpRendered=''; document.documentElement.dataset.kpRenderErr=''")
    p = wd.js(f"""
      const b=document.querySelectorAll('.kp-pip-btn')[{idx}];
      b.scrollIntoView({{block:'center'}});
      const r=b.getBoundingClientRect();
      return JSON.stringify({{x:r.x+r.width/2,y:r.y+r.height/2}});
    """)
    P = json.loads(p)
    wd.click_xy(P["x"], P["y"])
    for _ in range(30):
        d = wd.js("const de=document.documentElement; return de.dataset.kpRendered||de.dataset.kpRenderErr||null")
        if d and d != "None":
            return d
        time.sleep(1)
    return None

rend = open_pip_btn(2)  # №31121 formula task
Hf = int(rend.split("x")[1]) if rend and "x" in rend else -1
step("formula_rendered", Hf > 0, rend)
step("formula_compact_no_blank", 0 < Hf < 1400, f"H={Hf} (compact, no huge blank)")
bands_f = json.loads(wd.js(bands))
step("formula_lines_visible", bands_f[0] > 800, bands_f)

# 11) long task: full tall canvas, BOTTOM filled (not cut, not blank)
rend = open_pip_btn(3)  # №31024 long task
Hl = int(rend.split("x")[1]) if rend and "x" in rend else -1
step("long_rendered_tall", 2500 < Hl < 30000, f"H={Hl}")
wd.js("for(let i=0;i<25;i++) window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true}))")
time.sleep(1)
bands_l = json.loads(wd.js(bands))
step("long_bottom_visible", bands_l[1] > 800, bands_l)
wd.screenshot("/tmp/kp_long.png")

# 12) xlong task: >30000px, scroll all the way to the very end
rend = open_pip_btn(4)  # №31999
Hx = int(rend.split("x")[1]) if rend and "x" in rend else -1
step("xlong_over_old_cap", Hx > 30000, f"H={Hx} (old design would fail)")
wd.js("for(let i=0;i<130;i++) window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',altKey:true,bubbles:true}))")
time.sleep(1.5)
bands_x = json.loads(wd.js(bands))
step("xlong_end_visible", bands_x[1] > 800, bands_x)
wd.screenshot("/tmp/kp_xlong.png")

# 13) iframe path: task not listed on the page -> iframe frame + cross-doc getComputedStyle
wd.get(bust(f"{BASE}/task/99999"))
time.sleep(2)
wd.js("document.documentElement.dataset.kpRendered=''; document.documentElement.dataset.kpRenderErr=''")
p = wd.js("""
  const b=[...document.querySelectorAll('#kp-bar button')].find(b=>b.dataset.a==='pip');
  const r=b.getBoundingClientRect();
  return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});
""")
P = json.loads(p)
wd.click_xy(P["x"], P["y"])
rend = None
for _ in range(35):
    d = wd.js("const de=document.documentElement; return de.dataset.kpRendered||de.dataset.kpRenderErr||null")
    if d and d != "None":
        rend = d
        break
    time.sleep(1)
step("iframe_path_render_ok", rend and "x" in rend, rend)

# 12) every task type: render + band-sample + screenshot for vision review
TYPE_IDS = ["3290", "32100", "32120", "32130", "32140", "32190",
            "32230", "32240", "32270", "32250", "325110"]
wd.get(bust(BASE + "/task/31112"))
time.sleep(1.5)
import base64
SAMP2 = ("const cv=[...document.querySelectorAll('canvas')].find(c=>c.width===880); if(!cv) return JSON.stringify({e:'nocv'});"
         "const y=90;const hh=Math.min(420,cv.height-y-6);if(hh<80)return JSON.stringify({e:'short'});"
         "try{const d=cv.getContext('2d').getImageData(0,y,880,hh).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]<200)n++;return JSON.stringify({n:n,h:cv.height})}"
         "catch(e){return JSON.stringify({e:String(e.message).slice(0,60)})}")
for tid in TYPE_IDS:
    try:
        wd.js("document.documentElement.dataset.kpRendered=''; document.documentElement.dataset.kpRenderErr=''")
        p9 = json.loads(wd.js("""
          const b=[...document.querySelectorAll('.kp-pip-btn')].find(b=>b.closest('tr').textContent.includes('\u2116 ' + '%s'));
          if (!b) return null;
          b.scrollIntoView({block:'center'});
          const r=b.getBoundingClientRect();
          return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});
        """ % tid))
        wd.click_xy(p9["x"], p9["y"])
        rend2 = None
        for _ in range(20):
            time.sleep(1)
            d2 = wd.js("const de=document.documentElement; return de.dataset.kpRendered||de.dataset.kpRenderErr||null")
            if d2 and d2 != "None":
                rend2 = d2
                break
        time.sleep(0.8)
        s2 = json.loads(wd.js(SAMP2))
        data = wd.js("const cv=[...document.querySelectorAll('canvas')].find(c=>c.width===880); return cv?cv.toDataURL('image/png'):null")
        if data and data != "None":
            open(f"/tmp/kp_type_{tid}.png", "wb").write(base64.b64decode(data.split(",", 1)[1]))
        step(f"type_{tid}", rend2 and "x" in rend2 and s2.get("n", 0) > 150, {"rend": rend2, "band": s2})
    except Exception as e:
        step(f"type_{tid}", False, {"exc": str(e)[:120]})

# 13) cross-origin image WITHOUT CORS headers: background-fetch → clean blob:
# channel must draw it AND keep the PiP stream alive (no canvas taint).
wd.js("document.documentElement.dataset.kpRendered=''; document.documentElement.dataset.kpRenderErr=''; document.documentElement.dataset.kpImgLog=''")
pA = json.loads(wd.js("""
  const b=[...document.querySelectorAll('.kp-pip-btn')].find(b=>b.closest('tr').textContent.includes('\\u2116 33000'));
  if (!b) return null;
  b.scrollIntoView({block:'center'});
  const r=b.getBoundingClientRect();
  return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});
"""))
wd.click_xy(pA["x"], pA["y"])
rendA = imglogA = None
for _ in range(25):
    time.sleep(1)
    rendA = wd.js("const de=document.documentElement; return de.dataset.kpRendered||de.dataset.kpRenderErr||null")
    imglogA = wd.js("return document.documentElement.dataset.kpImgLog||''")
    if rendA and rendA != "None" and imglogA and ("cors" in imglogA or "bg-fetch" in imglogA or "TAINT" in imglogA or "ERR" in imglogA):
        break
time.sleep(0.8)
sA = json.loads(wd.js(SAMP2))
vidA = wd.js("const v=document.querySelector('video'); return v?JSON.stringify({ct:v.currentTime,rs:v.readyState}):null")
va = json.loads(vidA) if vidA and vidA != "None" else {}
clean = ("cors" in (imglogA or "")) or ("bg-fetch" in (imglogA or ""))
step("xorigin_clean_channel_draw", clean, {"imglog": (imglogA or "")[:120]})
step("xorigin_band_content", sA.get("n", 0) > 150, sA)
step("xorigin_stream_alive", va.get("rs", 0) >= 2 and va.get("ct", 0) > 0.3, va)

# 14) SPA landing replica (tasks:[] on open): the extension must auto-fire
#     "Найти все задачи" so the list + PiP buttons appear, like the old SSR page.
wd.get(bust(f"{BASE}/task"))
land = {"rows": 0, "btns": 0}
for _ in range(15):
    time.sleep(1)
    land = json.loads(wd.js("""
      const rows=[...document.querySelectorAll('.taskList tr')]
        .filter(r=>r.querySelector('.number')&&r.querySelector('.task-text'));
      return JSON.stringify({loaded:document.documentElement.dataset.kpLoadedList||null,
        rows:rows.length, btns:document.querySelectorAll('.kp-pip-btn').length});
    """))
    if land["rows"] and land["btns"] >= land["rows"]:
        break
step("landing_autoload", land["rows"] >= 4 and land["btns"] >= land["rows"], land)

# 14b) ?id= pages: the user searched by id — never auto-click the type search
wd.get(bust(f"{BASE}/task?id=7"))
time.sleep(3.5)
landQ = json.loads(wd.js("""
  return JSON.stringify({rows:document.querySelectorAll('.taskList .number').length,
    clicked:document.documentElement.dataset.kpFindClicked||null,
    loaded:document.documentElement.dataset.kpLoadedList||null});
"""))
step("landing_id_query_no_autoload", not landQ["clicked"] and not landQ["loaded"], landQ)

# 15) iframe fallback: task NOT in the DOM must load via /task?id=N&kpip=1
#     (the SPA router killed /task/<id>: it redirects '/' — the old frame URL died)
wd.get(bust(f"{BASE}/task"))
for _ in range(15):
    time.sleep(1)
    if int(wd.js("return document.querySelectorAll('.kp-pip-btn').length")) >= 4:
        break
wd.js("""
  const td=document.querySelector('.taskList tbody tr:last-child td:nth-child(2)');
  const b=document.createElement('button');
  b.className='kp-pip-btn'; b.textContent='PiP400001'; b.dataset.task='400001';
  b.title='iframe fallback probe';
  (td||document.body).appendChild(b);
""")
time.sleep(1.5)
pI = json.loads(wd.js("""
  const b=[...document.querySelectorAll('.kp-pip-btn')].find(b=>b.dataset.task==='400001');
  if(!b) return null;
  b.scrollIntoView({block:'center'});
  const r=b.getBoundingClientRect();
  return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});
"""))
wd.click_xy(pI["x"], pI["y"])
iframeSrc = rendI = None
for _ in range(25):
    time.sleep(1)
    iframeSrc = wd.js("const f=document.querySelector('iframe[src*=\"kpip\"]'); return f?f.src:null")
    rendI = wd.js("const de=document.documentElement; return de.dataset.kpRendered||de.dataset.kpRenderErr||null")
    if iframeSrc and iframeSrc != "None" and rendI and rendI != "None":
        break
vaRaw = wd.js("const v=document.querySelector('video'); return v?JSON.stringify({ct:v.currentTime,rs:v.readyState}):null")
vaI = json.loads(vaRaw) if vaRaw and vaRaw != "None" else {}
step("iframe_query_url", bool(iframeSrc) and iframeSrc != "None" and "/task?id=400001&kpip=1" in iframeSrc, iframeSrc)
step("iframe_frame_rendered", bool(rendI) and str(rendI).startswith("880x"), rendI)
step("iframe_stream_alive", (vaI.get("rs") or 0) >= 2 and (vaI.get("ct") or 0) > 0.3, vaI)

# 16) homework (jobs) replica: ⤢ read-mode must FIX the layout there.
#     It used to be a dead toggle: all fluid CSS was scoped under .taskList,
#     homework pages have .task/.text only.
wd.get(bust(f"{BASE}/jobs/c99/task11/hw7"))
for _ in range(10):
    time.sleep(1)
    if int(wd.js("return document.querySelectorAll('.kp-pip-mini').length")) >= 3:
        break
mini = int(wd.js("return document.querySelectorAll('.kp-pip-mini').length"))
step("hw_mini_buttons", mini >= 3, f"mini={mini}")
hwfix = json.loads(wd.js("""
  const de=document.documentElement;
  de.classList.remove('kp-read');
  const off=de.scrollWidth;
  de.classList.add('kp-read');
  const on=de.scrollWidth;
  return JSON.stringify({off,on,vw:innerWidth});
"""))
step("hw_readmode_fixes_layout",
     hwfix["off"] > hwfix["vw"] + 40 and hwfix["on"] <= hwfix["vw"] + 2, hwfix)

# 17) HW PiP: real click on a strip mini button (block 12) renders the live task
pH = json.loads(wd.js("""
  const b=[...document.querySelectorAll('.kp-pip-mini')].find(b=>b.dataset.task==='12');
  if(!b) return null;
  b.scrollIntoView({block:'center'});
  const r=b.getBoundingClientRect();
  return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2});
"""))
wd.js("document.documentElement.dataset.kpRendered=''; document.documentElement.dataset.kpRenderErr=''")
wd.click_xy(pH["x"], pH["y"])
rendH = None
for _ in range(20):
    time.sleep(1)
    d = wd.js("const de=document.documentElement; return de.dataset.kpRendered||de.dataset.kpRenderErr||null")
    if d and d != "None":
        rendH = d
        break
step("hw_pip_from_strip", bool(rendH) and str(rendH).startswith("880x"), rendH)

# 18) wheel scrolls the PiP frame while PiP is open (Mac: no Alt needed).
#     Switch back to task 11 first: it is taller than the frame (task 12 is not).
wd.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',metaKey:true,bubbles:true}))")
scrA = "0/0/0"
for _ in range(15):
    time.sleep(1)
    scrA = wd.js("return document.documentElement.dataset.kpScroll||'0/0/0'")
    if int(scrA.split("/")[2]) > 1240:
        break
wd.js("window.dispatchEvent(new WheelEvent('wheel',{deltaY:600,bubbles:true,cancelable:true}))")
time.sleep(1.2)
scrB = wd.js("return document.documentElement.dataset.kpScroll||'0/0/0'")
ya = int(scrA.split("/")[0])
yb = int(scrB.split("/")[0])
step("wheel_scrolls_frame", yb - ya >= 100, f"{scrA} -> {scrB}")

# 19) Cmd+ArrowRight (Mac) switches tasks — gate accepts metaKey, not only altKey.
#     Task 11 is current after step 18, so → must land on 12.
wd.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',metaKey:true,bubbles:true}))")
cur = None
for _ in range(15):
    time.sleep(1)
    cur = wd.js("return document.querySelector('.block.task-current')?.dataset?.n||null")
    if cur == "12":
        break
step("cmd_arrow_switches", cur == "12", cur)

print("\nRESULT:", json.dumps(r, ensure_ascii=False, indent=1))
ok = all(s["ok"] for s in r["steps"])
print("ALL_OK" if ok else "SOME_FAILED")
wd.delete_session()
sys.exit(0 if ok else 2)
