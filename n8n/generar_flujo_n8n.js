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
            return { producto: p.nombre, variante, anc_producto: e.proveedor, anc_plan: plan };
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
    const montoCripto = __MONTO_CRIPTO__;
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
    // Hash de transacción cripto (TXID): 64 hex (BTC, ETH/BEP20/TRC20…) o firma de Solana (base58, ~88)
    const txid = (/\b(?:0x)?[0-9a-fA-F]{64}\b/.exec(texto) || /\b[1-9A-HJ-NP-Za-km-z]{86,90}\b/.exec(texto) || [])[0] ?? null;
    const esComprobante = Boolean(m.imageMessage || txid || (m.documentMessage && /pdf|image/i.test(String(m.documentMessage.mimetype ?? ''))));

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

    return [{ json: { ruta, numero, texto: texto.slice(0, 1000), nombre: d.pushName ?? '', wamid: key.id ?? null, txid } }];
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
        msg.txid ? '🔗 *¡Recibimos el hash de tu transacción!*' : '🧾 *¡Recibimos tu comprobante!*',
        '',
        `${msg.txid ? 'La verificamos en la red.' : 'Lo estamos validando.'} Apenas se confirme, tu pedido sale en máximo *${__ENTREGA_MIN__} minutos* (${__HORARIO__}) y te llega por este chat.`,
        '',
        'No necesitas enviarlo de nuevo 🙌',
    ].join('\n') } }];
    const aviso = String(cfg.numero_aviso_admin ?? '').replace(/\D/g, '');
    if (aviso) {
        salida.push({ json: { numero: aviso, texto: [
            msg.txid ? `🔗 *Pago cripto · TXID*\n${msg.txid}` : '🧾 *Comprobante recibido*',
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
            ...(locales.length ? locales.map(linea) : ['- (ninguno activo)']),
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
        'PEDIDO COMBO: si lo que el cliente confirma es un COMBO (2 o más plataformas), en vez de [PEDIDO_DIGITAL] agrega al FINAL, en una línea aparte: [PEDIDO_COMBO] {"items":[{"producto":"<nombre exacto>","variante":"<opción exacta>"}]}. Una sola vez por combo.',
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
}

// C2 · Respuesta del proveedor a la cotización (o fin de la espera)
function evaluarCotizacion() {
    const t = $('Crear triangulación').first().json;
    const b = $input.first().json.body;
    const demora = 'Tu pedido está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏';
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

/* ---------- C-web) Compra en el portal del proveedor (WO-035) ----------
   Mismo pedido, mismas esperas y misma extracción que por WhatsApp; cambian tres pasos:
   cotizar (catálogo público de ancpagos.com), comprar (procesar_pago con tu comprobante) y leer los
   accesos (página del pedido en ANC, que "Pedidos ANC cada minuto" revisa y entrega a "Esperar credenciales"). */

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
    return [{ json: { body: {
        tipo: 'web',
        eq,
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
    if (!c || (!web && (!Array.isArray(c.items) || c.items.length < 2)) || !soloDigitos(cfg.numero_proveedor) || !soloDigitos(cfg.numero_aviso_admin)) return [];
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
    return [{ json: {
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
    const demora = 'Tu combo está tomando más tiempo de lo normal; un asesor te escribe enseguida 🙏';
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

/* ==================== SERIALIZACIÓN ==================== */

const cuerpo = (fn) => {
    const s = fn.toString();
    return s.slice(s.indexOf('{') + 1, s.lastIndexOf('}')).replace(/^\n/, '').replace(/^ {4}/gm, '');
};
const UTILIDADES = cuerpo(utilidades).replace('__MONTO_CRIPTO__', WA.montoCripto.toString());
const codigo = (fn, { conUtilidades = false } = {}) => ((conUtilidades ? `${UTILIDADES}\n` : '') + cuerpo(fn))
    .replace(/__KB__/g, `(${JSON.stringify(kbEmbebida)})`)
    .replace(/__HORAS_PAUSA__/g, String(HORAS_PAUSA_ASESOR))
    .replace(/__ENTREGA_MIN__/g, String(WA.ENTREGA_MAX_MIN))
    .replace(/__HORARIO__/g, JSON.stringify(WA.HORARIO))
    .replace(/__HORAS_COTIZACION__/g, String(HORAS_COTIZACION))
    .replace(/__HORAS_PAGO__/g, String(HORAS_PAGO))
    .replace(/__HORAS_CREDENCIALES__/g, String(HORAS_CREDENCIALES))
    .replace(/__ANC_MAPA__/g, `(${JSON.stringify(ancMapa)})`);

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
    canal_compra: 'web',
    anc_url: 'https://ancpagos.com',
    anc_metodo: 'nequi',   // clave del medio de pago de ANC con el que les pagas (nequi, daviplata, brebManual, bancolombia)
    anc_correo: '',        // correo donde ANC envía los accesos (obligatorio para comprar por web)
    anc_nombre: 'DC',
    anc_apellido: 'Technology',
    anc_whatsapp: '',      // vacío = tu número de aviso
    palabras_asesor: kb.escalamiento.palabras_clave.join(','),
}, { incluirEntrada: true }));
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
nodoCodigo('Armar contexto', [1340, 140], armarContexto, { conUtilidades: true });
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
const PROVEEDOR = "String($('Config bot').first().json.numero_proveedor).replace(/\\D/g, '')";
const ADMIN = "String($('Config bot').first().json.numero_aviso_admin).replace(/\\D/g, '')";
const terminal = { onError: 'continueErrorOutput' };

// WO-033: entrada del despacho de órdenes web
nodo('Origen', 'n8n-nodes-base.switch', 3.2, [330, 0], {
    rules: { values: [regla('si', 'Despacho', 'despacho'), regla('si', 'ANC', 'revisar_anc'), regla('si', 'Posventa', 'posventa'), regla('si', 'Evolution', 'configurar_evolution')] },
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
nodoCodigo('Cotización ANC', [2880, Y - 420], cotizacionAnc, { conUtilidades: true }, terminal);
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
nodo('Extraer credenciales combo', '@n8n/n8n-nodes-langchain.chainLlm', 1.5, [5960, YC], { promptType: 'define', text: '={{ $json.prompt }}' }, terminal);
nodo('SiliconFlow · Extractor combo', '@n8n/n8n-nodes-langchain.lmChatOpenAi', 1.2, [5960, YC + 220], {
    model: { __rl: true, value: MODELO, mode: 'id' },
    options: { baseURL: SILICONFLOW_URL, temperature: 0, maxTokens: 900, timeout: 60000, maxRetries: 2 },
});
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
    "={{ JSON.stringify({ webhook: { enabled: true, url: $('Config bot').first().json.webhook_publico, byEvents: false, base64: false, events: ['MESSAGES_UPSERT'] } }) }}"),
{ onError: 'continueRegularOutput', alwaysOutputData: true });
nodo('Webhook Evolution v1', 'n8n-nodes-base.httpRequest', 4.2, [880, -560], evolutionApi('POST', 'set',
    "={{ JSON.stringify({ enabled: true, url: $('Config bot').first().json.webhook_publico, webhook_by_events: false, webhook_base64: false, events: ['MESSAGES_UPSERT'] }) }}"),
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
        '**Una sola configuración (WO-037):** todo se configura en *Config bot*; *Config posventa* copia de ahí sus valores.',
        '',
        '**Latidos (WO-036):** cada rama programada marca un latido; Panel → Prueba del sistema muestra si n8n está vivo (aplica supabase/wo-036-diagnostico.sql).',
        '',
        '**Compra al proveedor (WO-035):** `canal_compra` = `web` compra en ancpagos.com (cotiza solo, tú pagas y envías la captura con #pago, el bot crea el pedido y lee los accesos de su página cada minuto); `whatsapp` = por chat con `numero_proveedor`. Para web llena `anc_correo` y `anc_metodo`, y aplica supabase/wo-035-compra-web-anc.sql.',
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
unir('Origen', 'Normalizar mensaje', 4);
unir('Origen', 'Latido bot', 4);
unir('Configurar Evolution', 'Marcar configuración Evolution');
unir('Marcar configuración Evolution', 'Config bot');
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
unir('Metodos de pago', 'Reglas combo');
unir('Reglas combo', 'Armar contexto');
unir('Armar contexto', 'Agente IA');
unir('SiliconFlow · DeepSeek-V3', 'Agente IA', 0, 'ai_languageModel');
unir('Memoria por cliente', 'Agente IA', 0, 'ai_memory');
unir('Agente IA', 'Revisar respuesta');
unir('Revisar respuesta', 'Enviar respuesta');
unir('Revisar respuesta', 'Crear triangulación');
unir('Revisar respuesta', 'Crear combo');

// C) Triangulación (salida 1 de los nodos con error = "terminar" → cierre)
unir('Ruta', 'Pedidos abiertos', 4);
unir('Pedidos abiertos', 'Enrutar evento');
unir('Enrutar evento', 'Acción');
unir('Acción', 'Reanudar espera', 0);
unir('Acción', 'Enviar respuesta', 1);
const enCadena = (lista) => lista.slice(0, -1).forEach((n, i) => unir(n, lista[i + 1]));
enCadena(['Crear triangulación', 'Registrar triangulación', 'Vincular al panel', '¿Compra web?']);
// Salida 0 = portal de ANC (WO-035) · salida 1 = WhatsApp del proveedor
unir('¿Compra web?', 'Catálogo ANC', 0);
enCadena(['Catálogo ANC', 'Medios de pago ANC', 'Cotización ANC', 'Evaluar cotización']);
unir('¿Compra web?', 'Cotizar al proveedor', 1);
enCadena(['Cotizar al proveedor', 'Guardar cotización enviada', 'Esperar cotización', 'Evaluar cotización']);
enCadena(['Evaluar cotización', 'Pedir pago al admin', 'Guardar costo', 'Esperar pago del admin', 'Evaluar pago', 'Descargar comprobante', '¿Pago web?']);
unir('¿Pago web?', 'Preparar compra ANC', 0);
enCadena(['Preparar compra ANC', 'Comprar en ANC', 'Pedido ANC creado', 'Guardar compra ANC', 'Marcar pedido realizado']);
unir('Guardar compra ANC', 'Avisar pedido ANC');
unir('¿Pago web?', 'Reenviar pago al proveedor', 1);
enCadena(['Reenviar pago al proveedor', 'Guardar pago enviado', 'Marcar pedido realizado']);
enCadena(['Marcar pedido realizado', 'Esperar credenciales', 'Preparar extracción', 'Extraer credenciales', 'Validar credenciales', '¿Entregar?']);
unir('SiliconFlow · Extractor', 'Extraer credenciales', 0, 'ai_languageModel');
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
['Crear combo', 'Registrar combo', 'Líneas del combo', 'Vincular combo al panel', 'Cotizar combo al proveedor', 'Guardar cotización combo',
    'Esperar cotización combo', 'Evaluar cotización combo', 'Pedir pago combo al admin', 'Guardar costo combo', 'Líneas agotadas', '¿Hay agotadas?']
    .forEach((n, i, a) => { if (a[i + 1]) unir(n, a[i + 1]); });
unir('¿Hay agotadas?', 'Avisar agotadas al cliente', 0);
unir('¿Hay agotadas?', 'Esperar pago combo', 1);
unir('Avisar agotadas al cliente', 'Esperar pago combo');
['Esperar pago combo', 'Evaluar pago combo', 'Descargar comprobante combo', 'Reenviar pago combo', 'Guardar pago combo', 'Marcar combo realizado',
    'Esperar credenciales combo', 'Preparar extracción combo', 'Extraer credenciales combo', 'Entregar combo', 'Enviar accesos combo',
    'Guardar entrega combo', 'Cerrar combo entregado', 'Aviso combo al admin']
    .forEach((n, i, a) => { if (a[i + 1]) unir(n, a[i + 1]); });
unir('SiliconFlow · Extractor combo', 'Extraer credenciales combo', 0, 'ai_languageModel');
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

module.exports = { comprobanteRecibido, normalizarMensaje, rutaAsesor, respuestaFija, armarContexto, revisarRespuesta, armarNotificacion, recordarResena, utilidades, kbEmbebida };
