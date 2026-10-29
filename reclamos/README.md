# Libro de Reclamaciones virtual de Nivo

Módulo reutilizable para que Nivo y cada negocio que usa sus apps tengan su propio Libro de Reclamaciones virtual.

## Dónde está cada cosa

| Parte | Dónde vive | Dirección |
|---|---|---|
| Página pública (formulario) | `reclamos/libro.html` + `libro.js` | `https://nivo-pe.vercel.app/libro/<negocio>` |
| Constancia | `reclamos/constancia.html` + `constancia.js` | `https://nivo-pe.vercel.app/libro/<negocio>/constancia?c=…&t=…` |
| Panel del negocio | `reclamos/panel.html` + `panel.js` | `https://nivo-pe.vercel.app/reclamos/panel?libro=<negocio>` |
| Base de datos | `reclamos/sql/01_libro_reclamaciones.sql` | Supabase «Microapps», esquema privado `reclamos` |
| Función del servidor | `reclamos/supabase/functions/reclamos/index.ts` | Supabase «Microapps», función `reclamos` |

## Cómo funciona

- **Un libro por proveedor:** el de Nivo es `nivo`. Cada negocio de las apps tiene el suyo con su mismo enlace (por ejemplo `dandu`).
- **Libro sin publicar:** un libro no se publica hasta tener razón social, RUC, dirección y correo responsable. El dueño los completa en el panel, en «Configuración».
- **Registro de la hoja:**
  - La función `reclamos` valida los datos en el servidor.
  - Limita a 6 hojas por hora por conexión.
  - Guarda los adjuntos en el depósito privado `reclamos-adjuntos`.
  - Asigna el código correlativo dentro de la base, con una operación atómica: `LR-AAAA-NNNNNN`, por libro y por año.
  - Si llega el mismo envío dos veces (doble clic o recarga), devuelve la misma hoja.
- **Correos:** se envían desde Gmail: copia al consumidor con el PDF adjunto y aviso al negocio.
  - Si un envío falla, la hoja no se pierde: el correo queda «fallido».
  - El panel muestra el aviso y permite «Reintentar envío».
- **Plazo:** 15 días hábiles, de lunes a viernes sin feriados nacionales, contados desde el día siguiente. Los feriados están en la tabla `reclamos.feriados`.
- **Respuesta formal:**
  - Guardar un borrador no cuenta como respuesta.
  - Solo al enviarla se registra la fecha, quién la envió y el identificador del correo, y la hoja pasa a «Respondido».
- **Datos protegidos:** la hoja original, las respuestas enviadas y el historial no se pueden editar ni borrar. Lo impiden reglas dentro de la base de datos.
- **Permisos:**
  - El dueño del negocio y los superadmins son administradores.
  - El administrador da acceso de «responsable» o «auditor» a su personal desde «Equipo».
  - Todos los permisos se verifican en el servidor.

## Variables y secretos

| Nombre | Dónde | Para qué |
|---|---|---|
| `GMAIL_USER` | Supabase › Edge Functions › Secrets | Correo desde el que se envían las copias: soluciones.digitales.nivo@gmail.com |
| `GMAIL_APP_PASSWORD` | Supabase › Edge Functions › Secrets | Contraseña de aplicación de esa cuenta de Google (no la contraseña normal) |
| `SITIO_RECLAMOS` | Opcional, mismo lugar | Dirección de la web si cambia de dominio (por defecto `https://nivo-pe.vercel.app`) |
| `SUPABASE_URL`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | Las pone Supabase solo | Conexión de la función con la base |
| `reclamos/config.js` | Esta web | Dirección del proyecto y clave pública «anon» |

## Instalar en otro proyecto

1. Correr `reclamos/sql/01_libro_reclamaciones.sql` en el editor SQL de Supabase. Requiere el esquema `core`, con `negocios`, `miembros` y `es_superadmin`.
2. Publicar la función `reclamos` sin verificación de JWT, porque hace su propia validación.
3. Cargar los secretos de la tabla anterior.
4. Copiar la carpeta `reclamos/` a la web y agregar a `vercel.json` las direcciones `/libro/:slug` y `/libro/:slug/constancia`, y las reglas de seguridad de esa carpeta.
5. Agregar en el pie de cada web un enlace visible «Libro de Reclamaciones» hacia `/libro/<negocio>`.
6. Si cambia de dominio, actualizar `ORIGENES` en la función y `SITIO_RECLAMOS`.

## Mantenimiento

- Cada año, antes del 1 de enero, agregar los feriados del año siguiente a `reclamos.feriados`. Están cargados 2026 y 2027.
- Las hojas se conservan como mínimo 2 años y no se borran.

## Requisitos legales

Revisado el 28 de octubre de 2026. No reemplaza la revisión de un abogado.

**Verificados:**
- **Constancia:** se entrega en pantalla, por correo y en PDF imprimible (Ley N.° 29571, art. 150; Reglamento DS 011-2011-PCM y modificatorias).
- **Datos de la hoja:**
  - Proveedor: razón social, RUC y dirección.
  - Consumidor: nombre, documento, domicilio, teléfono, correo y apoderado si es menor.
  - Bien: tipo, descripción, monto, pedido y fecha.
  - Detalle: reclamo o queja, hechos y pedido del consumidor.
  - Además: fecha y aceptación electrónica.
- **Plazo:** 15 días hábiles improrrogables para reclamos y quejas (DS 101-2022-PCM, arts. 6 y 6-B).
- **Reclamo sin pago previo:** no se condiciona la atención al pago del producto o servicio.
- **Numeración:** correlativa y sin saltos, generada en el servidor.
- **Conservación:** 2 años como mínimo.
- **Sin datos de más:** no se piden datos innecesarios ni autorización de publicidad.
- **Enlace visible:** en el pie de la web y de cada tienda, sin registro ni compra previa (Ley N.° 32495 y proyecto de reglamento de julio de 2026).
- **Protección de datos:** aviso de privacidad, finalidad limitada y medidas de seguridad (Ley N.° 29733).

**Pendientes de validar:**
- **Reglamento de la Ley N.° 32495:** sigue en consulta pública (RM 244-2026-PCM). Cuando se publique la versión final, revisar los campos mínimos, los adjuntos y las reglas para plataformas con varios vendedores. El proyecto propone un libro único y centralizado para esas plataformas.
- **Formato oficial (Anexo I):** comparar el texto final de la hoja con el Anexo I vigente del Reglamento.
- **Días no laborables:** confirmar si los que declara el Gobierno para el sector público deben excluirse del plazo.
- **Datos de cada negocio:** cada uno debe registrar su razón social, RUC y dirección reales. El sistema no los inventa ni los completa.
- **Correo de envío:** definir con un abogado si basta enviar desde un Gmail personal o conviene un correo con dominio propio.
