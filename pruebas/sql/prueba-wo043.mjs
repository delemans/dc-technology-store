// supabase/wo-042-pedidos-whatsapp.sql sobre un esquema mínimo con las columnas y restricciones reales
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const RAIZ = (process.argv[2] ?? new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ').replace(/\/$/, ''));
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const db = new PGlite();
const uno = async (sql) => (await db.query(sql)).rows[0];
await db.exec(`create role anon; create role authenticated; create role service_role;
create table public.triangulaciones (id bigint generated always as identity primary key, referencia text not null unique check (referencia ~ '^DC-[A-Z0-9]{4,8}$'),
  cliente text not null check (cliente ~ '^\\d{11,15}$'), cliente_nombre text, producto text not null, variante text, precio_venta numeric(12,2), costo_proveedor numeric(12,2),
  estado text not null default 'COTIZANDO' check (estado in ('COTIZANDO','ESPERANDO_PAGO_ADMIN','ESPERANDO_CREDENCIALES','REVISION_MANUAL','ENTREGADO','CANCELADO','VENCIDO','AGOTADO')),
  esperando text check (esperando in ('COTIZACION','PAGO_ADMIN','CREDENCIALES','APROBACION')), resume_url text, wamid_cotizacion text, wamid_pago text,
  credencial_final text, confianza numeric(3,2), notas text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  pedido_id uuid, compra_id text, vinculo_error text, grupo text, es_combo boolean not null default false, pago_pausado boolean not null default false, lineas jsonb,
  origen_web boolean not null default false, iniciada_at timestamptz);
create table public.compras_proveedor (id text primary key, estado text);
create table public.cupones (codigo text primary key, usos int not null default 0);
create table public.ordenes_web (id bigint generated always as identity primary key, codigo text not null unique, secreto_hash text not null default 'x', whatsapp text not null,
  nombre text, items jsonb not null default '[]', total_declarado bigint not null, metodo text not null default 'NEQUI', red text, cupon text,
  estado text not null default 'ESPERANDO_PAGO' check (estado in ('ESPERANDO_PAGO','COMPROBANTE_RECIBIDO','VALIDADO','RECHAZADO','VENCIDO')),
  nota_admin text, revisado_por uuid, revisado_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.catalogo_precios (producto_id text not null, variante text not null, producto text not null, tipo text not null, precio bigint not null, precio_anterior bigint,
  activo boolean not null default true, updated_at timestamptz not null default now(), costo_proveedor bigint, plan_proveedor text, costo_proveedor_at timestamptz, proveedor text, stock_proveedor integer,
  primary key (producto_id, variante));
create table public.registro (que text);
create function public.avanzar_compra_triangulada(p_ref text, p_estado text, p_costo numeric, p_clave text) returns void language sql as $$ insert into public.registro values (p_ref || ':' || p_estado || ':' || coalesce(p_clave, '')); $$;
create function public.despachar_orden_web(p_codigo text) returns text language sql as $$ insert into public.registro values ('despacho:' || p_codigo); select 'Orden despachada.'::text; $$;
insert into public.triangulaciones (referencia, cliente, cliente_nombre, producto, variante, precio_venta, estado, compra_id) values
  ('DC-AAAAA', '573001112233', 'Ana', 'Netflix Premium 4K', 'Pantalla Colombia 26 días', 15000, 'REVISION_MANUAL', '1'),
  ('DC-CERRA', '573001112233', 'Ana', 'Max (HBO)', 'Pantalla', 8000, 'ENTREGADO', '2');
insert into public.ordenes_web (codigo, whatsapp, total_declarado, estado, cupon) values ('DC-WEB01', '573009998877', 25000, 'COMPROBANTE_RECIBIDO', 'DCTECH2026'), ('DC-WEB02', '573009998877', 10000, 'VALIDADO', null);
insert into public.cupones values ('DCTECH2026', 0);
insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio) values ('netflix', 'Pantalla Colombia 26 días', 'Netflix', 'streaming', 15000), ('prime-video', 'Pantalla (1 Dispositivo)', 'Prime', 'streaming', 10000), ('hbo-max', 'Pantalla Estándar 1 Mes', 'Max', 'streaming', 8000);
insert into public.catalogo_precios (producto_id, variante, producto, tipo, precio, proveedor) values ('er-x', 'Unidad', 'X', 'tecnologia', 5000, 'emprendered');`);
const sql = fs.readFileSync(`${RAIZ}/supabase/wo-042-pedidos-whatsapp.sql`, 'utf8');
for (const vez of [1, 2]) { try { await db.exec(sql); } catch (e) { console.log(`ERROR SQL (ejecución ${vez}):`, e.message, e.where ?? ''); process.exit(1); } }
const sql43 = fs.readFileSync(`${RAIZ}/supabase/wo-043-stock-pines.sql`, 'utf8');
for (const vez of [1, 2]) { try { await db.exec(sql43); } catch (e) { console.log(`ERROR SQL 043 (ejecución ${vez}):`, e.message, e.where ?? ''); process.exit(1); } }
ok(true, 'wo-043 se aplica dos veces sin error (idempotente)');
await db.exec(`insert into public.triangulaciones (referencia, cliente, producto, variante, precio_venta, estado, compra_id) values
  ('DC-PIN01', '573001112233', 'PIN Virtual Roblox', 'PIN de $25.000', 25000, 'REVISION_MANUAL', '3'),
  ('DC-PIN02', '573001112244', 'PIN Virtual Roblox', 'PIN de $25.000', 25000, 'REVISION_MANUAL', '4'),
  ('DC-PIN03', '573001112255', 'PIN Virtual Roblox', 'PIN de $25.000', 25000, 'REVISION_MANUAL', '5')`);
let c = await uno(`select * from public.cargar_stock('pin-virtual-roblox', 'PIN de $25.000', array['RBX-AAAA-1111', ' RBX-BBBB-2222 ', 'RBX-AAAA-1111', 'x'], 24000, 'ANC')`);
ok(c.cargados === 2 && c.repetidos === 1 && c.disponibles === 2, `carga: 2 nuevos, 1 repetido ignorado, el muy corto descartado (${JSON.stringify(c)})`);
let e = await uno(`select * from public.entregar_desde_stock('dc-pin01', 'pin-virtual-roblox', 'PIN de $25.000')`);
ok(e.ok === true && e.codigo === 'RBX-AAAA-1111' && e.quedan === 1, 'entrega el primer código disponible y dice cuántos quedan');
let reg = (await db.query(`select que from public.registro where que like 'DC-PIN01%'`)).rows.map((x) => x.que);
ok(reg.includes('DC-PIN01:ENTREGADO:PIN RBX-AAAA-1111'), 'el pedido queda ENTREGADO con el PIN (garantía y "Mis pedidos")');
ok((await uno(`select estado from public.triangulaciones where referencia = 'DC-PIN01'`)).estado === 'ENTREGADO', 'la triangulación queda ENTREGADO');
e = await uno(`select * from public.entregar_desde_stock('DC-PIN01', 'pin-virtual-roblox', 'PIN de $25.000')`);
ok(e.ok === true && e.codigo === 'RBX-AAAA-1111' && e.quedan === 1, 'reintento del mismo pedido → el mismo código, no gasta otro');
e = await uno(`select * from public.entregar_desde_stock('DC-PIN02', 'pin-virtual-roblox', 'PIN de $25.000')`);
ok(e.ok === true && e.codigo === 'RBX-BBBB-2222' && e.quedan === 0, 'segundo pedido → el otro código (nunca el mismo)');
e = await uno(`select * from public.entregar_desde_stock('DC-PIN03', 'pin-virtual-roblox', 'PIN de $25.000')`);
ok(e.ok === false && e.mensaje === 'SIN_STOCK', 'sin stock → avisa SIN_STOCK');
ok((await uno(`select estado from public.triangulaciones where referencia = 'DC-PIN03'`)).estado === 'ESPERANDO_CREDENCIALES', '…y el pago queda confirmado para comprarlo a mano');
e = await uno(`select * from public.entregar_desde_stock('DC-NOEXI', 'pin-virtual-roblox', 'PIN de $25.000')`);
ok(e.ok === false && /no existe/.test(e.mensaje), 'pedido inexistente → no toca el stock');
const res = (await db.query(`select * from public.stock_resumen()`)).rows;
ok(res.length === 1 && res[0].disponibles === 0 && res[0].entregados_30d === 2, 'resumen: disponibles y entregados del mes');
await uno(`select * from public.cargar_stock('pin-google-play', 'PIN de $10.000', array['GP-123456789'])`);
const pub = (await db.query(`select * from public.stock_publico()`)).rows;
ok(pub.length === 1 && pub[0].producto_id === 'pin-google-play' && !('codigo' in pub[0]), 'público: solo qué tiene stock, nunca el código');
await db.exec(`set role anon`);
let bloqueado = false; try { await db.query(`select * from public.stock_codigos`); } catch { bloqueado = true; }
ok(bloqueado, 'anon no puede leer stock_codigos');
bloqueado = false; try { await db.query(`select * from public.entregar_desde_stock('DC-PIN03', 'x', 'y')`); } catch { bloqueado = true; }
ok(bloqueado, 'anon no puede usar entregar_desde_stock');
let pubAnon = true; try { await db.query(`select * from public.stock_publico()`); } catch { pubAnon = false; }
ok(pubAnon, 'anon sí puede ver stock_publico (solo disponibilidad)');
await db.exec(`reset role`);
