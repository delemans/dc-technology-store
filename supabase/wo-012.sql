-- =====================================================================
-- WO-012 · Cupones, reseñas verificadas y estadísticas públicas reales
-- Requiere haber ejecutado antes supabase/wo-011.sql.
-- Ejecutar completo en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

-- 1) CUPONES PROMOCIONALES ----------------------------------------------
-- Los cupones de fidelidad (DC-XXXXXX) siguen viviendo en compras_proveedor.cupon_codigo.
create table if not exists public.cupones (
    codigo          text primary key check (codigo = upper(codigo)),
    descripcion     text,
    porcentaje      integer not null check (porcentaje between 1 and 90),
    solo_primera_compra boolean not null default false,
    usos_maximos    integer,               -- null = ilimitado
    usos            integer not null default 0,
    vence_at        timestamptz,           -- null = sin vencimiento
    activo          boolean not null default true,
    created_at      timestamptz not null default now()
);
alter table public.cupones enable row level security;
revoke all on table public.cupones from anon;   -- el público solo valida vía RPC, nunca lista cupones

insert into public.cupones (codigo, descripcion, porcentaje, solo_primera_compra)
values ('DCTECH2026', '10% OFF en tu primera compra', 10, true)
on conflict (codigo) do nothing;

-- Registro de canjes (un canje por compra validada)
alter table public.compras_proveedor
    add column if not exists cupon_aplicado      text,       -- cupón que usó ESTA compra
    add column if not exists cupon_canjeado_at   timestamptz; -- para cupones de fidelidad: cuándo se usó

-- 2) VALIDAR CUPÓN (público, solo lectura) -------------------------------
-- La tienda lo llama antes de mostrar el descuento. No consume el cupón.
create or replace function public.validar_cupon(p_codigo text)
returns table (valido boolean, porcentaje integer, tipo text, mensaje text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_codigo text := upper(btrim(coalesce(p_codigo, '')));
    c public.cupones%rowtype;
begin
    if v_codigo !~ '^[A-Z0-9-]{4,30}$' then
        return query select false, 0, null::text, 'Código inválido.';
        return;
    end if;

    select * into c from public.cupones where codigo = v_codigo;
    if found then
        if not c.activo then
            return query select false, 0, 'promo', 'Este cupón no está activo.';
        elsif c.vence_at is not null and c.vence_at < now() then
            return query select false, 0, 'promo', 'Este cupón ya venció.';
        elsif c.usos_maximos is not null and c.usos >= c.usos_maximos then
            return query select false, 0, 'promo', 'Este cupón ya alcanzó su límite de usos.';
        else
            return query select true, c.porcentaje, 'promo',
                case when c.solo_primera_compra then 'Válido para tu primera compra.' else 'Cupón aplicado.' end;
        end if;
        return;
    end if;

    -- Cupón de fidelidad generado en el panel admin
    if exists (
        select 1 from public.compras_proveedor
        where cupon_codigo = v_codigo and cupon_enviado_at is not null and cupon_canjeado_at is null
    ) then
        return query select true, 10, 'fidelidad', 'Cupón de fidelidad: 10% en tu próxima compra.';
        return;
    end if;

    return query select false, 0, null::text, 'Este cupón no existe o ya fue usado.';
end;
$$;

revoke all on function public.validar_cupon(text) from public;
grant execute on function public.validar_cupon(text) to anon, authenticated;

-- 3) CANJEAR CUPÓN (solo admin autenticado) ------------------------------
-- Se llama al validar el pago de la compra p_compra_id. Verifica de nuevo y consume el cupón.
create or replace function public.canjear_cupon(p_codigo text, p_compra_id text)
returns table (ok boolean, porcentaje integer, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_codigo   text := upper(btrim(coalesce(p_codigo, '')));
    v_compra   public.compras_proveedor%rowtype;
    c          public.cupones%rowtype;
begin
    if auth.role() <> 'authenticated' then
        return query select false, 0, 'Solo el administrador puede canjear cupones.';
        return;
    end if;

    select * into v_compra from public.compras_proveedor where id::text = p_compra_id;
    if not found then
        return query select false, 0, 'La compra no existe.';
        return;
    end if;
    if v_compra.cupon_aplicado is not null then
        return query select false, 0, 'Esta compra ya tiene un cupón aplicado.';
        return;
    end if;

    select * into c from public.cupones where codigo = v_codigo for update;
    if found then
        if not c.activo or (c.vence_at is not null and c.vence_at < now())
           or (c.usos_maximos is not null and c.usos >= c.usos_maximos) then
            return query select false, 0, 'El cupón no está vigente.';
            return;
        end if;
        -- Primera compra: el WhatsApp no debe tener otra compra con pago validado
        if c.solo_primera_compra then
            if v_compra.cliente_whatsapp is null then
                return query select false, 0, 'Registra el WhatsApp del cliente para verificar que es su primera compra.';
                return;
            end if;
            if exists (
                select 1 from public.compras_proveedor o
                where o.cliente_whatsapp = v_compra.cliente_whatsapp
                  and o.id <> v_compra.id
                  and o.pago_validado_at is not null
            ) then
                return query select false, 0, 'Este cliente ya tiene compras: el cupón es solo para la primera.';
                return;
            end if;
        end if;
        update public.cupones set usos = usos + 1 where codigo = v_codigo;
        update public.compras_proveedor set cupon_aplicado = v_codigo where id = v_compra.id;
        return query select true, c.porcentaje, 'Cupón canjeado.';
        return;
    end if;

    -- Cupón de fidelidad: se marca como usado en la compra que lo originó
    update public.compras_proveedor
       set cupon_canjeado_at = now()
     where cupon_codigo = v_codigo and cupon_enviado_at is not null and cupon_canjeado_at is null;
    if found then
        update public.compras_proveedor set cupon_aplicado = v_codigo where id = v_compra.id;
        return query select true, 10, 'Cupón de fidelidad canjeado.';
        return;
    end if;

    return query select false, 0, 'El cupón no existe o ya fue usado.';
end;
$$;

revoke all on function public.canjear_cupon(text, text) from public;
grant execute on function public.canjear_cupon(text, text) to authenticated;

-- 4) RESEÑAS VERIFICADAS ------------------------------------------------
-- La tabla 'resenas' ya existe; se añaden (si faltan) las columnas que usa la tienda.
alter table public.resenas
    add column if not exists calificacion   integer,
    add column if not exists comentario     text,
    add column if not exists nombre_publico text,
    add column if not exists producto       text,
    add column if not exists compra_id      text,
    add column if not exists visible        boolean not null default true,
    add column if not exists created_at     timestamptz not null default now();

create unique index if not exists resenas_una_por_compra on public.resenas (compra_id) where compra_id is not null;

-- Solo se puede reseñar una compra ENTREGADA, probando que eres el cliente
-- (ID de compra + últimos 4 dígitos del WhatsApp registrado en la compra).
create or replace function public.dejar_resena(
    p_compra_id text, p_whatsapp_final text, p_calificacion integer, p_comentario text, p_nombre text
)
returns table (ok boolean, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_compra public.compras_proveedor%rowtype;
begin
    if p_calificacion is null or p_calificacion not between 1 and 5 then
        return query select false, 'La calificación debe ser de 1 a 5 estrellas.';
        return;
    end if;
    if length(coalesce(p_comentario, '')) > 500 or length(coalesce(p_nombre, '')) > 40 then
        return query select false, 'El comentario (500) o el nombre (40) son demasiado largos.';
        return;
    end if;

    select * into v_compra from public.compras_proveedor where id::text = p_compra_id;
    if not found or v_compra.cliente_whatsapp is null
       or right(v_compra.cliente_whatsapp, 4) <> right(regexp_replace(coalesce(p_whatsapp_final, ''), '\D', '', 'g'), 4) then
        return query select false, 'No pudimos verificar tu compra. Revisa el ID y los últimos 4 dígitos de tu WhatsApp.';
        return;
    end if;
    if v_compra.estado not in ('PEDIDO_REALIZADO', 'ENTREGADO', 'ENTREGADO_INMEDIATO') then
        return query select false, 'Podrás calificar cuando tu pedido haya sido entregado.';
        return;
    end if;
    if exists (select 1 from public.resenas where compra_id = p_compra_id) then
        return query select false, 'Ya dejaste una reseña para esta compra. ¡Gracias!';
        return;
    end if;

    insert into public.resenas (calificacion, comentario, nombre_publico, producto, compra_id)
    values (
        p_calificacion,
        nullif(btrim(p_comentario), ''),
        coalesce(nullif(btrim(p_nombre), ''), 'Cliente verificado'),
        coalesce(nullif(v_compra.referencia_externa::text, ''), v_compra.variante_id::text),
        p_compra_id
    );
    return query select true, '¡Gracias! Tu reseña fue publicada como compra verificada.';
end;
$$;

revoke all on function public.dejar_resena(text, text, integer, text, text) from public;
grant execute on function public.dejar_resena(text, text, integer, text, text) to anon, authenticated;

-- Lectura pública: solo reseñas visibles y verificadas, sin datos del cliente
create or replace function public.resenas_publicas(p_limite integer default 30)
returns table (calificacion integer, comentario text, nombre_publico text, producto text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    select r.calificacion, r.comentario, r.nombre_publico, r.producto, r.created_at
    from public.resenas r
    where r.visible and r.compra_id is not null and r.calificacion between 1 and 5
    order by r.created_at desc
    limit least(greatest(coalesce(p_limite, 30), 1), 100);
$$;

revoke all on function public.resenas_publicas(integer) from public;
grant execute on function public.resenas_publicas(integer) to anon, authenticated;

-- 5) ESTADÍSTICAS PÚBLICAS REALES ----------------------------------------
create or replace function public.estadisticas_publicas()
returns table (ventas_completadas bigint, clientes_unicos bigint, resenas bigint, promedio numeric)
language sql
stable
security definer
set search_path = ''
as $$
    select
        (select count(*) from public.compras_proveedor
          where estado in ('PEDIDO_REALIZADO', 'ENTREGADO', 'ENTREGADO_INMEDIATO')),
        (select count(distinct cliente_whatsapp) from public.compras_proveedor
          where cliente_whatsapp is not null and estado in ('PEDIDO_REALIZADO', 'ENTREGADO', 'ENTREGADO_INMEDIATO')),
        (select count(*) from public.resenas where visible and compra_id is not null and calificacion between 1 and 5),
        (select round(avg(calificacion)::numeric, 1) from public.resenas where visible and compra_id is not null and calificacion between 1 and 5);
$$;

revoke all on function public.estadisticas_publicas() from public;
grant execute on function public.estadisticas_publicas() to anon, authenticated;

-- 6) COMPROBACIONES (solo lectura) ---------------------------------------
-- Columnas reales de 'resenas' y de 'pagos' (para revisar si hay columnas obligatorias
-- que dejar_resena no llene, y para decidir cómo unificar 'pagos').
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name in ('resenas', 'pagos')
order by table_name, ordinal_position;
