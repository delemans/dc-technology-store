// Compara nuestro catálogo (precios en vivo de la base) con el de ANC Pagos (proveedor = nuestro costo).
//   node herramientas/comparar_ancpagos.mjs [--local]  → informe en herramientas/salida/comparacion-ancpagos.md
// Variantes: se emparejan por la tabla EQUIVALENCIAS (nuestra variante → la del proveedor con el mismo precio y orden).
// Lo que no esté en la tabla se reporta como "sin emparejar"; nunca se adivina.
import fs from 'node:fs';
import { leerAnc } from './catalogo_ancpagos.mjs';

const SUPABASE = 'https://vyqcizwfmjlflncdwzve.supabase.co';
const CLAVE_PUBLICA = 'sb_publishable_GvQiv6M7iSrlwsA90lXsOQ_5OfSYBwy';

// nuestro producto_id → { proveedor: nombre en ANC, variantes: { 'nuestra variante': 'variante ANC' } }
export const EQUIVALENCIAS = {
    'netflix': { proveedor: 'Netflix', variantes: { 'Pantalla Colombia 26 días': 'Pantalla 26 dias', 'Pantalla Internacional 26 días': 'Pantalla Internacional 26 dias' } },
    'prime-video': { proveedor: 'Prime Video', variantes: { 'Pantalla (1 Dispositivo)': 'Pantalla', 'Cuenta Completa (6 Dispositivos)': 'Cuenta Completa' } },
    'disney-plus': { proveedor: 'Disney Plus', variantes: { 'Pantalla Premium': 'Pantalla Premium' } },
    'hbo-max': { proveedor: 'HBO Max', variantes: { 'Pantalla Estándar 1 Mes': 'Pantalla Estandar', 'Pantalla Platino 1 Mes': 'Pantalla Platino', 'Cuenta Completa Estándar 1 Mes': 'Completa Estandar', 'Cuenta Completa Platino 1 Mes': 'Completa Platino' } },
    'crunchyroll': { proveedor: 'Crunchyroll', variantes: { 'Perfil Mega Fan 1 Mes': 'Pantalla', 'Cuenta Completa 1 Mes': 'Cuenta Completa' } },
    'vix-premium': { proveedor: 'Vix Premium', variantes: { 'Pantalla 1 Mes': 'Pantalla', 'Cuenta Completa 1 Mes': 'Cuenta Completa' } },
    'paramount-plus': { proveedor: 'Paramount Plus', variantes: { 'Pantalla 1 Mes': 'Pantalla', 'Cuenta Completa 1 Mes': 'Cuenta Completa' } },
    'universal-plus': { proveedor: 'Universal Plus', variantes: { 'Pantalla 1 Mes': 'Pantalla', 'Cuenta Completa 1 Mes': 'Cuenta Completa' } },
    'viki-rakuten': { proveedor: 'Viki Rakuten', variantes: { 'Pantalla 1 Mes': 'Pantalla' } },
    'apple-tv': { proveedor: 'Apple TV', variantes: { 'Perfil 1 Mes': 'Pantalla', 'Cuenta Completa 1 Mes': 'Cuenta Completa' } },
    'mubi': { proveedor: 'Mubi', variantes: { 'Perfil 1 Mes': 'Pantalla', 'Cuenta Completa 1 Mes': 'Cuenta Completa' } },
    'iptv-smarters': { proveedor: 'IPTV', variantes: { 'Pantalla 1 Mes': 'Pantalla', 'Cuenta Completa 1 Mes': 'Cuenta Completa', 'Cuenta Completa 2 Meses': 'Completa 2 meses', 'Cuenta Completa 3 Meses': 'Completa 3 meses', 'Cuenta Completa 6 Meses': 'Completa 6 meses', 'Cuenta Completa 12 Meses': 'Completa 12 meses' } },
    'capcut-pro': { proveedor: 'CapCut Pro', variantes: { 'Suscripción 1 Mes': '1 mes' } },
    'canva-pro': { proveedor: 'Canva Pro', variantes: { 'Acceso 1 Mes': '1 mes', 'Acceso 1 Año Completo': '1 Año' } },
    'duolingo-super': { proveedor: 'Duolingo Super', variantes: { 'Suscripción 1 Mes': '1 mes' } },
    'mcafee-antivirus': { proveedor: 'McAfee', variantes: { 'Licencia 1 Año (1 PC)': '1 Año 1 Equipo', 'Licencia 1 Año (5 PCs)': '1 Año 5 Equipos' } },
    'office-365': { proveedor: 'Office 365', variantes: { 'Licencia 1 Año (1 Equipo)': '1 Año 1 Equipo', 'Licencia 1 Año (5 Equipos)': '1 Año 5 Equipos' } },
    'office-2016-2019-2021-2024-pro-plus': { proveedor: 'Office Pro Plus', variantes: { 'Office 2016 Pro Plus': '2016', 'Office 2019 Pro Plus': '2019', 'Office 2021 Pro Plus': '2021', 'Office 2024 Pro Plus': '2024' } },
    'windows-10-y-11-pro-y-home': { proveedor: 'Windows', variantes: { 'Windows 10 Pro Licencia': '10 Pro', 'Windows 11 Pro Licencia': '11 Pro' } },
    'gemini-ia-pro': { proveedor: 'Gemini IA Pro', variantes: { 'Suscripción 1 Mes': '1 Mes' } },
};

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
