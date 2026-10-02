// plantillas-whatsapp.js — Fuente única de los mensajes de WhatsApp de DC Technology.
// Funciona en el navegador (window.PlantillasWA) y en Node (require), para que
// generar_bot_conocimiento.js copie EXACTAMENTE los mismos textos a bot-conocimiento.json (n8n / Evolution API).
(function (raiz, fabrica) {
    const plantillas = fabrica();
    if (typeof module === 'object' && module.exports) module.exports = plantillas;
    else raiz.PlantillasWA = plantillas;
})(typeof self !== 'undefined' ? self : this, function () {
    const NUMERO_TIENDA = '573223284622';
    const URL_PORTAL = 'https://dctecnology.xyz/portal.html';
    const DESCUENTO_RENOVACION = 10; // % prometido en el recordatorio de renovación
    const ENTREGA_MAX_MIN = 15;      // minutos máximos de entrega tras validar el pago (en horario)
    const HORARIO = 'lunes a sábado, 8:00 a.m. a 8:00 p.m.';
    const FIRMA = '⚡ *DC Technology*';

    // Números colombianos: 3001234567 → 573001234567. Devuelve null si no parece un número válido.
    function normalizarNumero(numero) {
        const digitos = String(numero ?? '').replace(/\D/g, '');
        if (/^3\d{9}$/.test(digitos)) return `57${digitos}`;
        if (/^\d{11,15}$/.test(digitos)) return digitos;
        return null;
    }

    function enlace(numero, texto) {
        const destino = normalizarNumero(numero) ?? NUMERO_TIENDA;
        return `https://wa.me/${destino}?text=${encodeURIComponent(texto)}`;
    }

    const precioCOP = (valor) => Number.isFinite(Number(valor))
        ? Number(valor).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
        : String(valor ?? '');

    return {
        NUMERO_TIENDA,
        URL_PORTAL,
        DESCUENTO_RENOVACION,
        ENTREGA_MAX_MIN,
        HORARIO,
        normalizarNumero,
        enlace,
        precioCOP,

        // Acciones rápidas (en n8n/Evolution API se pueden ofrecer como botones)
        botones: [
            { id: 'comprar', texto: 'Comprar ahora' },
            { id: 'estado', texto: 'Consultar estado' },
            { id: 'soporte', texto: 'Solicitar soporte' },
        ],

        comprarAhora: ({ producto, variante, precio }) => [
            'Hola DC Technology, quiero comprar:',
            `• Producto: ${producto}`,
            variante ? `• Opción: ${variante}` : null,
            precio !== undefined && precio !== '' ? `• Valor: ${precioCOP(precio)}` : null,
            '¿Me indican los datos para realizar el pago?',
        ].filter(Boolean).join('\n'),

        // Sin encodeURIComponent: los códigos son [A-Z0-9-] y así el marcador {pedido} llega intacto a n8n
        // Pedido desde la tienda con cantidad y cupón. El descuento se confirma al validar el pago.
        pedidoTienda: ({ producto, variante, cantidad = 1, precioUnitario, cupon, porcentaje, total }) => [
            'Hola DC Technology, quiero comprar:',
            `• Producto: ${producto}`,
            variante ? `• Opción: ${variante}` : null,
            `• Cantidad: ${cantidad}`,
            precioUnitario !== undefined ? `• Precio unitario: ${precioCOP(precioUnitario)}` : null,
            cupon ? `• Cupón: ${cupon} (-${porcentaje}%)` : null,
            total !== undefined ? `• Total${cupon ? ' con descuento' : ''}: ${precioCOP(total)}` : null,
            'Acepté los términos de uso. ¿Me indican los datos para realizar el pago?',
        ].filter(Boolean).join('\n'),

        agendarServicio: ({ servicio, opcion, fecha, franja, detalle, estimado }) => [
            'Hola DC Technology, quiero agendar un servicio:',
            `• Servicio: ${servicio}`,
            opcion ? `• Opción: ${opcion}` : null,
            fecha ? `• Fecha preferida: ${fecha}` : null,
            franja ? `• Franja: ${franja}` : null,
            estimado !== undefined ? `• Valor estimado: ${precioCOP(estimado)}` : null,
            detalle ? `• Detalle: ${detalle}` : null,
            '¿Me confirman disponibilidad?',
        ].filter(Boolean).join('\n'),

        consultarEstado: ({ pedido }) =>
            `Hola, quiero consultar el estado de mi pedido #${pedido}.\nTambién puedo verlo aquí: ${URL_PORTAL}?codigo=${String(pedido).replace(/\s+/g, '')}`,

        solicitarSoporte: ({ pedido, producto }) =>
            `Hola, requiero soporte sobre mi pedido #${pedido}${producto ? ` (${producto})` : ''}.`,

        reclamarGarantia: ({ idCompra, pedido, producto, serialFinal, vence }) => [
            'Hola, equipo de soporte DC Technology.',
            'Quiero reclamar la garantía de mi compra:',
            `• ID de compra: #${idCompra}`,
            pedido && pedido !== idCompra ? `• Pedido: #${pedido}` : null,
            `• Producto: ${producto}`,
            serialFinal ? `• Cuenta/serial terminado en: ${serialFinal}` : null,
            vence ? `• Garantía vigente hasta: ${vence}` : null,
            'Describo la falla a continuación:',
        ].filter(Boolean).join('\n'),

        satisfaccion24h: ({ producto }) =>
            `¡Hola! ¿Cómo vas con tu cuenta de ${producto}? Queremos asegurar que todo funcione al 100%.`,

        renovacion3d: ({ producto, cupon }) =>
            `Tu suscripción a ${producto} vence pronto. Renueva hoy con un ${DESCUENTO_RENOVACION}% de descuento.` +
            (cupon ? ` Usa el código: ${cupon}` : ''),

        cuponFidelidad: ({ producto, cupon }) =>
            `¡Gracias por confiar en DC Technology! Por tu compra de ${producto}, aquí tienes un cupón para tu próxima compra: ${cupon}. Escríbenos cuando quieras usarlo.`,

        /* ---- Posventa automática (n8n lee notificaciones_whatsapp y usa estos textos) ----
           Formato WhatsApp: *negrita*, _cursiva_. Nunca incluyen credenciales: esas las entrega
           un asesor por el chat (modo sombra). 'codigo' = id de la compra (lo que busca el portal). */

        // ESPERANDO_PROVEEDOR: el pago fue validado y el pedido entra a proceso
        pagoRecibido: ({ pedido, producto, metodo, codigo }) => [
            `✅ *¡Pago confirmado!* · ${FIRMA}`,
            '',
            `Recibimos tu pago${metodo ? ` por *${metodo}*` : ''} y ya estamos procesando tu pedido.`,
            '',
            `📦 Pedido: *#${pedido}*`,
            `🛒 Producto: ${producto}`,
            `⏱️ Entrega: máximo *${ENTREGA_MAX_MIN} minutos* (${HORARIO}).`,
            '',
            '🔎 Sigue tu pedido en tiempo real:',
            `${URL_PORTAL}?codigo=${codigo}`,
            '',
            'Gracias por confiar en nosotros 🙌',
        ].join('\n'),

        // ENTREGADO / ENTREGADO_INMEDIATO: confirma la entrega y activa la garantía
        entregaConfirmada: ({ pedido, producto, garantiaDias, garantiaHasta, codigo }) => [
            `🎉 *¡Tu pedido fue entregado!* · ${FIRMA}`,
            '',
            `📦 Pedido: *#${pedido}*`,
            `🛒 Producto: ${producto}`,
            `🛡️ Garantía activa: *${garantiaDias} días* (hasta el ${garantiaHasta}).`,
            '',
            '🔐 Tus datos de acceso se entregan *solo por este chat oficial*. Si no los ves arriba, responde *ACCESOS* y te los reenviamos.',
            '📌 Para conservar tu garantía: no cambies correo ni contraseña y usa solo tu perfil asignado.',
            '',
            '🔎 Tu pedido y garantía:',
            `${URL_PORTAL}?codigo=${codigo}`,
            '',
            '¿Necesitas ayuda? Responde *SOPORTE* 🛠️',
        ].join('\n'),

        // 24 h después de la entrega (solo en horario y si aún no dejó reseña)
        solicitudResena: ({ producto, codigo }) => [
            `⭐ *¿Cómo te fue con ${producto}?* · ${FIRMA}`,
            '',
            'Ya pasó un día desde tu entrega y queremos confirmar que todo funciona al 100%.',
            '',
            '👉 Califícanos en 30 segundos (reseña de compra verificada):',
            `${URL_PORTAL}?codigo=${codigo}#resena`,
            '_Solo necesitas los últimos 4 dígitos de tu WhatsApp._',
            '',
            '¿Algo no va bien? Responde *SOPORTE* y lo resolvemos de inmediato.',
            '_Si prefieres no recibir estos mensajes, responde *NO*._',
        ].join('\n'),

        // Respuesta del bot al pasar la conversación a una persona
        escalarAsesor: ({ pedido } = {}) => [
            `🙋 *Te paso con un asesor humano* · ${FIRMA}`,
            '',
            `Nuestro equipo te responde por este chat en horario de atención (${HORARIO}).`,
            pedido ? `Ya tenemos tu pedido *#${pedido}* a la mano.` : 'Para agilizar, envíanos tu número de pedido y una captura del problema.',
        ].join('\n'),

        // Mensaje al proveedor (ALL NECESSARY COLOMBIA)
        pedidoProveedor: ({ pedido, producto, cantidad = 1 }) =>
            `Hola, adjunto pedido #${pedido}: ${producto} x${cantidad}. Favor confirmar recepción.`,
    };
});
