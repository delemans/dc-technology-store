// herramientas/generar_precios_sql.js — Copia los precios actuales de productos.json a la semilla de
// supabase/wo-032-fase3.sql (entre las marcas <semilla-precios>). La semilla usa ON CONFLICT DO NOTHING:
// solo carga lo que aún no existe en la base. Desde ese momento la BASE manda (se edita en el panel).
//
//   node herramientas/generar_precios_sql.js

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ARCHIVO_SQL = path.join(RAIZ, 'supabase', 'wo-032-fase3.sql');
const productos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8'));

const texto = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
const filas = [];
for (const p of productos) {
    for (const v of p.variantes ?? []) {
        const precio = Math.round(Number(v.precio) || 0);
        const anterior = Number(v.precio_anterior) > precio ? Math.round(Number(v.precio_anterior)) : null;
        filas.push(`    (${texto(p.id)}, ${texto(v.nombre)}, ${texto(p.nombre)}, ${texto(p.tipo)}, ${precio}, ${anterior ?? 'null'})`);
    }
}

const semilla = [
    '-- <semilla-precios> (generado por herramientas/generar_precios_sql.js; no editar a mano)',
    'insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio, precio_anterior) values',
    filas.join(',\n'),
    'on conflict (producto_id, variante) do nothing;',
    '-- </semilla-precios>',
].join('\n');

const sql = fs.readFileSync(ARCHIVO_SQL, 'utf8');
const inicio = sql.indexOf('-- <semilla-precios>');
const fin = sql.indexOf('-- </semilla-precios>');
if (inicio < 0 || fin < 0) throw new Error('No encontré las marcas <semilla-precios> en wo-032-fase3.sql');
fs.writeFileSync(ARCHIVO_SQL, sql.slice(0, inicio) + semilla + sql.slice(fin + '-- </semilla-precios>'.length), 'utf8');
console.log(`Semilla de precios: ${filas.length} variantes de ${productos.length} productos → supabase/wo-032-fase3.sql`);
