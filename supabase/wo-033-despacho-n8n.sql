-- =====================================================================
-- WO-033 · Arranque automático de la compra al proveedor para órdenes web (n8n)
-- Requiere: wo-032-fase3.sql. Idempotente.
--
-- n8n arranca UNA orden por ejecución (cada compra al proveedor vive en su propia ejecución con sus
-- esperas). Por eso tomar_despachos() entrega una sola orden por llamada. Si n8n la tomó pero no
-- alcanzó a arrancarla (sin espera activa a los 15 minutos), se vuelve a entregar.
-- =====================================================================

do $$
begin
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'triangulaciones' and column_name = 'origen_web') then
        raise exception 'Nada se aplicó. Falta wo-032-fase3.sql (triangulaciones.origen_web).';
    end if;
end;
$$;

drop function if exists public.tomar_despachos();
create function public.tomar_despachos()
returns table (referencia text, cliente text, cliente_nombre text, producto text, variante text, precio_venta numeric, es_combo boolean, lineas jsonb)
language sql
volatile
security definer
set search_path = ''
as $$
    with elegida as (
        select t.id from public.triangulaciones t
        where t.origen_web and t.grupo is null and t.estado = 'COTIZANDO' and t.resume_url is null
          and (t.iniciada_at is null or t.iniciada_at < now() - interval '15 minutes')
        order by t.iniciada_at nulls first, t.id
        limit 1
        for update skip locked
    )
    update public.triangulaciones t set iniciada_at = now()
      from elegida e where t.id = e.id
    returning t.referencia, t.cliente, t.cliente_nombre, t.producto, t.variante, t.precio_venta, t.es_combo, t.lineas;
$$;
revoke all on function public.tomar_despachos() from public, anon, authenticated;
grant execute on function public.tomar_despachos() to service_role;

select to_regprocedure('public.tomar_despachos()') is not null as despacho_listo;
