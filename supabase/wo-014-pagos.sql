-- =====================================================================
-- WO-014 · Validación de pagos centralizada en public.pagos
-- Requiere: wo-011.sql y wo-012.sql aplicados.
-- Ejecutar completo en Supabase → SQL Editor. Es idempotente.
--
-- Modelo:
--   · pagos           = un comprobante por PEDIDO (pedido_id uuid). n8n crea los PENDIENTE desde WhatsApp;
--                       el panel los APRUEBA / RECHAZA, o registra uno manual (origen 'ADMIN_MANUAL').
--   · compras_proveedor = compras al proveedor de ese pedido. Al aprobar el pago, las que estaban en
--                       PENDIENTE_PAGO avanzan a ESPERANDO_PROVEEDOR (o ENTREGADO_INMEDIATO si el admin
--                       decide entregar ya una compra que tiene cuenta asignada).
--   · compras_proveedor.pago_validado_at se CONSERVA: es la marca de tiempo del cambio de estado de la
--     compra (la usan el cupón de primera compra y la posventa), no un dato del pago.
-- =====================================================================

-- 1) MIGRAR Y ELIMINAR LAS COLUMNAS DUPLICADAS DE WO-011 ----------------
-- Si hay pagos registrados en compras_proveedor, se copian a 'pagos' antes de borrar las columnas.
-- Si alguno no se puede migrar (método distinto de NEQUI/DAVIPLATA o compra sin pedido), el script
-- se detiene SIN borrar nada, para no perder datos.
do $$
declare
    v_no_migrables integer;
begin
    if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'compras_proveedor' and column_name = 'referencia_pago'
    ) then
        return; -- ya se migró en una ejecución anterior
    end if;

    execute $q$
        select count(*) from public.compras_proveedor
        where referencia_pago is not null
          and (pedido_id is null or upper(btrim(metodo_pago)) not in ('NEQUI', 'DAVIPLATA'))
    $q$ into v_no_migrables;

    if v_no_migrables > 0 then
        raise exception 'Hay % pago(s) en compras_proveedor que no se pueden migrar a pagos (método distinto de NEQUI/DAVIPLATA o sin pedido_id). Revísalos antes de continuar.', v_no_migrables;
    end if;

    execute $q$
        insert into public.pagos (pedido_id, metodo, origen, referencia, monto_declarado_cop, monto_verificado_cop, estado, revisado_at)
        select distinct on (c.pedido_id)
               c.pedido_id::text::uuid,
               upper(btrim(c.metodo_pago))::public.metodo_pago,
               'ADMIN_MANUAL',
               c.referencia_pago,
               c.monto_pago,
               c.monto_pago,
               'APROBADO'::public.estado_pago,
               coalesce(c.pago_validado_at, now())
        from public.compras_proveedor c
        where c.referencia_pago is not null
          and not exists (
              select 1 from public.pagos p
              where p.pedido_id::text = c.pedido_id::text and p.referencia = c.referencia_pago
          )
        order by c.pedido_id, c.pago_validado_at desc nulls last
    $q$;
end;
$$;

drop index if exists public.compras_proveedor_referencia_pago_unica;
alter table public.compras_proveedor
    drop column if exists metodo_pago,
    drop column if exists referencia_pago,
    drop column if exists monto_pago;

-- Un mismo comprobante (método + referencia) no puede aprobarse dos veces
create unique index if not exists pagos_referencia_aprobada_unica
    on public.pagos (metodo, referencia)
    where estado = 'APROBADO' and referencia is not null;

-- 2) VALIDAR PAGO (solo admin autenticado) ------------------------------
-- Aprueba el comprobante PENDIENTE del pedido (el que dejó n8n) o, si no hay, registra uno manual.
-- En la misma transacción avanza las compras del pedido que estaban en PENDIENTE_PAGO.
create or replace function public.validar_pago(
    p_compra_id text,
    p_metodo    text,
    p_referencia text,
    p_monto     numeric,
    p_destino   text default 'ESPERANDO_PROVEEDOR'
)
returns table (ok boolean, mensaje text, pago_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_compra    public.compras_proveedor%rowtype;
    v_metodo    text := upper(btrim(coalesce(p_metodo, '')));
    v_ref       text := nullif(btrim(coalesce(p_referencia, '')), '');
    v_pago_id   text;
begin
    if auth.role() <> 'authenticated' then
        return query select false, 'Solo el administrador puede validar pagos.', null::text;
        return;
    end if;
    if v_metodo not in ('NEQUI', 'DAVIPLATA') then
        return query select false, 'Método no permitido: por ahora solo NEQUI o DAVIPLATA.', null::text;
        return;
    end if;
    if v_ref is null or p_monto is null or p_monto <= 0 then
        return query select false, 'Falta la referencia del comprobante o el monto.', null::text;
        return;
    end if;
    if p_destino not in ('ESPERANDO_PROVEEDOR', 'ENTREGADO_INMEDIATO') then
        return query select false, 'Destino no válido.', null::text;
        return;
    end if;

    select * into v_compra from public.compras_proveedor where id::text = p_compra_id for update;
    if not found then
        return query select false, 'La compra no existe.', null::text;
        return;
    end if;
    if v_compra.estado::text <> 'PENDIENTE_PAGO' then
        return query select false, 'La compra ya no está en PENDIENTE_PAGO.', null::text;
        return;
    end if;
    if v_compra.pedido_id is null then
        return query select false, 'La compra no tiene pedido_id: no se puede asociar el pago.', null::text;
        return;
    end if;
    if p_destino = 'ENTREGADO_INMEDIATO' and (v_compra.clave_serial is null or btrim(v_compra.clave_serial) = '') then
        return query select false, 'Para entregar ya, la compra debe tener cuenta/serial asignado.', null::text;
        return;
    end if;
    if exists (
        select 1 from public.pagos
        where metodo::text = v_metodo and referencia = v_ref and estado::text = 'APROBADO'
    ) then
        return query select false, 'Esa referencia ya fue aprobada en otro pago.', null::text;
        return;
    end if;

    -- a) Aprobar el comprobante pendiente del pedido (prioriza el que coincide en referencia)
    update public.pagos p
       set estado = 'APROBADO',
           metodo = v_metodo::public.metodo_pago,
           referencia = v_ref,
           monto_verificado_cop = p_monto,
           revisado_por = auth.uid(),
           revisado_at = now()
     where p.id = (
           select p2.id from public.pagos p2
           where p2.pedido_id::text = v_compra.pedido_id::text and p2.estado::text = 'PENDIENTE'
           order by (p2.referencia = v_ref) desc nulls last, p2.created_at desc
           limit 1
       )
    returning p.id::text into v_pago_id;

    -- b) Si n8n no había registrado comprobante, se crea uno manual
    if v_pago_id is null then
        insert into public.pagos (pedido_id, metodo, origen, referencia, monto_declarado_cop, monto_verificado_cop, estado, revisado_por, revisado_at)
        values (v_compra.pedido_id::text::uuid, v_metodo::public.metodo_pago, 'ADMIN_MANUAL', v_ref, p_monto, p_monto, 'APROBADO', auth.uid(), now())
        returning id::text into v_pago_id;
    end if;

    -- c) Avanzar las compras del pedido que esperaban el pago
    update public.compras_proveedor
       set estado = case when id = v_compra.id then p_destino::public.estado_compra
                         else 'ESPERANDO_PROVEEDOR'::public.estado_compra end,
           pago_validado_at = now(),
           entregado_at = case when id = v_compra.id and p_destino = 'ENTREGADO_INMEDIATO' then now() else entregado_at end
     where pedido_id::text = v_compra.pedido_id::text and estado::text = 'PENDIENTE_PAGO';

    return query select true, 'Pago aprobado.', v_pago_id;
end;
$$;

revoke all on function public.validar_pago(text, text, text, numeric, text) from public;
grant execute on function public.validar_pago(text, text, text, numeric, text) to authenticated;

-- 3) RECHAZAR PAGO (solo admin autenticado) -----------------------------
-- Las compras del pedido se quedan en PENDIENTE_PAGO: el cliente puede enviar otro comprobante.
create or replace function public.rechazar_pago(p_pago_id text, p_motivo text)
returns table (ok boolean, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.role() <> 'authenticated' then
        return query select false, 'Solo el administrador puede rechazar pagos.';
        return;
    end if;
    if nullif(btrim(coalesce(p_motivo, '')), '') is null then
        return query select false, 'Escribe el motivo del rechazo.';
        return;
    end if;

    update public.pagos
       set estado = 'RECHAZADO',
           motivo_rechazo = left(btrim(p_motivo), 300),
           revisado_por = auth.uid(),
           revisado_at = now()
     where id::text = p_pago_id and estado::text = 'PENDIENTE';

    if not found then
        return query select false, 'El pago no existe o ya fue revisado.';
        return;
    end if;
    return query select true, 'Pago rechazado.';
end;
$$;

revoke all on function public.rechazar_pago(text, text) from public;
grant execute on function public.rechazar_pago(text, text) to authenticated;

-- 4) COMPROBANTES PENDIENTES (solo admin autenticado) -------------------
-- Lista para el panel los pagos PENDIENTE con la compra en PENDIENTE_PAGO de su pedido.
create or replace function public.pagos_pendientes()
returns table (
    pago_id text, pedido_id text, compra_id text, producto text, metodo text, origen text,
    referencia text, monto_declarado_cop numeric, alertas text, comprobante_path text, created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
    select p.id::text, p.pedido_id::text,
           c.id::text,
           coalesce(nullif(c.referencia_externa::text, ''), c.variante_id::text),
           p.metodo::text, p.origen, p.referencia, p.monto_declarado_cop,
           p.alertas::text, p.comprobante_path::text, p.created_at
    from public.pagos p
    left join lateral (
        select c2.* from public.compras_proveedor c2
        where c2.pedido_id::text = p.pedido_id::text and c2.estado::text = 'PENDIENTE_PAGO'
        order by c2.id
        limit 1
    ) c on true
    where p.estado::text = 'PENDIENTE' and auth.role() = 'authenticated'
    order by p.created_at;
$$;

revoke all on function public.pagos_pendientes() from public;
grant execute on function public.pagos_pendientes() to authenticated;

-- 5) TIEMPO REAL: avisar al panel cuando n8n registre un comprobante -----
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pagos'
    ) then
        execute 'alter publication supabase_realtime add table public.pagos';
    end if;
end;
$$;
