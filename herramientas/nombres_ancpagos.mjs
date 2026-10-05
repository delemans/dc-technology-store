// Corrige los nombres de variantes que prometían algo distinto a lo que entrega ANC Pagos (proveedor).
// Los PRECIOS NO CAMBIAN: cada variante conserva su precio, solo cambia el nombre.
//   node herramientas/nombres_ancpagos.mjs
// Hace tres cosas a partir de la misma tabla RENOMBRES:
//   1. productos.json (nombres de variantes y de producto)
//   2. supabase/wo-034-nombres-ancpagos.sql  → copia cada precio al nombre nuevo (antes de publicar)
//   3. supabase/wo-034b-retirar-nombres-viejos.sql → pausa los nombres viejos (después de publicar)
// Equivalencia = variante del proveedor con el mismo precio (ver herramientas/comparar_ancpagos.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// [producto_id, nombre viejo, nombre nuevo, variante ANC con el mismo precio]
export const RENOMBRES = [
    ['netflix', 'Pantalla Colombia (1 Dispositivo)', 'Pantalla Colombia 26 días', 'Pantalla 26 dias'],
    ['netflix', 'Pantalla Internacional (1 Dispositivo)', 'Pantalla Internacional 26 días', 'Pantalla Internacional 26 dias'],
    ['hbo-max', 'Pantalla 1 Mes', 'Pantalla Estándar 1 Mes', 'Pantalla Estandar'],
    ['hbo-max', 'Cuenta Completa 1 Mes', 'Pantalla Platino 1 Mes', 'Pantalla Platino'],
    ['hbo-max', 'Cuenta Completa 3 Meses', 'Cuenta Completa Estándar 1 Mes', 'Completa Estandar'],
    ['hbo-max', 'Cuenta Completa 6 Meses', 'Cuenta Completa Platino 1 Mes', 'Completa Platino'],
    ['iptv-smarters', '1 Mes (1 Dispositivo)', 'Pantalla 1 Mes', 'Pantalla'],
    ['iptv-smarters', '1 Mes (2 Dispositivos)', 'Cuenta Completa 1 Mes', 'Cuenta Completa'],
    ['iptv-smarters', '3 Meses (1 Dispositivo)', 'Cuenta Completa 2 Meses', 'Completa 2 meses'],
    ['iptv-smarters', '6 Meses (1 Dispositivo)', 'Cuenta Completa 3 Meses', 'Completa 3 meses'],
    ['iptv-smarters', '12 Meses (1 Dispositivo)', 'Cuenta Completa 6 Meses', 'Completa 6 meses'],
    ['iptv-smarters', '12 Meses (2 Dispositivos)', 'Cuenta Completa 12 Meses', 'Completa 12 meses'],
    ['office-365', 'Licencia 1 Año (5 Dispositivos)', 'Licencia 1 Año (1 Equipo)', '1 Año 1 Equipo'],
    ['office-365', 'Licencia Vitalicia', 'Licencia 1 Año (5 Equipos)', '1 Año 5 Equipos'],
    // Cadena: el nombre nuevo de una es el viejo de la siguiente (el SQL lee todos los precios antes de escribir)
    ['office-2016-2019-2021-2024-pro-plus', 'Office 2019 Pro Plus', 'Office 2016 Pro Plus', '2016'],
    ['office-2016-2019-2021-2024-pro-plus', 'Office 2021 Pro Plus', 'Office 2019 Pro Plus', '2019'],
    ['office-2016-2019-2021-2024-pro-plus', 'Office 2024 Pro Plus', 'Office 2021 Pro Plus', '2021'],
    ['office-2016-2019-2021-2024-pro-plus', 'Office Pro Plus Multidispositivo', 'Office 2024 Pro Plus', '2024'],
];
// Nombres de producto que prometían otra cosa (Plex es un producto aparte en el proveedor)
export const PRODUCTOS = { 'iptv-smarters': 'IPTV Smarters' };

const sql = (v) => `'${String(v).replace(/'/g, "''")}'`;

if (process.argv[1]?.replace(/\\/g, '/').endsWith('nombres_ancpagos.mjs')) {
    // 1) productos.json: reemplazo de texto dentro del bloque de cada producto (conserva el formato del
    //    archivo). Idempotente: si el nombre viejo ya no está, no toca nada.
    const ruta = path.join(RAIZ, 'productos.json');
    let texto = fs.readFileSync(ruta, 'utf8');
    const json = (v) => JSON.stringify(v);
    let cambios = 0;
    for (const id of new Set([...RENOMBRES.map(([pid]) => pid), ...Object.keys(PRODUCTOS)])) {
        const inicio = texto.indexOf(`"id": ${json(id)}`);
        if (inicio < 0) throw new Error(`productos.json: no existe el producto ${id}`);
        const siguiente = texto.indexOf('"id": ', inicio + 6);
        const finBloque = siguiente < 0 ? texto.length : siguiente;
        let bloque = texto.slice(inicio, finBloque);
        let propios = RENOMBRES.filter(([pid]) => pid === id);
        // Ya aplicado en este producto: están todos los nombres nuevos y ningún viejo que no sea también nuevo
        const tiene = (n) => bloque.includes(`"nombre": ${json(n)}`);
        const nuevos = new Set(propios.map(([, , n]) => n));
        if (propios.every(([, , n]) => tiene(n)) && !propios.some(([, v]) => !nuevos.has(v) && tiene(v))) propios = [];
        // Dos pasos (viejo → marca → nuevo) para la cadena de Office, donde un nombre nuevo es el viejo de otra
        propios.forEach(([, viejo], i) => {
            const antes = bloque;
            bloque = bloque.replace(`"nombre": ${json(viejo)}`, `"nombre": "@@renombre-${i}@@"`);
            if (bloque !== antes) cambios++;
        });
        propios.forEach(([, , nuevo], i) => { bloque = bloque.replace(`"nombre": "@@renombre-${i}@@"`, `"nombre": ${json(nuevo)}`); });
        if (PRODUCTOS[id]) {
            const actual = bloque.match(/"nombre": ("(?:[^"\\]|\\.)*")/)?.[1];
            if (actual && JSON.parse(actual) !== PRODUCTOS[id]) { bloque = bloque.replace(`"nombre": ${actual}`, `"nombre": ${json(PRODUCTOS[id])}`); cambios++; }
        }
        texto = texto.slice(0, inicio) + bloque + texto.slice(finBloque);
    }
    JSON.parse(texto); // sigue siendo JSON válido
    fs.writeFileSync(ruta, texto);

    // 2) SQL: copia el precio de cada nombre viejo al nuevo (lee todo antes de escribir)
    const valores = RENOMBRES.map(([id, viejo, nuevo]) => `        (${sql(id)}, ${sql(viejo)}, ${sql(nuevo)})`).join(',\n');
    const nombresProducto = Object.entries(PRODUCTOS).map(([id, nombre]) => `    update public.catalogo_precios set producto = ${sql(nombre)} where producto_id = ${sql(id)} and producto <> ${sql(nombre)};`).join('\n');
    fs.writeFileSync(path.join(RAIZ, 'supabase', 'wo-034-nombres-ancpagos.sql'), `-- =====================================================================
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
${valores}
    )
    select string_agg(m.producto_id || ' · ' || m.viejo, ', ') into v_faltan
    from mapa m
    where not exists (select 1 from public.catalogo_precios c where c.producto_id = m.producto_id and c.variante = m.viejo);
    if v_faltan is not null then
        raise exception 'Nada se aplicó. No están en catalogo_precios: %', v_faltan;
    end if;

    -- Una sola sentencia: todos los precios se leen antes de escribir (la cadena de Office no se corre)
    with mapa (producto_id, viejo, nuevo) as (values
${valores}
    )
    insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio, precio_anterior, activo, updated_at)
    select m.producto_id, m.nuevo, c.producto, c.tipo, c.precio, c.precio_anterior, c.activo, now()
    from mapa m
    join public.catalogo_precios c on c.producto_id = m.producto_id and c.variante = m.viejo
    on conflict (producto_id, variante) do update
        set precio = excluded.precio, precio_anterior = excluded.precio_anterior, activo = excluded.activo, updated_at = now();

${nombresProducto}
end;
$$;

-- Resultado: variantes nuevas con su precio
select producto_id, variante, precio, activo
from public.catalogo_precios
where (producto_id, variante) in (values
${RENOMBRES.map(([id, , nuevo]) => `    (${sql(id)}, ${sql(nuevo)})`).join(',\n')}
)
order by producto_id, precio;
`);

    // 3) SQL de limpieza: pausa los nombres viejos que ya no son nombre nuevo de nadie
    const nuevos = new Set(RENOMBRES.map(([id, , nuevo]) => `${id}|${nuevo}`));
    const retirar = RENOMBRES.filter(([id, viejo]) => !nuevos.has(`${id}|${viejo}`));
    fs.writeFileSync(path.join(RAIZ, 'supabase', 'wo-034b-retirar-nombres-viejos.sql'), `-- =====================================================================
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
${retirar.map(([id, viejo]) => `    (${sql(id)}, ${sql(viejo)})`).join(',\n')}
)
returning producto_id, variante, precio, activo;
`);
    console.log(`productos.json: ${cambios} cambios · SQL: ${RENOMBRES.length} renombres, ${retirar.length} nombres viejos a pausar`);
}
