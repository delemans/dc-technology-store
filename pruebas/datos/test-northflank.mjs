// herramientas/northflank.mjs e infra/northflank/: planes, variables, conexión de la base, parche @bot (sin llamar a Northflank)
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const m = await import(new URL('../../herramientas/northflank.mjs', import.meta.url).href);
const ok = (c, msg) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${msg}`); if (!c) process.exitCode = 1; };
const raiz = new URL('../../', import.meta.url);

const planes = [
    { id: 'nf-compute-10', ramResource: 256, amountPerMonth: 2.7 }, { id: 'nf-compute-20', ramResource: 512, amountPerMonth: 5.4 },
    { id: 'nf-compute-50', ramResource: 1024, amountPerMonth: 12 }, { id: 'nf-compute-100-1', ramResource: 1024, amountPerMonth: 24 },
];
ok(m.elegirPlan(planes, 1024).id === 'nf-compute-50' && m.elegirPlan(planes, 512).id === 'nf-compute-20' && m.elegirPlan(planes, 256).id === 'nf-compute-10', 'elige el plan más barato con la memoria pedida');
ok(m.elegirPlan(planes, 1024, 'nf-compute-20').id === 'nf-compute-20', 'NF_PLAN_* fuerza el plan');

const evo = m.variablesEvolution(['SERVER_URL=http://localhost:8080', 'SERVER_PORT=8080', 'DATABASE_PROVIDER=postgresql', 'DATABASE_CONNECTION_URI=postgresql://u:p@ep-x.neon.tech/db?sslmode=require',
    'CACHE_REDIS_ENABLED=true', 'CACHE_REDIS_URI=redis://localhost:6379/6', 'DEL_INSTANCE=false', 'LOG_LEVEL=ERROR,WARN # comentario', 'PROXY_HOST=', '# SQS_ENABLED=true', 'SSL_CONF_PRIVKEY=/x'].join('\n'));
ok(evo.DATABASE_CONNECTION_URI?.includes('neon.tech') && evo.DATABASE_PROVIDER === 'postgresql' && evo.DEL_INSTANCE === 'false', 'Evolution: copia la base de Neon (misma sesión de WhatsApp, sin QR)');
ok(!('SERVER_URL' in evo) && !('CACHE_REDIS_ENABLED' in evo) && !('CACHE_REDIS_URI' in evo) && !('SSL_CONF_PRIVKEY' in evo) && !('PROXY_HOST' in evo) && !('SQS_ENABLED' in evo), 'Evolution: no copia lo propio del PC (dirección, Redis, SSL, vacíos ni comentados)');
ok(evo.LOG_LEVEL === 'ERROR,WARN', 'Evolution: quita comentarios al final de la línea');

const db = m.conexionPostgres({ secrets: { username: 'a', password: 'b' }, envs: { POSTGRES_URI_ADMIN: 'postgresql://admin:x@h-admin:5432/postgres', POSTGRES_URI: 'postgresql://us%40r:p%3Ass@addon-n8n-db:5432/n8ndb' } });
ok(db && db.host === 'addon-n8n-db' && db.user === 'us@r' && db.password === 'p:ss' && db.database === 'n8ndb' && db.port === '5432', 'conexión de la base: URI interna, decodificada');
ok(m.conexionPostgres({ envs: {} }) === null, 'sin URI de Postgres devuelve null');

const n8n = m.variablesN8n({ dominio: 'web--n8n--dc-bot.code.run', db, clave: 'k', ram: 1024 });
ok(n8n.DB_TYPE === 'postgresdb' && n8n.WEBHOOK_URL === 'https://web--n8n--dc-bot.code.run/' && n8n.N8N_PROTOCOL === 'https' && n8n.GENERIC_TIMEZONE === 'America/Bogota', 'n8n: Postgres, webhook https público y hora de Bogotá');
ok(n8n.NODE_OPTIONS === '--max-old-space-size=768' && n8n.EXECUTIONS_DATA_PRUNE === 'true', 'n8n: memoria acotada al plan y limpieza de ejecuciones');

// Llamadas a la API: encabezado, cuerpo y errores legibles (fetch simulado)
{
    let visto;
    const f = async (url, o) => { visto = { url, o }; return new Response(JSON.stringify({ data: { id: 'dc-bot' } }), { status: 200 }); };
    const r = await m.nf('/v1/projects', { method: 'POST', body: { name: 'dc-bot' }, token: 'T', f });
    ok(r.id === 'dc-bot' && visto.url === 'https://api.northflank.com/v1/projects' && visto.o.headers.Authorization === 'Bearer T' && JSON.parse(visto.o.body).name === 'dc-bot', 'API: Bearer, JSON y devuelve data');
    const f2 = async () => new Response(JSON.stringify({ error: { status: 409, message: 'Project already exists' } }), { status: 409 });
    let msg = ''; try { await m.nf('/v1/projects', { method: 'POST', body: {}, token: 'T', f: f2 }); } catch (e) { msg = e.message; }
    ok(/409: Project already exists/.test(msg), 'API: el error de Northflank llega claro');
}

// Parche @bot sobre el código de Evolution (mismas líneas que la etiqueta 2.3.7)
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-'));
    const ts = path.join(dir, 'x.ts');
    fs.writeFileSync(ts, "      shouldIgnoreJid: (jid) => {\n        const isGroupJid = this.localSettings.groupsIgnore && isJidGroup(jid);\n        const isBroadcast = !this.localSettings.readStatus && isJidBroadcast(jid);\n        const isNewsletter = isJidNewsletter(jid);\n\n        return isGroupJid || isBroadcast || isNewsletter;\n      },\n");
    const parche = new URL('../../infra/northflank/evolution/parche-bot.mjs', import.meta.url);
    const r1 = spawnSync(process.execPath, [fileURLToPath(parche), ts], { encoding: 'utf8' });
    const hecho = fs.readFileSync(ts, 'utf8');
    ok(r1.status === 0 && hecho.includes("String(jid ?? '').endsWith('@bot')") && hecho.includes('|| isNewsletter || isMetaBot;'), 'parche @bot: se aplica sobre el código esperado');
    const r2 = spawnSync(process.execPath, [fileURLToPath(parche), ts], { encoding: 'utf8' });
    ok(r2.status === 0 && fs.readFileSync(ts, 'utf8') === hecho, 'parche @bot: idempotente');
    fs.writeFileSync(ts, 'otro código\n');
    const r3 = spawnSync(process.execPath, [fileURLToPath(parche), ts], { encoding: 'utf8' });
    ok(r3.status === 1, 'parche @bot: si el código cambió, la imagen NO se construye');
}
const df = fs.readFileSync(new URL('infra/northflank/evolution/Dockerfile', raiz), 'utf8');
ok(/--branch 2\.3\.7 /.test(df) && /parche-bot\.mjs/.test(df) && /npm run build/.test(df), 'Dockerfile: Evolution 2.3.7 + parche + build');
const wf = fs.readFileSync(new URL('.github/workflows/imagen-evolution.yml', raiz), 'utf8');
ok(/ghcr\.io\/delemans\/dc-evolution:2\.3\.7-dc1/.test(wf) && /packages: write/.test(wf), 'GitHub Actions publica la imagen que usa Northflank');
const nfjs = fs.readFileSync(new URL('herramientas/northflank.mjs', raiz), 'utf8');
ok(/instances: 0, external: \{ imagePath: IMAGEN_EVOLUTION \}/.test(nfjs), 'Evolution se crea APAGADO (no pisa la sesión del PC)');
ok(!/console\.log\([^)]*(DATABASE_CONNECTION_URI|password|NORTHFLANK_TOKEN)\b[^)]*\)/i.test(nfjs.replace(/No encontré DATABASE_CONNECTION_URI/, '')), 'no imprime secretos');
