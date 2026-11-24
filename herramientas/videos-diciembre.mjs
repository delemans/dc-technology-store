// herramientas/videos-diciembre.mjs — Videos de diciembre 2026 (pedido del director el 24/11/2026): un video vertical
// 1080×1920 por CADA producto de ANC visible + mantenimiento y revisión, con música original y 7 formatos distintos
// (regalo sorpresa, tráiler de cine, ritmo, calendario de adviento, vitrina giratoria, tarjeta navideña y lista de
// regalos) + un resumen con todo el catálogo. Mismos datos reales que las imágenes (publicidad-diciembre.mjs --json):
// precios vigentes, «Solo quedan N» con las unidades reales, sin precio «antes» ni descuentos y sin nombrar al proveedor.
// Se arma todo en Chrome sin ventana (WebCodecs: H.264 + AAC), sin instalar programas.
//
//   node --use-system-ca herramientas/videos-diciembre.mjs            → todos los videos
//   node --use-system-ca herramientas/videos-diciembre.mjs --solo 08  → solo la pieza 08 (o «todos» para el resumen)
//   node --use-system-ca herramientas/videos-diciembre.mjs --vistas   → además guarda 4 fotogramas de control por video
// Salida: Escritorio «Anuncios DC Tecnology/Diciembre 2026/Videos 1080x1920» + VIDEOS.txt (formato y texto de cada uno)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(process.env.USERPROFILE ?? 'C:/Users/dise12', 'Desktop', 'Anuncios DC Tecnology', 'Diciembre 2026');
const CARPETA = path.join(DESTINO, 'Videos 1080x1920');
const TMP = path.join(RAIZ, 'herramientas', 'salida', 'diciembre-video');
const FPS = 30;
const args = process.argv.slice(2);
const SOLO = args.includes('--solo') ? args[args.indexOf('--solo') + 1] : null;
const VISTAS = args.includes('--vistas');

/* ---------- Datos (los mismos de las imágenes) ---------- */
const salida = execFileSync(process.execPath, ['--use-system-ca', path.join(RAIZ, 'herramientas', 'publicidad-diciembre.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
const datos = JSON.parse(salida.split('@@DATOS@@')[1]);
for (const l of salida.split('@@DATOS@@')[0].split('\n')) if (l.trim()) console.log(l);

/* ---------- Un formato por producto: variados y nunca dos iguales seguidos ---------- */
const PREFERIDOS = {
    tecnologia: ['regalo', 'vitrina', 'adviento', 'tarjeta'],
    streaming: ['trailer', 'ritmo', 'ticket', 'trailer'],
    licencias: ['ritmo', 'tarjeta', 'vitrina'],
    pines: ['tarjeta', 'adviento', 'ticket', 'regalo'],
    servicios: ['ritmo', 'vitrina'],
};
const MUSICA = { regalo: 'campanas', vitrina: 'campanas', adviento: 'campanas', tarjeta: 'campanas', ticket: 'campanas', trailer: 'cine', ritmo: 'ritmo', todos: 'ritmo' };
const NOMBRE = { regalo: 'Regalo sorpresa', trailer: 'Tráiler de cine', ritmo: 'Ritmo (tipografía al beat)', adviento: 'Calendario de adviento', vitrina: 'Vitrina giratoria', tarjeta: 'Tarjeta navideña', ticket: 'Lista de regalos', todos: 'Resumen del catálogo' };
const usos = {};
let anterior = null;
for (const x of datos) {
    const opciones = (PREFERIDOS[x.tipo] ?? PREFERIDOS.streaming).filter((f) => f !== anterior);
    // el ticket luce con 3 o más planes; el tráiler, con las plataformas de video
    const puntaje = (f) => (usos[f] ?? 0) - (f === 'ticket' && x.planes.length >= 3 ? 2 : 0) + (f === 'ticket' && x.planes.length < 2 ? 5 : 0);
    x.formato = opciones.sort((a, b) => puntaje(a) - puntaje(b))[0];
    usos[x.formato] = (usos[x.formato] ?? 0) + 1;
    anterior = x.formato;
}
const LOGO = `data:image/png;base64,${fs.readFileSync(path.join(RAIZ, 'img', 'logo-dc-192.png')).toString('base64')}`;
const resumen = { id: 'todos', n: '00', archivo: '00-todo-el-catalogo-de-navidad', formato: 'todos', nombre: 'Todo el catálogo', tema: 'Navidad', t: '', s: '', b: [], planes: [], estilo: datos[0].estilo,
    todos: datos.map((x) => ({ id: x.id, nombre: x.nombre, imagen: x.imagen, estilo: x.estilo, planes: x.planes })) };
// Versión 2 de cada producto (para publicar 2 videos diarios sin repetir): OTRO formato, otro estilo y titular con el
// precio vigente («Maratón navideña por $17.000»). Archivo «NN-producto-v2.mp4».
const TODOS_F = ['regalo', 'trailer', 'ritmo', 'adviento', 'vitrina', 'tarjeta', 'ticket'];
const usos2 = {};
let anterior2 = null;
const cop = (v) => `$${Number(v).toLocaleString('es-CO')}`;
const v2 = datos.map((x, i) => {
    const puntaje = (f) => (usos2[f] ?? 0) + (f === 'ticket' && x.planes.length < 2 ? 9 : 0) + (f === 'trailer' && x.tipo === 'tecnologia' ? 3 : 0);
    const formato = TODOS_F.filter((f) => f !== x.formato && f !== anterior2).sort((a, b) => puntaje(a) - puntaje(b) || TODOS_F.indexOf(a) - TODOS_F.indexOf(b))[0];
    usos2[formato] = (usos2[formato] ?? 0) + 1; anterior2 = formato;
    const desde = Math.min(...x.planes.map((v) => v.precio));
    return { ...x, id: `${x.id}--v2`, archivo: `${x.archivo}-v2`, formato, version: 2, estilo: datos[(i + 6) % datos.length].estilo,
        t: x.id === 'servicio-reparacion-repuestos' ? `Revisión de tu PC por <em>${cop(desde)}</em>` : `${x.tema} ${x.planes.length > 1 ? 'desde' : 'por'} <em>${cop(desde)}</em>` };
});
const VARIANTE = args.includes('--variante') ? args[args.indexOf('--variante') + 1] : 'ambas';
const candidatos = VARIANTE === '1' ? [resumen, ...datos] : VARIANTE === '2' ? v2 : [resumen, ...datos, ...v2];
const videos = candidatos.filter((x) => !SOLO || SOLO.split(',').some((s) => x.n === s || x.id === s || `${x.n}b` === s));
if (args.includes('--formatos')) {
    for (const x of [resumen, ...datos]) console.log(`  ${x.n} · ${NOMBRE[x.formato].padEnd(26)} · ${x.nombre}`); console.log(usos);
    for (const x of v2) console.log(`  ${x.n}b · ${NOMBRE[x.formato].padEnd(26)} · ${x.t.replace(/<\/?em>/g, '')}`); console.log(usos2);
    process.exit(0);
}
if (!videos.length) { console.log(`No hay pieza «${SOLO}».`); process.exit(1); }

/* ---------- Servidor local: páginas, cuadros y guardado ---------- */
const pagina = (x) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Outfit:wght@800;900&family=Caveat:wght@700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/herramientas/videos-diciembre.css"></head><body><div id="raiz"></div>
<script>window.D = ${JSON.stringify({ ...x, logo: LOGO }).replace(/</g, '\\u003c')};</script>
<script src="/herramientas/videos-diciembre-escena.js"></script></body></html>`;
const CODIFICAR = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.min.js"></script>
<script src="/herramientas/videos-diciembre-codificar.js"></script></body></html>`;
const TIPOS = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const servidor = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u.startsWith('/v/')) { const x = videos.find((v) => v.id === u.slice(3)); res.writeHead(x ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(x ? pagina(x) : ''); }
    if (u === '/codificar.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(CODIFICAR); }
    if (u.startsWith('/guardar/') && req.method === 'POST') {
        const x = videos.find((v) => v.id === u.slice(9)); const partes = [];
        req.on('data', (c) => partes.push(c)).on('end', () => { fs.writeFileSync(path.join(CARPETA, `${x.archivo}.mp4`), Buffer.concat(partes)); res.writeHead(200).end('ok'); });
        return;
    }
    const f = u.startsWith('/cuadros/') ? path.join(TMP, u.slice(9)) : path.join(RAIZ, u);
    if (!f.startsWith(u.startsWith('/cuadros/') ? TMP : RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

/* ---------- Chrome sin ventana por CDP ---------- */
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(CARPETA, { recursive: true });
if (VISTAS) fs.mkdirSync(path.join(TMP, '..', 'diciembre-vistas'), { recursive: true });
const PUERTO = 9700 + Math.floor(Math.random() * 90);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${path.join(TMP, 'perfil')}`, 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let pestañas; for (let i = 0; i < 80; i++) { try { pestañas = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); if (pestañas.some((t) => t.type === 'page')) break; } catch {} await esperar(250); }
const ws = new WebSocket(pestañas.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0; const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.error ? { error: m.error } : m.result); pend.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const k = ++n; pend.set(k, r); ws.send(JSON.stringify({ id: k, method, params })); });
const evaluar = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails || r.error) throw new Error(JSON.stringify(r.exceptionDetails?.exception?.description ?? r.error ?? r.exceptionDetails).slice(0, 400)); return r.result?.value; };
const ir = async (url) => { await cdp('Page.navigate', { url }); for (let i = 0; i < 100; i++) { await esperar(100); if ((await cdp('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })).result?.value === 'complete') return; } };
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });

const problemas = [];
const hechos = [];
const t0 = Date.now();
try {
    for (const x of videos) {
        const ini = Date.now();
        await ir(`${BASE}/v/${encodeURIComponent(x.id)}`);
        const info = await evaluar('window.preparar()');
        if (info.fallas.length) problemas.push(`${x.archivo}: ${info.fallas.join(', ')}`);
        const cuadros = Math.round(info.dur * FPS);
        const dir = path.join(TMP, x.id); fs.mkdirSync(dir, { recursive: true });
        const vistas = new Set([0.35, 0.55, 0.75, 0.97].map((p) => Math.round(p * (cuadros - 1))));
        for (let i = 0; i < cuadros; i++) {
            await evaluar(`window.render(${i / FPS})`);
            const img = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true });
            fs.writeFileSync(path.join(dir, `${i}.jpg`), Buffer.from(img.data, 'base64'));
            if (VISTAS && vistas.has(i)) fs.copyFileSync(path.join(dir, `${i}.jpg`), path.join(TMP, '..', 'diciembre-vistas', `${x.n}-${x.formato}-${i}.jpg`));
        }
        await ir(`${BASE}/codificar.html`);
        const r = await evaluar(`window.codificar(${JSON.stringify({ id: x.id, cuadros, fps: FPS, eventos: info.eventos, beat: info.beat, musica: MUSICA[x.formato] })})`);
        fs.rmSync(dir, { recursive: true, force: true });
        if (!String(r).startsWith('ok')) { problemas.push(`${x.archivo}: ${r}`); continue; }
        const mb = (Number(String(r).split(' ')[1]) / 1048576).toFixed(1);
        hechos.push({ ...x, dur: info.dur });
        console.log(`  ✔ ${x.n} · ${NOMBRE[x.formato].padEnd(26)} · ${info.dur.toFixed(1)} s · ${mb} MB · ${x.nombre} (${((Date.now() - ini) / 1000).toFixed(0)} s)`);
    }
} finally { ws.close(); chrome.kill(); servidor.close(); await new Promise((r) => { chrome.once('exit', r); setTimeout(r, 5000); }); }

/* ---------- Textos para publicar ---------- */
if (!SOLO) {
    const porId = Object.fromEntries(datos.map((x) => [x.id, x]));
    fs.writeFileSync(path.join(DESTINO, 'VIDEOS.txt'), [
        'VIDEOS DE DICIEMBRE 2026 · DC Tecnology',
        'Verticales 1080×1920 (9:16) con música original: sirven para estados de WhatsApp, Reels de Instagram y Facebook, TikTok y YouTube Shorts.',
        'Consejo: en TikTok e Instagram puedes cambiar la música por una canción decembrina de la biblioteca de la app (eso ayuda al alcance).', '',
        '==== 00-todo-el-catalogo-de-navidad.mp4 · Resumen del catálogo ====',
        `🎄 Todo para esta Navidad en DC Tecnology: ${datos.length} regalos entre tecnología, plataformas, pines y servicios.`,
        '🛒 https://www.dctecnology.xyz', '💬 WhatsApp 322 328 4622', '#DCTecnology #Navidad2026 #RegalosDeNavidad', '',
        ...hechos.filter((x) => x.id !== 'todos').flatMap((x) => [`==== ${x.archivo}.mp4 · ${NOMBRE[x.formato]} · ${porId[x.id].tema} ====`, porId[x.id].texto, '']),
    ].join('\r\n'));
}
try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {}
console.log(`Listo: ${hechos.length} videos en ${CARPETA} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
if (problemas.length) { console.log(`⚠ Revisar ${problemas.length}:\n  ${problemas.join('\n  ')}`); process.exitCode = 1; }
