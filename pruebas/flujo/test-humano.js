// Atención humana (18/10/2026): historial real del chat (Evolution) decide si el bot se calla. jsCode REAL del flujo.
const flujo = require(process.argv[2]);
const codigo = (n) => flujo.nodes.find((x) => x.name === n).parameters.jsCode;
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const config = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
let memoria = {};
let datos = {};
const $ = (n) => { if (!(n in datos)) throw new Error(`nodo ${n} no ejecutado`); return { first: () => ({ json: datos[n][0] ?? {} }), all: () => datos[n].map((json) => ({ json })) }; };
const correr = (n) => new Function('$', '$input', '$getWorkflowStaticData', codigo(n))($, { first: () => ({ json: {} }) }, () => memoria);
const ahora = Math.floor(Date.now() / 1000);
const reg = (fromMe, id, texto, haceMin, jid = '573166173053@s.whatsapp.net') => ({ key: { fromMe, id, remoteJid: jid }, messageTimestamp: ahora - haceMin * 60, message: { conversation: texto } });
const BOT = (n) => '3EB0' + String(n).padStart(18, '0');
const TU = (n) => 'A5' + String(n).padStart(30, '0');
const msgCliente = { ruta: 'ia', numero: '573166173053', texto: 'Sii dale', jids: ['573166173053@s.whatsapp.net', '3377000001459@lid'] };
const caso = (historial, lid = [], cfg = {}, msg = msgCliente) => {
    memoria = {};
    datos = { 'Config bot': [{ ...config, ...cfg }], 'Normalizar mensaje': [msg],
        'Historial del chat': [{ messages: { records: historial } }], 'Historial del chat (lid)': [{ messages: { records: lid } }] };
    return correr('¿Lo atiende una persona?');
};

// 1) Normalizar: guarda los dos JID y respeta el interruptor
memoria = {};
datos = { 'Config bot': [{ ...config, numero_aviso_admin: '573125132325' }], 'Webhook Evolution': [{ body: { event: 'messages.upsert', data: { key: { remoteJid: '3377000001459@lid', remoteJidAlt: '573166173053@s.whatsapp.net', fromMe: false, id: 'X1' }, pushName: 'Paola', message: { conversation: 'Necesita esa impresora mantenimiento' }, messageTimestamp: ahora } } }] };
let r = correr('Normalizar mensaje');
ok(r.length === 1 && JSON.stringify(r[0].json.jids) === JSON.stringify(['573166173053@s.whatsapp.net', '3377000001459@lid']), 'Normalizar entrega el número y el @lid del chat para revisar el historial');
memoria = {};
datos['Config bot'] = [{ ...config, bot_responde: 'no', numero_aviso_admin: '573125132325' }];
datos['Webhook Evolution'][0].body.data.key.id = 'X2';
ok(correr('Normalizar mensaje').length === 0, 'bot_responde = no → el bot no le contesta a nadie');
datos['Webhook Evolution'] = [{ body: { event: 'messages.upsert', data: { key: { remoteJid: '573125132325@s.whatsapp.net', fromMe: false, id: 'X3' }, message: { conversation: '#ok DC-ABCDE' }, messageTimestamp: ahora } } }];
r = correr('Normalizar mensaje');
ok(r[0]?.json.ruta === 'triangulacion' && r[0].json.accion === 'ok', '…pero tus comandos (#ok) siguen funcionando con el bot apagado');

// 2) ¿Lo atiende una persona?
ok(caso([reg(true, BOT(1), 'Perfecto, dime cuál producto…', 3), reg(false, 'C1', 'hola', 4)]).length === 1, 'solo respuestas del bot en el chat → el bot sigue respondiendo');
ok(caso([], [reg(true, TU(1), 'Lina, hay que ajustar un repuesto del cabezal', 30, '3377000001459@lid')]).length === 0, 'escribiste tú a mano hace 30 min (en el @lid) → el bot se calla');
ok(memoria.pausados?.['573166173053'] > 0, '…y queda pausado en la memoria también');
ok(caso([reg(true, TU(2), 'Hola Dani', 13 * 60)]).length === 1, 'tu último mensaje fue hace 13 h (más de 12) → el bot vuelve a responder');
ok(caso([reg(true, TU(2), 'Hola Dani', 13 * 60)], [], { horas_pausa_humano: '24' }).length === 0, 'horas_pausa_humano = 24 → sigue callado');
ok(caso([reg(true, TU(3), '#bot', 5), reg(true, TU(4), 'ya te ayudo', 20)]).length === 1, '#bot después de tu mensaje → el bot retoma');
ok(caso([reg(true, BOT(2), '🙋 *Te comunico con un asesor* · DC Tecnology', 2)]).length === 0, 'el bot escaló el chat hace 2 min → se calla (aunque otra ejecución haya borrado la pausa)');
ok(caso([reg(true, BOT(3), '🙋 *Te comunico con un asesor*', 13 * 60)]).length === 1, 'escalamiento de hace 13 h → ya vuelve a responder');
ok(caso([reg(true, BOT(4), 'menú…', 1)], [reg(false, 'C2', 'De una', 1, '3377000001459@lid')]).length === 1, 'mensajes del cliente no cuentan como atención humana');
// Evolution no respondió: los nodos de historial salen vacíos o con error → el mensaje sigue normal
memoria = {};
datos = { 'Config bot': [config], 'Normalizar mensaje': [msgCliente], 'Historial del chat': [{ error: { message: 'timeout' } }], 'Historial del chat (lid)': [{}] };
ok(correr('¿Lo atiende una persona?').length === 1, 'si Evolution no responde, el cliente igual recibe respuesta');
datos = { 'Config bot': [config], 'Normalizar mensaje': [{ ruta: 'triangulacion', origen: 'admin', accion: 'ok', referencia: 'DC-ABCDE', numero: '573125132325', texto: '#ok DC-ABCDE' }], 'Historial del chat': [{ messages: { records: [reg(true, TU(9), 'hola', 1, '573125132325@s.whatsapp.net')] } }], 'Historial del chat (lid)': [{}] };
ok(correr('¿Lo atiende una persona?')[0]?.json.accion === 'ok', 'tus comandos #ok/#no/#entregar nunca se frenan');

// 3) Estructura: Normalizar → Historial → Historial (lid) → ¿Lo atiende una persona? → Ruta
const c = flujo.connections;
ok(c['Normalizar mensaje'].main[0][0].node === 'Historial del chat' && c['Historial del chat'].main[0][0].node === 'Historial del chat (lid)'
    && c['Historial del chat (lid)'].main[0][0].node === '¿Lo atiende una persona?' && c['¿Lo atiende una persona?'].main[0][0].node === 'Ruta', 'conexiones en orden');
const h = flujo.nodes.find((n) => n.name === 'Historial del chat');
ok(h.onError === 'continueRegularOutput' && h.alwaysOutputData === true && /findMessages/.test(h.parameters.url), 'el historial nunca frena el flujo (sigue aunque falle)');

// 4) Avisos de falla de Emprende Red: una vez al día y nunca de noche
const real = Date.now;
const aLas = (h) => { const d = new Date('2026-10-18T00:00:00-05:00'); return d.getTime() + h * 3600e3; };
const prov = (h) => { Date.now = () => aLas(h); datos = { 'Config bot': [{ ...config, numero_aviso_admin: '573125132325' }], 'Leer Emprende Red': [{ error: { message: 'Request failed with status code 503' } }] };
    try { return new Function('$', '$input', '$getWorkflowStaticData', codigo('Resultado proveedor'))($, { first: () => ({ json: {} }) }, () => memoria); } finally { Date.now = real; } };
memoria = {};
ok(prov(0).length === 0, 'falla de Emprende Red a medianoche → no te escribe');
ok(prov(6).length === 0, '…a las 6 a. m. tampoco (antes de las 7)');
ok(prov(8).length === 1, '…a las 8 a. m. sí avisa');
ok(prov(12).length === 0 && prov(18).length === 0, '…y no repite el mismo día');
ok(prov(33).length === 1, '…al día siguiente (9 a. m.) vuelve a avisar si sigue fallando');

// 5) "DATOS" (habeas data) → asesor con el plazo legal
memoria = {};
datos = { 'Config bot': [{ ...config, numero_aviso_admin: '573125132325' }], 'Webhook Evolution': [{ body: { event: 'messages.upsert', data: { key: { remoteJid: '573001234567@s.whatsapp.net', fromMe: false, id: 'D1' }, message: { conversation: 'Borrar mis datos' }, messageTimestamp: Math.floor(Date.now() / 1000) } } }] };
r = correr('Normalizar mensaje');
ok(r[0]?.json.ruta === 'asesor' && /Ley 1581/.test(r[0].json.motivo), '"Borrar mis datos" → pasa a ti con el plazo de la Ley 1581');
