/* Utilidades compartidas por el libro público, la constancia y el panel. */
(function () {
  var C = window.LR_CONFIG;

  // Llamada a una función pública de la base (RPC).
  async function rpc(nombre, args, token) {
    var r = await fetch(C.supabaseUrl + "/rest/v1/rpc/" + nombre, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: C.anonKey, Authorization: "Bearer " + (token || C.anonKey) },
      body: JSON.stringify(args || {})
    });
    var data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(traducir((data && (data.message || data.error)) || "No se pudo completar la acción."));
    return data;
  }

  // Llamada a la función del servidor «reclamos».
  async function funcion(cuerpo, token, comoArchivo) {
    var r = await fetch(C.supabaseUrl + "/functions/v1/" + C.funcion, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: C.anonKey, Authorization: "Bearer " + (token || C.anonKey) },
      body: JSON.stringify(cuerpo)
    });
    if (comoArchivo && r.ok) return await r.blob();
    var data = null;
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) { var err = new Error((data && data.error) || "No se pudo completar. Revisa tu conexión e intenta de nuevo."); err.status = r.status; throw err; }
    return data;
  }

  function traducir(m) {
    if (/SIN_PERMISO/.test(m)) return "No tienes permiso para esta acción.";
    if (/JWT expired|invalid JWT/i.test(m)) return "Tu sesión venció. Vuelve a ingresar.";
    if (/check constraint.*ruc/i.test(m)) return "El RUC debe tener 11 dígitos y empezar con 10, 15, 16, 17 o 20.";
    if (/check constraint.*correo/i.test(m)) return "Revisa el correo electrónico.";
    if (/check constraint.*color/i.test(m)) return "El color debe tener el formato #RRGGBB.";
    if (/duplicate key.*slug/i.test(m)) return "Ese enlace ya está en uso. Elige otro.";
    return m;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var fmtFechaHora = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  var fmtFecha = new Intl.DateTimeFormat("es-PE", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
  var fmtLarga = new Intl.DateTimeFormat("es-PE", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
  function fechaHora(iso) { return iso ? fmtFechaHora.format(new Date(iso)) : ""; }
  function fecha(d) { return d ? fmtFecha.format(new Date(String(d).slice(0, 10) + "T00:00:00Z")) : ""; }
  function fechaLarga(d) { return d ? fmtLarga.format(new Date(String(d).slice(0, 10) + "T00:00:00Z")) : ""; }
  function soles(n) { return n == null || n === "" ? "" : "S/ " + Number(n).toFixed(2); }

  // Color de texto legible sobre el color de la marca.
  function textoSobre(hex) {
    var h = /^#([0-9a-f]{6})$/i.exec(hex || "");
    if (!h) return "#F4F1EA";
    var n = parseInt(h[1], 16), rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var L = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return (1.05) / (L + 0.05) >= (L + 0.05) / 0.07 ? "#FFFFFF" : "#0F2747";
  }
  function aplicarMarca(color) {
    var c = /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#0F2747";
    document.documentElement.style.setProperty("--marca", c);
    document.documentElement.style.setProperty("--sobre-marca", textoSobre(c));
  }

  var DOCS = { DNI: "DNI", CE: "Carné de extranjería", PASAPORTE: "Pasaporte", RUC: "RUC", OTRO: "Otro documento" };

  function descargar(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  window.LR = { rpc: rpc, funcion: funcion, esc: esc, fechaHora: fechaHora, fecha: fecha, fechaLarga: fechaLarga, soles: soles, aplicarMarca: aplicarMarca, DOCS: DOCS, descargar: descargar, traducir: traducir };
})();
