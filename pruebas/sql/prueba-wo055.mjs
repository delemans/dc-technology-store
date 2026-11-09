// supabase/wo-055-origen-clientes.sql (T05) sobre la cadena real (wo-011 → wo-032), en PGlite
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';

const RAIZ = (process.argv[2] ?? new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ').replace(/\/$/, ''));
const db = new PGlite();
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const uno = async (q, p = []) => (await db.query(q, p)).rows[0];
const todas = async (q, p = []) => (await db.query(q, p)).rows;
const sql = (f) => fs.readFileSync(`${RAIZ}/supabase/${f}`, 'utf8');

await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, created_at timestamptz default now());
insert into auth.users (email) values ('dclancherosa@gmail.com');
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
create function auth.role() returns text language sql as $$ select 'authenticated' $$;
create type public.estado_compra as enum ('ESPERANDO_PROVEEDOR','RECIBIDA','FALLIDA','CANCELADA','PENDIENTE_PAGO','PEDIDO_REALIZADO','ENTREGADO_INMEDIATO','ENTREGADO');
create type public.metodo_pago as enum ('NEQUI','DAVIPLATA');
create type public.estado_pago as enum ('PENDIENTE','APROBADO','RECHAZADO');
create type public.estado_pedido as enum ('ESPERANDO_PAGO','EN_VALIDACION','PAGADO','PENDIENTE_COMPRA','ESPERANDO_PROVEEDOR','EN_REVISION','ENTREGADO','RECHAZADO','EXPIRADO','CANCELADO','REEMBOLSADO');
create table public.clientes (id uuid primary key default gen_random_uuid(), whatsapp text unique, nombre text, creado_at timestamptz default now());
create table public.productos (id uuid primary key default gen_random_uuid(), nombre text not null);
create table public.variantes (id uuid primary key default gen_random_uuid(), producto_id uuid references public.productos(id), nombre text not null);
create table public.proveedores (id uuid primary key default gen_random_uuid(), nombre text);
create table public.metodos_pago (id uuid primary key default gen_random_uuid(), banco_alias text, numero_cuenta text, titular text, activo boolean default true);
insert into public.metodos_pago (banco_alias, numero_cuenta, titular) values ('Nequi DC', '3001234567', 'DC Tech');
create table public.pedidos (
  id uuid primary key default gen_random_uuid(), codigo text not null unique,
  cliente_id uuid not null references public.clientes(id), variante_id uuid not null references public.variantes(id),
  cantidad integer not null default 1 check (cantidad = 1), precio_cop bigint not null check (precio_cop >= 0),
  monto_unico_offset bigint not null default 0, monto_a_pagar_cop bigint not null, metodo_pago public.metodo_pago not null,
  estado public.estado_pedido not null, canal text not null default 'WEB', creado_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), expira_at timestamptz, pagado_at timestamptz, entregado_at timestamptz);
create table public.compras_proveedor (
  id bigint generated always as identity primary key, pedido_id uuid references public.pedidos(id), proveedor_id uuid references public.proveedores(id),
  variante_id uuid references public.variantes(id), estado public.estado_compra not null default 'ESPERANDO_PROVEEDOR',
  clave_serial text, cliente_whatsapp text, referencia_externa text, costo_real_cop bigint, monto_cop numeric,
  comprado_at timestamptz, recibido_at timestamptz, entregado_at timestamptz, garantia_dias integer default 30,
  fecha_vencimiento timestamptz, satisfaccion_enviada_at timestamptz, pago_validado_at timestamptz,
  cupon_codigo text, cupon_enviado_at timestamptz, cupon_canjeado_at timestamptz);
create table public.pagos (id uuid primary key default gen_random_uuid(), pedido_id uuid, metodo public.metodo_pago, origen text, referencia text,
  monto_declarado_cop numeric, monto_verificado_cop numeric, estado public.estado_pago not null default 'PENDIENTE',
  revisado_por uuid, revisado_at timestamptz, alertas text[], comprobante_path text, created_at timestamptz default now());
create table public.resenas (id bigint generated always as identity primary key, producto_id text, cliente_nombre text, calificacion int, comentario text, verificado boolean default false, cupon_codigo text, created_at timestamptz default now());
insert into public.proveedores (nombre) values ('ALL NECESSARY COLOMBIA');
create schema storage;
create publication supabase_realtime;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz default now());
`);
// Catálogo de la base (variantes que vincular_triangulacion debe encontrar por nombre)
await db.exec(`
with p as (insert into public.productos (nombre) values ('Netflix Premium 4K') returning id) insert into public.variantes (producto_id, nombre) select id, 'Pantalla Colombia (1 Dispositivo)' from p;
with p as (insert into public.productos (nombre) values ('Disney Plus Premium') returning id) insert into public.variantes (producto_id, nombre) select id, 'Pantalla Premium' from p;
with p as (insert into public.productos (nombre) values ('Max (HBO)') returning id) insert into public.variantes (producto_id, nombre) select id, 'Pantalla 1 Mes' from p;`);

await db.exec("create function public.es_admin() returns boolean language sql as $$ select false $$");
const cadena = ['wo-011.sql', 'wo-012.sql', 'wo-014-pagos.sql', 'wo-015.sql', 'wo-027-metodos-pago.sql', 'wo-028-portal.sql', 'wo-029-combos.sql',
    'wo-030-comprobantes.sql', 'wo-024-triangulacion.sql', 'wo-026-triangulacion-panel.sql', 'wo-031-combos-proveedor.sql', 'wo-032-fase3.sql'];
for (const f of cadena) {
    const r = await db.exec(sql(f)).then(() => true).catch((e) => e.message);
    if (r !== true) { ok(false, `${f}: ${r}`); process.exit(1); }
}

// Sin wo-030 se detiene sin tocar nada (se prueba en una base vacía)
{
    const vacia = new PGlite();
    await vacia.exec('create role anon; create role authenticated; create role service_role;');
    const r = await vacia.exec(sql('wo-055-origen-clientes.sql')).then(() => true).catch((e) => e.message);
    ok(/Nada se aplicó/.test(String(r)), 'sin las órdenes web se detiene con «Nada se aplicó…»');
}
const r1 = await db.exec(sql('wo-055-origen-clientes.sql')).then(() => true).catch((e) => e.message);
const r2 = await db.exec(sql('wo-055-origen-clientes.sql')).then(() => true).catch((e) => e.message);
ok(r1 === true && r2 === true, 'wo-055 se aplica sobre la cadena real y se puede repetir (' + (r1 === true ? r2 : r1) + ')');

// Orden con su secreto (como la crea la tienda)
const orden = async (codigo, secreto, estado = 'ESPERANDO_PAGO', total = 45000, horas = 0) => db.query(
    `insert into public.ordenes_web (codigo, secreto_hash, whatsapp, items, total_declarado, metodo, estado, created_at)
     values ($1, public.hash_portal($2, 'orden'), '573001112233', '[]'::jsonb, $3, 'NEQUI', $4, now() - make_interval(hours => $5))`, [codigo, secreto, total, estado, horas]);
await orden('DC-AAAA1', 'secreto1');
const marcar = async (c, s, o) => (await uno('select public.marcar_origen_orden($1, $2, $3) v', [c, s, o])).v;
const origen = async (c) => (await uno('select origen from public.ordenes_web where codigo = $1', [c])).origen;
ok(await marcar('DC-AAAA1', 'otro', 'tiktok') === false && await origen('DC-AAAA1') === null, 'sin el secreto de la orden no cambia nada');
ok(await marcar('DC-AAAA1', 'secreto1', 'spam') === false, 'origen desconocido → no se guarda');
ok(await marcar('dc-aaaa1', 'secreto1', 'TikTok') === true && await origen('DC-AAAA1') === 'tiktok', 'con el secreto guarda el origen (sin importar mayúsculas)');
ok(await marcar('DC-AAAA1', 'secreto1', 'google') === false && await origen('DC-AAAA1') === 'tiktok', 'el primer origen se queda (no se pisa)');
await orden('DC-AAAA2', 'secreto2', 'ESPERANDO_PAGO', 10000, 3);
ok(await marcar('DC-AAAA2', 'secreto2', 'youtube') === false, 'una orden de hace más de 1 hora ya no se marca');
let negado = false;
try { await db.exec("insert into public.ordenes_web (codigo, secreto_hash, whatsapp, items, total_declarado, metodo, origen) values ('DC-AAAA9', 'x', '573001112233', '[]', 1, 'NEQUI', 'otra')"); } catch { negado = true; }
ok(negado, 'la columna solo acepta los orígenes conocidos');

// Ventas por origen
await db.exec("update public.ordenes_web set estado = 'VALIDADO', total_servidor = 45000 where codigo = 'DC-AAAA1'");
await orden('DC-AAAA3', 's3', 'VALIDADO', 20000);
await orden('DC-AAAA4', 's4', 'VALIDADO', 30000);
await marcar('DC-AAAA4', 's4', 'tiktok');
await orden('DC-AAAA5', 's5', 'RECHAZADO', 99000);
await marcar('DC-AAAA5', 's5', 'estado');
await db.exec(`create or replace function public.es_admin() returns boolean language sql as $$ select current_setting('prueba.admin', true) = 'si' $$`);
let soloAdmin = false;
try { await uno('select public.ventas_por_origen(null, null) v'); } catch { soloAdmin = true; }
ok(soloAdmin, 'ventas_por_origen: solo administradores');
await db.exec("set prueba.admin = 'si'");
const v = (await uno('select public.ventas_por_origen(null, null) v')).v;
const de = (o) => v.find((x) => x.origen === o) ?? {};
ok(Number(de('tiktok').ordenes) === 2 && Number(de('tiktok').pagadas) === 2 && Number(de('tiktok').cobrado) === 75000, `TikTok: 2 órdenes pagadas por $75.000 (${JSON.stringify(de('tiktok'))})`);
ok(Number(de('directo').ordenes) === 2 && Number(de('directo').cobrado) === 20000, 'sin origen = directo (solo cuenta lo validado)');
ok(Number(de('estado').pagadas) === 0 && Number(de('estado').cobrado) === 0, 'una orden rechazada no suma lo cobrado');
ok(v[0].origen === 'tiktok', 'ordenado por lo cobrado');
for (const rol of ['anon']) {
    let n = false;
    try { await db.exec(`set role ${rol}; select public.ventas_por_origen(null, null);`); } catch { n = true; }
    await db.exec('reset role');
    ok(n, `${rol} no puede leer las ventas por origen`);
}
