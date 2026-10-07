// netlify/functions/lib/capi.js
// Helpers compartidos: hash SHA256, normalización, Conversions API y audiencia personalizada.
// Vive en /lib para que Netlify NO lo trate como una función pública.

const crypto = require("crypto");

const GRAPH = "https://graph.facebook.com/v21.0";
const AUDIENCE_NAME = "Agendaron sesión - Estudio Brumar";

const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v)).digest("hex");

const normEmail = (e) => (e || "").trim().toLowerCase();

// Solo dígitos, con código de país. Corrige el "521" histórico de móviles MX.
const normPhone = (p) => {
  let d = String(p || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("521") && d.length === 13) d = "52" + d.slice(3);
  if (d.length === 10) d = "52" + d; // asume México si vienen 10 dígitos
  return d;
};

const splitName = (full) => {
  const parts = String(full || "").trim().toLowerCase().split(/\s+/);
  return { fn: parts[0] || "", ln: parts.length > 1 ? parts.slice(1).join(" ") : "" };
};

const adAccount = () => {
  const id = String(process.env.META_AD_ACCOUNT_ID || "").trim();
  return id.startsWith("act_") ? id : `act_${id}`;
};

async function graph(path, { method = "GET", body, query = {} } = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(url, {
      method,
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.META_ACCESS_TOKEN}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = json.error || {};
      throw new Error(`Meta ${res.status}: ${err.message || "error"} (code ${err.code || "?"})`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Conversions API ----------
async function sendCapiEvent({ eventName, eventId, eventTime, email, phone, name, sourceUrl, value, currency }) {
  const { fn, ln } = splitName(name);
  const user_data = {};
  const em = normEmail(email);
  const ph = normPhone(phone);
  if (em) user_data.em = [sha256(em)];
  if (ph) user_data.ph = [sha256(ph)];
  if (fn) user_data.fn = [sha256(fn)];
  if (ln) user_data.ln = [sha256(ln)];

  const event = {
    event_name: eventName,
    event_time: eventTime || Math.floor(Date.now() / 1000),
    event_id: eventId, // deduplicación
    action_source: "website",
    event_source_url: sourceUrl,
    user_data,
  };
  if (value) event.custom_data = { value: Number(value), currency: currency || "MXN" };

  const body = { data: [event] };
  if (process.env.META_TEST_EVENT_CODE) body.test_event_code = process.env.META_TEST_EVENT_CODE;

  return graph(`${process.env.META_PIXEL_ID}/events`, { method: "POST", body });
}

// ---------- Audiencia personalizada (find-or-create) ----------
let cachedAudienceId = null;

async function findAudienceId() {
  let next = null;
  let url = { path: `${adAccount()}/customaudiences`, query: { fields: "id,name", limit: "200" } };
  for (let i = 0; i < 5; i++) {
    const page = next
      ? await graph(url.path, { query: { ...url.query, after: next } })
      : await graph(url.path, { query: url.query });
    const hit = (page.data || []).find((a) => a.name === AUDIENCE_NAME);
    if (hit) return hit.id;
    next = page.paging && page.paging.next ? page.paging.cursors.after : null;
    if (!next) break;
  }
  return null;
}

async function getOrCreateAudience() {
  if (cachedAudienceId) return cachedAudienceId;
  let id = await findAudienceId();
  if (!id) {
    const created = await graph(`${adAccount()}/customaudiences`, {
      method: "POST",
      body: {
        name: AUDIENCE_NAME,
        subtype: "CUSTOM",
        description: "Personas que agendaron una sesión por Cal.com (webhook)",
        customer_file_source: "USER_PROVIDED_ONLY",
      },
    });
    id = created.id;
  }
  cachedAudienceId = id;
  return id;
}

async function addToAudience({ email, phone, name }) {
  const audienceId = await getOrCreateAudience();
  const { fn, ln } = splitName(name);
  const em = normEmail(email);
  const ph = normPhone(phone);

  const row = [em ? sha256(em) : "", ph ? sha256(ph) : "", fn ? sha256(fn) : "", ln ? sha256(ln) : ""];
  return graph(`${audienceId}/users`, {
    method: "POST",
    body: {
      payload: {
        schema: ["EMAIL_SHA256", "PHONE_SHA256", "FN_SHA256", "LN_SHA256"],
        data: [row],
      },
    },
  });
}

module.exports = { sendCapiEvent, addToAudience, AUDIENCE_NAME };
