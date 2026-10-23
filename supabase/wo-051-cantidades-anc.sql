-- WO-051 (23/10/2026): cantidades de ANC. Su tienda pública publica cuántas unidades quedan de cada plan o producto
-- (null = sin límite). n8n («Leer precios ANC», cada 6 h) las manda en marcar_disponibilidad_anc y la tienda muestra
-- «Quedan N» y no deja pedir más de lo que hay; el bot tampoco ofrece más. Emprende Red no cambia.
-- Requiere wo-050. Idempotente.

do $$
begin
    if to_regprocedure('public.marcar_disponibilidad_anc(jsonb)') is null or to_regprocedure('public.precios_publicos()') is null then
        raise exception 'Nada se aplicó: primero aplica wo-050-disponibilidad.sql';
    end if;
end $$;

alter table public.catalogo_precios add column if not exists stock_anc integer;
comment on column public.catalogo_precios.stock_anc is 'Unidades que publica ANC para ese plan (null = sin límite o sin dato). Solo lo escribe marcar_disponibilidad_anc.';

-- 1) ANC: disponibilidad + cantidad ([{producto_id, variante, agotado, stock?}]) ----------------------------------
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
    v_stock integer;
    v_stock_antes integer;
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
        -- Cantidad: número ≥ 0 si ANC la publica; agotado = 0; si no viene, sin límite (null)
        v_stock := case when v_nuevo = 'AGOTADO' then 0
                        when jsonb_typeof(i->'stock') = 'number' then greatest(0, round((i->>'stock')::numeric)::integer)
                        else null end;
        select c.estado_proveedor, c.producto, c.stock_anc into v_antes, v_prod, v_stock_antes from public.catalogo_precios c
         where c.producto_id = i->>'producto_id' and c.variante = i->>'variante' and coalesce(c.proveedor, '') <> 'emprendered';
        if not found then continue; end if;
        if v_antes is not distinct from v_nuevo and v_stock_antes is not distinct from v_stock then continue; end if;
        update public.catalogo_precios c set estado_proveedor = v_nuevo, stock_anc = v_stock, updated_at = now()
         where c.producto_id = i->>'producto_id' and c.variante = i->>'variante' and coalesce(c.proveedor, '') <> 'emprendered';
        v_n := v_n + 1;
        if v_nuevo = 'DISPONIBLE' and v_antes = 'AGOTADO' then
            v_rep := v_rep || jsonb_build_object('producto_id', i->>'producto_id', 'variante', i->>'variante', 'producto', v_prod, 'stock', v_stock);
        elsif v_nuevo = 'AGOTADO' and v_antes is distinct from 'AGOTADO' then
            v_ago := v_ago || jsonb_build_object('producto_id', i->>'producto_id', 'variante', i->>'variante', 'producto', v_prod);
        end if;
    end loop;
    return query select v_n, v_rep, v_ago;
end;
$$;
revoke all on function public.marcar_disponibilidad_anc(jsonb) from public, anon, authenticated;
grant execute on function public.marcar_disponibilidad_anc(jsonb) to service_role;

-- 2) Precios públicos: existencias de Emprende Red y ahora también de ANC ------------------------------------------
drop function if exists public.precios_publicos();
create function public.precios_publicos()
returns table (producto_id text, variante text, precio bigint, precio_anterior bigint, existencias integer, agotado boolean)
language sql
stable
security definer
set search_path = ''
as $$
    select c.producto_id, c.variante, c.precio, c.precio_anterior,
           case when c.proveedor = 'emprendered' then c.stock_proveedor else c.stock_anc end,
           (not c.activo) or c.estado_proveedor = 'AGOTADO'
    from public.catalogo_precios c
    where (c.activo or c.estado_proveedor = 'AGOTADO')
      and (c.proveedor is distinct from 'emprendered' or public.categoria_visible(c.proveedor, c.categoria_proveedor));
$$;
revoke all on function public.precios_publicos() from public;
grant execute on function public.precios_publicos() to anon, authenticated, service_role;

-- Verificación
select count(*) filter (where stock_anc is not null) as planes_anc_con_cantidad,
       count(*) filter (where coalesce(proveedor, '') <> 'emprendered') as planes_no_emprendered
  from public.catalogo_precios;
