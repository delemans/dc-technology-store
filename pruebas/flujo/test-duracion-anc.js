// ANC: si cambia la duración del plan (días), te avisa una vez al día (jsCode REAL)
const flujo = require(process.argv[2]);
const codigo = (n) => flujo.nodes.find((x) => x.name === n).parameters.jsCode;
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const AsyncF = Object.getPrototypeOf(async () => {}).constructor;
const memoria = {};
let datos = {};
const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
const correr = (n, entrada = [], helpers = {}) => new AsyncF('$', '$input', '$getWorkflowStaticData', codigo(n))
    .call({ helpers }, $, { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) }, () => memoria);
const base = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const cfg = { ...base, numero_aviso_admin: '573125132325' };
const pagina = (plan, precio) => `<div data-variants="${JSON.stringify([{ option0: plan, price_number: precio }]).replace(/"/g, '&quot;')}"></div><a class="product-item-name-1">Netflix</a>`;
(async () => {
    datos = { 'Config bot': [cfg] };
    const helpers = (plan, precio) => ({ httpRequest: async (o) => (/page\/2/.test(o.url) ? '' : pagina(plan, precio)) });
    let lectura = (await correr('Leer precios ANC', [], helpers('Pantalla 26 dias', 17000)))[0].json;
    const net = lectura.items.find((x) => x.producto_id === 'netflix' && /Colombia/.test(x.variante));
    ok(net && net.costo === 17000 && net.variante === 'Pantalla Colombia 30 días', 'empareja el plan aunque cambien los días (precio 17.000)');
    ok(lectura.duraciones.some((d) => d.producto_id === 'netflix' && d.nuestros === 30 && d.suyos === 26), 'detecta la diferencia: tú 30 días, ANC 26 días');
    datos = { 'Config bot': [cfg], 'Leer precios ANC': [lectura], 'Sincronizar precios ANC': [[{ actualizados: 0, sin_cambio: 1, omitidos: 0, cambios: [] }]] };
    let r = (await correr('Resultado precios ANC', [[{ actualizados: 0, sin_cambio: 1, omitidos: 0, cambios: [] }]])).map((x) => x.json);
    ok(r.length === 1 && /duración cambió en ANC/.test(r[0].texto) && /30 días\*.*26 días/.test(r[0].texto.replace(/\n/g, ' ')), 'te avisa por WhatsApp aunque el precio no cambie');
    r = (await correr('Resultado precios ANC', [[{ cambios: [] }]])).map((x) => x.json);
    ok(r.length === 0, 'el mismo aviso no se repite en el día');
    lectura = (await correr('Leer precios ANC', [], helpers('Pantalla 30 dias', 17000)))[0].json;
    ok(!lectura.duraciones.some((d) => d.producto_id === 'netflix'), 'cuando ANC también dice 30 días, no hay aviso');
})();
