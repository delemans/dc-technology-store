-- =====================================================================
-- WO-011 · Pagos, garantías y fidelización sobre public.compras_proveedor
-- Ejecutar completo en Supabase → SQL Editor. Es idempotente: se puede correr varias veces.
-- =====================================================================

-- 1) Columnas nuevas ----------------------------------------------------
alter table public.compras_proveedor
    add column if not exists cliente_whatsapp        text,
    add column if not exists garantia_dias           integer not null default 30,
    add column if not exists fecha_vencimiento       timestamptz,
    add column if not exists entregado_at            timestamptz,
    add column if not exists metodo_pago             text,
    add column if not exists referencia_pago         text,
    add column if not exists monto_pago              numeric(12, 2),
    add column if not exists pago_validado_at        timestamptz,
    add column if not exists satisfaccion_enviada_at timestamptz,
    add column if not exists renovacion_enviada_at   timestamptz,
    add column if not exists cupon_codigo            text,
    add column if not exists cupon_enviado_at        timestamptz;

-- Un mismo comprobante no puede validar dos compras
create unique index if not exists compras_proveedor_referencia_pago_unica
    on public.compras_proveedor (metodo_pago, referencia_pago)
    where referencia_pago is not null;

-- Un cupón no se repite
create unique index if not exists compras_proveedor_cupon_unico
    on public.compras_proveedor (cupon_codigo)
    where cupon_codigo is not null;

-- 2) Garantía automática ------------------------------------------------
-- Al asignar (o cambiar) clave_serial, o al cambiar garantia_dias:
--   fecha_vencimiento = ahora + garantia_dias
create or replace function public.calcular_vencimiento_garantia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.clave_serial is not null and btrim(new.clave_serial) <> '' and (
        tg_op = 'INSERT'
        or old.clave_serial is distinct from new.clave_serial
        or old.garantia_dias is distinct from new.garantia_dias
    ) then
        new.fecha_vencimiento := now() + make_interval(days => coalesce(new.garantia_dias, 30));
    end if;
    return new;
end;
$$;

drop trigger if exists trg_vencimiento_garantia on public.compras_proveedor;
create trigger trg_vencimiento_garantia
    before insert or update on public.compras_proveedor
    for each row execute function public.calcular_vencimiento_garantia();

-- 3) Función del portal de clientes ------------------------------------
-- Devuelve SOLO lo necesario para el cliente: nunca el serial completo, ni costos, ni el teléfono.
-- serial_final = últimos 4 caracteres (solo si el serial tiene 8 o más), para identificar la cuenta al reclamar.
drop function if exists public.consultar_pedido(text);

create function public.consultar_pedido(p_codigo text)
returns table (
    pedido_id         text,
    producto          text,
    estado            text,
    garantia_dias     integer,
    fecha_vencimiento timestamptz,
    serial_final      text
)
language sql
stable
security definer
set search_path = ''
as $$
    select c.pedido_id::text,
           coalesce(nullif(c.referencia_externa::text, ''), c.variante_id::text),
           c.estado::text,
           c.garantia_dias,
           c.fecha_vencimiento,
           case when length(c.clave_serial) >= 8 then right(c.clave_serial, 4) end
    from public.compras_proveedor c
    where c.id::text = p_codigo
    limit 1;
$$;

revoke all on function public.consultar_pedido(text) from public;
grant execute on function public.consultar_pedido(text) to anon, authenticated;

-- 4) Comprobaciones (solo lectura) --------------------------------------
-- a) ¿La columna 'estado' tiene una restricción CHECK o es un ENUM?
--    Si aparece una restricción, hay que añadirle 'PENDIENTE_PAGO' y 'ENTREGADO_INMEDIATO'.
select conname as restriccion, pg_get_constraintdef(oid) as definicion
from pg_constraint
where conrelid = 'public.compras_proveedor'::regclass and contype = 'c';

select column_name, data_type, udt_name
from information_schema.columns
where table_schema = 'public' and table_name = 'compras_proveedor' and column_name = 'estado';

-- b) Columnas reales de metodos_pago (el panel se adapta a ellas)
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'metodos_pago'
order by ordinal_position;
