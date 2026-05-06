#!/usr/bin/env node

import { readFileSync, appendFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REF_MAP = join(ROOT, 'data', 'ref-map.tsv');
const HEADER = 'code\tdate\tcompany\trole\treport_path';

// ── Core functions (also usable as ESM imports) ──────────────────────

/**
 * Deterministic 4-char base36 code from company + role + month.
 * Same input within the same calendar month → same code.
 */
export function computeRef(company, role, date) {
  const yearMonth = date.slice(0, 7); // YYYY-MM
  const input = `${company.toLowerCase().trim()}|${role.toLowerCase().trim()}|${yearMonth}`;
  const hash = createHash('sha256').update(input).digest('hex');
  const num = parseInt(hash.slice(0, 8), 16) % (36 ** 4);
  return num.toString(36).toUpperCase().padStart(4, '0');
}

/**
 * Resolve a ref code, handling collisions with existing entries.
 * - Same company+role → returns existing code (idempotent)
 * - Different company+role with same hash → appends digit (A7F21, A7F22, ...)
 */
export function resolveRef(company, role, date) {
  const code = computeRef(company, role, date);
  if (!existsSync(REF_MAP)) return code;

  const lines = readFileSync(REF_MAP, 'utf-8').trim().split('\n').slice(1); // skip header
  for (const line of lines) {
    const [existingCode, , existingCompany, existingRole] = line.split('\t');
    if (existingCode === code) {
      // Same company+role → idempotent, return existing
      if (existingCompany.toLowerCase() === company.toLowerCase() &&
          existingRole.toLowerCase() === role.toLowerCase()) {
        return code;
      }
      // Collision → find free suffix
      for (let i = 1; i <= 9; i++) {
        const alt = `${code}${i}`;
        if (!lines.some(l => l.split('\t')[0] === alt)) return alt;
      }
    }
  }
  return code;
}

/**
 * Append a ref entry to data/ref-map.tsv. Idempotent — skips if code exists.
 */
export function recordRef(code, date, company, role, reportPath = '') {
  // Ensure file + header exist
  if (!existsSync(REF_MAP)) {
    writeFileSync(REF_MAP, HEADER + '\n', 'utf-8');
  }

  const content = readFileSync(REF_MAP, 'utf-8');
  if (content.split('\n').some(l => l.startsWith(`${code}\t`))) return code;

  appendFileSync(REF_MAP, `${code}\t${date}\t${company}\t${role}\t${reportPath}\n`, 'utf-8');
  console.log(`📎 Ref ${code} → ${company} / ${role}`);
  return code;
}

/**
 * Look up a ref code → returns the matching line or null.
 */
export function lookupRef(code) {
  if (!existsSync(REF_MAP)) return null;
  const lines = readFileSync(REF_MAP, 'utf-8').trim().split('\n').slice(1);
  return lines.find(l => l.startsWith(`${code}\t`)) || null;
}

// ── CLI ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];

if (command === 'generate') {
  const company = args[1];
  const role = args[2];
  let date = new Date().toISOString().slice(0, 10); // default: today

  for (const arg of args.slice(3)) {
    if (arg.startsWith('--date=')) date = arg.split('=')[1];
  }

  if (!company || !role) {
    console.error('Usage: node lib/ref-code.mjs generate "<company>" "<role>" [--date=YYYY-MM-DD]');
    process.exit(1);
  }

  const code = resolveRef(company, role, date);
  recordRef(code, date, company, role);
  console.log(code);

} else if (command === 'lookup') {
  const code = args[1];
  if (!code) {
    console.error('Usage: node lib/ref-code.mjs lookup <CODE>');
    process.exit(1);
  }
  const result = lookupRef(code);
  if (result) {
    console.log(result);
  } else {
    console.error(`❌ Ref ${code} not found`);
    process.exit(1);
  }

} else {
  console.error('Commands: generate, lookup');
  console.error('  node lib/ref-code.mjs generate "BMW" "AI Engineer" [--date=2026-04-12]');
  console.error('  node lib/ref-code.mjs lookup A7F2');
  process.exit(1);
}
