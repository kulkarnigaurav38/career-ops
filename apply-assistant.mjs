#!/usr/bin/env node

/**
 * apply-assistant.mjs — Playwright form-fill assistant
 *
 * Usage:
 *   node apply-assistant.mjs "https://apply-url" --ref=A7F2 [--answers=answers.json]
 *
 * Opens a visible browser, navigates to the application form, fills profile
 * data + attaches PDFs + optionally fills text answers. Stops before Submit.
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = join(ROOT, 'config', 'profile.yml');
const REF_MAP_PATH = join(ROOT, 'data', 'ref-map.tsv');
const STATE_DIR = join(ROOT, 'data', 'browser-state');
const LOG_DIR = join(ROOT, 'data', 'apply-log');

// ── Simple YAML value extractor ─────────────────────────────────────

function readProfile() {
  const text = readFileSync(PROFILE_PATH, 'utf-8');
  const get = (key) => {
    const m = text.match(new RegExp(`^\\s+${key}:\\s*"?([^"\\n]+)"?`, 'm'));
    return m ? m[1].trim() : '';
  };
  return {
    full_name: get('full_name'),
    email: get('email'),
    phone: get('phone'),
    location: get('location'),
    linkedin: get('linkedin'),
    portfolio_url: get('portfolio_url'),
    github: get('github'),
    visa_status: get('visa_status'),
    target_range: get('target_range'),
  };
}

// ── Field label matching ────────────────────────────────────────────

const PATTERNS = {
  first_name:    /first.?name|vorname|given.?name/i,
  last_name:     /last.?name|nachname|family.?name|surname/i,
  full_name:     /^name$|full.?name|your.?name|vollständiger.?name/i,
  email:         /email|e-mail/i,
  phone:         /phone|tel|telefon|mobile|handy|rufnummer/i,
  linkedin:      /linkedin/i,
  portfolio:     /portfolio|website|webseite|homepage/i,
  location:      /location|city|stadt|ort|wohnort|address|adresse|standort/i,
  salary:        /salary|gehalt|compensation|vergütung|gehaltsvorstellung/i,
  start_date:    /start.?date|availab|verfügbar|eintrittsdatum|earliest|frühest/i,
  visa:          /visa|work.?auth|arbeitserlaubnis|aufenthalt/i,
  hear_about:    /how.?did.?you|wie.?haben.?sie|hear.?about|erfahren|aufmerksam/i,
};

const FILE_PATTERNS = {
  cv:            /resume|cv|lebenslauf/i,
  cover_letter:  /cover.?letter|anschreiben|motivation/i,
};

function matchField(label, profile) {
  if (PATTERNS.first_name.test(label))  return profile.full_name.split(' ')[0];
  if (PATTERNS.last_name.test(label))   return profile.full_name.split(' ').slice(1).join(' ');
  if (PATTERNS.full_name.test(label))   return profile.full_name;
  if (PATTERNS.email.test(label))       return profile.email;
  if (PATTERNS.phone.test(label))       return profile.phone;
  if (PATTERNS.linkedin.test(label))    return `https://www.linkedin.com/in/${profile.linkedin.replace(/.*\/in\//, '')}`;
  if (PATTERNS.portfolio.test(label))   return profile.portfolio_url;
  if (PATTERNS.location.test(label))    return profile.location;
  if (PATTERNS.salary.test(label))      return profile.target_range;
  if (PATTERNS.start_date.test(label))  return 'Immediately / Sofort';
  if (PATTERNS.visa.test(label))        return profile.visa_status;
  if (PATTERNS.hear_about.test(label))  return 'Online job search';
  return null;
}

// ── Find PDFs by ref code ───────────────────────────────────────────

function findPDFs(ref) {
  const outputDir = join(ROOT, 'output');
  if (!existsSync(outputDir)) return { cv: null, coverLetter: null };

  const profile = readProfile();
  const name = profile.full_name.replace(/\s+/g, '_');
  let cv = null, coverLetter = null;

  const cvNames = [`${name}_Lebenslauf_${ref}.pdf`, `${name}_CV_${ref}.pdf`];
  const clNames = [`${name}_Anschreiben_${ref}.pdf`, `${name}_CoverLetter_${ref}.pdf`];

  for (const f of cvNames) {
    const full = join(outputDir, f);
    if (existsSync(full)) { cv = full; break; }
  }
  for (const f of clNames) {
    const full = join(outputDir, f);
    if (existsSync(full)) { coverLetter = full; break; }
  }
  return { cv, coverLetter };
}

// ── Main ────────────────────────────────────────────���───────────────

async function main() {
  const args = process.argv.slice(2);
  let url = null, ref = null, answersPath = null;

  for (const arg of args) {
    if (arg.startsWith('--ref='))     ref = arg.split('=')[1];
    else if (arg.startsWith('--answers=')) answersPath = arg.split('=')[1];
    else if (arg === '--help') {
      console.log('Usage: node apply-assistant.mjs <URL> --ref=CODE [--answers=file.json]');
      console.log('  URL        Application form URL');
      console.log('  --ref      Reference code (e.g., A7F2) — finds PDFs in output/');
      console.log('  --answers  JSON file with {label: answer} for text fields');
      process.exit(0);
    }
    else if (!url) url = arg;
  }

  if (!url || !ref) {
    console.error('❌ Usage: node apply-assistant.mjs <URL> --ref=CODE [--answers=file.json]');
    process.exit(1);
  }

  const profile = readProfile();
  const pdfs = findPDFs(ref);
  const answers = answersPath && existsSync(answersPath)
    ? JSON.parse(readFileSync(answersPath, 'utf-8'))
    : {};

  console.log(`📋 Apply Assistant — Ref: ${ref}`);
  console.log(`   URL: ${url}`);
  console.log(`   CV:  ${pdfs.cv || '⚠️ not found'}`);
  console.log(`   CL:  ${pdfs.coverLetter || '⚠️ not found'}`);
  console.log(`   Answers: ${Object.keys(answers).length} pre-filled\n`);

  // Session persistence
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const statePath = join(STATE_DIR, `${domain}.json`);
  mkdirSync(STATE_DIR, { recursive: true });

  const launchOpts = { headless: false };
  const contextOpts = existsSync(statePath)
    ? { storageState: statePath }
    : {};

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();

  console.log('🌐 Navigating...');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {
    console.log('⚠️ Page load timeout — continuing anyway');
  });
  await page.waitForTimeout(2000);

  // Extract all form fields
  const fields = await page.evaluate(() => {
    const results = [];
    const inputs = document.querySelectorAll('input, textarea, select');

    for (const el of inputs) {
      if (el.type === 'hidden' || el.type === 'submit') continue;

      let label = '';
      // Try aria-label
      if (el.getAttribute('aria-label')) label = el.getAttribute('aria-label');
      // Try <label for="">
      else if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl) label = lbl.textContent.trim();
      }
      // Try placeholder
      if (!label && el.placeholder) label = el.placeholder;
      // Try name attribute
      if (!label && el.name) label = el.name;
      // Try closest label ancestor
      if (!label) {
        const parent = el.closest('label');
        if (parent) label = parent.textContent.trim().slice(0, 100);
      }

      results.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || 'text',
        label: label,
        name: el.name || '',
        id: el.id || '',
        selector: el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : null,
        value: el.value || '',
      });
    }
    return results;
  });

  console.log(`📝 Found ${fields.length} form fields\n`);

  const filled = [];
  const unfilled = [];
  const fileInputs = [];

  for (const field of fields) {
    if (!field.selector) { unfilled.push(field); continue; }

    // File uploads
    if (field.type === 'file') {
      fileInputs.push(field);
      continue;
    }

    // Try profile match
    let value = matchField(field.label, profile);

    // Try answers JSON
    if (!value && answers[field.label]) value = answers[field.label];
    // Also try matching by name/id
    if (!value && answers[field.name]) value = answers[field.name];
    if (!value && answers[field.id]) value = answers[field.id];

    if (value) {
      try {
        if (field.tag === 'select') {
          await page.selectOption(field.selector, { label: value }).catch(() => {
            // Try by value
            page.selectOption(field.selector, value).catch(() => {});
          });
        } else {
          await page.fill(field.selector, value);
        }
        filled.push({ label: field.label, value: value.slice(0, 60) });
      } catch (e) {
        unfilled.push({ ...field, error: e.message });
      }
    } else {
      unfilled.push(field);
    }
  }

  // Handle file uploads
  for (const fi of fileInputs) {
    const selector = fi.selector || `input[type="file"][name="${fi.name}"]`;
    let filePath = null;

    if (FILE_PATTERNS.cv.test(fi.label) || FILE_PATTERNS.cv.test(fi.name)) {
      filePath = pdfs.cv;
    } else if (FILE_PATTERNS.cover_letter.test(fi.label) || FILE_PATTERNS.cover_letter.test(fi.name)) {
      filePath = pdfs.coverLetter;
    } else if (pdfs.cv && !pdfs._cvAttached) {
      // First unmatched file input → assume CV
      filePath = pdfs.cv;
      pdfs._cvAttached = true;
    } else if (pdfs.coverLetter && !pdfs._clAttached) {
      // Second → assume cover letter
      filePath = pdfs.coverLetter;
      pdfs._clAttached = true;
    }

    if (filePath) {
      try {
        await page.setInputFiles(selector, filePath);
        filled.push({ label: fi.label || 'File upload', value: filePath.split(/[/\\]/).pop() });
      } catch (e) {
        unfilled.push({ ...fi, error: e.message });
      }
    } else {
      unfilled.push(fi);
    }
  }

  // Print summary
  console.log('✅ FILLED:');
  for (const f of filled) console.log(`   ${f.label}: ${f.value}`);

  if (unfilled.length > 0) {
    console.log('\n⬜ UNFILLED (needs manual input or --answers JSON):');
    for (const u of unfilled) {
      console.log(`   [${u.type}] ${u.label || u.name || u.id || '(unknown)'}`);
    }
    // Output unfilled as JSON for Claude to process
    const unfilledJson = JSON.stringify(unfilled.map(u => ({
      label: u.label, name: u.name, id: u.id, type: u.type
    })), null, 2);
    console.log(`\n📄 Unfilled fields JSON:\n${unfilledJson}`);
  }

  // Save application log
  mkdirSync(LOG_DIR, { recursive: true });
  const logPath = join(LOG_DIR, `${ref}.json`);
  writeFileSync(logPath, JSON.stringify({
    ref, url, date: new Date().toISOString(),
    filled, unfilled: unfilled.map(u => ({ label: u.label, type: u.type })),
  }, null, 2));
  console.log(`\n💾 Log saved: ${logPath}`);

  // Save session state
  const state = await context.storageState();
  writeFileSync(statePath, JSON.stringify(state));
  console.log(`🔐 Session saved: ${statePath}`);

  console.log('\n' + '='.repeat(60));
  console.log('⚠️  REVIEW THE FORM — then click Submit yourself.');
  console.log('    Press Ctrl+C when done to close the browser.');
  console.log('='.repeat(60));

  // Keep browser open until user closes
  await new Promise(() => {}); // Block forever — user presses Ctrl+C
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
