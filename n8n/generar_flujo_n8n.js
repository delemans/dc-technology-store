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
    r = r
        .replace(/\*\*(.+?)\*\*/g, '*$1*')   // Markdown → negrita de WhatsApp
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, 1200);
    return [{ json: { numero: msg.numero, texto: r } }];
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
    .replace(/__HORARIO__/g, JSON.stringify(WA.HORARIO));

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
    palabras_asesor: kb.escalamiento.palabras_clave.join(','),
}));
nodoCodigo('Normalizar mensaje', [440, 0], normalizarMensaje, { conUtilidades: true });
const regla = (valor, salida) => ({
    conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{ id: uuid(), leftValue: '={{ $json.ruta }}', rightValue: valor, operator: { type: 'string', operation: 'equals' } }],
        combinator: 'and',
    },
    renameOutput: true,
    outputKey: salida,
});
nodo('Ruta', 'n8n-nodes-base.switch', 3.2, [660, 0], {
    rules: { values: [regla('baja', 'Baja'), regla('asesor', 'Asesor'), regla('sin_texto', 'Sin texto'), regla('comprobante', 'Comprobante')] },
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
        '**4. Requisitos:** supabase/wo-015.sql aplicado.',
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
unir('Ruta', 'Base de conocimiento', 4);              // salida extra (fallback) = IA
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
