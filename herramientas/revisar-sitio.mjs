// herramientas/revisar-sitio.mjs — Revisa el sitio EN VIVO: cada URL del sitemap responde 200, la portada carga sus estilos y
// scripts versionados, bot-conocimiento.json y el archivo de Shopping son válidos, y las fotos del catálogo visible no están rotas.
//   node herramientas/revisar-sitio.mjs [--rapido]   (--rapido: solo una muestra de 40 fotos)
// Sale con código 1 si algo falla (el vigilante del catálogo lo corre a diario y te avisa).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITIO = 'https://dctecnology.xyz';

export async function enParalelo(items, n, fn) {
    const res = []; let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
    return res;
}
export const urlsDelSitemap = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
export const recursosDePortada = (html) => [...html.matchAll(/(?:src|href)="((?:estilos|js|img)?[^"#]*\.(?:css|js))(\?v=[^"]*)?"/g)].map((m) => m[1] + (m[2] ?? '')).filter((u) => !/^https?:/.test(u));

async function estado(url, metodo = 'HEAD') {
    for (let intento = 0; intento < 2; intento++) {
        try {
            const r = await fetch(url, { method: metodo, redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'DCTecnology-revision/1.0' } });
            if (r.status === 405 && metodo === 'HEAD') return estado(url, 'GET');
            return r.status;
        } catch { /* reintenta una vez */ }
    }
    return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const fallas = [];
    const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) fallas.push(m); };
    // 1) Sitemap
    const xml = await (await fetch(`${SITIO}/sitemap.xml`)).text();
    const urls = urlsDelSitemap(xml);
    const estados = await enParalelo(urls, 8, (u) => estado(u));
    const malas = urls.filter((u, i) => estados[i] !== 200);
    ok(urls.length > 50 && !malas.length, `sitemap: ${urls.length} páginas${malas.length ? ` · sin responder: ${malas.slice(0, 8).join(', ')}` : ''}`);
    // 2) Portada y sus recursos
    const html = await (await fetch(`${SITIO}/`)).text();
    const recursos = recursosDePortada(html);
    const er = await enParalelo(recursos, 8, (u) => estado(`${SITIO}/${u.replace(/^\//, '')}`));
    ok(recursos.length > 5 && er.every((s) => s === 200), `portada: ${recursos.length} estilos y scripts${er.some((s) => s !== 200) ? ` · fallan: ${recursos.filter((_, i) => er[i] !== 200).join(', ')}` : ''}`);
    ok(/www\.dctecnology\.xyz/.test(html) || /dctecnology\.xyz/.test(html), 'la portada muestra la dirección de la tienda');
    // 3) Archivos que leen el bot y Google
    try { const kb = await (await fetch(`${SITIO}/bot-conocimiento.json`)).json(); ok(Array.isArray(kb.catalogo) && kb.catalogo.length > 20, `bot-conocimiento.json válido (${kb.catalogo.length} productos)`); } catch (e) { ok(false, `bot-conocimiento.json: ${e.message}`); }
    try { const f = await (await fetch(`${SITIO}/merchant/productos.xml`)).text(); const n = (f.match(/<item>/g) ?? []).length; ok(n > 20 && /<\/rss>\s*$/.test(f), `Shopping: ${n} productos en merchant/productos.xml`); } catch (e) { ok(false, `merchant/productos.xml: ${e.message}`); }
    // 4) Fotos del catálogo visible
    const productos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8')).filter((p) => !p.oculto && p.imagen);
    let fotos = [...new Set(productos.map((p) => p.imagen))];
    if (process.argv.includes('--rapido')) fotos = fotos.filter((_, i) => i % Math.ceil(fotos.length / 40) === 0);
    const ef = await enParalelo(fotos, 10, (u) => estado(/^https?:/.test(u) ? u : `${SITIO}/${u.replace(/^\//, '')}`));
    const rotas = fotos.filter((_, i) => ef[i] !== 200);
    ok(!rotas.length, `fotos del catálogo: ${fotos.length} revisadas${rotas.length ? ` · ${rotas.length} rotas: ${rotas.slice(0, 5).join(' , ')}` : ''}`);
    const linea = `${new Date().toISOString()} revisión del sitio: ${fallas.length ? `${fallas.length} fallas · ${fallas.join(' | ').slice(0, 600)}` : 'todo OK'}`;
    fs.mkdirSync(path.join(RAIZ, 'herramientas', 'salida'), { recursive: true });
    fs.appendFileSync(path.join(RAIZ, 'herramientas', 'salida', 'revisar-sitio.log'), linea + '\n');
    console.log(linea);
    process.exitCode = fallas.length ? 1 : 0;
}
