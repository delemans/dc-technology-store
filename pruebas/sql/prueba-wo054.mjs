// supabase/wo-054-recordatorio-pago.sql (T03) sobre la cadena real (wo-011 → wo-032 → wo-048), en PGlite
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

// Sin wo-048 se detiene sin tocar nada
const sinLegal = await db.exec(sql('wo-054-recordatorio-pago.sql')).then(() => true).catch((e) => e.message);
ok(/Nada se aplicó/.test(String(sinLegal)), 'sin wo-048 se detiene con «Nada se aplicó…»');

await db.exec(sql('wo-048-horario-legal.sql'));
const r1 = await db.exec(sql('wo-054-recordatorio-pago.sql')).then(() => true).catch((e) => e.message);
const r2 = await db.exec(sql('wo-054-recordatorio-pago.sql')).then(() => true).catch((e) => e.message);
ok(r1 === true && r2 === true, 'wo-054 se aplica sobre la cadena real y se puede repetir (' + (r1 === true ? r2 : r1) + ')');
const def = (await uno("select pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure) d")).d;
ok(def.includes("'RENOVACION', 'RECORDATORIO_PAGO') or public.horario_comercial_legal()"), 'la cola solo lo envía en horario legal');
ok(def.includes("'ADMIN_FALLA', 'RENOVACION', 'RASTREO', 'RECORDATORIO_PAGO'"), 'conserva wo-032/wo-048 y no lo cancela por no tener compra al proveedor');
ok((def.match(/RECORDATORIO_PAGO/g) ?? []).length === 2, 'aplicarlo dos veces no duplica el parche');

// Órdenes de prueba (la hora real del servidor puede caer fuera del horario: se fija con un horario de prueba)
await db.exec(`insert into public.whatsapp_bajas (destino) values ('573009998877') on conflict do nothing`).catch(() => {});
const orden = (codigo, numero, min, estado = 'ESPERANDO_PAGO') => db.query(
    `insert into public.ordenes_web (codigo, secreto_hash, whatsapp, items, total_declarado, metodo, estado, created_at)
     values ($1, 'x', $2, '[]'::jsonb, 45000, 'NEQUI', $3, now() - make_interval(mins => $4))`, [codigo, numero, estado, min]);
const cols = (await todas("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'ordenes_web'")).map((x) => x.column_name);
if (!cols.includes('secreto_hash')) { ok(false, 'ordenes_web sin secreto_hash: revisa la prueba'); process.exit(1); }
await orden('DC-AAAA1', '573001112233', 90);          // 1 h 30 → sí
await orden('DC-AAAA2', '573001112234', 30);          // 30 min → aún no
await orden('DC-AAAA3', '573001112235', 240);         // 4 h → ya pasó la ventana
await orden('DC-AAAA4', '573001112236', 90, 'COMPROBANTE_RECIBIDO'); // ya mandó comprobante
await orden('DC-AAAA5', '573009998877', 90);          // pidió la baja

// Fuera del horario legal no encola nada
await db.exec(`create or replace function public.horario_comercial_legal(p_momento timestamptz default now()) returns boolean language sql as $$ select false $$`);
ok((await uno('select public.encolar_recordatorios_pago() n')).n === 0, 'fuera del horario legal (domingo, festivo, noche) no encola');
await db.exec(`create or replace function public.horario_comercial_legal(p_momento timestamptz default now()) returns boolean language sql as $$ select true $$`);
const n1 = (await uno('select public.encolar_recordatorios_pago() n')).n;
const cola = await todas("select clave, tipo, destino, variables, prioridad from public.notificaciones_whatsapp where tipo = 'RECORDATORIO_PAGO'");
ok(n1 === 1 && cola.length === 1 && cola[0].clave === 'RECUERDA:DC-AAAA1', `solo la orden de 60–180 min sin comprobante y sin baja (${cola.map((x) => x.clave).join(',')})`);
ok(cola[0]?.variables.codigo === 'DC-AAAA1' && cola[0]?.variables.total === '45.000', 'variables: código y total con formato de pesos');
ok((await uno('select public.encolar_recordatorios_pago() n')).n === 0, 'una sola vez por orden');

// La cola lo entrega (no lo cancela por no tener compra al proveedor)
await todas('select * from public.tomar_notificaciones(5)');
ok((await uno("select estado from public.notificaciones_whatsapp where clave = 'RECUERDA:DC-AAAA1'")).estado === 'EN_PROCESO', 'la cola lo toma para enviarlo');

// Si paga antes de que salga, se cancela
await db.exec("update public.ordenes_web set created_at = now() - interval '70 minutes' where codigo = 'DC-AAAA2'");
await uno('select public.encolar_recordatorios_pago() n');
await db.exec("update public.ordenes_web set estado = 'COMPROBANTE_RECIBIDO' where codigo = 'DC-AAAA2'");
ok((await uno("select estado from public.notificaciones_whatsapp where clave = 'RECUERDA:DC-AAAA2'")).estado === 'CANCELADO', 'si llega el comprobante antes de enviarlo, el recordatorio se cancela');

for (const rol of ['anon', 'authenticated']) {
    let negado = false;
    try { await db.exec(`set role ${rol}; select public.encolar_recordatorios_pago();`); } catch { negado = true; }
    await db.exec('reset role');
    ok(negado, `${rol} no puede ejecutarla`);
}
