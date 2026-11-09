// supabase/wo-056-libro-pqr.sql (T07) sobre la cadena real (wo-011 → wo-032 → wo-048), en PGlite
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

const sinFestivos = await db.exec(sql('wo-056-libro-pqr.sql')).then(() => true).catch((e) => e.message);
ok(/Nada se aplicó/.test(String(sinFestivos)), 'sin wo-048 se detiene con «Nada se aplicó…»');
await db.exec(sql('wo-048-horario-legal.sql'));
const r1 = await db.exec(sql('wo-056-libro-pqr.sql')).then(() => true).catch((e) => e.message);
const r2 = await db.exec(sql('wo-056-libro-pqr.sql')).then(() => true).catch((e) => e.message);
ok(r1 === true && r2 === true, 'wo-056 se aplica y se puede repetir (' + (r1 === true ? r2 : r1) + ')');
const vence = async (d, n) => (await uno('select public.dias_habiles_despues($1::date, $2) v', [d, n])).v.toISOString().slice(0, 10);
ok(await vence('2026-11-06', 15) === '2026-11-30', 'reclamo del viernes 6/11: 15 días hábiles sin el festivo del 16/11 → 30/11');
ok(await vence('2026-11-06', 10) === '2026-11-23', 'consulta del 6/11: 10 días hábiles → 23/11');
ok(await vence('2026-12-23', 3) === '2026-12-29', 'salta el 25/12 y el fin de semana');

// El bot registra (una sola vez aunque el cliente repita)
const reg = async (n, t, d) => uno('select * from public.registrar_pqr($1, $2, $3)', [n, t, d]);
const a = await reg('3001112233', 'datos', 'DATOS');
const b = await reg('573001112233', 'datos', 'borrar mis datos');
ok(a.id && a.id === b.id, 'el bot registra la PQR y no la duplica si el cliente repite (24 h)');
const q = await uno('select * from public.pqr where id = $1', [a.id]);
ok(q.whatsapp === '573001112233' && q.estado === 'ABIERTA' && q.canal === 'whatsapp', 'número con 57, abierta, canal WhatsApp');
const hoy = (await uno("select (now() at time zone 'America/Bogota')::date d")).d.toISOString().slice(0, 10);
ok(q.vence_el.toISOString().slice(0, 10) === await vence(hoy, 10), 'datos personales: vence en 10 días hábiles');
let malo = false;
try { await reg('123', 'datos', 'x'); } catch { malo = true; }
ok(malo, 'número inválido → error');

// Panel (solo administradores)
await db.exec(`create or replace function public.es_admin() returns boolean language sql as $$ select current_setting('prueba.admin', true) = 'si' $$`);
let negado = false;
try { await uno('select * from public.pqr_panel()'); } catch { negado = true; }
ok(negado, 'el libro solo lo ve un administrador');
await db.exec("set prueba.admin = 'si'");
const c = await uno("select * from public.crear_pqr('3009998877', 'reclamo', 'No me llegó el pedido DC-AAAAA', 'correo')");
ok(c.ok && c.id, 'crear_pqr desde el panel');
const malTipo = await uno("select * from public.crear_pqr('3009998877', 'queja rara', 'x')");
ok(malTipo.ok === false && /inválido/.test(malTipo.mensaje), 'tipo desconocido → mensaje claro');
await db.exec("update public.pqr set vence_el = current_date - 1 where id = " + c.id);
const lista = await todas('select * from public.pqr_panel()');
ok(lista.length === 2 && lista[0].id === c.id, 'lo que vence primero va arriba');
const sinTexto = await uno('select * from public.responder_pqr($1, $2, true)', [c.id, '']);
ok(sinTexto.ok === false, 'no se cierra sin respuesta');
const resp = await uno('select * from public.responder_pqr($1, $2, false)', [c.id, 'Te reenviamos la guía']);
const resp2 = await uno('select * from public.responder_pqr($1, $2, true)', [c.id, 'Te reenviamos la guía; ya llegó']);
const cerrada = await uno('select * from public.pqr where id = $1', [c.id]);
ok(resp.ok && resp2.ok && cerrada.estado === 'CERRADA' && cerrada.respondida_at && cerrada.cerrada_at && /ya llegó/.test(cerrada.respuesta), 'responder (guardar) y cerrar, con constancia de fechas');
ok((await uno('select * from public.responder_pqr($1, $2, true)', [c.id, 'otra'])).ok === false, 'una cerrada no se vuelve a responder');
ok((await todas('select * from public.pqr_panel()')).at(-1).id === c.id, 'las cerradas van al final');
await db.exec('reset prueba.admin');
for (const rol of ['anon', 'authenticated']) {
    let n = false;
    try { await db.exec(`set role ${rol}; select * from public.registrar_pqr('3001112233', 'datos', 'x');`); } catch { n = true; }
    await db.exec('reset role');
    let t = false;
    try { await db.exec(`set role ${rol}; select * from public.pqr;`); } catch { t = true; }
    await db.exec('reset role');
    ok(n && t, `${rol} no puede registrar por el bot ni leer la tabla`);
}
