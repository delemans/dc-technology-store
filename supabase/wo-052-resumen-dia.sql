-- WO-052 · Resumen de ventas del día (lo envía el bot al director a las 8 p. m.)
-- Requiere wo-046 (centro financiero): usa el mismo cálculo de venta, costo y "pagado" que finanzas_panel().
-- Idempotente: se puede aplicar varias veces. Solo el servidor (n8n) puede llamarla.

do $$
begin
    if to_regprocedure('public.finanzas_panel(timestamptz, timestamptz)') is null then
        raise exception 'Nada se aplicó: primero aplica supabase/wo-046 (centro financiero).';
    end if;
end;
$$;

drop function if exists public.resumen_ventas_dia(date);
create function public.resumen_ventas_dia(p_fecha date default (now() at time zone 'America/Bogota')::date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_desde timestamptz := (p_fecha::timestamp) at time zone 'America/Bogota';
    v_hasta timestamptz := ((p_fecha + 1)::timestamp) at time zone 'America/Bogota';
    v_dia jsonb;
    v_top jsonb;
    v_cobrar jsonb := jsonb_build_object('cantidad', 0, 'total', 0);
begin
    with m as (
        select t.producto,
               coalesce(t.precio_venta, 0) as venta,
               coalesce((select nullif(to_jsonb(c) ->> 'costo_real_cop', '')::numeric
                           from public.compras_proveedor c where c.id::text = t.compra_id), t.costo_proveedor, 0) as costo,
               t.estado = 'ENTREGADO' as entregado,
               (t.estado in ('ESPERANDO_CREDENCIALES', 'ENTREGADO') or (t.origen_web and t.estado = 'REVISION_MANUAL')) as pagado
          from public.triangulaciones t
         where not coalesce(t.es_combo, false)
           and t.created_at >= v_desde and t.created_at < v_hasta
    )
    select jsonb_build_object(
               'pedidos', count(*),
               'pagados', count(*) filter (where pagado),
               'entregados', count(*) filter (where entregado),
               'venta', coalesce(sum(venta) filter (where pagado), 0),
               'costo', coalesce(sum(costo) filter (where pagado), 0)),
           (select coalesce(jsonb_agg(x order by x.cantidad desc, x.venta desc), '[]'::jsonb)
              from (select producto, count(*) as cantidad, sum(venta) as venta
                      from m where pagado group by producto
                     order by count(*) desc, sum(venta) desc limit 3) x)
      into v_dia, v_top
      from m;

    if to_regclass('public.ordenes_web') is not null then
        select jsonb_build_object('cantidad', count(*), 'total', coalesce(sum(o.total_declarado), 0)) into v_cobrar
          from public.ordenes_web o
         where o.estado in ('ESPERANDO_PAGO', 'COMPROBANTE_RECIBIDO')
           and o.created_at > now() - interval '24 hours';
    end if;

    return v_dia
        || jsonb_build_object('fecha', p_fecha,
                              'margen', (v_dia ->> 'venta')::numeric - (v_dia ->> 'costo')::numeric,
                              'por_cobrar', v_cobrar,
                              'top', v_top);
end;
$$;

revoke all on function public.resumen_ventas_dia(date) from public, anon, authenticated;
grant execute on function public.resumen_ventas_dia(date) to service_role;
