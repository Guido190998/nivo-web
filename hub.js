/* Carrusel de apps: flechas que avanzan una tarjeta y se desactivan en los extremos. */
(function () {
  var c = document.getElementById('carrusel'), a = document.getElementById('ant'), s = document.getElementById('sig');
  if (!c || !a || !s) return;
  var suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function paso() { var t = c.querySelector('.tarjeta'); return t ? t.getBoundingClientRect().width + parseFloat(getComputedStyle(c).columnGap || 0) : 300; }
  function estado() {
    a.disabled = c.scrollLeft <= 2;
    s.disabled = c.scrollLeft + c.clientWidth >= c.scrollWidth - 2;
  }
  a.addEventListener('click', function () { c.scrollBy({ left: -paso(), behavior: suave ? 'smooth' : 'auto' }); });
  s.addEventListener('click', function () { c.scrollBy({ left: paso(), behavior: suave ? 'smooth' : 'auto' }); });
  c.addEventListener('scroll', estado, { passive: true });
  window.addEventListener('resize', estado);
  estado();
})();
