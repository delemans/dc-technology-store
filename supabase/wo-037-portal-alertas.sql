-- =====================================================================
-- WO-037 · Portal y alertas: código para todo cliente + diagnóstico de chats, configuración y OTP
-- Requiere: wo-028 (portal), wo-036 (diagnóstico). Ejecutar en Supabase → SQL Editor. Es idempotente.
--
-- 1) solicitar_otp: el código llega a todo número que ya es cliente (compra, orden web o pedido por el bot).
--    Antes solo a quien tenía una compra al proveedor: quien acababa de pagar en la web no podía entrar.
-- 2) Latidos con detalle: n8n reporta su configuración (número de aviso, correo de ANC) y el número del bot,
--    sin secretos; el botón "Probar todo el sistema" la muestra en verde o rojo.
-- =====================================================================

do $$
declare
    v_faltan text[] := '{}';
begin
    if to_regprocedure('public.solicitar_otp(text)') is null then v_faltan := array_append(v_faltan, 'solicitar_otp (wo-028)'::text); end if;
    if to_regclass('public.latidos_n8n') is null then v_faltan := array_append(v_faltan, 'latidos_n8n (wo-036)'::text); end if;
    if array_length(v_faltan, 1) > 0 then
        raise exception 'Nada se aplicó. Falta: %', array_to_string(v_faltan, ', ');
    end if;
end;
$$;

-- 1) Código de acceso para todo cliente
drop function if exists public.solicitar_otp(text);
create function public.solicitar_otp(p_whatsapp text)
returns table (ok boolean, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_numero text := public.normalizar_whatsapp(p_whatsapp);
    v_codigo text;
    v_sal    text;
    v_generico constant text := 'Si tu número tiene pedidos con nosotros, te llegará un código por WhatsApp en menos de 2 minutos.';
begin
    if v_numero is null then
        return query select false, 'Escribe un WhatsApp válido (10 dígitos).';
        return;
    end if;
    -- Límite: 3 códigos por hora por número (la respuesta no cambia: no se filtra información)
    if (select count(*) from public.otp_cliente o where o.whatsapp = v_numero and o.creado_at > now() - interval '1 hour') >= 3 then
        return query select true, v_generico;
        return;
    end if;
    -- Solo se envía a números que ya son clientes (evita usar el portal para mandar mensajes a cualquiera):
    -- una compra entregada o en curso, una orden pagada desde la web o un pedido hecho con el bot (WO-037)
    if not exists (select 1 from public.compras_proveedor c
                   where right(regexp_replace(coalesce(c.cliente_whatsapp, ''), '\D', '', 'g'), 10) = right(v_numero, 10))
       and not (to_regclass('public.ordenes_web') is not null
                and exists (select 1 from public.ordenes_web o where right(o.whatsapp, 10) = right(v_numero, 10)))
       and not (to_regclass('public.triangulaciones') is not null
                and exists (select 1 from public.triangulaciones t where right(t.cliente, 10) = right(v_numero, 10))) then
        return query select true, v_generico;
        return;
    end if;

    v_codigo := lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
    v_sal := replace(gen_random_uuid()::text, '-', '');
    update public.otp_cliente o set usado_at = now() where o.whatsapp = v_numero and o.usado_at is null; -- el anterior deja de servir
    insert into public.otp_cliente (whatsapp, codigo_hash, sal, expira_at)
    values (v_numero, public.hash_portal(v_codigo, v_sal), v_sal, now() + interval '5 minutes');

    insert into public.notificaciones_whatsapp (clave, tipo, compra_id, destino, variables, prioridad)
    values ('OTP:' || v_numero || ':' || replace(gen_random_uuid()::text, '-', ''), 'OTP', 'OTP', v_numero,
            jsonb_build_object('codigo', v_codigo), 0);
    return query select true, v_generico;
end;
$$;
revoke all on function public.solicitar_otp(text) from public;
grant execute on function public.solicitar_otp(text) to anon, authenticated;
comment on function public.solicitar_otp(text) is 'wo-037: código para todo cliente (compra, orden web o pedido por el bot)';

-- 2) Latidos con detalle (sin secretos: últimos dígitos, correo y nombres de instancia)
alter table public.latidos_n8n add column if not exists detalle jsonb;
drop function if exists public.registrar_latido(text);
drop function if exists public.registrar_latido(text, jsonb);
create function public.registrar_latido(p_rama text, p_detalle jsonb default null)
returns table (ok boolean)
language sql
volatile
security definer
set search_path = ''
as $$
    insert into public.latidos_n8n as l (rama, detalle) values (p_rama, p_detalle)
    on conflict (rama) do update set visto_at = now(), veces = l.veces + 1, detalle = coalesce(excluded.detalle, l.detalle)
    returning true;
$$;
revoke all on function public.registrar_latido(text, jsonb) from public, anon, authenticated;
grant execute on function public.registrar_latido(text, jsonb) to service_role;

-- 3) Diagnóstico v2: lo de wo-036 + chats del bot, configuración de n8n y códigos de acceso
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
    v_cfg     jsonb;
    v_enviados bigint;
    v_fallidos bigint;
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
    ok := false;
    if to_regclass('public.catalogo_precios') is not null then
        ok := exists (select 1 from public.catalogo_precios c where c.producto_id = 'office-2016-2019-2021-2024-pro-plus' and c.variante = 'Office 2016 Pro Plus');
    end if;
    detalle := case when ok then 'Aplicado' else 'Nombres viejos' end;
    arreglo := case when ok then null else 'Ejecuta supabase/wo-034-nombres-ancpagos.sql' end;
    return next;

    orden := 8; grupo := 'Base de datos'; chequeo := 'Código de acceso para todo cliente';
    ok := coalesce(obj_description('public.solicitar_otp(text)'::regprocedure, 'pg_proc'), '') like '%wo-037%';
    detalle := case when ok then 'Aplicado' else 'Solo para quien tiene compra al proveedor' end;
    arreglo := case when ok then null else 'Ejecuta supabase/wo-037-portal-alertas.sql' end;
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
    -- ---------- n8n: chats y configuración (los reporta el propio flujo en cada latido) ----------
    select l.visto_at, l.detalle into v_visto, v_cfg from public.latidos_n8n l where l.rama = 'bot';
    orden := 23; grupo := 'n8n (bot)'; chequeo := 'Recibe los chats de WhatsApp';
    ok := v_visto is not null;
    detalle := case when v_visto is null then 'Nunca ha llegado un mensaje de Evolution'
                    else 'Último evento: ' || to_char(v_visto at time zone 'America/Bogota', 'DD/MM HH24:MI')
                         || coalesce(' · instancia ' || nullif(v_cfg->>'instancia', ''), '')
                         || coalesce(' · número del bot …' || nullif(v_cfg->>'bot', ''), '') end;
    arreglo := case when ok then null else 'En Evolution → Webhook pon la URL de producción de tu n8n (…/webhook/dc-whatsapp) con el evento MESSAGES_UPSERT' end;
    return next;
    select l.detalle into v_cfg from public.latidos_n8n l where l.rama = 'despacho';
    orden := 24; grupo := 'n8n (bot)'; chequeo := 'Config bot: tu número de aviso';
    ok := coalesce(v_cfg->>'aviso_admin', '') <> '';
    detalle := case when v_cfg is null then 'Aún sin reporte del flujo' when ok then 'Termina en …' || (v_cfg->>'aviso_admin') else 'Vacío' end;
    arreglo := case when ok then null else 'En n8n → Config bot llena numero_aviso_admin con 57 (ej. 573001234567): ahí llegan las órdenes de compra y las alertas' end;
    return next;
    orden := 25; grupo := 'n8n (bot)'; chequeo := 'Config bot: compra en ANC';
    ok := coalesce(v_cfg->>'canal_compra', '') = 'whatsapp' or coalesce(v_cfg->>'anc_correo', '') <> '';
    detalle := case when v_cfg is null then 'Aún sin reporte del flujo'
                    else 'Canal ' || coalesce(v_cfg->>'canal_compra', '?') || ' · correo ANC ' || coalesce(nullif(v_cfg->>'anc_correo', ''), 'vacío')
                         || ' · paga por ' || coalesce(nullif(v_cfg->>'anc_metodo', ''), '?') end;
    arreglo := case when ok then null else 'En n8n → Config bot llena anc_correo (ANC envía ahí los accesos)' end;
    return next;

    -- ---------- Códigos de acceso del portal (OTP, últimas 24 h) ----------
    if to_regclass('public.otp_cliente') is not null then
        select count(*) into n from public.otp_cliente o where o.creado_at > now() - interval '24 hours';
        select count(*) filter (where x.estado = 'ENVIADO'),
               count(*) filter (where x.estado in ('FALLIDO', 'CANCELADO')),
               string_agg(distinct left(x.ultimo_error, 60), ' · ') filter (where x.estado in ('FALLIDO', 'CANCELADO'))
          into v_enviados, v_fallidos, v_texto
          from public.notificaciones_whatsapp x where x.tipo = 'OTP' and x.created_at > now() - interval '24 hours';
        orden := 35; grupo := 'Colas'; chequeo := 'Códigos de acceso (OTP, 24 h)';
        ok := v_fallidos = 0;
        detalle := case when n = 0 then 'Nadie ha pedido código'
                        else n || ' pedido(s) · ' || v_enviados || ' enviado(s)' || case when v_fallidos > 0 then ' · ' || v_fallidos || ' sin enviar: ' || coalesce(v_texto, '') else '' end end;
        arreglo := case when ok then null else 'Si dice "vencido sin enviar", n8n no tomó la cola a tiempo: revisa la rama de posventa' end;
        return next;
    end if;
end;
$$;
revoke all on function public.diagnostico_sistema() from public, anon;
grant execute on function public.diagnostico_sistema() to authenticated;

notify pgrst, 'reload schema';

-- Resultado
select to_regprocedure('public.registrar_latido(text, jsonb)') is not null as latido_con_detalle,
       (select count(*) from public.latidos_n8n) as ramas_con_latido;
