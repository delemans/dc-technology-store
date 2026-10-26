// herramientas/resumen-catalogo.js — Resumen corto del catálogo para las IA (productos.json pesa ~650 KB y las IA gratis no lo leen
// entero). Solo lo que la tienda muestra hoy (sin ocultos ni lo que ya no hay), con precio «desde» real y su página.
// Lo regenera `npm run seo` (y por eso el vigilante diario). Salida: docs/catalogo-resumen.md
const fs = require('fs');
const path = require('path');
const { filtrar } = require('./disponibilidad.js');

const RAIZ = path.resolve(__dirname, '..');
const NOMBRES = { servicios: 'Servicios técnicos', alquiler: 'Alquiler', tecnologia: 'Tecnología', streaming: 'Streaming', licencias: 'Licencias', pines: 'Pines y regalos', recargas: 'Recargas', variedades: 'Variedades' };
const pesos = (n) => '$ ' + Math.round(n).toLocaleString('es-CO');

function generar() {
    const crudo = JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8'));
    const todos = Array.isArray(crudo) ? crudo : crudo.productos;
    const visibles = filtrar(todos.filter((p) => !p.oculto));
    const grupos = {};
    for (const p of visibles) {
        const precios = (p.variantes ?? []).map((v) => Number(v.precio)).filter((n) => n > 0);
        if (!precios.length) continue;
        (grupos[p.tipo] = grupos[p.tipo] ?? []).push({ p, desde: Math.min(...precios), planes: p.variantes.length });
    }
    const lineas = [
        '# Catálogo resumido de DC Tecnology (para las IA)',
        `_Generado por herramientas/resumen-catalogo.js el ${new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })} a partir de productos.json y disponibilidad.json. No editar a mano._`,
        '',
        'Precios en pesos colombianos. Son los de productos.json: en la tienda manda el precio de la base (precios_publicos), que puede cambiar.',
        '**Antes de publicar un precio, confírmalo en la página del producto.** Para el detalle de un producto: busca su id en productos.json (no lo leas entero).',
        '',
    ];
    for (const tipo of Object.keys(NOMBRES).filter((t) => grupos[t])) {
        const filas = grupos[tipo].sort((a, b) => a.desde - b.desde);
        lineas.push(`## ${NOMBRES[tipo]} (${filas.length})`, '');
        for (const { p, desde, planes } of filas) lineas.push(`- ${p.nombre} · desde ${pesos(desde)}${planes > 1 ? ` · ${planes} planes` : ''} · id \`${p.id}\` · https://www.dctecnology.xyz/p/${p.id}.html`);
        lineas.push('');
    }
    fs.mkdirSync(path.join(RAIZ, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(RAIZ, 'docs', 'catalogo-resumen.md'), lineas.join('\n'));
    return visibles.length;
}

if (require.main === module) console.log(`docs/catalogo-resumen.md: ${generar()} productos visibles`);
module.exports = { generar };
