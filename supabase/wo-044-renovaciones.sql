-- =====================================================================
-- WO-044 · Renovación por suscripción: aviso automático antes de que venza el plan del cliente
--   1. Tipo de aviso RENOVACION en la cola de WhatsApp (plantilla "renovacion" de bot-conocimiento.json).
--   2. entregas_para_renovar(): entregas recientes (cuentas, licencias) que aún no tienen aviso de renovación.
--      n8n calcula cuándo vence cada plan (26 días, 1 mes, 1 año…) y avisa 3 días antes.
--   3. encolar_renovacion(): deja el aviso en la cola (una sola vez por pedido; respeta las bajas de WhatsApp).
-- Requiere wo-015/015b (cola), wo-024 (triangulaciones) y wo-032 (encolar_aviso). Idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.notificaciones_whatsapp') is null or to_regclass('public.triangulaciones') is null then
        raise exception 'Nada se aplicó. Faltan tablas base: aplica antes wo-015b y wo-024.';
    end if;
    if to_regprocedure('public.encolar_aviso(text, text, text, text, jsonb, smallint)') is null then
        raise exception 'Nada se aplicó. Falta encolar_aviso(): aplica antes wo-032-fase3.sql.';
    end if;
end;
$$;

-- 1) Tipo nuevo (se conservan todos los anteriores) ------------------------------------------------------
alter table public.notificaciones_whatsapp drop constraint if exists notificaciones_whatsapp_tipo_check;
alter table public.notificaciones_whatsapp add constraint notificaciones_whatsapp_tipo_check
    check (tipo in ('PAGO_RECIBIDO', 'ENTREGA_CONFIRMADA', 'SOLICITUD_RESENA', 'OTP',
                    'ORDEN_VALIDADA', 'ORDEN_RECHAZADA', 'REPORTE_RESUELTO', 'ADMIN_COMPROBANTE', 'ADMIN_FALLA', 'RENOVACION'));

-- 2) Entregas candidatas (sin aviso todavía y sin baja) ----------------------------------------------------
drop function if exists public.entregas_para_renovar(integer);
create function public.entregas_para_renovar(p_dias integer default 70)
returns table (referencia text, cliente text, producto text, variante text, entregado_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    select t.referencia, t.cliente, t.producto, t.variante, t.updated_at
      from public.triangulaciones t
     where t.estado = 'ENTREGADO'
       and not t.es_combo
       and t.updated_at > now() - make_interval(days => greatest(1, least(coalesce(p_dias, 70), 400)))
       and not exists (select 1 from public.notificaciones_whatsapp n where n.clave = 'RENUEVA:' || t.referencia)
       and (to_regclass('public.whatsapp_bajas') is null
            or not exists (select 1 from public.whatsapp_bajas b where b.destino = t.cliente))
     order by t.updated_at;
$$;
revoke all on function public.entregas_para_renovar(integer) from public, anon, authenticated;
grant execute on function public.entregas_para_renovar(integer) to service_role;

-- 3) Encolar el aviso -----------------------------------------------------------------------------------
drop function if exists public.encolar_renovacion(text, text);
create function public.encolar_renovacion(p_referencia text, p_vence text)
returns table (ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    t record;
begin
    select * into t from public.triangulaciones x where x.referencia = upper(btrim(coalesce(p_referencia, ''))) and x.estado = 'ENTREGADO';
    if not found then
        return query select false, 'El pedido no existe o no está entregado.'::text; return;
    end if;
    if exists (select 1 from public.notificaciones_whatsapp n where n.clave = 'RENUEVA:' || t.referencia) then
        return query select true, 'Ya estaba en la cola.'::text; return;
    end if;
    perform public.encolar_aviso('RENUEVA:' || t.referencia, 'RENOVACION', coalesce(t.compra_id, t.referencia), t.cliente,
        jsonb_build_object('producto', t.producto, 'variante', coalesce(t.variante, ''), 'vence', left(coalesce(p_vence, ''), 40), 'pedido', t.referencia), 4::smallint);
    return query select true, 'Aviso de renovación en la cola.'::text;
end;
$$;
revoke all on function public.encolar_renovacion(text, text) from public, anon, authenticated;
grant execute on function public.encolar_renovacion(text, text) to service_role;

-- Verificación
select to_regprocedure('public.entregas_para_renovar(integer)') is not null as ok_candidatas,
       to_regprocedure('public.encolar_renovacion(text, text)') is not null as ok_encolar;
