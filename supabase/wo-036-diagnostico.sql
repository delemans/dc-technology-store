-- =====================================================================
-- WO-036 · Prueba del sistema: latido de n8n + diagnóstico en vivo para el panel
-- Requiere: wo-015a (administradores / es_admin). Ejecutar en Supabase → SQL Editor. Es idempotente.
--
-- 1) n8n marca un "latido" cada minuto en cada rama programada (posventa, despacho web, pedidos en ANC):
--    si el flujo está apagado o sin credenciales, el panel lo dice en vez de que los códigos no lleguen.
-- 2) diagnostico_sistema(): revisión SOLO LECTURA de lo que necesita la venta automática (SQL aplicados,
--    métodos de pago, colas atascadas, n8n vivo). La usa el botón "Probar todo el sistema" del panel.
-- =====================================================================

do $$
begin
    if to_regprocedure('public.es_admin()') is null or to_regclass('public.administradores') is null then
        raise exception 'Nada se aplicó. Falta public.administradores / es_admin(): aplica antes supabase/wo-015a-administradores.sql.';
    end if;
end;
$$;

-- 1) Latidos de n8n
create table if not exists public.latidos_n8n (
    rama     text primary key check (rama in ('posventa', 'despacho', 'anc', 'bot')),
    visto_at timestamptz not null default now(),
    veces    bigint not null default 1
);
alter table public.latidos_n8n enable row level security;
revoke all on table public.latidos_n8n from anon, authenticated;

drop function if exists public.registrar_latido(text);
create function public.registrar_latido(p_rama text)
returns table (ok boolean)
language sql
volatile
security definer
set search_path = ''
as $$
    insert into public.latidos_n8n as l (rama) values (p_rama)
    on conflict (rama) do update set visto_at = now(), veces = l.veces + 1
    returning true;
$$;
revoke all on function public.registrar_latido(text) from public, anon, authenticated;
grant execute on function public.registrar_latido(text) to service_role;

-- 2) Diagnóstico (solo administradores). Cada fila: grupo, chequeo, ok, detalle y qué hacer si falla.
drop function if exists public.diagnostico_sistema();
create function public.diagnostico_sistema()
returns table (orden integer, grupo text, chequeo text, ok boolean, detalle text, arreglo text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    n         bigint;
    v_texto   text;
    v_visto   timestamptz;
    r         record;
begin
    if not public.es_admin() then
        raise exception 'Solo el administrador puede ver el diagnóstico.' using errcode = '42501';
    end if;

    -- ---------- Base de datos: SQL aplicados ----------
    for r in select * from (values
        (1, 'Portal con código por WhatsApp (OTP)', 'public.solicitar_otp(text)', 'wo-028-portal.sql'),
        (2, 'Descuentos por combo', 'public.reglas_combo_publicas()', 'wo-029-combos.sql'),
        (3, 'Comprobantes desde la web', 'public.registrar_comprobante(text, text, text, text)', 'wo-030-comprobantes.sql'),
        (4, 'Precios en la base y orden web v2', 'public.precios_publicos()', 'wo-032-fase3.sql'),
        (5, 'Despacho automático de órdenes web', 'public.tomar_despachos()', 'wo-033-despacho-n8n.sql'),
        (6, 'Compra en el portal de ANC', 'public.triangulaciones_anc_esperando()', 'wo-035-compra-web-anc.sql')
    ) as x(o, nombre, firma, archivo) loop
        orden := r.o; grupo := 'Base de datos'; chequeo := r.nombre;
        ok := to_regprocedure(r.firma) is not null;
        detalle := case when ok then 'Aplicado' else 'No encontrado' end;
        arreglo := case when ok then null else 'Ejecuta supabase/' || r.archivo end;
        return next;
    end loop;
    orden := 7; grupo := 'Base de datos'; chequeo := 'Nombres del catálogo alineados con ANC';
    ok := to_regclass('public.catalogo_precios') is not null
          and exists (select 1 from public.catalogo_precios c where c.producto_id = 'office-2016-2019-2021-2024-pro-plus' and c.variante = 'Office 2016 Pro Plus');
    detalle := case when ok then 'Aplicado' else 'Nombres viejos' end;
    arreglo := case when ok then null else 'Ejecuta supabase/wo-034-nombres-ancpagos.sql' end;
    return next;

    -- ---------- Ventas ----------
    select count(*) into n from public.metodos_pago m where m.activo;
    orden := 10; grupo := 'Ventas'; chequeo := 'Métodos de pago activos';
    ok := n > 0; detalle := n || ' activo(s)';
    arreglo := case when ok then null else 'Panel → Métodos de pago: crea uno y enciende "Activo"' end;
    return next;
    n := 0;
    if to_regclass('public.catalogo_precios') is not null then
        select count(*) into n from public.catalogo_precios c where c.activo and c.precio > 0;
    end if;
    orden := 11; grupo := 'Ventas'; chequeo := 'Variantes con precio en la base';
    ok := n > 0; detalle := n || ' a la venta';
    arreglo := case when ok then null else 'Revisa Panel → Precios del catálogo' end;
    return next;
    n := 0;
    if to_regclass('public.reglas_combo') is not null then
        select count(*) into n from public.reglas_combo rc where rc.activa;
    end if;
    orden := 12; grupo := 'Ventas'; chequeo := 'Reglas de descuento por combo';
    ok := true; detalle := case when n > 0 then n || ' activa(s)' else 'Sin combos con descuento (opcional)' end; arreglo := null;
    return next;

    -- ---------- n8n: latido por rama (cada minuto) ----------
    for r in select * from (values
        (20, 'posventa', 'Envía avisos y códigos de acceso (OTP)'),
        (21, 'despacho', 'Despacha órdenes web validadas'),
        (22, 'anc', 'Lee los accesos de los pedidos en ANC')
    ) as x(o, rama, nombre) loop
        select l.visto_at into v_visto from public.latidos_n8n l where l.rama = r.rama;
        orden := r.o; grupo := 'n8n (bot)'; chequeo := r.nombre;
        ok := v_visto is not null and v_visto > now() - interval '3 minutes';
        detalle := case when v_visto is null then 'Nunca ha dado señal'
                        else 'Última señal: ' || to_char(v_visto at time zone 'America/Bogota', 'DD/MM HH24:MI') end;
        arreglo := case when ok then null
                        when v_visto is null then 'Reimporta el flujo, asigna la credencial de Supabase y actívalo (Active)'
                        else 'El flujo está apagado o falló: en n8n revisa que esté Active y mira Executions' end;
        return next;
    end loop;

    -- ---------- Colas ----------
    select count(*), min(x.created_at) into n, v_visto from public.notificaciones_whatsapp x
     where x.estado = 'PENDIENTE' and x.enviar_despues < now() - interval '3 minutes';
    orden := 30; grupo := 'Colas'; chequeo := 'Mensajes de WhatsApp sin enviar';
    ok := n = 0;
    detalle := case when ok then 'Al día' else n || ' atrasado(s) desde ' || to_char(v_visto at time zone 'America/Bogota', 'DD/MM HH24:MI') end;
    arreglo := case when ok then null else 'n8n no está tomando la cola: revisa la rama de posventa' end;
    return next;
    select count(*), string_agg(distinct left(coalesce(x.ultimo_error, '?'), 80), ' · ') into n, v_texto
      from public.notificaciones_whatsapp x where x.estado = 'FALLIDO' and x.created_at > now() - interval '24 hours';
    orden := 31; grupo := 'Colas'; chequeo := 'Mensajes fallidos (24 h)';
    ok := n = 0; detalle := case when ok then 'Ninguno' else n || ': ' || coalesce(v_texto, '') end;
    arreglo := case when ok then null else 'Revisa la instancia de Evolution API (conectada y con el número correcto)' end;
    return next;
    if to_regclass('public.ordenes_web') is not null then
        select count(*) into n from public.ordenes_web o where o.estado = 'COMPROBANTE_RECIBIDO';
        orden := 32; grupo := 'Colas'; chequeo := 'Comprobantes web por revisar';
        ok := true; detalle := case when n = 0 then 'Ninguno' else n || ' esperando tu validación' end; arreglo := null;
        return next;
        select count(*) into n from public.ordenes_web o
         where o.estado = 'VALIDADO' and o.despachada_at is null and o.updated_at < now() - interval '10 minutes';
        orden := 33; grupo := 'Colas'; chequeo := 'Órdenes validadas sin despachar';
        ok := n = 0; detalle := case when ok then 'Ninguna' else n || ' llevan más de 10 min' end;
        arreglo := case when ok then null else 'n8n no está despachando: revisa la rama de despacho' end;
        return next;
    end if;
    select count(*) into n from public.triangulaciones t
     where t.estado not in ('ENTREGADO', 'CANCELADO', 'VENCIDO', 'AGOTADO') and t.updated_at < now() - interval '12 hours';
    orden := 34; grupo := 'Colas'; chequeo := 'Compras al proveedor detenidas (+12 h)';
    ok := n = 0; detalle := case when ok then 'Ninguna' else n || ' sin moverse' end;
    arreglo := case when ok then null else 'Panel → Triangulaciones: ciérralas o termínalas a mano' end;
    return next;
end;
$$;
revoke all on function public.diagnostico_sistema() from public, anon;
grant execute on function public.diagnostico_sistema() to authenticated;

-- Resultado
select to_regprocedure('public.diagnostico_sistema()') is not null as diagnostico_listo,
       (select count(*) from public.latidos_n8n) as ramas_con_latido;
