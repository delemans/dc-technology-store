// herramientas/disponibilidad-proveedores.mjs — Qué NO se muestra en la tienda porque ya no lo hay (25/10/2026, pedido del director:
// «que no salga lo que ya no hay ni en ANC ni en Emprende Red»). Escribe disponibilidad.json en la raíz del sitio; lo leen la
// tienda (app.js), las páginas de Google (generar_seo.js), Shopping y el bot (generar_bot_conocimiento.js).
//   · ANC: cada plan enlazado (equivalencias-ancpagos.json) se busca en ANC (portal si responde; si no, su tienda pública).
//     Plan que ANC ya no ofrece o tiene agotado → ese plan no sale. Producto sin ningún plan disponible → no sale.
//   · Sin proveedor: productos propios que no son servicios y no están enlazados a ANC (recargas, apuestas, pines sin
//     proveedor…) → no salen.
//   · Emprende Red: los agotados (sin unidades) no salen; vuelven solos cuando el proveedor repone.
// Freno: si la lectura de ANC encuentra menos del 60 % de lo enlazado, no se cambia nada (pudo ser una falla de lectura).
// Cuando algo vuelve a estar disponible, sale solo en la siguiente corrida (vigilante diario + cada vez que lo corras).
//   node herramientas/disponibilidad-proveedores.mjs            → muestra el resultado
//   node herramientas/disponibilidad-proveedores.mjs --aplicar  → escribe disponibilidad.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { leerAnc, leerTiendaAnc } from './catalogo_ancpagos.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'disponibilidad.json');
const PROPIOS_SIEMPRE = ['servicios', 'alquiler']; // lo hace DC Tecnology: siempre disponible
export const plano = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sinDias = (x) => plano(x).replace(/\b\d+ dias?\b/g, '').replace(/\s+/g, ' ').trim();

// Núcleo puro (se prueba sin red): productos, equivalencias y la lectura de ANC → qué se oculta
export function calcular(productos, eq, anc) {
    const ocultos = {}, variantes = {};
    let enlazados = 0, encontrados = 0;
    const deAnc = (proveedor, plan) => {
        const filas = anc.filter((f) => plano(f.producto) === plano(proveedor));
        if (!filas.length) return null;
        return filas.find((f) => plano(f.variante) === plano(plan)) ?? filas.find((f) => sinDias(f.variante) && sinDias(f.variante) === sinDias(plan))
            ?? (filas.length === 1 && !plan ? filas[0] : undefined);
    };
    for (const p of productos) {
        if (String(p.id).startsWith('er-')) {
            if (p.agotado || Number(p.existencias) === 0) ocultos[p.id] = 'Emprende Red: sin unidades';
            continue;
        }
        if (PROPIOS_SIEMPRE.includes(p.tipo) || String(p.id).startsWith('servicio-')) continue;
        const e = eq[p.id];
        if (!e) { ocultos[p.id] = 'Sin proveedor (no está en ANC ni en Emprende Red)'; continue; }
        enlazados++;
        let alguno = false, visto = false;
        for (const v of p.variantes ?? []) {
            const plan = e.variantes?.[v.nombre];
            if (plan === undefined) { (variantes[p.id] ??= {})[v.nombre] = 'Sin plan equivalente en ANC'; continue; }
            const f = deAnc(e.proveedor, plan);
            if (f === null) continue; // producto no encontrado: se decide abajo
            visto = true;
            if (!f) (variantes[p.id] ??= {})[v.nombre] = 'ANC ya no ofrece este plan';
            else if (f.agotado || f.stock === 0) (variantes[p.id] ??= {})[v.nombre] = 'Agotado en ANC';
            else alguno = true;
        }
        if (visto) encontrados++;
        if (!visto) { ocultos[p.id] = 'ANC ya no ofrece este producto'; delete variantes[p.id]; }
        else if (!alguno) { ocultos[p.id] = 'Agotado o retirado en ANC'; delete variantes[p.id]; }
    }
    return { ocultos, variantes, enlazados, encontrados };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const productos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8'));
    const { _nota, ...eq } = JSON.parse(fs.readFileSync(path.join(RAIZ, 'herramientas', 'equivalencias-ancpagos.json'), 'utf8'));
    // Portal si responde (tiene más planes); si no, la tienda pública. Ambas se traducen a «producto · plan» de ANC
    let lectura;
    try { lectura = await leerAnc(); } catch { lectura = await leerTiendaAnc(); }
    const anc = lectura.respaldo
        ? (lectura.tienda ?? []).flatMap((p) => p.variantes.map((v) => ({ producto: p.nombre, variante: v.nombre, agotado: !v.disponible, stock: v.stock })))
        : lectura.filas.map((f) => ({ producto: f.producto, variante: f.variante, agotado: f.oculto || f.stock === 0, stock: f.stock }));
    const r = calcular(productos, eq, anc);
    const fuente = lectura.respaldo ? 'tienda pública de ANC (el portal no respondió)' : 'portal de ANC';
    console.log(`Fuente: ${fuente} · enlazados ${r.enlazados}, encontrados ${r.encontrados}`);
    console.log(`No salen: ${Object.keys(r.ocultos).length} productos y ${Object.values(r.variantes).reduce((s, x) => s + Object.keys(x).length, 0)} planes`);
    const porMotivo = {};
    for (const [id, m] of Object.entries(r.ocultos)) (porMotivo[m] ??= []).push(id);
    for (const [m, ids] of Object.entries(porMotivo)) console.log(`  · ${m}: ${ids.length}${ids.length <= 12 ? ` (${ids.join(', ')})` : ''}`);
    for (const [id, vs] of Object.entries(r.variantes)) console.log(`  · ${id}: ${Object.entries(vs).map(([v, m]) => `${v} (${m})`).join(' · ')}`);
    if (r.enlazados && r.encontrados < r.enlazados * 0.6) {
        console.log(`⚠️ Lectura incompleta de ANC (${r.encontrados}/${r.enlazados}): no se cambia disponibilidad.json`);
        process.exit(0);
    }
    if (process.argv.includes('--aplicar')) {
        const nuevo = { _nota: 'Generado por herramientas/disponibilidad-proveedores.mjs: lo que no se muestra porque ya no lo hay en ANC ni en Emprende Red.', fuente, ocultos: r.ocultos, variantes: r.variantes };
        const antes = fs.existsSync(SALIDA) ? JSON.parse(fs.readFileSync(SALIDA, 'utf8')) : null;
        const igual = antes && JSON.stringify({ ...antes, actualizado: undefined }) === JSON.stringify({ ...nuevo, actualizado: undefined });
        if (igual) { console.log('DISPONIBILIDAD: sin cambios'); process.exit(0); }
        fs.writeFileSync(SALIDA, JSON.stringify({ ...nuevo, actualizado: new Date().toISOString() }, null, 1) + '\n');
        console.log('DISPONIBILIDAD: actualizada (disponibilidad.json)');
    }
}
