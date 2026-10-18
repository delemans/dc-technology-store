-- =====================================================================
-- APLICAR PENDIENTES (19/10/2026): wo-042 → wo-043 → wo-044 → wo-025 → wo-045
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
