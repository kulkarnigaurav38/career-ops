#!/usr/bin/env python3
"""
linkedin_jd_scrape.py — capture linkedin.com/jobs/view/<id> ads verbatim into jds/.

The logged-out job page is fully server-rendered for SEO: title, company, location
and the complete description live in the HTML (`show-more-less-html__markup`), so no
login, no cookies and no browser are needed. There is no ld+json on these pages —
unlike randstad — hence the class-based extraction.

Usage:
    python3 lib/linkedin_jd_scrape.py --urls urls.txt --start 242
    python3 lib/linkedin_jd_scrape.py --url "<one url>" --print
"""

from __future__ import annotations

import argparse
import html
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
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9,en;q=0.8"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "ignore")


def strip(frag: str) -> str:
    """HTML fragment -> text, keeping paragraph and bullet structure."""
    frag = re.sub(r"<br\s*/?>", "\n", frag, flags=re.I)
    frag = re.sub(r"</li\s*>", "\n", frag, flags=re.I)
    frag = re.sub(r"<li[^>]*>", "- ", frag, flags=re.I)
    frag = re.sub(r"</(p|div|ul|ol|h[1-6])\s*>", "\n\n", frag, flags=re.I)
    frag = re.sub(r"<[^>]+>", "", frag)
    frag = html.unescape(frag)
    out, blank = [], False
    for ln in (re.sub(r"[ \t]+", " ", l).strip() for l in frag.split("\n")):
        if not ln:
            if out and not blank:
                out.append("")
            blank = True
        else:
            out.append(ln)
            blank = False
    return "\n".join(out).strip()


def one(pat: str, s: str, flags=re.S) -> str:
    m = re.search(pat, s, flags)
    return html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip() if m else ""


def parse(src: str, url: str) -> dict:
    title = one(r"<h1[^>]*>(.*?)</h1>", src) or one(r'topcard__title[^>]*>(.*?)<', src)
    company = one(r'topcard__org-name-link[^>]*>(.*?)</a>', src) or one(r'topcard__org-name[^"]*"[^>]*>(.*?)<', src)
    location = one(r'topcard__flavor--bullet[^>]*>(.*?)<', src)
    posted = one(r'posted-time-ago__text[^>]*>(.*?)<', src)
    applicants = one(r'num-applicants__caption[^>]*>(.*?)<', src)

    body = ""
    m = re.search(r'show-more-less-html__markup[^>]*>(.*?)</div>', src, re.S)
    if m:
        body = strip(m.group(1))

    # "Seniority level / Employment type / Job function / Industries" table
    crit = []
    for lab, val in re.findall(
            r'description__job-criteria-subheader[^>]*>(.*?)</h3>.*?'
            r'description__job-criteria-text[^>]*>(.*?)</span>', src, re.S):
        crit.append((html.unescape(re.sub(r"<[^>]+>", "", lab)).strip(),
                     html.unescape(re.sub(r"<[^>]+>", "", val)).strip()))

    mid = re.search(r"/jobs/view/(\d+)", url)
    return {"title": title, "company": company, "location": location, "posted": posted,
            "applicants": applicants, "criteria": crit, "body": body,
            "job_id": mid.group(1) if mid else "", "ok": bool(title and body)}


def slugify(s: str) -> str:
    s = (s or "").lower()
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("ß", "ss")):
        s = s.replace(a, b)
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return re.sub(r"-{2,}", "-", s)[:46]


def write_jd(num: int, d: dict, url: str) -> Path:
    slug = slugify(f"{d['company']}-{d['title']}")
    path = JDS / f"{num:03d}-{slug}.md"
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    meta = [
        f"**URL:** {url}",
        f"**Captured:** {stamp} (linkedin_jd_scrape, HTTP/SSR public page)",
        f"**Arbeitgeber:** {d['company']}",
        f"**Ort:** {d['location']} · **Job-ID:** {d['job_id']}",
        f"**Veroeffentlicht:** {d['posted']}" + (f" · **Bewerber:** {d['applicants']}" if d["applicants"] else ""),
    ]
    for lab, val in d["criteria"]:
        meta.append(f"**{lab}:** {val}")
    lang = "DE" if re.search(r"\b(und|wir|Sie|für|mit|Deine|Ihre)\b", d["body"]) else "EN"
    meta.append(f"**Language:** {lang}")
    if not d["ok"]:
        meta.append("**Source quality:** unvollstaendig - Titel oder Beschreibung fehlten.")
    doc = (f"# {d['company']} - {d['title']}\n\n" + "\n".join(meta) +
           "\n\n---\n\n## Raw JD (verbatim, as captured)\n\n" + d["body"] + "\n")
    path.write_text(doc, encoding="utf-8")
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--urls", type=Path)
    ap.add_argument("--url")
    ap.add_argument("--start", type=int, default=242)
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
            print(f"== {d['company']} | {d['title']} | {d['location']} | {len(d['body'])} chars")
            print(d["body"][:800]); continue
        if not d["ok"]:
            print(f"  ! #{n:03d} INCOMPLETE {u} (title={bool(d['title'])} body={len(d['body'])})", file=sys.stderr)
        p = write_jd(n, d, u)
        print(f"  #{n:03d} {d['company'][:26]:<28} {d['title'][:40]:<42} {len(d['body']):>5}ch -> {p.name}")
        n += 1
        time.sleep(1.2)          # be polite; these are public pages but still their servers


if __name__ == "__main__":
    main()
