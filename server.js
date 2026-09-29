const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json());

const EVENTS_SECRET = process.env.WOMPI_EVENTS_SECRET;       // Secreto de eventos (Wompi > Desarrolladores)
const INTEGRITY_SECRET = process.env.WOMPI_INTEGRITY_SECRET; // export WOMPI_INTEGRITY_SECRET=prod_integrity_xxx
const cargarCatalogo = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'productos.json'), 'utf8'));

// Verifica que el evento realmente venga de Wompi:
// SHA256( valores de signature.properties (en orden) + timestamp + secreto de eventos )
const checksumValido = (evento, headerChecksum) => {
    try {
        if (!EVENTS_SECRET || !evento.signature || !Array.isArray(evento.signature.properties)) return false;
        const valores = evento.signature.properties.map(ruta =>
            ruta.split('.').reduce((obj, k) => (obj == null ? undefined : obj[k]), evento.data)
        );
        if (valores.some(v => v === undefined || v === null)) return false;

        const calculado = crypto.createHash('sha256')
            .update(valores.join('') + evento.timestamp + EVENTS_SECRET)
            .digest('hex');

        const recibido = String(headerChecksum || evento.signature.checksum || '').toLowerCase();
        const a = Buffer.from(calculado, 'utf8'), b = Buffer.from(recibido, 'utf8');
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (e) {
        return false;
    }
};

// Firma de integridad: el precio se toma del catálogo del servidor, no del navegador
app.post('/api/wompi-firma', (req, res) => {
    const { productId, varianteIdx } = req.body || {};
    const prod = cargarCatalogo().find(p => p.id === productId);
    const variante = prod && prod.variantes[Number(varianteIdx)];
    if (!variante || !INTEGRITY_SECRET) return res.status(400).json({ error: 'Solicitud inválida' });

    const amountInCents = Math.round(Number(variante.precio) * 100);
    const reference = `DC-${prod.id}-v${Number(varianteIdx)}-${Date.now()}`;
    const signature = crypto.createHash('sha256')
        .update(`${reference}${amountInCents}COP${INTEGRITY_SECRET}`)
        .digest('hex');
    res.json({ reference, amountInCents, currency: 'COP', signature });
});

// Webhook que escucha la confirmación de pago de Wompi / MercadoPago
app.post('/webhook-pago', async (req, res) => {
    const evento = req.body;

    // Rechazar cualquier evento sin checksum válido
    if (!checksumValido(evento, req.get('x-event-checksum'))) {
        console.warn('Webhook rechazado: checksum inválido');
        return res.sendStatus(401);
    }

    if (evento.event === 'transaction.updated' && evento.data.transaction.status === 'APPROVED') {
        const tx = evento.data.transaction;
        const tel = String(tx.customer_data.phone_number).replace(/\D/g, '');
        const telefonoCliente = tel.length === 10 ? '57' + tel : tel; // WhatsApp requiere indicativo de país

        // reference = DC-<idProducto>-v<indiceVariante>-<timestamp>
        const m = /^DC-(.+)-v(\d+)-\d+$/.exec(tx.reference);
        if (!m) return res.sendStatus(200);
        const prodCat = cargarCatalogo().find(p => p.id === m[1]);
        const varCat = prodCat && prodCat.variantes[Number(m[2])];
        // El monto pagado debe coincidir con el precio del catálogo
        if (!varCat || Math.round(Number(varCat.precio) * 100) !== tx.amount_in_cents) {
            console.warn('Webhook rechazado: monto no coincide', tx.reference);
            return res.sendStatus(200);
        }
        const productoComprado = prodCat ? prodCat.nombre : m[1];

        // 1. Obtener la licencia / cuenta de la base de datos
        const licencia = await obtenerLicenciaDisponible(m[1], Number(m[2]));

        // 2. Enviar la licencia automáticamente por WhatsApp
        await enviarMensajeWhatsApp(telefonoCliente, `✅ *¡Pago Confirmado en DC Technology!*\n\nTu suscripción/licencia para *${productoComprado}* está lista:\n\n🔑 *Datos de Acceso / PIN:* ${licencia.clave}\n📌 *Instrucciones:* ${licencia.instrucciones}\n\n¡Gracias por tu compra!`);
    }
    res.sendStatus(200);
});

app.listen(3000, () => console.log('Servidor de Despacho DC Technology activo en puerto 3000'));