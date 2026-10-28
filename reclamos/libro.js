/* Página pública del Libro de Reclamaciones: /libro/<negocio> */
(function () {
  var C = window.LR_CONFIG, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var partes = location.pathname.split("/").filter(Boolean);
  var SLUG = (partes[0] === "libro" && partes[1]) ? partes[1].toLowerCase() : (new URLSearchParams(location.search).get("libro") || "nivo");
  var form = $("#form"), paso = 1, tipo = "reclamo", archivos = [], proveedor = null, enviando = false;

  function guardarIdem() {
    var k = "lr-idem-" + SLUG, v = null;
    try { v = sessionStorage.getItem(k); } catch (e) {}
    if (!v) { v = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9-]/g, ""); try { sessionStorage.setItem(k, v); } catch (e) {} }
    return v;
  }

  // ---------- carga del proveedor ----------
  LR.rpc("lr_libro_publico", { p_slug: SLUG }).then(function (p) {
    $("#cargando").hidden = true;
    if (!p) return noDisponible("No encontramos este Libro de Reclamaciones. Revisa el enlace.");
    proveedor = p;
    LR.aplicarMarca(p.color);
    document.title = "Libro de Reclamaciones · " + p.nombre_comercial;
    $("#nombre-cab").textContent = p.nombre_comercial;
    var ini = $("#marca .ini");
    if (p.logo_url && /^https:\/\//.test(p.logo_url)) {
      var img = document.createElement("img"); img.src = p.logo_url; img.alt = ""; img.width = 40; img.height = 40;
      img.onerror = function () { img.replaceWith(ini); };
      ini.replaceWith(img);
    } else ini.textContent = (p.nombre_comercial || "N").trim().charAt(0).toUpperCase();
    if (p.sitio_url && /^https:\/\//.test(p.sitio_url)) { $("#marca").href = p.sitio_url; $("#volver").href = p.sitio_url; $("#volver").hidden = false; }
    if (p.privacidad_url && /^https:\/\//.test(p.privacidad_url)) $("#link-priv").href = p.privacidad_url;
    $("#marca").setAttribute("aria-label", p.nombre_comercial + ", ir al sitio");
    if (!p.disponible) return noDisponible("El Libro de Reclamaciones de " + p.nombre_comercial + " aún no está disponible porque faltan sus datos. Si necesitas presentar un reclamo, comunícate directamente con el negocio o acude al Indecopi.");
    $("#p-razon").textContent = p.razon_social; $("#p-nombre").textContent = p.nombre_comercial;
    $("#p-ruc").textContent = p.ruc; $("#p-dir").textContent = p.direccion;
    $("#prov-priv").textContent = p.razon_social;
    $("#libro").hidden = false;
    probarPedidos();
    mostrarPaso(1, false);
  }).catch(function () {
    $("#cargando").hidden = true;
    noDisponible("No pudimos cargar el Libro de Reclamaciones. Revisa tu conexión y vuelve a intentarlo.");
  });
  function noDisponible(m) { var a = $("#no-disponible"); a.textContent = m; a.hidden = false; }

  // ---------- pasos ----------
  function mostrarPaso(n, enfocar) {
    paso = n;
    $$(".paso").forEach(function (f) { f.hidden = Number(f.dataset.paso) !== n; });
    $$("#pasos li").forEach(function (li, i) {
      li.classList.toggle("hecho", i + 1 < n);
      if (i + 1 === n) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
    $("#atras").hidden = n === 1;
    $("#esp").hidden = n !== 1;
    $("#siguiente").textContent = n === 4 ? (tipo === "reclamo" ? "Enviar reclamo" : "Enviar queja") : "Continuar";
    $("#error-form").hidden = true;
    if (n === 4) pintarResumen();
    if (enfocar !== false) {
      var h = $('.paso[data-paso="' + n + '"] h3');
      if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
      $("#libro").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  }
  $("#atras").addEventListener("click", function () { mostrarPaso(Math.max(1, paso - 1)); });
  $$("[data-ir]").forEach(function (b) { b.addEventListener("click", function () { mostrarPaso(Number(b.dataset.ir)); }); });

  $$(".opcion").forEach(function (b) {
    b.addEventListener("click", function () {
      tipo = b.dataset.tipo;
      $$(".opcion").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    });
  });
  form.menor.addEventListener("change", function () { $("#apoderado").hidden = !form.menor.checked; });

  // ---------- validación ----------
  function marcar(el, msg) {
    var id = "err-" + el.name, prev = document.getElementById(id);
    if (prev) prev.remove();
    if (!msg) { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); return true; }
    el.setAttribute("aria-invalid", "true");
    var s = document.createElement("span"); s.className = "error-campo"; s.id = id; s.textContent = msg;
    el.setAttribute("aria-describedby", id);
    (el.closest(".con-boton") || el).insertAdjacentElement("afterend", s);
    return false;
  }
  var v = function (n) { return (form[n].value || "").trim(); };
  var REGLAS = {
    1: function () {
      var ok = true, doc = v("doc_numero").toUpperCase(), td = form.doc_tipo.value;
      ok = marcar(form.nombre, v("nombre").length < 3 ? "Escribe tus nombres y apellidos." : "") && ok;
      var docMal = td === "DNI" ? !/^\d{8}$/.test(doc) : td === "RUC" ? !/^\d{11}$/.test(doc) : !/^[A-Z0-9-]{5,20}$/.test(doc);
      ok = marcar(form.doc_numero, docMal ? (td === "DNI" ? "El DNI tiene 8 dígitos." : td === "RUC" ? "El RUC tiene 11 dígitos." : "Escribe el número de tu documento.") : "") && ok;
      ok = marcar(form.domicilio, v("domicilio").length < 5 ? "Escribe tu domicilio." : "") && ok;
      ok = marcar(form.telefono, v("telefono") && !/^[\d +()-]{6,20}$/.test(v("telefono")) ? "Revisa el número de celular." : "") && ok;
      ok = marcar(form.correo, !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v("correo")) ? "Escribe un correo válido, por ejemplo nombre@gmail.com." : "") && ok;
      if (form.menor.checked) {
        ok = marcar(form.apoderado_nombre, v("apoderado_nombre").length < 3 ? "Escribe el nombre de tu madre, padre o apoderado." : "") && ok;
        ok = marcar(form.apoderado_doc, v("apoderado_doc").length < 5 ? "Escribe su número de documento." : "") && ok;
      } else { marcar(form.apoderado_nombre, ""); marcar(form.apoderado_doc, ""); }
      return ok;
    },
    2: function () {
      var ok = true;
      ok = marcar(form.bien_descripcion, v("bien_descripcion").length < 3 ? "Cuéntanos qué producto o servicio fue, por ejemplo «Libreta A5»." : "") && ok;
      var m = v("monto").replace(/[^\d.,]/g, "").replace(",", ".");
      ok = marcar(form.monto, m && !/^\d{1,9}(\.\d{1,2})?$/.test(m) ? "Escribe el monto solo con números, por ejemplo 32.50." : "") && ok;
      var f = v("fecha_compra");
      ok = marcar(form.fecha_compra, f && new Date(f) > new Date() ? "La fecha de compra no puede ser futura." : "") && ok;
      return ok;
    },
    3: function () {
      var ok = true;
      ok = marcar(form.hechos, v("hechos").length < 10 ? "Cuéntanos qué pasó (al menos una frase)." : "") && ok;
      ok = marcar(form.pedido_consumidor, v("pedido_consumidor").length < 3 ? "Indica qué solución pides." : "") && ok;
      return ok;
    },
    4: function () { return marcar(form.acepto, !form.acepto.checked ? "Marca la casilla para confirmar y presentar la hoja." : ""); }
  };
  function primerError() { var e = $('[aria-invalid="true"]', $('.paso[data-paso="' + paso + '"]')); if (e) e.focus(); }

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    if (!REGLAS[paso]()) return primerError();
    if (paso < 4) return mostrarPaso(paso + 1);
    enviar();
  });

  // ---------- resumen ----------
  function pintarResumen() {
    var filas = [
      ["Tipo", (tipo === "reclamo" ? "Reclamo" : "Queja") + " · " + (form.bien.value === "producto" ? "Producto" : "Servicio")],
      ["Consumidor", v("nombre") + " · " + LR.DOCS[form.doc_tipo.value] + " " + v("doc_numero").toUpperCase()],
      ["Domicilio", v("domicilio")],
      ["Contacto", [v("telefono"), v("correo")].filter(Boolean).join(" · ")],
      form.menor.checked ? ["Apoderado", v("apoderado_nombre") + " · " + v("apoderado_doc")] : null,
      ["Producto o servicio", [v("bien_descripcion"), v("pedido_ref") && "Pedido " + v("pedido_ref"), v("fecha_compra") && "Comprado el " + LR.fecha(v("fecha_compra")), v("monto") && LR.soles(v("monto").replace(/[^\d.,]/g, "").replace(",", "."))].filter(Boolean).join(" · ")],
      ["Qué pasó", v("hechos")],
      ["Solución pedida", v("pedido_consumidor")],
      archivos.length ? ["Adjuntos", archivos.map(function (a) { return a.nombre; }).join(", ")] : null
    ].filter(Boolean);
    $("#resumen").innerHTML = filas.map(function (f) { return "<dt>" + LR.esc(f[0]) + "</dt><dd>" + LR.esc(f[1]) + "</dd>"; }).join("");
  }

  // ---------- adjuntos ----------
  $("#elegir-archivo").addEventListener("click", function () { $("#archivo").click(); });
  $("#archivo").addEventListener("change", function (ev) {
    var lista = Array.prototype.slice.call(ev.target.files || []); ev.target.value = "";
    var avisos = [];
    lista.forEach(function (f) {
      if (archivos.length >= C.maxAdjuntos) return avisos.push("Puedes adjuntar hasta " + C.maxAdjuntos + " archivos.");
      if (!/^(image\/jpeg|image\/png|application\/pdf)$/.test(f.type)) return avisos.push(f.name + ": solo JPG, PNG o PDF.");
      if (f.size > C.maxPesoAdjunto) return avisos.push(f.name + ": pesa más de 5 MB.");
      var r = new FileReader();
      r.onload = function () { archivos.push({ nombre: f.name, base64: String(r.result).split(",")[1], peso: f.size }); pintarArchivos(); };
      r.readAsDataURL(f);
    });
    var e = $("#error-form"); e.textContent = avisos.join(" "); e.hidden = !avisos.length;
  });
  function pintarArchivos() {
    $("#lista-archivos").innerHTML = archivos.map(function (a, i) {
      return '<li><span>' + LR.esc(a.nombre) + ' · ' + (a.peso / 1048576).toFixed(1) + ' MB</span><button type="button" class="btn-link" data-quitar="' + i + '" aria-label="Quitar ' + LR.esc(a.nombre) + '">Quitar</button></li>';
    }).join("");
  }
  $("#lista-archivos").addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-quitar]"); if (!b) return;
    archivos.splice(Number(b.dataset.quitar), 1); pintarArchivos(); $("#elegir-archivo").focus();
  });

  // ---------- búsqueda de pedido (tiendas de Nivo Pedidos) ----------
  function seguirPedido(codigo) {
    return fetch(C.supabaseUrl + "/rest/v1/rpc/seguir_pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: C.anonKey, Authorization: "Bearer " + C.anonKey, "Content-Profile": "pedidos", "Accept-Profile": "pedidos" },
      body: JSON.stringify({ p_slug: SLUG, p_codigo: codigo })
    }).then(function (r) { return r.ok ? r.json() : null; });
  }
  function probarPedidos() {
    seguirPedido("PE-XXXXX").then(function (r) { if (Array.isArray(r)) $("#buscar-pedido").hidden = false; }).catch(function () {});
  }
  $("#buscar-pedido").addEventListener("click", function () {
    var cod = v("pedido_ref").toUpperCase(), est = $("#pedido-estado");
    if (!cod) { est.textContent = "Escribe el código de tu pedido, por ejemplo PE-7K2QM."; return; }
    est.textContent = "Buscando…";
    seguirPedido(cod).then(function (r) {
      if (!r || !r.length) { est.textContent = "No encontramos ese pedido. Igual puedes continuar."; return; }
      var p = r[0];
      form.pedido_ref.value = p.codigo;
      if (!v("monto") && p.total != null) form.monto.value = Number(p.total).toFixed(2);
      if (!v("fecha_compra") && p.creado) form.fecha_compra.value = new Date(p.creado).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
      form.bien.value = "producto";
      est.textContent = "Pedido encontrado: " + LR.fechaHora(p.creado) + " · " + LR.soles(p.total) + ".";
    }).catch(function () { est.textContent = "No pudimos buscar el pedido. Igual puedes continuar."; });
  });

  // ---------- envío ----------
  function enviar() {
    if (enviando) return;
    enviando = true;
    var b = $("#siguiente"), texto = b.textContent;
    b.setAttribute("aria-busy", "true"); b.disabled = true; b.innerHTML = '<span class="girando" aria-hidden="true"></span>Enviando…';
    $("#atras").disabled = true;
    var cuerpo = {
      accion: "registrar", libro: SLUG, idem: guardarIdem(), web: form.web.value,
      nombre: v("nombre"), doc_tipo: form.doc_tipo.value, doc_numero: v("doc_numero"), domicilio: v("domicilio"),
      telefono: v("telefono"), correo: v("correo"), menor: form.menor.checked,
      apoderado_nombre: form.menor.checked ? v("apoderado_nombre") : "", apoderado_doc: form.menor.checked ? v("apoderado_doc") : "",
      tipo: tipo, bien: form.bien.value, bien_descripcion: v("bien_descripcion"), pedido_ref: v("pedido_ref"),
      fecha_compra: v("fecha_compra"), monto: v("monto"), hechos: v("hechos"), pedido_consumidor: v("pedido_consumidor"),
      acepto: form.acepto.checked, adjuntos: archivos.map(function (a) { return { nombre: a.nombre, base64: a.base64 }; })
    };
    LR.funcion(cuerpo).then(function (r) {
      try { sessionStorage.removeItem("lr-idem-" + SLUG); } catch (e) {}
      location.replace("/libro/" + SLUG + "/constancia?c=" + encodeURIComponent(r.codigo) + "&t=" + r.token + "&nuevo=1" + (r.correo_enviado ? "" : "&sin_correo=1"));
    }).catch(function (e) {
      enviando = false;
      b.removeAttribute("aria-busy"); b.disabled = false; b.textContent = texto; $("#atras").disabled = false;
      var a = $("#error-form");
      a.textContent = (e.status === 0 || !e.status ? "No se pudo enviar. Revisa tu conexión y vuelve a intentarlo; no se creará una hoja duplicada. " : "") + e.message;
      a.hidden = false; a.focus && a.setAttribute("tabindex", "-1"); a.focus();
    });
  }
})();
