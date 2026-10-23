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
const { generarGuias } = require('./generar_guias.js');

const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'https://dctecnology.xyz';
const LOGO = 'https://dctecnology.xyz/img/logo-dc-192.png';
const GARANTIA_DIAS = 30;
// Sin los ocultos: productos de categorías del proveedor que no se muestran (se activan en el panel; para Google, agrégalas a
// CATEGORIAS_VISIBLES_POR_DEFECTO en sincronizar-emprendered.mjs y vuelve a generar)
const productos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8')).filter((p) => !p.oculto);
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
        // Nombre del tipo (Nequi, Daviplata, Llave Bre-B), no el alias interno del panel ("Nequi DC")
        const locales = [...new Set(metodos.filter((m) => m.categoria !== 'cripto').map((m) => WA.tipoPago(m.tipo)?.nombre || m.nombre || m.tipo))];
        const cripto = [...new Set(metodos.filter((m) => m.categoria === 'cripto').map((m) => (m.red && m.red !== 'BINANCE_PAY' ? `${m.moneda} ${m.red}` : m.nombre || m.tipo)))];
        const partes = [...locales.slice(0, 3), ...(cripto.length ? [`cripto (${cripto.slice(0, 3).join(', ')})`] : [])];
        PAGO = {
            texto: partes.length > 1 ? `${partes.slice(0, -1).join(', ')} o ${partes.at(-1)}` : partes[0],
            chip: `💳 ${[...locales.slice(0, 3), ...(cripto.length ? ['Cripto'] : [])].join(' · ')}`,
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
const CON_GARANTIA = ['streaming', 'licencias', 'tecnologia', 'variedades'];
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
const urlCategoria = (tipo) => `${SITIO}/c/${tipo}.html`;
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
        `${p.nombre}${desde ? ` desde ${cop(desde)}` : ''} en DC Tecnology Colombia.`,
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
        : { '@type': 'Product', name: p.nombre, image: [p.imagen], ...(p.marca || !p.sincronizado ? { brand: { '@type': 'Brand', name: p.marca || 'DC Tecnology' } } : {}), category: categoria, url: urlProducto(p), description: descripcionMeta(p) };
    if (desde) {
        // Una oferta por plan, con la política de devolución real (legal/garantias.html): tecnología 5 días hábiles de
        // retracto (envío de vuelta a cargo del cliente); digitales entregados sin devolución (art. 47, Ley 1480).
        // Envío: los digitales llegan por WhatsApp sin costo; el costo de envío de tecnología no se publica (se coordina).
        const devolucion = ['tecnologia', 'variedades'].includes(p.tipo)
            ? { '@type': 'MerchantReturnPolicy', applicableCountry: 'CO', returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow', merchantReturnDays: 5,
                returnMethod: 'https://schema.org/ReturnByMail', returnFees: 'https://schema.org/ReturnShippingFees', merchantReturnLink: `${SITIO}/legal/garantias.html` }
            : { '@type': 'MerchantReturnPolicy', applicableCountry: 'CO', returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted', merchantReturnLink: `${SITIO}/legal/garantias.html` };
        const envio = DIGITALES.includes(p.tipo) ? { '@type': 'OfferShippingDetails', shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'CO' },
            shippingRate: { '@type': 'MonetaryAmount', value: 0, currency: 'COP' },
            deliveryTime: { '@type': 'ShippingDeliveryTime', handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 0, unitCode: 'DAY' }, transitTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 0, unitCode: 'DAY' } } } : null;
        item.offers = (p.variantes ?? []).filter((v) => Number(v.precio) > 0).map((v) => ({
            '@type': 'Offer', name: v.nombre, price: Number(v.precio), priceCurrency: 'COP', url: urlProducto(p), availability: p.agotado || v.agotado ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
            itemCondition: 'https://schema.org/NewCondition', seller: { '@id': `${SITIO}/#organizacion` }, hasMerchantReturnPolicy: devolucion, ...(envio ? { shippingDetails: envio } : {}),
        }));
    }
    return [
        { '@context': 'https://schema.org', ...item },
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITIO}/` },
            { '@type': 'ListItem', position: 2, name: categoria, item: urlCategoria(p.tipo) },
            { '@type': 'ListItem', position: 3, name: p.nombre, item: urlProducto(p) },
        ] },
    ];
}

const CSS = `
:root{--f:#0D1015;--c:#151920;--t:#F3F4F6;--m:#9CA3AF;--r:#E03445;--r2:#C8233A;--b:rgba(255,255,255,.09)}
@media (prefers-color-scheme:light){:root{--f:#F6F7F9;--c:#FFFFFF;--t:#0F111A;--m:#525252;--r:#C8102E;--r2:#A80C26;--b:rgba(15,17,26,.1)}}
*{box-sizing:border-box}body{margin:0;background:var(--f);color:var(--t);font:15px/1.6 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:-.003em}
a{color:inherit}.envoltura{max-width:1080px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--b)}header .envoltura{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px}
.marca{display:flex;align-items:center;gap:10px;font-weight:900;text-decoration:none;letter-spacing:.04em}.marca img{width:36px;height:36px;border-radius:8px}.marca b{color:var(--r)}
nav.migas{font-size:13px;color:var(--m);margin:18px 0}nav.migas a{text-decoration:none}nav.migas a:hover{color:var(--t)}
.ficha{display:grid;gap:28px;grid-template-columns:1fr}@media(min-width:820px){.ficha{grid-template-columns:5fr 7fr}}
.vitrina{display:grid;place-items:center;aspect-ratio:1;border-radius:24px;background:radial-gradient(120% 90% at 50% 0%,#FFFFFF 0%,#EEF0F3 55%,#DDE1E7 100%);box-shadow:inset 0 0 0 1px rgba(15,17,26,.08)}
.vitrina img{width:78%;height:78%;object-fit:contain}
h1{font-size:clamp(26px,4vw,38px);line-height:1.15;margin:4px 0 10px}.marca-p{color:var(--r);font-size:12px;font-weight:800;letter-spacing:.2em;text-transform:uppercase}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.chip{font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--b)}
table{width:100%;border-collapse:collapse;margin:16px 0;background:var(--c);border-radius:16px;overflow:hidden;box-shadow:inset 0 0 0 1px var(--b)}
td{padding:12px 14px;border-bottom:1px solid var(--b)}td:last-child{text-align:right;font-weight:800;white-space:nowrap}tr:last-child td{border:0}s{color:var(--m);font-weight:400;margin-right:6px}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;border-radius:14px;font-weight:700;text-decoration:none;font-size:14.5px}
.btn-p{color:#fff;background:var(--r);box-shadow:0 1px 2px rgba(0,0,0,.2)}.btn-p:hover{background:var(--r2)}.btn-w{color:#fff;background:#059669}
section.bloque{margin:28px 0;padding:20px;border-radius:20px;background:var(--c);box-shadow:inset 0 0 0 1px var(--b)}section.bloque h2{font-size:18px;margin:0 0 12px}
ol,ul{margin:0;padding-left:20px}li{margin:6px 0;color:var(--m)}li b{color:var(--t)}
.rel{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}.rel a{display:flex;gap:10px;align-items:center;padding:10px;border-radius:14px;background:var(--c);box-shadow:inset 0 0 0 1px var(--b);text-decoration:none;font-size:14px;font-weight:700}
.rel img{width:44px;height:44px;object-fit:contain;border-radius:10px;background:#F1F3F6}
.grilla{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));margin:18px 0}.grilla a{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:18px;background:var(--c);box-shadow:inset 0 0 0 1px var(--b);text-decoration:none}
.grilla a:hover{box-shadow:inset 0 0 0 1px var(--r)}.grilla .vitrina{border-radius:14px}.grilla b{font-size:14.5px;line-height:1.3}.grilla span{color:var(--r);font-weight:800;font-variant-numeric:tabular-nums}
.intro{color:var(--m);max-width:68ch}details{padding:12px 0;border-bottom:1px solid var(--b)}details:last-child{border:0}summary{cursor:pointer;font-weight:700}details p{color:var(--m);margin:8px 0 0}
.cats{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}.cats a{font-size:13px;font-weight:700;padding:6px 12px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--b);text-decoration:none}.cats a[aria-current]{color:#fff;background:var(--r);box-shadow:none}
footer{margin-top:40px;padding:24px 0;border-top:1px solid var(--b);color:var(--m);font-size:13px}
`;

function pagina(p) {
    const { desde, desc, cotizable, categoria } = datosDe(p);
    const titulo = `${p.nombre}${desde ? ` desde ${cop(desde)}` : ''} | ${categoria} en Colombia | DC Tecnology`;
    const descripcion = descripcionMeta(p);
    const pasos = (cotizable ? PASOS.servicio : ['tecnologia', 'variedades'].includes(p.tipo) ? PASOS.tecnologia : PASOS.digital)
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
<meta property="og:site_name" content="DC Tecnology">
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
<a class="marca" href="${SITIO}/"><img src="${LOGO}" alt="DC Tecnology" width="36" height="36">DC <b>TECNOLOGY</b></a>
<a class="btn btn-p" href="${comprar}">Ver en la tienda</a>
</div></header>
<main class="envoltura">
<nav class="migas" aria-label="Ruta"><a href="${SITIO}/">Inicio</a> › <a href="${urlCategoria(p.tipo)}">${esc(categoria)}</a> › <span>${esc(p.nombre)}</span></nav>
<article class="ficha">
<div class="vitrina"><img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" width="480" height="480" loading="eager" decoding="async"></div>
<div>
<p class="marca-p">${esc(p.marca || (p.sincronizado ? p.categoria || 'Tecnología' : 'DC Tecnology'))}</p>
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
<footer><div class="envoltura">© ${new Date().getFullYear()} DC Tecnology · ${esc(WA.HORARIO)} · <a href="${SITIO}/portal.html">Rastrear mi pedido</a> · <a href="${SITIO}/">Tienda</a><br><a href="${SITIO}/legal/terminos.html">Términos</a> · <a href="${SITIO}/legal/privacidad.html">Datos personales</a> · <a href="${SITIO}/legal/garantias.html">Garantías y devoluciones</a> · Las marcas de terceros pertenecen a sus titulares.</div></footer>
</body>
</html>
`;
}

// Páginas por categoría: apuntan a las búsquedas genéricas ("cuentas de streaming Colombia",
// "licencias Windows originales", "pines virtuales", "recargas en línea"). Solo hechos del negocio.
const SEO_CATEGORIA = {
    streaming: { h1: 'Cuentas de streaming en Colombia', titulo: 'Cuentas de Streaming en Colombia',
        intro: 'Perfiles y pantallas de las principales plataformas de streaming con entrega por WhatsApp y garantía. Elige la plataforma, paga con tu medio favorito y recibe tus accesos tras validar el pago.' },
    licencias: { h1: 'Licencias de software y apps premium', titulo: 'Licencias de Software y Apps Premium en Colombia',
        intro: 'Licencias de Windows y Office, antivirus y apps premium de diseño, edición, idiomas e IA, con entrega por WhatsApp, guía de activación y garantía.' },
    pines: { h1: 'Pines virtuales en Colombia', titulo: 'Pines Virtuales en Colombia',
        intro: 'Pines y tarjetas de regalo digitales para plataformas de video, música, juegos y tiendas de apps. El código llega por WhatsApp tras validar tu pago.' },
    recargas: { h1: 'Recargas en línea en Colombia', titulo: 'Recargas en Línea en Colombia: Celular, Juegos y TV',
        intro: 'Recargas de celular para los operadores de Colombia, diamantes de juegos y TV prepago. Indica el número o la cuenta a recargar y paga con tu medio favorito.' },
    tecnologia: { h1: 'Tecnología con garantía y envío a todo el país', titulo: 'Tecnología en Colombia: Relojes Inteligentes, Audífonos y Más',
        intro: 'Relojes inteligentes, audífonos, diademas, powerbanks y accesorios con garantía por defectos de fábrica y envío a todo Colombia.' },
    servicios: { h1: 'Servicios técnicos y automatización', titulo: 'Servicios Técnicos, Mantenimiento y Automatización en Colombia',
        intro: 'Mantenimiento y reparación de computadores, instalación de sistema operativo, asesoría técnica, catálogos web y automatizaciones para negocios. Cotización sin compromiso por WhatsApp.' },
    alquiler: { h1: 'Alquiler de equipos de cómputo', titulo: 'Alquiler de Laptops y Equipos de Cómputo',
        intro: 'Alquiler de laptops y equipos de cómputo para eventos, capacitaciones y proyectos. Cotiza por WhatsApp según cantidad y fechas.' },
};

function preguntas(tipo) {
    const digital = DIGITALES.includes(tipo);
    const lista = [];
    if (digital) lista.push([`¿Cuánto tarda la entrega?`, `Máximo ${WA.ENTREGA_MAX_MIN} minutos después de validar tu pago, en horario de ${WA.HORARIO}. Te llega por WhatsApp.`]);
    if (tipo === 'tecnologia' || tipo === 'variedades') lista.push(['¿Hacen envíos?', 'Sí, a todo el país. Confirmamos disponibilidad y coordinamos el envío por WhatsApp.']);
    if (COTIZABLES.includes(tipo)) lista.push(['¿Cuánto cuesta?', 'El valor de la tienda es estimado: te enviamos la cotización final antes de empezar, sin compromiso.']);
    lista.push(['¿Cómo pago?', `Con ${PAGO.texto}. Envías el comprobante y lo validamos.`]);
    if (CON_GARANTIA.includes(tipo)) lista.push(['¿Tiene garantía?', ['tecnologia', 'variedades'].includes(tipo) ? `Sí, ${GARANTIA_DIAS} días por defectos de fábrica.` : `Sí, ${GARANTIA_DIAS} días desde la entrega si se cumplen las reglas de uso (no cambiar contraseña, correo ni facturación y no compartir el acceso).`]);
    if (tipo === 'pines' || tipo === 'recargas') lista.push(['¿Puedo devolver una recarga o un pin?', 'No: las recargas y pines entregados no son reversibles. Verifica bien el número o la cuenta antes de pagar.']);
    if (digital) lista.push(['¿Hay descuento en la primera compra?', 'Sí: con el cupón DCTECH2026 tienes 10% en tu primera compra.']);
    lista.push(['¿Cómo los contacto?', `Por WhatsApp al +57 322 328 4622 (${WA.HORARIO}).`]);
    return lista;
}

function paginaCategoria(tipo, lista) {
    const meta = SEO_CATEGORIA[tipo] ?? { h1: CATEGORIAS[tipo], titulo: CATEGORIAS[tipo], intro: '' };
    const ejemplos = [...new Set(lista.map((p) => p.marca && !p.marca.startsWith('DC ') && !meta.titulo.includes(':') ? p.marca : null).filter(Boolean))].slice(0, 4);
    const titulo = `${meta.titulo}${ejemplos.length ? `: ${ejemplos.join(', ')}` : ''} | DC Tecnology`;
    const precios = lista.map((p) => datosDe(p).desde).filter(Boolean);
    // Frases completas hasta 158 caracteres, como en las páginas de producto
    const descripcion = [...meta.intro.split(/(?<=\.)\s+/), precios.length ? `Desde ${cop(Math.min(...precios))}.` : '', 'Entrega y soporte por WhatsApp.']
        .filter(Boolean).reduce((acc, frase) => ((`${acc} ${frase}`).trim().length <= 158 ? `${acc} ${frase}`.trim() : acc), '');
    const faq = preguntas(tipo);
    const ld = [
        { '@context': 'https://schema.org', '@type': 'CollectionPage', name: meta.h1, url: urlCategoria(tipo), description: meta.intro, isPartOf: { '@id': `${SITIO}/#organizacion` },
            mainEntity: { '@type': 'ItemList', numberOfItems: lista.length, itemListElement: lista.slice(0, 60).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: urlProducto(p), name: p.nombre })) } },
        { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITIO}/` },
            { '@type': 'ListItem', position: 2, name: CATEGORIAS[tipo], item: urlCategoria(tipo) },
        ] },
    ];
    const tipos = Object.keys(CATEGORIAS).filter((t) => productos.some((p) => p.tipo === t));
    return `<!DOCTYPE html>
<html lang="es-CO">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
<link rel="canonical" href="${urlCategoria(tipo)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="DC Tecnology">
<meta property="og:locale" content="es_CO">
<meta property="og:url" content="${urlCategoria(tipo)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:image" content="${SITIO}/img/logo-dc-512.png">
<meta name="theme-color" content="#0B0F19">
<link rel="icon" href="${LOGO}">
<style>${CSS.trim()}</style>
${ld.map((o) => `<script type="application/ld+json">${jsonSeguro(o)}</script>`).join('\n')}
</head>
<body>
<header><div class="envoltura">
<a class="marca" href="${SITIO}/"><img src="${LOGO}" alt="DC Tecnology" width="36" height="36">DC <b>TECNOLOGY</b></a>
<a class="btn btn-p" href="${SITIO}/#catalogo">Ir a la tienda</a>
</div></header>
<main class="envoltura">
<nav class="migas" aria-label="Ruta"><a href="${SITIO}/">Inicio</a> › <span>${esc(CATEGORIAS[tipo])}</span></nav>
<h1>${esc(meta.h1)}</h1>
<p class="intro">${esc(meta.intro)}</p>
<nav class="cats" aria-label="Categorías">${tipos.map((t) => `<a href="${urlCategoria(t)}"${t === tipo ? ' aria-current="page"' : ''}>${esc(CATEGORIAS[t])}</a>`).join('')}</nav>
<div class="grilla">${lista.map((p) => { const d = datosDe(p).desde; return `<a href="${urlProducto(p)}"><div class="vitrina"><img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" width="200" height="200" loading="lazy" decoding="async"></div><b>${esc(p.nombre)}</b>${d ? `<span>${COTIZABLES.includes(p.tipo) ? 'Desde ' : (p.variantes ?? []).length > 1 ? 'Desde ' : ''}${cop(d)}</span>` : '<span>A cotizar</span>'}</a>`; }).join('')}</div>
<section class="bloque"><h2>Preguntas frecuentes</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
</main>
<footer><div class="envoltura">© ${new Date().getFullYear()} DC Tecnology · ${esc(WA.HORARIO)} · <a href="${SITIO}/portal.html">Rastrear mi pedido</a> · <a href="${SITIO}/">Tienda</a><br><a href="${SITIO}/legal/terminos.html">Términos</a> · <a href="${SITIO}/legal/privacidad.html">Datos personales</a> · <a href="${SITIO}/legal/garantias.html">Garantías y devoluciones</a> · Las marcas de terceros pertenecen a sus titulares.</div></footer>
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

// 1b) Páginas por categoría
const carpetaC = path.join(RAIZ, 'c');
fs.mkdirSync(carpetaC, { recursive: true });
const tiposConProductos = Object.keys(CATEGORIAS).filter((t) => productos.some((p) => p.tipo === t));
for (const f of fs.readdirSync(carpetaC)) if (f.endsWith('.html') && !tiposConProductos.includes(f.slice(0, -5))) fs.unlinkSync(path.join(carpetaC, f));
for (const t of tiposConProductos) fs.writeFileSync(path.join(carpetaC, `${t}.html`), paginaCategoria(t, productos.filter((p) => p.tipo === t)), 'utf8');

// 1c) Guías (búsquedas informativas)
const urlsGuias = generarGuias();

// 2) sitemap.xml
const hoy = new Date().toISOString().slice(0, 10);
const urls = [[`${SITIO}/`, '1.0', 'daily'], [`${SITIO}/portal.html`, '0.4', 'monthly'], ...tiposConProductos.map((t) => [urlCategoria(t), '0.9', 'daily']), ...urlsGuias.map((u) => [u, '0.7', 'weekly']), ...['terminos', 'privacidad', 'garantias', 'cookies'].map((l) => [`${SITIO}/legal/${l}.html`, '0.3', 'monthly']), ...productos.map((p) => [urlProducto(p), '0.8', 'weekly'])];
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
        <details class="max-w-7xl mx-auto px-4 mt-8 pt-6 border-t border-white/5 text-xs text-neutral-500">
        <summary class="cursor-pointer min-h-[44px] inline-flex items-center font-bold uppercase tracking-wider text-neutral-400 hover:text-white">Ver todos los productos (${productos.length})</summary>
        <nav aria-label="Todos los productos" class="mt-4 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
${porCategoria.map(([nombre, lista]) => `            <div><p class="font-bold uppercase tracking-wider text-neutral-400 mb-2"><a href="c/${Object.keys(CATEGORIAS).find((t) => CATEGORIAS[t] === nombre)}.html" class="hover:text-white">${esc(nombre)}</a></p><ul class="space-y-1">${lista.map((p) => `<li><a href="p/${p.id}.html" class="hover:text-white">${esc(p.nombre)}</a></li>`).join('')}</ul></div>`).join('\n')}
        </nav>
        </details>
        <!-- /SEO:DIRECTORIO -->`;
const marca = /<!-- SEO:DIRECTORIO[\s\S]*?<!-- \/SEO:DIRECTORIO -->/;
if (!marca.test(index)) throw new Error('Falta el marcador <!-- SEO:DIRECTORIO --><!-- /SEO:DIRECTORIO --> en index.html');
fs.writeFileSync(indexRuta, index.replace(marca, directorio), 'utf8');

console.log(`SEO: ${productos.length} páginas en p/, ${tiposConProductos.length} categorías en c/, sitemap.xml (${urls.length} URLs), robots.txt y directorio del pie actualizados. Pagos: ${PAGO.texto}.`);
}

generar().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
