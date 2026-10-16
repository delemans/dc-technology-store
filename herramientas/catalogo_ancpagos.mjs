// Lee el catálogo público de ANC Pagos (proveedor) y lo deja en JSON para compararlo con el nuestro.
//   node herramientas/catalogo_ancpagos.mjs [salida.json]
// El catálogo viene dentro de la página (variables CATALOGO_INICIAL_IDX, STOCK_INICIAL_IDX, …):
// no hace falta navegador ni sesión. Sus precios son NUESTRO COSTO.
import fs from 'node:fs';

const URL_ANC = 'https://ancpagos.com/';
const SALIDA = process.argv[2] ?? 'herramientas/salida/ancpagos.json';

// Extrae el literal JSON asignado a `const NOMBRE = …` contando llaves/corchetes (respeta cadenas)
export function variable(html, nombre) {
    const i = html.indexOf(`const ${nombre}`);
    if (i < 0) return null;
    const s = html.indexOf('=', i) + 1;
    let prof = 0, cadena = null, j = s;
    for (; j < html.length; j++) {
        const c = html[j];
        if (cadena) { if (c === '\\') j++; else if (c === cadena) cadena = null; continue; }
        if (c === '"' || c === "'") cadena = c;
        else if (c === '{' || c === '[') prof++;
        else if (c === '}' || c === ']') { prof--; if (prof === 0) break; }
    }
    try { return JSON.parse(html.slice(s, j + 1).trim()); } catch { return null; }
}

export async function leerPortalAnc() {
    const r = await fetch(URL_ANC, { headers: { 'User-Agent': 'Mozilla/5.0 (DC Tecnology; catálogo proveedor)' } });
    if (!r.ok) throw new Error(`ancpagos.com respondió ${r.status}`);
    const html = await r.text();
    const catalogo = variable(html, 'CATALOGO_INICIAL_IDX');
    if (!catalogo) throw new Error('No encontré CATALOGO_INICIAL_IDX: el sitio cambió de estructura.');
    const stock = variable(html, 'STOCK_INICIAL_IDX') ?? {};
    const categorias = variable(html, 'dictCategoriasPorProducto') ?? {};
    const ocultos = variable(html, 'productosOcultosIdx') ?? [];
    const combo = variable(html, 'COMBO_CANTIDAD_IDX');
    const filas = [];
    for (const [producto, variantes] of Object.entries(catalogo)) {
        for (const [variante, v] of Object.entries(variantes)) {
            filas.push({
                producto, variante, costo: v.precio,
                en_promocion: Boolean(v.en_promocion), costo_normal: v.precio_normal ?? null,
                bajo_pedido: Boolean(v.bajo_pedido), stock: stock[producto]?.[variante] ?? null,
                categorias: categorias[producto] ?? [], oculto: ocultos.includes(producto),
            });
        }
    }
    return { leido_at: new Date().toISOString(), fuente: URL_ANC, combo, filas };
}

// Respaldo cuando el portal está en mantenimiento: la tienda pública de ANC (allnecessarycolombia.com, Tiendanube)
// tiene los mismos precios. Se traduce a los nombres del portal con la tabla de equivalencias (mismo producto;
// plan igual, o igual sin "26 días"), así comparar y costos funcionan igual. Lo que no empareja no se inventa.
const URL_TIENDA = 'https://allnecessarycolombia.com/productos/';
const plano = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sinDias = (x) => plano(x).replace(/\b\d+ dias?\b/g, '').replace(/\s+/g, ' ').trim();

export async function leerTiendaAnc() {
    const productos = [];
    for (let n = 1; n <= 10; n++) {
        const r = await fetch(n === 1 ? URL_TIENDA : `${URL_TIENDA}page/${n}/`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' } });
        if (!r.ok) { if (n === 1) throw new Error(`allnecessarycolombia.com respondió ${r.status}`); break; }
        const html = await r.text();
        const antes = productos.length;
        const re = /data-variants="([^"]+)"[\s\S]*?product-item-name-\d+">([^<]+)/g;
        for (let m; (m = re.exec(html));) {
            const variantes = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
            productos.push({ nombre: m[2].trim(), variantes: variantes.map((v) => ({
                nombre: [v.option0, v.option1, v.option2].filter(Boolean).join(' / '), precio: Number(v.price_number) || null, disponible: v.available !== false })) });
        }
        if (productos.length === antes) break;
    }
    const { _nota, ...eq } = JSON.parse(fs.readFileSync(new URL('./equivalencias-ancpagos.json', import.meta.url), 'utf8'));
    const filas = [];
    for (const { proveedor, variantes } of Object.values(eq)) {
        const p = productos.find((x) => plano(x.nombre) === plano(proveedor));
        for (const plan of new Set(Object.values(variantes))) {
            const v = p?.variantes.find((x) => plano(x.nombre) === plano(plan)) ?? p?.variantes.find((x) => sinDias(x.nombre) === sinDias(plan));
            if (!v || filas.some((f) => f.producto === proveedor && f.variante === plan)) continue;
            filas.push({ producto: proveedor, variante: plan, costo: v.precio, en_promocion: false, costo_normal: null, bajo_pedido: false,
                stock: v.disponible ? null : 0, agotado: !v.disponible, categorias: [], oculto: false, tienda: `${p.nombre} · ${v.nombre || 'única'}` });
        }
    }
    return { leido_at: new Date().toISOString(), fuente: URL_TIENDA, respaldo: true, combo: null, filas, tienda: productos };
}

// Portal primero; si no responde (mantenimiento), la tienda pública
export async function leerAnc() {
    try {
        return await leerPortalAnc();
    } catch (error) {
        console.warn(`⚠ ancpagos.com no respondió (${error.message}): uso su tienda pública ${URL_TIENDA}`);
        return leerTiendaAnc();
    }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('catalogo_ancpagos.mjs')) {
    const datos = await leerAnc();
    fs.mkdirSync(SALIDA.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
    fs.writeFileSync(SALIDA, JSON.stringify(datos, null, 2));
    console.log(`${datos.filas.length} variantes de ${new Set(datos.filas.map((f) => f.producto)).size} productos → ${SALIDA}`);
}
