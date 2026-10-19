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
