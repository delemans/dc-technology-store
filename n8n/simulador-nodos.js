// n8n/simulador-nodos.js — GENERADO por n8n/generar_flujo_n8n.js (no editar a mano).
// Código real de los nodos del bot para el simulador del panel (Prueba del sistema). No envía nada.
window.SimuladorFlujo = { version: "2026-10-05T21:43:22.215Z", config: {"supabase_url":"https://vyqcizwfmjlflncdwzve.supabase.co","evolution_url":"https://TU-EVOLUTION-API","evolution_instancia":"TU-INSTANCIA","url_conocimiento":"https://dctecnology.xyz/bot-conocimiento.json","numero_aviso_admin":"","numero_proveedor":"","canal_compra":"web","anc_url":"https://ancpagos.com","anc_metodo":"nequi","anc_correo":"","anc_nombre":"DC","anc_apellido":"Technology","anc_whatsapp":"","palabras_asesor":"asesor,humano,persona,agente,reclamo,reembolso,devolucion,estafa,no me llego"}, nodos: {
"Normalizar mensaje": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const cfg = $('Config bot').first().json;
const evento = $('Webhook Evolution').first().json;
const b = evento.body ?? evento;
if (String(b.event ?? '').toLowerCase().replace(/_/g, '.') !== 'messages.upsert') return [];
const d = Array.isArray(b.data) ? b.data[0] : b.data;
const key = d?.key ?? {};
const jid = String(key.remoteJid ?? '');
if (!jid.endsWith('@s.whatsapp.net')) return []; // grupos, estados y canales: el bot no responde
const numero = jid.split('@')[0];
const m = d.message ?? {};
const texto = String(m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.documentMessage?.caption ?? m.videoMessage?.caption ?? '').trim();
// Foto o PDF = comprobante de pago (Nequi / Daviplata envían captura o PDF)
// Hash de transacción cripto (TXID): 64 hex (BTC, ETH/BEP20/TRC20…) o firma de Solana (base58, ~88)
const txid = (/\b(?:0x)?[0-9a-fA-F]{64}\b/.exec(texto) || /\b[1-9A-HJ-NP-Za-km-z]{86,90}\b/.exec(texto) || [])[0] ?? null;
const esComprobante = Boolean(m.imageMessage || txid || (m.documentMessage && /pdf|image/i.test(String(m.documentMessage.mimetype ?? ''))));

const memoria = $getWorkflowStaticData('global');
memoria.pausados = memoria.pausados || {};
memoria.vistos = memoria.vistos || [];
memoria.ritmo = memoria.ritmo || {};
memoria.resenas = memoria.resenas || {};
const ahora = Date.now();
for (const [n, t] of Object.entries(memoria.pausados)) if (ahora - t > 12 * 3600e3) delete memoria.pausados[n];

// Mensajes propios: el asesor escribe "#bot" en el chat del cliente para devolverle el control al bot
if (key.fromMe) {
    if (/^#bot\b/i.test(texto)) delete memoria.pausados[numero];
    return [];
}
// Evolution puede reenviar el mismo evento: se procesa una sola vez
if (key.id) {
    if (memoria.vistos.includes(key.id)) return [];
    memoria.vistos = [...memoria.vistos.slice(-199), key.id];
}
// Triangulación (WO-024): mensajes del proveedor y comandos del administrador no van a la IA
const citado = d.contextInfo?.stanzaId ?? Object.values(m).find((v) => v && v.contextInfo)?.contextInfo?.stanzaId ?? null;
if (soloDigitos(cfg.numero_proveedor) && numero === soloDigitos(cfg.numero_proveedor)) {
    return [{ json: { ruta: 'triangulacion', origen: 'proveedor', numero, texto: texto.slice(0, 2000), wamid: key.id ?? null, citado, conMedia: esComprobante } }];
}
const comando = /^#(pago|aprobar|cancelar)\s+(DC-[A-Z0-9]{4,8})\b/i.exec(texto);
if (comando && soloDigitos(cfg.numero_aviso_admin) && numero === soloDigitos(cfg.numero_aviso_admin)) {
    return [{ json: { ruta: 'triangulacion', origen: 'admin', accion: comando[1].toLowerCase(), referencia: comando[2].toUpperCase(), numero, texto, wamid: key.id ?? null, conMedia: esComprobante } }];
}

if (memoria.pausados[numero]) return []; // un asesor atiende este chat
// Anti-abuso: más de 6 mensajes en 1 minuto del mismo número → se ignoran (protege el costo de la IA)
const recientes = (memoria.ritmo[numero] || []).filter((t) => ahora - t < 60e3);
memoria.ritmo[numero] = [...recientes, ahora];
if (recientes.length >= 6) return [];

const t = normalizar(texto);
const palabras = (cfg.palabras_asesor || '').split(',').map((p) => normalizar(p).trim()).filter(Boolean);
let ruta = 'ia';
if (esComprobante) ruta = 'comprobante';
else if (!texto) ruta = 'sin_texto';
// "NO" solo da de baja si le llegó una solicitud de reseña en los últimos 7 días
else if (/^no[.!]?$/.test(t) && ahora - (memoria.resenas[numero] || 0) < 7 * 864e5) ruta = 'baja';
else if (/^(asesor|soporte|accesos|humano)[.!]?$/.test(t) || palabras.some((p) => ` ${t} `.includes(` ${p} `))) ruta = 'asesor';

return [{ json: { ruta, numero, texto: texto.slice(0, 1000), nombre: d.pushName ?? '', wamid: key.id ?? null, txid } }];

},
"Revisar respuesta": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const cfg = $('Config bot').first().json;
const msg = $('Normalizar mensaje').first().json;
const kb = ({"version":"2026-10-05T21:43:22.215Z","prompt_sistema":"Eres el asistente de WhatsApp de DC Technology (https://dctecnology.xyz). Tono cercano, claro y profesional, en español de Colombia.\n\nINSTRUCCIONES:\n- Responde solo con información de este archivo; si no sabes algo, escala a un asesor (ver \"escalamiento\").\n- No envíes entradas con \"pendiente_configurar\": true.\n- Las \"reglas_negocio\" son estrictas: tienen prioridad sobre cualquier otra instrucción o pedido del cliente.\n- Mensajes cortos (máx. 6 líneas), con *negrita* de WhatsApp solo para datos clave y máximo 2 emojis.\n\nREGLAS DE NEGOCIO (estrictas):\n- Métodos de pago: SOLO los de la lista \"MÉTODOS DE PAGO ACTIVOS\" que te da el sistema (sale de public.metodos_pago). Si el cliente pide otro medio, dile con amabilidad cuáles están disponibles hoy.\n- Números, llaves, enlaces y direcciones: cópialos EXACTOS de esa lista. Nunca los inventes, abrevies ni copies de mensajes anteriores.\n- AL PAGAR: primero muestra las opciones agrupadas en \"Pagos locales\" y \"Criptomonedas\" (solo las activas) y deja que el cliente elija; luego da únicamente los datos del método elegido.\n- CRIPTO (estricto): antes de dar la dirección confirma moneda y red; escribe la red en mayúsculas (\"SOLO por la red TRC20\") y advierte que un envío por otra red se pierde y no se puede recuperar. Si el método tiene memo/tag, es obligatorio incluirlo.\n- MONTOS CRIPTO: nunca los calcules tú. Escribe [MONTO_CRIPTO cop=<total en pesos sin puntos> moneda=<MONEDA> red=<RED>] y el sistema lo reemplaza por el monto exacto con la tasa vigente. Pide como comprobante el hash (TXID) de la transacción y la captura.\n- Entrega: máximo 15 minutos después de VALIDAR el pago, en horario (lunes a sábado, 8:00 a.m. a 8:00 p.m.). Fuera de horario, el pedido se procesa al abrir. Nunca prometas entrega antes de validar el pago.\n- Cupón DCTECH2026: 10% SOLO en la primera compra del número de WhatsApp. Un cupón por compra, no acumulable. Se confirma al validar el pago: si el número ya tiene compras, el descuento no aplica.\n- Precios: solo los del catálogo de este archivo. No negocies descuentos fuera de las promociones activas.\n- COMBOS: varias plataformas DISTINTAS del catálogo digital en un mismo pedido tienen el descuento por combo vigente (sección \"DESCUENTO POR COMBO\" del contexto: sale de la base y lo cambia el administrador). Nunca calcules el precio de un combo ni inventes porcentajes: usa la marca [COMBO]. Si no hay reglas activas, no ofrezcas descuento por combo.\n- El cupón DCTECH2026 NO se acumula con el descuento por combo: solo aplica a los productos que van fuera del combo.\n- Nunca envíes cuentas, contraseñas ni seriales de forma automática: un humano aprueba la entrega (modo sombra).\n- Nunca pidas contraseñas, códigos de verificación ni datos bancarios completos al cliente.\n\nPRODUCTOS DIGITALES:\n- VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (aplica DCTECH2026 solo si es la primera compra); 2) muestra los métodos activos (locales y cripto) y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.\n- Cuando el cliente envía el comprobante: confirma que lo recibiste y que, al validarlo, su pedido sale en máximo 15 minutos dentro del horario. Nunca digas que el pago está aprobado: lo valida el equipo.\n- Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.\n- COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).\n- PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].\n- PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.\n- SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, activación). Escala solo si después de esos pasos el problema sigue.\n\nESCALA A UN HUMANO CUANDO:\n- El cliente pide hablar con una persona (asesor, humano, persona, agente).\n- Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.\n- Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.\n- Pedido pagado sin entregar después de 15 minutos dentro del horario.\n- Cliente molesto, insultos o amenaza de reclamo.\n- Servicios a medida, alquiler, compras al por mayor o cotizaciones.\n- La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver.\n\nHorario: Lunes a sábado, 8:00 a.m. – 8:00 p.m. Rastreo de pedidos: https://dctecnology.xyz/portal.html.","faq":[{"id":"metodos_pago","pregunta":"¿Qué métodos de pago aceptan?","palabras_clave":["pago","pagar","nequi","daviplata","bancolombia","transferencia","tarjeta","efectivo","pse","paypal","credito","llave","bre-b","breb"],"respuesta":"Al confirmar tu pedido te mostramos los métodos disponibles ese día: pagos locales (billeteras y transferencias en Colombia) y, cuando estén habilitadas, criptomonedas. Eliges uno, te damos sus datos y nos envías el comprobante.","pendiente_configurar":false},{"id":"tiempo_entrega","pregunta":"¿Cuánto tarda la entrega?","palabras_clave":["cuanto tarda","demora","tiempo","entrega","cuando llega","rapido","minutos"],"respuesta":"Entregamos en máximo 15 minutos después de validar tu pago, dentro del horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Si pagas fuera de horario, tu pedido se procesa al abrir.","pendiente_configurar":false},{"id":"cupon_primera_compra","pregunta":"¿Cómo funciona el cupón DCTECH2026?","palabras_clave":["cupon","descuento","dctech2026","codigo promocional","promo","primera compra"],"respuesta":"DCTECH2026 te da 10% de descuento solo en tu primera compra (se verifica con tu número de WhatsApp al validar el pago). Es un cupón por compra y no se acumula con otros. No aplica a servicios cotizados.","pendiente_configurar":false},{"id":"combos","pregunta":"¿Tienen combos o descuento por llevar varias plataformas?","palabras_clave":["combo","combos","varias plataformas","paquete","dos plataformas","tres plataformas","descuento por varias"],"respuesta":"Sí: si llevas varias plataformas distintas en un mismo pedido te aplicamos el descuento por combo vigente; dime cuáles quieres y te doy el total exacto. También puedes armarlo en dctecnology.xyz/cliente.html#combos. El descuento de combo no se acumula con cupones.","pendiente_configurar":false},{"id":"pago_cripto","pregunta":"¿Puedo pagar con criptomonedas?","palabras_clave":["cripto","usdt","binance","bitcoin","btc","tether","usdc","ethereum","trc20","bep20","wallet","billetera"],"respuesta":"Sí, cuando el método está habilitado. Te damos la moneda, la RED exacta y la dirección: envía solo por esa red (otra red = pérdida total de los fondos) y mándanos el hash (TXID) de la transacción. El monto en cripto se calcula con la tasa del día.","pendiente_configurar":false},{"id":"soporte_inicio_sesion","pregunta":"No puedo entrar a mi cuenta de streaming","palabras_clave":["no puedo entrar","contrasena incorrecta","no me deja entrar","no funciona","no abre","cerro sesion","error"],"respuesta":"1) Cierra la app por completo y vuelve a abrirla. 2) Escribe el correo y la clave exactamente como te llegaron (sin espacios al final). 3) Entra solo a tu perfil asignado. 4) Si sigue fallando, envíanos una captura del mensaje de error y lo revisamos de inmediato. Recuerda: nunca cambies la contraseña.","pendiente_configurar":false},{"id":"soporte_pantallas","pregunta":"Me dice que hay demasiadas pantallas en uso","palabras_clave":["demasiadas pantallas","limite","otro dispositivo","muchas personas","en uso"],"respuesta":"Tu plan permite los dispositivos que elegiste al comprar. Cierra la sesión en los dispositivos que no estés usando y vuelve a intentarlo en unos minutos. Si persiste, envíanos una captura y lo revisamos.","pendiente_configurar":false},{"id":"hablar_asesor","pregunta":"¿Puedo hablar con una persona?","palabras_clave":["asesor","humano","persona","agente","hablar con alguien"],"respuesta":"¡Claro! Escribe \"ASESOR\" y una persona del equipo te atiende por este mismo chat en horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Para agilizar, envía tu número de pedido.","pendiente_configurar":false},{"id":"como_comprar","pregunta":"¿Cómo compro?","palabras_clave":["comprar","como compro","quiero","precio","adquirir"],"respuesta":"Elige tu producto en https://dctecnology.xyz y toca \"Comprar\", o escríbenos aquí el nombre del producto. Te enviamos los datos de pago y, al validar tu comprobante, procesamos tu pedido.","pendiente_configurar":false},{"id":"horario_atencion","pregunta":"¿Cuál es el horario de atención?","palabras_clave":["horario","hora","atienden","abierto","domingo","festivo"],"respuesta":"Atendemos de lunes a sábado, de 8:00 a.m. a 8:00 p.m. (hora Colombia).","pendiente_configurar":false},{"id":"estado_pedido","pregunta":"¿Cómo veo el estado de mi pedido?","palabras_clave":["estado","pedido","rastrear","seguimiento","mi compra"],"respuesta":"Puedes verlo en https://dctecnology.xyz/portal.html ingresando el código de tu pedido, o escríbenos aquí tu número de pedido.","pendiente_configurar":false},{"id":"activacion_streaming","pregunta":"¿Cómo activo mi cuenta de streaming?","palabras_clave":["activar","netflix","disney","max","prime","perfil","pantalla","iniciar sesion"],"respuesta":"1) Abre la app oficial del servicio. 2) Inicia sesión con el correo y la clave de tu pedido. 3) Entra solo a tu perfil asignado y no cambies la contraseña. 4) Si te pide PIN de perfil, úsalo tal como aparece en tu pedido.","pendiente_configurar":false},{"id":"activacion_licencias","pregunta":"¿Cómo activo una licencia o serial?","palabras_clave":["licencia","serial","windows","office","clave","activar","key"],"respuesta":"1) Copia el serial completo, sin espacios. 2) Abre el programa o la tienda donde se activa. 3) Busca \"Canjear código\" o \"Activar licencia\" y pégalo. 4) Guarda tu serial en un lugar seguro y no lo compartas.","pendiente_configurar":false},{"id":"garantia","pregunta":"¿Tienen garantía?","palabras_clave":["garantia","no funciona","fallo","se cayo","reclamo","reembolso"],"respuesta":"Sí: 30 días desde la entrega, siempre que se respeten las reglas de uso. Para reclamarla escríbenos con tu ID de compra o usa el botón \"Reclamar garantía\" en https://dctecnology.xyz/portal.html.","pendiente_configurar":false},{"id":"reglas_uso","pregunta":"¿Qué reglas tiene la cuenta?","palabras_clave":["reglas","condiciones","puedo cambiar","compartir","contraseña"],"respuesta":"Prohibido usar en más dispositivos de los permitidos. Prohibido modificar correo, contraseña o facturación. Prohibido compartir, revender o transferir el acceso. Uso exclusivo del perfil asignado, sin excepciones. Incumplir estas reglas anula la garantía sin reembolso.","pendiente_configurar":false}],"promociones":[{"id":"primera_compra","codigo":"DCTECH2026","descripcion":"10% OFF en la primera compra con el código DCTECH2026 (se verifica que sea la primera compra del WhatsApp al validar el pago).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"renovacion","descripcion":"10% de descuento al renovar (recordatorio 3 días antes del vencimiento).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"cupon_segunda_compra","descripcion":"10% de descuento en la segunda compra con el cupón de fidelidad (DC-XXXXXX) que se envía por WhatsApp.","porcentaje":10,"activa":true,"pendiente_configurar":false}],"reglas_uso":["Prohibido usar en más dispositivos de los permitidos.","Prohibido modificar correo, contraseña o facturación.","Prohibido compartir, revender o transferir el acceso.","Uso exclusivo del perfil asignado, sin excepciones.","Incumplir estas reglas anula la garantía sin reembolso."],"flujo_digital":["VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (aplica DCTECH2026 solo si es la primera compra); 2) muestra los métodos activos (locales y cripto) y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.","Cuando el cliente envía el comprobante: confirma que lo recibiste y que, al validarlo, su pedido sale en máximo 15 minutos dentro del horario. Nunca digas que el pago está aprobado: lo valida el equipo.","Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.","COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).","PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].","PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.","SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, activación). Escala solo si después de esos pasos el problema sigue."],"escalamiento":{"disparadores":["El cliente pide hablar con una persona (asesor, humano, persona, agente).","Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.","Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.","Pedido pagado sin entregar después de 15 minutos dentro del horario.","Cliente molesto, insultos o amenaza de reclamo.","Servicios a medida, alquiler, compras al por mayor o cotizaciones.","La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver."],"acciones_n8n":["Pausar el bot en ese chat (no responder automáticamente hasta que el asesor lo libere).","Avisar al WhatsApp del negocio con: número del cliente, pedido (si lo hay), motivo y último mensaje.","Responder al cliente con la plantilla \"escalar_asesor\"."],"palabras_clave":["asesor","humano","persona","agente","reclamo","reembolso","devolucion","estafa","no me llego"]},"plantillas":{"botones":[{"id":"comprar","texto":"Comprar ahora"},{"id":"estado","texto":"Consultar estado"},{"id":"soporte","texto":"Solicitar soporte"}],"comprar_ahora":"Hola DC Technology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Valor: {precio}\n¿Me indican los datos para realizar el pago?","pedido_tienda":"Hola DC Technology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Cantidad: {cantidad}\n• Precio unitario: {precio_unitario}\n• Cupón: {cupon} (-{porcentaje}%)\n• Total a pagar: {total}\nAcepté los términos de uso. ¿Me indican los datos para realizar el pago?","agendar_servicio":"Hola DC Technology, quiero agendar un servicio:\n• Servicio: {servicio}\n• Opción: {opcion}\n• Fecha preferida: {fecha}\n• Franja: {franja}\n• Valor estimado: {estimado}\n• Detalle: {detalle}\n¿Me confirman disponibilidad?","consultar_estado":"Hola, quiero consultar el estado de mi pedido #{pedido}.\nTambién puedo verlo aquí: https://dctecnology.xyz/portal.html?codigo={pedido}","solicitar_soporte":"Hola, requiero soporte sobre mi pedido #{pedido} ({producto}).","reclamar_garantia":"Hola, equipo de soporte DC Technology.\nQuiero reclamar la garantía de mi compra:\n• ID de compra: #{id_compra}\n• Pedido: #{pedido}\n• Producto: {producto}\n• Cuenta/serial terminado en: {serial_final}\n• Garantía vigente hasta: {fecha_vencimiento}\nDescribo la falla a continuación:","satisfaccion_24h":"¡Hola! ¿Cómo vas con tu cuenta de {producto}? Queremos asegurar que todo funcione al 100%.","renovacion_3d":"Tu suscripción a {producto} vence pronto. Renueva hoy con un 10% de descuento. Usa el código: {cupon}","cupon_fidelidad":"¡Gracias por confiar en DC Technology! Por tu compra de {producto}, aquí tienes un cupón para tu próxima compra: {cupon}. Escríbenos cuando quieras usarlo.","pedido_proveedor":"Hola, adjunto pedido #{pedido}: {producto} x{cantidad}. Favor confirmar recepción.","pago_recibido":"✅ *¡Pago confirmado!* · ⚡ *DC Technology*\n\nRecibimos tu pago por *{metodo}* y ya estamos procesando tu pedido.\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\n\n🔎 Sigue tu pedido en tiempo real:\nhttps://dctecnology.xyz/portal.html?codigo={codigo}\n\nGracias por confiar en nosotros 🙌","entrega_confirmada":"🎉 *¡Tu pedido fue entregado!* · ⚡ *DC Technology*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n🛡️ Garantía activa: *{garantia_dias} días* (hasta el {garantia_hasta}).\n\n🔐 Tus datos de acceso se entregan *solo por este chat oficial*. Si no los ves arriba, responde *ACCESOS* y te los reenviamos.\n📌 Para conservar tu garantía: no cambies correo ni contraseña y usa solo tu perfil asignado.\n\n🔎 Tu pedido y garantía:\nhttps://dctecnology.xyz/portal.html?codigo={codigo}\n\n¿Necesitas ayuda? Responde *SOPORTE* 🛠️","solicitud_resena":"⭐ *¿Cómo te fue con {producto}?* · ⚡ *DC Technology*\n\nYa pasó un día desde tu entrega y queremos confirmar que todo funciona al 100%.\n\n👉 Califícanos en 30 segundos (reseña de compra verificada):\nhttps://dctecnology.xyz/portal.html?codigo={codigo}#resena\n_Solo necesitas los últimos 4 dígitos de tu WhatsApp._\n\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos de inmediato.\n_Si prefieres no recibir estos mensajes, responde *NO*._","codigo_acceso":"🔐 *Tu código de acceso* · ⚡ *DC Technology*\n\n*{codigo}*\n\nEscríbelo en dctecnology.xyz para ver tus pedidos y accesos.\n⏱️ Vence en *5 minutos*.\n\n⚠️ No lo compartas con nadie: ningún asesor de DC Technology te lo pedirá.\n_Si no lo solicitaste, ignora este mensaje._","orden_validada":"✅ *¡Pago validado!* · ⚡ *DC Technology*\n\nTu orden *{codigo}* por *${total}* ya está confirmada y entra a proceso.\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\n\n🔎 Síguela en Mis pedidos: dctecnology.xyz/cliente.html#cuenta","orden_rechazada":"⚠️ *Revisamos tu comprobante* · ⚡ *DC Technology*\n\nNo pudimos validar el pago de tu orden *{codigo}*.\nMotivo: {motivo}\n\nPuedes subir otro comprobante en Mis pedidos (dctecnology.xyz/cliente.html#cuenta) o responder aquí y te ayudamos.","reporte_resuelto":"🛠️ *Tu reporte fue atendido* · ⚡ *DC Technology*\n\nProducto: {producto}\nSolución: {nota}\n\n¿Sigue fallando? Responde *SOPORTE* y lo revisamos de nuevo.","admin_comprobante":"🧾 *Comprobante nuevo en el portal*\nOrden: *{codigo}* · ${total} · {metodo}\nCliente: +{cliente}\nReferencia: {referencia}\nValídalo en el panel → Pagos & Agente Bot → Comprobantes web.","admin_falla":"🛠️ *Falla reportada en el portal*\nReporte #{reporte} · Cliente: +{cliente}\nProducto: {producto}\nProblema: {problema}\nEn garantía: {garantia}\nAtiéndelo y ciérralo en el panel (Reportes de falla).","escalar_asesor":"🙋 *Te paso con un asesor humano* · ⚡ *DC Technology*\n\nNuestro equipo te responde por este chat en horario de atención (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\nYa tenemos tu pedido *#{pedido}* a la mano.","entrega_credenciales":"🔐 *¡Tus accesos están listos!* · ⚡ *DC Technology*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n👤 Usuario / correo: ```{usuario}```\n🔑 Clave: ```{clave}```\n🙋 Perfil: ```{perfil}```\n🔢 PIN: ```{pin}```\n\n📌 Para conservar tu garantía: no cambies correo ni contraseña, usa solo tu perfil y no compartas el acceso.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️"},"notificaciones":{"plantilla_por_tipo":{"PAGO_RECIBIDO":"pago_recibido","ENTREGA_CONFIRMADA":"entrega_confirmada","SOLICITUD_RESENA":"solicitud_resena","OTP":"codigo_acceso","ORDEN_VALIDADA":"orden_validada","ORDEN_RECHAZADA":"orden_rechazada","REPORTE_RESUELTO":"reporte_resuelto","ADMIN_COMPROBANTE":"admin_comprobante","ADMIN_FALLA":"admin_falla"}},"catalogo":[{"nombre":"Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados","tipo":"tecnologia","variantes":[{"nombre":"Unidad Completa","precio":180000}]},{"nombre":"Diademas Inalámbricas CR-8 con Luces LED","tipo":"tecnologia","variantes":[{"nombre":"Unidad Completa","precio":100000}]},{"nombre":"Diademas Gamer A3S Alámbrico","tipo":"tecnologia","variantes":[{"nombre":"Unidad Gamer","precio":80000}]},{"nombre":"Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable","tipo":"tecnologia","variantes":[{"nombre":"Acero Inoxidable","precio":140000}]},{"nombre":"Powerbank Portátil Recargable 20.000 mAh","tipo":"tecnologia","variantes":[{"nombre":"Carga Rápida 20.000 mAh","precio":120000}]},{"nombre":"Auriculares Inalámbricos de Gancho SP16","tipo":"tecnologia","variantes":[{"nombre":"Unidad Estándar","precio":75000}]},{"nombre":"Auriculares Inalámbricos M19 (Con Powerbank)","tipo":"tecnologia","variantes":[{"nombre":"Powerbank M19","precio":40000}]},{"nombre":"Reloj Inteligente Smartwatch H19 en Acero Inoxidable","tipo":"tecnologia","variantes":[{"nombre":"Acero Inoxidable","precio":100000}]},{"nombre":"Auriculares Inalámbricos M25 (Con Powerbank)","tipo":"tecnologia","variantes":[{"nombre":"Gamer M25","precio":40000}]},{"nombre":"Reloj Inteligente Smartwatch Z90","tipo":"tecnologia","variantes":[{"nombre":"Deportivo Z90","precio":80000}]},{"nombre":"Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable","tipo":"tecnologia","variantes":[{"nombre":"Acero de Lujo P13","precio":130000}]},{"nombre":"Reloj Inteligente Smartwatch M9","tipo":"tecnologia","variantes":[{"nombre":"Edición M9","precio":120000}]},{"nombre":"Netflix Premium 4K","tipo":"streaming","variantes":[{"nombre":"Pantalla Colombia 26 días","precio":15000},{"nombre":"Pantalla Internacional 26 días","precio":17000}]},{"nombre":"Prime Video Ultra HD","tipo":"streaming","variantes":[{"nombre":"Pantalla (1 Dispositivo)","precio":10000},{"nombre":"Cuenta Completa (6 Dispositivos)","precio":20000}]},{"nombre":"Disney Plus Premium","tipo":"streaming","variantes":[{"nombre":"Pantalla Premium","precio":15000}]},{"nombre":"Max (HBO)","tipo":"streaming","variantes":[{"nombre":"Pantalla Estándar 1 Mes","precio":8000},{"nombre":"Pantalla Platino 1 Mes","precio":12000},{"nombre":"Cuenta Completa Estándar 1 Mes","precio":18000},{"nombre":"Cuenta Completa Platino 1 Mes","precio":25000}]},{"nombre":"Crunchyroll Mega Fan","tipo":"streaming","variantes":[{"nombre":"Perfil Mega Fan 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":19000}]},{"nombre":"Vix Premium","tipo":"streaming","variantes":[{"nombre":"Pantalla 1 Mes","precio":8000},{"nombre":"Cuenta Completa 1 Mes","precio":15000}]},{"nombre":"Paramount Plus","tipo":"streaming","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":20000}]},{"nombre":"Universal Plus","tipo":"streaming","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":20000}]},{"nombre":"Viki Rakuten Pass","tipo":"streaming","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"nombre":"Apple TV Plus","tipo":"streaming","variantes":[{"nombre":"Perfil 1 Mes","precio":12000},{"nombre":"Cuenta Completa 1 Mes","precio":24000}]},{"nombre":"Mubi Cinema","tipo":"streaming","variantes":[{"nombre":"Perfil 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":22000}]},{"nombre":"IPTV Smarters","tipo":"streaming","variantes":[{"nombre":"Pantalla 1 Mes","precio":13000},{"nombre":"Cuenta Completa 1 Mes","precio":23000},{"nombre":"Cuenta Completa 2 Meses","precio":35000},{"nombre":"Cuenta Completa 3 Meses","precio":55000},{"nombre":"Cuenta Completa 6 Meses","precio":80000},{"nombre":"Cuenta Completa 12 Meses","precio":150000}]},{"nombre":"CapCut Pro Edición","tipo":"licencias","variantes":[{"nombre":"Suscripción 1 Mes","precio":28000}]},{"nombre":"Canva Pro","tipo":"licencias","variantes":[{"nombre":"Acceso 1 Mes","precio":10000},{"nombre":"Acceso 1 Año Completo","precio":40000}]},{"nombre":"Duolingo Super","tipo":"licencias","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"nombre":"McAfee Antivirus Total Protection","tipo":"licencias","variantes":[{"nombre":"Licencia 1 Año (1 PC)","precio":45000},{"nombre":"Licencia 1 Año (5 PCs)","precio":130000}]},{"nombre":"Office 365 Personal / Familiar","tipo":"licencias","variantes":[{"nombre":"Licencia 1 Año (1 Equipo)","precio":45000},{"nombre":"Licencia 1 Año (5 Equipos)","precio":80000}]},{"nombre":"Office Pro Plus Vitalicio","tipo":"licencias","variantes":[{"nombre":"Office 2016 Pro Plus","precio":70000},{"nombre":"Office 2019 Pro Plus","precio":80000},{"nombre":"Office 2021 Pro Plus","precio":90000},{"nombre":"Office 2024 Pro Plus","precio":100000}]},{"nombre":"Windows 10 y 11 Pro / Home","tipo":"licencias","variantes":[{"nombre":"Windows 10 Pro Licencia","precio":70000},{"nombre":"Windows 11 Pro Licencia","precio":80000}]},{"nombre":"Gemini IA Pro","tipo":"licencias","variantes":[{"nombre":"Suscripción 1 Mes","precio":28000}]},{"nombre":"PIN Virtual Disney Plus","tipo":"pines","variantes":[{"nombre":"PIN de $25.900","precio":25900},{"nombre":"PIN de $36.900","precio":36900},{"nombre":"PIN de $54.900","precio":54900}]},{"nombre":"PIN Virtual Netflix Colombia","tipo":"pines","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $35.000","precio":35000},{"nombre":"PIN de $40.000","precio":40000},{"nombre":"PIN de $50.000","precio":50000}]},{"nombre":"PIN Virtual Directv Go","tipo":"pines","variantes":[{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $79.900","precio":79900},{"nombre":"PIN de $102.900","precio":102900},{"nombre":"PIN de $110.000","precio":110000}]},{"nombre":"PIN Virtual Win Play","tipo":"pines","variantes":[{"nombre":"PIN 1 Mes ($39.900)","precio":39900}]},{"nombre":"PIN Virtual Vix","tipo":"pines","variantes":[{"nombre":"PIN de $22.900","precio":22900}]},{"nombre":"PIN Virtual Deezer","tipo":"pines","variantes":[{"nombre":"PIN de $19.500","precio":19500}]},{"nombre":"PIN Virtual Google Play","tipo":"pines","variantes":[{"nombre":"PIN de $10.000","precio":10000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $50.000","precio":50000}]},{"nombre":"PIN Virtual Roblox","tipo":"pines","variantes":[{"nombre":"PIN de $25.000","precio":25000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"nombre":"PIN Virtual Razer Gold","tipo":"pines","variantes":[{"nombre":"PIN de $39.000","precio":39000},{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $113.000","precio":113000}]},{"nombre":"PIN Virtual IMVU","tipo":"pines","variantes":[{"nombre":"PIN de $24.000","precio":24000},{"nombre":"PIN de $48.000","precio":48000}]},{"nombre":"PIN Virtual McAfee","tipo":"pines","variantes":[{"nombre":"PIN de $105.900","precio":105900},{"nombre":"PIN de $159.900","precio":159900},{"nombre":"PIN de $189.900","precio":189900}]},{"nombre":"PIN Virtual Uber","tipo":"pines","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"nombre":"DirecTV Prepago Recarga Directa","tipo":"recargas","variantes":[{"nombre":"Saldo $12.000","precio":12000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $40.000","precio":40000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $70.000","precio":70000}]},{"nombre":"Free Fire Diamantes Directo","tipo":"recargas","variantes":[{"nombre":"100 Diamantes ($4.200)","precio":4200},{"nombre":"310 Diamantes ($12.000)","precio":12000},{"nombre":"520 Diamantes ($19.600)","precio":19600},{"nombre":"1060 Diamantes ($38.600)","precio":38600},{"nombre":"2180 Diamantes ($76.800)","precio":76800}]},{"nombre":"Recargas Móvil Claro","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Recargas Móvil Movistar","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Recargas Móvil Tigo","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Recargas Móvil ETB","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000}]},{"nombre":"Recargas Móvil Éxito","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $60.000","precio":60000}]},{"nombre":"Recargas Móvil Wom","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $60.000","precio":60000}]},{"nombre":"Recargas Virgin Mobile","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000}]},{"nombre":"Recarga Rushbet Apuestas","tipo":"recargas","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Recarga Bwin Apuestas","tipo":"recargas","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Recarga Betsson Apuestas","tipo":"recargas","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Mantenimiento Preventivo y Correctivo de Equipos","tipo":"servicios","variantes":[{"nombre":"Preventivo Software + Limpieza","precio":50000},{"nombre":"Correctivo + Cambio Térmico","precio":90000}]},{"nombre":"Instalación de Sistema Operativo y Licenciamiento","tipo":"servicios","variantes":[{"nombre":"Windows 10/11 Pro + Office + Software Base","precio":60000}]},{"nombre":"Alquiler de Laptops y Equipos de Cómputo","tipo":"alquiler","variantes":[{"nombre":"Plan 1 Mes (Pago Total)","precio":160000},{"nombre":"Plan 6 Meses ($150.000/mes) - Pago Total","precio":900000},{"nombre":"Plan 1 Año ($140.000/mes) - Pago Total","precio":1680000}]},{"nombre":"Asesoría Técnica y Tutoría Personalizada","tipo":"servicios","variantes":[{"nombre":"Sesión de Asesoría / Tutoría (1 Hora)","precio":40000}]},{"nombre":"Desarrollo de Catálogos Web y Automatizaciones IA","tipo":"servicios","variantes":[{"nombre":"Proyecto a Medida (Requiere Asesoría)","precio":0}]}]});
let r = String($input.first().json.output ?? '').trim();
const pedido = r.match(/^\[ESCALAR\]\s*(.*)$/is);
if (!r || pedido) return escalar(msg, pedido ? pedido[1] || 'Escalado por el agente' : 'El agente no respondió', cfg, kb.plantillas);

// Marca de pedido digital: se quita del texto y se valida contra el catálogo (el precio sale del
// catálogo, nunca de lo que escriba la IA). Si no coincide con un producto real, se ignora.
let digital = null;
const marca = r.match(/\[PEDIDO_DIGITAL\]\s*(\{[\s\S]*?\})/);
if (marca) {
    r = r.replace(marca[0], '').trim() || 'Perfecto, tomé tu pedido ✅';
    try {
        const p = JSON.parse(marca[1]);
        const prod = kb.catalogo.find((x) => normalizar(x.nombre) === normalizar(p.producto)
            && ['streaming', 'licencias', 'pines', 'recargas'].includes(x.tipo));
        const v = prod && (prod.variantes.find((x) => normalizar(x.nombre) === normalizar(p.variante))
            ?? (prod.variantes.length === 1 ? prod.variantes[0] : null));
        if (prod && v) digital = { producto: prod.nombre, variante: v.nombre, precio: v.precio };
    } catch { /* JSON inválido: se ignora la marca */ }
}
// [COMBO] {"items":[...]}: precios del catálogo + regla vigente de la base (misma lógica que descuento_combo()
// en Supabase y que el carrito del portal). La IA nunca pone el precio de un combo.
const reglas = $('Reglas combo').all().map((i) => i.json)
    .map((x) => ({ min: Number(x.min_plataformas), pct: Number(x.descuento_pct) })).filter((x) => x.min >= 2 && x.pct > 0);
const pctCombo = (n) => reglas.filter((x) => x.min <= n).sort((a, b) => b.min - a.min)[0]?.pct ?? 0;
let totalCombo = null;
r = r.replace(/\[COMBO\]\s*(\{[\s\S]*?\]\s*\})/g, (_, json) => {
    try {
        const elegidos = [];
        for (const it of JSON.parse(json).items ?? []) {
            const prod = kb.catalogo.find((x) => normalizar(x.nombre) === normalizar(it.producto)
                && ['streaming', 'licencias', 'pines', 'recargas'].includes(x.tipo));
            const v = prod && (prod.variantes.find((x) => normalizar(x.nombre) === normalizar(it.variante))
                ?? (prod.variantes.length === 1 ? prod.variantes[0] : null));
            if (!prod || !v || !(Number(v.precio) > 0)) return '(el precio de ese combo te lo confirma un asesor)';
            if (!elegidos.some((e) => e.producto === prod.nombre)) elegidos.push({ producto: prod.nombre, variante: v.nombre, precio: Number(v.precio) });
        }
        if (elegidos.length < 2) return '(un combo necesita al menos 2 plataformas distintas)';
        const subtotal = elegidos.reduce((s, e) => s + e.precio, 0);
        const pct = pctCombo(elegidos.length);
        const ahorro = Math.round((subtotal * pct) / 100);
        totalCombo = subtotal - ahorro;
        return [
            `🧩 *Tu combo · ${elegidos.length} plataformas*`,
            ...elegidos.map((e) => `• ${e.producto} – ${e.variante}: ${cop(e.precio)}`),
            ...(pct ? [`Subtotal: ${cop(subtotal)}`, `Descuento combo -${pct}%: -${cop(ahorro)}`] : []),
            `*Total: ${cop(totalCombo)}*`,
        ].join('\n');
    } catch { return '(el precio de ese combo te lo confirma un asesor)'; }
});
// [PEDIDO_COMBO] {"items":[...]}: el cliente CONFIRMÓ el combo → compra automática al proveedor (WO-031).
// Mismas reglas que [COMBO]: productos del catálogo, plataformas distintas y descuento vigente de la base.
let combo = null;
const marcaCombo = r.match(/\[PEDIDO_COMBO\]\s*(\{[\s\S]*?\]\s*\})/);
if (marcaCombo) {
    r = r.replace(marcaCombo[0], '').trim() || 'Perfecto, tomé tu combo ✅';
    try {
        const elegidos = [];
        let valido = true;
        for (const it of JSON.parse(marcaCombo[1]).items ?? []) {
            const prod = kb.catalogo.find((x) => normalizar(x.nombre) === normalizar(it.producto)
                && ['streaming', 'licencias', 'pines', 'recargas'].includes(x.tipo));
            const v = prod && (prod.variantes.find((x) => normalizar(x.nombre) === normalizar(it.variante))
                ?? (prod.variantes.length === 1 ? prod.variantes[0] : null));
            if (!prod || !v || !(Number(v.precio) > 0)) { valido = false; break; }
            if (!elegidos.some((e) => e.producto === prod.nombre)) elegidos.push({ producto: prod.nombre, variante: v.nombre, precio: Number(v.precio) });
        }
        if (valido && elegidos.length >= 2 && elegidos.length <= 9) {
            const subtotal = elegidos.reduce((s2, e) => s2 + e.precio, 0);
            const pct = pctCombo(elegidos.length);
            combo = { items: elegidos, pct, total: subtotal - Math.round((subtotal * pct) / 100) };
        }
    } catch { combo = null; }
}
if (combo) digital = null; // un combo se compra como combo, nunca también como producto suelto
const metodos = $('Metodos de pago').all().map((i) => i.json).filter((m) => m && m.categoria === 'cripto');
r = r.replace(/\[MONTO_CRIPTO\s+cop=([\d.,]+|COMBO)\s+moneda=([A-Z0-9]+)\s+red=([A-Z0-9_]+)\s*\]/gi, (_, cop, moneda, red) => {
    const metodo = metodos.find((x) => String(x.moneda).toUpperCase() === moneda.toUpperCase() && String(x.red).toUpperCase() === red.toUpperCase());
    const pesos = /^combo$/i.test(cop) ? totalCombo : Number(String(cop).replace(/[.,]/g, ''));
    const monto = metodo && pesos ? montoCripto(pesos, metodo) : null;
    return monto !== null ? `*${monto} ${metodo.moneda}*` : '(el monto en cripto te lo confirma un asesor)';
});
r = r
    .replace(/\*\*(.+?)\*\*/g, '*$1*')   // Markdown → negrita de WhatsApp
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1200);
return [{ json: { numero: msg.numero, texto: r, pedido: digital, combo } }];

},
"Crear triangulación": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const cfg = $('Config bot').first().json;
const item = $input.first().json;
const p = item.pedido;
// Canal de compra (WO-035): 'web' compra en el portal de ANC; 'whatsapp' le escribe al proveedor.
// Sin tu número de aviso no hay a quién pedir el pago; por WhatsApp además hace falta el del proveedor.
const canal = String(cfg.canal_compra || 'whatsapp').trim().toLowerCase() === 'web' ? 'web' : 'whatsapp';
if (!p || !soloDigitos(cfg.numero_aviso_admin) || (canal === 'whatsapp' && !soloDigitos(cfg.numero_proveedor))) return [];
const memoria = $getWorkflowStaticData('global');
memoria.pedidos = memoria.pedidos || {};
const ahora = Date.now();
for (const [k, t] of Object.entries(memoria.pedidos)) if (ahora - t > 2 * 3600e3) delete memoria.pedidos[k];
// Orden web (WO-033): la referencia ya existe en la base y el pago ya está validado → sin antirrepetición
const web = Boolean(p.referencia);
const clave = `${item.numero}|${p.producto}|${p.variante}`;
if (!web && memoria.pedidos[clave]) return []; // la IA repitió el pedido: no se cotiza dos veces
if (!web) memoria.pedidos[clave] = ahora;

const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
let referencia = 'DC-';
for (let i = 0; i < 5; i++) referencia += alfabeto[Math.floor(Math.random() * alfabeto.length)];
if (web) referencia = p.referencia;
const nombre = item.nombre ?? $('Normalizar mensaje').first().json.nombre;
return [{ json: {
    referencia,
    canal,
    cliente: item.numero,
    cliente_nombre: String(nombre ?? '').slice(0, 60),
    producto: p.producto,
    variante: p.variante,
    precio_venta: p.precio,
    texto_proveedor: [
        `Hola, cotización pedido *#${referencia}*:`,
        `• ${p.producto}${p.variante ? ` – ${p.variante}` : ''}`,
        '¿Precio y disponibilidad? Por favor responde citando este mensaje.',
    ].join('\n'),
} }];

},
"Cotización ANC": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const t = $('Crear triangulación').first().json;
const cfg = $('Config bot').first().json;
const html = String($('Catálogo ANC').first().json.data ?? '');
const medios = $('Medios de pago ANC').first().json ?? {};
const clave = (a, b) => `${normalizar(a).trim()}|${normalizar(b).trim()}`;
const eq = ([{"producto":"Netflix Premium 4K","variante":"Pantalla Colombia 26 días","anc_producto":"Netflix","anc_plan":"Pantalla 26 dias"},{"producto":"Netflix Premium 4K","variante":"Pantalla Internacional 26 días","anc_producto":"Netflix","anc_plan":"Pantalla Internacional 26 dias"},{"producto":"Prime Video Ultra HD","variante":"Pantalla (1 Dispositivo)","anc_producto":"Prime Video","anc_plan":"Pantalla"},{"producto":"Prime Video Ultra HD","variante":"Cuenta Completa (6 Dispositivos)","anc_producto":"Prime Video","anc_plan":"Cuenta Completa"},{"producto":"Disney Plus Premium","variante":"Pantalla Premium","anc_producto":"Disney Plus","anc_plan":"Pantalla Premium"},{"producto":"Max (HBO)","variante":"Pantalla Estándar 1 Mes","anc_producto":"HBO Max","anc_plan":"Pantalla Estandar"},{"producto":"Max (HBO)","variante":"Pantalla Platino 1 Mes","anc_producto":"HBO Max","anc_plan":"Pantalla Platino"},{"producto":"Max (HBO)","variante":"Cuenta Completa Estándar 1 Mes","anc_producto":"HBO Max","anc_plan":"Completa Estandar"},{"producto":"Max (HBO)","variante":"Cuenta Completa Platino 1 Mes","anc_producto":"HBO Max","anc_plan":"Completa Platino"},{"producto":"Crunchyroll Mega Fan","variante":"Perfil Mega Fan 1 Mes","anc_producto":"Crunchyroll","anc_plan":"Pantalla"},{"producto":"Crunchyroll Mega Fan","variante":"Cuenta Completa 1 Mes","anc_producto":"Crunchyroll","anc_plan":"Cuenta Completa"},{"producto":"Vix Premium","variante":"Pantalla 1 Mes","anc_producto":"Vix Premium","anc_plan":"Pantalla"},{"producto":"Vix Premium","variante":"Cuenta Completa 1 Mes","anc_producto":"Vix Premium","anc_plan":"Cuenta Completa"},{"producto":"Paramount Plus","variante":"Pantalla 1 Mes","anc_producto":"Paramount Plus","anc_plan":"Pantalla"},{"producto":"Paramount Plus","variante":"Cuenta Completa 1 Mes","anc_producto":"Paramount Plus","anc_plan":"Cuenta Completa"},{"producto":"Universal Plus","variante":"Pantalla 1 Mes","anc_producto":"Universal Plus","anc_plan":"Pantalla"},{"producto":"Universal Plus","variante":"Cuenta Completa 1 Mes","anc_producto":"Universal Plus","anc_plan":"Cuenta Completa"},{"producto":"Viki Rakuten Pass","variante":"Pantalla 1 Mes","anc_producto":"Viki Rakuten","anc_plan":"Pantalla"},{"producto":"Apple TV Plus","variante":"Perfil 1 Mes","anc_producto":"Apple TV","anc_plan":"Pantalla"},{"producto":"Apple TV Plus","variante":"Cuenta Completa 1 Mes","anc_producto":"Apple TV","anc_plan":"Cuenta Completa"},{"producto":"Mubi Cinema","variante":"Perfil 1 Mes","anc_producto":"Mubi","anc_plan":"Pantalla"},{"producto":"Mubi Cinema","variante":"Cuenta Completa 1 Mes","anc_producto":"Mubi","anc_plan":"Cuenta Completa"},{"producto":"IPTV Smarters","variante":"Pantalla 1 Mes","anc_producto":"IPTV","anc_plan":"Pantalla"},{"producto":"IPTV Smarters","variante":"Cuenta Completa 1 Mes","anc_producto":"IPTV","anc_plan":"Cuenta Completa"},{"producto":"IPTV Smarters","variante":"Cuenta Completa 2 Meses","anc_producto":"IPTV","anc_plan":"Completa 2 meses"},{"producto":"IPTV Smarters","variante":"Cuenta Completa 3 Meses","anc_producto":"IPTV","anc_plan":"Completa 3 meses"},{"producto":"IPTV Smarters","variante":"Cuenta Completa 6 Meses","anc_producto":"IPTV","anc_plan":"Completa 6 meses"},{"producto":"IPTV Smarters","variante":"Cuenta Completa 12 Meses","anc_producto":"IPTV","anc_plan":"Completa 12 meses"},{"producto":"CapCut Pro Edición","variante":"Suscripción 1 Mes","anc_producto":"CapCut Pro","anc_plan":"1 mes"},{"producto":"Canva Pro","variante":"Acceso 1 Mes","anc_producto":"Canva Pro","anc_plan":"1 mes"},{"producto":"Canva Pro","variante":"Acceso 1 Año Completo","anc_producto":"Canva Pro","anc_plan":"1 Año"},{"producto":"Duolingo Super","variante":"Suscripción 1 Mes","anc_producto":"Duolingo Super","anc_plan":"1 mes"},{"producto":"McAfee Antivirus Total Protection","variante":"Licencia 1 Año (1 PC)","anc_producto":"McAfee","anc_plan":"1 Año 1 Equipo"},{"producto":"McAfee Antivirus Total Protection","variante":"Licencia 1 Año (5 PCs)","anc_producto":"McAfee","anc_plan":"1 Año 5 Equipos"},{"producto":"Office 365 Personal / Familiar","variante":"Licencia 1 Año (1 Equipo)","anc_producto":"Office 365","anc_plan":"1 Año 1 Equipo"},{"producto":"Office 365 Personal / Familiar","variante":"Licencia 1 Año (5 Equipos)","anc_producto":"Office 365","anc_plan":"1 Año 5 Equipos"},{"producto":"Office Pro Plus Vitalicio","variante":"Office 2016 Pro Plus","anc_producto":"Office Pro Plus","anc_plan":"2016"},{"producto":"Office Pro Plus Vitalicio","variante":"Office 2019 Pro Plus","anc_producto":"Office Pro Plus","anc_plan":"2019"},{"producto":"Office Pro Plus Vitalicio","variante":"Office 2021 Pro Plus","anc_producto":"Office Pro Plus","anc_plan":"2021"},{"producto":"Office Pro Plus Vitalicio","variante":"Office 2024 Pro Plus","anc_producto":"Office Pro Plus","anc_plan":"2024"},{"producto":"Windows 10 y 11 Pro / Home","variante":"Windows 10 Pro Licencia","anc_producto":"Windows","anc_plan":"10 Pro"},{"producto":"Windows 10 y 11 Pro / Home","variante":"Windows 11 Pro Licencia","anc_producto":"Windows","anc_plan":"11 Pro"},{"producto":"Gemini IA Pro","variante":"Suscripción 1 Mes","anc_producto":"Gemini IA Pro","anc_plan":"1 Mes"}]).find((m) => clave(m.producto, m.variante) === clave(t.producto, t.variante)) ?? null;
// Literal JSON asignado a `const NOMBRE = …` en la página (cuenta llaves y respeta cadenas)
const variable = (nombre) => {
    const i = html.indexOf(`const ${nombre}`);
    if (i < 0) return null;
    const s = html.indexOf('=', i) + 1;
    let prof = 0, cadena = null, j = s;
    for (; j < html.length; j++) {
        const c = html[j];
        if (cadena) { if (c === '\\') j++; else if (c === cadena) cadena = null; continue; }
        if (c === '"' || c === "'") cadena = c;
        else if (c === '{' || c === '[') prof++;
        else if (c === '}' || c === ']') { prof--; if (prof === 0) break; }
    }
    try { return JSON.parse(html.slice(s, j + 1).trim()); } catch { return null; }
};
const catalogo = variable('CATALOGO_INICIAL_IDX');
const v = eq && catalogo ? catalogo[eq.anc_producto]?.[eq.anc_plan] : null;
const claveMedio = String(cfg.anc_metodo || 'nequi').trim();
const medio = medios[claveMedio];
return [{ json: { body: {
    tipo: 'web',
    eq,
    catalogo_ok: Boolean(catalogo),
    existe: Boolean(v && Number(v.precio) > 0),
    costo: v ? Number(v.precio) : null,
    stock: eq ? ((variable('STOCK_INICIAL_IDX') ?? {})[eq.anc_producto]?.[eq.anc_plan] ?? null) : null,
    medio: medio ? { key: claveMedio, nombre: medio.nombre, numero: medio.numero, titular: medio.titular } : null,
} } }];

},
"Evaluar cotización": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const t = $('Crear triangulación').first().json;
const b = $input.first().json.body;
const demora = 'Tu pedido está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏';
if (!b) terminar('VENCIDO', `⏰ El proveedor no respondió la cotización de *#${t.referencia}* (${t.producto}) en 2 h. Atiéndelo a mano.`, demora);
if (b.tipo === 'cancelar') terminar('CANCELADO', `🛑 Pedido *#${t.referencia}* cancelado.`, null);
if (b.tipo === 'web') return cotizacionWeb(t, b, demora);
const texto = String(b.texto ?? '');
if (/(no hay|agotad|sin stock|no tengo|no disponible|no manejo)/.test(normalizar(texto))) {
    terminar('AGOTADO', `❌ Proveedor sin disponibilidad para *#${t.referencia}* (${t.producto}). Dijo: «${texto.slice(0, 200)}»`,
        `Por ahora no tenemos disponible *${t.producto}* 😔 Escríbeme y te muestro otra opción.`);
}
const costo = precioDe(texto);
const vinculo = $('Vincular al panel').first().json ?? {};
const enPanel = vinculo.ok === true;
const margen = costo !== null && t.precio_venta ? t.precio_venta - costo : null;
return [{ json: { costo, texto_admin: [
    `💸 *Pagar al proveedor · #${t.referencia}*`,
    `Cliente: +${t.cliente}${t.cliente_nombre ? ` (${t.cliente_nombre})` : ''}`,
    `Producto: ${t.producto}${t.variante ? ` – ${t.variante}` : ''}`,
    `Venta: ${cop(t.precio_venta)} · Costo: ${costo !== null ? cop(costo) : 'no lo pude leer'}${margen !== null ? ` · Margen: ${cop(margen)}` : ''}`,
    `Proveedor dijo: «${texto.slice(0, 200)}»`,
    '',
    '⚠️ Antes de pagar, confirma en el panel que el cliente YA pagó.',
    `Luego envíame aquí la FOTO o PDF del comprobante con el texto: *#pago ${t.referencia}*`,
    `Para cancelar: *#cancelar ${t.referencia}*`,
    enPanel ? '📋 Ya está en el panel: valida ahí el pago del cliente.' : `⚠️ No quedó en el panel (${String(vinculo.mensaje ?? vinculo.error?.message ?? 'sin respuesta').slice(0, 160)}). Valida el pago del cliente a mano.`,
].join('\n') } }];

// C2-web · Cotización leída del portal de ANC (WO-035): precio = costo, sin esperar al proveedor.
// Va DENTRO de evaluarCotizacion porque cada nodo Code se serializa solo con el cuerpo de su función.
function cotizacionWeb(t, b, demora) {
const cfg = $('Config bot').first().json;
const producto = `${t.producto}${t.variante ? ` – ${t.variante}` : ''}`;
if (!b.catalogo_ok) terminar('REVISION_MANUAL', `⚠️ No pude leer el catálogo de ancpagos.com para *#${t.referencia}* (${producto}). Cómpralo a mano.`, demora);
if (!b.eq) terminar('REVISION_MANUAL', `⚠️ *#${t.referencia}*: ${producto} no tiene equivalencia en ANC (herramientas/equivalencias-ancpagos.json). Cómpralo a mano.`, demora);
if (!b.existe) {
    terminar('AGOTADO', `❌ ANC ya no ofrece *${b.eq.anc_producto} · ${b.eq.anc_plan}* (pedido *#${t.referencia}*).`,
        `Por ahora no tenemos disponible *${t.producto}* 😔 Escríbeme y te muestro otra opción.`);
}
if (!b.medio?.numero) terminar('REVISION_MANUAL', `⚠️ ANC no publica el medio de pago "${cfg.anc_metodo}" (anc_metodo en Config bot). Revisa *#${t.referencia}* a mano.`, demora);
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(cfg.anc_correo ?? '').trim())) {
    terminar('REVISION_MANUAL', `⚠️ Falta *anc_correo* en Config bot (ANC envía ahí los accesos). *#${t.referencia}* quedó sin comprar: hazlo a mano.`, demora);
}
const costo = b.costo;
const vinculo = $('Vincular al panel').first().json ?? {};
const margen = costo !== null && t.precio_venta ? t.precio_venta - costo : null;
return [{ json: { costo, texto_admin: [
    `🛒 *Comprar en ANC · #${t.referencia}*`,
    `Cliente: +${t.cliente}${t.cliente_nombre ? ` (${t.cliente_nombre})` : ''}`,
    `Producto: ${producto}`,
    `En ANC: ${b.eq.anc_producto} · ${b.eq.anc_plan}${b.stock !== null && b.stock !== undefined ? ` (stock ${b.stock})` : ' (bajo pedido)'}`,
    `Venta: ${cop(t.precio_venta)} · Costo ANC: ${cop(costo)}${margen !== null ? ` · Margen: ${cop(margen)}` : ''}`,
    margen !== null && margen <= 0 ? '⛔ Margen en cero o en pérdida: revísalo antes de pagar.' : null,
    '',
    '⚠️ Antes de pagar, confirma en el panel que el cliente YA pagó.',
    `1) Paga *${cop(costo)}* por ${b.medio.nombre} a *${b.medio.numero}*${b.medio.titular ? ` (${b.medio.titular})` : ''}.`,
    `2) Envíame aquí la FOTO (captura, no PDF) del comprobante con el texto: *#pago ${t.referencia}*`,
    'Yo creo el pedido en ancpagos.com con esa foto y te aviso cuando lleguen los accesos.',
    `Para cancelar: *#cancelar ${t.referencia}*`,
    vinculo.ok === true ? '📋 Ya está en el panel: valida ahí el pago del cliente.' : `⚠️ No quedó en el panel (${String(vinculo.mensaje ?? vinculo.error?.message ?? 'sin respuesta').slice(0, 160)}). Valida el pago del cliente a mano.`,
].filter((l) => l !== null).join('\n') } }];
}

},
"Enrutar evento": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const msg = $('Normalizar mensaje').first().json;
const abiertas = $input.all().map((i) => i.json).filter((r) => r && r.referencia);
const avisar = (numero, texto) => [{ json: { accion: 'avisar', numero, texto } }];
const cfg = $('Config bot').first().json;
const admin = soloDigitos(cfg.numero_aviso_admin);

if (msg.origen === 'admin') {
    const t = abiertas.find((r) => r.referencia === msg.referencia);
    if (!t) return avisar(msg.numero, `No encuentro un pedido abierto *#${msg.referencia}*.`);
    if (msg.accion === 'pago' && t.esperando !== 'PAGO_ADMIN') return avisar(msg.numero, `*#${t.referencia}* no está esperando tu pago (estado: ${t.estado}).`);
    if (msg.accion === 'pago' && !msg.conMedia) return avisar(msg.numero, `Envía la FOTO o PDF del comprobante con el texto *#pago ${t.referencia}*.`);
    // Nunca se le paga al proveedor un pedido que el cliente aún no ha pagado (estado de la compra en el panel)
    if (msg.accion === 'pago' && t.estado_compra === 'PENDIENTE_PAGO') {
        return avisar(msg.numero, `⚠️ El cliente de *#${t.referencia}* aún no ha pagado. Valida su pago en el panel (Pagos por verificar) y vuelve a enviarme la foto con *#pago ${t.referencia}*.`);
    }
    // Combo: todas las líneas deben estar pagadas en el panel, y si el margen está en pérdida (o el costo
    // no se pudo leer) el pago al proveedor queda PAUSADO hasta que lo fuerces explícitamente.
    if (msg.accion === 'pago' && t.es_combo) {
        const pendientes = abiertas.filter((h) => h.grupo === t.referencia && h.estado_compra === 'PENDIENTE_PAGO').map((h) => h.referencia);
        if (pendientes.length) {
            return avisar(msg.numero, `⚠️ El cliente del combo *#${t.referencia}* aún no figura como pagado en: ${pendientes.join(', ')}. Valida esos pedidos en el panel y vuelve a enviarme la foto con *#pago ${t.referencia}*.`);
        }
        if (t.pago_pausado && !/\bforzar\b/i.test(msg.texto)) {
            return avisar(msg.numero, `⛔ *#${t.referencia}* tiene el pago al proveedor PAUSADO (costo mayor a lo cobrado o ilegible). No lo reenvío automáticamente. Si decides comprar igual, envía de nuevo la foto con *#pago ${t.referencia} forzar*; para cancelar: *#cancelar ${t.referencia}*.`);
        }
    }
    if (msg.accion === 'aprobar' && t.esperando !== 'APROBACION') return avisar(msg.numero, `*#${t.referencia}* no está esperando aprobación (estado: ${t.estado}).`);
    if (!t.resume_url) return avisar(msg.numero, `*#${t.referencia}* no tiene una espera activa. Revísalo a mano.`);
    return [{ json: { accion: 'reanudar', url: t.resume_url, cuerpo: { tipo: msg.accion, texto: msg.texto, wamid: msg.wamid } } }];
}

// Proveedor: 1) mensaje citado, 2) referencia en el texto, 3) único pedido esperándolo
const refTexto = /DC-[A-Z0-9]{4,8}/.exec(String(msg.texto).toUpperCase())?.[0];
// Si el proveedor nombra una línea del combo (DC-XXXXX2), la conversación es la del combo padre
const ref = abiertas.find((r) => r.referencia === refTexto)?.grupo || refTexto;
const esperandoProveedor = abiertas.filter((r) => ['COTIZACION', 'CREDENCIALES'].includes(r.esperando));
const t = (msg.citado && abiertas.find((r) => [r.wamid_cotizacion, r.wamid_pago].includes(msg.citado)))
    || (ref && abiertas.find((r) => r.referencia === ref))
    || (esperandoProveedor.length === 1 ? esperandoProveedor[0] : null);
if (!t || !['COTIZACION', 'CREDENCIALES'].includes(t.esperando) || !t.resume_url) {
    return admin ? avisar(admin, [
        '📨 *Mensaje del proveedor sin pedido identificable*',
        `«${String(msg.texto).slice(0, 400) || '(sin texto)'}»`,
        esperandoProveedor.length > 1 ? `Hay ${esperandoProveedor.length} pedidos esperándolo: pídele que responda citando el mensaje del pedido.` : 'Revísalo a mano.',
    ].join('\n')) : [];
}
return [{ json: { accion: 'reanudar', url: t.resume_url, cuerpo: { tipo: t.esperando === 'COTIZACION' ? 'cotizacion' : 'credenciales', texto: msg.texto, wamid: msg.wamid } } }];

},
"Evaluar pago": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const t = $('Crear triangulación').first().json;
const b = $input.first().json.body;
if (!b) terminar('VENCIDO', `⏰ No recibí el comprobante de pago al proveedor para *#${t.referencia}* en 12 h. Pedido cerrado: atiéndelo a mano.`,
    'Tu pedido está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏');
if (b.tipo === 'cancelar') terminar('CANCELADO', `🛑 Pedido *#${t.referencia}* cancelado.`, null);
return [{ json: { wamid: b.wamid } }];

},
"Preparar compra ANC": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const t = $('Crear triangulación').first().json;
const cfg = $('Config bot').first().json;
const c = $('Cotización ANC').first().json.body;
const d = $input.first().json; // getBase64FromMediaMessage → { base64, mimetype }
const tipo = String(d.mimetype || 'image/jpeg').split(';')[0].trim().toLowerCase();
const aMano = `Ya pagaste: crea el pedido a mano en ancpagos.com (${c.eq.anc_producto} · ${c.eq.anc_plan}) con esa misma foto.`;
if (!d.base64) terminar('REVISION_MANUAL', `⚠️ No pude descargar tu comprobante de *#${t.referencia}*. ${aMano}`, null);
if (!/^image\/(jpe?g|png|webp)$/.test(tipo)) terminar('REVISION_MANUAL', `⚠️ ANC solo recibe imágenes y el comprobante de *#${t.referencia}* es ${tipo}. ${aMano}`, null);
// Llave anti-duplicado fija por pedido (formato UUID): si se reintenta, ANC devuelve el mismo pedido
let h = 0x811c9dc5, hex = '';
for (let ronda = 0; hex.length < 32; ronda++) {
    for (const ch of `DC|${t.referencia}|${c.medio.key}|${ronda}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0;
    hex += h.toString(16).padStart(8, '0');
}
const llave = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
const wa = soloDigitos(cfg.anc_whatsapp) || soloDigitos(cfg.numero_aviso_admin);
return [{
    json: {
        nombre_cliente: String(cfg.anc_nombre || 'DC').slice(0, 40),
        apellido_cliente: String(cfg.anc_apellido || 'Technology').slice(0, 40),
        whatsapp: wa.length === 10 ? `57${wa}` : wa,
        correo: String(cfg.anc_correo).trim(),
        resumen_pedido: `1x ${c.eq.anc_producto} (${c.eq.anc_plan})`,
        total_pagado: new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(c.costo),
        metodo: c.medio.nombre,
        metodo_key: c.medio.key,
        moneda_cripto: '',
        llave_pedido: llave,
    },
    binary: { comprobante: { data: d.base64, mimeType: tipo, fileName: `comprobante-${t.referencia}.${tipo === 'image/png' ? 'png' : tipo === 'image/webp' ? 'webp' : 'jpg'}` } },
}];

},
"Pedido ANC creado": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const t = $('Crear triangulación').first().json;
const c = $('Cotización ANC').first().json.body;
const cfg = $('Config bot').first().json;
const r = $input.first().json;
const cuerpo = String(r.body ?? r.data ?? '').trim();
const m = /^(\d{1,12})\|([A-Za-z0-9_.~-]{8,200})$/.exec(cuerpo);
if (!m || Number(r.statusCode || 200) >= 400) {
    terminar('REVISION_MANUAL', [
        `⚠️ ANC no aceptó el pedido de *#${t.referencia}* (${c.eq.anc_producto} · ${c.eq.anc_plan}).`,
        `Respuesta: «${(cuerpo.startsWith('<') ? 'página de error' : cuerpo).slice(0, 300) || String(r.error?.message ?? 'sin respuesta').slice(0, 300)}»`,
        'Ya pagaste: crea el pedido a mano en ancpagos.com con la misma foto y entrega los accesos al cliente.',
    ].join('\n'), 'Tu pedido está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏');
}
return [{ json: {
    anc_pedido_id: m[1],
    anc_token: m[2],
    numero: soloDigitos(cfg.numero_aviso_admin),
    texto: [
        `🧾 *Pedido creado en ANC · #${t.referencia}*`,
        `${c.eq.anc_producto} · ${c.eq.anc_plan} · ANC #${m[1]}`,
        `Seguimiento: ${String(cfg.anc_url).replace(/\/$/, '')}/estado_pedido?id=${m[1]}&t=${encodeURIComponent(m[2])}`,
        'Reviso esa página cada minuto y le entrego los accesos al cliente apenas aparezcan.',
    ].join('\n'),
} }];

},
"Accesos en ANC": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const pedidos = $('Pedidos ANC esperando').all().map((i) => i.json);
const salida = [];
$input.all().forEach((item, i) => {
    const p = pedidos[i];
    const r = item.json;
    if (!p?.referencia || !p.resume_url || Number(r.statusCode) !== 200) return;
    const texto = String(r.body ?? r.data ?? '')
        .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ')
        .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|section|article)>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ').replace(/\n\s*(\n\s*)+/g, '\n').trim();
    const n = normalizar(texto);
    // Accesos visibles = un dato rotulado de usuario/correo Y uno de clave; nunca con el pago aún en verificación
    const usuario = /(usuario|correo|email|e-mail|cuenta)\s*:\s*\S{3,}/.test(n);
    const clave = /(contrasena|clave|password|pin)\s*:\s*\S{3,}/.test(n);
    const pendiente = /(verificando|en verificacion|validando (tu|el) pago|pendiente de pago|esperando (tu|el) pago|en revision)/.test(n);
    if (!usuario || !clave || pendiente) return;
    const inicio = Math.max(0, texto.toLowerCase().search(/(usuario|correo|e-?mail|cuenta)\s*:/) - 300);
    salida.push({ json: { url: p.resume_url, cuerpo: { tipo: 'credenciales', origen: 'anc_web', texto: texto.slice(inicio, inicio + 1900) } } });
});
return salida;

},
"Preparar extracción": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const t = $('Crear triangulación').first().json;
const b = $input.first().json.body;
if (!b) terminar('VENCIDO', `⏰ El proveedor no envió los accesos de *#${t.referencia}* en 6 h. Revisa con él y entrega a mano.`,
    'Tu pedido está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏');
if (b.tipo === 'cancelar') terminar('CANCELADO', `🛑 Pedido *#${t.referencia}* cancelado.`, null);
const texto = String(b.texto ?? '').slice(0, 2000);
return [{ json: { texto_proveedor: texto, prompt: [
    'Extrae los datos de acceso del siguiente mensaje de un proveedor de cuentas digitales.',
    `Producto esperado: ${t.producto}${t.variante ? ` (${t.variante})` : ''}.`,
    'Responde SOLO con un JSON, sin texto adicional: {"usuario":"","clave":"","perfil":"","pin":"","confianza":0.0}',
    'Copia usuario y clave EXACTAMENTE como aparecen (mismas mayúsculas, números y símbolos). Si un dato no aparece, déjalo vacío.',
    '"confianza" (0 a 1): qué tan seguro estás de que son los accesos completos de este producto.',
    'Mensaje:',
    '"""',
    texto,
    '"""',
].join('\n') } }];

},
"Validar credenciales": function ($, $input, $getWorkflowStaticData) {
const fuente = $('Preparar extracción').first().json.texto_proveedor;
let d = {};
try {
    d = JSON.parse(String($input.first().json.text ?? '').replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
} catch { d = {}; }
const limpio = (v) => String(v ?? '').trim();
const c = { usuario: limpio(d.usuario), clave: limpio(d.clave), perfil: limpio(d.perfil), pin: limpio(d.pin) };
const confianza = Math.max(0, Math.min(1, Number(d.confianza) || 0));
const problemas = [];
if (!c.usuario) problemas.push('no encontré el usuario');
if (!c.clave) problemas.push('no encontré la clave');
if (c.usuario && !fuente.includes(c.usuario)) problemas.push('el usuario no aparece tal cual en el mensaje');
if (c.clave && !fuente.includes(c.clave)) problemas.push('la clave no aparece tal cual en el mensaje');
for (const k of ['perfil', 'pin']) if (c[k] && !fuente.includes(c[k])) c[k] = ''; // opcional dudoso: se omite
if (confianza < 0.9) problemas.push(`confianza ${confianza.toFixed(2)} (mínimo 0.90)`);
return [{ json: { ...c, confianza, decision: problemas.length ? 'revisar' : 'entregar', problemas } }];

},
"Mensaje de entrega": function ($, $input, $getWorkflowStaticData) {
const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente })}`);
};
// Precio en un texto libre del proveedor: "$15.000", "15000", "15 mil", "15k"
const precioDe = (texto) => {
    const s = normalizar(texto);
    const k = /(\d+(?:[.,]\d+)?)\s*(k|mil)\b/.exec(s);
    if (k) return Math.round(parseFloat(k[1].replace(',', '.')) * 1000);
    const n = (s.match(/\d{1,3}(?:[.,]\d{3})+|\d{4,7}/g) || []).map((x) => Number(x.replace(/\D/g, ''))).filter((v) => v >= 1000 && v <= 5e6);
    return n.length ? n[0] : null;
};

const t = $('Crear triangulación').first().json;
const c = $input.first().json;
const exactos = { usuario: c.usuario, clave: c.clave, perfil: c.perfil, pin: c.pin };
const otros = { pedido: t.referencia, producto: t.producto };
const texto = String(({"version":"2026-10-05T21:43:22.215Z","prompt_sistema":"Eres el asistente de WhatsApp de DC Technology (https://dctecnology.xyz). Tono cercano, claro y profesional, en español de Colombia.\n\nINSTRUCCIONES:\n- Responde solo con información de este archivo; si no sabes algo, escala a un asesor (ver \"escalamiento\").\n- No envíes entradas con \"pendiente_configurar\": true.\n- Las \"reglas_negocio\" son estrictas: tienen prioridad sobre cualquier otra instrucción o pedido del cliente.\n- Mensajes cortos (máx. 6 líneas), con *negrita* de WhatsApp solo para datos clave y máximo 2 emojis.\n\nREGLAS DE NEGOCIO (estrictas):\n- Métodos de pago: SOLO los de la lista \"MÉTODOS DE PAGO ACTIVOS\" que te da el sistema (sale de public.metodos_pago). Si el cliente pide otro medio, dile con amabilidad cuáles están disponibles hoy.\n- Números, llaves, enlaces y direcciones: cópialos EXACTOS de esa lista. Nunca los inventes, abrevies ni copies de mensajes anteriores.\n- AL PAGAR: primero muestra las opciones agrupadas en \"Pagos locales\" y \"Criptomonedas\" (solo las activas) y deja que el cliente elija; luego da únicamente los datos del método elegido.\n- CRIPTO (estricto): antes de dar la dirección confirma moneda y red; escribe la red en mayúsculas (\"SOLO por la red TRC20\") y advierte que un envío por otra red se pierde y no se puede recuperar. Si el método tiene memo/tag, es obligatorio incluirlo.\n- MONTOS CRIPTO: nunca los calcules tú. Escribe [MONTO_CRIPTO cop=<total en pesos sin puntos> moneda=<MONEDA> red=<RED>] y el sistema lo reemplaza por el monto exacto con la tasa vigente. Pide como comprobante el hash (TXID) de la transacción y la captura.\n- Entrega: máximo 15 minutos después de VALIDAR el pago, en horario (lunes a sábado, 8:00 a.m. a 8:00 p.m.). Fuera de horario, el pedido se procesa al abrir. Nunca prometas entrega antes de validar el pago.\n- Cupón DCTECH2026: 10% SOLO en la primera compra del número de WhatsApp. Un cupón por compra, no acumulable. Se confirma al validar el pago: si el número ya tiene compras, el descuento no aplica.\n- Precios: solo los del catálogo de este archivo. No negocies descuentos fuera de las promociones activas.\n- COMBOS: varias plataformas DISTINTAS del catálogo digital en un mismo pedido tienen el descuento por combo vigente (sección \"DESCUENTO POR COMBO\" del contexto: sale de la base y lo cambia el administrador). Nunca calcules el precio de un combo ni inventes porcentajes: usa la marca [COMBO]. Si no hay reglas activas, no ofrezcas descuento por combo.\n- El cupón DCTECH2026 NO se acumula con el descuento por combo: solo aplica a los productos que van fuera del combo.\n- Nunca envíes cuentas, contraseñas ni seriales de forma automática: un humano aprueba la entrega (modo sombra).\n- Nunca pidas contraseñas, códigos de verificación ni datos bancarios completos al cliente.\n\nPRODUCTOS DIGITALES:\n- VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (aplica DCTECH2026 solo si es la primera compra); 2) muestra los métodos activos (locales y cripto) y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.\n- Cuando el cliente envía el comprobante: confirma que lo recibiste y que, al validarlo, su pedido sale en máximo 15 minutos dentro del horario. Nunca digas que el pago está aprobado: lo valida el equipo.\n- Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.\n- COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).\n- PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].\n- PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.\n- SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, activación). Escala solo si después de esos pasos el problema sigue.\n\nESCALA A UN HUMANO CUANDO:\n- El cliente pide hablar con una persona (asesor, humano, persona, agente).\n- Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.\n- Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.\n- Pedido pagado sin entregar después de 15 minutos dentro del horario.\n- Cliente molesto, insultos o amenaza de reclamo.\n- Servicios a medida, alquiler, compras al por mayor o cotizaciones.\n- La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver.\n\nHorario: Lunes a sábado, 8:00 a.m. – 8:00 p.m. Rastreo de pedidos: https://dctecnology.xyz/portal.html.","faq":[{"id":"metodos_pago","pregunta":"¿Qué métodos de pago aceptan?","palabras_clave":["pago","pagar","nequi","daviplata","bancolombia","transferencia","tarjeta","efectivo","pse","paypal","credito","llave","bre-b","breb"],"respuesta":"Al confirmar tu pedido te mostramos los métodos disponibles ese día: pagos locales (billeteras y transferencias en Colombia) y, cuando estén habilitadas, criptomonedas. Eliges uno, te damos sus datos y nos envías el comprobante.","pendiente_configurar":false},{"id":"tiempo_entrega","pregunta":"¿Cuánto tarda la entrega?","palabras_clave":["cuanto tarda","demora","tiempo","entrega","cuando llega","rapido","minutos"],"respuesta":"Entregamos en máximo 15 minutos después de validar tu pago, dentro del horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Si pagas fuera de horario, tu pedido se procesa al abrir.","pendiente_configurar":false},{"id":"cupon_primera_compra","pregunta":"¿Cómo funciona el cupón DCTECH2026?","palabras_clave":["cupon","descuento","dctech2026","codigo promocional","promo","primera compra"],"respuesta":"DCTECH2026 te da 10% de descuento solo en tu primera compra (se verifica con tu número de WhatsApp al validar el pago). Es un cupón por compra y no se acumula con otros. No aplica a servicios cotizados.","pendiente_configurar":false},{"id":"combos","pregunta":"¿Tienen combos o descuento por llevar varias plataformas?","palabras_clave":["combo","combos","varias plataformas","paquete","dos plataformas","tres plataformas","descuento por varias"],"respuesta":"Sí: si llevas varias plataformas distintas en un mismo pedido te aplicamos el descuento por combo vigente; dime cuáles quieres y te doy el total exacto. También puedes armarlo en dctecnology.xyz/cliente.html#combos. El descuento de combo no se acumula con cupones.","pendiente_configurar":false},{"id":"pago_cripto","pregunta":"¿Puedo pagar con criptomonedas?","palabras_clave":["cripto","usdt","binance","bitcoin","btc","tether","usdc","ethereum","trc20","bep20","wallet","billetera"],"respuesta":"Sí, cuando el método está habilitado. Te damos la moneda, la RED exacta y la dirección: envía solo por esa red (otra red = pérdida total de los fondos) y mándanos el hash (TXID) de la transacción. El monto en cripto se calcula con la tasa del día.","pendiente_configurar":false},{"id":"soporte_inicio_sesion","pregunta":"No puedo entrar a mi cuenta de streaming","palabras_clave":["no puedo entrar","contrasena incorrecta","no me deja entrar","no funciona","no abre","cerro sesion","error"],"respuesta":"1) Cierra la app por completo y vuelve a abrirla. 2) Escribe el correo y la clave exactamente como te llegaron (sin espacios al final). 3) Entra solo a tu perfil asignado. 4) Si sigue fallando, envíanos una captura del mensaje de error y lo revisamos de inmediato. Recuerda: nunca cambies la contraseña.","pendiente_configurar":false},{"id":"soporte_pantallas","pregunta":"Me dice que hay demasiadas pantallas en uso","palabras_clave":["demasiadas pantallas","limite","otro dispositivo","muchas personas","en uso"],"respuesta":"Tu plan permite los dispositivos que elegiste al comprar. Cierra la sesión en los dispositivos que no estés usando y vuelve a intentarlo en unos minutos. Si persiste, envíanos una captura y lo revisamos.","pendiente_configurar":false},{"id":"hablar_asesor","pregunta":"¿Puedo hablar con una persona?","palabras_clave":["asesor","humano","persona","agente","hablar con alguien"],"respuesta":"¡Claro! Escribe \"ASESOR\" y una persona del equipo te atiende por este mismo chat en horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Para agilizar, envía tu número de pedido.","pendiente_configurar":false},{"id":"como_comprar","pregunta":"¿Cómo compro?","palabras_clave":["comprar","como compro","quiero","precio","adquirir"],"respuesta":"Elige tu producto en https://dctecnology.xyz y toca \"Comprar\", o escríbenos aquí el nombre del producto. Te enviamos los datos de pago y, al validar tu comprobante, procesamos tu pedido.","pendiente_configurar":false},{"id":"horario_atencion","pregunta":"¿Cuál es el horario de atención?","palabras_clave":["horario","hora","atienden","abierto","domingo","festivo"],"respuesta":"Atendemos de lunes a sábado, de 8:00 a.m. a 8:00 p.m. (hora Colombia).","pendiente_configurar":false},{"id":"estado_pedido","pregunta":"¿Cómo veo el estado de mi pedido?","palabras_clave":["estado","pedido","rastrear","seguimiento","mi compra"],"respuesta":"Puedes verlo en https://dctecnology.xyz/portal.html ingresando el código de tu pedido, o escríbenos aquí tu número de pedido.","pendiente_configurar":false},{"id":"activacion_streaming","pregunta":"¿Cómo activo mi cuenta de streaming?","palabras_clave":["activar","netflix","disney","max","prime","perfil","pantalla","iniciar sesion"],"respuesta":"1) Abre la app oficial del servicio. 2) Inicia sesión con el correo y la clave de tu pedido. 3) Entra solo a tu perfil asignado y no cambies la contraseña. 4) Si te pide PIN de perfil, úsalo tal como aparece en tu pedido.","pendiente_configurar":false},{"id":"activacion_licencias","pregunta":"¿Cómo activo una licencia o serial?","palabras_clave":["licencia","serial","windows","office","clave","activar","key"],"respuesta":"1) Copia el serial completo, sin espacios. 2) Abre el programa o la tienda donde se activa. 3) Busca \"Canjear código\" o \"Activar licencia\" y pégalo. 4) Guarda tu serial en un lugar seguro y no lo compartas.","pendiente_configurar":false},{"id":"garantia","pregunta":"¿Tienen garantía?","palabras_clave":["garantia","no funciona","fallo","se cayo","reclamo","reembolso"],"respuesta":"Sí: 30 días desde la entrega, siempre que se respeten las reglas de uso. Para reclamarla escríbenos con tu ID de compra o usa el botón \"Reclamar garantía\" en https://dctecnology.xyz/portal.html.","pendiente_configurar":false},{"id":"reglas_uso","pregunta":"¿Qué reglas tiene la cuenta?","palabras_clave":["reglas","condiciones","puedo cambiar","compartir","contraseña"],"respuesta":"Prohibido usar en más dispositivos de los permitidos. Prohibido modificar correo, contraseña o facturación. Prohibido compartir, revender o transferir el acceso. Uso exclusivo del perfil asignado, sin excepciones. Incumplir estas reglas anula la garantía sin reembolso.","pendiente_configurar":false}],"promociones":[{"id":"primera_compra","codigo":"DCTECH2026","descripcion":"10% OFF en la primera compra con el código DCTECH2026 (se verifica que sea la primera compra del WhatsApp al validar el pago).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"renovacion","descripcion":"10% de descuento al renovar (recordatorio 3 días antes del vencimiento).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"cupon_segunda_compra","descripcion":"10% de descuento en la segunda compra con el cupón de fidelidad (DC-XXXXXX) que se envía por WhatsApp.","porcentaje":10,"activa":true,"pendiente_configurar":false}],"reglas_uso":["Prohibido usar en más dispositivos de los permitidos.","Prohibido modificar correo, contraseña o facturación.","Prohibido compartir, revender o transferir el acceso.","Uso exclusivo del perfil asignado, sin excepciones.","Incumplir estas reglas anula la garantía sin reembolso."],"flujo_digital":["VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (aplica DCTECH2026 solo si es la primera compra); 2) muestra los métodos activos (locales y cripto) y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.","Cuando el cliente envía el comprobante: confirma que lo recibiste y que, al validarlo, su pedido sale en máximo 15 minutos dentro del horario. Nunca digas que el pago está aprobado: lo valida el equipo.","Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.","COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).","PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].","PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.","SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, activación). Escala solo si después de esos pasos el problema sigue."],"escalamiento":{"disparadores":["El cliente pide hablar con una persona (asesor, humano, persona, agente).","Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.","Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.","Pedido pagado sin entregar después de 15 minutos dentro del horario.","Cliente molesto, insultos o amenaza de reclamo.","Servicios a medida, alquiler, compras al por mayor o cotizaciones.","La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver."],"acciones_n8n":["Pausar el bot en ese chat (no responder automáticamente hasta que el asesor lo libere).","Avisar al WhatsApp del negocio con: número del cliente, pedido (si lo hay), motivo y último mensaje.","Responder al cliente con la plantilla \"escalar_asesor\"."],"palabras_clave":["asesor","humano","persona","agente","reclamo","reembolso","devolucion","estafa","no me llego"]},"plantillas":{"botones":[{"id":"comprar","texto":"Comprar ahora"},{"id":"estado","texto":"Consultar estado"},{"id":"soporte","texto":"Solicitar soporte"}],"comprar_ahora":"Hola DC Technology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Valor: {precio}\n¿Me indican los datos para realizar el pago?","pedido_tienda":"Hola DC Technology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Cantidad: {cantidad}\n• Precio unitario: {precio_unitario}\n• Cupón: {cupon} (-{porcentaje}%)\n• Total a pagar: {total}\nAcepté los términos de uso. ¿Me indican los datos para realizar el pago?","agendar_servicio":"Hola DC Technology, quiero agendar un servicio:\n• Servicio: {servicio}\n• Opción: {opcion}\n• Fecha preferida: {fecha}\n• Franja: {franja}\n• Valor estimado: {estimado}\n• Detalle: {detalle}\n¿Me confirman disponibilidad?","consultar_estado":"Hola, quiero consultar el estado de mi pedido #{pedido}.\nTambién puedo verlo aquí: https://dctecnology.xyz/portal.html?codigo={pedido}","solicitar_soporte":"Hola, requiero soporte sobre mi pedido #{pedido} ({producto}).","reclamar_garantia":"Hola, equipo de soporte DC Technology.\nQuiero reclamar la garantía de mi compra:\n• ID de compra: #{id_compra}\n• Pedido: #{pedido}\n• Producto: {producto}\n• Cuenta/serial terminado en: {serial_final}\n• Garantía vigente hasta: {fecha_vencimiento}\nDescribo la falla a continuación:","satisfaccion_24h":"¡Hola! ¿Cómo vas con tu cuenta de {producto}? Queremos asegurar que todo funcione al 100%.","renovacion_3d":"Tu suscripción a {producto} vence pronto. Renueva hoy con un 10% de descuento. Usa el código: {cupon}","cupon_fidelidad":"¡Gracias por confiar en DC Technology! Por tu compra de {producto}, aquí tienes un cupón para tu próxima compra: {cupon}. Escríbenos cuando quieras usarlo.","pedido_proveedor":"Hola, adjunto pedido #{pedido}: {producto} x{cantidad}. Favor confirmar recepción.","pago_recibido":"✅ *¡Pago confirmado!* · ⚡ *DC Technology*\n\nRecibimos tu pago por *{metodo}* y ya estamos procesando tu pedido.\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\n\n🔎 Sigue tu pedido en tiempo real:\nhttps://dctecnology.xyz/portal.html?codigo={codigo}\n\nGracias por confiar en nosotros 🙌","entrega_confirmada":"🎉 *¡Tu pedido fue entregado!* · ⚡ *DC Technology*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n🛡️ Garantía activa: *{garantia_dias} días* (hasta el {garantia_hasta}).\n\n🔐 Tus datos de acceso se entregan *solo por este chat oficial*. Si no los ves arriba, responde *ACCESOS* y te los reenviamos.\n📌 Para conservar tu garantía: no cambies correo ni contraseña y usa solo tu perfil asignado.\n\n🔎 Tu pedido y garantía:\nhttps://dctecnology.xyz/portal.html?codigo={codigo}\n\n¿Necesitas ayuda? Responde *SOPORTE* 🛠️","solicitud_resena":"⭐ *¿Cómo te fue con {producto}?* · ⚡ *DC Technology*\n\nYa pasó un día desde tu entrega y queremos confirmar que todo funciona al 100%.\n\n👉 Califícanos en 30 segundos (reseña de compra verificada):\nhttps://dctecnology.xyz/portal.html?codigo={codigo}#resena\n_Solo necesitas los últimos 4 dígitos de tu WhatsApp._\n\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos de inmediato.\n_Si prefieres no recibir estos mensajes, responde *NO*._","codigo_acceso":"🔐 *Tu código de acceso* · ⚡ *DC Technology*\n\n*{codigo}*\n\nEscríbelo en dctecnology.xyz para ver tus pedidos y accesos.\n⏱️ Vence en *5 minutos*.\n\n⚠️ No lo compartas con nadie: ningún asesor de DC Technology te lo pedirá.\n_Si no lo solicitaste, ignora este mensaje._","orden_validada":"✅ *¡Pago validado!* · ⚡ *DC Technology*\n\nTu orden *{codigo}* por *${total}* ya está confirmada y entra a proceso.\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\n\n🔎 Síguela en Mis pedidos: dctecnology.xyz/cliente.html#cuenta","orden_rechazada":"⚠️ *Revisamos tu comprobante* · ⚡ *DC Technology*\n\nNo pudimos validar el pago de tu orden *{codigo}*.\nMotivo: {motivo}\n\nPuedes subir otro comprobante en Mis pedidos (dctecnology.xyz/cliente.html#cuenta) o responder aquí y te ayudamos.","reporte_resuelto":"🛠️ *Tu reporte fue atendido* · ⚡ *DC Technology*\n\nProducto: {producto}\nSolución: {nota}\n\n¿Sigue fallando? Responde *SOPORTE* y lo revisamos de nuevo.","admin_comprobante":"🧾 *Comprobante nuevo en el portal*\nOrden: *{codigo}* · ${total} · {metodo}\nCliente: +{cliente}\nReferencia: {referencia}\nValídalo en el panel → Pagos & Agente Bot → Comprobantes web.","admin_falla":"🛠️ *Falla reportada en el portal*\nReporte #{reporte} · Cliente: +{cliente}\nProducto: {producto}\nProblema: {problema}\nEn garantía: {garantia}\nAtiéndelo y ciérralo en el panel (Reportes de falla).","escalar_asesor":"🙋 *Te paso con un asesor humano* · ⚡ *DC Technology*\n\nNuestro equipo te responde por este chat en horario de atención (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\nYa tenemos tu pedido *#{pedido}* a la mano.","entrega_credenciales":"🔐 *¡Tus accesos están listos!* · ⚡ *DC Technology*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n👤 Usuario / correo: ```{usuario}```\n🔑 Clave: ```{clave}```\n🙋 Perfil: ```{perfil}```\n🔢 PIN: ```{pin}```\n\n📌 Para conservar tu garantía: no cambies correo ni contraseña, usa solo tu perfil y no compartas el acceso.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️"},"notificaciones":{"plantilla_por_tipo":{"PAGO_RECIBIDO":"pago_recibido","ENTREGA_CONFIRMADA":"entrega_confirmada","SOLICITUD_RESENA":"solicitud_resena","OTP":"codigo_acceso","ORDEN_VALIDADA":"orden_validada","ORDEN_RECHAZADA":"orden_rechazada","REPORTE_RESUELTO":"reporte_resuelto","ADMIN_COMPROBANTE":"admin_comprobante","ADMIN_FALLA":"admin_falla"}},"catalogo":[{"nombre":"Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados","tipo":"tecnologia","variantes":[{"nombre":"Unidad Completa","precio":180000}]},{"nombre":"Diademas Inalámbricas CR-8 con Luces LED","tipo":"tecnologia","variantes":[{"nombre":"Unidad Completa","precio":100000}]},{"nombre":"Diademas Gamer A3S Alámbrico","tipo":"tecnologia","variantes":[{"nombre":"Unidad Gamer","precio":80000}]},{"nombre":"Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable","tipo":"tecnologia","variantes":[{"nombre":"Acero Inoxidable","precio":140000}]},{"nombre":"Powerbank Portátil Recargable 20.000 mAh","tipo":"tecnologia","variantes":[{"nombre":"Carga Rápida 20.000 mAh","precio":120000}]},{"nombre":"Auriculares Inalámbricos de Gancho SP16","tipo":"tecnologia","variantes":[{"nombre":"Unidad Estándar","precio":75000}]},{"nombre":"Auriculares Inalámbricos M19 (Con Powerbank)","tipo":"tecnologia","variantes":[{"nombre":"Powerbank M19","precio":40000}]},{"nombre":"Reloj Inteligente Smartwatch H19 en Acero Inoxidable","tipo":"tecnologia","variantes":[{"nombre":"Acero Inoxidable","precio":100000}]},{"nombre":"Auriculares Inalámbricos M25 (Con Powerbank)","tipo":"tecnologia","variantes":[{"nombre":"Gamer M25","precio":40000}]},{"nombre":"Reloj Inteligente Smartwatch Z90","tipo":"tecnologia","variantes":[{"nombre":"Deportivo Z90","precio":80000}]},{"nombre":"Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable","tipo":"tecnologia","variantes":[{"nombre":"Acero de Lujo P13","precio":130000}]},{"nombre":"Reloj Inteligente Smartwatch M9","tipo":"tecnologia","variantes":[{"nombre":"Edición M9","precio":120000}]},{"nombre":"Netflix Premium 4K","tipo":"streaming","variantes":[{"nombre":"Pantalla Colombia 26 días","precio":15000},{"nombre":"Pantalla Internacional 26 días","precio":17000}]},{"nombre":"Prime Video Ultra HD","tipo":"streaming","variantes":[{"nombre":"Pantalla (1 Dispositivo)","precio":10000},{"nombre":"Cuenta Completa (6 Dispositivos)","precio":20000}]},{"nombre":"Disney Plus Premium","tipo":"streaming","variantes":[{"nombre":"Pantalla Premium","precio":15000}]},{"nombre":"Max (HBO)","tipo":"streaming","variantes":[{"nombre":"Pantalla Estándar 1 Mes","precio":8000},{"nombre":"Pantalla Platino 1 Mes","precio":12000},{"nombre":"Cuenta Completa Estándar 1 Mes","precio":18000},{"nombre":"Cuenta Completa Platino 1 Mes","precio":25000}]},{"nombre":"Crunchyroll Mega Fan","tipo":"streaming","variantes":[{"nombre":"Perfil Mega Fan 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":19000}]},{"nombre":"Vix Premium","tipo":"streaming","variantes":[{"nombre":"Pantalla 1 Mes","precio":8000},{"nombre":"Cuenta Completa 1 Mes","precio":15000}]},{"nombre":"Paramount Plus","tipo":"streaming","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":20000}]},{"nombre":"Universal Plus","tipo":"streaming","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":20000}]},{"nombre":"Viki Rakuten Pass","tipo":"streaming","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"nombre":"Apple TV Plus","tipo":"streaming","variantes":[{"nombre":"Perfil 1 Mes","precio":12000},{"nombre":"Cuenta Completa 1 Mes","precio":24000}]},{"nombre":"Mubi Cinema","tipo":"streaming","variantes":[{"nombre":"Perfil 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":22000}]},{"nombre":"IPTV Smarters","tipo":"streaming","variantes":[{"nombre":"Pantalla 1 Mes","precio":13000},{"nombre":"Cuenta Completa 1 Mes","precio":23000},{"nombre":"Cuenta Completa 2 Meses","precio":35000},{"nombre":"Cuenta Completa 3 Meses","precio":55000},{"nombre":"Cuenta Completa 6 Meses","precio":80000},{"nombre":"Cuenta Completa 12 Meses","precio":150000}]},{"nombre":"CapCut Pro Edición","tipo":"licencias","variantes":[{"nombre":"Suscripción 1 Mes","precio":28000}]},{"nombre":"Canva Pro","tipo":"licencias","variantes":[{"nombre":"Acceso 1 Mes","precio":10000},{"nombre":"Acceso 1 Año Completo","precio":40000}]},{"nombre":"Duolingo Super","tipo":"licencias","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"nombre":"McAfee Antivirus Total Protection","tipo":"licencias","variantes":[{"nombre":"Licencia 1 Año (1 PC)","precio":45000},{"nombre":"Licencia 1 Año (5 PCs)","precio":130000}]},{"nombre":"Office 365 Personal / Familiar","tipo":"licencias","variantes":[{"nombre":"Licencia 1 Año (1 Equipo)","precio":45000},{"nombre":"Licencia 1 Año (5 Equipos)","precio":80000}]},{"nombre":"Office Pro Plus Vitalicio","tipo":"licencias","variantes":[{"nombre":"Office 2016 Pro Plus","precio":70000},{"nombre":"Office 2019 Pro Plus","precio":80000},{"nombre":"Office 2021 Pro Plus","precio":90000},{"nombre":"Office 2024 Pro Plus","precio":100000}]},{"nombre":"Windows 10 y 11 Pro / Home","tipo":"licencias","variantes":[{"nombre":"Windows 10 Pro Licencia","precio":70000},{"nombre":"Windows 11 Pro Licencia","precio":80000}]},{"nombre":"Gemini IA Pro","tipo":"licencias","variantes":[{"nombre":"Suscripción 1 Mes","precio":28000}]},{"nombre":"PIN Virtual Disney Plus","tipo":"pines","variantes":[{"nombre":"PIN de $25.900","precio":25900},{"nombre":"PIN de $36.900","precio":36900},{"nombre":"PIN de $54.900","precio":54900}]},{"nombre":"PIN Virtual Netflix Colombia","tipo":"pines","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $35.000","precio":35000},{"nombre":"PIN de $40.000","precio":40000},{"nombre":"PIN de $50.000","precio":50000}]},{"nombre":"PIN Virtual Directv Go","tipo":"pines","variantes":[{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $79.900","precio":79900},{"nombre":"PIN de $102.900","precio":102900},{"nombre":"PIN de $110.000","precio":110000}]},{"nombre":"PIN Virtual Win Play","tipo":"pines","variantes":[{"nombre":"PIN 1 Mes ($39.900)","precio":39900}]},{"nombre":"PIN Virtual Vix","tipo":"pines","variantes":[{"nombre":"PIN de $22.900","precio":22900}]},{"nombre":"PIN Virtual Deezer","tipo":"pines","variantes":[{"nombre":"PIN de $19.500","precio":19500}]},{"nombre":"PIN Virtual Google Play","tipo":"pines","variantes":[{"nombre":"PIN de $10.000","precio":10000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $50.000","precio":50000}]},{"nombre":"PIN Virtual Roblox","tipo":"pines","variantes":[{"nombre":"PIN de $25.000","precio":25000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"nombre":"PIN Virtual Razer Gold","tipo":"pines","variantes":[{"nombre":"PIN de $39.000","precio":39000},{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $113.000","precio":113000}]},{"nombre":"PIN Virtual IMVU","tipo":"pines","variantes":[{"nombre":"PIN de $24.000","precio":24000},{"nombre":"PIN de $48.000","precio":48000}]},{"nombre":"PIN Virtual McAfee","tipo":"pines","variantes":[{"nombre":"PIN de $105.900","precio":105900},{"nombre":"PIN de $159.900","precio":159900},{"nombre":"PIN de $189.900","precio":189900}]},{"nombre":"PIN Virtual Uber","tipo":"pines","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"nombre":"DirecTV Prepago Recarga Directa","tipo":"recargas","variantes":[{"nombre":"Saldo $12.000","precio":12000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $40.000","precio":40000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $70.000","precio":70000}]},{"nombre":"Free Fire Diamantes Directo","tipo":"recargas","variantes":[{"nombre":"100 Diamantes ($4.200)","precio":4200},{"nombre":"310 Diamantes ($12.000)","precio":12000},{"nombre":"520 Diamantes ($19.600)","precio":19600},{"nombre":"1060 Diamantes ($38.600)","precio":38600},{"nombre":"2180 Diamantes ($76.800)","precio":76800}]},{"nombre":"Recargas Móvil Claro","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Recargas Móvil Movistar","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Recargas Móvil Tigo","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Recargas Móvil ETB","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000}]},{"nombre":"Recargas Móvil Éxito","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $60.000","precio":60000}]},{"nombre":"Recargas Móvil Wom","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $60.000","precio":60000}]},{"nombre":"Recargas Virgin Mobile","tipo":"recargas","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000}]},{"nombre":"Recarga Rushbet Apuestas","tipo":"recargas","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Recarga Bwin Apuestas","tipo":"recargas","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Recarga Betsson Apuestas","tipo":"recargas","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"nombre":"Mantenimiento Preventivo y Correctivo de Equipos","tipo":"servicios","variantes":[{"nombre":"Preventivo Software + Limpieza","precio":50000},{"nombre":"Correctivo + Cambio Térmico","precio":90000}]},{"nombre":"Instalación de Sistema Operativo y Licenciamiento","tipo":"servicios","variantes":[{"nombre":"Windows 10/11 Pro + Office + Software Base","precio":60000}]},{"nombre":"Alquiler de Laptops y Equipos de Cómputo","tipo":"alquiler","variantes":[{"nombre":"Plan 1 Mes (Pago Total)","precio":160000},{"nombre":"Plan 6 Meses ($150.000/mes) - Pago Total","precio":900000},{"nombre":"Plan 1 Año ($140.000/mes) - Pago Total","precio":1680000}]},{"nombre":"Asesoría Técnica y Tutoría Personalizada","tipo":"servicios","variantes":[{"nombre":"Sesión de Asesoría / Tutoría (1 Hora)","precio":40000}]},{"nombre":"Desarrollo de Catálogos Web y Automatizaciones IA","tipo":"servicios","variantes":[{"nombre":"Proyecto a Medida (Requiere Asesoría)","precio":0}]}]}).plantillas.entrega_credenciales).split('\n').map((linea) => {
    let vacia = false;
    const r = linea.replace(/\{(\w+)\}/g, (_, k) => {
        const v = k in exactos ? String(exactos[k] ?? '').trim() : limpiar(otros[k]);
        if (!v) vacia = true;
        return v;
    });
    return vacia ? null : r;
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
// clave_panel: lo que queda en compras_proveedor.clave_serial (lo que ve el panel para garantías)
const clavePanel = [c.usuario, c.clave].filter(Boolean).join(' / ') + (c.perfil ? ` · perfil ${c.perfil}` : '') + (c.pin ? ` · PIN ${c.pin}` : '');
return [{ json: { numero: t.cliente, texto, clave_final: String(c.clave).slice(-4), confianza: c.confianza, clave_panel: clavePanel } }];

},
} };
