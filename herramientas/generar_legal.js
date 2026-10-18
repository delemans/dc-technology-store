// herramientas/generar_legal.js — Páginas legales del sitio (legal/*.html): términos, datos personales, garantías y cookies.
//
//   node herramientas/generar_legal.js
//
// Marco: Colombia. Ley 1480 de 2011 (Estatuto del Consumidor: información, garantía, retracto art. 47, reversión del
// pago art. 51, comercio electrónico arts. 49–54), Ley 1581 de 2012 y Decreto 1377 de 2013 (datos personales),
// Ley 527 de 1999 (comercio electrónico). Los hechos (horario, garantía, entrega, reglas) salen de las mismas fuentes que
// la tienda y el bot (plantillas-whatsapp.js): si cambian allá, vuelve a ejecutar este script.
// IMPORTANTE: es un texto base serio, no reemplaza la revisión de un abogado. Completa DATOS_RESPONSABLE con la razón
// social / NIT / dirección cuando los tengas (si están vacíos, la página no los muestra).

const fs = require('fs');
const path = require('path');
const WA = require('../plantillas-whatsapp.js');

const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'https://dctecnology.xyz';
const LOGO = `${SITIO}/img/logo-dc-192.png`;
const VIGENCIA = '18 de octubre de 2026';
const GARANTIA_DIAS = 30;
const WHATSAPP = '+57 322 328 4622';
const DATOS_RESPONSABLE = {
    nombre: 'DC Tecnology',
    razon_social: '',   // p. ej. nombre de la persona natural o empresa registrada
    nit: '',            // NIT o cédula con la que factura
    domicilio: 'Colombia',
    direccion: '',
};
const HORARIO = WA.HORARIO;
const ENTREGA = WA.ENTREGA_MAX_MIN;

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PAGINAS = [
    { id: 'terminos', titulo: 'Términos y condiciones', corto: 'Términos' },
    { id: 'privacidad', titulo: 'Política de tratamiento de datos personales', corto: 'Datos personales' },
    { id: 'garantias', titulo: 'Garantías, retracto y devoluciones', corto: 'Garantías y devoluciones' },
    { id: 'cookies', titulo: 'Cookies y almacenamiento local', corto: 'Cookies' },
];

const responsable = () => [
    `<b>${esc(DATOS_RESPONSABLE.nombre)}</b>${DATOS_RESPONSABLE.razon_social ? ` (${esc(DATOS_RESPONSABLE.razon_social)})` : ''}`,
    DATOS_RESPONSABLE.nit ? `NIT ${esc(DATOS_RESPONSABLE.nit)}` : null,
    DATOS_RESPONSABLE.direccion ? esc(DATOS_RESPONSABLE.direccion) : null,
    `Domicilio: ${esc(DATOS_RESPONSABLE.domicilio)}`,
    `WhatsApp: ${WHATSAPP} (${esc(HORARIO)})`,
    `Sitio: <a href="${SITIO}/">dctecnology.xyz</a>`,
].filter(Boolean).join(' · ');

// Contenido: [título de sección, html]
const CONTENIDO = {
    terminos: [
        ['1. Quiénes somos', `<p>${responsable()}.</p><p>DC Tecnology vende en línea productos y servicios digitales (accesos a plataformas de streaming, licencias y apps, pines virtuales y recargas), productos de tecnología y servicios técnicos y de desarrollo. Al hacer un pedido en este sitio, por WhatsApp o en el portal de clientes aceptas estos términos.</p>`],
        ['2. Marcas de terceros', '<p>Netflix, Disney+, Max, Prime Video, Windows, Office, Google Play, Roblox y las demás marcas que aparecen en el catálogo pertenecen a sus titulares. DC Tecnology es un revendedor independiente: no está afiliado ni patrocinado por esas empresas. Las condiciones de cada plataforma (catálogo, calidad, cambios de precio o de reglas) las define su titular.</p>'],
        ['3. Precios y pedidos', `<ul><li>Los precios están en pesos colombianos (COP) e incluyen todo lo que pagas por el producto. Pueden cambiar sin previo aviso; el precio que vale es el que te confirmamos al hacer el pedido.</li>
<li>Al confirmar un pedido recibes una referencia (por ejemplo DC-XXXXX). Con ella sigues tu pedido en el portal de clientes.</li>
<li>El cupón <b>DCTECH2026</b> da 10 % en la primera compra, una vez por cliente. No se acumula con el descuento de combos.</li>
<li>Los combos de plataformas tienen el descuento que se muestra al armarlos (según la cantidad de plataformas).</li></ul>`],
        ['4. Pagos', `<p>Aceptamos los medios que se muestran al confirmar el pedido (pagos locales como Nequi, Daviplata o Llave Bre-B y, cuando estén habilitadas, criptomonedas). Envías el comprobante y <b>una persona valida el pago</b> antes de entregar. Nunca te pediremos claves bancarias, códigos de verificación ni datos de tarjetas.</p>`],
        ['5. Entrega', `<ul><li>Productos digitales: por WhatsApp en máximo <b>${ENTREGA} minutos</b> después de validar el pago, en el horario de atención (${esc(HORARIO)}). Si pagas fuera de horario, el pedido se procesa al abrir.</li>
<li>Tecnología: confirmamos disponibilidad y coordinamos el envío a tu ciudad; los tiempos dependen de la transportadora.</li>
<li>Servicios técnicos y desarrollos: el valor de la tienda es estimado; el precio final y los tiempos se acuerdan antes de empezar.</li></ul>`],
        ['6. Reglas de uso de las cuentas de streaming y apps', `<ul><li>Son de uso personal: no cambies la contraseña, el correo, la facturación ni los datos de la cuenta.</li>
<li>Usa solo el perfil asignado y en la cantidad de dispositivos que permite tu plan.</li>
<li>No compartas, revendas ni transfieras el acceso.</li>
<li>Si se incumplen estas reglas, la garantía se pierde y el acceso puede ser suspendido sin reembolso.</li></ul>`],
        ['7. Pines y recargas', '<p>El código o saldo se envía al número o cuenta que indiques: verifica bien tus datos antes de pagar. Una vez entregados, los pines y recargas no son reversibles. Las recargas de plataformas de apuestas son solo para <b>mayores de 18 años</b>; juega con responsabilidad.</p>'],
        ['8. Responsabilidad', '<p>Respondemos por lo que vendemos según la ley colombiana y las garantías de este sitio. No respondemos por cambios, bloqueos o caídas que dependan de la plataforma de cada marca, ni por el mal uso del producto. Si una plataforma deja de funcionar dentro de la garantía, lo resolvemos según la sección de garantías.</p>'],
        ['9. Atención, peticiones, quejas y reclamos (PQR)', `<p>Escríbenos por WhatsApp al ${WHATSAPP} o usa <a href="${SITIO}/portal.html">Mis pedidos</a> para reportar una falla. Respondemos en el horario de atención. Si no quedas conforme, puedes acudir a la Superintendencia de Industria y Comercio (<a href="https://www.sic.gov.co" rel="noopener">sic.gov.co</a>).</p>`],
        ['10. Ley aplicable', '<p>Estos términos se rigen por las leyes de la República de Colombia, en especial la Ley 1480 de 2011 (Estatuto del Consumidor) y la Ley 527 de 1999 (comercio electrónico). Podemos actualizarlos; la versión vigente es la publicada aquí con su fecha.</p>'],
    ],
    privacidad: [
        ['1. Responsable del tratamiento', `<p>${responsable()}. Esta política cumple la Ley 1581 de 2012 y el Decreto 1377 de 2013 (compilado en el Decreto 1074 de 2015).</p>`],
        ['2. Qué datos tratamos', `<ul><li><b>Identificación y contacto:</b> nombre y número de WhatsApp.</li>
<li><b>Pedidos:</b> productos, valores, referencia, estado, garantía y, si aplica, el número o cuenta a recargar y la dirección de envío.</li>
<li><b>Pagos:</b> el comprobante que nos envías (imagen o PDF) y su número de referencia. No recibimos ni guardamos claves bancarias ni datos de tarjetas.</li>
<li><b>Conversaciones:</b> los mensajes que nos escribes por WhatsApp y los reportes de soporte.</li>
<li><b>Navegación:</b> lo que el sitio guarda en tu propio navegador (ver <a href="cookies.html">Cookies</a>). No usamos herramientas de analítica ni publicidad de terceros.</li></ul>
<p>No pedimos datos sensibles. Si eres menor de edad, compra con un adulto responsable: no recolectamos a sabiendas datos de niños, niñas o adolescentes.</p>`],
        ['3. Para qué los usamos (finalidades)', `<ul><li>Recibir, validar, entregar y hacer seguimiento a tus pedidos y pagos.</li>
<li>Darte soporte y atender la garantía.</li>
<li>Enviarte por WhatsApp los avisos de tu pedido (pago recibido, entrega, garantía, código de acceso al portal) y, una vez, una solicitud de opinión que puedes rechazar respondiendo NO.</li>
<li>Responder tus mensajes con ayuda de un asistente automático (ver punto 4).</li>
<li>Cumplir obligaciones legales, contables y de seguridad, y prevenir fraudes.</li>
<li>Solo si lo autorizas: enviarte promociones. Puedes retirar esa autorización en cualquier momento.</li></ul>`],
        ['4. Quién más los procesa (encargados)', `<p>Usamos proveedores tecnológicos que tratan los datos por cuenta nuestra y solo para estas finalidades. Algunos están fuera de Colombia, por lo que hay <b>transferencia o transmisión internacional</b> de datos:</p>
<ul><li>Supabase (base de datos y archivos de pedidos y comprobantes).</li>
<li>GitHub Pages (alojamiento de este sitio; no guarda tus datos de pedidos).</li>
<li>WhatsApp / Meta (mensajería).</li>
<li>Servicios de inteligencia artificial que ayudan a contestar los mensajes de WhatsApp (por ejemplo Groq, Google, NVIDIA u OpenRouter): reciben el texto de la conversación para generar la respuesta. Una persona valida los pagos y las entregas.</li></ul>
<p>No vendemos ni alquilamos tus datos. A los proveedores de los productos solo les damos el dato indispensable para cumplir tu pedido (por ejemplo, el número a recargar).</p>`],
        ['5. Tus derechos', `<p>Como titular puedes: conocer, actualizar y rectificar tus datos; pedir prueba de la autorización; ser informado del uso que les damos; revocar la autorización o pedir que se supriman (cuando no exista un deber legal o contractual de conservarlos); acceder gratis a ellos; y presentar quejas ante la Superintendencia de Industria y Comercio.</p>`],
        ['6. Cómo ejercerlos', `<p>Escríbenos por WhatsApp al ${WHATSAPP} con la palabra <b>DATOS</b> e indica qué solicitas. Verificaremos tu identidad con el mismo número. Plazos legales: <b>consultas</b>, 10 días hábiles (prorrogables 5); <b>reclamos</b>, 15 días hábiles (prorrogables 8), contados desde que el reclamo esté completo.</p>`],
        ['7. Conservación y seguridad', '<p>Guardamos los datos mientras dure la relación comercial y el tiempo que exijan las normas contables, tributarias y de garantía. Aplicamos medidas razonables: acceso restringido al panel de administración, conexiones cifradas (HTTPS), y los accesos de tus cuentas solo se consultan en el portal con un código que llega a tu WhatsApp.</p>'],
        ['8. Autorización', '<p>Al escribirnos por WhatsApp, hacer un pedido o entrar al portal de clientes, autorizas el tratamiento de tus datos para las finalidades de esta política. Las promociones requieren tu autorización expresa.</p>'],
        ['9. Vigencia', `<p>Vigente desde el ${VIGENCIA}. Si la cambiamos de forma sustancial, lo publicaremos aquí con la nueva fecha.</p>`],
    ],
    garantias: [
        ['1. Garantía', `<ul><li><b>Cuentas de streaming, licencias y apps:</b> ${GARANTIA_DIAS} días desde la entrega, siempre que se cumplan las reglas de uso (ver <a href="terminos.html">Términos</a>). Si el acceso falla, lo reparamos o te entregamos un acceso de reemplazo; si no es posible, aplican el cambio o la devolución del dinero que establece la Ley 1480 de 2011.</li>
<li><b>Tecnología:</b> ${GARANTIA_DIAS} días por defectos de fábrica. No cubre golpes, humedad, manipulación ni mal uso (por ejemplo, cargadores de voltaje mayor al indicado). Se hace la revisión técnica y, según el caso, se repara, se cambia o se devuelve el dinero.</li>
<li><b>Servicios técnicos:</b> sobre el trabajo realizado, según lo acordado en la cotización.</li></ul>
<p>Esto no limita los derechos que te da la Ley 1480 de 2011.</p>`],
        ['2. Cómo reclamar la garantía', `<p>Entra a <a href="${SITIO}/portal.html">Mis pedidos</a> con tu número de WhatsApp y toca "Reportar falla", o escríbenos al ${WHATSAPP} con tu referencia (DC-XXXXX). Te guiamos paso a paso y, si sigue fallando, lo atiende una persona.</p>`],
        ['3. Derecho de retracto (art. 47, Ley 1480)', `<p>En las compras a distancia puedes retractarte dentro de los <b>5 días hábiles</b> siguientes a la entrega del producto, devolviéndolo en el mismo estado en que lo recibiste. Te devolvemos el dinero dentro de los 30 días calendario siguientes. Los costos de transporte de la devolución corren por tu cuenta.</p>
<p>La ley excluye del retracto, entre otros: los <b>servicios cuya prestación ya comenzó</b> con tu acuerdo (como una cuenta o licencia ya entregada y activada), los <b>programas y contenidos digitales que ya se abrieron</b> (como un pin o código ya entregado), los bienes de uso personal y los juegos de apuestas. Por eso, los productos digitales entregados no tienen retracto, pero sí garantía.</p>`],
        ['4. Pedidos no entregados', `<p>Si pagaste y no podemos entregar tu producto (por ejemplo, porque se agotó), te avisamos y eliges: otro producto equivalente o la devolución del valor que pagaste.</p>`],
        ['5. Reversión del pago (art. 51, Ley 1480)', '<p>Si pagaste con un medio de pago electrónico y fuiste víctima de fraude, la operación no fue solicitada, el producto no se recibió o no corresponde a lo pedido o es defectuoso, puedes pedir la reversión a tu entidad financiera dentro de los 5 días hábiles siguientes a que lo notes, avisándonos a la vez.</p>'],
        ['6. Quejas', '<p>Si no quedas conforme con la respuesta, puedes acudir a la Superintendencia de Industria y Comercio (<a href="https://www.sic.gov.co" rel="noopener">sic.gov.co</a>).</p>'],
    ],
    cookies: [
        ['1. Qué usamos', `<p>Este sitio <b>no usa cookies de publicidad ni de analítica</b>. Solo guarda en tu propio navegador (almacenamiento local) lo necesario para que la tienda funcione:</p>
<ul><li><b>dc_cliente_carrito</b>: los productos de tu carrito.</li>
<li><b>dc_cliente_datos</b>: tu nombre y WhatsApp para no escribirlos en cada compra.</li>
<li><b>dc_cliente_sesion</b>: tu sesión del portal de clientes (vence sola).</li>
<li><b>dc_cliente_ordenes</b>, <b>dc_cliente_pedidos</b> y <b>dc_portal_recientes</b>: tus pedidos recientes en este dispositivo.</li>
<li><b>dc_tema</b> y <b>dc_sonido</b>: si prefieres modo claro u oscuro y los sonidos.</li></ul>`],
        ['2. Terceros', '<p>Para mostrar el sitio se cargan tipografías e íconos desde servicios públicos (Google Fonts, cdnjs) e imágenes de productos desde los servidores de los proveedores. Esos servicios pueden registrar datos técnicos de la conexión (como la dirección IP) según sus propias políticas.</p>'],
        ['3. Cómo borrarlos', '<p>Puedes borrar estos datos cuando quieras desde la configuración de tu navegador ("Borrar datos de navegación" o "Datos de sitios"). Si lo haces, se vacía tu carrito y se cierra tu sesión del portal.</p>'],
    ],
};

const CSS = `
:root{--f:#0D1015;--c:#151920;--t:#F3F4F6;--m:#A3A9B3;--r:#E03445;--b:rgba(255,255,255,.09)}
@media (prefers-color-scheme:light){:root{--f:#F6F7F9;--c:#FFFFFF;--t:#0F111A;--m:#4B5260;--r:#C8102E;--b:rgba(15,17,26,.1)}}
*{box-sizing:border-box}body{margin:0;background:var(--f);color:var(--t);font:15.5px/1.65 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
a{color:var(--r)}.envoltura{max-width:860px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--b)}header .envoltura{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px}
.marca{display:flex;align-items:center;gap:10px;font-weight:900;text-decoration:none;color:var(--t);letter-spacing:.04em}.marca img{width:36px;height:36px;border-radius:8px}.marca b{color:var(--r)}
nav.legal{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0 4px}nav.legal a{font-size:13px;font-weight:700;padding:6px 12px;border-radius:999px;box-shadow:inset 0 0 0 1px var(--b);text-decoration:none;color:var(--t)}nav.legal a[aria-current]{background:var(--r);color:#fff;box-shadow:none}
h1{font-size:clamp(26px,4vw,36px);line-height:1.2;margin:18px 0 4px;text-wrap:balance}.fecha{color:var(--m);font-size:13px;margin:0 0 20px}
section{margin:14px 0;padding:18px 20px;border-radius:18px;background:var(--c);box-shadow:inset 0 0 0 1px var(--b)}section h2{font-size:17px;margin:0 0 8px}
p,li{color:var(--m)}b{color:var(--t)}ul{padding-left:20px;margin:6px 0}li{margin:6px 0}
footer{margin-top:36px;padding:22px 0;border-top:1px solid var(--b);color:var(--m);font-size:13px}
`;

function pagina(p) {
    const descripcion = {
        terminos: 'Términos y condiciones de compra en DC Tecnology: precios, pagos, entrega, reglas de uso, pines y recargas, PQR y ley aplicable en Colombia.',
        privacidad: 'Política de tratamiento de datos personales de DC Tecnology según la Ley 1581 de 2012: qué datos tratamos, para qué, encargados y cómo ejercer tus derechos.',
        garantias: `Garantía de ${GARANTIA_DIAS} días, derecho de retracto, devoluciones y reversión del pago en DC Tecnology según la Ley 1480 de 2011.`,
        cookies: 'Qué guarda el sitio de DC Tecnology en tu navegador: sin cookies de publicidad ni analítica, solo lo necesario para el carrito y tu sesión.',
    }[p.id];
    return `<!DOCTYPE html>
<html lang="es-CO">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.titulo)} | DC Tecnology</title>
<meta name="description" content="${esc(descripcion)}">
<link rel="canonical" href="${SITIO}/legal/${p.id}.html">
<meta property="og:title" content="${esc(p.titulo)} | DC Tecnology">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:url" content="${SITIO}/legal/${p.id}.html">
<meta name="theme-color" content="#0B0F19">
<link rel="icon" href="${LOGO}">
<style>${CSS.trim()}</style>
</head>
<body>
<header><div class="envoltura"><a class="marca" href="${SITIO}/"><img src="${LOGO}" alt="DC Tecnology" width="36" height="36">DC <b>TECNOLOGY</b></a><a href="${SITIO}/">Ir a la tienda</a></div></header>
<main class="envoltura">
<nav class="legal" aria-label="Documentos legales">${PAGINAS.map((x) => `<a href="${x.id}.html"${x.id === p.id ? ' aria-current="page"' : ''}>${esc(x.corto)}</a>`).join('')}</nav>
<h1>${esc(p.titulo)}</h1>
<p class="fecha">Última actualización: ${VIGENCIA}</p>
${CONTENIDO[p.id].map(([t, html]) => `<section><h2>${esc(t)}</h2>${html}</section>`).join('\n')}
</main>
<footer><div class="envoltura">© ${new Date().getFullYear()} DC Tecnology · ${esc(HORARIO)} · WhatsApp ${WHATSAPP}</div></footer>
</body>
</html>
`;
}

fs.mkdirSync(path.join(RAIZ, 'legal'), { recursive: true });
for (const p of PAGINAS) fs.writeFileSync(path.join(RAIZ, 'legal', `${p.id}.html`), pagina(p), 'utf8');
module.exports = { PAGINAS };
console.log(`Legal: ${PAGINAS.length} páginas en legal/ (${PAGINAS.map((p) => p.id).join(', ')}). Vigencia ${VIGENCIA}.`);
