-- =====================================================================
-- WO-015a · Administradores del panel (partes 1-3 de wo-015.sql, sin la cola de WhatsApp)
-- Para bases donde public.es_admin() existe pero public.administradores no: el panel abre,
-- pero la base rechaza todo ("Solo el administrador puede…").
-- Ejecutar completo en Supabase → SQL Editor. Es idempotente.
--
-- Admin = la cuenta de Supabase Auth (correo + contraseña con la que entras a /admin),
-- no el número de WhatsApp.
-- =====================================================================

-- 0) CORREO DE LA CUENTA ADMIN: cámbialo si en Ajustes del panel aparece otro ----------
create temp table if not exists _admin_correo (email text);
truncate _admin_correo;
insert into _admin_correo values (lower('dclancherosa@gmail.com'));

-- Verificación previa: si la cuenta no existe en auth.users, no se aplica nada
do $$
declare
    v_correo text := (select email from _admin_correo);
    v_cuentas text;
begin
    if not exists (select 1 from auth.users u where lower(u.email) = v_correo) then
        select string_agg(u.email, ', ' order by u.created_at) into v_cuentas from auth.users u;
        raise exception 'Nada se aplicó. No existe la cuenta % en Authentication → Users. Cuentas existentes: %. Cambia el correo del paso 0.',
            v_correo, coalesce(v_cuentas, '(ninguna)');
    end if;
end;
$$;

-- 1) ADMINISTRADORES -----------------------------------------------------
create table if not exists public.administradores (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    email      text,
    created_at timestamptz not null default now()
);
alter table public.administradores enable row level security;
revoke all on table public.administradores from anon, authenticated;

insert into public.administradores (user_id, email)
select u.id, u.email from auth.users u join _admin_correo c on lower(u.email) = c.email
on conflict (user_id) do nothing;

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (select 1 from public.administradores a where a.user_id = auth.uid());
$$;
revoke all on function public.es_admin() from public;
grant execute on function public.es_admin() to anon, authenticated;

-- 2) LAS FUNCIONES DE ADMIN EXIGEN es_admin() ----------------------------
-- Se reescribe la comprobación en las funciones YA instaladas (wo-012 / wo-014 ya traen el cambio
-- para futuras ejecuciones).
do $$
declare
    f   text;
    def text;
begin
    foreach f in array array[
        'public.validar_pago(text, text, text, numeric, text)',
        'public.rechazar_pago(text, text)',
        'public.pagos_pendientes()',
        'public.canjear_cupon(text, text)'
    ] loop
        if to_regprocedure(f) is null then
            raise notice 'No existe %, se omite.', f;
            continue;
        end if;
        def := pg_get_functiondef(f::regprocedure);
        def := replace(def, $r$auth.role() <> 'authenticated'$r$, 'not public.es_admin()');
        def := replace(def, $r$auth.role() = 'authenticated'$r$, 'public.es_admin()');
        execute def;
    end loop;
end;
$$;

-- Supabase da EXECUTE a anon por defecto en funciones nuevas: se retira en las de admin
revoke execute on function public.validar_pago(text, text, text, numeric, text) from anon;
revoke execute on function public.rechazar_pago(text, text) from anon;
revoke execute on function public.pagos_pendientes() from anon;
revoke execute on function public.canjear_cupon(text, text) from anon;

-- 3) RLS RESTRICTIVA: un usuario autenticado que no sea admin no ve ni toca nada ------
-- Se SUMA (AND) a las políticas que ya existan. No activa RLS donde esté desactivada
-- (eso podría bloquear al panel): esas tablas se listan al final para revisarlas.
do $$
declare
    t text;
begin
    foreach t in array array['compras_proveedor', 'pagos', 'cupones', 'metodos_pago'] loop
        if to_regclass('public.' || t) is not null then
            execute format('drop policy if exists solo_admin on public.%I', t);
            execute format(
                'create policy solo_admin on public.%I as restrictive for all to authenticated '
                'using (public.es_admin()) with check (public.es_admin())', t);
        end if;
    end loop;
end;
$$;

-- 4) RESULTADO: qué cuentas existen y cuáles quedaron como administradoras -----------
select u.email, u.created_at, (a.user_id is not null) as es_admin
from auth.users u left join public.administradores a on a.user_id = u.id
order by u.created_at;
