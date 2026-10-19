-- =====================================================================
-- WO-047 · Emprende Red (emprendered.com.co): categorías que TÚ eliges mostrar + rastreo de envíos en tu sitio
--   1. catalogo_precios.categoria_proveedor: la categoría de cada producto del proveedor (TECNOLOGIA, HOGAR…).
--   2. proveedor_categorias: qué categorías se muestran (por defecto solo TECNOLOGIA). Lo cambias en el panel admin.
--   3. precios_publicos(): la tienda y el bot solo ven productos de categorías visibles (los demás quedan ocultos).
--   4. sincronizar_proveedor(): además guarda la categoría (n8n la usa cada 6 h con la credencial de servidor).
--   5. Rastreo: guía de la transportadora por pedido (#guia DC-X 123456 desde tu WhatsApp), n8n la consulta en
--      el proveedor, guarda estado e historial, y avisa al cliente cuando cambia. El cliente lo ve en Mis pedidos
--      (rastreo_publico, sin datos del proveedor).
-- Requiere wo-032 (catalogo_precios, encolar_aviso), wo-041 (columnas de proveedor) y wo-044 (tipos de aviso).
-- Ejecutar en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.catalogo_precios') is null or to_regprocedure('public.encolar_aviso(text, text, text, text, jsonb, smallint)') is null then
        raise exception 'Nada se aplicó. Faltan catalogo_precios / encolar_aviso: aplica antes wo-032-fase3.sql.';
    end if;
    if to_regprocedure('public.es_admin()') is null then
        raise exception 'Nada se aplicó. Falta es_admin(): aplica antes wo-015.';
    end if;
end;
$$;

-- 1) Columnas de proveedor (por si wo-041 no se aplicó) + categoría -----------------------------------------
alter table public.catalogo_precios
    add column if not exists costo_proveedor     bigint,
    add column if not exists plan_proveedor      text,
    add column if not exists costo_proveedor_at  timestamptz,
    add column if not exists proveedor           text,
    add column if not exists stock_proveedor     integer,
    add column if not exists categoria_proveedor text;
-- Lo que ya estaba importado era solo de TECNOLOGIA
update public.catalogo_precios set categoria_proveedor = 'TECNOLOGIA'
 where proveedor = 'emprendered' and categoria_proveedor is null;

-- 2) Categorías visibles -----------------------------------------------------------------------------------
create table if not exists public.proveedor_categorias (
    proveedor   text not null,
    categoria   text not null check (length(categoria) between 1 and 80),
    visible     boolean not null default false,
    updated_at  timestamptz not null default now(),
    primary key (proveedor, categoria)
);
alter table public.proveedor_categorias enable row level security;
revoke all on table public.proveedor_categorias from public, anon, authenticated;
insert into public.proveedor_categorias (proveedor, categoria, visible)
values ('emprendered', 'TECNOLOGIA', true)
on conflict (proveedor, categoria) do nothing;

create or replace function public.categoria_visible(p_proveedor text, p_categoria text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((select k.visible from public.proveedor_categorias k
                      where k.proveedor = p_proveedor and k.categoria = coalesce(p_categoria, 'TECNOLOGIA')), false);
$$;
revoke all on function public.categoria_visible(text, text) from public, anon, authenticated;

-- 3) Precios públicos: solo categorías visibles del proveedor (lo propio y lo de ANC no cambia) -------------
drop function if exists public.precios_publicos();
create function public.precios_publicos()
returns table (producto_id text, variante text, precio bigint, precio_anterior bigint)
language sql
stable
security definer
set search_path = ''
as $$
    select c.producto_id, c.variante, c.precio, c.precio_anterior
    from public.catalogo_precios c
    where c.activo
      and (c.proveedor is distinct from 'emprendered' or public.categoria_visible(c.proveedor, c.categoria_proveedor));
$$;
revoke all on function public.precios_publicos() from public;
grant execute on function public.precios_publicos() to anon, authenticated, service_role;

-- 4) Sincronización del proveedor con categoría ------------------------------------------------------------
-- p_items: [{producto_id, variante, producto, tipo, costo, precio, stock, ref, categoria}]
create or replace function public.sincronizar_proveedor(p_proveedor text, p_items jsonb)
returns table (insertados integer, actualizados integer, inactivados integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_ins integer := 0; v_act integer := 0; v_inact integer := 0;
    v_nuevo boolean;
    i jsonb;
begin
    if p_proveedor is null or p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'Datos no válidos';
    end if;
    for i in select * from jsonb_array_elements(p_items) loop
        insert into public.catalogo_precios as c (producto_id, variante, producto, tipo, precio, precio_anterior, activo,
                costo_proveedor, plan_proveedor, costo_proveedor_at, proveedor, stock_proveedor, categoria_proveedor, updated_at)
        values (i->>'producto_id', i->>'variante', i->>'producto', i->>'tipo', round((i->>'precio')::numeric)::bigint, null,
                coalesce(round((i->>'stock')::numeric)::integer, 0) > 0, round((i->>'costo')::numeric)::bigint, p_proveedor || ' ' || coalesce(i->>'ref', ''),
                now(), p_proveedor, coalesce(round((i->>'stock')::numeric)::integer, 0), nullif(left(i->>'categoria', 80), ''), now())
        on conflict (producto_id, variante) do update
            set producto = excluded.producto, precio = excluded.precio, activo = excluded.activo,
                costo_proveedor = excluded.costo_proveedor, plan_proveedor = excluded.plan_proveedor,
                costo_proveedor_at = now(), proveedor = excluded.proveedor, stock_proveedor = excluded.stock_proveedor,
                categoria_proveedor = coalesce(excluded.categoria_proveedor, c.categoria_proveedor),
                updated_at = now()
            where c.proveedor = p_proveedor  -- nunca pisa productos propios ni de ANC con el mismo id
        returning (xmax = 0) into v_nuevo;
        if v_nuevo then v_ins := v_ins + 1; elsif v_nuevo is not null then v_act := v_act + 1; end if;
        v_nuevo := null;
        -- Categoría nueva: queda registrada OCULTA hasta que la actives en el panel
        if nullif(i->>'categoria', '') is not null then
            insert into public.proveedor_categorias (proveedor, categoria, visible)
            values (p_proveedor, left(i->>'categoria', 80), false)
            on conflict (proveedor, categoria) do nothing;
        end if;
    end loop;
    update public.catalogo_precios c set activo = false, stock_proveedor = 0, updated_at = now()
     where c.proveedor = p_proveedor and c.activo
       and not exists (select 1 from jsonb_array_elements(p_items) x where x->>'producto_id' = c.producto_id and x->>'variante' = c.variante);
    get diagnostics v_inact = row_count;
    return query select v_ins, v_act, v_inact;
end;
$$;
revoke all on function public.sincronizar_proveedor(text, jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_proveedor(text, jsonb) to service_role;

-- Panel: categorías del proveedor con cuántos productos tiene cada una (activos = con stock)
drop function if exists public.categorias_proveedor(text);
create function public.categorias_proveedor(p_proveedor text default 'emprendered')
returns table (categoria text, visible boolean, productos integer, con_stock integer, costo_promedio bigint, precio_promedio bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not public.es_admin() then
        raise exception 'Solo administradores.' using errcode = '42501';
    end if;
    return query
    select k.categoria, k.visible,
           count(c.producto_id)::integer,
           count(c.producto_id) filter (where c.activo)::integer,
           round(avg(c.costo_proveedor))::bigint,
           round(avg(c.precio))::bigint
      from public.proveedor_categorias k
      left join public.catalogo_precios c on c.proveedor = k.proveedor and coalesce(c.categoria_proveedor, 'TECNOLOGIA') = k.categoria
     where k.proveedor = p_proveedor
     group by k.categoria, k.visible
     order by k.visible desc, count(c.producto_id) desc, k.categoria;
end;
$$;
revoke all on function public.categorias_proveedor(text) from public, anon;
grant execute on function public.categorias_proveedor(text) to authenticated;

drop function if exists public.cambiar_categoria_proveedor(text, text, boolean);
create function public.cambiar_categoria_proveedor(p_proveedor text, p_categoria text, p_visible boolean)
returns table (ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede cambiar las categorías.'::text; return;
    end if;
    update public.proveedor_categorias k set visible = coalesce(p_visible, false), updated_at = now()
     where k.proveedor = p_proveedor and k.categoria = p_categoria;
    if not found then
        return query select false, 'Esa categoría no existe (se crea sola en la próxima sincronización).'::text; return;
    end if;
    return query select true, case when p_visible then 'Categoría visible en la tienda y el bot.' else 'Categoría oculta.' end::text;
end;
$$;
revoke all on function public.cambiar_categoria_proveedor(text, text, boolean) from public, anon;
grant execute on function public.cambiar_categoria_proveedor(text, text, boolean) to authenticated;

-- 5) Rastreo de envíos ---------------------------------------------------------------------------------------
alter table public.notificaciones_whatsapp drop constraint if exists notificaciones_whatsapp_tipo_check;
alter table public.notificaciones_whatsapp add constraint notificaciones_whatsapp_tipo_check
    check (tipo in ('PAGO_RECIBIDO', 'ENTREGA_CONFIRMADA', 'SOLICITUD_RESENA', 'OTP',
                    'ORDEN_VALIDADA', 'ORDEN_RECHAZADA', 'REPORTE_RESUELTO', 'ADMIN_COMPROBANTE', 'ADMIN_FALLA', 'RENOVACION', 'RASTREO'));

create table if not exists public.rastreos (
    referencia      text primary key check (referencia ~ '^DC-[A-Z0-9]{4,8}$'),
    guia            text not null check (length(guia) between 4 and 60),
    proveedor       text not null default 'emprendered',
    destino         text,                       -- WhatsApp del cliente (de la orden web o del pedido por chat)
    estado          text,
    detalle         text,
    transportadora  text,
    historial       jsonb not null default '[]'::jsonb,
    entregado       boolean not null default false,
    consultado_at   timestamptz,
    cambiado_at     timestamptz,
    created_at      timestamptz not null default now()
);
alter table public.rastreos enable row level security;
revoke all on table public.rastreos from public, anon, authenticated;

-- #guia DC-X 123456 (n8n, desde tu número de aviso): enlaza la guía al pedido
drop function if exists public.registrar_guia(text, text);
create function public.registrar_guia(p_referencia text, p_guia text)
returns table (ok boolean, mensaje text, destino text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_ref text := upper(btrim(coalesce(p_referencia, '')));
    v_guia text := btrim(coalesce(p_guia, ''));
    v_destino text;
begin
    if v_ref !~ '^DC-[A-Z0-9]{4,8}$' or length(v_guia) < 4 then
        return query select false, 'Escribe: #guia DC-XXXXX número-de-guía'::text, null::text; return;
    end if;
    if to_regclass('public.ordenes_web') is not null then
        execute 'select whatsapp from public.ordenes_web where codigo = $1' into v_destino using v_ref;
    end if;
    if v_destino is null and to_regclass('public.triangulaciones') is not null then
        execute 'select cliente from public.triangulaciones where referencia = $1' into v_destino using v_ref;
    end if;
    if v_destino is null then
        return query select false, ('No encuentro el pedido ' || v_ref || '.')::text, null::text; return;
    end if;
    insert into public.rastreos (referencia, guia, destino)
    values (v_ref, left(v_guia, 60), v_destino)
    on conflict (referencia) do update set guia = excluded.guia, destino = excluded.destino, entregado = false;
    return query select true, ('Guía ' || v_guia || ' enlazada a ' || v_ref || '. Le aviso al cliente cada cambio.')::text, v_destino;
end;
$$;
revoke all on function public.registrar_guia(text, text) from public, anon, authenticated;
grant execute on function public.registrar_guia(text, text) to service_role;

-- n8n: guías por consultar (sin entregar, de los últimos 30 días)
drop function if exists public.rastreos_abiertos();
create function public.rastreos_abiertos()
returns table (referencia text, guia text, estado text)
language sql
stable
security definer
set search_path = ''
as $$
    select r.referencia, r.guia, r.estado from public.rastreos r
     where not r.entregado and r.created_at > now() - interval '30 days'
     order by r.consultado_at nulls first
     limit 40;
$$;
revoke all on function public.rastreos_abiertos() from public, anon, authenticated;
grant execute on function public.rastreos_abiertos() to service_role;

-- n8n: guarda lo que respondió la transportadora; si el estado cambió, avisa al cliente (una vez por estado)
drop function if exists public.actualizar_rastreo(text, text, text, text, jsonb);
create function public.actualizar_rastreo(p_referencia text, p_estado text, p_detalle text, p_transportadora text, p_historial jsonb)
returns table (ok boolean, cambio boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    r public.rastreos%rowtype;
    v_estado text := nullif(left(btrim(coalesce(p_estado, '')), 80), '');
    v_cambio boolean;
    v_entregado boolean;
begin
    select * into r from public.rastreos x where x.referencia = upper(btrim(coalesce(p_referencia, '')));
    if not found then
        return query select false, false, 'Sin guía registrada.'::text; return;
    end if;
    v_cambio := v_estado is not null and v_estado is distinct from r.estado;
    v_entregado := coalesce(v_estado ~* 'entregad', false);
    update public.rastreos x
       set estado = coalesce(v_estado, x.estado),
           detalle = coalesce(nullif(left(btrim(coalesce(p_detalle, '')), 300), ''), x.detalle),
           transportadora = coalesce(nullif(left(btrim(coalesce(p_transportadora, '')), 80), ''), x.transportadora),
           historial = case when jsonb_typeof(p_historial) = 'array' and jsonb_array_length(p_historial) > 0 then p_historial else x.historial end,
           entregado = x.entregado or v_entregado,
           consultado_at = now(),
           cambiado_at = case when v_cambio then now() else x.cambiado_at end
     where x.referencia = r.referencia;
    if v_cambio then
        perform public.encolar_aviso('RASTREO:' || r.referencia || ':' || lower(v_estado), 'RASTREO', r.referencia, r.destino,
            jsonb_build_object('pedido', r.referencia, 'estado', v_estado, 'transportadora', coalesce(nullif(p_transportadora, ''), r.transportadora, ''),
                               'guia', r.guia, 'detalle', left(coalesce(p_detalle, ''), 200)), 3::smallint);
    end if;
    return query select true, v_cambio, case when v_cambio then 'Estado nuevo: ' || v_estado else 'Sin cambios.' end::text;
end;
$$;
revoke all on function public.actualizar_rastreo(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.actualizar_rastreo(text, text, text, text, jsonb) to service_role;

-- Público (Mis pedidos): estado del envío por código de pedido (sin datos del proveedor)
drop function if exists public.rastreo_publico(text);
create function public.rastreo_publico(p_referencia text)
returns table (estado text, detalle text, transportadora text, guia text, historial jsonb, entregado boolean, actualizado timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    select r.estado, r.detalle, r.transportadora, r.guia, r.historial, r.entregado, coalesce(r.consultado_at, r.created_at)
      from public.rastreos r
     where r.referencia = upper(btrim(coalesce(p_referencia, '')));
$$;
revoke all on function public.rastreo_publico(text) from public;
grant execute on function public.rastreo_publico(text) to anon, authenticated, service_role;

-- Verificación
select to_regclass('public.proveedor_categorias') is not null as ok_categorias,
       (select count(*) from public.proveedor_categorias where visible) as categorias_visibles,
       to_regprocedure('public.cambiar_categoria_proveedor(text, text, boolean)') is not null as ok_panel,
       to_regclass('public.rastreos') is not null as ok_rastreo,
       to_regprocedure('public.rastreo_publico(text)') is not null as ok_rastreo_publico;
