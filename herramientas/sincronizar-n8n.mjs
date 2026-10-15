// herramientas/sincronizar-n8n.mjs — Lleva a tu n8n los cambios del flujo generado, sin reimportar ni tocar credenciales.
//
//   Revisar (no cambia nada):  node herramientas/sincronizar-n8n.mjs
//   Aplicar:                   node herramientas/sincronizar-n8n.mjs --aplicar
//
// Compara n8n/flujo_bot_dctechnology.json (generado) con el flujo activo de tu n8n (API: N8N_URL + N8N_API_KEY de .env):
//   1. Código: reemplaza el jsCode de los nodos Code que cambiaron.
//   2. Estructura: agrega los nodos nuevos que NO usan credenciales (Code, Switch, IF, Set…), actualiza los Switch/IF y
//      los Set que cambiaron (salvo Config bot) y deja las conexiones iguales a las del flujo generado.
//   3. Config bot: si un número (aviso, proveedor, WhatsApp de ANC) quedó sin el 57, se lo agrega.
// No toca credenciales, ni los demás valores de "Config bot", ni los nodos que solo existen en tu n8n. Si el flujo nuevo trae un nodo que
// necesita credenciales, lo avisa y no cambia la estructura: eso requiere importar el flujo (herramientas/configurar-n8n.js).
// Antes de escribir guarda un respaldo en n8n/respaldos/.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

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

// Nodos que se pueden agregar sin credenciales y nodos cuyas reglas se comparan (los ids internos de las reglas cambian
// en cada generación, por eso se comparan sin ellos)
const SIN_CREDENCIALES = ['n8n-nodes-base.code', 'n8n-nodes-base.switch', 'n8n-nodes-base.if', 'n8n-nodes-base.set', 'n8n-nodes-base.noOp', 'n8n-nodes-base.merge', 'n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.httpRequest'];
// Un nodo HTTP nuevo que usa una credencial (Supabase, Evolution) toma la MISMA credencial que ya usan tus otros nodos:
// solo se copia la referencia (id y nombre), nunca el secreto
const tipoCredencial = (n) => (n.parameters?.authentication === 'predefinedCredentialType' ? n.parameters.nodeCredentialType
    : n.parameters?.authentication === 'genericCredentialType' ? n.parameters.genericAuthType : null);
const credencialViva = (tipo) => (tipo ? vivo.nodes.find((x) => x.credentials?.[tipo])?.credentials[tipo] ?? null : null);
const CON_REGLAS = ['n8n-nodes-base.switch', 'n8n-nodes-base.if'];
const sinIds = (v) => JSON.stringify(v, (k, x) => (k === 'id' ? undefined : x));
const aristas = (conexiones) => Object.entries(conexiones ?? {}).flatMap(([desde, tipos]) => Object.entries(tipos ?? {})
    .flatMap(([tipo, salidas]) => (salidas ?? []).flatMap((s, i) => (s ?? []).map((c) => `${desde} [${tipo} ${i}] → ${c.node}`))));

const porNombre = new Map(vivo.nodes.map((n) => [n.name, n]));
const cambios = generado.nodes.filter((n) => n.type === 'n8n-nodes-base.code' && porNombre.has(n.name) && porNombre.get(n.name).parameters?.jsCode !== n.parameters.jsCode).map((n) => n.name);
const faltan = generado.nodes.filter((n) => !porNombre.has(n.name));
const agregables = faltan.filter((n) => SIN_CREDENCIALES.includes(n.type) && !n.credentials && (!tipoCredencial(n) || credencialViva(tipoCredencial(n))));
const conCredenciales = faltan.filter((n) => !agregables.includes(n));
const sobran = vivo.nodes.filter((n) => !generado.nodes.some((g) => g.name === n.name)).map((n) => n.name);
// Los nodos Set también se sincronizan (Config posventa copia de Config bot, los "Marcar …"), salvo Config bot: tus valores
const NO_TOCAR = ['Config bot'];
const sincronizable = (n) => CON_REGLAS.includes(n.type) || (n.type === 'n8n-nodes-base.set' && !NO_TOCAR.includes(n.name));
const reglas = generado.nodes.filter((n) => sincronizable(n) && porNombre.has(n.name) && sinIds(n.parameters) !== sinIds(porNombre.get(n.name).parameters)).map((n) => n.name);
// Config bot: un celular colombiano sin el 57 (3125132325) no coincide con el número real del chat (573125132325)
const configBot = porNombre.get('Config bot');
const sin57 = (configBot?.parameters?.assignments?.assignments ?? [])
    .filter((a) => ['numero_aviso_admin', 'numero_proveedor', 'anc_whatsapp'].includes(a.name) && /^3\d{9}$/.test(String(a.value ?? '').replace(/\D/g, '')));
const aristasVivo = new Set(aristas(vivo.connections));
const aristasGen = new Set(aristas(generado.connections));
const nuevas = [...aristasGen].filter((a) => !aristasVivo.has(a));
const quitadas = [...aristasVivo].filter((a) => !aristasGen.has(a));
// Una conexión que sale de (o llega a) un nodo que solo existe en tu n8n se perdería al copiar las del flujo generado
const tocaPropios = quitadas.filter((a) => sobran.some((s) => a.startsWith(`${s} [`) || a.endsWith(`→ ${s}`)));
const estructura = Boolean(agregables.length || reglas.length || nuevas.length || quitadas.length);
const puedeEstructura = !conCredenciales.length && !tocaPropios.length;

console.log(`\n${APLICAR ? 'APLICAR' : 'REVISIÓN (usa --aplicar para escribir)'} · ${N8N} · flujo "${vivo.name}" (${vivo.active ? 'activo' : 'INACTIVO'}, ${vivo.nodes.length} nodos)`);
console.log(`  nodos con código nuevo: ${cambios.length ? cambios.join(', ') : 'ninguno (ya está al día)'}`);
if (agregables.length) console.log(`  nodos nuevos que se agregan: ${agregables.map((n) => n.name + (tipoCredencial(n) ? ` (credencial ${credencialViva(tipoCredencial(n)).name})` : '')).join(', ')}`);
if (reglas.length) console.log(`  nodos Switch/IF/Set que cambian: ${reglas.join(', ')}`);
if (sin57.length) console.log(`  Config bot: números sin el 57 que se corrigen: ${sin57.map((a) => `${a.name} ${a.value} → 57${String(a.value).replace(/\D/g, '')}`).join(', ')}`);
if (nuevas.length) console.log(`  conexiones nuevas:\n    ${nuevas.join('\n    ')}`);
if (quitadas.length) console.log(`  conexiones que se quitan:\n    ${quitadas.join('\n    ')}`);
if (conCredenciales.length) console.log(`  ⚠ nodos nuevos con credenciales (requieren importar el flujo completo, no se tocan): ${conCredenciales.map((n) => n.name).join(', ')}`);
if (tocaPropios.length) console.log(`  ⚠ hay conexiones de nodos que solo existen en tu n8n: la estructura no se cambia\n    ${tocaPropios.join('\n    ')}`);
if (sobran.length) console.log(`  · tu n8n tiene nodos que el flujo nuevo no trae (no se tocan): ${sobran.join(', ')}`);
if (!APLICAR || (!cambios.length && !sin57.length && !(estructura && puedeEstructura))) process.exit(0);

const carpeta = path.join(RAIZ, 'n8n', 'respaldos');
fs.mkdirSync(carpeta, { recursive: true });
const respaldo = path.join(carpeta, `${vivo.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(respaldo, JSON.stringify(vivo, null, 2));
const delGenerado = (nombre) => generado.nodes.find((n) => n.name === nombre);
for (const nombre of cambios) porNombre.get(nombre).parameters.jsCode = delGenerado(nombre).parameters.jsCode;
for (const a of sin57) a.value = `57${String(a.value).replace(/\D/g, '')}`;
let nodos = vivo.nodes;
let conexiones = vivo.connections;
if (estructura && puedeEstructura) {
    const idsVivos = new Set(vivo.nodes.map((n) => n.id));
    nodos = [...vivo.nodes, ...agregables.map((n) => ({ ...n, id: idsVivos.has(n.id) ? crypto.randomUUID() : n.id,
        ...(tipoCredencial(n) ? { credentials: { [tipoCredencial(n)]: credencialViva(tipoCredencial(n)) } } : {}) }))];
    for (const nombre of reglas) porNombre.get(nombre).parameters = delGenerado(nombre).parameters;
    // Conexiones del flujo generado + las que salen de nodos propios de tu n8n (no hay: si las hubiera, no se llega aquí)
    conexiones = generado.connections;
}
const PERMITIDOS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];
await api(`/workflows/${vivo.id}`, { method: 'PUT', body: JSON.stringify({
    name: vivo.name, nodes: nodos, connections: conexiones,
    settings: Object.fromEntries(Object.entries(vivo.settings ?? {}).filter(([k]) => PERMITIDOS.includes(k))),
}) });
const despues = await api(`/workflows/${vivo.id}`);
const nombresDespues = new Set(despues.nodes.map((n) => n.name));
const aplicados = cambios.filter((nombre) => despues.nodes.find((n) => n.name === nombre)?.parameters?.jsCode === delGenerado(nombre).parameters.jsCode);
const faltanDespues = generado.nodes.filter((n) => !nombresDespues.has(n.name) && !conCredenciales.includes(n)).map((n) => n.name);
const conexionesIguales = [...aristasGen].every((a) => new Set(aristas(despues.connections)).has(a));
console.log(`  ✔ código: ${aplicados.length} de ${cambios.length} nodos · nodos agregados: ${agregables.length - faltanDespues.length} · conexiones ${conexionesIguales || !estructura ? 'al día' : 'INCOMPLETAS'} · flujo ${despues.active ? 'activo' : 'INACTIVO'}`);
console.log(`  respaldo: ${path.relative(RAIZ, respaldo)}`);
if (aplicados.length !== cambios.length || faltanDespues.length || (estructura && !conexionesIguales)) process.exitCode = 1;
