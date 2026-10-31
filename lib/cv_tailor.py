#!/usr/bin/env python3
"""Deterministic per-application CV+CL tailoring on the DOCX masters.

Centralizes the error-prone python-docx surgery so content authoring stays declarative.
Run structure it relies on (verified against the 2026-07 masters, 82 paras):

CV  indices are resolved at runtime by _locate() - never hardcode them again.
    P[1]=FIXED title (never tailored) · no PROFIL section (removed 2026-09; header line is the summary)
    P[47]=Programmierung(run0 label · run1 bold-lead · run2 normal-rest)
    P[51]=Backend&Web(same 3-run shape)
    P[63]=wildcard-project title (run0 = TRAILING run after the <w:hyperlink>; suffix only)
    P[64],P[65]=wildcard bullets(run0) · P[66]=closing(run0) · P[67]=Stack(run0 label · run1 content)
    P[81]=signature(run0)
CL  tableT0 r0c0p0=company · r0c0p1=contact line · r0c1p0='<city>, DATE' · P[1]=FIXED title (never tailored)
    Body slots are resolved from the salutation, never hardcoded (see _locate_cl):
    subject · salutation · [tldr - EN only] · opening · record(FIXED) · match · close
    'match' carries every JD requirement in one paragraph, with the JD's skills bold:
    pass it as [[text, bold], ...] segments.

spec = {
  ref, lang: 'DE'|'EN',
  cv: { prog_bold, prog_normal, backend_bold, backend_normal,
        lk_suffix, lk_b1, lk_b2, lk_closing, lk_stack, sig_month },
  cl: { company, date, subject, opening, match, close,
        contact?, salutation?, tldr?, record? },   # ? = optional override
}
"""
import os, shutil, sys, json
from docx import Document
from docx.oxml.ns import qn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import owner_config

ROOT = str(owner_config.ROOT)
OWNER = owner_config.load()
MASTERS = {lang: owner_config.masters(lang) for lang in ("DE", "EN")}
# Prefix of the CV signature line, e.g. "Jane Doe - Berlin, ".
SIGNATURE_PREFIX = f"{OWNER['name']} - {OWNER['city']}, "
_CV = OWNER.get("cv", {})
# key -> string that identifies that experience entry in the master
ENTRIES = _CV.get("experience_entries", {})
# only these entries may have their "Tech:" line reordered per posting
REORDERABLE = tuple(_CV.get("reorderable_entries", []))
# the project whose bullets are rewritten per posting
WILDCARD = _CV.get("wildcard_project", "")

def _set(run, text):
    run.text = text

def _blank_extra(p, keep):
    for r in p.runs[keep:]:
        r.text = ""

def _set_single(p, text):
    """Rewrite a paragraph to one visible run, preserving run0 formatting."""
    if not p.runs:
        p.add_run(text); return
    p.runs[0].text = text
    _blank_extra(p, 1)

def _set_rich(p, segments):
    """Rewrite a paragraph from [[text, bold], ...] - used to bold the JD's required skills.

    Reuses run0 (which carries the body formatting) for the first segment and appends plain
    runs after it; anything left over from the master is blanked.
    """
    segments = [(t, bool(b)) for t, b in segments if t]
    if not segments:
        raise RuntimeError("cv_tailor: empty rich paragraph")
    for r in p.runs:
        r.text = ""
    first, rest = segments[0], segments[1:]
    if p.runs:
        p.runs[0].text, p.runs[0].bold = first[0], first[1]
    else:
        r = p.add_run(first[0]); r.bold = first[1]
    for text, bold in rest:
        r = p.add_run(text); r.bold = bold

def _set_labeled(p, text):
    """Project bullets ship as bold label + normal rest ("Microservices: Spring-Boot-Services ...").

    _set_single would drop the whole string into run0 - which is the BOLD label run - and the
    entire bullet would render bold. Two agents hit this independently and each re-split the runs
    by hand afterwards; do it here instead.
    """
    if ": " in text and len(p.runs) >= 2:
        label, rest = text.split(": ", 1)
        p.runs[0].text = label
        p.runs[1].text = ": " + rest
        _blank_extra(p, 2)
    else:
        _set_single(p, text)

def _set_any(p, value):
    """String -> plain paragraph; [[text, bold], ...] -> mixed bold/normal runs."""
    _set_rich(p, value) if isinstance(value, (list, tuple)) else _set_single(p, value)

def _plain_len(value):
    return sum(len(t) for t, _ in value) if isinstance(value, (list, tuple)) else len(value)

def _locate(P):
    """Resolve paragraph indices by TEXT, never by hardcoded number.

    The master is a built artifact: adding OPEN SOURCE + HACKATHONS and cutting
    PROJECTS to two moved everything after SKILLS (signature went 81 -> 77), which
    silently broke every hardcoded index in this file. CLAUDE.md already says to
    locate sections by searching doc.paragraphs — this does that.
    """
    ix = {}
    for i, para in enumerate(P):
        t = (para.text or "").strip(); u = t.upper()
        if u in ("SKILLS", "KENNTNISSE") and "skills" not in ix: ix["skills"] = i
        elif u in ("PROJECTS", "PROJEKTE") and "projects" not in ix: ix["projects"] = i
        elif (u.startswith("OPEN SOURCE") or u.startswith("OPEN-SOURCE")) and "oss" not in ix: ix["oss"] = i
        elif t.startswith(SIGNATURE_PREFIX.rstrip(", ")): ix["signature"] = i
    if "skills" not in ix or "projects" not in ix:
        raise RuntimeError("cv_tailor: SKILLS/PROJECTS heading not found - master layout changed")
    # skills rows: index EVERY row by its label. Offsets are not stable (7 -> 6 -> 9 rows
    # across rewrites) and neither are the label names themselves - the 2026-08 readability
    # pass split "Backend & Web" into "Backend" + "Frontend & Daten", which broke a lookup
    # that hardcoded the old label. Read whatever the master actually has.
    ix["skill_rows"] = {}
    for i in range(ix["skills"] + 1, ix["projects"]):
        txt = (P[i].text or "").strip()
        if ":" in txt:
            ix["skill_rows"][txt.split(":", 1)[0].strip().lower()] = i
    for key, names in (("prog", ("programmiersprachen", "programming languages",
                                 "programmierung", "programming")),
                       ("backend", ("backend & web", "backend"))):
        for n in names:
            if n in ix["skill_rows"]:
                ix[key] = ix["skill_rows"][n]; break
    if "prog" not in ix or "backend" not in ix:
        raise RuntimeError("cv_tailor: Programming/Backend skills row not found - "
                           f"master has {sorted(ix['skill_rows'])}")
    # Per-JD "Tech:" reordering, for the reorderable entries only. The employer name
    # lives inside a hyperlink, so para.text does not see it - read the full XML text.
    ix["tech"] = {}
    pending = None
    for i in range(0, ix["skills"]):
        full = "".join(P[i]._p.itertext())
        for key, needle in ENTRIES.items():
            if needle in full and "\t" in full:
                pending = key
        if pending and (P[i].text or "").strip().startswith("Tech:"):
            ix["tech"][pending] = i; pending = None
    # the wildcard project = whichever title paragraph carries the hyperlinked prefix
    ix["lk"] = None
    end = ix.get("oss", len(P))
    for i in range(ix["projects"] + 1, end):
        if WILDCARD and WILDCARD in (P[i].text or ""):
            ix["lk"] = i; break
    return ix

def apply_cv(doc, cv):
    P = doc.paragraphs
    ix = _locate(P)
    # tagline: FIXED in the master, never per application (see CLAUDE.md §4).
    # A spec that tries to set one is a bug from the old per-JD logic - fail loudly.
    if "tagline" in cv:
        raise RuntimeError("cv_tailor: cv['tagline'] is no longer tailored per application. "
                           "The title under the name is fixed in the master - drop the key.")
    # profile: the PROFIL section was removed in the 2026-09 AI-first restructure.
    # The one-line summary under the name is the only summary and is FIXED in the master.
    if "profile" in cv:
        raise RuntimeError("cv_tailor: cv['profile'] is gone - the masters no longer have a "
                           "PROFIL section. The header line is the only summary; drop the key.")
    # skills rows: run0 label untouched; run1 bold JD-lead; run2 normal rest.
    # cv["skills"] = {"<label>": [bold_lead, normal_rest]} reaches ANY row by its label;
    # prog_*/backend_* stay supported for the two rows every JD touches.
    def _row(idx, bold_lead, normal_rest):
        runs = P[idx].runs
        if len(runs) >= 3:
            runs[1].text = bold_lead
            runs[2].text = normal_rest
            _blank_extra(P[idx], 3)
        else:
            # 1p master: label run + ONE plain content run - keywords land unbolded
            runs[1].text = bold_lead + normal_rest
            _blank_extra(P[idx], 2)
    for label, (b, n) in cv.get("skills", {}).items():
        i = ix["skill_rows"].get(label.strip().lower())
        if i is None:
            raise RuntimeError(f"cv_tailor: no skills row '{label}' - "
                               f"master has {sorted(ix['skill_rows'])}")
        _row(i, b, n)
    if "prog_bold" in cv:
        _row(ix["prog"], cv["prog_bold"], cv["prog_normal"])
    if "backend_bold" in cv:
        _row(ix["backend"], cv["backend_bold"], cv["backend_normal"])
    # Tech: lines - reorder per JD (JD's main language first, irrelevant languages dropped).
    # Only the configured reorderable entries move; the rest stay as the master records them.
    for key, line in cv.get("tech", {}).items():
        k = key.strip().lower()
        if k not in REORDERABLE:
            raise RuntimeError(f"cv_tailor: tech['{key}'] not allowed - only "
                               f"{list(REORDERABLE)} may be reordered per JD")
        i = ix["tech"].get(k)
        if i is None:
            raise RuntimeError(f"cv_tailor: no Tech: line found for {k}")
        P[i].runs[1].text = line; _blank_extra(P[i], 2)
    # Wildcard project: set ONLY the trailing run (the hyperlink inner text is preserved).
    # Optional: a JD may drop it from PROJECTS entirely (spec without lk_* keys).
    if "lk_suffix" in cv:
        suf = cv["lk_suffix"]
        assert suf.startswith(" "), "lk_suffix must start with ' - '"
        lk = ix["lk"]
        if lk is None:
            raise RuntimeError(f"cv_tailor: wildcard project '{WILDCARD}' not among the "
                               "chosen projects - pass a spec without lk_* keys")
        P[lk].runs[0].text = suf; _blank_extra(P[lk], 1)
        # The block is title / bullets... / "Stack:". The bullet COUNT is not fixed - the
        # master shipped 3 bullets once and 2 today - so find the Stack line instead of
        # assuming an offset. Assuming 3 wrote lk_stack into the NEXT project's title and
        # silently corrupted the PROJEKTE section while still passing the page/link checks.
        stack = None
        for j in range(lk + 1, min(lk + 8, len(P))):
            if (P[j].text or "").strip().startswith(("Stack:", "Tech:")):
                stack = j; break
        if stack is None:
            raise RuntimeError("cv_tailor: wildcard 'Stack:' line not found after the title")
        slots = list(range(lk + 1, stack))
        texts = [cv[k] for k in ("lk_b1", "lk_b2", "lk_closing") if k in cv]
        if len(texts) > len(slots):
            raise RuntimeError(f"cv_tailor: {len(texts)} wildcard bullets given but the master "
                               f"has {len(slots)} bullet paragraph(s) - drop lk_closing")
        for idx, txt in zip(slots, texts):
            _set_labeled(P[idx], txt)
        P[stack].runs[1].text = cv["lk_stack"]; _blank_extra(P[stack], 2)
    # signature month (the 1p master has no signature line; sig_month is rejected there upstream)
    if "sig_month" in cv:
        name = SIGNATURE_PREFIX + cv["sig_month"]
        sg = ix.get("signature")
        if sg is None:
            raise RuntimeError("cv_tailor: signature line not found")
        P[sg].runs[0].text = name; _blank_extra(P[sg], 1)

def _locate_cl(P):
    """Body slots keyed off the salutation - the one line that always exists.

    Subject is found by its own text, NOT as salutation-1: the EN master carries a
    'tldr;' block between the two and would otherwise be overwritten.
    """
    sal = subj = None
    for i, para in enumerate(P):
        t = para.text.strip()
        if subj is None and t.startswith(("Bewerbung als", "Application for")):
            subj = i
        elif sal is None and t.startswith(("Sehr geehrte", "Dear")):
            sal = i; break
    if sal is None or subj is None:
        raise RuntimeError("cv_tailor: subject/salutation not found - CL master layout changed")
    ix = {"subject": subj, "salutation": sal, "opening": sal + 1,
          "record": sal + 2, "match": sal + 3, "close": sal + 4}
    if not P[ix["close"] + 1].text.strip().startswith(("Mit freundlichen", "Kind regards")):
        raise RuntimeError("cv_tailor: sign-off not where expected - CL master layout changed")
    for i in range(subj + 1, sal):                # EN only: 'tldr;' label + its paragraph
        if P[i].text.strip() == "tldr;":
            ix["tldr"] = i + 1
    return ix

def apply_cl(doc, cl):
    t = doc.tables[0]
    c00 = t.rows[0].cells[0].paragraphs[0]
    c00.runs[0].text = cl["company"]; _blank_extra(c00, 1)
    if "contact" in cl:
        _set_single(t.rows[0].cells[0].paragraphs[1], cl["contact"])
    c10 = t.rows[0].cells[1].paragraphs[0]
    c10.runs[0].text = OWNER["city"] + ", " + cl["date"]; _blank_extra(c10, 1)
    P = doc.paragraphs
    if "tagline" in cl:
        raise RuntimeError("cv_tailor: cl['tagline'] is no longer tailored per application. "
                           "The title under the name is fixed in the master - drop the key.")
    ix = _locate_cl(P)
    _set_single(P[ix["subject"]], cl["subject"])
    # Editorial caps, not page-fit caps: all three at their cap still render on one page with
    # room to spare. The letter is meant to be read in under a minute - see CLAUDE.md §4.
    for key, cap in (("opening", 320), ("match", 900), ("close", 220)):
        if _plain_len(cl[key]) > cap:
            raise RuntimeError(f"cv_tailor: cl['{key}'] is {_plain_len(cl[key])} chars, cap is {cap}. "
                               f"Cut a clause - do not raise the cap and do not shrink the font.")
    _set_any(P[ix["opening"]], cl["opening"])  # required - names the role, first line the reader sees
    _set_any(P[ix["match"]], cl["match"])      # required - per-JD, bold the skills the JD asks for
    _set_any(P[ix["close"]], cl["close"])      # required - what he wants + availability
    for key in ("salutation", "tldr", "record"):
        if key in cl and key in ix:            # ship fixed unless explicitly overridden
            _set_any(P[ix[key]], cl[key])

def localize(docs, region, lang):
    """Explain country-specific names for a reader abroad (spec["region"], e.g. "IN").

    The masters are written for German readers: local city names, university abbreviations,
    German grades and employer acronyms mean nothing to a recruiter abroad. The rewrite table lives in
    config/owner.json -> localize.<REGION>.<LANG>, so the masters stay untouched and every
    application to that region gets the same wording. A rule that matches nowhere is an
    error: it means the master changed and the table has to follow.
    """
    rules = OWNER.get("localize", {}).get(region, {}).get(lang)
    if not rules:
        raise RuntimeError(f"cv_tailor: no localize rules for region {region}/{lang} in config/owner.json")
    hits = [0] * len(rules)
    for doc in docs:
        for t in doc.element.body.iter(qn("w:t")):
            for k, r in enumerate(rules):
                if not t.text:
                    continue
                if r.get("exact"):
                    if t.text == r["find"]:
                        t.text = r["replace"]; hits[k] += 1
                elif r["find"] in t.text:
                    t.text = t.text.replace(r["find"], r["replace"]); hits[k] += 1
    missed = [r["find"] for r, h in zip(rules, hits) if not h]
    if missed:
        raise RuntimeError(f"cv_tailor: localize rules matched nothing (master changed?): {missed}")

# Deliverable filenames, per language. The recruiter sees these, so they are words, not slugs.
DOC_NAMES = {"DE": ("LEBENSLAUF", "ANSCHREIBEN"), "EN": ("CV", "COVER_LETTER")}

def out_names(ref, lang, ext="pdf"):
    cv_name, cl_name = DOC_NAMES[lang]
    return f"output/{ref}_{cv_name}.{ext}", f"output/{ref}_{cl_name}.{ext}"

def _compact_master(cvm):
    """Path of the one-page master next to the long one (DE `_1S`, EN `_1p`)."""
    if "Lebenslauf_" in cvm:
        return cvm.replace(".docx", "_1S.docx")
    return cvm.replace(".docx", "_1p.docx")

def tailor(spec):
    os.chdir(ROOT)
    ref, lang = spec["ref"], spec["lang"]
    cvm, clm = MASTERS[lang]
    # variant "1p": company/HR employers get the one-pager (CLAUDE.md §4);
    # academic employers stay on the default two-pager.
    if spec.get("variant") == "1p":
        cvm = _compact_master(cvm)
        cv = spec["cv"]
        bad = sorted(k for k in cv if k.startswith("lk_") or k == "sig_month")
        if bad:
            raise RuntimeError("cv_tailor: %s not supported on the 1p variant - the one-pager "
                               "has no wildcard-project block and no signature line." % ", ".join(bad))
    cv_out, cl_out = out_names(ref, lang, "docx")
    shutil.copy(cvm, cv_out); shutil.copy(clm, cl_out)
    cvd = Document(cv_out); apply_cv(cvd, spec["cv"])
    cld = Document(cl_out); apply_cl(cld, spec["cl"])
    if spec.get("region"):                     # applying abroad: explain the German specifics
        localize((cvd, cld), spec["region"], lang)
    cvd.save(cv_out); cld.save(cl_out)
    return cv_out, cl_out

if __name__ == "__main__":
    spec = json.load(open(sys.argv[1]))
    for s in (spec if isinstance(spec, list) else [spec]):
        cv, cl = tailor(s)
        print("tailored", s["ref"], "->", cv, cl)
