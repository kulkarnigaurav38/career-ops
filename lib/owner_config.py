#!/usr/bin/env python3
"""Owner-specific settings for the tailoring tools.

Everything personal (your name, your city, the filenames of your DOCX masters)
lives in config/owner.json, which is gitignored. Copy config/owner.example.json
to config/owner.json and fill it in once; the tools read it from here.
"""
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "owner.json"
EXAMPLE = ROOT / "config" / "owner.example.json"

_DEFAULTS = {
    "name": "",
    "city": "",
    "email_handle": "",
    "masters": {
        "DE": {"cv": "templates/cv/CV_DE.docx",
               "cover_letter": "templates/cv/CoverLetter_DE.docx"},
        "EN": {"cv": "templates/cv/CV_EN.docx",
               "cover_letter": "templates/cv/CoverLetter_EN.docx"},
    },
    # How the tools recognise blocks inside your CV master.
    "cv": {
        # key -> a string that appears in that experience entry's heading
        "experience_entries": {},
        # which of those keys may have their "Tech:" line reordered per posting
        "reorderable_entries": [],
        # the project whose bullets get rewritten per posting, by title fragment
        "wildcard_project": "",
    },
}


def load():
    """Return the owner config, merged over the defaults."""
    if not CONFIG.exists():
        raise SystemExit(
            f"Missing {CONFIG}.\n"
            f"Copy {EXAMPLE.name} to owner.json in config/ and fill in your details."
        )
    data = json.loads(CONFIG.read_text(encoding="utf-8"))
    merged = dict(_DEFAULTS)
    merged.update(data)
    return merged


def masters(lang):
    """(cv_path, cover_letter_path) for 'DE' or 'EN', relative to the repo root."""
    m = load()["masters"]
    if lang not in m:
        raise SystemExit(f"No masters configured for language '{lang}' in {CONFIG}")
    return m[lang]["cv"], m[lang]["cover_letter"]


def soffice():
    """Path to the LibreOffice binary: $SOFFICE_BIN, then PATH, then common locations."""
    from shutil import which
    env = os.environ.get("SOFFICE_BIN")
    if env:
        return env
    found = which("soffice") or which("libreoffice")
    if found:
        return found
    for candidate in ("/opt/homebrew/bin/soffice",
                      "/usr/local/bin/soffice",
                      "/usr/bin/soffice",
                      "/Applications/LibreOffice.app/Contents/MacOS/soffice"):
        if os.path.exists(candidate):
            return candidate
    raise SystemExit("LibreOffice not found. Install it or set SOFFICE_BIN.")
