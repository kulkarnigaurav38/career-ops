# Mode: interview-stories — Requirement→Story Interview Prep (from JD + tailored CV)

When the user wants to prepare for an interview by turning a job's requirements into concrete, ready-to-tell stories from their own CV, run this mode. Unlike `interview-prep` (which researches the company's process via Glassdoor/Blind), this mode does **NO web research** — it is a deterministic synthesis from the JD + the already-tailored CV the pipeline produced for that job. The goal: walk into the interview able to prove "I already meet most/almost all requirements" and answer each question with a real, metric-backed example.

Trigger phrases: "interview stories for {company}", "prep stories", "/career-ops interview-stories {REF|company|url}", or the user pasting a JD and asking for story-based prep for a job already in the pipeline.

## Step 0 — Resolve the job and its tailored CV

Input is a **REF code**, a **company name** (optionally + role), or a **JD URL**.

1. **Resolve to a REF + report path** via `data/ref-map.tsv` (columns: `code · date · company · role · report_path`):
   - REF given → use the matching row directly.
   - Company/role given → grep `ref-map.tsv` (and `data/applications.md`) case-insensitively; fuzzy-match the role. If **multiple** candidates match, list them `(date, company, role, ref)` and **ask which one** — do not guess.
   - JD URL given → match against the `**URL:**` / `**Xing source:**` line in `jds/*.md`.
2. From `report_path` (e.g. `reports/093-jacob-elektronik-2026-06-04.md`) derive `{NNN}` and `{slug}`.
3. **Precondition — the tailored CV must exist.** Check `output/{REF}_LEBENSLAUF.pdf`. If it is missing, STOP and tell the user: "No tailored CV found for {REF}. Run the pipeline for this job first, then re-run interview-stories." (The DOCX is deleted post-conversion; the PDF is the source of truth.)

## Step 1 — Read the sources (deterministic, no web)

Read all of these before writing anything:

| Source | What to extract |
|--------|-----------------|
| `jds/{NNN}-{slug}.md` | The **verbatim JD**. Read the header `**Language:**` → this sets the OUTPUT language (DE or EN). Decompose the JD body into a discrete list of **requirements** (each "must/should/nice-to-have" bullet, each named tech, each soft-skill ask). |
| `reports/{NNN}-{slug}-{date}.md` | **Block B (JD-to-CV match table)** = a ready-made skeleton of requirement→evidence→fit. **Block C** (level/gaps/strategy) and **Block F** (interview tips) for honest gap framing. |
| `output/{REF}_LEBENSLAUF.pdf` | The **actual tailored CV** content — `pdftotext -layout output/{REF}_LEBENSLAUF.pdf -`. This is the authoritative list of what the CV claims for THIS job (profile, skills rows, projects incl. the per-JD wildcard-project rewrite, experience bullets + metrics). |
| `tailoring/tailor_{REF}.py` | The cover-letter paragraphs **P9–P11** (`set_two_runs(...)`) are already **requirement→proof mappings** — use them as seed stories. Also the tailored profile + wildcard-project framing. |
| `modes/_profile.md` | The candidate **archetype** for this role → sets which dimension each story should emphasize (LLMOps → metrics/evals/prod hardening; Agentic → orchestration/HITL/error handling; FDE → speed/client-facing; SA → architecture decisions; etc.). |
| `interview-prep/story-bank.md` | Existing STAR+R stories — **reuse** them where they fit instead of re-deriving; append genuinely new ones at the end. |
| `interview-prep/germany-swe-core-topics.md` | The **always-asked DE SWE fundamentals** (field-confirmed across 6 interviews): HashMap internals/collisions, Spring `@RestController` vs `@Controller` + annotations, Collections (incl. linked vs doubly-linked list), microservice comms + Kafka. For any **Java/Spring/backend** role, link these into the output (see below). |

The real CV proof points (with metrics) you draw stories from — verify each against the `pdftotext` output before using it, never hardcode them from memory.

Build this inventory once from the user's own material (`config/portfolio.md` and the masters): for each station and project, one line carrying the system built, the technology, and the measured result. Every story in this mode must come from that inventory - never from the JD.

## Step 2 — Build the Requirement→Story matrix

For **every** requirement extracted from the JD, assign:
- **Fit:** `Strong` (CV directly proves it) / `Partial` (adjacent, needs reframing) / `Gap` (not in the CV).
- **Story:** the single best CV story that answers it (one-liner here; full STAR+R in Step 3). A `Gap` row has no story — say so honestly.
- **Proof / metric:** the concrete number or artifact that backs it.

Lead with the JD's signature/hard requirements. The fit summary line counts how many are Strong vs Partial vs Gap.

## Step 3 — Write the STAR+R stories (6–10, memorize-ready)

Each story, in the **application's language**:
- **Title**
- **S (Situation)** — real context from the CV.
- **T (Task)** — **phrase this in the JD's own vocabulary** so the story directly answers the requirement (JD asks "good Kubernetes experience" → T = "ensure a scalable, reproducible deployment", anchored on whichever station in the inventory actually did that work).
- **A (Action)** — what the user actually did (specific tech, decisions).
- **R (Result)** — the metric/outcome.
- **Reflection** — what they learned / would do differently (this signals seniority — keep it).
- **Covers requirements:** the JD requirement(s) this story answers.

Stories must be built **only from real CV facts.** Never invent experience to cover a requirement. If a hard requirement has no honest story, it belongs in Step 4, not here.

## Step 4 — Gaps & honest bridges

For every `Partial`/`Gap` requirement: the **honest framing** to use in the room — drawn from report Block B/C and the tailoring script's polyglot/ramp language. Pattern: name the gap plainly → adjacent transferable evidence → concrete ramp plan. Never fabricate, never get defensive. (E.g. C#/Go/PHP gap → "core is Python/Java/TS; I'm polyglot and AI-native, so ramp is fast — here's a Go snippet I'd write.")

## Step 5 — Short self-introduction (elevator pitch)

A 60–90-second "tell me about yourself" woven from the top 3 stories + the candidate narrative/exit story (`config/profile.yml`, `modes/_profile.md`), in the application's language. Structure: who you are → recent proof → why this role/company.

## Output

Save to **`interview-prep/{company-slug}-{role-slug}-stories.md`** (the `-stories` suffix keeps it separate from the research-based `interview-prep/{company}-{role}.md`). Header:

```markdown
# Interview-Stories: {Company} — {Role}

**Ref:** {REF} · **Language:** {DE|EN} · **Created:** {YYYY-MM-DD}
**Sources:** `jds/{NNN}-{slug}.md` · `reports/{NNN}-{slug}-{date}.md` · `output/{REF}_LEBENSLAUF.pdf` · `tailoring/tailor_{REF}.py`
**Fit summary:** You meet {N}/{M} core requirements directly, {K} partially, {L} honest gaps (bridged below).
```

Then the sections:
1. **Requirement → Story matrix** — table: `JD requirement | Fit (Strong/Partial/Gap) | Your story (short) | Proof / metric`
2. **STAR+R stories** — the 6–10 full stories from Step 3
3. **Likely questions per requirement** — for each major requirement, the probable question (label inferred ones `[inferred from JD]`) → which story answers it (a Q→story map to rehearse)
4. **Gaps & honest bridges** — from Step 4
5. **Short self-introduction** — from Step 5
6. **Technical fundamentals (DE SWE)** — for any Java/Spring/backend role, add a short section pointing to `interview-prep/germany-swe-core-topics.md` and list which of those always-asked topics this role most likely probes (e.g. Spring annotations + microservice/Kafka comms for a backend role). Do not re-paste the whole sheet — reference it and flag the relevant ones.
7. **Linked files** — JD, report, CV/CL PDFs, tailoring script, story-bank, germany-swe-core-topics

## Post-action

1. **Append** any genuinely new STAR+R stories to `interview-prep/story-bank.md` in its existing template format (`### [Theme] Title`, S/T/A/R/Reflection, Source: Report #NNN, "Best for questions about:"). **Dedup** by title + source — do not re-append a story already there.
2. If the user wants the full company-process research (rounds, Glassdoor/Blind, what-to-ask-them), point them to `interview-prep` mode — this mode deliberately skips web research.

## Rules

- **No fabrication.** Every story maps to a real CV fact verifiable in `output/{REF}_LEBENSLAUF.pdf`. Gaps are stated honestly, never papered over as "Strong".
- **Output language = application language** (from the `jds/{NNN}` header). DE job → German document; EN job → English. Tech terms/product names stay in their original form.
- **Label inferred questions** `[inferred from JD]`. This mode does not claim sourced interview questions (that's `interview-prep`).
- Be direct and concrete — this is a working rehearsal sheet, not a pep talk.
