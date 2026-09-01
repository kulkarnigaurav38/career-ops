# Mode: outreach — LinkedIn recruiter outreach (notes + InMail)

Generates the full message set for one `(recruiter, application)` pair, grounded in the
tailored CV and the verbatim JD that the application pipeline already produced.

**Distinct from `contacto` mode.** `contacto` is a one-shot LinkedIn power-move message for a
company you have researched. `outreach` is the systematic, tracked channel: it assumes an
existing application (`{REF}` + `jds/{NNN}-{slug}.md` + `reports/{NNN}-…`), produces the whole
sequence (note → post-acceptance message → follow-up), writes it to `outreach/`, and logs a row
in `data/outreach.md` so the cadence and the InMail credit ledger stay accurate.

---

## Hard constraints (the numbers this mode is built around)

| Limit | Value | Source of truth |
|---|---|---|
| Connection invites | **~100 / week, ~20 / day** — same for Free, Premium, Sales Navigator | LinkedIn dynamic cap |
| Connection note | **300 characters**, unlimited count on Premium | Premium removes the free tier's ~5-notes/month cap |
| InMail credits | **15 total** (see ledger in `data/outreach.md`) | Refunded if the recipient replies within 90 days |
| Follow-ups | **exactly one**, at day 5–7 after acceptance/send | then the thread goes `Dead` |

**Never automate the sending.** This mode produces text for the user to paste. Automated
messaging from the logged-in session violates LinkedIn's ToS and risks the account the whole
search runs on. Discovery and drafting are automated; the click is human.

---

## FRESH-ONLY LAW (eligibility gate — check before anything else)

**Outreach happens ONLY for applications sent today.** You apply to the newest LinkedIn
postings yourself, in the normal way; recruiter messages are the *follow-up step* to those same-day
applications, never a campaign over the backlog.

Before drafting anything, verify the application appears in `data/applied-log.tsv` with
`applied_date` = **today** (`node applied-log.mjs today`). If it does not:

| Situation | What to do |
|---|---|
| Applied today, in the log | Proceed. |
| Applied today, not yet logged | Log it first: `node applied-log.mjs add <REF>` (or `--company/--role` for one submitted straight on LinkedIn), then proceed. |
| Applied days/weeks/months ago | **Stop.** Do not draft, do not open a tab. Say it is out of scope and why. |
| Status `Rejected` / `Discarded` / `SKIP` | **Stop.** Never message a recruiter about a rejected application. |

This overrides any batch instruction. If asked for "outreach for everything in the pipeline",
produce it only for today's entries and state plainly that the rest were excluded by this rule —
an old backlog is largely rejected, so messaging it would burn both the invite quota
and your credibility. Do not offer a `--days 30` style override unless you ask for one.

## Inputs

1. `{REF}` or `{NNN}` of an existing application (required — outreach without an application to
   point at has nothing specific to say, and specificity is the entire mechanism).
2. Recruiter: name, exact title, company, profile URL. Either passed by the user or pulled from
   `data/recruiters.tsv` if present.
3. Read for grounding:
   - `jds/{NNN}-{slug}.md` — the verbatim JD (for the exact role title + reference number)
   - `reports/{NNN}-{slug}-{date}.md` — Block B (JD-to-CV match) for the strongest 2 hooks
   - `output/{REF}_LEBENSLAUF.pdf` — the tailored facts actually being claimed for this application
   - `CLAUDE.md` contact block for the sign-off

**Language follows the JD**, exactly like the CV/cover-letter pipeline: German JD → German
messages (`Sie`-form, proper umlauts — this is human message text, not the PDF, so the
ASCII-no-AI-tells rule does not apply here). English JD → English messages.

---

## Output: `outreach/{NNN}-{slug}-{person-slug}.md`

Five blocks, in send order. Every block is copy-paste-ready — no placeholders, no brackets,
and every one of them asks for the conversation.

### Voice — the same person who wrote the cover letter

Short sentences. First person. No stack lists, no adjectives about himself. **Every message says
plainly why he is writing: he applied, and he wants a conversation.** A recruiter should never have
to work out what is being asked of them.

- **One proof, in plain words.** "ein eigenes Produkt, das seit Monaten läuft" beats "RAG-Pipeline
  mit Llama 3 und pgvector". Save the stack for the interview; the recruiter is often not technical
  and the CV already carries it.
- **The ask is the point.** Ask for the conversation in every block, in one sentence, with a size
  ("15 Minuten", "a short call"). Never end on "ich freue mich auf Ihre Rückmeldung" alone.
- **One human touch, never two.** Same rule as the letter.
- **Banned:** "passionate", "leverage", "synergy", "I came across your profile", "I hope this
  message finds you well", "open to new opportunities", any sentence with three commas in it.

---

### Block 1 — Warm-up action (optional but doubles reply rate)
One concrete, specific action to take *before* inviting: which recent post of theirs to engage
with, or "view profile only" if they have no activity. If their profile shows no activity in 30
days, say so and flag the target as low-yield.

### Block 2 — Connection note (**≤ 300 characters, print the exact count**)
Four beats, in this order: **greeting → I applied, and to which req → one plain proof → the ask.**
Name the requisition; a note that could have been sent to anyone gets ignored. Sign with the full
name, never the phone number.

DE - fill the brackets, then count:

> Hallo Frau [Nachname], ich habe mich gestern auf Ihre Stelle als [Rolle] (Ref. [Nummer])
> beworben. Kurz: [X Jahre im Fach], [Abschluss], dazu [ein konkreter Beleg]. Ich würde mich
> sehr über ein Gespräch freuen.
> Viele Grüße, [Vorname Nachname]

EN - same shape:

> Hi [First name], I applied for your [role] (ref [number]) yesterday. Short version: [X years
> doing the work], [degree], and [one concrete piece of evidence]. I would like a shot at an
> interview. Best, [Full name]

The proof line is the only part that changes between people: one fact someone else can verify.
If it runs over 300, cut the proof, never the ask. Recount and print the number.

### Block 3 — Post-acceptance message (within 24h of acceptance, **≤ 90 words**)
Lands in their primary inbox, so this one closes. Thanks → the req again → two short lines of why
you → the timed ask. No stack dump; one link at most.

DE:

> Danke fürs Vernetzen! Ich habe mich auf die Stelle als [Rolle] (Ref. [Nummer]) beworben, meine
> Unterlagen liegen also schon bei Ihnen. Kurz, warum ich: [ein Projekt, das jemand anderes
> benutzt hat, mit dem Ergebnis], und [ein zweiter Beleg]. Was ich suche, ist [was Sie vom Team
> erwarten].
> Hätten Sie diese oder nächste Woche 15 Minuten für ein Gespräch? Ich bin [Verfügbarkeit].
> [Ihre Website]

### Block 4 — Day 5–7 follow-up (**≤ 45 words**)
One nudge that carries *new* information — something shipped, a second req at the same company —
then the same ask, smaller. Never "just bumping this", never guilt.

DE:

> Kurzes Update: mein Masterprojekt zu Guardrails für KI-Agenten ist seit letzter Woche öffentlich.
> Falls die Stelle noch offen ist, würde ich mich weiterhin sehr über ein kurzes Gespräch freuen.

### Block 5 — InMail variant (**only if the target qualifies**, ≤ 120 words)
Generate this block ONLY when the target passes the spend test below. Otherwise write
`InMail: not warranted — <reason>` and stop. Subject names the role and the reference number;
the body is Block 3 with one extra line saying he applied and has had no reply yet.

---

## InMail spend test — all four must be true

1. The person is **plausibly unreachable by invite** — Head of / VP / C-level, or an invite has
   already been pending **14+ days** unaccepted.
2. There is a **live application already submitted** for a req they own, so the InMail is a nudge
   with a reference number, not a cold introduction.
3. They are **not an agency recruiter** (agencies accept every invite — never spend a credit).
4. Credits remaining in the ledger > 2, **or** the user explicitly approves dipping into the last
   two.

Bonus signal: InMail to someone who viewed the profile or engaged with a post performs 2–3×
better. If the user reports a profile view from this person, that alone can substitute for
criterion 1.

Budget guidance: **≈2 per week**. 15 credits at that rate lasts ~8 weeks. State the remaining
count in the output every time.

---

## Tracker row

After writing the file, append a row to `data/outreach.md` (see that file's header for the
column contract) and update the InMail ledger if a credit was spent. Set `Next` to:

| Stage just set | Next action | Next date |
|---|---|---|
| `Identified` | send invite | today or next weekday |
| `Warmed` | send invite | today or next weekday |
| `Invited` | wait for acceptance | +14 days from the **Invited** date (then re-evaluate for InMail) |
| `Accepted` | send Block 3 | **+1 day — this one is urgent** |
| `Messaged` | send Block 4 | +6 days |
| `FollowedUp` | none | — (mark `Dead` if silent at +14) |
| `Replied` / `Call` | user-driven | — |

**The `Invited` column is load-bearing — fill it only when the send really happened.** A new row
is created with `Invited = -`, because drafting happens in a batch days before the sends. When
the user confirms the invite (or InMail) went out, set `Invited` to that day's date and advance
the stage. LinkedIn's daily/weekly cap guard and the 14-day stale-invite test both read this
column; keying them off the row-creation `Date` would red-alarm on drafting day and then wave the
user through on the day the invites actually go out — exactly backwards for an account-safety rail.

`npm run outreach:due` reads those dates and prints today's queue.

---

## Assisted-send workflow (Chrome) — Claude fills, the user clicks Send

Verified live on 2026-07-28. **Claude does every step except the final click.** Never click
**Send**, **Send without a note**, or an InMail send — see the CLAUDE.md tooling note.

### 0a. If the JD capture already recorded a contact, use it

`jds/{NNN}-{slug}.md` carries a `**Kontakt:**` line whenever one was found at capture time (named
Ansprechpartner, or LinkedIn's "People you can reach out to" person + alumni badge). Start there —
no second visit to a posting that may already be down.

### 0. FIRST: read the contact person out of the JD

German ads routinely name the Ansprechpartner. That person owns the req — they beat anything a
LinkedIn company search can guess, and they are usually the one who actually reads the application.

```
python3 lib/jd_contact.py --ref {REF}          # or: lib/jd_contact.py jds/{NNN}-{slug}.md
```
Prints name, Anrede (Frau/Herr), confidence 0-10, e-mail, phone, plus a ready LinkedIn people-search
URL for that exact person. Confidence >= 7 means an explicit Ansprechpartner cue; 3 means a bare
"Frau X" somewhere in the text — verify that one before using it.

- **Name found** -> search LinkedIn for THAT person by name (the printed URL). If the profile matches
  the company, that is the target: skip the company-wide harvest entirely.
- **Name + e-mail, no LinkedIn profile** -> a short, polite e-mail to that address is a better move
  than a connection request to a stranger. Use their name and the JD's reference number.
- **Nothing found** (agency ads, most Randstad/arbeitsagentur postings never name anyone) -> fall
  through to the company harvest below.

Reality check on the hit rate: of 199 saved JDs, 17 name a person. So this is the best option when
available and simply unavailable most of the time — do not force it.

### 1. Harvest recruiters (read-only browsing)
- **Do NOT guess the company People-tab slug.** `linkedin.com/company/trusteq/people/` resolved to
  an unrelated 2-person security firm in Veracruz, not TRUSTEQ GmbH München. Wrong-company data is
  worse than none.
- Use people search instead — one hop, no slug needed:
  `https://www.linkedin.com/search/results/people/?keywords=<COMPANY>%20recruiter`
  Swap `recruiter` for `Talent Acquisition` / `Personalreferent` / `HR` to widen.
- Extract with `lib/linkedin_people_harvest.js` via `javascript_tool` (LinkedIn's class names are
  obfuscated and rotate, so the script walks up from each `a[href*="/in/"]` to the smallest
  ancestor holding exactly that one profile link — it does not depend on any class name).
- **Qualify before spending an invite.** Open the profile and check the Experience entry and the
  Activity date. A "Talent Acquisition" hit can be a 3-month intern with no activity for 10 months
  (real example: TRUSTEQ). Prefer whoever owns the req; note the weak ones as secondary.

### 1b. Claude finds and opens. You connect and send.

**Scope of Claude's work: find the right person, open their profile, log them. Nothing else.**
Do NOT open the Connect dialog, do NOT type a note, do NOT click Send or Message. You do all
of that yourself, at your own pace.

For each application, per company:
1. Find the recruiter / Talent Acquisition / HR contact (step 0 first — the JD may name them).
2. Open that person's LinkedIn profile in its own tab and leave it open.
3. Add a block to **`outreach/recruiters.txt`** — one file, always the same file. **Prepend: the
   newest batch goes at the TOP**, so the current batch is what you see on opening the file.
   Never start a second file and never rewrite the existing rows.

Who counts as the right person, in order of preference:
  1. the Ansprechpartner named in the JD (best — they own the req)
  2. Talent Acquisition / Recruiter / Recruiting Manager / Personalreferent:in at that company
  3. HR Business Partner / People & Culture
  4. the hiring manager or team lead for that function, if no recruiter is findable
Skip: interns with no activity, people who merely list the company under "Past", agencies.

`outreach/recruiters.txt` format — one block per person, **newest batch at the top**:

```
#NNN | REF | Company | Role applied for
  Person   : Frau/Herr Name - exact LinkedIn headline
  Profile  : https://www.linkedin.com/in/...
  Degree   : 1st / 2nd / 3rd
  Source   : JD-Ansprechpartner | LinkedIn people search | job-page "People you can reach out to"
  Note     : <optional ready-to-paste 300-char note, you may ignore or rewrite it>
  Status   : found
```

The `Status` line is yours to update once you have sent something. Claude only ever writes `found`.

## Batch behaviour

When the user passes several recruiters at once, produce one file per pair and a single
consolidated **send list** at the end, ordered for a sitting: warm-ups first, then notes, then
due follow-ups. Respect the daily cap — if the batch exceeds **20 invites**, split it across
days and say which targets fall on which day rather than silently emitting 40.

---

## Rules

- **One person per company per week.** Messaging three recruiters at the same employer in the
  same week reads as spray and gets you flagged internally.
- **Never invent a shared connection, a mutual interest, or an event attendance.** Specificity
  must be real: the req number, the JD's own wording, a post they actually wrote.
- **Never claim a skill the tailored CV does not claim.** The messages and the PDF must be
  consistent — a recruiter reads both.
- Check `data/outreach.md` before drafting: if this person already has a row, do **not** create
  a second one; advance the existing row's stage instead.
- No phone number in any LinkedIn message. Email + portfolio only.
