// supabase/wo-057-gastos-fijos.sql (T08): gastos fijos, solo administradores (PGlite)
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const RAIZ = (process.argv[2] ?? new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ').replace(/\/$/, ''));
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const db = new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role;');
const uno = async (q, p = []) => (await db.query(q, p)).rows[0];
const sql = fs.readFileSync(`${RAIZ}/supabase/wo-057-gastos-fijos.sql`, 'utf8');
let error = null;
try { await db.exec(sql); } catch (e) { error = e.message; }
ok(/Nada se aplicó/.test(error ?? ''), 'sin es_admin() se detiene con «Nada se aplicó…»');
await db.exec(`create function public.es_admin() returns boolean language sql as $$ select current_setting('prueba.admin', true) = 'si' $$`);
for (const vez of [1, 2]) { try { await db.exec(sql); } catch (e) { console.log(`ERROR (vez ${vez}):`, e.message); process.exit(1); } }
ok(true, 'wo-057 se aplica dos veces sin error');
let negado = false;
try { await uno("select * from public.guardar_gasto_fijo(null, 'Internet', 90000)"); } catch { negado = true; }
ok(negado, 'sin ser administrador no se guarda');
await db.exec("set prueba.admin = 'si'");
const a = await uno("select * from public.guardar_gasto_fijo(null, ' Internet ', 90000)");
const b = await uno("select * from public.guardar_gasto_fijo(null, 'Contador', 250000)");
ok(a.ok && b.ok && a.id && b.id, 'agrega gastos');
ok((await uno("select * from public.guardar_gasto_fijo(null, 'x', 1000)")).ok === false, 'nombre muy corto → mensaje');
ok((await uno("select * from public.guardar_gasto_fijo(null, 'Arriendo', -5)")).ok === false, 'valor negativo → mensaje');
const e = await uno('select * from public.guardar_gasto_fijo($1, $2, $3, false)', [a.id, 'Internet fibra', 95000]);
ok(e.ok, 'edita y pausa un gasto');
ok((await uno('select * from public.guardar_gasto_fijo(999, $1, 1)', ['Nada'])).ok === false, 'id inexistente → mensaje');
const lista = (await db.query('select * from public.gastos_fijos_panel()')).rows;
ok(lista.length === 2 && lista[0].nombre === 'Contador' && lista[1].nombre === 'Internet fibra' && lista[1].activo === false && Number(lista[1].valor_mensual) === 95000, 'lista: activos primero, nombre limpio');
await db.exec('reset prueba.admin');
for (const rol of ['anon', 'authenticated']) {
    let n = false;
    try { await db.exec(`set role ${rol}; select * from public.gastos_fijos;`); } catch { n = true; }
    await db.exec('reset role');
    ok(n, `${rol} no lee la tabla directo`);
}
