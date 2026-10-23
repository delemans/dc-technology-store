// herramientas/publicar-redes.mjs — Publica solo los videos del plan de redes (herramientas/salida/redes-plan.json, de generar_redes.js)
// en YouTube (Shorts), Facebook (Reels de la página), Instagram (Reels) y TikTok, con sus APIs oficiales.
//
//   node herramientas/publicar-redes.mjs --probar             → qué saldría hoy y qué redes tienen credenciales (no publica)
//   node herramientas/publicar-redes.mjs                      → publica lo que toca (solo con REDES_AUTOMATICAS=si en .env)
//   node herramientas/publicar-redes.mjs --forzar             → publica una vez aunque el interruptor esté apagado
//   node herramientas/publicar-redes.mjs --autorizar-youtube  → abre el permiso de Google y guarda YOUTUBE_REFRESH_TOKEN en .env
//   node herramientas/publicar-redes.mjs --instalar           → tarea programada diaria 12:40 p. m. (tras el estado de WhatsApp)
//
// Credenciales (solo en .env, nunca en git): ver docs del director en "Anuncios DC Tecnology/REDES - CONFIGURAR UNA VEZ.txt".
//   YouTube:   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
//   Facebook:  META_PAGE_ID, META_PAGE_TOKEN (token de PÁGINA de larga duración)
//   Instagram: META_IG_USER_ID (+ META_PAGE_TOKEN)
//   TikTok:    TIKTOK_ACCESS_TOKEN (+ TIKTOK_REFRESH_TOKEN, TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET para renovarlo); TIKTOK_MODO=borrador
//              (llega a la bandeja de la app para publicarlo con un toque) o publicación directa con TIKTOK_PRIVACIDAD
//              (SELF_ONLY mientras la app no pase la auditoría de TikTok; después PUBLIC_TO_EVERYONE)
// Cada red es independiente: si una falla o no tiene credenciales, las demás siguen. Registro: herramientas/salida/redes-publicadas.json
// (no repite) y redes.log. Los videos llevan la marca de contenido hecho con IA (voz sintética y animación) donde la red la pide.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { cargarEntorno } = require('./entorno.js');
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'herramientas', 'salida');
const GRAPH = 'https://graph.facebook.com/v21.0';
const VENTANA_H = 20; // una publicación vencida hace más de 20 h ya no sale (se salta, no se amontona)

export const REDES = {
    youtube: (e) => e.YOUTUBE_CLIENT_ID && e.YOUTUBE_CLIENT_SECRET && e.YOUTUBE_REFRESH_TOKEN,
    facebook: (e) => e.META_PAGE_ID && e.META_PAGE_TOKEN,
    instagram: (e) => e.META_IG_USER_ID && e.META_PAGE_TOKEN,
    tiktok: (e) => e.TIKTOK_ACCESS_TOKEN,
};
export const redesActivas = (env) => Object.keys(REDES).filter((r) => REDES[r](env));

// Lo que toca publicar ahora: vencido hace menos de VENTANA_H horas y aún no registrado en esa red
export function pendientes(plan, registro, ahora, redes) {
    return plan.flatMap((p) => {
        const t = new Date(p.fecha).getTime();
        if (!(t <= ahora && ahora - t < VENTANA_H * 3600e3) || !p.archivo) return [];
        return redes.filter((r) => !registro[`${p.fecha}|${r}`]).map((red) => ({ red, p }));
    });
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function json(r, que) {
    const texto = await r.text();
    let j; try { j = JSON.parse(texto); } catch { j = { texto }; }
    const error = j.error && j.error.code !== 'ok' ? j.error : null; // TikTok responde siempre error.code = 'ok' cuando sale bien
    if (!r.ok || error) throw new Error(`${que}: ${r.status} ${JSON.stringify(error ?? j).slice(0, 300)}`);
    return j;
}

/* ---------- YouTube (Data API v3, carga reanudable) ---------- */
export async function tokenYoutube(env, f = fetch) {
    const r = await f('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, refresh_token: env.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
    return (await json(r, 'token de YouTube')).access_token;
}
export async function publicarYoutube(p, video, env, f = fetch) {
    const token = await tokenYoutube(env, f);
    const meta = { snippet: { title: p.youtube.titulo.slice(0, 100), description: p.youtube.descripcion, categoryId: '22', defaultLanguage: 'es', defaultAudioLanguage: 'es' },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: true } };
    const ini = await f('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(video.length) }, body: JSON.stringify(meta) });
    if (!ini.ok) await json(ini, 'YouTube (inicio)');
    const destino = ini.headers.get('location');
    const r = await f(destino, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'video/mp4' }, body: video });
    const j = await json(r, 'YouTube (subida)');
    return { id: j.id, url: `https://youtube.com/shorts/${j.id}` };
}

/* ---------- Facebook (Reels de la página) ---------- */
export async function publicarFacebook(p, video, env, f = fetch) {
    const base = `${GRAPH}/${env.META_PAGE_ID}/video_reels`;
    const ini = await json(await f(`${base}?upload_phase=start&access_token=${encodeURIComponent(env.META_PAGE_TOKEN)}`, { method: 'POST' }), 'Facebook (inicio)');
    await json(await f(ini.upload_url ?? `https://rupload.facebook.com/video-upload/v21.0/${ini.video_id}`, { method: 'POST',
        headers: { Authorization: `OAuth ${env.META_PAGE_TOKEN}`, offset: '0', file_size: String(video.length) }, body: video }), 'Facebook (subida)');
    const q = new URLSearchParams({ upload_phase: 'finish', video_id: ini.video_id, video_state: 'PUBLISHED', description: p.instagram_facebook, access_token: env.META_PAGE_TOKEN });
    await json(await f(`${base}?${q}`, { method: 'POST' }), 'Facebook (publicar)');
    return { id: ini.video_id, url: `https://www.facebook.com/reel/${ini.video_id}` };
}

/* ---------- Instagram (Reels, carga reanudable: el video no necesita estar en una URL pública) ---------- */
export async function publicarInstagram(p, video, env, f = fetch, pausa = 5000) {
    const tk = encodeURIComponent(env.META_PAGE_TOKEN);
    const q = new URLSearchParams({ media_type: 'REELS', upload_type: 'resumable', caption: p.instagram_facebook, share_to_feed: 'true' });
    const c = await json(await f(`${GRAPH}/${env.META_IG_USER_ID}/media?${q}&access_token=${tk}`, { method: 'POST' }), 'Instagram (contenedor)');
    await json(await f(c.uri ?? `https://rupload.facebook.com/ig-api-upload/v21.0/${c.id}`, { method: 'POST',
        headers: { Authorization: `OAuth ${env.META_PAGE_TOKEN}`, offset: '0', file_size: String(video.length) }, body: video }), 'Instagram (subida)');
    for (let i = 0; i < 60; i++) { // Instagram procesa el video antes de dejarlo publicar
        const s = await json(await f(`${GRAPH}/${c.id}?fields=status_code,status&access_token=${tk}`), 'Instagram (estado)');
        if (s.status_code === 'FINISHED') break;
        if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram no aceptó el video: ${s.status ?? s.status_code}`);
        if (i === 59) throw new Error('Instagram tardó más de 5 min procesando el video');
        await esperar(pausa);
    }
    const pub = await json(await f(`${GRAPH}/${env.META_IG_USER_ID}/media_publish?creation_id=${c.id}&access_token=${tk}`, { method: 'POST' }), 'Instagram (publicar)');
    return { id: pub.id };
}

/* ---------- TikTok (Content Posting API, publicación directa) ---------- */
export async function publicarTiktok(p, video, env, f = fetch) {
    const h = { Authorization: `Bearer ${env.TIKTOK_ACCESS_TOKEN}`, 'Content-Type': 'application/json; charset=UTF-8' };
    const subir = async (url) => {
        const r = await f(url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${video.length - 1}/${video.length}` }, body: video });
        if (!r.ok) throw new Error(`TikTok (subida): ${r.status}`);
    };
    const fuente = { source: 'FILE_UPLOAD', video_size: video.length, chunk_size: video.length, total_chunk_count: 1 };
    // TIKTOK_MODO=borrador: el video llega a la bandeja de TikTok y el director lo publica con un toque (sirve sin la auditoría de TikTok)
    if (env.TIKTOK_MODO === 'borrador') {
        const b = await json(await f('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', { method: 'POST', headers: h, body: JSON.stringify({ source_info: fuente }) }), 'TikTok (borrador)');
        await subir(b.data.upload_url);
        return { id: b.data.publish_id, privacidad: 'BORRADOR (publícalo desde la app de TikTok)' };
    }
    const info = await json(await f('https://open.tiktokapis.com/v2/post/publish/creator_info/query/', { method: 'POST', headers: h }), 'TikTok (cuenta)');
    const opciones = info.data?.privacy_level_options ?? [];
    const quiere = env.TIKTOK_PRIVACIDAD || 'SELF_ONLY';
    const privacidad = opciones.includes(quiere) ? quiere : (opciones.includes('SELF_ONLY') ? 'SELF_ONLY' : opciones[0]);
    const ini = await json(await f('https://open.tiktokapis.com/v2/post/publish/video/init/', { method: 'POST', headers: h, body: JSON.stringify({
        post_info: { title: p.tiktok.slice(0, 2200), privacy_level: privacidad, disable_comment: false, disable_duet: false, disable_stitch: false, is_aigc: true, brand_content_toggle: false, brand_organic_toggle: true },
        source_info: fuente }) }), 'TikTok (inicio)');
    await subir(ini.data.upload_url);
    return { id: ini.data.publish_id, privacidad };
}

export async function renovarTiktok(env, f = fetch) {
    if (!(env.TIKTOK_REFRESH_TOKEN && env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET)) return null;
    const r = await f('https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: env.TIKTOK_CLIENT_KEY, client_secret: env.TIKTOK_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: env.TIKTOK_REFRESH_TOKEN }) });
    const j = await json(r, 'TikTok (renovar token)');
    return { TIKTOK_ACCESS_TOKEN: j.access_token, TIKTOK_REFRESH_TOKEN: j.refresh_token };
}

export const PUBLICAR = { youtube: publicarYoutube, facebook: publicarFacebook, instagram: publicarInstagram, tiktok: publicarTiktok };

// Escribe o reemplaza variables en .env sin tocar las demás líneas
export function guardarEnv(ruta, valores) {
    let t = fs.existsSync(ruta) ? fs.readFileSync(ruta, 'utf8') : '';
    for (const [k, v] of Object.entries(valores)) {
        const re = new RegExp(`^${k}=.*$`, 'm');
        t = re.test(t) ? t.replace(re, () => `${k}=${v}`) : `${t.replace(/\s*$/, '')}\n${k}=${v}\n`;
    }
    fs.writeFileSync(ruta, t);
}

/* ---------- Ejecución ---------- */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const env = cargarEntorno();
    const args = process.argv.slice(2);
    const PROBAR = args.includes('--probar');
    fs.mkdirSync(SALIDA, { recursive: true });
    const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); fs.appendFileSync(path.join(SALIDA, 'redes.log'), l + '\n'); };

    if (args.includes('--instalar')) {
        const tarea = 'DC Tecnology - redes sociales';
        const ps = `$a = New-ScheduledTaskAction -Execute '${process.execPath}' -Argument '"${path.join(RAIZ, 'herramientas', 'publicar-redes.mjs')}"' -WorkingDirectory '${RAIZ}';
$t = New-ScheduledTaskTrigger -Daily -At '12:40';
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 40);
Register-ScheduledTask -TaskName '${tarea}' -Action $a -Trigger $t -Settings $s -Description 'Publica el video del día en YouTube, Facebook, Instagram y TikTok (DC Tecnology).' -Force | Out-Null`;
        execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
        console.log(`Tarea "${tarea}" instalada: todos los días a las 12:40 p. m. Solo publica con REDES_AUTOMATICAS=si en .env.`);
        process.exit(0);
    }

    if (args.includes('--autorizar-youtube')) {
        if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) { console.error('Primero pon YOUTUBE_CLIENT_ID y YOUTUBE_CLIENT_SECRET en .env (cliente OAuth tipo «App de escritorio»).'); process.exit(1); }
        const PUERTO = 53682, volver = `http://127.0.0.1:${PUERTO}`;
        const url = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: env.YOUTUBE_CLIENT_ID, redirect_uri: volver, response_type: 'code', access_type: 'offline', prompt: 'consent',
            scope: 'https://www.googleapis.com/auth/youtube.upload' })}`;
        console.log(`Abre este enlace con la cuenta de Google del canal y acepta:\n\n${url}\n`);
        try { execFileSync('cmd.exe', ['/c', 'start', '', url.replace(/&/g, '^&')]); } catch { /* lo abre el director */ }
        const codigo = await new Promise((listo) => {
            const srv = http.createServer((req, res) => {
                const c = new URL(req.url, volver).searchParams.get('code');
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(c ? '<h2>Listo. Ya puedes cerrar esta pestaña.</h2>' : '<h2>No llegó el permiso.</h2>');
                if (c) { srv.close(); listo(c); }
            }).listen(PUERTO);
        });
        const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ code: codigo, client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, redirect_uri: volver, grant_type: 'authorization_code' }) });
        const j = await r.json();
        if (!j.refresh_token) { console.error('Google no entregó el permiso permanente:', JSON.stringify(j).slice(0, 300)); process.exit(1); }
        guardarEnv(path.join(RAIZ, '.env'), { YOUTUBE_REFRESH_TOKEN: j.refresh_token });
        console.log('YOUTUBE_REFRESH_TOKEN guardado en .env. Prueba: node herramientas/publicar-redes.mjs --probar');
        process.exit(0);
    }

    const planRuta = path.join(SALIDA, 'redes-plan.json');
    if (!fs.existsSync(planRuta)) { console.error('Falta el plan: node herramientas/generar_redes.js'); process.exit(1); }
    const plan = JSON.parse(fs.readFileSync(planRuta, 'utf8'));
    const regRuta = path.join(SALIDA, 'redes-publicadas.json');
    const registro = fs.existsSync(regRuta) ? JSON.parse(fs.readFileSync(regRuta, 'utf8')) : {};
    const activas = redesActivas(env);
    const carpeta = path.join(RAIZ, require('./estados-plan.json').carpeta);
    const toca = pendientes(plan, registro, Date.now(), PROBAR ? Object.keys(REDES) : activas);

    if (PROBAR) {
        console.log(`Redes con credenciales: ${activas.join(', ') || 'ninguna'} · sin credenciales: ${Object.keys(REDES).filter((r) => !activas.includes(r)).join(', ') || 'ninguna'}`);
        console.log(`Interruptor REDES_AUTOMATICAS=${env.REDES_AUTOMATICAS ?? '(no está)'} · plan: ${plan.length} publicaciones (${plan[0]?.fecha.slice(0, 10)} → ${plan.at(-1)?.fecha.slice(0, 10)})`);
        const prox = plan.find((p) => new Date(p.fecha).getTime() > Date.now());
        if (!toca.length) console.log(`Hoy no toca nada. Próxima: ${prox ? `${prox.fecha} · ${prox.archivo}` : 'ninguna (regenera el plan con generar_redes.js)'}`);
        for (const { red, p } of toca) console.log(`${red}: ${p.archivo} ${fs.existsSync(path.join(carpeta, p.archivo)) ? '' : '(¡FALTA EL ARCHIVO!)'} · ${p.titulo}`);
        const sinArchivo = plan.filter((p) => p.archivo && !fs.existsSync(path.join(carpeta, p.archivo)));
        console.log(sinArchivo.length ? `Videos del plan que no están en ${path.relative(RAIZ, carpeta)}: ${sinArchivo.map((p) => p.archivo).join(', ')}` : 'Todos los videos del plan están en la carpeta.');
        process.exit(0);
    }
    if (!args.includes('--forzar') && String(env.REDES_AUTOMATICAS ?? '').toLowerCase() !== 'si') {
        console.log('Redes automáticas APAGADAS (REDES_AUTOMATICAS=si en .env para activarlas). No se publicó nada.');
        process.exit(0);
    }
    if (!activas.length) { console.log('Ninguna red tiene credenciales en .env. Ver "REDES - CONFIGURAR UNA VEZ.txt".'); process.exit(0); }

    if (activas.includes('tiktok')) {
        try { const n = await renovarTiktok(env); if (n) { Object.assign(env, n); guardarEnv(path.join(RAIZ, '.env'), n); } } catch (e) { log(`tiktok: no pude renovar el token (${e.message})`); }
    }
    const informe = [];
    for (const { red, p } of toca) {
        const ruta = path.join(carpeta, p.archivo);
        if (!fs.existsSync(ruta)) { log(`${red}: falta ${p.archivo}`); informe.push(`⚠️ ${red}: falta el video ${p.archivo}`); continue; }
        try {
            const r = await PUBLICAR[red](p, fs.readFileSync(ruta), env);
            registro[`${p.fecha}|${red}`] = { ...r, archivo: p.archivo, en: new Date().toISOString() };
            fs.writeFileSync(regRuta, JSON.stringify(registro, null, 1));
            log(`${red}: publicado ${p.archivo} ${JSON.stringify(r)}`);
            informe.push(`✅ ${red}: ${p.titulo}${r.url ? ` · ${r.url}` : ''}${r.privacidad && r.privacidad !== 'PUBLIC_TO_EVERYONE' ? ` (privado: ${r.privacidad})` : ''}`);
        } catch (e) {
            log(`${red}: FALLÓ ${p.archivo} · ${e.message}`);
            informe.push(`❌ ${red}: ${e.message.slice(0, 200)}`);
        }
    }
    const admin = String(env.NUMERO_AVISO_ADMIN ?? '').replace(/\D/g, '').replace(/^(3\d{9})$/, '57$1');
    if (informe.length && admin && env.EVOLUTION_URL && env.EVOLUTION_API_KEY && env.EVOLUTION_INSTANCIA) {
        try {
            await fetch(`${env.EVOLUTION_URL.replace(/\/+$/, '')}/message/sendText/${env.EVOLUTION_INSTANCIA}`, { method: 'POST', headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ number: admin, text: ['📣 *Redes de hoy · DC Tecnology*', '', ...informe].join('\n').slice(0, 3800) }), signal: AbortSignal.timeout(30000) });
        } catch (e) { log(`no pude enviarte el informe: ${e.message}`); }
    }
}
