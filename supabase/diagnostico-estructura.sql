-- =====================================================================
-- Diagnóstico de estructura para conectar la triangulación (WO-026). SOLO LECTURA: no cambia nada.
-- Pegar completo en Supabase → SQL Editor → Run. Devuelve UNA celda (JSON): cópiala completa.
-- No incluye datos de clientes (solo estructura, 5 variantes/productos de ejemplo y los proveedores).
-- =====================================================================
select json_build_object(
    'columnas', (
        select json_agg(json_build_object('tabla', c.table_name, 'columna', c.column_name, 'tipo', c.udt_name,
                                          'nulo', c.is_nullable, 'defecto', c.column_default)
                        order by c.table_name, c.ordinal_position)
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name in ('pedidos', 'compras_proveedor', 'clientes', 'variantes', 'productos', 'proveedores', 'garantias', 'wa_eventos')),
    'restricciones', (
        select json_agg(json_build_object('tabla', r.conrelid::regclass::text, 'nombre', r.conname, 'definicion', pg_get_constraintdef(r.oid)))
        from pg_constraint r
        where r.conrelid::regclass::text in ('pedidos', 'compras_proveedor', 'clientes', 'variantes', 'garantias')),
    'disparadores', (
        select json_agg(json_build_object('tabla', t.tgrelid::regclass::text, 'nombre', t.tgname, 'definicion', pg_get_triggerdef(t.oid)))
        from pg_trigger t
        where not t.tgisinternal and t.tgrelid::regclass::text in ('pedidos', 'compras_proveedor', 'clientes', 'garantias')),
    'enums', (
        select json_agg(json_build_object('tipo', ty.typname, 'valores', (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = ty.oid)))
        from pg_type ty join pg_namespace n on n.oid = ty.typnamespace
        where n.nspname = 'public' and ty.typtype = 'e'),
    'proveedores', (select json_agg(p) from (select * from public.proveedores limit 10) p),
    'variantes_ejemplo', (select json_agg(v) from (select * from public.variantes limit 5) v),
    'productos_ejemplo', (select json_agg(p) from (select * from public.productos limit 5) p),
    'conteos', json_build_object(
        'variantes', (select count(*) from public.variantes),
        'productos', (select count(*) from public.productos),
        'clientes', (select count(*) from public.clientes),
        'pedidos', (select count(*) from public.pedidos))
) as estructura;
