// content.js — scannt sichtbare Formularfelder und fuellt sie (sendet NIE ab).
(() => {
  const TAG = "data-jaf-id";

  function labelFor(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l && l.innerText.trim()) return l.innerText.trim();
    }
    const wrap = el.closest("label");
    if (wrap && wrap.innerText.trim()) return wrap.innerText.trim();
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label").trim();
    const lb = el.getAttribute("aria-labelledby");
    if (lb) { const n = document.getElementById(lb); if (n && n.innerText) return n.innerText.trim(); }
    if (el.placeholder) return el.placeholder.trim();
    const prev = el.previousElementSibling;
    if (prev && prev.innerText && prev.innerText.trim().length < 60) return prev.innerText.trim();
    return el.name || el.id || "";
  }

  function isVisible(el) {
    return !!(el.offsetParent !== null || el.getClientRects().length);
  }

  function scan() {
    const fields = [];
    let i = 0;
    const radioGroupFid = {};
    document.querySelectorAll("input, textarea, select").forEach((el) => {
      const type = (el.type || el.tagName).toLowerCase();
      if (["hidden","submit","button","image","reset","file","password"].includes(type)) return;
      if (type !== "radio" && type !== "checkbox" && !isVisible(el)) return;

      if (type === "radio" && el.name && radioGroupFid[el.name]) {
        const fid = radioGroupFid[el.name];
        el.setAttribute(TAG, fid);
        const g = fields.find((x) => x.fid === fid);
        if (g) g.options.push({ value: el.value, label: labelFor(el) });
        return;
      }
      const fid = "f" + (i++);
      el.setAttribute(TAG, fid);
      if (type === "radio" && el.name) radioGroupFid[el.name] = fid;

      const f = { fid, type, label: labelFor(el), name: el.name || "", id: el.id || "" };
      if (el.tagName.toLowerCase() === "select") {
        f.options = Array.from(el.options).map((o) => ({ value: o.value, label: (o.text || "").trim() }));
      } else if (type === "radio" || type === "checkbox") {
        f.options = [{ value: el.value, label: labelFor(el) }];
      }
      fields.push(f);
    });
    return fields;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function highlight(el) {
    el.style.transition = "outline 0.3s";
    el.style.outline = "2px solid #1F4E5F";
    setTimeout(() => { el.style.outline = ""; }, 2500);
  }

  function fill(map) {
    let filled = 0;
    Object.entries(map).forEach(([fid, value]) => {
      if (value == null || value === "") return;
      const els = document.querySelectorAll(`[${TAG}="${fid}"]`);
      if (!els.length) return;
      const first = els[0];
      const tag = first.tagName.toLowerCase();
      const type = (first.type || tag).toLowerCase();
      const v = String(value).toLowerCase().trim();

      if (tag === "select") {
        const opt = Array.from(first.options).find(
          (o) => o.text.trim().toLowerCase() === v || o.value.toLowerCase() === v ||
                 o.text.trim().toLowerCase().includes(v) || v.includes(o.text.trim().toLowerCase())
        );
        if (opt) { first.value = opt.value; first.dispatchEvent(new Event("change", { bubbles: true })); highlight(first); filled++; }
      } else if (type === "radio") {
        const target = Array.from(els).find((r) => {
          const lbl = (r.closest("label")?.innerText || r.getAttribute("aria-label") || r.value || "").toLowerCase();
          return r.value.toLowerCase() === v || lbl.includes(v) || v.includes(lbl.trim());
        });
        if (target) { target.checked = true; target.dispatchEvent(new Event("change", { bubbles: true })); highlight(target); filled++; }
      } else if (type === "checkbox") {
        const yes = ["ja","yes","true","1","on","x","akzeptiert","zustimmen"].includes(v);
        first.checked = yes; first.dispatchEvent(new Event("change", { bubbles: true })); highlight(first); filled++;
      } else {
        setNativeValue(first, String(value)); highlight(first); filled++;
      }
    });
    return filled;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === "scan") sendResponse({ fields: scan() });
    else if (msg.action === "fill") sendResponse({ filled: fill(msg.map || {}) });
    return true;
  });
})();
