/ netlify/functions/cal-webhook.js
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
