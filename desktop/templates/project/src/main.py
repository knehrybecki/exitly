"""{{PROJECT_NAME}} — Exitly + crawl4ai + Ollama antibot + Serper.

Lokalnie: pip install -r requirements.txt && playwright install chromium
         python -u -m src.main

Env z Exitly (.env):
  OLLAMA_BASE_URL       — host.docker.internal w kontenerze
  OLLAMA_CRAWL_MODEL    — LLM pod crawl4ai (per projekt)
  OLLAMA_ANTIBOT_MODEL  — vision (np. captchamind:7b) — CaptchaMind
  SERPER_API_KEY        — Serper (globalnie z ustawień Exitly)
  https://github.com/AlibabaResearch/captcha-mind
  https://serper.dev
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


def ollama_base() -> str:
    return env("OLLAMA_BASE_URL") or env("OLLAMA_HOST") or "http://127.0.0.1:11434"


def crawl_model() -> str:
    return env("OLLAMA_CRAWL_MODEL") or env("OLLAMA_MODEL") or "qwen2.5:14b"


def antibot_model() -> str:
    return env("OLLAMA_ANTIBOT_MODEL") or "captchamind:7b"


def serper_key() -> str:
    return env("SERPER_API_KEY")


async def ping_exit() -> None:
    try:
        import httpx

        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get("https://ipinfo.io/json")
            info = r.json()
            print(
                "[crawl] exit",
                info.get("ip"),
                info.get("country"),
                info.get("org"),
                flush=True,
            )
    except Exception as err:  # noqa: BLE001
        print("[crawl] exit?", err, flush=True)


async def ping_ollama() -> None:
    base = ollama_base()
    if not base:
        return
    try:
        import httpx

        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(f"{base.rstrip('/')}/api/tags")
            data = r.json()
            names = [m.get("name") or m.get("model") for m in data.get("models") or []]
            print(
                f"[crawl] ollama {base} models={len(names)} "
                f"crawl={crawl_model()} antibot={antibot_model()}",
                flush=True,
            )
            for need in (crawl_model(), antibot_model()):
                if need and need not in names and not any(
                    (n or "").startswith(need.split(":")[0]) for n in names
                ):
                    print(f"[crawl] brak modelu „{need}” — ollama pull {need}", flush=True)
    except Exception as err:  # noqa: BLE001
        print("[crawl] ollama unavailable", err, flush=True)


def ping_serper() -> None:
    key = serper_key()
    if not key:
        print("[crawl] serper: brak SERPER_API_KEY (ustaw w Exitly → Ustawienia)", flush=True)
        return
    masked = f"{key[:4]}…{key[-4:]}" if len(key) > 8 else "••••"
    print(f"[crawl] serper: OK klucz {masked}", flush=True)


async def demo_crawl4ai() -> None:
    """Jeden smoke-crawl przez crawl4ai (VPN exit = sieć kontenera)."""
    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig
    except ImportError:
        print("[crawl] crawl4ai niezaainstalowane — pip install -r requirements.txt", flush=True)
        return

    url = env("CRAWL_SMOKE_URL") or "https://httpbin.org/html"
    browser = BrowserConfig(headless=True, verbose=False)
    run_cfg = CrawlerRunConfig(word_count_threshold=10)
    print(f"[crawl] crawl4ai → {url} (llm={crawl_model()})", flush=True)
    try:
        async with AsyncWebCrawler(config=browser) as crawler:
            result = await crawler.arun(url=url, config=run_cfg)
        ok = bool(getattr(result, "success", False))
        md = (getattr(result, "markdown", None) or "")[:120].replace("\n", " ")
        print(f"[crawl] crawl4ai ok={ok} markdown≈{md!r}", flush=True)
    except Exception as err:  # noqa: BLE001
        print("[crawl] crawl4ai error", err, flush=True)


def antibot_ready() -> None:
    try:
        from src.antibot_ollama import resolve_ollama_base_url

        resolved = resolve_ollama_base_url(ollama_base() or "auto")
        print(
            f"[crawl] antibot ready model={antibot_model()} @ {resolved} "
            "(CaptchaMind / try_solve_with_ollama)",
            flush=True,
        )
    except Exception as err:  # noqa: BLE001
        print("[crawl] antibot import?", err, flush=True)


async def main() -> None:
    print("[crawl] start — python -u -m src.main", flush=True)
    print(
        f"[crawl] stack crawl4ai + antibot + serper "
        f"(crawl_model={crawl_model()}, antibot_model={antibot_model()})",
        flush=True,
    )
    await ping_exit()
    await ping_ollama()
    ping_serper()
    antibot_ready()
    await demo_crawl4ai()
    print("[crawl] młyn — dopisz logikę w src/main.py", flush=True)

    tick = 0
    while True:
        tick += 1
        spin = SPIN[tick % len(SPIN)]
        now = datetime.now(timezone.utc).isoformat()
        print(f"[crawl] {spin} tick {tick} {now}", flush=True)
        if tick % 12 == 0:
            await ping_exit()
        await asyncio.sleep(5)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[crawl] stop", flush=True)
