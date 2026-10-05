-- =====================================================================
-- WO-034b · Pausa los nombres viejos de variantes (ejecutar DESPUÉS de publicar el sitio con los nombres nuevos)
-- Generado por herramientas/nombres_ancpagos.mjs. Requiere wo-034. Es idempotente.
-- Se pausan (activo = false), no se borran: el historial de órdenes los sigue nombrando.
-- =====================================================================

do $$
begin
    if not exists (select 1 from public.catalogo_precios
                   where producto_id = 'office-2016-2019-2021-2024-pro-plus' and variante = 'Office 2016 Pro Plus') then
        raise exception 'Nada se aplicó. Aplica antes supabase/wo-034-nombres-ancpagos.sql.';
    end if;
end;
$$;

update public.catalogo_precios set activo = false, updated_at = now()
where activo and (producto_id, variante) in (values
    ('netflix', 'Pantalla Colombia (1 Dispositivo)'),
    ('netflix', 'Pantalla Internacional (1 Dispositivo)'),
    ('hbo-max', 'Pantalla 1 Mes'),
    ('hbo-max', 'Cuenta Completa 1 Mes'),
    ('hbo-max', 'Cuenta Completa 3 Meses'),
    ('hbo-max', 'Cuenta Completa 6 Meses'),
    ('iptv-smarters', '1 Mes (1 Dispositivo)'),
    ('iptv-smarters', '1 Mes (2 Dispositivos)'),
    ('iptv-smarters', '3 Meses (1 Dispositivo)'),
    ('iptv-smarters', '6 Meses (1 Dispositivo)'),
    ('iptv-smarters', '12 Meses (1 Dispositivo)'),
    ('iptv-smarters', '12 Meses (2 Dispositivos)'),
    ('office-365', 'Licencia 1 Año (5 Dispositivos)'),
    ('office-365', 'Licencia Vitalicia'),
    ('office-2016-2019-2021-2024-pro-plus', 'Office Pro Plus Multidispositivo')
)
returning producto_id, variante, precio, activo;
