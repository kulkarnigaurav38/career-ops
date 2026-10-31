// dictionary.js — Pass 1: regelbasierte Zuordnung (deutsche + englische Feld-Labels -> Profil-Schluessel)
const RULES = [
  { re: /vorname|first ?name|given name/i, key: "firstName" },
  { re: /nachname|familienname|last ?name|surname/i, key: "lastName" },
  { re: /voll(er)? ?name|full ?name|^name$|ihr name/i, key: "fullName" },
  { re: /anrede|salutation/i, key: "salutation" },
  { re: /geschlecht|gender/i, key: "gender" },
  { re: /familienstand|marital/i, key: "maritalStatus" },
  { re: /geburts(datum|tag)|date of birth|birth ?date|birthday|\bdob\b/i, key: "birthDate" },
  { re: /geburtsland|country of birth|land der geburt/i, key: "birthCountry" },
  { re: /schwerbehind|disab/i, key: "disability" },
  { re: /e-?mail/i, key: "email" },
  { re: /telefon|\bmobil|phone|handynummer|rufnummer|\btel\.?\b/i, key: "phone" },
  // "Strasse UND Hausnummer" in EINEM Feld will die komplette Adresse. Der Konnektor
  // ist Pflicht, sonst wuerde auch "Street number" hier haengenbleiben.
  { re: /(stra(ß|ss)e|street|adresse|address)\s*(und|and|\+|&|\/|,)\s*(haus-?n|hausnr|n(u|ü)mmer|number|no\b|nr\b)/i, key: "street", whole: true },
  // MUSS vor der Strassen-Regel stehen: "Street number" enthaelt "street" und
  // bekam sonst die komplette Adresse ("Olmuetzerstrasse 3") ins Hausnummernfeld.
  { re: /haus-?n(u|ü)mmer|hausnr|street ?(number|no\.?|nr\.?)\b|nr\.? ?$/i, key: "houseNumber" },
  { re: /stra(ß|ss)e|street|adresse|address/i, key: "street" },
  { re: /plz|postleitzahl|zip|postal/i, key: "zip" },
  { re: /\bort\b|stadt|city|wohnort|location|residence/i, key: "city" },
  { re: /bundesland|state|region/i, key: "state" },
  { re: /\bland\b|country|staat\b/i, key: "country" },
  { re: /staatsangeh|nationalit/i, key: "nationality" },
  { re: /eu-?b(ü|ue)rger|eu citizen/i, key: "euCitizen" },
  { re: /aufenthalts|residence permit/i, key: "residencePermit" },
  { re: /arbeitserlaubnis|work permit|arbeitsgenehmigung/i, key: "workPermit" },
  { re: /visa|visum|sponsor/i, key: "needsVisaSponsorship" },
  { re: /f(ü|ue)hrerschein|driver'?s? licen[cs]e|fahrerlaubnis/i, key: "driversLicense" },
  { re: /linkedin/i, key: "linkedin" },
  { re: /github|git-?hub/i, key: "github" },
  { re: /website|webseite|portfolio|homepage|xing/i, key: "website" },
  // Note VOR Abschluss: "Note (Abschluss)" ist die Note, nicht der Abschluss.
  { re: /\b(abschluss|end)?note\b|notendurchschnitt|\bgrade\b|\bgpa\b/i, key: "degreeGrade" },
  { re: /h(ö|oe)chster abschluss|highest degree|abschluss\b/i, key: "highestDegree" },
  { re: /hochschule|universit(ä|ae)t|university/i, key: "university" },
  { re: /gehalt|verg(ü|ue)tung|salary|gehaltsvorstellung|gehaltswunsch|compensation/i, key: "salaryExpectation" },
  { re: /verf(ü|ue)gbar|eintritt|startdatum|beginn|start date|availab|fr(ü|ue)hest/i, key: "startDate" },
  { re: /k(ü|ue)ndigungsfrist|notice ?period/i, key: "noticePeriod" },
  { re: /voll-?zeit|teilzeit|besch(ä|ae)ftigungsart|employment type|arbeitsverh/i, key: "employmentType" },
  { re: /wochenstunden|stundenzahl|hours per week|arbeitszeit/i, key: "weeklyHours" },
  { re: /\bdeutsch\b|deutschkenntnis|german\b/i, key: "germanLevel" },
  { re: /\benglisch\b|englischkenntnis|\benglish\b/i, key: "englishLevel" },
  { re: /umzug|relocat|umzugsbereit|mobilit/i, key: "willingToRelocate" },
  { re: /remote|home-?office|hybrid/i, key: "remotePreference" },
  { re: /reisebereit|travel/i, key: "travelWillingness" },
  { re: /datenschutz|privacy|einwilligung(?!.*marketing)/i, key: "privacyConsent" },
  { re: /talent-?pool|talentpool/i, key: "talentPool" },
  { re: /marketing|newsletter|werbung/i, key: "marketing" },
  { re: /motivation|anschreiben|warum|nachricht|message|cover ?letter|weitere angaben|bemerkung|anmerkung|why (do you|are you)/i, key: "motivationDefault", freitext: true },
];

function jafNormalize(s) { return (s || "").replace(/\s+/g, " ").trim(); }

// ---- FREITEXT-REGEL (Backend implementiert sie identisch) ----------------------------
// JD-spezifischer Freitext wird NIE gelernt und NIE an /answers geschickt: die Antwort
// unterscheidet sich pro Stelle, Job A's Motivation in Job B ist genau der Bug.
const JAF_FREETEXT_RE = /motivation|anschreiben|warum|nachricht|message|cover ?letter|weitere angaben|bemerkung|anmerkung|why (do you|are you)|tell us|beschreiben/i;
const JAF_MAX_VALUE_LEN = 400;
function jafIsFreeText(label, type, value) {
  if (String(type == null ? "" : type).toLowerCase() === "textarea") return true;
  // NORMALISIERTES Label pruefen — exakt der String, den auch das Backend testet.
  // labelFor() liefert innerText inkl. Zeilenumbruechen; roh getestet weichen beide Seiten
  // voneinander ab und JD-Freitext leckt ins Answer-Sheet.
  if (JAF_FREETEXT_RE.test(jafNormalize(String(label == null ? "" : label)))) return true;
  return String(value == null ? "" : value).length > JAF_MAX_VALUE_LEN;
}
// Lernbar = nicht leer + kein JD-Freitext. Die Quelle ("Korrektur") prueft der Aufrufer.
function jafIsLearnable(label, type, value) {
  const v = String(value == null ? "" : value).trim();
  return !!v && !jafIsFreeText(label, type, v);
}

// ---- LERN-SPEICHER -------------------------------------------------------------------
// Format: learned[host][key] = { value, ts, source: "Korrektur" | "legacy" }
// key = Label lowercase, Whitespace zusammengefasst, Doppelpunkt am Ende weg (= Backend-Normalisierung).
function jafLearnKey(label) {
  return String(label == null ? "" : label).toLowerCase().replace(/\s+/g, " ").trim().replace(/:+$/, "").trim();
}
// Liest BEIDE Formate: alter String-Wert und neues Objekt. Gibt null fuer leer/kaputt.
function jafReadEntry(v) {
  if (v == null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    const s = String(v); return s.trim() ? { value: s, ts: 0, source: "legacy" } : null;
  }
  if (typeof v !== "object" || Array.isArray(v)) return null;
  const s = String(v.value == null ? "" : v.value);
  if (!s.trim()) return null;
  return { value: s, ts: Number(v.ts) > 0 ? Number(v.ts) : 0, source: v.source ? String(v.source) : "legacy" };
}
function jafIsCorrection(entry) { return !!entry && entry.source === "Korrektur"; }

// Migration alt -> neu: verlustfrei (nur leere/kaputte Eintraege fallen weg), idempotent,
// vertraegt die vorhandenen "vergifteten" Eintraege (sie bekommen source:"legacy").
function jafMigrateLearned(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {};
  let migrated = 0, dropped = 0, legacy = 0, total = 0;
  for (const h of Object.keys(src)) {
    const bag = src[h];
    if (!h || !bag || typeof bag !== "object" || Array.isArray(bag)) { dropped++; continue; }
    const bucket = {};
    for (const k of Object.keys(bag)) {
      const key = jafLearnKey(k), e = jafReadEntry(bag[k]);
      if (!key || !e) { dropped++; continue; }
      if (typeof bag[k] !== "object") migrated++;
      const prev = bucket[key];
      if (prev) { dropped++; if ((prev.ts || 0) >= (e.ts || 0)) continue; }   // Kollision: neuerer Wert gewinnt
      bucket[key] = e;
    }
    if (Object.keys(bucket).length) out[h] = bucket;
  }
  for (const h of Object.keys(out)) for (const k of Object.keys(out[h])) { total++; if (!jafIsCorrection(out[h][k])) legacy++; }
  return { learned: out, changed: JSON.stringify(src) !== JSON.stringify(out), migrated, dropped, legacy, total };
}

// { matched:{fid:value}, sources:{fid:'Regel'}, unmatched:[field,...] }
// "Olmuetzerstrasse 3" -> { street: "Olmuetzerstrasse", number: "3" }.
// Nur benutzt, wenn das Formular BEIDE Felder getrennt abfragt.
function jafSplitStreet(v) {
  const t = jafNormalize(v);
  const m = /^(.*?)[\s,]+(\d+\s*[a-zA-Z]?(?:\s*[-\/]\s*\d+\s*[a-zA-Z]?)?)$/.exec(t);
  return m ? { street: m[1].trim(), number: m[2].replace(/\s+/g, "") } : { street: t, number: "" };
}

function ruleMap(fields, profile) {
  const matched = {}, sources = {}, unmatched = [];
  const ruleFor = (f) => {
    const label = jafNormalize(`${f.label} ${f.name || ""}`);
    for (const r of RULES) if (r.re.test(label)) return r;
    return null;
  };
  // Fragt das Formular Strasse UND Hausnummer getrennt, wird die Adresse aufgeteilt;
  // gibt es nur ein Strassenfeld, bleibt sie komplett.
  const splitAddr = fields.some((f) => { const r = ruleFor(f); return r && r.key === "houseNumber"; });
  const addr = jafSplitStreet(profile.street);
  const valueFor = (key, rule) => {
    if (key === "houseNumber") return profile.houseNumber || addr.number || "";
    // whole:true = Feld will Strasse UND Nummer zusammen -> nie splitten.
    if (key === "street" && !(rule && rule.whole) && splitAddr && addr.number) return addr.street;
    return profile[key];
  };
  for (const f of fields) {
    const label = jafNormalize(`${f.label} ${f.name || ""}`);
    const hit = ruleFor(f);
    // JD-spezifischer Freitext geht NIE durch die Regel-Engine. Sonst belegt der statische
    // Standard-Motivationsabsatz das Feld, entfernt es aus _unmatched — und die KI sieht es nie,
    // d.h. JD + massgeschneidertes CV koennen es nie beantworten. Genau die Beschwerde
    // "versteht die Fragen nicht, die pro JD unterschiedlich sind".
    // motivationDefault bleibt der Fallback des Backends, wenn kein Job-Kontext aufloesbar ist.
    if ((hit && hit.freitext) || jafIsFreeText(f.label, f.type)) { unmatched.push(f); }
    else if (hit && valueFor(hit.key, hit) != null && valueFor(hit.key, hit) !== "") { matched[f.fid] = valueFor(hit.key, hit); sources[f.fid] = "Regel"; }
    else unmatched.push(f);
  }
  return { matched, sources, unmatched };
}


// ---- DATEI-UPLOADS ------------------------------------------------------------------
// Klassifiziert <input type="file"> nach Label -> kind aus dem Backend-Katalog (/docs).
// Reihenfolge zaehlt: die spezifischen Regeln stehen vor den generischen Sammel-Slots.
const FILE_RULES = [
  { re: /lebenslauf|\bcv\b|resume|curriculum/i,                              kind: "cv" },
  { re: /anschreiben|motivationsschreiben|cover.?letter|bewerbungsschreiben/i, kind: "coverletter" },
  { re: /arbeitszeugnis|arbeitgeberzeugnis|referenzschreiben|endzeugnis/i,   kind: "endzeugnis" },
  { re: /hochschulzeugnis|abschlusszeugnis|bachelor|diplom|degree/i,         kind: "degree" },
  { re: /noten(ü|ue)bersicht|notenspiegel|transcript|zeugnisübersicht/i,      kind: "transcripts" },
  { re: /sprachzertifikat|deutschzertifikat|goethe|telc/i,                   kind: "deutsch" },
  { re: /aufenthaltstitel|arbeitserlaubnis|arbeitsgenehmigung|work permit/i, kind: "arbeitserlaubnis" },
  { re: /reisepass|passport|ausweis/i,                                       kind: "passport" },
  { re: /(licht)?bild|foto|photo/i,                                          kind: "photo" },
  // Sammel-Slot fuer Zeugnisse/Zertifikate. Bewusst NUR bei eindeutigen Woertern -
  // "Anlagen", "weitere Dokumente", "Sonstiges" oder "Attachment" sind KEIN Signal
  // fuer ein bestimmtes Dokument und wurden frueher blind mit der grossen
  // Kombinierte-Zertifikate-PDF befuellt. Solche Slots bleiben jetzt leer.
  { re: /zeugnis|zertifikat|certificate|qualifikation|nachweis/i,            kind: "zertifikate" },
];

// Slots, die zwar nach Upload aussehen, aber nichts ueber den Inhalt sagen.
// Treffer hier => bewusst NICHT automatisch befuellen.
const FILE_AMBIGUOUS = /anlage|weitere dokumente|sonstige|attachment|dokumente|datei|upload|anhang/i;

function jafClassifyFile(label, name) {
  const t = jafNormalize(`${label || ""} ${name || ""}`);
  for (const r of FILE_RULES) if (r.re.test(t)) return r.kind;
  return null;              // unbekannt -> nichts anhaengen, der Nutzer entscheidet
}

// True, wenn das Label nur "irgendeine Datei" bedeutet und keine Zuordnung erlaubt.
function jafIsAmbiguousFileSlot(label, name) {
  const t = jafNormalize(`${label || ""} ${name || ""}`);
  return !!t && FILE_AMBIGUOUS.test(t) && !FILE_RULES.some((r) => r.re.test(t));
}

// Wenn ein Formular nur EIN Upload-Feld ohne sprechendes Label hat, ist es fast immer der CV.
function jafDefaultKindForSingleInput() { return "cv"; }
