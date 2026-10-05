// generar_bot_conocimiento.js — Construye bot-conocimiento.json para el agente de WhatsApp (n8n + Evolution API).
//
//   node generar_bot_conocimiento.js
//
// - 'catalogo' se regenera SIEMPRE desde productos.json (fuente única de precios).
// - 'plantillas' se regenera SIEMPRE desde plantillas-whatsapp.js (mismos textos que usan admin y portal).
// - 'reglas_negocio', 'escalamiento', 'notificaciones', 'prompt_sistema' y las FAQ de reglas (pagos, entrega,
//   cupón, asesor) se regeneran SIEMPRE desde este archivo: son reglas estrictas, se cambian aquí.
// - 'negocio', el resto de 'faq' y 'promociones' se CONSERVAN si ya existen en bot-conocimiento.json: edítalos ahí a mano.
// Las entradas con "pendiente_configurar": true no deben enviarse a clientes hasta completarlas.

const fs = require('fs');
const path = require('path');
const WA = require('./plantillas-whatsapp.js');

const RUTA_SALIDA = path.join(__dirname, 'bot-conocimiento.json');
const productos = JSON.parse(fs.readFileSync(path.join(__dirname, 'productos.json'), 'utf8'));
const anterior = fs.existsSync(RUTA_SALIDA) ? JSON.parse(fs.readFileSync(RUTA_SALIDA, 'utf8')) : {};

const textoPlano = (html) => String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();

const catalogo = productos.map((p) => ({
    id: p.id,
    tipo: p.tipo,
    marca: p.marca,
    nombre: p.nombre,
    imagen: p.imagen,
    variantes: (p.variantes ?? []).map((v) => ({ nombre: v.nombre, precio: v.precio, precio_anterior: v.precio_anterior ?? null })),
    desde: Math.min(...(p.variantes ?? []).map((v) => v.precio).filter(Number.isFinite)),
    descripcion: textoPlano(p.descripcion).slice(0, 600) || null,
}));

// Plantillas con {marcadores} para que n8n los reemplace
const plantillas = {
    botones: WA.botones,
    comprar_ahora: WA.comprarAhora({ producto: '{producto}', variante: '{variante}', precio: '{precio}' }),
    pedido_tienda: WA.pedidoTienda({ producto: '{producto}', variante: '{variante}', cantidad: '{cantidad}', precioUnitario: '{precio_unitario}', cupon: '{cupon}', porcentaje: '{porcentaje}', total: '{total}' }),
    agendar_servicio: WA.agendarServicio({ servicio: '{servicio}', opcion: '{opcion}', fecha: '{fecha}', franja: '{franja}', detalle: '{detalle}', estimado: '{estimado}' }),
    consultar_estado: WA.consultarEstado({ pedido: '{pedido}' }),
    solicitar_soporte: WA.solicitarSoporte({ pedido: '{pedido}', producto: '{producto}' }),
    reclamar_garantia: WA.reclamarGarantia({ idCompra: '{id_compra}', pedido: '{pedido}', producto: '{producto}', serialFinal: '{serial_final}', vence: '{fecha_vencimiento}' }),
    satisfaccion_24h: WA.satisfaccion24h({ producto: '{producto}' }),
    renovacion_3d: WA.renovacion3d({ producto: '{producto}', cupon: '{cupon}' }),
    cupon_fidelidad: WA.cuponFidelidad({ producto: '{producto}', cupon: '{cupon}' }),
    pedido_proveedor: WA.pedidoProveedor({ pedido: '{pedido}', producto: '{producto}', cantidad: '{cantidad}' }),
    // Posventa automática: los {marcadores} coinciden con las claves de notificaciones_whatsapp.variables
    pago_recibido: WA.pagoRecibido({ pedido: '{pedido}', producto: '{producto}', metodo: '{metodo}', codigo: '{codigo}' }),
    entrega_confirmada: WA.entregaConfirmada({ pedido: '{pedido}', producto: '{producto}', garantiaDias: '{garantia_dias}', garantiaHasta: '{garantia_hasta}', codigo: '{codigo}' }),
    solicitud_resena: WA.solicitudResena({ producto: '{producto}', codigo: '{codigo}' }),
    codigo_acceso: WA.codigoAcceso({ codigo: '{codigo}' }),
    escalar_asesor: WA.escalarAsesor({ pedido: '{pedido}' }),
    entrega_credenciales: WA.entregaCredenciales({ pedido: '{pedido}', producto: '{producto}', usuario: '{usuario}', clave: '{clave}', perfil: '{perfil}', pin: '{pin}' }),
};

// Cola de posventa (supabase/wo-015.sql → public.notificaciones_whatsapp). n8n la vacía con estas reglas.
const notificaciones = {
    plantilla_por_tipo: {
        PAGO_RECIBIDO: 'pago_recibido',          // compra pasa a ESPERANDO_PROVEEDOR (pago validado)
        ENTREGA_CONFIRMADA: 'entrega_confirmada', // compra pasa a ENTREGADO / ENTREGADO_INMEDIATO
        SOLICITUD_RESENA: 'solicitud_resena',     // 24 h después de la entrega, en horario
        OTP: 'codigo_acceso',                     // WO-028: código del portal (prioridad 0, vence en 5 min)
    },
    rpc_tomar: 'tomar_notificaciones',   // p_lote (máx. 10). Ya filtra: 1 por número, 60 s entre mensajes al mismo número
    rpc_marcar: 'marcar_notificacion',   // p_id, p_ok, p_error, p_wamid. 3 fallos → FALLIDO (reintento manual en el panel)
    rpc_baja: 'registrar_baja_whatsapp', // p_numero: cuando el cliente responde NO a la solicitud de reseña
    envio: {
        ejecutar_cada_seg: 60,
        lote: 5,
        pausa_entre_mensajes_seg: [8, 15],   // aleatoria, entre un envío y el siguiente
        escribiendo_ms: 1500,                // 'delay' de Evolution API: muestra "escribiendo…" antes de enviar
        horario_resenas_bogota: 'lun–sáb, 9:00–19:59', // las solicitudes de reseña solo salen en esta franja
    },
};

// Reglas estrictas: se regeneran SIEMPRE desde aquí (no se conservan ediciones manuales en el JSON)
const reglasNegocio = [
    'Métodos de pago: SOLO los de la lista "MÉTODOS DE PAGO ACTIVOS" que te da el sistema (sale de public.metodos_pago). Si el cliente pide otro medio, dile con amabilidad cuáles están disponibles hoy.',
    'Números, llaves, enlaces y direcciones: cópialos EXACTOS de esa lista. Nunca los inventes, abrevies ni copies de mensajes anteriores.',
    'AL PAGAR: primero muestra las opciones agrupadas en "Pagos locales" y "Criptomonedas" (solo las activas) y deja que el cliente elija; luego da únicamente los datos del método elegido.',
    'CRIPTO (estricto): antes de dar la dirección confirma moneda y red; escribe la red en mayúsculas ("SOLO por la red TRC20") y advierte que un envío por otra red se pierde y no se puede recuperar. Si el método tiene memo/tag, es obligatorio incluirlo.',
    'MONTOS CRIPTO: nunca los calcules tú. Escribe [MONTO_CRIPTO cop=<total en pesos sin puntos> moneda=<MONEDA> red=<RED>] y el sistema lo reemplaza por el monto exacto con la tasa vigente. Pide como comprobante el hash (TXID) de la transacción y la captura.',
    `Entrega: máximo ${WA.ENTREGA_MAX_MIN} minutos después de VALIDAR el pago, en horario (${WA.HORARIO}). Fuera de horario, el pedido se procesa al abrir. Nunca prometas entrega antes de validar el pago.`,
    'Cupón DCTECH2026: 10% SOLO en la primera compra del número de WhatsApp. Un cupón por compra, no acumulable. Se confirma al validar el pago: si el número ya tiene compras, el descuento no aplica.',
    'Precios: solo los del catálogo de este archivo. No negocies descuentos fuera de las promociones activas.',
    'COMBOS: varias plataformas DISTINTAS del catálogo digital en un mismo pedido tienen el descuento por combo vigente (sección "DESCUENTO POR COMBO" del contexto: sale de la base y lo cambia el administrador). Nunca calcules el precio de un combo ni inventes porcentajes: usa la marca [COMBO]. Si no hay reglas activas, no ofrezcas descuento por combo.',
    'El cupón DCTECH2026 NO se acumula con el descuento por combo: solo aplica a los productos que van fuera del combo.',
    'Nunca envíes cuentas, contraseñas ni seriales de forma automática: un humano aprueba la entrega (modo sombra).',
    'Nunca pidas contraseñas, códigos de verificación ni datos bancarios completos al cliente.',
];

const escalamiento = {
    disparadores: [
        'El cliente pide hablar con una persona (asesor, humano, persona, agente).',
        'Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.',
        'Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.',
        `Pedido pagado sin entregar después de ${WA.ENTREGA_MAX_MIN} minutos dentro del horario.`,
        'Cliente molesto, insultos o amenaza de reclamo.',
        'Servicios a medida, alquiler, compras al por mayor o cotizaciones.',
        'La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver.',
    ],
    acciones_n8n: [
        'Pausar el bot en ese chat (no responder automáticamente hasta que el asesor lo libere).',
        'Avisar al WhatsApp del negocio con: número del cliente, pedido (si lo hay), motivo y último mensaje.',
        'Responder al cliente con la plantilla "escalar_asesor".',
    ],
    // "no funciona" ya no escala de inmediato: primero la IA da los pasos de soporte (soporte automatizado)
    palabras_clave: ['asesor', 'humano', 'persona', 'agente', 'reclamo', 'reembolso', 'devolucion', 'estafa', 'no me llego'],
};

// Venta y soporte de productos digitales (streaming, licencias, pines, recargas): la IA los atiende completos
const flujoDigital = [
    'VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (aplica DCTECH2026 solo si es la primera compra); 2) muestra los métodos activos (locales y cripto) y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.',
    `Cuando el cliente envía el comprobante: confirma que lo recibiste y que, al validarlo, su pedido sale en máximo ${WA.ENTREGA_MAX_MIN} minutos dentro del horario. Nunca digas que el pago está aprobado: lo valida el equipo.`,
    'Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.',
    'COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {"items":[{"producto":"<nombre exacto>","variante":"<opción exacta>"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).',
    'PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].',
    'PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {"items":[{"producto":"<nombre exacto>","variante":"<opción exacta>"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.',
    'SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, activación). Escala solo si después de esos pasos el problema sigue.',
];

// FAQ ligadas a reglas de negocio: se sobrescriben siempre con estos textos
const faqObligatorias = (horario) => [
    {
        id: 'metodos_pago',
        pregunta: '¿Qué métodos de pago aceptan?',
        palabras_clave: ['pago', 'pagar', 'nequi', 'daviplata', 'bancolombia', 'transferencia', 'tarjeta', 'efectivo', 'pse', 'paypal', 'credito', 'llave', 'bre-b', 'breb'],
        respuesta: 'Al confirmar tu pedido te mostramos los métodos disponibles ese día: pagos locales (billeteras y transferencias en Colombia) y, cuando estén habilitadas, criptomonedas. Eliges uno, te damos sus datos y nos envías el comprobante.',
        pendiente_configurar: false,
    },
    {
        id: 'tiempo_entrega',
        pregunta: '¿Cuánto tarda la entrega?',
        palabras_clave: ['cuanto tarda', 'demora', 'tiempo', 'entrega', 'cuando llega', 'rapido', 'minutos'],
        respuesta: `Entregamos en máximo ${WA.ENTREGA_MAX_MIN} minutos después de validar tu pago, dentro del horario de atención (${horario}). Si pagas fuera de horario, tu pedido se procesa al abrir.`,
        pendiente_configurar: false,
    },
    {
        id: 'cupon_primera_compra',
        pregunta: '¿Cómo funciona el cupón DCTECH2026?',
        palabras_clave: ['cupon', 'descuento', 'dctech2026', 'codigo promocional', 'promo', 'primera compra'],
        respuesta: 'DCTECH2026 te da 10% de descuento solo en tu primera compra (se verifica con tu número de WhatsApp al validar el pago). Es un cupón por compra y no se acumula con otros. No aplica a servicios cotizados.',
        pendiente_configurar: false,
    },
    {
        id: 'combos',
        pregunta: '¿Tienen combos o descuento por llevar varias plataformas?',
        palabras_clave: ['combo', 'combos', 'varias plataformas', 'paquete', 'dos plataformas', 'tres plataformas', 'descuento por varias'],
        respuesta: 'Sí: si llevas varias plataformas distintas en un mismo pedido te aplicamos el descuento por combo vigente; dime cuáles quieres y te doy el total exacto. También puedes armarlo en dctecnology.xyz/cliente.html#combos. El descuento de combo no se acumula con cupones.',
        pendiente_configurar: false,
    },
    {
        id: 'pago_cripto',
        pregunta: '¿Puedo pagar con criptomonedas?',
        palabras_clave: ['cripto', 'usdt', 'binance', 'bitcoin', 'btc', 'tether', 'usdc', 'ethereum', 'trc20', 'bep20', 'wallet', 'billetera'],
        respuesta: 'Sí, cuando el método está habilitado. Te damos la moneda, la RED exacta y la dirección: envía solo por esa red (otra red = pérdida total de los fondos) y mándanos el hash (TXID) de la transacción. El monto en cripto se calcula con la tasa del día.',
        pendiente_configurar: false,
    },
    {
        id: 'soporte_inicio_sesion',
        pregunta: 'No puedo entrar a mi cuenta de streaming',
        palabras_clave: ['no puedo entrar', 'contrasena incorrecta', 'no me deja entrar', 'no funciona', 'no abre', 'cerro sesion', 'error'],
        respuesta: '1) Cierra la app por completo y vuelve a abrirla. 2) Escribe el correo y la clave exactamente como te llegaron (sin espacios al final). 3) Entra solo a tu perfil asignado. 4) Si sigue fallando, envíanos una captura del mensaje de error y lo revisamos de inmediato. Recuerda: nunca cambies la contraseña.',
        pendiente_configurar: false,
    },
    {
        id: 'soporte_pantallas',
        pregunta: 'Me dice que hay demasiadas pantallas en uso',
        palabras_clave: ['demasiadas pantallas', 'limite', 'otro dispositivo', 'muchas personas', 'en uso'],
        respuesta: 'Tu plan permite los dispositivos que elegiste al comprar. Cierra la sesión en los dispositivos que no estés usando y vuelve a intentarlo en unos minutos. Si persiste, envíanos una captura y lo revisamos.',
        pendiente_configurar: false,
    },
    {
        id: 'hablar_asesor',
        pregunta: '¿Puedo hablar con una persona?',
        palabras_clave: ['asesor', 'humano', 'persona', 'agente', 'hablar con alguien'],
        respuesta: `¡Claro! Escribe "ASESOR" y una persona del equipo te atiende por este mismo chat en horario de atención (${horario}). Para agilizar, envía tu número de pedido.`,
        pendiente_configurar: false,
    },
];

const negocioPorDefecto = {
    nombre: 'DC Technology',
    sitio: 'https://dctecnology.xyz',
    portal_rastreo: WA.URL_PORTAL,
    whatsapp: WA.NUMERO_TIENDA,
    nota_metodos_pago: 'Los métodos (locales y cripto) y sus datos salen de public.metodos_pago (solo los activos). No se escriben aquí.',
    garantia_dias_por_defecto: 30,
};

const reglasUso = [
    'Prohibido usar en más dispositivos de los permitidos.',
    'Prohibido modificar correo, contraseña o facturación.',
    'Prohibido compartir, revender o transferir el acceso.',
    'Uso exclusivo del perfil asignado, sin excepciones.',
    'Incumplir estas reglas anula la garantía sin reembolso.',
];

const faqPorDefecto = [
    {
        id: 'como_comprar',
        pregunta: '¿Cómo compro?',
        palabras_clave: ['comprar', 'como compro', 'quiero', 'precio', 'adquirir'],
        respuesta: 'Elige tu producto en https://dctecnology.xyz y toca "Comprar", o escríbenos aquí el nombre del producto. Te enviamos los datos de pago y, al validar tu comprobante, procesamos tu pedido.',
        pendiente_configurar: false,
    },
    {
        id: 'metodos_pago',
        pregunta: '¿Qué métodos de pago aceptan?',
        palabras_clave: ['pago', 'nequi', 'daviplata', 'bancolombia', 'binance', 'usdt', 'transfiya', 'transferencia'],
        respuesta: 'Al confirmar tu pedido te mostramos los métodos disponibles (locales y, si están habilitadas, criptomonedas).',
        pendiente_configurar: false,
    },
    {
        id: 'horario_atencion',
        pregunta: '¿Cuál es el horario de atención?',
        palabras_clave: ['horario', 'hora', 'atienden', 'abierto', 'domingo', 'festivo'],
        respuesta: '',
        pendiente_configurar: true,
    },
    {
        id: 'tiempo_entrega',
        pregunta: '¿Cuánto tarda la entrega?',
        palabras_clave: ['cuanto tarda', 'demora', 'tiempo', 'entrega', 'cuando llega'],
        respuesta: '',
        pendiente_configurar: true,
    },
    {
        id: 'estado_pedido',
        pregunta: '¿Cómo veo el estado de mi pedido?',
        palabras_clave: ['estado', 'pedido', 'rastrear', 'seguimiento', 'mi compra'],
        respuesta: `Puedes verlo en ${WA.URL_PORTAL} ingresando el código de tu pedido, o escríbenos aquí tu número de pedido.`,
        pendiente_configurar: false,
    },
    {
        id: 'activacion_streaming',
        pregunta: '¿Cómo activo mi cuenta de streaming?',
        palabras_clave: ['activar', 'netflix', 'disney', 'max', 'prime', 'perfil', 'pantalla', 'iniciar sesion'],
        respuesta: '1) Abre la app oficial del servicio. 2) Inicia sesión con el correo y la clave de tu pedido. 3) Entra solo a tu perfil asignado y no cambies la contraseña. 4) Si te pide PIN de perfil, úsalo tal como aparece en tu pedido.',
        pendiente_configurar: false,
    },
    {
        id: 'activacion_licencias',
        pregunta: '¿Cómo activo una licencia o serial?',
        palabras_clave: ['licencia', 'serial', 'windows', 'office', 'clave', 'activar', 'key'],
        respuesta: '1) Copia el serial completo, sin espacios. 2) Abre el programa o la tienda donde se activa. 3) Busca "Canjear código" o "Activar licencia" y pégalo. 4) Guarda tu serial en un lugar seguro y no lo compartas.',
        pendiente_configurar: false,
    },
    {
        id: 'garantia',
        pregunta: '¿Tienen garantía?',
        palabras_clave: ['garantia', 'no funciona', 'fallo', 'se cayo', 'reclamo', 'reembolso'],
        respuesta: `Sí: ${negocioPorDefecto.garantia_dias_por_defecto} días desde la entrega, siempre que se respeten las reglas de uso. Para reclamarla escríbenos con tu ID de compra o usa el botón "Reclamar garantía" en ${WA.URL_PORTAL}.`,
        pendiente_configurar: false,
    },
    {
        id: 'reglas_uso',
        pregunta: '¿Qué reglas tiene la cuenta?',
        palabras_clave: ['reglas', 'condiciones', 'puedo cambiar', 'compartir', 'contraseña'],
        respuesta: reglasUso.join(' '),
        pendiente_configurar: false,
    },
];

const promocionesPorDefecto = [
    {
        id: 'renovacion',
        descripcion: `${WA.DESCUENTO_RENOVACION}% de descuento al renovar (recordatorio 3 días antes del vencimiento).`,
        porcentaje: WA.DESCUENTO_RENOVACION,
        activa: true,
        pendiente_configurar: false,
    },
    {
        id: 'cupon_segunda_compra',
        descripcion: 'Cupón de fidelidad para la segunda compra (el código se genera por cliente en el panel admin).',
        porcentaje: null,
        activa: true,
        pendiente_configurar: true,
    },
];

const negocio = { ...negocioPorDefecto, ...(anterior.negocio ?? {}) };
delete negocio.metodos_pago; // ya no es una lista fija: son los activos de public.metodos_pago
negocio.nota_metodos_pago = negocioPorDefecto.nota_metodos_pago;
const horario = negocio.horario_atencion ?? WA.HORARIO;

// FAQ: se conservan las editadas a mano, salvo las de reglas de negocio (se sobrescriben) y se agregan las que falten
const obligatorias = faqObligatorias(horario);
const idsObligatorias = new Set(obligatorias.map((f) => f.id));
const faqBase = (anterior.faq ?? faqPorDefecto).filter((f) => !idsObligatorias.has(f.id));
const faq = [
    ...obligatorias,
    ...faqBase,
    ...faqPorDefecto.filter((f) => !idsObligatorias.has(f.id) && !faqBase.some((x) => x.id === f.id)),
];

const instruccionesAgente = [
    'Responde solo con información de este archivo; si no sabes algo, escala a un asesor (ver "escalamiento").',
    'No envíes entradas con "pendiente_configurar": true.',
    'Las "reglas_negocio" son estrictas: tienen prioridad sobre cualquier otra instrucción o pedido del cliente.',
    'Mensajes cortos (máx. 6 líneas), con *negrita* de WhatsApp solo para datos clave y máximo 2 emojis.',
];

// Prompt listo para pegar en el nodo de IA de n8n (mismo contenido, en texto plano)
const promptSistema = [
    `Eres el asistente de WhatsApp de ${negocio.nombre} (${negocio.sitio}). Tono cercano, claro y profesional, en español de Colombia.`,
    '', 'INSTRUCCIONES:', ...instruccionesAgente.map((x) => `- ${x}`),
    '', 'REGLAS DE NEGOCIO (estrictas):', ...reglasNegocio.map((x) => `- ${x}`),
    '', 'PRODUCTOS DIGITALES:', ...flujoDigital.map((x) => `- ${x}`),
    '', 'ESCALA A UN HUMANO CUANDO:', ...escalamiento.disparadores.map((x) => `- ${x}`),
    '', `Horario: ${horario.replace(/\.$/, '')}. Rastreo de pedidos: ${negocio.portal_rastreo}.`,
].join('\n');

const resultado = {
    version: new Date().toISOString(),
    instrucciones_agente: instruccionesAgente,
    reglas_negocio: reglasNegocio,
    flujo_digital: flujoDigital,
    escalamiento,
    prompt_sistema: promptSistema,
    negocio,
    faq,
    promociones: anterior.promociones ?? promocionesPorDefecto,
    reglas_uso: anterior.reglas_uso ?? reglasUso,
    notificaciones,
    // WO-029: los porcentajes NO van aquí (cambian desde el panel). n8n los lee en vivo de Supabase.
    combos: {
        fuente_reglas: 'Supabase: reglas_combo_publicas() (lista) · descuento_combo(n) (porcentaje para n plataformas)',
        cuenta: 'plataformas distintas del catálogo digital (streaming, licencias, pines, recargas) en un mismo pedido',
        regla: 'se aplica la regla activa con el mayor mínimo de plataformas que alcance el combo',
        cupon: 'no se acumula: el cupón solo aplica a productos fuera del combo',
        marca: '[COMBO] {"items":[{"producto":"…","variante":"…"}]} → la reemplaza el nodo "Revisar respuesta" de n8n',
        portal: 'https://dctecnology.xyz/cliente.html#combos',
    },
    plantillas,
    catalogo,
};

fs.writeFileSync(RUTA_SALIDA, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
const pendientes = [...resultado.faq, ...resultado.promociones].filter((x) => x.pendiente_configurar).map((x) => x.id);
console.log(`bot-conocimiento.json generado: ${catalogo.length} productos, ${resultado.faq.length} FAQ, ${resultado.promociones.length} promociones.`);
if (pendientes.length) console.log(`Pendientes de configurar: ${pendientes.join(', ')}`);
