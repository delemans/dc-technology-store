// n8n/simulador-nodos.js — GENERADO por n8n/generar_flujo_n8n.js (no editar a mano).
// Código real de los nodos del bot para el simulador del panel (Prueba del sistema). No envía nada.
window.SimuladorFlujo = { version: "2026-11-24T16:33:26.102Z", config: {"supabase_url":"https://vyqcizwfmjlflncdwzve.supabase.co","evolution_url":"https://TU-EVOLUTION-API","evolution_instancia":"TU-INSTANCIA","url_conocimiento":"https://dctecnology.xyz/bot-conocimiento.json","numero_aviso_admin":"","numero_proveedor":"","webhook_publico":"http://localhost:5678/webhook/dc-whatsapp","canal_compra":"manual","anc_url":"https://ancpagos.com","anc_metodo":"nequi","anc_correo":"","anc_nombre":"DC","anc_apellido":"Tecnology","anc_whatsapp":"","palabras_asesor":"asesor,humano,persona,agente,reclamo,reembolso,devolucion,estafa,no me llego","etiquetas_silencio":"BAENAMORA","anc_margen":"0","bot_responde":"si","entrega_cuentas":"manual","consultar_proveedor":"si","leer_medios":"no","horas_pausa_humano":"12","enlace_resena_google":""}, nodos: {
"Normalizar mensaje": function ($, $input, $getWorkflowStaticData) {

const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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
const tipoEvento = String(b.event ?? '').toLowerCase().replace(/_/g, '.');
// Etiquetas de WhatsApp Business (Evolution: labels.association / labels.edit; herramientas/sincronizar-etiquetas.mjs:
// labels.sync con las actuales). Se recuerdan por chat para no responder en las etiquetas de "etiquetas_silencio".
if (/^labels\.(association|edit|sync)$/.test(tipoEvento)) {
    const mem = $getWorkflowStaticData('global');
    const et = mem.etiquetas = mem.etiquetas ?? { chats: {}, nombres: {} };
    const dato = Array.isArray(b.data) ? b.data[0] : b.data ?? {};
    const chatDe = (j) => String(j ?? '').split('@')[0].split(':')[0];
    if (tipoEvento === 'labels.sync') {
        et.chats = {};
        for (const [j, ids] of Object.entries(dato.chats ?? {})) if (chatDe(j) && (ids ?? []).length) et.chats[chatDe(j)] = ids.map(String);
        et.nombres = Object.fromEntries(Object.entries(dato.nombres ?? {}).map(([id, n]) => [String(id), String(n)]));
        et.sincronizadas = new Date().toISOString();
    } else if (tipoEvento === 'labels.edit') {
        if (dato.id) { if (dato.deleted) delete et.nombres[String(dato.id)]; else et.nombres[String(dato.id)] = String(dato.name ?? ''); }
    } else {
        const c = chatDe(dato.chatId), id = String(dato.labelId ?? '');
        if (c && id) {
            const actuales = new Set(et.chats[c] ?? []);
            if (dato.type === 'remove') actuales.delete(id); else actuales.add(id);
            if (actuales.size) et.chats[c] = [...actuales]; else delete et.chats[c];
        }
    }
    return [];
}
if (tipoEvento !== 'messages.upsert') return [];
const d = Array.isArray(b.data) ? b.data[0] : b.data;
const key = d?.key ?? {};
// WhatsApp ya identifica muchos chats con un ID oculto (…@lid): el número real llega aparte
// (remoteJidAlt en Evolution 2.3+, senderPn en versiones anteriores). Sin número real no se puede responder.
const original = String(key.remoteJid ?? '');
const alterno = String(key.remoteJidAlt ?? key.senderPn ?? d?.senderPn ?? '');
const jid = original.endsWith('@lid') && alterno.endsWith('@s.whatsapp.net') ? alterno : original;
if (!jid.endsWith('@s.whatsapp.net')) return []; // grupos, estados, canales y @lid sin número: el bot no responde
const numero = jid.split('@')[0];
// Los mensajes temporales y los de "ver una vez" llegan envueltos
const crudo = d.message ?? {};
const m = crudo.ephemeralMessage?.message ?? crudo.viewOnceMessageV2?.message ?? crudo.viewOnceMessage?.message ?? crudo.documentWithCaptionMessage?.message ?? crudo;
let texto = String(m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.documentMessage?.caption ?? m.videoMessage?.caption ?? '').trim();
// Audio ya transcrito o imagen ya descrita por "Leer medio (IA)" (solo si es este mismo mensaje)
let medio = {};
for (const fuente of ['Transcripción', 'Leer medio (IA)']) {
    try { const j = $(fuente).first().json ?? {}; if (j.wamid && j.wamid === key.id) { medio = j; break; } } catch { /* no corrió */ }
}
if (!medio || medio.wamid !== key.id) medio = {};
const deAudio = Boolean(m.audioMessage && !texto && medio.transcripcion);
if (deAudio) texto = String(medio.transcripcion).trim();
// Hash de transacción cripto (TXID): 64 hex (BTC, ETH/BEP20/TRC20…) o firma de Solana (base58, ~88)
const txid = (/\b(?:0x)?[0-9a-fA-F]{64}\b/.exec(texto) || /\b[1-9A-HJ-NP-Za-km-z]{86,90}\b/.exec(texto) || [])[0] ?? null;
// Foto o PDF: puede ser un comprobante (Nequi / Daviplata envían captura o PDF), una captura de un problema o algo personal
const esImagen = Boolean(m.imageMessage);
const esPdf = Boolean(m.documentMessage && /pdf|image/i.test(String(m.documentMessage.mimetype ?? '')));

const memoria = $getWorkflowStaticData('global');
for (const k of ['pausados', 'ritmo', 'resenas', 'menu', 'conversacion', 'esperandoPago', 'soporte', 'ia']) memoria[k] = memoria[k] || {};
memoria.vistos = memoria.vistos || [];
const ahora = Date.now();
for (const [n, t] of Object.entries(memoria.pausados)) if (ahora - t > 12 * 3600e3) delete memoria.pausados[n];
// Lo que el bot recuerda por número (menú, conversación, pago en curso, soporte) se borra a los 7 días
for (const k of ['menu', 'conversacion', 'esperandoPago', 'soporte', 'ia']) {
    for (const [n, v] of Object.entries(memoria[k])) if (ahora - (typeof v === 'number' ? v : v?.t ?? 0) > 7 * 864e5) delete memoria[k][n];
}
for (const k of ['ritmo', 'ritmoIa']) for (const [n, v] of Object.entries(memoria[k] || {})) if (!(v || []).some((t) => ahora - t < 60e3)) delete memoria[k][n];

// Mensajes propios: el asesor escribe "#bot" en el chat del cliente para devolverle el control al bot
if (key.fromMe) {
    if (/^#bot\b/i.test(texto)) delete memoria.pausados[numero];
    return [];
}
// Reacciones, stickers, mensajes borrados o editados y votos de encuestas: no se contestan
if (m.reactionMessage || m.stickerMessage || m.protocolMessage || m.editedMessage || m.pollUpdateMessage || m.keepInChatMessage || m.pinInChatMessage) return [];
// Evolution puede reenviar el mismo evento: se procesa una sola vez
if (key.id) {
    if (memoria.vistos.includes(key.id)) return [];
    memoria.vistos = [...memoria.vistos.slice(-199), key.id];
}
// Mensajes atrasados (llegan de golpe cuando WhatsApp vuelve a conectarse): no se contestan horas o días después.
// Se guardan y "Revisar salud" te manda el resumen para que les escribas tú.
const enviado = Number(d.messageTimestamp ?? 0);
if (enviado > 0 && ahora / 1000 - enviado > 20 * 60) {
    memoria.atrasados = (memoria.atrasados ?? []).slice(-199);
    memoria.atrasados.push({ numero, nombre: String(d.pushName ?? '').slice(0, 40), texto: (texto || (esImagen ? '(foto)' : esPdf ? '(PDF)' : '(otro)')).slice(0, 120), t: enviado * 1000 });
    return [];
}
// Triangulación (WO-024): mensajes del proveedor y comandos del administrador no van a la IA
const citado = d.contextInfo?.stanzaId ?? Object.values(m).find((v) => v && v.contextInfo)?.contextInfo?.stanzaId ?? null;
const proveedores = String(cfg.numero_proveedor ?? '').split(/[,;\s]+/).map((x) => soloDigitos(x)).filter(Boolean);
if (proveedores.includes(numero)) {
    return [{ json: { ruta: 'triangulacion', origen: 'proveedor', numero, texto: texto.slice(0, 2000), wamid: key.id ?? null, citado, conMedia: esImagen || esPdf || Boolean(txid) } }];
}
// #stock (WO-043): cargar códigos de pines comprados por lote o ver el stock. Solo desde tu número de aviso
if (/^#stock\b/i.test(texto) && soloDigitos(cfg.numero_aviso_admin) && numero === soloDigitos(cfg.numero_aviso_admin)) {
    return [{ json: { ruta: 'triangulacion', origen: 'admin', accion: 'stock', referencia: null, numero, texto: texto.slice(0, 4000), wamid: key.id ?? null } }];
}
// #pago/#aprobar/#cancelar (compra automática) · #ok / #no (pago del cliente) · #entregar (accesos de ANC)
const comando = /^#(pago|aprobar|cancelar|ok|no|entregar|guia|guía)\s+(DC-[A-Z0-9]{4,8})\b/i.exec(texto);
if (comando && soloDigitos(cfg.numero_aviso_admin) && numero === soloDigitos(cfg.numero_aviso_admin)) {
    return [{ json: { ruta: 'triangulacion', origen: 'admin', accion: comando[1].toLowerCase(), referencia: comando[2].toUpperCase(), numero, texto, wamid: key.id ?? null, conMedia: esImagen || esPdf || Boolean(txid) } }];
}

// Interruptor general (Config bot → bot_responde = no): el bot no le contesta a nadie; tus comandos y el proveedor siguen
if (String(cfg.bot_responde ?? 'si').trim().toLowerCase() === 'no') return [];
// Chats con una etiqueta de silencio (por defecto BAENAMORA): el bot no responde nada, los atiendes tú
const etiquetas = memoria.etiquetas ?? { chats: {}, nombres: {} };
const silencio = String(cfg.etiquetas_silencio ?? 'BAENAMORA').split(',').map((x) => normalizar(x).trim()).filter(Boolean);
const delChat = [...new Set([...(etiquetas.chats[numero] ?? []), ...(etiquetas.chats[original.split('@')[0]] ?? [])])];
if (delChat.some((id) => silencio.includes(normalizar(etiquetas.nombres[id] ?? '').trim()))) return [];
if (memoria.pausados[numero]) return []; // un asesor (o tú) atiende este chat
// Anti-abuso: una ráfaga de más de 15 mensajes en 1 minuto del mismo número se ignora (el límite de la IA va al final)
const recientes = (memoria.ritmo[numero] || []).filter((t) => ahora - t < 60e3);
memoria.ritmo[numero] = [...recientes, ahora];
if (recientes.length >= 15) return [];

// Sin tildes ni signos, y los números de teclado (1️⃣ 🔟) como dígitos: "1.", "la 1" y "1️⃣" → "1"
const limpio = normalizar(texto).replace(/[️⃣]/g, '').replace(/🔟/g, '10').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const hace = (mapa, horas) => ahora - (typeof mapa[numero] === 'number' ? mapa[numero] : 0) < horas * 3600e3;
const estado = memoria.menu[numero];
const menuVivo = Boolean(estado && estado.activo && ahora - estado.t < 30 * 60e3);
const conversando = hace(memoria.conversacion, 72); // el bot habló de compras con este número en los últimos 3 días
const salida = { ruta: 'ia', numero, texto: texto.slice(0, 1000), nombre: d.pushName ?? '', wamid: key.id ?? null, txid, jids: [...new Set([jid, original])] };

if (txid) salida.ruta = 'comprobante';
else if (esImagen || esPdf) {
    // ¿Comprobante, captura de un problema o algo personal? Lo dice el texto que la acompaña o la conversación
    if (/\b(pago|pague|pagado|pagando|comprobante|transferencia|transferi|consignacion|consigne|nequi|daviplata|breb|llave|abono|abone|recibo)\b/.test(limpio) || hace(memoria.esperandoPago, 48)) salida.ruta = 'comprobante';
    else if (/\b(error|falla|fallo|no funciona|no me deja|no puedo|no abre|me sale|me aparece|bloqueo|bloqueado|ayuda)\b/.test(limpio) || hace(memoria.soporte, 2)) {
        // Con la imagen leída, la IA intenta resolverlo con la guía de soporte (y escala si no puede); sin lectura → asesor
        if (medio.descripcion && !/^comprobante de pago/i.test(medio.descripcion)) Object.assign(salida, { ruta: 'ia', texto: `${texto ? `${texto.slice(0, 600)}\n` : ''}[Captura enviada por el cliente. Se ve: ${medio.descripcion}]` });
        else Object.assign(salida, { ruta: 'asesor', motivo: 'Envió una captura de un problema' });
    }
    else if (conversando) salida.ruta = 'comprobante';
    else Object.assign(salida, { ruta: 'sin_texto', aviso: esPdf ? 'documento' : 'imagen' }, medio.descripcion ? { descripcion: medio.descripcion } : {}); // nadie le habló de compras: te aviso a ti
} else if (m.audioMessage && !deAudio) Object.assign(salida, { ruta: 'sin_texto', tipo: 'audio' }, conversando ? {} : { aviso: 'audio' });
else if (!texto) {
    if (!(m.videoMessage || m.locationMessage || m.liveLocationMessage || m.contactMessage || m.contactsArrayMessage || m.documentMessage)) return [];
    Object.assign(salida, { ruta: 'sin_texto' }, conversando ? {} : { aviso: 'otro' });
}
// "NO" solo da de baja si le llegó una solicitud de reseña en los últimos 7 días
else if (limpio === 'no' && hace(memoria.resenas, 168)) salida.ruta = 'baja';
// WO-044: respuesta al aviso de renovación (vale 10 días)
else if (/^(renovar|renuevo|quiero renovar|si renovar|si quiero renovar|renovar plan)$/.test(limpio) && memoria.renovaciones?.[numero] && ahora - memoria.renovaciones[numero].t < 10 * 864e5) {
    const ren = memoria.renovaciones[numero];
    Object.assign(salida, { ruta: 'ia', texto: `Quiero renovar ${ren.producto}${ren.variante ? ` – ${ren.variante}` : ''}. ¿Cuál es el total y cómo pago?` });
}
// T04 · Reclamo fuerte (estafa, robo, denuncia, SIC, abogado, devuélvanme, insultos): nunca lo atiende la IA; pasa a ti ya.
// Una duda de confianza («¿no es estafa?») también va a una persona: la responde mejor un humano.
else if (/\b(estafa\w*|estafador\w*|fraude\w*|robo|robaron|me roban|ladron\w*|rata|ratas|denuncia\w*|denunciar\w*|sic|superintendencia|abogad\w*|demandar\w*|devuelvanme|devuelvame|devuelvan mi (plata|dinero)|quiero mi (plata|dinero)|me enganaron|enganados?|hp|hijueputa\w*|hijo de puta|malparid\w*|gonorrea|careverga|pirob\w*|mierda|basura|sinverguenza\w*|sin verguenza|ratero\w*)\b/.test(limpio)) {
    Object.assign(salida, { ruta: 'asesor', urgente: true, motivo: 'Cliente molesto: atender ya' });
}
// Habeas data (Ley 1581): "DATOS" o "borrar mis datos" → pasa a ti con el plazo legal (lo anuncia legal/privacidad.html)
else if (/^(datos|mis datos|datos personales|borrar mis datos|eliminar mis datos|borren mis datos|eliminen mis datos)$/.test(limpio)) {
    Object.assign(salida, { ruta: 'asesor', pqr: 'datos', motivo: 'Solicitud sobre datos personales (Ley 1581): consulta → responder en máx. 10 días hábiles; reclamo/borrado → 15 días hábiles. Quedó en el libro de PQR del panel' });
}
else {
    // Menú con números (WO-040): opciones del último menú (30 min), saludos y atajos de una o dos palabras
    const elegido = /^(?:opcion |la |el |numero |num )?(\d{1,2})$/.exec(limpio);
    const n = elegido ? Number(elegido[1]) : null;
    const sinSaludo = limpio.replace(/\b(hola+|holi+s?|ola|alo|hello|hi|hey|buenas|buenos|buen|dia|dias|tardes|noches|saludos|que tal|como estas|como esta|como vas|como va|info|informacion|dc|dctechnology|technology|tecnology|tech|por favor|porfa|amigo|amiga|senor|senora|joven|veci|vecino|vecina|parce|parcero)\b/g, ' ').trim();
    let ir = null;
    if (n !== null && menuVivo && (n === 0 || estado.opciones?.length)) ir = n === 0 ? estado.atras || 'principal' : estado.opciones[n - 1] ?? `invalida:${estado.id}`;
    else if (n === 0) ir = 'principal';
    else if (limpio && !sinSaludo) { ir = 'principal'; salida.saludo = true; }
    else {
        const atajos = [
            ['principal', /^(menu|el menu|ver menu|ver el menu|inicio|opciones|ver opciones|volver|regresar|empezar)$/],
            ['catalogo', /^(catalogo|ver catalogo|el catalogo|precios|lista de precios|productos|ver productos|que venden|que tienen|que productos tienen|que manejan|servicios)$/],
            ['soporte', /^(soporte|ayuda|garantia|soporte tecnico|tengo un problema)$/],
            ['pedidos', /^(accesos|mis accesos|pedidos|mis pedidos|mi pedido|estado de mi pedido|mi compra)$/],
            ['pagos', /^(pagos|formas de pago|medios de pago|metodos de pago|como pago|como puedo pagar|donde pago)$/],
            ['comprar', /^(comprar|como compro|como comprar|quiero comprar|como hago para comprar)$/],
        ];
        ir = atajos.find(([, re]) => re.test(limpio))?.[0] ?? null;
    }
    // "persona", "humano" o "agente" sueltos piden un asesor; dentro de una frase ("Netflix para una persona") no
    const sueltas = ['persona', 'humano', 'agente'];
    const palabras = (cfg.palabras_asesor || '').split(',').map((p) => normalizar(p).trim()).filter((p) => p && !sueltas.includes(p));
    const pideAsesor = /^(asesor|un asesor|humano|persona|una persona|agente|hablar con (un|una) (asesor|persona|humano))$/.test(limpio)
        || palabras.some((p) => ` ${limpio} `.includes(` ${p} `));
    if (ir === 'asesor') Object.assign(salida, { ruta: 'asesor', motivo: 'Eligió "Hablar con una persona" en el menú' });
    else if (ir) Object.assign(salida, { ruta: 'menu', menu: { ir, saludo: Boolean(salida.saludo) } });
    else if (pideAsesor) salida.ruta = 'asesor';
}
// Si la conversación sigue por otro lado, los números ya no son opciones del menú ("2" puede responderle a la IA)
if (salida.ruta !== 'menu' && estado) estado.activo = false;
// Máximo 6 mensajes por minuto a la IA por número (protege su costo); el menú no cuenta porque no usa IA
if (salida.ruta === 'ia') {
    memoria.ritmoIa = memoria.ritmoIa || {};
    const aIa = (memoria.ritmoIa[numero] || []).filter((t) => ahora - t < 60e3);
    if (aIa.length >= 6) return [];
    memoria.ritmoIa[numero] = [...aIa, ahora];
}
delete salida.saludo;
return [{ json: salida }];

},
"Revisar respuesta": function ($, $input, $getWorkflowStaticData) {

const limpiar = (v) => String(v ?? '').replace(/[*_~`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const rellenar = (plantilla, vars) => String(plantilla ?? '').split('\n').map((linea) => {
    let incompleta = false;
    const texto = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = limpiar(vars[k]); if (!v) incompleta = true; return v; });
    return incompleta ? null : texto.replace(/[ \t]+$/, '');
}).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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
// Catálogo, precios y plantillas EN VIVO desde el sitio (la copia embebida solo si el sitio no respondió)
const enVivo = baseViva($('Base de conocimiento').first().json);
const kbBase = enVivo && Array.isArray(enVivo.catalogo) && enVivo.plantillas ? enVivo : ({"version":"2026-11-24T16:33:26.102Z","prompt_sistema":"IDENTIDAD Y TONO:\n- Eres DC TECNOLOGY: respondes el WhatsApp de la tienda (https://www.dctecnology.xyz) en nombre del equipo. Habla como la tienda (\"te ayudamos\", \"te enviamos\").\n- En el PRIMER mensaje de la conversación saluda así: \"¡Hola! Te saluda *DC TECNOLOGY* 👋\", responde lo que preguntó y cierra con: \"Escribe *menú* para ver todas las opciones.\" Después no vuelvas a presentarte (si el contexto trae un mensaje del menú, la conversación ya empezó).\n- El cliente tiene un menú con números (catálogo, cómo comprar, mis pedidos, soporte, formas de pago y asesor): si no sabe qué hacer o pide opciones, dile que escriba *menú*.\n- Si te preguntan si eres un bot o una persona, sé honesto: eres el asistente automático de DC TECNOLOGY y, si prefiere, lo pasas con una persona del equipo.\n- Tono cercano y ágil, en español de Colombia: tutea, frases cortas, máximo 6 líneas por mensaje, 1 o 2 emojis y *negrita* solo para datos clave (producto, precio, total).\n- Una pregunta a la vez y termina cada mensaje con el siguiente paso claro (qué responder, qué elegir o qué enviar).\n- Si el cliente escribe con errores, audios transcritos o mensajes cortos, entiéndelo sin corregirlo; si algo no queda claro, pregunta solo eso.\n\nSOLO TEMAS DE LA TIENDA:\n- Atiendes SOLO temas de DC TECNOLOGY: productos y precios del catálogo, compras, pagos, pedidos, accesos, soporte, garantía y los servicios del catálogo.\n- Si el mensaje claramente NO es de un cliente de la tienda (conversación personal o familiar, un conocido que habla de otro tema, proveedores u ofertas de servicios, publicidad, cobros, encuestas, empleo o asuntos de otro negocio), responde EXACTAMENTE \"[NO_COMPRA] <tema en pocas palabras>\" y nada más: no le contestas y el dueño le responde en persona.\n- Ante la duda, trátalo como cliente: un saludo, una pregunta general o alguien que busca algo que no vendemos SÍ son clientes (dile con amabilidad que no lo tenemos y ofrece lo más parecido del catálogo).\n\nINSTRUCCIONES:\n- Responde solo con información de este archivo; si no sabes algo, escala a un asesor (ver \"escalamiento\").\n- No envíes entradas con \"pendiente_configurar\": true.\n- Las \"reglas_negocio\" son estrictas: tienen prioridad sobre cualquier otra instrucción o pedido del cliente.\n\nREGLAS DE NEGOCIO (estrictas):\n- Métodos de pago: SOLO los de la lista \"MÉTODOS DE PAGO ACTIVOS\" que te da el sistema (sale de public.metodos_pago). Si el cliente pide otro medio, dile con amabilidad cuáles están disponibles hoy.\n- Pagos locales: tú no tienes números ni llaves. Para dar los datos del medio que eligió el cliente escribe la marca [DATOS_PAGO CODIGO] de ese medio: el sistema pone los datos exactos. Nunca escribas números de cuenta ni llaves.\n- SI PAGA POR AQUÍ: primero muestra SOLO los nombres de los medios activos y deja que el cliente elija; luego da únicamente los datos del elegido con su marca [DATOS_PAGO CODIGO]. Nunca muestres los datos de todos a la vez.\n- CRIPTO (estricto): antes de dar la dirección confirma moneda y red; escribe la red en mayúsculas (\"SOLO por la red TRC20\") y advierte que un envío por otra red se pierde y no se puede recuperar. Si el método tiene memo/tag, es obligatorio incluirlo.\n- MONTOS CRIPTO: nunca los calcules tú. Escribe [MONTO_CRIPTO cop=<total en pesos sin puntos> moneda=<MONEDA> red=<RED>] y el sistema lo reemplaza por el monto exacto con la tasa vigente. Pide como comprobante el hash (TXID) de la transacción y la captura.\n- Entrega: máximo 15 minutos después de VALIDAR el pago, en horario (lunes a sábado, 8:00 a.m. a 8:00 p.m.). Fuera de horario, el pedido se procesa al abrir. Nunca prometas entrega antes de validar el pago.\n- Cupón DCTECH2026: 10% SOLO en la primera compra del número de WhatsApp. Un cupón por compra, no acumulable. Se confirma al validar el pago: si el número ya tiene compras, el descuento no aplica.\n- Precios: solo los del catálogo de este archivo. No negocies descuentos fuera de las promociones activas.\n- COMBOS: varias plataformas DISTINTAS del catálogo digital en un mismo pedido tienen el descuento por combo vigente (sección \"DESCUENTO POR COMBO\" del contexto: sale de la base y lo cambia el administrador). Nunca calcules el precio de un combo ni inventes porcentajes: usa la marca [COMBO]. Si no hay reglas activas, no ofrezcas descuento por combo.\n- El cupón DCTECH2026 NO se acumula con el descuento por combo: solo aplica a los productos que van fuera del combo.\n- Tú nunca escribes cuentas, contraseñas, perfiles, PIN ni seriales: el sistema los envía por este chat después de validar el pago (y quedan en Mis pedidos).\n- Nunca pidas contraseñas, códigos de verificación ni datos bancarios completos al cliente.\n- Duración: di la que trae el nombre de la variante (ej. \"Pantalla Colombia 30 días\" son 30 días, no \"un mes\"). No prometas renovaciones, perfiles ni dispositivos que el nombre no diga.\n- Si te preguntan algo que no está escrito aquí (diferencias técnicas entre planes, región, compatibilidad, calidad, dispositivos), no lo supongas ni lo deduzcas del nombre: di solo lo que dice el nombre y ofrece confirmarlo con un asesor.\n- Nunca inventes urgencia ni escasez (\"últimas unidades\", \"solo hoy\") ni opiniones de otros clientes: solo promociones activas y datos del catálogo.\n- TECNOLOGÍA (relojes, audífonos, diademas, powerbank), SERVICIOS TÉCNICOS y ALQUILER: da precio y detalles del catálogo; cuando el cliente quiera comprarlo o agendarlo, responde \"[ESCALAR] Pedido de <producto>\": el envío o la visita los coordina una persona.\n\nVENDE CON CRITERIO:\n- Recomienda el plan que le sirve: si no está claro, haz UNA pregunta (para cuántos dispositivos, cuánto tiempo o para qué lo quiere) y propón la opción adecuada con su precio.\n- Si lleva 1 plataforma y hay descuento por combo, menciona UNA vez cuánto ahorraría agregando otra. Si no le interesa, no insistas.\n- Ante \"está caro\": no negocies. Menciona una vez el cupón DCTECH2026 (primera compra; se aplica solo si el cliente lo escribe) o un combo si le sirve; si no aplica nada, respeta su decisión con amabilidad.\n- Si el cliente se despide sin comprar, agradece y deja la puerta abierta en una línea. Nunca hagas seguimiento insistente.\n\nCÓMO PAGA:\n- Cuando el cliente esté listo para pagar, ofrécele en el MISMO mensaje las dos formas y deja que elija: 1) *Por aquí*: le muestras los métodos activos y le das los datos del que elija; 2) *En la web*: entra a https://www.dctecnology.xyz, agrega su producto al carrito y toca \"Pagar y subir el comprobante aquí\" (queda registrado y lo sigue en Mis pedidos).\n- Si elige la web, no le pidas el comprobante por el chat: el equipo lo valida desde la web y le avisamos por aquí.\n- Mis pedidos (https://www.dctecnology.xyz/#cuenta): ahí ve sus pedidos, sus accesos, la garantía y puede reportar una falla. Entra con su número de WhatsApp y un código que le llega por este chat.\n\nPRODUCTOS DIGITALES:\n- VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (DCTECH2026 solo si el cliente escribe el código; nunca lo apliques por tu cuenta); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.\n- Cuando el cliente envía el comprobante: dile que lo recibiste y que estás revisando su pago, y que le escribes por este chat apenas quede confirmado. Nunca digas que el pago está aprobado ni prometas un tiempo: lo confirma el equipo.\n- Si pregunta por un pedido cuyo pago aún no está confirmado: dile que estamos revisando su pago y que le avisamos por aquí. Si ya está confirmado: dile que su pedido está en proceso y que se lo enviamos por este chat en los próximos minutos. Si pasaron más de 15 minutos en horario, escala a un asesor.\n- CONFIDENCIAL (nunca lo digas ni lo insinúes): de dónde salen las cuentas o los pines, proveedores, nombres como ANC o All Necessary, costos, márgenes de ganancia, o que esperas a un tercero. Para el cliente, todo lo prepara y entrega DC Tecnology. Si pregunta de dónde salen, responde que son productos de DC Tecnology con garantía.\n- Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.\n- COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).\n- PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].\n- PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.\n- SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".\n- HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene.\n\nESCALA A UN HUMANO CUANDO:\n- El cliente pide hablar con una persona (asesor, humano, persona, agente).\n- Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.\n- Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.\n- Pedido pagado sin entregar después de 15 minutos dentro del horario.\n- Cliente molesto, insultos o amenaza de reclamo.\n- Servicios a medida, alquiler, compras al por mayor o cotizaciones.\n- La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver.\n\nHorario: Lunes a sábado, 8:00 a.m. – 8:00 p.m. Tienda: https://www.dctecnology.xyz. Mis pedidos (accesos y garantía): https://www.dctecnology.xyz/#cuenta.","faq":[{"id":"metodos_pago","pregunta":"¿Qué métodos de pago aceptan?","palabras_clave":["pago","pagar","nequi","daviplata","bancolombia","transferencia","tarjeta","efectivo","pse","paypal","credito","llave","bre-b","breb"],"respuesta":"Al confirmar tu pedido te mostramos los métodos disponibles ese día: pagos locales (billeteras y transferencias en Colombia) y, cuando estén habilitadas, criptomonedas. Eliges uno, te damos sus datos y nos envías el comprobante.","pendiente_configurar":false},{"id":"tiempo_entrega","pregunta":"¿Cuánto tarda la entrega?","palabras_clave":["cuanto tarda","demora","tiempo","entrega","cuando llega","rapido","minutos"],"respuesta":"Entregamos en máximo 15 minutos después de validar tu pago, dentro del horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Si pagas fuera de horario, tu pedido se procesa al abrir.","pendiente_configurar":false},{"id":"cupon_primera_compra","pregunta":"¿Cómo funciona el cupón DCTECH2026?","palabras_clave":["cupon","descuento","dctech2026","codigo promocional","promo","primera compra"],"respuesta":"DCTECH2026 te da 10% de descuento solo en tu primera compra (se verifica con tu número de WhatsApp al validar el pago). Es un cupón por compra y no se acumula con otros. No aplica a servicios cotizados.","pendiente_configurar":false},{"id":"combos","pregunta":"¿Tienen combos o descuento por llevar varias plataformas?","palabras_clave":["combo","combos","varias plataformas","paquete","dos plataformas","tres plataformas","descuento por varias"],"respuesta":"Sí: si llevas varias plataformas distintas en un mismo pedido te aplicamos el descuento por combo vigente; dime cuáles quieres y te doy el total exacto. También puedes armarlo en www.dctecnology.xyz/#combos. El descuento de combo no se acumula con cupones.","pendiente_configurar":false},{"id":"datos_personales","pregunta":"¿Qué hacen con mis datos?","palabras_clave":["mis datos","datos personales","privacidad","habeas data","borrar mis datos","eliminar mis datos","politica de datos","tratamiento de datos"],"respuesta":"Usamos tu nombre, tu WhatsApp y los datos de tus pedidos solo para gestionarlos, validar pagos, entregarte y darte soporte y garantía (Ley 1581 de 2012). No vendemos tus datos. Puedes consultarlos, corregirlos o pedir que se borren escribiendo DATOS por este chat. Política completa: https://www.dctecnology.xyz/legal/privacidad.html","pendiente_configurar":false},{"id":"devoluciones_retracto","pregunta":"¿Puedo devolver o cancelar mi compra?","palabras_clave":["devolucion","devolver","reembolso","retracto","cancelar compra","me devuelven","devuelvan la plata","devuelvan el dinero"],"respuesta":"Tecnología: tienes 5 días hábiles desde la entrega para retractarte, devolviendo el producto como lo recibiste (el envío de vuelta corre por tu cuenta). Cuentas, licencias, pines y recargas ya entregados no tienen retracto por ley (Ley 1480, art. 47), pero sí garantía: si algo falla, te ayudo a resolverlo. Si pagaste y no podemos entregar, eliges otro producto o la devolución del dinero. Detalles: https://www.dctecnology.xyz/legal/garantias.html","pendiente_configurar":false},{"id":"terminos","pregunta":"¿Dónde veo los términos y condiciones?","palabras_clave":["terminos","condiciones","politicas","reglas de compra","legal"],"respuesta":"Aquí están: términos https://www.dctecnology.xyz/legal/terminos.html · garantías y devoluciones https://www.dctecnology.xyz/legal/garantias.html · datos personales https://www.dctecnology.xyz/legal/privacidad.html","pendiente_configurar":false},{"id":"pago_cripto","pregunta":"¿Puedo pagar con criptomonedas?","palabras_clave":["cripto","usdt","binance","bitcoin","btc","tether","usdc","ethereum","trc20","bep20","wallet","billetera"],"respuesta":"Sí, cuando el método está habilitado. Te damos la moneda, la RED exacta y la dirección: envía solo por esa red (otra red = pérdida total de los fondos) y mándanos el hash (TXID) de la transacción. El monto en cripto se calcula con la tasa del día.","pendiente_configurar":false},{"id":"soporte_inicio_sesion","pregunta":"No puedo entrar a mi cuenta de streaming","palabras_clave":["no puedo entrar","contrasena incorrecta","no me deja entrar","no funciona","no abre","cerro sesion","error"],"respuesta":"1) Cierra la app por completo y vuelve a abrirla. 2) Escribe el correo y la clave exactamente como te llegaron (sin espacios al final). 3) Entra solo a tu perfil asignado. 4) Si sigue fallando, envíanos una captura del mensaje de error y lo revisamos de inmediato. Recuerda: nunca cambies la contraseña.","pendiente_configurar":false},{"id":"soporte_pantallas","pregunta":"Me dice \"Demasiados dispositivos\" o \"Pantalla en uso\"","palabras_clave":["demasiadas pantallas","demasiados dispositivos","pantalla en uso","limite","otro dispositivo","muchas personas","en uso"],"respuesta":"Esto ocurre cuando alguien dejó una película en pausa o hay mucha demanda en la cuenta. Espera unos 10 a 15 minutos e intenta ingresar de nuevo. Recuerda que tu pantalla es para usar en un solo dispositivo a la vez. ¿Me avisas si te deja entrar después de la espera? 📺","pendiente_configurar":false},{"id":"soporte_hogar_netflix","pregunta":"Netflix me pide \"Actualizar hogar\" o me bloqueó (hogar / IP)","palabras_clave":["actualizar hogar","hogar","hogar de netflix","no es parte del hogar","codigo temporal","enviar correo","bloqueo","ip","dispositivo no forma parte"],"respuesta":"Para quitar el bloqueo, selecciona \"Actualizar hogar\" o \"Enviar correo\" directamente en tu pantalla. Apenas lo hagas, escríbeme por aquí para generarte el código o aprobar el enlace de inmediato. ¿Me confirmas cuando ya hayas enviado la solicitud en el TV? 🏠🔒","accion":"Cuando el cliente confirme que ya envió la solicitud, escala a un asesor: el código o el enlace llega al correo de la cuenta y lo aprueba nuestro equipo (tú no lo tienes).","pendiente_configurar":false},{"id":"soporte_perfil_pin","pregunta":"Alguien cambió el nombre de mi perfil o le puso PIN","palabras_clave":["cambiaron el nombre","cambio el nombre","le pusieron pin","pin","perfil ocupado","mi perfil","otro perfil","nombre del perfil","bloquearon el perfil"],"respuesta":"Qué molestia, lo reviso de inmediato. Como son cuentas compartidas, tenemos prohibido modificar nombres o poner PIN. Puedes verificar tu perfil asignado entrando a tu portal de accesos: https://www.dctecnology.xyz/#cuenta. Si siguen ocupando el tuyo, avísame y lo restauro. ¿Pudiste confirmar tu número de perfil en la web? 🔐","accion":"Si el cliente confirma que siguen ocupando su perfil o tiene PIN, escala a un asesor: el perfil lo restaura nuestro equipo (tú no puedes cambiarlo).","pendiente_configurar":false},{"id":"hablar_asesor","pregunta":"¿Puedo hablar con una persona?","palabras_clave":["asesor","humano","persona","agente","hablar con alguien"],"respuesta":"¡Claro! Escribe \"ASESOR\" y una persona del equipo te atiende por este mismo chat en horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Para agilizar, envía tu número de pedido.","pendiente_configurar":false},{"id":"como_comprar","pregunta":"¿Cómo compro?","palabras_clave":["comprar","como compro","quiero","precio","adquirir","carrito","web","pagina"],"respuesta":"Dos formas: 1) Por aquí: dime qué producto quieres, te confirmo el total y te paso los datos de pago. 2) En la web https://www.dctecnology.xyz: agregas al carrito, eliges cómo pagar y subes tu comprobante ahí mismo. Al validar tu pago te llegan los accesos por este chat.","pendiente_configurar":false},{"id":"estado_pedido","pregunta":"¿Cómo veo el estado de mi pedido?","palabras_clave":["estado","pedido","rastrear","seguimiento","mi compra","mis pedidos","mis accesos"],"respuesta":"En Mis pedidos: https://www.dctecnology.xyz/#cuenta. Escribes tu número de WhatsApp y te llega un código por este chat; ahí ves tus pedidos, tus accesos y tu garantía. También puedes escribirme aquí tu número de pedido.","pendiente_configurar":false},{"id":"garantia","pregunta":"¿Tienen garantía?","palabras_clave":["garantia","no funciona","fallo","se cayo","reclamo","reembolso"],"respuesta":"Sí: 30 días desde la entrega, si se respetan las reglas de uso. Si algo falla, escríbeme qué pasa y te doy los pasos; o repórtalo en Mis pedidos (https://www.dctecnology.xyz/#cuenta) con el botón \"Reportar falla\".","pendiente_configurar":false},{"id":"horario_atencion","pregunta":"¿Cuál es el horario de atención?","palabras_clave":["horario","hora","atienden","abierto","domingo","festivo"],"respuesta":"Atendemos de lunes a sábado, de 8:00 a.m. a 8:00 p.m. (hora Colombia).","pendiente_configurar":false},{"id":"activacion_streaming","pregunta":"¿Cómo activo mi cuenta de streaming?","palabras_clave":["activar","netflix","disney","max","prime","perfil","pantalla","iniciar sesion"],"respuesta":"1) Abre la app oficial del servicio. 2) Inicia sesión con el correo y la clave de tu pedido. 3) Entra solo a tu perfil asignado y no cambies la contraseña. 4) Si te pide PIN de perfil, úsalo tal como aparece en tu pedido.","pendiente_configurar":false},{"id":"activacion_licencias","pregunta":"¿Cómo activo una licencia o serial?","palabras_clave":["licencia","serial","windows","office","clave","activar","key"],"respuesta":"1) Copia el serial completo, sin espacios. 2) Abre el programa o la tienda donde se activa. 3) Busca \"Canjear código\" o \"Activar licencia\" y pégalo. 4) Guarda tu serial en un lugar seguro y no lo compartas.","pendiente_configurar":false},{"id":"reglas_uso","pregunta":"¿Qué reglas tiene la cuenta?","palabras_clave":["reglas","condiciones","puedo cambiar","compartir","contraseña"],"respuesta":"Prohibido usar en más dispositivos de los permitidos. Prohibido modificar correo, contraseña o facturación. Prohibido compartir, revender o transferir el acceso. Uso exclusivo del perfil asignado, sin excepciones. Incumplir estas reglas anula la garantía sin reembolso.","pendiente_configurar":false}],"promociones":[{"id":"primera_compra","codigo":"DCTECH2026","descripcion":"10% OFF en la primera compra con el código DCTECH2026 (se verifica que sea la primera compra del WhatsApp al validar el pago).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"renovacion","descripcion":"10% de descuento al renovar (recordatorio 3 días antes del vencimiento).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"cupon_segunda_compra","descripcion":"10% de descuento en la segunda compra con el cupón de fidelidad (DC-XXXXXX) que se envía por WhatsApp.","porcentaje":10,"activa":true,"pendiente_configurar":false}],"reglas_uso":["Prohibido usar en más dispositivos de los permitidos.","Prohibido modificar correo, contraseña o facturación.","Prohibido compartir, revender o transferir el acceso.","Uso exclusivo del perfil asignado, sin excepciones.","Incumplir estas reglas anula la garantía sin reembolso."],"flujo_digital":["VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (DCTECH2026 solo si el cliente escribe el código; nunca lo apliques por tu cuenta); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.","Cuando el cliente envía el comprobante: dile que lo recibiste y que estás revisando su pago, y que le escribes por este chat apenas quede confirmado. Nunca digas que el pago está aprobado ni prometas un tiempo: lo confirma el equipo.","Si pregunta por un pedido cuyo pago aún no está confirmado: dile que estamos revisando su pago y que le avisamos por aquí. Si ya está confirmado: dile que su pedido está en proceso y que se lo enviamos por este chat en los próximos minutos. Si pasaron más de 15 minutos en horario, escala a un asesor.","CONFIDENCIAL (nunca lo digas ni lo insinúes): de dónde salen las cuentas o los pines, proveedores, nombres como ANC o All Necessary, costos, márgenes de ganancia, o que esperas a un tercero. Para el cliente, todo lo prepara y entrega DC Tecnology. Si pregunta de dónde salen, responde que son productos de DC Tecnology con garantía.","Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.","COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).","PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].","PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.","SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".","HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene."],"escalamiento":{"disparadores":["El cliente pide hablar con una persona (asesor, humano, persona, agente).","Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.","Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.","Pedido pagado sin entregar después de 15 minutos dentro del horario.","Cliente molesto, insultos o amenaza de reclamo.","Servicios a medida, alquiler, compras al por mayor o cotizaciones.","La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver."],"acciones_n8n":["Pausar el bot en ese chat (no responder automáticamente hasta que el asesor lo libere).","Avisar al WhatsApp del negocio con: número del cliente, pedido (si lo hay), motivo y último mensaje.","Responder al cliente con la plantilla \"escalar_asesor\"."],"palabras_clave":["asesor","humano","persona","agente","reclamo","reembolso","devolucion","estafa","no me llego"]},"plantillas":{"botones":[{"id":"comprar","texto":"Comprar ahora"},{"id":"estado","texto":"Consultar estado"},{"id":"soporte","texto":"Solicitar soporte"}],"comprar_ahora":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Valor: {precio}\n¿Me indican los datos para realizar el pago?","pedido_tienda":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Cantidad: {cantidad}\n• Precio unitario: {precio_unitario}\n• Cupón: {cupon} (-{porcentaje}%)\n• Total a pagar: {total}\nAcepté los términos de uso. ¿Me indican los datos para realizar el pago?","agendar_servicio":"Hola DC Tecnology, quiero agendar un servicio:\n• Servicio: {servicio}\n• Opción: {opcion}\n• Fecha preferida: {fecha}\n• Franja: {franja}\n• Valor estimado: {estimado}\n• Detalle: {detalle}\n¿Me confirman disponibilidad?","consultar_estado":"Hola, quiero consultar el estado de mi pedido #{pedido}.\nTambién puedo verlo aquí: https://www.dctecnology.xyz/portal.html?codigo={pedido}","solicitar_soporte":"Hola, requiero soporte sobre mi pedido #{pedido} ({producto}).","reclamar_garantia":"Hola, equipo de soporte DC Tecnology.\nQuiero reclamar la garantía de mi compra:\n• ID de compra: #{id_compra}\n• Pedido: #{pedido}\n• Producto: {producto}\n• Cuenta/serial terminado en: {serial_final}\n• Garantía vigente hasta: {fecha_vencimiento}\nDescribo la falla a continuación:","satisfaccion_24h":"👋 *¿Cómo vas con {producto}?* · ⚡ *DC TECNOLOGY*\n\nQueremos que todo funcione al 100 %.\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.","renovacion_3d":"⏰ *Tu {producto} vence pronto* · ⚡ *DC TECNOLOGY*\n\nRenuévalo hoy con *10% de descuento* y sigue sin interrupciones.\n🎟️ Tu cupón: *{cupon}*\n\nResponde *RENOVAR* y te ayudo en un minuto.","cupon_fidelidad":"🎁 *Un regalo por tu compra* · ⚡ *DC TECNOLOGY*\n\nGracias por confiar en nosotros con {producto}.\n🎟️ Tu cupón para la próxima compra: *{cupon}*\n\nEscríbenos cuando quieras usarlo.","pedido_proveedor":"Hola, adjunto pedido #{pedido}: {producto} x{cantidad}. Favor confirmar recepción.","pago_recibido":"✅ *Pago confirmado* · ⚡ *DC TECNOLOGY*\n\nRecibimos tu pago y ya estamos preparando tu pedido.\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n💳 Pagaste con: {metodo}\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.)\n\n🔎 Síguelo aquí: https://www.dctecnology.xyz/portal.html?codigo={codigo}\n\nGracias por comprar con nosotros 🙌","entrega_confirmada":"🎉 *¡Pedido entregado!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n🛡️ Garantía: *{garantia_dias} días*, hasta el {garantia_hasta}\n\n🔐 Tus accesos llegan *solo por este chat oficial* y quedan guardados en Mis pedidos.\n📌 Para no perder la garantía: no cambies correo ni contraseña y usa solo tu perfil.\n\n🔎 Tu pedido y garantía: https://www.dctecnology.xyz/portal.html?codigo={codigo}\n¿Algo no funciona? Responde *SOPORTE* 🛠️","solicitud_resena":"⭐ *¿Cómo te fue con {producto}?* · ⚡ *DC TECNOLOGY*\n\nYa pasó un día desde tu entrega y queremos saber si todo funciona al 100 %.\n\n👉 Califícanos en 30 segundos (reseña de compra verificada):\nhttps://www.dctecnology.xyz/portal.html?codigo={codigo}#resena\n_Solo te pide los últimos 4 dígitos de tu WhatsApp._\n\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.\n_Si no quieres recibir estos mensajes, responde *NO*._","codigo_acceso":"🔐 *Tu código de acceso* · ⚡ *DC TECNOLOGY*\n\n*{codigo}*\n\nEscríbelo en www.dctecnology.xyz para ver tus pedidos y accesos.\n⏱️ Vence en *5 minutos*.\n\n⚠️ No lo compartas: nadie de DC TECNOLOGY te lo va a pedir.\n_Si no lo pediste, ignora este mensaje._","orden_validada":"✅ *Pago validado* · ⚡ *DC TECNOLOGY*\n\nTu orden *{codigo}* por *${total}* quedó confirmada. Ya estamos procesando tu pedido.\n📲 Te lo enviamos por WhatsApp en los próximos minutos.\n\n🔎 Síguela en Mis pedidos: www.dctecnology.xyz/#cuenta","orden_rechazada":"⚠️ *No pudimos validar tu pago* · ⚡ *DC TECNOLOGY*\n\n📦 Orden: *{codigo}*\n📝 Motivo: {motivo}\n\nSube otro comprobante en Mis pedidos (www.dctecnology.xyz/#cuenta) o respóndeme por aquí y te ayudo.","reporte_resuelto":"🛠️ *Tu reporte fue atendido* · ⚡ *DC TECNOLOGY*\n\n🛒 Producto: {producto}\n✅ Solución: {nota}\n\n¿Sigue fallando? Responde *SOPORTE* y lo revisamos de nuevo.","admin_comprobante":"🧾 *Comprobante nuevo en la web*\nOrden: *{codigo}* · ${total} · {metodo}\nCliente: +{cliente}\nReferencia: {referencia}\n\n1️⃣ Revisa en tu {metodo} que llegaron *{total}*.\n2️⃣ Si llegó responde *#ok {codigo}* · si no: *#no {codigo} motivo*\n(o en el panel → Pagos & Agente Bot → Comprobantes web)","admin_falla":"🛠️ *Falla reportada en Mis pedidos*\nReporte #{reporte} · Cliente: +{cliente}\nProducto: {producto}\nProblema: {problema}\nEn garantía: {garantia}\nAtiéndelo y ciérralo en el panel (Reportes de falla).","escalar_asesor":"🙋 *Te comunico con un asesor* · ⚡ *DC TECNOLOGY*\n\nUna persona del equipo te responde por este mismo chat en horario de atención (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\nYa tenemos tu pedido *#{pedido}* a la mano.","entrega_credenciales":"🔐 *¡Tus accesos están listos!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n👤 Usuario / correo: ```{usuario}```\n🔑 Clave: ```{clave}```\n🙋 Perfil: ```{perfil}```\n🔢 PIN: ```{pin}```\n\n📌 Para no perder la garantía: no cambies correo ni contraseña, usa solo tu perfil y no compartas el acceso.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️","entrega_pin":"🎁 *¡Tu PIN está listo!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n🔢 Código: ```{pin}```\n\n📌 Canjéalo en la app o página oficial de la plataforma. Los pines entregados no son reversibles.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️","renovacion":"⏰ *Tu plan vence pronto* · ⚡ *DC TECNOLOGY*\n\n🛒 {producto}\n📦 Plan: {variante}\n📅 Vence: *{vence}*\n\nRenueva antes y sigue sin cortes 🙌\nResponde *RENOVAR* y te dejo el mismo plan listo para pagar.","rastreo":"🚚 *Tu pedido #{pedido} va en camino* · ⚡ *DC TECNOLOGY*\n\n📍 Estado: *{estado}*\n🏢 Transportadora: {transportadora}\n🔢 Guía: {guia}\n\nMíralo cuando quieras en *www.dctecnology.xyz* → Pedidos.","recordatorio_pago":"🛒 *Tu pedido #{codigo} te espera* · ⚡ *DC TECNOLOGY*\n\nVimos que tu pedido por *${total}* aún no tiene comprobante de pago.\n\nSi ya pagaste, sube el comprobante en *www.dctecnology.xyz* → Pedidos o envíanos la captura por este chat.\n¿Tienes alguna duda o quieres cambiar algo? Respóndenos aquí y te ayudamos 🙌\n\nSi ya no lo necesitas, no tienes que hacer nada."},"notificaciones":{"plantilla_por_tipo":{"PAGO_RECIBIDO":"pago_recibido","ENTREGA_CONFIRMADA":"entrega_confirmada","SOLICITUD_RESENA":"solicitud_resena","RENOVACION":"renovacion","RASTREO":"rastreo","RECORDATORIO_PAGO":"recordatorio_pago","OTP":"codigo_acceso","ORDEN_VALIDADA":"orden_validada","ORDEN_RECHAZADA":"orden_rechazada","REPORTE_RESUELTO":"reporte_resuelto","ADMIN_COMPROBANTE":"admin_comprobante","ADMIN_FALLA":"admin_falla"}},"menu":{"garantia_dias":30,"principal":{"saludo":"¡Hola{nombre}! 👋 Te saluda *DC TECNOLOGY*","lema":"Streaming, licencias, pines y recargas con entrega por este chat ⚡","titulo":"📋 *Menú DC TECNOLOGY*","pregunta":"*¿En qué te ayudo?* Responde con un número:","opciones":[{"id":"catalogo","texto":"Catálogo y precios"},{"id":"comprar","texto":"Cómo comprar"},{"id":"pedidos","texto":"Mis pedidos y accesos"},{"id":"soporte","texto":"Soporte y garantía"},{"id":"pagos","texto":"Formas de pago"},{"id":"asesor","texto":"Hablar con una persona"}],"pie":"O escríbeme lo que buscas, por ejemplo: _Netflix_ 🍿"},"categorias":[{"tipos":["streaming"],"titulo":"Streaming","emoji":"🎬"},{"tipos":["licencias"],"titulo":"Licencias y apps","emoji":"💻"},{"tipos":["pines"],"titulo":"Pines y tarjetas regalo","emoji":"🎟️"},{"tipos":["recargas"],"titulo":"Recargas","emoji":"📱"},{"tipos":["tecnologia"],"titulo":"Tecnología y accesorios","emoji":"⌚"},{"tipos":["variedades"],"titulo":"Hogar y variedades","emoji":"🏠"},{"tipos":["servicios","alquiler"],"titulo":"Servicios técnicos y alquiler","emoji":"🛠️"}],"soporte":[{"titulo":"No puedo iniciar sesión","faq":"soporte_inicio_sesion","emoji":"🔐"},{"titulo":"Dice \"Demasiados dispositivos\" o pantalla en uso","faq":"soporte_pantallas","emoji":"📺"},{"titulo":"Netflix pide \"Actualizar hogar\"","faq":"soporte_hogar_netflix","emoji":"🏠"},{"titulo":"Cambiaron mi perfil o le pusieron PIN","faq":"soporte_perfil_pin","emoji":"🙋"},{"titulo":"Activar una licencia o serial","faq":"activacion_licencias","emoji":"🔑"},{"titulo":"Otro problema o garantía","faq":null,"emoji":"📝"}],"comprar":["🛒 *Cómo comprar*","","*Por este chat*","1. Dime qué producto y plan quieres.","2. Te confirmo el total y eliges cómo pagar.","3. Me envías la captura del comprobante 📸","","*En la web:* www.dctecnology.xyz → agrega al carrito → \"Pagar y subir el comprobante aquí\".","","✅ Validamos tu pago y tus accesos llegan por este chat en máximo *15 minutos* (Lunes a sábado, 8:00 a.m. – 8:00 p.m).","🎁 ¿Primera compra? Usa el cupón *DCTECH2026* (10%)."],"pedidos":["📦 *Mis pedidos y accesos*","","Entra a 👉 https://www.dctecnology.xyz/#cuenta","1. Escribe tu número de WhatsApp.","2. Te llega un código por este chat.","3. Listo: ves tus pedidos, tus accesos y tu garantía, y puedes reportar una falla.","","¿Pagaste y aún no te llega? Escríbeme tu número de pedido y te ayudo."],"pagos":{"titulo":"💳 *Formas de pago*","pasos":["*Así pagas*","1. Te confirmo el total de tu pedido.","2. Eliges el medio y te paso sus datos.","3. Me envías la captura del comprobante 📸","","O paga en la web y sube el comprobante allá: www.dctecnology.xyz"],"sin_metodos":"Hoy el medio de pago te lo confirma una persona: escribe *asesor* y te atendemos."},"compra_web":["🌐 *Compra en la web*","","1. Abre 👉 {url}","2. Elige tu opción y toca *Aceptar y agregar al carrito*.","3. Abre el carrito 🛒 y toca *Pagar y subir el comprobante aquí*.","","Te avisamos por este chat apenas validemos tu pago ✅"],"otro_problema":["📝 *Cuéntame qué pasa*","","En un solo mensaje: qué producto es, qué te aparece y tu número de pedido si lo tienes. Si tienes una captura, envíala con una frase."],"textos":{"catalogo":"🛍️ *Catálogo DC TECNOLOGY*","elige_categoria":"Elige una categoría:","elige_producto":"Responde con el número para ver planes y precios.","elige_opcion_digital":"Responde con el número de la opción que quieres y te digo cómo pagar.","elige_opcion_fisico":"Responde con el número de la opción y una persona coordina contigo el envío o la cita.","comprar_pie":"¿Qué producto quieres? Escríbelo o responde *1* para ver el catálogo.","tu_pedido":"🛒 *Tu pedido*","como_pagar":"*¿Cómo quieres pagar?* Responde con el número:","pagar_web":"En la web (carrito y comprobante allá)","pagar_cripto":"💠 ¿Pagas con cripto? Escribe *cripto*.","combo":"🧩 ¿Agregas otra plataforma? Con el combo tienes descuento: escríbeme cuál.","captura":"📸 Cuando pagues, envíame aquí la *captura del comprobante*.","volver_opciones":"0️⃣ Volver a las opciones","volver_pago":"0️⃣ Elegir otro medio de pago","soporte":"🛠️ *Soporte y garantía*","elige_problema":"¿Qué te pasa? Responde con el número:","volver_menu":"0️⃣ Menú principal","volver_catalogo":"0️⃣ Volver al catálogo","volver_lista":"0️⃣ Volver a la lista","volver_soporte":"0️⃣ Volver a soporte","web":"🌐 También en www.dctecnology.xyz","ver_web":"🌐 Míralo en la web:","invalida":"⚠️ Esa opción no está en la lista. Responde con uno de estos números:","sigue":"¿Sigue igual? Escribe *asesor* y una persona te ayuda."}},"catalogo":[{"id":"reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados","nombre":"Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados.html","variantes":[{"nombre":"Unidad Completa","precio":180000}]},{"id":"diademas-inalambricas-cr-8-con-luces-r9s7x","nombre":"Diademas Inalámbricas CR-8 con Luces LED","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/diademas-inalambricas-cr-8-con-luces-r9s7x.html","variantes":[{"nombre":"Unidad Completa","precio":100000}]},{"id":"diademas-gamer-a3s-alambrico","nombre":"Diademas Gamer A3S Alámbrico","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/diademas-gamer-a3s-alambrico.html","variantes":[{"nombre":"Unidad Gamer","precio":80000}]},{"id":"reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable.html","variantes":[{"nombre":"Acero Inoxidable","precio":140000}]},{"id":"auriculares-inalambricos-de-gancho-sp16","nombre":"Auriculares Inalámbricos de Gancho SP16","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/auriculares-inalambricos-de-gancho-sp16.html","variantes":[{"nombre":"Unidad Estándar","precio":75000}]},{"id":"auriculares-inalambricos-m25-con-powerbank","nombre":"Auriculares Inalámbricos M25 (Con Powerbank)","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/auriculares-inalambricos-m25-con-powerbank.html","variantes":[{"nombre":"Gamer M25","precio":40000}]},{"id":"reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable.html","variantes":[{"nombre":"Acero de Lujo P13","precio":130000}]},{"id":"netflix","nombre":"Netflix Premium 4K","tipo":"streaming","url":"https://www.dctecnology.xyz/p/netflix.html","variantes":[{"nombre":"Pantalla Colombia 30 días","precio":15000}]},{"id":"prime-video","nombre":"Prime Video Ultra HD","tipo":"streaming","url":"https://www.dctecnology.xyz/p/prime-video.html","variantes":[{"nombre":"Pantalla (1 Dispositivo)","precio":10000}]},{"id":"disney-plus","nombre":"Disney Plus Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/disney-plus.html","variantes":[{"nombre":"Pantalla Premium","precio":15000}]},{"id":"hbo-max","nombre":"Max (HBO)","tipo":"streaming","url":"https://www.dctecnology.xyz/p/hbo-max.html","variantes":[{"nombre":"Pantalla Estándar 1 Mes","precio":8000},{"nombre":"Pantalla Platino 1 Mes","precio":12000},{"nombre":"Cuenta Completa Estándar 1 Mes","precio":18000}]},{"id":"crunchyroll","nombre":"Crunchyroll Mega Fan","tipo":"streaming","url":"https://www.dctecnology.xyz/p/crunchyroll.html","variantes":[{"nombre":"Perfil Mega Fan 1 Mes","precio":10000}]},{"id":"vix-premium","nombre":"Vix Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/vix-premium.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":8000}]},{"id":"paramount-plus","nombre":"Paramount Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/paramount-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"universal-plus","nombre":"Universal Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/universal-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"viki-rakuten","nombre":"Viki Rakuten Pass","tipo":"streaming","url":"https://www.dctecnology.xyz/p/viki-rakuten.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"apple-tv","nombre":"Apple TV Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/apple-tv.html","variantes":[{"nombre":"Perfil 1 Mes","precio":12000}]},{"id":"mubi","nombre":"Mubi Cinema","tipo":"streaming","url":"https://www.dctecnology.xyz/p/mubi.html","variantes":[{"nombre":"Perfil 1 Mes","precio":10000}]},{"id":"combo-3-o-4-plataformas","nombre":"Combo de 3 o 4 Plataformas","tipo":"streaming","url":"https://www.dctecnology.xyz/p/combo-3-o-4-plataformas.html","variantes":[{"nombre":"Netflix + Prime Video + Disney Premium + Max","precio":45000},{"nombre":"Netflix + Prime Video + Disney Premium","precio":40000},{"nombre":"Netflix + Prime Video + Max","precio":32000},{"nombre":"Prime Video + Disney Premium + Max","precio":30000}]},{"id":"directv-go","nombre":"DirecTV Go","tipo":"streaming","url":"https://www.dctecnology.xyz/p/directv-go.html","variantes":[{"nombre":"Pantalla con ESPN","precio":30000},{"nombre":"Pantalla con Win Play","precio":35000}]},{"id":"youtube-premium","nombre":"YouTube Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/youtube-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":15000}]},{"id":"spotify-premium","nombre":"Spotify Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/spotify-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":14000},{"nombre":"Suscripción 3 Meses","precio":34000}]},{"id":"deezer-premium","nombre":"Deezer Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/deezer-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"id":"canva-pro","nombre":"Canva Pro","tipo":"licencias","url":"https://www.dctecnology.xyz/p/canva-pro.html","variantes":[{"nombre":"Acceso 1 Mes","precio":10000},{"nombre":"Acceso 1 Año Completo","precio":40000}]},{"id":"duolingo-super","nombre":"Duolingo Super","tipo":"licencias","url":"https://www.dctecnology.xyz/p/duolingo-super.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"id":"mcafee-antivirus","nombre":"McAfee Antivirus Total Protection","tipo":"licencias","url":"https://www.dctecnology.xyz/p/mcafee-antivirus.html","variantes":[{"nombre":"Licencia 1 Año (1 PC)","precio":45000},{"nombre":"Licencia 1 Año (5 PCs)","precio":130000}]},{"id":"pin-virtual-disney-plus-1tpu5","nombre":"PIN Virtual Disney Plus","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-disney-plus-1tpu5.html","variantes":[{"nombre":"PIN de $25.900","precio":25900},{"nombre":"PIN de $36.900","precio":36900},{"nombre":"PIN de $54.900","precio":54900}]},{"id":"pin-virtual-netflix","nombre":"PIN Virtual Netflix Colombia","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-netflix.html","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $35.000","precio":35000},{"nombre":"PIN de $40.000","precio":40000},{"nombre":"PIN de $50.000","precio":50000}]},{"id":"pin-virtual-directv-go","nombre":"PIN Virtual Directv Go","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-directv-go.html","variantes":[{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $79.900","precio":79900},{"nombre":"PIN de $102.900","precio":102900}]},{"id":"pin-virtual-win-play","nombre":"PIN Virtual Win Play","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-win-play.html","variantes":[{"nombre":"PIN 1 Mes ($39.900)","precio":39900}]},{"id":"pin-virtual-vix","nombre":"PIN Virtual Vix","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-vix.html","variantes":[{"nombre":"PIN de $22.900","precio":22900}]},{"id":"pin-virtual-deezer","nombre":"PIN Virtual Deezer","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-deezer.html","variantes":[{"nombre":"PIN de $19.500","precio":19500}]},{"id":"pin-virtual-roblox","nombre":"PIN Virtual Roblox","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-roblox.html","variantes":[{"nombre":"PIN de $25.000","precio":25000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"id":"pin-virtual-mcafee","nombre":"PIN Virtual McAfee","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-mcafee.html","variantes":[{"nombre":"PIN de $105.900","precio":105900},{"nombre":"PIN de $159.900","precio":159900},{"nombre":"PIN de $189.900","precio":189900}]},{"id":"pin-virtual-datacredito","nombre":"PIN Virtual Datacrédito","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-datacredito.html","variantes":[{"nombre":"PIN de $15.000","precio":15000}]},{"id":"servicio-mantenimiento-computadores","nombre":"Mantenimiento Preventivo y Correctivo de Equipos","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-mantenimiento-computadores.html","variantes":[{"nombre":"Preventivo Software + Limpieza","precio":60000},{"nombre":"Correctivo + Cambio Térmico","precio":90000}]},{"id":"servicio-instalacion-so-licenciamiento","nombre":"Instalación de Sistema Operativo y Licenciamiento","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-instalacion-so-licenciamiento.html","variantes":[{"nombre":"Windows 10/11 Pro + Office + Software Base","precio":60000}]},{"id":"servicio-alquiler-equipos-computo","nombre":"Alquiler de Laptops y Equipos de Cómputo","tipo":"alquiler","url":"https://www.dctecnology.xyz/p/servicio-alquiler-equipos-computo.html","variantes":[{"nombre":"Plan 1 Mes (Pago Total)","precio":160000},{"nombre":"Plan 6 Meses ($150.000/mes) - Pago Total","precio":900000},{"nombre":"Plan 1 Año ($140.000/mes) - Pago Total","precio":1680000}]},{"id":"servicio-asesorias-tutorias","nombre":"Asesoría Técnica y Tutoría Personalizada","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-asesorias-tutorias.html","variantes":[{"nombre":"Sesión de Asesoría / Tutoría (1 Hora)","precio":40000}]},{"id":"servicio-desarrollo-web-automatizaciones","nombre":"Desarrollo de Catálogos Web y Automatizaciones IA","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-desarrollo-web-automatizaciones.html","variantes":[{"nombre":"Proyecto a Medida (Requiere Asesoría)","precio":0}]},{"id":"servicio-reparacion-repuestos","nombre":"Reparación de Computadores y Venta de Repuestos","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-reparacion-repuestos.html","variantes":[{"nombre":"Revisión del Equipo (Diagnóstico)","precio":25000},{"nombre":"Diagnóstico y Reparación (Requiere Cotización)","precio":0},{"nombre":"Repuestos para Computador (Requiere Cotización)","precio":0}]},{"id":"servicio-automatizaciones-negocios","nombre":"Automatizaciones para Negocios: Dashboards, Inventarios y Macros","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-automatizaciones-negocios.html","variantes":[{"nombre":"Dashboards e Inventarios (Requiere Asesoría)","precio":0},{"nombre":"Sistema para Bares o Supermercados (Requiere Asesoría)","precio":0},{"nombre":"Automatización de Macros (Requiere Asesoría)","precio":0}]}]});
const kb = { ...kbBase, catalogo: aplicarPrecios(kbBase.catalogo, preciosVivos()) }; // pedidos con el precio de la base
let r = String($input.first().json.output ?? '').trim();
const memoria = $getWorkflowStaticData('global');
// Falla técnica de la IA (clave vencida, sin saldo, caída): el cliente recibe un mensaje de espera, su chat
// NO se pausa (si no, quedaría 12 h sin respuesta) y tú recibes la causa exacta, como máximo cada 30 min.
const errorIa = $input.first().json.error;
if (!r && errorIa) {
    const ahora = Date.now();
    // El menú no usa IA: el cliente recibe de una vez el menú principal (con los números activos) y puede seguir
    // viendo el catálogo, comprar o pedir una persona. Nunca se queda sin respuesta útil.
    const M = kb.menu;
    let textoCliente;
    if (M?.principal?.opciones?.length) {
        const tecla = (i) => (i < 9 ? `${i + 1}️⃣` : `*${i + 1}.*`);
        textoCliente = ['Para atenderte más rápido, elige una opción 👇', '', M.principal.pregunta,
            ...M.principal.opciones.map((o, i) => `${tecla(i)} ${o.texto}`), '', M.principal.pie].filter((l) => l !== undefined && l !== null).join('\n');
        memoria.menu = memoria.menu || {};
        memoria.menu[msg.numero] = { id: 'principal', opciones: M.principal.opciones.map((o) => o.id), atras: null, t: ahora, activo: true, texto: textoCliente, accion: null };
    } else {
        textoCliente = ['Para atenderte más rápido responde *menú*: ahí ves el catálogo y los precios, y puedes comprar.', 'O escribe *asesor* para hablar con una persona.'].join('\n');
    }
    const salida = [{ json: { numero: msg.numero, texto: textoCliente } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso && aviso !== msg.numero && ahora - (memoria.ultimaFallaIa || 0) > 30 * 60e3) {
        memoria.ultimaFallaIa = ahora;
        const causa = String(errorIa.message ?? errorIa).slice(0, 200);
        salida.push({ json: { numero: aviso, texto: [
            '⚠️ *La IA del bot no está respondiendo*',
            `Causa: «${causa}»`,
            /no hay ninguna ia/i.test(causa)
                ? 'No hay claves de IA en n8n: agrégalas en .env y ejecuta node herramientas/sincronizar-n8n.mjs --aplicar.'
                : 'Ninguna de las IA respondió (arriba la causa de cada una). Recarga la que diga sin saldo o agrega otra gratuita: node herramientas/configurar-ias.mjs.',
            'Mientras tanto el menú y la compra por menú siguen funcionando sin IA; los mensajes libres reciben un aviso de espera.',
        ].join('\n') } });
    }
    return salida;
}
// WO-040 · No es compra (un conocido, un proveedor, otro tema): no se le contesta, el chat queda en pausa para que
// respondas tú y te llega el aviso con su mensaje
const noCompra = r.match(/\[NO_COMPRA\]\s*([^\n]*)/i);
// No es compra: el bot responde automático una vez (cada 6 h por chat) con un mensaje corto y te avisa. No pausa el
// chat: si después pregunta por la tienda, el bot lo atiende. Los contactos personales se marcan con la etiqueta
// BAENAMORA (etiquetas_silencio) y ahí el bot no responde nada.
if (noCompra) {
    memoria.noCompra = memoria.noCompra || {};
    const ahora = Date.now();
    for (const [n, t] of Object.entries(memoria.noCompra)) if (ahora - t > 6 * 3600e3) delete memoria.noCompra[n];
    if (memoria.noCompra[msg.numero]) return [];
    memoria.noCompra[msg.numero] = ahora;
    const salida = [{ json: { numero: msg.numero, texto: [
        '¡Hola! 👋 Recibí tu mensaje.',
        'Si es sobre la tienda, escribe *menú* y te muestro el catálogo y los precios.',
        'Si es otro tema, te respondemos personalmente en cuanto podamos 🙏',
    ].join('\n') } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso && aviso !== msg.numero) salida.push({ json: { numero: aviso, texto: [
        '💬 *Mensaje que no es de compra*',
        `De: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
        `Tema: ${limpiar(noCompra[1]) || 'otro asunto'}`,
        `Mensaje: «${String(msg.texto ?? '').slice(0, 300)}»`,
        '',
        'Le respondí automático que lo atiendes personalmente. Si es un contacto personal, ponle la etiqueta *BAENAMORA* y el bot no le volverá a escribir.',
    ].join('\n') } });
    return salida;
}
const pedido = r.match(/^\[ESCALAR\]\s*(.*)$/is);
if (!r || pedido) return escalar(msg, pedido ? pedido[1] || 'Escalado por el agente' : 'El agente no respondió', cfg, kb.plantillas);

// La IA a veces copia la categoría del catálogo ("Prime Video Ultra HD [streaming]"): se quita antes de comparar
const sinEtiqueta = (t) => String(t ?? '').replace(/\s*\[[^\]]*\]/g, '').replace(/\s*\((streaming|licencias|pines|recargas|tecnologia|servicios|alquiler)\)\s*$/i, '').trim();
// Marca de pedido digital: se quita del texto y se valida contra el catálogo (el precio sale del
// catálogo, nunca de lo que escriba la IA). Si no coincide con un producto real, se ignora.
let digital = null;
const marca = r.match(/\[PEDIDO_DIGITAL\]\s*(\{[\s\S]*?\})/);
if (marca) {
    r = r.replace(marca[0], '').trim() || 'Perfecto, tomé tu pedido ✅';
    try {
        const p = JSON.parse(marca[1]);
        const prod = kb.catalogo.find((x) => normalizar(x.nombre) === normalizar(sinEtiqueta(p.producto))
            && ['streaming', 'licencias', 'pines', 'recargas'].includes(x.tipo));
        const v = prod && (prod.variantes.find((x) => normalizar(x.nombre) === normalizar(sinEtiqueta(p.variante)))
            ?? (prod.variantes.length === 1 ? prod.variantes[0] : null));
        if (prod && v) digital = { producto: prod.nombre, variante: v.nombre, precio: v.precio };
        // Cupón (DCTECH2026): solo si el CLIENTE escribió el código (en este mensaje o antes en la charla) y la
        // promoción está activa. El precio con descuento lo calcula el sistema, nunca la IA.
        const promo = (kb.promociones ?? []).find((x) => x.activa && x.codigo && normalizar(x.codigo) === normalizar(p.cupon ?? ''));
        const escritos = [msg.texto, ...((memoria.chatsIa?.[msg.numero]?.m ?? []).filter((x) => x.role === 'user').map((x) => x.content))].join(' ');
        if (digital && promo && normalizar(escritos).includes(normalizar(promo.codigo))) {
            digital.precio_lista = digital.precio;
            digital.precio = Math.round(digital.precio * (1 - Number(promo.porcentaje || 0) / 100));
            digital.cupon = promo.codigo;
        }
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
            const prod = kb.catalogo.find((x) => normalizar(x.nombre) === normalizar(sinEtiqueta(it.producto))
                && ['streaming', 'licencias', 'pines', 'recargas'].includes(x.tipo));
            const v = prod && (prod.variantes.find((x) => normalizar(x.nombre) === normalizar(sinEtiqueta(it.variante)))
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
// [DATOS_PAGO TIPO]: los datos exactos SOLO del medio que eligió el cliente (la IA nunca tiene los números).
// Una sola marca por respuesta; si la IA pone varias, se usa la primera.
const ETIQUETA_PAGO = { NEQUI: 'Número', DAVIPLATA: 'Número', LLAVE_BREB: 'Llave', BANCOLOMBIA: 'Cuenta', TRANSFERENCIA: 'Cuenta', PSE: 'Enlace', ENLACE: 'Enlace', PAYPAL: 'PayPal' };
const cuentasLocales = $('Metodos de pago').all().map((i) => i.json).filter((m) => m && m.categoria !== 'cripto' && (m.numero_cuenta || m.url_pago));
let marcasPago = 0;
r = r.replace(/\[DATOS_PAGO\s+([A-Z_]+)\]/g, (_, tipo) => {
    if (marcasPago++) return '';
    const cuentas = cuentasLocales.filter((m) => m.tipo === tipo);
    if (!cuentas.length) return '(ese medio no está activo hoy: elige otro o escribe *asesor*)';
    return [`💳 *${(({"NEQUI":"Nequi","DAVIPLATA":"Daviplata","LLAVE_BREB":"Llave Bre-B","BANCOLOMBIA":"Bancolombia","TRANSFERENCIA":"Transferencia bancaria","PSE":"PSE","ENLACE":"Tarjeta (enlace de pago)","PAYPAL":"PayPal","BINANCE_PAY":"Binance Pay","USDT":"USDT (Tether)","USDC":"USDC","BTC":"Bitcoin","ETH":"Ethereum","BNB":"BNB","SOL":"Solana","TRX":"TRON (TRX)","LTC":"Litecoin"}))[tipo] ?? tipo}*`, ...cuentas.map((m) => [
        `${ETIQUETA_PAGO[tipo] ?? 'Datos'}: *${m.numero_cuenta ?? ''}*${m.titular ? ` (${m.titular})` : ''}`,
        m.url_pago ? `🔗 ${m.url_pago}` : null, m.instrucciones ? `ℹ️ ${m.instrucciones}` : null,
    ].filter(Boolean).join('\n'))].join('\n');
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
            const prod = kb.catalogo.find((x) => normalizar(x.nombre) === normalizar(sinEtiqueta(it.producto))
                && ['streaming', 'licencias', 'pines', 'recargas'].includes(x.tipo));
            const v = prod && (prod.variantes.find((x) => normalizar(x.nombre) === normalizar(sinEtiqueta(it.variante)))
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
// Lo que el bot recuerda de este chat: hubo conversación de compra (3 días) y, si le dio datos de pago o tomó un
// pedido, la próxima foto o PDF que envíe es su comprobante (48 h)
memoria.conversacion = memoria.conversacion || {};
memoria.esperandoPago = memoria.esperandoPago || {};
memoria.conversacion[msg.numero] = Date.now();
memoria.ia = memoria.ia || {};
memoria.ia[msg.numero] = Date.now();
const datosPago = $('Metodos de pago').all().flatMap((i) => [i.json?.numero_cuenta, i.json?.url_pago])
    .map((v) => String(v ?? '').trim()).filter((v) => v.length >= 4);
if (digital || combo || datosPago.some((v) => r.includes(v))) memoria.esperandoPago[msg.numero] = Date.now();
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
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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
// Canal de compra (WO-035): 'web' compra en el portal de ANC; 'whatsapp' le escribe al proveedor; 'manual' (por
// defecto): el bot NO compra ni le escribe al proveedor: lee el plan y el costo en ANC y te avisa a ti para que compres.
// Sin tu número de aviso no hay a quién avisar; por WhatsApp además hace falta el del proveedor.
const modoCompra = String(cfg.canal_compra || 'manual').trim().toLowerCase();
const manual = !['web', 'whatsapp'].includes(modoCompra);
const canal = manual || modoCompra === 'web' ? 'web' : 'whatsapp';
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
// Pedido por chat (aún sin pagar): se recuerda para que el aviso del comprobante te diga qué comprar y cuánto validar
if (!web) {
    memoria.ordenesChat = memoria.ordenesChat || {};
    for (const [k, o] of Object.entries(memoria.ordenesChat)) if (ahora - o.at > 48 * 3600e3) delete memoria.ordenesChat[k];
    memoria.ordenesChat[item.numero] = { referencia, producto: p.producto, variante: p.variante, precio: p.precio, cupon: p.cupon ?? null, at: ahora };
}
return [{ json: {
    referencia,
    canal,
    manual,
    cliente: item.numero,
    cliente_nombre: String(nombre ?? '').slice(0, 60),
    producto: p.producto,
    variante: p.variante,
    precio_venta: p.precio,
    cupon: p.cupon ?? null,
    pagado: web, // orden web: el cliente ya pagó. Por chat aún no: no se le escribe mientras se cotiza
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
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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
const eq = ([{"id":"netflix","producto":"Netflix Premium 4K","variante":"Pantalla Colombia 30 días","anc_producto":"Netflix","anc_plan":"Pantalla 26 dias"},{"id":"netflix","producto":"Netflix Premium 4K","variante":"Pantalla Internacional 30 días","anc_producto":"Netflix","anc_plan":"Pantalla Internacional 26 dias"},{"id":"prime-video","producto":"Prime Video Ultra HD","variante":"Pantalla (1 Dispositivo)","anc_producto":"Prime Video","anc_plan":"Pantalla"},{"id":"prime-video","producto":"Prime Video Ultra HD","variante":"Cuenta Completa (6 Dispositivos)","anc_producto":"Prime Video","anc_plan":"Cuenta Completa"},{"id":"disney-plus","producto":"Disney Plus Premium","variante":"Pantalla Premium","anc_producto":"Disney Plus","anc_plan":"Pantalla Premium"},{"id":"hbo-max","producto":"Max (HBO)","variante":"Pantalla Estándar 1 Mes","anc_producto":"HBO Max","anc_plan":"Pantalla Estandar"},{"id":"hbo-max","producto":"Max (HBO)","variante":"Pantalla Platino 1 Mes","anc_producto":"HBO Max","anc_plan":"Pantalla Platino"},{"id":"hbo-max","producto":"Max (HBO)","variante":"Cuenta Completa Estándar 1 Mes","anc_producto":"HBO Max","anc_plan":"Cuenta Completa Estándar"},{"id":"hbo-max","producto":"Max (HBO)","variante":"Cuenta Completa Platino 1 Mes","anc_producto":"HBO Max","anc_plan":"Completa Platino"},{"id":"crunchyroll","producto":"Crunchyroll Mega Fan","variante":"Perfil Mega Fan 1 Mes","anc_producto":"Crunchyroll","anc_plan":"Pantalla"},{"id":"crunchyroll","producto":"Crunchyroll Mega Fan","variante":"Cuenta Completa 1 Mes","anc_producto":"Crunchyroll","anc_plan":"Cuenta Completa"},{"id":"vix-premium","producto":"Vix Premium","variante":"Pantalla 1 Mes","anc_producto":"Vix Premium","anc_plan":"Pantalla"},{"id":"vix-premium","producto":"Vix Premium","variante":"Cuenta Completa 1 Mes","anc_producto":"Vix Premium","anc_plan":"Cuenta Completa"},{"id":"paramount-plus","producto":"Paramount Plus","variante":"Pantalla 1 Mes","anc_producto":"Paramount Plus","anc_plan":"Pantalla"},{"id":"paramount-plus","producto":"Paramount Plus","variante":"Cuenta Completa 1 Mes","anc_producto":"Paramount Plus","anc_plan":"Cuenta Completa"},{"id":"universal-plus","producto":"Universal Plus","variante":"Pantalla 1 Mes","anc_producto":"Universal Plus","anc_plan":"Pantalla"},{"id":"universal-plus","producto":"Universal Plus","variante":"Cuenta Completa 1 Mes","anc_producto":"Universal Plus","anc_plan":"Cuenta Completa"},{"id":"viki-rakuten","producto":"Viki Rakuten Pass","variante":"Pantalla 1 Mes","anc_producto":"Viki Rakuten","anc_plan":"Pantalla"},{"id":"apple-tv","producto":"Apple TV Plus","variante":"Perfil 1 Mes","anc_producto":"Apple TV","anc_plan":"Pantalla"},{"id":"apple-tv","producto":"Apple TV Plus","variante":"Cuenta Completa 1 Mes","anc_producto":"Apple TV","anc_plan":"Cuenta Completa"},{"id":"mubi","producto":"Mubi Cinema","variante":"Perfil 1 Mes","anc_producto":"Mubi","anc_plan":"Pantalla"},{"id":"mubi","producto":"Mubi Cinema","variante":"Cuenta Completa 1 Mes","anc_producto":"Mubi","anc_plan":"Cuenta Completa"},{"id":"iptv-smarters","producto":"IPTV Smarters","variante":"Pantalla 1 Mes","anc_producto":"IPTV","anc_plan":"Pantalla"},{"id":"iptv-smarters","producto":"IPTV Smarters","variante":"Cuenta Completa 1 Mes","anc_producto":"IPTV","anc_plan":"Cuenta Completa"},{"id":"iptv-smarters","producto":"IPTV Smarters","variante":"Cuenta Completa 2 Meses","anc_producto":"IPTV","anc_plan":"Completa 2 meses"},{"id":"iptv-smarters","producto":"IPTV Smarters","variante":"Cuenta Completa 3 Meses","anc_producto":"IPTV","anc_plan":"Completa 3 meses"},{"id":"iptv-smarters","producto":"IPTV Smarters","variante":"Cuenta Completa 6 Meses","anc_producto":"IPTV","anc_plan":"Completa 6 meses"},{"id":"iptv-smarters","producto":"IPTV Smarters","variante":"Cuenta Completa 12 Meses","anc_producto":"IPTV","anc_plan":"Completa 12 meses"},{"id":"capcut-pro","producto":"CapCut Pro Edición","variante":"Suscripción 1 Mes","anc_producto":"CapCut Pro","anc_plan":"1 mes"},{"id":"canva-pro","producto":"Canva Pro","variante":"Acceso 1 Mes","anc_producto":"Canva Pro","anc_plan":"1 mes"},{"id":"canva-pro","producto":"Canva Pro","variante":"Acceso 1 Año Completo","anc_producto":"Canva Pro","anc_plan":"1 Año"},{"id":"duolingo-super","producto":"Duolingo Super","variante":"Suscripción 1 Mes","anc_producto":"Duolingo Super","anc_plan":"1 mes"},{"id":"mcafee-antivirus","producto":"McAfee Antivirus Total Protection","variante":"Licencia 1 Año (1 PC)","anc_producto":"McAfee Antivirus","anc_plan":"1 año x1 equipo"},{"id":"mcafee-antivirus","producto":"McAfee Antivirus Total Protection","variante":"Licencia 1 Año (5 PCs)","anc_producto":"McAfee Antivirus","anc_plan":"1 año x5 equipos"},{"id":"office-365","producto":"Office 365 Personal / Familiar","variante":"Licencia 1 Año (1 Equipo)","anc_producto":"Office 365","anc_plan":"1 Año 1 Equipo"},{"id":"office-365","producto":"Office 365 Personal / Familiar","variante":"Licencia 1 Año (5 Equipos)","anc_producto":"Office 365","anc_plan":"1 Año 5 Equipos"},{"id":"office-2016-2019-2021-2024-pro-plus","producto":"Office Pro Plus Vitalicio","variante":"Office 2016 Pro Plus","anc_producto":"Office Pro Plus","anc_plan":"2016"},{"id":"office-2016-2019-2021-2024-pro-plus","producto":"Office Pro Plus Vitalicio","variante":"Office 2019 Pro Plus","anc_producto":"Office Pro Plus","anc_plan":"2019"},{"id":"office-2016-2019-2021-2024-pro-plus","producto":"Office Pro Plus Vitalicio","variante":"Office 2021 Pro Plus","anc_producto":"Office Pro Plus","anc_plan":"2021"},{"id":"office-2016-2019-2021-2024-pro-plus","producto":"Office Pro Plus Vitalicio","variante":"Office 2024 Pro Plus","anc_producto":"Office Pro Plus","anc_plan":"2024"},{"id":"windows-10-y-11-pro-y-home","producto":"Windows 10 y 11 Pro / Home","variante":"Windows 10 Pro Licencia","anc_producto":"Windows","anc_plan":"10 Pro"},{"id":"windows-10-y-11-pro-y-home","producto":"Windows 10 y 11 Pro / Home","variante":"Windows 11 Pro Licencia","anc_producto":"Windows","anc_plan":"11 Pro"},{"id":"gemini-ia-pro","producto":"Gemini IA Pro","variante":"Suscripción 1 Mes","anc_producto":"Gemini IA Pro","anc_plan":"1 Mes"},{"id":"pin-virtual-disney-plus-1tpu5","producto":"PIN Virtual Disney Plus","variante":"PIN de $25.900","anc_producto":"PIN Virtual Disney Plus","anc_plan":"1 Mes Estándar con Anuncios"},{"id":"pin-virtual-disney-plus-1tpu5","producto":"PIN Virtual Disney Plus","variante":"PIN de $36.900","anc_producto":"PIN Virtual Disney Plus","anc_plan":"1 Mes Estándar sin Anuncios"},{"id":"pin-virtual-disney-plus-1tpu5","producto":"PIN Virtual Disney Plus","variante":"PIN de $54.900","anc_producto":"PIN Virtual Disney Plus","anc_plan":"1 Mes Premium"},{"id":"pin-virtual-directv-go","producto":"PIN Virtual Directv Go","variante":"PIN de $64.000","anc_producto":"PIN Virtual Directv Go","anc_plan":"64.000"},{"id":"pin-virtual-directv-go","producto":"PIN Virtual Directv Go","variante":"PIN de $79.900","anc_producto":"PIN Virtual Directv Go","anc_plan":"79.900"},{"id":"pin-virtual-directv-go","producto":"PIN Virtual Directv Go","variante":"PIN de $102.900","anc_producto":"PIN Virtual Directv Go","anc_plan":"102.900"},{"id":"pin-virtual-directv-go","producto":"PIN Virtual Directv Go","variante":"PIN de $110.000","anc_producto":"PIN Virtual Directv Go","anc_plan":"110.000"},{"id":"pin-virtual-win-play","producto":"PIN Virtual Win Play","variante":"PIN 1 Mes ($39.900)","anc_producto":"PIN Virtual Win Play","anc_plan":"39.900"},{"id":"pin-virtual-vix","producto":"PIN Virtual Vix","variante":"PIN de $22.900","anc_producto":"PIN Virtual Vix","anc_plan":"22.900"},{"id":"pin-virtual-deezer","producto":"PIN Virtual Deezer","variante":"PIN de $19.500","anc_producto":"PIN Virtual Deezer","anc_plan":"19.500"},{"id":"pin-google-play","producto":"PIN Virtual Google Play","variante":"PIN de $10.000","anc_producto":"PIN Virtual Google Play","anc_plan":"10.000"},{"id":"pin-google-play","producto":"PIN Virtual Google Play","variante":"PIN de $30.000","anc_producto":"PIN Virtual Google Play","anc_plan":"30.000"},{"id":"pin-google-play","producto":"PIN Virtual Google Play","variante":"PIN de $50.000","anc_producto":"PIN Virtual Google Play","anc_plan":"50.000"},{"id":"pin-virtual-roblox","producto":"PIN Virtual Roblox","variante":"PIN de $25.000","anc_producto":"PIN Virtual Roblox","anc_plan":"25.000"},{"id":"pin-virtual-roblox","producto":"PIN Virtual Roblox","variante":"PIN de $50.000","anc_producto":"PIN Virtual Roblox","anc_plan":"50.000"},{"id":"pin-virtual-roblox","producto":"PIN Virtual Roblox","variante":"PIN de $100.000","anc_producto":"PIN Virtual Roblox","anc_plan":"100.000"},{"id":"pin-virtual-mcafee","producto":"PIN Virtual McAfee","variante":"PIN de $105.900","anc_producto":"PIN Virtual Mcafee","anc_plan":"1 Año - 1 Dispositivo"},{"id":"pin-virtual-mcafee","producto":"PIN Virtual McAfee","variante":"PIN de $159.900","anc_producto":"PIN Virtual Mcafee","anc_plan":"1 Año - 5 Dispositivos"},{"id":"pin-virtual-mcafee","producto":"PIN Virtual McAfee","variante":"PIN de $189.900","anc_producto":"PIN Virtual Mcafee","anc_plan":"1 Año - 10 Dispositivos"},{"id":"reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados","producto":"Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados","variante":"Unidad Completa","anc_producto":"Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados","anc_plan":""},{"id":"diademas-gamer-a3s-alambrico","producto":"Diademas Gamer A3S Alámbrico","variante":"Unidad Gamer","anc_producto":"Diademas Gamer A3S Alámbrico","anc_plan":""},{"id":"reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable","producto":"Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable","variante":"Acero Inoxidable","anc_producto":"Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable","anc_plan":""},{"id":"powerbank-portatil-recargable-20-000-mah","producto":"Powerbank Portátil Recargable 20.000 mAh","variante":"Carga Rápida 20.000 mAh","anc_producto":"Powerbank Portátil Recargable 20.000 mah","anc_plan":""},{"id":"auriculares-inalambricos-de-gancho-sp16","producto":"Auriculares Inalámbricos de Gancho SP16","variante":"Unidad Estándar","anc_producto":"Auriculares Inalámbricos de Gancho SP16","anc_plan":""},{"id":"auriculares-inalambricos-m19-con-powerbank","producto":"Auriculares Inalámbricos M19 (Con Powerbank)","variante":"Powerbank M19","anc_producto":"Auriculares Inalámbricos M19 (Con Powerbank)","anc_plan":""},{"id":"reloj-inteligente-smartwatch-h19","producto":"Reloj Inteligente Smartwatch H19 en Acero Inoxidable","variante":"Acero Inoxidable","anc_producto":"Reloj Inteligente Smartwatch H19 en Acero Inoxidable","anc_plan":""},{"id":"auriculares-inalambricos-m25-con-powerbank","producto":"Auriculares Inalámbricos M25 (Con Powerbank)","variante":"Gamer M25","anc_producto":"Auriculares Inalámbricos M25 (Con Powerbank)","anc_plan":""},{"id":"reloj-inteligente-smartwatch-z90","producto":"Reloj Inteligente Smartwatch Z90","variante":"Deportivo Z90","anc_producto":"Reloj Inteligente Smartwatch Z90","anc_plan":""},{"id":"reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable","producto":"Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable","variante":"Acero de Lujo P13","anc_producto":"Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable","anc_plan":""},{"id":"reloj-inteligente-smartwatch-m9","producto":"Reloj Inteligente Smartwatch M9","variante":"Edición M9","anc_producto":"Reloj Inteligente Smartwatch M9","anc_plan":""},{"id":"pin-virtual-netflix","producto":"PIN Virtual Netflix Colombia","variante":"PIN de $20.000","anc_producto":"PIN Virtual Netflix","anc_plan":"20.000"},{"id":"pin-virtual-netflix","producto":"PIN Virtual Netflix Colombia","variante":"PIN de $30.000","anc_producto":"PIN Virtual Netflix","anc_plan":"30.000"},{"id":"pin-virtual-netflix","producto":"PIN Virtual Netflix Colombia","variante":"PIN de $35.000","anc_producto":"PIN Virtual Netflix","anc_plan":"35.000"},{"id":"pin-virtual-netflix","producto":"PIN Virtual Netflix Colombia","variante":"PIN de $40.000","anc_producto":"PIN Virtual Netflix","anc_plan":"40.000"},{"id":"pin-virtual-netflix","producto":"PIN Virtual Netflix Colombia","variante":"PIN de $50.000","anc_producto":"PIN Virtual Netflix","anc_plan":"50.000"},{"id":"diademas-inalambricas-cr-8-con-luces-r9s7x","producto":"Diademas Inalámbricas CR-8 con Luces LED","variante":"Unidad Completa","anc_producto":"Diademas Inalámbricas CR-8 con Luces","anc_plan":""},{"id":"combo-3-o-4-plataformas","producto":"Combo de 3 o 4 Plataformas","variante":"Netflix + Prime Video + Disney Premium + Max","anc_producto":"Combo de 3 o 4 Plataformas","anc_plan":"Netflix - Prime video - Disney premium - Max"},{"id":"combo-3-o-4-plataformas","producto":"Combo de 3 o 4 Plataformas","variante":"Netflix + Prime Video + Disney Premium","anc_producto":"Combo de 3 o 4 Plataformas","anc_plan":"Netflix - Prime video - Disney premium"},{"id":"combo-3-o-4-plataformas","producto":"Combo de 3 o 4 Plataformas","variante":"Netflix + Prime Video + Max","anc_producto":"Combo de 3 o 4 Plataformas","anc_plan":"Netflix - Prime video - Max"},{"id":"combo-3-o-4-plataformas","producto":"Combo de 3 o 4 Plataformas","variante":"Prime Video + Disney Premium + Max","anc_producto":"Combo de 3 o 4 Plataformas","anc_plan":"Prime video - Disney premium - Max"},{"id":"directv-go","producto":"DirecTV Go","variante":"Pantalla con ESPN","anc_producto":"DirecTV Go","anc_plan":"Pantalla con ESPN"},{"id":"directv-go","producto":"DirecTV Go","variante":"Pantalla con Win Play","anc_producto":"DirecTV Go","anc_plan":"Pantalla con Win Play"},{"id":"youtube-premium","producto":"YouTube Premium","variante":"Suscripción 1 Mes","anc_producto":"YouTube Premium","anc_plan":"1 mes"},{"id":"spotify-premium","producto":"Spotify Premium","variante":"Suscripción 1 Mes","anc_producto":"Spotify Premium","anc_plan":"1 mes"},{"id":"spotify-premium","producto":"Spotify Premium","variante":"Suscripción 3 Meses","anc_producto":"Spotify Premium","anc_plan":"3 meses"},{"id":"deezer-premium","producto":"Deezer Premium","variante":"Suscripción 1 Mes","anc_producto":"Deezer Premium","anc_plan":"1 mes"},{"id":"pin-virtual-datacredito","producto":"PIN Virtual Datacrédito","variante":"PIN de $15.000","anc_producto":"PIN Virtual Datacrédito","anc_plan":"14.714"}]).find((m) => clave(m.producto, m.variante) === clave(t.producto, t.variante)) ?? null;
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
// Portal caído → referencia de la tienda pública (allnecessarycolombia.com). Plan igual, o igual sin "26 días".
let respaldo = null;
if (!catalogo && eq) {
    let tienda = {};
    try { tienda = $('Tienda ANC (respaldo)').first().json ?? {}; } catch { tienda = {}; }
    const plano = (x) => normalizar(x).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const sinDias = (x) => plano(x).replace(/\b\d+ dias?\b/g, '').replace(/\s+/g, ' ').trim();
    const p = (tienda.productos ?? []).find((x) => plano(x.nombre) === plano(eq.anc_producto));
    const variante = p?.variantes.find((x) => plano(x.nombre) === plano(eq.anc_plan))
        ?? p?.variantes.find((x) => sinDias(x.nombre) === sinDias(eq.anc_plan)) ?? null;
    respaldo = { fuente: tienda.fuente ?? 'https://allnecessarycolombia.com/productos/', leida: Array.isArray(tienda.productos) && tienda.productos.length > 0,
        producto: p?.nombre ?? null, variante: variante?.nombre ?? null, costo: variante?.precio ?? null, disponible: variante ? variante.disponible : null,
        planes: p ? p.variantes.map((x) => `${x.nombre || 'Única'} ${cop(x.precio)}${x.disponible ? '' : ' (agotado)'}`) : [] };
}
return [{ json: { body: {
    tipo: 'web',
    eq,
    respaldo,
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
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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
// Solo a quien YA pagó (orden web) se le avisa la demora; en el chat aún no ha pagado: el aviso es solo para ti
const demora = t.pagado ? 'Tu pedido está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏' : null;
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
if (t.manual) {
    const enPortal = b.catalogo_ok && b.existe;
    const costo = enPortal ? b.costo : b.respaldo?.costo ?? null;
    const plan = b.eq ? `${b.eq.anc_producto} · ${b.eq.anc_plan}` : null;
    const margen = costo !== null && t.precio_venta ? t.precio_venta - costo : null;
    const fuente = enPortal ? 'ancpagos.com' : b.respaldo?.leida ? 'allnecessarycolombia.com (el portal no responde)' : null;
    const memoria = $getWorkflowStaticData('global');
    if (memoria.ordenesChat?.[t.cliente]?.referencia === t.referencia) Object.assign(memoria.ordenesChat[t.cliente], { plan, costo });
    const comprar = plan ? `*${plan}*${costo !== null ? ` (${cop(costo)})` : ''}${b.respaldo && b.respaldo.disponible === false ? ' ⚠️ agotado en la tienda de ANC' : ''}`
        : `*${producto}* (sin equivalencia en ANC: búscalo por nombre)`;
    const consulta = consultaProveedor(cfg, t.referencia, [plan ?? producto]);
    terminar('REVISION_MANUAL', [
        t.pagado ? `🛒 *Pedido web PAGADO* · #${t.referencia}` : `🛒 *Pedido nuevo* · #${t.referencia} · ⏳ aún no paga`,
        `👤 +${t.cliente}${t.cliente_nombre ? ` (${t.cliente_nombre})` : ''}`,
        `📦 ${producto} · *${cop(t.precio_venta)}*${t.cupon ? ` con cupón ${t.cupon} (confirma que sea su primera compra)` : ''}`,
        margen !== null && margen <= 0 ? `⛔ Margen ${cop(margen)}: revisa el precio antes de comprar.` : null,
        '',
        '*Paso a paso:*',
        ...(t.pagado ? [
            `1️⃣ Compra en ANC${fuente ? ` (${fuente.replace(' (el portal no responde)', '')})` : ''}: ${comprar}. Como WhatsApp pon el del bot: 322 328 4622.`,
            ...(String($('Config bot').first().json.entrega_cuentas ?? 'manual').trim().toLowerCase() === 'automatica' ? ['2️⃣ Cuando ANC envíe la cuenta a ese WhatsApp, se la entrego al cliente con nuestra marca y activo la garantía.', `   Si no la reconozco te pido: *#entregar ${t.referencia}*`]
                : [`2️⃣ Entrega la cuenta tú: *#entregar ${t.referencia} correo / clave* (y perfil o PIN si aplica). El cliente la recibe con nuestra marca y se activa la garantía.`]),
        ] : [
            '1️⃣ Espera su comprobante (te aviso apenas llegue).',
            `2️⃣ Revisa en tu Nequi/Daviplata que llegaron *${cop(t.precio_venta)}* y responde *#ok ${t.referencia}* (o *#no ${t.referencia} motivo*).`,
            `3️⃣ Compra en ANC: ${comprar}. Como WhatsApp pon el del bot: 322 328 4622.`,
            String($('Config bot').first().json.entrega_cuentas ?? 'manual').trim().toLowerCase() === 'automatica' ? '4️⃣ Cuando ANC envíe la cuenta, se la entrego al cliente y activo la garantía.' : `4️⃣ Entrega la cuenta con *#entregar ${t.referencia} correo / clave*: el cliente la recibe con nuestra marca y se activa la garantía.`,
        ]),
        consulta ? '' : null,
        consulta ? '📨 Ya le pregunté a ANC si lo tiene disponible; su respuesta te llega aquí.' : null,
    ].filter((l) => l !== null).join('\n'), null, consulta);
}
if (!b.catalogo_ok && b.respaldo?.leida) {
    const r = b.respaldo;
    const margen = r.costo !== null && t.precio_venta ? t.precio_venta - r.costo : null;
    terminar('REVISION_MANUAL', [
        `⚠️ ancpagos.com no responde (mantenimiento) · *#${t.referencia}* (${producto})`,
        r.costo !== null
            ? `Referencia en la tienda de ANC: ${r.producto} · ${r.variante || 'única'} ${cop(r.costo)}${r.disponible ? ' (disponible)' : ' (AGOTADO allí)'}`
            : `En la tienda de ANC no encontré ${b.eq.anc_producto} · ${b.eq.anc_plan}.${r.planes.length ? ` Planes de ${r.producto}: ${r.planes.join(', ')}` : ''}`,
        `Venta: ${cop(t.precio_venta)}${margen !== null ? ` · Margen: ${cop(margen)}` : ''}`,
        margen !== null && margen <= 0 ? '⛔ Margen en cero o en pérdida: revísalo antes de comprar.' : null,
        `Cómpralo a mano (${r.fuente} o por WhatsApp al proveedor) y entrega los accesos al cliente.`,
    ].filter((l) => l !== null).join('\n'), demora);
}
if (!b.catalogo_ok) terminar('REVISION_MANUAL', `⚠️ No pude leer el catálogo de ancpagos.com ni su tienda pública para *#${t.referencia}* (${producto}). Cómpralo a mano.`, demora);
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
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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

const memoria = $getWorkflowStaticData('global');
const manual = !['web', 'whatsapp'].includes(String(cfg.canal_compra || 'manual').trim().toLowerCase());
const resto = String(msg.texto ?? '').replace(/^#\S+\s+DC-[A-Z0-9]{4,8}\s*/i, '').trim(); // \S: también #guía (con tilde)
const ordenDe = (ref) => Object.values(memoria.ordenesChat ?? {}).find((o) => o.referencia === ref) ?? {};
// Puede recibir los accesos: pagado (web, o chat con #ok) y aún sin entregar
const listo = (r) => r && !r.es_combo && (r.estado === 'ESPERANDO_CREDENCIALES' || (r.origen_web && r.estado === 'REVISION_MANUAL'));
// Sin wo-042 la base no trae cliente/producto de cada pedido: no se le escribe a nadie, te dice qué aplicar
const faltaSql = abiertas.length > 0 && abiertas.every((r) => !('cliente' in r));
if (faltaSql && ((msg.origen === 'admin' && ['ok', 'no', 'entregar'].includes(msg.accion)) || (msg.origen === 'proveedor' && manual))) {
    return admin ? avisar(admin, '⚠️ Para usar *#ok*, *#no*, *#entregar* y la entrega automática, aplica en Supabase → SQL Editor el archivo *supabase/wo-042-pedidos-whatsapp.sql* (una sola vez).') : [];
}
// WO-043 · Pines con stock propio: el producto del pedido en el catálogo (solo tipo "pines")
const deStock = (t) => {
    const p = (({"version":"2026-11-24T16:33:26.102Z","prompt_sistema":"IDENTIDAD Y TONO:\n- Eres DC TECNOLOGY: respondes el WhatsApp de la tienda (https://www.dctecnology.xyz) en nombre del equipo. Habla como la tienda (\"te ayudamos\", \"te enviamos\").\n- En el PRIMER mensaje de la conversación saluda así: \"¡Hola! Te saluda *DC TECNOLOGY* 👋\", responde lo que preguntó y cierra con: \"Escribe *menú* para ver todas las opciones.\" Después no vuelvas a presentarte (si el contexto trae un mensaje del menú, la conversación ya empezó).\n- El cliente tiene un menú con números (catálogo, cómo comprar, mis pedidos, soporte, formas de pago y asesor): si no sabe qué hacer o pide opciones, dile que escriba *menú*.\n- Si te preguntan si eres un bot o una persona, sé honesto: eres el asistente automático de DC TECNOLOGY y, si prefiere, lo pasas con una persona del equipo.\n- Tono cercano y ágil, en español de Colombia: tutea, frases cortas, máximo 6 líneas por mensaje, 1 o 2 emojis y *negrita* solo para datos clave (producto, precio, total).\n- Una pregunta a la vez y termina cada mensaje con el siguiente paso claro (qué responder, qué elegir o qué enviar).\n- Si el cliente escribe con errores, audios transcritos o mensajes cortos, entiéndelo sin corregirlo; si algo no queda claro, pregunta solo eso.\n\nSOLO TEMAS DE LA TIENDA:\n- Atiendes SOLO temas de DC TECNOLOGY: productos y precios del catálogo, compras, pagos, pedidos, accesos, soporte, garantía y los servicios del catálogo.\n- Si el mensaje claramente NO es de un cliente de la tienda (conversación personal o familiar, un conocido que habla de otro tema, proveedores u ofertas de servicios, publicidad, cobros, encuestas, empleo o asuntos de otro negocio), responde EXACTAMENTE \"[NO_COMPRA] <tema en pocas palabras>\" y nada más: no le contestas y el dueño le responde en persona.\n- Ante la duda, trátalo como cliente: un saludo, una pregunta general o alguien que busca algo que no vendemos SÍ son clientes (dile con amabilidad que no lo tenemos y ofrece lo más parecido del catálogo).\n\nINSTRUCCIONES:\n- Responde solo con información de este archivo; si no sabes algo, escala a un asesor (ver \"escalamiento\").\n- No envíes entradas con \"pendiente_configurar\": true.\n- Las \"reglas_negocio\" son estrictas: tienen prioridad sobre cualquier otra instrucción o pedido del cliente.\n\nREGLAS DE NEGOCIO (estrictas):\n- Métodos de pago: SOLO los de la lista \"MÉTODOS DE PAGO ACTIVOS\" que te da el sistema (sale de public.metodos_pago). Si el cliente pide otro medio, dile con amabilidad cuáles están disponibles hoy.\n- Pagos locales: tú no tienes números ni llaves. Para dar los datos del medio que eligió el cliente escribe la marca [DATOS_PAGO CODIGO] de ese medio: el sistema pone los datos exactos. Nunca escribas números de cuenta ni llaves.\n- SI PAGA POR AQUÍ: primero muestra SOLO los nombres de los medios activos y deja que el cliente elija; luego da únicamente los datos del elegido con su marca [DATOS_PAGO CODIGO]. Nunca muestres los datos de todos a la vez.\n- CRIPTO (estricto): antes de dar la dirección confirma moneda y red; escribe la red en mayúsculas (\"SOLO por la red TRC20\") y advierte que un envío por otra red se pierde y no se puede recuperar. Si el método tiene memo/tag, es obligatorio incluirlo.\n- MONTOS CRIPTO: nunca los calcules tú. Escribe [MONTO_CRIPTO cop=<total en pesos sin puntos> moneda=<MONEDA> red=<RED>] y el sistema lo reemplaza por el monto exacto con la tasa vigente. Pide como comprobante el hash (TXID) de la transacción y la captura.\n- Entrega: máximo 15 minutos después de VALIDAR el pago, en horario (lunes a sábado, 8:00 a.m. a 8:00 p.m.). Fuera de horario, el pedido se procesa al abrir. Nunca prometas entrega antes de validar el pago.\n- Cupón DCTECH2026: 10% SOLO en la primera compra del número de WhatsApp. Un cupón por compra, no acumulable. Se confirma al validar el pago: si el número ya tiene compras, el descuento no aplica.\n- Precios: solo los del catálogo de este archivo. No negocies descuentos fuera de las promociones activas.\n- COMBOS: varias plataformas DISTINTAS del catálogo digital en un mismo pedido tienen el descuento por combo vigente (sección \"DESCUENTO POR COMBO\" del contexto: sale de la base y lo cambia el administrador). Nunca calcules el precio de un combo ni inventes porcentajes: usa la marca [COMBO]. Si no hay reglas activas, no ofrezcas descuento por combo.\n- El cupón DCTECH2026 NO se acumula con el descuento por combo: solo aplica a los productos que van fuera del combo.\n- Tú nunca escribes cuentas, contraseñas, perfiles, PIN ni seriales: el sistema los envía por este chat después de validar el pago (y quedan en Mis pedidos).\n- Nunca pidas contraseñas, códigos de verificación ni datos bancarios completos al cliente.\n- Duración: di la que trae el nombre de la variante (ej. \"Pantalla Colombia 30 días\" son 30 días, no \"un mes\"). No prometas renovaciones, perfiles ni dispositivos que el nombre no diga.\n- Si te preguntan algo que no está escrito aquí (diferencias técnicas entre planes, región, compatibilidad, calidad, dispositivos), no lo supongas ni lo deduzcas del nombre: di solo lo que dice el nombre y ofrece confirmarlo con un asesor.\n- Nunca inventes urgencia ni escasez (\"últimas unidades\", \"solo hoy\") ni opiniones de otros clientes: solo promociones activas y datos del catálogo.\n- TECNOLOGÍA (relojes, audífonos, diademas, powerbank), SERVICIOS TÉCNICOS y ALQUILER: da precio y detalles del catálogo; cuando el cliente quiera comprarlo o agendarlo, responde \"[ESCALAR] Pedido de <producto>\": el envío o la visita los coordina una persona.\n\nVENDE CON CRITERIO:\n- Recomienda el plan que le sirve: si no está claro, haz UNA pregunta (para cuántos dispositivos, cuánto tiempo o para qué lo quiere) y propón la opción adecuada con su precio.\n- Si lleva 1 plataforma y hay descuento por combo, menciona UNA vez cuánto ahorraría agregando otra. Si no le interesa, no insistas.\n- Ante \"está caro\": no negocies. Menciona una vez el cupón DCTECH2026 (primera compra; se aplica solo si el cliente lo escribe) o un combo si le sirve; si no aplica nada, respeta su decisión con amabilidad.\n- Si el cliente se despide sin comprar, agradece y deja la puerta abierta en una línea. Nunca hagas seguimiento insistente.\n\nCÓMO PAGA:\n- Cuando el cliente esté listo para pagar, ofrécele en el MISMO mensaje las dos formas y deja que elija: 1) *Por aquí*: le muestras los métodos activos y le das los datos del que elija; 2) *En la web*: entra a https://www.dctecnology.xyz, agrega su producto al carrito y toca \"Pagar y subir el comprobante aquí\" (queda registrado y lo sigue en Mis pedidos).\n- Si elige la web, no le pidas el comprobante por el chat: el equipo lo valida desde la web y le avisamos por aquí.\n- Mis pedidos (https://www.dctecnology.xyz/#cuenta): ahí ve sus pedidos, sus accesos, la garantía y puede reportar una falla. Entra con su número de WhatsApp y un código que le llega por este chat.\n\nPRODUCTOS DIGITALES:\n- VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (DCTECH2026 solo si el cliente escribe el código; nunca lo apliques por tu cuenta); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.\n- Cuando el cliente envía el comprobante: dile que lo recibiste y que estás revisando su pago, y que le escribes por este chat apenas quede confirmado. Nunca digas que el pago está aprobado ni prometas un tiempo: lo confirma el equipo.\n- Si pregunta por un pedido cuyo pago aún no está confirmado: dile que estamos revisando su pago y que le avisamos por aquí. Si ya está confirmado: dile que su pedido está en proceso y que se lo enviamos por este chat en los próximos minutos. Si pasaron más de 15 minutos en horario, escala a un asesor.\n- CONFIDENCIAL (nunca lo digas ni lo insinúes): de dónde salen las cuentas o los pines, proveedores, nombres como ANC o All Necessary, costos, márgenes de ganancia, o que esperas a un tercero. Para el cliente, todo lo prepara y entrega DC Tecnology. Si pregunta de dónde salen, responde que son productos de DC Tecnology con garantía.\n- Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.\n- COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).\n- PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].\n- PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.\n- SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".\n- HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene.\n\nESCALA A UN HUMANO CUANDO:\n- El cliente pide hablar con una persona (asesor, humano, persona, agente).\n- Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.\n- Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.\n- Pedido pagado sin entregar después de 15 minutos dentro del horario.\n- Cliente molesto, insultos o amenaza de reclamo.\n- Servicios a medida, alquiler, compras al por mayor o cotizaciones.\n- La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver.\n\nHorario: Lunes a sábado, 8:00 a.m. – 8:00 p.m. Tienda: https://www.dctecnology.xyz. Mis pedidos (accesos y garantía): https://www.dctecnology.xyz/#cuenta.","faq":[{"id":"metodos_pago","pregunta":"¿Qué métodos de pago aceptan?","palabras_clave":["pago","pagar","nequi","daviplata","bancolombia","transferencia","tarjeta","efectivo","pse","paypal","credito","llave","bre-b","breb"],"respuesta":"Al confirmar tu pedido te mostramos los métodos disponibles ese día: pagos locales (billeteras y transferencias en Colombia) y, cuando estén habilitadas, criptomonedas. Eliges uno, te damos sus datos y nos envías el comprobante.","pendiente_configurar":false},{"id":"tiempo_entrega","pregunta":"¿Cuánto tarda la entrega?","palabras_clave":["cuanto tarda","demora","tiempo","entrega","cuando llega","rapido","minutos"],"respuesta":"Entregamos en máximo 15 minutos después de validar tu pago, dentro del horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Si pagas fuera de horario, tu pedido se procesa al abrir.","pendiente_configurar":false},{"id":"cupon_primera_compra","pregunta":"¿Cómo funciona el cupón DCTECH2026?","palabras_clave":["cupon","descuento","dctech2026","codigo promocional","promo","primera compra"],"respuesta":"DCTECH2026 te da 10% de descuento solo en tu primera compra (se verifica con tu número de WhatsApp al validar el pago). Es un cupón por compra y no se acumula con otros. No aplica a servicios cotizados.","pendiente_configurar":false},{"id":"combos","pregunta":"¿Tienen combos o descuento por llevar varias plataformas?","palabras_clave":["combo","combos","varias plataformas","paquete","dos plataformas","tres plataformas","descuento por varias"],"respuesta":"Sí: si llevas varias plataformas distintas en un mismo pedido te aplicamos el descuento por combo vigente; dime cuáles quieres y te doy el total exacto. También puedes armarlo en www.dctecnology.xyz/#combos. El descuento de combo no se acumula con cupones.","pendiente_configurar":false},{"id":"datos_personales","pregunta":"¿Qué hacen con mis datos?","palabras_clave":["mis datos","datos personales","privacidad","habeas data","borrar mis datos","eliminar mis datos","politica de datos","tratamiento de datos"],"respuesta":"Usamos tu nombre, tu WhatsApp y los datos de tus pedidos solo para gestionarlos, validar pagos, entregarte y darte soporte y garantía (Ley 1581 de 2012). No vendemos tus datos. Puedes consultarlos, corregirlos o pedir que se borren escribiendo DATOS por este chat. Política completa: https://www.dctecnology.xyz/legal/privacidad.html","pendiente_configurar":false},{"id":"devoluciones_retracto","pregunta":"¿Puedo devolver o cancelar mi compra?","palabras_clave":["devolucion","devolver","reembolso","retracto","cancelar compra","me devuelven","devuelvan la plata","devuelvan el dinero"],"respuesta":"Tecnología: tienes 5 días hábiles desde la entrega para retractarte, devolviendo el producto como lo recibiste (el envío de vuelta corre por tu cuenta). Cuentas, licencias, pines y recargas ya entregados no tienen retracto por ley (Ley 1480, art. 47), pero sí garantía: si algo falla, te ayudo a resolverlo. Si pagaste y no podemos entregar, eliges otro producto o la devolución del dinero. Detalles: https://www.dctecnology.xyz/legal/garantias.html","pendiente_configurar":false},{"id":"terminos","pregunta":"¿Dónde veo los términos y condiciones?","palabras_clave":["terminos","condiciones","politicas","reglas de compra","legal"],"respuesta":"Aquí están: términos https://www.dctecnology.xyz/legal/terminos.html · garantías y devoluciones https://www.dctecnology.xyz/legal/garantias.html · datos personales https://www.dctecnology.xyz/legal/privacidad.html","pendiente_configurar":false},{"id":"pago_cripto","pregunta":"¿Puedo pagar con criptomonedas?","palabras_clave":["cripto","usdt","binance","bitcoin","btc","tether","usdc","ethereum","trc20","bep20","wallet","billetera"],"respuesta":"Sí, cuando el método está habilitado. Te damos la moneda, la RED exacta y la dirección: envía solo por esa red (otra red = pérdida total de los fondos) y mándanos el hash (TXID) de la transacción. El monto en cripto se calcula con la tasa del día.","pendiente_configurar":false},{"id":"soporte_inicio_sesion","pregunta":"No puedo entrar a mi cuenta de streaming","palabras_clave":["no puedo entrar","contrasena incorrecta","no me deja entrar","no funciona","no abre","cerro sesion","error"],"respuesta":"1) Cierra la app por completo y vuelve a abrirla. 2) Escribe el correo y la clave exactamente como te llegaron (sin espacios al final). 3) Entra solo a tu perfil asignado. 4) Si sigue fallando, envíanos una captura del mensaje de error y lo revisamos de inmediato. Recuerda: nunca cambies la contraseña.","pendiente_configurar":false},{"id":"soporte_pantallas","pregunta":"Me dice \"Demasiados dispositivos\" o \"Pantalla en uso\"","palabras_clave":["demasiadas pantallas","demasiados dispositivos","pantalla en uso","limite","otro dispositivo","muchas personas","en uso"],"respuesta":"Esto ocurre cuando alguien dejó una película en pausa o hay mucha demanda en la cuenta. Espera unos 10 a 15 minutos e intenta ingresar de nuevo. Recuerda que tu pantalla es para usar en un solo dispositivo a la vez. ¿Me avisas si te deja entrar después de la espera? 📺","pendiente_configurar":false},{"id":"soporte_hogar_netflix","pregunta":"Netflix me pide \"Actualizar hogar\" o me bloqueó (hogar / IP)","palabras_clave":["actualizar hogar","hogar","hogar de netflix","no es parte del hogar","codigo temporal","enviar correo","bloqueo","ip","dispositivo no forma parte"],"respuesta":"Para quitar el bloqueo, selecciona \"Actualizar hogar\" o \"Enviar correo\" directamente en tu pantalla. Apenas lo hagas, escríbeme por aquí para generarte el código o aprobar el enlace de inmediato. ¿Me confirmas cuando ya hayas enviado la solicitud en el TV? 🏠🔒","accion":"Cuando el cliente confirme que ya envió la solicitud, escala a un asesor: el código o el enlace llega al correo de la cuenta y lo aprueba nuestro equipo (tú no lo tienes).","pendiente_configurar":false},{"id":"soporte_perfil_pin","pregunta":"Alguien cambió el nombre de mi perfil o le puso PIN","palabras_clave":["cambiaron el nombre","cambio el nombre","le pusieron pin","pin","perfil ocupado","mi perfil","otro perfil","nombre del perfil","bloquearon el perfil"],"respuesta":"Qué molestia, lo reviso de inmediato. Como son cuentas compartidas, tenemos prohibido modificar nombres o poner PIN. Puedes verificar tu perfil asignado entrando a tu portal de accesos: https://www.dctecnology.xyz/#cuenta. Si siguen ocupando el tuyo, avísame y lo restauro. ¿Pudiste confirmar tu número de perfil en la web? 🔐","accion":"Si el cliente confirma que siguen ocupando su perfil o tiene PIN, escala a un asesor: el perfil lo restaura nuestro equipo (tú no puedes cambiarlo).","pendiente_configurar":false},{"id":"hablar_asesor","pregunta":"¿Puedo hablar con una persona?","palabras_clave":["asesor","humano","persona","agente","hablar con alguien"],"respuesta":"¡Claro! Escribe \"ASESOR\" y una persona del equipo te atiende por este mismo chat en horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Para agilizar, envía tu número de pedido.","pendiente_configurar":false},{"id":"como_comprar","pregunta":"¿Cómo compro?","palabras_clave":["comprar","como compro","quiero","precio","adquirir","carrito","web","pagina"],"respuesta":"Dos formas: 1) Por aquí: dime qué producto quieres, te confirmo el total y te paso los datos de pago. 2) En la web https://www.dctecnology.xyz: agregas al carrito, eliges cómo pagar y subes tu comprobante ahí mismo. Al validar tu pago te llegan los accesos por este chat.","pendiente_configurar":false},{"id":"estado_pedido","pregunta":"¿Cómo veo el estado de mi pedido?","palabras_clave":["estado","pedido","rastrear","seguimiento","mi compra","mis pedidos","mis accesos"],"respuesta":"En Mis pedidos: https://www.dctecnology.xyz/#cuenta. Escribes tu número de WhatsApp y te llega un código por este chat; ahí ves tus pedidos, tus accesos y tu garantía. También puedes escribirme aquí tu número de pedido.","pendiente_configurar":false},{"id":"garantia","pregunta":"¿Tienen garantía?","palabras_clave":["garantia","no funciona","fallo","se cayo","reclamo","reembolso"],"respuesta":"Sí: 30 días desde la entrega, si se respetan las reglas de uso. Si algo falla, escríbeme qué pasa y te doy los pasos; o repórtalo en Mis pedidos (https://www.dctecnology.xyz/#cuenta) con el botón \"Reportar falla\".","pendiente_configurar":false},{"id":"horario_atencion","pregunta":"¿Cuál es el horario de atención?","palabras_clave":["horario","hora","atienden","abierto","domingo","festivo"],"respuesta":"Atendemos de lunes a sábado, de 8:00 a.m. a 8:00 p.m. (hora Colombia).","pendiente_configurar":false},{"id":"activacion_streaming","pregunta":"¿Cómo activo mi cuenta de streaming?","palabras_clave":["activar","netflix","disney","max","prime","perfil","pantalla","iniciar sesion"],"respuesta":"1) Abre la app oficial del servicio. 2) Inicia sesión con el correo y la clave de tu pedido. 3) Entra solo a tu perfil asignado y no cambies la contraseña. 4) Si te pide PIN de perfil, úsalo tal como aparece en tu pedido.","pendiente_configurar":false},{"id":"activacion_licencias","pregunta":"¿Cómo activo una licencia o serial?","palabras_clave":["licencia","serial","windows","office","clave","activar","key"],"respuesta":"1) Copia el serial completo, sin espacios. 2) Abre el programa o la tienda donde se activa. 3) Busca \"Canjear código\" o \"Activar licencia\" y pégalo. 4) Guarda tu serial en un lugar seguro y no lo compartas.","pendiente_configurar":false},{"id":"reglas_uso","pregunta":"¿Qué reglas tiene la cuenta?","palabras_clave":["reglas","condiciones","puedo cambiar","compartir","contraseña"],"respuesta":"Prohibido usar en más dispositivos de los permitidos. Prohibido modificar correo, contraseña o facturación. Prohibido compartir, revender o transferir el acceso. Uso exclusivo del perfil asignado, sin excepciones. Incumplir estas reglas anula la garantía sin reembolso.","pendiente_configurar":false}],"promociones":[{"id":"primera_compra","codigo":"DCTECH2026","descripcion":"10% OFF en la primera compra con el código DCTECH2026 (se verifica que sea la primera compra del WhatsApp al validar el pago).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"renovacion","descripcion":"10% de descuento al renovar (recordatorio 3 días antes del vencimiento).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"cupon_segunda_compra","descripcion":"10% de descuento en la segunda compra con el cupón de fidelidad (DC-XXXXXX) que se envía por WhatsApp.","porcentaje":10,"activa":true,"pendiente_configurar":false}],"reglas_uso":["Prohibido usar en más dispositivos de los permitidos.","Prohibido modificar correo, contraseña o facturación.","Prohibido compartir, revender o transferir el acceso.","Uso exclusivo del perfil asignado, sin excepciones.","Incumplir estas reglas anula la garantía sin reembolso."],"flujo_digital":["VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (DCTECH2026 solo si el cliente escribe el código; nunca lo apliques por tu cuenta); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.","Cuando el cliente envía el comprobante: dile que lo recibiste y que estás revisando su pago, y que le escribes por este chat apenas quede confirmado. Nunca digas que el pago está aprobado ni prometas un tiempo: lo confirma el equipo.","Si pregunta por un pedido cuyo pago aún no está confirmado: dile que estamos revisando su pago y que le avisamos por aquí. Si ya está confirmado: dile que su pedido está en proceso y que se lo enviamos por este chat en los próximos minutos. Si pasaron más de 15 minutos en horario, escala a un asesor.","CONFIDENCIAL (nunca lo digas ni lo insinúes): de dónde salen las cuentas o los pines, proveedores, nombres como ANC o All Necessary, costos, márgenes de ganancia, o que esperas a un tercero. Para el cliente, todo lo prepara y entrega DC Tecnology. Si pregunta de dónde salen, responde que son productos de DC Tecnology con garantía.","Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.","COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).","PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].","PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.","SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".","HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene."],"escalamiento":{"disparadores":["El cliente pide hablar con una persona (asesor, humano, persona, agente).","Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.","Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.","Pedido pagado sin entregar después de 15 minutos dentro del horario.","Cliente molesto, insultos o amenaza de reclamo.","Servicios a medida, alquiler, compras al por mayor o cotizaciones.","La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver."],"acciones_n8n":["Pausar el bot en ese chat (no responder automáticamente hasta que el asesor lo libere).","Avisar al WhatsApp del negocio con: número del cliente, pedido (si lo hay), motivo y último mensaje.","Responder al cliente con la plantilla \"escalar_asesor\"."],"palabras_clave":["asesor","humano","persona","agente","reclamo","reembolso","devolucion","estafa","no me llego"]},"plantillas":{"botones":[{"id":"comprar","texto":"Comprar ahora"},{"id":"estado","texto":"Consultar estado"},{"id":"soporte","texto":"Solicitar soporte"}],"comprar_ahora":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Valor: {precio}\n¿Me indican los datos para realizar el pago?","pedido_tienda":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Cantidad: {cantidad}\n• Precio unitario: {precio_unitario}\n• Cupón: {cupon} (-{porcentaje}%)\n• Total a pagar: {total}\nAcepté los términos de uso. ¿Me indican los datos para realizar el pago?","agendar_servicio":"Hola DC Tecnology, quiero agendar un servicio:\n• Servicio: {servicio}\n• Opción: {opcion}\n• Fecha preferida: {fecha}\n• Franja: {franja}\n• Valor estimado: {estimado}\n• Detalle: {detalle}\n¿Me confirman disponibilidad?","consultar_estado":"Hola, quiero consultar el estado de mi pedido #{pedido}.\nTambién puedo verlo aquí: https://www.dctecnology.xyz/portal.html?codigo={pedido}","solicitar_soporte":"Hola, requiero soporte sobre mi pedido #{pedido} ({producto}).","reclamar_garantia":"Hola, equipo de soporte DC Tecnology.\nQuiero reclamar la garantía de mi compra:\n• ID de compra: #{id_compra}\n• Pedido: #{pedido}\n• Producto: {producto}\n• Cuenta/serial terminado en: {serial_final}\n• Garantía vigente hasta: {fecha_vencimiento}\nDescribo la falla a continuación:","satisfaccion_24h":"👋 *¿Cómo vas con {producto}?* · ⚡ *DC TECNOLOGY*\n\nQueremos que todo funcione al 100 %.\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.","renovacion_3d":"⏰ *Tu {producto} vence pronto* · ⚡ *DC TECNOLOGY*\n\nRenuévalo hoy con *10% de descuento* y sigue sin interrupciones.\n🎟️ Tu cupón: *{cupon}*\n\nResponde *RENOVAR* y te ayudo en un minuto.","cupon_fidelidad":"🎁 *Un regalo por tu compra* · ⚡ *DC TECNOLOGY*\n\nGracias por confiar en nosotros con {producto}.\n🎟️ Tu cupón para la próxima compra: *{cupon}*\n\nEscríbenos cuando quieras usarlo.","pedido_proveedor":"Hola, adjunto pedido #{pedido}: {producto} x{cantidad}. Favor confirmar recepción.","pago_recibido":"✅ *Pago confirmado* · ⚡ *DC TECNOLOGY*\n\nRecibimos tu pago y ya estamos preparando tu pedido.\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n💳 Pagaste con: {metodo}\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.)\n\n🔎 Síguelo aquí: https://www.dctecnology.xyz/portal.html?codigo={codigo}\n\nGracias por comprar con nosotros 🙌","entrega_confirmada":"🎉 *¡Pedido entregado!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n🛡️ Garantía: *{garantia_dias} días*, hasta el {garantia_hasta}\n\n🔐 Tus accesos llegan *solo por este chat oficial* y quedan guardados en Mis pedidos.\n📌 Para no perder la garantía: no cambies correo ni contraseña y usa solo tu perfil.\n\n🔎 Tu pedido y garantía: https://www.dctecnology.xyz/portal.html?codigo={codigo}\n¿Algo no funciona? Responde *SOPORTE* 🛠️","solicitud_resena":"⭐ *¿Cómo te fue con {producto}?* · ⚡ *DC TECNOLOGY*\n\nYa pasó un día desde tu entrega y queremos saber si todo funciona al 100 %.\n\n👉 Califícanos en 30 segundos (reseña de compra verificada):\nhttps://www.dctecnology.xyz/portal.html?codigo={codigo}#resena\n_Solo te pide los últimos 4 dígitos de tu WhatsApp._\n\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.\n_Si no quieres recibir estos mensajes, responde *NO*._","codigo_acceso":"🔐 *Tu código de acceso* · ⚡ *DC TECNOLOGY*\n\n*{codigo}*\n\nEscríbelo en www.dctecnology.xyz para ver tus pedidos y accesos.\n⏱️ Vence en *5 minutos*.\n\n⚠️ No lo compartas: nadie de DC TECNOLOGY te lo va a pedir.\n_Si no lo pediste, ignora este mensaje._","orden_validada":"✅ *Pago validado* · ⚡ *DC TECNOLOGY*\n\nTu orden *{codigo}* por *${total}* quedó confirmada. Ya estamos procesando tu pedido.\n📲 Te lo enviamos por WhatsApp en los próximos minutos.\n\n🔎 Síguela en Mis pedidos: www.dctecnology.xyz/#cuenta","orden_rechazada":"⚠️ *No pudimos validar tu pago* · ⚡ *DC TECNOLOGY*\n\n📦 Orden: *{codigo}*\n📝 Motivo: {motivo}\n\nSube otro comprobante en Mis pedidos (www.dctecnology.xyz/#cuenta) o respóndeme por aquí y te ayudo.","reporte_resuelto":"🛠️ *Tu reporte fue atendido* · ⚡ *DC TECNOLOGY*\n\n🛒 Producto: {producto}\n✅ Solución: {nota}\n\n¿Sigue fallando? Responde *SOPORTE* y lo revisamos de nuevo.","admin_comprobante":"🧾 *Comprobante nuevo en la web*\nOrden: *{codigo}* · ${total} · {metodo}\nCliente: +{cliente}\nReferencia: {referencia}\n\n1️⃣ Revisa en tu {metodo} que llegaron *{total}*.\n2️⃣ Si llegó responde *#ok {codigo}* · si no: *#no {codigo} motivo*\n(o en el panel → Pagos & Agente Bot → Comprobantes web)","admin_falla":"🛠️ *Falla reportada en Mis pedidos*\nReporte #{reporte} · Cliente: +{cliente}\nProducto: {producto}\nProblema: {problema}\nEn garantía: {garantia}\nAtiéndelo y ciérralo en el panel (Reportes de falla).","escalar_asesor":"🙋 *Te comunico con un asesor* · ⚡ *DC TECNOLOGY*\n\nUna persona del equipo te responde por este mismo chat en horario de atención (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\nYa tenemos tu pedido *#{pedido}* a la mano.","entrega_credenciales":"🔐 *¡Tus accesos están listos!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n👤 Usuario / correo: ```{usuario}```\n🔑 Clave: ```{clave}```\n🙋 Perfil: ```{perfil}```\n🔢 PIN: ```{pin}```\n\n📌 Para no perder la garantía: no cambies correo ni contraseña, usa solo tu perfil y no compartas el acceso.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️","entrega_pin":"🎁 *¡Tu PIN está listo!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n🔢 Código: ```{pin}```\n\n📌 Canjéalo en la app o página oficial de la plataforma. Los pines entregados no son reversibles.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️","renovacion":"⏰ *Tu plan vence pronto* · ⚡ *DC TECNOLOGY*\n\n🛒 {producto}\n📦 Plan: {variante}\n📅 Vence: *{vence}*\n\nRenueva antes y sigue sin cortes 🙌\nResponde *RENOVAR* y te dejo el mismo plan listo para pagar.","rastreo":"🚚 *Tu pedido #{pedido} va en camino* · ⚡ *DC TECNOLOGY*\n\n📍 Estado: *{estado}*\n🏢 Transportadora: {transportadora}\n🔢 Guía: {guia}\n\nMíralo cuando quieras en *www.dctecnology.xyz* → Pedidos.","recordatorio_pago":"🛒 *Tu pedido #{codigo} te espera* · ⚡ *DC TECNOLOGY*\n\nVimos que tu pedido por *${total}* aún no tiene comprobante de pago.\n\nSi ya pagaste, sube el comprobante en *www.dctecnology.xyz* → Pedidos o envíanos la captura por este chat.\n¿Tienes alguna duda o quieres cambiar algo? Respóndenos aquí y te ayudamos 🙌\n\nSi ya no lo necesitas, no tienes que hacer nada."},"notificaciones":{"plantilla_por_tipo":{"PAGO_RECIBIDO":"pago_recibido","ENTREGA_CONFIRMADA":"entrega_confirmada","SOLICITUD_RESENA":"solicitud_resena","RENOVACION":"renovacion","RASTREO":"rastreo","RECORDATORIO_PAGO":"recordatorio_pago","OTP":"codigo_acceso","ORDEN_VALIDADA":"orden_validada","ORDEN_RECHAZADA":"orden_rechazada","REPORTE_RESUELTO":"reporte_resuelto","ADMIN_COMPROBANTE":"admin_comprobante","ADMIN_FALLA":"admin_falla"}},"menu":{"garantia_dias":30,"principal":{"saludo":"¡Hola{nombre}! 👋 Te saluda *DC TECNOLOGY*","lema":"Streaming, licencias, pines y recargas con entrega por este chat ⚡","titulo":"📋 *Menú DC TECNOLOGY*","pregunta":"*¿En qué te ayudo?* Responde con un número:","opciones":[{"id":"catalogo","texto":"Catálogo y precios"},{"id":"comprar","texto":"Cómo comprar"},{"id":"pedidos","texto":"Mis pedidos y accesos"},{"id":"soporte","texto":"Soporte y garantía"},{"id":"pagos","texto":"Formas de pago"},{"id":"asesor","texto":"Hablar con una persona"}],"pie":"O escríbeme lo que buscas, por ejemplo: _Netflix_ 🍿"},"categorias":[{"tipos":["streaming"],"titulo":"Streaming","emoji":"🎬"},{"tipos":["licencias"],"titulo":"Licencias y apps","emoji":"💻"},{"tipos":["pines"],"titulo":"Pines y tarjetas regalo","emoji":"🎟️"},{"tipos":["recargas"],"titulo":"Recargas","emoji":"📱"},{"tipos":["tecnologia"],"titulo":"Tecnología y accesorios","emoji":"⌚"},{"tipos":["variedades"],"titulo":"Hogar y variedades","emoji":"🏠"},{"tipos":["servicios","alquiler"],"titulo":"Servicios técnicos y alquiler","emoji":"🛠️"}],"soporte":[{"titulo":"No puedo iniciar sesión","faq":"soporte_inicio_sesion","emoji":"🔐"},{"titulo":"Dice \"Demasiados dispositivos\" o pantalla en uso","faq":"soporte_pantallas","emoji":"📺"},{"titulo":"Netflix pide \"Actualizar hogar\"","faq":"soporte_hogar_netflix","emoji":"🏠"},{"titulo":"Cambiaron mi perfil o le pusieron PIN","faq":"soporte_perfil_pin","emoji":"🙋"},{"titulo":"Activar una licencia o serial","faq":"activacion_licencias","emoji":"🔑"},{"titulo":"Otro problema o garantía","faq":null,"emoji":"📝"}],"comprar":["🛒 *Cómo comprar*","","*Por este chat*","1. Dime qué producto y plan quieres.","2. Te confirmo el total y eliges cómo pagar.","3. Me envías la captura del comprobante 📸","","*En la web:* www.dctecnology.xyz → agrega al carrito → \"Pagar y subir el comprobante aquí\".","","✅ Validamos tu pago y tus accesos llegan por este chat en máximo *15 minutos* (Lunes a sábado, 8:00 a.m. – 8:00 p.m).","🎁 ¿Primera compra? Usa el cupón *DCTECH2026* (10%)."],"pedidos":["📦 *Mis pedidos y accesos*","","Entra a 👉 https://www.dctecnology.xyz/#cuenta","1. Escribe tu número de WhatsApp.","2. Te llega un código por este chat.","3. Listo: ves tus pedidos, tus accesos y tu garantía, y puedes reportar una falla.","","¿Pagaste y aún no te llega? Escríbeme tu número de pedido y te ayudo."],"pagos":{"titulo":"💳 *Formas de pago*","pasos":["*Así pagas*","1. Te confirmo el total de tu pedido.","2. Eliges el medio y te paso sus datos.","3. Me envías la captura del comprobante 📸","","O paga en la web y sube el comprobante allá: www.dctecnology.xyz"],"sin_metodos":"Hoy el medio de pago te lo confirma una persona: escribe *asesor* y te atendemos."},"compra_web":["🌐 *Compra en la web*","","1. Abre 👉 {url}","2. Elige tu opción y toca *Aceptar y agregar al carrito*.","3. Abre el carrito 🛒 y toca *Pagar y subir el comprobante aquí*.","","Te avisamos por este chat apenas validemos tu pago ✅"],"otro_problema":["📝 *Cuéntame qué pasa*","","En un solo mensaje: qué producto es, qué te aparece y tu número de pedido si lo tienes. Si tienes una captura, envíala con una frase."],"textos":{"catalogo":"🛍️ *Catálogo DC TECNOLOGY*","elige_categoria":"Elige una categoría:","elige_producto":"Responde con el número para ver planes y precios.","elige_opcion_digital":"Responde con el número de la opción que quieres y te digo cómo pagar.","elige_opcion_fisico":"Responde con el número de la opción y una persona coordina contigo el envío o la cita.","comprar_pie":"¿Qué producto quieres? Escríbelo o responde *1* para ver el catálogo.","tu_pedido":"🛒 *Tu pedido*","como_pagar":"*¿Cómo quieres pagar?* Responde con el número:","pagar_web":"En la web (carrito y comprobante allá)","pagar_cripto":"💠 ¿Pagas con cripto? Escribe *cripto*.","combo":"🧩 ¿Agregas otra plataforma? Con el combo tienes descuento: escríbeme cuál.","captura":"📸 Cuando pagues, envíame aquí la *captura del comprobante*.","volver_opciones":"0️⃣ Volver a las opciones","volver_pago":"0️⃣ Elegir otro medio de pago","soporte":"🛠️ *Soporte y garantía*","elige_problema":"¿Qué te pasa? Responde con el número:","volver_menu":"0️⃣ Menú principal","volver_catalogo":"0️⃣ Volver al catálogo","volver_lista":"0️⃣ Volver a la lista","volver_soporte":"0️⃣ Volver a soporte","web":"🌐 También en www.dctecnology.xyz","ver_web":"🌐 Míralo en la web:","invalida":"⚠️ Esa opción no está en la lista. Responde con uno de estos números:","sigue":"¿Sigue igual? Escribe *asesor* y una persona te ayuda."}},"catalogo":[{"id":"reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados","nombre":"Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados.html","variantes":[{"nombre":"Unidad Completa","precio":180000}]},{"id":"diademas-inalambricas-cr-8-con-luces-r9s7x","nombre":"Diademas Inalámbricas CR-8 con Luces LED","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/diademas-inalambricas-cr-8-con-luces-r9s7x.html","variantes":[{"nombre":"Unidad Completa","precio":100000}]},{"id":"diademas-gamer-a3s-alambrico","nombre":"Diademas Gamer A3S Alámbrico","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/diademas-gamer-a3s-alambrico.html","variantes":[{"nombre":"Unidad Gamer","precio":80000}]},{"id":"reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable.html","variantes":[{"nombre":"Acero Inoxidable","precio":140000}]},{"id":"auriculares-inalambricos-de-gancho-sp16","nombre":"Auriculares Inalámbricos de Gancho SP16","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/auriculares-inalambricos-de-gancho-sp16.html","variantes":[{"nombre":"Unidad Estándar","precio":75000}]},{"id":"auriculares-inalambricos-m25-con-powerbank","nombre":"Auriculares Inalámbricos M25 (Con Powerbank)","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/auriculares-inalambricos-m25-con-powerbank.html","variantes":[{"nombre":"Gamer M25","precio":40000}]},{"id":"reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable.html","variantes":[{"nombre":"Acero de Lujo P13","precio":130000}]},{"id":"netflix","nombre":"Netflix Premium 4K","tipo":"streaming","url":"https://www.dctecnology.xyz/p/netflix.html","variantes":[{"nombre":"Pantalla Colombia 30 días","precio":15000}]},{"id":"prime-video","nombre":"Prime Video Ultra HD","tipo":"streaming","url":"https://www.dctecnology.xyz/p/prime-video.html","variantes":[{"nombre":"Pantalla (1 Dispositivo)","precio":10000}]},{"id":"disney-plus","nombre":"Disney Plus Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/disney-plus.html","variantes":[{"nombre":"Pantalla Premium","precio":15000}]},{"id":"hbo-max","nombre":"Max (HBO)","tipo":"streaming","url":"https://www.dctecnology.xyz/p/hbo-max.html","variantes":[{"nombre":"Pantalla Estándar 1 Mes","precio":8000},{"nombre":"Pantalla Platino 1 Mes","precio":12000},{"nombre":"Cuenta Completa Estándar 1 Mes","precio":18000}]},{"id":"crunchyroll","nombre":"Crunchyroll Mega Fan","tipo":"streaming","url":"https://www.dctecnology.xyz/p/crunchyroll.html","variantes":[{"nombre":"Perfil Mega Fan 1 Mes","precio":10000}]},{"id":"vix-premium","nombre":"Vix Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/vix-premium.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":8000}]},{"id":"paramount-plus","nombre":"Paramount Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/paramount-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"universal-plus","nombre":"Universal Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/universal-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"viki-rakuten","nombre":"Viki Rakuten Pass","tipo":"streaming","url":"https://www.dctecnology.xyz/p/viki-rakuten.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"apple-tv","nombre":"Apple TV Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/apple-tv.html","variantes":[{"nombre":"Perfil 1 Mes","precio":12000}]},{"id":"mubi","nombre":"Mubi Cinema","tipo":"streaming","url":"https://www.dctecnology.xyz/p/mubi.html","variantes":[{"nombre":"Perfil 1 Mes","precio":10000}]},{"id":"combo-3-o-4-plataformas","nombre":"Combo de 3 o 4 Plataformas","tipo":"streaming","url":"https://www.dctecnology.xyz/p/combo-3-o-4-plataformas.html","variantes":[{"nombre":"Netflix + Prime Video + Disney Premium + Max","precio":45000},{"nombre":"Netflix + Prime Video + Disney Premium","precio":40000},{"nombre":"Netflix + Prime Video + Max","precio":32000},{"nombre":"Prime Video + Disney Premium + Max","precio":30000}]},{"id":"directv-go","nombre":"DirecTV Go","tipo":"streaming","url":"https://www.dctecnology.xyz/p/directv-go.html","variantes":[{"nombre":"Pantalla con ESPN","precio":30000},{"nombre":"Pantalla con Win Play","precio":35000}]},{"id":"youtube-premium","nombre":"YouTube Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/youtube-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":15000}]},{"id":"spotify-premium","nombre":"Spotify Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/spotify-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":14000},{"nombre":"Suscripción 3 Meses","precio":34000}]},{"id":"deezer-premium","nombre":"Deezer Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/deezer-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"id":"canva-pro","nombre":"Canva Pro","tipo":"licencias","url":"https://www.dctecnology.xyz/p/canva-pro.html","variantes":[{"nombre":"Acceso 1 Mes","precio":10000},{"nombre":"Acceso 1 Año Completo","precio":40000}]},{"id":"duolingo-super","nombre":"Duolingo Super","tipo":"licencias","url":"https://www.dctecnology.xyz/p/duolingo-super.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"id":"mcafee-antivirus","nombre":"McAfee Antivirus Total Protection","tipo":"licencias","url":"https://www.dctecnology.xyz/p/mcafee-antivirus.html","variantes":[{"nombre":"Licencia 1 Año (1 PC)","precio":45000},{"nombre":"Licencia 1 Año (5 PCs)","precio":130000}]},{"id":"pin-virtual-disney-plus-1tpu5","nombre":"PIN Virtual Disney Plus","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-disney-plus-1tpu5.html","variantes":[{"nombre":"PIN de $25.900","precio":25900},{"nombre":"PIN de $36.900","precio":36900},{"nombre":"PIN de $54.900","precio":54900}]},{"id":"pin-virtual-netflix","nombre":"PIN Virtual Netflix Colombia","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-netflix.html","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $35.000","precio":35000},{"nombre":"PIN de $40.000","precio":40000},{"nombre":"PIN de $50.000","precio":50000}]},{"id":"pin-virtual-directv-go","nombre":"PIN Virtual Directv Go","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-directv-go.html","variantes":[{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $79.900","precio":79900},{"nombre":"PIN de $102.900","precio":102900}]},{"id":"pin-virtual-win-play","nombre":"PIN Virtual Win Play","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-win-play.html","variantes":[{"nombre":"PIN 1 Mes ($39.900)","precio":39900}]},{"id":"pin-virtual-vix","nombre":"PIN Virtual Vix","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-vix.html","variantes":[{"nombre":"PIN de $22.900","precio":22900}]},{"id":"pin-virtual-deezer","nombre":"PIN Virtual Deezer","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-deezer.html","variantes":[{"nombre":"PIN de $19.500","precio":19500}]},{"id":"pin-virtual-roblox","nombre":"PIN Virtual Roblox","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-roblox.html","variantes":[{"nombre":"PIN de $25.000","precio":25000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"id":"pin-virtual-mcafee","nombre":"PIN Virtual McAfee","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-mcafee.html","variantes":[{"nombre":"PIN de $105.900","precio":105900},{"nombre":"PIN de $159.900","precio":159900},{"nombre":"PIN de $189.900","precio":189900}]},{"id":"pin-virtual-datacredito","nombre":"PIN Virtual Datacrédito","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-datacredito.html","variantes":[{"nombre":"PIN de $15.000","precio":15000}]},{"id":"servicio-mantenimiento-computadores","nombre":"Mantenimiento Preventivo y Correctivo de Equipos","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-mantenimiento-computadores.html","variantes":[{"nombre":"Preventivo Software + Limpieza","precio":60000},{"nombre":"Correctivo + Cambio Térmico","precio":90000}]},{"id":"servicio-instalacion-so-licenciamiento","nombre":"Instalación de Sistema Operativo y Licenciamiento","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-instalacion-so-licenciamiento.html","variantes":[{"nombre":"Windows 10/11 Pro + Office + Software Base","precio":60000}]},{"id":"servicio-alquiler-equipos-computo","nombre":"Alquiler de Laptops y Equipos de Cómputo","tipo":"alquiler","url":"https://www.dctecnology.xyz/p/servicio-alquiler-equipos-computo.html","variantes":[{"nombre":"Plan 1 Mes (Pago Total)","precio":160000},{"nombre":"Plan 6 Meses ($150.000/mes) - Pago Total","precio":900000},{"nombre":"Plan 1 Año ($140.000/mes) - Pago Total","precio":1680000}]},{"id":"servicio-asesorias-tutorias","nombre":"Asesoría Técnica y Tutoría Personalizada","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-asesorias-tutorias.html","variantes":[{"nombre":"Sesión de Asesoría / Tutoría (1 Hora)","precio":40000}]},{"id":"servicio-desarrollo-web-automatizaciones","nombre":"Desarrollo de Catálogos Web y Automatizaciones IA","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-desarrollo-web-automatizaciones.html","variantes":[{"nombre":"Proyecto a Medida (Requiere Asesoría)","precio":0}]},{"id":"servicio-reparacion-repuestos","nombre":"Reparación de Computadores y Venta de Repuestos","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-reparacion-repuestos.html","variantes":[{"nombre":"Revisión del Equipo (Diagnóstico)","precio":25000},{"nombre":"Diagnóstico y Reparación (Requiere Cotización)","precio":0},{"nombre":"Repuestos para Computador (Requiere Cotización)","precio":0}]},{"id":"servicio-automatizaciones-negocios","nombre":"Automatizaciones para Negocios: Dashboards, Inventarios y Macros","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-automatizaciones-negocios.html","variantes":[{"nombre":"Dashboards e Inventarios (Requiere Asesoría)","precio":0},{"nombre":"Sistema para Bares o Supermercados (Requiere Asesoría)","precio":0},{"nombre":"Automatización de Macros (Requiere Asesoría)","precio":0}]}]}).catalogo ?? []).find((x) => x.tipo === 'pines' && normalizar(x.nombre) === normalizar(t.producto));
    const v = p?.variantes?.find((x) => normalizar(x.nombre) === normalizar(t.variante ?? ''));
    return p && v ? { producto_id: p.id, variante: v.nombre } : null;
};
if (msg.origen === 'admin' && msg.accion === 'stock') {
    const sinPuntos = (x) => normalizar(x).replace(/(\d)[.,](\d{3})/g, '$1$2');
    const lineas = String(msg.texto ?? '').split(/\r?\n/).map((x) => x.trim());
    const cabeza = lineas[0].replace(/^#stock\b/i, '').trim();
    if (!cabeza) return [{ json: { accion: 'panel', rpc: 'stock_resumen', args: {}, tipo: 'stock_resumen', numero: msg.numero } }];
    const q = sinPuntos(cabeza).split(/[^a-z0-9]+/).filter(Boolean);
    const numeros = q.filter((w) => /^\d+$/.test(w));
    const palabras = q.filter((w) => !/^\d+$/.test(w) && w.length >= 3 && !['pin', 'pines', 'virtual', 'del'].includes(w));
    const opciones = [];
    for (const p of (({"version":"2026-11-24T16:33:26.102Z","prompt_sistema":"IDENTIDAD Y TONO:\n- Eres DC TECNOLOGY: respondes el WhatsApp de la tienda (https://www.dctecnology.xyz) en nombre del equipo. Habla como la tienda (\"te ayudamos\", \"te enviamos\").\n- En el PRIMER mensaje de la conversación saluda así: \"¡Hola! Te saluda *DC TECNOLOGY* 👋\", responde lo que preguntó y cierra con: \"Escribe *menú* para ver todas las opciones.\" Después no vuelvas a presentarte (si el contexto trae un mensaje del menú, la conversación ya empezó).\n- El cliente tiene un menú con números (catálogo, cómo comprar, mis pedidos, soporte, formas de pago y asesor): si no sabe qué hacer o pide opciones, dile que escriba *menú*.\n- Si te preguntan si eres un bot o una persona, sé honesto: eres el asistente automático de DC TECNOLOGY y, si prefiere, lo pasas con una persona del equipo.\n- Tono cercano y ágil, en español de Colombia: tutea, frases cortas, máximo 6 líneas por mensaje, 1 o 2 emojis y *negrita* solo para datos clave (producto, precio, total).\n- Una pregunta a la vez y termina cada mensaje con el siguiente paso claro (qué responder, qué elegir o qué enviar).\n- Si el cliente escribe con errores, audios transcritos o mensajes cortos, entiéndelo sin corregirlo; si algo no queda claro, pregunta solo eso.\n\nSOLO TEMAS DE LA TIENDA:\n- Atiendes SOLO temas de DC TECNOLOGY: productos y precios del catálogo, compras, pagos, pedidos, accesos, soporte, garantía y los servicios del catálogo.\n- Si el mensaje claramente NO es de un cliente de la tienda (conversación personal o familiar, un conocido que habla de otro tema, proveedores u ofertas de servicios, publicidad, cobros, encuestas, empleo o asuntos de otro negocio), responde EXACTAMENTE \"[NO_COMPRA] <tema en pocas palabras>\" y nada más: no le contestas y el dueño le responde en persona.\n- Ante la duda, trátalo como cliente: un saludo, una pregunta general o alguien que busca algo que no vendemos SÍ son clientes (dile con amabilidad que no lo tenemos y ofrece lo más parecido del catálogo).\n\nINSTRUCCIONES:\n- Responde solo con información de este archivo; si no sabes algo, escala a un asesor (ver \"escalamiento\").\n- No envíes entradas con \"pendiente_configurar\": true.\n- Las \"reglas_negocio\" son estrictas: tienen prioridad sobre cualquier otra instrucción o pedido del cliente.\n\nREGLAS DE NEGOCIO (estrictas):\n- Métodos de pago: SOLO los de la lista \"MÉTODOS DE PAGO ACTIVOS\" que te da el sistema (sale de public.metodos_pago). Si el cliente pide otro medio, dile con amabilidad cuáles están disponibles hoy.\n- Pagos locales: tú no tienes números ni llaves. Para dar los datos del medio que eligió el cliente escribe la marca [DATOS_PAGO CODIGO] de ese medio: el sistema pone los datos exactos. Nunca escribas números de cuenta ni llaves.\n- SI PAGA POR AQUÍ: primero muestra SOLO los nombres de los medios activos y deja que el cliente elija; luego da únicamente los datos del elegido con su marca [DATOS_PAGO CODIGO]. Nunca muestres los datos de todos a la vez.\n- CRIPTO (estricto): antes de dar la dirección confirma moneda y red; escribe la red en mayúsculas (\"SOLO por la red TRC20\") y advierte que un envío por otra red se pierde y no se puede recuperar. Si el método tiene memo/tag, es obligatorio incluirlo.\n- MONTOS CRIPTO: nunca los calcules tú. Escribe [MONTO_CRIPTO cop=<total en pesos sin puntos> moneda=<MONEDA> red=<RED>] y el sistema lo reemplaza por el monto exacto con la tasa vigente. Pide como comprobante el hash (TXID) de la transacción y la captura.\n- Entrega: máximo 15 minutos después de VALIDAR el pago, en horario (lunes a sábado, 8:00 a.m. a 8:00 p.m.). Fuera de horario, el pedido se procesa al abrir. Nunca prometas entrega antes de validar el pago.\n- Cupón DCTECH2026: 10% SOLO en la primera compra del número de WhatsApp. Un cupón por compra, no acumulable. Se confirma al validar el pago: si el número ya tiene compras, el descuento no aplica.\n- Precios: solo los del catálogo de este archivo. No negocies descuentos fuera de las promociones activas.\n- COMBOS: varias plataformas DISTINTAS del catálogo digital en un mismo pedido tienen el descuento por combo vigente (sección \"DESCUENTO POR COMBO\" del contexto: sale de la base y lo cambia el administrador). Nunca calcules el precio de un combo ni inventes porcentajes: usa la marca [COMBO]. Si no hay reglas activas, no ofrezcas descuento por combo.\n- El cupón DCTECH2026 NO se acumula con el descuento por combo: solo aplica a los productos que van fuera del combo.\n- Tú nunca escribes cuentas, contraseñas, perfiles, PIN ni seriales: el sistema los envía por este chat después de validar el pago (y quedan en Mis pedidos).\n- Nunca pidas contraseñas, códigos de verificación ni datos bancarios completos al cliente.\n- Duración: di la que trae el nombre de la variante (ej. \"Pantalla Colombia 30 días\" son 30 días, no \"un mes\"). No prometas renovaciones, perfiles ni dispositivos que el nombre no diga.\n- Si te preguntan algo que no está escrito aquí (diferencias técnicas entre planes, región, compatibilidad, calidad, dispositivos), no lo supongas ni lo deduzcas del nombre: di solo lo que dice el nombre y ofrece confirmarlo con un asesor.\n- Nunca inventes urgencia ni escasez (\"últimas unidades\", \"solo hoy\") ni opiniones de otros clientes: solo promociones activas y datos del catálogo.\n- TECNOLOGÍA (relojes, audífonos, diademas, powerbank), SERVICIOS TÉCNICOS y ALQUILER: da precio y detalles del catálogo; cuando el cliente quiera comprarlo o agendarlo, responde \"[ESCALAR] Pedido de <producto>\": el envío o la visita los coordina una persona.\n\nVENDE CON CRITERIO:\n- Recomienda el plan que le sirve: si no está claro, haz UNA pregunta (para cuántos dispositivos, cuánto tiempo o para qué lo quiere) y propón la opción adecuada con su precio.\n- Si lleva 1 plataforma y hay descuento por combo, menciona UNA vez cuánto ahorraría agregando otra. Si no le interesa, no insistas.\n- Ante \"está caro\": no negocies. Menciona una vez el cupón DCTECH2026 (primera compra; se aplica solo si el cliente lo escribe) o un combo si le sirve; si no aplica nada, respeta su decisión con amabilidad.\n- Si el cliente se despide sin comprar, agradece y deja la puerta abierta en una línea. Nunca hagas seguimiento insistente.\n\nCÓMO PAGA:\n- Cuando el cliente esté listo para pagar, ofrécele en el MISMO mensaje las dos formas y deja que elija: 1) *Por aquí*: le muestras los métodos activos y le das los datos del que elija; 2) *En la web*: entra a https://www.dctecnology.xyz, agrega su producto al carrito y toca \"Pagar y subir el comprobante aquí\" (queda registrado y lo sigue en Mis pedidos).\n- Si elige la web, no le pidas el comprobante por el chat: el equipo lo valida desde la web y le avisamos por aquí.\n- Mis pedidos (https://www.dctecnology.xyz/#cuenta): ahí ve sus pedidos, sus accesos, la garantía y puede reportar una falla. Entra con su número de WhatsApp y un código que le llega por este chat.\n\nPRODUCTOS DIGITALES:\n- VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (DCTECH2026 solo si el cliente escribe el código; nunca lo apliques por tu cuenta); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.\n- Cuando el cliente envía el comprobante: dile que lo recibiste y que estás revisando su pago, y que le escribes por este chat apenas quede confirmado. Nunca digas que el pago está aprobado ni prometas un tiempo: lo confirma el equipo.\n- Si pregunta por un pedido cuyo pago aún no está confirmado: dile que estamos revisando su pago y que le avisamos por aquí. Si ya está confirmado: dile que su pedido está en proceso y que se lo enviamos por este chat en los próximos minutos. Si pasaron más de 15 minutos en horario, escala a un asesor.\n- CONFIDENCIAL (nunca lo digas ni lo insinúes): de dónde salen las cuentas o los pines, proveedores, nombres como ANC o All Necessary, costos, márgenes de ganancia, o que esperas a un tercero. Para el cliente, todo lo prepara y entrega DC Tecnology. Si pregunta de dónde salen, responde que son productos de DC Tecnology con garantía.\n- Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.\n- COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).\n- PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].\n- PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.\n- SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".\n- HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene.\n\nESCALA A UN HUMANO CUANDO:\n- El cliente pide hablar con una persona (asesor, humano, persona, agente).\n- Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.\n- Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.\n- Pedido pagado sin entregar después de 15 minutos dentro del horario.\n- Cliente molesto, insultos o amenaza de reclamo.\n- Servicios a medida, alquiler, compras al por mayor o cotizaciones.\n- La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver.\n\nHorario: Lunes a sábado, 8:00 a.m. – 8:00 p.m. Tienda: https://www.dctecnology.xyz. Mis pedidos (accesos y garantía): https://www.dctecnology.xyz/#cuenta.","faq":[{"id":"metodos_pago","pregunta":"¿Qué métodos de pago aceptan?","palabras_clave":["pago","pagar","nequi","daviplata","bancolombia","transferencia","tarjeta","efectivo","pse","paypal","credito","llave","bre-b","breb"],"respuesta":"Al confirmar tu pedido te mostramos los métodos disponibles ese día: pagos locales (billeteras y transferencias en Colombia) y, cuando estén habilitadas, criptomonedas. Eliges uno, te damos sus datos y nos envías el comprobante.","pendiente_configurar":false},{"id":"tiempo_entrega","pregunta":"¿Cuánto tarda la entrega?","palabras_clave":["cuanto tarda","demora","tiempo","entrega","cuando llega","rapido","minutos"],"respuesta":"Entregamos en máximo 15 minutos después de validar tu pago, dentro del horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Si pagas fuera de horario, tu pedido se procesa al abrir.","pendiente_configurar":false},{"id":"cupon_primera_compra","pregunta":"¿Cómo funciona el cupón DCTECH2026?","palabras_clave":["cupon","descuento","dctech2026","codigo promocional","promo","primera compra"],"respuesta":"DCTECH2026 te da 10% de descuento solo en tu primera compra (se verifica con tu número de WhatsApp al validar el pago). Es un cupón por compra y no se acumula con otros. No aplica a servicios cotizados.","pendiente_configurar":false},{"id":"combos","pregunta":"¿Tienen combos o descuento por llevar varias plataformas?","palabras_clave":["combo","combos","varias plataformas","paquete","dos plataformas","tres plataformas","descuento por varias"],"respuesta":"Sí: si llevas varias plataformas distintas en un mismo pedido te aplicamos el descuento por combo vigente; dime cuáles quieres y te doy el total exacto. También puedes armarlo en www.dctecnology.xyz/#combos. El descuento de combo no se acumula con cupones.","pendiente_configurar":false},{"id":"datos_personales","pregunta":"¿Qué hacen con mis datos?","palabras_clave":["mis datos","datos personales","privacidad","habeas data","borrar mis datos","eliminar mis datos","politica de datos","tratamiento de datos"],"respuesta":"Usamos tu nombre, tu WhatsApp y los datos de tus pedidos solo para gestionarlos, validar pagos, entregarte y darte soporte y garantía (Ley 1581 de 2012). No vendemos tus datos. Puedes consultarlos, corregirlos o pedir que se borren escribiendo DATOS por este chat. Política completa: https://www.dctecnology.xyz/legal/privacidad.html","pendiente_configurar":false},{"id":"devoluciones_retracto","pregunta":"¿Puedo devolver o cancelar mi compra?","palabras_clave":["devolucion","devolver","reembolso","retracto","cancelar compra","me devuelven","devuelvan la plata","devuelvan el dinero"],"respuesta":"Tecnología: tienes 5 días hábiles desde la entrega para retractarte, devolviendo el producto como lo recibiste (el envío de vuelta corre por tu cuenta). Cuentas, licencias, pines y recargas ya entregados no tienen retracto por ley (Ley 1480, art. 47), pero sí garantía: si algo falla, te ayudo a resolverlo. Si pagaste y no podemos entregar, eliges otro producto o la devolución del dinero. Detalles: https://www.dctecnology.xyz/legal/garantias.html","pendiente_configurar":false},{"id":"terminos","pregunta":"¿Dónde veo los términos y condiciones?","palabras_clave":["terminos","condiciones","politicas","reglas de compra","legal"],"respuesta":"Aquí están: términos https://www.dctecnology.xyz/legal/terminos.html · garantías y devoluciones https://www.dctecnology.xyz/legal/garantias.html · datos personales https://www.dctecnology.xyz/legal/privacidad.html","pendiente_configurar":false},{"id":"pago_cripto","pregunta":"¿Puedo pagar con criptomonedas?","palabras_clave":["cripto","usdt","binance","bitcoin","btc","tether","usdc","ethereum","trc20","bep20","wallet","billetera"],"respuesta":"Sí, cuando el método está habilitado. Te damos la moneda, la RED exacta y la dirección: envía solo por esa red (otra red = pérdida total de los fondos) y mándanos el hash (TXID) de la transacción. El monto en cripto se calcula con la tasa del día.","pendiente_configurar":false},{"id":"soporte_inicio_sesion","pregunta":"No puedo entrar a mi cuenta de streaming","palabras_clave":["no puedo entrar","contrasena incorrecta","no me deja entrar","no funciona","no abre","cerro sesion","error"],"respuesta":"1) Cierra la app por completo y vuelve a abrirla. 2) Escribe el correo y la clave exactamente como te llegaron (sin espacios al final). 3) Entra solo a tu perfil asignado. 4) Si sigue fallando, envíanos una captura del mensaje de error y lo revisamos de inmediato. Recuerda: nunca cambies la contraseña.","pendiente_configurar":false},{"id":"soporte_pantallas","pregunta":"Me dice \"Demasiados dispositivos\" o \"Pantalla en uso\"","palabras_clave":["demasiadas pantallas","demasiados dispositivos","pantalla en uso","limite","otro dispositivo","muchas personas","en uso"],"respuesta":"Esto ocurre cuando alguien dejó una película en pausa o hay mucha demanda en la cuenta. Espera unos 10 a 15 minutos e intenta ingresar de nuevo. Recuerda que tu pantalla es para usar en un solo dispositivo a la vez. ¿Me avisas si te deja entrar después de la espera? 📺","pendiente_configurar":false},{"id":"soporte_hogar_netflix","pregunta":"Netflix me pide \"Actualizar hogar\" o me bloqueó (hogar / IP)","palabras_clave":["actualizar hogar","hogar","hogar de netflix","no es parte del hogar","codigo temporal","enviar correo","bloqueo","ip","dispositivo no forma parte"],"respuesta":"Para quitar el bloqueo, selecciona \"Actualizar hogar\" o \"Enviar correo\" directamente en tu pantalla. Apenas lo hagas, escríbeme por aquí para generarte el código o aprobar el enlace de inmediato. ¿Me confirmas cuando ya hayas enviado la solicitud en el TV? 🏠🔒","accion":"Cuando el cliente confirme que ya envió la solicitud, escala a un asesor: el código o el enlace llega al correo de la cuenta y lo aprueba nuestro equipo (tú no lo tienes).","pendiente_configurar":false},{"id":"soporte_perfil_pin","pregunta":"Alguien cambió el nombre de mi perfil o le puso PIN","palabras_clave":["cambiaron el nombre","cambio el nombre","le pusieron pin","pin","perfil ocupado","mi perfil","otro perfil","nombre del perfil","bloquearon el perfil"],"respuesta":"Qué molestia, lo reviso de inmediato. Como son cuentas compartidas, tenemos prohibido modificar nombres o poner PIN. Puedes verificar tu perfil asignado entrando a tu portal de accesos: https://www.dctecnology.xyz/#cuenta. Si siguen ocupando el tuyo, avísame y lo restauro. ¿Pudiste confirmar tu número de perfil en la web? 🔐","accion":"Si el cliente confirma que siguen ocupando su perfil o tiene PIN, escala a un asesor: el perfil lo restaura nuestro equipo (tú no puedes cambiarlo).","pendiente_configurar":false},{"id":"hablar_asesor","pregunta":"¿Puedo hablar con una persona?","palabras_clave":["asesor","humano","persona","agente","hablar con alguien"],"respuesta":"¡Claro! Escribe \"ASESOR\" y una persona del equipo te atiende por este mismo chat en horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Para agilizar, envía tu número de pedido.","pendiente_configurar":false},{"id":"como_comprar","pregunta":"¿Cómo compro?","palabras_clave":["comprar","como compro","quiero","precio","adquirir","carrito","web","pagina"],"respuesta":"Dos formas: 1) Por aquí: dime qué producto quieres, te confirmo el total y te paso los datos de pago. 2) En la web https://www.dctecnology.xyz: agregas al carrito, eliges cómo pagar y subes tu comprobante ahí mismo. Al validar tu pago te llegan los accesos por este chat.","pendiente_configurar":false},{"id":"estado_pedido","pregunta":"¿Cómo veo el estado de mi pedido?","palabras_clave":["estado","pedido","rastrear","seguimiento","mi compra","mis pedidos","mis accesos"],"respuesta":"En Mis pedidos: https://www.dctecnology.xyz/#cuenta. Escribes tu número de WhatsApp y te llega un código por este chat; ahí ves tus pedidos, tus accesos y tu garantía. También puedes escribirme aquí tu número de pedido.","pendiente_configurar":false},{"id":"garantia","pregunta":"¿Tienen garantía?","palabras_clave":["garantia","no funciona","fallo","se cayo","reclamo","reembolso"],"respuesta":"Sí: 30 días desde la entrega, si se respetan las reglas de uso. Si algo falla, escríbeme qué pasa y te doy los pasos; o repórtalo en Mis pedidos (https://www.dctecnology.xyz/#cuenta) con el botón \"Reportar falla\".","pendiente_configurar":false},{"id":"horario_atencion","pregunta":"¿Cuál es el horario de atención?","palabras_clave":["horario","hora","atienden","abierto","domingo","festivo"],"respuesta":"Atendemos de lunes a sábado, de 8:00 a.m. a 8:00 p.m. (hora Colombia).","pendiente_configurar":false},{"id":"activacion_streaming","pregunta":"¿Cómo activo mi cuenta de streaming?","palabras_clave":["activar","netflix","disney","max","prime","perfil","pantalla","iniciar sesion"],"respuesta":"1) Abre la app oficial del servicio. 2) Inicia sesión con el correo y la clave de tu pedido. 3) Entra solo a tu perfil asignado y no cambies la contraseña. 4) Si te pide PIN de perfil, úsalo tal como aparece en tu pedido.","pendiente_configurar":false},{"id":"activacion_licencias","pregunta":"¿Cómo activo una licencia o serial?","palabras_clave":["licencia","serial","windows","office","clave","activar","key"],"respuesta":"1) Copia el serial completo, sin espacios. 2) Abre el programa o la tienda donde se activa. 3) Busca \"Canjear código\" o \"Activar licencia\" y pégalo. 4) Guarda tu serial en un lugar seguro y no lo compartas.","pendiente_configurar":false},{"id":"reglas_uso","pregunta":"¿Qué reglas tiene la cuenta?","palabras_clave":["reglas","condiciones","puedo cambiar","compartir","contraseña"],"respuesta":"Prohibido usar en más dispositivos de los permitidos. Prohibido modificar correo, contraseña o facturación. Prohibido compartir, revender o transferir el acceso. Uso exclusivo del perfil asignado, sin excepciones. Incumplir estas reglas anula la garantía sin reembolso.","pendiente_configurar":false}],"promociones":[{"id":"primera_compra","codigo":"DCTECH2026","descripcion":"10% OFF en la primera compra con el código DCTECH2026 (se verifica que sea la primera compra del WhatsApp al validar el pago).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"renovacion","descripcion":"10% de descuento al renovar (recordatorio 3 días antes del vencimiento).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"cupon_segunda_compra","descripcion":"10% de descuento en la segunda compra con el cupón de fidelidad (DC-XXXXXX) que se envía por WhatsApp.","porcentaje":10,"activa":true,"pendiente_configurar":false}],"reglas_uso":["Prohibido usar en más dispositivos de los permitidos.","Prohibido modificar correo, contraseña o facturación.","Prohibido compartir, revender o transferir el acceso.","Uso exclusivo del perfil asignado, sin excepciones.","Incumplir estas reglas anula la garantía sin reembolso."],"flujo_digital":["VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (DCTECH2026 solo si el cliente escribe el código; nunca lo apliques por tu cuenta); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.","Cuando el cliente envía el comprobante: dile que lo recibiste y que estás revisando su pago, y que le escribes por este chat apenas quede confirmado. Nunca digas que el pago está aprobado ni prometas un tiempo: lo confirma el equipo.","Si pregunta por un pedido cuyo pago aún no está confirmado: dile que estamos revisando su pago y que le avisamos por aquí. Si ya está confirmado: dile que su pedido está en proceso y que se lo enviamos por este chat en los próximos minutos. Si pasaron más de 15 minutos en horario, escala a un asesor.","CONFIDENCIAL (nunca lo digas ni lo insinúes): de dónde salen las cuentas o los pines, proveedores, nombres como ANC o All Necessary, costos, márgenes de ganancia, o que esperas a un tercero. Para el cliente, todo lo prepara y entrega DC Tecnology. Si pregunta de dónde salen, responde que son productos de DC Tecnology con garantía.","Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.","COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).","PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].","PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.","SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".","HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene."],"escalamiento":{"disparadores":["El cliente pide hablar con una persona (asesor, humano, persona, agente).","Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.","Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.","Pedido pagado sin entregar después de 15 minutos dentro del horario.","Cliente molesto, insultos o amenaza de reclamo.","Servicios a medida, alquiler, compras al por mayor o cotizaciones.","La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver."],"acciones_n8n":["Pausar el bot en ese chat (no responder automáticamente hasta que el asesor lo libere).","Avisar al WhatsApp del negocio con: número del cliente, pedido (si lo hay), motivo y último mensaje.","Responder al cliente con la plantilla \"escalar_asesor\"."],"palabras_clave":["asesor","humano","persona","agente","reclamo","reembolso","devolucion","estafa","no me llego"]},"plantillas":{"botones":[{"id":"comprar","texto":"Comprar ahora"},{"id":"estado","texto":"Consultar estado"},{"id":"soporte","texto":"Solicitar soporte"}],"comprar_ahora":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Valor: {precio}\n¿Me indican los datos para realizar el pago?","pedido_tienda":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Cantidad: {cantidad}\n• Precio unitario: {precio_unitario}\n• Cupón: {cupon} (-{porcentaje}%)\n• Total a pagar: {total}\nAcepté los términos de uso. ¿Me indican los datos para realizar el pago?","agendar_servicio":"Hola DC Tecnology, quiero agendar un servicio:\n• Servicio: {servicio}\n• Opción: {opcion}\n• Fecha preferida: {fecha}\n• Franja: {franja}\n• Valor estimado: {estimado}\n• Detalle: {detalle}\n¿Me confirman disponibilidad?","consultar_estado":"Hola, quiero consultar el estado de mi pedido #{pedido}.\nTambién puedo verlo aquí: https://www.dctecnology.xyz/portal.html?codigo={pedido}","solicitar_soporte":"Hola, requiero soporte sobre mi pedido #{pedido} ({producto}).","reclamar_garantia":"Hola, equipo de soporte DC Tecnology.\nQuiero reclamar la garantía de mi compra:\n• ID de compra: #{id_compra}\n• Pedido: #{pedido}\n• Producto: {producto}\n• Cuenta/serial terminado en: {serial_final}\n• Garantía vigente hasta: {fecha_vencimiento}\nDescribo la falla a continuación:","satisfaccion_24h":"👋 *¿Cómo vas con {producto}?* · ⚡ *DC TECNOLOGY*\n\nQueremos que todo funcione al 100 %.\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.","renovacion_3d":"⏰ *Tu {producto} vence pronto* · ⚡ *DC TECNOLOGY*\n\nRenuévalo hoy con *10% de descuento* y sigue sin interrupciones.\n🎟️ Tu cupón: *{cupon}*\n\nResponde *RENOVAR* y te ayudo en un minuto.","cupon_fidelidad":"🎁 *Un regalo por tu compra* · ⚡ *DC TECNOLOGY*\n\nGracias por confiar en nosotros con {producto}.\n🎟️ Tu cupón para la próxima compra: *{cupon}*\n\nEscríbenos cuando quieras usarlo.","pedido_proveedor":"Hola, adjunto pedido #{pedido}: {producto} x{cantidad}. Favor confirmar recepción.","pago_recibido":"✅ *Pago confirmado* · ⚡ *DC TECNOLOGY*\n\nRecibimos tu pago y ya estamos preparando tu pedido.\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n💳 Pagaste con: {metodo}\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.)\n\n🔎 Síguelo aquí: https://www.dctecnology.xyz/portal.html?codigo={codigo}\n\nGracias por comprar con nosotros 🙌","entrega_confirmada":"🎉 *¡Pedido entregado!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n🛡️ Garantía: *{garantia_dias} días*, hasta el {garantia_hasta}\n\n🔐 Tus accesos llegan *solo por este chat oficial* y quedan guardados en Mis pedidos.\n📌 Para no perder la garantía: no cambies correo ni contraseña y usa solo tu perfil.\n\n🔎 Tu pedido y garantía: https://www.dctecnology.xyz/portal.html?codigo={codigo}\n¿Algo no funciona? Responde *SOPORTE* 🛠️","solicitud_resena":"⭐ *¿Cómo te fue con {producto}?* · ⚡ *DC TECNOLOGY*\n\nYa pasó un día desde tu entrega y queremos saber si todo funciona al 100 %.\n\n👉 Califícanos en 30 segundos (reseña de compra verificada):\nhttps://www.dctecnology.xyz/portal.html?codigo={codigo}#resena\n_Solo te pide los últimos 4 dígitos de tu WhatsApp._\n\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.\n_Si no quieres recibir estos mensajes, responde *NO*._","codigo_acceso":"🔐 *Tu código de acceso* · ⚡ *DC TECNOLOGY*\n\n*{codigo}*\n\nEscríbelo en www.dctecnology.xyz para ver tus pedidos y accesos.\n⏱️ Vence en *5 minutos*.\n\n⚠️ No lo compartas: nadie de DC TECNOLOGY te lo va a pedir.\n_Si no lo pediste, ignora este mensaje._","orden_validada":"✅ *Pago validado* · ⚡ *DC TECNOLOGY*\n\nTu orden *{codigo}* por *${total}* quedó confirmada. Ya estamos procesando tu pedido.\n📲 Te lo enviamos por WhatsApp en los próximos minutos.\n\n🔎 Síguela en Mis pedidos: www.dctecnology.xyz/#cuenta","orden_rechazada":"⚠️ *No pudimos validar tu pago* · ⚡ *DC TECNOLOGY*\n\n📦 Orden: *{codigo}*\n📝 Motivo: {motivo}\n\nSube otro comprobante en Mis pedidos (www.dctecnology.xyz/#cuenta) o respóndeme por aquí y te ayudo.","reporte_resuelto":"🛠️ *Tu reporte fue atendido* · ⚡ *DC TECNOLOGY*\n\n🛒 Producto: {producto}\n✅ Solución: {nota}\n\n¿Sigue fallando? Responde *SOPORTE* y lo revisamos de nuevo.","admin_comprobante":"🧾 *Comprobante nuevo en la web*\nOrden: *{codigo}* · ${total} · {metodo}\nCliente: +{cliente}\nReferencia: {referencia}\n\n1️⃣ Revisa en tu {metodo} que llegaron *{total}*.\n2️⃣ Si llegó responde *#ok {codigo}* · si no: *#no {codigo} motivo*\n(o en el panel → Pagos & Agente Bot → Comprobantes web)","admin_falla":"🛠️ *Falla reportada en Mis pedidos*\nReporte #{reporte} · Cliente: +{cliente}\nProducto: {producto}\nProblema: {problema}\nEn garantía: {garantia}\nAtiéndelo y ciérralo en el panel (Reportes de falla).","escalar_asesor":"🙋 *Te comunico con un asesor* · ⚡ *DC TECNOLOGY*\n\nUna persona del equipo te responde por este mismo chat en horario de atención (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\nYa tenemos tu pedido *#{pedido}* a la mano.","entrega_credenciales":"🔐 *¡Tus accesos están listos!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n👤 Usuario / correo: ```{usuario}```\n🔑 Clave: ```{clave}```\n🙋 Perfil: ```{perfil}```\n🔢 PIN: ```{pin}```\n\n📌 Para no perder la garantía: no cambies correo ni contraseña, usa solo tu perfil y no compartas el acceso.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️","entrega_pin":"🎁 *¡Tu PIN está listo!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n🔢 Código: ```{pin}```\n\n📌 Canjéalo en la app o página oficial de la plataforma. Los pines entregados no son reversibles.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️","renovacion":"⏰ *Tu plan vence pronto* · ⚡ *DC TECNOLOGY*\n\n🛒 {producto}\n📦 Plan: {variante}\n📅 Vence: *{vence}*\n\nRenueva antes y sigue sin cortes 🙌\nResponde *RENOVAR* y te dejo el mismo plan listo para pagar.","rastreo":"🚚 *Tu pedido #{pedido} va en camino* · ⚡ *DC TECNOLOGY*\n\n📍 Estado: *{estado}*\n🏢 Transportadora: {transportadora}\n🔢 Guía: {guia}\n\nMíralo cuando quieras en *www.dctecnology.xyz* → Pedidos.","recordatorio_pago":"🛒 *Tu pedido #{codigo} te espera* · ⚡ *DC TECNOLOGY*\n\nVimos que tu pedido por *${total}* aún no tiene comprobante de pago.\n\nSi ya pagaste, sube el comprobante en *www.dctecnology.xyz* → Pedidos o envíanos la captura por este chat.\n¿Tienes alguna duda o quieres cambiar algo? Respóndenos aquí y te ayudamos 🙌\n\nSi ya no lo necesitas, no tienes que hacer nada."},"notificaciones":{"plantilla_por_tipo":{"PAGO_RECIBIDO":"pago_recibido","ENTREGA_CONFIRMADA":"entrega_confirmada","SOLICITUD_RESENA":"solicitud_resena","RENOVACION":"renovacion","RASTREO":"rastreo","RECORDATORIO_PAGO":"recordatorio_pago","OTP":"codigo_acceso","ORDEN_VALIDADA":"orden_validada","ORDEN_RECHAZADA":"orden_rechazada","REPORTE_RESUELTO":"reporte_resuelto","ADMIN_COMPROBANTE":"admin_comprobante","ADMIN_FALLA":"admin_falla"}},"menu":{"garantia_dias":30,"principal":{"saludo":"¡Hola{nombre}! 👋 Te saluda *DC TECNOLOGY*","lema":"Streaming, licencias, pines y recargas con entrega por este chat ⚡","titulo":"📋 *Menú DC TECNOLOGY*","pregunta":"*¿En qué te ayudo?* Responde con un número:","opciones":[{"id":"catalogo","texto":"Catálogo y precios"},{"id":"comprar","texto":"Cómo comprar"},{"id":"pedidos","texto":"Mis pedidos y accesos"},{"id":"soporte","texto":"Soporte y garantía"},{"id":"pagos","texto":"Formas de pago"},{"id":"asesor","texto":"Hablar con una persona"}],"pie":"O escríbeme lo que buscas, por ejemplo: _Netflix_ 🍿"},"categorias":[{"tipos":["streaming"],"titulo":"Streaming","emoji":"🎬"},{"tipos":["licencias"],"titulo":"Licencias y apps","emoji":"💻"},{"tipos":["pines"],"titulo":"Pines y tarjetas regalo","emoji":"🎟️"},{"tipos":["recargas"],"titulo":"Recargas","emoji":"📱"},{"tipos":["tecnologia"],"titulo":"Tecnología y accesorios","emoji":"⌚"},{"tipos":["variedades"],"titulo":"Hogar y variedades","emoji":"🏠"},{"tipos":["servicios","alquiler"],"titulo":"Servicios técnicos y alquiler","emoji":"🛠️"}],"soporte":[{"titulo":"No puedo iniciar sesión","faq":"soporte_inicio_sesion","emoji":"🔐"},{"titulo":"Dice \"Demasiados dispositivos\" o pantalla en uso","faq":"soporte_pantallas","emoji":"📺"},{"titulo":"Netflix pide \"Actualizar hogar\"","faq":"soporte_hogar_netflix","emoji":"🏠"},{"titulo":"Cambiaron mi perfil o le pusieron PIN","faq":"soporte_perfil_pin","emoji":"🙋"},{"titulo":"Activar una licencia o serial","faq":"activacion_licencias","emoji":"🔑"},{"titulo":"Otro problema o garantía","faq":null,"emoji":"📝"}],"comprar":["🛒 *Cómo comprar*","","*Por este chat*","1. Dime qué producto y plan quieres.","2. Te confirmo el total y eliges cómo pagar.","3. Me envías la captura del comprobante 📸","","*En la web:* www.dctecnology.xyz → agrega al carrito → \"Pagar y subir el comprobante aquí\".","","✅ Validamos tu pago y tus accesos llegan por este chat en máximo *15 minutos* (Lunes a sábado, 8:00 a.m. – 8:00 p.m).","🎁 ¿Primera compra? Usa el cupón *DCTECH2026* (10%)."],"pedidos":["📦 *Mis pedidos y accesos*","","Entra a 👉 https://www.dctecnology.xyz/#cuenta","1. Escribe tu número de WhatsApp.","2. Te llega un código por este chat.","3. Listo: ves tus pedidos, tus accesos y tu garantía, y puedes reportar una falla.","","¿Pagaste y aún no te llega? Escríbeme tu número de pedido y te ayudo."],"pagos":{"titulo":"💳 *Formas de pago*","pasos":["*Así pagas*","1. Te confirmo el total de tu pedido.","2. Eliges el medio y te paso sus datos.","3. Me envías la captura del comprobante 📸","","O paga en la web y sube el comprobante allá: www.dctecnology.xyz"],"sin_metodos":"Hoy el medio de pago te lo confirma una persona: escribe *asesor* y te atendemos."},"compra_web":["🌐 *Compra en la web*","","1. Abre 👉 {url}","2. Elige tu opción y toca *Aceptar y agregar al carrito*.","3. Abre el carrito 🛒 y toca *Pagar y subir el comprobante aquí*.","","Te avisamos por este chat apenas validemos tu pago ✅"],"otro_problema":["📝 *Cuéntame qué pasa*","","En un solo mensaje: qué producto es, qué te aparece y tu número de pedido si lo tienes. Si tienes una captura, envíala con una frase."],"textos":{"catalogo":"🛍️ *Catálogo DC TECNOLOGY*","elige_categoria":"Elige una categoría:","elige_producto":"Responde con el número para ver planes y precios.","elige_opcion_digital":"Responde con el número de la opción que quieres y te digo cómo pagar.","elige_opcion_fisico":"Responde con el número de la opción y una persona coordina contigo el envío o la cita.","comprar_pie":"¿Qué producto quieres? Escríbelo o responde *1* para ver el catálogo.","tu_pedido":"🛒 *Tu pedido*","como_pagar":"*¿Cómo quieres pagar?* Responde con el número:","pagar_web":"En la web (carrito y comprobante allá)","pagar_cripto":"💠 ¿Pagas con cripto? Escribe *cripto*.","combo":"🧩 ¿Agregas otra plataforma? Con el combo tienes descuento: escríbeme cuál.","captura":"📸 Cuando pagues, envíame aquí la *captura del comprobante*.","volver_opciones":"0️⃣ Volver a las opciones","volver_pago":"0️⃣ Elegir otro medio de pago","soporte":"🛠️ *Soporte y garantía*","elige_problema":"¿Qué te pasa? Responde con el número:","volver_menu":"0️⃣ Menú principal","volver_catalogo":"0️⃣ Volver al catálogo","volver_lista":"0️⃣ Volver a la lista","volver_soporte":"0️⃣ Volver a soporte","web":"🌐 También en www.dctecnology.xyz","ver_web":"🌐 Míralo en la web:","invalida":"⚠️ Esa opción no está en la lista. Responde con uno de estos números:","sigue":"¿Sigue igual? Escribe *asesor* y una persona te ayuda."}},"catalogo":[{"id":"reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados","nombre":"Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados.html","variantes":[{"nombre":"Unidad Completa","precio":180000}]},{"id":"diademas-inalambricas-cr-8-con-luces-r9s7x","nombre":"Diademas Inalámbricas CR-8 con Luces LED","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/diademas-inalambricas-cr-8-con-luces-r9s7x.html","variantes":[{"nombre":"Unidad Completa","precio":100000}]},{"id":"diademas-gamer-a3s-alambrico","nombre":"Diademas Gamer A3S Alámbrico","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/diademas-gamer-a3s-alambrico.html","variantes":[{"nombre":"Unidad Gamer","precio":80000}]},{"id":"reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable.html","variantes":[{"nombre":"Acero Inoxidable","precio":140000}]},{"id":"auriculares-inalambricos-de-gancho-sp16","nombre":"Auriculares Inalámbricos de Gancho SP16","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/auriculares-inalambricos-de-gancho-sp16.html","variantes":[{"nombre":"Unidad Estándar","precio":75000}]},{"id":"auriculares-inalambricos-m25-con-powerbank","nombre":"Auriculares Inalámbricos M25 (Con Powerbank)","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/auriculares-inalambricos-m25-con-powerbank.html","variantes":[{"nombre":"Gamer M25","precio":40000}]},{"id":"reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable.html","variantes":[{"nombre":"Acero de Lujo P13","precio":130000}]},{"id":"netflix","nombre":"Netflix Premium 4K","tipo":"streaming","url":"https://www.dctecnology.xyz/p/netflix.html","variantes":[{"nombre":"Pantalla Colombia 30 días","precio":15000}]},{"id":"prime-video","nombre":"Prime Video Ultra HD","tipo":"streaming","url":"https://www.dctecnology.xyz/p/prime-video.html","variantes":[{"nombre":"Pantalla (1 Dispositivo)","precio":10000}]},{"id":"disney-plus","nombre":"Disney Plus Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/disney-plus.html","variantes":[{"nombre":"Pantalla Premium","precio":15000}]},{"id":"hbo-max","nombre":"Max (HBO)","tipo":"streaming","url":"https://www.dctecnology.xyz/p/hbo-max.html","variantes":[{"nombre":"Pantalla Estándar 1 Mes","precio":8000},{"nombre":"Pantalla Platino 1 Mes","precio":12000},{"nombre":"Cuenta Completa Estándar 1 Mes","precio":18000}]},{"id":"crunchyroll","nombre":"Crunchyroll Mega Fan","tipo":"streaming","url":"https://www.dctecnology.xyz/p/crunchyroll.html","variantes":[{"nombre":"Perfil Mega Fan 1 Mes","precio":10000}]},{"id":"vix-premium","nombre":"Vix Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/vix-premium.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":8000}]},{"id":"paramount-plus","nombre":"Paramount Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/paramount-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"universal-plus","nombre":"Universal Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/universal-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"viki-rakuten","nombre":"Viki Rakuten Pass","tipo":"streaming","url":"https://www.dctecnology.xyz/p/viki-rakuten.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"apple-tv","nombre":"Apple TV Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/apple-tv.html","variantes":[{"nombre":"Perfil 1 Mes","precio":12000}]},{"id":"mubi","nombre":"Mubi Cinema","tipo":"streaming","url":"https://www.dctecnology.xyz/p/mubi.html","variantes":[{"nombre":"Perfil 1 Mes","precio":10000}]},{"id":"combo-3-o-4-plataformas","nombre":"Combo de 3 o 4 Plataformas","tipo":"streaming","url":"https://www.dctecnology.xyz/p/combo-3-o-4-plataformas.html","variantes":[{"nombre":"Netflix + Prime Video + Disney Premium + Max","precio":45000},{"nombre":"Netflix + Prime Video + Disney Premium","precio":40000},{"nombre":"Netflix + Prime Video + Max","precio":32000},{"nombre":"Prime Video + Disney Premium + Max","precio":30000}]},{"id":"directv-go","nombre":"DirecTV Go","tipo":"streaming","url":"https://www.dctecnology.xyz/p/directv-go.html","variantes":[{"nombre":"Pantalla con ESPN","precio":30000},{"nombre":"Pantalla con Win Play","precio":35000}]},{"id":"youtube-premium","nombre":"YouTube Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/youtube-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":15000}]},{"id":"spotify-premium","nombre":"Spotify Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/spotify-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":14000},{"nombre":"Suscripción 3 Meses","precio":34000}]},{"id":"deezer-premium","nombre":"Deezer Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/deezer-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"id":"canva-pro","nombre":"Canva Pro","tipo":"licencias","url":"https://www.dctecnology.xyz/p/canva-pro.html","variantes":[{"nombre":"Acceso 1 Mes","precio":10000},{"nombre":"Acceso 1 Año Completo","precio":40000}]},{"id":"duolingo-super","nombre":"Duolingo Super","tipo":"licencias","url":"https://www.dctecnology.xyz/p/duolingo-super.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"id":"mcafee-antivirus","nombre":"McAfee Antivirus Total Protection","tipo":"licencias","url":"https://www.dctecnology.xyz/p/mcafee-antivirus.html","variantes":[{"nombre":"Licencia 1 Año (1 PC)","precio":45000},{"nombre":"Licencia 1 Año (5 PCs)","precio":130000}]},{"id":"pin-virtual-disney-plus-1tpu5","nombre":"PIN Virtual Disney Plus","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-disney-plus-1tpu5.html","variantes":[{"nombre":"PIN de $25.900","precio":25900},{"nombre":"PIN de $36.900","precio":36900},{"nombre":"PIN de $54.900","precio":54900}]},{"id":"pin-virtual-netflix","nombre":"PIN Virtual Netflix Colombia","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-netflix.html","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $35.000","precio":35000},{"nombre":"PIN de $40.000","precio":40000},{"nombre":"PIN de $50.000","precio":50000}]},{"id":"pin-virtual-directv-go","nombre":"PIN Virtual Directv Go","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-directv-go.html","variantes":[{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $79.900","precio":79900},{"nombre":"PIN de $102.900","precio":102900}]},{"id":"pin-virtual-win-play","nombre":"PIN Virtual Win Play","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-win-play.html","variantes":[{"nombre":"PIN 1 Mes ($39.900)","precio":39900}]},{"id":"pin-virtual-vix","nombre":"PIN Virtual Vix","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-vix.html","variantes":[{"nombre":"PIN de $22.900","precio":22900}]},{"id":"pin-virtual-deezer","nombre":"PIN Virtual Deezer","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-deezer.html","variantes":[{"nombre":"PIN de $19.500","precio":19500}]},{"id":"pin-virtual-roblox","nombre":"PIN Virtual Roblox","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-roblox.html","variantes":[{"nombre":"PIN de $25.000","precio":25000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"id":"pin-virtual-mcafee","nombre":"PIN Virtual McAfee","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-mcafee.html","variantes":[{"nombre":"PIN de $105.900","precio":105900},{"nombre":"PIN de $159.900","precio":159900},{"nombre":"PIN de $189.900","precio":189900}]},{"id":"pin-virtual-datacredito","nombre":"PIN Virtual Datacrédito","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-datacredito.html","variantes":[{"nombre":"PIN de $15.000","precio":15000}]},{"id":"servicio-mantenimiento-computadores","nombre":"Mantenimiento Preventivo y Correctivo de Equipos","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-mantenimiento-computadores.html","variantes":[{"nombre":"Preventivo Software + Limpieza","precio":60000},{"nombre":"Correctivo + Cambio Térmico","precio":90000}]},{"id":"servicio-instalacion-so-licenciamiento","nombre":"Instalación de Sistema Operativo y Licenciamiento","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-instalacion-so-licenciamiento.html","variantes":[{"nombre":"Windows 10/11 Pro + Office + Software Base","precio":60000}]},{"id":"servicio-alquiler-equipos-computo","nombre":"Alquiler de Laptops y Equipos de Cómputo","tipo":"alquiler","url":"https://www.dctecnology.xyz/p/servicio-alquiler-equipos-computo.html","variantes":[{"nombre":"Plan 1 Mes (Pago Total)","precio":160000},{"nombre":"Plan 6 Meses ($150.000/mes) - Pago Total","precio":900000},{"nombre":"Plan 1 Año ($140.000/mes) - Pago Total","precio":1680000}]},{"id":"servicio-asesorias-tutorias","nombre":"Asesoría Técnica y Tutoría Personalizada","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-asesorias-tutorias.html","variantes":[{"nombre":"Sesión de Asesoría / Tutoría (1 Hora)","precio":40000}]},{"id":"servicio-desarrollo-web-automatizaciones","nombre":"Desarrollo de Catálogos Web y Automatizaciones IA","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-desarrollo-web-automatizaciones.html","variantes":[{"nombre":"Proyecto a Medida (Requiere Asesoría)","precio":0}]},{"id":"servicio-reparacion-repuestos","nombre":"Reparación de Computadores y Venta de Repuestos","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-reparacion-repuestos.html","variantes":[{"nombre":"Revisión del Equipo (Diagnóstico)","precio":25000},{"nombre":"Diagnóstico y Reparación (Requiere Cotización)","precio":0},{"nombre":"Repuestos para Computador (Requiere Cotización)","precio":0}]},{"id":"servicio-automatizaciones-negocios","nombre":"Automatizaciones para Negocios: Dashboards, Inventarios y Macros","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-automatizaciones-negocios.html","variantes":[{"nombre":"Dashboards e Inventarios (Requiere Asesoría)","precio":0},{"nombre":"Sistema para Bares o Supermercados (Requiere Asesoría)","precio":0},{"nombre":"Automatización de Macros (Requiere Asesoría)","precio":0}]}]}).catalogo ?? []).filter((x) => x.tipo === 'pines')) {
        for (const v of p.variantes ?? []) {
            const nombre = sinPuntos(p.nombre);
            const valores = sinPuntos(v.nombre).match(/\d+/g) ?? [];
            if (palabras.length && !palabras.every((w) => nombre.includes(w))) continue;
            if (numeros.length && !numeros.some((n) => valores.includes(n))) continue;
            opciones.push({ id: p.id, producto: p.nombre, variante: v.nombre });
        }
    }
    const codigos = lineas.slice(1).flatMap((l) => l.split(/[,;]/)).map((x) => x.trim()).filter((x) => x.length >= 6);
    if (opciones.length !== 1) {
        return avisar(msg.numero, [opciones.length ? '¿Cuál de estos? Sé más específico:' : `No encontré un pin que coincida con «${cabeza.slice(0, 60)}».`,
            ...opciones.slice(0, 12).map((o) => `• ${o.producto} · ${o.variante}`), '',
            'Ejemplo:', '*#stock roblox 25000*', 'CODIGO-1', 'CODIGO-2', '', 'Para ver lo que tienes: *#stock*'].join('\n'));
    }
    const o = opciones[0];
    if (!codigos.length) return avisar(msg.numero, `Para *${o.producto} · ${o.variante}* pega los códigos debajo de *#stock*, uno por línea.`);
    return [{ json: { accion: 'panel', rpc: 'cargar_stock', args: { p_producto_id: o.id, p_variante: o.variante, p_codigos: codigos, p_costo: null, p_origen: 'whatsapp' },
        tipo: 'cargar_stock', numero: msg.numero, producto: `${o.producto} · ${o.variante}` } }];
}
if (msg.origen === 'admin' && (msg.accion === 'ok' || msg.accion === 'no')) {
    const t = abiertas.find((r) => r.referencia === msg.referencia);
    // Pin de un pedido web ya validado: con #ok se entrega de una vez desde tu stock (si no hay, te digo qué comprar)
    const stockWeb = t && t.origen_web && msg.accion === 'ok' && t.estado === 'REVISION_MANUAL' ? deStock(t) : null;
    if (stockWeb) {
        return [{ json: { accion: 'panel', rpc: 'entregar_desde_stock', args: { p_referencia: t.referencia, p_producto_id: stockWeb.producto_id, p_variante: stockWeb.variante },
            tipo: 'entregar_desde_stock', referencia: t.referencia, cliente: t.cliente, cliente_nombre: t.cliente_nombre, producto: `${t.producto}${t.variante ? ` – ${t.variante}` : ''}`, numero: msg.numero,
            sin_stock: `Compra en ANC: *${ordenDe(t.referencia).plan ?? `${t.producto} – ${t.variante ?? ''}`}* (WhatsApp del pedido: 322 328 4622) y cuando llegue el código se lo entrego.` } }];
    }
    if (t && t.origen_web && msg.accion === 'ok') return avisar(msg.numero, `*#${t.referencia}* es un pedido web y su pago ya está validado. ${String($('Config bot').first().json.entrega_cuentas ?? 'manual').trim().toLowerCase() === 'automatica' ? `Cuando ANC envíe la cuenta se la entrego al cliente (o usa *#entregar ${t.referencia}*).` : `Entrégale la cuenta con *#entregar ${t.referencia} correo / clave*.`}`);
    // Pedido por chat: el pago lo confirmas tú (lo viste en tu Nequi/Daviplata)
    if (t && !t.origen_web) {
        const o = ordenDe(t.referencia);
        if (msg.accion === 'no') {
            return [
                { json: { accion: 'avisar', numero: t.cliente, texto: ['⚠️ *No pudimos validar tu pago* · ⚡ *DC TECNOLOGY*', '', resto ? `📝 Motivo: ${resto}` : '📝 El valor o los datos no coinciden.', '', 'Envíame un nuevo comprobante por aquí o escribe *asesor* y te ayudamos.'].join('\n') } },
                { json: { accion: 'avisar', numero: msg.numero, texto: `❌ Pago de *#${t.referencia}* rechazado. Ya le avisé al cliente.` } },
            ];
        }
        if (t.estado === 'ESPERANDO_CREDENCIALES') return avisar(msg.numero, `*#${t.referencia}* ya tiene el pago confirmado: falta que ANC envíe la cuenta.`);
        const confirmado = { json: { accion: 'avisar', numero: t.cliente, texto: ['✅ *¡Pago confirmado!* · ⚡ *DC TECNOLOGY*', '', `Gracias${t.cliente_nombre ? `, ${t.cliente_nombre.split(' ')[0]}` : ''} 🙌 Ya estamos procesando tu pedido de *${t.producto}*.`, 'Te lo enviamos por este chat apenas esté listo, con nuestra marca y tu garantía.'].join('\n') } };
        const stock = deStock(t);
        if (stock) {
            return [confirmado, { json: { accion: 'panel', rpc: 'entregar_desde_stock', args: { p_referencia: t.referencia, p_producto_id: stock.producto_id, p_variante: stock.variante },
                tipo: 'entregar_desde_stock', referencia: t.referencia, cliente: t.cliente, cliente_nombre: t.cliente_nombre, producto: `${t.producto}${t.variante ? ` – ${t.variante}` : ''}`, numero: msg.numero,
                sin_stock: `Compra en ANC: *${o.plan ?? `${t.producto} – ${t.variante ?? ''}`}*${o.costo ? ` (costo ${cop(o.costo)})` : ''} con el WhatsApp del bot (322 328 4622); cuando llegue el código se lo entrego.` } }];
        }
        return [
            { json: { accion: 'panel', rpc: 'entregar_manual', args: { p_referencia: t.referencia, p_estado: 'PEDIDO_REALIZADO', p_clave: null }, referencia: t.referencia } },
            { json: { accion: 'avisar', numero: t.cliente, texto: ['✅ *¡Pago confirmado!* · ⚡ *DC TECNOLOGY*', '', `Gracias${t.cliente_nombre ? `, ${t.cliente_nombre.split(' ')[0]}` : ''} 🙌 Ya estamos procesando tu pedido de *${t.producto}*.`, 'Te lo enviamos por este chat apenas esté listo, con nuestra marca y tu garantía.'].join('\n') } },
            { json: { accion: 'avisar', numero: msg.numero, texto: [`✅ *Pago de #${t.referencia} confirmado* · le avisé al cliente.`, '',
                `👉 Ahora compra en ANC: *${o.plan ?? `${t.producto} – ${t.variante ?? ''}`}*${o.costo ? ` (costo ${cop(o.costo)})` : ''}.`,
                'En el pedido de ANC pon como WhatsApp el del bot (322 328 4622).',
                String($('Config bot').first().json.entrega_cuentas ?? 'manual').trim().toLowerCase() === 'automatica' ? '📦 Cuando ANC envíe la cuenta a este WhatsApp, se la entrego al cliente y activo la garantía. Si no la reconozco, te pido *#entregar*.'
                    : `📦 Cuando tengas la cuenta, entrégala con *#entregar ${t.referencia} correo / clave* (y perfil o PIN si aplica): le llega al cliente con nuestra marca y se activa la garantía.`].join('\n') } },
        ];
    }
    // Pedido web: misma validación que el panel (Comprobantes web)
    return [{ json: { accion: 'pago_web', codigo: msg.referencia, aprobar: msg.accion === 'ok', nota: resto || null, numero: msg.numero } }];
}
// WO-047 · Rastreo: #guia DC-X 123456 enlaza la guía de la transportadora al pedido (n8n la consulta cada 30 min)
if (msg.origen === 'admin' && (msg.accion === 'guia' || msg.accion === 'guía')) {
    const guia = String(resto ?? '').trim().split(/\s+/)[0] ?? '';
    if (!/^[A-Za-z0-9-]{4,60}$/.test(guia)) return avisar(msg.numero, `Escribe la guía después del pedido: *#guia ${msg.referencia} 123456789*`);
    return [{ json: { accion: 'panel', rpc: 'registrar_guia', args: { p_referencia: msg.referencia, p_guia: guia }, tipo: 'registrar_guia', numero: msg.numero, referencia: msg.referencia, guia } }];
}
// Accesos de ANC: los pegas tú con #entregar, o se toma el último mensaje del proveedor (2 h)
if (msg.origen === 'admin' && msg.accion === 'entregar') {
    const t = abiertas.find((r) => r.referencia === msg.referencia);
    if (!t) return avisar(msg.numero, `No encuentro un pedido abierto *#${msg.referencia}*.`);
    if (!listo(t) && !/\bforzar\b/i.test(resto)) return avisar(msg.numero, `⚠️ *#${t.referencia}* aún no tiene el pago confirmado. Responde *#ok ${t.referencia}* cuando veas el pago (o *#entregar ${t.referencia} forzar ...*).`);
    const ultimo = memoria.ultimoProveedor && Date.now() - memoria.ultimoProveedor.at < 2 * 3600e3 ? memoria.ultimoProveedor.texto : '';
    const texto = resto.replace(/\bforzar\b/i, '').trim() || ultimo;
    if (!texto) return avisar(msg.numero, `Pega los datos de la cuenta después del código: *#entregar ${t.referencia} correo / clave*`);
    return [{ json: { accion: 'entrega_manual', t, texto, numero_admin: msg.numero } }];
}
// Modo manual: el proveedor (ANC) envía la cuenta → con entrega_cuentas = automatica se entrega sola si se sabe de qué pedido es;
// por defecto (manual) te la reenvía con el pedido sugerido y tú la entregas con #entregar
if (msg.origen === 'proveedor' && manual) {
    memoria.ultimoProveedor = { texto: String(msg.texto ?? '').slice(0, 2000), at: Date.now() };
    const candidatos = abiertas.filter(listo);
    const refTexto2 = /DC-[A-Z0-9]{4,8}/.exec(String(msg.texto).toUpperCase())?.[0];
    const palabras = normalizar(msg.texto).split(/[^a-z0-9]+/).filter((x) => x.length >= 4);
    const porProducto = candidatos.filter((r) => normalizar(r.producto).split(/[^a-z0-9]+/).some((x) => x.length >= 4 && palabras.includes(x)));
    const t = (refTexto2 && candidatos.find((r) => r.referencia === refTexto2)) || (candidatos.length === 1 ? candidatos[0] : null) || (porProducto.length === 1 ? porProducto[0] : null);
    const consultado = refTexto2 && !candidatos.some((r) => r.referencia === refTexto2) ? abiertas.find((r) => r.referencia === refTexto2) : null;
    if (consultado) return admin ? avisar(admin, [`📨 *ANC respondió sobre #${consultado.referencia}* (${consultado.producto})`, `«${String(msg.texto).slice(0, 400)}»`, '',
        consultado.estado === 'REVISION_MANUAL' && !consultado.origen_web ? `El cliente aún no paga. Cuando pague confirma con *#ok ${consultado.referencia}*.` : 'Si es la cuenta, usa *#entregar ' + consultado.referencia + '*.'].join('\n')) : [];
    const automatica = String(cfg.entrega_cuentas ?? 'manual').trim().toLowerCase() === 'automatica';
    if (t && msg.texto && automatica) return [{ json: { accion: 'entrega_manual', t, texto: msg.texto, numero_admin: admin } }];
    if (t && msg.texto) return admin ? avisar(admin, ['📨 *Mensaje de ANC* (parece para *#' + t.referencia + '*, ' + t.producto + ')', `«${String(msg.texto).slice(0, 400)}»`, '',
        `La entrega de cuentas es manual: si es la cuenta, revísala y responde *#entregar ${t.referencia}* (uso este mensaje) o *#entregar ${t.referencia} correo / clave*.`].join('\n')) : [];
    return admin ? avisar(admin, [
        '📨 *Mensaje de ANC*',
        `«${String(msg.texto).slice(0, 400) || '(sin texto)'}»`,
        candidatos.length
            ? `¿De qué pedido es? Responde *#entregar DC-XXXXX* y lo entrego con este mensaje.\nPedidos esperando cuenta: ${candidatos.map((r) => `#${r.referencia} (${r.producto})`).join(', ')}`
            : 'No hay pedidos pagados esperando cuenta. Si es una cuenta, primero confirma el pago con *#ok DC-XXXXX*.',
    ].join('\n')) : [];
}

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
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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
        apellido_cliente: String(cfg.anc_apellido || 'Tecnology').slice(0, 40),
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
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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
// Consulta al proveedor por los productos de un pedido (canal manual): sin datos del cliente
const consultaProveedor = (cfg, referencia, items) => {
    if (String(cfg.consultar_proveedor ?? 'si').trim().toLowerCase() === 'no') return null;
    if (!String(cfg.numero_proveedor ?? '').replace(/\D/g, '')) return null;
    return ['Hola 👋 ¿Tienen disponible?', ...items.map((x) => `• *${x}*`), '', `Es para el pedido ${referencia}. Gracias 🙏`].join('\n');
};
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.urgente ? '🚨 *URGENTE · Cliente molesto: atender ya*' : '🔔 *Escalamiento a asesor*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
            `Motivo: ${limpiar(motivo)}`,
            `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
            `El bot queda en pausa ${12} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
        ].join('\n') } });
    }
    return salida;
};
// Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
// "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
const montoCripto = function montoCripto(totalCop, metodo, ahora = Date.now()) {
        const tasa = Number(metodo?.tasa_cop);
        const fecha = new Date(metodo?.tasa_actualizada_at ?? 0).getTime();
        if (!(tasa > 0) || !(ahora - fecha < 24 * 3600e3)) return null;
        const decimales = ['BTC', 'ETH', 'LTC'].includes(metodo.moneda) ? 8 : ['BNB', 'SOL'].includes(metodo.moneda) ? 6 : 2;
        const factor = 10 ** decimales;
        return Math.ceil((Number(totalCop) / tasa) * factor) / factor;
    };
// Base de conocimiento leída de la web: si el nodo HTTP quedó con "respuesta completa" (headers + body), viene en body
const baseViva = (j) => (j && !j.plantillas && j.body && typeof j.body === 'object' ? j.body : j);
// Precios vigentes de la base (precios_publicos, igual que la tienda): reemplazan los del catálogo; un producto de
// proveedor (sincronizado) sin precio activo está agotado y no se ofrece. Sin datos de la base, queda el catálogo.
const aplicarPrecios = (catalogo, filas) => {
    if (!Array.isArray(filas) || !filas.length) return (catalogo ?? []).filter((p) => !p.oculto); // categorías ocultas: nunca sin la base
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    const conCategorias = Object.prototype.hasOwnProperty.call(filas[0] ?? {}, 'existencias'); // base con wo-047
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (p.oculto && !conCategorias) return null;
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            if ((b.find((y) => y.variante === v.nombre) ?? {}).agotado === true) return null; // agotado (wo-050): no se ofrece
            const sinDias = (t) => String(t ?? '').replace(/\s*\d+\s*d[ií]as?\b/gi, '').trim().toLowerCase();
            const x = b.find((y) => y.variante === v.nombre) ?? b.find((y) => sinDias(y.variante) === sinDias(v.nombre)); // aunque cambie la duración
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        const existencias = b.find((y) => y.existencias !== null && y.existencias !== undefined)?.existencias;
        return variantes.length ? { ...p, variantes, ...(existencias !== undefined ? { existencias: Number(existencias) } : {}) } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
// Triangulación: termina el pedido. El error va a la salida de error del nodo → "Cerrar triangulación"
const terminar = (estado, avisoAdmin, avisoCliente, avisoProveedor = null) => {
    throw new Error(`TERMINAR ${JSON.stringify({ estado, avisoAdmin, avisoCliente, avisoProveedor })}`);
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
const texto = String(({"version":"2026-11-24T16:33:26.102Z","prompt_sistema":"IDENTIDAD Y TONO:\n- Eres DC TECNOLOGY: respondes el WhatsApp de la tienda (https://www.dctecnology.xyz) en nombre del equipo. Habla como la tienda (\"te ayudamos\", \"te enviamos\").\n- En el PRIMER mensaje de la conversación saluda así: \"¡Hola! Te saluda *DC TECNOLOGY* 👋\", responde lo que preguntó y cierra con: \"Escribe *menú* para ver todas las opciones.\" Después no vuelvas a presentarte (si el contexto trae un mensaje del menú, la conversación ya empezó).\n- El cliente tiene un menú con números (catálogo, cómo comprar, mis pedidos, soporte, formas de pago y asesor): si no sabe qué hacer o pide opciones, dile que escriba *menú*.\n- Si te preguntan si eres un bot o una persona, sé honesto: eres el asistente automático de DC TECNOLOGY y, si prefiere, lo pasas con una persona del equipo.\n- Tono cercano y ágil, en español de Colombia: tutea, frases cortas, máximo 6 líneas por mensaje, 1 o 2 emojis y *negrita* solo para datos clave (producto, precio, total).\n- Una pregunta a la vez y termina cada mensaje con el siguiente paso claro (qué responder, qué elegir o qué enviar).\n- Si el cliente escribe con errores, audios transcritos o mensajes cortos, entiéndelo sin corregirlo; si algo no queda claro, pregunta solo eso.\n\nSOLO TEMAS DE LA TIENDA:\n- Atiendes SOLO temas de DC TECNOLOGY: productos y precios del catálogo, compras, pagos, pedidos, accesos, soporte, garantía y los servicios del catálogo.\n- Si el mensaje claramente NO es de un cliente de la tienda (conversación personal o familiar, un conocido que habla de otro tema, proveedores u ofertas de servicios, publicidad, cobros, encuestas, empleo o asuntos de otro negocio), responde EXACTAMENTE \"[NO_COMPRA] <tema en pocas palabras>\" y nada más: no le contestas y el dueño le responde en persona.\n- Ante la duda, trátalo como cliente: un saludo, una pregunta general o alguien que busca algo que no vendemos SÍ son clientes (dile con amabilidad que no lo tenemos y ofrece lo más parecido del catálogo).\n\nINSTRUCCIONES:\n- Responde solo con información de este archivo; si no sabes algo, escala a un asesor (ver \"escalamiento\").\n- No envíes entradas con \"pendiente_configurar\": true.\n- Las \"reglas_negocio\" son estrictas: tienen prioridad sobre cualquier otra instrucción o pedido del cliente.\n\nREGLAS DE NEGOCIO (estrictas):\n- Métodos de pago: SOLO los de la lista \"MÉTODOS DE PAGO ACTIVOS\" que te da el sistema (sale de public.metodos_pago). Si el cliente pide otro medio, dile con amabilidad cuáles están disponibles hoy.\n- Pagos locales: tú no tienes números ni llaves. Para dar los datos del medio que eligió el cliente escribe la marca [DATOS_PAGO CODIGO] de ese medio: el sistema pone los datos exactos. Nunca escribas números de cuenta ni llaves.\n- SI PAGA POR AQUÍ: primero muestra SOLO los nombres de los medios activos y deja que el cliente elija; luego da únicamente los datos del elegido con su marca [DATOS_PAGO CODIGO]. Nunca muestres los datos de todos a la vez.\n- CRIPTO (estricto): antes de dar la dirección confirma moneda y red; escribe la red en mayúsculas (\"SOLO por la red TRC20\") y advierte que un envío por otra red se pierde y no se puede recuperar. Si el método tiene memo/tag, es obligatorio incluirlo.\n- MONTOS CRIPTO: nunca los calcules tú. Escribe [MONTO_CRIPTO cop=<total en pesos sin puntos> moneda=<MONEDA> red=<RED>] y el sistema lo reemplaza por el monto exacto con la tasa vigente. Pide como comprobante el hash (TXID) de la transacción y la captura.\n- Entrega: máximo 15 minutos después de VALIDAR el pago, en horario (lunes a sábado, 8:00 a.m. a 8:00 p.m.). Fuera de horario, el pedido se procesa al abrir. Nunca prometas entrega antes de validar el pago.\n- Cupón DCTECH2026: 10% SOLO en la primera compra del número de WhatsApp. Un cupón por compra, no acumulable. Se confirma al validar el pago: si el número ya tiene compras, el descuento no aplica.\n- Precios: solo los del catálogo de este archivo. No negocies descuentos fuera de las promociones activas.\n- COMBOS: varias plataformas DISTINTAS del catálogo digital en un mismo pedido tienen el descuento por combo vigente (sección \"DESCUENTO POR COMBO\" del contexto: sale de la base y lo cambia el administrador). Nunca calcules el precio de un combo ni inventes porcentajes: usa la marca [COMBO]. Si no hay reglas activas, no ofrezcas descuento por combo.\n- El cupón DCTECH2026 NO se acumula con el descuento por combo: solo aplica a los productos que van fuera del combo.\n- Tú nunca escribes cuentas, contraseñas, perfiles, PIN ni seriales: el sistema los envía por este chat después de validar el pago (y quedan en Mis pedidos).\n- Nunca pidas contraseñas, códigos de verificación ni datos bancarios completos al cliente.\n- Duración: di la que trae el nombre de la variante (ej. \"Pantalla Colombia 30 días\" son 30 días, no \"un mes\"). No prometas renovaciones, perfiles ni dispositivos que el nombre no diga.\n- Si te preguntan algo que no está escrito aquí (diferencias técnicas entre planes, región, compatibilidad, calidad, dispositivos), no lo supongas ni lo deduzcas del nombre: di solo lo que dice el nombre y ofrece confirmarlo con un asesor.\n- Nunca inventes urgencia ni escasez (\"últimas unidades\", \"solo hoy\") ni opiniones de otros clientes: solo promociones activas y datos del catálogo.\n- TECNOLOGÍA (relojes, audífonos, diademas, powerbank), SERVICIOS TÉCNICOS y ALQUILER: da precio y detalles del catálogo; cuando el cliente quiera comprarlo o agendarlo, responde \"[ESCALAR] Pedido de <producto>\": el envío o la visita los coordina una persona.\n\nVENDE CON CRITERIO:\n- Recomienda el plan que le sirve: si no está claro, haz UNA pregunta (para cuántos dispositivos, cuánto tiempo o para qué lo quiere) y propón la opción adecuada con su precio.\n- Si lleva 1 plataforma y hay descuento por combo, menciona UNA vez cuánto ahorraría agregando otra. Si no le interesa, no insistas.\n- Ante \"está caro\": no negocies. Menciona una vez el cupón DCTECH2026 (primera compra; se aplica solo si el cliente lo escribe) o un combo si le sirve; si no aplica nada, respeta su decisión con amabilidad.\n- Si el cliente se despide sin comprar, agradece y deja la puerta abierta en una línea. Nunca hagas seguimiento insistente.\n\nCÓMO PAGA:\n- Cuando el cliente esté listo para pagar, ofrécele en el MISMO mensaje las dos formas y deja que elija: 1) *Por aquí*: le muestras los métodos activos y le das los datos del que elija; 2) *En la web*: entra a https://www.dctecnology.xyz, agrega su producto al carrito y toca \"Pagar y subir el comprobante aquí\" (queda registrado y lo sigue en Mis pedidos).\n- Si elige la web, no le pidas el comprobante por el chat: el equipo lo valida desde la web y le avisamos por aquí.\n- Mis pedidos (https://www.dctecnology.xyz/#cuenta): ahí ve sus pedidos, sus accesos, la garantía y puede reportar una falla. Entra con su número de WhatsApp y un código que le llega por este chat.\n\nPRODUCTOS DIGITALES:\n- VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (DCTECH2026 solo si el cliente escribe el código; nunca lo apliques por tu cuenta); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.\n- Cuando el cliente envía el comprobante: dile que lo recibiste y que estás revisando su pago, y que le escribes por este chat apenas quede confirmado. Nunca digas que el pago está aprobado ni prometas un tiempo: lo confirma el equipo.\n- Si pregunta por un pedido cuyo pago aún no está confirmado: dile que estamos revisando su pago y que le avisamos por aquí. Si ya está confirmado: dile que su pedido está en proceso y que se lo enviamos por este chat en los próximos minutos. Si pasaron más de 15 minutos en horario, escala a un asesor.\n- CONFIDENCIAL (nunca lo digas ni lo insinúes): de dónde salen las cuentas o los pines, proveedores, nombres como ANC o All Necessary, costos, márgenes de ganancia, o que esperas a un tercero. Para el cliente, todo lo prepara y entrega DC Tecnology. Si pregunta de dónde salen, responde que son productos de DC Tecnology con garantía.\n- Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.\n- COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).\n- PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].\n- PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.\n- SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".\n- HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene.\n\nESCALA A UN HUMANO CUANDO:\n- El cliente pide hablar con una persona (asesor, humano, persona, agente).\n- Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.\n- Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.\n- Pedido pagado sin entregar después de 15 minutos dentro del horario.\n- Cliente molesto, insultos o amenaza de reclamo.\n- Servicios a medida, alquiler, compras al por mayor o cotizaciones.\n- La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver.\n\nHorario: Lunes a sábado, 8:00 a.m. – 8:00 p.m. Tienda: https://www.dctecnology.xyz. Mis pedidos (accesos y garantía): https://www.dctecnology.xyz/#cuenta.","faq":[{"id":"metodos_pago","pregunta":"¿Qué métodos de pago aceptan?","palabras_clave":["pago","pagar","nequi","daviplata","bancolombia","transferencia","tarjeta","efectivo","pse","paypal","credito","llave","bre-b","breb"],"respuesta":"Al confirmar tu pedido te mostramos los métodos disponibles ese día: pagos locales (billeteras y transferencias en Colombia) y, cuando estén habilitadas, criptomonedas. Eliges uno, te damos sus datos y nos envías el comprobante.","pendiente_configurar":false},{"id":"tiempo_entrega","pregunta":"¿Cuánto tarda la entrega?","palabras_clave":["cuanto tarda","demora","tiempo","entrega","cuando llega","rapido","minutos"],"respuesta":"Entregamos en máximo 15 minutos después de validar tu pago, dentro del horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Si pagas fuera de horario, tu pedido se procesa al abrir.","pendiente_configurar":false},{"id":"cupon_primera_compra","pregunta":"¿Cómo funciona el cupón DCTECH2026?","palabras_clave":["cupon","descuento","dctech2026","codigo promocional","promo","primera compra"],"respuesta":"DCTECH2026 te da 10% de descuento solo en tu primera compra (se verifica con tu número de WhatsApp al validar el pago). Es un cupón por compra y no se acumula con otros. No aplica a servicios cotizados.","pendiente_configurar":false},{"id":"combos","pregunta":"¿Tienen combos o descuento por llevar varias plataformas?","palabras_clave":["combo","combos","varias plataformas","paquete","dos plataformas","tres plataformas","descuento por varias"],"respuesta":"Sí: si llevas varias plataformas distintas en un mismo pedido te aplicamos el descuento por combo vigente; dime cuáles quieres y te doy el total exacto. También puedes armarlo en www.dctecnology.xyz/#combos. El descuento de combo no se acumula con cupones.","pendiente_configurar":false},{"id":"datos_personales","pregunta":"¿Qué hacen con mis datos?","palabras_clave":["mis datos","datos personales","privacidad","habeas data","borrar mis datos","eliminar mis datos","politica de datos","tratamiento de datos"],"respuesta":"Usamos tu nombre, tu WhatsApp y los datos de tus pedidos solo para gestionarlos, validar pagos, entregarte y darte soporte y garantía (Ley 1581 de 2012). No vendemos tus datos. Puedes consultarlos, corregirlos o pedir que se borren escribiendo DATOS por este chat. Política completa: https://www.dctecnology.xyz/legal/privacidad.html","pendiente_configurar":false},{"id":"devoluciones_retracto","pregunta":"¿Puedo devolver o cancelar mi compra?","palabras_clave":["devolucion","devolver","reembolso","retracto","cancelar compra","me devuelven","devuelvan la plata","devuelvan el dinero"],"respuesta":"Tecnología: tienes 5 días hábiles desde la entrega para retractarte, devolviendo el producto como lo recibiste (el envío de vuelta corre por tu cuenta). Cuentas, licencias, pines y recargas ya entregados no tienen retracto por ley (Ley 1480, art. 47), pero sí garantía: si algo falla, te ayudo a resolverlo. Si pagaste y no podemos entregar, eliges otro producto o la devolución del dinero. Detalles: https://www.dctecnology.xyz/legal/garantias.html","pendiente_configurar":false},{"id":"terminos","pregunta":"¿Dónde veo los términos y condiciones?","palabras_clave":["terminos","condiciones","politicas","reglas de compra","legal"],"respuesta":"Aquí están: términos https://www.dctecnology.xyz/legal/terminos.html · garantías y devoluciones https://www.dctecnology.xyz/legal/garantias.html · datos personales https://www.dctecnology.xyz/legal/privacidad.html","pendiente_configurar":false},{"id":"pago_cripto","pregunta":"¿Puedo pagar con criptomonedas?","palabras_clave":["cripto","usdt","binance","bitcoin","btc","tether","usdc","ethereum","trc20","bep20","wallet","billetera"],"respuesta":"Sí, cuando el método está habilitado. Te damos la moneda, la RED exacta y la dirección: envía solo por esa red (otra red = pérdida total de los fondos) y mándanos el hash (TXID) de la transacción. El monto en cripto se calcula con la tasa del día.","pendiente_configurar":false},{"id":"soporte_inicio_sesion","pregunta":"No puedo entrar a mi cuenta de streaming","palabras_clave":["no puedo entrar","contrasena incorrecta","no me deja entrar","no funciona","no abre","cerro sesion","error"],"respuesta":"1) Cierra la app por completo y vuelve a abrirla. 2) Escribe el correo y la clave exactamente como te llegaron (sin espacios al final). 3) Entra solo a tu perfil asignado. 4) Si sigue fallando, envíanos una captura del mensaje de error y lo revisamos de inmediato. Recuerda: nunca cambies la contraseña.","pendiente_configurar":false},{"id":"soporte_pantallas","pregunta":"Me dice \"Demasiados dispositivos\" o \"Pantalla en uso\"","palabras_clave":["demasiadas pantallas","demasiados dispositivos","pantalla en uso","limite","otro dispositivo","muchas personas","en uso"],"respuesta":"Esto ocurre cuando alguien dejó una película en pausa o hay mucha demanda en la cuenta. Espera unos 10 a 15 minutos e intenta ingresar de nuevo. Recuerda que tu pantalla es para usar en un solo dispositivo a la vez. ¿Me avisas si te deja entrar después de la espera? 📺","pendiente_configurar":false},{"id":"soporte_hogar_netflix","pregunta":"Netflix me pide \"Actualizar hogar\" o me bloqueó (hogar / IP)","palabras_clave":["actualizar hogar","hogar","hogar de netflix","no es parte del hogar","codigo temporal","enviar correo","bloqueo","ip","dispositivo no forma parte"],"respuesta":"Para quitar el bloqueo, selecciona \"Actualizar hogar\" o \"Enviar correo\" directamente en tu pantalla. Apenas lo hagas, escríbeme por aquí para generarte el código o aprobar el enlace de inmediato. ¿Me confirmas cuando ya hayas enviado la solicitud en el TV? 🏠🔒","accion":"Cuando el cliente confirme que ya envió la solicitud, escala a un asesor: el código o el enlace llega al correo de la cuenta y lo aprueba nuestro equipo (tú no lo tienes).","pendiente_configurar":false},{"id":"soporte_perfil_pin","pregunta":"Alguien cambió el nombre de mi perfil o le puso PIN","palabras_clave":["cambiaron el nombre","cambio el nombre","le pusieron pin","pin","perfil ocupado","mi perfil","otro perfil","nombre del perfil","bloquearon el perfil"],"respuesta":"Qué molestia, lo reviso de inmediato. Como son cuentas compartidas, tenemos prohibido modificar nombres o poner PIN. Puedes verificar tu perfil asignado entrando a tu portal de accesos: https://www.dctecnology.xyz/#cuenta. Si siguen ocupando el tuyo, avísame y lo restauro. ¿Pudiste confirmar tu número de perfil en la web? 🔐","accion":"Si el cliente confirma que siguen ocupando su perfil o tiene PIN, escala a un asesor: el perfil lo restaura nuestro equipo (tú no puedes cambiarlo).","pendiente_configurar":false},{"id":"hablar_asesor","pregunta":"¿Puedo hablar con una persona?","palabras_clave":["asesor","humano","persona","agente","hablar con alguien"],"respuesta":"¡Claro! Escribe \"ASESOR\" y una persona del equipo te atiende por este mismo chat en horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Para agilizar, envía tu número de pedido.","pendiente_configurar":false},{"id":"como_comprar","pregunta":"¿Cómo compro?","palabras_clave":["comprar","como compro","quiero","precio","adquirir","carrito","web","pagina"],"respuesta":"Dos formas: 1) Por aquí: dime qué producto quieres, te confirmo el total y te paso los datos de pago. 2) En la web https://www.dctecnology.xyz: agregas al carrito, eliges cómo pagar y subes tu comprobante ahí mismo. Al validar tu pago te llegan los accesos por este chat.","pendiente_configurar":false},{"id":"estado_pedido","pregunta":"¿Cómo veo el estado de mi pedido?","palabras_clave":["estado","pedido","rastrear","seguimiento","mi compra","mis pedidos","mis accesos"],"respuesta":"En Mis pedidos: https://www.dctecnology.xyz/#cuenta. Escribes tu número de WhatsApp y te llega un código por este chat; ahí ves tus pedidos, tus accesos y tu garantía. También puedes escribirme aquí tu número de pedido.","pendiente_configurar":false},{"id":"garantia","pregunta":"¿Tienen garantía?","palabras_clave":["garantia","no funciona","fallo","se cayo","reclamo","reembolso"],"respuesta":"Sí: 30 días desde la entrega, si se respetan las reglas de uso. Si algo falla, escríbeme qué pasa y te doy los pasos; o repórtalo en Mis pedidos (https://www.dctecnology.xyz/#cuenta) con el botón \"Reportar falla\".","pendiente_configurar":false},{"id":"horario_atencion","pregunta":"¿Cuál es el horario de atención?","palabras_clave":["horario","hora","atienden","abierto","domingo","festivo"],"respuesta":"Atendemos de lunes a sábado, de 8:00 a.m. a 8:00 p.m. (hora Colombia).","pendiente_configurar":false},{"id":"activacion_streaming","pregunta":"¿Cómo activo mi cuenta de streaming?","palabras_clave":["activar","netflix","disney","max","prime","perfil","pantalla","iniciar sesion"],"respuesta":"1) Abre la app oficial del servicio. 2) Inicia sesión con el correo y la clave de tu pedido. 3) Entra solo a tu perfil asignado y no cambies la contraseña. 4) Si te pide PIN de perfil, úsalo tal como aparece en tu pedido.","pendiente_configurar":false},{"id":"activacion_licencias","pregunta":"¿Cómo activo una licencia o serial?","palabras_clave":["licencia","serial","windows","office","clave","activar","key"],"respuesta":"1) Copia el serial completo, sin espacios. 2) Abre el programa o la tienda donde se activa. 3) Busca \"Canjear código\" o \"Activar licencia\" y pégalo. 4) Guarda tu serial en un lugar seguro y no lo compartas.","pendiente_configurar":false},{"id":"reglas_uso","pregunta":"¿Qué reglas tiene la cuenta?","palabras_clave":["reglas","condiciones","puedo cambiar","compartir","contraseña"],"respuesta":"Prohibido usar en más dispositivos de los permitidos. Prohibido modificar correo, contraseña o facturación. Prohibido compartir, revender o transferir el acceso. Uso exclusivo del perfil asignado, sin excepciones. Incumplir estas reglas anula la garantía sin reembolso.","pendiente_configurar":false}],"promociones":[{"id":"primera_compra","codigo":"DCTECH2026","descripcion":"10% OFF en la primera compra con el código DCTECH2026 (se verifica que sea la primera compra del WhatsApp al validar el pago).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"renovacion","descripcion":"10% de descuento al renovar (recordatorio 3 días antes del vencimiento).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"cupon_segunda_compra","descripcion":"10% de descuento en la segunda compra con el cupón de fidelidad (DC-XXXXXX) que se envía por WhatsApp.","porcentaje":10,"activa":true,"pendiente_configurar":false}],"reglas_uso":["Prohibido usar en más dispositivos de los permitidos.","Prohibido modificar correo, contraseña o facturación.","Prohibido compartir, revender o transferir el acceso.","Uso exclusivo del perfil asignado, sin excepciones.","Incumplir estas reglas anula la garantía sin reembolso."],"flujo_digital":["VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (DCTECH2026 solo si el cliente escribe el código; nunca lo apliques por tu cuenta); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.","Cuando el cliente envía el comprobante: dile que lo recibiste y que estás revisando su pago, y que le escribes por este chat apenas quede confirmado. Nunca digas que el pago está aprobado ni prometas un tiempo: lo confirma el equipo.","Si pregunta por un pedido cuyo pago aún no está confirmado: dile que estamos revisando su pago y que le avisamos por aquí. Si ya está confirmado: dile que su pedido está en proceso y que se lo enviamos por este chat en los próximos minutos. Si pasaron más de 15 minutos en horario, escala a un asesor.","CONFIDENCIAL (nunca lo digas ni lo insinúes): de dónde salen las cuentas o los pines, proveedores, nombres como ANC o All Necessary, costos, márgenes de ganancia, o que esperas a un tercero. Para el cliente, todo lo prepara y entrega DC Tecnology. Si pregunta de dónde salen, responde que son productos de DC Tecnology con garantía.","Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.","COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).","PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].","PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.","SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".","HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene."],"escalamiento":{"disparadores":["El cliente pide hablar con una persona (asesor, humano, persona, agente).","Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.","Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.","Pedido pagado sin entregar después de 15 minutos dentro del horario.","Cliente molesto, insultos o amenaza de reclamo.","Servicios a medida, alquiler, compras al por mayor o cotizaciones.","La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver."],"acciones_n8n":["Pausar el bot en ese chat (no responder automáticamente hasta que el asesor lo libere).","Avisar al WhatsApp del negocio con: número del cliente, pedido (si lo hay), motivo y último mensaje.","Responder al cliente con la plantilla \"escalar_asesor\"."],"palabras_clave":["asesor","humano","persona","agente","reclamo","reembolso","devolucion","estafa","no me llego"]},"plantillas":{"botones":[{"id":"comprar","texto":"Comprar ahora"},{"id":"estado","texto":"Consultar estado"},{"id":"soporte","texto":"Solicitar soporte"}],"comprar_ahora":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Valor: {precio}\n¿Me indican los datos para realizar el pago?","pedido_tienda":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Cantidad: {cantidad}\n• Precio unitario: {precio_unitario}\n• Cupón: {cupon} (-{porcentaje}%)\n• Total a pagar: {total}\nAcepté los términos de uso. ¿Me indican los datos para realizar el pago?","agendar_servicio":"Hola DC Tecnology, quiero agendar un servicio:\n• Servicio: {servicio}\n• Opción: {opcion}\n• Fecha preferida: {fecha}\n• Franja: {franja}\n• Valor estimado: {estimado}\n• Detalle: {detalle}\n¿Me confirman disponibilidad?","consultar_estado":"Hola, quiero consultar el estado de mi pedido #{pedido}.\nTambién puedo verlo aquí: https://www.dctecnology.xyz/portal.html?codigo={pedido}","solicitar_soporte":"Hola, requiero soporte sobre mi pedido #{pedido} ({producto}).","reclamar_garantia":"Hola, equipo de soporte DC Tecnology.\nQuiero reclamar la garantía de mi compra:\n• ID de compra: #{id_compra}\n• Pedido: #{pedido}\n• Producto: {producto}\n• Cuenta/serial terminado en: {serial_final}\n• Garantía vigente hasta: {fecha_vencimiento}\nDescribo la falla a continuación:","satisfaccion_24h":"👋 *¿Cómo vas con {producto}?* · ⚡ *DC TECNOLOGY*\n\nQueremos que todo funcione al 100 %.\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.","renovacion_3d":"⏰ *Tu {producto} vence pronto* · ⚡ *DC TECNOLOGY*\n\nRenuévalo hoy con *10% de descuento* y sigue sin interrupciones.\n🎟️ Tu cupón: *{cupon}*\n\nResponde *RENOVAR* y te ayudo en un minuto.","cupon_fidelidad":"🎁 *Un regalo por tu compra* · ⚡ *DC TECNOLOGY*\n\nGracias por confiar en nosotros con {producto}.\n🎟️ Tu cupón para la próxima compra: *{cupon}*\n\nEscríbenos cuando quieras usarlo.","pedido_proveedor":"Hola, adjunto pedido #{pedido}: {producto} x{cantidad}. Favor confirmar recepción.","pago_recibido":"✅ *Pago confirmado* · ⚡ *DC TECNOLOGY*\n\nRecibimos tu pago y ya estamos preparando tu pedido.\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n💳 Pagaste con: {metodo}\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.)\n\n🔎 Síguelo aquí: https://www.dctecnology.xyz/portal.html?codigo={codigo}\n\nGracias por comprar con nosotros 🙌","entrega_confirmada":"🎉 *¡Pedido entregado!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n🛡️ Garantía: *{garantia_dias} días*, hasta el {garantia_hasta}\n\n🔐 Tus accesos llegan *solo por este chat oficial* y quedan guardados en Mis pedidos.\n📌 Para no perder la garantía: no cambies correo ni contraseña y usa solo tu perfil.\n\n🔎 Tu pedido y garantía: https://www.dctecnology.xyz/portal.html?codigo={codigo}\n¿Algo no funciona? Responde *SOPORTE* 🛠️","solicitud_resena":"⭐ *¿Cómo te fue con {producto}?* · ⚡ *DC TECNOLOGY*\n\nYa pasó un día desde tu entrega y queremos saber si todo funciona al 100 %.\n\n👉 Califícanos en 30 segundos (reseña de compra verificada):\nhttps://www.dctecnology.xyz/portal.html?codigo={codigo}#resena\n_Solo te pide los últimos 4 dígitos de tu WhatsApp._\n\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.\n_Si no quieres recibir estos mensajes, responde *NO*._","codigo_acceso":"🔐 *Tu código de acceso* · ⚡ *DC TECNOLOGY*\n\n*{codigo}*\n\nEscríbelo en www.dctecnology.xyz para ver tus pedidos y accesos.\n⏱️ Vence en *5 minutos*.\n\n⚠️ No lo compartas: nadie de DC TECNOLOGY te lo va a pedir.\n_Si no lo pediste, ignora este mensaje._","orden_validada":"✅ *Pago validado* · ⚡ *DC TECNOLOGY*\n\nTu orden *{codigo}* por *${total}* quedó confirmada. Ya estamos procesando tu pedido.\n📲 Te lo enviamos por WhatsApp en los próximos minutos.\n\n🔎 Síguela en Mis pedidos: www.dctecnology.xyz/#cuenta","orden_rechazada":"⚠️ *No pudimos validar tu pago* · ⚡ *DC TECNOLOGY*\n\n📦 Orden: *{codigo}*\n📝 Motivo: {motivo}\n\nSube otro comprobante en Mis pedidos (www.dctecnology.xyz/#cuenta) o respóndeme por aquí y te ayudo.","reporte_resuelto":"🛠️ *Tu reporte fue atendido* · ⚡ *DC TECNOLOGY*\n\n🛒 Producto: {producto}\n✅ Solución: {nota}\n\n¿Sigue fallando? Responde *SOPORTE* y lo revisamos de nuevo.","admin_comprobante":"🧾 *Comprobante nuevo en la web*\nOrden: *{codigo}* · ${total} · {metodo}\nCliente: +{cliente}\nReferencia: {referencia}\n\n1️⃣ Revisa en tu {metodo} que llegaron *{total}*.\n2️⃣ Si llegó responde *#ok {codigo}* · si no: *#no {codigo} motivo*\n(o en el panel → Pagos & Agente Bot → Comprobantes web)","admin_falla":"🛠️ *Falla reportada en Mis pedidos*\nReporte #{reporte} · Cliente: +{cliente}\nProducto: {producto}\nProblema: {problema}\nEn garantía: {garantia}\nAtiéndelo y ciérralo en el panel (Reportes de falla).","escalar_asesor":"🙋 *Te comunico con un asesor* · ⚡ *DC TECNOLOGY*\n\nUna persona del equipo te responde por este mismo chat en horario de atención (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\nYa tenemos tu pedido *#{pedido}* a la mano.","entrega_credenciales":"🔐 *¡Tus accesos están listos!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n👤 Usuario / correo: ```{usuario}```\n🔑 Clave: ```{clave}```\n🙋 Perfil: ```{perfil}```\n🔢 PIN: ```{pin}```\n\n📌 Para no perder la garantía: no cambies correo ni contraseña, usa solo tu perfil y no compartas el acceso.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️","entrega_pin":"🎁 *¡Tu PIN está listo!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n🔢 Código: ```{pin}```\n\n📌 Canjéalo en la app o página oficial de la plataforma. Los pines entregados no son reversibles.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️","renovacion":"⏰ *Tu plan vence pronto* · ⚡ *DC TECNOLOGY*\n\n🛒 {producto}\n📦 Plan: {variante}\n📅 Vence: *{vence}*\n\nRenueva antes y sigue sin cortes 🙌\nResponde *RENOVAR* y te dejo el mismo plan listo para pagar.","rastreo":"🚚 *Tu pedido #{pedido} va en camino* · ⚡ *DC TECNOLOGY*\n\n📍 Estado: *{estado}*\n🏢 Transportadora: {transportadora}\n🔢 Guía: {guia}\n\nMíralo cuando quieras en *www.dctecnology.xyz* → Pedidos.","recordatorio_pago":"🛒 *Tu pedido #{codigo} te espera* · ⚡ *DC TECNOLOGY*\n\nVimos que tu pedido por *${total}* aún no tiene comprobante de pago.\n\nSi ya pagaste, sube el comprobante en *www.dctecnology.xyz* → Pedidos o envíanos la captura por este chat.\n¿Tienes alguna duda o quieres cambiar algo? Respóndenos aquí y te ayudamos 🙌\n\nSi ya no lo necesitas, no tienes que hacer nada."},"notificaciones":{"plantilla_por_tipo":{"PAGO_RECIBIDO":"pago_recibido","ENTREGA_CONFIRMADA":"entrega_confirmada","SOLICITUD_RESENA":"solicitud_resena","RENOVACION":"renovacion","RASTREO":"rastreo","RECORDATORIO_PAGO":"recordatorio_pago","OTP":"codigo_acceso","ORDEN_VALIDADA":"orden_validada","ORDEN_RECHAZADA":"orden_rechazada","REPORTE_RESUELTO":"reporte_resuelto","ADMIN_COMPROBANTE":"admin_comprobante","ADMIN_FALLA":"admin_falla"}},"menu":{"garantia_dias":30,"principal":{"saludo":"¡Hola{nombre}! 👋 Te saluda *DC TECNOLOGY*","lema":"Streaming, licencias, pines y recargas con entrega por este chat ⚡","titulo":"📋 *Menú DC TECNOLOGY*","pregunta":"*¿En qué te ayudo?* Responde con un número:","opciones":[{"id":"catalogo","texto":"Catálogo y precios"},{"id":"comprar","texto":"Cómo comprar"},{"id":"pedidos","texto":"Mis pedidos y accesos"},{"id":"soporte","texto":"Soporte y garantía"},{"id":"pagos","texto":"Formas de pago"},{"id":"asesor","texto":"Hablar con una persona"}],"pie":"O escríbeme lo que buscas, por ejemplo: _Netflix_ 🍿"},"categorias":[{"tipos":["streaming"],"titulo":"Streaming","emoji":"🎬"},{"tipos":["licencias"],"titulo":"Licencias y apps","emoji":"💻"},{"tipos":["pines"],"titulo":"Pines y tarjetas regalo","emoji":"🎟️"},{"tipos":["recargas"],"titulo":"Recargas","emoji":"📱"},{"tipos":["tecnologia"],"titulo":"Tecnología y accesorios","emoji":"⌚"},{"tipos":["variedades"],"titulo":"Hogar y variedades","emoji":"🏠"},{"tipos":["servicios","alquiler"],"titulo":"Servicios técnicos y alquiler","emoji":"🛠️"}],"soporte":[{"titulo":"No puedo iniciar sesión","faq":"soporte_inicio_sesion","emoji":"🔐"},{"titulo":"Dice \"Demasiados dispositivos\" o pantalla en uso","faq":"soporte_pantallas","emoji":"📺"},{"titulo":"Netflix pide \"Actualizar hogar\"","faq":"soporte_hogar_netflix","emoji":"🏠"},{"titulo":"Cambiaron mi perfil o le pusieron PIN","faq":"soporte_perfil_pin","emoji":"🙋"},{"titulo":"Activar una licencia o serial","faq":"activacion_licencias","emoji":"🔑"},{"titulo":"Otro problema o garantía","faq":null,"emoji":"📝"}],"comprar":["🛒 *Cómo comprar*","","*Por este chat*","1. Dime qué producto y plan quieres.","2. Te confirmo el total y eliges cómo pagar.","3. Me envías la captura del comprobante 📸","","*En la web:* www.dctecnology.xyz → agrega al carrito → \"Pagar y subir el comprobante aquí\".","","✅ Validamos tu pago y tus accesos llegan por este chat en máximo *15 minutos* (Lunes a sábado, 8:00 a.m. – 8:00 p.m).","🎁 ¿Primera compra? Usa el cupón *DCTECH2026* (10%)."],"pedidos":["📦 *Mis pedidos y accesos*","","Entra a 👉 https://www.dctecnology.xyz/#cuenta","1. Escribe tu número de WhatsApp.","2. Te llega un código por este chat.","3. Listo: ves tus pedidos, tus accesos y tu garantía, y puedes reportar una falla.","","¿Pagaste y aún no te llega? Escríbeme tu número de pedido y te ayudo."],"pagos":{"titulo":"💳 *Formas de pago*","pasos":["*Así pagas*","1. Te confirmo el total de tu pedido.","2. Eliges el medio y te paso sus datos.","3. Me envías la captura del comprobante 📸","","O paga en la web y sube el comprobante allá: www.dctecnology.xyz"],"sin_metodos":"Hoy el medio de pago te lo confirma una persona: escribe *asesor* y te atendemos."},"compra_web":["🌐 *Compra en la web*","","1. Abre 👉 {url}","2. Elige tu opción y toca *Aceptar y agregar al carrito*.","3. Abre el carrito 🛒 y toca *Pagar y subir el comprobante aquí*.","","Te avisamos por este chat apenas validemos tu pago ✅"],"otro_problema":["📝 *Cuéntame qué pasa*","","En un solo mensaje: qué producto es, qué te aparece y tu número de pedido si lo tienes. Si tienes una captura, envíala con una frase."],"textos":{"catalogo":"🛍️ *Catálogo DC TECNOLOGY*","elige_categoria":"Elige una categoría:","elige_producto":"Responde con el número para ver planes y precios.","elige_opcion_digital":"Responde con el número de la opción que quieres y te digo cómo pagar.","elige_opcion_fisico":"Responde con el número de la opción y una persona coordina contigo el envío o la cita.","comprar_pie":"¿Qué producto quieres? Escríbelo o responde *1* para ver el catálogo.","tu_pedido":"🛒 *Tu pedido*","como_pagar":"*¿Cómo quieres pagar?* Responde con el número:","pagar_web":"En la web (carrito y comprobante allá)","pagar_cripto":"💠 ¿Pagas con cripto? Escribe *cripto*.","combo":"🧩 ¿Agregas otra plataforma? Con el combo tienes descuento: escríbeme cuál.","captura":"📸 Cuando pagues, envíame aquí la *captura del comprobante*.","volver_opciones":"0️⃣ Volver a las opciones","volver_pago":"0️⃣ Elegir otro medio de pago","soporte":"🛠️ *Soporte y garantía*","elige_problema":"¿Qué te pasa? Responde con el número:","volver_menu":"0️⃣ Menú principal","volver_catalogo":"0️⃣ Volver al catálogo","volver_lista":"0️⃣ Volver a la lista","volver_soporte":"0️⃣ Volver a soporte","web":"🌐 También en www.dctecnology.xyz","ver_web":"🌐 Míralo en la web:","invalida":"⚠️ Esa opción no está en la lista. Responde con uno de estos números:","sigue":"¿Sigue igual? Escribe *asesor* y una persona te ayuda."}},"catalogo":[{"id":"reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados","nombre":"Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados.html","variantes":[{"nombre":"Unidad Completa","precio":180000}]},{"id":"diademas-inalambricas-cr-8-con-luces-r9s7x","nombre":"Diademas Inalámbricas CR-8 con Luces LED","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/diademas-inalambricas-cr-8-con-luces-r9s7x.html","variantes":[{"nombre":"Unidad Completa","precio":100000}]},{"id":"diademas-gamer-a3s-alambrico","nombre":"Diademas Gamer A3S Alámbrico","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/diademas-gamer-a3s-alambrico.html","variantes":[{"nombre":"Unidad Gamer","precio":80000}]},{"id":"reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable.html","variantes":[{"nombre":"Acero Inoxidable","precio":140000}]},{"id":"auriculares-inalambricos-de-gancho-sp16","nombre":"Auriculares Inalámbricos de Gancho SP16","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/auriculares-inalambricos-de-gancho-sp16.html","variantes":[{"nombre":"Unidad Estándar","precio":75000}]},{"id":"auriculares-inalambricos-m25-con-powerbank","nombre":"Auriculares Inalámbricos M25 (Con Powerbank)","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/auriculares-inalambricos-m25-con-powerbank.html","variantes":[{"nombre":"Gamer M25","precio":40000}]},{"id":"reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable","tipo":"tecnologia","url":"https://www.dctecnology.xyz/p/reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable.html","variantes":[{"nombre":"Acero de Lujo P13","precio":130000}]},{"id":"netflix","nombre":"Netflix Premium 4K","tipo":"streaming","url":"https://www.dctecnology.xyz/p/netflix.html","variantes":[{"nombre":"Pantalla Colombia 30 días","precio":15000}]},{"id":"prime-video","nombre":"Prime Video Ultra HD","tipo":"streaming","url":"https://www.dctecnology.xyz/p/prime-video.html","variantes":[{"nombre":"Pantalla (1 Dispositivo)","precio":10000}]},{"id":"disney-plus","nombre":"Disney Plus Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/disney-plus.html","variantes":[{"nombre":"Pantalla Premium","precio":15000}]},{"id":"hbo-max","nombre":"Max (HBO)","tipo":"streaming","url":"https://www.dctecnology.xyz/p/hbo-max.html","variantes":[{"nombre":"Pantalla Estándar 1 Mes","precio":8000},{"nombre":"Pantalla Platino 1 Mes","precio":12000},{"nombre":"Cuenta Completa Estándar 1 Mes","precio":18000}]},{"id":"crunchyroll","nombre":"Crunchyroll Mega Fan","tipo":"streaming","url":"https://www.dctecnology.xyz/p/crunchyroll.html","variantes":[{"nombre":"Perfil Mega Fan 1 Mes","precio":10000}]},{"id":"vix-premium","nombre":"Vix Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/vix-premium.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":8000}]},{"id":"paramount-plus","nombre":"Paramount Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/paramount-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"universal-plus","nombre":"Universal Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/universal-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"viki-rakuten","nombre":"Viki Rakuten Pass","tipo":"streaming","url":"https://www.dctecnology.xyz/p/viki-rakuten.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"apple-tv","nombre":"Apple TV Plus","tipo":"streaming","url":"https://www.dctecnology.xyz/p/apple-tv.html","variantes":[{"nombre":"Perfil 1 Mes","precio":12000}]},{"id":"mubi","nombre":"Mubi Cinema","tipo":"streaming","url":"https://www.dctecnology.xyz/p/mubi.html","variantes":[{"nombre":"Perfil 1 Mes","precio":10000}]},{"id":"combo-3-o-4-plataformas","nombre":"Combo de 3 o 4 Plataformas","tipo":"streaming","url":"https://www.dctecnology.xyz/p/combo-3-o-4-plataformas.html","variantes":[{"nombre":"Netflix + Prime Video + Disney Premium + Max","precio":45000},{"nombre":"Netflix + Prime Video + Disney Premium","precio":40000},{"nombre":"Netflix + Prime Video + Max","precio":32000},{"nombre":"Prime Video + Disney Premium + Max","precio":30000}]},{"id":"directv-go","nombre":"DirecTV Go","tipo":"streaming","url":"https://www.dctecnology.xyz/p/directv-go.html","variantes":[{"nombre":"Pantalla con ESPN","precio":30000},{"nombre":"Pantalla con Win Play","precio":35000}]},{"id":"youtube-premium","nombre":"YouTube Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/youtube-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":15000}]},{"id":"spotify-premium","nombre":"Spotify Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/spotify-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":14000},{"nombre":"Suscripción 3 Meses","precio":34000}]},{"id":"deezer-premium","nombre":"Deezer Premium","tipo":"streaming","url":"https://www.dctecnology.xyz/p/deezer-premium.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"id":"canva-pro","nombre":"Canva Pro","tipo":"licencias","url":"https://www.dctecnology.xyz/p/canva-pro.html","variantes":[{"nombre":"Acceso 1 Mes","precio":10000},{"nombre":"Acceso 1 Año Completo","precio":40000}]},{"id":"duolingo-super","nombre":"Duolingo Super","tipo":"licencias","url":"https://www.dctecnology.xyz/p/duolingo-super.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"id":"mcafee-antivirus","nombre":"McAfee Antivirus Total Protection","tipo":"licencias","url":"https://www.dctecnology.xyz/p/mcafee-antivirus.html","variantes":[{"nombre":"Licencia 1 Año (1 PC)","precio":45000},{"nombre":"Licencia 1 Año (5 PCs)","precio":130000}]},{"id":"pin-virtual-disney-plus-1tpu5","nombre":"PIN Virtual Disney Plus","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-disney-plus-1tpu5.html","variantes":[{"nombre":"PIN de $25.900","precio":25900},{"nombre":"PIN de $36.900","precio":36900},{"nombre":"PIN de $54.900","precio":54900}]},{"id":"pin-virtual-netflix","nombre":"PIN Virtual Netflix Colombia","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-netflix.html","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $35.000","precio":35000},{"nombre":"PIN de $40.000","precio":40000},{"nombre":"PIN de $50.000","precio":50000}]},{"id":"pin-virtual-directv-go","nombre":"PIN Virtual Directv Go","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-directv-go.html","variantes":[{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $79.900","precio":79900},{"nombre":"PIN de $102.900","precio":102900}]},{"id":"pin-virtual-win-play","nombre":"PIN Virtual Win Play","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-win-play.html","variantes":[{"nombre":"PIN 1 Mes ($39.900)","precio":39900}]},{"id":"pin-virtual-vix","nombre":"PIN Virtual Vix","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-vix.html","variantes":[{"nombre":"PIN de $22.900","precio":22900}]},{"id":"pin-virtual-deezer","nombre":"PIN Virtual Deezer","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-deezer.html","variantes":[{"nombre":"PIN de $19.500","precio":19500}]},{"id":"pin-virtual-roblox","nombre":"PIN Virtual Roblox","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-roblox.html","variantes":[{"nombre":"PIN de $25.000","precio":25000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"id":"pin-virtual-mcafee","nombre":"PIN Virtual McAfee","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-mcafee.html","variantes":[{"nombre":"PIN de $105.900","precio":105900},{"nombre":"PIN de $159.900","precio":159900},{"nombre":"PIN de $189.900","precio":189900}]},{"id":"pin-virtual-datacredito","nombre":"PIN Virtual Datacrédito","tipo":"pines","url":"https://www.dctecnology.xyz/p/pin-virtual-datacredito.html","variantes":[{"nombre":"PIN de $15.000","precio":15000}]},{"id":"servicio-mantenimiento-computadores","nombre":"Mantenimiento Preventivo y Correctivo de Equipos","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-mantenimiento-computadores.html","variantes":[{"nombre":"Preventivo Software + Limpieza","precio":60000},{"nombre":"Correctivo + Cambio Térmico","precio":90000}]},{"id":"servicio-instalacion-so-licenciamiento","nombre":"Instalación de Sistema Operativo y Licenciamiento","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-instalacion-so-licenciamiento.html","variantes":[{"nombre":"Windows 10/11 Pro + Office + Software Base","precio":60000}]},{"id":"servicio-alquiler-equipos-computo","nombre":"Alquiler de Laptops y Equipos de Cómputo","tipo":"alquiler","url":"https://www.dctecnology.xyz/p/servicio-alquiler-equipos-computo.html","variantes":[{"nombre":"Plan 1 Mes (Pago Total)","precio":160000},{"nombre":"Plan 6 Meses ($150.000/mes) - Pago Total","precio":900000},{"nombre":"Plan 1 Año ($140.000/mes) - Pago Total","precio":1680000}]},{"id":"servicio-asesorias-tutorias","nombre":"Asesoría Técnica y Tutoría Personalizada","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-asesorias-tutorias.html","variantes":[{"nombre":"Sesión de Asesoría / Tutoría (1 Hora)","precio":40000}]},{"id":"servicio-desarrollo-web-automatizaciones","nombre":"Desarrollo de Catálogos Web y Automatizaciones IA","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-desarrollo-web-automatizaciones.html","variantes":[{"nombre":"Proyecto a Medida (Requiere Asesoría)","precio":0}]},{"id":"servicio-reparacion-repuestos","nombre":"Reparación de Computadores y Venta de Repuestos","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-reparacion-repuestos.html","variantes":[{"nombre":"Revisión del Equipo (Diagnóstico)","precio":25000},{"nombre":"Diagnóstico y Reparación (Requiere Cotización)","precio":0},{"nombre":"Repuestos para Computador (Requiere Cotización)","precio":0}]},{"id":"servicio-automatizaciones-negocios","nombre":"Automatizaciones para Negocios: Dashboards, Inventarios y Macros","tipo":"servicios","url":"https://www.dctecnology.xyz/p/servicio-automatizaciones-negocios.html","variantes":[{"nombre":"Dashboards e Inventarios (Requiere Asesoría)","precio":0},{"nombre":"Sistema para Bares o Supermercados (Requiere Asesoría)","precio":0},{"nombre":"Automatización de Macros (Requiere Asesoría)","precio":0}]}]}).plantillas.entrega_credenciales).split('\n').map((linea) => {
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
