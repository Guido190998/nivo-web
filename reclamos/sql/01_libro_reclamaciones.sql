-- Libro de Reclamaciones Virtual de Nivo (proyecto Supabase «Microapps»).
-- Las tablas viven en el esquema privado «reclamos» (no expuesto por la API).
-- El navegador solo usa funciones public.lr_* que validan permisos en el servidor;
-- la función de borde «reclamos» registra las hojas y envía los correos con la clave de servicio.

create schema if not exists reclamos;
revoke all on schema reclamos from public, anon, authenticated;

-- 1. Libros: uno por proveedor (un negocio de core.negocios, o Nivo mismo).
create table reclamos.libros (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  negocio_id uuid unique references core.negocios(id) on delete restrict,
  razon_social text,
  nombre_comercial text not null,
  ruc text check (ruc is null or ruc ~ '^(10|15|16|17|20)[0-9]{9}$'),
  direccion text,
  correo_responsable text check (correo_responsable is null or correo_responsable ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  responsable_nombre text,
  telefono text,
  logo_url text,
  color text not null default '#0F2747' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  privacidad_url text,
  sitio_url text,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- La configuración está completa solo si tiene todos los datos legales obligatorios.
create or replace function reclamos.config_completa(l reclamos.libros) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(nullif(trim(l.razon_social), '') is not null
     and l.ruc is not null
     and nullif(trim(l.direccion), '') is not null
     and l.correo_responsable is not null, false)
$$;

-- 2. Equipo del libro: responsables y auditores (el dueño del negocio y los superadmins son administradores siempre).
create table reclamos.miembros (
  libro_id uuid not null references reclamos.libros(id) on delete cascade,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  rol text not null check (rol in ('admin', 'responsable', 'auditor')),
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  primary key (libro_id, usuario_id)
);

-- 3. Numeración correlativa por libro y año, sin saltos ni duplicados.
create table reclamos.contadores (
  libro_id uuid not null references reclamos.libros(id) on delete restrict,
  anio int not null,
  ultimo int not null default 0,
  primary key (libro_id, anio)
);

-- 4. Feriados nacionales (para contar días hábiles).
create table reclamos.feriados (fecha date primary key, nombre text not null);

-- 5. Hojas de reclamación. Los datos del consumidor no se pueden cambiar ni borrar.
create table reclamos.hojas (
  id uuid primary key default gen_random_uuid(),
  libro_id uuid not null references reclamos.libros(id) on delete restrict,
  anio int not null,
  numero int not null,
  codigo text not null,
  token text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  idem text not null,
  creado_en timestamptz not null default now(),
  fecha_limite date not null,
  -- consumidor
  nombre text not null,
  doc_tipo text not null check (doc_tipo in ('DNI', 'CE', 'PASAPORTE', 'RUC', 'OTRO')),
  doc_numero text not null,
  domicilio text not null,
  telefono text,
  correo text not null,
  menor boolean not null default false,
  apoderado_nombre text,
  apoderado_doc text,
  -- bien contratado
  tipo text not null check (tipo in ('reclamo', 'queja')),
  bien text not null check (bien in ('producto', 'servicio')),
  bien_descripcion text not null,
  pedido_ref text,
  fecha_compra date,
  monto numeric(12,2) check (monto is null or monto >= 0),
  -- detalle
  hechos text not null,
  pedido_consumidor text not null,
  adjuntos jsonb not null default '[]'::jsonb,
  acepto boolean not null check (acepto),
  proveedor jsonb not null,           -- copia de los datos del proveedor al momento de presentar
  ip_hash text,
  -- gestión
  estado text not null default 'nuevo' check (estado in ('nuevo', 'en_atencion', 'respondido')),
  responsable_id uuid references auth.users(id) on delete set null,
  respondido_en timestamptz,
  unique (libro_id, anio, numero),
  unique (libro_id, codigo),
  unique (libro_id, idem),
  check (not menor or (apoderado_nombre is not null and apoderado_doc is not null))
);
create index hojas_libro_fecha on reclamos.hojas (libro_id, creado_en desc);
create index hojas_libro_estado on reclamos.hojas (libro_id, estado, fecha_limite);
create index hojas_ip on reclamos.hojas (ip_hash, creado_en);

-- 6. Respuestas formales: preparación y envío por separado.
create table reclamos.respuestas (
  id uuid primary key default gen_random_uuid(),
  hoja_id uuid not null references reclamos.hojas(id) on delete restrict,
  contenido text not null check (length(trim(contenido)) > 0),
  preparado_en timestamptz not null default now(),
  preparado_por uuid references auth.users(id),
  estado text not null default 'borrador' check (estado in ('borrador', 'enviando', 'enviada', 'fallida')),
  enviado_en timestamptz,
  enviado_por uuid references auth.users(id),
  evidencia jsonb
);
create unique index respuestas_un_borrador on reclamos.respuestas (hoja_id) where estado in ('borrador', 'enviando');

-- 7. Historial de actuaciones (solo se agregan filas).
create table reclamos.historial (
  id bigint generated always as identity primary key,
  hoja_id uuid not null references reclamos.hojas(id) on delete restrict,
  usuario_id uuid references auth.users(id),
  accion text not null,
  descripcion text not null,
  antes jsonb,
  despues jsonb,
  creado_en timestamptz not null default now()
);
create index historial_hoja on reclamos.historial (hoja_id, creado_en);

-- 8. Correos: cada envío queda registrado; los fallidos se pueden reintentar.
create table reclamos.correos (
  id uuid primary key default gen_random_uuid(),
  hoja_id uuid not null references reclamos.hojas(id) on delete restrict,
  tipo text not null check (tipo in ('constancia', 'aviso_negocio', 'respuesta')),
  respuesta_id uuid references reclamos.respuestas(id),
  para text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviado', 'fallido')),
  intentos int not null default 0,
  error text,
  mensaje_id text,
  enviado_en timestamptz,
  creado_en timestamptz not null default now()
);
create index correos_pendientes on reclamos.correos (estado, creado_en) where estado <> 'enviado';

-- Nadie entra a estas tablas directo desde el navegador.
alter table reclamos.libros enable row level security;
alter table reclamos.miembros enable row level security;
alter table reclamos.contadores enable row level security;
alter table reclamos.feriados enable row level security;
alter table reclamos.hojas enable row level security;
alter table reclamos.respuestas enable row level security;
alter table reclamos.historial enable row level security;
alter table reclamos.correos enable row level security;

-- Protecciones: la hoja original no se edita ni se borra; el historial solo crece.
create or replace function reclamos.proteger_hoja() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las hojas de reclamación no se pueden borrar (se conservan al menos 2 años).';
  end if;
  if (new.libro_id, new.anio, new.numero, new.codigo, new.token, new.idem, new.creado_en, new.fecha_limite,
      new.nombre, new.doc_tipo, new.doc_numero, new.domicilio, new.telefono, new.correo, new.menor,
      new.apoderado_nombre, new.apoderado_doc, new.tipo, new.bien, new.bien_descripcion, new.pedido_ref,
      new.fecha_compra, new.monto, new.hechos, new.pedido_consumidor, new.adjuntos, new.acepto, new.proveedor, new.ip_hash)
     is distinct from
     (old.libro_id, old.anio, old.numero, old.codigo, old.token, old.idem, old.creado_en, old.fecha_limite,
      old.nombre, old.doc_tipo, old.doc_numero, old.domicilio, old.telefono, old.correo, old.menor,
      old.apoderado_nombre, old.apoderado_doc, old.tipo, old.bien, old.bien_descripcion, old.pedido_ref,
      old.fecha_compra, old.monto, old.hechos, old.pedido_consumidor, old.adjuntos, old.acepto, old.proveedor, old.ip_hash) then
    raise exception 'Los datos presentados por el consumidor no se pueden modificar.';
  end if;
  return new;
end $$;
create trigger hojas_proteger before update or delete on reclamos.hojas
for each row execute function reclamos.proteger_hoja();

create or replace function reclamos.solo_agregar() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'El historial no se puede modificar ni borrar.';
end $$;
create trigger historial_solo_agregar before update or delete on reclamos.historial
for each row execute function reclamos.solo_agregar();

create or replace function reclamos.proteger_respuesta() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Las respuestas no se pueden borrar.'; end if;
  if old.estado = 'enviada' then raise exception 'Una respuesta enviada no se puede modificar.'; end if;
  return new;
end $$;
create trigger respuestas_proteger before update or delete on reclamos.respuestas
for each row execute function reclamos.proteger_respuesta();

-- Días hábiles: lunes a viernes sin feriados nacionales; se cuenta desde el día siguiente.
create or replace function reclamos.sumar_habiles(p_desde date, p_dias int) returns date
language plpgsql stable set search_path = '' as $$
declare d date := p_desde; n int := 0;
begin
  while n < p_dias loop
    d := d + 1;
    if extract(isodow from d) < 6 and not exists (select 1 from reclamos.feriados f where f.fecha = d) then
      n := n + 1;
    end if;
  end loop;
  return d;
end $$;

create or replace function reclamos.habiles_entre(p_desde date, p_hasta date) returns int
language sql stable set search_path = '' as $$
  select count(*)::int from generate_series(p_desde + 1, p_hasta, interval '1 day') g(d)
  where extract(isodow from g.d) < 6 and not exists (select 1 from reclamos.feriados f where f.fecha = g.d::date)
$$;

-- Rol del usuario actual en un libro: admin, responsable, auditor o nulo.
create or replace function reclamos.mi_rol(p_libro uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when core.es_superadmin() then 'admin'
    when exists (select 1 from reclamos.libros l join core.negocios n on n.id = l.negocio_id
                 where l.id = p_libro and n.dueno_id = auth.uid()) then 'admin'
    else (select m.rol from reclamos.miembros m where m.libro_id = p_libro and m.usuario_id = auth.uid() and m.activo)
  end
$$;

-- Registro de una hoja (solo la usa la función de borde con la clave de servicio).
-- Numeración atómica: el contador se bloquea dentro de la misma transacción.
create or replace function reclamos.registrar(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  l reclamos.libros;
  h reclamos.hojas;
  v_anio int := extract(year from (now() at time zone 'America/Lima'))::int;
  v_num int;
  v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  select * into l from reclamos.libros where slug = p->>'libro' and activo;
  if not found or not reclamos.config_completa(l) then
    raise exception 'LIBRO_NO_DISPONIBLE';
  end if;

  -- Reintento del mismo envío (doble clic, recarga o corte de conexión): devuelve la hoja ya creada.
  select * into h from reclamos.hojas where libro_id = l.id and idem = p->>'idem';
  if found then
    return jsonb_build_object('id', h.id, 'codigo', h.codigo, 'token', h.token, 'repetido', true);
  end if;

  insert into reclamos.contadores (libro_id, anio, ultimo) values (l.id, v_anio, 1)
  on conflict (libro_id, anio) do update set ultimo = reclamos.contadores.ultimo + 1
  returning ultimo into v_num;

  insert into reclamos.hojas (
    libro_id, anio, numero, codigo, idem, fecha_limite,
    nombre, doc_tipo, doc_numero, domicilio, telefono, correo, menor, apoderado_nombre, apoderado_doc,
    tipo, bien, bien_descripcion, pedido_ref, fecha_compra, monto, hechos, pedido_consumidor,
    adjuntos, acepto, proveedor, ip_hash)
  values (
    l.id, v_anio, v_num, 'LR-' || v_anio || '-' || lpad(v_num::text, 6, '0'), p->>'idem',
    reclamos.sumar_habiles(v_hoy, 15),
    p->>'nombre', p->>'doc_tipo', p->>'doc_numero', p->>'domicilio', nullif(p->>'telefono', ''), lower(p->>'correo'),
    coalesce((p->>'menor')::boolean, false), nullif(p->>'apoderado_nombre', ''), nullif(p->>'apoderado_doc', ''),
    p->>'tipo', p->>'bien', p->>'bien_descripcion', nullif(p->>'pedido_ref', ''),
    nullif(p->>'fecha_compra', '')::date, nullif(p->>'monto', '')::numeric,
    p->>'hechos', p->>'pedido_consumidor', coalesce(p->'adjuntos', '[]'::jsonb), (p->>'acepto')::boolean,
    jsonb_build_object('razon_social', l.razon_social, 'nombre_comercial', l.nombre_comercial, 'ruc', l.ruc,
                       'direccion', l.direccion, 'correo', l.correo_responsable, 'telefono', l.telefono),
    p->>'ip_hash')
  returning * into h;

  insert into reclamos.historial (hoja_id, accion, descripcion)
  values (h.id, 'registro', 'Hoja registrada por el consumidor.');

  insert into reclamos.correos (hoja_id, tipo, para) values (h.id, 'constancia', h.correo);
  insert into reclamos.correos (hoja_id, tipo, para) values (h.id, 'aviso_negocio', l.correo_responsable);

  return jsonb_build_object('id', h.id, 'codigo', h.codigo, 'token', h.token, 'repetido', false);
end $$;
revoke all on function reclamos.registrar(jsonb) from public, anon, authenticated;

-- ===================== Funciones públicas (API) =====================

-- Datos del proveedor para la página pública del libro (solo si la configuración está completa).
create or replace function public.lr_libro_publico(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('slug', l.slug, 'razon_social', l.razon_social, 'nombre_comercial', l.nombre_comercial,
    'ruc', l.ruc, 'direccion', l.direccion, 'telefono', l.telefono, 'correo', l.correo_responsable,
    'logo_url', l.logo_url, 'color', l.color, 'privacidad_url', l.privacidad_url, 'sitio_url', l.sitio_url,
    'disponible', l.activo and reclamos.config_completa(l))
  from reclamos.libros l where l.slug = lower(p_slug)
$$;

-- Libros que el usuario puede gestionar.
create or replace function public.lr_mis_libros() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x->>'nombre_comercial'), '[]'::jsonb) from (
    select jsonb_build_object('id', l.id, 'slug', l.slug, 'nombre_comercial', l.nombre_comercial, 'color', l.color,
      'logo_url', l.logo_url, 'rol', reclamos.mi_rol(l.id), 'completa', reclamos.config_completa(l),
      'pendientes', (select count(*) from reclamos.hojas h where h.libro_id = l.id and h.estado <> 'respondido')) x
    from reclamos.libros l where reclamos.mi_rol(l.id) is not null
  ) t
$$;

-- Configuración completa del libro (para la pantalla Configuración).
create or replace function public.lr_config(p_libro uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare l reclamos.libros;
begin
  if reclamos.mi_rol(p_libro) is null then raise exception 'SIN_PERMISO'; end if;
  select * into l from reclamos.libros where id = p_libro;
  return to_jsonb(l) || jsonb_build_object('completa', reclamos.config_completa(l), 'rol', reclamos.mi_rol(p_libro));
end $$;

create or replace function public.lr_guardar_config(p_libro uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l reclamos.libros;
begin
  if reclamos.mi_rol(p_libro) is distinct from 'admin' then raise exception 'SIN_PERMISO'; end if;
  update reclamos.libros set
    razon_social = nullif(trim(p->>'razon_social'), ''),
    nombre_comercial = coalesce(nullif(trim(p->>'nombre_comercial'), ''), nombre_comercial),
    ruc = nullif(regexp_replace(coalesce(p->>'ruc', ''), '\D', '', 'g'), ''),
    direccion = nullif(trim(p->>'direccion'), ''),
    correo_responsable = nullif(lower(trim(p->>'correo_responsable')), ''),
    responsable_nombre = nullif(trim(p->>'responsable_nombre'), ''),
    telefono = nullif(trim(p->>'telefono'), ''),
    logo_url = nullif(trim(p->>'logo_url'), ''),
    color = coalesce(nullif(p->>'color', ''), color),
    privacidad_url = nullif(trim(p->>'privacidad_url'), ''),
    sitio_url = nullif(trim(p->>'sitio_url'), ''),
    actualizado_en = now()
  where id = p_libro returning * into l;
  return to_jsonb(l) || jsonb_build_object('completa', reclamos.config_completa(l));
end $$;

-- Lista de hojas con su plazo.
create or replace function public.lr_hojas(p_libro uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  if reclamos.mi_rol(p_libro) is null then raise exception 'SIN_PERMISO'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', h.id, 'codigo', h.codigo, 'creado_en', h.creado_en, 'nombre', h.nombre, 'tipo', h.tipo,
      'bien_descripcion', h.bien_descripcion, 'pedido_ref', h.pedido_ref, 'estado', h.estado,
      'fecha_limite', h.fecha_limite, 'respondido_en', h.respondido_en,
      'quedan', case when h.estado = 'respondido' then null
                     when h.fecha_limite < v_hoy then -reclamos.habiles_entre(h.fecha_limite, v_hoy)
                     else reclamos.habiles_entre(v_hoy, h.fecha_limite) end,
      'responsable', (select coalesce(u.raw_user_meta_data->>'nombre', split_part(u.email, '@', 1)) from auth.users u where u.id = h.responsable_id),
      'correo_fallido', exists (select 1 from reclamos.correos c where c.hoja_id = h.id and c.estado = 'fallido')
    ) order by h.creado_en desc) from reclamos.hojas h where h.libro_id = p_libro), '[]'::jsonb);
end $$;

-- Detalle completo de una hoja.
create or replace function public.lr_hoja(p_hoja uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h reclamos.hojas; v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  select * into h from reclamos.hojas where id = p_hoja;
  if not found or reclamos.mi_rol(h.libro_id) is null then raise exception 'SIN_PERMISO'; end if;
  return (to_jsonb(h) - 'token' - 'idem' - 'ip_hash') || jsonb_build_object(
    'rol', reclamos.mi_rol(h.libro_id),
    'quedan', case when h.estado = 'respondido' then null
                   when h.fecha_limite < v_hoy then -reclamos.habiles_entre(h.fecha_limite, v_hoy)
                   else reclamos.habiles_entre(v_hoy, h.fecha_limite) end,
    'responsable', (select coalesce(u.raw_user_meta_data->>'nombre', split_part(u.email, '@', 1)) from auth.users u where u.id = h.responsable_id),
    'respuestas', coalesce((select jsonb_agg(to_jsonb(r) order by r.preparado_en) from reclamos.respuestas r where r.hoja_id = h.id), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('creado_en', x.creado_en, 'accion', x.accion, 'descripcion', x.descripcion,
        'usuario', (select coalesce(u.raw_user_meta_data->>'nombre', split_part(u.email, '@', 1)) from auth.users u where u.id = x.usuario_id))
        order by x.creado_en, x.id) from reclamos.historial x where x.hoja_id = h.id), '[]'::jsonb),
    'correos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'tipo', c.tipo, 'para', c.para, 'estado', c.estado,
        'intentos', c.intentos, 'enviado_en', c.enviado_en) order by c.creado_en) from reclamos.correos c where c.hoja_id = h.id), '[]'::jsonb),
    'equipo', public.lr_equipo_simple(h.libro_id)
  );
end $$;

-- Personas que pueden ser responsables de un libro.
create or replace function public.lr_equipo_simple(p_libro uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(distinct jsonb_build_object('id', u.id,
      'nombre', coalesce(u.raw_user_meta_data->>'nombre', split_part(u.email, '@', 1)))), '[]'::jsonb)
  from auth.users u
  where reclamos.mi_rol(p_libro) is not null and (
    u.id in (select m.usuario_id from reclamos.miembros m where m.libro_id = p_libro and m.activo and m.rol in ('admin', 'responsable'))
    or u.id in (select n.dueno_id from reclamos.libros l join core.negocios n on n.id = l.negocio_id where l.id = p_libro))
$$;
revoke all on function public.lr_equipo_simple(uuid) from public, anon;

create or replace function public.lr_asignar(p_hoja uuid, p_usuario uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare h reclamos.hojas; v_nombre text;
begin
  select * into h from reclamos.hojas where id = p_hoja for update;
  if not found or coalesce(reclamos.mi_rol(h.libro_id), '') not in ('admin', 'responsable') then raise exception 'SIN_PERMISO'; end if;
  if p_usuario is not null and not exists (select 1 from jsonb_array_elements(public.lr_equipo_simple(h.libro_id)) e where (e->>'id')::uuid = p_usuario) then
    raise exception 'Esa persona no es parte del equipo de reclamos.';
  end if;
  select coalesce(raw_user_meta_data->>'nombre', split_part(email, '@', 1)) into v_nombre from auth.users where id = p_usuario;
  update reclamos.hojas set responsable_id = p_usuario,
    estado = case when estado = 'nuevo' then 'en_atencion' else estado end
  where id = p_hoja;
  insert into reclamos.historial (hoja_id, usuario_id, accion, descripcion, antes, despues)
  values (p_hoja, auth.uid(), 'asignacion', coalesce('Asignado a ' || v_nombre || '.', 'Sin responsable asignado.'),
          jsonb_build_object('responsable_id', h.responsable_id), jsonb_build_object('responsable_id', p_usuario));
end $$;

create or replace function public.lr_guardar_borrador(p_hoja uuid, p_contenido text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare h reclamos.hojas; v_id uuid;
begin
  select * into h from reclamos.hojas where id = p_hoja;
  if not found or coalesce(reclamos.mi_rol(h.libro_id), '') not in ('admin', 'responsable') then raise exception 'SIN_PERMISO'; end if;
  if h.estado = 'respondido' then raise exception 'Esta hoja ya fue respondida.'; end if;
  if length(trim(coalesce(p_contenido, ''))) < 10 then raise exception 'Escribe la respuesta (mínimo 10 caracteres).'; end if;
  update reclamos.respuestas set contenido = p_contenido, preparado_en = now(), preparado_por = auth.uid()
  where hoja_id = p_hoja and estado = 'borrador' returning id into v_id;
  if v_id is null then
    insert into reclamos.respuestas (hoja_id, contenido, preparado_por) values (p_hoja, p_contenido, auth.uid()) returning id into v_id;
  end if;
  update reclamos.hojas set estado = 'en_atencion' where id = p_hoja and estado = 'nuevo';
  insert into reclamos.historial (hoja_id, usuario_id, accion, descripcion)
  values (p_hoja, auth.uid(), 'borrador', 'Borrador de respuesta guardado (aún no enviado).');
  return v_id;
end $$;

-- Equipo de reclamos: listar y dar o quitar acceso (solo administradores).
create or replace function public.lr_equipo(p_libro uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if reclamos.mi_rol(p_libro) is distinct from 'admin' then raise exception 'SIN_PERMISO'; end if;
  return jsonb_build_object(
    'miembros', coalesce((select jsonb_agg(jsonb_build_object('usuario_id', m.usuario_id, 'rol', m.rol, 'activo', m.activo,
        'nombre', coalesce(u.raw_user_meta_data->>'nombre', split_part(u.email, '@', 1))) order by m.creado_en)
      from reclamos.miembros m join auth.users u on u.id = m.usuario_id where m.libro_id = p_libro), '[]'::jsonb),
    'candidatos', coalesce((select jsonb_agg(distinct jsonb_build_object('usuario_id', cm.usuario_id,
        'nombre', coalesce(cm.nombre, u.raw_user_meta_data->>'nombre', split_part(u.email, '@', 1)), 'app', cm.app))
      from reclamos.libros l join core.miembros cm on cm.negocio_id = l.negocio_id join auth.users u on u.id = cm.usuario_id
      where l.id = p_libro), '[]'::jsonb));
end $$;

create or replace function public.lr_dar_acceso(p_libro uuid, p_usuario uuid, p_rol text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if reclamos.mi_rol(p_libro) is distinct from 'admin' then raise exception 'SIN_PERMISO'; end if;
  if p_rol is null then
    update reclamos.miembros set activo = false where libro_id = p_libro and usuario_id = p_usuario;
    return;
  end if;
  if p_rol not in ('admin', 'responsable', 'auditor') then raise exception 'Rol no válido.'; end if;
  if not core.es_superadmin() and not exists (select 1 from reclamos.libros l join core.miembros cm on cm.negocio_id = l.negocio_id
                 where l.id = p_libro and cm.usuario_id = p_usuario) then
    raise exception 'Solo puedes dar acceso a personas de tu equipo.';
  end if;
  insert into reclamos.miembros (libro_id, usuario_id, rol) values (p_libro, p_usuario, p_rol)
  on conflict (libro_id, usuario_id) do update set rol = excluded.rol, activo = true;
end $$;

-- Superadmin: crear el libro de un negocio (o de Nivo) con datos aún por completar.
create or replace function public.lr_crear_libro(p_slug text, p_nombre text, p_negocio uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not core.es_superadmin() then raise exception 'SIN_PERMISO'; end if;
  insert into reclamos.libros (slug, nombre_comercial, negocio_id) values (lower(p_slug), p_nombre, p_negocio) returning id into v_id;
  return v_id;
end $$;

-- Superadmin: negocios de las apps que aún no tienen libro.
create or replace function public.lr_negocios_sin_libro() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when core.es_superadmin() then coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'slug', n.slug, 'nombre', n.nombre) order by n.nombre), '[]'::jsonb) end
  from core.negocios n where not exists (select 1 from reclamos.libros l where l.negocio_id = n.id)
$$;

-- Solo usuarios con sesión usan las funciones del panel; la página pública solo lee el proveedor.
revoke all on function public.lr_mis_libros(), public.lr_config(uuid), public.lr_guardar_config(uuid, jsonb), public.lr_hojas(uuid),
  public.lr_hoja(uuid), public.lr_asignar(uuid, uuid), public.lr_guardar_borrador(uuid, text), public.lr_equipo(uuid),
  public.lr_dar_acceso(uuid, uuid, text), public.lr_crear_libro(text, text, uuid), public.lr_negocios_sin_libro() from public, anon;
grant execute on function public.lr_mis_libros(), public.lr_config(uuid), public.lr_guardar_config(uuid, jsonb), public.lr_hojas(uuid),
  public.lr_hoja(uuid), public.lr_asignar(uuid, uuid), public.lr_guardar_borrador(uuid, text), public.lr_equipo(uuid),
  public.lr_dar_acceso(uuid, uuid, text), public.lr_crear_libro(text, text, uuid), public.lr_negocios_sin_libro(), public.lr_equipo_simple(uuid) to authenticated;
revoke all on function public.lr_libro_publico(text) from public;
grant execute on function public.lr_libro_publico(text) to anon, authenticated;

-- Feriados nacionales del Perú 2026 y 2027 (revisar cada año y agregar los nuevos).
insert into reclamos.feriados (fecha, nombre) values
 ('2026-01-01','Año Nuevo'),('2026-04-02','Jueves Santo'),('2026-04-03','Viernes Santo'),('2026-05-01','Día del Trabajo'),
 ('2026-06-07','Batalla de Arica y Día de la Bandera'),('2026-06-29','San Pedro y San Pablo'),('2026-07-23','Día de la Fuerza Aérea'),
 ('2026-07-28','Fiestas Patrias'),('2026-07-29','Fiestas Patrias'),('2026-08-06','Batalla de Junín'),('2026-08-30','Santa Rosa de Lima'),
 ('2026-10-08','Combate de Angamos'),('2026-11-01','Todos los Santos'),('2026-12-08','Inmaculada Concepción'),
 ('2026-12-09','Batalla de Ayacucho'),('2026-12-25','Navidad'),
 ('2027-01-01','Año Nuevo'),('2027-03-25','Jueves Santo'),('2027-03-26','Viernes Santo'),('2027-05-01','Día del Trabajo'),
 ('2027-06-07','Batalla de Arica y Día de la Bandera'),('2027-06-29','San Pedro y San Pablo'),('2027-07-23','Día de la Fuerza Aérea'),
 ('2027-07-28','Fiestas Patrias'),('2027-07-29','Fiestas Patrias'),('2027-08-06','Batalla de Junín'),('2027-08-30','Santa Rosa de Lima'),
 ('2027-10-08','Combate de Angamos'),('2027-11-01','Todos los Santos'),('2027-12-08','Inmaculada Concepción'),
 ('2027-12-09','Batalla de Ayacucho'),('2027-12-25','Navidad');

-- Libro de Nivo como proveedor de las apps (datos del titular publicados en las páginas legales).
insert into reclamos.libros (slug, nombre_comercial, razon_social, ruc, direccion, correo_responsable, responsable_nombre, telefono, sitio_url, privacidad_url)
values ('nivo', 'Nivo', 'Guido Alonso Pacheco Villacorta', '10730237648', 'Calle Huancabamba Mz. I-4 Lt. 12, Santiago de Surco, Lima',
        'guido1998.14@gmail.com', 'Guido Alonso Pacheco Villacorta', '965 604 732', 'https://nivo-pe.vercel.app', 'https://nivo-pe.vercel.app/privacidad');

-- Un libro por cada negocio existente; quedan sin publicar hasta que su dueño complete los datos.
insert into reclamos.libros (slug, nombre_comercial, negocio_id)
select n.slug, n.nombre, n.id from core.negocios n
where not exists (select 1 from reclamos.libros l where l.slug = n.slug or l.negocio_id = n.id);

-- Bucket privado para los adjuntos (solo lo usa la función de borde).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reclamos-adjuntos', 'reclamos-adjuntos', false, 5242880, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;
