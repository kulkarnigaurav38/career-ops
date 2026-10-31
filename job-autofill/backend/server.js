// server.js — Mini-Backend:
//  POST /map      -> Gemini ordnet offene Formularfelder zu.
//                    QUELLEN: career-ops/config/application-answers.md (Answer-Sheet, massgeblich)
//                    + optionaler JOB-KONTEXT dieser Bewerbung (JD + zugeschnittener CV + Report).
//  POST /answers  -> schreibt gelernte (generische!) Formularantworten zurueck ins Answer-Sheet, Abschnitt 18.
//  GET  /ref      -> sucht in career-ops/data/ref-map.tsv die passende Bewerbung + PDF-Pfade
//  GET  /health   -> Erreichbarkeit von Sheet, ref-map.tsv, jds/, output/, pdftotext
import express from "express";
import fs from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CAREER_OPS = process.env.CAREER_OPS_DIR || path.resolve(__dirname, "../..");
const SHEET_PATH = path.join(CAREER_OPS, "config", "application-answers.md");
const REFMAP_PATH = path.join(CAREER_OPS, "data", "ref-map.tsv");
const JDS_DIR = path.join(CAREER_OPS, "jds");
const REPORTS_DIR = path.join(CAREER_OPS, "reports");
const OUTPUT_DIR = path.join(CAREER_OPS, "output");
// Aktuelles stabiles Flash-Modell (Stand Juli 2026). Flash-Lite (guenstiger): gemini-3.1-flash-lite
const MODEL = process.env.MODEL || "gemini-3.5-flash";
const PORT = Number(process.env.PORT) || 8787;

// Zeichen-Budget fuer den Job-Kontext im Prompt (Kosten + Latenz deckeln)
const BUDGET = { jd: 6000, cv: 4000, report: 2000 };

// Abschnittstitel EXAKT so — Teil des Wire-Contracts mit der Extension.
const LEARNED_HEADING = "## 18. Learned from form corrections (auto-written by job-autofill)";
const LEARNED_INTRO =
  "_Auto-written by the job-autofill backend (`POST /answers`). Generic, reusable answers only — " +
  "JD-specific free text (motivation, \"Warum bei uns?\", cover-letter boxes) is never stored here. " +
  "Sections 1-17 above stay authoritative; on conflict they win._";
const LEARNED_TABLE_HEAD = "| Question (label) | Value | Portal | Updated |";
const LEARNED_TABLE_SEP = "|---|---|---|---|";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function loadSheet() { try { return fs.readFileSync(SHEET_PATH, "utf-8"); } catch { return ""; } }
function readText(p) { try { return fs.readFileSync(p, "utf-8"); } catch { return ""; } }
function mtimeMs(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

// ---------------------------------------------------------------- FREETEXT-REGEL
// Identisch in Extension und Backend. JD-spezifischer Freitext darf NIE gelernt/
// zurueckgeschrieben werden — sonst landet die Motivation von Job A in Job B.
const FREETEXT_LABEL_RE =
  /motivation|anschreiben|warum|nachricht|message|cover ?letter|weitere angaben|bemerkung|anmerkung|why (do you|are you)|tell us|beschreiben/i;
function isJdSpecificFreeText({ label = "", value = "", type = "" } = {}) {
  if (String(type || "").toLowerCase() === "textarea") return true;
  if (FREETEXT_LABEL_RE.test(String(label || ""))) return true;
  if (String(value || "").length > 400) return true;
  return false;
}

// ---------------------------------------------------------------- JSON-EXTRAKTION
// Robuste JSON-Extraktion: nimmt das ERSTE vollstaendige {..}-Objekt, ignoriert Code-Fences
// und alles was Gemini danach anhaengt. REPARIERT ausserdem unbalancierte/abgeschnittene
// Antworten (fehlende schliessende Klammer, offener String) -> Gemini laesst bei Freitext
// gelegentlich das schliessende "}" weg. Wirft nie.
function extractJson(text) {
  if (!text) return {};
  let s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(s); } catch {}
  const start = s.indexOf("{");
  if (start < 0) return {};
  let depth = 0, inStr = false, esc = false, end = -1;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; }
    else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { if (--depth === 0) { end = i; break; } }
  }
  if (end >= 0) { try { return JSON.parse(s.slice(start, end + 1)); } catch { return {}; } }
  // unbalanciert / abgeschnitten -> reparieren
  let cand = s.slice(start);
  if (inStr) cand += '"';                 // offenen String schliessen
  cand = cand.replace(/[,\s]+$/, "");     // haengendes Komma/Whitespace weg
  cand += "}".repeat(depth > 0 ? depth : 1);
  try { return JSON.parse(cand); } catch {}
  // Notfall: bis zum letzten vollstaendigen Feld zurueckschneiden
  const lastComma = cand.lastIndexOf(",");
  if (lastComma > start) { try { return JSON.parse(s.slice(start, lastComma) + "}"); } catch {} }
  return {};
}

// ---------------------------------------------------------------- REF-MAP
// Spalten werden ueber die Kopfzeile aufgeloest (aktuell: code date company role report_path),
// mit positionellem Fallback fuer Dateien ohne Header.
let refMapCache = null; // { key, data } — Neu-Parsen nur bei geaenderter Datei
function readRefMap() {
  const key = `${mtimeMs(REFMAP_PATH)}:${(() => { try { return fs.statSync(REFMAP_PATH).size; } catch { return -1; } })()}`;
  if (refMapCache && refMapCache.key === key) return refMapCache.data;
  const data = parseRefMap();
  refMapCache = { key, data };
  return data;
}

function parseRefMap() {
  const raw = readText(REFMAP_PATH);
  if (!raw.trim()) return { rows: [], ok: fs.existsSync(REFMAP_PATH), mtime: mtimeMs(REFMAP_PATH) };
  const lines = raw.split("\n").filter((l) => l.trim());
  const head = lines[0].split("\t").map((h) => h.trim().toLowerCase());
  const idxOf = (...names) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  let iRef = idxOf("code", "ref", "ref_code"), iDate = idxOf("date"), iCompany = idxOf("company"),
      iRole = idxOf("role"), iReport = idxOf("report_path", "report");
  let body = lines.slice(1);
  if (iRef < 0 || iCompany < 0) { iRef = 0; iDate = 1; iCompany = 2; iRole = 3; iReport = 4; body = lines; }
  const rows = [];
  for (const line of body) {
    const c = line.split("\t").map((x) => x.trim());
    if (c.length < 3) continue;
    const ref = (iRef >= 0 ? c[iRef] : "") || "";
    if (!ref || /^(code|ref|ref_code)$/i.test(ref)) continue;
    rows.push({
      ref,
      date: iDate >= 0 ? c[iDate] || "" : "",
      company: iCompany >= 0 ? c[iCompany] || "" : "",
      role: iRole >= 0 ? c[iRole] || "" : "",
      report: iReport >= 0 ? c[iReport] || "" : "",
    });
  }
  return { rows, ok: true, mtime: mtimeMs(REFMAP_PATH) };
}

// Generische Firmen-Suffixe: fuer die STRIKTE Aufloesung (Firmenname -> Ref) wertlos,
// weil "gmbh" auf die halbe Datei matcht.
// Gemeinsame Matching-Logik fuer GET /ref und die Ref-Aufloesung im Job-Kontext.
// Generische Firmen-Suffixe (GmbH, AG, ...) stehen in JAF_STOP und fallen beim
// Tokenisieren raus - ein separater strict-Modus ist dadurch ueberfluessig.
// ---------------------------------------------------------------- applications.md / pipeline.md
// ref-map.tsv sagt nur code -> Firma/Rolle. Status ("Applied", "Responded") und die
// Job-URL stehen in data/applications.md bzw. data/pipeline.md. Beide werden hier
// gelesen und per Ref-Code an die ref-map angeflanscht.
const APPS_PATH = path.join(CAREER_OPS, "data", "applications.md");
const PIPELINE_PATH = path.join(CAREER_OPS, "data", "pipeline.md");
let appsCache = null;

function parseApplications() {
  const byRef = new Map();

  // applications.md: | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
  // Der Ref-Code steht in der Notes-Spalte als "Ref XXXX".
  try {
    for (const line of fs.readFileSync(APPS_PATH, "utf8").split("\n")) {
      if (!/^\|\s*\d+\s*\|/.test(line)) continue;           // nur echte Datenzeilen
      const c = line.split("|").map((x) => x.trim());
      // c[0] ist leer (Zeile beginnt mit |)
      const [, num, date, company, role, score, status, , report, notes] = c;
      const m = /Ref\s+([A-Z0-9]{4})\b/.exec(notes || "");
      if (!m) continue;
      byRef.set(m[1], {
        ref: m[1], num: Number(num) || null, date, company, role, score, status,
        report: (/\(([^)]+\.md)\)/.exec(report || "") || [])[1] || null,
        notes: (notes || "").slice(0, 400),
        source: "applications.md",
      });
    }
  } catch {}

  // pipeline.md: - [x] #290 | url | Company | Role | Score/5 | PDF ✅ | Ref 5KF4
  // Ergaenzt vor allem die Job-URL; vorhandene applications.md-Eintraege gewinnen.
  try {
    for (const line of fs.readFileSync(PIPELINE_PATH, "utf8").split("\n")) {
      if (!/^\s*-\s*\[[x~! ]\]/i.test(line)) continue;
      const m = /Ref\s+([A-Z0-9]{4})\b/.exec(line);
      if (!m) continue;
      const url = (/(https?:\/\/\S+)/.exec(line) || [])[1] || null;
      const parts = line.split("|").map((x) => x.trim());
      const prev = byRef.get(m[1]);
      if (prev) {
        // Neu ausgeschriebene Stellen tauchen als "duplicate of #NN" mit EIGENER URL
        // auf. Alle URLs gehoeren zur selben Ref und muessen alle indiziert werden.
        if (!prev.url) prev.url = url;
        if (url) { prev.urls = prev.urls || []; if (!prev.urls.includes(url)) prev.urls.push(url); }
        continue;
      }
      byRef.set(m[1], {
        ref: m[1], num: Number((/#(\d+)/.exec(parts[0] || "") || [])[1]) || null,
        date: null, company: parts[2] || "", role: parts[3] || "", score: parts[4] || "",
        status: "Pipeline", report: null, url, urls: url ? [url] : [], notes: "", source: "pipeline.md",
      });
    }
  } catch {}

  return byRef;
}

// ---------------------------------------------------------------- Job-URL-Erkennung
// Der zuverlaessigste Weg zur richtigen Bewerbung ist die URL der offenen Seite -
// pipeline.md hat sie fuer einen grossen Teil der Refs. Titel-Raten ist nur Fallback.
//
// Tracking-Parameter, die dieselbe Stelle unter zig URLs erscheinen lassen.
const URL_JUNK = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "src", "source", "trk", "trackingid", "refid", "originalsubdomain",
  "position", "pagenum", "ebp", "lipi", "licu", "midtoken", "ref",
  "gh_src", "recommendedflavor", "jobdbpvid", "l", "savedsearchid",
]);

// Portal-spezifische Job-IDs. Treffer hier sind exakt - keine Heuristik.
const URL_ID_RULES = [
  { host: /(^|\.)linkedin\.com$/,      re: /\/jobs\/view\/(\d+)/i,             tag: "linkedin" },
  { host: /(^|\.)xing\.com$/,          re: /\/jobs\/[^/?#]*?(\d{6,})/i,        tag: "xing" },
  { host: /(^|\.)arbeitsagentur\.de$/, re: /\/jobsuche\/jobdetail\/([\w-]+)/i, tag: "arbeitsagentur" },
  { host: /(^|\.)indeed\.[\w.]+$/,     re: /[?&]jk=([0-9a-f]+)/i,              tag: "indeed" },
  { host: /(^|\.)softgarden\.io$/,     re: /\/job\/(\d+)/i,                    tag: "softgarden" },
  { host: /(^|\.)personio\.(com|de)$/, re: /\/job\/(\d+)/i,                    tag: "personio" },
];

// Liefert Kandidaten-Schluessel, spezifischster zuerst.
function jobUrlKeys(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch { return []; }
  if (!/^https?:$/.test(u.protocol)) return [];
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const keys = [];

  for (const r of URL_ID_RULES) {
    if (!r.host.test(host)) continue;
    const m = r.re.exec(u.pathname + u.search);
    if (m) { keys.push(`${r.tag}:${m[1].toLowerCase()}`); break; }
  }

  const pathPart = u.pathname.replace(/\/+$/, "").toLowerCase() || "/";
  const params = [...u.searchParams.entries()]
    .filter(([k]) => !URL_JUNK.has(k.toLowerCase()))
    .map(([k, v]) => `${k.toLowerCase()}=${v.toLowerCase()}`)
    .sort();
  if (params.length) keys.push(`${host}${pathPart}?${params.join("&")}`);
  keys.push(`${host}${pathPart}`);
  return keys;
}

// key -> ref. Der erste Eintrag gewinnt (pipeline.md ist chronologisch).
function buildUrlIndex(byRef) {
  const idx = new Map();
  for (const a of byRef.values()) {
    const urls = a.urls && a.urls.length ? a.urls : (a.url ? [a.url] : []);
    for (const u of urls) for (const k of jobUrlKeys(u)) if (!idx.has(k)) idx.set(k, a.ref);
  }
  return idx;
}

// Sucht die Bewerbung zur offenen Seite. Gibt zusaetzlich zurueck, WIE genau
// getroffen wurde - "id" ist exakt, "path" kann theoretisch kollidieren.
function refForUrl(url) {
  const { urlIndex } = readApplications();
  const keys = jobUrlKeys(url);
  for (let i = 0; i < keys.length; i++) {
    const ref = urlIndex.get(keys[i]);
    if (ref) return { ref, key: keys[i], precision: keys[i].includes(":") ? "id" : "path" };
  }
  return null;
}

function readApplications() {
  const key = `${mtimeMs(APPS_PATH)}:${mtimeMs(PIPELINE_PATH)}`;
  if (appsCache && appsCache.key === key) return appsCache.data;
  const byRef = parseApplications();
  const data = { byRef, urlIndex: buildUrlIndex(byRef) };
  appsCache = { key, data };
  return data;
}

// ---------------------------------------------------------------- Text-Matching (IDF)
// Frueher zaehlte jedes Wort gleich viel. "Engineer" (in ~100 Bewerbungen) wog damit
// so schwer wie "Wasserburg" (in genau einer) - und Woerter mit <=2 Zeichen flogen
// komplett raus, womit ausgerechnet "AI" verloren ging. Jetzt: IDF-Gewichtung,
// seltene Woerter entscheiden.
const JAF_STOP = new Set([
  "und", "oder", "mit", "fuer", "für", "der", "die", "das", "den", "dem", "des",
  "ein", "eine", "einen", "einer", "im", "in", "am", "an", "auf", "zu", "zur", "zum",
  "von", "vom", "bei", "als", "aus", "ist", "sind", "wir", "sie", "uns", "unser",
  "the", "and", "for", "with", "our", "you", "your", "are", "job", "jobs", "stelle",
  "bewerbung", "bewerben", "stellenangebot", "stellenanzeige", "karriere", "career",
  "m", "w", "d", "x", "f", "mwd", "divers", "all", "genders",
  "gmbh", "co", "kg", "ag", "se", "mbh", "ohg", "ug", "inc", "ltd",
]);
// Kurze, aber bedeutungstragende Tokens, die nicht an der Laenge scheitern duerfen.
const JAF_SHORT_OK = new Set(["ai", "ml", "ux", "ui", "hr", "bi", "qa", "it", "sa", "go", "c", "r"]);

function jafTokens(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}+#.]+/u)
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w && !JAF_STOP.has(w) && (w.length > 2 || JAF_SHORT_OK.has(w)));
}

let idfCache = null;
function idfFor(rows) {
  const key = rows.length + ":" + (rows[0] && rows[0].ref) + ":" + (rows[rows.length - 1] || {}).ref;
  if (idfCache && idfCache.key === key) return idfCache.fn;
  const df = new Map();
  for (const r of rows) for (const w of new Set(jafTokens(`${r.company} ${r.role}`))) df.set(w, (df.get(w) || 0) + 1);
  const N = rows.length || 1;
  const fn = (w) => Math.log((N + 1) / ((df.get(w) || 0) + 1)) + 1;
  idfCache = { key, fn };
  return fn;
}

// Baut einen Treffer fuer GENAU eine Ref - inkl. der real existierenden PDF-Pfade.
function hitForRef(ref, score = 0, extra = {}) {
  const R = String(ref || "").toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(R)) return null;
  const { byRef } = readApplications();
  const a = byRef.get(R) || {};
  const r = (readRefMap().rows || []).find((x) => x.ref.toUpperCase() === R) || {};
  if (!a.ref && !r.ref) return null;                 // Ref voellig unbekannt
  // Pfade NICHT raten - resolveDoc nimmt den ersten Kandidaten, der existiert.
  const cv = resolveDoc("cv", R);
  const cl = resolveDoc("coverletter", R);
  return {
    ref: R, company: r.company || a.company || "", role: r.role || a.role || "",
    date: r.date || a.date || null, report: r.report || a.report || null, score,
    status: a.status || null, url: a.url || null, num: a.num ?? null,
    source: a.source || "ref-map.tsv",
    cv: cv && cv.exists ? cv.abs : null,
    cl: cl && cl.exists ? cl.abs : null,
    pdfsReady: !!(cv && cv.exists && cl && cl.exists),
    ...extra,
  };
}

function matchRefs(query, { limit = 5 } = {}) {
  const q = String(query || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return [];
  const { rows } = readRefMap();
  const idf = idfFor(rows);
  const qWords = [...new Set(jafTokens(q))];
  if (!qWords.length) return [];
  // Ein exakt enthaltener Firmen-/Rollenname ist ein starkes Extra-Signal.
  const phrase = q.length > 6 ? q : null;
  const { byRef: apps } = readApplications();
  const hits = [];
  const seen = new Set();
  const push = (r, score) => {
    if (seen.has(r.ref)) return;
    seen.add(r.ref);
    const h = hitForRef(r.ref, score);
    if (h) hits.push(h);
  };

  const scoreOf = (company, role) => {
    const text = `${company || ""} ${role || ""}`;
    const hay = new Set(jafTokens(text));
    if (!hay.size) return 0;
    let s = 0;
    for (const w of qWords) if (hay.has(w)) s += idf(w);
    // Firmenname faellt woertlich in den Seitentext -> deutlicher Bonus.
    if (phrase && company && company.length > 3 && phrase.includes(company.toLowerCase())) s += 4;
    return s;
  };

  for (const r of rows) {
    const score = scoreOf(r.company, r.role);
    if (score > 0) push(r, score);
  }
  // Auch Eintraege treffen lassen, die nur in applications.md/pipeline.md stehen.
  for (const a of apps.values()) {
    const score = scoreOf(a.company, a.role);
    if (score > 0) push({ ref: a.ref, company: a.company, role: a.role, date: a.date, report: a.report }, score);
  }
  // gleicher Score -> juengste Bewerbung zuerst
  // Treffer mit fertigen PDFs zuerst, dann Score, dann juengste Bewerbung.
  hits.sort((a, b) =>
    (b.pdfsReady - a.pdfsReady) || (b.score - a.score) || String(b.date).localeCompare(String(a.date)));
  return limit ? hits.slice(0, limit) : hits;
}

// ---------------------------------------------------------------- JOB-KONTEXT
function pdftotextBin() {
  const cands = [process.env.PDFTOTEXT, "/opt/homebrew/bin/pdftotext", "/usr/local/bin/pdftotext"].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch {} }
  return "pdftotext"; // PATH
}

function pdfToText(pdfPath) {
  if (!pdfPath || !fs.existsSync(pdfPath)) return "";
  try {
    const out = execFileSync(pdftotextBin(), ["-layout", pdfPath, "-"], {
      encoding: "utf-8", timeout: 15000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
    return (out || "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  } catch (e) {
    console.warn("[jobctx] pdftotext fehlgeschlagen:", pdfPath, e && (e.code || e.message));
    return "";
  }
}

// {NNN} aus dem report_path ziehen (reports/111-consularis-2026-06-27.md -> "111")
function numFromReportPath(reportPath) {
  const base = path.basename(String(reportPath || ""));
  const m = base.match(/^(\d{2,4})[-_]/);
  return m ? m[1] : "";
}

// jds/{NNN}-*.md bzw. reports/{NNN}-*.md — Slug kann abweichen, daher Glob ueber readdir.
function findByNum(dir, num) {
  if (!num) return "";
  try {
    const re = new RegExp("^0*" + num.replace(/^0+/, "") + "[-_].*\\.md$");
    const hit = fs.readdirSync(dir).filter((n) => re.test(n)).sort()[0];
    return hit ? path.join(dir, hit) : "";
  } catch { return ""; }
}

// Am Zeilenende kappen + Marker setzen, damit der Prompt nie mitten im Wort abbricht.
function budgetText(text, max, label) {
  const t = String(text || "").trim();
  if (!t || t.length <= max) return t;
  let cut = t.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  if (nl > max * 0.5) cut = cut.slice(0, nl);
  return cut.trimEnd() + `\n[... ${label} hier gekuerzt (${t.length - cut.length} Zeichen ausgelassen) ...]`;
}

const jobCtxCache = new Map(); // ref -> { stamp, ctx }

// Laedt JD + zugeschnittenen CV + Report fuer GENAU DIESE Bewerbung.
// context: { ref, company, host, url, text } — alles optional. null, wenn nichts aufloesbar ist.
function loadJobContext(context) {
  if (!context || typeof context !== "object") return null;
  const wantRef = String(context.ref || "").trim().toUpperCase();
  const company = String(context.company || "").trim();
  const pageUrl = String(context.url || "").trim();
  const pageText = String(context.text || "").trim();
  const { rows } = readRefMap();

  let resolvedBy = wantRef ? "ref" : null;
  let row = wantRef ? rows.find((r) => r.ref.toUpperCase() === wantRef) : null;

  // Die URL der offenen Seite ist exakt - vor jedem Raten probieren. Frueher kannte
  // /map nur ref+company, also stand im Log dauerhaft "job=-" und das Modell bekam
  // weder JD noch zugeschnittenen Lebenslauf zu sehen.
  if (!row && !wantRef && pageUrl) {
    const m = refForUrl(pageUrl);
    if (m) { row = rows.find((r) => r.ref === m.ref) || null; if (row) resolvedBy = "url"; }
  }

  // Dann der Seitentext, mit demselben Eindeutigkeits-Gate wie /ref.
  if (!row && !wantRef && pageText) {
    const hits = matchRefs(pageText, { limit: 4 });
    const top = hits[0], second = hits[1];
    const ok = top && top.score >= 4 && (!second || top.score >= second.score * 1.35 || top.score - second.score >= 3);
    if (ok) { row = rows.find((r) => r.ref === top.ref) || null; if (row) resolvedBy = "page-text"; }
  }

  if (!row && !wantRef && company) {
    // AMBIGUITAETS-GATE — spiegelt die Confidence-Regel des Popups.
    // Ohne Gate liefert ein blosses Top-1-Match fuer "Firma X AG" die Bewerbung bei
    // "Firma X Group" (Score 1) und injiziert DEREN JD + massgeschneidertes CV als
    // "GENAU DIESE BEWERBUNG". Ein FALSCHES CV ist schlimmer als gar kein Kontext: das
    // Modell belegt dann Erfahrung, die diese Bewerbung gar nicht behauptet.
    const hits = matchRefs(company, { limit: 2 });
    if (hits.length && hits[0].score >= 2 && (hits.length < 2 || hits[0].score > hits[1].score)) {
      row = rows.find((r) => r.ref === hits[0].ref) || null;
      resolvedBy = "company-guess";
    }
  }
  // Ref vom Nutzer gesetzt, aber (noch) nicht in der Map -> zumindest das CV-PDF versuchen
  if (!row && wantRef) row = { ref: wantRef, date: "", company, role: "", report: "" };
  if (!row) return null;

  const num = numFromReportPath(row.report);
  const jdPath = findByNum(JDS_DIR, num);
  let reportPath = row.report ? path.join(CAREER_OPS, row.report) : "";
  if (!reportPath || !fs.existsSync(reportPath)) reportPath = findByNum(REPORTS_DIR, num);
  // NICHT raten: dieselbe Kandidaten-Aufloesung wie beim Upload. Vorher stand hier
  // `${row.ref}-cv.pdf` - eine Datei, die es nie gibt, d.h. der zugeschnittene
  // Lebenslauf fehlte dem Modell still als Belegquelle.
  const cvDoc = resolveDoc("cv", row.ref);
  const cvPdf = cvDoc && cvDoc.exists ? cvDoc.abs : "";

  // resolvedBy gehoert in den Stamp: dieselbe Ref kann einmal exakt und einmal geraten
  // aufgeloest werden — sonst liefert der Cache die falsche Confidence-Kennzeichnung.
  const stamp = [readRefMap().mtime, jdPath, mtimeMs(jdPath), reportPath, mtimeMs(reportPath), cvPdf, mtimeMs(cvPdf), resolvedBy].join("|");
  const cached = jobCtxCache.get(row.ref);
  if (cached && cached.stamp === stamp) return cached.ctx;

  const sources = [];
  const jd = budgetText(readText(jdPath), BUDGET.jd, "Stellenanzeige");
  if (jd) sources.push("jd");
  const cv = budgetText(pdfToText(cvPdf), BUDGET.cv, "Lebenslauf");
  if (cv) sources.push("cv");
  const report = budgetText(readText(reportPath), BUDGET.report, "Bewertung");
  if (report) sources.push("report");
  if (!sources.length) { jobCtxCache.set(row.ref, { stamp, ctx: null }); return null; }

  // Wie sicher die Zuordnung ist, MUSS im Prompt stehen: bei geratenem Kontext darf
  // das Modell ihn verwerfen, bei exakter Ref (oder URL-Treffer) nicht.
  const who = `Ref ${row.ref}${row.company ? `, ${row.company}` : ""}${row.role ? `, ${row.role}` : ""}`;
  const guessed = resolvedBy === "company-guess" || resolvedBy === "page-text";
  const how = resolvedBy === "company-guess" ? "nur ueber den Firmennamen erraten" : "aus dem Seitentext abgeleitet";
  const parts = [
    guessed
      ? `JOB-KONTEXT — VERMUTLICH diese Bewerbung, ${how} (${who}). Passt der Kontext ERKENNBAR NICHT zum Formular, ignoriere ihn und antworte nur aus dem Answer-Sheet:`
      : `JOB-KONTEXT — GENAU DIESE BEWERBUNG (${who}):`,
  ];
  if (jd) parts.push(`--- STELLENANZEIGE (verbatim) ---\n${jd}`);
  if (cv) parts.push(`--- ZUGESCHNITTENER LEBENSLAUF, PDF-Text (einzige Belegquelle fuer Erfahrung) ---\n${cv}`);
  if (report) parts.push(`--- INTERNE BEWERTUNG / TAILORING-NOTIZ (nicht zitieren) ---\n${report}`);

  const ctx = {
    ref: row.ref,
    company: row.company || company,
    role: row.role || "",
    resolvedBy,
    sources,
    text: parts.join("\n\n"),
    paths: { jd: jdPath || null, report: reportPath && fs.existsSync(reportPath) ? reportPath : null, cv: fs.existsSync(cvPdf) ? cvPdf : null },
    lengths: { jd: jd.length, cv: cv.length, report: report.length },
  };
  jobCtxCache.set(row.ref, { stamp, ctx });
  return ctx;
}

// ---------------------------------------------------------------- PROMPT
const SYSTEM = `Du fuellst deutsche Bewerbungsformulare aus. Als massgebliche Datenquelle bekommst du das ANSWER-SHEET (Markdown) des Bewerbers plus ein Zusatz-Profil (JSON). Manchmal bekommst du zusaetzlich den JOB-KONTEXT dieser konkreten Bewerbung (Stellenanzeige + zugeschnittener Lebenslauf + interne Bewertung). Ordne jedem OFFENEN Formularfeld genau einen Wert zu.

WELCHE QUELLE FUER WELCHES FELD:
- STANDARD-/VERWALTUNGSFELDER (Name, Anrede, Geburtsdatum, Kontakt, Adresse, Nationalitaet, Visum/Arbeitserlaubnis, Ausbildung, Sprachen, Gehalt, Startdatum, Mobilitaet, DSGVO/Marketing) -> IMMER das ANSWER-SHEET. Der Job-Kontext ueberschreibt das Answer-Sheet NIEMALS.
- UNGEWOEHNLICHE / STELLENBEZOGENE FELDER ("Warum bei uns?", "Was reizt Sie an der Position?", "Welche Erfahrung haben Sie mit <Technologie>?", "Jahre Erfahrung mit <Technologie aus DIESER Anzeige>", Team-/Rollen-/Projektfragen, Tools der Anzeige) -> antworte aus dem JOB-KONTEXT: Stellenanzeige (was gefragt ist) + zugeschnittener LEBENSLAUF (was belegt ist).
- Der LEBENSLAUF ist die einzige Belegquelle fuer Erfahrung. Erfinde NIE Erfahrung, Technologien, Arbeitgeber, Zeitraeume oder Zahlen, die dort nicht stehen.
- Stuetzen weder Answer-Sheet noch Lebenslauf eine Antwort: LASS DAS FELD WEG. Weglassen ist immer besser als Raten.

QUELLEN-REGELN (Answer-Sheet):
- Nutze IMMER die Werte aus dem Answer-Sheet: Personendaten (Abschnitt 1), Kontakt (2), Adresse (3), Arbeitserlaubnis/Visum (4), Ausbildung (5-6), Jahre-Erfahrung pro Skill (7), Sprachen (8), Gehalt (9), Startdatum/Verfuegbarkeit (10), Mobilitaet/Remote (11), DSGVO/Marketing (14). Abschnitt 18 (falls vorhanden) enthaelt frueher gelernte Formularantworten und ist ebenfalls gueltig, steht aber hinter 1-17 zurueck.
- Beachte die Entscheidungsregeln des Sheets (Abschnitt 16): DEFAULT JA fuer DSGVO-/Datenschutz-Consent, Talent-Pool, Datenspeicherung, Umzug innerhalb Deutschlands, Probezeit; DEFAULT NEIN fuer Marketing-/Newsletter-Mails und Third-Party-Datenweitergabe. Einzelnes Gehalts-Zahlenfeld = der Wert aus "salaryExpectation" im Profil/Answer-Sheet (VB). Exaktes Startdatum = erster Tag des naechsten Monats.
- "Wie viele Jahre X?": zuerst Abschnitt 7. Steht die Technologie dort nicht, leite die Jahre NUR aus den Zeitraeumen im Lebenslauf ab, wenn die Technologie dort wirklich genannt ist; sonst Feld weglassen.
- Sprach-Niveau: Abschnitt 8.
- Freitext (Motivation / "Warum bei uns?"): MIT Job-Kontext 2-4 konkrete Saetze, die die Anzeige (Produkt, Aufgaben, Stack) mit belegten Punkten aus dem Lebenslauf verbinden - keine Floskeln, keine erfundenen Fakten. OHNE Job-Kontext den Standard-Motivationsabsatz (Abschnitt 12).
- Fuer "TBD - confirm"-Zeilen oder Angaben, die NICHT im Sheet stehen: LASS DAS FELD WEG (nicht raten, nicht erfinden).

FELD-REGELN:
- Dropdown/Radio (options gegeben): waehle EXAKT eines der Option-Labels.
- Checkbox: antworte "ja" oder "nein".
- Fuelle so viele Felder wie moeglich mit den Sheet-Daten.

Antworte NUR als JSON-Objekt {"<fid>":"<wert>", ...}. Kein Markdown, keine Erklaerung.`;

app.post("/map", async (req, res) => {
  const { profile = {}, fields = [], context = null } = req.body || {};
  // Job-Kontext auch ohne Felder aufloesen -> die Extension kann anzeigen, welche Bewerbung erkannt wurde.
  let job = null;
  try { job = loadJobContext(context); } catch (e) { console.warn("[/map] Job-Kontext fehlgeschlagen:", String(e)); }
  const jobInfo = job ? { ref: job.ref, company: job.company, role: job.role, sources: job.sources, resolvedBy: job.resolvedBy || "ref" } : null;

  if (!Array.isArray(fields) || !fields.length) return res.json({ map: {}, usedSheet: false, job: jobInfo });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY fehlt (.env)", job: jobInfo });

  const sheet = loadSheet();
  const user =
    (sheet ? `ANSWER-SHEET (massgebliche Quelle, Markdown):\n${sheet}\n\n` : "") +
    (job ? `${job.text}\n\n` : "") +
    (context && (context.company || context.host || context.url)
      ? `FORMULAR-KONTEXT: Firma "${context.company || "?"}", Portal ${context.host || "?"}, URL ${context.url || "?"}\n\n`
      : "") +
    `ZUSATZ-PROFIL (JSON, ergaenzend):\n${JSON.stringify(profile)}\n\n` +
    `OFFENE FORMULARFELDER:\n${JSON.stringify(fields)}`;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        // thinkingBudget:0 -> kein Chain-of-Thought (deterministisch, schnell, kein leeres Ergebnis durch Token-Budget)
        generationConfig: { temperature: 0, maxOutputTokens: 8000, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    const data = await r.json();
    if (data.error) return res.status(500).json({ error: data.error.message || "Gemini-Fehler", job: jobInfo });
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    const parsed = extractJson(text);
    const fr = data.candidates?.[0]?.finishReason;
    console.log(`[/map] finish=${fr} textLen=${text.length} felder=${Object.keys(parsed).length} job=${job ? `${job.ref}[${job.sources.join(",")}] via ${job.resolvedBy}` : "- (keine Bewerbung aufloesbar: ref/url/text/company alle leer oder mehrdeutig)"}`);
    if (!Object.keys(parsed).length && text.trim()) console.warn("[/map] parse-fail tail:", JSON.stringify(text.slice(-120)));
    res.json({ map: parsed, usedSheet: !!sheet, job: jobInfo });
  } catch (e) {
    res.status(500).json({ error: String(e), job: jobInfo });
  }
});

// ---------------------------------------------------------------- /answers (Abschnitt 18)
function normLabel(s) {
  return String(s || "").replace(/\\\|/g, "|").toLowerCase().replace(/\s+/g, " ").replace(/:+\s*$/, "").trim();
}
function mdCell(s) {
  return String(s == null ? "" : s).replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}
function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
}
function today() { return new Date().toISOString().slice(0, 10); }

// Pro-Ausschreibung gueltige Angaben. Kurz und damit NICHT von der Freitext-Regel erfasst,
// aber trotzdem wertlos als "generische" Antwort: die Kennziffer aus Stelle A ins Formular
// von Stelle B zu schreiben ist genau das Wiederholen falscher Antworten, das behoben wird.
const PER_POSTING_LABEL_RE =
  /kennziffer|referenz(nummer)?|\bref\.?\s*(nr|nummer)|stellen[- ]?(id|nummer|anzeige)|job[- ]?(id|nummer)|requisition|einsatzort|standort|dienstort|ansprechpartner|wo haben sie|aufmerksam geworden|gefunden/i;

app.post("/answers", (req, res) => {
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];

  // Datei MUSS lesbar sein — sonst nichts anfassen (Nutzerdaten, nicht im Git).
  let original;
  try { original = fs.readFileSync(SHEET_PATH, "utf-8"); }
  catch (e) { return res.status(500).json({ error: "Answer-Sheet nicht lesbar, nichts geschrieben: " + SHEET_PATH }); }

  let skipped = 0;
  const valid = [];
  for (const e of entries) {
    if (!e || typeof e !== "object") { skipped++; continue; }
    const label = String(e.label || "").trim();
    const value = String(e.value == null ? "" : e.value).trim();
    // remove:true (oder leerer Wert mit remove-Flag) loescht die Zeile — ohne dieses Verb
    // ueberlebt ein vergifteter Wert im Sheet, obwohl die UI "geloescht" meldet, und wird
    // Gemini bei jedem weiteren /map weiter als massgeblich untergeschoben.
    if (label && (e.remove === true || e.delete === true)) { valid.push({ label, remove: true }); continue; }
    if (!label || !value || value.length > 400 || isJdSpecificFreeText({ label, value, type: e.type })) { skipped++; continue; }
    if (PER_POSTING_LABEL_RE.test(label)) { skipped++; continue; }
    valid.push({ label, value, host: String(e.host || "").trim(), company: String(e.company || "").trim(), ref: String(e.ref || "").trim() });
  }
  if (!valid.length) return res.json({ written: 0, skipped, path: SHEET_PATH });

  // Abschnitt 18 isolieren; alles davor (1-17) und dahinter bleibt BYTE-IDENTISCH.
  const idx = original.indexOf(LEARNED_HEADING);
  let head, section, rest;
  if (idx < 0) {
    head = original.replace(/\s+$/, "") + "\n\n---\n\n";
    section = `${LEARNED_HEADING}\n\n${LEARNED_INTRO}\n\n${LEARNED_TABLE_HEAD}\n${LEARNED_TABLE_SEP}\n`;
    rest = "";
  } else {
    head = original.slice(0, idx);
    const tail = original.slice(idx);
    const nl = tail.indexOf("\n");
    const bodyStart = nl < 0 ? tail.length : nl + 1;
    const nextRel = tail.slice(bodyStart).search(/^##\s/m);
    if (nextRel < 0) { section = tail; rest = ""; }
    else { section = tail.slice(0, bodyStart + nextRel); rest = tail.slice(bodyStart + nextRel); }
  }

  // Bestehende Tabelle parsen
  const lines = section.replace(/\s+$/, "").split("\n");
  const firstPipe = lines.findIndex((l) => l.trim().startsWith("|"));
  let preamble, rows = [], postamble = [];
  if (firstPipe < 0) {
    preamble = lines.slice();
    if (!preamble.some((l) => l.includes("_Auto-written by the job-autofill backend"))) preamble.push("", LEARNED_INTRO);
  } else {
    preamble = lines.slice(0, firstPipe);
    for (const l of lines.slice(firstPipe)) {
      const t = l.trim();
      // Alles, was KEINE Tabellenzeile ist, gehoert dem Nutzer (handschriftliche Notizen,
      // Unterueberschriften, Listen). Frueher wurde es beim Neuschreiben still geloescht —
      // unwiederbringlich, weil die Datei nicht im Git liegt. Jetzt: einsammeln und
      // hinter der Tabelle unveraendert wieder ausgeben.
      if (!t.startsWith("|")) { if (t || postamble.length) postamble.push(l); continue; }
      if (/^\|[\s:|-]+\|?$/.test(t)) continue;                       // Trennzeile
      const cells = splitRow(t);
      if (normLabel(cells[0]) === normLabel("Question (label)")) continue; // Kopfzeile
      rows.push({ q: cells[0] || "", v: cells[1] || "", portal: cells[2] || "", updated: cells[3] || "" });
    }
  }
  while (postamble.length && !postamble[postamble.length - 1].trim()) postamble.pop();
  while (preamble.length && !preamble[preamble.length - 1].trim()) preamble.pop();

  let written = 0, removed = 0;
  for (const e of valid) {
    const key = normLabel(e.label);
    const portalNew = e.host || e.company || "-";
    const i = rows.findIndex((r) => normLabel(r.q) === key);
    if (e.remove) {                       // idempotent: nicht vorhanden -> nichts zu tun
      if (i >= 0) { rows.splice(i, 1); removed++; }
      continue;
    }
    if (i >= 0) {
      const portals = new Set(rows[i].portal.split(",").map((p) => p.trim()).filter((p) => p && p !== "-"));
      if (portalNew !== "-") portals.add(portalNew);
      rows[i].v = mdCell(e.value);
      rows[i].portal = [...portals].slice(0, 3).join(", ") || "-";
      rows[i].updated = today();
    } else {
      rows.push({ q: mdCell(e.label), v: mdCell(e.value), portal: mdCell(portalNew), updated: today() });
    }
    written++;
  }

  const table = [LEARNED_TABLE_HEAD, LEARNED_TABLE_SEP, ...rows.map((r) => `| ${r.q} | ${r.v} | ${r.portal || "-"} | ${r.updated || today()} |`)];
  // postamble = alles, was der Nutzer unter der Tabelle stehen hat. Unveraendert erhalten.
  const nextSection = [...preamble, "", ...table, ...(postamble.length ? ["", ...postamble] : []), ""].join("\n");
  const next = head + nextSection + (rest ? "\n" + rest.replace(/^\n+/, "") : "");

  // Schutzcheck: keine Ueberschrift aus 1-17 darf verloren gehen.
  for (const h of original.match(/^## .*$/gm) || []) {
    if (!next.includes(h)) return res.status(500).json({ error: "Schutzcheck fehlgeschlagen (Abschnitt verloren: " + h + ") — nichts geschrieben" });
  }
  if (!next.startsWith(head) || next.length < head.length) {
    return res.status(500).json({ error: "Schutzcheck fehlgeschlagen (Kopfteil veraendert) — nichts geschrieben" });
  }

  // Atomar: tmp im selben Verzeichnis + rename
  const tmp = path.join(path.dirname(SHEET_PATH), `.${path.basename(SHEET_PATH)}.tmp-${process.pid}-${Date.now()}`);
  try {
    let mode = 0o644;
    try { mode = fs.statSync(SHEET_PATH).mode & 0o777; } catch {}
    fs.writeFileSync(tmp, next, { encoding: "utf-8", mode });
    fs.renameSync(tmp, SHEET_PATH);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    return res.status(500).json({ error: "Schreiben fehlgeschlagen: " + String(e) });
  }
  console.log(`[/answers] written=${written} removed=${removed} skipped=${skipped} rows=${rows.length}`);
  res.json({ written, removed, skipped, path: SHEET_PATH });
});

// ---------------------------------------------------------------- /ref
// Ref/PDF-Finder: matcht Firmenname gegen career-ops/data/ref-map.tsv
app.get("/ref", (req, res) => {
  const q = (req.query.q || "").toString();
  const url = (req.query.url || "").toString();
  const pageText = (req.query.text || "").toString();
  if (!q.trim() && !url.trim() && !pageText.trim()) return res.json({ hits: [], matchedBy: "none", confident: false });
  if (!fs.existsSync(REFMAP_PATH)) return res.status(500).json({ error: "ref-map.tsv nicht gefunden: " + REFMAP_PATH });
  try {
    // 1) URL der offenen Seite - exakt, wenn pipeline.md sie kennt.
    if (url.trim()) {
      const m = refForUrl(url);
      if (m) {
        const hit = hitForRef(m.ref, 99, { matchedBy: "url", urlKey: m.key, precision: m.precision });
        if (hit) return res.json({ hits: [hit], matchedBy: "url" });
      }
    }
    // 2) Text der Seite (Titel, Ueberschrift, Firmenzeile) gegen Firma+Rolle matchen.
    const needle = [q, pageText].filter(Boolean).join(" ").slice(0, 4000);
    if (!needle.trim()) return res.json({ hits: [], matchedBy: "none", confident: false });

    const hits = matchRefs(needle, { limit: 6 });
    // Eindeutig ist ein Treffer, wenn er klar vor dem zweiten liegt - nicht schon,
    // wenn er ueberhaupt der beste ist. Sonst gewinnt bei fuenf fast gleichen
    // "Junior AI Engineer"-Bewerbungen der Zufall und das falsche PDF geht hoch.
    const top = hits[0], second = hits[1];
    // Zwei Bewerbungen bei DERSELBEN Firma (Doppel-/Wiederbewerbung) sind aus dem
    // Seitentext prinzipiell nicht zu trennen. Dann NICHT raten, sondern fragen -
    // der Nutzer sieht Rolle und Datum und entscheidet in einem Klick.
    const normCo = (c) => String(c || "").toLowerCase()
      .replace(/\b(gmbh|mbh|ag|se|kg|co|und|and|niederlassung|standort|deutschland|germany|group|gruppe|holding)\b/g, "")
      .replace(/[^a-z0-9]/g, "");
    // Nicht nur Platz 2 pruefen: die Zwillingsbewerbung kann auch auf Platz 3/4 landen,
    // wenn eine fremde Firma zufaellig dazwischenrutscht.
    const topCo = top ? normCo(top.company) : "";
    const sameCompany = !!topCo && hits.slice(1, 4).some((h) => normCo(h.company) === topCo);
    const confident = !!top && top.score >= 4 && !sameCompany &&
      (!second || top.score >= second.score * 1.35 || top.score - second.score >= 3);
    res.json({
      hits, matchedBy: "text", confident,
      ambiguous: hits.length > 1 && !confident,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ---------------------------------------------------------------- /health
function dirInfo(p, ext) {
  try {
    const n = fs.readdirSync(p).filter((f) => (ext ? f.endsWith(ext) : true)).length;
    return { path: p, ok: true, files: n };
  } catch { return { path: p, ok: false, files: 0 }; }
}


// ---------------------------------------------------------------- DOKUMENTE (/docs, /file, /stage)
// Die Extension darf keinen Dateipfad in ein <input type=file> schreiben (Chrome verbietet das),
// aber sie DARF ein File-Objekt zuweisen, das sie im Speicher hat. Also liefert das Backend die
// Bytes. Nur Kinds aus diesem Katalog sind erreichbar - kein Pfad kommt je aus der Query.
const DOCS_DIR = path.join(CAREER_OPS, "Job Application Documents (1)");

// kind -> { label, candidates[], as: Anzeigename beim Upload }
// Der Katalog steht NICHT im Code: docs-catalog.local.json (gitignored, deine echten
// Dateinamen) wird bevorzugt, sonst faellt es auf docs-catalog.example.json zurueck.
//
// Jeder Eintrag listet KANDIDATEN in Prioritaetsreihenfolge; genommen wird der erste,
// der wirklich existiert. Deshalb steht die komprimierte Fassung immer vorn
// ("Kombinierte Zertifikat_compressed (1).pdf" vor der 5,8-MB-Fassung).
//   perRef: ["{REF}_LEBENSLAUF.pdf", "{REF}_CV.pdf"]  -> relativ zu output/
//   files:  ["B2 Zertifikat_compressed.pdf", ...]     -> relativ zu DOCS_DIR
function loadDocCatalog() {
  const local = path.join(__dirname, "docs-catalog.local.json");
  const example = path.join(__dirname, "docs-catalog.example.json");
  const src = fs.existsSync(local) ? local : example;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(src, "utf8"));
  } catch (e) {
    console.warn(`[docs] Katalog nicht lesbar (${src}): ${e.message}`);
    return {};
  }
  const out = {};
  for (const [kind, e] of Object.entries(raw)) {
    // perRef und files duerfen String oder Array sein (Altformat bleibt lesbar).
    const perRef = e.perRef ? [].concat(e.perRef) : null;
    const files  = e.files || e.file ? [].concat(e.files || e.file) : null;
    out[kind] = { label: e.label, as: e.as, perRef, files };
  }
  console.log(`[docs] Katalog geladen: ${path.basename(src)} (${Object.keys(out).length} Eintraege)`);
  return out;
}

const DOC_CATALOG = loadDocCatalog();

// Alle denkbaren Pfade fuer ein kind - in Prioritaetsreihenfolge, ohne Existenzpruefung.
function candidatePaths(kind, ref) {
  const e = DOC_CATALOG[kind];
  if (!e) return [];
  if (e.perRef) {
    const R = String(ref || "").toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(R)) return [];            // Ref streng validiert
    // Altformat: perRef war mal ein Suffix ("cv") statt eines Musters mit {REF}.
    return e.perRef.map((pat) =>
      pat.includes("{REF}")
        ? path.join(OUTPUT_DIR, pat.replace(/\{REF\}/g, R))
        : path.join(OUTPUT_DIR, `${R}-${pat}.pdf`)
    );
  }
  return (e.files || []).map((f) => path.join(DOCS_DIR, f));
}

// Nimmt den ERSTEN Kandidaten, der existiert. Existiert keiner, wird der erste
// zurueckgegeben (mit exists:false), damit Fehlermeldungen einen Dateinamen nennen.
function resolveDoc(kind, ref) {
  const e = DOC_CATALOG[kind];
  if (!e) return null;                                   // Whitelist: unbekanntes kind -> nichts
  const cands = candidatePaths(kind, ref);
  if (!cands.length) return null;
  const hit = cands.find((p) => fs.existsSync(p));
  return { ...e, abs: hit || cands[0], exists: !!hit, tried: cands.length };
}

const MIME = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".txt": "text/plain" };

app.get("/docs", (req, res) => {
  const ref = String(req.query.ref || "");
  const docs = Object.keys(DOC_CATALOG).map((kind) => {
    const d = resolveDoc(kind, ref);
    let size = 0;
    const exists = !!(d && d.exists);
    if (exists) { try { size = fs.statSync(d.abs).size; } catch {} }
    // `picked` = welcher Kandidat gewonnen hat; im Popup sichtbar, damit nie wieder
    // unbemerkt die falsche (unkomprimierte) Fassung hochgeht.
    return { kind, label: DOC_CATALOG[kind].label, as: DOC_CATALOG[kind].as,
             perRef: !!DOC_CATALOG[kind].perRef, exists, size,
             picked: d && exists ? path.basename(d.abs) : null };
  });
  res.json({ ref: ref || null, docs, missing: docs.filter((d) => !d.exists).map((d) => d.kind) });
});

app.get("/file", (req, res) => {
  const kind = String(req.query.kind || "");
  const d = resolveDoc(kind, req.query.ref);
  if (!d) return res.status(400).json({ error: "unbekanntes kind oder ungültige ref" });
  // Kein Kandidat existiert -> klare Meldung statt stiller 404-Schleife.
  if (!d.exists) {
    return res.status(404).json({
      error: `keine Datei fuer "${kind}" gefunden (${d.tried} Kandidat(en) geprueft)`,
      expected: path.basename(d.abs),
    });
  }
  // Doppelter Boden: der aufgelöste Pfad MUSS unter career-ops liegen.
  const abs = path.resolve(d.abs);
  if (!abs.startsWith(path.resolve(CAREER_OPS) + path.sep)) return res.status(400).json({ error: "Pfad ausserhalb career-ops" });
  res.set("Content-Type", MIME[path.extname(abs).toLowerCase()] || "application/octet-stream");
  res.set("Content-Disposition", `inline; filename="${d.as}"`);
  res.set("X-Upload-Filename", d.as);
  // Welche Quelldatei wirklich gewonnen hat - das Popup zeigt sie an.
  res.set("X-Source-File", encodeURIComponent(path.basename(abs)));
  fs.createReadStream(abs).pipe(res);
});

// Fallback für Dropzone-Portale: die richtigen Dateien in einen leeren Ordner kopieren,
// damit der Datei-Dialog genau diese vier zeigt statt 200+ PDFs.
app.post("/stage", (req, res) => {
  const ref = String(req.body?.ref || "");
  if (!/^[A-Za-z0-9]{4}$/.test(ref)) return res.status(400).json({ error: "ungültige ref" });
  const kinds = Array.isArray(req.body?.kinds) && req.body.kinds.length
    ? req.body.kinds : ["cv", "coverletter", "endzeugnis", "zertifikate"];
  const dir = path.join(CAREER_OPS, "output", "_upload", ref.toUpperCase());
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const copied = [], missing = [];
  for (const k of kinds) {
    const d = resolveDoc(k, ref);
    if (!d || !fs.existsSync(d.abs)) { missing.push(k); continue; }
    fs.copyFileSync(d.abs, path.join(dir, d.as));
    copied.push(d.as);
  }
  if (req.body?.open) { try { execFileSync("open", [dir]); } catch {} }
  res.json({ dir, copied, missing });
});

app.get("/health", (_req, res) => {
  const bin = pdftotextBin();
  // pdftotext schreibt die Version nach stderr -> spawnSync, damit beide Streams sichtbar sind.
  const probe = spawnSync(bin, ["-v"], { encoding: "utf-8", timeout: 5000 });
  const probeOut = `${probe.stdout || ""}${probe.stderr || ""}`.split("\n")[0].trim();
  const pdf = { path: bin, ok: !probe.error && /pdftotext version/i.test(probeOut), version: probeOut };
  const map = readRefMap();
  res.json({
    ok: true,
    provider: "gemini",
    model: MODEL,
    port: PORT,
    geminiKey: !!process.env.GEMINI_API_KEY,
    answerSheet: fs.existsSync(SHEET_PATH) ? SHEET_PATH : "FEHLT",
    careerOps: CAREER_OPS,
    pdftotext: pdf,
    docs: { path: DOCS_DIR, ok: fs.existsSync(DOCS_DIR), files: (() => { try { return fs.readdirSync(DOCS_DIR).length; } catch { return 0; } })() },
    refMap: { path: REFMAP_PATH, ok: fs.existsSync(REFMAP_PATH), rows: map.rows.length },
    jds: dirInfo(JDS_DIR, ".md"),
    reports: dirInfo(REPORTS_DIR, ".md"),
    output: dirInfo(OUTPUT_DIR, ".pdf"),
    jobContext: fs.existsSync(REFMAP_PATH) && fs.existsSync(JDS_DIR) && fs.existsSync(OUTPUT_DIR) && pdf.ok,
  });
});

// Nur lauschen, wenn direkt gestartet (`node server.js`) — beim Importieren (Tests) nicht.
const isMain = (() => {
  try { return !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return true; }
})();
if (isMain) {
  app.listen(PORT, () => console.log(`Autofill-Backend: http://localhost:${PORT} (Gemini ${MODEL}, Sheet ${fs.existsSync(SHEET_PATH) ? "OK" : "FEHLT"})`));
}

export { app, loadJobContext, matchRefs, isJdSpecificFreeText, extractJson, readRefMap, SHEET_PATH, CAREER_OPS };
