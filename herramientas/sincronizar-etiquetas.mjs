// herramientas/sincronizar-etiquetas.mjs — Etiquetas de WhatsApp Business → bot (no responde en BAENAMORA y las de
// "etiquetas_silencio" de Config bot).
//   node herramientas/sincronizar-etiquetas.mjs            → muestra cuántos chats tiene cada etiqueta (no cambia nada)
//   node herramientas/sincronizar-etiquetas.mjs --aplicar  → 1) activa en Evolution el aviso de cambios de etiquetas
//                                                            (labels.association / labels.edit) hacia el webhook del bot
//                                                            2) le envía al bot las etiquetas actuales de cada chat
// Lee la base de Evolution (DATABASE_CONNECTION_URI de su .env; carpeta en EVOLUTION_CARPETA o C:/evolution-api/evolution-api-main).
// Después de esto, cada vez que pongas o quites una etiqueta en tu WhatsApp el bot se entera solo.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cargarEntorno, requerir } = require('./entorno.js');
const APLICAR = process.argv.includes('--aplicar');
const env = cargarEntorno();
requerir(env, ['EVOLUTION_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCIA', 'N8N_URL']);
const EVO = env.EVOLUTION_URL.replace(/\/+$/, '');
const INST = env.EVOLUTION_INSTANCIA;
const CARPETA = env.EVOLUTION_CARPETA || 'C:/evolution-api/evolution-api-main';
const EVENTOS = ['MESSAGES_UPSERT', 'LABELS_ASSOCIATION', 'LABELS_EDIT'];

// 1) Etiquetas actuales desde la base de Evolution
const envEvolution = fs.readFileSync(path.join(CARPETA, '.env'), 'utf8');
const uri = /^DATABASE_CONNECTION_URI=['"]?([^'"\r\n]+)/m.exec(envEvolution)?.[1];
if (!uri) throw new Error(`No encontré DATABASE_CONNECTION_URI en ${CARPETA}/.env`);
const { Client } = createRequire(path.join(CARPETA, 'package.json'))('pg');
const db = new Client({ connectionString: uri });
await db.connect();
const instancia = (await db.query('select id from "Instance" where name = $1', [INST])).rows[0];
if (!instancia) throw new Error(`La base de Evolution no tiene la instancia ${INST}`);
const etiquetas = (await db.query('select "labelId", name from "Label" where "instanceId" = $1', [instancia.id])).rows;
const chats = (await db.query(`select "remoteJid", labels from "Chat" where "instanceId" = $1 and labels is not null and labels::text not in ('[]', 'null')`, [instancia.id])).rows;
await db.end();
const nombres = Object.fromEntries(etiquetas.map((e) => [String(e.labelId), String(e.name).trim()]));
const porChat = Object.fromEntries(chats.map((c) => [c.remoteJid, (Array.isArray(c.labels) ? c.labels : []).map(String)]).filter(([, l]) => l.length));
const cuenta = {};
for (const ids of Object.values(porChat)) for (const id of ids) cuenta[id] = (cuenta[id] ?? 0) + 1;
console.log(`\n${APLICAR ? 'APLICAR' : 'REVISIÓN (usa --aplicar)'} · ${Object.keys(porChat).length} chats con etiqueta`);
for (const [id, n] of Object.entries(cuenta).sort((a, b) => b[1] - a[1])) console.log(`  · ${(nombres[id] ?? `etiqueta ${id}`).padEnd(24)} ${n} chats`);

// 2) Webhook de Evolution: además de los mensajes, los cambios de etiquetas
const evo = (ruta, opciones = {}) => fetch(`${EVO}${ruta}`, { ...opciones, headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' } })
    .then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) }));
const actual = await evo(`/webhook/find/${INST}`);
const hook = actual.json?.webhook ?? actual.json ?? {};
const eventos = (hook.events ?? []).map(String);
const faltan = EVENTOS.filter((e) => !eventos.includes(e));
console.log(`  webhook de Evolution: ${hook.url ?? '(sin URL)'} · eventos: ${eventos.join(', ') || 'ninguno'}${faltan.length ? ` · faltan ${faltan.join(', ')}` : ' ✔'}`);
if (!APLICAR) process.exit(0);
if (!hook.url) throw new Error('Evolution no tiene webhook configurado: usa el botón "Configurar Evolution" del flujo en n8n.');
if (faltan.length) {
    const r = await evo(`/webhook/set/${INST}`, { method: 'POST', body: JSON.stringify({ webhook: {
        enabled: true, url: hook.url, byEvents: Boolean(hook.webhookByEvents ?? hook.byEvents ?? false), base64: Boolean(hook.webhookBase64 ?? hook.base64 ?? false),
        events: [...new Set([...eventos, ...EVENTOS])] } }) });
    console.log(`  ${r.ok ? '✔' : '✘'} eventos de etiquetas activados en Evolution${r.ok ? '' : ` (HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 160)})`}`);
}

// 3) Las etiquetas actuales al bot, por el mismo webhook (evento labels.sync que entiende "Normalizar mensaje")
const destino = hook.url.replace(/^https?:\/\/[^/]+/, env.N8N_URL.replace(/\/+$/, ''));
const r = await fetch(destino, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'labels.sync', instance: INST, data: { chats: porChat, nombres } }) });
console.log(`  ${r.ok ? '✔' : '✘'} bot actualizado: ${Object.keys(porChat).length} chats con etiqueta (${destino})\n`);
