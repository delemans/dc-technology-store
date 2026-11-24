// herramientas/plan-financiero.mjs — Plan financiero y comercial de diciembre (pedido del director el 24/11/2026).
// Con datos REALES: costo de ANC leído hoy, precio con margen (recalcular-precios-anc.mjs → precios-con-margen.json),
// reglas de promoción vigentes en la base (cupón y combos). Sin proyecciones de ventas inventadas: muestra cuánto deja
// cada venta y cuántas ventas hacen falta para cada meta (es aritmética, no un pronóstico).
//   node herramientas/plan-financiero.mjs → Escritorio «Anuncios DC Tecnology/Diciembre 2026/PLAN FINANCIERO DICIEMBRE 2026.html»
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGLA } from './precios-margen.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(process.env.USERPROFILE ?? 'C:/Users/dise12', 'Desktop', 'Anuncios DC Tecnology', 'Diciembre 2026', 'PLAN FINANCIERO DICIEMBRE 2026.html');
const d = JSON.parse(fs.readFileSync(path.join(RAIZ, 'herramientas', 'salida', 'precios-con-margen.json'), 'utf8'));
const cop = (v) => `$${Math.round(v).toLocaleString('es-CO')}`;
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const NOM = { tecnologia: 'Tecnología', streaming: 'Plataformas', pines: 'Pines', licencias: 'Licencias' };
const grupos = Object.entries(d.filas.reduce((g, f) => ((g[f.tipo] ??= []).push(f), g), {}));
const prom = (l, k) => l.reduce((s, f) => s + k(f), 0) / l.length;
const metas = [500000, 1000000, 2000000, 3000000];
const resumen = grupos.map(([t, l]) => ({ t, n: l.length, margen: prom(l, (f) => f.m.sin), margenCupon: prom(l, (f) => f.m.con), precio: prom(l, (f) => f.nuevo) }));
const todo = { margen: prom(d.filas, (f) => f.m.sin) };

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plan financiero · Diciembre 2026</title>
<style>body{margin:0;background:#0B0F1E;color:#EEF1F8;font:15px/1.55 Inter,system-ui,sans-serif}main{max-width:980px;margin:0 auto;padding:20px 16px 60px}
h1{font:900 28px/1.1 system-ui;margin:6px 0}h1 em{color:#E03445;font-style:normal}h2{margin:32px 0 10px;font-size:19px;color:#FF6B7F}
.t{background:#141A2E;border:1px solid #232B45;border-radius:16px;padding:14px 16px;margin:10px 0}.alerta{border-color:#C8102E;box-shadow:0 0 0 1px #C8102E}
.k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.k div{background:#141A2E;border:1px solid #232B45;border-radius:14px;padding:12px}.k b{display:block;font-size:22px;color:#fff}.k span{color:#9AA6C4;font-size:12px}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:7px 6px;border-bottom:1px solid #232B45;text-align:right}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2){text-align:left}th{color:#9AA6C4;font-weight:600}
.tabla{overflow-x:auto}ul{padding-left:20px}li{margin:5px 0}small{color:#9AA6C4}</style></head><body><main>
<p style="color:#9AA6C4;margin:0">DC Tecnology · Plan financiero y comercial</p><h1>Diciembre <em>2026</em></h1>
<div class="t alerta"><b>Diagnóstico (24/11/2026):</b> los productos de ANC se vendían al MISMO precio que cuesta comprarlos en ANC (n8n tenía <code>anc_margen = 0</code>): <b>margen $0</b> en cada venta y, con el cupón de primera compra (10 %), <b>pérdida</b>. Ya quedó corregido en n8n, en el catálogo y en el SQL wo-059 (falta aplicarlo en Supabase).</div>
<h2>La regla de precios (siempre guarda tu margen)</h2>
<div class="t"><ul><li>Precio de venta = el mayor entre <b>costo × 1,12 ÷ 0,9</b> y <b>(costo + ${cop(REGLA.minimo)}) ÷ 0,9</b>, redondeado a $1.000 ($5.000 desde $100.000).</li>
<li>Con el descuento más alto permitido (${REGLA.descuentoMax} %) te queda como mínimo <b>${REGLA.margen} % y ${cop(REGLA.minimo)}</b> por venta; sin descuento, en promedio <b>${cop(todo.margen)}</b> por venta.</li>
<li>Costo = precio de ANC leído hoy (${new Date(d.leido).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}). Si ANC cambia un precio, n8n recalcula solo cada 6 h con la misma regla (nunca baja del margen).</li></ul></div>
<h2>Cuánto deja cada venta</h2>
<div class="k">${resumen.map((r) => `<div><span>${NOM[r.t] ?? r.t} · ${r.n} planes</span><b>${cop(r.margen)}</b><span>de ganancia promedio por venta · con cupón ${cop(r.margenCupon)}</span></div>`).join('')}</div>
<div class="tabla t"><table><tr><th>Producto</th><th>Plan</th><th>Costo ANC</th><th>Precio</th><th>Ganancia</th><th>Con cupón 10 %</th></tr>
${d.filas.map((f) => `<tr><td>${esc(f.nombre)}</td><td>${esc(f.variante)}</td><td>${cop(f.costo)}</td><td><b>${cop(f.nuevo)}</b></td><td>${cop(f.m.sin)}</td><td>${cop(f.m.con)}</td></tr>`).join('')}</table></div>
<h2>Promociones permitidas (no hacen perder)</h2>
<div class="t"><ul><li><b>Cupón DCTECH2026 · 10 % en la primera compra</b> (vigente en la base): cubierto por el margen; nunca deja menos de ${REGLA.margen} %.</li>
<li><b>Combos de plataformas:</b> 5 % con 2 y 10 % con 3 o más (antes 10 % y 15 %: el 15 % dejaba planes por debajo del margen). El cupón no se suma al combo.</li>
<li><b>Tope en la base:</b> ningún cupón ni combo puede pasar del ${REGLA.descuentoMax} %, ni desde el panel. Si quieres una promo mayor, primero se sube <code>anc_descuento_max</code> y los precios se recalculan para cubrirla.</li>
<li><b>Promos sin descuento</b> (no cuestan margen): «regalo del día», guías de regalos, envío a todo el país, entrega por WhatsApp, fechas especiales. Son las que usa el plan de publicidad.</li></ul></div>
<h2>Metas: cuántas ventas hacen falta</h2>
<div class="tabla t"><table><tr><th>Ganancia del mes</th><th>Mezcla</th>${resumen.map((r) => `<th>Solo ${NOM[r.t] ?? r.t}</th>`).join('')}</tr>
${metas.map((m) => `<tr><td><b>${cop(m)}</b></td><td>${Math.ceil(m / todo.margen)} ventas</td>${resumen.map((r) => `<td>${Math.ceil(m / r.margen)}</td>`).join('')}</tr>`).join('')}</table>
<small>Aritmética con la ganancia promedio sin cupón; con cupón en todas, súmale ~45 %. Ej.: ${Math.ceil(1000000 / todo.margen)} ventas mezcladas en diciembre ≈ ${Math.ceil(1000000 / todo.margen / 31)} por día.</small></div>
<h2>Caja y riesgo</h2>
<div class="t"><ul><li><b>Primero cobras, después compras:</b> el canal de compra a ANC es manual (#ok DC-X): solo compras en ANC cuando el pago del cliente está validado. Sin inventario ni plata en riesgo.</li>
<li>Tecnología física: confirma el valor del envío antes de cobrar (el precio cubre el producto; el envío se coordina por WhatsApp).</li>
<li>Revisa cada semana el panel → Finanzas (ventas cobradas, costo y margen reales).</li></ul></div>
<h2>Qué falta de tu parte</h2>
<div class="t"><ol><li>Aplicar <b>supabase/APLICAR-PENDIENTES.sql</b> (incluye wo-058 y wo-059) en Supabase → SQL Editor. Desde ese momento la tienda, el bot y la publicidad cobran los precios con margen.</li>
<li>Después: generar de nuevo imágenes y videos (la publicidad tiene un candado: no se genera mientras la base cobre precios sin margen).</li></ol></div>
<p style="color:#9AA6C4">Generado el ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })} con herramientas/plan-financiero.mjs.</p></main></body></html>`;
fs.writeFileSync(DESTINO, html);
console.log(`Plan financiero: ${DESTINO}`);
console.log(resumen.map((r) => `${NOM[r.t] ?? r.t}: ${r.n} planes · ganancia promedio ${cop(r.margen)} (con cupón ${cop(r.margenCupon)})`).join('\n'));
console.log(`Meta $1.000.000 ≈ ${Math.ceil(1000000 / todo.margen)} ventas mezcladas`);
