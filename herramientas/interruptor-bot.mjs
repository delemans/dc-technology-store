// herramientas/interruptor-bot.mjs — Enciende o apaga las respuestas del bot a los clientes (Config bot → bot_responde).
//   node herramientas/interruptor-bot.mjs no    → el bot no le contesta a nadie (tus comandos #ok/#no/#entregar/#stock y ANC siguen)
//   node herramientas/interruptor-bot.mjs si    → vuelve a responder
//   node herramientas/interruptor-bot.mjs       → muestra cómo está
//   node herramientas/interruptor-bot.mjs medios si|no → lee audios (Whisper) y capturas (Llama Vision) con IA abierta (leer_medios)
// Solo cambia ese valor en el n8n en vivo (sincronizar-n8n no toca Config bot). Guarda un respaldo antes.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RAIZ, cargarEntorno, requerir } = require('./entorno.js');
const env = cargarEntorno();
requerir(env, ['N8N_URL', 'N8N_API_KEY']);
const N8N = env.N8N_URL.replace(/\/+$/, '');
const medios = (process.argv[2] ?? '').toLowerCase() === 'medios';
const CAMPO = medios ? 'leer_medios' : 'bot_responde';
const QUE = medios ? 'La lectura de audios e imágenes' : 'El bot';
const pedido = (process.argv[medios ? 3 : 2] ?? '').toLowerCase();
if (pedido && !['si', 'no'].includes(pedido)) { console.error('Uso: node herramientas/interruptor-bot.mjs [si|no] · medios [si|no]'); process.exit(1); }

const api = async (ruta, opciones = {}) => {
    const r = await fetch(`${N8N}/api/v1${ruta}`, { ...opciones, headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' } });
    const texto = await r.text();
    if (!r.ok) throw new Error(`${opciones.method ?? 'GET'} ${ruta} → HTTP ${r.status}: ${texto.slice(0, 200)}`);
    return texto ? JSON.parse(texto) : {};
};
const generado = JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'flujo_bot_dctechnology.json'), 'utf8'));
const lista = (await api('/workflows?limit=100')).data ?? [];
const marca = (n) => String(n).replace(/Technology/gi, 'Tecnology');
const resumen = lista.find((w) => marca(w.name) === marca(generado.name));
if (!resumen) throw new Error('No encuentro el flujo del bot en n8n.');
const vivo = await api(`/workflows/${resumen.id}`);
const config = vivo.nodes.find((n) => n.name === 'Config bot');
const asignaciones = config.parameters.assignments.assignments;
const actual = asignaciones.find((a) => a.name === CAMPO);
// bot_responde: encendido salvo "no" · leer_medios: apagado salvo "si"
const estado = medios ? (String(actual?.value ?? 'no').toLowerCase() === 'si' ? 'si' : 'no') : (String(actual?.value ?? 'si').toLowerCase() === 'no' ? 'no' : 'si');
if (!pedido) {
    const medio = String(asignaciones.find((a) => a.name === 'leer_medios')?.value ?? 'no').toLowerCase() === 'si';
    console.log(medios ? `${QUE} está ${estado === 'si' ? 'ENCENDIDA' : 'APAGADA'}.` : `El bot ${estado === 'no' ? 'está APAGADO (no responde a clientes)' : 'está ENCENDIDO'} · audios e imágenes: ${medio ? 'sí' : 'no'}.`);
    process.exit(0);
}
if (pedido === estado) { console.log(`Sin cambios: ${QUE.toLowerCase()} ya estaba así (${pedido}).`); process.exit(0); }

const carpeta = path.join(RAIZ, 'n8n', 'respaldos');
fs.mkdirSync(carpeta, { recursive: true });
fs.writeFileSync(path.join(carpeta, `${vivo.id}-${new Date().toISOString().replace(/[:.]/g, '-')}-interruptor.json`), JSON.stringify(vivo, null, 1));
if (actual) actual.value = pedido;
else asignaciones.push({ id: crypto.randomUUID(), name: CAMPO, value: pedido, type: 'string' });
const PERMITIDOS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];
await api(`/workflows/${vivo.id}`, { method: 'PUT', body: JSON.stringify({
    name: vivo.name, nodes: vivo.nodes, connections: vivo.connections,
    settings: Object.fromEntries(Object.entries(vivo.settings ?? {}).filter(([k]) => PERMITIDOS.includes(k))),
}) });
const despues = await api(`/workflows/${vivo.id}`);
const valor = despues.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.find((a) => a.name === CAMPO)?.value;
console.log(valor === pedido && medios ? `✔ ${QUE} quedó ${pedido === 'si' ? 'ENCENDIDA' : 'APAGADA'} · flujo ${despues.active ? 'activo' : 'INACTIVO'}` : valor === pedido
    ? `✔ El bot quedó ${pedido === 'no' ? 'APAGADO: no le responde a ningún cliente (tus comandos y ANC siguen funcionando)' : 'ENCENDIDO'} · flujo ${despues.active ? 'activo' : 'INACTIVO'}`
    : '⚠️ No se pudo confirmar el cambio: revisa Config bot en n8n.');
