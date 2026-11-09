// T04 · Cliente molesto → pasa al director al instante (sin IA), con el jsCode REAL de «Normalizar mensaje» y «Escalar a asesor»
const flujo = require(process.argv[2]);
const codigo = (nombre) => flujo.nodes.find((n) => n.name === nombre).parameters.jsCode;
let memoria = {};
let datos = {};
const ejecutar = (nombre, entrada = []) => {
    const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
    const $input = { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) };
    return new Function('$', '$input', '$getWorkflowStaticData', codigo(nombre))($, $input, () => memoria);
};
const ok = (cond, msg) => { console.log(`${cond ? 'OK   ' : 'FALLA'} ${msg}`); if (!cond) process.exitCode = 1; };
const ADMIN = '573125132325';
const config = { ...flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {}), numero_aviso_admin: ADMIN, bot_responde: 'si' };
let n = 0;
const llega = (texto) => {
    memoria = {};
    const numero = `5730011${String(++n).padStart(5, '0')}`;
    datos = { 'Config bot': [config], 'Webhook Evolution': [{ body: { event: 'messages.upsert', data: { key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: `M${n}` }, pushName: 'Ana', message: { conversation: texto } } } }] };
    return ejecutar('Normalizar mensaje')[0]?.json ?? {};
};

const molestos = ['Esto es una estafa', 'ustedes son unos estafadores', 'me robaron la plata', 'los voy a denunciar ante la SIC', 'voy a poner la queja en la Superintendencia',
    'ya hablé con mi abogado', 'Devuélvanme mi plata ya', 'quiero mi dinero', 'son unos ladrones', 'malparidos no me han entregado nada', '¿No es estafa?', 'me engañaron'];
for (const t of molestos) {
    const r = llega(t);
    ok(r.ruta === 'asesor' && r.urgente === true && r.motivo === 'Cliente molesto: atender ya', `«${t}» → asesor urgente`);
}
const normales = ['gracias', 'Hola', 'quiero un robot aspiradora', 'Netflix básico', 'cuánto vale el clásico', 'tienen pines de Roblox', 'ok perfecto, ya pagué'];
for (const t of normales) ok(llega(t).urgente !== true, `«${t}» → no es reclamo`);

// El aviso al director sale con prioridad y el chat queda en pausa
const msg = llega('Esto es una estafa, devuélvanme la plata');
datos['Normalizar mensaje'] = [msg];
const salida = ejecutar('Escalar a asesor', [msg]).map((x) => x.json);
const aviso = salida.find((x) => x.numero === ADMIN);
ok(salida[0]?.numero === msg.numero && /asesor/i.test(salida[0].texto), 'al cliente: «Te comunico con un asesor» (sin IA)');
ok(/🚨 \*URGENTE · Cliente molesto: atender ya\*/.test(aviso?.texto ?? '') && /devuélvanme la plata/.test(aviso.texto), 'a ti: aviso URGENTE con el mensaje del cliente');
ok(Boolean(memoria.pausados?.[msg.numero]), 'el bot queda en pausa en ese chat');
const comun = ejecutar('Escalar a asesor', [{ ...llega('asesor') }]).map((x) => x.json).find((x) => x.numero === ADMIN);
ok(/🔔 \*Escalamiento a asesor\*/.test(comun?.texto ?? ''), 'pedir un asesor normal sigue con el aviso de siempre');
