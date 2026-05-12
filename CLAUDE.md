# Career-Ops -- AI Job Search Pipeline

## Origin

This system was built and used by [santifer](https://santifer.io) to evaluate 740+ job offers, generate 100+ tailored CVs, and land a Head of Applied AI role. The archetypes, scoring logic, negotiation scripts, and proof point structure all reflect his specific career search in AI/automation roles.

The portfolio that goes with this system is also open source: [cv-santiago](https://github.com/santifer/cv-santiago).

**It will work out of the box, but it's designed to be made yours.** If the archetypes don't match your career, the modes are in the wrong language, or the scoring doesn't fit your priorities -- just ask. You (AI Agent) can edit the user's files. The user says "change the archetypes to data engineering roles" and you do it. That's the whole point.

## Data Contract (CRITICAL)

There are two layers. Read `DATA_CONTRACT.md` for the full list.

**User Layer (NEVER auto-updated, personalization goes HERE):**
- `templates/cv/*.docx` (DOCX masters for CV + cover letter, DE + EN — canonical source: content, formatting, photo, and signature all live here)
- `config/profile.yml`, `modes/_profile.md`, `article-digest.md`, `portals.yml`
- `data/*`, `reports/*`, `output/*`, `interview-prep/*`

**System Layer (auto-updatable, DON'T put user data here):**
- `modes/_shared.md`, `modes/oferta.md`, all other modes
- `CLAUDE.md`, `*.mjs` scripts, `dashboard/*`, `templates/*` (except `templates/cv/` — that's user data), `batch/*`

**THE RULE: When the user asks to customize anything (archetypes, narrative, negotiation scripts, proof points, location policy, comp targets), ALWAYS write to `modes/_profile.md` or `config/profile.yml`. NEVER edit `modes/_shared.md` for user-specific content.** This ensures system updates don't overwrite their customizations.

## Update Check

On the first message of each session, run the update checker silently:

```bash
node update-system.mjs check
```

Parse the JSON output:
- `{"status": "update-available", "local": "1.0.0", "remote": "1.1.0", "changelog": "..."}` → tell the user:
  > "career-ops update available (v{local} → v{remote}). Your data (CV, profile, tracker, reports) will NOT be touched. Want me to update?"
  If yes → run `node update-system.mjs apply`. If no → run `node update-system.mjs dismiss`.
- `{"status": "up-to-date"}` → say nothing
- `{"status": "dismissed"}` → say nothing
- `{"status": "offline"}` → say nothing

The user can also say "check for updates" or "update career-ops" at any time to force a check.
To rollback: `node update-system.mjs rollback`

## What is career-ops

AI-powered job search automation built on Claude Code: pipeline tracking, offer evaluation, CV generation, portal scanning, batch processing.

### Architecture at a glance

Career-ops is a set of Node scripts + markdown modes that Claude reads as instructions. Two main data flows:

- **Offers:** `portals.yml` → scan → `data/pipeline.md` (URLs) → `oferta` mode → `reports/{NNN}-slug-date.md` + `batch/tracker-additions/*.tsv` → `merge-tracker.mjs` → `data/applications.md`.
- **CVs:** `templates/cv/{Lebenslauf_Gaurav_Kulkarni_DE,CV_Gaurav_Kulkarni_EN}.docx` → copy → tailor Profile/Summary + Skills + truthful keyword synonyms in existing bullets via `python-docx` → `soffice --headless --convert-to pdf` → `output/*.pdf`.
- **Cover Letters:** `templates/cv/{Anschreiben_Gaurav_Kulkarni_DeutscheBoerse_DE,CoverLetter_Gaurav_Kulkarni_DeutscheBoerse_EN}.docx` → copy → tailor recipient + body paragraphs per JD via `python-docx` → `soffice --headless --convert-to pdf` → `output/*.pdf`.

The `dashboard/` is a Go TUI (`main.go`) that reads `applications.md` for a live overview. Integrity scripts (`verify`, `normalize`, `dedup`) enforce invariants between reports and the tracker.

### Main Files

| File | Function |
|------|----------|
| `data/applications.md` | Application tracker |
| `data/pipeline.md` | Inbox of pending URLs |
| `data/scan-history.tsv` | Scanner dedup history |
| `portals.yml` | Query and company config |
| `templates/cv/Lebenslauf_Gaurav_Kulkarni_DE.docx` | German master CV (Word) |
| `templates/cv/CV_Gaurav_Kulkarni_EN.docx` | English master CV (Word) |
| `templates/cv/Anschreiben_Gaurav_Kulkarni_DeutscheBoerse_DE.docx` | German master cover letter (Word) |
| `templates/cv/CoverLetter_Gaurav_Kulkarni_DeutscheBoerse_EN.docx` | English master cover letter (Word) |
| `article-digest.md` | Compact proof points from portfolio (optional) |
| `interview-prep/story-bank.md` | Accumulated STAR+R stories across evaluations |
| `interview-prep/{company}-{role}.md` | Company-specific interview intel reports |
| `analyze-patterns.mjs` | Pattern analysis script (JSON output) |
| `reports/` | Evaluation reports (format: `{###}-{company-slug}-{YYYY-MM-DD}.md`) |

### OpenCode Commands

When using [OpenCode](https://opencode.ai), the following slash commands are available (defined in `.opencode/commands/`):

| Command | Claude Code Equivalent | Description |
|---------|------------------------|-------------|
| `/career-ops` | `/career-ops` | Show menu or evaluate JD with args |
| `/career-ops-pipeline` | `/career-ops pipeline` | Process pending URLs from inbox |
| `/career-ops-evaluate` | `/career-ops oferta` | Evaluate job offer (A-F scoring) |
| `/career-ops-compare` | `/career-ops ofertas` | Compare and rank multiple offers |
| `/career-ops-contact` | `/career-ops contacto` | LinkedIn outreach (find contacts + draft) |
| `/career-ops-deep` | `/career-ops deep` | Deep company research |
| `/career-ops-pdf` | `/career-ops pdf` | Generate CV or cover letter PDF from DOCX masters |
| `/career-ops-training` | `/career-ops training` | Evaluate course/cert against goals |
| `/career-ops-project` | `/career-ops project` | Evaluate portfolio project idea |
| `/career-ops-tracker` | `/career-ops tracker` | Application status overview |
| `/career-ops-apply` | `/career-ops apply` | Live application assistant |
| `/career-ops-scan` | `/career-ops scan` | Scan portals for new offers |
| `/career-ops-batch` | `/career-ops batch` | Batch processing with parallel workers |
| `/career-ops-patterns` | `/career-ops patterns` | Analyze rejection patterns and improve targeting |

**Note:** OpenCode commands invoke the same `.claude/skills/career-ops/SKILL.md` skill used by Claude Code. The `modes/*` files are shared between both platforms.

### First Run — Onboarding (IMPORTANT)

**Before doing ANYTHING else, check if the system is set up.** Run these checks silently every time a session starts:

1. Do the DOCX masters exist (`templates/cv/CV_Gaurav_Kulkarni_EN.docx` and `templates/cv/Lebenslauf_Gaurav_Kulkarni_DE.docx`)?
2. Does `config/profile.yml` exist (not just profile.example.yml)?
3. Does `modes/_profile.md` exist (not just _profile.template.md)?
4. Does `portals.yml` exist (not just templates/portals.example.yml)?

If `modes/_profile.md` is missing, copy from `modes/_profile.template.md` silently. This is the user's customization file — it will never be overwritten by updates.

**If ANY of these is missing, enter onboarding mode.** Do NOT proceed with evaluations, scans, or any other mode until the basics are in place. Guide the user step by step:

#### Step 1: CV (required)
If the DOCX masters are missing, ask the user to drop their CV (as a `.docx` they're happy with) into `templates/cv/` as both `CV_Gaurav_Kulkarni_EN.docx` (English) and `Lebenslauf_Gaurav_Kulkarni_DE.docx` (German). The DOCX is the canonical source — formatting, photo, signature, and all content live there. Per-job edits are made in-place via `python-docx` and converted to PDF via LibreOffice headless. **There is no markdown CV layer.**

If they don't yet have a Word CV, suggest they start from a clean Word template (or copy an existing CV), paste in their content, embed their headshot + signature, and save to the paths above.

#### Step 2: Profile (required)
If `config/profile.yml` is missing, copy from `config/profile.example.yml` and then ask:
> "I need a few details to personalize the system:
> - Your full name and email
> - Your location and timezone
> - What roles are you targeting? (e.g., 'Senior Backend Engineer', 'AI Product Manager')
> - Your salary target range
>
> I'll set everything up for you."

Fill in `config/profile.yml` with their answers. For archetypes and targeting narrative, store the user-specific mapping in `modes/_profile.md` or `config/profile.yml` rather than editing `modes/_shared.md`.

#### Step 3: Portals (recommended)
If `portals.yml` is missing:
> "I'll set up the job scanner with 45+ pre-configured companies. Want me to customize the search keywords for your target roles?"

Copy `templates/portals.example.yml` → `portals.yml`. If they gave target roles in Step 2, update `title_filter.positive` to match.

#### Step 4: Tracker
If `data/applications.md` doesn't exist, create it:
```markdown
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
```

#### Step 5: Get to know the user (important for quality)

After the basics are set up, proactively ask for more context. The more you know, the better your evaluations will be:

> "The basics are ready. But the system works much better when it knows you well. Can you tell me more about:
> - What makes you unique? What's your 'superpower' that other candidates don't have?
> - What kind of work excites you? What drains you?
> - Any deal-breakers? (e.g., no on-site, no startups under 20 people, no Java shops)
> - Your best professional achievement — the one you'd lead with in an interview
> - Any projects, articles, or case studies you've published?
>
> The more context you give me, the better I filter. Think of it as onboarding a recruiter — the first week I need to learn about you, then I become invaluable."

Store any insights the user shares in `config/profile.yml` (under narrative), `modes/_profile.md`, or in `article-digest.md` if they share proof points. Do not put user-specific archetypes or framing into `modes/_shared.md`.

**After every evaluation, learn.** If the user says "this score is too high, I wouldn't apply here" or "you missed that I have experience in X", update your understanding in `modes/_profile.md`, `config/profile.yml`, or `article-digest.md`. The system should get smarter with every interaction without putting personalization into system-layer files.

#### Step 6: Ready
Once all files exist, confirm:
> "You're all set! You can now:
> - Paste a job URL to evaluate it
> - Run `/career-ops scan` (or `/career-ops-scan` if using OpenCode) to search portals
> - Run `/career-ops` to see all commands
>
> Everything is customizable — just ask me to change anything.
>
> Tip: Having a personal portfolio dramatically improves your job search. If you don't have one yet, the author's portfolio is also open source: github.com/santifer/cv-santiago — feel free to fork it and make it yours."

Then suggest automation:
> "Want me to scan for new offers automatically? I can set up a recurring scan every few days so you don't miss anything. Just say 'scan every 3 days' and I'll configure it."

If the user accepts, use the `/loop` or `/schedule` skill (if available) to set up a recurring `/career-ops scan` (or `/career-ops-scan` if using OpenCode). If those aren't available, suggest adding a cron job or remind them to run `/career-ops scan` (or `/career-ops-scan` if using OpenCode) periodically.

### Personalization

This system is designed to be customized by YOU (AI Agent). When the user asks you to change archetypes, translate modes, adjust scoring, add companies, or modify negotiation scripts -- do it directly. You read the same files you use, so you know exactly what to edit.

**Common customization requests:**
- "Change the archetypes to [backend/frontend/data/devops] roles" → edit `modes/_profile.md` or `config/profile.yml`
- "Translate the modes to English" → edit all files in `modes/`
- "Add these companies to my portals" → edit `portals.yml`
- "Update my profile" → edit `config/profile.yml`
- "Change the CV template design" → edit the DOCX masters directly in Word: `templates/cv/Lebenslauf_Gaurav_Kulkarni_DE.docx` (DE) or `templates/cv/CV_Gaurav_Kulkarni_EN.docx` (EN)
- "Adjust the scoring weights" → edit `modes/_profile.md` for user-specific weighting, or edit `modes/_shared.md` and `batch/batch-prompt.md` only when changing the shared system defaults for everyone

### Language Modes

Default modes are in `modes/` (English). Additional language-specific modes are available:

- **German (DACH market):** `modes/de/` — native German translations with DACH-specific vocabulary (13. Monatsgehalt, Probezeit, Kündigungsfrist, AGG, Tarifvertrag, etc.). Includes `_shared.md`, `angebot.md` (evaluation), `bewerben.md` (apply), `pipeline.md`.
- **French (Francophone market):** `modes/fr/` — native French translations with France/Belgium/Switzerland/Luxembourg-specific vocabulary (CDI/CDD, convention collective SYNTEC, RTT, mutuelle, prévoyance, 13e mois, intéressement/participation, titres-restaurant, CSE, portage salarial, etc.). Includes `_shared.md`, `offre.md` (evaluation), `postuler.md` (apply), `pipeline.md`.
- **Portuguese (Lusophone market):** `modes/pt/` — native Portuguese translations for Portugal/Brazil job markets. Use when targeting Portuguese-language postings or when the user sets `language.modes_dir: modes/pt` in `config/profile.yml`.

**When to use German modes:** If the user is targeting German-language job postings, lives in DACH, or asks for German output. Either:
1. User says "use German modes" → read from `modes/de/` instead of `modes/`
2. User sets `language.modes_dir: modes/de` in `config/profile.yml` → always use German modes
3. You detect a German JD → suggest switching to German modes

**When to use French modes:** If the user is targeting French-language job postings, lives in France/Belgium/Switzerland/Luxembourg/Quebec, or asks for French output. Either:
1. User says "use French modes" → read from `modes/fr/` instead of `modes/`
2. User sets `language.modes_dir: modes/fr` in `config/profile.yml` → always use French modes
3. You detect a French JD → suggest switching to French modes

**When NOT to:** If the user applies to English-language roles, even at French or German companies, use the default English modes.

### Skill Modes

| If the user... | Mode |
|----------------|------|
| Pastes JD or URL | auto-pipeline (evaluate + report + PDF + tracker) |
| Asks to evaluate offer | `oferta` |
| Asks to compare offers | `ofertas` |
| Wants LinkedIn outreach | `contacto` |
| Asks for company research | `deep` |
| Preps for interview at specific company | `interview-prep` |
| Wants to generate CV/PDF | DOCX pipeline (see CV Generation section) |
| Wants to generate cover letter / Anschreiben | `anschreiben` |
| Evaluates a course/cert | `training` |
| Evaluates portfolio project | `project` |
| Asks about application status | `tracker` |
| Fills out application form | `apply` |
| Searches for new offers | `scan` |
| Processes pending URLs | `pipeline` |
| Batch processes offers | `batch` |
| Asks about rejection patterns or wants to improve targeting | `patterns` |

### CV Source of Truth

- `templates/cv/CV_Gaurav_Kulkarni_EN.docx` (EN) and `templates/cv/Lebenslauf_Gaurav_Kulkarni_DE.docx` (DE) are the canonical CV — content, formatting, photo, and signature all live in the DOCX. **There is no markdown CV.**
- `article-digest.md` has detailed proof points (optional)
- **NEVER hardcode metrics** — read them from the DOCX masters (via `python-docx`) or `article-digest.md` at evaluation time

### CV + Cover Letter Generation -- DOCX Pipeline

CV and cover letter masters are Word documents in `templates/cv/`. Per job: copy master → tailor content only (no formatting changes) → convert to PDF via LibreOffice headless. The user's headshot and signature are embedded in the DOCX masters — do NOT touch image placement, sizing, or anchors.

**Master files:**
- `templates/cv/Lebenslauf_Gaurav_Kulkarni_DE.docx` -- German master CV
- `templates/cv/CV_Gaurav_Kulkarni_EN.docx` -- English master CV
- `templates/cv/Anschreiben_Gaurav_Kulkarni_DeutscheBoerse_DE.docx` -- German master cover letter
- `templates/cv/CoverLetter_Gaurav_Kulkarni_DeutscheBoerse_EN.docx` -- English master cover letter

**Language rule (CRITICAL):**
- German JD → use the DE master (CV + cover letter)
- English JD → use the EN master (CV + cover letter)
- NEVER mix languages. The CV and cover letter language MUST match the JD language.

**DE/EN parity rule:** The DE and EN CV masters carry the same content in two languages. Whenever the user edits one master (adds/removes a section, changes a bullet, drops a tech keyword, renames an award, etc.), mirror the same change in the other master so the two stay structurally and semantically in sync. Headers translate (e.g. `SCHLÜSSELKOMPETENZEN` ↔ `CORE COMPETENCIES`, `SOZIALKOMPETENZEN` ↔ `INTERPERSONAL SKILLS`); bullet content stays equivalent. After mirroring, re-read both masters with `python-docx` to confirm parity.

**Per-job workflow (CV):**
1. Copy the appropriate DE or EN master to `output/{ref}-cv.docx`
2. Tailor **only the content**, using `python-docx` or pandoc roundtrip. Formatting, photo, signature, bullet order, bolding, tables, and spacing stay frozen. Editable surfaces:
   - **Profile/Summary** paragraph — rewrite fully to mirror JD language and inject exact JD keywords
   - **Existing experience bullets** — synonym substitution inside the existing sentences only, to match JD vocabulary (e.g., "ML pipelines" → "MLOps pipelines"). Do NOT reorder, add, or remove bullets. Do NOT change dates, employers, or metrics.
   - **Projects section** — same rule as experience bullets: synonym substitution only, do NOT reorder, add, or remove projects. The **Nest Parking — Full-Stack Parking Reservation Platform** entry (current freelance project, 2026, Little Rock AR) MUST appear in every generated CV (DE and EN) — never delete it, never replace it with another project, and keep it as the first project so it stays the most prominent recent freelance work.
   - **Skills section** — add, remove, or replace skills / frameworks / programming languages / tools to match the JD. Light exaggeration is OK when the candidate's experience *kind of* matches (no need to be word-for-word). If the JD asks for something the candidate has never touched at all, skip it.
3. Convert to PDF: `soffice --headless --convert-to pdf --outdir output output/{ref}-cv.docx`
4. Output: `output/{ref}-cv.pdf`

**Per-job workflow (cover letter):**
1. Copy the appropriate DE or EN cover-letter master to `output/{ref}-coverletter.docx`
2. Tailor the content per JD (more latitude than CV, but structure/format stays identical):
   - Swap the recipient company + addressee
   - Rewrite the body paragraphs to be specific to this JD — what about this role, what proof points map to their ask, why this company
   - Keep the overall structure (greeting → hook paragraph → fit paragraph → close → sign-off), length, fonts, spacing, margins, and photo/signature placement unchanged
3. Convert to PDF: `soffice --headless --convert-to pdf --outdir output output/{ref}-coverletter.docx`
4. Output: `output/{ref}-coverletter.pdf`

**Tooling:**
- LibreOffice `soffice` on Windows: typically `C:/Program Files/LibreOffice/program/soffice.exe`. If not installed, prompt the user and fall back to delivering the `.docx`.
- DOCX editing: `python-docx` — set run text in place to preserve fonts, colors, hyperlinks, photo, and signature. Do not roundtrip via markdown — it destroys formatting.

---

## Pipeline Behavior -- CRITICAL

**When the user provides a URL, always run the full pipeline including application.** The user has already decided to apply — the score is informational, never a gate.

- **NEVER submit an application without the user reviewing it first.** Fill forms, draft answers, generate PDFs -- but always STOP before clicking Submit/Send/Apply. The user makes the final call.
- **ALWAYS stop after generating CV + Cover Letter PDFs** for the user to review. Only proceed to form-filling after explicit approval.
- **Score is data, not a decision.** Calculate and display it in reports/tracker for retrospective analysis, but never use it to recommend skipping an application.
- **Every application gets full effort.** Personalize every CV, cover letter, and form answer as if it's the top pick — because to the user, it is.

---

## Offer Verification -- MANDATORY

**NEVER trust WebSearch/WebFetch to verify if an offer is still active.** ALWAYS use Playwright:
1. `browser_navigate` to the URL
2. `browser_snapshot` to read content
3. Only footer/navbar without JD = closed. Title + description + Apply = active.

**Exception for batch workers (`claude -p`):** Playwright is not available in headless pipe mode. Use WebFetch as fallback and mark the report header with `**Verification:** unconfirmed (batch mode)`. The user can verify manually later.

---

## Common Commands

All defined in `package.json` — run with `npm run <name>` or `node <script>.mjs` directly.

| Command | What it does |
|---------|--------------|
| `npm run doctor` | Environment sanity check (node, playwright, required files) |
| `npm run verify` | Pipeline integrity check (reports ↔ tracker ↔ URLs) |
| `npm run normalize` | Rewrite `applications.md` statuses to canonical values |
| `npm run dedup` | Remove duplicate tracker entries |
| `npm run merge` | Merge `batch/tracker-additions/*.tsv` into `applications.md` |
| `npm run liveness` | Check if saved JD URLs are still active |
| `npm run update:check` / `npm run update` / `npm run rollback` | System updates |
| `node test-all.mjs` | Run the full test script |

## Stack and Conventions

- Node.js (mjs modules), Playwright (PDF + scraping), YAML (config), HTML/CSS (template), Markdown (data), Canva MCP (optional visual CV)
- Scripts in `.mjs`, configuration in YAML
- Output in `output/` (gitignored), Reports in `reports/`
- JDs in `jds/` (referenced as `local:jds/{file}` in pipeline.md)
- Batch in `batch/` (gitignored except scripts and prompt)
- Report numbering: sequential 3-digit zero-padded, max existing + 1
- **RULE: After each batch of evaluations, run `node merge-tracker.mjs`** to merge tracker additions and avoid duplications.
- **RULE: NEVER create new entries in applications.md if company+role already exists.** Update the existing entry.

### TSV Format for Tracker Additions

Write one TSV file per evaluation to `batch/tracker-additions/{num}-{company-slug}.tsv`. Single line, 9 tab-separated columns:

```
{num}\t{date}\t{company}\t{role}\t{status}\t{score}/5\t{pdf_emoji}\t[{num}](reports/{num}-{slug}-{date}.md)\t{note}
```

**Column order (IMPORTANT -- status BEFORE score):**
1. `num` -- sequential number (integer)
2. `date` -- YYYY-MM-DD
3. `company` -- short company name
4. `role` -- job title
5. `status` -- canonical status (e.g., `Evaluated`)
6. `score` -- format `X.X/5` (e.g., `4.2/5`)
7. `pdf` -- `✅` or `❌`
8. `report` -- markdown link `[num](reports/...)`
9. `notes` -- one-line summary

**Note:** In applications.md, score comes BEFORE status. The merge script handles this column swap automatically.

### Pipeline Integrity

1. **NEVER edit applications.md to ADD new entries** -- Write TSV in `batch/tracker-additions/` and `merge-tracker.mjs` handles the merge.
2. **YES you can edit applications.md to UPDATE status/notes of existing entries.**
3. All reports MUST include `**URL:**` in the header (between Score and PDF).
4. All statuses MUST be canonical (see `templates/states.yml`).
5. Health check: `node verify-pipeline.mjs`
6. Normalize statuses: `node normalize-statuses.mjs`
7. Dedup: `node dedup-tracker.mjs`

### Canonical States (applications.md)

**Source of truth:** `templates/states.yml`

| State | When to use |
|-------|-------------|
| `Evaluated` | Report completed, pending decision |
| `Applied` | Application sent |
| `Responded` | Company responded |
| `Interview` | In interview process |
| `Offer` | Offer received |
| `Rejected` | Rejected by company |
| `Discarded` | Discarded by candidate or offer closed |
| `SKIP` | Doesn't fit, don't apply |

**RULES:**
- No markdown bold (`**`) in status field
- No dates in status field (use the date column)
- No extra text (use the notes column)
