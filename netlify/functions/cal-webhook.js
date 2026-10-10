// netlify/functions/cal-webhook.js
// Cal.com -> Netlify Function -> Meta (Conversions API + audiencia)
//
// Cómo trabaja Brumar: Adriel cobra por fuera y SOLO agenda la sesión cuando ya le pagaron.
// Por eso, una reserva nueva de SESIÓN DE FOTOS = una venta:
//   BOOKING_CREATED en una sesión  -> Purchase ("Compra") con el monto + audiencia "Agendaron sesión"
//
// Lead ("Cliente potencial") y Schedule ("Programar") NO salen de aquí: los dispara la app
// "Meta Pixel" instalada en cada tipo de evento de Cal.com (Reunión → Lead, sesiones → Schedule).
// Si también salieran del servidor, Meta los contaría dos veces.
//
// EL MONTO: al agendar, escríbelo en "Notas adicionales" de la reserva, por ejemplo:
//   "Monto: 2400"   o   "Total $2,400"
// (también se lee un campo del formulario llamado monto, precio o total, si algún día lo agregas).
// Sin monto, la compra se envía con valor 0 y queda un aviso en los logs de Netlify.
//
// Webhook en Cal.com → Ajustes → Desarrollador → Webhooks, evento "Reserva creada".
// URL: https://brumar.org/.netlify/functions/cal-webhook

const crypto = require("crypto");
const { sendCapiEvent, addToAudience } = require("./lib/capi");

const CAL_USER = "estudiobrumar";

// Sesiones de fotos (una reserva = una venta ya cobrada)
const SESSION_SLUGS = new Set([
  "sesion-de-fotos-brisa",
  "sesion-de-fotos-horizonte",
  "sesion-de-fotos-marea",
  "sesion-de-fotos",
]);

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

// Convierte "2,400", "2.400", "2400.50", "$2 400" en número.
function toNumber(raw) {
  let t = String(raw).replace(/[^\d.,]/g, "");
  if (!t) return null;
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, ""); // separador de miles
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return isFinite(n) && n > 0 && n < 1e6 ? n : null;
}

// Busca el monto cobrado: campo del formulario -> notas de la reserva -> pago de Cal.
function findAmount(p) {
  const r = p.responses || {};
  for (const key of ["monto", "precio", "total", "pago", "amount", "price"]) {
    const f = r[key];
    const v = f && typeof f === "object" ? f.value : f;
    const n = v != null ? toNumber(v) : null;
    if (n) return n;
  }
  // Solo las "Notas adicionales" de la reserva (Cal las repite en dos lugares; se toma una).
  // payload.description NO se usa: es el texto del tipo de evento, no de la reserva.
  const notes = [p.additionalNotes, r.notes && r.notes.value, typeof r.notes === "string" ? r.notes : ""]
    .find((x) => typeof x === "string" && x.trim()) || "";
  const labeled = notes.match(/(?:monto|precio|total|pag[oó]|cobr[eéo])\D{0,12}?([\d][\d.,\s]*\d|\d)/i);
  if (labeled) {
    const n = toNumber(labeled[1]);
    if (n) return n;
  }
  const money = notes.match(/\$\s*([\d][\d.,]*)/);
  if (money) {
    const n = toNumber(money[1]);
    if (n) return n;
  }
  // Notas que son SOLO un número: "450", "2,400", "1800 mxn", "450 pesos"
  const plain = notes.trim().match(/^\$?\s*([\d][\d.,\s]*)\s*(?:mxn|pesos|mx)?\.?$/i);
  if (plain) {
    const n = toNumber(plain[1]);
    if (n) return n;
  }
  const payment = Array.isArray(p.payment) ? p.payment.find((x) => x && x.success !== false && x.amount) : null;
  if (payment) return Number(payment.amount) / 100; // Cal manda centavos
  return null;
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
  if (trigger !== "BOOKING_CREATED") return respond(200, { ignored: trigger });

  const p = body.payload || {};
  const slug = (p.eventType && p.eventType.slug) || p.type || "";
  if (!SESSION_SLUGS.has(slug)) return respond(200, { ignored: `slug:${slug}` });

  // 2) Datos del cliente (los escribes tú al agendar)
  const attendee = (p.attendees && p.attendees[0]) || {};
  const email = attendee.email;
  const name = attendee.name;
  const phone = findPhone(p);
  if (!email && !phone) return respond(200, { ignored: "sin email ni teléfono" });

  // 3) Monto cobrado
  const amount = findAmount(p);
  if (!amount) console.warn(`Compra sin monto (reserva ${p.uid}). Escribe "Monto: 2400" en las notas al agendar.`);

  const eventId = `purchase_${p.uid || p.bookingId || Date.now()}`;

  // 4) CAPI + audiencia en paralelo (si una falla, la otra sigue)
  const [capi, aud] = await Promise.allSettled([
    sendCapiEvent({
      eventName: "Purchase",
      eventId, // si Cal reintenta el webhook, Meta no la cuenta dos veces
      email,
      phone,
      name,
      sourceUrl: `https://cal.com/${CAL_USER}/${slug}`,
      customData: { content_name: slug, content_category: "sesion", num_items: 1 },
      value: amount || 0,
      currency: "MXN",
    }),
    addToAudience({ email, phone, name }),
  ]);

  if (capi.status === "rejected") console.error("CAPI Purchase falló:", capi.reason.message);
  if (aud.status === "rejected") console.error("Audiencia falló:", aud.reason.message);

  // 200 siempre que la firma fue válida.
  return respond(200, {
    ok: true,
    event: "Purchase",
    event_id: eventId,
    slug,
    value: amount || 0,
    capi: capi.status,
    audience: aud.status,
  });
};
