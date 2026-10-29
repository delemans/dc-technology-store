-- WO-053 · Pagos por revisar (T02): el bot avisa al director de comprobantes sin validar (> 30 min)
-- y de pedidos sin pago (> 24 h). Requiere wo-030 (ordenes_web) y wo-026 (triangulaciones).
-- Idempotente. Solo el servidor (n8n) puede llamarla.

do $$
begin
    if to_regclass('public.ordenes_web') is null or to_regclass('public.triangulaciones') is null then
        raise exception 'Nada se aplicó: primero aplica wo-030 (comprobantes) y wo-026 (triangulación).';
    end if;
end;
$$;

drop function if exists public.pagos_por_revisar();
create function public.pagos_por_revisar()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        -- Comprobante subido en la web y aún sin #ok / #no (updated_at = cuando llegó el comprobante)
        'comprobantes', coalesce((
            select jsonb_agg(jsonb_build_object('referencia', o.codigo, 'total', o.total_declarado, 'desde', o.updated_at) order by o.updated_at)
              from public.ordenes_web o
             where o.estado = 'COMPROBANTE_RECIBIDO'
               and o.updated_at < now() - interval '30 minutes'
               and o.updated_at > now() - interval '7 days'), '[]'::jsonb),
        -- Pedidos sin pagar hace más de 24 h (la web vence sola a las 72 h; el chat queda en REVISION_MANUAL)
        'sin_pago', coalesce((
            select jsonb_agg(x order by x.desde)
              from (
                select o.codigo as referencia, o.total_declarado as total, o.created_at as desde, 'web' as canal
                  from public.ordenes_web o
                 where o.estado = 'ESPERANDO_PAGO'
                   and o.created_at < now() - interval '24 hours'
                   and o.created_at > now() - interval '72 hours'
                union all
                select t.referencia, t.precio_venta, t.created_at, 'whatsapp'
                  from public.triangulaciones t
                 where t.estado = 'REVISION_MANUAL'
                   and not coalesce(t.origen_web, false)
                   and t.grupo is null  -- un combo sale una vez (el pedido principal), no cada parte
                   and t.created_at < now() - interval '24 hours'
                   and t.created_at > now() - interval '7 days'
              ) x), '[]'::jsonb)
    );
$$;

revoke all on function public.pagos_por_revisar() from public, anon, authenticated;
grant execute on function public.pagos_por_revisar() to service_role;
