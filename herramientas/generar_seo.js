// herramientas/generar_seo.js — Páginas indexables por producto, sitemap.xml, robots.txt y directorio del pie.
//
//   node herramientas/generar_seo.js
//
// Por qué: en la tienda los productos viven dentro de un modal que arma JavaScript; Google los indexa
// mal o tarde. Cada producto tiene aquí su página HTML estática (p/<id>.html): rápida (sin frameworks ni
// CDN de estilos), con título y descripción propios, datos estructurados Product/Offer y enlaces internos.
// El botón "Comprar" lleva a la tienda con el producto abierto (?producto=<id>).
// Fuente única: productos.json. Ejecuta este script cada vez que cambie el catálogo.

const fs = require('fs');
const path = require('path');
const WA = require('../plantillas-whatsapp.js');

const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'https://dctecnology.xyz';
const LOGO = 'https://i.ibb.co/LDN4xyW0/Mesa-de-trabajo-1.png';
const GARANTIA_DIAS = 30;
const productos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8'));
const SUPABASE_URL = 'https://vyqcizwfmjlflncdwzve.supabase.co';
const SUPABASE_PUBLICA = 'sb_publishable_GvQiv6M7iSrlwsA90lXsOQ_5OfSYBwy'; // la misma clave pública de la tienda

// Formas de pago ACTIVAS al momento de generar (RPC pública: sin números ni direcciones).
// Si cambias los métodos en el panel, vuelve a ejecutar este script para que las páginas lo reflejen.
let PAGO = { texto: 'transferencia o billetera digital', chip: '💳 Pago local y digital' };
async function cargarFormasDePago() {
    try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/metodos_pago_publicos`, {
            method: 'POST', headers: { apikey: SUPABASE_PUBLICA, 'Content-Type': 'application/json' }, body: '{}',
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const metodos = await r.json();
        if (!metodos.length) return;
        const locales = [...new Set(metodos.filter((m) => m.categoria !== 'cripto').map((m) => m.nombre || m.tipo))];
        const cripto = [...new Set(metodos.filter((m) => m.categoria === 'cripto').map((m) => (m.red && m.red !== 'BINANCE_PAY' ? `${m.moneda} ${m.red}` : m.nombre || m.tipo)))];
        const partes = [...locales.slice(0, 3), ...(cripto.length ? [`cripto (${cripto.slice(0, 3).join(', ')})`] : [])];
        PAGO = {
            texto: partes.length > 1 ? `${partes.slice(0, -1).join(', ')} o ${partes.at(-1)}` : partes[0],
            chip: `💳 ${[...locales.slice(0, 2), ...(cripto.length ? ['Cripto'] : [])].join(' · ')}`,
        };
    } catch (error) {
        console.warn(`Formas de pago: se usa el texto genérico (${error.message}).`);
    }
}

const CATEGORIAS = {
    streaming: 'Streaming', licencias: 'Licencias de software', pines: 'Pines virtuales', recargas: 'Recargas',
    tecnologia: 'Tecnología', servicios: 'Servicios técnicos', alquiler: 'Alquiler de equipos',
};
const DIGITALES = ['streaming', 'licencias', 'pines', 'recargas'];
const CON_GARANTIA = ['streaming', 'licencias', 'tecnologia'];
const COTIZABLES = ['servicios', 'alquiler'];

// Mismos hechos que la tienda (app.js → COMO_FUNCIONA / TERMINOS) y el bot: nada inventado
const PASOS = {
    digital: ['Elige tu opción y confirma el pedido por WhatsApp.', 'Paga con el método que elijas y envía el comprobante.',
        `Recibe tu producto por WhatsApp en máximo ${WA.ENTREGA_MAX_MIN} minutos tras validar el pago (${WA.HORARIO}).`],
    tecnologia: ['Elige el producto y confirmamos disponibilidad por WhatsApp.', 'Paga con el método que elijas.', 'Coordinamos el envío a tu ciudad.'],
    servicio: ['Cuéntanos qué necesitas por WhatsApp.', 'Te enviamos la cotización final antes de empezar.', 'Ejecutamos el servicio con avances por WhatsApp.'],
};
const REGLAS = {
    cuentas: ['Uso personal: no cambies la contraseña, el correo ni la facturación.', 'No compartas, revendas ni transfieras el acceso.', `Garantía de ${GARANTIA_DIAS} días desde la entrega si se cumplen las reglas de uso.`],
    pines: ['El código o saldo se envía al número o cuenta que indiques: verifica bien tus datos.', 'Las recargas y pines entregados no son reversibles.'],
    tecnologia: ['Revisa la compatibilidad de voltaje y puerto con tu equipo antes de comprar.', `Garantía de ${GARANTIA_DIAS} días por defectos de fábrica.`],
    servicios: ['El valor mostrado es estimado: el precio final se confirma tras el diagnóstico.'],
};
const grupoReglas = (tipo) => (['streaming', 'licencias'].includes(tipo) ? 'cuentas' : ['pines', 'recargas'].includes(tipo) ? 'pines' : tipo === 'tecnologia' ? 'tecnologia' : 'servicios');

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cop = (v) => `$${Number(v).toLocaleString('es-CO')}`;
const textoPlano = (html) => String(html ?? '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const urlProducto = (p) => `${SITIO}/p/${p.id}.html`;
// JSON dentro de <script>: se neutraliza "</" para que un texto del catálogo no cierre la etiqueta
const jsonSeguro = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

function datosDe(p) {
    const precios = (p.variantes ?? []).map((v) => Number(v.precio)).filter((n) => n > 0);
    const desde = precios.length ? Math.min(...precios) : null;
    const desc = Math.max(0, ...(p.variantes ?? []).map((v) => (Number(v.precio_anterior) > Number(v.precio) && v.precio > 0 ? Math.round((1 - v.precio / v.precio_anterior) * 100) : 0)));
    return { precios, desde, desc, cotizable: COTIZABLES.includes(p.tipo), categoria: CATEGORIAS[p.tipo] ?? 'Productos' };
}

function descripcionMeta(p) {
    const { desde, cotizable } = datosDe(p);
    const partes = [
        `${p.nombre}${desde ? ` desde ${cop(desde)}` : ''} en DC Technology Colombia.`,
        DIGITALES.includes(p.tipo) ? `Entrega en máximo ${WA.ENTREGA_MAX_MIN} min tras validar tu pago.` : cotizable ? 'Cotización sin compromiso.' : 'Envíos a todo el país.',
        CON_GARANTIA.includes(p.tipo) ? `Garantía de ${GARANTIA_DIAS} días.` : '',
        `Paga con ${PAGO.texto}.`,
        'Soporte por WhatsApp.',
    ];
    // Frases completas hasta 158 caracteres (Google corta más allá): nunca a mitad de palabra
    return partes.filter(Boolean).reduce((acc, frase) => ((`${acc} ${frase}`).trim().length <= 158 ? `${acc} ${frase}`.trim() : acc), '');
}

function jsonLd(p) {
    const { precios, desde, cotizable, categoria } = datosDe(p);
    const item = cotizable
        ? { '@type': 'Service', name: p.nombre, serviceType: categoria, areaServed: { '@type': 'Country', name: 'Colombia' }, provider: { '@id': `${SITIO}/#organizacion` }, image: p.imagen, url: urlProducto(p) }
        : { '@type': 'Product', name: p.nombre, image: [p.imagen], brand: { '@type': 'Brand', name: p.marca || 'DC Technology' }, category: categoria, url: urlProducto(p), description: descripcionMeta(p) };
    if (desde) {
        item.offers = precios.length === 1
            ? { '@type': 'Offer', price: desde, priceCurrency: 'COP', url: urlProducto(p), seller: { '@id': `${SITIO}/#organizacion` } }
            : { '@type': 'AggregateOffer', lowPrice: desde, highPrice: Math.max(...precios), offerCount: precios.length, priceCurrency: 'COP', url: urlProducto(p) };
    }
    return [
        { '@context': 'https://schema.org', ...item },
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITIO}/` },
            { '@type': 'ListItem', position: 2, name: categoria, item: `${SITIO}/#catalogo` },
            { '@type': 'ListItem', position: 3, name: p.nombre, item: urlProducto(p) },
        ] },
    ];
}

const CSS = `
:root{--f:#0B0F19;--c:#121826;--t:#F3F4F6;--m:#9CA3AF;--r:#FF2A5F;--r2:#E50914;--b:rgba(255,255,255,.08)}
@media (prefers-color-scheme:light){:root{--f:#F4F6FB;--c:#FFFFFF;--t:#0F111A;--m:#525252;--b:rgba(15,17,26,.1)}}
*{box-sizing:border-box}body{margin:0;background:var(--f);color:var(--t);font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:inherit}.envoltura{max-width:1080px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--b)}header .envoltura{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px}
.marca{display:flex;align-items:center;gap:10px;font-weight:900;text-decoration:none;letter-spacing:.04em}.marca img{width:36px;height:36px;border-radius:8px}.marca b{color:var(--r)}
nav.migas{font-size:13px;color:var(--m);margin:18px 0}nav.migas a{text-decoration:none}nav.migas a:hover{color:var(--t)}
.ficha{display:grid;gap:28px;grid-template-columns:1fr}@media(min-width:820px){.ficha{grid-template-columns:5fr 7fr}}
.vitrina{display:grid;place-items:center;aspect-ratio:1;border-radius:24px;background:radial-gradient(closest-side,rgba(255,255,255,.08),transparent),linear-gradient(#161D2E,#0E1320);box-shadow:inset 0 0 0 1px rgba(255,42,95,.25)}
.vitrina img{width:78%;height:78%;object-fit:contain}
h1{font-size:clamp(26px,4vw,38px);line-height:1.15;margin:4px 0 10px}.marca-p{color:var(--r);font-size:12px;font-weight:800;letter-spacing:.2em;text-transform:uppercase}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.chip{font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--b)}
table{width:100%;border-collapse:collapse;margin:16px 0;background:var(--c);border-radius:16px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--b)}
td{padding:12px 14px;border-bottom:1px solid var(--b)}td:last-child{text-align:right;font-weight:800;white-space:nowrap}tr:last-child td{border:0}s{color:var(--m);font-weight:400;margin-right:6px}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;border-radius:14px;font-weight:900;text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-size:13px}
.btn-p{color:#fff;background:linear-gradient(135deg,var(--r),var(--r2));box-shadow:0 8px 24px -8px rgba(255,42,95,.8)}.btn-w{color:#fff;background:#059669}
section.bloque{margin:28px 0;padding:20px;border-radius:20px;background:var(--c);box-shadow:inset 0 0 0 1px var(--b)}section.bloque h2{font-size:18px;margin:0 0 12px}
ol,ul{margin:0;padding-left:20px}li{margin:6px 0;color:var(--m)}li b{color:var(--t)}
.rel{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}.rel a{display:flex;gap:10px;align-items:center;padding:10px;border-radius:14px;background:var(--c);box-shadow:inset 0 0 0 1px var(--b);text-decoration:none;font-size:14px;font-weight:700}
.rel img{width:44px;height:44px;object-fit:contain;border-radius:10px;background:#121826}
footer{margin-top:40px;padding:24px 0;border-top:1px solid var(--b);color:var(--m);font-size:13px}
`;

function pagina(p) {
    const { desde, desc, cotizable, categoria } = datosDe(p);
    const titulo = `${p.nombre}${desde ? ` desde ${cop(desde)}` : ''} | ${categoria} en Colombia | DC Technology`;
    const descripcion = descripcionMeta(p);
    const pasos = (cotizable ? PASOS.servicio : p.tipo === 'tecnologia' ? PASOS.tecnologia : PASOS.digital)
        .map((x) => x.replace('el método que elijas', PAGO.texto));
    const detalles = textoPlano(p.descripcion);
    const relacionados = productos.filter((x) => x.tipo === p.tipo && x.id !== p.id).slice(0, 6);
    const comprar = `${SITIO}/?producto=${encodeURIComponent(p.id)}`;
    const whatsapp = WA.enlace(WA.NUMERO_TIENDA, WA.comprarAhora({ producto: p.nombre }));
    const chips = [
        DIGITALES.includes(p.tipo) ? `⚡ Entrega ≤ ${WA.ENTREGA_MAX_MIN} min` : null,
        CON_GARANTIA.includes(p.tipo) ? `🛡️ Garantía ${GARANTIA_DIAS} días` : null,
        PAGO.chip,
        desc ? `🔥 Hasta -${desc}%` : null,
    ].filter(Boolean);

    return `<!DOCTYPE html>
<html lang="es-CO">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
<link rel="canonical" href="${urlProducto(p)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="DC Technology">
<meta property="og:locale" content="es_CO">
<meta property="og:url" content="${urlProducto(p)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:image" content="${esc(p.imagen)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0B0F19">
<link rel="icon" href="${LOGO}">
<style>${CSS.trim()}</style>
${jsonLd(p).map((o) => `<script type="application/ld+json">${jsonSeguro(o)}</script>`).join('\n')}
</head>
<body>
<header><div class="envoltura">
<a class="marca" href="${SITIO}/"><img src="${LOGO}" alt="DC Technology" width="36" height="36">DC <b>TECHNOLOGY</b></a>
<a class="btn btn-p" href="${comprar}">Ver en la tienda</a>
</div></header>
<main class="envoltura">
<nav class="migas" aria-label="Ruta"><a href="${SITIO}/">Inicio</a> › <a href="${SITIO}/#catalogo">${esc(categoria)}</a> › <span>${esc(p.nombre)}</span></nav>
<article class="ficha">
<div class="vitrina"><img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" width="480" height="480" loading="eager" decoding="async"></div>
<div>
<p class="marca-p">${esc(p.marca || 'DC Technology')}</p>
<h1>${esc(p.nombre)}</h1>
<div class="chips">${chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>
<table><tbody>${(p.variantes ?? []).map((v) => `<tr><td>${esc(v.nombre)}</td><td>${Number(v.precio) > 0 ? `${Number(v.precio_anterior) > Number(v.precio) ? `<s>${cop(v.precio_anterior)}</s>` : ''}${cop(v.precio)}` : 'A cotizar'}</td></tr>`).join('')}</tbody></table>
<div class="cta"><a class="btn btn-p" href="${comprar}">${cotizable ? 'Cotizar' : 'Comprar ahora'}</a><a class="btn btn-w" href="${esc(whatsapp)}" rel="noopener">WhatsApp</a></div>
${!cotizable ? '<p style="color:var(--m);font-size:13px">¿Primera compra? Usa el cupón <b>DCTECH2026</b> y obtén 10% de descuento.</p>' : ''}
</div>
</article>
<section class="bloque"><h2>Cómo funciona</h2><ol>${pasos.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></section>
${detalles ? `<section class="bloque"><h2>Detalles del producto</h2><p style="color:var(--m)">${esc(detalles)}</p></section>` : ''}
<section class="bloque"><h2>Reglas y garantía</h2><ul>${REGLAS[grupoReglas(p.tipo)].map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
${relacionados.length ? `<section><h2 style="font-size:18px">También en ${esc(categoria)}</h2><div class="rel">${relacionados.map((r) => `<a href="${SITIO}/p/${r.id}.html"><img src="${esc(r.imagen)}" alt="" width="44" height="44" loading="lazy">${esc(r.nombre)}</a>`).join('')}</div></section>` : ''}
</main>
<footer><div class="envoltura">© ${new Date().getFullYear()} DC Technology · ${esc(WA.HORARIO)} · <a href="${SITIO}/portal.html">Rastrear mi pedido</a> · <a href="${SITIO}/">Tienda</a></div></footer>
</body>
</html>
`;
}

async function generar() {
await cargarFormasDePago();
// 1) Páginas de producto (se borran las de productos que ya no existen)
const carpeta = path.join(RAIZ, 'p');
fs.mkdirSync(carpeta, { recursive: true });
const vigentes = new Set(productos.map((p) => `${p.id}.html`));
for (const f of fs.readdirSync(carpeta)) if (f.endsWith('.html') && !vigentes.has(f)) fs.unlinkSync(path.join(carpeta, f));
for (const p of productos) {
    if (!/^[a-z0-9-]+$/.test(p.id)) throw new Error(`id de producto no apto para URL: ${p.id}`);
    fs.writeFileSync(path.join(carpeta, `${p.id}.html`), pagina(p), 'utf8');
}

// 2) sitemap.xml
const hoy = new Date().toISOString().slice(0, 10);
const urls = [[`${SITIO}/`, '1.0', 'daily'], [`${SITIO}/portal.html`, '0.4', 'monthly'], ...productos.map((p) => [urlProducto(p), '0.8', 'weekly'])];
fs.writeFileSync(path.join(RAIZ, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, pr, f]) => `  <url><loc>${u}</loc><lastmod>${hoy}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join('\n')}
</urlset>
`, 'utf8');

// 3) robots.txt (no es seguridad: solo evita que se indexen archivos internos)
fs.writeFileSync(path.join(RAIZ, 'robots.txt'), `User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /herramientas/
Disallow: /supabase/
Disallow: /n8n/
Disallow: /*.sql$

Sitemap: ${SITIO}/sitemap.xml
`, 'utf8');

// 4) Directorio de productos en el pie de la tienda (enlaces rastreables sin JavaScript)
const indexRuta = path.join(RAIZ, 'index.html');
const index = fs.readFileSync(indexRuta, 'utf8');
const porCategoria = Object.entries(CATEGORIAS).map(([tipo, nombre]) => [nombre, productos.filter((p) => p.tipo === tipo)]).filter(([, l]) => l.length);
const directorio = `<!-- SEO:DIRECTORIO (generado por herramientas/generar_seo.js, no editar a mano) -->
        <nav aria-label="Todos los productos" class="max-w-7xl mx-auto px-4 mt-8 pt-6 border-t border-white/5 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 text-xs text-neutral-500">
${porCategoria.map(([nombre, lista]) => `            <div><p class="font-bold uppercase tracking-wider text-neutral-400 mb-2">${esc(nombre)}</p><ul class="space-y-1">${lista.map((p) => `<li><a href="p/${p.id}.html" class="hover:text-white">${esc(p.nombre)}</a></li>`).join('')}</ul></div>`).join('\n')}
        </nav>
        <!-- /SEO:DIRECTORIO -->`;
const marca = /<!-- SEO:DIRECTORIO[\s\S]*?<!-- \/SEO:DIRECTORIO -->/;
if (!marca.test(index)) throw new Error('Falta el marcador <!-- SEO:DIRECTORIO --><!-- /SEO:DIRECTORIO --> en index.html');
fs.writeFileSync(indexRuta, index.replace(marca, directorio), 'utf8');

console.log(`SEO: ${productos.length} páginas en p/, sitemap.xml (${urls.length} URLs), robots.txt y directorio del pie actualizados. Pagos: ${PAGO.texto}.`);
}

generar().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
