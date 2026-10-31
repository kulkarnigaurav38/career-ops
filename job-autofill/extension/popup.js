// popup.js — Scan/Fill per On-Demand-Injection in ALLE Frames (iframe + Shadow DOM).
// Regeln + Gelerntes (NUR aus Korrekturen) + Gemini-Restfelder MIT Job-Kontext (Ref/Firma),
// lernt sofort beim Tippen (Debounce) lokal + im Answer-Sheet, Ref/PDF-Finder.
let fieldsCache = [];      // {gid, frameId, localId, fid, type, label, name, options?}
let map = {};              // gid -> value
let sources = {};          // gid -> Quelle
let chips = {};            // gid -> Chip-Element (fuer Update ohne Re-Render)
let host = "", pageUrl = "";
let job = null;            // {ref, company, role, sources?, mode}
let summary = "";          // letzte Scan-Zusammenfassung
const pending = {};        // gid -> Wert, der noch gelernt werden soll
const timers = {};         // gid -> Debounce-Timer
const pushed = {};         // gid -> zuletzt gelernter Wert (verhindert Doppel-POSTs)
const LEARN_DELAY = 500;

const SRC_COLOR = {
  "Regel": "#3f8f5f", "Gelernt": "#6a52c9", "Gelernt (alt)": "#a0611f", "Gemini": "#c9660b",
  "Korrektur": "#1F4E5F", "Korrektur -> gelernt": "#2e7d4f", "Korrektur -> nur lokal": "#8a6d1f",
  "Freitext (nicht gelernt)": "#8a6d1f", "geloescht": "#999", "leer": "#bbb",
};

function status(t) { document.getElementById("status").textContent = t; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
async function getProfile() { const { profile } = await chrome.storage.local.get("profile"); return profile || {}; }
async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t; }
async function bg(action, payload) { try { return await chrome.runtime.sendMessage({ action, payload }); } catch (e) { return { error: String(e) }; } }

// Speicher-Zugriffe serialisieren (mehrere Debounces koennen gleichzeitig feuern -> read-modify-write-Race)
let chain = Promise.resolve();
function serial(fn) { chain = chain.then(fn, fn); return chain; }

// Liest den Lern-Speicher und migriert ihn beim ersten Mal (alt: learned[host][label]="wert")
let lastMigration = null;
async function getLearned() {
  const { learned } = await chrome.storage.local.get("learned");
  const m = jafMigrateLearned(learned || {});
  lastMigration = m;
  if (m.changed) await chrome.storage.local.set({ learned: m.learned });
  return m.learned;
}

// ---- Diese Funktion wird IN JEDEM Frame ausgefuehrt (muss self-contained sein) ----
function scanFrame() {
  const TAG = "data-jaf-id";
  // Platzhalter wie "Mandatory" oder "- Please select -" sind KEINE Feldnamen. Frueher
  // wurde placeholder VOR der DOM-Suche geprueft, deshalb hiessen auf HRworks-Formularen
  // (nashtech) alle Felder "Mandatory" und die Regeln griffen bei keinem einzigen.
  const JUNK = /^(mandatory|pflichtfeld|required|erforderlich|optional|freiwillig|bitte ausw(ä|ae)hlen|please select|-+ ?please select ?-+|-+ ?bitte ausw(ä|ae)hlen ?-+|select|ausw(ä|ae)hlen|tt\.mm\.jjjj|dd\.mm\.yyyy|mm\/dd\/yyyy|jjjj|yyyy|z\.? ?b\.?|e\.? ?g\.?)$/i;
  const clean = (t) => String(t == null ? "" : t).replace(/\s+/g, " ").replace(/[\s:*]+$/g, "").trim();
  const real = (t) => {
    const c = clean(t);
    return c.length > 1 && c.length <= 80 && /\p{L}{2,}/u.test(c) && !JUNK.test(c);
  };

  function labelFor(el) {
    // 1) explizite Verknuepfung
    if (el.id) {
      try {
        const l = document.querySelector('label[for="' + (CSS.escape ? CSS.escape(el.id) : el.id) + '"]');
        if (l && real(l.innerText)) return clean(l.innerText);
      } catch (e) {}
    }
    // 2) umschliessendes <label>
    const wrap = el.closest && el.closest("label");
    if (wrap && real(wrap.innerText)) return clean(wrap.innerText);
    // 3) ARIA
    if (real(el.getAttribute("aria-label"))) return clean(el.getAttribute("aria-label"));
    const lb = el.getAttribute("aria-labelledby");
    if (lb) { const n = document.getElementById(lb); if (n && real(n.innerText)) return clean(n.innerText); }
    // 4) <label> VOR einem der Vorfahren. Icon-/input-group-Wrapper schieben das
    //    Label mehrere Ebenen nach oben - genau der nashtech-Fall.
    let n = el;
    for (let d = 0; d < 5 && n; d++, n = n.parentElement) {
      for (let sib = n.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.tagName === "LABEL" && real(sib.innerText)) return clean(sib.innerText);
      }
    }
    // 5) sonst der naechste kurze Text davor (nur flach, damit nicht das Label des
    //    VORHERIGEN Feldes gewonnen wird)
    n = el;
    for (let d = 0; d < 3 && n; d++, n = n.parentElement) {
      const sib = n.previousElementSibling;
      if (sib && !sib.querySelector("input, select, textarea") && real(sib.innerText) && clean(sib.innerText).length < 60) {
        return clean(sib.innerText);
      }
    }
    // 6) Platzhalter - nur wenn er wirklich etwas benennt
    if (real(el.placeholder)) return clean(el.placeholder);
    // 7) name/id nur, wenn es nach einem Wort aussieht ("firstName" ja, "4-55" nein)
    for (const v of [el.name, el.id]) {
      const c = clean(v);
      if (c && /^[A-Za-z][A-Za-z0-9_.\-\[\]]{2,}$/.test(c) && /[A-Za-z]{3,}/.test(c)) return c;
    }
    return "";
  }
  function collect(root, out) {
    try { root.querySelectorAll("input, textarea, select").forEach((e) => out.push(e)); } catch (e) {}
    try { root.querySelectorAll("*").forEach((e) => { if (e.shadowRoot) collect(e.shadowRoot, out); }); } catch (e) {}
  }
  function visible(el) { return !!(el.offsetParent !== null || (el.getClientRects && el.getClientRects().length)); }
  const els = []; collect(document, els);
  const fields = []; let i = 0; const radioGroup = {};
  els.forEach((el) => {
    const type = (el.type || el.tagName).toLowerCase();
    if (["hidden", "submit", "button", "image", "reset", "password"].indexOf(type) >= 0) return;
    if (type === "file") {                       // Upload-Felder getrennt einsammeln
      const lid = "f" + (i++); el.setAttribute(TAG, lid);
      fields.push({ localId: lid, type: "file", label: labelFor(el), name: el.name || "",
                    multiple: !!el.multiple, accept: el.accept || "" });
      return;
    }
    if (type !== "radio" && type !== "checkbox" && !visible(el)) return;
    if (type === "radio" && el.name && radioGroup[el.name]) {
      const lid = radioGroup[el.name]; el.setAttribute(TAG, lid);
      const g = fields.find((x) => x.localId === lid); if (g) g.options.push({ value: el.value, label: labelFor(el) }); return;
    }
    const lid = "f" + (i++); el.setAttribute(TAG, lid);
    if (type === "radio" && el.name) radioGroup[el.name] = lid;
    const f = { localId: lid, type: type, label: labelFor(el), name: el.name || "" };
    if (el.tagName.toLowerCase() === "select") f.options = Array.prototype.map.call(el.options, (o) => ({ value: o.value, label: (o.text || "").trim() }));
    else if (type === "radio" || type === "checkbox") f.options = [{ value: el.value, label: labelFor(el) }];
    fields.push(f);
  });
  return fields;
}

// ---- Fuellt einen Frame; laeuft IN diesem Frame (self-contained) ----
function fillFrame(subMap) {
  const TAG = "data-jaf-id";
  function findByTag(root, id, out) {
    try { root.querySelectorAll('[' + TAG + '="' + id + '"]').forEach((e) => out.push(e)); } catch (e) {}
    try { root.querySelectorAll("*").forEach((e) => { if (e.shadowRoot) findByTag(e.shadowRoot, id, out); }); } catch (e) {}
  }
  function setNative(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function hi(el) { el.style.transition = "outline .3s"; el.style.outline = "2px solid #1F4E5F"; setTimeout(() => { el.style.outline = ""; }, 2500); }
  let filled = 0;
  Object.keys(subMap).forEach((lid) => {
    const value = subMap[lid]; if (value == null || value === "") return;
    const els = []; findByTag(document, lid, els); if (!els.length) return;
    const first = els[0]; const tag = first.tagName.toLowerCase(); const type = (first.type || tag).toLowerCase(); const v = String(value).toLowerCase().trim();
    if (tag === "select") {
      const opt = Array.prototype.find.call(first.options, (o) => o.text.trim().toLowerCase() === v || o.value.toLowerCase() === v || o.text.trim().toLowerCase().indexOf(v) >= 0 || v.indexOf(o.text.trim().toLowerCase()) >= 0);
      if (opt) { first.value = opt.value; first.dispatchEvent(new Event("change", { bubbles: true })); hi(first); filled++; }
    } else if (type === "radio") {
      const t = els.find((r) => { const lbl = ((r.closest && r.closest("label") && r.closest("label").innerText) || r.getAttribute("aria-label") || r.value || "").toLowerCase(); return r.value.toLowerCase() === v || lbl.indexOf(v) >= 0; });
      if (t) { t.checked = true; t.dispatchEvent(new Event("change", { bubbles: true })); hi(t); filled++; }
    } else if (type === "checkbox") {
      const yes = ["ja", "yes", "true", "1", "on", "x", "akzeptiert", "zustimmen", "einverstanden"].indexOf(v) >= 0;
      first.checked = yes; first.dispatchEvent(new Event("change", { bubbles: true })); hi(first); filled++;
    } else { setNative(first, String(value)); hi(first); filled++; }
  });
  return filled;
}


// ---- Haengt eine Datei an; laeuft IN dem Frame (self-contained) ----------------------
// Chrome verbietet input.value = "/pfad", erlaubt aber input.files = DataTransfer.files.
// Fuer Dropzone-Portale (softgarden, Workday, d.vinci) wird zusaetzlich ein DragEvent gefeuert.
function attachFrame(localId, b64, name, mime, dropzone) {
  const TAG = "data-jaf-id";
  function findByTag(root, id, out) {
    try { root.querySelectorAll('[' + TAG + '="' + id + '"]').forEach((e) => out.push(e)); } catch (e) {}
    try { root.querySelectorAll("*").forEach((e) => { if (e.shadowRoot) findByTag(e.shadowRoot, id, out); }); } catch (e) {}
  }
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  const file = new File([buf], name, { type: mime });

  const els = []; findByTag(document, localId, els);
  const input = els[0];
  if (!input) return { ok: false, why: "Feld nicht gefunden" };

  const dt = new DataTransfer();
  dt.items.add(file);
  try {
    input.files = dt.files;
  } catch (e) {
    return { ok: false, why: "input.files nicht setzbar: " + e.message };
  }
  // React & Co. lauschen auf die nativen Events, nicht auf die Zuweisung
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  // Dropzone: viele ATS ignorieren das versteckte input und warten auf ein drop-Event
  if (dropzone) {
    const zone = input.closest("[class*=drop],[class*=Drop],[data-testid*=drop],form") || input.parentElement;
    if (zone) {
      for (const t of ["dragenter", "dragover", "drop"]) {
        const ev = new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt });
        zone.dispatchEvent(ev);
      }
    }
  }
  input.style.outline = "2px solid #1F4E5F";
  setTimeout(() => { input.style.outline = ""; }, 2500);
  return { ok: true, attached: input.files && input.files.length ? input.files[0].name : name };
}

// Upload-Slots bestehen auf vielen Portalen aus ZWEI Feldern: einem unsichtbaren
// <input type=file> (das echte Ziel) und einem sichtbaren Textfeld daneben, das nur
// den Dateinamen anzeigt. Beide tragen dasselbe Label und erzeugten je eine Zeile -
// einmal "leer", einmal "PDF". Das Textfeld gehoert dem Portal: es wird gesetzt, wenn
// die Datei gesetzt wird. Wir entfernen es aus der Liste und schreiben NIE hinein.
function dropUploadTwins(fields) {
  const norm = (x) => jafNormalize(String(x || "")).toLowerCase().replace(/[*:\s]+$/g, "").trim();
  const fileLabels = new Set(
    fields.filter((f) => f.type === "file").map((f) => norm(f.label)).filter(Boolean)
  );
  if (!fileLabels.size) return fields;
  return fields.filter((f) => {
    if (f.type === "file") return true;
    if (f.type === "textarea" || f.type === "select") return true;   // echte Antwortfelder
    return !fileLabels.has(norm(f.label));
  });
}

// ---- Schritt 2b: Dokumente AUFLOESEN (noch nicht anhaengen) -------------------------
// Ergebnis landet in docPlan und wird in der Feldliste angezeigt, damit vor dem
// Ausfuellen sichtbar ist, WELCHE Datei in welchen Upload-Slot geht.
let docPlan = {};        // fid -> { kind, as, source, size } | null

// EINE Stelle entscheidet, welches Dokument in welchen Slot gehoert - Anzeige
// (Schritt 2) und Anhaengen (Schritt 3) duerfen nie auseinanderlaufen.
function planUploads(uploads, byKind, ref) {
  const plan = {};
  const single = uploads.length === 1;
  const used = new Set();
  for (const f of uploads) {
    let kind = jafClassifyFile(f.label, f.name);
    // Genau ein Upload-Feld: das ist auch bei nichtssagendem Label der Lebenslauf.
    if (!kind && single) kind = jafDefaultKindForSingleInput();
    if (!kind) { plan[f.fid] = { skip: jafIsAmbiguousFileSlot(f.label, f.name) ? "ambiguous" : "unknown" }; continue; }
    if (used.has(kind)) { plan[f.fid] = { skip: "duplicate", kind }; continue; }
    if ((kind === "cv" || kind === "coverletter") && !ref) { plan[f.fid] = { skip: "noref", kind }; continue; }
    const d = byKind[kind];
    if (!d || !d.exists) { plan[f.fid] = { skip: "missing", kind }; continue; }
    used.add(kind);
    plan[f.fid] = { kind, as: d.as, source: d.picked || "", size: d.size || 0 };
  }
  return plan;
}

async function docCatalog(ref) {
  const cat = await bg("getDocs", { ref });
  const byKind = {};
  if (cat && Array.isArray(cat.docs)) for (const d of cat.docs) byKind[d.kind] = d;
  return byKind;
}

async function resolveDocs() {
  docPlan = {};
  const uploads = fieldsCache.filter((f) => f.type === "file");
  if (!uploads.length) return { n: 0, ok: 0 };

  const ref = job && job.ref ? job.ref : "";
  const byKind = await docCatalog(ref);      // ein Call fuer den ganzen Katalog
  const plan = planUploads(uploads, byKind, ref);

  const WHY = {
    ambiguous: "unspezifischer Slot - bleibt leer",
    unknown: "kein Dokument zugeordnet",
    duplicate: "schon belegt",
    noref: "(keine Bewerbung erkannt)",
    missing: "Datei fehlt",
  };
  let ok = 0;
  for (const f of uploads) {
    const pl = plan[f.fid];
    if (!pl || pl.skip) {
      // "hart" = wir WOLLTEN etwas anhaengen, konnten aber nicht -> rot markieren.
      // Sonst ist der Slot einfach nicht zuzuordnen und bleibt bewusst leer.
      const hard = pl && (pl.skip === "noref" || pl.skip === "missing");
      docPlan[f.fid] = null;
      map[f.fid] = hard ? (pl.skip === "noref" ? WHY.noref : `(${pl.kind}: Datei fehlt)`) : "";
      sources[f.fid] = hard ? "PDF fehlt" : "leer";
      continue;
    }
    const kb = pl.size ? ` · ${(pl.size / 1024).toFixed(0)} KB` : "";
    // Die QUELLDATEI anzeigen (z.B. "AXPB_LEBENSLAUF.pdf"), nicht den generischen
    // Upload-Namen - nur so ist zu sehen, dass wirklich DIESE Bewerbung genommen wird.
    map[f.fid] = `${pl.source || pl.as}${kb}`;
    sources[f.fid] = "PDF";
    docPlan[f.fid] = pl;
    ok++;
  }
  return { n: uploads.length, ok };
}

// ---- Dokumente an die Upload-Felder haengen -----------------------------------------
async function attachDocs() {
  const tab = await activeTab();
  // RE-SCAN vor dem Anhaengen. Upload-Felder sind oft an eine vorherige Antwort gekoppelt
  // (Randstad: "Ich habe einen Lebenslauf: Ja" blendet die Dropzone erst dann ein), d.h. beim
  // ersten Scan existierten sie noch gar nicht. Ohne Re-Scan haengen wir an nichts an.
  let uploads = fieldsCache.filter((f) => f.type === "file");
  try {
    const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: scanFrame });
    const fresh = [];
    (res || []).forEach((r) => {
      (r.result || []).forEach((f) => {
        if (f.type === "file") fresh.push({ ...f, frameId: r.frameId, fid: r.frameId + ":" + f.localId });
      });
    });
    if (fresh.length) {
      const before = uploads.length;
      uploads = fresh;
      // fieldsCache aktualisieren, damit spaetere Laeufe die neuen Felder kennen
      fieldsCache = dropUploadTwins(fieldsCache.filter((f) => f.type !== "file").concat(fresh));
      if (fresh.length !== before) status(`Upload-Felder nach dem Ausfuellen neu erkannt: ${fresh.length}`);
    }
  } catch (e) { /* Re-Scan fehlgeschlagen -> mit dem alten Stand weitermachen */ }
  if (!uploads.length) return { tried: 0, ok: 0, notes: [] };
  const ref = job && job.ref ? job.ref : "";
  const notes = [];
  let ok = 0, tried = 0;

  // Nach einem Re-Scan koennen die fids neu sein -> Plan frisch rechnen, mit
  // exakt derselben Funktion wie Schritt 2. Kein zweiter Satz Regeln.
  const byKind = await docCatalog(ref);
  const plan = planUploads(uploads, byKind, ref);
  docPlan = plan;

  const WHY = {
    ambiguous: "unspezifischer Sammel-Slot, bleibt leer",
    unknown: "kein Dokument zugeordnet",
    duplicate: "Dokument haengt schon",
    noref: "keine Bewerbung erkannt (Schritt 1)",
    missing: "Datei nicht gefunden",
  };

  const cache = {};                       // kind -> {name,type,b64,source,size}
  for (const f of uploads) {
    const pl = plan[f.fid];
    const slot = (f.label || f.name || "Upload").slice(0, 32);
    if (!pl || pl.skip) { notes.push(`? "${slot}" - ${WHY[pl && pl.skip] || "kein Dokument zugeordnet"}`); continue; }
    tried++;
    if (!cache[pl.kind]) {
      const r = await bg("getFile", { ref, kind: pl.kind });
      if (!r || r.error) { notes.push(`x ${pl.kind}: ${(r && r.error) || "Backend offline?"}`); continue; }
      cache[pl.kind] = r;
    }
    const doc = cache[pl.kind];
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id, frameIds: [Number(f.frameId)] },
        func: attachFrame, args: [f.localId, doc.b64, doc.name, doc.type, true],
      });
      const out = res && res[0] && res[0].result;
      if (out && out.ok) {
        ok++;
        // Quelldatei + Groesse mitschreiben, damit sichtbar ist, WELCHE Fassung
        // angehaengt wurde (komprimiert vs. Original).
        const kb = doc.size ? ` ${(doc.size / 1024).toFixed(0)} KB` : "";
        const src = doc.source && doc.source !== doc.name ? `  [${doc.source}]` : "";
        notes.push(`✓ ${doc.name}${kb} -> "${slot}"${src}`);
      } else notes.push(`x ${pl.kind}: ${(out && out.why) || "fehlgeschlagen"}`);
    } catch (e) { notes.push(`x ${pl.kind}: ${String(e).slice(0, 60)}`); }
  }
  return { tried, ok, notes };
}

// ---- UI-Bausteine, die es in popup.html nicht gibt (Job-Zeile, "uebernehmen") ----
const jobLine = document.createElement("div");
jobLine.id = "jobLine";
jobLine.style.cssText = "font-size:11px;color:#1F4E5F;background:#eef3f5;border-radius:5px;padding:4px 6px;margin:0 0 6px;display:none;";
document.getElementById("status").insertAdjacentElement("afterend", jobLine);

// Kleines Ref-Feld in der Job-Zeile: zeigt die erkannte Bewerbung und laesst sie
// korrigieren (4-stelliger Code). Ersetzt die alte Firmennamen-Suche.
function refBox() {
  const wrap = document.createElement("span");
  wrap.style.cssText = "display:inline-flex;gap:4px;align-items:center;margin-left:6px;";
  const inp = document.createElement("input");
  inp.value = job && job.ref ? job.ref : "";
  inp.placeholder = "REF";
  inp.maxLength = 4;
  inp.style.cssText = "width:52px;font-size:11px;padding:2px 4px;border:1px solid #9bb;border-radius:4px;text-transform:uppercase;";
  const apply = async () => {
    const v = (inp.value || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(v)) { status("Ref muss 4 Zeichen haben (z. B. AXPB)."); return; }
    if (job && job.ref === v) return;
    const r = await bg("findRef", { q: v });
    const hit = (r && r.hits || []).find((h) => h.ref === v);
    setJob(hit ? { ref: hit.ref, company: hit.company, role: hit.role } : { ref: v, company: "", role: "" }, "manuell");
    // Dokumente sofort neu aufloesen, damit die Liste die neue Bewerbung zeigt.
    if (fieldsCache.some((f) => f.type === "file")) { await resolveDocs(); render(); }
    status(`Bewerbung gesetzt: Ref ${v}${hit && hit.company ? " - " + hit.company : ""}`);
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") apply(); });
  inp.addEventListener("blur", apply);
  wrap.appendChild(inp);
  return wrap;
}

function showJob() {
  // Auch OHNE erkannte Bewerbung sichtbar bleiben - sonst gaebe es kein Feld,
  // in das man die Ref eintragen koennte.
  if (!job) {
    jobLine.textContent = "Keine Bewerbung erkannt - Ref eintragen:";
    jobLine.appendChild(refBox());
    jobLine.style.display = "block";
    return;
  }
  const parts = ["Bewerbung: Ref " + job.ref];
  if (job.company) parts.push(job.company);
  if (job.role) parts.push(job.role);
  let t = parts.join(" - ");
  // Woher die Zuordnung kommt, MUSS sichtbar sein: "per URL" ist exakt,
  // "geraten" kam aus dem Seitentitel und kann danebenliegen.
  if (job.mode === "manuell") t += " (manuell)";
  else if (job.matchedBy === "url") t += job.precision === "id" ? " (per URL ✓)" : " (per URL)";
  else if (job.matchedBy === "text") t += " (aus Seitentitel geraten - bitte pruefen)";
  if (job.sources && job.sources.length) t += " · Quellen: " + job.sources.join(", ");
  jobLine.textContent = t;
  jobLine.appendChild(refBox());
  jobLine.style.display = "block";
}
function setJob(j, mode) { job = j ? { ...j, mode: mode || "auto" } : null; showJob(); persistJob().catch(() => {}); }
// Mehrdeutige Treffer als anklickbare Liste zeigen. Frueher stand hier nur
// "nicht eindeutig - Firmennamen korrigieren", d.h. der Nutzer musste raten und tippen.
function offerCandidates(hits) {
  jobLine.textContent = "";
  jobLine.style.display = "block";
  const head = document.createElement("div");
  head.textContent = "Welche Bewerbung ist das?";
  head.style.cssText = "margin-bottom:4px;font-weight:600;";
  jobLine.appendChild(head);
  jobLine.appendChild(refBox());

  hits.forEach((h) => {
    const b = document.createElement("button");
    b.className = "sec";
    b.style.cssText = "display:block;width:100%;text-align:left;margin:2px 0;font-size:11px;padding:3px 5px;";
    const bits = [`Ref ${h.ref}`];
    if (h.company) bits.push(h.company);
    if (h.role) bits.push(h.role.slice(0, 44));
    b.textContent = (h.pdfsReady ? "" : "(keine PDFs) ") + bits.join(" - ");
    b.title = `${h.company || ""} - ${h.role || ""}${h.date ? " - " + h.date : ""}`;
    b.onclick = async () => {
      setJob({ ref: h.ref, company: h.company, role: h.role }, "manuell");
      // PDFs sofort auf die gewaehlte Bewerbung umstellen.
      if (fieldsCache.some((f) => f.type === "file")) { await resolveDocs(); render(); }
      status(`Bewerbung gesetzt: Ref ${h.ref} - ${h.company || ""}`);
    };
    jobLine.appendChild(b);
  });
}

function jobHint(t) { jobLine.textContent = t; jobLine.style.display = "block"; }
// Schluessel fuer die gemerkte Bewerbung. FRUEHER war das der blosse Hostname - damit
// galt eine auf EINEM LinkedIn-Job manuell gesetzte Ref fuer ALLE LinkedIn-Jobs und es
// wurde der falsche Lebenslauf angehaengt. Jetzt zaehlt die konkrete Seite.
// Zu spezifisch ist harmlos (dann laeuft autoRef erneut), zu unspezifisch ist der Bug.
const URL_JUNK = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "src", "source", "trk", "trackingid", "refid", "originalsubdomain",
  "position", "pagenum", "ebp", "lipi", "licu", "midtoken", "ref",
  "gh_src", "recommendedflavor", "jobdbpvid", "l", "savedsearchid",
]);
function jobStoreKey(u) {
  try {
    const x = new URL(u || pageUrl || "");
    const h = x.hostname.toLowerCase().replace(/^www\./, "");
    const params = [...x.searchParams.entries()]
      .filter(([k]) => !URL_JUNK.has(k.toLowerCase()))
      .map(([k, v]) => `${k.toLowerCase()}=${v.toLowerCase()}`)
      .sort();
    const p = x.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    return h + p + (params.length ? "?" + params.join("&") : "");
  } catch { return host || ""; }
}

// zuletzt gewaehlte Bewerbung pro SEITE merken (Popup verliert sonst jeden State beim Schliessen)
async function persistJob() {
  const key = jobStoreKey();
  if (!key) return;
  const { jobs } = await chrome.storage.local.get("jobs"); const all = jobs || {};
  // Alt-Eintraege aus der Host-Ära entfernen: reine Hostnamen ohne "/" koennen nie
  // wieder getroffen werden und wuerden nur wachsen.
  for (const k of Object.keys(all)) if (!k.includes("/")) delete all[k];
  if (job) all[key] = { ...job, savedAt: Date.now() }; else delete all[key];
  await chrome.storage.local.set({ jobs: all });
}
async function storedJob() {
  const { jobs } = await chrome.storage.local.get("jobs");
  return (jobs || {})[jobStoreKey()] || null;
}

function setChip(fid, src) {
  sources[fid] = src;
  const el = chips[fid]; if (!el) return;
  el.textContent = src;
  el.className = "src " + String(src).replace(/[^\w]+/g, "_");
  el.style.background = SRC_COLOR[src] || "#777";
  el.style.color = "#fff";
}

function render() {
  const box = document.getElementById("list");
  box.innerHTML = ""; chips = {};
  fieldsCache.forEach((f) => {
    const row = document.createElement("div"); row.className = "row";
    const lbl = document.createElement("div"); lbl.className = "lbl";
    const name = document.createElement("span"); name.textContent = f.label || f.name || f.localId;
    const chip = document.createElement("span"); chip.className = "src";
    lbl.appendChild(name); lbl.appendChild(chip);
    const inp = document.createElement("input"); inp.className = "val"; inp.value = map[f.fid] || "";
    if (f.type === "file") {
      // Upload-Zeile: zeigt die aufgeloeste PDF, ist aber nicht editierbar und
      // wird nie gelernt - der Wert ist ein Dateiname, keine Formularantwort.
      inp.readOnly = true;
      const plan = docPlan[f.fid];
      if (plan && plan.as) inp.title = "wird hochgeladen als: " + plan.as;
      row.appendChild(lbl); row.appendChild(inp); box.appendChild(row);
      chips[f.fid] = chip; setChip(f.fid, sources[f.fid] || "leer");
      return;
    }
    // Tippen = Korrektur -> nach LEARN_DELAY lernen (lokal + Answer-Sheet)
    inp.addEventListener("input", () => { map[f.fid] = inp.value; setChip(f.fid, "Korrektur"); queueLearn(f, inp.value); });
    inp.addEventListener("change", () => { flushField(f).catch(() => {}); });
    row.appendChild(lbl); row.appendChild(inp); box.appendChild(row);
    chips[f.fid] = chip; setChip(f.fid, sources[f.fid] || "leer");
  });
}

// ---- Lernen: NUR Korrekturen, nie Regel/Gelernt/Gemini, nie JD-Freitext ----
function queueLearn(f, value) {
  pending[f.fid] = value;
  clearTimeout(timers[f.fid]);
  timers[f.fid] = setTimeout(() => { flushField(f).catch(() => {}); }, LEARN_DELAY);
}
async function flushField(f) {
  clearTimeout(timers[f.fid]); delete timers[f.fid];
  if (!(f.fid in pending)) return;
  const v = pending[f.fid]; delete pending[f.fid];
  const r = await learnField(f, v);
  const label = f.label || f.name || f.localId;
  if (r.removed) { setChip(f.fid, "geloescht"); status(`Gelernten Wert für "${label}" gelöscht.`); return; }
  if (r.reason === "Freitext") { setChip(f.fid, "Freitext (nicht gelernt)"); status(`"${label}" ist JD-spezifischer Freitext - wird bewusst NICHT gelernt.`); return; }
  if (r.reason) { setChip(f.fid, "Korrektur"); return; }
  if (r.dup) { return; }
  if (r.sheet) { setChip(f.fid, "Korrektur -> gelernt"); status(`Gelernt: "${label}" · Answer-Sheet aktualisiert.`); }
  else { setChip(f.fid, "Korrektur -> nur lokal"); status(`Gelernt: "${label}" · nur lokal - Answer-Sheet NICHT aktualisiert (${r.sheetError || "Backend offline?"}).`); }
}
function flushAll() { return Promise.all(fieldsCache.filter((f) => f.fid in pending).map((f) => flushField(f).catch(() => {}))); }

// value leer + vorhandener Eintrag -> Eintrag loeschen (Weg, um vergiftete Werte loszuwerden)
function learnField(f, value) {
  return serial(async () => {
    const label = f.label || f.name || "";
    const key = jafLearnKey(label);
    if (!host || !key) return { reason: "kein Host/Label" };
    const v = String(value == null ? "" : value);
    const store = await getLearned();
    const bucket = store[host] = store[host] || {};
    if (!v.trim()) {
      if (bucket[key]) {
        delete bucket[key]; delete pushed[f.fid];
        await chrome.storage.local.set({ learned: store });
        // Auch im Answer-Sheet loeschen: sonst ueberlebt die vergiftete Zeile in Abschnitt 18
        // und wird Gemini bei jedem weiteren /map erneut als massgeblich untergeschoben,
        // waehrend die UI "geloescht" meldet.
        const del = await bg("saveAnswers", { entries: [{ label: jafNormalize(label), host, remove: true }] });
        return { removed: true, sheet: !!(del && !del.error), sheetError: del && del.error ? String(del.error).slice(0, 60) : "" };
      }
      return { reason: "leer" };
    }
    if (!jafIsLearnable(label, f.type, v)) return { reason: "Freitext" };
    if (pushed[f.fid] === v) return { dup: true };
    bucket[key] = { value: v, ts: Date.now(), source: "Korrektur" };
    await chrome.storage.local.set({ learned: store });   // lokal lernen gelingt auch offline
    const entry = { label: jafNormalize(label), value: v, host, type: f.type };
    // Firmenname kommt jetzt aus der erkannten Bewerbung, nicht mehr aus einem Eingabefeld.
    const comp = (job && job.company) || "";
    if (comp) entry.company = comp;
    if (job && job.ref) entry.ref = job.ref;
    const resp = await bg("saveAnswers", { entries: [entry] });
    const ok = !!(resp && !resp.error && typeof resp.written === "number");
    if (ok) pushed[f.fid] = v;                            // nur erfolgreiche Pushes gelten als erledigt (offline -> spaeter erneut)
    return { sheet: ok, sheetError: resp && resp.error ? String(resp.error).slice(0, 60) : "" };
  });
}

// ---- Firmen-/Ref-Erkennung ----

// Laeuft IM Tab: sammelt die Textsignale, die die Stelle identifizieren.
// Auf ATS-Portalen (pi-asp, softgarden, Personio, ...) heisst der Tab-Titel oft nur
// "Bewerber Web" o.ae. - die Stellenbezeichnung steht dann nur im Seiteninhalt.
function scrapeJobSignals() {
  const out = [];
  const push = (v) => {
    const t = String(v || "").replace(/\s+/g, " ").trim();
    if (t && t.length > 2 && t.length < 300 && !out.includes(t)) out.push(t);
  };
  const meta = (sel, attr) => {
    const el = document.querySelector(sel);
    return el ? el.getAttribute(attr || "content") : "";
  };

  // Reihenfolge = Aussagekraft.
  push(meta('meta[property="og:title"]'));
  push(meta('meta[name="twitter:title"]'));
  push(meta('meta[property="og:site_name"]'));
  // "Bewerbung auf: <Stelle>" / "Application for: <role>" - der Klassiker auf ATS-Seiten.
  const body = document.body ? document.body.innerText || "" : "";
  const m = /(?:bewerbung\s*(?:auf|für|fuer)|application\s*(?:for|to))\s*:?\s*([^\n]{5,160})/i.exec(body);
  if (m) push(m[1]);
  for (const h of document.querySelectorAll("h1, h2")) { push(h.innerText); if (out.length > 10) break; }
  push(meta('meta[name="description"]'));
  push(document.title);
  // Firmenname steckt auf Logo-lastigen Seiten oft nur im alt-Text.
  for (const img of document.querySelectorAll('img[alt]')) {
    const a = img.getAttribute("alt") || "";
    if (/logo|gruppe|group|gmbh|\bag\b/i.test(a)) push(a);
    if (out.length > 14) break;
  }
  return out.slice(0, 14).join(" · ").slice(0, 3000);
}

// Fallback, wenn die URL unbekannt ist. Deutsche Stellentitel lauten fast immer
// "<Rolle> | <Firma>" oder "<Rolle> - <Firma>", die Firma steht also HINTEN.
// Frueher wurde stur das erste Segment genommen (-> "Junior API Manager*in") und an
// Bindestrichen INNERHALB von Namen getrennt (-> "MD" aus "MD-IT GmbH").
const TITLE_NOISE = /^(stellenangebot|stellenanzeige|jobs?|karriere|career|bewerbung|apply|job ?details?|home|willkommen)\b/i;
function companyGuess(tab) {
  // Nur an " - " / " | " mit Leerzeichen trennen: "MD-IT" bleibt dadurch heil.
  const segs = (tab.title || "")
    .split(/\s[|–—·]\s|\s-\s|\s:\s/)
    .map((x) => x.trim())
    .filter((x) => x && x.length < 60 && !TITLE_NOISE.test(x));
  const PORTAL = /^(linkedin|xing|indeed|stepstone|monster|glassdoor|arbeitsagentur|jobbörse|jobboerse)$/i;
  const real = segs.filter((x) => !PORTAL.test(x));
  if (real.length) {
    // Rechtsform schlaegt Position: "MD-IT GmbH - Full-Stack Entwickler" hat die Firma
    // vorn, "Rolle | Firma" hinten. Ein "GmbH/AG/SE/..." entscheidet eindeutig.
    const LEGAL = /\b(gmbh|ag|se|kg|mbh|ohg|e\.?\s?v|ug|inc|ltd|llc|plc|b\.?v|n\.?v|s\.?a|group|gruppe|holding|& ?co)\b\.?/i;
    const byLegal = real.find((x) => LEGAL.test(x));
    if (byLegal) return byLegal;
    return real[real.length - 1];      // sonst: letztes Segment ist meist die Firma
  }
  // Host als letzte Rettung: zweitletztes Label ("jobs.union-investment.de" -> union-investment).
  const labels = (host || "").replace(/^www\./, "").split(".").filter(Boolean);
  const GENERIC = new Set(["jobs", "job", "karriere", "career", "careers", "bewerbung", "apply", "recruiting", "stellen"]);
  const pick = labels.slice(0, -1).reverse().find((l) => l.length > 2 && !GENERIC.has(l.toLowerCase()));
  return pick || "";
}
// eindeutig = hoechster Score, >= 2 (voller Firmenname kommt vor) und nur EIN Ref
function strongHits(hits) {
  const byRef = {};
  (hits || []).forEach((h) => { if (!byRef[h.ref] || byRef[h.ref].score < h.score) byRef[h.ref] = h; });
  const list = Object.keys(byRef).map((k) => byRef[k]);
  const max = list.reduce((m, h) => Math.max(m, h.score || 0), 0);
  return list.filter((h) => (h.score || 0) >= 2 && (h.score || 0) === max);
}
// Reihenfolge ist Absicht: die URL der offenen Seite ist eindeutig, der aus dem
// Seitentitel geratene Firmenname nicht. Deshalb erst URL, dann Text.
// Holt die Textsignale aus dem Tab (Stellenbezeichnung, Firma, Ueberschriften).
async function pageSignals(tabId) {
  try {
    const res = await chrome.scripting.executeScript({ target: { tabId }, func: scrapeJobSignals });
    return (res && res[0] && res[0].result) || "";
  } catch { return ""; }
}

// Reihenfolge ist Absicht: die URL der offenen Seite ist eindeutig; sonst entscheidet
// der TEXT der Seite (Stellenbezeichnung + Firma), nicht der oft nichtssagende Tab-Titel.
async function autoRef(q, tabId) {
  const text = tabId ? await pageSignals(tabId) : "";
  const r = await bg("findRef", { q: q || "", url: pageUrl || "", text });
  if (!r || r.error || !r.hits) return null;

  // 1) URL-Treffer: exakt.
  if (r.matchedBy === "url" && r.hits.length === 1) {
    const h = r.hits[0];
    return { ref: h.ref, company: h.company, role: h.role, matchedBy: "url", precision: h.precision };
  }

  // 2) Texttreffer - nur uebernehmen, wenn das Backend ihn als eindeutig meldet.
  if (r.confident && r.hits.length) {
    const h = r.hits[0];
    return { ref: h.ref, company: h.company, role: h.role, matchedBy: "text" };
  }

  // 3) Mehrdeutig: die Kandidaten ANBIETEN statt den Nutzer tippen zu lassen.
  if (r.hits.length) offerCandidates(r.hits.slice(0, 4));
  return null;
}
// ---- Schritt 1: Scannen ----
async function doScan() {
  const tab = await activeTab();
  try { host = new URL(tab.url).hostname; pageUrl = tab.url; } catch { host = ""; pageUrl = ""; }
  Object.keys(timers).forEach((k) => { clearTimeout(timers[k]); delete timers[k]; });
  Object.keys(pending).forEach((k) => delete pending[k]);
  Object.keys(pushed).forEach((k) => delete pushed[k]);

  // Firmenname wird nur noch INTERN als zusaetzliches Suchwort benutzt - kein Eingabefeld mehr.
  const guess = companyGuess(tab);

  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: scanFrame });
  } catch (e) {
    status("Kann diese Seite nicht scannen (geschuetzte Seite?). Fehler: " + e.message); return;
  }
  fieldsCache = [];
  (results || []).forEach((r) => {
    const fid = r.frameId;
    (r.result || []).forEach((f) => { fieldsCache.push({ ...f, frameId: fid, gid: fid + ":" + f.localId, fid: fid + ":" + f.localId }); });
  });
  // Doppelzeilen (Anzeige-Textfeld neben dem echten Upload) entfernen.
  const beforeTwins = fieldsCache.length;
  fieldsCache = dropUploadTwins(fieldsCache);
  const twins = beforeTwins - fieldsCache.length;

  const profile = await getProfile();
  const rm = ruleMap(fieldsCache, profile); // nutzt f.fid + f.label
  map = { ...rm.matched }; sources = { ...rm.sources };

  // Pass 1b: Gelerntes. Nur Korrekturen zaehlen als vertrauenswuerdig; Alt-Eintraege werden
  // sichtbar als "Gelernt (alt)" markiert, JD-Freitext-Altwerte werden gar nicht erst angewendet.
  const store = await getLearned();
  const forHost = store[host] || {};
  let nLearned = 0, nLegacy = 0, nFreetext = 0;
  fieldsCache.forEach((f) => {
    const key = jafLearnKey(f.label || f.name || "");
    const e = key ? jafReadEntry(forHost[key]) : null;
    if (!e) return;
    if (jafIsFreeText(f.label || f.name || "", f.type, e.value)) { nFreetext++; return; }
    map[f.fid] = e.value;
    const alt = !jafIsCorrection(e);
    sources[f.fid] = alt ? "Gelernt (alt)" : "Gelernt";
    nLearned++; if (alt) nLegacy++;
  });

  window._unmatched = fieldsCache.filter((f) => map[f.fid] == null || map[f.fid] === "");
  render();
  const frames = (results || []).filter((r) => (r.result || []).length).length;
  if (!fieldsCache.length) { status("0 Felder gefunden. Lade die Seite neu, oder das Formular liegt hinter Login/Consent — dann erst durchklicken."); return; }

  const mig = lastMigration && lastMigration.migrated ? `, ${lastMigration.migrated} Alt-Einträge migriert` : "";
  const l = nLearned ? `, ${nLearned} gelernt${nLegacy ? ` (davon ${nLegacy} alt/ungeprüft)` : ""}` : "";
  const ft = nFreetext ? ` · ${nFreetext} Freitext-Altwert(e) ignoriert` : "";
  const tw = twins ? ` · ${twins} Upload-Doppelzeile(n) ausgeblendet` : "";
  summary = `${fieldsCache.length} Felder aus ${frames} Frame(s) · ${Object.keys(rm.matched).length} per Regel${l}${ft}${mig}${tw} · ${window._unmatched.length} offen.`;
  status(summary);

  // Ref automatisch aufloesen; eine frueher manuell gesetzte Bewerbung fuer diesen Host gewinnt.
  job = null; showJob();
  const prev = await storedJob();
  if (prev && prev.mode === "manuell") { setJob(prev, "manuell"); return; }
  const j = await autoRef(guess, tab.id);
  if (j) setJob(j, "auto"); else if (prev) setJob(prev, prev.mode);
}

// ---- Schritt 2: Gemini-Restfelder (mit Job-Kontext) ----
async function doLLM() {
  const unmatched = (window._unmatched || []).map((f) => ({ fid: f.fid, label: f.label, type: f.type, options: f.options }));
  if (!unmatched.length) { status("Keine offenen Felder für die KI."); return; }
  const profile = await getProfile();
  // Auch URL + Seitentext mitschicken: dann kann das Backend die Bewerbung selbst
  // aufloesen, wenn Schritt 1 sie (noch) nicht erkannt hat.
  const tab0 = await activeTab();
  const context = {
    ref: job && job.ref ? job.ref : null,
    company: (job && job.company) || "",
    host, url: pageUrl,
    text: await pageSignals(tab0.id),
  };
  status("Gemini ordnet die Restfelder zu …");
  const resp = await bg("llmMap", { profile, fields: unmatched, context });
  if (resp && resp.map) {
    Object.entries(resp.map).forEach(([fid, val]) => { map[fid] = val; sources[fid] = "Gemini"; });
    window._unmatched = fieldsCache.filter((f) => map[f.fid] == null || map[f.fid] === "");
    render();
    // eine gesetzte Bewerbung wird vom Backend nicht ueberschrieben - nur ergaenzt (sources)
    if (resp.job && resp.job.ref) {
      if (!job) setJob({ ref: resp.job.ref, company: resp.job.company, role: resp.job.role, sources: resp.job.sources || [] }, "auto");
      else { job.sources = resp.job.sources || job.sources; if (!job.company && resp.job.company) job.company = resp.job.company; showJob(); }
    }
    const src = resp.job && resp.job.sources && resp.job.sources.length ? ` · Quellen: ${resp.job.sources.join(", ")}` : " · Quellen: nur Profil/Answer-Sheet (keine Job-Daten gefunden)";
    const sheet = resp.usedSheet === false ? " · Answer-Sheet fehlt!" : "";
    // Dokumente jetzt aufloesen - sie erscheinen als eigene Zeilen in der Liste.
    const doc = await resolveDocs();
    render();
    const dm = doc.n ? ` · ${doc.ok}/${doc.n} Upload-Feld(er) mit PDF belegt` : "";
    status(`Gemini hat ${Object.keys(resp.map).length} Felder ergänzt${src}${sheet}${dm}. Bitte prüfen — Gemini-Werte werden NICHT gelernt.`);
  } else { status("KI-Fehler: " + ((resp && resp.error) || "Backend nicht erreichbar? (:8787)")); }
}

// ---- Schritt 3: Ausfuellen (lernt NUR die Korrekturen) ----
async function doFill() {
  await flushAll();
  const tab = await activeTab();
  const perFrame = {};
  fieldsCache.forEach((f) => {
    if (f.type === "file") return;                 // Uploads laufen ueber attachDocs(), nicht ueber Text-Fill
    const v = map[f.fid]; if (v != null && v !== "") { (perFrame[f.frameId] = perFrame[f.frameId] || {})[f.localId] = v; }
  });
  let filled = 0;
  for (const [frameId, sub] of Object.entries(perFrame)) {
    try {
      const r = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [Number(frameId)] }, func: fillFrame, args: [sub] });
      filled += (r && r[0] && r[0].result) || 0;
    } catch (e) {}
  }
  // Lernen: ausschliesslich vom Nutzer getippte Werte ("Korrektur*"), nie Regel/Gelernt/Gemini.
  let learned = 0, sheet = 0, skipped = 0;
  for (const f of fieldsCache) {
    if (!String(sources[f.fid] || "").startsWith("Korrektur")) continue;
    const v = map[f.fid];
    if (!jafIsLearnable(f.label || f.name || "", f.type, v)) { skipped++; continue; }
    const r = await learnField(f, v);
    if (r.dup) { learned++; continue; }
    if (r.reason) { if (r.reason === "Freitext") skipped++; continue; }
    learned++; if (r.sheet) sheet++;
    setChip(f.fid, r.sheet ? "Korrektur -> gelernt" : "Korrektur -> nur lokal");
  }
  const l = learned ? ` ${learned} Korrektur(en) gelernt${sheet ? `, ${sheet} davon neu ins Answer-Sheet` : ""}.` : " Keine Korrekturen zu lernen.";
  const s = skipped ? ` ${skipped} Freitext-Feld(er) bewusst nicht gelernt.` : "";
  status(`${filled} Felder ausgefüllt.${l}${s} NICHTS wurde abgeschickt — bitte prüfen und selbst absenden.`);
  // Dokumente anhaengen (Text zuerst, dann Uploads). Anhaengen ist NICHT abschicken.
  const att = await attachDocs();
  if (att.tried || att.notes.length) {
    const box = document.getElementById("docs");
    if (box) box.innerHTML = '<div class="hit"><b>Anhänge</b><br>' + att.notes.map((n) => escapeHtml(n)).join("<br>") + "</div>";
    render();   // Upload-Zeilen zeigen jetzt den tatsaechlich angehaengten Stand
    status(`${filled} Felder ausgefüllt, ${att.ok}/${att.tried} Dokumente angehängt.${l}${s} ` +
           `NICHTS wurde abgeschickt — bitte prüfen und selbst absenden.`);
  }
}

// offene Lernvorgaenge noch wegschreiben, wenn das Popup schliesst (best effort)
window.addEventListener("pagehide", () => { flushAll(); });

document.getElementById("scan").onclick = doScan;
document.getElementById("llm").onclick = doLLM;
document.getElementById("fill").onclick = doFill;
