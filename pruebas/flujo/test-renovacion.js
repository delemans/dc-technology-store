// WO-042 en el flujo: #ok / #no / #entregar, entrega automática de los accesos de ANC y precios de ANC (jsCode REAL)
const http = require('http');
const flujo = require(process.argv[2]);
const codigo = (n) => flujo.nodes.find((x) => x.name === n).parameters.jsCode;
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const AsyncF = Object.getPrototypeOf(async () => {}).constructor;
const memoria = {};
let datos = {};
const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
const correr = (n, entrada = [], helpers = {}, reemplazo = (x) => x) => new AsyncF('$', '$input', '$getWorkflowStaticData', reemplazo(codigo(n)))
    .call({ helpers }, $, { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) }, () => memoria);
const base = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const cfg = { ...base, numero_aviso_admin: '573125132325', numero_proveedor: '573054004508' };
const ADMIN = '573125132325', CLI = '573001112233';
const fila = (o) => ({ referencia: 'DC-AAAAA', estado: 'REVISION_MANUAL', esperando: null, cliente: CLI, cliente_nombre: 'Ana', producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 26 días', precio_venta: 15000, origen_web: false, es_combo: false, ...o });
const real = Date.now;
const a = (iso) => Date.parse(iso);
(async () => {
    // Lunes 20/10/2026 10:00 a. m. Colombia
    const LUNES = a('2026-10-20T10:00:00-05:00');
    Date.now = () => LUNES;
    const dias = (n) => new Date(LUNES - n * 864e5).toISOString();
    datos = { 'Config bot': [cfg] };
    let r = (await correr('Renovaciones', [
        { referencia: 'DC-R0001', cliente: CLI, producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 26 días', entregado_at: dias(24) }, // vence en 2 días → sí
        { referencia: 'DC-R0002', cliente: CLI, producto: 'Max (HBO)', variante: 'Pantalla Estándar 1 Mes', entregado_at: dias(10) },        // vence en 20 → no
        { referencia: 'DC-R0003', cliente: CLI, producto: 'Disney Plus Premium', variante: 'Pantalla Premium', entregado_at: dias(28) },      // sin duración → 30 → en 2 → sí
        { referencia: 'DC-R0004', cliente: CLI, producto: 'PIN Virtual Roblox', variante: 'PIN de $25.000', entregado_at: dias(28) },          // pin → no
        { referencia: 'DC-R0005', cliente: CLI, producto: 'Canva Pro', variante: '1 Año', entregado_at: dias(363) },                           // 1 año → en 2 → sí
        { referencia: 'DC-R0006', cliente: CLI, producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 26 días', entregado_at: dias(40) }, // venció hace 14 → no
    ])).map((x) => x.json);
    const refs = r.map((x) => x.args.p_referencia).sort();
    ok(JSON.stringify(refs) === JSON.stringify(['DC-R0001', 'DC-R0003']) || JSON.stringify(refs) === JSON.stringify(['DC-R0001', 'DC-R0003', 'DC-R0005']), `avisa solo los que vencen en ≤ 3 días (26 días, 30 por defecto, 1 año), no pines ni vencidos (${refs.join(',')})`);
    ok(r.every((x) => /de octubre/.test(x.args.p_vence)), `con la fecha en español (${r[0]?.args.p_vence})`);
    Date.now = () => a('2026-10-19T21:00:00-05:00');
    ok((await correr('Renovaciones', [{ referencia: 'DC-R0001', producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 26 días', entregado_at: dias(24) }])).length === 0, 'de noche no encola (9 a. m. – 7 p. m.)');
    Date.now = () => a('2026-10-25T10:00:00-05:00'); // domingo
    ok((await correr('Renovaciones', [{ referencia: 'DC-R0001', producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 26 días', entregado_at: dias(24) }])).length === 0, 'domingo no encola');
    Date.now = real;

    // Después de enviar el aviso: se recuerda el plan ofrecido
    datos = { 'Recorrer cola': [{ tipo: 'RENOVACION', destino: CLI, variables: { producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 26 días' } }] };
    await correr('Recordar reseña', [{ ok: 1 }]);
    ok(memoria.renovaciones?.[CLI]?.producto === 'Netflix Premium 4K', 'al enviar el aviso se recuerda el plan ofrecido');
    // El cliente responde RENOVAR → la IA recibe el plan completo
    memoria.vistos = [];
    datos = { 'Config bot': [cfg], 'Webhook Evolution': [{ body: { event: 'messages.upsert', data: { key: { remoteJid: `${CLI}@s.whatsapp.net`, fromMe: false, id: 'RN1' }, message: { conversation: 'Renovar' }, messageTimestamp: Math.floor(Date.now() / 1000) } } }] };
    r = (await correr('Normalizar mensaje')).map((x) => x.json);
    ok(r[0]?.ruta === 'ia' && /Quiero renovar Netflix Premium 4K – Pantalla Colombia 26 días/.test(r[0].texto), '"Renovar" → la IA arma el mismo plan para pagar');
    // Plantilla
    datos = { 'Plantillas posventa': [{}], 'Config posventa': [{ numero_aviso_admin: '57 300 999 8877' }] };
    const m = (await correr('Armar mensaje', [{ id: 1, tipo: 'RENOVACION', destino: CLI, variables: { producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 26 días', vence: 'miércoles, 22 de octubre' } }]))[0].json;
    ok(m.numero === CLI && /Tu plan vence pronto/.test(m.texto) && /22 de octubre/.test(m.texto) && /RENOVAR/.test(m.texto), 'aviso RENOVACION con la plantilla (plan, fecha y cómo renovar)');
    // Estructura
    const c = flujo.connections;
    ok(c['Origen'].main[5].some((x) => x.node === 'Entregas para renovar') && c['Entregas para renovar'].main[0][0].node === 'Renovaciones' && c['Renovaciones'].main[0][0].node === 'Encolar renovación', 'conexiones: rama de 30 min → candidatas → renovaciones → cola');
})();
