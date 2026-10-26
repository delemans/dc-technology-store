// Mensajes con el formato nuevo de WhatsApp (@lid) tal como los entrega Evolution 2.3.7
const flujo = require(process.argv[2]);
const codigo = flujo.nodes.find((n) => n.name === 'Normalizar mensaje').parameters.jsCode;
const config = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const memoria = {};
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const correr = (data, cfg = {}) => {
    const datos = { 'Config bot': [{ ...config, numero_aviso_admin: '573054004508', ...cfg }], 'Webhook Evolution': [{ body: { event: 'messages.upsert', instance: 'dc-bot', data } }] };
    const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }) });
    return new Function('$', '$input', '$getWorkflowStaticData', codigo)($, { first: () => ({ json: {} }) }, () => memoria);
};
let r = correr({ key: { remoteJid: '206361340337836162@lid', remoteJidAlt: '573125132325@s.whatsapp.net', fromMe: false, id: 'L1' }, pushName: 'Cliente', message: { conversation: 'Hola mundo', messageContextInfo: {} }, messageType: 'conversation' });
ok(r.length === 1 && r[0].json.ruta === 'ia' && r[0].json.numero === '573125132325' && r[0].json.texto === 'Hola mundo', `chat @lid con remoteJidAlt → va a la IA con el número real (${JSON.stringify(r[0]?.json?.numero)})`);
r = correr({ key: { remoteJid: '111@lid', senderPn: '573001112233@s.whatsapp.net', fromMe: false, id: 'L2' }, message: { conversation: 'precio netflix' } });
ok(r[0]?.json.numero === '573001112233', 'formato anterior (senderPn) también');
r = correr({ key: { remoteJid: '573009998877@s.whatsapp.net', fromMe: false, id: 'L3' }, message: { conversation: 'hola' } });
ok(r[0]?.json.numero === '573009998877' && r[0].json.ruta === 'menu', 'formato clásico @s.whatsapp.net sigue igual ("hola" → menú)');
ok(correr({ key: { remoteJid: '999@lid', fromMe: false, id: 'L4' }, message: { conversation: 'hola' } }).length === 0, '@lid sin número real → se ignora (no hay a quién responder)');
ok(correr({ key: { remoteJid: '1203-1606830740@g.us', fromMe: false, id: 'L5' }, message: { conversation: 'hola grupo' } }).length === 0, 'grupos ignorados');
r = correr({ key: { remoteJid: '555@lid', remoteJidAlt: '573054004508@s.whatsapp.net', fromMe: false, id: 'L6' }, message: { imageMessage: { caption: '#pago DC-ABCDE', mimetype: 'image/jpeg' } } });
ok(r[0]?.json.origen === 'admin' && r[0].json.accion === 'pago', 'tu #pago desde un chat @lid se reconoce como admin');
r = correr({ key: { remoteJid: '777@lid', remoteJidAlt: '573005556677@s.whatsapp.net', fromMe: false, id: 'L7' }, message: { audioMessage: { ptt: true } } });
ok(r[0]?.json.ruta === 'sin_texto', 'audio → respuesta "solo leo texto"');
