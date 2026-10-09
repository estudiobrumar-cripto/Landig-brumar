// netlify/functions/cal-webhook.js
// Cal.com -> Netlify Function -> Meta (Conversions API + audiencia)
//
// Qué evento sale según lo que pase en Cal.com:
//   BOOKING_CREATED en la REUNIÓN (slug "secret")   -> Lead      ("Cliente potencial")
//   BOOKING_CREATED en una SESIÓN DE FOTOS           -> Schedule  ("Programar") + audiencia
//   BOOKING_PAID    en una SESIÓN DE FOTOS           -> Purchase  ("Compra") con el monto pagado
//
// Deduplicación: los event_id ("lead_<uid>", "schedule_<uid>", "purchase_<uid>") son los
// MISMOS que dispara el Pixel en gracias-reunion.html, pago.html y gracias-pago.html.
// Si Cal reintenta el webhook, Meta tampoco lo cuenta dos veces.
//
// En Cal.com → Settings → Developer → Webhooks, activa: Booking Created, Booking Paid
// (y "Ping" para probar). URL: https://brumar.org/.netlify/functions/cal-webhook

const crypto = require("crypto");
const { sendCapiEvent, addToAudience } = require("./lib/capi");

const CAL_USER = "estudiobrumar";

// Reunión de planificación (botones "Agendar cafecito" / "Va, organicemos la sesión")
const MEETING_SLUGS = new Set(["secret"]);

// Sesiones de fotos. Valor de referencia (MXN) para el evento Programar cuando Cal no trae precio.
// ⚠️ CONFIRMAR: pon el precio de cada sesión (o el anticipo). Mismos valores en assets/js/tracking.js.
const SESSION_PRICES = {
  "sesion-de-fotos-brisa": null,
  "sesion-de-fotos-horizonte": null,
  "sesion-de-fotos-marea": null,
  "sesion-de-fotos": null,
};

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

// Cal.com manda los montos en centavos (500000 = $5,000.00).
function priceFromCal(p) {
  const payment = Array.isArray(p.payment) ? p.payment.find((x) => x && x.success !== false) : null;
  if (payment && payment.amount) {
    return { value: Number(payment.amount) / 100, currency: (payment.currency || p.currency || "MXN").toUpperCase() };
  }
  if (p.price) return { value: Number(p.price) / 100, currency: (p.currency || "MXN").toUpperCase() };
  return { value: null, currency: "MXN" };
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

  const trigger = body.triggerEvent;
  if (trigger === "PING") return respond(200, { ok: true, ping: true });
  if (trigger !== "BOOKING_CREATED" && trigger !== "BOOKING_PAID") return respond(200, { ignored: trigger });

  const p = body.payload || {};
  const slug = (p.eventType && p.eventType.slug) || p.type || "";
  const isMeeting = MEETING_SLUGS.has(slug);
  const isSession = Object.prototype.hasOwnProperty.call(SESSION_PRICES, slug);
  if (!isMeeting && !isSession) return respond(200, { ignored: `slug:${slug}` });

  // 2) Qué evento corresponde
  let eventName;
  if (trigger === "BOOKING_CREATED") eventName = isMeeting ? "Lead" : "Schedule";
  else if (isSession) eventName = "Purchase";
  else return respond(200, { ignored: "pago de reunión" });

  // 3) Datos del cliente
  const attendee = (p.attendees && p.attendees[0]) || {};
  const email = attendee.email;
  const name = attendee.name;
  const phone = findPhone(p);
  if (!email && !phone) return respond(200, { ignored: "sin email ni teléfono" });

  const uid = p.uid || p.bookingId || Date.now();
  const prefix = { Lead: "lead", Schedule: "schedule", Purchase: "purchase" }[eventName];
  const eventId = `${prefix}_${uid}`;

  // 4) Precio: lo que Cal cobró; si no, el valor de referencia de la sesión
  const fromCal = priceFromCal(p);
  const value = fromCal.value != null ? fromCal.value : SESSION_PRICES[slug];
  const customData = {
    content_name: slug,
    content_category: isMeeting ? "reunion" : "sesion",
  };

  const tasks = [
    sendCapiEvent({
      eventName,
      eventId,
      eventTime: p.createdAt ? Math.floor(new Date(p.createdAt).getTime() / 1000) || undefined : undefined,
      email,
      phone,
      name,
      sourceUrl: `https://cal.com/${CAL_USER}/${slug}`,
      customData,
      value: isMeeting ? undefined : value,
      currency: fromCal.currency,
    }),
  ];
  // Audiencia "Agendaron sesión": solo al agendar una sesión de fotos (no la reunión).
  if (eventName === "Schedule") tasks.push(addToAudience({ email, phone, name }));

  const [capi, aud] = await Promise.allSettled(tasks);
  if (capi.status === "rejected") console.error(`CAPI ${eventName} falló:`, capi.reason.message);
  if (aud && aud.status === "rejected") console.error("Audiencia falló:", aud.reason.message);

  // 200 siempre que la firma fue válida: el event_id evita duplicados si Cal reintenta.
  return respond(200, {
    ok: true,
    event: eventName,
    event_id: eventId,
    slug,
    value: isMeeting ? null : value,
    capi: capi.status,
    audience: aud ? aud.status : "n/a",
  });
};
