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

export async function leerAnc() {
    const r = await fetch(URL_ANC, { headers: { 'User-Agent': 'Mozilla/5.0 (DC Technology; catálogo proveedor)' } });
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

if (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
    const datos = await leerAnc();
    fs.mkdirSync(SALIDA.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
    fs.writeFileSync(SALIDA, JSON.stringify(datos, null, 2));
    console.log(`${datos.filas.length} variantes de ${new Set(datos.filas.map((f) => f.producto)).size} productos → ${SALIDA}`);
}
