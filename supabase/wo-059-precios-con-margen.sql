-- =====================================================================
-- WO-059 · Precios de ANC CON MARGEN (24/11/2026, decisión delegada por el director: «guardarme siempre mi margen»).
--   Hasta hoy el precio de venta era IGUAL al costo de ANC (anc_margen = 0 en n8n): margen $0 y, con el cupón de
--   primera compra (10 %), pérdida. Regla (herramientas/precios-margen.mjs): margen neto mínimo 12 % y $2000
--   aun con el 10 % de descuento; redondeo a $1.000 ($5.000 desde $100.000). Costo = ANC hoy.
--   Generado por herramientas/recalcular-precios-anc.mjs · 33 planes · idempotente.
-- =====================================================================
do $$ begin
    if to_regclass('public.catalogo_precios') is null then raise exception 'Nada se aplicó. Falta public.catalogo_precios (wo-032).'; end if;
end $$;
with nuevos(producto_id, variante, precio, costo) as (values
    ('reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados', 'Unidad Completa', 225000, 180000),
    ('diademas-inalambricas-cr-8-con-luces-r9s7x', 'Unidad Completa', 125000, 100000),
    ('diademas-gamer-a3s-alambrico', 'Unidad Gamer', 100000, 80000),
    ('reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable', 'Acero Inoxidable', 175000, 140000),
    ('auriculares-inalambricos-de-gancho-sp16', 'Unidad Estándar', 94000, 75000),
    ('auriculares-inalambricos-m25-con-powerbank', 'Gamer M25', 50000, 40000),
    ('reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable', 'Acero de Lujo P13', 165000, 130000),
    ('netflix', 'Pantalla Colombia 30 días', 22000, 17000),
    ('prime-video', 'Pantalla (1 Dispositivo)', 14000, 10000),
    ('disney-plus', 'Pantalla Premium', 19000, 15000),
    ('hbo-max', 'Pantalla Estándar 1 Mes', 12000, 8000),
    ('hbo-max', 'Pantalla Platino 1 Mes', 16000, 12000),
    ('hbo-max', 'Cuenta Completa Estándar 1 Mes', 23000, 18000),
    ('crunchyroll', 'Perfil Mega Fan 1 Mes', 14000, 10000),
    ('vix-premium', 'Pantalla 1 Mes', 12000, 8000),
    ('paramount-plus', 'Pantalla 1 Mes', 14000, 10000),
    ('universal-plus', 'Pantalla 1 Mes', 14000, 10000),
    ('viki-rakuten', 'Pantalla 1 Mes', 14000, 10000),
    ('apple-tv', 'Perfil 1 Mes', 16000, 12000),
    ('mubi', 'Perfil 1 Mes', 14000, 10000),
    ('combo-3-o-4-plataformas', 'Netflix + Prime Video + Disney Premium + Max', 57000, 45000),
    ('combo-3-o-4-plataformas', 'Netflix + Prime Video + Disney Premium', 50000, 40000),
    ('combo-3-o-4-plataformas', 'Netflix + Prime Video + Max', 40000, 32000),
    ('combo-3-o-4-plataformas', 'Prime Video + Disney Premium + Max', 38000, 30000),
    ('directv-go', 'Pantalla con Win Play', 44000, 35000),
    ('spotify-premium', 'Suscripción 1 Mes', 18000, 14000),
    ('spotify-premium', 'Suscripción 3 Meses', 43000, 34000),
    ('deezer-premium', 'Suscripción 1 Mes', 14000, 10000),
    ('canva-pro', 'Acceso 1 Mes', 14000, 10000),
    ('canva-pro', 'Acceso 1 Año Completo', 50000, 40000),
    ('duolingo-super', 'Suscripción 1 Mes', 14000, 10000),
    ('mcafee-antivirus', 'Licencia 1 Año (1 PC)', 57000, 45000),
    ('mcafee-antivirus', 'Licencia 1 Año (5 PCs)', 165000, 130000))
update public.catalogo_precios c
   set precio = n.precio, costo_proveedor = n.costo, costo_proveedor_at = now(), precio_anterior = null, updated_at = now()
  from nuevos n
 where c.producto_id = n.producto_id and c.variante = n.variante
   and (c.precio <> n.precio or c.costo_proveedor is distinct from n.costo);
-- Promociones que no hacen perder: ningún descuento supera el 10% que cubre el margen.
--   Combos (wo-029): 2 plataformas 5 %, 3 o más 10 % (antes 10 % y 15 %). Cupones (wo-012): máximo 10 %.
--   Además queda un TOPE en la base: ni desde el panel se puede crear un descuento mayor.
do $$ begin
    if to_regclass('public.reglas_combo') is not null then
        update public.reglas_combo set descuento_pct = case when min_plataformas <= 2 then 5 else 10 end, updated_at = now()
         where descuento_pct > case when min_plataformas <= 2 then 5 else 10 end;
        if not exists (select 1 from pg_constraint where conname = 'reglas_combo_tope_margen') then
            alter table public.reglas_combo add constraint reglas_combo_tope_margen check (descuento_pct <= 10);
        end if;
    end if;
    if to_regclass('public.cupones') is not null then
        update public.cupones set porcentaje = 10 where porcentaje > 10;
        if not exists (select 1 from pg_constraint where conname = 'cupones_tope_margen') then
            alter table public.cupones add constraint cupones_tope_margen check (porcentaje <= 10);
        end if;
    end if;
end $$;
-- Verificación: ningún plan de ANC activo queda sin margen
select count(*) filter (where costo_proveedor is not null and precio <= costo_proveedor) as planes_sin_margen,
       count(*) filter (where costo_proveedor is not null and round(precio * 0.9) <= costo_proveedor) as planes_en_perdida_con_cupon
  from public.catalogo_precios where activo and coalesce(proveedor, '') <> 'emprendered';
