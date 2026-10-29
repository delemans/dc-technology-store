// supabase/wo-052-resumen-dia.sql: resumen de ventas del día con el mismo cálculo que finanzas_panel (wo-046)
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const RAIZ = (process.argv[2] ?? new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ').replace(/\/$/, ''));
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create table public.compras_proveedor (id serial primary key, costo_real_cop numeric);
create table public.triangulaciones (referencia text primary key, producto text, variante text, precio_venta bigint, costo_proveedor bigint,
  compra_id text, estado text, origen_web boolean default false, es_combo boolean default false, grupo text,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.ordenes_web (codigo text primary key, estado text, total_declarado bigint, created_at timestamptz default now());`);
const q = async (s) => (await db.query(s)).rows;
const sql = fs.readFileSync(`${RAIZ}/supabase/wo-052-resumen-dia.sql`, 'utf8');

// Sin wo-046: no aplica nada
let error = null;
try { await db.exec(sql); } catch (e) { error = e.message; }
ok(/Nada se aplicó/.test(error ?? ''), 'sin wo-046 se detiene con «Nada se aplicó…»');
ok(!(await q("select 1 from pg_proc where proname = 'resumen_ventas_dia'")).length, '… y no creó la función');

// Con wo-046 (basta la firma de finanzas_panel para la verificación previa)
await db.exec(`create function public.finanzas_panel(p_desde timestamptz, p_hasta timestamptz) returns jsonb language sql as $$ select '{}'::jsonb $$;`);
for (const vez of [1, 2]) { try { await db.exec(sql); } catch (e) { console.log(`ERROR 052 (vez ${vez}):`, e.message); process.exit(1); } }
ok(true, 'wo-052 se aplica dos veces sin error');

await db.exec(`insert into public.compras_proveedor (id, costo_real_cop) values (1, 7000);
insert into public.triangulaciones (referencia, producto, precio_venta, costo_proveedor, compra_id, estado, origen_web, es_combo, created_at) values
 ('DC-1', 'Netflix', 15000, 8000, '1', 'ENTREGADO', false, false, now()),
 ('DC-2', 'Netflix', 15000, 8000, null, 'ESPERANDO_CREDENCIALES', false, false, now()),
 ('DC-3', 'Disney Plus', 12000, 6000, null, 'REVISION_MANUAL', true, false, now()),
 ('DC-4', 'Spotify', 9000, 5000, null, 'REVISION_MANUAL', false, false, now()),
 ('DC-5', 'Combo', 40000, 20000, null, 'ENTREGADO', false, true, now()),
 ('DC-6', 'Netflix', 15000, 8000, null, 'ENTREGADO', false, false, now() - interval '3 days');
insert into public.ordenes_web (codigo, estado, total_declarado, created_at) values
 ('W1', 'ESPERANDO_PAGO', 20000, now()), ('W2', 'COMPROBANTE_RECIBIDO', 10000, now()), ('W3', 'PAGADA', 50000, now()),
 ('W4', 'ESPERANDO_PAGO', 99000, now() - interval '2 days');`);

const r = (await q('select public.resumen_ventas_dia() as r'))[0].r;
ok(r.pedidos === 4, `pedidos de hoy sin el combo padre ni los de otros días: ${r.pedidos}`);
ok(r.pagados === 3, `pagados: entregado + esperando credenciales + web en revisión (el de chat en revisión no): ${r.pagados}`);
ok(r.entregados === 1, `entregados: ${r.entregados}`);
ok(Number(r.venta) === 42000, `venta de los pagados: ${r.venta}`);
ok(Number(r.costo) === 21000, `costo real de la compra si existe (7.000), si no el cotizado: ${r.costo}`);
ok(Number(r.margen) === 21000, `margen = venta − costo: ${r.margen}`);
ok(r.por_cobrar.cantidad === 2 && Number(r.por_cobrar.total) === 30000, 'por cobrar: órdenes web sin pagar de las últimas 24 h');
ok(r.top[0]?.producto === 'Netflix' && Number(r.top[0].cantidad) === 2 && r.top.length === 2, 'top: Netflix primero (2), solo productos pagados');
const ayer = (await q("select public.resumen_ventas_dia(((now() at time zone 'America/Bogota')::date - 3)) as r"))[0].r;
ok(ayer.pedidos === 1 && ayer.pagados === 1, 'con fecha: resume ese día');
const vacio = (await q("select public.resumen_ventas_dia('2020-01-01') as r"))[0].r;
ok(vacio.pedidos === 0 && Number(vacio.venta) === 0 && Array.isArray(vacio.top) && !vacio.top.length, 'día sin ventas → ceros y top vacío');

// Permisos: ni anon ni authenticated
for (const rol of ['anon', 'authenticated']) {
    let negado = false;
    try { await db.exec(`set role ${rol}; select public.resumen_ventas_dia();`); } catch { negado = true; }
    await db.exec('reset role');
    ok(negado, `${rol} no puede ejecutarla`);
}
let servidor = true;
try { await db.exec('set role service_role; select public.resumen_ventas_dia();'); } catch { servidor = false; }
await db.exec('reset role');
ok(servidor, 'el servidor (service_role) sí');
