#!/usr/bin/env python3
"""Render a Xing job page with Playwright (headless Chromium) and extract the
job description. Xing is JS-rendered and behind a consent wall, so requests/
WebFetch can't see it — a real browser can.

Usage: python3 lib/xing_scrape.py "<xing-job-url>"
Prints: a header (title / og:description) then the best-effort description text.
"""
import sys, re
from playwright.sync_api import sync_playwright

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

# Candidate selectors for the job-description container (Xing markup varies).
DESC_SELECTORS = [
    '[data-testid="expandable-content"]',
    '[data-testid*="description"]',
    '[class*="job-description"]',
    '[class*="description"]',
    'article',
    'main',
]

def scrape(url: str) -> dict:
    out = {"url": url, "title": "", "og_description": "", "description": "", "note": ""}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(user_agent=UA, locale="de-DE",
                                  viewport={"width": 1280, "height": 2200})
        page = ctx.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=45000)
        # network can keep trickling (trackers) — don't hard-block on idle
        try:
            page.wait_for_load_state("networkidle", timeout=8000)
        except Exception:
            pass
        # dismiss cookie/consent dialog if present
        for label in ["Alle akzeptieren", "Akzeptieren", "Accept all", "Accept",
                       "Zustimmen", "Einverstanden"]:
            try:
                btn = page.get_by_role("button", name=re.compile(label, re.I))
                if btn.count():
                    btn.first.click(timeout=2500)
                    page.wait_for_timeout(1200)
                    break
            except Exception:
                pass
        # meta fallbacks (often carry company + role + summary)
        try:
            out["title"] = page.title()
            og = page.locator('meta[property="og:description"]')
            if og.count():
                out["og_description"] = og.first.get_attribute("content") or ""
        except Exception:
            pass
        # wait for the description container (the user-requested step)
        text = ""
        for sel in DESC_SELECTORS:
            try:
                page.wait_for_selector(sel, timeout=6000, state="attached")
                t = page.locator(sel).first.inner_text(timeout=4000)
                if t and len(t) > len(text):
                    text = t
                    out["note"] = f"matched selector: {sel}"
                if len(text) > 400:
                    break
            except Exception:
                continue
        # last resort: full body innerText
        if len(text) < 400:
            try:
                body = page.locator("body").inner_text(timeout=4000)
                if len(body) > len(text):
                    text = body
                    out["note"] = (out["note"] + " | fell back to body innerText").strip(" |")
            except Exception:
                pass
        out["description"] = re.sub(r"\n{3,}", "\n\n", text).strip()
        browser.close()
    return out

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python3 lib/xing_scrape.py <url>", file=sys.stderr); sys.exit(2)
    r = scrape(sys.argv[1])
    print("URL:", r["url"])
    print("TITLE:", r["title"])
    print("OG_DESCRIPTION:", r["og_description"])
    print("NOTE:", r["note"])
    print("=" * 70)
    print(r["description"])
