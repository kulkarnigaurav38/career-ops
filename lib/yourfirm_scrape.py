#!/usr/bin/env python3
"""yourfirm.de job scraper (Playwright) - the yourfirm equivalent of lib/xing_scrape.py.

yourfirm.de is hard-blocked by the Claude Code fetch allowlist (WebFetch returns "unable to
fetch"), and its main posting is consent-gated + JS-rendered, so a naive body-grab only sees the
nav + "Aehnliche Jobs" sidebar. The reliable anchor is the embedded schema.org JSON-LD JobPosting
block (title, hiringOrganization, jobLocation, validThrough, description) - like Xing's og:description.

Usage:  python3 lib/yourfirm_scrape.py "<yourfirm job-detail url>"
Prints: URL / TITLE / COMPANY / ROLE / LOCATION / DATE_POSTED / VALID_THROUGH, a divider,
then the verbatim (HTML-stripped) job description. Falls back to the <main> container if no JSON-LD.
Setup if missing: python3 -m pip install --user playwright && python3 -m playwright install chromium
"""
import sys, json, re, html
from playwright.sync_api import sync_playwright

def strip_html(s):
    if not s:
        return ""
    s = re.sub(r'(?i)<\s*br\s*/?>', '\n', s)
    s = re.sub(r'(?i)<\s*li[^>]*>', '\n- ', s)
    s = re.sub(r'(?i)</\s*(p|div|h[1-6]|ul|ol|tr)\s*>', '\n', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    s = re.sub(r'[ \t]+\n', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()

def _find_jobposting(blocks):
    for block in blocks:
        try:
            data = json.loads(block)
        except Exception:
            continue
        stack = data if isinstance(data, list) else [data]
        # also unwrap @graph
        graph = []
        for it in stack:
            if isinstance(it, dict) and isinstance(it.get("@graph"), list):
                graph.extend(it["@graph"])
        stack = stack + graph
        for it in stack:
            if isinstance(it, dict):
                t = it.get("@type", "")
                t = t if isinstance(t, str) else (t[0] if isinstance(t, list) and t else "")
                if "JobPosting" in str(t):
                    return it
    return None

def scrape(url):
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_context(locale="de-DE").new_page()
        pg.goto(url, wait_until="domcontentloaded", timeout=45000)
        pg.wait_for_timeout(2500)
        for sel in ['button:has-text("Accept all")', 'button:has-text("Alle akzeptieren")',
                    'button:has-text("Akzeptieren")', '#onetrust-accept-btn-handler']:
            try:
                pg.click(sel, timeout=1500); break
            except Exception:
                pass
        pg.wait_for_timeout(1500)
        title_tag = pg.title()
        blocks = pg.eval_on_selector_all('script[type="application/ld+json"]', 'els=>els.map(e=>e.textContent)')
        job = _find_jobposting(blocks)
        out = [f"URL: {url}", f"TITLE: {title_tag}"]
        if job:
            role = job.get("title", "")
            org = job.get("hiringOrganization")
            org = org.get("name", "") if isinstance(org, dict) else (org or "")
            loc = job.get("jobLocation")
            if isinstance(loc, list):
                loc = loc[0] if loc else {}
            city = ""
            if isinstance(loc, dict):
                addr = loc.get("address", {})
                if isinstance(addr, dict):
                    city = addr.get("addressLocality") or addr.get("addressRegion") or ""
            sal = job.get("baseSalary")
            salstr = ""
            if isinstance(sal, dict):
                v = sal.get("value", {})
                if isinstance(v, dict):
                    salstr = f"{v.get('minValue','')}-{v.get('maxValue','')} {sal.get('currency','')}".strip()
            out += [f"COMPANY: {org}", f"ROLE: {role}", f"LOCATION: {city}"]
            if job.get("datePosted"): out.append(f"DATE_POSTED: {job['datePosted']}")
            if job.get("validThrough"): out.append(f"VALID_THROUGH: {job['validThrough']}")
            if salstr and salstr != "- ": out.append(f"SALARY: {salstr}")
            out.append("=" * 60)
            out.append(strip_html(job.get("description", "")))
        else:
            out.append("NOTE: no JSON-LD JobPosting found; <main> fallback")
            out.append("=" * 60)
            try:
                txt = pg.inner_text("main")
            except Exception:
                txt = pg.inner_text("body")
            for marker in ["Ähnliche Jobs", "Ähnliche Stellen"]:
                if marker in txt:
                    txt = txt.split(marker)[0]
            out.append(txt)
        b.close()
        return "\n".join(out)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python3 lib/yourfirm_scrape.py <url>"); sys.exit(1)
    print(scrape(sys.argv[1]))
