// T01 · Resumen del día (WO-052) en el flujo: hora, una vez al día, texto y aviso sin SQL (jsCode REAL)
const flujo = require(process.argv[2]);
const nodo = (n) => flujo.nodes.find((x) => x.name === n);
const codigo = (n) => nodo(n).parameters.jsCode;
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const memoria = {};
let datos = {};
const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
const correr = (n, entrada = []) => new Function('$', '$input', '$getWorkflowStaticData', codigo(n))(
    $, { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) }, () => memoria);
const base = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const ADMIN = '573125132325';
datos = { 'Config bot': [{ ...base, numero_aviso_admin: ADMIN }] };
const real = Date.now;
const hora = (iso) => { Date.now = () => Date.parse(iso); };

// Nodos y conexiones
for (const n of ['Hora del resumen', 'Resumen del día', 'Texto del resumen', 'Enviar resumen']) ok(Boolean(nodo(n)), `existe el nodo «${n}»`);
const sale = (de) => (flujo.connections[de]?.main ?? []).flat().map((c) => c.node);
ok(sale('Origen').includes('Hora del resumen'), 'cuelga de la rama de salud (cada 30 min)');
ok(sale('Hora del resumen')[0] === 'Resumen del día' && sale('Resumen del día')[0] === 'Texto del resumen' && sale('Texto del resumen')[0] === 'Enviar resumen', 'hora → RPC → texto → WhatsApp');
ok(/rpc\/resumen_ventas_dia$/.test(nodo('Resumen del día').parameters.url), 'llama a resumen_ventas_dia');

// Fuera de hora no pasa
hora('2026-10-29T19:59:00-05:00');
ok(correr('Hora del resumen').length === 0, '7:59 p. m. → no envía');
hora('2026-10-29T20:31:00-05:00');
ok(correr('Hora del resumen').length === 0, '8:31 p. m. → no envía (la ronda anterior ya cayó en la ventana)');
// 8:05 p. m. → pasa y envía el resumen
hora('2026-10-29T20:05:00-05:00');
let h = correr('Hora del resumen');
ok(h.length === 1 && h[0].json.hoy === '2026-10-29', '8:05 p. m. → arma el resumen del día (fecha de Bogotá)');
datos['Hora del resumen'] = [h[0].json];
let t = correr('Texto del resumen', [{ fecha: '2026-10-29', pedidos: 4, pagados: 3, entregados: 1, venta: 42000, costo: 21000, margen: 21000,
    por_cobrar: { cantidad: 2, total: 30000 }, top: [{ producto: 'Netflix', cantidad: 2, venta: 30000 }, { producto: 'Disney Plus', cantidad: 1, venta: 12000 }] }]);
const texto = t[0]?.json.texto ?? '';
ok(t[0]?.json.numero === ADMIN, 'va al número del director');
ok(/🧾 \*Resumen de hoy · DC Tecnology\*/.test(texto) && /jueves/.test(texto), 'título y fecha en español');
ok(/Pedidos: 4 \(pagados 3, entregados 1\)/.test(texto) && /Ventas: \$42\.000/.test(texto) && /Margen: \$21\.000/.test(texto), 'cifras con formato de pesos');
ok(/Por cobrar en la web \(24 h\): 2 por \$30\.000/.test(texto), 'por cobrar');
ok(/1\. Netflix × 2 \(\$30\.000\)/.test(texto) && /2\. Disney Plus/.test(texto), 'los más vendidos');
// Segunda ronda del mismo día: no repite
hora('2026-10-29T20:25:00-05:00');
ok(correr('Hora del resumen').length === 0, 'la siguiente ronda del mismo día no repite');
// Día siguiente sin ventas
hora('2026-10-30T20:02:00-05:00');
h = correr('Hora del resumen'); datos['Hora del resumen'] = [h[0]?.json ?? {}];
t = correr('Texto del resumen', [{ pedidos: 0, pagados: 0, entregados: 0, venta: 0, costo: 0, margen: 0, por_cobrar: { cantidad: 0, total: 0 }, top: [] }]);
ok(h.length === 1 && /Hoy no hubo pedidos nuevos/.test(t[0]?.json.texto ?? '') && !/Más vendidos/.test(t[0].json.texto), 'día sin ventas → «Hoy no hubo pedidos nuevos»');
// Sin el SQL: avisa una sola vez
hora('2026-10-31T20:00:00-05:00');
h = correr('Hora del resumen'); datos['Hora del resumen'] = [h[0]?.json ?? {}];
t = correr('Texto del resumen', [{ error: { message: 'Could not find the function public.resumen_ventas_dia' } }]);
ok(/aplica supabase\/wo-052/.test(t[0]?.json.texto ?? ''), 'sin wo-052 → avisa «aplica wo-052»');
hora('2026-11-01T20:00:00-05:00');
h = correr('Hora del resumen'); datos['Hora del resumen'] = [h[0]?.json ?? {}];
t = correr('Texto del resumen', [{ error: { message: 'Could not find the function' } }]);
ok(h.length === 1 && t.length === 0, '… y no lo repite al día siguiente');
// Sin número del director: no envía nada
hora('2026-11-02T20:00:00-05:00');
h = correr('Hora del resumen'); datos = { 'Config bot': [{ ...base, numero_aviso_admin: '' }], 'Hora del resumen': [h[0]?.json ?? {}] };
ok(correr('Texto del resumen', [{ pedidos: 1 }]).length === 0, 'sin número del director → no envía');
Date.now = real;
