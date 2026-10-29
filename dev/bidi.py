#!/usr/bin/env python3
"""Minimal WebDriver BiDi client over Firefox --remote-debugging-port (ws endpoint).
Usage:
  python3 bidi.py <scenario.py>
Scenario file imports from bidi: connect(ws_url) etc. Simpler: use functions here directly.
"""
import asyncio, json, base64, os, sys, urllib.request

import websockets

PORT = int(os.environ.get("KP_PORT", "9333"))


def ws_url():
    # Firefox with --remote-debugging-port serves raw BiDi ws at ws://127.0.0.1:PORT/
    # (older builds advertise via /json/version). Prefer direct ws.
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=2) as r:
            u = json.load(r).get("webSocketDebuggerUrl")
            if u:
                return u
    except Exception:
        pass
    return f"ws://127.0.0.1:{PORT}/"


class Bidi:
    def __init__(self, ws):
        self.ws = ws
        self.id = 0
        self.events = []

    async def call(self, cmd, params=None, timeout=20.0):
        self.id += 1
        mid = self.id
        msg = {"id": mid, "cmd": cmd}
        if params is not None:
            msg["params"] = params
        await self.ws.send(json.dumps(msg))
        while True:
            data = json.loads(await asyncio.wait_for(self.ws.recv(), timeout))
            if data.get("id") == mid:
                if "error" in data:
                    raise RuntimeError(f"{cmd}: {json.dumps(data['error'])[:400]}")
                return data.get("result", {})
            # not our reply: event
            self.events.append(data)

    async def evaluate(self, expr, context="default", timeout=25.0):
        """Evaluate JS expression, return JSON-parsed value (expects JSON.stringify in expr)."""
        res = await self.call("script.evaluate", {
            "expression": f"(() => JSON.stringify(({expr})))()",
            "target": {"context": context},
            "awaitPromise": True,
            "resultOwnership": "none",
        }, timeout=timeout)
        inner = res.get("result", {})
        if inner.get("type") != "string":
            raise RuntimeError(f"non-string result: {json.dumps(res)[:300]}")
        return json.loads(inner["value"])

    async def eval_raw(self, expr, context="default", timeout=25.0):
        res = await self.call("script.evaluate", {
            "expression": expr,
            "target": {"context": context},
            "awaitPromise": True,
            "resultOwnership": "none",
        }, timeout=timeout)
        return res.get("result", {})

    async def navigate(self, url, context="default", wait="complete"):
        return await self.call("browsingContext.navigate",
                               {"url": url, "context": context, "wait": wait})

    async def new_context(self, type_="tab"):
        return await self.call("browsingContext.create", {"type": type_})

    async def screenshot(self, path, context="default", origin="viewport"):
        res = await self.call("browsingContext.captureScreenshot",
                              {"context": context, "origin": origin}, timeout=30)
        with open(path, "wb") as f:
            f.write(base64.b64decode(res["data"]))
        return path

    async def click_at(self, x, y, context="default"):
        await self.call("input.performInputActions", {"context": context, "actions": [
            {"type": "pointer", "id": "k", "parameters": {"pointerType": "mouse"},
             "actions": [
                 {"type": "pointerMove", "duration": 0, "x": int(x), "y": int(y)},
                 {"type": "pointerDown", "button": 0},
                 {"type": "pointerUp", "button": 0},
             ]}
        ]})

    async def install_ext(self, path, permanent=False):
        return await self.call("webExtension.install",
                               {"type": "path", "path": path, "permanent": permanent}, timeout=30)

    async def close(self):
        await self.ws.close()


async def connect():
    # wait for endpoint
    import time
    deadline = time.time() + 30
    last = None
    while time.time() < deadline:
        try:
            url = ws_url()
            ws = await websockets.connect(url, max_size=64 * 1024 * 1024)
            b = Bidi(ws)
            await b.call("session.status")
            return b
        except Exception as e:
            last = e
            await asyncio.sleep(0.5)
    raise RuntimeError(f"firefox devtools port not ready: {last}")
