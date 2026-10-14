// herramientas/configurar-ia.mjs — Conecta la clave de SiliconFlow (la IA del bot) a tu n8n, sin abrir n8n.
//
//   1) Pega tu clave en .env → SILICONFLOW_API_KEY=sk-...   (créala en cloud.siliconflow.com o cloud.siliconflow.cn)
//   2) node herramientas/configurar-ia.mjs            → solo prueba la clave (no cambia nada)
//      node herramientas/configurar-ia.mjs --aplicar  → crea la credencial y la asigna a los nodos de IA del flujo
//
// Prueba la clave en los dos servidores de SiliconFlow (.com internacional y .cn China): una clave solo sirve en el
// sitio donde se creó. Muestra el saldo. Con --aplicar crea la credencial "DC · SiliconFlow (<fecha>)" en n8n, la
// asigna a los nodos de IA y fija la dirección que funcionó. Respaldo del flujo en n8n/respaldos/ antes de escribir.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RAIZ, cargarEntorno, requerir, ocultar } = require('./entorno.js');
const APLICAR = process.argv.includes('--aplicar');
const env = cargarEntorno();
requerir(env, ['SILICONFLOW_API_KEY']);
const CLAVE = env.SILICONFLOW_API_KEY.trim();
const SERVIDORES = ['https://api.siliconflow.com/v1', 'https://api.siliconflow.cn/v1'];
const MODELO = 'deepseek-ai/DeepSeek-V3';

async function probar(base) {
    try {
        const r = await fetch(`${base}/user/info`, { headers: { Authorization: `Bearer ${CLAVE}` } });
        const j = await r.json().catch(() => ({}));
        if (r.ok) return { ok: true, saldo: j.data?.totalBalance ?? j.data?.balance ?? null, moneda: base.endsWith('.cn/v1') ? 'CNY' : 'USD' };
        return { ok: false, motivo: `HTTP ${r.status} ${String(j.message ?? '').slice(0, 80)}` };
    } catch (e) {
        return { ok: false, motivo: /certificate|SELF_SIGNED/i.test(String(e.cause ?? e)) ? 'certificado (Kaspersky): ejecuta con NODE_EXTRA_CA_CERTS' : String(e.cause?.code ?? e.message) };
    }
}

console.log(`\n${APLICAR ? 'APLICAR' : 'PRUEBA (usa --aplicar para conectarla al bot)'} · clave ${ocultar(CLAVE)}`);
let servidor = null;
for (const base of SERVIDORES) {
    const r = await probar(base);
    console.log(`  ${r.ok ? '✔' : '✘'} ${base}: ${r.ok ? `clave válida · saldo ${r.saldo ?? '?'} ${r.moneda}` : r.motivo}`);
    if (r.ok && !servidor) servidor = { base, ...r };
}
if (!servidor) {
    console.log('\n✘ La clave no sirve en ningún servidor. Crea una nueva en el sitio donde tienes la cuenta (API Keys) y pégala en .env.');
    process.exit(1);
}
if (Number(servidor.saldo) <= 0) console.log('  ⚠ El saldo es 0: recarga la cuenta o la IA dejará de responder.');
// Prueba real: una respuesta corta del mismo modelo que usa el bot
const prueba = await fetch(`${servidor.base}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${CLAVE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELO, max_tokens: 12, messages: [{ role: 'user', content: 'Responde solo: listo' }] }),
});
const respuesta = await prueba.json().catch(() => ({}));
console.log(`  ${prueba.ok ? '✔' : '✘'} ${MODELO}: ${prueba.ok ? `responde «${String(respuesta.choices?.[0]?.message?.content ?? '').trim().slice(0, 40)}»` : `HTTP ${prueba.status} ${String(respuesta.message ?? '').slice(0, 100)}`}`);
if (!prueba.ok || !APLICAR) process.exit(prueba.ok ? 0 : 1);

// --- Conectar al flujo de n8n ---
requerir(env, ['N8N_URL', 'N8N_API_KEY']);
const N8N = env.N8N_URL.replace(/\/+$/, '');
const api = async (ruta, opciones = {}) => {
    const r = await fetch(`${N8N}/api/v1${ruta}`, { ...opciones, headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' } });
    const t = await r.text();
    if (!r.ok) throw new Error(`${opciones.method ?? 'GET'} ${ruta} → HTTP ${r.status}: ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : {};
};
const nombreFlujo = JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'flujo_bot_dctechnology.json'), 'utf8')).name;
const resumen = (await api('/workflows?limit=100')).data.find((w) => w.name === nombreFlujo);
if (!resumen) throw new Error(`Tu n8n no tiene el flujo "${nombreFlujo}".`);
const vivo = await api(`/workflows/${resumen.id}`);

// Credencial nueva (los campos exactos dependen de la versión de n8n: se completan con su esquema)
let datos = { apiKey: CLAVE, url: servidor.base };
try {
    const esquema = await api('/credentials/schema/openAiApi');
    for (const campo of esquema.required ?? []) if (datos[campo] === undefined && esquema.properties?.[campo]?.default !== undefined) datos[campo] = esquema.properties[campo].default;
    if (esquema.additionalProperties === false) for (const k of Object.keys(datos)) if (!(k in (esquema.properties ?? {}))) delete datos[k];
} catch { /* sin esquema: se envía tal cual */ }
const nombre = `DC · SiliconFlow (${new Date().toISOString().slice(0, 10)})`;
const credencial = await api('/credentials', { method: 'POST', body: JSON.stringify({ name: nombre, type: 'openAiApi', data: datos }) });

const carpeta = path.join(RAIZ, 'n8n', 'respaldos');
fs.mkdirSync(carpeta, { recursive: true });
fs.writeFileSync(path.join(carpeta, `${vivo.id}-ia-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(vivo, null, 2));
const nodosIa = vivo.nodes.filter((n) => n.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi');
for (const n of nodosIa) {
    n.credentials = { openAiApi: { id: String(credencial.id), name: credencial.name ?? nombre } };
    n.parameters.options = { ...(n.parameters.options ?? {}), baseURL: servidor.base };
}
const PERMITIDOS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];
await api(`/workflows/${vivo.id}`, { method: 'PUT', body: JSON.stringify({
    name: vivo.name, nodes: vivo.nodes, connections: vivo.connections,
    settings: Object.fromEntries(Object.entries(vivo.settings ?? {}).filter(([k]) => PERMITIDOS.includes(k))),
}) });
console.log(`  ✔ credencial "${nombre}" creada y asignada a ${nodosIa.length} nodos de IA (${nodosIa.map((n) => n.name).join(', ')}) · servidor ${servidor.base}`);
console.log('\nPrueba: escríbele "Hola" al bot desde otro WhatsApp.');
