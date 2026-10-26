// 23/10/2026: Emprende Red «todo» (categoría 1, lujo = imitación) y ANC con cantidades, en el flujo (jsCode REAL)
const flujo = require(process.argv[2]);
const codigo = (n) => flujo.nodes.find((x) => x.name === n).parameters.jsCode;
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const AsyncF = Object.getPrototypeOf(async () => {}).constructor;
let datos = {};
const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
const correr = (n, entrada = [], helpers = {}) => new AsyncF('$', '$input', '$getWorkflowStaticData', codigo(n))
    .call({ helpers }, $, { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) }, () => ({}));
const cfg = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
(async () => {
    // 1) Emprende Red: la categoría 1 se clasifica y entra; lo de lujo no cuenta como nuevo
    const kb = { catalogo: [{ id: 'er-play-station-5-1-control-900', nombre: 'PS5', tipo: 'tecnologia', variantes: [{ nombre: 'Unidad', precio: 1 }], sincronizado: true },
        { id: 'er-llavero-luna-901', nombre: 'Llavero', tipo: 'variedades', oculto: true, variantes: [{ nombre: 'Unidad', precio: 1 }], sincronizado: true }], plantillas: {} };
    const pagina = { props: { categories: [{ id: 19, name: 'TECNOLOGIA' }], hasMore: false, products: [
        { id: 900, name: 'PLAY STATION 5 + 1 CONTROL', url: 'play-station-5-1-control', category_id: 1, price_buy: 0, price_sale: 1200000, quantity_available: 2, active: 1 },
        { id: 901, name: 'LLAVERO LUNA', url: 'llavero-luna', category_id: 1, price_buy: 0, price_sale: 5000, quantity_available: 9, active: 1 },
        { id: 902, name: 'VAN CLEEF EN ACERO ORO', url: 'van-cleef-oro', category_id: 1, price_buy: 0, price_sale: 20000, quantity_available: 5, active: 1 },
        { id: 903, name: 'LAMPARA USB LED-18', url: 'lampara-usb', category_id: 1, price_buy: 0, price_sale: 10000, quantity_available: 5, active: 1 },
    ] }, version: 'v1' };
    datos = { 'Config bot': [cfg] };
    const helpers = { httpRequest: async (o) => (/bot-conocimiento/.test(o.url) ? kb : `<script data-page="app" type="application/json">${JSON.stringify(pagina)}</script>`) };
    const r = (await correr('Leer Emprende Red', [], helpers))[0].json;
    const ps5 = r.items.find((x) => x.producto_id === 'er-play-station-5-1-control-900'), llavero = r.items.find((x) => x.producto_id === 'er-llavero-luna-901');
    ok(ps5?.categoria === 'TECNOLOGIA' && ps5.costo === 1200000 && ps5.stock === 2, 'categoría 1: la PlayStation 5 va a TECNOLOGIA con su costo y unidades');
    ok(llavero?.categoria === 'GENERAL', 'categoría 1: el llavero va a GENERAL («Otros», oculto)');
    ok(r.nuevos === 1, `solo la lámpara USB cuenta como nueva; Van Cleef (imitación de lujo) no (nuevos: ${r.nuevos})`);
    // 2) ANC: cantidades por plan hacia marcar_disponibilidad_anc
    const tienda = `<div data-variants="${JSON.stringify([{ option0: 'Pantalla 26 dias', price_number: 17000, available: true, stock: 3 }, { option0: 'Pantalla Internacional 26 dias', price_number: 17000, available: true, stock: null }]).replace(/"/g, '&quot;')}"></div><a class="product-item-name-1">Netflix</a>
        <div data-variants="${JSON.stringify([{ price_number: 180000, available: true, stock: 0 }]).replace(/"/g, '&quot;')}"></div><a class="product-item-name-2">Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados</a>`;
    datos = { 'Config bot': [cfg] };
    const l = (await correr('Leer precios ANC', [], { httpRequest: async (o) => (/page\/2/.test(o.url) ? '' : tienda) }))[0].json;
    const net = l.disponibilidad.find((x) => x.producto_id === 'netflix' && /Colombia/.test(x.variante)), inter = l.disponibilidad.find((x) => x.producto_id === 'netflix' && /Internacional/.test(x.variante));
    ok(net?.stock === 3 && net.agotado === false, 'ANC: Netflix con 3 unidades publicadas → stock 3');
    ok(inter && inter.stock === null, 'ANC: sin cantidad publicada → sin límite (null)');
    const reloj = l.disponibilidad.find((x) => x.producto_id === 'reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados');
    ok(reloj?.agotado === true && reloj.stock === 0, 'ANC: reloj D16 (ahora enlazado) con 0 unidades → agotado');
    ok(l.items.some((x) => x.producto_id === 'reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados' && x.precio === 180000), 'ANC: el reloj D16 también sincroniza su precio');
})();
