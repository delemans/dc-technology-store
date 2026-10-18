// herramientas/publicar-estado.mjs — Publicidad automática en los estados de WhatsApp del bot (Evolution).
//
//   node herramientas/publicar-estado.mjs            → publica el estado de HOY (una vez por día; si ya salió, no repite)
//   node herramientas/publicar-estado.mjs --probar   → muestra qué publicaría y a cuántos contactos, sin publicar
//   node herramientas/publicar-estado.mjs --instalar → tarea programada diaria (12:30 p. m.) en este PC
//
// Qué publica (herramientas/estados-plan.json):
//   · Cada día, el siguiente video de la rotación (alterna voz de mujer / de hombre si existen las dos versiones).
//   · El día de la promo semanal (lunes por defecto), además, un estado de texto con la promo de la semana.
// Los estados los ven los contactos del WhatsApp del bot (como cualquier estado). Los videos vienen de
// docs/videos-estados/mp4 (no van a git) y se le entregan a Evolution por un servidor local temporal.
// WhatsApp corta los estados de más de 60 s: los videos más largos se omiten de la rotación.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { cargarEntorno, requerir } = require('./entorno.js');
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = cargarEntorno();
const args = process.argv.slice(2);
const PROBAR = args.includes('--probar');

if (args.includes('--instalar')) {
    const tarea = 'DC Tecnology - estados de WhatsApp';
    const nodo = process.execPath;
    const ps = `$a = New-ScheduledTaskAction -Execute '${nodo}' -Argument '"${path.join(RAIZ, 'herramientas', 'publicar-estado.mjs')}"' -WorkingDirectory '${RAIZ}';
$t = New-ScheduledTaskTrigger -Daily -At '12:30';
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20);
Register-ScheduledTask -TaskName '${tarea}' -Action $a -Trigger $t -Settings $s -Description 'Publica el estado diario de WhatsApp (DC Tecnology).' -Force | Out-Null`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
    console.log(`Tarea "${tarea}" instalada: todos los días a las 12:30 p. m. (si el PC estaba apagado, corre al encender).`);
    process.exit(0);
}

// Interruptor: los estados solo salen solos si .env tiene ESTADOS_AUTOMATICOS=si (18/10/2026: el director pidió que aún no).
// --probar siempre funciona; --forzar publica una vez aunque el interruptor esté apagado.
if (!PROBAR && !args.includes('--forzar') && String(env.ESTADOS_AUTOMATICOS ?? '').toLowerCase() !== 'si') {
    console.log('Estados automáticos APAGADOS (ESTADOS_AUTOMATICOS=si en .env para activarlos). No se publicó nada.');
    process.exit(0);
}
requerir(env, ['EVOLUTION_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCIA']);
const EVO = env.EVOLUTION_URL.replace(/\/+$/, '');
const INST = env.EVOLUTION_INSTANCIA;
const plan = JSON.parse(fs.readFileSync(path.join(RAIZ, 'herramientas', 'estados-plan.json'), 'utf8'));
const carpeta = path.join(RAIZ, plan.carpeta);
const salida = path.join(RAIZ, 'herramientas', 'salida');
fs.mkdirSync(salida, { recursive: true });
const archivoEstado = path.join(salida, 'estados.json');
const registro = (() => { try { return JSON.parse(fs.readFileSync(archivoEstado, 'utf8')); } catch { return { indice: 0, publicados: [] }; } })();
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const diaSemana = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' })).getDay();

const evo = async (ruta, cuerpo) => {
    const r = await fetch(`${EVO}${ruta}`, { method: 'POST', headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo ?? {}) });
    const texto = await r.text();
    if (!r.ok) throw new Error(`${ruta} → HTTP ${r.status}: ${texto.slice(0, 200)}`);
    try { return JSON.parse(texto); } catch { return texto; }
};

// Duración de un MP4 leyendo el átomo mvhd (sin ffmpeg)
function duracionMp4(archivo) {
    const b = fs.readFileSync(archivo);
    const i = b.indexOf('mvhd');
    if (i < 0) return null;
    const version = b[i + 4];
    const escala = version === 1 ? b.readUInt32BE(i + 24) : b.readUInt32BE(i + 16);
    const dur = version === 1 ? Number(b.readBigUInt64BE(i + 28)) : b.readUInt32BE(i + 20);
    return escala ? dur / escala : null;
}

// Videos disponibles (≤ 60 s), en el orden del plan
const disponibles = plan.videos.flatMap((v) => {
    // Nombres "NN-video.mp4" (voz de mujer) y "NN-video-hombre.mp4"
    const versiones = ['', '-hombre'].map((suf) => fs.readdirSync(carpeta).find((f) => f.replace(/^\d+-/, '') === `${v.archivo}${suf}.mp4`))
        .filter(Boolean).map((f) => path.join(carpeta, f)).filter((f) => (duracionMp4(f) ?? 99) <= 60);
    return versiones.length ? [{ ...v, versiones }] : [];
});
if (!disponibles.length) { console.error(`No hay videos en ${carpeta}.`); process.exit(1); }

const yaHoy = registro.publicados.some((p) => p.fecha === hoy && p.tipo === 'video');
const elegido = disponibles[registro.indice % disponibles.length];
const archivo = elegido.versiones[Math.floor(registro.indice / disponibles.length) % elegido.versiones.length] ?? elegido.versiones[0];
const leyenda = `${elegido.texto}\n\n${plan.pie}`;
const promo = diaSemana === plan.promo_semanal.dia ? plan.promo_semanal.textos[Math.floor(Date.now() / (7 * 864e5)) % plan.promo_semanal.textos.length] : null;
const promoHoy = registro.publicados.some((p) => p.fecha === hoy && p.tipo === 'promo');

// Contactos reales (con nombre, número de WhatsApp; sin grupos ni @lid)
const contactos = await evo(`/chat/findContacts/${INST}`, {});
const lista = [...new Set((Array.isArray(contactos) ? contactos : [])
    .filter((c) => c.pushName && /^\d{8,15}@s\.whatsapp\.net$/.test(c.remoteJid ?? ''))
    .map((c) => c.remoteJid))];
if (!lista.length) { console.error('Evolution no devolvió contactos: no se publica.'); process.exit(1); }

if (PROBAR) {
    console.log(`Hoy (${hoy}) publicaría: ${yaHoy ? '(video ya publicado hoy)' : path.basename(archivo)} → ${lista.length} contactos`);
    console.log(`Texto: ${leyenda.replace(/\n/g, ' / ')}`);
    if (promo) console.log(`Promo semanal${promoHoy ? ' (ya publicada hoy)' : ''}: ${promo.replace(/\n/g, ' / ')}`);
    console.log(`Rotación: ${disponibles.length} videos (${disponibles.map((v) => v.archivo).join(', ')})`);
    process.exit(0);
}

function servirUnaVez(ruta) {
    return new Promise((listo) => {
        const servidor = http.createServer((req, res) => {
            if (req.url !== '/estado.mp4') { res.writeHead(404).end(); return; }
            res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': fs.statSync(ruta).size });
            fs.createReadStream(ruta).pipe(res);
        });
        servidor.listen(0, '127.0.0.1', () => listo(servidor));
    });
}

if (!yaHoy) {
    const servidor = await servirUnaVez(archivo);
    try {
        await evo(`/message/sendStatus/${INST}`, { type: 'video', content: `http://127.0.0.1:${servidor.address().port}/estado.mp4`, caption: leyenda, statusJidList: lista });
        registro.publicados.push({ fecha: hoy, tipo: 'video', archivo: path.basename(archivo), contactos: lista.length });
        registro.indice += 1;
        console.log(`Estado publicado: ${path.basename(archivo)} → ${lista.length} contactos`);
    } finally { servidor.close(); }
}
if (promo && !promoHoy) {
    await evo(`/message/sendStatus/${INST}`, { type: 'text', content: promo, backgroundColor: plan.promo_semanal.fondo, font: 1, statusJidList: lista });
    registro.publicados.push({ fecha: hoy, tipo: 'promo', contactos: lista.length });
    console.log('Promo semanal publicada.');
}
registro.publicados = registro.publicados.slice(-60);
fs.writeFileSync(archivoEstado, JSON.stringify(registro, null, 2));
