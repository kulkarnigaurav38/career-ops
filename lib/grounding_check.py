#!/usr/bin/env python3
"""
grounding_check.py — catch invented experience in tailored applications.

Enforces the GROUNDING LAW in CLAUDE.md: nothing may appear in a tailored CV or
cover letter that is not grounded in the DOCX masters. A blocklist of forbidden
technologies cannot work (you only ban what you thought of), so this checks the
other direction: a set of experience-claim terms that are ABSENT from the masters
and therefore may never be attributed to the candidate.

Born from a real incident: 25 of 44 applications in one batch claimed IT-support
work at a past employer that never happened.

Usage:
    python3 lib/grounding_check.py REF [REF ...]
    python3 lib/grounding_check.py --all          # every ref with PDFs in output/
    python3 lib/grounding_check.py --batch 197 240

Exit code 1 if any application has an ungrounded claim.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import owner_config

ROOT = owner_config.ROOT
OUTPUT = ROOT / "output"
MASTERS = [ROOT / owner_config.masters(lang)[0] for lang in ("DE", "EN")]

# Terms that describe EXPERIENCE. If a term is absent from the masters it must
# never be attributed to the candidate in a tailored document.
CLAIM_TERMS = [
    "ticket", "ticketsystem", "störung", "stoerung", "first-level", "first level",
    "1st-level", "1st level", "2nd-level", "second-level", "incident", "helpdesk",
    "servicedesk", "service desk", "anlaufstelle", "excel", "active directory",
    "windows server", "citrix", "itil", "fachinformatiker", "exchange",
    "tk-anlage", "sap ", "navision", "proalpha",
]

# A hit is legitimate when the sentence names a ROLE requirement or admits a gap
# rather than claiming the experience. These markers indicate that framing.
GAP_MARKERS = [
    "nicht gearbeitet", "nicht betreut", "keine erfahrung", "bisher nicht",
    "habe ich nicht", "bringe ich nicht", "offen gesagt", "noch nicht",
    "nicht mit", "fehlt mir", "kein ", "keine ", "not worked", "no experience",
]

# The cover letter maps requirements with "Sie suchen X:" / "Sie erwarten X:" — that names what the
# ROLE needs, not what he has, so a term inside such a prefix is legitimate framing, not a claim.
REQUIREMENT_PREFIX = re.compile(
    r"^(sie (suchen|erwarten|brauchen|wollen|benötigen)|wichtig (ist|sind)|"
    r"gefragt (ist|sind)|ihre anforderung|you (need|expect|are looking)|the role)\b", re.I)

# pdftotext emits Symbol-font bullets as private-use glyphs (\uf0b7); strip leading
# bullets/whitespace before any prefix test or "^" never matches a bulleted line.
LEADING_JUNK = re.compile(r"^[\s\u2022\u00b7\uf0a7\uf0b7\-\*]+")

# Metrics that must match the master exactly.
METRIC_RULES = [
    (re.compile(r"karate[^.]{0,60}laufzeit|laufzeit[^.]{0,60}karate", re.I),
     "Karate metric restated as runtime — the master says 'manuellen Aufwand um 30 % gesenkt'"),
]


def master_text() -> str:
    try:
        from docx import Document
    except ImportError:
        sys.exit("python-docx not installed")
    out = []
    for m in MASTERS:
        if not m.exists():
            continue
        d = Document(str(m))
        out += [p.text for p in d.paragraphs]
        for t in d.tables:
            for row in t.rows:
                for c in row.cells:
                    out.append(c.text)
    return "\n".join(out).lower()


def pdf_text(p: Path) -> str:
    if not p.exists():
        return ""
    return subprocess.run(["pdftotext", "-layout", str(p), "-"],
                          capture_output=True, text=True).stdout


def sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text)
    return [s.strip() for s in re.split(r"(?<=[.!?:])\s+", text) if s.strip()]


def check_ref(ref: str, mtext: str, verbose: bool = False) -> list[str]:
    problems = []
    ungrounded = [t for t in CLAIM_TERMS if t not in mtext]
    # deliverables are named per language: {REF}_LEBENSLAUF/_CV, {REF}_ANSCHREIBEN/_COVER_LETTER
    for kind, suffixes in (("cv", ("CV", "LEBENSLAUF")),
                           ("coverletter", ("COVER_LETTER", "ANSCHREIBEN"))):
        hits = [OUTPUT / f"{ref}_{sfx}.pdf" for sfx in suffixes]
        pdf = next((h for h in hits if h.exists()), hits[0])
        raw = pdf_text(pdf)
        if not raw:
            continue
        # the CL subject line legitimately quotes the JD title
        raw = re.sub(r"Bewerbung als [^\n]{0,120}", "", raw)
        for s in sentences(raw):
            low = s.lower()
            for term in ungrounded:
                if term in low:
                    if any(g in low for g in GAP_MARKERS):
                        if verbose:
                            print(f"    ok (gap-framed) [{kind}] {s[:110]}")
                        continue
                    if REQUIREMENT_PREFIX.match(LEADING_JUNK.sub('', s)):
                        if verbose:
                            print(f"    ok (requirement) [{kind}] {s[:110]}")
                        continue
                    problems.append(f"[{kind}] '{term}' claimed: {s[:160]}")
        for rx, msg in METRIC_RULES:
            if rx.search(raw):
                problems.append(f"[{kind}] {msg}")
    return problems


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("refs", nargs="*")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--verbose", "-v", action="store_true")
    a = ap.parse_args()

    refs = a.refs
    if a.all:
        refs = sorted({p.name.split("_")[0] for p in OUTPUT.glob("*_CV.pdf")}
                      | {p.name.split("_")[0] for p in OUTPUT.glob("*_LEBENSLAUF.pdf")})
    if not refs:
        sys.exit("no refs given (use --all or list refs)")

    mtext = master_text()
    absent = [t for t in CLAIM_TERMS if t not in mtext]
    print(f"masters loaded ({len(mtext)} chars); {len(absent)}/{len(CLAIM_TERMS)} claim-terms absent "
          f"from them and therefore forbidden as experience\n")

    bad = 0
    for ref in refs:
        probs = check_ref(ref, mtext, a.verbose)
        if probs:
            bad += 1
            print(f"  FAIL {ref}")
            for p in probs[:6]:
                print(f"        {p}")
        elif a.verbose:
            print(f"  ok   {ref}")
    print(f"\n{len(refs)} checked, {bad} with ungrounded claims")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
