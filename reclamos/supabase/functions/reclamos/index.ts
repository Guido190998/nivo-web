// Función «reclamos» del Libro de Reclamaciones de Nivo (proyecto Supabase «Microapps»).
// Acciones públicas: registrar una hoja, ver y descargar su constancia.
// Acciones con sesión: enviar la respuesta formal, reintentar correos y abrir adjuntos.
// Secretos que debe cargar el dueño en Supabase: GMAIL_USER y GMAIL_APP_PASSWORD.
import postgres from "npm:postgres@3.4.4";
import nodemailer from "npm:nodemailer@6.9.14";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const env = (k: string) => Deno.env.get(k) ?? "";
const SUPABASE_URL = env("SUPABASE_URL");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = env("SUPABASE_ANON_KEY");
const SITIO = env("SITIO_RECLAMOS") || "https://nivo-pe.vercel.app";
const BUCKET = "reclamos-adjuntos";
const ORIGENES = ["https://nivo-pe.vercel.app", "http://localhost:8820", "http://127.0.0.1:8820"];

const sql = postgres(env("SUPABASE_DB_URL"), { max: 3, prepare: false, idle_timeout: 20 });

class Falla extends Error {
  constructor(public status: number, mensaje: string) { super(mensaje); }
}

function cors(origen: string | null) {
  const ok = origen && (ORIGENES.includes(origen) || /^https:\/\/nivo-pe(-[a-z0-9-]+)?\.vercel\.app$/.test(origen));
  return {
    "Access-Control-Allow-Origin": ok ? origen! : ORIGENES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (data: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { ...h, "Content-Type": "application/json; charset=utf-8" } });

// ---------- utilidades ----------
const texto = (v: unknown, max: number) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const fechaLima = (iso: string | Date, conHora = true) => new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric",
  ...(conHora ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
}).format(new Date(iso));
const fechaLarga = (d: string) => new Intl.DateTimeFormat("es-PE", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T00:00:00Z"));
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const soles = (n: unknown) => n == null || n === "" ? "" : "S/ " + Number(n).toFixed(2);
async function sha256(s: string) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
const DOCS: Record<string, string> = { DNI: "DNI", CE: "Carné de extranjería", PASAPORTE: "Pasaporte", RUC: "RUC", OTRO: "Otro documento" };

// ---------- validación de la hoja ----------
function validar(b: Record<string, unknown>) {
  const e: string[] = [];
  const p = {
    libro: texto(b.libro, 60).toLowerCase(),
    idem: texto(b.idem, 64),
    nombre: texto(b.nombre, 160),
    doc_tipo: texto(b.doc_tipo, 12).toUpperCase(),
    doc_numero: texto(b.doc_numero, 20).toUpperCase(),
    domicilio: texto(b.domicilio, 240),
    telefono: texto(b.telefono, 20),
    correo: texto(b.correo, 160).toLowerCase(),
    menor: b.menor === true,
    apoderado_nombre: texto(b.apoderado_nombre, 160),
    apoderado_doc: texto(b.apoderado_doc, 20),
    tipo: texto(b.tipo, 10),
    bien: texto(b.bien, 10),
    bien_descripcion: texto(b.bien_descripcion, 300),
    pedido_ref: texto(b.pedido_ref, 60),
    fecha_compra: texto(b.fecha_compra, 10),
    monto: texto(b.monto, 14).replace(/[^\d.,]/g, "").replace(",", "."),
    hechos: texto(b.hechos, 4000),
    pedido_consumidor: texto(b.pedido_consumidor, 2000),
    acepto: b.acepto === true,
  };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.libro)) e.push("libro");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(p.idem)) e.push("idem");
  if (p.nombre.length < 3) e.push("nombre");
  if (!DOCS[p.doc_tipo]) e.push("doc_tipo");
  const docOk = p.doc_tipo === "DNI" ? /^\d{8}$/.test(p.doc_numero) : p.doc_tipo === "RUC" ? /^\d{11}$/.test(p.doc_numero) : /^[A-Z0-9-]{5,20}$/.test(p.doc_numero);
  if (!docOk) e.push("doc_numero");
  if (p.domicilio.length < 5) e.push("domicilio");
  if (p.telefono && !/^[\d +()-]{6,20}$/.test(p.telefono)) e.push("telefono");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(p.correo)) e.push("correo");
  if (p.menor && (p.apoderado_nombre.length < 3 || p.apoderado_doc.length < 5)) e.push("apoderado");
  if (!["reclamo", "queja"].includes(p.tipo)) e.push("tipo");
  if (!["producto", "servicio"].includes(p.bien)) e.push("bien");
  if (p.bien_descripcion.length < 3) e.push("bien_descripcion");
  if (p.fecha_compra && !/^\d{4}-\d{2}-\d{2}$/.test(p.fecha_compra)) e.push("fecha_compra");
  if (p.fecha_compra && new Date(p.fecha_compra) > new Date(Date.now() + 86400000)) e.push("fecha_compra");
  if (p.monto && !/^\d{1,9}(\.\d{1,2})?$/.test(p.monto)) e.push("monto");
  if (p.hechos.length < 10) e.push("hechos");
  if (p.pedido_consumidor.length < 3) e.push("pedido_consumidor");
  if (!p.acepto) e.push("acepto");
  return { p, errores: e };
}

// ---------- adjuntos ----------
const TIPOS_ADJ: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf" };
function b64aBytes(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function tipoReal(bytes: Uint8Array) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  return "";
}
async function subirAdjuntos(libro: string, idem: string, lista: unknown) {
  if (!Array.isArray(lista) || lista.length === 0) return [];
  if (lista.length > 3) throw new Falla(400, "Puedes adjuntar hasta 3 archivos.");
  const guardados = [];
  for (let i = 0; i < lista.length; i++) {
    const a = lista[i] as Record<string, unknown>;
    const bytes = b64aBytes(String(a.base64 || ""));
    if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) throw new Falla(400, "Cada archivo debe pesar hasta 5 MB.");
    const tipo = tipoReal(bytes);
    if (!tipo) throw new Falla(400, "Solo se aceptan archivos JPG, PNG o PDF.");
    const nombre = texto(a.nombre, 80).replace(/[^\w.\- ]/g, "_") || `archivo-${i + 1}.${TIPOS_ADJ[tipo]}`;
    const ruta = `${libro}/${idem}/${i + 1}.${TIPOS_ADJ[tipo]}`;
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${ruta}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": tipo, "x-upsert": "true" },
      body: bytes,
    });
    if (!r.ok) throw new Falla(500, "No se pudo guardar un archivo adjunto. Intenta de nuevo.");
    guardados.push({ ruta, nombre, tipo, peso: bytes.length });
  }
  return guardados;
}

// ---------- datos de una hoja ----------
type Hoja = Record<string, any>;
async function hojaPorId(id: string): Promise<Hoja> {
  // to_jsonb deja fechas y montos como texto y números simples.
  const [fila] = await sql`select to_jsonb(h) || jsonb_build_object('slug', l.slug, 'color', l.color, 'logo_url', l.logo_url,
      'correo_responsable', l.correo_responsable) as x
    from reclamos.hojas h join reclamos.libros l on l.id = h.libro_id where h.id = ${id}::uuid`;
  if (!fila) throw new Falla(404, "No encontramos esa hoja.");
  return fila.x;
}

// ---------- PDF de la constancia ----------
const WINANSI = /[^ -~ -ÿ–—‘’“”•…€\n]/g;
const limpio = (s: unknown) => String(s ?? "").replace(/\r/g, "").replace(/\t/g, " ").replace(WINANSI, "?");
async function constanciaPDF(h: Hoja) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Hoja de reclamación ${h.codigo}`);
  pdf.setAuthor(h.proveedor.nombre_comercial || "");
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const A4 = [595.28, 841.89];
  const M = 50, ANCHO = A4[0] - M * 2;
  const navy = rgb(0.06, 0.153, 0.278), gris = rgb(0.29, 0.357, 0.424);
  let page = pdf.addPage(A4 as [number, number]);
  let y = A4[1] - M;
  const nueva = () => { page = pdf.addPage(A4 as [number, number]); y = A4[1] - M; };
  const lineas = (t: string, font = f, size = 10, ancho = ANCHO) => {
    const out: string[] = [];
    for (const parrafo of limpio(t).split("\n")) {
      let linea = "";
      for (const palabra of parrafo.split(/\s+/)) {
        const prueba = linea ? linea + " " + palabra : palabra;
        if (font.widthOfTextAtSize(prueba, size) <= ancho) linea = prueba;
        else {
          if (linea) out.push(linea);
          let p = palabra;
          while (font.widthOfTextAtSize(p, size) > ancho) {
            let k = p.length; while (k > 1 && font.widthOfTextAtSize(p.slice(0, k), size) > ancho) k--;
            out.push(p.slice(0, k)); p = p.slice(k);
          }
          linea = p;
        }
      }
      out.push(linea);
    }
    return out;
  };
  const escribir = (t: string, o: { font?: any; size?: number; color?: any; x?: number; ancho?: number; gap?: number } = {}) => {
    const size = o.size ?? 10;
    for (const l of lineas(t, o.font ?? f, size, o.ancho ?? ANCHO)) {
      if (y < M + size) nueva();
      page.drawText(l, { x: o.x ?? M, y: y - size, size, font: o.font ?? f, color: o.color ?? navy });
      y -= size * 1.45;
    }
    y -= o.gap ?? 0;
  };
  const seccion = (t: string) => {
    if (y < M + 60) nueva();
    y -= 8;
    page.drawRectangle({ x: M, y: y - 18, width: ANCHO, height: 20, color: rgb(0.957, 0.945, 0.918) });
    page.drawText(limpio(t).toUpperCase(), { x: M + 8, y: y - 13, size: 9, font: fb, color: navy });
    y -= 28;
  };
  const campo = (etq: string, valor: string) => {
    if (!valor) return;
    const ancho = 140;
    const ls = lineas(valor, f, 10, ANCHO - ancho);
    if (y < M + 14 * ls.length) nueva();
    page.drawText(limpio(etq), { x: M, y: y - 10, size: 9, font: fb, color: gris });
    for (const l of ls) { page.drawText(l, { x: M + ancho, y: y - 10, size: 10, font: f, color: navy }); y -= 14.5; }
    y -= 3;
  };

  escribir(h.proveedor.nombre_comercial || "", { font: fb, size: 16 });
  escribir("LIBRO DE RECLAMACIONES · HOJA DE RECLAMACIÓN", { font: fb, size: 11, color: gris, gap: 6 });
  page.drawText(limpio(h.codigo), { x: A4[0] - M - fb.widthOfTextAtSize(h.codigo, 14), y: A4[1] - M - 16, size: 14, font: fb, color: navy });
  escribir(`Presentada el ${fechaLima(h.creado_en)} (hora de Lima). Respuesta a más tardar el ${fechaLarga(h.fecha_limite)}.`, { size: 10, gap: 4 });

  seccion("1. Proveedor");
  campo("Razón social", h.proveedor.razon_social);
  campo("Nombre comercial", h.proveedor.nombre_comercial);
  campo("RUC", h.proveedor.ruc);
  campo("Dirección", h.proveedor.direccion);
  campo("Contacto", [h.proveedor.correo, h.proveedor.telefono].filter(Boolean).join(" · "));

  seccion("2. Identificación del consumidor");
  campo("Nombre", h.nombre);
  campo("Documento", `${DOCS[h.doc_tipo] || h.doc_tipo} ${h.doc_numero}`);
  campo("Domicilio", h.domicilio);
  campo("Teléfono", h.telefono || "");
  campo("Correo", h.correo);
  if (h.menor) campo("Padre, madre o apoderado", `${h.apoderado_nombre} · ${h.apoderado_doc}`);

  seccion("3. Identificación del bien contratado");
  campo("Tipo de bien", h.bien === "producto" ? "Producto" : "Servicio");
  campo("Descripción", h.bien_descripcion);
  campo("Pedido o comprobante", h.pedido_ref || "");
  campo("Fecha de compra", h.fecha_compra ? fechaLima(h.fecha_compra + "T12:00:00Z", false) : "");
  campo("Monto reclamado", soles(h.monto));

  seccion(`4. Detalle: ${h.tipo === "reclamo" ? "Reclamo" : "Queja"}`);
  escribir(h.tipo === "reclamo"
    ? "Reclamo: disconformidad relacionada con los productos o servicios."
    : "Queja: disconformidad no relacionada con los productos o servicios, o malestar respecto a la atención al público.", { size: 9, color: gris, gap: 4 });
  campo("Detalle", h.hechos);
  campo("Pedido del consumidor", h.pedido_consumidor);
  if (Array.isArray(h.adjuntos) && h.adjuntos.length) campo("Adjuntos", h.adjuntos.map((a: any) => a.nombre).join(", "));

  seccion("5. Aceptación");
  escribir(`El consumidor confirmó electrónicamente los datos y presentó esta hoja el ${fechaLima(h.creado_en)}.`, { size: 10, gap: 8 });
  escribir("La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el Indecopi. El proveedor deberá dar respuesta al reclamo o queja en un plazo no mayor a quince (15) días hábiles improrrogables.", { size: 9, color: gris });

  const n = pdf.getPageCount();
  pdf.getPages().forEach((pg, i) => pg.drawText(limpio(`${h.codigo} · Página ${i + 1} de ${n} · Libro de Reclamaciones virtual · Nivo`), { x: M, y: 28, size: 8, font: f, color: gris }));
  return await pdf.save();
}

// ---------- correos ----------
let transporte: any = null;
function correoListo() { return !!(env("GMAIL_USER") && env("GMAIL_APP_PASSWORD")); }
function smtp() {
  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: env("GMAIL_USER"), pass: env("GMAIL_APP_PASSWORD").replace(/\s/g, "") },
    });
  }
  return transporte;
}
function plantilla(h: Hoja, titulo: string, cuerpo: string) {
  const color = /^#[0-9a-f]{6}$/i.test(h.color) ? h.color : "#0F2747";
  return `<!doctype html><html lang="es"><body style="margin:0;background:#E9E5DB;font-family:Arial,Helvetica,sans-serif;color:#0F2747">
<div style="max-width:600px;margin:0 auto;padding:24px 12px">
<div style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #DCD5C5">
<div style="background:${color};color:#F4F1EA;padding:18px 24px;border-bottom:3px solid #2E9AA3;font-size:18px;font-weight:bold">${esc(h.proveedor.nombre_comercial)}</div>
<div style="padding:24px">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.25">${esc(titulo)}</h1>
${cuerpo}
</div></div>
<p style="font-size:12px;line-height:1.5;color:#4A5B6C;margin:14px 4px 0">${esc(h.proveedor.razon_social)} · RUC ${esc(h.proveedor.ruc)} · ${esc(h.proveedor.direccion)}<br>Libro de Reclamaciones virtual con tecnología de Nivo.</p>
</div></body></html>`;
}
const filas = (pares: [string, string][]) => `<table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;margin:8px 0 16px">${
  pares.filter(([, v]) => v).map(([k, v]) => `<tr><th style="text-align:left;vertical-align:top;color:#4A5B6C;font-weight:normal;padding:7px 12px 7px 0;width:150px;border-top:1px solid #E3DED2">${esc(k)}</th><td style="padding:7px 0;border-top:1px solid #E3DED2">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>`;
const enlaceConstancia = (h: Hoja) => `${SITIO}/libro/${h.slug}/constancia?c=${encodeURIComponent(h.codigo)}&t=${h.token}`;

async function armarCorreo(tipo: string, h: Hoja, respuesta?: Hoja) {
  const tipoTxt = h.tipo === "reclamo" ? "reclamo" : "queja";
  if (tipo === "constancia") {
    const pdf = await constanciaPDF(h);
    return {
      asunto: `Constancia de tu ${tipoTxt} ${h.codigo}`,
      html: plantilla(h, h.tipo === "reclamo" ? "Recibimos tu reclamo" : "Recibimos tu queja",
        `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">Hola, ${esc(h.nombre.split(" ")[0])}. Esta es la copia de la hoja de reclamación que presentaste. Guárdala: tiene el código para hacer seguimiento.</p>
${filas([["Código", h.codigo], ["Presentada", fechaLima(h.creado_en)], ["Respuesta hasta", fechaLarga(h.fecha_limite)], ["Tipo", `${h.tipo === "reclamo" ? "Reclamo" : "Queja"} · ${h.bien === "producto" ? "Producto" : "Servicio"}`],
          ["Consumidor", `${h.nombre} · ${DOCS[h.doc_tipo] || h.doc_tipo} ${h.doc_numero}`], ["Domicilio", h.domicilio], ["Contacto", [h.telefono, h.correo].filter(Boolean).join(" · ")],
          ["Bien", [h.bien_descripcion, h.pedido_ref && `Pedido ${h.pedido_ref}`, soles(h.monto)].filter(Boolean).join(" · ")], ["Detalle", h.hechos], ["Pedido", h.pedido_consumidor]])}
<p style="margin:0 0 16px"><a href="${esc(enlaceConstancia(h))}" style="display:inline-block;background:#0F2747;color:#F4F1EA;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:8px">Ver o descargar la constancia</a></p>
<p style="font-size:13px;line-height:1.55;color:#4A5B6C;margin:0">${esc(h.proveedor.nombre_comercial)} debe responderte por escrito en un plazo no mayor a 15 días hábiles. Presentar un reclamo no te impide acudir a otras vías de solución ni es requisito para denunciar ante el Indecopi. Adjuntamos la constancia en PDF.</p>`),
      adjuntos: [{ filename: `${h.codigo}.pdf`, content: pdf, contentType: "application/pdf" }],
      para: h.correo,
    };
  }
  if (tipo === "aviso_negocio") {
    return {
      asunto: `Nuevo ${tipoTxt} ${h.codigo} · responder hasta el ${fechaLima(h.fecha_limite + "T12:00:00Z", false)}`,
      html: plantilla(h, `Nuevo ${tipoTxt} en tu Libro de Reclamaciones`,
        `<p style="font-size:15px;line-height:1.6;margin:0 0 12px">${esc(h.nombre)} presentó un ${tipoTxt}. Debes responderle por escrito a más tardar el <b>${esc(fechaLarga(h.fecha_limite))}</b> (15 días hábiles).</p>
${filas([["Código", h.codigo], ["Bien", h.bien_descripcion], ["Detalle", h.hechos.slice(0, 400)]])}
<p style="margin:0"><a href="${SITIO}/reclamos/panel?libro=${encodeURIComponent(h.slug)}" style="display:inline-block;background:#0F2747;color:#F4F1EA;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:8px">Atender en el panel</a></p>`),
      adjuntos: [],
      para: h.correo_responsable,
    };
  }
  // respuesta formal
  return {
    asunto: `Respuesta a tu ${tipoTxt} ${h.codigo}`,
    html: plantilla(h, `Respuesta a tu ${tipoTxt} ${h.codigo}`,
      `<p style="font-size:15px;line-height:1.6;margin:0 0 14px">Hola, ${esc(h.nombre.split(" ")[0])}. Esta es la respuesta de ${esc(h.proveedor.nombre_comercial)} a la hoja que presentaste el ${esc(fechaLima(h.creado_en))}.</p>
<div style="font-size:15px;line-height:1.65;padding:16px 18px;background:#F4F1EA;border-radius:10px;margin:0 0 16px">${esc(respuesta!.contenido).replace(/\n/g, "<br>")}</div>
${filas([["Código", h.codigo], ["Tu pedido", h.pedido_consumidor]])}
<p style="font-size:13px;line-height:1.55;color:#4A5B6C;margin:0">Si no estás conforme con esta respuesta, puedes acudir al Indecopi u otras vías de solución de controversias.</p>`),
    adjuntos: [],
    para: h.correo,
  };
}

async function enviarCorreo(correoId: string) {
  const [c] = await sql`update reclamos.correos set intentos = intentos + 1 where id = ${correoId} and estado <> 'enviado' returning *`;
  if (!c) return { ok: true, ya: true };
  const h = await hojaPorId(c.hoja_id);
  let respuesta: Hoja | undefined;
  if (c.respuesta_id) [respuesta] = await sql`select * from reclamos.respuestas where id = ${c.respuesta_id}`;
  try {
    if (!correoListo()) throw new Error("Falta configurar el correo de envío (GMAIL_USER y GMAIL_APP_PASSWORD).");
    const m = await armarCorreo(c.tipo, h, respuesta);
    const info = await smtp().sendMail({
      from: { name: `${h.proveedor.nombre_comercial} · Libro de Reclamaciones`.slice(0, 80), address: env("GMAIL_USER") },
      to: c.para, replyTo: h.correo_responsable || undefined,
      subject: m.asunto, html: m.html, attachments: m.adjuntos,
    });
    await sql`update reclamos.correos set estado = 'enviado', enviado_en = now(), error = null, mensaje_id = ${String(info.messageId || "")} where id = ${c.id}`;
    return { ok: true, mensaje_id: info.messageId, respuesta_smtp: String(info.response || "").slice(0, 200) };
  } catch (e) {
    const msg = String((e as Error).message || e).replace(/\S+@\S+/g, "[correo]").slice(0, 300);
    await sql`update reclamos.correos set estado = 'fallido', error = ${msg} where id = ${c.id}`;
    console.error("correo fallido", c.id, c.tipo, msg);
    return { ok: false, error: msg };
  }
}

// ---------- sesión del panel ----------
async function usuario(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token === ANON_KEY) throw new Falla(401, "Inicia sesión para continuar.");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON_KEY } });
  if (!r.ok) throw new Falla(401, "Tu sesión venció. Vuelve a ingresar.");
  const u = await r.json();
  return { id: u.id as string, email: u.email as string };
}
async function rolEn(tx: any, uid: string, libroId: string) {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, true)`;
  const [r] = await tx`select reclamos.mi_rol(${libroId}::uuid) as rol`;
  return r?.rol as string | null;
}

// ---------- acciones ----------
async function registrar(req: Request, b: Record<string, unknown>) {
  if (texto(b.web, 10)) throw new Falla(400, "No se pudo registrar.");          // trampa para robots
  const { p, errores } = validar(b);
  if (errores.length) throw new Falla(422, "Revisa los datos marcados: " + errores.join(", "));
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "sin-ip";
  const ip_hash = await sha256(ip + "|" + SERVICE_KEY.slice(-16));
  const [{ n }] = await sql`select count(*)::int as n from reclamos.hojas where ip_hash = ${ip_hash} and creado_en > now() - interval '1 hour'`;
  const [ya] = await sql`select 1 from reclamos.hojas h join reclamos.libros l on l.id = h.libro_id where l.slug = ${p.libro} and h.idem = ${p.idem}`;
  if (n >= 6 && !ya) throw new Falla(429, "Recibimos muchas hojas desde tu conexión. Intenta de nuevo en una hora.");
  const adjuntos = ya ? [] : await subirAdjuntos(p.libro, p.idem, b.adjuntos);
  let r;
  try {
    [{ r }] = await sql`select reclamos.registrar(${sql.json({ ...p, adjuntos, ip_hash })}) as r`;
  } catch (e) {
    if (String((e as Error).message).includes("LIBRO_NO_DISPONIBLE")) throw new Falla(404, "Este Libro de Reclamaciones aún no está disponible.");
    throw e;
  }
  if (!r.repetido) {
    const pendientes = await sql`select id from reclamos.correos where hoja_id = ${r.id} and estado <> 'enviado' order by tipo desc`;
    for (const c of pendientes) await enviarCorreo(c.id);
  }
  const [c] = await sql`select estado from reclamos.correos where hoja_id = ${r.id} and tipo = 'constancia'`;
  return { codigo: r.codigo, token: r.token, correo_enviado: c?.estado === "enviado" };
}

async function hojaPublica(b: Record<string, unknown>) {
  const codigo = texto(b.codigo, 20), token = texto(b.token, 80), libro = texto(b.libro, 60).toLowerCase();
  if (!/^LR-\d{4}-\d{6}$/.test(codigo) || !/^[a-f0-9]{64}$/.test(token)) throw new Falla(404, "No encontramos esa constancia.");
  const [h] = await sql`select h.id from reclamos.hojas h join reclamos.libros l on l.id = h.libro_id
    where l.slug = ${libro} and h.codigo = ${codigo} and h.token = ${token}`;
  if (!h) throw new Falla(404, "No encontramos esa constancia.");
  return await hojaPorId(h.id);
}
function vistaConsumidor(h: Hoja) {
  return {
    codigo: h.codigo, creado_en: h.creado_en, fecha_limite: h.fecha_limite, proveedor: h.proveedor, tipo: h.tipo, bien: h.bien,
    nombre: h.nombre, doc_tipo: h.doc_tipo, doc_numero: h.doc_numero, domicilio: h.domicilio, telefono: h.telefono, correo: h.correo,
    menor: h.menor, apoderado_nombre: h.apoderado_nombre, apoderado_doc: h.apoderado_doc, bien_descripcion: h.bien_descripcion,
    pedido_ref: h.pedido_ref, fecha_compra: h.fecha_compra, monto: h.monto, hechos: h.hechos, pedido_consumidor: h.pedido_consumidor,
    adjuntos: (h.adjuntos || []).map((a: any) => ({ nombre: a.nombre })), color: h.color, logo_url: h.logo_url,
  };
}

async function responder(req: Request, b: Record<string, unknown>) {
  const u = await usuario(req);
  const hojaId = texto(b.hoja, 40), contenido = texto(b.contenido, 6000);
  if (contenido.length < 10) throw new Falla(422, "Escribe la respuesta (mínimo 10 caracteres).");
  const respuestaId = await sql.begin(async (tx: any) => {
    const [h] = await tx`select * from reclamos.hojas where id = ${hojaId}::uuid for update`;
    if (!h) throw new Falla(404, "No encontramos esa hoja.");
    const rol = await rolEn(tx, u.id, h.libro_id);
    if (rol !== "admin" && rol !== "responsable") throw new Falla(403, "No tienes permiso para responder.");
    if (h.estado === "respondido") throw new Falla(409, "Esta hoja ya fue respondida.");
    const [ocupada] = await tx`select id from reclamos.respuestas where hoja_id = ${hojaId}::uuid and estado = 'enviando'`;
    if (ocupada) throw new Falla(409, "La respuesta ya se está enviando.");
    let [r] = await tx`update reclamos.respuestas set contenido = ${contenido}, preparado_en = now(), preparado_por = ${u.id}::uuid, estado = 'enviando'
      where hoja_id = ${hojaId}::uuid and estado = 'borrador' returning id`;
    if (!r) [r] = await tx`insert into reclamos.respuestas (hoja_id, contenido, preparado_por, estado) values (${hojaId}::uuid, ${contenido}, ${u.id}::uuid, 'enviando') returning id`;
    await tx`insert into reclamos.correos (hoja_id, tipo, respuesta_id, para) values (${hojaId}::uuid, 'respuesta', ${r.id}, ${h.correo})`;
    return r.id as string;
  });
  const [c] = await sql`select id from reclamos.correos where respuesta_id = ${respuestaId}`;
  const envio = await enviarCorreo(c.id);
  if (envio.ok) {
    await sql.begin(async (tx: any) => {
      await tx`update reclamos.respuestas set estado = 'enviada', enviado_en = now(), enviado_por = ${u.id}::uuid,
        evidencia = ${tx.json({ medio: "correo", para: "consumidor", mensaje_id: envio.mensaje_id, servidor: envio.respuesta_smtp, correo_id: c.id })}
        where id = ${respuestaId}`;
      await tx`update reclamos.hojas set estado = 'respondido', respondido_en = now() where id = ${hojaId}::uuid`;
      await tx`insert into reclamos.historial (hoja_id, usuario_id, accion, descripcion) values (${hojaId}::uuid, ${u.id}::uuid, 'respuesta_enviada', 'Respuesta formal enviada al correo del consumidor.')`;
    });
    return { enviada: true };
  }
  await sql`update reclamos.respuestas set estado = 'borrador' where id = ${respuestaId}`;
  await sql`insert into reclamos.historial (hoja_id, usuario_id, accion, descripcion) values (${hojaId}::uuid, ${u.id}::uuid, 'respuesta_fallida', ${"No se pudo enviar la respuesta: " + envio.error})`;
  throw new Falla(502, "No se pudo enviar el correo. La respuesta quedó como borrador; intenta de nuevo. " + envio.error);
}

async function reintentar(req: Request, b: Record<string, unknown>) {
  const u = await usuario(req);
  const hojaId = texto(b.hoja, 40);
  const [h] = await sql`select libro_id from reclamos.hojas where id = ${hojaId}::uuid`;
  if (!h) throw new Falla(404, "No encontramos esa hoja.");
  const rol = await sql.begin((tx: any) => rolEn(tx, u.id, h.libro_id));
  if (rol !== "admin" && rol !== "responsable") throw new Falla(403, "No tienes permiso.");
  const lista = await sql`select id from reclamos.correos where hoja_id = ${hojaId}::uuid and estado <> 'enviado' and tipo <> 'respuesta'`;
  const res = [];
  for (const c of lista) res.push(await enviarCorreo(c.id));
  await sql`insert into reclamos.historial (hoja_id, usuario_id, accion, descripcion) values (${hojaId}::uuid, ${u.id}::uuid, 'reintento_correo',
    ${`Reintento de correos: ${res.filter((x) => x.ok).length} enviados de ${res.length}.`})`;
  return { enviados: res.filter((x) => x.ok).length, total: res.length };
}

async function adjunto(req: Request, b: Record<string, unknown>) {
  const u = await usuario(req);
  const hojaId = texto(b.hoja, 40), ruta = texto(b.ruta, 200);
  const [h] = await sql`select libro_id, adjuntos from reclamos.hojas where id = ${hojaId}::uuid`;
  if (!h) throw new Falla(404, "No encontramos esa hoja.");
  const rol = await sql.begin((tx: any) => rolEn(tx, u.id, h.libro_id));
  if (!rol) throw new Falla(403, "No tienes permiso.");
  if (!(h.adjuntos || []).some((a: any) => a.ruta === ruta)) throw new Falla(404, "Ese archivo no pertenece a esta hoja.");
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${ruta}`, {
    method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 120 }),
  });
  if (!r.ok) throw new Falla(500, "No se pudo abrir el archivo.");
  const { signedURL } = await r.json();
  return { url: `${SUPABASE_URL}/storage/v1${signedURL}` };
}

async function pdfPanel(req: Request, b: Record<string, unknown>) {
  const u = await usuario(req);
  const h = await hojaPorId(texto(b.hoja, 40));
  const rol = await sql.begin((tx: any) => rolEn(tx, u.id, h.libro_id));
  if (!rol) throw new Falla(403, "No tienes permiso.");
  return h;
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405, h);
  try {
    const largo = Number(req.headers.get("content-length") || 0);
    if (largo > 22 * 1024 * 1024) throw new Falla(413, "Los archivos adjuntos pesan demasiado.");
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    switch (b.accion) {
      case "registrar": return json(await registrar(req, b), 200, h);
      case "constancia": return json(vistaConsumidor(await hojaPublica(b)), 200, h);
      case "constancia_pdf": {
        const hoja = await hojaPublica(b);
        return new Response(await constanciaPDF(hoja), { headers: { ...h, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${hoja.codigo}.pdf"` } });
      }
      case "pdf_panel": {
        const hoja = await pdfPanel(req, b);
        return new Response(await constanciaPDF(hoja), { headers: { ...h, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${hoja.codigo}.pdf"` } });
      }
      case "responder": return json(await responder(req, b), 200, h);
      case "reintentar": return json(await reintentar(req, b), 200, h);
      case "adjunto": return json(await adjunto(req, b), 200, h);
      case "estado_correo": return json({ configurado: correoListo() }, 200, h);
      default: throw new Falla(400, "Acción no válida.");
    }
  } catch (e) {
    if (e instanceof Falla) return json({ error: e.message }, e.status, h);
    console.error("error interno", (e as Error).message);
    return json({ error: "Ocurrió un problema. Intenta de nuevo en unos minutos." }, 500, h);
  }
});
