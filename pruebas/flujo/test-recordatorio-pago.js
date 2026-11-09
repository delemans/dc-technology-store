// T03 · Recordatorio al cliente sin comprobante (WO-054) en el flujo y la plantilla (jsCode REAL)
const flujo = require(process.argv[2]);
const path = require('node:path');
const nodo = (n) => flujo.nodes.find((x) => x.name === n);
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
let datos = {};
const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
const correr = (n) => new Function('$', '$input', '$getWorkflowStaticData', nodo(n).parameters.jsCode)($, { first: () => ({ json: {} }), all: () => [] }, () => ({}));
const base = nodo('Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});

for (const n of ['Recordar pagos', 'Encolar recordatorios']) ok(Boolean(nodo(n)), `existe el nodo «${n}»`);
const sale = (de) => (flujo.connections[de]?.main ?? []).flat().map((c) => c.node);
ok(sale('Origen').includes('Recordar pagos') && sale('Recordar pagos')[0] === 'Encolar recordatorios', 'rama de salud (cada 30 min) → RPC');
ok(/rpc\/encolar_recordatorios_pago$/.test(nodo('Encolar recordatorios').parameters.url), 'llama a encolar_recordatorios_pago');

datos = { 'Config bot': [{ ...base, bot_responde: 'no' }] };
ok(correr('Recordar pagos').length === 0, 'con el bot apagado no le escribe a ningún cliente');
datos = { 'Config bot': [{ ...base, bot_responde: 'si' }] };
ok(correr('Recordar pagos').length === 1, 'con el bot encendido encola los recordatorios');

// Plantilla: la cola la rellena con {codigo} y {total}
const kb = require(path.join(__dirname, '..', '..', 'bot-conocimiento.json')); // el del repo (el catálogo fijo no trae plantillas nuevas)
const clave = kb.notificaciones.plantilla_por_tipo.RECORDATORIO_PAGO;
const texto = String(kb.plantillas[clave] ?? '').replace(/\{(\w+)\}/g, (_, k) => ({ codigo: 'DC-AB12C', total: '45.000' }[k] ?? `{${k}}`));
ok(clave === 'recordatorio_pago' && /#DC-AB12C/.test(texto) && /\$45\.000/.test(texto), 'la plantilla lleva el código y el total en pesos');
ok(/www\.dctecnology\.xyz/.test(texto), 'enlace con www');
ok(!/descuento|%|hoy mismo|vence|expira|horas?\b|minutos?|ANC|proveedor/i.test(texto), 'sin descuentos, plazos ni proveedores');
