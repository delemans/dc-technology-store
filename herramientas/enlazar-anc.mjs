// herramientas/enlazar-anc.mjs — Enlaza con ANC los productos que ya vendes copiados de su tienda (mismo nombre o mismo modelo)
// para que precio, cantidades y agotados se actualicen solos (n8n «Leer precios ANC» cada 6 h).
//   node herramientas/enlazar-anc.mjs            → muestra qué enlazaría (no cambia nada)
//   node herramientas/enlazar-anc.mjs --aplicar  → escribe herramientas/equivalencias-ancpagos.json
// Solo enlaza cuando TODAS las opciones de tu producto tienen su plan en ANC (por nombre, o producto de una sola opción).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerTiendaAnc } from './catalogo_ancpagos.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUTA_EQ = path.join(RAIZ, 'herramientas', 'equivalencias-ancpagos.json');
export const plano = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sinDias = (x) => plano(x).replace(/\b\d+ dias?\b/g, '').replace(/\s+/g, ' ').trim();
const modelos = (x) => plano(x).split(' ').filter((t) => /\d/.test(t) && /[a-z]/.test(t));

// Propone equivalencias nuevas: productos propios (no Emprende Red) sin enlace cuyo nombre o modelo coincide con uno de ANC
export function proponer(productos, tienda, eq) {
    const enlazados = new Set(Object.keys(eq));
    const usados = new Set(Object.values(eq).map((e) => plano(e.proveedor)));
    const propuestas = {};
    for (const p of productos.filter((x) => !String(x.id).startsWith('er-') && !enlazados.has(x.id))) {
        const candidatos = tienda.filter((a) => !usados.has(plano(a.nombre)) && (plano(a.nombre) === plano(p.nombre)
            || (modelos(p.nombre).length && modelos(p.nombre).join(' ') === modelos(a.nombre).join(' ') && plano(a.nombre).split(' ')[0] === plano(p.nombre).split(' ')[0])));
        if (candidatos.length !== 1) continue;
        const a = candidatos[0];
        const variantes = {};
        for (const v of p.variantes ?? []) {
            const plan = a.variantes.length === 1 && (p.variantes.length === 1) ? a.variantes[0]
                : a.variantes.find((x) => plano(x.nombre) === plano(v.nombre)) ?? a.variantes.find((x) => sinDias(x.nombre) && sinDias(x.nombre) === sinDias(v.nombre));
            if (!plan) break;
            variantes[v.nombre] = plan.nombre;
        }
        if (Object.keys(variantes).length !== (p.variantes ?? []).length) continue;
        propuestas[p.id] = { proveedor: a.nombre, variantes };
        usados.add(plano(a.nombre));
    }
    return propuestas;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const productos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8'));
    const eq = JSON.parse(fs.readFileSync(RUTA_EQ, 'utf8'));
    const { tienda } = await leerTiendaAnc();
    const { _nota, ...actuales } = eq;
    const nuevas = proponer(productos, tienda, actuales);
    if (!Object.keys(nuevas).length) { console.log('Nada nuevo por enlazar: todo lo que coincide con ANC ya está enlazado.'); process.exit(0); }
    for (const [id, e] of Object.entries(nuevas)) console.log(`${id} → ANC «${e.proveedor}»: ${Object.entries(e.variantes).map(([a, b]) => `${a} = ${b || '(única)'}`).join(' · ')}`);
    if (process.argv.includes('--aplicar')) {
        fs.writeFileSync(RUTA_EQ, JSON.stringify({ ...eq, ...nuevas }, null, 2) + '\n');
        console.log(`\n${Object.keys(nuevas).length} enlaces agregados a herramientas/equivalencias-ancpagos.json. Luego: node n8n/generar_flujo_n8n.js y sincronizar n8n.`);
    } else console.log('\n(prueba: agrega --aplicar para guardarlos)');
}
