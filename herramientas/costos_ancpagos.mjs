// Genera supabase/wo-038-costos-ancpagos.sql con el COSTO actual de cada variante en ANC Pagos (proveedor).
//   node herramientas/costos_ancpagos.mjs
// Lee el catálogo público de ancpagos.com y la tabla de equivalencias (herramientas/equivalencias-ancpagos.json).
// El SQL solo guarda costos: NUNCA cambia precios de venta. Vuelve a generarlo y ejecutarlo cuando ANC cambie precios;
// el panel (Precios del catálogo) muestra costo y margen de cada variante con estos datos.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerAnc } from './catalogo_ancpagos.mjs';
import { EQUIVALENCIAS } from './comparar_ancpagos.mjs';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'supabase', 'wo-038-costos-ancpagos.sql');
const sql = (v) => `'${String(v).replace(/'/g, "''")}'`;

// Si ANC no responde (mantenimiento, caída), se usa la última copia guardada por catalogo_ancpagos.mjs y se avisa
const COPIA = path.join(RAIZ, 'herramientas', 'salida', 'ancpagos.json');
let anc;
try {
    anc = await leerAnc();
    fs.mkdirSync(path.dirname(COPIA), { recursive: true });
    fs.writeFileSync(COPIA, JSON.stringify(anc, null, 2));
} catch (error) {
    if (!fs.existsSync(COPIA)) throw error;
    anc = JSON.parse(fs.readFileSync(COPIA, 'utf8'));
    console.warn(`⚠ ancpagos.com no respondió (${error.message}): uso la copia guardada del ${anc.leido_at}.`);
}
const costo = new Map(anc.filas.map((f) => [`${f.producto}|${f.variante}`, f]));
const filas = [];
const sinCosto = [];
for (const [id, eq] of Object.entries(EQUIVALENCIAS)) {
    for (const [variante, plan] of Object.entries(eq.variantes)) {
        const f = costo.get(`${eq.proveedor}|${plan}`);
        if (!f || !(Number(f.costo) > 0)) { sinCosto.push(`${id} · ${variante} (${eq.proveedor} · ${plan})`); continue; }
        filas.push(`    (${sql(id)}, ${sql(variante)}, ${Math.round(f.costo)}, ${sql(`${eq.proveedor} · ${plan}`)})`);
    }
}
if (!filas.length) throw new Error('No se pudo leer ningún costo de ANC: no se generó el SQL.');

fs.writeFileSync(SALIDA, `-- =====================================================================
-- WO-038 · Costo del proveedor (ANC Pagos) por variante → el panel muestra costo y margen
-- Generado por herramientas/costos_ancpagos.mjs el ${anc.leido_at} (no editar a mano: volver a generar).
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

-- Costos leídos de ancpagos.com (${filas.length} variantes)
update public.catalogo_precios c
   set costo_proveedor = v.costo, plan_proveedor = v.plan, costo_proveedor_at = now()
  from (values
${filas.join(',\n')}
  ) as v(producto_id, variante, costo, plan)
 where c.producto_id = v.producto_id and c.variante = v.variante;

-- Resultado: variantes con costo y cuántas se venden sin margen
select count(*) filter (where costo_proveedor is not null) as con_costo,
       count(*) filter (where costo_proveedor is not null and precio <= costo_proveedor) as sin_margen,
       count(*) filter (where costo_proveedor is not null and activo and precio <= costo_proveedor) as activas_sin_margen
from public.catalogo_precios;
`);
console.log(`wo-038: ${filas.length} costos de ANC → ${path.relative(RAIZ, SALIDA)}${sinCosto.length ? ` · sin costo en ANC: ${sinCosto.join('; ')}` : ''}`);
