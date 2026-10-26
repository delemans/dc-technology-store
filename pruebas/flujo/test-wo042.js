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

(async () => {
    ok(base.canal_compra === 'manual' && base.anc_margen === '0', 'Config: compra manual y margen sobre ANC 0 (mismo precio que ANC)');
    memoria.ordenesChat = { [CLI]: { referencia: 'DC-AAAAA', plan: 'Netflix · Pantalla 26 dias', costo: 15000, at: Date.now() } };
    // #ok de un pedido por chat
    let r = await enrutar({ origen: 'admin', accion: 'ok', referencia: 'DC-AAAAA', numero: ADMIN, texto: '#ok DC-AAAAA' }, [fila()]);
    ok(r.length === 3 && r[0].accion === 'panel' && r[0].rpc === 'entregar_manual' && r[0].args.p_estado === 'PEDIDO_REALIZADO', '#ok (chat) → registra el pago en el panel');
    ok(r[1].numero === CLI && /Pago confirmado/.test(r[1].texto) && !/ANC/.test(r[1].texto), '…al cliente: "pago confirmado" (sin mencionar a ANC)');
    ok(r[2].numero === ADMIN && /Netflix · Pantalla 26 dias\* \(costo \$15\.000\)/.test(r[2].texto) && /322 328 4622/.test(r[2].texto) && /#entregar DC-AAAAA/.test(r[2].texto), '…a ti: qué comprar, con qué WhatsApp, y que la entregas con #entregar (modo manual)');
    // #no de un pedido por chat
    r = await enrutar({ origen: 'admin', accion: 'no', referencia: 'DC-AAAAA', numero: ADMIN, texto: '#no DC-AAAAA llegaron 10.000, faltan 5.000' }, [fila()]);
    ok(r.length === 2 && r[0].numero === CLI && /faltan 5\.000/.test(r[0].texto) && /No pudimos validar/.test(r[0].texto), '#no (chat) → al cliente con tu motivo');
    // #ok de un pedido web (todavía no es triangulación)
    r = await enrutar({ origen: 'admin', accion: 'ok', referencia: 'DC-WEB01', numero: ADMIN, texto: '#ok DC-WEB01' }, [fila()]);
    ok(r.length === 1 && r[0].accion === 'pago_web' && r[0].aprobar === true && r[0].codigo === 'DC-WEB01', '#ok (web) → aprueba el comprobante web en la base');
    r = await enrutar({ origen: 'admin', accion: 'no', referencia: 'DC-WEB01', numero: ADMIN, texto: '#no DC-WEB01 no llegó' }, [fila()]);
    ok(r[0].accion === 'pago_web' && r[0].aprobar === false && r[0].nota === 'no llegó', '#no (web) → rechaza con tu motivo');
    // Resultado del pago web
    datos = { 'Enrutar evento': [{ accion: 'pago_web', codigo: 'DC-WEB01', aprobar: true, numero: ADMIN }], 'Config bot': [cfg] };
    let w = (await correr('Resultado pago web', [{ ok: true, mensaje: 'Orden despachada.', existe: true, cliente: CLI, total: 25000 }]))[0].json;
    ok(/aprobado/.test(w.texto) && /\$25\.000/.test(w.texto), 'resultado #ok web → confirmación con el total');
    w = (await correr('Resultado pago web', [{ error: { message: 'Could not find the function public.resolver_orden_web_bot' } }]))[0].json;
    ok(/wo-042/.test(w.texto), 'si falta el SQL → te dice que apliques wo-042');
    // Entrega de cuentas MANUAL (por defecto): lo que mande ANC te llega a ti con el pedido sugerido; nunca va solo al cliente
    ok(base.entrega_cuentas === 'manual', 'Config: entrega de cuentas manual por defecto');
    const pagado = fila({ estado: 'ESPERANDO_CREDENCIALES' });
    r = await enrutar({ origen: 'proveedor', numero: '573054004508', texto: 'Netflix\nCorreo: ana.dc@mail.com\nClave: Xy7#k2' }, [pagado, fila({ referencia: 'DC-BBBBB', producto: 'Max (HBO)' })]);
    ok(r.length === 1 && r[0].accion === 'avisar' && r[0].numero === ADMIN && /#entregar DC-AAAAA/.test(r[0].texto) && /manual/.test(r[0].texto), 'manual: ANC manda la cuenta → te la reenvía con el pedido sugerido (#entregar), no al cliente');
    r = await enrutar({ origen: 'admin', accion: 'entregar', referencia: 'DC-AAAAA', numero: ADMIN, texto: '#entregar DC-AAAAA ana.dc@mail.com / Xy7#k2' }, [pagado]);
    ok(r.length === 1 && r[0].accion === 'entrega_manual' && r[0].t.referencia === 'DC-AAAAA' && /Xy7#k2/.test(r[0].texto), 'manual: tu #entregar con correo y clave → se entrega al cliente');
    // Modo automático (Config bot → entrega_cuentas = automatica): como antes
    cfg.entrega_cuentas = 'automatica';
    // El proveedor (ANC) envía la cuenta
    r = await enrutar({ origen: 'proveedor', numero: '573054004508', texto: 'Netflix\nCorreo: ana.dc@mail.com\nClave: Xy7#k2' }, [pagado, fila({ referencia: 'DC-BBBBB', producto: 'Max (HBO)' })]);
    ok(r.length === 1 && r[0].accion === 'entrega_manual' && r[0].t.referencia === 'DC-AAAAA', 'ANC envía la cuenta y hay 1 pedido pagado esperando → se entrega a ese pedido');
    r = await enrutar({ origen: 'proveedor', numero: '573054004508', texto: 'Correo: x@y.com Clave: 1' }, [pagado, fila({ referencia: 'DC-CCCCC', estado: 'ESPERANDO_CREDENCIALES', producto: 'Disney Plus Premium' })]);
    ok(r[0].accion === 'avisar' && r[0].numero === ADMIN && /#entregar/.test(r[0].texto) && /DC-AAAAA/.test(r[0].texto), '2 pedidos esperando y no se sabe cuál → te pregunta (no adivina)');
    r = await enrutar({ origen: 'proveedor', numero: '573054004508', texto: 'Tu Disney: correo d@y.com clave 9' }, [pagado, fila({ referencia: 'DC-CCCCC', estado: 'ESPERANDO_CREDENCIALES', producto: 'Disney Plus Premium' })]);
    ok(r[0].accion === 'entrega_manual' && r[0].t.referencia === 'DC-CCCCC', '…pero si el mensaje nombra el producto (Disney) → ese pedido');
    r = await enrutar({ origen: 'proveedor', numero: '573054004508', texto: 'Sí hay disponible para DC-NUEVO, a 15.000' }, [pagado, fila({ referencia: 'DC-NUEVO', producto: 'Netflix Premium 4K' })]);
    ok(r.length === 1 && r[0].accion === 'avisar' && r[0].numero === ADMIN && /ANC respondió sobre #DC-NUEVO/.test(r[0].texto) && /aún no paga/.test(r[0].texto), 'ANC responde la consulta de un pedido sin pagar → te llega a ti (no se intenta entregar el pagado)');
    r = await enrutar({ origen: 'proveedor', numero: '573054004508', texto: 'Correo: x@y.com Clave: 1' }, [fila()]);
    ok(r[0].accion === 'avisar' && /primero confirma el pago/.test(r[0].texto), 'pedido sin pago confirmado → nunca se le entrega (te avisa)');
    r = await enrutar({ origen: 'admin', accion: 'entregar', referencia: 'DC-AAAAA', numero: ADMIN, texto: '#entregar DC-AAAAA' }, [pagado]);
    ok(r[0].accion === 'entrega_manual' && /x@y\.com/.test(r[0].texto), '#entregar sin texto → usa el último mensaje de ANC');
    r = await enrutar({ origen: 'admin', accion: 'entregar', referencia: 'DC-AAAAA', numero: ADMIN, texto: '#entregar DC-AAAAA a@b.co / Clave1' }, [fila()]);
    ok(r[0].accion === 'avisar' && /aún no tiene el pago confirmado/.test(r[0].texto), '#entregar de un pedido sin pago confirmado → te frena');

    // Entrega manual con IA (servidor falso) → cliente, panel y tu aviso
    let respuestaIa = '{"usuario":"ana.dc@mail.com","clave":"Xy7#k2","perfil":"","pin":"","confianza":0.97}';
    const srv = http.createServer((req, res) => { req.on('data', () => {}).on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: respuestaIa } }] })); }); });
    await new Promise((z) => srv.listen(0, z));
    const ias = [{ nombre: 'IA', url: `http://127.0.0.1:${srv.address().port}`, modelo: 'm', clave: 'k', peso: 1 }];
    const conIa = (c) => c.split('[] /*__CLAVES_IA__*/').join(`${JSON.stringify(ias)} /*__CLAVES_IA__*/`);
    const helpers = { httpRequest: async (o) => { const x = await fetch(o.url, { method: o.method, headers: o.headers, body: JSON.stringify(o.body) }); return { statusCode: x.status, body: await x.json() }; } };
    datos = { 'Config bot': [cfg] };
    let e = (await correr('Entrega manual', [{ t: pagado, texto: 'Netflix\nCorreo: ana.dc@mail.com\nClave: Xy7#k2', numero_admin: ADMIN }], helpers, conIa)).map((x) => x.json);
    ok(e.length === 3 && e[0].numero === CLI && e[0].texto.includes('ana.dc@mail.com') && e[0].texto.includes('Xy7#k2') && /DC TECNOLOGY/.test(e[0].texto) && !/ANC|allnecessary/i.test(e[0].texto), 'entrega al cliente con la plantilla de DC Tecnology (sin mencionar a ANC)');
    ok(e[1].accion === 'panel' && e[1].args.p_estado === 'ENTREGADO' && e[1].args.p_clave.includes('Xy7#k2'), '…marca ENTREGADO en el panel (garantía)');
    ok(e[2].numero === ADMIN && /entregado/.test(e[2].texto), '…y te confirma');
    e = (await correr('Entrega manual', [{ t: pagado, texto: 'otra vez', numero_admin: ADMIN }], helpers, conIa)).map((x) => x.json);
    ok(e.length === 1 && /ya fue entregado/.test(e[0].texto), 'no entrega dos veces el mismo pedido');
    respuestaIa = '{"usuario":"inventado@mail.com","clave":"123","confianza":0.95}';
    e = (await correr('Entrega manual', [{ t: fila({ referencia: 'DC-DDDDD', estado: 'ESPERANDO_CREDENCIALES' }), texto: 'Hola, ya casi te envío la cuenta', numero_admin: ADMIN }], helpers, conIa)).map((x) => x.json);
    ok(e.length === 1 && e[0].numero === ADMIN && /No pude leer con seguridad/.test(e[0].texto), 'datos que NO están en el mensaje de ANC → no se entregan (te pide #entregar)');
    respuestaIa = '{"usuario":"a@b.co","clave":"Zz1","confianza":0.6}';
    e = (await correr('Entrega manual', [{ t: fila({ referencia: 'DC-EEEEE', estado: 'ESPERANDO_CREDENCIALES' }), texto: 'a@b.co Zz1', numero_admin: ADMIN }], helpers, conIa)).map((x) => x.json);
    ok(e.length === 1 && e[0].numero === ADMIN, 'confianza menor a 0,9 → no se entrega');
    // Pines virtuales: un código, sin usuario ni clave
    const pinFila = fila({ referencia: 'DC-PPPPP', estado: 'ESPERANDO_CREDENCIALES', producto: 'PIN Virtual Roblox', variante: 'PIN de $25.000' });
    respuestaIa = '{"pin":"RBX-7Q2K-99LM-3TZA","confianza":0.98}';
    e = (await correr('Entrega manual', [{ t: pinFila, texto: 'Pin Roblox 25.000\nCodigo: RBX-7Q2K-99LM-3TZA', numero_admin: ADMIN }], helpers, conIa)).map((x) => x.json);
    ok(e.length === 3 && e[0].numero === CLI && e[0].texto.includes('RBX-7Q2K-99LM-3TZA') && /Tu PIN está listo/.test(e[0].texto) && !/Usuario|Clave:/.test(e[0].texto) && !/ANC/.test(e[0].texto), 'PIN de ANC → al cliente con la plantilla de PIN');
    ok(e[1].args.p_clave === 'PIN RBX-7Q2K-99LM-3TZA' && e[1].args.p_estado === 'ENTREGADO', '…y ENTREGADO en el panel');
    respuestaIa = '{"pin":"ABCDEFGH1234","confianza":0.95}';
    e = (await correr('Entrega manual', [{ t: fila({ referencia: 'DC-QQQQQ', estado: 'ESPERANDO_CREDENCIALES', producto: 'PIN Virtual Google Play' }), texto: 'Ya va el pin', numero_admin: ADMIN }], helpers, conIa)).map((x) => x.json);
    ok(e.length === 1 && e[0].numero === ADMIN && /el PIN/.test(e[0].texto), 'PIN que no está en el mensaje → no se entrega');
    srv.close();

    // Precios de ANC (lectura REAL de allnecessarycolombia.com)
    const real = { httpRequest: async (o) => { const x = await fetch(o.url, { headers: o.headers }); if (!x.ok) throw new Error(String(x.status)); return x.text(); } };
    datos = { 'Config bot': [cfg] };
    const p = (await correr('Leer precios ANC', [], real))[0].json;
    const net = p.items.find((i) => i.producto_id === 'netflix');
    ok(p.items.length >= 12 && net && net.precio === net.costo && net.precio >= 10000, `precios de ANC: ${p.items.length} planes (Netflix ${net?.variante}: $${net?.precio})`);
    datos = { 'Config bot': [{ ...cfg, anc_margen: '10' }] };
    const p2 = (await correr('Leer precios ANC', [], real))[0].json;
    ok(p2.items.find((i) => i.producto_id === 'netflix').precio === Math.round(net.costo * 1.1 / 100) * 100, 'con anc_margen = 10 → costo + 10 % redondeado a $100');
    datos = { 'Config bot': [cfg], 'Leer precios ANC': [p] };
    const correrPreciosAnc = ([sync]) => { datos['Sincronizar precios ANC'] = [sync]; return correr('Resultado precios ANC', [{}]); };
    const rp = await correrPreciosAnc([{ actualizados: 1, sin_cambio: 10, omitidos: 1, cambios: [{ producto_id: 'netflix', variante: 'Pantalla', antes: 15000, ahora: 16000, aplicado: true }, { producto_id: 'hbo-max', variante: 'X', antes: 8000, ahora: 30000, aplicado: false }] }]);
    ok(rp.length === 1 && /\$15\.000 → \*\$16\.000\*/.test(rp[0].json.texto) && /NO lo apliqué/.test(rp[0].json.texto), 'te avisa qué precios cambiaron y cuáles no aplicó por sospechosos');
    ok((await correrPreciosAnc([{ actualizados: 0, sin_cambio: 17, omitidos: 0, cambios: [] }])).length === 0, 'sin cambios → no te escribe');
})();
// Sin wo-042 aplicado: la base no trae cliente/producto → no se le escribe a nadie
setTimeout(async () => {
    const viejo = [{ referencia: 'DC-KH5HH', estado: 'REVISION_MANUAL', esperando: null }];
    const r = await enrutar({ origen: 'admin', accion: 'ok', referencia: 'DC-KH5HH', numero: ADMIN, texto: '#ok DC-KH5HH' }, viejo);
    ok(r.length === 1 && r[0].numero === ADMIN && /wo-042/.test(r[0].texto), 'sin wo-042 → solo te dice que lo apliques (no escribe "undefined" a nadie)');
    const w = await enrutar({ origen: 'admin', accion: 'ok', referencia: 'DC-KH5HH', numero: ADMIN, texto: '#ok DC-KH5HH' }, [fila({ referencia: 'DC-KH5HH', origen_web: true })]);
    ok(w.length === 1 && /ya está validado/.test(w[0].texto), '#ok de un pedido web ya pagado → te lo aclara');
}, 8000);
