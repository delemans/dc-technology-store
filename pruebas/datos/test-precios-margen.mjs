// 24/11/2026 · Precios de ANC con margen garantizado: nunca a costo, nunca en pérdida con el cupón (10 %)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { precioVenta, REGLA } from '../../herramientas/precios-margen.mjs';
const require = createRequire(import.meta.url);
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const RAIZ = new URL('../../', import.meta.url);
const ruta = (f) => new URL(f, RAIZ).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ');

// La regla
const casos = [5000, 8000, 10000, 17000, 25900, 45000, 64000, 99000, 130000, 189900];
ok(casos.every((c) => { const p = precioVenta(c); const neto = p * (1 - REGLA.descuentoMax / 100) - c; return neto >= c * REGLA.margen / 100 - 1 && neto >= REGLA.minimo - 1; }), `con el cupón del ${REGLA.descuentoMax} % siempre queda ≥ ${REGLA.margen} % y ≥ $${REGLA.minimo}`);
ok(casos.every((c) => precioVenta(c) % 1000 === 0), 'precios redondos (a $1.000; a $5.000 desde $100.000)');

// El flujo de n8n usa la misma fórmula y no deja vender a costo aunque Config bot diga 0
const flujo = fs.readFileSync(ruta('n8n/generar_flujo_n8n.js'), 'utf8');
ok(/Math\.max\(12, Number\(cfg\.anc_margen\)/.test(flujo) && /precio: precioVenta\(v\.precio\)/.test(flujo), 'n8n: margen mínimo 12 % fijo y la misma fórmula al leer ANC');

// El catálogo: cada plan de ANC visible cobra al menos lo que pide la regla sobre el último costo leído
const comp = ruta('herramientas/salida/comparacion-ancpagos.json');
if (fs.existsSync(comp)) {
    const { filtrar } = require(ruta('herramientas/disponibilidad.js'));
    const eq = JSON.parse(fs.readFileSync(ruta('herramientas/equivalencias-ancpagos.json'), 'utf8'));
    const c = JSON.parse(fs.readFileSync(comp, 'utf8'));
    const prod = filtrar(JSON.parse(fs.readFileSync(ruta('productos.json'), 'utf8'))).filter((p) => !p.oculto && eq[p.id]);
    const malos = [];
    for (const p of prod) for (const v of p.variantes) {
        const f = c.filas.find((x) => x.producto_id === p.id && x.variante === v.nombre && x.costo > 0) ?? (eq[p.id].variantes?.[v.nombre] === '' ? (c.faltan ?? []).find((x) => x.producto === eq[p.id].proveedor && !x.variante && x.costo > 0) : null);
        if (f && Number(v.precio) < precioVenta(f.costo)) malos.push(`${p.id} · ${v.nombre}: ${v.precio} < ${precioVenta(f.costo)}`);
    }
    ok(!malos.length, `ningún plan de ANC por debajo del precio con margen ${malos.slice(0, 4).join(' | ')}`);
}
const sql = fs.readFileSync(ruta('supabase/wo-059-precios-con-margen.sql'), 'utf8');
ok(/planes_en_perdida_con_cupon/.test(sql) && !/emprendered'\)/.test(sql.split('with nuevos')[1] ?? ''), 'wo-059 actualiza la base y verifica que nada quede en pérdida');
