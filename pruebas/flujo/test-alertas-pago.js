// T02 · Pagos por revisar (WO-053) en el flujo: horario, un aviso por referencia y aviso sin SQL (jsCode REAL)
const flujo = require(process.argv[2]);
const nodo = (n) => flujo.nodes.find((x) => x.name === n);
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const memoria = {};
let datos = {};
const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
const correr = (entrada) => new Function('$', '$input', '$getWorkflowStaticData', nodo('Alertas de pago').parameters.jsCode)(
    $, { first: () => ({ json: entrada ?? {} }), all: () => [{ json: entrada ?? {} }] }, () => memoria);
const base = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const ADMIN = '573125132325';
datos = { 'Config bot': [{ ...base, numero_aviso_admin: ADMIN }] };
const real = Date.now;
const hora = (iso) => { Date.now = () => Date.parse(iso); };
const hace = (min) => new Date(Date.now() - min * 60000).toISOString();

for (const n of ['Pagos por revisar', 'Alertas de pago', 'Enviar alerta de pago']) ok(Boolean(nodo(n)), `existe el nodo «${n}»`);
const sale = (de) => (flujo.connections[de]?.main ?? []).flat().map((c) => c.node);
ok(sale('Origen').includes('Pagos por revisar') && sale('Pagos por revisar')[0] === 'Alertas de pago' && sale('Alertas de pago')[0] === 'Enviar alerta de pago', 'rama de salud → RPC → alertas → WhatsApp');
ok(/rpc\/pagos_por_revisar$/.test(nodo('Pagos por revisar').parameters.url), 'llama a pagos_por_revisar');

// Jueves 29/10/2026 10:00 a. m.
hora('2026-10-29T10:00:00-05:00');
const lote = () => ({ comprobantes: [{ referencia: 'DC-AAAA1', total: 45000, desde: hace(45) }],
    sin_pago: [{ referencia: 'DC-BBBB1', total: 18000, desde: hace(26 * 60), canal: 'whatsapp' }, { referencia: 'DC-AAAA4', total: 15000, desde: hace(30 * 60), canal: 'web' }] });
let r = correr(lote());
const t = r[0]?.json.texto ?? '';
ok(r.length === 1 && r[0].json.numero === ADMIN, 'avisa al director');
ok(/Comprobantes sin validar/.test(t) && /\*DC-AAAA1\* · \$45\.000 · llegó hace 45 min/.test(t) && /#ok DC-X/.test(t), 'comprobante: referencia, monto, hace cuánto y qué responder');
ok(/sin pago hace más de 24 h/.test(t) && /\*DC-BBBB1\* · \$18\.000 · WhatsApp · hace 26 h/.test(t) && /DC-AAAA4\* · \$15\.000 · web/.test(t), 'pedidos sin pago con canal');
// 30 min después, lo mismo: no repite
hora('2026-10-29T10:30:00-05:00');
ok(correr(lote()).length === 0, 'la siguiente ronda no repite las mismas referencias');
// Llega uno nuevo: solo avisa ese
r = correr({ ...lote(), comprobantes: [...lote().comprobantes, { referencia: 'DC-AAAA9', total: 9000, desde: hace(35) }] });
ok(r.length === 1 && /DC-AAAA9/.test(r[0].json.texto) && !/DC-AAAA1/.test(r[0].json.texto) && !/sin pago/.test(r[0].json.texto), 'solo avisa la referencia nueva');
// De noche y domingo: nada
hora('2026-10-29T21:00:00-05:00');
ok(correr({ comprobantes: [{ referencia: 'DC-NOCHE', total: 1000, desde: hace(60) }], sin_pago: [] }).length === 0, '9 p. m. → no avisa');
hora('2026-10-30T07:30:00-05:00');
ok(correr({ comprobantes: [{ referencia: 'DC-NOCHE', total: 1000, desde: hace(60) }], sin_pago: [] }).length === 0, '7:30 a. m. → no avisa');
hora('2026-11-01T10:00:00-05:00');
ok(correr({ comprobantes: [{ referencia: 'DC-NOCHE', total: 1000, desde: hace(60) }], sin_pago: [] }).length === 0, 'domingo → no avisa');
// Al abrir el horario sí avisa lo que quedó de la noche
hora('2026-11-02T08:00:00-05:00');
r = correr({ comprobantes: [{ referencia: 'DC-NOCHE', total: 1000, desde: hace(600) }], sin_pago: [] });
ok(r.length === 1 && /DC-NOCHE/.test(r[0].json.texto) && /hace 10 h/.test(r[0].json.texto), 'lunes 8 a. m. → avisa lo que llegó de noche');
// Sin pendientes: nada
ok(correr({ comprobantes: [], sin_pago: [] }).length === 0, 'sin pendientes → no envía');
// Sin SQL: una vez
r = correr({ error: { message: 'Could not find the function public.pagos_por_revisar' } });
ok(/aplica supabase\/wo-053/.test(r[0]?.json.texto ?? ''), 'sin wo-053 → avisa «aplica wo-053»');
ok(correr({ error: { message: 'Could not find the function' } }).length === 0, '… y no lo repite');
// Sin número del director
datos = { 'Config bot': [{ ...base, numero_aviso_admin: '' }] };
ok(correr({ comprobantes: [{ referencia: 'DC-ZZZZ1', total: 1, desde: hace(60) }], sin_pago: [] }).length === 0, 'sin número del director → no envía');
Date.now = real;
