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
