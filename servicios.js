/* Nivo · sección de servicios. Despliega/oculta las opciones de precio de cada plan. */
(function () {
  var toggles = document.querySelectorAll('.sv-toggle');
  toggles.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('aria-controls');
      var opts = id ? document.getElementById(id) : null;
      if (!opts) return;
      var oculto = opts.hasAttribute('hidden');
      var etiqueta = btn.querySelector('span');
      if (oculto) {
        opts.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
        if (etiqueta) etiqueta.textContent = 'Ocultar opciones';
      } else {
        opts.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
        if (etiqueta) etiqueta.textContent = 'Ver opciones';
      }
    });
  });
})();
