// WO-038 · Nodo "Resultado Evolution" (código real del flujo)
const flujo = require(process.argv[2]);
const codigo = (nombre) => flujo.nodes.find((n) => n.name === nombre).parameters.jsCode;
let datos = {};
const ejecutar = (nombre, entrada = []) => {
    const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
    const $input = { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) };
    return new Function('$', '$input', '$getWorkflowStaticData', codigo(nombre))($, $input, () => ({}));
};
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const config = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
ok(config.webhook_publico === 'http://localhost:5678/webhook/dc-whatsapp', 'Config bot trae webhook_publico (localhost:5678 por defecto)');
const cfg = { ...config, evolution_url: 'http://localhost:8080', evolution_instancia: 'dc-bot' };

datos = { 'Config bot': [cfg], 'Webhook Evolution v2': [{ statusCode: 201 }], 'Webhook Evolution v1': [{ statusCode: 400 }] };
let r = ejecutar('Resultado Evolution', [{ statusCode: 200, body: { enabled: true, url: cfg.webhook_publico, events: ['MESSAGES_UPSERT'] } }])[0].json;
ok(/✅/.test(r.resultado) && r.intentos === 'formato v2: HTTP 201 · formato v1: HTTP 400 · lectura: HTTP 200' && /Probar todo el sistema/.test(r.siguiente), 'v2 guardó y se leyó igual → ✅ con el siguiente paso');
ok(/fuera de Docker/.test(r.aviso ?? ''), 'webhook en localhost con Evolution local → recuerda el caso Docker');

datos['Webhook Evolution v2'] = [{ statusCode: 400 }]; datos['Webhook Evolution v1'] = [{ statusCode: 201 }];
r = ejecutar('Resultado Evolution', [{ statusCode: 200, body: { webhook: { enabled: true, url: cfg.webhook_publico, events: ['MESSAGES_UPSERT'] } } }])[0].json;
ok(/✅/.test(r.resultado), 'Evolution v1 (respuesta anidada en webhook) → también ✅');

datos = { 'Config bot': [cfg], 'Webhook Evolution v2': [{ statusCode: 401 }], 'Webhook Evolution v1': [{ statusCode: 401 }] };
r = ejecutar('Resultado Evolution', [{ statusCode: 401, body: { message: 'Unauthorized' } }])[0].json;
ok(/⚠️/.test(r.resultado) && /API key/.test(r.siguiente), 'API key rechazada → dice que revises la credencial "Evolution API"');

datos = { 'Config bot': [{ ...cfg, evolution_url: 'https://evo.miservidor.com' }], 'Webhook Evolution v2': [{ statusCode: 201 }], 'Webhook Evolution v1': [{ statusCode: 400 }] };
r = ejecutar('Resultado Evolution', [{ statusCode: 200, body: { enabled: true, url: cfg.webhook_publico, events: ['MESSAGES_UPSERT'] } }])[0].json;
ok(/evo\.miservidor\.com/.test(r.aviso ?? '') && /túnel/.test(r.aviso ?? ''), 'Evolution en un servidor + localhost → avisa que necesita la URL del túnel');

datos = { 'Config bot': [{ ...cfg, evolution_url: 'https://TU-EVOLUTION-API' }], 'Webhook Evolution v2': [{}], 'Webhook Evolution v1': [{}] };
r = ejecutar('Resultado Evolution', [{}])[0].json;
ok(/⚠️/.test(r.resultado) && /evolution_url/.test(r.siguiente) && r.intentos.includes('sin respuesta'), 'sin Evolution configurado → te dice qué revisar en Config bot');
