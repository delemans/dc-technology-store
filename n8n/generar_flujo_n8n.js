// n8n/generar_flujo_n8n.js — Genera n8n/flujo_bot_dctechnology.json (importable en n8n) desde
// bot-conocimiento.json, así el flujo nunca se desincroniza de las reglas, FAQ y plantillas.
//
//   node generar_bot_conocimiento.js && node n8n/generar_flujo_n8n.js
//
// El flujo tiene dos ramas independientes:
//   A) Bot de WhatsApp: Webhook de Evolution API → reglas (baja / asesor / sin texto) → Agente IA
//      (DeepSeek-V3 en SiliconFlow) con FAQ, catálogo y cuentas activas → respuesta por Evolution.
//   B) Posventa: cada minuto toma la cola notificaciones_whatsapp (supabase/wo-015.sql), envía uno a uno
//      con pausa aleatoria de 8 a 15 s y confirma cada envío con marcar_notificacion.
// Los nodos Code se escriben aquí como funciones normales (se prueban en Node) y se serializan.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(__dirname, 'flujo_bot_dctechnology.json');
const kb = JSON.parse(fs.readFileSync(path.join(RAIZ, 'bot-conocimiento.json'), 'utf8'));
const WA = require(path.join(RAIZ, 'plantillas-whatsapp.js'));

const MODELO = 'deepseek-ai/DeepSeek-V3';
// Cuenta internacional de SiliconFlow (la clave de .cn no sirve en .com ni al revés): ver herramientas/configurar-ia.mjs
const SILICONFLOW_URL = 'https://api.siliconflow.com/v1';
const SUPABASE_URL = 'https://vyqcizwfmjlflncdwzve.supabase.co';
const HORAS_PAUSA_ASESOR = 12;
// Triangulación: cuánto espera cada paso antes de cerrar el pedido y avisarte
const HORAS_COTIZACION = 2;
const HORAS_PAGO = 12;
const HORAS_CREDENCIALES = 6;
const HORAS_APROBACION = 12;

// Respaldo embebido: si la web no responde, el bot sigue funcionando con esta copia
const kbEmbebida = {
    version: kb.version,
    prompt_sistema: kb.prompt_sistema,
    faq: kb.faq.filter((f) => !f.pendiente_configurar && f.respuesta),
    promociones: kb.promociones.filter((p) => p.activa && !p.pendiente_configurar),
    reglas_uso: kb.reglas_uso,
    flujo_digital: kb.flujo_digital,
    escalamiento: kb.escalamiento,
    plantillas: kb.plantillas,
    notificaciones: { plantilla_por_tipo: kb.notificaciones.plantilla_por_tipo },
    menu: kb.menu,
    // Sin los ocultos (categorías del proveedor no activadas): el flujo queda liviano; "Leer Emprende Red" los toma del sitio en vivo
    catalogo: kb.catalogo.filter((p) => !p.oculto).map(({ id, nombre, tipo, url, variantes, sincronizado, oculto, existencias }) => ({ id, nombre, tipo, url, ...(sincronizado ? { sincronizado } : {}), ...(oculto ? { oculto } : {}), ...(Number.isFinite(existencias) ? { existencias } : {}), variantes: variantes.map(({ nombre: n, precio }) => ({ nombre: n, precio })) })),
};
// Nombre visible de cada tipo de método de pago (NEQUI → Nequi, LLAVE_BREB → Llave Bre-B) para el menú
const nombresPago = Object.fromEntries(WA.TIPOS_PAGO.map((t) => [t.tipo, t.nombre]));

// WO-035 · Compra en el portal del proveedor: nuestra variante → producto y plan en ANC (mismo precio).
// Fuente: herramientas/equivalencias-ancpagos.json + nombres de productos.json.
const ancMapa = (() => {
    const { _nota, ...eq } = JSON.parse(fs.readFileSync(path.join(RAIZ, 'herramientas', 'equivalencias-ancpagos.json'), 'utf8'));
    const productos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8'));
    return Object.entries(eq).flatMap(([id, e]) => {
        const p = productos.find((x) => x.id === id);
        if (!p) throw new Error(`equivalencias-ancpagos.json: no existe el producto ${id}`);
        return Object.entries(e.variantes).map(([variante, plan]) => {
            if (!p.variantes.some((v) => v.nombre === variante)) throw new Error(`equivalencias-ancpagos.json: ${id} no tiene la variante "${variante}"`);
            return { id, producto: p.nombre, variante, anc_producto: e.proveedor, anc_plan: plan };
        });
    });
})();

/* ==================== CÓDIGO DE LOS NODOS ==================== */
// Globales de n8n que usan: $, $input, $getWorkflowStaticData. __KB__ y __HORAS_PAUSA__ se inyectan al generar.

// Mismo comportamiento que PlantillasWA.rellenar (plantillas-whatsapp.js)
function utilidades() {
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
                '🔔 *Escalamiento a asesor*',
                `Cliente: +${msg.numero}${msg.nombre ? ` (${limpiar(msg.nombre)})` : ''}`,
                `Motivo: ${limpiar(motivo)}`,
                `Último mensaje: ${String(msg.texto ?? '').slice(0, 300)}`,
                `El bot queda en pausa ${__HORAS_PAUSA__} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
            ].join('\n') } });
        }
        return salida;
    };
    // Números de WhatsApp: solo dígitos y, si es un celular colombiano de 10 dígitos (3XXXXXXXXX), con el 57 adelante:
    // "312 513 2325" en Config bot no rompe tus avisos ni tus comandos #pago / #aprobar / #cancelar
    const soloDigitos = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return /^3\d{9}$/.test(d) ? `57${d}` : d; };
    const montoCripto = __MONTO_CRIPTO__;
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
}

// A1 · Normaliza el evento de Evolution API y decide la ruta (baja / asesor / sin_texto / comprobante / menu / ia)
function normalizarMensaje() {
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
    for (const [n, t] of Object.entries(memoria.pausados)) if (ahora - t > __HORAS_PAUSA__ * 3600e3) delete memoria.pausados[n];
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
    // Habeas data (Ley 1581): "DATOS" o "borrar mis datos" → pasa a ti con el plazo legal (lo anuncia legal/privacidad.html)
    else if (/^(datos|mis datos|datos personales|borrar mis datos|eliminar mis datos|borren mis datos|eliminen mis datos)$/.test(limpio)) {
        Object.assign(salida, { ruta: 'asesor', motivo: 'Solicitud sobre datos personales (Ley 1581): consulta → responder en máx. 10 días hábiles; reclamo/borrado → 15 días hábiles' });
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
}

// A2 · Ruta "asesor": pausa el bot y avisa
function rutaAsesor() {
    const cfg = $('Config bot').first().json;
    const msg = $input.first().json;
    const kb = __KB__;
    return escalar(msg, msg.motivo || 'El cliente pidió un asesor o reportó un problema', cfg, kb.plantillas);
}

// A3 · Rutas sin IA: baja confirmada, audios y mensajes sin texto. Si quien escribe no viene de una conversación de
// compra (foto, audio o archivo de un conocido), no se le contesta: te llega un aviso para que respondas tú.
function respuestaFija() {
    const cfg = $('Config bot').first().json;
    const msg = $('Normalizar mensaje').first().json;
    if (msg.aviso) {
        const memoria = $getWorkflowStaticData('global');
        memoria.avisosMedia = memoria.avisosMedia || {};
        const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '').replace(/^(3\d{9})$/, '57$1');
        if (!aviso || Date.now() - (memoria.avisosMedia[msg.numero] || 0) < 30 * 60e3) return []; // 1 aviso por chat cada 30 min
        memoria.avisosMedia[msg.numero] = Date.now();
        const que = { imagen: '📷 una imagen', documento: '📄 un documento', audio: '🎙️ un audio' }[msg.aviso] ?? '📎 un archivo';
        return [{ json: { numero: aviso, texto: [
            `🔔 *Te enviaron ${que}*`,
            `De: +${msg.numero}${msg.nombre ? ` (${String(msg.nombre).replace(/[*_~`]/g, '').slice(0, 40)})` : ''}`,
            msg.texto ? `Texto: «${msg.texto.slice(0, 200)}»` : null,
            msg.descripcion ? `🤖 Lo que se ve: ${String(msg.descripcion).slice(0, 300)}` : null,
            '',
            'No le respondí porque no venía de una compra con el bot.',
            ['imagen', 'documento'].includes(msg.aviso) ? 'Si es un comprobante, valídalo; si es otro tema, contéstale tú.' : 'Revísalo y contéstale tú.',
        ].filter((l) => l !== null).join('\n') } }];
    }
    const textos = {
        baja: 'Listo ✅ No te enviaremos más solicitudes de reseña. Seguirás recibiendo solo los avisos de tus pedidos.',
        audio: '🎙️ Aún no puedo escuchar audios. ¿Me lo escribes?\nO responde *menú* y eliges una opción.',
        sin_texto: 'Por ahora solo leo mensajes de texto 🙏 Escríbeme tu consulta o responde *menú* para ver las opciones.',
    };
    return [{ json: { numero: msg.numero, texto: textos[msg.ruta === 'baja' ? 'baja' : msg.tipo === 'audio' ? 'audio' : 'sin_texto'] } }];
}

// A3b · Comprobante recibido: confirma al cliente y avisa al administrador (el pago lo valida una persona)
function comprobanteRecibido() {
    const cfg = $('Config bot').first().json;
    const msg = $input.first().json;
    const salida = [{ json: { numero: msg.numero, texto: [
        msg.txid ? '🔗 *Recibimos tu hash* · ⚡ *DC TECNOLOGY*' : '🧾 *Recibimos tu comprobante* · ⚡ *DC TECNOLOGY*',
        '',
        `${msg.txid ? 'Estamos verificando tu transacción.' : 'Estamos revisando tu pago.'} Te escribo por este chat apenas quede confirmado ✅`,
        '',
        'No necesitas enviarlo de nuevo 🙌',
    ].join('\n') } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '').replace(/^(3\d{9})$/, '57$1');
    // Pedido que el cliente confirmó por chat en las últimas 48 h (lo guarda "Crear triangulación" / "Crear combo")
    const guardada = ($getWorkflowStaticData('global').ordenesChat ?? {})[msg.numero];
    const orden = guardada && Date.now() - guardada.at < 48 * 3600e3 ? guardada : null;
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.txid ? `🔗 *Pago cripto · TXID*\n${msg.txid}` : '🧾 *Comprobante recibido*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${String(msg.nombre).slice(0, 40)})` : ''}`,
            msg.texto ? `Nota del cliente: ${msg.texto.slice(0, 200)}` : null,
            ...(orden ? ['', `🛒 Pedido *#${orden.referencia}*: ${orden.producto}${orden.variante ? ` – ${orden.variante}` : ''}`, '', '*Paso a paso:*',
                `1️⃣ Revisa en tu Nequi/Daviplata que llegaron *${cop(orden.precio)}*${orden.cupon ? ` (con cupón ${orden.cupon}: confirma que sea su primera compra)` : ''}.`,
                `2️⃣ Si llegó responde *#ok ${orden.referencia}* · si no: *#no ${orden.referencia} motivo*`,
                (String($('Config bot').first().json.entrega_cuentas ?? 'manual').trim().toLowerCase() === 'automatica' ? `3️⃣ Te digo qué comprar en ANC (${orden.plan ?? orden.producto}) y, cuando ANC envíe la cuenta, se la entrego al cliente.` : `3️⃣ Consigue la cuenta (${orden.plan ?? orden.producto}) y entrégala con *#entregar ${orden.referencia} correo / clave*.`)]
                : ['Valídalo en el panel → Pagos & Bot.']),
        ].filter(Boolean).join('\n') } });
    }
    return salida;
}

// A4a · Menú con números (WO-040): responde sin IA (rápido, exacto y sin costo) con el catálogo, los métodos de pago y
// los combos EN VIVO. Si el cliente eligió la opción de un producto, sigue la IA como si lo hubiera escrito
// ("Quiero Netflix Premium 4K – Pantalla Colombia 26 días") para confirmar el total y cobrar.
function responderMenu() {
    const msg = $('Normalizar mensaje').first().json;
    // Texto corto que no es del menú ("netflix", "mouse gamer"): se busca en el catálogo sin IA (ver más abajo)
    const buscable = msg.ruta === 'ia' && msg.texto && String(msg.texto).trim().split(/\s+/).length <= 5;
    if ((msg.ruta !== 'menu' || !msg.menu) && !buscable) return [{ json: { via: 'ia', numero: msg.numero } }];
    const enVivo = baseViva($('Base de conocimiento').first().json);
    const kbBase = enVivo && Array.isArray(enVivo.catalogo) && enVivo.menu ? enVivo : __KB__;
    const kb = { ...kbBase, catalogo: aplicarPrecios(kbBase.catalogo, preciosVivos()) }; // precios de la base, sin agotados
    const M = kb.menu;
    const T = M.textos;
    const memoria = $getWorkflowStaticData('global');
    for (const k of ['menu', 'conversacion', 'soporte', 'esperandoPago']) memoria[k] = memoria[k] || {};
    const ahora = Date.now();
    const numero = msg.numero;
    const DIGITALES = ['streaming', 'licencias', 'pines', 'recargas'];
    const POR_PAGINA = 10;
    const NOMBRES_PAGO = __NOMBRES_PAGO__;
    const ETIQUETA_PAGO = { NEQUI: 'Número', DAVIPLATA: 'Número', LLAVE_BREB: 'Llave', BANCOLOMBIA: 'Cuenta', TRANSFERENCIA: 'Cuenta', PSE: 'Enlace', ENLACE: 'Enlace', PAYPAL: 'PayPal' };
    const nombreMetodo = (x) => (x.categoria === 'cripto' ? `${x.moneda ?? x.tipo} (${x.red})` : NOMBRES_PAGO[x.tipo] ?? x.banco_alias ?? x.tipo);
    const tecla = (i) => (i < 9 ? `${i + 1}️⃣` : `*${i + 1}.*`);
    const precio = (v) => (Number(v) > 0 ? cop(v) : 'a cotizar');
    const catalogo = kb.catalogo ?? [];
    const categorias = M.categorias.map((c) => ({ ...c, productos: catalogo.filter((p) => c.tipos.includes(p.tipo)) })).filter((c) => c.productos.length);
    const metodos = $('Metodos de pago').all().map((i) => i.json).filter((x) => x && (x.numero_cuenta || x.url_pago));
    // Medios locales agrupados por nombre: dos llaves Bre-B son una sola opción que muestra las dos llaves
    const grupos = [];
    for (const x of metodos.filter((y) => y.categoria !== 'cripto')) {
        const g = grupos.find((y) => y.nombre === nombreMetodo(x));
        if (g) g.cuentas.push(x);
        else grupos.push({ nombre: nombreMetodo(x), cuentas: [x] });
    }
    const reglas = $('Reglas combo').all().map((i) => i.json)
        .map((r) => ({ min: Number(r.min_plataformas), pct: Number(r.descuento_pct) })).filter((r) => r.min >= 2 && r.pct > 0)
        .sort((a, b) => a.min - b.min);
    const lineaCombos = reglas.length
        ? `🧩 *Combos:* ${reglas.map((r, i) => `${r.min}${i === reglas.length - 1 ? ' o más' : ''} plataformas -${r.pct}%`).join(' · ')}`
        : null;
    const desde = (p) => {
        const precios = (p.variantes ?? []).map((v) => Number(v.precio)).filter((v) => v > 0);
        if (!precios.length) return 'a cotizar';
        return `${precios.length > 1 ? 'desde ' : ''}${cop(Math.min(...precios))}`;
    };
    const primerNombre = (() => {
        const n = String(msg.nombre ?? '').trim().split(/\s+/)[0] ?? '';
        return /^[A-Za-zÁÉÍÓÚÑÜáéíóúñü]{2,15}$/.test(n) ? n[0].toUpperCase() + n.slice(1).toLowerCase() : '';
    })();

    let pantallaBusqueda = null;
    const pantalla = (id) => {
        if (id === 'catalogo') {
            return { lineas: [T.catalogo, T.elige_categoria, '', ...categorias.map((c, i) => `${tecla(i)} ${c.emoji} ${c.titulo} · ${c.productos.length}`),
                ...(lineaCombos ? ['', lineaCombos] : []), '', T.volver_menu, T.web], opciones: categorias.map((c) => `cat:${c.tipos[0]}`), atras: 'principal' };
        }
        // Categoría en páginas de 10 (WhatsApp corta los mensajes muy largos): "cat:tecnologia:2"
        if (id.startsWith('cat:')) {
            const [, tipo, pag] = /^cat:([^:]+)(?::(\d+))?$/.exec(id) ?? [];
            const c = categorias.find((x) => x.tipos[0] === tipo);
            if (!c) return pantalla('catalogo');
            const total = Math.ceil(c.productos.length / POR_PAGINA);
            const n = Math.min(Math.max(Number(pag) || 1, 1), total);
            const lista = c.productos.slice((n - 1) * POR_PAGINA, n * POR_PAGINA);
            const hayMas = n < total;
            return { lineas: [`${c.emoji} *${c.titulo}*${total > 1 ? ` · página ${n} de ${total}` : ''}`, '',
                ...lista.map((p, j) => `*${j + 1}.* ${p.nombre} · ${desde(p)}`),
                ...(hayMas ? [`*${lista.length + 1}.* ➡️ Ver más productos`] : []), '',
                total > 1 ? `${T.elige_producto} También puedes escribir lo que buscas.` : T.elige_producto,
                n > 1 ? '0️⃣ Página anterior' : T.volver_catalogo],
            opciones: [...lista.map((p) => `prod:${p.id}`), ...(hayMas ? [`cat:${tipo}:${n + 1}`] : [])],
            atras: n > 1 ? `cat:${tipo}:${n - 1}` : 'catalogo' };
        }
        if (id.startsWith('prod:')) {
            const p = catalogo.find((x) => String(x.id) === id.slice(5));
            if (!p) return pantalla('catalogo');
            const c = categorias.find((x) => x.tipos.includes(p.tipo));
            return { lineas: [`${c ? c.emoji : '🛍️'} *${p.nombre}*`, '', ...(p.variantes ?? []).map((v, j) => `*${j + 1}.* ${v.nombre}: *${precio(v.precio)}*`), '',
                DIGITALES.includes(p.tipo) ? T.elige_opcion_digital : T.elige_opcion_fisico, p.url ? `${T.ver_web} ${p.url}` : null, T.volver_lista],
            opciones: (p.variantes ?? []).map((v, j) => `elegir:${p.id}:${j}`),
            atras: c ? `cat:${c.tipos[0]}:${Math.floor(c.productos.indexOf(p) / POR_PAGINA) + 1}` : 'catalogo' };
        }
        // Compra sin IA: resumen del pedido y medios de pago (los locales activos, agrupados por nombre) + la web
        if (id.startsWith('pedir:')) {
            const [, pid, j] = /^pedir:(.+):(\d+)$/.exec(id) ?? [];
            const p = catalogo.find((x) => String(x.id) === pid);
            const v = p?.variantes?.[Number(j)];
            if (!p || !v) return pantalla('catalogo');
            return { lineas: [T.tu_pedido, `${p.nombre} – ${v.nombre}`, `💰 Total: *${cop(v.precio)}*`, lineaCombos ? T.combo : null, '',
                T.como_pagar, ...grupos.map((g, k) => `${tecla(k)} ${g.nombre}`), `${tecla(grupos.length)} ${T.pagar_web}`,
                metodos.some((x) => x.categoria === 'cripto') ? T.pagar_cripto : null, '', T.volver_opciones],
            opciones: [...grupos.map((g, k) => `pagar:${p.id}:${j}:${k}`), `web:${p.id}`], atras: `prod:${p.id}` };
        }
        if (id.startsWith('pagar:')) {
            const [, pid, j, k] = /^pagar:(.+):(\d+):(\d+)$/.exec(id) ?? [];
            const p = catalogo.find((x) => String(x.id) === pid);
            const v = p?.variantes?.[Number(j)];
            const g = grupos[Number(k)];
            if (!p || !v) return pantalla('catalogo');
            if (!g) return pantalla(`pedir:${pid}:${j}`);
            memoria.esperandoPago[numero] = ahora; // la próxima foto o PDF que envíe es su comprobante
            return { lineas: [`💳 *Paga con ${g.nombre}*`, '',
                ...g.cuentas.map((x) => `${g.cuentas.length > 1 ? '• ' : ''}${ETIQUETA_PAGO[x.tipo] ?? 'Datos'}: *${x.numero_cuenta ?? ''}*${x.titular ? ` (${x.titular})` : ''}`),
                ...g.cuentas.filter((x) => x.url_pago).map((x) => `🔗 ${x.url_pago}`),
                ...g.cuentas.filter((x) => x.instrucciones).map((x) => `ℹ️ ${x.instrucciones}`),
                `💰 Valor: *${cop(v.precio)}*`, `🛒 Pedido: ${p.nombre} – ${v.nombre}`, '',
                T.captura, `⏱️ Al validarlo, tus accesos llegan por este chat en máximo *${__ENTREGA_MIN__} minutos* (${__HORARIO__}).`, '', T.volver_pago],
            opciones: [], atras: `pedir:${pid}:${j}`, pedido: { producto: p.nombre, variante: v.nombre, precio: v.precio } };
        }
        if (id.startsWith('web:')) {
            const p = catalogo.find((x) => String(x.id) === id.slice(4));
            const url = p ? `https://www.dctecnology.xyz/?producto=${encodeURIComponent(p.id)}` : 'https://www.dctecnology.xyz';
            return { lineas: [...M.compra_web.map((l) => l.replace('{url}', url)), '', T.volver_menu], opciones: [], atras: 'principal' };
        }
        if (id === 'soporte') {
            memoria.soporte[numero] = ahora;
            return { lineas: [T.soporte, T.elige_problema, '', ...M.soporte.map((s, i) => `${tecla(i)} ${s.titulo}`), '',
                `🛡️ Garantía: *${M.garantia_dias} días* desde la entrega, cumpliendo las reglas de uso.`, T.volver_menu], opciones: M.soporte.map((s, i) => `sop:${i}`), atras: 'principal' };
        }
        if (id.startsWith('sop:')) {
            const s = M.soporte[Number(id.slice(4))];
            if (!s) return pantalla('soporte');
            memoria.soporte[numero] = ahora;
            const faq = s.faq ? (kb.faq ?? []).find((f) => f.id === s.faq && f.respuesta && !f.pendiente_configurar) : null;
            if (!faq) return { lineas: [...M.otro_problema, '', T.volver_soporte], opciones: [], atras: 'soporte' };
            // Si la FAQ tiene un paso siguiente (hogar de Netflix, perfil con PIN), la IA lo continúa con "accion"
            return { lineas: [`${s.emoji} *${s.titulo}*`, '', faq.respuesta, ...(faq.accion ? [] : ['', T.sigue]), T.volver_soporte], opciones: [], atras: 'soporte', accion: faq.accion ?? null };
        }
        if (id === 'comprar') return { lineas: [...M.comprar, ...(lineaCombos ? [lineaCombos] : []), '', T.comprar_pie, T.volver_menu], opciones: ['catalogo'], atras: 'principal' };
        if (id === 'pedidos') return { lineas: [...M.pedidos, '', T.volver_menu], opciones: [], atras: 'principal' };
        if (id === 'pagos') {
            const locales = grupos.map((g) => g.nombre);
            const criptos = [...new Set(metodos.filter((x) => x.categoria === 'cripto').map(nombreMetodo))];
            return { lineas: [M.pagos.titulo, '', ...(metodos.length ? [
                locales.length ? `*Pagos locales:* ${locales.join(' · ')}` : null,
                criptos.length ? `*Cripto:* ${criptos.join(' · ')}` : null,
                '', ...M.pagos.pasos,
            ] : [M.pagos.sin_metodos]), '', T.volver_menu], opciones: [], atras: 'principal' };
        }
        if (id === 'buscar' && pantallaBusqueda) return pantallaBusqueda;
        // Menú principal
        return { lineas: [
            msg.menu?.saludo ? M.principal.saludo.replace('{nombre}', primerNombre ? `, ${primerNombre}` : '') : M.principal.titulo,
            msg.menu?.saludo ? M.principal.lema : null,
            '', M.principal.pregunta, ...M.principal.opciones.map((o, i) => `${tecla(i)} ${o.texto}`), '', M.principal.pie,
        ], opciones: M.principal.opciones.map((o) => o.id), atras: null };
    };

    // Búsqueda sin IA (WO-042): todas las palabras útiles del cliente deben estar en el nombre del producto. Si hubo
    // charla con la IA hace menos de 10 min, el texto es parte de esa charla ("disney" en medio de un combo) y no se busca.
    let destinoBusqueda = null;
    if (msg.ruta !== 'menu') {
        const VACIAS = new Set(['quiero', 'precio', 'precios', 'cuanto', 'cuesta', 'vale', 'valor', 'tienen', 'tiene', 'hay', 'venden',
            'busco', 'necesito', 'comprar', 'para', 'una', 'uno', 'unos', 'unas', 'los', 'las', 'del', 'con', 'por', 'favor', 'info',
            'informacion', 'sobre', 'hola', 'buenas', 'buenos', 'dias', 'tardes', 'noches', 'que', 'como', 'cual', 'disponible', 'producto']);
        const palabras = normalizar(msg.texto).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !VACIAS.has(w));
        const iaReciente = ahora - ((memoria.ia || {})[numero] || 0) < 10 * 60e3;
        const encontrados = palabras.length && !iaReciente ? catalogo.filter((p) => {
            const n = normalizar(`${p.nombre} ${p.marca ?? ''}`);
            return palabras.every((w) => n.includes(w) || (w.length > 4 && n.includes(w.replace(/(es|s)$/, ''))));
        }) : [];
        if (!encontrados.length) return [{ json: { via: 'ia', numero } }];
        if (encontrados.length === 1) destinoBusqueda = `prod:${encontrados[0].id}`;
        else {
            destinoBusqueda = 'buscar';
            const lista = encontrados.slice(0, 10);
            pantallaBusqueda = { lineas: [`🔎 *Encontré ${encontrados.length} opciones para «${String(msg.texto).trim().slice(0, 40)}»*`, '',
                ...lista.map((p, j) => `*${j + 1}.* ${p.nombre} · ${desde(p)}`), '',
                encontrados.length > 10 ? `Te muestro 10 de ${encontrados.length}: escribe más detalle para afinar.` : T.elige_producto,
                T.volver_menu], opciones: lista.map((p) => `prod:${p.id}`), atras: 'principal' };
        }
    }
    let ir = String(destinoBusqueda ?? msg.menu?.ir ?? 'principal');
    // Eligió una opción de un producto: si es digital con precio, sigue la compra por el menú; si es físico, un
    // servicio o "a cotizar", pasa a una persona que coordina el envío o la cita
    if (ir.startsWith('elegir:')) {
        const [, id, j] = /^elegir:(.+):(\d+)$/.exec(ir) ?? [];
        const p = catalogo.find((x) => String(x.id) === id);
        const v = p?.variantes?.[Number(j)];
        if (!p || !v) ir = 'catalogo';
        else if (DIGITALES.includes(p.tipo) && Number(v.precio) > 0) ir = `pedir:${id}:${j}`;
        else {
            if (memoria.menu[numero]) memoria.menu[numero].activo = false;
            const salida = escalar({ ...msg, texto: `Quiere comprar: ${p.nombre} – ${v.nombre}` },
                `Quiere comprar ${p.nombre} – ${v.nombre} (${precio(v.precio)}): coordinar ${['tecnologia', 'variedades'].includes(p.tipo) ? 'el envío' : 'la cita o la cotización'}`,
                $('Config bot').first().json, kb.plantillas);
            salida[0].json.texto = [`🙋 *Te comunico con un asesor* · ⚡ *DC TECNOLOGY*`, '', `Elegiste *${p.nombre} – ${v.nombre}* (${precio(v.precio)}).`,
                `Una persona del equipo te escribe por aquí para coordinar ${['tecnologia', 'variedades'].includes(p.tipo) ? 'el envío' : 'la cita'} (${__HORARIO__}).`].join('\n');
            return salida.map((i) => ({ json: { ...i.json, via: 'menu' } }));
        }
    }
    const invalida = ir.startsWith('invalida:');
    if (invalida) ir = ir.slice(9) || 'principal';
    const r = pantalla(ir);
    const texto = [...(invalida ? [T.invalida, ''] : []), ...r.lineas].filter((l) => l !== null && l !== undefined)
        .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    memoria.menu[numero] = { id: ir, opciones: r.opciones, atras: r.atras, t: ahora, activo: true, texto, accion: r.accion ?? null };
    memoria.conversacion[numero] = ahora;
    // "pedido" arranca la compra al proveedor ("Crear triangulación"), igual que el [PEDIDO_DIGITAL] de la IA
    return [{ json: { via: 'menu', numero, texto, ...(r.pedido ? { pedido: r.pedido } : {}) } }];
}

// A4 · Contexto del agente: base de conocimiento en vivo (o la embebida) + cuentas activas de Supabase
function armarContexto() {
    const msg = $('Normalizar mensaje').first().json;
    // Si eligió un producto en el menú, la IA recibe esa elección como si la hubiera escrito
    const texto = $('Responder menú').first().json.texto_ia || msg.texto;
    // Último mensaje del menú (30 min): la IA sabe qué vio el cliente ("la primera", "esa") y no se presenta de nuevo
    const estadoMenu = ($getWorkflowStaticData('global').menu || {})[msg.numero];
    const ultimoMenu = estadoMenu && Date.now() - estadoMenu.t < 30 * 60e3 ? estadoMenu : null;
    const enVivo = baseViva($('Base de conocimiento').first().json);
    const base0 = enVivo && enVivo.prompt_sistema && enVivo.plantillas ? enVivo : __KB__;
    const base = { ...base0, catalogo: aplicarPrecios(base0.catalogo, preciosVivos()) }; // la IA cotiza con los precios de la base
    // Catálogo para la IA, liviano (antes ~11.000 tokens por mensaje: lento y no cabe en las IA gratuitas): los digitales,
    // servicios y alquiler completos; de tecnología (180+ físicos) solo los que coinciden con lo que el cliente escribe
    // ahora o escribió antes en esta charla (máx. 12), más un resumen. El menú y la web siguen mostrando todo.
    const catalogoTodo = base.catalogo ?? [];
    const tecnologia = catalogoTodo.filter((p) => ['tecnologia', 'variedades'].includes(p.tipo));
    const VACIAS_IA = new Set(['quiero', 'precio', 'precios', 'cuanto', 'cuesta', 'vale', 'valor', 'tienen', 'tiene', 'hay', 'venden', 'busco', 'necesito',
        'comprar', 'para', 'una', 'uno', 'unos', 'unas', 'los', 'las', 'del', 'con', 'por', 'favor', 'hola', 'buenas', 'que', 'como', 'cual', 'este', 'ese', 'esa', 'esta',
        'disponible', 'producto', 'productos', 'original', 'originales', 'bueno', 'buena', 'mejor', 'algo', 'tambien', 'pero', 'muy', 'mas', 'son', 'sus', 'mis', 'tus']);
    const anteriores = ((($getWorkflowStaticData('global').chatsIa ?? {})[msg.numero]?.m) ?? []).filter((x) => x.role === 'user').slice(-3).map((x) => x.content);
    const palabrasIa = [...new Set([texto, ...anteriores, ultimoMenu?.texto ?? ''].join(' ').split(/\s+/)
        .map((w) => normalizar(w).replace(/[^a-z0-9]/g, '')).filter((w) => (w.length >= 3 || /\d/.test(w) && w.length >= 2) && !VACIAS_IA.has(w)))];
    // Un modelo con número (s9, x8, kms323) pesa más que una palabra suelta; "smartwatch" = "smart watch"
    const puntaje = (p) => {
        const n = normalizar(p.nombre), junto = n.replace(/[^a-z0-9]/g, ''), palabrasNombre = n.split(/[^a-z0-9]+/);
        return palabrasIa.reduce((s, w) => s + (/\d/.test(w) ? (palabrasNombre.includes(w) || (w.length >= 4 && junto.includes(w)) ? 3 : 0)
            : n.includes(w) || junto.includes(w) || (w.length > 4 && n.includes(w.replace(/(es|s)$/, ''))) ? 1 : 0), 0);
    };
    const tecnoIa = tecnologia.map((p) => [p, puntaje(p)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([p]) => p);
    // Por categoría y sin etiquetas (antes "Nombre [streaming]": la IA copiaba la etiqueta y el pedido no se reconocía).
    // Streaming y licencias siempre con precios; pines, recargas, servicios y alquiler solo con nombres, salvo que la
    // charla trate de ellos (así la consulta cabe en las IA gratuitas rápidas, como Groq)
    const charla = normalizar([texto, ...anteriores, ultimoMenu?.texto ?? ''].join(' '));
    const TEMAS = {
        pines: /\bpin|tarjeta|gift|google ?play|roblox|xbox|psn|playstation|steam|free ?fire|mcafee|datacredito|codigo/,
        recargas: /recarga|minutos|paquete|claro|movistar|tigo|wom|saldo|celular/,
        servicios: /servicio|mantenimiento|reparac|repuesto|instalac|formate|asesor|tutori|automatiza|dashboard|inventario|macro|software|desarrollo|pagina|web|sistema|pos\b|rifa|catalogo|computador|portatil/,
        alquiler: /alquil|rentar|renta|prestamo de equipo|portatil|computador/,
    };
    const TITULOS = { streaming: 'STREAMING', licencias: 'LICENCIAS Y APPS', pines: 'PINES Y TARJETAS', recargas: 'RECARGAS', servicios: 'SERVICIOS TÉCNICOS (a cotizar = lo coordina una persona)', alquiler: 'ALQUILER DE EQUIPOS' };
    const lineaProducto = (p) => `- ${p.nombre}: ${(p.variantes ?? []).map((v) => `${v.nombre} ${Number(v.precio) > 0 ? cop(v.precio) : 'a cotizar'}`).join('; ')}${Number(p.existencias) > 0 && Number(p.existencias) <= 5 ? ` (quedan ${p.existencias} unidades: no ofrezcas más de esas)` : ''}`;
    const bloquesCatalogo = Object.keys(TITULOS).flatMap((tipo) => {
        const items = catalogoTodo.filter((p) => p.tipo === tipo);
        if (!items.length) return [];
        const completo = tipo === 'streaming' || tipo === 'licencias' || TEMAS[tipo]?.test(charla) || items.some((p) => puntaje(p) > 0 && palabrasIa.some((w) => w.length >= 4 && normalizar(p.nombre).includes(w)));
        return [`${TITULOS[tipo]}:`, ...(completo ? items.map(lineaProducto) : [`- ${items.map((p) => p.nombre).join(', ')} (si pide uno, pregúntale cuál; el precio te llega en el siguiente mensaje)`])];
    });
    const catalogoIa = [...catalogoTodo.filter((p) => !['tecnologia', 'variedades'].includes(p.tipo)), ...tecnoIa];
    // Preguntas frecuentes: solo las 6 que más se relacionan con la charla (todas cuando no hay pistas)
    const faqUtiles = (base.faq ?? []).filter((f) => !f.pendiente_configurar && f.respuesta);
    const puntajeFaq = (f) => { const t = normalizar(`${f.pregunta} ${f.respuesta}`); return palabrasIa.filter((w) => w.length >= 4 && t.includes(w)).length; };
    const faqIa = palabrasIa.length ? faqUtiles.map((f, i) => [f, puntajeFaq(f), i]).sort((a, b) => b[1] - a[1] || a[2] - b[2]).slice(0, 6).map(([f]) => f) : faqUtiles.slice(0, 6);
    const cuentas = $('Metodos de pago').all().map((i) => i.json).filter((m) => m && (m.numero_cuenta || m.url_pago));
    const linea = (c) => {
        if (c.categoria !== 'cripto') {
            return `- ${c.banco_alias ?? c.tipo}: ${c.numero_cuenta ?? ''}${c.url_pago ? ` · enlace: ${c.url_pago}` : ''}${c.titular ? ` (titular: ${c.titular})` : ''}${c.instrucciones ? ` · ${c.instrucciones}` : ''}`;
        }
        const tasaVigente = montoCripto(1, c) !== null;
        return `- ${c.banco_alias ?? c.tipo}: ${c.moneda} SOLO por la red ${c.red} → ${c.red === 'BINANCE_PAY' ? 'Pay ID/correo' : 'dirección'}: ${c.numero_cuenta}${c.memo ? ` · MEMO OBLIGATORIO: ${c.memo}` : ''}${c.instrucciones ? ` · ${c.instrucciones}` : ''} · ${tasaVigente
            ? `tasa vigente: 1 ${c.moneda} = ${cop(c.tasa_cop)}`
            : 'SIN TASA VIGENTE: no cotices este método; ofrece un pago local o un asesor'}`;
    };
    // WO-029: reglas de combo en vivo (reglas_combo_publicas). Sin reglas = no se ofrece descuento por combo
    const reglas = $('Reglas combo').all().map((i) => i.json)
        .map((r) => ({ min: Number(r.min_plataformas), pct: Number(r.descuento_pct) })).filter((r) => r.min >= 2 && r.pct > 0)
        .sort((a, b) => a.min - b.min);
    const locales = cuentas.filter((c) => c.categoria !== 'cripto');
    const criptos = cuentas.filter((c) => c.categoria === 'cripto');
    const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'short' });

    const sistema = [
        base.prompt_sistema,
        '',
        `Fecha y hora en Colombia: ${ahora}.`,
        '',
        'MÉTODOS DE PAGO ACTIVOS (los únicos que puedes ofrecer; datos EXACTOS):',
        ...(cuentas.length ? [
            'Pagos locales y electrónicos:',
            // La IA no recibe números ni llaves: solo los nombres y la marca para pedir los datos del que elija el cliente
            ...(locales.length ? [...new Set(locales.map((c) => c.tipo))].map((t) => `- ${(__NOMBRES_PAGO__)[t] ?? t} → sus datos: [DATOS_PAGO ${t}]`) : ['- (ninguno activo)']),
            'Criptomonedas:',
            ...(criptos.length ? criptos.map(linea) : ['- (ninguna activa: no ofrezcas cripto)']),
        ] : ['- NO hay métodos activos: no compartas datos de pago; escala a un asesor.']),
        '',
        'DESCUENTO POR COMBO (plataformas DISTINTAS del catálogo digital en un mismo pedido; se aplica la regla con el mayor mínimo alcanzado):',
        ...(reglas.length
            ? [...reglas.map((r, i) => `- ${r.min}${i === reglas.length - 1 ? ' o más' : ''} plataformas: ${r.pct}% de descuento`),
                '- Cotiza SIEMPRE con la marca [COMBO] (nunca calcules tú). El cupón DCTECH2026 no se acumula con el combo.']
            : ['- NO hay descuento por combo activo: no lo ofrezcas.']),
        '',
        'PROMOCIONES ACTIVAS:',
        ...(base.promociones ?? []).filter((p) => p.activa && !p.pendiente_configurar).map((p) => `- ${p.descripcion}`),
        '',
        'PREGUNTAS FRECUENTES (usa estas respuestas):',
        ...faqIa.map((f) => `- ${f.pregunta} → ${f.respuesta}${f.accion ? ` (Después: ${f.accion})` : ''}`),
        '',
        'REGLAS DE USO DE LAS CUENTAS:',
        ...(base.reglas_uso ?? []).map((r) => `- ${r}`),
        '',
        'CATÁLOGO (precios en COP, solo estos; usa el nombre del producto tal cual, sin la categoría):',
        ...bloquesCatalogo,
        ...(tecnoIa.length ? ['TECNOLOGÍA (los que coinciden con lo que pide el cliente):', ...tecnoIa.map(lineaProducto)] : []),
        ...(tecnologia.length ? [`- TECNOLOGÍA en total: ${tecnologia.length} productos físicos (relojes inteligentes, audífonos, diademas, parlantes, power banks, cargadores y cables, soportes, mouse y teclados, luces y trípodes…).${tecnoIa.length ? ' Arriba están los que coinciden con lo que pide el cliente.' : ''} Si pide uno que no aparece arriba, NO inventes precio ni disponibilidad: pídele el modelo o envíalo al menú (opción 1 → Tecnología) o a la web.`] : []),
        '',
        'FORMATO: español de Colombia, máximo 6 líneas, *negrita* de WhatsApp solo para datos clave, sin títulos ni tablas.',
        ...(ultimoMenu ? ['', 'ÚLTIMO MENSAJE DEL MENÚ QUE VIO EL CLIENTE (la conversación ya empezó: no te presentes):', ultimoMenu.texto,
            ...(ultimoMenu.accion ? [`(Después: ${ultimoMenu.accion})`] : []), ''] : []),
        'DATOS QUE NO TIENES: si el cliente pregunta algo que no está escrito en el catálogo, las FAQ o las reglas (diferencias técnicas entre planes, región, compatibilidad, calidad, dispositivos), NO lo supongas ni lo deduzcas del nombre. Di solo lo que dice el nombre del plan y ofrece confirmarlo con un asesor (escribe *asesor*).',
        'DATOS DE PAGO LOCALES: tú no tienes números ni llaves. Si el cliente paga por aquí, primero pregúntale con cuál paga mostrando SOLO los nombres. Cuando elija, escribe en una línea aparte la marca [DATOS_PAGO CODIGO] de ESE método (una sola marca): el sistema la cambia por los datos exactos. Nunca escribas números de cuenta, llaves ni la lista de todos los medios con datos.',
        'CUPONES: aplica DCTECH2026 SOLO si el cliente escribe el código. Si no lo escribió, el total es el precio del catálogo: NO calcules ni muestres un total con descuento (puedes decir una vez "si es tu primera compra, escribe el código DCTECH2026"). Con cupón escrito, di el total con descuento y aclara que se confirma al validar el pago.',
        'NO ES COMPRA: si el mensaje no es de un cliente de la tienda, responde EXACTAMENTE "[NO_COMPRA] <tema en pocas palabras>" y nada más (el dueño le contesta en persona). Ante la duda, atiéndelo como cliente.',
        'ESCALAMIENTO: si aplica cualquier disparador de escalamiento, responde EXACTAMENTE "[ESCALAR] <motivo breve>" y nada más.',
        'CAPTURAS: si el mensaje trae "[Captura enviada por el cliente. Se ve: …]", es lo que muestra su pantalla (leído por otra IA). Si es un problema de una cuenta o licencia que vendemos y la guía de soporte da una solución concreta, dásela en pasos cortos; si no está claro, es un daño de un equipo o pide revisar su pedido, responde "[ESCALAR] Captura de un problema". Nunca digas que no puedes ver imágenes.',
        'PEDIDO DIGITAL: cuando el cliente CONFIRME un producto digital del catálogo (streaming, licencias, pines o recargas) y su opción, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_DIGITAL] {"producto":"<nombre exacto del catálogo>","variante":"<opción exacta>"} (si el cliente ESCRIBIÓ un cupón, agrega "cupon":"<código>"). Una sola vez por pedido. El cliente no ve esa línea. Luego sigue con el pago normalmente.',
        'PEDIDO COMBO: si lo que el cliente confirma es un COMBO (2 o más plataformas), en vez de [PEDIDO_DIGITAL] agrega al FINAL, en una línea aparte: [PEDIDO_COMBO] {"items":[{"producto":"<nombre exacto>","variante":"<opción exacta>"}]}. Una sola vez por combo.',
    ].join('\n');

    return [{ json: { numero: msg.numero, texto, sistema } }];
}

// A5 · Revisa la respuesta del agente antes de enviarla
function revisarRespuesta() {
    const cfg = $('Config bot').first().json;
    const msg = $('Normalizar mensaje').first().json;
    // Catálogo, precios y plantillas EN VIVO desde el sitio (la copia embebida solo si el sitio no respondió)
    const enVivo = baseViva($('Base de conocimiento').first().json);
    const kbBase = enVivo && Array.isArray(enVivo.catalogo) && enVivo.plantillas ? enVivo : __KB__;
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
        return [`💳 *${(__NOMBRES_PAGO__)[tipo] ?? tipo}*`, ...cuentas.map((m) => [
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
}

// B1 · Posventa: arma el texto de la notificación con la plantilla de su tipo
function armarNotificacion() {
    const n = $input.first().json;
    if (!n || !n.id) return []; // cola vacía: nada que enviar (y nada que marcar)
    const enVivo = baseViva($('Plantillas posventa').first().json);
    const base = enVivo && enVivo.plantillas && enVivo.notificaciones ? enVivo : __KB__;
    const clave = base.notificaciones.plantilla_por_tipo[n.tipo];
    const plantilla = base.plantillas[clave] ?? __KB__.plantillas[clave];
    if (!plantilla) throw new Error(`Sin plantilla para ${n.tipo}`);
    const texto = rellenar(plantilla, n.variables ?? {});
    if (texto.length < 20) throw new Error('Mensaje vacío o incompleto');
    // ADMIN_*: avisos para ti (comprobante nuevo, falla reportada) → tu número de aviso, no el del cliente
    let numero = n.destino;
    if (String(n.tipo).startsWith('ADMIN_')) {
        numero = soloDigitos($('Config posventa').first().json.numero_aviso_admin);
        if (!numero) throw new Error('Falta numero_aviso_admin en "Config posventa"');
    }
    return [{ json: { id: n.id, tipo: n.tipo, numero, texto } }];
}

// B2 · Recuerda a quién se pidió reseña (el bot interpreta su "NO" como baja durante 7 días)
function recordarResena() {
    const n = $('Recorrer cola').first().json;
    if (n.tipo === 'SOLICITUD_RESENA') {
        const memoria = $getWorkflowStaticData('global');
        memoria.resenas = memoria.resenas || {};
        memoria.resenas[n.destino] = Date.now();
    }
    if (n.tipo === 'RENOVACION') {
        const memoria = $getWorkflowStaticData('global');
        memoria.renovaciones = memoria.renovaciones || {};
        memoria.renovaciones[n.destino] = { producto: n.variables?.producto, variante: n.variables?.variante, t: Date.now() };
    }
    return $input.all();
}

/* ---------- C) Triangulación con el proveedor (WO-024) ----------
   Una ejecución por pedido: cotiza → espera → pide pago al admin → espera → reenvía el comprobante →
   espera → extrae y valida accesos → entrega. Cada espera es un nodo Wait "On Webhook Call"; su URL se
   guarda en public.triangulaciones y "Enrutar evento" la llama cuando llega el mensaje que corresponde. */

// C1 · Inicia la triangulación si la IA confirmó un pedido digital válido
function crearTriangulacion() {
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
}

// C2 · Respuesta del proveedor a la cotización (o fin de la espera)
function evaluarCotizacion() {
    const t = $('Crear triangulación').first().json;
    const b = $input.first().json.body;
    // Solo a quien YA pagó (orden web) se le avisa la demora; en el chat aún no ha pagado: el aviso es solo para ti
    const demora = t.pagado ? 'Tu pedido está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏' : null;
    if (!b) terminar('VENCIDO', `⏰ El proveedor no respondió la cotización de *#${t.referencia}* (${t.producto}) en __HORAS_COTIZACION__ h. Atiéndelo a mano.`, demora);
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
}

// C3 · Comprobante del administrador (o fin de la espera)
function evaluarPago() {
    const t = $('Crear triangulación').first().json;
    const b = $input.first().json.body;
    if (!b) terminar('VENCIDO', `⏰ No recibí el comprobante de pago al proveedor para *#${t.referencia}* en __HORAS_PAGO__ h. Pedido cerrado: atiéndelo a mano.`,
        'Tu pedido está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏');
    if (b.tipo === 'cancelar') terminar('CANCELADO', `🛑 Pedido *#${t.referencia}* cancelado.`, null);
    return [{ json: { wamid: b.wamid } }];
}

// C4 · Accesos del proveedor: prepara la extracción con IA
function prepararExtraccion() {
    const t = $('Crear triangulación').first().json;
    const b = $input.first().json.body;
    if (!b) terminar('VENCIDO', `⏰ El proveedor no envió los accesos de *#${t.referencia}* en __HORAS_CREDENCIALES__ h. Revisa con él y entrega a mano.`,
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
}

// C5 · Valida lo extraído: sin datos inventados, todo debe estar TEXTUAL en el mensaje del proveedor
function validarCredenciales() {
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
}

// C6 · Confianza insuficiente: el administrador decide
function pedirAprobacion() {
    const t = $('Crear triangulación').first().json;
    const c = $input.first().json;
    const cfg = $('Config bot').first().json;
    return [{ json: { numero: soloDigitos(cfg.numero_aviso_admin), confianza: c.confianza, texto: [
        `⚠️ *Revisa los accesos de #${t.referencia}* (${t.producto})`,
        `Motivo: ${c.problemas.join('; ')}.`,
        '',
        'El proveedor escribió:',
        `«${String($('Preparar extracción').first().json.texto_proveedor).slice(0, 500)}»`,
        '',
        `Extraje → usuario: ${c.usuario || '—'} · clave: ${c.clave || '—'}${c.perfil ? ` · perfil: ${c.perfil}` : ''}${c.pin ? ` · PIN: ${c.pin}` : ''}`,
        '',
        `Si está bien responde *#aprobar ${t.referencia}* y se los envío al cliente.`,
        `Si no, responde *#cancelar ${t.referencia}* y entrégalos a mano.`,
    ].join('\n') } }];
}

// C7 · Respuesta del administrador a la revisión
function evaluarAprobacion() {
    const t = $('Crear triangulación').first().json;
    const b = $input.first().json.body;
    if (!b) terminar('VENCIDO', `⏰ Sin aprobación para *#${t.referencia}*: entrega los accesos a mano.`,
        'Tu pedido está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏');
    if (b.tipo === 'cancelar') terminar('CANCELADO', `🛑 Pedido *#${t.referencia}* cancelado: entrega los accesos a mano si corresponde.`, null);
    const c = $('Validar credenciales').first().json;
    if (!c.usuario || !c.clave) terminar('REVISION_MANUAL', `⚠️ *#${t.referencia}* no tiene usuario y clave completos: entrégalo a mano.`, null);
    return [{ json: c }];
}

// C8 · Mensaje final al cliente. Usuario, clave, perfil y PIN van EXACTOS (sin limpiar símbolos)
function mensajeEntrega() {
    const t = $('Crear triangulación').first().json;
    const c = $input.first().json;
    const exactos = { usuario: c.usuario, clave: c.clave, perfil: c.perfil, pin: c.pin };
    const otros = { pedido: t.referencia, producto: t.producto };
    const texto = String(__KB__.plantillas.entrega_credenciales).split('\n').map((linea) => {
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
}

// C9 · Aviso al administrador tras entregar
function avisoEntrega() {
    const t = $('Crear triangulación').first().json;
    const cfg = $('Config bot').first().json;
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    const e = $('Mensaje de entrega').first().json;
    const panel = $('Marcar entregado en el panel').first().json ?? {};
    return aviso ? [{ json: { numero: aviso, texto: [
        `✅ *Entregado #${t.referencia}* · ${t.producto}`,
        `Cliente: +${t.cliente} · clave terminada en …${e.clave_final}`,
        panel.ok === true ? '🛡️ Registrado en el panel con garantía activa.' : `⚠️ No se registró en el panel (${String(panel.mensaje ?? 'sin respuesta').slice(0, 160)}): márcalo entregado a mano para activar la garantía.`,
    ].join('\n') } }] : [];
}

// Combo en modo manual: en vez de cotizarle al proveedor por WhatsApp, te avisa a ti (estado REVISION_MANUAL)
function comboManual() {
    const t = $('Crear combo').first().json;
    if (!t.manual) return $input.all();
    const lista = t.lineas.map((l) => {
        const e = __ANC_MAPA__.find((m) => normalizar(m.producto) === normalizar(l.producto) && normalizar(m.variante) === normalizar(l.variante));
        return `• ${l.producto} – ${l.variante} (${cop(l.precio_venta)})${e ? ` → ANC: *${e.anc_producto} · ${e.anc_plan}*` : ' → sin equivalencia en ANC'}`;
    });
    const cfgC = $('Config bot').first().json;
    const consulta = consultaProveedor(cfgC, t.referencia, t.lineas.map((l) => {
        const e = __ANC_MAPA__.find((m) => normalizar(m.producto) === normalizar(l.producto) && normalizar(m.variante) === normalizar(l.variante));
        return e ? `${e.anc_producto} · ${e.anc_plan}` : `${l.producto} – ${l.variante}`;
    }));
    terminar('REVISION_MANUAL', [
        t.web ? `🧩 *Combo PAGADO · cómpralo ya en ANC* · #${t.referencia}` : `🧩 *Combo nuevo · ⏳ AÚN NO HA PAGADO* · #${t.referencia}`,
        `Cliente: +${t.cliente}${t.cliente_nombre ? ` (${t.cliente_nombre})` : ''} · Total ${cop(t.total ?? t.lineas.reduce((a, l) => a + l.precio_venta, 0))}`,
        ...lista,
        '',
        '*Paso a paso:*',
        ...(t.web ? ['1️⃣ Compra cada plataforma en ANC (WhatsApp del pedido: 322 328 4622).', '2️⃣ Cuando ANC envíe cada cuenta, respóndeme *#entregar* con la referencia de esa línea (DC-XXXXX1, DC-XXXXX2…).']
            : ['1️⃣ Espera su comprobante.', `2️⃣ Revisa el pago y responde *#ok ${t.referencia}1* (y así cada línea) o *#no ... motivo*.`, '3️⃣ Compra en ANC y entrega cada cuenta con *#entregar*.']),
        ...(consulta ? ['', '📨 Ya le pregunté a ANC por estas plataformas; su respuesta te llega aquí.'] : []),
    ].join('\n'), null, consulta);
}

/* ---------- C-web) Compra en el portal del proveedor (WO-035) ----------
   Mismo pedido, mismas esperas y misma extracción que por WhatsApp; cambian tres pasos:
   cotizar (catálogo público de ancpagos.com), comprar (procesar_pago con tu comprobante) y leer los
   accesos (página del pedido en ANC, que "Pedidos ANC cada minuto" revisa y entrega a "Esperar credenciales"). */

// CW0 · Respaldo: si el portal de ANC no responde (mantenimiento), se lee su tienda pública allnecessarycolombia.com
// (mismos precios que el portal). Solo da costo y disponibilidad de referencia: la compra la haces tú a mano.
async function tiendaAnc() {
    const html = String($('Catálogo ANC').first().json.data ?? '');
    if (html.includes('CATALOGO_INICIAL_IDX')) return [{ json: { omitido: true } }];
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
    const base = 'https://allnecessarycolombia.com/productos/';
    const productos = [];
    for (let n = 1; n <= 10; n++) {
        let pagina;
        try { pagina = String(await this.helpers.httpRequest({ url: n === 1 ? base : `${base}page/${n}/`, timeout: 20000, headers: { 'User-Agent': UA } })); } catch { break; }
        const antes = productos.length;
        const re = /data-variants="([^"]+)"[\s\S]*?product-item-name-\d+">([^<]+)/g;
        for (let m; (m = re.exec(pagina));) {
            let variantes = [];
            try { variantes = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch { continue; }
            productos.push({ nombre: m[2].trim(), variantes: variantes.map((v) => ({ nombre: [v.option0, v.option1, v.option2].filter(Boolean).join(' / '), precio: Number(v.price_number) || null, disponible: v.available !== false, stock: Number.isFinite(v.stock) ? v.stock : null })) });
        }
        if (productos.length === antes) break;
    }
    return [{ json: { fuente: base, productos } }];
}

// CW1 · Precio, existencia y medio de pago en el portal de ANC → mismo formato que una respuesta del proveedor
function cotizacionAnc() {
    const t = $('Crear triangulación').first().json;
    const cfg = $('Config bot').first().json;
    const html = String($('Catálogo ANC').first().json.data ?? '');
    const medios = $('Medios de pago ANC').first().json ?? {};
    const clave = (a, b) => `${normalizar(a).trim()}|${normalizar(b).trim()}`;
    const eq = __ANC_MAPA__.find((m) => clave(m.producto, m.variante) === clave(t.producto, t.variante)) ?? null;
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
}

// CW2 · Pedido para ancpagos.com/procesar_pago (los mismos campos que su checkout) + tu comprobante
function prepararCompraAnc() {
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
}

// CW3 · Respuesta de ANC: "id|token" (lo mismo que usa su checkout para abrir la página del pedido)
function pedidoAncCreado() {
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
}

// CW4 · Página del pedido en ANC → si ya muestra los accesos, reanuda "Esperar credenciales" de ese pedido
function accesosEnAnc() {
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
}

/* ---------- E) Configurar Evolution desde n8n (WO-038) ----------
   Un clic en "Configurar Evolution" registra el webhook del bot en tu instancia de Evolution con la
   credencial que n8n ya tiene (nadie tiene que ver ni copiar la API key). Prueba el formato v2 y el v1. */
function resultadoEvolution() {
    const cfg = $('Config bot').first().json;
    const v2 = $('Webhook Evolution v2').first().json;
    const v1 = $('Webhook Evolution v1').first().json;
    const leido = $input.first().json;
    const w = leido.body?.webhook ?? leido.body ?? {};
    const url = String(cfg.webhook_publico || '').trim();
    const guardado = w.url === url && (w.events ?? []).includes('MESSAGES_UPSERT') && (w.enabled ?? w.enable ?? true) !== false;
    const local = (h) => ['localhost', '127.0.0.1', '::1'].includes(h);
    let aviso = null;
    try {
        const evo = new URL(cfg.evolution_url);
        const hook = new URL(url);
        if (local(hook.hostname) && !local(evo.hostname)) aviso = `Evolution está en ${evo.hostname}: desde allí "localhost" no es tu PC. Pon en Config bot → webhook_publico la URL de tu túnel (…/webhook/dc-whatsapp) y vuelve a pulsar.`;
        else if (local(hook.hostname)) aviso = 'El webhook usa localhost: sirve si Evolution corre en este PC fuera de Docker. Si corre en Docker, pon en webhook_publico http://host.docker.internal:5678/webhook/dc-whatsapp y vuelve a pulsar.';
    } catch { aviso = 'Revisa evolution_url y webhook_publico en Config bot: alguna no es una URL válida.'; }
    const estado = (r) => (r?.statusCode ? `HTTP ${r.statusCode}` : 'sin respuesta');
    return [{ json: {
        resultado: guardado ? '✅ Webhook registrado en Evolution' : '⚠️ Evolution no confirmó el webhook',
        instancia: cfg.evolution_instancia,
        webhook_pedido: url,
        webhook_en_evolution: { url: w.url ?? null, eventos: w.events ?? null, activo: w.enabled ?? w.enable ?? null },
        intentos: `formato v2: ${estado(v2)} · formato v1: ${estado(v1)} · lectura: ${estado(leido)}`,
        aviso,
        siguiente: guardado ? 'Escríbele al bot desde otro WhatsApp y pulsa en el panel "Probar todo el sistema" (fila "Recibe los chats").'
            : Number(leido.statusCode) === 401 || Number(v2.statusCode) === 401 ? 'Evolution rechazó la API key: revisa la credencial "Evolution API" en n8n (Header apikey).'
            : 'Revisa evolution_url y evolution_instancia en Config bot y la credencial "Evolution API".',
    } }];
}

/* ---------- D) Compra al proveedor para COMBOS (WO-031) ----------
   Un padre DC-XXXXX + una línea por plataforma (DC-XXXXX1…). Una cotización, un #pago y un mensaje de
   accesos; cada línea se entrega o queda en revisión por separado. */

// D1 · Crea el combo (padre + líneas) con el precio cobrado repartido por línea
function crearCombo() {
    const cfg = $('Config bot').first().json;
    const item = $input.first().json;
    const c = item.combo;
    const web = Boolean(c?.referencia && Array.isArray(c?.lineas));
    const manual = !['web', 'whatsapp'].includes(String(cfg.canal_compra || 'manual').trim().toLowerCase());
    if (!c || (!web && (!Array.isArray(c.items) || c.items.length < 2)) || (!manual && !soloDigitos(cfg.numero_proveedor)) || !soloDigitos(cfg.numero_aviso_admin)) return [];
    const memoria = $getWorkflowStaticData('global');
    memoria.pedidos = memoria.pedidos || {};
    const ahora = Date.now();
    for (const [k, t] of Object.entries(memoria.pedidos)) if (ahora - t > 2 * 3600e3) delete memoria.pedidos[k];
    if (!web) {
        const clave = `${item.numero}|combo|${c.items.map((x) => `${x.producto}/${x.variante}`).sort().join('|')}`;
        if (memoria.pedidos[clave]) return [];
        memoria.pedidos[clave] = ahora;
    }

    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let referencia = 'DC-';
    for (let i = 0; i < 5; i++) referencia += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    let lineas;
    if (web) {
        // Orden web: referencias y precios cobrados vienen de la base (crear_orden_web / despachar_orden_web)
        referencia = c.referencia;
        lineas = c.lineas.map((l) => ({ referencia: l.referencia, producto: l.producto, variante: l.variante, precio_venta: Number(l.precio_venta) }));
    } else {
        // Precio cobrado por línea: lista − descuento del combo; el redondeo se ajusta en la última
        lineas = c.items.map((x, i) => ({ referencia: `${referencia}${i + 1}`, producto: x.producto, variante: x.variante,
            precio_venta: Math.round(x.precio * (1 - (Number(c.pct) || 0) / 100)) }));
        lineas[lineas.length - 1].precio_venta += c.total - lineas.reduce((s2, l) => s2 + l.precio_venta, 0);
    }
    const total = web ? lineas.reduce((s2, l) => s2 + l.precio_venta, 0) : c.total;
    const nombre = String(item.nombre ?? $('Normalizar mensaje').first().json.nombre ?? '').slice(0, 60);
    // Mismas columnas en todas las filas (PostgREST: inserción/upsert por lote)
    const fila = (x) => ({ referencia: x.referencia, cliente: item.numero, cliente_nombre: nombre, producto: x.producto, variante: x.variante,
        precio_venta: x.precio_venta, estado: 'COTIZANDO', esperando: x.esperando ?? null, es_combo: x.es_combo ?? false,
        grupo: x.grupo ?? null, lineas: x.lineas ?? null });
    const filas = [
        fila({ referencia, producto: web ? `Pedido web · ${lineas.length} plataformas` : `Combo · ${lineas.length} plataformas`,
            variante: lineas.map((l) => l.producto).join(' + ').slice(0, 200), precio_venta: total, esperando: 'COTIZACION', es_combo: true, lineas }),
        ...lineas.map((l) => fila({ ...l, grupo: referencia })),
    ];
    if (!web) {
        memoria.ordenesChat = memoria.ordenesChat || {};
        memoria.ordenesChat[item.numero] = { referencia, producto: `Combo: ${lineas.map((l) => `${l.producto} – ${l.variante}`).join(' + ')}`, variante: '', precio: total, at: ahora,
            plan: lineas.map((l) => { const e = __ANC_MAPA__.find((m) => normalizar(m.producto) === normalizar(l.producto) && normalizar(m.variante) === normalizar(l.variante)); return e ? `${e.anc_producto} · ${e.anc_plan}` : l.producto; }).join(' + ') };
    }
    return [{ json: {
        manual,
        referencia, cliente: item.numero, cliente_nombre: nombre, total, pct: c.pct ?? 0, web, lineas, filas,
        texto_proveedor: [
            `Hola, cotización pedido *#${referencia}* (combo):`,
            ...lineas.map((l, i) => `${i + 1}. ${l.producto}${l.variante ? ` – ${l.variante}` : ''}`),
            'Por favor responde citando este mensaje con el precio de CADA línea (ej: "1. 12.000") y avísame si alguna no está disponible.',
        ].join('\n'),
    } }];
}

// E1 · Orden web validada (tomar_despachos, WO-033) → el mismo arranque que un pedido por WhatsApp
function prepararDespacho() {
    const o = $input.first().json;
    if (!o || !o.referencia) return []; // nada por despachar
    const base = { numero: o.cliente, nombre: o.cliente_nombre ?? '' };
    if (o.es_combo && Array.isArray(o.lineas) && o.lineas.length) {
        return [{ json: { ...base, combo: { referencia: o.referencia, lineas: o.lineas } } }];
    }
    return [{ json: { ...base, pedido: { referencia: o.referencia, producto: o.producto, variante: o.variante, precio: Number(o.precio_venta) } } }];
}

// D2 · Líneas del combo, una por item, para vincular cada una al panel
function lineasCombo() {
    return $('Crear combo').first().json.lineas.map((l) => ({ json: { referencia: l.referencia } }));
}

// D3 · Cotización del proveedor: costo y disponibilidad POR LÍNEA + control de margen
function evaluarCotizacionCombo() {
    const t = $('Crear combo').first().json;
    const b = $input.first().json.body;
    const demora = t.web ? 'Tu combo está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏' : null;
    if (!b) terminar('VENCIDO', `⏰ El proveedor no respondió la cotización del combo *#${t.referencia}* en __HORAS_COTIZACION__ h. Atiéndelo a mano.`, demora);
    if (b.tipo === 'cancelar') terminar('CANCELADO', `🛑 Combo *#${t.referencia}* cancelado.`, null);
    const texto = String(b.texto ?? '');
    const negativo = /(no hay|agotad|sin stock|no tengo|no disponible|no manejo)/;
    const renglones = texto.split(/\n+/).map((x) => x.trim()).filter(Boolean);
    const lineas = t.lineas.map((l, i) => {
        const palabra = normalizar(l.producto).split(/\s+/)[0];
        const renglon = renglones.find((x) => new RegExp(`^\\s*${i + 1}\\s*[.)\\-:]`).test(x)) || renglones.find((x) => normalizar(x).includes(palabra)) || null;
        const agotada = renglon ? negativo.test(normalizar(renglon)) : false;
        const costo = renglon && !agotada ? precioDe(renglon.replace(/^\s*\d+\s*[.)\-:]\s*/, '')) : null;
        return { ...l, renglon, agotada, costo };
    });
    // Todo el mensaje negativo sin renglones identificables → nada disponible
    if (lineas.every((l) => !l.renglon) && negativo.test(normalizar(texto))) lineas.forEach((l) => { l.agotada = true; });
    const disponibles = lineas.filter((l) => !l.agotada);
    if (!disponibles.length) {
        terminar('AGOTADO', `❌ Proveedor sin disponibilidad para el combo *#${t.referencia}*. Dijo: «${texto.slice(0, 200)}»`,
            'Por ahora no tenemos disponibles las plataformas de tu combo 😔 Escríbeme y te muestro otras opciones.');
    }
    const venta = disponibles.reduce((s2, l) => s2 + l.precio_venta, 0);
    const lineaTotal = renglones.find((x) => /total/i.test(x));
    let costoTotal = disponibles.every((l) => l.costo !== null) ? disponibles.reduce((s2, l) => s2 + l.costo, 0) : null;
    if (costoTotal === null && lineaTotal) costoTotal = precioDe(lineaTotal);
    if (costoTotal === null && disponibles.length === 1 && renglones.length === 1) costoTotal = precioDe(texto);
    const perdida = costoTotal !== null && costoTotal > venta;
    const pausado = perdida || costoTotal === null;
    const agotadas = lineas.filter((l) => l.agotada);
    const vinculos = $('Vincular combo al panel').all().map((i) => i.json);
    const sinPanel = vinculos.filter((v) => v.ok !== true).length;
    return [{ json: {
        costo_total: costoTotal, venta, perdida, pausado,
        hay_agotadas: agotadas.length ? 'si' : 'no',
        lineas: lineas.map(({ renglon, ...l }) => l),
        // Las agotadas quedan EN REVISIÓN (cambio o reembolso parcial); las demás siguen
        actualizar: agotadas.map((l) => ({ referencia: l.referencia, estado: 'REVISION_MANUAL', notas: `Proveedor sin disponibilidad: ${String(l.renglon ?? texto).slice(0, 200)}` })),
        texto_cliente: agotadas.length ? [
            `⚠️ Sobre tu combo *#${t.referencia}*: ${agotadas.map((l) => `*${l.producto}*`).join(', ')} no ${agotadas.length === 1 ? 'está disponible' : 'están disponibles'} en este momento.`,
            'Un asesor te escribe para ofrecerte un cambio o el reembolso de esa parte. Lo demás sigue en proceso ✅',
        ].join('\n') : '',
        texto_admin: [
            `💸 *Pagar al proveedor · combo #${t.referencia}*`,
            `Cliente: +${t.cliente}${t.cliente_nombre ? ` (${t.cliente_nombre})` : ''}`,
            ...lineas.map((l) => `${l.agotada ? '❌' : '•'} ${l.referencia} · ${l.producto}${l.variante ? ` – ${l.variante}` : ''}: venta ${cop(l.precio_venta)} · ${l.agotada ? 'AGOTADA → en revisión' : `costo ${l.costo !== null ? cop(l.costo) : '¿?'}`}`),
            `Total cobrado (disponibles): ${cop(venta)} · Costo: ${costoTotal !== null ? cop(costoTotal) : 'no lo pude leer'}${costoTotal !== null ? ` · Margen: ${cop(venta - costoTotal)}` : ''}`,
            `Proveedor dijo: «${texto.slice(0, 300)}»`,
            '',
            pausado
                ? `⛔ *PAGO PAUSADO*: ${perdida ? `el costo supera lo cobrado en ${cop(costoTotal - venta)}` : 'no pude leer el costo de todas las líneas'}. No reenviaré tu comprobante al proveedor. Si decides comprar igual: *#pago ${t.referencia} forzar* con la foto. Para cancelar: *#cancelar ${t.referencia}*.`
                : `⚠️ Antes de pagar, confirma en el panel que el cliente YA pagó (${t.lineas.map((l) => l.referencia).join(', ')}). Luego envíame la FOTO o PDF con *#pago ${t.referencia}*. Para cancelar: *#cancelar ${t.referencia}*.`,
            sinPanel ? `⚠️ ${sinPanel} línea(s) no quedaron en el panel: valida el pago del cliente a mano.` : '📋 Cada plataforma quedó como un pedido en el panel.',
        ].join('\n'),
    } }];
}

// D4 · Comprobante del administrador (o fin de la espera)
function evaluarPagoCombo() {
    const t = $('Crear combo').first().json;
    const b = $input.first().json.body;
    if (!b) terminar('VENCIDO', `⏰ No recibí el comprobante de pago al proveedor del combo *#${t.referencia}* en __HORAS_PAGO__ h. Cerrado: atiéndelo a mano.`,
        'Tu combo está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏');
    if (b.tipo === 'cancelar') terminar('CANCELADO', `🛑 Combo *#${t.referencia}* cancelado.`, null);
    const c = $('Evaluar cotización combo').first().json;
    const disponibles = c.lineas.filter((l) => !l.agotada);
    return [{ json: { wamid: b.wamid, actualizar: disponibles.map((l) => ({ referencia: l.referencia, estado: 'ESPERANDO_CREDENCIALES', costo: l.costo, panel: 'PEDIDO_REALIZADO' })) } }];
}

// D5 · Accesos del proveedor: un JSON por línea
function prepararExtraccionCombo() {
    const t = $('Crear combo').first().json;
    const b = $input.first().json.body;
    if (!b) terminar('VENCIDO', `⏰ El proveedor no envió los accesos del combo *#${t.referencia}* en __HORAS_CREDENCIALES__ h. Revisa con él y entrega a mano.`,
        'Tu combo está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏');
    if (b.tipo === 'cancelar') terminar('CANCELADO', `🛑 Combo *#${t.referencia}* cancelado.`, null);
    const texto = String(b.texto ?? '').slice(0, 3000);
    const disponibles = $('Evaluar cotización combo').first().json.lineas.filter((l) => !l.agotada);
    return [{ json: { texto_proveedor: texto, prompt: [
        'Extrae los datos de acceso de CADA línea de este pedido combo, a partir del mensaje de un proveedor de cuentas digitales.',
        'Líneas esperadas:',
        ...disponibles.map((l) => `${t.lineas.findIndex((x) => x.referencia === l.referencia) + 1}. ${l.producto}${l.variante ? ` (${l.variante})` : ''}`),
        'Responde SOLO con un JSON, sin texto adicional: {"lineas":[{"linea":1,"usuario":"","clave":"","perfil":"","pin":"","confianza":0.0}]}',
        'Copia usuario y clave EXACTAMENTE como aparecen (mismas mayúsculas, números y símbolos). Si una línea no aparece, devuélvela con datos vacíos y confianza 0.',
        '"confianza" (0 a 1): qué tan seguro estás de que son los accesos completos de ESA línea.',
        'Mensaje:', '"""', texto, '"""',
    ].join('\n') } }];
}

// D6 · Valida cada línea (todo TEXTUAL en el mensaje, confianza ≥ 0.9) y arma UNA entrega al cliente
function entregarCombo() {
    const t = $('Crear combo').first().json;
    const fuente = $('Preparar extracción combo').first().json.texto_proveedor;
    const disponibles = $('Evaluar cotización combo').first().json.lineas.filter((l) => !l.agotada);
    let d = {};
    try { d = JSON.parse(String($input.first().json.text ?? '').replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/)?.[0] ?? '{}'); } catch { d = {}; }
    const extraidas = Array.isArray(d.lineas) ? d.lineas : [];
    const limpio = (v) => String(v ?? '').trim();
    const resultado = disponibles.map((l) => {
        const n = t.lineas.findIndex((x) => x.referencia === l.referencia) + 1;
        const e = extraidas.find((x) => Number(x.linea) === n) ?? {};
        const c = { usuario: limpio(e.usuario), clave: limpio(e.clave), perfil: limpio(e.perfil), pin: limpio(e.pin) };
        const confianza = Math.max(0, Math.min(1, Number(e.confianza) || 0));
        const problemas = [];
        if (!c.usuario) problemas.push('sin usuario');
        if (!c.clave) problemas.push('sin clave');
        if (c.usuario && !fuente.includes(c.usuario)) problemas.push('usuario no textual');
        if (c.clave && !fuente.includes(c.clave)) problemas.push('clave no textual');
        for (const k of ['perfil', 'pin']) if (c[k] && !fuente.includes(c[k])) c[k] = '';
        if (confianza < 0.9) problemas.push(`confianza ${confianza.toFixed(2)}`);
        return { ...l, ...c, confianza, problemas };
    });
    const ok = resultado.filter((r) => !r.problemas.length);
    const revisar = resultado.filter((r) => r.problemas.length);
    // Plantilla oficial por línea; usuario, clave, perfil y PIN van EXACTOS
    const bloque = (r) => String(__KB__.plantillas.entrega_credenciales).split('\n').map((linea) => {
        let vacia = false;
        const exactos = { usuario: r.usuario, clave: r.clave, perfil: r.perfil, pin: r.pin };
        const otros = { pedido: r.referencia, producto: `${r.producto}${r.variante ? ` – ${r.variante}` : ''}` };
        const v = linea.replace(/\{(\w+)\}/g, (_, k) => {
            const x = k in exactos ? String(exactos[k] ?? '').trim() : limpiar(otros[k]);
            if (!x) vacia = true;
            return x;
        });
        return vacia ? null : v;
    }).filter((x) => x !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const texto = [
        ...ok.map(bloque),
        revisar.length ? `🛠️ ${revisar.map((r) => `*${r.producto}*`).join(', ')}: lo estamos revisando con nuestro equipo y te escribimos enseguida.` : '',
    ].filter(Boolean).join('\n\n━━━━━━━━━━\n\n');
    const clavePanel = (r) => [r.usuario, r.clave].filter(Boolean).join(' / ') + (r.perfil ? ` · perfil ${r.perfil}` : '') + (r.pin ? ` · PIN ${r.pin}` : '');
    return [{ json: {
        numero: t.cliente, texto, entregadas: ok.length, en_revision: revisar.length,
        actualizar: [
            ...ok.map((r) => ({ referencia: r.referencia, estado: 'ENTREGADO', panel: 'ENTREGADO', clave: clavePanel(r), credencial_final: String(r.clave).slice(-4), confianza: r.confianza })),
            ...revisar.map((r) => ({ referencia: r.referencia, estado: 'REVISION_MANUAL', notas: `Accesos por revisar: ${r.problemas.join(', ')}`, confianza: r.confianza })),
        ],
        estado_padre: revisar.length || $('Evaluar cotización combo').first().json.hay_agotadas === 'si' ? 'REVISION_MANUAL' : 'ENTREGADO',
        texto_admin: [
            `${revisar.length ? '⚠️' : '✅'} *Combo #${t.referencia}* · entregadas ${ok.length} de ${t.lineas.length}`,
            ...ok.map((r) => `✅ ${r.referencia} · ${r.producto} · clave …${String(r.clave).slice(-4)}`),
            ...revisar.map((r) => `🛠️ ${r.referencia} · ${r.producto}: ${r.problemas.join(', ')} → en revisión, entrégalo a mano.`),
            ...$('Evaluar cotización combo').first().json.lineas.filter((l) => l.agotada).map((l) => `❌ ${l.referencia} · ${l.producto}: agotada → ofrece cambio o reembolso parcial.`),
            revisar.length ? `El proveedor escribió: «${fuente.slice(0, 400)}»` : '',
        ].filter(Boolean).join('\n'),
    } }];
}

// D7 · Cierre del combo por vencimiento, cancelación, agotado o falla técnica
function cerrarCombo() {
    const t = $('Crear combo').first().json;
    const cfg = $('Config bot').first().json;
    const e = $input.first().json;
    const bruto = String(e.error?.message ?? e.error ?? e.message ?? '');
    let datos = null;
    const m = /TERMINAR (\{[\s\S]*\})/.exec(bruto);
    if (m) { try { datos = JSON.parse(m[1]); } catch { datos = null; } }
    if (!datos) datos = { estado: 'REVISION_MANUAL', avisoAdmin: `⚠️ Falla técnica en el combo *#${t.referencia}*: ${bruto.slice(0, 200) || 'sin detalle'}. Termínalo a mano.`, avisoCliente: null };
    const mensajes = [];
    if (datos.avisoCliente) mensajes.push({ numero: t.cliente, texto: datos.avisoCliente });
    if (datos.avisoAdmin && soloDigitos(cfg.numero_aviso_admin)) mensajes.push({ numero: soloDigitos(cfg.numero_aviso_admin), texto: datos.avisoAdmin });
    const proveedor = String(cfg.numero_proveedor ?? '').split(/[,;\s]+/).map((x) => soloDigitos(x)).find(Boolean);
    if (datos.avisoProveedor && proveedor) mensajes.push({ numero: proveedor, texto: datos.avisoProveedor });
    return [{ json: {
        referencia: t.referencia,
        patch: { estado: datos.estado, esperando: null, resume_url: null, notas: String(datos.avisoAdmin ?? '').slice(0, 500) },
        // Las líneas siguen al padre (las ya entregadas no se tocan: actualizar_lineas_combo solo cambia lo que recibe)
        actualizar: t.lineas.map((l) => ({ referencia: l.referencia, estado: datos.estado })),
        mensajes,
    } }];
}

// C10 · Cierre por vencimiento, cancelación, agotado o falla técnica
function cerrarTriangulacion() {
    const t = $('Crear triangulación').first().json;
    const cfg = $('Config bot').first().json;
    const e = $input.first().json;
    const bruto = String(e.error?.message ?? e.error ?? e.message ?? '');
    let datos = null;
    const m = /TERMINAR (\{[\s\S]*\})/.exec(bruto);
    if (m) { try { datos = JSON.parse(m[1]); } catch { datos = null; } }
    if (!datos) {
        datos = { estado: 'REVISION_MANUAL', avisoAdmin: `⚠️ Falla técnica en *#${t.referencia}* (${t.producto}): ${bruto.slice(0, 200) || 'sin detalle'}. Termínalo a mano.`, avisoCliente: null };
    }
    const mensajes = [];
    if (datos.avisoCliente) mensajes.push({ numero: t.cliente, texto: datos.avisoCliente });
    if (datos.avisoAdmin && soloDigitos(cfg.numero_aviso_admin)) mensajes.push({ numero: soloDigitos(cfg.numero_aviso_admin), texto: datos.avisoAdmin });
    const proveedor = String(cfg.numero_proveedor ?? '').split(/[,;\s]+/).map((x) => soloDigitos(x)).find(Boolean);
    if (datos.avisoProveedor && proveedor) mensajes.push({ numero: proveedor, texto: datos.avisoProveedor });
    return [{ json: { referencia: t.referencia, patch: { estado: datos.estado, esperando: null, resume_url: null, notas: String(datos.avisoAdmin ?? '').slice(0, 500) }, mensajes } }];
}

function mensajesCierreCombo() {
    return $('Cerrar combo').first().json.mensajes.map((m) => ({ json: m }));
}

function mensajesCierre() {
    return ($('Cerrar triangulación').first().json.mensajes ?? []).map((json) => ({ json }));
}

// R · Enruta un mensaje del proveedor o un comando del admin a la espera del pedido correcto
function enrutarEvento() {
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
        const p = (__KB__.catalogo ?? []).find((x) => x.tipo === 'pines' && normalizar(x.nombre) === normalizar(t.producto));
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
        for (const p of (__KB__.catalogo ?? []).filter((x) => x.tipo === 'pines')) {
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
}

/* ---------- F) Proveedor Emprende Red (WO-041 · paso 4): precio y stock cada 6 horas ----------
   Mismas reglas que herramientas/sincronizar-emprendered.mjs (id "er-<slug>-<id>", costo + margen redondeado a $100,
   réplicas fuera). Solo actualiza productos que YA están en la tienda; los nuevos se agregan con el script. */

// F1 · Lee todo el catálogo (Inertia: primera página en el HTML, las demás en JSON) y arma precio y stock
async function leerProveedor() {
    const cfg = $('Config bot').first().json;
    // 19/10/2026: catálogo de distribuidor en emprendered.com.co (la tienda vieja de catalogovirtual.co se ignora) y 50 %
    const base = String(cfg.emprendered_url && !/catalogovirtual\.co/i.test(cfg.emprendered_url) ? cfg.emprendered_url : 'https://emprendered.com.co').replace(/\/+$/, '');
    const margen = Number(cfg.emprendered_margen) >= 50 ? Number(cfg.emprendered_margen) : 50;
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
    const http = (opciones) => this.helpers.httpRequest({ timeout: 20000, ...opciones, headers: { 'User-Agent': UA, ...(opciones.headers ?? {}) } });
    const html = String(await http({ url: `${base}/catalogo`, headers: { Accept: 'text/html' } }));
    const bloque = /<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (!bloque) throw new Error('la página del catálogo cambió de estructura');
    const inicio = JSON.parse(bloque[1]);
    const categorias = new Map((inicio.props?.categories ?? []).map((c) => [c.id, String(c.name ?? '').trim()]));
    const productos = new Map((inicio.props?.products ?? []).map((p) => [p.id, p]));
    let siguiente = inicio.props?.hasMore ? inicio.props.nextPage : null;
    for (let n = 0; siguiente && n < 500; n++) {
        const pg = await http({ url: `${base}/catalogo?page=${siguiente}`, json: true,
            headers: { 'X-Inertia': 'true', 'X-Inertia-Version': inicio.version, 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html, application/xhtml+xml' } });
        const datos = typeof pg === 'string' ? JSON.parse(pg) : pg;
        for (const p of datos.props?.products ?? []) productos.set(p.id, p);
        siguiente = datos.props?.hasMore ? datos.props.nextPage : null;
    }
    if (siguiente) throw new Error('el catálogo no terminó de cargar');
    const idDc = (p) => `er-${String(p.url || p.name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140)}-${p.id}`;
    const replica = /\b1[.:]1\b|r[eé]plica|\bclon|\bcopia\b|(?<!\b(?:pilas?|bater[ií]as?)\b.{0,20})\ba{2,3}\b|tipo original/i;
    // Mismas reglas que herramientas/sincronizar-emprendered.mjs (categoría 1 sin nombre → TECNOLOGIA o GENERAL; lujo = imitación)
    const TEC_SIN_CATEGORIA = /play ?station|\bps[45]\b|xbox|nintendo|consola|gamer|\busb\b|cargador|\bcable\b|aud[ií]fono|auricular|diadema|parlante|bafle|\bmouse\b|teclado|celular|tablet|smart ?watch|reloj inteligente|power ?bank|bater[ií]a port[aá]til|memoria|micro ?sd|disco (duro|s[oó]lido)|c[aá]mara|bluetooth|\bhdmi\b|router|proyector|tv ?box|micr[oó]fono|tr[ií]pode|aro de luz|\bdron|adaptador/i;
    const LUJO = /\b(hublot|rolex|cartier|van ?cleef|louis ?vuitton|gucci|chanel|bvlgari|bulgari|tiffany|patek|audemars|omega|tag ?heuer|pandora|prada|versace|balenciaga|dior|herm[eè]s|richard ?mille)\b/i;
    const categoriaDe = (nombre, categoria) => categoria ?? (TEC_SIN_CATEGORIA.test(String(nombre)) ? 'TECNOLOGIA' : 'GENERAL');
    const EXCLUIR = ['RELOJERIA REPLICA', 'CAMISAS 1.1 FUTBOL', 'SEX SHOP', 'VAPES', 'VENDE STREAMING'];
    // Productos de Emprende Red que ya están en la tienda: los de la base de conocimiento publicada (o la embebida)
    let kbTienda = null;
    try { kbTienda = baseViva(await http({ url: cfg.url_conocimiento, json: true })); } catch { kbTienda = null; }
    const conProveedor = (c) => Array.isArray(c) && c.some((p) => String(p.id).startsWith('er-'));
    // Por slug (sin el número del proveedor): el proveedor renumeró sus productos y la tienda conserva los ids anteriores
    const sinNumero = (id) => String(id).replace(/-\d+$/, '');
    const tienda = new Map((conProveedor(kbTienda?.catalogo) ? kbTienda.catalogo : __KB__.catalogo)
        .filter((p) => String(p.id).startsWith('er-')).map((p) => [sinNumero(p.id), p]));
    // Sin productos del proveedor en la tienda no se sincroniza: si no, todos quedarían agotados
    if (!tienda.size) throw new Error('la tienda no tiene productos de Emprende Red (ejecuta el script con --tienda y publica)');
    const items = [];
    let nuevos = 0;
    for (const p of productos.values()) {
        const id = idDc(p);
        const costo = Math.round(Number(p.price_buy) || Number(p.price_sale) || 0); // emprendered.com.co: price_sale = precio de distribuidor
        const stock = Math.round(Number(p.quantity_available ?? (p.stock ?? []).reduce((s, x) => s + (Number(x.quantity) || 0), 0)) || 0);
        const nuestro = tienda.get(sinNumero(id));
        const categoria = categoriaDe(p.name, categorias.get(p.category_id) ?? null);
        if (nuestro) {
            items.push({ producto_id: nuestro.id, categoria, variante: nuestro.variantes?.[0]?.nombre ?? 'Unidad', producto: nuestro.nombre, tipo: nuestro.tipo,
                costo, precio: Math.ceil((costo * (1 + margen / 100)) / 100) * 100, stock: p.active && costo > 0 ? stock : 0, ref: String(p.reference ?? p.id), imagen: p.image ?? null });
        } else if (categoria && !EXCLUIR.includes(categoria) && p.active && stock > 0 && costo > 0 && !replica.test(String(p.name)) && !(LUJO.test(String(p.name)) && categoria !== 'PERFUMERIA')) nuevos++;
    }
    // Si el proveedor devuelve muy pocos de los nuestros, algo falló: no se toca nada (si no, todo quedaría agotado)
    if (tienda.size && items.length < tienda.size * 0.5) throw new Error(`solo encontré ${items.length} de ${tienda.size} productos de la tienda`);
    return [{ json: { items, nuevos, leidos: productos.size, en_tienda: tienda.size } }];
}

// F2 · Resultado: te avisa si falló (máx. cada 6 h) y, una vez por semana, si hay productos nuevos para agregar
function resultadoProveedor() {
    const cfg = $('Config bot').first().json;
    const lectura = $('Leer Emprende Red').first().json;
    const r = $input.first().json;
    const memoria = $getWorkflowStaticData('global');
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    const ahora = Date.now();
    const fallo = lectura.error
        ? `No pude leer el catálogo: ${String(lectura.error.message ?? lectura.error).slice(0, 160)}`
        : r.error ? `La base no aceptó los precios: ${String(r.error.message ?? r.error).slice(0, 160)} (¿aplicaste supabase/wo-041-emprendered.sql?)` : null;
    memoria.proveedor = { at: new Date(ahora).toISOString(), fallo, leidos: lectura.leidos ?? 0, actualizados: r.actualizados ?? 0, agotados: r.inactivados ?? 0 };
    const salida = [];
    if (!aviso) return salida;
    // Fallas: una vez al día y nunca de noche (9 p. m. – 7 a. m. en Colombia); la siguiente lectura de día avisa
    const hora = Number(new Date(ahora).toLocaleString('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false })) % 24;
    if (fallo && hora >= 7 && hora < 21 && ahora - (memoria.avisoProveedor || 0) > 24 * 3600e3) {
        memoria.avisoProveedor = ahora;
        salida.push({ json: { numero: aviso, texto: ['⚠️ *Sincronización con Emprende Red*', fallo, 'Precios y stock quedan como estaban; reintento cada 6 horas (este aviso sale máximo una vez al día).'].join('\n') } });
    }
    // WO-050: lo que volvió (estado "¡Volvió!" en la cola) y lo que se agotó (solo te aviso)
    const fila = Array.isArray(r) ? r[0] : r;
    const repuestos = Array.isArray(fila?.repuestos) ? fila.repuestos : [];
    const agotados = Array.isArray(fila?.agotados) ? fila.agotados : [];
    if (!fallo && repuestos.length) {
        const imagenes = new Map((lectura.items ?? []).map((x) => [x.producto_id, x.imagen]));
        memoria.estadosPendientes = [...(memoria.estadosPendientes ?? []), ...repuestos.map((x) => ({ producto: x.producto, imagen: imagenes.get(x.producto_id) ?? null,
            texto: `🔔 ¡Volvió! ${x.producto}\nQuedan ${x.stock} unidad${Number(x.stock) === 1 ? '' : 'es'} · ${cop(x.precio)}\n🛒 www.dctecnology.xyz · 💬 322 328 4622`, at: ahora }))].slice(-20);
    }
    if (!fallo && (repuestos.length || agotados.length)) {
        salida.push({ json: { numero: aviso, texto: ['📦 *Disponibilidad en Emprende Red*',
            ...repuestos.slice(0, 15).map((x) => `• 🔔 Volvió: ${x.producto} (${x.stock} u.)`),
            ...agotados.slice(0, 15).map((x) => `• ⛔ Se agotó: ${x.producto} (en la tienda sale «Agotado»)`),
            repuestos.length ? 'Publico un estado «¡Volvió!» con los que regresaron (máximo 2 estados al día).' : null].filter(Boolean).join('\n') } });
    }
    if (!fallo && lectura.nuevos > 0 && ahora - (memoria.avisoNuevosProveedor || 0) > 7 * 864e5) {
        memoria.avisoNuevosProveedor = ahora;
        salida.push({ json: { numero: aviso, texto: [`🆕 *Emprende Red tiene ${lectura.nuevos} productos nuevos con stock*`,
            'Aún no están en tu tienda. Para agregarlos: node herramientas/sincronizar-emprendered.mjs --tienda (y publicar).'].join('\n') } });
    }
    return salida;
}

/* ---------- H) IA balanceada: varias IA compatibles con OpenAI (modelos abiertos: DeepSeek, Llama, Qwen…) ----------
   Reparte las consultas según el peso de cada una (≈ su cuota gratuita diaria): siempre va primero la que menos uso
   lleva hoy en proporción a su peso, así ninguna se agota antes que las demás. Si una falla, sigue con la siguiente:
   sin saldo o clave inválida (401/402/403, cuota diaria) → pausa 6 h; límite por minuto (429) → 2 min; caída → 1 min.
   Las claves NO están en git: herramientas/sincronizar-n8n.mjs las pone desde .env al escribir el flujo en tu n8n. */
function motorIa() {
    const PROVEEDORES_IA = [] /*__CLAVES_IA__*/;
    async function consultarIa(helpers, mensajes, { temperatura = 0.3, maxTokens = 500, timeoutMs = 45000, presupuestoMs = 40000 } = {}) {
        const memoria = $getWorkflowStaticData('global');
        const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        const previo = memoria.iaEstado ?? { dia: hoy, p: {} };
        // Día nuevo: el conteo de usos vuelve a cero, las pausas siguen
        const est = previo.dia === hoy ? previo : { dia: hoy, p: Object.fromEntries(Object.entries(previo.p ?? {}).map(([k, v]) => [k, { ...v, usos: 0 }])) };
        memoria.iaEstado = est;
        // Tamaño aproximado de la consulta (tokens): una IA con límite menor (p. ej. Groq gratis: 8.000 por minuto) ni se intenta
        // (español ≈ 3,6 caracteres por token; cada IA puede pedir menos espacio de respuesta con maxTokens)
        const entrada = Math.ceil(JSON.stringify(mensajes).length / 3.6);
        const respuesta = (p) => Math.min(maxTokens, Number(p.maxTokens) > 0 ? Number(p.maxTokens) : maxTokens);
        const todas = PROVEEDORES_IA.filter((p) => p.clave && p.url && p.modelo);
        const caben = todas.filter((p) => !(Number(p.limite) > 0) || entrada + respuesta(p) <= Number(p.limite));
        const lista = caben.length ? caben : todas;
        if (!lista.length) throw new Error('No hay ninguna IA configurada (claves IA_* en .env → node herramientas/sincronizar-n8n.mjs --aplicar)');
        const ahora = Date.now();
        const e = (p) => (est.p[p.nombre] = est.p[p.nombre] ?? { usos: 0, hasta: 0, ultimo: null, motivo: null });
        const carga = (p) => e(p).usos / Math.max(1, Number(p.peso) || 1);
        const libres = lista.filter((p) => e(p).hasta <= ahora).sort((a, b) => carga(a) - carga(b));
        const enPausa = lista.filter((p) => e(p).hasta > ahora).sort((a, b) => e(a).hasta - e(b).hasta);
        const fallas = [];
        const inicio = Date.now();
        // Si todas están en pausa se intentan igual (por si ya se recargó alguna). Tope total: el cliente no espera más de ~40 s
        for (const p of [...libres, ...enPausa]) {
            const resta = presupuestoMs - (Date.now() - inicio);
            if (resta < 4000) { fallas.push('tiempo máximo agotado'); break; }
            const s = e(p);
            let codigo = 0, detalle = '';
            try {
                const r = await helpers.httpRequest({ method: 'POST', url: `${String(p.url).replace(/\/+$/, '')}/chat/completions`, json: true, timeout: Math.min(timeoutMs, resta),
                    headers: { Authorization: `Bearer ${p.clave}`, 'Content-Type': 'application/json' },
                    body: { model: p.modelo, messages: mensajes, temperature: temperatura, max_tokens: respuesta(p), ...(p.extra ?? {}) },
                    returnFullResponse: true, ignoreHttpStatusErrors: true });
                let j = r.body ?? {};
                if (typeof j === 'string') { try { j = JSON.parse(j); } catch { j = {}; } }
                const texto = String(j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                codigo = Number(r.statusCode) || 0;
                if (codigo >= 200 && codigo < 300 && texto) {
                    Object.assign(s, { usos: s.usos + 1, hasta: 0, ultimo: new Date(ahora).toISOString(), motivo: null, sinSaldo: false });
                    // Consumo por día y por IA (30 días): lo muestra node herramientas/ia.mjs --uso
                    const h = memoria.iaHistorial = memoria.iaHistorial ?? {};
                    (h[hoy] = h[hoy] ?? {})[p.nombre] = (h[hoy][p.nombre] ?? 0) + 1;
                    for (const k of Object.keys(h).sort().slice(0, -30)) delete h[k];
                    return { texto, ia: p.nombre };
                }
                detalle = String(j.error?.message ?? j.message ?? j[0]?.error?.message ?? (texto ? '' : 'respuesta vacía')).replace(/\s+/g, ' ').slice(0, 160);
            } catch (err) { detalle = String(err.message ?? err).slice(0, 160); }
            const sinSaldo = [401, 402, 403].includes(codigo) || /insufficient|balance|credit|billing|saldo|per ?day|daily/i.test(detalle);
            const lenta = !codigo && /timeout|ETIMEDOUT|aborted/i.test(detalle);
            const pausa = sinSaldo ? 6 * 3600e3 : codigo === 429 || codigo === 413 ? 2 * 60e3 : lenta ? 5 * 60e3 : codigo >= 500 || !codigo ? 60e3 : 10 * 60e3;
            Object.assign(s, { hasta: ahora + pausa, motivo: `${codigo || 'sin respuesta'} ${detalle}`.trim(), sinSaldo });
            fallas.push(`${p.nombre}: ${codigo || ''} ${detalle}`.replace(/\s+/g, ' ').trim());
        }
        throw new Error(fallas.join(' | '));
    }
}

// H1 · Chat del bot (reemplaza al "Agente IA"): mismo prompt de sistema, memoria de las últimas 4 idas y vueltas por cliente
async function iaBalanceada() {
    const datos = $input.first().json;
    const numero = String($('Normalizar mensaje').first().json.numero ?? '');
    const memoria = $getWorkflowStaticData('global');
    const chats = memoria.chatsIa = memoria.chatsIa ?? {};
    const ahora = Date.now();
    // Últimas 4 idas y vueltas (liviano para las IA gratuitas)
    const previo = chats[numero] && ahora - chats[numero].at < 24 * 3600e3 ? chats[numero].m.slice(-8).map((x) => ({ ...x, content: String(x.content).slice(0, 600) })) : [];
    const mensajes = [{ role: 'system', content: String(datos.sistema ?? '') }, ...previo, { role: 'user', content: String(datos.texto ?? '') }];
    try {
        // 20 s por IA: si una está lenta (saturada) se pasa a la siguiente sin dejar al cliente esperando
        const r = await consultarIa(this.helpers, mensajes, { temperatura: 0.3, maxTokens: 1200, timeoutMs: 20000, presupuestoMs: 40000 }); // 1500: los modelos que "piensan" gastan parte antes de responder
        const corto = (t) => String(t).slice(0, 900);
        chats[numero] = { at: ahora, m: [...previo, { role: 'user', content: corto(datos.texto ?? '') }, { role: 'assistant', content: corto(r.texto) }].slice(-8) };
        // Solo los 400 chats más recientes
        const claves = Object.keys(chats);
        if (claves.length > 400) claves.sort((a, b) => chats[a].at - chats[b].at).slice(0, claves.length - 400).forEach((k) => delete chats[k]);
        return [{ json: { output: r.texto, ia: r.ia } }];
    } catch (err) {
        return [{ json: { error: { message: String(err.message ?? err) } } }];
    }
}

// H2 · Extracción de accesos (pedido normal y combo) con la misma cadena de IA. Si ninguna responde → salida de error
async function extraerAccesosIa() {
    const r = await consultarIa(this.helpers, [{ role: 'user', content: String($input.first().json.prompt ?? '') }], { temperatura: 0, maxTokens: 300, timeoutMs: 45000 });
    return [{ json: { text: r.texto, ia: r.ia } }];
}
async function extraerAccesosComboIa() {
    const r = await consultarIa(this.helpers, [{ role: 'user', content: String($input.first().json.prompt ?? '') }], { temperatura: 0, maxTokens: 900, timeoutMs: 60000 });
    return [{ json: { text: r.texto, ia: r.ia } }];
}

/* ---------- H2) Atención humana: el historial del chat en Evolution decide ----------
   Los mensajes que envía el bot (API de Evolution) tienen ID "3EB0…"; los que escribes tú desde el celular, otro formato.
   Si escribiste a mano en este chat en las últimas horas_pausa_humano (12 por defecto), o el bot lo pasó a un asesor en las
   últimas __HORAS_PAUSA__ h, el bot no responde. "#bot" escrito por ti en el chat lo reactiva desde ese momento.
   (Si respondes desde WhatsApp Web, tus mensajes también tienen ID "3EB0…": ahí usa la etiqueta BAENAMORA.) */
function atencionHumana() {
    const msg = $('Normalizar mensaje').first().json;
    if (!msg || msg.ruta === 'triangulacion') return [{ json: msg }];
    const cfg = $('Config bot').first().json;
    const registros = ['Historial del chat', 'Historial del chat (lid)'].flatMap((nombre) => {
        try { return $(nombre).all().flatMap((i) => i.json?.messages?.records ?? []); } catch { return []; }
    });
    const vistos = new Set();
    const propios = registros.filter((r) => r?.key?.fromMe && !vistos.has(r.key.id) && vistos.add(r.key.id))
        .sort((a, b) => Number(b.messageTimestamp) - Number(a.messageTimestamp));
    const ahora = Date.now() / 1000;
    const horasHumano = Number(cfg.horas_pausa_humano) > 0 ? Number(cfg.horas_pausa_humano) : 12;
    const textoDe = (r) => String(r.message?.conversation ?? r.message?.extendedTextMessage?.text ?? '');
    let motivo = null;
    for (const r of propios) {
        const t = textoDe(r), edad = ahora - Number(r.messageTimestamp);
        const humano = !/^3EB0/i.test(String(r.key.id ?? ''));
        if (humano && /^#bot\b/i.test(t.trim())) break; // lo reactivaste: lo anterior ya no cuenta
        if (humano && edad < horasHumano * 3600) { motivo = 'humano'; break; }
        if (!humano && /Te comunico con un asesor/i.test(t) && edad < __HORAS_PAUSA__ * 3600) { motivo = 'asesor'; break; }
    }
    if (!motivo) return [{ json: msg }];
    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.pausados[msg.numero] = Date.now();
    return [];
}

/* ---------- H2b) Audios e imágenes (18/10/2026): modelos abiertos ----------
   Audio → texto con Whisper (Groq). Captura de un problema o imagen sin contexto → descripción con un modelo de visión
   abierto (Llama 3.2 Vision en NVIDIA; Gemma en OpenRouter de respaldo). Los comprobantes NO pasan por aquí: los valida
   una persona. Config bot → leer_medios = si lo enciende (apagado por defecto). Si ninguna IA responde, todo sigue como antes (pide escribir). */
function medioEntrante() {
    const no = [{ json: { leer: 'no' } }];
    const cfg = $('Config bot').first().json;
    const evento = $('Webhook Evolution').first().json;
    const b = evento.body ?? evento;
    if (String(b.event ?? '').toLowerCase().replace(/_/g, '.') !== 'messages.upsert') return no;
    if (String(cfg.bot_responde ?? 'si').trim().toLowerCase() === 'no' || String(cfg.leer_medios ?? 'no').trim().toLowerCase() !== 'si') return no; // se enciende a mano tras probarlo en vivo
    const d = Array.isArray(b.data) ? b.data[0] : b.data;
    const key = d?.key ?? {};
    if (key.fromMe || !key.id) return no;
    const enviado = Number(d.messageTimestamp ?? 0);
    if (enviado > 0 && Date.now() / 1000 - enviado > 20 * 60) return no;
    const original = String(key.remoteJid ?? '');
    const alterno = String(key.remoteJidAlt ?? key.senderPn ?? d?.senderPn ?? '');
    const jid = original.endsWith('@lid') && alterno.endsWith('@s.whatsapp.net') ? alterno : original;
    if (!jid.endsWith('@s.whatsapp.net')) return no;
    const numero = jid.split('@')[0];
    const proveedores = String(cfg.numero_proveedor ?? '').split(/[,;\s]+/).map((x) => soloDigitos(x)).filter(Boolean);
    if (proveedores.includes(numero) || numero === soloDigitos(cfg.numero_aviso_admin)) return no;
    const memoria = $getWorkflowStaticData('global');
    if (memoria.pausados?.[numero] || (memoria.vistos ?? []).includes(key.id)) return no;
    const etiquetas = memoria.etiquetas ?? { chats: {}, nombres: {} };
    const silencio = String(cfg.etiquetas_silencio ?? 'BAENAMORA').split(',').map((x) => normalizar(x).trim()).filter(Boolean);
    if ((etiquetas.chats[numero] ?? []).some((id) => silencio.includes(normalizar(etiquetas.nombres[id] ?? '').trim()))) return no;
    const crudo = d.message ?? {};
    const m = crudo.ephemeralMessage?.message ?? crudo.viewOnceMessageV2?.message ?? crudo.viewOnceMessage?.message ?? crudo;
    if (m.audioMessage) {
        if (Number(m.audioMessage.seconds) > 180) return no; // audios de más de 3 minutos: los escuchas tú
        return [{ json: { leer: 'si', tipo: 'audio', wamid: key.id, mimetype: String(m.audioMessage.mimetype ?? 'audio/ogg') } }];
    }
    if (!m.imageMessage) return no;
    // Mismas reglas que "Normalizar mensaje": lo que parece comprobante va directo a revisión humana, sin IA
    const ahora = Date.now();
    const hace = (mapa, horas) => ahora - (typeof mapa?.[numero] === 'number' ? mapa[numero] : 0) < horas * 3600e3;
    const limpio = normalizar(String(m.imageMessage.caption ?? '')).replace(/[^a-z0-9\s]/g, ' ');
    if (/\b(pago|pague|pagado|pagando|comprobante|transferencia|transferi|consignacion|consigne|nequi|daviplata|breb|llave|abono|abone|recibo)\b/.test(limpio) || hace(memoria.esperandoPago, 48)) return no;
    const problema = /\b(error|falla|fallo|no funciona|no me deja|no puedo|no abre|me sale|me aparece|bloqueo|bloqueado|ayuda)\b/.test(limpio) || hace(memoria.soporte, 2);
    if (!problema && hace(memoria.conversacion, 72)) return no;
    return [{ json: { leer: 'si', tipo: 'imagen', wamid: key.id, mimetype: String(m.imageMessage.mimetype ?? 'image/jpeg') } }];
}

function leerTranscripcion() {
    const previo = $('Leer medio (IA)').first().json;
    const r = $input.first().json ?? {};
    const texto = String(r.text ?? '').trim();
    if (texto) return [{ json: { wamid: previo.wamid, tipo: 'audio', transcripcion: texto.slice(0, 1000), ia: 'Whisper (Groq)' } }];
    return [{ json: { wamid: previo.wamid, tipo: 'audio', error: String(r.error?.message ?? r.message ?? 'Whisper sin respuesta').slice(0, 160) } }];
}

async function leerMedio() {
    const pedido = $('Medio entrante').first().json;
    const d = $input.first().json ?? {};
    const salida = { wamid: pedido.wamid, tipo: pedido.tipo };
    if (!d.base64) return [{ json: { ...salida, tipo: 'sin_archivo', error: 'no se pudo descargar' } }];
    const ias = PROVEEDORES_IA.filter((p) => p.clave && p.url);
    const pedir = (o) => this.helpers.httpRequest({ method: 'POST', returnFullResponse: true, ignoreHttpStatusErrors: true, ...o });
    const leerJson = (r) => { let j = r.body ?? {}; if (typeof j === 'string') { try { j = JSON.parse(j); } catch { j = {}; } } return j; };
    const fallas = [];
    if (pedido.tipo === 'audio') {
        // El audio NO se envía desde aquí: pasar el archivo a helpers.httpRequest desde un Code satura n8n.
        // Sale como binario al nodo HTTP "Whisper (audio)" (multipart nativo de n8n) con la clave de Groq.
        const groq = ias.find((p) => /groq\.com/i.test(p.url));
        if (!groq) return [{ json: { ...salida, tipo: 'sin_whisper', error: 'sin Whisper (falta la clave de Groq)' } }];
        const tipo = String(d.mimetype || pedido.mimetype || 'audio/ogg').split(';')[0];
        const extension = tipo.includes('ogg') ? 'ogg' : tipo.includes('mp4') ? 'm4a' : tipo.includes('wav') ? 'wav' : 'mp3';
        return [{ json: { ...salida, whisper: { url: `${String(groq.url).replace(/\/+$/, '')}/audio/transcriptions`, clave: groq.clave } },
            binary: { audio: { data: String(d.base64), mimeType: tipo, fileName: `audio.${extension}` } } }];
    }
    // Imagen: modelos de visión abiertos, en orden
    const nvidia = ias.find((p) => /nvidia\.com/i.test(p.url)), openrouter = ias.find((p) => /openrouter\.ai/i.test(p.url));
    const cadena = [
        nvidia && { p: nvidia, modelo: 'meta/llama-3.2-11b-vision-instruct', nombre: 'Llama 3.2 Vision 11B' }, // el más rápido (~10 s)
        nvidia && { p: nvidia, modelo: 'meta/llama-3.2-90b-vision-instruct', nombre: 'Llama 3.2 Vision 90B' },
        openrouter && { p: openrouter, modelo: 'google/gemma-4-31b-it:free', nombre: 'Gemma 4' },
    ].filter(Boolean);
    const instruccion = 'Eres soporte técnico de una tienda de streaming, licencias y tecnología. Describe en español, en máximo 3 frases, qué muestra esta imagen: la app o el equipo, y copia textual solo los mensajes de error o advertencia que se lean (los botones, menús y precios no son errores; si no hay ninguno, no lo menciones). Si es un comprobante de pago, responde solo "Comprobante de pago". No inventes nada que no se vea.';
    const tipo = String(d.mimetype || pedido.mimetype || 'image/jpeg').split(';')[0];
    const inicio = Date.now();
    for (const c of cadena) {
        if (Date.now() - inicio > 45000) break;
        try {
            const r = await pedir({ url: `${String(c.p.url).replace(/\/+$/, '')}/chat/completions`, json: true, timeout: 25000,
                headers: { Authorization: `Bearer ${c.p.clave}`, 'Content-Type': 'application/json' },
                body: { model: c.modelo, max_tokens: 220, temperature: 0.1, messages: [{ role: 'user', content: [{ type: 'text', text: instruccion }, { type: 'image_url', image_url: { url: `data:${tipo};base64,${d.base64}` } }] }] } });
            const texto = String(leerJson(r).choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/\s+/g, ' ').trim();
            if (Number(r.statusCode) < 300 && texto) return [{ json: { ...salida, descripcion: texto.slice(0, 500), ia: c.nombre } }];
            fallas.push(`${c.nombre} ${r.statusCode}`);
        } catch (err) { fallas.push(`${c.nombre}: ${String(err.message ?? err).slice(0, 80)}`); }
    }
    return [{ json: { ...salida, error: fallas.join(' | ') || 'sin IA de visión configurada' } }];
}

/* ---------- H4) Rastreo de envíos (WO-047): guías abiertas → transportadora (vía el rastreo del proveedor) ----------
   Una sesión por corrida (cookie + token del formulario) y una consulta por guía. Solo se guarda lo que responde;
   el aviso al cliente lo encola la base cuando el estado cambia (una vez por estado). */
async function consultarRastreos() {
    const guias = $input.all().map((i) => i.json).filter((x) => x && x.referencia && x.guia);
    if (!guias.length) return [];
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
    const base = 'https://emprendered.com.co';
    const pagina = await this.helpers.httpRequest({ url: `${base}/catalogo`, headers: { 'User-Agent': UA, Accept: 'text/html' }, returnFullResponse: true, timeout: 20000 });
    const galletas = [].concat(pagina.headers?.['set-cookie'] ?? []).map((c) => String(c).split(';')[0]).join('; ');
    const token = /name="csrf-token" content="([^"]+)"/.exec(String(pagina.body ?? ''))?.[1] ?? '';
    const limpiarTexto = (t) => String(t ?? '').replace(/emprende\s*red|emprendered/gi, 'DC Tecnology').replace(/\s+/g, ' ').trim().slice(0, 300);
    const salida = [];
    for (const g of guias.slice(0, 40)) {
        try {
            const r = await this.helpers.httpRequest({ method: 'POST', url: `${base}/track-order`, json: true, timeout: 20000,
                headers: { 'User-Agent': UA, Cookie: galletas, 'X-CSRF-TOKEN': token, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: { order_code: g.guia } });
            const d = r?.data ?? null;
            if (!d || !d.status) continue; // la transportadora aún no la registra
            const historial = (Array.isArray(d.history) ? d.history : []).slice(0, 30)
                .map((h) => ({ fecha: String(h.date ?? '').slice(0, 25), estado: limpiarTexto(h.status), detalle: limpiarTexto(h.description), novedad: limpiarTexto(h.novelty) }));
            salida.push({ json: { args: { p_referencia: g.referencia, p_estado: limpiarTexto(d.status).toUpperCase(), p_detalle: limpiarTexto(d.statusDetail),
                p_transportadora: limpiarTexto(d.carrier?.name ?? d.carrier), p_historial: historial } } });
        } catch { /* la siguiente corrida lo intenta de nuevo */ }
    }
    return salida;
}

/* ---------- H5) Estados "¡Volvió!" (WO-050): uno por vez, máximo 2 al día, de día (lun–vie 9–19, sáb 9–15) ---------- */
function estadoPendiente() {
    const memoria = $getWorkflowStaticData('global');
    const cola = memoria.estadosPendientes ?? [];
    if (!cola.length) return [];
    const local = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    if (local.getDay() === 0 || local.getHours() < 9 || local.getHours() >= (local.getDay() === 6 ? 15 : 19)) return [];
    const hoy = local.toDateString();
    memoria.estadosHoy = memoria.estadosHoy?.dia === hoy ? memoria.estadosHoy : { dia: hoy, n: 0 };
    if (memoria.estadosHoy.n >= 2) return [];
    // Vigentes (menos de 2 días); si hay varios, se juntan en uno solo
    const vigentes = cola.filter((x) => Date.now() - (x.at ?? 0) < 2 * 864e5);
    memoria.estadosPendientes = [];
    if (!vigentes.length) return [];
    memoria.estadosHoy.n += 1;
    if (vigentes.length === 1 && vigentes[0].imagen) return [{ json: { tipo: 'image', contenido: vigentes[0].imagen, texto: vigentes[0].texto } }];
    const texto = vigentes.length === 1 ? vigentes[0].texto
        : `🔔 ¡Volvieron!\n${vigentes.slice(0, 6).map((x) => `• ${String(x.producto).slice(0, 60)}`).join('\n')}\n🛒 www.dctecnology.xyz · 💬 322 328 4622`;
    return [{ json: { tipo: 'text', contenido: texto, texto } }];
}
function listaContactosEstado() {
    const pedido = $('Estado pendiente').first().json;
    const lista = [...new Set($input.all().map((i) => i.json).filter((c) => c && c.pushName && /^\d{8,15}@s\.whatsapp\.net$/.test(String(c.remoteJid ?? ''))).map((c) => c.remoteJid))];
    if (!lista.length) return [];
    return [{ json: pedido.tipo === 'image'
        ? { type: 'image', content: pedido.contenido, caption: pedido.texto, statusJidList: lista }
        : { type: 'text', content: pedido.contenido, backgroundColor: '#C8102E', font: 1, statusJidList: lista } }];
}

/* ---------- H3) Renovaciones (WO-044): avisa 3 días antes de que venza el plan ----------
   Duración: "N días" en la variante, "N mes(es)" × 30, "año" × 365; streaming sin duración = 30 días. Solo cuentas
   de streaming y licencias/apps con duración. Horario (Ley 2300 de 2023): lun–vie 9 a. m.–7 p. m., sábado 9 a. m.–3 p. m. */
function renovaciones() {
    const ahora = Date.now();
    const local = new Date(new Date(ahora).toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    // Ley 2300 de 2023: mensajes comerciales lun–vie hasta las 7 p. m. y sábados hasta las 3 p. m.; domingos no (festivos: la cola, wo-048)
    if (local.getDay() === 0 || local.getHours() < 9 || local.getHours() >= (local.getDay() === 6 ? 15 : 19)) return [];
    const filas = $input.all().map((i) => i.json).filter((x) => x && x.referencia && x.entregado_at);
    const cat = __KB__.catalogo ?? [];
    const salida = [];
    for (const f of filas) {
        const p = cat.find((x) => normalizar(x.nombre) === normalizar(f.producto));
        if (!p || !['streaming', 'licencias'].includes(p.tipo)) continue;
        const v = normalizar(f.variante ?? '');
        let dias = null;
        const d = /(\d+)\s*dias?\b/.exec(v), m = /(\d+)\s*mes(es)?\b/.exec(v);
        if (d) dias = Number(d[1]); else if (m) dias = Number(m[1]) * 30; else if (/\bano\b|anual/.test(v)) dias = 365;
        else if (/\bmes\b|mensual/.test(v)) dias = 30;
        else if (p.tipo === 'streaming') dias = 30;
        if (!dias || dias < 7) continue;
        const vence = new Date(f.entregado_at).getTime() + dias * 864e5;
        const faltan = (vence - ahora) / 864e5;
        if (faltan > 3 || faltan < -1) continue;
        const texto = new Date(vence).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });
        salida.push({ json: { args: { p_referencia: f.referencia, p_vence: texto } } });
    }
    return salida.slice(0, 20); // máx. 20 por ronda: la cola los envía de a uno con pausa
}

/* ---------- H4) Resumen del día (WO-052 · T01): a las 8 p. m. de Bogotá, una vez al día, al director ----------
   «Hora del resumen» deja pasar solo entre 20:00 y 20:29 y si hoy no se envió; «Texto del resumen» arma el mensaje
   con resumen_ventas_dia(). Si la base aún no tiene wo-052, avisa UNA vez «aplica wo-052». */
function horaResumen() {
    const memoria = $getWorkflowStaticData('global');
    const ahora = new Date(Date.now());
    const local = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const hoy = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    if (local.getHours() !== 20 || local.getMinutes() >= 30 || memoria.resumenDia === hoy) return [];
    return [{ json: { hoy } }];
}

function textoResumen() {
    const memoria = $getWorkflowStaticData('global');
    const numero = soloDigitos($('Config bot').first().json.numero_aviso_admin);
    const { hoy } = $('Hora del resumen').first().json;
    const r = $input.first().json ?? {};
    memoria.resumenDia = hoy;
    if (!numero) return [];
    if (typeof r.pedidos !== 'number') {
        if (memoria.resumenSinSql) return [];
        memoria.resumenSinSql = hoy;
        return [{ json: { numero, texto: '🧾 No pude armar el resumen de ventas de hoy: aplica supabase/wo-052-resumen-dia.sql en Supabase.' } }];
    }
    delete memoria.resumenSinSql;
    const fecha = new Date(`${hoy}T12:00:00-05:00`).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });
    const cobrar = r.por_cobrar ?? {};
    const lineas = ['🧾 *Resumen de hoy · DC Tecnology*', fecha, ''];
    if (!r.pedidos) lineas.push('Hoy no hubo pedidos nuevos.');
    else lineas.push(
        `• Pedidos: ${r.pedidos} (pagados ${r.pagados}, entregados ${r.entregados})`,
        `• Ventas: ${cop(r.venta)}`,
        `• Costo: ${cop(r.costo)}`,
        `• Margen: ${cop(r.margen)}`);
    if (Number(cobrar.cantidad)) lineas.push(`• Por cobrar en la web (24 h): ${cobrar.cantidad} por ${cop(cobrar.total)}`);
    if (Array.isArray(r.top) && r.top.length) lineas.push('', '*Más vendidos*', ...r.top.map((x, i) => `${i + 1}. ${x.producto} × ${x.cantidad} (${cop(x.venta)})`));
    lineas.push('', 'Detalle en el panel → Finanzas.');
    return [{ json: { numero, texto: lineas.join('\n') } }];
}

/* ---------- I) Entrega manual (WO-042): accesos que envió ANC → cliente, con la marca DC Tecnology ----------
   Solo entrega si el usuario y la clave aparecen TEXTUALES en el mensaje y la confianza es ≥ 0,9 (si no, te pregunta). */
async function entregaManual() {
    const { t, texto, numero_admin: admin } = $input.first().json;
    const memoria = $getWorkflowStaticData('global');
    memoria.entregados = memoria.entregados || {};
    if (memoria.entregados[t.referencia]) return [{ json: { accion: 'avisar', numero: admin, texto: `*#${t.referencia}* ya fue entregado.` } }];
    // Pines virtuales: un solo código para canjear (sin usuario ni clave)
    if (/\bPIN\b/i.test(`${t.producto} ${t.variante ?? ''}`)) {
        const promptPin = ['Extrae el código del PIN virtual del siguiente mensaje de un proveedor.', `Producto esperado: ${t.producto}${t.variante ? ` (${t.variante})` : ''}.`,
            'Responde SOLO con un JSON, sin texto adicional: {"pin":"","confianza":0.0}', 'Copia el código EXACTAMENTE como aparece (mismos guiones, letras y números).',
            '"confianza" (0 a 1): qué tan seguro estás de que es el código completo de este producto.', 'Mensaje:', '"""', String(texto).slice(0, 2000), '"""'].join('\n');
        let dp = {};
        try {
            const r = await consultarIa(this.helpers, [{ role: 'user', content: promptPin }], { temperatura: 0, maxTokens: 300, timeoutMs: 30000 });
            dp = JSON.parse(String(r.texto).replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
        } catch { dp = {}; }
        const pin = String(dp.pin ?? '').trim();
        if (pin.length < 6 || (Number(dp.confianza) || 0) < 0.9 || !String(texto).includes(pin)) {
            return [{ json: { accion: 'avisar', numero: admin, texto: [`⚠️ No pude leer con seguridad el PIN para *#${t.referencia}* (${t.producto}). No le envié nada al cliente.`,
                `Escríbelo así: *#entregar ${t.referencia} CODIGO*`].join('\n') } }];
        }
        const mensajePin = String(__KB__.plantillas.entrega_pin).replace('{pin}', () => pin).replace('{pedido}', () => t.referencia).replace('{producto}', () => limpiar(t.producto));
        memoria.entregados[t.referencia] = Date.now();
        return [
            { json: { accion: 'avisar', numero: t.cliente, texto: mensajePin } },
            { json: { accion: 'panel', rpc: 'entregar_manual', args: { p_referencia: t.referencia, p_estado: 'ENTREGADO', p_clave: `PIN ${pin}` }, referencia: t.referencia } },
            { json: { accion: 'avisar', numero: admin, texto: `✅ *#${t.referencia} entregado* a +${t.cliente}${t.cliente_nombre ? ` (${t.cliente_nombre})` : ''} · ${t.producto}.` } },
        ];
    }
    const prompt = ['Extrae los datos de acceso del siguiente mensaje de un proveedor de cuentas digitales.',
        `Producto esperado: ${t.producto}${t.variante ? ` (${t.variante})` : ''}.`,
        'Responde SOLO con un JSON, sin texto adicional: {"usuario":"","clave":"","perfil":"","pin":"","confianza":0.0}',
        'Copia usuario y clave EXACTAMENTE como aparecen (mismas mayúsculas, números y símbolos). Si un dato no aparece, déjalo vacío.',
        '"confianza" (0 a 1): qué tan seguro estás de que son los accesos completos de este producto.', 'Mensaje:', '"""', String(texto).slice(0, 2000), '"""'].join('\n');
    let d = {};
    try {
        const r = await consultarIa(this.helpers, [{ role: 'user', content: prompt }], { temperatura: 0, maxTokens: 400, timeoutMs: 30000 });
        d = JSON.parse(String(r.texto).replace(/```(?:json)?/g, '').match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    } catch { d = {}; }
    const limpio = (v) => String(v ?? '').trim();
    const c = { usuario: limpio(d.usuario), clave: limpio(d.clave), perfil: limpio(d.perfil), pin: limpio(d.pin), confianza: Number(d.confianza) || 0 };
    const textual = (v) => !v || String(texto).includes(v);
    if (!c.usuario || !c.clave || c.confianza < 0.9 || ![c.usuario, c.clave, c.perfil, c.pin].every(textual)) {
        return [{ json: { accion: 'avisar', numero: admin, texto: [`⚠️ No pude leer con seguridad los accesos para *#${t.referencia}* (${t.producto}). No le envié nada al cliente.`,
            `Escríbelos así: *#entregar ${t.referencia} correo / clave* (y perfil o PIN si aplica).`].join('\n') } }];
    }
    const exactos = { usuario: c.usuario, clave: c.clave, perfil: c.perfil, pin: c.pin };
    const otros = { pedido: t.referencia, producto: t.producto };
    const mensaje = String(__KB__.plantillas.entrega_credenciales).split('\n').map((linea) => {
        let vacia = false;
        const r = linea.replace(/\{(\w+)\}/g, (_, k) => { const v = k in exactos ? String(exactos[k] ?? '').trim() : limpiar(otros[k]); if (!v) vacia = true; return v; });
        return vacia ? null : r;
    }).filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    const clavePanel = [c.usuario, c.clave].join(' / ') + (c.perfil ? ` · perfil ${c.perfil}` : '') + (c.pin ? ` · PIN ${c.pin}` : '');
    memoria.entregados[t.referencia] = Date.now();
    return [
        { json: { accion: 'avisar', numero: t.cliente, texto: mensaje } },
        { json: { accion: 'panel', rpc: 'entregar_manual', args: { p_referencia: t.referencia, p_estado: 'ENTREGADO', p_clave: clavePanel }, referencia: t.referencia } },
        { json: { accion: 'avisar', numero: admin, texto: `✅ *#${t.referencia} entregado* a +${t.cliente}${t.cliente_nombre ? ` (${t.cliente_nombre})` : ''} · ${t.producto}. Garantía activa.` } },
    ];
}

// I2 · Resultado de #ok / #no de un pago web
function resultadoPagoWeb() {
    const p = $('Enrutar evento').all().map((i) => i.json).find((x) => x.accion === 'pago_web') ?? {};
    const r = Array.isArray($input.first().json) ? $input.first().json[0] : ($input.first().json ?? {});
    const e = r.error ?? $input.first().json.error;
    if (e) return [{ json: { numero: p.numero, texto: `⚠️ No pude ${p.aprobar ? 'aprobar' : 'rechazar'} *#${p.codigo}* desde aquí (${String(e.message ?? e).slice(0, 120)}). ¿Aplicaste supabase/wo-042-pedidos-whatsapp.sql? Mientras tanto hazlo en el panel.` } }];
    if (r.mensaje === 'NO_EXISTE') return [{ json: { numero: p.numero, texto: `No encuentro *#${p.codigo}* ni como pedido web ni como pedido por chat abierto.` } }];
    if (!r.ok) return [{ json: { numero: p.numero, texto: `*#${p.codigo}*: ${r.mensaje}` } }];
    return [{ json: { numero: p.numero, texto: p.aprobar
        ? `✅ *#${p.codigo} aprobado* (${cop(r.total)}). En un minuto te llega el aviso con qué comprar en ANC; el cliente ya ve su pago validado.`
        : `❌ *#${p.codigo} rechazado*. El cliente ve el motivo en Mis pedidos y puede subir otro comprobante.` } }];
}

// I3 · Si una llamada al panel falla (p. ej. falta wo-042) te avisa; si sale bien, silencio
function resultadoPanel() {
    const cfg = $('Config bot').first().json;
    const admin = soloDigitos(cfg.numero_aviso_admin);
    const pedido = $('Salida al panel').first().json;
    const filas = $input.all().map((i) => i.json);
    const r = filas[0] ?? {};
    // WO-043 · Stock de pines
    if (pedido.tipo === 'stock_resumen') {
        if (r.error) return admin ? [{ json: { numero: admin, texto: `⚠️ No pude leer el stock (${String(r.error.message ?? r.error).slice(0, 120)}). ¿Aplicaste supabase/wo-043-stock-pines.sql?` } }] : [];
        const nombres = Object.fromEntries((__KB__.catalogo ?? []).map((p) => [p.id, p.nombre]));
        const lista = filas.filter((x) => x && x.producto_id);
        return [{ json: { numero: pedido.numero, texto: lista.length
            ? ['📦 *Tu stock de pines*', ...lista.map((x) => `${x.disponibles <= 2 ? '⚠️' : '•'} ${nombres[x.producto_id] ?? x.producto_id} · ${x.variante}: *${x.disponibles}* (entregados en 30 días: ${x.entregados_30d})`), '', 'Cargar: *#stock roblox 25000* y los códigos debajo, uno por línea.'].join('\n')
            : '📦 Aún no tienes pines en stock. Cárgalos así:\n*#stock roblox 25000*\nCODIGO-1\nCODIGO-2' } }];
    }
    if (pedido.tipo === 'cargar_stock') {
        if (r.error) return [{ json: { numero: pedido.numero, texto: `⚠️ No cargué los códigos (${String(r.error.message ?? r.error).slice(0, 120)}). ¿Aplicaste supabase/wo-043-stock-pines.sql?` } }];
        return [{ json: { numero: pedido.numero, texto: [`✅ *Stock cargado* · ${pedido.producto}`, `Nuevos: *${r.cargados ?? 0}*${r.repetidos ? ` · repetidos ignorados: ${r.repetidos}` : ''}`, `Disponibles ahora: *${r.disponibles ?? '?'}*`, '', 'Cuando confirmes un pago con *#ok*, el código sale solo al cliente.'].join('\n') } }];
    }
    if (pedido.tipo === 'registrar_guia') {
        if (r.error) return [{ json: { numero: pedido.numero, texto: `⚠️ No guardé la guía (${String(r.error.message ?? r.error).slice(0, 120)}). ¿Aplicaste supabase/wo-047-proveedor-y-rastreo.sql?` } }];
        if (!r.ok) return [{ json: { numero: pedido.numero, texto: `⚠️ ${r.mensaje ?? 'No guardé la guía.'}` } }];
        return [
            { json: { numero: pedido.numero, texto: `✅ ${r.mensaje}` } },
            ...(r.destino ? [{ json: { numero: r.destino, texto: [`📦 *Tu pedido #${pedido.referencia} ya fue despachado* · DC Tecnology`, '', `🔢 Guía: *${pedido.guia}*`, 'Te aviso por aquí cada vez que cambie su estado.', '', 'Síguelo en *www.dctecnology.xyz* → Pedidos.'].join('\n') } }] : []),
        ];
    }
    if (pedido.tipo === 'entregar_desde_stock') {
        if (!r.error && r.ok && r.codigo) {
            const texto = String(__KB__.plantillas.entrega_pin).replace('{pin}', () => r.codigo).replace('{pedido}', () => pedido.referencia).replace('{producto}', () => limpiar(pedido.producto));
            return [
                { json: { numero: pedido.cliente, texto } },
                ...(admin ? [{ json: { numero: admin, texto: [`⚡ *#${pedido.referencia} entregado desde tu stock* a +${pedido.cliente}${pedido.cliente_nombre ? ` (${limpiar(pedido.cliente_nombre)})` : ''}`, `📦 ${pedido.producto}`,
                    r.quedan <= 2 ? `⚠️ Te quedan *${r.quedan}*: recarga el stock (*#stock*).` : `Quedan ${r.quedan} en stock.`].join('\n') } }] : []),
            ];
        }
        if (!r.error && r.mensaje === 'SIN_STOCK') return admin ? [{ json: { numero: admin, texto: [`📦 *#${pedido.referencia}*: no hay ${pedido.producto} en tu stock. El pago quedó confirmado.`, `👉 ${pedido.sin_stock}`].join('\n') } }] : [];
    }
    const fila = Array.isArray(r) ? r[0] : r;
    if (!r.error && fila?.ok !== false) return [];
    return admin ? [{ json: { numero: admin, texto: `⚠️ El panel no registró *#${pedido.referencia ?? ''}* (${String(r.error?.message ?? fila?.mensaje ?? 'sin respuesta').slice(0, 140)}). Márcalo a mano; si dice que no existe la función, aplica supabase/wo-042-pedidos-whatsapp.sql.` } }] : [];
}

/* ---------- J) Precios de ANC cada 6 h (WO-042): precio de venta = tienda de ANC + margen (anc_margen, 0 por defecto) ---------- */
async function leerPreciosAnc() {
    const cfg = $('Config bot').first().json;
    const margen = Number(cfg.anc_margen) > 0 ? Number(cfg.anc_margen) : 0;
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
    const base = 'https://allnecessarycolombia.com/productos/';
    const productos = [];
    for (let n = 1; n <= 10; n++) {
        let pagina;
        try { pagina = String(await this.helpers.httpRequest({ url: n === 1 ? base : `${base}page/${n}/`, timeout: 20000, headers: { 'User-Agent': UA } })); } catch { break; }
        const antes = productos.length;
        const re = /data-variants="([^"]+)"[\s\S]*?product-item-name-\d+">([^<]+)/g;
        for (let m; (m = re.exec(pagina));) {
            let variantes = [];
            try { variantes = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')); } catch { continue; }
            productos.push({ nombre: m[2].trim(), variantes: variantes.map((v) => ({ nombre: [v.option0, v.option1, v.option2].filter(Boolean).join(' / '), precio: Number(v.price_number) || null, disponible: v.available !== false, stock: Number.isFinite(v.stock) ? v.stock : null })) });
        }
        if (productos.length === antes) break;
    }
    if (!productos.length) throw new Error('no pude leer la tienda de ANC');
    const plano = (x) => normalizar(x).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const sinDias = (x) => plano(x).replace(/\b\d+ dias?\b/g, '').replace(/\s+/g, ' ').trim();
    const items = [];
    // Duración: si ANC cambia los días del plan (p. ej. 26 → 30) se te avisa; el nombre que ve el cliente lo cambias tú
    const dias = (x) => { const d = /\b(\d+)\s*d[ií]as?\b/i.exec(String(x ?? '')); return d ? Number(d[1]) : null; };
    const duraciones = [];
    // WO-050: disponibilidad (agotado en su tienda o el plan ya no está) para mostrar "Agotado" y avisar cuando vuelva
    const disponibilidad = [];
    const faltan = [];
    for (const m of __ANC_MAPA__) {
        const p = productos.find((x) => plano(x.nombre) === plano(m.anc_producto));
        const v = p?.variantes.find((x) => plano(x.nombre) === plano(m.anc_plan)) ?? p?.variantes.find((x) => sinDias(x.nombre) === sinDias(m.anc_plan));
        if (!v) { faltan.push({ producto_id: m.id, variante: m.variante, agotado: true }); continue; }
        // WO-051: cantidad que publica ANC por plan (null = sin límite; 0 = agotado)
        disponibilidad.push({ producto_id: m.id, variante: m.variante, agotado: v.disponible === false || v.stock === 0, stock: v.disponible === false ? 0 : v.stock });
        if (!v?.precio) continue;
        const nuestros = dias(m.variante), suyos = dias(v.nombre);
        if (nuestros && suyos && nuestros !== suyos) duraciones.push({ producto_id: m.id, variante: m.variante, nuestros, suyos, plan: v.nombre });
        items.push({ producto_id: m.id, variante: m.variante, costo: v.precio, precio: Math.round((v.precio * (1 + margen / 100)) / 100) * 100, plan: `${m.anc_producto} · ${m.anc_plan}` });
    }
    // Lo que ya no está en su tienda cuenta como agotado, solo si la lectura fue completa (≥ 80 % encontrado)
    if (disponibilidad.length >= (disponibilidad.length + faltan.length) * 0.8) disponibilidad.push(...faltan);
    return [{ json: { items, leidos: productos.length, duraciones, disponibilidad } }];
}
function resultadoPreciosAnc() {
    const cfg = $('Config bot').first().json;
    const admin = soloDigitos(cfg.numero_aviso_admin);
    const lectura = $('Leer precios ANC').first().json;
    const r0 = $('Sincronizar precios ANC').first().json;
    const r = Array.isArray(r0) ? r0[0] : r0;
    // WO-050: lo que se agotó o volvió en ANC (sin wo-050 aplicado, esto llega con error y se ignora)
    const d0 = $input.first().json;
    const disp = d0?.error ? {} : (Array.isArray(d0) ? d0[0] : d0) ?? {};
    const memoria = $getWorkflowStaticData('global');
    const ahora = Date.now();
    if (lectura.error || r0.error) {
        const causa = lectura.error ? `No pude leer la tienda de ANC: ${String(lectura.error.message ?? lectura.error).slice(0, 120)}` : `La base no aceptó los precios: ${String(r0.error.message ?? r0.error).slice(0, 120)} (¿aplicaste wo-042?)`;
        const hora = Number(new Date(ahora).toLocaleString('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false })) % 24;
        if (!admin || hora < 7 || hora >= 21 || ahora - (memoria.avisoPreciosAnc || 0) < 24 * 3600e3) return [];
        memoria.avisoPreciosAnc = ahora;
        return [{ json: { numero: admin, texto: `⚠️ *Precios de ANC*\n${causa}\nLos precios quedan como estaban; reintento en 6 horas.` } }];
    }
    const cambios = (r.cambios ?? []);
    const repuestosAnc = Array.isArray(disp.repuestos) ? disp.repuestos : [];
    const agotadosAnc = Array.isArray(disp.agotados) ? disp.agotados : [];
    if (repuestosAnc.length) {
        memoria.estadosPendientes = [...(memoria.estadosPendientes ?? []), { producto: repuestosAnc.map((x) => x.producto).join(', '), imagen: null,
            texto: `🔔 ¡Volvió! ${[...new Set(repuestosAnc.map((x) => x.producto))].join(' · ')}\nPídelo hoy y te llega por WhatsApp.\n🛒 www.dctecnology.xyz · 💬 322 328 4622`, at: ahora }].slice(-20);
    }
    const avisoDisp = (repuestosAnc.length || agotadosAnc.length) ? ['', '📦 *Disponibilidad en ANC*', ...repuestosAnc.map((x) => `• 🔔 Volvió: ${x.producto} · ${x.variante}`), ...agotadosAnc.map((x) => `• ⛔ Agotado: ${x.producto} · ${x.variante} (en la tienda sale «Agotado»)`)] : [];
    // Duración distinta a la que anuncias (una vez al día por plan): el cliente debe recibir lo que dice el nombre
    memoria.avisoDuracion = memoria.avisoDuracion || {};
    const duraciones = (lectura.duraciones ?? []).filter((d) => ahora - (memoria.avisoDuracion[d.producto_id + d.variante] || 0) > 24 * 3600e3);
    duraciones.forEach((d) => { memoria.avisoDuracion[d.producto_id + d.variante] = ahora; });
    const avisoDias = duraciones.length ? ['', '📅 *La duración cambió en ANC*', ...duraciones.map((d) => `• ${d.producto_id} · ${d.variante}: tú anuncias *${d.nuestros} días* y ANC ahora entrega *${d.suyos} días* («${d.plan}»).`),
        'Actualiza el nombre del plan (productos.json, equivalencias y la base) para que el cliente reciba lo que promete.'] : [];
    if ((!cambios.length && !avisoDias.length && !avisoDisp.length) || !admin) return [];
    const nombre = (c) => `${c.producto_id} · ${c.variante}`;
    return [{ json: { numero: admin, texto: [...(cambios.length ? ['💲 *Precios sincronizados con ANC*'] : []),
        ...cambios.filter((c) => c.aplicado).map((c) => `• ${nombre(c)}: ${cop(c.antes)} → *${cop(c.ahora)}*`),
        ...cambios.filter((c) => !c.aplicado).map((c) => `• ⚠️ ${nombre(c)}: ANC muestra ${cop(c.ahora)} (antes ${cop(c.antes)}). NO lo apliqué: revísalo en el panel.`),
        ...avisoDias,
        ...avisoDisp,
    ].join('\n').trim() } }];
}

/* ---------- G) Salud del sistema cada 30 min: te avisa solo cuando algo CAMBIA (cae o vuelve) ----------
   Portal de ANC, su tienda pública (respaldo de costos) y la tienda web con el conocimiento del bot.
   Dos fallas seguidas para avisar (evita falsas alarmas por un corte de segundos). */
async function revisarSalud() {
    const cfg = $('Config bot').first().json;
    const memoria = $getWorkflowStaticData('global');
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
    const probar = async (url, valida) => {
        try {
            const r = await this.helpers.httpRequest({ url, timeout: 20000, headers: { 'User-Agent': UA }, returnFullResponse: true, ignoreHttpStatusErrors: true, json: false });
            const cuerpo = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? '');
            if (r.statusCode < 200 || r.statusCode >= 300) return { ok: false, detalle: `respondió ${r.statusCode}` };
            return valida(cuerpo) ? { ok: true } : { ok: false, detalle: 'responde, pero sin el contenido esperado' };
        } catch (e) { return { ok: false, detalle: String(e.message ?? e).slice(0, 120) }; }
    };
    const kbValido = (h) => { try { const j = JSON.parse(h); return Boolean(j.menu && j.catalogo); } catch { return false; } };
    const revisiones = [
        { clave: 'anc', nombre: 'Portal de ANC (ancpagos.com)', url: `${String(cfg.anc_url || 'https://ancpagos.com').replace(/\/+$/, '')}/`, valida: (h) => h.includes('CATALOGO_INICIAL_IDX'),
            cae: 'Las compras web al proveedor quedan en revisión manual, con el costo de referencia de su tienda pública.', vuelve: 'Las compras web al proveedor vuelven a ser automáticas.' },
        { clave: 'tienda_anc', nombre: 'Tienda pública de ANC (allnecessarycolombia.com)', url: 'https://allnecessarycolombia.com/productos/', valida: (h) => h.includes('data-variants'),
            cae: 'Si el portal de ANC también falla, no tendré costo de referencia para los pedidos.', vuelve: 'El respaldo de costos de ANC vuelve a estar disponible.' },
        { clave: 'sitio', nombre: 'Tienda web y conocimiento del bot (dctecnology.xyz)', url: String(cfg.url_conocimiento || 'https://dctecnology.xyz/bot-conocimiento.json'), valida: kbValido,
            cae: 'El bot sigue respondiendo con el catálogo que trae embebido (puede estar desactualizado).', vuelve: 'El bot vuelve a leer el catálogo publicado.' },
    ];
    memoria.salud = memoria.salud ?? {};
    const salida = [];
    for (const r of revisiones) {
        const resultado = await probar(r.url, r.valida);
        const previo = memoria.salud[r.clave] ?? { fallos: 0, avisado: false };
        const actual = { at: new Date().toISOString(), ok: resultado.ok, detalle: resultado.detalle ?? null, fallos: resultado.ok ? 0 : previo.fallos + 1, avisado: previo.avisado };
        if (!resultado.ok && actual.fallos >= 2 && !previo.avisado) {
            actual.avisado = true;
            if (aviso) salida.push({ json: { numero: aviso, texto: [`⚠️ *${r.nombre} no responde*`, `Detalle: ${resultado.detalle}`, r.cae, 'Te aviso cuando vuelva.'].join('\n') } });
        }
        if (resultado.ok && previo.avisado) {
            actual.avisado = false;
            if (aviso) salida.push({ json: { numero: aviso, texto: [`✅ *${r.nombre} volvió a funcionar*`, r.vuelve].join('\n') } });
        }
        memoria.salud[r.clave] = actual;
    }
    // Mensajes que llegaron atrasados (WhatsApp estuvo sin recibir): resumen para que les respondas tú
    const atrasados = memoria.atrasados ?? [];
    if (atrasados.length && aviso) {
        const silencio = String(cfg.etiquetas_silencio ?? 'BAENAMORA').split(',').map((x) => normalizar(x).trim()).filter(Boolean);
        const et = memoria.etiquetas ?? { chats: {}, nombres: {} };
        const porNumero = new Map();
        for (const m of atrasados) {
            if ((et.chats[m.numero] ?? []).some((id) => silencio.includes(normalizar(et.nombres[id] ?? '').trim()))) continue;
            const prev = porNumero.get(m.numero) ?? { ...m, n: 0 };
            porNumero.set(m.numero, { ...prev, n: prev.n + 1, texto: m.texto, t: m.t });
        }
        const lista = [...porNumero.values()].sort((a, b) => b.t - a.t);
        if (lista.length) salida.push({ json: { numero: aviso, texto: [
            `📬 *${lista.length} chat(s) escribieron mientras WhatsApp no recibía mensajes*`,
            'No les respondí automático (eran mensajes viejos). Escríbeles tú:',
            ...lista.slice(0, 25).map((m) => `• +${m.numero}${m.nombre ? ` (${m.nombre})` : ''} · ${m.n} msj · último: «${m.texto}»`),
            lista.length > 25 ? `…y ${lista.length - 25} más.` : null,
        ].filter(Boolean).join('\n') } });
        memoria.atrasados = [];
    }
    // IA balanceada: cuál quedó sin saldo o con la clave vencida (lo marca el propio nodo al fallar) y cuál volvió
    const ias = Object.entries((memoria.iaEstado ?? {}).p ?? {});
    memoria.saludIa = memoria.saludIa ?? {};
    for (const [nombre, s] of ias) {
        const avisado = Boolean(memoria.saludIa[nombre]);
        if (s.sinSaldo && !avisado) {
            memoria.saludIa[nombre] = true;
            const activas = ias.filter(([n, x]) => n !== nombre && !x.sinSaldo).map(([n]) => n);
            if (aviso) salida.push({ json: { numero: aviso, texto: [`⚠️ *IA ${nombre}: sin saldo o clave inválida*`, `Detalle: ${String(s.motivo ?? '').slice(0, 160)}`,
                activas.length ? `El bot sigue respondiendo con: ${activas.join(', ')}.` : '⛔ No queda otra IA activa: los mensajes libres reciben un aviso de espera (el menú sí funciona).',
                'Recárgala o agrega otra gratuita: node herramientas/configurar-ias.mjs'].join('\n') } });
        }
        if (!s.sinSaldo && avisado) {
            delete memoria.saludIa[nombre];
            if (aviso) salida.push({ json: { numero: aviso, texto: `✅ *IA ${nombre} volvió a responder*` } });
        }
    }
    return salida;
}

/* ==================== SERIALIZACIÓN ==================== */

const cuerpo = (fn) => {
    const s = fn.toString();
    return s.slice(s.indexOf('{') + 1, s.lastIndexOf('}')).replace(/^\n/, '').replace(/^ {4}/gm, '');
};
const UTILIDADES = cuerpo(utilidades).replace('__MONTO_CRIPTO__', WA.montoCripto.toString());
const MOTOR_IA = cuerpo(motorIa);
const codigo = (fn, { conUtilidades = false, conIa = false } = {}) => ((conUtilidades ? `${UTILIDADES}\n` : '') + (conIa ? `${MOTOR_IA}\n` : '') + cuerpo(fn))
    .replace(/__KB__/g, `(${JSON.stringify(kbEmbebida)})`)
    .replace(/__HORAS_PAUSA__/g, String(HORAS_PAUSA_ASESOR))
    .replace(/__ENTREGA_MIN__/g, String(WA.ENTREGA_MAX_MIN))
    .replace(/__HORARIO__/g, JSON.stringify(WA.HORARIO))
    .replace(/__HORAS_COTIZACION__/g, String(HORAS_COTIZACION))
    .replace(/__HORAS_PAGO__/g, String(HORAS_PAGO))
    .replace(/__HORAS_CREDENCIALES__/g, String(HORAS_CREDENCIALES))
    .replace(/__ANC_MAPA__/g, `(${JSON.stringify(ancMapa)})`)
    .replace(/__NOMBRES_PAGO__/g, `(${JSON.stringify(nombresPago)})`);

const uuid = () => crypto.randomUUID();
const nodos = [];
const nodo = (name, type, typeVersion, position, parameters, extra = {}) => {
    nodos.push({ parameters, id: uuid(), name, type, typeVersion, position, ...extra });
    return name;
};
const nodoCodigo = (name, position, fn, opciones = {}, extra = {}) =>
    nodo(name, 'n8n-nodes-base.code', 2, position, { jsCode: codigo(fn, opciones) }, extra);
const set = (asignaciones, { incluirEntrada = false } = {}) => ({
    assignments: { assignments: Object.entries(asignaciones).map(([name, value]) => ({ id: uuid(), name, value, type: 'string' })) },
    // incluirEntrada: conserva los campos que llegan (p. ej. "despacho" desde el disparador programado)
    ...(incluirEntrada ? { includeOtherFields: true, include: 'all' } : {}),
    options: {},
});
const supabaseRpc = (rpc, cuerpoJson) => ({
    method: 'POST',
    url: `={{ $('${cuerpoJson.config}').first().json.supabase_url }}/rest/v1/rpc/${rpc}`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'supabaseApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: cuerpoJson.body,
    options: { timeout: 15000 },
});
const evolutionEnviar = (config) => ({
    method: 'POST',
    url: `={{ $('${config}').first().json.evolution_url }}/message/sendText/{{ $('${config}').first().json.evolution_instancia }}`,
    authentication: 'genericCredentialType',
    genericAuthType: 'httpHeaderAuth',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ number: $json.numero, text: $json.texto, delay: 1500 }) }}',
    options: { timeout: 20000 },
});
const configComun = {
    supabase_url: SUPABASE_URL,
    evolution_url: 'https://TU-EVOLUTION-API',
    evolution_instancia: 'TU-INSTANCIA',
    url_conocimiento: 'https://dctecnology.xyz/bot-conocimiento.json',
};

/* ---------- A) Bot de WhatsApp ---------- */
nodo('Webhook Evolution', 'n8n-nodes-base.webhook', 2, [0, 0],
    { httpMethod: 'POST', path: 'dc-whatsapp', responseMode: 'onReceived', options: {} }, { webhookId: uuid() });
// WO-033: cada minuto se revisa si hay órdenes web validadas para arrancar su compra al proveedor.
// Pasa por "Config bot" (los nodos de la triangulación leen su configuración) y "Origen" la separa del chat.
nodo('Despacho web cada minuto', 'n8n-nodes-base.scheduleTrigger', 1.2, [-220, 220], { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } });
nodo('Marcar despacho', 'n8n-nodes-base.set', 3.4, [0, 220], set({ despacho: 'si' }));
nodo('Config bot', 'n8n-nodes-base.set', 3.4, [220, 0], set({
    ...configComun,
    numero_aviso_admin: '',
    numero_proveedor: '', // WhatsApp de ALL NECESSARY COLOMBIA (solo para canal_compra = whatsapp y combos)
    // WO-035 · Compra al proveedor: 'web' = en ancpagos.com (cotiza solo, tú pagas con un toque); 'whatsapp' = por chat
    // WO-038: URL donde Evolution le avisa al bot (localhost solo si Evolution corre en este PC fuera de Docker)
    webhook_publico: 'http://localhost:5678/webhook/dc-whatsapp',
    canal_compra: 'manual', // manual (tú compras en ANC, el bot te avisa) · web (portal de ANC automático) · whatsapp
    anc_url: 'https://ancpagos.com',
    anc_metodo: 'nequi',   // clave del medio de pago de ANC con el que les pagas (nequi, daviplata, brebManual, bancolombia)
    anc_correo: '',        // correo donde ANC envía los accesos (obligatorio para comprar por web)
    anc_nombre: 'DC',
    anc_apellido: 'Tecnology',
    anc_whatsapp: '',      // vacío = tu número de aviso
    palabras_asesor: kb.escalamiento.palabras_clave.join(','),
    // Etiquetas de WhatsApp Business en las que el bot NO responde (separadas por coma): contactos personales u otros negocios
    etiquetas_silencio: 'BAENAMORA',
    // Precio de venta = tienda de ANC + este % (0 = igual que ANC). Se aplica cada 6 h (WO-042)
    anc_margen: '0',
    bot_responde: 'si',
    entrega_cuentas: 'manual', // 'manual' (por defecto): las cuentas las entregas tú con #entregar · 'automatica': el bot entrega lo que mande ANC (confianza ≥ 0,9)
    consultar_proveedor: 'si',   // 'no' = no le pregunta a ANC por los productos de cada pedido nuevo          // 'no' = el bot no le contesta a nadie (tus comandos #ok/#no/#entregar y el proveedor siguen)
    leer_medios: 'no',           // 'si' = transcribe audios y lee capturas con IA de modelos abiertos (encender tras probar)
    horas_pausa_humano: '12',    // si escribes a mano en un chat, el bot se calla ahí estas horas (#bot lo reactiva)
}, { incluirEntrada: true }));
nodoCodigo('Normalizar mensaje', [440, 0], normalizarMensaje, { conUtilidades: true });
const historialChat = (indice) => ({
    ...evolutionEnviar('Config bot'),
    url: "={{ $('Config bot').first().json.evolution_url }}/chat/findMessages/{{ $('Config bot').first().json.evolution_instancia }}",
    jsonBody: `={{ JSON.stringify({ where: { key: { remoteJid: ($('Normalizar mensaje').first().json.jids || [])[${indice}] || ($('Normalizar mensaje').first().json.jids || [])[0] || 'nadie@s.whatsapp.net' }, messageTimestamp: { gte: new Date(Date.now() - 48 * 3600e3).toISOString(), lte: new Date(Date.now() + 60e3).toISOString() } }, offset: 40 }) }}`,
    options: { timeout: 8000 },
});
// Si Evolution no responde, el mensaje sigue normal (nunca se queda un cliente sin respuesta por esta revisión)
nodo('Historial del chat', 'n8n-nodes-base.httpRequest', 4.2, [550, 160], historialChat(0), { onError: 'continueRegularOutput', alwaysOutputData: true });
nodo('Historial del chat (lid)', 'n8n-nodes-base.httpRequest', 4.2, [660, 160], historialChat(1), { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('¿Lo atiende una persona?', [770, 160], atencionHumana);
const regla = (valor, salida, campo = 'ruta') => ({
    conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: uuid(), leftValue: `={{ $json.${campo} }}`, rightValue: valor, operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and',
    },
    renameOutput: true,
    outputKey: salida,
});
nodo('Ruta', 'n8n-nodes-base.switch', 3.2, [660, 0], {
    rules: { values: [regla('baja', 'Baja'), regla('asesor', 'Asesor'), regla('sin_texto', 'Sin texto'), regla('comprobante', 'Comprobante'), regla('triangulacion', 'Triangulación')] },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'IA' },
});
// Audios e imágenes (18/10/2026): solo los que hay que leer pasan por la descarga y la IA; lo demás va directo a Normalizar
nodoCodigo('Medio entrante', [300, 160], medioEntrante, { conUtilidades: true });
nodo('¿Leer medio?', 'n8n-nodes-base.switch', 3.2, [360, 300], {
    rules: { values: [regla('si', 'Leer', 'leer')] },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'Normal' },
});
nodo('Descargar medio', 'n8n-nodes-base.httpRequest', 4.2, [380, 440], {
    ...evolutionEnviar('Config bot'),
    url: "={{ $('Config bot').first().json.evolution_url }}/chat/getBase64FromMediaMessage/{{ $('Config bot').first().json.evolution_instancia }}",
    jsonBody: '={{ JSON.stringify({ message: { key: { id: $json.wamid } }, convertToMp4: false }) }}',
    options: { timeout: 30000 },
}, { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Leer medio (IA)', [400, 580], leerMedio, { conUtilidades: true, conIa: true }, { onError: 'continueRegularOutput' });
nodo('¿Es audio?', 'n8n-nodes-base.switch', 3.2, [420, 720], {
    rules: { values: [regla('audio', 'Audio', 'tipo')] },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'Listo' },
});
nodo('Whisper (audio)', 'n8n-nodes-base.httpRequest', 4.2, [440, 860], {
    method: 'POST',
    url: '={{ $json.whisper.url }}',
    sendHeaders: true,
    headerParameters: { parameters: [{ name: 'Authorization', value: '=Bearer {{ $json.whisper.clave }}' }] },
    sendBody: true,
    contentType: 'multipart-form-data',
    bodyParameters: { parameters: [
        { parameterType: 'formBinaryData', name: 'file', inputDataFieldName: 'audio' },
        { name: 'model', value: 'whisper-large-v3-turbo' },
        { name: 'language', value: 'es' },
        { name: 'response_format', value: 'json' },
    ] },
    options: { timeout: 30000 },
}, { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Transcripción', [460, 1000], leerTranscripcion);
nodo('Registrar baja', 'n8n-nodes-base.httpRequest', 4.2, [900, -300], supabaseRpc('registrar_baja_whatsapp', {
    config: 'Config bot',
    body: "={{ JSON.stringify({ p_numero: $json.numero }) }}",
}), { onError: 'continueRegularOutput' });
nodoCodigo('Respuesta fija', [1120, -200], respuestaFija);
nodoCodigo('Escalar a asesor', [900, -100], rutaAsesor, { conUtilidades: true });
nodoCodigo('Comprobante recibido', [900, 0], comprobanteRecibido, { conUtilidades: true });
nodo('Base de conocimiento', 'n8n-nodes-base.httpRequest', 4.2, [900, 140], {
    url: "={{ $('Config bot').first().json.url_conocimiento }}",
    options: { timeout: 8000, response: { response: { responseFormat: 'json' } } },
}, { onError: 'continueRegularOutput', alwaysOutputData: true });
nodo('Metodos de pago', 'n8n-nodes-base.httpRequest', 4.2, [1120, 140], {
    url: "={{ $('Config bot').first().json.supabase_url }}/rest/v1/metodos_pago?activo=eq.true&select=tipo,categoria,banco_alias,numero_cuenta,titular,moneda,red,memo,url_pago,instrucciones,tasa_cop,tasa_actualizada_at,orden&order=categoria,orden",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'supabaseApi',
    options: { timeout: 8000 },
}, { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
// WO-029: reglas de descuento por combo (las mismas que usa descuento_combo() y el portal)
nodo('Reglas combo', 'n8n-nodes-base.httpRequest', 4.2, [1230, 300], supabaseRpc('reglas_combo_publicas', {
    config: 'Config bot',
    body: '={{ JSON.stringify({}) }}',
}), { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
// WO-041: precios vigentes de la base (los mismos de la tienda) para el menú, la IA y la revisión de pedidos
nodo('Precios vivos', 'n8n-nodes-base.httpRequest', 4.2, [1230, 620], supabaseRpc('precios_publicos', {
    config: 'Config bot',
    body: '={{ JSON.stringify({}) }}',
}), { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
// WO-040: menú con números sin IA. "¿Menú?" envía su respuesta directo; lo demás sigue a la IA
nodoCodigo('Responder menú', [1120, 480], responderMenu, { conUtilidades: true });
nodo('¿Menú?', 'n8n-nodes-base.switch', 3.2, [1340, 480], {
    rules: { values: [regla('menu', 'Menú', 'via')] },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'IA' },
});
nodoCodigo('Armar contexto', [1340, 140], armarContexto, { conUtilidades: true });
// IA balanceada (varias IA en cadena con reparto de uso): reemplaza al Agente IA + memoria + modelo único
nodoCodigo('IA balanceada', [1560, 140], iaBalanceada, { conUtilidades: true, conIa: true }, { onError: 'continueRegularOutput' });
nodoCodigo('Revisar respuesta', [1780, 140], revisarRespuesta, { conUtilidades: true });
nodo('Enviar respuesta', 'n8n-nodes-base.httpRequest', 4.2, [2000, 0], evolutionEnviar('Config bot'), { onError: 'continueRegularOutput' });

/* ---------- C) Triangulación ---------- */
const Y = 1300; // fila de la triangulación en el lienzo
// RPC de supabase/wo-026-triangulacion-panel.sql (credencial de servidor)
const rpcPanel = (rpc, cuerpo) => ({
    method: 'POST',
    url: `={{ $('Config bot').first().json.supabase_url }}/rest/v1/rpc/${rpc}`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'supabaseApi',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: cuerpo,
    options: { timeout: 15000 },
});
const supabaseTabla = (metodo, filtro, cuerpo) => ({
    method: metodo,
    url: `={{ $('Config bot').first().json.supabase_url }}/rest/v1/triangulaciones${filtro}`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'supabaseApi',
    ...(cuerpo ? {
        sendHeaders: true,
        headerParameters: { parameters: [{ name: 'Prefer', value: 'return=minimal' }] },
        sendBody: true, specifyBody: 'json', jsonBody: cuerpo,
    } : {}),
    options: { timeout: 15000 },
});
// Upsert: un pedido por WhatsApp se inserta; una orden web (WO-033) ya existe y solo se completa
const supabaseUpsert = (cuerpo) => {
    const n = supabaseTabla('POST', '?on_conflict=referencia', cuerpo);
    n.headerParameters.parameters[0].value = 'resolution=merge-duplicates,return=minimal';
    return n;
};
const REF = "$('Crear triangulación').first().json.referencia";
const porReferencia = `?referencia=eq.{{ ${REF} }}`;
const enviarA = (numeroExpr, textoExpr) => ({
    ...evolutionEnviar('Config bot'),
    jsonBody: `={{ JSON.stringify({ number: ${numeroExpr}, text: ${textoExpr}, delay: 1200 }) }}`,
});
const esperar = (horas) => ({
    resume: 'webhook', httpMethod: 'POST', responseMode: 'onReceived',
    limitWaitTime: true, limitType: 'afterTimeInterval', resumeAmount: horas, resumeUnit: 'hours', options: {},
});
const PROVEEDOR = "String($('Config bot').first().json.numero_proveedor).replace(/\\D/g, '').replace(/^(3\\d{9})$/, '57$1')";
const ADMIN = "String($('Config bot').first().json.numero_aviso_admin).replace(/\\D/g, '').replace(/^(3\\d{9})$/, '57$1')";
const terminal = { onError: 'continueErrorOutput' };

// WO-033: entrada del despacho de órdenes web
nodo('Origen', 'n8n-nodes-base.switch', 3.2, [330, 0], {
    rules: { values: [regla('si', 'Despacho', 'despacho'), regla('si', 'ANC', 'revisar_anc'), regla('si', 'Posventa', 'posventa'), regla('si', 'Evolution', 'configurar_evolution'), regla('si', 'Proveedor', 'sincronizar_proveedor'), regla('si', 'Salud', 'revisar_salud')] },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'WhatsApp' },
});
nodo('Órdenes por despachar', 'n8n-nodes-base.httpRequest', 4.2, [1780, 440], rpcPanel('tomar_despachos', '={{ JSON.stringify({}) }}'), { onError: 'continueRegularOutput' });
nodoCodigo('Preparar despacho', [1890, 600], prepararDespacho);
nodoCodigo('Crear triangulación', [2000, Y], crearTriangulacion, { conUtilidades: true });
nodo('Registrar triangulación', 'n8n-nodes-base.httpRequest', 4.2, [2220, Y], supabaseUpsert(
    "={{ JSON.stringify({ referencia: $json.referencia, cliente: $json.cliente, cliente_nombre: $json.cliente_nombre, producto: $json.producto, variante: $json.variante, precio_venta: $json.precio_venta, canal_compra: $json.canal, estado: 'COTIZANDO', esperando: 'COTIZACION', resume_url: $execution.resumeUrl }) }}"));
nodo('Vincular al panel', 'n8n-nodes-base.httpRequest', 4.2, [2330, Y - 160],
    rpcPanel('vincular_triangulacion', `={{ JSON.stringify({ p_referencia: ${REF} }) }}`),
    { onError: 'continueRegularOutput', alwaysOutputData: true });
// WO-035: canal de compra del pedido (lo fija "Crear triangulación")
const porCanal = (salidaWeb) => ({
    rules: { values: [{
        conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [{ id: uuid(), leftValue: "={{ $('Crear triangulación').first().json.canal }}", rightValue: 'web', operator: { type: 'string', operation: 'equals' } }],
            combinator: 'and',
        },
        renameOutput: true,
        outputKey: salidaWeb,
    }] },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'WhatsApp' },
});
const ANC = "$('Config bot').first().json.anc_url.replace(/\\/$/, '')";
const navegador = { sendHeaders: true, headerParameters: { parameters: [{ name: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' }] } };
nodo('¿Compra web?', 'n8n-nodes-base.switch', 3.2, [2440, Y - 320], porCanal('Portal ANC'));
nodo('Catálogo ANC', 'n8n-nodes-base.httpRequest', 4.2, [2660, Y - 420], {
    url: `={{ ${ANC} }}/`, ...navegador,
    options: { timeout: 20000, response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } },
}, { onError: 'continueRegularOutput', alwaysOutputData: true });
nodo('Medios de pago ANC', 'n8n-nodes-base.httpRequest', 4.2, [2770, Y - 300], {
    url: `={{ ${ANC} }}/api_portal?a=medios`, ...navegador,
    options: { timeout: 15000, response: { response: { responseFormat: 'json' } } },
}, { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Tienda ANC (respaldo)', [2880, Y - 540], tiendaAnc, {}, { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Cotización ANC', [2990, Y - 420], cotizacionAnc, { conUtilidades: true }, terminal);
nodo('Cotizar al proveedor', 'n8n-nodes-base.httpRequest', 4.2, [2440, Y], enviarA(PROVEEDOR, "$('Crear triangulación').first().json.texto_proveedor"), terminal);
nodo('Guardar cotización enviada', 'n8n-nodes-base.httpRequest', 4.2, [2660, Y], supabaseTabla('PATCH', porReferencia,
    '={{ JSON.stringify({ wamid_cotizacion: $json.key?.id ?? null }) }}'));
nodo('Esperar cotización', 'n8n-nodes-base.wait', 1.1, [2880, Y], esperar(HORAS_COTIZACION), { webhookId: uuid() });
nodoCodigo('Evaluar cotización', [3100, Y], evaluarCotizacion, { conUtilidades: true }, terminal);
nodo('Pedir pago al admin', 'n8n-nodes-base.httpRequest', 4.2, [3320, Y], enviarA(ADMIN, '$json.texto_admin'), terminal);
nodo('Guardar costo', 'n8n-nodes-base.httpRequest', 4.2, [3540, Y], supabaseTabla('PATCH', porReferencia,
    "={{ JSON.stringify({ costo_proveedor: $('Evaluar cotización').first().json.costo, estado: 'ESPERANDO_PAGO_ADMIN', esperando: 'PAGO_ADMIN' }) }}"));
nodo('Esperar pago del admin', 'n8n-nodes-base.wait', 1.1, [3760, Y], esperar(HORAS_PAGO), { webhookId: uuid() });
nodoCodigo('Evaluar pago', [3980, Y], evaluarPago, { conUtilidades: true }, terminal);
nodo('Descargar comprobante', 'n8n-nodes-base.httpRequest', 4.2, [4200, Y], {
    ...evolutionEnviar('Config bot'),
    url: "={{ $('Config bot').first().json.evolution_url }}/chat/getBase64FromMediaMessage/{{ $('Config bot').first().json.evolution_instancia }}",
    jsonBody: '={{ JSON.stringify({ message: { key: { id: $json.wamid } }, convertToMp4: false }) }}',
}, terminal);
nodo('Reenviar pago al proveedor', 'n8n-nodes-base.httpRequest', 4.2, [4420, Y], {
    ...evolutionEnviar('Config bot'),
    url: "={{ $('Config bot').first().json.evolution_url }}/message/sendMedia/{{ $('Config bot').first().json.evolution_instancia }}",
    jsonBody: `={{ JSON.stringify({ number: ${PROVEEDOR}, mediatype: String($json.mimetype || '').includes('pdf') ? 'document' : 'image', mimetype: $json.mimetype || 'image/jpeg', media: $json.base64, fileName: 'comprobante-' + ${REF} + (String($json.mimetype || '').includes('pdf') ? '.pdf' : '.jpg'), caption: 'Pago pedido #' + ${REF} + ' – ' + $('Crear triangulación').first().json.producto + '. Quedo atento a los accesos (responde citando este mensaje).' }) }}`,
}, terminal);
nodo('¿Pago web?', 'n8n-nodes-base.switch', 3.2, [4310, Y - 320], porCanal('Portal ANC'));
nodoCodigo('Preparar compra ANC', [4420, Y - 420], prepararCompraAnc, { conUtilidades: true }, terminal);
const campoAnc = (name) => ({ parameterType: 'formData', name, value: `={{ $json.${name} }}` });
nodo('Comprar en ANC', 'n8n-nodes-base.httpRequest', 4.2, [4530, Y - 300], {
    method: 'POST',
    url: `={{ ${ANC} }}/procesar_pago`,
    sendHeaders: true,
    headerParameters: { parameters: [...navegador.headerParameters.parameters, { name: 'Referer', value: `={{ ${ANC} }}/checkout` }] },
    sendBody: true,
    contentType: 'multipart-form-data',
    bodyParameters: { parameters: [
        ...['nombre_cliente', 'apellido_cliente', 'whatsapp', 'correo', 'resumen_pedido', 'total_pagado', 'metodo', 'metodo_key', 'moneda_cripto', 'llave_pedido'].map(campoAnc),
        { parameterType: 'formBinaryData', name: 'comprobante', inputDataFieldName: 'comprobante' },
    ] },
    options: { timeout: 45000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } } },
}, { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Pedido ANC creado', [4640, Y - 420], pedidoAncCreado, { conUtilidades: true }, terminal);
nodo('Guardar compra ANC', 'n8n-nodes-base.httpRequest', 4.2, [4750, Y - 300], supabaseTabla('PATCH', porReferencia,
    "={{ JSON.stringify({ canal_compra: 'web', anc_pedido_id: $json.anc_pedido_id, anc_token: $json.anc_token, estado: 'ESPERANDO_CREDENCIALES', esperando: 'CREDENCIALES' }) }}"), terminal);
nodo('Avisar pedido ANC', 'n8n-nodes-base.httpRequest', 4.2, [4860, Y - 420], enviarA("$('Pedido ANC creado').first().json.numero", "$('Pedido ANC creado').first().json.texto"), { onError: 'continueRegularOutput' });
nodo('Guardar pago enviado', 'n8n-nodes-base.httpRequest', 4.2, [4640, Y], supabaseTabla('PATCH', porReferencia,
    "={{ JSON.stringify({ wamid_pago: $json.key?.id ?? null, estado: 'ESPERANDO_CREDENCIALES', esperando: 'CREDENCIALES' }) }}"));
nodo('Marcar pedido realizado', 'n8n-nodes-base.httpRequest', 4.2, [4750, Y - 160],
    rpcPanel('avanzar_compra_triangulada', `={{ JSON.stringify({ p_referencia: ${REF}, p_estado: 'PEDIDO_REALIZADO', p_costo: $('Evaluar cotización').first().json.costo }) }}`),
    { onError: 'continueRegularOutput', alwaysOutputData: true });
nodo('Esperar credenciales', 'n8n-nodes-base.wait', 1.1, [4860, Y], esperar(HORAS_CREDENCIALES), { webhookId: uuid() });
nodoCodigo('Preparar extracción', [5080, Y], prepararExtraccion, { conUtilidades: true }, terminal);
nodoCodigo('Extraer accesos (IA)', [5300, Y], extraerAccesosIa, { conUtilidades: true, conIa: true }, terminal);
nodoCodigo('Validar credenciales', [5520, Y], validarCredenciales);
nodo('¿Entregar?', 'n8n-nodes-base.switch', 3.2, [5740, Y], {
    rules: { values: [regla('entregar', 'Entregar', 'decision'), regla('revisar', 'Revisar', 'decision')] },
    options: {},
});
nodoCodigo('Pedir aprobación', [5960, Y + 200], pedirAprobacion, { conUtilidades: true });
nodo('Enviar revisión al admin', 'n8n-nodes-base.httpRequest', 4.2, [6180, Y + 200], enviarA('$json.numero', '$json.texto'), terminal);
nodo('Guardar revisión', 'n8n-nodes-base.httpRequest', 4.2, [6400, Y + 200], supabaseTabla('PATCH', porReferencia,
    "={{ JSON.stringify({ estado: 'REVISION_MANUAL', esperando: 'APROBACION', confianza: $('Validar credenciales').first().json.confianza }) }}"));
nodo('Esperar aprobación', 'n8n-nodes-base.wait', 1.1, [6620, Y + 200], esperar(HORAS_APROBACION), { webhookId: uuid() });
nodoCodigo('Evaluar aprobación', [6840, Y + 200], evaluarAprobacion, { conUtilidades: true }, terminal);
nodoCodigo('Mensaje de entrega', [7060, Y], mensajeEntrega, { conUtilidades: true });
nodo('Enviar accesos al cliente', 'n8n-nodes-base.httpRequest', 4.2, [7280, Y], enviarA('$json.numero', '$json.texto'), terminal);
nodo('Guardar entrega', 'n8n-nodes-base.httpRequest', 4.2, [7500, Y], supabaseTabla('PATCH', porReferencia,
    "={{ JSON.stringify({ estado: 'ENTREGADO', esperando: null, resume_url: null, credencial_final: $('Mensaje de entrega').first().json.clave_final, confianza: $('Mensaje de entrega').first().json.confianza }) }}"),
{ onError: 'continueRegularOutput' });
nodo('Marcar entregado en el panel', 'n8n-nodes-base.httpRequest', 4.2, [7610, Y - 160],
    rpcPanel('avanzar_compra_triangulada', `={{ JSON.stringify({ p_referencia: ${REF}, p_estado: 'ENTREGADO', p_clave: $('Mensaje de entrega').first().json.clave_panel }) }}`),
    { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
nodoCodigo('Aviso de entrega', [7720, Y], avisoEntrega, { conUtilidades: true });
nodoCodigo('Cerrar triangulación', [4200, Y + 500], cerrarTriangulacion, { conUtilidades: true });
nodo('Guardar cierre', 'n8n-nodes-base.httpRequest', 4.2, [4420, Y + 500], supabaseTabla('PATCH', '?referencia=eq.{{ $json.referencia }}',
    '={{ JSON.stringify($json.patch) }}'), { onError: 'continueRegularOutput', executeOnce: true });
nodoCodigo('Mensajes de cierre', [4640, Y + 500], mensajesCierre);
nodo('Enviar aviso triangulación', 'n8n-nodes-base.httpRequest', 4.2, [4860, Y + 500], enviarA('$json.numero', '$json.texto'), { onError: 'continueRegularOutput' });

/* ---------- D) Combos con el proveedor (WO-031) ---------- */
const YC = Y + 1100; // fila de los combos en el lienzo
const REFC = "$('Crear combo').first().json.referencia";
const porReferenciaCombo = `?referencia=eq.{{ ${REFC} }}`;
const lineasPanel = (expr) => rpcPanel('actualizar_lineas_combo', `={{ JSON.stringify({ p_grupo: ${REFC}, p_lineas: ${expr} }) }}`);
nodoCodigo('Crear combo', [2000, YC], crearCombo, { conUtilidades: true });
nodo('Registrar combo', 'n8n-nodes-base.httpRequest', 4.2, [2220, YC], supabaseUpsert(
    "={{ JSON.stringify($json.filas.map(function (f, i) { return Object.assign({}, f, { resume_url: i === 0 ? $execution.resumeUrl : null }); })) }}"));
nodoCodigo('Líneas del combo', [2330, YC - 160], lineasCombo);
nodo('Vincular combo al panel', 'n8n-nodes-base.httpRequest', 4.2, [2440, YC - 160],
    rpcPanel('vincular_triangulacion', '={{ JSON.stringify({ p_referencia: $json.referencia }) }}'),
    { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Combo manual', [2550, YC], comboManual, { conUtilidades: true }, { ...terminal, executeOnce: true });
nodo('Cotizar combo al proveedor', 'n8n-nodes-base.httpRequest', 4.2, [2660, YC], enviarA(PROVEEDOR, "$('Crear combo').first().json.texto_proveedor"), { ...terminal, executeOnce: true });
nodo('Guardar cotización combo', 'n8n-nodes-base.httpRequest', 4.2, [2880, YC], supabaseTabla('PATCH', porReferenciaCombo,
    '={{ JSON.stringify({ wamid_cotizacion: $json.key?.id ?? null }) }}'));
nodo('Esperar cotización combo', 'n8n-nodes-base.wait', 1.1, [3100, YC], esperar(HORAS_COTIZACION), { webhookId: uuid() });
nodoCodigo('Evaluar cotización combo', [3320, YC], evaluarCotizacionCombo, { conUtilidades: true }, terminal);
nodo('Pedir pago combo al admin', 'n8n-nodes-base.httpRequest', 4.2, [3540, YC], enviarA(ADMIN, "$('Evaluar cotización combo').first().json.texto_admin"), terminal);
nodo('Guardar costo combo', 'n8n-nodes-base.httpRequest', 4.2, [3760, YC], supabaseTabla('PATCH', porReferenciaCombo,
    "={{ JSON.stringify({ costo_proveedor: $('Evaluar cotización combo').first().json.costo_total, pago_pausado: $('Evaluar cotización combo').first().json.pausado, estado: 'ESPERANDO_PAGO_ADMIN', esperando: 'PAGO_ADMIN' }) }}"));
nodo('Líneas agotadas', 'n8n-nodes-base.httpRequest', 4.2, [3870, YC - 160],
    lineasPanel("$('Evaluar cotización combo').first().json.actualizar"), { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
nodo('¿Hay agotadas?', 'n8n-nodes-base.switch', 3.2, [3980, YC], {
    rules: { values: [(() => { const r = regla('si', 'Avisar', 'hay_agotadas'); r.conditions.conditions[0].leftValue = "={{ $('Evaluar cotización combo').first().json.hay_agotadas }}"; return r; })()] },
    options: { fallbackOutput: 'extra', renameFallbackOutput: 'Seguir' },
}, { executeOnce: true });
nodo('Avisar agotadas al cliente', 'n8n-nodes-base.httpRequest', 4.2, [4200, YC - 160],
    enviarA("$('Crear combo').first().json.cliente", "$('Evaluar cotización combo').first().json.texto_cliente"), { onError: 'continueRegularOutput' });
nodo('Esperar pago combo', 'n8n-nodes-base.wait', 1.1, [4420, YC], esperar(HORAS_PAGO), { webhookId: uuid() });
nodoCodigo('Evaluar pago combo', [4640, YC], evaluarPagoCombo, { conUtilidades: true }, terminal);
nodo('Descargar comprobante combo', 'n8n-nodes-base.httpRequest', 4.2, [4860, YC], {
    ...evolutionEnviar('Config bot'),
    url: "={{ $('Config bot').first().json.evolution_url }}/chat/getBase64FromMediaMessage/{{ $('Config bot').first().json.evolution_instancia }}",
    jsonBody: '={{ JSON.stringify({ message: { key: { id: $json.wamid } }, convertToMp4: false }) }}',
}, terminal);
nodo('Reenviar pago combo', 'n8n-nodes-base.httpRequest', 4.2, [5080, YC], {
    ...evolutionEnviar('Config bot'),
    url: "={{ $('Config bot').first().json.evolution_url }}/message/sendMedia/{{ $('Config bot').first().json.evolution_instancia }}",
    jsonBody: `={{ JSON.stringify({ number: ${PROVEEDOR}, mediatype: String($json.mimetype || '').includes('pdf') ? 'document' : 'image', mimetype: $json.mimetype || 'image/jpeg', media: $json.base64, fileName: 'comprobante-' + ${REFC} + (String($json.mimetype || '').includes('pdf') ? '.pdf' : '.jpg'), caption: 'Pago combo #' + ${REFC} + ': ' + $('Evaluar cotización combo').first().json.lineas.filter(l => !l.agotada).map(l => l.producto).join(', ') + '. Quedo atento a los accesos de cada línea (responde citando este mensaje).' }) }}`,
}, terminal);
nodo('Guardar pago combo', 'n8n-nodes-base.httpRequest', 4.2, [5300, YC], supabaseTabla('PATCH', porReferenciaCombo,
    "={{ JSON.stringify({ wamid_pago: $json.key?.id ?? null, estado: 'ESPERANDO_CREDENCIALES', esperando: 'CREDENCIALES' }) }}"));
nodo('Marcar combo realizado', 'n8n-nodes-base.httpRequest', 4.2, [5410, YC - 160],
    lineasPanel("$('Evaluar pago combo').first().json.actualizar"), { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
nodo('Esperar credenciales combo', 'n8n-nodes-base.wait', 1.1, [5520, YC], esperar(HORAS_CREDENCIALES), { webhookId: uuid(), executeOnce: true });
nodoCodigo('Preparar extracción combo', [5740, YC], prepararExtraccionCombo, { conUtilidades: true }, terminal);
nodoCodigo('Extraer accesos combo (IA)', [5960, YC], extraerAccesosComboIa, { conUtilidades: true, conIa: true }, terminal);
nodoCodigo('Entregar combo', [6180, YC], entregarCombo, { conUtilidades: true }, terminal);
nodo('Enviar accesos combo', 'n8n-nodes-base.httpRequest', 4.2, [6400, YC], enviarA('$json.numero', '$json.texto'), terminal);
nodo('Guardar entrega combo', 'n8n-nodes-base.httpRequest', 4.2, [6620, YC],
    lineasPanel("$('Entregar combo').first().json.actualizar"), { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
nodo('Cerrar combo entregado', 'n8n-nodes-base.httpRequest', 4.2, [6840, YC], supabaseTabla('PATCH', porReferenciaCombo,
    "={{ JSON.stringify({ estado: $('Entregar combo').first().json.estado_padre, esperando: null, resume_url: null }) }}"),
{ onError: 'continueRegularOutput', executeOnce: true });
nodo('Aviso combo al admin', 'n8n-nodes-base.httpRequest', 4.2, [7060, YC], enviarA(ADMIN, "$('Entregar combo').first().json.texto_admin"), { onError: 'continueRegularOutput', executeOnce: true });
nodoCodigo('Cerrar combo', [4860, YC + 500], cerrarCombo, { conUtilidades: true });
nodo('Guardar cierre combo', 'n8n-nodes-base.httpRequest', 4.2, [5080, YC + 500], supabaseTabla('PATCH', '?referencia=eq.{{ $json.referencia }}',
    '={{ JSON.stringify($json.patch) }}'), { onError: 'continueRegularOutput', executeOnce: true });
nodo('Cerrar líneas combo', 'n8n-nodes-base.httpRequest', 4.2, [5300, YC + 500],
    lineasPanel("$('Cerrar combo').first().json.actualizar"), { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
nodoCodigo('Mensajes de cierre combo', [5520, YC + 500], mensajesCierreCombo);

// Enrutador: mensajes del proveedor y comandos del admin → la espera del pedido correcto
nodo('Pedidos abiertos', 'n8n-nodes-base.httpRequest', 4.2, [900, -520],
    rpcPanel('triangulaciones_abiertas', '={{ JSON.stringify({}) }}'),
    { alwaysOutputData: true, executeOnce: true });
nodoCodigo('Enrutar evento', [1120, -520], enrutarEvento, { conUtilidades: true });
nodo('Acción', 'n8n-nodes-base.switch', 3.2, [1340, -520], {
    rules: { values: [regla('reanudar', 'Reanudar', 'accion'), regla('avisar', 'Avisar', 'accion'), regla('pago_web', 'Pago web', 'accion'), regla('entrega_manual', 'Entrega manual', 'accion'), regla('panel', 'Panel', 'accion')] },
    options: {},
});
nodo('Reanudar espera', 'n8n-nodes-base.httpRequest', 4.2, [1560, -620], {
    method: 'POST',
    url: '={{ $json.url }}',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.cuerpo) }}',
    options: { timeout: 15000 },
}, { onError: 'continueRegularOutput' });

/* ---------- C-web) Revisión de pedidos en ANC (WO-035) ---------- */
nodo('Pedidos ANC cada minuto', 'n8n-nodes-base.scheduleTrigger', 1.2, [-220, 380], { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } });
nodo('Marcar revisión ANC', 'n8n-nodes-base.set', 3.4, [0, 380], set({ revisar_anc: 'si' }));
nodo('Pedidos ANC esperando', 'n8n-nodes-base.httpRequest', 4.2, [560, 380], rpcPanel('triangulaciones_anc_esperando', '={{ JSON.stringify({}) }}'), { onError: 'continueRegularOutput' });
nodo('Leer pedido en ANC', 'n8n-nodes-base.httpRequest', 4.2, [780, 380], {
    url: `={{ ${ANC} }}/estado_pedido?id={{ $json.anc_pedido_id }}&t={{ encodeURIComponent($json.anc_token) }}`, ...navegador,
    options: { timeout: 20000, response: { response: { fullResponse: true, neverError: true, responseFormat: 'text' } } },
}, { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Accesos en ANC', [1000, 380], accesosEnAnc, { conUtilidades: true });
nodo('Reanudar con ANC', 'n8n-nodes-base.httpRequest', 4.2, [1220, 380], {
    method: 'POST', url: '={{ $json.url }}', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.cuerpo) }}', options: { timeout: 15000 },
}, { onError: 'continueRegularOutput' });

/* ---------- Latidos (WO-036): cada rama programada avisa que está viva → Panel → Prueba del sistema ---------- */
// WO-037: con el latido de despacho, Config bot se reporta (últimos 4 dígitos, correo enmascarado, canal) → Prueba del sistema
const reporteConfig = `{
    aviso_admin: String($('Config bot').first().json.numero_aviso_admin || '').replace(/\\D/g, '').slice(-4),
    canal_compra: String($('Config bot').first().json.canal_compra || 'whatsapp'),
    anc_correo: String($('Config bot').first().json.anc_correo || '').trim().replace(/^(.{2})[^@]*(@.+)$/, '$1***$2'),
    anc_metodo: String($('Config bot').first().json.anc_metodo || ''),
    proveedor: String($('Config bot').first().json.numero_proveedor || '').replace(/\\D/g, '').length > 0,
    instancia: String($('Config bot').first().json.evolution_instancia || '')
}`;
nodo('Latido despacho', 'n8n-nodes-base.httpRequest', 4.2, [440, 300], rpcPanel('registrar_latido', `={{ JSON.stringify({ p_rama: "despacho", p_detalle: ${reporteConfig} }) }}`), { onError: 'continueRegularOutput', alwaysOutputData: true });
// Cada evento que llega de Evolution marca que el bot recibe chats (y con qué número está conectado)
nodo('Latido bot', 'n8n-nodes-base.httpRequest', 4.2, [440, -160], rpcPanel('registrar_latido',
    "={{ JSON.stringify({ p_rama: 'bot', p_detalle: { instancia: String($json.body?.instance ?? $('Config bot').first().json.evolution_instancia ?? ''), bot: String($json.body?.sender ?? '').replace(/\\D/g, '').slice(-4), evento: String($json.body?.event ?? '') } }) }}"),
{ onError: 'continueRegularOutput' });
nodo('Latido ANC', 'n8n-nodes-base.httpRequest', 4.2, [440, 460], rpcPanel('registrar_latido', '={{ JSON.stringify({ p_rama: "anc" }) }}'), { onError: 'continueRegularOutput', alwaysOutputData: true });

/* ---------- F) Emprende Red cada 6 horas (WO-041): costo, precio y stock en catalogo_precios ---------- */
nodo('Proveedor cada 6 horas', 'n8n-nodes-base.scheduleTrigger', 1.2, [-220, 1000], { rule: { interval: [{ field: 'hours', hoursInterval: 6 }] } });
nodo('Marcar proveedor', 'n8n-nodes-base.set', 3.4, [0, 1000], set({ sincronizar_proveedor: 'si' }));
nodoCodigo('Leer Emprende Red', [440, 1000], leerProveedor, { conUtilidades: true }, { onError: 'continueRegularOutput' });
nodo('Sincronizar precios proveedor', 'n8n-nodes-base.httpRequest', 4.2, [660, 1000],
    rpcPanel('sincronizar_proveedor', "={{ JSON.stringify({ p_proveedor: 'emprendered', p_items: $json.items }) }}"),
    { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Resultado proveedor', [880, 1000], resultadoProveedor, { conUtilidades: true });

/* ---------- I) WO-042: #ok / #no, entrega manual y llamadas al panel ---------- */
nodo('Resolver pago web', 'n8n-nodes-base.httpRequest', 4.2, [1560, -760],
    rpcPanel('resolver_orden_web_bot', "={{ JSON.stringify({ p_codigo: $json.codigo, p_aprobar: $json.aprobar, p_nota: $json.nota }) }}"),
    { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Resultado pago web', [1780, -760], resultadoPagoWeb, { conUtilidades: true });
nodoCodigo('Entrega manual', [1560, -880], entregaManual, { conUtilidades: true, conIa: true }, { onError: 'continueRegularOutput' });
nodo('Salida entrega', 'n8n-nodes-base.switch', 3.2, [1780, -880], {
    rules: { values: [regla('avisar', 'Avisar', 'accion'), regla('panel', 'Panel', 'accion')] },
    options: {},
});
nodo('Salida al panel', 'n8n-nodes-base.noOp', 1, [2000, -980], {});
nodo('RPC del panel', 'n8n-nodes-base.httpRequest', 4.2, [2220, -980], rpcPanel('{{ $json.rpc }}', '={{ JSON.stringify($json.args) }}'), { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Resultado del panel', [2440, -980], resultadoPanel, { conUtilidades: true });
// WO-044 · Renovaciones (rama de salud, cada 30 min)
nodo('Entregas para renovar', 'n8n-nodes-base.httpRequest', 4.2, [660, 1500], rpcPanel('entregas_para_renovar', '={{ JSON.stringify({ p_dias: 400 }) }}'), { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Renovaciones', [880, 1500], renovaciones, { conUtilidades: true }, { executeOnce: true });
nodo('Encolar renovación', 'n8n-nodes-base.httpRequest', 4.2, [1100, 1500], rpcPanel('encolar_renovacion', '={{ JSON.stringify($json.args) }}'), { onError: 'continueRegularOutput' });
// WO-052 · Resumen del día al director (rama de salud, 8 p. m.)
nodoCodigo('Hora del resumen', [660, 1820], horaResumen, {}, { executeOnce: true });
nodo('Resumen del día', 'n8n-nodes-base.httpRequest', 4.2, [880, 1820], rpcPanel('resumen_ventas_dia', '={{ JSON.stringify({}) }}'), { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Texto del resumen', [1100, 1820], textoResumen, { conUtilidades: true }, { executeOnce: true });
nodo('Enviar resumen', 'n8n-nodes-base.httpRequest', 4.2, [1320, 1820], evolutionEnviar('Config bot'), { onError: 'continueRegularOutput' });
// WO-047 · Rastreo de envíos (rama de salud, cada 30 min)
nodo('Guías abiertas', 'n8n-nodes-base.httpRequest', 4.2, [660, 1660], rpcPanel('rastreos_abiertos', '={{ JSON.stringify({}) }}'), { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Consultar rastreo', [880, 1660], consultarRastreos, {}, { executeOnce: true, onError: 'continueRegularOutput' });
nodo('Guardar rastreo', 'n8n-nodes-base.httpRequest', 4.2, [1100, 1660], rpcPanel('actualizar_rastreo', '={{ JSON.stringify($json.args) }}'), { onError: 'continueRegularOutput' });

/* ---------- J) WO-042: precios de ANC (misma rama "cada 6 horas" que Emprende Red) ---------- */
nodoCodigo('Leer precios ANC', [440, 1080], leerPreciosAnc, { conUtilidades: true }, { onError: 'continueRegularOutput' });
nodo('Sincronizar precios ANC', 'n8n-nodes-base.httpRequest', 4.2, [660, 1080],
    rpcPanel('sincronizar_precios_anc', "={{ JSON.stringify({ p_items: $json.items ?? [] }) }}"), { onError: 'continueRegularOutput', alwaysOutputData: true });
nodo('Disponibilidad ANC', 'n8n-nodes-base.httpRequest', 4.2, [770, 1180],
    rpcPanel('marcar_disponibilidad_anc', "={{ JSON.stringify({ p_items: $('Leer precios ANC').first().json.disponibilidad ?? [] }) }}"), { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Resultado precios ANC', [880, 1080], resultadoPreciosAnc, { conUtilidades: true });
// WO-050 · Estados "¡Volvió!" (rama de salud, cada 30 min)
nodoCodigo('Estado pendiente', [660, 1820], estadoPendiente, {}, { executeOnce: true });
nodo('Contactos para estado', 'n8n-nodes-base.httpRequest', 4.2, [880, 1820], {
    ...evolutionEnviar('Config bot'),
    url: "={{ $('Config bot').first().json.evolution_url }}/chat/findContacts/{{ $('Config bot').first().json.evolution_instancia }}",
    jsonBody: '={{ JSON.stringify({}) }}',
    options: { timeout: 30000 },
}, { onError: 'continueRegularOutput' });
nodoCodigo('Lista de contactos', [1100, 1820], listaContactosEstado, {}, { executeOnce: true });
nodo('Publicar estado', 'n8n-nodes-base.httpRequest', 4.2, [1320, 1820], {
    ...evolutionEnviar('Config bot'),
    url: "={{ $('Config bot').first().json.evolution_url }}/message/sendStatus/{{ $('Config bot').first().json.evolution_instancia }}",
    jsonBody: '={{ JSON.stringify($json) }}',
    options: { timeout: 60000 },
}, { onError: 'continueRegularOutput' });

/* ---------- G) Salud del sistema cada 30 minutos ---------- */
nodo('Salud cada 30 minutos', 'n8n-nodes-base.scheduleTrigger', 1.2, [-220, 1160], { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } });
nodo('Marcar salud', 'n8n-nodes-base.set', 3.4, [0, 1160], set({ revisar_salud: 'si' }));
nodoCodigo('Revisar salud', [440, 1160], revisarSalud, { conUtilidades: true }, { onError: 'continueRegularOutput' });

/* ---------- E) Configurar Evolution (WO-038): botón manual ---------- */
nodo('Configurar Evolution', 'n8n-nodes-base.manualTrigger', 1, [-220, -480], {});
nodo('Marcar configuración Evolution', 'n8n-nodes-base.set', 3.4, [0, -480], set({ configurar_evolution: 'si' }));
const evolutionApi = (metodo, ruta, cuerpo) => ({
    ...evolutionEnviar('Config bot'),
    method: metodo,
    url: `={{ $('Config bot').first().json.evolution_url.replace(/\\/+$/, '') }}/webhook/${ruta}/{{ $('Config bot').first().json.evolution_instancia }}`,
    ...(cuerpo ? { jsonBody: cuerpo } : { sendBody: false, jsonBody: undefined, specifyBody: undefined }),
    options: { timeout: 20000, response: { response: { fullResponse: true, neverError: true } } },
});
nodo('Webhook Evolution v2', 'n8n-nodes-base.httpRequest', 4.2, [660, -560], evolutionApi('POST', 'set',
    "={{ JSON.stringify({ webhook: { enabled: true, url: $('Config bot').first().json.webhook_publico, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'LABELS_ASSOCIATION', 'LABELS_EDIT'] } }) }}"),
{ onError: 'continueRegularOutput', alwaysOutputData: true });
nodo('Webhook Evolution v1', 'n8n-nodes-base.httpRequest', 4.2, [880, -560], evolutionApi('POST', 'set',
    "={{ JSON.stringify({ enabled: true, url: $('Config bot').first().json.webhook_publico, webhook_by_events: false, webhook_base64: false, events: ['MESSAGES_UPSERT', 'LABELS_ASSOCIATION', 'LABELS_EDIT'] }) }}"),
{ onError: 'continueRegularOutput', alwaysOutputData: true });
nodo('Leer webhook de Evolution', 'n8n-nodes-base.httpRequest', 4.2, [1100, -560], evolutionApi('GET', 'find', null), { onError: 'continueRegularOutput', alwaysOutputData: true });
nodoCodigo('Resultado Evolution', [1320, -560], resultadoEvolution);

/* ---------- B) Posventa ---------- */
nodo('Cada minuto', 'n8n-nodes-base.scheduleTrigger', 1.2, [-220, 540], { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } });
nodo('Marcar posventa', 'n8n-nodes-base.set', 3.4, [0, 540], set({ posventa: 'si' }));
// WO-037: una sola configuración. Posventa pasa por Config bot y copia de ahí sus valores (antes tenía los suyos
// y, si numero_aviso_admin quedaba vacío aquí, las alertas para ti fallaban sin que lo notaras)
const desdeConfigBot = (campo) => `={{ $('Config bot').first().json.${campo} }}`;
nodo('Config posventa', 'n8n-nodes-base.set', 3.4, [220, 700], set({
    supabase_url: desdeConfigBot('supabase_url'),
    evolution_url: desdeConfigBot('evolution_url'),
    evolution_instancia: desdeConfigBot('evolution_instancia'),
    url_conocimiento: desdeConfigBot('url_conocimiento'),
    numero_aviso_admin: desdeConfigBot('numero_aviso_admin'),
    lote: '5',
}));
nodo('Latido posventa', 'n8n-nodes-base.httpRequest', 4.2, [330, 860], supabaseRpc('registrar_latido', {
    config: 'Config posventa',
    body: '={{ JSON.stringify({ p_rama: "posventa" }) }}',
}), { onError: 'continueRegularOutput', alwaysOutputData: true });
nodo('Plantillas posventa', 'n8n-nodes-base.httpRequest', 4.2, [440, 700], {
    url: "={{ $('Config posventa').first().json.url_conocimiento }}",
    options: { timeout: 8000, response: { response: { responseFormat: 'json' } } },
}, { onError: 'continueRegularOutput', alwaysOutputData: true });
nodo('Tomar notificaciones', 'n8n-nodes-base.httpRequest', 4.2, [660, 700], supabaseRpc('tomar_notificaciones', {
    config: 'Config posventa',
    body: "={{ JSON.stringify({ p_lote: Number($('Config posventa').first().json.lote) || 5 }) }}",
}));
nodo('Recorrer cola', 'n8n-nodes-base.splitInBatches', 3, [880, 700], { batchSize: 1, options: {} });
nodoCodigo('Armar mensaje', [1100, 800], armarNotificacion, { conUtilidades: true }, { onError: 'continueErrorOutput' });
nodo('Enviar notificación', 'n8n-nodes-base.httpRequest', 4.2, [1320, 720], evolutionEnviar('Config posventa'), { onError: 'continueErrorOutput' });
nodo('Marcar enviada', 'n8n-nodes-base.httpRequest', 4.2, [1560, 620], supabaseRpc('marcar_notificacion', {
    config: 'Config posventa',
    body: "={{ JSON.stringify({ p_id: $('Recorrer cola').item.json.id, p_ok: true, p_wamid: $json.key?.id ?? null }) }}",
}), { onError: 'continueRegularOutput' });
nodoCodigo('Recordar reseña', [1780, 620], recordarResena);
nodo('Marcar fallida', 'n8n-nodes-base.httpRequest', 4.2, [1560, 900], supabaseRpc('marcar_notificacion', {
    config: 'Config posventa',
    body: "={{ JSON.stringify({ p_id: $('Recorrer cola').item.json.id, p_ok: false, p_error: String($json.error?.message ?? $json.error ?? 'Error de envío').slice(0, 400) }) }}",
}), { onError: 'continueRegularOutput' });
nodo('Pausa anti-ráfaga', 'n8n-nodes-base.wait', 1.1, [2000, 760], { amount: '={{ 8 + Math.floor(Math.random() * 8) }}', unit: 'seconds' }, { webhookId: uuid() });

/* ---------- Nota de configuración ---------- */
nodo('Leeme', 'n8n-nodes-base.stickyNote', 1, [-420, -360], {
    width: 380,
    height: 700,
    content: [
        '## DC Tecnology · Bot + Posventa',
        `Generado ${new Date().toISOString().slice(0, 10)} desde bot-conocimiento.json (no editar a mano: regenerar).`,
        '',
        '**1. Credenciales (asígnalas en cada nodo marcado):**',
        '- *Supabase*: Host `' + SUPABASE_URL + '` + **service_role** (nunca en el sitio web).',
        '- *Header Auth* "Evolution": Name `apikey`, Value = tu API key.',
        `- *OpenAI* "SiliconFlow": API key de SiliconFlow y Base URL \`${SILICONFLOW_URL}\` (.cn solo si tu cuenta es de China).`,
        '',
        '**2. Nodos Config bot / Config posventa:** URL e instancia de Evolution. `numero_aviso_admin` = tu WhatsApp personal para avisos de escalamiento (vacío = sin aviso).',
        '',
        '**Una sola configuración (WO-037):** todo se configura en *Config bot*; *Config posventa* copia de ahí sus valores.',
        '',
        '**Latidos (WO-036):** cada rama programada marca un latido; Panel → Prueba del sistema muestra si n8n está vivo (aplica supabase/wo-036-diagnostico.sql).',
        '',
        '**Compra al proveedor (WO-035):** `canal_compra` = `manual` (recomendado: el bot te avisa con plan, costo y si ya pagó; tú compras en ANC) · `web` compra en ancpagos.com (cotiza solo, tú pagas y envías la captura con #pago, el bot crea el pedido y lee los accesos de su página cada minuto); `whatsapp` = por chat con `numero_proveedor`. Para web llena `anc_correo` y `anc_metodo`, y aplica supabase/wo-035-compra-web-anc.sql.',
        '',
        '**3. Evolution API → Webhook:** pulsa el nodo **Configurar Evolution** (Execute) y n8n lo registra solo con su credencial (URL en Config bot → `webhook_publico`, evento `MESSAGES_UPSERT`). Mira el resultado en "Resultado Evolution".',
        '',
        '**4. Requisitos:** supabase/wo-015.sql, wo-024-triangulacion.sql, wo-026-triangulacion-panel.sql y wo-027-metodos-pago.sql aplicados.',
        '',
        '**Triangulación (productos digitales):** `numero_proveedor` en Config bot. Cotiza al proveedor → te pide pagar (envía la foto con `#pago DC-XXXXX`) → reenvía el comprobante → extrae los accesos y los entrega si aparecen TEXTUALES en el mensaje y la confianza es ≥ 0,9; si no, te pide `#aprobar DC-XXXXX`. `#cancelar DC-XXXXX` cierra el pedido.',
        '',
        '**Bot:** responde con FAQ, catálogo y cuentas ACTIVAS de metodos_pago. Nunca entrega cuentas ni confirma pagos (modo sombra). Escala a humano y pausa el chat ' + HORAS_PAUSA_ASESOR + ' h; escribe `#bot` en el chat del cliente para reactivarlo.',
        '',
        '**Posventa:** 1 mensaje a la vez, pausa aleatoria de 8–15 s, reintentos en la BD.',
    ].join('\n'),
});

/* ---------- Conexiones ---------- */
const conexiones = {};
const unir = (desde, hacia, salida = 0, tipo = 'main') => {
    conexiones[desde] = conexiones[desde] || {};
    conexiones[desde][tipo] = conexiones[desde][tipo] || [];
    while (conexiones[desde][tipo].length <= salida) conexiones[desde][tipo].push([]);
    conexiones[desde][tipo][salida].push({ node: hacia, type: tipo, index: 0 });
};
unir('Webhook Evolution', 'Config bot');
unir('Config bot', 'Origen');
unir('Origen', 'Latido despacho', 0);
unir('Latido despacho', 'Órdenes por despachar');
unir('Origen', 'Latido ANC', 1);
unir('Latido ANC', 'Pedidos ANC esperando');
unir('Origen', 'Config posventa', 2);
unir('Origen', 'Webhook Evolution v2', 3);
unir('Origen', 'Leer Emprende Red', 4);
unir('Origen', 'Revisar salud', 5);
unir('Revisar salud', 'Enviar respuesta');
unir('Origen', 'Entregas para renovar', 5);
unir('Entregas para renovar', 'Renovaciones');
unir('Renovaciones', 'Encolar renovación');
unir('Origen', 'Guías abiertas', 5);
unir('Origen', 'Hora del resumen', 5);
unir('Hora del resumen', 'Resumen del día');
unir('Resumen del día', 'Texto del resumen');
unir('Texto del resumen', 'Enviar resumen');
unir('Origen', 'Estado pendiente', 5);
unir('Estado pendiente', 'Contactos para estado');
unir('Contactos para estado', 'Lista de contactos');
unir('Lista de contactos', 'Publicar estado');
unir('Guías abiertas', 'Consultar rastreo');
unir('Consultar rastreo', 'Guardar rastreo');
unir('Origen', 'Medio entrante', 6);
unir('Medio entrante', '¿Leer medio?');
unir('¿Leer medio?', 'Descargar medio', 0);
unir('¿Leer medio?', 'Normalizar mensaje', 1);
unir('Descargar medio', 'Leer medio (IA)');
unir('Leer medio (IA)', '¿Es audio?');
unir('¿Es audio?', 'Whisper (audio)', 0);
unir('¿Es audio?', 'Normalizar mensaje', 1);
unir('Whisper (audio)', 'Transcripción');
unir('Transcripción', 'Normalizar mensaje');
unir('Origen', 'Latido bot', 6);
unir('Configurar Evolution', 'Marcar configuración Evolution');
unir('Marcar configuración Evolution', 'Config bot');
unir('Proveedor cada 6 horas', 'Marcar proveedor');
unir('Marcar proveedor', 'Config bot');
unir('Salud cada 30 minutos', 'Marcar salud');
unir('Marcar salud', 'Config bot');
unir('Leer Emprende Red', 'Sincronizar precios proveedor');
unir('Sincronizar precios proveedor', 'Resultado proveedor');
unir('Resultado proveedor', 'Enviar respuesta');
unir('Webhook Evolution v2', 'Webhook Evolution v1');
unir('Webhook Evolution v1', 'Leer webhook de Evolution');
unir('Leer webhook de Evolution', 'Resultado Evolution');
unir('Marcar posventa', 'Config bot');
unir('Pedidos ANC cada minuto', 'Marcar revisión ANC');
unir('Marcar revisión ANC', 'Config bot');
unir('Pedidos ANC esperando', 'Leer pedido en ANC');
unir('Leer pedido en ANC', 'Accesos en ANC');
unir('Accesos en ANC', 'Reanudar con ANC');
unir('Despacho web cada minuto', 'Marcar despacho');
unir('Marcar despacho', 'Config bot');
unir('Órdenes por despachar', 'Preparar despacho');
unir('Preparar despacho', 'Crear triangulación');
unir('Preparar despacho', 'Crear combo');
unir('Normalizar mensaje', 'Historial del chat');
unir('Historial del chat', 'Historial del chat (lid)');
unir('Historial del chat (lid)', '¿Lo atiende una persona?');
unir('¿Lo atiende una persona?', 'Ruta');
unir('Ruta', 'Registrar baja', 0);
unir('Ruta', 'Escalar a asesor', 1);
unir('Ruta', 'Respuesta fija', 2);
unir('Ruta', 'Comprobante recibido', 3);
unir('Ruta', 'Base de conocimiento', 5);              // salida extra (fallback) = IA
unir('Comprobante recibido', 'Enviar respuesta');
unir('Registrar baja', 'Respuesta fija');
unir('Respuesta fija', 'Enviar respuesta');
unir('Escalar a asesor', 'Enviar respuesta');
unir('Base de conocimiento', 'Metodos de pago');
unir('Metodos de pago', 'Reglas combo');
unir('Reglas combo', 'Precios vivos');
unir('Precios vivos', 'Responder menú');
unir('Responder menú', '¿Menú?');
unir('¿Menú?', 'Enviar respuesta', 0);
unir('¿Menú?', 'Crear triangulación', 0);         // compra por el menú: arranca el pedido al proveedor
unir('¿Menú?', 'Armar contexto', 1);
unir('Armar contexto', 'IA balanceada');
unir('IA balanceada', 'Revisar respuesta');
unir('Revisar respuesta', 'Enviar respuesta');
unir('Revisar respuesta', 'Crear triangulación');
unir('Revisar respuesta', 'Crear combo');

// C) Triangulación (salida 1 de los nodos con error = "terminar" → cierre)
unir('Ruta', 'Pedidos abiertos', 4);
unir('Pedidos abiertos', 'Enrutar evento');
unir('Enrutar evento', 'Acción');
unir('Acción', 'Reanudar espera', 0);
unir('Acción', 'Enviar respuesta', 1);
unir('Acción', 'Resolver pago web', 2);
unir('Resolver pago web', 'Resultado pago web');
unir('Resultado pago web', 'Enviar respuesta');
unir('Acción', 'Entrega manual', 3);
unir('Entrega manual', 'Salida entrega');
unir('Salida entrega', 'Enviar respuesta', 0);
unir('Salida entrega', 'Salida al panel', 1);
unir('Acción', 'Salida al panel', 4);
unir('Salida al panel', 'RPC del panel');
unir('RPC del panel', 'Resultado del panel');
unir('Resultado del panel', 'Enviar respuesta');
unir('Origen', 'Leer precios ANC', 4);
unir('Leer precios ANC', 'Sincronizar precios ANC');
unir('Sincronizar precios ANC', 'Disponibilidad ANC');
unir('Disponibilidad ANC', 'Resultado precios ANC');
unir('Resultado precios ANC', 'Enviar respuesta');
const enCadena = (lista) => lista.slice(0, -1).forEach((n, i) => unir(n, lista[i + 1]));
enCadena(['Crear triangulación', 'Registrar triangulación', 'Vincular al panel', '¿Compra web?']);
// Salida 0 = portal de ANC (WO-035) · salida 1 = WhatsApp del proveedor
unir('¿Compra web?', 'Catálogo ANC', 0);
enCadena(['Catálogo ANC', 'Medios de pago ANC', 'Tienda ANC (respaldo)', 'Cotización ANC', 'Evaluar cotización']);
unir('¿Compra web?', 'Cotizar al proveedor', 1);
enCadena(['Cotizar al proveedor', 'Guardar cotización enviada', 'Esperar cotización', 'Evaluar cotización']);
enCadena(['Evaluar cotización', 'Pedir pago al admin', 'Guardar costo', 'Esperar pago del admin', 'Evaluar pago', 'Descargar comprobante', '¿Pago web?']);
unir('¿Pago web?', 'Preparar compra ANC', 0);
enCadena(['Preparar compra ANC', 'Comprar en ANC', 'Pedido ANC creado', 'Guardar compra ANC', 'Marcar pedido realizado']);
unir('Guardar compra ANC', 'Avisar pedido ANC');
unir('¿Pago web?', 'Reenviar pago al proveedor', 1);
enCadena(['Reenviar pago al proveedor', 'Guardar pago enviado', 'Marcar pedido realizado']);
enCadena(['Marcar pedido realizado', 'Esperar credenciales', 'Preparar extracción', 'Extraer accesos (IA)', 'Validar credenciales', '¿Entregar?']);
unir('¿Entregar?', 'Mensaje de entrega', 0);
unir('¿Entregar?', 'Pedir aprobación', 1);
['Pedir aprobación', 'Enviar revisión al admin', 'Guardar revisión', 'Esperar aprobación', 'Evaluar aprobación', 'Mensaje de entrega']
    .forEach((n, i, a) => { if (a[i + 1]) unir(n, a[i + 1]); });
unir('Mensaje de entrega', 'Enviar accesos al cliente');
unir('Enviar accesos al cliente', 'Guardar entrega');
unir('Guardar entrega', 'Marcar entregado en el panel');
unir('Marcar entregado en el panel', 'Aviso de entrega');
unir('Aviso de entrega', 'Enviar aviso triangulación');
for (const n of nodos.filter((x) => x.onError === 'continueErrorOutput' && x.position[1] >= Y && x.position[1] < YC)) unir(n.name, 'Cerrar triangulación', 1);
// Compra en el portal de ANC (WO-035): sus nodos van sobre la fila, pero terminan igual que la triangulación
for (const n of ['Cotización ANC', 'Preparar compra ANC', 'Pedido ANC creado', 'Guardar compra ANC']) unir(n, 'Cerrar triangulación', 1);
unir('Cerrar triangulación', 'Guardar cierre');
unir('Guardar cierre', 'Mensajes de cierre');
unir('Mensajes de cierre', 'Enviar aviso triangulación');

// D) Combos
['Crear combo', 'Registrar combo', 'Líneas del combo', 'Vincular combo al panel', 'Combo manual', 'Cotizar combo al proveedor', 'Guardar cotización combo',
    'Esperar cotización combo', 'Evaluar cotización combo', 'Pedir pago combo al admin', 'Guardar costo combo', 'Líneas agotadas', '¿Hay agotadas?']
    .forEach((n, i, a) => { if (a[i + 1]) unir(n, a[i + 1]); });
unir('¿Hay agotadas?', 'Avisar agotadas al cliente', 0);
unir('¿Hay agotadas?', 'Esperar pago combo', 1);
unir('Avisar agotadas al cliente', 'Esperar pago combo');
['Esperar pago combo', 'Evaluar pago combo', 'Descargar comprobante combo', 'Reenviar pago combo', 'Guardar pago combo', 'Marcar combo realizado',
    'Esperar credenciales combo', 'Preparar extracción combo', 'Extraer accesos combo (IA)', 'Entregar combo', 'Enviar accesos combo',
    'Guardar entrega combo', 'Cerrar combo entregado', 'Aviso combo al admin']
    .forEach((n, i, a) => { if (a[i + 1]) unir(n, a[i + 1]); });
for (const n of nodos.filter((x) => x.onError === 'continueErrorOutput' && x.position[1] >= YC)) unir(n.name, 'Cerrar combo', 1);
unir('Cerrar combo', 'Guardar cierre combo');
unir('Guardar cierre combo', 'Cerrar líneas combo');
unir('Cerrar líneas combo', 'Mensajes de cierre combo');
unir('Mensajes de cierre combo', 'Enviar aviso triangulación');

unir('Cada minuto', 'Marcar posventa');
unir('Config posventa', 'Latido posventa');
unir('Latido posventa', 'Plantillas posventa');
unir('Plantillas posventa', 'Tomar notificaciones');
unir('Tomar notificaciones', 'Recorrer cola');
unir('Recorrer cola', 'Armar mensaje', 1);           // salida 0 = terminado, 1 = siguiente elemento
unir('Armar mensaje', 'Enviar notificación', 0);
unir('Armar mensaje', 'Marcar fallida', 1);           // error al armar → se marca fallida
unir('Enviar notificación', 'Marcar enviada', 0);
unir('Enviar notificación', 'Marcar fallida', 1);
unir('Marcar enviada', 'Recordar reseña');
unir('Recordar reseña', 'Pausa anti-ráfaga');
unir('Marcar fallida', 'Pausa anti-ráfaga');
unir('Pausa anti-ráfaga', 'Recorrer cola');

/* ---------- Validación y salida ---------- */
const nombres = new Set(nodos.map((n) => n.name));
if (nombres.size !== nodos.length) throw new Error('Hay nombres de nodo repetidos');
for (const [desde, tipos] of Object.entries(conexiones)) {
    if (!nombres.has(desde)) throw new Error(`Conexión desde nodo inexistente: ${desde}`);
    for (const salidas of Object.values(tipos)) for (const s of salidas) for (const c of s) {
        if (!nombres.has(c.node)) throw new Error(`Conexión hacia nodo inexistente: ${c.node}`);
    }
}
// Los nodos Code de n8n corren como funciones async (pueden usar await): se validan igual
const FuncionAsync = Object.getPrototypeOf(async () => {}).constructor;
for (const n of nodos.filter((x) => x.type === 'n8n-nodes-base.code')) new FuncionAsync('$', '$input', '$getWorkflowStaticData', n.parameters.jsCode);

// Envíos por WhatsApp (Evolution): si la sesión se reconecta ("Connection Closed", 500) el mensaje no se pierde:
// 3 intentos con 5 s entre cada uno
for (const n of nodos) {
    if (n.type === 'n8n-nodes-base.httpRequest' && /\/message\/send(Text|Media)\//.test(String(n.parameters?.url ?? ''))) Object.assign(n, { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 });
}

const flujo = {
    name: 'DC Tecnology · Bot WhatsApp + Posventa',
    nodes: nodos,
    connections: conexiones,
    active: false,
    settings: { executionOrder: 'v1', timezone: 'America/Bogota', saveManualExecutions: true },
    pinData: {},
    meta: { templateCredsSetupCompleted: false },
    tags: [],
};
fs.writeFileSync(SALIDA, JSON.stringify(flujo, null, 2) + '\n', 'utf8');

// Panel → Prueba del sistema: el mismo código de cada nodo Code, como funciones normales, para simular el
// recorrido completo en el navegador sin enviar mensajes, sin cobrar y sin escribir en la base.
const NODOS_SIMULADOS = ['Normalizar mensaje', 'Revisar respuesta', 'Crear triangulación', 'Cotización ANC', 'Evaluar cotización', 'Enrutar evento',
    'Evaluar pago', 'Preparar compra ANC', 'Pedido ANC creado', 'Accesos en ANC', 'Preparar extracción', 'Validar credenciales', 'Mensaje de entrega'];
const configBot = nodos.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
fs.writeFileSync(path.join(__dirname, 'simulador-nodos.js'), [
    '// n8n/simulador-nodos.js — GENERADO por n8n/generar_flujo_n8n.js (no editar a mano).',
    '// Código real de los nodos del bot para el simulador del panel (Prueba del sistema). No envía nada.',
    `window.SimuladorFlujo = { version: ${JSON.stringify(kb.version)}, config: ${JSON.stringify(configBot)}, nodos: {`,
    ...NODOS_SIMULADOS.map((nombre) => {
        const n = nodos.find((x) => x.name === nombre);
        if (!n) throw new Error(`Simulador: no existe el nodo ${nombre}`);
        return `${JSON.stringify(nombre)}: function ($, $input, $getWorkflowStaticData) {\n${n.parameters.jsCode}\n},`;
    }),
    '} };',
    '',
].join('\n'), 'utf8');
console.log(`Flujo generado: ${path.relative(RAIZ, SALIDA)} · ${nodos.length} nodos · modelo ${MODELO}`);

module.exports = { comprobanteRecibido, responderMenu, leerProveedor, resultadoProveedor, normalizarMensaje, rutaAsesor, respuestaFija, armarContexto, revisarRespuesta, armarNotificacion, recordarResena, utilidades, kbEmbebida };
