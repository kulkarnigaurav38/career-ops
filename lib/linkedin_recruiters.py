#!/usr/bin/env python3
"""
linkedin_recruiters.py — turn target companies into a deduped recruiter list.

Feeds `outreach` mode (modes/outreach.md): this script only DISCOVERS people and
writes them to data/recruiters.tsv; the drafting and the click stay human.

STDLIB ONLY, PYTHON 3.9 COMPATIBLE — runs on the system interpreter
(/usr/bin/python3, 3.9.x). No requests, no pandas, no jobspy, no pip install.

Targets come from data/applications.md (companies whose Status is Evaluated or
Applied) unless --companies / --ref narrows them.

Three input modes, pick exactly one:

  --manual            zero cost, zero setup. Prints the LinkedIn People-tab URL
                      and a DE+EN Boolean people-search string per company, so
                      you collect the profiles by hand (~30s per company) and
                      paste them into a CSV for --import.

  --import FILE.csv   ingest a CSV exported by hand (Apify web UI, Sales
                      Navigator, or your own list). Columns are matched
                      case-insensitively against several likely names, so most
                      exports work untouched. This is the free path.

  --apify             call an Apify actor's run-sync-get-dataset-items endpoint
                      with APIFY_TOKEN from the environment (costs Apify
                      credits). The token is never printed and never stored.

Usage:
    /usr/bin/python3 lib/linkedin_recruiters.py --manual
    /usr/bin/python3 lib/linkedin_recruiters.py --manual --ref URW0
    /usr/bin/python3 lib/linkedin_recruiters.py --import ~/Downloads/apify.csv --dry-run
    /usr/bin/python3 lib/linkedin_recruiters.py --import ~/Downloads/apify.csv --append-outreach
    /usr/bin/python3 lib/linkedin_recruiters.py --companies "Matrix42,Brunel" --manual
    export APIFY_TOKEN="apify_api_..."
    /usr/bin/python3 lib/linkedin_recruiters.py --apify --limit 40

Output: data/recruiters.tsv (append-only, never reordered, never clobbered)
    first_seen  person  title  company  ref  profile_url  source  notes
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPLICATIONS = ROOT / "data" / "applications.md"
RECRUITERS = ROOT / "data" / "recruiters.tsv"
OUTREACH = ROOT / "data" / "outreach.md"

RECRUITER_COLUMNS = [
    "first_seen", "person", "title", "company", "ref", "profile_url", "source", "notes",
]
OUTREACH_COLUMNS = [
    "#", "date", "person", "title", "company", "ref",
    "channel", "stage", "invited", "next", "nextdate", "profile", "notes",
]

DEFAULT_ACTOR = "apt_marble~linkedin-recruiter-scraper"
APIFY_ENDPOINT = "https://api.apify.com/v2/acts/{actor}/run-sync-get-dataset-items"
DEFAULT_STATUSES = ["evaluated", "applied"]

# German + English recruiter titles — the filter and the Boolean search share this list.
RECRUITER_TITLES = [
    "Recruiter", "Recruiting", "Talent Acquisition", "Talent Sourcer",
    "Personalreferent", "Personalreferentin", "HR Business Partner",
]
TITLE_KEYWORDS = [t.lower() for t in RECRUITER_TITLES] + ["recruitment", "sourcer", "hrbp"]

# Actor / CSV field names vary wildly — try every plausible key, normalised.
FIELD_KEYS = {
    "person": ["name", "fullname", "full_name", "personname", "profilename", "displayname"],
    "title": ["headline", "title", "position", "jobtitle", "job_title", "occupation"],
    "company": ["company", "companyname", "company_name", "currentcompany", "employer", "organization"],
    "profile_url": ["url", "profileurl", "profile_url", "linkedinurl", "linkedin_url",
                    "link", "publicprofileurl", "profilelink"],
    "location": ["location", "geolocation", "city", "region", "addresswithcountry"],
}


# --------------------------------------------------------------------------- #
# normalisation / dedup
# --------------------------------------------------------------------------- #

def norm(s: str) -> str:
    """Lowercase, strip legal suffixes and punctuation for fuzzy company matching."""
    s = (s or "").lower()
    s = re.sub(r"\((?:m|w|f|d|x)(?:\s*/\s*(?:m|w|f|d|x))*\)", " ", s)
    s = re.sub(r"\b(gmbh|ag|se|kg|mbh|co|ohg|e\.?v|inc|ltd|llc|group|deutschland)\b", " ", s)
    s = re.sub(r"[^a-z0-9äöüß]+", " ", s)
    return " ".join(s.split())


def nkey(s: str) -> str:
    """Normalise a field/column name: 'Profile URL' -> 'profileurl'."""
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def canonical_url(url: str) -> str:
    """Dedup key: no scheme/query/fragment/www, lowercase; LinkedIn keys on /in/<slug>."""
    u = (url or "").strip().split("?")[0].split("#")[0].rstrip("/").lower()
    u = re.sub(r"^https?://", "", u)
    u = re.sub(r"^www\.", "", u)
    m = re.search(r"linkedin\.com/in/([^/]+)", u)
    if m:
        return "linkedin.com/in/" + m.group(1)
    return u


def tidy_url(url: str) -> str:
    """What gets stored: the profile URL without tracking params or trailing slash."""
    return (url or "").strip().split("?")[0].split("#")[0].rstrip("/")


def company_slug(company: str) -> str:
    """Best-effort LinkedIn company-page slug (a guess — verify once per company)."""
    return re.sub(r"\s+", "-", norm(company)).strip("-")


def clean(s: str) -> str:
    """Collapse whitespace; TSV/markdown cells must stay on one line."""
    return re.sub(r"\s+", " ", str(s if s is not None else "")).strip()


def md_cell(s: str) -> str:
    return clean(s).replace("|", "/")


def pick(item: dict, field: str) -> str:
    """Defensive field lookup across the FIELD_KEYS aliases (keys normalised)."""
    flat = {}
    for k, v in item.items():
        if isinstance(v, (dict, list)):
            continue
        flat.setdefault(nkey(k), v)
    for key in FIELD_KEYS[field]:
        val = flat.get(key)
        if val not in (None, ""):
            return clean(val)
    if field == "person":  # some actors only ship first/last name
        first, last = flat.get("firstname", ""), flat.get("lastname", "")
        if first or last:
            return clean("{0} {1}".format(first, last))
    return ""


def is_recruiter(title: str) -> bool:
    t = (title or "").lower()
    return any(k in t for k in TITLE_KEYWORDS)


# --------------------------------------------------------------------------- #
# targets (data/applications.md)
# --------------------------------------------------------------------------- #

def load_tracker() -> list:
    """Rows of the applications tracker: # | Date | Company | Role | Score | Status | ... | Notes."""
    if not APPLICATIONS.exists():
        return []
    rows = []
    for line in APPLICATIONS.read_text(encoding="utf-8").splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 6 or cells[0] in ("#", "") or set(cells[0]) <= {"-"}:
            continue
        notes = " | ".join(cells[8:]) if len(cells) > 8 else ""
        m = re.search(r"\bRef\s+([A-Za-z0-9]{4})\b", notes)
        num = int(cells[0]) if cells[0].isdigit() else 0
        rows.append({
            "num": num,
            "company": cells[2],
            "role": cells[3],
            "status": cells[5].strip("* "),
            "ref": m.group(1).upper() if m else "-",
        })
    return rows


def targets(args, tracker: list) -> list:
    """[{company, ref}] to work on, deduped, most recent application wins the ref."""
    if args.ref:
        want = args.ref.strip().upper()
        hits = [r for r in tracker if r["ref"].upper() == want]
        if not hits:
            sys.exit("Ref {0} not found in {1} (Notes column).".format(want, APPLICATIONS.name))
        best = max(hits, key=lambda r: r["num"])
        return [{"company": best["company"], "ref": best["ref"]}]

    if args.companies:
        names = [c.strip() for c in args.companies.split(",") if c.strip()]
        out = []
        for name in names:
            out.append({"company": name, "ref": ref_for(tracker, name)})
        return out

    statuses = [s.strip().lower() for s in args.status.split(",") if s.strip()]
    picked = {}
    for r in sorted(tracker, key=lambda r: r["num"]):
        if r["status"].lower() not in statuses or not r["company"]:
            continue
        picked[norm(r["company"])] = {"company": r["company"], "ref": r["ref"]}
    return list(picked.values())


def ref_for(tracker: list, company: str) -> str:
    """Ref of the most recent application at this company, '-' if none."""
    c = norm(company)
    if not c:
        return "-"
    hits = [r for r in tracker if r["ref"] != "-" and (norm(r["company"]) == c
            or (len(c) > 3 and (c in norm(r["company"]) or norm(r["company"]) in c)))]
    return max(hits, key=lambda r: r["num"])["ref"] if hits else "-"


# --------------------------------------------------------------------------- #
# input mode: manual
# --------------------------------------------------------------------------- #

def boolean_query(company: str) -> str:
    titles = " OR ".join(
        '"{0}"'.format(t) if " " in t else t for t in RECRUITER_TITLES
    )
    return '"{0}" AND ({1})'.format(company, titles)


def print_manual(tgts: list) -> None:
    print("Collect recruiters by hand (~30s per company), then save them as a CSV with the")
    print("columns  name,headline,company,profileUrl  and run:")
    print("    /usr/bin/python3 lib/linkedin_recruiters.py --import <that-file>.csv\n")
    for t in tgts:
        slug = company_slug(t["company"])
        q = boolean_query(t["company"])
        print("{0}  (Ref {1})".format(t["company"], t["ref"]))
        print("  people tab : https://www.linkedin.com/company/{0}/people/"
              "?keywords=recruiter".format(slug))
        print("  people srch: https://www.linkedin.com/search/results/people/?keywords={0}"
              .format(urllib.parse.quote(q)))
        print("  boolean    : {0}".format(q))
        print()
    print("({0} compan{1}. The company slug is derived from the name - if a People tab 404s, "
          "open the company page once and use its real slug.)".format(
              len(tgts), "y" if len(tgts) == 1 else "ies"))


# --------------------------------------------------------------------------- #
# input mode: --import CSV
# --------------------------------------------------------------------------- #

def read_csv(path: Path) -> list:
    raw = path.read_text(encoding="utf-8-sig", errors="replace")
    delim = ","
    try:
        delim = csv.Sniffer().sniff(raw.split("\n")[0], delimiters=",;\t").delimiter
    except Exception:
        pass
    return [dict(row) for row in csv.DictReader(raw.splitlines(), delimiter=delim)]


# --------------------------------------------------------------------------- #
# input mode: --apify
# --------------------------------------------------------------------------- #

TOKEN_HELP = """APIFY_TOKEN is not set, so --apify cannot run.

  export APIFY_TOKEN="apify_api_..."     # console.apify.com -> Settings -> API & Integrations
  /usr/bin/python3 lib/linkedin_recruiters.py --apify

Free alternatives (no token, no credits):
  /usr/bin/python3 lib/linkedin_recruiters.py --manual          # search strings to collect by hand
  /usr/bin/python3 lib/linkedin_recruiters.py --import list.csv # ingest any exported CSV
"""


def fetch_apify(args, tgts: list) -> list:
    token = (os.environ.get("APIFY_TOKEN") or "").strip()
    if not token:
        sys.exit(TOKEN_HELP)

    if args.apify_input:
        payload = json.loads(Path(args.apify_input).read_text(encoding="utf-8"))
    else:
        companies = [t["company"] for t in tgts]
        payload = {
            "companyNames": companies,
            "companies": companies,
            "searchQuery": boolean_query(companies[0]) if len(companies) == 1 else "recruiter",
            "keywords": "recruiter",
            "maxItems": args.limit or 50,
        }

    url = APIFY_ENDPOINT.format(actor=args.actor)
    print("  POST {0}?token=<hidden>  ({1} companies)".format(url, len(tgts)), file=sys.stderr)
    req = urllib.request.Request(
        url + "?token=" + urllib.parse.quote(token),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=900) as resp:
            items = json.loads(resp.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:400].replace(token, "<hidden>")
        sys.exit("Apify HTTP {0} for actor {1}\n{2}\n"
                 "(check the actor id and its input schema; --apify-input FILE.json "
                 "sends your own payload)".format(e.code, args.actor, body))
    except urllib.error.URLError as e:
        sys.exit("Apify request failed: {0}".format(e.reason))

    if isinstance(items, dict):
        items = items.get("items") or items.get("data") or []
    return [i for i in items if isinstance(i, dict)]


# --------------------------------------------------------------------------- #
# writing: data/recruiters.tsv
# --------------------------------------------------------------------------- #

def load_recruiters() -> set:
    if not RECRUITERS.exists():
        return set()
    seen = set()
    for line in RECRUITERS.read_text(encoding="utf-8").splitlines()[1:]:
        cells = line.split("\t")
        if len(cells) >= len(RECRUITER_COLUMNS) and cells[5].strip():
            seen.add(canonical_url(cells[5]))
    return seen


def append_recruiters(rows: list) -> None:
    exists = RECRUITERS.exists() and RECRUITERS.read_text(encoding="utf-8").strip() != ""
    RECRUITERS.parent.mkdir(parents=True, exist_ok=True)
    with RECRUITERS.open("a", encoding="utf-8") as fh:
        if not exists:
            fh.write("\t".join(RECRUITER_COLUMNS) + "\n")
        for r in rows:
            fh.write("\t".join(clean(r[c]) for c in RECRUITER_COLUMNS) + "\n")


# --------------------------------------------------------------------------- #
# writing: data/outreach.md (last 13-column table only)
# --------------------------------------------------------------------------- #

def find_row_table(lines: list):
    """Locate the single 13-column outreach table. Returns (start, end) or None."""
    blocks = []
    i = 0
    while i < len(lines):
        if lines[i].lstrip().startswith("|"):
            j = i
            while j < len(lines) and lines[j].lstrip().startswith("|"):
                j += 1
            blocks.append((i, j))
            i = j
        else:
            i += 1
    hits = []
    for start, end in blocks:
        header = [nkey(c) for c in lines[start].strip().strip("|").split("|")]
        if header == [nkey(c) for c in OUTREACH_COLUMNS]:
            hits.append((start, end))
    return hits[0] if len(hits) == 1 else None


def append_outreach(rows: list, dry_run: bool) -> int:
    """Append Identified rows below the last row of the outreach table. Returns count."""
    if not OUTREACH.exists():
        print("! {0} not found - printing rows instead".format(OUTREACH), file=sys.stderr)
        return -1
    text = OUTREACH.read_text(encoding="utf-8")
    lines = text.split("\n")
    table = find_row_table(lines)
    if table is None:
        print("! could not locate the 13-column outreach table unambiguously "
              "- refusing to write", file=sys.stderr)
        return -1
    start, end = table

    known = set()
    for m in re.findall(r"https?://[^\s|)\]]+", text):
        known.add(canonical_url(m))

    last_num = 0
    for line in lines[start + 2:end]:
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells and cells[0].isdigit():
            last_num = max(last_num, int(cells[0]))

    today = date.today().isoformat()
    new_lines, added = [], 0
    for r in rows:
        key = canonical_url(r["profile_url"])
        if not key or key in known:
            continue
        known.add(key)
        last_num += 1
        added += 1
        new_lines.append("| " + " | ".join(md_cell(c) for c in [
            str(last_num), today, r["person"], r["title"], r["company"], r["ref"] or "-",
            # Invited stays "-": the row is only drafted here, nothing has been sent yet.
            "Note", "Identified", "-", "send invite", today, r["profile_url"],
            r["notes"] or r["source"],
        ]) + " |")

    if not new_lines:
        return 0
    if dry_run:
        for line in new_lines:
            print("  [dry-run outreach] " + line)
        return added

    lines[end:end] = new_lines
    OUTREACH.write_text("\n".join(lines), encoding="utf-8")
    return added


# --------------------------------------------------------------------------- #

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Recruiter discovery for career-ops outreach mode (stdlib only, py3.9).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Input modes: --manual (free) | --import FILE.csv (free) | --apify (credits).",
    )
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--manual", action="store_true",
                      help="print LinkedIn search strings per company, write nothing")
    mode.add_argument("--import", dest="import_csv", metavar="FILE.csv",
                      help="ingest a hand-exported CSV")
    mode.add_argument("--apify", action="store_true",
                      help="call an Apify actor (needs APIFY_TOKEN in the environment)")

    ap.add_argument("--companies", help='comma-separated target companies (overrides the tracker)')
    ap.add_argument("--ref", help="target only the company of this application ref (e.g. URW0)")
    ap.add_argument("--status", default=",".join(DEFAULT_STATUSES),
                    help="tracker statuses that count as targets (default: Evaluated,Applied)")
    ap.add_argument("--actor", default=DEFAULT_ACTOR, help="Apify actor id (default: %(default)s)")
    ap.add_argument("--apify-input", metavar="FILE.json",
                    help="send this JSON as the actor input instead of the built-in payload")
    ap.add_argument("--limit", type=int, help="cap how many people this run processes")
    ap.add_argument("--no-filter", action="store_true",
                    help="keep people whose title is not a recruiter title")
    ap.add_argument("--append-outreach", action="store_true",
                    help="also append the rows to data/outreach.md as stage Identified")
    ap.add_argument("--dry-run", action="store_true", help="print what would be written, write nothing")
    args = ap.parse_args()

    tracker = load_tracker()
    tgts = targets(args, tracker)
    if not tgts:
        sys.exit("No target companies (tracker statuses: {0}). Use --companies.".format(args.status))

    if args.manual:
        print_manual(tgts)
        return

    # ---- collect ---------------------------------------------------------- #
    if args.import_csv:
        path = Path(args.import_csv).expanduser()
        if not path.exists():
            sys.exit("No such file: {0}".format(path))
        items = read_csv(path)
        source = "import:" + path.name
    else:
        items = fetch_apify(args, tgts)
        source = "apify:" + args.actor

    default_company = tgts[0]["company"] if len(tgts) == 1 else ""
    known = load_recruiters()
    batch = set()
    rows, counts = [], {"known": 0, "notrecruiter": 0, "nourl": 0}

    for item in items:
        url = tidy_url(pick(item, "profile_url"))
        key = canonical_url(url)
        if not key or "linkedin.com/in/" not in key:
            counts["nourl"] += 1
            continue
        title = pick(item, "title")
        if not args.no_filter and title and not is_recruiter(title):
            counts["notrecruiter"] += 1
            continue
        if key in batch:
            continue
        batch.add(key)
        company = pick(item, "company") or default_company
        rows.append({
            "first_seen": date.today().isoformat(),
            "person": pick(item, "person") or "?",
            "title": title,
            "company": company,
            "ref": (args.ref.upper() if args.ref else ref_for(tracker, company)),
            "profile_url": url,
            "source": source,
            "notes": pick(item, "location"),
        })

    if args.limit:
        rows = rows[: args.limit]
    new = [r for r in rows if canonical_url(r["profile_url"]) not in known]
    counts["known"] = len(rows) - len(new)

    # ---- report ----------------------------------------------------------- #
    print("\n{0} scraped -> {1} new (skipped: {2} already in recruiters.tsv, "
          "{3} not a recruiter title, {4} no linkedin profile url)".format(
              len(items), len(new), counts["known"],
              counts["notrecruiter"], counts["nourl"]))
    for r in new:
        print("  + {0} | {1} | {2} | Ref {3}\n    {4}".format(
            r["person"], r["title"] or "-", r["company"] or "-", r["ref"], r["profile_url"]))

    if args.dry_run:
        if args.append_outreach:
            append_outreach(rows, True)
        print("\n[dry-run] nothing written")
        return

    if new:
        append_recruiters(new)
        print("\nAppended {0} rows to {1}.".format(len(new), RECRUITERS.relative_to(ROOT)))

    # outreach dedups against its own file, so this also back-fills rows that
    # reached recruiters.tsv on an earlier run
    if args.append_outreach:
        added = append_outreach(rows, False)
        if added < 0:
            for r in rows:
                print("  {0} | {1} | {2} | {3}".format(
                    r["person"], r["title"], r["company"], r["profile_url"]))
            sys.exit(1)
        print("Appended {0} rows to {1} (stage Identified).".format(
            added, OUTREACH.relative_to(ROOT)))
    if new:
        print('Next: tell Claude "outreach mode for Ref <REF>".')


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:  # piping into head/grep is normal usage
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(0)
