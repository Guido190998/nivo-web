/* Panel del Libro de Reclamaciones: /reclamos/panel */
(function () {
  var C = window.LR_CONFIG, $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = LR.esc;
  var sb = window.supabase.createClient(C.supabaseUrl, C.anonKey, { auth: { persistSession: true, storageKey: "nivo-reclamos-panel" } });
  var q = new URLSearchParams(location.search);
  var E = { libros: [], libro: null, hojas: [], filtro: { texto: "", tipo: "", estado: "", periodo: "30" }, correoListo: null, superadmin: null };

  // ---------- utilidades ----------
  async function rpc(nombre, args) {
    var r = await sb.rpc(nombre, args || {});
    if (r.error) throw new Error(LR.traducir(r.error.message));
    return r.data;
  }
  async function token() { var s = await sb.auth.getSession(); return s.data.session && s.data.session.access_token; }
  async function fn(cuerpo, archivo) { return LR.funcion(cuerpo, await token(), archivo); }
  function toast(m) { var t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(function () { t.hidden = true; }, 3500); }
  function ocupado(b, si, texto) {
    if (si) { b.dataset.t = b.textContent; b.disabled = true; b.setAttribute("aria-busy", "true"); b.innerHTML = '<span class="girando" aria-hidden="true"></span>' + esc(texto || "Guardando…"); }
    else { b.disabled = false; b.removeAttribute("aria-busy"); b.textContent = b.dataset.t || b.textContent; }
  }
  function limaHoy() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" }); }
  var ESTADOS = { nuevo: "Nuevo", en_atencion: "En atención", respondido: "Respondido" };
  function chip(h) {
    if (h.estado !== "respondido" && h.quedan != null && h.quedan < 0) return '<span class="chip vencido">Fuera de plazo</span>';
    if (h.estado !== "respondido" && h.quedan != null && h.quedan <= 3) return '<span class="chip pronto">Vence pronto</span>';
    return '<span class="chip ' + h.estado + '">' + ESTADOS[h.estado] + "</span>";
  }
  function plazo(h) {
    if (h.estado === "respondido") return '<span class="tenue">Respondido el ' + LR.fechaHora(h.respondido_en).slice(0, 10) + "</span>";
    if (h.quedan < 0) return '<span class="plazo-venc num">' + LR.fecha(h.fecha_limite) + " · vencido hace " + (-h.quedan) + " día" + (h.quedan === -1 ? "" : "s") + " hábil" + (h.quedan === -1 ? "" : "es") + "</span>";
    var t = LR.fecha(h.fecha_limite) + " · " + (h.quedan === 0 ? "vence hoy" : "quedan " + h.quedan + " día" + (h.quedan === 1 ? "" : "s") + " hábil" + (h.quedan === 1 ? "" : "es"));
    return '<span class="num' + (h.quedan <= 3 ? " plazo-urg" : "") + '">' + t + "</span>";
  }

  // ---------- ingreso ----------
  function correosPara(texto) {
    var t = String(texto || "").trim().toLowerCase();
    if (t.indexOf("@") >= 0) return [t];
    var slug = q.get("libro") || (function () { try { return localStorage.getItem("lr-ultimo-libro"); } catch (e) { return null; } })();
    if (!slug) return [];
    var u = t.replace(/[^a-z0-9.]/g, "");
    return C.dominiosUsuarios.map(function (d) { return u + "@" + slug + "." + d; });
  }
  $("#f-ingreso").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var f = ev.target, err = $("#i-error"), b = $("#i-entrar");
    err.hidden = true;
    var lista = correosPara(f.usuario.value), clave = f.clave.value;
    if (!f.usuario.value.trim() || !clave) { err.textContent = "Escribe tu correo o usuario y tu contraseña."; err.hidden = false; return; }
    if (!lista.length) { err.textContent = "Para entrar con usuario abre el enlace del panel que te dio tu negocio, o usa tu correo."; err.hidden = false; return; }
    ocupado(b, true, "Entrando…");
    var ok = false;
    for (var i = 0; i < lista.length && !ok; i++) {
      var r = await sb.auth.signInWithPassword({ email: lista[i], password: clave });
      ok = !r.error;
    }
    ocupado(b, false);
    if (!ok) { err.textContent = "Correo, usuario o contraseña incorrectos."; err.hidden = false; f.clave.select(); return; }
    iniciar();
  });
  $("#m-salir").addEventListener("click", async function () { await sb.auth.signOut(); location.replace(location.pathname + location.search); });

  async function iniciar() {
    var s = await sb.auth.getSession();
    $("#cargando").hidden = true;
    if (!s.data.session) { $("#ingreso").hidden = false; $("#app").hidden = true; return; }
    var u = s.data.session.user;
    $("#m-quien").textContent = (u.user_metadata && u.user_metadata.nombre) || (u.email || "").split("@")[0];
    try { E.libros = await rpc("lr_mis_libros"); } catch (e) { E.libros = []; }
    $("#ingreso").hidden = true; $("#app").hidden = false;
    if (!E.libros.length) {
      $("#vista").innerHTML = '<div class="aviso aviso-av" role="alert">Tu cuenta no tiene acceso a ningún Libro de Reclamaciones. Pide al dueño de tu negocio que te dé acceso desde «Equipo».</div>';
      return;
    }
    var pedido = q.get("libro"), guardado = null;
    try { guardado = localStorage.getItem("lr-ultimo-libro"); } catch (e) {}
    E.libro = E.libros.find(function (l) { return l.slug === pedido; }) || E.libros.find(function (l) { return l.slug === guardado; }) || E.libros[0];
    var sel = $("#m-libro");
    if (E.libros.length > 1) {
      sel.innerHTML = E.libros.map(function (l) { return '<option value="' + l.id + '">' + esc(l.nombre_comercial) + (l.pendientes ? " (" + l.pendientes + ")" : "") + "</option>"; }).join("");
      sel.hidden = false;
    }
    sel.onchange = function () { elegirLibro(E.libros.find(function (l) { return l.id === sel.value; })); };
    fn({ accion: "estado_correo" }).then(function (r) { E.correoListo = r.configurado; if (location.hash === "" || location.hash === "#/") ruta(); }).catch(function () {});
    elegirLibro(E.libro);
    setInterval(function () { if ((location.hash || "#/") === "#/" && !document.hidden) cargarHojas(true); }, 60000);
  }
  function elegirLibro(l) {
    E.libro = l;
    try { localStorage.setItem("lr-ultimo-libro", l.slug); } catch (e) {}
    $("#m-libro").value = l.id;
    LR.aplicarMarca(l.color);
    $("#m-nombre").textContent = l.nombre_comercial;
    $("#m-marca .ini").textContent = (l.nombre_comercial || "N").charAt(0).toUpperCase();
    $("#m-publico").href = "/libro/" + l.slug;
    $("#m-equipo").hidden = l.rol !== "admin";
    E.hojas = [];
    ruta();
  }
  window.addEventListener("hashchange", ruta);
  function ruta() {
    if (!E.libro) return;
    var h = location.hash || "#/";
    var vista = /^#\/hoja\//.test(h) ? "detalle" : h === "#/configuracion" ? "configuracion" : h === "#/equipo" ? "equipo" : "lista";
    $$(".menu a[data-vista]").forEach(function (a) { if (a.dataset.vista === vista) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (vista === "lista") vistaLista();
    else if (vista === "detalle") vistaDetalle(h.split("/")[2]);
    else if (vista === "configuracion") vistaConfig();
    else vistaEquipo();
  }

  // ---------- lista ----------
  async function cargarHojas(silencioso) {
    try { E.hojas = await rpc("lr_hojas", { p_libro: E.libro.id }); pintarLista(); }
    catch (e) { if (!silencioso) $("#vista").innerHTML = '<div class="aviso aviso-err" role="alert">' + esc(e.message) + "</div>"; }
  }
  function vistaLista() {
    $("#vista").innerHTML = '<div class="cargando" role="status"><span class="girando" aria-hidden="true"></span>Cargando reclamos…</div>';
    cargarHojas();
  }
  function pintarLista() {
    var H = E.hojas, pend = H.filter(function (h) { return h.estado !== "respondido"; });
    var mes = limaHoy().slice(0, 7);
    var k = {
      mes: H.filter(function (h) { return new Date(h.creado_en).toLocaleDateString("en-CA", { timeZone: "America/Lima" }).slice(0, 7) === mes; }).length,
      recl: pend.filter(function (h) { return h.tipo === "reclamo"; }).length,
      quej: pend.filter(function (h) { return h.tipo === "queja"; }).length,
      pronto: pend.filter(function (h) { return h.quedan != null && h.quedan >= 0 && h.quedan <= 3; }).length,
      venc: pend.filter(function (h) { return h.quedan != null && h.quedan < 0; }).length,
      resp: H.length - pend.length,
      fallos: H.filter(function (h) { return h.correo_fallido; }).length
    };
    var b = $("#m-pend"); b.textContent = pend.length; b.hidden = !pend.length;
    var avisos = [];
    if (!E.libro.completa) avisos.push('<div class="aviso aviso-av" role="alert"><span><b>Faltan datos del negocio.</b> Tu Libro de Reclamaciones no se publica hasta completar razón social, RUC, dirección y correo.</span><a href="#/configuracion">Completar datos</a></div>');
    if (E.correoListo === false) avisos.push('<div class="aviso aviso-av" role="alert"><span><b>El envío de correos aún no está configurado.</b> Las hojas se registran, pero las copias y respuestas quedan pendientes de envío.</span></div>');
    if (k.venc) avisos.push('<div class="aviso aviso-err" role="alert"><span><b>' + k.venc + (k.venc === 1 ? " hoja está" : " hojas están") + " fuera de plazo.</b> Respóndelas cuanto antes.</span></div>");
    if (k.pronto) avisos.push('<div class="aviso aviso-av"><span><b>' + k.pronto + (k.pronto === 1 ? " hoja vence" : " hojas vencen") + " en 3 días hábiles o menos.</b></span></div>");
    if (k.fallos) avisos.push('<div class="aviso aviso-av"><span><b>' + k.fallos + (k.fallos === 1 ? " hoja tiene" : " hojas tienen") + " correos sin enviar.</b> Ábrelas para reintentar el envío.</span></div>");

    $("#vista").innerHTML =
      (avisos.length ? '<div class="avisos">' + avisos.join("") + "</div>" : "") +
      '<div class="cab-vista"><div><p class="rotulo">Libro de Reclamaciones</p><h1>Reclamos y quejas</h1></div>' +
      '<button type="button" class="btn btn-sec" id="refrescar">Actualizar</button></div>' +
      '<div class="kpis">' +
        kpi("Este mes", k.mes) + kpi("Reclamos pendientes", k.recl) + kpi("Quejas pendientes", k.quej) +
        kpi("Vencen en 3 días", k.pronto, k.pronto ? "alerta" : "") + kpi("Fuera de plazo", k.venc, k.venc ? "peligro" : "") + kpi("Respondidos", k.resp) +
      "</div>" +
      '<div class="filtros">' +
        '<label class="sr" for="f-texto">Buscar por código o nombre</label><input type="search" id="f-texto" placeholder="Buscar por código o nombre" value="' + esc(E.filtro.texto) + '">' +
        '<select id="f-tipo" aria-label="Tipo"><option value="">Todos los tipos</option><option value="reclamo">Reclamos</option><option value="queja">Quejas</option></select>' +
        '<select id="f-estado" aria-label="Estado"><option value="">Todos los estados</option><option value="pendiente">Pendientes</option><option value="nuevo">Nuevos</option><option value="en_atencion">En atención</option><option value="respondido">Respondidos</option><option value="vencido">Fuera de plazo</option></select>' +
        '<select id="f-periodo" aria-label="Periodo"><option value="30">Últimos 30 días</option><option value="90">Últimos 90 días</option><option value="365">Último año</option><option value="todo">Todo (2 años o más)</option></select>' +
        '<button type="button" class="btn btn-sec" id="exportar">Exportar a Excel (CSV)</button>' +
      "</div>" +
      '<div class="tabla"><table><caption class="sr">Hojas de reclamación</caption><thead><tr><th scope="col">Código</th><th scope="col">Registro</th><th scope="col">Consumidor</th><th scope="col">Tipo</th><th scope="col">Producto o servicio</th><th scope="col">Estado</th><th scope="col">Responder hasta</th><th scope="col">Responsable</th><th scope="col"><span class="sr">Acción</span></th></tr></thead><tbody id="filas"></tbody></table></div>' +
      '<p class="nota">Las hojas se conservan como mínimo 2 años y no se pueden borrar ni modificar.</p>';
    $("#f-tipo").value = E.filtro.tipo; $("#f-estado").value = E.filtro.estado; $("#f-periodo").value = E.filtro.periodo;
    ["f-texto", "f-tipo", "f-estado", "f-periodo"].forEach(function (id) {
      $("#" + id).addEventListener(id === "f-texto" ? "input" : "change", function (ev) { E.filtro[id.slice(2)] = ev.target.value; pintarFilas(); });
    });
    $("#refrescar").onclick = function () { vistaLista(); };
    $("#exportar").onclick = exportar;
    pintarFilas();
  }
  function kpi(t, n, cls) { return '<div class="kpi ' + (cls || "") + '"><span>' + t + "</span><b>" + n + "</b></div>"; }
  function filtradas() {
    var f = E.filtro, t = f.texto.trim().toLowerCase(), desde = f.periodo === "todo" ? 0 : Date.now() - Number(f.periodo) * 86400000;
    return E.hojas.filter(function (h) {
      if (t && (h.codigo + " " + h.nombre).toLowerCase().indexOf(t) < 0) return false;
      if (f.tipo && h.tipo !== f.tipo) return false;
      if (f.estado === "pendiente" && h.estado === "respondido") return false;
      if (f.estado === "vencido" && !(h.estado !== "respondido" && h.quedan < 0)) return false;
      if (["nuevo", "en_atencion", "respondido"].indexOf(f.estado) >= 0 && h.estado !== f.estado) return false;
      if (new Date(h.creado_en).getTime() < desde && h.estado === "respondido") return false;
      return true;
    });
  }
  function pintarFilas() {
    var L = filtradas();
    $("#filas").innerHTML = L.length ? L.map(function (h) {
      return "<tr><td class=\"cod\">" + esc(h.codigo) + '</td><td class="num">' + esc(LR.fechaHora(h.creado_en).slice(0, 10)) + "</td><td>" + esc(h.nombre) + "</td><td>" + (h.tipo === "reclamo" ? "Reclamo" : "Queja") +
        "</td><td>" + esc(h.bien_descripcion) + (h.pedido_ref ? ' <span class="tenue">· ' + esc(h.pedido_ref) + "</span>" : "") + "</td><td>" + chip(h) + "</td><td>" + plazo(h) +
        "</td><td>" + (h.responsable ? esc(h.responsable) : '<span class="tenue">Sin asignar</span>') + '</td><td><a href="#/hoja/' + h.id + '">' + (h.estado === "respondido" ? "Ver" : "Atender") + '<span class="sr"> ' + esc(h.codigo) + "</span></a></td></tr>";
    }).join("") : '<tr><td colspan="9" class="vacio">' + (E.hojas.length ? "Ninguna hoja coincide con los filtros." : "Aún no hay hojas registradas en este libro.") + "</td></tr>";
  }
  function exportar() {
    var cols = ["Código", "Fecha de registro", "Consumidor", "Tipo", "Producto o servicio", "Pedido", "Estado", "Responder hasta", "Respondido el", "Responsable"];
    var filas = filtradas().map(function (h) {
      return [h.codigo, LR.fechaHora(h.creado_en), h.nombre, h.tipo, h.bien_descripcion, h.pedido_ref || "", ESTADOS[h.estado], LR.fecha(h.fecha_limite), h.respondido_en ? LR.fechaHora(h.respondido_en) : "", h.responsable || ""];
    });
    var csv = "﻿" + [cols].concat(filas).map(function (r) { return r.map(function (c) { c = String(c == null ? "" : c); if (/^[=+\-@]/.test(c)) c = "'" + c; return '"' + c.replace(/"/g, '""') + '"'; }).join(";"); }).join("\r\n");
    LR.descargar(new Blob([csv], { type: "text/csv;charset=utf-8" }), "reclamos-" + E.libro.slug + "-" + limaHoy() + ".csv");
  }

  // ---------- detalle ----------
  async function vistaDetalle(id) {
    var v = $("#vista");
    v.innerHTML = '<div class="cargando" role="status"><span class="girando" aria-hidden="true"></span>Cargando la hoja…</div>';
    var h;
    try { h = await rpc("lr_hoja", { p_hoja: id }); } catch (e) { v.innerHTML = '<a href="#/">← Reclamos y quejas</a><div class="aviso aviso-err" role="alert">' + esc(e.message) + "</div>"; return; }
    var puede = h.rol === "admin" || h.rol === "responsable";
    var enviada = (h.respuestas || []).filter(function (r) { return r.estado === "enviada"; })[0];
    var borrador = (h.respuestas || []).filter(function (r) { return r.estado === "borrador"; })[0];
    var pendientes = (h.correos || []).filter(function (c) { return c.estado !== "enviado" && c.tipo !== "respuesta"; });
    var TIPOS_CORREO = { constancia: "Copia al consumidor", aviso_negocio: "Aviso al negocio", respuesta: "Respuesta formal" };
    var ESTADOS_CORREO = { enviado: "enviado", pendiente: "pendiente", fallido: "no se pudo enviar" };

    var hoja = [
      ["Consumidor", h.nombre + " · " + (LR.DOCS[h.doc_tipo] || h.doc_tipo) + " " + h.doc_numero],
      ["Domicilio", h.domicilio], ["Contacto", [h.telefono, h.correo].filter(Boolean).join(" · ")],
      h.menor ? ["Padre, madre o apoderado", h.apoderado_nombre + " · " + h.apoderado_doc] : null,
      ["Producto o servicio", (h.bien === "producto" ? "Producto" : "Servicio") + " · " + h.bien_descripcion],
      h.pedido_ref ? ["Pedido o comprobante", h.pedido_ref] : null,
      h.fecha_compra ? ["Fecha de compra", LR.fecha(h.fecha_compra)] : null,
      h.monto != null ? ["Monto reclamado", LR.soles(h.monto)] : null,
      ["Qué pasó", h.hechos], ["Solución pedida", h.pedido_consumidor]
    ].filter(Boolean).map(function (f) { return "<dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd>"; }).join("");
    var adj = (h.adjuntos || []).map(function (a) { return '<li><button type="button" class="btn-link" data-adjunto="' + esc(a.ruta) + '">' + esc(a.nombre) + "</button></li>"; }).join("");

    var resp;
    if (enviada) {
      resp = '<h2 id="t-resp">Respuesta enviada</h2><div class="enviada">' + esc(enviada.contenido) + '</div><p class="nota">Enviada el ' + esc(LR.fechaHora(enviada.enviado_en)) + " al correo del consumidor" + (enviada.evidencia && enviada.evidencia.mensaje_id ? " · comprobante de envío " + esc(String(enviada.evidencia.mensaje_id).slice(0, 60)) : "") + ".</p>";
    } else if (puede) {
      resp = '<h2 id="t-resp">Respuesta formal</h2>' +
        '<label class="campo">Responsable<select id="d-resp"><option value="">Sin asignar</option>' + (h.equipo || []).map(function (u) { return '<option value="' + u.id + '"' + (u.id === h.responsable_id ? " selected" : "") + ">" + esc(u.nombre) + "</option>"; }).join("") + "</select></label>" +
        '<label class="campo">Respuesta al consumidor<textarea id="d-texto" rows="8" maxlength="6000">' + esc(borrador ? borrador.contenido : "") + "</textarea>" +
        '<span class="ayuda">Se envía al correo ' + esc(h.correo) + " con los datos del negocio y el código de la hoja. Guardar un borrador no cuenta como respuesta.</span></label>" +
        '<div id="d-error" class="aviso aviso-err" role="alert" hidden></div>' +
        '<div class="fila-botones"><button type="button" class="btn btn-sec" id="d-borrador">Guardar borrador</button><button type="button" class="btn btn-pri" id="d-previa">Vista previa y envío</button></div>';
    } else {
      resp = '<h2 id="t-resp">Respuesta formal</h2><p class="nota">Aún no se envía una respuesta. Tu rol solo permite consultar.</p>';
    }

    v.innerHTML = '<a href="#/" class="volver-lista">← Reclamos y quejas</a>' +
      '<div class="cab-vista"><div><h1 class="num">' + esc(h.codigo) + " " + chip(h) + "</h1><p class=\"nota\">" + (h.tipo === "reclamo" ? "Reclamo" : "Queja") + " · presentado el " + esc(LR.fechaHora(h.creado_en)) + "</p></div>" +
      '<div class="plazo-caja"><span>Responder hasta</span><b class="num">' + esc(LR.fecha(h.fecha_limite)) + "</b> " + '<span class="tenue">· ' + (h.estado === "respondido" ? "respondido" : h.quedan < 0 ? "vencido hace " + (-h.quedan) + " días hábiles" : h.quedan === 0 ? "vence hoy" : "quedan " + h.quedan + " días hábiles") + "</span></div></div>" +
      '<div class="det">' +
        '<section class="tarjeta" aria-labelledby="t-hoja"><div class="det-cab"><h2 id="t-hoja">Hoja presentada</h2><span class="tenue">Original, no se puede editar</span></div><dl>' + hoja + "</dl>" +
          (adj ? '<p class="etq">Adjuntos</p><ul class="lista-adj">' + adj + "</ul>" : "") +
          '<button type="button" class="btn btn-sec" id="d-pdf">Descargar hoja (PDF)</button></section>' +
        '<div class="col">' +
          '<section class="tarjeta" aria-labelledby="t-resp">' + resp + "</section>" +
          '<section class="tarjeta" aria-labelledby="t-correos"><h2 id="t-correos">Correos</h2><ul class="historial">' +
            (h.correos || []).map(function (c) { return '<li><time>' + (c.enviado_en ? esc(LR.fechaHora(c.enviado_en)) : "—") + "</time><span>" + TIPOS_CORREO[c.tipo] + ": <b>" + ESTADOS_CORREO[c.estado] + "</b>" + (c.intentos > 1 ? ' <span class="tenue">(' + c.intentos + " intentos)</span>" : "") + "</span></li>"; }).join("") +
          "</ul>" + (pendientes.length && puede ? '<div class="fila-botones"><button type="button" class="btn btn-sec" id="d-reintentar">Reintentar envío</button></div>' : "") + "</section>" +
          '<section class="tarjeta" aria-labelledby="t-hist"><h2 id="t-hist">Historial</h2><ol class="historial">' +
            (h.historial || []).map(function (x) { return "<li><time>" + esc(LR.fechaHora(x.creado_en)) + "</time><span>" + esc(x.descripcion) + (x.usuario ? ' <span class="tenue">· ' + esc(x.usuario) + "</span>" : "") + "</span></li>"; }).join("") +
          "</ol></section>" +
        "</div></div>";
    $("#vista").focus({ preventScroll: true }); window.scrollTo(0, 0);

    $("#d-pdf").onclick = async function (ev) {
      var b = ev.currentTarget; ocupado(b, true, "Preparando…");
      try { LR.descargar(await fn({ accion: "pdf_panel", hoja: h.id }, true), h.codigo + ".pdf"); } catch (e) { toast(e.message); }
      ocupado(b, false);
    };
    $$("[data-adjunto]").forEach(function (b) {
      b.onclick = async function () {
        var w = window.open("", "_blank");
        try { var r = await fn({ accion: "adjunto", hoja: h.id, ruta: b.dataset.adjunto }); if (w) w.location = r.url; else location.href = r.url; }
        catch (e) { if (w) w.close(); toast(e.message); }
      };
    });
    if ($("#d-reintentar")) $("#d-reintentar").onclick = async function (ev) {
      var b = ev.currentTarget; ocupado(b, true, "Enviando…");
      try { var r = await fn({ accion: "reintentar", hoja: h.id }); toast(r.enviados + " de " + r.total + " correos enviados."); } catch (e) { toast(e.message); }
      vistaDetalle(h.id);
    };
    if (!puede || enviada) return;
    $("#d-resp").onchange = async function (ev) {
      try { await rpc("lr_asignar", { p_hoja: h.id, p_usuario: ev.target.value || null }); toast("Responsable actualizado."); vistaDetalle(h.id); } catch (e) { toast(e.message); }
    };
    function errorD(m) { var e = $("#d-error"); e.textContent = m; e.hidden = !m; }
    $("#d-borrador").onclick = async function (ev) {
      var b = ev.currentTarget, t = $("#d-texto").value.trim();
      if (t.length < 10) return errorD("Escribe la respuesta (mínimo 10 caracteres).");
      ocupado(b, true);
      try { await rpc("lr_guardar_borrador", { p_hoja: h.id, p_contenido: t }); toast("Borrador guardado. Aún no se envió."); vistaDetalle(h.id); }
      catch (e) { ocupado(b, false); errorD(e.message); }
    };
    $("#d-previa").onclick = function () {
      var t = $("#d-texto").value.trim();
      if (t.length < 10) return errorD("Escribe la respuesta (mínimo 10 caracteres).");
      errorD("");
      abrirDialogo('<h2 id="dlg-t">Vista previa de la respuesta</h2>' +
        '<p class="nota">Para: ' + esc(h.correo) + " · Asunto: Respuesta a tu " + (h.tipo === "reclamo" ? "reclamo" : "queja") + " " + esc(h.codigo) + "</p>" +
        '<div class="enviada">' + esc(t) + "</div>" +
        '<p class="leyenda">Al enviarla quedará registrada con fecha, hora y tu nombre, y la hoja pasará a «Respondido». No se puede modificar después.</p>' +
        '<div id="dlg-error" class="aviso aviso-err" role="alert" hidden></div>' +
        '<div class="fila-botones"><button type="button" class="btn btn-sec" id="dlg-cancelar">Seguir editando</button><button type="button" class="btn btn-pri" id="dlg-enviar">Enviar respuesta</button></div>');
      $("#dlg-cancelar").onclick = cerrarDialogo;
      $("#dlg-enviar").onclick = async function (ev) {
        var b = ev.currentTarget; ocupado(b, true, "Enviando…"); $("#dlg-cancelar").disabled = true;
        try { await fn({ accion: "responder", hoja: h.id, contenido: t }); cerrarDialogo(); toast("Respuesta enviada al consumidor."); vistaDetalle(h.id); }
        catch (e) { ocupado(b, false); $("#dlg-cancelar").disabled = false; var d = $("#dlg-error"); d.textContent = e.message; d.hidden = false; }
      };
    };
  }
  function abrirDialogo(html) { var d = $("#dlg"); $("#dlg-cuerpo").innerHTML = html; d.setAttribute("aria-labelledby", "dlg-t"); d.showModal(); }
  function cerrarDialogo() { $("#dlg").close(); }

  // ---------- configuración ----------
  async function vistaConfig() {
    var v = $("#vista");
    v.innerHTML = '<div class="cargando" role="status"><span class="girando" aria-hidden="true"></span>Cargando…</div>';
    var c, sinLibro = null;
    try { c = await rpc("lr_config", { p_libro: E.libro.id }); } catch (e) { v.innerHTML = '<div class="aviso aviso-err">' + esc(e.message) + "</div>"; return; }
    try { sinLibro = await rpc("lr_negocios_sin_libro"); } catch (e) {}
    var admin = c.rol === "admin", dis = admin ? "" : " disabled";
    var url = location.origin + "/libro/" + c.slug;
    function campo(nombre, etq, tipo, extra, ayuda) {
      return '<label class="campo' + (extra || "") + '">' + etq + '<input type="' + tipo + '" name="' + nombre + '" value="' + esc(c[nombre] || "") + '"' + dis + ">" + (ayuda ? '<span class="ayuda">' + ayuda + "</span>" : "") + "</label>";
    }
    v.innerHTML = '<div class="cab-vista"><div><p class="rotulo">Libro de Reclamaciones</p><h1>Configuración</h1></div></div>' +
      '<div class="avisos">' + (c.completa
        ? '<div class="aviso aviso-ok" role="status"><span><b>Tu libro está publicado.</b> Enlace público: <a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + "</a></span><button type=\"button\" class=\"btn-link\" id=\"copiar\">Copiar enlace</button></div>"
        : '<div class="aviso aviso-av" role="alert"><span><b>Faltan datos obligatorios.</b> Completa razón social, RUC, dirección y correo responsable. Hasta entonces, el libro no se publica.</span></div>') + "</div>" +
      '<form id="f-config" class="form-config" novalidate>' +
        campo("razon_social", "Razón social", "text", "", "Tal como figura en SUNAT.") + campo("nombre_comercial", "Nombre comercial", "text") +
        campo("ruc", "RUC", "text", "", "11 dígitos.") + campo("correo_responsable", "Correo responsable de reclamos", "email", "", "Aquí llegan los avisos de cada hoja nueva.") +
        campo("direccion", "Dirección del establecimiento", "text", " ancho") +
        campo("responsable_nombre", "Nombre del responsable de atención", "text") + campo("telefono", "Teléfono de contacto", "tel") +
        campo("sitio_url", "Página web del negocio", "url", "", "Para el botón «Volver al sitio».") + campo("privacidad_url", "Política de privacidad del negocio", "url") +
        campo("logo_url", "Logo (enlace https a la imagen)", "url", " ancho", "Opcional. Si no hay logo, se muestra la inicial del nombre.") +
        '<div class="campo"><label for="c-color">Color de la marca</label><div class="color-fila"><input type="color" id="c-color" value="' + esc(c.color) + '"' + dis + '><input type="text" name="color" value="' + esc(c.color) + '" maxlength="7" pattern="#[0-9A-Fa-f]{6}" aria-label="Código del color"' + dis + "></div></div>" +
        '<div id="c-error" class="aviso aviso-err ancho" role="alert" hidden></div>' +
        (admin ? '<div class="ancho fila-botones"><button type="submit" class="btn btn-pri" id="c-guardar">Guardar datos</button></div>' : '<p class="nota ancho">Solo el administrador del negocio puede cambiar estos datos.</p>') +
      "</form>" +
      (Array.isArray(sinLibro) ? '<section class="tarjeta" aria-labelledby="t-nuevo"><h2 id="t-nuevo" class="h2-sec">Superadmin · crear un libro</h2>' +
        '<form id="f-nuevo" class="form-config" novalidate>' +
          '<label class="campo">Negocio de las apps<select name="negocio"><option value="">Otro proveedor (sin cuenta en Microapps)</option>' + sinLibro.map(function (n) { return '<option value="' + n.id + '" data-slug="' + esc(n.slug) + '" data-nombre="' + esc(n.nombre) + '">' + esc(n.nombre) + "</option>"; }).join("") + "</select></label>" +
          '<label class="campo">Nombre comercial<input type="text" name="nombre" required></label>' +
          '<label class="campo">Enlace (minúsculas y guiones)<input type="text" name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required></label>' +
          '<div class="fila-botones ancho"><button type="submit" class="btn btn-sec">Crear libro</button></div></form></section>' : "");
    var color = $("#c-color"), colorT = $('[name="color"]');
    if (color) { color.oninput = function () { colorT.value = color.value.toUpperCase(); }; colorT.oninput = function () { if (/^#[0-9a-f]{6}$/i.test(colorT.value)) color.value = colorT.value; }; }
    if ($("#copiar")) $("#copiar").onclick = function () { navigator.clipboard.writeText(url).then(function () { toast("Enlace copiado."); }); };
    if (admin) $("#f-config").onsubmit = async function (ev) {
      ev.preventDefault();
      var f = ev.target, d = {}, err = $("#c-error");
      $$("input[name]", f).forEach(function (i) { d[i.name] = i.value.trim(); });
      d.ruc = d.ruc.replace(/\D/g, "");
      var e = [];
      if (d.ruc && !/^(10|15|16|17|20)\d{9}$/.test(d.ruc)) e.push("El RUC debe tener 11 dígitos y empezar con 10, 15, 16, 17 o 20.");
      if (d.correo_responsable && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(d.correo_responsable)) e.push("Revisa el correo responsable.");
      ["sitio_url", "privacidad_url", "logo_url"].forEach(function (k) { if (d[k] && !/^https:\/\//.test(d[k])) e.push("Los enlaces deben empezar con https://."); });
      if (!/^#[0-9a-f]{6}$/i.test(d.color)) e.push("El color debe tener el formato #RRGGBB.");
      if (e.length) { err.textContent = e.filter(function (x, i) { return e.indexOf(x) === i; }).join(" "); err.hidden = false; return; }
      err.hidden = true;
      var b = $("#c-guardar"); ocupado(b, true);
      try {
        var r = await rpc("lr_guardar_config", { p_libro: E.libro.id, p: d });
        Object.assign(E.libro, { nombre_comercial: r.nombre_comercial, color: r.color, completa: r.completa });
        elegirLibroSinRuta(); toast(r.completa ? "Datos guardados. Tu libro está publicado." : "Datos guardados. Aún faltan datos obligatorios."); vistaConfig();
      } catch (x) { ocupado(b, false); err.textContent = x.message; err.hidden = false; }
    };
    if ($("#f-nuevo")) {
      var fn2 = $("#f-nuevo");
      fn2.negocio.onchange = function () { var o = fn2.negocio.selectedOptions[0]; if (o.value) { fn2.nombre.value = o.dataset.nombre; fn2.slug.value = o.dataset.slug; } };
      fn2.onsubmit = async function (ev) {
        ev.preventDefault();
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fn2.slug.value) || !fn2.nombre.value.trim()) return toast("Completa el nombre y un enlace válido.");
        try { await rpc("lr_crear_libro", { p_slug: fn2.slug.value, p_nombre: fn2.nombre.value.trim(), p_negocio: fn2.negocio.value || null }); toast("Libro creado."); E.libros = await rpc("lr_mis_libros"); location.reload(); }
        catch (x) { toast(x.message); }
      };
    }
  }
  function elegirLibroSinRuta() { LR.aplicarMarca(E.libro.color); $("#m-nombre").textContent = E.libro.nombre_comercial; }

  // ---------- equipo ----------
  async function vistaEquipo() {
    var v = $("#vista");
    if (E.libro.rol !== "admin") { location.hash = "#/"; return; }
    v.innerHTML = '<div class="cargando" role="status"><span class="girando" aria-hidden="true"></span>Cargando…</div>';
    var eq;
    try { eq = await rpc("lr_equipo", { p_libro: E.libro.id }); } catch (e) { v.innerHTML = '<div class="aviso aviso-err">' + esc(e.message) + "</div>"; return; }
    var ROLES = '<option value="">Sin acceso</option><option value="responsable">Responsable de reclamos</option><option value="auditor">Auditor (solo consulta)</option><option value="admin">Administrador</option>';
    var activos = {}; (eq.miembros || []).forEach(function (m) { if (m.activo) activos[m.usuario_id] = m.rol; });
    var personas = {}; (eq.candidatos || []).concat(eq.miembros || []).forEach(function (p) { personas[p.usuario_id] = personas[p.usuario_id] || p; });
    var lista = Object.keys(personas).map(function (id) {
      var p = personas[id];
      return '<li><span><b>' + esc(p.nombre) + "</b>" + (p.app ? ' <span class="tenue">· ' + esc(p.app) + "</span>" : "") + '</span><label class="sr" for="r-' + id + '">Acceso de ' + esc(p.nombre) + '</label><select id="r-' + id + '" data-usuario="' + id + '">' + ROLES + "</select></li>";
    }).join("");
    v.innerHTML = '<div class="cab-vista"><div><p class="rotulo">Libro de Reclamaciones</p><h1>Equipo de reclamos</h1></div></div>' +
      '<p class="bajada">El dueño del negocio siempre es administrador. Da acceso a tu personal: el responsable atiende y responde; el auditor solo consulta.</p>' +
      (lista ? '<ul class="lista-equipo">' + lista + "</ul>" : '<p class="nota">Aún no hay personal registrado en las apps de este negocio.</p>');
    $$("[data-usuario]").forEach(function (s) {
      s.value = activos[s.dataset.usuario] || "";
      s.onchange = async function () {
        try { await rpc("lr_dar_acceso", { p_libro: E.libro.id, p_usuario: s.dataset.usuario, p_rol: s.value || null }); toast("Acceso actualizado."); }
        catch (e) { toast(e.message); vistaEquipo(); }
      };
    });
  }

  iniciar();
})();
