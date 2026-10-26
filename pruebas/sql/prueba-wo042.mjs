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
ok(true, 'se aplica dos veces sin error (idempotente)');
let r = await db.query(`select * from public.triangulaciones_abiertas()`);
ok(r.rows.length === 1 && r.rows[0].cliente === '573001112233' && r.rows[0].producto === 'Netflix Premium 4K' && r.rows[0].origen_web === false, 'pedidos abiertos con cliente y producto (los cerrados no salen)');
r = await uno(`select * from public.resolver_orden_web_bot('dc-web01', true, null)`);
ok(r.ok && r.existe && r.cliente === '573009998877' && /despachada/.test(r.mensaje), `#ok de un pago web → validado y despachado («${r.mensaje}»)`);
ok((await uno(`select estado from public.ordenes_web where codigo = 'DC-WEB01'`)).estado === 'VALIDADO' && (await uno(`select usos from public.cupones`)).usos === 1, 'orden VALIDADO y el cupón cuenta un uso');
r = await uno(`select * from public.resolver_orden_web_bot('DC-WEB02', false, null)`);
ok(!r.ok && r.existe && /validado/.test(r.mensaje), 'una orden ya validada no se puede volver a resolver');
r = await uno(`select * from public.resolver_orden_web_bot('DC-NOEXI', true, null)`);
ok(!r.ok && !r.existe && r.mensaje === 'NO_EXISTE', 'código que no es web → NO_EXISTE (el bot prueba con los pedidos por chat)');
await db.exec(`update public.ordenes_web set estado = 'COMPROBANTE_RECIBIDO' where codigo = 'DC-WEB02'`);
r = await uno(`select * from public.resolver_orden_web_bot('DC-WEB02', false, null)`);
ok(r.ok && (await uno(`select nota_admin from public.ordenes_web where codigo = 'DC-WEB02'`)).nota_admin.includes('no corresponde'), '#no sin motivo → rechazo con motivo por defecto (el cliente lo ve)');
r = await uno(`select * from public.entregar_manual('DC-AAAAA', 'PEDIDO_REALIZADO', null)`);
ok(r.ok && (await uno(`select estado, esperando from public.triangulaciones where referencia = 'DC-AAAAA'`)).estado === 'ESPERANDO_CREDENCIALES', 'pago confirmado → esperando los accesos de ANC');
r = await uno(`select * from public.entregar_manual('DC-AAAAA', 'ENTREGADO', 'ana@mail.com / 1234')`);
const t = await uno(`select estado, esperando from public.triangulaciones where referencia = 'DC-AAAAA'`);
ok(r.ok && t.estado === 'ENTREGADO' && t.esperando === null, 'entrega manual → ENTREGADO (garantía activa)');
ok((await db.query(`select que from public.registro where que like 'DC-AAAAA%'`)).rows.map((x) => x.que).join('|') === 'DC-AAAAA:PEDIDO_REALIZADO:|DC-AAAAA:ENTREGADO:ana@mail.com / 1234', 'avanza la compra del panel en cada paso');
r = await uno(`select * from public.entregar_manual('DC-AAAAA', 'ENTREGADO', 'x')`);
ok(!r.ok, 'no se entrega dos veces');
r = await uno(`select * from public.sincronizar_precios_anc('[{"producto_id":"netflix","variante":"Pantalla Colombia 26 días","precio":16000,"costo":16000,"plan":"Netflix · Pantalla"},{"producto_id":"prime-video","variante":"Pantalla (1 Dispositivo)","precio":10000,"costo":10000,"plan":"Prime · Pantalla"},{"producto_id":"hbo-max","variante":"Pantalla Estándar 1 Mes","precio":30000,"costo":30000,"plan":"Max"},{"producto_id":"er-x","variante":"Unidad","precio":9000,"costo":9000,"plan":"x"},{"producto_id":"no-existe","variante":"x","precio":5000}]'::jsonb)`);
ok(r.actualizados === 1 && r.sin_cambio === 1 && r.omitidos === 3, `precios ANC: ${JSON.stringify({ a: r.actualizados, i: r.sin_cambio, o: r.omitidos })}`);
ok((await uno(`select precio::int p, costo_proveedor::int c from public.catalogo_precios where producto_id = 'netflix'`)).p === 16000, 'Netflix sube a $16.000 como en ANC');
ok((await uno(`select precio::int p from public.catalogo_precios where producto_id = 'hbo-max'`)).p === 8000, 'salto sospechoso (+275 %) no se aplica, se reporta');
ok((await uno(`select precio::int p from public.catalogo_precios where producto_id = 'er-x'`)).p === 5000, 'no toca productos de Emprende Red');
let error = '';
await db.exec('set role anon'); try { await db.query(`select * from public.resolver_orden_web_bot('DC-WEB01', true, null)`); } catch (e) { error = e.message; } await db.exec('reset role');
ok(/permission denied/.test(error), 'anon no puede aprobar pagos (solo n8n con la credencial de servidor)');
await db.exec('set role authenticated'); error = ''; try { await db.query(`select * from public.entregar_manual('DC-AAAAA', 'ENTREGADO', null)`); } catch (e) { error = e.message; } await db.exec('reset role');
ok(/permission denied/.test(error), 'un usuario de la web tampoco puede marcar entregas');
