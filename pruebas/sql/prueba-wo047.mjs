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
ok((await q(`select categoria_proveedor from public.catalogo_precios where producto_id = 'er-cargador-1'`))[0].categoria_proveedor === 'TECNOLOGIA', 'lo ya importado queda como TECNOLOGIA');
await q(`select * from public.sincronizar_proveedor('emprendered', '[{"producto_id":"er-cargador-1","variante":"Unidad","producto":"Cargador","tipo":"tecnologia","costo":16000,"precio":24000,"stock":5,"ref":"1","categoria":"TECNOLOGIA"},{"producto_id":"er-olla-2","variante":"Unidad","producto":"Olla","tipo":"variedades","costo":20000,"precio":30000,"stock":3,"ref":"2","categoria":"HOGAR"}]'::jsonb)`);
let pub = (await q(`select producto_id from public.precios_publicos()`)).map((x) => x.producto_id).sort();
ok(JSON.stringify(pub) === JSON.stringify(['er-cargador-1', 'netflix']), `categoría nueva (HOGAR) llega OCULTA (${pub.join(',')})`);
ok(Number((await q(`select precio from public.catalogo_precios where producto_id = 'er-cargador-1'`))[0].precio) === 24000, 'precio actualizado por la sincronización (costo + 50 %)');
await db.exec(`set role authenticated; set app.admin = 'si'`);
const cats = await q(`select * from public.categorias_proveedor('emprendered')`);
ok(cats.length === 2 && cats.some((c) => c.categoria === 'HOGAR' && !c.visible && c.productos === 1), 'el panel lista las categorías con su conteo');
const r1 = (await q(`select * from public.cambiar_categoria_proveedor('emprendered', 'HOGAR', true)`))[0];
ok(r1.ok, 'el admin activa HOGAR');
await db.exec(`reset role`);
pub = (await q(`select producto_id from public.precios_publicos()`)).map((x) => x.producto_id).sort();
ok(pub.includes('er-olla-2'), 'activada → aparece en la tienda y el bot');
await db.exec(`set role authenticated; set app.admin = 'no'`);
const r2 = (await q(`select * from public.cambiar_categoria_proveedor('emprendered', 'HOGAR', false)`))[0];
ok(!r2.ok, 'quien no es admin no puede cambiar categorías');
let bloq = false; try { await q(`select * from public.categorias_proveedor('emprendered')`); } catch { bloq = true; }
ok(bloq, 'quien no es admin no ve el panel de categorías');
await db.exec(`reset role; set role anon`);
bloq = false; try { await q(`select * from public.proveedor_categorias`); } catch { bloq = true; }
ok(bloq, 'la llave pública no lee la tabla de categorías');
bloq = false; try { await q(`select * from public.rastreos`); } catch { bloq = true; }
ok(bloq, 'la llave pública no lee la tabla de rastreos');
await db.exec(`reset role`);
let g = (await q(`select * from public.registrar_guia('dc-web01', '0123456789')`))[0];
ok(g.ok && g.destino === '573001112233', '#guia enlaza la guía a una orden web (con su WhatsApp)');
g = (await q(`select * from public.registrar_guia('DC-CHT01', '987654')`))[0];
ok(g.ok && g.destino === '573004445566', '#guia también para pedidos por chat');
g = (await q(`select * from public.registrar_guia('DC-NOEXI', '987654')`))[0];
ok(!g.ok, 'pedido inexistente → error claro');
ok((await q(`select * from public.rastreos_abiertos()`)).length === 2, 'n8n ve las 2 guías abiertas');
let u = (await q(`select * from public.actualizar_rastreo('DC-WEB01', 'EN TRANSITO', 'Salió de Cali', 'Coordinadora', '[{"date":"2026-10-19","status":"EN TRANSITO"}]'::jsonb)`))[0];
ok(u.cambio, 'estado nuevo → cambio');
u = (await q(`select * from public.actualizar_rastreo('DC-WEB01', 'EN TRANSITO', 'Salió de Cali', 'Coordinadora', '[]'::jsonb)`))[0];
ok(!u.cambio, 'mismo estado → sin cambio');
const avisos = await q(`select * from public.notificaciones_whatsapp where tipo = 'RASTREO'`);
ok(avisos.length === 1 && avisos[0].destino === '573001112233' && avisos[0].variables.transportadora === 'Coordinadora', 'un solo aviso RASTREO al cliente por estado');
await q(`select * from public.actualizar_rastreo('DC-WEB01', 'ENTREGADO', 'Recibido', 'Coordinadora', '[]'::jsonb)`);
ok((await q(`select * from public.rastreos_abiertos()`)).length === 1, 'entregado → ya no se consulta');
await db.exec(`set role anon`);
const pubR = (await q(`select * from public.rastreo_publico('DC-WEB01')`))[0];
ok(pubR.estado === 'ENTREGADO' && pubR.entregado && pubR.transportadora === 'Coordinadora' && pubR.historial.length === 1 && !('destino' in pubR), 'el cliente ve el estado en Mis pedidos (sin su teléfono ni datos del proveedor)');
