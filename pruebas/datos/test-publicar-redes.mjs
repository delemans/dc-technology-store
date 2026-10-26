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
