-- =====================================================================
-- WO-054 · Recordatorio amable al cliente que pidió en la web y no ha enviado el comprobante (T03)
--   1. Tipo de aviso RECORDATORIO_PAGO en la cola de WhatsApp (plantilla "recordatorio_pago" de bot-conocimiento.json).
--   2. encolar_recordatorios_pago(): órdenes web ESPERANDO_PAGO creadas hace 60–180 min → un aviso por orden
--      (clave RECUERDA:<codigo>), solo en horario legal (Ley 2300/2023, wo-048) y nunca a quien pidió la baja.
--   3. La cola lo trata como RENOVACION: horario legal y no se cancela por no tener compra al proveedor.
--   4. Si la orden deja de esperar pago (comprobante, validada, vencida…) antes de salir, el aviso se cancela.
-- Se parchea el texto VIGENTE de tomar_notificaciones() (no se pisan wo-028, wo-032 ni wo-048).
-- Requiere wo-030 (ordenes_web), wo-032 (encolar_aviso), wo-047 (tipo RASTREO) y wo-048. Idempotente.
-- =====================================================================

do $$
declare
    def text;
begin
    if to_regclass('public.ordenes_web') is null or to_regclass('public.notificaciones_whatsapp') is null then
        raise exception 'Nada se aplicó. Faltan tablas base: aplica antes wo-015b y wo-030.';
    end if;
    if to_regprocedure('public.encolar_aviso(text, text, text, text, jsonb, smallint)') is null then
        raise exception 'Nada se aplicó. Falta encolar_aviso(): aplica antes wo-032-fase3.sql.';
    end if;
    if to_regprocedure('public.horario_comercial_legal(timestamptz)') is null then
        raise exception 'Nada se aplicó. Falta el horario legal: aplica antes wo-048-horario-legal.sql.';
    end if;
    def := pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure);
    if position('RECORDATORIO_PAGO' in def) = 0
       and (position('''RENOVACION'') or public.horario_comercial_legal()' in def) = 0 or position('''RENOVACION'', ''RASTREO'')' in def) = 0) then
        raise exception 'Nada se aplicó. tomar_notificaciones no tiene el parche de wo-048: aplica wo-048-horario-legal.sql primero.';
    end if;
end;
$$;

-- 1) Tipo nuevo (se conservan todos los anteriores) ------------------------------------------------------
alter table public.notificaciones_whatsapp drop constraint if exists notificaciones_whatsapp_tipo_check;
alter table public.notificaciones_whatsapp add constraint notificaciones_whatsapp_tipo_check
    check (tipo in ('PAGO_RECIBIDO', 'ENTREGA_CONFIRMADA', 'SOLICITUD_RESENA', 'OTP',
                    'ORDEN_VALIDADA', 'ORDEN_RECHAZADA', 'REPORTE_RESUELTO', 'ADMIN_COMPROBANTE', 'ADMIN_FALLA', 'RENOVACION', 'RASTREO',
                    'RECORDATORIO_PAGO'));

-- 2) Encolar los recordatorios (n8n la llama cada 30 min) --------------------------------------------------
drop function if exists public.encolar_recordatorios_pago();
create function public.encolar_recordatorios_pago()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    o record;
    n integer := 0;
begin
    if not public.horario_comercial_legal(now()) then
        return 0;
    end if;
    for o in
        select x.codigo, x.whatsapp, x.nombre, coalesce(x.total_servidor, x.total_declarado) as total
          from public.ordenes_web x
         where x.estado = 'ESPERANDO_PAGO'
           and x.created_at <= now() - interval '60 minutes'
           and x.created_at > now() - interval '180 minutes'
           and not exists (select 1 from public.notificaciones_whatsapp w where w.clave = 'RECUERDA:' || x.codigo)
           and (to_regclass('public.whatsapp_bajas') is null
                or not exists (select 1 from public.whatsapp_bajas b where b.destino = x.whatsapp))
         order by x.created_at
    loop
        perform public.encolar_aviso('RECUERDA:' || o.codigo, 'RECORDATORIO_PAGO', o.codigo, o.whatsapp,
            jsonb_build_object('codigo', o.codigo, 'total', replace(to_char(o.total, 'FM999,999,999'), ',', '.')), 4::smallint);
        n := n + 1;
    end loop;
    return n;
end;
$$;
revoke all on function public.encolar_recordatorios_pago() from public, anon, authenticated;
grant execute on function public.encolar_recordatorios_pago() to service_role;

-- 3) La cola: horario legal y sin depender de una compra al proveedor -----------------------------------------
do $$
declare
    def text;
    antes text;
begin
    def := replace(pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure), E'\r\n', E'\n');
    antes := def;
    if position('RECORDATORIO_PAGO' in def) = 0 then
        def := replace(def, '''RENOVACION'') or public.horario_comercial_legal()', '''RENOVACION'', ''RECORDATORIO_PAGO'') or public.horario_comercial_legal()');
        def := replace(def, '''RENOVACION'', ''RASTREO'')', '''RENOVACION'', ''RASTREO'', ''RECORDATORIO_PAGO'')');
    end if;
    if def <> antes then
        execute def;
    end if;
end;
$$;

-- 4) Si la orden ya no espera pago, el recordatorio pendiente no sale -----------------------------------------
create or replace function public.cancelar_recordatorio_pago()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.estado is distinct from old.estado and new.estado <> 'ESPERANDO_PAGO' then
        update public.notificaciones_whatsapp
           set estado = 'CANCELADO', ultimo_error = 'La orden ya no espera pago (' || new.estado || ')'
         where clave = 'RECUERDA:' || new.codigo and estado = 'PENDIENTE';
    end if;
    return new;
end;
$$;
drop trigger if exists trg_cancelar_recordatorio_pago on public.ordenes_web;
create trigger trg_cancelar_recordatorio_pago after update of estado on public.ordenes_web
    for each row execute function public.cancelar_recordatorio_pago();

-- Verificación
select to_regprocedure('public.encolar_recordatorios_pago()') is not null as ok_recordatorios,
       position('''RECORDATORIO_PAGO'') or public.horario_comercial_legal()' in pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure)) > 0 as cola_con_horario_legal,
       position('''RASTREO'', ''RECORDATORIO_PAGO'')' in pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure)) > 0 as cola_no_lo_cancela;
