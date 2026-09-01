#!/usr/bin/env python3.12
"""
jobspy_scan.py — daily job discovery feed for the career-ops pipeline.

Runs the search matrix in config/jobspy.json through JobSpy (LinkedIn / Indeed /
Google Jobs, no login required), drops anything already seen or already applied
to, and appends the survivors to data/pipeline.md under "## Pendientes" so the
normal per-application pipeline picks them up.

REQUIRES PYTHON 3.10+ — the system /usr/bin/python3 is 3.9 and cannot install
JobSpy. Use the Homebrew interpreter:

    /opt/homebrew/bin/python3.12 -m pip install python-jobspy
    /opt/homebrew/bin/python3.12 lib/jobspy_scan.py

Usage:
    python3.12 lib/jobspy_scan.py [--dry-run] [--hours N] [--limit N]
                                  [--config PATH] [--search "AI Engineer"]

    --dry-run   print what would be added, write nothing
    --hours     override hours_old for every search (default: config)
    --limit     cap the number of URLs appended to pipeline.md this run
    --search    run one ad-hoc term instead of the config matrix
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "jobspy.json"
PIPELINE = ROOT / "data" / "pipeline.md"
HISTORY = ROOT / "data" / "scan-history.tsv"
APPLICATIONS = ROOT / "data" / "applications.md"

PENDING_HEADER = "## Pendientes"
HISTORY_COLUMNS = ["first_seen", "site", "company", "title", "location", "job_url"]

# Params safe to drop from a job URL — everything else is part of its identity.
TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "refid", "trk", "trkinfo", "src", "source", "gh_src", "originalsubdomain",
    "position", "pagenum", "recommended", "savedsearchid", "eblocalizedid",
    "from", "vjs", "tk", "xkcb", "xpse", "advn", "sjdu",
}

# Tokens that make a role genuinely different even when the rest of the title matches.
ROLE_MODIFIERS = {
    "senior", "junior", "lead", "leitender", "principal", "staff", "head", "chief",
    "manager", "architect", "director", "expert", "trainee", "praktikant",
    "werkstudent", "intern", "associate", "deputy", "stellvertretender",
}


# --------------------------------------------------------------------------- #
# normalisation / dedup
# --------------------------------------------------------------------------- #

def norm(s: str) -> str:
    """Lowercase, strip gender tags, punctuation and filler for fuzzy matching."""
    s = (s or "").lower()
    s = re.sub(r"\((?:m|w|f|d|x)(?:\s*/\s*(?:m|w|f|d|x))*\)", " ", s)  # (m/w/d)
    s = re.sub(r"\b(gmbh|ag|se|kg|mbh|co|ohg|e\.?v|inc|ltd|group|deutschland)\b", " ", s)
    s = re.sub(r"[^a-z0-9äöüß]+", " ", s)
    return " ".join(s.split())


def canonical_url(url: str) -> str:
    """Strip tracking params only. LinkedIn job URLs dedupe on the numeric id.

    Everything else keeps its query string: Indeed's job identity lives in ?jk=,
    Google's in the fragment, Ashby's in ?ashby_jid=. Dropping the whole query
    would collapse every Indeed hit onto one URL and poison the history file.
    """
    url = (url or "").strip()
    if not url:
        return ""
    m = re.search(r"linkedin\.com/jobs/view/(\d+)", url)
    if m:
        return f"https://www.linkedin.com/jobs/view/{m.group(1)}"
    parts = urlsplit(url)
    kept = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=False)
        if k.lower() not in TRACKING_PARAMS
    ]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit(
        (parts.scheme or "https", parts.netloc.lower(), path, urlencode(kept), parts.fragment)
    )


def load_history() -> set[str]:
    if not HISTORY.exists():
        return set()
    seen = set()
    for line in HISTORY.read_text(encoding="utf-8").splitlines()[1:]:
        cells = line.split("\t")
        if len(cells) >= len(HISTORY_COLUMNS):
            seen.add(canonical_url(cells[-1]))
    return seen


def load_applied() -> set[tuple[str, str]]:
    """(company, role) pairs already in the tracker — never re-surface those."""
    if not APPLICATIONS.exists():
        return set()
    pairs = set()
    for line in APPLICATIONS.read_text(encoding="utf-8").splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4 or cells[0] in ("#", "") or set(cells[0]) <= {"-"}:
            continue
        pairs.add((norm(cells[2]), norm(cells[3])))
    return pairs


def same_role(a: str, b: str) -> bool:
    """True only for the SAME role, not merely a title that contains the other.

    Substring containment made "AI Engineer" swallow "AI Engineering Manager" and
    "Software Engineer" swallow "Senior Software Engineer", silently hiding real
    jobs (a NO-SKIP LAW violation). Token sets + a seniority guard instead; when in
    doubt this errs toward showing the job, and the pipeline's own pre-flight dedup
    catches any true duplicate before tailoring.
    """
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return False
    if ta == tb:
        return True
    if (ta ^ tb) & ROLE_MODIFIERS:   # one is senior/lead/manager/... the other isn't
        return False
    return len(ta & tb) / len(ta | tb) >= 0.8


def already_applied(applied: set[tuple[str, str]], company: str, title: str) -> bool:
    c, t = norm(company), norm(title)
    for ac, at in applied:
        if ac and ac == c and same_role(t, at):
            return True
    return False


# --------------------------------------------------------------------------- #
# scraping
# --------------------------------------------------------------------------- #

def run_searches(cfg: dict, args) -> list[dict]:
    try:
        from jobspy import scrape_jobs
    except ImportError:
        sys.exit(
            "JobSpy not installed for this interpreter.\n"
            "  /opt/homebrew/bin/python3.12 -m pip install python-jobspy\n"
            f"(current interpreter: {sys.executable}, {sys.version.split()[0]})"
        )

    defaults = cfg.get("defaults", {})
    searches = (
        [{"term": args.search, "location": args.location or "Germany"}]
        if args.search
        else cfg.get("searches", [])
    )

    rows: list[dict] = []
    for s in searches:
        params = {**defaults, **s}
        term, location = params.pop("term"), params.pop("location", "Germany")
        hours = args.hours or params.pop("hours_old", 72)
        params.pop("hours_old", None)
        sites = params.pop("sites", ["linkedin"])
        print(f"  scraping: {term!r} @ {location} ({', '.join(sites)}, {hours}h)", file=sys.stderr)
        try:
            df = scrape_jobs(
                site_name=sites,
                search_term=term,
                location=location,
                hours_old=hours,
                **params,
            )
        except Exception as e:  # one bad search must not kill the run
            print(f"    ! failed: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        if df is None or df.empty:
            print("    0 results", file=sys.stderr)
            continue
        print(f"    {len(df)} results", file=sys.stderr)
        for rec in df.to_dict("records"):
            rows.append(
                {
                    "site": str(rec.get("site", "")),
                    "company": str(rec.get("company", "") or ""),
                    "title": str(rec.get("title", "") or ""),
                    "location": str(rec.get("location", "") or ""),
                    "job_url": str(rec.get("job_url", "") or ""),
                    "search": term,
                }
            )
    return rows


# --------------------------------------------------------------------------- #
# writing
# --------------------------------------------------------------------------- #

def append_to_pipeline(new: list[dict]) -> None:
    text = PIPELINE.read_text(encoding="utf-8")
    if PENDING_HEADER not in text:
        sys.exit(f"'{PENDING_HEADER}' section not found in {PIPELINE}")

    block = "".join(
        f"- [ ] {r['job_url']}  <!-- {r['company']} | {r['title']} | {r['location']} "
        f"| via jobspy:{r['site']} -->\n"
        for r in new
    )
    head, _, tail = text.partition(PENDING_HEADER)
    # insert after the section's HTML comment marker if present, else right after the header
    marker = "<!-- paste URLs below this line"
    if marker in tail:
        idx = tail.index("\n", tail.index(marker)) + 1
        tail = tail[:idx] + block + tail[idx:]
    else:
        tail = "\n" + block + tail.lstrip("\n")
    PIPELINE.write_text(head + PENDING_HEADER + tail, encoding="utf-8")


def append_to_history(new: list[dict]) -> None:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    exists = HISTORY.exists()
    with HISTORY.open("a", encoding="utf-8") as fh:
        if not exists:
            fh.write("\t".join(HISTORY_COLUMNS) + "\n")
        for r in new:
            fh.write(
                "\t".join(
                    [stamp, r["site"], r["company"], r["title"], r["location"], r["job_url"]]
                )
                + "\n"
            )


# --------------------------------------------------------------------------- #

def main() -> None:
    ap = argparse.ArgumentParser(description="JobSpy discovery feed for career-ops")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--hours", type=int)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--config", type=Path, default=CONFIG)
    ap.add_argument("--search", help="ad-hoc search term instead of the config matrix")
    ap.add_argument("--location", help="location for --search (default: Germany)")
    args = ap.parse_args()

    cfg = json.loads(args.config.read_text(encoding="utf-8"))
    seen, applied = load_history(), load_applied()
    excluded = [k.lower() for k in cfg.get("exclude_title_keywords", [])]

    rows = run_searches(cfg, args)

    new: list[dict] = []
    suppressed: list[dict] = []   # dropped as already-applied — always shown, never silent
    batch_urls: set[str] = set()
    counts = {"seen": 0, "applied": 0, "excluded": 0, "nourl": 0}

    for r in rows:
        url = canonical_url(r["job_url"])
        if not url:
            counts["nourl"] += 1
            continue
        r["job_url"] = url
        if url in seen or url in batch_urls:
            counts["seen"] += 1
            continue
        if any(k in r["title"].lower() for k in excluded):
            counts["excluded"] += 1
            continue
        if already_applied(applied, r["company"], r["title"]):
            counts["applied"] += 1
            suppressed.append(r)
            continue
        batch_urls.add(url)
        new.append(r)

    if args.limit:
        new = new[: args.limit]

    print(
        f"\n{len(rows)} scraped -> {len(new)} new "
        f"(skipped: {counts['seen']} already seen, {counts['applied']} already applied, "
        f"{counts['excluded']} title-excluded, {counts['nourl']} no url)"
    )
    for r in new:
        print(f"  + {r['company']} | {r['title']} | {r['location']}\n    {r['job_url']}")

    # NO-SKIP LAW: a suppressed job must be visible, so a wrong match can be caught.
    if suppressed:
        print("\n  suppressed as already applied (check for false matches):")
        for r in suppressed:
            print(f"    - {r['company']} | {r['title']}\n      {r['job_url']}")

    if not new:
        return
    if args.dry_run:
        print("\n[dry-run] nothing written")
        return

    append_to_pipeline(new)
    append_to_history(new)
    print(f"\nAppended {len(new)} URLs to {PIPELINE.relative_to(ROOT)} "
          f"and logged them in {HISTORY.relative_to(ROOT)}.")
    print("Next: tell Claude \"run the pipeline\".")


if __name__ == "__main__":
    main()
