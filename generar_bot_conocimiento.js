// generar_bot_conocimiento.js — Construye bot-conocimiento.json para el agente de WhatsApp (n8n + Evolution API).
//
//   node generar_bot_conocimiento.js
//
// - 'catalogo' se regenera SIEMPRE desde productos.json (fuente única de precios).
// - 'plantillas' se regenera SIEMPRE desde plantillas-whatsapp.js (mismos textos que usan admin y portal).
// - 'negocio', 'faq' y 'promociones' se CONSERVAN si ya existen en bot-conocimiento.json: edítalos ahí a mano.
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
};

const negocioPorDefecto = {
    nombre: 'DC Technology',
    sitio: 'https://dctecnology.xyz',
    portal_rastreo: WA.URL_PORTAL,
    whatsapp: WA.NUMERO_TIENDA,
    metodos_pago: ['Nequi', 'Daviplata', 'Bancolombia', 'Binance (USDT)', 'Transfiya'],
    nota_metodos_pago: 'Los números de cuenta salen de la tabla public.metodos_pago (solo los activos). No se escriben aquí.',
    nota_horario_y_entrega: 'El horario y el tiempo de entrega se configuran en las FAQ "horario_atencion" y "tiempo_entrega".',
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
        respuesta: 'Recibimos Nequi, Daviplata, Bancolombia, Binance (USDT) y Transfiya. Te compartimos los datos de la cuenta al confirmar tu pedido. Envíanos el comprobante con su número de referencia.',
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

const resultado = {
    version: new Date().toISOString(),
    instrucciones_agente: [
        'Responde solo con información de este archivo; si no sabes algo, ofrece hablar con un asesor.',
        'No envíes entradas con "pendiente_configurar": true.',
        'Nunca entregues cuentas o seriales de forma automática: el humano aprueba (modo sombra).',
        'Los datos de cuentas de pago se leen de public.metodos_pago (activos), nunca de este archivo.',
    ],
    negocio: anterior.negocio ?? negocioPorDefecto,
    faq: anterior.faq ?? faqPorDefecto,
    promociones: anterior.promociones ?? promocionesPorDefecto,
    reglas_uso: anterior.reglas_uso ?? reglasUso,
    plantillas,
    catalogo,
};

fs.writeFileSync(RUTA_SALIDA, JSON.stringify(resultado, null, 2) + '\n', 'utf8');
const pendientes = [...resultado.faq, ...resultado.promociones].filter((x) => x.pendiente_configurar).map((x) => x.id);
console.log(`bot-conocimiento.json generado: ${catalogo.length} productos, ${resultado.faq.length} FAQ, ${resultado.promociones.length} promociones.`);
if (pendientes.length) console.log(`Pendientes de configurar: ${pendientes.join(', ')}`);
