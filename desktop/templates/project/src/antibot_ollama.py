"""Rozwiazywanie captchy eMAG przez Ollama (vision) + klik (myszka / Playwright)."""

from __future__ import annotations

import asyncio
import base64
import json
import math
import os
import platform
import random
import re
import subprocess
import time
import urllib.error
import urllib.request
from typing import Any

OLLAMA_PROMPT = """This is an eMAG image-grid captcha (3x3). Tiles numbered 0..8 left→right, top→bottom.

Read the instruction ABOVE the grid (Romanian or English).

Critical object rules:
- draperii / curtains = fabric hanging on a WINDOW or door (vertical folds, rod). NOT a bed, mattress, duvet, headboard, sofa.
- găleți / buckets = container/pail. NOT bags or hats.
- geantă / bags = handbags/totes. NOT buckets.

Select EVERY matching tile. Reject beds/furniture when the target is curtains.

Return ONLY JSON (look at THIS image, do not invent):
{"instruction":"...","target":"...","seen":["t0","t1","t2","t3","t4","t5","t6","t7","t8"],"cells":[...],"note":"..."}
"cells" = matching tile indexes 0..8. "seen" = exactly 9 short labels from the image.
"""


TILE_MATCH_PROMPT = """Captcha instruction: {instruction}

Does THIS single tile match the instruction (should it be clicked)?

Rules:
- If instruction asks for draperii/curtains: YES only if the main subject is curtain fabric on a window/door.
  NO if the main subject is a bed, mattress, duvet, pillow, or furniture (even if fabric is visible).
- If instruction asks for găleți/buckets: YES only for a bucket/pail container.
- If instruction asks for bags/geantă: YES only for handbags/totes.

JSON only: {{"match":true_or_false,"what":"one short label of the main object"}}
"""

# Oficjalny prompt z AlibabaResearch/captcha-mind (react_agent.py PROMPT_TEMPLATE).
CAPTCHAMIND_PROMPT = """You are a captcha solver and your task is to solve a captcha step by step.
{instruction}
At each step, your generation should have exactly the following format:
<think>Your reasoning process to understand the task, analyze the image, and decide what action to take.</think>
<tool_call>{{"name": <function-name>, "arguments": <args-json-object>}}</tool_call>

Your available actions are click, drag and enter_number(if there is an input box in the image), examples are:
1. {{"name": "click", "arguments": {{"position": [100, 150]}}}}
2. {{"name": "drag", "arguments": {{"from": [100, 150], "to": [100, 200]}}}}
3. {{"name": "enter_number", "arguments": {{"number": 47}}}}

You should only take an action at a step. After each step, you obtain an observation.

You can click the submit button to submit the final result.
"""


def enrich_instruction(page_hint: str = "") -> str:
    """Buduje instruction jak w CaptchaMind image_select + kontekst eMAG."""
    raw = (page_hint or "").strip()
    line = raw.split("|")[0].strip() if raw else ""
    if not line:
        line = "Select all tiles that match the object named in the captcha text above the grid."
    # Oficjalny styl: jasna instrukcja zadania + submit
    return (
        f"{line}\n"
        "This is an image-select / patch-select captcha (3x3 grid). "
        "Click the center of EVERY matching tile (one click per step). "
        "When all matching tiles are selected, click the orange Validați / Confirm / submit button. "
        "Coordinates [x, y] are pixel positions on the provided image (origin at top-left)."
    )


def build_ollama_prompt(page_hint: str = "") -> str:
    hint = (page_hint or "").strip()
    if not hint:
        return OLLAMA_PROMPT
    return OLLAMA_PROMPT + "\n\nVisible page text (helper): " + hint[:400]


def build_captchamind_prompt(page_hint: str = "") -> str:
    return CAPTCHAMIND_PROMPT.format(instruction=enrich_instruction(page_hint)[:700])


def is_captchamind_model(model: str) -> bool:
    return "captchamind" in (model or "").lower()


# Fallback gdy brak bbox captchy (viewport 1280x900).
_DEFAULT_CELL_CENTERS: list[tuple[float, float]] = [
    (0.410, 0.370), (0.500, 0.370), (0.590, 0.370),
    (0.410, 0.490), (0.500, 0.490), (0.590, 0.490),
    (0.410, 0.610), (0.500, 0.610), (0.590, 0.610),
]
_DEFAULT_VALIDATE = (0.575, 0.720)


def resolve_ollama_base_url(explicit: str = "") -> str:
    if explicit and explicit.strip() and explicit.strip() != "auto":
        return explicit.strip().rstrip("/")

    env = (os.environ.get("OLLAMA_URL") or os.environ.get("OLLAMA_HOST") or "").strip()
    if env:
        if env.startswith("http://") or env.startswith("https://"):
            return env.rstrip("/")
        if not env.startswith("0.0.0.0") and not env.startswith("["):
            return f"http://{env}".rstrip("/")

    candidates = [
        "http://127.0.0.1:11434",
        "http://host.orb.internal:11434",
        "http://host.docker.internal:11434",
        "http://192.168.215.1:11434",
        "http://192.168.61.1:11434",
    ]
    for url in candidates:
        if _ollama_ping(url, timeout=1.5):
            return url
    return candidates[0]


def _ollama_ping(base_url: str, timeout: float = 1.5) -> bool:
    try:
        req = urllib.request.Request(base_url.rstrip("/") + "/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except Exception:  # noqa: BLE001
        return False


def prefer_real_mouse_default() -> bool:
    flag = (os.environ.get("CRAWL_REAL_MOUSE") or "").strip().lower()
    if flag in {"1", "true", "yes", "on"}:
        return True
    if flag in {"0", "false", "no", "off"}:
        return False
    return platform.system() == "Darwin"


def _ollama_chat(
    *,
    base_url: str,
    model: str,
    image_b64: str,
    prompt: str = OLLAMA_PROMPT,
    timeout: float = 180.0,
) -> dict[str, Any]:
    url = base_url.rstrip("/") + "/api/chat"
    json_schema = {
        "type": "object",
        "properties": {
            "instruction": {"type": "string"},
            "target": {"type": "string"},
            "seen": {"type": "array", "items": {"type": "string"}},
            "cells": {"type": "array", "items": {"type": "integer"}},
            "note": {"type": "string"},
        },
        "required": ["instruction", "target", "seen", "cells", "note"],
    }
    body: dict[str, Any] = {
        "model": model,
        "stream": False,
        "format": json_schema,
        "think": False,
        "messages": [
            {
                "role": "user",
                "content": prompt,
                "images": [image_b64],
            }
        ],
        "options": {
            "temperature": 0.0,
            "num_predict": 280,
        },
        "keep_alive": "30m",
    }
    data = json.dumps(body).encode("utf-8")
    print(f"  [OLLAMA] POST {url} model={model} image_kb={len(image_b64) // 1024} ...")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = json.loads(resp.read().decode("utf-8"))
    msg = raw.get("message") if isinstance(raw.get("message"), dict) else {}
    content = str(msg.get("content") or "").strip()
    thinking = str(msg.get("thinking") or "").strip()
    if _is_empty_plan_text(content) and thinking:
        print(f"  [OLLAMA] content pusty/{{}}, biorę thinking ({len(thinking)} znakow)")
        content = thinking
    if len(content) < 40:
        print(f"  [OLLAMA] odpowiedz {len(content)} znakow raw={content!r}")
    else:
        print(f"  [OLLAMA] odpowiedz {len(content)} znakow")
    return _parse_actions_json(content)


def _is_empty_plan_text(content: str) -> bool:
    s = (content or "").strip()
    if not s or s in {"{}", "[]", "null", '""'}:
        return True
    try:
        data = json.loads(s)
    except json.JSONDecodeError:
        return False
    if not isinstance(data, dict):
        return True
    return not data.get("cells") and not data.get("actions")


def _parse_actions_json(content: str) -> dict[str, Any]:
    if not content:
        return {"actions": [], "cells": [], "note": "empty"}
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.I)
    cleaned = re.sub(r"</?think>", "", cleaned, flags=re.I)
    for candidate in (cleaned, content):
        try:
            data = json.loads(candidate)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    matches = list(re.finditer(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", content))
    if not matches:
        matches = list(re.finditer(r"\{[\s\S]*\}", content))
    for match in reversed(matches):
        try:
            data = json.loads(match.group(0))
            if isinstance(data, dict) and (
                data.get("cells") is not None or data.get("actions") is not None
            ):
                return data
        except json.JSONDecodeError:
            continue
    return {"actions": [], "cells": [], "note": f"bad_json:{content[:120]}"}


def plan_to_cells(plan: dict[str, Any]) -> list[int]:
    out: list[int] = []
    cells = plan.get("cells") if isinstance(plan, dict) else None
    if isinstance(cells, list):
        for c in cells:
            try:
                idx = int(c)
            except (TypeError, ValueError):
                continue
            if 0 <= idx <= 8 and idx not in out:
                out.append(idx)
    return out


def plan_to_actions(plan: dict[str, Any]) -> list[dict[str, Any]]:
    cells = plan_to_cells(plan)
    actions: list[dict[str, Any]] = []
    for idx in cells:
        x, y = _DEFAULT_CELL_CENTERS[idx]
        actions.append({"type": "click", "x": x, "y": y, "cell": idx})
    if cells:
        vx, vy = _DEFAULT_VALIDATE
        actions.append({"type": "validate", "x": vx, "y": vy})
    return actions


_DETECT_TILES_JS = """() => {
  const pickRects = (root) => {
    const out = [];
    const nodes = root.querySelectorAll('img, canvas, [role="img"], td, div, span, a, button');
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (r.width < 50 || r.height < 50 || r.width > 280 || r.height > 280) continue;
      if (Math.abs(r.width - r.height) > 40) continue;
      if (r.bottom < 80 || r.top > (window.innerHeight - 40)) continue;
      out.push({
        x: r.x, y: r.y, w: r.width, h: r.height,
        cx: r.x + r.width / 2, cy: r.y + r.height / 2
      });
    }
    return out;
  };

  let rects = pickRects(document);
  if (rects.length >= 9) {
    rects.sort((a, b) => a.w * a.h - b.w * b.h);
    const mid = rects[Math.floor(rects.length / 2)];
    const area = mid.w * mid.h;
    rects = rects.filter(r => {
      const a = r.w * r.h;
      return a > area * 0.7 && a < area * 1.35;
    });
  }
  rects.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const uniq = [];
  for (const r of rects) {
    if (uniq.some(u => Math.hypot(u.cx - r.cx, u.cy - r.cy) < 20)) continue;
    uniq.push(r);
  }
  let tiles = uniq.slice(0, 12);
  if (tiles.length >= 9) {
    tiles = tiles.slice(0, 9);
    tiles.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  }

  const btnTexts = ['validați', 'validati', 'validate', 'verify', 'submit', 'confirm', 'ok'];
  let validate = null;
  let yellow = null;
  for (const el of document.querySelectorAll('button, a, input[type=button], input[type=submit], [role=button], div[class]')) {
    const t = ((el.innerText || el.value || '') + '').toLowerCase().trim();
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 20 || r.width > 420) continue;
    let isYellow = false;
    try {
      const bg = getComputedStyle(el).backgroundColor || '';
      const m = bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      if (m) {
        const R=+m[1], G=+m[2], B=+m[3];
        isYellow = R > 190 && G > 140 && B < 120;
      }
    } catch (e) {}
    const hitText = btnTexts.some(b => t.includes(b));
    if (isYellow && (hitText || t.length < 24)) {
      yellow = { cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height, text: t || 'yellow' };
    }
    if (hitText && !validate) {
      validate = { cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height, text: t };
    }
  }
  if (yellow) validate = yellow;
  return { tiles, validate, tileCount: tiles.length };
}"""


async def detect_captcha_layout(page: Any) -> dict[str, Any]:
    contexts: list[Any] = [page]
    try:
        contexts.extend(page.frames)
    except Exception:  # noqa: BLE001
        pass

    best: dict[str, Any] = {"tiles": [], "validate": None, "tileCount": 0, "frame": None}
    for ctx in contexts:
        try:
            data = await ctx.evaluate(_DETECT_TILES_JS)
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(data, dict):
            continue
        n = int(data.get("tileCount") or len(data.get("tiles") or []))
        if n > int(best.get("tileCount") or 0):
            best = {**data, "frame": ctx, "tileCount": n}
        elif n == 0 and data.get("validate") and not best.get("validate"):
            best = {**data, "frame": ctx, "tileCount": n}
    return best


async def click_cells_dom(
    page: Any,
    cells: list[int],
    *,
    metrics: dict[str, float],
    captcha_box: dict[str, float] | None = None,
) -> int:
    """Klik w kafle: DOM box tiles → layout detect → bbox → stale coords."""
    if not cells:
        return 0
    box_tiles = list((captcha_box or {}).get("tiles") or [])
    layout = await detect_captcha_layout(page)
    tiles = box_tiles if len(box_tiles) >= 9 else list(layout.get("tiles") or [])
    validate = layout.get("validate")
    print(f"  [OLLAMA] DOM tiles={len(tiles)} validate={'tak' if validate else 'nie'}")

    done = 0
    iw = max(1.0, metrics.get("iw") or 1280.0)
    ih = max(1.0, metrics.get("ih") or 900.0)

    for idx in cells:
        if 0 <= idx < len(tiles):
            t = tiles[idx]
            x, y = float(t["cx"]), float(t["cy"])
            print(f"  [OLLAMA] DOM cell {idx} -> ({x:.0f},{y:.0f})")
        elif captcha_box and 0 <= idx <= 8:
            x, y = cell_page_coords(captcha_box, idx)
            print(f"  [OLLAMA] box cell {idx} -> ({x:.0f},{y:.0f})")
        elif 0 <= idx <= 8:
            nx, ny = _DEFAULT_CELL_CENTERS[idx]
            x, y = nx * iw, ny * ih
            print(f"  [OLLAMA] fallback cell {idx} -> ({x:.0f},{y:.0f})")
        else:
            continue
        await page.mouse.click(x, y)
        done += 1
        await asyncio.sleep(random.uniform(0.08, 0.18))

    if await click_yellow_confirm(page, captcha_box=captcha_box, metrics=metrics):
        done += 1
    elif validate and isinstance(validate, dict):
        x, y = float(validate["cx"]), float(validate["cy"])
        print(f"  [OLLAMA] DOM Confirm/Validați -> ({x:.0f},{y:.0f})")
        await page.mouse.click(x, y)
        done += 1
    else:
        clicked = False
        for label in ("Confirm", "Validați", "Validati", "Validate", "Verify"):
            try:
                loc = page.get_by_role("button", name=re.compile(label, re.I))
                if await loc.count() > 0:
                    await loc.first.click(timeout=1500)
                    print(f"  [OLLAMA] klik button {label!r}")
                    done += 1
                    clicked = True
                    break
            except Exception:  # noqa: BLE001
                continue
        if not clicked:
            if captcha_box:
                x = captcha_box["x"] + captcha_box["w"] * 0.72
                y = captcha_box["y"] + captcha_box["h"] * 0.92
            else:
                vx, vy = _DEFAULT_VALIDATE
                x, y = vx * iw, vy * ih
            print(f"  [OLLAMA] fallback Confirm -> ({x:.0f},{y:.0f})")
            await page.mouse.click(x, y)
            done += 1
    await asyncio.sleep(0.35)
    return done


async def click_yellow_confirm(
    page: Any,
    *,
    captcha_box: dict[str, float] | None = None,
    metrics: dict[str, float] | None = None,
) -> bool:
    """Klika zolty Confirm / Validați (eMAG)."""
    try:
        hit = await page.evaluate(
            """() => {
              const nodes = [...document.querySelectorAll(
                'button, a, input[type=button], input[type=submit], [role=button], div, span'
              )];
              const scored = [];
              for (const el of nodes) {
                const t = ((el.innerText || el.value || '') + '').replace(/\\s+/g,' ').trim();
                const r = el.getBoundingClientRect();
                if (r.width < 48 || r.height < 22 || r.width > 480 || r.bottom < 40) continue;
                let R=0,G=0,B=0, isYellow=false;
                try {
                  const bg = getComputedStyle(el).backgroundColor || '';
                  const m = bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
                  if (m) { R=+m[1]; G=+m[2]; B=+m[3]; isYellow = R>185 && G>135 && B<130; }
                } catch (e) {}
                const low = t.toLowerCase();
                const hitText = /confirm|valida|verify|submit|ok\\b/.test(low);
                if (!isYellow && !hitText) continue;
                if (t.length > 40) continue;
                let score = 0;
                if (isYellow) score += 5;
                if (hitText) score += 4;
                if (/confirm|valida/.test(low)) score += 3;
                scored.push({score, cx:r.x+r.width/2, cy:r.y+r.height/2, text:t||'yellow', yellow:isYellow});
              }
              scored.sort((a,b)=>b.score-a.score);
              return scored[0] || null;
            }"""
        )
    except Exception:  # noqa: BLE001
        hit = None

    if isinstance(hit, dict) and hit.get("cx") is not None:
        x, y = float(hit["cx"]), float(hit["cy"])
        print(
            f"  [OLLAMA] zolty/Confirm -> ({x:.0f},{y:.0f}) "
            f"text={hit.get('text')!r} yellow={hit.get('yellow')}"
        )
        await page.mouse.click(x, y)
        return True

    for label in ("Confirm", "Validați", "Validati", "Validate"):
        try:
            loc = page.get_by_role("button", name=re.compile(rf"^{label}$|{label}", re.I))
            if await loc.count() > 0:
                await loc.first.click(timeout=1200)
                print(f"  [OLLAMA] Confirm button {label!r}")
                return True
        except Exception:  # noqa: BLE001
            continue

    iw = float((metrics or {}).get("iw") or 1280.0)
    ih = float((metrics or {}).get("ih") or 900.0)
    if captcha_box:
        x = captcha_box["x"] + captcha_box["w"] * 0.72
        y = captcha_box["y"] + captcha_box["h"] * 0.92
    else:
        vx, vy = _DEFAULT_VALIDATE
        x, y = vx * iw, vy * ih
    print(f"  [OLLAMA] fallback zolty Confirm -> ({x:.0f},{y:.0f})")
    await page.mouse.click(x, y)
    return True


async def refresh_captcha(page: Any) -> bool:
    """Klik ikony odswiezenia zagadki (zeby nie odklikiwac starych zaznaczen)."""
    try:
        ok = await page.evaluate(
            """() => {
              const icons = [...document.querySelectorAll('button, a, div, span, svg, img')];
              for (const el of icons) {
                const t = ((el.getAttribute('aria-label')||'') + ' ' + (el.title||'') + ' ' + (el.className||'')).toLowerCase();
                const r = el.getBoundingClientRect();
                if (r.width < 10 || r.width > 60 || r.height < 10 || r.height > 60) continue;
                if (/refresh|reload|new|again|reset|sync/.test(t)) {
                  el.click();
                  return true;
                }
              }
              // czesto pierwsza mala ikona pod siatka po lewej
              return false;
            }"""
        )
        if ok:
            print("  [OLLAMA] odswiezono zagadke")
            await asyncio.sleep(1.5)
            return True
    except Exception:  # noqa: BLE001
        pass
    return False


def _clamp01(v: float) -> float:
    return max(0.0, min(1.0, float(v)))


def _get_pyautogui() -> Any:
    import pyautogui

    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.02
    return pyautogui


def focus_chromium_window() -> None:
    scripts = [
        [
            "osascript",
            "-e",
            'tell application "System Events" to set frontmost of '
            'first process whose name contains "Chromium" to true',
        ],
        [
            "osascript",
            "-e",
            'tell application "System Events" to set frontmost of '
            'first process whose name contains "Chrome" to true',
        ],
    ]
    for cmd in scripts:
        try:
            subprocess.run(cmd, check=False, capture_output=True, timeout=3)
            return
        except (OSError, subprocess.TimeoutExpired):
            continue


def viewport_to_screen(
    nx: float,
    ny: float,
    *,
    metrics: dict[str, float],
    img_w: int,
    img_h: int,
) -> tuple[float, float]:
    nx, ny = _clamp01(nx), _clamp01(ny)
    chrome_h = max(0.0, metrics["oh"] - metrics["ih"])
    chrome_w = max(0.0, (metrics["ow"] - metrics["iw"]) / 2.0)
    page_x = nx * metrics["iw"]
    page_y = ny * metrics["ih"]
    sx = metrics["sx"] + chrome_w + page_x
    sy = metrics["sy"] + chrome_h + page_y
    _ = img_w, img_h
    return sx, sy


def human_move_to(pag: Any, x: float, y: float, duration: float | None = None) -> None:
    duration = duration if duration is not None else random.uniform(0.25, 0.55)
    pag.moveTo(x, y, duration=duration, tween=_ease_out_quad)


def human_click(pag: Any, x: float, y: float) -> None:
    human_move_to(pag, x, y)
    time.sleep(random.uniform(0.05, 0.15))
    pag.click()


def human_drag(pag: Any, x1: float, y1: float, x2: float, y2: float) -> None:
    human_move_to(pag, x1, y1, duration=random.uniform(0.2, 0.4))
    time.sleep(random.uniform(0.08, 0.18))
    pag.mouseDown()
    steps = random.randint(28, 48)
    for i in range(1, steps + 1):
        t = i / steps
        ease = 1.0 - (1.0 - t) ** 2.2
        if i == steps - 2 and abs(x2 - x1) > 40:
            ease = min(1.05, ease + 0.03)
        x = x1 + (x2 - x1) * ease + random.gauss(0, 1.2)
        y = y1 + (y2 - y1) * ease + random.gauss(0, 0.7)
        pag.moveTo(x, y, duration=random.uniform(0.008, 0.025))
    pag.moveTo(x2 + random.uniform(-1, 1), y2 + random.uniform(-1, 1), duration=0.05)
    time.sleep(random.uniform(0.05, 0.12))
    pag.mouseUp()


def _ease_out_quad(n: float) -> float:
    return 1.0 - (1.0 - n) ** 2


async def read_window_metrics(page: Any) -> dict[str, float]:
    data = await page.evaluate(
        """() => ({
            sx: window.screenX,
            sy: window.screenY,
            ow: window.outerWidth,
            oh: window.outerHeight,
            iw: window.innerWidth,
            ih: window.innerHeight,
            dpr: window.devicePixelRatio || 1
        })"""
    )
    return {k: float(data.get(k) or 0) for k in ("sx", "sy", "ow", "oh", "iw", "ih", "dpr")}


_FIND_CAPTCHA_JS = """() => {
  const all = [...document.querySelectorAll('button, a, div, span, p, h1, h2, h3, label')];
  let btn = null, instr = null;
  for (const el of all) {
    const t = ((el.innerText || el.value || '') + '').replace(/\\s+/g,' ').trim();
    if (!t || t.length > 120) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (!btn && /valida|confirm|verify/i.test(t) && r.width > 50 && r.height > 20) btn = el;
    if (!instr && /alege|select all|choose all|găleț|galet|draper|curtain|bucket|geant|bag/i.test(t) && t.length < 100) instr = el;
  }

  const tiles = [];
  for (const el of document.querySelectorAll('img, canvas')) {
    const r = el.getBoundingClientRect();
    if (r.width < 70 || r.height < 70 || r.width > 300 || r.height > 300) continue;
    if (Math.abs(r.width - r.height) > 55) continue;
    if (el.tagName === 'IMG' && (!el.complete || (el.naturalWidth || 0) < 16)) continue;
    tiles.push({
      x: r.x, y: r.y, w: r.width, h: r.height,
      cx: r.x + r.width / 2, cy: r.y + r.height / 2
    });
  }
  tiles.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const uniq = [];
  for (const t of tiles) {
    if (uniq.some(u => Math.hypot(u.cx - t.cx, u.cy - t.cy) < 25)) continue;
    uniq.push(t);
  }
  let grid = uniq.slice(0, 12);
  if (grid.length >= 9) {
    grid = grid.slice(0, 9);
    grid.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const left = Math.min(...grid.map(t => t.x)) - 12;
    const top = Math.min(...grid.map(t => t.y)) - 70;
    const right = Math.max(...grid.map(t => t.x + t.w)) + 12;
    const bottom = Math.max(...grid.map(t => t.y + t.h)) + 90;
    return {
      x: Math.max(0, left),
      y: Math.max(0, top),
      w: Math.min(window.innerWidth - Math.max(0, left), right - left),
      h: Math.min(window.innerHeight - Math.max(0, top), bottom - top),
      tiles: grid,
      instr: instr ? ((instr.innerText || '') + '').trim().slice(0, 120) : '',
      ready: true
    };
  }

  if (!btn && !instr) return null;
  let node = btn || instr;
  for (let i = 0; i < 10 && node; i++) {
    const r = node.getBoundingClientRect();
    if (r.width >= 280 && r.width <= 780 && r.height >= 320 && r.height <= 980) {
      return {x:r.x, y:r.y, w:r.width, h:r.height, tiles: [], instr: instr ? ((instr.innerText||'')+'').trim().slice(0,120) : '', ready: false};
    }
    node = node.parentElement;
  }
  const parts = [btn, instr].filter(Boolean).map(el => el.getBoundingClientRect());
  if (!parts.length) return null;
  const left = Math.min(...parts.map(p => p.left)) - 40;
  const top = Math.min(...parts.map(p => p.top)) - 80;
  const right = Math.max(...parts.map(p => p.right)) + 40;
  const bottom = Math.max(...parts.map(p => p.bottom)) + 160;
  return {
    x: Math.max(0, left),
    y: Math.max(0, top),
    w: Math.min(window.innerWidth, right - left),
    h: Math.min(window.innerHeight, bottom - top),
    tiles: [],
    instr: instr ? ((instr.innerText || '') + '').trim().slice(0, 120) : '',
    ready: false
  };
}"""


async def _contexts(page: Any) -> list[Any]:
    out: list[Any] = [page]
    try:
        out.extend(page.frames)
    except Exception:  # noqa: BLE001
        pass
    return out


async def _frame_offset(page: Any, ctx: Any) -> tuple[float, float]:
    if ctx is page:
        return 0.0, 0.0
    try:
        el = await ctx.frame_element()
        box = await el.bounding_box()
        if box:
            return float(box["x"]), float(box["y"])
    except Exception:  # noqa: BLE001
        pass
    return 0.0, 0.0


async def find_captcha_box(page: Any) -> dict[str, float] | None:
    best: dict[str, Any] | None = None
    best_tiles = -1
    for ctx in await _contexts(page):
        try:
            data = await ctx.evaluate(_FIND_CAPTCHA_JS)
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(data, dict):
            continue
        ox, oy = await _frame_offset(page, ctx)
        tiles = list(data.get("tiles") or [])
        for t in tiles:
            t["x"] = float(t["x"]) + ox
            t["y"] = float(t["y"]) + oy
            t["cx"] = float(t["cx"]) + ox
            t["cy"] = float(t["cy"]) + oy
        box = {
            "x": float(data["x"]) + ox,
            "y": float(data["y"]) + oy,
            "w": float(data["w"]),
            "h": float(data["h"]),
            "tiles": tiles,
            "instr": str(data.get("instr") or ""),
            "ready": bool(data.get("ready")),
        }
        n = len(tiles)
        if n > best_tiles or (n == best_tiles and box.get("ready")):
            best = box
            best_tiles = n
    if not best:
        return None
    if best["w"] < 180 or best["h"] < 180:
        return None
    return best


async def wait_for_captcha_ready(page: Any, timeout: float = 18.0) -> dict[str, float] | None:
    """Czeka az siatka 3x3 (9 obrazkow) sie zaladuje — inaczej Ollama dostaje pusty screen."""
    deadline = time.monotonic() + timeout
    last: dict[str, float] | None = None
    while time.monotonic() < deadline:
        box = await find_captcha_box(page)
        last = box
        n = len((box or {}).get("tiles") or []) if box else 0
        if box and n >= 9:
            print(f"  [OLLAMA] siatka gotowa: 9 kafelkow DOM, box={box['w']:.0f}x{box['h']:.0f}")
            await asyncio.sleep(0.35)
            return box
        if box and box.get("instr"):
            print(f"  [OLLAMA] czekam na obrazki siatki (instr={box.get('instr')!r}, tiles={n})...")
        await asyncio.sleep(0.45)
    print(f"  [OLLAMA] timeout gotowosci siatki (tiles={len((last or {}).get('tiles') or [])})")
    return last


def _annotate_numbered_grid(png: bytes) -> bytes:
    try:
        from io import BytesIO

        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return png

    im = Image.open(BytesIO(png)).convert("RGBA")
    w, h = im.size
    left, top = int(w * 0.10), int(h * 0.22)
    right, bottom = int(w * 0.90), int(h * 0.72)
    cw, ch = (right - left) / 3.0, (bottom - top) / 3.0
    overlay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    try:
        font = ImageFont.truetype(
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            max(18, int(min(cw, ch) * 0.28)),
        )
    except Exception:  # noqa: BLE001
        try:
            font = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                max(18, int(min(cw, ch) * 0.28)),
            )
        except Exception:  # noqa: BLE001
            font = ImageFont.load_default()

    for idx in range(9):
        row, col = divmod(idx, 3)
        cx = left + (col + 0.5) * cw
        cy = top + (row + 0.5) * ch
        r = max(14, int(min(cw, ch) * 0.18))
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 120, 0, 210))
        label = str(idx)
        bbox = draw.textbbox((0, 0), label, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((cx - tw / 2, cy - th / 2 - 1), label, fill=(255, 255, 255, 255), font=font)

    out = Image.alpha_composite(im, overlay).convert("RGB")
    buf = BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


def cell_page_coords(box: dict[str, float], idx: int) -> tuple[float, float]:
    tiles = box.get("tiles") if isinstance(box, dict) else None
    if isinstance(tiles, list) and 0 <= idx < len(tiles):
        t = tiles[idx]
        if isinstance(t, dict) and "cx" in t and "cy" in t:
            return float(t["cx"]), float(t["cy"])
    row, col = divmod(idx, 3)
    left = box["x"] + box["w"] * 0.10
    top = box["y"] + box["h"] * 0.22
    right = box["x"] + box["w"] * 0.90
    bottom = box["y"] + box["h"] * 0.72
    cw = (right - left) / 3.0
    ch = (bottom - top) / 3.0
    return left + (col + 0.5) * cw, top + (row + 0.5) * ch


async def screenshot_captcha_b64(page: Any) -> tuple[str, int, int, dict[str, float] | None]:
    box = await find_captcha_box(page)
    clip = None
    if box:
        metrics = await read_window_metrics(page)
        iw = float(metrics.get("iw") or 1280)
        ih = float(metrics.get("ih") or 900)
        x = max(0.0, box["x"])
        y = max(0.0, box["y"])
        w = min(box["w"], iw - x)
        h = min(box["h"], ih - y)
        if w > 180 and h > 180:
            clip = {"x": x, "y": y, "width": w, "height": h}
            box = {**box, "x": x, "y": y, "w": w, "h": h}
            print(f"  [OLLAMA] crop captcha {w:.0f}x{h:.0f} @ ({x:.0f},{y:.0f})")

    if clip:
        png = await page.screenshot(type="png", clip=clip)
    else:
        png = await page.screenshot(type="png", full_page=False)
        print("  [OLLAMA] brak bbox captchy — pełny screenshot")

    png = _annotate_numbered_grid(png)
    if len(png) >= 24 and png[:8] == b"\x89PNG\r\n\x1a\n":
        w = int.from_bytes(png[16:20], "big")
        h = int.from_bytes(png[20:24], "big")
    else:
        w, h = 1280, 900
    return base64.b64encode(png).decode("ascii"), w, h, box


def _split_grid_tiles(png: bytes, box: dict[str, float] | None) -> list[bytes]:
    """Wycina 9 kafelkow z cropa captchy (albo ze srodka pelnego screena)."""
    try:
        from io import BytesIO

        from PIL import Image
    except ImportError:
        return []

    im = Image.open(BytesIO(png)).convert("RGB")
    w, h = im.size
    tiles_meta = (box or {}).get("tiles") if box else None
    if box and isinstance(tiles_meta, list) and len(tiles_meta) >= 9 and box.get("w"):
        out: list[bytes] = []
        ox, oy = float(box["x"]), float(box["y"])
        for i in range(9):
            t = tiles_meta[i]
            x0 = int(float(t["x"]) - ox)
            y0 = int(float(t["y"]) - oy)
            x1 = int(x0 + float(t["w"]))
            y1 = int(y0 + float(t["h"]))
            pad = 1
            crop = im.crop(
                (max(0, x0 + pad), max(0, y0 + pad), min(w, x1 - pad), min(h, y1 - pad))
            )
            crop = crop.resize((160, 160))
            buf = BytesIO()
            crop.save(buf, format="JPEG", quality=80, optimize=True)
            out.append(buf.getvalue())
        return out

    left, top = int(w * 0.10), int(h * 0.22)
    right, bottom = int(w * 0.90), int(h * 0.72)
    if not box:
        left, top = int(w * 0.32), int(h * 0.28)
        right, bottom = int(w * 0.68), int(h * 0.68)
    cw = (right - left) / 3.0
    ch = (bottom - top) / 3.0
    tiles: list[bytes] = []
    pad = 2
    for idx in range(9):
        row, col = divmod(idx, 3)
        x0 = int(left + col * cw) + pad
        y0 = int(top + row * ch) + pad
        x1 = int(left + (col + 1) * cw) - pad
        y1 = int(top + (row + 1) * ch) - pad
        crop = im.crop((max(0, x0), max(0, y0), min(w, x1), min(h, y1)))
        crop = crop.resize((160, 160))
        buf = BytesIO()
        crop.save(buf, format="JPEG", quality=80, optimize=True)
        tiles.append(buf.getvalue())
    return tiles


def _save_debug_png(png: bytes, tag: str = "captcha") -> None:
    try:
        from pathlib import Path

        d = Path(os.environ.get("CRAWL_DEBUG_DIR") or "output")
        d.mkdir(parents=True, exist_ok=True)
        path = d / f"debug_{tag}_{int(time.time())}.png"
        path.write_bytes(png)
        print(f"  [OLLAMA] debug screenshot -> {path} ({len(png) // 1024} KB)")
    except Exception as exc:  # noqa: BLE001
        print(f"  [OLLAMA] debug save fail: {exc}")


def _to_jpeg_b64(png: bytes, *, max_side: int = 900, quality: int = 85) -> str:
    try:
        from io import BytesIO

        from PIL import Image
    except ImportError:
        return base64.b64encode(png).decode("ascii")
    im = Image.open(BytesIO(png)).convert("RGB")
    w, h = im.size
    scale = min(1.0, float(max_side) / float(max(w, h, 1)))
    if scale < 0.999:
        im = im.resize((max(1, int(w * scale)), max(1, int(h * scale))))
    buf = BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _classify_one_tile(
    *,
    base_url: str,
    model: str,
    instruction: str,
    tile_png: bytes,
    idx: int,
) -> tuple[int, bool, str]:
    prompt = TILE_MATCH_PROMPT.format(instruction=instruction or "select matching objects")
    b64 = base64.b64encode(tile_png).decode("ascii")
    url = base_url.rstrip("/") + "/api/chat"
    body = {
        "model": model,
        "stream": False,
        "format": {
            "type": "object",
            "properties": {
                "match": {"type": "boolean"},
                "what": {"type": "string"},
            },
            "required": ["match", "what"],
        },
        "think": False,
        "messages": [{"role": "user", "content": prompt, "images": [b64]}],
        "options": {"temperature": 0.0, "num_predict": 40},
        "keep_alive": "30m",
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        content = str(((raw.get("message") or {}).get("content") or "")).strip()
        data = _parse_actions_json(content)
        match = bool(data.get("match"))
        what = str(data.get("what") or "")
        return idx, match, what
    except Exception as exc:  # noqa: BLE001
        print(f"  [OLLAMA] tile {idx} blad: {type(exc).__name__}: {exc}")
        return idx, False, "error"


def classify_tiles_with_ollama(
    *,
    base_url: str,
    model: str,
    instruction: str,
    tile_pngs: list[bytes],
) -> tuple[list[int], list[str]]:
    """Klasyfikuje 9 kafelkow osobno — unikamy kopiowania przykladu z promptu."""
    from concurrent.futures import ThreadPoolExecutor, as_completed

    seen = [""] * 9
    cells: list[int] = []
    # Ollama i tak serializuje GPU, ale mniejsze timeouty / JPEG i tak przyspieszaja.
    with ThreadPoolExecutor(max_workers=min(9, len(tile_pngs) or 1)) as pool:
        futs = [
            pool.submit(
                _classify_one_tile,
                base_url=base_url,
                model=model,
                instruction=instruction,
                tile_png=png,
                idx=i,
            )
            for i, png in enumerate(tile_pngs)
        ]
        for fut in as_completed(futs):
            idx, match, what = fut.result()
            seen[idx] = what
            print(f"  [OLLAMA] tile {idx}: match={match} what={what!r}")
            if match:
                cells.append(idx)
    cells.sort()
    return cells, seen


async def read_captcha_hint(page: Any) -> str:
    try:
        text = await page.inner_text("body")
    except Exception:  # noqa: BLE001
        return ""
    lines = [ln.strip() for ln in (text or "").splitlines() if ln.strip()]
    interesting: list[str] = []
    for ln in lines:
        low = ln.lower()
        if any(
            k in low
            for k in (
                "alegeți",
                "alegeti",
                "select all",
                "choose all",
                "confirm",
                "curtain",
                "draper",
                "găleț",
                "galet",
                "draper",
                "bucket",
                "bag",
                "geant",
                "curtain",
                "validați",
                "validati",
                "validate",
                "confirm",
            )
        ):
            interesting.append(ln)
    if interesting:
        return " | ".join(interesting[:6])
    mid = [ln for ln in lines if 8 < len(ln) < 120]
    return " | ".join(mid[2:8])


async def wait_for_captcha_widget(page: Any, timeout: float = 6.0) -> None:
    deadline = time.monotonic() + timeout
    patterns = (
        "găleț",
        "galet",
        "draper",
        "alegeți",
        "alegeti",
        "select all",
        "choose all",
        "curtain",
        "validați",
        "validati",
        "validate",
        "confirm",
        "trafic neobi",
        "unusual traffic",
    )
    while time.monotonic() < deadline:
        try:
            text = (await page.inner_text("body")).lower()
        except Exception:  # noqa: BLE001
            text = ""
        if any(p in text for p in patterns):
            await asyncio.sleep(0.35)
            return
        await asyncio.sleep(0.25)
    await asyncio.sleep(0.2)


def execute_actions_with_mouse(
    actions: list[dict[str, Any]],
    *,
    metrics: dict[str, float],
    img_w: int,
    img_h: int,
) -> int:
    if not actions:
        return 0
    pag = _get_pyautogui()
    focus_chromium_window()
    time.sleep(0.35)
    done = 0
    for raw in actions:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("type") or "").lower().strip()
        if kind in {"click", "validate"}:
            x, y = viewport_to_screen(
                float(raw["x"]), float(raw["y"]), metrics=metrics, img_w=img_w, img_h=img_h
            )
            print(f"  [OLLAMA] mouse click screen=({x:.0f},{y:.0f}) norm=({raw['x']},{raw['y']})")
            human_click(pag, x, y)
            done += 1
        elif kind == "drag":
            x1, y1 = viewport_to_screen(
                float(raw["x1"]), float(raw["y1"]), metrics=metrics, img_w=img_w, img_h=img_h
            )
            x2, y2 = viewport_to_screen(
                float(raw["x2"]), float(raw["y2"]), metrics=metrics, img_w=img_w, img_h=img_h
            )
            dist = math.hypot(x2 - x1, y2 - y1)
            print(f"  [OLLAMA] mouse drag ~{dist:.0f}px")
            human_drag(pag, x1, y1, x2, y2)
            done += 1
        else:
            print(f"  [OLLAMA] nieznana akcja: {kind!r}")
        time.sleep(random.uniform(0.35, 0.75))
    return done


def _png_size(png: bytes) -> tuple[int, int]:
    if len(png) >= 24 and png[:8] == b"\x89PNG\r\n\x1a\n":
        return int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big")
    try:
        from io import BytesIO

        from PIL import Image

        im = Image.open(BytesIO(png))
        return int(im.size[0]), int(im.size[1])
    except Exception:  # noqa: BLE001
        return 400, 500


def _parse_captchamind_action(content: str) -> dict[str, Any] | None:
    """Parsuje oficjalny output CaptchaMind: <tool_call>{...}</tool_call>."""
    if not content:
        return None
    text = content
    m = re.search(r"<tool_call>\s*(.*?)\s*</tool_call>", text, flags=re.I | re.S)
    if m:
        text = m.group(1).strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    # pierwszy obiekt JSON
    start = text.find("{")
    if start < 0:
        # fallback: position [x, y] w tresci
        pm = re.search(r"position\"?\s*[:=]\s*\[\s*(\d+)\s*,\s*(\d+)", content, flags=re.I)
        if pm:
            return {"name": "click", "arguments": {"position": [int(pm.group(1)), int(pm.group(2))]}}
        return None
    depth = 0
    end = -1
    for i, ch in enumerate(text[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end < 0:
        return None
    blob = text[start:end]
    try:
        data = json.loads(blob)
    except json.JSONDecodeError:
        pm = re.search(r'"position"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)', blob)
        if pm:
            return {"name": "click", "arguments": {"position": [int(pm.group(1)), int(pm.group(2))]}}
        return None
    if not isinstance(data, dict):
        return None
    name = str(data.get("name") or data.get("type") or "").lower()
    args = data.get("arguments") if isinstance(data.get("arguments"), dict) else data
    if name not in {"click", "drag", "bounding", "enter_number"}:
        if "position" in (args or {}):
            name = "click"
        else:
            return None
    return {"name": name, "arguments": args or {}}


def _ollama_chat_messages(
    *,
    base_url: str,
    model: str,
    messages: list[dict[str, Any]],
    timeout: float = 90.0,
    num_predict: int = 640,
) -> str:
    """Multi-turn chat jak ReactAgent CaptchaMind — bez format=JSON."""
    url = base_url.rstrip("/") + "/api/chat"
    body: dict[str, Any] = {
        "model": model,
        "stream": False,
        "think": False,
        "messages": messages,
        "options": {"temperature": 0.0, "num_predict": num_predict},
        "keep_alive": "30m",
    }
    n_img = sum(1 for m in messages if m.get("images"))
    print(f"  [OLLAMA] CaptchaMind step msgs={len(messages)} images={n_img} ...")
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = json.loads(resp.read().decode("utf-8"))
    msg = raw.get("message") if isinstance(raw.get("message"), dict) else {}
    content = str(msg.get("content") or "").strip()
    thinking = str(msg.get("thinking") or "").strip()
    if not content and thinking:
        content = thinking
    print(f"  [OLLAMA] CaptchaMind odpowiedz {len(content)} znakow")
    if len(content) < 200:
        print(f"  [OLLAMA] raw={content!r}")
    return content


def _img_xy_to_page(
    px: float,
    py: float,
    *,
    img_w: int,
    img_h: int,
    captcha_box: dict[str, float] | None,
    metrics: dict[str, float],
) -> tuple[float, float]:
    iw = max(1, img_w)
    ih = max(1, img_h)
    if captcha_box and float(captcha_box.get("w") or 0) > 50:
        x = float(captcha_box["x"]) + (px / iw) * float(captcha_box["w"])
        y = float(captcha_box["y"]) + (py / ih) * float(captcha_box["h"])
        return x, y
    return (px / iw) * float(metrics.get("iw") or 1280), (py / ih) * float(
        metrics.get("ih") or 900
    )


def _snap_to_nearest_tile(
    x: float,
    y: float,
    captcha_box: dict[str, float] | None,
) -> tuple[float, float, int | None]:
    tiles = list((captcha_box or {}).get("tiles") or [])
    if len(tiles) < 9:
        return x, y, None
    best_i = None
    best_d = 1e18
    for i, t in enumerate(tiles[:9]):
        cx, cy = float(t["cx"]), float(t["cy"])
        inside = (
            float(t["x"]) <= x <= float(t["x"]) + float(t["w"])
            and float(t["y"]) <= y <= float(t["y"]) + float(t["h"])
        )
        d = math.hypot(x - cx, y - cy)
        if inside:
            return cx, cy, i
        if d < best_d:
            best_d = d
            best_i = i
    if best_i is not None and best_d < 70:
        t = tiles[best_i]
        return float(t["cx"]), float(t["cy"]), best_i
    return x, y, None


def _looks_like_submit_click(
    x: float,
    y: float,
    *,
    captcha_box: dict[str, float] | None,
    img_w: int,
    img_h: int,
    px: float,
    py: float,
) -> bool:
    """Submit tylko gdy klik jest wyraźnie pod siatką / na Validați — nie przy pierwszym kafelku."""
    _ = img_w
    # W przestrzeni obrazka: dolne ~18%
    if img_h > 0 and py >= img_h * 0.82:
        return True
    if captcha_box:
        bx, by = float(captcha_box["x"]), float(captcha_box["y"])
        bw, bh = float(captcha_box["w"]), float(captcha_box["h"])
        tiles = list(captcha_box.get("tiles") or [])
        if tiles:
            bottom = max(float(t["y"]) + float(t["h"]) for t in tiles)
            if y > bottom + 15:
                return True
        if bh > 1 and bw > 1:
            rel_y = (y - by) / bh
            rel_x = (x - bx) / bw
            if rel_y >= 0.85 and rel_x >= 0.40:
                return True
    return False


async def _capture_captcha_png(
    page: Any,
    captcha_box: dict[str, float] | None,
    metrics: dict[str, float],
) -> tuple[bytes, dict[str, float] | None, dict[str, float]]:
    box = await find_captcha_box(page) or captcha_box
    metrics = await read_window_metrics(page)
    if box and float(box.get("w") or 0) > 180:
        clip = {
            "x": max(0.0, float(box["x"])),
            "y": max(0.0, float(box["y"])),
            "width": min(float(box["w"]), metrics["iw"] - max(0.0, float(box["x"]))),
            "height": min(float(box["h"]), metrics["ih"] - max(0.0, float(box["y"]))),
        }
        png = await page.screenshot(type="png", clip=clip)
        return png, box, metrics
    png = await page.screenshot(type="png", full_page=False)
    return png, box, metrics


async def solve_with_captchamind(
    page: Any,
    *,
    base_url: str,
    model: str,
    captcha_box: dict[str, float] | None,
    metrics: dict[str, float],
    page_hint: str,
    raw_png: bytes,
    max_steps: int = 30,
) -> bool:
    """
    1:1 pętla ReactAgent z captcha-mind:
    messages = [user: prompt+image] → assistant tool_call → user: nowe observation image → ...
    aż model kliknie submit (Validați) albo max_steps.
    """
    prompt = build_captchamind_prompt(page_hint)
    img_b64 = _to_jpeg_b64(raw_png, max_side=900, quality=88)
    # Ollama: content + images (jak OpenAI content parts, ale w API Ollamy)
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": prompt, "images": [img_b64]},
    ]
    clicked_tiles: set[int] = set()
    click_count = 0
    submitted = False

    print(f"  [OLLAMA] CaptchaMind ReactAgent max_steps={max_steps}")

    for step in range(1, max_steps + 1):
        try:
            content = await asyncio.to_thread(
                _ollama_chat_messages,
                base_url=base_url,
                model=model,
                messages=messages,
                timeout=75.0,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  [OLLAMA] CaptchaMind step {step} blad: {type(exc).__name__}: {exc}")
            break

        action = _parse_captchamind_action(content)
        if not action:
            print(f"  [OLLAMA] CaptchaMind step {step}: brak tool_call — stop")
            break

        name = str(action.get("name") or "").lower()
        args = action.get("arguments") or {}
        messages.append({"role": "assistant", "content": content})

        if name != "click":
            print(f"  [OLLAMA] CaptchaMind step {step}: akcja {name!r} (pomijam, czekam na click)")
            # Observation bez zmiany — daj modelowi kolejną szansę z tym samym obrazkiem
            messages.append({"role": "user", "content": "Please click the next matching tile or the submit button.", "images": [img_b64]})
            continue

        pos = args.get("position") or args.get("pos") or args.get("point")
        if not (isinstance(pos, (list, tuple)) and len(pos) >= 2):
            print(f"  [OLLAMA] CaptchaMind step {step}: zly position={pos!r}")
            break
        try:
            px, py = float(pos[0]), float(pos[1])
        except (TypeError, ValueError):
            break

        img_w, img_h = _png_size(raw_png)
        page_x, page_y = _img_xy_to_page(
            px, py, img_w=img_w, img_h=img_h, captcha_box=captcha_box, metrics=metrics
        )
        page_x, page_y, tile_i = _snap_to_nearest_tile(page_x, page_y, captcha_box)

        is_submit = _looks_like_submit_click(
            page_x,
            page_y,
            captcha_box=captcha_box,
            img_w=img_w,
            img_h=img_h,
            px=px,
            py=py,
        )

        if is_submit:
            # Jak w patch_select: click submit → done
            print(
                f"  [OLLAMA] CaptchaMind step {step}: SUBMIT "
                f"img=({px:.0f},{py:.0f}) page=({page_x:.0f},{page_y:.0f}) "
                f"po {click_count} klikach kafelkow"
            )
            await page.mouse.click(page_x, page_y)
            await asyncio.sleep(0.15)
            await click_yellow_confirm(page, captcha_box=captcha_box, metrics=metrics)
            submitted = True
            break

        print(
            f"  [OLLAMA] CaptchaMind step {step}: click "
            f"img=({px:.0f},{py:.0f}) → page=({page_x:.0f},{page_y:.0f}) tile={tile_i}"
        )
        await page.mouse.click(page_x, page_y)
        click_count += 1
        if tile_i is not None:
            clicked_tiles.add(tile_i)
        await asyncio.sleep(0.35)

        # Nowa obserwacja (jak env.step → tick_image / screenshot)
        try:
            raw_png, captcha_box, metrics = await _capture_captcha_png(
                page, captcha_box, metrics
            )
        except Exception as exc:  # noqa: BLE001
            print(f"  [OLLAMA] CaptchaMind observation: {exc}")
            break
        img_b64 = _to_jpeg_b64(raw_png, max_side=900, quality=88)
        # Oficjalnie: kolejny user message = sama obserwacja (obraz)
        messages.append({"role": "user", "content": "", "images": [img_b64]})

    if not submitted and click_count > 0:
        print(
            f"  [OLLAMA] CaptchaMind: koniec petli bez SUBMIT "
            f"(clicks={click_count}, tiles={sorted(clicked_tiles)}) → Validați"
        )
        await click_yellow_confirm(page, captcha_box=captcha_box, metrics=metrics)
        submitted = True

    print(
        f"  [OLLAMA] CaptchaMind done submitted={submitted} "
        f"clicks={click_count} tiles={sorted(clicked_tiles)}"
    )
    return submitted or click_count > 0


async def try_solve_with_ollama(
    page: Any,
    *,
    model: str = "captchamind:7b",
    base_url: str = "",
    max_attempts: int = 4,
    settle_seconds: float = 1.2,
    still_blocked: Any = None,
    prefer_real_mouse: bool | None = None,
) -> bool:
    if still_blocked is None:

        async def still_blocked() -> bool:
            return True

    base = resolve_ollama_base_url(base_url)
    use_mouse = prefer_real_mouse_default() if prefer_real_mouse is None else prefer_real_mouse
    print(f"  [OLLAMA] url={base} model={model} mouse={'tak' if use_mouse else 'nie (Playwright)'}")

    if not _ollama_ping(base, timeout=2.0):
        print(
            f"  [OLLAMA] BRAK API pod {base}. "
            "Na Macu: ollama serve. Z Orba ustaw --ollama-url http://host.orb.internal:11434"
        )
        return False

    await wait_for_captcha_widget(page, timeout=8.0)

    for attempt in range(1, max_attempts + 1):
        if not await still_blocked():
            print("  [OLLAMA] Strona juz OK.")
            return True

        if attempt > 1:
            await refresh_captcha(page)

        print(f"  [OLLAMA] Proba {attempt}/{max_attempts}: czekam na siatke → screenshot...")
        try:
            await page.bring_to_front()
        except Exception:  # noqa: BLE001
            pass

        captcha_box = await wait_for_captcha_ready(page, timeout=16.0)
        metrics = await read_window_metrics(page)
        page_hint = await read_captcha_hint(page)
        if captcha_box and captcha_box.get("instr") and not page_hint:
            page_hint = str(captcha_box["instr"])

        try:
            if captcha_box and float(captcha_box.get("w") or 0) > 180:
                clip = {
                    "x": max(0.0, float(captcha_box["x"])),
                    "y": max(0.0, float(captcha_box["y"])),
                    "width": min(
                        float(captcha_box["w"]),
                        metrics["iw"] - max(0.0, float(captcha_box["x"])),
                    ),
                    "height": min(
                        float(captcha_box["h"]),
                        metrics["ih"] - max(0.0, float(captcha_box["y"])),
                    ),
                }
                raw_png = await page.screenshot(type="png", clip=clip)
                print(
                    f"  [OLLAMA] crop captcha {clip['width']:.0f}x{clip['height']:.0f} "
                    f"@ ({clip['x']:.0f},{clip['y']:.0f}) tiles={len(captcha_box.get('tiles') or [])}"
                )
            else:
                raw_png = await page.screenshot(type="png", full_page=False)
                print("  [OLLAMA] brak bbox — pełny screenshot")
        except Exception as exc:  # noqa: BLE001
            print(f"  [OLLAMA] Screenshot/metrics: {type(exc).__name__}: {exc}")
            return False

        if len(raw_png) < 40_000:
            print(f"  [OLLAMA] screenshot za maly ({len(raw_png)//1024} KB) — czekam na obrazki...")
            _save_debug_png(raw_png, "too_small")
            await asyncio.sleep(1.5)
            captcha_box = await wait_for_captcha_ready(page, timeout=10.0) or captcha_box
            try:
                if captcha_box and float(captcha_box.get("w") or 0) > 180:
                    clip = {
                        "x": max(0.0, float(captcha_box["x"])),
                        "y": max(0.0, float(captcha_box["y"])),
                        "width": min(
                            float(captcha_box["w"]),
                            metrics["iw"] - max(0.0, float(captcha_box["x"])),
                        ),
                        "height": min(
                            float(captcha_box["h"]),
                            metrics["ih"] - max(0.0, float(captcha_box["y"])),
                        ),
                    }
                    raw_png = await page.screenshot(type="png", clip=clip)
                else:
                    raw_png = await page.screenshot(type="png", full_page=False)
            except Exception as exc:  # noqa: BLE001
                print(f"  [OLLAMA] reshoot: {exc}")
            print(f"  [OLLAMA] po czekaniu screenshot {len(raw_png)//1024} KB")

        if len(raw_png) < 25_000:
            _save_debug_png(raw_png, "still_small")
            print("  [OLLAMA] nadal pusty screen — skip (bez klikania w ciemno)")
            await asyncio.sleep(settle_seconds)
            continue

        instruction = enrich_instruction(page_hint)
        if page_hint:
            print(f"  [OLLAMA] hint z strony: {page_hint[:120]!r}")

        # CaptchaMind: WYŁĄCZNIE oficjalna pętla ReactAgent (tool_call × N → submit)
        if is_captchamind_model(model):
            print("  [OLLAMA] tryb oficjalny CaptchaMind ReactAgent...")
            ok = await solve_with_captchamind(
                page,
                base_url=base,
                model=model,
                captcha_box=captcha_box,
                metrics=metrics,
                page_hint=page_hint or instruction,
                raw_png=raw_png,
                max_steps=30,
            )
            if ok:
                for _ in range(4):
                    await asyncio.sleep(0.3)
                    if not await still_blocked():
                        print("  [OLLAMA] Captcha OK — zamykam przegladarke.")
                        return True
                print(
                    "  [OLLAMA] Confirm klikniety — zamykam przegladarke "
                    "(nie czekam az UI sie odblokuje; czasem sie zacina)."
                )
                return True
            print("  [OLLAMA] CaptchaMind ReactAgent bez sukcesu — fallback cells...")

        cells: list[int] = []
        seen: list[str] | Any = []
        tiles = _split_grid_tiles(raw_png, captcha_box)
        use_tiles = len(tiles) == 9 and len((captcha_box or {}).get("tiles") or []) >= 9

        if use_tiles:
            print(f"  [OLLAMA] klasyfikacja 9 kafelkow (instr={instruction!r})...")
            try:
                cells, seen = await asyncio.to_thread(
                    classify_tiles_with_ollama,
                    base_url=base,
                    model=model,
                    instruction=instruction
                    or "select all matching objects from the captcha instruction",
                    tile_pngs=tiles,
                )
                print(f"  [OLLAMA] wynik cells={cells!r} seen={seen!r}")
            except urllib.error.URLError as exc:
                print(f"  [OLLAMA] Brak polaczenia z Ollama ({base}): {exc}")
                return False
            except Exception as exc:  # noqa: BLE001
                print(f"  [OLLAMA] Blad API: {type(exc).__name__}: {exc}")
                return False

        if not cells:
            t0 = time.monotonic()
            try:
                annotated = _annotate_numbered_grid(raw_png)
                img_b64 = _to_jpeg_b64(annotated, max_side=900, quality=85)
                print(f"  [OLLAMA] one-shot image_kb={len(img_b64)//1024}...")
                plan = await asyncio.to_thread(
                    _ollama_chat,
                    base_url=base,
                    model=model,
                    image_b64=img_b64,
                    prompt=build_ollama_prompt(page_hint),
                    timeout=60.0,
                )
                cells = plan_to_cells(plan if isinstance(plan, dict) else {})
                seen = plan.get("seen") if isinstance(plan, dict) else []
                print(
                    f"  [OLLAMA] one-shot {time.monotonic() - t0:.1f}s "
                    f"cells={cells!r} seen={seen!r}"
                )
            except Exception as exc:  # noqa: BLE001
                print(f"  [OLLAMA] one-shot blad: {type(exc).__name__}: {exc}")

        if not cells and len(tiles) == 9:
            print(f"  [OLLAMA] fallback tiles (instr={instruction!r})...")
            try:
                cells, seen = await asyncio.to_thread(
                    classify_tiles_with_ollama,
                    base_url=base,
                    model=model,
                    instruction=instruction or "select matching captcha objects",
                    tile_pngs=tiles,
                )
                print(f"  [OLLAMA] wynik cells={cells!r} seen={seen!r}")
            except Exception as exc:  # noqa: BLE001
                print(f"  [OLLAMA] fallback tiles blad: {exc}")

        if not cells:
            _save_debug_png(raw_png, "no_cells")
            await asyncio.sleep(settle_seconds)
            if not await still_blocked():
                return True
            continue

        n = await click_cells_dom(
            page, cells, metrics=metrics, captcha_box=captcha_box
        )
        print(f"  [OLLAMA] wykonano {n} klikniec (DOM/box/fallback)")

        await asyncio.sleep(0.2)
        await click_yellow_confirm(page, captcha_box=captcha_box, metrics=metrics)

        for _ in range(4):
            await asyncio.sleep(0.3)
            if not await still_blocked():
                print("  [OLLAMA] Captcha OK — zamykam przegladarke.")
                return True

        print(
            "  [OLLAMA] Confirm klikniety — zamykam przegladarke "
            "(nie czekam az UI sie odblokuje; czasem sie zacina)."
        )
        return True

    return not await still_blocked()
