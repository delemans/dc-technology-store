// herramientas/generar_guias.js — Guías (guias/*.html) para búsquedas informativas en Google:
// "cómo comprar streaming en Colombia", "pagar con Nequi", "recargas en línea", "combos", "garantía".
//
//   node herramientas/generar_guias.js     (también lo llama generar_seo.js para el sitemap)
//
// Solo hechos del negocio: precios "desde" calculados de productos.json, reglas de combo de la base
// (reglas_combo_publicas: 2 → 10 %, 3+ → 15 % al 18/10/2026), horario y entrega de plantillas-whatsapp.js.
// Cada guía lleva datos estructurados Article + FAQPage + migas y enlaza a su categoría y productos.

const fs = require('fs');
const path = require('path');
const WA = require('../plantillas-whatsapp.js');

const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'https://dctecnology.xyz';
const LOGO = `${SITIO}/img/logo-dc-192.png`;
const FECHA = '2026-10-18';
const productos = JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8'));
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cop = (v) => `$${Number(v).toLocaleString('es-CO')}`;
const desde = (p) => Math.min(...(p.variantes ?? []).map((v) => Number(v.precio)).filter((n) => n > 0));
const deTipo = (t) => productos.filter((p) => p.tipo === t);
const minimo = (t) => Math.min(...deTipo(t).map(desde).filter(Number.isFinite));
const enlace = (p) => `<a href="${SITIO}/p/${p.id}.html">${esc(p.nombre)}</a>`;
const lista = (t, n = 8) => deTipo(t).slice(0, n).map(enlace).join(', ');
const E = WA.ENTREGA_MAX_MIN, H = WA.HORARIO;

const GUIAS = [
    {
        id: 'como-comprar-streaming-en-colombia',
        titulo: 'Cómo comprar una cuenta de streaming en Colombia (paso a paso)',
        descripcion: `Guía para comprar Netflix, Disney+, Max o Prime Video en Colombia desde ${cop(minimo('streaming'))}: elegir plan, pagar con Nequi o Daviplata y recibir tus accesos por WhatsApp.`,
        categoria: 'streaming',
        secciones: [
            ['Qué vas a comprar', `<p>Un perfil o pantalla de la plataforma que elijas, para usar en tus dispositivos durante el tiempo del plan. Hoy tenemos ${lista('streaming', 12)}. El precio más bajo empieza en <b>${cop(minimo('streaming'))}</b>.</p>`],
            ['Paso a paso', `<ol><li>Entra al <a href="${SITIO}/c/streaming.html">catálogo de streaming</a> y elige la plataforma.</li>
<li>Escoge el plan (pantalla, cuenta completa, días) y agrégalo al carrito, o pídelo directo por WhatsApp.</li>
<li>Escribe tu nombre y tu WhatsApp, y elige cómo pagar.</li>
<li>Paga desde tu app con los datos que te mostramos y envía el comprobante.</li>
<li>Una persona valida el pago y recibes los accesos por WhatsApp en máximo <b>${E} minutos</b> (${esc(H)}).</li></ol>`],
            ['Reglas para no perder la garantía', '<ul><li>No cambies la contraseña, el correo ni la facturación.</li><li>Usa solo tu perfil y los dispositivos que permite el plan.</li><li>No compartas ni revendas el acceso.</li></ul><p>Con eso tienes <b>30 días de garantía</b> desde la entrega.</p>'],
        ],
        faq: [
            ['¿Cuánto cuesta una pantalla de streaming?', `Depende de la plataforma y el plan; en DC Tecnology empiezan en ${cop(minimo('streaming'))}. El precio exacto se ve en cada producto.`],
            ['¿En cuánto tiempo me llega?', `En máximo ${E} minutos después de validar el pago, en horario de ${H}.`],
            ['¿Es seguro?', 'Una persona valida cada pago antes de entregar, nunca te pedimos claves bancarias y tienes 30 días de garantía si respetas las reglas de uso.'],
        ],
    },
    {
        id: 'combos-de-streaming-con-descuento',
        titulo: 'Combos de streaming: cómo ahorrar al comprar varias plataformas',
        descripcion: 'Arma un combo de plataformas de streaming en DC Tecnology: 2 plataformas distintas con 10 % de descuento y 3 o más con 15 %, en un solo pago.',
        categoria: 'streaming',
        secciones: [
            ['Cómo funciona el descuento', '<ul><li><b>2 plataformas distintas:</b> 10 % de descuento sobre el combo.</li><li><b>3 o más:</b> 15 % de descuento.</li></ul><p>El total con descuento aparece al instante y pagas todo en un solo pago. El cupón de primera compra no se acumula con el descuento del combo.</p>'],
            ['Paso a paso', `<ol><li>Entra a <a href="${SITIO}/#combos">Arma tu combo</a> en el portal de clientes.</li><li>Elige las plataformas (por ejemplo ${deTipo('streaming').slice(0, 3).map(enlace).join(', ')}).</li><li>Revisa el total con descuento, paga y envía el comprobante.</li><li>Recibes cada acceso por WhatsApp.</li></ol>`],
        ],
        faq: [
            ['¿Puedo repetir la misma plataforma en un combo?', 'El descuento cuenta plataformas distintas.'],
            ['¿El combo tiene garantía?', 'Sí, cada cuenta tiene 30 días de garantía con las mismas reglas de uso.'],
        ],
    },
    {
        id: 'como-pagar-con-nequi-daviplata-o-llave-bre-b',
        titulo: 'Cómo pagar con Nequi, Daviplata o Llave Bre-B en DC Tecnology',
        descripcion: 'Así funciona el pago en DC Tecnology: eliges el medio, pagas desde tu app, envías el comprobante y una persona lo valida. Nunca te pedimos claves.',
        categoria: null,
        secciones: [
            ['Medios de pago', '<p>Al confirmar tu pedido te mostramos los medios disponibles ese día: pagos locales como Nequi, Daviplata y Llave Bre-B y, cuando estén habilitadas, criptomonedas.</p>'],
            ['Paso a paso', `<ol><li>Elige el medio de pago al finalizar tu pedido (en la web o por WhatsApp).</li><li>Copia los datos y paga el valor exacto desde tu app.</li><li>Envía la captura o el PDF del comprobante (en la web puedes subirlo con el número de referencia).</li><li>Una persona lo valida y te avisamos por WhatsApp; los productos digitales salen en máximo ${E} minutos.</li></ol>`],
            ['Para tu seguridad', '<ul><li>Nunca te pediremos claves, códigos de verificación ni datos de tarjetas.</li><li>Paga solo a los datos que te mostramos en dctecnology.xyz o desde nuestro WhatsApp oficial +57 322 328 4622.</li></ul>'],
        ],
        faq: [
            ['¿Puedo pagar con tarjeta?', 'Hoy recibimos pagos locales (billeteras y transferencias) y, cuando estén habilitadas, criptomonedas. Los medios del día se muestran al confirmar el pedido.'],
            ['¿Qué pasa si pago fuera de horario?', `Tu pago se valida al abrir (${H}) y el pedido sale de inmediato.`],
        ],
    },
    {
        id: 'recargas-y-pines-en-linea-colombia',
        titulo: 'Recargas de celular y pines virtuales en línea en Colombia',
        descripcion: `Recarga Claro, Movistar, Tigo, Wom, ETB y Éxito, diamantes de Free Fire y pines de Google Play o Roblox desde ${cop(minimo('recargas'))}, con entrega por WhatsApp.`,
        categoria: 'recargas',
        secciones: [
            ['Qué puedes recargar', `<p><b>Recargas:</b> ${lista('recargas', 12)}.</p><p><b>Pines virtuales:</b> ${lista('pines', 12)}.</p>`],
            ['Paso a paso', `<ol><li>Elige el operador o la plataforma y el valor.</li><li>Indica el número o la cuenta a recargar: <b>verifícalo bien</b>.</li><li>Paga y envía el comprobante.</li><li>Recibes la recarga o el código del pin por WhatsApp.</li></ol>`],
            ['Importante', '<p>Las recargas y pines entregados no son reversibles. Las recargas de plataformas de apuestas son solo para mayores de 18 años.</p>'],
        ],
        faq: [
            ['¿Desde cuánto puedo recargar?', `Desde ${cop(minimo('recargas'))}, según el operador.`],
            ['¿Puedo cancelar una recarga?', 'No: una vez entregada no se puede reversar. Por eso confirmamos el número antes de pagar.'],
        ],
    },
    {
        id: 'garantia-de-cuentas-que-hacer-si-falla',
        titulo: 'Garantía de cuentas: qué hacer si tu acceso deja de funcionar',
        descripcion: 'Tu cuenta de streaming o licencia tiene 30 días de garantía en DC Tecnology. Así la reclamas desde Mis pedidos o por WhatsApp, sin contraseñas.',
        categoria: 'streaming',
        secciones: [
            ['Qué cubre', '<p>30 días desde la entrega, siempre que se respeten las reglas de uso (no cambiar contraseña, correo ni facturación; usar solo tu perfil; no compartir el acceso).</p>'],
            ['Cómo reclamarla', `<ol><li>Entra a <a href="${SITIO}/#cuenta">Mis pedidos</a> con tu número de WhatsApp: te llega un código.</li><li>En el pedido, toca <b>Reportar falla</b> y sigue los pasos sencillos.</li><li>Si sigue fallando, queda registrado y lo atiende una persona con tu garantía activa.</li></ol>`],
            ['Más información', `<p>Lee la política completa de <a href="${SITIO}/legal/garantias.html">garantías, retracto y devoluciones</a>.</p>`],
        ],
        faq: [
            ['¿Cuánto dura la garantía?', '30 días desde la entrega.'],
            ['¿Qué anula la garantía?', 'Cambiar la contraseña, el correo o la facturación, usar otro perfil o compartir el acceso.'],
        ],
    },
];

const CSS = `
:root{--f:#0D1015;--c:#151920;--t:#F3F4F6;--m:#A3A9B3;--r:#E03445;--b:rgba(255,255,255,.09)}
@media (prefers-color-scheme:light){:root{--f:#F6F7F9;--c:#FFFFFF;--t:#0F111A;--m:#4B5260;--r:#C8102E;--b:rgba(15,17,26,.1)}}
*{box-sizing:border-box}body{margin:0;background:var(--f);color:var(--t);font:16px/1.7 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--r)}.envoltura{max-width:820px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--b)}header .envoltura{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px}
.marca{display:flex;align-items:center;gap:10px;font-weight:900;text-decoration:none;color:var(--t);letter-spacing:.04em}.marca img{width:36px;height:36px;border-radius:8px}.marca b{color:var(--r)}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:12px;background:var(--r);color:#fff;font-weight:700;text-decoration:none;font-size:14px}
nav.migas{font-size:13px;color:var(--m);margin:18px 0 0}nav.migas a{color:var(--m)}
h1{font-size:clamp(26px,4.4vw,38px);line-height:1.18;margin:10px 0 8px;text-wrap:balance}.intro{color:var(--m);max-width:68ch}
section{margin:16px 0;padding:18px 20px;border-radius:18px;background:var(--c);box-shadow:inset 0 0 0 1px var(--b)}section h2{font-size:18px;margin:0 0 8px}
p,li{color:var(--m)}b{color:var(--t)}ol,ul{padding-left:22px}li{margin:6px 0}
details{padding:10px 0;border-bottom:1px solid var(--b)}details:last-child{border:0}summary{cursor:pointer;font-weight:700}
.otras{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))}.otras a{display:block;padding:12px 14px;border-radius:14px;background:var(--c);box-shadow:inset 0 0 0 1px var(--b);color:var(--t);text-decoration:none;font-weight:700;font-size:14px}
footer{margin-top:36px;padding:22px 0;border-top:1px solid var(--b);color:var(--m);font-size:13px}
`;
const urlGuia = (g) => `${SITIO}/guias/${g.id}.html`;
const NOMBRES_CAT = { streaming: 'Streaming', recargas: 'Recargas' };

function pagina(g) {
    const ld = [
        { '@context': 'https://schema.org', '@type': 'Article', headline: g.titulo, description: g.descripcion, datePublished: FECHA, dateModified: FECHA, inLanguage: 'es-CO',
            mainEntityOfPage: urlGuia(g), image: `${SITIO}/img/logo-dc-512.png`, author: { '@type': 'Organization', name: 'DC Tecnology', url: `${SITIO}/` }, publisher: { '@type': 'Organization', name: 'DC Tecnology', logo: { '@type': 'ImageObject', url: `${SITIO}/img/logo-dc-512.png` } } },
        { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: g.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) },
        { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${SITIO}/` },
            { '@type': 'ListItem', position: 2, name: 'Guías', item: `${SITIO}/guias/` },
            { '@type': 'ListItem', position: 3, name: g.titulo, item: urlGuia(g) },
        ] },
    ];
    return `<!DOCTYPE html>
<html lang="es-CO">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(g.titulo)} | DC Tecnology</title>
<meta name="description" content="${esc(g.descripcion)}">
<link rel="canonical" href="${urlGuia(g)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="DC Tecnology">
<meta property="og:locale" content="es_CO">
<meta property="og:url" content="${urlGuia(g)}">
<meta property="og:title" content="${esc(g.titulo)}">
<meta property="og:description" content="${esc(g.descripcion)}">
<meta property="og:image" content="${SITIO}/img/logo-dc-512.png">
<meta name="theme-color" content="#0B0F19">
<link rel="icon" href="${LOGO}">
<style>${CSS.trim()}</style>
${ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header><div class="envoltura"><a class="marca" href="${SITIO}/"><img src="${LOGO}" alt="DC Tecnology" width="36" height="36">DC <b>TECNOLOGY</b></a>
<a class="btn" href="${g.categoria ? `${SITIO}/c/${g.categoria}.html` : `${SITIO}/#catalogo`}">${g.categoria ? `Ver ${esc(NOMBRES_CAT[g.categoria] ?? 'catálogo')}` : 'Ver catálogo'}</a></div></header>
<main class="envoltura">
<nav class="migas" aria-label="Ruta"><a href="${SITIO}/">Inicio</a> › <a href="${SITIO}/guias/">Guías</a></nav>
<article>
<h1>${esc(g.titulo)}</h1>
<p class="intro">${esc(g.descripcion)}</p>
${g.secciones.map(([t, html]) => `<section><h2>${esc(t)}</h2>${html}</section>`).join('\n')}
<section><h2>Preguntas frecuentes</h2>${g.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>
</article>
<h2 style="font-size:18px">Otras guías</h2>
<div class="otras">${GUIAS.filter((x) => x.id !== g.id).map((x) => `<a href="${urlGuia(x)}">${esc(x.titulo)}</a>`).join('')}</div>
</main>
<footer><div class="envoltura">© ${new Date().getFullYear()} DC Tecnology · ${esc(H)} · <a href="${SITIO}/">Tienda</a> · <a href="${SITIO}/legal/terminos.html">Términos</a> · <a href="${SITIO}/legal/privacidad.html">Datos personales</a> · Las marcas de terceros pertenecen a sus titulares.</div></footer>
</body>
</html>
`;
}

function indice() {
    return `<!DOCTYPE html>
<html lang="es-CO">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guías de compra: streaming, pagos, recargas y garantía | DC Tecnology</title>
<meta name="description" content="Guías de DC Tecnology: cómo comprar streaming en Colombia, armar combos con descuento, pagar con Nequi o Daviplata, recargar y usar la garantía.">
<link rel="canonical" href="${SITIO}/guias/">
<meta name="theme-color" content="#0B0F19">
<link rel="icon" href="${LOGO}">
<style>${CSS.trim()}</style>
</head>
<body>
<header><div class="envoltura"><a class="marca" href="${SITIO}/"><img src="${LOGO}" alt="DC Tecnology" width="36" height="36">DC <b>TECNOLOGY</b></a><a class="btn" href="${SITIO}/#catalogo">Ver catálogo</a></div></header>
<main class="envoltura">
<nav class="migas" aria-label="Ruta"><a href="${SITIO}/">Inicio</a> › Guías</nav>
<h1>Guías de compra</h1>
<p class="intro">Todo lo que necesitas saber para comprar fácil y seguro en DC Tecnology.</p>
${GUIAS.map((g) => `<section><h2><a href="${urlGuia(g)}" style="color:inherit">${esc(g.titulo)}</a></h2><p>${esc(g.descripcion)}</p></section>`).join('\n')}
</main>
<footer><div class="envoltura">© ${new Date().getFullYear()} DC Tecnology · <a href="${SITIO}/">Tienda</a> · <a href="${SITIO}/legal/terminos.html">Términos</a></div></footer>
</body>
</html>
`;
}

function generarGuias() {
    const carpeta = path.join(RAIZ, 'guias');
    fs.mkdirSync(carpeta, { recursive: true });
    for (const g of GUIAS) {
        if (g.descripcion.length > 160) throw new Error(`descripción larga (${g.descripcion.length}): ${g.id}`);
        fs.writeFileSync(path.join(carpeta, `${g.id}.html`), pagina(g), 'utf8');
    }
    fs.writeFileSync(path.join(carpeta, 'index.html'), indice(), 'utf8');
    return [`${SITIO}/guias/`, ...GUIAS.map(urlGuia)];
}

module.exports = { generarGuias, GUIAS };
if (require.main === module) console.log(`Guías: ${generarGuias().length - 1} en guias/ + índice.`);
