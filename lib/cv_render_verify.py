#!/usr/bin/env python3
"""Render the tailored {REF} DOCX pair to PDF, delete scratch DOCX, verify.
Checks (per CLAUDE.md): CV = 2 pages / 21 unique links / 0 AI-tells / no duplicated project title ;
CL = 1 page / 0 AI-tells / no [PLACEHOLDER leak / no stale content / no verbless 'Sie <Noun>:' /
     no bolded skill the tailored CV does not carry (the letter is written FROM the CV).
Deliverables: output/{REF}_LEBENSLAUF|_CV .pdf and output/{REF}_ANSCHREIBEN|_COVER_LETTER .pdf
Usage: python3 lib/cv_render_verify.py REF [REF ...]   -> prints PASS/FAIL per ref."""

# Master invariant. Bumped 16 -> 19 when OPEN SOURCE + HACKATHONS were added
# (OPEN SOURCE + HACKATHONS), then 19 -> 20 when Pathfinding-Visualization got its own
# repo URL instead of reusing the portfolio link. Keep in sync with CLAUDE.md.
EXPECTED_LINKS = 21
EXPECTED_PAGES_1P, EXPECTED_LINKS_1P = 1, 17  # one-page variant (company/HR applications)
import os, re, sys, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import owner_config
os.chdir(owner_config.ROOT)
SOFFICE = owner_config.soffice()
TELLS = re.compile(r"[—−“”„]")  # em-dash, minus, curly quotes (en-dash allowed)
PLACEHOLDER = re.compile(r"\[(RECIPIENT|FIRMENNAME|STADT|DATE\]|DATUM|JOB ?TITLE|JOBTITEL|COMPANY NAME|WHAT YOU|PRODUKT|WAS SIE|DIE KERNAUFGABE|KERNAUFGABE|JD.?ABSATZ|JD PARAGRAPH|EINSTIEG|OPENING|SCHLUSS|CLOSING)", re.I)
# ASCII-transliterated umlauts. CLAUDE.md greps for these by hand; the battery never did,
# so a misspelled employer name shipped. Distinctive enough not to fire on English prose.
UMLAUT = re.compile(r"fuer|ueber|moecht|moeglich|Gespraech|verfuegbar|Loesung|gestuetzt|"
                    r"unterstuetzt|zuverlaessig|wuerde|waere|koenn|muess|duerf|taetig|"
                    r"persoenlich|natuerlich|fuenf|Gruesse|Grusse|Strasse|Massnahme|Groesse|"
                    r"hoeher|spaeter|naechst|erfuell|schliesslich|zunaechst|\bfur\b|\bLosung\b", re.I)
# The masters now ship complete prose instead of [PLACEHOLDER] brackets, so an untailored
# letter no longer trips PLACEHOLDER - catch the example company/date instead.
# German: "Sie" as the subject needs a verb. "Sie <Capitalised noun>" means the verb was dropped -
# five 2026-08-05 letters shipped that way and the battery had no way to see it.
NOVERB = re.compile(r"\bSie ([A-ZÄÖÜ][a-zäöüß]+)")
STALE = re.compile(r"Musterfirma|3\.\s*August\s*2026|3\s*August\s*2026|deutsche\s*b[oö]rse|19\.\s*April\s*2026|April\s*19,\s*2026|CTO[- ]Division|SDLC[- ]Plattform|SDLC platform", re.I)

def pages(pdf):
    return len(re.findall(rb"/Type\s*/Page[^s]", open(pdf, "rb").read()))

def links(pdf):
    import pdfplumber
    p = pdfplumber.open(pdf)
    return len({h["uri"] for pg in p.pages for h in pg.hyperlinks})

def text(pdf):
    return subprocess.run(["/opt/homebrew/bin/pdftotext", "-layout", pdf, "-"],
                          capture_output=True, text=True).stdout

def resolve(ref, ext):
    """Deliverables are named per language ({REF}_LEBENSLAUF / {REF}_CV ...) - find whichever exists."""
    import glob
    cv = [f for f in glob.glob(f"output/{ref}_*.{ext}")
          if f.endswith((f"_CV.{ext}", f"_LEBENSLAUF.{ext}"))]
    cl = [f for f in glob.glob(f"output/{ref}_*.{ext}")
          if f.endswith((f"_COVER_LETTER.{ext}", f"_ANSCHREIBEN.{ext}"))]
    return (cv[0] if cv else None), (cl[0] if cl else None)

# A skills row is "<Label>: items". Matched by shape, not by a label list: the old hardcoded
# list ("Programmierung:", "LLM-Stack:", ...) went stale when the masters renamed their rows,
# so no current row ever matched and a wrapped skills row still reported wraps=0.
SKILL_ROW = re.compile(r"^[A-ZÄÖÜ][\w /&.()+-]{1,32}: ")
SKILL_HEADINGS = ("SKILLS", "KENNTNISSE")

def wrapped_lines(pdf):
    """Count bullets and skills rows that spill onto a second line.

    Inside SKILLS/KENNTNISSE every line must be one "<Label>: ..." row - anything else is a
    row that wrapped. Elsewhere a bullet followed by a line that is not a new bullet, row,
    Tech:/Stack: line, heading or entry head is a wrapped bullet.
    """
    import pdfplumber
    n = 0
    in_skills = False
    for pg in pdfplumber.open(pdf).pages:
        lines = [l.strip() for l in (pg.extract_text() or "").split("\n")]
        for i, l in enumerate(lines):
            if not l:
                continue
            if l in SKILL_HEADINGS:
                in_skills = True; continue
            if in_skills:
                if SKILL_ROW.match(l):
                    continue
                if l.isupper():                  # next section heading ends the block
                    in_skills = False
                else:
                    n += 1; continue
            if not l.startswith("\u2022"):
                continue
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            if not nxt or nxt.startswith("\u2022") or SKILL_ROW.match(nxt) \
               or nxt.startswith(("Tech:", "Stack:")) or nxt.isupper() or "|" in nxt:
                continue
            if " - " in nxt or nxt.endswith(")") and "(" not in nxt:
                continue
            n += 1
    return n

def cl_unbacked(cl_pdf, cv_pdf):
    """Skill tokens bolded in the letter's BODY that the tailored CV does not carry.

    The letter is written FROM the finished CV (CLAUDE.md §4): whatever `match` bolds is a
    skill the JD named and the CV is supposed to prove. If the CV was tailored away from it -
    a JavaScript req whose CV surfaced two given stations, while the letter still bolds
    Python - the two documents disagree in front of the same recruiter.

    Header, subject band and signature are bold by design, so only words below the salutation
    count. German compounds are matched by component ("REST-Schnittstellen" is backed by
    "REST APIs" on the CV), because the letter writes prose and the CV writes labels.
    """
    import pdfplumber
    cvt = text(cv_pdf).lower()
    cvw = set(re.findall(r"[a-zA-Zäöüß0-9.+#]{2,}", cvt))
    out = []
    for pg in pdfplumber.open(cl_pdf).pages:
        ws = pg.extract_words(extra_attrs=["fontname"])
        sal = [w["top"] for w in ws if w["text"].strip(",") in ("Sehr", "Dear", "Guten", "Hallo")]
        body_top = min(sal) + 5 if sal else 240
        sig = [w["top"] for w in ws if w["text"] in ("Mit", "Kind")]
        body_bot = min(sig) if sig else 1e9
        for w in ws:
            if "bold" not in (w.get("fontname") or "").lower(): continue
            if not (body_top < w["top"] < body_bot): continue
            tok = w["text"].strip(" ,.;:()\u201e\u201c").lower()
            if len(tok) < 3: continue
            parts = [x for x in re.split(r"[-/]", tok) if len(x) >= 4] or [tok]
            backed = any(
                p in cvt or any(c.startswith(p[:5]) or p.startswith(c[:5]) for c in cvw if len(c) >= 5)
                for p in parts)
            if not backed:
                out.append(w["text"].strip(" ,.;:()"))
    return sorted(set(out))

def verify(ref):
    cvd, cld = resolve(ref, "docx")
    cvd = cvd or f"output/{ref}_CV.docx"
    cld = cld or f"output/{ref}_COVER_LETTER.docx"
    has_cl = os.path.exists(cld) or resolve(ref, "pdf")[1] is not None
    targets = [cvd] + ([cld] if os.path.exists(cld) else [])
    subprocess.run([SOFFICE, "--headless", f"-env:UserInstallation=file:///tmp/lo_{ref}",
                    "--convert-to", "pdf", "--outdir", "output"] + targets, capture_output=True)
    for f in (cvd, cld):
        if os.path.exists(f): os.remove(f)
    cv_r, cl_r = resolve(ref, "pdf")
    cv = cv_r or f"output/{ref}_CV.pdf"
    cl = cl_r or f"output/{ref}_COVER_LETTER.pdf"
    res = {"ref": ref}
    res["cv_pages"] = pages(cv); res["cv_links"] = links(cv)
    res["cv_tells"] = len(TELLS.findall(text(cv)))
    res["cv_umlaut"] = len(UMLAUT.findall(text(cv)))
    # A hyperlinked project title duplicates itself if the wrong run is edited.
    _wc = owner_config.load().get("cv", {}).get("wildcard_project", "")
    res["cv_lkdup"] = text(cv).count(_wc * 2) if _wc else 0
    # readability pass 2026-08: no bullet or skills row may wrap to a second line
    res["cv_wraps"] = wrapped_lines(cv)
    # Cover letter is optional: some applications are CV-only (e.g. the posting never
    # names the company, so a letter would ship with a [FIRMENNAME] placeholder).
    if has_cl and os.path.exists(cl):
        ct = text(cl)
        res["cl_pages"] = pages(cl); res["cl_tells"] = len(TELLS.findall(ct))
        res["cl_umlaut"] = len(UMLAUT.findall(ct))
        res["cl_placeholder"] = 1 if PLACEHOLDER.search(ct) else 0
        res["cl_stale"] = 1 if STALE.search(ct) else 0
        res["cl_noverb"] = len(NOVERB.findall(ct))
        res["cl_unbacked"] = cl_unbacked(cl, cv)
        cl_ok = (res["cl_pages"] == 1 and res["cl_tells"] == 0 and res["cl_umlaut"] == 0
                 and res["cl_placeholder"] == 0 and res["cl_stale"] == 0
                 and res["cl_noverb"] == 0 and not res["cl_unbacked"])
    else:
        res["cl"] = "skipped (CV-only)"
        cl_ok = True
    # a 1-page CV is the deliberate compact variant (company/HR applications) -
    # accept it with its own page/link expectations, everything else unchanged.
    cv_shape_ok = ((res["cv_pages"] == 2 and res["cv_links"] == EXPECTED_LINKS) or
                   (res["cv_pages"] == EXPECTED_PAGES_1P and res["cv_links"] == EXPECTED_LINKS_1P))
    ok = (cv_shape_ok
          and res["cv_tells"] == 0 and res["cv_umlaut"] == 0
          and res["cv_lkdup"] == 0 and res["cv_wraps"] == 0 and cl_ok)
    res["PASS"] = ok
    return res

if __name__ == "__main__":
    allok = True
    for ref in sys.argv[1:]:
        r = verify(ref)
        if not r["PASS"]: allok = False
        flag = "PASS" if r["PASS"] else "**FAIL**"
        cl_part = (f"cl[p={r['cl_pages']} tells={r['cl_tells']} umlaut={r['cl_umlaut']} "
                   f"ph={r['cl_placeholder']} stale={r['cl_stale']} noverb={r['cl_noverb']}"
                   + (f" UNBACKED={','.join(r['cl_unbacked'])}" if r["cl_unbacked"] else " unbacked=0") + "]"
                   if "cl_pages" in r else "cl[skipped - CV-only]")
        print(f"{flag} {ref}: cv[p={r['cv_pages']} links={r['cv_links']} "
              f"tells={r['cv_tells']} umlaut={r['cv_umlaut']} wraps={r['cv_wraps']} lkdup={r['cv_lkdup']}] " + cl_part)
    sys.exit(0 if allok else 1)
