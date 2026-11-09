// publicar-redes.mjs con las 4 APIs simuladas: orden de pasos, encabezados, marcas de IA, privacidad de TikTok y no repetir
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const m = await import(new URL('../../herramientas/publicar-redes.mjs', import.meta.url).href);
const ok = (c, msg) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${msg}`); if (!c) process.exitCode = 1; };
const resp = (cuerpo, { status = 200, headers = {} } = {}) => new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status, headers });
const p = { fecha: '2026-10-26T17:30:00.000Z', archivo: 'x.mp4', titulo: 'T', youtube: { titulo: 'Título #Shorts', descripcion: 'Desc www.dctecnology.xyz' }, instagram_facebook: 'Texto IG', tiktok: 'Texto TT #DCTecnology' };
const video = Buffer.alloc(1000, 1);

// Pendientes: solo lo vencido en las últimas 20 h, por red, sin repetir
{
    const plan = [{ ...p, fecha: '2026-10-26T17:30:00.000Z' }, { ...p, fecha: '2026-10-25T10:00:00.000Z' }, { ...p, fecha: '2026-10-27T17:30:00.000Z' }];
    const ahora = Date.parse('2026-10-26T18:00:00Z');
    const t = m.pendientes(plan, { '2026-10-26T17:30:00.000Z|youtube': { id: 1 } }, ahora, ['youtube', 'facebook']);
    ok(t.length === 1 && t[0].red === 'facebook' && t[0].p.fecha === '2026-10-26T17:30:00.000Z', 'pendientes: solo el de hoy, en la red que falta (YouTube ya estaba); lo viejo y lo futuro no');
    ok(m.redesActivas({ YOUTUBE_CLIENT_ID: 1, YOUTUBE_CLIENT_SECRET: 1, YOUTUBE_REFRESH_TOKEN: 1, META_PAGE_TOKEN: 't', META_IG_USER_ID: 9 }).join() === 'youtube,instagram', 'redes activas según credenciales');
}
// YouTube
{
    const llamadas = [];
    const f = async (url, o = {}) => { llamadas.push({ url, o });
        if (url.includes('oauth2')) return resp({ access_token: 'AT' });
        if (url.includes('uploadType=resumable')) return resp('', { headers: { location: 'https://subida.youtube/123' } });
        return resp({ id: 'abc' }); };
    const r = await m.publicarYoutube(p, video, { YOUTUBE_CLIENT_ID: 'c', YOUTUBE_CLIENT_SECRET: 's', YOUTUBE_REFRESH_TOKEN: 'r' }, f);
    const meta = JSON.parse(llamadas[1].o.body);
    ok(llamadas.length === 3 && llamadas[2].url === 'https://subida.youtube/123' && llamadas[2].o.method === 'PUT' && llamadas[2].o.body.length === 1000, 'YouTube: token → inicio reanudable → PUT del video a la URL que devuelve');
    ok(meta.status.privacyStatus === 'public' && meta.status.containsSyntheticMedia === true && meta.status.selfDeclaredMadeForKids === false && meta.snippet.title === 'Título #Shorts', 'YouTube: público, declara contenido sintético y no es para niños');
    ok(r.url === 'https://youtube.com/shorts/abc', 'YouTube: devuelve el enlace del Short');
}
// Facebook
{
    const llamadas = [];
    const f = async (url, o = {}) => { llamadas.push({ url, o });
        if (url.includes('upload_phase=start')) return resp({ video_id: 'V1', upload_url: 'https://rupload.facebook.com/video-upload/v21.0/V1' });
        return resp({ success: true }); };
    const r = await m.publicarFacebook(p, video, { META_PAGE_ID: 'PG', META_PAGE_TOKEN: 'TK' }, f);
    ok(llamadas.length === 3 && llamadas[1].o.headers.Authorization === 'OAuth TK' && llamadas[1].o.headers.file_size === '1000', 'Facebook: inicio → subida binaria con OAuth y tamaño → publicar');
    ok(/upload_phase=finish/.test(llamadas[2].url) && /video_state=PUBLISHED/.test(llamadas[2].url) && /description=Texto\+IG/.test(llamadas[2].url) && r.id === 'V1', 'Facebook: publica con la descripción del plan');
}
// Instagram
{
    const llamadas = []; let estados = ['IN_PROGRESS', 'FINISHED'];
    const f = async (url, o = {}) => { llamadas.push({ url, o });
        if (url.includes('/media?')) return resp({ id: 'C1', uri: 'https://rupload.facebook.com/ig-api-upload/v21.0/C1' });
        if (url.includes('fields=status_code')) return resp({ status_code: estados.shift() });
        if (url.includes('media_publish')) return resp({ id: 'M1' });
        return resp({ success: true }); };
    const r = await m.publicarInstagram(p, video, { META_IG_USER_ID: 'IG', META_PAGE_TOKEN: 'TK' }, f, 1);
    ok(/media_type=REELS/.test(llamadas[0].url) && /upload_type=resumable/.test(llamadas[0].url) && llamadas[1].url.endsWith('/C1') && llamadas[1].o.body.length === 1000, 'Instagram: contenedor REELS reanudable → sube el archivo (no necesita URL pública)');
    ok(llamadas.filter((x) => x.url.includes('status_code')).length === 2 && /creation_id=C1/.test(llamadas.at(-1).url) && r.id === 'M1', 'Instagram: espera a FINISHED y luego publica');
    let error = null;
    try { await m.publicarInstagram(p, video, { META_IG_USER_ID: 'IG', META_PAGE_TOKEN: 'TK' }, async (url) => url.includes('status_code') ? resp({ status_code: 'ERROR', status: 'formato' }) : resp({ id: 'C2' }), 1); } catch (e) { error = e.message; }
    ok(/no aceptó/.test(error ?? ''), 'Instagram: si el video es rechazado, falla con el motivo (no publica)');
}
// TikTok
{
    const llamadas = [];
    const f = async (url, o = {}) => { llamadas.push({ url, o });
        if (url.includes('creator_info')) return resp({ data: { privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok', message: '' } });
        if (url.includes('video/init')) return resp({ data: { publish_id: 'P1', upload_url: 'https://subida.tiktok/1' }, error: { code: 'ok' } });
        return resp('', { status: 201 }); };
    const r = await m.publicarTiktok(p, video, { TIKTOK_ACCESS_TOKEN: 'T', TIKTOK_PRIVACIDAD: 'PUBLIC_TO_EVERYONE' }, f);
    const cuerpo = JSON.parse(llamadas[1].o.body);
    ok(r.privacidad === 'SELF_ONLY' && cuerpo.post_info.privacy_level === 'SELF_ONLY', 'TikTok: sin auditoría solo permite SELF_ONLY y se respeta aunque .env pida público');
    ok(cuerpo.post_info.is_aigc === true && cuerpo.source_info.video_size === 1000 && llamadas[2].o.headers['Content-Range'] === 'bytes 0-999/1000', 'TikTok: marca contenido con IA y sube el archivo completo con Content-Range');
}
// TikTok en modo borrador: bandeja de la app, sin post_info
{
    const llamadas = [];
    const f = async (url, o = {}) => { llamadas.push({ url, o });
        if (url.includes('inbox/video/init')) return resp({ data: { publish_id: 'B1', upload_url: 'https://subida.tiktok/b' }, error: { code: 'ok' } });
        return resp('', { status: 201 }); };
    const r = await m.publicarTiktok(p, video, { TIKTOK_ACCESS_TOKEN: 'T', TIKTOK_MODO: 'borrador' }, f);
    ok(llamadas.length === 2 && !JSON.parse(llamadas[0].o.body).post_info && llamadas[1].url === 'https://subida.tiktok/b' && /BORRADOR/.test(r.privacidad), 'TikTok borrador: sube a la bandeja (sin consultar la cuenta ni publicar)');
}
// .env: reemplaza sin tocar lo demás
{
    const ruta = path.join(os.tmpdir(), `env-prueba-${process.pid}`);
    fs.writeFileSync(ruta, 'A=1\nYOUTUBE_REFRESH_TOKEN=viejo\nB=$2\n');
    m.guardarEnv(ruta, { YOUTUBE_REFRESH_TOKEN: 'nu$evo', TIKTOK_ACCESS_TOKEN: 'x' });
    const t = fs.readFileSync(ruta, 'utf8'); fs.rmSync(ruta);
    ok(t === 'A=1\nYOUTUBE_REFRESH_TOKEN=nu$evo\nB=$2\nTIKTOK_ACCESS_TOKEN=x\n', 'guardarEnv: cambia solo esas variables (y respeta los $)');
}
// T10 · --verificar: solo lectura, una línea por red, sin tokens a la vista
{
    const llamadas = [];
    const env = { YOUTUBE_CLIENT_ID: 'c', YOUTUBE_CLIENT_SECRET: 's', YOUTUBE_REFRESH_TOKEN: 'r', META_PAGE_ID: '111', META_PAGE_TOKEN: 'SECRETO-META', META_IG_USER_ID: '222', TIKTOK_ACCESS_TOKEN: 'SECRETO-TT' };
    const f = async (url, o = {}) => { llamadas.push({ url, o });
        if (url.includes('oauth2')) return resp({ access_token: 'AT' });
        if (url.includes('youtube/v3/channels')) return resp({ items: [{ snippet: { title: 'DC Tecnology' } }] });
        if (url.includes('/111?')) return resp({ name: 'DC Tecnology Página' });
        if (url.includes('/222?')) return resp({ error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } }, { status: 401 });
        if (url.includes('user/info')) return resp({ data: { user: { display_name: 'dctecnology' } }, error: { code: 'ok' } });
        return resp({}, { status: 500 }); };
    const r = await m.verificarRedes(env, f);
    const de = (red) => r.find((x) => x.red === red);
    ok(r.length === 4, 'verificar: una línea por red');
    ok(de('youtube').ok && de('youtube').texto === 'DC Tecnology', 'verificar YouTube: token y nombre del canal');
    ok(de('facebook').ok && de('facebook').texto === 'DC Tecnology Página' && de('tiktok').ok && de('tiktok').texto === 'dctecnology', 'verificar Facebook y TikTok: nombre de la cuenta');
    ok(de('instagram').ok === false && /token vencido/.test(de('instagram').texto), `verificar Instagram con 401: motivo simple (${de('instagram').texto})`);
    ok(!JSON.stringify(r).includes('SECRETO') && !JSON.stringify(r).includes('Error validating'), 'verificar: nunca muestra el token ni la respuesta cruda');
    ok(llamadas.every((l) => !l.o.method || l.o.method === 'GET' || l.url.includes('oauth2')) && !llamadas.some((l) => /upload|publish|video_reels|media/.test(l.url)), 'verificar: solo consultas de lectura (nada de subir ni publicar)');
    const sinClaves = await m.verificarRedes({ META_PAGE_ID: '111', META_PAGE_TOKEN: 't' }, f);
    ok(sinClaves.filter((x) => x.ok === null).map((x) => x.red).join() === 'youtube,instagram,tiktok' && sinClaves.find((x) => x.red === 'facebook').ok, 'verificar: red sin claves se salta');
    const r403 = await m.verificarRedes({ YOUTUBE_CLIENT_ID: 'c', YOUTUBE_CLIENT_SECRET: 's', YOUTUBE_REFRESH_TOKEN: 'r' }, async (u) => (u.includes('oauth2') ? resp({ access_token: 'AT' }) : resp({ error: { code: 403 } }, { status: 403 })));
    ok(r403[0].ok && /solo es para subir/.test(r403[0].texto), 'verificar YouTube: con permiso solo de subida (403 al leer el canal) igual confirma las claves');
    const vencido = await m.verificarRedes({ YOUTUBE_CLIENT_ID: 'c', YOUTUBE_CLIENT_SECRET: 's', YOUTUBE_REFRESH_TOKEN: 'r' }, async () => resp({ error: 'invalid_grant' }, { status: 400 }));
    ok(vencido[0].ok === false && /autorización/.test(vencido[0].texto), 'verificar YouTube: permiso revocado → pide autorizar otra vez');
}
{
    const r = await m.verificarRedes({ META_IG_USER_ID: '111', META_PAGE_TOKEN: 't' }, async () => resp({ id: '111' }));
    ok(r.find((x) => x.red === 'instagram').ok === false && /no es una cuenta de Instagram/.test(r.find((x) => x.red === 'instagram').texto), 'verificar Instagram: un ID que no es de Instagram (sin username) se detecta');
}

// T11 · El plan se renueva solo
{
    const dia = (f) => ({ fecha: `${f}T17:30:00.000Z` });
    const plan28 = Array.from({ length: 28 }, (_, i) => dia(new Date(Date.parse('2026-11-16T12:00:00Z') + i * 864e5).toISOString().slice(0, 10))); // lun 16/11 → dom 13/12
    ok(m.inicioPlanSiguiente(plan28, Date.parse('2026-12-03T15:00:00Z')) === null, 'con 10 días por delante no cambia nada');
    ok(m.inicioPlanSiguiente(plan28, Date.parse('2026-12-12T15:00:00Z')) === '2026-12-14', 'si vence mañana → el siguiente desde el lunes después (14/12)');
    ok(m.inicioPlanSiguiente(plan28, Date.parse('2026-12-20T15:00:00Z')) === '2026-12-14', 'si ya venció → desde el lunes de esta semana');
    ok(m.inicioPlanSiguiente([], Date.parse('2026-11-11T15:00:00Z')) === '2026-11-09', 'sin plan → desde el lunes de esta semana');
    const nuevo = Array.from({ length: 28 }, (_, i) => dia(new Date(Date.parse('2026-12-14T12:00:00Z') + i * 864e5).toISOString().slice(0, 10)));
    const unido = m.unirPlanes(plan28, nuevo);
    ok(unido.length === 56 && unido[27].fecha.startsWith('2026-12-13') && unido[28].fecha.startsWith('2026-12-14'), 'conserva los días que quedaban del plan anterior y suma las 4 semanas nuevas');
    const solapado = m.unirPlanes(plan28, nuevo.map((x) => ({ fecha: x.fecha.replace('2026-12-14', '2026-12-10') })).slice(0, 1));
    ok(solapado.filter((x) => x.fecha.startsWith('2026-12-1')).length === 1, 'el plan nuevo manda desde su primer día (sin fechas repetidas)');
}
