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

export const BASE_EMPRENDERED = 'https://dctechnology.catalogovirtual.co';
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
        categoria: categorias.get(p.category_id) ?? null,
        costo: Number(p.price_buy) || 0,
        precio_sugerido: Number(p.price_sale) || 0,
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
export const EXCLUIR_CATEGORIAS = ['RELOJERIA REPLICA']; // réplicas de marcas: riesgo legal y de bloqueo en Meta/WhatsApp
const CACHE_IA = 'herramientas/salida/emprendered-ia.json';
const MODELO = 'deepseek-ai/DeepSeek-V3';
const ETIQUETAS = new Set(['p', 'ul', 'li', 'strong', 'em', 'br']);

export const PROMPT_IA = [
    'Eres redactor de ventas de DC TECHNOLOGY, tienda colombiana de tecnología. Escribe en español de Colombia, tuteando.',
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

export async function enriquecer(datos, { env, limite = Infinity, concurrencia = 3, llamar } = {}) {
    const cache = fs.existsSync(CACHE_IA) ? JSON.parse(fs.readFileSync(CACHE_IA, 'utf8')) : {};
    const ia = llamar ?? (async (texto) => {
        const r = await fetch(`${env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.com/v1'}/chat/completions`, {
            method: 'POST', signal: AbortSignal.timeout(60000),
            headers: { Authorization: `Bearer ${env.SILICONFLOW_API_KEY.trim()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: MODELO, temperature: 0.4, max_tokens: 700, response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: PROMPT_IA }, { role: 'user', content: texto }] }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 402) throw Object.assign(new Error('SiliconFlow sin saldo (402): recarga en cloud.siliconflow.com → Billing'), { fatal: true });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${String(j.message ?? '').slice(0, 80)}`);
        return j.choices?.[0]?.message?.content ?? '';
    });
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

// Solo al ejecutarlo directo (los pasos siguientes lo importan para usar leerEmprendeRed)
//   --ia [--limite N]   también reescribe las descripciones (paso 2)
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
    const salida = process.argv.slice(2).find((a) => a.endsWith('.json')) ?? SALIDA;
    fs.mkdirSync(salida.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
    fs.writeFileSync(salida, JSON.stringify(datos, null, 2));
    console.log(`\nGuardado: ${salida} (copia local, no se publica)`);
}
