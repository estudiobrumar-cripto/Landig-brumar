# netlify.toml
# OJO: si tu repo YA tiene un netlify.toml, no lo reemplaces:
# copia solo el bloque [functions] y deja tu [build] como está.

[build]
  publish = "."          # cambia si tu landing vive en otra carpeta (ej. "dist" o "public")

[functions]
  directory = "netlify/functions"
  node_bundler = "esbuild"

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    X-Frame-Options = "SAMEORIGIN"

// netlify/functions/cal-webhook.js
// Cal.com (BOOKING_CREATED) -> Netlify Function -> Meta (CAPI + audiencia)

const crypto = require("crypto");
const { sendCapiEvent, addToAudience } = require("./lib/capi");

// Solo estas sesiones cuentan. Cualquier otro tipo de evento de Cal.com se ignora.
const ALLOWED_SLUGS = new Set([
  "sesion-de-fotos-brisa",
  "sesion-de-fotos-horizonte",
  "sesion-de-fotos-marea",
]);

const CAL_USER = "estudiobrumar";

const respond = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj),
});

function validSignature(rawBody, headerSig) {
  const secret = process.env.CALCOM_WEBHOOK_SECRET || process.env.CAL_WEBHOOK_SECRET;
  if (!secret || !headerSig) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(headerSig).trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Cal.com guarda el teléfono en lugares distintos según el formulario.
function findPhone(payload) {
  const r = payload.responses || {};
  const candidates = [
    r.attendeePhoneNumber && r.attendeePhoneNumber.value,
    r.attendeePhoneNumber,
    r.phone && r.phone.value,
    r.phone,
    r.telefono && r.telefono.value,
    r.whatsapp && r.whatsapp.value,
    payload.attendees && payload.attendees[0] && payload.attendees[0].phoneNumber,
  ];
  return candidates.find((v) => typeof v === "string" && v.trim()) || "";
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return respond(405, { error: "Method not allowed" });

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  // 1) Firma HMAC
  const sig = event.headers["x-cal-signature-256"];
  if (!validSignature(rawBody, sig)) return respond(401, { error: "Invalid signature" });

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return respond(400, { error: "Bad JSON" });
  }

  // Prueba de Cal.com (botón "Test webhook")
  if (body.triggerEvent === "PING") return respond(200, { ok: true, ping: true });
  if (body.triggerEvent !== "BOOKING_CREATED") return respond(200, { ignored: body.triggerEvent });

  const p = body.payload || {};

  // 2) Filtro por slug
  const slug = (p.eventType && p.eventType.slug) || p.type || "";
  if (!ALLOWED_SLUGS.has(slug)) return respond(200, { ignored: `slug:${slug}` });

  // 3) Datos del cliente
  const attendee = (p.attendees && p.attendees[0]) || {};
  const email = attendee.email;
  const name = attendee.name;
  const phone = findPhone(p);
  if (!email && !phone) return respond(200, { ignored: "sin email ni teléfono" });

  const eventId = `cal_${p.uid || p.bookingId || Date.now()}`;

  // 4) CAPI + audiencia en paralelo (si una falla, la otra sigue)
  const [capi, aud] = await Promise.allSettled([
    sendCapiEvent({
      eventName: "Schedule",
      eventId,
      email,
      phone,
      name,
      sourceUrl: `https://cal.com/${CAL_USER}/${slug}`,
    }),
    addToAudience({ email, phone, name }),
  ]);

  if (capi.status === "rejected") console.error("CAPI falló:", capi.reason.message);
  if (aud.status === "rejected") console.error("Audiencia falló:", aud.reason.message);

  // 200 siempre que la firma fue válida: el event_id evita duplicados si se reintenta.
  return respond(200, {
    ok: true,
    slug,
    capi: capi.status,
    audience: aud.status,
  });
};

// netlify/functions/lib/capi.js
// Helpers compartidos: hash SHA256, normalización, Conversions API y audiencia personalizada.
// Vive en /lib para que Netlify NO lo trate como una función pública.

const crypto = require("crypto");

const GRAPH = "https://graph.facebook.com/v21.0";
const AUDIENCE_NAME = "Agendaron sesión - Estudio Brumar";

const sha256 = (v) =>
  crypto.createHash("sha256").update(String(v)).digest("hex");

const normEmail = (e) => (e || "").trim().toLowerCase();

// Solo dígitos, con código de país. Corrige el "521" histórico de móviles MX.
const normPhone = (p) => {
  let d = String(p || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("521") && d.length === 13) d = "52" + d.slice(3);
  if (d.length === 10) d = "52" + d; // asume México si vienen 10 dígitos
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
    event_id: eventId, // deduplicación
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
        description: "Personas que agendaron una sesión por Cal.com (webhook)",
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
