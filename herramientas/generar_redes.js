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
};
const etiquetas = (id) => [...HASHTAGS.base, ...(HASHTAGS[id] ?? ['#Tecnologia', '#Streaming'])].join(' ');

// Versiones de voz de un video: "NN-video-<voz>.mp4" (set v4) o los nombres anteriores
const versionesDe = (id) => fs.readdirSync(path.join(RAIZ, plan.carpeta)).filter((f) => new RegExp(`^(\\d+-)?${id}(-[a-z]+)?\\.mp4$`).test(f)).sort()
    .filter((f, _, todos) => !todos.some((x) => /-(kore|aoede|charon|puck)\.mp4$/.test(x)) || /-(kore|aoede|charon|puck)\.mp4$/.test(f)); // set v4 primero
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

🛒 dctecnology.xyz
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
