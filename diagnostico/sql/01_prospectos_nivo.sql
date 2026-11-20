-- NIVO · Captura de prospectos del diagnóstico comercial
-- Esquema privado: no exponer tablas directamente por PostgREST.
create schema if not exists nivo_comercial;
revoke all on schema nivo_comercial from public, anon, authenticated;

create table if not exists nivo_comercial.prospectos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 2 and 80),
  negocio text not null check (char_length(negocio) between 2 and 100),
  whatsapp text not null check (char_length(whatsapp) between 7 and 20),
  email text,
  respuestas jsonb not null default '{}'::jsonb,
  recomendacion text,
  origen text not null default 'diagnostico_web',
  consentimiento boolean not null default false check (consentimiento),
  estado text not null default 'nuevo' check (estado in ('nuevo','contactado','en_seguimiento','convertido','descartado')),
  creado_en timestamptz not null default now()
);

alter table nivo_comercial.prospectos enable row level security;
revoke all on table nivo_comercial.prospectos from public, anon, authenticated;

create or replace function public.registrar_prospecto_nivo(p_datos jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, nivo_comercial
as $$
declare
  v_id uuid;
  v_nombre text;
  v_negocio text;
  v_whatsapp text;
  v_email text;
  v_respuestas jsonb;
  v_recomendacion text;
begin
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'Solicitud inválida' using errcode = '22023';
  end if;

  v_nombre := btrim(coalesce(p_datos->>'nombre',''));
  v_negocio := btrim(coalesce(p_datos->>'negocio',''));
  v_whatsapp := btrim(coalesce(p_datos->>'whatsapp',''));
  v_email := nullif(btrim(coalesce(p_datos->>'email','')), '');
  v_respuestas := coalesce(p_datos->'respuestas', '{}'::jsonb);
  v_recomendacion := nullif(left(btrim(coalesce(p_datos->>'recomendacion','')), 100), '');

  if char_length(v_nombre) not between 2 and 80
     or char_length(v_negocio) not between 2 and 100
     or char_length(v_whatsapp) not between 7 and 20
     or v_whatsapp !~ '^[+0-9() .-]+$'
     or (v_email is not null and (char_length(v_email) > 120 or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$'))
     or jsonb_typeof(v_respuestas) <> 'object'
     or octet_length(v_respuestas::text) > 12000
     or coalesce((p_datos->>'consentimiento')::boolean, false) is not true then
    raise exception 'Datos incompletos o inválidos' using errcode = '22023';
  end if;

  insert into nivo_comercial.prospectos
    (nombre, negocio, whatsapp, email, respuestas, recomendacion, origen, consentimiento)
  values
    (v_nombre, v_negocio, v_whatsapp, v_email, v_respuestas, v_recomendacion, 'diagnostico_web', true)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.registrar_prospecto_nivo(jsonb) from public, authenticated;
grant execute on function public.registrar_prospecto_nivo(jsonb) to anon;
