// supabase/wo-047-proveedor-y-rastreo.sql: categorías visibles del proveedor y rastreo de envíos
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create function public.es_admin() returns boolean language sql stable as $$ select coalesce(current_setting('app.admin', true), 'no') = 'si' $$;
grant execute on function public.es_admin() to anon, authenticated;
create table public.catalogo_precios (producto_id text, variante text, producto text, tipo text, precio bigint, precio_anterior bigint, activo boolean default true, updated_at timestamptz default now(), primary key (producto_id, variante));
alter table public.catalogo_precios add column costo_proveedor bigint, add column plan_proveedor text, add column costo_proveedor_at timestamptz, add column proveedor text, add column stock_proveedor integer;
insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio, activo, proveedor) values
 ('netflix', 'Pantalla', 'Netflix', 'streaming', 15000, true, null),
 ('er-cargador-1', 'Unidad', 'Cargador', 'tecnologia', 22400, true, 'emprendered');
create function public.normalizar_whatsapp(p text) returns text language sql as $$ select nullif(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), '') $$;
create table public.notificaciones_whatsapp (id serial, clave text unique, tipo text, compra_id text, destino text, variables jsonb, prioridad smallint);
create function public.encolar_aviso(p_clave text, p_tipo text, p_ref text, p_destino text, p_variables jsonb, p_prioridad smallint default 3) returns void language sql as $$
  insert into public.notificaciones_whatsapp (clave, tipo, compra_id, destino, variables, prioridad) values (p_clave, p_tipo, p_ref, p_destino, p_variables, p_prioridad) on conflict (clave) do nothing $$;
create table public.ordenes_web (codigo text primary key, whatsapp text);
create table public.triangulaciones (referencia text primary key, cliente text);
insert into public.ordenes_web values ('DC-WEB01', '573001112233');
insert into public.triangulaciones values ('DC-CHT01', '573004445566');`);
const sql = fs.readFileSync(`${(process.argv[2] ?? new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ').replace(/\/$/, ''))}/supabase/wo-047-proveedor-y-rastreo.sql`, 'utf8');
for (const vez of [1, 2]) { try { await db.exec(sql); } catch (e) { console.log(`ERROR SQL (vez ${vez}):`, e.message); process.exit(1); } }
ok(true, 'se aplica dos veces sin error');
const q = async (s) => (await db.query(s)).rows;
for (const vez of [1, 2]) { try { await db.exec(fs.readFileSync((process.argv[2] ?? new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ').replace(/\/$/, '')) + '/supabase/wo-050-disponibilidad.sql', 'utf8')); } catch (e) { console.log('ERROR 050 (vez ' + vez + '):', e.message); process.exit(1); } }
ok(true, 'wo-050 se aplica dos veces sin error');
const sync = async (items) => (await q("select * from public.sincronizar_proveedor('emprendered', '" + JSON.stringify(items) + "'::jsonb)"))[0];
const it = (id, stock, cat = 'TECNOLOGIA') => ({ producto_id: id, variante: 'Unidad', producto: id, tipo: 'tecnologia', costo: 10000, precio: 15000, stock, ref: '1', categoria: cat });
let r = await sync([it('er-a-1', 5), it('er-b-2', 3), it('er-c-3', 2), it('er-oculto-4', 4, 'HOGAR')]);
ok(r.insertados >= 3, 'primera sincronización: inserta');
r = await sync([it('er-a-1', 0), it('er-b-2', 3), it('er-oculto-4', 0, 'HOGAR')]);
const est = Object.fromEntries((await q("select producto_id, estado_proveedor, activo from public.catalogo_precios where proveedor = 'emprendered'")).map((x) => [x.producto_id, x]));
ok(est['er-a-1'].estado_proveedor === 'AGOTADO' && !est['er-a-1'].activo, 'sin unidades → AGOTADO (no se vende)');
ok(est['er-c-3'].estado_proveedor === 'RETIRADO', 'el proveedor ya no lo trae → RETIRADO');
ok(r.agotados.some((x) => x.producto_id === 'er-a-1') && !r.agotados.some((x) => x.producto_id === 'er-oculto-4'), 'reporta los que se agotaron (solo de categorías visibles)');
let pub = await q("select producto_id, agotado, existencias from public.precios_publicos() where producto_id like 'er-%' order by 1");
ok(pub.some((x) => x.producto_id === 'er-a-1' && x.agotado === true) && !pub.some((x) => x.producto_id === 'er-c-3') && !pub.some((x) => x.producto_id === 'er-oculto-4'),
    'la tienda recibe el agotado marcado; lo retirado y lo oculto no salen (' + pub.map((x) => x.producto_id + (x.agotado ? ' agotado' : '')).join(', ') + ')');
r = await sync([it('er-a-1', 7), it('er-b-2', 3), it('er-c-3', 1)]);
ok(r.repuestos.length === 2 && r.repuestos.some((x) => x.producto_id === 'er-a-1' && x.stock === 7) && r.repuestos.some((x) => x.producto_id === 'er-c-3'), 'vuelven a tener unidades → REPUESTOS (para el estado "¡Volvió!"), también lo retirado que regresa');
r = await sync([it('er-a-1', 6), it('er-b-2', 3), it('er-c-3', 1)]);
ok(r.repuestos.length === 0, 'si ya estaba disponible no se repite el aviso');
// ANC
await q("insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio, activo) values ('crunchyroll', 'Perfil Mega Fan 1 Mes', 'Crunchyroll', 'streaming', 10000, true), ('canva-pro', 'Acceso 1 Mes', 'Canva', 'licencias', 10000, false)");
let a = (await q(`select * from public.marcar_disponibilidad_anc('[{"producto_id":"crunchyroll","variante":"Perfil Mega Fan 1 Mes","agotado":true}]'::jsonb)`))[0];
ok(a.cambios === 1 && a.agotados.length === 1, 'ANC: plan agotado en su tienda → AGOTADO');
pub = await q("select producto_id, agotado from public.precios_publicos() where producto_id in ('crunchyroll', 'canva-pro')");
ok(pub.length === 1 && pub[0].agotado === true, 'la tienda lo muestra agotado; lo que pausaste tú (canva) sigue sin salir');
a = (await q(`select * from public.marcar_disponibilidad_anc('[{"producto_id":"crunchyroll","variante":"Perfil Mega Fan 1 Mes","agotado":false}]'::jsonb)`))[0];
ok(a.repuestos.length === 1, 'ANC: vuelve a estar disponible → repuesto');
const act = (await q("select activo from public.catalogo_precios where producto_id = 'canva-pro'"))[0].activo;
ok(act === false, 'marcar_disponibilidad_anc nunca reactiva lo que pausaste en el panel');
await db.exec('set role anon');
let bloq = false; try { await q("select * from public.marcar_disponibilidad_anc('[]'::jsonb)"); } catch { bloq = true; }
ok(bloq, 'la llave pública no puede cambiar disponibilidades');
