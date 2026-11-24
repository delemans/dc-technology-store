// herramientas/recalcular-precios-anc.mjs — Recalcula el precio de venta de TODO lo de ANC visible con la regla de
// margen (precios-margen.mjs) a partir del costo real leído hoy en ANC (comparar_ancpagos.mjs).
//   node --use-system-ca herramientas/recalcular-precios-anc.mjs           → informe + SQL (no cambia nada)
//   node --use-system-ca herramientas/recalcular-precios-anc.mjs --aplicar → además actualiza productos.json
// Salidas: herramientas/salida/precios-con-margen.md · supabase/wo-059-precios-con-margen.sql (lo aplica el director en
// Supabase: la base manda sobre productos.json). Los servicios propios no se tocan. Emprende Red: nada (en pausa).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { precioVenta, margenes, REGLA } from './precios-margen.mjs';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { filtrar } = require('./disponibilidad.js');
const cop = (v) => `$${Number(v).toLocaleString('es-CO')}`;
const sql = (v) => `'${String(v).replace(/'/g, "''")}'`;

// 1) Costos de hoy en ANC
execFileSync(process.execPath, ['--use-system-ca', path.join(RAIZ, 'herramientas', 'comparar_ancpagos.mjs')], { stdio: 'inherit' });
const comp = JSON.parse(fs.readFileSync(path.join(RAIZ, 'herramientas', 'salida', 'comparacion-ancpagos.json'), 'utf8'));
const eq = JSON.parse(fs.readFileSync(path.join(RAIZ, 'herramientas', 'equivalencias-ancpagos.json'), 'utf8'));
const textoProductos = fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8');
const productos = JSON.parse(textoProductos);
const visibles = filtrar(productos).filter((p) => !p.oculto && eq[p.id]);

// 2) Nuevo precio por plan visible
const filas = [], sinCosto = [];
for (const p of visibles) for (const v of p.variantes) {
    // productos de variante única en ANC (tecnología física): vienen en «faltan» con variante vacía
    const unica = eq[p.id].variantes?.[v.nombre] === '' ? (comp.faltan ?? []).find((f) => f.producto === eq[p.id].proveedor && !f.variante && f.costo > 0) : null;
    const c = comp.filas.find((f) => f.producto_id === p.id && f.variante === v.nombre && f.costo > 0) ?? (unica ? { costo: unica.costo, precio: Number(v.precio) } : null);
    if (!c) { sinCosto.push(`${p.id} · ${v.nombre}`); continue; }
    const nuevo = precioVenta(c.costo);
    filas.push({ id: p.id, nombre: p.nombre, variante: v.nombre, costo: c.costo, antes: Number(v.precio), base: c.precio, nuevo, m: margenes(nuevo, c.costo) });
}
const er = filtrar(productos).filter((p) => !p.oculto && String(p.id).startsWith('er-'));

// 3) Informe
const md = [`# Precios con margen · ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`, '',
    `Regla: margen neto mínimo ${REGLA.margen} % y ${cop(REGLA.minimo)} AUN con el descuento máximo (${REGLA.descuentoMax} %, cupón de primera compra). Costo = precio de ANC hoy (${comp.leido_at}).`, '',
    `Planes recalculados: ${filas.length} · sin costo leído (se dejan igual y se revisan): ${sinCosto.length} · productos de Emprende Red visibles: ${er.length}`, '',
    '| Producto | Plan | Costo ANC | Precio hoy | **Precio nuevo** | Margen sin cupón | Margen con cupón 10 % |', '|---|---|---:|---:|---:|---:|---:|',
    ...filas.map((f) => `| ${f.nombre} | ${f.variante} | ${cop(f.costo)} | ${cop(f.base)} | **${cop(f.nuevo)}** | ${cop(f.m.sin)} (${f.m.sinPct} %) | ${cop(f.m.con)} (${f.m.conPct} %) |`),
    '', ...(sinCosto.length ? ['## Sin costo leído (no se cambian)', ...sinCosto.map((s) => `- ${s}`)] : [])].join('\n');
fs.mkdirSync(path.join(RAIZ, 'herramientas', 'salida'), { recursive: true });
fs.writeFileSync(path.join(RAIZ, 'herramientas', 'salida', 'precios-con-margen.md'), md);
fs.writeFileSync(path.join(RAIZ, 'herramientas', 'salida', 'precios-con-margen.json'), JSON.stringify({ leido: comp.leido_at, regla: REGLA, filas: filas.map((f) => ({ ...f, tipo: productos.find((p) => p.id === f.id)?.tipo })) }, null, 1));

// 4) SQL para la base (la base manda: lo que se cobra en la web, el bot y la publicidad)
const cuerpo = filas.map((f) => `    (${sql(f.id)}, ${sql(f.variante)}, ${f.nuevo}, ${f.costo})`).join(',\n');
fs.writeFileSync(path.join(RAIZ, 'supabase', 'wo-059-precios-con-margen.sql'), `-- =====================================================================
-- WO-059 · Precios de ANC CON MARGEN (24/11/2026, decisión delegada por el director: «guardarme siempre mi margen»).
--   Hasta hoy el precio de venta era IGUAL al costo de ANC (anc_margen = 0 en n8n): margen $0 y, con el cupón de
--   primera compra (10 %), pérdida. Regla (herramientas/precios-margen.mjs): margen neto mínimo ${REGLA.margen} % y $${REGLA.minimo}
--   aun con el ${REGLA.descuentoMax} % de descuento; redondeo a $1.000 ($5.000 desde $100.000). Costo = ANC hoy.
--   Generado por herramientas/recalcular-precios-anc.mjs · ${filas.length} planes · idempotente.
-- =====================================================================
do $$ begin
    if to_regclass('public.catalogo_precios') is null then raise exception 'Nada se aplicó. Falta public.catalogo_precios (wo-032).'; end if;
end $$;
with nuevos(producto_id, variante, precio, costo) as (values
${cuerpo})
update public.catalogo_precios c
   set precio = n.precio, costo_proveedor = n.costo, costo_proveedor_at = now(), precio_anterior = null, updated_at = now()
  from nuevos n
 where c.producto_id = n.producto_id and c.variante = n.variante
   and (c.precio <> n.precio or c.costo_proveedor is distinct from n.costo);
-- Promociones que no hacen perder: ningún descuento supera el ${REGLA.descuentoMax}% que cubre el margen.
--   Combos (wo-029): 2 plataformas 5 %, 3 o más 10 % (antes 10 % y 15 %). Cupones (wo-012): máximo ${REGLA.descuentoMax} %.
--   Además queda un TOPE en la base: ni desde el panel se puede crear un descuento mayor.
do $$ begin
    if to_regclass('public.reglas_combo') is not null then
        update public.reglas_combo set descuento_pct = case when min_plataformas <= 2 then 5 else ${REGLA.descuentoMax} end, updated_at = now()
         where descuento_pct > case when min_plataformas <= 2 then 5 else ${REGLA.descuentoMax} end;
        if not exists (select 1 from pg_constraint where conname = 'reglas_combo_tope_margen') then
            alter table public.reglas_combo add constraint reglas_combo_tope_margen check (descuento_pct <= ${REGLA.descuentoMax});
        end if;
    end if;
    if to_regclass('public.cupones') is not null then
        update public.cupones set porcentaje = ${REGLA.descuentoMax} where porcentaje > ${REGLA.descuentoMax};
        if not exists (select 1 from pg_constraint where conname = 'cupones_tope_margen') then
            alter table public.cupones add constraint cupones_tope_margen check (porcentaje <= ${REGLA.descuentoMax});
        end if;
    end if;
end $$;
-- Verificación: ningún plan de ANC activo queda sin margen
select count(*) filter (where costo_proveedor is not null and precio <= costo_proveedor) as planes_sin_margen,
       count(*) filter (where costo_proveedor is not null and round(precio * 0.9) <= costo_proveedor) as planes_en_perdida_con_cupon
  from public.catalogo_precios where activo and coalesce(proveedor, '') <> 'emprendered';
`);

// 5) productos.json (respaldo de la tienda y de las páginas p/): cambio de texto mínimo, sin reformatear
if (process.argv.includes('--aplicar')) {
    let t = textoProductos.replace(/\r\n/g, '\n'); let n = 0;
    for (const f of filas) {
        const ini = t.indexOf(`"id": "${f.id}"`); if (ini < 0) continue;
        const fin = t.indexOf('\n    }', ini);
        const bloque = t.slice(ini, fin);
        const re = new RegExp(`("nombre": ${JSON.stringify(f.variante).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},\\s*"precio": )\\d+`);
        const nuevoBloque = bloque.replace(re, `$1${f.nuevo}`);
        if (nuevoBloque !== bloque) { t = t.slice(0, ini) + nuevoBloque + t.slice(fin); n++; }
    }
    if (textoProductos.includes('\r\n')) t = t.replace(/\n/g, '\r\n');
    JSON.parse(t);
    fs.writeFileSync(path.join(RAIZ, 'productos.json'), t);
    console.log(`productos.json: ${n} planes actualizados`);
}
const enPerdida = filas.filter((f) => f.m.con < REGLA.minimo);
console.log(`Recalculados ${filas.length} planes · sin costo ${sinCosto.length} · Emprende Red visible ${er.length} · en pérdida con cupón: ${enPerdida.length}`);
console.log('Informe: herramientas/salida/precios-con-margen.md · SQL: supabase/wo-059-precios-con-margen.sql');
