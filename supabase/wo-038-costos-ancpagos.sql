-- =====================================================================
-- WO-038 · Costo del proveedor (ANC Pagos) por variante → el panel muestra costo y margen
-- Generado por herramientas/costos_ancpagos.mjs el 2026-10-05T21:21:26.820Z (no editar a mano: volver a generar).
-- Requiere wo-032 (catalogo_precios). Ejecutar en Supabase → SQL Editor. Es idempotente.
-- Solo guarda COSTOS: no cambia ningún precio de venta ni activa/pausa variantes.
-- =====================================================================

do $$
begin
    if to_regclass('public.catalogo_precios') is null then
        raise exception 'Nada se aplicó. Falta public.catalogo_precios: aplica antes supabase/wo-032-fase3.sql.';
    end if;
end;
$$;

alter table public.catalogo_precios
    add column if not exists costo_proveedor    bigint check (costo_proveedor is null or costo_proveedor >= 0),
    add column if not exists plan_proveedor     text,
    add column if not exists costo_proveedor_at timestamptz;

-- Costos leídos de ancpagos.com (43 variantes)
update public.catalogo_precios c
   set costo_proveedor = v.costo, plan_proveedor = v.plan, costo_proveedor_at = now()
  from (values
    ('netflix', 'Pantalla Colombia 26 días', 15000, 'Netflix · Pantalla 26 dias'),
    ('netflix', 'Pantalla Internacional 26 días', 17000, 'Netflix · Pantalla Internacional 26 dias'),
    ('prime-video', 'Pantalla (1 Dispositivo)', 10000, 'Prime Video · Pantalla'),
    ('prime-video', 'Cuenta Completa (6 Dispositivos)', 20000, 'Prime Video · Cuenta Completa'),
    ('disney-plus', 'Pantalla Premium', 15000, 'Disney Plus · Pantalla Premium'),
    ('hbo-max', 'Pantalla Estándar 1 Mes', 8000, 'HBO Max · Pantalla Estandar'),
    ('hbo-max', 'Pantalla Platino 1 Mes', 12000, 'HBO Max · Pantalla Platino'),
    ('hbo-max', 'Cuenta Completa Estándar 1 Mes', 18000, 'HBO Max · Completa Estandar'),
    ('hbo-max', 'Cuenta Completa Platino 1 Mes', 25000, 'HBO Max · Completa Platino'),
    ('crunchyroll', 'Perfil Mega Fan 1 Mes', 10000, 'Crunchyroll · Pantalla'),
    ('crunchyroll', 'Cuenta Completa 1 Mes', 19000, 'Crunchyroll · Cuenta Completa'),
    ('vix-premium', 'Pantalla 1 Mes', 8000, 'Vix Premium · Pantalla'),
    ('vix-premium', 'Cuenta Completa 1 Mes', 15000, 'Vix Premium · Cuenta Completa'),
    ('paramount-plus', 'Pantalla 1 Mes', 10000, 'Paramount Plus · Pantalla'),
    ('paramount-plus', 'Cuenta Completa 1 Mes', 20000, 'Paramount Plus · Cuenta Completa'),
    ('universal-plus', 'Pantalla 1 Mes', 10000, 'Universal Plus · Pantalla'),
    ('universal-plus', 'Cuenta Completa 1 Mes', 18000, 'Universal Plus · Cuenta Completa'),
    ('viki-rakuten', 'Pantalla 1 Mes', 10000, 'Viki Rakuten · Pantalla'),
    ('apple-tv', 'Perfil 1 Mes', 12000, 'Apple TV · Pantalla'),
    ('apple-tv', 'Cuenta Completa 1 Mes', 24000, 'Apple TV · Cuenta Completa'),
    ('mubi', 'Perfil 1 Mes', 10000, 'Mubi · Pantalla'),
    ('mubi', 'Cuenta Completa 1 Mes', 22000, 'Mubi · Cuenta Completa'),
    ('iptv-smarters', 'Pantalla 1 Mes', 13000, 'IPTV · Pantalla'),
    ('iptv-smarters', 'Cuenta Completa 1 Mes', 23000, 'IPTV · Cuenta Completa'),
    ('iptv-smarters', 'Cuenta Completa 2 Meses', 35000, 'IPTV · Completa 2 meses'),
    ('iptv-smarters', 'Cuenta Completa 3 Meses', 55000, 'IPTV · Completa 3 meses'),
    ('iptv-smarters', 'Cuenta Completa 6 Meses', 80000, 'IPTV · Completa 6 meses'),
    ('iptv-smarters', 'Cuenta Completa 12 Meses', 150000, 'IPTV · Completa 12 meses'),
    ('capcut-pro', 'Suscripción 1 Mes', 28000, 'CapCut Pro · 1 mes'),
    ('canva-pro', 'Acceso 1 Mes', 10000, 'Canva Pro · 1 mes'),
    ('canva-pro', 'Acceso 1 Año Completo', 40000, 'Canva Pro · 1 Año'),
    ('duolingo-super', 'Suscripción 1 Mes', 10000, 'Duolingo Super · 1 mes'),
    ('mcafee-antivirus', 'Licencia 1 Año (1 PC)', 45000, 'McAfee · 1 Año 1 Equipo'),
    ('mcafee-antivirus', 'Licencia 1 Año (5 PCs)', 130000, 'McAfee · 1 Año 5 Equipos'),
    ('office-365', 'Licencia 1 Año (1 Equipo)', 45000, 'Office 365 · 1 Año 1 Equipo'),
    ('office-365', 'Licencia 1 Año (5 Equipos)', 80000, 'Office 365 · 1 Año 5 Equipos'),
    ('office-2016-2019-2021-2024-pro-plus', 'Office 2016 Pro Plus', 70000, 'Office Pro Plus · 2016'),
    ('office-2016-2019-2021-2024-pro-plus', 'Office 2019 Pro Plus', 80000, 'Office Pro Plus · 2019'),
    ('office-2016-2019-2021-2024-pro-plus', 'Office 2021 Pro Plus', 90000, 'Office Pro Plus · 2021'),
    ('office-2016-2019-2021-2024-pro-plus', 'Office 2024 Pro Plus', 100000, 'Office Pro Plus · 2024'),
    ('windows-10-y-11-pro-y-home', 'Windows 10 Pro Licencia', 70000, 'Windows · 10 Pro'),
    ('windows-10-y-11-pro-y-home', 'Windows 11 Pro Licencia', 80000, 'Windows · 11 Pro'),
    ('gemini-ia-pro', 'Suscripción 1 Mes', 28000, 'Gemini IA Pro · 1 Mes')
  ) as v(producto_id, variante, costo, plan)
 where c.producto_id = v.producto_id and c.variante = v.variante;

-- Resultado: variantes con costo y cuántas se venden sin margen
select count(*) filter (where costo_proveedor is not null) as con_costo,
       count(*) filter (where costo_proveedor is not null and precio <= costo_proveedor) as sin_margen,
       count(*) filter (where costo_proveedor is not null and activo and precio <= costo_proveedor) as activas_sin_margen
from public.catalogo_precios;
