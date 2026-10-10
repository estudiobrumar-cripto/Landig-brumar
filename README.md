# Brumar — brumar.org

Landing de fotografía familiar en Cancún + blog + recursos gratis, con medición de Meta (Pixel + Conversions API) deduplicada.

## Estructura

```
/
├── index.html               Landing (solo HTML: estilos y scripts viven en /assets)
├── gracias-reunion.html     Thank you de la REUNIÓN (Cal redirige aquí)        noindex
├── pago.html                Thank you de SESIÓN agendada = página de pago       noindex
├── gracias-pago.html        Thank you de PAGO                                   noindex
├── privacidad.html          Política de privacidad (requisito de Meta)
├── 404.html                 Página de error (Netlify la usa sola)
├── assets/
│   ├── css/global.css       UNA hoja de estilos para TODO el sitio
│   └── js/
│       ├── tracking.js      TODO el tracking: Pixel, eventos, deduplicación, CAPI
│       ├── cal.js           Calendario Cal.com emergente (cualquier página)
│       └── main.js          Interfaz de la landing (cotizador, carrusel, modales)
├── blog/                    index.html + 1 archivo .html por artículo
├── recursos/                index.html + 1 archivo .html por recurso imprimible
├── netlify/functions/
│   ├── capi.js              Navegador → Conversions API   (URL: /api/evento)
│   ├── cal-webhook.js       Cal.com → Conversions API + audiencia
│   └── lib/capi.js          Helpers compartidos (hash, envío a Meta, audiencia)
├── netlify.toml             Funciones, rutas /api/*, cabeceras, caché
├── robots.txt · sitemap.xml SEO
└── llms.txt · ai.txt        GEO (para que las IAs entiendan y citen el sitio)
```

## Embudo y eventos

| Etapa | Evento (Meta) | Nombre en español | Cuándo | Lo dispara |
|---|---|---|---|---|
| Visita | `PageView` (estándar) | Page View | Toda página | tracking.js → Pixel + CAPI |
| Interés | `VioPortafolio` (personalizado) | Vio portafolio | Clic en "Ver portafolio…" | tracking.js → Pixel + CAPI |
| Interés | `VerBlog` (personalizado) | Ver blog | Abre un artículo | tracking.js → Pixel + CAPI |
| Interés | `InicioEnBlog` (personalizado) | Inició en blog | Clic de acción dentro del blog | tracking.js → Pixel + CAPI |
| Intención | `InteresadoReunion` (personalizado) | Interesado en reunión | Clic en cualquier botón de Cal | tracking.js → Pixel + CAPI |
| Intención | `Contact` (estándar) | Contacto | Clic en WhatsApp · llegar a gracias-reunion | tracking.js → Pixel + CAPI |
| Conversión | `Lead` (estándar) | Cliente potencial | Alguien reserva la Reunión | App "Meta Pixel" de Cal.com |
| Conversión | `Schedule` (estándar) | Programar | Se reserva una sesión de fotos | App "Meta Pixel" de Cal.com |
| Venta | `Purchase` (estándar) | Compra | Adriel agenda una sesión (ya cobrada) | cal-webhook.js → CAPI, con monto |
| (futuro) | `InitiateCheckout` | Inicio compra | Llega a pago.html | Sin uso mientras se cobre por fuera |

**Cómo trabaja Brumar:** cobra por fuera y solo agenda la sesión cuando ya le pagaron, así que cada reserva de sesión es una venta.

**El monto de la compra:** al agendar una sesión en Cal, escribe el monto en "Notas adicionales" (ej. `Monto: 2400` o `Total $2,400`). Ese número viaja a Meta como valor de la Compra. Sin monto se envía con valor 0 y queda un aviso en los logs de Netlify.

**Precios desde la landing:** el botón del cotizador manda `Contact` con `value` = total elegido (fotos + extras).

**Deduplicación:** cada evento de tracking.js sale por Pixel y por `/api/evento` con el MISMO `event_id`. La Compra usa `purchase_<uid de la reserva>`, así un reintento del webhook no se cuenta doble. Lead y Schedule salen solo de Cal (ni el servidor ni tracking.js los repiten).

**Sin eventos automáticos:** `tracking.js` apaga `autoConfig` del Pixel → no hay `SubscribedButtonClick` ni Microdata. Las 10 reglas creadas con la herramienta sin código de Meta se borraron el 10/10/2026.

## Medir un botón nuevo (sin tocar JS)

```html
<button data-track="VioPortafolio" data-track-name="Portafolio bodas">Ver portafolio</button>
<a data-track="Contact" data-track-name="WhatsApp promo" data-value="1500" href="https://wa.me/...">…</a>
```
Los botones con `data-cal-link` y los links a WhatsApp se miden solos. Solo se aceptan los eventos del catálogo de `tracking.js` (`EVENTS`).

## Página nueva (blog o recurso)

Copia un artículo existente de la misma carpeta, cambia título, descripción, canonical y contenido, y agrega la URL a `sitemap.xml`, `llms.txt` y al índice de la carpeta. El CSS, el Pixel y los eventos ya vienen incluidos por los `<link>`/`<script>` del `<head>`.

## Variables de entorno en Netlify

| Variable | Para qué |
|---|---|
| `META_PIXEL_ID` | 1077080621499266 |
| `META_ACCESS_TOKEN` (o `Meta_Access_Token`) | Token de Conversions API |
| `META_AD_ACCOUNT_ID` | Cuenta publicitaria (audiencia "Agendaron sesión") |
| `CALCOM_WEBHOOK_SECRET` | Secreto del webhook de Cal.com |
| `META_TEST_EVENT_CODE` | Opcional: código de "Probar eventos" (quitarlo al terminar) |

## Configuración en Cal.com

1. **Webhook** (Ajustes → Desarrollador → Webhooks): URL `https://brumar.org/.netlify/functions/cal-webhook`, evento **Reserva creada**.
2. **App Meta Pixel** en cada tipo de evento: Reunión → `Lead`, sesiones → `Schedule`. Se queda encendida; es la fuente de esos dos eventos.
3. **Reunión** (`secret`): `cal.js` lleva a `gracias-reunion.html` al confirmar desde la landing.

## Probar

Agrega `?debug_tracking=1` a cualquier URL y abre la consola: verás cada evento con su `event_id`. En Meta: Events Manager → Probar eventos.
