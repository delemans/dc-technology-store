-- =====================================================================
-- WO-056 · Libro de PQR (T07): peticiones, quejas, reclamos y solicitudes de datos personales con su plazo legal
--   Plazos en días hábiles (sin sábados, domingos ni festivos de festivos_colombia, wo-048), contados desde el día
--   siguiente al que llega: consulta o datos personales 10 (Ley 1581, art. 14), reclamo y petición 15 (Ley 1581
--   art. 15 · Ley 1755). El panel ordena por lo que vence primero.
--   · registrar_pqr(): la llama el bot (service_role) cuando el cliente escribe DATOS (y otras rutas futuras).
--   · pqr_panel(), crear_pqr(), responder_pqr(): solo administradores.
-- La respuesta se guarda como constancia; al cliente se la envías tú por WhatsApp (botón «Escribirle»).
-- Requiere wo-015 (es_admin) y wo-048 (festivos_colombia). Idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.festivos_colombia') is null then
        raise exception 'Nada se aplicó. Faltan los festivos: aplica antes wo-048-horario-legal.sql.';
    end if;
    if to_regprocedure('public.es_admin()') is null then
        raise exception 'Nada se aplicó. Falta es_admin(): aplica antes wo-015.';
    end if;
end;
$$;

create table if not exists public.pqr (
    id             bigint generated always as identity primary key,
    created_at     timestamptz not null default now(),
    whatsapp       text not null check (whatsapp ~ '^\d{10,15}$'),
    tipo           text not null check (tipo in ('consulta', 'reclamo', 'peticion', 'datos')),
    canal          text not null default 'whatsapp' check (canal in ('whatsapp', 'panel', 'web', 'correo')),
    detalle        text not null check (length(detalle) between 1 and 2000),
    estado         text not null default 'ABIERTA' check (estado in ('ABIERTA', 'RESPONDIDA', 'CERRADA')),
    vence_el       date not null,
    respuesta      text check (respuesta is null or length(respuesta) <= 2000),
    respondida_at  timestamptz,
    cerrada_at     timestamptz
);
create index if not exists pqr_abiertas on public.pqr (estado, vence_el);
alter table public.pqr enable row level security;
revoke all on table public.pqr from public, anon, authenticated;

-- Fecha en que vence: N días hábiles después de p_desde (sin fines de semana ni festivos)
create or replace function public.dias_habiles_despues(p_desde date, p_dias integer)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    d date := p_desde;
    n integer := 0;
begin
    while n < greatest(coalesce(p_dias, 0), 0) loop
        d := d + 1;
        if extract(isodow from d) < 6 and not exists (select 1 from public.festivos_colombia f where f.dia = d) then
            n := n + 1;
        end if;
    end loop;
    return d;
end;
$$;
revoke all on function public.dias_habiles_despues(date, integer) from public, anon, authenticated;

create or replace function public.plazo_pqr(p_tipo text)
returns integer
language sql
immutable
set search_path = ''
as $$ select case when p_tipo in ('reclamo', 'peticion') then 15 else 10 end $$;

-- Interno: crea la PQR (o devuelve la abierta del mismo número y tipo de las últimas 24 h: el cliente repite el mensaje)
create or replace function public.guardar_pqr(p_whatsapp text, p_tipo text, p_detalle text, p_canal text)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_numero text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
    v_tipo text := lower(btrim(coalesce(p_tipo, '')));
    v_id bigint;
begin
    if v_numero ~ '^3\d{9}$' then v_numero := '57' || v_numero; end if;
    if v_numero !~ '^\d{10,15}$' then raise exception 'WhatsApp inválido'; end if;
    if v_tipo not in ('consulta', 'reclamo', 'peticion', 'datos') then raise exception 'Tipo de PQR inválido'; end if;
    select q.id into v_id from public.pqr q
     where q.whatsapp = v_numero and q.tipo = v_tipo and q.estado = 'ABIERTA' and q.created_at > now() - interval '24 hours'
     order by q.id desc limit 1;
    if v_id is not null then return v_id; end if;
    insert into public.pqr (whatsapp, tipo, canal, detalle, vence_el)
    values (v_numero, v_tipo, coalesce(nullif(p_canal, ''), 'whatsapp'), left(coalesce(nullif(btrim(p_detalle), ''), '(sin detalle)'), 2000),
            public.dias_habiles_despues((now() at time zone 'America/Bogota')::date, public.plazo_pqr(v_tipo)))
    returning id into v_id;
    return v_id;
end;
$$;
revoke all on function public.guardar_pqr(text, text, text, text) from public, anon, authenticated;

-- Bot (n8n, service_role)
drop function if exists public.registrar_pqr(text, text, text);
create function public.registrar_pqr(p_whatsapp text, p_tipo text, p_detalle text)
returns table (id bigint, vence_el date)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_id bigint := public.guardar_pqr(p_whatsapp, p_tipo, p_detalle, 'whatsapp');
begin
    return query select q.id, q.vence_el from public.pqr q where q.id = v_id;
end;
$$;
revoke all on function public.registrar_pqr(text, text, text) from public, anon, authenticated;
grant execute on function public.registrar_pqr(text, text, text) to service_role;

-- Panel: abiertas y respondidas (lo que vence primero arriba) + cerradas de los últimos 60 días
drop function if exists public.pqr_panel();
create function public.pqr_panel()
returns setof public.pqr
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not coalesce(public.es_admin(), false) then raise exception 'Solo administradores.' using errcode = '42501'; end if;
    return query
    select * from public.pqr q
     where q.estado <> 'CERRADA' or q.cerrada_at > now() - interval '60 days'
     order by (q.estado = 'CERRADA'), q.vence_el, q.id
     limit 200;
end;
$$;
revoke all on function public.pqr_panel() from public, anon;
grant execute on function public.pqr_panel() to authenticated;

drop function if exists public.crear_pqr(text, text, text, text);
create function public.crear_pqr(p_whatsapp text, p_tipo text, p_detalle text, p_canal text default 'panel')
returns table (ok boolean, mensaje text, id bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_id bigint;
begin
    if not coalesce(public.es_admin(), false) then raise exception 'Solo administradores.' using errcode = '42501'; end if;
    begin
        v_id := public.guardar_pqr(p_whatsapp, p_tipo, p_detalle, case when p_canal in ('panel', 'web', 'correo', 'whatsapp') then p_canal else 'panel' end);
    exception when others then
        return query select false, sqlerrm::text, null::bigint; return;
    end;
    return query select true, 'PQR registrada.'::text, v_id;
end;
$$;
revoke all on function public.crear_pqr(text, text, text, text) from public, anon;
grant execute on function public.crear_pqr(text, text, text, text) to authenticated;

drop function if exists public.responder_pqr(bigint, text, boolean);
create function public.responder_pqr(p_id bigint, p_respuesta text, p_cerrar boolean default true)
returns table (ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if not coalesce(public.es_admin(), false) then raise exception 'Solo administradores.' using errcode = '42501'; end if;
    if length(btrim(coalesce(p_respuesta, ''))) < 3 then
        return query select false, 'Escribe la respuesta que le diste al cliente.'::text; return;
    end if;
    update public.pqr q
       set respuesta = left(btrim(p_respuesta), 2000),
           respondida_at = coalesce(q.respondida_at, now()),
           estado = case when coalesce(p_cerrar, true) then 'CERRADA' else 'RESPONDIDA' end,
           cerrada_at = case when coalesce(p_cerrar, true) then now() else null end
     where q.id = p_id and q.estado <> 'CERRADA';
    if not found then
        return query select false, 'La PQR no existe o ya estaba cerrada.'::text; return;
    end if;
    return query select true, case when coalesce(p_cerrar, true) then 'PQR respondida y cerrada.' else 'Respuesta guardada.' end::text;
end;
$$;
revoke all on function public.responder_pqr(bigint, text, boolean) from public, anon;
grant execute on function public.responder_pqr(bigint, text, boolean) to authenticated;

-- Verificación: un reclamo recibido el viernes 6/11/2026 vence 15 días hábiles después (sin el festivo del 16/11)
select public.dias_habiles_despues('2026-11-06', 15) = date '2026-11-30' as ok_plazo,
       to_regprocedure('public.registrar_pqr(text, text, text)') is not null as ok_bot,
       to_regprocedure('public.pqr_panel()') is not null as ok_panel;
