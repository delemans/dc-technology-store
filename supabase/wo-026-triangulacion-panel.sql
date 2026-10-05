-- =====================================================================
-- WO-026 · Conecta la triangulación (pedidos digitales del bot) al panel y al ciclo de garantías
-- Requiere: wo-024-triangulacion.sql. Idempotente.
-- Aplicar: node herramientas/configurar-supabase.js --aplicar --archivo supabase/wo-026-triangulacion-panel.sql
--
-- Qué hace:
--   vincular_triangulacion(ref)      → crea (o reutiliza) el CLIENTE, el PEDIDO (canal WHATSAPP) y la
--                                      COMPRA AL PROVEEDOR en PENDIENTE_PAGO. Así el pedido aparece en el
--                                      panel ("Pagos por verificar"), y al validar el pago sigue el flujo normal.
--   avanzar_compra_triangulada(...)  → PEDIDO_REALIZADO al pagarle al proveedor; ENTREGADO + clave al final
--                                      (dispara la garantía, el portal y las notificaciones existentes).
--   pedidos.estado sigue a la compra (ESPERANDO_PAGO → PAGADO → ESPERANDO_PROVEEDOR → ENTREGADO; cierres
--                                      a CANCELADO / EXPIRADO / EN_REVISION), también si el admin actúa en el panel.
--   triangulaciones_abiertas()       → lo que n8n usa para enrutar mensajes, con el estado de la compra
--                                      (para no pagarle al proveedor si el cliente aún no pagó).
--
-- Defensivo: la estructura de clientes / variantes / productos / proveedores se lee en el momento.
-- Si algo no cuadra (no hay variante para ese producto, falta una columna obligatoria…), NO se inserta
-- nada (todo o nada), el motivo queda en triangulaciones.vinculo_error y el bot sigue como antes.
-- =====================================================================

alter table public.triangulaciones
    add column if not exists pedido_id     uuid,
    add column if not exists compra_id     text,
    add column if not exists vinculo_error text;

-- Mapeo explícito catálogo de la tienda (productos.json) → variante de la base, para los nombres que
-- no coincidan solos. Ej.:
--   insert into public.variantes_catalogo values ('Max (HBO)', 'Pantalla 1 Mes', '<uuid de la variante>');
create table if not exists public.variantes_catalogo (
    producto_catalogo text not null,
    variante_catalogo text not null default '',
    variante_id       uuid not null references public.variantes (id),
    primary key (producto_catalogo, variante_catalogo)
);
alter table public.variantes_catalogo enable row level security;
revoke all on table public.variantes_catalogo from anon;
drop policy if exists variantes_catalogo_admin on public.variantes_catalogo;
create policy variantes_catalogo_admin on public.variantes_catalogo
    for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- Texto comparable: minúsculas, sin tildes ni símbolos ("Max (HBO)" = "max hbo")
create or replace function public.clave_texto(p text)
returns text
language sql
immutable
set search_path = ''
as $$
    select regexp_replace(lower(translate(coalesce(p, ''), 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun')), '[^a-z0-9]+', '', 'g');
$$;

-- ¿Existe la columna? (para escribir solo en columnas reales)
create or replace function public.columna_existe(p_tabla text, p_columna text)
returns boolean
language sql
stable
set search_path = ''
as $$
    select exists (select 1 from information_schema.columns c
                   where c.table_schema = 'public' and c.table_name = p_tabla and c.column_name = p_columna);
$$;

-- Primer valor del enum de una columna que esté en la lista de preferidos
create or replace function public.valor_enum(p_tabla text, p_columna text, p_preferidos text[])
returns text
language sql
stable
set search_path = ''
as $$
    select e.enumlabel
    from information_schema.columns c
    join pg_type t on t.typname = c.udt_name
    join pg_namespace n on n.oid = t.typnamespace and n.nspname = c.udt_schema
    join pg_enum e on e.enumtypid = t.oid
    where c.table_schema = 'public' and c.table_name = p_tabla and c.column_name = p_columna
      and e.enumlabel = any (p_preferidos)
    order by array_position(p_preferidos, e.enumlabel)
    limit 1;
$$;

-- 1) VINCULAR -----------------------------------------------------------------
drop function if exists public.vincular_triangulacion(text);
create function public.vincular_triangulacion(p_referencia text)
returns table (ok boolean, mensaje text, pedido_id uuid, compra_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    t             public.triangulaciones%rowtype;
    v_variante    uuid;
    v_candidatas  uuid[];
    v_cliente     uuid;
    v_pedido      uuid;
    v_compra      text;
    v_proveedor   uuid;
    v_col_wa      text;
    v_col_nombre  text;
    v_estado_ped  text;
    v_metodo      text;
    v_tipo_estado text;
    v_tipo_metodo text;
    v_cols        text[];
    v_vals        text[];
    v_error       text;
begin
    select * into t from public.triangulaciones x where x.referencia = p_referencia for update;
    if not found then
        return query select false, 'Triangulación no encontrada.', null::uuid, null::text;
        return;
    end if;
    if t.pedido_id is not null then
        return query select true, 'Ya estaba vinculada.', t.pedido_id, t.compra_id;
        return;
    end if;

    begin  -- todo o nada: cualquier error deshace lo insertado en este bloque
        -- a) Variante: mapeo explícito; si no, nombre de producto + nombre de variante (debe ser ÚNICA)
        select vc.variante_id into v_variante
        from public.variantes_catalogo vc
        where public.clave_texto(vc.producto_catalogo) = public.clave_texto(t.producto)
          and public.clave_texto(vc.variante_catalogo) = public.clave_texto(t.variante)
        limit 1;
        if v_variante is null and public.columna_existe('variantes', 'nombre') and public.columna_existe('variantes', 'producto_id')
           and public.columna_existe('productos', 'nombre') then
            execute 'select array_agg(v.id) from public.variantes v join public.productos p on p.id = v.producto_id
                     where public.clave_texto(p.nombre) = public.clave_texto($1) and public.clave_texto(v.nombre) = public.clave_texto($2)'
               into v_candidatas using t.producto, t.variante;
            if coalesce(array_length(v_candidatas, 1), 0) = 1 then
                v_variante := v_candidatas[1];
            elsif coalesce(array_length(v_candidatas, 1), 0) > 1 then
                raise exception 'Hay % variantes que coinciden con "%" / "%": regístrala en variantes_catalogo.', array_length(v_candidatas, 1), t.producto, t.variante;
            end if;
        end if;
        if v_variante is null then
            raise exception 'No encontré la variante de la base para "%" / "%": regístrala en variantes_catalogo.', t.producto, t.variante;
        end if;

        -- b) Cliente por WhatsApp (busca la columna real; si no existe, se crea con el número y el nombre)
        select c.column_name into v_col_wa from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'clientes'
          and c.column_name = any (array['whatsapp', 'cliente_whatsapp', 'telefono', 'celular', 'numero', 'telefono_whatsapp'])
        order by array_position(array['whatsapp', 'cliente_whatsapp', 'telefono', 'celular', 'numero', 'telefono_whatsapp'], c.column_name::text)
        limit 1;
        if v_col_wa is null then
            raise exception 'La tabla clientes no tiene una columna de WhatsApp/teléfono reconocible.';
        end if;
        execute format('select id from public.clientes where regexp_replace(%I::text, ''\D'', '''', ''g'') in ($1, $2) limit 1', v_col_wa)
           into v_cliente using t.cliente, right(t.cliente, 10);
        if v_cliente is null then
            select c.column_name into v_col_nombre from information_schema.columns c
            where c.table_schema = 'public' and c.table_name = 'clientes'
              and c.column_name = any (array['nombre', 'nombre_completo', 'alias'])
            order by array_position(array['nombre', 'nombre_completo', 'alias'], c.column_name::text)
            limit 1;
            if v_col_nombre is not null then
                execute format('insert into public.clientes (%I, %I) values ($1, $2) returning id', v_col_wa, v_col_nombre)
                   into v_cliente using t.cliente, coalesce(nullif(t.cliente_nombre, ''), 'Cliente WhatsApp');
            else
                execute format('insert into public.clientes (%I) values ($1) returning id', v_col_wa) into v_cliente using t.cliente;
            end if;
        end if;

        -- c) Pedido (canal WHATSAPP, pendiente de pago). El método se confirma al validar el pago en el panel.
        v_estado_ped := public.valor_enum('pedidos', 'estado', array['ESPERANDO_PAGO', 'PENDIENTE_PAGO', 'PENDIENTE', 'CREADO', 'NUEVO']);
        if v_estado_ped is null then
            raise exception 'No reconozco un estado "pendiente de pago" en pedidos.estado.';
        end if;
        v_metodo := coalesce(
            public.valor_enum('pedidos', 'metodo_pago', array(select m.tipo from public.metodos_pago m where m.activo order by m.categoria, m.orden)),
            public.valor_enum('pedidos', 'metodo_pago', array['NEQUI', 'DAVIPLATA']));
        if v_metodo is null then
            raise exception 'No reconozco un valor para pedidos.metodo_pago.';
        end if;
        select format('%I.%I', c.udt_schema, c.udt_name) into v_tipo_estado from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'pedidos' and c.column_name = 'estado';
        select format('%I.%I', c.udt_schema, c.udt_name) into v_tipo_metodo from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = 'pedidos' and c.column_name = 'metodo_pago';

        execute format('insert into public.pedidos (codigo, cliente_id, variante_id, cantidad, precio_cop, monto_unico_offset,
                                                    monto_a_pagar_cop, metodo_pago, estado, canal)
                        values ($1, $2, $3, 1, $4, 0, $4, $5::%s, $6::%s, ''WHATSAPP'') returning id', v_tipo_metodo, v_tipo_estado)
           into v_pedido using t.referencia, v_cliente, v_variante, round(coalesce(t.precio_venta, 0))::bigint, v_metodo, v_estado_ped;

        -- d) Proveedor (ALL NECESSARY COLOMBIA) si la tabla tiene nombre
        if public.columna_existe('proveedores', 'nombre') then
            execute 'select id from public.proveedores where nombre ilike ''%necess%'' or nombre ilike ''%necesar%'' order by 1 limit 1' into v_proveedor;
        end if;

        -- e) Compra al proveedor en PENDIENTE_PAGO: solo columnas que existen
        v_cols := array['pedido_id', 'variante_id', 'estado'];
        v_vals := array['$1', '$2', '''PENDIENTE_PAGO''::public.estado_compra'];
        if v_proveedor is not null then v_cols := array_append(v_cols, 'proveedor_id'::text); v_vals := array_append(v_vals, '$3'::text); end if;
        if public.columna_existe('compras_proveedor', 'cliente_whatsapp') then v_cols := array_append(v_cols, 'cliente_whatsapp'::text); v_vals := array_append(v_vals, '$4'::text); end if;
        if public.columna_existe('compras_proveedor', 'referencia_externa') then v_cols := array_append(v_cols, 'referencia_externa'::text); v_vals := array_append(v_vals, '$5'::text); end if;
        if public.columna_existe('compras_proveedor', 'monto_cop') then v_cols := array_append(v_cols, 'monto_cop'::text); v_vals := array_append(v_vals, '$6'::text); end if;
        execute format('insert into public.compras_proveedor (%s) values (%s) returning id::text',
                       array_to_string(array(select quote_ident(x) from unnest(v_cols) x), ', '), array_to_string(v_vals, ', '))
           into v_compra
           using v_pedido, v_variante, v_proveedor, t.cliente,
                 concat_ws(' – ', t.producto, nullif(t.variante, '')), t.precio_venta;

        update public.triangulaciones x
           set pedido_id = v_pedido, compra_id = v_compra, vinculo_error = null
         where x.referencia = p_referencia;
    exception when others then
        v_error := left(sqlerrm, 400);
    end;

    if v_error is not null then
        update public.triangulaciones x set vinculo_error = v_error where x.referencia = p_referencia;
        return query select false, v_error, null::uuid, null::text;
        return;
    end if;
    return query select true, 'Pedido y compra creados en el panel.', v_pedido, v_compra;
end;
$$;

-- 2) AVANZAR LA COMPRA ----------------------------------------------------------
drop function if exists public.avanzar_compra_triangulada(text, text, numeric, text);
create function public.avanzar_compra_triangulada(p_referencia text, p_estado text, p_costo numeric default null, p_clave text default null)
returns table (ok boolean, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    t        public.triangulaciones%rowtype;
    v_actual text;
begin
    select * into t from public.triangulaciones x where x.referencia = p_referencia;
    if not found or t.compra_id is null then
        return query select false, 'El pedido no está vinculado al panel.';
        return;
    end if;
    select c.estado::text into v_actual from public.compras_proveedor c where c.id::text = t.compra_id;

    if p_estado = 'PEDIDO_REALIZADO' then
        if v_actual = 'PENDIENTE_PAGO' then
            return query select false, 'El cliente aún no ha pagado: valida su pago en el panel primero.';
            return;
        end if;
        update public.compras_proveedor c
           set estado = 'PEDIDO_REALIZADO', costo_real_cop = coalesce(round(p_costo)::bigint, c.costo_real_cop), comprado_at = now()
         where c.id::text = t.compra_id and c.estado::text = 'ESPERANDO_PROVEEDOR';
    elsif p_estado = 'ENTREGADO' then
        if nullif(btrim(coalesce(p_clave, '')), '') is null then
            return query select false, 'Falta la clave entregada.';
            return;
        end if;
        -- clave_serial activa la garantía (trigger de wo-011) y ENTREGADO las notificaciones (wo-015)
        update public.compras_proveedor c
           set estado = 'ENTREGADO', clave_serial = p_clave, entregado_at = now(), recibido_at = coalesce(c.recibido_at, now())
         where c.id::text = t.compra_id and c.estado::text in ('ESPERANDO_PROVEEDOR', 'PEDIDO_REALIZADO', 'RECIBIDA');
        -- pedidos.estado y entregado_at los pone el trigger de sincronización (sección 2b)
    else
        return query select false, 'Estado no permitido.';
        return;
    end if;

    if not found then
        return query select false, format('La compra está en %s: no se cambió.', coalesce(v_actual, 'un estado desconocido'));
        return;
    end if;
    return query select true, format('Compra en %s.', p_estado);
end;
$$;

-- 2b) ESTADO DEL PEDIDO (pedidos.estado) SINCRONIZADO CON LA COMPRA Y LA TRIANGULACIÓN -----
-- Valores reales del enum: ESPERANDO_PAGO, EN_VALIDACION, PAGADO, PENDIENTE_COMPRA, ESPERANDO_PROVEEDOR,
-- EN_REVISION, ENTREGADO, RECHAZADO, EXPIRADO, CANCELADO, REEMBOLSADO.
--   compra ESPERANDO_PROVEEDOR (pago validado en el panel) → pedido PAGADO (+ pagado_at)
--   compra PEDIDO_REALIZADO (#pago al proveedor)           → pedido ESPERANDO_PROVEEDOR
--   compra ENTREGADO / ENTREGADO_INMEDIATO                 → pedido ENTREGADO (+ entregado_at)
--   triangulación CANCELADO / AGOTADO / VENCIDO:
--       sin pago → pedido CANCELADO / EXPIRADO y compra CANCELADA;  ya pagado → pedido EN_REVISION (reembolso o entrega manual)
-- Solo avanza (nunca retrocede) y un estado final no se mueve. Solo aplica a pedidos de la triangulación.

create or replace function public.cambiar_estado_pedido(p_pedido uuid, p_estado text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_orden   constant text[] := array['ESPERANDO_PAGO', 'EN_VALIDACION', 'PAGADO', 'PENDIENTE_COMPRA', 'ESPERANDO_PROVEEDOR', 'EN_REVISION', 'ENTREGADO'];
    v_finales constant text[] := array['ENTREGADO', 'RECHAZADO', 'EXPIRADO', 'CANCELADO', 'REEMBOLSADO'];
    v_actual  text;
    v_tipo    text;
begin
    if p_pedido is null or public.valor_enum('pedidos', 'estado', array[p_estado]) is null then
        return false;  -- valor que no existe en el enum de esta base: no se toca nada
    end if;
    select p.estado::text into v_actual from public.pedidos p where p.id = p_pedido for update;
    if not found or v_actual = p_estado or v_actual = any (v_finales) then
        return false;
    end if;
    if p_estado = any (v_orden) and array_position(v_orden, p_estado) < coalesce(array_position(v_orden, v_actual), 0) then
        return false;  -- no retrocede
    end if;
    select format('%I.%I', c.udt_schema, c.udt_name) into v_tipo from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'pedidos' and c.column_name = 'estado';
    execute format('update public.pedidos
                       set estado = $1::%s,
                           updated_at = now(),
                           pagado_at = case when $1 = ''PAGADO'' then coalesce(pagado_at, now()) else pagado_at end,
                           entregado_at = case when $1 = ''ENTREGADO'' then coalesce(entregado_at, now()) else entregado_at end
                     where id = $2', v_tipo)
        using p_estado, p_pedido;
    return true;
end;
$$;
revoke all on function public.cambiar_estado_pedido(uuid, text) from public, anon, authenticated;

-- Compra → pedido (también cuando el admin valida o entrega desde el panel)
create or replace function public.sincronizar_pedido_desde_compra()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.pedido_id is null or new.estado is not distinct from old.estado
       or not exists (select 1 from public.triangulaciones t where t.compra_id = new.id::text) then
        return new;
    end if;
    case new.estado::text
        when 'ESPERANDO_PROVEEDOR' then
            perform public.cambiar_estado_pedido(new.pedido_id, 'PAGADO');
        when 'PEDIDO_REALIZADO' then
            perform public.cambiar_estado_pedido(new.pedido_id, 'PAGADO');           -- por si se saltó el paso
            perform public.cambiar_estado_pedido(new.pedido_id, 'ESPERANDO_PROVEEDOR');
        when 'ENTREGADO', 'ENTREGADO_INMEDIATO' then
            perform public.cambiar_estado_pedido(new.pedido_id, 'PAGADO');           -- entrega inmediata: también quedó pagado
            perform public.cambiar_estado_pedido(new.pedido_id, 'ENTREGADO');
        else
            null;
    end case;
    return new;
end;
$$;

drop trigger if exists trg_sincronizar_pedido_desde_compra on public.compras_proveedor;
create trigger trg_sincronizar_pedido_desde_compra
    after update of estado on public.compras_proveedor
    for each row execute function public.sincronizar_pedido_desde_compra();

-- Triangulación cerrada → pedido y compra
create or replace function public.cerrar_pedido_triangulado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_pedido text;
begin
    if new.pedido_id is null or new.estado is not distinct from old.estado
       or new.estado not in ('CANCELADO', 'AGOTADO', 'VENCIDO') then
        return new;
    end if;
    select p.estado::text into v_pedido from public.pedidos p where p.id = new.pedido_id;
    if v_pedido in ('ESPERANDO_PAGO', 'EN_VALIDACION') then
        -- El cliente no pagó: se cierra todo (la compra CANCELADA también cancela sus avisos pendientes, wo-015)
        perform public.cambiar_estado_pedido(new.pedido_id, case when new.estado = 'VENCIDO' then 'EXPIRADO' else 'CANCELADO' end);
        update public.compras_proveedor c set estado = 'CANCELADA'
         where c.id::text = new.compra_id and c.estado::text = 'PENDIENTE_PAGO';
    else
        -- Ya pagó: queda para que el administrador decida (reembolso o entrega manual)
        perform public.cambiar_estado_pedido(new.pedido_id, 'EN_REVISION');
    end if;
    return new;
end;
$$;

drop trigger if exists trg_cerrar_pedido_triangulado on public.triangulaciones;
create trigger trg_cerrar_pedido_triangulado
    after update of estado on public.triangulaciones
    for each row execute function public.cerrar_pedido_triangulado();

revoke all on function public.sincronizar_pedido_desde_compra() from public, anon, authenticated;
revoke all on function public.cerrar_pedido_triangulado() from public, anon, authenticated;

-- 3) PEDIDOS ABIERTOS PARA EL ENRUTADOR DE n8n (con el estado de la compra) --------
drop function if exists public.triangulaciones_abiertas();
create function public.triangulaciones_abiertas()
returns table (referencia text, estado text, esperando text, resume_url text, wamid_cotizacion text,
               wamid_pago text, compra_id text, estado_compra text)
language sql
stable
security definer
set search_path = ''
as $$
    select t.referencia, t.estado, t.esperando, t.resume_url, t.wamid_cotizacion, t.wamid_pago, t.compra_id,
           (select c.estado::text from public.compras_proveedor c where c.id::text = t.compra_id)
    from public.triangulaciones t
    where t.estado not in ('ENTREGADO', 'CANCELADO', 'VENCIDO', 'AGOTADO')
    order by t.id desc
    limit 50;
$$;

-- Solo n8n (credencial de servidor)
revoke all on function public.vincular_triangulacion(text) from public, anon, authenticated;
revoke all on function public.avanzar_compra_triangulada(text, text, numeric, text) from public, anon, authenticated;
revoke all on function public.triangulaciones_abiertas() from public, anon, authenticated;
grant execute on function public.vincular_triangulacion(text) to service_role;
grant execute on function public.avanzar_compra_triangulada(text, text, numeric, text) to service_role;
grant execute on function public.triangulaciones_abiertas() to service_role;

-- Verificación: qué productos del catálogo ya encuentran su variante por nombre
select to_regprocedure('public.vincular_triangulacion(text)') is not null as rpc_vincular,
       public.valor_enum('pedidos', 'estado', array['ESPERANDO_PAGO', 'PENDIENTE_PAGO', 'PENDIENTE', 'CREADO', 'NUEVO']) as estado_pedido_usado,
       public.columna_existe('variantes', 'nombre') and public.columna_existe('variantes', 'producto_id') and public.columna_existe('productos', 'nombre') as cruce_por_nombre_posible;
