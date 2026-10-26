// Modo de compra MANUAL: jsCode REAL de los nodos → avisos al director en el momento correcto
const __RAIZ = require('path').resolve(__dirname, '../..').replace(/\\/g, '/');
const fs = require('fs');
const flujo = require(process.argv[2]);
const codigo = (n) => flujo.nodes.find((x) => x.name === n).parameters.jsCode;
const memoria = {};
let datos = {};
const ejecutar = (n, entrada = []) => new Function('$', '$input', '$getWorkflowStaticData', codigo(n))(
    (k) => ({ first: () => ({ json: datos[k]?.[0] ?? {} }), all: () => (datos[k] ?? []).map((json) => ({ json })) }),
    { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) }, () => memoria);
const terminado = (fn) => { try { fn(); return null; } catch (e) { const m = /TERMINAR (\{.*\})/s.exec(e.message); return m ? JSON.parse(m[1]) : { otro: e.message }; } };
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const base = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const cfg = { ...base, numero_aviso_admin: '3125132325', numero_proveedor: '' };
const INICIO = fs.readFileSync(`${__dirname}/anc/inicio.html`, 'utf8');

ok(base.canal_compra === 'manual', `canal de compra por defecto: ${base.canal_compra}`);
// 1) Pedido por chat (sin pagar)
datos = { 'Config bot': [cfg], 'Normalizar mensaje': [{ numero: '573001112255', nombre: 'Ana' }] };
const T = ejecutar('Crear triangulación', [{ numero: '573001112255', pedido: { producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 30 días', precio: 15000 } }])[0]?.json;
ok(T && T.manual && T.canal === 'web', 'pedido por chat en modo manual → no hace falta el WhatsApp del proveedor');
datos = { ...datos, 'Crear triangulación': [T], 'Catálogo ANC': [{ data: INICIO }], 'Medios de pago ANC': [{}], 'Tienda ANC (respaldo)': [{ omitido: true }], 'Vincular al panel': [{ ok: true }] };
const cot = ejecutar('Cotización ANC')[0].json.body;
const r1 = terminado(() => ejecutar('Evaluar cotización', [{ body: cot }]));
ok(r1?.estado === 'REVISION_MANUAL' && /aún no paga/.test(r1.avisoAdmin) && /Paso a paso/.test(r1.avisoAdmin) && /#ok DC-/.test(r1.avisoAdmin) && /Netflix · Pantalla 26 dias\* \(\$15\.000\)/.test(r1.avisoAdmin) && /322 328 4622/.test(r1.avisoAdmin), 'pedido nuevo: paso a paso (espera comprobante → #ok → compra en ANC con el WhatsApp del bot → entrega automática)');
ok(r1.avisoCliente === null, 'al cliente no le llega ningún aviso de demora');
console.log('   ' + r1.avisoAdmin.replace(/\n/g, '\n   '));
// 2) Llega su comprobante → tu aviso con el pedido y el monto a validar
datos = { 'Config bot': [cfg] };
const c = ejecutar('Comprobante recibido', [{ numero: '573001112255', nombre: 'Ana', texto: '' }]);
ok(c.length === 2 && /Recibimos tu comprobante/.test(c[0].json.texto) && /revisando tu pago/.test(c[0].json.texto) && !/minutos|proveedor|ANC/.test(c[0].json.texto), 'al cliente: solo «estamos revisando tu pago» (sin tiempos ni proveedor)');
ok(c[1].json.numero === '573125132325' && /#DC-/.test(c[1].json.texto) && /llegaron \*\$15\.000\*/.test(c[1].json.texto) && /#ok DC-/.test(c[1].json.texto) && /#no DC-/.test(c[1].json.texto) && /Netflix · Pantalla 26 dias/.test(c[1].json.texto), 'a ti: el monto a revisar y los comandos #ok / #no');
console.log('   ' + c[1].json.texto.replace(/\n/g, '\n   '));
// 3) Pedido web (pago ya validado en el panel)
datos = { 'Config bot': [cfg], 'Normalizar mensaje': [{}] };
const W = ejecutar('Crear triangulación', [{ numero: '573001119999', nombre: 'Luis', pedido: { referencia: 'DC-WEB01', producto: 'Prime Video Ultra HD', variante: 'Pantalla (1 Dispositivo)', precio: 10000 } }])[0].json;
datos = { ...datos, 'Crear triangulación': [W], 'Catálogo ANC': [{ data: 'mantenimiento' }], 'Medios de pago ANC': [{}],
    'Tienda ANC (respaldo)': [{ fuente: 'x', productos: [{ nombre: 'Prime Video', variantes: [{ nombre: 'Pantalla', precio: 10000, disponible: true }] }] }], 'Vincular al panel': [{ ok: true }] };
const r3 = terminado(() => ejecutar('Evaluar cotización', [{ body: ejecutar('Cotización ANC')[0].json.body }]));
ok(/Pedido web PAGADO/.test(r3.avisoAdmin) && /1️⃣ Compra en ANC \(allnecessarycolombia\.com\)/.test(r3.avisoAdmin) && /#entregar DC-WEB01/.test(r3.avisoAdmin) && r3.avisoCliente === null, 'pedido web pagado → qué comprar y que la cuenta la entregas con #entregar (modo manual)');
// 4) Combo por chat en manual
datos = { 'Config bot': [cfg], 'Normalizar mensaje': [{ numero: '573001114444', nombre: 'Eva' }] };
const C = ejecutar('Crear combo', [{ numero: '573001114444', combo: { items: [{ producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 30 días', precio: 15000 }, { producto: 'Prime Video Ultra HD', variante: 'Pantalla (1 Dispositivo)', precio: 10000 }], pct: 10, total: 22500 } }])[0]?.json;
ok(C && C.manual, 'combo por chat sin WhatsApp del proveedor → ya no se pierde');
datos = { ...datos, 'Crear combo': [C] };
const r4 = terminado(() => ejecutar('Combo manual', [{}]));
ok(r4?.estado === 'REVISION_MANUAL' && /Combo nuevo · ⏳ AÚN NO HA PAGADO/.test(r4.avisoAdmin) && /ANC: \*Netflix · Pantalla 26 dias\*/.test(r4.avisoAdmin) && /\$22\.500/.test(r4.avisoAdmin) && /Paso a paso/.test(r4.avisoAdmin), 'combo → cada plataforma con su plan en ANC y paso a paso');
datos = { 'Config bot': [cfg] };
ok(/llegaron \*\$22\.500\*/.test(ejecutar('Comprobante recibido', [{ numero: '573001114444' }])[1].json.texto), 'su comprobante → monto del combo a revisar');
// 5) Canal whatsapp: el combo sigue al proveedor como antes
const cfgW = { ...cfg, canal_compra: 'whatsapp', numero_proveedor: '573054004508' };
datos = { 'Config bot': [cfgW], 'Normalizar mensaje': [{ numero: '573001115555' }] };
const CW = ejecutar('Crear combo', [{ numero: '573001115555', combo: { items: [{ producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 30 días', precio: 15000 }, { producto: 'Disney Plus Premium', variante: 'Pantalla Premium', precio: 15000 }], pct: 10, total: 27000 } }])[0].json;
datos = { ...datos, 'Crear combo': [CW] };
ok(!CW.manual && ejecutar('Combo manual', [{ x: 1 }]).length === 1, 'canal whatsapp: el combo sigue al proveedor como antes');
// 6) Cupón DCTECH2026: solo si el cliente lo escribió; el precio lo calcula el sistema
const kb = require(__RAIZ + '/bot-conocimiento.json');
const revisar = (texto, output, numero = '573001117000') => {
    datos = { 'Config bot': [cfg], 'Normalizar mensaje': [{ numero, texto, nombre: 'Leo' }], 'Base de conocimiento': [kb], 'Metodos de pago': [], 'Reglas combo': [] };
    return ejecutar('Revisar respuesta', [{ output }]);
};
const marca = '[PEDIDO_DIGITAL] {"producto":"Netflix Premium 4K","variante":"Pantalla Colombia 30 días","cupon":"DCTECH2026"}';
let rc = revisar('confirmo la pantalla colombia', `Listo ✅\n${marca}`);
ok(rc[0].json.pedido?.precio === 15000 && !rc[0].json.pedido.cupon, 'la IA pone el cupón pero el cliente NO lo escribió → precio normal ($15.000)');
rc = revisar('confirmo, con el cupon DCTECH2026', `Listo ✅\n${marca}`, '573001117001');
ok(rc[0].json.pedido?.precio === 13500 && rc[0].json.pedido.cupon === 'DCTECH2026', 'el cliente escribió DCTECH2026 → $13.500, calculado por el sistema');
datos = { 'Config bot': [cfg], 'Normalizar mensaje': [{ numero: '573001117001', nombre: 'Leo' }] };
ejecutar('Crear triangulación', [{ numero: '573001117001', pedido: rc[0].json.pedido }]);
datos = { 'Config bot': [cfg] };
ok(/llegaron \*\$13\.500\* \(con cupón DCTECH2026: confirma que sea su primera compra\)/.test(ejecutar('Comprobante recibido', [{ numero: '573001117001' }])[1].json.texto), 'tu aviso del comprobante: $13.500 con cupón y que confirmes que es su primera compra');
// 7) La IA copia la categoría del catálogo en el nombre → el pedido se reconoce igual (antes se perdía)
rc = revisar('confirmo', 'Listo ✅\n[PEDIDO_DIGITAL] {"producto":"Disney Plus Premium [streaming]","variante":"Pantalla Premium"}', '573001117002');
ok(rc[0].json.pedido?.producto === 'Disney Plus Premium' && rc[0].json.pedido.precio > 0 && !/PEDIDO_DIGITAL/.test(rc[0].json.texto), 'pedido con "[streaming]" pegado al nombre → se registra y la marca no le llega al cliente');

// 6) Consulta automática a ANC por cada pedido (19/10/2026)
{
    const cfgP = { ...cfg, numero_proveedor: '573054004508' };
    datos = { 'Config bot': [cfgP], 'Normalizar mensaje': [{ numero: '573001112266', nombre: 'Leo' }] };
    const T6 = ejecutar('Crear triangulación', [{ numero: '573001112266', pedido: { producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 30 días', precio: 15000 } }])[0]?.json;
    datos = { ...datos, 'Crear triangulación': [T6], 'Catálogo ANC': [{ data: INICIO }], 'Medios de pago ANC': [{}], 'Tienda ANC (respaldo)': [{ omitido: true }], 'Vincular al panel': [{ ok: true }] };
    const r6 = terminado(() => ejecutar('Evaluar cotización', [{ body: ejecutar('Cotización ANC')[0].json.body }]));
    ok(/¿Tienen disponible\?/.test(r6.avisoProveedor ?? '') && /Netflix · Pantalla 26 dias/.test(r6.avisoProveedor) && new RegExp(T6.referencia).test(r6.avisoProveedor) && !/573001112266|Leo|15\.000/.test(r6.avisoProveedor),
        'pedido nuevo → le pregunta a ANC por el plan exacto (con la referencia, sin datos ni precio del cliente)');
    ok(/Ya le pregunté a ANC/.test(r6.avisoAdmin), '…y a ti te avisa que ya le preguntó');
    datos = { 'Config bot': [cfgP], 'Crear triangulación': [T6] };
    const cierre6 = ejecutar('Cerrar triangulación', [{ error: { message: 'TERMINAR ' + JSON.stringify(r6) } }])[0].json;
    ok(cierre6.mensajes.some((m) => m.numero === '573054004508' && m.texto === r6.avisoProveedor) && cierre6.mensajes.some((m) => m.numero === '573125132325'), 'el cierre envía la consulta al WhatsApp de ANC y tu aviso');
    datos = { 'Config bot': [{ ...cfgP, consultar_proveedor: 'no' }], 'Normalizar mensaje': [{ numero: '573001112277' }] };
    const T7 = ejecutar('Crear triangulación', [{ numero: '573001112277', pedido: { producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 30 días', precio: 15000 } }])[0]?.json;
    datos = { ...datos, 'Crear triangulación': [T7], 'Catálogo ANC': [{ data: INICIO }], 'Medios de pago ANC': [{}], 'Tienda ANC (respaldo)': [{ omitido: true }], 'Vincular al panel': [{ ok: true }] };
    const r7 = terminado(() => ejecutar('Evaluar cotización', [{ body: ejecutar('Cotización ANC')[0].json.body }]));
    ok(r7.avisoProveedor === null, 'consultar_proveedor = no → no le escribe a ANC');
    // combo
    datos = { 'Config bot': [cfgP], 'Normalizar mensaje': [{ numero: '573001114455', nombre: 'Eva' }] };
    const C8 = ejecutar('Crear combo', [{ numero: '573001114455', combo: { items: [{ producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 30 días', precio: 15000 }, { producto: 'Prime Video Ultra HD', variante: 'Pantalla (1 Dispositivo)', precio: 10000 }], total: 22500 } }])[0]?.json;
    datos = { ...datos, 'Crear combo': [C8] };
    const r8 = terminado(() => ejecutar('Combo manual', [{}]));
    ok(/Netflix · Pantalla 26 dias/.test(r8.avisoProveedor ?? '') && /Prime Video · Pantalla/.test(r8.avisoProveedor), 'combo nuevo → le pregunta a ANC por cada plataforma');
}
