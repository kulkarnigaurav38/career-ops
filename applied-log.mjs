#!/usr/bin/env node
/**
 * applied-log.mjs — record WHEN an application was actually sent.
 *
 * The tracker's Date column is the evaluation date, not the send date, so it
 * cannot answer "what did I apply to today?". Outreach eligibility depends on
 * exactly that question: recruiter messages go out ONLY for applications sent
 * today, never for the backlog and never for anything already rejected.
 *
 * Run:
 *   node applied-log.mjs add <REF|#NUM> [--date YYYY-MM-DD] [--url URL]
 *   node applied-log.mjs add --company "X" --role "Y" [--url URL]   # off-tracker, e.g. applied straight on LinkedIn
 *   node applied-log.mjs today            # what was sent today
 *   node applied-log.mjs list [--days N]  # last N days (default 7)
 *
 * `add` also flips the tracker row's status to Applied (skip with --no-status).
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const LOG = join(ROOT, 'data/applied-log.tsv');
const APPS = join(ROOT, 'data/applications.md');
const HEADER = ['applied_date', 'ref', 'num', 'company', 'role', 'url'];

const c = {
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
};

const now = new Date();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

function flag(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : fallback;
}

function readLog() {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, 'utf8').split('\n').slice(1)
    .filter(l => l.trim())
    .map(l => {
      const cells = l.split('\t');
      return Object.fromEntries(HEADER.map((h, i) => [h, cells[i] ?? '']));
    });
}

/** Tracker rows: # | Date | Company | Role | Score | Status | PDF | Report | Notes */
function readTracker() {
  if (!existsSync(APPS)) return [];
  const rows = [];
  readFileSync(APPS, 'utf8').split('\n').forEach((line, idx) => {
    if (!line.trim().startsWith('|')) return;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
    if (cells.length < 6 || cells[0] === '#' || /^-+$/.test(cells[0])) return;
    const notes = cells.slice(8).join(' | ');
    const m = notes.match(/\bRef\s+([A-Za-z0-9]{4})\b/);
    rows.push({
      lineNo: idx, num: cells[0], company: cells[2], role: cells[3],
      status: cells[5].replace(/\*/g, '').trim(), ref: m ? m[1].toUpperCase() : '',
    });
  });
  return rows;
}

function setStatusApplied(lineNo) {
  const lines = readFileSync(APPS, 'utf8').split('\n');
  const cells = lines[lineNo].split('|');
  // cells[0] is the empty string before the leading pipe, so status is index 6
  if (cells.length < 7) return false;
  cells[6] = ` ${'Applied'} `;
  lines[lineNo] = cells.join('|');
  writeFileSync(APPS, lines.join('\n'), 'utf8');
  return true;
}

function add() {
  const date = flag('date', TODAY);
  const url = flag('url', '');
  const target = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : null;
  let row;

  if (target) {
    const key = target.replace(/^#/, '').toUpperCase();
    if (!key) {   // "#" or "" would otherwise match the first row that has no ref
      console.error(`Empty target. Pass a ref like TJHM or a row number like #117.`);
      process.exit(1);
    }
    const tracker = readTracker();
    const hit = tracker.find(r => (r.ref && r.ref === key) || r.num === key.replace(/^0+/, ''));
    if (!hit) {
      console.error(`No tracker row for "${target}". Use --company/--role for an off-tracker application.`);
      process.exit(1);
    }
    if (/^(rejected|discarded|skip)$/i.test(hit.status)) {
      console.error(`#${hit.num} ${hit.company} is "${hit.status}" — not logging an application for a dead row.`);
      process.exit(1);
    }
    row = { applied_date: date, ref: hit.ref || '-', num: hit.num, company: hit.company, role: hit.role, url };
    if (!process.argv.includes('--no-status') && hit.status.toLowerCase() !== 'applied') {
      setStatusApplied(hit.lineNo);
      console.log(c.dim(`  tracker #${hit.num}: ${hit.status} -> Applied`));
    }
  } else {
    const company = flag('company'), role = flag('role');
    if (!company || !role) {
      console.error('Need <REF|#NUM>, or --company "X" --role "Y" for an off-tracker application.');
      process.exit(1);
    }
    row = { applied_date: date, ref: flag('ref', '-'), num: '-', company, role, url };
  }

  const dup = readLog().find(r =>
    r.applied_date === row.applied_date &&
    r.company.toLowerCase() === row.company.toLowerCase() &&
    r.role.toLowerCase() === row.role.toLowerCase());
  if (dup) {
    console.log(c.yellow(`  already logged today: ${row.company} | ${row.role}`));
    return;
  }

  if (!existsSync(LOG)) writeFileSync(LOG, HEADER.join('\t') + '\n', 'utf8');
  appendFileSync(LOG, HEADER.map(h => row[h] ?? '').join('\t') + '\n', 'utf8');
  console.log(c.green(`  logged ${row.applied_date}: ${row.company} | ${row.role}` +
    (row.ref !== '-' ? c.dim(` [${row.ref}]`) : '')));
}

function show(days) {
  const log = readLog();
  const cutoff = days === 0
    ? TODAY
    : new Date(Date.parse(TODAY) - days * 86400000).toISOString().slice(0, 10);
  const rows = log.filter(r => (days === 0 ? r.applied_date === TODAY : r.applied_date >= cutoff));

  const label = days === 0 ? 'Applied today' : `Applied in the last ${days} days`;
  console.log(`\n${c.bold(label)} ${c.dim(TODAY)}`);
  if (!rows.length) {
    console.log(c.dim('  nothing logged\n'));
    console.log(c.dim('  log one:  node applied-log.mjs add <REF>'));
    console.log(c.dim('            node applied-log.mjs add --company "X" --role "Y" --url "..."\n'));
    return;
  }
  for (const r of rows.sort((a, b) => b.applied_date.localeCompare(a.applied_date))) {
    console.log(`  ${c.dim(r.applied_date)}  ${c.bold(r.company)} | ${r.role}` +
      (r.ref && r.ref !== '-' ? c.dim(`  [${r.ref}]`) : ''));
  }
  console.log(`\n${rows.length} application(s). Outreach is eligible for TODAY's only ` +
    `— run ${c.bold('npm run outreach:due')}.\n`);
}

const cmd = process.argv[2];
if (cmd === 'add') add();
else if (cmd === 'today') show(0);
else if (cmd === 'list') show(parseInt(flag('days', '7'), 10));
else {
  console.log('usage: applied-log.mjs add <REF|#NUM> [--date D] [--url U] [--no-status]');
  console.log('       applied-log.mjs add --company "X" --role "Y" [--url U]');
  console.log('       applied-log.mjs today | list [--days N]');
  process.exit(1);
}
