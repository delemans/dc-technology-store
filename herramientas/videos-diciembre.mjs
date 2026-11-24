// herramientas/videos-diciembre.mjs — Videos de diciembre 2026 (pedido del director el 24/11/2026): un video vertical
// 1080×1920 por CADA producto de ANC visible + mantenimiento y revisión, con música original y 7 formatos distintos
// (regalo sorpresa, tráiler de cine, ritmo, calendario de adviento, vitrina giratoria, tarjeta navideña y lista de
// regalos) + un resumen con todo el catálogo. Mismos datos reales que las imágenes (publicidad-diciembre.mjs --json):
// precios vigentes, «Solo quedan N» con las unidades reales, sin precio «antes» ni descuentos y sin nombrar al proveedor.
// Se arma todo en Chrome sin ventana (WebCodecs: H.264 + AAC), sin instalar programas.
//
//   node --use-system-ca herramientas/videos-diciembre.mjs            → todos los videos
//   node --use-system-ca herramientas/videos-diciembre.mjs --solo 08  → solo la pieza 08 (o «todos» para el resumen)
//   node --use-system-ca herramientas/videos-diciembre.mjs --vistas   → además guarda 4 fotogramas de control por video
// Salida: Escritorio «Anuncios DC Tecnology/Diciembre 2026/Videos 1080x1920» + VIDEOS.txt (formato y texto de cada uno)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hablar, wav, SR as SR_VOZ } from './voz-gemini.mjs';
import { transcribir, parecido } from './transcribir.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(process.env.USERPROFILE ?? 'C:/Users/dise12', 'Desktop', 'Anuncios DC Tecnology', 'Diciembre 2026');
const CARPETA = path.join(DESTINO, 'Videos 1080x1920');
const TMP = path.join(RAIZ, 'herramientas', 'salida', `diciembre-video-${process.pid}`); // una por ejecución: dos corridas a la vez no se pisan
const FPS = 30;
const args = process.argv.slice(2);
const SOLO = args.includes('--solo') ? args[args.indexOf('--solo') + 1] : null;
const VISTAS = args.includes('--vistas');
const SIN_VOZ = args.includes('--sin-voz');
const SIN_CONTROL = args.includes('--sin-control');
const REHACER = args.includes('--rehacer');
// Registro de videos ya hechos CON voz verificada: una corrida nueva sigue donde quedó (el cupo de voz es diario)
const REGISTRO_VOZ = path.join(RAIZ, 'herramientas', 'salida', 'videos-con-voz.json');
const REG = fs.existsSync(REGISTRO_VOZ) ? JSON.parse(fs.readFileSync(REGISTRO_VOZ, 'utf8')) : {};
// Voces de Gemini TTS que rotan entre videos (lanzamiento: Charon)
const VOCES = ['Puck', 'Aoede', 'Charon', 'Kore', 'Zephyr', 'Fenrir', 'Leda', 'Orus'];

// --instalar: tarea diaria 3:30 a. m. (el cupo de voz de Gemini ya se renovó): genera lo pendiente en orden de
// urgencia y rearma el paquete diario con los videos nuevos. La instala el director (pide permiso de Windows una vez).
if (args.includes('--instalar')) {
    const tarea = 'DC Tecnology - videos de diciembre';
    const node = process.execPath, raiz = RAIZ.replace(/'/g, "''");
    const cmd = `cd /d "${RAIZ}" && "${node}" --use-system-ca herramientas\videos-diciembre.mjs --variante todo >> herramientas\salida\videos-diario.log 2>&1 && "${node}" --use-system-ca herramientas\paquete-diario.mjs >> herramientas\salida\videos-diario.log 2>&1`;
    const ps = `$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c ${cmd.replace(/'/g, "''")}' -WorkingDirectory '${raiz}';
$t = New-ScheduledTaskTrigger -Daily -At '03:30';
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3);
Register-ScheduledTask -TaskName '${tarea}' -Action $a -Trigger $t -Settings $s -Description 'Genera cada madrugada los videos de diciembre que faltan (voz verificada) y rearma el paquete diario. DC Tecnology.' -Force | Out-Null`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
    console.log(`Tarea "${tarea}" instalada: todos los días a las 3:30 a. m. (registro: herramientas/salida/videos-diario.log).`);
    process.exit(0);
}

/* ---------- Datos (los mismos de las imágenes) ---------- */
const salida = execFileSync(process.execPath, ['--use-system-ca', path.join(RAIZ, 'herramientas', 'publicidad-diciembre.mjs'), '--json', '--forzar-precios'], { encoding: 'utf8', maxBuffer: 64 << 20 });
const datos = JSON.parse(salida.split('@@DATOS@@')[1]);
for (const l of salida.split('@@DATOS@@')[0].split('\n')) if (l.trim()) console.log(l);

/* ---------- Un formato por producto: variados y nunca dos iguales seguidos ---------- */
const PREFERIDOS = {
    tecnologia: ['regalo', 'vitrina', 'adviento', 'tarjeta'],
    streaming: ['trailer', 'ritmo', 'ticket', 'trailer'],
    licencias: ['ritmo', 'tarjeta', 'vitrina'],
    pines: ['tarjeta', 'adviento', 'ticket', 'regalo'],
    servicios: ['ritmo', 'vitrina'],
};
const MUSICA = { regalo: 'campanas', vitrina: 'campanas', adviento: 'campanas', tarjeta: 'campanas', ticket: 'campanas', trailer: 'cine', ritmo: 'ritmo', todos: 'ritmo' };
const NOMBRE = { regalo: 'Regalo sorpresa', trailer: 'Tráiler de cine', ritmo: 'Ritmo (tipografía al beat)', adviento: 'Calendario de adviento', vitrina: 'Vitrina giratoria', tarjeta: 'Tarjeta navideña', ticket: 'Lista de regalos', todos: 'Resumen del catálogo', presenta: 'Presentación (lanzamiento)' };
const usos = {};
let anterior = null;
for (const x of datos) {
    const opciones = (PREFERIDOS[x.tipo] ?? PREFERIDOS.streaming).filter((f) => f !== anterior);
    // el ticket luce con 3 o más planes; el tráiler, con las plataformas de video
    const puntaje = (f) => (usos[f] ?? 0) - (f === 'ticket' && x.planes.length >= 3 ? 2 : 0) + (f === 'ticket' && x.planes.length < 2 ? 5 : 0);
    x.formato = opciones.sort((a, b) => puntaje(a) - puntaje(b))[0];
    usos[x.formato] = (usos[x.formato] ?? 0) + 1;
    anterior = x.formato;
}
const LOGO = `data:image/png;base64,${fs.readFileSync(path.join(RAIZ, 'img', 'logo-dc-192.png')).toString('base64')}`;
const resumen = { id: 'todos', n: '00', archivo: '00-todo-el-catalogo-de-navidad', formato: 'todos', nombre: 'Todo el catálogo', tema: 'Navidad', t: '', s: '', b: [], planes: [], estilo: datos[0].estilo,
    todos: datos.map((x) => ({ id: x.id, nombre: x.nombre, imagen: x.imagen, estilo: x.estilo, planes: x.planes })) };
// Versión 2 de cada producto (para publicar 2 videos diarios sin repetir): OTRO formato, otro estilo y titular con el
// precio vigente («Maratón navideña por $17.000»). Archivo «NN-producto-v2.mp4».
const TODOS_F = ['regalo', 'trailer', 'ritmo', 'adviento', 'vitrina', 'tarjeta', 'ticket'];
const usos2 = {};
let anterior2 = null;
const cop = (v) => `$${Number(v).toLocaleString('es-CO')}`;
const v2 = datos.map((x, i) => {
    const puntaje = (f) => (usos2[f] ?? 0) + (f === 'ticket' && x.planes.length < 2 ? 9 : 0) + (f === 'trailer' && x.tipo === 'tecnologia' ? 3 : 0);
    const formato = TODOS_F.filter((f) => f !== x.formato && f !== anterior2).sort((a, b) => puntaje(a) - puntaje(b) || TODOS_F.indexOf(a) - TODOS_F.indexOf(b))[0];
    usos2[formato] = (usos2[formato] ?? 0) + 1; anterior2 = formato;
    const desde = Math.min(...x.planes.map((v) => v.precio));
    return { ...x, id: `${x.id}--v2`, archivo: `${x.archivo}-v2`, formato, version: 2, estilo: datos[(i + 6) % datos.length].estilo,
        t: x.id === 'servicio-reparacion-repuestos' ? `Revisión de tu PC por <em>${cop(desde)}</em>` : `${x.tema} ${x.planes.length > 1 ? 'desde' : 'por'} <em>${cop(desde)}</em>` };
});
const VARIANTE = args.includes('--variante') ? args[args.indexOf('--variante') + 1] : 'ambas';
// Lanzamiento (pedido del director el 24/11/2026): expectativa «Faltan 2 días» y «Falta 1 día», y el día del lanzamiento
// la bienvenida, «Lo que vas a encontrar» y «Así de fácil compras». Precios «desde» reales de cada categoría.
export const LANZAMIENTO = { fecha: '2026-11-27', texto: '27 de noviembre' };
const CARPETA_L = path.join(DESTINO, 'Lanzamiento 1080x1920');
const estiloDe = (id) => datos.find((x) => x.estilo.id === id)?.estilo ?? datos[0].estilo;
const deTipo = (t) => datos.filter((x) => x.tipo === t);
const minimo = (l) => cop(Math.min(...l.flatMap((x) => x.planes.map((v) => v.precio))));
const imgs = (ids) => ids.map((i) => datos.find((x) => x.id === i)?.imagen).filter(Boolean);
const base = { formato: 'presenta', t: '', s: '', b: [], planes: [], nombre: 'Lanzamiento', tema: 'Lanzamiento', carpeta: CARPETA_L };
const lanzamiento = [
    // Expectativa (24/11/2026): intriga en los estados del 25 y 26/11 → «Cargando…» hasta el 100 % del lanzamiento
    { ...base, id: 'T6', n: 'T6', archivo: 'T6-cargando-60', estilo: estiloDe('medianoche'), musica: 'cine', diapos: [
        { tipo: 'frase', texto: 'Algo <em>nuevo</em><br>se está cargando', dur: 2.8, voz: 'Algo nuevo se está cargando.' },
        { tipo: 'carga', etiqueta: 'Cargando', desde: 0, hasta: 60, texto: 'La nueva era de<br><em>DC Tecnology</em>', dur: 4.2, voz: 'La nueva era de DC Tecnology va en 60 %.' },
        { tipo: 'frase', texto: '<em>Próximamente</em>', sub: 'Entérate antes que nadie', dur: 2.8, voz: 'Próximamente. Entérate antes que nadie.' }] },
    { ...base, id: 'T1', n: 'T1', archivo: 'T1-nueva-forma-de-pedir', estilo: estiloDe('gamer'), musica: 'cine', diapos: [
        { tipo: 'frase', texto: 'Viene una <em>nueva forma</em><br>de hacer tus pedidos', dur: 3.2, voz: 'Viene una nueva forma de hacer tus pedidos.' },
        { tipo: 'frase', texto: 'Por <em>WhatsApp</em>', sub: 'Más fácil. Más rápido.', dur: 2.8, voz: 'Por WhatsApp. Más fácil y más rápido.' },
        { tipo: 'logo', sub: 'Próximamente · entérate', dur: 3, voz: 'Próximamente en DC Tecnology. Entérate.' }] },
    { ...base, id: 'T3', n: 'T3', archivo: 'T3-imaginate-comprar-asi', estilo: estiloDe('pino'), musica: 'cine', diapos: [
        { tipo: 'frase', texto: '<em>Imagínate</em>…', dur: 2.2, voz: 'Imagínate...' },
        { tipo: 'frase', texto: 'Pedir tu plataforma<br><em>desde tu celular</em>', dur: 2.8, voz: 'Pedir tu plataforma favorita desde tu celular,' },
        { tipo: 'frase', texto: 'Pagar <em>desde tu app</em>', sub: 'Nequi · Daviplata · Llave Bre-B', dur: 2.8, voz: 'pagar desde tu app,' },
        { tipo: 'frase', texto: 'Y recibirla<br><em>en tu WhatsApp</em>', dur: 2.8, voz: 'y recibirla en tu WhatsApp.' },
        { tipo: 'logo', sub: 'Muy pronto', dur: 3, voz: 'Muy pronto, en DC Tecnology.' }] },
    { ...base, id: 'T2', n: 'T2', archivo: 'T2-hemos-trabajado-para-ti', estilo: estiloDe('rojo'), musica: 'cine', diapos: [
        { tipo: 'frase', texto: 'Hemos trabajado<br>para la <em>comodidad</em><br>de tus pedidos', dur: 3.4, voz: 'Hemos trabajado para la comodidad de tus pedidos.' },
        { tipo: 'frase', texto: 'Elige · Paga · <em>Recibe</em>', sub: 'Todo desde tu celular', dur: 3, voz: 'Elige, paga y recibe, todo desde tu celular.' },
        { tipo: 'logo', sub: 'Muy pronto', dur: 3, voz: 'Muy pronto, DC Tecnology.' }] },
    { ...base, id: 'T7', n: 'T7', archivo: 'T7-cargando-80', estilo: estiloDe('medianoche'), musica: 'cine', diapos: [
        { tipo: 'carga', etiqueta: 'Cargando', desde: 60, hasta: 80, texto: 'La nueva era de<br><em>DC Tecnology</em>', dur: 4.2, voz: 'Ya vamos en 80 %.' },
        { tipo: 'frase', texto: 'Falta <em>muy poco</em>', sub: 'Guarda nuestro número: 322 328 4622', dur: 3, voz: 'Falta muy poco. Guarda nuestro número: 322 328 4622.' }] },
    { ...base, id: 'T4', n: 'T4', archivo: 'T4-imaginate-todo-en-un-lugar', estilo: estiloDe('fiesta'), musica: 'ritmo', diapos: [
        { tipo: 'frase', texto: '<em>Imagínate</em> tenerlo<br>todo en un solo lugar', dur: 3, voz: 'Imagínate tenerlo todo en un solo lugar.' },
        { tipo: 'categoria', etiqueta: 'Series y música', titulo: 'Tus <em>plataformas</em>', imagenes: imgs(['netflix', 'disney-plus', 'spotify-premium']), precio: 'En un solo pedido', dur: 3, voz: 'Tus series y tu música,' },
        { tipo: 'categoria', etiqueta: 'Regalos', titulo: 'Pines y <em>tecnología</em>', imagenes: imgs(['pin-virtual-roblox', 'reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable', 'diademas-gamer-a3s-alambrico']), precio: 'Y servicio técnico', dur: 3, voz: 'tus pines, tu tecnología y tu servicio técnico.' },
        { tipo: 'logo', sub: 'Muy pronto', dur: 3, voz: 'Muy pronto, todo en DC Tecnology.' }] },
    { ...base, id: 'T5', n: 'T5', archivo: 'T5-imaginate-automatizar', estilo: estiloDe('bosque'), musica: 'ritmo', diapos: [
        { tipo: 'frase', texto: '<em>Imagínate</em> automatizar<br>tu negocio', dur: 3, voz: 'Imagínate automatizar tu negocio.' },
        { tipo: 'pasos', titulo: 'Sin <em>enredos</em>', pasos: [['🤖', 'Catálogo con bot', 'Tus clientes piden por WhatsApp'], ['📦', 'Inventario', 'Sabes qué tienes y qué se vende'], ['📊', 'Tableros', 'Tus números claros']], dur: 5.4, voz: 'Un catálogo con bot que recibe pedidos por WhatsApp, tu inventario al día y tus números claros.' },
        { tipo: 'frase', texto: 'Eso también<br><em>lo hacemos</em>', sub: 'Pide tu cotización', dur: 2.8, voz: 'Eso también lo hacemos. Pide tu cotización.' },
        { tipo: 'logo', sub: 'Muy pronto', dur: 3, voz: 'Muy pronto, DC Tecnology.' }] },
    { ...base, id: 'T8', n: 'T8', archivo: 'T8-cargando-99', estilo: estiloDe('medianoche'), musica: 'cine', diapos: [
        { tipo: 'carga', etiqueta: 'Casi listo', desde: 80, hasta: 99, texto: 'La nueva era de<br><em>DC Tecnology</em>', dur: 4.4, voz: 'Ya vamos en 99 %.' },
        { tipo: 'logo', sub: `Mañana, ${LANZAMIENTO.texto}`, dur: 3.2, voz: `Mañana, ${LANZAMIENTO.texto}, llega la nueva era de DC Tecnology.` }] },
    { ...base, id: 'L1', n: 'L1', archivo: 'L1-faltan-2-dias', estilo: estiloDe('medianoche'), musica: 'cine', diapos: [
        { tipo: 'frase', texto: 'Estuvimos trabajando<br>en algo <em>grande</em>', dur: 3, voz: 'Estuvimos trabajando en algo grande.' },
        { tipo: 'cuenta', etiqueta: 'Muy pronto', grande: '2', linea: 'días', sub: 'para la nueva era de DC Tecnology', dur: 3.6, voz: 'Faltan dos días para la nueva era de DC Tecnology.' },
        { tipo: 'frase', texto: 'Tecnología, plataformas<br>y <em>mucho más</em>', sub: 'Todo desde tu celular', dur: 3, voz: 'Tecnología, plataformas y mucho más, todo desde tu celular.' },
        { tipo: 'logo', sub: `Llega el ${LANZAMIENTO.texto}`, dur: 3.2, voz: `Llega el ${LANZAMIENTO.texto}.` }] },
    { ...base, id: 'L2', n: 'L2', archivo: 'L2-falta-1-dia', estilo: estiloDe('gamer'), musica: 'cine', diapos: [
        { tipo: 'frase', texto: 'Mañana<br><em>todo cambia</em>', dur: 2.8, voz: 'Mañana todo cambia.' },
        { tipo: 'cuenta', etiqueta: 'Últimas horas', grande: '1', linea: 'día', sub: 'para la nueva era de DC Tecnology', dur: 3.6, voz: 'Falta un día para la nueva era de DC Tecnology.' },
        { tipo: 'frase', texto: 'Guarda nuestro <em>número</em>', sub: 'WhatsApp 322 328 4622', dur: 3, voz: 'Guarda nuestro WhatsApp: 322 328 4622.' },
        { tipo: 'logo', sub: `Mañana, ${LANZAMIENTO.texto}`, dur: 3.2, voz: `Nos vemos mañana, ${LANZAMIENTO.texto}.` }] },
    { ...base, id: 'L3', n: 'L3', archivo: 'L3-bienvenida-nueva-era', estilo: estiloDe('pino'), musica: 'cine', diapos: [
        { tipo: 'frase', texto: 'Estuvimos trabajando<br>para <em>ti</em>', dur: 2.8, voz: 'Estuvimos trabajando para ti.' },
        { tipo: 'frase', texto: 'Para darte un servicio<br><em>más rápido y mejor</em>', dur: 3, voz: 'Para darte un servicio más rápido y mejor.' },
        { tipo: 'logo', sub: 'Bienvenido a la nueva era digital', dur: 3.4, voz: 'Bienvenido a la nueva era digital de DC Tecnology.' },
        { tipo: 'frase', texto: 'Tecnología · Plataformas<br>Pines · <em>Servicio técnico</em>', sub: 'Todo en un solo lugar', dur: 3.4, voz: 'Tecnología, plataformas, pines y servicio técnico, todo en un solo lugar.' },
        { tipo: 'cta', texto: 'Escríbenos <em>hoy</em>', dur: 3, voz: 'Escríbenos hoy por WhatsApp.' }] },
    { ...base, id: 'L4', n: 'L4', archivo: 'L4-lo-que-vas-a-encontrar', estilo: estiloDe('rojo'), musica: 'ritmo', diapos: [
        { tipo: 'frase', texto: 'Esto es lo que vas<br>a <em>encontrar</em>', dur: 2.4, voz: 'Esto es lo que vas a encontrar.' },
        { tipo: 'categoria', etiqueta: 'Tecnología', titulo: 'Relojes y <em>audífonos</em>', imagenes: imgs(['reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable', 'diademas-gamer-a3s-alambrico', 'auriculares-inalambricos-m25-con-powerbank']), precio: `Desde ${minimo(deTipo('tecnologia'))}`, sub: 'Envíos a todo el país', dur: 3.4, voz: `Relojes y audífonos desde ${minimo(deTipo('tecnologia'))}, con envíos a todo el país.` },
        { tipo: 'categoria', etiqueta: 'Plataformas', titulo: 'Tus series y <em>películas</em>', imagenes: imgs(['disney-plus', 'netflix', 'hbo-max']), precio: `Desde ${minimo(deTipo('streaming'))}`, sub: 'Llega por WhatsApp al validar tu pago', dur: 3.4, voz: `Tus series y películas desde ${minimo(deTipo('streaming'))}; llegan por WhatsApp.` },
        { tipo: 'categoria', etiqueta: 'Pines', titulo: 'Regalos <em>digitales</em>', imagenes: imgs(['pin-virtual-netflix', 'pin-virtual-roblox', 'pin-virtual-vix']), precio: `Desde ${minimo(deTipo('pines'))}`, sub: 'Sin tarjeta de crédito', dur: 3.4, voz: `Regalos digitales en pines desde ${minimo(deTipo('pines'))}, sin tarjeta de crédito.` },
        { tipo: 'categoria', etiqueta: 'Licencias', titulo: 'Para estudiar y <em>trabajar</em>', imagenes: imgs(['canva-pro', 'duolingo-super', 'mcafee-antivirus']), precio: `Desde ${minimo(deTipo('licencias'))}`, dur: 3.4, voz: `Licencias para estudiar y trabajar desde ${minimo(deTipo('licencias'))}.` },
        { tipo: 'categoria', etiqueta: 'Servicio técnico', titulo: 'Tu PC como <em>nuevo</em>', imagenes: imgs(['servicio-mantenimiento-computadores', 'servicio-reparacion-repuestos']), precio: `Revisión ${minimo(datos.filter((x) => x.id === 'servicio-reparacion-repuestos'))}`, sub: `Mantenimiento desde ${minimo(datos.filter((x) => x.id === 'servicio-mantenimiento-computadores'))}`, dur: 3.4, voz: `Y servicio técnico: revisión de tu PC por ${minimo(datos.filter((x) => x.id === 'servicio-reparacion-repuestos'))}.` },
        { tipo: 'cta', texto: 'Pídelo <em>hoy</em>', dur: 2.8, voz: 'Pídelo hoy en DC Tecnology.' }] },
    { ...base, id: 'L5', n: 'L5', archivo: 'L5-asi-de-facil-compras', estilo: estiloDe('fiesta'), musica: 'campanas', diapos: [
        { tipo: 'frase', texto: 'Comprar es<br><em>así de fácil</em>', dur: 2.6, voz: 'Comprar es así de fácil.' },
        { tipo: 'pasos', titulo: 'En <em>3 pasos</em>', pasos: [['1', 'Elige', 'En dctecnology.xyz o por WhatsApp'], ['2', 'Paga desde tu app', 'Nequi, Daviplata o Llave Bre-B'], ['3', 'Recíbelo', 'Lo digital por WhatsApp; la tecnología con envío a todo el país']], dur: 6, voz: 'Elige en la página o por WhatsApp. Paga desde tu app con Nequi, Daviplata o Llave Bre-B. Y recíbelo: lo digital por WhatsApp, y la tecnología con envío a todo el país.' },
        { tipo: 'frase', texto: 'Te atendemos<br><em>por WhatsApp</em>', sub: 'Pregunta lo que quieras', dur: 2.8, voz: 'Te atendemos por WhatsApp. Pregunta lo que quieras.' },
        { tipo: 'cta', texto: 'Escríbenos <em>ya</em>', dur: 3, voz: 'Escríbenos ya.' }] },
];
// Orden de urgencia = orden del calendario (paquete-diario.mjs): lanzamiento, y desde el 28/11 el video de las 12:30
// (v1) y el de las 19:30 (v2) de cada día; al final lo que no está en el calendario.
const ordenCal = (() => {
    const grupos = ['tecnologia', 'streaming', 'pines', 'licencias', 'servicios'].map((t) => datos.filter((x) => x.tipo === t));
    const orden = []; for (let i = 0; orden.length < datos.length; i++) for (const g of grupos) if (g[i]) orden.push(g[i]);
    const N = orden.length, lista = [];
    for (let i = 0; i < 34; i++) { lista.push(i === 0 ? resumen : orden[i % N]); lista.push(v2.find((y) => y.id === `${orden[(i + 13) % N].id}--v2`)); }
    for (const y of [resumen, ...datos, ...v2]) if (!lista.includes(y)) lista.push(y);
    return lista;
})();
// Festividades y ofertas de diciembre (pedido del director el 24/11/2026). La oferta es REAL: el cupón de primera compra
// se consulta en la base (validar_cupon) y, si ya no está vigente, ese video no se hace. Precios «desde» reales.
const CARPETA_F = path.join(DESTINO, 'Festividades 1080x1920');
let cupon = null;
try {
    const r = await fetch('https://vyqcizwfmjlflncdwzve.supabase.co/rest/v1/rpc/validar_cupon', { method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { apikey: 'sb_publishable_GvQiv6M7iSrlwsA90lXsOQ_5OfSYBwy', 'Content-Type': 'application/json' }, body: JSON.stringify({ p_codigo: 'DCTECH2026' }) });
    const c = (await r.json())?.[0]; if (c?.valido && c.porcentaje > 0) cupon = { codigo: 'DCTECH2026', porcentaje: c.porcentaje };
} catch { /* sin base: no se hace el video de oferta */ }
const baratos = datos.filter((x) => Math.min(...x.planes.map((v) => v.precio)) < 20000);
const bf = { ...base, carpeta: CARPETA_F, tema: 'Festividades' };
const festivos = [
    ...(cupon ? [{ ...bf, id: 'F1', n: 'F1', archivo: 'F1-oferta-primera-compra', estilo: estiloDe('rojo'), musica: 'ritmo', diapos: [
        { tipo: 'frase', texto: '¿Es tu <em>primera compra</em>?', dur: 2.6, voz: '¿Es tu primera compra en DC Tecnology?' },
        { tipo: 'cuenta', etiqueta: 'Código ' + cupon.codigo, grande: cupon.porcentaje + '%', linea: 'de descuento', sub: 'en tu primera compra', dur: 3.6, voz: `Tienes ${cupon.porcentaje} por ciento de descuento con el código D C T E C H 2026.` },
        { tipo: 'categoria', etiqueta: 'Úsalo en', titulo: 'Plataformas, pines y <em>tecnología</em>', imagenes: imgs(['netflix', 'reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable', 'pin-virtual-roblox']), precio: `Desde ${minimo(datos)}`, sub: 'Escribe el código al pagar', dur: 3.6, voz: 'Úsalo en plataformas, pines y tecnología. Escribe el código al pagar.' },
        { tipo: 'cta', texto: 'Estrénate con <em>DC Tecnology</em>', dur: 3, voz: 'Estrénate hoy con DC Tecnology.' }] }] : []),
    { ...bf, id: 'F2', n: 'F2', archivo: 'F2-noche-de-velitas', estilo: estiloDe('velitas'), musica: 'campanas', diapos: [
        { tipo: 'frase', texto: 'Noche de <em>velitas</em>', sub: '7 de diciembre', dur: 2.8, voz: 'Llegó la noche de velitas.' },
        { tipo: 'frase', texto: 'Ilumina a los tuyos<br>con un <em>regalo</em>', dur: 3, voz: 'Ilumina a los tuyos con un regalo.' },
        { tipo: 'categoria', etiqueta: 'Para brillar', titulo: 'Audífonos y <em>relojes</em>', imagenes: imgs(['diademas-inalambricas-cr-8-con-luces-r9s7x', 'reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable', 'auriculares-inalambricos-m25-con-powerbank']), precio: `Desde ${minimo(deTipo('tecnologia'))}`, sub: 'Envíos a todo el país', dur: 3.6, voz: `Audífonos y relojes desde ${minimo(deTipo('tecnologia'))}, con envíos a todo el país.` },
        { tipo: 'cta', texto: 'Feliz noche de <em>velitas</em>', dur: 3, voz: 'Feliz noche de velitas, de parte de DC Tecnology.' }] },
    { ...bf, id: 'F3', n: 'F3', archivo: 'F3-amigo-secreto', estilo: estiloDe('fiesta'), musica: 'ritmo', diapos: [
        { tipo: 'frase', texto: '¿Te tocó el<br><em>amigo secreto</em>?', dur: 2.8, voz: '¿Te tocó el amigo secreto?' },
        { tipo: 'categoria', etiqueta: 'Menos de $20.000', titulo: 'Regalos que <em>sí usan</em>', imagenes: baratos.slice(0, 3).map((x) => x.imagen), precio: `Desde ${minimo(baratos)}`, sub: 'Llegan por WhatsApp al validar tu pago', dur: 3.8, voz: `Tenemos regalos desde ${minimo(baratos)}, y llegan por WhatsApp.` },
        { tipo: 'frase', texto: 'Sin filas y <em>sin envíos</em>', sub: 'Lo digital llega a tu celular', dur: 3, voz: 'Sin filas y sin esperar envíos.' },
        { tipo: 'cta', texto: 'Resuelto en <em>un minuto</em>', dur: 3, voz: 'Amigo secreto resuelto con DC Tecnology.' }] },
    { ...bf, id: 'F4', n: 'F4', archivo: 'F4-llego-la-prima', estilo: estiloDe('dorado'), musica: 'ritmo', diapos: [
        { tipo: 'frase', texto: '¡Llegó la <em>prima</em>!', dur: 2.6, voz: '¡Llegó la prima!' },
        { tipo: 'frase', texto: 'Date el gusto<br>que te <em>mereces</em>', dur: 2.8, voz: 'Date el gusto que te mereces.' },
        { tipo: 'categoria', etiqueta: 'Tecnología', titulo: 'Relojes <em>inteligentes</em>', imagenes: imgs(['reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable', 'reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable', 'reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados']), precio: `Desde ${minimo(datos.filter((x) => /smartwatch/.test(x.id)))}`, sub: 'Envíos a todo el país', dur: 3.6, voz: `Relojes inteligentes desde ${minimo(datos.filter((x) => /smartwatch/.test(x.id)))}.` },
        { tipo: 'categoria', etiqueta: 'Combo', titulo: 'Todas tus <em>plataformas</em>', imagenes: imgs(['netflix', 'disney-plus', 'hbo-max']), precio: `Desde ${minimo(datos.filter((x) => x.id === 'combo-3-o-4-plataformas'))}`, sub: 'Combo de 3 o 4 plataformas', dur: 3.6, voz: `O el combo de tres o cuatro plataformas desde ${minimo(datos.filter((x) => x.id === 'combo-3-o-4-plataformas'))}.` },
        { tipo: 'cta', texto: 'Pídelo <em>hoy</em>', dur: 2.8, voz: 'Pídelo hoy en DC Tecnology.' }] },
    { ...bf, id: 'F5', n: 'F5', archivo: 'F5-empieza-la-novena', estilo: estiloDe('pino'), musica: 'campanas', diapos: [
        { tipo: 'frase', texto: 'Empieza la <em>novena</em>', sub: '16 de diciembre', dur: 2.8, voz: 'Empieza la novena de aguinaldos.' },
        { tipo: 'frase', texto: 'Nueve días para<br><em>regalar</em>', dur: 2.8, voz: 'Nueve días para regalar.' },
        { tipo: 'categoria', etiqueta: 'Aguinaldo digital', titulo: 'Pines para <em>regalar</em>', imagenes: imgs(['pin-virtual-netflix', 'pin-virtual-disney-plus-1tpu5', 'pin-virtual-roblox']), precio: `Desde ${minimo(deTipo('pines'))}`, sub: 'Sin tarjeta de crédito', dur: 3.6, voz: `Pines para regalar desde ${minimo(deTipo('pines'))}, sin tarjeta de crédito.` },
        { tipo: 'cta', texto: 'Feliz <em>novena</em>', dur: 3, voz: 'Feliz novena, de parte de DC Tecnology.' }] },
    { ...bf, id: 'F6', n: 'F6', archivo: 'F6-nochebuena', estilo: estiloDe('medianoche'), musica: 'campanas', diapos: [
        { tipo: 'frase', texto: '¿Te faltó<br>un <em>regalo</em>?', sub: 'Nochebuena', dur: 2.8, voz: '¿Te faltó un regalo para esta Nochebuena?' },
        { tipo: 'frase', texto: 'Lo digital llega<br><em>por WhatsApp</em>', sub: 'Al validar tu pago', dur: 3, voz: 'Lo digital llega por WhatsApp al validar tu pago.' },
        { tipo: 'categoria', etiqueta: 'Para hoy', titulo: 'Plataformas y <em>pines</em>', imagenes: imgs(['disney-plus', 'pin-virtual-netflix', 'spotify-premium']), precio: `Desde ${minimo([...deTipo('streaming'), ...deTipo('pines')])}`, dur: 3.6, voz: `Plataformas y pines desde ${minimo([...deTipo('streaming'), ...deTipo('pines')])}.` },
        { tipo: 'cta', texto: 'Feliz <em>Nochebuena</em>', dur: 3, voz: 'Feliz Nochebuena, de parte de DC Tecnology.' }] },
    { ...bf, id: 'F7', n: 'F7', archivo: 'F7-feliz-navidad', estilo: estiloDe('rojo'), musica: 'campanas', diapos: [
        { tipo: 'logo', sub: '¡Feliz Navidad!', dur: 3.2, voz: '¡Feliz Navidad!' },
        { tipo: 'frase', texto: 'Gracias por <em>confiar</em><br>en nosotros', dur: 3, voz: 'Gracias por confiar en DC Tecnology este año.' },
        { tipo: 'frase', texto: 'Hoy es día de<br><em>películas en familia</em>', sub: 'Tu pantalla llega por WhatsApp', dur: 3.2, voz: 'Hoy es día de películas en familia, y tu pantalla llega por WhatsApp.' },
        { tipo: 'cta', texto: 'Feliz <em>Navidad</em>', dur: 3, voz: 'Feliz Navidad.' }] },
    { ...bf, id: 'F8', n: 'F8', archivo: 'F8-feliz-2027', estilo: estiloDe('fiesta'), musica: 'ritmo', diapos: [
        { tipo: 'cuenta', etiqueta: 'Fin de año', grande: '2027', linea: 'llega ya', dur: 3.2, voz: 'El 2027 ya llega.' },
        { tipo: 'categoria', etiqueta: 'Propósitos', titulo: 'Arranca el año <em>con todo</em>', imagenes: imgs(['duolingo-super', 'canva-pro', 'mcafee-antivirus']), precio: `Desde ${minimo(deTipo('licencias'))}`, sub: 'Inglés, diseño y seguridad', dur: 3.8, voz: `Arranca el año con todo: inglés, diseño y seguridad desde ${minimo(deTipo('licencias'))}.` },
        { tipo: 'logo', sub: '¡Feliz año nuevo!', dur: 3.2, voz: '¡Feliz año nuevo, de parte de DC Tecnology!' }] },
];
const candidatos = VARIANTE === 'todo' ? [...lanzamiento, ...festivos, ...ordenCal] : VARIANTE === 'festivos' ? festivos : VARIANTE === 'lanzamiento' ? lanzamiento : VARIANTE === '1' ? [resumen, ...datos] : VARIANTE === '2' ? v2 : [resumen, ...datos, ...v2];
const videos = candidatos.filter((x) => !SOLO || SOLO.split(',').some((s) => x.n === s || x.id === s || `${x.n}b` === s));
if (args.includes('--formatos')) {
    for (const x of [resumen, ...datos]) console.log(`  ${x.n} · ${NOMBRE[x.formato].padEnd(26)} · ${x.nombre}`); console.log(usos);
    for (const x of v2) console.log(`  ${x.n}b · ${NOMBRE[x.formato].padEnd(26)} · ${x.t.replace(/<\/?em>/g, '')}`); console.log(usos2);
    process.exit(0);
}
// Candado de precios (24/11/2026): la base debe cobrar al menos el precio con margen de productos.json
const productosJson = JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8'));
const preciosViejos = datos.filter((x) => x.tipo !== 'servicios').flatMap((x) => x.planes.filter((v) => { const pj = productosJson.find((p) => p.id === x.id)?.variantes.find((y) => (x.g?.plan ?? ((n) => n))(y.nombre) === v.nombre || y.nombre === v.nombre); return pj && v.precio < Number(pj.precio); }).map((v) => `${x.nombre} · ${v.nombre}`));
const muestraPrecio = (x) => x.formato !== 'presenta' || /\$\s?\d/.test(JSON.stringify(x.diapos ?? []));
if (preciosViejos.length && !args.includes('--forzar-precios') && !args.includes('--formatos')) {
    const antes = videos.length;
    for (let k = videos.length - 1; k >= 0; k--) if (muestraPrecio(videos[k])) videos.splice(k, 1);
    console.log(`⛔ La base todavía cobra ${preciosViejos.length} precios sin el margen nuevo: solo se hacen los videos SIN precios (${videos.length} de ${antes}). Aplica wo-059 y vuelve a correr para el resto.`);
}
if (!videos.length) { console.log(SOLO ? `No hay pieza «${SOLO}».` : 'Nada que generar por ahora.'); process.exit(SOLO ? 1 : 0); }

/* ---------- Guion hablado: gancho, beneficio, precio y cierre (datos reales; el precio, el vigente) ---------- */
function guion(x) {
    if (x.formato === 'presenta') return x.diapos.map((d, k) => ({ ancla: `d${k}`, texto: d.voz })).filter((g) => g.texto);
    if (x.formato === 'todos') return [{ ancla: 'gancho', texto: 'Todo para esta Navidad en DC Tecnology.' },
        { ancla: 'beneficios', texto: `${datos.length} regalos entre tecnología, plataformas, pines y servicio técnico.` },
        { ancla: 'cta', texto: 'Tu regalo de Navidad está aquí. Escríbenos por WhatsApp y te ayudamos a elegir.' }];
    const t = x.t.replace(/<\/?em>/g, '').trim();
    const min = Math.min(...x.planes.map((v) => v.precio));
    const precio = x.planes.length === 1 ? `${x.planes[0].nombre} por ${cop(x.planes[0].precio)}.` : `Desde ${cop(min)}.`;
    const quedan = x.quedan && x.quedan <= 5 && x.tipo === 'tecnologia' ? ` ¡Solo quedan ${x.quedan}!` : '';
    const cta = x.tipo === 'tecnologia' ? 'Envíos a todo el país. Pídelo ya en DC Tecnology.' : x.tipo === 'servicios' ? 'Agenda por WhatsApp con DC Tecnology.' : 'Llega por WhatsApp al validar tu pago. Pídelo ya en DC Tecnology.';
    return [{ ancla: 'gancho', texto: /[.!?]$/.test(t) ? t : `${t}.` }, { ancla: 'beneficios', texto: x.s }, { ancla: 'precio', texto: precio + quedan }, { ancla: 'cta', texto: cta }];
}

// Corta la grabación en frases por los silencios naturales (el más cercano a la proporción de cada texto). null = no se pudo.
function partir(pcm, textos) {
    if (textos.length === 1) return [pcm];
    const V = Math.round(SR_VOZ * 0.02), cuadrosV = Math.floor(pcm.length / V), act = [];
    for (let i = 0; i < cuadrosV; i++) { let m = 0; for (let k = i * V; k < (i + 1) * V; k++) m = Math.max(m, Math.abs(pcm[k])); act.push(m > 600); }
    const huecos = []; for (let i = 0; i < cuadrosV;) { if (!act[i]) { let j = i; while (j < cuadrosV && !act[j]) j++; if (i > 0 && j < cuadrosV && j - i >= 7) huecos.push({ i, j, n: j - i }); i = j; } else i++; }
    if (huecos.length < textos.length - 1) return null;
    const total = textos.reduce((s, t) => s + t.length, 0); let acc = 0;
    const esperados = textos.slice(0, -1).map((t) => { acc += t.length; return (acc / total) * cuadrosV; });
    const cortes = []; let desde = 0;
    for (const e of esperados) {
        const cand = huecos.filter((h) => h.i > desde); if (!cand.length) return null;
        const h = cand.reduce((b, c) => { const p = Math.abs((c.i + c.j) / 2 - e) - c.n * 4; return !b || p < b.p ? { c, p } : b; }, null).c;
        cortes.push(Math.round((h.i + h.j) / 2) * V); desde = h.j;
    }
    const partes = []; let a = 0; for (const c of [...cortes, pcm.length]) { partes.push(pcm.slice(a, c)); a = c; }
    return partes.every((p) => p.length > SR_VOZ * 0.35) ? partes : null;
}
// Control de la voz: palabras completas, la marca bien dicha («DC», no «Dick»/«Dizzy») y cada precio dicho
function revisarVoz(guionTxt, dicho) {
    const q = parecido(guionTxt, dicho); const pct = Math.round(q.cubiertas * 100);
    if (q.cubiertas < 0.88) return { ok: false, pct, motivo: `faltan palabras (${pct} %: ${q.faltan.slice(0, 5).join(', ')})` };
    if (q.sobrantes >= 0.25) return { ok: false, pct, motivo: 'dijo palabras de más' };
    const marcas = guionTxt.match(/DC Tecnology/gi)?.length ?? 0;
    if (marcas && (/\b(dick|dicks|dizzy|disi|desi|deece|di si)\b/i.test(dicho) || (dicho.match(/\bD\.?\s?C\.?\s+Te[ck]h?n/gi)?.length ?? 0) < marcas)) return { ok: false, pct, motivo: 'la marca no se entendió como «DC Tecnology»' };
    const digitos = dicho.replace(/[.,\s$]/g, '');
    for (const p of guionTxt.match(/\$[\d.]+/g) ?? []) { const d = p.replace(/[$.]/g, ''); if (!digitos.includes(d)) return { ok: false, pct, motivo: `no se oyó el precio ${p}` }; }
    return { ok: true, pct };
}

/* ---------- Servidor local: páginas, cuadros y guardado ---------- */
const pagina = (x) => `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700;800&family=Outfit:wght@800;900&family=Caveat:wght@700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/herramientas/videos-diciembre.css"></head><body><div id="raiz"></div>
<script>window.D = ${JSON.stringify({ ...x, logo: LOGO }).replace(/</g, '\\u003c')};</script>
<script src="/herramientas/videos-diciembre-escena.js"></script></body></html>`;
const CODIFICAR = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.min.js"></script>
<script src="/herramientas/videos-diciembre-codificar.js"></script></body></html>`;
const TIPOS = { '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const servidor = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (u.startsWith('/v/')) { const x = videos.find((v) => v.id === u.slice(3)); res.writeHead(x ? 200 : 404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(x ? pagina(x) : ''); }
    if (u === '/codificar.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(CODIFICAR); }
    if (u.startsWith('/guardar/') && req.method === 'POST') {
        const x = videos.find((v) => v.id === u.slice(9)); const partes = [];
        req.on('data', (c) => partes.push(c)).on('end', () => { fs.mkdirSync(x.carpeta ?? CARPETA, { recursive: true }); fs.writeFileSync(path.join(x.carpeta ?? CARPETA, `${x.archivo}.mp4`), Buffer.concat(partes)); res.writeHead(200).end('ok'); });
        return;
    }
    const f = u.startsWith('/cuadros/') ? path.join(TMP, u.slice(9)) : u.startsWith('/voz/') ? path.join(TMP, 'voz', u.slice(5)) : path.join(RAIZ, u);
    if (!f.startsWith(u.startsWith('/cuadros/') || u.startsWith('/voz/') ? TMP : RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(f)] ?? 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${servidor.address().port}`;

/* ---------- Chrome sin ventana por CDP ---------- */
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(CARPETA, { recursive: true });
if (VISTAS) fs.mkdirSync(path.join(TMP, '..', 'diciembre-vistas'), { recursive: true });
const PUERTO = 9700 + Math.floor(Math.random() * 90);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${path.join(TMP, 'perfil')}`, 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let pestañas; for (let i = 0; i < 80; i++) { try { pestañas = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); if (pestañas.some((t) => t.type === 'page')) break; } catch {} await esperar(250); }
const ws = new WebSocket(pestañas.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0; const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.error ? { error: m.error } : m.result); pend.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const k = ++n; pend.set(k, r); ws.send(JSON.stringify({ id: k, method, params })); });
const evaluar = async (expression) => { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails || r.error) throw new Error(JSON.stringify(r.exceptionDetails?.exception?.description ?? r.error ?? r.exceptionDetails).slice(0, 400)); return r.result?.value; };
const ir = async (url) => { await cdp('Page.navigate', { url }); for (let i = 0; i < 100; i++) { await esperar(100); if ((await cdp('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true })).result?.value === 'complete') return; } };
await cdp('Page.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });

const problemas = [];
let cuotaAgotada = false;
let saltados = 0;
const hechos = [];
const t0 = Date.now();
try {
    for (const x of videos) {
        const ini = Date.now();
        if (!REHACER && REG[x.archivo] && fs.existsSync(path.join(x.carpeta ?? CARPETA, `${x.archivo}.mp4`))) { saltados++; continue; }
        await ir(`${BASE}/v/${encodeURIComponent(x.id)}`);
        const info = await evaluar('window.preparar()');
        if (info.fallas.length) problemas.push(`${x.archivo}: ${info.fallas.join(', ')}`);
        // Locución: cada frase arranca cuando aparece su parte; si no cabe, la animación ESPERA (nunca se corta la voz)
        let voces = [];
        try { if (!SIN_VOZ) {
            const g = guion(x).filter((p) => info.anclas[p.ancla] != null).sort((a, b) => info.anclas[a.ancla] - info.anclas[b.ancla]);
            const voz = x.voz ?? (x.formato === 'presenta' ? 'Charon' : VOCES[candidatos.indexOf(x) % VOCES.length]);
            const textoTodo = g.map((p) => p.texto).join(' ');
            // UNA grabación por video (cuida el cupo de Gemini) y se corta en frases por las pausas naturales
            let pcm = null, partes = null, aprobado = SIN_CONTROL;
            for (let intento = 0; intento < 2 && !aprobado; intento++) {
                pcm = (await hablar(textoTodo, { voz, estilo: intento ? 'r2' : undefined })).pcm;
                partes = partir(pcm, g.map((p) => p.texto));
                const dicho = await transcribir(wav(pcm)).catch((e) => { console.log(`    (control no disponible: ${e.message})`); return null; });
                if (dicho == null) { aprobado = true; break; }
                const q = revisarVoz(textoTodo, dicho);
                if (q.ok) { x.control = `voz verificada ${q.pct} %`; aprobado = true; break; }
                console.log(`    ⚠ ${x.n}: ${q.motivo} → se vuelve a grabar`);
                if (intento) { problemas.push(`${x.archivo}: ${q.motivo} (no se publica)`); }
            }
            if (!aprobado) { const viejo = path.join(x.carpeta ?? CARPETA, `${x.archivo}.mp4`); if (fs.existsSync(viejo)) fs.rmSync(viejo); console.log(`  ✖ ${x.n} · ${x.nombre}: la voz no pasó el control; se repite en la próxima corrida`); continue; }
            const segs = partes ? g.map((p, k) => ({ ...p, pcm: partes[k], seg: partes[k].length / SR_VOZ })) : [{ ...g[0], pcm, seg: pcm.length / SR_VOZ, sola: true }];
            const pausas = [];
            segs.forEach((p, k) => {
                const A = info.anclas[p.ancla]; const sig = k + 1 < segs.length ? info.anclas[segs[k + 1].ancla] : info.base;
                const cabe = sig - A - (k + 1 < segs.length ? 0.3 : 0.7);
                if (p.seg > cabe) pausas.push({ at: Math.max(A + 0.1, k + 1 < segs.length ? sig - 0.55 : info.base - 0.02), dur: Number((p.seg - cabe).toFixed(3)) });
            });
            const mover = (t) => t + pausas.filter((p) => p.at <= t).reduce((s, p) => s + p.dur, 0);
            info.dur = await evaluar(`window.pausar(${JSON.stringify(pausas)})`);
            fs.mkdirSync(path.join(TMP, 'voz'), { recursive: true });
            voces = segs.map((p, k) => { fs.writeFileSync(path.join(TMP, 'voz', `${x.id}-${k}.pcm`), Buffer.from(p.pcm.buffer, p.pcm.byteOffset, p.pcm.byteLength)); return { inicio: Number(mover(info.anclas[p.ancla]).toFixed(3)), url: `/voz/${encodeURIComponent(x.id)}-${k}.pcm` }; });
            info.eventos = info.eventos.map((e) => ({ ...e, t: mover(e.t) }));
            x.voz = voz;
        } } catch (e) {
            if (e.cuota) { console.log(`  ⏸ ${e.message}. Van ${hechos.length} videos en esta corrida; vuelve a correr mañana y sigue desde aquí.`); cuotaAgotada = true; break; }
            problemas.push(`${x.archivo}: sin voz (${e.message})`); console.log(`  ✖ ${x.n} · ${x.nombre}: sin voz (${e.message}); se repite después`); continue;
        }
        const cuadros = Math.round(info.dur * FPS);
        const dir = path.join(TMP, x.id); fs.mkdirSync(dir, { recursive: true });
        const vistas = new Set([0.35, 0.55, 0.75, 0.97].map((p) => Math.round(p * (cuadros - 1))));
        for (let i = 0; i < cuadros; i++) {
            await evaluar(`window.render(${i / FPS})`);
            const img = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 90, optimizeForSpeed: true });
            fs.writeFileSync(path.join(dir, `${i}.jpg`), Buffer.from(img.data, 'base64'));
            if (VISTAS && vistas.has(i)) fs.copyFileSync(path.join(dir, `${i}.jpg`), path.join(TMP, '..', 'diciembre-vistas', `${x.n}-${x.formato}-${i}.jpg`));
        }
        await ir(`${BASE}/codificar.html`);
        const r = await evaluar(`window.codificar(${JSON.stringify({ id: x.id, cuadros, fps: FPS, eventos: info.eventos, beat: info.beat, musica: x.musica ?? MUSICA[x.formato], voces })})`);
        fs.rmSync(dir, { recursive: true, force: true });
        if (!String(r).startsWith('ok')) { problemas.push(`${x.archivo}: ${r}`); continue; }
        const mb = (Number(String(r).split(' ')[1]) / 1048576).toFixed(1);
        hechos.push({ ...x, dur: info.dur });
        if (!SIN_VOZ) { REG[x.archivo] = { fecha: new Date().toISOString(), voz: x.voz, control: x.control ?? null, segundos: Number(info.dur.toFixed(1)) }; fs.mkdirSync(path.dirname(REGISTRO_VOZ), { recursive: true }); fs.writeFileSync(REGISTRO_VOZ, JSON.stringify(REG, null, 1) + '\n'); }
        console.log(`  ✔ ${x.n} · ${NOMBRE[x.formato].padEnd(26)} · ${info.dur.toFixed(1)} s · ${mb} MB · ${x.nombre}${x.voz ? ` · voz ${x.voz}${x.control ? ` (${x.control})` : ''}` : ''} (${((Date.now() - ini) / 1000).toFixed(0)} s)`);
    }
} finally { ws.close(); chrome.kill(); servidor.close(); await new Promise((r) => { chrome.once('exit', r); setTimeout(r, 5000); }); }

/* ---------- Textos para publicar ---------- */
if (!SOLO && !['lanzamiento', 'todo', 'festivos'].includes(VARIANTE)) {
    const porId = Object.fromEntries(datos.map((x) => [x.id, x]));
    fs.writeFileSync(path.join(DESTINO, 'VIDEOS.txt'), [
        'VIDEOS DE DICIEMBRE 2026 · DC Tecnology',
        'Verticales 1080×1920 (9:16) con música original: sirven para estados de WhatsApp, Reels de Instagram y Facebook, TikTok y YouTube Shorts.',
        'Consejo: en TikTok e Instagram puedes cambiar la música por una canción decembrina de la biblioteca de la app (eso ayuda al alcance).', '',
        '==== 00-todo-el-catalogo-de-navidad.mp4 · Resumen del catálogo ====',
        `🎄 Todo para esta Navidad en DC Tecnology: ${datos.length} regalos entre tecnología, plataformas, pines y servicios.`,
        '🛒 https://www.dctecnology.xyz', '💬 WhatsApp 322 328 4622', '#DCTecnology #Navidad2026 #RegalosDeNavidad', '',
        ...hechos.filter((x) => x.id !== 'todos').flatMap((x) => [`==== ${x.archivo}.mp4 · ${NOMBRE[x.formato]} · ${porId[x.id].tema} ====`, porId[x.id].texto, '']),
    ].join('\r\n'));
}
try { fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {}
console.log(`Listo: ${hechos.length} videos nuevos${saltados ? ` (${saltados} ya estaban hechos con voz)` : ''}${cuotaAgotada ? ' · cupo de voz agotado: correr de nuevo mañana' : ''} en ${CARPETA} (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
if (problemas.length) { console.log(`⚠ Revisar ${problemas.length}:\n  ${problemas.join('\n  ')}`); process.exitCode = 1; }
