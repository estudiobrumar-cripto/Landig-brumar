/* =====================================================================
   main.js — Brumar (solo la landing: index.html)
   Interfaz: nav, animaciones, cotizador, modales, carrusel, lightbox.
   Aquí NO hay tracking: los botones se miden con atributos data-track
   que lee assets/js/tracking.js.
   ===================================================================== */

// Evita que el navegador restaure la posición de scroll de una visita anterior
if ('scrollRestoration' in history) { history.scrollRestoration = 'manual'; }
window.addEventListener('load', () => { window.scrollTo(0, 0); });

// Nav: fondo sólido al hacer scroll
const nav = document.getElementById('siteNav');
window.addEventListener('scroll', () => {
  nav.classList.toggle('is-solid', window.scrollY > 40);
}, { passive:true });

// Scroll reveal
const revealEls = document.querySelectorAll('.reveal');
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-visible'); io.unobserve(e.target); } });
}, { threshold:0.12 });
revealEls.forEach(el => io.observe(el));

// Cotizador
const qSlider = document.getElementById('qSlider');
const qCount = document.getElementById('qCount');
const qTierLabel = document.getElementById('qTierLabel');
const qTotal = document.getElementById('qTotal');
const qExtrasTotal = document.getElementById('qExtrasTotal');
const qList = document.getElementById('qList');
const qWhatsapp = document.getElementById('qWhatsapp');
const extraCheckboxes = document.querySelectorAll('.quoter__extras input[type="checkbox"]');

function getTier(n){
  if (n <= 19) return { name:'Paquete Básico', edicion:'Edición básica', cambios:null };
  if (n <= 29) return { name:'Paquete Estándar', edicion:'Edición profesional', cambios:null };
  if (n <= 34) return { name:'Paquete Avanzado', edicion:'Edición profesional', cambios:'1 cambio de ropa' };
  return { name:'Paquete Premium', edicion:'Edición profesional', cambios:'2 cambios de ropa' };
}

// Precio total según la cantidad de fotos (lista de precios oficial)
// 10–20 fotos: $900 + $60 por foto extra · 21–30: +$50 c/u · 31–40: +$40 c/u
function getBasePrice(n){
  if (n <= 20) return 900 + (n - 10) * 60;
  if (n <= 30) return 1500 + (n - 20) * 50;
  return 2000 + (n - 30) * 40;
}

function getSelectedExtras(){
  return Array.from(extraCheckboxes)
    .filter(cb => cb.checked)
    .map(cb => ({
      name: cb.closest('.extra').querySelector('.extra__name').textContent,
      price: parseInt(cb.dataset.price, 10)
    }));
}

function updateQuoter(){
  const n = parseInt(qSlider.value, 10);
  const tier = getTier(n);
  const basePrice = getBasePrice(n);
  const extras = getSelectedExtras();
  const extrasSum = extras.reduce((sum, e) => sum + e.price, 0);
  const total = basePrice + extrasSum;

  qCount.textContent = n;
  qTierLabel.textContent = tier.name;
  qTierLabel.classList.toggle('is-mist', n <= 29);
  qTotal.textContent = '$' + total.toLocaleString('es-MX') + ' MXN';

  qExtrasTotal.textContent = extras.length
    ? '+ ' + extras.map(e => `${e.name} ($${e.price})`).join(' + ')
    : '';

  const items = [
    'Llamada de planificación',
    'Dirección de posado',
    'Galería de selección',
    tier.edicion
  ];
  if (tier.cambios) items.push(tier.cambios);

  qList.innerHTML = items.map(it => `<li>${it}</li>`).join('')
    + `<li class="is-dynamic">${n} fotos editadas incluidas</li>`;

  const extrasMsg = extras.length ? ` + ${extras.map(e => e.name).join(' + ')}` : '';
  const msg = encodeURIComponent(`Hola Adriel, quiero reservar el ${tier.name} de ${n} fotos${extrasMsg} (total aprox. $${total} MXN).`);
  qWhatsapp.href = `https://wa.me/529982247502?text=${msg}`;
  // Datos de precio para el evento Contact (los lee tracking.js al hacer clic → Pixel + CAPI)
  qWhatsapp.dataset.value = total;
  qWhatsapp.dataset.trackName = `${tier.name} · ${n} fotos${extrasMsg}`;
}

qSlider.addEventListener('input', updateQuoter);
extraCheckboxes.forEach(cb => cb.addEventListener('change', updateQuoter));
updateQuoter();

// Modal Flying Dress
const fdModal = document.getElementById('fdModal');
const fdOpenBtn = document.getElementById('fdOpenBtn');
const fdCloseBtn = document.getElementById('fdCloseBtn');
fdOpenBtn.addEventListener('click', (e) => {
  e.preventDefault();
  fdModal.classList.add('is-open');
});
function closeFdModal(){ fdModal.classList.remove('is-open'); }
fdCloseBtn.addEventListener('click', closeFdModal);
fdModal.addEventListener('click', (e) => { if (e.target === fdModal) closeFdModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFdModal(); });
document.getElementById('fdGrid').addEventListener('click', (e) => {
  const img = e.target.closest('img');
  if (img) openLightbox(img);
});

// Lightbox (funciona para el carrusel y el portafolio completo)
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
function bigUrl(src){ return src.replace(/\/upload\/[^/]+\//, '/upload/q_auto,f_auto,w_1400/'); }
function openLightbox(img){
  const hiResSrc = bigUrl(img.src);
  // Muestra al instante la miniatura que ya está en caché (sin esperar),
  // y la reemplaza por la versión nítida en cuanto termine de cargar.
  lightboxImg.src = img.src;
  lightboxImg.alt = img.alt;
  lightbox.classList.add('is-open');
  if (hiResSrc !== img.src) {
    const hiRes = new Image();
    hiRes.onload = () => { lightboxImg.src = hiResSrc; };
    hiRes.src = hiResSrc;
  }
}
function closeLightbox(){ lightbox.classList.remove('is-open'); lightboxImg.src=''; }
document.getElementById('lightboxClose').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

// Carrusel de portafolio
const carousel = document.getElementById('portfolioCarousel');
const carFigures = Array.from(carousel.querySelectorAll('figure'));
const carDots = document.getElementById('carDots');

carousel.addEventListener('click', (e) => {
  const img = e.target.closest('img');
  if (img) openLightbox(img);
});

// Puntos agrupados (menos puntos: uno cada 3 fotos, no uno por foto)
const GROUP_SIZE = 3;
const groupStarts = [];
for (let i = 0; i < carFigures.length; i += GROUP_SIZE) groupStarts.push(i);

groupStarts.forEach((startIndex, gi) => {
  const dot = document.createElement('button');
  dot.type = 'button';
  dot.setAttribute('aria-label', `Ir al grupo de fotos ${gi + 1}`);
  if (gi === 0) dot.classList.add('is-active');
  dot.addEventListener('click', () => {
    carousel.scrollTo({ left: carFigures[startIndex].offsetLeft, behavior:'smooth' });
  });
  carDots.appendChild(dot);
});
const dotEls = Array.from(carDots.children);

function setActiveDot(){
  let closest = 0, min = Infinity;
  carFigures.forEach((fig, i) => {
    const dist = Math.abs(fig.offsetLeft - carousel.scrollLeft);
    if (dist < min) { min = dist; closest = i; }
  });
  const activeGroup = Math.floor(closest / GROUP_SIZE);
  dotEls.forEach((d, i) => d.classList.toggle('is-active', i === activeGroup));
  return closest;
}
let scrollTicking = false;
carousel.addEventListener('scroll', () => {
  if (!scrollTicking) {
    requestAnimationFrame(() => { setActiveDot(); scrollTicking = false; });
    scrollTicking = true;
  }
});

// Flechas: avanzan/retroceden un ancho de pantalla del carrusel
document.getElementById('carPrev').addEventListener('click', () => {
  carousel.scrollBy({ left: -carousel.clientWidth * 0.85, behavior:'smooth' });
});
document.getElementById('carNext').addEventListener('click', () => {
  carousel.scrollBy({ left: carousel.clientWidth * 0.85, behavior:'smooth' });
});

// Movimiento automático: avanza sola cada 3.5s (solo mueve el carrusel, nunca la página),
// se pausa si el usuario interactúa y solo corre mientras el carrusel está a la vista.
let carAutoplay = null;
function startAutoplay(){
  if (carAutoplay) return; // ya está corriendo: nunca crear un segundo intervalo
  carAutoplay = setInterval(() => {
    const current = setActiveDot();
    const next = carFigures[(current + 1) % carFigures.length];
    carousel.scrollTo({ left: next.offsetLeft, behavior:'smooth' });
  }, 2000);
}
function pauseAutoplay(){
  clearInterval(carAutoplay);
  carAutoplay = null;
}
let resumeTimer;
function pauseThenResume(){
  pauseAutoplay();
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(startAutoplay, 5000);
}
['mouseenter','touchstart','pointerdown','wheel'].forEach(evt => {
  carousel.addEventListener(evt, pauseThenResume, { passive:true });
});
const carVisibilityObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) startAutoplay(); else pauseAutoplay();
  });
}, { threshold:0.5 });
carVisibilityObserver.observe(carousel);

// Modal de portafolio completo
const fullModal = document.getElementById('fullPortfolioModal');
const fullGrid = document.getElementById('fullPortfolioGrid');
function openFullPortfolio(){ fullModal.classList.add('is-open'); }
function closeFullPortfolio(){ fullModal.classList.remove('is-open'); }
document.getElementById('openFullPortfolio1').addEventListener('click', openFullPortfolio);
document.getElementById('openFullPortfolio2').addEventListener('click', openFullPortfolio);
document.getElementById('fullPortfolioClose').addEventListener('click', closeFullPortfolio);
fullModal.addEventListener('click', (e) => { if (e.target === fullModal) closeFullPortfolio(); });
fullGrid.addEventListener('click', (e) => {
  const img = e.target.closest('img');
  if (img) openLightbox(img);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFullPortfolio(); });
