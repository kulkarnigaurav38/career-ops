# career-ops — instructions for Claude Code

Copy this to `CLAUDE.md` and rewrite it as a description of yourself. It is gitignored.
The more specific it is, the less the output reads like a template.

---

## 1. Pipeline — run this for every job link

1. **Capture the ad verbatim** into `jds/{NNN}-{slug}.md` *before* tailoring. Live URLs expire;
   the saved file is the source of truth. Never summarise it. Capture the named contact person in
   the same pass (`python3 lib/jd_contact.py jds/{NNN}-{slug}.md`).
2. **Reference code:** `node lib/ref-code.mjs generate "<company>" "<role> - <city> - <posting no>" --date=YYYY-MM-DD`.
   Include the city and posting number, or two ads with the same title collide.
3. **Tailor the CV** from the master matching the ad's language.
4. **Then write the cover letter from that tailored CV** - never in parallel, never from the
   master alone. The letter must name the same experience the CV put forward.
5. **Render:** `lib/cv_tailor.py` writes `output/{REF}_*.docx`, convert with LibreOffice, then
   delete the scratch DOCX. `output/` holds PDFs only.
6. **Verify:** `python3 lib/cv_render_verify.py {REF}` then `python3 lib/grounding_check.py {REF}`.
   A FAIL is a defect, not a warning.
7. **Report** into `reports/`, including a blunt list of gaps.
8. **Tracker row** appended to `data/applications.md`.

---

## 2. Sources of truth

Your background (the DOCX masters + `config/portfolio.md` + `config/skills.md`) **times** the ad
(`jds/{NNN}-{slug}.md`). Read both, then decide what to surface.

Write down here, explicitly:

- **What you have:** degree and where from, years of experience, languages and frameworks you can
  be questioned on, certifications, anything live in production, language levels.
- **What you do not have:** the things a recruiter might assume from your CV and be wrong about.
  This list is what stops a tailored document from overclaiming.
- **Fixed metrics:** any number that appears in your documents, written once, exactly as it should
  appear. Numbers that drift between versions are the fastest way to look careless.

---

## 3. Tailoring rules

**Language follows the ad.** German ad, German documents. Never mix.

**Specialist, not generalist.** Tailor to the ad's primary axis and present yourself as a
specialist in it, with one supporting thread visible. Narrow only as far as the ad is narrow.

### CV
- **Headline:** a role noun plus what the job is *for*. Never the employer's product, team or
  department name; never a technology. The test: would someone write this under their own name on
  a CV they sent anywhere?
- **Profile:** one or two sentences, within the master's exact length. Longer and the block gains
  a line and the page count breaks.
- **Skills:** pick rows and items per ad. Everything the ad names and you have goes to the front
  of its row. Add a few neighbours the ad did not ask for, so it does not read as reverse
  engineered from the posting.
- **Experience bullets:** achievement first, technique second. Keep every entry's bullets the same
  length; one employer whose bullets run longer looks padded.
- **Projects:** a fixed count, chosen per ad, leading with the closest match. Each subtitle says
  what the thing does, not what it is built with. Never claim something is live unless it is.

### Cover letter
Written *from* the finished CV, one page, readable in under a minute.

- **Opening:** the role and the company, then your experience and degree, then what you want out
  of the work.
- **The middle paragraph:** your career as one chronological story, carrying the ad's requirements
  inside it. Never announce the mapping. Every job needs a consequence, not just a metric. Vary
  sentence length.
- **Close:** what you want from a team, then availability. End forward. Concede that gaps may
  exist without listing them by name, and back it with a time you learned something on the job
  fast - with a real instance attached, never "I learn quickly" alone.
- Bold only the skill tokens the ad itself names.

### Punctuation
No em-dashes, en-dashes in prose, Unicode minus, or curly quotes. Straight quotes and plain
hyphens. This covers punctuation only - accented letters must always be proper Unicode.

---

## 4. Verification

`python3 lib/cv_render_verify.py {REF}` renders both documents, deletes the scratch DOCX and
prints PASS or FAIL. Record here what your masters guarantee: page counts, hyperlink count, and
any string that must never appear. Then read the letter back once yourself - the battery checks
characters, not grammar or sense.
