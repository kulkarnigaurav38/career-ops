# career-ops

Turn a job posting into a tailored CV and cover letter PDF, one application at a time, without
inventing anything you have not done.

This is a personal fork of [career-ops-hq/career-ops](https://github.com/career-ops-hq/career-ops),
reduced to the document pipeline. The dashboard, batch runners and multi-language mode set from
upstream are not part of this fork.

The tools here are generic. **Everything that identifies a person - the CV masters, the profile,
the applications - stays on the machine that runs it and is gitignored.** See
[What never gets committed](#what-never-gets-committed).

---

## What it does

1. Capture a job ad verbatim into `jds/`, before any tailoring, because live URLs expire.
2. Generate a short reference code for the application.
3. Tailor your CV master to that one posting: headline, profile, skills rows, project selection.
4. Write the cover letter **from the tailored CV**, so the two never disagree about which
   experience matters.
5. Render both to PDF through LibreOffice and delete the scratch DOCX.
6. Run a verification battery: page count, hyperlink count, punctuation, spelling, and whether
   every skill emphasised in the letter is actually carried by that CV.
7. Write an evaluation report and append a row to the tracker.

Steps 3 and 4 are done by Claude Code reading your `CLAUDE.md`. Steps 5 and 6 are plain scripts
you can run yourself.

---

## Requirements

| Tool | Why |
|---|---|
| [Claude Code](https://claude.com/claude-code) | drives the tailoring |
| Python 3.10+ with `python-docx` | DOCX surgery and the verification battery |
| Node.js 18+ | reference codes, tracker checks |
| LibreOffice (`soffice`) | DOCX to PDF |

```bash
pip install python-docx
npm install
```

LibreOffice is found on `PATH`, or set `SOFFICE_BIN=/path/to/soffice`.

---

## Setup

### 1. Your DOCX masters

The pipeline edits a finished document; it does not build one from a template. Supply one CV and
one cover letter per language you apply in, as `.docx`, in `templates/cv/`. Anything renders, but
the verification battery assumes a CV that is exactly two pages and a letter that is exactly one.

### 2. `config/owner.json`

```bash
cp config/owner.example.json config/owner.json
```

```json
{
  "name": "Jane Doe",
  "city": "Berlin",
  "email_handle": "janedoe",
  "masters": {
    "EN": {
      "cv": "templates/cv/CV_EN.docx",
      "cover_letter": "templates/cv/CoverLetter_EN.docx"
    }
  }
}
```

`name` and `city` are what the tools write into the signature line and the letter's date field.
`email_handle` is the fragment of your own address, so your own email is never mistaken for the
employer's contact when a job ad is parsed.

### 3. `CLAUDE.md`

```bash
cp CLAUDE.example.md CLAUDE.md
```

This is the instruction file Claude Code reads. It is where you write down what you have actually
done, what you have not, and the rules your documents must follow. It is gitignored, because it is
a description of one person.

### 4. Your material

- `config/portfolio.md` - projects, public repositories, hackathons, chosen per posting
- `config/skills.md` - the pool of skills to select from, with a length budget per row

Both are gitignored. `config/profile.example.yml` shows the upstream profile format.

### 5. Job search (optional)

```bash
cp config/jobspy.example.json config/jobspy.json   # edit terms and locations
npm run scan:jobs
```

---

## Running one application

```bash
# 1. reference code
node lib/ref-code.mjs generate "Company" "Role - City - Posting number" --date=2026-01-31

# 2. tailor: Claude Code reads the captured JD and your masters, then calls lib/cv_tailor.py

# 3. render and verify — renders, converts, deletes scratch DOCX, prints PASS or FAIL
python3 lib/cv_render_verify.py REF

# 4. grounding: no claim in the tailored documents that the masters do not support
python3 lib/grounding_check.py REF
```

A `FAIL` is a defect, not a warning. The battery checks characters, not sense, so read the letter
once yourself before sending it.

### Other commands

| Command | What it does |
|---|---|
| `npm run verify` | tracker integrity |
| `npm run dedup` | duplicate applications |
| `npm run normalize` | normalise status values |
| `npm run applied` | applications logged as sent |
| `npm run outreach:due` | who is due a follow-up |
| `npm run scan:jobs` | run the search matrix |

---

## Capturing job ads

Several job boards do not survive a naive fetch: consent walls, JavaScript rendering, or a
listing page that names the wrong employer. `lib/` has small scrapers for the ones that need it:

| Script | Site |
|---|---|
| `lib/xing_scrape.py` | Xing |
| `lib/yourfirm_scrape.py` | yourfirm.de |
| `lib/randstad_scrape.py` | randstad.de |
| `lib/linkedin_jd_scrape.py` | LinkedIn (logged-out page) |
| `lib/jd_contact.py` | pulls the named contact person out of a captured ad |

Everything else: a browser, or a plain fetch as a fallback.

---

## Repository layout

| Path | What |
|---|---|
| `lib/` | scrapers, `cv_tailor.py`, `cv_render_verify.py`, `grounding_check.py`, `ref-code.mjs` |
| `modes/` | instruction files for applying, outreach and interview prep |
| `config/` | your profile material and the search matrix |
| `templates/cv/` | your DOCX masters (gitignored) |
| `jds/` | captured job ads (gitignored) |
| `reports/` | per-application evaluation (gitignored) |
| `output/` | finished PDFs (gitignored) |
| `data/` | tracker, reference map, applied log (gitignored) |

---

## What never gets committed

The `.gitignore` is the privacy contract of this fork. It excludes:

- `CLAUDE.md`, `config/owner.json`, `config/portfolio.md`, `config/skills.md`,
  `config/application-answers.md` - your background and your answers
- `templates/cv/` - your CV masters, including your photo and signature
- `jds/`, `reports/`, `output/`, `emails/` - the applications themselves
- `data/` - tracker, applied log, reference map
- `outreach/` - recruiter contacts, which are other people's personal data
- `interview-prep/` - notes about specific companies

If you fork this further, check `git status` before your first push. Everything above is the part
that should never leave your machine.

---

## Honesty

The point of the tailoring rules is selection, not invention: surface the experience a posting
actually asks for, and name the gaps plainly instead of papering over them. A document that claims
a technology you have not used costs you the interview the moment someone asks about it.

---

## License

See `LICENSE`. Upstream project: [career-ops-hq/career-ops](https://github.com/career-ops-hq/career-ops).
