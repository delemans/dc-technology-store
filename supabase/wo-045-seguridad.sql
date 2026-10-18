-- =====================================================================
-- WO-045 · Endurecimiento de permisos de public.metodos_pago (solo administradores y funciones del servidor)
-- Qué hace:
--   1. Activa RLS en metodos_pago (si estaba apagada).
--   2. Quita toda política que dé acceso a anon o a public, y deja una sola política: administradores.
--   3. Revoca los permisos de tabla de anon (doble seguro).
-- No cambia nada visible: la tienda usa metodos_pago_publicos() (sin números) y los datos de pago llegan al
-- crear la orden (crear_orden_web, security definer); el bot y n8n usan la credencial de servicio.
-- Requiere wo-015 (es_admin). Ejecutar en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.metodos_pago') is null then
        raise exception 'Nada se aplicó. No existe la tabla public.metodos_pago.';
    end if;
    if to_regprocedure('public.es_admin()') is null then
        raise exception 'Nada se aplicó. Falta es_admin(): aplica antes wo-015.';
    end if;
end;
$$;

alter table public.metodos_pago enable row level security;

do $$
declare
    p record;
begin
    -- Fuera las políticas que abren la tabla a anon / public (las del panel quedan en la política nueva)
    for p in select policyname from pg_policies
              where schemaname = 'public' and tablename = 'metodos_pago'
                and policyname not in ('solo_admin', 'admin_gestiona_metodos')
                and (roles && array['anon', 'public']::name[]) loop
        execute format('drop policy %I on public.metodos_pago', p.policyname);
    end loop;
end;
$$;

drop policy if exists admin_gestiona_metodos on public.metodos_pago;
create policy admin_gestiona_metodos on public.metodos_pago
    for all to authenticated using (public.es_admin()) with check (public.es_admin());

revoke all on table public.metodos_pago from anon;

-- Verificación: debe decir false en anon_puede_leer y true en rls_activa
select has_table_privilege('anon', 'public.metodos_pago', 'select') as anon_puede_leer,
       (select relrowsecurity from pg_class where oid = 'public.metodos_pago'::regclass) as rls_activa,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'metodos_pago') as politicas;
