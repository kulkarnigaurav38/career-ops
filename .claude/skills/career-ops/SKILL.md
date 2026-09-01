---
name: career-ops
description: Turn job links into tailored CV + cover letter PDFs; outreach and interview prep
user_invocable: true
args: mode
argument-hint: "[<job url(s)> | apply | outreach | interview-prep | interview-stories]"
---

# career-ops

## Routing

| Input | Do this |
|---|---|
| One or more job URLs, or pasted JD text | **Run the pipeline in `CLAUDE.md` §1.** This is the default and the main job. |
| `apply` | `modes/apply.md` — fill a live form, stop before submit |
| `outreach` | `modes/outreach.md` — recruiter messages for applications sent **today** only |
| `interview-prep` | `modes/interview-prep.md` — company research + process intel |
| `interview-stories` | `modes/interview-stories.md` — requirement→story prep from a JD + its CV |
| anything else | Treat as a JD if it looks like one; otherwise show this table |

## Pipeline in one line

capture JD verbatim → dedup → ref code → tailor CV + cover letter per JD → render PDFs →
verify (incl. `python3 lib/grounding_check.py {REF}`) → report + tracker row → **stop before submitting**.

**Several links → one subagent per application, in parallel**, then a separate audit agent over the
batch. Each agent gets only its own `{NNN}`, `{REF}` and JD path, and must not touch other
applications or the masters.

## Non-negotiables

- **Grounding law** (`CLAUDE.md` §2): nothing may appear that isn't in the DOCX masters. No
  invented duties, tools or metrics. Run `npm run grounding` before calling anything done.
- **NO-SKIP:** every link gets a full application; a bad fit gets an honest low score, not a skip.
- Never submit a form, never send an email, never click Send on LinkedIn.

Read `CLAUDE.md` first — it holds the full tailoring rules, verification battery and platform notes.
