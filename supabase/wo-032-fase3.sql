-- =====================================================================
-- WO-032 · Portal fase 3
--   P1 · Precios en la base: la base manda; el servidor calcula el total de cada orden web.
--   P2 · Orden web → despacho: al validar el pago, se crean los pedidos del panel y la compra al
--        proveedor (triangulación) sin pasos manuales; n8n la toma con tomar_despachos().
--   P3 · Validar combo en un clic: un solo pago valida todas las líneas del combo.
--   P4 · Avisos por WhatsApp (orden validada/rechazada, comprobante nuevo, falla reportada) y
--        reportes de falla registrados con su pedido y su garantía.
-- Requiere (en este orden): wo-014, wo-027, wo-015b, wo-028, wo-029, wo-030, wo-026, wo-031. Idempotente.
-- =====================================================================

-- 0) Verificación previa ----------------------------------------------------------------------
do $$
declare
    v_faltan text[] := '{}';
    f text;
begin
    foreach f in array array['public.es_admin()', 'public.normalizar_whatsapp(text)', 'public.hash_portal(text, text)',
        'public.sesion_portal(text)', 'public.validar_cupon(text)', 'public.descuento_combo(integer)',
        'public.vincular_triangulacion(text)', 'public.validar_pago(text, text, text, numeric, text)',
        'public.actualizar_lineas_combo(text, jsonb)', 'public.tomar_notificaciones(integer)'] loop
        if to_regprocedure(f) is null then
            v_faltan := array_append(v_faltan, f);
        end if;
    end loop;
    if to_regclass('public.ordenes_web') is null then v_faltan := array_append(v_faltan, 'public.ordenes_web (wo-030)'::text); end if;
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'triangulaciones' and column_name = 'grupo') then
        v_faltan := array_append(v_faltan, 'public.triangulaciones.grupo (wo-031)'::text);
    end if;
    if array_length(v_faltan, 1) > 0 then
        raise exception 'Nada se aplicó. Falta en la base: %', array_to_string(v_faltan, ', ');
    end if;
end;
$$;

/* ============================== P1 · PRECIOS EN LA BASE ============================== */

create table if not exists public.catalogo_precios (
    producto_id     text not null check (producto_id ~ '^[a-z0-9-]{2,160}$'),
    variante        text not null check (length(variante) between 1 and 160),
    producto        text not null,
    tipo            text not null,
    precio          bigint not null check (precio >= 0),          -- 0 = a cotizar (no se vende en la web)
    precio_anterior bigint check (precio_anterior is null or precio_anterior >= 0),
    activo          boolean not null default true,
    actualizado_por uuid,
    updated_at      timestamptz not null default now(),
    primary key (producto_id, variante)
);
alter table public.catalogo_precios enable row level security;
revoke all on table public.catalogo_precios from anon, authenticated;
grant select on table public.catalogo_precios to authenticated;
drop policy if exists catalogo_precios_admin on public.catalogo_precios;
create policy catalogo_precios_admin on public.catalogo_precios for select to authenticated using (public.es_admin());

-- <semilla-precios> (generado por herramientas/generar_precios_sql.js; no editar a mano)
insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio, precio_anterior) values
    ('reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados', 'Unidad Completa', 'Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados', 'tecnologia', 180000, 250000),
    ('diademas-inalambricas-cr-8-con-luces-r9s7x', 'Unidad Completa', 'Diademas Inalámbricas CR-8 con Luces LED', 'tecnologia', 100000, 180000),
    ('diademas-gamer-a3s-alambrico', 'Unidad Gamer', 'Diademas Gamer A3S Alámbrico', 'tecnologia', 80000, 150000),
    ('reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable', 'Acero Inoxidable', 'Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable', 'tecnologia', 140000, 250000),
    ('powerbank-portatil-recargable-20-000-mah', 'Carga Rápida 20.000 mAh', 'Powerbank Portátil Recargable 20.000 mAh', 'tecnologia', 120000, 180000),
    ('auriculares-inalambricos-de-gancho-sp16', 'Unidad Estándar', 'Auriculares Inalámbricos de Gancho SP16', 'tecnologia', 75000, 130000),
    ('auriculares-inalambricos-m19-con-powerbank', 'Powerbank M19', 'Auriculares Inalámbricos M19 (Con Powerbank)', 'tecnologia', 40000, 80000),
    ('reloj-inteligente-smartwatch-h19', 'Acero Inoxidable', 'Reloj Inteligente Smartwatch H19 en Acero Inoxidable', 'tecnologia', 100000, 180000),
    ('auriculares-inalambricos-m25-con-powerbank', 'Gamer M25', 'Auriculares Inalámbricos M25 (Con Powerbank)', 'tecnologia', 40000, 80000),
    ('reloj-inteligente-smartwatch-z90', 'Deportivo Z90', 'Reloj Inteligente Smartwatch Z90', 'tecnologia', 80000, 150000),
    ('reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable', 'Acero de Lujo P13', 'Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable', 'tecnologia', 130000, 210000),
    ('reloj-inteligente-smartwatch-m9', 'Edición M9', 'Reloj Inteligente Smartwatch M9', 'tecnologia', 120000, 200000),
    ('netflix', 'Pantalla Colombia (1 Dispositivo)', 'Netflix Premium 4K', 'streaming', 15000, 25000),
    ('netflix', 'Pantalla Internacional (1 Dispositivo)', 'Netflix Premium 4K', 'streaming', 17000, 27000),
    ('prime-video', 'Pantalla (1 Dispositivo)', 'Prime Video Ultra HD', 'streaming', 10000, 18000),
    ('prime-video', 'Cuenta Completa (6 Dispositivos)', 'Prime Video Ultra HD', 'streaming', 20000, 35000),
    ('disney-plus', 'Pantalla Premium', 'Disney Plus Premium', 'streaming', 15000, 25000),
    ('hbo-max', 'Pantalla 1 Mes', 'Max (HBO)', 'streaming', 8000, 15500),
    ('hbo-max', 'Cuenta Completa 1 Mes', 'Max (HBO)', 'streaming', 12000, 20000),
    ('hbo-max', 'Cuenta Completa 3 Meses', 'Max (HBO)', 'streaming', 18000, 27000),
    ('hbo-max', 'Cuenta Completa 6 Meses', 'Max (HBO)', 'streaming', 25000, 34000),
    ('crunchyroll', 'Perfil Mega Fan 1 Mes', 'Crunchyroll Mega Fan', 'streaming', 10000, 18000),
    ('crunchyroll', 'Cuenta Completa 1 Mes', 'Crunchyroll Mega Fan', 'streaming', 19000, 30000),
    ('vix-premium', 'Pantalla 1 Mes', 'Vix Premium', 'streaming', 8000, 13500),
    ('vix-premium', 'Cuenta Completa 1 Mes', 'Vix Premium', 'streaming', 15000, 25000),
    ('paramount-plus', 'Pantalla 1 Mes', 'Paramount Plus', 'streaming', 10000, 18000),
    ('paramount-plus', 'Cuenta Completa 1 Mes', 'Paramount Plus', 'streaming', 20000, 25500),
    ('universal-plus', 'Pantalla 1 Mes', 'Universal Plus', 'streaming', 10000, 18000),
    ('universal-plus', 'Cuenta Completa 1 Mes', 'Universal Plus', 'streaming', 20000, 35000),
    ('viki-rakuten', 'Pantalla 1 Mes', 'Viki Rakuten Pass', 'streaming', 10000, 18000),
    ('apple-tv', 'Perfil 1 Mes', 'Apple TV Plus', 'streaming', 12000, 20000),
    ('apple-tv', 'Cuenta Completa 1 Mes', 'Apple TV Plus', 'streaming', 24000, 35500),
    ('mubi', 'Perfil 1 Mes', 'Mubi Cinema', 'streaming', 10000, 18500),
    ('mubi', 'Cuenta Completa 1 Mes', 'Mubi Cinema', 'streaming', 22000, 35000),
    ('iptv-smarters', '1 Mes (1 Dispositivo)', 'IPTV Smarters / Plex HD', 'streaming', 13000, 22000),
    ('iptv-smarters', '1 Mes (2 Dispositivos)', 'IPTV Smarters / Plex HD', 'streaming', 23000, 32500),
    ('iptv-smarters', '3 Meses (1 Dispositivo)', 'IPTV Smarters / Plex HD', 'streaming', 35000, 60000),
    ('iptv-smarters', '6 Meses (1 Dispositivo)', 'IPTV Smarters / Plex HD', 'streaming', 55000, 80000),
    ('iptv-smarters', '12 Meses (1 Dispositivo)', 'IPTV Smarters / Plex HD', 'streaming', 80000, 120000),
    ('iptv-smarters', '12 Meses (2 Dispositivos)', 'IPTV Smarters / Plex HD', 'streaming', 150000, 220000),
    ('capcut-pro', 'Suscripción 1 Mes', 'CapCut Pro Edición', 'licencias', 28000, 45000),
    ('canva-pro', 'Acceso 1 Mes', 'Canva Pro', 'licencias', 10000, 18500),
    ('canva-pro', 'Acceso 1 Año Completo', 'Canva Pro', 'licencias', 40000, 85000),
    ('duolingo-super', 'Suscripción 1 Mes', 'Duolingo Super', 'licencias', 10000, 18500),
    ('mcafee-antivirus', 'Licencia 1 Año (1 PC)', 'McAfee Antivirus Total Protection', 'licencias', 45000, 80000),
    ('mcafee-antivirus', 'Licencia 1 Año (5 PCs)', 'McAfee Antivirus Total Protection', 'licencias', 130000, 180000),
    ('office-365', 'Licencia 1 Año (5 Dispositivos)', 'Office 365 Personal / Familiar', 'licencias', 45000, 90000),
    ('office-365', 'Licencia Vitalicia', 'Office 365 Personal / Familiar', 'licencias', 80000, 150000),
    ('office-2016-2019-2021-2024-pro-plus', 'Office 2019 Pro Plus', 'Office Pro Plus Vitalicio', 'licencias', 70000, 110000),
    ('office-2016-2019-2021-2024-pro-plus', 'Office 2021 Pro Plus', 'Office Pro Plus Vitalicio', 'licencias', 80000, 120000),
    ('office-2016-2019-2021-2024-pro-plus', 'Office 2024 Pro Plus', 'Office Pro Plus Vitalicio', 'licencias', 90000, 130000),
    ('office-2016-2019-2021-2024-pro-plus', 'Office Pro Plus Multidispositivo', 'Office Pro Plus Vitalicio', 'licencias', 100000, 150000),
    ('windows-10-y-11-pro-y-home', 'Windows 10 Pro Licencia', 'Windows 10 y 11 Pro / Home', 'licencias', 70000, 120000),
    ('windows-10-y-11-pro-y-home', 'Windows 11 Pro Licencia', 'Windows 10 y 11 Pro / Home', 'licencias', 80000, 140000),
    ('gemini-ia-pro', 'Suscripción 1 Mes', 'Gemini IA Pro', 'licencias', 28000, 70000),
    ('pin-virtual-disney-plus-1tpu5', 'PIN de $25.900', 'PIN Virtual Disney Plus', 'pines', 25900, null),
    ('pin-virtual-disney-plus-1tpu5', 'PIN de $36.900', 'PIN Virtual Disney Plus', 'pines', 36900, null),
    ('pin-virtual-disney-plus-1tpu5', 'PIN de $54.900', 'PIN Virtual Disney Plus', 'pines', 54900, null),
    ('pin-virtual-netflix', 'PIN de $20.000', 'PIN Virtual Netflix Colombia', 'pines', 20000, null),
    ('pin-virtual-netflix', 'PIN de $30.000', 'PIN Virtual Netflix Colombia', 'pines', 30000, null),
    ('pin-virtual-netflix', 'PIN de $35.000', 'PIN Virtual Netflix Colombia', 'pines', 35000, null),
    ('pin-virtual-netflix', 'PIN de $40.000', 'PIN Virtual Netflix Colombia', 'pines', 40000, null),
    ('pin-virtual-netflix', 'PIN de $50.000', 'PIN Virtual Netflix Colombia', 'pines', 50000, null),
    ('pin-virtual-directv-go', 'PIN de $64.000', 'PIN Virtual Directv Go', 'pines', 64000, null),
    ('pin-virtual-directv-go', 'PIN de $79.900', 'PIN Virtual Directv Go', 'pines', 79900, null),
    ('pin-virtual-directv-go', 'PIN de $102.900', 'PIN Virtual Directv Go', 'pines', 102900, null),
    ('pin-virtual-directv-go', 'PIN de $110.000', 'PIN Virtual Directv Go', 'pines', 110000, null),
    ('pin-virtual-win-play', 'PIN 1 Mes ($39.900)', 'PIN Virtual Win Play', 'pines', 39900, null),
    ('pin-virtual-vix', 'PIN de $22.900', 'PIN Virtual Vix', 'pines', 22900, null),
    ('pin-virtual-deezer', 'PIN de $19.500', 'PIN Virtual Deezer', 'pines', 19500, null),
    ('pin-google-play', 'PIN de $10.000', 'PIN Virtual Google Play', 'pines', 10000, null),
    ('pin-google-play', 'PIN de $30.000', 'PIN Virtual Google Play', 'pines', 30000, null),
    ('pin-google-play', 'PIN de $50.000', 'PIN Virtual Google Play', 'pines', 50000, null),
    ('pin-virtual-roblox', 'PIN de $25.000', 'PIN Virtual Roblox', 'pines', 25000, null),
    ('pin-virtual-roblox', 'PIN de $50.000', 'PIN Virtual Roblox', 'pines', 50000, null),
    ('pin-virtual-roblox', 'PIN de $100.000', 'PIN Virtual Roblox', 'pines', 100000, null),
    ('pin-virtual-razer-gold', 'PIN de $39.000', 'PIN Virtual Razer Gold', 'pines', 39000, null),
    ('pin-virtual-razer-gold', 'PIN de $64.000', 'PIN Virtual Razer Gold', 'pines', 64000, null),
    ('pin-virtual-razer-gold', 'PIN de $113.000', 'PIN Virtual Razer Gold', 'pines', 113000, null),
    ('pin-virtual-imvu', 'PIN de $24.000', 'PIN Virtual IMVU', 'pines', 24000, null),
    ('pin-virtual-imvu', 'PIN de $48.000', 'PIN Virtual IMVU', 'pines', 48000, null),
    ('pin-virtual-mcafee', 'PIN de $105.900', 'PIN Virtual McAfee', 'pines', 105900, null),
    ('pin-virtual-mcafee', 'PIN de $159.900', 'PIN Virtual McAfee', 'pines', 159900, null),
    ('pin-virtual-mcafee', 'PIN de $189.900', 'PIN Virtual McAfee', 'pines', 189900, null),
    ('pin-virtual-uber', 'PIN de $20.000', 'PIN Virtual Uber', 'pines', 20000, null),
    ('pin-virtual-uber', 'PIN de $30.000', 'PIN Virtual Uber', 'pines', 30000, null),
    ('pin-virtual-uber', 'PIN de $50.000', 'PIN Virtual Uber', 'pines', 50000, null),
    ('pin-virtual-uber', 'PIN de $100.000', 'PIN Virtual Uber', 'pines', 100000, null),
    ('directv-prepago-4s7gd', 'Saldo $12.000', 'DirecTV Prepago Recarga Directa', 'recargas', 12000, null),
    ('directv-prepago-4s7gd', 'Saldo $20.000', 'DirecTV Prepago Recarga Directa', 'recargas', 20000, null),
    ('directv-prepago-4s7gd', 'Saldo $30.000', 'DirecTV Prepago Recarga Directa', 'recargas', 30000, null),
    ('directv-prepago-4s7gd', 'Saldo $40.000', 'DirecTV Prepago Recarga Directa', 'recargas', 40000, null),
    ('directv-prepago-4s7gd', 'Saldo $50.000', 'DirecTV Prepago Recarga Directa', 'recargas', 50000, null),
    ('directv-prepago-4s7gd', 'Saldo $70.000', 'DirecTV Prepago Recarga Directa', 'recargas', 70000, null),
    ('free-fire-diamantes-vwx2s', '100 Diamantes ($4.200)', 'Free Fire Diamantes Directo', 'recargas', 4200, null),
    ('free-fire-diamantes-vwx2s', '310 Diamantes ($12.000)', 'Free Fire Diamantes Directo', 'recargas', 12000, null),
    ('free-fire-diamantes-vwx2s', '520 Diamantes ($19.600)', 'Free Fire Diamantes Directo', 'recargas', 19600, null),
    ('free-fire-diamantes-vwx2s', '1060 Diamantes ($38.600)', 'Free Fire Diamantes Directo', 'recargas', 38600, null),
    ('free-fire-diamantes-vwx2s', '2180 Diamantes ($76.800)', 'Free Fire Diamantes Directo', 'recargas', 76800, null),
    ('recargas-claro', 'Saldo $5.000', 'Recargas Móvil Claro', 'recargas', 5000, null),
    ('recargas-claro', 'Saldo $10.000', 'Recargas Móvil Claro', 'recargas', 10000, null),
    ('recargas-claro', 'Saldo $20.000', 'Recargas Móvil Claro', 'recargas', 20000, null),
    ('recargas-claro', 'Saldo $30.000', 'Recargas Móvil Claro', 'recargas', 30000, null),
    ('recargas-claro', 'Saldo $50.000', 'Recargas Móvil Claro', 'recargas', 50000, null),
    ('recargas-movistar', 'Saldo $5.000', 'Recargas Móvil Movistar', 'recargas', 5000, null),
    ('recargas-movistar', 'Saldo $10.000', 'Recargas Móvil Movistar', 'recargas', 10000, null),
    ('recargas-movistar', 'Saldo $20.000', 'Recargas Móvil Movistar', 'recargas', 20000, null),
    ('recargas-movistar', 'Saldo $30.000', 'Recargas Móvil Movistar', 'recargas', 30000, null),
    ('recargas-movistar', 'Saldo $50.000', 'Recargas Móvil Movistar', 'recargas', 50000, null),
    ('recargas-tigo', 'Saldo $5.000', 'Recargas Móvil Tigo', 'recargas', 5000, null),
    ('recargas-tigo', 'Saldo $10.000', 'Recargas Móvil Tigo', 'recargas', 10000, null),
    ('recargas-tigo', 'Saldo $20.000', 'Recargas Móvil Tigo', 'recargas', 20000, null),
    ('recargas-tigo', 'Saldo $30.000', 'Recargas Móvil Tigo', 'recargas', 30000, null),
    ('recargas-tigo', 'Saldo $50.000', 'Recargas Móvil Tigo', 'recargas', 50000, null),
    ('recargas-etb', 'Saldo $5.000', 'Recargas Móvil ETB', 'recargas', 5000, null),
    ('recargas-etb', 'Saldo $10.000', 'Recargas Móvil ETB', 'recargas', 10000, null),
    ('recargas-etb', 'Saldo $20.000', 'Recargas Móvil ETB', 'recargas', 20000, null),
    ('recargas-etb', 'Saldo $30.000', 'Recargas Móvil ETB', 'recargas', 30000, null),
    ('recargas-movil-exito', 'Saldo $5.000', 'Recargas Móvil Éxito', 'recargas', 5000, null),
    ('recargas-movil-exito', 'Saldo $10.000', 'Recargas Móvil Éxito', 'recargas', 10000, null),
    ('recargas-movil-exito', 'Saldo $20.000', 'Recargas Móvil Éxito', 'recargas', 20000, null),
    ('recargas-movil-exito', 'Saldo $30.000', 'Recargas Móvil Éxito', 'recargas', 30000, null),
    ('recargas-movil-exito', 'Saldo $50.000', 'Recargas Móvil Éxito', 'recargas', 50000, null),
    ('recargas-movil-exito', 'Saldo $60.000', 'Recargas Móvil Éxito', 'recargas', 60000, null),
    ('recargas-wom', 'Saldo $5.000', 'Recargas Móvil Wom', 'recargas', 5000, null),
    ('recargas-wom', 'Saldo $10.000', 'Recargas Móvil Wom', 'recargas', 10000, null),
    ('recargas-wom', 'Saldo $20.000', 'Recargas Móvil Wom', 'recargas', 20000, null),
    ('recargas-wom', 'Saldo $30.000', 'Recargas Móvil Wom', 'recargas', 30000, null),
    ('recargas-wom', 'Saldo $50.000', 'Recargas Móvil Wom', 'recargas', 50000, null),
    ('recargas-wom', 'Saldo $60.000', 'Recargas Móvil Wom', 'recargas', 60000, null),
    ('recargas-virgin-mobile', 'Saldo $5.000', 'Recargas Virgin Mobile', 'recargas', 5000, null),
    ('recargas-virgin-mobile', 'Saldo $10.000', 'Recargas Virgin Mobile', 'recargas', 10000, null),
    ('recargas-virgin-mobile', 'Saldo $20.000', 'Recargas Virgin Mobile', 'recargas', 20000, null),
    ('recarga-rushbet', 'Saldo $10.000', 'Recarga Rushbet Apuestas', 'recargas', 10000, null),
    ('recarga-rushbet', 'Saldo $20.000', 'Recarga Rushbet Apuestas', 'recargas', 20000, null),
    ('recarga-rushbet', 'Saldo $30.000', 'Recarga Rushbet Apuestas', 'recargas', 30000, null),
    ('recarga-rushbet', 'Saldo $50.000', 'Recarga Rushbet Apuestas', 'recargas', 50000, null),
    ('recarga-bwin-7t6cc', 'Saldo $10.000', 'Recarga Bwin Apuestas', 'recargas', 10000, null),
    ('recarga-bwin-7t6cc', 'Saldo $20.000', 'Recarga Bwin Apuestas', 'recargas', 20000, null),
    ('recarga-bwin-7t6cc', 'Saldo $30.000', 'Recarga Bwin Apuestas', 'recargas', 30000, null),
    ('recarga-bwin-7t6cc', 'Saldo $50.000', 'Recarga Bwin Apuestas', 'recargas', 50000, null),
    ('recarga-betsson', 'Saldo $10.000', 'Recarga Betsson Apuestas', 'recargas', 10000, null),
    ('recarga-betsson', 'Saldo $20.000', 'Recarga Betsson Apuestas', 'recargas', 20000, null),
    ('recarga-betsson', 'Saldo $30.000', 'Recarga Betsson Apuestas', 'recargas', 30000, null),
    ('recarga-betsson', 'Saldo $50.000', 'Recarga Betsson Apuestas', 'recargas', 50000, null),
    ('servicio-mantenimiento-computadores', 'Preventivo Software + Limpieza', 'Mantenimiento Preventivo y Correctivo de Equipos', 'servicios', 50000, 70000),
    ('servicio-mantenimiento-computadores', 'Correctivo + Cambio Térmico', 'Mantenimiento Preventivo y Correctivo de Equipos', 'servicios', 90000, 120000),
    ('servicio-instalacion-so-licenciamiento', 'Windows 10/11 Pro + Office + Software Base', 'Instalación de Sistema Operativo y Licenciamiento', 'servicios', 60000, 90000),
    ('servicio-alquiler-equipos-computo', 'Plan 1 Mes (Pago Total)', 'Alquiler de Laptops y Equipos de Cómputo', 'alquiler', 160000, null),
    ('servicio-alquiler-equipos-computo', 'Plan 6 Meses ($150.000/mes) - Pago Total', 'Alquiler de Laptops y Equipos de Cómputo', 'alquiler', 900000, 960000),
    ('servicio-alquiler-equipos-computo', 'Plan 1 Año ($140.000/mes) - Pago Total', 'Alquiler de Laptops y Equipos de Cómputo', 'alquiler', 1680000, 1920000),
    ('servicio-asesorias-tutorias', 'Sesión de Asesoría / Tutoría (1 Hora)', 'Asesoría Técnica y Tutoría Personalizada', 'servicios', 40000, null),
    ('servicio-desarrollo-web-automatizaciones', 'Proyecto a Medida (Requiere Asesoría)', 'Desarrollo de Catálogos Web y Automatizaciones IA', 'servicios', 0, null)
on conflict (producto_id, variante) do nothing;
-- </semilla-precios>

-- Público: precios vigentes (la tienda y el portal reemplazan los de productos.json con estos)
drop function if exists public.precios_publicos();
create function public.precios_publicos()
returns table (producto_id text, variante text, precio bigint, precio_anterior bigint)
language sql
stable
security definer
set search_path = ''
as $$
    select c.producto_id, c.variante, c.precio, c.precio_anterior
    from public.catalogo_precios c
    where c.activo;
$$;
revoke all on function public.precios_publicos() from public;
grant execute on function public.precios_publicos() to anon, authenticated;

-- Admin: cambiar precio, precio anterior (tachado) o pausar una variante
drop function if exists public.guardar_precio(text, text, bigint, bigint, boolean);
create function public.guardar_precio(p_producto_id text, p_variante text, p_precio bigint, p_precio_anterior bigint default null, p_activo boolean default true)
returns table (ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede cambiar precios.'; return;
    end if;
    if p_precio is null or p_precio < 0 or p_precio > 20000000 then
        return query select false, 'Precio no válido.'; return;
    end if;
    if p_precio_anterior is not null and p_precio_anterior <= p_precio then
        return query select false, 'El precio anterior debe ser mayor que el nuevo (o déjalo vacío).'; return;
    end if;
    update public.catalogo_precios c
       set precio = p_precio, precio_anterior = p_precio_anterior, activo = coalesce(p_activo, true),
           actualizado_por = auth.uid(), updated_at = now()
     where c.producto_id = p_producto_id and c.variante = p_variante;
    if not found then
        return query select false, 'Esa variante no existe en la base.'; return;
    end if;
    return query select true, 'Precio actualizado: la tienda lo muestra al recargar.';
end;
$$;
revoke all on function public.guardar_precio(text, text, bigint, bigint, boolean) from public, anon;
grant execute on function public.guardar_precio(text, text, bigint, bigint, boolean) to authenticated;

-- Órdenes web: total calculado en el servidor, cupón aplicado y despacho
alter table public.ordenes_web
    add column if not exists total_servidor  bigint,
    add column if not exists cupon_pct       integer,
    add column if not exists despacho_nota   text,
    add column if not exists despachada_at   timestamptz;

-- crear_orden_web v2: el navegador manda QUÉ compra (producto_id + variante + combo); el PRECIO, el
-- descuento del combo y el cupón los calcula el servidor. El total del navegador ya no se usa.
drop function if exists public.crear_orden_web(text, text, jsonb, bigint, text, text, text);
drop function if exists public.crear_orden_web(text, text, jsonb, text, text, text);
create function public.crear_orden_web(p_whatsapp text, p_nombre text, p_items jsonb, p_metodo text,
                                       p_red text default null, p_cupon text default null)
returns table (ok boolean, mensaje text, codigo text, secreto text, pago jsonb, total bigint, detalle jsonb)
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
    v_lineas  jsonb := '[]'::jsonb;
    v_final   jsonb := '[]'::jsonb;
    i         jsonb;
    c         record;
    g         record;
    v_cupon   record;
    v_cupon_pct integer := 0;
    v_cupon_msg text;
    v_base    bigint;
    v_desc    bigint;
    v_resto   bigint;
    v_total   bigint;
    v_combos  jsonb := '[]'::jsonb;
    n         integer;
begin
    if v_numero is null then
        return query select false, 'Escribe un WhatsApp válido (10 dígitos).', null::text, null::text, null::jsonb, null::bigint, null::jsonb; return;
    end if;
    if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 20 then
        return query select false, 'El carrito está vacío o es demasiado grande.', null::text, null::text, null::jsonb, null::bigint, null::jsonb; return;
    end if;
    if (select count(*) from public.ordenes_web o where o.whatsapp = v_numero and o.created_at > now() - interval '1 hour') >= 5 then
        return query select false, 'Ya creaste varias órdenes en la última hora. Escríbenos por WhatsApp.', null::text, null::text, null::jsonb, null::bigint, null::jsonb; return;
    end if;
    select m.* into v_metodo from public.metodos_pago m
     where m.activo and m.tipo = upper(btrim(coalesce(p_metodo, '')))
       and coalesce(m.red, '') = coalesce(nullif(upper(btrim(p_red)), ''), coalesce(m.red, ''))
     order by m.orden limit 1;
    if not found then
        return query select false, 'Ese método de pago no está disponible.', null::text, null::text, null::jsonb, null::bigint, null::jsonb; return;
    end if;

    -- 1) Precio de lista de cada ítem DESDE LA BASE
    for i in select * from jsonb_array_elements(p_items) loop
        select * into c from public.catalogo_precios x
         where x.producto_id = i->>'producto_id' and x.variante = i->>'variante' and x.activo and x.precio > 0;
        if not found then
            return query select false, format('"%s" cambió de precio o ya no está disponible. Recarga la página.', left(coalesce(i->>'variante', '?'), 60)),
                null::text, null::text, null::jsonb, null::bigint, null::jsonb; return;
        end if;
        v_lineas := v_lineas || jsonb_build_object('producto_id', c.producto_id, 'producto', c.producto, 'variante', c.variante,
            'tipo', c.tipo, 'precio_lista', c.precio, 'precio_final', c.precio, 'combo', left(coalesce(i->>'combo', ''), 40));
    end loop;

    -- 2) Combos: plataformas DISTINTAS por grupo → descuento_combo(n) (misma regla que el portal y el bot)
    for g in select l->>'combo' as combo, count(distinct l->>'producto_id')::integer as plataformas, sum((l->>'precio_lista')::bigint)::bigint as subtotal
               from jsonb_array_elements(v_lineas) l where l->>'combo' <> '' group by l->>'combo' loop
        v_desc := round(g.subtotal * public.descuento_combo(g.plataformas) / 100.0);
        v_combos := v_combos || jsonb_build_object('combo', g.combo, 'plataformas', g.plataformas, 'pct', public.descuento_combo(g.plataformas), 'descuento', v_desc);
        -- Reparto del descuento por línea (el redondeo se ajusta en la última línea del grupo)
        v_resto := v_desc;
        n := 0;
        select jsonb_agg(case when l->>'combo' = g.combo then
                   jsonb_set(l, '{precio_final}', to_jsonb((l->>'precio_lista')::bigint - round((l->>'precio_lista')::bigint * public.descuento_combo(g.plataformas) / 100.0)::bigint))
                   else l end)
          into v_lineas from jsonb_array_elements(v_lineas) l;
        select v_desc - coalesce(sum((l->>'precio_lista')::bigint - (l->>'precio_final')::bigint), 0) into v_resto
          from jsonb_array_elements(v_lineas) l where l->>'combo' = g.combo;
        if v_resto <> 0 then
            select max(o) into n from jsonb_array_elements(v_lineas) with ordinality as x(l, o) where l->>'combo' = g.combo;
            v_lineas := jsonb_set(v_lineas, array[(n - 1)::text, 'precio_final'], to_jsonb(((v_lineas -> (n - 1)) ->> 'precio_final')::bigint - v_resto));
        end if;
    end loop;

    -- 3) Cupón: solo sobre lo que va FUERA de combos (no se acumula con el combo)
    if nullif(btrim(coalesce(p_cupon, '')), '') is not null then
        select * into v_cupon from public.validar_cupon(p_cupon);
        if v_cupon.valido then
            if exists (select 1 from public.cupones k where k.codigo = upper(btrim(p_cupon)) and k.solo_primera_compra)
               and (exists (select 1 from public.compras_proveedor x where right(regexp_replace(coalesce(x.cliente_whatsapp, ''), '\D', '', 'g'), 10) = right(v_numero, 10))
                    or exists (select 1 from public.ordenes_web o where o.whatsapp = v_numero and o.estado = 'VALIDADO')) then
                v_cupon_msg := 'El cupón es solo para la primera compra y este número ya compró.';
            else
                v_cupon_pct := v_cupon.porcentaje;
            end if;
        else
            v_cupon_msg := v_cupon.mensaje;
        end if;
    end if;
    select coalesce(sum((l->>'precio_final')::bigint), 0) into v_base from jsonb_array_elements(v_lineas) l where l->>'combo' = '';
    if v_cupon_pct > 0 and v_base > 0 then
        v_desc := round(v_base * v_cupon_pct / 100.0);
        select jsonb_agg(case when l->>'combo' = '' then
                   jsonb_set(l, '{precio_final}', to_jsonb((l->>'precio_final')::bigint - round((l->>'precio_final')::bigint * v_cupon_pct / 100.0)::bigint))
                   else l end)
          into v_final from jsonb_array_elements(v_lineas) l;
        select v_desc - coalesce(sum((a->>'precio_final')::bigint - (b->>'precio_final')::bigint), 0) into v_resto
          from jsonb_array_elements(v_lineas) with ordinality x(a, o) join jsonb_array_elements(v_final) with ordinality y(b, o2) on o = o2
         where a->>'combo' = '';
        if v_resto <> 0 then
            select max(o) into n from jsonb_array_elements(v_final) with ordinality as x(l, o) where l->>'combo' = '';
            v_final := jsonb_set(v_final, array[(n - 1)::text, 'precio_final'], to_jsonb(((v_final -> (n - 1)) ->> 'precio_final')::bigint - v_resto));
        end if;
        v_lineas := v_final;
    elsif v_cupon_pct > 0 then
        v_cupon_msg := 'El cupón no se acumula con el combo: aplica a productos fuera del combo.';
        v_cupon_pct := 0;
    end if;
    select sum((l->>'precio_final')::bigint) into v_total from jsonb_array_elements(v_lineas) l;
    if v_total is null or v_total <= 0 or v_total > 20000000 then
        return query select false, 'El total no es válido.', null::text, null::text, null::jsonb, null::bigint, null::jsonb; return;
    end if;

    loop
        v_codigo := 'DC-' || (select string_agg(substr(v_letras, 1 + (get_byte(decode(md5(gen_random_uuid()::text), 'hex'), k) % 32), 1), '')
                              from generate_series(0, 4) k);
        exit when not exists (select 1 from public.ordenes_web o where o.codigo = v_codigo)
              and not exists (select 1 from public.pedidos p where upper(p.codigo) = v_codigo)
              and not exists (select 1 from public.triangulaciones t where t.referencia like v_codigo || '%');
    end loop;

    insert into public.ordenes_web (codigo, secreto_hash, whatsapp, nombre, items, total_declarado, total_servidor, metodo, red, cupon, cupon_pct)
    values (v_codigo, public.hash_portal(v_secreto, 'orden'), v_numero, nullif(left(btrim(coalesce(p_nombre, '')), 40), ''),
            v_lineas, v_total, v_total, v_metodo.tipo, v_metodo.red,
            case when v_cupon_pct > 0 then upper(left(btrim(p_cupon), 30)) end, nullif(v_cupon_pct, 0));

    return query select true, 'Orden creada.', v_codigo, v_secreto,
        jsonb_strip_nulls(jsonb_build_object(
            'tipo', v_metodo.tipo, 'categoria', v_metodo.categoria, 'nombre', v_metodo.banco_alias,
            'numero_cuenta', v_metodo.numero_cuenta, 'titular', v_metodo.titular, 'moneda', v_metodo.moneda,
            'red', v_metodo.red, 'memo', v_metodo.memo, 'url_pago', v_metodo.url_pago, 'qr_url', v_metodo.qr_url,
            'instrucciones', v_metodo.instrucciones, 'tasa_cop', v_metodo.tasa_cop, 'tasa_actualizada_at', v_metodo.tasa_actualizada_at)),
        v_total,
        jsonb_strip_nulls(jsonb_build_object('lineas', v_lineas, 'combos', v_combos, 'cupon_pct', nullif(v_cupon_pct, 0), 'cupon_mensaje', v_cupon_msg));
end;
$$;
revoke all on function public.crear_orden_web(text, text, jsonb, text, text, text) from public;
grant execute on function public.crear_orden_web(text, text, jsonb, text, text, text) to anon, authenticated;

-- "Mis pedidos": el total que se muestra es el del servidor
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
    select o.codigo, o.estado, coalesce(o.total_servidor, o.total_declarado), o.metodo, o.items,
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

/* ============================== P2 · ORDEN WEB → DESPACHO ============================== */

alter table public.triangulaciones
    add column if not exists origen_web  boolean not null default false,
    add column if not exists iniciada_at timestamptz;

-- Crea la triangulación (1 producto digital) o el combo/grupo (2+), vincula cada línea al panel y
-- registra el pago de cada línea con validar_pago (el admin ya validó el comprobante de la orden).
-- Los productos físicos o de servicio no se triangulan: quedan para despacho manual (se avisa).
create or replace function public.despachar_orden_web(p_codigo text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    o       public.ordenes_web;
    v_dig   jsonb;
    v_n     integer;
    v_ref   text;
    l       jsonb;
    k       integer := 0;
    r       record;
    p       record;
    v_notas text[] := '{}';
begin
    select * into o from public.ordenes_web w where w.codigo = p_codigo for update;
    if o.id is null or o.despachada_at is not null then
        return 'Ya estaba despachada.';
    end if;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_dig from jsonb_array_elements(o.items) x
     where x->>'tipo' in ('streaming', 'licencias', 'pines', 'recargas');
    v_n := jsonb_array_length(v_dig);
    if jsonb_array_length(o.items) > v_n then
        v_notas := array_append(v_notas, format('%s producto(s) físico(s) o de servicio: despáchalos a mano.', jsonb_array_length(o.items) - v_n));
    end if;

    if v_n = 1 then
        l := v_dig -> 0;
        insert into public.triangulaciones (referencia, cliente, cliente_nombre, producto, variante, precio_venta, estado, origen_web)
        values (o.codigo, o.whatsapp, o.nombre, l->>'producto', l->>'variante', (l->>'precio_final')::numeric, 'COTIZANDO', true)
        on conflict (referencia) do nothing;
    elsif v_n >= 2 then
        insert into public.triangulaciones (referencia, cliente, cliente_nombre, producto, variante, precio_venta, estado, es_combo, origen_web, lineas)
        values (o.codigo, o.whatsapp, o.nombre, format('Pedido web · %s plataformas', v_n),
                left((select string_agg(x->>'producto', ' + ') from jsonb_array_elements(v_dig) x), 200),
                (select sum((x->>'precio_final')::numeric) from jsonb_array_elements(v_dig) x), 'COTIZANDO', true, true,
                (select jsonb_agg(jsonb_build_object('referencia', o.codigo || q.n, 'producto', q.x->>'producto', 'variante', q.x->>'variante',
                                                     'precio_venta', (q.x->>'precio_final')::numeric) order by q.n)
                   from jsonb_array_elements(v_dig) with ordinality q(x, n)))
        on conflict (referencia) do nothing;
        for l in select * from jsonb_array_elements(v_dig) loop
            k := k + 1;
            insert into public.triangulaciones (referencia, cliente, cliente_nombre, producto, variante, precio_venta, estado, grupo, origen_web)
            values (o.codigo || k, o.whatsapp, o.nombre, l->>'producto', l->>'variante', (l->>'precio_final')::numeric, 'COTIZANDO', o.codigo, true)
            on conflict (referencia) do nothing;
        end loop;
    end if;

    -- Vincular cada línea al panel y registrar su pago (referencia única por línea)
    k := 0;
    for v_ref, l in select case when v_n = 1 then o.codigo else o.codigo || q.n end, q.x
                      from jsonb_array_elements(v_dig) with ordinality q(x, n) loop
        k := k + 1;
        select * into r from public.vincular_triangulacion(v_ref);
        if not r.ok then
            v_notas := array_append(v_notas, format('%s no quedó en el panel: %s', v_ref, r.mensaje));
            continue;
        end if;
        select * into p from public.validar_pago(r.compra_id, o.metodo, format('WEB %s L%s', o.codigo, k), (l->>'precio_final')::numeric);
        if not p.ok then
            v_notas := array_append(v_notas, format('%s: pago no registrado (%s)', v_ref, p.mensaje));
        end if;
        -- El cliente ya recibe "orden validada": no se le manda además un "pago confirmado" por línea
        update public.notificaciones_whatsapp nw set estado = 'CANCELADO', ultimo_error = 'Cubierto por el aviso de la orden web'
         where nw.tipo = 'PAGO_RECIBIDO' and nw.estado = 'PENDIENTE' and nw.pedido_id = r.pedido_id::text;
    end loop;

    update public.ordenes_web w
       set despachada_at = now(),
           despacho_nota = nullif(array_to_string(v_notas, ' · '), '')
     where w.id = o.id;
    return case when v_n = 0 then 'Sin productos digitales: despacho manual.'
                when array_length(v_notas, 1) > 0 then 'Despachada con observaciones: ' || array_to_string(v_notas, ' · ')
                else format('Despachada: %s línea(s) en el panel y compra al proveedor en curso.', v_n) end;
end;
$$;
revoke all on function public.despachar_orden_web(text) from public, anon, authenticated;

-- resolver_orden_web v2: al validar, despacha
drop function if exists public.resolver_orden_web(text, boolean, text);
create function public.resolver_orden_web(p_codigo text, p_aprobar boolean, p_nota text default null)
returns table (ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_codigo text := upper(btrim(coalesce(p_codigo, '')));
    v_cupon  text;
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
     where o.codigo = v_codigo and o.estado in ('ESPERANDO_PAGO', 'COMPROBANTE_RECIBIDO', 'RECHAZADO')
    returning o.cupon into v_cupon;
    if not found then
        return query select false, 'Esa orden no existe o ya fue validada.'; return;
    end if;
    if not p_aprobar then
        return query select true, 'Orden rechazada: el cliente lo verá y puede subir otro comprobante.'; return;
    end if;
    if v_cupon is not null then
        update public.cupones k set usos = k.usos + 1 where k.codigo = v_cupon;
    end if;
    return query select true, public.despachar_orden_web(v_codigo);
end;
$$;
revoke all on function public.resolver_orden_web(text, boolean, text) from public, anon;
grant execute on function public.resolver_orden_web(text, boolean, text) to authenticated;

-- n8n (cada minuto): toma las órdenes web despachadas que aún no iniciaron la compra al proveedor
drop function if exists public.tomar_despachos();
create function public.tomar_despachos()
returns table (referencia text, cliente text, cliente_nombre text, producto text, variante text, precio_venta numeric, es_combo boolean, lineas jsonb)
language sql
volatile
security definer
set search_path = ''
as $$
    with elegidas as (
        select t.id from public.triangulaciones t
        where t.origen_web and t.iniciada_at is null and t.grupo is null and t.estado = 'COTIZANDO'
        order by t.id
        limit 5
        for update skip locked
    )
    update public.triangulaciones t set iniciada_at = now()
      from elegidas e where t.id = e.id
    returning t.referencia, t.cliente, t.cliente_nombre, t.producto, t.variante, t.precio_venta, t.es_combo, t.lineas;
$$;
revoke all on function public.tomar_despachos() from public, anon, authenticated;
grant execute on function public.tomar_despachos() to service_role;

/* ============================== P3 · VALIDAR COMBO EN UN CLIC ============================== */

drop function if exists public.combos_por_validar();
create function public.combos_por_validar()
returns table (referencia text, cliente text, cliente_nombre text, total numeric, lineas jsonb, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
    select t.referencia, t.cliente, t.cliente_nombre, t.precio_venta,
           (select jsonb_agg(jsonb_build_object('referencia', h.referencia, 'producto', h.producto, 'variante', h.variante,
                                                'precio', h.precio_venta, 'compra_id', h.compra_id,
                                                'estado_compra', (select c.estado::text from public.compras_proveedor c where c.id::text = h.compra_id))
                             order by h.referencia)
              from public.triangulaciones h where h.grupo = t.referencia),
           t.created_at
    from public.triangulaciones t
    where public.es_admin() and t.es_combo and not t.origen_web
      and t.estado not in ('ENTREGADO', 'CANCELADO', 'VENCIDO', 'AGOTADO')
      and exists (select 1 from public.triangulaciones h join public.compras_proveedor c on c.id::text = h.compra_id
                  where h.grupo = t.referencia and c.estado::text = 'PENDIENTE_PAGO')
    order by t.created_at desc;
$$;
revoke all on function public.combos_por_validar() from public, anon;
grant execute on function public.combos_por_validar() to authenticated;

drop function if exists public.validar_pago_combo(text, text, text, numeric);
create function public.validar_pago_combo(p_grupo text, p_metodo text, p_referencia text, p_monto numeric)
returns table (ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_total numeric;
    h       record;
    p       record;
    k       integer := 0;
    v_ok    integer := 0;
    v_err   text[] := '{}';
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede validar pagos.'; return;
    end if;
    if nullif(btrim(coalesce(p_referencia, '')), '') is null then
        return query select false, 'Falta la referencia del comprobante.'; return;
    end if;
    select sum(x.precio_venta) into v_total from public.triangulaciones x where x.grupo = p_grupo;
    if v_total is null then
        return query select false, 'Ese combo no existe.'; return;
    end if;
    if p_monto is null or p_monto < v_total then
        return query select false, format('El monto (%s) es menor que el total del combo (%s).', coalesce(p_monto, 0), v_total); return;
    end if;
    for h in select x.referencia, x.compra_id, x.precio_venta from public.triangulaciones x
              join public.compras_proveedor c on c.id::text = x.compra_id
             where x.grupo = p_grupo and c.estado::text = 'PENDIENTE_PAGO' order by x.referencia loop
        k := k + 1;
        -- Una referencia por línea (la base no deja aprobar dos veces la misma referencia)
        select * into p from public.validar_pago(h.compra_id, p_metodo,
            case when k = 1 then btrim(p_referencia) else format('%s · combo %s L%s', btrim(p_referencia), p_grupo, k) end, h.precio_venta);
        if p.ok then v_ok := v_ok + 1; else v_err := array_append(v_err, format('%s: %s', h.referencia, p.mensaje)); end if;
    end loop;
    -- Un solo "pago confirmado" por combo (el de la primera línea), no uno por plataforma
    update public.notificaciones_whatsapp nw set estado = 'CANCELADO', ultimo_error = 'Combo: se avisa una sola vez'
     where nw.tipo = 'PAGO_RECIBIDO' and nw.estado = 'PENDIENTE'
       and nw.compra_id in (select x.compra_id from public.triangulaciones x where x.grupo = p_grupo)
       and nw.id <> (select min(n2.id) from public.notificaciones_whatsapp n2 where n2.tipo = 'PAGO_RECIBIDO'
                       and n2.compra_id in (select x.compra_id from public.triangulaciones x where x.grupo = p_grupo));
    if v_ok = 0 and k = 0 then
        return query select false, 'No hay líneas pendientes de pago en ese combo.'; return;
    end if;
    return query select array_length(v_err, 1) is null,
        format('%s de %s línea(s) validadas.', v_ok, k) || coalesce(' ' || array_to_string(v_err, ' · '), '');
end;
$$;
revoke all on function public.validar_pago_combo(text, text, text, numeric) from public, anon;
grant execute on function public.validar_pago_combo(text, text, text, numeric) to authenticated;

/* ============================== P4 · AVISOS Y REPORTES DE FALLA ============================== */

create table if not exists public.reportes_falla (
    id          bigint generated always as identity primary key,
    compra_id   text not null,
    whatsapp    text not null,
    producto    text,
    problema    text not null check (length(problema) between 3 and 160),
    detalle     text check (length(detalle) <= 600),
    en_garantia boolean not null default false,
    estado      text not null default 'ABIERTO' check (estado in ('ABIERTO', 'RESUELTO')),
    nota_admin  text,
    resuelto_at timestamptz,
    created_at  timestamptz not null default now()
);
create index if not exists reportes_falla_abiertos on public.reportes_falla (estado, created_at);
alter table public.reportes_falla enable row level security;
revoke all on table public.reportes_falla from anon, authenticated;
grant select on table public.reportes_falla to authenticated;
drop policy if exists reportes_falla_admin on public.reportes_falla;
create policy reportes_falla_admin on public.reportes_falla for select to authenticated using (public.es_admin());

-- Nuevos tipos de aviso (los ADMIN_* los envía n8n a tu número de aviso)
alter table public.notificaciones_whatsapp drop constraint if exists notificaciones_whatsapp_tipo_check;
alter table public.notificaciones_whatsapp add constraint notificaciones_whatsapp_tipo_check
    check (tipo in ('PAGO_RECIBIDO', 'ENTREGA_CONFIRMADA', 'SOLICITUD_RESENA', 'OTP',
                    'ORDEN_VALIDADA', 'ORDEN_RECHAZADA', 'REPORTE_RESUELTO', 'ADMIN_COMPROBANTE', 'ADMIN_FALLA'));

-- tomar_notificaciones: estos avisos no dependen de una compra (no se cancelan por eso)
do $$
declare
    def text;
begin
    def := replace(pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure), E'\r\n', E'\n');
    if position('ADMIN_FALLA' in def) > 0 then
        return;
    end if;
    if position('n.tipo <> ''OTP''' in def) = 0 then
        raise exception 'tomar_notificaciones no tiene el parche de wo-028: aplica wo-028-portal.sql primero. Nada se aplicó.';
    end if;
    def := replace(def, 'n.tipo <> ''OTP''',
        'n.tipo not in (''OTP'', ''ORDEN_VALIDADA'', ''ORDEN_RECHAZADA'', ''REPORTE_RESUELTO'', ''ADMIN_COMPROBANTE'', ''ADMIN_FALLA'')');
    execute def;
end;
$$;

create or replace function public.encolar_aviso(p_clave text, p_tipo text, p_ref text, p_destino text, p_variables jsonb, p_prioridad smallint default 3)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
    insert into public.notificaciones_whatsapp (clave, tipo, compra_id, destino, variables, prioridad)
    select p_clave, p_tipo, p_ref, d, p_variables, p_prioridad
    from (select public.normalizar_whatsapp(p_destino) d) x
    where x.d is not null
    on conflict (clave) do nothing;
$$;
revoke all on function public.encolar_aviso(text, text, text, text, jsonb, smallint) from public, anon, authenticated;

-- Orden validada / rechazada → aviso al cliente
create or replace function public.avisar_orden_web()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.estado is distinct from old.estado and new.estado = 'VALIDADO' then
        perform public.encolar_aviso('ORDENOK:' || new.codigo, 'ORDEN_VALIDADA', new.codigo, new.whatsapp,
            jsonb_build_object('codigo', new.codigo, 'total', replace(to_char(coalesce(new.total_servidor, new.total_declarado), 'FM999,999,999'), ',', '.')), 2::smallint);
    elsif new.estado is distinct from old.estado and new.estado = 'RECHAZADO' then
        perform public.encolar_aviso('ORDENNO:' || new.codigo || ':' || extract(epoch from now())::bigint, 'ORDEN_RECHAZADA', new.codigo, new.whatsapp,
            jsonb_build_object('codigo', new.codigo, 'motivo', coalesce(new.nota_admin, 'el comprobante no coincide')), 2::smallint);
    end if;
    return new;
end;
$$;
drop trigger if exists trg_avisar_orden_web on public.ordenes_web;
create trigger trg_avisar_orden_web after update of estado on public.ordenes_web
    for each row execute function public.avisar_orden_web();

-- Comprobante nuevo → aviso al administrador
create or replace function public.avisar_comprobante_nuevo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    o public.ordenes_web;
begin
    select * into o from public.ordenes_web w where w.id = new.orden_id;
    perform public.encolar_aviso('ADMCOMP:' || new.id, 'ADMIN_COMPROBANTE', o.codigo, o.whatsapp,
        jsonb_build_object('codigo', o.codigo, 'cliente', o.whatsapp, 'metodo', o.metodo,
                           'total', replace(to_char(coalesce(o.total_servidor, o.total_declarado), 'FM999,999,999'), ',', '.'),
                           'referencia', coalesce(new.referencia, 'sin referencia')), 1::smallint);
    return new;
end;
$$;
drop trigger if exists trg_avisar_comprobante on public.comprobantes_web;
create trigger trg_avisar_comprobante after insert on public.comprobantes_web
    for each row execute function public.avisar_comprobante_nuevo();

-- Reportar una falla desde "Mis pedidos" (sesión verificada por WhatsApp, decisión 5)
drop function if exists public.reportar_falla(text, text, text, text);
create function public.reportar_falla(p_token text, p_compra_id text, p_problema text, p_detalle text default null)
returns table (ok boolean, mensaje text, reporte_id bigint)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    v_numero text;
    c        record;
    v_id     bigint;
    v_gar    boolean;
begin
    select s.whatsapp into v_numero from public.sesion_portal(p_token) s;
    if v_numero is null then
        return query select false, 'SESION_INVALIDA', null::bigint; return;
    end if;
    select x.id::text as id, x.referencia_externa::text as producto, x.fecha_vencimiento, x.estado::text as estado into c
      from public.compras_proveedor x
     where x.id::text = p_compra_id
       and right(regexp_replace(coalesce(x.cliente_whatsapp, ''), '\D', '', 'g'), 10) = right(v_numero, 10);
    if not found then
        return query select false, 'Ese pedido no es de este número.', null::bigint; return;
    end if;
    if nullif(btrim(coalesce(p_problema, '')), '') is null then
        return query select false, 'Cuéntanos qué falla.', null::bigint; return;
    end if;
    if (select count(*) from public.reportes_falla r where r.compra_id = c.id and r.estado = 'ABIERTO') >= 2 then
        return query select false, 'Ya tienes un reporte abierto para este pedido: te contactamos enseguida.', null::bigint; return;
    end if;
    v_gar := c.fecha_vencimiento is not null and c.fecha_vencimiento > now();
    insert into public.reportes_falla (compra_id, whatsapp, producto, problema, detalle, en_garantia)
    values (c.id, v_numero, c.producto, left(btrim(p_problema), 160), nullif(left(btrim(coalesce(p_detalle, '')), 600), ''), v_gar)
    returning id into v_id;
    perform public.encolar_aviso('ADMFALLA:' || v_id, 'ADMIN_FALLA', c.id, v_numero,
        jsonb_build_object('reporte', v_id, 'cliente', v_numero, 'producto', coalesce(c.producto, 'producto'),
                           'problema', left(btrim(p_problema), 160), 'garantia', case when v_gar then 'Sí' else 'No' end), 1::smallint);
    return query select true, 'Reporte registrado: un asesor te escribe por WhatsApp.', v_id;
end;
$$;
revoke all on function public.reportar_falla(text, text, text, text) from public;
grant execute on function public.reportar_falla(text, text, text, text) to anon, authenticated;

drop function if exists public.resolver_reporte(bigint, text);
create function public.resolver_reporte(p_id bigint, p_nota text)
returns table (ok boolean, mensaje text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
    r public.reportes_falla;
begin
    if not public.es_admin() then
        return query select false, 'Solo el administrador puede cerrar reportes.'; return;
    end if;
    update public.reportes_falla x
       set estado = 'RESUELTO', nota_admin = nullif(left(btrim(coalesce(p_nota, '')), 300), ''), resuelto_at = now()
     where x.id = p_id and x.estado = 'ABIERTO'
    returning * into r;
    if r.id is null then
        return query select false, 'Ese reporte no existe o ya estaba resuelto.'; return;
    end if;
    perform public.encolar_aviso('REPOK:' || r.id, 'REPORTE_RESUELTO', r.compra_id, r.whatsapp,
        jsonb_build_object('producto', coalesce(r.producto, 'tu producto'), 'nota', coalesce(r.nota_admin, 'quedó solucionado')), 3::smallint);
    return query select true, 'Reporte resuelto: avisamos al cliente por WhatsApp.';
end;
$$;
revoke all on function public.resolver_reporte(bigint, text) from public, anon;
grant execute on function public.resolver_reporte(bigint, text) to authenticated;

-- Verificación
select (select count(*) from public.catalogo_precios) as precios_en_base,
       to_regprocedure('public.crear_orden_web(text, text, jsonb, text, text, text)') is not null as orden_v2,
       to_regprocedure('public.tomar_despachos()') is not null as despacho,
       to_regprocedure('public.validar_pago_combo(text, text, text, numeric)') is not null as combo_un_clic,
       to_regclass('public.reportes_falla') is not null as reportes;
