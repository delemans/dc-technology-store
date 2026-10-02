-- =====================================================================
-- WO-025 · Promociones del día
-- Requiere: wo-015.sql (public.es_admin()). Idempotente.
-- Aplicar: node herramientas/configurar-supabase.js --aplicar --archivo supabase/wo-025-promociones.sql
--
-- Por qué una tabla y no una columna en public.productos: la tienda publica el catálogo desde
-- productos.json (la vista v_catalogo_publico está vacía), así que la marca debe usar el MISMO id
-- que ve el cliente (p. ej. 'netflix', 'office-365'). Si algún día el catálogo vive en la tabla
-- productos, basta con apuntar producto_id a esa tabla.
--
-- "Del día": cada promoción vence sola a la medianoche de Colombia (o a la fecha que elija el admin),
-- así la cuenta regresiva de la tienda siempre dice la verdad.
-- =====================================================================

create table if not exists public.promociones_dia (
    producto_id  text primary key check (producto_id ~ '^[a-z0-9-]{2,120}$'),
    activa       boolean not null default true,
    vence_at     timestamptz not null,
    orden        smallint not null default 0,
    actualizado_por uuid,
    updated_at   timestamptz not null default now()
);

alter table public.promociones_dia enable row level security;
revoke all on table public.promociones_dia from anon;
revoke insert, update, delete on table public.promociones_dia from authenticated; -- solo vía RPC
drop policy if exists promociones_lectura_admin on public.promociones_dia;
create policy promociones_lectura_admin on public.promociones_dia
    for select to authenticated using (public.es_admin());

-- Medianoche de hoy en Colombia (fin del "día" de la promoción)
create or replace function public.fin_del_dia_bogota()
returns timestamptz
language sql
stable
set search_path = ''
as $$
    select (date_trunc('day', now() at time zone 'America/Bogota') + interval '1 day' - interval '1 second') at time zone 'America/Bogota';
$$;

-- Público: ids vigentes (la tienda los cruza con productos.json; no expone nada más)
drop function if exists public.promociones_del_dia();
create function public.promociones_del_dia()
returns table (producto_id text, vence_at timestamptz, orden smallint)
language sql
stable
security definer
set search_path = ''
as $$
    select p.producto_id, p.vence_at, p.orden
    from public.promociones_dia p
    where p.activa and p.vence_at > now()
    order by p.orden, p.updated_at desc
    limit 12;
$$;
revoke all on function public.promociones_del_dia() from public;
grant execute on function public.promociones_del_dia() to anon, authenticated;

-- Admin: activa / desactiva. p_vence null = hasta la medianoche de hoy (Colombia).
drop function if exists public.alternar_promocion(text, boolean, timestamptz);
create function public.alternar_promocion(p_producto_id text, p_activa boolean, p_vence timestamptz default null)
returns table (ok boolean, mensaje text, vence_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_vence timestamptz := coalesce(p_vence, public.fin_del_dia_bogota());
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede cambiar promociones.', null::timestamptz;
        return;
    end if;
    if p_producto_id is null or p_producto_id !~ '^[a-z0-9-]{2,120}$' then
        return query select false, 'Producto inválido.', null::timestamptz;
        return;
    end if;
    if p_activa and v_vence <= now() then
        return query select false, 'La fecha de vencimiento ya pasó.', null::timestamptz;
        return;
    end if;
    -- (alias x: 'vence_at' también es el nombre de una columna de salida → evita la ambigüedad)
    if p_activa and (select count(*) from public.promociones_dia x
                     where x.activa and x.vence_at > now() and x.producto_id <> p_producto_id) >= 12 then
        return query select false, 'Máximo 12 promociones a la vez: desactiva alguna primero.', null::timestamptz;
        return;
    end if;

    insert into public.promociones_dia (producto_id, activa, vence_at, actualizado_por, updated_at)
    values (p_producto_id, p_activa, v_vence, auth.uid(), now())
    on conflict (producto_id) do update
       set activa = excluded.activa,
           vence_at = case when excluded.activa then excluded.vence_at else public.promociones_dia.vence_at end,
           actualizado_por = excluded.actualizado_por,
           updated_at = now();

    return query select true, case when p_activa then 'Promoción activada.' else 'Promoción desactivada.' end,
                        case when p_activa then v_vence end;
end;
$$;
revoke all on function public.alternar_promocion(text, boolean, timestamptz) from public, anon;
grant execute on function public.alternar_promocion(text, boolean, timestamptz) to authenticated;

-- Verificación
select to_regprocedure('public.promociones_del_dia()') is not null as rpc_publica,
       to_regprocedure('public.alternar_promocion(text, boolean, timestamptz)') is not null as rpc_admin;
