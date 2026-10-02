// herramientas/actualizar-modelo-llm.js — Reemplaza un modelo LLM deprecado en el repo y en los flujos de n8n.
//
//   Simulación (no cambia nada):  node herramientas/actualizar-modelo-llm.js
//   Aplicar:                      node herramientas/actualizar-modelo-llm.js --aplicar
//   Otros modelos:                --de "Qwen/Qwen2.5-Coder-32B-Instruct" --a "deepseek-ai/DeepSeek-V3"
//
// n8n (opcional): define N8N_URL (p. ej. https://n8n.tudominio.com) y N8N_API_KEY
// (n8n → Settings → n8n API → Create an API key). Sin ellas solo se revisa el repositorio.
// Antes de modificar un flujo se guarda una copia en n8n/respaldos/ (ignorado por git).

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
    const i = args.indexOf(nombre);
    return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};
const APLICAR = args.includes('--aplicar');
const DE = opcion('--de', 'Qwen/Qwen2.5-Coder-32B-Instruct');
const A = opcion('--a', 'deepseek-ai/DeepSeek-V3');
const RAIZ = path.resolve(__dirname, '..');
const IGNORAR = new Set(['.git', 'node_modules', 'respaldos']);
const EXTENSIONES = /\.(js|json|md|txt|html|yaml|yml|env|sql|py)$|^\.env/i;

const modo = APLICAR ? 'APLICAR' : 'SIMULACIÓN (usa --aplicar para escribir)';
console.log(`\n${modo}\n  De: ${DE}\n  A:  ${A}\n`);

/* ---------- 1) Repositorio ---------- */

function archivos(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        if (IGNORAR.has(e.name)) return [];
        const ruta = path.join(dir, e.name);
        if (e.isDirectory()) return archivos(ruta);
        return EXTENSIONES.test(e.name) && ruta !== __filename ? [ruta] : [];
    });
}

let enRepo = 0;
for (const ruta of archivos(RAIZ)) {
    const texto = fs.readFileSync(ruta, 'utf8');
    const veces = texto.split(DE).length - 1;
    if (!veces) continue;
    enRepo += veces;
    console.log(`  repo  ${path.relative(RAIZ, ruta)}: ${veces} coincidencia(s)`);
    if (APLICAR) fs.writeFileSync(ruta, texto.split(DE).join(A), 'utf8');
}
console.log(enRepo ? `Repositorio: ${enRepo} coincidencia(s)${APLICAR ? ' reemplazadas' : ''}.` : 'Repositorio: sin referencias al modelo anterior.');

/* ---------- 2) n8n por API ---------- */

// La API pública de n8n rechaza claves de 'settings' que no conoce: se envían solo estas
const SETTINGS_PERMITIDOS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
    'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];

async function n8n() {
    const url = (process.env.N8N_URL ?? '').replace(/\/+$/, '');
    const clave = process.env.N8N_API_KEY;
    if (!url || !clave) {
        console.log('n8n: omitido (define N8N_URL y N8N_API_KEY para revisar tus flujos).');
        return;
    }
    const api = async (ruta, opciones = {}) => {
        const r = await fetch(`${url}/api/v1${ruta}`, {
            ...opciones,
            headers: { 'X-N8N-API-KEY': clave, 'Content-Type': 'application/json', Accept: 'application/json' },
        });
        if (!r.ok) throw new Error(`${opciones.method ?? 'GET'} ${ruta} → HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
        return r.json();
    };

    // Lista paginada de flujos
    const flujos = [];
    let cursor = null;
    do {
        const pagina = await api(`/workflows?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        flujos.push(...(pagina.data ?? []));
        cursor = pagina.nextCursor;
    } while (cursor);

    let cambiados = 0;
    for (const resumen of flujos) {
        const flujo = await api(`/workflows/${resumen.id}`);
        const nodos = JSON.stringify(flujo.nodes ?? []);
        const veces = nodos.split(DE).length - 1;
        if (!veces) continue;
        console.log(`  n8n   "${flujo.name}" (${flujo.id}): ${veces} coincidencia(s)`);
        if (!APLICAR) continue;

        const carpeta = path.join(RAIZ, 'n8n', 'respaldos');
        fs.mkdirSync(carpeta, { recursive: true });
        const respaldo = path.join(carpeta, `${flujo.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(respaldo, JSON.stringify(flujo, null, 2), 'utf8');

        const settings = Object.fromEntries(Object.entries(flujo.settings ?? {}).filter(([k]) => SETTINGS_PERMITIDOS.includes(k)));
        await api(`/workflows/${flujo.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                name: flujo.name,
                nodes: JSON.parse(nodos.split(DE).join(A)),
                connections: flujo.connections,
                settings,
            }),
        });
        cambiados += 1;
        console.log(`        actualizado · respaldo: ${path.relative(RAIZ, respaldo)}`);
    }
    console.log(`n8n: ${flujos.length} flujo(s) revisado(s)${APLICAR ? `, ${cambiados} actualizado(s)` : ''}.`);
    if (APLICAR && cambiados) console.log('      Los flujos activos quedan activos; prueba una ejecución antes de confiar en el cambio.');
}

n8n().catch((error) => {
    console.error(`n8n: ${error.message}`);
    process.exitCode = 1;
});
