// herramientas/revisar-entrada.mjs — ¿Le están LLEGANDO mensajes al WhatsApp del bot? (lo usa vigilante-bot.ps1)
// Evolution puede seguir enviando y no recibir nada (pasó del 13 al 16/10/2026: un mensaje de "Meta Business Agent"
// trabó la cola de Baileys). Se mira en la base de Evolution la hora del último mensaje entrante (clientes y grupos).
//   node herramientas/revisar-entrada.mjs            → muestra el último entrante; sale con código 2 si lleva más de
//                                                      ENTRADA_HORAS (por defecto 8) sin entrar nada
//   node herramientas/revisar-entrada.mjs --avisar   → además te escribe por WhatsApp (máximo una vez cada 8 h)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RAIZ, cargarEntorno } = require('./entorno.js');
const env = cargarEntorno();
const CARPETA = env.EVOLUTION_CARPETA || 'C:/evolution-api/evolution-api-main';
const HORAS = Number(env.ENTRADA_HORAS) > 0 ? Number(env.ENTRADA_HORAS) : 8;
const uri = /^DATABASE_CONNECTION_URI=['"]?([^'"\r\n]+)/m.exec(fs.readFileSync(path.join(CARPETA, '.env'), 'utf8'))?.[1];
const { Client } = createRequire(path.join(CARPETA, 'package.json'))('pg');
const db = new Client({ connectionString: uri });
await db.connect();
const fila = (await db.query(`select max("messageTimestamp") as ultimo from "Message" where key->>'fromMe' = 'false'`)).rows[0];
await db.end();
const ultimo = Number(fila?.ultimo ?? 0) * 1000;
const horas = ultimo ? (Date.now() - ultimo) / 3600e3 : Infinity;
console.log(`último mensaje entrante: ${ultimo ? new Date(ultimo).toISOString() : 'ninguno'} (hace ${horas.toFixed(1)} h)`);
// Si la hora del último entrante avanzó desde la revisión anterior, está llegando (o poniéndose al día con mensajes
// atrasados): no es falla. Solo es falla si lleva más de HORAS y no avanzó.
const estado = path.join(RAIZ, 'herramientas', 'salida', 'revisar-entrada.json');
const previo = fs.existsSync(estado) ? JSON.parse(fs.readFileSync(estado, 'utf8')) : {};
const avanzo = previo.ultimo === undefined || ultimo > Number(previo.ultimo);
fs.mkdirSync(path.dirname(estado), { recursive: true });
fs.writeFileSync(estado, JSON.stringify({ ...previo, ultimo }));
if (horas <= HORAS || avanzo) process.exit(0);

if (process.argv.includes('--avisar')) {
    if (Date.now() - (previo.avisado ?? 0) > HORAS * 3600e3) {
        const aviso = String(env.NUMERO_AVISO_ADMIN ?? '').replace(/\D/g, '').replace(/^(3\d{9})$/, '57$1');
        if (aviso) {
            const r = await fetch(`${env.EVOLUTION_URL.replace(/\/+$/, '')}/message/sendText/${env.EVOLUTION_INSTANCIA}`, {
                method: 'POST', headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: aviso, text: [
                    `⚠️ *El WhatsApp del bot lleva ${Math.round(horas)} h sin recibir mensajes*`,
                    'Puede estar enviando pero no recibiendo. El vigilante ya reinició Evolution.',
                    'Si sigue igual: abre WhatsApp en el celular del bot → Dispositivos vinculados, y revisa que el equipo siga conectado (o vuelve a vincular con el QR).',
                ].join('\n') }),
            }).catch(() => null);
            console.log(`aviso al director: ${r?.ok ? 'enviado' : 'no se pudo enviar'}`);
        }
        fs.writeFileSync(estado, JSON.stringify({ ultimo, avisado: Date.now() }));
    }
}
process.exit(2);
