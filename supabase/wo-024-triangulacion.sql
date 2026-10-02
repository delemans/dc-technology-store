-- =====================================================================
-- WO-024 · Triangulación con el proveedor para productos digitales
-- Requiere: wo-015.sql (public.es_admin()). Idempotente.
-- Aplicar:  node herramientas/configurar-supabase.js --aplicar --archivo supabase/wo-024-triangulacion.sql
--
-- Una fila por pedido digital que el bot gestiona con el proveedor (ALL NECESSARY COLOMBIA):
--   COTIZANDO → ESPERANDO_PAGO_ADMIN → ESPERANDO_CREDENCIALES → (REVISION_MANUAL) → ENTREGADO
--   o CANCELADO / VENCIDO / AGOTADO.
-- n8n escribe con su credencial de servidor; el panel solo lee (es_admin).
-- resume_url = URL del nodo Wait de n8n que espera el siguiente evento de ESE pedido.
-- Nunca se guarda la credencial completa: solo sus últimos 4 caracteres.
-- =====================================================================

create table if not exists public.triangulaciones (
    id                bigint generated always as identity primary key,
    referencia        text not null unique check (referencia ~ '^DC-[A-Z0-9]{4,8}$'),
    cliente           text not null check (cliente ~ '^\d{11,15}$'),
    cliente_nombre    text,
    producto          text not null,
    variante          text,
    precio_venta      numeric(12, 2),
    costo_proveedor   numeric(12, 2),
    estado            text not null default 'COTIZANDO' check (estado in (
                          'COTIZANDO', 'ESPERANDO_PAGO_ADMIN', 'ESPERANDO_CREDENCIALES', 'REVISION_MANUAL',
                          'ENTREGADO', 'CANCELADO', 'VENCIDO', 'AGOTADO')),
    esperando         text check (esperando in ('COTIZACION', 'PAGO_ADMIN', 'CREDENCIALES', 'APROBACION')),
    resume_url        text,
    wamid_cotizacion  text,
    wamid_pago        text,
    credencial_final  text check (credencial_final is null or length(credencial_final) <= 4),
    confianza         numeric(3, 2),
    notas             text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists triangulaciones_abiertas on public.triangulaciones (estado)
    where estado not in ('ENTREGADO', 'CANCELADO', 'VENCIDO', 'AGOTADO');
create index if not exists triangulaciones_wamid on public.triangulaciones (wamid_cotizacion, wamid_pago);

create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists trg_triangulaciones_updated on public.triangulaciones;
create trigger trg_triangulaciones_updated
    before update on public.triangulaciones
    for each row execute function public.tocar_updated_at();

alter table public.triangulaciones enable row level security;
revoke all on table public.triangulaciones from anon;
revoke insert, update, delete on table public.triangulaciones from authenticated;
drop policy if exists triangulaciones_lectura_admin on public.triangulaciones;
create policy triangulaciones_lectura_admin on public.triangulaciones
    for select to authenticated using (public.es_admin());

-- Verificación
select to_regclass('public.triangulaciones') is not null as tabla_triangulaciones;
