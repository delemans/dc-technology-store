// WO-040 · Menú con números, "no es compra" y fotos/audios según la conversación — con el jsCode REAL del flujo
const flujo = require(process.argv[2]);
const codigo = (nombre) => flujo.nodes.find((n) => n.name === nombre).parameters.jsCode;
const memoria = {};
let datos = {};
const ejecutar = (nombre, entrada = []) => {
    const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })) });
    const $input = { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) };
    return new Function('$', '$input', '$getWorkflowStaticData', codigo(nombre))($, $input, () => memoria);
};
const ok = (cond, msg) => { console.log(`${cond ? 'OK   ' : 'FALLA'} ${msg}`); if (!cond) process.exitCode = 1; };
const config = { ...flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {}), numero_aviso_admin: '573125132325' };
const METODOS = [
    { tipo: 'NEQUI', categoria: 'electronico', banco_alias: 'Nequi', numero_cuenta: '3223284622' },
    { tipo: 'DAVIPLATA', categoria: 'electronico', banco_alias: 'Daviplata', numero_cuenta: '3223284622' },
    { tipo: 'LLAVE_BREB', categoria: 'electronico', banco_alias: 'Llave', numero_cuenta: '@3223284622' },
    { tipo: 'LLAVE_BREB', categoria: 'electronico', banco_alias: 'Llave 2', numero_cuenta: '@1014260799' },
];
const REGLAS = [{ min_plataformas: 2, descuento_pct: 10 }, { min_plataformas: 3, descuento_pct: 15 }];
let n = 0;
const evento = (numero, message, extra = {}) => ({ body: { event: 'messages.upsert', data: { key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id: `M${++n}` }, pushName: extra.nombre ?? 'Ana María', message } } });
// Recorre la rama A como n8n: Normalizar → (Ruta) → Base de conocimiento/Métodos/Reglas → Responder menú → ¿Menú?
const llega = (numero, texto, { message, kbVivo = { error: 'sin red' } } = {}) => {
    datos = { 'Config bot': [config], 'Webhook Evolution': [evento(numero, message ?? { conversation: texto })] };
    const norm = ejecutar('Normalizar mensaje');
    if (!norm.length) return { ruta: null };
    const msg = norm[0].json;
    if (msg.ruta !== 'menu' && msg.ruta !== 'ia') return msg;
    datos = { ...datos, 'Normalizar mensaje': [msg], 'Base de conocimiento': [kbVivo], 'Metodos de pago': METODOS, 'Reglas combo': REGLAS };
    const menu = ejecutar('Responder menú')[0].json;
    datos['Responder menú'] = [menu];
    return { ...msg, ...menu };
};
const A = '573001110001';

// --- Saludo → menú principal ---
let r = llega(A, 'Hola');
ok(r.ruta === 'menu' && r.via === 'menu', '"Hola" → menú (sin IA)');
ok(r.texto.startsWith('¡Hola, Ana! 👋 Te saluda *DC TECNOLOGY*') && r.texto.includes('1️⃣ Catálogo y precios') && r.texto.includes('6️⃣ Hablar con una persona'), 'saludo con el primer nombre y las 6 opciones');
ok(llega('573001110002', 'Buenas tardes').via === 'menu' && llega('573001110003', 'Hola DC Technology').via === 'menu' && llega('573001110004', 'info').via === 'menu' && llega('573001110005', 'Hola DC Tecnology').via === 'menu', '"Buenas tardes", "Hola DC Technology" e "info" → menú');
ok(/Encontré 2 opciones/.test(llega('573001110005', 'Hola, cuánto vale Netflix?').texto ?? ''), 'saludo + pregunta de un producto → resultados al instante (sin IA)');

// --- Catálogo por números ---
r = llega(A, '1');
ok(r.via === 'menu' && r.texto.startsWith('🛍️ *Catálogo DC TECNOLOGY*') && /🎬 Streaming · \d+/.test(r.texto), '"1" → catálogo por categorías con cantidad de productos');
ok(r.texto.includes('🧩 *Combos:* 2 plataformas -10% · 3 o más plataformas -15%'), 'catálogo con los combos EN VIVO (reglas de la base)');
r = llega(A, '1️⃣');
ok(r.via === 'menu' && r.texto.startsWith('🎬 *Streaming*') && r.texto.includes('*1.* Netflix Premium 4K · $15.000'), '"1️⃣" (emoji) → lista de Streaming (un solo plan: precio exacto)');
r = llega(A, '1');
ok(r.texto.startsWith('🎬 *Netflix Premium 4K*') && r.texto.includes('*1.* Pantalla Colombia 30 días: *$15.000*') && r.texto.includes('https://www.dctecnology.xyz/p/netflix.html'), 'producto → planes con precio exacto y enlace a su página');
r = llega(A, '1');
ok(r.via === 'menu' && r.texto.startsWith('🛒 *Tu pedido*') && r.texto.includes('💰 Total: *$15.000*') && r.texto.includes('1️⃣ Nequi') && r.texto.includes('3️⃣ Llave Bre-B') && r.texto.includes('4️⃣ En la web'), 'elegir un plan → resumen del pedido y medios de pago (las 2 llaves = 1 opción), sin IA');
ok(!r.pedido, 'todavía no arranca la compra al proveedor (falta elegir cómo pagar)');
r = llega(A, '3');
ok(r.texto.startsWith('💳 *Paga con Llave Bre-B*') && r.texto.includes('• Llave: *@3223284622*') && r.texto.includes('• Llave: *@1014260799*') && r.texto.includes('💰 Valor: *$15.000*') && r.texto.includes('captura del comprobante'), 'elegir el medio → sus datos exactos, el valor y pedir la captura');
ok(r.pedido && r.pedido.producto === 'Netflix Premium 4K' && r.pedido.variante === 'Pantalla Colombia 30 días' && r.pedido.precio === 15000, 'al elegir el medio sale el pedido para "Crear triangulación" (compra al proveedor)');
datos = { 'Config bot': [{ ...config, canal_compra: 'web' }], 'Normalizar mensaje': [{ numero: A, nombre: 'Ana' }] };
const tri = ejecutar('Crear triangulación', [{ numero: A, texto: r.texto, pedido: r.pedido }]);
ok(tri.length === 1 && /^DC-[A-Z0-9]{5}$/.test(tri[0].json.referencia) && tri[0].json.precio_venta === 15000 && tri[0].json.cliente === A, 'el pedido del menú crea la triangulación con referencia DC-XXXXX y el precio del catálogo');
ok(ejecutar('Crear triangulación', [{ numero: A, pedido: r.pedido }]).length === 0, 'si elige otro medio del mismo pedido no se cotiza dos veces');
r = llega(A, null, { message: { imageMessage: { mimetype: 'image/jpeg' } } });
ok(r.ruta === 'comprobante', 'la foto que envía después es su comprobante');
r = llega(A, 'ya pagué, cuándo me llega?');
ok(r.via === 'ia', 'texto libre → IA');
datos['Base de conocimiento'] = [{ error: 'sin red' }];
const ctx = ejecutar('Armar contexto')[0].json;
ok(ctx.texto === 'ya pagué, cuándo me llega?' && ctx.sistema.includes('ÚLTIMO MENSAJE DEL MENÚ QUE VIO EL CLIENTE') && ctx.sistema.includes('Paga con Llave Bre-B'), 'la IA recibe el último menú que vio el cliente (sabe qué pidió y cómo pagó)');
ok(ctx.sistema.includes('[NO_COMPRA]'), 'la IA tiene la instrucción de "no es compra"');
ok(llega(A, '2').via === 'ia', 'después de pasar a la IA, "2" ya no es una opción del menú (le responde a la IA)');
ok(llega(A, '0').via === 'menu', '"0" vuelve al menú principal');
r = llega(A, '9');
ok(r.texto.startsWith('⚠️ Esa opción no está en la lista') && r.texto.includes('Catálogo y precios'), 'opción que no existe → aviso y el mismo menú');
r = llega(A, '6');
ok(r.ruta === 'asesor' && /menú/.test(r.motivo), '"6" → pasa a un asesor (ruta asesor con motivo)');

// --- Producto físico: una persona coordina el envío ---
const F = '573001110070';
llega(F, 'catalogo'); llega(F, '4'); llega(F, '1');
r = llega(F, '1');
ok(r.via === 'menu' && /Te comunico con un asesor/.test(r.texto) && /coordinar el envío/.test(r.texto), 'reloj (físico) → "una persona coordina el envío" (sin IA)');
datos = { 'Config bot': [config], 'Webhook Evolution': [evento(F, { conversation: 'hola' })] };
ok(ejecutar('Normalizar mensaje').length === 0, 'ese chat queda en pausa para que lo atiendas tú');

// --- Soporte, pedidos, pagos, comprar ---
const B = '573001110010';
r = llega(B, 'soporte');
ok(r.texto.startsWith('🛠️ *Soporte y garantía*') && r.texto.includes('🛡️ Garantía: *30 días*'), '"soporte" → menú de soporte con la garantía');
r = llega(B, '3');
ok(r.texto.startsWith('🏠 *Netflix pide "Actualizar hogar"*') && r.texto.includes('Actualizar hogar'), 'soporte 3 → pasos de "Actualizar hogar" (FAQ)');
datos['Base de conocimiento'] = [{ error: 'sin red' }];
datos['Responder menú'] = [{ via: 'ia' }];
datos['Normalizar mensaje'] = [{ numero: B, texto: 'ya lo envié' }];
ok(ejecutar('Armar contexto')[0].json.sistema.includes('(Después: Cuando el cliente confirme'), 'la IA recibe el paso siguiente de esa FAQ (escalar cuando confirme)');
r = llega('573001110011', 'pagos');
ok(r.texto.startsWith('💳 *Formas de pago*') && r.texto.includes('*Pagos locales:* Nequi · Daviplata · Llave Bre-B') && !r.texto.includes('3223284622'), 'formas de pago: solo nombres (sin números de cuenta), sin repetir la llave');
r = llega('573001110012', 'mis pedidos');
ok(r.texto.startsWith('📦 *Mis pedidos y accesos*') && r.texto.includes('https://www.dctecnology.xyz/#cuenta'), '"mis pedidos" → cómo entrar a Mis pedidos');
r = llega('573001110013', 'ACCESOS');
ok(r.texto.startsWith('📦 *Mis pedidos y accesos*'), '"ACCESOS" (de la plantilla de entrega) → Mis pedidos, sin escalar');
r = llega('573001110014', 'como compro');
ok(r.texto.startsWith('🛒 *Cómo comprar*') && r.texto.includes('DCTECH2026') && llega('573001110014', '1').texto.startsWith('🛍️'), '"cómo compro" → pasos; "1" → catálogo');
r = llega('573001110015', 'catálogo');
ok(r.texto.startsWith('🛍️ *Catálogo DC TECNOLOGY*'), '"catálogo" → catálogo');
const conVivo = llega('573001110016', 'menu', { kbVivo: { catalogo: [{ id: 'x', nombre: 'Producto vivo', tipo: 'streaming', variantes: [{ nombre: 'Plan', precio: 1000 }] }], menu: JSON.parse(JSON.stringify(require(require('path').join(require('path').dirname(process.argv[2]), '..', 'bot-conocimiento.json')).menu)), faq: [], plantillas: {} } });
ok(conVivo.texto.startsWith('📋 *Menú DC TECNOLOGY*'), 'usa la base de conocimiento EN VIVO cuando trae el menú');

// --- Asesor: palabras sueltas sí, dentro de una frase no ---
ok(llega('573001110020', 'Netflix para una persona').ruta === 'ia', '"Netflix para una persona" → IA (antes escalaba por la palabra "persona")');
ok(llega('573001110021', 'persona').ruta === 'asesor' && llega('573001110022', 'quiero un reembolso').ruta === 'asesor', '"persona" sola y "reembolso" → asesor');

// --- Lo que no se contesta ---
ok(llega('573001110030', null, { message: { reactionMessage: { text: '👍' } } }).ruta === null, 'reacción 👍 → no se contesta');
ok(llega('573001110031', null, { message: { stickerMessage: {} } }).ruta === null, 'sticker → no se contesta');
ok(llega('573001110032', null, { message: { protocolMessage: { type: 0 } } }).ruta === null, 'mensaje borrado → no se contesta');
ok(llega('573001110033', null, { message: { ephemeralMessage: { message: { conversation: 'menú' } } } }).via === 'menu', 'mensaje temporal (envuelto) se lee igual');

// --- Fotos, PDF y audios según la conversación ---
const C = '573001110040';
r = llega(C, null, { message: { imageMessage: { mimetype: 'image/jpeg' } } });
ok(r.ruta === 'sin_texto' && r.aviso === 'imagen', 'foto de alguien sin conversación de compra → aviso para ti');
datos = { 'Config bot': [config], 'Normalizar mensaje': [r] };
let fija = ejecutar('Respuesta fija');
ok(fija.length === 1 && fija[0].json.numero === '573125132325' && fija[0].json.texto.startsWith('🔔 *Te enviaron 📷 una imagen*'), 'el aviso va a tu número, no al contacto');
ok(ejecutar('Respuesta fija').length === 0, 'segunda foto en 30 min → sin aviso repetido');
r = llega('573001110041', null, { message: { imageMessage: { caption: 'me sale este error' } } });
ok(r.ruta === 'asesor' && /captura/.test(r.motivo), 'captura con "me sale este error" → asesor (una persona la mira)');
r = llega('573001110042', null, { message: { imageMessage: { caption: 'listo, ya pagué por nequi' } } });
ok(r.ruta === 'comprobante', 'foto con "ya pagué por nequi" → comprobante');
r = llega('573001110043', null, { message: { audioMessage: { ptt: true } } });
datos = { 'Config bot': [config], 'Normalizar mensaje': [r] };
ok(r.aviso === 'audio' && ejecutar('Respuesta fija')[0].json.numero === '573125132325', 'audio de alguien sin conversación → aviso para ti');
llega(A, 'menu');
r = llega(A, null, { message: { audioMessage: { ptt: true } } });
datos = { 'Config bot': [config], 'Normalizar mensaje': [r] };
ok(!r.aviso && ejecutar('Respuesta fija')[0].json.texto.startsWith('🎙️ Aún no puedo escuchar audios'), 'audio de un cliente en conversación → "aún no puedo escuchar audios"');

// --- Revisar respuesta: no es compra, datos de pago ---
const D = '573001110050';
llega(D, 'qué más pues, cómo está la familia?');
datos = { 'Config bot': [config], 'Normalizar mensaje': [{ numero: D, texto: 'qué más pues, cómo está la familia?', nombre: 'Pedro' }], 'Base de conocimiento': [{}], 'Metodos de pago': METODOS, 'Reglas combo': REGLAS };
r = ejecutar('Revisar respuesta', [{ output: '[NO_COMPRA] saludo personal de un conocido' }]);
ok(r.length === 2 && r[0].json.numero === D && /Recibí tu mensaje/.test(r[0].json.texto) && /menú/.test(r[0].json.texto), '[NO_COMPRA] → le responde automático, corto y amable');
ok(r[1].json.numero === '573125132325' && r[1].json.texto.startsWith('💬 *Mensaje que no es de compra*') && r[1].json.texto.includes('cómo está la familia') && /BAENAMORA/.test(r[1].json.texto), '…y a ti te avisa con su mensaje y cómo silenciarlo (etiqueta BAENAMORA)');
ok(ejecutar('Revisar respuesta', [{ output: '[NO_COMPRA] sigue la charla' }]).length === 0, 'otro "no es compra" del mismo chat en 6 h → no repite la respuesta ni el aviso');
ok(llega(D, 'quiero netflix').ruta !== null, 'el chat NO queda en pausa: si pregunta por la tienda, el bot lo atiende');

// --- Etiquetas de WhatsApp Business: BAENAMORA = el bot no responde ---
const LID = '542154000000100';
const etiqueta = (event, data) => { datos = { 'Config bot': [config], 'Webhook Evolution': [{ body: { event, instance: 'dc-bot', data } }] }; return ejecutar('Normalizar mensaje'); };
ok(etiqueta('labels.sync', { chats: { [`${LID}@lid`]: ['8'], '573001119999@s.whatsapp.net': ['8', '11'], '573001118888@s.whatsapp.net': ['11'] }, nombres: { 8: 'BAENAMORA', 11: 'DC TECNOLOGY' } }).length === 0, 'labels.sync: guarda las etiquetas actuales (no responde nada)');
ok(llega('573001119999', 'hola').ruta === null, 'chat con BAENAMORA → el bot no responde');
const conLid = { body: { event: 'messages.upsert', data: { key: { remoteJid: `${LID}@lid`, remoteJidAlt: '573001117777@s.whatsapp.net', fromMe: false, id: 'LID1' }, pushName: 'X', message: { conversation: 'hola' } } } };
datos = { 'Config bot': [config], 'Webhook Evolution': [conLid] };
ok(ejecutar('Normalizar mensaje').length === 0, 'BAENAMORA guardada por su ID oculto (@lid) → tampoco responde');
ok(llega('573001118888', 'hola').ruta === 'menu', 'chat con otra etiqueta (DC TECNOLOGY) → el bot responde automático');
ok(llega('573001116666', 'hola').ruta === 'menu', 'chat sin etiqueta → el bot responde automático');
etiqueta('labels.association', { instance: 'dc-bot', type: 'remove', chatId: '573001119999@s.whatsapp.net', labelId: '8' });
ok(llega('573001119999', 'hola').ruta === 'menu', 'le quitas BAENAMORA en tu WhatsApp → el bot vuelve a responder');
etiqueta('labels.association', { instance: 'dc-bot', type: 'add', chatId: '573001116666@s.whatsapp.net', labelId: '8' });
ok(llega('573001116666', 'hola de nuevo').ruta === null, 'le pones BAENAMORA → el bot deja de responder al instante');
etiqueta('labels.edit', { id: '8', name: 'Personal', instance: 'dc-bot' });
const ren = llega('573001116666', 'hola otra vez');
ok(ren.ruta !== null, 'si renombras la etiqueta, deja de silenciar (silencia por nombre: etiquetas_silencio)');
etiqueta('labels.edit', { id: '8', name: 'BAENAMORA', instance: 'dc-bot' });
const E = '573001110060';
llega(E, 'quiero netflix');
datos = { 'Config bot': [config], 'Normalizar mensaje': [{ numero: E, texto: 'nequi' }], 'Base de conocimiento': [{}], 'Metodos de pago': METODOS, 'Reglas combo': REGLAS };
ejecutar('Revisar respuesta', [{ output: 'Perfecto 🙌 Paga *$15.000* a Nequi 3223284622 y envíame la captura.' }]);
r = llega(E, null, { message: { imageMessage: { mimetype: 'image/jpeg' } } });
ok(r.ruta === 'comprobante', 'después de darle los datos de pago, una foto sin texto → comprobante');

// --- Conexiones del flujo ---
const con = flujo.connections;
ok(con['Reglas combo'].main[0][0].node === 'Precios vivos' && con['Precios vivos'].main[0][0].node === 'Responder menú' && con['Responder menú'].main[0][0].node === '¿Menú?'
    && con['¿Menú?'].main[0][0].node === 'Enviar respuesta' && con['¿Menú?'].main[1][0].node === 'Armar contexto', 'cableado: Reglas combo → Responder menú → ¿Menú? → (Enviar | Armar contexto)');

// --- Posventa: plantillas EN VIVO aunque el nodo HTTP devuelva la respuesta completa (headers + body) ---
const vivo = { plantillas: { codigo_acceso: '🔐 CÓDIGO EN VIVO: {codigo} · válido 5 minutos' }, notificaciones: { plantilla_por_tipo: { OTP: 'codigo_acceso' } } };
datos = { 'Plantillas posventa': [{ body: vivo, headers: {}, statusCode: 200 }], 'Config posventa': [{ numero_aviso_admin: '3125132325' }] };
ok(ejecutar('Armar mensaje', [{ id: 1, tipo: 'OTP', destino: '573001112233', variables: { codigo: '123456' } }])[0].json.texto.startsWith('🔐 CÓDIGO EN VIVO: 123456'), 'posventa usa las plantillas de la web también con "respuesta completa"');
datos['Plantillas posventa'] = [{ error: 'sin red' }];
const adm = ejecutar('Armar mensaje', [{ id: 2, tipo: 'ADMIN_COMPROBANTE', destino: 'x', variables: { codigo: 'W-1', cliente: '573001112233', metodo: 'Nequi', total: '15.000', referencia: '123' } }]);
ok(adm[0].json.numero === '573125132325', 'aviso para ti con número de 10 dígitos en la configuración → se envía con el 57');

// --- WO-042: búsqueda sin IA ---
r = llega('573001110080', 'mouse gamer');
ok(r.via === 'menu' && /Encontré \d+ opciones para «mouse gamer»/.test(r.texto), 'texto corto con productos → lista de resultados sin IA');
ok(llega('573001110080', '1').texto.includes('Mouse Gamer'), 'el número abre el producto encontrado');
ok(llega('573001110081', 'canva').texto.startsWith('💻 *Canva Pro*'), 'un solo resultado → ficha del producto');
ok(llega('573001110082', 'ya pagué').via === 'ia' && llega('573001110083', 'cuál me recomiendas para ver fútbol').via === 'ia', 'sin coincidencias o frase larga → IA');
memoria.ia = { ...(memoria.ia || {}), '573001110084': Date.now() };
ok(llega('573001110084', 'disney').via === 'ia', 'en medio de una charla con la IA no se interrumpe con la búsqueda');
