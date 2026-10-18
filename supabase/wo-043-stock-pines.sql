-- =====================================================================
-- WO-043 · Stock propio de pines (códigos comprados por lote, entrega al instante)
--   1. stock_codigos: los códigos que compraste (ANC, Reloadly, tienda…) listos para entregar. Solo el servidor
--      (n8n con la credencial de servicio) los lee; la web pública solo sabe SI hay o no (stock_publico).
--   2. cargar_stock(): agrega códigos (los repetidos se ignoran). Lo usa el bot con "#stock …" desde tu WhatsApp.
--   3. entregar_desde_stock(): toma UN código disponible (bloqueo de fila: dos pedidos nunca reciben el mismo), lo
--      marca entregado y deja el pedido ENTREGADO con la garantía activa (entregar_manual de wo-042). Si no hay stock,
--      deja el pedido con el pago confirmado (PEDIDO_REALIZADO) para comprarlo a mano. Idempotente por referencia.
--   4. stock_resumen(): disponibles y entregados por producto (para "#stock" sin nada más).
--   5. stock_publico(): producto/variante con stock (sin códigos) → la tienda muestra "⚡ Entrega inmediata".
-- Requiere wo-042 (entregar_manual). Ejecutar en Supabase → SQL Editor. Es idempotente.
-- =====================================================================

do $$
begin
    if to_regprocedure('public.entregar_manual(text, text, text)') is null then
        raise exception 'Nada se aplicó. Falta entregar_manual(): aplica antes supabase/wo-042-pedidos-whatsapp.sql.';
    end if;
end;
$$;

-- 1) Tabla de códigos -----------------------------------------------------------------------------------
create table if not exists public.stock_codigos (
    id            bigint generated always as identity primary key,
    producto_id   text not null check (producto_id ~ '^[a-z0-9-]{2,120}$'),
    variante      text not null check (length(variante) between 1 and 120),
    codigo        text not null check (length(codigo) between 4 and 200),
    costo         numeric(12, 2),
    origen        text not null default 'manual' check (length(origen) <= 60),
    estado        text not null default 'DISPONIBLE' check (estado in ('DISPONIBLE', 'ENTREGADO', 'ANULADO')),
    referencia    text check (referencia is null or referencia ~ '^DC-[A-Z0-9]{4,8}$'),
    cargado_at    timestamptz not null default now(),
    entregado_at  timestamptz,
    unique (producto_id, codigo)
);
create index if not exists stock_codigos_disponibles on public.stock_codigos (producto_id, variante, id) where estado = 'DISPONIBLE';
create unique index if not exists stock_codigos_por_pedido on public.stock_codigos (referencia) where referencia is not null;
alter table public.stock_codigos enable row level security;
-- Sin políticas: nadie con la llave pública (anon/authenticated) ve ni toca los códigos; solo las funciones de abajo
revoke all on table public.stock_codigos from public, anon, authenticated;

-- 2) Cargar códigos --------------------------------------------------------------------------------------
drop function if exists public.cargar_stock(text, text, text[], numeric, text);
create function public.cargar_stock(p_producto_id text, p_variante text, p_codigos text[], p_costo numeric default null, p_origen text default 'manual')
returns table (cargados integer, repetidos integer, disponibles integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_codigo text;
    v_ok integer := 0;
    v_rep integer := 0;
begin
    foreach v_codigo in array coalesce(p_codigos, '{}'::text[]) loop
        v_codigo := btrim(v_codigo);
        continue when length(v_codigo) < 4;
        insert into public.stock_codigos (producto_id, variante, codigo, costo, origen)
        values (p_producto_id, p_variante, v_codigo, p_costo, coalesce(nullif(btrim(p_origen), ''), 'manual'))
        on conflict (producto_id, codigo) do nothing;
        if found then v_ok := v_ok + 1; else v_rep := v_rep + 1; end if;
    end loop;
    return query select v_ok, v_rep,
        (select count(*)::integer from public.stock_codigos s where s.producto_id = p_producto_id and s.variante = p_variante and s.estado = 'DISPONIBLE');
end;
$$;
revoke all on function public.cargar_stock(text, text, text[], numeric, text) from public, anon, authenticated;
grant execute on function public.cargar_stock(text, text, text[], numeric, text) to service_role;

-- 3) Entregar desde el stock -------------------------------------------------------------------------------
drop function if exists public.entregar_desde_stock(text, text, text);
create function public.entregar_desde_stock(p_referencia text, p_producto_id text, p_variante text)
returns table (ok boolean, codigo text, quedan integer, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_ref text := upper(btrim(coalesce(p_referencia, '')));
    v_id bigint;
    v_codigo text;
    v_quedan integer;
    v_res record;
begin
    -- Ya se le entregó un código a este pedido (reintento del bot): el mismo código, sin gastar otro
    select s.codigo into v_codigo from public.stock_codigos s where s.referencia = v_ref;
    if v_codigo is not null then
        return query select true, v_codigo,
            (select count(*)::integer from public.stock_codigos s where s.producto_id = p_producto_id and s.variante = p_variante and s.estado = 'DISPONIBLE'),
            'Ya entregado desde el stock.'::text;
        return;
    end if;
    if not exists (select 1 from public.triangulaciones t where t.referencia = v_ref and t.estado not in ('ENTREGADO', 'CANCELADO')) then
        return query select false, null::text, null::integer, 'Ese pedido no existe o ya está cerrado.'::text;
        return;
    end if;
    select s.id, s.codigo into v_id, v_codigo
      from public.stock_codigos s
     where s.producto_id = p_producto_id and s.variante = p_variante and s.estado = 'DISPONIBLE'
     order by s.id
     limit 1
     for update skip locked;
    if v_id is null then
        -- Sin stock: el pago queda confirmado y el pedido sigue el camino manual (comprar en ANC)
        select * into v_res from public.entregar_manual(v_ref, 'PEDIDO_REALIZADO', null);
        return query select false, null::text, 0, 'SIN_STOCK'::text;
        return;
    end if;
    update public.stock_codigos s set estado = 'ENTREGADO', referencia = v_ref, entregado_at = now() where s.id = v_id;
    select * into v_res from public.entregar_manual(v_ref, 'ENTREGADO', 'PIN ' || v_codigo);
    if not coalesce(v_res.ok, false) then
        raise exception 'No se pudo marcar entregado %: %', v_ref, v_res.mensaje; -- deshace la toma del código
    end if;
    select count(*)::integer into v_quedan from public.stock_codigos s where s.producto_id = p_producto_id and s.variante = p_variante and s.estado = 'DISPONIBLE';
    return query select true, v_codigo, v_quedan, 'Entregado desde el stock.'::text;
end;
$$;
revoke all on function public.entregar_desde_stock(text, text, text) from public, anon, authenticated;
grant execute on function public.entregar_desde_stock(text, text, text) to service_role;

-- 4) Resumen para el director -----------------------------------------------------------------------------
drop function if exists public.stock_resumen();
create function public.stock_resumen()
returns table (producto_id text, variante text, disponibles integer, entregados_30d integer)
language sql
stable
security definer
set search_path = ''
as $$
    select s.producto_id, s.variante,
           count(*) filter (where s.estado = 'DISPONIBLE')::integer,
           count(*) filter (where s.estado = 'ENTREGADO' and s.entregado_at > now() - interval '30 days')::integer
      from public.stock_codigos s
     group by s.producto_id, s.variante
     order by s.producto_id, s.variante;
$$;
revoke all on function public.stock_resumen() from public, anon, authenticated;
grant execute on function public.stock_resumen() to service_role;

-- 5) Público: solo si hay stock (nunca los códigos) ---------------------------------------------------------
drop function if exists public.stock_publico();
create function public.stock_publico()
returns table (producto_id text, variante text)
language sql
stable
security definer
set search_path = ''
as $$
    select distinct s.producto_id, s.variante from public.stock_codigos s where s.estado = 'DISPONIBLE';
$$;
revoke all on function public.stock_publico() from public;
grant execute on function public.stock_publico() to anon, authenticated, service_role;

-- Verificación
select to_regclass('public.stock_codigos') is not null as ok_tabla,
       to_regprocedure('public.cargar_stock(text, text, text[], numeric, text)') is not null as ok_cargar,
       to_regprocedure('public.entregar_desde_stock(text, text, text)') is not null as ok_entregar,
       to_regprocedure('public.stock_publico()') is not null as ok_publico;
