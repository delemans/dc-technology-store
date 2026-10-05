-- =====================================================================
-- WO-034 · Nombres de variantes alineados con lo que entrega ANC Pagos (proveedor)
-- Generado por herramientas/nombres_ancpagos.mjs (no editar a mano). Requiere wo-032 (catalogo_precios).
-- Ejecutar en Supabase → SQL Editor ANTES de publicar el sitio. Es idempotente.
--
-- Los PRECIOS NO CAMBIAN: cada nombre nuevo hereda el precio vigente del nombre viejo.
-- Los nombres viejos siguen activos mientras se publica el sitio (ninguna versión se queda sin precio).
-- Después de publicar: supabase/wo-034b-retirar-nombres-viejos.sql los pausa.
-- =====================================================================

do $$
declare
    v_faltan text;
begin
    if to_regclass('public.catalogo_precios') is null then
        raise exception 'Nada se aplicó. Falta public.catalogo_precios: aplica antes supabase/wo-032-fase3.sql.';
    end if;
    -- Ya aplicado: el último nombre de la cadena de Office existe → no se repite (repetirlo correría los precios)
    if exists (select 1 from public.catalogo_precios
               where producto_id = 'office-2016-2019-2021-2024-pro-plus' and variante = 'Office 2016 Pro Plus') then
        raise notice 'wo-034 ya estaba aplicado: no se cambió nada.';
        return;
    end if;
    with mapa (producto_id, viejo, nuevo) as (values
        ('netflix', 'Pantalla Colombia (1 Dispositivo)', 'Pantalla Colombia 26 días'),
        ('netflix', 'Pantalla Internacional (1 Dispositivo)', 'Pantalla Internacional 26 días'),
        ('hbo-max', 'Pantalla 1 Mes', 'Pantalla Estándar 1 Mes'),
        ('hbo-max', 'Cuenta Completa 1 Mes', 'Pantalla Platino 1 Mes'),
        ('hbo-max', 'Cuenta Completa 3 Meses', 'Cuenta Completa Estándar 1 Mes'),
        ('hbo-max', 'Cuenta Completa 6 Meses', 'Cuenta Completa Platino 1 Mes'),
        ('iptv-smarters', '1 Mes (1 Dispositivo)', 'Pantalla 1 Mes'),
        ('iptv-smarters', '1 Mes (2 Dispositivos)', 'Cuenta Completa 1 Mes'),
        ('iptv-smarters', '3 Meses (1 Dispositivo)', 'Cuenta Completa 2 Meses'),
        ('iptv-smarters', '6 Meses (1 Dispositivo)', 'Cuenta Completa 3 Meses'),
        ('iptv-smarters', '12 Meses (1 Dispositivo)', 'Cuenta Completa 6 Meses'),
        ('iptv-smarters', '12 Meses (2 Dispositivos)', 'Cuenta Completa 12 Meses'),
        ('office-365', 'Licencia 1 Año (5 Dispositivos)', 'Licencia 1 Año (1 Equipo)'),
        ('office-365', 'Licencia Vitalicia', 'Licencia 1 Año (5 Equipos)'),
        ('office-2016-2019-2021-2024-pro-plus', 'Office 2019 Pro Plus', 'Office 2016 Pro Plus'),
        ('office-2016-2019-2021-2024-pro-plus', 'Office 2021 Pro Plus', 'Office 2019 Pro Plus'),
        ('office-2016-2019-2021-2024-pro-plus', 'Office 2024 Pro Plus', 'Office 2021 Pro Plus'),
        ('office-2016-2019-2021-2024-pro-plus', 'Office Pro Plus Multidispositivo', 'Office 2024 Pro Plus')
    )
    select string_agg(m.producto_id || ' · ' || m.viejo, ', ') into v_faltan
    from mapa m
    where not exists (select 1 from public.catalogo_precios c where c.producto_id = m.producto_id and c.variante = m.viejo);
    if v_faltan is not null then
        raise exception 'Nada se aplicó. No están en catalogo_precios: %', v_faltan;
    end if;

    -- Una sola sentencia: todos los precios se leen antes de escribir (la cadena de Office no se corre)
    with mapa (producto_id, viejo, nuevo) as (values
        ('netflix', 'Pantalla Colombia (1 Dispositivo)', 'Pantalla Colombia 26 días'),
        ('netflix', 'Pantalla Internacional (1 Dispositivo)', 'Pantalla Internacional 26 días'),
        ('hbo-max', 'Pantalla 1 Mes', 'Pantalla Estándar 1 Mes'),
        ('hbo-max', 'Cuenta Completa 1 Mes', 'Pantalla Platino 1 Mes'),
        ('hbo-max', 'Cuenta Completa 3 Meses', 'Cuenta Completa Estándar 1 Mes'),
        ('hbo-max', 'Cuenta Completa 6 Meses', 'Cuenta Completa Platino 1 Mes'),
        ('iptv-smarters', '1 Mes (1 Dispositivo)', 'Pantalla 1 Mes'),
        ('iptv-smarters', '1 Mes (2 Dispositivos)', 'Cuenta Completa 1 Mes'),
        ('iptv-smarters', '3 Meses (1 Dispositivo)', 'Cuenta Completa 2 Meses'),
        ('iptv-smarters', '6 Meses (1 Dispositivo)', 'Cuenta Completa 3 Meses'),
        ('iptv-smarters', '12 Meses (1 Dispositivo)', 'Cuenta Completa 6 Meses'),
        ('iptv-smarters', '12 Meses (2 Dispositivos)', 'Cuenta Completa 12 Meses'),
        ('office-365', 'Licencia 1 Año (5 Dispositivos)', 'Licencia 1 Año (1 Equipo)'),
        ('office-365', 'Licencia Vitalicia', 'Licencia 1 Año (5 Equipos)'),
        ('office-2016-2019-2021-2024-pro-plus', 'Office 2019 Pro Plus', 'Office 2016 Pro Plus'),
        ('office-2016-2019-2021-2024-pro-plus', 'Office 2021 Pro Plus', 'Office 2019 Pro Plus'),
        ('office-2016-2019-2021-2024-pro-plus', 'Office 2024 Pro Plus', 'Office 2021 Pro Plus'),
        ('office-2016-2019-2021-2024-pro-plus', 'Office Pro Plus Multidispositivo', 'Office 2024 Pro Plus')
    )
    insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio, precio_anterior, activo, updated_at)
    select m.producto_id, m.nuevo, c.producto, c.tipo, c.precio, c.precio_anterior, c.activo, now()
    from mapa m
    join public.catalogo_precios c on c.producto_id = m.producto_id and c.variante = m.viejo
    on conflict (producto_id, variante) do update
        set precio = excluded.precio, precio_anterior = excluded.precio_anterior, activo = excluded.activo, updated_at = now();

    update public.catalogo_precios set producto = 'IPTV Smarters' where producto_id = 'iptv-smarters' and producto <> 'IPTV Smarters';
end;
$$;

-- Resultado: variantes nuevas con su precio
select producto_id, variante, precio, activo
from public.catalogo_precios
where (producto_id, variante) in (values
    ('netflix', 'Pantalla Colombia 26 días'),
    ('netflix', 'Pantalla Internacional 26 días'),
    ('hbo-max', 'Pantalla Estándar 1 Mes'),
    ('hbo-max', 'Pantalla Platino 1 Mes'),
    ('hbo-max', 'Cuenta Completa Estándar 1 Mes'),
    ('hbo-max', 'Cuenta Completa Platino 1 Mes'),
    ('iptv-smarters', 'Pantalla 1 Mes'),
    ('iptv-smarters', 'Cuenta Completa 1 Mes'),
    ('iptv-smarters', 'Cuenta Completa 2 Meses'),
    ('iptv-smarters', 'Cuenta Completa 3 Meses'),
    ('iptv-smarters', 'Cuenta Completa 6 Meses'),
    ('iptv-smarters', 'Cuenta Completa 12 Meses'),
    ('office-365', 'Licencia 1 Año (1 Equipo)'),
    ('office-365', 'Licencia 1 Año (5 Equipos)'),
    ('office-2016-2019-2021-2024-pro-plus', 'Office 2016 Pro Plus'),
    ('office-2016-2019-2021-2024-pro-plus', 'Office 2019 Pro Plus'),
    ('office-2016-2019-2021-2024-pro-plus', 'Office 2021 Pro Plus'),
    ('office-2016-2019-2021-2024-pro-plus', 'Office 2024 Pro Plus')
)
order by producto_id, precio;
