// herramientas/armar-pendientes.js — Une en supabase/APLICAR-PENDIENTES.sql los SQL que faltan por aplicar, en orden.
//   node herramientas/armar-pendientes.js
// Cada archivo es idempotente y verifica sus requisitos ("Nada se aplicó…"), así que el conjunto también.
const fs = require('fs');
const path = require('path');
const SQL = path.join(__dirname, '..', 'supabase');
const ORDEN = [
    ['wo-042-pedidos-whatsapp.sql', 'pedidos por WhatsApp'],
    ['wo-043-stock-pines.sql', 'stock de pines'],
    ['wo-044-renovaciones.sql', 'renovaciones'],
    ['wo-025-promociones.sql', 'promociones del día'],
    ['wo-045-seguridad.sql', 'permisos de medios de pago'],
    ['wo-046-finanzas.sql', 'centro financiero'],
    ['wo-047-proveedor-y-rastreo.sql', 'categorías del proveedor, existencias y rastreo'],
    ['wo-041-emprendered.sql', 'Emprende Red al 50 %'],
    ['wo-048-horario-legal.sql', 'horario legal'],
    ['wo-049-netflix-30-dias.sql', 'Netflix 30 días'],
    ['wo-050-disponibilidad.sql', 'agotados y repuestos'],
    ['wo-051-cantidades-anc.sql', 'cantidades de ANC'],
    ['wo-052-resumen-dia.sql', 'resumen diario de ventas'],
];
const hoy = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric' });
const partes = [
    '-- =====================================================================',
    `-- APLICAR PENDIENTES (${hoy}): ${ORDEN.map(([f, d]) => `${f.match(/wo-\d+/)[0].slice(3)} (${d})`).join(' → ')}`,
    '-- Supabase → SQL Editor → New query → pegar todo → Run. Es idempotente: si se corre dos veces no pasa nada.',
    '-- Si sale un error que empieza por "Nada se aplicó", copia el mensaje y me lo pasas.',
    '-- Generado con: node herramientas/armar-pendientes.js (no editar a mano).',
    '-- =====================================================================',
    '',
];
for (const [f] of ORDEN) partes.push('', `-- ######################## ${f} ########################`, fs.readFileSync(path.join(SQL, f), 'utf8').replace(/\r\n/g, '\n').trimEnd(), '');
fs.writeFileSync(path.join(SQL, 'APLICAR-PENDIENTES.sql'), partes.join('\n') + '\n');
console.log(`supabase/APLICAR-PENDIENTES.sql: ${ORDEN.length} archivos`);
