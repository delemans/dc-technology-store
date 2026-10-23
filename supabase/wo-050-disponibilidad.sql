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
