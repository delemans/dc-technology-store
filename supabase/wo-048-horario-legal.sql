-- =====================================================================
-- WO-048 · Cola de WhatsApp: horario legal para lo comercial (Ley 2300 de 2023) + avisos que no dependen de una compra
--   1. Solicitudes de reseña y avisos de renovación solo: lunes a viernes 7:00 a. m.–7:00 p. m. y sábados
--      8:00 a. m.–3:00 p. m. (hora de Colombia), nunca domingos ni festivos. Lo transaccional (pago recibido, entrega,
--      código de acceso, orden validada, rastreo…) sale en cualquier momento porque responde a una compra del cliente.
--   2. RENOVACION (wo-044) y RASTREO (wo-047) no se cancelan por "no tener compra": se identifican con la referencia
--      del pedido, no con una compra al proveedor (sin esto, la cola los cancelaba sin enviarlos).
-- Igual que wo-028 y wo-032, se parchea el texto VIGENTE de tomar_notificaciones() (no se pisan esos parches).
-- Festivos de Colombia 2026 y 2027 incluidos. Requiere wo-015b, wo-028 y wo-032. Idempotente.
-- =====================================================================

do $$
begin
    if to_regprocedure('public.tomar_notificaciones(integer)') is null then
        raise exception 'Nada se aplicó. Falta la cola de WhatsApp: aplica antes wo-015b.';
    end if;
end;
$$;

create table if not exists public.festivos_colombia (dia date primary key, nombre text not null);
alter table public.festivos_colombia enable row level security;
revoke all on table public.festivos_colombia from public, anon, authenticated;
insert into public.festivos_colombia (dia, nombre) values
    ('2026-01-01', 'Año Nuevo'), ('2026-01-12', 'Reyes Magos'), ('2026-03-23', 'San José'), ('2026-04-02', 'Jueves Santo'),
    ('2026-04-03', 'Viernes Santo'), ('2026-05-01', 'Día del Trabajo'), ('2026-05-18', 'Ascensión del Señor'), ('2026-06-08', 'Corpus Christi'),
    ('2026-06-15', 'Sagrado Corazón'), ('2026-06-29', 'San Pedro y San Pablo'), ('2026-07-20', 'Independencia'), ('2026-08-07', 'Batalla de Boyacá'),
    ('2026-08-17', 'Asunción de la Virgen'), ('2026-10-12', 'Día de la Raza'), ('2026-11-02', 'Todos los Santos'), ('2026-11-16', 'Independencia de Cartagena'),
    ('2026-12-08', 'Inmaculada Concepción'), ('2026-12-25', 'Navidad'),
    ('2027-01-01', 'Año Nuevo'), ('2027-01-11', 'Reyes Magos'), ('2027-03-22', 'San José'), ('2027-03-25', 'Jueves Santo'),
    ('2027-03-26', 'Viernes Santo'), ('2027-05-01', 'Día del Trabajo'), ('2027-05-10', 'Ascensión del Señor'), ('2027-05-31', 'Corpus Christi'),
    ('2027-06-07', 'Sagrado Corazón'), ('2027-07-05', 'San Pedro y San Pablo'), ('2027-07-20', 'Independencia'), ('2027-08-07', 'Batalla de Boyacá'),
    ('2027-08-16', 'Asunción de la Virgen'), ('2027-10-18', 'Día de la Raza'), ('2027-11-01', 'Todos los Santos'), ('2027-11-15', 'Independencia de Cartagena'),
    ('2027-12-08', 'Inmaculada Concepción'), ('2027-12-25', 'Navidad')
on conflict (dia) do nothing;

create or replace function public.horario_comercial_legal(p_momento timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    with t as (select (p_momento at time zone 'America/Bogota') as l)
    select case
        when exists (select 1 from public.festivos_colombia f, t where f.dia = t.l::date) then false
        when extract(isodow from t.l) between 1 and 5 then t.l::time >= time '07:00' and t.l::time < time '19:00'
        when extract(isodow from t.l) = 6 then t.l::time >= time '08:00' and t.l::time < time '15:00'
        else false
    end
    from t;
$$;
revoke all on function public.horario_comercial_legal(timestamptz) from public, anon, authenticated;
grant execute on function public.horario_comercial_legal(timestamptz) to service_role;

do $$
declare
    def text;
    antes text;
begin
    def := replace(pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure), E'\r\n', E'\n');
    antes := def;
    -- 1) Horario legal para lo comercial
    if position('horario_comercial_legal' in def) = 0 then
        if def !~ 'n\.tipo <> ''SOLICITUD_RESENA'' or \(' then
            raise exception 'Nada se aplicó. No encontré el horario de reseñas en tomar_notificaciones (¿wo-015b modificado?).';
        end if;
        def := regexp_replace(def, 'n\.tipo <> ''SOLICITUD_RESENA'' or \(.*?between 9 and 19\)\)',
            'n.tipo not in (''SOLICITUD_RESENA'', ''RENOVACION'') or public.horario_comercial_legal())');
    end if;
    -- 2) Renovación y rastreo no dependen de una compra al proveedor
    if position('''RASTREO''' in def) = 0 then
        if position('''ADMIN_FALLA'')' in def) = 0 then
            raise exception 'Nada se aplicó. tomar_notificaciones no tiene el parche de wo-032: aplica wo-032-fase3.sql primero.';
        end if;
        def := replace(def, '''ADMIN_FALLA'')', '''ADMIN_FALLA'', ''RENOVACION'', ''RASTREO'')');
    end if;
    if def <> antes then
        execute def;
    end if;
end;
$$;

-- Verificación: domingo false, martes 10 a. m. true, sábado 4 p. m. false, festivo false, y la cola ya parchada
select public.horario_comercial_legal('2026-10-25 10:00-05') as domingo,
       public.horario_comercial_legal('2026-10-20 10:00-05') as martes_10am,
       public.horario_comercial_legal('2026-10-24 16:00-05') as sabado_4pm,
       public.horario_comercial_legal('2026-11-02 10:00-05') as festivo,
       position('horario_comercial_legal' in pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure)) > 0 as cola_con_horario_legal,
       position('''RASTREO''' in pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure)) > 0 as cola_no_cancela_rastreo;
