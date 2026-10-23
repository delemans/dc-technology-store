// Lee el catálogo público de ANC Pagos (proveedor) y lo deja en JSON para compararlo con el nuestro.
//   node herramientas/catalogo_ancpagos.mjs [salida.json]
// El catálogo viene dentro de la página (variables CATALOGO_INICIAL_IDX, STOCK_INICIAL_IDX, …):
// no hace falta navegador ni sesión. Sus precios son NUESTRO COSTO.
import fs from 'node:fs';
import crypto from 'node:crypto';

const URL_ANC = 'https://ancpagos.com/';
const SALIDA = process.argv[2] ?? 'herramientas/salida/ancpagos.json';

// Extrae el literal JSON asignado a `const NOMBRE = …` contando llaves/corchetes (respeta cadenas)
export function variable(html, nombre) {
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
}

export async function leerPortalAnc() {
    const r = await fetch(URL_ANC, { headers: { 'User-Agent': 'Mozilla/5.0 (DC Tecnology; catálogo proveedor)' } });
    if (!r.ok) throw new Error(`ancpagos.com respondió ${r.status}`);
    const html = await r.text();
    const catalogo = variable(html, 'CATALOGO_INICIAL_IDX');
    if (!catalogo) throw new Error('No encontré CATALOGO_INICIAL_IDX: el sitio cambió de estructura.');
    const stock = variable(html, 'STOCK_INICIAL_IDX') ?? {};
    const categorias = variable(html, 'dictCategoriasPorProducto') ?? {};
    const ocultos = variable(html, 'productosOcultosIdx') ?? [];
    const combo = variable(html, 'COMBO_CANTIDAD_IDX');
    const filas = [];
    for (const [producto, variantes] of Object.entries(catalogo)) {
        for (const [variante, v] of Object.entries(variantes)) {
            filas.push({
                producto, variante, costo: v.precio,
                en_promocion: Boolean(v.en_promocion), costo_normal: v.precio_normal ?? null,
                bajo_pedido: Boolean(v.bajo_pedido), stock: stock[producto]?.[variante] ?? null,
                categorias: categorias[producto] ?? [], oculto: ocultos.includes(producto),
            });
        }
    }
    return { leido_at: new Date().toISOString(), fuente: URL_ANC, combo, filas };
}

// Respaldo cuando el portal está en mantenimiento: la tienda pública de ANC (allnecessarycolombia.com, Tiendanube)
// tiene los mismos precios. Se traduce a los nombres del portal con la tabla de equivalencias (mismo producto;
// plan igual, o igual sin "26 días"), así comparar y costos funcionan igual. Lo que no empareja no se inventa.
const URL_TIENDA = 'https://allnecessarycolombia.com/productos/';
const plano = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const sinDias = (x) => plano(x).replace(/\b\d+ dias?\b/g, '').replace(/\s+/g, ' ').trim();

export async function leerTiendaAnc() {
    const productos = [];
    for (let n = 1; n <= 10; n++) {
        const r = await fetch(n === 1 ? URL_TIENDA : `${URL_TIENDA}page/${n}/`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' } });
        if (!r.ok) { if (n === 1) throw new Error(`allnecessarycolombia.com respondió ${r.status}`); break; }
        const html = await r.text();
        const antes = productos.length;
        const re = /data-variants="([^"]+)"[\s\S]*?product-item-name-\d+">([^<]+)/g;
        for (let m; (m = re.exec(html));) {
            const variantes = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
            // URL del producto: el último enlace /productos/<slug>/ antes del nombre (la tarjeta lo trae junto)
            const antesDelNombre = html.slice(Math.max(0, m.index - 4000), m.index + m[0].length);
            const url = [...antesDelNombre.matchAll(/href="(https:\/\/allnecessarycolombia\.com\/productos\/[^"/]+\/)"/g)].pop()?.[1] ?? null;
            productos.push({ nombre: m[2].trim(), url, variantes: variantes.map((v) => {
                const nombre = [v.option0, v.option1, v.option2].filter(Boolean).join(' / ');
                return { nombre, precio: Number(v.price_number) || null, disponible: v.available !== false,
                    stock: Number.isFinite(v.stock) ? v.stock : null, plazo_dias: plazoDias(`${m[2]} ${nombre}`) };
            }) });
        }
        if (productos.length === antes) break;
    }
    const { _nota, ...eq } = JSON.parse(fs.readFileSync(new URL('./equivalencias-ancpagos.json', import.meta.url), 'utf8'));
    const filas = [];
    for (const { proveedor, variantes } of Object.values(eq)) {
        const p = productos.find((x) => plano(x.nombre) === plano(proveedor));
        for (const plan of new Set(Object.values(variantes))) {
            const v = p?.variantes.find((x) => plano(x.nombre) === plano(plan)) ?? p?.variantes.find((x) => sinDias(x.nombre) === sinDias(plan));
            if (!v || filas.some((f) => f.producto === proveedor && f.variante === plan)) continue;
            filas.push({ producto: proveedor, variante: plan, costo: v.precio, en_promocion: false, costo_normal: null, bajo_pedido: false,
                stock: v.disponible ? v.stock : 0, agotado: !v.disponible || v.stock === 0, plazo_dias: v.plazo_dias, categorias: [], oculto: false, tienda: `${p.nombre} · ${v.nombre || 'única'}` });
        }
    }
    return { leido_at: new Date().toISOString(), fuente: URL_TIENDA, respaldo: true, combo: null, filas, tienda: productos };
}

// Plazo del plan en días a partir del nombre ("Pantalla 26 dias" → 26, "1 Mes" → 30, "3 Meses" → 90, "1 Año" → 365)
export function plazoDias(texto) {
    const t = String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let m = /(\d+)\s*dias?\b/.exec(t); if (m) return Number(m[1]);
    m = /(\d+)\s*mes(es)?\b/.exec(t); if (m) return Number(m[1]) * 30;
    m = /(\d+)\s*anos?\b/.exec(t); if (m) return Number(m[1]) * 365;
    if (/\bmensual\b/.test(t)) return 30;
    if (/\banual\b/.test(t)) return 365;
    return null;
}

const ENT = { nbsp: ' ', amp: '&', quot: '"', lt: '<', gt: '>', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', iexcl: '¡', iquest: '¿', ordm: 'º', deg: '°', middot: '·', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
export const entidades = (t) => String(t ?? '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m);

// Condiciones y descripción de cada producto (su página): texto plano y huella para saber si cambiaron
export async function leerCondicionesAnc(productos, { pausa = 300 } = {}) {
    const salida = {};
    for (const p of productos) {
        if (!p.url) continue;
        try {
            const r = await fetch(p.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130 Safari/537.36' }, signal: AbortSignal.timeout(20000) });
            if (!r.ok) continue;
            const html = await r.text();
            // Resumen del producto (meta description) + su descripción completa (entre los marcadores de Tiendanube)
            const resumen = /<meta name="description" content="([^"]*)"/i.exec(html)?.[1] ?? '';
            const i0 = html.indexOf('data-nubesdk-slot="before_product_description"'), i1 = html.indexOf('data-nubesdk-slot="after_product_description"');
            const bloque = i0 >= 0 && i1 > i0 ? html.slice(i0, i1).replace(/^[^>]*>/, '') : '';
            const texto = entidades([resumen, bloque.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/(p|li|h\d|div)>/gi, '\n').replace(/<[^>]+>/g, ' ')].filter(Boolean).join('\n'))
                .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
            if (texto) salida[p.nombre] = { url: p.url, texto: texto.slice(0, 4000), huella: crypto.createHash('sha1').update(texto).digest('hex').slice(0, 16) };
        } catch { /* esa página no respondió: se reintenta mañana */ }
        await new Promise((ok) => setTimeout(ok, pausa));
    }
    return salida;
}

// Descripción para NUESTRA tienda a partir del texto de ANC: solo lo del producto (resumen, especificaciones, condiciones y qué
// incluye). Fuera todo lo que delata al proveedor o no es nuestro: sus marketplaces, su tienda oficial, comunidad, precios
// («Desde $XX», planes), sus tiempos de entrega y llamados a su WhatsApp. Devuelve HTML (<p>, <ul>, <li>, <strong>) o null.
const FUERA_ANC = /all necessary|\banc\b|marketplace|tienda oficial|falabella|linio|luego pago|grupo [eé]xito|al carrito|addi|cmr|comunidad|ofertas exclusivas|quiero este plan|m[aá]s vendido|elige tu plan|al tocar tu plan|saldo para tu cuenta|^pin de$|^\$|\$xx|desde \$|whatsapp|tiempo estimado|minutos|m[eé]todos de pago|c[oó]digo qr|compra 100% segura|haz clic|p[aá]gina web oficial|env[ií]os gratis|cuotas sin inter[eé]s|pago contra entrega|tienes dudas|equipo est[aá] listo|^<|nubesdk|⭐⭐|elegir el que prefieras|^paso\s*\d|\b(lunes|domingo|horario)\b|\d{1,2}:\d{2}\s?(am|pm)/i;
const sinEmoji = (t) => t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '').replace(/^[\s!✓✕✔✖•·\-–]+/, '').trim();
const escH = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function descripcionDesdeAnc(texto, nombre = '') {
    const lineas = String(texto ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lineas.length) return null;
    const resumen = sinEmoji(lineas[0].replace(/^desde \$[\dX.,]+\s*,?\s*/i, '')).replace(/\s*¡?compra (ya|ahora)[^.!]*[.!]?\s*$/i, '').trim();
    const parrafos = [], items = [];
    for (const l of lineas.slice(1)) {
        if (FUERA_ANC.test(l) || /^\d+\.\s/.test(l)) continue;
        let t = sinEmoji(l);
        if (!t || t.length < 12 || /[:?]$/.test(t) || /^paso\s*\d/i.test(t) || /medios de pago|comprobante|asesor/i.test(t)) continue;
        if (!/[.!?:]/.test(t) && t.length < 70) continue; // títulos sueltos («Diademas Gamer A3S Alámbricas», «Cómo obtener tu PIN»)
        if (t === t.toUpperCase() && /[A-ZÁÉÍÓÚ]{4}/.test(t)) t = t.charAt(0) + t.slice(1).toLowerCase().replace(/colombiana/, 'colombiana');
        if (/^(especificaciones|condiciones de compra|¿qu[eé] te ofrece|proceso de entrega)/i.test(t)) continue;
        if (nombre && t.toLowerCase().replace(/\s*\(.*\)$/, '') === nombre.toLowerCase().replace(/\s*\(.*\)$/, '')) continue; // título repetido
        const m = /^([^:]{3,40}):\s*(.{6,})$/.exec(t);
        if (m) items.push(`<li><strong>${escH(m[1].trim())}:</strong> ${escH(m[2].trim())}</li>`);
        else if (/^(asegúrate|los pin son|al comprar|al tratarse)/i.test(t)) items.push(`<li>${escH(t)}</li>`);
        else parrafos.push(`<p>${escH(t)}</p>`);
    }
    const mayus = (x) => x.charAt(0).toUpperCase() + x.slice(1);
    // Promesas que son del proveedor, no tuyas (garantía, soporte 24/7, entrega inmediata): esas frases se quitan
    const PROMESA = /garant[ií]a|soporte 24|24\/7|(entrega|activaci[oó]n|env[ií]o) inmediat|al instante|r[aá]pid[ao] entrega|env[ií]o gratis/i;
    const limpiar = (html) => html.replace(/<(p|li)>([\s\S]*?)<\/\1>/g, (m, tag, cuerpo) => {
        if (tag === 'li') return PROMESA.test(cuerpo.replace(/<[^>]+>/g, '')) && !/región|regi[oó]n|colombia/i.test(cuerpo) ? '' : m;
        const frases = cuerpo.split(/(?<=[.!?])\s+/).filter((f) => !PROMESA.test(f) && !/\$\s?\d/.test(f) && !(/^¡/.test(f) && f.length < 45));
        return frases.length ? `<p>${frases.join(' ')}</p>` : '';
    });
    const partes = [resumen && resumen.length > 15 ? `<p>${escH(mayus(resumen))}</p>` : '', ...parrafos.slice(0, 3), items.length ? `<ul>${[...new Set(items)].slice(0, 10).join('')}</ul>` : ''].filter(Boolean);
    const html = limpiar(partes.join('')).replace(/<ul><\/ul>/g, '');
    // Si el texto habla de otro modelo (error del proveedor, p. ej. «H19» descrito como «X31»), no se usa
    const modelos = (x) => String(x).toLowerCase().split(/[^a-z0-9]+/).filter((t) => /\d/.test(t) && /[a-z]/.test(t) && !/^\d+(mah|w|v|gb|mb|hz|k|ml|pm|am|x)$/.test(t) && !/^(ipx?\d+|5g|4g|4k|8k|bt\d.*|usb\w*|v\d+)$/.test(t));
    const delNombre = modelos(nombre);
    if (delNombre.length && !delNombre.some((m) => html.toLowerCase().includes(m))) return null;
    // Párrafos que nombran un modelo que no es este producto se quitan (p. ej. «Smartwatch X31» en la página del H19)
    const ajenos = (t) => modelos(t.replace(/<[^>]+>/g, ' ')).filter((m) => !delNombre.includes(m)).length > 0 && delNombre.length > 0;
    const final = html.replace(/<p>([\s\S]*?)<\/p>/g, (m, cuerpo) => (ajenos(cuerpo) ? '' : m));
    return final.replace(/<[^>]+>/g, '').trim().length > 40 ? final : null;
    return html.replace(/<[^>]+>/g, '').trim().length > 40 ? html : null;
}

// Diferencias entre dos lecturas de la tienda de ANC (por plan): precios, cantidades, plazos, agotados y planes nuevos o idos.
// previo/ahora: { "<producto> · <plan>": { precio, disponible, stock, plazo_dias } }. Devuelve bloques de texto para el informe.
export function diferenciasAnc(previo, ahora, { cop = (v) => `$${Number(v || 0).toLocaleString('es-CO')}` } = {}) {
    const informe = [];
    const base = (k) => k.replace(/\s*\d+\s*d[ií]as?/i, '').trim();
    const nuevos = Object.keys(ahora).filter((k) => !(k in previo));
    const idos = Object.keys(previo).filter((k) => !(k in ahora));
    const renombrados = nuevos.map((k) => [idos.find((o) => base(o) === base(k)), k]).filter(([o]) => o);
    const cambioPlazo = [...renombrados.map(([o, k]) => `• ${o} → ${k}`),
        ...Object.keys(ahora).filter((k) => k in previo && previo[k].plazo_dias != null && ahora[k].plazo_dias != null && previo[k].plazo_dias !== ahora[k].plazo_dias)
            .map((k) => `• ${k}: ${previo[k].plazo_dias} → ${ahora[k].plazo_dias} días`)];
    if (cambioPlazo.length) informe.push(`📅 ANC cambió la duración de planes (revisa el nombre que anuncias):\n${cambioPlazo.join('\n')}`);
    const soloNuevos = nuevos.filter((k) => !renombrados.some(([, n]) => n === k));
    const soloIdos = idos.filter((o) => !renombrados.some(([v]) => v === o));
    if (soloNuevos.length) informe.push(`🆕 ANC tiene planes nuevos (agrégalos si te sirven):\n${soloNuevos.slice(0, 10).map((k) => `• ${k} · ${cop(ahora[k].precio)}${ahora[k].stock != null ? ` · ${ahora[k].stock} und.` : ''}`).join('\n')}`);
    if (soloIdos.length) informe.push(`🗑️ ANC ya no ofrece:\n${soloIdos.slice(0, 10).map((k) => `• ${k}`).join('\n')}`);
    const precio = Object.keys(ahora).filter((k) => k in previo && ahora[k].precio !== previo[k].precio).map((k) => `• ${k}: ${cop(previo[k].precio)} → ${cop(ahora[k].precio)}`);
    if (precio.length) informe.push(`💲 ANC cambió precios (la base se ajusta sola cada 6 h):\n${precio.slice(0, 10).join('\n')}`);
    const agotado = Object.keys(ahora).filter((k) => k in previo && previo[k].disponible && !ahora[k].disponible).map((k) => `• ${k}`);
    const vuelve = Object.keys(ahora).filter((k) => k in previo && !previo[k].disponible && ahora[k].disponible).map((k) => `• ${k}${ahora[k].stock != null ? ` (${ahora[k].stock} und.)` : ''}`);
    if (agotado.length) informe.push(`⛔ Agotado en ANC:\n${agotado.join('\n')}`);
    if (vuelve.length) informe.push(`🔔 Volvió en ANC:\n${vuelve.join('\n')}`);
    const pocas = Object.keys(ahora).filter((k) => ahora[k].disponible && ahora[k].stock != null && ahora[k].stock <= 2 && !(k in previo && previo[k].stock != null && previo[k].stock <= 2))
        .map((k) => `• ${k}: ${ahora[k].stock === 1 ? 'queda 1' : `quedan ${ahora[k].stock}`}`);
    if (pocas.length) informe.push(`📉 Pocas unidades en ANC:\n${pocas.slice(0, 10).join('\n')}`);
    return informe;
}

// Portal primero; si no responde (mantenimiento), la tienda pública
export async function leerAnc() {
    try {
        return await leerPortalAnc();
    } catch (error) {
        console.warn(`⚠ ancpagos.com no respondió (${error.message}): uso su tienda pública ${URL_TIENDA}`);
        return leerTiendaAnc();
    }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('catalogo_ancpagos.mjs')) {
    const datos = await leerAnc();
    fs.mkdirSync(SALIDA.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
    fs.writeFileSync(SALIDA, JSON.stringify(datos, null, 2));
    console.log(`${datos.filas.length} variantes de ${new Set(datos.filas.map((f) => f.producto)).size} productos → ${SALIDA}`);
}
