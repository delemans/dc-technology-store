// Emprende Red v2 (19/10/2026): emprendered.com.co, costo = precio de distribuidor, 50 %, categorías ocultas/excluidas
const __RAIZ = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ').replace(/\/$/, '');
import fs from 'node:fs';
const RAIZ = __RAIZ + '';
const m = await import(new URL('../../herramientas/sincronizar-emprendered.mjs', import.meta.url).href);
const ok = (c, msg) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${msg}`); if (!c) process.exitCode = 1; };

ok(m.BASE_EMPRENDERED === 'https://emprendered.com.co', 'lee el catálogo de emprendered.com.co');
ok(m.MARGEN_PCT === 50 && m.precioVenta(16000) === 24000 && m.precioVenta(33800) === 50700, 'precio = costo + 50 % redondeado a $100 (16.000 → 24.000; 33.800 → 50.700)');
const cats = new Map([[19, 'TECNOLOGIA'], [26, 'HOGAR'], [20, 'RELOJERIA REPLICA'], [25, 'SEX SHOP'], [33, 'VAPES'], [21, 'VENDE STREAMING']]);
const n = m.normalizar({ id: 7, name: 'CARGADOR YOOKIE 20W', url: 'cargador-yookie-20w', category_id: 19, price_buy: 0, price_sale: 16000, quantity_available: 6, active: 1, images: [] }, cats);
ok(n.costo === 16000, 'sin price_buy (0): el costo es su precio de distribuidor (price_sale)');
const base = (id, name, cat, extra = {}) => ({ ...m.normalizar({ id, name, url: name.toLowerCase().replace(/\W+/g, '-'), category_id: cat, price_buy: 0, price_sale: 10000, quantity_available: 3, active: 1, images: [{ image_url: 'x.webp' }] }, cats), ...extra });
const datos = { productos: [
    base(1, 'CARGADOR YOOKIE', 19), base(2, 'OLLA ARROCERA', 26), base(3, 'ROLEX AAA', 20), base(4, 'JUGUETE ADULTO', 25),
    base(5, 'VAPE MINT', 33), base(6, 'NETFLIX 1 MES', 21), base(7, 'PILAS AAA ALCALINA X4', 19), base(8, 'AIRPODS 1.1', 19), base(9, 'SIN STOCK', 19, { stock: 0 }),
] };
const t = m.productosTienda(datos);
const nombres = t.map((p) => p.nombre);
ok(t.length === 3 && nombres.includes('Olla Arrocera') && nombres.includes('Pilas AAA Alcalina X4'), `importa lo permitido con stock (${nombres.join(' | ')})`);
ok(!nombres.some((x) => /rolex|adulto|vape|netflix|1\.1|airpods/i.test(x)), 'fuera: réplicas, adultos, vapeadores, streaming de terceros y "1.1"');
const olla = t.find((p) => p.nombre === 'Olla Arrocera'), carg = t.find((p) => /Cargador/.test(p.nombre));
ok(olla.tipo === 'variedades' && olla.categoria === 'Hogar' && olla.oculto === true, 'otra categoría → "variedades", con su nombre y OCULTA por defecto');
ok(carg.tipo === 'tecnologia' && !carg.oculto && carg.variantes[0].precio === 15000 && carg.variantes[0].precio_anterior === null, 'TECNOLOGIA visible, 10.000 → 15.000 y sin precio "antes"');
const sql = m.generarSql(t, '2026-10-19');
ok(sql.includes('"categoria":"HOGAR"') && sql.includes('proveedor_categorias') && !sql.includes('create or replace function public.sincronizar_proveedor'), 'el SQL generado manda la categoría y exige wo-047 (no redefine la función)');

// productos.json publicado: ocultos marcados, ids anteriores conservados
const productos = JSON.parse(fs.readFileSync(`${RAIZ}/productos.json`, 'utf8'));
const er = productos.filter((p) => p.id.startsWith('er-'));
ok(er.length > 100 && er.every((p) => p.oculto ? p.tipo === 'variedades' : p.tipo === 'tecnologia'), `productos.json: ${er.filter((p) => !p.oculto).length} de tecnología visibles y ${er.filter((p) => p.oculto).length} ocultos`);
ok(productos.some((p) => p.id === 'er-cargador-con-cable-original-yookie-20w-rapido-2'), 'se conserva el id anterior del cargador Yookie (página de Google y precio intactos)');

// Nodo "Leer Emprende Red" del flujo (código real) con el proveedor simulado
const flujo = JSON.parse(fs.readFileSync(`${RAIZ}/n8n/flujo_bot_dctechnology.json`, 'utf8'));
const codigo = flujo.nodes.find((x) => x.name === 'Leer Emprende Red').parameters.jsCode;
const kb = { catalogo: [
    { id: 'er-cargador-con-cable-original-yookie-20w-rapido-2', nombre: 'Cargador', tipo: 'tecnologia', variantes: [{ nombre: 'Unidad', precio: 1 }], sincronizado: true },
    { id: 'er-olla-arrocera-55', nombre: 'Olla', tipo: 'variedades', oculto: true, variantes: [{ nombre: 'Unidad', precio: 1 }], sincronizado: true },
], plantillas: {} };
const pagina = { props: { categories: [{ id: 19, name: 'TECNOLOGIA' }, { id: 26, name: 'HOGAR' }], hasMore: false, products: [
    { id: 7, name: 'CARGADOR CON CABLE ORIGINAL YOOKIE 20W RAPIDO', url: 'cargador-con-cable-original-yookie-20w-rapido', category_id: 19, price_buy: 0, price_sale: 16000, quantity_available: 6, active: 1, reference: 'GAR 162' },
    { id: 99, name: 'OLLA ARROCERA', url: 'olla-arrocera', category_id: 26, price_buy: 0, price_sale: 20000, quantity_available: 2, active: 1, reference: 'H1' },
    { id: 100, name: 'TOSTADORA NUEVA', url: 'tostadora-nueva', category_id: 26, price_buy: 0, price_sale: 30000, quantity_available: 4, active: 1, reference: 'H2' },
] }, version: 'v1' };
const urls = [];
const helpers = { httpRequest: async (o) => { urls.push(o.url); if (/bot-conocimiento/.test(o.url)) return kb; return `<html><script data-page="app" type="application/json">${JSON.stringify(pagina)}</script></html>`; } };
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const $ = (nombre) => ({ first: () => ({ json: nombre === 'Config bot' ? { url_conocimiento: 'https://www.dctecnology.xyz/bot-conocimiento.json', emprendered_url: 'https://dctechnology.catalogovirtual.co', emprendered_margen: '40' } : {} }) });
const r = (await new AsyncFunction('$', '$input', '$getWorkflowStaticData', codigo).call({ helpers }, $, { first: () => ({ json: {} }) }, () => ({})))[0].json;
ok(urls[0] === 'https://emprendered.com.co/catalogo', `aunque Config bot tenga el link viejo, lee emprendered.com.co (${urls[0]})`);
const cargador = r.items.find((x) => x.producto_id.includes('yookie'));
ok(cargador && cargador.producto_id === 'er-cargador-con-cable-original-yookie-20w-rapido-2' && cargador.costo === 16000 && cargador.precio === 24000 && cargador.categoria === 'TECNOLOGIA',
    'empareja por slug (id anterior), costo 16.000 → precio 24.000 (50 % aunque Config diga 40) y manda la categoría');
const olla2 = r.items.find((x) => x.producto_id === 'er-olla-arrocera-55');
ok(olla2 && olla2.categoria === 'HOGAR' && olla2.precio === 30000, 'los ocultos también se sincronizan (precio y stock al día para cuando los actives)');
ok(r.nuevos === 1, 'avisa 1 producto nuevo (la tostadora) de cualquier categoría permitida');
{
    const d2 = { productos: [base(20, 'CARGADOR RAPIDO X', 19, { stock: 0 }), base(21, 'CABLE NUEVO Z', 19, { stock: 0 })] };
    const conservar = new Set([m.idDc(d2.productos[0]).replace(/-\d+$/, '')]);
    const t2 = m.productosTienda(d2, conservar);
    ok(t2.length === 1 && t2[0].agotado === true && t2[0].existencias === 0, 'lo que ya estaba en la tienda y se agota queda como «agotado»; lo nuevo sin unidades no entra');
}
