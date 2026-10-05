-- =====================================================================
-- WO-030 · Portal fase 2: orden web + subida del comprobante de pago desde cliente.html
-- Requiere: wo-015 / wo-015b (es_admin, normalizar_whatsapp), wo-027 (metodos_pago.tipo),
--           wo-028 (hash_portal, sesion_portal). Idempotente.
--
-- Flujo:
--   1. crear_orden_web(): el checkout registra la orden (DC-XXXXX) y recibe un SECRETO que solo conoce
--      ese navegador + los datos de pago del método elegido. En la base solo queda el hash del secreto.
--   2. autorizar_subida(): con el secreto, el servidor entrega una RUTA aleatoria de un solo uso
--      (10 minutos). Storage solo acepta archivos en rutas autorizadas (política de storage.objects).
--   3. El navegador sube el archivo a esa ruta (bucket privado 'comprobantes': 5 MB, imagen o PDF).
--   4. registrar_comprobante(): confirma la subida → la orden pasa a COMPROBANTE_RECIBIDO.
--   5. El administrador ve el archivo (enlace firmado temporal) y valida o rechaza en el panel.
-- El total es el que declara el navegador (los precios aún viven en productos.json): por eso la
-- validación SIEMPRE es humana. Cuando los precios migren a la base, crear_orden_web los recalculará.
-- =====================================================================

-- 0) Verificación previa: si falta algo, se detiene ANTES de crear nada -------------------------
do $$
declare
    v_faltan text[] := '{}';
begin
    if to_regprocedure('public.es_admin()') is null then v_faltan := array_append(v_faltan, 'public.es_admin() (wo-015)'::text); end if;
    if to_regprocedure('public.normalizar_whatsapp(text)') is null then v_faltan := array_append(v_faltan, 'public.normalizar_whatsapp() (wo-015b)'::text); end if;
    if to_regprocedure('public.hash_portal(text, text)') is null then v_faltan := array_append(v_faltan, 'public.hash_portal() (wo-028)'::text); end if;
    if to_regprocedure('public.sesion_portal(text)') is null then v_faltan := array_append(v_faltan, 'public.sesion_portal() (wo-028)'::text); end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'metodos_pago' and column_name = 'tipo') then
        v_faltan := array_append(v_faltan, 'public.metodos_pago.tipo (wo-027)'::text);
    end if;
    if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
        v_faltan := array_append(v_faltan, 'Supabase Storage (storage.objects / storage.buckets)'::text);
    end if;
    if array_length(v_faltan, 1) > 0 then
        raise exception 'Nada se aplicó. Falta en la base: %', array_to_string(v_faltan, ', ');
    end if;
end;
$$;

-- 1) TABLAS ------------------------------------------------------------------------------------
create table if not exists public.ordenes_web (
    id              bigint generated always as identity primary key,
    codigo          text not null unique check (codigo ~ '^DC-[A-Z0-9]{5}$'),
    secreto_hash    text not null,
    whatsapp        text not null check (whatsapp ~ '^\d{11,15}$'),
    nombre          text check (length(nombre) <= 40),
    items           jsonb not null check (jsonb_typeof(items) = 'array'),
    total_declarado bigint not null check (total_declarado > 0 and total_declarado <= 20000000),
    metodo          text not null,
    red             text,
    cupon           text check (length(cupon) <= 30),
    estado          text not null default 'ESPERANDO_PAGO'
                    check (estado in ('ESPERANDO_PAGO', 'COMPROBANTE_RECIBIDO', 'VALIDADO', 'RECHAZADO', 'VENCIDO')),
    nota_admin      text,
    revisado_por    uuid,
    revisado_at     timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists ordenes_web_whatsapp on public.ordenes_web (whatsapp, created_at desc);
create index if not exists ordenes_web_estado on public.ordenes_web (estado, created_at);

-- Rutas de subida autorizadas (un solo uso, 10 minutos)
create table if not exists public.subidas_comprobante (
    ruta       text primary key,
    orden_id   bigint not null references public.ordenes_web (id) on delete cascade,
    expira_at  timestamptz not null,
    usada_at   timestamptz,
    created_at timestamptz not null default now()
);

create table if not exists public.comprobantes_web (
    id         bigint generated always as identity primary key,
    orden_id   bigint not null references public.ordenes_web (id) on delete cascade,
    ruta       text not null unique,
    referencia text check (length(referencia) <= 120),
    created_at timestamptz not null default now()
);

alter table public.ordenes_web enable row level security;
alter table public.subidas_comprobante enable row level security;
alter table public.comprobantes_web enable row level security;
revoke all on table public.ordenes_web, public.subidas_comprobante, public.comprobantes_web from anon, authenticated;
grant select on table public.ordenes_web, public.comprobantes_web to authenticated; -- filtrado por la política (solo admin)
drop policy if exists ordenes_web_admin on public.ordenes_web;
create policy ordenes_web_admin on public.ordenes_web for select to authenticated using (public.es_admin());
drop policy if exists comprobantes_web_admin on public.comprobantes_web;
create policy comprobantes_web_admin on public.comprobantes_web for select to authenticated using (public.es_admin());

-- 2) STORAGE: bucket privado + solo rutas autorizadas -------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update
    set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.puede_subir_comprobante(p_ruta text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (select 1 from public.subidas_comprobante s
                   where s.ruta = p_ruta and s.usada_at is null and s.expira_at > now());
$$;
revoke all on function public.puede_subir_comprobante(text) from public;
grant execute on function public.puede_subir_comprobante(text) to anon, authenticated;

drop policy if exists comprobantes_subida on storage.objects;
create policy comprobantes_subida on storage.objects for insert to anon, authenticated
    with check (bucket_id = 'comprobantes' and public.puede_subir_comprobante(name));
drop policy if exists comprobantes_lectura_admin on storage.objects;
create policy comprobantes_lectura_admin on storage.objects for select to authenticated
    using (bucket_id = 'comprobantes' and public.es_admin());

-- 3) CREAR LA ORDEN (checkout del portal) -------------------------------------------------------
drop function if exists public.crear_orden_web(text, text, jsonb, bigint, text, text, text);
create function public.crear_orden_web(p_whatsapp text, p_nombre text, p_items jsonb, p_total bigint,
                                       p_metodo text, p_red text default null, p_cupon text default null)
returns table (ok boolean, mensaje text, codigo text, secreto text, pago jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_numero  text := public.normalizar_whatsapp(p_whatsapp);
    v_metodo  record;
    v_codigo  text;
    v_secreto text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    v_letras  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_items   jsonb;
begin
    if v_numero is null then
        return query select false, 'Escribe un WhatsApp válido (10 dígitos).', null::text, null::text, null::jsonb; return;
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
        return query select false, 'El carrito está vacío o es demasiado grande.', null::text, null::text, null::jsonb; return;
    end if;
    if p_total is null or p_total <= 0 or p_total > 20000000 then
        return query select false, 'El total no es válido.', null::text, null::text, null::jsonb; return;
    end if;
    -- Límite anti-abuso: 5 órdenes por hora por número
    if (select count(*) from public.ordenes_web o where o.whatsapp = v_numero and o.created_at > now() - interval '1 hour') >= 5 then
        return query select false, 'Ya creaste varias órdenes en la última hora. Escríbenos por WhatsApp.', null::text, null::text, null::jsonb; return;
    end if;
    select m.* into v_metodo from public.metodos_pago m
     where m.activo and m.tipo = upper(btrim(coalesce(p_metodo, '')))
       and coalesce(m.red, '') = coalesce(nullif(upper(btrim(p_red)), ''), coalesce(m.red, ''))
     order by m.orden limit 1;
    if not found then
        return query select false, 'Ese método de pago no está disponible.', null::text, null::text, null::jsonb; return;
    end if;

    -- Solo se guardan los campos esperados de cada ítem (texto acotado)
    select jsonb_agg(jsonb_build_object(
               'producto', left(coalesce(i->>'producto', ''), 120),
               'variante', left(coalesce(i->>'variante', ''), 120),
               'precio', greatest(0, coalesce((i->>'precio')::numeric, 0))::bigint,
               'combo', left(coalesce(i->>'combo', ''), 40)))
      into v_items
      from jsonb_array_elements(p_items) i;

    loop
        v_codigo := 'DC-' || (select string_agg(substr(v_letras, 1 + (get_byte(decode(md5(gen_random_uuid()::text), 'hex'), k) % 32), 1), '')
                              from generate_series(0, 4) k);
        exit when not exists (select 1 from public.ordenes_web o where o.codigo = v_codigo)
              and not exists (select 1 from public.pedidos p where upper(p.codigo) = v_codigo);
    end loop;

    insert into public.ordenes_web (codigo, secreto_hash, whatsapp, nombre, items, total_declarado, metodo, red, cupon)
    values (v_codigo, public.hash_portal(v_secreto, 'orden'), v_numero, nullif(left(btrim(coalesce(p_nombre, '')), 40), ''),
            v_items, p_total, v_metodo.tipo, v_metodo.red, nullif(upper(left(btrim(coalesce(p_cupon, '')), 30)), ''));

    return query select true, 'Orden creada.', v_codigo, v_secreto,
        jsonb_strip_nulls(jsonb_build_object(
            'tipo', v_metodo.tipo, 'categoria', v_metodo.categoria, 'nombre', v_metodo.banco_alias,
            'numero_cuenta', v_metodo.numero_cuenta, 'titular', v_metodo.titular, 'moneda', v_metodo.moneda,
            'red', v_metodo.red, 'memo', v_metodo.memo, 'url_pago', v_metodo.url_pago, 'qr_url', v_metodo.qr_url,
            'instrucciones', v_metodo.instrucciones, 'tasa_cop', v_metodo.tasa_cop, 'tasa_actualizada_at', v_metodo.tasa_actualizada_at));
end;
$$;
revoke all on function public.crear_orden_web(text, text, jsonb, bigint, text, text, text) from public;
grant execute on function public.crear_orden_web(text, text, jsonb, bigint, text, text, text) to anon, authenticated;

-- Valida código + secreto; devuelve la orden (uso interno)
create or replace function public.orden_por_secreto(p_codigo text, p_secreto text)
returns public.ordenes_web
language sql
stable
security definer
set search_path = ''
as $$
    select o.* from public.ordenes_web o
    where o.codigo = upper(btrim(coalesce(p_codigo, '')))
      and o.secreto_hash = public.hash_portal(coalesce(p_secreto, ''), 'orden');
$$;
revoke all on function public.orden_por_secreto(text, text) from public, anon, authenticated;

-- 4) AUTORIZAR UNA SUBIDA ----------------------------------------------------------------------
drop function if exists public.autorizar_subida(text, text, text);
create function public.autorizar_subida(p_codigo text, p_secreto text, p_extension text)
returns table (ok boolean, mensaje text, ruta text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    o     public.ordenes_web;
    v_ext text := lower(btrim(coalesce(p_extension, '')));
    v_ruta text;
begin
    select * into o from public.orden_por_secreto(p_codigo, p_secreto);
    if o.id is null then
        return query select false, 'No encontramos tu orden.', null::text; return;
    end if;
    if o.estado not in ('ESPERANDO_PAGO', 'COMPROBANTE_RECIBIDO', 'RECHAZADO') or o.created_at < now() - interval '72 hours' then
        return query select false, 'Esta orden ya no recibe comprobantes. Escríbenos por WhatsApp.', null::text; return;
    end if;
    if v_ext not in ('jpg', 'jpeg', 'png', 'webp', 'pdf') then
        return query select false, 'Sube una foto (JPG, PNG, WEBP) o un PDF.', null::text; return;
    end if;
    if (select count(*) from public.subidas_comprobante s where s.orden_id = o.id) >= 6
       or (select count(*) from public.comprobantes_web c where c.orden_id = o.id) >= 3 then
        return query select false, 'Ya recibimos varios comprobantes de esta orden. Escríbenos por WhatsApp.', null::text; return;
    end if;
    v_ruta := o.codigo || '/' || replace(gen_random_uuid()::text, '-', '') || '.' || v_ext;
    insert into public.subidas_comprobante (ruta, orden_id, expira_at) values (v_ruta, o.id, now() + interval '10 minutes');
    return query select true, 'ok', v_ruta;
end;
$$;
revoke all on function public.autorizar_subida(text, text, text) from public;
grant execute on function public.autorizar_subida(text, text, text) to anon, authenticated;

-- 5) CONFIRMAR LA SUBIDA -----------------------------------------------------------------------
drop function if exists public.registrar_comprobante(text, text, text, text);
create function public.registrar_comprobante(p_codigo text, p_secreto text, p_ruta text, p_referencia text default null)
returns table (ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    o public.ordenes_web;
begin
    select * into o from public.orden_por_secreto(p_codigo, p_secreto);
    if o.id is null then
        return query select false, 'No encontramos tu orden.'; return;
    end if;
    if not exists (select 1 from public.subidas_comprobante s where s.ruta = p_ruta and s.orden_id = o.id and s.usada_at is null) then
        return query select false, 'Esa subida no está autorizada o ya se registró.'; return;
    end if;
    if not exists (select 1 from storage.objects f where f.bucket_id = 'comprobantes' and f.name = p_ruta) then
        return query select false, 'No encontramos el archivo. Intenta subirlo de nuevo.'; return;
    end if;
    update public.subidas_comprobante s set usada_at = now() where s.ruta = p_ruta;
    insert into public.comprobantes_web (orden_id, ruta, referencia)
    values (o.id, p_ruta, nullif(left(btrim(coalesce(p_referencia, '')), 120), ''));
    update public.ordenes_web w set estado = 'COMPROBANTE_RECIBIDO', updated_at = now() where w.id = o.id;
    return query select true, 'Recibimos tu comprobante. Lo validamos y te avisamos por WhatsApp.';
end;
$$;
revoke all on function public.registrar_comprobante(text, text, text, text) from public;
grant execute on function public.registrar_comprobante(text, text, text, text) to anon, authenticated;

-- 6) "MIS PEDIDOS": órdenes web del número con sesión verificada (wo-028) -------------------------
drop function if exists public.mis_ordenes_web(text);
create function public.mis_ordenes_web(p_token text)
returns table (codigo text, estado text, total_declarado bigint, metodo text, items jsonb, nota_admin text, created_at timestamptz, comprobantes integer)
language plpgsql
volatile
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
    select o.codigo, o.estado, o.total_declarado, o.metodo, o.items,
           case when o.estado = 'RECHAZADO' then o.nota_admin end, o.created_at,
           (select count(*)::integer from public.comprobantes_web c where c.orden_id = o.id)
    from public.ordenes_web o
    where right(o.whatsapp, 10) = right(v_numero, 10)
    order by o.created_at desc
    limit 30;
end;
$$;
revoke all on function public.mis_ordenes_web(text) from public;
grant execute on function public.mis_ordenes_web(text) to anon, authenticated;

-- 7) PANEL: validar o rechazar ----------------------------------------------------------------
drop function if exists public.resolver_orden_web(text, boolean, text);
create function public.resolver_orden_web(p_codigo text, p_aprobar boolean, p_nota text default null)
returns table (ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede validar comprobantes.'; return;
    end if;
    if not p_aprobar and nullif(btrim(coalesce(p_nota, '')), '') is null then
        return query select false, 'Escribe el motivo del rechazo (el cliente lo verá).'; return;
    end if;
    update public.ordenes_web o
       set estado = case when p_aprobar then 'VALIDADO' else 'RECHAZADO' end,
           nota_admin = nullif(left(btrim(coalesce(p_nota, '')), 300), ''),
           revisado_por = auth.uid(), revisado_at = now(), updated_at = now()
     where o.codigo = upper(btrim(p_codigo)) and o.estado in ('ESPERANDO_PAGO', 'COMPROBANTE_RECIBIDO', 'RECHAZADO');
    if not found then
        return query select false, 'Esa orden no existe o ya fue validada.'; return;
    end if;
    return query select true, case when p_aprobar then 'Orden validada: despáchala como de costumbre.' else 'Orden rechazada: el cliente puede subir otro comprobante.' end;
end;
$$;
revoke all on function public.resolver_orden_web(text, boolean, text) from public, anon;
grant execute on function public.resolver_orden_web(text, boolean, text) to authenticated;

-- Verificación
select to_regclass('public.ordenes_web') is not null as tabla_ordenes,
       (select public from storage.buckets where id = 'comprobantes') = false as bucket_privado,
       to_regprocedure('public.crear_orden_web(text, text, jsonb, bigint, text, text, text)') is not null as rpc_orden;
