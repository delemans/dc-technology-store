// T07 · «DATOS» por WhatsApp queda en el libro de PQR (wo-056), con el jsCode REAL de los nodos
const flujo = require(process.argv[2]);
const nodo = (n) => flujo.nodes.find((x) => x.name === n);
let memoria = {};
let datos = {};
const ejecutar = (nombre, entrada = []) => {
    const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
    const $input = { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) };
    return new Function('$', '$input', '$getWorkflowStaticData', nodo(nombre).parameters.jsCode)($, $input, () => memoria);
};
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const config = { ...nodo('Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {}), numero_aviso_admin: '573125132325', bot_responde: 'si' };
let n = 0;
const llega = (texto) => {
    memoria = {};
    const numero = `5730022${String(++n).padStart(5, '0')}`;
    datos = { 'Config bot': [config], 'Webhook Evolution': [{ body: { event: 'messages.upsert', data: { key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: `P${n}` }, pushName: 'Ana', message: { conversation: texto } } } }] };
    return ejecutar('Normalizar mensaje')[0]?.json ?? {};
};

for (const n of ['PQR del chat', 'Registrar PQR']) ok(Boolean(nodo(n)), `existe el nodo «${n}»`);
const sale = (de, i) => (flujo.connections[de]?.main?.[i] ?? []).map((c) => c.node);
ok(sale('Ruta', 1).includes('PQR del chat') && sale('Ruta', 1).includes('Escalar a asesor'), 'la ruta asesor también pasa por el libro de PQR');
ok(sale('PQR del chat', 0)[0] === 'Registrar PQR' && /rpc\/registrar_pqr$/.test(nodo('Registrar PQR').parameters.url), '→ registrar_pqr');

const msg = llega('Borrar mis datos');
ok(msg.ruta === 'asesor' && msg.pqr === 'datos', '«Borrar mis datos» → asesor y PQR de datos personales');
const r = ejecutar('PQR del chat', [msg]);
ok(r.length === 1 && r[0].json.args.p_whatsapp === msg.numero && r[0].json.args.p_tipo === 'datos' && r[0].json.args.p_detalle === 'Borrar mis datos', 'envía número, tipo y el mensaje del cliente');
const otro = llega('asesor');
ok(otro.ruta === 'asesor' && ejecutar('PQR del chat', [otro]).length === 0, 'pedir un asesor normal no crea PQR');
