# Setup Guide

## Prerequisites

- [Claude Code](https://claude.ai/code) installed and configured
- Node.js 18+ (for PDF generation and utility scripts)
- (Optional) Go 1.21+ (for the dashboard TUI)

## Quick Start (5 steps)

### 1. Clone and install

```bash
git clone https://github.com/santifer/career-ops.git
cd career-ops
npm install
npx playwright install chromium   # Required for PDF generation
```

### 2. Configure your profile

```bash
cp config/profile.example.yml config/profile.yml
```

Edit `config/profile.yml` with your personal details: name, email, target roles, narrative, proof points.

### 3. Add your CV (DOCX masters)

Place your Word CV in `templates/cv/` as both:
- `CV_Gaurav_Kulkarni_EN.docx` — English master
- `Lebenslauf_Gaurav_Kulkarni_DE.docx` — German master

And your cover letter masters:
- `CoverLetter_Gaurav_Kulkarni_DeutscheBoerse_EN.docx`
- `Anschreiben_Gaurav_Kulkarni_DeutscheBoerse_DE.docx`

The DOCX is the canonical source for all evaluations and generated PDFs — content, formatting, photo, and signature all live there. Per-job edits are made in place via `python-docx` and converted to PDF via LibreOffice headless (`soffice`). There is no markdown CV layer.

(Optional) Create `article-digest.md` with proof points from your portfolio projects/articles.

### 4. Configure portals

```bash
cp templates/portals.example.yml portals.yml
```

Edit `portals.yml`:
- Update `title_filter.positive` with keywords matching your target roles
- Add companies you want to track in `tracked_companies`
- Customize `search_queries` for your preferred job boards

### 5. Start using

Open Claude Code in this directory:

```bash
claude
```

Then paste a job offer URL or description. Career-ops will automatically evaluate it, generate a report, create a tailored PDF, and track it.

## Available Commands

| Action | How |
|--------|-----|
| Evaluate an offer | Paste a URL or JD text |
| Search for offers | `/career-ops scan` |
| Process pending URLs | `/career-ops pipeline` |
| Generate a PDF | `/career-ops pdf` |
| Batch evaluate | `/career-ops batch` |
| Check tracker status | `/career-ops tracker` |
| Fill application form | `/career-ops apply` |

## Verify Setup

```bash
node doctor.mjs              # Environment + DOCX masters check
node verify-pipeline.mjs     # Pipeline integrity check
```

## Build Dashboard (Optional)

```bash
cd dashboard
go build -o career-dashboard .
./career-dashboard --path ..  # Opens TUI pipeline viewer
```
