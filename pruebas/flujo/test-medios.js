// Audios e imágenes con modelos abiertos (18/10/2026) — con el jsCode REAL del flujo
const flujo = require(process.argv[2]);
const codigo = (n) => flujo.nodes.find((x) => x.name === n).parameters.jsCode;
const config = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
let memoria = {};
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const cfgBase = { ...config, leer_medios: 'si', numero_aviso_admin: '573125132325', numero_proveedor: '573054004508' };
const evento = (data) => ({ body: { event: 'messages.upsert', instance: 'dc-bot', data: { messageTimestamp: Math.floor(Date.now() / 1000), ...data } } });
const $de = (datos) => (n) => { if (!(n in datos)) throw new Error(`nodo sin ejecutar: ${n}`); return { first: () => ({ json: datos[n][0] }), all: () => datos[n].map((json) => ({ json })) }; };

// ---------- 1) Medio entrante ----------
const entrante = (data, cfg = {}) => new Function('$', '$input', '$getWorkflowStaticData', codigo('Medio entrante'))(
    $de({ 'Config bot': [{ ...cfgBase, ...cfg }], 'Webhook Evolution': [evento(data)] }), { first: () => ({ json: {} }) }, () => memoria)[0].json;
const audio = { key: { remoteJid: '573001112233@s.whatsapp.net', fromMe: false, id: 'A1' }, message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', seconds: 12, ptt: true } } };
const imagen = (caption, id = 'I1', numero = '573001112233') => ({ key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id }, message: { imageMessage: { mimetype: 'image/jpeg', caption } } });
let r = entrante(audio);
ok(r.leer === 'si' && r.tipo === 'audio' && r.wamid === 'A1', 'audio de un cliente → se transcribe');
ok(entrante({ ...audio, message: { audioMessage: { seconds: 400 } } }).leer === 'no', 'audio de más de 3 min → no (lo escuchas tú)');
ok(entrante({ ...audio, key: { ...audio.key, fromMe: true } }).leer === 'no', 'mensaje propio → no');
ok(entrante({ ...audio, key: { ...audio.key, remoteJid: '573125132325@s.whatsapp.net' } }).leer === 'no', 'tu número (admin) → no');
ok(entrante({ ...audio, key: { ...audio.key, remoteJid: '573054004508@s.whatsapp.net' } }).leer === 'no', 'ANC → no');
ok(entrante(audio, { bot_responde: 'no' }).leer === 'no', 'bot apagado (bot_responde = no) → no gasta IA');
ok(entrante(audio, { leer_medios: 'no' }).leer === 'no', 'leer_medios = no → apagado');
ok(entrante(audio, { leer_medios: undefined }).leer === 'no', 'sin leer_medios en Config bot → apagado (por defecto)');
ok(entrante({ ...audio, messageTimestamp: Math.floor(Date.now() / 1000) - 3600 }).leer === 'no', 'audio atrasado (1 h) → no');
ok(entrante(imagen('te envío el comprobante del pago')).leer === 'no', 'foto con "comprobante/pago" → no (la revisa una persona)');
ok(entrante(imagen('me sale este error en netflix', 'I2')).leer === 'si', 'captura de un error → se lee');
ok(entrante(imagen('', 'I3')).leer === 'si', 'foto sin contexto → se lee (para tu aviso)');
memoria.conversacion = { '573001112233': Date.now() };
ok(entrante(imagen('', 'I4')).leer === 'no', 'foto en medio de una compra → no (va a comprobante)');
memoria.esperandoPago = { '573001112233': Date.now() };
ok(entrante(imagen('no me funciona', 'I5')).leer === 'no', 'esperando pago → nunca se lee (es el comprobante)');
memoria = { etiquetas: { chats: { '573001112233': ['7'] }, nombres: { 7: 'BAENAMORA' } } };
ok(entrante(audio).leer === 'no', 'chat con etiqueta BAENAMORA → no');
memoria = {};
ok(entrante({ key: { remoteJid: '573001112233@s.whatsapp.net', fromMe: false, id: 'T1' }, message: { conversation: 'hola' } }).leer === 'no', 'texto → no pasa por la IA de medios');

// ---------- 2) Leer medio (IA) ----------
const IAS = [{ nombre: 'Groq', url: 'https://api.groq.com/openai/v1', clave: 'g', modelo: 'x' }, { nombre: 'NVIDIA NIM', url: 'https://integrate.api.nvidia.com/v1', clave: 'n', modelo: 'y' }, { nombre: 'OpenRouter', url: 'https://openrouter.ai/api/v1', clave: 'o', modelo: 'z' }];
const leer = async (pedido, descarga, respuestas) => {
    const llamadas = [];
    const helpers = { httpRequest: async (o) => { llamadas.push(o); const x = respuestas.shift(); if (x instanceof Error) throw x; return x; } };
    const js = codigo('Leer medio (IA)').split('[] /*__CLAVES_IA__*/').join(JSON.stringify(IAS));
    const salida = await new AsyncFunction('$', '$input', '$getWorkflowStaticData', js).call({ helpers }, $de({ 'Medio entrante': [pedido], 'Config bot': [cfgBase] }), { first: () => ({ json: descarga }) }, () => memoria);
    return { r: salida[0].json, item: salida[0], llamadas };
};
(async () => {
    let x = await leer({ leer: 'si', tipo: 'audio', wamid: 'A1', mimetype: 'audio/ogg; codecs=opus' }, { base64: 'T0dHREFUQQ==', mimetype: 'audio/ogg; codecs=opus' }, []);
    ok(x.llamadas.length === 0 && x.r.whisper?.url === 'https://api.groq.com/openai/v1/audio/transcriptions' && x.r.whisper.clave === 'g' && x.r.tipo === 'audio', 'audio: el Code NO envía el archivo (lo hace el nodo HTTP Whisper) y le pasa URL y clave de Groq');
    ok(x.item.binary?.audio?.data === 'T0dHREFUQQ==' && x.item.binary.audio.mimeType === 'audio/ogg' && x.item.binary.audio.fileName === 'audio.ogg', 'el audio sale como binario .ogg');
    x = await leer({ tipo: 'audio', wamid: 'A3' }, {}, []);
    ok(x.r.error && x.r.tipo === 'sin_archivo' && x.llamadas.length === 0, 'sin archivo descargado → no va a Whisper');
    const transcribir = (respuesta) => new Function('$', '$input', codigo('Transcripción'))($de({ 'Leer medio (IA)': [{ wamid: 'A1', tipo: 'audio' }] }), { first: () => ({ json: respuesta }) })[0].json;
    let tr = transcribir({ text: ' Quiero Netflix una pantalla ' });
    ok(tr.transcripcion === 'Quiero Netflix una pantalla' && tr.wamid === 'A1', 'respuesta de Whisper → transcripción');
    tr = transcribir({ error: { message: 'Rate limit reached' } });
    ok(!tr.transcripcion && /Rate limit/.test(tr.error), 'Whisper sin cupo → sin transcripción (sigue como antes)');
    const w = flujo.nodes.find((n) => n.name === 'Whisper (audio)').parameters;
    ok(w.contentType === 'multipart-form-data' && w.bodyParameters.parameters.some((p) => p.parameterType === 'formBinaryData' && p.inputDataFieldName === 'audio') && w.bodyParameters.parameters.some((p) => p.name === 'language' && p.value === 'es'), 'nodo Whisper: multipart nativo con el binario y español');
    x = await leer({ tipo: 'imagen', wamid: 'I2', mimetype: 'image/jpeg' }, { base64: 'IMG', mimetype: 'image/jpeg' }, [{ statusCode: 500, body: {} }, { statusCode: 200, body: { choices: [{ message: { content: 'App de Netflix con el mensaje "Demasiadas personas usan tu cuenta".' } }] } }]);
    ok(/Demasiadas personas/.test(x.r.descripcion) && x.r.ia === 'Llama 3.2 Vision 90B', `imagen: si el 11B falla usa el 90B (${x.r.ia})`);
    ok(x.llamadas[0].body.model === 'meta/llama-3.2-11b-vision-instruct' && x.llamadas[0].body.messages[0].content[1].image_url.url === 'data:image/jpeg;base64,IMG', 'manda la imagen como data URL al modelo abierto');
    x = await leer({ tipo: 'imagen', wamid: 'I3' }, { base64: 'IMG' }, [new Error('timeout'), { statusCode: 404, body: {} }, { statusCode: 429, body: {} }]);
    ok(!x.r.descripcion && x.r.error && x.llamadas.length === 3, 'ninguna IA de visión → sin descripción, con el motivo');

    // ---------- 3) Normalizar mensaje con lo leído ----------
    const normalizar = (data, medio) => {
        const datos = { 'Config bot': [{ ...cfgBase }], 'Webhook Evolution': [evento(data)] };
        if (medio) datos[medio.tipo === 'audio' ? 'Transcripción' : 'Leer medio (IA)'] = [medio];
        return new Function('$', '$input', '$getWorkflowStaticData', codigo('Normalizar mensaje'))($de(datos), { first: () => ({ json: {} }) }, () => memoria);
    };
    memoria = {};
    let n = normalizar({ ...audio, key: { ...audio.key, id: 'N1' } }, { wamid: 'N1', tipo: 'audio', transcripcion: 'cuánto vale netflix' });
    ok(n[0]?.json.ruta === 'ia' && n[0].json.texto === 'cuánto vale netflix', 'audio transcrito → se atiende como texto');
    n = normalizar({ ...audio, key: { ...audio.key, id: 'N2' } }, { wamid: 'N2', tipo: 'audio', transcripcion: 'hola' });
    ok(n[0]?.json.ruta === 'menu', 'audio "hola" → menú, igual que si lo escribiera');
    n = normalizar({ ...audio, key: { ...audio.key, id: 'N3' } }, { wamid: 'OTRO', tipo: 'audio', transcripcion: 'precio' });
    ok(n[0]?.json.ruta === 'sin_texto' && n[0].json.tipo === 'audio', 'transcripción de OTRO mensaje → no se usa');
    n = normalizar({ ...audio, key: { ...audio.key, id: 'N4' } });
    ok(n[0]?.json.ruta === 'sin_texto' && n[0].json.tipo === 'audio', 'sin transcripción → "no puedo escuchar audios" como antes');
    n = normalizar(imagen('me sale este error', 'N5'), { wamid: 'N5', descripcion: 'Netflix: "Demasiadas personas usan tu cuenta".' });
    ok(n[0]?.json.ruta === 'ia' && /^me sale este error\n\[Captura enviada por el cliente\. Se ve: Netflix/.test(n[0].json.texto), 'captura de un problema leída → la IA intenta resolverla');
    n = normalizar(imagen('me sale este error', 'N6'));
    ok(n[0]?.json.ruta === 'asesor', 'captura sin leer → asesor como antes');
    n = normalizar(imagen('me sale un error', 'N7'), { wamid: 'N7', descripcion: 'Comprobante de pago' });
    ok(n[0]?.json.ruta === 'asesor', 'si la "captura" resulta ser un comprobante → no va a la IA');
    n = normalizar(imagen('', 'N8', '573007770000'), { wamid: 'N8', descripcion: 'Una foto de un perro.' });
    ok(n[0]?.json.ruta === 'sin_texto' && n[0].json.aviso === 'imagen' && n[0].json.descripcion === 'Una foto de un perro.', 'foto sin contexto → tu aviso lleva la descripción');

    // ---------- 4) Tu aviso ----------
    const avisoTexto = new Function('$', '$input', '$getWorkflowStaticData', codigo('Respuesta fija'))($de({ 'Config bot': [cfgBase], 'Normalizar mensaje': [n[0].json] }), { first: () => ({ json: {} }) }, () => memoria)[0].json.texto;
    ok(/🤖 Lo que se ve: Una foto de un perro\./.test(avisoTexto), 'el aviso al director incluye lo que se ve');

    // ---------- 5) Conexiones ----------
    const c = flujo.connections;
    const destinos = (n, i = 0) => (c[n]?.main?.[i] ?? []).map((x) => x.node);
    ok(destinos('Origen', 6).includes('Medio entrante') && !destinos('Origen', 6).includes('Normalizar mensaje'), 'Origen → Medio entrante');
    ok(destinos('Medio entrante').includes('¿Leer medio?') && destinos('¿Leer medio?', 0).includes('Descargar medio') && destinos('¿Leer medio?', 1).includes('Normalizar mensaje'), '¿Leer medio? → Descargar / Normalizar');
    ok(destinos('Descargar medio').includes('Leer medio (IA)') && destinos('Leer medio (IA)').includes('¿Es audio?') && destinos('¿Es audio?', 0).includes('Whisper (audio)') && destinos('¿Es audio?', 1).includes('Normalizar mensaje') && destinos('Whisper (audio)').includes('Transcripción') && destinos('Transcripción').includes('Normalizar mensaje'), 'Descargar → Leer (IA) → ¿Es audio? → Whisper → Transcripción → Normalizar');
    ok(codigo('Leer medio (IA)').includes('[] /*__CLAVES_IA__*/'), 'las claves NO quedan en el archivo de git (se ponen al sincronizar)');
    const prompt = JSON.stringify(flujo.nodes.find((x) => x.name === 'Armar contexto').parameters.jsCode);
    ok(/CAPTURAS:/.test(prompt), 'la IA sabe qué hacer con una captura');
})();
