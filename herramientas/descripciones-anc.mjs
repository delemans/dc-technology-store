// herramientas/descripciones-anc.mjs — Descripciones de ANC en tu tienda (tecnología y pines enlazados en equivalencias-ancpagos.json).
// Toma de cada página de ANC solo lo del producto (resumen, especificaciones, condiciones, qué incluye) sin nada que delate al
// proveedor (descripcionDesdeAnc) y lo pone en productos.json entre <!--anc--> y <!--/anc-->; tus «Recomendaciones de uso y
// garantía» se conservan debajo. Streaming y licencias no se tocan (llevan tus reglas de uso).
//   node herramientas/descripciones-anc.mjs            → muestra qué cambiaría
//   node herramientas/descripciones-anc.mjs --aplicar  → escribe productos.json (luego: npm run seo y generar_bot_conocimiento)
// Lo corre el vigilante del catálogo cada día con --aplicar.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerTiendaAnc, leerCondicionesAnc, descripcionDesdeAnc } from './catalogo_ancpagos.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUTA = path.join(RAIZ, 'productos.json');
const TIPOS = ['tecnologia', 'pines'];
const MARCA = /<!--anc-->[\s\S]*?<!--\/anc-->/;

// Descripción nueva: bloque de ANC arriba + lo propio (sin el bloque de ANC anterior) debajo
export function combinar(actual, anc) {
    const propio = String(actual ?? '').replace(MARCA, '').trim();
    return `<!--anc-->${anc}<!--/anc-->${propio ? `<br><br>${propio.replace(/^(<br>\s*)+/, '')}` : ''}`;
}

// Reemplaza (o agrega tras "imagen") la línea "descripcion" del producto `id` en el texto de productos.json, sin tocar el resto
export function ponerDescripcion(texto, id, descripcion) {
    const lineas = texto.split('\n');
    const i = lineas.findIndex((l) => l.trim() === `"id": ${JSON.stringify(id)},`);
    if (i < 0) throw new Error(`no encontré ${id} en productos.json`);
    let fin = i; while (fin < lineas.length && !/^ {2}\}/.test(lineas[fin])) fin++;
    const sangria = lineas[i].match(/^\s*/)[0];
    const nueva = `${sangria}"descripcion": ${JSON.stringify(descripcion)},`;
    const d = lineas.slice(i, fin).findIndex((l) => l.trimStart().startsWith('"descripcion":'));
    if (d >= 0) {
        const k = i + d;
        lineas[k] = lineas[k].trimEnd().endsWith(',') ? nueva : nueva.slice(0, -1);
    } else {
        const img = lineas.slice(i, fin).findIndex((l) => l.trimStart().startsWith('"imagen":'));
        lineas.splice(i + (img >= 0 ? img : 0) + 1, 0, nueva);
    }
    return lineas.join('\n');
}

export async function calcular() {
    const productos = JSON.parse(fs.readFileSync(RUTA, 'utf8'));
    const { _nota, ...eq } = JSON.parse(fs.readFileSync(path.join(RAIZ, 'herramientas', 'equivalencias-ancpagos.json'), 'utf8'));
    const { tienda } = await leerTiendaAnc();
    const plano = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const objetivo = Object.entries(eq).map(([id, e]) => ({ id, e, p: productos.find((x) => x.id === id) })).filter((x) => x.p && TIPOS.includes(x.p.tipo));
    const anc = tienda.filter((a) => objetivo.some((o) => plano(o.e.proveedor) === plano(a.nombre)));
    const textos = await leerCondicionesAnc(anc);
    const cambios = [];
    for (const { id, e, p } of objetivo) {
        const t = Object.entries(textos).find(([n]) => plano(n) === plano(e.proveedor))?.[1];
        const html = t && descripcionDesdeAnc(t.texto, e.proveedor);
        if (!html || html.length < 60) continue;
        const nueva = combinar(p.descripcion, html);
        if (nueva !== p.descripcion) cambios.push({ id, nombre: p.nombre, antes: p.descripcion ?? '', nueva });
    }
    return cambios;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const cambios = await calcular();
    if (!cambios.length) { console.log('Descripciones de ANC: sin cambios.'); process.exit(0); }
    for (const c of cambios) console.log(`• ${c.nombre}: ${c.antes ? 'actualiza' : 'agrega'} (${c.nueva.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 90)}…)`);
    if (process.argv.includes('--aplicar')) {
        const crudo = fs.readFileSync(RUTA, 'utf8');
        const crlf = crudo.includes('\r\n');
        let texto = crudo.replace(/\r\n/g, '\n');
        for (const c of cambios) texto = ponerDescripcion(texto, c.id, c.nueva);
        JSON.parse(texto); // nunca se escribe un productos.json roto
        fs.writeFileSync(RUTA, crlf ? texto.replace(/\n/g, '\r\n') : texto);
        console.log(`DESCRIPCIONES ANC: ${cambios.length} productos actualizados en productos.json`);
    } else console.log('(prueba: agrega --aplicar para escribir productos.json)');
}
