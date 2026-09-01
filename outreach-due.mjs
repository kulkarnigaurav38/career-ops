#!/usr/bin/env node
/**
 * outreach-due.mjs — Today's LinkedIn outreach queue
 *
 * Reads data/outreach.md, prints what is due today (and overdue), warns on the
 * rolling 7-day invite cap, and shows the InMail credit ledger.
 *
 * Run: node career-ops/outreach-due.mjs [--all] [--week]
 *   --all   also list rows that are waiting on the other side
 *   --week  show the next 7 days, not just today
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const FILE = join(CAREER_OPS, 'data/outreach.md');
const APPLIED_LOG = join(CAREER_OPS, 'data/applied-log.tsv');
const SHOW_ALL = process.argv.includes('--all');
const WEEK = process.argv.includes('--week');

// LinkedIn caps — same for Free, Premium and Sales Navigator
const WEEKLY_INVITE_CAP = 100;
const DAILY_INVITE_CAP = 20;
const WEEKLY_WARN_AT = 90;

// `invited` = the day the invite/InMail was ACTUALLY sent ('-' until then).
// Caps and the 14-day staleness test key off that, never off `date` (row creation):
// rows are created in a batch before anything is sent, so `date` would both
// false-alarm on drafting day and miss the day the invites really go out.
const COLS = ['num', 'date', 'person', 'title', 'company', 'ref', 'channel',
  'stage', 'invited', 'next', 'nextDate', 'profile', 'notes'];

const DEAD_STAGES = new Set(['dead', 'hired-elsewhere']);
// Stages where the ball is in our court even without a date
const ACTIONABLE_STAGES = new Set(['identified', 'warmed', 'accepted']);

const c = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

// Local calendar date — the tracker's dates are local ("today or next weekday"),
// and toISOString() would report yesterday for the first hours after midnight in CET.
const _now = new Date();
const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
// Both operands are ISO dates parsed as UTC midnight, so this stays DST-safe.
const daysBetween = (a, b) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function parseRows(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.slice(1, t.endsWith('|') ? -1 : undefined).split('|').map(s => s.trim());
    if (cells.length < COLS.length) continue;              // ledger/caps tables are narrower
    if (/^-+$/.test(cells[0]) || cells[0] === '#') continue; // separator / header
    const row = {};
    COLS.forEach((k, i) => { row[k] = cells[i] ?? ''; });
    rows.push(row);
  }
  return rows;
}

/**
 * Applications sent TODAY — the only ones eligible for recruiter outreach.
 * House rule: never message a recruiter about a months-old
 * application, and never about one already rejected. Fresh application or nothing.
 */
function appliedToday(existingRefs) {
  if (!existsSync(APPLIED_LOG)) return [];
  return readFileSync(APPLIED_LOG, 'utf8').split('\n').slice(1)
    .filter(l => l.trim())
    .map(l => {
      const [applied_date, ref, num, company, role, url] = l.split('\t');
      return { applied_date, ref: (ref || '').trim(), num, company, role, url };
    })
    .filter(r => r.applied_date === today)
    .filter(r => !(r.ref && r.ref !== '-' && existingRefs.has(r.ref.toUpperCase())));
}

function parseLedger(text) {
  // | 15 | 0 | 15 | 0 |  — the first 4-column numeric row under the ledger header
  const m = text.match(/\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/);
  if (!m) return null;
  return { total: +m[1], spent: +m[2], remaining: +m[3], refunded: +m[4] };
}

function fmt(r, tag) {
  const who = `${c.bold(r.person)} (${r.title}${r.company ? ' @ ' + r.company : ''})`;
  const ref = r.ref && r.ref !== '-' ? c.dim(` [${r.ref}]`) : '';
  return `  ${tag} ${who}${ref}\n      → ${r.next || r.stage}  ${c.dim(r.profile)}`;
}

function main() {
  if (!existsSync(FILE)) {
    console.error(`No tracker at ${FILE}. Run outreach mode first.`);
    process.exit(1);
  }
  const text = readFileSync(FILE, 'utf8');
  const allRows = parseRows(text);   // caps count dead contacts too — the invite was still spent
  const rows = allRows.filter(r => !DEAD_STAGES.has(r.stage.toLowerCase()));
  const ledger = parseLedger(text);

  const overdue = [], due = [], soon = [], waiting = [];

  for (const r of rows) {
    const stage = r.stage.toLowerCase();
    const d = isDate(r.nextDate) ? r.nextDate : null;

    if (d) {
      const delta = daysBetween(today, d);
      if (delta < 0) overdue.push({ r, delta });
      else if (delta === 0) due.push({ r, delta });
      else if (delta <= 7) soon.push({ r, delta });
      else waiting.push({ r, delta });
    } else if (ACTIONABLE_STAGES.has(stage)) {
      due.push({ r, delta: 0 });
    } else {
      waiting.push({ r, delta: null });
    }

    // Invite actually sent 14+ days ago and still not accepted → InMail candidate.
    // Keyed off `invited`, not `date`: a row drafted on day 0 and sent on day 10
    // must not qualify on day 14 (the spend test wants the INVITE pending 14 days).
    if (stage === 'invited' && isDate(r.invited) && daysBetween(r.invited, today) >= 14) {
      r._inmailCandidate = true;
    }
  }

  console.log(`\n${c.bold('Outreach queue')} ${c.dim(today)}`);

  // Fresh applications with no outreach row yet — the ONLY eligible starting point.
  const refsInTracker = new Set(allRows.map(r => (r.ref || '').toUpperCase()).filter(Boolean));
  const fresh = appliedToday(refsInTracker);
  if (fresh.length) {
    console.log(`\n${c.bold(`APPLIED TODAY — ready for outreach (${fresh.length})`)}`);
    fresh.forEach(r => console.log(
      `  ${c.green('★')} ${c.bold(r.company)} | ${r.role}` +
      (r.ref && r.ref !== '-' ? c.dim(`  [${r.ref}]`) : '')));
    console.log(c.dim('      → ask Claude: "outreach for these"'));
  }

  if (overdue.length) {
    console.log(`\n${c.red(`OVERDUE (${overdue.length})`)}`);
    overdue.sort((a, b) => a.delta - b.delta)
      .forEach(({ r, delta }) => console.log(fmt(r, c.red(`${-delta}d late`))));
  }

  console.log(`\n${c.bold(`DUE TODAY (${due.length})`)}`);
  if (!due.length) console.log(c.dim('  nothing due'));
  due.forEach(({ r }) => console.log(fmt(r, c.green('•'))));

  if (WEEK && soon.length) {
    console.log(`\n${c.bold(`NEXT 7 DAYS (${soon.length})`)}`);
    soon.sort((a, b) => a.delta - b.delta)
      .forEach(({ r, delta }) => console.log(fmt(r, c.dim(`+${delta}d`))));
  }

  const inmailCandidates = rows.filter(r => r._inmailCandidate);
  if (inmailCandidates.length) {
    console.log(`\n${c.yellow(`INVITE STALE 14d+ — InMail candidates (${inmailCandidates.length})`)}`);
    inmailCandidates.forEach(r => console.log(fmt(r, c.yellow('?'))));
  }

  // Already surfaced above as InMail candidates — don't list them twice
  const stillWaiting = waiting.filter(({ r }) => !r._inmailCandidate);
  if (SHOW_ALL && stillWaiting.length) {
    console.log(`\n${c.bold(`WAITING (${stillWaiting.length})`)}`);
    stillWaiting.forEach(({ r }) => console.log(fmt(r, c.dim('·'))));
  }

  // --- caps -----------------------------------------------------------------
  // Count invites that were REALLY sent (`invited` set), from every row including
  // dead ones — a contact who never replied still consumed a LinkedIn invite.
  const sentInvites = allRows.filter(r =>
    r.channel.toLowerCase() === 'note' && isDate(r.invited));
  const invitesThisWeek = sentInvites.filter(r => {
    const age = daysBetween(r.invited, today);
    return age >= 0 && age < 7;
  }).length;
  const invitesToday = sentInvites.filter(r => r.invited === today).length;

  console.log(`\n${c.bold('Caps')}`);
  const weekLine = `  invites, rolling 7d: ${invitesThisWeek}/${WEEKLY_INVITE_CAP}`;
  console.log(invitesThisWeek >= WEEKLY_WARN_AT ? c.red(weekLine) : weekLine);
  const dayLine = `  invites today:       ${invitesToday}/${DAILY_INVITE_CAP}`;
  console.log(invitesToday >= DAILY_INVITE_CAP ? c.red(dayLine) : dayLine);

  if (ledger) {
    const line = `  InMail credits:      ${ledger.remaining} left (${ledger.spent} spent, ${ledger.refunded} refunded)`;
    console.log(ledger.remaining <= 2 ? c.yellow(line) : line);
  }
  console.log('');
}

main();
