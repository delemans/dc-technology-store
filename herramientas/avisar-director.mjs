// herramientas/avisar-director.mjs — Le escribe al director por WhatsApp directo por Evolution (sin pasar por n8n: sirve
// justamente cuando n8n está caído). Lo usa vigilante-bot.ps1.
//   node herramientas/avisar-director.mjs --clave n8n-caido --horas 6 "texto del aviso"
// --clave + --horas: no repite el mismo aviso antes de N horas (registro en herramientas/salida/avisos-director.json).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { RAIZ, cargarEntorno } = require('./entorno.js');

export function argumentos(argv) {
    const a = { clave: '', horas: 0, texto: [] };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--clave') a.clave = argv[++i] ?? '';
        else if (argv[i] === '--horas') a.horas = Number(argv[++i]) || 0;
        else a.texto.push(argv[i]);
    }
    a.texto = a.texto.join(' ').trim();
    return a;
}

export const numeroAviso = (n) => String(n ?? '').replace(/\D/g, '').replace(/^(3\d{9})$/, '57$1');

async function principal() {
    const env = cargarEntorno();
    const a = argumentos(process.argv.slice(2));
    if (!a.texto) { console.log('Uso: node herramientas/avisar-director.mjs [--clave x --horas N] "texto"'); process.exit(1); }
    const registro = path.join(RAIZ, 'herramientas', 'salida', 'avisos-director.json');
    const previo = fs.existsSync(registro) ? JSON.parse(fs.readFileSync(registro, 'utf8')) : {};
    if (a.clave && a.horas && Date.now() - (previo[a.clave] ?? 0) < a.horas * 3600e3) { console.log('aviso ya enviado hace poco: no se repite'); return; }
    const numero = numeroAviso(env.NUMERO_AVISO_ADMIN);
    if (!numero || !env.EVOLUTION_URL || !env.EVOLUTION_INSTANCIA) { console.log('falta NUMERO_AVISO_ADMIN o EVOLUTION_* en .env'); process.exit(1); }
    const r = await fetch(`${env.EVOLUTION_URL.replace(/\/+$/, '')}/message/sendText/${env.EVOLUTION_INSTANCIA}`, {
        method: 'POST', headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: numero, text: a.texto }), signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    console.log(`aviso al director: ${r?.ok ? 'enviado' : 'no se pudo enviar'}`);
    if (r?.ok && a.clave) {
        fs.mkdirSync(path.dirname(registro), { recursive: true });
        fs.writeFileSync(registro, JSON.stringify({ ...previo, [a.clave]: Date.now() }, null, 2));
    }
    if (!r?.ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await principal();
