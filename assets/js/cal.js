/* =====================================================================
   cal.js — Brumar
   Calendario de Cal.com como ventana emergente. Cualquier botón con
     data-cal-link="estudiobrumar/secret"
   abre la REUNIÓN sin salir de la página (en cualquier página del sitio).

   El clic en el botón lo mide tracking.js como "InteresadoReunion".
   Cuando la persona termina de agendar, la mandamos a gracias-reunion.html
   con el uid de la reserva → ahí se mide "Contact" + "Lead" deduplicado
   con el webhook (netlify/functions/cal-webhook.js).
   ===================================================================== */
(function (C, A, L) {
  var p = function (a, ar) { a.q.push(ar); };
  var d = C.document;
  C.Cal = C.Cal || function () {
    var cal = C.Cal; var ar = arguments;
    if (!cal.loaded) {
      cal.ns = {}; cal.q = cal.q || [];
      d.head.appendChild(d.createElement('script')).src = A;
      cal.loaded = true;
    }
    if (ar[0] === L) {
      var api = function () { p(api, arguments); };
      var namespace = ar[1];
      api.q = api.q || [];
      if (typeof namespace === 'string') {
        cal.ns[namespace] = cal.ns[namespace] || api;
        p(cal.ns[namespace], ar);
        p(cal, ['initNamespace', namespace]);
      } else p(cal, ar);
      return;
    }
    p(cal, ar);
  };
})(window, 'https://app.cal.com/embed/embed.js', 'init');

Cal('init', { origin: 'https://cal.com' });

Cal('ui', {
  cssVarsPerTheme: {
    light: { 'cal-brand': '#a17259' },
    dark: { 'cal-brand': '#a17259' }
  },
  hideEventTypeDetails: false,
  layout: 'month_view'
});

// Reserva completada dentro de la ventana → página de gracias de la reunión.
(function () {
  var redirected = false;
  function goThanks(e) {
    if (redirected) return;
    var data = (e && e.detail && e.detail.data) || {};
    var booking = data.booking || data;
    var uid = booking.uid || data.uid || '';
    var root = document.documentElement.getAttribute('data-root') || '';
    redirected = true;
    // Pequeña pausa para que Cal muestre su confirmación y se envíen los eventos en curso.
    setTimeout(function () {
      location.href = root + 'gracias-reunion.html' + (uid ? '?uid=' + encodeURIComponent(uid) : '');
    }, 1200);
  }
  Cal('on', { action: 'bookingSuccessfulV2', callback: goThanks });
  Cal('on', { action: 'bookingSuccessful', callback: goThanks }); // versiones anteriores del embed
})();
