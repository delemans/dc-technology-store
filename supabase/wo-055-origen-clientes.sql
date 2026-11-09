-- =====================================================================
-- WO-055 · De qué red llegó cada cliente (T05)
--   1. Columna origen en ordenes_web (tiktok, youtube, facebook, instagram, google, estado; vacía = directo).
--   2. marcar_origen_orden(codigo, secreto, origen): la tienda la llama justo después de crear la orden
--      (crear_orden_web no cambia: su firma y sus parches siguen iguales). Solo con el secreto de la orden,
--      solo la primera hora y solo si aún no tiene origen.
--   3. ventas_por_origen(desde, hasta): órdenes web y lo cobrado por origen (vista Finanzas, solo administradores).
-- Requiere wo-028 (hash_portal), wo-030 (ordenes_web) y wo-015 (es_admin). Idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.ordenes_web') is null or to_regprocedure('public.hash_portal(text, text)') is null then
        raise exception 'Nada se aplicó. Faltan las órdenes web: aplica antes wo-028 y wo-030.';
    end if;
    if to_regprocedure('public.es_admin()') is null then
        raise exception 'Nada se aplicó. Falta es_admin(): aplica antes wo-015.';
    end if;
end;
$$;

-- 1) Columna ------------------------------------------------------------------------------------------------
alter table public.ordenes_web add column if not exists origen text;
alter table public.ordenes_web drop constraint if exists ordenes_web_origen_check;
alter table public.ordenes_web add constraint ordenes_web_origen_check
    check (origen is null or origen in ('tiktok', 'youtube', 'facebook', 'instagram', 'google', 'estado'));

-- 2) La tienda marca el origen de su orden ---------------------------------------------------------------------
drop function if exists public.marcar_origen_orden(text, text, text);
create function public.marcar_origen_orden(p_codigo text, p_secreto text, p_origen text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_origen text := lower(btrim(coalesce(p_origen, '')));
begin
    if v_origen not in ('tiktok', 'youtube', 'facebook', 'instagram', 'google', 'estado') then
        return false;
    end if;
    update public.ordenes_web o
       set origen = v_origen
     where o.codigo = upper(btrim(coalesce(p_codigo, '')))
       and o.secreto_hash = public.hash_portal(coalesce(p_secreto, ''), 'orden')
       and o.origen is null
       and o.created_at > now() - interval '1 hour';
    return found;
end;
$$;
revoke all on function public.marcar_origen_orden(text, text, text) from public;
grant execute on function public.marcar_origen_orden(text, text, text) to anon, authenticated;

-- 3) Ventas por origen (Finanzas) ------------------------------------------------------------------------------
drop function if exists public.ventas_por_origen(timestamptz, timestamptz);
create function public.ventas_por_origen(p_desde timestamptz, p_hasta timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not coalesce(public.es_admin(), false) then
        raise exception 'Solo administradores.' using errcode = '42501';
    end if;
    return coalesce((
        select jsonb_agg(jsonb_build_object('origen', x.origen, 'ordenes', x.ordenes, 'pagadas', x.pagadas, 'cobrado', x.cobrado)
                         order by x.cobrado desc, x.ordenes desc)
          from (
            select coalesce(o.origen, 'directo') as origen,
                   count(*) as ordenes,
                   count(*) filter (where o.estado = 'VALIDADO') as pagadas,
                   coalesce(sum(coalesce(o.total_servidor, o.total_declarado)) filter (where o.estado = 'VALIDADO'), 0) as cobrado
              from public.ordenes_web o
             where o.created_at >= coalesce(p_desde, now() - interval '30 days')
               and o.created_at < coalesce(p_hasta, now() + interval '1 day')
             group by 1
          ) x), '[]'::jsonb);
end;
$$;
revoke all on function public.ventas_por_origen(timestamptz, timestamptz) from public, anon;
grant execute on function public.ventas_por_origen(timestamptz, timestamptz) to authenticated;

-- Verificación
select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ordenes_web' and column_name = 'origen') as ok_columna,
       to_regprocedure('public.marcar_origen_orden(text, text, text)') is not null as ok_marcar,
       to_regprocedure('public.ventas_por_origen(timestamptz, timestamptz)') is not null as ok_finanzas;
