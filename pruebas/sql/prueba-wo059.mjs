// supabase/wo-059-precios-con-margen.sql: los planes de ANC quedan con margen y nada en pérdida con el cupón (PGlite)
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const RAIZ = (process.argv[2] ?? new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ').replace(/\/$/, ''));
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const db = new PGlite();
const sql = fs.readFileSync(`${RAIZ}/supabase/wo-059-precios-con-margen.sql`, 'utf8');
let error = null;
try { await db.exec(sql); } catch (e) { error = e.message; }
ok(/Nada se aplicó/.test(error ?? ''), 'sin catalogo_precios se detiene con «Nada se aplicó…»');
await db.exec(`create table public.catalogo_precios (producto_id text not null, variante text not null, producto text, tipo text, precio bigint not null, precio_anterior bigint,
    activo boolean not null default true, proveedor text, costo_proveedor bigint, costo_proveedor_at timestamptz, updated_at timestamptz not null default now(), primary key (producto_id, variante));
insert into public.catalogo_precios (producto_id, variante, precio, costo_proveedor) values ('netflix', 'Pantalla Colombia 30 días', 17000, 17000), ('prime-video', 'Pantalla (1 Dispositivo)', 10000, 10000),
    ('servicio-mantenimiento-computadores', 'Preventivo Software + Limpieza', 60000, null);
create table public.reglas_combo (min_plataformas smallint primary key, descuento_pct numeric(5, 2) not null, activa boolean not null default true, updated_at timestamptz not null default now());
insert into public.reglas_combo (min_plataformas, descuento_pct) values (2, 10), (3, 15);
create table public.cupones (codigo text primary key, porcentaje integer not null check (porcentaje between 1 and 90));
insert into public.cupones values ('DCTECH2026', 10), ('VIEJO', 30);`);
for (const vez of [1, 2]) { try { await db.exec(sql); } catch (e) { console.log(`ERROR (vez ${vez}):`, e.message); process.exit(1); } }
ok(true, 'wo-059 se aplica dos veces sin error');
const uno = async (q) => (await db.query(q)).rows[0];
ok(Number((await uno("select precio from public.catalogo_precios where producto_id = 'netflix'")).precio) > 17000, 'Netflix ya no se vende a costo');
ok(Number((await uno("select count(*) n from public.catalogo_precios where costo_proveedor is not null and round(precio * 0.9) <= costo_proveedor")).n) === 0, 'ningún plan en pérdida con el cupón del 10 %');
ok(Number((await uno("select precio from public.catalogo_precios where producto_id = 'servicio-mantenimiento-computadores'")).precio) === 60000, 'los servicios propios no se tocan');
ok(Number((await uno('select descuento_pct d from public.reglas_combo where min_plataformas = 2')).d) === 5 && Number((await uno('select descuento_pct d from public.reglas_combo where min_plataformas = 3')).d) === 10, 'combos: 5 % (2 plataformas) y 10 % (3 o más)');
ok(Number((await uno("select porcentaje p from public.cupones where codigo = 'VIEJO'")).p) === 10 && Number((await uno("select porcentaje p from public.cupones where codigo = 'DCTECH2026'")).p) === 10, 'ningún cupón pasa del 10 %');
let tope = null; try { await db.exec('update public.reglas_combo set descuento_pct = 20 where min_plataformas = 3'); } catch (e) { tope = e.message; }
ok(/tope_margen/.test(tope ?? ''), 'la base no deja crear un descuento que haga perder (ni desde el panel)');
