# Mode: auto-pipeline — Minimal Pipeline (CV + Cover Letter + Tracker)

When the user pastes a JD (text or URL), run these steps in order. No evaluation, no scoring, no form-filling — just produce tailored artifacts and log the application.

## Step 1 — Extract the JD

If the input is a **URL** (not pasted JD text):

**Priority order:**
1. **Playwright (preferred):** Most job portals (Lever, Ashby, Greenhouse, Workday) are SPAs. Use `browser_navigate` + `browser_snapshot` to render and read the JD.
2. **WebFetch (fallback):** For static pages.
3. **WebSearch (last resort):** Search role title + company.

**If nothing works:** Ask the user to paste the JD manually or share a screenshot.

**If the input is JD text:** use it directly.

Save the JD text internally (it's needed in Step 4 for the archive report).

## Step 2 — Generate Reference Code

Run: `node lib/ref-code.mjs generate "{company}" "{role}" --date={YYYY-MM-DD}`
Store the returned code (e.g. `A7F2`). Used in every filename and the tracker's Notes column.

## Step 3 — Generate CV PDF

1. Pick the master based on JD language:
   - German JD → `templates/cv/Lebenslauf_Gaurav_Kulkarni_DE.docx`
   - English JD → `templates/cv/CV_Gaurav_Kulkarni_EN.docx`
2. Copy the master → `output/{REF}-cv.docx`
3. Edit the DOCX. Formatting, photo, signature, bullet order, bolding, tables, and spacing stay frozen. Content edits allowed in these places:
   - **Profile / Summary paragraph:** rewrite fully to mirror JD language and inject exact JD keywords.
   - **Existing experience bullets:** substitute synonyms inside the existing sentences to match JD vocabulary (e.g. "ML pipelines" → "MLOps pipelines"). Do not reorder or add/remove bullets. Do not change dates, employers, or metrics.
   - **Skills section:** add, remove, or replace skills / frameworks / programming languages / tools to match the JD. Light exaggeration is OK when the candidate's experience *kind of* matches — it does not need to be word-for-word. If the JD asks for something the candidate has never touched at all, still skip it.
4. Convert to PDF: `soffice --headless --convert-to pdf --outdir output output/{REF}-cv.docx`
   - Windows LibreOffice path: `C:/Program Files/LibreOffice/program/soffice.exe`
5. Rename to `{Candidate_Name}_Lebenslauf_{REF}.pdf` (DE) or `{Candidate_Name}_CV_{REF}.pdf` (EN).

## Step 4 — Generate Cover Letter PDF

1. Pick the master based on JD language:
   - German JD → `templates/cv/Anschreiben_Gaurav_Kulkarni_DeutscheBoerse_DE.docx`
   - English JD → `templates/cv/CoverLetter_Gaurav_Kulkarni_DeutscheBoerse_EN.docx`
2. Copy → `output/{REF}-coverletter.docx`
3. Personalize the content for this JD (more latitude than the CV, but structure/format stay identical):
   - Swap company + addressee
   - Rewrite the body paragraphs specifically for this role/company (hook → fit → close)
   - Keep greeting, sign-off, layout, fonts, margins, photo, and signature in their original positions
4. Convert to PDF: `soffice --headless --convert-to pdf --outdir output output/{REF}-coverletter.docx`
5. Rename to `{Candidate_Name}_Anschreiben_{REF}.pdf` (DE) or `{Candidate_Name}_CoverLetter_{REF}.pdf` (EN).

## Step 5 — Checkpoint: User Reviews

Show the user:
- Paths of both PDFs
- The ref code

**STOP.** Wait for the user to approve or request changes. Do not advance to Step 6 without explicit approval. On edit requests, update the DOCX → re-convert → re-show.

## Step 6 — Archive JD + Update Tracker

1. Write a minimal archive file at `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`:
   ```markdown
   # {Company} — {Role}

   **Date:** {YYYY-MM-DD}
   **Ref:** {REF}
   **URL:** {JD URL or "pasted text"}
   **CV PDF:** output/{Candidate_Name}_Lebenslauf_{REF}.pdf
   **Cover Letter PDF:** output/{Candidate_Name}_Anschreiben_{REF}.pdf

   ## JD snapshot
   {full JD text}
   ```
   `{###}` is max existing report number + 1, zero-padded to 3 digits.

2. Write a TSV line to `batch/tracker-additions/{###}-{company-slug}.tsv` (9 tab-separated columns, no header):
   ```
   {###}\t{YYYY-MM-DD}\t{company}\t{role}\tApplied\tN/A\t✅\t[{###}](reports/{###}-{company-slug}-{YYYY-MM-DD}.md)\t{REF} — {one-line note}
   ```
   - Status is always `Applied` (CV + cover letter generated = applied, per the user's rule).
   - Score column is `N/A` (no evaluation in this pipeline).
   - PDF column is `✅` (both PDFs exist).

3. Run `node merge-tracker.mjs` to merge the TSV into `data/applications.md`.

**If any step fails**, continue with the next ones and mark the failed step in the tracker's Notes column.
