#!/usr/bin/env python3
"""
jd_contact.py — pull the named contact person out of a saved JD.

German ads routinely name the Ansprechpartner ("Ihre Ansprechpartnerin Frau
Katharina Rederath, Tel. …"). That person owns the req, so they are a far better
outreach target than anyone guessed from a LinkedIn company search — this is
STEP 1 of `outreach` mode, and the LinkedIn search is only the fallback.

Usage:
    python3 lib/jd_contact.py jds/127-spie-rodias.md
    python3 lib/jd_contact.py --all            # every JD that names someone
    python3 lib/jd_contact.py --ref D9GD       # resolve via data/ref-map.tsv
"""

from __future__ import annotations

import argparse
import glob
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import owner_config

# Your own address, so it is never mistaken for the employer's contact.
_OWN_HANDLE = (owner_config.load().get("email_handle") or "").lower()

ROOT = Path(__file__).resolve().parent.parent
JDS = ROOT / "jds"

CAP = r"(?!Frau\b|Herr\b|Dr\b|Prof\b)[A-ZÄÖÜ][a-zäöüß]{2,}(?:-[A-ZÄÖÜ][a-zäöüß]{2,})?"
NAME = rf"(?:Dr\.\s+|Prof\.\s+)?{CAP}\s+{CAP}"

# Cues that a real contact person is being introduced. Ordered by how strong they are.
CUES = [
    (rf"Ansprechpartner(?:in)?[^.\n]{{0,40}}?(?:Frau|Herr)\s+({NAME})", 10),
    (rf"Ansprechpartner(?:in)?[:\s]+({NAME})", 9),
    (rf"(?:Rückfragen|Fragen|Auskunft)[^.\n]{{0,80}}?(?:Frau|Herr)\s+({NAME})", 8),
    (rf"(?:wenden Sie sich|steht Ihnen|melden Sie sich)[^.\n]{{0,60}}?(?:Frau|Herr)\s+({NAME})", 8),
    (rf"(?:Kontakt|Kontaktperson)[:\s]+(?:Frau|Herr)?\s*({NAME})", 7),
    (rf"(?:Frau|Herr)\s+({NAME})[^.\n]{{0,50}}(?:Tel|freut|gerne|zur Verfügung)", 6),
    (rf"(?:Frau|Herr)\s+({NAME})", 3),
]

# Words that look like names to the regex but never are.
STOP = {
    "seniority", "ihre", "unser", "unsere", "wir", "das", "die", "der", "sie", "ihr",
    "jetzt", "bitte", "gerne", "vollzeit", "teilzeit", "remote", "homeoffice", "team",
    "stellenanzeige", "bewerbung", "karriere", "kontakt", "impressum", "datenschutz",
    "job", "jobs", "stelle", "position", "aufgaben", "profil", "benefits", "standort",
    "arbeitsort", "eintritt", "gehalt", "referenz", "kennziffer", "montag", "freitag",
    "deutschland", "münchen", "berlin", "hamburg", "stuttgart", "köln", "frankfurt",
}


def clean_body(text: str) -> str:
    return text.split("## Raw JD", 1)[-1]


def plausible(name: str) -> bool:
    parts = re.sub(r"^(Dr\.|Prof\.)\s+", "", name).split()
    if len(parts) < 2:
        return False
    return not any(p.lower() in STOP for p in parts)


def extract(text: str) -> dict:
    body = clean_body(text)
    best, best_score = None, 0
    for rx, score in CUES:
        for m in re.finditer(rx, body):
            cand = " ".join(m.group(1).split())
            if not plausible(cand):
                continue
            if score > best_score:
                best, best_score = cand, score
            break
    # a Frau/Herr right before the match tells us how to address them
    anrede = ""
    if best:
        m = re.search(r"(Frau|Herr)\s+(?:Dr\.\s+|Prof\.\s+)?" + re.escape(best.split()[-1]), body)
        if m:
            anrede = m.group(1)
        else:
            m = re.search(r"(Frau|Herr)\s+" + re.escape(best.split()[0]), body)
            anrede = m.group(1) if m else ""

    emails = [e for e in re.findall(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}", body)
              if _OWN_HANDLE not in e.lower()]

    # A personal mailbox IS a named contact: lena.riexinger@trumpf.com -> Lena Riexinger.
    # Without this the script reports "email only" and the real name is lost.
    if not best:
        for e in emails:
            local = e.split("@")[0]
            m = re.fullmatch(r"([a-zA-Zäöüß]{2,})[._]([a-zA-Zäöüß]{2,})", local)
            if not m:
                continue
            cand = " ".join(w.capitalize() for w in m.groups())
            if plausible(cand) and not any(g in local.lower() for g in
                                           ("info", "job", "karriere", "career", "hr", "bewerb",
                                            "recruit", "kontakt", "office", "team", "no.reply")):
                best, best_score = cand, 5      # 5 = derived from the address, not stated in prose
                break
    # Nur Nummern mit Telefon-Kontext ODER klarer Vorwahl-Struktur. Ohne diese Pruefung
    # liest der Regex Gehaltsspannen wie "43.000-80.000 EUR" als Rufnummer.
    phones = []
    for m in re.finditer(r"(?:Tel\.?|Telefon|Mobil|Fon|Rufnummer)[:\s]*((?:\+49|0)[\d][\d\s/().-]{6,18}\d)", body, re.I):
        phones.append(m.group(1))
    if not phones:
        for m in re.finditer(r"(?<![\d.,])((?:\+49|0)[1-9][\d\s/()-]{6,18}\d)(?![\d.,])", body):
            cand = m.group(1)
            if re.search(r"\d\.\d{3}", cand):        # 43.000 -> Geld, keine Nummer
                continue
            if len(re.sub(r"\D", "", cand)) < 8:
                continue
            phones.append(cand)
    return {
        "name": best or "",
        "anrede": anrede,
        "confidence": best_score,
        "email": emails[0] if emails else "",
        "phone": " ".join(phones[0].split()) if phones else "",
    }


def show(path: Path) -> dict:
    d = extract(path.read_text(encoding="utf-8"))
    d["jd"] = path.name
    return d


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("jd", nargs="?")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--ref")
    a = ap.parse_args()

    if a.ref:
        tsv = (ROOT / "data" / "ref-map.tsv").read_text(encoding="utf-8")
        row = next((l for l in tsv.split("\n") if l.startswith(a.ref.upper() + "\t")), None)
        if not row:
            sys.exit(f"ref {a.ref} not in ref-map.tsv")
        rep = row.split("\t")[4] if len(row.split("\t")) > 4 else ""
        num = re.match(r"reports/(\d{3})", rep)
        if not num:
            sys.exit(f"no report path for {a.ref}, cannot resolve the JD")
        hits = glob.glob(str(JDS / f"{num.group(1)}-*.md"))
        if not hits:
            sys.exit(f"no JD file for #{num.group(1)}")
        a.jd = hits[0]

    if a.all:
        rows = [show(Path(f)) for f in sorted(glob.glob(str(JDS / "*.md")))]
        named = [r for r in rows if r["name"]]
        print(f"{len(rows)} JDs, {len(named)} name a contact person\n")
        for r in sorted(named, key=lambda x: -x["confidence"]):
            print(f"  [{r['confidence']:>2}] {r['jd'][:44]:<46} {r['anrede']} {r['name']:<24} "
                  f"{r['email'][:30]:<32} {r['phone']}")
        return

    if not a.jd:
        sys.exit("give a JD path, --ref XXXX, or --all")
    d = show(Path(a.jd))
    if not d["name"] and not d["email"]:
        print("no contact person found in this JD — fall back to the LinkedIn company search")
        return
    print(f"  Name:       {d['anrede']} {d['name']}".rstrip() if d["name"] else "  Name:       -")
    print(f"  Confidence: {d['confidence']}/10")
    print(f"  E-Mail:     {d['email'] or '-'}")
    print(f"  Telefon:    {d['phone'] or '-'}")
    if d["name"]:
        q = d["name"].replace(" ", "%20")
        print(f"\n  LinkedIn:   https://www.linkedin.com/search/results/people/?keywords={q}")


if __name__ == "__main__":
    main()
