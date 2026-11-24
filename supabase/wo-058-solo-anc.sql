-- =====================================================================
-- WO-058 · Solo ANC (24/11/2026, decisión del director): se vende únicamente lo de ANC (físico y digital).
--   1. Emprende Red EN PAUSA: todas sus categorías quedan ocultas (precios_publicos ya no las devuelve, así que ni la
--      tienda ni el bot las ofrecen). Sus productos, costos y existencias se siguen sincronizando: para volver,
--      activa sus categorías en el panel (Promociones → «Categorías a mostrar»).
--   2. Seis productos de ANC que faltaban, con el precio de su tienda (Combo de 3 o 4 plataformas, DirecTV Go,
--      YouTube Premium, Spotify Premium, Deezer Premium y PIN Datacrédito). Desde aquí la BASE manda y n8n
--      «Leer precios ANC» los actualiza cada 6 h. Sin precio «antes» (cero descuentos inventados).
--   3. Servicios técnicos (decisión del director): mantenimiento preventivo $50.000 → $60.000 y revisión del equipo
--      (diagnóstico) $25.000.
-- Requiere wo-032 (catalogo_precios) y wo-047 (proveedor_categorias). Idempotente.
-- =====================================================================

do $$
begin
    if to_regclass('public.catalogo_precios') is null then
        raise exception 'Nada se aplicó. Falta public.catalogo_precios: aplica antes supabase/wo-032-fase3.sql.';
    end if;
    if to_regclass('public.proveedor_categorias') is null then
        raise exception 'Nada se aplicó. Falta public.proveedor_categorias: aplica antes supabase/wo-047-proveedor-y-rastreo.sql.';
    end if;
end;
$$;

-- 1) Emprende Red en pausa
update public.proveedor_categorias set visible = false, updated_at = now()
 where proveedor = 'emprendered' and visible;

-- 2) Productos de ANC nuevos (ON CONFLICT DO NOTHING: si ya existen, la base conserva su precio)
insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio, precio_anterior) values
    ('combo-3-o-4-plataformas', 'Netflix + Prime Video + Disney Premium + Max', 'Combo de 3 o 4 Plataformas', 'streaming', 45000, null),
    ('combo-3-o-4-plataformas', 'Netflix + Prime Video + Disney Premium', 'Combo de 3 o 4 Plataformas', 'streaming', 40000, null),
    ('combo-3-o-4-plataformas', 'Netflix + Prime Video + Max', 'Combo de 3 o 4 Plataformas', 'streaming', 32000, null),
    ('combo-3-o-4-plataformas', 'Prime Video + Disney Premium + Max', 'Combo de 3 o 4 Plataformas', 'streaming', 30000, null),
    ('directv-go', 'Pantalla con ESPN', 'DirecTV Go', 'streaming', 30000, null),
    ('directv-go', 'Pantalla con Win Play', 'DirecTV Go', 'streaming', 35000, null),
    ('youtube-premium', 'Suscripción 1 Mes', 'YouTube Premium', 'streaming', 15000, null),
    ('spotify-premium', 'Suscripción 1 Mes', 'Spotify Premium', 'streaming', 14000, null),
    ('spotify-premium', 'Suscripción 3 Meses', 'Spotify Premium', 'streaming', 34000, null),
    ('deezer-premium', 'Suscripción 1 Mes', 'Deezer Premium', 'streaming', 10000, null),
    ('pin-virtual-datacredito', 'PIN de $15.000', 'PIN Virtual Datacrédito', 'pines', 15000, null)
on conflict (producto_id, variante) do nothing;

-- 3) Servicios técnicos
update public.catalogo_precios set precio = 60000, updated_at = now()
 where producto_id = 'servicio-mantenimiento-computadores' and variante = 'Preventivo Software + Limpieza' and precio <> 60000;
insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio, precio_anterior) values
    ('servicio-reparacion-repuestos', 'Revisión del Equipo (Diagnóstico)', 'Reparación de Computadores y Venta de Repuestos', 'servicios', 25000, null)
on conflict (producto_id, variante) do update set precio = 25000, activo = true, updated_at = now()
 where public.catalogo_precios.precio <> 25000 or not public.catalogo_precios.activo;

-- Verificación
select (select count(*) from public.proveedor_categorias where proveedor = 'emprendered' and visible) as categorias_emprendered_visibles,
       (select count(*) from public.catalogo_precios
         where producto_id in ('combo-3-o-4-plataformas', 'directv-go', 'youtube-premium', 'spotify-premium', 'deezer-premium', 'pin-virtual-datacredito')) as planes_anc_nuevos,
       (select precio from public.catalogo_precios where producto_id = 'servicio-mantenimiento-computadores' and variante = 'Preventivo Software + Limpieza') as mantenimiento_preventivo,
       (select precio from public.catalogo_precios where producto_id = 'servicio-reparacion-repuestos' and variante = 'Revisión del Equipo (Diagnóstico)') as revision;
