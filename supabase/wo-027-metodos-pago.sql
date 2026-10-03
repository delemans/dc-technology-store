-- =====================================================================
-- WO-027 · Métodos de pago electrónicos y cripto
-- Requiere: wo-014-pagos.sql y wo-015.sql. Idempotente: se puede ejecutar varias veces.
-- Aplicar: node herramientas/configurar-supabase.js --aplicar --archivo supabase/wo-027-metodos-pago.sql
--          (o pegarlo completo en Supabase → SQL Editor)
--
-- Qué cambia:
--   1. public.metodo_pago (enum de public.pagos) acepta todos los tipos del catálogo.
--   2. public.metodos_pago gana: tipo, categoría, moneda, red, memo, URL de pago, QR, instrucciones,
--      tasa en COP y orden. Las direcciones cripto se validan POR RED (una red equivocada = fondos perdidos).
--   3. RPC de admin para crear/editar (guardar_metodo_pago) y RPC pública SIN datos de cuenta
--      (metodos_pago_publicos) para que la tienda muestre los íconos de lo que está activo.
--   4. validar_pago acepta cualquier tipo del enum; las notificaciones nombran el método real.
-- Nada se activa solo: un método aparece en la tienda y en el bot solo si lo activas en el panel.
-- =====================================================================

-- 1) ENUM DE LOS PAGOS ------------------------------------------------------
-- (ADD VALUE IF NOT EXISTS es seguro de repetir; los valores nuevos se usan después del commit)
alter type public.metodo_pago add value if not exists 'LLAVE_BREB';
alter type public.metodo_pago add value if not exists 'BANCOLOMBIA';
alter type public.metodo_pago add value if not exists 'TRANSFERENCIA';
alter type public.metodo_pago add value if not exists 'PSE';
alter type public.metodo_pago add value if not exists 'ENLACE';
alter type public.metodo_pago add value if not exists 'PAYPAL';
alter type public.metodo_pago add value if not exists 'BINANCE_PAY';
alter type public.metodo_pago add value if not exists 'USDT';
alter type public.metodo_pago add value if not exists 'USDC';
alter type public.metodo_pago add value if not exists 'BTC';
alter type public.metodo_pago add value if not exists 'ETH';
alter type public.metodo_pago add value if not exists 'BNB';
alter type public.metodo_pago add value if not exists 'SOL';
alter type public.metodo_pago add value if not exists 'TRX';
alter type public.metodo_pago add value if not exists 'LTC';

-- 2) TABLA metodos_pago ----------------------------------------------------
alter table public.metodos_pago
    add column if not exists tipo                text,
    add column if not exists categoria           text,
    add column if not exists moneda              text,
    add column if not exists red                 text,
    add column if not exists memo                text,          -- tag/memo que exigen algunas redes o exchanges
    add column if not exists url_pago            text,          -- PSE, enlace de tarjeta, PayPal.me
    add column if not exists qr_url              text,          -- imagen del QR (https)
    add column if not exists instrucciones       text,
    add column if not exists tasa_cop            numeric(18, 2), -- COP por 1 unidad de la moneda cripto
    add column if not exists tasa_actualizada_at timestamptz,
    add column if not exists orden               smallint not null default 0,
    add column if not exists updated_at          timestamptz not null default now();

-- Filas existentes (Nequi / Daviplata / otras) → tipo y categoría
update public.metodos_pago
   set tipo = case
           when banco_alias ilike '%nequi%' then 'NEQUI'
           when banco_alias ilike '%davi%' then 'DAVIPLATA'
           when banco_alias ilike '%bancolombia%' then 'BANCOLOMBIA'
           when banco_alias ilike '%bre%b%' or banco_alias ilike '%llave%' then 'LLAVE_BREB'
           else 'TRANSFERENCIA' end
 where tipo is null;
update public.metodos_pago set categoria = 'electronico' where categoria is null;

-- Formato de dirección por red (mismas reglas que PlantillasWA.FORMATO_RED en plantillas-whatsapp.js)
create or replace function public.direccion_cripto_valida(p_red text, p_valor text)
returns boolean
language sql
immutable
set search_path = ''
as $$
    select case p_red
        when 'TRC20'       then p_valor ~ '^T[1-9A-HJ-NP-Za-km-z]{33}$'
        when 'BEP20'       then p_valor ~ '^0x[0-9a-fA-F]{40}$'
        when 'ERC20'       then p_valor ~ '^0x[0-9a-fA-F]{40}$'
        when 'POLYGON'     then p_valor ~ '^0x[0-9a-fA-F]{40}$'
        when 'ARBITRUM'    then p_valor ~ '^0x[0-9a-fA-F]{40}$'
        when 'BASE'        then p_valor ~ '^0x[0-9a-fA-F]{40}$'
        when 'SOL'         then p_valor ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
        when 'TON'         then p_valor ~ '^(EQ|UQ)[A-Za-z0-9_-]{46}$'
        when 'BTC'         then p_valor ~ '^(bc1[02-9ac-hj-np-z]{25,62}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$'
        when 'LTC'         then p_valor ~ '^(ltc1[02-9ac-hj-np-z]{25,62}|[LM3][1-9A-HJ-NP-Za-km-z]{26,33})$'
        when 'BINANCE_PAY' then p_valor ~ '^([0-9]{6,12}|[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+)$'
        else false
    end;
$$;

-- Reglas de integridad (se crean una sola vez)
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'metodos_pago_categoria_valida') then
        alter table public.metodos_pago add constraint metodos_pago_categoria_valida
            check (categoria in ('electronico', 'cripto'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'metodos_pago_tipo_valido') then
        alter table public.metodos_pago add constraint metodos_pago_tipo_valido check (tipo in (
            'NEQUI', 'DAVIPLATA', 'LLAVE_BREB', 'BANCOLOMBIA', 'TRANSFERENCIA', 'PSE', 'ENLACE', 'PAYPAL',
            'BINANCE_PAY', 'USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'SOL', 'TRX', 'LTC'));
    end if;
    -- Cripto: moneda + red obligatorias y la dirección debe tener el formato de ESA red
    if not exists (select 1 from pg_constraint where conname = 'metodos_pago_cripto_completo') then
        alter table public.metodos_pago add constraint metodos_pago_cripto_completo check (
            categoria <> 'cripto'
            or (moneda is not null and red is not null and public.direccion_cripto_valida(red, numero_cuenta)));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'metodos_pago_urls_https') then
        alter table public.metodos_pago add constraint metodos_pago_urls_https check (
            (url_pago is null or url_pago ~ '^https://') and (qr_url is null or qr_url ~ '^https://'));
    end if;
end;
$$;

alter table public.metodos_pago alter column tipo set not null;
alter table public.metodos_pago alter column categoria set not null;

-- 3) RPC DE ADMIN: crear / editar ------------------------------------------
drop function if exists public.guardar_metodo_pago(uuid, jsonb);
create function public.guardar_metodo_pago(p_id uuid, p_datos jsonb)
returns table (ok boolean, mensaje text, id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_tipo      text := upper(btrim(coalesce(p_datos->>'tipo', '')));
    v_categoria text;
    v_numero    text := nullif(btrim(coalesce(p_datos->>'numero_cuenta', '')), '');
    v_red       text := nullif(upper(btrim(coalesce(p_datos->>'red', ''))), '');
    v_moneda    text := nullif(upper(btrim(coalesce(p_datos->>'moneda', ''))), '');
    v_url       text := nullif(btrim(coalesce(p_datos->>'url_pago', '')), '');
    v_tasa      numeric := nullif(p_datos->>'tasa_cop', '')::numeric;
    v_id        uuid;
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede editar métodos de pago.', null::uuid;
        return;
    end if;

    v_categoria := case
        when v_tipo in ('NEQUI', 'DAVIPLATA', 'LLAVE_BREB', 'BANCOLOMBIA', 'TRANSFERENCIA', 'PSE', 'ENLACE', 'PAYPAL') then 'electronico'
        when v_tipo in ('BINANCE_PAY', 'USDT', 'USDC', 'BTC', 'ETH', 'BNB', 'SOL', 'TRX', 'LTC') then 'cripto'
    end;
    if v_categoria is null then
        return query select false, 'Tipo de método no reconocido.', null::uuid;
        return;
    end if;
    if v_tipo in ('PSE', 'ENLACE') and v_url is null then
        return query select false, 'Este método necesita el enlace de pago (https://…).', null::uuid;
        return;
    end if;
    if v_tipo not in ('PSE', 'ENLACE') and v_numero is null then
        return query select false, 'Falta el número, la llave, el correo o la dirección.', null::uuid;
        return;
    end if;
    if v_categoria = 'cripto' then
        if v_tipo = 'BINANCE_PAY' then
            v_red := 'BINANCE_PAY';
        end if;
        if v_red is null or v_moneda is null then
            return query select false, 'En cripto la moneda y la red son obligatorias.', null::uuid;
            return;
        end if;
        if not public.direccion_cripto_valida(v_red, v_numero) then
            return query select false, format('La dirección no tiene el formato de la red %s. Revísala: un error aquí es pérdida de fondos.', v_red), null::uuid;
            return;
        end if;
    end if;
    if v_tasa is not null and v_tasa <= 0 then
        return query select false, 'La tasa debe ser mayor que cero.', null::uuid;
        return;
    end if;

    if p_id is null then
        insert into public.metodos_pago (banco_alias, numero_cuenta, titular, activo, tipo, categoria, moneda, red, memo,
                                         url_pago, qr_url, instrucciones, tasa_cop, tasa_actualizada_at, orden, updated_at)
        values (coalesce(nullif(btrim(p_datos->>'banco_alias'), ''), v_tipo), v_numero, nullif(btrim(p_datos->>'titular'), ''),
                coalesce((p_datos->>'activo')::boolean, false), v_tipo, v_categoria, v_moneda, v_red,
                nullif(btrim(p_datos->>'memo'), ''), v_url, nullif(btrim(p_datos->>'qr_url'), ''),
                left(nullif(btrim(p_datos->>'instrucciones'), ''), 500), v_tasa, case when v_tasa is not null then now() end,
                coalesce((p_datos->>'orden')::smallint, 0), now())
        returning metodos_pago.id into v_id;
        return query select true, 'Método creado (inactivo hasta que lo actives).', v_id;
        return;
    end if;

    update public.metodos_pago m
       set banco_alias = coalesce(nullif(btrim(p_datos->>'banco_alias'), ''), v_tipo),
           numero_cuenta = v_numero,
           titular = nullif(btrim(p_datos->>'titular'), ''),
           activo = coalesce((p_datos->>'activo')::boolean, m.activo),
           tipo = v_tipo, categoria = v_categoria, moneda = v_moneda, red = v_red,
           memo = nullif(btrim(p_datos->>'memo'), ''),
           url_pago = v_url,
           qr_url = nullif(btrim(p_datos->>'qr_url'), ''),
           instrucciones = left(nullif(btrim(p_datos->>'instrucciones'), ''), 500),
           tasa_actualizada_at = case when v_tasa is distinct from m.tasa_cop then now() else m.tasa_actualizada_at end,
           tasa_cop = v_tasa,
           orden = coalesce((p_datos->>'orden')::smallint, m.orden),
           updated_at = now()
     where m.id = p_id;
    if not found then
        return query select false, 'El método no existe.', null::uuid;
        return;
    end if;
    return query select true, 'Método actualizado.', p_id;
end;
$$;
revoke all on function public.guardar_metodo_pago(uuid, jsonb) from public, anon;
grant execute on function public.guardar_metodo_pago(uuid, jsonb) to authenticated;

-- Activar / desactivar y actualizar solo la tasa (lo más frecuente)
drop function if exists public.estado_metodo_pago(uuid, boolean, numeric);
create function public.estado_metodo_pago(p_id uuid, p_activo boolean default null, p_tasa_cop numeric default null)
returns table (ok boolean, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede editar métodos de pago.';
        return;
    end if;
    if p_tasa_cop is not null and p_tasa_cop <= 0 then
        return query select false, 'La tasa debe ser mayor que cero.';
        return;
    end if;
    update public.metodos_pago m
       set activo = coalesce(p_activo, m.activo),
           tasa_cop = coalesce(p_tasa_cop, m.tasa_cop),
           tasa_actualizada_at = case when p_tasa_cop is not null then now() else m.tasa_actualizada_at end,
           updated_at = now()
     where m.id = p_id;
    if not found then
        return query select false, 'El método no existe.';
        return;
    end if;
    return query select true, 'Listo.';
end;
$$;
revoke all on function public.estado_metodo_pago(uuid, boolean, numeric) from public, anon;
grant execute on function public.estado_metodo_pago(uuid, boolean, numeric) to authenticated;

-- 4) RPC PÚBLICA: qué métodos mostrar en la tienda (SIN números, direcciones ni enlaces) ------
drop function if exists public.metodos_pago_publicos();
create function public.metodos_pago_publicos()
returns table (tipo text, categoria text, nombre text, moneda text, red text, orden smallint)
language sql
stable
security definer
set search_path = ''
as $$
    select m.tipo, m.categoria, m.banco_alias, m.moneda, m.red, m.orden
    from public.metodos_pago m
    where m.activo
    order by m.categoria, m.orden, m.banco_alias;
$$;
revoke all on function public.metodos_pago_publicos() from public;
grant execute on function public.metodos_pago_publicos() to anon, authenticated;

-- 5) validar_pago: cualquier valor del enum (antes solo NEQUI / DAVIPLATA) -----------------
do $$
declare
    def text;
begin
    if to_regprocedure('public.validar_pago(text, text, text, numeric, text)') is null then
        raise notice 'validar_pago no existe: aplica antes wo-014-pagos.sql';
        return;
    end if;
    def := pg_get_functiondef('public.validar_pago(text, text, text, numeric, text)'::regprocedure);
    def := replace(def, $r$if v_metodo not in ('NEQUI', 'DAVIPLATA') then$r$,
        $r$if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                   join pg_namespace n on n.oid = t.typnamespace
                   where n.nspname = 'public' and t.typname = 'metodo_pago' and e.enumlabel = v_metodo) then$r$);
    def := replace(def, 'Método no permitido: por ahora solo NEQUI o DAVIPLATA.', 'Método de pago no reconocido.');
    execute def;
end;
$$;

-- 6) Notificación "pago confirmado": nombre real del método (antes "Nequi o Daviplata" por defecto) --
do $$
declare
    def text;
begin
    if to_regprocedure('public.encolar_notificaciones_compra()') is null then
        return;
    end if;
    def := pg_get_functiondef('public.encolar_notificaciones_compra()'::regprocedure);
    def := replace(def, 'select initcap(lower(p.metodo::text)) into v_metodo',
        $r$select coalesce((select m.banco_alias from public.metodos_pago m where m.tipo = p.metodo::text and m.activo order by m.orden limit 1),
                        initcap(replace(lower(p.metodo::text), '_', ' '))) into v_metodo$r$);
    def := replace(def, $r$coalesce(v_metodo, 'Nequi o Daviplata')$r$, $r$coalesce(v_metodo, 'tu método de pago')$r$);
    execute def;
end;
$$;

-- Verificación
select (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'metodo_pago') as tipos_en_enum,
       to_regprocedure('public.guardar_metodo_pago(uuid, jsonb)') is not null as rpc_guardar,
       to_regprocedure('public.metodos_pago_publicos()') is not null as rpc_publica,
       (select count(*) from public.metodos_pago where activo) as metodos_activos;
