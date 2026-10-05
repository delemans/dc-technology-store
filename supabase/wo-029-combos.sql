-- =====================================================================
-- WO-029 · Descuento por combo (portal de clientes, decisión 4 del WO-028)
-- Requiere: wo-015.sql (public.es_admin()). Idempotente.
-- Aplicar: node herramientas/configurar-supabase.js --aplicar --archivo supabase/wo-029-combos.sql
--
-- Regla: un combo es un grupo de plataformas DISTINTAS comprado en un solo pedido. Se aplica la regla
-- activa con el mayor "mínimo de plataformas" que el combo alcance (2 = 10 %, 3 o más = 15 % al inicio).
-- El administrador las cambia desde el panel (Promociones → Descuento por combo); la tienda nunca
-- trae porcentajes escritos en el código: los lee de aquí.
-- El cupón NO se acumula con el combo: aplica solo a los productos que van fuera de combos.
-- =====================================================================

create table if not exists public.reglas_combo (
    min_plataformas smallint primary key check (min_plataformas between 2 and 10),
    descuento_pct   numeric(5, 2) not null check (descuento_pct > 0 and descuento_pct <= 50),
    activa          boolean not null default true,
    actualizado_por uuid,
    updated_at      timestamptz not null default now()
);

alter table public.reglas_combo enable row level security;
revoke all on table public.reglas_combo from anon;
revoke insert, update, delete on table public.reglas_combo from authenticated; -- solo vía RPC
drop policy if exists reglas_combo_lectura_admin on public.reglas_combo;
create policy reglas_combo_lectura_admin on public.reglas_combo
    for select to authenticated using (public.es_admin());

-- Reglas iniciales aprobadas por el director (no pisa cambios hechos después desde el panel)
insert into public.reglas_combo (min_plataformas, descuento_pct) values (2, 10), (3, 15)
on conflict (min_plataformas) do nothing;

-- Público: reglas activas (la tienda y el portal calculan el descuento con esto)
drop function if exists public.reglas_combo_publicas();
create function public.reglas_combo_publicas()
returns table (min_plataformas smallint, descuento_pct numeric)
language sql
stable
security definer
set search_path = ''
as $$
    select r.min_plataformas, r.descuento_pct
    from public.reglas_combo r
    where r.activa
    order by r.min_plataformas;
$$;
revoke all on function public.reglas_combo_publicas() from public;
grant execute on function public.reglas_combo_publicas() to anon, authenticated;

-- Porcentaje que corresponde a N plataformas distintas (0 si ninguna regla aplica).
-- Para validar en el servidor / n8n el descuento que muestra el pedido.
drop function if exists public.descuento_combo(integer);
create function public.descuento_combo(p_plataformas integer)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((
        select r.descuento_pct from public.reglas_combo r
        where r.activa and r.min_plataformas <= coalesce(p_plataformas, 0)
        order by r.min_plataformas desc
        limit 1), 0);
$$;
revoke all on function public.descuento_combo(integer) from public;
grant execute on function public.descuento_combo(integer) to anon, authenticated, service_role;

-- Admin: crear / cambiar una regla
drop function if exists public.guardar_regla_combo(integer, numeric, boolean);
create function public.guardar_regla_combo(p_min integer, p_pct numeric, p_activa boolean default true)
returns table (ok boolean, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede cambiar los descuentos de combo.';
        return;
    end if;
    if p_min is null or p_min < 2 or p_min > 10 then
        return query select false, 'El mínimo de plataformas va de 2 a 10.';
        return;
    end if;
    if p_pct is null or p_pct <= 0 or p_pct > 50 then
        return query select false, 'El descuento va de 0,1 % a 50 %.';
        return;
    end if;
    insert into public.reglas_combo as r (min_plataformas, descuento_pct, activa, actualizado_por, updated_at)
    values (p_min, round(p_pct, 2), coalesce(p_activa, true), auth.uid(), now())
    on conflict (min_plataformas) do update
        set descuento_pct = excluded.descuento_pct, activa = excluded.activa,
            actualizado_por = excluded.actualizado_por, updated_at = now();
    return query select true, format('Combo de %s+ plataformas: %s %% %s.', p_min, round(p_pct, 2), case when coalesce(p_activa, true) then 'activo' else 'pausado' end);
end;
$$;
revoke all on function public.guardar_regla_combo(integer, numeric, boolean) from public, anon;
grant execute on function public.guardar_regla_combo(integer, numeric, boolean) to authenticated;

-- Admin: borrar una regla
drop function if exists public.eliminar_regla_combo(integer);
create function public.eliminar_regla_combo(p_min integer)
returns table (ok boolean, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede cambiar los descuentos de combo.';
        return;
    end if;
    delete from public.reglas_combo r where r.min_plataformas = p_min;
    if not found then
        return query select false, 'Esa regla ya no existe.';
        return;
    end if;
    return query select true, format('Regla de %s+ plataformas eliminada.', p_min);
end;
$$;
revoke all on function public.eliminar_regla_combo(integer) from public, anon;
grant execute on function public.eliminar_regla_combo(integer) to authenticated;

-- Verificación
select min_plataformas, descuento_pct, activa from public.reglas_combo order by min_plataformas;
