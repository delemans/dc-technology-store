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
const SILICONFLOW_URL = 'https://api.siliconflow.cn/v1';
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
    catalogo: kb.catalogo.map(({ nombre, tipo, variantes }) => ({ nombre, tipo, variantes: variantes.map(({ nombre: n, precio }) => ({ nombre: n, precio })) })),
};

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
                `El bot queda en pausa ${__HORAS_PAUSA__} h para ese chat. Escribe #bot en el chat del cliente para reactivarlo.`,
            ].join('\n') } });
        }
        return salida;
    };
    const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
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
}

// A1 · Normaliza el evento de Evolution API y decide la ruta (baja / asesor / sin_texto / ia)
function normalizarMensaje() {
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
    const esComprobante = Boolean(m.imageMessage || (m.documentMessage && /pdf|image/i.test(String(m.documentMessage.mimetype ?? ''))));

    const memoria = $getWorkflowStaticData('global');
    memoria.pausados = memoria.pausados || {};
    memoria.vistos = memoria.vistos || [];
    memoria.ritmo = memoria.ritmo || {};
    memoria.resenas = memoria.resenas || {};
    const ahora = Date.now();
    for (const [n, t] of Object.entries(memoria.pausados)) if (ahora - t > __HORAS_PAUSA__ * 3600e3) delete memoria.pausados[n];

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

    return [{ json: { ruta, numero, texto: texto.slice(0, 1000), nombre: d.pushName ?? '', wamid: key.id ?? null } }];
}

// A2 · Ruta "asesor": pausa el bot y avisa
function rutaAsesor() {
    const cfg = $('Config bot').first().json;
    const msg = $input.first().json;
    const kb = __KB__;
    return escalar(msg, 'El cliente pidió un asesor o reportó un problema', cfg, kb.plantillas);
}

// A3 · Rutas sin IA: baja confirmada y mensajes sin texto
function respuestaFija() {
    const msg = $('Normalizar mensaje').first().json;
    const textos = {
        baja: 'Listo ✅ No te enviaremos más solicitudes de reseña. Seguirás recibiendo solo los avisos de tus pedidos.',
        sin_texto: 'Por ahora solo puedo leer mensajes de texto 🙏 Escríbeme tu consulta o "ASESOR" para hablar con una persona.',
    };
    return [{ json: { numero: msg.numero, texto: textos[msg.ruta] ?? textos.sin_texto } }];
}

// A3b · Comprobante recibido: confirma al cliente y avisa al administrador (el pago lo valida una persona)
function comprobanteRecibido() {
    const cfg = $('Config bot').first().json;
    const msg = $input.first().json;
    const salida = [{ json: { numero: msg.numero, texto: [
        '🧾 *¡Recibimos tu comprobante!*',
        '',
        `Lo estamos validando. Apenas se confirme, tu pedido sale en máximo *${__ENTREGA_MIN__} minutos* (${__HORARIO__}) y te llega por este chat.`,
        '',
        'No necesitas enviarlo de nuevo 🙌',
    ].join('\n') } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            '🧾 *Comprobante recibido*',
            `Cliente: +${msg.numero}${msg.nombre ? ` (${String(msg.nombre).slice(0, 40)})` : ''}`,
            msg.texto ? `Nota del cliente: ${msg.texto.slice(0, 200)}` : null,
            'Valídalo en el panel → Pagos & Bot.',
        ].filter(Boolean).join('\n') } });
    }
    return salida;
}

// A4 · Contexto del agente: base de conocimiento en vivo (o la embebida) + cuentas activas de Supabase
function armarContexto() {
    const msg = $('Normalizar mensaje').first().json;
    const enVivo = $('Base de conocimiento').first().json;
    const base = enVivo && enVivo.prompt_sistema && enVivo.plantillas ? enVivo : __KB__;
    const cuentas = $('Metodos de pago').all().map((i) => i.json).filter((m) => m && m.numero_cuenta);
    const cop = (v) => `$${Number(v).toLocaleString('es-CO')}`;
    const ahora = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'short' });

    const sistema = [
        base.prompt_sistema,
        '',
        `Fecha y hora en Colombia: ${ahora}.`,
        '',
        'CUENTAS DE PAGO ACTIVAS (las únicas que puedes compartir, tal cual):',
        cuentas.length
            ? cuentas.map((c) => `- ${c.banco_alias ?? 'Cuenta'}: ${c.numero_cuenta}${c.titular ? ` (titular: ${c.titular})` : ''}`).join('\n')
            : '- NO hay cuentas activas: no compartas datos de pago; escala a un asesor.',
        '',
        'PROMOCIONES ACTIVAS:',
        ...(base.promociones ?? []).filter((p) => p.activa && !p.pendiente_configurar).map((p) => `- ${p.descripcion}`),
        '',
        'PREGUNTAS FRECUENTES (usa estas respuestas):',
        ...(base.faq ?? []).filter((f) => !f.pendiente_configurar && f.respuesta).map((f) => `- ${f.pregunta} → ${f.respuesta}`),
        '',
        'REGLAS DE USO DE LAS CUENTAS:',
        ...(base.reglas_uso ?? []).map((r) => `- ${r}`),
        '',
        'CATÁLOGO (precios en COP, solo estos):',
        ...(base.catalogo ?? []).map((p) => `- ${p.nombre} [${p.tipo}]: ${(p.variantes ?? []).map((v) => `${v.nombre} ${Number(v.precio) > 0 ? cop(v.precio) : 'a cotizar'}`).join('; ')}`),
        '',
        'FORMATO: español de Colombia, máximo 6 líneas, *negrita* de WhatsApp solo para datos clave, sin títulos ni tablas.',
        'PRODUCTOS DIGITALES (venta y soporte completos, sin pasar a un asesor):',
        ...(base.flujo_digital ?? []).map((x) => `- ${x}`),
        'ESCALAMIENTO: si aplica cualquier disparador de escalamiento, responde EXACTAMENTE "[ESCALAR] <motivo breve>" y nada más.',
        'PEDIDO DIGITAL: cuando el cliente CONFIRME un producto digital del catálogo (streaming, licencias, pines o recargas) y su opción, agrega al FINAL de tu respuesta, en una línea aparte: [PEDIDO_DIGITAL] {"producto":"<nombre exacto del catálogo>","variante":"<opción exacta>"}. Una sola vez por pedido. El cliente no ve esa línea. Luego sigue con el pago normalmente.',
    ].join('\n');

    return [{ json: { numero: msg.numero, texto: msg.texto, sistema } }];
}

// A5 · Revisa la respuesta del agente antes de enviarla
function revisarRespuesta() {
    const cfg = $('Config bot').first().json;
    const msg = $('Normalizar mensaje').first().json;
    const kb = __KB__;
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
    r = r
        .replace(/\*\*(.+?)\*\*/g, '*$1*')   // Markdown → negrita de WhatsApp
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 1200);
    return [{ json: { numero: msg.numero, texto: r, pedido: digital } }];
}

// B1 · Posventa: arma el texto de la notificación con la plantilla de su tipo
function armarNotificacion() {
    const n = $input.first().json;
    if (!n || !n.id) return []; // cola vacía: nada que enviar (y nada que marcar)
    const enVivo = $('Plantillas posventa').first().json;
    const base = enVivo && enVivo.plantillas && enVivo.notificaciones ? enVivo : __KB__;
    const clave = base.notificaciones.plantilla_por_tipo[n.tipo];
    const plantilla = base.plantillas[clave] ?? __KB__.plantillas[clave];
    if (!plantilla) throw new Error(`Sin plantilla para ${n.tipo}`);
    const texto = rellenar(plantilla, n.variables ?? {});
    if (texto.length < 20) throw new Error('Mensaje vacío o incompleto');
    return [{ json: { id: n.id, tipo: n.tipo, numero: n.destino, texto } }];
}

// B2 · Recuerda a quién se pidió reseña (el bot interpreta su "NO" como baja durante 7 días)
function recordarResena() {
    const n = $('Recorrer cola').first().json;
    if (n.tipo === 'SOLICITUD_RESENA') {
        const memoria = $getWorkflowStaticData('global');
        memoria.resenas = memoria.resenas || {};
        memoria.resenas[n.destino] = Date.now();
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
    // Sin proveedor o sin tu número de aviso no hay a quién cotizar ni a quién pedir el pago
    if (!p || !soloDigitos(cfg.numero_proveedor) || !soloDigitos(cfg.numero_aviso_admin)) return [];
    const memoria = $getWorkflowStaticData('global');
    memoria.pedidos = memoria.pedidos || {};
    const ahora = Date.now();
    for (const [k, t] of Object.entries(memoria.pedidos)) if (ahora - t > 2 * 3600e3) delete memoria.pedidos[k];
    const clave = `${item.numero}|${p.producto}|${p.variante}`;
    if (memoria.pedidos[clave]) return []; // la IA repitió el pedido: no se cotiza dos veces
    memoria.pedidos[clave] = ahora;

    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let referencia = 'DC-';
    for (let i = 0; i < 5; i++) referencia += alfabeto[Math.floor(Math.random() * alfabeto.length)];
    const msg = $('Normalizar mensaje').first().json;
    return [{ json: {
        referencia,
        cliente: item.numero,
        cliente_nombre: String(msg.nombre ?? '').slice(0, 60),
        producto: p.producto,
        variante: p.variante,
        precio_venta: p.precio,
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
    const demora = 'Tu pedido está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏';
    if (!b) terminar('VENCIDO', `⏰ El proveedor no respondió la cotización de *#${t.referencia}* (${t.producto}) en __HORAS_COTIZACION__ h. Atiéndelo a mano.`, demora);
    if (b.tipo === 'cancelar') terminar('CANCELADO', `🛑 Pedido *#${t.referencia}* cancelado.`, null);
    const texto = String(b.texto ?? '');
    if (/(no hay|agotad|sin stock|no tengo|no disponible|no manejo)/.test(normalizar(texto))) {
        terminar('AGOTADO', `❌ Proveedor sin disponibilidad para *#${t.referencia}* (${t.producto}). Dijo: «${texto.slice(0, 200)}»`,
            `Por ahora no tenemos disponible *${t.producto}* 😔 Escríbeme y te muestro otra opción.`);
    }
    const costo = precioDe(texto);
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
    ].join('\n') } }];
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
    return [{ json: { numero: t.cliente, texto, clave_final: String(c.clave).slice(-4), confianza: c.confianza } }];
}

// C9 · Aviso al administrador tras entregar
function avisoEntrega() {
    const t = $('Crear triangulación').first().json;
    const cfg = $('Config bot').first().json;
    const aviso = soloDigitos(cfg.numero_aviso_admin);
    const e = $('Mensaje de entrega').first().json;
    return aviso ? [{ json: { numero: aviso, texto: `✅ *Entregado #${t.referencia}* · ${t.producto}\nCliente: +${t.cliente} · clave terminada en …${e.clave_final}` } }] : [];
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
    return [{ json: { referencia: t.referencia, patch: { estado: datos.estado, esperando: null, resume_url: null, notas: String(datos.avisoAdmin ?? '').slice(0, 500) }, mensajes } }];
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

    if (msg.origen === 'admin') {
        const t = abiertas.find((r) => r.referencia === msg.referencia);
        if (!t) return avisar(msg.numero, `No encuentro un pedido abierto *#${msg.referencia}*.`);
        if (msg.accion === 'pago' && t.esperando !== 'PAGO_ADMIN') return avisar(msg.numero, `*#${t.referencia}* no está esperando tu pago (estado: ${t.estado}).`);
        if (msg.accion === 'pago' && !msg.conMedia) return avisar(msg.numero, `Envía la FOTO o PDF del comprobante con el texto *#pago ${t.referencia}*.`);
        if (msg.accion === 'aprobar' && t.esperando !== 'APROBACION') return avisar(msg.numero, `*#${t.referencia}* no está esperando aprobación (estado: ${t.estado}).`);
        if (!t.resume_url) return avisar(msg.numero, `*#${t.referencia}* no tiene una espera activa. Revísalo a mano.`);
        return [{ json: { accion: 'reanudar', url: t.resume_url, cuerpo: { tipo: msg.accion, texto: msg.texto, wamid: msg.wamid } } }];
    }

    // Proveedor: 1) mensaje citado, 2) referencia en el texto, 3) único pedido esperándolo
    const ref = /DC-[A-Z0-9]{4,8}/.exec(String(msg.texto).toUpperCase())?.[0];
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

/* ==================== SERIALIZACIÓN ==================== */

const cuerpo = (fn) => {
    const s = fn.toString();
    return s.slice(s.indexOf('{') + 1, s.lastIndexOf('}')).replace(/^\n/, '').replace(/^ {4}/gm, '');
};
const UTILIDADES = cuerpo(utilidades);
const codigo = (fn, { conUtilidades = false } = {}) => ((conUtilidades ? `${UTILIDADES}\n` : '') + cuerpo(fn))
    .replace(/__KB__/g, `(${JSON.stringify(kbEmbebida)})`)
    .replace(/__HORAS_PAUSA__/g, String(HORAS_PAUSA_ASESOR))
    .replace(/__ENTREGA_MIN__/g, String(WA.ENTREGA_MAX_MIN))
    .replace(/__HORARIO__/g, JSON.stringify(WA.HORARIO))
    .replace(/__HORAS_COTIZACION__/g, String(HORAS_COTIZACION))
    .replace(/__HORAS_PAGO__/g, String(HORAS_PAGO))
    .replace(/__HORAS_CREDENCIALES__/g, String(HORAS_CREDENCIALES));

const uuid = () => crypto.randomUUID();
const nodos = [];
const nodo = (name, type, typeVersion, position, parameters, extra = {}) => {
    nodos.push({ parameters, id: uuid(), name, type, typeVersion, position, ...extra });
    return name;
};
const nodoCodigo = (name, position, fn, opciones = {}, extra = {}) =>
    nodo(name, 'n8n-nodes-base.code', 2, position, { jsCode: codigo(fn, opciones) }, extra);
const set = (asignaciones) => ({
    assignments: { assignments: Object.entries(asignaciones).map(([name, value]) => ({ id: uuid(), name, value, type: 'string' })) },
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
nodo('Config bot', 'n8n-nodes-base.set', 3.4, [220, 0], set({
    ...configComun,
    numero_aviso_admin: '',
    numero_proveedor: '', // WhatsApp de ALL NECESSARY COLOMBIA (vacío = triangulación desactivada)
    palabras_asesor: kb.escalamiento.palabras_clave.join(','),
}));
nodoCodigo('Normalizar mensaje', [440, 0], normalizarMensaje, { conUtilidades: true });
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
nodo('Registrar baja', 'n8n-nodes-base.httpRequest', 4.2, [900, -300], supabaseRpc('registrar_baja_whatsapp', {
    config: 'Config bot',
    body: "={{ JSON.stringify({ p_numero: $json.numero }) }}",
}), { onError: 'continueRegularOutput' });
nodoCodigo('Respuesta fija', [1120, -200], respuestaFija);
nodoCodigo('Escalar a asesor', [900, -100], rutaAsesor, { conUtilidades: true });
nodoCodigo('Comprobante recibido', [900, 0], comprobanteRecibido);
nodo('Base de conocimiento', 'n8n-nodes-base.httpRequest', 4.2, [900, 140], {
    url: "={{ $('Config bot').first().json.url_conocimiento }}",
    options: { timeout: 8000, response: { response: { responseFormat: 'json' } } },
}, { onError: 'continueRegularOutput', alwaysOutputData: true });
nodo('Metodos de pago', 'n8n-nodes-base.httpRequest', 4.2, [1120, 140], {
    url: "={{ $('Config bot').first().json.supabase_url }}/rest/v1/metodos_pago?activo=eq.true&select=banco_alias,numero_cuenta,titular",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'supabaseApi',
    options: { timeout: 8000 },
}, { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
nodoCodigo('Armar contexto', [1340, 140], armarContexto);
nodo('Agente IA', '@n8n/n8n-nodes-langchain.agent', 1.7, [1560, 140], {
    promptType: 'define',
    text: '={{ $json.texto }}',
    options: { systemMessage: '={{ $json.sistema }}', maxIterations: 3 },
}, { onError: 'continueRegularOutput' });
nodo('SiliconFlow · DeepSeek-V3', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.2, [1480, 360], {
    model: { __rl: true, value: MODELO, mode: 'id' },
    options: { baseURL: SILICONFLOW_URL, temperature: 0.3, maxTokens: 500, timeout: 45000, maxRetries: 2 },
});
nodo('Memoria por cliente', '@n8n/n8n-nodes-langchain.memoryBufferWindow', 1.3, [1660, 360], {
    sessionIdType: 'customKey',
    sessionKey: "={{ $('Normalizar mensaje').first().json.numero }}",
    contextWindowLength: 8,
});
nodoCodigo('Revisar respuesta', [1780, 140], revisarRespuesta, { conUtilidades: true });
nodo('Enviar respuesta', 'n8n-nodes-base.httpRequest', 4.2, [2000, 0], evolutionEnviar('Config bot'), { onError: 'continueRegularOutput' });

/* ---------- C) Triangulación ---------- */
const Y = 1300; // fila de la triangulación en el lienzo
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
const PROVEEDOR = "String($('Config bot').first().json.numero_proveedor).replace(/\\D/g, '')";
const ADMIN = "String($('Config bot').first().json.numero_aviso_admin).replace(/\\D/g, '')";
const terminal = { onError: 'continueErrorOutput' };

nodoCodigo('Crear triangulación', [2000, Y], crearTriangulacion, { conUtilidades: true });
nodo('Registrar triangulación', 'n8n-nodes-base.httpRequest', 4.2, [2220, Y], supabaseTabla('POST', '',
    "={{ JSON.stringify({ referencia: $json.referencia, cliente: $json.cliente, cliente_nombre: $json.cliente_nombre, producto: $json.producto, variante: $json.variante, precio_venta: $json.precio_venta, estado: 'COTIZANDO', esperando: 'COTIZACION', resume_url: $execution.resumeUrl }) }}"));
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
nodo('Guardar pago enviado', 'n8n-nodes-base.httpRequest', 4.2, [4640, Y], supabaseTabla('PATCH', porReferencia,
    "={{ JSON.stringify({ wamid_pago: $json.key?.id ?? null, estado: 'ESPERANDO_CREDENCIALES', esperando: 'CREDENCIALES' }) }}"));
nodo('Esperar credenciales', 'n8n-nodes-base.wait', 1.1, [4860, Y], esperar(HORAS_CREDENCIALES), { webhookId: uuid() });
nodoCodigo('Preparar extracción', [5080, Y], prepararExtraccion, { conUtilidades: true }, terminal);
nodo('Extraer credenciales', '@n8n/n8n-nodes-langchain.chainLlm', 1.5, [5300, Y], { promptType: 'define', text: '={{ $json.prompt }}' }, terminal);
nodo('SiliconFlow · Extractor', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.2, [5300, Y + 220], {
    model: { __rl: true, value: MODELO, mode: 'id' },
    options: { baseURL: SILICONFLOW_URL, temperature: 0, maxTokens: 300, timeout: 45000, maxRetries: 2 },
});
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
nodoCodigo('Aviso de entrega', [7720, Y], avisoEntrega, { conUtilidades: true });
nodoCodigo('Cerrar triangulación', [4200, Y + 500], cerrarTriangulacion, { conUtilidades: true });
nodo('Guardar cierre', 'n8n-nodes-base.httpRequest', 4.2, [4420, Y + 500], supabaseTabla('PATCH', '?referencia=eq.{{ $json.referencia }}',
    '={{ JSON.stringify($json.patch) }}'), { onError: 'continueRegularOutput', executeOnce: true });
nodoCodigo('Mensajes de cierre', [4640, Y + 500], mensajesCierre);
nodo('Enviar aviso triangulación', 'n8n-nodes-base.httpRequest', 4.2, [4860, Y + 500], enviarA('$json.numero', '$json.texto'), { onError: 'continueRegularOutput' });

// Enrutador: mensajes del proveedor y comandos del admin → la espera del pedido correcto
nodo('Pedidos abiertos', 'n8n-nodes-base.httpRequest', 4.2, [900, -520],
    supabaseTabla('GET', '?estado=not.in.(ENTREGADO,CANCELADO,VENCIDO,AGOTADO)&select=referencia,estado,esperando,resume_url,wamid_cotizacion,wamid_pago&order=id.desc&limit=50'),
    { alwaysOutputData: true, executeOnce: true });
nodoCodigo('Enrutar evento', [1120, -520], enrutarEvento, { conUtilidades: true });
nodo('Acción', 'n8n-nodes-base.switch', 3.2, [1340, -520], {
    rules: { values: [regla('reanudar', 'Reanudar', 'accion'), regla('avisar', 'Avisar', 'accion')] },
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

/* ---------- B) Posventa ---------- */
nodo('Cada minuto', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 700], { rule: { interval: [{ field: 'minutes', minutesInterval: 1 }] } });
nodo('Config posventa', 'n8n-nodes-base.set', 3.4, [220, 700], set({ ...configComun, lote: '5' }));
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
        '## DC Technology · Bot + Posventa',
        `Generado ${new Date().toISOString().slice(0, 10)} desde bot-conocimiento.json (no editar a mano: regenerar).`,
        '',
        '**1. Credenciales (asígnalas en cada nodo marcado):**',
        '- *Supabase*: Host `' + SUPABASE_URL + '` + **service_role** (nunca en el sitio web).',
        '- *Header Auth* "Evolution": Name `apikey`, Value = tu API key.',
        `- *OpenAI* "SiliconFlow": API key de SiliconFlow y Base URL \`${SILICONFLOW_URL}\` (usa .com si tu cuenta es internacional).`,
        '',
        '**2. Nodos Config bot / Config posventa:** URL e instancia de Evolution. `numero_aviso_admin` = tu WhatsApp personal para avisos de escalamiento (vacío = sin aviso).',
        '',
        '**3. Evolution API → Webhook:** URL de producción de "Webhook Evolution", evento `MESSAGES_UPSERT`.',
        '',
        '**4. Requisitos:** supabase/wo-015.sql y wo-024-triangulacion.sql aplicados.',
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
unir('Config bot', 'Normalizar mensaje');
unir('Normalizar mensaje', 'Ruta');
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
unir('Metodos de pago', 'Armar contexto');
unir('Armar contexto', 'Agente IA');
unir('SiliconFlow · DeepSeek-V3', 'Agente IA', 0, 'ai_languageModel');
unir('Memoria por cliente', 'Agente IA', 0, 'ai_memory');
unir('Agente IA', 'Revisar respuesta');
unir('Revisar respuesta', 'Enviar respuesta');
unir('Revisar respuesta', 'Crear triangulación');

// C) Triangulación (salida 1 de los nodos con error = "terminar" → cierre)
unir('Ruta', 'Pedidos abiertos', 4);
unir('Pedidos abiertos', 'Enrutar evento');
unir('Enrutar evento', 'Acción');
unir('Acción', 'Reanudar espera', 0);
unir('Acción', 'Enviar respuesta', 1);
const cadena = ['Crear triangulación', 'Registrar triangulación', 'Cotizar al proveedor', 'Guardar cotización enviada', 'Esperar cotización',
    'Evaluar cotización', 'Pedir pago al admin', 'Guardar costo', 'Esperar pago del admin', 'Evaluar pago', 'Descargar comprobante',
    'Reenviar pago al proveedor', 'Guardar pago enviado', 'Esperar credenciales', 'Preparar extracción', 'Extraer credenciales', 'Validar credenciales', '¿Entregar?'];
cadena.slice(0, -1).forEach((n, i) => unir(n, cadena[i + 1]));
unir('SiliconFlow · Extractor', 'Extraer credenciales', 0, 'ai_languageModel');
unir('¿Entregar?', 'Mensaje de entrega', 0);
unir('¿Entregar?', 'Pedir aprobación', 1);
['Pedir aprobación', 'Enviar revisión al admin', 'Guardar revisión', 'Esperar aprobación', 'Evaluar aprobación', 'Mensaje de entrega']
    .forEach((n, i, a) => { if (a[i + 1]) unir(n, a[i + 1]); });
unir('Mensaje de entrega', 'Enviar accesos al cliente');
unir('Enviar accesos al cliente', 'Guardar entrega');
unir('Guardar entrega', 'Aviso de entrega');
unir('Aviso de entrega', 'Enviar aviso triangulación');
for (const n of nodos.filter((x) => x.onError === 'continueErrorOutput' && x.position[1] >= Y)) unir(n.name, 'Cerrar triangulación', 1);
unir('Cerrar triangulación', 'Guardar cierre');
unir('Guardar cierre', 'Mensajes de cierre');
unir('Mensajes de cierre', 'Enviar aviso triangulación');

unir('Cada minuto', 'Config posventa');
unir('Config posventa', 'Plantillas posventa');
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
for (const n of nodos.filter((x) => x.type === 'n8n-nodes-base.code')) new Function('$', '$input', '$getWorkflowStaticData', n.parameters.jsCode);

const flujo = {
    name: 'DC Technology · Bot WhatsApp + Posventa',
    nodes: nodos,
    connections: conexiones,
    active: false,
    settings: { executionOrder: 'v1', timezone: 'America/Bogota', saveManualExecutions: true },
    pinData: {},
    meta: { templateCredsSetupCompleted: false },
    tags: [],
};
fs.writeFileSync(SALIDA, JSON.stringify(flujo, null, 2) + '\n', 'utf8');
console.log(`Flujo generado: ${path.relative(RAIZ, SALIDA)} · ${nodos.length} nodos · modelo ${MODELO}`);

module.exports = { comprobanteRecibido, normalizarMensaje, rutaAsesor, respuestaFija, armarContexto, revisarRespuesta, armarNotificacion, recordarResena, utilidades, kbEmbebida };
