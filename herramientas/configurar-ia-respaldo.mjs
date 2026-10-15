// herramientas/configurar-ia-respaldo.mjs — IA de respaldo en cadena: si SiliconFlow falla (sin crédito, caída),
// el mismo Agente IA responde con otra IA. Si las dos fallan, el bot ofrece el menú (que no usa IA).
//
//   1) En .env:  IA_RESPALDO_KEY=...        (clave del servicio de respaldo)
//                IA_RESPALDO_URL=...        (opcional; por defecto Google Gemini, nivel gratuito)
//                IA_RESPALDO_MODELO=...     (opcional; por defecto el modelo "flash" más nuevo que ofrezca el servicio)
//   2) node herramientas/configurar-ia-respaldo.mjs            → prueba la clave y el modelo (no cambia nada)
//      node herramientas/configurar-ia-respaldo.mjs --aplicar  → crea la credencial y conecta el respaldo al Agente IA
//
// Sirve cualquier servicio compatible con la API de OpenAI: Gemini (https://generativelanguage.googleapis.com/v1beta/openai),
// OpenRouter (https://openrouter.ai/api/v1), Groq (https://api.groq.com/openai/v1)… El Agente IA pasa a la versión 2.2
// de n8n, que trae "modelo de respaldo" (needsFallback). Respaldo del flujo en n8n/respaldos/ antes de escribir.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RAIZ, cargarEntorno, requerir, ocultar } = require('./entorno.js');
const APLICAR = process.argv.includes('--aplicar');
const env = cargarEntorno();
requerir(env, ['IA_RESPALDO_KEY']);
const CLAVE = env.IA_RESPALDO_KEY.trim();
const URL_IA = (env.IA_RESPALDO_URL || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, '');
export const NODO = 'IA de respaldo';
const H = { Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json' };
const pista = (e) => (/CERT|SELF_SIGNED/i.test(String(e.cause?.code ?? e.cause ?? e)) ? 'certificado (Kaspersky): ejecuta con NODE_EXTRA_CA_CERTS' : String(e.cause?.code ?? e.message));

console.log(`\n${APLICAR ? 'APLICAR' : 'PRUEBA (usa --aplicar para conectarla al bot)'} · ${URL_IA} · clave ${ocultar(CLAVE)}`);
// Prueba un modelo con una respuesta corta: sirve si responde texto (algunos "piensan" y devuelven vacío)
async function probarModelo(modelo) {
    const t = Date.now();
    const r = await fetch(`${URL_IA}/chat/completions`, { method: 'POST', headers: H, body: JSON.stringify({
        model: modelo, max_tokens: 40, messages: [{ role: 'system', content: 'Eres el asistente de DC TECHNOLOGY.' }, { role: 'user', content: 'Responde solo: listo' }],
    }) }).catch((e) => ({ ok: false, status: pista(e), json: async () => ({}) }));
    const j = await r.json().catch(() => ({}));
    const texto = String(j.choices?.[0]?.message?.content ?? '').trim();
    return { ok: r.ok && Boolean(texto), ms: Date.now() - t, texto, motivo: r.ok ? 'respuesta vacía' : `HTTP ${r.status} ${String(j.error?.message ?? j[0]?.error?.message ?? j.message ?? '').slice(0, 120)}` };
}
let modelo = env.IA_RESPALDO_MODELO?.trim();
let candidatos = modelo ? [modelo] : [];
if (!modelo) {
    try {
        const r = await fetch(`${URL_IA}/models`, { headers: H });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`HTTP ${r.status} ${String(j.error?.message ?? j.message ?? '').slice(0, 120)}`);
        const ids = (j.data ?? []).map((m) => String(m.id).replace(/^models\//, ''));
        // Rápidos y con nivel gratuito: primero los "flash-lite" estables más nuevos, luego los "flash"; sin imagen, audio ni vista previa
        const util = ids.filter((i) => /flash/i.test(i) && !/image|tts|audio|live|embed|omni|exp|thinking/i.test(i));
        const peso = (i) => (/lite/i.test(i) ? 0 : 1) + (/preview|latest/i.test(i) ? 2 : 0);
        candidatos = util.sort((a, b) => peso(a) - peso(b) || b.localeCompare(a, 'en', { numeric: true }));
        console.log(`  ✔ clave válida · ${ids.length} modelos · pruebo: ${candidatos.slice(0, 6).join(', ')}`);
    } catch (e) {
        console.log(`  ✘ no pude listar modelos: ${e.message ?? pista(e)}. Escribe IA_RESPALDO_MODELO en .env.`);
        process.exit(1);
    }
}
modelo = null;
for (const c of candidatos.slice(0, 8)) {
    const p = await probarModelo(c);
    console.log(`  ${p.ok ? '✔' : '✘'} ${c}: ${p.ok ? `responde «${p.texto.slice(0, 30)}» en ${p.ms} ms` : p.motivo}`);
    if (p.ok) { modelo = c; break; }
}
if (!modelo || !APLICAR) process.exit(modelo ? 0 : 1);

requerir(env, ['N8N_URL', 'N8N_API_KEY']);
const N8N = env.N8N_URL.replace(/\/+$/, '');
const api = async (ruta, opciones = {}) => {
    const r = await fetch(`${N8N}/api/v1${ruta}`, { ...opciones, headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' } });
    const texto = await r.text();
    if (!r.ok) throw new Error(`${opciones.method ?? 'GET'} ${ruta} → HTTP ${r.status}: ${texto.slice(0, 300)}`);
    return texto ? JSON.parse(texto) : {};
};
const nombreFlujo = JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'flujo_bot_dctechnology.json'), 'utf8')).name;
const resumen = (await api('/workflows?limit=100')).data.find((w) => w.name === nombreFlujo);
if (!resumen) throw new Error(`Tu n8n no tiene el flujo "${nombreFlujo}".`);
const vivo = await api(`/workflows/${resumen.id}`);
const agente = vivo.nodes.find((n) => n.name === 'Agente IA');
if (!agente) throw new Error('El flujo no tiene el nodo "Agente IA".');

let datos = { apiKey: CLAVE, url: URL_IA };
try {
    const esquema = await api('/credentials/schema/openAiApi');
    for (const campo of esquema.required ?? []) if (datos[campo] === undefined && esquema.properties?.[campo]?.default !== undefined) datos[campo] = esquema.properties[campo].default;
    if (esquema.additionalProperties === false) for (const k of Object.keys(datos)) if (!(k in (esquema.properties ?? {}))) delete datos[k];
} catch { /* sin esquema: se envía tal cual */ }
const nombreCred = `DC · IA respaldo ${new URL(URL_IA).hostname.split('.').slice(-2, -1)[0]} (${new Date().toISOString().slice(0, 10)})`;
const credencial = await api('/credentials', { method: 'POST', body: JSON.stringify({ name: nombreCred, type: 'openAiApi', data: datos }) });

const carpeta = path.join(RAIZ, 'n8n', 'respaldos');
fs.mkdirSync(carpeta, { recursive: true });
fs.writeFileSync(path.join(carpeta, `${vivo.id}-respaldo-ia-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(vivo, null, 2));

// Agente IA 2.2 con modelo de respaldo (misma pregunta, mismo sistema, misma memoria)
agente.typeVersion = 2.2;
agente.parameters = { promptType: 'define', text: agente.parameters.text, hasOutputParser: false, needsFallback: true,
    options: { ...(agente.parameters.options ?? {}) } };
const principal = vivo.nodes.find((n) => n.name === 'SiliconFlow · DeepSeek-V3');
let respaldo = vivo.nodes.find((n) => n.name === NODO);
if (!respaldo) {
    respaldo = { id: crypto.randomUUID(), name: NODO, type: '@n8n/n8n-nodes-langchain.lmChatOpenAi', typeVersion: principal?.typeVersion ?? 1.2,
        position: [(principal?.position?.[0] ?? 1480) - 200, (principal?.position?.[1] ?? 360) + 200], parameters: {} };
    vivo.nodes.push(respaldo);
}
respaldo.parameters = { model: { __rl: true, value: modelo, mode: 'id' }, options: { baseURL: URL_IA, temperature: 0.3, maxTokens: 500, timeout: 45000, maxRetries: 1 } };
respaldo.credentials = { openAiApi: { id: String(credencial.id), name: credencial.name ?? nombreCred } };
vivo.connections[NODO] = { ai_languageModel: [[{ node: 'Agente IA', type: 'ai_languageModel', index: 1 }]] };

const PERMITIDOS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];
await api(`/workflows/${vivo.id}`, { method: 'PUT', body: JSON.stringify({
    name: vivo.name, nodes: vivo.nodes, connections: vivo.connections,
    settings: Object.fromEntries(Object.entries(vivo.settings ?? {}).filter(([k]) => PERMITIDOS.includes(k))),
}) });
const despues = await api(`/workflows/${vivo.id}`);
const a = despues.nodes.find((n) => n.name === 'Agente IA');
console.log(`  ✔ "${NODO}" (${modelo}) conectado como respaldo del Agente IA · versión ${a.typeVersion} · fallback ${a.parameters.needsFallback} · flujo ${despues.active ? 'activo' : 'INACTIVO'}`);
console.log('\nOrden: SiliconFlow → respaldo → menú sin IA. Prueba: escríbele al bot una pregunta libre.');
