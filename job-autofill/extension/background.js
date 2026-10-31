// background.js (Service Worker) — Bruecke zum lokalen Backend (Claude-Mapping + Ref-Suche).
const BASE = "http://localhost:8787";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "llmMap") {
    fetch(`${BASE}/map`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload),
    })
      .then((r) => r.json()).then((d) => sendResponse(d))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.action === "saveAnswers") {
    // schreibt Korrekturen in career-ops/config/application-answers.md (Abschnitt 18)
    fetch(`${BASE}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload),
    })
      .then((r) => r.json()).then((d) => sendResponse(d))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }

  // ---- Dokumente: Bytes aus dem Backend holen (Chrome verbietet input.value = Pfad,
  // erlaubt aber ein File-Objekt aus dem Speicher). Base64, weil sendMessage strukturierte
  // Binaerdaten nicht zuverlaessig transportiert.
  if (msg.action === "getDocs") {
    const q = msg.payload && msg.payload.ref ? `?ref=${encodeURIComponent(msg.payload.ref)}` : "";
    fetch(`${BASE}/docs${q}`)
      .then((r) => r.json()).then((d) => sendResponse(d))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.action === "getFile") {
    const { ref, kind } = msg.payload || {};
    fetch(`${BASE}/file?kind=${encodeURIComponent(kind)}&ref=${encodeURIComponent(ref || "")}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
        const name = r.headers.get("X-Upload-Filename") || `${kind}.pdf`;
        const type = r.headers.get("Content-Type") || "application/octet-stream";
        // Die tatsaechlich gewaehlte Quelldatei (z.B. "..._compressed (1).pdf"),
        // damit im Popup sichtbar ist, welche Fassung hochgeht.
        let source = "";
        try { source = decodeURIComponent(r.headers.get("X-Source-File") || ""); } catch { source = ""; }
        const buf = new Uint8Array(await r.arrayBuffer());
        let bin = ""; const CH = 0x8000;
        for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
        sendResponse({ name, type, source, b64: btoa(bin), size: buf.length });
      })
      .catch((e) => sendResponse({ error: String(e && e.message ? e.message : e) }));
    return true;
  }
  if (msg.action === "stageDocs") {
    fetch(`${BASE}/stage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(msg.payload) })
      .then((r) => r.json()).then((d) => sendResponse(d))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (msg.action === "findRef") {
    // URL der offenen Seite mitschicken: das Backend matcht sie exakt gegen
    // pipeline.md und muss den Firmennamen gar nicht erst raten.
    const p = msg.payload || {};
    const qs = new URLSearchParams();
    if (p.q) qs.set("q", p.q);
    if (p.url) qs.set("url", p.url);
    if (p.text) qs.set("text", p.text);
    fetch(`${BASE}/ref?` + qs.toString())
      .then((r) => r.json()).then((d) => sendResponse(d))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
});
