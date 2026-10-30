#!/usr/bin/env python3
"""Live probe: https://kompege.ru/task with ext installed — where do PiP buttons die?"""
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

def J(expr):
    return wd.js(expr)

out = {}

# 1) landing
wd.get("https://kompege.ru/task?nc=" + str(int(time.time())))
time.sleep(5)
out["landing"] = J("""
  const rows = document.querySelectorAll('.taskList tr');
  const taskRows = [...rows].filter(r => r.querySelector('.number') && r.querySelector('.task-text'));
  const btn = [...document.querySelectorAll('input[type=button]')].map(b => b.value);
  return JSON.stringify({
    rows: rows.length, taskRows: taskRows.length,
    kpBtns: document.querySelectorAll('.kp-pip-btn').length,
    bar: !!document.getElementById('kp-bar'),
    findButtons: btn,
    selectHas: !!document.querySelector('.select-panel select'),
  });
""")

# 2) click "Найти все задачи"
clicked = J("""
  const b = [...document.querySelectorAll('input[type=button]')].find(b => b.value.includes('Найти все'));
  if (!b) return 'no-button';
  b.click(); return 'clicked';
""")
out["click"] = clicked
for i in range(12):
    time.sleep(1.5)
    st = json.loads(J("""
      const taskRows = [...document.querySelectorAll('.taskList tr')]
        .filter(r => r.querySelector('.number') && r.querySelector('.task-text'));
      return JSON.stringify({
        rows: document.querySelectorAll('.taskList tr').length,
        taskRows: taskRows.length,
        kpBtns: document.querySelectorAll('.kp-pip-btn').length,
        firstDetails: (document.querySelector('.taskList .details')||{}).textContent,
        firstNumberHtml: (document.querySelector('.taskList .number')||{}).outerHTML,
        taskTextClass: (document.querySelector('.task-text')||{}).className,
      });
    """))
    out["after_search"] = st
    if st["taskRows"] and st["kpBtns"]:
        break
    if st["taskRows"]:
        break
out["row_html"] = J("""
  const r = document.querySelector('.taskList tr .number');
  return r ? r.closest('tr').outerHTML.slice(0, 600) : 'no-row';
""")

# 3) deep link /task?id=N&kpip=1 — iframe target candidate
wd.get("https://kompege.ru/task?id=31112&kpip=1&nc=" + str(int(time.time())))
time.sleep(6)
out["query_page"] = J("""
  const tl = document.querySelector('.taskList');
  const tt = document.querySelector('.task-text');
  return JSON.stringify({
    url: location.href,
    taskList: !!tl,
    rows: document.querySelectorAll('.taskList tr').length,
    taskText: !!tt,
    details: (document.querySelector('.details')||{}).textContent,
    kpData: document.documentElement.dataset.kpBoot,
  });
""")

# 4) old-style /task/<id> → SPA redirect?
wd.get("https://kompege.ru/task/31112?kpip=1&nc=" + str(int(time.time())))
time.sleep(6)
out["path_page"] = J("""
  return JSON.stringify({url: location.href, taskList: !!document.querySelector('.taskList')});
""")

print(json.dumps(out, ensure_ascii=False, indent=1))
