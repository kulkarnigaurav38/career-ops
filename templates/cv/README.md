# CV & Cover-Letter Masters

Place your own Word (`.docx`) masters in this folder. For each application the pipeline **copies** these, tailors the copy in place via `python-docx`, and renders it to PDF — your originals are never modified.

Create the files for the languages you apply in:

| File | Purpose |
|------|---------|
| `CV_EN.docx` | English CV master |
| `Lebenslauf_DE.docx` | German CV master |
| `CoverLetter_EN.docx` | English cover-letter master |
| `Anschreiben_DE.docx` | German cover-letter master |

Design guidance (see the root `CLAUDE.md` for the full ruleset):

- **Single-column, table-free** layout — paragraph-level ATS parsers miss two-column CVs.
- Keep the **CV to exactly 2 pages**; the **cover letter to 1 page** (signature included).
- In the cover-letter master, use **placeholder markers** for everything that varies per JD (recipient company, date, subject/role, the opening hook, and the closing company + product + reason) — the agent fills these in.
- Photo / signature as **floating images** so they don't disturb text flow for ATS parsers.
- See `examples/cv-example.md` and `examples/dual-track-engineer-instructor/` for structure.

> **These `.docx` files are gitignored** (see the root `.gitignore`) so your personal CV never gets committed. This folder ships with only this README and a `.gitkeep`.
