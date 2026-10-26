// supabase/wo-051-cantidades-anc.sql sobre wo-047 + wo-050: cantidades de ANC en precios_publicos sin tocar Emprende Red
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const RAIZ = (process.argv[2] ?? new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ').replace(/\/$/, ''));
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create function public.es_admin() returns boolean language sql stable as $$ select coalesce(current_setting('app.admin', true), 'no') = 'si' $$;
grant execute on function public.es_admin() to anon, authenticated;
create table public.catalogo_precios (producto_id text, variante text, producto text, tipo text, precio bigint, precio_anterior bigint, activo boolean default true, updated_at timestamptz default now(), primary key (producto_id, variante));
alter table public.catalogo_precios add column costo_proveedor bigint, add column plan_proveedor text, add column costo_proveedor_at timestamptz, add column proveedor text, add column stock_proveedor integer;
insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio, activo, proveedor) values
 ('netflix', 'Pantalla 30 días', 'Netflix', 'streaming', 15000, true, null),
 ('disney-plus', 'Pantalla Premium', 'Disney Plus', 'streaming', 15000, true, null),
 ('office-365', '1 Año', 'Office 365', 'licencias', 30000, true, null),
 ('er-cargador-1', 'Unidad', 'Cargador', 'tecnologia', 22400, true, 'emprendered');
create function public.normalizar_whatsapp(p text) returns text language sql as $$ select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') $$;
create table public.notificaciones_whatsapp (id serial, clave text unique, tipo text, compra_id text, destino text, variables jsonb, prioridad smallint);
create function public.encolar_aviso(p_clave text, p_tipo text, p_ref text, p_destino text, p_variables jsonb, p_prioridad smallint default 3) returns void language sql as $$
  insert into public.notificaciones_whatsapp (clave, tipo, compra_id, destino, variables, prioridad) values (p_clave, p_tipo, p_ref, p_destino, p_variables, p_prioridad) on conflict (clave) do nothing $$;
create table public.ordenes_web (codigo text primary key, whatsapp text);
create table public.triangulaciones (referencia text primary key, cliente text);`);
const q = async (s) => (await db.query(s)).rows;
// Sin wo-050: no aplica nada
const sql51 = fs.readFileSync(`${RAIZ}/supabase/wo-051-cantidades-anc.sql`, 'utf8');
let error = null;
try { await db.exec(sql51); } catch (e) { error = e.message; }
ok(/Nada se aplicó/.test(error ?? ''), 'sin wo-050 se detiene con «Nada se aplicó…»');
ok(!(await q("select 1 from information_schema.columns where table_name = 'catalogo_precios' and column_name = 'stock_anc'")).length, '… y no creó la columna');
await db.exec(fs.readFileSync(`${RAIZ}/supabase/wo-047-proveedor-y-rastreo.sql`, 'utf8'));
await db.exec(fs.readFileSync(`${RAIZ}/supabase/wo-050-disponibilidad.sql`, 'utf8'));
for (const vez of [1, 2]) { try { await db.exec(sql51); } catch (e) { console.log(`ERROR 051 (vez ${vez}):`, e.message); process.exit(1); } }
ok(true, 'wo-051 se aplica dos veces sin error');
await q(`select * from public.sincronizar_proveedor('emprendered', '[{"producto_id":"er-cargador-1","variante":"Unidad","producto":"Cargador","tipo":"tecnologia","costo":10000,"precio":15000,"stock":4,"ref":"1","categoria":"TECNOLOGIA"}]'::jsonb)`);
const marcar = async (items) => (await q(`select * from public.marcar_disponibilidad_anc('${JSON.stringify(items)}'::jsonb)`))[0];
let r = await marcar([{ producto_id: 'netflix', variante: 'Pantalla 30 días', agotado: false, stock: 3 }, { producto_id: 'disney-plus', variante: 'Pantalla Premium', agotado: false, stock: null },
    { producto_id: 'office-365', variante: '1 Año', agotado: false }]);
let pub = Object.fromEntries((await q('select * from public.precios_publicos()')).map((x) => [x.producto_id, x]));
ok(pub.netflix.existencias === 3 && pub.netflix.agotado === false, 'Netflix con 3 unidades en ANC → existencias 3 («Quedan 3»)');
ok(pub['disney-plus'].existencias === null && pub['office-365'].existencias === null, 'sin cantidad publicada (null o sin dato) → sin límite');
ok(pub['er-cargador-1'].existencias === 4, 'Emprende Red sigue con su stock propio (4)');
r = await marcar([{ producto_id: 'netflix', variante: 'Pantalla 30 días', agotado: false, stock: 3 }]);
ok(r.cambios === 0, 'misma cantidad → no cuenta como cambio');
r = await marcar([{ producto_id: 'netflix', variante: 'Pantalla 30 días', agotado: false, stock: 1 }]);
ok(r.cambios === 1 && r.repuestos.length === 0 && r.agotados.length === 0, 'baja de 3 a 1 → cambio sin aviso de agotado');
r = await marcar([{ producto_id: 'netflix', variante: 'Pantalla 30 días', agotado: true, stock: 5 }]);
pub = Object.fromEntries((await q('select * from public.precios_publicos()')).map((x) => [x.producto_id, x]));
ok(r.agotados.length === 1 && pub.netflix.agotado === true && pub.netflix.existencias === 0, 'agotado → existencias 0 y aviso de agotado (aunque traiga un número)');
r = await marcar([{ producto_id: 'netflix', variante: 'Pantalla 30 días', agotado: false, stock: 2 }]);
ok(r.repuestos.length === 1 && r.repuestos[0].stock === 2, 'vuelve con 2 → aviso «¡Volvió!» con las unidades');
r = await marcar([{ producto_id: 'er-cargador-1', variante: 'Unidad', agotado: true, stock: 0 }]);
pub = Object.fromEntries((await q('select * from public.precios_publicos()')).map((x) => [x.producto_id, x]));
ok(r.cambios === 0 && pub['er-cargador-1'].existencias === 4, 'nunca toca productos de Emprende Red');
const permisos = await q("select has_function_privilege('anon', 'public.marcar_disponibilidad_anc(jsonb)', 'execute') as anon, has_function_privilege('anon', 'public.precios_publicos()', 'execute') as pub");
ok(permisos[0].anon === false && permisos[0].pub === true, 'el público no puede marcar; sí puede leer precios_publicos');
