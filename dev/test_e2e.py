#!/usr/bin/env python3
"""E2E: install ext, open mock, check fluid layout, PiP button click -> PiP, scroll."""
import json, sys, time, os
sys.path.insert(0, os.path.dirname(__file__))
from wd import WD

BASE = "http://localhost:8899"

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
wd.get(f"{BASE}/task/31112")
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

wd.screenshot("/tmp/kp_pip.png")

# 7) keyboard scroll changes frame
bands = "const cv=[...document.querySelectorAll('canvas')].find(c=>c.width===880); if(!cv) return JSON.stringify({e:'nocv'}); const ctx=cv.getContext('2d'); const b=(y)=>{const d=ctx.getImageData(0,y,880,420).data;let n=0; for(let i=0;i<d.length;i+=4){if(d[i]<200)n++}return n}; return JSON.stringify([b(90),b(520),b(800)]);"
b1 = wd.js(bands)
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

# 9) zoom: press A+
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

print("\nRESULT:", json.dumps(r, ensure_ascii=False, indent=1))
ok = all(s["ok"] for s in r["steps"])
print("ALL_OK" if ok else "SOME_FAILED")
wd.delete_session()
sys.exit(0 if ok else 2)
