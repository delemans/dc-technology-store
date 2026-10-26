// "Revisar respuesta" ante una falla técnica de la IA y con la base de conocimiento en vivo
const flujo = require(process.argv[2]);
const codigo = flujo.nodes.find((n) => n.name === 'Revisar respuesta').parameters.jsCode;
const config = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const kbVivo = require(require('path').join(process.argv[2], '..', '..', 'bot-conocimiento.json'));
const memoria = {};
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const correr = (entrada, extra = {}) => {
    const datos = { 'Config bot': [{ ...config, numero_aviso_admin: '573054004508' }], 'Normalizar mensaje': [{ numero: '573125132325', texto: 'Hola' }], 'Base de conocimiento': [kbVivo], 'Reglas combo': [{}], 'Metodos de pago': [{}], ...extra };
    const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
    return new Function('$', '$input', '$getWorkflowStaticData', codigo)($, { first: () => ({ json: entrada }) }, () => memoria);
};
let r = correr({ error: 'Authorization failed - please check your credentials' });
ok(r.length === 2 && /elige una opción/.test(r[0].json.texto) && /1️⃣/.test(r[0].json.texto) && r[0].json.numero === '573125132325', 'cliente: recibe el menú principal con opciones (nunca se queda sin respuesta útil)');
ok(r[1].json.numero === '573054004508' && /Authorization failed/.test(r[1].json.texto) && /configurar-ias/.test(r[1].json.texto), 'tú: alerta con la causa exacta y qué revisar');
ok(!memoria.pausados || !memoria.pausados['573125132325'], 'el chat del cliente NO queda pausado');
r = correr({ error: 'Authorization failed' }, { 'Normalizar mensaje': [{ numero: '573009998877', texto: 'precio' }] });
ok(r.length === 1, 'segunda falla en menos de 30 min: el cliente recibe espera y no se te repite la alerta');
r = correr({ output: '¡Hola! Te saluda *DC TECHNOLOGY* 👋\n[PEDIDO_DIGITAL] {"producto":"Netflix Premium 4K","variante":"Pantalla Colombia 30 días","precio":1}' });
ok(r[0].json.pedido?.precio === kbVivo.catalogo.find((p) => p.id === 'netflix').variantes[0].precio, `precio tomado de la base de conocimiento EN VIVO ($${r[0].json.pedido?.precio})`);
const kbOtro = JSON.parse(JSON.stringify(kbVivo)); kbOtro.catalogo.find((p) => p.id === 'netflix').variantes[0].precio = 16000;
r = correr({ output: 'Listo\n[PEDIDO_DIGITAL] {"producto":"Netflix Premium 4K","variante":"Pantalla Colombia 30 días","precio":1}' }, { 'Base de conocimiento': [kbOtro] });
ok(r[0].json.pedido?.precio === 16000, 'si cambias el precio en el sitio, el bot lo usa sin reimportar el flujo');
r = correr({ output: '' }, { 'Base de conocimiento': [{}] });
ok(/asesor/i.test(r[0].json.texto), 'IA sin respuesta (no es falla técnica) → sigue pasando a un asesor como antes');
