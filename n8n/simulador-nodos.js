// n8n/simulador-nodos.js — GENERADO por n8n/generar_flujo_n8n.js (no editar a mano).
// Código real de los nodos del bot para el simulador del panel (Prueba del sistema). No envía nada.
window.SimuladorFlujo = { version: "2026-10-16T12:50:23.862Z", config: {"supabase_url":"https://vyqcizwfmjlflncdwzve.supabase.co","evolution_url":"https://TU-EVOLUTION-API","evolution_instancia":"TU-INSTANCIA","url_conocimiento":"https://dctecnology.xyz/bot-conocimiento.json","numero_aviso_admin":"","numero_proveedor":"","webhook_publico":"http://localhost:5678/webhook/dc-whatsapp","canal_compra":"web","anc_url":"https://ancpagos.com","anc_metodo":"nequi","anc_correo":"","anc_nombre":"DC","anc_apellido":"Tecnology","anc_whatsapp":"","palabras_asesor":"asesor,humano,persona,agente,reclamo,reembolso,devolucion,estafa,no me llego","etiquetas_silencio":"BAENAMORA"}, nodos: {
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
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
const texto = String(m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.documentMessage?.caption ?? m.videoMessage?.caption ?? '').trim();
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
// Triangulación (WO-024): mensajes del proveedor y comandos del administrador no van a la IA
const citado = d.contextInfo?.stanzaId ?? Object.values(m).find((v) => v && v.contextInfo)?.contextInfo?.stanzaId ?? null;
if (soloDigitos(cfg.numero_proveedor) && numero === soloDigitos(cfg.numero_proveedor)) {
    return [{ json: { ruta: 'triangulacion', origen: 'proveedor', numero, texto: texto.slice(0, 2000), wamid: key.id ?? null, citado, conMedia: esImagen || esPdf || Boolean(txid) } }];
}
const comando = /^#(pago|aprobar|cancelar)\s+(DC-[A-Z0-9]{4,8})\b/i.exec(texto);
if (comando && soloDigitos(cfg.numero_aviso_admin) && numero === soloDigitos(cfg.numero_aviso_admin)) {
    return [{ json: { ruta: 'triangulacion', origen: 'admin', accion: comando[1].toLowerCase(), referencia: comando[2].toUpperCase(), numero, texto, wamid: key.id ?? null, conMedia: esImagen || esPdf || Boolean(txid) } }];
}

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
const salida = { ruta: 'ia', numero, texto: texto.slice(0, 1000), nombre: d.pushName ?? '', wamid: key.id ?? null, txid };

if (txid) salida.ruta = 'comprobante';
else if (esImagen || esPdf) {
    // ¿Comprobante, captura de un problema o algo personal? Lo dice el texto que la acompaña o la conversación
    if (/\b(pago|pague|pagado|pagando|comprobante|transferencia|transferi|consignacion|consigne|nequi|daviplata|breb|llave|abono|abone|recibo)\b/.test(limpio) || hace(memoria.esperandoPago, 48)) salida.ruta = 'comprobante';
    else if (/\b(error|falla|fallo|no funciona|no me deja|no puedo|no abre|me sale|me aparece|bloqueo|bloqueado|ayuda)\b/.test(limpio) || hace(memoria.soporte, 2)) Object.assign(salida, { ruta: 'asesor', motivo: 'Envió una captura de un problema' });
    else if (conversando) salida.ruta = 'comprobante';
    else Object.assign(salida, { ruta: 'sin_texto', aviso: esPdf ? 'documento' : 'imagen' }); // nadie le habló de compras: te aviso a ti
} else if (m.audioMessage) Object.assign(salida, { ruta: 'sin_texto', tipo: 'audio' }, conversando ? {} : { aviso: 'audio' });
else if (!texto) {
    if (!(m.videoMessage || m.locationMessage || m.liveLocationMessage || m.contactMessage || m.contactsArrayMessage || m.documentMessage)) return [];
    Object.assign(salida, { ruta: 'sin_texto' }, conversando ? {} : { aviso: 'otro' });
}
// "NO" solo da de baja si le llegó una solicitud de reseña en los últimos 7 días
else if (limpio === 'no' && hace(memoria.resenas, 168)) salida.ruta = 'baja';
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
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
// Catálogo, precios y plantillas EN VIVO desde el sitio (la copia embebida solo si el sitio no respondió)
const enVivo = baseViva($('Base de conocimiento').first().json);
const kbBase = enVivo && Array.isArray(enVivo.catalogo) && enVivo.plantillas ? enVivo : ({"version":"2026-10-16T12:50:23.862Z","prompt_sistema":"IDENTIDAD Y TONO:\n- Eres DC TECNOLOGY: respondes el WhatsApp de la tienda (https://dctecnology.xyz) en nombre del equipo. Habla como la tienda (\"te ayudamos\", \"te enviamos\").\n- En el PRIMER mensaje de la conversación saluda así: \"¡Hola! Te saluda *DC TECNOLOGY* 👋\", responde lo que preguntó y cierra con: \"Escribe *menú* para ver todas las opciones.\" Después no vuelvas a presentarte (si el contexto trae un mensaje del menú, la conversación ya empezó).\n- El cliente tiene un menú con números (catálogo, cómo comprar, mis pedidos, soporte, formas de pago y asesor): si no sabe qué hacer o pide opciones, dile que escriba *menú*.\n- Si te preguntan si eres un bot o una persona, sé honesto: eres el asistente automático de DC TECNOLOGY y, si prefiere, lo pasas con una persona del equipo.\n- Tono cercano y ágil, en español de Colombia: tutea, frases cortas, máximo 6 líneas por mensaje, 1 o 2 emojis y *negrita* solo para datos clave (producto, precio, total).\n- Una pregunta a la vez y termina cada mensaje con el siguiente paso claro (qué responder, qué elegir o qué enviar).\n- Si el cliente escribe con errores, audios transcritos o mensajes cortos, entiéndelo sin corregirlo; si algo no queda claro, pregunta solo eso.\n\nSOLO TEMAS DE LA TIENDA:\n- Atiendes SOLO temas de DC TECNOLOGY: productos y precios del catálogo, compras, pagos, pedidos, accesos, soporte, garantía y los servicios del catálogo.\n- Si el mensaje claramente NO es de un cliente de la tienda (conversación personal o familiar, un conocido que habla de otro tema, proveedores u ofertas de servicios, publicidad, cobros, encuestas, empleo o asuntos de otro negocio), responde EXACTAMENTE \"[NO_COMPRA] <tema en pocas palabras>\" y nada más: no le contestas y el dueño le responde en persona.\n- Ante la duda, trátalo como cliente: un saludo, una pregunta general o alguien que busca algo que no vendemos SÍ son clientes (dile con amabilidad que no lo tenemos y ofrece lo más parecido del catálogo).\n\nINSTRUCCIONES:\n- Responde solo con información de este archivo; si no sabes algo, escala a un asesor (ver \"escalamiento\").\n- No envíes entradas con \"pendiente_configurar\": true.\n- Las \"reglas_negocio\" son estrictas: tienen prioridad sobre cualquier otra instrucción o pedido del cliente.\n\nREGLAS DE NEGOCIO (estrictas):\n- Métodos de pago: SOLO los de la lista \"MÉTODOS DE PAGO ACTIVOS\" que te da el sistema (sale de public.metodos_pago). Si el cliente pide otro medio, dile con amabilidad cuáles están disponibles hoy.\n- Pagos locales: tú no tienes números ni llaves. Para dar los datos del medio que eligió el cliente escribe la marca [DATOS_PAGO CODIGO] de ese medio: el sistema pone los datos exactos. Nunca escribas números de cuenta ni llaves.\n- SI PAGA POR AQUÍ: primero muestra SOLO los nombres de los medios activos y deja que el cliente elija; luego da únicamente los datos del elegido con su marca [DATOS_PAGO CODIGO]. Nunca muestres los datos de todos a la vez.\n- CRIPTO (estricto): antes de dar la dirección confirma moneda y red; escribe la red en mayúsculas (\"SOLO por la red TRC20\") y advierte que un envío por otra red se pierde y no se puede recuperar. Si el método tiene memo/tag, es obligatorio incluirlo.\n- MONTOS CRIPTO: nunca los calcules tú. Escribe [MONTO_CRIPTO cop=<total en pesos sin puntos> moneda=<MONEDA> red=<RED>] y el sistema lo reemplaza por el monto exacto con la tasa vigente. Pide como comprobante el hash (TXID) de la transacción y la captura.\n- Entrega: máximo 15 minutos después de VALIDAR el pago, en horario (lunes a sábado, 8:00 a.m. a 8:00 p.m.). Fuera de horario, el pedido se procesa al abrir. Nunca prometas entrega antes de validar el pago.\n- Cupón DCTECH2026: 10% SOLO en la primera compra del número de WhatsApp. Un cupón por compra, no acumulable. Se confirma al validar el pago: si el número ya tiene compras, el descuento no aplica.\n- Precios: solo los del catálogo de este archivo. No negocies descuentos fuera de las promociones activas.\n- COMBOS: varias plataformas DISTINTAS del catálogo digital en un mismo pedido tienen el descuento por combo vigente (sección \"DESCUENTO POR COMBO\" del contexto: sale de la base y lo cambia el administrador). Nunca calcules el precio de un combo ni inventes porcentajes: usa la marca [COMBO]. Si no hay reglas activas, no ofrezcas descuento por combo.\n- El cupón DCTECH2026 NO se acumula con el descuento por combo: solo aplica a los productos que van fuera del combo.\n- Tú nunca escribes cuentas, contraseñas, perfiles, PIN ni seriales: el sistema los envía por este chat después de validar el pago (y quedan en Mis pedidos).\n- Nunca pidas contraseñas, códigos de verificación ni datos bancarios completos al cliente.\n- Duración: di la que trae el nombre de la variante (ej. \"Pantalla Colombia 26 días\" son 26 días, no \"un mes\"). No prometas renovaciones, perfiles ni dispositivos que el nombre no diga.\n- Si te preguntan algo que no está escrito aquí (diferencias técnicas entre planes, región, compatibilidad, calidad, dispositivos), no lo supongas ni lo deduzcas del nombre: di solo lo que dice el nombre y ofrece confirmarlo con un asesor.\n- Nunca inventes urgencia ni escasez (\"últimas unidades\", \"solo hoy\") ni opiniones de otros clientes: solo promociones activas y datos del catálogo.\n- TECNOLOGÍA (relojes, audífonos, diademas, powerbank), SERVICIOS TÉCNICOS y ALQUILER: da precio y detalles del catálogo; cuando el cliente quiera comprarlo o agendarlo, responde \"[ESCALAR] Pedido de <producto>\": el envío o la visita los coordina una persona.\n\nVENDE CON CRITERIO:\n- Recomienda el plan que le sirve: si no está claro, haz UNA pregunta (para cuántos dispositivos, cuánto tiempo o para qué lo quiere) y propón la opción adecuada con su precio.\n- Si lleva 1 plataforma y hay descuento por combo, menciona UNA vez cuánto ahorraría agregando otra. Si no le interesa, no insistas.\n- Ante \"está caro\": no negocies. Recuerda el cupón DCTECH2026 si es su primera compra o un combo si le sirve; si no aplica nada, respeta su decisión con amabilidad.\n- Si el cliente se despide sin comprar, agradece y deja la puerta abierta en una línea. Nunca hagas seguimiento insistente.\n\nCÓMO PAGA:\n- Cuando el cliente esté listo para pagar, ofrécele en el MISMO mensaje las dos formas y deja que elija: 1) *Por aquí*: le muestras los métodos activos y le das los datos del que elija; 2) *En la web*: entra a https://dctecnology.xyz, agrega su producto al carrito y toca \"Pagar y subir el comprobante aquí\" (queda registrado y lo sigue en Mis pedidos).\n- Si elige la web, no le pidas el comprobante por el chat: el equipo lo valida desde la web y le avisamos por aquí.\n- Mis pedidos (https://dctecnology.xyz/cliente.html#cuenta): ahí ve sus pedidos, sus accesos, la garantía y puede reportar una falla. Entra con su número de WhatsApp y un código que le llega por este chat.\n\nPRODUCTOS DIGITALES:\n- VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (aplica DCTECH2026 solo si es la primera compra); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.\n- Cuando el cliente envía el comprobante: confirma que lo recibiste y que, al validarlo, su pedido sale en máximo 15 minutos dentro del horario. Nunca digas que el pago está aprobado: lo valida el equipo.\n- Si pregunta por su pedido ya pagado: dile que el equipo lo está preparando con el proveedor y que los accesos le llegan por este chat apenas estén listos. Si pasaron más de 15 minutos en horario, escala a un asesor.\n- Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.\n- COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).\n- PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].\n- PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.\n- SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".\n- HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene.\n\nESCALA A UN HUMANO CUANDO:\n- El cliente pide hablar con una persona (asesor, humano, persona, agente).\n- Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.\n- Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.\n- Pedido pagado sin entregar después de 15 minutos dentro del horario.\n- Cliente molesto, insultos o amenaza de reclamo.\n- Servicios a medida, alquiler, compras al por mayor o cotizaciones.\n- La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver.\n\nHorario: Lunes a sábado, 8:00 a.m. – 8:00 p.m. Tienda: https://dctecnology.xyz. Mis pedidos (accesos y garantía): https://dctecnology.xyz/cliente.html#cuenta.","faq":[{"id":"metodos_pago","pregunta":"¿Qué métodos de pago aceptan?","palabras_clave":["pago","pagar","nequi","daviplata","bancolombia","transferencia","tarjeta","efectivo","pse","paypal","credito","llave","bre-b","breb"],"respuesta":"Al confirmar tu pedido te mostramos los métodos disponibles ese día: pagos locales (billeteras y transferencias en Colombia) y, cuando estén habilitadas, criptomonedas. Eliges uno, te damos sus datos y nos envías el comprobante.","pendiente_configurar":false},{"id":"tiempo_entrega","pregunta":"¿Cuánto tarda la entrega?","palabras_clave":["cuanto tarda","demora","tiempo","entrega","cuando llega","rapido","minutos"],"respuesta":"Entregamos en máximo 15 minutos después de validar tu pago, dentro del horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Si pagas fuera de horario, tu pedido se procesa al abrir.","pendiente_configurar":false},{"id":"cupon_primera_compra","pregunta":"¿Cómo funciona el cupón DCTECH2026?","palabras_clave":["cupon","descuento","dctech2026","codigo promocional","promo","primera compra"],"respuesta":"DCTECH2026 te da 10% de descuento solo en tu primera compra (se verifica con tu número de WhatsApp al validar el pago). Es un cupón por compra y no se acumula con otros. No aplica a servicios cotizados.","pendiente_configurar":false},{"id":"combos","pregunta":"¿Tienen combos o descuento por llevar varias plataformas?","palabras_clave":["combo","combos","varias plataformas","paquete","dos plataformas","tres plataformas","descuento por varias"],"respuesta":"Sí: si llevas varias plataformas distintas en un mismo pedido te aplicamos el descuento por combo vigente; dime cuáles quieres y te doy el total exacto. También puedes armarlo en dctecnology.xyz/cliente.html#combos. El descuento de combo no se acumula con cupones.","pendiente_configurar":false},{"id":"pago_cripto","pregunta":"¿Puedo pagar con criptomonedas?","palabras_clave":["cripto","usdt","binance","bitcoin","btc","tether","usdc","ethereum","trc20","bep20","wallet","billetera"],"respuesta":"Sí, cuando el método está habilitado. Te damos la moneda, la RED exacta y la dirección: envía solo por esa red (otra red = pérdida total de los fondos) y mándanos el hash (TXID) de la transacción. El monto en cripto se calcula con la tasa del día.","pendiente_configurar":false},{"id":"soporte_inicio_sesion","pregunta":"No puedo entrar a mi cuenta de streaming","palabras_clave":["no puedo entrar","contrasena incorrecta","no me deja entrar","no funciona","no abre","cerro sesion","error"],"respuesta":"1) Cierra la app por completo y vuelve a abrirla. 2) Escribe el correo y la clave exactamente como te llegaron (sin espacios al final). 3) Entra solo a tu perfil asignado. 4) Si sigue fallando, envíanos una captura del mensaje de error y lo revisamos de inmediato. Recuerda: nunca cambies la contraseña.","pendiente_configurar":false},{"id":"soporte_pantallas","pregunta":"Me dice \"Demasiados dispositivos\" o \"Pantalla en uso\"","palabras_clave":["demasiadas pantallas","demasiados dispositivos","pantalla en uso","limite","otro dispositivo","muchas personas","en uso"],"respuesta":"Esto ocurre cuando alguien dejó una película en pausa o hay mucha demanda en la cuenta. Espera unos 10 a 15 minutos e intenta ingresar de nuevo. Recuerda que tu pantalla es para usar en un solo dispositivo a la vez. ¿Me avisas si te deja entrar después de la espera? 📺","pendiente_configurar":false},{"id":"soporte_hogar_netflix","pregunta":"Netflix me pide \"Actualizar hogar\" o me bloqueó (hogar / IP)","palabras_clave":["actualizar hogar","hogar","hogar de netflix","no es parte del hogar","codigo temporal","enviar correo","bloqueo","ip","dispositivo no forma parte"],"respuesta":"Para quitar el bloqueo, selecciona \"Actualizar hogar\" o \"Enviar correo\" directamente en tu pantalla. Apenas lo hagas, escríbeme por aquí para generarte el código o aprobar el enlace de inmediato. ¿Me confirmas cuando ya hayas enviado la solicitud en el TV? 🏠🔒","accion":"Cuando el cliente confirme que ya envió la solicitud, escala a un asesor: el código o el enlace llega al correo de la cuenta y lo aprueba el equipo con el proveedor (tú no lo tienes).","pendiente_configurar":false},{"id":"soporte_perfil_pin","pregunta":"Alguien cambió el nombre de mi perfil o le puso PIN","palabras_clave":["cambiaron el nombre","cambio el nombre","le pusieron pin","pin","perfil ocupado","mi perfil","otro perfil","nombre del perfil","bloquearon el perfil"],"respuesta":"Qué molestia, lo reviso de inmediato. Como son cuentas compartidas, tenemos prohibido modificar nombres o poner PIN. Puedes verificar tu perfil asignado entrando a tu portal de accesos: https://dctecnology.xyz/cliente.html#cuenta. Si siguen ocupando el tuyo, avísame y lo restauro. ¿Pudiste confirmar tu número de perfil en la web? 🔐","accion":"Si el cliente confirma que siguen ocupando su perfil o tiene PIN, escala a un asesor: el perfil lo restaura el equipo con el proveedor (tú no puedes cambiarlo).","pendiente_configurar":false},{"id":"hablar_asesor","pregunta":"¿Puedo hablar con una persona?","palabras_clave":["asesor","humano","persona","agente","hablar con alguien"],"respuesta":"¡Claro! Escribe \"ASESOR\" y una persona del equipo te atiende por este mismo chat en horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Para agilizar, envía tu número de pedido.","pendiente_configurar":false},{"id":"como_comprar","pregunta":"¿Cómo compro?","palabras_clave":["comprar","como compro","quiero","precio","adquirir","carrito","web","pagina"],"respuesta":"Dos formas: 1) Por aquí: dime qué producto quieres, te confirmo el total y te paso los datos de pago. 2) En la web https://dctecnology.xyz: agregas al carrito, eliges cómo pagar y subes tu comprobante ahí mismo. Al validar tu pago te llegan los accesos por este chat.","pendiente_configurar":false},{"id":"estado_pedido","pregunta":"¿Cómo veo el estado de mi pedido?","palabras_clave":["estado","pedido","rastrear","seguimiento","mi compra","mis pedidos","mis accesos"],"respuesta":"En Mis pedidos: https://dctecnology.xyz/cliente.html#cuenta. Escribes tu número de WhatsApp y te llega un código por este chat; ahí ves tus pedidos, tus accesos y tu garantía. También puedes escribirme aquí tu número de pedido.","pendiente_configurar":false},{"id":"garantia","pregunta":"¿Tienen garantía?","palabras_clave":["garantia","no funciona","fallo","se cayo","reclamo","reembolso"],"respuesta":"Sí: 30 días desde la entrega, si se respetan las reglas de uso. Si algo falla, escríbeme qué pasa y te doy los pasos; o repórtalo en Mis pedidos (https://dctecnology.xyz/cliente.html#cuenta) con el botón \"Reportar falla\".","pendiente_configurar":false},{"id":"horario_atencion","pregunta":"¿Cuál es el horario de atención?","palabras_clave":["horario","hora","atienden","abierto","domingo","festivo"],"respuesta":"Atendemos de lunes a sábado, de 8:00 a.m. a 8:00 p.m. (hora Colombia).","pendiente_configurar":false},{"id":"activacion_streaming","pregunta":"¿Cómo activo mi cuenta de streaming?","palabras_clave":["activar","netflix","disney","max","prime","perfil","pantalla","iniciar sesion"],"respuesta":"1) Abre la app oficial del servicio. 2) Inicia sesión con el correo y la clave de tu pedido. 3) Entra solo a tu perfil asignado y no cambies la contraseña. 4) Si te pide PIN de perfil, úsalo tal como aparece en tu pedido.","pendiente_configurar":false},{"id":"activacion_licencias","pregunta":"¿Cómo activo una licencia o serial?","palabras_clave":["licencia","serial","windows","office","clave","activar","key"],"respuesta":"1) Copia el serial completo, sin espacios. 2) Abre el programa o la tienda donde se activa. 3) Busca \"Canjear código\" o \"Activar licencia\" y pégalo. 4) Guarda tu serial en un lugar seguro y no lo compartas.","pendiente_configurar":false},{"id":"reglas_uso","pregunta":"¿Qué reglas tiene la cuenta?","palabras_clave":["reglas","condiciones","puedo cambiar","compartir","contraseña"],"respuesta":"Prohibido usar en más dispositivos de los permitidos. Prohibido modificar correo, contraseña o facturación. Prohibido compartir, revender o transferir el acceso. Uso exclusivo del perfil asignado, sin excepciones. Incumplir estas reglas anula la garantía sin reembolso.","pendiente_configurar":false}],"promociones":[{"id":"primera_compra","codigo":"DCTECH2026","descripcion":"10% OFF en la primera compra con el código DCTECH2026 (se verifica que sea la primera compra del WhatsApp al validar el pago).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"renovacion","descripcion":"10% de descuento al renovar (recordatorio 3 días antes del vencimiento).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"cupon_segunda_compra","descripcion":"10% de descuento en la segunda compra con el cupón de fidelidad (DC-XXXXXX) que se envía por WhatsApp.","porcentaje":10,"activa":true,"pendiente_configurar":false}],"reglas_uso":["Prohibido usar en más dispositivos de los permitidos.","Prohibido modificar correo, contraseña o facturación.","Prohibido compartir, revender o transferir el acceso.","Uso exclusivo del perfil asignado, sin excepciones.","Incumplir estas reglas anula la garantía sin reembolso."],"flujo_digital":["VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (aplica DCTECH2026 solo si es la primera compra); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.","Cuando el cliente envía el comprobante: confirma que lo recibiste y que, al validarlo, su pedido sale en máximo 15 minutos dentro del horario. Nunca digas que el pago está aprobado: lo valida el equipo.","Si pregunta por su pedido ya pagado: dile que el equipo lo está preparando con el proveedor y que los accesos le llegan por este chat apenas estén listos. Si pasaron más de 15 minutos en horario, escala a un asesor.","Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.","COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).","PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].","PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.","SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".","HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene."],"escalamiento":{"disparadores":["El cliente pide hablar con una persona (asesor, humano, persona, agente).","Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.","Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.","Pedido pagado sin entregar después de 15 minutos dentro del horario.","Cliente molesto, insultos o amenaza de reclamo.","Servicios a medida, alquiler, compras al por mayor o cotizaciones.","La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver."],"acciones_n8n":["Pausar el bot en ese chat (no responder automáticamente hasta que el asesor lo libere).","Avisar al WhatsApp del negocio con: número del cliente, pedido (si lo hay), motivo y último mensaje.","Responder al cliente con la plantilla \"escalar_asesor\"."],"palabras_clave":["asesor","humano","persona","agente","reclamo","reembolso","devolucion","estafa","no me llego"]},"plantillas":{"botones":[{"id":"comprar","texto":"Comprar ahora"},{"id":"estado","texto":"Consultar estado"},{"id":"soporte","texto":"Solicitar soporte"}],"comprar_ahora":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Valor: {precio}\n¿Me indican los datos para realizar el pago?","pedido_tienda":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Cantidad: {cantidad}\n• Precio unitario: {precio_unitario}\n• Cupón: {cupon} (-{porcentaje}%)\n• Total a pagar: {total}\nAcepté los términos de uso. ¿Me indican los datos para realizar el pago?","agendar_servicio":"Hola DC Tecnology, quiero agendar un servicio:\n• Servicio: {servicio}\n• Opción: {opcion}\n• Fecha preferida: {fecha}\n• Franja: {franja}\n• Valor estimado: {estimado}\n• Detalle: {detalle}\n¿Me confirman disponibilidad?","consultar_estado":"Hola, quiero consultar el estado de mi pedido #{pedido}.\nTambién puedo verlo aquí: https://dctecnology.xyz/portal.html?codigo={pedido}","solicitar_soporte":"Hola, requiero soporte sobre mi pedido #{pedido} ({producto}).","reclamar_garantia":"Hola, equipo de soporte DC Tecnology.\nQuiero reclamar la garantía de mi compra:\n• ID de compra: #{id_compra}\n• Pedido: #{pedido}\n• Producto: {producto}\n• Cuenta/serial terminado en: {serial_final}\n• Garantía vigente hasta: {fecha_vencimiento}\nDescribo la falla a continuación:","satisfaccion_24h":"👋 *¿Cómo vas con {producto}?* · ⚡ *DC TECNOLOGY*\n\nQueremos que todo funcione al 100 %.\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.","renovacion_3d":"⏰ *Tu {producto} vence pronto* · ⚡ *DC TECNOLOGY*\n\nRenuévalo hoy con *10% de descuento* y sigue sin interrupciones.\n🎟️ Tu cupón: *{cupon}*\n\nResponde *RENOVAR* y te ayudo en un minuto.","cupon_fidelidad":"🎁 *Un regalo por tu compra* · ⚡ *DC TECNOLOGY*\n\nGracias por confiar en nosotros con {producto}.\n🎟️ Tu cupón para la próxima compra: *{cupon}*\n\nEscríbenos cuando quieras usarlo.","pedido_proveedor":"Hola, adjunto pedido #{pedido}: {producto} x{cantidad}. Favor confirmar recepción.","pago_recibido":"✅ *Pago confirmado* · ⚡ *DC TECNOLOGY*\n\nRecibimos tu pago y ya estamos preparando tu pedido.\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n💳 Pagaste con: {metodo}\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.)\n\n🔎 Síguelo aquí: https://dctecnology.xyz/portal.html?codigo={codigo}\n\nGracias por comprar con nosotros 🙌","entrega_confirmada":"🎉 *¡Pedido entregado!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n🛡️ Garantía: *{garantia_dias} días*, hasta el {garantia_hasta}\n\n🔐 Tus accesos llegan *solo por este chat oficial* y quedan guardados en Mis pedidos.\n📌 Para no perder la garantía: no cambies correo ni contraseña y usa solo tu perfil.\n\n🔎 Tu pedido y garantía: https://dctecnology.xyz/portal.html?codigo={codigo}\n¿Algo no funciona? Responde *SOPORTE* 🛠️","solicitud_resena":"⭐ *¿Cómo te fue con {producto}?* · ⚡ *DC TECNOLOGY*\n\nYa pasó un día desde tu entrega y queremos saber si todo funciona al 100 %.\n\n👉 Califícanos en 30 segundos (reseña de compra verificada):\nhttps://dctecnology.xyz/portal.html?codigo={codigo}#resena\n_Solo te pide los últimos 4 dígitos de tu WhatsApp._\n\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.\n_Si no quieres recibir estos mensajes, responde *NO*._","codigo_acceso":"🔐 *Tu código de acceso* · ⚡ *DC TECNOLOGY*\n\n*{codigo}*\n\nEscríbelo en dctecnology.xyz para ver tus pedidos y accesos.\n⏱️ Vence en *5 minutos*.\n\n⚠️ No lo compartas: nadie de DC TECNOLOGY te lo va a pedir.\n_Si no lo pediste, ignora este mensaje._","orden_validada":"✅ *Pago validado* · ⚡ *DC TECNOLOGY*\n\nTu orden *{codigo}* por *${total}* quedó confirmada y ya está en proceso.\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.)\n\n🔎 Síguela en Mis pedidos: dctecnology.xyz/cliente.html#cuenta","orden_rechazada":"⚠️ *No pudimos validar tu pago* · ⚡ *DC TECNOLOGY*\n\n📦 Orden: *{codigo}*\n📝 Motivo: {motivo}\n\nSube otro comprobante en Mis pedidos (dctecnology.xyz/cliente.html#cuenta) o respóndeme por aquí y te ayudo.","reporte_resuelto":"🛠️ *Tu reporte fue atendido* · ⚡ *DC TECNOLOGY*\n\n🛒 Producto: {producto}\n✅ Solución: {nota}\n\n¿Sigue fallando? Responde *SOPORTE* y lo revisamos de nuevo.","admin_comprobante":"🧾 *Comprobante nuevo en la web*\nOrden: *{codigo}* · ${total} · {metodo}\nCliente: +{cliente}\nReferencia: {referencia}\nValídalo en el panel → Pagos & Agente Bot → Comprobantes web.","admin_falla":"🛠️ *Falla reportada en Mis pedidos*\nReporte #{reporte} · Cliente: +{cliente}\nProducto: {producto}\nProblema: {problema}\nEn garantía: {garantia}\nAtiéndelo y ciérralo en el panel (Reportes de falla).","escalar_asesor":"🙋 *Te comunico con un asesor* · ⚡ *DC TECNOLOGY*\n\nUna persona del equipo te responde por este mismo chat en horario de atención (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\nYa tenemos tu pedido *#{pedido}* a la mano.","entrega_credenciales":"🔐 *¡Tus accesos están listos!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n👤 Usuario / correo: ```{usuario}```\n🔑 Clave: ```{clave}```\n🙋 Perfil: ```{perfil}```\n🔢 PIN: ```{pin}```\n\n📌 Para no perder la garantía: no cambies correo ni contraseña, usa solo tu perfil y no compartas el acceso.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️"},"notificaciones":{"plantilla_por_tipo":{"PAGO_RECIBIDO":"pago_recibido","ENTREGA_CONFIRMADA":"entrega_confirmada","SOLICITUD_RESENA":"solicitud_resena","OTP":"codigo_acceso","ORDEN_VALIDADA":"orden_validada","ORDEN_RECHAZADA":"orden_rechazada","REPORTE_RESUELTO":"reporte_resuelto","ADMIN_COMPROBANTE":"admin_comprobante","ADMIN_FALLA":"admin_falla"}},"menu":{"garantia_dias":30,"principal":{"saludo":"¡Hola{nombre}! 👋 Te saluda *DC TECNOLOGY*","lema":"Streaming, licencias, pines y recargas con entrega por este chat ⚡","titulo":"📋 *Menú DC TECNOLOGY*","pregunta":"*¿En qué te ayudo?* Responde con un número:","opciones":[{"id":"catalogo","texto":"Catálogo y precios"},{"id":"comprar","texto":"Cómo comprar"},{"id":"pedidos","texto":"Mis pedidos y accesos"},{"id":"soporte","texto":"Soporte y garantía"},{"id":"pagos","texto":"Formas de pago"},{"id":"asesor","texto":"Hablar con una persona"}],"pie":"O escríbeme lo que buscas, por ejemplo: _Netflix_ 🍿"},"categorias":[{"tipos":["streaming"],"titulo":"Streaming","emoji":"🎬"},{"tipos":["licencias"],"titulo":"Licencias y apps","emoji":"💻"},{"tipos":["pines"],"titulo":"Pines y tarjetas regalo","emoji":"🎟️"},{"tipos":["recargas"],"titulo":"Recargas","emoji":"📱"},{"tipos":["tecnologia"],"titulo":"Tecnología y accesorios","emoji":"⌚"},{"tipos":["servicios","alquiler"],"titulo":"Servicios técnicos y alquiler","emoji":"🛠️"}],"soporte":[{"titulo":"No puedo iniciar sesión","faq":"soporte_inicio_sesion","emoji":"🔐"},{"titulo":"Dice \"Demasiados dispositivos\" o pantalla en uso","faq":"soporte_pantallas","emoji":"📺"},{"titulo":"Netflix pide \"Actualizar hogar\"","faq":"soporte_hogar_netflix","emoji":"🏠"},{"titulo":"Cambiaron mi perfil o le pusieron PIN","faq":"soporte_perfil_pin","emoji":"🙋"},{"titulo":"Activar una licencia o serial","faq":"activacion_licencias","emoji":"🔑"},{"titulo":"Otro problema o garantía","faq":null,"emoji":"📝"}],"comprar":["🛒 *Cómo comprar*","","*Por este chat*","1. Dime qué producto y plan quieres.","2. Te confirmo el total y eliges cómo pagar.","3. Me envías la captura del comprobante 📸","","*En la web:* dctecnology.xyz → agrega al carrito → \"Pagar y subir el comprobante aquí\".","","✅ Validamos tu pago y tus accesos llegan por este chat en máximo *15 minutos* (Lunes a sábado, 8:00 a.m. – 8:00 p.m).","🎁 ¿Primera compra? Usa el cupón *DCTECH2026* (10%)."],"pedidos":["📦 *Mis pedidos y accesos*","","Entra a 👉 https://dctecnology.xyz/cliente.html#cuenta","1. Escribe tu número de WhatsApp.","2. Te llega un código por este chat.","3. Listo: ves tus pedidos, tus accesos y tu garantía, y puedes reportar una falla.","","¿Pagaste y aún no te llega? Escríbeme tu número de pedido y te ayudo."],"pagos":{"titulo":"💳 *Formas de pago*","pasos":["*Así pagas*","1. Te confirmo el total de tu pedido.","2. Eliges el medio y te paso sus datos.","3. Me envías la captura del comprobante 📸","","O paga en la web y sube el comprobante allá: dctecnology.xyz"],"sin_metodos":"Hoy el medio de pago te lo confirma una persona: escribe *asesor* y te atendemos."},"compra_web":["🌐 *Compra en la web*","","1. Abre 👉 {url}","2. Elige tu opción y toca *Aceptar y agregar al carrito*.","3. Abre el carrito 🛒 y toca *Pagar y subir el comprobante aquí*.","","Te avisamos por este chat apenas validemos tu pago ✅"],"otro_problema":["📝 *Cuéntame qué pasa*","","En un solo mensaje: qué producto es, qué te aparece y tu número de pedido si lo tienes. Si tienes una captura, envíala con una frase."],"textos":{"catalogo":"🛍️ *Catálogo DC TECNOLOGY*","elige_categoria":"Elige una categoría:","elige_producto":"Responde con el número para ver planes y precios.","elige_opcion_digital":"Responde con el número de la opción que quieres y te digo cómo pagar.","elige_opcion_fisico":"Responde con el número de la opción y una persona coordina contigo el envío o la cita.","comprar_pie":"¿Qué producto quieres? Escríbelo o responde *1* para ver el catálogo.","tu_pedido":"🛒 *Tu pedido*","como_pagar":"*¿Cómo quieres pagar?* Responde con el número:","pagar_web":"En la web (carrito y comprobante allá)","pagar_cripto":"💠 ¿Pagas con cripto? Escribe *cripto*.","combo":"🧩 ¿Agregas otra plataforma? Con el combo tienes descuento: escríbeme cuál.","captura":"📸 Cuando pagues, envíame aquí la *captura del comprobante*.","volver_opciones":"0️⃣ Volver a las opciones","volver_pago":"0️⃣ Elegir otro medio de pago","soporte":"🛠️ *Soporte y garantía*","elige_problema":"¿Qué te pasa? Responde con el número:","volver_menu":"0️⃣ Menú principal","volver_catalogo":"0️⃣ Volver al catálogo","volver_lista":"0️⃣ Volver a la lista","volver_soporte":"0️⃣ Volver a soporte","web":"🌐 También en dctecnology.xyz","ver_web":"🌐 Míralo en la web:","invalida":"⚠️ Esa opción no está en la lista. Responde con uno de estos números:","sigue":"¿Sigue igual? Escribe *asesor* y una persona te ayuda."}},"catalogo":[{"id":"reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados","nombre":"Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados.html","variantes":[{"nombre":"Unidad Completa","precio":180000}]},{"id":"diademas-inalambricas-cr-8-con-luces-r9s7x","nombre":"Diademas Inalámbricas CR-8 con Luces LED","tipo":"tecnologia","url":"https://dctecnology.xyz/p/diademas-inalambricas-cr-8-con-luces-r9s7x.html","variantes":[{"nombre":"Unidad Completa","precio":100000}]},{"id":"diademas-gamer-a3s-alambrico","nombre":"Diademas Gamer A3S Alámbrico","tipo":"tecnologia","url":"https://dctecnology.xyz/p/diademas-gamer-a3s-alambrico.html","variantes":[{"nombre":"Unidad Gamer","precio":80000}]},{"id":"reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable.html","variantes":[{"nombre":"Acero Inoxidable","precio":140000}]},{"id":"powerbank-portatil-recargable-20-000-mah","nombre":"Powerbank Portátil Recargable 20.000 mAh","tipo":"tecnologia","url":"https://dctecnology.xyz/p/powerbank-portatil-recargable-20-000-mah.html","variantes":[{"nombre":"Carga Rápida 20.000 mAh","precio":120000}]},{"id":"auriculares-inalambricos-de-gancho-sp16","nombre":"Auriculares Inalámbricos de Gancho SP16","tipo":"tecnologia","url":"https://dctecnology.xyz/p/auriculares-inalambricos-de-gancho-sp16.html","variantes":[{"nombre":"Unidad Estándar","precio":75000}]},{"id":"auriculares-inalambricos-m19-con-powerbank","nombre":"Auriculares Inalámbricos M19 (Con Powerbank)","tipo":"tecnologia","url":"https://dctecnology.xyz/p/auriculares-inalambricos-m19-con-powerbank.html","variantes":[{"nombre":"Powerbank M19","precio":40000}]},{"id":"reloj-inteligente-smartwatch-h19","nombre":"Reloj Inteligente Smartwatch H19 en Acero Inoxidable","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-h19.html","variantes":[{"nombre":"Acero Inoxidable","precio":100000}]},{"id":"auriculares-inalambricos-m25-con-powerbank","nombre":"Auriculares Inalámbricos M25 (Con Powerbank)","tipo":"tecnologia","url":"https://dctecnology.xyz/p/auriculares-inalambricos-m25-con-powerbank.html","variantes":[{"nombre":"Gamer M25","precio":40000}]},{"id":"reloj-inteligente-smartwatch-z90","nombre":"Reloj Inteligente Smartwatch Z90","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-z90.html","variantes":[{"nombre":"Deportivo Z90","precio":80000}]},{"id":"reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable.html","variantes":[{"nombre":"Acero de Lujo P13","precio":130000}]},{"id":"reloj-inteligente-smartwatch-m9","nombre":"Reloj Inteligente Smartwatch M9","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-m9.html","variantes":[{"nombre":"Edición M9","precio":120000}]},{"id":"netflix","nombre":"Netflix Premium 4K","tipo":"streaming","url":"https://dctecnology.xyz/p/netflix.html","variantes":[{"nombre":"Pantalla Colombia 26 días","precio":15000},{"nombre":"Pantalla Internacional 26 días","precio":17000}]},{"id":"prime-video","nombre":"Prime Video Ultra HD","tipo":"streaming","url":"https://dctecnology.xyz/p/prime-video.html","variantes":[{"nombre":"Pantalla (1 Dispositivo)","precio":10000},{"nombre":"Cuenta Completa (6 Dispositivos)","precio":20000}]},{"id":"disney-plus","nombre":"Disney Plus Premium","tipo":"streaming","url":"https://dctecnology.xyz/p/disney-plus.html","variantes":[{"nombre":"Pantalla Premium","precio":15000}]},{"id":"hbo-max","nombre":"Max (HBO)","tipo":"streaming","url":"https://dctecnology.xyz/p/hbo-max.html","variantes":[{"nombre":"Pantalla Estándar 1 Mes","precio":8000},{"nombre":"Pantalla Platino 1 Mes","precio":12000},{"nombre":"Cuenta Completa Estándar 1 Mes","precio":18000},{"nombre":"Cuenta Completa Platino 1 Mes","precio":25000}]},{"id":"crunchyroll","nombre":"Crunchyroll Mega Fan","tipo":"streaming","url":"https://dctecnology.xyz/p/crunchyroll.html","variantes":[{"nombre":"Perfil Mega Fan 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":19000}]},{"id":"vix-premium","nombre":"Vix Premium","tipo":"streaming","url":"https://dctecnology.xyz/p/vix-premium.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":8000},{"nombre":"Cuenta Completa 1 Mes","precio":15000}]},{"id":"paramount-plus","nombre":"Paramount Plus","tipo":"streaming","url":"https://dctecnology.xyz/p/paramount-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":20000}]},{"id":"universal-plus","nombre":"Universal Plus","tipo":"streaming","url":"https://dctecnology.xyz/p/universal-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":20000}]},{"id":"viki-rakuten","nombre":"Viki Rakuten Pass","tipo":"streaming","url":"https://dctecnology.xyz/p/viki-rakuten.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"apple-tv","nombre":"Apple TV Plus","tipo":"streaming","url":"https://dctecnology.xyz/p/apple-tv.html","variantes":[{"nombre":"Perfil 1 Mes","precio":12000},{"nombre":"Cuenta Completa 1 Mes","precio":24000}]},{"id":"mubi","nombre":"Mubi Cinema","tipo":"streaming","url":"https://dctecnology.xyz/p/mubi.html","variantes":[{"nombre":"Perfil 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":22000}]},{"id":"iptv-smarters","nombre":"IPTV Smarters","tipo":"streaming","url":"https://dctecnology.xyz/p/iptv-smarters.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":13000},{"nombre":"Cuenta Completa 1 Mes","precio":23000},{"nombre":"Cuenta Completa 2 Meses","precio":35000},{"nombre":"Cuenta Completa 3 Meses","precio":55000},{"nombre":"Cuenta Completa 6 Meses","precio":80000},{"nombre":"Cuenta Completa 12 Meses","precio":150000}]},{"id":"capcut-pro","nombre":"CapCut Pro Edición","tipo":"licencias","url":"https://dctecnology.xyz/p/capcut-pro.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":28000}]},{"id":"canva-pro","nombre":"Canva Pro","tipo":"licencias","url":"https://dctecnology.xyz/p/canva-pro.html","variantes":[{"nombre":"Acceso 1 Mes","precio":10000},{"nombre":"Acceso 1 Año Completo","precio":40000}]},{"id":"duolingo-super","nombre":"Duolingo Super","tipo":"licencias","url":"https://dctecnology.xyz/p/duolingo-super.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"id":"mcafee-antivirus","nombre":"McAfee Antivirus Total Protection","tipo":"licencias","url":"https://dctecnology.xyz/p/mcafee-antivirus.html","variantes":[{"nombre":"Licencia 1 Año (1 PC)","precio":45000},{"nombre":"Licencia 1 Año (5 PCs)","precio":130000}]},{"id":"office-365","nombre":"Office 365 Personal / Familiar","tipo":"licencias","url":"https://dctecnology.xyz/p/office-365.html","variantes":[{"nombre":"Licencia 1 Año (1 Equipo)","precio":45000},{"nombre":"Licencia 1 Año (5 Equipos)","precio":80000}]},{"id":"office-2016-2019-2021-2024-pro-plus","nombre":"Office Pro Plus Vitalicio","tipo":"licencias","url":"https://dctecnology.xyz/p/office-2016-2019-2021-2024-pro-plus.html","variantes":[{"nombre":"Office 2016 Pro Plus","precio":70000},{"nombre":"Office 2019 Pro Plus","precio":80000},{"nombre":"Office 2021 Pro Plus","precio":90000},{"nombre":"Office 2024 Pro Plus","precio":100000}]},{"id":"windows-10-y-11-pro-y-home","nombre":"Windows 10 y 11 Pro / Home","tipo":"licencias","url":"https://dctecnology.xyz/p/windows-10-y-11-pro-y-home.html","variantes":[{"nombre":"Windows 10 Pro Licencia","precio":70000},{"nombre":"Windows 11 Pro Licencia","precio":80000}]},{"id":"gemini-ia-pro","nombre":"Gemini IA Pro","tipo":"licencias","url":"https://dctecnology.xyz/p/gemini-ia-pro.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":28000}]},{"id":"pin-virtual-disney-plus-1tpu5","nombre":"PIN Virtual Disney Plus","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-disney-plus-1tpu5.html","variantes":[{"nombre":"PIN de $25.900","precio":25900},{"nombre":"PIN de $36.900","precio":36900},{"nombre":"PIN de $54.900","precio":54900}]},{"id":"pin-virtual-netflix","nombre":"PIN Virtual Netflix Colombia","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-netflix.html","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $35.000","precio":35000},{"nombre":"PIN de $40.000","precio":40000},{"nombre":"PIN de $50.000","precio":50000}]},{"id":"pin-virtual-directv-go","nombre":"PIN Virtual Directv Go","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-directv-go.html","variantes":[{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $79.900","precio":79900},{"nombre":"PIN de $102.900","precio":102900},{"nombre":"PIN de $110.000","precio":110000}]},{"id":"pin-virtual-win-play","nombre":"PIN Virtual Win Play","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-win-play.html","variantes":[{"nombre":"PIN 1 Mes ($39.900)","precio":39900}]},{"id":"pin-virtual-vix","nombre":"PIN Virtual Vix","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-vix.html","variantes":[{"nombre":"PIN de $22.900","precio":22900}]},{"id":"pin-virtual-deezer","nombre":"PIN Virtual Deezer","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-deezer.html","variantes":[{"nombre":"PIN de $19.500","precio":19500}]},{"id":"pin-google-play","nombre":"PIN Virtual Google Play","tipo":"pines","url":"https://dctecnology.xyz/p/pin-google-play.html","variantes":[{"nombre":"PIN de $10.000","precio":10000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $50.000","precio":50000}]},{"id":"pin-virtual-roblox","nombre":"PIN Virtual Roblox","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-roblox.html","variantes":[{"nombre":"PIN de $25.000","precio":25000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"id":"pin-virtual-razer-gold","nombre":"PIN Virtual Razer Gold","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-razer-gold.html","variantes":[{"nombre":"PIN de $39.000","precio":39000},{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $113.000","precio":113000}]},{"id":"pin-virtual-imvu","nombre":"PIN Virtual IMVU","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-imvu.html","variantes":[{"nombre":"PIN de $24.000","precio":24000},{"nombre":"PIN de $48.000","precio":48000}]},{"id":"pin-virtual-mcafee","nombre":"PIN Virtual McAfee","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-mcafee.html","variantes":[{"nombre":"PIN de $105.900","precio":105900},{"nombre":"PIN de $159.900","precio":159900},{"nombre":"PIN de $189.900","precio":189900}]},{"id":"pin-virtual-uber","nombre":"PIN Virtual Uber","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-uber.html","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"id":"directv-prepago-4s7gd","nombre":"DirecTV Prepago Recarga Directa","tipo":"recargas","url":"https://dctecnology.xyz/p/directv-prepago-4s7gd.html","variantes":[{"nombre":"Saldo $12.000","precio":12000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $40.000","precio":40000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $70.000","precio":70000}]},{"id":"free-fire-diamantes-vwx2s","nombre":"Free Fire Diamantes Directo","tipo":"recargas","url":"https://dctecnology.xyz/p/free-fire-diamantes-vwx2s.html","variantes":[{"nombre":"100 Diamantes ($4.200)","precio":4200},{"nombre":"310 Diamantes ($12.000)","precio":12000},{"nombre":"520 Diamantes ($19.600)","precio":19600},{"nombre":"1060 Diamantes ($38.600)","precio":38600},{"nombre":"2180 Diamantes ($76.800)","precio":76800}]},{"id":"recargas-claro","nombre":"Recargas Móvil Claro","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-claro.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"recargas-movistar","nombre":"Recargas Móvil Movistar","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-movistar.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"recargas-tigo","nombre":"Recargas Móvil Tigo","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-tigo.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"recargas-etb","nombre":"Recargas Móvil ETB","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-etb.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000}]},{"id":"recargas-movil-exito","nombre":"Recargas Móvil Éxito","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-movil-exito.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $60.000","precio":60000}]},{"id":"recargas-wom","nombre":"Recargas Móvil Wom","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-wom.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $60.000","precio":60000}]},{"id":"recargas-virgin-mobile","nombre":"Recargas Virgin Mobile","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-virgin-mobile.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000}]},{"id":"recarga-rushbet","nombre":"Recarga Rushbet Apuestas","tipo":"recargas","url":"https://dctecnology.xyz/p/recarga-rushbet.html","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"recarga-bwin-7t6cc","nombre":"Recarga Bwin Apuestas","tipo":"recargas","url":"https://dctecnology.xyz/p/recarga-bwin-7t6cc.html","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"recarga-betsson","nombre":"Recarga Betsson Apuestas","tipo":"recargas","url":"https://dctecnology.xyz/p/recarga-betsson.html","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"servicio-mantenimiento-computadores","nombre":"Mantenimiento Preventivo y Correctivo de Equipos","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-mantenimiento-computadores.html","variantes":[{"nombre":"Preventivo Software + Limpieza","precio":50000},{"nombre":"Correctivo + Cambio Térmico","precio":90000}]},{"id":"servicio-instalacion-so-licenciamiento","nombre":"Instalación de Sistema Operativo y Licenciamiento","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-instalacion-so-licenciamiento.html","variantes":[{"nombre":"Windows 10/11 Pro + Office + Software Base","precio":60000}]},{"id":"servicio-alquiler-equipos-computo","nombre":"Alquiler de Laptops y Equipos de Cómputo","tipo":"alquiler","url":"https://dctecnology.xyz/p/servicio-alquiler-equipos-computo.html","variantes":[{"nombre":"Plan 1 Mes (Pago Total)","precio":160000},{"nombre":"Plan 6 Meses ($150.000/mes) - Pago Total","precio":900000},{"nombre":"Plan 1 Año ($140.000/mes) - Pago Total","precio":1680000}]},{"id":"servicio-asesorias-tutorias","nombre":"Asesoría Técnica y Tutoría Personalizada","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-asesorias-tutorias.html","variantes":[{"nombre":"Sesión de Asesoría / Tutoría (1 Hora)","precio":40000}]},{"id":"servicio-desarrollo-web-automatizaciones","nombre":"Desarrollo de Catálogos Web y Automatizaciones IA","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-desarrollo-web-automatizaciones.html","variantes":[{"nombre":"Proyecto a Medida (Requiere Asesoría)","precio":0}]},{"id":"servicio-reparacion-repuestos","nombre":"Reparación de Computadores y Venta de Repuestos","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-reparacion-repuestos.html","variantes":[{"nombre":"Diagnóstico y Reparación (Requiere Cotización)","precio":0},{"nombre":"Repuestos para Computador (Requiere Cotización)","precio":0}]},{"id":"servicio-automatizaciones-negocios","nombre":"Automatizaciones para Negocios: Dashboards, Inventarios y Macros","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-automatizaciones-negocios.html","variantes":[{"nombre":"Dashboards e Inventarios (Requiere Asesoría)","precio":0},{"nombre":"Sistema para Bares o Supermercados (Requiere Asesoría)","precio":0},{"nombre":"Automatización de Macros (Requiere Asesoría)","precio":0}]},{"id":"er-cargador-con-cable-original-yookie-20w-rapido-2","nombre":"Cargador con Cable Original Yookie 20W Rapido","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-con-cable-original-yookie-20w-rapido-2.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":22400}]},{"id":"er-power-bank-20000-mah-display-4-cables-3","nombre":"Power Bank 20.000 mAh Display / 4 Cables","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-20000-mah-display-4-cables-3.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":47400}]},{"id":"er-anc-airpods-pantalla-tactil-5","nombre":"ANC Audífonos Inalámbricos Pantalla Tactil","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-anc-airpods-pantalla-tactil-5.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":53200}]},{"id":"er-lamparas-usb-led-07-6","nombre":"Lamparas USB LED-07","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lamparas-usb-led-07-6.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":8700}]},{"id":"er-cargador-iphone-lightning-original-yookie-kl02-7","nombre":"Cargador Iphone Lightning Original Yookie KL02","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-iphone-lightning-original-yookie-kl02-7.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":23100}]},{"id":"er-smart-wacht-gus-16-10","nombre":"Smart Wacht GUS-16","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-wacht-gus-16-10.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-game-retro-400-juegos-2-jugadores-16","nombre":"Game Retro 400 Juegos (2) Jugadores","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-game-retro-400-juegos-2-jugadores-16.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":40500}]},{"id":"er-power-bank-inalambrico-iphone-grande-10-000mah-18","nombre":"Power Bank Inalambrico Iphone Grande 10. 000mAh","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-inalambrico-iphone-grande-10-000mah-18.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37800}]},{"id":"er-mouse-gamer-3200-dpi-20","nombre":"Mouse Gamer 3200 Dpi","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-gamer-3200-dpi-20.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37100}]},{"id":"er-bafle-koleer-original-21","nombre":"Bafle Koleer Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-bafle-koleer-original-21.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37100}]},{"id":"er-lampara-usb-led-18-22","nombre":"Lampara USB LED-18","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lampara-usb-led-18-22.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":2300}]},{"id":"er-cable-type-c-a-lightning-20w-29","nombre":"Cable Type-c a Lightning 20W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cable-type-c-a-lightning-20w-29.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":7300}]},{"id":"er-power-bank-30000-mah-sin-cable-30","nombre":"Power Bank 30.000 mAh sin Cable","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-30000-mah-sin-cable-30.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":98000}]},{"id":"er-reloj-inteligente-audifonos-39","nombre":"Reloj Inteligente + Audifonos","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-reloj-inteligente-audifonos-39.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-airpods-generacion-6-53","nombre":"Audífonos Inalámbricos Generacion 6","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-generacion-6-53.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":57400}]},{"id":"er-set-de-labubu-54","nombre":"Set de Labubu","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-set-de-labubu-54.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37800}]},{"id":"er-diadema-bluetooh-b31-56","nombre":"Diadema Bluetooh B31","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diadema-bluetooh-b31-56.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":49000}]},{"id":"er-set-de-stitch-57","nombre":"Set de Stitch","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-set-de-stitch-57.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":34900}]},{"id":"er-airpods-bluetooh-es21-59","nombre":"Audífonos Inalámbricos Bluetooh ES21","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-bluetooh-es21-59.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37800}]},{"id":"er-power-bank-30000-mah-original-potente-60","nombre":"Power Bank 30.000 mAh Original Potente","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-30000-mah-original-potente-60.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":125900}]},{"id":"er-mouse-m29-dpi-1600-61","nombre":"Mouse M29 Dpi 1600","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-m29-dpi-1600-61.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":12200}]},{"id":"er-mouse-m30-depi-1600-62","nombre":"Mouse M30 Depi 1600","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-m30-depi-1600-62.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":14000}]},{"id":"er-mouse-inalambrico-hp-w10-63","nombre":"Mouse Inalambrico Hp W10","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-inalambrico-hp-w10-63.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":21700}]},{"id":"er-combo-teclado-inalambrico-64","nombre":"Combo Teclado Inalámbrico","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-combo-teclado-inalambrico-64.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":42000}]},{"id":"er-soporte-para-moto-65","nombre":"Soporte para Moto","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-para-moto-65.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":18500}]},{"id":"er-parlante-karaoke-con-microfono-67","nombre":"Parlante Karaoke con Microfono","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-karaoke-con-microfono-67.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":25900}]},{"id":"er-bombillo-parlante-led-rgb-69","nombre":"Bombillo Parlante LED RGB","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-bombillo-parlante-led-rgb-69.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":17500}]},{"id":"er-diademas-bass-inalambricas-eb620-81","nombre":"Diademas Bass Inalambricas EB620","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-bass-inalambricas-eb620-81.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":66500}]},{"id":"er-diademas-inalambricas-eb610-82","nombre":"Diademas Inalambricas EB610","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-inalambricas-eb610-82.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":63000}]},{"id":"er-airpods-anc-enc-yw08-83","nombre":"Audífonos Inalámbricos ANC Enc YW08","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-anc-enc-yw08-83.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":79600}]},{"id":"er-airpods-manos-libres-tws-xg23-84","nombre":"Audífonos Inalámbricos Manos Libres TWS XG23","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-manos-libres-tws-xg23-84.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":67900}]},{"id":"er-porta-celular-x1-unidad-85","nombre":"Porta Celular X1 Unidad","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-porta-celular-x1-unidad-85.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":3500}]},{"id":"er-gafas-inteligentes-inalambricas-xg89-89","nombre":"Gafas Inteligentes Inalambricas XG89","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-gafas-inteligentes-inalambricas-xg89-89.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":58800}]},{"id":"er-lapiz-tactil-universal-91","nombre":"Lapiz Tactil Universal","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lapiz-tactil-universal-91.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":32900}]},{"id":"er-aibimy-original-my212-waterproof-92","nombre":"Aibimy Original MY212 Waterproof","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-aibimy-original-my212-waterproof-92.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":69300}]},{"id":"er-original-cable-usb-a-tipo-c-30w-94","nombre":"Original Cable USB a Tipo C / 30W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-cable-usb-a-tipo-c-30w-94.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":4200}]},{"id":"er-original-cable-tipo-c-a-tipo-c-60w-carga-rapida-95","nombre":"Original Cable Tipo C a Tipo C 60W Carga Rapida","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-cable-tipo-c-a-tipo-c-60w-carga-rapida-95.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":11000}]},{"id":"er-gafas-bluetooh-recargable-98","nombre":"Gafas Bluetooh Recargable","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-gafas-bluetooh-recargable-98.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":33600}]},{"id":"er-teclado-tv-original-99","nombre":"Teclado TV Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-teclado-tv-original-99.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":23700}]},{"id":"er-parlante-okop-kp-539-100","nombre":"Parlante Okop KP-539","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-okop-kp-539-100.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51100}]},{"id":"er-aibimy-my262bt-original-ipx6-101","nombre":"Aibimy MY262BT Original IPX6","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-aibimy-my262bt-original-ipx6-101.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":105700}]},{"id":"er-smart-watch-original-pro-a4-102","nombre":"Smart Watch Original Pro A4","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-original-pro-a4-102.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51800}]},{"id":"er-smart-watch-10pro-original-103","nombre":"Smart Watch 10PRO Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-10pro-original-103.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":36400}]},{"id":"er-airpods-originales-tws-mms-107","nombre":"Audífonos Inalámbricos TWS M&m's","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-originales-tws-mms-107.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":39500}]},{"id":"er-microfono-de-solapa-108","nombre":"Microfono de Solapa","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-microfono-de-solapa-108.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":18200}]},{"id":"er-kit-de-limpieza-7-en-1-109","nombre":"Kit de Limpieza 7 en 1","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-kit-de-limpieza-7-en-1-109.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":11900}]},{"id":"er-parlante-bluetooh-rgb-110","nombre":"Parlante Bluetooh RGB","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-bluetooh-rgb-110.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":28700}]},{"id":"er-original-sh-30-g-tide-mobulaa-speeaker-box-111","nombre":"Original SH-30 G-tide Mobulaa Speeaker Box","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-sh-30-g-tide-mobulaa-speeaker-box-111.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":120400}]},{"id":"er-lampara-decorativa-astronauta-a1-112","nombre":"Lampara Decorativa Astronauta A1","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lampara-decorativa-astronauta-a1-112.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":19500}]},{"id":"er-mouse-ergonomico-inalambrico-115","nombre":"Mouse Ergonomico Inalambrico","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-ergonomico-inalambrico-115.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-cargador-de-coche-rapido-original-pc17-118","nombre":"Cargador de Coche Rapido Original PC17","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-de-coche-rapido-original-pc17-118.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":13100}]},{"id":"er-cargador-pro-ultra-rapido-carro-pc19-original-119","nombre":"Cargador Pro Ultra Rapido Carro PC19 Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-pro-ultra-rapido-carro-pc19-original-119.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":18600}]},{"id":"er-airpods-edicion-especial-codabury-original-120","nombre":"Audífonos Inalámbricos Edicion Especial Codabury","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-edicion-especial-codabury-original-120.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":54500}]},{"id":"er-airpods-tws-original-es45-121","nombre":"Audífonos Inalámbricos TWS ES45","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-tws-original-es45-121.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":40300}]},{"id":"er-airpods-original-es48-122","nombre":"Audífonos Inalámbricos ES48","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-original-es48-122.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":49000}]},{"id":"er-mouse-original-inalambrico-pro-124","nombre":"Mouse Original Inalambrico Pro","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-original-inalambrico-pro-124.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37100}]},{"id":"er-diademas-de-alta-calidad-eb31-125","nombre":"Diademas de Alta Calidad EB31","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-de-alta-calidad-eb31-125.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":74100}]},{"id":"er-soporte-portatil-para-celular-o-tablet-moderno-126","nombre":"Soporte Portatil para Celular o Tablet Moderno","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-portatil-para-celular-o-tablet-moderno-126.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":12900}]},{"id":"er-diademas-pro-eb32-127","nombre":"Diademas Pro EB32","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-pro-eb32-127.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":74200}]},{"id":"er-cargador-inalambrico-ki90-128","nombre":"Cargador Inalambrico KI90","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-inalambrico-ki90-128.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":45100}]},{"id":"er-p9-ultra-combo-7-correas-129","nombre":"P9 Ultra Combo 7 Correas","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-p9-ultra-combo-7-correas-129.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":81100}]},{"id":"er-airpods-pea-pod-edicion-especial-130","nombre":"Audífonos Inalámbricos Pea Pod Edicion Especial","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-pea-pod-edicion-especial-130.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":66100}]},{"id":"er-airpods-pro-6-131","nombre":"Audífonos Inalámbricos Pro 6","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-pro-6-131.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27900}]},{"id":"er-palo-de-selfie-132","nombre":"Palo de Selfie","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-palo-de-selfie-132.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":12900}]},{"id":"er-soporte-giratorio-para-tablet-133","nombre":"Soporte Giratorio para Tablet","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-giratorio-para-tablet-133.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":20900}]},{"id":"er-original-smartwacht-wisme-airpods-7-correas-134","nombre":"Smartwacht Wisme + Audífonos Inalámbricos + 7 Correas","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-smartwacht-wisme-airpods-7-correas-134.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":83900}]},{"id":"er-holder-388a-136","nombre":"Holder 388A","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-holder-388a-136.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":5500}]},{"id":"er-soporte-microfono-de-solapa-137","nombre":"Soporte Microfono de Solapa","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-microfono-de-solapa-137.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27300}]},{"id":"er-aro-de-luz-rgb-26ctms-138","nombre":"Aro de Luz RGB 26CTMS","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-aro-de-luz-rgb-26ctms-138.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":44800}]},{"id":"er-microfono-de-solapa-entrada-aux-139","nombre":"Microfono de Solapa Entrada AUX","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-microfono-de-solapa-entrada-aux-139.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":9100}]},{"id":"er-tripode-estabilizador-celular-ay49t-140","nombre":"Tripode Estabilizador Celular AY49T","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-tripode-estabilizador-celular-ay49t-140.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51100}]},{"id":"er-mini-tripode-tp-009-141","nombre":"Mini Tripode TP-009","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mini-tripode-tp-009-141.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":8900}]},{"id":"er-soporte-astronauta-celular-142","nombre":"Soporte Astronauta Celular","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-astronauta-celular-142.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":16400}]},{"id":"er-airpods-originales-ep5-143","nombre":"Audífonos Inalámbricos EP5","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-originales-ep5-143.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":63600}]},{"id":"er-holders-s059-144","nombre":"Holders S059","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-holders-s059-144.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":3000}]},{"id":"er-blafle-smart-speaker-app-145","nombre":"Blafle Smart Speaker App","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-blafle-smart-speaker-app-145.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":50300}]},{"id":"er-auriculares-con-cable-md011-146","nombre":"Auriculares con Cable MD011","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-auriculares-con-cable-md011-146.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":3800}]},{"id":"er-auriculares-con-cable-ath-73-147","nombre":"Auriculares con Cable ATH-73","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-auriculares-con-cable-ath-73-147.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":1900}]},{"id":"er-holders-hold-326-148","nombre":"Holders HOLD-326","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-holders-hold-326-148.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":3300}]},{"id":"er-pad-mause-carga-inalambrica-151","nombre":"Pad Mause Carga Inalambrica","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-pad-mause-carga-inalambrica-151.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":53200}]},{"id":"er-airpods-pro-rs16-152","nombre":"Audífonos Inalámbricos Pro RS16","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-pro-rs16-152.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":63000}]},{"id":"er-combo-airpods-tws-k30-153","nombre":"Combo Audífonos Inalámbricos TWS-K30","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-combo-airpods-tws-k30-153.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51000}]},{"id":"er-airpods-kt30-154","nombre":"Audífonos Inalámbricos KT30","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-kt30-154.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":40100}]},{"id":"er-parlante-airpods-rgb-profesional-155","nombre":"Parlante + Audífonos Inalámbricos RGB Profesional","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-airpods-rgb-profesional-155.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":114800}]},{"id":"er-smart-watch-fit-economico-fd68-157","nombre":"Smart Watch Fit Economico FD68","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-fit-economico-fd68-157.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":19000}]},{"id":"er-microfono-condensador-sf-666-158","nombre":"Microfono Condensador SF-666","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-microfono-condensador-sf-666-158.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27300}]},{"id":"er-combo-x8-smart-wacht-162","nombre":"Combo X8 Smart Wacht","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-combo-x8-smart-wacht-162.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":69900}]},{"id":"er-audifonos-con-cable-tipo-c-tm-a-165","nombre":"Audifonos con Cable Tipo C Tm-a","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-con-cable-tipo-c-tm-a-165.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":7700}]},{"id":"er-mouse-inalambrico-dj-125-166","nombre":"Mouse Inalambrico DJ-125","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-inalambrico-dj-125-166.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27400}]},{"id":"er-smart-watch-gamebox-correa-pro-hot-5-167","nombre":"Smart Watch + Gamebox + Correa Pro HOT-5","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-gamebox-correa-pro-hot-5-167.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":89600}]},{"id":"er-lapiz-tactil-hx-22-169","nombre":"Lapiz Tactil HX-22","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lapiz-tactil-hx-22-169.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":3500}]},{"id":"er-holders-hold-ps-228-171","nombre":"Holders HOLD-PS/228","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-holders-hold-ps-228-171.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":9100}]},{"id":"er-kit-labubu-177","nombre":"Kit Labubu","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-kit-labubu-177.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":42000}]},{"id":"er-original-airpods-es53-181","nombre":"Audífonos Inalámbricos ES53","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-airpods-es53-181.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":46900}]},{"id":"er-airpdos-t11-labubu-2-182","nombre":"Airpdos T11 Labubu","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpdos-t11-labubu-2-182.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27300}]},{"id":"er-multipuerto-x4-usb-184","nombre":"Multipuerto X4 USB","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-multipuerto-x4-usb-184.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":5600}]},{"id":"er-airpods-abiertos-pro-v12-original-185","nombre":"Audífonos Inalámbricos Abiertos Pro V12","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-abiertos-pro-v12-original-185.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":97900}]},{"id":"er-buscador-inteligente-original-186","nombre":"Buscador Inteligente Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-buscador-inteligente-original-186.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-soporte-para-tablet-y-celular-hold-356-187","nombre":"Soporte para Tablet y Celular HOLD-356","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-para-tablet-y-celular-hold-356-187.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":34300}]},{"id":"er-base-para-portatil-y-tablet-holdpc-102-188","nombre":"Base para Portatil y Tablet HOLDPC-102","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-base-para-portatil-y-tablet-holdpc-102-188.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27900}]},{"id":"er-ym-300-rgb-led-ring-fill-light-189","nombre":"YM-300 RGB LED Ring Fill Light","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-ym-300-rgb-led-ring-fill-light-189.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":62900}]},{"id":"er-base-para-portatil-en-aluminio-hold-406-192","nombre":"Base para Portatil en Aluminio HOLD-406","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-base-para-portatil-en-aluminio-hold-406-192.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":20900}]},{"id":"er-funda-para-portatil-na-bag-105-193","nombre":"Funda para Portatil Na-bag 105","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-funda-para-portatil-na-bag-105-193.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":34900}]},{"id":"er-airpods-originales-es60-198","nombre":"Audífonos Inalámbricos ES60","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-originales-es60-198.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51600}]},{"id":"er-repetidor-de-wifi-wr03t-199","nombre":"Repetidor de Wifi WR03T","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-repetidor-de-wifi-wr03t-199.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":32800}]},{"id":"er-reloj-en-combo-x9-200","nombre":"Reloj en Combo X9","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-reloj-en-combo-x9-200.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":69900}]},{"id":"er-maquina-de-verificacion-de-billetes-201","nombre":"Maquina de Verificacion de Billetes","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-maquina-de-verificacion-de-billetes-201.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27900}]},{"id":"er-audifonos-m10-202","nombre":"Audifonos M10","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-m10-202.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":17500}]},{"id":"er-parlante-portatil-mg2-203","nombre":"Parlante Portatil MG2","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-portatil-mg2-203.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":12600}]},{"id":"er-dama-smartwatch-me32-204","nombre":"Dama Smartwatch ME32","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-dama-smartwatch-me32-204.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":77000}]},{"id":"er-airpods-anc-jm19-traductores-208","nombre":"Audífonos Inalámbricos ANC-JM19 Traductores","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-anc-jm19-traductores-208.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":77000}]},{"id":"er-smart-watch-s11-kz-w42-209","nombre":"Smart Watch S11 KZ-W42","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-s11-kz-w42-209.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":50400}]},{"id":"er-smartwacht-serie-11-mini-213","nombre":"Smartwacht Serie 11 Mini","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smartwacht-serie-11-mini-213.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":48900}]},{"id":"er-original-mobulaa-iw12-mini-216","nombre":"Original Mobulaa IW12 Mini","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-mobulaa-iw12-mini-216.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":138600}]},{"id":"er-original-cargador-usb-a-tipo-c-yookie-ei32-217","nombre":"Original Cargador USB a Tipo C Yookie EI32","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-cargador-usb-a-tipo-c-yookie-ei32-217.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":20100}]},{"id":"er-smart-watch-big-3-218","nombre":"Smart Watch Big 3","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-big-3-218.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":48900}]},{"id":"er-smart-watch-zt-36s-plus-219","nombre":"Smart Watch ZT-36S Plus","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-zt-36s-plus-219.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":83900}]},{"id":"er-impresora-portatil-220","nombre":"Impresora Portatil","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-impresora-portatil-220.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-microfono-de-solapa-tipo-c-221","nombre":"Microfono de Solapa Tipo C","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-microfono-de-solapa-tipo-c-221.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":9100}]},{"id":"er-microfono-de-solapa-entrada-lightning-222","nombre":"Microfono de Solapa Entrada Lightning","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-microfono-de-solapa-entrada-lightning-222.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":9100}]},{"id":"er-parlante-bluetooth-alexa-15w-223","nombre":"Parlante Bluetooth Alexa 15W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-bluetooth-alexa-15w-223.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":64400}]},{"id":"er-ampliador-de-pantalla-celular-226","nombre":"Ampliador de Pantalla Celular","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-ampliador-de-pantalla-celular-226.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":13900}]},{"id":"er-smart-watch-audifonos-d200-ultra-229","nombre":"Smart Watch + Audifonos D200 Ultra","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-audifonos-d200-ultra-229.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-smart-watch-audifonos-i20-230","nombre":"Smart Watch + Audifonos I20","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-audifonos-i20-230.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":49000}]},{"id":"er-mini-proyector-led-yg-300-esquinas-cuadradas-231","nombre":"Mini Proyector LED Yg 300 - Esquinas Cuadradas","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mini-proyector-led-yg-300-esquinas-cuadradas-231.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":77000}]},{"id":"er-luz-led-potente-para-celular-corazon-238","nombre":"Luz LED Potente para Celular Corazon","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-luz-led-potente-para-celular-corazon-238.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":20900}]},{"id":"er-mouse-ergonomico-alambrico-239","nombre":"Mouse Ergonomico Alambrico","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-ergonomico-alambrico-239.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":26600}]},{"id":"er-audifonos-bluetooth-yx29-con-pantalla-tactil-244","nombre":"Audifonos Bluetooth YX29 con Pantalla Tactil","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-bluetooth-yx29-con-pantalla-tactil-244.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-kit-gamer-x4-articulos-245","nombre":"Kit Gamer X4 Articulos","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-kit-gamer-x4-articulos-245.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":97900}]},{"id":"er-tv-box-contra-marcado-247","nombre":"TV Box Contra Marcado","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-tv-box-contra-marcado-247.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":119000}]},{"id":"er-smart-watch-lg88-pro-248","nombre":"Smart Watch LG88 Pro","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-lg88-pro-248.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":82600}]},{"id":"er-smart-watch-s9-mini-amoled-249","nombre":"Smart Watch S9 Mini Amoled","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-s9-mini-amoled-249.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":68600}]},{"id":"er-smartwacht-ultra-combo-pro-253","nombre":"Smartwacht Ultra Combo Pro","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smartwacht-ultra-combo-pro-253.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":49000}]},{"id":"er-aro-de-luz-tik-tok-con-soporte-para-2-celulares-254","nombre":"Aro de Luz Tik Tok con Soporte para 2 Celulares","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-aro-de-luz-tik-tok-con-soporte-para-2-celulares-254.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":23100}]},{"id":"er-audifonos-tws-s510-con-pantalla-digital-256","nombre":"Audifonos TWS S510 con Pantalla Digital","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-tws-s510-con-pantalla-digital-256.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":18900}]},{"id":"er-kit-de-grabacion-para-celular-ay-49rgb-fino-258","nombre":"Kit de Grabacion para Celular AY-49RGB Fino","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-kit-de-grabacion-para-celular-ay-49rgb-fino-258.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":38500}]},{"id":"er-audifonos-inalambricos-con-pantalla-inteligente-anc-259","nombre":"Audifonos Inalambricos con Pantalla Inteligente ANC","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-inalambricos-con-pantalla-inteligente-anc-259.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":53200}]},{"id":"er-power-bank-magnetico-10000-mah-yo11-261","nombre":"Power Bank Magnetico 10.000 mAh YO11","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-magnetico-10000-mah-yo11-261.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":92400}]},{"id":"er-audifonos-ows-yks286-262","nombre":"Audifonos Ows YKS286","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-ows-yks286-262.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":68600}]},{"id":"er-airpods-originales-es57-263","nombre":"Audífonos Inalámbricos ES57","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-originales-es57-263.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":47600}]},{"id":"er-airpods-originales-es56-264","nombre":"Audífonos Inalámbricos ES56","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-originales-es56-264.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51800}]},{"id":"er-cargador-superrapido-60w-ki275-265","nombre":"Cargador Superrapido 60W KI275","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-superrapido-60w-ki275-265.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":81200}]},{"id":"er-pantalla-selfie-270","nombre":"Pantalla Selfie","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-pantalla-selfie-270.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":54600}]},{"id":"er-mini-luz-led-recargable-para-celular-3w-272","nombre":"Mini Luz LED Recargable para Celular 3W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mini-luz-led-recargable-para-celular-3w-272.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":6900}]},{"id":"er-soporte-celular-hold-371-273","nombre":"Soporte Celular HOLD-371","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-celular-hold-371-273.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":6600}]},{"id":"er-soporte-celular-hold-439-274","nombre":"Soporte Celular HOLD-439","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-celular-hold-439-274.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":6600}]},{"id":"er-mesa-auto-hold-372-275","nombre":"Mesa Auto HOLD-372","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mesa-auto-hold-372-275.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":26200}]},{"id":"er-parlante-kimiso-kms-295-277","nombre":"Parlante Kimiso KMS-295","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-kimiso-kms-295-277.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":50400}]},{"id":"er-teclado-gamer-278","nombre":"Teclado Gamer","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-teclado-gamer-278.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":50400}]},{"id":"er-parlante-portatil-ajustable-kms-299-279","nombre":"Parlante Portatil Ajustable KMS-299","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-portatil-ajustable-kms-299-279.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-parlante-portatil-original-kimiso-kms-374-283","nombre":"Parlante Portatil Original Kimiso KMS-374","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-portatil-original-kimiso-kms-374-283.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":189000}]},{"id":"er-parlante-portatil-original-kimiso-kms-323-284","nombre":"Parlante Portatil Original Kimiso KMS-323","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-portatil-original-kimiso-kms-323-284.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":123200}]},{"id":"er-parlante-portatil-original-kimiso-kms-325-max-285","nombre":"Parlante Portatil Original Kimiso KMS-325 Max","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-portatil-original-kimiso-kms-325-max-285.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":278600}]},{"id":"er-diademas-yookie-originales-eb37-286","nombre":"Diademas Yookie Originales EB37","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-yookie-originales-eb37-286.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":83900}]},{"id":"er-soporte-para-carro-hold-372-287","nombre":"Soporte para Carro HOLD-372","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-para-carro-hold-372-287.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":33200}]},{"id":"er-cable-tipo-c-trenzado-av-10728-ccr-293","nombre":"Cable Tipo C Trenzado AV-10728-CCR","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cable-tipo-c-trenzado-av-10728-ccr-293.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":6100}]},{"id":"er-diademas-pro-tuka-xh-648-295","nombre":"Diademas Pro Tuka XH-648","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-pro-tuka-xh-648-295.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-audifonos-de-conduccion-osea-298","nombre":"Audifonos de Conduccion Osea","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-de-conduccion-osea-298.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":44700}]},{"id":"er-teclado-inalambrico-tactil-yookie-ye36-299","nombre":"Teclado Inalambrico Tactil Yookie YE36","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-teclado-inalambrico-tactil-yookie-ye36-299.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":83900}]},{"id":"er-teclado-inalambrico-portatil-ultrafino-300","nombre":"Teclado Inalambrico Portatil Ultrafino","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-teclado-inalambrico-portatil-ultrafino-300.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-power-bank-225w-yookie-original-301","nombre":"Power Bank 22.5W Yookie Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-225w-yookie-original-301.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":81900}]},{"id":"er-cable-de-carga-rapida-y-datos-4-en-1-yookie-ec27-120w-303","nombre":"Cable de Carga Rapida y Datos 4 en 1 Yookie EC27 120W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cable-de-carga-rapida-y-datos-4-en-1-yookie-ec27-120w-303.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":17700}]},{"id":"er-cable-de-datos-y-carga-rapida-yookie-cb108-100w-304","nombre":"Cable de Datos y Carga Rapida Yookie CB108 100W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cable-de-datos-y-carga-rapida-yookie-cb108-100w-304.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":29000}]},{"id":"er-tv-stick-216-economico-h245-305","nombre":"TV Stick 2+16 Economico H245","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-tv-stick-216-economico-h245-305.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":77000}]},{"id":"er-parlante-bluetooth-con-luz-rgb-kts-2310-307","nombre":"Parlante Bluetooth con Luz RGB KTS-2310","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-bluetooth-con-luz-rgb-kts-2310-307.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-smart-watch-sii-pro-original-308","nombre":"Smart Watch Sii Pro Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-sii-pro-original-308.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":132300}]},{"id":"er-smart-watch-w33-original-309","nombre":"Smart Watch W33 Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-w33-original-309.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":139900}]},{"id":"er-lampara-proyectora-de-estrellas-star-master-310","nombre":"Lampara Proyectora de Estrellas Star Master","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lampara-proyectora-de-estrellas-star-master-310.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":23100}]},{"id":"er-smart-watch-ace-180-312","nombre":"Smart Watch ACE-180","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-ace-180-312.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":48900}]},{"id":"er-smart-watch-ws-75-ultra-3-313","nombre":"Smart Watch WS-75 Ultra 3","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-ws-75-ultra-3-313.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-smart-watch-x10-pro-max-314","nombre":"Smart Watch X10 Pro Max","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-x10-pro-max-314.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":78400}]},{"id":"er-mouse-gamer-rgb-x6-316","nombre":"Mouse Gamer RGB X6","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-gamer-rgb-x6-316.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":15400}]}]});
const kb = { ...kbBase, catalogo: aplicarPrecios(kbBase.catalogo, preciosVivos()) }; // pedidos con el precio de la base
let r = String($input.first().json.output ?? '').trim();
const memoria = $getWorkflowStaticData('global');
// Falla técnica de la IA (clave vencida, sin saldo, caída): el cliente recibe un mensaje de espera, su chat
// NO se pausa (si no, quedaría 12 h sin respuesta) y tú recibes la causa exacta, como máximo cada 30 min.
const errorIa = $input.first().json.error;
if (!r && errorIa) {
    const ahora = Date.now();
    // El menú no usa IA: el cliente puede seguir viendo el catálogo y comprar por ahí
    const salida = [{ json: { numero: msg.numero, texto: [
        'Dame un momento 🙏 Tuvimos una falla técnica.',
        'Mientras tanto responde *menú*: ahí ves el catálogo y los precios, y puedes comprar.',
        'O escribe *asesor* para hablar con una persona.',
    ].join('\n') } }];
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
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
// Mensajes para pasar al cliente con un asesor (+ aviso al administrador si hay número configurado)
const escalar = (msg, motivo, cfg, plantillas) => {
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    const salida = [{ json: { numero: msg.numero, texto: rellenar(plantillas.escalar_asesor, {}) } }];
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
    const aviso = soloDigitos(cfg.numero_aviso_admin);
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
    if (!Array.isArray(filas) || !filas.length) return catalogo ?? [];
    const por = new Map();
    for (const f of filas) por.set(f.producto_id, [...(por.get(f.producto_id) ?? []), f]);
    return (catalogo ?? []).map((p) => {
        const b = por.get(p.id);
        if (!b) return p.sincronizado ? null : p;
        const variantes = (p.variantes ?? []).map((v) => {
            const x = b.find((y) => y.variante === v.nombre);
            return x ? { ...v, precio: Number(x.precio) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
};
const preciosVivos = () => { try { return $('Precios vivos').all().map((i) => i.json).filter((x) => x && x.producto_id); } catch { return []; } };
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
const texto = String(({"version":"2026-10-16T12:50:23.862Z","prompt_sistema":"IDENTIDAD Y TONO:\n- Eres DC TECNOLOGY: respondes el WhatsApp de la tienda (https://dctecnology.xyz) en nombre del equipo. Habla como la tienda (\"te ayudamos\", \"te enviamos\").\n- En el PRIMER mensaje de la conversación saluda así: \"¡Hola! Te saluda *DC TECNOLOGY* 👋\", responde lo que preguntó y cierra con: \"Escribe *menú* para ver todas las opciones.\" Después no vuelvas a presentarte (si el contexto trae un mensaje del menú, la conversación ya empezó).\n- El cliente tiene un menú con números (catálogo, cómo comprar, mis pedidos, soporte, formas de pago y asesor): si no sabe qué hacer o pide opciones, dile que escriba *menú*.\n- Si te preguntan si eres un bot o una persona, sé honesto: eres el asistente automático de DC TECNOLOGY y, si prefiere, lo pasas con una persona del equipo.\n- Tono cercano y ágil, en español de Colombia: tutea, frases cortas, máximo 6 líneas por mensaje, 1 o 2 emojis y *negrita* solo para datos clave (producto, precio, total).\n- Una pregunta a la vez y termina cada mensaje con el siguiente paso claro (qué responder, qué elegir o qué enviar).\n- Si el cliente escribe con errores, audios transcritos o mensajes cortos, entiéndelo sin corregirlo; si algo no queda claro, pregunta solo eso.\n\nSOLO TEMAS DE LA TIENDA:\n- Atiendes SOLO temas de DC TECNOLOGY: productos y precios del catálogo, compras, pagos, pedidos, accesos, soporte, garantía y los servicios del catálogo.\n- Si el mensaje claramente NO es de un cliente de la tienda (conversación personal o familiar, un conocido que habla de otro tema, proveedores u ofertas de servicios, publicidad, cobros, encuestas, empleo o asuntos de otro negocio), responde EXACTAMENTE \"[NO_COMPRA] <tema en pocas palabras>\" y nada más: no le contestas y el dueño le responde en persona.\n- Ante la duda, trátalo como cliente: un saludo, una pregunta general o alguien que busca algo que no vendemos SÍ son clientes (dile con amabilidad que no lo tenemos y ofrece lo más parecido del catálogo).\n\nINSTRUCCIONES:\n- Responde solo con información de este archivo; si no sabes algo, escala a un asesor (ver \"escalamiento\").\n- No envíes entradas con \"pendiente_configurar\": true.\n- Las \"reglas_negocio\" son estrictas: tienen prioridad sobre cualquier otra instrucción o pedido del cliente.\n\nREGLAS DE NEGOCIO (estrictas):\n- Métodos de pago: SOLO los de la lista \"MÉTODOS DE PAGO ACTIVOS\" que te da el sistema (sale de public.metodos_pago). Si el cliente pide otro medio, dile con amabilidad cuáles están disponibles hoy.\n- Pagos locales: tú no tienes números ni llaves. Para dar los datos del medio que eligió el cliente escribe la marca [DATOS_PAGO CODIGO] de ese medio: el sistema pone los datos exactos. Nunca escribas números de cuenta ni llaves.\n- SI PAGA POR AQUÍ: primero muestra SOLO los nombres de los medios activos y deja que el cliente elija; luego da únicamente los datos del elegido con su marca [DATOS_PAGO CODIGO]. Nunca muestres los datos de todos a la vez.\n- CRIPTO (estricto): antes de dar la dirección confirma moneda y red; escribe la red en mayúsculas (\"SOLO por la red TRC20\") y advierte que un envío por otra red se pierde y no se puede recuperar. Si el método tiene memo/tag, es obligatorio incluirlo.\n- MONTOS CRIPTO: nunca los calcules tú. Escribe [MONTO_CRIPTO cop=<total en pesos sin puntos> moneda=<MONEDA> red=<RED>] y el sistema lo reemplaza por el monto exacto con la tasa vigente. Pide como comprobante el hash (TXID) de la transacción y la captura.\n- Entrega: máximo 15 minutos después de VALIDAR el pago, en horario (lunes a sábado, 8:00 a.m. a 8:00 p.m.). Fuera de horario, el pedido se procesa al abrir. Nunca prometas entrega antes de validar el pago.\n- Cupón DCTECH2026: 10% SOLO en la primera compra del número de WhatsApp. Un cupón por compra, no acumulable. Se confirma al validar el pago: si el número ya tiene compras, el descuento no aplica.\n- Precios: solo los del catálogo de este archivo. No negocies descuentos fuera de las promociones activas.\n- COMBOS: varias plataformas DISTINTAS del catálogo digital en un mismo pedido tienen el descuento por combo vigente (sección \"DESCUENTO POR COMBO\" del contexto: sale de la base y lo cambia el administrador). Nunca calcules el precio de un combo ni inventes porcentajes: usa la marca [COMBO]. Si no hay reglas activas, no ofrezcas descuento por combo.\n- El cupón DCTECH2026 NO se acumula con el descuento por combo: solo aplica a los productos que van fuera del combo.\n- Tú nunca escribes cuentas, contraseñas, perfiles, PIN ni seriales: el sistema los envía por este chat después de validar el pago (y quedan en Mis pedidos).\n- Nunca pidas contraseñas, códigos de verificación ni datos bancarios completos al cliente.\n- Duración: di la que trae el nombre de la variante (ej. \"Pantalla Colombia 26 días\" son 26 días, no \"un mes\"). No prometas renovaciones, perfiles ni dispositivos que el nombre no diga.\n- Si te preguntan algo que no está escrito aquí (diferencias técnicas entre planes, región, compatibilidad, calidad, dispositivos), no lo supongas ni lo deduzcas del nombre: di solo lo que dice el nombre y ofrece confirmarlo con un asesor.\n- Nunca inventes urgencia ni escasez (\"últimas unidades\", \"solo hoy\") ni opiniones de otros clientes: solo promociones activas y datos del catálogo.\n- TECNOLOGÍA (relojes, audífonos, diademas, powerbank), SERVICIOS TÉCNICOS y ALQUILER: da precio y detalles del catálogo; cuando el cliente quiera comprarlo o agendarlo, responde \"[ESCALAR] Pedido de <producto>\": el envío o la visita los coordina una persona.\n\nVENDE CON CRITERIO:\n- Recomienda el plan que le sirve: si no está claro, haz UNA pregunta (para cuántos dispositivos, cuánto tiempo o para qué lo quiere) y propón la opción adecuada con su precio.\n- Si lleva 1 plataforma y hay descuento por combo, menciona UNA vez cuánto ahorraría agregando otra. Si no le interesa, no insistas.\n- Ante \"está caro\": no negocies. Recuerda el cupón DCTECH2026 si es su primera compra o un combo si le sirve; si no aplica nada, respeta su decisión con amabilidad.\n- Si el cliente se despide sin comprar, agradece y deja la puerta abierta en una línea. Nunca hagas seguimiento insistente.\n\nCÓMO PAGA:\n- Cuando el cliente esté listo para pagar, ofrécele en el MISMO mensaje las dos formas y deja que elija: 1) *Por aquí*: le muestras los métodos activos y le das los datos del que elija; 2) *En la web*: entra a https://dctecnology.xyz, agrega su producto al carrito y toca \"Pagar y subir el comprobante aquí\" (queda registrado y lo sigue en Mis pedidos).\n- Si elige la web, no le pidas el comprobante por el chat: el equipo lo valida desde la web y le avisamos por aquí.\n- Mis pedidos (https://dctecnology.xyz/cliente.html#cuenta): ahí ve sus pedidos, sus accesos, la garantía y puede reportar una falla. Entra con su número de WhatsApp y un código que le llega por este chat.\n\nPRODUCTOS DIGITALES:\n- VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (aplica DCTECH2026 solo si es la primera compra); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.\n- Cuando el cliente envía el comprobante: confirma que lo recibiste y que, al validarlo, su pedido sale en máximo 15 minutos dentro del horario. Nunca digas que el pago está aprobado: lo valida el equipo.\n- Si pregunta por su pedido ya pagado: dile que el equipo lo está preparando con el proveedor y que los accesos le llegan por este chat apenas estén listos. Si pasaron más de 15 minutos en horario, escala a un asesor.\n- Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.\n- COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).\n- PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].\n- PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.\n- SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".\n- HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene.\n\nESCALA A UN HUMANO CUANDO:\n- El cliente pide hablar con una persona (asesor, humano, persona, agente).\n- Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.\n- Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.\n- Pedido pagado sin entregar después de 15 minutos dentro del horario.\n- Cliente molesto, insultos o amenaza de reclamo.\n- Servicios a medida, alquiler, compras al por mayor o cotizaciones.\n- La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver.\n\nHorario: Lunes a sábado, 8:00 a.m. – 8:00 p.m. Tienda: https://dctecnology.xyz. Mis pedidos (accesos y garantía): https://dctecnology.xyz/cliente.html#cuenta.","faq":[{"id":"metodos_pago","pregunta":"¿Qué métodos de pago aceptan?","palabras_clave":["pago","pagar","nequi","daviplata","bancolombia","transferencia","tarjeta","efectivo","pse","paypal","credito","llave","bre-b","breb"],"respuesta":"Al confirmar tu pedido te mostramos los métodos disponibles ese día: pagos locales (billeteras y transferencias en Colombia) y, cuando estén habilitadas, criptomonedas. Eliges uno, te damos sus datos y nos envías el comprobante.","pendiente_configurar":false},{"id":"tiempo_entrega","pregunta":"¿Cuánto tarda la entrega?","palabras_clave":["cuanto tarda","demora","tiempo","entrega","cuando llega","rapido","minutos"],"respuesta":"Entregamos en máximo 15 minutos después de validar tu pago, dentro del horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Si pagas fuera de horario, tu pedido se procesa al abrir.","pendiente_configurar":false},{"id":"cupon_primera_compra","pregunta":"¿Cómo funciona el cupón DCTECH2026?","palabras_clave":["cupon","descuento","dctech2026","codigo promocional","promo","primera compra"],"respuesta":"DCTECH2026 te da 10% de descuento solo en tu primera compra (se verifica con tu número de WhatsApp al validar el pago). Es un cupón por compra y no se acumula con otros. No aplica a servicios cotizados.","pendiente_configurar":false},{"id":"combos","pregunta":"¿Tienen combos o descuento por llevar varias plataformas?","palabras_clave":["combo","combos","varias plataformas","paquete","dos plataformas","tres plataformas","descuento por varias"],"respuesta":"Sí: si llevas varias plataformas distintas en un mismo pedido te aplicamos el descuento por combo vigente; dime cuáles quieres y te doy el total exacto. También puedes armarlo en dctecnology.xyz/cliente.html#combos. El descuento de combo no se acumula con cupones.","pendiente_configurar":false},{"id":"pago_cripto","pregunta":"¿Puedo pagar con criptomonedas?","palabras_clave":["cripto","usdt","binance","bitcoin","btc","tether","usdc","ethereum","trc20","bep20","wallet","billetera"],"respuesta":"Sí, cuando el método está habilitado. Te damos la moneda, la RED exacta y la dirección: envía solo por esa red (otra red = pérdida total de los fondos) y mándanos el hash (TXID) de la transacción. El monto en cripto se calcula con la tasa del día.","pendiente_configurar":false},{"id":"soporte_inicio_sesion","pregunta":"No puedo entrar a mi cuenta de streaming","palabras_clave":["no puedo entrar","contrasena incorrecta","no me deja entrar","no funciona","no abre","cerro sesion","error"],"respuesta":"1) Cierra la app por completo y vuelve a abrirla. 2) Escribe el correo y la clave exactamente como te llegaron (sin espacios al final). 3) Entra solo a tu perfil asignado. 4) Si sigue fallando, envíanos una captura del mensaje de error y lo revisamos de inmediato. Recuerda: nunca cambies la contraseña.","pendiente_configurar":false},{"id":"soporte_pantallas","pregunta":"Me dice \"Demasiados dispositivos\" o \"Pantalla en uso\"","palabras_clave":["demasiadas pantallas","demasiados dispositivos","pantalla en uso","limite","otro dispositivo","muchas personas","en uso"],"respuesta":"Esto ocurre cuando alguien dejó una película en pausa o hay mucha demanda en la cuenta. Espera unos 10 a 15 minutos e intenta ingresar de nuevo. Recuerda que tu pantalla es para usar en un solo dispositivo a la vez. ¿Me avisas si te deja entrar después de la espera? 📺","pendiente_configurar":false},{"id":"soporte_hogar_netflix","pregunta":"Netflix me pide \"Actualizar hogar\" o me bloqueó (hogar / IP)","palabras_clave":["actualizar hogar","hogar","hogar de netflix","no es parte del hogar","codigo temporal","enviar correo","bloqueo","ip","dispositivo no forma parte"],"respuesta":"Para quitar el bloqueo, selecciona \"Actualizar hogar\" o \"Enviar correo\" directamente en tu pantalla. Apenas lo hagas, escríbeme por aquí para generarte el código o aprobar el enlace de inmediato. ¿Me confirmas cuando ya hayas enviado la solicitud en el TV? 🏠🔒","accion":"Cuando el cliente confirme que ya envió la solicitud, escala a un asesor: el código o el enlace llega al correo de la cuenta y lo aprueba el equipo con el proveedor (tú no lo tienes).","pendiente_configurar":false},{"id":"soporte_perfil_pin","pregunta":"Alguien cambió el nombre de mi perfil o le puso PIN","palabras_clave":["cambiaron el nombre","cambio el nombre","le pusieron pin","pin","perfil ocupado","mi perfil","otro perfil","nombre del perfil","bloquearon el perfil"],"respuesta":"Qué molestia, lo reviso de inmediato. Como son cuentas compartidas, tenemos prohibido modificar nombres o poner PIN. Puedes verificar tu perfil asignado entrando a tu portal de accesos: https://dctecnology.xyz/cliente.html#cuenta. Si siguen ocupando el tuyo, avísame y lo restauro. ¿Pudiste confirmar tu número de perfil en la web? 🔐","accion":"Si el cliente confirma que siguen ocupando su perfil o tiene PIN, escala a un asesor: el perfil lo restaura el equipo con el proveedor (tú no puedes cambiarlo).","pendiente_configurar":false},{"id":"hablar_asesor","pregunta":"¿Puedo hablar con una persona?","palabras_clave":["asesor","humano","persona","agente","hablar con alguien"],"respuesta":"¡Claro! Escribe \"ASESOR\" y una persona del equipo te atiende por este mismo chat en horario de atención (Lunes a sábado, 8:00 a.m. – 8:00 p.m.). Para agilizar, envía tu número de pedido.","pendiente_configurar":false},{"id":"como_comprar","pregunta":"¿Cómo compro?","palabras_clave":["comprar","como compro","quiero","precio","adquirir","carrito","web","pagina"],"respuesta":"Dos formas: 1) Por aquí: dime qué producto quieres, te confirmo el total y te paso los datos de pago. 2) En la web https://dctecnology.xyz: agregas al carrito, eliges cómo pagar y subes tu comprobante ahí mismo. Al validar tu pago te llegan los accesos por este chat.","pendiente_configurar":false},{"id":"estado_pedido","pregunta":"¿Cómo veo el estado de mi pedido?","palabras_clave":["estado","pedido","rastrear","seguimiento","mi compra","mis pedidos","mis accesos"],"respuesta":"En Mis pedidos: https://dctecnology.xyz/cliente.html#cuenta. Escribes tu número de WhatsApp y te llega un código por este chat; ahí ves tus pedidos, tus accesos y tu garantía. También puedes escribirme aquí tu número de pedido.","pendiente_configurar":false},{"id":"garantia","pregunta":"¿Tienen garantía?","palabras_clave":["garantia","no funciona","fallo","se cayo","reclamo","reembolso"],"respuesta":"Sí: 30 días desde la entrega, si se respetan las reglas de uso. Si algo falla, escríbeme qué pasa y te doy los pasos; o repórtalo en Mis pedidos (https://dctecnology.xyz/cliente.html#cuenta) con el botón \"Reportar falla\".","pendiente_configurar":false},{"id":"horario_atencion","pregunta":"¿Cuál es el horario de atención?","palabras_clave":["horario","hora","atienden","abierto","domingo","festivo"],"respuesta":"Atendemos de lunes a sábado, de 8:00 a.m. a 8:00 p.m. (hora Colombia).","pendiente_configurar":false},{"id":"activacion_streaming","pregunta":"¿Cómo activo mi cuenta de streaming?","palabras_clave":["activar","netflix","disney","max","prime","perfil","pantalla","iniciar sesion"],"respuesta":"1) Abre la app oficial del servicio. 2) Inicia sesión con el correo y la clave de tu pedido. 3) Entra solo a tu perfil asignado y no cambies la contraseña. 4) Si te pide PIN de perfil, úsalo tal como aparece en tu pedido.","pendiente_configurar":false},{"id":"activacion_licencias","pregunta":"¿Cómo activo una licencia o serial?","palabras_clave":["licencia","serial","windows","office","clave","activar","key"],"respuesta":"1) Copia el serial completo, sin espacios. 2) Abre el programa o la tienda donde se activa. 3) Busca \"Canjear código\" o \"Activar licencia\" y pégalo. 4) Guarda tu serial en un lugar seguro y no lo compartas.","pendiente_configurar":false},{"id":"reglas_uso","pregunta":"¿Qué reglas tiene la cuenta?","palabras_clave":["reglas","condiciones","puedo cambiar","compartir","contraseña"],"respuesta":"Prohibido usar en más dispositivos de los permitidos. Prohibido modificar correo, contraseña o facturación. Prohibido compartir, revender o transferir el acceso. Uso exclusivo del perfil asignado, sin excepciones. Incumplir estas reglas anula la garantía sin reembolso.","pendiente_configurar":false}],"promociones":[{"id":"primera_compra","codigo":"DCTECH2026","descripcion":"10% OFF en la primera compra con el código DCTECH2026 (se verifica que sea la primera compra del WhatsApp al validar el pago).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"renovacion","descripcion":"10% de descuento al renovar (recordatorio 3 días antes del vencimiento).","porcentaje":10,"activa":true,"pendiente_configurar":false},{"id":"cupon_segunda_compra","descripcion":"10% de descuento en la segunda compra con el cupón de fidelidad (DC-XXXXXX) que se envía por WhatsApp.","porcentaje":10,"activa":true,"pendiente_configurar":false}],"reglas_uso":["Prohibido usar en más dispositivos de los permitidos.","Prohibido modificar correo, contraseña o facturación.","Prohibido compartir, revender o transferir el acceso.","Uso exclusivo del perfil asignado, sin excepciones.","Incumplir estas reglas anula la garantía sin reembolso."],"flujo_digital":["VENTA DIGITAL (sin pasar a un asesor): 1) confirma producto, opción y total (aplica DCTECH2026 solo si es la primera compra); 2) ofrécele pagar por aquí o en la web (ver \"CÓMO PAGA\"); si es por aquí, muestra los métodos activos y da los datos del que elija; 3) pide el comprobante: captura con número de referencia, o el hash (TXID) si pagó en cripto.","Cuando el cliente envía el comprobante: confirma que lo recibiste y que, al validarlo, su pedido sale en máximo 15 minutos dentro del horario. Nunca digas que el pago está aprobado: lo valida el equipo.","Si pregunta por su pedido ya pagado: dile que el equipo lo está preparando con el proveedor y que los accesos le llegan por este chat apenas estén listos. Si pasaron más de 15 minutos en horario, escala a un asesor.","Las cuentas, perfiles, seriales y códigos los envía el sistema por este chat al validar el pago. Tú nunca escribes credenciales ni inventas accesos.","COMBOS: cuando el cliente quiera 2 o más plataformas, cotiza con la marca [COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} en una línea aparte: el sistema la reemplaza por el desglose exacto (precios del catálogo y descuento vigente). Vuelve a usarla cada vez que menciones el total del combo. Si pide 1 sola plataforma y hay regla de combo, puedes contarle cuánto ahorraría agregando otra (sin presionar).","PAGO DE UN COMBO EN CRIPTO: escribe [MONTO_CRIPTO cop=COMBO moneda=<MONEDA> red=<RED>] en la MISMA respuesta que la marca [COMBO]; el sistema usa el total del combo. En un combo NO uses la marca [PEDIDO_DIGITAL].","PEDIDO COMBO: cuando el cliente CONFIRME el combo, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_COMBO] {\"items\":[{\"producto\":\"<nombre exacto>\",\"variante\":\"<opción exacta>\"}, ...]} con las mismas plataformas que cotizaste. Una sola vez por combo; el cliente no ve esa línea. Si una plataforma no está disponible, el equipo le ofrece cambio o reembolso de esa parte: no prometas nada distinto.","SOPORTE DIGITAL: si algo no funciona, primero da los pasos de las FAQ de soporte (inicio de sesión, límite de pantallas, hogar de Netflix, perfil con PIN, activación) y termina con una pregunta de seguimiento. Escala solo si después de esos pasos el problema sigue, o cuando la FAQ lo indique en \"accion\".","HOGAR DE NETFLIX y PERFIL OCUPADO: tú no tienes el correo de la cuenta ni puedes cambiar perfiles. Cuando el cliente confirme que ya envió la solicitud de hogar, o que siguen ocupando su perfil, escala a un asesor de inmediato con el producto y su número de pedido si lo tiene."],"escalamiento":{"disparadores":["El cliente pide hablar con una persona (asesor, humano, persona, agente).","Reclamo de garantía o cuenta que sigue sin funcionar DESPUÉS de dar los pasos de soporte de las FAQ.","Problemas de pago: pago doble, monto distinto, comprobante rechazado o reembolso.","Pedido pagado sin entregar después de 15 minutos dentro del horario.","Cliente molesto, insultos o amenaza de reclamo.","Servicios a medida, alquiler, compras al por mayor o cotizaciones.","La pregunta no está en las FAQ ni en el catálogo, o llevas 2 respuestas sin resolver."],"acciones_n8n":["Pausar el bot en ese chat (no responder automáticamente hasta que el asesor lo libere).","Avisar al WhatsApp del negocio con: número del cliente, pedido (si lo hay), motivo y último mensaje.","Responder al cliente con la plantilla \"escalar_asesor\"."],"palabras_clave":["asesor","humano","persona","agente","reclamo","reembolso","devolucion","estafa","no me llego"]},"plantillas":{"botones":[{"id":"comprar","texto":"Comprar ahora"},{"id":"estado","texto":"Consultar estado"},{"id":"soporte","texto":"Solicitar soporte"}],"comprar_ahora":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Valor: {precio}\n¿Me indican los datos para realizar el pago?","pedido_tienda":"Hola DC Tecnology, quiero comprar:\n• Producto: {producto}\n• Opción: {variante}\n• Cantidad: {cantidad}\n• Precio unitario: {precio_unitario}\n• Cupón: {cupon} (-{porcentaje}%)\n• Total a pagar: {total}\nAcepté los términos de uso. ¿Me indican los datos para realizar el pago?","agendar_servicio":"Hola DC Tecnology, quiero agendar un servicio:\n• Servicio: {servicio}\n• Opción: {opcion}\n• Fecha preferida: {fecha}\n• Franja: {franja}\n• Valor estimado: {estimado}\n• Detalle: {detalle}\n¿Me confirman disponibilidad?","consultar_estado":"Hola, quiero consultar el estado de mi pedido #{pedido}.\nTambién puedo verlo aquí: https://dctecnology.xyz/portal.html?codigo={pedido}","solicitar_soporte":"Hola, requiero soporte sobre mi pedido #{pedido} ({producto}).","reclamar_garantia":"Hola, equipo de soporte DC Tecnology.\nQuiero reclamar la garantía de mi compra:\n• ID de compra: #{id_compra}\n• Pedido: #{pedido}\n• Producto: {producto}\n• Cuenta/serial terminado en: {serial_final}\n• Garantía vigente hasta: {fecha_vencimiento}\nDescribo la falla a continuación:","satisfaccion_24h":"👋 *¿Cómo vas con {producto}?* · ⚡ *DC TECNOLOGY*\n\nQueremos que todo funcione al 100 %.\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.","renovacion_3d":"⏰ *Tu {producto} vence pronto* · ⚡ *DC TECNOLOGY*\n\nRenuévalo hoy con *10% de descuento* y sigue sin interrupciones.\n🎟️ Tu cupón: *{cupon}*\n\nResponde *RENOVAR* y te ayudo en un minuto.","cupon_fidelidad":"🎁 *Un regalo por tu compra* · ⚡ *DC TECNOLOGY*\n\nGracias por confiar en nosotros con {producto}.\n🎟️ Tu cupón para la próxima compra: *{cupon}*\n\nEscríbenos cuando quieras usarlo.","pedido_proveedor":"Hola, adjunto pedido #{pedido}: {producto} x{cantidad}. Favor confirmar recepción.","pago_recibido":"✅ *Pago confirmado* · ⚡ *DC TECNOLOGY*\n\nRecibimos tu pago y ya estamos preparando tu pedido.\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n💳 Pagaste con: {metodo}\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.)\n\n🔎 Síguelo aquí: https://dctecnology.xyz/portal.html?codigo={codigo}\n\nGracias por comprar con nosotros 🙌","entrega_confirmada":"🎉 *¡Pedido entregado!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n🛡️ Garantía: *{garantia_dias} días*, hasta el {garantia_hasta}\n\n🔐 Tus accesos llegan *solo por este chat oficial* y quedan guardados en Mis pedidos.\n📌 Para no perder la garantía: no cambies correo ni contraseña y usa solo tu perfil.\n\n🔎 Tu pedido y garantía: https://dctecnology.xyz/portal.html?codigo={codigo}\n¿Algo no funciona? Responde *SOPORTE* 🛠️","solicitud_resena":"⭐ *¿Cómo te fue con {producto}?* · ⚡ *DC TECNOLOGY*\n\nYa pasó un día desde tu entrega y queremos saber si todo funciona al 100 %.\n\n👉 Califícanos en 30 segundos (reseña de compra verificada):\nhttps://dctecnology.xyz/portal.html?codigo={codigo}#resena\n_Solo te pide los últimos 4 dígitos de tu WhatsApp._\n\n¿Algo no va bien? Responde *SOPORTE* y lo resolvemos.\n_Si no quieres recibir estos mensajes, responde *NO*._","codigo_acceso":"🔐 *Tu código de acceso* · ⚡ *DC TECNOLOGY*\n\n*{codigo}*\n\nEscríbelo en dctecnology.xyz para ver tus pedidos y accesos.\n⏱️ Vence en *5 minutos*.\n\n⚠️ No lo compartas: nadie de DC TECNOLOGY te lo va a pedir.\n_Si no lo pediste, ignora este mensaje._","orden_validada":"✅ *Pago validado* · ⚡ *DC TECNOLOGY*\n\nTu orden *{codigo}* por *${total}* quedó confirmada y ya está en proceso.\n⏱️ Entrega: máximo *15 minutos* (lunes a sábado, 8:00 a.m. a 8:00 p.m.)\n\n🔎 Síguela en Mis pedidos: dctecnology.xyz/cliente.html#cuenta","orden_rechazada":"⚠️ *No pudimos validar tu pago* · ⚡ *DC TECNOLOGY*\n\n📦 Orden: *{codigo}*\n📝 Motivo: {motivo}\n\nSube otro comprobante en Mis pedidos (dctecnology.xyz/cliente.html#cuenta) o respóndeme por aquí y te ayudo.","reporte_resuelto":"🛠️ *Tu reporte fue atendido* · ⚡ *DC TECNOLOGY*\n\n🛒 Producto: {producto}\n✅ Solución: {nota}\n\n¿Sigue fallando? Responde *SOPORTE* y lo revisamos de nuevo.","admin_comprobante":"🧾 *Comprobante nuevo en la web*\nOrden: *{codigo}* · ${total} · {metodo}\nCliente: +{cliente}\nReferencia: {referencia}\nValídalo en el panel → Pagos & Agente Bot → Comprobantes web.","admin_falla":"🛠️ *Falla reportada en Mis pedidos*\nReporte #{reporte} · Cliente: +{cliente}\nProducto: {producto}\nProblema: {problema}\nEn garantía: {garantia}\nAtiéndelo y ciérralo en el panel (Reportes de falla).","escalar_asesor":"🙋 *Te comunico con un asesor* · ⚡ *DC TECNOLOGY*\n\nUna persona del equipo te responde por este mismo chat en horario de atención (lunes a sábado, 8:00 a.m. a 8:00 p.m.).\nYa tenemos tu pedido *#{pedido}* a la mano.","entrega_credenciales":"🔐 *¡Tus accesos están listos!* · ⚡ *DC TECNOLOGY*\n\n📦 Pedido: *#{pedido}*\n🛒 Producto: {producto}\n\n👤 Usuario / correo: ```{usuario}```\n🔑 Clave: ```{clave}```\n🙋 Perfil: ```{perfil}```\n🔢 PIN: ```{pin}```\n\n📌 Para no perder la garantía: no cambies correo ni contraseña, usa solo tu perfil y no compartas el acceso.\n\n¿Algo no funciona? Responde *SOPORTE* 🛠️"},"notificaciones":{"plantilla_por_tipo":{"PAGO_RECIBIDO":"pago_recibido","ENTREGA_CONFIRMADA":"entrega_confirmada","SOLICITUD_RESENA":"solicitud_resena","OTP":"codigo_acceso","ORDEN_VALIDADA":"orden_validada","ORDEN_RECHAZADA":"orden_rechazada","REPORTE_RESUELTO":"reporte_resuelto","ADMIN_COMPROBANTE":"admin_comprobante","ADMIN_FALLA":"admin_falla"}},"menu":{"garantia_dias":30,"principal":{"saludo":"¡Hola{nombre}! 👋 Te saluda *DC TECNOLOGY*","lema":"Streaming, licencias, pines y recargas con entrega por este chat ⚡","titulo":"📋 *Menú DC TECNOLOGY*","pregunta":"*¿En qué te ayudo?* Responde con un número:","opciones":[{"id":"catalogo","texto":"Catálogo y precios"},{"id":"comprar","texto":"Cómo comprar"},{"id":"pedidos","texto":"Mis pedidos y accesos"},{"id":"soporte","texto":"Soporte y garantía"},{"id":"pagos","texto":"Formas de pago"},{"id":"asesor","texto":"Hablar con una persona"}],"pie":"O escríbeme lo que buscas, por ejemplo: _Netflix_ 🍿"},"categorias":[{"tipos":["streaming"],"titulo":"Streaming","emoji":"🎬"},{"tipos":["licencias"],"titulo":"Licencias y apps","emoji":"💻"},{"tipos":["pines"],"titulo":"Pines y tarjetas regalo","emoji":"🎟️"},{"tipos":["recargas"],"titulo":"Recargas","emoji":"📱"},{"tipos":["tecnologia"],"titulo":"Tecnología y accesorios","emoji":"⌚"},{"tipos":["servicios","alquiler"],"titulo":"Servicios técnicos y alquiler","emoji":"🛠️"}],"soporte":[{"titulo":"No puedo iniciar sesión","faq":"soporte_inicio_sesion","emoji":"🔐"},{"titulo":"Dice \"Demasiados dispositivos\" o pantalla en uso","faq":"soporte_pantallas","emoji":"📺"},{"titulo":"Netflix pide \"Actualizar hogar\"","faq":"soporte_hogar_netflix","emoji":"🏠"},{"titulo":"Cambiaron mi perfil o le pusieron PIN","faq":"soporte_perfil_pin","emoji":"🙋"},{"titulo":"Activar una licencia o serial","faq":"activacion_licencias","emoji":"🔑"},{"titulo":"Otro problema o garantía","faq":null,"emoji":"📝"}],"comprar":["🛒 *Cómo comprar*","","*Por este chat*","1. Dime qué producto y plan quieres.","2. Te confirmo el total y eliges cómo pagar.","3. Me envías la captura del comprobante 📸","","*En la web:* dctecnology.xyz → agrega al carrito → \"Pagar y subir el comprobante aquí\".","","✅ Validamos tu pago y tus accesos llegan por este chat en máximo *15 minutos* (Lunes a sábado, 8:00 a.m. – 8:00 p.m).","🎁 ¿Primera compra? Usa el cupón *DCTECH2026* (10%)."],"pedidos":["📦 *Mis pedidos y accesos*","","Entra a 👉 https://dctecnology.xyz/cliente.html#cuenta","1. Escribe tu número de WhatsApp.","2. Te llega un código por este chat.","3. Listo: ves tus pedidos, tus accesos y tu garantía, y puedes reportar una falla.","","¿Pagaste y aún no te llega? Escríbeme tu número de pedido y te ayudo."],"pagos":{"titulo":"💳 *Formas de pago*","pasos":["*Así pagas*","1. Te confirmo el total de tu pedido.","2. Eliges el medio y te paso sus datos.","3. Me envías la captura del comprobante 📸","","O paga en la web y sube el comprobante allá: dctecnology.xyz"],"sin_metodos":"Hoy el medio de pago te lo confirma una persona: escribe *asesor* y te atendemos."},"compra_web":["🌐 *Compra en la web*","","1. Abre 👉 {url}","2. Elige tu opción y toca *Aceptar y agregar al carrito*.","3. Abre el carrito 🛒 y toca *Pagar y subir el comprobante aquí*.","","Te avisamos por este chat apenas validemos tu pago ✅"],"otro_problema":["📝 *Cuéntame qué pasa*","","En un solo mensaje: qué producto es, qué te aparece y tu número de pedido si lo tienes. Si tienes una captura, envíala con una frase."],"textos":{"catalogo":"🛍️ *Catálogo DC TECNOLOGY*","elige_categoria":"Elige una categoría:","elige_producto":"Responde con el número para ver planes y precios.","elige_opcion_digital":"Responde con el número de la opción que quieres y te digo cómo pagar.","elige_opcion_fisico":"Responde con el número de la opción y una persona coordina contigo el envío o la cita.","comprar_pie":"¿Qué producto quieres? Escríbelo o responde *1* para ver el catálogo.","tu_pedido":"🛒 *Tu pedido*","como_pagar":"*¿Cómo quieres pagar?* Responde con el número:","pagar_web":"En la web (carrito y comprobante allá)","pagar_cripto":"💠 ¿Pagas con cripto? Escribe *cripto*.","combo":"🧩 ¿Agregas otra plataforma? Con el combo tienes descuento: escríbeme cuál.","captura":"📸 Cuando pagues, envíame aquí la *captura del comprobante*.","volver_opciones":"0️⃣ Volver a las opciones","volver_pago":"0️⃣ Elegir otro medio de pago","soporte":"🛠️ *Soporte y garantía*","elige_problema":"¿Qué te pasa? Responde con el número:","volver_menu":"0️⃣ Menú principal","volver_catalogo":"0️⃣ Volver al catálogo","volver_lista":"0️⃣ Volver a la lista","volver_soporte":"0️⃣ Volver a soporte","web":"🌐 También en dctecnology.xyz","ver_web":"🌐 Míralo en la web:","invalida":"⚠️ Esa opción no está en la lista. Responde con uno de estos números:","sigue":"¿Sigue igual? Escribe *asesor* y una persona te ayuda."}},"catalogo":[{"id":"reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados","nombre":"Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados.html","variantes":[{"nombre":"Unidad Completa","precio":180000}]},{"id":"diademas-inalambricas-cr-8-con-luces-r9s7x","nombre":"Diademas Inalámbricas CR-8 con Luces LED","tipo":"tecnologia","url":"https://dctecnology.xyz/p/diademas-inalambricas-cr-8-con-luces-r9s7x.html","variantes":[{"nombre":"Unidad Completa","precio":100000}]},{"id":"diademas-gamer-a3s-alambrico","nombre":"Diademas Gamer A3S Alámbrico","tipo":"tecnologia","url":"https://dctecnology.xyz/p/diademas-gamer-a3s-alambrico.html","variantes":[{"nombre":"Unidad Gamer","precio":80000}]},{"id":"reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable.html","variantes":[{"nombre":"Acero Inoxidable","precio":140000}]},{"id":"powerbank-portatil-recargable-20-000-mah","nombre":"Powerbank Portátil Recargable 20.000 mAh","tipo":"tecnologia","url":"https://dctecnology.xyz/p/powerbank-portatil-recargable-20-000-mah.html","variantes":[{"nombre":"Carga Rápida 20.000 mAh","precio":120000}]},{"id":"auriculares-inalambricos-de-gancho-sp16","nombre":"Auriculares Inalámbricos de Gancho SP16","tipo":"tecnologia","url":"https://dctecnology.xyz/p/auriculares-inalambricos-de-gancho-sp16.html","variantes":[{"nombre":"Unidad Estándar","precio":75000}]},{"id":"auriculares-inalambricos-m19-con-powerbank","nombre":"Auriculares Inalámbricos M19 (Con Powerbank)","tipo":"tecnologia","url":"https://dctecnology.xyz/p/auriculares-inalambricos-m19-con-powerbank.html","variantes":[{"nombre":"Powerbank M19","precio":40000}]},{"id":"reloj-inteligente-smartwatch-h19","nombre":"Reloj Inteligente Smartwatch H19 en Acero Inoxidable","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-h19.html","variantes":[{"nombre":"Acero Inoxidable","precio":100000}]},{"id":"auriculares-inalambricos-m25-con-powerbank","nombre":"Auriculares Inalámbricos M25 (Con Powerbank)","tipo":"tecnologia","url":"https://dctecnology.xyz/p/auriculares-inalambricos-m25-con-powerbank.html","variantes":[{"nombre":"Gamer M25","precio":40000}]},{"id":"reloj-inteligente-smartwatch-z90","nombre":"Reloj Inteligente Smartwatch Z90","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-z90.html","variantes":[{"nombre":"Deportivo Z90","precio":80000}]},{"id":"reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable","nombre":"Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable.html","variantes":[{"nombre":"Acero de Lujo P13","precio":130000}]},{"id":"reloj-inteligente-smartwatch-m9","nombre":"Reloj Inteligente Smartwatch M9","tipo":"tecnologia","url":"https://dctecnology.xyz/p/reloj-inteligente-smartwatch-m9.html","variantes":[{"nombre":"Edición M9","precio":120000}]},{"id":"netflix","nombre":"Netflix Premium 4K","tipo":"streaming","url":"https://dctecnology.xyz/p/netflix.html","variantes":[{"nombre":"Pantalla Colombia 26 días","precio":15000},{"nombre":"Pantalla Internacional 26 días","precio":17000}]},{"id":"prime-video","nombre":"Prime Video Ultra HD","tipo":"streaming","url":"https://dctecnology.xyz/p/prime-video.html","variantes":[{"nombre":"Pantalla (1 Dispositivo)","precio":10000},{"nombre":"Cuenta Completa (6 Dispositivos)","precio":20000}]},{"id":"disney-plus","nombre":"Disney Plus Premium","tipo":"streaming","url":"https://dctecnology.xyz/p/disney-plus.html","variantes":[{"nombre":"Pantalla Premium","precio":15000}]},{"id":"hbo-max","nombre":"Max (HBO)","tipo":"streaming","url":"https://dctecnology.xyz/p/hbo-max.html","variantes":[{"nombre":"Pantalla Estándar 1 Mes","precio":8000},{"nombre":"Pantalla Platino 1 Mes","precio":12000},{"nombre":"Cuenta Completa Estándar 1 Mes","precio":18000},{"nombre":"Cuenta Completa Platino 1 Mes","precio":25000}]},{"id":"crunchyroll","nombre":"Crunchyroll Mega Fan","tipo":"streaming","url":"https://dctecnology.xyz/p/crunchyroll.html","variantes":[{"nombre":"Perfil Mega Fan 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":19000}]},{"id":"vix-premium","nombre":"Vix Premium","tipo":"streaming","url":"https://dctecnology.xyz/p/vix-premium.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":8000},{"nombre":"Cuenta Completa 1 Mes","precio":15000}]},{"id":"paramount-plus","nombre":"Paramount Plus","tipo":"streaming","url":"https://dctecnology.xyz/p/paramount-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":20000}]},{"id":"universal-plus","nombre":"Universal Plus","tipo":"streaming","url":"https://dctecnology.xyz/p/universal-plus.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":20000}]},{"id":"viki-rakuten","nombre":"Viki Rakuten Pass","tipo":"streaming","url":"https://dctecnology.xyz/p/viki-rakuten.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":10000}]},{"id":"apple-tv","nombre":"Apple TV Plus","tipo":"streaming","url":"https://dctecnology.xyz/p/apple-tv.html","variantes":[{"nombre":"Perfil 1 Mes","precio":12000},{"nombre":"Cuenta Completa 1 Mes","precio":24000}]},{"id":"mubi","nombre":"Mubi Cinema","tipo":"streaming","url":"https://dctecnology.xyz/p/mubi.html","variantes":[{"nombre":"Perfil 1 Mes","precio":10000},{"nombre":"Cuenta Completa 1 Mes","precio":22000}]},{"id":"iptv-smarters","nombre":"IPTV Smarters","tipo":"streaming","url":"https://dctecnology.xyz/p/iptv-smarters.html","variantes":[{"nombre":"Pantalla 1 Mes","precio":13000},{"nombre":"Cuenta Completa 1 Mes","precio":23000},{"nombre":"Cuenta Completa 2 Meses","precio":35000},{"nombre":"Cuenta Completa 3 Meses","precio":55000},{"nombre":"Cuenta Completa 6 Meses","precio":80000},{"nombre":"Cuenta Completa 12 Meses","precio":150000}]},{"id":"capcut-pro","nombre":"CapCut Pro Edición","tipo":"licencias","url":"https://dctecnology.xyz/p/capcut-pro.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":28000}]},{"id":"canva-pro","nombre":"Canva Pro","tipo":"licencias","url":"https://dctecnology.xyz/p/canva-pro.html","variantes":[{"nombre":"Acceso 1 Mes","precio":10000},{"nombre":"Acceso 1 Año Completo","precio":40000}]},{"id":"duolingo-super","nombre":"Duolingo Super","tipo":"licencias","url":"https://dctecnology.xyz/p/duolingo-super.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":10000}]},{"id":"mcafee-antivirus","nombre":"McAfee Antivirus Total Protection","tipo":"licencias","url":"https://dctecnology.xyz/p/mcafee-antivirus.html","variantes":[{"nombre":"Licencia 1 Año (1 PC)","precio":45000},{"nombre":"Licencia 1 Año (5 PCs)","precio":130000}]},{"id":"office-365","nombre":"Office 365 Personal / Familiar","tipo":"licencias","url":"https://dctecnology.xyz/p/office-365.html","variantes":[{"nombre":"Licencia 1 Año (1 Equipo)","precio":45000},{"nombre":"Licencia 1 Año (5 Equipos)","precio":80000}]},{"id":"office-2016-2019-2021-2024-pro-plus","nombre":"Office Pro Plus Vitalicio","tipo":"licencias","url":"https://dctecnology.xyz/p/office-2016-2019-2021-2024-pro-plus.html","variantes":[{"nombre":"Office 2016 Pro Plus","precio":70000},{"nombre":"Office 2019 Pro Plus","precio":80000},{"nombre":"Office 2021 Pro Plus","precio":90000},{"nombre":"Office 2024 Pro Plus","precio":100000}]},{"id":"windows-10-y-11-pro-y-home","nombre":"Windows 10 y 11 Pro / Home","tipo":"licencias","url":"https://dctecnology.xyz/p/windows-10-y-11-pro-y-home.html","variantes":[{"nombre":"Windows 10 Pro Licencia","precio":70000},{"nombre":"Windows 11 Pro Licencia","precio":80000}]},{"id":"gemini-ia-pro","nombre":"Gemini IA Pro","tipo":"licencias","url":"https://dctecnology.xyz/p/gemini-ia-pro.html","variantes":[{"nombre":"Suscripción 1 Mes","precio":28000}]},{"id":"pin-virtual-disney-plus-1tpu5","nombre":"PIN Virtual Disney Plus","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-disney-plus-1tpu5.html","variantes":[{"nombre":"PIN de $25.900","precio":25900},{"nombre":"PIN de $36.900","precio":36900},{"nombre":"PIN de $54.900","precio":54900}]},{"id":"pin-virtual-netflix","nombre":"PIN Virtual Netflix Colombia","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-netflix.html","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $35.000","precio":35000},{"nombre":"PIN de $40.000","precio":40000},{"nombre":"PIN de $50.000","precio":50000}]},{"id":"pin-virtual-directv-go","nombre":"PIN Virtual Directv Go","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-directv-go.html","variantes":[{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $79.900","precio":79900},{"nombre":"PIN de $102.900","precio":102900},{"nombre":"PIN de $110.000","precio":110000}]},{"id":"pin-virtual-win-play","nombre":"PIN Virtual Win Play","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-win-play.html","variantes":[{"nombre":"PIN 1 Mes ($39.900)","precio":39900}]},{"id":"pin-virtual-vix","nombre":"PIN Virtual Vix","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-vix.html","variantes":[{"nombre":"PIN de $22.900","precio":22900}]},{"id":"pin-virtual-deezer","nombre":"PIN Virtual Deezer","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-deezer.html","variantes":[{"nombre":"PIN de $19.500","precio":19500}]},{"id":"pin-google-play","nombre":"PIN Virtual Google Play","tipo":"pines","url":"https://dctecnology.xyz/p/pin-google-play.html","variantes":[{"nombre":"PIN de $10.000","precio":10000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $50.000","precio":50000}]},{"id":"pin-virtual-roblox","nombre":"PIN Virtual Roblox","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-roblox.html","variantes":[{"nombre":"PIN de $25.000","precio":25000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"id":"pin-virtual-razer-gold","nombre":"PIN Virtual Razer Gold","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-razer-gold.html","variantes":[{"nombre":"PIN de $39.000","precio":39000},{"nombre":"PIN de $64.000","precio":64000},{"nombre":"PIN de $113.000","precio":113000}]},{"id":"pin-virtual-imvu","nombre":"PIN Virtual IMVU","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-imvu.html","variantes":[{"nombre":"PIN de $24.000","precio":24000},{"nombre":"PIN de $48.000","precio":48000}]},{"id":"pin-virtual-mcafee","nombre":"PIN Virtual McAfee","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-mcafee.html","variantes":[{"nombre":"PIN de $105.900","precio":105900},{"nombre":"PIN de $159.900","precio":159900},{"nombre":"PIN de $189.900","precio":189900}]},{"id":"pin-virtual-uber","nombre":"PIN Virtual Uber","tipo":"pines","url":"https://dctecnology.xyz/p/pin-virtual-uber.html","variantes":[{"nombre":"PIN de $20.000","precio":20000},{"nombre":"PIN de $30.000","precio":30000},{"nombre":"PIN de $50.000","precio":50000},{"nombre":"PIN de $100.000","precio":100000}]},{"id":"directv-prepago-4s7gd","nombre":"DirecTV Prepago Recarga Directa","tipo":"recargas","url":"https://dctecnology.xyz/p/directv-prepago-4s7gd.html","variantes":[{"nombre":"Saldo $12.000","precio":12000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $40.000","precio":40000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $70.000","precio":70000}]},{"id":"free-fire-diamantes-vwx2s","nombre":"Free Fire Diamantes Directo","tipo":"recargas","url":"https://dctecnology.xyz/p/free-fire-diamantes-vwx2s.html","variantes":[{"nombre":"100 Diamantes ($4.200)","precio":4200},{"nombre":"310 Diamantes ($12.000)","precio":12000},{"nombre":"520 Diamantes ($19.600)","precio":19600},{"nombre":"1060 Diamantes ($38.600)","precio":38600},{"nombre":"2180 Diamantes ($76.800)","precio":76800}]},{"id":"recargas-claro","nombre":"Recargas Móvil Claro","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-claro.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"recargas-movistar","nombre":"Recargas Móvil Movistar","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-movistar.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"recargas-tigo","nombre":"Recargas Móvil Tigo","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-tigo.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"recargas-etb","nombre":"Recargas Móvil ETB","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-etb.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000}]},{"id":"recargas-movil-exito","nombre":"Recargas Móvil Éxito","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-movil-exito.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $60.000","precio":60000}]},{"id":"recargas-wom","nombre":"Recargas Móvil Wom","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-wom.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000},{"nombre":"Saldo $60.000","precio":60000}]},{"id":"recargas-virgin-mobile","nombre":"Recargas Virgin Mobile","tipo":"recargas","url":"https://dctecnology.xyz/p/recargas-virgin-mobile.html","variantes":[{"nombre":"Saldo $5.000","precio":5000},{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000}]},{"id":"recarga-rushbet","nombre":"Recarga Rushbet Apuestas","tipo":"recargas","url":"https://dctecnology.xyz/p/recarga-rushbet.html","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"recarga-bwin-7t6cc","nombre":"Recarga Bwin Apuestas","tipo":"recargas","url":"https://dctecnology.xyz/p/recarga-bwin-7t6cc.html","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"recarga-betsson","nombre":"Recarga Betsson Apuestas","tipo":"recargas","url":"https://dctecnology.xyz/p/recarga-betsson.html","variantes":[{"nombre":"Saldo $10.000","precio":10000},{"nombre":"Saldo $20.000","precio":20000},{"nombre":"Saldo $30.000","precio":30000},{"nombre":"Saldo $50.000","precio":50000}]},{"id":"servicio-mantenimiento-computadores","nombre":"Mantenimiento Preventivo y Correctivo de Equipos","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-mantenimiento-computadores.html","variantes":[{"nombre":"Preventivo Software + Limpieza","precio":50000},{"nombre":"Correctivo + Cambio Térmico","precio":90000}]},{"id":"servicio-instalacion-so-licenciamiento","nombre":"Instalación de Sistema Operativo y Licenciamiento","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-instalacion-so-licenciamiento.html","variantes":[{"nombre":"Windows 10/11 Pro + Office + Software Base","precio":60000}]},{"id":"servicio-alquiler-equipos-computo","nombre":"Alquiler de Laptops y Equipos de Cómputo","tipo":"alquiler","url":"https://dctecnology.xyz/p/servicio-alquiler-equipos-computo.html","variantes":[{"nombre":"Plan 1 Mes (Pago Total)","precio":160000},{"nombre":"Plan 6 Meses ($150.000/mes) - Pago Total","precio":900000},{"nombre":"Plan 1 Año ($140.000/mes) - Pago Total","precio":1680000}]},{"id":"servicio-asesorias-tutorias","nombre":"Asesoría Técnica y Tutoría Personalizada","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-asesorias-tutorias.html","variantes":[{"nombre":"Sesión de Asesoría / Tutoría (1 Hora)","precio":40000}]},{"id":"servicio-desarrollo-web-automatizaciones","nombre":"Desarrollo de Catálogos Web y Automatizaciones IA","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-desarrollo-web-automatizaciones.html","variantes":[{"nombre":"Proyecto a Medida (Requiere Asesoría)","precio":0}]},{"id":"servicio-reparacion-repuestos","nombre":"Reparación de Computadores y Venta de Repuestos","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-reparacion-repuestos.html","variantes":[{"nombre":"Diagnóstico y Reparación (Requiere Cotización)","precio":0},{"nombre":"Repuestos para Computador (Requiere Cotización)","precio":0}]},{"id":"servicio-automatizaciones-negocios","nombre":"Automatizaciones para Negocios: Dashboards, Inventarios y Macros","tipo":"servicios","url":"https://dctecnology.xyz/p/servicio-automatizaciones-negocios.html","variantes":[{"nombre":"Dashboards e Inventarios (Requiere Asesoría)","precio":0},{"nombre":"Sistema para Bares o Supermercados (Requiere Asesoría)","precio":0},{"nombre":"Automatización de Macros (Requiere Asesoría)","precio":0}]},{"id":"er-cargador-con-cable-original-yookie-20w-rapido-2","nombre":"Cargador con Cable Original Yookie 20W Rapido","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-con-cable-original-yookie-20w-rapido-2.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":22400}]},{"id":"er-power-bank-20000-mah-display-4-cables-3","nombre":"Power Bank 20.000 mAh Display / 4 Cables","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-20000-mah-display-4-cables-3.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":47400}]},{"id":"er-anc-airpods-pantalla-tactil-5","nombre":"ANC Audífonos Inalámbricos Pantalla Tactil","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-anc-airpods-pantalla-tactil-5.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":53200}]},{"id":"er-lamparas-usb-led-07-6","nombre":"Lamparas USB LED-07","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lamparas-usb-led-07-6.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":8700}]},{"id":"er-cargador-iphone-lightning-original-yookie-kl02-7","nombre":"Cargador Iphone Lightning Original Yookie KL02","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-iphone-lightning-original-yookie-kl02-7.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":23100}]},{"id":"er-smart-wacht-gus-16-10","nombre":"Smart Wacht GUS-16","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-wacht-gus-16-10.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-game-retro-400-juegos-2-jugadores-16","nombre":"Game Retro 400 Juegos (2) Jugadores","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-game-retro-400-juegos-2-jugadores-16.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":40500}]},{"id":"er-power-bank-inalambrico-iphone-grande-10-000mah-18","nombre":"Power Bank Inalambrico Iphone Grande 10. 000mAh","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-inalambrico-iphone-grande-10-000mah-18.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37800}]},{"id":"er-mouse-gamer-3200-dpi-20","nombre":"Mouse Gamer 3200 Dpi","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-gamer-3200-dpi-20.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37100}]},{"id":"er-bafle-koleer-original-21","nombre":"Bafle Koleer Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-bafle-koleer-original-21.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37100}]},{"id":"er-lampara-usb-led-18-22","nombre":"Lampara USB LED-18","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lampara-usb-led-18-22.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":2300}]},{"id":"er-cable-type-c-a-lightning-20w-29","nombre":"Cable Type-c a Lightning 20W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cable-type-c-a-lightning-20w-29.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":7300}]},{"id":"er-power-bank-30000-mah-sin-cable-30","nombre":"Power Bank 30.000 mAh sin Cable","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-30000-mah-sin-cable-30.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":98000}]},{"id":"er-reloj-inteligente-audifonos-39","nombre":"Reloj Inteligente + Audifonos","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-reloj-inteligente-audifonos-39.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-airpods-generacion-6-53","nombre":"Audífonos Inalámbricos Generacion 6","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-generacion-6-53.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":57400}]},{"id":"er-set-de-labubu-54","nombre":"Set de Labubu","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-set-de-labubu-54.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37800}]},{"id":"er-diadema-bluetooh-b31-56","nombre":"Diadema Bluetooh B31","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diadema-bluetooh-b31-56.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":49000}]},{"id":"er-set-de-stitch-57","nombre":"Set de Stitch","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-set-de-stitch-57.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":34900}]},{"id":"er-airpods-bluetooh-es21-59","nombre":"Audífonos Inalámbricos Bluetooh ES21","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-bluetooh-es21-59.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37800}]},{"id":"er-power-bank-30000-mah-original-potente-60","nombre":"Power Bank 30.000 mAh Original Potente","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-30000-mah-original-potente-60.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":125900}]},{"id":"er-mouse-m29-dpi-1600-61","nombre":"Mouse M29 Dpi 1600","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-m29-dpi-1600-61.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":12200}]},{"id":"er-mouse-m30-depi-1600-62","nombre":"Mouse M30 Depi 1600","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-m30-depi-1600-62.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":14000}]},{"id":"er-mouse-inalambrico-hp-w10-63","nombre":"Mouse Inalambrico Hp W10","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-inalambrico-hp-w10-63.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":21700}]},{"id":"er-combo-teclado-inalambrico-64","nombre":"Combo Teclado Inalámbrico","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-combo-teclado-inalambrico-64.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":42000}]},{"id":"er-soporte-para-moto-65","nombre":"Soporte para Moto","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-para-moto-65.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":18500}]},{"id":"er-parlante-karaoke-con-microfono-67","nombre":"Parlante Karaoke con Microfono","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-karaoke-con-microfono-67.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":25900}]},{"id":"er-bombillo-parlante-led-rgb-69","nombre":"Bombillo Parlante LED RGB","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-bombillo-parlante-led-rgb-69.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":17500}]},{"id":"er-diademas-bass-inalambricas-eb620-81","nombre":"Diademas Bass Inalambricas EB620","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-bass-inalambricas-eb620-81.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":66500}]},{"id":"er-diademas-inalambricas-eb610-82","nombre":"Diademas Inalambricas EB610","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-inalambricas-eb610-82.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":63000}]},{"id":"er-airpods-anc-enc-yw08-83","nombre":"Audífonos Inalámbricos ANC Enc YW08","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-anc-enc-yw08-83.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":79600}]},{"id":"er-airpods-manos-libres-tws-xg23-84","nombre":"Audífonos Inalámbricos Manos Libres TWS XG23","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-manos-libres-tws-xg23-84.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":67900}]},{"id":"er-porta-celular-x1-unidad-85","nombre":"Porta Celular X1 Unidad","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-porta-celular-x1-unidad-85.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":3500}]},{"id":"er-gafas-inteligentes-inalambricas-xg89-89","nombre":"Gafas Inteligentes Inalambricas XG89","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-gafas-inteligentes-inalambricas-xg89-89.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":58800}]},{"id":"er-lapiz-tactil-universal-91","nombre":"Lapiz Tactil Universal","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lapiz-tactil-universal-91.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":32900}]},{"id":"er-aibimy-original-my212-waterproof-92","nombre":"Aibimy Original MY212 Waterproof","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-aibimy-original-my212-waterproof-92.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":69300}]},{"id":"er-original-cable-usb-a-tipo-c-30w-94","nombre":"Original Cable USB a Tipo C / 30W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-cable-usb-a-tipo-c-30w-94.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":4200}]},{"id":"er-original-cable-tipo-c-a-tipo-c-60w-carga-rapida-95","nombre":"Original Cable Tipo C a Tipo C 60W Carga Rapida","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-cable-tipo-c-a-tipo-c-60w-carga-rapida-95.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":11000}]},{"id":"er-gafas-bluetooh-recargable-98","nombre":"Gafas Bluetooh Recargable","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-gafas-bluetooh-recargable-98.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":33600}]},{"id":"er-teclado-tv-original-99","nombre":"Teclado TV Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-teclado-tv-original-99.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":23700}]},{"id":"er-parlante-okop-kp-539-100","nombre":"Parlante Okop KP-539","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-okop-kp-539-100.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51100}]},{"id":"er-aibimy-my262bt-original-ipx6-101","nombre":"Aibimy MY262BT Original IPX6","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-aibimy-my262bt-original-ipx6-101.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":105700}]},{"id":"er-smart-watch-original-pro-a4-102","nombre":"Smart Watch Original Pro A4","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-original-pro-a4-102.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51800}]},{"id":"er-smart-watch-10pro-original-103","nombre":"Smart Watch 10PRO Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-10pro-original-103.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":36400}]},{"id":"er-airpods-originales-tws-mms-107","nombre":"Audífonos Inalámbricos TWS M&m's","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-originales-tws-mms-107.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":39500}]},{"id":"er-microfono-de-solapa-108","nombre":"Microfono de Solapa","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-microfono-de-solapa-108.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":18200}]},{"id":"er-kit-de-limpieza-7-en-1-109","nombre":"Kit de Limpieza 7 en 1","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-kit-de-limpieza-7-en-1-109.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":11900}]},{"id":"er-parlante-bluetooh-rgb-110","nombre":"Parlante Bluetooh RGB","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-bluetooh-rgb-110.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":28700}]},{"id":"er-original-sh-30-g-tide-mobulaa-speeaker-box-111","nombre":"Original SH-30 G-tide Mobulaa Speeaker Box","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-sh-30-g-tide-mobulaa-speeaker-box-111.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":120400}]},{"id":"er-lampara-decorativa-astronauta-a1-112","nombre":"Lampara Decorativa Astronauta A1","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lampara-decorativa-astronauta-a1-112.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":19500}]},{"id":"er-mouse-ergonomico-inalambrico-115","nombre":"Mouse Ergonomico Inalambrico","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-ergonomico-inalambrico-115.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-cargador-de-coche-rapido-original-pc17-118","nombre":"Cargador de Coche Rapido Original PC17","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-de-coche-rapido-original-pc17-118.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":13100}]},{"id":"er-cargador-pro-ultra-rapido-carro-pc19-original-119","nombre":"Cargador Pro Ultra Rapido Carro PC19 Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-pro-ultra-rapido-carro-pc19-original-119.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":18600}]},{"id":"er-airpods-edicion-especial-codabury-original-120","nombre":"Audífonos Inalámbricos Edicion Especial Codabury","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-edicion-especial-codabury-original-120.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":54500}]},{"id":"er-airpods-tws-original-es45-121","nombre":"Audífonos Inalámbricos TWS ES45","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-tws-original-es45-121.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":40300}]},{"id":"er-airpods-original-es48-122","nombre":"Audífonos Inalámbricos ES48","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-original-es48-122.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":49000}]},{"id":"er-mouse-original-inalambrico-pro-124","nombre":"Mouse Original Inalambrico Pro","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-original-inalambrico-pro-124.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":37100}]},{"id":"er-diademas-de-alta-calidad-eb31-125","nombre":"Diademas de Alta Calidad EB31","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-de-alta-calidad-eb31-125.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":74100}]},{"id":"er-soporte-portatil-para-celular-o-tablet-moderno-126","nombre":"Soporte Portatil para Celular o Tablet Moderno","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-portatil-para-celular-o-tablet-moderno-126.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":12900}]},{"id":"er-diademas-pro-eb32-127","nombre":"Diademas Pro EB32","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-pro-eb32-127.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":74200}]},{"id":"er-cargador-inalambrico-ki90-128","nombre":"Cargador Inalambrico KI90","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-inalambrico-ki90-128.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":45100}]},{"id":"er-p9-ultra-combo-7-correas-129","nombre":"P9 Ultra Combo 7 Correas","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-p9-ultra-combo-7-correas-129.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":81100}]},{"id":"er-airpods-pea-pod-edicion-especial-130","nombre":"Audífonos Inalámbricos Pea Pod Edicion Especial","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-pea-pod-edicion-especial-130.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":66100}]},{"id":"er-airpods-pro-6-131","nombre":"Audífonos Inalámbricos Pro 6","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-pro-6-131.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27900}]},{"id":"er-palo-de-selfie-132","nombre":"Palo de Selfie","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-palo-de-selfie-132.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":12900}]},{"id":"er-soporte-giratorio-para-tablet-133","nombre":"Soporte Giratorio para Tablet","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-giratorio-para-tablet-133.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":20900}]},{"id":"er-original-smartwacht-wisme-airpods-7-correas-134","nombre":"Smartwacht Wisme + Audífonos Inalámbricos + 7 Correas","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-smartwacht-wisme-airpods-7-correas-134.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":83900}]},{"id":"er-holder-388a-136","nombre":"Holder 388A","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-holder-388a-136.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":5500}]},{"id":"er-soporte-microfono-de-solapa-137","nombre":"Soporte Microfono de Solapa","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-microfono-de-solapa-137.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27300}]},{"id":"er-aro-de-luz-rgb-26ctms-138","nombre":"Aro de Luz RGB 26CTMS","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-aro-de-luz-rgb-26ctms-138.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":44800}]},{"id":"er-microfono-de-solapa-entrada-aux-139","nombre":"Microfono de Solapa Entrada AUX","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-microfono-de-solapa-entrada-aux-139.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":9100}]},{"id":"er-tripode-estabilizador-celular-ay49t-140","nombre":"Tripode Estabilizador Celular AY49T","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-tripode-estabilizador-celular-ay49t-140.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51100}]},{"id":"er-mini-tripode-tp-009-141","nombre":"Mini Tripode TP-009","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mini-tripode-tp-009-141.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":8900}]},{"id":"er-soporte-astronauta-celular-142","nombre":"Soporte Astronauta Celular","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-astronauta-celular-142.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":16400}]},{"id":"er-airpods-originales-ep5-143","nombre":"Audífonos Inalámbricos EP5","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-originales-ep5-143.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":63600}]},{"id":"er-holders-s059-144","nombre":"Holders S059","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-holders-s059-144.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":3000}]},{"id":"er-blafle-smart-speaker-app-145","nombre":"Blafle Smart Speaker App","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-blafle-smart-speaker-app-145.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":50300}]},{"id":"er-auriculares-con-cable-md011-146","nombre":"Auriculares con Cable MD011","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-auriculares-con-cable-md011-146.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":3800}]},{"id":"er-auriculares-con-cable-ath-73-147","nombre":"Auriculares con Cable ATH-73","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-auriculares-con-cable-ath-73-147.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":1900}]},{"id":"er-holders-hold-326-148","nombre":"Holders HOLD-326","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-holders-hold-326-148.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":3300}]},{"id":"er-pad-mause-carga-inalambrica-151","nombre":"Pad Mause Carga Inalambrica","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-pad-mause-carga-inalambrica-151.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":53200}]},{"id":"er-airpods-pro-rs16-152","nombre":"Audífonos Inalámbricos Pro RS16","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-pro-rs16-152.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":63000}]},{"id":"er-combo-airpods-tws-k30-153","nombre":"Combo Audífonos Inalámbricos TWS-K30","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-combo-airpods-tws-k30-153.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51000}]},{"id":"er-airpods-kt30-154","nombre":"Audífonos Inalámbricos KT30","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-kt30-154.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":40100}]},{"id":"er-parlante-airpods-rgb-profesional-155","nombre":"Parlante + Audífonos Inalámbricos RGB Profesional","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-airpods-rgb-profesional-155.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":114800}]},{"id":"er-smart-watch-fit-economico-fd68-157","nombre":"Smart Watch Fit Economico FD68","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-fit-economico-fd68-157.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":19000}]},{"id":"er-microfono-condensador-sf-666-158","nombre":"Microfono Condensador SF-666","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-microfono-condensador-sf-666-158.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27300}]},{"id":"er-combo-x8-smart-wacht-162","nombre":"Combo X8 Smart Wacht","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-combo-x8-smart-wacht-162.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":69900}]},{"id":"er-audifonos-con-cable-tipo-c-tm-a-165","nombre":"Audifonos con Cable Tipo C Tm-a","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-con-cable-tipo-c-tm-a-165.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":7700}]},{"id":"er-mouse-inalambrico-dj-125-166","nombre":"Mouse Inalambrico DJ-125","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-inalambrico-dj-125-166.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27400}]},{"id":"er-smart-watch-gamebox-correa-pro-hot-5-167","nombre":"Smart Watch + Gamebox + Correa Pro HOT-5","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-gamebox-correa-pro-hot-5-167.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":89600}]},{"id":"er-lapiz-tactil-hx-22-169","nombre":"Lapiz Tactil HX-22","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lapiz-tactil-hx-22-169.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":3500}]},{"id":"er-holders-hold-ps-228-171","nombre":"Holders HOLD-PS/228","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-holders-hold-ps-228-171.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":9100}]},{"id":"er-kit-labubu-177","nombre":"Kit Labubu","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-kit-labubu-177.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":42000}]},{"id":"er-original-airpods-es53-181","nombre":"Audífonos Inalámbricos ES53","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-airpods-es53-181.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":46900}]},{"id":"er-airpdos-t11-labubu-2-182","nombre":"Airpdos T11 Labubu","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpdos-t11-labubu-2-182.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27300}]},{"id":"er-multipuerto-x4-usb-184","nombre":"Multipuerto X4 USB","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-multipuerto-x4-usb-184.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":5600}]},{"id":"er-airpods-abiertos-pro-v12-original-185","nombre":"Audífonos Inalámbricos Abiertos Pro V12","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-abiertos-pro-v12-original-185.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":97900}]},{"id":"er-buscador-inteligente-original-186","nombre":"Buscador Inteligente Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-buscador-inteligente-original-186.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-soporte-para-tablet-y-celular-hold-356-187","nombre":"Soporte para Tablet y Celular HOLD-356","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-para-tablet-y-celular-hold-356-187.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":34300}]},{"id":"er-base-para-portatil-y-tablet-holdpc-102-188","nombre":"Base para Portatil y Tablet HOLDPC-102","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-base-para-portatil-y-tablet-holdpc-102-188.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27900}]},{"id":"er-ym-300-rgb-led-ring-fill-light-189","nombre":"YM-300 RGB LED Ring Fill Light","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-ym-300-rgb-led-ring-fill-light-189.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":62900}]},{"id":"er-base-para-portatil-en-aluminio-hold-406-192","nombre":"Base para Portatil en Aluminio HOLD-406","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-base-para-portatil-en-aluminio-hold-406-192.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":20900}]},{"id":"er-funda-para-portatil-na-bag-105-193","nombre":"Funda para Portatil Na-bag 105","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-funda-para-portatil-na-bag-105-193.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":34900}]},{"id":"er-airpods-originales-es60-198","nombre":"Audífonos Inalámbricos ES60","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-originales-es60-198.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51600}]},{"id":"er-repetidor-de-wifi-wr03t-199","nombre":"Repetidor de Wifi WR03T","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-repetidor-de-wifi-wr03t-199.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":32800}]},{"id":"er-reloj-en-combo-x9-200","nombre":"Reloj en Combo X9","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-reloj-en-combo-x9-200.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":69900}]},{"id":"er-maquina-de-verificacion-de-billetes-201","nombre":"Maquina de Verificacion de Billetes","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-maquina-de-verificacion-de-billetes-201.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":27900}]},{"id":"er-audifonos-m10-202","nombre":"Audifonos M10","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-m10-202.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":17500}]},{"id":"er-parlante-portatil-mg2-203","nombre":"Parlante Portatil MG2","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-portatil-mg2-203.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":12600}]},{"id":"er-dama-smartwatch-me32-204","nombre":"Dama Smartwatch ME32","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-dama-smartwatch-me32-204.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":77000}]},{"id":"er-airpods-anc-jm19-traductores-208","nombre":"Audífonos Inalámbricos ANC-JM19 Traductores","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-anc-jm19-traductores-208.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":77000}]},{"id":"er-smart-watch-s11-kz-w42-209","nombre":"Smart Watch S11 KZ-W42","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-s11-kz-w42-209.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":50400}]},{"id":"er-smartwacht-serie-11-mini-213","nombre":"Smartwacht Serie 11 Mini","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smartwacht-serie-11-mini-213.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":48900}]},{"id":"er-original-mobulaa-iw12-mini-216","nombre":"Original Mobulaa IW12 Mini","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-mobulaa-iw12-mini-216.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":138600}]},{"id":"er-original-cargador-usb-a-tipo-c-yookie-ei32-217","nombre":"Original Cargador USB a Tipo C Yookie EI32","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-original-cargador-usb-a-tipo-c-yookie-ei32-217.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":20100}]},{"id":"er-smart-watch-big-3-218","nombre":"Smart Watch Big 3","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-big-3-218.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":48900}]},{"id":"er-smart-watch-zt-36s-plus-219","nombre":"Smart Watch ZT-36S Plus","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-zt-36s-plus-219.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":83900}]},{"id":"er-impresora-portatil-220","nombre":"Impresora Portatil","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-impresora-portatil-220.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-microfono-de-solapa-tipo-c-221","nombre":"Microfono de Solapa Tipo C","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-microfono-de-solapa-tipo-c-221.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":9100}]},{"id":"er-microfono-de-solapa-entrada-lightning-222","nombre":"Microfono de Solapa Entrada Lightning","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-microfono-de-solapa-entrada-lightning-222.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":9100}]},{"id":"er-parlante-bluetooth-alexa-15w-223","nombre":"Parlante Bluetooth Alexa 15W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-bluetooth-alexa-15w-223.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":64400}]},{"id":"er-ampliador-de-pantalla-celular-226","nombre":"Ampliador de Pantalla Celular","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-ampliador-de-pantalla-celular-226.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":13900}]},{"id":"er-smart-watch-audifonos-d200-ultra-229","nombre":"Smart Watch + Audifonos D200 Ultra","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-audifonos-d200-ultra-229.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-smart-watch-audifonos-i20-230","nombre":"Smart Watch + Audifonos I20","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-audifonos-i20-230.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":49000}]},{"id":"er-mini-proyector-led-yg-300-esquinas-cuadradas-231","nombre":"Mini Proyector LED Yg 300 - Esquinas Cuadradas","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mini-proyector-led-yg-300-esquinas-cuadradas-231.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":77000}]},{"id":"er-luz-led-potente-para-celular-corazon-238","nombre":"Luz LED Potente para Celular Corazon","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-luz-led-potente-para-celular-corazon-238.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":20900}]},{"id":"er-mouse-ergonomico-alambrico-239","nombre":"Mouse Ergonomico Alambrico","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-ergonomico-alambrico-239.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":26600}]},{"id":"er-audifonos-bluetooth-yx29-con-pantalla-tactil-244","nombre":"Audifonos Bluetooth YX29 con Pantalla Tactil","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-bluetooth-yx29-con-pantalla-tactil-244.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-kit-gamer-x4-articulos-245","nombre":"Kit Gamer X4 Articulos","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-kit-gamer-x4-articulos-245.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":97900}]},{"id":"er-tv-box-contra-marcado-247","nombre":"TV Box Contra Marcado","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-tv-box-contra-marcado-247.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":119000}]},{"id":"er-smart-watch-lg88-pro-248","nombre":"Smart Watch LG88 Pro","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-lg88-pro-248.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":82600}]},{"id":"er-smart-watch-s9-mini-amoled-249","nombre":"Smart Watch S9 Mini Amoled","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-s9-mini-amoled-249.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":68600}]},{"id":"er-smartwacht-ultra-combo-pro-253","nombre":"Smartwacht Ultra Combo Pro","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smartwacht-ultra-combo-pro-253.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":49000}]},{"id":"er-aro-de-luz-tik-tok-con-soporte-para-2-celulares-254","nombre":"Aro de Luz Tik Tok con Soporte para 2 Celulares","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-aro-de-luz-tik-tok-con-soporte-para-2-celulares-254.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":23100}]},{"id":"er-audifonos-tws-s510-con-pantalla-digital-256","nombre":"Audifonos TWS S510 con Pantalla Digital","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-tws-s510-con-pantalla-digital-256.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":18900}]},{"id":"er-kit-de-grabacion-para-celular-ay-49rgb-fino-258","nombre":"Kit de Grabacion para Celular AY-49RGB Fino","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-kit-de-grabacion-para-celular-ay-49rgb-fino-258.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":38500}]},{"id":"er-audifonos-inalambricos-con-pantalla-inteligente-anc-259","nombre":"Audifonos Inalambricos con Pantalla Inteligente ANC","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-inalambricos-con-pantalla-inteligente-anc-259.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":53200}]},{"id":"er-power-bank-magnetico-10000-mah-yo11-261","nombre":"Power Bank Magnetico 10.000 mAh YO11","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-magnetico-10000-mah-yo11-261.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":92400}]},{"id":"er-audifonos-ows-yks286-262","nombre":"Audifonos Ows YKS286","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-ows-yks286-262.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":68600}]},{"id":"er-airpods-originales-es57-263","nombre":"Audífonos Inalámbricos ES57","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-originales-es57-263.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":47600}]},{"id":"er-airpods-originales-es56-264","nombre":"Audífonos Inalámbricos ES56","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-airpods-originales-es56-264.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":51800}]},{"id":"er-cargador-superrapido-60w-ki275-265","nombre":"Cargador Superrapido 60W KI275","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cargador-superrapido-60w-ki275-265.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":81200}]},{"id":"er-pantalla-selfie-270","nombre":"Pantalla Selfie","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-pantalla-selfie-270.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":54600}]},{"id":"er-mini-luz-led-recargable-para-celular-3w-272","nombre":"Mini Luz LED Recargable para Celular 3W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mini-luz-led-recargable-para-celular-3w-272.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":6900}]},{"id":"er-soporte-celular-hold-371-273","nombre":"Soporte Celular HOLD-371","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-celular-hold-371-273.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":6600}]},{"id":"er-soporte-celular-hold-439-274","nombre":"Soporte Celular HOLD-439","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-celular-hold-439-274.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":6600}]},{"id":"er-mesa-auto-hold-372-275","nombre":"Mesa Auto HOLD-372","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mesa-auto-hold-372-275.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":26200}]},{"id":"er-parlante-kimiso-kms-295-277","nombre":"Parlante Kimiso KMS-295","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-kimiso-kms-295-277.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":50400}]},{"id":"er-teclado-gamer-278","nombre":"Teclado Gamer","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-teclado-gamer-278.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":50400}]},{"id":"er-parlante-portatil-ajustable-kms-299-279","nombre":"Parlante Portatil Ajustable KMS-299","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-portatil-ajustable-kms-299-279.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-parlante-portatil-original-kimiso-kms-374-283","nombre":"Parlante Portatil Original Kimiso KMS-374","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-portatil-original-kimiso-kms-374-283.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":189000}]},{"id":"er-parlante-portatil-original-kimiso-kms-323-284","nombre":"Parlante Portatil Original Kimiso KMS-323","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-portatil-original-kimiso-kms-323-284.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":123200}]},{"id":"er-parlante-portatil-original-kimiso-kms-325-max-285","nombre":"Parlante Portatil Original Kimiso KMS-325 Max","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-portatil-original-kimiso-kms-325-max-285.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":278600}]},{"id":"er-diademas-yookie-originales-eb37-286","nombre":"Diademas Yookie Originales EB37","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-yookie-originales-eb37-286.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":83900}]},{"id":"er-soporte-para-carro-hold-372-287","nombre":"Soporte para Carro HOLD-372","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-soporte-para-carro-hold-372-287.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":33200}]},{"id":"er-cable-tipo-c-trenzado-av-10728-ccr-293","nombre":"Cable Tipo C Trenzado AV-10728-CCR","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cable-tipo-c-trenzado-av-10728-ccr-293.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":6100}]},{"id":"er-diademas-pro-tuka-xh-648-295","nombre":"Diademas Pro Tuka XH-648","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-diademas-pro-tuka-xh-648-295.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-audifonos-de-conduccion-osea-298","nombre":"Audifonos de Conduccion Osea","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-audifonos-de-conduccion-osea-298.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":44700}]},{"id":"er-teclado-inalambrico-tactil-yookie-ye36-299","nombre":"Teclado Inalambrico Tactil Yookie YE36","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-teclado-inalambrico-tactil-yookie-ye36-299.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":83900}]},{"id":"er-teclado-inalambrico-portatil-ultrafino-300","nombre":"Teclado Inalambrico Portatil Ultrafino","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-teclado-inalambrico-portatil-ultrafino-300.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-power-bank-225w-yookie-original-301","nombre":"Power Bank 22.5W Yookie Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-power-bank-225w-yookie-original-301.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":81900}]},{"id":"er-cable-de-carga-rapida-y-datos-4-en-1-yookie-ec27-120w-303","nombre":"Cable de Carga Rapida y Datos 4 en 1 Yookie EC27 120W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cable-de-carga-rapida-y-datos-4-en-1-yookie-ec27-120w-303.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":17700}]},{"id":"er-cable-de-datos-y-carga-rapida-yookie-cb108-100w-304","nombre":"Cable de Datos y Carga Rapida Yookie CB108 100W","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-cable-de-datos-y-carga-rapida-yookie-cb108-100w-304.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":29000}]},{"id":"er-tv-stick-216-economico-h245-305","nombre":"TV Stick 2+16 Economico H245","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-tv-stick-216-economico-h245-305.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":77000}]},{"id":"er-parlante-bluetooth-con-luz-rgb-kts-2310-307","nombre":"Parlante Bluetooth con Luz RGB KTS-2310","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-parlante-bluetooth-con-luz-rgb-kts-2310-307.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":41900}]},{"id":"er-smart-watch-sii-pro-original-308","nombre":"Smart Watch Sii Pro Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-sii-pro-original-308.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":132300}]},{"id":"er-smart-watch-w33-original-309","nombre":"Smart Watch W33 Original","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-w33-original-309.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":139900}]},{"id":"er-lampara-proyectora-de-estrellas-star-master-310","nombre":"Lampara Proyectora de Estrellas Star Master","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-lampara-proyectora-de-estrellas-star-master-310.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":23100}]},{"id":"er-smart-watch-ace-180-312","nombre":"Smart Watch ACE-180","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-ace-180-312.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":48900}]},{"id":"er-smart-watch-ws-75-ultra-3-313","nombre":"Smart Watch WS-75 Ultra 3","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-ws-75-ultra-3-313.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":55900}]},{"id":"er-smart-watch-x10-pro-max-314","nombre":"Smart Watch X10 Pro Max","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-smart-watch-x10-pro-max-314.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":78400}]},{"id":"er-mouse-gamer-rgb-x6-316","nombre":"Mouse Gamer RGB X6","tipo":"tecnologia","url":"https://dctecnology.xyz/p/er-mouse-gamer-rgb-x6-316.html","sincronizado":true,"variantes":[{"nombre":"Unidad","precio":15400}]}]}).plantillas.entrega_credenciales).split('\n').map((linea) => {
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
