// options.js — Profil bearbeiten + Manager fuer gelernte Antworten (chrome.storage.local).
// Vorbefuellt aus career-ops config/application-answers.md (Stand: dein Answer-Sheet).
// Platzhalter-Profil. Trage hier NICHTS Persoenliches ein - lege stattdessen
// extension/profile.local.json an (gitignored); die Datei wird, falls vorhanden,
// beim ersten Oeffnen automatisch statt dieser Defaults geladen.
const DEFAULT_PROFILE = {
  "salutation": "Herr",
  "gender": "männlich",
  "pronouns": "he/him",
  "firstName": "Max",
  "lastName": "Mustermann",
  "fullName": "Max Mustermann",
  "birthDate": "01.01.1990",
  "birthCountry": "Musterland",
  "nationality": "musterländisch",
  "maritalStatus": "ledig",
  "disability": "nein",
  "email": "max.mustermann@example.com",
  "phone": "+49 000 0000000",
  "linkedin": "https://linkedin.com/in/max-mustermann",
  "github": "https://github.com/max-mustermann",
  "website": "https://example.com",
  "street": "Musterstraße 1",
  "zip": "10115",
  "city": "Musterstadt",
  "state": "Musterland",
  "country": "Deutschland",
  "euCitizen": "nein",
  "residencePermit": "Aufenthaltstitel, Studium abgeschlossen",
  "workPermit": "Ja, voll arbeitsberechtigt",
  "needsVisaSponsorship": "nein",
  "driversLicense": "nein",
  "highestDegree": "M.Sc. Musterstudiengang",
  "university": "Musterhochschule",
  "degreeGrade": "2,0",
  "graduationDate": "Januar 2020",
  "bachelorDegree": "B.Sc. Musterstudiengang",
  "bachelorUniversity": "Musteruniversität",
  "salaryExpectation": "00000",
  "salaryRange": "00.000–00.000 EUR (VB)",
  "startDate": "01.01.2030",
  "availability": "ab sofort",
  "noticePeriod": "keine (sofort verfügbar)",
  "employmentType": "Vollzeit",
  "weeklyHours": "40",
  "germanLevel": "B2",
  "englishLevel": "C1",
  "willingToRelocate": "Ja, innerhalb Deutschland",
  "remotePreference": "Hybrid bevorzugt, voll-remote akzeptabel",
  "travelWillingness": "gelegentlich (bis ~25%)",
  "languages": { "Deutsch": "B2", "Englisch": "C1" },
  "yearsOfExperience": {
    "Python": "3+ Jahre", "TypeScript": "3+ Jahre", "SQL": "3+ Jahre",
    "React": "2+ Jahre", "Node.js": "2+ Jahre", "Docker": "2+ Jahre"
  },
  "privacyConsent": "ja",
  "talentPool": "ja",
  "marketing": "nein",
  "thirdPartySharing": "nein",
  "futureContact": "ja",
  "bio": "Kurzprofil in ein bis drei Saetzen: Abschluss, Schwerpunkte, Jahre Erfahrung, wichtigste Technologien.",
  "motivationDefault": "Standard-Motivationstext, der ohne Bezug auf eine konkrete Stelle funktioniert. Wird von Pass 2 bei Bedarf zugeschnitten."
};

// Laedt das echte Profil aus der gitignorten profile.local.json, sonst die Platzhalter.
async function seedProfile() {
  try {
    const r = await fetch(chrome.runtime.getURL("profile.local.json"));
    if (r.ok) return await r.json();
  } catch {}
  return DEFAULT_PROFILE;
}

// ============================================================
// Teil 1 — Profil-Editor (bestehend)
// ============================================================
function bootProfile() {
  const ta = document.getElementById("p");
  const msg = document.getElementById("msg");
  if (!ta) return;
  chrome.storage.local.get("profile").then(async ({ profile }) => {
    ta.value = JSON.stringify(profile || (await seedProfile()), null, 2);
  });
  document.getElementById("save").onclick = () => {
    try {
      const p = JSON.parse(ta.value);
      chrome.storage.local.set({ profile: p }).then(() => { msg.textContent = "Gespeichert ✓"; });
    } catch (e) {
      msg.textContent = "Ungültiges JSON: " + e.message;
    }
  };
  document.getElementById("reset").onclick = async () => {
    ta.value = JSON.stringify(await seedProfile(), null, 2);
    msg.textContent = "Auf Standard zurückgesetzt (noch nicht gespeichert).";
  };
}

// ============================================================
// Teil 2 — Gelernte Antworten (learned)
//
// Zwei Speicher-Generationen, BEIDE werden unterstuetzt:
//   alt:  learned[host][normalizedLabel] = "Wert"
//   neu:  learned[host][normalizedLabel] = { value, ts, source: "Korrektur" | "legacy" }
// Alle Helfer hier sind DOM-frei und rein (sie liefern NEUE Objekte zurueck),
// damit sie ohne Browser testbar sind.
// ============================================================
const LM_SOURCE_LEGACY = "legacy";
const LM_SOURCE_KORREKTUR = "Korrektur";

// Beliebigen Roh-Eintrag -> { value, ts, source, oldShape } (oder null, wenn unbrauchbar).
function lmNormalizeEntry(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    // Altes Format: nur der nackte Wert, ohne Datum/Quelle -> gilt als "legacy".
    return { value: String(raw), ts: null, source: LM_SOURCE_LEGACY, oldShape: true };
  }
  if (typeof raw === "object") {
    const value = raw.value === null || raw.value === undefined ? "" : String(raw.value);
    let ts = null;
    if (typeof raw.ts === "number" && isFinite(raw.ts)) ts = raw.ts;
    else if (typeof raw.ts === "string" && raw.ts.trim()) {
      const parsed = Date.parse(raw.ts);
      if (!isNaN(parsed)) ts = parsed;
    }
    const source = typeof raw.source === "string" && raw.source.trim() ? raw.source.trim() : LM_SOURCE_LEGACY;
    return { value: value, ts: ts, source: source, oldShape: false };
  }
  return null;
}

// learned-Store -> [{ host, entries: [{ host, label, value, ts, source, oldShape, legacy }] }], alphabetisch.
function lmFlatten(learned) {
  const out = [];
  if (!learned || typeof learned !== "object") return out;
  const hosts = Object.keys(learned).sort((a, b) => String(a).localeCompare(String(b), "de"));
  hosts.forEach((host) => {
    const bag = learned[host];
    const entries = [];
    if (bag && typeof bag === "object") {
      Object.keys(bag).sort((a, b) => String(a).localeCompare(String(b), "de")).forEach((label) => {
        const e = lmNormalizeEntry(bag[label]);
        if (!e) return;
        entries.push({
          host: host, label: label, value: e.value, ts: e.ts, source: e.source,
          oldShape: e.oldShape, legacy: e.source === LM_SOURCE_LEGACY
        });
      });
    }
    out.push({ host: host, entries: entries });
  });
  return out;
}

// Filter ueber Host, Label oder Wert. Leere Gruppen fallen raus.
function lmFilter(groups, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return groups;
  const out = [];
  (groups || []).forEach((g) => {
    if (String(g.host).toLowerCase().indexOf(q) >= 0) { out.push(g); return; }
    const entries = g.entries.filter((e) =>
      String(e.label).toLowerCase().indexOf(q) >= 0 || String(e.value).toLowerCase().indexOf(q) >= 0);
    if (entries.length) out.push({ host: g.host, entries: entries });
  });
  return out;
}

function lmCounts(groups) {
  let entries = 0, legacy = 0;
  (groups || []).forEach((g) => {
    entries += g.entries.length;
    g.entries.forEach((e) => { if (e.legacy) legacy++; });
  });
  return { hosts: (groups || []).length, entries: entries, legacy: legacy };
}

function lmCloneStore(store) {
  const out = {};
  if (!store || typeof store !== "object") return out;
  Object.keys(store).forEach((h) => {
    const bag = store[h];
    out[h] = (bag && typeof bag === "object") ? Object.assign({}, bag) : {};
  });
  return out;
}

// Einen Eintrag loeschen. Bleibt der Host leer zurueck, faellt der Host mit weg.
function lmDeleteEntry(store, host, label) {
  const next = lmCloneStore(store);
  if (next[host]) {
    delete next[host][label];
    if (!Object.keys(next[host]).length) delete next[host];
  }
  return next;
}

function lmDeleteHost(store, host) {
  const next = lmCloneStore(store);
  delete next[host];
  return next;
}

// Speichern = immer neues Format, Quelle "Korrektur", ts = jetzt.
function lmSaveEntry(store, host, label, value, now) {
  const next = lmCloneStore(store);
  if (!next[host]) next[host] = {};
  next[host][label] = {
    value: value === null || value === undefined ? "" : String(value),
    ts: typeof now === "number" && isFinite(now) ? now : Date.now(),
    source: LM_SOURCE_KORREKTUR
  };
  return next;
}

function lmClearAll() { return {}; }

function lmFormatTs(ts) {
  if (ts === null || ts === undefined || typeof ts !== "number" || !isFinite(ts)) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const p2 = (n) => (n < 10 ? "0" + n : String(n));
  return p2(d.getDate()) + "." + p2(d.getMonth() + 1) + "." + d.getFullYear() + ", " + p2(d.getHours()) + ":" + p2(d.getMinutes());
}

// ---- Storage-Zugriff ----------------------------------------------------
async function lmLoad() {
  const got = await chrome.storage.local.get("learned");
  const learned = got && got.learned;
  return learned && typeof learned === "object" ? learned : {};
}
async function lmPersist(store) {
  await chrome.storage.local.set({ learned: store });
}

// ---- App-Zustand --------------------------------------------------------
const lmState = { store: {}, query: "" };

// ---- Rendering ----------------------------------------------------------
// Es wird ausschliesslich per createElement + textContent gebaut.
// Kein innerHTML mit Nutzerdaten -> Labels/Werte koennen nichts injizieren.
function lmEl(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== null && text !== undefined) n.textContent = String(text);
  return n;
}

function lmSay(text) {
  const el = document.getElementById("lmMsg");
  if (el) el.textContent = String(text || "");
}

async function lmMutate(nextStore, message) {
  lmState.store = nextStore;
  await lmPersist(lmState.store);
  lmSay(message);
  lmRender(lmState);
}

function lmSrcClass(entry) {
  if (entry.legacy) return "legacy";
  if (entry.source === LM_SOURCE_KORREKTUR) return "korr";
  return "other";
}

function lmEntryRow(host, e) {
  const row = lmEl("div", "lmEntry");

  const head = lmEl("div", "lmLbl");
  head.appendChild(lmEl("span", "lmLabelText", e.label));
  const badge = lmEl("span", "src " + lmSrcClass(e), e.source);
  if (e.oldShape) badge.setAttribute("title", "Altes Speicherformat: nur Text, ohne Datum und Quelle.");
  head.appendChild(badge);
  head.appendChild(lmEl("span", "lmTs", e.ts ? lmFormatTs(e.ts) : "kein Datum"));
  row.appendChild(head);

  const line = lmEl("div", "lmRow");
  const inp = lmEl("input", "val");
  inp.value = e.value;
  inp.setAttribute("type", "text");
  line.appendChild(inp);

  const save = lmEl("button", "small", "Speichern");
  save.addEventListener("click", () => {
    const v = String(inp.value === null || inp.value === undefined ? "" : inp.value);
    if (!v.trim()) {
      lmMutate(lmDeleteEntry(lmState.store, host, e.label), 'Leerer Wert - Eintrag "' + e.label + '" gelöscht.');
    } else {
      lmMutate(lmSaveEntry(lmState.store, host, e.label, v, Date.now()),
        'Gespeichert: "' + e.label + '" (' + host + ') - Quelle jetzt "Korrektur".');
    }
  });
  line.appendChild(save);

  const del = lmEl("button", "sec small", "Löschen");
  del.addEventListener("click", () => {
    lmMutate(lmDeleteEntry(lmState.store, host, e.label), 'Eintrag "' + e.label + '" (' + host + ') gelöscht.');
  });
  line.appendChild(del);

  row.appendChild(line);
  return row;
}

function lmHostBlock(group) {
  const box = lmEl("div", "lmHost");
  const head = lmEl("div", "lmHostHead");
  head.appendChild(lmEl("span", "lmHostName", group.host));

  const c = lmCounts([group]);
  head.appendChild(lmEl("span", "lmHostCount",
    c.entries + " Eintrag/Einträge" + (c.legacy ? " · " + c.legacy + " legacy" : "")));

  // Zwei-Klick-Bestaetigung, damit ein ganzer Host nicht versehentlich verschwindet.
  const del = lmEl("button", "sec small", "Portal löschen");
  let armed = false;
  del.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      del.className = "danger small";
      del.textContent = "Wirklich? Nochmal klicken";
      if (typeof setTimeout === "function") {
        setTimeout(() => {
          if (!armed) return;
          armed = false;
          del.className = "sec small";
          del.textContent = "Portal löschen";
        }, 5000);
      }
      return;
    }
    armed = false;
    lmMutate(lmDeleteHost(lmState.store, group.host), 'Alle gelernten Werte für "' + group.host + '" gelöscht.');
  });
  head.appendChild(del);
  box.appendChild(head);

  if (!group.entries.length) {
    box.appendChild(lmEl("div", "lmEmpty", "Keine (lesbaren) Einträge für dieses Portal."));
  } else {
    group.entries.forEach((e) => { box.appendChild(lmEntryRow(group.host, e)); });
  }
  return box;
}

// Rendert Meta-Zeile + Liste. Gibt eine kleine Zusammenfassung zurueck (praktisch fuer Tests).
function lmRender(state) {
  const list = document.getElementById("lmList");
  const meta = document.getElementById("lmMeta");
  const groups = lmFlatten(state && state.store);
  const totals = lmCounts(groups);
  const query = (state && state.query) || "";
  const shownGroups = lmFilter(groups, query);
  const shown = lmCounts(shownGroups);
  const summary = {
    hosts: totals.hosts, entries: totals.entries, legacy: totals.legacy,
    shownHosts: shown.hosts, shownEntries: shown.entries
  };
  if (!list || !meta) return summary;

  meta.replaceChildren();
  meta.appendChild(lmEl("div", "lmCount",
    totals.entries + " gelernte Antwort(en) in " + totals.hosts + " Portal(en)" +
    (String(query).trim() ? " · " + shown.entries + " Treffer für den Filter" : "")));

  if (totals.legacy > 0) {
    const warn = lmEl("div", "lmWarn");
    warn.appendChild(lmEl("b", null,
      'Achtung: ' + totals.legacy + ' Eintrag/Einträge mit Quelle "legacy".'));
    warn.appendChild(lmEl("span", null,
      ' Diese Werte hat die alte, fehlerhafte Version beim Ausfüllen automatisch mitgeschrieben - ' +
      'auch falsche und versehentlich getippte. Sie werden bei jedem Besuch desselben Portals wieder ' +
      'eingespielt und sind die wahrscheinlichste Ursache für wiederholt falsche Antworten. ' +
      'Bitte prüfen, korrigieren (wird dann zu "Korrektur") oder löschen.'));
    meta.appendChild(warn);
  }

  list.replaceChildren();
  if (!shownGroups.length) {
    list.appendChild(lmEl("div", "lmEmpty", totals.entries
      ? 'Keine Treffer für diesen Filter.'
      : 'Noch nichts gelernt. Sobald du im Popup auf "Ausfüllen" klickst, merkt sich die Erweiterung die Werte pro Portal.'));
    return summary;
  }
  shownGroups.forEach((g) => { list.appendChild(lmHostBlock(g)); });
  return summary;
}

// ---- Verdrahtung --------------------------------------------------------
async function lmReload(message) {
  lmState.store = await lmLoad();
  lmRender(lmState);
  if (message) lmSay(message);
}

function lmBoot() {
  const filter = document.getElementById("lmFilter");
  if (filter) {
    filter.addEventListener("input", () => {
      lmState.query = filter.value || "";
      lmRender(lmState);
    });
  }
  const reload = document.getElementById("lmReload");
  if (reload) reload.addEventListener("click", () => { lmReload("Neu geladen."); });

  const clearAll = document.getElementById("lmClearAll");
  const confirmBox = document.getElementById("lmClearConfirm");
  const yes = document.getElementById("lmClearYes");
  const no = document.getElementById("lmClearNo");
  if (clearAll && confirmBox) clearAll.addEventListener("click", () => { confirmBox.hidden = false; lmSay(""); });
  if (no && confirmBox) no.addEventListener("click", () => { confirmBox.hidden = true; lmSay("Abgebrochen - nichts gelöscht."); });
  if (yes) {
    yes.addEventListener("click", () => {
      if (confirmBox) confirmBox.hidden = true;
      lmMutate(lmClearAll(), "Alle gelernten Werte gelöscht. Die Erweiterung lernt ab jetzt wieder neu.");
    });
  }

  // Popup schreibt beim Ausfuellen -> Ansicht aktuell halten.
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !changes || !changes.learned) return;
      const v = changes.learned.newValue;
      lmState.store = v && typeof v === "object" ? v : {};
      lmRender(lmState);
    });
  }

  return lmReload();
}

// ---- Start / Export -----------------------------------------------------
// Im Browser (Extension) gibt es kein `module` -> es wird gestartet.
// Unter Node (Test-Harness) wird nur exportiert, nichts gebootet.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_PROFILE, LM_SOURCE_LEGACY, LM_SOURCE_KORREKTUR,
    lmNormalizeEntry, lmFlatten, lmFilter, lmCounts, lmCloneStore,
    lmDeleteEntry, lmDeleteHost, lmSaveEntry, lmClearAll, lmFormatTs,
    lmLoad, lmPersist, lmState, lmRender, lmEntryRow, lmHostBlock, lmBoot, lmReload, bootProfile
  };
} else {
  bootProfile();
  Promise.resolve()
    .then(lmBoot)
    .catch((e) => { lmSay("Gelernte Werte konnten nicht geladen werden: " + (e && e.message ? e.message : e)); });
}
