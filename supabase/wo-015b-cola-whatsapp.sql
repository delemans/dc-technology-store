-- =====================================================================
-- WO-015b · Cola de notificaciones de WhatsApp (outbox para n8n / Evolution API)
-- Es la parte 4–9 de wo-015.sql, sola, para bases donde esa parte no quedó aplicada
-- (síntoma: wo-028-portal.sql falla con 'relation "public.notificaciones_whatsapp" does not exist').
-- Requiere: public.es_admin() (wo-015 parte 1; ya existe si wo-029-combos.sql se aplicó bien).
-- Idempotente. Orden: este archivo → wo-028-portal.sql.
-- Generado desde wo-015.sql (texto idéntico: wo-028 parchea tomar_notificaciones buscando ese texto).
-- =====================================================================

-- 0) VERIFICACIÓN PREVIA: si falta algo, se detiene ANTES de crear nada y dice qué falta -----
do $$
declare
    v_faltan text[] := '{}';
    r record;
begin
    if to_regprocedure('public.es_admin()') is null then
        v_faltan := array_append(v_faltan, 'función public.es_admin() (aplica la parte 1 de wo-015.sql)'::text);
    end if;
    for r in
        select * from (values
            ('compras_proveedor', 'id'), ('compras_proveedor', 'estado'), ('compras_proveedor', 'pedido_id'),
            ('compras_proveedor', 'cliente_whatsapp'), ('compras_proveedor', 'referencia_externa'),
            ('compras_proveedor', 'variante_id'), ('compras_proveedor', 'entregado_at'),
            ('compras_proveedor', 'fecha_vencimiento'), ('compras_proveedor', 'garantia_dias'),
            ('compras_proveedor', 'satisfaccion_enviada_at'),
            ('pagos', 'pedido_id'), ('pagos', 'metodo'), ('pagos', 'estado'), ('pagos', 'revisado_at'),
            ('metodos_pago', 'tipo'), ('metodos_pago', 'banco_alias'), ('metodos_pago', 'activo'), ('metodos_pago', 'orden'),
            ('resenas', 'compra_id')
        ) as t(tabla, columna)
    loop
        if not exists (select 1 from information_schema.columns c
                       where c.table_schema = 'public' and c.table_name = r.tabla and c.column_name = r.columna) then
            v_faltan := array_append(v_faltan, format('public.%s.%s', r.tabla, r.columna));
        end if;
    end loop;
    if array_length(v_faltan, 1) > 0 then
        raise exception 'Nada se aplicó. Falta en la base: %', array_to_string(v_faltan, ', ');
    end if;
end;
$$;

-- 4) COLA DE NOTIFICACIONES (outbox) ------------------------------------
-- Un trigger en compras_proveedor encola los mensajes; n8n los toma con tomar_notificaciones(),
-- los envía por Evolution API y confirma con marcar_notificacion(). Nunca guarda credenciales.
create table if not exists public.notificaciones_whatsapp (
    id             bigint generated always as identity primary key,
    clave          text not null unique,      -- idempotencia: PAGO:<pedido> · ENTREGA:<compra> · RESENA:<compra>
    tipo           text not null check (tipo in ('PAGO_RECIBIDO', 'ENTREGA_CONFIRMADA', 'SOLICITUD_RESENA')),
    compra_id      text not null,
    pedido_id      text,
    destino        text not null check (destino ~ '^\d{11,15}$'),
    variables      jsonb not null default '{}'::jsonb,   -- {marcadores} de la plantilla en bot-conocimiento.json
    prioridad      smallint not null default 5,          -- menor = antes
    enviar_despues timestamptz not null default now(),
    estado         text not null default 'PENDIENTE'
                   check (estado in ('PENDIENTE', 'EN_PROCESO', 'ENVIADO', 'FALLIDO', 'CANCELADO')),
    intentos       integer not null default 0,
    ultimo_error   text,
    wamid          text,
    tomado_at      timestamptz,
    enviado_at     timestamptz,
    created_at     timestamptz not null default now()
);
create index if not exists notificaciones_whatsapp_cola on public.notificaciones_whatsapp (estado, enviar_despues);
create index if not exists notificaciones_whatsapp_destino on public.notificaciones_whatsapp (destino, enviado_at);

alter table public.notificaciones_whatsapp enable row level security;
revoke all on table public.notificaciones_whatsapp from anon;
revoke insert, update, delete on table public.notificaciones_whatsapp from authenticated; -- solo vía funciones
drop policy if exists notificaciones_lectura_admin on public.notificaciones_whatsapp;
create policy notificaciones_lectura_admin on public.notificaciones_whatsapp
    for select to authenticated using (public.es_admin());

-- Números que pidieron no recibir mensajes posventa (respondieron NO)
create table if not exists public.whatsapp_bajas (
    destino    text primary key check (destino ~ '^\d{11,15}$'),
    created_at timestamptz not null default now()
);
alter table public.whatsapp_bajas enable row level security;
revoke all on table public.whatsapp_bajas from anon;
revoke insert, update, delete on table public.whatsapp_bajas from authenticated;
drop policy if exists bajas_lectura_admin on public.whatsapp_bajas;
create policy bajas_lectura_admin on public.whatsapp_bajas
    for select to authenticated using (public.es_admin());

-- 3001234567 → 573001234567 (igual que PlantillasWA.normalizarNumero). null si no es válido.
create or replace function public.normalizar_whatsapp(p_numero text)
returns text
language sql
immutable
set search_path = ''
as $$
    select case
        when d ~ '^3\d{9}$' then '57' || d
        when d ~ '^\d{11,15}$' then d
    end
    from (select regexp_replace(coalesce(p_numero, ''), '\D', '', 'g') as d) x;
$$;

-- 5) TRIGGER: encola según el cambio de estado --------------------------
create or replace function public.encolar_notificaciones_compra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_estado   text := new.estado::text;
    v_anterior text := case when tg_op = 'UPDATE' then old.estado::text end;
    v_destino  text := public.normalizar_whatsapp(new.cliente_whatsapp);
    v_compra   text := new.id::text;
    v_pedido   text := coalesce(new.pedido_id::text, new.id::text);
    v_producto text := coalesce(nullif(new.referencia_externa::text, ''), new.variante_id::text, 'tu producto');
    v_metodo   text;
    v_entrega  timestamptz;
    v_vence    timestamptz;
begin
    if v_estado is not distinct from v_anterior then
        return new;
    end if;

    -- Compra anulada: se cancela lo que tuviera pendiente
    if v_estado in ('FALLIDA', 'CANCELADA') then
        update public.notificaciones_whatsapp
           set estado = 'CANCELADO', ultimo_error = 'Compra ' || v_estado
         where compra_id = v_compra and estado = 'PENDIENTE';
        return new;
    end if;

    if v_destino is null then
        return new; -- sin WhatsApp válido no hay a quién avisar (el panel lo advierte)
    end if;

    if v_estado = 'ESPERANDO_PROVEEDOR' then
        select coalesce((select m.banco_alias from public.metodos_pago m where m.tipo = p.metodo::text and m.activo order by m.orden limit 1),
                        initcap(replace(lower(p.metodo::text), '_', ' '))) into v_metodo
          from public.pagos p
         where p.pedido_id::text = v_pedido and p.estado::text = 'APROBADO'
         order by p.revisado_at desc nulls last
         limit 1;
        -- Un solo aviso por pedido aunque tenga varias compras
        insert into public.notificaciones_whatsapp (clave, tipo, compra_id, pedido_id, destino, variables, prioridad)
        values ('PAGO:' || v_pedido, 'PAGO_RECIBIDO', v_compra, v_pedido, v_destino,
                jsonb_build_object('pedido', v_pedido, 'producto', v_producto,
                                   'metodo', coalesce(v_metodo, 'tu método de pago'), 'codigo', v_compra),
                1)
        on conflict (clave) do nothing;

    elsif v_estado in ('ENTREGADO', 'ENTREGADO_INMEDIATO') then
        v_entrega := coalesce(new.entregado_at, now());
        v_vence := coalesce(new.fecha_vencimiento, v_entrega + make_interval(days => coalesce(new.garantia_dias, 30)));

        insert into public.notificaciones_whatsapp (clave, tipo, compra_id, pedido_id, destino, variables, prioridad)
        values ('ENTREGA:' || v_compra, 'ENTREGA_CONFIRMADA', v_compra, v_pedido, v_destino,
                jsonb_build_object('pedido', v_pedido, 'producto', v_producto, 'codigo', v_compra,
                                   'garantia_dias', coalesce(new.garantia_dias, 30),
                                   'garantia_hasta', to_char(v_vence at time zone 'America/Bogota', 'DD/MM/YYYY')),
                2)
        on conflict (clave) do nothing;

        insert into public.notificaciones_whatsapp (clave, tipo, compra_id, pedido_id, destino, variables, prioridad, enviar_despues)
        values ('RESENA:' || v_compra, 'SOLICITUD_RESENA', v_compra, v_pedido, v_destino,
                jsonb_build_object('pedido', v_pedido, 'producto', v_producto, 'codigo', v_compra),
                9, v_entrega + interval '24 hours')
        on conflict (clave) do nothing;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_encolar_notificaciones on public.compras_proveedor;
create trigger trg_encolar_notificaciones
    after insert or update of estado on public.compras_proveedor
    for each row execute function public.encolar_notificaciones_compra();

-- 6) n8n: TOMAR UN LOTE (anti-ráfaga) ----------------------------------
-- · Máximo 10 por llamada (por defecto 5) y UNA por número.
-- · Nada a un número que recibió mensaje hace < 60 s o que tiene uno en proceso.
-- · Solicitudes de reseña solo lun–sáb de 9:00 a 19:59 (hora Bogotá).
-- · Cancela las que ya no aplican y rescata las que n8n dejó "EN_PROCESO" > 10 min.
-- n8n espera 8–15 s aleatorios entre cada envío del lote (ver bot-conocimiento.json → notificaciones).
create or replace function public.tomar_notificaciones(p_lote integer default 5)
returns table (id bigint, tipo text, destino text, variables jsonb, intentos integer)
language sql
volatile
security definer
set search_path = ''
as $$
    update public.notificaciones_whatsapp n
       set estado = case when n.intentos >= 3 then 'FALLIDO' else 'PENDIENTE' end,
           ultimo_error = coalesce(n.ultimo_error, 'n8n no confirmó el envío en 10 min')
     where n.estado = 'EN_PROCESO' and n.tomado_at < now() - interval '10 minutes';

    update public.notificaciones_whatsapp n
       set estado = 'CANCELADO', ultimo_error = 'Ya no aplica (estado de la compra, reseña existente o vencida)'
     where n.estado = 'PENDIENTE'
       and (
            not exists (select 1 from public.compras_proveedor c where c.id::text = n.compra_id)
         or exists (select 1 from public.compras_proveedor c
                     where c.id::text = n.compra_id and c.estado::text in ('FALLIDA', 'CANCELADA'))
         or (n.tipo = 'PAGO_RECIBIDO' and (
                 n.created_at < now() - interval '24 hours'
              or exists (select 1 from public.compras_proveedor c
                          where c.id::text = n.compra_id and c.estado::text in ('ENTREGADO', 'ENTREGADO_INMEDIATO'))))
         or (n.tipo = 'ENTREGA_CONFIRMADA' and exists (
                 select 1 from public.compras_proveedor c
                  where c.id::text = n.compra_id and c.estado::text not in ('ENTREGADO', 'ENTREGADO_INMEDIATO')))
         or (n.tipo = 'SOLICITUD_RESENA' and (
                 n.enviar_despues < now() - interval '6 days'
              or exists (select 1 from public.resenas r where r.compra_id = n.compra_id)
              or exists (select 1 from public.whatsapp_bajas b where b.destino = n.destino)
              or exists (select 1 from public.compras_proveedor c
                          where c.id::text = n.compra_id
                            and (c.satisfaccion_enviada_at is not null
                                 or c.estado::text not in ('ENTREGADO', 'ENTREGADO_INMEDIATO')))))
       );

    with listas as (
        select distinct on (n.destino) n.id, n.prioridad
          from public.notificaciones_whatsapp n
         where n.estado = 'PENDIENTE'
           and n.enviar_despues <= now()
           and (n.tipo <> 'SOLICITUD_RESENA' or (
                    extract(isodow from now() at time zone 'America/Bogota') < 7
                and extract(hour from now() at time zone 'America/Bogota') between 9 and 19))
           and not exists (
                select 1 from public.notificaciones_whatsapp r
                 where r.destino = n.destino
                   and (r.estado = 'EN_PROCESO'
                        or (r.estado = 'ENVIADO' and r.enviado_at > now() - interval '60 seconds')))
         order by n.destino, n.prioridad, n.id
    ),
    elegidas as (
        select n.id
          from public.notificaciones_whatsapp n
         where n.id in (select l.id from listas l)
         order by n.prioridad, n.id
         limit least(greatest(coalesce(p_lote, 5), 1), 10)
           for update skip locked
    )
    update public.notificaciones_whatsapp n
       set estado = 'EN_PROCESO', tomado_at = now(), intentos = n.intentos + 1
      from elegidas e
     where n.id = e.id
    returning n.id, n.tipo, n.destino, n.variables, n.intentos;
$$;

-- 7) n8n: CONFIRMAR ENVÍO O FALLO ---------------------------------------
-- Fallo: reintenta con espera creciente (5, 10 min); al 3.er intento queda FALLIDO (reintento manual en el panel).
create or replace function public.marcar_notificacion(
    p_id bigint, p_ok boolean, p_error text default null, p_wamid text default null
)
returns table (ok boolean, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v public.notificaciones_whatsapp%rowtype;
begin
    select * into v from public.notificaciones_whatsapp where notificaciones_whatsapp.id = p_id for update;
    if not found or v.estado <> 'EN_PROCESO' then
        return query select false, 'La notificación no existe o no está en proceso.';
        return;
    end if;

    if p_ok then
        update public.notificaciones_whatsapp
           set estado = 'ENVIADO', enviado_at = now(), ultimo_error = null, wamid = nullif(btrim(coalesce(p_wamid, '')), '')
         where notificaciones_whatsapp.id = p_id;
        -- La reseña automática reemplaza el mensaje manual de "Satisfacción 24 h" del panel
        if v.tipo = 'SOLICITUD_RESENA' then
            update public.compras_proveedor
               set satisfaccion_enviada_at = coalesce(satisfaccion_enviada_at, now())
             where compras_proveedor.id::text = v.compra_id;
        end if;
        return query select true, 'Enviada.';
        return;
    end if;

    update public.notificaciones_whatsapp
       set estado = case when v.intentos >= 3 then 'FALLIDO' else 'PENDIENTE' end,
           enviar_despues = now() + make_interval(mins => 5 * v.intentos),
           ultimo_error = left(coalesce(nullif(btrim(p_error), ''), 'Error sin detalle'), 500),
           tomado_at = null
     where notificaciones_whatsapp.id = p_id;
    return query select true, case when v.intentos >= 3 then 'Marcada FALLIDA tras 3 intentos.' else 'Se reintentará.' end;
end;
$$;

-- 8) n8n: BAJA (el cliente respondió NO) --------------------------------
create or replace function public.registrar_baja_whatsapp(p_numero text)
returns table (ok boolean, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_destino text := public.normalizar_whatsapp(p_numero);
begin
    if v_destino is null then
        return query select false, 'Número inválido.';
        return;
    end if;
    insert into public.whatsapp_bajas (destino) values (v_destino) on conflict (destino) do nothing;
    update public.notificaciones_whatsapp
       set estado = 'CANCELADO', ultimo_error = 'El cliente pidió no recibir mensajes'
     where destino = v_destino and tipo = 'SOLICITUD_RESENA' and estado = 'PENDIENTE';
    return query select true, 'Baja registrada.';
end;
$$;

-- 9) PANEL: REINTENTAR UNA FALLIDA O CANCELADA --------------------------
create or replace function public.reintentar_notificacion(p_id bigint)
returns table (ok boolean, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede reintentar notificaciones.';
        return;
    end if;
    update public.notificaciones_whatsapp
       set estado = 'PENDIENTE', intentos = 0, enviar_despues = now(), ultimo_error = null, tomado_at = null
     where notificaciones_whatsapp.id = p_id and estado in ('FALLIDO', 'CANCELADO');
    if not found then
        return query select false, 'Solo se reintentan notificaciones FALLIDAS o CANCELADAS.';
        return;
    end if;
    return query select true, 'Notificación en cola de nuevo.';
end;
$$;

-- Permisos: n8n usa su credencial de servidor (service_role); el panel solo reintenta
revoke all on function public.tomar_notificaciones(integer) from public, anon, authenticated;
revoke all on function public.marcar_notificacion(bigint, boolean, text, text) from public, anon, authenticated;
revoke all on function public.registrar_baja_whatsapp(text) from public, anon, authenticated;
revoke all on function public.encolar_notificaciones_compra() from public, anon, authenticated;
grant execute on function public.tomar_notificaciones(integer) to service_role;
grant execute on function public.marcar_notificacion(bigint, boolean, text, text) to service_role;
grant execute on function public.registrar_baja_whatsapp(text) to service_role;
revoke all on function public.reintentar_notificacion(bigint) from public, anon;
grant execute on function public.reintentar_notificacion(bigint) to authenticated;

-- COMPROBACIÓN (solo lectura): debe decir "lista" en las tres filas
select 'tabla notificaciones_whatsapp' as objeto, case when to_regclass('public.notificaciones_whatsapp') is not null then 'lista' else 'FALTA' end as estado
union all
select 'función tomar_notificaciones', case when to_regprocedure('public.tomar_notificaciones(integer)') is not null then 'lista' else 'FALTA' end
union all
select 'trigger en compras_proveedor', case when exists (select 1 from pg_trigger where tgname = 'trg_encolar_notificaciones') then 'lista' else 'FALTA' end;
