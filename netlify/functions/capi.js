// netlify/functions/capi.js
// Navegador (assets/js/tracking.js) -> esta función -> Meta Conversions API
// URL pública: /api/evento  (redirección en netlify.toml; menos bloqueada por adblockers)
//
// Cada evento llega con el MISMO event_id que el Pixel ya disparó en el navegador.
// Meta junta los dos (navegador + servidor) y cuenta uno solo: eso es la deduplicación.
// El servidor agrega lo que el navegador no puede mandar de forma confiable:
// IP real, user agent, y datos de contacto hasheados con SHA-256.

const { sendCapiEvent } = require("./lib/capi");

// Solo estos eventos se aceptan desde el navegador.
// Lead y Schedule NO: los manda cal-webhook.js (fuente de verdad = la reserva real).
const ALLOWED_EVENTS = new Set([
  "PageView",
  "VioPortafolio",
  "VerBlog",
  "InicioEnBlog",
  "InteresadoReunion",
  "Contact",
  "InitiateCheckout",
  "Purchase",
]);

// Solo se aceptan eventos que vengan de tu propio sitio.
const ALLOWED_HOSTS = [
  /^brumar\.org$/,
  /^www\.brumar\.org$/,
  /\.netlify\.app$/, // vistas previas de Netlify
  /^localhost$/,
];

// Parámetros de custom_data que se dejan pasar (todo lo demás se descarta).
const ALLOWED_CUSTOM = new Set([
  "content_name",
  "content_category",
  "content_ids",
  "value",
  "currency",
  "num_items",
  "origen",
  "cta",
]);

const respond = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

function hostAllowed(url) {
  try {
    const { hostname } = new URL(url);
    return ALLOWED_HOSTS.some((re) => re.test(hostname));
  } catch {
    return false;
  }
}

function cleanCustom(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input)) {
    if (!ALLOWED_CUSTOM.has(k)) continue;
    if (k === "content_ids" && Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => String(x).slice(0, 60));
    else if (k === "value" || k === "num_items") {
      const n = Number(v);
      if (isFinite(n) && n >= 0 && n < 1e6) out[k] = n;
    } else if (typeof v === "string" || typeof v === "number") out[k] = String(v).slice(0, 120);
  }
  return out;
}

function clientIp(headers) {
  return (
    headers["x-nf-client-connection-ip"] ||
    (headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    headers["client-ip"] ||
    ""
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return respond(405, { error: "Method not allowed" });

  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));

  // 1) Origen: solo tu dominio
  const origin = headers.origin || headers.referer || "";
  if (!hostAllowed(origin)) return respond(403, { error: "Origin not allowed" });

  // 2) Cuerpo
  let body;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
    if (raw.length > 8000) return respond(413, { error: "Too large" });
    body = JSON.parse(raw);
  } catch {
    return respond(400, { error: "Bad JSON" });
  }

  const name = String(body.event_name || "");
  const eventId = String(body.event_id || "").slice(0, 100);
  if (!ALLOWED_EVENTS.has(name)) return respond(400, { error: `Evento no permitido: ${name}` });
  if (!eventId) return respond(400, { error: "Falta event_id (sin él no hay deduplicación)" });
  if (!hostAllowed(body.event_source_url)) return respond(400, { error: "event_source_url inválida" });

  const custom = cleanCustom(body.custom_data);
  const user = body.user && typeof body.user === "object" ? body.user : {};

  try {
    await sendCapiEvent({
      eventName: name,
      eventId,
      actionSource: "website",
      sourceUrl: String(body.event_source_url).slice(0, 500),
      customData: custom,
      value: custom.value,
      currency: custom.currency,
      clientIp: clientIp(headers),
      userAgent: headers["user-agent"],
      fbp: typeof body.fbp === "string" ? body.fbp.slice(0, 200) : "",
      fbc: typeof body.fbc === "string" ? body.fbc.slice(0, 300) : "",
      externalId: typeof body.external_id === "string" ? body.external_id.slice(0, 64) : "",
      email: typeof user.em === "string" ? user.em : "",
      phone: typeof user.ph === "string" ? user.ph : "",
      name: typeof user.name === "string" ? user.name : "",
    });
    return respond(200, { ok: true, event: name, event_id: eventId });
  } catch (err) {
    console.error(`CAPI ${name} falló:`, err.message);
    // 202: la página nunca debe romperse por el tracking; el Pixel ya registró el evento.
    return respond(202, { ok: false });
  }
};
