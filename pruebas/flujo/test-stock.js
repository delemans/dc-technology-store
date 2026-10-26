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
const fila = (o) => ({ referencia: 'DC-AAAAA', estado: 'REVISION_MANUAL', esperando: null, cliente: CLI, cliente_nombre: 'Ana', producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 30 días', precio_venta: 15000, origen_web: false, es_combo: false, ...o });
const enrutar = (msg, abiertas) => { datos = { 'Config bot': [cfg], 'Normalizar mensaje': [msg] }; return correr('Enrutar evento', abiertas).then((r) => r.map((x) => x.json)); };
const panel = (pedido, filas) => { datos = { 'Config bot': [cfg], 'Salida al panel': [pedido] }; return correr('Resultado del panel', filas).then((r) => r.map((x) => x.json)); };
const pin = (o) => fila({ referencia: 'DC-PIN01', producto: 'PIN Virtual Roblox', variante: 'PIN de $25.000', precio_venta: 25000, ...o });

(async () => {
    // 1) Normalizar: #stock solo desde tu número
    memoria.vistos = [];
    const norm = (numero, texto) => { datos = { 'Config bot': [cfg], 'Webhook Evolution': [{ body: { event: 'messages.upsert', data: { key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: 'S' + Math.random() }, message: { conversation: texto }, messageTimestamp: Math.floor(Date.now() / 1000) } } }] }; return correr('Normalizar mensaje').then((r) => r.map((x) => x.json)); };
    let n = await norm(ADMIN, '#stock roblox 25.000\nRBX-AAAA-1111');
    ok(n[0]?.ruta === 'triangulacion' && n[0].accion === 'stock' && /RBX-AAAA-1111/.test(n[0].texto), '#stock desde tu número → comando de stock (con los códigos)');
    n = await norm(CLI, '#stock roblox 25000\nRBX-X');
    ok(!n.length || n[0].accion !== 'stock', 'un cliente no puede usar #stock');

    // 2) Enrutar: cargar, ayuda y resumen
    let r = await enrutar({ origen: 'admin', accion: 'stock', numero: ADMIN, texto: '#stock roblox 25.000\nRBX-AAAA-1111\nRBX-BBBB-2222, RBX-CCCC-3333' }, []);
    ok(r[0]?.accion === 'panel' && r[0].rpc === 'cargar_stock' && r[0].args.p_producto_id === 'pin-virtual-roblox' && r[0].args.p_variante === 'PIN de $25.000' && r[0].args.p_codigos.length === 3,
        '"#stock roblox 25.000" + 3 códigos → carga en PIN Virtual Roblox · PIN de $25.000');
    r = await enrutar({ origen: 'admin', accion: 'stock', numero: ADMIN, texto: '#stock roblox\nRBX-1' }, []);
    ok(r[0]?.accion === 'avisar' && /¿Cuál de estos\?/.test(r[0].texto) && /PIN de \$50\.000/.test(r[0].texto), 'sin el valor → te muestra las opciones');
    r = await enrutar({ origen: 'admin', accion: 'stock', numero: ADMIN, texto: '#stock netflix 25000\nX123456' }, []);
    ok(r[0]?.accion === 'avisar' && /No encontré/.test(r[0].texto), 'un pin que no existe con ese valor → te lo dice');
    r = await enrutar({ origen: 'admin', accion: 'stock', numero: ADMIN, texto: '#stock google play 10000' }, []);
    ok(r[0]?.accion === 'avisar' && /pega los códigos/.test(r[0].texto), 'sin códigos → te pide pegarlos');
    r = await enrutar({ origen: 'admin', accion: 'stock', numero: ADMIN, texto: '#stock' }, []);
    ok(r[0]?.rpc === 'stock_resumen', '"#stock" solo → resumen');

    // 3) #ok de un pin por chat → confirma al cliente y entrega desde el stock
    memoria.ordenesChat = { [CLI]: { referencia: 'DC-PIN01', plan: 'PIN Virtual Roblox · 25.000', costo: 25000, at: Date.now() } };
    r = await enrutar({ origen: 'admin', accion: 'ok', referencia: 'DC-PIN01', numero: ADMIN, texto: '#ok DC-PIN01' }, [pin()]);
    ok(r.length === 2 && r[0].numero === CLI && /Pago confirmado/.test(r[0].texto) && r[1].rpc === 'entregar_desde_stock' && r[1].args.p_producto_id === 'pin-virtual-roblox' && /PIN Virtual Roblox · 25\.000/.test(r[1].sin_stock),
        '#ok de un pin → «pago confirmado» al cliente + entrega desde el stock (con plan B: comprar en ANC)');
    r = await enrutar({ origen: 'admin', accion: 'ok', referencia: 'DC-AAAAA', numero: ADMIN, texto: '#ok DC-AAAAA' }, [fila()]);
    ok(r.some((x) => x.rpc === 'entregar_manual') && !r.some((x) => x.rpc === 'entregar_desde_stock'), '#ok de Netflix (no es pin) → igual que antes (compra en ANC)');
    r = await enrutar({ origen: 'admin', accion: 'ok', referencia: 'DC-PIN01', numero: ADMIN, texto: '#ok DC-PIN01' }, [pin({ origen_web: true })]);
    ok(r.length === 1 && r[0].rpc === 'entregar_desde_stock', 'pin de un pedido web ya pagado → #ok lo entrega desde el stock');

    // 4) Resultado del panel
    const ped = r[0];
    let p = await panel(ped, [{ ok: true, codigo: 'RBX-AAAA-1111', quedan: 1, mensaje: 'Entregado desde el stock.' }]);
    ok(p.length === 2 && p[0].numero === CLI && p[0].texto.includes('RBX-AAAA-1111') && /Tu PIN está listo/.test(p[0].texto) && !/stock|ANC/i.test(p[0].texto), 'con stock → el PIN al cliente con nuestra plantilla (sin mencionar stock ni proveedor)');
    ok(p[1].numero === ADMIN && /entregado desde tu stock/.test(p[1].texto) && /Te quedan \*1\*/.test(p[1].texto), '…y a ti: entregado + alerta de stock bajo');
    p = await panel(ped, [{ ok: false, codigo: null, quedan: 0, mensaje: 'SIN_STOCK' }]);
    ok(p.length === 1 && p[0].numero === ADMIN && /no hay .* en tu stock/.test(p[0].texto) && /Compra en ANC/.test(p[0].texto), 'sin stock → te dice qué comprar (al cliente no le llega nada raro)');
    p = await panel({ tipo: 'cargar_stock', numero: ADMIN, producto: 'PIN Virtual Roblox · PIN de $25.000' }, [{ cargados: 3, repetidos: 1, disponibles: 5 }]);
    ok(/Stock cargado/.test(p[0].texto) && /Nuevos: \*3\*/.test(p[0].texto) && /repetidos ignorados: 1/.test(p[0].texto) && /Disponibles ahora: \*5\*/.test(p[0].texto), 'carga → te confirma nuevos, repetidos y disponibles');
    p = await panel({ tipo: 'stock_resumen', numero: ADMIN }, [{ producto_id: 'pin-virtual-roblox', variante: 'PIN de $25.000', disponibles: 2, entregados_30d: 7 }, { producto_id: 'pin-google-play', variante: 'PIN de $10.000', disponibles: 9, entregados_30d: 1 }]);
    ok(/Tu stock de pines/.test(p[0].texto) && /⚠️ PIN Virtual Roblox · PIN de \$25\.000: \*2\*/.test(p[0].texto) && /• PIN Virtual Google Play/.test(p[0].texto), 'resumen con alerta en los que tienen 2 o menos');
    p = await panel({ tipo: 'cargar_stock', numero: ADMIN, producto: 'x' }, [{ error: { message: 'Could not find the function public.cargar_stock' } }]);
    ok(/wo-043/.test(p[0].texto), 'sin el SQL aplicado → te dice qué aplicar');
})();
