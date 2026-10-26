// WO-050 en el flujo: agotados y repuestos de Emprende Red y ANC, cola de estados «¡Volvió!» (jsCode REAL)
const flujo = require(process.argv[2]);
const codigo = (n) => flujo.nodes.find((x) => x.name === n).parameters.jsCode;
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const AsyncF = Object.getPrototypeOf(async () => {}).constructor;
let memoria = {};
let datos = {};
const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
const correr = (n, entrada = [], helpers = {}) => new AsyncF('$', '$input', '$getWorkflowStaticData', codigo(n))
    .call({ helpers }, $, { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) }, () => memoria);
const base = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const cfg = { ...base, numero_aviso_admin: '573125132325' };
(async () => {
    // 1) Emprende Red: resumen y cola
    datos = { 'Config bot': [cfg], 'Leer Emprende Red': [{ items: [{ producto_id: 'er-bafle-1', imagen: 'https://x/bafle.webp' }], nuevos: 0, leidos: 10 }] };
    let r = (await correr('Resultado proveedor', [[{ insertados: 0, actualizados: 2, inactivados: 0, repuestos: [{ producto_id: 'er-bafle-1', producto: 'Bafle Koleer', stock: 4, precio: 45000, categoria: 'TECNOLOGIA' }], agotados: [{ producto_id: 'er-reloj-2', producto: 'Reloj H19' }] }]])).map((x) => x.json);
    ok(r.length === 1 && /Volvió: Bafle Koleer \(4 u\.\)/.test(r[0].texto) && /Se agotó: Reloj H19/.test(r[0].texto), 'te avisa lo que volvió y lo que se agotó');
    ok(memoria.estadosPendientes?.length === 1 && memoria.estadosPendientes[0].imagen === 'https://x/bafle.webp' && /Quedan 4 unidades/.test(memoria.estadosPendientes[0].texto) && /\$45\.000/.test(memoria.estadosPendientes[0].texto), 'estado «¡Volvió!» en la cola, con foto, unidades y precio');
    r = (await correr('Resultado proveedor', [[{ insertados: 0, actualizados: 2, inactivados: 0 }]])).map((x) => x.json);
    ok(r.length === 0, 'sin wo-050 (sin repuestos) no hay avisos nuevos');
    // 2) ANC: disponibilidad desde su tienda
    datos = { 'Config bot': [cfg] };
    const pagina = `<div data-variants="${JSON.stringify([{ option0: 'Pantalla', price_number: 10000, available: false }]).replace(/"/g, '&quot;')}"></div><a class="product-item-name-1">Crunchyroll</a>
        <div data-variants="${JSON.stringify([{ option0: 'Pantalla 26 dias', price_number: 17000 }, { option0: 'Pantalla Internacional 26 dias', price_number: 17000 }]).replace(/"/g, '&quot;')}"></div><a class="product-item-name-2">Netflix</a>`;
    const lectura = (await correr('Leer precios ANC', [], { httpRequest: async (o) => (/page\/2/.test(o.url) ? '' : pagina) }))[0].json;
    ok(lectura.disponibilidad.some((x) => x.producto_id === 'crunchyroll' && x.agotado === true) && lectura.disponibilidad.some((x) => x.producto_id === 'netflix' && x.agotado === false), 'ANC: Crunchyroll agotado y Netflix disponible según su tienda');
    ok(!lectura.disponibilidad.some((x) => x.producto_id === 'disney-plus'), 'lectura incompleta (muchos productos sin encontrar) → no marca agotado lo que no vio');
    datos = { 'Config bot': [cfg], 'Leer precios ANC': [lectura], 'Sincronizar precios ANC': [[{ cambios: [] }]] };
    r = (await correr('Resultado precios ANC', [[{ cambios: 1, repuestos: [{ producto_id: 'vix-premium', variante: 'Pantalla 1 Mes', producto: 'Vix Premium' }], agotados: [{ producto_id: 'crunchyroll', variante: 'Perfil Mega Fan 1 Mes', producto: 'Crunchyroll' }] }]])).map((x) => x.json);
    ok(r.length === 1 && /Volvió: Vix Premium/.test(r[0].texto) && /Agotado: Crunchyroll/.test(r[0].texto), 'te avisa la disponibilidad de ANC');
    ok(memoria.estadosPendientes.length === 2 && /Vix Premium/.test(memoria.estadosPendientes[1].texto), 'Vix Premium entra a la cola de estados');
    r = (await correr('Resultado precios ANC', [{ error: { message: 'function marcar_disponibilidad_anc does not exist' } }])).map((x) => x.json);
    ok(true, 'sin wo-050 aplicado no se rompe');
    // 3) Cola → estado (de día; 2 pendientes se juntan en uno)
    const local = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const deDia = local.getDay() !== 0 && local.getHours() >= 9 && local.getHours() < (local.getDay() === 6 ? 15 : 19);
    let e = (await correr('Estado pendiente')).map((x) => x.json);
    if (deDia) {
        ok(e.length === 1 && e[0].tipo === 'text' && /Volvieron/.test(e[0].texto) && /Bafle Koleer/.test(e[0].texto) && /Vix Premium/.test(e[0].texto), 'varios pendientes → un solo estado «¡Volvieron!»');
        ok((memoria.estadosPendientes ?? []).length === 0 && memoria.estadosHoy.n === 1, 'la cola queda vacía y cuenta 1 estado hoy');
        memoria.estadosPendientes = [{ producto: 'A', imagen: 'https://x/a.webp', texto: 'uno', at: Date.now() }];
        e = (await correr('Estado pendiente')).map((x) => x.json);
        ok(e.length === 1 && e[0].tipo === 'image' && e[0].contenido === 'https://x/a.webp', 'uno solo con foto → estado con imagen');
        memoria.estadosPendientes = [{ producto: 'B', imagen: null, texto: 'dos', at: Date.now() }];
        e = (await correr('Estado pendiente')).map((x) => x.json);
        ok(e.length === 0, 'máximo 2 estados al día');
    } else ok(e.length === 0, 'fuera de horario no publica (se intenta de día)');
    // 4) Contactos → cuerpo del estado
    datos = { 'Estado pendiente': [{ tipo: 'image', contenido: 'https://x/a.webp', texto: '🔔 ¡Volvió! A' }] };
    const cuerpo = (await correr('Lista de contactos', [{ remoteJid: '573001112233@s.whatsapp.net', pushName: 'Ana' }, { remoteJid: '1203@g.us', pushName: 'Grupo' }, { remoteJid: '573004445566@s.whatsapp.net' }]))[0].json;
    ok(cuerpo.type === 'image' && cuerpo.caption === '🔔 ¡Volvió! A' && cuerpo.statusJidList.length === 1, 'estado para los contactos guardados con nombre (sin grupos ni desconocidos)');
    const c = flujo.connections, d = (a, i = 0) => (c[a]?.main?.[i] ?? []).map((x) => x.node);
    ok(d('Origen', 5).includes('Estado pendiente') && d('Estado pendiente').includes('Contactos para estado') && d('Lista de contactos').includes('Publicar estado'), 'rama de 30 min: cola → contactos → publicar');
    ok(d('Sincronizar precios ANC').includes('Disponibilidad ANC') && d('Disponibilidad ANC').includes('Resultado precios ANC'), 'ANC: precios → disponibilidad → resultado');
})();
