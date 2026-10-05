-- =====================================================================
-- WO-028 · Portal de clientes (cliente.html) — Fase 0 + Fase 1
-- Requiere: wo-015.sql (cola de notificaciones). Idempotente: se puede ejecutar varias veces.
-- Aplicar: node herramientas/configurar-supabase.js --aplicar --archivo supabase/wo-028-portal.sql
--
-- Fase 0: "Mis pedidos" busca también por el código que recibe el cliente (pedidos.codigo, ej. DC-7K2Q9).
-- Fase 1: entrar con el WhatsApp + código de 6 dígitos que envía el bot (sin correo ni contraseña),
--         historial de pedidos del número y ver los accesos de un pedido entregado (con registro).
--
-- Seguridad:
--   · El código se genera con aleatoriedad criptográfica (gen_random_uuid) y solo se guarda su hash
--     (sha256 + sal). Vence a los 5 minutos, 3 intentos. En la cola de envío se borra al enviarse.
--   · solicitar_otp responde SIEMPRE lo mismo (no revela si un número es cliente). Máximo 3 códigos por
--     hora por número y 10 intentos fallidos por hora → bloqueo temporal.
--   · Sesión: token aleatorio de 256 bits que solo conoce el dispositivo; en la base, su hash. 30 días.
--   · Ver accesos exige haber verificado el código en las últimas 24 h y deja registro en accesos_vistos.
--   · Ninguna tabla nueva es legible por anon; todo pasa por funciones security definer.
-- =====================================================================

/* ==================== FASE 0 · consultar_pedido por código ==================== */

-- Se borra antes: Postgres no deja cambiar las columnas de salida con "create or replace"
drop function if exists public.consultar_pedido(text);
create function public.consultar_pedido(p_codigo text)
returns table (
    pedido_id         text,
    producto          text,
    estado            text,
    garantia_dias     integer,
    fecha_vencimiento timestamptz,
    serial_final      text,
    compra_id         text
)
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(p.codigo, c.pedido_id::text),
           coalesce(nullif(c.referencia_externa::text, ''), c.variante_id::text),
           c.estado::text,
           c.garantia_dias,
           c.fecha_vencimiento,
           case when length(c.clave_serial) >= 8 then right(c.clave_serial, 4) end,
           c.id::text
    from public.compras_proveedor c
    left join public.pedidos p on p.id = c.pedido_id
    where c.id::text = p_codigo
       or c.pedido_id::text = p_codigo
       or upper(p.codigo) = upper(btrim(p_codigo))
    order by (c.id::text = p_codigo) desc, c.id
    limit 1;
$$;
revoke all on function public.consultar_pedido(text) from public;
grant execute on function public.consultar_pedido(text) to anon, authenticated;

/* ==================== FASE 1 · Tablas ==================== */

create table if not exists public.otp_cliente (
    id          bigint generated always as identity primary key,
    whatsapp    text not null check (whatsapp ~ '^\d{11,15}$'),
    codigo_hash text not null,
    sal         text not null,
    intentos    smallint not null default 0,
    usado_at    timestamptz,
    expira_at   timestamptz not null,
    creado_at   timestamptz not null default now()
);
create index if not exists otp_cliente_numero on public.otp_cliente (whatsapp, creado_at desc);

create table if not exists public.sesiones_cliente (
    id            bigint generated always as identity primary key,
    whatsapp      text not null check (whatsapp ~ '^\d{11,15}$'),
    token_hash    text not null unique,
    verificado_at timestamptz not null default now(),   -- última vez que confirmó el código
    ultimo_uso    timestamptz not null default now(),
    expira_at     timestamptz not null,
    cerrada_at    timestamptz,
    creado_at     timestamptz not null default now()
);
create index if not exists sesiones_cliente_numero on public.sesiones_cliente (whatsapp);

create table if not exists public.accesos_vistos (
    id         bigint generated always as identity primary key,
    sesion_id  bigint not null references public.sesiones_cliente (id),
    whatsapp   text not null,
    compra_id  text not null,
    visto_at   timestamptz not null default now()
);

do $$
declare
    t text;
begin
    foreach t in array array['otp_cliente', 'sesiones_cliente', 'accesos_vistos'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on table public.%I from anon, authenticated', t);
    end loop;
end;
$$;
-- El administrador puede auditar quién vio accesos (solo lectura)
grant select on table public.accesos_vistos to authenticated;
drop policy if exists accesos_vistos_admin on public.accesos_vistos;
create policy accesos_vistos_admin on public.accesos_vistos for select to authenticated using (public.es_admin());

/* ==================== FASE 1 · El código viaja por la cola de WhatsApp (n8n) ==================== */

-- Nuevo tipo de notificación 'OTP' (prioridad máxima; no depende de una compra)
alter table public.notificaciones_whatsapp drop constraint if exists notificaciones_whatsapp_tipo_check;
alter table public.notificaciones_whatsapp add constraint notificaciones_whatsapp_tipo_check
    check (tipo in ('PAGO_RECIBIDO', 'ENTREGA_CONFIRMADA', 'SOLICITUD_RESENA', 'OTP'));

-- tomar_notificaciones: los OTP no tienen compra (no se cancelan por eso) y vencen a los 5 minutos
do $$
declare
    def      text;
    objetivo text := E'    update public.notificaciones_whatsapp n\n       set estado = ''CANCELADO'', ultimo_error = ''Ya no aplica (estado de la compra, reseña existente o vencida)''\n     where n.estado = ''PENDIENTE''\n';
begin
    def := replace(pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure), E'\r\n', E'\n');
    if position('n.tipo <> ''OTP''' in def) > 0 then
        return; -- ya parcheada en una ejecución anterior
    end if;
    if position(objetivo in def) = 0 then
        raise exception 'No encontré el bloque esperado en tomar_notificaciones (¿wo-015 modificado?). Nada se aplicó.';
    end if;
    def := replace(def, objetivo,
        E'    update public.notificaciones_whatsapp n\n       set estado = ''CANCELADO'', ultimo_error = ''Código de acceso vencido sin enviar''\n     where n.estado = ''PENDIENTE'' and n.tipo = ''OTP'' and n.created_at < now() - interval ''5 minutes'';\n\n'
        || replace(objetivo, E'where n.estado = ''PENDIENTE''\n', E'where n.estado = ''PENDIENTE'' and n.tipo <> ''OTP''\n'));
    execute def;
end;
$$;

-- El código nunca queda en la cola: se borra apenas termina el envío (enviado, fallido o cancelado)
create or replace function public.limpiar_otp_enviado()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.tipo = 'OTP' and new.estado in ('ENVIADO', 'FALLIDO', 'CANCELADO') then
        new.variables := '{}'::jsonb;
    end if;
    return new;
end;
$$;
drop trigger if exists trg_limpiar_otp on public.notificaciones_whatsapp;
create trigger trg_limpiar_otp
    before update on public.notificaciones_whatsapp
    for each row execute function public.limpiar_otp_enviado();

-- Hash con sal (sha256 está en el núcleo de Postgres; no requiere extensiones)
create or replace function public.hash_portal(p_valor text, p_sal text)
returns text
language sql
immutable
set search_path = ''
as $$
    select encode(sha256(convert_to(coalesce(p_sal, '') || ':' || coalesce(p_valor, ''), 'UTF8')), 'hex');
$$;
revoke all on function public.hash_portal(text, text) from public, anon, authenticated;

-- Sesión válida → número de WhatsApp (null si no existe, venció o se cerró). Renueva "último uso".
create or replace function public.sesion_portal(p_token text)
returns table (sesion_id bigint, whatsapp text, verificado_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
    return query
    update public.sesiones_cliente s
       set ultimo_uso = now()
     where s.token_hash = public.hash_portal(p_token, 'sesion')
       and s.cerrada_at is null and s.expira_at > now()
    returning s.id, s.whatsapp, s.verificado_at;
end;
$$;
revoke all on function public.sesion_portal(text) from public, anon, authenticated;

/* ==================== FASE 1 · RPC del portal ==================== */

-- 1) Pedir código. Respuesta idéntica exista o no el número (no revela clientes).
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
    -- Solo se envía a números que compraron (evita usar el portal para mandar mensajes a cualquiera)
    if not exists (select 1 from public.compras_proveedor c
                   where right(regexp_replace(coalesce(c.cliente_whatsapp, ''), '\D', '', 'g'), 10) = right(v_numero, 10)) then
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

-- 2) Verificar el código → sesión de 30 días (el token solo lo recibe el dispositivo)
drop function if exists public.verificar_otp(text, text);
create function public.verificar_otp(p_whatsapp text, p_codigo text)
returns table (ok boolean, mensaje text, token text, expira_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_numero text := public.normalizar_whatsapp(p_whatsapp);
    o        public.otp_cliente%rowtype;
    v_token  text;
    v_expira timestamptz := now() + interval '30 days';
begin
    if v_numero is null or coalesce(p_codigo, '') !~ '^\d{6}$' then
        return query select false, 'Escribe el código de 6 dígitos que te llegó por WhatsApp.', null::text, null::timestamptz;
        return;
    end if;
    -- Bloqueo temporal: 10 intentos fallidos en una hora
    if (select coalesce(sum(x.intentos), 0) from public.otp_cliente x where x.whatsapp = v_numero and x.creado_at > now() - interval '1 hour') >= 10 then
        return query select false, 'Demasiados intentos. Espera una hora y pide un código nuevo.', null::text, null::timestamptz;
        return;
    end if;
    select * into o from public.otp_cliente x
     where x.whatsapp = v_numero and x.usado_at is null and x.expira_at > now()
     order by x.creado_at desc limit 1
     for update;
    if not found then
        return query select false, 'El código venció o no existe. Pide uno nuevo.', null::text, null::timestamptz;
        return;
    end if;
    if o.intentos >= 3 then
        update public.otp_cliente x set usado_at = now() where x.id = o.id;
        return query select false, 'Superaste los 3 intentos. Pide un código nuevo.', null::text, null::timestamptz;
        return;
    end if;
    if public.hash_portal(p_codigo, o.sal) <> o.codigo_hash then
        update public.otp_cliente x set intentos = x.intentos + 1 where x.id = o.id;
        return query select false, format('Código incorrecto. Te quedan %s intento(s).', 2 - o.intentos), null::text, null::timestamptz;
        return;
    end if;

    update public.otp_cliente x set usado_at = now() where x.id = o.id;
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); -- 2 × 122 bits aleatorios
    insert into public.sesiones_cliente (whatsapp, token_hash, expira_at)
    values (v_numero, public.hash_portal(v_token, 'sesion'), v_expira);
    return query select true, 'Listo, ya puedes ver tus pedidos.', v_token, v_expira;
end;
$$;

-- 3) Historial de pedidos del número de la sesión
drop function if exists public.mis_pedidos(text);
create function public.mis_pedidos(p_token text)
returns table (codigo text, producto text, estado text, estado_pedido text, creado_at timestamptz, entregado_at timestamptz,
               fecha_vencimiento timestamptz, garantia_dias integer, serial_final text, compra_id text, tiene_accesos boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_numero text;
begin
    select s.whatsapp into v_numero from public.sesion_portal(p_token) s;
    if v_numero is null then
        raise exception 'SESION_INVALIDA' using errcode = '28000';
    end if;
    return query
    select coalesce(p.codigo, c.pedido_id::text, c.id::text),
           coalesce(nullif(c.referencia_externa::text, ''), c.variante_id::text),
           c.estado::text,
           p.estado::text,
           p.creado_at,
           c.entregado_at,
           c.fecha_vencimiento,
           c.garantia_dias,
           case when length(c.clave_serial) >= 8 then right(c.clave_serial, 4) end,
           c.id::text,
           c.clave_serial is not null and c.estado::text in ('ENTREGADO', 'ENTREGADO_INMEDIATO')
    from public.compras_proveedor c
    left join public.pedidos p on p.id = c.pedido_id
    where right(regexp_replace(coalesce(c.cliente_whatsapp, ''), '\D', '', 'g'), 10) = right(v_numero, 10)
    order by coalesce(p.creado_at, c.entregado_at) desc nulls last, c.id::text desc
    limit 50;
end;
$$;

-- 4) Ver accesos de UN pedido entregado del número (re-verificación cada 24 h + registro)
drop function if exists public.ver_accesos(text, text);
create function public.ver_accesos(p_token text, p_compra_id text)
returns table (ok boolean, mensaje text, accesos text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_sesion  bigint;
    v_numero  text;
    v_verif   timestamptz;
    v_clave   text;
begin
    select s.sesion_id, s.whatsapp, s.verificado_at into v_sesion, v_numero, v_verif from public.sesion_portal(p_token) s;
    if v_numero is null then
        return query select false, 'SESION_INVALIDA', null::text;
        return;
    end if;
    if v_verif < now() - interval '24 hours' then
        return query select false, 'REVERIFICAR', null::text;
        return;
    end if;
    select c.clave_serial into v_clave
    from public.compras_proveedor c
    where c.id::text = p_compra_id
      and right(regexp_replace(coalesce(c.cliente_whatsapp, ''), '\D', '', 'g'), 10) = right(v_numero, 10)
      and c.estado::text in ('ENTREGADO', 'ENTREGADO_INMEDIATO');
    if v_clave is null then
        return query select false, 'Este pedido no tiene accesos disponibles.', null::text;
        return;
    end if;
    insert into public.accesos_vistos (sesion_id, whatsapp, compra_id) values (v_sesion, v_numero, p_compra_id);
    return query select true, 'ok', v_clave;
end;
$$;

-- 5) Re-verificar una sesión existente con un código nuevo (sin crear otra sesión)
drop function if exists public.reverificar_sesion(text, text);
create function public.reverificar_sesion(p_token text, p_codigo text)
returns table (ok boolean, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_sesion bigint;
    v_numero text;
    r        record;
begin
    select s.sesion_id, s.whatsapp into v_sesion, v_numero from public.sesion_portal(p_token) s;
    if v_numero is null then
        return query select false, 'SESION_INVALIDA';
        return;
    end if;
    select * into r from public.verificar_otp(v_numero, p_codigo);
    if not r.ok then
        return query select false, r.mensaje;
        return;
    end if;
    -- verificar_otp creó una sesión nueva: se descarta y se renueva la actual
    delete from public.sesiones_cliente s where s.token_hash = public.hash_portal(r.token, 'sesion');
    update public.sesiones_cliente s set verificado_at = now() where s.id = v_sesion;
    return query select true, 'Identidad confirmada.';
end;
$$;

-- 6) Cerrar sesión
drop function if exists public.cerrar_sesion_portal(text);
create function public.cerrar_sesion_portal(p_token text)
returns table (ok boolean)
language sql
security definer
set search_path = ''
as $$
    update public.sesiones_cliente s set cerrada_at = now()
     where s.token_hash = public.hash_portal(p_token, 'sesion') and s.cerrada_at is null
    returning true;
$$;

-- Permisos: el portal (anon) solo usa estas 6 funciones
revoke all on function public.solicitar_otp(text) from public;
revoke all on function public.verificar_otp(text, text) from public;
revoke all on function public.mis_pedidos(text) from public;
revoke all on function public.ver_accesos(text, text) from public;
revoke all on function public.reverificar_sesion(text, text) from public;
revoke all on function public.cerrar_sesion_portal(text) from public;
grant execute on function public.solicitar_otp(text) to anon, authenticated;
grant execute on function public.verificar_otp(text, text) to anon, authenticated;
grant execute on function public.mis_pedidos(text) to anon, authenticated;
grant execute on function public.ver_accesos(text, text) to anon, authenticated;
grant execute on function public.reverificar_sesion(text, text) to anon, authenticated;
grant execute on function public.cerrar_sesion_portal(text) to anon, authenticated;

-- Verificación
select to_regprocedure('public.solicitar_otp(text)') is not null as rpc_otp,
       to_regprocedure('public.mis_pedidos(text)') is not null as rpc_historial,
       position('n.tipo <> ''OTP''' in pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure)) > 0 as cola_admite_otp;
