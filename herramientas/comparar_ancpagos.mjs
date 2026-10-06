// Compara nuestro catálogo (precios en vivo de la base) con el de ANC Pagos (proveedor = nuestro costo).
//   node herramientas/comparar_ancpagos.mjs [--local]  → informe en herramientas/salida/comparacion-ancpagos.md
// Variantes: se emparejan por la tabla EQUIVALENCIAS (nuestra variante → la del proveedor con el mismo precio y orden).
// Lo que no esté en la tabla se reporta como "sin emparejar"; nunca se adivina.
import fs from 'node:fs';
import { leerAnc } from './catalogo_ancpagos.mjs';

const SUPABASE = 'https://vyqcizwfmjlflncdwzve.supabase.co';
const CLAVE_PUBLICA = 'sb_publishable_GvQiv6M7iSrlwsA90lXsOQ_5OfSYBwy';

// nuestro producto_id → { proveedor: nombre en ANC, variantes: { 'nuestra variante': 'variante ANC' } }
// (herramientas/equivalencias-ancpagos.json: la misma tabla la usa el flujo de n8n para comprar en el portal)
const { _nota, ...equivalencias } = JSON.parse(fs.readFileSync(new URL('./equivalencias-ancpagos.json', import.meta.url), 'utf8'));
export const EQUIVALENCIAS = equivalencias;

// Lo que cambia lo que recibe el cliente. Si nuestro nombre promete otra cosa que la variante que se
// compra, se avisa. El proveedor sin duración = 1 mes; sin dispositivos = no se compara.
function rasgos(t) {
    const meses = /vitalici/i.test(t) ? 'vitalicia' : /\b1\s*a[ñn]o\b|\banual\b/i.test(t) ? 12 : Number(t.match(/\b(\d+)\s*mes(es)?\b/i)?.[1] ?? 0) || null;
    return {
        meses,
        disp: Number(t.match(/\b(\d+)\s*(dispositivos?|equipos?|pcs?)\b/i)?.[1] ?? 0) || null,
        completa: /completa/i.test(t),
        version: t.match(/\b20(16|19|21|24)\b/)?.[0] ?? null,
    };
}
function diferencias(nuestra, proveedor) {
    const a = rasgos(nuestra), b = rasgos(proveedor), d = [];
    const mesesB = b.meses ?? (a.meses === 'vitalicia' ? null : 1);
    if ((a.meses ?? 1) !== mesesB) d.push(`duración ${a.meses ?? 1} → ${mesesB ?? '?'}`);
    if (a.disp && b.disp && a.disp !== b.disp) d.push(`dispositivos ${a.disp} → ${b.disp}`);
    if (a.completa !== b.completa) d.push(a.completa ? 'cuenta completa → pantalla' : 'pantalla → cuenta completa');
    if (a.version && a.version !== b.version) d.push(`versión ${a.version} → ${b.version ?? '?'}`);
    return d;
}

export function comparar(nuestros, anc) {
    const costo = new Map(anc.filas.map((f) => [`${f.producto}|${f.variante}`, f]));
    const usados = new Set();
    const filas = [];
    for (const r of nuestros) {
        const eq = EQUIVALENCIAS[r.producto_id];
        if (!eq) continue;
        const vAnc = eq.variantes[r.variante];
        const f = vAnc ? costo.get(`${eq.proveedor}|${vAnc}`) : null;
        if (f) usados.add(`${eq.proveedor}|${vAnc}`);
        const choques = vAnc ? diferencias(r.variante, vAnc) : [];
        filas.push({
            producto_id: r.producto_id, variante: r.variante, precio: Number(r.precio),
            proveedor: vAnc ? `${eq.proveedor} · ${vAnc}` : null, costo: f?.costo ?? null,
            margen: f ? Number(r.precio) - f.costo : null, nombre_distinto: choques,
            stock: f?.stock ?? null, promo_proveedor: f?.en_promocion ?? false,
        });
    }
    const faltan = anc.filas.filter((f) => !usados.has(`${f.producto}|${f.variante}`) && !f.oculto);
    return { filas, faltan };
}

const pesos = (n) => (n == null ? '—' : `$${Number(n).toLocaleString('es-CO')}`);

if (process.argv[1]?.replace(/\\/g, '/').endsWith('comparar_ancpagos.mjs')) {
    const [anc, vivo] = await Promise.all([
        leerAnc(),
        // --local: compara con productos.json (p. ej. antes de aplicar un SQL de catálogo); por defecto, la base en vivo
        process.argv.includes('--local')
            ? JSON.parse(fs.readFileSync('productos.json', 'utf8')).flatMap((p) => (p.variantes ?? []).map((v) => ({ producto_id: p.id, variante: v.nombre, precio: v.precio })))
            : fetch(`${SUPABASE}/rest/v1/rpc/precios_publicos`, { method: 'POST', headers: { apikey: CLAVE_PUBLICA, 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()),
    ]);
    const { filas, faltan } = comparar(vivo, anc);
    const sinMargen = filas.filter((f) => f.margen != null && f.margen <= 0);
    const nombres = filas.filter((f) => f.nombre_distinto.length);
    const md = [
        `# Catálogo vs ANC Pagos (proveedor)`, '',
        `Leído ${anc.leido_at} · ${anc.filas.length} variantes del proveedor · ${filas.length} nuestras emparejadas.`,
        `Combo del proveedor: ${JSON.stringify(anc.combo?.pct ?? {})}`, '',
        `## Margen (precio de venta − costo del proveedor)`, '',
        '| Producto | Nuestra variante | Precio | Variante del proveedor | Costo | Margen | Stock prov. |', '|---|---|---:|---|---:|---:|---:|',
        ...filas.map((f) => `| ${f.producto_id} | ${f.variante} | ${pesos(f.precio)} | ${f.proveedor ?? '**sin emparejar**'} | ${pesos(f.costo)} | ${f.margen == null ? '—' : f.margen <= 0 ? `**${pesos(f.margen)}**` : pesos(f.margen)} | ${f.stock ?? (f.costo != null ? 'bajo pedido' : '—')} |`),
        '', `**Sin margen o con pérdida: ${sinMargen.length} de ${filas.length}.**`, '',
        `## Nombre distinto a la variante del proveedor con el mismo precio (${nombres.length})`, '',
        ...nombres.map((f) => `- ${f.producto_id} · "${f.variante}" cuesta lo mismo que "${f.proveedor}" (difiere: ${f.nombre_distinto.join(', ')})`), '',
        `## El proveedor los tiene y nosotros no (${faltan.length})`, '',
        ...faltan.map((f) => `- ${f.producto} · ${f.variante} — costo ${pesos(f.costo)}${f.stock != null ? ` (stock ${f.stock})` : ''}`),
    ].join('\n');
    fs.mkdirSync('herramientas/salida', { recursive: true });
    fs.writeFileSync('herramientas/salida/comparacion-ancpagos.md', md);
    fs.writeFileSync('herramientas/salida/comparacion-ancpagos.json', JSON.stringify({ leido_at: anc.leido_at, filas, faltan }, null, 2));
    console.log(`emparejadas ${filas.length} · sin margen ${sinMargen.length} · nombres distintos ${nombres.length} · faltan ${faltan.length}`);
}
