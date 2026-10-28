/* Constancia de una hoja: /libro/<negocio>/constancia?c=LR-AAAA-NNNNNN&t=<clave> */
(function () {
  var $ = function (s) { return document.querySelector(s); };
  var partes = location.pathname.split("/").filter(Boolean);
  var SLUG = partes[1] || "", q = new URLSearchParams(location.search);
  var codigo = q.get("c") || "", token = q.get("t") || "", nuevo = q.get("nuevo") === "1", sinCorreo = q.get("sin_correo") === "1";
  var cuerpo = { libro: SLUG, codigo: codigo, token: token };

  LR.funcion(Object.assign({ accion: "constancia" }, cuerpo)).then(function (h) {
    $("#cargando").hidden = true;
    LR.aplicarMarca(h.color);
    var p = h.proveedor || {};
    $("#nombre-cab").textContent = p.nombre_comercial || "Libro de Reclamaciones";
    document.querySelector(".marca .ini").textContent = (p.nombre_comercial || "N").trim().charAt(0).toUpperCase();
    document.title = "Constancia " + h.codigo + " · " + (p.nombre_comercial || "");
    var esReclamo = h.tipo === "reclamo";
    $("#t-hecho").textContent = esReclamo ? "Tu reclamo quedó registrado" : "Tu queja quedó registrada";
    $(nuevo ? "#cab-nuevo" : "#cab-ver").hidden = false;
    $("#c-codigo").textContent = h.codigo;
    $("#c-fecha").textContent = LR.fechaHora(h.creado_en);
    $("#c-plazo").textContent = (p.nombre_comercial || "El proveedor") + " debe responderte por escrito a más tardar el " + LR.fechaLarga(h.fecha_limite) + " (15 días hábiles), al correo " + h.correo + ".";
    var aviso = $("#c-correo");
    if (nuevo && sinCorreo) {
      aviso.className = "aviso aviso-av";
      aviso.textContent = "Tu hoja quedó registrada, pero no pudimos enviar la copia a tu correo en este momento. Lo volveremos a intentar. Descarga ahora la constancia en PDF para tenerla.";
    } else if (nuevo) {
      aviso.className = "aviso aviso-ok";
      aviso.textContent = "Te enviamos una copia a " + h.correo + ". Si no la ves, revisa la carpeta de spam.";
    } else aviso.hidden = true;
    var filas = [
      ["Proveedor", [p.razon_social, "RUC " + p.ruc, p.direccion].join(" · ")],
      ["Tipo", (esReclamo ? "Reclamo" : "Queja") + " · " + (h.bien === "producto" ? "Producto" : "Servicio")],
      ["Consumidor", h.nombre + " · " + (LR.DOCS[h.doc_tipo] || h.doc_tipo) + " " + h.doc_numero],
      ["Domicilio", h.domicilio],
      ["Contacto", [h.telefono, h.correo].filter(Boolean).join(" · ")],
      h.menor ? ["Apoderado", h.apoderado_nombre + " · " + h.apoderado_doc] : null,
      ["Producto o servicio", [h.bien_descripcion, h.pedido_ref && "Pedido " + h.pedido_ref, h.fecha_compra && "Comprado el " + LR.fecha(h.fecha_compra), LR.soles(h.monto)].filter(Boolean).join(" · ")],
      ["Qué pasó", h.hechos],
      ["Solución pedida", h.pedido_consumidor],
      h.adjuntos && h.adjuntos.length ? ["Adjuntos", h.adjuntos.map(function (a) { return a.nombre; }).join(", ")] : null
    ].filter(Boolean);
    $("#resumen").innerHTML = filas.map(function (f) { return "<dt>" + LR.esc(f[0]) + "</dt><dd>" + LR.esc(f[1]) + "</dd>"; }).join("");
    $("#constancia").hidden = false;
    if (nuevo) $("#t-hecho").focus();
    // Quita la clave de la barra de direcciones visible después de cargar (el enlace del correo la conserva).
    if (nuevo) try { history.replaceState(null, "", location.pathname + "?c=" + encodeURIComponent(codigo) + "&t=" + token); } catch (e) {}
  }).catch(function (e) {
    $("#cargando").hidden = true;
    var a = $("#error"); a.textContent = e.message || "No encontramos esa constancia."; a.hidden = false;
  });

  $("#imprimir").addEventListener("click", function () { window.print(); });
  $("#pdf").addEventListener("click", function () {
    var b = $("#pdf"), t = b.textContent;
    b.disabled = true; b.setAttribute("aria-busy", "true"); b.innerHTML = '<span class="girando" aria-hidden="true"></span>Preparando PDF…';
    LR.funcion(Object.assign({ accion: "constancia_pdf" }, cuerpo), null, true).then(function (blob) {
      LR.descargar(blob, codigo + ".pdf");
    }).catch(function (e) { alert(e.message); }).then(function () { b.disabled = false; b.removeAttribute("aria-busy"); b.textContent = t; });
  });
})();
