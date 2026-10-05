-- =====================================================================
-- WO-028 · Portal de clientes — FASE 0 (lo mínimo para cliente.html hoy)
-- Requiere: wo-015.sql. Idempotente.
-- Aplicar: node herramientas/configurar-supabase.js --aplicar --archivo supabase/wo-028-portal.sql
--
-- "Mis pedidos" busca también por el código que recibe el cliente (pedidos.codigo, ej. DC-7K2Q9).
-- Antes solo encontraba el id de la compra o el uuid del pedido.
-- Devuelve lo mismo que antes: nunca la clave completa, ni costos, ni el teléfono.
-- (Fases siguientes —sesión por código de WhatsApp, órdenes y comprobantes— en docs/WO-028-portal-clientes.md)
-- =====================================================================

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

select to_regprocedure('public.consultar_pedido(text)') is not null as consultar_pedido_actualizada;
