-- =====================================================================
-- APLICAR PENDIENTES (23/10/2026): wo-042 → 043 → 044 → 025 → 045 → 046 → 047 → 041 (Emprende Red al 50 %) → 048 (horario legal) → 049 (Netflix 30 días) → 050 (agotados y repuestos)
-- Supabase → SQL Editor → New query → pegar todo → Run. Es idempotente: si se corre dos veces no pasa nada.
-- Si sale un error que empieza por "Nada se aplicó", copia el mensaje y me lo pasas.
-- =====================================================================


-- ######################## wo-042-pedidos-whatsapp.sql ########################
-- =====================================================================
-- WO-042 · Pedidos casi automáticos desde WhatsApp + precios de ANC sincronizados
--   1. triangulaciones_abiertas(): además devuelve cliente, producto, variante, precio y si es web (el bot
--      entrega los accesos de ANC al cliente correcto).
--   2. resolver_orden_web_bot(): aprobar/rechazar un comprobante web desde WhatsApp (#ok / #no). Solo n8n
--      (credencial de servidor) y el bot solo lo usa si el mensaje viene de tu número de aviso.
--   3. entregar_manual(): marca entregado un pedido comprado a mano en ANC (activa la garantía en el panel).
--   4. sincronizar_precios_anc(): precio de venta = precio de la tienda de ANC (allnecessarycolombia.com) + margen.
--      No toca productos de Emprende Red ni precios con cambios sospechosos (más de 60 %).
-- Requiere wo-026, wo-030/032 y wo-034/038. Ejecutar en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.triangulaciones') is null or to_regclass('public.ordenes_web') is null or to_regclass('public.catalogo_precios') is null then
        raise exception 'Nada se aplicó. Faltan tablas base: aplica antes wo-026, wo-030 y wo-032.';
    end if;
    if to_regprocedure('public.avanzar_compra_triangulada(text, text, numeric, text)') is null then
        raise exception 'Nada se aplicó. Falta avanzar_compra_triangulada(): aplica antes wo-026.';
    end if;
    if to_regprocedure('public.despachar_orden_web(text)') is null then
        raise exception 'Nada se aplicó. Falta despachar_orden_web(): aplica antes wo-032.';
    end if;
end;
$$;

-- 1) Pedidos abiertos con los datos del cliente y del producto --------------------------------------------
drop function if exists public.triangulaciones_abiertas();
create function public.triangulaciones_abiertas()
returns table (referencia text, estado text, esperando text, resume_url text, wamid_cotizacion text,
               wamid_pago text, compra_id text, estado_compra text, grupo text, es_combo boolean, pago_pausado boolean,
               cliente text, cliente_nombre text, producto text, variante text, precio_venta numeric, origen_web boolean,
               created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    select t.referencia, t.estado, t.esperando, t.resume_url, t.wamid_cotizacion, t.wamid_pago, t.compra_id,
           (select c.estado::text from public.compras_proveedor c where c.id::text = t.compra_id),
           t.grupo, t.es_combo, t.pago_pausado,
           t.cliente, t.cliente_nombre, t.producto, t.variante, t.precio_venta, coalesce(t.origen_web, false), t.created_at
    from public.triangulaciones t
    where t.estado not in ('ENTREGADO', 'CANCELADO', 'VENCIDO', 'AGOTADO')
    order by t.id desc
    limit 80;
$$;
revoke all on function public.triangulaciones_abiertas() from public, anon, authenticated;
grant execute on function public.triangulaciones_abiertas() to service_role;

-- 2) Aprobar / rechazar un comprobante web desde WhatsApp (misma lógica que el panel, sin sesión web) --------
drop function if exists public.resolver_orden_web_bot(text, boolean, text);
create function public.resolver_orden_web_bot(p_codigo text, p_aprobar boolean, p_nota text default null)
returns table (ok boolean, mensaje text, existe boolean, cliente text, total numeric)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_codigo text := upper(btrim(coalesce(p_codigo, '')));
    v_cupon  text;
    v_orden  public.ordenes_web%rowtype;
begin
    select * into v_orden from public.ordenes_web o where o.codigo = v_codigo;
    if not found then
        return query select false, 'NO_EXISTE'::text, false, null::text, null::numeric; return;
    end if;
    if v_orden.estado not in ('ESPERANDO_PAGO', 'COMPROBANTE_RECIBIDO', 'RECHAZADO') then
        return query select false, ('Esa orden ya está ' || lower(v_orden.estado::text) || '.')::text, true, v_orden.whatsapp::text, v_orden.total_declarado::numeric; return;
    end if;
    update public.ordenes_web o
       set estado = case when p_aprobar then 'VALIDADO' else 'RECHAZADO' end,
           nota_admin = nullif(left(btrim(coalesce(p_nota, case when p_aprobar then '' else 'El comprobante no corresponde al pago. Revisa el valor y sube uno nuevo.' end)), 300), ''),
           revisado_at = now(), updated_at = now()
     where o.codigo = v_codigo
    returning o.cupon into v_cupon;
    if not p_aprobar then
        return query select true, 'Orden rechazada: el cliente lo verá y puede subir otro comprobante.'::text, true, v_orden.whatsapp::text, v_orden.total_declarado::numeric; return;
    end if;
    if v_cupon is not null then
        update public.cupones k set usos = k.usos + 1 where k.codigo = v_cupon;
    end if;
    return query select true, public.despachar_orden_web(v_codigo)::text, true, v_orden.whatsapp::text, v_orden.total_declarado::numeric;
end;
$$;
revoke all on function public.resolver_orden_web_bot(text, boolean, text) from public, anon, authenticated;
grant execute on function public.resolver_orden_web_bot(text, boolean, text) to service_role;

-- 3) Entrega de un pedido comprado a mano en ANC: compra ENTREGADA (garantía) + triangulación cerrada ----------
drop function if exists public.entregar_manual(text, text, text);
create function public.entregar_manual(p_referencia text, p_estado text, p_clave text default null)
returns table (ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_ref text := upper(btrim(coalesce(p_referencia, '')));
    v_estado text := upper(btrim(coalesce(p_estado, '')));
begin
    if v_estado not in ('PEDIDO_REALIZADO', 'ENTREGADO') then
        return query select false, 'Estado no válido.'::text; return;
    end if;
    if not exists (select 1 from public.triangulaciones t where t.referencia = v_ref and t.estado not in ('ENTREGADO', 'CANCELADO')) then
        return query select false, 'Ese pedido no existe o ya está cerrado.'::text; return;
    end if;
    perform public.avanzar_compra_triangulada(v_ref, v_estado, null, p_clave);
    update public.triangulaciones t
       set estado = case when v_estado = 'ENTREGADO' then 'ENTREGADO' else 'ESPERANDO_CREDENCIALES' end,
           esperando = case when v_estado = 'ENTREGADO' then null else 'CREDENCIALES' end,
           resume_url = null, updated_at = now()
     where t.referencia = v_ref;
    return query select true, case when v_estado = 'ENTREGADO' then 'Entregado: garantía activa.' else 'Pago confirmado.' end::text;
end;
$$;
revoke all on function public.entregar_manual(text, text, text) from public, anon, authenticated;
grant execute on function public.entregar_manual(text, text, text) to service_role;

-- 4) Precios de venta = tienda de ANC + margen. p_items: [{producto_id, variante, precio, costo, plan}] ------------
drop function if exists public.sincronizar_precios_anc(jsonb);
create function public.sincronizar_precios_anc(p_items jsonb)
returns table (actualizados integer, sin_cambio integer, omitidos integer, cambios jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    i jsonb;
    v_actual bigint;
    v_nuevo bigint;
    v_act integer := 0; v_igual integer := 0; v_omit integer := 0;
    v_cambios jsonb := '[]'::jsonb;
begin
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'Datos no válidos';
    end if;
    for i in select * from jsonb_array_elements(p_items) loop
        v_nuevo := round((i->>'precio')::numeric)::bigint;
        select c.precio into v_actual from public.catalogo_precios c
         where c.producto_id = i->>'producto_id' and c.variante = i->>'variante' and coalesce(c.proveedor, '') <> 'emprendered';
        if not found then v_omit := v_omit + 1; continue; end if;
        -- Seguridad: precio vacío o un salto de más del 60 % se reporta y NO se aplica (puede ser un error de lectura)
        if v_nuevo is null or v_nuevo < 1000 or (v_actual > 0 and abs(v_nuevo - v_actual)::numeric / v_actual > 0.6) then
            v_omit := v_omit + 1;
            v_cambios := v_cambios || jsonb_build_object('producto_id', i->>'producto_id', 'variante', i->>'variante', 'antes', v_actual, 'ahora', v_nuevo, 'aplicado', false);
            continue;
        end if;
        update public.catalogo_precios c
           set costo_proveedor = round((i->>'costo')::numeric)::bigint, plan_proveedor = left('anc ' || coalesce(i->>'plan', ''), 120),
               costo_proveedor_at = now(),
               precio = v_nuevo, updated_at = case when c.precio <> v_nuevo then now() else c.updated_at end
         where c.producto_id = i->>'producto_id' and c.variante = i->>'variante' and coalesce(c.proveedor, '') <> 'emprendered';
        if v_actual = v_nuevo then
            v_igual := v_igual + 1;
        else
            v_act := v_act + 1;
            v_cambios := v_cambios || jsonb_build_object('producto_id', i->>'producto_id', 'variante', i->>'variante', 'antes', v_actual, 'ahora', v_nuevo, 'aplicado', true);
        end if;
    end loop;
    return query select v_act, v_igual, v_omit, v_cambios;
end;
$$;
revoke all on function public.sincronizar_precios_anc(jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_precios_anc(jsonb) to service_role;

-- Verificación
select to_regprocedure('public.resolver_orden_web_bot(text, boolean, text)') is not null as ok_validar_por_whatsapp,
       to_regprocedure('public.entregar_manual(text, text, text)') is not null as ok_entrega_manual,
       to_regprocedure('public.sincronizar_precios_anc(jsonb)') is not null as ok_precios_anc;


-- ######################## wo-043-stock-pines.sql ########################
-- =====================================================================
-- WO-043 · Stock propio de pines (códigos comprados por lote, entrega al instante)
--   1. stock_codigos: los códigos que compraste (ANC, Reloadly, tienda…) listos para entregar. Solo el servidor
--      (n8n con la credencial de servicio) los lee; la web pública solo sabe SI hay o no (stock_publico).
--   2. cargar_stock(): agrega códigos (los repetidos se ignoran). Lo usa el bot con "#stock …" desde tu WhatsApp.
--   3. entregar_desde_stock(): toma UN código disponible (bloqueo de fila: dos pedidos nunca reciben el mismo), lo
--      marca entregado y deja el pedido ENTREGADO con la garantía activa (entregar_manual de wo-042). Si no hay stock,
--      deja el pedido con el pago confirmado (PEDIDO_REALIZADO) para comprarlo a mano. Idempotente por referencia.
--   4. stock_resumen(): disponibles y entregados por producto (para "#stock" sin nada más).
--   5. stock_publico(): producto/variante con stock (sin códigos) → la tienda muestra "⚡ Entrega inmediata".
-- Requiere wo-042 (entregar_manual). Ejecutar en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

do $$
begin
    if to_regprocedure('public.entregar_manual(text, text, text)') is null then
        raise exception 'Nada se aplicó. Falta entregar_manual(): aplica antes supabase/wo-042-pedidos-whatsapp.sql.';
    end if;
end;
$$;

-- 1) Tabla de códigos -----------------------------------------------------------------------------------
create table if not exists public.stock_codigos (
    id            bigint generated always as identity primary key,
    producto_id   text not null check (producto_id ~ '^[a-z0-9-]{2,120}$'),
    variante      text not null check (length(variante) between 1 and 120),
    codigo        text not null check (length(codigo) between 4 and 200),
    costo         numeric(12, 2),
    origen        text not null default 'manual' check (length(origen) <= 60),
    estado        text not null default 'DISPONIBLE' check (estado in ('DISPONIBLE', 'ENTREGADO', 'ANULADO')),
    referencia    text check (referencia is null or referencia ~ '^DC-[A-Z0-9]{4,8}$'),
    cargado_at    timestamptz not null default now(),
    entregado_at  timestamptz,
    unique (producto_id, codigo)
);
create index if not exists stock_codigos_disponibles on public.stock_codigos (producto_id, variante, id) where estado = 'DISPONIBLE';
create unique index if not exists stock_codigos_por_pedido on public.stock_codigos (referencia) where referencia is not null;
alter table public.stock_codigos enable row level security;
-- Sin políticas: nadie con la llave pública (anon/authenticated) ve ni toca los códigos; solo las funciones de abajo
revoke all on table public.stock_codigos from public, anon, authenticated;

-- 2) Cargar códigos --------------------------------------------------------------------------------------
drop function if exists public.cargar_stock(text, text, text[], numeric, text);
create function public.cargar_stock(p_producto_id text, p_variante text, p_codigos text[], p_costo numeric default null, p_origen text default 'manual')
returns table (cargados integer, repetidos integer, disponibles integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_codigo text;
    v_ok integer := 0;
    v_rep integer := 0;
begin
    foreach v_codigo in array coalesce(p_codigos, '{}'::text[]) loop
        v_codigo := btrim(v_codigo);
        continue when length(v_codigo) < 4;
        insert into public.stock_codigos (producto_id, variante, codigo, costo, origen)
        values (p_producto_id, p_variante, v_codigo, p_costo, coalesce(nullif(btrim(p_origen), ''), 'manual'))
        on conflict (producto_id, codigo) do nothing;
        if found then v_ok := v_ok + 1; else v_rep := v_rep + 1; end if;
    end loop;
    return query select v_ok, v_rep,
        (select count(*)::integer from public.stock_codigos s where s.producto_id = p_producto_id and s.variante = p_variante and s.estado = 'DISPONIBLE');
end;
$$;
revoke all on function public.cargar_stock(text, text, text[], numeric, text) from public, anon, authenticated;
grant execute on function public.cargar_stock(text, text, text[], numeric, text) to service_role;

-- 3) Entregar desde el stock -------------------------------------------------------------------------------
drop function if exists public.entregar_desde_stock(text, text, text);
create function public.entregar_desde_stock(p_referencia text, p_producto_id text, p_variante text)
returns table (ok boolean, codigo text, quedan integer, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_ref text := upper(btrim(coalesce(p_referencia, '')));
    v_id bigint;
    v_codigo text;
    v_quedan integer;
    v_res record;
begin
    -- Ya se le entregó un código a este pedido (reintento del bot): el mismo código, sin gastar otro
    select s.codigo into v_codigo from public.stock_codigos s where s.referencia = v_ref;
    if v_codigo is not null then
        return query select true, v_codigo,
            (select count(*)::integer from public.stock_codigos s where s.producto_id = p_producto_id and s.variante = p_variante and s.estado = 'DISPONIBLE'),
            'Ya entregado desde el stock.'::text;
        return;
    end if;
    if not exists (select 1 from public.triangulaciones t where t.referencia = v_ref and t.estado not in ('ENTREGADO', 'CANCELADO')) then
        return query select false, null::text, null::integer, 'Ese pedido no existe o ya está cerrado.'::text;
        return;
    end if;
    select s.id, s.codigo into v_id, v_codigo
      from public.stock_codigos s
     where s.producto_id = p_producto_id and s.variante = p_variante and s.estado = 'DISPONIBLE'
     order by s.id
     limit 1
     for update skip locked;
    if v_id is null then
        -- Sin stock: el pago queda confirmado y el pedido sigue el camino manual (comprar en ANC)
        select * into v_res from public.entregar_manual(v_ref, 'PEDIDO_REALIZADO', null);
        return query select false, null::text, 0, 'SIN_STOCK'::text;
        return;
    end if;
    update public.stock_codigos s set estado = 'ENTREGADO', referencia = v_ref, entregado_at = now() where s.id = v_id;
    select * into v_res from public.entregar_manual(v_ref, 'ENTREGADO', 'PIN ' || v_codigo);
    if not coalesce(v_res.ok, false) then
        raise exception 'No se pudo marcar entregado %: %', v_ref, v_res.mensaje; -- deshace la toma del código
    end if;
    select count(*)::integer into v_quedan from public.stock_codigos s where s.producto_id = p_producto_id and s.variante = p_variante and s.estado = 'DISPONIBLE';
    return query select true, v_codigo, v_quedan, 'Entregado desde el stock.'::text;
end;
$$;
revoke all on function public.entregar_desde_stock(text, text, text) from public, anon, authenticated;
grant execute on function public.entregar_desde_stock(text, text, text) to service_role;

-- 4) Resumen para el director -----------------------------------------------------------------------------
drop function if exists public.stock_resumen();
create function public.stock_resumen()
returns table (producto_id text, variante text, disponibles integer, entregados_30d integer)
language sql
stable
security definer
set search_path = ''
as $$
    select s.producto_id, s.variante,
           count(*) filter (where s.estado = 'DISPONIBLE')::integer,
           count(*) filter (where s.estado = 'ENTREGADO' and s.entregado_at > now() - interval '30 days')::integer
      from public.stock_codigos s
     group by s.producto_id, s.variante
     order by s.producto_id, s.variante;
$$;
revoke all on function public.stock_resumen() from public, anon, authenticated;
grant execute on function public.stock_resumen() to service_role;

-- 5) Público: solo si hay stock (nunca los códigos) ---------------------------------------------------------
drop function if exists public.stock_publico();
create function public.stock_publico()
returns table (producto_id text, variante text)
language sql
stable
security definer
set search_path = ''
as $$
    select distinct s.producto_id, s.variante from public.stock_codigos s where s.estado = 'DISPONIBLE';
$$;
revoke all on function public.stock_publico() from public;
grant execute on function public.stock_publico() to anon, authenticated, service_role;

-- Verificación
select to_regclass('public.stock_codigos') is not null as ok_tabla,
       to_regprocedure('public.cargar_stock(text, text, text[], numeric, text)') is not null as ok_cargar,
       to_regprocedure('public.entregar_desde_stock(text, text, text)') is not null as ok_entregar,
       to_regprocedure('public.stock_publico()') is not null as ok_publico;


-- ######################## wo-044-renovaciones.sql ########################
-- =====================================================================
-- WO-044 · Renovación por suscripción: aviso automático antes de que venza el plan del cliente
--   1. Tipo de aviso RENOVACION en la cola de WhatsApp (plantilla "renovacion" de bot-conocimiento.json).
--   2. entregas_para_renovar(): entregas recientes (cuentas, licencias) que aún no tienen aviso de renovación.
--      n8n calcula cuándo vence cada plan (26 días, 1 mes, 1 año…) y avisa 3 días antes.
--   3. encolar_renovacion(): deja el aviso en la cola (una sola vez por pedido; respeta las bajas de WhatsApp).
-- Requiere wo-015/015b (cola), wo-024 (triangulaciones) y wo-032 (encolar_aviso). Idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.notificaciones_whatsapp') is null or to_regclass('public.triangulaciones') is null then
        raise exception 'Nada se aplicó. Faltan tablas base: aplica antes wo-015b y wo-024.';
    end if;
    if to_regprocedure('public.encolar_aviso(text, text, text, text, jsonb, smallint)') is null then
        raise exception 'Nada se aplicó. Falta encolar_aviso(): aplica antes wo-032-fase3.sql.';
    end if;
end;
$$;

-- 1) Tipo nuevo (se conservan todos los anteriores) ------------------------------------------------------
alter table public.notificaciones_whatsapp drop constraint if exists notificaciones_whatsapp_tipo_check;
alter table public.notificaciones_whatsapp add constraint notificaciones_whatsapp_tipo_check
    check (tipo in ('PAGO_RECIBIDO', 'ENTREGA_CONFIRMADA', 'SOLICITUD_RESENA', 'OTP',
                    'ORDEN_VALIDADA', 'ORDEN_RECHAZADA', 'REPORTE_RESUELTO', 'ADMIN_COMPROBANTE', 'ADMIN_FALLA', 'RENOVACION'));

-- 2) Entregas candidatas (sin aviso todavía y sin baja) ----------------------------------------------------
drop function if exists public.entregas_para_renovar(integer);
create function public.entregas_para_renovar(p_dias integer default 70)
returns table (referencia text, cliente text, producto text, variante text, entregado_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    select t.referencia, t.cliente, t.producto, t.variante, t.updated_at
      from public.triangulaciones t
     where t.estado = 'ENTREGADO'
       and not t.es_combo
       and t.updated_at > now() - make_interval(days => greatest(1, least(coalesce(p_dias, 70), 400)))
       and not exists (select 1 from public.notificaciones_whatsapp n where n.clave = 'RENUEVA:' || t.referencia)
       and (to_regclass('public.whatsapp_bajas') is null
            or not exists (select 1 from public.whatsapp_bajas b where b.destino = t.cliente))
     order by t.updated_at;
$$;
revoke all on function public.entregas_para_renovar(integer) from public, anon, authenticated;
grant execute on function public.entregas_para_renovar(integer) to service_role;

-- 3) Encolar el aviso -----------------------------------------------------------------------------------
drop function if exists public.encolar_renovacion(text, text);
create function public.encolar_renovacion(p_referencia text, p_vence text)
returns table (ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    t record;
begin
    select * into t from public.triangulaciones x where x.referencia = upper(btrim(coalesce(p_referencia, ''))) and x.estado = 'ENTREGADO';
    if not found then
        return query select false, 'El pedido no existe o no está entregado.'::text; return;
    end if;
    if exists (select 1 from public.notificaciones_whatsapp n where n.clave = 'RENUEVA:' || t.referencia) then
        return query select true, 'Ya estaba en la cola.'::text; return;
    end if;
    perform public.encolar_aviso('RENUEVA:' || t.referencia, 'RENOVACION', coalesce(t.compra_id, t.referencia), t.cliente,
        jsonb_build_object('producto', t.producto, 'variante', coalesce(t.variante, ''), 'vence', left(coalesce(p_vence, ''), 40), 'pedido', t.referencia), 4::smallint);
    return query select true, 'Aviso de renovación en la cola.'::text;
end;
$$;
revoke all on function public.encolar_renovacion(text, text) from public, anon, authenticated;
grant execute on function public.encolar_renovacion(text, text) to service_role;

-- Verificación
select to_regprocedure('public.entregas_para_renovar(integer)') is not null as ok_candidatas,
       to_regprocedure('public.encolar_renovacion(text, text)') is not null as ok_encolar;


-- ######################## wo-025-promociones.sql ########################
-- =====================================================================
-- WO-025 · Promociones del día
-- Requiere: wo-015.sql (public.es_admin()). Idempotente.
-- Aplicar: node herramientas/configurar-supabase.js --aplicar --archivo supabase/wo-025-promociones.sql
--
-- Por qué una tabla y no una columna en public.productos: la tienda publica el catálogo desde
-- productos.json (la vista v_catalogo_publico está vacía), así que la marca debe usar el MISMO id
-- que ve el cliente (p. ej. 'netflix', 'office-365'). Si algún día el catálogo vive en la tabla
-- productos, basta con apuntar producto_id a esa tabla.
--
-- "Del día": cada promoción vence sola a la medianoche de Colombia (o a la fecha que elija el admin),
-- así la cuenta regresiva de la tienda siempre dice la verdad.
-- =====================================================================

create table if not exists public.promociones_dia (
    producto_id  text primary key check (producto_id ~ '^[a-z0-9-]{2,120}$'),
    activa       boolean not null default true,
    vence_at     timestamptz not null,
    orden        smallint not null default 0,
    actualizado_por uuid,
    updated_at   timestamptz not null default now()
);

alter table public.promociones_dia enable row level security;
revoke all on table public.promociones_dia from anon;
revoke insert, update, delete on table public.promociones_dia from authenticated; -- solo vía RPC
drop policy if exists promociones_lectura_admin on public.promociones_dia;
create policy promociones_lectura_admin on public.promociones_dia
    for select to authenticated using (public.es_admin());

-- Medianoche de hoy en Colombia (fin del "día" de la promoción)
create or replace function public.fin_del_dia_bogota()
returns timestamptz
language sql
stable
set search_path = ''
as $$
    select (date_trunc('day', now() at time zone 'America/Bogota') + interval '1 day' - interval '1 second') at time zone 'America/Bogota';
$$;

-- Público: ids vigentes (la tienda los cruza con productos.json; no expone nada más)
drop function if exists public.promociones_del_dia();
create function public.promociones_del_dia()
returns table (producto_id text, vence_at timestamptz, orden smallint)
language sql
stable
security definer
set search_path = ''
as $$
    select p.producto_id, p.vence_at, p.orden
    from public.promociones_dia p
    where p.activa and p.vence_at > now()
    order by p.orden, p.updated_at desc
    limit 12;
$$;
revoke all on function public.promociones_del_dia() from public;
grant execute on function public.promociones_del_dia() to anon, authenticated;

-- Admin: activa / desactiva. p_vence null = hasta la medianoche de hoy (Colombia).
drop function if exists public.alternar_promocion(text, boolean, timestamptz);
create function public.alternar_promocion(p_producto_id text, p_activa boolean, p_vence timestamptz default null)
returns table (ok boolean, mensaje text, vence_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_vence timestamptz := coalesce(p_vence, public.fin_del_dia_bogota());
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede cambiar promociones.', null::timestamptz;
        return;
    end if;
    if p_producto_id is null or p_producto_id !~ '^[a-z0-9-]{2,120}$' then
        return query select false, 'Producto inválido.', null::timestamptz;
        return;
    end if;
    if p_activa and v_vence <= now() then
        return query select false, 'La fecha de vencimiento ya pasó.', null::timestamptz;
        return;
    end if;
    -- (alias x: 'vence_at' también es el nombre de una columna de salida → evita la ambigüedad)
    if p_activa and (select count(*) from public.promociones_dia x
                     where x.activa and x.vence_at > now() and x.producto_id <> p_producto_id) >= 12 then
        return query select false, 'Máximo 12 promociones a la vez: desactiva alguna primero.', null::timestamptz;
        return;
    end if;

    insert into public.promociones_dia (producto_id, activa, vence_at, actualizado_por, updated_at)
    values (p_producto_id, p_activa, v_vence, auth.uid(), now())
    on conflict (producto_id) do update
       set activa = excluded.activa,
           vence_at = case when excluded.activa then excluded.vence_at else public.promociones_dia.vence_at end,
           actualizado_por = excluded.actualizado_por,
           updated_at = now();

    return query select true, case when p_activa then 'Promoción activada.' else 'Promoción desactivada.' end,
                        case when p_activa then v_vence end;
end;
$$;
revoke all on function public.alternar_promocion(text, boolean, timestamptz) from public, anon;
grant execute on function public.alternar_promocion(text, boolean, timestamptz) to authenticated;

-- Verificación
select to_regprocedure('public.promociones_del_dia()') is not null as rpc_publica,
       to_regprocedure('public.alternar_promocion(text, boolean, timestamptz)') is not null as rpc_admin;


-- ######################## wo-045-seguridad.sql ########################
-- =====================================================================
-- WO-045 · Endurecimiento de permisos de public.metodos_pago (solo administradores y funciones del servidor)
-- Qué hace:
--   1. Activa RLS en metodos_pago (si estaba apagada).
--   2. Quita toda política que dé acceso a anon o a public, y deja una sola política: administradores.
--   3. Revoca los permisos de tabla de anon (doble seguro).
-- No cambia nada visible: la tienda usa metodos_pago_publicos() (sin números) y los datos de pago llegan al
-- crear la orden (crear_orden_web, security definer); el bot y n8n usan la credencial de servicio.
-- Requiere wo-015 (es_admin). Ejecutar en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.metodos_pago') is null then
        raise exception 'Nada se aplicó. No existe la tabla public.metodos_pago.';
    end if;
    if to_regprocedure('public.es_admin()') is null then
        raise exception 'Nada se aplicó. Falta es_admin(): aplica antes wo-015.';
    end if;
end;
$$;

alter table public.metodos_pago enable row level security;

do $$
declare
    p record;
begin
    -- Fuera las políticas que abren la tabla a anon / public (las del panel quedan en la política nueva)
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'metodos_pago'
                and policyname not in ('solo_admin', 'admin_gestiona_metodos')
                and (roles && array['anon', 'public']::name[]) loop
        execute format('drop policy %I on public.metodos_pago', p.policyname);
    end loop;
end;
$$;

drop policy if exists admin_gestiona_metodos on public.metodos_pago;
create policy admin_gestiona_metodos on public.metodos_pago
    for all to authenticated using (public.es_admin()) with check (public.es_admin());

revoke all on table public.metodos_pago from anon;

-- Verificación: debe decir false en anon_puede_leer y true en rls_activa
select has_table_privilege('anon', 'public.metodos_pago', 'select') as anon_puede_leer,
       (select relrowsecurity from pg_class where oid = 'public.metodos_pago'::regclass) as rls_activa,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'metodos_pago') as politicas;


-- ######################## wo-046-finanzas.sql ########################
-- =====================================================================
-- WO-046 · Centro financiero del panel (solo administradores)
--   finanzas_panel(p_desde, p_hasta) → jsonb con:
--     movimientos: cada pedido del período (chat, web y líneas de combo; el "padre" del combo no, para no contar
--                  doble) con venta, costo (el real de la compra si está registrado, si no el cotizado), estado,
--                  canal y si ya está pagado.
--     por_cobrar:  órdenes web esperando pago o con comprobante por revisar (cantidad y total declarado).
--     inventario:  códigos de pines disponibles y su costo (si wo-043 está aplicado).
-- Lo usa admin.html → vista "Finanzas" (finanzas.js). Nada de esto se ve con la llave pública.
-- Requiere wo-015 (es_admin) y wo-024 (triangulaciones). Ejecutar en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.triangulaciones') is null then
        raise exception 'Nada se aplicó. Falta public.triangulaciones: aplica antes wo-024.';
    end if;
    if to_regprocedure('public.es_admin()') is null then
        raise exception 'Nada se aplicó. Falta es_admin(): aplica antes wo-015.';
    end if;
end;
$$;

drop function if exists public.finanzas_panel(timestamptz, timestamptz);
create function public.finanzas_panel(p_desde timestamptz, p_hasta timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_mov jsonb;
    v_cobrar jsonb := jsonb_build_object('ordenes', 0, 'total', 0);
    v_inv jsonb := jsonb_build_object('codigos', 0, 'costo', 0);
begin
    if not public.es_admin() then
        raise exception 'Solo administradores.' using errcode = '42501';
    end if;

    select coalesce(jsonb_agg(m order by m.fecha desc), '[]'::jsonb) into v_mov
      from (
        select t.referencia,
               t.created_at as fecha,
               case when t.estado = 'ENTREGADO' then t.updated_at end as entregado_at,
               t.producto, t.variante,
               coalesce(t.precio_venta, 0) as venta,
               -- costo real de la compra (si la columna existe y está llena) o el cotizado al proveedor
               coalesce((select nullif(to_jsonb(c) ->> 'costo_real_cop', '')::numeric
                           from public.compras_proveedor c where c.id::text = t.compra_id), t.costo_proveedor) as costo,
               t.estado,
               case when t.origen_web then 'web' else 'whatsapp' end as canal,
               (t.estado in ('ESPERANDO_CREDENCIALES', 'ENTREGADO') or (t.origen_web and t.estado = 'REVISION_MANUAL')) as pagado,
               t.grupo is not null as de_combo
          from public.triangulaciones t
         where not t.es_combo
           and t.created_at >= coalesce(p_desde, now() - interval '30 days')
           and t.created_at < coalesce(p_hasta, now() + interval '1 day')
      ) m;

    if to_regclass('public.ordenes_web') is not null then
        select jsonb_build_object('ordenes', count(*), 'total', coalesce(sum(o.total_declarado), 0)) into v_cobrar
          from public.ordenes_web o
         where o.estado in ('ESPERANDO_PAGO', 'COMPROBANTE_RECIBIDO')
           and o.created_at > now() - interval '7 days';
    end if;

    if to_regclass('public.stock_codigos') is not null then
        execute 'select jsonb_build_object(''codigos'', count(*), ''costo'', coalesce(sum(costo), 0)) from public.stock_codigos where estado = ''DISPONIBLE'''
           into v_inv;
    end if;

    return jsonb_build_object('movimientos', v_mov, 'por_cobrar', v_cobrar, 'inventario', v_inv, 'generado', now());
end;
$$;
revoke all on function public.finanzas_panel(timestamptz, timestamptz) from public, anon;
grant execute on function public.finanzas_panel(timestamptz, timestamptz) to authenticated;

-- Verificación
select to_regprocedure('public.finanzas_panel(timestamptz, timestamptz)') is not null as ok_finanzas;


-- ######################## wo-047-proveedor-y-rastreo.sql ########################
-- =====================================================================
-- WO-047 · Emprende Red (emprendered.com.co): categorías que TÚ eliges mostrar + rastreo de envíos en tu sitio
--   1. catalogo_precios.categoria_proveedor: la categoría de cada producto del proveedor (TECNOLOGIA, HOGAR…).
--   2. proveedor_categorias: qué categorías se muestran (por defecto solo TECNOLOGIA). Lo cambias en el panel admin.
--   3. precios_publicos(): la tienda y el bot solo ven productos de categorías visibles (los demás quedan ocultos) y
--      reciben las EXISTENCIAS del proveedor (unidades que le quedan) para avisar "Quedan N" y no vender de más.
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
returns table (producto_id text, variante text, precio bigint, precio_anterior bigint, existencias integer)
language sql
stable
security definer
set search_path = ''
as $$
    select c.producto_id, c.variante, c.precio, c.precio_anterior,
           case when c.proveedor = 'emprendered' then c.stock_proveedor end
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


-- ######################## wo-041-emprendered.sql ########################
-- =====================================================================
-- WO-041 · Productos de Emprende Red (dropshipping) en catalogo_precios: precio, costo y stock
-- Generado por herramientas/sincronizar-emprendered.mjs el 2026-10-23T12:17:03.884Z con el catálogo leído el 2026-10-23T12:17:03.804Z.
-- No editar a mano: volver a generar. Ejecutar en Supabase → SQL Editor. Es idempotente.
-- Regla: precio = costo + 50 % redondeado a $100; activo solo si hay stock. Solo toca filas de este proveedor.
-- n8n usa la misma función cada día (paso 4) con su credencial de servidor.
-- =====================================================================

do $$
begin
    if to_regclass('public.catalogo_precios') is null then
        raise exception 'Nada se aplicó. Falta public.catalogo_precios: aplica antes supabase/wo-032-fase3.sql.';
    end if;
end;
$$;

do $$
begin
    if to_regclass('public.proveedor_categorias') is null then
        raise exception 'Nada se aplicó. Aplica antes supabase/wo-047-proveedor-y-rastreo.sql (categorías visibles y sincronizar_proveedor con categoría).';
    end if;
end;
$$;

select * from public.sincronizar_proveedor('emprendered', '[{"producto_id":"er-cargador-con-cable-original-yookie-20w-rapido-2","variante":"Unidad","producto":"Cargador con Cable Original Yookie 20W Rapido","tipo":"tecnologia","costo":16000,"precio":24000,"stock":4,"ref":"GAR 162","categoria":"TECNOLOGIA"},{"producto_id":"er-power-bank-20000-mah-display-4-cables-13","variante":"Unidad","producto":"Power Bank 20.000 mAh Display / 4 Cables","tipo":"tecnologia","costo":33800,"precio":50700,"stock":6,"ref":"GAR276","categoria":"TECNOLOGIA"},{"producto_id":"er-anc-airpods-pantalla-tactil-5","variante":"Unidad","producto":"ANC Audífonos Inalámbricos Pantalla Tactil","tipo":"tecnologia","costo":38000,"precio":57000,"stock":9,"ref":"A-0004","categoria":"TECNOLOGIA"},{"producto_id":"er-lamparas-usb-led-07-6","variante":"Unidad","producto":"Lamparas USB LED-07","tipo":"tecnologia","costo":6175,"precio":9300,"stock":6,"ref":"514123","categoria":"TECNOLOGIA"},{"producto_id":"er-cargador-iphone-lightning-original-yookie-kl02-7","variante":"Unidad","producto":"Cargador Iphone Lightning Original Yookie KL02","tipo":"tecnologia","costo":16500,"precio":24800,"stock":4,"ref":"CC-00001B","categoria":"TECNOLOGIA"},{"producto_id":"er-ventilador-usb-led-fan-05-41","variante":"Unidad","producto":"Ventilador USB LED FAN-05","tipo":"variedades","costo":11150,"precio":16800,"stock":1,"ref":"oscar","categoria":"HOGAR"},{"producto_id":"er-smart-wacht-gus-16-10","variante":"Unidad","producto":"Smart Wacht GUS-16","tipo":"tecnologia","costo":29900,"precio":44900,"stock":3,"ref":"R-00012ML","categoria":"TECNOLOGIA"},{"producto_id":"er-corta-unas-1-71","variante":"Unidad","producto":"Corta Uñas 1","tipo":"variedades","costo":1900,"precio":2900,"stock":10,"ref":"ACC-0001","categoria":"CACHARRERIA"},{"producto_id":"er-game-retro-400-juegos-2-jugadores-16","variante":"Unidad","producto":"Game Retro 400 Juegos (2) Jugadores","tipo":"tecnologia","costo":28900,"precio":43400,"stock":10,"ref":"TG-00003R","categoria":"TECNOLOGIA"},{"producto_id":"er-llavero-unicornio-93","variante":"Unidad","producto":"Llavero Unicornio","tipo":"variedades","costo":3000,"precio":4500,"stock":5,"ref":"JJ-00008ML","categoria":"CACHARRERIA"},{"producto_id":"er-cargador-ultra-power-samsung-100","variante":"Unidad","producto":"Cargador Ultra Power Samsung","tipo":"tecnologia","costo":13600,"precio":20400,"stock":1,"ref":"CC-00010N","categoria":"TECNOLOGIA"},{"producto_id":"er-power-bank-inalambrico-iphone-grande-10-000mah-101","variante":"Unidad","producto":"Power Bank Inalambrico Iphone Grande 10. 000mAh","tipo":"tecnologia","costo":20000,"precio":30000,"stock":5,"ref":"CC-00009B","categoria":"TECNOLOGIA"},{"producto_id":"er-mouse-gamer-3200-dpi-20","variante":"Unidad","producto":"Mouse Gamer 3200 Dpi","tipo":"tecnologia","costo":26500,"precio":39800,"stock":2,"ref":"TG-00001N","categoria":"TECNOLOGIA"},{"producto_id":"er-bafle-koleer-original-21","variante":"Unidad","producto":"Bafle Koleer Original","tipo":"tecnologia","costo":26500,"precio":39800,"stock":2,"ref":"TG-00022N","categoria":"TECNOLOGIA"},{"producto_id":"er-van-cleef-en-acero-verde-111","variante":"Unidad","producto":"Van Cleef en Acero Verde","tipo":"variedades","costo":6000,"precio":9000,"stock":2,"ref":"J-00002-V","categoria":"JOYERIA"},{"producto_id":"er-llavero-unicornio-a1-135","variante":"Unidad","producto":"Llavero Unicornio A1","tipo":"variedades","costo":2900,"precio":4400,"stock":54,"ref":"JJ-00004ML","categoria":"CACHARRERIA"},{"producto_id":"er-cable-lightning-apple-142","variante":"Unidad","producto":"Cable Lightning Apple","tipo":"tecnologia","costo":2900,"precio":4400,"stock":23,"ref":"PRO 20","categoria":"TECNOLOGIA"},{"producto_id":"er-embudo-mediano-con-mango-157","variante":"Unidad","producto":"Embudo Mediano con Mango","tipo":"variedades","costo":1800,"precio":2700,"stock":24,"ref":"JJ-00006ML","categoria":"CACHARRERIA"},{"producto_id":"er-cable-type-c-a-lightning-20w-29","variante":"Unidad","producto":"Cable Type-c a Lightning 20W","tipo":"tecnologia","costo":5200,"precio":7800,"stock":5,"ref":"CC-00003N","categoria":"TECNOLOGIA"},{"producto_id":"er-power-bank-30000-mah-sin-cable-30","variante":"Unidad","producto":"Power Bank 30.000 mAh sin Cable","tipo":"tecnologia","costo":55000,"precio":82500,"stock":4,"ref":"CC-00004N","categoria":"TECNOLOGIA"},{"producto_id":"er-dije-virgen-de-guadalupe-rodio-161","variante":"Unidad","producto":"Dije Virgen de Guadalupe Rodio","tipo":"variedades","costo":7900,"precio":11900,"stock":8,"ref":"J-00017-A","categoria":"JOYERIA"},{"producto_id":"er-dije-senor-de-los-milagros-162","variante":"Unidad","producto":"Dije Señor de Los Milagros","tipo":"variedades","costo":5000,"precio":7500,"stock":6,"ref":"J-00019-SM","categoria":"JOYERIA"},{"producto_id":"er-cadena-y-dije-100-teamo-lupa-167","variante":"Unidad","producto":"Cadena y Dije (100 Teamo Lupa)","tipo":"variedades","costo":8500,"precio":12800,"stock":2,"ref":"J-00007-O","categoria":"JOYERIA"},{"producto_id":"er-cadena-y-dije-futbol-colombiano-junior-de-barranquilla-174","variante":"Unidad","producto":"Cadena y Dije Futbol Colombiano Junior de Barranquilla","tipo":"variedades","costo":6500,"precio":9800,"stock":5,"ref":"J-00001-JUN","categoria":"JOYERIA"},{"producto_id":"er-cadena-y-dije-futbol-colombiano-deportivo-independiente-medellin-175","variante":"Unidad","producto":"Cadena y Dije Futbol Colombiano Deportivo Independiente Medellín","tipo":"variedades","costo":6500,"precio":9800,"stock":7,"ref":"J-00001-MED","categoria":"JOYERIA"},{"producto_id":"er-cadena-y-dije-futbol-colombiano-club-atletico-bucaramanga-176","variante":"Unidad","producto":"Cadena y Dije Futbol Colombiano Club Atlético Bucaramanga","tipo":"variedades","costo":6500,"precio":9800,"stock":8,"ref":"J-00001-ATB","categoria":"JOYERIA"},{"producto_id":"er-cadena-y-dije-futbol-colombiano-cucuta-deportivo-177","variante":"Unidad","producto":"Cadena y Dije Futbol Colombiano Cúcuta Deportivo","tipo":"variedades","costo":6500,"precio":9800,"stock":7,"ref":"J-00001-CAD","categoria":"JOYERIA"},{"producto_id":"er-cadena-y-dije-futbol-colombiano-deportivo-pereira-178","variante":"Unidad","producto":"Cadena y Dije Futbol Colombiano Deportivo Pereira","tipo":"variedades","costo":6500,"precio":9800,"stock":5,"ref":"J-00001-PER","categoria":"JOYERIA"},{"producto_id":"er-cadena-y-dije-futbol-colombiano-club-deportes-tolima-179","variante":"Unidad","producto":"Cadena y Dije Futbol Colombiano Club Deportes Tolima","tipo":"variedades","costo":6500,"precio":9800,"stock":5,"ref":"J-00001-TOL","categoria":"JOYERIA"},{"producto_id":"er-cadena-y-dije-futbol-colombiano-deportivo-cali-180","variante":"Unidad","producto":"Cadena y Dije Futbol Colombiano Deportivo Cali","tipo":"variedades","costo":6500,"precio":9800,"stock":1,"ref":"J-00001-CAL","categoria":"JOYERIA"},{"producto_id":"er-mini-uzi-diji-rodio-puro-brillante-188","variante":"Unidad","producto":"Mini Uzi Diji Rodio Puro Brillante","tipo":"variedades","costo":12500,"precio":18800,"stock":9,"ref":"REF-7115","categoria":"JOYERIA"},{"producto_id":"er-cadena-y-dije-cruz-en-rodio-brillante-207","variante":"Unidad","producto":"Cadena y Dije Cruz en Rodio Brillante","tipo":"variedades","costo":9900,"precio":14900,"stock":1,"ref":"REF-54841","categoria":"JOYERIA"},{"producto_id":"er-set-cocina-utencilios-221","variante":"Unidad","producto":"Set Cocina Utencilios","tipo":"variedades","costo":15500,"precio":23300,"stock":14,"ref":"REF-1457","categoria":"HOGAR"},{"producto_id":"er-kairos-original-fa226m-303b-hombre-222","variante":"Unidad","producto":"Kairos Original FA226M-303B Hombre","tipo":"variedades","costo":39900,"precio":59900,"stock":3,"ref":"REF-54457","categoria":"RELOJERIA ORIGINAL"},{"producto_id":"er-peine-cabo-metalico-242","variante":"Unidad","producto":"Peine Cabo Metalico","tipo":"variedades","costo":900,"precio":1400,"stock":4,"ref":"REF-554F","categoria":"PROMOCIONES"},{"producto_id":"er-cadena-lazo-oro-rosa-252","variante":"Unidad","producto":"Cadena Lazo Oro Rosa","tipo":"variedades","costo":8500,"precio":12800,"stock":2,"ref":"REF-548FF","categoria":"JOYERIA"},{"producto_id":"er-organizador-de-joyas-265","variante":"Unidad","producto":"Organizador de Joyas","tipo":"variedades","costo":15600,"precio":23400,"stock":2,"ref":"REF-5747","categoria":"HOGAR"},{"producto_id":"er-reloj-inteligente-audifonos-39","variante":"Unidad","producto":"Reloj Inteligente + Audifonos","tipo":"tecnologia","costo":39900,"precio":59900,"stock":1,"ref":"REF-455FF","categoria":"TECNOLOGIA"},{"producto_id":"er-bolsa-impermeable-5l-275","variante":"Unidad","producto":"Bolsa Impermeable 5L","tipo":"variedades","costo":15500,"precio":23300,"stock":2,"ref":"DP-00001","categoria":"DEPORTE"},{"producto_id":"er-audifonos-airpods-pro-2da-generacion-sin-logo-pro-2-anc-281","variante":"Unidad","producto":"Audifonos Audífonos Inalámbricos Pro 2da Generacion sin Logo Pro 2 ANC","tipo":"tecnologia","costo":18000,"precio":27000,"stock":3,"ref":"REF-418F","categoria":"TECNOLOGIA"},{"producto_id":"er-set-de-48-marcadores-rotuladores-doble-punta-282","variante":"Unidad","producto":"Set de 48 Marcadores Rotuladores Doble Punta","tipo":"variedades","costo":20900,"precio":31400,"stock":8,"ref":"REF-54","categoria":"PROMOCIONES"},{"producto_id":"er-cadena-y-dije-futbol-colombiano-club-once-caldas-287","variante":"Unidad","producto":"Cadena y Dije Futbol Colombiano Club Once Caldas","tipo":"variedades","costo":6500,"precio":9800,"stock":6,"ref":"JOY-984F","categoria":"JOYERIA"},{"producto_id":"er-gel-2000g-gigante-296","variante":"Unidad","producto":"Gel 2000G Gigante","tipo":"variedades","costo":31000,"precio":46500,"stock":4,"ref":"REF-54158","categoria":"BARBERIA INSUMOS"},{"producto_id":"er-maquina-empanaditas-automatica-297","variante":"Unidad","producto":"Maquina Empanaditas Automatica","tipo":"variedades","costo":18000,"precio":27000,"stock":3,"ref":"REF-5FF","categoria":"HOGAR"},{"producto_id":"er-aceite-para-barba-298","variante":"Unidad","producto":"Aceite para Barba","tipo":"variedades","costo":14000,"precio":21000,"stock":2,"ref":"REF-5FF","categoria":"BARBERIA INSUMOS"},{"producto_id":"er-secadora-de-unas-309","variante":"Unidad","producto":"Secadora de Uñas","tipo":"variedades","costo":29900,"precio":44900,"stock":7,"ref":"REF-4877","categoria":"HOGAR"},{"producto_id":"er-x12-cepillos-de-dientes-310","variante":"Unidad","producto":"X12 Cepillos de Dientes","tipo":"variedades","costo":12000,"precio":18000,"stock":2,"ref":"REF-487F","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-combo-tablas-cuchillo-331","variante":"Unidad","producto":"Combo Tablas + Cuchillo","tipo":"variedades","costo":5000,"precio":7500,"stock":3,"ref":"PRO 20","categoria":"HOGAR"},{"producto_id":"er-pilas-aa-alcalina-x4-unidades-339","variante":"Unidad","producto":"Pilas AA Alcalina X4 Unidades","tipo":"variedades","costo":3000,"precio":4500,"stock":19,"ref":"REF-549","categoria":"PROMOCIONES"},{"producto_id":"er-pilas-aaa-alcalina-x4-unidades-340","variante":"Unidad","producto":"Pilas AAA Alcalina X4 Unidades","tipo":"variedades","costo":3000,"precio":4500,"stock":56,"ref":"REF-554F","categoria":"PROMOCIONES"},{"producto_id":"er-pulsera-en-cuero-futbol-colombiano-342","variante":"Unidad","producto":"Pulsera en Cuero Futbol Colombiano","tipo":"variedades","costo":8800,"precio":13200,"stock":25,"ref":"REF-487G","categoria":"JOYERIA"},{"producto_id":"er-anillo-van-cleef-azul-344","variante":"Unidad","producto":"Anillo Van Cleef Azul","tipo":"variedades","costo":7000,"precio":10500,"stock":5,"ref":"REF-5DD","categoria":"JOYERIA"},{"producto_id":"er-anillo-en-rodio-oso-345","variante":"Unidad","producto":"Anillo en Rodio Oso","tipo":"variedades","costo":5400,"precio":8100,"stock":2,"ref":"REF-5418DD","categoria":"JOYERIA"},{"producto_id":"er-cadena-y-dije-virgen-guadalupe-gemas-347","variante":"Unidad","producto":"Cadena y Dije Virgen Guadalupe Gemas","tipo":"variedades","costo":9200,"precio":13800,"stock":1,"ref":"REF-54145","categoria":"JOYERIA"},{"producto_id":"er-minoxidil-kirkland-5-354","variante":"Unidad","producto":"Minoxidil Kirkland 5%","tipo":"variedades","costo":22000,"precio":33000,"stock":4,"ref":"REF-514VC","categoria":"BARBERIA INSUMOS"},{"producto_id":"er-derma-roller-system-355","variante":"Unidad","producto":"Derma Roller System","tipo":"variedades","costo":6900,"precio":10400,"stock":10,"ref":"REF-541ZV","categoria":"BARBERIA INSUMOS"},{"producto_id":"er-hervidor-de-huevos-gallinita-359","variante":"Unidad","producto":"Hervidor de Huevos Gallinita","tipo":"variedades","costo":24000,"precio":36000,"stock":2,"ref":"REF-511VV4","categoria":"HOGAR"},{"producto_id":"er-payaso-ojos-saltones-377","variante":"Unidad","producto":"Payaso Ojos Saltones","tipo":"variedades","costo":9200,"precio":13800,"stock":10,"ref":"HAE-54451","categoria":"HALLOWEEN"},{"producto_id":"er-dracula-ojos-saltones-378","variante":"Unidad","producto":"Dracula Ojos Saltones","tipo":"variedades","costo":9200,"precio":13800,"stock":10,"ref":"HAW-48FGG","categoria":"HALLOWEEN"},{"producto_id":"er-antifaz-coneja-rosa-379","variante":"Unidad","producto":"Antifaz Coneja Rosa","tipo":"variedades","costo":5000,"precio":7500,"stock":9,"ref":"HAW-54457","categoria":"HALLOWEEN"},{"producto_id":"er-hulk-mascara-sencilla-380","variante":"Unidad","producto":"Hulk Mascara Sencilla","tipo":"variedades","costo":3000,"precio":4500,"stock":8,"ref":"HAW-F7F","categoria":"HALLOWEEN"},{"producto_id":"er-la-casa-de-papel-381","variante":"Unidad","producto":"La Casa de Papel","tipo":"variedades","costo":3900,"precio":5900,"stock":11,"ref":"HAW-541F","categoria":"HALLOWEEN"},{"producto_id":"er-calavera-fomi-382","variante":"Unidad","producto":"Calavera Fomi","tipo":"variedades","costo":5250,"precio":7900,"stock":9,"ref":"HAW-48","categoria":"HALLOWEEN"},{"producto_id":"er-capitan-america-mascara-sencilla-383","variante":"Unidad","producto":"Capitan America Mascara Sencilla","tipo":"variedades","costo":3600,"precio":5400,"stock":11,"ref":"HAW-4F7FG","categoria":"HALLOWEEN"},{"producto_id":"er-sombrero-para-disfraz-negro-384","variante":"Unidad","producto":"Sombrero para Disfraz Negro","tipo":"variedades","costo":4500,"precio":6800,"stock":11,"ref":"HAW-415GF","categoria":"HALLOWEEN"},{"producto_id":"er-alas-de-mariposa-con-diadema-y-vara-385","variante":"Unidad","producto":"Alas de Mariposa con Diadema y Vara","tipo":"variedades","costo":7500,"precio":11300,"stock":6,"ref":"HAW-854FF","categoria":"HALLOWEEN"},{"producto_id":"er-estrella-musical-386","variante":"Unidad","producto":"Estrella Musical","tipo":"variedades","costo":11000,"precio":16500,"stock":4,"ref":"REF-100D","categoria":"PROMOCIONES"},{"producto_id":"er-serpientes-goma-med-388","variante":"Unidad","producto":"Serpientes Goma Med","tipo":"variedades","costo":2550,"precio":3900,"stock":10,"ref":"REF-S6","categoria":"PROMOCIONES"},{"producto_id":"er-extractor-leche-389","variante":"Unidad","producto":"Extractor Leche","tipo":"variedades","costo":1500,"precio":2300,"stock":12,"ref":"REF-S40","categoria":"CACHARRERIA"},{"producto_id":"er-salsero-396","variante":"Unidad","producto":"Salsero","tipo":"variedades","costo":1200,"precio":1800,"stock":14,"ref":"REF-S34","categoria":"CACHARRERIA"},{"producto_id":"er-borrador-nata-397","variante":"Unidad","producto":"Borrador Nata","tipo":"variedades","costo":350,"precio":600,"stock":70,"ref":"REF-S52","categoria":"PAPELERIA"},{"producto_id":"er-set-marcador-borrable-398","variante":"Unidad","producto":"Set Marcador Borrable","tipo":"variedades","costo":6900,"precio":10400,"stock":20,"ref":"REF-S25","categoria":"PAPELERIA"},{"producto_id":"er-agua-de-rosas-120-ml-402","variante":"Unidad","producto":"Agua de Rosas 120 Ml","tipo":"variedades","costo":3400,"precio":5100,"stock":25,"ref":"REF-S19","categoria":"BELLEZA"},{"producto_id":"er-lapiz-hb-403","variante":"Unidad","producto":"Lapiz Hb","tipo":"variedades","costo":340,"precio":600,"stock":2,"ref":"403","categoria":"PAPELERIA"},{"producto_id":"er-libro-nacho-404","variante":"Unidad","producto":"Libro Nacho","tipo":"variedades","costo":6950,"precio":10500,"stock":12,"ref":"REF-S22","categoria":"PAPELERIA"},{"producto_id":"er-libro-colorear-405","variante":"Unidad","producto":"Libro Colorear","tipo":"variedades","costo":1800,"precio":2700,"stock":33,"ref":"REF-S21","categoria":"PAPELERIA"},{"producto_id":"er-aceite-para-bebe-406","variante":"Unidad","producto":"Aceite para Bebe","tipo":"variedades","costo":1700,"precio":2600,"stock":12,"ref":"REF-20","categoria":"BELLEZA"},{"producto_id":"er-pega-magica-5-gr-408","variante":"Unidad","producto":"Pega Magica 5 Gr","tipo":"variedades","costo":499,"precio":800,"stock":63,"ref":"REF-S24","categoria":"PAPELERIA"},{"producto_id":"er-lapicero-negro-tinta-mojada-410","variante":"Unidad","producto":"Lapicero Negro Tinta Mojada","tipo":"variedades","costo":990,"precio":1500,"stock":45,"ref":"REF-S42","categoria":"PAPELERIA"},{"producto_id":"er-plastilina-larga-411","variante":"Unidad","producto":"Plastilina Larga","tipo":"variedades","costo":2500,"precio":3800,"stock":56,"ref":"REF-S36","categoria":"PAPELERIA"},{"producto_id":"er-rompecabezas-futbol-413","variante":"Unidad","producto":"Rompecabezas Futbol","tipo":"variedades","costo":1550,"precio":2400,"stock":5,"ref":"REF-S2","categoria":"PROMOCIONES"},{"producto_id":"er-hoja-de-afeitar-dorco-x5-415","variante":"Unidad","producto":"Hoja de Afeitar Dorco X5","tipo":"variedades","costo":1250,"precio":1900,"stock":6,"ref":"REF-S43","categoria":"BARBERIA INSUMOS"},{"producto_id":"er-sacapuntas-deposito-colores-416","variante":"Unidad","producto":"Sacapuntas Deposito Colores","tipo":"variedades","costo":710,"precio":1100,"stock":46,"ref":"REF-100","categoria":"PAPELERIA"},{"producto_id":"er-sacapuntas-metalico-420","variante":"Unidad","producto":"Sacapuntas Metalico","tipo":"variedades","costo":325,"precio":500,"stock":62,"ref":"REF-S4","categoria":"PAPELERIA"},{"producto_id":"er-silicona-en-barra-x6-421","variante":"Unidad","producto":"Silicona en Barra X6","tipo":"variedades","costo":2500,"precio":3800,"stock":16,"ref":"REF-S26","categoria":"PAPELERIA"},{"producto_id":"er-ficha-parques-x8-424","variante":"Unidad","producto":"Ficha Parques X8","tipo":"variedades","costo":2000,"precio":3000,"stock":2,"ref":"REF-S12","categoria":"CACHARRERIA"},{"producto_id":"er-talco-85-gr-hombre-427","variante":"Unidad","producto":"Talco 85 Gr Hombre","tipo":"variedades","costo":2200,"precio":3300,"stock":23,"ref":"REF-S28","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-talonario-cuenta-de-cobro-430","variante":"Unidad","producto":"Talonario Cuenta de Cobro","tipo":"variedades","costo":1150,"precio":1800,"stock":43,"ref":"REF-S31","categoria":"PAPELERIA"},{"producto_id":"er-talonario-de-rifa-431","variante":"Unidad","producto":"Talonario de Rifa","tipo":"variedades","costo":990,"precio":1500,"stock":10,"ref":"REF-S32","categoria":"PAPELERIA"},{"producto_id":"er-termo-escolar-432","variante":"Unidad","producto":"Termo Escolar","tipo":"variedades","costo":2650,"precio":4000,"stock":7,"ref":"REF-S33","categoria":"CACHARRERIA"},{"producto_id":"er-tijera-punta-roma-433","variante":"Unidad","producto":"Tijera Punta Roma","tipo":"variedades","costo":1300,"precio":2000,"stock":48,"ref":"REF-S11","categoria":"PAPELERIA"},{"producto_id":"er-corrector-grafi-8ml-434","variante":"Unidad","producto":"Corrector Grafi 8ML","tipo":"variedades","costo":1150,"precio":1800,"stock":8,"ref":"REF-S4723","categoria":"PAPELERIA"},{"producto_id":"er-atomizador-pequeno-435","variante":"Unidad","producto":"Atomizador Pequeño","tipo":"variedades","costo":990,"precio":1500,"stock":33,"ref":"REF-S55","categoria":"CACHARRERIA"},{"producto_id":"er-atomizador-grande-500-ml-436","variante":"Unidad","producto":"Atomizador Grande 500 Ml","tipo":"variedades","costo":3650,"precio":5500,"stock":4,"ref":"REF-S54","categoria":"CACHARRERIA"},{"producto_id":"er-cepillo-embetunar-438","variante":"Unidad","producto":"Cepillo Embetunar","tipo":"variedades","costo":1600,"precio":2400,"stock":51,"ref":"REF-S15","categoria":"PAPELERIA"},{"producto_id":"er-cinta-enmascarar-12-442","variante":"Unidad","producto":"Cinta Enmascarar 1/2","tipo":"variedades","costo":1600,"precio":2400,"stock":55,"ref":"REF-S14d","categoria":"PAPELERIA"},{"producto_id":"er-airpods-generacion-6-53","variante":"Unidad","producto":"Audífonos Inalámbricos Generacion 6","tipo":"tecnologia","costo":41000,"precio":61500,"stock":6,"ref":"REF-15414","categoria":"TECNOLOGIA"},{"producto_id":"er-inflador-de-bomba-sencillo-461","variante":"Unidad","producto":"Inflador de Bomba Sencillo","tipo":"variedades","costo":2600,"precio":3900,"stock":7,"ref":"REF-1F44F","categoria":"CACHARRERIA"},{"producto_id":"er-lampara-ovalada-economica-basica-463","variante":"Unidad","producto":"Lampara Ovalada Economica Basica","tipo":"variedades","costo":6500,"precio":9800,"stock":1,"ref":"R-DF4F","categoria":"CACHARRERIA"},{"producto_id":"er-lamina-religiosa-pna-467","variante":"Unidad","producto":"Lamina Religiosa Pna","tipo":"variedades","costo":250,"precio":400,"stock":100,"ref":"REF-55DD","categoria":"CACHARRERIA"},{"producto_id":"er-shampo-1-litro-frutal-473","variante":"Unidad","producto":"Shampo 1 Litro Frutal","tipo":"variedades","costo":8900,"precio":13400,"stock":1,"ref":"REF-55F444","categoria":"BELLEZA"},{"producto_id":"er-acondicionador-1-litro-frutal-474","variante":"Unidad","producto":"Acondicionador 1 Litro Frutal","tipo":"variedades","costo":8900,"precio":13400,"stock":13,"ref":"REF-55F44g","categoria":"BELLEZA"},{"producto_id":"er-pistola-silicona-economica-476","variante":"Unidad","producto":"Pistola Silicona Economica","tipo":"variedades","costo":3750,"precio":5700,"stock":20,"ref":"476","categoria":"FERRETERIA"},{"producto_id":"er-contorno-de-ojos-antioxidante-vitamina-e-bioaqua-482","variante":"Unidad","producto":"Contorno de Ojos Antioxidante Vitamina E Bioaqua","tipo":"variedades","costo":2750,"precio":4200,"stock":45,"ref":"SAD-41FDD","categoria":"BELLEZA"},{"producto_id":"er-jabon-facial-reparador-aloe-vera-bioaqua-489","variante":"Unidad","producto":"Jabon Facial Reparador Aloe Vera Bioaqua","tipo":"variedades","costo":7930,"precio":11900,"stock":16,"ref":"DFE-5441","categoria":"BELLEZA"},{"producto_id":"er-tonico-facial-de-ceramidas-y-acido-hialuronico-bioaqua-493","variante":"Unidad","producto":"Tonico Facial de Ceramidas y Acido Hialurónico Bioaqua","tipo":"variedades","costo":5400,"precio":8100,"stock":4,"ref":"REF546D1G5G","categoria":"BELLEZA"},{"producto_id":"er-vitamina-c-antioxidante-serum-grande-494","variante":"Unidad","producto":"Vitamina C Antioxidante Serum Grande","tipo":"variedades","costo":6000,"precio":9000,"stock":4,"ref":"REF-141FFF","categoria":"BELLEZA"},{"producto_id":"er-mouse-m29-dpi-1600-61","variante":"Unidad","producto":"Mouse M29 Dpi 1600","tipo":"tecnologia","costo":8680,"precio":13100,"stock":5,"ref":"REF-M29","categoria":"TECNOLOGIA"},{"producto_id":"er-mouse-m30-depi-1600-62","variante":"Unidad","producto":"Mouse M30 Depi 1600","tipo":"tecnologia","costo":10000,"precio":15000,"stock":5,"ref":"REF-M30","categoria":"TECNOLOGIA"},{"producto_id":"er-combo-teclado-inalambrico-64","variante":"Unidad","producto":"Combo Teclado Inalámbrico","tipo":"tecnologia","costo":29980,"precio":45000,"stock":6,"ref":"AS-110","categoria":"TECNOLOGIA"},{"producto_id":"er-soporte-para-moto-65","variante":"Unidad","producto":"Soporte para Moto","tipo":"tecnologia","costo":13200,"precio":19800,"stock":6,"ref":"M3","categoria":"TECNOLOGIA"},{"producto_id":"er-soporte-diadema-acero-525","variante":"Unidad","producto":"Soporte Diadema Acero","tipo":"variedades","costo":14980,"precio":22500,"stock":1,"ref":"REF-6548DD","categoria":"HOGAR"},{"producto_id":"er-unisex-habik-de-lattafa-527","variante":"Unidad","producto":"Unisex Habik de Lattafa","tipo":"variedades","costo":55000,"precio":82500,"stock":6,"ref":"REF-LOC4","categoria":"PERFUMERIA"},{"producto_id":"er-x80-marcadores-doble-punta-542","variante":"Unidad","producto":"X80 Marcadores Doble Punta","tipo":"variedades","costo":33000,"precio":49500,"stock":10,"ref":"BOG-1","categoria":"PAPELERIA"},{"producto_id":"er-bombillo-parlante-led-rgb-69","variante":"Unidad","producto":"Bombillo Parlante LED RGB","tipo":"tecnologia","costo":12500,"precio":18800,"stock":3,"ref":"REF-5DDD","categoria":"TECNOLOGIA"},{"producto_id":"er-manguera-de-30-metros-545","variante":"Unidad","producto":"Manguera de 30 Metros","tipo":"variedades","costo":24000,"precio":36000,"stock":2,"ref":"REF-741G","categoria":"FERRETERIA"},{"producto_id":"er-kairos-original-fa228-900m-548","variante":"Unidad","producto":"Kairos Original FA228-900M","tipo":"variedades","costo":52000,"precio":78000,"stock":1,"ref":"ORIGI-7D44F","categoria":"RELOJERIA ORIGINAL"},{"producto_id":"er-hombre-kairos-original-du430493g-4-551","variante":"Unidad","producto":"Hombre Kairos Original DU430493G-4","tipo":"variedades","costo":139900,"precio":209900,"stock":2,"ref":"R-KAIROSF1","categoria":"RELOJERIA ORIGINAL"},{"producto_id":"er-dama-kairos-original-fa017-401l-552","variante":"Unidad","producto":"Dama Kairos Original FA017-401L","tipo":"variedades","costo":75000,"precio":112500,"stock":2,"ref":"R-KAIROSF2","categoria":"RELOJERIA ORIGINAL"},{"producto_id":"er-lampara-ventilador-portatil-553","variante":"Unidad","producto":"Lampara Ventilador Portatil","tipo":"variedades","costo":19500,"precio":29300,"stock":1,"ref":"REF-871G","categoria":"HOGAR"},{"producto_id":"er-kairos-original-fa039m-900-hombre-554","variante":"Unidad","producto":"Kairos Original FA039M-900 Hombre","tipo":"variedades","costo":39900,"precio":59900,"stock":2,"ref":"REF-KAIROSF3","categoria":"RELOJERIA ORIGINAL"},{"producto_id":"er-juego-de-carta-espanola-559","variante":"Unidad","producto":"Juego de Carta Española","tipo":"variedades","costo":1980,"precio":3000,"stock":5,"ref":"REF-7S1F","categoria":"CACHARRERIA"},{"producto_id":"er-set-x3-cuchillos-cocina-566","variante":"Unidad","producto":"Set X3 Cuchillos Cocina","tipo":"variedades","costo":4980,"precio":7500,"stock":2,"ref":"REF-447F4DD","categoria":"HOGAR"},{"producto_id":"er-marcador-borrable-571","variante":"Unidad","producto":"Marcador Borrable","tipo":"variedades","costo":1050,"precio":1600,"stock":45,"ref":"44F7XD4","categoria":"PAPELERIA"},{"producto_id":"er-neopreno-seleccion-colombia-583","variante":"Unidad","producto":"Neopreno Seleccion Colombia","tipo":"variedades","costo":9900,"precio":14900,"stock":20,"ref":"REF78A","categoria":"JOYERIA"},{"producto_id":"er-estufa-electrica-1-puesto-584","variante":"Unidad","producto":"Estufa Electrica 1 Puesto","tipo":"variedades","costo":24900,"precio":37400,"stock":3,"ref":"REF-565SF","categoria":"HOGAR"},{"producto_id":"er-pistola-hidrolavadora-portatil-con-dos-baterias-601","variante":"Unidad","producto":"Pistola Hidrolavadora Portatil con Dos Baterias","tipo":"variedades","costo":58000,"precio":87000,"stock":6,"ref":"REF-541DG","categoria":"HOGAR"},{"producto_id":"er-jabon-rosas-y-ac-hialuron-bioaq-bqy15433-606","variante":"Unidad","producto":"Jabon Rosas y AC Hialuron Bioaq BQY15433","tipo":"variedades","costo":4600,"precio":6900,"stock":9,"ref":"REF-541FHH","categoria":"BELLEZA"},{"producto_id":"er-kit-facial-orange-x6-vitamina-c-607","variante":"Unidad","producto":"Kit Facial Orange X6 Vitamina C","tipo":"variedades","costo":35000,"precio":52500,"stock":16,"ref":"REF-GG5GG1F","categoria":"BELLEZA"},{"producto_id":"er-dama-kairos-original-fa017-901l-609","variante":"Unidad","producto":"Dama Kairos Original FA017-901L","tipo":"variedades","costo":59900,"precio":89900,"stock":1,"ref":"609","categoria":"RELOJERIA ORIGINAL"},{"producto_id":"er-kairos-original-hombre-fa081b-202m-610","variante":"Unidad","producto":"Kairos Original Hombre FA081B-202M","tipo":"variedades","costo":39900,"precio":59900,"stock":2,"ref":"KLF2183M-303","categoria":"RELOJERIA ORIGINAL"},{"producto_id":"er-diademas-inalambricas-eb610-82","variante":"Unidad","producto":"Diademas Inalambricas EB610","tipo":"tecnologia","costo":45000,"precio":67500,"stock":1,"ref":"REF-541DGDD","categoria":"TECNOLOGIA"},{"producto_id":"er-airpods-anc-enc-yw08-83","variante":"Unidad","producto":"Audífonos Inalámbricos ANC Enc YW08","tipo":"tecnologia","costo":56800,"precio":85200,"stock":1,"ref":"REF-51GDGDS","categoria":"TECNOLOGIA"},{"producto_id":"er-airpods-manos-libres-tws-xg23-84","variante":"Unidad","producto":"Audífonos Inalámbricos Manos Libres TWS XG23","tipo":"tecnologia","costo":48500,"precio":72800,"stock":7,"ref":"TEC-00015","categoria":"TECNOLOGIA"},{"producto_id":"er-afeitadora-recargable-3-en-1-628","variante":"Unidad","producto":"Afeitadora Recargable 3 en 1","tipo":"variedades","costo":23900,"precio":35900,"stock":1,"ref":"5154DG","categoria":"BARBERIA INSUMOS"},{"producto_id":"er-kairos-original-fa034m-001b-638","variante":"Unidad","producto":"Kairos Original FA034M-001B","tipo":"variedades","costo":39900,"precio":59900,"stock":2,"ref":"638","categoria":"RELOJERIA ORIGINAL"},{"producto_id":"er-vaporub-gel-marihuana-20gr-682","variante":"Unidad","producto":"Vaporub Gel Marihuana 20GR","tipo":"variedades","costo":1450,"precio":2200,"stock":38,"ref":"REF-51G4H1F","categoria":"CACHARRERIA"},{"producto_id":"er-rodillo-removedor-694","variante":"Unidad","producto":"Rodillo Removedor","tipo":"variedades","costo":7000,"precio":10500,"stock":2,"ref":"REF-745GG22","categoria":"MASCOTAS"},{"producto_id":"er-faja-palma-y-muneca-695","variante":"Unidad","producto":"Faja Palma y Muñeca","tipo":"variedades","costo":1800,"precio":2700,"stock":15,"ref":"REF-7444GGG","categoria":"DEPORTE"},{"producto_id":"er-bombillo-pequeno-5w-697","variante":"Unidad","producto":"Bombillo Pequeño 5W","tipo":"variedades","costo":1900,"precio":2900,"stock":23,"ref":"REF-1GGGD","categoria":"FERRETERIA"},{"producto_id":"er-bombillo-pequeno-7w-698","variante":"Unidad","producto":"Bombillo Pequeño 7W","tipo":"variedades","costo":2100,"precio":3200,"stock":24,"ref":"REF-745DDG","categoria":"FERRETERIA"},{"producto_id":"er-lapiz-tactil-universal-91","variante":"Unidad","producto":"Lapiz Tactil Universal","tipo":"tecnologia","costo":23500,"precio":35300,"stock":4,"ref":"TEC-00010","categoria":"TECNOLOGIA"},{"producto_id":"er-aibimy-original-my212-waterproof-92","variante":"Unidad","producto":"Aibimy Original MY212 Waterproof","tipo":"tecnologia","costo":49500,"precio":74300,"stock":4,"ref":"REF-51FFH","categoria":"TECNOLOGIA"},{"producto_id":"er-talonera-de-seguridad-luz-x1-unidad-717","variante":"Unidad","producto":"Talonera de Seguridad Luz X1 Unidad","tipo":"variedades","costo":5900,"precio":8900,"stock":9,"ref":"REF-745GGH1","categoria":"DEPORTE"},{"producto_id":"er-peine-plano-afro-730","variante":"Unidad","producto":"Peine Plano Afro","tipo":"variedades","costo":900,"precio":1400,"stock":36,"ref":"CH-00008","categoria":"CACHARRERIA"},{"producto_id":"er-ak47-pistola-de-hidrogel-luz-y-humo-740","variante":"Unidad","producto":"AK47 Pistola de Hidrogel Luz y Humo","tipo":"variedades","costo":64000,"precio":96000,"stock":1,"ref":"REF-745gg","categoria":"PROMOCIONES"},{"producto_id":"er-corrector-de-postura-unisex-741","variante":"Unidad","producto":"Corrector de Postura Unisex","tipo":"variedades","costo":9900,"precio":14900,"stock":5,"ref":"REF-745f44f","categoria":"DEPORTE"},{"producto_id":"er-mancuerna-elastica-pies-743","variante":"Unidad","producto":"Mancuerna Elastica Pies","tipo":"variedades","costo":18500,"precio":27800,"stock":5,"ref":"STREAMINGNNH","categoria":"DEPORTE"},{"producto_id":"er-cucharon-metalico-plano-749","variante":"Unidad","producto":"Cucharon Metalico Plano","tipo":"variedades","costo":3900,"precio":5900,"stock":4,"ref":"REF-5154GFFH","categoria":"CACHARRERIA"},{"producto_id":"er-balon-voleybol-caucho-750","variante":"Unidad","producto":"Balon Voleybol Caucho","tipo":"variedades","costo":1750,"precio":2700,"stock":22,"ref":"REF-5C1CV","categoria":"DEPORTE"},{"producto_id":"er-set-pelotras-de-pin-pong-x12-751","variante":"Unidad","producto":"Set Pelotras de Pin Pong X12","tipo":"variedades","costo":7000,"precio":10500,"stock":1,"ref":"REF-5DDDDV","categoria":"DEPORTE"},{"producto_id":"er-set-pelotras-de-pin-pong-x6-752","variante":"Unidad","producto":"Set Pelotras de Pin Pong X6","tipo":"variedades","costo":3700,"precio":5600,"stock":2,"ref":"REF-745f22fg","categoria":"DEPORTE"},{"producto_id":"er-regla-aluminio-30cm-756","variante":"Unidad","producto":"Regla Aluminio 30CM","tipo":"variedades","costo":1300,"precio":2000,"stock":13,"ref":"REF-55611F","categoria":"PAPELERIA"},{"producto_id":"er-pistola-rociadora-758","variante":"Unidad","producto":"Pistola Rociadora","tipo":"variedades","costo":3200,"precio":4800,"stock":11,"ref":"REF-745","categoria":"CACHARRERIA"},{"producto_id":"er-bisturi-premium-759","variante":"Unidad","producto":"Bisturi Premium","tipo":"variedades","costo":8860,"precio":13300,"stock":10,"ref":"REF-100C521V","categoria":"PAPELERIA"},{"producto_id":"er-bisturi-economico-760","variante":"Unidad","producto":"Bisturi Economico","tipo":"variedades","costo":700,"precio":1100,"stock":1,"ref":"REF-5457214F","categoria":"PAPELERIA"},{"producto_id":"er-original-cable-tipo-c-a-tipo-c-60w-carga-rapida-95","variante":"Unidad","producto":"Original Cable Tipo C a Tipo C 60W Carga Rapida","tipo":"tecnologia","costo":7800,"precio":11700,"stock":1,"ref":"REF-74ff544","categoria":"TECNOLOGIA"},{"producto_id":"er-gafas-bluetooh-recargable-98","variante":"Unidad","producto":"Gafas Bluetooh Recargable","tipo":"tecnologia","costo":24000,"precio":36000,"stock":3,"ref":"REF-745651547","categoria":"TECNOLOGIA"},{"producto_id":"er-protector-solar-vitamina-c-bioaqua-805","variante":"Unidad","producto":"Protector Solar Vitamina C Bioaqua","tipo":"variedades","costo":4400,"precio":6600,"stock":25,"ref":"BQY81681","categoria":"BELLEZA"},{"producto_id":"er-teclado-tv-original-99","variante":"Unidad","producto":"Teclado TV Original","tipo":"tecnologia","costo":16900,"precio":25400,"stock":3,"ref":"TEC-00011","categoria":"TECNOLOGIA"},{"producto_id":"er-estufa-de-lena-plegable-portatil-811","variante":"Unidad","producto":"Estufa de Leña Plegable Portatil","tipo":"variedades","costo":30000,"precio":45000,"stock":3,"ref":"REF-745574","categoria":"CACHARRERIA"},{"producto_id":"er-parlante-okop-kp-539-813","variante":"Unidad","producto":"Parlante Okop KP-539","tipo":"tecnologia","costo":36500,"precio":54800,"stock":3,"ref":"REF2154411","categoria":"TECNOLOGIA"},{"producto_id":"er-aibimy-my262bt-original-ipx6-101","variante":"Unidad","producto":"Aibimy MY262BT Original IPX6","tipo":"tecnologia","costo":75500,"precio":113300,"stock":1,"ref":"817","categoria":"TECNOLOGIA"},{"producto_id":"er-fortalecedor-de-pestanas-tratamiento-828","variante":"Unidad","producto":"Fortalecedor de Pestañas Tratamiento","tipo":"variedades","costo":4680,"precio":7100,"stock":13,"ref":"BE-00003","categoria":"BELLEZA"},{"producto_id":"er-impermeable-zapatos-838","variante":"Unidad","producto":"Impermeable Zapatos","tipo":"variedades","costo":3490,"precio":5300,"stock":8,"ref":"REF-7451517","categoria":"CACHARRERIA"},{"producto_id":"er-colores-premium-x12-unidades-851","variante":"Unidad","producto":"Colores Premium X12 Unidades","tipo":"variedades","costo":4550,"precio":6900,"stock":12,"ref":"REF-745","categoria":"PAPELERIA"},{"producto_id":"er-curitas-cubreland-x100-unidades-852","variante":"Unidad","producto":"Curitas Cubreland X100 Unidades","tipo":"variedades","costo":6500,"precio":9800,"stock":6,"ref":"HG-00010","categoria":"HOGAR"},{"producto_id":"er-microfono-de-solapa-108","variante":"Unidad","producto":"Microfono de Solapa","tipo":"tecnologia","costo":13000,"precio":19500,"stock":9,"ref":"TEC-00027","categoria":"TECNOLOGIA"},{"producto_id":"er-colgate-triple-accion-x3-pack-125ml-861","variante":"Unidad","producto":"Colgate Triple Accion X3 Pack 125ML","tipo":"variedades","costo":26000,"precio":39000,"stock":4,"ref":"A015","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-oral-plus-enjuague-500ml-864","variante":"Unidad","producto":"Oral Plus Enjuague 500ML","tipo":"variedades","costo":11400,"precio":17100,"stock":3,"ref":"A030","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-serum-removedor-de-acne-ps-bioaqua-869","variante":"Unidad","producto":"Serum Removedor de Acne Ps Bioaqua","tipo":"variedades","costo":6110,"precio":9200,"stock":20,"ref":"141FF22D","categoria":"BELLEZA"},{"producto_id":"er-micropore-delgado-875","variante":"Unidad","producto":"Micropore Delgado","tipo":"variedades","costo":1000,"precio":1500,"stock":4,"ref":"CF-00001","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-micropore-grueso-876","variante":"Unidad","producto":"Micropore Grueso","tipo":"variedades","costo":1990,"precio":3000,"stock":1,"ref":"CF-00002","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-acondicionador-profesional-coco-1-litro-878","variante":"Unidad","producto":"Acondicionador Profesional Coco 1 Litro","tipo":"variedades","costo":15000,"precio":22500,"stock":11,"ref":"REF-7454D","categoria":"BELLEZA"},{"producto_id":"er-acondicionador-profesional-romero-500-ml-879","variante":"Unidad","producto":"Acondicionador Profesional Romero 500 Ml","tipo":"variedades","costo":10500,"precio":15800,"stock":5,"ref":"1011112","categoria":"BELLEZA"},{"producto_id":"er-shampo-profesional-romero-500-ml-880","variante":"Unidad","producto":"Shampo Profesional Romero 500 Ml","tipo":"variedades","costo":10500,"precio":15800,"stock":8,"ref":"880","categoria":"BELLEZA"},{"producto_id":"er-cuchara-metal-x12-881","variante":"Unidad","producto":"Cuchara Metal X12","tipo":"variedades","costo":6000,"precio":9000,"stock":2,"ref":"REF-745","categoria":"HOGAR"},{"producto_id":"er-parlante-bluetooh-rgb-110","variante":"Unidad","producto":"Parlante Bluetooh RGB","tipo":"tecnologia","costo":20500,"precio":30800,"stock":5,"ref":"REF-745214","categoria":"TECNOLOGIA"},{"producto_id":"er-masajeador-electrico-pies-895","variante":"Unidad","producto":"Masajeador Electrico Pies","tipo":"variedades","costo":9500,"precio":14300,"stock":9,"ref":"DEPO-23","categoria":"DEPORTE"},{"producto_id":"er-secador-de-cabello-nova-897","variante":"Unidad","producto":"Secador de Cabello Nova","tipo":"variedades","costo":20800,"precio":31200,"stock":9,"ref":"12093","categoria":"HOGAR"},{"producto_id":"er-cepillo-colgate-premiier-898","variante":"Unidad","producto":"Cepillo Colgate Premiier","tipo":"variedades","costo":2450,"precio":3700,"stock":8,"ref":"A003","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-aspirina-efervescente-899","variante":"Unidad","producto":"Aspirina Efervescente","tipo":"variedades","costo":950,"precio":1500,"stock":193,"ref":"A289","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-gillete-prestobarba-ultra-maquina-afeiatr-900","variante":"Unidad","producto":"Gillete Prestobarba Ultra Maquina Afeiatr","tipo":"variedades","costo":2900,"precio":4400,"stock":23,"ref":"A129","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-cepillo-corona-901","variante":"Unidad","producto":"Cepillo Corona","tipo":"variedades","costo":1280,"precio":2000,"stock":12,"ref":"A018","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-noxpirin-plus-capsula-x1-und-902","variante":"Unidad","producto":"Noxpirin Plus Capsula X1 Und","tipo":"variedades","costo":1120,"precio":1700,"stock":22,"ref":"A235","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-oral-plus-seda-50-mt-higiene-oral-903","variante":"Unidad","producto":"Oral Plus Seda 50 Mt-higiene Oral","tipo":"variedades","costo":8,"precio":100,"stock":5,"ref":"A022","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-noraver-garganta-x1-unidad-905","variante":"Unidad","producto":"Noraver Garganta X1 Unidad","tipo":"variedades","costo":2057,"precio":3100,"stock":1,"ref":"A411","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-sunway-plus-bloqueador-solar-50fps-906","variante":"Unidad","producto":"Sunway Plus Bloqueador Solar 50FPS","tipo":"variedades","costo":1625,"precio":2500,"stock":40,"ref":"A497","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-intibon-jabon-intimo-x1-unidad-907","variante":"Unidad","producto":"Intibon Jabon Intimo X1 Unidad","tipo":"variedades","costo":7200,"precio":10800,"stock":4,"ref":"A313","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-cepillo-de-dientes-happy-tooth-x1-unidad-908","variante":"Unidad","producto":"Cepillo de Dientes Happy Tooth X1 Unidad","tipo":"variedades","costo":950,"precio":1500,"stock":1,"ref":"A023","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-speed-stick-aerosol-150ml-909","variante":"Unidad","producto":"Speed Stick Aerosol 150ML","tipo":"variedades","costo":15300,"precio":23000,"stock":6,"ref":"A428","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-lady-speed-aerosol-150ml-x1-und-910","variante":"Unidad","producto":"Lady Speed Aerosol 150ML X1 Und","tipo":"variedades","costo":15000,"precio":22500,"stock":3,"ref":"910","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-sedal-shpacon-400-ml-912","variante":"Unidad","producto":"Sedal Shp/acon 400 Ml","tipo":"variedades","costo":14400,"precio":21600,"stock":3,"ref":"A063","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-nutribella-shampo-400-ml-913","variante":"Unidad","producto":"Nutribella Shampo 400 Ml","tipo":"variedades","costo":18000,"precio":27000,"stock":4,"ref":"A627","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-axe-desodorante-aerosol-150ml-914","variante":"Unidad","producto":"Axe Desodorante Aerosol 150ML","tipo":"variedades","costo":13800,"precio":20700,"stock":9,"ref":"A129","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-mexana-aerosol-250ml-915","variante":"Unidad","producto":"Mexana Aerosol 250ML","tipo":"variedades","costo":15600,"precio":23400,"stock":1,"ref":"A134","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-emulsion-scott-grande-360ml-916","variante":"Unidad","producto":"Emulsion Scott Grande 360ML","tipo":"variedades","costo":25800,"precio":38700,"stock":3,"ref":"A343","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-speed-stick-barra-51g-918","variante":"Unidad","producto":"Speed Stick Barra 51G","tipo":"variedades","costo":13200,"precio":19800,"stock":6,"ref":"CF-00003","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-lampara-decorativa-astronauta-a1-112","variante":"Unidad","producto":"Lampara Decorativa Astronauta A1","tipo":"tecnologia","costo":13900,"precio":20900,"stock":14,"ref":"TEC-00025","categoria":"TECNOLOGIA"},{"producto_id":"er-inflador-electrico-para-globos-921","variante":"Unidad","producto":"Inflador Electrico para Globos","tipo":"variedades","costo":36000,"precio":54000,"stock":2,"ref":"CH-00007","categoria":"CACHARRERIA"},{"producto_id":"er-lampara-giratoria-mandala-922","variante":"Unidad","producto":"Lampara Giratoria Mandala","tipo":"variedades","costo":21600,"precio":32400,"stock":6,"ref":"REF-514FF","categoria":"HOGAR"},{"producto_id":"er-lampara-decorativa-a66-930","variante":"Unidad","producto":"Lampara Decorativa A66","tipo":"variedades","costo":14400,"precio":21600,"stock":2,"ref":"930","categoria":"HOGAR"},{"producto_id":"er-lampara-repelente-de-mosquitos-936","variante":"Unidad","producto":"Lampara Repelente de Mosquitos","tipo":"variedades","costo":4500,"precio":6800,"stock":2,"ref":"PROVCALI-1-4","categoria":"HOGAR"},{"producto_id":"er-jabon-facial-activacion-de-colageno-antienvejecimiento-949","variante":"Unidad","producto":"Jabon Facial Activacion de Colageno Antienvejecimiento","tipo":"variedades","costo":6000,"precio":9000,"stock":19,"ref":"BE-00004","categoria":"BELLEZA"},{"producto_id":"er-mouse-ergonomico-inalambrico-115","variante":"Unidad","producto":"Mouse Ergonomico Inalambrico","tipo":"tecnologia","costo":29900,"precio":44900,"stock":2,"ref":"TEC-00013","categoria":"TECNOLOGIA"},{"producto_id":"er-x48-pro-marcadores-doble-punta-a7-951","variante":"Unidad","producto":"X48 Pro Marcadores Doble Punta A7","tipo":"variedades","costo":29900,"precio":44900,"stock":1,"ref":"951","categoria":"PAPELERIA"},{"producto_id":"er-cuaderno-100h-cosido-qnota-scribe-cuadros-957","variante":"Unidad","producto":"Cuaderno 100H Cosido Qnota Scribe Cuadros","tipo":"variedades","costo":2600,"precio":3900,"stock":123,"ref":"957","categoria":"PAPELERIA"},{"producto_id":"er-cuaderno-50h-cosido-qnota-scribe-cuadros-958","variante":"Unidad","producto":"Cuaderno 50H Cosido Qnota Scribe Cuadros","tipo":"variedades","costo":2080,"precio":3200,"stock":165,"ref":"958","categoria":"PAPELERIA"},{"producto_id":"er-llavero-nmax-coleccion-965","variante":"Unidad","producto":"Llavero Nmax Coleccion","tipo":"variedades","costo":14900,"precio":22400,"stock":10,"ref":"965","categoria":"CACHARRERIA"},{"producto_id":"er-lapiz-norma-x1-unidad-966","variante":"Unidad","producto":"Lapiz Norma X1 Unidad","tipo":"variedades","costo":554,"precio":900,"stock":31,"ref":"966","categoria":"PAPELERIA"},{"producto_id":"er-panitos-humedos-x100-und-grande-968","variante":"Unidad","producto":"Pañitos Humedos X100 Und Grande","tipo":"variedades","costo":6200,"precio":9300,"stock":1,"ref":"12343","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-parche-anti-acne-x24-und-sobre-979","variante":"Unidad","producto":"Parche Anti Acne X24 Und Sobre","tipo":"variedades","costo":4550,"precio":6900,"stock":10,"ref":"979","categoria":"BELLEZA"},{"producto_id":"er-lip-balmp-hidratante-reparador-fino-982","variante":"Unidad","producto":"Lip Balmp Hidratante Reparador Fino","tipo":"variedades","costo":3350,"precio":5100,"stock":6,"ref":"BE-00002","categoria":"BELLEZA"},{"producto_id":"er-plato-hondo-x1-unidad-a1-986","variante":"Unidad","producto":"Plato Hondo X1 Unidad A1","tipo":"variedades","costo":1150,"precio":1800,"stock":19,"ref":"986","categoria":"CACHARRERIA"},{"producto_id":"er-soporte-para-tv-de-17-a-55-989","variante":"Unidad","producto":"Soporte para TV de 17\" a 55\"","tipo":"variedades","costo":22000,"precio":33000,"stock":2,"ref":"FR-00003","categoria":"FERRETERIA"},{"producto_id":"er-reflector-solar-portatil-993","variante":"Unidad","producto":"Reflector Solar Portatil","tipo":"variedades","costo":27500,"precio":41300,"stock":6,"ref":"REF-00003","categoria":"FERRETERIA"},{"producto_id":"er-hervidor-de-agua-electrico-portable-a4-1004","variante":"Unidad","producto":"Hervidor de Agua Electrico Portable A4","tipo":"variedades","costo":25980,"precio":39000,"stock":6,"ref":"514887","categoria":"HOGAR"},{"producto_id":"er-hervidora-de-agua-scarlett-1005","variante":"Unidad","producto":"Hervidora de Agua Scarlett","tipo":"variedades","costo":32000,"precio":48000,"stock":6,"ref":"1005","categoria":"HOGAR"},{"producto_id":"er-reloj-para-carro-o-moto-pegable-1007","variante":"Unidad","producto":"Reloj para Carro o Moto Pegable","tipo":"variedades","costo":3950,"precio":6000,"stock":8,"ref":"1007","categoria":"CACHARRERIA"},{"producto_id":"er-cargador-de-coche-rapido-original-pc17-118","variante":"Unidad","producto":"Cargador de Coche Rapido Original PC17","tipo":"tecnologia","costo":9315,"precio":14000,"stock":5,"ref":"PC17652","categoria":"TECNOLOGIA"},{"producto_id":"er-cargador-pro-ultra-rapido-carro-pc19-original-119","variante":"Unidad","producto":"Cargador Pro Ultra Rapido Carro PC19 Original","tipo":"tecnologia","costo":13225,"precio":19900,"stock":9,"ref":"1016","categoria":"TECNOLOGIA"},{"producto_id":"er-airpods-edicion-especial-codabury-original-120","variante":"Unidad","producto":"Audífonos Inalámbricos Edicion Especial Codabury","tipo":"tecnologia","costo":38900,"precio":58400,"stock":2,"ref":"1017","categoria":"TECNOLOGIA"},{"producto_id":"er-airpods-tws-original-es45-121","variante":"Unidad","producto":"Audífonos Inalámbricos TWS ES45","tipo":"tecnologia","costo":28750,"precio":43200,"stock":3,"ref":"1018","categoria":"TECNOLOGIA"},{"producto_id":"er-airpods-original-es48-122","variante":"Unidad","producto":"Audífonos Inalámbricos ES48","tipo":"tecnologia","costo":35000,"precio":52500,"stock":7,"ref":"1019","categoria":"TECNOLOGIA"},{"producto_id":"er-mouse-original-inalambrico-pro-124","variante":"Unidad","producto":"Mouse Original Inalambrico Pro","tipo":"tecnologia","costo":26450,"precio":39700,"stock":10,"ref":"1021","categoria":"TECNOLOGIA"},{"producto_id":"er-diademas-de-alta-calidad-eb31-125","variante":"Unidad","producto":"Diademas de Alta Calidad EB31","tipo":"tecnologia","costo":52900,"precio":79400,"stock":2,"ref":"1022","categoria":"TECNOLOGIA"},{"producto_id":"er-diademas-pro-eb32-127","variante":"Unidad","producto":"Diademas Pro EB32","tipo":"tecnologia","costo":53000,"precio":79500,"stock":3,"ref":"1025","categoria":"TECNOLOGIA"},{"producto_id":"er-cargador-de-bateria-para-carros-y-motos-1028","variante":"Unidad","producto":"Cargador de Bateria para Carros y Motos","tipo":"variedades","costo":44900,"precio":67400,"stock":3,"ref":"1028","categoria":"FERRETERIA"},{"producto_id":"er-cuchara-plastica-para-cocinar-1029","variante":"Unidad","producto":"Cuchara Plastica para Cocinar","tipo":"variedades","costo":975,"precio":1500,"stock":33,"ref":"1029","categoria":"CACHARRERIA"},{"producto_id":"er-pela-papa-plastico-1030","variante":"Unidad","producto":"Pela Papa Plastico","tipo":"variedades","costo":910,"precio":1400,"stock":36,"ref":"1030","categoria":"CACHARRERIA"},{"producto_id":"er-maquina-de-coser-mas-tabla-1038","variante":"Unidad","producto":"Maquina de Coser Mas Tabla","tipo":"variedades","costo":42000,"precio":63000,"stock":6,"ref":"HG-00011","categoria":"HOGAR"},{"producto_id":"er-aspiradora-mini-usb-1039","variante":"Unidad","producto":"Aspiradora Mini USB","tipo":"variedades","costo":9100,"precio":13700,"stock":2,"ref":"1039","categoria":"HOGAR"},{"producto_id":"er-parches-para-el-dolor-1041","variante":"Unidad","producto":"Parches para el Dolor","tipo":"variedades","costo":2700,"precio":4100,"stock":22,"ref":"CH-00005","categoria":"CACHARRERIA"},{"producto_id":"er-cepillo-alisador-y-secador-de-cabello-1042","variante":"Unidad","producto":"Cepillo Alisador y Secador de Cabello","tipo":"variedades","costo":19900,"precio":29900,"stock":6,"ref":"HG-00012","categoria":"HOGAR"},{"producto_id":"er-cargador-inalambrico-ki90-128","variante":"Unidad","producto":"Cargador Inalambrico KI90","tipo":"tecnologia","costo":32200,"precio":48300,"stock":1,"ref":"1043","categoria":"TECNOLOGIA"},{"producto_id":"er-set-de-vajillas-de-calidad-para-ninos-1045","variante":"Unidad","producto":"Set de Vajillas de Calidad para Niños","tipo":"variedades","costo":5460,"precio":8200,"stock":9,"ref":"1045","categoria":"CACHARRERIA"},{"producto_id":"er-airpods-pea-pod-edicion-especial-130","variante":"Unidad","producto":"Audífonos Inalámbricos Pea Pod Edicion Especial","tipo":"tecnologia","costo":47150,"precio":70800,"stock":5,"ref":"1046","categoria":"TECNOLOGIA"},{"producto_id":"er-bombillo-pequeno-15w-1051","variante":"Unidad","producto":"Bombillo Pequeño 15W","tipo":"variedades","costo":3200,"precio":4800,"stock":7,"ref":"1051","categoria":"FERRETERIA"},{"producto_id":"er-airpods-pro-6-131","variante":"Unidad","producto":"Audífonos Inalámbricos Pro 6","tipo":"tecnologia","costo":19900,"precio":29900,"stock":2,"ref":"1053","categoria":"TECNOLOGIA"},{"producto_id":"er-kadio-calculadora-cientifica-1055","variante":"Unidad","producto":"Kadio Calculadora Cientifica","tipo":"variedades","costo":9000,"precio":13500,"stock":2,"ref":"1055","categoria":"PAPELERIA"},{"producto_id":"er-soporte-de-hombro-ortopedico-1060","variante":"Unidad","producto":"Soporte de Hombro Ortopedico","tipo":"variedades","costo":5000,"precio":7500,"stock":5,"ref":"CH-00004","categoria":"CACHARRERIA"},{"producto_id":"er-soporte-tv-fijo-universal-26-1062","variante":"Unidad","producto":"Soporte TV Fijo Universal 26","tipo":"variedades","costo":15000,"precio":22500,"stock":9,"ref":"1062","categoria":"FERRETERIA"},{"producto_id":"er-juego-acuatico-beisbol-bate-pelota-1064","variante":"Unidad","producto":"Juego Acuatico Beisbol Bate + Pelota","tipo":"variedades","costo":8372,"precio":12600,"stock":1,"ref":"1064","categoria":"DEPORTE"},{"producto_id":"er-pelota-rebote-extremo-1065","variante":"Unidad","producto":"Pelota Rebote Extremo","tipo":"variedades","costo":3400,"precio":5100,"stock":8,"ref":"1065","categoria":"CACHARRERIA"},{"producto_id":"er-navaja-automatica-militar-1067","variante":"Unidad","producto":"Navaja Automatica Militar","tipo":"variedades","costo":7943,"precio":12000,"stock":3,"ref":"CH-00001","categoria":"CACHARRERIA"},{"producto_id":"er-bolsa-termica-siliconada-1068","variante":"Unidad","producto":"Bolsa Termica Siliconada","tipo":"variedades","costo":8398,"precio":12600,"stock":1,"ref":"CH-00006","categoria":"CACHARRERIA"},{"producto_id":"er-metro-costurero-1069","variante":"Unidad","producto":"Metro Costurero","tipo":"variedades","costo":468,"precio":800,"stock":14,"ref":"278344","categoria":"CACHARRERIA"},{"producto_id":"er-cucharon-metalico-1070","variante":"Unidad","producto":"Cucharon Metalico","tipo":"variedades","costo":3993,"precio":6000,"stock":3,"ref":"1070","categoria":"CACHARRERIA"},{"producto_id":"er-parrila-en-aluminio-mango-madera-1072","variante":"Unidad","producto":"Parrila en Aluminio Mango Madera","tipo":"variedades","costo":18356,"precio":27600,"stock":1,"ref":"1072","categoria":"CACHARRERIA"},{"producto_id":"er-abre-latas-metalico-1074","variante":"Unidad","producto":"Abre Latas Metalico","tipo":"variedades","costo":10608,"precio":16000,"stock":1,"ref":"1074","categoria":"CACHARRERIA"},{"producto_id":"er-saca-corcho-1075","variante":"Unidad","producto":"Saca Corcho","tipo":"variedades","costo":9503,"precio":14300,"stock":6,"ref":"1075","categoria":"CACHARRERIA"},{"producto_id":"er-tabla-picar-economica-1076","variante":"Unidad","producto":"Tabla Picar Economica","tipo":"variedades","costo":4797,"precio":7200,"stock":45,"ref":"1076","categoria":"CACHARRERIA"},{"producto_id":"er-tijera-corta-verduras-1078","variante":"Unidad","producto":"Tijera Corta Verduras","tipo":"variedades","costo":10023,"precio":15100,"stock":1,"ref":"1078","categoria":"CACHARRERIA"},{"producto_id":"er-guante-siliconado-1079","variante":"Unidad","producto":"Guante Siliconado","tipo":"variedades","costo":2808,"precio":4300,"stock":8,"ref":"1079","categoria":"CACHARRERIA"},{"producto_id":"er-cepillo-dispensador-1081","variante":"Unidad","producto":"Cepillo Dispensador","tipo":"variedades","costo":8892,"precio":13400,"stock":1,"ref":"1081","categoria":"CACHARRERIA"},{"producto_id":"er-limpia-vidrios-1082","variante":"Unidad","producto":"Limpia Vidrios","tipo":"variedades","costo":2808,"precio":4300,"stock":7,"ref":"234553","categoria":"CACHARRERIA"},{"producto_id":"er-plancha-para-cabello-3d-1086","variante":"Unidad","producto":"Plancha para Cabello 3D","tipo":"variedades","costo":28500,"precio":42800,"stock":3,"ref":"17485","categoria":"HOGAR"},{"producto_id":"er-palo-de-selfie-132","variante":"Unidad","producto":"Palo de Selfie","tipo":"tecnologia","costo":9200,"precio":13800,"stock":6,"ref":"1089","categoria":"TECNOLOGIA"},{"producto_id":"er-soporte-giratorio-para-tablet-133","variante":"Unidad","producto":"Soporte Giratorio para Tablet","tipo":"tecnologia","costo":14900,"precio":22400,"stock":3,"ref":"258-1","categoria":"TECNOLOGIA"},{"producto_id":"er-original-smartwacht-wisme-airpods-7-correas-134","variante":"Unidad","producto":"Smartwacht Wisme + Audífonos Inalámbricos + 7 Correas","tipo":"tecnologia","costo":59900,"precio":89900,"stock":5,"ref":"TEC-00017","categoria":"TECNOLOGIA"},{"producto_id":"er-manilla-en-rodio-herradura-a1-1100","variante":"Unidad","producto":"Manilla en Rodio Herradura A1","tipo":"variedades","costo":7800,"precio":11700,"stock":21,"ref":"1100","categoria":"JOYERIA"},{"producto_id":"er-buff-corto-1102","variante":"Unidad","producto":"Buff Corto","tipo":"variedades","costo":8750,"precio":13200,"stock":9,"ref":"1102","categoria":"CACHARRERIA"},{"producto_id":"er-manga-economica-1104","variante":"Unidad","producto":"Manga Economica","tipo":"variedades","costo":5590,"precio":8400,"stock":16,"ref":"234442","categoria":"CACHARRERIA"},{"producto_id":"er-acetaminofen-500mg-x10-unidades-1105","variante":"Unidad","producto":"Acetaminofen 500MG X10 Unidades","tipo":"variedades","costo":1000,"precio":1500,"stock":39,"ref":"1105","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-aceite-semilla-de-cannabis-250-ml-grande-1109","variante":"Unidad","producto":"Aceite Semilla de Cannabis 250 Ml Grande","tipo":"variedades","costo":14280,"precio":21500,"stock":8,"ref":"1109","categoria":"BELLEZA"},{"producto_id":"er-aceite-con-oliva-30ml-1110","variante":"Unidad","producto":"Aceite con Oliva 30ML","tipo":"variedades","costo":3170,"precio":4800,"stock":36,"ref":"1110","categoria":"BELLEZA"},{"producto_id":"er-holder-388a-136","variante":"Unidad","producto":"Holder 388A","tipo":"tecnologia","costo":3900,"precio":5900,"stock":192,"ref":"5178","categoria":"TECNOLOGIA"},{"producto_id":"er-soporte-microfono-de-solapa-137","variante":"Unidad","producto":"Soporte Microfono de Solapa","tipo":"tecnologia","costo":19500,"precio":29300,"stock":1,"ref":"1112","categoria":"TECNOLOGIA"},{"producto_id":"er-microfono-de-solapa-entrada-aux-139","variante":"Unidad","producto":"Microfono de Solapa Entrada AUX","tipo":"tecnologia","costo":6500,"precio":9800,"stock":11,"ref":"1116","categoria":"TECNOLOGIA"},{"producto_id":"er-tripode-estabilizador-celular-ay49t-1118","variante":"Unidad","producto":"Tripode Estabilizador Celular AY49T","tipo":"tecnologia","costo":36500,"precio":54800,"stock":5,"ref":"1118","categoria":"TECNOLOGIA"},{"producto_id":"er-mini-tripode-tp-009-141","variante":"Unidad","producto":"Mini Tripode TP-009","tipo":"tecnologia","costo":6300,"precio":9500,"stock":5,"ref":"1119","categoria":"TECNOLOGIA"},{"producto_id":"er-soporte-astronauta-celular-142","variante":"Unidad","producto":"Soporte Astronauta Celular","tipo":"tecnologia","costo":11700,"precio":17600,"stock":10,"ref":"1120","categoria":"TECNOLOGIA"},{"producto_id":"er-airpods-originales-ep5-143","variante":"Unidad","producto":"Audífonos Inalámbricos EP5","tipo":"tecnologia","costo":45400,"precio":68100,"stock":1,"ref":"1121","categoria":"TECNOLOGIA"},{"producto_id":"er-holders-s059-144","variante":"Unidad","producto":"Holders S059","tipo":"tecnologia","costo":2080,"precio":3200,"stock":25,"ref":"51774","categoria":"TECNOLOGIA"},{"producto_id":"er-blafle-smart-speaker-app-145","variante":"Unidad","producto":"Blafle Smart Speaker App","tipo":"tecnologia","costo":35900,"precio":53900,"stock":2,"ref":"1123","categoria":"TECNOLOGIA"},{"producto_id":"er-auriculares-con-cable-md011-146","variante":"Unidad","producto":"Auriculares con Cable MD011","tipo":"tecnologia","costo":2700,"precio":4100,"stock":12,"ref":"2314","categoria":"TECNOLOGIA"},{"producto_id":"er-holders-hold-326-148","variante":"Unidad","producto":"Holders HOLD-326","tipo":"tecnologia","costo":2340,"precio":3600,"stock":30,"ref":"178741","categoria":"TECNOLOGIA"},{"producto_id":"er-soporte-go-pro-hy34-1131","variante":"Unidad","producto":"Soporte Go-pro HY34","tipo":"variedades","costo":19500,"precio":29300,"stock":3,"ref":"1131","categoria":"PROMOCIONES"},{"producto_id":"er-soporte-go-pro-hy-27-1132","variante":"Unidad","producto":"Soporte Go-pro HY-27","tipo":"variedades","costo":9100,"precio":13700,"stock":6,"ref":"1132","categoria":"PROMOCIONES"},{"producto_id":"er-pad-mause-carga-inalambrica-151","variante":"Unidad","producto":"Pad Mause Carga Inalambrica","tipo":"tecnologia","costo":38000,"precio":57000,"stock":1,"ref":"1133","categoria":"TECNOLOGIA"},{"producto_id":"er-airpods-pro-rs16-152","variante":"Unidad","producto":"Audífonos Inalámbricos Pro RS16","tipo":"tecnologia","costo":45000,"precio":67500,"stock":2,"ref":"1135","categoria":"TECNOLOGIA"},{"producto_id":"er-combo-airpods-tws-k30-153","variante":"Unidad","producto":"Combo Audífonos Inalámbricos TWS-K30","tipo":"tecnologia","costo":36400,"precio":54600,"stock":9,"ref":"1138","categoria":"TECNOLOGIA"},{"producto_id":"er-airpods-kt30-154","variante":"Unidad","producto":"Audífonos Inalámbricos KT30","tipo":"tecnologia","costo":28600,"precio":42900,"stock":2,"ref":"TEC-00004","categoria":"TECNOLOGIA"},{"producto_id":"er-lanza-confeti-av-3075-1147","variante":"Unidad","producto":"Lanza Confeti AV-3075","tipo":"variedades","costo":3500,"precio":5300,"stock":5,"ref":"1147","categoria":"CACHARRERIA"},{"producto_id":"er-set-jardineria-3pcs-1148","variante":"Unidad","producto":"Set Jardineria 3PCS","tipo":"variedades","costo":7500,"precio":11300,"stock":13,"ref":"AV-10246","categoria":"FERRETERIA"},{"producto_id":"er-tobillera-faja-8358-1149","variante":"Unidad","producto":"Tobillera Faja 8358","tipo":"variedades","costo":2730,"precio":4100,"stock":40,"ref":"CH-00009","categoria":"CACHARRERIA"},{"producto_id":"er-cepillos-lavar-x-3-pnos-av-2224-1150","variante":"Unidad","producto":"Cepillos Lavar x 3 Pños AV-2224","tipo":"variedades","costo":2400,"precio":3600,"stock":8,"ref":"1150","categoria":"CACHARRERIA"},{"producto_id":"er-dispensador-de-bebidas-av-9511-1151","variante":"Unidad","producto":"Dispensador de Bebidas AV-9511","tipo":"variedades","costo":17187,"precio":25800,"stock":5,"ref":"CH-00013","categoria":"CACHARRERIA"},{"producto_id":"er-hielera-cilindrica-av-7310-1152","variante":"Unidad","producto":"Hielera Cilindrica AV-7310","tipo":"variedades","costo":8625,"precio":13000,"stock":6,"ref":"1152","categoria":"CACHARRERIA"},{"producto_id":"er-jabonera-de-pared-x-2-av-9915-1153","variante":"Unidad","producto":"Jabonera de Pared x 2 AV-9915","tipo":"variedades","costo":6600,"precio":9900,"stock":6,"ref":"892434","categoria":"CACHARRERIA"},{"producto_id":"er-pulsera-neon-paquete-x-50-szw5200-1154","variante":"Unidad","producto":"Pulsera Neon (paquete x 50) SZW5200","tipo":"variedades","costo":9620,"precio":14500,"stock":6,"ref":"1154","categoria":"CACHARRERIA"},{"producto_id":"er-faja-para-muneca-elastica-1157","variante":"Unidad","producto":"Faja para Muñeca Elastica","tipo":"variedades","costo":1800,"precio":2700,"stock":44,"ref":"CH-00012","categoria":"CACHARRERIA"},{"producto_id":"er-martillo-18-en-1-1160","variante":"Unidad","producto":"Martillo 18 en 1","tipo":"variedades","costo":26000,"precio":39000,"stock":2,"ref":"BOG-1","categoria":"FERRETERIA"},{"producto_id":"er-smart-watch-fit-economico-fd68-157","variante":"Unidad","producto":"Smart Watch Fit Economico FD68","tipo":"tecnologia","costo":13520,"precio":20300,"stock":15,"ref":"TEC-00020","categoria":"TECNOLOGIA"},{"producto_id":"er-microfono-condensador-sf-666-158","variante":"Unidad","producto":"Microfono Condensador SF-666","tipo":"tecnologia","costo":19500,"precio":29300,"stock":4,"ref":"TEC-00026","categoria":"TECNOLOGIA"},{"producto_id":"er-pelicula-antiempanante-para-carro-o-moto-1163","variante":"Unidad","producto":"Pelicula Antiempañante para Carro o Moto","tipo":"variedades","costo":5000,"precio":7500,"stock":7,"ref":"BOG-1","categoria":"PROMOCIONES"},{"producto_id":"er-gorro-migrana-1164","variante":"Unidad","producto":"Gorro Migraña","tipo":"variedades","costo":9900,"precio":14900,"stock":15,"ref":"BOG-1","categoria":"HOGAR"},{"producto_id":"er-masajeador-anti-arrugas-electrico-1167","variante":"Unidad","producto":"Masajeador Anti Arrugas Electrico","tipo":"variedades","costo":16000,"precio":24000,"stock":4,"ref":"BOG-1","categoria":"BELLEZA"},{"producto_id":"er-rayador-de-verduras-vegetales-1170","variante":"Unidad","producto":"Rayador de Verduras Vegetales","tipo":"variedades","costo":24700,"precio":37100,"stock":5,"ref":"HG-00001","categoria":"HOGAR"},{"producto_id":"er-molde-de-empanadas-sencilla-1171","variante":"Unidad","producto":"Molde de Empanadas Sencilla","tipo":"variedades","costo":7800,"precio":11700,"stock":10,"ref":"BOG-1","categoria":"HOGAR"},{"producto_id":"er-molde-hamburguesas-1172","variante":"Unidad","producto":"Molde Hamburguesas","tipo":"variedades","costo":9500,"precio":14300,"stock":1,"ref":"BOG-1","categoria":"HOGAR"},{"producto_id":"er-secador-de-ropa-portatil-1173","variante":"Unidad","producto":"Secador de Ropa Portatil","tipo":"variedades","costo":35000,"precio":52500,"stock":2,"ref":"54187851","categoria":"HOGAR"},{"producto_id":"er-cepillo-secador-bt028-1174","variante":"Unidad","producto":"Cepillo Secador BT028","tipo":"variedades","costo":6,"precio":100,"stock":6,"ref":"33342355","categoria":"BELLEZA"},{"producto_id":"er-plancha-viajera-mini-1175","variante":"Unidad","producto":"Plancha Viajera Mini","tipo":"variedades","costo":7150,"precio":10800,"stock":5,"ref":"HG-00020","categoria":"PROMOCIONES"},{"producto_id":"er-masajeador-facial-frio-roller-1177","variante":"Unidad","producto":"Masajeador Facial Frio Roller","tipo":"variedades","costo":8000,"precio":12000,"stock":12,"ref":"1177","categoria":"BELLEZA"},{"producto_id":"er-almohada-masajeadora-1178","variante":"Unidad","producto":"Almohada Masajeadora","tipo":"variedades","costo":38800,"precio":58200,"stock":2,"ref":"HG-00016","categoria":"HOGAR"},{"producto_id":"er-portabebes-portatil-1180","variante":"Unidad","producto":"Portabebes Portatil","tipo":"variedades","costo":15600,"precio":23400,"stock":4,"ref":"HG-00017","categoria":"HOGAR"},{"producto_id":"er-combo-x8-smart-wacht-162","variante":"Unidad","producto":"Combo X8 Smart Wacht","tipo":"tecnologia","costo":34000,"precio":51000,"stock":3,"ref":"VARA","categoria":"TECNOLOGIA"},{"producto_id":"er-termometro-digital-1187","variante":"Unidad","producto":"Termometro Digital","tipo":"variedades","costo":3380,"precio":5100,"stock":25,"ref":"345345","categoria":"CACHARRERIA"},{"producto_id":"er-humificador-qh106-1188","variante":"Unidad","producto":"Humificador QH106","tipo":"variedades","costo":16800,"precio":25200,"stock":7,"ref":"234455","categoria":"HOGAR"},{"producto_id":"er-maquina-coser-manual-portatil-1190","variante":"Unidad","producto":"Maquina Coser Manual Portatil","tipo":"variedades","costo":15900,"precio":23900,"stock":1,"ref":"6511448","categoria":"HOGAR"},{"producto_id":"er-juego-de-cocina-x3pcs-1191","variante":"Unidad","producto":"Juego de Cocina X3PCS","tipo":"variedades","costo":8370,"precio":12600,"stock":23,"ref":"HG-00004","categoria":"HOGAR"},{"producto_id":"er-gorro-de-natacion-1192","variante":"Unidad","producto":"Gorro de Natacion","tipo":"variedades","costo":3800,"precio":5700,"stock":1,"ref":"1192","categoria":"DEPORTE"},{"producto_id":"er-metro-3mt-1195","variante":"Unidad","producto":"Metro 3MT","tipo":"variedades","costo":3600,"precio":5400,"stock":11,"ref":"1195","categoria":"FERRETERIA"},{"producto_id":"er-plancha-para-cabello-waiikl-wl-878-1197","variante":"Unidad","producto":"Plancha para Cabello Waiikl WL-878","tipo":"variedades","costo":23750,"precio":35700,"stock":2,"ref":"BE-00001","categoria":"BELLEZA"},{"producto_id":"er-batidora-electrica-original-1200","variante":"Unidad","producto":"Batidora Electrica Original","tipo":"variedades","costo":24900,"precio":37400,"stock":2,"ref":"88976","categoria":"HOGAR"},{"producto_id":"er-audifonos-con-cable-tipo-c-tm-a-165","variante":"Unidad","producto":"Audifonos con Cable Tipo C Tm-a","tipo":"tecnologia","costo":5500,"precio":8300,"stock":9,"ref":"1203","categoria":"TECNOLOGIA"},{"producto_id":"er-smart-watch-gamebox-correa-pro-hot-5-167","variante":"Unidad","producto":"Smart Watch + Gamebox + Correa Pro HOT-5","tipo":"tecnologia","costo":64000,"precio":96000,"stock":1,"ref":"54521","categoria":"TECNOLOGIA"},{"producto_id":"er-lapiz-tactil-hx-22-169","variante":"Unidad","producto":"Lapiz Tactil HX-22","tipo":"tecnologia","costo":2500,"precio":3800,"stock":8,"ref":"114E5","categoria":"TECNOLOGIA"},{"producto_id":"er-lapiz-tactil-hx-02-1217","variante":"Unidad","producto":"Lapiz Tactil HX-02","tipo":"variedades","costo":2100,"precio":3200,"stock":47,"ref":"22555","categoria":"PAPELERIA"},{"producto_id":"er-estuches-brazaletes-deportivos-celular-1220","variante":"Unidad","producto":"Estuches Brazaletes Deportivos Celular","tipo":"variedades","costo":2500,"precio":3800,"stock":18,"ref":"651444","categoria":"DEPORTE"},{"producto_id":"er-pulsera-corazon-de-jesus-tejido-en-rodio-150-1221","variante":"Unidad","producto":"Pulsera Corazon de Jesus Tejido en Rodio 150","tipo":"variedades","costo":12500,"precio":18800,"stock":1,"ref":"1221","categoria":"JOYERIA"},{"producto_id":"er-duo-rodio-dama-37-1222","variante":"Unidad","producto":"Duo Rodio Dama 37","tipo":"variedades","costo":11000,"precio":16500,"stock":3,"ref":"1222","categoria":"JOYERIA"},{"producto_id":"er-duo-cristo-4d-1226","variante":"Unidad","producto":"Duo Cristo 4D","tipo":"variedades","costo":7500,"precio":11300,"stock":1,"ref":"1226","categoria":"JOYERIA"},{"producto_id":"er-lentes-vision-nocturna-1232","variante":"Unidad","producto":"Lentes Vision Nocturna","tipo":"variedades","costo":11000,"precio":16500,"stock":3,"ref":"51884","categoria":"DEPORTE"},{"producto_id":"er-calentador-de-agua-portatil-1235","variante":"Unidad","producto":"Calentador de Agua Portatil","tipo":"variedades","costo":6500,"precio":9800,"stock":7,"ref":"518721","categoria":"PROMOCIONES"},{"producto_id":"er-mascara-silicona-aprendizaje-1236","variante":"Unidad","producto":"Mascara Silicona Aprendizaje","tipo":"variedades","costo":22000,"precio":33000,"stock":6,"ref":"2268947","categoria":"PROMOCIONES"},{"producto_id":"er-kit-cepillos-x4-1237","variante":"Unidad","producto":"Kit Cepillos X4","tipo":"variedades","costo":9900,"precio":14900,"stock":12,"ref":"1145778","categoria":"CACHARRERIA"},{"producto_id":"er-masajeadora-electrica-largo-4-cabezales-recargable-1238","variante":"Unidad","producto":"Masajeadora Eléctrica Largo 4 Cabezales Recargable","tipo":"variedades","costo":30000,"precio":45000,"stock":1,"ref":"345594","categoria":"DEPORTE"},{"producto_id":"er-kit-labubu-177","variante":"Unidad","producto":"Kit Labubu","tipo":"tecnologia","costo":30000,"precio":45000,"stock":3,"ref":"8497573","categoria":"TECNOLOGIA"},{"producto_id":"er-pulsera-pueblo-colombiano-en-rodio-1248","variante":"Unidad","producto":"Pulsera Pueblo Colombiano en Rodio","tipo":"variedades","costo":9800,"precio":14700,"stock":20,"ref":"5415","categoria":"JOYERIA"},{"producto_id":"er-pulsera-tejida-virgen-ah154-dama-1249","variante":"Unidad","producto":"Pulsera Tejida Virgen AH154 Dama","tipo":"variedades","costo":11800,"precio":17700,"stock":4,"ref":"15455","categoria":"JOYERIA"},{"producto_id":"er-unisex-bharara-viking-dubai-1258","variante":"Unidad","producto":"Unisex Bharara Viking Dubai","tipo":"variedades","costo":89900,"precio":134900,"stock":5,"ref":"LC-00007","categoria":"PERFUMERIA"},{"producto_id":"er-intercomunicador-y10-1262","variante":"Unidad","producto":"Intercomunicador Y10","tipo":"variedades","costo":35000,"precio":52500,"stock":6,"ref":"561885","categoria":"CONTENEDOR CHINA"},{"producto_id":"er-kairos-original-hombre-dm1851-rojo-1266","variante":"Unidad","producto":"Kairos Original Hombre DM1851 Rojo","tipo":"variedades","costo":24500,"precio":36800,"stock":1,"ref":"DM1851","categoria":"RELOJERIA ORIGINAL"},{"producto_id":"er-holder-celular-en-espejo-carro-retrovisor-hold-171-1268","variante":"Unidad","producto":"Holder Celular en Espejo Carro Retrovisor Hold 171","tipo":"variedades","costo":15500,"precio":23300,"stock":2,"ref":"6515415","categoria":"PROMOCIONES"},{"producto_id":"er-original-airpods-es53-181","variante":"Unidad","producto":"Audífonos Inalámbricos ES53","tipo":"tecnologia","costo":33500,"precio":50300,"stock":1,"ref":"YOKI-ES33","categoria":"TECNOLOGIA"},{"producto_id":"er-roceador-de-aceite-profesional-1274","variante":"Unidad","producto":"Roceador de Aceite Profesional","tipo":"variedades","costo":8900,"precio":13400,"stock":9,"ref":"651458","categoria":"PROMOCIONES"},{"producto_id":"er-audifono-para-sordera-1275","variante":"Unidad","producto":"Audifono para Sordera","tipo":"variedades","costo":10880,"precio":16400,"stock":11,"ref":"45485","categoria":"CACHARRERIA"},{"producto_id":"er-multipuerto-x4-usb-184","variante":"Unidad","producto":"Multipuerto X4 USB","tipo":"tecnologia","costo":3990,"precio":6000,"stock":7,"ref":"6541878","categoria":"TECNOLOGIA"},{"producto_id":"er-airpods-abiertos-pro-v12-original-185","variante":"Unidad","producto":"Audífonos Inalámbricos Abiertos Pro V12","tipo":"tecnologia","costo":69900,"precio":104900,"stock":10,"ref":"V12","categoria":"TECNOLOGIA"},{"producto_id":"er-buscador-inteligente-original-186","variante":"Unidad","producto":"Buscador Inteligente Original","tipo":"tecnologia","costo":29900,"precio":44900,"stock":1,"ref":"TEC-00008","categoria":"TECNOLOGIA"},{"producto_id":"er-acqua-di-go-profondo-giorgio-armani-1285","variante":"Unidad","producto":"Acqua Di Go Profondo Giorgio Armani","tipo":"variedades","costo":40000,"precio":60000,"stock":4,"ref":"LC-00003","categoria":"PERFUMERIA"},{"producto_id":"er-maquina-de-embutidos-salchicha-1289","variante":"Unidad","producto":"Maquina de Embutidos Salchicha","tipo":"variedades","costo":18800,"precio":28200,"stock":2,"ref":"65494878","categoria":"HOGAR"},{"producto_id":"er-combo-plancha-nano-rosado-1290","variante":"Unidad","producto":"Combo Plancha Nano Rosado","tipo":"variedades","costo":39900,"precio":59900,"stock":3,"ref":"6459887","categoria":"BELLEZA"},{"producto_id":"er-ventilador-mini-recargable-usb-1291","variante":"Unidad","producto":"Ventilador Mini Recargable USB","tipo":"variedades","costo":10800,"precio":16200,"stock":2,"ref":"+51651","categoria":"HOGAR"},{"producto_id":"er-soporte-para-tablet-y-celular-hold-356-187","variante":"Unidad","producto":"Soporte para Tablet y Celular HOLD-356","tipo":"tecnologia","costo":24500,"precio":36800,"stock":4,"ref":"TEC-00003","categoria":"TECNOLOGIA"},{"producto_id":"er-base-para-portatil-y-tablet-holdpc-102-188","variante":"Unidad","producto":"Base para Portatil y Tablet HOLDPC-102","tipo":"tecnologia","costo":19900,"precio":29900,"stock":5,"ref":"TEC-00007","categoria":"TECNOLOGIA"},{"producto_id":"er-ym-300-rgb-led-ring-fill-light-189","variante":"Unidad","producto":"YM-300 RGB LED Ring Fill Light","tipo":"tecnologia","costo":44900,"precio":67400,"stock":9,"ref":"6516554","categoria":"TECNOLOGIA"},{"producto_id":"er-mascara-tactica-con-gafas-protectoras-1295","variante":"Unidad","producto":"Mascara Tactica con Gafas Protectoras","tipo":"variedades","costo":15600,"precio":23400,"stock":2,"ref":"CH-00003","categoria":"CACHARRERIA"},{"producto_id":"er-base-para-portatil-en-aluminio-hold-406-192","variante":"Unidad","producto":"Base para Portatil en Aluminio HOLD-406","tipo":"tecnologia","costo":14900,"precio":22400,"stock":4,"ref":"61877","categoria":"TECNOLOGIA"},{"producto_id":"er-cristo-luz-dorado-y-plateado-1310","variante":"Unidad","producto":"Cristo Luz Dorado y Plateado","tipo":"variedades","costo":9900,"precio":14900,"stock":5,"ref":"9456444","categoria":"CACHARRERIA"},{"producto_id":"er-funda-para-portatil-na-bag-105-193","variante":"Unidad","producto":"Funda para Portatil Na-bag 105","tipo":"tecnologia","costo":24900,"precio":37400,"stock":16,"ref":"6516514","categoria":"TECNOLOGIA"},{"producto_id":"er-vaselina-30gr-1315","variante":"Unidad","producto":"Vaselina 30GR","tipo":"variedades","costo":1560,"precio":2400,"stock":8,"ref":"654154","categoria":"CACHARRERIA"},{"producto_id":"er-jabon-antioxidante-pieles-maduras-arand-1331","variante":"Unidad","producto":"Jabon Antioxidante Pieles Maduras Arand","tipo":"variedades","costo":6800,"precio":10200,"stock":3,"ref":"1331","categoria":"BELLEZA"},{"producto_id":"er-contorno-antioxidante-pieles-maduras-arand-1332","variante":"Unidad","producto":"Contorno Antioxidante Pieles Maduras Arand","tipo":"variedades","costo":4500,"precio":6800,"stock":2,"ref":"1332","categoria":"BELLEZA"},{"producto_id":"er-repetidor-de-wifi-wr03t-199","variante":"Unidad","producto":"Repetidor de Wifi WR03T","tipo":"tecnologia","costo":23400,"precio":35100,"stock":4,"ref":"1341","categoria":"TECNOLOGIA"},{"producto_id":"er-maquina-depiladora-femenina-jx188-1344","variante":"Unidad","producto":"Maquina Depiladora Femenina JX188","tipo":"variedades","costo":13500,"precio":20300,"stock":3,"ref":"CH-00010","categoria":"CACHARRERIA"},{"producto_id":"er-humificador-gl600-1345","variante":"Unidad","producto":"Humificador GL600","tipo":"variedades","costo":19500,"precio":29300,"stock":1,"ref":"CH-00017","categoria":"CACHARRERIA"},{"producto_id":"er-maquina-de-verificacion-de-billetes-201","variante":"Unidad","producto":"Maquina de Verificacion de Billetes","tipo":"tecnologia","costo":19900,"precio":29900,"stock":1,"ref":"TEC-00029","categoria":"TECNOLOGIA"},{"producto_id":"er-audifonos-m10-202","variante":"Unidad","producto":"Audifonos M10","tipo":"tecnologia","costo":12500,"precio":18800,"stock":4,"ref":"TEC-00021","categoria":"TECNOLOGIA"},{"producto_id":"er-maleta-de-mascotass-1348","variante":"Unidad","producto":"Maleta de Mascotass","tipo":"variedades","costo":44900,"precio":67400,"stock":3,"ref":"MC-00001","categoria":"MASCOTAS"},{"producto_id":"er-irrigador-dental-1351","variante":"Unidad","producto":"Irrigador Dental","tipo":"variedades","costo":22000,"precio":33000,"stock":10,"ref":"HG-00014","categoria":"HOGAR"},{"producto_id":"er-set-de-llaves-inglesas-1353","variante":"Unidad","producto":"Set de Llaves Inglesas","tipo":"variedades","costo":15500,"precio":23300,"stock":1,"ref":"FR-00005","categoria":"FERRETERIA"},{"producto_id":"er-anti-ronquidos-1355","variante":"Unidad","producto":"Anti Ronquidos","tipo":"variedades","costo":5900,"precio":8900,"stock":2,"ref":"CH-00016","categoria":"CACHARRERIA"},{"producto_id":"er-set-de-cocina-x4-1360","variante":"Unidad","producto":"Set de Cocina X4","tipo":"variedades","costo":19900,"precio":29900,"stock":4,"ref":"1360","categoria":"HOGAR"},{"producto_id":"er-batidor-manual-portatil-1362","variante":"Unidad","producto":"Batidor Manual Portatil","tipo":"variedades","costo":5850,"precio":8800,"stock":8,"ref":"1362","categoria":"HOGAR"},{"producto_id":"er-serum-hidratante-aloe-rosado-sd87362-1373","variante":"Unidad","producto":"Serum Hidratante Aloe Rosado SD87362","tipo":"variedades","costo":6500,"precio":9800,"stock":9,"ref":"1373","categoria":"BELLEZA"},{"producto_id":"er-parlante-portatil-mg2-203","variante":"Unidad","producto":"Parlante Portatil MG2","tipo":"tecnologia","costo":9000,"precio":13500,"stock":15,"ref":"1376","categoria":"TECNOLOGIA"},{"producto_id":"er-impermeable-maleta-1380","variante":"Unidad","producto":"Impermeable Maleta","tipo":"variedades","costo":11570,"precio":17400,"stock":13,"ref":"CH-00011","categoria":"CACHARRERIA"},{"producto_id":"er-dispensador-crema-dental-soporte-esterilizador-de-cepillos-1385","variante":"Unidad","producto":"Dispensador Crema Dental + Soporte Esterilizador de Cepillos","tipo":"variedades","costo":12500,"precio":18800,"stock":1,"ref":"HG-00018","categoria":"HOGAR"},{"producto_id":"er-llaveros-futbol-x12-unidades-calidad-1386","variante":"Unidad","producto":"Llaveros Futbol X12 Unidades Calidad","tipo":"variedades","costo":46000,"precio":69000,"stock":5,"ref":"1386","categoria":"CACHARRERIA"},{"producto_id":"er-secador-zapatos-economico-1388","variante":"Unidad","producto":"Secador Zapatos Economico","tipo":"variedades","costo":14300,"precio":21500,"stock":7,"ref":"HG-00013","categoria":"HOGAR"},{"producto_id":"er-secador-de-zapatos-r8-1390","variante":"Unidad","producto":"Secador de Zapatos R8","tipo":"variedades","costo":18200,"precio":27300,"stock":5,"ref":"1390","categoria":"HOGAR"},{"producto_id":"er-inflador-de-pie-con-medidor-1391","variante":"Unidad","producto":"Inflador de Pie con Medidor","tipo":"variedades","costo":14040,"precio":21100,"stock":1,"ref":"1391","categoria":"FERRETERIA"},{"producto_id":"er-serum-hidratante-ac-hialur-30ml-bioaq-bqy00552-1397","variante":"Unidad","producto":"Serum Hidratante AC Hialur 30ML Bioaq BQY00552","tipo":"variedades","costo":2520,"precio":3800,"stock":10,"ref":"1397","categoria":"BELLEZA"},{"producto_id":"er-jabon-facial-hidratante-en-gel-a-hialuronico-bqy58796-1399","variante":"Unidad","producto":"Jabon Facial Hidratante en Gel A. Hialuronico BQY58796","tipo":"variedades","costo":5760,"precio":8700,"stock":4,"ref":"1399","categoria":"BELLEZA"},{"producto_id":"er-balsamo-hidratante-de-labios-cherry-bqy05312-1403","variante":"Unidad","producto":"Balsamo Hidratante de Labios Cherry BQY05312","tipo":"variedades","costo":1900,"precio":2900,"stock":64,"ref":"1403","categoria":"BELLEZA"},{"producto_id":"er-72-parches-elefant-para-acne-figuras-sd79787-1405","variante":"Unidad","producto":"72 Parches Elefant para Acne Figuras SD79787","tipo":"variedades","costo":3600,"precio":5400,"stock":14,"ref":"1405","categoria":"BELLEZA"},{"producto_id":"er-anti-acne-luz-azul-1407","variante":"Unidad","producto":"Anti Acne Luz Azul","tipo":"variedades","costo":10800,"precio":16200,"stock":5,"ref":"BE-00008","categoria":"BELLEZA"},{"producto_id":"er-airpods-anc-jm19-traductores-208","variante":"Unidad","producto":"Audífonos Inalámbricos ANC-JM19 Traductores","tipo":"tecnologia","costo":55000,"precio":82500,"stock":2,"ref":"TEC-00028","categoria":"TECNOLOGIA"},{"producto_id":"er-pulpo-malla-elastica-2626cm-1500","variante":"Unidad","producto":"Pulpo Malla Elastica - 26*26CM","tipo":"variedades","costo":12,"precio":100,"stock":5,"ref":"1500","categoria":"FERRETERIA"},{"producto_id":"er-lava-brochas-maquillaje-1507","variante":"Unidad","producto":"Lava Brochas Maquillaje","tipo":"variedades","costo":12500,"precio":18800,"stock":9,"ref":"1507","categoria":"BELLEZA"},{"producto_id":"er-microfono-condensador-a1-1510","variante":"Unidad","producto":"Microfono Condensador A1","tipo":"variedades","costo":19900,"precio":29900,"stock":6,"ref":"1510","categoria":"PROMOCIONES"},{"producto_id":"er-smartwacht-serie-11-mini-213","variante":"Unidad","producto":"Smartwacht Serie 11 Mini","tipo":"tecnologia","costo":34900,"precio":52400,"stock":1,"ref":"1511","categoria":"TECNOLOGIA"},{"producto_id":"er-cinta-levanta-busto-adhesiva-invisible-1530","variante":"Unidad","producto":"Cinta Levanta Busto Adhesiva Invisible","tipo":"variedades","costo":6000,"precio":9000,"stock":17,"ref":"1530","categoria":"BELLEZA"},{"producto_id":"er-aceite-capilar-aguacate-con-vitamina-e-1531","variante":"Unidad","producto":"Aceite Capilar Aguacate con Vitamina E","tipo":"variedades","costo":1410,"precio":2200,"stock":14,"ref":"1531","categoria":"BELLEZA"},{"producto_id":"er-cepillo-electrico-irrigador-dental-1537","variante":"Unidad","producto":"Cepillo Electrico + Irrigador Dental","tipo":"variedades","costo":29900,"precio":44900,"stock":2,"ref":"1537","categoria":"HOGAR"},{"producto_id":"er-aceite-corporal-coco-120-ml-1551","variante":"Unidad","producto":"Aceite Corporal Coco 120 Ml","tipo":"variedades","costo":8600,"precio":12900,"stock":5,"ref":"1551","categoria":"BELLEZA"},{"producto_id":"er-original-cargador-usb-a-tipo-c-yookie-ei32-217","variante":"Unidad","producto":"Original Cargador USB a Tipo C Yookie EI32","tipo":"tecnologia","costo":14300,"precio":21500,"stock":5,"ref":"1559","categoria":"TECNOLOGIA"},{"producto_id":"er-smart-watch-zt-36s-plus-219","variante":"Unidad","producto":"Smart Watch ZT-36S Plus","tipo":"tecnologia","costo":59900,"precio":89900,"stock":3,"ref":"1561","categoria":"TECNOLOGIA"},{"producto_id":"er-kit-facial-hidratante-anti-oxidante-vitamina-c-6-1570","variante":"Unidad","producto":"Kit Facial Hidratante Anti Oxidante Vitamina C 6","tipo":"variedades","costo":34000,"precio":51000,"stock":16,"ref":"1570","categoria":"BELLEZA"},{"producto_id":"er-tonico-facial-tono-uniforme-e-hidratacion-flor-de-cerezo-bqy77080-1580","variante":"Unidad","producto":"Tonico Facial Tono Uniforme E Hidratación Flor de Cerezo BQY77080","tipo":"variedades","costo":7300,"precio":11000,"stock":12,"ref":"1580","categoria":"BELLEZA"},{"producto_id":"er-jabon-facial-tono-uniforme-e-hidratacion-flor-de-cerezo-1582","variante":"Unidad","producto":"Jabon Facial Tono Uniforme E Hidratación Flor de Cerezo","tipo":"variedades","costo":5400,"precio":8100,"stock":2,"ref":"1582","categoria":"BELLEZA"},{"producto_id":"er-reloj-parlante-rgb-1587","variante":"Unidad","producto":"Reloj Parlante RGB","tipo":"variedades","costo":14900,"precio":22400,"stock":7,"ref":"1587","categoria":"CONTENEDOR CHINA"},{"producto_id":"er-cinturon-de-masaje-adelgazante-1593","variante":"Unidad","producto":"Cinturon de Masaje Adelgazante","tipo":"variedades","costo":19900,"precio":29900,"stock":3,"ref":"1593","categoria":"DEPORTE"},{"producto_id":"er-camara-go-pro-hd-1080-sports-1602","variante":"Unidad","producto":"Camara Go Pro HD 1080 Sports","tipo":"variedades","costo":34900,"precio":52400,"stock":5,"ref":"1602","categoria":"PROMOCIONES"},{"producto_id":"er-smart-watch-audifonos-d200-ultra-229","variante":"Unidad","producto":"Smart Watch + Audifonos D200 Ultra","tipo":"tecnologia","costo":39900,"precio":59900,"stock":9,"ref":"1606","categoria":"TECNOLOGIA"},{"producto_id":"er-smart-watch-audifonos-i20-230","variante":"Unidad","producto":"Smart Watch + Audifonos I20","tipo":"tecnologia","costo":35000,"precio":52500,"stock":3,"ref":"1607","categoria":"TECNOLOGIA"},{"producto_id":"er-proyector-hy300-1616","variante":"Unidad","producto":"Proyector HY300","tipo":"variedades","costo":124500,"precio":186800,"stock":4,"ref":"1616","categoria":"HOGAR"},{"producto_id":"er-baston-plegable-fino-1617","variante":"Unidad","producto":"Baston Plegable Fino","tipo":"variedades","costo":13000,"precio":19500,"stock":2,"ref":"1617","categoria":"PROMOCIONES"},{"producto_id":"er-boquitoqui-x2-con-audifonos-1618","variante":"Unidad","producto":"Boquitoqui X2 con Audifonos","tipo":"variedades","costo":59900,"precio":89900,"stock":2,"ref":"1618","categoria":"FERRETERIA"},{"producto_id":"er-martillo-americano-1619","variante":"Unidad","producto":"Martillo Americano","tipo":"variedades","costo":9500,"precio":14300,"stock":6,"ref":"1619","categoria":"FERRETERIA"},{"producto_id":"er-spray-marihuana-1626","variante":"Unidad","producto":"Spray Marihuana","tipo":"variedades","costo":4550,"precio":6900,"stock":14,"ref":"1626","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-silicona-capilar-10ml-1627","variante":"Unidad","producto":"Silicona Capilar 10ML","tipo":"variedades","costo":1360,"precio":2100,"stock":185,"ref":"1627","categoria":"BELLEZA"},{"producto_id":"er-gel-relajante-muscular-de-eucalipto-de-120-gr-1628","variante":"Unidad","producto":"Gel Relajante Muscular de Eucalipto de 120 Gr","tipo":"variedades","costo":3200,"precio":4800,"stock":20,"ref":"1628","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-gel-refrescante-de-calendula-120-gr-1629","variante":"Unidad","producto":"Gel Refrescante de Calendula 120 Gr","tipo":"variedades","costo":3200,"precio":4800,"stock":49,"ref":"1629","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-set-lacoste-x3-1640","variante":"Unidad","producto":"Set Lacoste X3","tipo":"variedades","costo":74900,"precio":112400,"stock":2,"ref":"1640","categoria":"PERFUMERIA"},{"producto_id":"er-cuello-de-refrigeracion-1644","variante":"Unidad","producto":"Cuello de Refrigeracion","tipo":"variedades","costo":6000,"precio":9000,"stock":6,"ref":"1644","categoria":"DEPORTE"},{"producto_id":"er-chapstick-1648","variante":"Unidad","producto":"Chapstick","tipo":"variedades","costo":10200,"precio":15300,"stock":2,"ref":"1648","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-kit-viajero-anti-acne-pure-skin-1651","variante":"Unidad","producto":"Kit Viajero Anti Acne Pure Skin","tipo":"variedades","costo":14900,"precio":22400,"stock":5,"ref":"1651","categoria":"BELLEZA"},{"producto_id":"er-mouse-ergonomico-alambrico-239","variante":"Unidad","producto":"Mouse Ergonomico Alambrico","tipo":"tecnologia","costo":19000,"precio":28500,"stock":4,"ref":"1667","categoria":"TECNOLOGIA"},{"producto_id":"er-audifonos-bluetooth-yx29-con-pantalla-tactil-244","variante":"Unidad","producto":"Audifonos Bluetooth YX29 con Pantalla Tactil","tipo":"tecnologia","costo":33000,"precio":49500,"stock":5,"ref":"1691","categoria":"TECNOLOGIA"},{"producto_id":"er-ceragel-moleadora-original-1698","variante":"Unidad","producto":"Ceragel Moleadora Original","tipo":"variedades","costo":9900,"precio":14900,"stock":3,"ref":"1698","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-shampoo-max-tratamiento-capilar-150ml-1699","variante":"Unidad","producto":"Shampoo Max Tratamiento Capilar 150ML","tipo":"variedades","costo":11200,"precio":16800,"stock":3,"ref":"1699","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-aceite-bronceador-110ml-1709","variante":"Unidad","producto":"Aceite Bronceador 110ML","tipo":"variedades","costo":12900,"precio":19400,"stock":7,"ref":"1709","categoria":"BELLEZA"},{"producto_id":"er-manteca-de-cacao-labial-coco-1710","variante":"Unidad","producto":"Manteca de Cacao Labial Coco","tipo":"variedades","costo":3800,"precio":5700,"stock":5,"ref":"1710","categoria":"BELLEZA"},{"producto_id":"er-aceite-corporal-chocolate-120ml-1711","variante":"Unidad","producto":"Aceite Corporal Chocolate 120ML","tipo":"variedades","costo":8600,"precio":12900,"stock":4,"ref":"1711","categoria":"BELLEZA"},{"producto_id":"er-cubeta-de-hielo-gde-1712","variante":"Unidad","producto":"Cubeta de Hielo Gde","tipo":"variedades","costo":2100,"precio":3200,"stock":31,"ref":"1712","categoria":"HOGAR"},{"producto_id":"er-velas-x10-unidades-1713","variante":"Unidad","producto":"Velas X10 Unidades","tipo":"variedades","costo":3300,"precio":5000,"stock":6,"ref":"1713","categoria":"CACHARRERIA"},{"producto_id":"er-kit-gamer-x4-articulos-245","variante":"Unidad","producto":"Kit Gamer X4 Articulos","tipo":"tecnologia","costo":69900,"precio":104900,"stock":2,"ref":"viral","categoria":"TECNOLOGIA"},{"producto_id":"er-set-destornilladores-6-piezas-1719","variante":"Unidad","producto":"Set Destornilladores 6 Piezas","tipo":"variedades","costo":6000,"precio":9000,"stock":3,"ref":"1719","categoria":"FERRETERIA"},{"producto_id":"er-drone-e99-pro-con-camara-full-hd-1724","variante":"Unidad","producto":"Drone E99 Pro con Camara Full HD","tipo":"variedades","costo":55000,"precio":82500,"stock":2,"ref":"1724","categoria":"PROMOCIONES"},{"producto_id":"er-ibuflash-migrana-x1-unidad-1725","variante":"Unidad","producto":"Ibuflash Migraña X1 Unidad","tipo":"variedades","costo":1950,"precio":3000,"stock":24,"ref":"1725","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-soporte-decodificador-tv-1726","variante":"Unidad","producto":"Soporte Decodificador TV","tipo":"variedades","costo":11250,"precio":16900,"stock":7,"ref":"1726","categoria":"HOGAR"},{"producto_id":"er-cautin-economico-20cm-1727","variante":"Unidad","producto":"Cautin Economico 20CM","tipo":"variedades","costo":4300,"precio":6500,"stock":6,"ref":"1727","categoria":"CACHARRERIA"},{"producto_id":"er-adaptador-toma-corriente-plano-1731","variante":"Unidad","producto":"Adaptador Toma Corriente Plano","tipo":"variedades","costo":2900,"precio":4400,"stock":4,"ref":"1731","categoria":"FERRETERIA"},{"producto_id":"er-gomas-cono-x60-und-1733","variante":"Unidad","producto":"Gomas Cono X60 Und","tipo":"variedades","costo":9250,"precio":13900,"stock":5,"ref":"1733","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-chamoy-dulce-salado-y-picante-1734","variante":"Unidad","producto":"Chamoy Dulce Salado y Picante","tipo":"variedades","costo":10400,"precio":15600,"stock":8,"ref":"1734","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-cola-loka-spray-x20-und-1736","variante":"Unidad","producto":"Cola Loka Spray X20 Und","tipo":"variedades","costo":20900,"precio":31400,"stock":3,"ref":"1736","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-bola-chicle-ojitos-x100-und-1737","variante":"Unidad","producto":"Bola Chicle Ojitos X100 Und","tipo":"variedades","costo":21000,"precio":31500,"stock":6,"ref":"1737","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-chupete-anillo-luminoso-x15und-1739","variante":"Unidad","producto":"Chupete Anillo Luminoso X15UND","tipo":"variedades","costo":15000,"precio":22500,"stock":2,"ref":"1739","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-chicle-loka-cola-x20-und-1741","variante":"Unidad","producto":"Chicle Loka Cola X20 Und","tipo":"variedades","costo":21800,"precio":32700,"stock":4,"ref":"1741","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-huevito-con-trueno-pop-x24und-1742","variante":"Unidad","producto":"Huevito con Trueno Pop X24UND","tipo":"variedades","costo":21400,"precio":32100,"stock":2,"ref":"1742","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-botellita-acida-x10-und-1743","variante":"Unidad","producto":"Botellita Acida X10 Und","tipo":"variedades","costo":8900,"precio":13400,"stock":2,"ref":"1743","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-taladro-rotomartillo-demoledor-26-mm-800-w-1744","variante":"Unidad","producto":"Taladro Rotomartillo Demoledor 26 Mm – 800 W","tipo":"variedades","costo":167000,"precio":250500,"stock":1,"ref":"1744","categoria":"FERRETERIA"},{"producto_id":"er-taladro-doble-bateria-24-piezas-f049-1745","variante":"Unidad","producto":"Taladro Doble Bateria 24 Piezas F049","tipo":"variedades","costo":79900,"precio":119900,"stock":4,"ref":"1745","categoria":"FERRETERIA"},{"producto_id":"er-kit-facial-control-lineas-de-expresion-retinol-bioaq-1746","variante":"Unidad","producto":"Kit Facial Control Lineas de Expresion Retinol Bioaq","tipo":"variedades","costo":34900,"precio":52400,"stock":15,"ref":"1746","categoria":"BELLEZA"},{"producto_id":"er-taladro-kit-ch444-1748","variante":"Unidad","producto":"Taladro Kit CH444","tipo":"variedades","costo":68000,"precio":102000,"stock":2,"ref":"1748","categoria":"FERRETERIA"},{"producto_id":"er-ego-gel-sobre-x1-unidad-1749","variante":"Unidad","producto":"Ego Gel Sobre X1 Unidad","tipo":"variedades","costo":1000,"precio":1500,"stock":9,"ref":"1749","categoria":"CANASTA FAMILIAR"},{"producto_id":"er-pulsera-tejida-en-rodio-144-dama-1754","variante":"Unidad","producto":"Pulsera Tejida en Rodio 144 Dama","tipo":"variedades","costo":9900,"precio":14900,"stock":4,"ref":"1754","categoria":"JOYERIA"},{"producto_id":"er-anillo-trebol-ch114-1755","variante":"Unidad","producto":"Anillo Trebol CH114","tipo":"variedades","costo":7000,"precio":10500,"stock":2,"ref":"1755","categoria":"JOYERIA"},{"producto_id":"er-dije-angel-ch45-1756","variante":"Unidad","producto":"Dije Angel CH45","tipo":"variedades","costo":4500,"precio":6800,"stock":10,"ref":"1756","categoria":"JOYERIA"},{"producto_id":"er-chicle-tatoo-bolsa-x100-und-1757","variante":"Unidad","producto":"Chicle Tatoo Bolsa X100 Und","tipo":"variedades","costo":18500,"precio":27800,"stock":6,"ref":"1757","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-plancha-en-combo-1760","variante":"Unidad","producto":"Plancha en Combo","tipo":"variedades","costo":28000,"precio":42000,"stock":2,"ref":"1760","categoria":"BELLEZA"},{"producto_id":"er-smart-watch-lg88-pro-248","variante":"Unidad","producto":"Smart Watch LG88 Pro","tipo":"tecnologia","costo":59000,"precio":88500,"stock":2,"ref":"1761","categoria":"TECNOLOGIA"},{"producto_id":"er-smart-watch-s9-mini-amoled-249","variante":"Unidad","producto":"Smart Watch S9 Mini Amoled","tipo":"tecnologia","costo":49000,"precio":73500,"stock":9,"ref":"1762","categoria":"TECNOLOGIA"},{"producto_id":"er-bolso-anti-robo-1763","variante":"Unidad","producto":"Bolso Anti Robo","tipo":"variedades","costo":19900,"precio":29900,"stock":13,"ref":"1763","categoria":"HOGAR"},{"producto_id":"er-dron-moto-juguete-1765","variante":"Unidad","producto":"Dron Moto Juguete","tipo":"variedades","costo":23000,"precio":34500,"stock":1,"ref":"1765","categoria":"PROMOCIONES"},{"producto_id":"er-compresor-carro-con-kit-alta-calidad-1766","variante":"Unidad","producto":"Compresor Carro con Kit Alta Calidad","tipo":"variedades","costo":72000,"precio":108000,"stock":2,"ref":"1766","categoria":"FERRETERIA"},{"producto_id":"er-set-morral-totto-x3-unidades-1767","variante":"Unidad","producto":"Set Morral Totto X3 Unidades","tipo":"variedades","costo":59900,"precio":89900,"stock":3,"ref":"1767","categoria":"HOGAR"},{"producto_id":"er-organizador-de-bano-metalico-fino-1769","variante":"Unidad","producto":"Organizador de Baño Metalico Fino","tipo":"variedades","costo":44000,"precio":66000,"stock":1,"ref":"1769","categoria":"HOGAR"},{"producto_id":"er-caminadora-electrica-fitness-plegable-1770","variante":"Unidad","producto":"Caminadora Electrica Fitness Plegable","tipo":"variedades","costo":799000,"precio":1198500,"stock":9,"ref":"1770","categoria":"HOGAR"},{"producto_id":"er-smartwacht-ultra-combo-pro-253","variante":"Unidad","producto":"Smartwacht Ultra Combo Pro","tipo":"tecnologia","costo":35000,"precio":52500,"stock":4,"ref":"1771","categoria":"TECNOLOGIA"},{"producto_id":"er-depiladora-reutilizable-1772","variante":"Unidad","producto":"Depiladora Reutilizable","tipo":"variedades","costo":4900,"precio":7400,"stock":11,"ref":"1772","categoria":"BELLEZA"},{"producto_id":"er-set-arte-metalico-1774","variante":"Unidad","producto":"Set Arte Metalico","tipo":"variedades","costo":26000,"precio":39000,"stock":4,"ref":"1774","categoria":"PAPELERIA"},{"producto_id":"er-cool-fresh-miel-x12-und-sobre-de-4-und-1775","variante":"Unidad","producto":"Cool Fresh Miel X12 Und (sobre de 4 Und)","tipo":"variedades","costo":10700,"precio":16100,"stock":8,"ref":"1775","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-gomitas-acidas-x92-und-1776","variante":"Unidad","producto":"Gomitas Acidas X92 Und","tipo":"variedades","costo":9900,"precio":14900,"stock":8,"ref":"1776","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-aro-de-luz-tik-tok-con-soporte-para-2-celulares-254","variante":"Unidad","producto":"Aro de Luz Tik Tok con Soporte para 2 Celulares","tipo":"tecnologia","costo":16500,"precio":24800,"stock":71,"ref":"1777","categoria":"TECNOLOGIA"},{"producto_id":"er-adaptador-corriente-av-10459-1780","variante":"Unidad","producto":"Adaptador Corriente AV-10459","tipo":"variedades","costo":1600,"precio":2400,"stock":21,"ref":"1780","categoria":"FERRETERIA"},{"producto_id":"er-audifonos-tws-s510-con-pantalla-digital-256","variante":"Unidad","producto":"Audifonos TWS S510 con Pantalla Digital","tipo":"tecnologia","costo":13500,"precio":20300,"stock":75,"ref":"1781","categoria":"TECNOLOGIA"},{"producto_id":"er-esencia-de-acido-salicilico-control-acne-1782","variante":"Unidad","producto":"Esencia de Acido Salicilico Control Acne","tipo":"variedades","costo":3000,"precio":4500,"stock":305,"ref":"1782","categoria":"CONTENEDOR CHINA"},{"producto_id":"er-cesta-ropa-sucia-4-divisiones-1783","variante":"Unidad","producto":"Cesta Ropa Sucia 4 Divisiones","tipo":"variedades","costo":41000,"precio":61500,"stock":8,"ref":"1783","categoria":"HOGAR"},{"producto_id":"er-gorrito-led-magico-1784","variante":"Unidad","producto":"Gorrito LED Magico","tipo":"variedades","costo":13000,"precio":19500,"stock":2,"ref":"1784","categoria":"CACHARRERIA"},{"producto_id":"er-mora-yogurt-x100-und-1786","variante":"Unidad","producto":"Mora Yogurt X100 Und","tipo":"variedades","costo":7600,"precio":11400,"stock":2,"ref":"1786","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-chupitos-x30-und-1788","variante":"Unidad","producto":"Chupitos X30 Und","tipo":"variedades","costo":6500,"precio":9800,"stock":7,"ref":"1788","categoria":"DULCERIA IMPORTADA"},{"producto_id":"er-licuadora-portatil-de-750-ml-1789","variante":"Unidad","producto":"Licuadora Portatil de 750 Ml","tipo":"variedades","costo":43500,"precio":65300,"stock":3,"ref":"1789","categoria":"HOGAR"},{"producto_id":"er-kit-de-grabacion-para-celular-ay-49rgb-fino-258","variante":"Unidad","producto":"Kit de Grabacion para Celular AY-49RGB Fino","tipo":"tecnologia","costo":27500,"precio":41300,"stock":2,"ref":"1790","categoria":"TECNOLOGIA"},{"producto_id":"er-audifonos-inalambricos-con-pantalla-inteligente-anc-259","variante":"Unidad","producto":"Audifonos Inalambricos con Pantalla Inteligente ANC","tipo":"tecnologia","costo":38000,"precio":57000,"stock":15,"ref":"robin","categoria":"TECNOLOGIA"},{"producto_id":"er-afilador-de-cuchillos-1792","variante":"Unidad","producto":"Afilador de Cuchillos","tipo":"variedades","costo":4900,"precio":7400,"stock":1,"ref":"ROBIN","categoria":"HOGAR"},{"producto_id":"er-silicona-liquida-grafi-30ml-1793","variante":"Unidad","producto":"Silicona Liquida Grafi 30ML","tipo":"variedades","costo":1900,"precio":2900,"stock":22,"ref":"1793","categoria":"CACHARRERIA"},{"producto_id":"er-armario-3-cuerpos-1794","variante":"Unidad","producto":"Armario 3 Cuerpos","tipo":"variedades","costo":55000,"precio":82500,"stock":5,"ref":"1794","categoria":"HOGAR"},{"producto_id":"er-localizador-inteligente-loshall-f15-1795","variante":"Unidad","producto":"Localizador Inteligente Loshall F15","tipo":"variedades","costo":32500,"precio":48800,"stock":9,"ref":"1795","categoria":"DEPORTE"},{"producto_id":"er-power-bank-magnetico-10000-mah-yo11-261","variante":"Unidad","producto":"Power Bank Magnetico 10.000 mAh YO11","tipo":"tecnologia","costo":66000,"precio":99000,"stock":5,"ref":"1796","categoria":"TECNOLOGIA"},{"producto_id":"er-audifonos-ows-yks286-262","variante":"Unidad","producto":"Audifonos Ows YKS286","tipo":"tecnologia","costo":49000,"precio":73500,"stock":6,"ref":"1797","categoria":"TECNOLOGIA"},{"producto_id":"er-airpods-originales-es57-263","variante":"Unidad","producto":"Audífonos Inalámbricos ES57","tipo":"tecnologia","costo":34000,"precio":51000,"stock":8,"ref":"1798","categoria":"TECNOLOGIA"},{"producto_id":"er-airpods-originales-es56-264","variante":"Unidad","producto":"Audífonos Inalámbricos ES56","tipo":"tecnologia","costo":37000,"precio":55500,"stock":9,"ref":"1799","categoria":"TECNOLOGIA"},{"producto_id":"er-cargador-superrapido-60w-ki275-265","variante":"Unidad","producto":"Cargador Superrapido 60W KI275","tipo":"tecnologia","costo":58000,"precio":87000,"stock":9,"ref":"1800","categoria":"TECNOLOGIA"},{"producto_id":"er-combo-x3-arruru-1801","variante":"Unidad","producto":"Combo X3 Arruru","tipo":"variedades","costo":19900,"precio":29900,"stock":10,"ref":"1801","categoria":"BELLEZA"},{"producto_id":"er-linterna-minera-usb-1803","variante":"Unidad","producto":"Linterna Minera USB","tipo":"variedades","costo":9300,"precio":14000,"stock":8,"ref":"LAURA","categoria":"FERRETERIA"},{"producto_id":"er-saca-corchos-con-destapador-1804","variante":"Unidad","producto":"Saca Corchos con Destapador","tipo":"variedades","costo":2200,"precio":3300,"stock":4,"ref":"LAURA","categoria":"HOGAR"},{"producto_id":"er-lazo-para-saltar-1805","variante":"Unidad","producto":"Lazo para Saltar","tipo":"variedades","costo":7400,"precio":11100,"stock":3,"ref":"1805","categoria":"DEPORTE"},{"producto_id":"er-cargador-de-pilas-110v-1806","variante":"Unidad","producto":"Cargador de Pilas 110V","tipo":"variedades","costo":13800,"precio":20700,"stock":1,"ref":"LAURA","categoria":"CACHARRERIA"},{"producto_id":"er-brochas-x3-unidades-1807","variante":"Unidad","producto":"Brochas X3 Unidades","tipo":"variedades","costo":3500,"precio":5300,"stock":14,"ref":"LAURA","categoria":"FERRETERIA"},{"producto_id":"er-candado-cadena-para-moto-1808","variante":"Unidad","producto":"Candado Cadena para Moto","tipo":"variedades","costo":8900,"precio":13400,"stock":19,"ref":"1808","categoria":"FERRETERIA"},{"producto_id":"er-provador-voltaje-carro-1810","variante":"Unidad","producto":"Provador Voltaje Carro","tipo":"variedades","costo":7300,"precio":11000,"stock":4,"ref":"1810","categoria":"FERRETERIA"},{"producto_id":"er-plancha-hondas-1811","variante":"Unidad","producto":"Plancha Hondas","tipo":"variedades","costo":29900,"precio":44900,"stock":8,"ref":"LEY","categoria":"BELLEZA"},{"producto_id":"er-espuma-limpiadora-de-rosas-sado-1813","variante":"Unidad","producto":"Espuma Limpiadora de Rosas Sado","tipo":"variedades","costo":6500,"precio":9800,"stock":10,"ref":"1813","categoria":"BELLEZA"},{"producto_id":"er-set-de-llave-allen-8pcs-1814","variante":"Unidad","producto":"Set de Llave Allen 8PCS","tipo":"variedades","costo":2000,"precio":3000,"stock":3,"ref":"1814","categoria":"FERRETERIA"},{"producto_id":"er-sierra-perforadora-6-pcs-1815","variante":"Unidad","producto":"Sierra Perforadora 6 Pcs","tipo":"variedades","costo":6200,"precio":9300,"stock":8,"ref":"1815","categoria":"FERRETERIA"},{"producto_id":"er-malla-para-mascotas-1816","variante":"Unidad","producto":"Malla para Mascotas","tipo":"variedades","costo":17500,"precio":26300,"stock":2,"ref":"1816","categoria":"CACHARRERIA"},{"producto_id":"er-soporte-rodilla-fina-1817","variante":"Unidad","producto":"Soporte Rodilla Fina","tipo":"variedades","costo":13000,"precio":19500,"stock":6,"ref":"1817","categoria":"DEPORTE"},{"producto_id":"er-plancha-electrica-1818","variante":"Unidad","producto":"Plancha Electrica","tipo":"variedades","costo":33000,"precio":49500,"stock":2,"ref":"LEY","categoria":"HOGAR"},{"producto_id":"er-masajeador-facial-con-luz-rejuvecimiento-y-quita-papada-1819","variante":"Unidad","producto":"Masajeador Facial con Luz Rejuvecimiento y Quita Papada","tipo":"variedades","costo":19900,"precio":29900,"stock":5,"ref":"1819","categoria":"BELLEZA"},{"producto_id":"er-estacion-de-desayuno-2-en-1-1821","variante":"Unidad","producto":"Estacion de Desayuno 2 en 1","tipo":"variedades","costo":99000,"precio":148500,"stock":10,"ref":"1821","categoria":"HOGAR"},{"producto_id":"er-set-manicure-x-9-con-lima-metalica-1823","variante":"Unidad","producto":"Set Manicure x 9 con Lima Metalica","tipo":"variedades","costo":6900,"precio":10400,"stock":14,"ref":"1823","categoria":"CACHARRERIA"},{"producto_id":"er-copa-aguardiente-vidrio-1824","variante":"Unidad","producto":"Copa Aguardiente Vidrio","tipo":"variedades","costo":1900,"precio":2900,"stock":10,"ref":"FRONT","categoria":"CACHARRERIA"},{"producto_id":"er-silla-modular-1825","variante":"Unidad","producto":"Silla Modular","tipo":"variedades","costo":6900,"precio":10400,"stock":7,"ref":"FRONT","categoria":"CACHARRERIA"},{"producto_id":"er-cuchillo-sierra-1826","variante":"Unidad","producto":"Cuchillo Sierra","tipo":"variedades","costo":1700,"precio":2600,"stock":37,"ref":"FRONT","categoria":"CACHARRERIA"},{"producto_id":"er-pantalla-selfie-270","variante":"Unidad","producto":"Pantalla Selfie","tipo":"tecnologia","costo":39000,"precio":58500,"stock":4,"ref":"LEY","categoria":"TECNOLOGIA"},{"producto_id":"er-fuente-chocolate-1828","variante":"Unidad","producto":"Fuente Chocolate","tipo":"variedades","costo":39900,"precio":59900,"stock":3,"ref":"1828","categoria":"HOGAR"},{"producto_id":"er-pulidora-doble-bateria-1832","variante":"Unidad","producto":"Pulidora Doble Bateria","tipo":"variedades","costo":52900,"precio":79400,"stock":1,"ref":"1832","categoria":"FERRETERIA"},{"producto_id":"er-detector-metales-1833","variante":"Unidad","producto":"Detector Metales","tipo":"variedades","costo":45000,"precio":67500,"stock":3,"ref":"1833","categoria":"CACHARRERIA"},{"producto_id":"er-manguera-de-15-metros-1834","variante":"Unidad","producto":"Manguera de 15 Metros","tipo":"variedades","costo":18500,"precio":27800,"stock":8,"ref":"1834","categoria":"FERRETERIA"},{"producto_id":"er-lampara-solar-1835","variante":"Unidad","producto":"Lampara Solar","tipo":"variedades","costo":16600,"precio":24900,"stock":1,"ref":"1835","categoria":"FERRETERIA"},{"producto_id":"er-olla-arrocera-electrica-sokany-blanca-22l-1836","variante":"Unidad","producto":"Olla Arrocera Electrica Sokany Blanca 2.2L","tipo":"variedades","costo":110000,"precio":165000,"stock":3,"ref":"1836","categoria":"HOGAR"},{"producto_id":"er-cortador-de-vidrio-1838","variante":"Unidad","producto":"Cortador de Vidrio","tipo":"variedades","costo":4400,"precio":6600,"stock":10,"ref":"1838","categoria":"HOGAR"},{"producto_id":"er-humidificador-ultrasonico-uv-1839","variante":"Unidad","producto":"Humidificador Ultrasonico UV","tipo":"variedades","costo":14900,"precio":22400,"stock":70,"ref":"1839","categoria":"HOGAR"},{"producto_id":"er-mini-luz-led-recargable-para-celular-3w-272","variante":"Unidad","producto":"Mini Luz LED Recargable para Celular 3W","tipo":"tecnologia","costo":4900,"precio":7400,"stock":162,"ref":"1840","categoria":"TECNOLOGIA"},{"producto_id":"er-mini-electrica-motosierra-1844","variante":"Unidad","producto":"Mini Electrica Motosierra","tipo":"variedades","costo":57500,"precio":86300,"stock":4,"ref":"maye","categoria":"FERRETERIA"},{"producto_id":"er-juego-ahorcado-1847","variante":"Unidad","producto":"Juego Ahorcado","tipo":"variedades","costo":29900,"precio":44900,"stock":2,"ref":"1847","categoria":"CACHARRERIA"},{"producto_id":"er-soporte-celular-hold-371-273","variante":"Unidad","producto":"Soporte Celular HOLD-371","tipo":"tecnologia","costo":4700,"precio":7100,"stock":30,"ref":"1848","categoria":"TECNOLOGIA"},{"producto_id":"er-soporte-celular-hold-439-274","variante":"Unidad","producto":"Soporte Celular HOLD-439","tipo":"tecnologia","costo":4700,"precio":7100,"stock":10,"ref":"1849","categoria":"TECNOLOGIA"},{"producto_id":"er-mesa-auto-hold-372-275","variante":"Unidad","producto":"Mesa Auto HOLD-372","tipo":"tecnologia","costo":18700,"precio":28100,"stock":3,"ref":"1850","categoria":"TECNOLOGIA"},{"producto_id":"er-espejos-retrovisor-mirrorsc-1851","variante":"Unidad","producto":"Espejos Retrovisor Mirror/sc","tipo":"variedades","costo":19900,"precio":29900,"stock":8,"ref":"1851","categoria":"FERRETERIA"},{"producto_id":"er-set-x3-lattafa-give-me-gourmand-30ml-1852","variante":"Unidad","producto":"Set X3 Lattafa Give Me Gourmand 30ML","tipo":"variedades","costo":95000,"precio":142500,"stock":7,"ref":"1852","categoria":"PERFUMERIA"},{"producto_id":"er-serum-hidratante-arroz-35ml-bioaqua-bqy41012-1854","variante":"Unidad","producto":"Serum Hidratante Arroz 35ML Bioaqua BQY41012","tipo":"variedades","costo":3500,"precio":5300,"stock":18,"ref":"1854","categoria":"BELLEZA"},{"producto_id":"er-tonico-hidratante-de-arroz-bioaqua-bqy41029-1855","variante":"Unidad","producto":"Tonico Hidratante de Arroz Bioaqua BQY41029","tipo":"variedades","costo":5200,"precio":7800,"stock":15,"ref":"1855","categoria":"BELLEZA"},{"producto_id":"er-aceite-desmaquillante-arroz-bioaq-bqy78698-1857","variante":"Unidad","producto":"Aceite Desmaquillante Arroz Bioaq BQY78698","tipo":"variedades","costo":7500,"precio":11300,"stock":10,"ref":"1857","categoria":"BELLEZA"},{"producto_id":"er-bombillo-led-corazon-4w-2700k-120v-e27-1859","variante":"Unidad","producto":"Bombillo LED Corazon (4W 2700K 120V E27)","tipo":"variedades","costo":14800,"precio":22200,"stock":3,"ref":"1859","categoria":"FERRETERIA"},{"producto_id":"er-bombillo-led-diamante-4w-2700k-120v-e27-1860","variante":"Unidad","producto":"Bombillo LED Diamante (4W 2700K 120V E27)","tipo":"variedades","costo":12100,"precio":18200,"stock":3,"ref":"1860","categoria":"FERRETERIA"},{"producto_id":"er-bombillo-led-balon-20w-escualizable-1861","variante":"Unidad","producto":"Bombillo LED Balon 20W Escualizable","tipo":"variedades","costo":17500,"precio":26300,"stock":2,"ref":"1861","categoria":"FERRETERIA"},{"producto_id":"er-bombillo-led-uv-12w-e27-1862","variante":"Unidad","producto":"Bombillo LED UV (12W E27)","tipo":"variedades","costo":29000,"precio":43500,"stock":3,"ref":"1862","categoria":"FERRETERIA"},{"producto_id":"er-lampara-led-solar-estaca-1w-llama-de-antorcha-33l-80cm-1863","variante":"Unidad","producto":"Lampara LED Solar Estaca 1W (llama de Antorcha 33L 80CM)","tipo":"variedades","costo":44000,"precio":66000,"stock":2,"ref":"1863","categoria":"FERRETERIA"},{"producto_id":"er-guante-nitrilo-alta-calidad-talla-l-par-1864","variante":"Unidad","producto":"Guante Nitrilo Alta Calidad Talla L (par)","tipo":"variedades","costo":2600,"precio":3900,"stock":18,"ref":"1864","categoria":"FERRETERIA"},{"producto_id":"er-guante-nitrilo-reforzado-talla-l-par-1865","variante":"Unidad","producto":"Guante Nitrilo Reforzado Talla L (par)","tipo":"variedades","costo":3300,"precio":5000,"stock":20,"ref":"1865","categoria":"FERRETERIA"},{"producto_id":"er-set-khamrah-x3-1866","variante":"Unidad","producto":"Set Khamrah X3","tipo":"variedades","costo":89900,"precio":134900,"stock":10,"ref":"1866","categoria":"PERFUMERIA"},{"producto_id":"er-comedero-mascota-x-1-1867","variante":"Unidad","producto":"Comedero Mascota x 1","tipo":"variedades","costo":1950,"precio":3000,"stock":22,"ref":"1867","categoria":"MASCOTAS"},{"producto_id":"er-parlante-kimiso-kms-295-277","variante":"Unidad","producto":"Parlante Kimiso KMS-295","tipo":"tecnologia","costo":36000,"precio":54000,"stock":6,"ref":"migueltm","categoria":"TECNOLOGIA"},{"producto_id":"er-teclado-gamer-278","variante":"Unidad","producto":"Teclado Gamer","tipo":"tecnologia","costo":36000,"precio":54000,"stock":6,"ref":"1869","categoria":"TECNOLOGIA"},{"producto_id":"er-parlante-portatil-ajustable-kms-299-279","variante":"Unidad","producto":"Parlante Portatil Ajustable KMS-299","tipo":"tecnologia","costo":29900,"precio":44900,"stock":5,"ref":"1870","categoria":"TECNOLOGIA"},{"producto_id":"er-estacion-de-carga-1871","variante":"Unidad","producto":"Estacion de Carga","tipo":"variedades","costo":49900,"precio":74900,"stock":5,"ref":"1871","categoria":"HOGAR"},{"producto_id":"er-bafle-alaxe-1875","variante":"Unidad","producto":"Bafle Alaxe","tipo":"variedades","costo":29900,"precio":44900,"stock":8,"ref":"1875","categoria":"CACHARRERIA"},{"producto_id":"er-parlante-portatil-original-kimiso-kms-374-283","variante":"Unidad","producto":"Parlante Portatil Original Kimiso KMS-374","tipo":"tecnologia","costo":135000,"precio":202500,"stock":9,"ref":"1876","categoria":"TECNOLOGIA"},{"producto_id":"er-parlante-portatil-original-kimiso-kms-323-284","variante":"Unidad","producto":"Parlante Portatil Original Kimiso KMS-323","tipo":"tecnologia","costo":88000,"precio":132000,"stock":8,"ref":"1877","categoria":"TECNOLOGIA"},{"producto_id":"er-parlante-portatil-original-kimiso-kms-325-max-285","variante":"Unidad","producto":"Parlante Portatil Original Kimiso KMS-325 Max","tipo":"tecnologia","costo":199000,"precio":298500,"stock":10,"ref":"1878","categoria":"TECNOLOGIA"},{"producto_id":"er-diademas-yookie-originales-eb37-286","variante":"Unidad","producto":"Diademas Yookie Originales EB37","tipo":"tecnologia","costo":59900,"precio":89900,"stock":10,"ref":"1881","categoria":"TECNOLOGIA"},{"producto_id":"er-lampara-antimosquitos-r8-1882","variante":"Unidad","producto":"Lampara Antimosquitos R8","tipo":"variedades","costo":12900,"precio":19400,"stock":4,"ref":"1882","categoria":"HOGAR"},{"producto_id":"er-navaja-seguro-fina-1883","variante":"Unidad","producto":"Navaja Seguro Fina","tipo":"variedades","costo":9900,"precio":14900,"stock":11,"ref":"1883","categoria":"CACHARRERIA"},{"producto_id":"er-soporte-para-carro-hold-372-287","variante":"Unidad","producto":"Soporte para Carro HOLD-372","tipo":"tecnologia","costo":23700,"precio":35600,"stock":2,"ref":"1885","categoria":"TECNOLOGIA"},{"producto_id":"er-soporte-para-carro-vaso-bandeja-y-celular-1887","variante":"Unidad","producto":"Soporte para Carro Vaso Bandeja y Celular","tipo":"variedades","costo":22500,"precio":33800,"stock":2,"ref":"1887","categoria":"CACHARRERIA"},{"producto_id":"er-hombrera-termica-unisex-1901","variante":"Unidad","producto":"Hombrera Termica Unisex","tipo":"variedades","costo":19900,"precio":29900,"stock":7,"ref":"1901","categoria":"DEPORTE"},{"producto_id":"er-gafas-inteligentes-g5-2026-con-camara-e-ia-1905","variante":"Unidad","producto":"Gafas Inteligentes G5 2026 con Camara E Ia","tipo":"variedades","costo":169900,"precio":254900,"stock":9,"ref":"1905","categoria":"DEPORTE"},{"producto_id":"er-cable-tipo-c-trenzado-av-10728-ccr-293","variante":"Unidad","producto":"Cable Tipo C Trenzado AV-10728-CCR","tipo":"tecnologia","costo":4300,"precio":6500,"stock":19,"ref":"PRO 20","categoria":"TECNOLOGIA"},{"producto_id":"er-set-peinetas-x-10-av-9043-1907","variante":"Unidad","producto":"Set Peinetas x 10 AV-9043","tipo":"variedades","costo":6500,"precio":9800,"stock":3,"ref":"1907","categoria":"CACHARRERIA"},{"producto_id":"er-amarras-x100-und-av-106-21-1908","variante":"Unidad","producto":"Amarras X100 Und AV-106 21","tipo":"variedades","costo":3100,"precio":4700,"stock":12,"ref":"1908","categoria":"FERRETERIA"},{"producto_id":"er-gafas-de-seguridad-ptq1778-1909","variante":"Unidad","producto":"Gafas de Seguridad PTQ1778","tipo":"variedades","costo":2200,"precio":3300,"stock":14,"ref":"1909","categoria":"FERRETERIA"},{"producto_id":"er-agujas-para-balon-y-bicicleta-5pc-av-3087-1910","variante":"Unidad","producto":"Agujas para Balon y Bicicleta 5PC AV-3087","tipo":"variedades","costo":2500,"precio":3800,"stock":11,"ref":"1910","categoria":"DEPORTE"},{"producto_id":"er-aspersor-jardin-1913","variante":"Unidad","producto":"Aspersor Jardin","tipo":"variedades","costo":7900,"precio":11900,"stock":4,"ref":"1913","categoria":"FERRETERIA"},{"producto_id":"er-chaleco-maleta-1914","variante":"Unidad","producto":"Chaleco Maleta","tipo":"variedades","costo":29900,"precio":44900,"stock":6,"ref":"1914","categoria":"DEPORTE"},{"producto_id":"er-podadora-de-cesped-portatil-1915","variante":"Unidad","producto":"Podadora de Cesped Portatil","tipo":"variedades","costo":79000,"precio":118500,"stock":2,"ref":"1915","categoria":"FERRETERIA"},{"producto_id":"er-set-morrales-chino-x3-1918","variante":"Unidad","producto":"Set Morrales Chino X3","tipo":"variedades","costo":29900,"precio":44900,"stock":3,"ref":"1918","categoria":"HOGAR"},{"producto_id":"er-set-morral-totto-x3-unidades-a3-1921","variante":"Unidad","producto":"Set Morral Totto X3 Unidades A3","tipo":"variedades","costo":59900,"precio":89900,"stock":4,"ref":"1921","categoria":"HOGAR"},{"producto_id":"er-diademas-pro-tuka-xh-648-295","variante":"Unidad","producto":"Diademas Pro Tuka XH-648","tipo":"tecnologia","costo":29900,"precio":44900,"stock":6,"ref":"LEY","categoria":"TECNOLOGIA"},{"producto_id":"er-organizador-de-bano-3-niveles-1923","variante":"Unidad","producto":"Organizador de Baño 3 Niveles","tipo":"variedades","costo":26000,"precio":39000,"stock":8,"ref":"1923","categoria":"HOGAR"},{"producto_id":"er-maquina-de-desayuno-3-en-1-sokany-1926","variante":"Unidad","producto":"Maquina de Desayuno 3 en 1 Sokany","tipo":"variedades","costo":149900,"precio":224900,"stock":5,"ref":"1926","categoria":"HOGAR"},{"producto_id":"er-desmenuzador-de-carne-manual-1927","variante":"Unidad","producto":"Desmenuzador de Carne Manual","tipo":"variedades","costo":19900,"precio":29900,"stock":2,"ref":"1927","categoria":"HOGAR"},{"producto_id":"er-audifonos-de-conduccion-osea-298","variante":"Unidad","producto":"Audifonos de Conduccion Osea","tipo":"tecnologia","costo":31900,"precio":47900,"stock":2,"ref":"1928","categoria":"TECNOLOGIA"},{"producto_id":"er-teclado-inalambrico-tactil-yookie-ye36-299","variante":"Unidad","producto":"Teclado Inalambrico Tactil Yookie YE36","tipo":"tecnologia","costo":59900,"precio":89900,"stock":10,"ref":"1929","categoria":"TECNOLOGIA"},{"producto_id":"er-teclado-inalambrico-portatil-ultrafino-300","variante":"Unidad","producto":"Teclado Inalambrico Portatil Ultrafino","tipo":"tecnologia","costo":39900,"precio":59900,"stock":9,"ref":"1930","categoria":"TECNOLOGIA"},{"producto_id":"er-power-bank-225w-yookie-original-301","variante":"Unidad","producto":"Power Bank 22.5W Yookie Original","tipo":"tecnologia","costo":58500,"precio":87800,"stock":7,"ref":"1931","categoria":"TECNOLOGIA"},{"producto_id":"er-cable-de-carga-rapida-y-datos-4-en-1-yookie-ec27-120w-303","variante":"Unidad","producto":"Cable de Carga Rapida y Datos 4 en 1 Yookie EC27 120W","tipo":"tecnologia","costo":12600,"precio":18900,"stock":4,"ref":"1933","categoria":"TECNOLOGIA"},{"producto_id":"er-cable-de-datos-y-carga-rapida-yookie-cb108-100w-304","variante":"Unidad","producto":"Cable de Datos y Carga Rapida Yookie CB108 100W","tipo":"tecnologia","costo":20700,"precio":31100,"stock":9,"ref":"1934","categoria":"TECNOLOGIA"},{"producto_id":"er-set-manicure-x5-pcs-1935","variante":"Unidad","producto":"Set Manicure X5 Pcs","tipo":"variedades","costo":2000,"precio":3000,"stock":3,"ref":"1935","categoria":"BELLEZA"},{"producto_id":"er-guantes-grueso-puntos-negros-1936","variante":"Unidad","producto":"Guantes Grueso Puntos Negros","tipo":"variedades","costo":3200,"precio":4800,"stock":29,"ref":"1936","categoria":"FERRETERIA"},{"producto_id":"er-jabon-antioxidantes-vitamina-c-bioaqua-bqy00200-1938","variante":"Unidad","producto":"Jabon Antioxidantes Vitamina C Bioaqua BQY00200","tipo":"variedades","costo":5000,"precio":7500,"stock":5,"ref":"1938","categoria":"BELLEZA"},{"producto_id":"er-gel-exfoliante-anti-acne-centella-bqy79985-1939","variante":"Unidad","producto":"Gel Exfoliante Anti Acne Centella BQY79985","tipo":"variedades","costo":6700,"precio":10100,"stock":4,"ref":"1939","categoria":"BELLEZA"},{"producto_id":"er-protector-solar-centella-spf-50-bqy79978-1940","variante":"Unidad","producto":"Protector Solar Centella Spf 50 BQY79978","tipo":"variedades","costo":7400,"precio":11100,"stock":3,"ref":"1940","categoria":"BELLEZA"},{"producto_id":"er-acondicionador-crecimiento-romero-1941","variante":"Unidad","producto":"Acondicionador Crecimiento Romero","tipo":"variedades","costo":7700,"precio":11600,"stock":1,"ref":"1941","categoria":"BELLEZA"},{"producto_id":"er-emulsion-facial-de-vitamina-e-y-c-bioaqua-bqy89222-1942","variante":"Unidad","producto":"Emulsion Facial de Vitamina E y C Bioaqua BQY89222","tipo":"variedades","costo":5400,"precio":8100,"stock":6,"ref":"1942","categoria":"BELLEZA"},{"producto_id":"er-gas-pimienta-grande-defensa-personal-1943","variante":"Unidad","producto":"Gas Pimienta Grande Defensa Personal","tipo":"variedades","costo":8500,"precio":12800,"stock":10,"ref":"1943","categoria":"DEPORTE"},{"producto_id":"er-zapatos-acuaticos-para-hombre-finos-1945","variante":"Unidad","producto":"Zapatos Acuaticos para Hombre Finos","tipo":"variedades","costo":24900,"precio":37400,"stock":4,"ref":"1945","categoria":"DEPORTE"},{"producto_id":"er-navaja-automatica-estampada-1947","variante":"Unidad","producto":"Navaja Automatica Estampada","tipo":"variedades","costo":8500,"precio":12800,"stock":3,"ref":"1947","categoria":"CACHARRERIA"},{"producto_id":"er-sandalia-dama-tipo-tres-puntadas-1948","variante":"Unidad","producto":"Sandalia Dama Tipo Tres Puntadas","tipo":"variedades","costo":9900,"precio":14900,"stock":33,"ref":"1948","categoria":"CALZADO NACIONAL"},{"producto_id":"er-bandas-tubulares-x-11-d002-1949","variante":"Unidad","producto":"Bandas Tubulares x 11 D002","tipo":"variedades","costo":13750,"precio":20700,"stock":4,"ref":"1949","categoria":"DEPORTE"},{"producto_id":"er-dispensador-de-agua-1952","variante":"Unidad","producto":"Dispensador de Agua","tipo":"variedades","costo":9800,"precio":14700,"stock":12,"ref":"1952","categoria":"HOGAR"},{"producto_id":"er-maleta-antirobo-h142-1953","variante":"Unidad","producto":"Maleta Antirobo H142","tipo":"variedades","costo":26000,"precio":39000,"stock":5,"ref":"1953","categoria":"HOGAR"},{"producto_id":"er-maleta-viajera-deportivo-t60-1956","variante":"Unidad","producto":"Maleta Viajera Deportivo T60","tipo":"variedades","costo":30000,"precio":45000,"stock":8,"ref":"1956","categoria":"DEPORTE"},{"producto_id":"er-batidor-electrico-3-velocidades-1957","variante":"Unidad","producto":"Batidor Electrico 3 Velocidades","tipo":"variedades","costo":13000,"precio":19500,"stock":5,"ref":"1957","categoria":"HOGAR"},{"producto_id":"er-dispensador-de-cocina-1959","variante":"Unidad","producto":"Dispensador de Cocina","tipo":"variedades","costo":14900,"precio":22400,"stock":4,"ref":"1959","categoria":"HOGAR"},{"producto_id":"er-parlante-bluetooth-con-luz-rgb-kts-2310-307","variante":"Unidad","producto":"Parlante Bluetooth con Luz RGB KTS-2310","tipo":"tecnologia","costo":29900,"precio":44900,"stock":1,"ref":"1960","categoria":"TECNOLOGIA"},{"producto_id":"er-lonchera-termica-portatil-1961","variante":"Unidad","producto":"Lonchera Termica Portatil","tipo":"variedades","costo":9600,"precio":14400,"stock":4,"ref":"1961","categoria":"CACHARRERIA"},{"producto_id":"er-masajeador-electronico-multifuncional-1962","variante":"Unidad","producto":"Masajeador Electronico Multifuncional","tipo":"variedades","costo":16800,"precio":25200,"stock":2,"ref":"CALI","categoria":"DEPORTE"},{"producto_id":"er-impermeabilizante-brocha-v-2051-1964","variante":"Unidad","producto":"Impermeabilizante + Brocha V-2051","tipo":"variedades","costo":9900,"precio":14900,"stock":3,"ref":"1964","categoria":"CACHARRERIA"},{"producto_id":"er-9714-hombre-negro-chanclas-1966","variante":"Unidad","producto":"9714 Hombre Negro Chanclas","tipo":"variedades","costo":9900,"precio":14900,"stock":7,"ref":"1966","categoria":"CALZADO NACIONAL"},{"producto_id":"er-maquina-de-afeitar-original-ch1-1968","variante":"Unidad","producto":"Maquina de Afeitar Original CH1","tipo":"variedades","costo":29900,"precio":44900,"stock":2,"ref":"1968","categoria":"HOGAR"},{"producto_id":"er-smart-watch-sii-pro-original-308","variante":"Unidad","producto":"Smart Watch Sii Pro Original","tipo":"tecnologia","costo":94500,"precio":141800,"stock":3,"ref":"1969","categoria":"TECNOLOGIA"},{"producto_id":"er-smart-watch-w33-original-309","variante":"Unidad","producto":"Smart Watch W33 Original","tipo":"tecnologia","costo":99900,"precio":149900,"stock":9,"ref":"1970","categoria":"TECNOLOGIA"},{"producto_id":"er-lampara-proyectora-de-estrellas-star-master-310","variante":"Unidad","producto":"Lampara Proyectora de Estrellas Star Master","tipo":"tecnologia","costo":16500,"precio":24800,"stock":5,"ref":"1972","categoria":"TECNOLOGIA"},{"producto_id":"er-kit-x11-piezas-secador-de-cabello-1973","variante":"Unidad","producto":"Kit X11 Piezas Secador de Cabello","tipo":"variedades","costo":39900,"precio":59900,"stock":27,"ref":"1973","categoria":"HOGAR"},{"producto_id":"er-maquina-electrica-afeitadora-1974","variante":"Unidad","producto":"Maquina Electrica Afeitadora","tipo":"variedades","costo":6500,"precio":9800,"stock":58,"ref":"1974","categoria":"BARBERIA INSUMOS"},{"producto_id":"er-estante-grifo-escurridor-hogar-1975","variante":"Unidad","producto":"Estante Grifo Escurridor Hogar","tipo":"variedades","costo":5000,"precio":7500,"stock":43,"ref":"1975","categoria":"HOGAR"},{"producto_id":"er-butaco-plegable-pequeno-ecologico-1976","variante":"Unidad","producto":"Butaco Plegable Pequeño Ecologico","tipo":"variedades","costo":14900,"precio":22400,"stock":94,"ref":"1976","categoria":"HOGAR"},{"producto_id":"er-balaclava-pasamontanas-protecion-facial-1977","variante":"Unidad","producto":"Balaclava / Pasamontañas Protecion Facial","tipo":"variedades","costo":6500,"precio":9800,"stock":12,"ref":"1977","categoria":"DEPORTE"},{"producto_id":"er-espejo-de-maquillaje-con-luz-led-1978","variante":"Unidad","producto":"Espejo de Maquillaje con Luz LED","tipo":"variedades","costo":34900,"precio":52400,"stock":3,"ref":"1978","categoria":"BELLEZA"},{"producto_id":"er-juego-de-cuchillos-cocina-x6-und-1979","variante":"Unidad","producto":"Juego de Cuchillos Cocina X6 Und","tipo":"variedades","costo":19900,"precio":29900,"stock":36,"ref":"1979","categoria":"HOGAR"},{"producto_id":"er-dispensador-pasta-dental-porta-cepillos-1980","variante":"Unidad","producto":"Dispensador Pasta Dental + Porta Cepillos","tipo":"variedades","costo":8500,"precio":12800,"stock":73,"ref":"1980","categoria":"CONTENEDOR CHINA"},{"producto_id":"er-ganchos-de-pared-adhesivos-x2-und-1981","variante":"Unidad","producto":"Ganchos de Pared Adhesivos X2 Und","tipo":"variedades","costo":1500,"precio":2300,"stock":216,"ref":"1981","categoria":"CONTENEDOR CHINA"},{"producto_id":"er-descamador-de-pescado-1982","variante":"Unidad","producto":"Descamador de Pescado","tipo":"variedades","costo":4900,"precio":7400,"stock":98,"ref":"1982","categoria":"CONTENEDOR CHINA"},{"producto_id":"er-aspiradora-portable-3-en-1-50aw-1983","variante":"Unidad","producto":"Aspiradora Portable 3 en 1 50AW","tipo":"variedades","costo":29900,"precio":44900,"stock":41,"ref":"1983","categoria":"HOGAR"},{"producto_id":"er-smart-watch-ace-180-312","variante":"Unidad","producto":"Smart Watch ACE-180","tipo":"tecnologia","costo":34900,"precio":52400,"stock":6,"ref":"1985","categoria":"TECNOLOGIA"},{"producto_id":"er-smart-watch-ws-75-ultra-3-313","variante":"Unidad","producto":"Smart Watch WS-75 Ultra 3","tipo":"tecnologia","costo":39900,"precio":59900,"stock":4,"ref":"1986","categoria":"TECNOLOGIA"},{"producto_id":"er-smart-watch-x10-pro-max-314","variante":"Unidad","producto":"Smart Watch X10 Pro Max","tipo":"tecnologia","costo":56000,"precio":84000,"stock":5,"ref":"1987","categoria":"TECNOLOGIA"},{"producto_id":"er-cepillo-puntos-peinilla-1988","variante":"Unidad","producto":"Cepillo Puntos + Peinilla","tipo":"variedades","costo":2800,"precio":4200,"stock":10,"ref":"1988","categoria":"CACHARRERIA"},{"producto_id":"er-bombillo-discotequero-multicolor-e27-1989","variante":"Unidad","producto":"Bombillo Discotequero Multicolor E27","tipo":"variedades","costo":7800,"precio":11700,"stock":4,"ref":"1989","categoria":"CACHARRERIA"},{"producto_id":"er-procesador-alimentos-3-en-1-1990","variante":"Unidad","producto":"Procesador Alimentos 3 en 1","tipo":"variedades","costo":18700,"precio":28100,"stock":5,"ref":"1990","categoria":"HOGAR"},{"producto_id":"er-nintendo-game-console-avanzado-r36s-15-mil-juegos-1991","variante":"Unidad","producto":"Nintendo Game Console Avanzado R36S +15 Mil Juegos","tipo":"variedades","costo":105000,"precio":157500,"stock":4,"ref":"1991","categoria":"PROMOCIONES"},{"producto_id":"er-set-le-labo-x3-atomizador-1992","variante":"Unidad","producto":"Set Le Labo X3 + Atomizador","tipo":"variedades","costo":59000,"precio":88500,"stock":5,"ref":"1992","categoria":"PERFUMERIA"},{"producto_id":"er-mouse-gamer-rgb-x6-316","variante":"Unidad","producto":"Mouse Gamer RGB X6","tipo":"tecnologia","costo":11000,"precio":16500,"stock":2,"ref":"1993","categoria":"TECNOLOGIA"},{"producto_id":"er-set-de-frascos-viajeros-x5-ch22575-1995","variante":"Unidad","producto":"Set de Frascos Viajeros X5 CH22575","tipo":"variedades","costo":5800,"precio":8700,"stock":5,"ref":"1995","categoria":"CACHARRERIA"},{"producto_id":"er-maquina-depiladora-corporal-electrica-recargable-1996","variante":"Unidad","producto":"Maquina Depiladora Corporal Electrica Recargable","tipo":"variedades","costo":8000,"precio":12000,"stock":6,"ref":"VARA","categoria":"CACHARRERIA"},{"producto_id":"er-gorra-yeison-jimenez-negrogris-2000","variante":"Unidad","producto":"Gorra Yeison Jimenez Negro/gris","tipo":"variedades","costo":34900,"precio":52400,"stock":2,"ref":"2000","categoria":"PROMOCIONES"},{"producto_id":"er-gorra-fox-hombre-2001","variante":"Unidad","producto":"Gorra Fox Hombre","tipo":"variedades","costo":34900,"precio":52400,"stock":2,"ref":"2001","categoria":"PROMOCIONES"},{"producto_id":"er-hombre-tennis-deportivos-ch14-2004","variante":"Unidad","producto":"Hombre Tennis Deportivos CH14","tipo":"variedades","costo":69000,"precio":103500,"stock":10,"ref":"2004","categoria":"CALZADO NACIONAL"},{"producto_id":"er-mascarilla-de-velo-minnie-only-2006","variante":"Unidad","producto":"Mascarilla de Velo Minnie Only","tipo":"variedades","costo":1000,"precio":1500,"stock":91,"ref":"2006","categoria":"BELLEZA"},{"producto_id":"er-lapiz-cejas-ojos-negro-kiss-beauty-2007","variante":"Unidad","producto":"Lapiz Cejas/ Ojos Negro Kiss Beauty","tipo":"variedades","costo":1350,"precio":2100,"stock":8,"ref":"2007","categoria":"BELLEZA"},{"producto_id":"er-lapiz-de-cejas-ojostono-cafe-kari-2008","variante":"Unidad","producto":"Lapiz de Cejas/ Ojostono Cafe Kari","tipo":"variedades","costo":1350,"precio":2100,"stock":7,"ref":"2008","categoria":"BELLEZA"},{"producto_id":"er-molino-electrico-de-cafe-raf-2013","variante":"Unidad","producto":"Molino Electrico de Cafe Raf","tipo":"variedades","costo":24900,"precio":37400,"stock":5,"ref":"2013","categoria":"HOGAR"},{"producto_id":"er-linterna-con-panel-solar-2014","variante":"Unidad","producto":"Linterna con Panel Solar","tipo":"variedades","costo":26000,"precio":39000,"stock":5,"ref":"2014","categoria":"PROMOCIONES"},{"producto_id":"er-bolsa-para-lavadora-2015","variante":"Unidad","producto":"Bolsa para Lavadora","tipo":"variedades","costo":3900,"precio":5900,"stock":12,"ref":"2015","categoria":"CACHARRERIA"},{"producto_id":"er-maquina-mini-para-tortas-y-ponques-2016","variante":"Unidad","producto":"Maquina Mini para Tortas y Ponques","tipo":"variedades","costo":24900,"precio":37400,"stock":5,"ref":"ROBI","categoria":"HOGAR"}]'::jsonb);

-- Verificación: debe dar 621 filas de Emprende Red, 621 activas
select count(*) as filas, count(*) filter (where activo) as activas, min(precio) as precio_min, max(precio) as precio_max
  from public.catalogo_precios where proveedor = 'emprendered';


-- ######################## wo-048-horario-legal.sql ########################
-- =====================================================================
-- WO-048 · Cola de WhatsApp: horario legal para lo comercial (Ley 2300 de 2023) + avisos que no dependen de una compra
--   1. Solicitudes de reseña y avisos de renovación solo: lunes a viernes 7:00 a. m.–7:00 p. m. y sábados
--      8:00 a. m.–3:00 p. m. (hora de Colombia), nunca domingos ni festivos. Lo transaccional (pago recibido, entrega,
--      código de acceso, orden validada, rastreo…) sale en cualquier momento porque responde a una compra del cliente.
--   2. RENOVACION (wo-044) y RASTREO (wo-047) no se cancelan por "no tener compra": se identifican con la referencia
--      del pedido, no con una compra al proveedor (sin esto, la cola los cancelaba sin enviarlos).
-- Igual que wo-028 y wo-032, se parchea el texto VIGENTE de tomar_notificaciones() (no se pisan esos parches).
-- Festivos de Colombia 2026 y 2027 incluidos. Requiere wo-015b, wo-028 y wo-032. Idempotente.
-- =====================================================================

do $$
begin
    if to_regprocedure('public.tomar_notificaciones(integer)') is null then
        raise exception 'Nada se aplicó. Falta la cola de WhatsApp: aplica antes wo-015b.';
    end if;
end;
$$;

create table if not exists public.festivos_colombia (dia date primary key, nombre text not null);
alter table public.festivos_colombia enable row level security;
revoke all on table public.festivos_colombia from public, anon, authenticated;
insert into public.festivos_colombia (dia, nombre) values
    ('2026-01-01', 'Año Nuevo'), ('2026-01-12', 'Reyes Magos'), ('2026-03-23', 'San José'), ('2026-04-02', 'Jueves Santo'),
    ('2026-04-03', 'Viernes Santo'), ('2026-05-01', 'Día del Trabajo'), ('2026-05-18', 'Ascensión del Señor'), ('2026-06-08', 'Corpus Christi'),
    ('2026-06-15', 'Sagrado Corazón'), ('2026-06-29', 'San Pedro y San Pablo'), ('2026-07-20', 'Independencia'), ('2026-08-07', 'Batalla de Boyacá'),
    ('2026-08-17', 'Asunción de la Virgen'), ('2026-10-12', 'Día de la Raza'), ('2026-11-02', 'Todos los Santos'), ('2026-11-16', 'Independencia de Cartagena'),
    ('2026-12-08', 'Inmaculada Concepción'), ('2026-12-25', 'Navidad'),
    ('2027-01-01', 'Año Nuevo'), ('2027-01-11', 'Reyes Magos'), ('2027-03-22', 'San José'), ('2027-03-25', 'Jueves Santo'),
    ('2027-03-26', 'Viernes Santo'), ('2027-05-01', 'Día del Trabajo'), ('2027-05-10', 'Ascensión del Señor'), ('2027-05-31', 'Corpus Christi'),
    ('2027-06-07', 'Sagrado Corazón'), ('2027-07-05', 'San Pedro y San Pablo'), ('2027-07-20', 'Independencia'), ('2027-08-07', 'Batalla de Boyacá'),
    ('2027-08-16', 'Asunción de la Virgen'), ('2027-10-18', 'Día de la Raza'), ('2027-11-01', 'Todos los Santos'), ('2027-11-15', 'Independencia de Cartagena'),
    ('2027-12-08', 'Inmaculada Concepción'), ('2027-12-25', 'Navidad')
on conflict (dia) do nothing;

create or replace function public.horario_comercial_legal(p_momento timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    with t as (select (p_momento at time zone 'America/Bogota') as l)
    select case
        when exists (select 1 from public.festivos_colombia f, t where f.dia = t.l::date) then false
        when extract(isodow from t.l) between 1 and 5 then t.l::time >= time '07:00' and t.l::time < time '19:00'
        when extract(isodow from t.l) = 6 then t.l::time >= time '08:00' and t.l::time < time '15:00'
        else false
    end
    from t;
$$;
revoke all on function public.horario_comercial_legal(timestamptz) from public, anon, authenticated;
grant execute on function public.horario_comercial_legal(timestamptz) to service_role;

do $$
declare
    def text;
    antes text;
begin
    def := replace(pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure), E'\r\n', E'\n');
    antes := def;
    -- 1) Horario legal para lo comercial
    if position('horario_comercial_legal' in def) = 0 then
        if def !~ 'n\.tipo <> ''SOLICITUD_RESENA'' or \(' then
            raise exception 'Nada se aplicó. No encontré el horario de reseñas en tomar_notificaciones (¿wo-015b modificado?).';
        end if;
        def := regexp_replace(def, 'n\.tipo <> ''SOLICITUD_RESENA'' or \(.*?between 9 and 19\)\)',
            'n.tipo not in (''SOLICITUD_RESENA'', ''RENOVACION'') or public.horario_comercial_legal())');
    end if;
    -- 2) Renovación y rastreo no dependen de una compra al proveedor
    if position('''RASTREO''' in def) = 0 then
        if position('''ADMIN_FALLA'')' in def) = 0 then
            raise exception 'Nada se aplicó. tomar_notificaciones no tiene el parche de wo-032: aplica wo-032-fase3.sql primero.';
        end if;
        def := replace(def, '''ADMIN_FALLA'')', '''ADMIN_FALLA'', ''RENOVACION'', ''RASTREO'')');
    end if;
    if def <> antes then
        execute def;
    end if;
end;
$$;

-- Verificación: domingo false, martes 10 a. m. true, sábado 4 p. m. false, festivo false, y la cola ya parchada
select public.horario_comercial_legal('2026-10-25 10:00-05') as domingo,
       public.horario_comercial_legal('2026-10-20 10:00-05') as martes_10am,
       public.horario_comercial_legal('2026-10-24 16:00-05') as sabado_4pm,
       public.horario_comercial_legal('2026-11-02 10:00-05') as festivo,
       position('horario_comercial_legal' in pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure)) > 0 as cola_con_horario_legal,
       position('''RASTREO''' in pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure)) > 0 as cola_no_cancela_rastreo;


-- ######################## wo-049-netflix-30-dias.sql ########################
-- =====================================================================
-- WO-049 · Netflix: el plan pasa de 26 a 30 días (22/10/2026, ANC cambió la duración; el precio ya estaba al día)
--   Renombra las variantes en catalogo_precios conservando precio, costo y estado. Los pedidos anteriores conservan
--   el nombre con el que se vendieron (su garantía y su renovación se calculan con lo que compró cada cliente).
-- Requiere wo-032 (catalogo_precios). Ejecutar en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.catalogo_precios') is null then
        raise exception 'Nada se aplicó. Falta public.catalogo_precios: aplica antes wo-032-fase3.sql.';
    end if;
end;
$$;

update public.catalogo_precios c
   set variante = replace(c.variante, '26 días', '30 días'), updated_at = now()
 where c.producto_id = 'netflix'
   and c.variante like '%26 días'
   and not exists (select 1 from public.catalogo_precios x
                    where x.producto_id = c.producto_id and x.variante = replace(c.variante, '26 días', '30 días'));

-- Verificación: deben quedar las variantes de Netflix con "30 días" y ninguna con "26 días"
select producto_id, variante, precio, activo from public.catalogo_precios where producto_id = 'netflix' order by variante;


-- ######################## wo-050-disponibilidad.sql ########################
-- =====================================================================
-- WO-050 · Disponibilidad de proveedores: Disponible · Agotado · Retirado (y aviso automático cuando vuelve)
--   1. catalogo_precios.estado_proveedor: DISPONIBLE (se vende), AGOTADO (sigue en el catálogo del proveedor sin
--      unidades: la tienda lo muestra "Agotado") y RETIRADO (el proveedor ya no lo tiene: desaparece).
--   2. sincronizar_proveedor() (Emprende Red, cada 6 h): marca los tres estados y devuelve los REPUESTOS (los que
--      vuelven a tener unidades y están en categorías visibles) para publicar el estado "¡Volvió!" y avisarte.
--   3. marcar_disponibilidad_anc(): lo mismo para ANC (su tienda dice qué planes están agotados). No toca "activo"
--      (lo que pausaste tú en el panel sigue pausado).
--   4. precios_publicos(): devuelve también lo agotado con agotado = true (la tienda lo muestra sin dejar comprarlo).
-- Requiere wo-032 y wo-047. Ejecutar en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.proveedor_categorias') is null or to_regprocedure('public.categoria_visible(text, text)') is null then
        raise exception 'Nada se aplicó. Aplica antes supabase/wo-047-proveedor-y-rastreo.sql.';
    end if;
end;
$$;

alter table public.catalogo_precios
    add column if not exists estado_proveedor text check (estado_proveedor is null or estado_proveedor in ('DISPONIBLE', 'AGOTADO', 'RETIRADO'));
update public.catalogo_precios set estado_proveedor = case when activo then 'DISPONIBLE' else 'AGOTADO' end
 where proveedor = 'emprendered' and estado_proveedor is null;

-- 1) Sincronización de Emprende Red con los tres estados y los repuestos ---------------------------------------
drop function if exists public.sincronizar_proveedor(text, jsonb);
create function public.sincronizar_proveedor(p_proveedor text, p_items jsonb)
returns table (insertados integer, actualizados integer, inactivados integer, repuestos jsonb, agotados jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_ins integer := 0; v_act integer := 0; v_inact integer := 0;
    v_nuevo boolean;
    v_antes text;
    v_stock integer;
    v_rep jsonb := '[]'::jsonb;
    v_ago jsonb := '[]'::jsonb;
    i jsonb;
begin
    if p_proveedor is null or p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'Datos no válidos';
    end if;
    for i in select * from jsonb_array_elements(p_items) loop
        v_stock := coalesce(round((i->>'stock')::numeric)::integer, 0);
        select c.estado_proveedor into v_antes from public.catalogo_precios c
         where c.producto_id = i->>'producto_id' and c.variante = i->>'variante' and c.proveedor = p_proveedor;
        insert into public.catalogo_precios as c (producto_id, variante, producto, tipo, precio, precio_anterior, activo,
                costo_proveedor, plan_proveedor, costo_proveedor_at, proveedor, stock_proveedor, categoria_proveedor, estado_proveedor, updated_at)
        values (i->>'producto_id', i->>'variante', i->>'producto', i->>'tipo', round((i->>'precio')::numeric)::bigint, null,
                v_stock > 0, round((i->>'costo')::numeric)::bigint, p_proveedor || ' ' || coalesce(i->>'ref', ''),
                now(), p_proveedor, v_stock, nullif(left(i->>'categoria', 80), ''), case when v_stock > 0 then 'DISPONIBLE' else 'AGOTADO' end, now())
        on conflict (producto_id, variante) do update
            set producto = excluded.producto, precio = excluded.precio, activo = excluded.activo,
                costo_proveedor = excluded.costo_proveedor, plan_proveedor = excluded.plan_proveedor,
                costo_proveedor_at = now(), proveedor = excluded.proveedor, stock_proveedor = excluded.stock_proveedor,
                categoria_proveedor = coalesce(excluded.categoria_proveedor, c.categoria_proveedor),
                estado_proveedor = excluded.estado_proveedor,
                updated_at = now()
            where c.proveedor = p_proveedor  -- nunca pisa productos propios ni de ANC con el mismo id
        returning (xmax = 0) into v_nuevo;
        if v_nuevo then v_ins := v_ins + 1; elsif v_nuevo is not null then v_act := v_act + 1; end if;
        v_nuevo := null;
        if nullif(i->>'categoria', '') is not null then
            insert into public.proveedor_categorias (proveedor, categoria, visible)
            values (p_proveedor, left(i->>'categoria', 80), false)
            on conflict (proveedor, categoria) do nothing;
        end if;
        -- Volvió: estaba agotado o retirado y ahora tiene unidades (solo si su categoría se muestra)
        if v_stock > 0 and v_antes in ('AGOTADO', 'RETIRADO') and public.categoria_visible(p_proveedor, nullif(i->>'categoria', '')) then
            v_rep := v_rep || jsonb_build_object('producto_id', i->>'producto_id', 'producto', i->>'producto', 'stock', v_stock,
                'precio', round((i->>'precio')::numeric), 'categoria', i->>'categoria');
        elsif v_stock = 0 and v_antes = 'DISPONIBLE' and public.categoria_visible(p_proveedor, nullif(i->>'categoria', '')) then
            v_ago := v_ago || jsonb_build_object('producto_id', i->>'producto_id', 'producto', i->>'producto');
        end if;
    end loop;
    -- Lo que el proveedor ya no trae: RETIRADO (desaparece de la tienda)
    update public.catalogo_precios c set activo = false, stock_proveedor = 0, estado_proveedor = 'RETIRADO', updated_at = now()
     where c.proveedor = p_proveedor and c.estado_proveedor is distinct from 'RETIRADO'
       and not exists (select 1 from jsonb_array_elements(p_items) x where x->>'producto_id' = c.producto_id and x->>'variante' = c.variante);
    get diagnostics v_inact = row_count;
    return query select v_ins, v_act, v_inact, v_rep, v_ago;
end;
$$;
revoke all on function public.sincronizar_proveedor(text, jsonb) from public, anon, authenticated;
grant execute on function public.sincronizar_proveedor(text, jsonb) to service_role;

-- 2) ANC: planes agotados según su tienda ([{producto_id, variante, agotado}]) --------------------------------------
drop function if exists public.marcar_disponibilidad_anc(jsonb);
create function public.marcar_disponibilidad_anc(p_items jsonb)
returns table (cambios integer, repuestos jsonb, agotados jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    i jsonb;
    v_antes text;
    v_nuevo text;
    v_n integer := 0;
    v_rep jsonb := '[]'::jsonb;
    v_ago jsonb := '[]'::jsonb;
    v_prod text;
begin
    if p_items is null or jsonb_typeof(p_items) <> 'array' then
        raise exception 'Datos no válidos';
    end if;
    for i in select * from jsonb_array_elements(p_items) loop
        v_nuevo := case when (i->>'agotado')::boolean then 'AGOTADO' else 'DISPONIBLE' end;
        select c.estado_proveedor, c.producto into v_antes, v_prod from public.catalogo_precios c
         where c.producto_id = i->>'producto_id' and c.variante = i->>'variante' and coalesce(c.proveedor, '') <> 'emprendered';
        if not found or v_antes is not distinct from v_nuevo then continue; end if;
        update public.catalogo_precios c set estado_proveedor = v_nuevo, updated_at = now()
         where c.producto_id = i->>'producto_id' and c.variante = i->>'variante' and coalesce(c.proveedor, '') <> 'emprendered';
        v_n := v_n + 1;
        if v_nuevo = 'DISPONIBLE' and v_antes = 'AGOTADO' then
            v_rep := v_rep || jsonb_build_object('producto_id', i->>'producto_id', 'variante', i->>'variante', 'producto', v_prod);
        elsif v_nuevo = 'AGOTADO' then
            v_ago := v_ago || jsonb_build_object('producto_id', i->>'producto_id', 'variante', i->>'variante', 'producto', v_prod);
        end if;
    end loop;
    return query select v_n, v_rep, v_ago;
end;
$$;
revoke all on function public.marcar_disponibilidad_anc(jsonb) from public, anon, authenticated;
grant execute on function public.marcar_disponibilidad_anc(jsonb) to service_role;

-- 3) Precios públicos con lo agotado (la tienda lo muestra "Agotado"; el bot no lo ofrece) -----------------------
drop function if exists public.precios_publicos();
create function public.precios_publicos()
returns table (producto_id text, variante text, precio bigint, precio_anterior bigint, existencias integer, agotado boolean)
language sql
stable
security definer
set search_path = ''
as $$
    select c.producto_id, c.variante, c.precio, c.precio_anterior,
           case when c.proveedor = 'emprendered' then c.stock_proveedor end,
           (not c.activo) or c.estado_proveedor = 'AGOTADO'
    from public.catalogo_precios c
    where (c.activo or c.estado_proveedor = 'AGOTADO')
      and (c.proveedor is distinct from 'emprendered' or public.categoria_visible(c.proveedor, c.categoria_proveedor));
$$;
revoke all on function public.precios_publicos() from public;
grant execute on function public.precios_publicos() to anon, authenticated, service_role;

-- Verificación
select count(*) filter (where estado_proveedor = 'DISPONIBLE') as disponibles,
       count(*) filter (where estado_proveedor = 'AGOTADO') as agotados,
       count(*) filter (where estado_proveedor = 'RETIRADO') as retirados
  from public.catalogo_precios where proveedor = 'emprendered';
