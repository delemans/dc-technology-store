-- =====================================================================
-- WO-057 · Gastos fijos y punto de equilibrio (T08): lo que pagas cada mes (internet, hosting, contador, arriendo…)
-- para que Finanzas muestre la utilidad real (margen − gastos) y cuántos pedidos necesitas para cubrirlos.
--   gastos_fijos_panel(), guardar_gasto_fijo(): solo administradores. Los valores los escribes tú (nada se inventa).
-- Requiere wo-015 (es_admin). Idempotente.
-- =====================================================================

do $$
begin
    if to_regprocedure('public.es_admin()') is null then
        raise exception 'Nada se aplicó. Falta es_admin(): aplica antes wo-015.';
    end if;
end;
$$;

create table if not exists public.gastos_fijos (
    id             bigint generated always as identity primary key,
    nombre         text not null check (length(btrim(nombre)) between 2 and 60),
    valor_mensual  bigint not null check (valor_mensual between 0 and 1000000000),
    activo         boolean not null default true,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);
alter table public.gastos_fijos enable row level security;
revoke all on table public.gastos_fijos from public, anon, authenticated;

drop function if exists public.gastos_fijos_panel();
create function public.gastos_fijos_panel()
returns table (id bigint, nombre text, valor_mensual bigint, activo boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
    if not coalesce(public.es_admin(), false) then raise exception 'Solo administradores.' using errcode = '42501'; end if;
    return query select g.id, g.nombre, g.valor_mensual, g.activo from public.gastos_fijos g order by g.activo desc, g.valor_mensual desc, g.id;
end;
$$;
revoke all on function public.gastos_fijos_panel() from public, anon;
grant execute on function public.gastos_fijos_panel() to authenticated;

-- p_id null = nuevo; con p_id = editar (o pausar con p_activo = false)
drop function if exists public.guardar_gasto_fijo(bigint, text, bigint, boolean);
create function public.guardar_gasto_fijo(p_id bigint, p_nombre text, p_valor bigint, p_activo boolean default true)
returns table (ok boolean, mensaje text, id bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_nombre text := btrim(coalesce(p_nombre, ''));
    v_id bigint;
begin
    if not coalesce(public.es_admin(), false) then raise exception 'Solo administradores.' using errcode = '42501'; end if;
    if length(v_nombre) not between 2 and 60 then return query select false, 'Escribe el nombre del gasto (2 a 60 letras).'::text, null::bigint; return; end if;
    if p_valor is null or p_valor < 0 or p_valor > 1000000000 then return query select false, 'Escribe el valor mensual en pesos.'::text, null::bigint; return; end if;
    if p_id is null then
        insert into public.gastos_fijos (nombre, valor_mensual, activo) values (v_nombre, p_valor, coalesce(p_activo, true)) returning gastos_fijos.id into v_id;
        return query select true, 'Gasto agregado.'::text, v_id; return;
    end if;
    update public.gastos_fijos g set nombre = v_nombre, valor_mensual = p_valor, activo = coalesce(p_activo, true), updated_at = now()
     where g.id = p_id returning g.id into v_id;
    if v_id is null then return query select false, 'Ese gasto no existe.'::text, null::bigint; return; end if;
    return query select true, 'Gasto actualizado.'::text, v_id;
end;
$$;
revoke all on function public.guardar_gasto_fijo(bigint, text, bigint, boolean) from public, anon;
grant execute on function public.guardar_gasto_fijo(bigint, text, bigint, boolean) to authenticated;

-- Verificación
select to_regclass('public.gastos_fijos') is not null as ok_tabla,
       to_regprocedure('public.guardar_gasto_fijo(bigint, text, bigint, boolean)') is not null as ok_guardar;
