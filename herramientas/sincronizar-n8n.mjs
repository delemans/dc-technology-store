// herramientas/sincronizar-n8n.mjs — Lleva a tu n8n el CÓDIGO nuevo de los nodos del flujo, sin reimportar.
//
//   Revisar (no cambia nada):  node herramientas/sincronizar-n8n.mjs
//   Aplicar:                   node herramientas/sincronizar-n8n.mjs --aplicar
//
// Compara n8n/flujo_bot_dctechnology.json (generado) con el flujo activo de tu n8n (API: N8N_URL + N8N_API_KEY de .env)
// y reemplaza SOLO el código de los nodos Code que cambiaron. No toca credenciales, ni Config bot, ni otros nodos.
// Antes de escribir guarda un respaldo en n8n/respaldos/. Si el flujo generado tiene nodos que tu n8n no tiene
// (o al revés), lo avisa: eso sí requiere importar el flujo completo (herramientas/configurar-n8n.js).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { RAIZ, cargarEntorno, requerir } = require('./entorno.js');
const APLICAR = process.argv.includes('--aplicar');
const env = cargarEntorno();
requerir(env, ['N8N_URL', 'N8N_API_KEY']);
const N8N = env.N8N_URL.replace(/\/+$/, '');
const generado = JSON.parse(fs.readFileSync(path.join(RAIZ, 'n8n', 'flujo_bot_dctechnology.json'), 'utf8'));

async function api(ruta, opciones = {}) {
    const r = await fetch(`${N8N}/api/v1${ruta}`, { ...opciones, headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' } });
    const texto = await r.text();
    if (!r.ok) throw new Error(`${opciones.method ?? 'GET'} ${ruta} → HTTP ${r.status}${r.status === 401 ? ' (la API key no es de este n8n)' : ''}: ${texto.slice(0, 300)}`);
    return texto ? JSON.parse(texto) : {};
}

const lista = [];
let cursor = null;
do {
    const pagina = await api(`/workflows?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    lista.push(...(pagina.data ?? []));
    cursor = pagina.nextCursor;
} while (cursor);
const resumen = lista.find((w) => w.name === generado.name);
if (!resumen) throw new Error(`Tu n8n no tiene el flujo "${generado.name}": impórtalo con herramientas/configurar-n8n.js.`);
const vivo = await api(`/workflows/${resumen.id}`);

const porNombre = new Map(vivo.nodes.map((n) => [n.name, n]));
const cambios = [];
for (const n of generado.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    const actual = porNombre.get(n.name);
    if (actual && actual.parameters?.jsCode !== n.parameters.jsCode) cambios.push(n.name);
}
const faltan = generado.nodes.filter((n) => !porNombre.has(n.name)).map((n) => n.name);
const sobran = vivo.nodes.filter((n) => !generado.nodes.some((g) => g.name === n.name)).map((n) => n.name);

console.log(`\n${APLICAR ? 'APLICAR' : 'REVISIÓN (usa --aplicar para escribir)'} · ${N8N} · flujo "${vivo.name}" (${vivo.active ? 'activo' : 'INACTIVO'}, ${vivo.nodes.length} nodos)`);
console.log(`  nodos con código nuevo: ${cambios.length ? cambios.join(', ') : 'ninguno (ya está al día)'}`);
if (faltan.length) console.log(`  ⚠ el flujo nuevo trae nodos que tu n8n no tiene: ${faltan.join(', ')} → requieren importar el flujo completo`);
if (sobran.length) console.log(`  · tu n8n tiene nodos que el flujo nuevo no trae (no se tocan): ${sobran.join(', ')}`);
if (!APLICAR || !cambios.length) process.exit(0);

const carpeta = path.join(RAIZ, 'n8n', 'respaldos');
fs.mkdirSync(carpeta, { recursive: true });
const respaldo = path.join(carpeta, `${vivo.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(respaldo, JSON.stringify(vivo, null, 2));
for (const nombre of cambios) porNombre.get(nombre).parameters.jsCode = generado.nodes.find((n) => n.name === nombre).parameters.jsCode;
const PERMITIDOS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];
await api(`/workflows/${vivo.id}`, { method: 'PUT', body: JSON.stringify({
    name: vivo.name, nodes: vivo.nodes, connections: vivo.connections,
    settings: Object.fromEntries(Object.entries(vivo.settings ?? {}).filter(([k]) => PERMITIDOS.includes(k))),
}) });
const despues = await api(`/workflows/${vivo.id}`);
const aplicados = cambios.filter((nombre) => despues.nodes.find((n) => n.name === nombre)?.parameters?.jsCode === generado.nodes.find((n) => n.name === nombre).parameters.jsCode);
console.log(`  ✔ ${aplicados.length} de ${cambios.length} nodos actualizados · flujo ${despues.active ? 'activo' : 'INACTIVO'} · respaldo: ${path.relative(RAIZ, respaldo)}`);
if (fileURLToPath(import.meta.url) && aplicados.length !== cambios.length) process.exitCode = 1;
