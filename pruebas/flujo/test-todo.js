// Ejecuta el jsCode REAL de cada nodo Code del flujo generado con globales de n8n simuladas
const flujo = require(process.argv[2]);
const codigo = (nombre) => flujo.nodes.find((n) => n.name === nombre).parameters.jsCode;
const memoria = {};
let datos = {};
const ejecutar = (nombre, entrada = []) => {
    const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })), item: { json: datos[n]?.[0] ?? {} } });
    const $input = { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) };
    return new Function('$', '$input', '$getWorkflowStaticData', codigo(nombre))($, $input, () => memoria);
};
const ok = (cond, msg) => { console.log(`${cond ? 'OK   ' : 'FALLA'} ${msg}`); if (!cond) process.exitCode = 1; };
const config = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const evento = (texto, extra = {}) => ({ body: { event: 'messages.upsert', data: { key: { remoteJid: '573001112233@s.whatsapp.net', fromMe: false, id: `W${Math.random()}`, ...extra.key }, pushName: 'Ana', message: texto === null ? { audioMessage: {} } : { conversation: texto } } } });
const normalizar = (ev) => { datos = { 'Config bot': [config], 'Webhook Evolution': [ev] }; return ejecutar('Normalizar mensaje'); };

// --- Bot: rutas ---
ok(normalizar(evento('Hola, cuánto vale Netflix?'))[0].json.ruta === 'ia', 'pregunta normal → IA');
ok(normalizar(evento('quiero hablar con un asesor'))[0].json.ruta === 'asesor', 'palabra clave "asesor" → Asesor');
ok(((r) => r.ruta === 'menu' && r.menu.ir === 'soporte')(normalizar(evento('SOPORTE.'))[0].json), 'respuesta "SOPORTE" de una plantilla → menú de soporte (antes iba directo a un asesor)');
ok(normalizar(evento('No'))[0].json.ruta === 'ia', '"No" sin solicitud de reseña reciente → IA (no da de baja)');
ok(normalizar(evento(null))[0].json.ruta === 'sin_texto', 'audio → Sin texto');
ok(normalizar({ body: { event: 'messages.upsert', data: { key: { remoteJid: '123@g.us', id: 'g1' }, message: { conversation: 'hola' } } } }).length === 0, 'grupos ignorados');
ok(normalizar({ body: { event: 'connection.update', data: {} } }).length === 0, 'otros eventos ignorados');
const repetido = evento('hola repetido', { key: { id: 'FIJO' } });
ok(normalizar(repetido).length === 1 && normalizar(repetido).length === 0, 'evento duplicado se procesa una sola vez');

// --- Escalamiento: pausa + aviso al admin ---
datos = { 'Config bot': [{ ...config, numero_aviso_admin: '573009998877' }] };
const esc = ejecutar('Escalar a asesor', [{ numero: '573001112233', texto: 'no funciona mi cuenta', nombre: 'Ana' }]);
ok(esc.length === 2 && esc[1].json.numero === '573009998877', 'escalar: mensaje al cliente + aviso al admin');
ok(/asesor/i.test(esc[0].json.texto) && !/\{pedido\}/.test(esc[0].json.texto), 'escalar: plantilla sin marcadores vacíos');
ok(normalizar(evento('hola otra vez')).length === 0, 'chat en pausa: el bot no responde');
memoria.ritmo = {};
normalizar(evento('#bot', { key: { fromMe: true } }));
ok(normalizar(evento('hola de nuevo')).length === 1, '"#bot" del asesor reactiva el bot');

// --- Anti-abuso ---
let respondidos = 0;
for (let i = 0; i < 9; i++) respondidos += normalizar({ body: { event: 'messages.upsert', data: { key: { remoteJid: '573005550000@s.whatsapp.net', id: `R${i}` }, message: { conversation: `msg ${i}` } } } }).length;
ok(respondidos === 6, `ráfaga de 9 mensajes → solo 6 procesados (${respondidos})`);

// --- Contexto del agente ---
datos = {
    'Normalizar mensaje': [{ numero: '573001112233', texto: 'precio netflix' }],
    'Base de conocimiento': [{ error: 'timeout' }],
    'Metodos de pago': [{ tipo: 'NEQUI', banco_alias: 'Nequi', numero_cuenta: '3001234567', titular: 'DC' }],
};
const ctx = ejecutar('Armar contexto')[0].json.sistema;
ok(ctx.includes('Nequi → sus datos: [DATOS_PAGO NEQUI]') && !ctx.includes('3001234567') && ctx.includes('Netflix Premium 4K') && ctx.includes('[ESCALAR]'), 'contexto: medios activos SIN números (la IA no los tiene) + catálogo embebido + escalamiento');
datos['Metodos de pago'] = [{}];
ok(ejecutar('Armar contexto')[0].json.sistema.includes('NO hay métodos activos'), 'sin cuentas activas → instrucción de no compartir pagos');

// --- Revisión de la respuesta ---
datos = { 'Config bot': [config], 'Normalizar mensaje': [{ numero: '573001112233', texto: 'x' }] };
ok(ejecutar('Revisar respuesta', [{ output: '## Hola\n**Netflix** cuesta $15.000' }])[0].json.texto === 'Hola\n*Netflix* cuesta $15.000', 'Markdown → formato WhatsApp');
ok(/asesor/i.test(ejecutar('Revisar respuesta', [{ output: '[ESCALAR] pago doble' }])[0].json.texto), '[ESCALAR] del agente → escalamiento');
ok(/asesor/i.test(ejecutar('Revisar respuesta', [{}])[0].json.texto), 'agente sin respuesta (error) → escalamiento');

// --- Posventa ---
datos = { 'Plantillas posventa': [{ error: 'caída' }] };
const pago = ejecutar('Armar mensaje', [{ id: 7, tipo: 'PAGO_RECIBIDO', destino: '573001112233', variables: { pedido: 'P1', producto: 'Max *HBO*', metodo: 'Nequi', codigo: '12' } }]);
ok(pago[0].json.id === 7 && pago[0].json.texto.includes('Producto: Max HBO') && pago[0].json.texto.includes('codigo=12'), 'posventa: plantilla embebida si la web falla, variables saneadas');
ok(ejecutar('Armar mensaje', [{}]).length === 0, 'posventa: cola vacía no hace nada');
let lanzo = false;
try { ejecutar('Armar mensaje', [{ id: 8, tipo: 'DESCONOCIDO', destino: '57300', variables: {} }]); } catch { lanzo = true; }
ok(lanzo, 'posventa: tipo sin plantilla → error (va a "Marcar fallida")');
datos = { 'Recorrer cola': [{ id: 9, tipo: 'SOLICITUD_RESENA', destino: '573001112233' }] };
ejecutar('Recordar reseña', [{ ok: true }]);
memoria.ritmo = {}; memoria.pausados = {};
ok(normalizar(evento('no')).length === 1 && normalizar(evento('No.'))[0].json.ruta === 'baja', '"NO" tras solicitud de reseña → Baja');

// --- Modelo ---
const llm = flujo.nodes.find((n) => n.name === 'IA balanceada');
ok(llm && llm.type === 'n8n-nodes-base.code' && llm.parameters.jsCode.includes('[] /*__CLAVES_IA__*/') && !flujo.nodes.some((n) => n.type.includes('langchain')), 'IA balanceada (varias IA en cadena), sin claves en el flujo de git');

// --- WO-023: productos digitales ---
memoria.ritmo = {}; memoria.pausados = {};
const img = { body: { event: 'messages.upsert', data: { key: { remoteJid: '573001112244@s.whatsapp.net', id: 'IMG1' }, pushName: 'Luis', message: { imageMessage: { caption: 'pago netflix' } } } } };
ok(normalizar(img)[0].json.ruta === 'comprobante', 'foto con texto → Comprobante (antes iba a la IA o a "solo texto")');
const pdf = { body: { event: 'messages.upsert', data: { key: { remoteJid: '573001112244@s.whatsapp.net', id: 'PDF1' }, message: { documentMessage: { mimetype: 'application/pdf' } } } } };
ok(normalizar(pdf)[0].json.ruta === 'sin_texto' && normalizar({ ...pdf, body: { ...pdf.body, data: { ...pdf.body.data, key: { ...pdf.body.data.key, id: 'PDF2' } } } }).length === 1, 'PDF de alguien sin conversación de compra → aviso para ti (no "comprobante recibido")');
memoria.esperandoPago = { ...(memoria.esperandoPago || {}), '573001112244': Date.now() };
ok(normalizar({ ...pdf, body: { ...pdf.body, data: { ...pdf.body.data, key: { ...pdf.body.data.key, id: 'PDF3' } } } })[0].json.ruta === 'comprobante', 'PDF después de darle los datos de pago → Comprobante');
ok(normalizar(evento('mi netflix no funciona'))[0].json.ruta === 'ia', '"no funciona" → soporte con IA (ya no escala directo)');
datos = { 'Config bot': [{ ...config, numero_aviso_admin: '573009998877' }] };
const comp = ejecutar('Comprobante recibido', [{ numero: '573001112244', texto: 'pago netflix', nombre: 'Luis' }]);
ok(comp.length === 2 && /revisando tu pago/.test(comp[0].json.texto) && !/15 minutos|proveedor|ANC/.test(comp[0].json.texto) && /panel/.test(comp[1].json.texto) && !/aprobad/i.test(comp[0].json.texto), 'comprobante: confirma al cliente (sin decir "aprobado") + aviso al admin');
datos = { 'Normalizar mensaje': [{ numero: '1', texto: 'x' }], 'Base de conocimiento': [{}], 'Metodos de pago': [{}] };
ok(ejecutar('Armar contexto')[0].json.sistema.includes('VENTA DIGITAL') && ejecutar('Armar contexto')[0].json.sistema.includes('SOPORTE DIGITAL'), 'prompt: flujo de venta y soporte digital');

// --- WO-029: combos ---
const REGLAS = [{ min_plataformas: 2, descuento_pct: '10.00' }, { min_plataformas: 3, descuento_pct: '15.00' }];
datos = { 'Normalizar mensaje': [{ numero: '1', texto: 'combo' }], 'Base de conocimiento': [{}], 'Metodos de pago': [{}], 'Reglas combo': REGLAS };
const ctxCombo = ejecutar('Armar contexto')[0].json.sistema;
ok(ctxCombo.includes('- 2 plataformas: 10% de descuento') && ctxCombo.includes('- 3 o más plataformas: 15% de descuento') && ctxCombo.includes('no se acumula'), 'contexto: reglas de combo en vivo desde la base');
datos['Reglas combo'] = [{}];
ok(ejecutar('Armar contexto')[0].json.sistema.includes('NO hay descuento por combo activo'), 'sin reglas en la base → no ofrece descuento');
const item = (producto, variante) => ({ producto, variante });
const marca = (...items) => `[COMBO] ${JSON.stringify({ items })}`;
const revisar = (salida, reglas = REGLAS, cripto = [{}]) => {
    datos = { 'Config bot': [config], 'Normalizar mensaje': [{ numero: '573001112233', texto: 'x' }], 'Reglas combo': reglas, 'Metodos de pago': cripto };
    return ejecutar('Revisar respuesta', [{ output: salida }])[0].json;
};
let rc = revisar(`¡Claro! Así queda:\n${marca(item('Netflix Premium 4K', 'Pantalla Colombia 30 días'), item('Disney Plus Premium', 'Pantalla Premium'), item('Max (HBO)', 'Pantalla Estándar 1 Mes'))}\n¿Lo confirmamos?`);
ok(rc.texto.includes('3 plataformas') && rc.texto.includes('Subtotal: $38.000') && rc.texto.includes('-15%: -$5.700') && rc.texto.includes('*Total: $32.300*') && !rc.texto.includes('[COMBO]'),
   `3 plataformas → -15 % con precios del catálogo:\n${rc.texto}`);
rc = revisar(marca(item('netflix premium 4k', 'pantalla colombia 30 días'), item('Disney Plus Premium', 'Pantalla Premium')));
ok(rc.texto.includes('-10%: -$3.000') && rc.texto.includes('*Total: $27.000*'), '2 plataformas → -10 % (sin importar mayúsculas)');
rc = revisar(marca(item('Max (HBO)', 'Pantalla Estándar 1 Mes'), item('Max (HBO)', 'Pantalla Platino 1 Mes')));
ok(/al menos 2 plataformas distintas/.test(rc.texto), 'la misma plataforma dos veces no cuenta como combo');
rc = revisar(marca(item('Netflix Premium 4K', 'Pantalla Colombia 30 días'), item('Plataforma inventada', 'X')));
ok(/asesor/.test(rc.texto) && !/\$/.test(rc.texto), 'producto que no está en el catálogo → no inventa precio');
rc = revisar(marca(item('Netflix Premium 4K', 'Pantalla Colombia 30 días'), item('Disney Plus Premium', 'Pantalla Premium')), [{}]);
ok(rc.texto.includes('*Total: $30.000*') && !/Descuento/.test(rc.texto), 'sin reglas activas → total sin descuento');
const usdt = [{ categoria: 'cripto', moneda: 'USDT', red: 'TRC20', tasa_cop: 4000, tasa_actualizada_at: new Date().toISOString(), numero_cuenta: 'T' }];
rc = revisar(`${marca(item('Netflix Premium 4K', 'Pantalla Colombia 30 días'), item('Disney Plus Premium', 'Pantalla Premium'))}\nEn USDT serían [MONTO_CRIPTO cop=COMBO moneda=USDT red=TRC20]`, REGLAS, usdt);
ok(/\*6\.75 USDT\*/.test(rc.texto), `cripto con cop=COMBO usa el total del combo (27.000 / 4.000): ${rc.texto.split('\n').pop()}`);
ok(revisar('Te sale en [MONTO_CRIPTO cop=COMBO moneda=USDT red=TRC20]', REGLAS, usdt).texto.includes('asesor'), 'cop=COMBO sin combo en la respuesta → no inventa monto');

// ===================== WO-024: triangulación =====================
memoria.ritmo = {}; memoria.pausados = {};
const cfgT = { ...config, canal_compra: 'whatsapp', numero_proveedor: '573110000000', numero_aviso_admin: '573009998877' };
const evDe = (numero, message, id) => ({ body: { event: 'messages.upsert', data: { key: { remoteJid: `${numero}@s.whatsapp.net`, id }, message } } });
const norm = (ev) => { datos = { 'Config bot': [cfgT], 'Webhook Evolution': [ev] }; return ejecutar('Normalizar mensaje'); };
const throwsTerminar = (fn) => { try { fn(); return null; } catch (e) { const m = /TERMINAR (\{.*\})/s.exec(e.message); return m ? JSON.parse(m[1]) : { otro: e.message }; } };

const prov = norm(evDe('573110000000', { extendedTextMessage: { text: 'Te queda en 9.500', contextInfo: { stanzaId: 'WCOT1' } } }, 'P1'))[0].json;
ok(prov.ruta === 'triangulacion' && prov.origen === 'proveedor' && prov.citado === 'WCOT1', 'proveedor → Triangulación, con el mensaje citado');
const adm = norm(evDe('573009998877', { imageMessage: { caption: '#pago dc-abcde' } }, 'A1'))[0].json;
ok(adm.origen === 'admin' && adm.accion === 'pago' && adm.referencia === 'DC-ABCDE' && adm.conMedia, 'admin "#pago DC-…" con foto → comando de pago');
ok(norm(evDe('573009998877', { conversation: 'hola, cuánto vale netflix' }, 'A2'))[0].json.ruta === 'ia', 'admin sin comando → conversación normal');

// Marca de pedido de la IA: validada contra el catálogo, precio del catálogo
datos = { 'Config bot': [cfgT], 'Normalizar mensaje': [{ numero: '573001112255', texto: 'x' }] };
const rv = ejecutar('Revisar respuesta', [{ output: 'Listo, Max Pantalla Estándar 1 Mes.\n[PEDIDO_DIGITAL] {"producto":"Max (HBO)","variante":"Pantalla Estándar 1 Mes","precio":1}' }])[0].json;
ok(rv.pedido && rv.pedido.precio === 8000 && !rv.texto.includes('PEDIDO_DIGITAL'), `marca válida → precio del catálogo ($${rv.pedido && rv.pedido.precio}, la IA dijo $1) y oculta al cliente`);
ok(ejecutar('Revisar respuesta', [{ output: 'ok\n[PEDIDO_DIGITAL] {"producto":"Netflix Gratis","variante":"x"}' }])[0].json.pedido === null, 'producto inexistente → se ignora');
ok(ejecutar('Revisar respuesta', [{ output: 'ok\n[PEDIDO_DIGITAL] {"producto":"Reloj Inteligente Smartwatch M9","variante":"Edición M9"}' }])[0].json.pedido === null, 'producto físico → no se triangula');

// Crear triangulación
datos = { 'Config bot': [cfgT], 'Normalizar mensaje': [{ numero: '573001112255', nombre: 'Ana' }] };
const cr = ejecutar('Crear triangulación', [{ numero: '573001112255', pedido: rv.pedido }]);
ok(/^DC-[A-Z0-9]{5}$/.test(cr[0].json.referencia) && cr[0].json.texto_proveedor.includes('Max (HBO)'), `crea ${cr[0].json.referencia} y el mensaje al proveedor`);
ok(ejecutar('Crear triangulación', [{ numero: '573001112255', pedido: rv.pedido }]).length === 0, 'mismo pedido repetido por la IA → no se cotiza dos veces');
datos['Config bot'] = [{ ...cfgT, canal_compra: 'whatsapp', numero_proveedor: '' }];
ok(ejecutar('Crear triangulación', [{ numero: '573001119999', pedido: rv.pedido }]).length === 0, 'canal WhatsApp sin proveedor configurado → no se triangula');

// Cotización
const T = { ...cr[0].json };
datos = { 'Config bot': [cfgT], 'Crear triangulación': [T] };
ok(throwsTerminar(() => ejecutar('Evaluar cotización', [{}]))?.estado === 'VENCIDO', 'sin respuesta del proveedor → VENCIDO');
ok(throwsTerminar(() => ejecutar('Evaluar cotización', [{ body: { tipo: 'cotizacion', texto: 'No hay disponibles hoy' } }]))?.estado === 'AGOTADO', '"No hay disponibles" → AGOTADO (con mensaje al cliente)');
const cot = ejecutar('Evaluar cotización', [{ body: { tipo: 'cotizacion', texto: 'Te queda en 5.500 hermano' } }])[0].json;
ok(cot.costo === 5500 && cot.texto_admin.includes('Margen: $2.500') && cot.texto_admin.includes(`#pago ${T.referencia}`), 'cotización → costo 5.500, margen y comando #pago para el admin');
ok(ejecutar('Evaluar cotización', [{ body: { texto: 'son 6 mil' } }])[0].json.costo === 6000, '"6 mil" → 6.000');
ok(throwsTerminar(() => ejecutar('Evaluar pago', [{ body: { tipo: 'cancelar' } }]))?.estado === 'CANCELADO', '#cancelar → CANCELADO');
ok(ejecutar('Evaluar pago', [{ body: { tipo: 'pago', wamid: 'IMGX' } }])[0].json.wamid === 'IMGX', 'pago del admin → id del comprobante para reenviarlo');

// Credenciales
const fuente = 'Listo bro\nCorreo: ana.max2026@gmail.com\nClave: Cl@ve_12*~\nPerfil 3';
datos = { 'Crear triangulación': [T], 'Preparar extracción': [{ texto_proveedor: fuente }] };
const val = (j) => ejecutar('Validar credenciales', [{ text: '```json\n' + JSON.stringify(j) + '\n```' }])[0].json;
const buena = val({ usuario: 'ana.max2026@gmail.com', clave: 'Cl@ve_12*~', perfil: 'Perfil 3', confianza: 0.96 });
ok(buena.decision === 'entregar', 'accesos textuales y confianza 0,96 → entregar');
ok(val({ usuario: 'ana.max2026@gmail.com', clave: 'Clave123', confianza: 0.99 }).decision === 'revisar', 'clave que NO está en el mensaje (inventada por la IA) → revisar');
ok(val({ usuario: 'ana.max2026@gmail.com', clave: 'Cl@ve_12*~', confianza: 0.7 }).decision === 'revisar', 'confianza 0,70 → revisar');
ok(ejecutar('Validar credenciales', [{ text: 'no sé' }])[0].json.decision === 'revisar', 'respuesta no JSON → revisar');
datos = { 'Crear triangulación': [T] };
const ent = ejecutar('Mensaje de entrega', [buena])[0].json;
ok(ent.texto.includes('```Cl@ve_12*~```') && ent.texto.includes('```ana.max2026@gmail.com```') && ent.numero === T.cliente && ent.clave_final === '12*~', 'entrega: credenciales EXACTAS en monoespaciado al cliente');

// Cierre
datos = { 'Config bot': [cfgT], 'Crear triangulación': [T] };
let cierre;
try { ejecutar('Evaluar cotización', [{}]); } catch (e) { cierre = ejecutar('Cerrar triangulación', [{ error: e.message }])[0].json; }
ok(cierre.patch.estado === 'VENCIDO' && cierre.mensajes.length === 1 && cierre.mensajes[0].numero !== T.cliente, 'cierre por vencimiento al cotizar (pedido de chat, aún sin pagar) → aviso solo a ti, no al cliente');
try { ejecutar('Evaluar cotización', [{}]); } catch { /* */ }
datos = { 'Config bot': [cfgT], 'Crear triangulación': [{ ...T, pagado: true }] };
try { ejecutar('Evaluar cotización', [{}]); } catch (e) { cierre = ejecutar('Cerrar triangulación', [{ error: e.message }])[0].json; }
ok(cierre.mensajes.length === 2, 'orden web ya pagada que vence al cotizar → aviso al cliente y a ti');
ok(ejecutar('Cerrar triangulación', [{ error: { message: 'ECONNREFUSED evolution' } }])[0].json.patch.estado === 'REVISION_MANUAL', 'falla técnica → REVISION_MANUAL y aviso al admin');

// Enrutador
const abiertas = [
    { referencia: 'DC-AAAAA', estado: 'COTIZANDO', esperando: 'COTIZACION', resume_url: 'http://n8n/webhook-waiting/1', wamid_cotizacion: 'WCOT1' },
    { referencia: 'DC-BBBBB', estado: 'ESPERANDO_PAGO_ADMIN', esperando: 'PAGO_ADMIN', resume_url: 'http://n8n/webhook-waiting/2' },
    { referencia: 'DC-CCCCC', estado: 'ESPERANDO_CREDENCIALES', esperando: 'CREDENCIALES', resume_url: 'http://n8n/webhook-waiting/3', wamid_pago: 'WPAGO3' },
];
const enrutar = (msg, filas = abiertas) => { datos = { 'Config bot': [cfgT], 'Normalizar mensaje': [msg], 'Pedidos abiertos': filas }; return ejecutar('Enrutar evento', filas)[0]?.json; };
let r1 = enrutar({ origen: 'proveedor', texto: 'te queda en 9 mil', citado: 'WCOT1' });
ok(r1.accion === 'reanudar' && r1.url.endsWith('/1') && r1.cuerpo.tipo === 'cotizacion', 'proveedor citando la cotización → reanuda ESE pedido');
r1 = enrutar({ origen: 'proveedor', texto: 'listo los datos', citado: 'WPAGO3' });
ok(r1.url.endsWith('/3') && r1.cuerpo.tipo === 'credenciales', 'proveedor citando el pago → reanuda con credenciales');
r1 = enrutar({ origen: 'proveedor', texto: 'listo', citado: null });
ok(r1.accion === 'avisar' && r1.numero === '573009998877', 'proveedor sin cita y 2 pedidos esperándolo → te avisa (no adivina)');
r1 = enrutar({ origen: 'proveedor', texto: 'pedido dc-ccccc: correo x', citado: null });
ok(r1.url.endsWith('/3'), 'proveedor menciona la referencia → ese pedido');
r1 = enrutar({ origen: 'admin', accion: 'pago', referencia: 'DC-BBBBB', numero: '573009998877', conMedia: true, wamid: 'IMG9' });
ok(r1.accion === 'reanudar' && r1.url.endsWith('/2') && r1.cuerpo.wamid === 'IMG9', 'admin #pago con foto → reanuda el pago');
ok(enrutar({ origen: 'admin', accion: 'pago', referencia: 'DC-BBBBB', numero: '573009998877', conMedia: false }).accion === 'avisar', 'admin #pago sin foto → le pide la foto');
ok(/no está esperando/.test(enrutar({ origen: 'admin', accion: 'pago', referencia: 'DC-AAAAA', numero: '573009998877', conMedia: true }).texto), 'admin #pago antes de la cotización → explica el estado');
ok(/No encuentro/.test(enrutar({ origen: 'admin', accion: 'cancelar', referencia: 'DC-ZZZZZ', numero: '573009998877' }).texto), 'referencia inexistente → la indica');

// ===================== WO-027: métodos de pago y cripto =====================
memoria.ritmo = {}; memoria.pausados = {};
const ahoraISO = new Date().toISOString();
const metodosDB = [
    { tipo: 'NEQUI', categoria: 'electronico', banco_alias: 'Nequi DC', numero_cuenta: '3001234567', titular: 'DC Tech' },
    { tipo: 'PSE', categoria: 'electronico', banco_alias: 'PSE', url_pago: 'https://pago.ejemplo.com/dc' },
    { tipo: 'USDT', categoria: 'cripto', banco_alias: 'USDT TRC20', numero_cuenta: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', moneda: 'USDT', red: 'TRC20', tasa_cop: 4000, tasa_actualizada_at: ahoraISO },
    { tipo: 'BINANCE_PAY', categoria: 'cripto', banco_alias: 'Binance Pay', numero_cuenta: '123456789', moneda: 'USDT', red: 'BINANCE_PAY', memo: 'DC', tasa_cop: 4000, tasa_actualizada_at: '2020-01-01T00:00:00Z' },
];
datos = { 'Normalizar mensaje': [{ numero: '573001112233', texto: 'cómo pago?' }], 'Base de conocimiento': [{}], 'Metodos de pago': metodosDB };
const ctxP = ejecutar('Armar contexto')[0].json.sistema;
ok(ctxP.includes('Pagos locales y electrónicos:') && ctxP.includes('Criptomonedas:'), 'contexto: métodos agrupados en locales y cripto');
ok(ctxP.includes('USDT SOLO por la red TRC20') && ctxP.includes('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'), 'contexto: cripto con red en mayúsculas y dirección exacta');
datos = { ...datos, 'Config bot': [config], 'Normalizar mensaje': [{ numero: '573001112233', texto: 'pago con PSE' }] };
const rPse = ejecutar('Revisar respuesta', [{ output: ['Listo, aquí tienes los datos:', '[DATOS_PAGO PSE]', '[DATOS_PAGO NEQUI]'].join(String.fromCharCode(10)) }])[0].json.texto;
ok(rPse.includes('https://pago.ejemplo.com/dc') && !rPse.includes('[DATOS_PAGO'), 'marca [DATOS_PAGO PSE] → enlace exacto; solo el primer medio (no la lista completa)');
ok(/Binance Pay[^\n]*MEMO OBLIGATORIO: DC[^\n]*SIN TASA VIGENTE/.test(ctxP), 'contexto: memo obligatorio y tasa vencida → no cotizar');
ok(ctxP.includes('[MONTO_CRIPTO'), 'contexto: regla de no calcular montos (marca MONTO_CRIPTO)');
datos['Metodos de pago'] = [{}];
ok(ejecutar('Armar contexto')[0].json.sistema.includes('NO hay métodos activos'), 'sin métodos activos → no comparte datos de pago');

datos = { 'Config bot': [config], 'Normalizar mensaje': [{ numero: '573001112233', texto: 'x' }], 'Metodos de pago': metodosDB };
const mc = ejecutar('Revisar respuesta', [{ output: 'Envía [MONTO_CRIPTO cop=15000 moneda=USDT red=TRC20] SOLO por la red TRC20.' }])[0].json.texto;
ok(mc.includes('*3.75 USDT*') && !mc.includes('MONTO_CRIPTO'), `monto cripto exacto calculado por el sistema: "${mc.slice(0, 40)}…"`);
const mc2 = ejecutar('Revisar respuesta', [{ output: 'Paga [MONTO_CRIPTO cop=15.000 moneda=USDT red=BINANCE_PAY]' }])[0].json.texto;
ok(mc2.includes('te lo confirma un asesor'), 'tasa vencida → no inventa un monto');
const mc3 = ejecutar('Revisar respuesta', [{ output: 'Paga [MONTO_CRIPTO cop=15000 moneda=USDT red=ERC20]' }])[0].json.texto;
ok(mc3.includes('te lo confirma un asesor'), 'red no activa → no cotiza');

const tx = '7f3c9a1b2d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcd';
const conTx = normalizar(evento(`ya pagué, hash ${tx}`))[0].json;
ok(conTx.ruta === 'comprobante' && conTx.txid === tx, 'hash (TXID) en texto → ruta Comprobante');
datos = { 'Config bot': [{ ...config, numero_aviso_admin: '573009998877' }] };
const compTx = ejecutar('Comprobante recibido', [{ numero: '573001112233', texto: 'ya pagué', txid: tx }]);
ok(/Recibimos tu hash/.test(compTx[0].json.texto) && compTx[1].json.texto.includes(tx), 'TXID: confirma al cliente y te envía el hash');

// ===================== WO-031: combos con el proveedor =====================
memoria.ritmo = {}; memoria.pausados = {}; memoria.pedidos = {};
const cfgC = { ...config, numero_proveedor: '573110000000', numero_aviso_admin: '573009998877' };
const REGLAS_C = [{ min_plataformas: 2, descuento_pct: '10.00' }, { min_plataformas: 3, descuento_pct: '15.00' }];
const itemsC = [
    { producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 30 días' },
    { producto: 'Disney Plus Premium', variante: 'Pantalla Premium' },
    { producto: 'Max (HBO)', variante: 'Pantalla Estándar 1 Mes' },
];
datos = { 'Config bot': [cfgC], 'Normalizar mensaje': [{ numero: '573001112233', texto: 'sí, confirmo', nombre: 'Ana' }], 'Reglas combo': REGLAS_C, 'Metodos de pago': [{}] };
const rr = ejecutar('Revisar respuesta', [{ output: `¡Listo! Tomé tu combo ✅\n[PEDIDO_COMBO] ${JSON.stringify({ items: itemsC })}\n[PEDIDO_DIGITAL] {"producto":"Netflix Premium 4K","variante":"Pantalla Colombia 30 días"}` }])[0].json;
ok(rr.combo && rr.combo.items.length === 3 && rr.combo.pct === 15 && rr.combo.total === 32300 && rr.pedido === null && !/PEDIDO_/.test(rr.texto),
   `[PEDIDO_COMBO] → combo de 3 (-15 %, $32.300), sin pedido suelto y sin marcas visibles`);
const rrMalo = ejecutar('Revisar respuesta', [{ output: `Ok\n[PEDIDO_COMBO] ${JSON.stringify({ items: [itemsC[0], { producto: 'Inventado', variante: 'x' }] })}` }])[0].json;
ok(rrMalo.combo === null, 'combo con un producto fuera del catálogo → no se compra nada');

// Crear combo
datos['Revisar respuesta'] = [rr];
const cc = ejecutar('Crear combo', [rr])[0].json;
ok(/^DC-[A-Z]{5}$/.test(cc.referencia) && cc.lineas.map((l) => l.referencia).join() === [1, 2, 3].map((n) => cc.referencia + n).join(), `padre ${cc.referencia} + líneas ${cc.lineas.map((l) => l.referencia).join(', ')}`);
ok(cc.lineas.reduce((s, l) => s + l.precio_venta, 0) === 32300 && cc.lineas[0].precio_venta === 12750, `precio cobrado repartido por línea (${cc.lineas.map((l) => l.precio_venta).join(' + ')} = 32.300)`);
ok(cc.filas[0].es_combo === true && cc.filas.slice(1).every((f) => f.grupo === cc.referencia) && /1\. Netflix[\s\S]*2\. Disney[\s\S]*3\. Max/.test(cc.texto_proveedor), 'filas padre/hijas y cotización numerada al proveedor');
ok(ejecutar('Crear combo', [rr]).length === 0, 'la IA repite el combo → no se cotiza dos veces');
datos['Crear combo'] = [cc];
ok(ejecutar('Líneas del combo').length === 3, 'una línea por plataforma para vincular al panel');

// Evaluar cotización
datos['Crear combo'] = [cc];
datos['Vincular combo al panel'] = [{ ok: true }, { ok: true }, { ok: true }];
const cotC = (texto) => ejecutar('Evaluar cotización combo', [{ body: { tipo: 'cotizacion', texto } }])[0].json;
let evC = cotC('1. 11.000\n2. 9.000\n3. 5.000');
ok(evC.costo_total === 25000 && evC.venta === 32300 && !evC.pausado && evC.hay_agotadas === 'no' && /Margen: \$7\.300/.test(evC.texto_admin) && !/PAUSADO/.test(evC.texto_admin), 'costos por línea: margen positivo → pago normal');
evC = cotC('1. 15.000\n2. 15.000\n3. 8.000');
ok(evC.perdida && evC.pausado && /PAGO PAUSADO/.test(evC.texto_admin) && /supera lo cobrado en \$5\.700/.test(evC.texto_admin) && /forzar/.test(evC.texto_admin), 'costo > cobrado → alerta y pago PAUSADO');
evC = cotC('Netflix 11.000\nDisney no hay por ahora\nMax 5.000');
ok(evC.hay_agotadas === 'si' && evC.actualizar.length === 1 && evC.actualizar[0].referencia === cc.referencia + '2' && evC.actualizar[0].estado === 'REVISION_MANUAL',
   'línea agotada (identificada por nombre) → EN REVISIÓN; las demás siguen');
ok(evC.venta === 32300 - cc.lineas[1].precio_venta && evC.costo_total === 16000 && !evC.pausado && /Disney Plus Premium\*/.test(evC.texto_cliente) && /reembolso/.test(evC.texto_cliente),
   'margen sobre lo disponible + aviso al cliente de cambio o reembolso parcial');
evC = cotC('listo amigo, ya te confirmo');
ok(evC.pausado && evC.costo_total === null && /no pude leer el costo/.test(evC.texto_admin), 'costo ilegible → también se pausa (no se puede verificar el margen)');
evC = cotC('Total 24.000');
ok(evC.costo_total === 24000 && !evC.pausado, 'solo total en la respuesta → se usa el total');
const finC = (() => { try { cotC('no hay nada de eso hoy'); return null; } catch (e) { return JSON.parse(/TERMINAR (\{.*\})/s.exec(e.message)[1]); } })();
ok(finC && finC.estado === 'AGOTADO' && /no tenemos disponibles/.test(finC.avisoCliente), 'todo agotado → combo cerrado y aviso al cliente');

// Enrutador
const abiertasC = (extra = {}) => [
    { referencia: cc.referencia, estado: 'ESPERANDO_PAGO_ADMIN', esperando: 'PAGO_ADMIN', resume_url: 'https://n8n/r/1', es_combo: true, pago_pausado: false, ...extra },
    ...cc.lineas.map((l, i) => ({ referencia: l.referencia, estado: 'COTIZANDO', grupo: cc.referencia, compra_id: `${i}`, estado_compra: 'ESPERANDO_PROVEEDOR' })),
];
const enrutarC = (msg, filas) => { datos = { 'Config bot': [{ ...cfgC, canal_compra: 'whatsapp' }], 'Normalizar mensaje': [msg] }; return ejecutar('Enrutar evento', filas.map((x) => x))[0].json; };
const adminMsgC = (texto) => ({ origen: 'admin', numero: '573009998877', accion: 'pago', referencia: cc.referencia, texto, conMedia: true, wamid: 'W9' });
const filasPendC = abiertasC(); filasPendC[2].estado_compra = 'PENDIENTE_PAGO';
ok(/aún no figura como pagado en: .*2/.test(enrutarC(adminMsgC(`#pago ${cc.referencia}`), filasPendC).texto), '#pago con una línea sin pagar en el panel → bloqueado');
ok(/PAUSADO/.test(enrutarC(adminMsgC(`#pago ${cc.referencia}`), abiertasC({ pago_pausado: true })).texto), '#pago con margen en pérdida → bloqueado (pausado)');
const forzC = enrutarC(adminMsgC(`#pago ${cc.referencia} forzar`), abiertasC({ pago_pausado: true }));
ok(forzC.accion === 'reanudar' && forzC.url === 'https://n8n/r/1', '#pago … forzar → el administrador lo autoriza explícitamente');
ok(enrutarC(adminMsgC(`#pago ${cc.referencia}`), abiertasC()).accion === 'reanudar', '#pago normal con margen positivo y cliente pagado → sigue');
const provC = enrutarC({ origen: 'proveedor', numero: '573110000000', texto: `Listo los accesos del ${cc.referencia}2`, wamid: 'P1' },
    abiertasC({ esperando: 'CREDENCIALES', estado: 'ESPERANDO_CREDENCIALES' }));
ok(provC.accion === 'reanudar' && provC.cuerpo.tipo === 'credenciales', 'el proveedor nombra una línea (…2) → se reanuda el combo padre');

// Pago y entrega
datos = { 'Config bot': [cfgC], 'Crear combo': [cc], 'Vincular combo al panel': [{ ok: true }] };
datos['Evaluar cotización combo'] = [cotC('1. 11.000\n2. no disponible\n3. 5.000')];
const pgC = ejecutar('Evaluar pago combo', [{ body: { tipo: 'pago', wamid: 'W9' } }])[0].json;
ok(pgC.actualizar.length === 2 && pgC.actualizar.every((a) => a.panel === 'PEDIDO_REALIZADO') && pgC.actualizar[0].costo === 11000, 'pago reenviado → solo las líneas disponibles pasan a PEDIDO REALIZADO con su costo');
const textoProvC = '1) Netflix: correo ana@dc.co clave Nfx_12*~ perfil 2\n3) Max: usuario max@dc.co clave Mx#9!88';
datos['Preparar extracción combo'] = [ejecutar('Preparar extracción combo', [{ body: { tipo: 'credenciales', texto: textoProvC } }])[0].json];
ok(/1\. Netflix[\s\S]*3\. Max/.test(datos['Preparar extracción combo'][0].prompt) && !/2\. Disney/.test(datos['Preparar extracción combo'][0].prompt), 'el prompt solo pide las líneas disponibles');
const llmC = (lineas) => ejecutar('Entregar combo', [{ text: JSON.stringify({ lineas }) }])[0].json;
let entC = llmC([{ linea: 1, usuario: 'ana@dc.co', clave: 'Nfx_12*~', perfil: '2', confianza: 0.95 }, { linea: 3, usuario: 'max@dc.co', clave: 'Mx#9!88', confianza: 0.97 }]);
ok(entC.texto.includes('Nfx_12*~') && entC.texto.includes('Mx#9!88') && entC.actualizar.filter((a) => a.panel === 'ENTREGADO').length === 2 && entC.estado_padre === 'REVISION_MANUAL',
   'entrega ambas líneas con claves EXACTAS; el padre queda en revisión por la línea agotada');
ok(/agotada → ofrece cambio o reembolso parcial/.test(entC.texto_admin), 'el resumen al admin recuerda la línea agotada');
entC = llmC([{ linea: 1, usuario: 'ana@dc.co', clave: 'Nfx_12*~', confianza: 0.95 }, { linea: 3, usuario: 'max@dc.co', clave: 'INVENTADA', confianza: 0.99 }]);
ok(entC.entregadas === 1 && entC.en_revision === 1 && !entC.texto.includes('INVENTADA') && /Max \(HBO\)\*: lo estamos revisando/.test(entC.texto) && entC.actualizar.some((a) => a.estado === 'REVISION_MANUAL' && /clave no textual/.test(a.notas)),
   'una clave que no está textual en el mensaje → esa línea a revisión, la otra se entrega');
entC = llmC([{ linea: 1, usuario: 'ana@dc.co', clave: 'Nfx_12*~', confianza: 0.5 }]);
ok(entC.entregadas === 0 && entC.en_revision === 2, 'confianza baja y línea faltante → ambas a revisión, nada se entrega a ciegas');

// Cierre
datos = { 'Config bot': [cfgC], 'Crear combo': [cc] };
const cierreC = ejecutar('Cerrar combo', [{ error: { message: 'TERMINAR {"estado":"VENCIDO","avisoAdmin":"x","avisoCliente":"y"}' } }])[0].json;
ok(cierreC.patch.estado === 'VENCIDO' && cierreC.actualizar.length === 3 && cierreC.mensajes.length === 2, 'cierreC del combo: padre + líneas + avisos');

// ===================== WO-032: avisos nuevos =====================
const nota = (tipo, variables) => { datos = { 'Plantillas posventa': [{}], 'Config posventa': [{ numero_aviso_admin: '57 300 999 8877' }] }; return ejecutar('Armar mensaje', [{ id: 9, tipo, destino: '573001112233', variables }])[0].json; };
let av = nota('ORDEN_VALIDADA', { codigo: 'DC-K7Q2M', total: '26.100' });
ok(av.numero === '573001112233' && /DC-K7Q2M/.test(av.texto) && /\$26\.100/.test(av.texto), 'ORDEN_VALIDADA → al cliente, con código y total');
av = nota('ADMIN_COMPROBANTE', { codigo: 'DC-K7Q2M', cliente: '573001112233', metodo: 'NEQUI', total: '26.100', referencia: 'M123' });
ok(av.numero === '573009998877' && /Comprobantes web/.test(av.texto), 'ADMIN_COMPROBANTE → a tu número de aviso, no al cliente');
av = nota('ADMIN_FALLA', { reporte: '7', cliente: '573001112233', producto: 'Max', problema: 'No inicia', garantia: 'Sí' });
ok(av.numero === '573009998877' && /En garantía: Sí/.test(av.texto), 'ADMIN_FALLA → a tu número, con garantía');
const sinAdmin = (() => { try { datos = { 'Plantillas posventa': [{}], 'Config posventa': [{ numero_aviso_admin: '' }] }; ejecutar('Armar mensaje', [{ id: 9, tipo: 'ADMIN_FALLA', destino: '573001112233', variables: { reporte: '7', cliente: '5730', producto: 'x', problema: 'y', garantia: 'No' } }]); return null; } catch (e) { return e.message; } })();
ok(/numero_aviso_admin/.test(sinAdmin), 'sin número de aviso configurado → error claro (no se le envía al cliente)');

// ===================== WO-033: despacho de órdenes web =====================
// Como n8n: leer un nodo que NO corrió en esta ejecución es un error
const ejecutarEstricto = (nombre, entrada, disponibles) => {
    const $ = (n) => { if (!(n in disponibles)) throw new Error(`Referenced node is unexecuted: ${n}`); return { first: () => ({ json: disponibles[n][0] }), all: () => disponibles[n].map((json) => ({ json })) }; };
    const $input = { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) };
    return new Function('$', '$input', '$getWorkflowStaticData', codigo(nombre))($, $input, () => memoria);
};
const cfgD = { ...config, numero_proveedor: '573110000000', numero_aviso_admin: '573009998877' };
ok(ejecutar('Preparar despacho', [{}]).length === 0, 'sin órdenes por despachar → no arranca nada');
const filaSola = { referencia: 'DC-WEB2A', cliente: '573006660000', cliente_nombre: null, producto: 'Max (HBO)', variante: 'Pantalla Estándar 1 Mes', precio_venta: '8000', es_combo: false, lineas: null };
const dSola = ejecutar('Preparar despacho', [filaSola])[0].json;
ok(dSola.pedido.referencia === 'DC-WEB2A' && dSola.pedido.precio === 8000 && dSola.nombre === '' && !dSola.combo, 'orden web de 1 producto → pedido con su referencia y precio de la base');
memoria.pedidos = {};
const t1 = ejecutarEstricto('Crear triangulación', [dSola], { 'Config bot': [cfgD] })[0].json;
ok(t1.referencia === 'DC-WEB2A' && t1.precio_venta === 8000 && t1.cliente === '573006660000', 'Crear triangulación usa la referencia de la base (sin leer el chat)');
ok(ejecutarEstricto('Crear triangulación', [dSola], { 'Config bot': [cfgD] }).length === 1, 'una orden web no pasa por la antirrepetición del chat');
const filaCombo = { referencia: 'DC-WEB3B', cliente: '573006660000', cliente_nombre: 'Ana', producto: 'Pedido web · 2 plataformas', variante: 'x', precio_venta: '20700', es_combo: true,
    lineas: [{ referencia: 'DC-WEB3B1', producto: 'Netflix Premium 4K', variante: 'Pantalla Colombia 30 días', precio_venta: 13500 }, { referencia: 'DC-WEB3B2', producto: 'Max (HBO)', variante: 'Pantalla Estándar 1 Mes', precio_venta: 7200 }] };
const dCombo = ejecutar('Preparar despacho', [filaCombo])[0].json;
ok(dCombo.combo && dCombo.combo.referencia === 'DC-WEB3B' && dCombo.combo.lineas.length === 2 && !dCombo.pedido, 'orden web de 2+ productos → combo con sus líneas');
const cw = ejecutarEstricto('Crear combo', [dCombo], { 'Config bot': [cfgD] })[0].json;
ok(cw.referencia === 'DC-WEB3B' && cw.lineas.map((l) => l.referencia).join() === 'DC-WEB3B1,DC-WEB3B2' && cw.total === 20700 && cw.web === true,
   'Crear combo respeta referencias y precios cobrados de la base (total $20.700)');
const llaves = cw.filas.map((f) => Object.keys(f).sort().join(','));
ok(new Set(llaves).size === 1 && cw.filas[0].es_combo === true && cw.filas[0].producto === 'Pedido web · 2 plataformas' && cw.filas.slice(1).every((f) => f.grupo === 'DC-WEB3B' && f.esperando === null),
   'filas con las mismas columnas (upsert por lote) y padre/hijas correctos');
ok(ejecutarEstricto('Crear triangulación', [dCombo], { 'Config bot': [cfgD] }).length === 0 && ejecutarEstricto('Crear combo', [dSola], { 'Config bot': [cfgD] }).length === 0,
   'cada orden va solo a su arranque (un producto o combo)');
ok(ejecutarEstricto('Crear combo', [dCombo], { 'Config bot': [{ ...cfgD, canal_compra: 'whatsapp', numero_proveedor: '' }] }).length === 0, 'canal whatsapp sin proveedor configurado no arranca (la base la reintenta en 15 min)');
// El chat sigue igual
memoria.pedidos = {};
const chat = ejecutarEstricto('Crear combo', [{ numero: '573001112233', combo: { items: [{ producto: 'Netflix Premium 4K', variante: 'a', precio: 15000 }, { producto: 'Max (HBO)', variante: 'b', precio: 8000 }], pct: 10, total: 20700 } }],
    { 'Config bot': [cfgD], 'Normalizar mensaje': [{ nombre: 'Luis' }] })[0].json;
ok(chat.web === false && chat.cliente_nombre === 'Luis' && chat.total === 20700 && /^DC-[A-Z]{5}$/.test(chat.referencia) && chat.filas[0].producto.startsWith('Combo ·'), 'combo por WhatsApp: igual que antes (nombre del chat, referencia nueva)');
