// src/services/carCatalogApi.js
const CQ_BASE = "https://www.carqueryapi.com/api/0.3/";

/**
 * JSONP real (script tag) para evitar CORS.
 * CarQuery devuelve: callbackName({...});
 */
function jsonp(params, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const cbName = `__cq_cb_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const url = new URL(CQ_BASE);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    url.searchParams.set("callback", cbName);

    let done = false;
    const cleanup = (script, timer) => {
      try {
        if (script && script.parentNode) script.parentNode.removeChild(script);
      } catch {}
      try {
        delete window[cbName];
      } catch {}
      if (timer) clearTimeout(timer);
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup(script, timer);
      reject(new Error("CarQuery timeout"));
    }, timeoutMs);

    window[cbName] = (data) => {
      if (done) return;
      done = true;
      cleanup(script, timer);
      resolve(data);
    };

    const script = document.createElement("script");
    script.src = url.toString();
    script.async = true;
    script.onerror = () => {
      if (done) return;
      done = true;
      cleanup(script, timer);
      reject(new Error("CarQuery JSONP error"));
    };

    document.body.appendChild(script);
  });
}

export const carCatalogApi = {
  async searchMakes(q) {
    const data = await jsonp({ cmd: "getMakes" });
    const items = Array.isArray(data?.Makes) ? data.Makes : [];

    const needle = (q || "").trim().toLowerCase();
    const filtered = needle
      ? items.filter((m) => String(m.make_display).toLowerCase().includes(needle))
      : items;

    return filtered.slice(0, 50).map((m) => ({
      label: m.make_display,
      value: m.make_id,
    }));
  },

  async searchModels(makeId, q) {
    if (!makeId) return [];
    const data = await jsonp({ cmd: "getModels", make: makeId });
    const items = Array.isArray(data?.Models) ? data.Models : [];

    const needle = (q || "").trim().toLowerCase();
    const filtered = needle
      ? items.filter((m) => String(m.model_name).toLowerCase().includes(needle))
      : items;

    return filtered.slice(0, 50).map((m) => ({
      label: m.model_name,
      value: m.model_name, // mantenemos label como valor (tu form lo usa así)
    }));
  },

  async searchTrims(makeId, modelName, q) {
    if (!makeId || !modelName) return [];
    const data = await jsonp({ cmd: "getTrims", make: makeId, model: modelName });
    const items = Array.isArray(data?.Trims) ? data.Trims : [];

    const needle = (q || "").trim().toLowerCase();

    // Armamos labels útiles (trim + year si viene)
    const mapped = items.map((t) => {
      const trim = (t.model_trim || "").trim();
      const year = (t.model_year || "").trim();
      const label = [trim, year].filter(Boolean).join(" • ");
      return { label: label || trim || year || "Sin versión", value: trim || label || year };
    });

    const filtered = needle
      ? mapped.filter((t) => String(t.label).toLowerCase().includes(needle))
      : mapped;

    // Uniq y limit
    const uniq = [];
    const seen = new Set();
    for (const it of filtered) {
      const k = it.value || it.label;
      if (!k || seen.has(k)) continue;
      seen.add(k);
      uniq.push(it);
      if (uniq.length >= 60) break;
    }
    return uniq;
  },
};
