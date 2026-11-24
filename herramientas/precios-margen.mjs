// herramientas/precios-margen.mjs — Regla ÚNICA de precio de venta para lo que surte ANC (decisión delegada por el
// director el 24/11/2026: «guardarme siempre mi margen, también con el descuento»).
//   costo = precio de ANC (portal o su tienda pública: son el mismo precio).
//   El precio garantiza un margen NETO mínimo aun con el mayor descuento vigente (cupón de primera compra):
//     precio ≥ costo × (1 + MARGEN) / (1 − DESCUENTO_MAX)   y   precio ≥ (costo + MINIMO) / (1 − DESCUENTO_MAX)
//   Redondeo hacia arriba: a $1.000 (y a $5.000 desde $100.000).
// Con 12 % / 10 % / $2.000: sin cupón el margen queda ≈ 24 %; con el cupón del 10 % nunca baja de 12 % ni de $2.000.
// La misma fórmula está en el flujo de n8n («Leer precios ANC», Config bot: anc_margen, anc_descuento_max, anc_margen_minimo).
export const REGLA = { margen: 12, descuentoMax: 10, minimo: 2000 };

export function precioVenta(costo, regla = REGLA) {
    const c = Number(costo);
    if (!(c > 0)) return null;
    const d = 1 - regla.descuentoMax / 100;
    const bruto = Math.max((c * (1 + regla.margen / 100)) / d, (c + regla.minimo) / d);
    const paso = bruto >= 100000 ? 5000 : 1000;
    return Math.ceil(bruto / paso) * paso;
}

// Margen real de un precio: sin descuento y con el descuento máximo
export function margenes(precio, costo, regla = REGLA) {
    const conDesc = Math.round(precio * (1 - regla.descuentoMax / 100));
    return { sin: precio - costo, sinPct: Math.round(((precio - costo) / precio) * 1000) / 10, con: conDesc - costo, conPct: Math.round(((conDesc - costo) / conDesc) * 1000) / 10 };
}
