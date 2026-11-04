// herramientas/northflank.mjs — Monta el bot (n8n + Evolution) en Northflank (plan gratis «Sandbox», sin tarjeta) por su API.
//
//   node herramientas/northflank.mjs --revisar   → valida NORTHFLANK_TOKEN, muestra planes, regiones y lo que ya existe (no cambia nada)
//   node herramientas/northflank.mjs --crear     → proyecto «dc-bot»: base Postgres (n8n), servicio «evolution» (APAGADO) y «n8n»
//   node herramientas/northflank.mjs --mudar     → con Evolution del PC cerrado: enciende Evolution en la nube y le apunta el webhook a n8n
//   node herramientas/northflank.mjs --estado    → cómo están los servicios y sus direcciones
//
// Diseño (04/11/2026):
//   · Evolution usa la MISMA base de Neon que el PC (DATABASE_CONNECTION_URI de C:\evolution-api\…\.env): la sesión de WhatsApp
//     sigue sin QR. Por eso se crea con 0 instancias: dos Evolution con la misma sesión se pisan. --mudar lo enciende solo si
//     el del PC ya no responde.
//   · Imagen de Evolution con el parche @bot: ghcr.io/delemans/dc-evolution (la construye .github/workflows/imagen-evolution.yml).
//   · n8n 2.43.8 oficial con la base Postgres de Northflank (el único complemento gratis).
//   · n8n y Evolution se hablan por la red privada del proyecto (http://evolution:8080 y http://n8n:5678).
// Secretos: solo .env (NORTHFLANK_TOKEN; N8N_NUBE_ENCRYPTION_KEY se genera y se guarda ahí). Nunca se imprimen.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { RAIZ, cargarEntorno } = require('./entorno.js');
const env = cargarEntorno();
const args = process.argv.slice(2);
const API = 'https://api.northflank.com';
const PROYECTO = 'dc-bot';
const IMAGEN_EVOLUTION = env.NF_IMAGEN_EVOLUTION || 'ghcr.io/delemans/dc-evolution:2.3.7-dc1';
const IMAGEN_N8N = env.NF_IMAGEN_N8N || 'n8nio/n8n:2.43.8';
const EVOLUTION_LOCAL_ENV = env.EVOLUTION_ENV_LOCAL || 'C:/evolution-api/evolution-api-main/.env';
const SALIDA = path.join(RAIZ, 'herramientas', 'salida', 'northflank.json');

export async function nf(ruta, { method = 'GET', body, token = env.NORTHFLANK_TOKEN, f = fetch } = {}) {
    const r = await f(`${API}${ruta}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
    const texto = await r.text();
    let j = {}; try { j = JSON.parse(texto); } catch { /* respuesta vacía */ }
    if (!r.ok) throw new Error(`${method} ${ruta} → ${r.status}: ${j.error?.message ?? texto.slice(0, 200)}${j.error?.details ? ` ${JSON.stringify(j.error.details).slice(0, 300)}` : ''}`);
    return j.data ?? j;
}

// Planes: el más pequeño que cumpla la memoria pedida (se puede forzar con NF_PLAN_N8N / NF_PLAN_EVO / NF_PLAN_DB)
export function elegirPlan(planes, ramMinima, forzado) {
    if (forzado) return planes.find((p) => p.id === forzado) ?? { id: forzado };
    return [...planes].filter((p) => p.ramResource >= ramMinima).sort((a, b) => a.amountPerMonth - b.amountPerMonth || a.ramResource - b.ramResource)[0];
}

// Variables del Evolution del PC que se copian a la nube (sin lo que es propio del PC: dirección, SSL, Redis, proxy)
export function variablesEvolution(textoEnv) {
    const fuera = /^(SERVER_URL|SERVER_PORT|SERVER_TYPE|SSL_CONF_|CACHE_REDIS_|PROXY_|SENTRY_DSN|PROMETHEUS_|METRICS_)/;
    const v = {};
    for (const linea of textoEnv.split(/\r?\n/)) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(linea);
        if (!m || fuera.test(m[1])) continue;
        const valor = m[2].replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2');
        if (valor !== '') v[m[1]] = valor;
    }
    return v;
}

// Conexión a la base del complemento (los nombres de los campos dependen del tipo de base)
export function conexionPostgres(cred) {
    const todos = { ...(cred.secrets ?? {}), ...(cred.envs ?? {}) };
    const uris = Object.entries(todos).filter(([, x]) => /^postgres(ql)?:\/\//.test(String(x)));
    const uri = (uris.find(([k]) => !/EXTERNAL|ADMIN/i.test(k)) ?? uris[0])?.[1];
    if (!uri) return null;
    const u = new URL(uri);
    return { host: u.hostname, port: u.port || '5432', database: u.pathname.replace(/^\//, '') || 'postgres', user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}

export function variablesN8n({ dominio, db, clave, ram }) {
    return {
        DB_TYPE: 'postgresdb', DB_POSTGRESDB_HOST: db.host, DB_POSTGRESDB_PORT: String(db.port), DB_POSTGRESDB_DATABASE: db.database,
        DB_POSTGRESDB_USER: db.user, DB_POSTGRESDB_PASSWORD: db.password,
        N8N_ENCRYPTION_KEY: clave, N8N_PORT: '5678', N8N_PROTOCOL: 'https', N8N_HOST: dominio ?? 'localhost', WEBHOOK_URL: dominio ? `https://${dominio}/` : '',
        N8N_PROXY_HOPS: '1', GENERIC_TIMEZONE: 'America/Bogota', TZ: 'America/Bogota',
        EXECUTIONS_DATA_PRUNE: 'true', EXECUTIONS_DATA_MAX_AGE: '168', EXECUTIONS_DATA_PRUNE_MAX_COUNT: '5000',
        N8N_DIAGNOSTICS_ENABLED: 'false', N8N_VERSION_NOTIFICATIONS_ENABLED: 'false', N8N_PERSONALIZATION_ENABLED: 'false',
        NODE_OPTIONS: `--max-old-space-size=${Math.max(256, Math.floor((ram ?? 1024) * 0.75))}`,
    };
}

function guardarEnv(cambios) {
    const ruta = path.join(RAIZ, '.env');
    let texto = fs.existsSync(ruta) ? fs.readFileSync(ruta, 'utf8') : '';
    for (const [k, v] of Object.entries(cambios)) {
        const re = new RegExp(`^${k}=.*$`, 'm');
        texto = re.test(texto) ? texto.replace(re, `${k}=${v}`) : `${texto.replace(/\s*$/, '')}\n${k}=${v}\n`;
    }
    fs.writeFileSync(ruta, texto);
}

const leerSalida = () => { try { return JSON.parse(fs.readFileSync(SALIDA, 'utf8')); } catch { return {}; } };
const escribirSalida = (x) => { fs.mkdirSync(path.dirname(SALIDA), { recursive: true }); fs.writeFileSync(SALIDA, JSON.stringify({ ...leerSalida(), ...x, actualizado: new Date().toISOString() }, null, 1)); };
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
const dnsDe = async (p, s) => (await nf(`/v1/projects/${p}/services/${s}/ports`)).ports?.find((x) => x.dns)?.dns ?? null;

async function proyecto(region) {
    const { projects = [] } = await nf('/v1/projects');
    const ya = projects.find((p) => p.id === PROYECTO || p.name === PROYECTO);
    if (ya) return ya.id;
    const nuevo = await nf('/v1/projects', { method: 'POST', body: { name: PROYECTO, description: 'Bot de WhatsApp de DC Tecnology (n8n + Evolution)', ...(region ? { region } : {}) } });
    console.log(`✔ proyecto ${nuevo.id} creado${region ? ` en ${region}` : ''}`);
    return nuevo.id;
}

async function main() {
    if (!env.NORTHFLANK_TOKEN) {
        console.error('Falta NORTHFLANK_TOKEN en .env. En Northflank: tu equipo → Settings → API → Tokens → crea uno con permisos de proyecto y pégalo en .env como NORTHFLANK_TOKEN=…');
        process.exit(1);
    }
    const { plans = [] } = await nf('/v1/plans');
    const planN8n = elegirPlan(plans, 1024, env.NF_PLAN_N8N), planEvo = elegirPlan(plans, 512, env.NF_PLAN_EVO), planDb = elegirPlan(plans, 256, env.NF_PLAN_DB);

    if (args.includes('--revisar') || !args.length) {
        const { regions = [] } = await nf('/v1/regions').catch(() => ({ regions: [] }));
        const { projects = [] } = await nf('/v1/projects');
        console.log(`✔ token válido · proyectos: ${projects.map((p) => p.name).join(', ') || 'ninguno'}`);
        console.log(`Regiones: ${regions.map((r) => r.id).join(', ') || '(no las devolvió)'}`);
        for (const [q, p] of [['n8n', planN8n], ['evolution', planEvo], ['base n8n', planDb]]) console.log(`Plan ${q}: ${p?.id ?? '¿?'} (${p?.cpuResource ?? '?'} vCPU, ${p?.ramResource ?? '?'} MB, ≈ US$${p?.amountPerMonth ?? '?'}/mes)`);
        const total = [planN8n, planEvo, planDb].reduce((a, p) => a + (p?.amountPerMonth ?? 0), 0);
        console.log(`Total ≈ US$${total.toFixed(2)}/mes (el plan Sandbox cubre hasta US$20/mes de recursos; la base suma además su disco).`);
        const ghcr = await fetch(`https://ghcr.io/token?scope=repository:${IMAGEN_EVOLUTION.replace(/^ghcr\.io\//, '').split(':')[0]}:pull`).then((r) => r.json()).catch(() => ({}));
        const man = ghcr.token ? await fetch(`https://ghcr.io/v2/${IMAGEN_EVOLUTION.replace(/^ghcr\.io\//, '').replace(':', '/manifests/')}`, { headers: { Authorization: `Bearer ${ghcr.token}`, Accept: 'application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json' } }) : null;
        console.log(man?.ok ? `✔ imagen ${IMAGEN_EVOLUTION} pública` : `✘ imagen ${IMAGEN_EVOLUTION} no se puede bajar sin clave: corre la acción «Imagen de Evolution» en GitHub y ponla pública (Packages → dc-evolution → Package settings → Change visibility → Public)`);
        return;
    }

    if (args.includes('--crear')) {
        const p = await proyecto(env.NF_REGION || undefined);
        // 1) Base de n8n
        const { addons = [] } = await nf(`/v1/projects/${p}/addons`);
        let db = addons.find((a) => a.id === 'n8n-db' || a.name === 'n8n-db');
        if (!db) {
            db = await nf(`/v1/projects/${p}/addons`, { method: 'POST', body: { name: 'n8n-db', description: 'Base de n8n', type: 'postgresql', version: 'latest', billing: { deploymentPlan: planDb.id, storage: 1024, replicas: 1 } } });
            console.log(`✔ base n8n-db creada (${planDb.id}, 1 GB)`);
        }
        let cred = null;
        for (let i = 0; i < 40 && !cred; i++) { try { const c = await nf(`/v1/projects/${p}/addons/${db.id}/credentials`); cred = conexionPostgres(c); } catch { /* aún creando */ } if (!cred) await esperar(15000); }
        if (!cred) throw new Error('La base no entregó su conexión en 10 min: revisa el complemento n8n-db en Northflank');
        // 2) Servicios (Evolution con 0 instancias hasta --mudar)
        const { services = [] } = await nf(`/v1/projects/${p}/services`);
        const evoTexto = fs.existsSync(EVOLUTION_LOCAL_ENV) ? fs.readFileSync(EVOLUTION_LOCAL_ENV, 'utf8') : '';
        const evoVars = variablesEvolution(evoTexto);
        if (!evoVars.DATABASE_CONNECTION_URI) throw new Error(`No encontré DATABASE_CONNECTION_URI en ${EVOLUTION_LOCAL_ENV} (la base de Neon de la sesión de WhatsApp)`);
        if (!services.some((s) => s.id === 'evolution')) {
            await nf(`/v1/projects/${p}/services/deployment`, { method: 'POST', body: { name: 'evolution', description: 'Evolution API 2.3.7 + parche @bot', billing: { deploymentPlan: planEvo.id },
                deployment: { instances: 0, external: { imagePath: IMAGEN_EVOLUTION } }, ports: [{ name: 'api', internalPort: 8080, public: true, protocol: 'HTTP' }],
                runtimeEnvironment: { ...evoVars, SERVER_PORT: '8080', CACHE_REDIS_ENABLED: 'false', CACHE_LOCAL_ENABLED: 'true', DEL_INSTANCE: 'false', TZ: 'America/Bogota' } } });
            console.log(`✔ servicio evolution creado APAGADO (${planEvo.id}); se enciende con --mudar`);
        }
        const clave = env.N8N_NUBE_ENCRYPTION_KEY || crypto.randomBytes(24).toString('hex');
        if (!env.N8N_NUBE_ENCRYPTION_KEY) guardarEnv({ N8N_NUBE_ENCRYPTION_KEY: clave });
        if (!services.some((s) => s.id === 'n8n')) {
            await nf(`/v1/projects/${p}/services/deployment`, { method: 'POST', body: { name: 'n8n', description: 'n8n del bot', billing: { deploymentPlan: planN8n.id },
                deployment: { instances: 1, external: { imagePath: IMAGEN_N8N } }, ports: [{ name: 'web', internalPort: 5678, public: true, protocol: 'HTTP' }],
                runtimeEnvironment: variablesN8n({ db: cred, clave, ram: planN8n.ramResource }) } });
            console.log(`✔ servicio n8n creado (${planN8n.id})`);
        }
        // 3) Direcciones públicas → variables que las necesitan
        const dn8n = await dnsDe(p, 'n8n'), devo = await dnsDe(p, 'evolution');
        await nf(`/v1/projects/${p}/services/n8n/runtime-environment`, { method: 'POST', body: { runtimeEnvironment: variablesN8n({ dominio: dn8n, db: cred, clave, ram: planN8n.ramResource }) } });
        await nf(`/v1/projects/${p}/services/evolution/runtime-environment`, { method: 'POST', body: { runtimeEnvironment: { ...evoVars, SERVER_URL: `https://${devo}`, SERVER_PORT: '8080', CACHE_REDIS_ENABLED: 'false', CACHE_LOCAL_ENABLED: 'true', DEL_INSTANCE: 'false', TZ: 'America/Bogota' } } });
        escribirSalida({ proyecto: p, n8n: `https://${dn8n}`, evolution: `https://${devo}`, planes: { n8n: planN8n.id, evolution: planEvo.id, base: planDb.id } });
        console.log(`\nn8n:       https://${dn8n}  ← ábrelo, crea tu usuario dueño y en Settings → n8n API crea una clave: pégala en .env como N8N_NUBE_API_KEY=…`);
        console.log(`Evolution: https://${devo}  (apagado hasta --mudar)`);
        return;
    }

    if (args.includes('--mudar')) {
        const s = leerSalida();
        if (!s.proyecto) throw new Error('Primero: node herramientas/northflank.mjs --crear');
        const local = await fetch('http://localhost:8080/', { signal: AbortSignal.timeout(4000) }).then(() => true).catch(() => false);
        if (local) { console.error('El Evolution del PC sigue encendido (localhost:8080). Cierra su ventana «Evolution API» y vuelve a correr --mudar: dos Evolution con la misma sesión de WhatsApp se pisan.'); process.exit(1); }
        await nf(`/v1/projects/${s.proyecto}/services/evolution/scale`, { method: 'POST', body: { instances: 1 } });
        console.log('… encendiendo Evolution en la nube');
        let listo = false;
        for (let i = 0; i < 40 && !listo; i++) { await esperar(15000); listo = await fetch(`${s.evolution}/`, { signal: AbortSignal.timeout(10000) }).then((r) => r.ok).catch(() => false); }
        if (!listo) throw new Error(`Evolution no respondió en ${s.evolution} en 10 min: mira sus registros en Northflank`);
        const inst = env.EVOLUTION_INSTANCIA || 'dc-bot';
        const estado = await fetch(`${s.evolution}/instance/connectionState/${inst}`, { headers: { apikey: env.EVOLUTION_API_KEY } }).then((r) => r.json()).catch(() => ({}));
        console.log(`✔ Evolution en línea · WhatsApp: ${estado?.instance?.state ?? 'sin dato'}`);
        const w = await fetch(`${s.evolution}/webhook/set/${inst}`, { method: 'POST', headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ webhook: { enabled: true, url: 'http://n8n:5678/webhook/dc-whatsapp', byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'LABELS_ASSOCIATION', 'LABELS_EDIT'] } }) }); // los mismos que tenía el PC
        console.log(w.ok ? '✔ webhook de Evolution → http://n8n:5678/webhook/dc-whatsapp' : `✘ no pude cambiar el webhook (${w.status})`);
        // El vigilante del PC reinicia el Evolution local cada 10 min: chocaría con el de la nube
        try {
            const { execFileSync } = await import('node:child_process');
            execFileSync('schtasks', ['/Change', '/TN', 'DC Tecnology - vigilante del bot', '/DISABLE'], { stdio: 'ignore' });
            console.log('✔ tarea «DC Tecnology - vigilante del bot» desactivada en este PC (ya no levanta el Evolution local)');
        } catch { console.log('⚠ desactiva a mano la tarea «DC Tecnology - vigilante del bot» (Programador de tareas) y no vuelvas a usar iniciar-bot.ps1'); }
        console.log('\nÚltimo paso (lo corres tú, usa tus claves de .env):');
        console.log(`  $env:N8N_URL='${s.n8n}'; $env:N8N_API_KEY=(Select-String -Path .env -Pattern '^N8N_NUBE_API_KEY=(.*)').Matches.Groups[1].Value; $env:EVOLUTION_URL='http://evolution:8080'; node herramientas/configurar-n8n.js --aplicar --activar`);
        return;
    }

    if (args.includes('--estado')) {
        const s = leerSalida();
        if (!s.proyecto) { console.log('Aún no hay nada en Northflank (--crear).'); return; }
        const { services = [] } = await nf(`/v1/projects/${s.proyecto}/services`);
        for (const x of services) console.log(`${x.id}: ${x.status?.deployment?.status ?? '?'} · instancias ${x.deployment?.instances ?? '?'}`);
        console.log(`n8n ${s.n8n} · Evolution ${s.evolution}`);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(`✘ ${e.message}`); process.exit(1); });
