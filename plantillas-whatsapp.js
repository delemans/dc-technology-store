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

        // Mensaje al proveedor (ALL NECESSARY COLOMBIA)
        pedidoProveedor: ({ pedido, producto, cantidad = 1 }) =>
            `Hola, adjunto pedido #${pedido}: ${producto} x${cantidad}. Favor confirmar recepción.`,
    };
});
