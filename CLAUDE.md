# Career-Ops — Personal Job Search Pipeline

A Claude Code / OpenCode pipeline that turns a job description (JD) into a tailored, ATS-safe CV + cover letter, a scored evaluation report, and a tracked application — end to end. This file is the operating manual the agent follows. Replace the placeholder details below with your own once you've set up `config/profile.yml` and your CV masters.

## Per-application pipeline (canonical)

When the user provides a JD URL, run this end-to-end:

> **NO-SKIP LAW (overrides everything below). NEVER skip a JD the user sends — no matter the fit.** Off-axis stack, seniority mismatch (junior/senior), wrong location, missing work-authorization, niche/legacy tech, special requirements, low score: **NONE of these are grounds to skip.** Every URL/JD the user provides — directly OR via `data/pipeline.md` / a batch file — gets a **full tailored application produced** (CV + cover letter PDFs + report + tracker row). Tailoring stays **honest** (specialist framing, lead with genuine transferable strengths, never fabricate skills the candidate lacks) — but the deliverable is **always** produced, and fit concerns go in the report's **Gaps** section, never into a skip decision. There are exactly **two** things that are not a "skip": **(a) a true `(company, role)` duplicate** → UPDATE / refresh the existing entry (re-tailor from current masters), never create a second row; **(b) a genuinely uncapturable page** (won't render after trying Playwright *and* WebFetch) → mark `- [!]` unresolvable and ask the user to paste the JD text. Nothing else.

1. **Verify the offer is live AND capture the JD verbatim.** Prefer Playwright (`browser_navigate` + `browser_snapshot`, plus `browser_evaluate('document.body.innerText')` for the full rendered text). **Do not summarize the captured text.** WebFetch is a fallback only in batch / headless mode — when using WebFetch, pass this exact prompt: `"Return the COMPLETE verbatim text of this page exactly as written, in the original language. Do NOT summarize, paraphrase, omit, or translate. Preserve all bullets, headers, section names, dates, contact info, and reference numbers."` Mark the report `**Verification:** unconfirmed (batch mode)` if WebFetch was used.
2. **Pre-flight dedup check — BEFORE touching the masters.**
   1. Extract `company` and `role` from the JD.
   2. Generate the ref code (step 4) and run `node lib/ref-code.mjs lookup <CODE>` — a hit in `data/ref-map.tsv` is an exact prior `(company, role, month)`.
   3. `grep -in "<normalized company>" data/applications.md` — scan for any row mentioning the company, then fuzzy-match the role (case-insensitive, ignore punctuation; treat "Senior Frontend Engineer" ≈ "Frontend Engineer, Senior"). Read each row carefully — role titles vary.
   4. If a hit lands in either source: it is a **true duplicate** → **refresh the existing entry** (re-tailor from current masters against the newest JD text, re-render, update the report + tracker row's notes/date **in place**). Never create a second row. **Only stop to ask first if the existing status is already `Applied` / `Responded` / `Interview` / `Offer`.** Otherwise refresh silently.
   5. For pipeline batches, dedup per URL. **Produce a full application for every URL** (NO-SKIP LAW). Only `- [~]` a true duplicate (→ refresh existing #NNN), only `- [!]` a genuinely uncapturable page.
3. **Pick a sequential report number** = max existing in `reports/` + 1, zero-padded to 3 digits.
4. **Generate a ref code:**
   ```
   node lib/ref-code.mjs generate "<company>" "<role>" --date=YYYY-MM-DD
   ```
   Returns a deterministic 4-char base36 code. Same company+role within a month → same code (idempotent). Appends the code to `data/ref-map.tsv`.
5. **Save the captured JD verbatim** to `jds/{NNN}-{company-slug}.md`. **Mandatory — must happen BEFORE tailoring.** Tailoring, interview prep, and debugging read from this file; the live URL often 404s after the deadline. File format:

   ```markdown
   # {Company} — {Role title}

   **URL:** <jd url>
   **Captured:** YYYY-MM-DD HH:MM (Playwright | WebFetch)
   **Ref:** {REF} · **Report:** reports/{NNN}-{slug}-YYYY-MM-DD.md
   **Language:** {EN|DE|FR|PT|…}

   ---

   ## Raw JD (verbatim, as captured)

   <full unedited text — every bullet, heading, line. Do not edit, summarize, translate, or reformat.>
   ```
   If only WebFetch was available and it summarized despite the verbatim prompt, save what came back and add `**Source quality:** WebFetch summary — not fully verbatim.`
6. **Pick the master language by JD language** — match the JD's language to the matching CV/cover-letter master. Never mix CV and cover letter languages.
7. **Copy masters to a scratch DOCX** (transient, deleted after PDF conversion):
   - `output/{REF}-cv.docx`     ← copy of `templates/cv/CV_EN.docx` or `templates/cv/Lebenslauf_DE.docx`
   - `output/{REF}-coverletter.docx` ← copy of `templates/cv/CoverLetter_EN.docx` or `templates/cv/Anschreiben_DE.docx`
8. **Tailor in place via `python-docx`** (set `run.text` to preserve fonts, colors, hyperlinks, photo, signature). Do NOT roundtrip through markdown — it destroys formatting. Read the JD from `jds/{NNN}-{slug}.md`, not the live URL.
9. **Convert to PDF, then delete the scratch DOCXs:**
   ```
   soffice --headless --convert-to pdf --outdir output output/{REF}-cv.docx output/{REF}-coverletter.docx
   rm output/{REF}-cv.docx output/{REF}-coverletter.docx
   ```
   The DOCX is a build artifact, not a deliverable. `output/` should only contain PDFs (plus `.gitkeep`).
10. **Write the report** to `reports/{NNN}-{company-slug}-{YYYY-MM-DD}.md` with a header carrying `**Ref:** {REF}`, `**Score:** X.X / 5`, `**URL:**`, `**JD:** jds/{NNN}-{slug}.md`, `**PDF:**`, `**Date:**`, `**Status:** Evaluated`, `**Verification:**`, then Blocks A–F per `modes/oferta.md` (role summary, JD-to-CV match, level/strategy, comp, customization plan, interview prep). The report's JD snapshot is a curated summary — the verbatim original lives in `jds/`.
11. **Write the TSV addition** to `batch/tracker-additions/{NNN}-{company-slug}.tsv` (single line, 9 tab-separated columns — see "TSV format").
12. **Backfill `data/ref-map.tsv`** with the `report_path` column.
13. **STOP for user review** before submitting anywhere. PDFs + report path are the deliverable. Form-filling happens only after explicit approval.
14. After the user confirms they've sent it: update the tracker row's status `Evaluated` → `Applied`.

**Score is data, not a gate.** Always run the full pipeline. A low score never means skip — produce the application and be honest about the gaps in the report.

---

## Tailoring rules

### CV (`{REF}-cv.docx`)
- **Specialist framing.** Tailor toward each JD's **primary axis** (e.g. Java *or* ML *or* full-stack — whatever the JD leads with) and present the candidate as a **specialist** in it, not a generalist. De-emphasize off-axis breadth but keep **one supporting thread** visible. **Honest selection, never fabrication:** specialize by selecting, reordering, and trimming *true* facts; never invent depth the candidate lacks. Narrow only as far as the JD is narrow.
- **Header tagline** (the short role line under the name). **NEVER copy the JD's job title verbatim.** Use a general role noun + the JD's primary axis in parentheses — e.g. JD "Senior ABAP Entwickler" → `Software Engineer (SAP & ABAP)`; JD "Machine Learning Engineer" → `Software Engineer (ML & Backend)`. Keep the general noun stable; swap only the parenthetical. Very short (≤ ~55 chars, one line). Match the master's language.
- **Profile summary** — a 1–2 sentence narrative: *what you are, what you do, what you want*. Lead with the JD's axis, let one clause carry the supporting thread, drop in 1–2 JD keywords + the company name and the JD's signature ask. **Do NOT put language levels in the profile** — languages live only in the LANGUAGES section, **one language per line** (ATS parsers misread a combined line). Keep the profile under a fixed character budget so the CV stays exactly 2 pages; re-render and confirm page count after editing.
- **Skills section — tailor per JD as a specialist.** Lead each row with the JD's **core stack**, cut languages/frameworks the JD doesn't ask for, and **move the JD-relevant skills to the FRONT of each row and bold ONLY those** (the rest stay normal weight, after them). Bold only genuine JD matches. Keep each row within the master's per-row character budget (never exceed it by more than ~10 chars — that guards against a wrap-line pushing to a 3rd page). Shrinking rows is encouraged; specialist > generalist.
- **Experience bullets — do not rewrite per app.** The masters ship grammatically complete, verb-led bullets (~0.75 of a line, one rendered line each), one achievement per bullet, real metric bolded where one exists. Same wording every job. Master-level bullet edits go through the builder, not python-docx surgery.
- **Projects** follow a uniform What-How-Result shape (2 WHR bullets + optional closing alignment bullet + Stack line). One project may be designated a **per-JD wildcard**: its bullets + Stack line are rewritten per JD to surface the JD's signature technologies, **built in the JD's required language/stack** (Java JD → framed as a Java build, etc.), same rendered length. Honest-fit only. **Never name the target employer inside a project block** — align to JD *keywords*, not the company.

### ASCII punctuation only — no AI tells (CV **and** cover letter)
Never use **em-dashes (—)**, **en-dashes in prose (–)**, the **Unicode minus (−)**, or **curly/smart quotes (“ ” „ ‘ ’)** in tailored content — they read as AI-generated. Use a plain hyphen `-` as a separator, a comma/colon to introduce a result, and straight ASCII quotes. **Allowed exceptions:** the middot `·` (design separator) and the en-dash in **date ranges only** (`Jun 2024 – Sep 2025`). After any content edit, scan the rendered PDF: `pdftotext output/{REF}-cv.pdf - | grep -nE "—|−|[“”„]"` must be silent.

### Cover letter (`{REF}-coverletter.docx`)
- **HARD LIMIT: 1 page total, signature included.** After `soffice` renders, verify page count; if it prints `2`, tighten prose (don't shrink margins/font).
- **The master is a fill-in-the-blank template** with placeholder markers for everything that varies per JD (recipient company, date, subject/role title, the hook, the company + product/mission + one specific reason in the close). **Every placeholder MUST be filled in** — leaving `[COMPANY]` etc. in the final PDF is a P0 bug. Rewrite the JD-requirement-mapping body paragraphs freshly per JD.
- **Bolding discipline.** Bold *only* the JD-keyword phrase before the colon in each requirement-mapping paragraph (the proof sentence after the colon stays normal). Build each such paragraph as two runs (bold keyword + normal proof). Don't bold whole paragraphs.
- **Post-render verification (mandatory).** `pdftotext -layout output/{REF}-coverletter.pdf -` must contain no `[PLACEHOLDER` leakage and no stale master content before you call it done.

### Multilingual parity
If you ship masters in more than one language, keep the same content in each language and **write each master in its own language** (a German master must not contain English prose sentences; translate them). Technical stack terms, product/company names, cert names, and degree names stay in their original language. A JD in language X is tailored from the language-X master, keeping its narrative in language X.

### Layout (ATS-safe)
Use a **single-column, table-free layout** (paragraph-level ATS parsers miss two-column content). No tables, no text boxes. Photo/signature as floating images (skipped by ATS parsers, so text flow is unaffected). Keep the CV to **exactly 2 well-filled pages** — the page-fit is the hard constraint; trim a bullet if it spills to a 3rd page. Re-render and confirm page count after any change.

---

## Data contract — what gets auto-updated vs. preserved

**User layer (NEVER auto-updated):** `templates/cv/*` (your DOCX masters + build assets), `config/profile.yml`, `modes/_profile.md`, `portals.yml`, `data/*`, `reports/*`, `output/*`, `interview-prep/*`.

**System layer (auto-updatable):** `modes/_shared.md` and other `modes/*.md`, `CLAUDE.md`, every `*.mjs` script, `dashboard/*`, `templates/*` except `templates/cv/`, batch scripts.

User-specific framing (archetypes, narrative, scoring weights, negotiation scripts, location policy, comp targets) goes in `modes/_profile.md` or `config/profile.yml`. **Never put user-specific content in `modes/_shared.md`.**

---

## File layout

| Path | Function |
|------|----------|
| `data/applications.md` | Application tracker |
| `data/ref-map.tsv` | Ref code ↔ company/role/report mapping (idempotent) |
| `data/pipeline.md` | Inbox of pending URLs (batch / scan flows) |
| `config/profile.yml` | Candidate profile (name, target roles, comp, location policy) |
| `config/application-answers.md` | Answer-sheet for application forms (Anrede, salary, start date, mobility, visa, GDPR defaults) |
| `modes/_profile.md` | User-specific archetypes, narrative, negotiation scripts |
| `templates/cv/CV_EN.docx` / `Lebenslauf_DE.docx` | CV masters (single-column ATS-safe) |
| `templates/cv/CoverLetter_EN.docx` / `Anschreiben_DE.docx` | Cover-letter masters |
| `jds/{NNN}-{slug}.md` | Per-application **verbatim** JD capture (source of truth) |
| `reports/{NNN}-{slug}-{date}.md` | Per-application evaluation report |
| `output/{REF}-cv.pdf` · `output/{REF}-coverletter.pdf` | Final deliverables (DOCX is scratch-only) |
| `lib/ref-code.mjs` | Ref-code generator/resolver |
| `lib/xing_scrape.py` | Local Playwright scraper for JS-rendered job boards (e.g. Xing) |

**Never hardcode CV metrics.** Read them from the DOCX masters via `python-docx` at evaluation time.

---

## Skill modes

| If the user… | Mode |
|---|---|
| Pastes JD or URL | Full pipeline above (auto-pipeline) |
| Asks to evaluate an offer | `oferta` |
| Compares multiple offers | `ofertas` |
| LinkedIn outreach | `contacto` |
| Company research | `deep` |
| Interview prep (with web research) | `interview-prep` |
| Story-based prep from a JD + tailored CV | `interview-stories` |
| Evaluate course / cert | `training` |
| Evaluate portfolio project idea | `project` |
| Application status overview | `tracker` |
| Live form fill | `apply` |
| Search portals | `scan` |
| Process pending URLs | `pipeline` |
| Batch process offers | `batch` |
| Rejection-pattern analysis | `patterns` |

---

## TSV format (tracker additions)

One line per evaluation in `batch/tracker-additions/{NNN}-{slug}.tsv`, 9 tab-separated columns. **Status comes BEFORE score** in the TSV; the merge step swaps to score-before-status when writing to `applications.md`.

```
{num}\t{YYYY-MM-DD}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{notes — include Ref {REF}}
```
`pdf_emoji` = `✅` (both PDFs exist) or `❌` (DOCX only).

## Canonical statuses (source: `templates/states.yml`)

`Evaluated` · `Applied` · `Responded` · `Interview` · `Offer` · `Rejected` · `Discarded` · `SKIP`

One of the eight values, case-insensitive. No bold, no dates, no extra text in the status field.

---

## Pipeline integrity

1. Tracker rows: append clean 9-column rows to `applications.md` (`# | Date | Company | Role | Score | Status | PDF | Report | Notes`, after the header separator) and verify.
2. Edit `applications.md` directly to **update** status/notes of existing rows.
3. NEVER create a duplicate row when `(company, role)` already exists — update/refresh the existing row.
4. Every report header must include `**Ref:**`, `**URL:**`, `**JD:**`, `**PDF:**` lines.
5. Every PDF must be ref-coded: `output/{REF}-cv.pdf` and `output/{REF}-coverletter.pdf`. `output/` holds PDFs only; scratch DOCXs are deleted immediately after conversion.
6. **Keep `data/pipeline.md` in sync after every batch/pipeline run.** Once a URL is resolved, rewrite it into a formatted entry and group under `DONE / SKIPPED / QUEUED / UNRESOLVABLE`:
   - Done → `- [x] #NNN | Company | Role | Score/5 | PDF ✅ | Ref XXXX`
   - Skipped → `- [~] Company | Role | reason` — ONLY for a true `(company, role)` duplicate (→ refresh existing #NNN). NEVER skip for fit/level/location/work-auth.
   - Unresolvable → `- [!] Company/slug | reason` (expired / renders-only-a-form / not indexed)
   - Queued → `- [ ] Company | Role | location | fit — pending`
7. Health checks: `npm run verify` (reports ↔ tracker ↔ URLs), `npm run normalize` (canonical statuses), `npm run dedup` (remove duplicate rows), `npm run liveness` (check saved JD URLs).

## Common npm commands

| Command | What it does |
|---|---|
| `npm run doctor` | Environment sanity check (node, playwright, soffice, required files) |
| `npm run verify` | Pipeline integrity check |
| `npm run normalize` | Normalize `applications.md` statuses |
| `npm run dedup` | Dedup tracker rows |
| `npm run liveness` | Re-check JD URLs |
| `node test-all.mjs` | Full test script |

---

## Tooling notes

- **`python-docx`** — use `run.text` substitution to preserve formatting; never roundtrip through markdown.
- **LibreOffice** (`soffice --headless --convert-to pdf`) for DOCX→PDF. **`pdftotext` / `pdfinfo`** (poppler) and **`pdfplumber`** for verification (page count, links, AI-tell scan).
- **Playwright** for offer verification (preferred over WebFetch), especially JS-rendered boards behind consent walls. For **Xing** job URLs, use the local scraper `python3 lib/xing_scrape.py "<url>"` — Xing is JS-rendered and often blocks WebFetch; the scraper dismisses the consent dialog and prints the employer + verbatim JD.
- Scripts in `.mjs` (ES modules); config in YAML; data in Markdown/TSV; generated output in `output/` (gitignored).
