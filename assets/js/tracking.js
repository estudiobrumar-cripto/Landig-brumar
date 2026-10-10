/* =====================================================================
   tracking.js — Brumar
   ÚNICO archivo de medición del sitio. Todas las páginas lo cargan con:
     <script src="assets/js/tracking.js" defer></script>      (raíz)
     <script src="../assets/js/tracking.js" defer></script>   (blog/, recursos/)

   Qué hace:
   1. Carga el Pixel de Meta con autoConfig APAGADO → no más SubscribedButtonClick
      ni eventos automáticos que dupliquen los nuestros.
   2. Cada evento sale DOS veces con el MISMO event_id:
        navegador → Pixel            fbq(..., {eventID})
        navegador → /api/evento      → netlify/functions/capi.js → Conversions API
      Meta ve el mismo event_name + event_id y cuenta UNO solo (deduplicado).
   3. Lead (Cliente potencial) y Schedule (Programar) los dispara la app "Meta Pixel"
      de Cal.com al reservar (Reunión → Lead, sesiones → Schedule). Este archivo NO
      los repite, para no contarlos doble. Compra (Purchase) la manda el servidor
      desde el webhook de Cal (netlify/functions/cal-webhook.js) al agendar una sesión.
   4. Los botones se miden con atributos HTML, sin escribir JS:
        data-track="NombreDelEvento"   data-track-name="texto"   data-value="900"
      Además: todo botón de Cal (data-cal-link) = InteresadoReunion
              todo link a WhatsApp            = Contact

   Modo prueba: agrega ?debug_tracking=1 a la URL y mira la consola.
   ===================================================================== */
(function () {
  'use strict';

  /* ---------- CONFIGURACIÓN (lo único que normalmente se edita) ---------- */
  var CONFIG = {
    pixelId: '1077080621499266',
    capiEndpoint: '/api/evento',  // redirige a /.netlify/functions/capi (ver netlify.toml)
    currency: 'MXN'
  };

  /* ---------- EMBUDO: catálogo de eventos permitidos ----------
     std:true  → evento estándar de Meta (fbq 'track')
     std:false → evento personalizado     (fbq 'trackCustom')
     server:false → el servidor NO lo acepta desde el navegador.
     Lead y Schedule quedan en el catálogo solo como referencia: hoy los
     dispara la app Meta Pixel de Cal.com, no este archivo.                  */
  var EVENTS = {
    PageView:          { std: true,  etapa: 'Visita' },
    VioPortafolio:     { std: false, etapa: 'Interés',    nombre: 'Vio portafolio' },
    VerBlog:           { std: false, etapa: 'Interés',    nombre: 'Ver blog' },
    InicioEnBlog:      { std: false, etapa: 'Interés',    nombre: 'Inició en blog' },
    InteresadoReunion: { std: false, etapa: 'Intención',  nombre: 'Interesado en reunión' },
    Contact:           { std: true,  etapa: 'Intención',  nombre: 'Contacto' },
    Lead:              { std: true,  etapa: 'Conversión', nombre: 'Cliente potencial', server: false },
    Schedule:          { std: true,  etapa: 'Conversión', nombre: 'Programar',         server: false },
    InitiateCheckout:  { std: true,  etapa: 'Pago',       nombre: 'Inicio compra' },
    Purchase:          { std: true,  etapa: 'Pago',       nombre: 'Compra' }
  };

  var html = document.documentElement;
  var isHttp = /^https?:$/.test(location.protocol);
  var debug = /[?&]debug_tracking=1/.test(location.search) || location.hostname === 'localhost';

  function log() {
    if (debug && window.console) console.log.apply(console, ['%c[tracking]', 'color:#A17259;font-weight:600'].concat([].slice.call(arguments)));
  }

  /* ---------- Utilidades: cookies, storage, parámetros ---------- */
  function getCookie(name) {
    var m = document.cookie.match('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value, days) {
    var d = new Date(); d.setTime(d.getTime() + days * 864e5);
    document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax';
  }
  function store(kind) {
    try { var s = window[kind]; s.setItem('__t', '1'); s.removeItem('__t'); return s; } catch (e) { return null; }
  }
  var local = store('localStorage');
  var session = store('sessionStorage');

  var params = new URLSearchParams(location.search);
  function param() {
    for (var i = 0; i < arguments.length; i++) {
      var v = params.get(arguments[i]);
      if (v) return v.trim();
    }
    return '';
  }

  function rid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- Identificadores para que Meta reconozca a la persona ---------- */
  // _fbc: si la visita viene de un anuncio (fbclid), se guarda antes del primer evento.
  var fbclid = param('fbclid');
  if (fbclid && getCookie('_fbc').split('.').pop() !== fbclid) {
    setCookie('_fbc', 'fb.1.' + Date.now() + '.' + fbclid, 90);
  }
  // external_id: id anónimo propio y estable del visitante (se hashea en el servidor).
  var visitorId = getCookie('_brm_id');
  if (!visitorId) { visitorId = rid(); setCookie('_brm_id', visitorId, 365); }

  // Datos de contacto que Cal.com reenvía a las páginas de gracias:
  // se leen para el servidor (que los hashea) y se BORRAN de la barra de direcciones
  // para que no viajen en la URL del Pixel ni en el historial.
  var SENSITIVE = ['email', 'name', 'attendeeName', 'attendeeEmail', 'phone', 'attendeePhoneNumber', 'firstName', 'lastName'];
  var userFromUrl = {
    em: param('email', 'attendeeEmail'),
    ph: param('phone', 'attendeePhoneNumber'),
    name: param('attendeeName', 'name') || [param('firstName'), param('lastName')].join(' ').trim()
  };
  if (SENSITIVE.some(function (k) { return params.has(k); })) {
    SENSITIVE.forEach(function (k) { params.delete(k); });
    var qs = params.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  }

  /* ---------- Origen de la sesión (blog / recursos) ---------- */
  var section = html.getAttribute('data-section') || '';
  if (session && (section === 'blog' || section === 'recursos')) session.setItem('brm_origen', section);
  var origen = session ? session.getItem('brm_origen') : '';

  /* ---------- Pixel de Meta ---------- */
  /* eslint-disable */
  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  // ⬇ Apaga los eventos automáticos (SubscribedButtonClick, Microdata, etc.)
  fbq('set', 'autoConfig', false, CONFIG.pixelId);
  fbq('init', CONFIG.pixelId, { external_id: visitorId });

  /* ---------- Evitar duplicados ----------
     once:    una vez por carga de página (mismo evento + mismo contenido)
     persist: una vez para siempre en este navegador (gracias/pago: recargar
              la página no vuelve a contar la compra)                         */
  var firedThisPage = {};
  function alreadyFired(key, persist) {
    if (firedThisPage[key]) return true;
    if (persist && local && local.getItem('brm_ev_' + key)) return true;
    return false;
  }
  function markFired(key, persist) {
    firedThisPage[key] = true;
    if (persist && local) local.setItem('brm_ev_' + key, String(Date.now()));
  }

  /* ---------- Envío al servidor (Conversions API) ---------- */
  function sendServer(payload) {
    if (!isHttp) { log('(local) no se envía a CAPI:', payload.event_name); return; }
    var body = JSON.stringify(payload);
    try {
      fetch(CONFIG.capiEndpoint, {
        method: 'POST',
        keepalive: true,                    // sobrevive aunque el usuario salga a WhatsApp
        headers: { 'Content-Type': 'application/json' },
        body: body
      }).catch(function () {});
    } catch (e) { /* nunca romper la página por tracking */ }
  }

  /* ---------- API principal ----------
     track('Contact', {content_name:'WhatsApp hero', value:900}, {eventId, once, persist, user}) */
  function track(name, data, opts) {
    var def = EVENTS[name];
    if (!def) { log('Evento NO permitido, ignorado:', name); return null; }
    data = data || {};
    opts = opts || {};

    var custom = {};
    Object.keys(data).forEach(function (k) {
      if (data[k] !== undefined && data[k] !== null && data[k] !== '') custom[k] = data[k];
    });
    if (custom.value !== undefined) {
      custom.value = Number(custom.value);
      if (!isFinite(custom.value)) delete custom.value;
      else custom.currency = custom.currency || CONFIG.currency;
    }
    if (origen && name !== 'PageView') custom.origen = origen;

    var onceKey = opts.onceKey || (name + '|' + (custom.content_name || ''));
    if ((opts.once || opts.persist) && alreadyFired(onceKey, opts.persist)) {
      log('Duplicado evitado:', name, custom.content_name || '');
      return null;
    }

    var eventId = opts.eventId || (name.toLowerCase() + '_' + rid());

    // 1) Navegador → Pixel
    fbq(def.std ? 'track' : 'trackCustom', name, custom, { eventID: eventId });

    // 2) Navegador → servidor → CAPI (mismo event_id = deduplicado)
    if (def.server !== false) {
      sendServer({
        event_name: name,
        event_id: eventId,
        event_source_url: location.origin + location.pathname + location.search,
        custom_data: custom,
        fbp: getCookie('_fbp'),
        fbc: getCookie('_fbc'),
        external_id: visitorId,
        user: opts.user || null
      });
    }

    markFired(onceKey, !!opts.persist);
    log(name, '(' + (def.nombre || name) + ')', custom, 'event_id=' + eventId);
    return eventId;
  }

  /* ---------- PageView en todas las páginas ---------- */
  track('PageView');

  /* ---------- Clics: delegación única para todo el sitio ---------- */
  var CLICK_SELECTOR = '[data-track], [data-cal-link], a[href*="wa.me/"], a[href*="api.whatsapp.com"]';

  function textOf(el) {
    return (el.getAttribute('data-track-name') || el.getAttribute('aria-label') || el.textContent || '')
      .replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest(CLICK_SELECTOR);
    if (!el) return;

    var name = el.getAttribute('data-track');
    if (!name) name = el.hasAttribute('data-cal-link') ? 'InteresadoReunion' : 'Contact';

    // Enlace del blog hacia la landing (data-track="InicioEnBlog"): un solo evento por página.
    if (name === 'InicioEnBlog') {
      track('InicioEnBlog', { content_name: document.title, cta: textOf(el) }, { once: true, onceKey: 'InicioEnBlog' });
      return;
    }

    var data = { content_name: textOf(el) };
    if (name === 'Contact') data.content_category = 'whatsapp';
    if (el.hasAttribute('data-value')) data.value = el.getAttribute('data-value');
    if (el.hasAttribute('data-content-ids')) data.content_ids = el.getAttribute('data-content-ids').split(',');

    track(name, data, { once: true });

    // "Inició en blog": cualquier botón de acción pulsado DESDE el blog
    if (section === 'blog') {
      track('InicioEnBlog', { content_name: document.title, cta: data.content_name }, { once: true, onceKey: 'InicioEnBlog' });
    }
  }, true);

  /* ---------- Eventos de página según el tipo (atributo data-page en <html>) ---------- */
  var page = html.getAttribute('data-page') || '';
  var bookingUid = param('uid', 'bookingUid', 'bookingId');
  var slug = param('slug', 'eventTypeSlug', 'type');

  var PAGE_EVENTS = {
    // Cada post del blog: "Ver blog"
    post: function () {
      track('VerBlog', { content_name: html.getAttribute('data-title') || document.title, content_category: 'blog' }, { once: true });
    },

    // Gracias por agendar la REUNIÓN (Cal.com redirige aquí)
    'gracias-reunion': function () {
      // "Cliente potencial" lo dispara la app Meta Pixel de Cal al reservar; aquí solo Contacto.
      track('Contact', { content_name: 'Reunión agendada', content_category: 'cal_reunion' }, {
        eventId: 'contact_' + (bookingUid || rid()),
        persist: true,
        onceKey: 'contact_reunion_' + (bookingUid || new Date().toDateString()),
        user: userFromUrl
      });
    },

    // Página de pago en línea → "Inicio compra".
    // Hoy NO está en uso (Brumar cobra por fuera); queda lista para cuando haya pago en línea.
    pago: function () {
      var value = param('monto', 'value');
      track('InitiateCheckout', {
        content_name: slug || 'Sesión de fotos',
        content_category: 'sesion',
        value: value || undefined,
        num_items: 1
      }, {
        eventId: 'checkout_' + (bookingUid || rid()),
        persist: true,
        onceKey: 'checkout_' + (bookingUid || new Date().toDateString()),
        user: userFromUrl
      });
    },

    // Thank you de PAGO en línea → "Compra". Hoy NO está en uso (la compra sale del webhook).
    // Usa event_id purchase_<uid>, el mismo del webhook, para no duplicar si algún día conviven.
    'gracias-pago': function () {
      // Acepta los parámetros de retorno de Cal, Stripe, Mercado Pago o PayPal
      var payId = param('uid', 'bookingUid', 'payment_id', 'collection_id', 'session_id', 'tx', 'id');
      var value = param('monto', 'value', 'amount', 'amt', 'transaction_amount');
      var currency = (param('currency', 'cc') || CONFIG.currency).toUpperCase();
      track('Purchase', {
        content_name: slug || 'Sesión de fotos',
        content_category: 'sesion',
        value: value || undefined,
        currency: currency,
        num_items: 1
      }, {
        eventId: 'purchase_' + (payId || rid()),
        persist: true,
        onceKey: 'purchase_' + (payId || new Date().toDateString()),
        user: userFromUrl
      });
    }
  };
  if (PAGE_EVENTS[page]) PAGE_EVENTS[page]();

  /* ---------- API pública para otros scripts (main.js, cal.js) ---------- */
  window.BrumarTracking = { track: track, events: EVENTS, config: CONFIG };
})();
