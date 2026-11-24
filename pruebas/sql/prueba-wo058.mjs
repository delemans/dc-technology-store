// supabase/wo-058-solo-anc.sql: Emprende Red en pausa y productos de ANC nuevos con precio en la base (PGlite)
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const RAIZ = (process.argv[2] ?? new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ').replace(/\/$/, ''));
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const db = new PGlite();
const uno = async (q, p = []) => (await db.query(q, p)).rows[0];
const sql = fs.readFileSync(`${RAIZ}/supabase/wo-058-solo-anc.sql`, 'utf8');
let error = null;
try { await db.exec(sql); } catch (e) { error = e.message; }
ok(/Nada se aplicó/.test(error ?? ''), 'sin catalogo_precios se detiene con «Nada se aplicó…»');
await db.exec(`
create table public.catalogo_precios (producto_id text not null, variante text not null, producto text not null, tipo text not null,
    precio bigint not null, precio_anterior bigint, activo boolean not null default true, updated_at timestamptz not null default now(), primary key (producto_id, variante));
create table public.proveedor_categorias (proveedor text not null, categoria text not null, visible boolean not null default false,
    updated_at timestamptz not null default now(), primary key (proveedor, categoria));
insert into public.proveedor_categorias values ('emprendered', 'TECNOLOGIA', true, now()), ('emprendered', 'HOGAR', false, now()), ('otro', 'X', true, now());
insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio) values ('youtube-premium', 'Suscripción 1 Mes', 'YouTube Premium', 'streaming', 16000),
    ('servicio-mantenimiento-computadores', 'Preventivo Software + Limpieza', 'Mantenimiento', 'servicios', 50000);`);
for (const vez of [1, 2]) { try { await db.exec(sql); } catch (e) { console.log(`ERROR (vez ${vez}):`, e.message); process.exit(1); } }
ok(true, 'wo-058 se aplica dos veces sin error');
ok(Number((await uno("select count(*) n from public.proveedor_categorias where proveedor = 'emprendered' and visible")).n) === 0, 'Emprende Red: ninguna categoría visible');
ok((await uno("select visible from public.proveedor_categorias where proveedor = 'otro'")).visible === true, '… y no toca otros proveedores');
ok(Number((await uno("select precio from public.catalogo_precios where producto_id = 'youtube-premium'")).precio) === 16000, 'precio que ya estaba en la base se conserva');
ok(Number((await uno("select count(*) n from public.catalogo_precios where tipo <> 'servicios'")).n) === 11, 'los 6 productos de ANC quedan con sus 11 planes');
ok(Number((await uno("select precio from public.catalogo_precios where variante = 'Preventivo Software + Limpieza'")).precio) === 60000, 'mantenimiento preventivo: $60.000');
ok(Number((await uno("select precio from public.catalogo_precios where variante = 'Revisión del Equipo (Diagnóstico)'")).precio) === 25000, 'revisión del equipo: $25.000');
// Los planes de la base coinciden con productos.json y con las equivalencias de ANC
const productos = JSON.parse(fs.readFileSync(`${RAIZ}/productos.json`, 'utf8'));
const eq = JSON.parse(fs.readFileSync(`${RAIZ}/herramientas/equivalencias-ancpagos.json`, 'utf8'));
const filas = (await db.query('select producto_id, variante, precio from public.catalogo_precios')).rows;
ok(filas.every((f) => productos.find((p) => p.id === f.producto_id)?.variantes.some((v) => v.nombre === f.variante)), 'cada plan existe en productos.json');
ok(filas.every((f) => f.producto_id.startsWith('servicio-') || eq[f.producto_id]?.variantes?.[f.variante] !== undefined), 'cada plan de ANC está enlazado');
ok(filas.every((f) => Number(productos.find((p) => p.id === f.producto_id).variantes.find((v) => v.nombre === f.variante).precio) === Number(f.precio) || f.producto_id === 'youtube-premium'), 'mismo precio que productos.json');
