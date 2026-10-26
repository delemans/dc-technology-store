// herramientas/sincronizar-emprendered.mjs — Catálogo del proveedor Emprende Red (dropshipping) → JSON normalizado.
//
//   node herramientas/sincronizar-emprendered.mjs [--ia [--limite N]] [salida.json]
//
// Paso 1 (este archivo): lee TODO el catálogo de la tienda de prueba en catalogovirtual.co, sin sesión ni navegador.
// La página es Inertia.js: la primera trae los datos en <script data-page="app" type="application/json">, y las
// siguientes se piden igual que el "cargar más" de la tienda (cabeceras X-Inertia → JSON directo, 20 por página).
// No usa la contraseña del panel del proveedor: el catálogo es público.
// Sus precios: price_buy = NUESTRO COSTO, price_sale = precio de venta sugerido, price_before = precio "antes" del
// proveedor (referencia de descuento: no se muestra en la tienda, regla de cero descuentos inventados).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pedirIA } from './ia.mjs';

// 19/10/2026: catálogo de distribuidor en emprendered.com.co (antes la tienda de prueba dctechnology.catalogovirtual.co).
// Allí "price_sale" ES el precio de distribuidor = NUESTRO COSTO (verificado: coincide con el price_buy de la tienda anterior
// en 21 de 21 productos) y "price_buy" viene en 0.
export const BASE_EMPRENDERED = 'https://emprendered.com.co';
const CATALOGO = `${BASE_EMPRENDERED}/catalogo`;
const SALIDA = 'herramientas/salida/emprendered.json';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const MAX_PAGINAS = 500;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function pedir(url, cabeceras = {}) {
    try {
        return await fetch(url, { headers: { 'User-Agent': UA, ...cabeceras }, signal: AbortSignal.timeout(20000) });
    } catch (e) {
        const causa = String(e.cause?.code ?? e.cause ?? e.message);
        throw new Error(/CERT|SELF_SIGNED/i.test(causa)
            ? 'certificado (Kaspersky): ejecuta con NODE_EXTRA_CA_CERTS=C:\\evolution-api\\kaspersky-ca.pem'
            : `no pude conectar con ${url}: ${causa}`);
    }
}

// Primera página: el objeto de Inertia viene en el HTML
async function primeraPagina() {
    const r = await pedir(CATALOGO, { Accept: 'text/html' });
    if (!r.ok) throw new Error(`${CATALOGO} respondió ${r.status} (¿venció la tienda de prueba?)`);
    const html = await r.text();
    const bloque = /<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (!bloque) throw new Error('No encontré <script data-page="app">: la tienda cambió de estructura.');
    return JSON.parse(bloque[1]);
}

// Páginas siguientes: JSON directo de Inertia. Si el sitio se actualizó (409), se toma la versión nueva y se repite.
async function pagina(numero, version) {
    const pedirJson = (v) => pedir(`${CATALOGO}?page=${numero}`, {
        'X-Inertia': 'true', 'X-Inertia-Version': v, 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/html, application/xhtml+xml',
    });
    let r = await pedirJson(version);
    if (r.status === 409) r = await pedirJson((await primeraPagina()).version);
    if (!r.ok) throw new Error(`página ${numero} respondió ${r.status}`);
    return r.json();
}

const unicos = (lista) => [...new Set(lista.filter(Boolean))];

// Producto del proveedor → nuestro formato (nombres en español, como el resto del proyecto)
export function normalizar(p, categorias) {
    const stockFilas = Array.isArray(p.stock) ? p.stock : [];
    return {
        id: p.id,
        referencia: String(p.reference ?? '').trim() || null,
        nombre: String(p.name ?? '').trim(),
        slug: p.url ?? null,
        categoria_id: p.category_id ?? null,
        categoria: categoriaDe(p.name, categorias.get(p.category_id) ?? null),
        // Costo: price_buy si el proveedor lo publica; si viene en 0 (emprendered.com.co), su precio de distribuidor
        costo: Math.round(Number(p.price_buy) || Number(p.price_sale) || 0), // vienen con centavos (39899.99)
        precio_sugerido: Math.round(Number(p.price_sale) || 0),
        precio_antes: Number(p.price_before) || null,
        stock: Number.isFinite(Number(p.quantity_available)) ? Number(p.quantity_available)
            : stockFilas.reduce((s, x) => s + (Number(x.quantity) || 0), 0),
        stock_por_combinacion: stockFilas.filter((x) => x.product_combination_id != null)
            .map((x) => ({ combinacion: x.product_combination_id, cantidad: Number(x.quantity) || 0 })),
        simple: Boolean(p.is_simple),
        activo: Boolean(p.active),
        imagenes: unicos([p.image, ...(p.images ?? []).sort((a, b) => (a.order_by ?? 0) - (b.order_by ?? 0)).map((i) => i.image_url ?? i.image)]),
        descripcion_corta: String(p.short_description ?? '').trim(),
        descripcion: String(p.description ?? '').trim(),
        video: p.video || null,
        medidas: { peso: p.weight ?? 0, alto: p.height ?? 0, ancho: p.width ?? 0, largo: p.length ?? 0 },
        actualizado_proveedor: p.updated_at ?? null,
    };
}

export async function leerEmprendeRed({ alAvanzar } = {}) {
    const inicio = await primeraPagina();
    const props = inicio.props ?? {};
    const categorias = new Map((props.categories ?? []).map((c) => [c.id, String(c.name ?? '').trim()]));
    const crudos = new Map();
    for (const p of props.products ?? []) crudos.set(p.id, p);
    let siguiente = props.hasMore ? props.nextPage : null;
    let paginas = 1;
    while (siguiente && paginas < MAX_PAGINAS) {
        await espera(250); // sin afanes: es la tienda del proveedor
        const pg = await pagina(siguiente, inicio.version);
        for (const p of pg.props?.products ?? []) crudos.set(p.id, p);
        paginas++;
        alAvanzar?.(paginas, crudos.size);
        siguiente = pg.props?.hasMore ? pg.props.nextPage : null;
    }
    const campos = unicos([...crudos.values()].flatMap((p) => Object.keys(p))).sort();
    return {
        leido_at: new Date().toISOString(),
        fuente: CATALOGO,
        tienda: props.tenantConfig?.nameCompany ?? null,
        plan: props.tenantConfig?.plan ?? null,
        paginas,
        incompleto: Boolean(siguiente), // true si se alcanzó MAX_PAGINAS
        campos_proveedor: campos,
        categorias: [...categorias].map(([id, nombre]) => ({ id, nombre })),
        productos: [...crudos.values()].map((p) => normalizar(p, categorias)),
    };
}

// Resumen para decidir qué importar y con qué precio
export function resumen(datos) {
    const cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
    const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
    const lineas = [];
    const P = datos.productos;
    lineas.push(`Emprende Red · ${datos.fuente} · leído ${datos.leido_at.slice(0, 16).replace('T', ' ')} UTC`);
    lineas.push(`Productos: ${P.length} (${P.filter((p) => p.activo).length} activos) en ${datos.categorias.length} categorías · ${datos.paginas} páginas leídas${datos.incompleto ? ' · ⚠ INCOMPLETO (límite de páginas)' : ''}`);
    lineas.push('', 'Por categoría:');
    const grupos = [...datos.categorias, { id: null, nombre: '(sin categoría)' }];
    for (const c of grupos) {
        const g = P.filter((p) => (p.categoria_id ?? null) === c.id);
        if (!g.length) continue;
        const ventas = g.map((p) => p.precio_sugerido).filter((v) => v > 0);
        const conMargen = g.filter((p) => p.precio_sugerido > p.costo);
        const margen = g.length ? Math.round(g.reduce((s, p) => s + pct(p.precio_sugerido - p.costo, p.precio_sugerido), 0) / g.length) : 0;
        lineas.push(`  ${c.nombre.padEnd(20)} ${String(g.length).padStart(4)} productos · ${String(g.filter((p) => p.stock > 0).length).padStart(4)} con stock · venta ${ventas.length ? `${cop(Math.min(...ventas))}–${cop(Math.max(...ventas))}` : 'sin precio'} · margen sugerido promedio ${margen} % (${conMargen.length} con margen)`);
    }
    const sinMargen = P.filter((p) => p.precio_sugerido <= p.costo);
    const conAntes = P.filter((p) => p.precio_antes && p.precio_antes > p.precio_sugerido);
    lineas.push('', 'Precios:');
    lineas.push(`  costo = precio sugerido (margen 0) en ${sinMargen.length} de ${P.length}`);
    lineas.push(`  precio "antes" mayor al de venta en ${conAntes.length} (descuento de referencia del proveedor: no se usa)`);
    lineas.push('', 'Stock y contenido:');
    lineas.push(`  sin stock ${P.filter((p) => p.stock <= 0).length} · stock bajo (1–2) ${P.filter((p) => p.stock > 0 && p.stock <= 2).length} · con variantes (no simples) ${P.filter((p) => !p.simple).length}`);
    lineas.push(`  sin descripción larga ${P.filter((p) => !p.descripcion).length} · sin descripción corta ${P.filter((p) => !p.descripcion_corta).length} · sin imagen ${P.filter((p) => !p.imagenes.length).length} · con video ${P.filter((p) => p.video).length}`);
    lineas.push('', 'Ejemplos:');
    for (const p of P.slice(0, 5)) lineas.push(`  [${p.referencia ?? p.id}] ${p.nombre} · ${p.categoria} · costo ${cop(p.costo)} · sugerido ${cop(p.precio_sugerido)} · stock ${p.stock}`);
    return lineas.join('\n');
}

/* ==================== Paso 2 · Descripciones con IA ====================
   Reescribe descripción corta y larga con DeepSeek-V3 (SiliconFlow, clave de .env). Reglas:
   - Solo con los datos del proveedor: nada de precios, descuentos, garantías, envíos ni características inventadas.
   - Validación: todo número que escriba la IA debe estar en el texto del proveedor; si no, se descarta y queda el original.
   - Caché por producto (herramientas/salida/emprendered-ia.json): cada texto se reescribe una sola vez; si el
     proveedor cambia su texto, se vuelve a escribir.
   - Categorías excluidas (EXCLUIR_CATEGORIAS) no se reescriben ni se importan. */
// Nunca se importan: réplicas de marcas (Ley 1480 / propiedad industrial y bloqueo en Meta/WhatsApp), artículos para
// adultos y vapeadores (publicidad y venta restringidas: verificación de edad, Ley 2354 de 2024) y cuentas de streaming de
// terceros (compiten con lo propio y su origen no es verificable).
export const EXCLUIR_CATEGORIAS = ['RELOJERIA REPLICA', 'CAMISAS 1.1 FUTBOL', 'SEX SHOP', 'VAPES', 'VENDE STREAMING'];
const CACHE_IA = 'herramientas/salida/emprendered-ia.json';
const ETIQUETAS = new Set(['p', 'ul', 'li', 'strong', 'em', 'br']);

export const PROMPT_IA = [
    'Eres redactor de ventas de DC TECNOLOGY, tienda colombiana de tecnología. Escribe en español de Colombia, tuteando.',
    'Te doy los datos de UN producto del proveedor. Devuelve SOLO un JSON: {"corta": "...", "larga": "..."}.',
    '"corta": 1 o 2 frases (máx. 220 caracteres), texto plano, enfocada en el beneficio principal, sin emojis.',
    '"larga": HTML limpio usando solo <p>, <ul>, <li> y <strong>: un párrafo de beneficios, una lista de 3 a 6 características y un párrafo final con un llamado a la acción ("Pídelo hoy por WhatsApp o agrégalo al carrito").',
    'REGLAS ESTRICTAS: usa SOLO la información de los datos. No inventes características, medidas, compatibilidades, materiales ni cifras.',
    'No menciones precios, descuentos, garantías, tiempos de envío, stock ni "original" si los datos no lo dicen. No uses urgencia falsa ("últimas unidades", "solo hoy").',
    'Si los datos son pocos, escribe menos: es mejor corto y cierto que largo e inventado. Corrige ortografía y mayúsculas del nombre.',
].join('\n');

const hash = (t) => [...String(t)].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261).toString(16);
const fuenteIa = (p) => `Nombre: ${p.nombre}\nCategoría: ${p.categoria ?? ''}\nDescripción corta del proveedor: ${p.descripcion_corta || '(vacía)'}\nDescripción larga del proveedor: ${p.descripcion.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '(vacía)'}`;

// Deja solo las etiquetas permitidas, sin atributos
export const limpiarHtml = (html) => String(html ?? '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/?([a-z0-9]+)[^>]*>/gi, (m, t) => (ETIQUETAS.has(t.toLowerCase()) ? `<${m.startsWith('</') ? '/' : ''}${t.toLowerCase()}>` : ''))
    // El cliente nunca ve al proveedor: fuera las frases que lo nombran (cupones, enlaces o contacto de Emprende Red)
    .replace(/\S*(emprendered|catalogovirtual)\.[a-z.\/]+\S*/gi, ' EMPRENDE RED ')
    .replace(/[^<>.!?\n]*(emprende ?red)[^<>.!?\n]*[.!?]?/gi, '')
    .replace(/<(p|li|strong|b|em)>\s*(&nbsp;|\s)*<\/\1>/gi, '')
    .replace(/\s+/g, ' ').trim();

// Cero datos inventados: cada número del texto nuevo debe existir en el del proveedor
export function validarIa(p, r) {
    const fuente = fuenteIa(p).replace(/[.,]/g, '');
    const texto = `${r?.corta ?? ''} ${r?.larga ?? ''}`.replace(/<[^>]+>/g, ' ');
    if (!r?.corta || !r?.larga) return 'respuesta vacía';
    if (/\$|%|garant|env[ií]o gratis|últimas unidades|solo hoy/i.test(texto) && !/garant/i.test(fuente)) return 'menciona precio, descuento, garantía o urgencia';
    const extra = (texto.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, '')).filter((n) => !fuente.includes(n));
    return extra.length ? `cifras que no están en los datos: ${extra.join(', ')}` : null;
}

export async function enriquecer(datos, { env = {}, limite = Infinity, concurrencia = 3, llamar } = {}) {
    const cache = fs.existsSync(CACHE_IA) ? JSON.parse(fs.readFileSync(CACHE_IA, 'utf8')) : {};
    // IA en cascada, igual que el bot (herramientas/ia.mjs): si una no tiene saldo, se cae o tarda, pasa a la siguiente
    const ia = llamar ?? (async (texto) => (await pedirIA([{ role: 'system', content: PROMPT_IA }, { role: 'user', content: texto }],
        { tarea: 'descripciones-emprendered', temperatura: 0.4, maxTokens: 700, json: true, timeoutMs: 60000 }, { env })).texto);
    const pendientes = datos.productos.filter((p) => !EXCLUIR_CATEGORIAS.includes(p.categoria) && cache[p.id]?.hash !== hash(fuenteIa(p))).slice(0, limite);
    const cuenta = { nuevos: 0, rechazados: 0, errores: 0 };
    let fatal = null;
    const trabajar = async () => {
        while (pendientes.length && !fatal) {
            const p = pendientes.shift();
            try {
                const crudo = await ia(fuenteIa(p));
                const r = JSON.parse(String(crudo).replace(/^```(?:json)?|```$/g, '').trim());
                r.corta = String(r.corta ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 260);
                r.larga = limpiarHtml(r.larga);
                const motivo = validarIa(p, r);
                cache[p.id] = { hash: hash(fuenteIa(p)), ...(motivo ? { rechazo: motivo } : { corta: r.corta, larga: r.larga }), at: new Date().toISOString() };
                cuenta[motivo ? 'rechazados' : 'nuevos']++;
            } catch (e) {
                if (e.fatal) fatal = e; else cuenta.errores++;
            }
        }
    };
    await Promise.all(Array.from({ length: concurrencia }, trabajar));
    fs.mkdirSync('herramientas/salida', { recursive: true });
    fs.writeFileSync(CACHE_IA, JSON.stringify(cache, null, 2));
    // Texto final: el de la IA si pasó la validación; si no, el del proveedor
    for (const p of datos.productos) {
        const c = cache[p.id];
        p.texto_ia = Boolean(c && !c.rechazo && c.hash === hash(fuenteIa(p)));
        p.descripcion_corta_dc = p.texto_ia ? c.corta : p.descripcion_corta;
        p.descripcion_dc = p.texto_ia ? c.larga : limpiarHtml(p.descripcion) || (p.descripcion_corta ? `<p>${p.descripcion_corta}</p>` : '');
    }
    return { ...cuenta, pendientes: pendientes.length, fatal: fatal?.message ?? null };
}

/* ==================== Paso 3 · Precios y tienda ====================
   Decisión del director (19/10/2026): precio = costo + 50 % (redondeado hacia arriba a $100); se importan TODAS las
   categorías permitidas, pero solo TECNOLOGIA se ve por defecto: las demás llegan con "oculto": true y el director las
   activa en el panel (proveedor_categorias, wo-047). Réplicas excluidas. Sin precio "antes" (cero descuentos inventados).
   - productos.json: los productos del proveedor van al final con id "er-<slug>" y "sincronizado": true (la tienda
     los oculta si la base no les da un precio activo, p. ej. agotados). Los demás productos no se tocan (texto intacto).
   - supabase/wo-041-emprendered.sql: crea sincronizar_proveedor() (solo service_role, la usa n8n en el paso 4) y la
     ejecuta con este catálogo: precio, costo, stock y activo (stock > 0) por producto. Nunca usa la service_role desde aquí. */
// Categoría 1 de Emprende Red: viene sin nombre en su lista de categorías (307 productos el 23/10/2026). Lo que es
// tecnología va a TECNOLOGIA; lo demás a GENERAL («Otros», oculto hasta que lo actives en el panel).
export const TEC_SIN_CATEGORIA = /play ?station|\bps[45]\b|xbox|nintendo|consola|gamer|\busb\b|cargador|\bcable\b|aud[ií]fono|auricular|diadema|parlante|bafle|\bmouse\b|teclado|celular|tablet|smart ?watch|reloj inteligente|power ?bank|bater[ií]a port[aá]til|memoria|micro ?sd|disco (duro|s[oó]lido)|c[aá]mara|bluetooth|\bhdmi\b|router|proyector|tv ?box|micr[oó]fono|tr[ií]pode|aro de luz|\bdron|adaptador/i;
// Marcas de lujo a precio de cacharrería = imitación: no se venden (riesgo de marca y de la SIC). Perfumería queda aparte (oculta)
export const LUJO = /\b(hublot|rolex|cartier|van ?cleef|louis ?vuitton|gucci|chanel|bvlgari|bulgari|tiffany|patek|audemars|omega|tag ?heuer|pandora|prada|versace|balenciaga|dior|herm[eè]s|richard ?mille)\b/i;
export const categoriaDe = (nombre, categoria) => categoria ?? (TEC_SIN_CATEGORIA.test(String(nombre)) ? 'TECNOLOGIA' : 'GENERAL');
// Marca del fabricante solo si aparece en el nombre (nunca se inventa; sin marca reconocida, el campo no va)
const MARCAS = ['Yookie', 'Xiaomi', 'Redmi', 'Samsung', 'Apple', 'JBL', 'Lenovo', 'Sony', 'Logitech', 'Genius', 'Huawei', 'Haylou', 'Amazfit', 'Kingston', 'SanDisk', 'TP-Link', 'Anker', 'Baseus',
    'Hoco', 'Remax', 'Philips', 'Panasonic', 'Casio', 'Nintendo', 'Microsoft', 'HP', 'Dell', 'Asus', 'Acer', 'Motorola', 'Kalley', 'Xtech', 'Maxell', 'Duracell', 'Energizer', 'Ugreen', 'Soundcore', 'QCY', 'Lenyes', 'Kanji'];
export function marcaDe(nombre) {
    const n = String(nombre);
    if (/play ?station|\bps[45]\b/i.test(n)) return 'Sony';
    return MARCAS.find((m) => new RegExp(`\\b${m.replace(/[-]/g, '[- ]?')}\\b`, 'i').test(n)) ?? null;
}
export const CATEGORIAS_VISIBLES_POR_DEFECTO = ['TECNOLOGIA'];
export const CATEGORIAS_IMPORTAR = null; // null = todas menos EXCLUIR_CATEGORIAS
export const importable = (categoria) => Boolean(categoria) && !EXCLUIR_CATEGORIAS.includes(categoria) && (!CATEGORIAS_IMPORTAR || CATEGORIAS_IMPORTAR.includes(categoria));
export const MARGEN_PCT = 50;
// "HOGAR" → "Hogar", "RELOJERIA ORIGINAL" → "Relojería original"
const ACENTOS = { RELOJERIA: 'Relojería', JOYERIA: 'Joyería', PAPELERIA: 'Papelería', PERFUMERIA: 'Perfumería', FERRETERIA: 'Ferretería', CACHARRERIA: 'Cacharrería', BARBERIA: 'Barbería', DULCERIA: 'Dulcería', TECNOLOGIA: 'Tecnología' };
export const nombreCategoria = (c) => c === 'GENERAL' ? 'Otros' : String(c ?? '').split(/\s+/).map((w, i) => { const a = ACENTOS[w] ?? w.charAt(0) + w.slice(1).toLowerCase(); return i ? a.toLowerCase() : a; }).join(' ');
export const REDONDEO = 100;
export const precioVenta = (costo) => Math.ceil((Number(costo) * (1 + MARGEN_PCT / 100)) / REDONDEO) * REDONDEO;

const SIGLAS = new Set(['usb', 'led', 'hd', 'tv', 'anc', 'bt', 'rgb', 'otg', 'sd', 'aux', 'ac', 'dc', 'ipx4', 'ipx5', 'ipx7', 'ip67', 'ip68', 'pd', 'qc', 'gb', 'tws', 'fm', 'lcd', 'uv', 'aaa', 'aa', 'led', 'hdmi', 'vga', 'ps5', 'ps4']);
// "CARGADOR CON CABLE ORIGINAL YOOKIE 20W RAPIDO" → "Cargador con Cable Original Yookie 20W Rapido"
// Réplicas declaradas en el nombre ("1.1", "réplica"…): no se importan, aunque estén en TECNOLOGIA
export const NOMBRE_REPLICA = /\b1[.:]1\b|r[eé]plica|\bclon|\bcopia\b|(?<!\b(?:pilas?|bater[ií]as?)\b.{0,20})\ba{2,3}\b|tipo original/i; // "PILAS AAA" no es réplica; "CASIO … AA" sí
export function nombreBonito(nombre) {
    const menores = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'para', 'en', 'a', 'por', 'sin', 'o', 'x']);
    let base = String(nombre).replace(/\s+/g, ' ').trim();
    // "AirPods" es marca de Apple: los audífonos genéricos se nombran por lo que son (y sin "original")
    if (/air\s?pods?/i.test(base)) base = base.replace(/\boriginal(es)?\b/gi, ' ').replace(/air\s?pods?/gi, 'Audífonos Inalámbricos').replace(/\s+/g, ' ').trim();
    return base.toLowerCase().split(' ').map((w, i) => {
        if (/^\d+(?:[.,]\d+)?mah$/.test(w)) return w.replace('mah', 'mAh');
        if (w === 'mah') return 'mAh';
        if (/^\d+(ra|da|ta|ro|do|to|va|vo|na|no)$/.test(w)) return w; // 2da, 3ra
        if (w === 'audífonos' || w === 'inalámbricos') return w.charAt(0).toUpperCase() + w.slice(1);
        if (SIGLAS.has(w) || /\d/.test(w)) return w.toUpperCase();
        if (i > 0 && menores.has(w)) return w;
        return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
}
export const idDc = (p) => `er-${String(p.slug || p.nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140)}-${p.id}`;

// conservar: slugs (id sin el número) que ya estaban en la tienda → si se agotan quedan como "agotado" (no se borran)
export function productosTienda(datos, conservar = new Set()) {
    return datos.productos
        .filter((p) => p.activo && p.costo > 0 && importable(p.categoria) && !NOMBRE_REPLICA.test(p.nombre) && !(LUJO.test(p.nombre) && p.categoria !== 'PERFUMERIA')
            && (p.stock > 0 || conservar.has(idDc(p).replace(/-\d+$/, ''))))
        .map((p) => ({
            id: idDc(p),
            tipo: p.categoria === 'TECNOLOGIA' ? 'tecnologia' : 'variedades',
            categoria: nombreCategoria(p.categoria),
            ...(CATEGORIAS_VISIBLES_POR_DEFECTO.includes(p.categoria) ? {} : { oculto: true }),
            ...(marcaDe(p.nombre) ? { marca: marcaDe(p.nombre) } : {}),
            nombre: nombreBonito(p.nombre),
            imagen: p.imagenes[0],
            descripcion: p.descripcion_dc ?? (limpiarHtml(p.descripcion) || (p.descripcion_corta ? `<p>${p.descripcion_corta}</p>` : '')),
            variantes: [{ nombre: 'Unidad', precio: precioVenta(p.costo), precio_anterior: null }],
            existencias: p.stock, // unidades que le quedan al proveedor (la base las actualiza cada 6 h)
            ...(p.stock > 0 ? {} : { agotado: true }),
            sincronizado: true,
            _proveedor: { id: p.id, ref: p.referencia, costo: p.costo, stock: p.stock, categoria: p.categoria },
        }));
}

// productos.json conserva su formato: se reemplaza solo el bloque de productos "er-" (al final del arreglo)
export function escribirProductosJson(ruta, nuevos) {
    const crudo = fs.readFileSync(ruta, 'utf8');
    const eol = crudo.includes('\r\n') ? '\r\n' : '\n';
    const texto = crudo.replace(/\r\n/g, '\n');
    // Recorta cada objeto de primer nivel del arreglo respetando cadenas
    const objetos = [];
    for (let i = texto.indexOf('[') + 1, prof = 0, inicio = -1, cad = false; i < texto.length; i++) {
        const c = texto[i];
        if (cad) { if (c === '\\') i++; else if (c === '"') cad = false; continue; }
        if (c === '"') cad = true;
        else if (c === '{') { if (prof++ === 0) inicio = i; }
        else if (c === '}' && --prof === 0) objetos.push(texto.slice(inicio, i + 1));
    }
    const propios = objetos.filter((o) => !JSON.parse(o).id?.startsWith('er-'));
    const inline = (o) => `{ ${Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
    const formato = (p) => `{\n${Object.entries(p).filter(([k]) => !k.startsWith('_'))
        .map(([k, v]) => `    ${JSON.stringify(k)}: ${k === 'variantes' ? `[ ${v.map(inline).join(', ')} ]` : JSON.stringify(v)}`).join(',\n')}\n  }`;
    const salida = `[\n${[...propios, ...nuevos.map(formato)].map((o) => `  ${o}`).join(',\n')}\n]\n`;
    JSON.parse(salida); // nunca se escribe un archivo roto
    fs.writeFileSync(ruta, salida.replace(/\n/g, eol));
    return { propios: propios.length, proveedor: nuevos.length };
}

const sqlTexto = (v) => `'${String(v).replace(/'/g, "''")}'`;
export function generarSql(nuevos, leidoAt) {
    const items = nuevos.map((p) => ({ producto_id: p.id, variante: 'Unidad', producto: p.nombre, tipo: p.tipo,
        costo: p._proveedor.costo, precio: p.variantes[0].precio, stock: p._proveedor.stock, ref: p._proveedor.ref ?? String(p._proveedor.id), categoria: p._proveedor.categoria }));
    return `-- =====================================================================
-- WO-041 · Productos de Emprende Red (dropshipping) en catalogo_precios: precio, costo y stock
-- Generado por herramientas/sincronizar-emprendered.mjs el ${new Date().toISOString()} con el catálogo leído el ${leidoAt}.
-- No editar a mano: volver a generar. Ejecutar en Supabase → SQL Editor. Es idempotente.
-- Regla: precio = costo + ${MARGEN_PCT} % redondeado a $${REDONDEO}; activo solo si hay stock. Solo toca filas de este proveedor.
-- n8n usa la misma función cada día (paso 4) con su credencial de servidor.
-- =====================================================================

do $$
begin
    if to_regclass('public.catalogo_precios') is null then
        raise exception 'Nada se aplicó. Falta public.catalogo_precios: aplica antes supabase/wo-032-fase3.sql.';
    end if;
end;
$$;

do $$
begin
    if to_regclass('public.proveedor_categorias') is null then
        raise exception 'Nada se aplicó. Aplica antes supabase/wo-047-proveedor-y-rastreo.sql (categorías visibles y sincronizar_proveedor con categoría).';
    end if;
end;
$$;

select * from public.sincronizar_proveedor('emprendered', ${sqlTexto(JSON.stringify(items))}::jsonb);

-- Verificación: debe dar ${items.length} filas de Emprende Red, ${items.filter((x) => x.stock > 0).length} activas
select count(*) as filas, count(*) filter (where activo) as activas, min(precio) as precio_min, max(precio) as precio_max
  from public.catalogo_precios where proveedor = 'emprendered';
`;
}

// Solo al ejecutarlo directo (los pasos siguientes lo importan para usar leerEmprendeRed)
//   --ia [--limite N]   también reescribe las descripciones (paso 2)
//   --tienda            agrega los productos a productos.json y genera supabase/wo-041-emprendered.sql (paso 3)
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].replace(/\//g, '\\').toLowerCase()) {
    const datos = await leerEmprendeRed({ alAvanzar: (pg, n) => process.stdout.write(`\r  leyendo página ${pg} · ${n} productos…`) });
    process.stdout.write('\r' + ' '.repeat(50) + '\r');
    console.log(resumen(datos));
    if (process.argv.includes('--ia')) {
        const { createRequire } = await import('node:module');
        const { cargarEntorno, requerir } = createRequire(import.meta.url)('./entorno.js');
        const env = cargarEntorno();
        requerir(env, ['SILICONFLOW_API_KEY']);
        const i = process.argv.indexOf('--limite');
        const r = await enriquecer(datos, { env, limite: i > 0 ? Number(process.argv[i + 1]) : Infinity });
        console.log(`\nIA: ${r.nuevos} reescritas · ${r.rechazados} rechazadas por la validación (queda el texto del proveedor) · ${r.errores} errores · ${r.pendientes} sin hacer`);
        if (r.fatal) console.log(`✘ ${r.fatal}`);
    }
    if (process.argv.includes('--tienda')) {
        if (!process.argv.includes('--ia')) await enriquecer(datos, { llamar: async () => { throw Object.assign(new Error('sin IA'), { fatal: true }); } }); // solo caché
        // Mismo producto, mismo id: el proveedor renumeró sus productos al pasar a emprendered.com.co (19/10/2026);
        // se conserva el id anterior cuando el slug coincide (páginas p/ de Google, precios y pedidos no cambian)
        const previos = new Map();
        for (const p of JSON.parse(fs.readFileSync('productos.json', 'utf8'))) if (String(p.id).startsWith('er-')) previos.set(String(p.id).replace(/-\d+$/, ''), p.id);
        const nuevos = productosTienda(datos, new Set(previos.keys())).map((p) => ({ ...p, id: previos.get(p.id.replace(/-\d+$/, '')) ?? p.id }));
        console.log(`  ids conservados de la tienda anterior: ${nuevos.filter((p) => [...previos.values()].includes(p.id)).length} de ${previos.size}`);
        const r = escribirProductosJson('productos.json', nuevos);
        fs.writeFileSync('supabase/wo-041-emprendered.sql', generarSql(nuevos, datos.leido_at));
        const porCat = {}; nuevos.forEach((p) => { porCat[p._proveedor.categoria] = (porCat[p._proveedor.categoria] ?? 0) + 1; });
        console.log(`\nTienda: ${r.proveedor} productos de Emprende Red con stock + ${r.propios} propios en productos.json`);
        console.log(`  por categoría (visibles por defecto: ${CATEGORIAS_VISIBLES_POR_DEFECTO.join(', ')}): ${Object.entries(porCat).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
        console.log(`  no importadas: ${EXCLUIR_CATEGORIAS.join(', ')}`);
        const replicas = datos.productos.filter((p) => importable(p.categoria) && NOMBRE_REPLICA.test(p.nombre));
        if (replicas.length) console.log(`  excluidas por ser réplicas declaradas (${replicas.length}): ${replicas.map((p) => p.nombre).join(' | ')}`);
        console.log(`  precios: costo + ${MARGEN_PCT} % · ${nuevos.filter((p) => datos.productos.find((x) => idDc(x) === p.id)?.texto_ia).length} con texto de IA`);
        console.log('  SQL: supabase/wo-041-emprendered.sql → ejecútalo en Supabase y luego: npm run seo && node generar_bot_conocimiento.js');
    }
    const salida = process.argv.slice(2).find((a) => a.endsWith('.json')) ?? SALIDA;
    fs.mkdirSync(salida.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
    fs.writeFileSync(salida, JSON.stringify(datos, null, 2));
    console.log(`\nGuardado: ${salida} (copia local, no se publica)`);
}
