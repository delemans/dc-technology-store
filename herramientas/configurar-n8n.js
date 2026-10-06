// herramientas/configurar-n8n.js — Sube el flujo a n8n con sus credenciales y su configuración, sin la interfaz.
//
//   Revisar (no cambia nada):  node herramientas/configurar-n8n.js
//   Aplicar:                   node herramientas/configurar-n8n.js --aplicar
//   Aplicar y activar:         node herramientas/configurar-n8n.js --aplicar --activar
//   Volver a crear credenciales (si las borraste en n8n): --recrear-credenciales
//
// Qué hace, por la API pública de n8n (N8N_URL + N8N_API_KEY):
//   1. Crea 3 credenciales: Supabase (service_role), Header Auth de Evolution y OpenAI (SiliconFlow).
//      Sus IDs se guardan en herramientas/.n8n-credenciales.json (ignorado por git) para no duplicarlas.
//   2. Las asigna a TODOS los nodos que las necesitan (Supabase, Evolution, SiliconFlow; incluidos los de
//      compra en ANC y latidos) y llena "Config bot" / "Config posventa" (Evolution, números, compra en ANC).
//   3. Crea el flujo o, si ya existe con el mismo nombre, lo actualiza (con respaldo en n8n/respaldos/).
// Los valores salen de .env (ver .env.ejemplo). Ningún secreto se escribe en el repositorio.

const fs = require('fs');
const path = require('path');
const { RAIZ, cargarEntorno, requerir, ocultar } = require('./entorno');

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const ACTIVAR = args.includes('--activar');
const RECREAR = args.includes('--recrear-credenciales');
const ARCHIVO_FLUJO = path.join(RAIZ, 'n8n', 'flujo_bot_dctechnology.json');
const CACHE = path.join(__dirname, '.n8n-credenciales.json');

const env = cargarEntorno();
requerir(env, ['N8N_URL', 'N8N_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'EVOLUTION_URL', 'EVOLUTION_INSTANCIA', 'EVOLUTION_API_KEY', 'SILICONFLOW_API_KEY']);
const BASE_LLM = env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1';
const N8N = env.N8N_URL.replace(/\/+$/, '');

async function api(ruta, opciones = {}) {
    const r = await fetch(`${N8N}/api/v1${ruta}`, {
        ...opciones,
        headers: { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    const texto = await r.text();
    if (!r.ok) {
        const pista = r.status === 401 ? ' (API key de n8n inválida)' : r.status === 404 ? ' (¿n8n sin API pública? revisa N8N_URL)' : '';
        throw new Error(`${opciones.method ?? 'GET'} ${ruta} → HTTP ${r.status}${pista}: ${texto.slice(0, 400)}`);
    }
    return texto ? JSON.parse(texto) : {};
}

// Credenciales: tipo de n8n → nombre visible y datos (los nombres de campo son los del esquema de n8n)
const CREDENCIALES = {
    supabaseApi: { name: 'DC · Supabase (service_role)', data: { host: env.SUPABASE_URL, serviceRole: env.SUPABASE_SERVICE_ROLE_KEY } },
    httpHeaderAuth: { name: 'DC · Evolution API', data: { name: 'apikey', value: env.EVOLUTION_API_KEY } },
    openAiApi: { name: 'DC · SiliconFlow', data: { apiKey: env.SILICONFLOW_API_KEY, url: BASE_LLM } },
};

// Completa campos obligatorios que la versión de n8n exija y no estén (con el valor por defecto del esquema)
async function completarConEsquema(tipo, data) {
    try {
        const esquema = await api(`/credentials/schema/${tipo}`);
        const props = esquema.properties ?? {};
        const completo = { ...data };
        for (const campo of esquema.required ?? []) {
            if (completo[campo] === undefined && props[campo]?.default !== undefined) completo[campo] = props[campo].default;
        }
        // Campos que esta versión no conoce (p. ej. 'url' en n8n antiguos) se quitan para no fallar la validación
        if (esquema.additionalProperties === false) for (const k of Object.keys(completo)) if (!(k in props)) delete completo[k];
        return completo;
    } catch {
        return data; // si el esquema no está disponible, se intenta tal cual
    }
}

async function asegurarCredenciales() {
    const cache = !RECREAR && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
    const ids = {};
    for (const [tipo, { name, data }] of Object.entries(CREDENCIALES)) {
        if (cache[tipo]?.id) {
            ids[tipo] = cache[tipo];
            console.log(`  credencial ${tipo}: ya creada (${cache[tipo].id})`);
            continue;
        }
        const resumen = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, /key|role|value/i.test(k) ? ocultar(v) : v]));
        console.log(`  credencial ${tipo}: ${APLICAR ? 'creando' : 'se crearía'} "${name}" ${JSON.stringify(resumen)}`);
        if (!APLICAR) continue;
        const creada = await api('/credentials', { method: 'POST', body: JSON.stringify({ name, type: tipo, data: await completarConEsquema(tipo, data) }) });
        ids[tipo] = { id: String(creada.id), name: creada.name ?? name };
    }
    if (APLICAR) fs.writeFileSync(CACHE, JSON.stringify(ids, null, 2), 'utf8');
    return ids;
}

// Asigna credenciales y configuración a los nodos del flujo generado
function prepararFlujo(flujo, ids) {
    let asignadas = 0;
    for (const nodo of flujo.nodes) {
        const p = nodo.parameters ?? {};
        let tipo = null;
        if (nodo.type === 'n8n-nodes-base.httpRequest' && p.nodeCredentialType === 'supabaseApi') tipo = 'supabaseApi';
        if (nodo.type === 'n8n-nodes-base.httpRequest' && p.genericAuthType === 'httpHeaderAuth') tipo = 'httpHeaderAuth';
        if (nodo.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi') {
            tipo = 'openAiApi';
            p.options = { ...(p.options ?? {}), baseURL: BASE_LLM };
        }
        if (tipo && ids[tipo]) {
            nodo.credentials = { [tipo]: { id: ids[tipo].id, name: ids[tipo].name } };
            asignadas += 1;
        }
        if (nodo.type === 'n8n-nodes-base.set' && /^Config /.test(nodo.name)) {
            const valores = {
                supabase_url: env.SUPABASE_URL,
                evolution_url: env.EVOLUTION_URL.replace(/\/+$/, ''),
                evolution_instancia: env.EVOLUTION_INSTANCIA,
                // 3001234567 → 573001234567 (WhatsApp necesita el indicativo)
                numero_aviso_admin: (env.NUMERO_AVISO_ADMIN || '').replace(/\D/g, '').replace(/^(3\d{9})$/, '57$1'),
                // WhatsApp del proveedor (ALL NECESSARY COLOMBIA): activa la triangulación de productos digitales
                numero_proveedor: (env.NUMERO_PROVEEDOR || '').replace(/\D/g, '').replace(/^(3\d{9})$/, '57$1'),
                // Compra al proveedor (WO-035): web = ancpagos.com · whatsapp = por chat con NUMERO_PROVEEDOR
                canal_compra: (env.CANAL_COMPRA || 'web').trim().toLowerCase() === 'whatsapp' ? 'whatsapp' : 'web',
                anc_correo: (env.ANC_CORREO || '').trim(),
                anc_metodo: (env.ANC_METODO || 'nequi').trim(),
                anc_whatsapp: (env.ANC_WHATSAPP || '').replace(/\D/g, '').replace(/^(3\d{9})$/, '57$1'),
            };
            // Vacío en .env = se deja lo que trae el flujo (p. ej. anc_whatsapp vacío usa tu número de aviso)
            for (const k of Object.keys(valores)) if (valores[k] === '' && !['numero_proveedor', 'numero_aviso_admin'].includes(k)) delete valores[k];
            for (const a of p.assignments?.assignments ?? []) if (a.name in valores) a.value = valores[a.name];
        }
    }
    return asignadas;
}

const SETTINGS_PERMITIDOS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
    'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];

(async () => {
    console.log(`\n${APLICAR ? 'APLICAR' : 'REVISIÓN (usa --aplicar para escribir)'} · n8n ${N8N}`);
    const flujo = JSON.parse(fs.readFileSync(ARCHIVO_FLUJO, 'utf8'));

    const ids = await asegurarCredenciales();
    const asignadas = prepararFlujo(flujo, ids);
    const necesitan = flujo.nodes.filter((n) => n.parameters?.nodeCredentialType === 'supabaseApi'
        || n.parameters?.genericAuthType === 'httpHeaderAuth' || n.type === '@n8n/n8n-nodes-langchain.lmChatOpenAi').length;
    console.log(`  nodos con credencial: ${APLICAR ? asignadas : necesitan} de ${necesitan}`);
    if (APLICAR && asignadas !== necesitan) throw new Error(`Quedaron ${necesitan - asignadas} nodo(s) sin credencial: no se sube un flujo a medias.`);
    if (!env.ANC_CORREO && (env.CANAL_COMPRA || 'web') !== 'whatsapp') console.log('  ⚠ ANC_CORREO vacío en .env: el bot no comprará en ANC hasta que lo llenes (o lo pongas a mano en Config bot).');

    // ¿Ya existe el flujo? (por nombre)
    const existentes = [];
    let cursor = null;
    do {
        const pagina = await api(`/workflows?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        existentes.push(...(pagina.data ?? []));
        cursor = pagina.nextCursor;
    } while (cursor);
    const actual = existentes.find((w) => w.name === flujo.name);
    console.log(`  flujo "${flujo.name}": ${actual ? `existe (${actual.id}${actual.active ? ', activo' : ''}) → se actualiza` : 'no existe → se crea'}`);
    if (!APLICAR) return;

    const cuerpo = {
        name: flujo.name,
        nodes: flujo.nodes,
        connections: flujo.connections,
        settings: Object.fromEntries(Object.entries(flujo.settings ?? {}).filter(([k]) => SETTINGS_PERMITIDOS.includes(k))),
    };
    let id;
    if (actual) {
        const anterior = await api(`/workflows/${actual.id}`);
        const carpeta = path.join(RAIZ, 'n8n', 'respaldos');
        fs.mkdirSync(carpeta, { recursive: true });
        fs.writeFileSync(path.join(carpeta, `${actual.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(anterior, null, 2));
        await api(`/workflows/${actual.id}`, { method: 'PUT', body: JSON.stringify(cuerpo) });
        id = actual.id;
        console.log('  ✔ flujo actualizado (respaldo del anterior en n8n/respaldos/)');
    } else {
        id = (await api('/workflows', { method: 'POST', body: JSON.stringify(cuerpo) })).id;
        console.log(`  ✔ flujo creado (${id})`);
    }
    if (ACTIVAR) {
        await api(`/workflows/${id}/activate`, { method: 'POST' });
        console.log('  ✔ flujo activado');
    }
    console.log(`\nWebhook para Evolution API (evento MESSAGES_UPSERT): ${N8N}/webhook/dc-whatsapp`);
})().catch((error) => {
    console.error(`\n✘ ${error.message}`);
    process.exitCode = 1;
});
