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
    const FIRMA = '⚡ *DC TECHNOLOGY*';

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

    // Dato de cliente/BD seguro para WhatsApp: sin * _ ~ ` (no rompe la negrita ni la cursiva),
    // espacios colapsados y largo acotado
    const limpiarVariable = (valor, max = 120) => String(valor ?? '')
        .replace(/[*_~`]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);

    // Rellena {marcadores}. Si un marcador queda vacío se omite SU línea completa
    // (p. ej. "• Cupón: {cupon}" cuando no hay cupón) y se compactan los saltos de línea.
    // n8n usa esta misma lógica (ver n8n/notificaciones-posventa.md).
    function rellenar(plantilla, variables = {}) {
        return String(plantilla ?? '')
            .split('\n')
            .map((linea) => {
                let incompleta = false;
                const texto = linea.replace(/\{(\w+)\}/g, (_, clave) => {
                    const valor = limpiarVariable(variables[clave]);
                    if (!valor) incompleta = true;
                    return valor;
                });
                return incompleta ? null : texto.replace(/[ \t]+$/, '');
            })
            .filter((linea) => linea !== null)
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /* ---------- Métodos de pago (WO-027) ----------
       Catálogo de TIPOS que el sistema sabe manejar. Lo que ve el cliente sale SOLO de lo que el
       administrador activa en public.metodos_pago (supabase/wo-027-metodos-pago.sql).
       'valor' = valor del enum public.metodo_pago (registro del pago). 'campo' = qué dato pide el panel. */
    const TIPOS_PAGO = [
        { tipo: 'NEQUI', nombre: 'Nequi', categoria: 'electronico', icono: 'fa-solid fa-mobile-screen-button', color: '#DA0081', campo: 'Número Nequi' },
        { tipo: 'DAVIPLATA', nombre: 'Daviplata', categoria: 'electronico', icono: 'fa-solid fa-mobile-screen-button', color: '#E1251B', campo: 'Número Daviplata' },
        { tipo: 'LLAVE_BREB', nombre: 'Llave Bre-B', categoria: 'electronico', icono: 'fa-solid fa-key', color: '#0EA5E9', campo: 'Llave (celular, correo, cédula o @alias)' },
        { tipo: 'BANCOLOMBIA', nombre: 'Bancolombia', categoria: 'electronico', icono: 'fa-solid fa-building-columns', color: '#FDDA24', campo: 'Número de cuenta' },
        { tipo: 'TRANSFERENCIA', nombre: 'Transferencia bancaria', categoria: 'electronico', icono: 'fa-solid fa-building-columns', color: '#64748B', campo: 'Banco y número de cuenta' },
        { tipo: 'PSE', nombre: 'PSE', categoria: 'electronico', icono: 'fa-solid fa-globe', color: '#1D4ED8', campo: 'Enlace de pago PSE', requiereUrl: true },
        { tipo: 'ENLACE', nombre: 'Tarjeta (enlace de pago)', categoria: 'electronico', icono: 'fa-solid fa-credit-card', color: '#7C3AED', campo: 'Enlace de pago', requiereUrl: true },
        { tipo: 'PAYPAL', nombre: 'PayPal', categoria: 'electronico', icono: 'fa-brands fa-paypal', color: '#0070BA', campo: 'Correo o enlace PayPal.me' },
        { tipo: 'BINANCE_PAY', nombre: 'Binance Pay', categoria: 'cripto', icono: 'fa-solid fa-coins', color: '#F0B90B', campo: 'Pay ID o correo de Binance', monedas: ['USDT', 'USDC', 'BTC', 'BNB'], redes: ['BINANCE_PAY'] },
        { tipo: 'USDT', nombre: 'USDT (Tether)', categoria: 'cripto', icono: 'fa-solid fa-dollar-sign', color: '#26A17B', campo: 'Dirección de la billetera', monedas: ['USDT'], redes: ['TRC20', 'BEP20', 'ERC20', 'POLYGON', 'SOL', 'TON'] },
        { tipo: 'USDC', nombre: 'USDC', categoria: 'cripto', icono: 'fa-solid fa-dollar-sign', color: '#2775CA', campo: 'Dirección de la billetera', monedas: ['USDC'], redes: ['ERC20', 'BEP20', 'POLYGON', 'SOL', 'BASE'] },
        { tipo: 'BTC', nombre: 'Bitcoin', categoria: 'cripto', icono: 'fa-brands fa-bitcoin', color: '#F7931A', campo: 'Dirección de la billetera', monedas: ['BTC'], redes: ['BTC'] },
        { tipo: 'ETH', nombre: 'Ethereum', categoria: 'cripto', icono: 'fa-brands fa-ethereum', color: '#627EEA', campo: 'Dirección de la billetera', monedas: ['ETH'], redes: ['ERC20', 'ARBITRUM', 'BASE'] },
        { tipo: 'BNB', nombre: 'BNB', categoria: 'cripto', icono: 'fa-solid fa-coins', color: '#F0B90B', campo: 'Dirección de la billetera', monedas: ['BNB'], redes: ['BEP20'] },
        { tipo: 'SOL', nombre: 'Solana', categoria: 'cripto', icono: 'fa-solid fa-sun', color: '#9945FF', campo: 'Dirección de la billetera', monedas: ['SOL'], redes: ['SOL'] },
        { tipo: 'TRX', nombre: 'TRON (TRX)', categoria: 'cripto', icono: 'fa-solid fa-coins', color: '#EF0027', campo: 'Dirección de la billetera', monedas: ['TRX'], redes: ['TRC20'] },
        { tipo: 'LTC', nombre: 'Litecoin', categoria: 'cripto', icono: 'fa-solid fa-coins', color: '#345D9D', campo: 'Dirección de la billetera', monedas: ['LTC'], redes: ['LTC'] },
    ];
    const CATEGORIAS_PAGO = { electronico: 'Pagos locales y electrónicos', cripto: 'Criptomonedas' };
    const tipoPago = (tipo) => TIPOS_PAGO.find((t) => t.tipo === tipo) ?? null;

    // Formato de dirección por red: un error de red o de dirección es pérdida total de fondos.
    // Mismas reglas que public.direccion_cripto_valida() en la base de datos.
    const FORMATO_RED = {
        TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
        BEP20: /^0x[0-9a-fA-F]{40}$/,
        ERC20: /^0x[0-9a-fA-F]{40}$/,
        POLYGON: /^0x[0-9a-fA-F]{40}$/,
        ARBITRUM: /^0x[0-9a-fA-F]{40}$/,
        BASE: /^0x[0-9a-fA-F]{40}$/,
        SOL: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
        TON: /^(EQ|UQ)[A-Za-z0-9_-]{46}$/,
        BTC: /^(bc1[02-9ac-hj-np-z]{25,62}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
        LTC: /^(ltc1[02-9ac-hj-np-z]{25,62}|[LM3][1-9A-HJ-NP-Za-km-z]{26,33})$/,
        BINANCE_PAY: /^(\d{6,12}|[^\s@]+@[^\s@]+\.[^\s@]+)$/,
    };
    const direccionValida = (red, valor) => Boolean(FORMATO_RED[red] && FORMATO_RED[red].test(String(valor ?? '').trim()));

    // Monto a pagar en cripto con la tasa que fijó el administrador (COP por 1 unidad). null = no cotizar.
    // Se redondea HACIA ARRIBA para no recibir de menos; la tasa vence a las 24 h.
    function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
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
        TIPOS_PAGO,
        CATEGORIAS_PAGO,
        tipoPago,
        FORMATO_RED,
        direccionValida,
        montoCripto,
        limpiarVariable,
        rellenar,
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
            `• Producto: ${limpiarVariable(producto)}`,
            variante ? `• Opción: ${limpiarVariable(variante)}` : null,
            precio !== undefined && precio !== '' ? `• Valor: ${precioCOP(precio)}` : null,
            '¿Me indican los datos para realizar el pago?',
        ].filter(Boolean).join('\n'),

        // Sin encodeURIComponent: los códigos son [A-Z0-9-] y así el marcador {pedido} llega intacto a n8n
        // Pedido desde la tienda con cantidad y cupón. El descuento se confirma al validar el pago.
        pedidoTienda: ({ producto, variante, cantidad = 1, precioUnitario, cupon, porcentaje, total }) => [
            'Hola DC Technology, quiero comprar:',
            `• Producto: ${limpiarVariable(producto)}`,
            variante ? `• Opción: ${limpiarVariable(variante)}` : null,
            `• Cantidad: ${cantidad}`,
            precioUnitario !== undefined ? `• Precio unitario: ${precioCOP(precioUnitario)}` : null,
            cupon ? `• Cupón: ${cupon} (-${porcentaje}%)` : null,
            total !== undefined ? `• Total a pagar: ${precioCOP(total)}` : null, // la línea del cupón ya indica el descuento
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
            `¡Gracias por confiar en DC TECHNOLOGY! Por tu compra de ${producto}, aquí tienes un cupón para tu próxima compra: ${cupon}. Escríbenos cuando quieras usarlo.`,

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

        // WO-028: código de acceso al portal de clientes (supabase/wo-028-portal.sql → solicitar_otp).
        // La cola borra el código apenas se envía y lo cancela si no sale en 5 minutos.
        // WO-032: órdenes web (portal) y reportes de falla
        ordenValidada: ({ codigo, total }) => [
            `✅ *¡Pago validado!* · ${FIRMA}`,
            '',
            `Tu orden *${codigo}* por *$${total}* ya está confirmada y entra a proceso.`,
            `⏱️ Entrega: máximo *${ENTREGA_MAX_MIN} minutos* (${HORARIO}).`,
            '',
            '🔎 Síguela en Mis pedidos: dctecnology.xyz/cliente.html#cuenta',
        ].join('\n'),
        ordenRechazada: ({ codigo, motivo }) => [
            `⚠️ *Revisamos tu comprobante* · ${FIRMA}`,
            '',
            `No pudimos validar el pago de tu orden *${codigo}*.`,
            `Motivo: ${motivo}`,
            '',
            'Puedes subir otro comprobante en Mis pedidos (dctecnology.xyz/cliente.html#cuenta) o responder aquí y te ayudamos.',
        ].join('\n'),
        reporteResuelto: ({ producto, nota }) => [
            `🛠️ *Tu reporte fue atendido* · ${FIRMA}`,
            '',
            `Producto: ${producto}`,
            `Solución: ${nota}`,
            '',
            '¿Sigue fallando? Responde *SOPORTE* y lo revisamos de nuevo.',
        ].join('\n'),
        adminComprobante: ({ codigo, cliente, metodo, total, referencia }) => [
            '🧾 *Comprobante nuevo en el portal*',
            `Orden: *${codigo}* · $${total} · ${metodo}`,
            `Cliente: +${cliente}`,
            `Referencia: ${referencia}`,
            'Valídalo en el panel → Pagos & Agente Bot → Comprobantes web.',
        ].join('\n'),
        adminFalla: ({ reporte, cliente, producto, problema, garantia }) => [
            '🛠️ *Falla reportada en el portal*',
            `Reporte #${reporte} · Cliente: +${cliente}`,
            `Producto: ${producto}`,
            `Problema: ${problema}`,
            `En garantía: ${garantia}`,
            'Atiéndelo y ciérralo en el panel (Reportes de falla).',
        ].join('\n'),

        codigoAcceso: ({ codigo }) => [
            `🔐 *Tu código de acceso* · ${FIRMA}`,
            '',
            `*${codigo}*`,
            '',
            'Escríbelo en dctecnology.xyz para ver tus pedidos y accesos.',
            '⏱️ Vence en *5 minutos*.',
            '',
            '⚠️ No lo compartas con nadie: ningún asesor de DC TECHNOLOGY te lo pedirá.',
            '_Si no lo solicitaste, ignora este mensaje._',
        ].join('\n'),

        // Entrega de accesos de un producto digital (triangulación con el proveedor, WO-024).
        // Las líneas con datos vacíos se omiten al rellenar (p. ej. sin PIN de perfil).
        entregaCredenciales: ({ pedido, producto, usuario, clave, perfil, pin, codigo }) => [
            `🔐 *¡Tus accesos están listos!* · ${FIRMA}`,
            '',
            `📦 Pedido: *#${pedido}*`,
            `🛒 Producto: ${producto}`,
            '',
            // Monoespaciado (```): WhatsApp no aplica formato adentro, así * _ ~ de una clave se ven tal cual.
            // Estos 4 datos se insertan EXACTOS (sin limpiar): ver "Mensaje de entrega" en n8n/generar_flujo_n8n.js
            `👤 Usuario / correo: \`\`\`${usuario}\`\`\``,
            `🔑 Clave: \`\`\`${clave}\`\`\``,
            perfil !== undefined ? `🙋 Perfil: \`\`\`${perfil}\`\`\`` : null,
            pin !== undefined ? `🔢 PIN: \`\`\`${pin}\`\`\`` : null,
            '',
            '📌 Para conservar tu garantía: no cambies correo ni contraseña, usa solo tu perfil y no compartas el acceso.',
            codigo !== undefined ? `🛡️ Garantía y soporte: ${URL_PORTAL}?codigo=${codigo}` : null,
            '',
            '¿Algo no funciona? Responde *SOPORTE* 🛠️',
        ].filter((l) => l !== null).join('\n'),

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
