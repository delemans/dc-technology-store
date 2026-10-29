// supabase/wo-053-pagos-por-revisar.sql: comprobantes sin validar (> 30 min) y pedidos sin pago (> 24 h)
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const RAIZ = (process.argv[2] ?? new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ').replace(/\/$/, ''));
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role;');
const q = async (s) => (await db.query(s)).rows;
const sql = fs.readFileSync(`${RAIZ}/supabase/wo-053-pagos-por-revisar.sql`, 'utf8');

let error = null;
try { await db.exec(sql); } catch (e) { error = e.message; }
ok(/Nada se aplicó/.test(error ?? ''), 'sin wo-030 ni wo-026 se detiene con «Nada se aplicó…»');

await db.exec(`create table public.ordenes_web (codigo text primary key, estado text, total_declarado bigint, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.triangulaciones (referencia text primary key, estado text, precio_venta bigint, origen_web boolean default false, es_combo boolean default false, grupo text, created_at timestamptz default now());`);
for (const vez of [1, 2]) { try { await db.exec(sql); } catch (e) { console.log(`ERROR 053 (vez ${vez}):`, e.message); process.exit(1); } }
ok(true, 'wo-053 se aplica dos veces sin error');

await db.exec(`insert into public.ordenes_web (codigo, estado, total_declarado, created_at, updated_at) values
 ('DC-AAAA1', 'COMPROBANTE_RECIBIDO', 45000, now() - interval '2 hours', now() - interval '45 minutes'),
 ('DC-AAAA2', 'COMPROBANTE_RECIBIDO', 20000, now() - interval '1 hour', now() - interval '10 minutes'),
 ('DC-AAAA3', 'VALIDADO', 30000, now() - interval '3 hours', now() - interval '2 hours'),
 ('DC-AAAA4', 'ESPERANDO_PAGO', 15000, now() - interval '30 hours', now() - interval '30 hours'),
 ('DC-AAAA5', 'ESPERANDO_PAGO', 15000, now() - interval '5 hours', now() - interval '5 hours'),
 ('DC-AAAA6', 'ESPERANDO_PAGO', 15000, now() - interval '80 hours', now() - interval '80 hours');
insert into public.triangulaciones (referencia, estado, precio_venta, origen_web, es_combo, grupo, created_at) values
 ('DC-BBBB1', 'REVISION_MANUAL', 18000, false, false, null, now() - interval '26 hours'),
 ('DC-BBBB2', 'REVISION_MANUAL', 18000, true, false, null, now() - interval '26 hours'),
 ('DC-BBBB3', 'ENTREGADO', 18000, false, false, null, now() - interval '26 hours'),
 ('DC-BBBB4', 'REVISION_MANUAL', 50000, false, true, null, now() - interval '30 hours'),
 ('DC-BBBB5', 'REVISION_MANUAL', 25000, false, false, 'DC-BBBB4', now() - interval '30 hours');`);
const r = (await q('select public.pagos_por_revisar() as r'))[0].r;
const refs = (l) => l.map((x) => x.referencia).join(',');
ok(refs(r.comprobantes) === 'DC-AAAA1' && Number(r.comprobantes[0].total) === 45000, `comprobante sin validar hace más de 30 min (no el de 10 min ni el validado): ${refs(r.comprobantes)}`);
ok(refs(r.sin_pago).split(',').sort().join(',') === 'DC-AAAA4,DC-BBBB1,DC-BBBB4', `sin pago > 24 h: web antes de vencer y chat (el combo una vez, sin sus partes): ${refs(r.sin_pago)}`);
ok(r.sin_pago.find((x) => x.referencia === 'DC-AAAA4')?.canal === 'web' && r.sin_pago.find((x) => x.referencia === 'DC-BBBB1')?.canal === 'whatsapp', 'dice el canal de cada pedido');
await db.exec('delete from public.ordenes_web; delete from public.triangulaciones;');
const vacio = (await q('select public.pagos_por_revisar() as r'))[0].r;
ok(Array.isArray(vacio.comprobantes) && !vacio.comprobantes.length && Array.isArray(vacio.sin_pago) && !vacio.sin_pago.length, 'sin pendientes → listas vacías');

for (const rol of ['anon', 'authenticated']) {
    let negado = false;
    try { await db.exec(`set role ${rol}; select public.pagos_por_revisar();`); } catch { negado = true; }
    await db.exec('reset role');
    ok(negado, `${rol} no puede ejecutarla`);
}
let servidor = true;
try { await db.exec('set role service_role; select public.pagos_por_revisar();'); } catch { servidor = false; }
await db.exec('reset role');
ok(servidor, 'el servidor (service_role) sí');
