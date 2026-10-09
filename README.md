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

| Etapa | Evento (Meta) | Nombre en español | Cuándo | Desde |
|---|---|---|---|---|
| Visita | `PageView` (estándar) | Page View | Toda página | Pixel + CAPI |
| Interés | `VioPortafolio` (personalizado) | Vio portafolio | Clic en "Ver portafolio…" | Pixel + CAPI |
| Interés | `VerBlog` (personalizado) | Ver blog | Abre un artículo | Pixel + CAPI |
| Interés | `InicioEnBlog` (personalizado) | Inició en blog | Clic de acción dentro del blog | Pixel + CAPI |
| Intención | `InteresadoReunion` (personalizado) | Interesado en reunión | Clic en cualquier botón de Cal | Pixel + CAPI |
| Intención | `Contact` (estándar) | Contacto | Clic en WhatsApp · llegar a gracias-reunion | Pixel + CAPI |
| Conversión | `Lead` (estándar) | Cliente potencial | Reserva de la reunión en Cal | Webhook + Pixel (mismo id) |
| Conversión | `Schedule` (estándar) | Programar | Reserva de una sesión en Cal | Webhook + Pixel (mismo id) |
| Pago | `InitiateCheckout` (estándar) | Inicio compra | Llega a pago.html | Pixel + CAPI |
| Pago | `Purchase` (estándar) | Compra | Llega a gracias-pago.html / Cal "Booking Paid" | Pixel + CAPI / Webhook |

**Precios en CAPI:** el botón del cotizador manda `Contact` con `value` = total elegido (fotos + extras). `Schedule` y `Purchase` mandan el monto que reporta Cal (o `SESSION_PRICES`). `InitiateCheckout` y `Purchase` leen `?monto=` de la URL.

**Deduplicación:** cada evento sale del navegador por Pixel y por `/api/evento` con el MISMO `event_id`. Las reservas usan ids fijos (`lead_<uid>`, `schedule_<uid>`, `purchase_<uid>`) compartidos entre webhook y página de gracias. Recargar una página de gracias no vuelve a contar el evento.

**Sin eventos automáticos:** `tracking.js` apaga `autoConfig` del Pixel → no hay `SubscribedButtonClick` ni Microdata.

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

1. **Webhook** (Settings → Developer → Webhooks): URL `https://brumar.org/.netlify/functions/cal-webhook`, eventos **Booking Created** y **Booking Paid**.
2. **Sesiones de fotos** (brisa, horizonte, marea, sesión de fotos) → Advanced → *Redirect on booking*: `https://brumar.org/pago.html` con "Forward parameters" activado.
3. **Reunión** (`secret`): no necesita redirect; `cal.js` lleva a `gracias-reunion.html` al confirmar.
4. **Quitar la app "Meta Pixel" de los tipos de evento** de Cal (genera el evento `CalcomView` y duplica eventos).

## Pendientes marcados con ⚠️ CONFIRMAR

- `SESSION_PRICES` en `assets/js/tracking.js` y `netlify/functions/cal-webhook.js`: precio de cada sesión.
- Link de pago en `pago.html` (hoy abre WhatsApp). La pasarela debe regresar a `gracias-pago.html?monto=MONTO&uid=ID`.

## Probar

Agrega `?debug_tracking=1` a cualquier URL y abre la consola: verás cada evento con su `event_id`. En Meta: Events Manager → Probar eventos.
