// WO-047 en el flujo: #guia, consulta del rastreo al proveedor, aviso al cliente y plantilla RASTREO (jsCode REAL)
const flujo = require(process.argv[2]);
const kb = require(process.argv[2].replace(/n8n[\\/]flujo_bot_dctechnology\.json$/, 'bot-conocimiento.json'));
const codigo = (n) => flujo.nodes.find((x) => x.name === n).parameters.jsCode;
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const AsyncF = Object.getPrototypeOf(async () => {}).constructor;
const memoria = {};
let datos = {};
const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
const correr = (n, entrada = [], helpers = {}) => new AsyncF('$', '$input', '$getWorkflowStaticData', codigo(n))
    .call({ helpers }, $, { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) }, () => memoria);
const base = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const cfg = { ...base, numero_aviso_admin: '573125132325', numero_proveedor: '573054004508' };
const ADMIN = '573125132325', CLI = '573001112233';

(async () => {
    // 1) Normalizar: #guia solo desde tu número
    memoria.vistos = [];
    const norm = (numero, texto) => { datos = { 'Config bot': [cfg], 'Webhook Evolution': [{ body: { event: 'messages.upsert', data: { key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: 'G' + Math.random() }, message: { conversation: texto }, messageTimestamp: Math.floor(Date.now() / 1000) } } }] }; return correr('Normalizar mensaje').then((r) => r.map((x) => x.json)); };
    let n = await norm(ADMIN, '#guia DC-AB123 240012345678');
    ok(n[0]?.ruta === 'triangulacion' && n[0].origen === 'admin' && n[0].accion === 'guia' && n[0].referencia === 'DC-AB123', '#guia desde tu número → comando');
    n = await norm(CLI, '#guia DC-AB123 240012345678');
    ok(!n.length || n[0].origen !== 'admin', 'un cliente no puede usar #guia');
    // 2) Enrutar → panel registrar_guia
    const enrutar = (msg) => { datos = { 'Config bot': [cfg], 'Normalizar mensaje': [msg] }; return correr('Enrutar evento', []).then((r) => r.map((x) => x.json)); };
    let r = await enrutar({ origen: 'admin', accion: 'guia', referencia: 'DC-AB123', numero: ADMIN, texto: '#guia DC-AB123 240012345678' });
    ok(r[0]?.accion === 'panel' && r[0].rpc === 'registrar_guia' && r[0].args.p_guia === '240012345678' && r[0].args.p_referencia === 'DC-AB123', 'Enrutar: registrar_guia con la guía');
    r = await enrutar({ origen: 'admin', accion: 'guía', referencia: 'DC-AB123', numero: ADMIN, texto: '#guía DC-AB123 240012345678' });
    ok(r[0]?.rpc === 'registrar_guia' && r[0].args.p_guia === '240012345678', '#guía con tilde también');
    r = await enrutar({ origen: 'admin', accion: 'guia', referencia: 'DC-AB123', numero: ADMIN, texto: '#guia DC-AB123' });
    ok(r[0]?.accion === 'avisar' && /guía después del pedido/.test(r[0].texto), 'sin número de guía → te explica cómo');
    // 3) Resultado: confirmación a ti + aviso al cliente
    const panel = (pedido, filas) => { datos = { 'Config bot': [cfg], 'Salida al panel': [pedido] }; return correr('Resultado del panel', filas).then((x) => x.map((y) => y.json)); };
    r = await panel({ tipo: 'registrar_guia', numero: ADMIN, referencia: 'DC-AB123', guia: '240012345678' }, [{ ok: true, mensaje: 'Guía 240012345678 enlazada a DC-AB123.', destino: CLI }]);
    ok(r.length === 2 && r[0].numero === ADMIN && r[1].numero === CLI && /despachado/.test(r[1].texto) && /240012345678/.test(r[1].texto) && !/emprende/i.test(r[1].texto), 'te confirma y al cliente le llega "ya fue despachado" con la guía (sin mencionar al proveedor)');
    r = await panel({ tipo: 'registrar_guia', numero: ADMIN, referencia: 'DC-AB123', guia: '1' }, [{ error: { message: 'function registrar_guia does not exist' } }]);
    ok(r.length === 1 && /wo-047/.test(r[0].texto), 'sin el SQL aplicado → te dice qué aplicar');
    // 4) Consultar rastreo: sesión + consulta por guía, texto sin el nombre del proveedor
    const llamadas = [];
    const helpers = { httpRequest: async (o) => {
        llamadas.push(o);
        if (o.method === 'POST') return o.body.order_code === '240012345678'
            ? { data: { status: 'En tránsito', statusDetail: 'Salió de bodega Emprendered Cali', carrier: 'Coordinadora', history: [{ date: '2026-10-19 10:00', status: 'Recogido', description: 'Recogido en Emprende Red', novelty: '' }] } }
            : [];
        return { headers: { 'set-cookie': ['XSRF-TOKEN=abc; path=/', 'laravel_session=xyz; path=/'] }, body: '<meta name="csrf-token" content="TOK123">' };
    } };
    const salida = (await correr('Consultar rastreo', [{ referencia: 'DC-AB123', guia: '240012345678', estado: null }, { referencia: 'DC-ZZ999', guia: '000', estado: null }], helpers)).map((x) => x.json);
    const post = llamadas.find((l) => l.method === 'POST');
    ok(post && post.url === 'https://emprendered.com.co/track-order' && post.headers['X-CSRF-TOKEN'] === 'TOK123' && /laravel_session=xyz/.test(post.headers.Cookie), 'consulta con la sesión y el token del formulario');
    ok(salida.length === 1 && salida[0].args.p_estado === 'EN TRÁNSITO' && salida[0].args.p_transportadora === 'Coordinadora', 'solo guarda las guías que la transportadora ya registra');
    ok(!/emprende/i.test(JSON.stringify(salida)), 'el historial que ve el cliente no menciona al proveedor');
    ok((await correr('Consultar rastreo', [], helpers)).length === 0, 'sin guías abiertas no consulta nada');
    // 5) Plantilla RASTREO en la cola de avisos
    ok(kb.notificaciones.plantilla_por_tipo.RASTREO === 'rastreo' && /va en camino/.test(kb.plantillas.rastreo) && /www\.dctecnology\.xyz/.test(kb.plantillas.rastreo), 'plantilla RASTREO lista para la cola de avisos');
    // 6) Conexiones
    const c = flujo.connections;
    const d = (a, i = 0) => (c[a]?.main?.[i] ?? []).map((x) => x.node);
    ok(d('Origen', 5).includes('Guías abiertas') && d('Guías abiertas').includes('Consultar rastreo') && d('Consultar rastreo').includes('Guardar rastreo'), 'rama de 30 min: guías abiertas → consulta → guardar');
})();
