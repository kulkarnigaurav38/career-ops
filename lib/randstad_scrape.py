#!/usr/bin/env python3
"""
randstad_scrape.py — capture randstad.de job ads verbatim into jds/{NNN}-{slug}.md

randstad.de is server-rendered, so plain HTTP is enough (no Playwright, no login).
The ad body lives in a #job... container as ordinary <p>/<ul>/<li> markup; we keep
the structure (headings as paragraphs, bullets as "- ") and never summarise.

Usage:
    python3 lib/randstad_scrape.py --urls urls.txt --start 197
    python3 lib/randstad_scrape.py --url "<one url>" --print
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JDS = ROOT / "jds"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


def block_to_text(frag: str) -> str:
    """HTML fragment -> plain text, keeping paragraph and bullet structure."""
    frag = re.sub(r"<br\s*/?>", "\n", frag, flags=re.I)
    frag = re.sub(r"</li\s*>", "\n", frag, flags=re.I)
    frag = re.sub(r"<li[^>]*>", "- ", frag, flags=re.I)
    frag = re.sub(r"</(p|div|ul|ol|h[1-6])\s*>", "\n\n", frag, flags=re.I)
    frag = re.sub(r"<[^>]+>", "", frag)
    frag = html.unescape(frag)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in frag.split("\n")]
    out, blank = [], False
    for ln in lines:
        if not ln:
            if out and not blank:
                out.append("")
            blank = True
        else:
            out.append(ln)
            blank = False
    return "\n".join(out).strip()


def extract_jsonld(html_src: str) -> dict:
    """The schema.org JobPosting sits inside a JS blob, not a <script type=ld+json>.
    Brace-match it out from the '@type":"JobPosting"' marker — the reliable anchor
    (same approach as lib/yourfirm_scrape.py). Returns {} if absent."""
    i = html_src.find('"@type":"JobPosting"')
    if i < 0:
        return {}
    start = html_src.rfind("{", 0, i)
    depth, in_str, esc = 0, False, False
    for j in range(start, len(html_src)):
        c = html_src[j]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(html_src[start:j + 1])
                except Exception:
                    return {}
    return {}


def parse(html_src: str, url: str) -> dict:
    ld = extract_jsonld(html_src)
    addr = (ld.get("jobLocation") or {}).get("address") or {}
    salary = ""
    bs = ld.get("baseSalary") or {}
    val = bs.get("value") or {}
    if val.get("minValue") or val.get("value"):
        lo, hi = val.get("minValue"), val.get("maxValue")
        salary = f"{lo}-{hi}" if lo and hi else str(val.get("value") or lo or "")
        if bs.get("currency"):
            salary += f" {bs['currency']}"
        if val.get("unitText"):
            salary += f" / {val['unitText']}"

    body = block_to_text(ld.get("description", "")) if ld.get("description") else ""
    if not body:  # fallback: the ad block in the rendered HTML
        anchor = re.search(r"<p>[^<]*Aufgaben[^<]*</p>", html_src, re.I)
        if anchor:
            start = html_src.rfind("<p>", 0, anchor.start())
            body = block_to_text(html_src[start:start + 6000])

    title = ld.get("title") or ""
    if not title:
        m = re.search(r'<meta[^>]+property="og:title"[^>]*content="([^"]*)"', html_src)
        if m:
            title = html.unescape(m.group(1)).split("|")[0].strip()

    city = addr.get("addressLocality") or ""
    if not city:
        mc = re.search(r"_([a-z\-]+)_c\d+/?$", url)
        city = mc.group(1).replace("-", " ").title() if mc else ""

    ident = ld.get("identifier") or {}
    mr = re.search(r"_c(\d+)/?$", url)
    return {
        "title": title,
        "city": city,
        "region": addr.get("addressRegion", ""),
        "zip": addr.get("postalCode", ""),
        "ref_no": ident.get("value") or ("C" + mr.group(1) if mr else ""),
        "posted": (ld.get("datePosted") or "")[:10],
        "valid_through": (ld.get("validThrough") or "")[:10],
        "employment": ld.get("employmentType", ""),
        "hours": ld.get("workHours", ""),
        "industry": ld.get("industry", ""),
        "salary": salary,
        "employer": (ld.get("hiringOrganization") or {}).get("name", "Randstad Deutschland"),
        "body": body,
        "via_jsonld": bool(ld),
    }


def slugify(s: str) -> str:
    s = (s or "").lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return re.sub(r"-{2,}", "-", s)[:48]


def write_jd(num: int, data: dict, url: str) -> Path:
    slug = "randstad-" + slugify(f"{data['title']}-{data['city']}")
    path = JDS / f"{num:03d}-{slug}.md"
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    loc = ", ".join(x for x in [data["zip"], data["city"], data["region"]] if x)
    meta = [
        f"**URL:** {url}",
        f"**Captured:** {stamp} (randstad_scrape, HTTP/SSR + schema.org JobPosting)",
        f"**Arbeitgeber:** {data['employer']} (Personaldienstleister)",
        f"**Stellennummer:** {data['ref_no']} · **Ort:** {loc}",
        f"**Veroeffentlicht:** {data['posted']} · **Bewerbungsfrist:** {data['valid_through']}",
        f"**Anstellung:** {data['employment']} / {data['hours']} · **Branche:** {data['industry']}",
    ]
    if data["salary"]:
        meta.append(f"**Gehalt (laut Anzeige):** {data['salary']}")
    meta.append("**Language:** DE")
    if not data["via_jsonld"]:
        meta.append("**Source quality:** HTML fallback - kein JSON-LD gefunden, Text ggf. unvollstaendig.")
    doc = (
        f"# {data['employer']} - {data['title']} ({data['city']})\n\n"
        + "\n".join(meta)
        + "\n\n---\n\n## Raw JD (verbatim, as captured)\n\n"
        + f"{data['body']}\n"
    )
    path.write_text(doc, encoding="utf-8")
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--urls", type=Path)
    ap.add_argument("--url")
    ap.add_argument("--start", type=int, default=197)
    ap.add_argument("--print", action="store_true", dest="show")
    a = ap.parse_args()

    urls = [a.url] if a.url else [u.strip() for u in a.urls.read_text().split("\n") if u.strip()]
    n = a.start
    for u in urls:
        try:
            d = parse(fetch(u), u)
        except Exception as e:
            print(f"  ! {u}\n    FAILED {type(e).__name__}: {e}", file=sys.stderr)
            continue
        if a.show:
            print(f"== {d['title']} | {d['city']} | {d['ref_no']} | frist {d['valid_through']} | {len(d['body'])} chars | jsonld={d['via_jsonld']}")
            print(d["body"][:1200])
            continue
        p = write_jd(n, d, u)
        flag = "" if d["via_jsonld"] else "  [FALLBACK]"
        print(f"  #{n:03d} {d['title'][:40]:<40} {d['city']:<16} {len(d['body']):>5}ch  frist {d['valid_through']}{flag}")
        n += 1
        time.sleep(0.4)


if __name__ == "__main__":
    main()
