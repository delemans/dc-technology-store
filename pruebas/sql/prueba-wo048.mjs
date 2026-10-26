// Integración de la Fase 3: cadena completa de SQL (wo-011 → wo-032) sobre PostgreSQL real (PGlite)
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

const r1 = await db.exec(sql('wo-048-horario-legal.sql')).then(() => true).catch((e) => e.message);
const r2 = await db.exec(sql('wo-048-horario-legal.sql')).then(() => true).catch((e) => e.message);
ok(r1 === true && r2 === true, 'wo-048 se aplica sobre la cadena real y se puede repetir (' + (r1 === true ? r2 : r1) + ')');
const def = (await uno("select pg_get_functiondef('public.tomar_notificaciones(integer)'::regprocedure) d")).d;
ok(def.includes('horario_comercial_legal') && !/between 9 and 19/.test(def), 'reseñas y renovaciones usan el horario legal (ya no 9 a 19 todos los días)');
ok(def.includes("n.tipo <> 'OTP'") || def.includes("'OTP'"), 'conserva el parche de wo-028 (códigos de acceso)');
ok(def.includes("'ADMIN_FALLA', 'RENOVACION', 'RASTREO'"), 'conserva wo-032 y agrega RENOVACION y RASTREO a los avisos que no dependen de una compra');
const h = async (t) => (await uno("select public.horario_comercial_legal($1::timestamptz) v", [t])).v;
ok(await h('2026-10-20 07:00-05') === true && await h('2026-10-20 06:59-05') === false && await h('2026-10-20 18:59-05') === true && await h('2026-10-20 19:00-05') === false, 'lunes a viernes: de 7:00 a. m. a 7:00 p. m.');
ok(await h('2026-10-24 08:00-05') === true && await h('2026-10-24 07:59-05') === false && await h('2026-10-24 14:59-05') === true && await h('2026-10-24 15:00-05') === false, 'sábado: de 8:00 a. m. a 3:00 p. m.');
ok(await h('2026-10-25 10:00-05') === false && await h('2026-11-02 10:00-05') === false && await h('2026-12-25 10:00-05') === false, 'domingos y festivos: nunca');
// Un aviso de renovación sin compra al proveedor ya no se cancela
await db.exec("alter table public.notificaciones_whatsapp drop constraint if exists notificaciones_whatsapp_tipo_check");
await db.exec("insert into public.notificaciones_whatsapp (clave, tipo, compra_id, destino, variables, prioridad) values ('RENUEVA:DC-AAAAA', 'RENOVACION', 'DC-AAAAA', '573001112233', '{}'::jsonb, 4), ('RASTREO:DC-AAAAA:en transito', 'RASTREO', 'DC-AAAAA', '573001112233', '{}'::jsonb, 3)");
await todas('select * from public.tomar_notificaciones(5)');
const est = await todas("select tipo, estado from public.notificaciones_whatsapp where compra_id = 'DC-AAAAA' order by tipo");
ok(est.every((x) => x.estado !== 'CANCELADO'), 'renovación y rastreo sin compra al proveedor ya no se cancelan (' + est.map((x) => x.tipo + ':' + x.estado).join(', ') + ')');
const rastreo = est.find((x) => x.tipo === 'RASTREO');
ok(rastreo.estado === 'EN_PROCESO', 'el rastreo (transaccional) sale a cualquier hora');
