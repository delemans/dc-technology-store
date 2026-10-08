// herramientas/configurar-evolution.js — Registra en Evolution API el webhook que alimenta al bot de n8n.
//
//   Revisar (no cambia nada):   node herramientas/configurar-evolution.js
//   Aplicar:                    node herramientas/configurar-evolution.js --aplicar
//   Otra URL de webhook:        node herramientas/configurar-evolution.js --aplicar --url=https://tu-tunel/webhook/dc-whatsapp
//
// Lee EVOLUTION_URL, EVOLUTION_INSTANCIA y EVOLUTION_API_KEY de .env. Por defecto el webhook es
// N8N_URL + /webhook/dc-whatsapp con el evento MESSAGES_UPSERT (lo único que escucha el flujo).
// Funciona con Evolution API v2 (/webhook/set con { webhook: {...} }) y v1 (campos en la raíz).

const { cargarEntorno, requerir, ocultar } = require('./entorno');

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const env = cargarEntorno();
requerir(env, ['EVOLUTION_URL', 'EVOLUTION_INSTANCIA', 'EVOLUTION_API_KEY']);
const EVO = env.EVOLUTION_URL.replace(/\/+$/, '');
const INSTANCIA = encodeURIComponent(env.EVOLUTION_INSTANCIA);
const WEBHOOK = (args.find((a) => a.startsWith('--url='))?.slice(6) || `${(env.N8N_URL || 'http://localhost:5678').replace(/\/+$/, '')}/webhook/dc-whatsapp`).trim();
const EVENTOS = ['MESSAGES_UPSERT'];

async function api(metodo, ruta, cuerpo) {
    const r = await fetch(`${EVO}${ruta}`, {
        method: metodo,
        headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    const texto = await r.text();
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch { datos = texto; }
    return { ok: r.ok, status: r.status, datos };
}

// "localhost" significa "esta misma máquina": desde Docker o desde un servidor no llega a tu PC
function avisoDireccion() {
    const webhook = new URL(WEBHOOK);
    const evolution = new URL(EVO);
    const local = (h) => ['localhost', '127.0.0.1', '::1'].includes(h);
    if (!local(webhook.hostname)) return null;
    if (!local(evolution.hostname)) {
        return `Evolution está en ${evolution.hostname} y el webhook apunta a ${webhook.hostname}: desde ese servidor "localhost" es el propio servidor, nunca tu PC. Usa la URL pública de tu túnel: --url=https://TU-TUNEL/webhook/dc-whatsapp`;
    }
    return `El webhook apunta a localhost. Sirve si Evolution corre en este PC fuera de Docker. Si corre en Docker usa: --url=http://host.docker.internal:${webhook.port || 80}${webhook.pathname}`;
}

function resumir(w) {
    const x = w?.webhook ?? w ?? {};
    return { activo: x.enabled ?? x.enable ?? null, url: x.url ?? null, eventos: x.events ?? null };
}

(async () => {
    console.log(`\n${APLICAR ? 'APLICAR' : 'REVISIÓN (usa --aplicar para escribir)'} · Evolution ${EVO} · instancia ${env.EVOLUTION_INSTANCIA} · apikey ${ocultar(env.EVOLUTION_API_KEY)}`);
    console.log(`  webhook nuevo: ${WEBHOOK} · eventos ${EVENTOS.join(', ')}`);
    const aviso = avisoDireccion();
    if (aviso) console.log(`  ⚠ ${aviso}`);

    const actual = await api('GET', `/webhook/find/${INSTANCIA}`);
    if (actual.status === 401 || actual.status === 403) throw new Error('Evolution rechazó la API key (EVOLUTION_API_KEY).');
    if (actual.status === 404 && /instance/i.test(JSON.stringify(actual.datos ?? ''))) throw new Error(`No existe la instancia "${env.EVOLUTION_INSTANCIA}" en ${EVO}.`);
    console.log(`  webhook actual: ${actual.ok ? JSON.stringify(resumir(actual.datos)) : `no se pudo leer (HTTP ${actual.status})`}`);
    if (!APLICAR) return;

    // v2: { webhook: {...} } · v1: campos en la raíz. Se intenta v2 y, si la rechaza por formato, v1.
    const v2 = { webhook: { enabled: true, url: WEBHOOK, byEvents: false, base64: false, events: EVENTOS } };
    const v1 = { enabled: true, url: WEBHOOK, webhook_by_events: false, webhook_base64: false, events: EVENTOS };
    let r = await api('POST', `/webhook/set/${INSTANCIA}`, v2);
    if (!r.ok && r.status === 400) r = await api('POST', `/webhook/set/${INSTANCIA}`, v1);
    if (!r.ok) throw new Error(`Evolution no guardó el webhook (HTTP ${r.status}): ${JSON.stringify(r.datos).slice(0, 300)}`);

    const comprobado = resumir((await api('GET', `/webhook/find/${INSTANCIA}`)).datos);
    const bien = comprobado.url === WEBHOOK && (comprobado.eventos ?? []).includes('MESSAGES_UPSERT');
    console.log(`  ${bien ? '✔' : '⚠'} webhook ${bien ? 'registrado' : 'enviado, pero Evolution devuelve otra cosa'}: ${JSON.stringify(comprobado)}`);
    console.log('\nPrueba: escríbele al bot desde otro WhatsApp y mira en n8n → Executions (o Panel → Prueba del sistema → "Recibe los chats").');
})().catch((error) => {
    console.error(`\n✘ ${error.message}`);
    process.exitCode = 1;
});
