// herramientas/generar_redes.js — Kit de publicación en redes con los 32 videos (16 × voz de mujer / de hombre).
//
//   node herramientas/generar_redes.js [AAAA-MM-DD]   (lunes de inicio; por defecto el próximo lunes)
//
// Sale: herramientas/salida/redes-plan.json (para una futura publicación por API) y "PUBLICAR EN REDES.txt" en la
// carpeta del Escritorio "Anuncios DC Tecnology" (listo para copiar y pegar al programar en Meta Business Suite,
// YouTube Studio y TikTok). Un video diario (12:30 p. m.) con el esquema de campañas de estados-plan.json, alternando voces.
// Los textos salen de herramientas/estados-plan.json (mismos hechos: nada de descuentos ni disponibilidad inventados).

const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const plan = JSON.parse(fs.readFileSync(path.join(RAIZ, 'herramientas', 'estados-plan.json'), 'utf8'));
const ESCRITORIO = 'C:/Users/dise12/Desktop/Anuncios DC Tecnology';

const TITULOS = {
    'bienvenida': 'Somos DC Tecnology 🇨🇴 | Streaming, licencias y tecnología',
    'streaming-desde': 'Streaming desde $8.000 en Colombia 📺',
    'compra-3-toques': 'Así compras tu plataforma en 3 toques ⚡',
    'primera-compra': '10% en tu primera compra con DCTECH2026 🎁',
    'relojes-audifonos': 'Relojes inteligentes y audífonos con garantía ⌚🎧',
    'combo-ahorra': 'Arma tu combo de streaming y ahorra hasta 15%',
    'pines-recargas': 'Recargas Claro, Movistar, Tigo y pines virtuales 📱',
    'tutorial-compra-entrega': 'De la compra a la entrega: así funciona DC Tecnology',
    'servicio-tecnico': '¿Tu PC está lento? Mantenimiento y reparación 🛠️',
    'por-que-dc': '¿Por qué comprar en DC Tecnology?',
    'licencias': 'Windows, Office y antivirus + instalación 🔑',
    'comprobante-web': 'Paga en la web y sube tu comprobante',
    'pedidos-whatsapp': 'Tus pedidos y tu garantía sin contraseñas',
    'soporte-garantia': '¿Algo falla? Soporte de personas reales',
    'alquiler-equipos': 'Alquiler de portátiles para empresas y eventos 💻',
    'desarrollos-completo': 'Automatizamos tu negocio: POS, dashboards y bots con IA 🤖',
    'renueva-tu-plan': 'Renueva tu plan sin cortes: te avisamos antes ⏰',
    'apps-premium': 'Canva Pro, CapCut Pro, Duolingo y Gemini 🎨',
    'free-fire-diamantes': 'Diamantes de Free Fire desde 100 💎',
    'regala-un-pin': 'Regala un pin: Google Play, Roblox, Netflix 🎁',
    'antivirus-mcafee': 'McAfee Total Protection desde $45.000 🛡️',
    'office-365': 'Office 365 u Office vitalicio + instalación 📄',
    'windows-pro': 'Windows 10 y 11 Pro + instalación 🪟',
    'mantenimiento-preventivo': '¿PC lento o caliente? Mantenimiento 🧹',
    'reparacion-computadores': 'Reparación de computadores y repuestos 🛠️',
    'desarrollo-pos': 'Sistema POS para bares y restaurantes 🍻',
    'desarrollo-rifas': 'Plataforma de pollas, rifas y juegos 🏆',
    'desarrollo-finanzas': 'Gestor financiero para tu negocio 💰',
    'desarrollo-dashboards': 'Dashboards con indicadores en tiempo real 📊',
    'desarrollo-tienda-bot': 'Tienda web + bot de WhatsApp con IA 🤖',
    'tip-mantenimiento': '¿Cada cuánto hacerle mantenimiento a tu PC? 🧰',
    'tip-office': 'Office 365 vs vitalicio: ¿cuál te conviene? 📄',
    'tip-windows': 'Windows 10 ya no tiene soporte: ¿y ahora? 🪟',
    'tip-antivirus': '4 consejos para no perder tu información 🛡️',
    'tip-pantalla-vs-cuenta': '¿Pantalla o cuenta completa? 📺',
    'satira-catalogo': 'No llenes los estados de fotos: usa un catálogo 😅',
    'no-aburras-estados': 'No aburras con tus estados: haz un catálogo virtual 🙈',
    'satira-precio-al-privado': '"¿Precio?" "Al privado"... 😅',
    'catalogo-un-enlace': 'Un enlace vale más que cien fotos 🔗',
    'catalogo-pedido-whatsapp': 'El pedido te llega completo a WhatsApp 🛒',
    'estados-que-venden': '3 reglas para estados que venden 📌',
    'catalogo-tu-negocio': 'Tu negocio en un catálogo virtual 🏪',
    'tip-automatiza': 'Automatiza lo repetitivo de tu negocio ⚙️',
    'tip-control-negocio': '¿Sabes cuánto ganaste este mes? 📊',
    'tip-por-que-antivirus': '¿Para qué un antivirus? 🛡️',
};
const HASHTAGS = {
    base: ['#DCTecnology', '#Colombia'],
    'streaming-desde': ['#Streaming', '#Netflix', '#DisneyPlus', '#Max', '#PrimeVideo'],
    'combo-ahorra': ['#Streaming', '#Netflix', '#Combo', '#Ahorro'],
    'compra-3-toques': ['#Streaming', '#ComprasOnline'],
    'primera-compra': ['#Descuento', '#ComprasOnline'],
    'relojes-audifonos': ['#Smartwatch', '#Audifonos', '#Tecnologia'],
    'pines-recargas': ['#Recargas', '#FreeFire', '#GooglePlay'],
    'servicio-tecnico': ['#SoporteTecnico', '#Computadores', '#Mantenimiento'],
    'licencias': ['#Windows', '#Office', '#Software'],
    'desarrollos-completo': ['#Automatizacion', '#IA', '#Emprendimiento', '#Negocios'],
    'alquiler-equipos': ['#AlquilerDeEquipos', '#Empresas'],
    'renueva-tu-plan': ['#Streaming', '#Netflix', '#Suscripcion'],
    'apps-premium': ['#Canva', '#CapCut', '#Duolingo', '#IA'],
    'free-fire-diamantes': ['#FreeFire', '#Diamantes', '#Gamer'],
    'regala-un-pin': ['#Regalo', '#GooglePlay', '#Roblox'],
    'antivirus-mcafee': ['#McAfee', '#Antivirus', '#Seguridad'],
    'office-365': ['#Office', '#Excel', '#Word'],
    'windows-pro': ['#Windows11', '#Windows10', '#Licencias'],
    'mantenimiento-preventivo': ['#Mantenimiento', '#SoporteTecnico', '#PC'],
    'reparacion-computadores': ['#ReparacionDePC', '#SoporteTecnico', '#Repuestos'],
    'desarrollo-pos': ['#POS', '#Restaurantes', '#Bares', '#Software'],
    'desarrollo-rifas': ['#Rifas', '#Pollas', '#Eventos'],
    'desarrollo-finanzas': ['#Finanzas', '#Emprendimiento', '#Software'],
    'desarrollo-dashboards': ['#Dashboards', '#Indicadores', '#Datos'],
    'desarrollo-tienda-bot': ['#TiendaOnline', '#Chatbot', '#IA', '#WhatsApp'],
    'tip-mantenimiento': ['#TipsTecnologia', '#Mantenimiento', '#PC'],
    'tip-office': ['#Office', '#Microsoft365', '#Tips'],
    'tip-windows': ['#Windows11', '#Windows10', '#Seguridad'],
    'tip-antivirus': ['#Ciberseguridad', '#Tips', '#Antivirus'],
    'tip-pantalla-vs-cuenta': ['#Streaming', '#Netflix', '#Tips'],
    'satira-catalogo': ['#CatalogoVirtual', '#Emprendimiento', '#Humor', '#WhatsApp'],
    'no-aburras-estados': ['#CatalogoVirtual', '#EstadosDeWhatsApp', '#Emprendimiento', '#Humor'],
    'satira-precio-al-privado': ['#CatalogoVirtual', '#Ventas', '#Humor', '#Emprendimiento'],
    'catalogo-un-enlace': ['#CatalogoVirtual', '#TiendaOnline', '#Pymes'],
    'catalogo-pedido-whatsapp': ['#CatalogoVirtual', '#WhatsAppBusiness', '#Ventas'],
    'estados-que-venden': ['#EstadosDeWhatsApp', '#Marketing', '#Tips'],
    'catalogo-tu-negocio': ['#CatalogoVirtual', '#Emprendimiento', '#Colombia'],
    'tip-automatiza': ['#Automatizacion', '#Emprendimiento', '#Pymes'],
    'tip-control-negocio': ['#Finanzas', '#Dashboard', '#Pymes'],
    'tip-por-que-antivirus': ['#Ciberseguridad', '#Antivirus', '#Tips'],
};
const etiquetas = (id) => [...HASHTAGS.base, ...(HASHTAGS[id] ?? ['#Tecnologia', '#Streaming'])].join(' ');

// Versiones de voz de un video: "NN-video-<voz>.mp4" (set v4) o los nombres anteriores
// set.json (lo escribe el estudio) manda: el video vigente de cada id; sin él, la regla de nombres de antes
const vigentes = (() => { try { return JSON.parse(fs.readFileSync(path.join(RAIZ, plan.carpeta, 'set.json'), 'utf8')).videos ?? []; } catch { return []; } })();
const versionesDe = (id) => {
    const archivos = fs.readdirSync(path.join(RAIZ, plan.carpeta));
    const delSet = vigentes.filter((x) => x.video === id && archivos.includes(x.archivo)).map((x) => x.archivo);
    if (delSet.length) return delSet;
    return archivos.filter((f) => new RegExp(`^(\\d+-)?${id}(-[a-z]+)?\\.mp4$`).test(f)).sort()
        .filter((f, _, todos) => !todos.some((x) => /-(kore|aoede|charon|puck)\.mp4$/.test(x)) || /-(kore|aoede|charon|puck)\.mp4$/.test(f)); // set v4 primero
};
const DIAS = Number(process.env.DIAS) > 0 ? Number(process.env.DIAS) : 28;

const inicio = (() => {
    if (process.argv[2]) return new Date(`${process.argv[2]}T12:30:00-05:00`);
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7)); // próximo lunes
    return new Date(`${d.toLocaleDateString('en-CA')}T12:30:00-05:00`);
})();
const fechaTexto = (d) => d.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });

// Un video diario durante DIAS (28 = las 4 campañas): la campaña de cada semana sale de estados-plan.json
const textoDe = (id) => plan.videos.find((v) => v.archivo === id)?.texto ?? '';
const desdeInicio = Math.round((inicio.getTime() - Date.parse(`${plan.inicio_campanas}T12:30:00-05:00`)) / 864e5);
const publicaciones = Array.from({ length: DIAS }, (_, d) => {
    const n = Math.max(0, desdeInicio + d), semana = Math.floor(n / 7), dia = n % 7;
    const campana = plan.campanas[semana % plan.campanas.length];
    const id = campana.videos[dia];
    const versiones = versionesDe(id);
    const archivo = versiones.length ? versiones[(semana + dia) % versiones.length] : null;
    const fecha = new Date(inicio.getTime() + d * 864e5);
    const texto = `${textoDe(id)}

🛒 www.dctecnology.xyz
💬 WhatsApp 322 328 4622`;
    return { fecha: fecha.toISOString(), campana: campana.nombre, video: id, archivo, titulo: TITULOS[id] ?? id,
        youtube: { titulo: `${TITULOS[id] ?? id} #Shorts`.slice(0, 100), descripcion: `${texto}

${etiquetas(id)}` },
        instagram_facebook: `${texto}

${etiquetas(id)}`, tiktok: `${textoDe(id)} ${etiquetas(id)}`.slice(0, 2200) };
});

fs.mkdirSync(path.join(RAIZ, 'herramientas', 'salida'), { recursive: true });
fs.writeFileSync(path.join(RAIZ, 'herramientas', 'salida', 'redes-plan.json'), JSON.stringify(publicaciones, null, 2));
const txt = [
    'PUBLICAR EN REDES · DC Tecnology',
    '==================================',
    `${publicaciones.length} publicaciones · una diaria a las 12:30 p. m. · desde el ${fechaTexto(inicio)} · 4 campañas semanales (${plan.campanas.map((c) => c.nombre).join(' → ')}).`,
    '',
    'CÓMO PROGRAMARLAS (una sola vez para las 4 semanas):',
    '1) Instagram y Facebook: business.facebook.com → Planificador → Crear reel → sube el video, pega el texto, elige fecha y hora.',
    '2) YouTube: studio.youtube.com → Crear → Subir video → título y descripción de abajo → Visibilidad: Programar.',
    '3) TikTok: tiktok.com/upload en el computador → pega el texto → "Programar" (hasta 10 días antes; repite cada semana).',
    'Los videos de más de 60 s (desarrollos-completo) van como Reel/Short largo; en estados de WhatsApp se omiten.',
    '',
    ...publicaciones.flatMap((p, i) => [
        `---------------- ${i + 1}. ${fechaTexto(new Date(p.fecha))} · 12:30 p. m. · campaña: ${p.campana} ----------------`,
        `VIDEO: ${p.archivo ?? '(falta el archivo)'}`,
        `TÍTULO YOUTUBE: ${p.youtube.titulo}`,
        'TEXTO (Instagram, Facebook y descripción de YouTube):',
        p.instagram_facebook,
        `TEXTO TIKTOK: ${p.tiktok}`,
        '',
    ]),
].join('\r\n');
if (fs.existsSync(ESCRITORIO)) fs.writeFileSync(path.join(ESCRITORIO, 'PUBLICAR EN REDES.txt'), '\ufeff' + txt, 'utf8');
console.log(`Redes: ${publicaciones.length} publicaciones desde ${inicio.toISOString().slice(0, 10)} → herramientas/salida/redes-plan.json${fs.existsSync(ESCRITORIO) ? ' y "PUBLICAR EN REDES.txt" en el Escritorio' : ''}. Sin archivo: ${publicaciones.filter((p) => !p.archivo).length}`);
