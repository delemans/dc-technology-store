// herramientas/publicidad-diciembre.mjs — Publicidad de temporada (diciembre 2026, pedido del director el 24/11/2026):
// una pieza por CADA producto de ANC visible en la tienda (físico y digital) + mantenimiento y revisión, cada una con su
// propia temática decembrina (gancho, colores y adornos distintos). Datos REALES: precios vigentes de la base
// (precios_publicos; servicios desde productos.json) y unidades del proveedor (disponibilidad.json). Sin precio «antes»
// ni descuentos inventados, sin nombrar al proveedor.
//
//   node herramientas/publicidad-diciembre.mjs              → genera las imágenes (feed 1080×1350 e historia 1080×1920)
//                                                            y TEXTOS.txt en el Escritorio «Anuncios DC Tecnology/Diciembre 2026»
//   node herramientas/publicidad-diciembre.mjs --publicar N → publica en los estados de WhatsApp las N piezas que aún no
//                                                            han salido (registro: herramientas/salida/diciembre-publicadas.json)
//   node herramientas/publicidad-diciembre.mjs --probar     → muestra qué haría, sin generar ni publicar
//   node herramientas/publicidad-diciembre.mjs --instalar   → tarea diaria: 2 piezas a las 10:00 y 2 a las 17:00
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { filtrar } = require('./disponibilidad.js');
const DESTINO = path.join(process.env.USERPROFILE ?? 'C:/Users/dise12', 'Desktop', 'Anuncios DC Tecnology', 'Diciembre 2026');
const REGISTRO = path.join(RAIZ, 'herramientas', 'salida', 'diciembre-publicadas.json');
const args = process.argv.slice(2);
const PROBAR = args.includes('--probar');
const PUBLICAR = args.includes('--publicar') ? Number(args[args.indexOf('--publicar') + 1]) || 3 : 0;

if (args.includes('--instalar')) {
    // 2 piezas a las 10 a. m. y 2 a las 5 p. m. hasta que salgan todas (luego la tarea no hace nada y se puede borrar)
    const tarea = 'DC Tecnology - publicidad de diciembre';
    const { execFileSync } = await import('node:child_process');
    const ps = `$a = New-ScheduledTaskAction -Execute '${process.execPath}' -Argument '--use-system-ca "${path.join(RAIZ, 'herramientas', 'publicidad-diciembre.mjs')}" --publicar 2' -WorkingDirectory '${RAIZ}';
$t = @((New-ScheduledTaskTrigger -Daily -At '10:00'), (New-ScheduledTaskTrigger -Daily -At '17:00'));
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15);
Register-ScheduledTask -TaskName '${tarea}' -Action $a -Trigger $t -Settings $s -Description 'Publica en los estados de WhatsApp la publicidad de diciembre (2 piezas por turno). DC Tecnology.' -Force | Out-Null`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
    console.log(`Tarea "${tarea}" instalada: 2 piezas a las 10:00 y 2 a las 17:00 hasta completar las de diciembre.`);
    process.exit(0);
}

const cop = (v) => `$${Number(v).toLocaleString('es-CO')}`;
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- Catálogo vigente ---------- */
const eq = JSON.parse(fs.readFileSync(path.join(RAIZ, 'herramientas', 'equivalencias-ancpagos.json'), 'utf8'));
const disp = JSON.parse(fs.readFileSync(path.join(RAIZ, 'disponibilidad.json'), 'utf8'));
const visibles = filtrar(JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8'))).filter((p) => !p.oculto);
let base = [];
try {
    base = await (await fetch('https://vyqcizwfmjlflncdwzve.supabase.co/rest/v1/rpc/precios_publicos', { method: 'POST',
        headers: { apikey: 'sb_publishable_GvQiv6M7iSrlwsA90lXsOQ_5OfSYBwy', 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15000) })).json();
} catch (e) { console.log(`⚠ La base no respondió (${e.cause?.code ?? e.message}): uso los precios de productos.json`); }
// Precio vigente de cada plan: el de la base (lo que se cobra); los servicios, el de productos.json (decisión del 24/11/2026)
const planes = (p) => p.variantes.map((v) => {
    const b = !p.id.startsWith('servicio-') && Array.isArray(base) ? base.find((x) => x.producto_id === p.id && x.variante === v.nombre) : null;
    return { nombre: v.nombre, precio: Number(b ? b.precio : v.precio) };
}).filter((v) => v.precio > 0);
const unidades = (id) => { const e = disp.existencias?.[id]; return typeof e === 'number' ? e : e && typeof e === 'object' ? Math.max(...Object.values(e)) : null; };

/* ---------- Un gancho de diciembre distinto por producto ---------- */
// t: titular (<em> = acento) · s: subtítulo · b: 3 razones (hechos del producto) · plan: nombre corto de cada plan
// estilo: decoración propia del tema (si no, rota entre los 12 estilos)
const GANCHOS = {
    'reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados': { tema: 'Regalo de Navidad', t: 'El regalo que trae <em>otro regalo adentro</em>', s: 'Reloj inteligente con audífonos inalámbricos guardados en el mismo reloj.', b: ['Audífonos Bluetooth dentro del reloj', 'Llamadas, notificaciones y salud', 'Regalo 2 en 1 para esta Navidad'] },
    'diademas-inalambricas-cr-8-con-luces-r9s7x': { estilo: 'velitas', tema: 'Noche de velitas', t: 'Que brillen más <em>que las velitas</em>', s: 'Diademas inalámbricas con luces LED y sonido estéreo.', b: ['Luces LED en las orejeras', 'Bluetooth, sin cables', 'Almohadillas suaves para horas de música'] },
    'diademas-gamer-a3s-alambrico': { estilo: 'gamer', tema: 'Vacaciones gamer', t: 'Vacaciones de <em>pura partida</em>', s: 'Diadema gamer con micrófono y cable sin retraso.', b: ['Sonido estéreo envolvente', 'Micrófono ajustable', 'Cable trenzado: cero latencia'] },
    'reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable': { tema: 'Para papá', t: 'Un regalo <em>de categoría</em>', s: 'Smartwatch GT5 Pro en acero inoxidable.', b: ['Caja y correa de acero inoxidable', 'Ritmo cardíaco, sueño y deporte', 'Resistente a salpicaduras (IP67)'] },
    'auriculares-inalambricos-de-gancho-sp16': { estilo: 'fiesta', tema: 'Propósitos de año nuevo', t: 'Arranca el 2027 <em>entrenando</em>', s: 'Auriculares inalámbricos de gancho que no se caen al correr.', b: ['Gancho firme para deporte', 'Inalámbricos Bluetooth', 'Tu música en cada entrenamiento'] },
    'auriculares-inalambricos-m25-con-powerbank': { estilo: 'medianoche', tema: 'Viaje de fin de año', t: 'Al paseo con <em>batería de sobra</em>', s: 'Auriculares M25: el estuche también carga tu celular.', b: ['Estuche que funciona como powerbank', 'Inalámbricos Bluetooth', 'Ideal para el viaje de diciembre'] },
    'reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable': { estilo: 'dorado', tema: 'Noche de gala', t: 'Brilla en la <em>cena de fin de año</em>', s: 'Smartwatch P13 de lujo en acero inoxidable.', b: ['Diseño elegante en acero', 'Notificaciones en tu muñeca', 'Para lucirlo el 24 y el 31'] },
    netflix: { tema: 'Maratón navideña', t: 'Diciembre de <em>maratón en Netflix</em>', s: 'Una pantalla para ver tus series y películas de temporada.', b: ['Películas navideñas y estrenos', 'Una pantalla para ti', 'Entrega por WhatsApp al validar tu pago'] },
    'prime-video': { tema: 'Tarde de película', t: 'Crispetas, cobija y <em>Prime Video</em>', s: 'Una pantalla para las tardes de vacaciones.', b: ['Series y películas originales', 'Una pantalla para ti', 'Entrega por WhatsApp'] },
    'disney-plus': { tema: 'Navidad con los niños', t: 'Vacaciones de <em>los niños, resueltas</em>', s: 'Disney+, Pixar, Marvel y Star Wars en una pantalla.', b: ['Clásicos navideños de Disney', 'Pantalla Premium', 'Entrega por WhatsApp'] },
    'hbo-max': { tema: 'Noche buena de series', t: 'La serie que <em>todos van a comentar</em>', s: 'Max: elige pantalla estándar, platino o cuenta completa.', b: ['Series de HBO y películas de Warner', 'Pantalla o cuenta completa', 'Entrega por WhatsApp'] },
    crunchyroll: { tema: 'Diciembre otaku', t: 'Diciembre de <em>anime sin pausa</em>', s: 'Crunchyroll Mega Fan para ponerte al día en vacaciones.', b: ['Anime en simulcast', 'Perfil Mega Fan', 'Entrega por WhatsApp'] },
    'vix-premium': { tema: 'Novelas en familia', t: 'Las novelas de la abuela, <em>en Navidad</em>', s: 'ViX Premium: novelas, cine y fútbol en español.', b: ['Contenido en español', 'Una pantalla', 'Entrega por WhatsApp'] },
    'paramount-plus': { tema: 'Cine en casa', t: 'El cine de diciembre, <em>en tu sala</em>', s: 'Paramount+ para las noches de vacaciones.', b: ['Películas y series de Paramount', 'Una pantalla', 'Entrega por WhatsApp'] },
    'universal-plus': { tema: 'Plan de primos', t: 'Plan con los primos: <em>películas</em>', s: 'Universal+ con canales y series para toda la familia.', b: ['Series y canales de Universal', 'Una pantalla', 'Entrega por WhatsApp'] },
    'viki-rakuten': { tema: 'Navidad coreana', t: 'Tu Navidad <em>en k-drama</em>', s: 'Viki: dramas asiáticos para maratonear.', b: ['Doramas coreanos y asiáticos', 'Una pantalla', 'Entrega por WhatsApp'] },
    'apple-tv': { tema: 'Estrenos de temporada', t: 'Estrenos para <em>cerrar el año</em>', s: 'Apple TV: series y películas originales.', b: ['Originales de Apple', 'Un perfil', 'Entrega por WhatsApp'] },
    mubi: { tema: 'Cine de autor', t: 'Para el cinéfilo <em>del amigo secreto</em>', s: 'MUBI: cine independiente seleccionado.', b: ['Películas de autor y festivales', 'Un perfil', 'Entrega por WhatsApp'] },
    'combo-3-o-4-plataformas': { tema: 'Combo navideño', t: '3 o 4 plataformas en <em>un solo pedido</em>', s: 'Un perfil en cada plataforma del combo.', b: ['Netflix, Prime Video, Disney y Max', 'Un pedido, un pago', 'Entrega por WhatsApp'], plan: (n) => n.replace(/ Premium/g, '').replace('Prime Video', 'Prime') },
    'directv-go': { tema: 'Fútbol de diciembre', t: 'Que no te cuenten <em>el partido</em>', s: 'DirecTV Go: canales en vivo con ESPN o Win Play.', b: ['TV en vivo y deportes', 'Con ESPN o con Win Play', 'Entrega por WhatsApp'] },
    'youtube-premium': { tema: 'Villancicos sin anuncios', t: 'Villancicos <em>sin un solo anuncio</em>', s: 'YouTube Premium con YouTube Music incluido.', b: ['Sin anuncios y con descargas', 'YouTube Music Premium incluido', 'Entrega por WhatsApp'] },
    'spotify-premium': { tema: 'Playlist decembrina', t: 'La playlist de diciembre, <em>sin cortes</em>', s: 'Spotify Premium por 1 o 3 meses.', b: ['Música sin anuncios', 'Descargas para el viaje', 'Entrega por WhatsApp'] },
    'deezer-premium': { tema: 'Parranda en casa', t: 'La parranda suena <em>en HiFi</em>', s: 'Deezer Premium: audio de alta fidelidad sin anuncios.', b: ['Sonido HiFi', 'Modo sin conexión', 'Entrega por WhatsApp'] },
    'canva-pro': { tema: 'Tarjetas de Navidad', t: 'Diseña tus <em>tarjetas de Navidad</em>', s: 'Canva Pro por un mes o un año completo.', b: ['Plantillas y elementos Pro', 'Invitaciones, tarjetas y publicidad', 'Entrega por WhatsApp'] },
    'duolingo-super': { tema: 'Propósito 2027', t: 'Este año sí: <em>aprende inglés</em>', s: 'Duolingo Super para cumplir el propósito de año nuevo.', b: ['Sin anuncios', 'Vidas ilimitadas', 'Entrega por WhatsApp'] },
    'mcafee-antivirus': { tema: 'Compras seguras', t: 'Compras de Navidad <em>sin sustos</em>', s: 'McAfee para tu computador durante 1 año.', b: ['Protección para 1 o 5 equipos', 'Navega y compra con tranquilidad', 'Entrega por WhatsApp'] },
    'pin-virtual-disney-plus-1tpu5': { tema: 'Amigo secreto', t: 'Amigo secreto <em>resuelto en 1 minuto</em>', s: 'PIN de Disney+ para regalar sin tarjeta de crédito.', b: ['Prepago: sin cobros automáticos', 'El código llega por WhatsApp', 'Planes con o sin anuncios'] },
    'pin-virtual-netflix': { tema: 'Aguinaldo digital', t: 'El aguinaldo que <em>sí van a usar</em>', s: 'PIN de Netflix para recargar la cuenta de quien quieras.', b: ['Desde $20.000 hasta $50.000', 'Sin tarjeta de crédito', 'El código llega por WhatsApp'] },
    'pin-virtual-directv-go': { tema: 'Regalo para el tío', t: 'Para el tío <em>que no se pierde un partido</em>', s: 'PIN de DirecTV Go para recargar su plan.', b: ['Varios valores', 'Sin tarjeta de crédito', 'El código llega por WhatsApp'] },
    'pin-virtual-win-play': { tema: 'Fútbol colombiano', t: 'El fútbol colombiano <em>también se regala</em>', s: 'PIN de Win Play por un mes.', b: ['Fútbol profesional colombiano', 'Prepago, sin cobros automáticos', 'El código llega por WhatsApp'] },
    'pin-virtual-vix': { tema: 'Detalle para mamá', t: 'Un detalle para <em>mamá</em>', s: 'PIN de ViX Premium para sus novelas.', b: ['Novelas y cine en español', 'Prepago', 'El código llega por WhatsApp'] },
    'pin-virtual-deezer': { tema: 'Regalo musical', t: 'Regala <em>un mes de música</em>', s: 'PIN de Deezer Premium.', b: ['1 mes sin anuncios', 'Prepago, sin tarjeta', 'El código llega por WhatsApp'] },
    'pin-virtual-roblox': { tema: 'Carta al Niño Dios', t: 'Lo que pidió <em>en la carta al Niño Dios</em>', s: 'PIN de Roblox para Robux o Premium.', b: ['$25.000, $50.000 o $100.000', 'Sin tarjeta de crédito', 'El código llega por WhatsApp'] },
    'pin-virtual-mcafee': { tema: 'Regalo útil', t: 'El regalo más <em>útil del año</em>', s: 'PIN de McAfee por 1 año para 1, 5 o 10 dispositivos.', b: ['Protección por 1 año', 'Para 1, 5 o 10 dispositivos', 'El código llega por WhatsApp'] },
    'pin-virtual-datacredito': { tema: 'Finanzas de enero', t: 'Que enero no te <em>coja desprevenido</em>', s: 'PIN de Mi DataCrédito: tu historia y puntaje de crédito.', b: ['1 mes de acceso Premium', 'Alertas de cambios en tu reporte', 'Funciona con cédula colombiana'] },
    'servicio-mantenimiento-computadores': { tema: 'Limpieza de fin de año', t: 'Tu PC también merece <em>su limpieza de diciembre</em>', s: 'Mantenimiento preventivo o correctivo con cambio de pasta térmica.', b: ['Limpieza interna y del software', 'Correctivo con cambio térmico', 'Agenda por WhatsApp'] },
    'servicio-reparacion-repuestos': { tema: 'Antes de las vacaciones', t: '¿Falla tu PC? <em>Revisión de $25.000</em>', s: 'Te decimos qué tiene y, si lo reparas, la revisión se descuenta.', b: ['Escritorio y portátiles', 'Si reparas, se descuentan los $25.000', 'Venta de repuestos'], soloPrecios: (v) => /Revisi/.test(v.nombre) },
};

/* ---------- 12 estilos decembrinos (rotan: dos piezas seguidas nunca se parecen) ---------- */
const ESTILOS = [
    { id: 'pino', fondo: 'radial-gradient(80% 50% at 100% 0%,#1F7A4D,transparent 60%),radial-gradient(70% 45% at 0% 100%,#C8102E,transparent 70%),#0C2A1C', texto: '#F6F3E9', acento: '#F2C14E', adorno: 'luces' },
    { id: 'nieve', fondo: 'linear-gradient(180deg,#EAF2FB,#FFFFFF 60%,#F3F6FA)', texto: '#0F1B2D', acento: '#C8102E', adorno: 'nieve', claro: true },
    { id: 'velitas', fondo: 'radial-gradient(60% 40% at 50% 100%,rgba(255,163,26,.55),transparent 70%),radial-gradient(70% 50% at 100% 0%,rgba(200,16,46,.35),transparent 60%),#1A0E06', texto: '#FFF4E0', acento: '#FFB23E', adorno: 'velas' },
    { id: 'rojo', fondo: 'radial-gradient(90% 60% at 0% 0%,#E03445,transparent 60%),linear-gradient(160deg,#8E0A20,#4A0410)', texto: '#FFFFFF', acento: '#FFD66B', adorno: 'cinta' },
    { id: 'medianoche', fondo: 'radial-gradient(80% 50% at 80% 0%,rgba(80,110,255,.35),transparent 60%),#070B1F', texto: '#EEF1FF', acento: '#F2C14E', adorno: 'estrellas' },
    { id: 'dorado', fondo: 'linear-gradient(160deg,#FFF8E6,#F7E3B0 70%,#EBC874)', texto: '#2A1B05', acento: '#B3121F', adorno: 'confeti', claro: true },
    { id: 'menta', fondo: 'radial-gradient(70% 45% at 100% 0%,#FDE2E4,transparent 60%),linear-gradient(180deg,#E8F6EF,#FFFFFF)', texto: '#0E2A1E', acento: '#C8102E', adorno: 'luces', claro: true },
    { id: 'gamer', fondo: 'radial-gradient(70% 50% at 100% 0%,rgba(224,52,69,.55),transparent 60%),radial-gradient(60% 40% at 0% 100%,rgba(46,204,113,.35),transparent 70%),#05070D', texto: '#F2F4F8', acento: '#3BE38A', adorno: 'estrellas' },
    { id: 'papel', fondo: 'repeating-linear-gradient(45deg,#C8102E 0 36px,#B00D27 36px 72px)', texto: '#FFFFFF', acento: '#FFE08A', adorno: 'cinta', panel: true },
    { id: 'fiesta', fondo: 'radial-gradient(70% 50% at 0% 0%,rgba(242,193,78,.45),transparent 60%),radial-gradient(70% 50% at 100% 100%,rgba(200,16,46,.45),transparent 60%),#120A1E', texto: '#FFF7EC', acento: '#F2C14E', adorno: 'confeti' },
    { id: 'bosque', fondo: 'linear-gradient(170deg,#0F3B2A,#0A2219)', texto: '#EAF7EF', acento: '#FF6B78', adorno: 'nieve' },
    { id: 'crema', fondo: 'radial-gradient(80% 50% at 100% 0%,#F9D7DB,transparent 60%),#FFF9F2', texto: '#2B1410', acento: '#C8102E', adorno: 'estrellas', claro: true },
];

const piezas = visibles.filter((p) => eq[p.id] || GANCHOS[p.id]?.tema && p.id.startsWith('servicio-')).map((p, i) => {
    const g = GANCHOS[p.id];
    if (!g) return { p, falta: true };
    const ps = planes(p).filter(g.soloPrecios ?? (() => true));
    return { p, g, estilo: ESTILOS.find((e) => e.id === g.estilo) ?? ESTILOS[i % ESTILOS.length], planes: ps, quedan: unidades(p.id), n: String(i + 1).padStart(2, '0') };
});
const faltan = piezas.filter((x) => x.falta).map((x) => x.p.id);
if (faltan.length) { console.log(`⚠ Productos sin gancho de diciembre (agrégalos en GANCHOS): ${faltan.join(', ')}`); }
const listas = piezas.filter((x) => !x.falta && x.planes.length);
// Candado de precios (24/11/2026): la publicidad muestra lo que COBRA la base. Si la base todavía tiene un precio de ANC
// por debajo del precio con margen (productos.json, recalcular-precios-anc.mjs), no se genera nada: primero se aplica
// supabase/wo-059 o se espera la sincronización de n8n (cada 6 h). Así ninguna pieza sale con un precio viejo.
const pendientesPrecio = listas.filter((x) => eq[x.p.id]).flatMap((x) => x.p.variantes.filter((v) => { const b = x.planes.find((y) => y.nombre === v.nombre); return b && b.precio < Number(v.precio); }).map((v) => `${x.p.nombre} · ${v.nombre}: la base cobra ${cop(x.planes.find((y) => y.nombre === v.nombre).precio)} y el precio con margen es ${cop(v.precio)}`));
if (pendientesPrecio.length && !args.includes('--forzar-precios')) {
    console.log(`⛔ La base todavía tiene ${pendientesPrecio.length} precios sin el margen nuevo (p. ej. ${pendientesPrecio[0]}).\n   Aplica supabase/APLICAR-PENDIENTES.sql (wo-059) o espera la sincronización de n8n, y vuelve a correr. No se generó nada.`);
    process.exit(2);
}
const archivo = (x) => `${x.n}-${x.p.id}`.slice(0, 80);

/* ---------- Pieza HTML ---------- */
const adorno = (tipo, e, alto) => {
    const al = (s) => { let h = s; return () => ((h = (h * 9301 + 49297) % 233280) / 233280); };
    const r = al(alto + tipo.length);
    if (tipo === 'luces') return `<div class="luces">${Array.from({ length: 13 }, (_, i) => `<i style="left:${4 + i * 7.6}%;top:${18 + Math.sin(i / 1.6) * 16}px;background:${['#F2C14E', '#E03445', '#3BE38A', '#5AA9FF'][i % 4]}"></i>`).join('')}</div>`;
    if (tipo === 'nieve') return Array.from({ length: 40 }, () => `<b class="copo" style="left:${r() * 100}%;top:${r() * 100}%;width:${4 + r() * 10}px;opacity:${0.25 + r() * 0.5}"></b>`).join('');
    if (tipo === 'estrellas') return Array.from({ length: 26 }, () => `<b class="estrella" style="left:${r() * 100}%;top:${r() * 60}%;font-size:${10 + r() * 22}px;opacity:${0.3 + r() * 0.6}">✦</b>`).join('');
    if (tipo === 'confeti') return Array.from({ length: 34 }, (_, i) => `<b class="confeti" style="left:${r() * 100}%;top:${r() * 100}%;transform:rotate(${r() * 180}deg);background:${[e.acento, '#E03445', '#FFFFFF', '#3BE38A'][i % 4]}"></b>`).join('');
    if (tipo === 'velas') return `<div class="velas">${Array.from({ length: 9 }, (_, i) => `<span style="height:${60 + (i % 3) * 26}px"><em></em></span>`).join('')}</div>`;
    if (tipo === 'cinta') return '<div class="cinta-v"></div><div class="cinta-h"></div><div class="mono">🎀</div>';
    return '';
};
const css = (e, alto) => {
    const H = alto > 1500;
    const carta = e.claro ? '#FFFFFF' : 'rgba(0,0,0,.32)';
    return `*{box-sizing:border-box}html,body{margin:0;width:1080px;height:${alto}px;overflow:hidden;font-family:Inter,system-ui,sans-serif}
body{position:relative;display:flex;flex-direction:column;padding:${H ? '120px 72px 120px' : '70px 72px 70px'};background:${e.fondo};color:${e.texto}}
.lienzo{position:relative;z-index:2;display:flex;flex-direction:column;flex:1;min-height:0${e.panel ? `;background:rgba(74,4,16,.82);border-radius:40px;padding:48px;box-shadow:0 40px 90px -40px rgba(0,0,0,.8)` : ''}}
.copo{position:absolute;aspect-ratio:1;border-radius:50%;background:${e.claro ? '#9DB8D6' : '#FFFFFF'};z-index:1}
.estrella{position:absolute;color:${e.acento};z-index:1}.confeti{position:absolute;width:14px;height:26px;border-radius:3px;opacity:.55;z-index:1}
.luces{position:absolute;left:0;right:0;top:0;height:90px;z-index:1;border-top:3px solid rgba(0,0,0,.35)}.luces i{position:absolute;width:22px;height:32px;border-radius:50% 50% 45% 45%;box-shadow:0 0 26px 6px currentColor;color:inherit}
.velas{position:absolute;left:0;right:0;bottom:0;height:200px;display:flex;justify-content:space-around;align-items:flex-end;z-index:1;opacity:.5}.velas span{position:relative;width:26px;background:linear-gradient(#FFF4E0,#E9C9A0);border-radius:6px 6px 0 0}.velas em{position:absolute;left:50%;top:-34px;width:18px;height:30px;transform:translateX(-50%);border-radius:50% 50% 50% 50%/60% 60% 40% 40%;background:radial-gradient(circle at 50% 70%,#FFF,#FFB23E 45%,#FF5A1F);box-shadow:0 0 40px 14px rgba(255,163,26,.6)}
.cinta-v{position:absolute;top:0;bottom:0;right:22px;width:30px;background:linear-gradient(90deg,#E8B947,#FFE08A,#E8B947);z-index:1;opacity:.9}.cinta-h{position:absolute;left:0;right:0;bottom:22px;height:30px;background:linear-gradient(#E8B947,#FFE08A,#E8B947);z-index:1;opacity:.9}.mono{position:absolute;right:-6px;top:${H ? 60 : 30}px;font-size:96px;z-index:1}
.marca{display:flex;align-items:center;gap:18px;font:900 34px/1 Outfit,sans-serif;letter-spacing:.06em}.marca img{width:64px;height:64px;border-radius:14px;background:#fff}.marca b{color:${e.acento}}
.tema{margin-top:${H ? 110 : 64}px;display:inline-flex;align-self:flex-start;gap:12px;align-items:center;padding:12px 22px;border-radius:999px;font:800 22px/1 Inter;letter-spacing:.2em;text-transform:uppercase;background:${e.acento};color:${e.claro ? '#FFFFFF' : '#1A0B00'}}
h1{margin:22px 0 0;font:900 ${H ? 96 : 80}px/1.02 Outfit,sans-serif;letter-spacing:-.02em;text-wrap:balance}h1 em{font-style:normal;color:${e.acento}}
.sub{margin:18px 0 0;font:600 ${H ? 34 : 30}px/1.3 Inter;opacity:.85;text-wrap:balance}
.cuerpo{flex:1;min-height:0;${H ? 'display:flex;flex-direction:column;gap:36px;padding:36px 0' : 'display:grid;grid-template-columns:1.1fr .9fr;gap:36px;align-items:center;align-content:center;padding:24px 0'}}.cuerpo>*{min-width:0}
ul{margin:0 0 22px;padding:0;list-style:none;display:grid;gap:14px}li{position:relative;padding-left:46px;font:600 ${H ? 32 : 27}px/1.25 Inter}li::before{content:'★';position:absolute;left:0;top:-2px;color:${e.acento};font-size:1.1em}
.precios{display:grid;gap:12px}.muchos .precios{gap:8px}.muchos .precio{padding:11px 20px}.muchos ul{gap:8px;margin-bottom:14px}.muchos li{font-size:${H ? 28 : 23}px}.precio{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:16px 22px;border-radius:20px;background:${carta};box-shadow:inset 0 0 0 2px ${e.claro ? 'rgba(15,17,26,.08)' : 'rgba(255,255,255,.14)'}}
.precio span{font:600 ${H ? 28 : 24}px/1.2 Inter;color:${e.claro ? '#1B1F2A' : 'inherit'}}.precio b{font:900 ${H ? 42 : 36}px/1 Outfit;color:${e.claro ? '#C8102E' : e.acento};white-space:nowrap}
.vitrina{position:relative;display:grid;place-items:center;${H ? 'flex:1 1 0;min-height:260px' : 'aspect-ratio:1;max-height:500px'};justify-self:center;width:100%;border-radius:40px;background:radial-gradient(120% 90% at 50% 0%,#FFF 0%,#F1F2F5 55%,#DFE3E9 100%);box-shadow:0 40px 80px -36px rgba(0,0,0,.65),0 0 0 8px ${e.acento}}
.vitrina img{width:80%;height:80%;${H ? 'position:absolute;inset:10%;' : ''}object-fit:contain;filter:drop-shadow(0 18px 18px rgba(15,17,26,.25))}
.moño{position:absolute;top:-34px;left:50%;transform:translateX(-50%);font-size:64px}
.quedan{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);white-space:nowrap;padding:12px 22px;border-radius:999px;background:#C8102E;color:#fff;font:800 24px/1 Inter;box-shadow:0 14px 30px -12px rgba(200,16,46,.9)}
.pie{display:flex;align-items:center;justify-content:space-between;gap:24px}
.cta{display:inline-flex;align-items:center;gap:14px;padding:22px 32px;border-radius:999px;background:#059669;color:#fff;font:800 30px/1 Inter;box-shadow:0 20px 40px -18px rgba(5,150,105,.9)}
.web{font:900 34px/1 Outfit;letter-spacing:.02em}.web b{color:${e.acento}}`;
};
const LOGO = `data:image/png;base64,${fs.readFileSync(path.join(RAIZ, 'img', 'logo-dc-192.png')).toString('base64')}`;
const html = (x, alto) => {
    const { p, g, estilo: e } = x;
    const nombrePlan = g.plan ?? ((n) => n);
    const filas = x.planes.slice(0, alto > 1500 ? 5 : 4);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600;800&family=Outfit:wght@800;900&display=swap" rel="stylesheet"><style>${css(e, alto)}</style></head><body>
${adorno(e.adorno, e, alto)}
<div class="lienzo">
<div class="marca"><img src="${LOGO}" alt="">DC <b>TECNOLOGY</b></div>
<div class="tema">🎄 ${esc(g.tema)}</div>
<h1>${g.t}</h1><p class="sub">${esc(g.s)}</p>
<div class="cuerpo${filas.length > 3 ? ' muchos' : ''}">
<div><ul>${g.b.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
<div class="precios">${filas.map((v) => `<div class="precio"><span>${esc(nombrePlan(v.nombre))}</span><b>${cop(v.precio)}</b></div>`).join('')}</div></div>
<div class="vitrina"><span class="moño">🎁</span><img src="${esc(p.imagen)}" alt="">${x.quedan && x.quedan <= 5 ? `<span class="quedan">Solo quedan ${x.quedan}</span>` : ''}</div>
</div>
<div class="pie"><span class="cta">💬 Pídelo: 322 328 4622</span><span class="web">www.dctecnology<b>.xyz</b></span></div>
</div></body></html>`;
};
// Texto para acompañar cada pieza (estados, Facebook, Instagram, TikTok)
const texto = (x) => {
    const { p, g } = x;
    const desde = Math.min(...x.planes.map((v) => v.precio));
    const url = `https://www.dctecnology.xyz/p/${p.id}.html`;
    return [`🎄 ${g.t.replace(/<\/?em>/g, '')}`, g.s, '', ...g.b.map((b) => `✅ ${b}`),
        x.planes.length > 1 ? `💰 Desde ${cop(desde)}` : `💰 ${cop(desde)}`, ...(x.quedan && x.quedan <= 5 ? [`⏳ Solo quedan ${x.quedan} unidades`] : []),
        '', `🛒 ${url}`, '💬 WhatsApp 322 328 4622', '#DCTecnology #Navidad2026 #RegalosDeNavidad'].join('\n');
};

// --json: los mismos datos (precios vigentes, unidades, temas) para herramientas/videos-diciembre.mjs
if (args.includes('--json')) {
    process.stdout.write('\n@@DATOS@@' + JSON.stringify(listas.map((x) => ({ id: x.p.id, n: x.n, archivo: archivo(x), nombre: x.p.nombre, tipo: x.p.tipo, imagen: x.p.imagen,
        tema: x.g.tema, t: x.g.t, s: x.g.s, b: x.g.b, estilo: x.estilo, quedan: x.quedan, texto: texto(x),
        planes: x.planes.map((v) => ({ nombre: (x.g.plan ?? ((n) => n))(v.nombre), precio: v.precio })) }))));
    process.exit(0);
}
console.log(`Diciembre 2026: ${listas.length} piezas (${listas.filter((x) => x.p.tipo === 'tecnologia').length} de tecnología, ${listas.filter((x) => x.p.tipo !== 'tecnologia').length} digitales y servicios)`);
if (PROBAR) {
    for (const x of listas) console.log(`  ${x.n} · ${x.g.tema.padEnd(26)} · ${x.estilo.id.padEnd(10)} · ${x.p.nombre} · ${x.planes.map((v) => cop(v.precio)).join(' / ')}${x.quedan ? ` · quedan ${x.quedan}` : ''}`);
    if (PUBLICAR) console.log(`  (--publicar ${PUBLICAR}: saldrían las próximas ${PUBLICAR} que no han salido)`);
    process.exit(0);
}

/* ---------- Publicar en estados de WhatsApp (Evolution) ---------- */
if (PUBLICAR) {
    const { cargarEntorno, requerir } = require('./entorno.js');
    const env = cargarEntorno();
    requerir(env, ['EVOLUTION_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCIA']);
    const URL_EVO = env.EVOLUTION_URL.replace(/\/+$/, '');
    const INST = env.EVOLUTION_INSTANCIA;
    const evo = async (ruta, cuerpo) => {
        const r = await fetch(`${URL_EVO}${ruta}`, { method: 'POST', headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo ?? {}), signal: AbortSignal.timeout(120000) });
        const t = await r.text(); if (!r.ok) throw new Error(`Evolution ${r.status}: ${t.slice(0, 200)}`); return t ? JSON.parse(t) : {};
    };
    const hechas = fs.existsSync(REGISTRO) ? JSON.parse(fs.readFileSync(REGISTRO, 'utf8')) : [];
    // Si ya existe el video (herramientas/videos-diciembre.mjs) sale el video; si no, la imagen. Primero, el resumen.
    const VIDEOS = path.join(DESTINO, 'Videos 1080x1920');
    const RESUMEN = { p: { id: 'todos', nombre: 'Todo el catálogo de Navidad' }, g: { tema: 'Resumen del catálogo' }, resumen: true };
    const conResumen = fs.existsSync(path.join(VIDEOS, '00-todo-el-catalogo-de-navidad.mp4')) && !args.includes('--solo-imagenes') ? [RESUMEN, ...listas] : listas;
    const pendientes = conResumen.filter((x) => !hechas.some((h) => h.id === x.p.id)).slice(0, PUBLICAR);
    if (!pendientes.length) { console.log('Ya salieron todas las piezas de diciembre.'); process.exit(0); }
    const contactos = await evo(`/chat/findContacts/${INST}`, {});
    const lista = [...new Set((Array.isArray(contactos) ? contactos : [])
        .filter((c) => c.pushName && /^\d{8,15}@s\.whatsapp\.net$/.test(c.remoteJid ?? ''))
        .map((c) => c.remoteJid))];
    if (!lista.length) throw new Error('Evolution no devolvió contactos: no se publica.');
    // Las imágenes se le entregan a Evolution por un servidor local temporal (no hay URL pública)
    const servidor = http.createServer((req, res) => {
        const f = path.join(DESTINO, decodeURIComponent(req.url.slice(1)));
        if (!f.startsWith(DESTINO) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': f.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', 'Content-Length': fs.statSync(f).size }); fs.createReadStream(f).pipe(res);
    });
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
    try {
        for (const x of pendientes) {
            const video = x.resumen ? 'Videos 1080x1920/00-todo-el-catalogo-de-navidad.mp4' : `Videos 1080x1920/${archivo(x)}.mp4`;
            const usarVideo = fs.existsSync(path.join(DESTINO, video)) && !args.includes('--solo-imagenes');
            const rel = usarVideo ? video : `Historia 1080x1920/${archivo(x)}.jpg`;
            if (!fs.existsSync(path.join(DESTINO, rel))) throw new Error(`Falta ${rel}: genera primero las imágenes`);
            const pie = x.resumen ? `🎄 Todo para esta Navidad en DC Tecnology: ${listas.length} regalos entre tecnología, plataformas, pines y servicios.\n\n🛒 https://www.dctecnology.xyz\n💬 WhatsApp 322 328 4622` : texto(x).replace(/#\S+/g, '').trim();
            await evo(`/message/sendStatus/${INST}`, { type: usarVideo ? 'video' : 'image', content: `http://127.0.0.1:${servidor.address().port}/${encodeURIComponent(rel)}`, caption: pie, statusJidList: lista });
            hechas.push({ id: x.p.id, tema: x.g.tema, publicado: new Date().toISOString() });
            fs.mkdirSync(path.dirname(REGISTRO), { recursive: true });
            fs.writeFileSync(REGISTRO, JSON.stringify(hechas, null, 1) + '\n');
            console.log(`✔ estado publicado (${usarVideo ? 'video' : 'imagen'}): ${x.p.nombre} (${x.g.tema}) para ${lista.length} contactos`);
            await new Promise((ok) => setTimeout(ok, 4000));
        }
    } finally { servidor.close(); }
    console.log(`Van ${hechas.length} de ${listas.length} piezas de diciembre.`);
    process.exit(0);
}

/* ---------- Generar imágenes con Chrome sin ventana ---------- */
const TMP = path.join(RAIZ, 'herramientas', 'salida', 'diciembre-html');
const FORMATOS = [{ id: 'Feed 1080x1350', alto: 1350 }, { id: 'Historia 1080x1920', alto: 1920 }];
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
for (const f of FORMATOS) { fs.rmSync(path.join(DESTINO, f.id), { recursive: true, force: true }); fs.mkdirSync(path.join(DESTINO, f.id), { recursive: true }); }
for (const f of FORMATOS) for (const x of listas) fs.writeFileSync(path.join(TMP, `${archivo(x)}-${f.alto}.html`), html(x, f.alto));
const PUERTO = 9800 + Math.floor(Math.random() * 100);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${path.join(TMP, 'perfil')}`, 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let pestañas; for (let i = 0; i < 60; i++) { try { pestañas = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); if (pestañas.some((t) => t.type === 'page')) break; } catch {} await esperar(250); }
const ws = new WebSocket(pestañas.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0; const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); } });
const enviar = (method, params = {}) => new Promise((r) => { const k = ++n; pend.set(k, r); ws.send(JSON.stringify({ id: k, method, params })); });
await enviar('Page.enable');
const desbordes = [];
try {
    for (const f of FORMATOS) {
        await enviar('Emulation.setDeviceMetricsOverride', { width: 1080, height: f.alto, deviceScaleFactor: 1, mobile: false });
        for (const x of listas) {
            await enviar('Page.navigate', { url: 'file:///' + path.join(TMP, `${archivo(x)}-${f.alto}.html`).replace(/\\/g, '/') });
            await esperar(1500);
            await enviar('Runtime.evaluate', { expression: 'Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 8000); }))])', awaitPromise: true });
            await esperar(300);
            // Control de calidad: nada se sale de la pieza y la foto del producto cargó
            const q = (await enviar('Runtime.evaluate', { expression: `JSON.stringify({ alto: document.querySelector('.lienzo').scrollHeight > document.querySelector('.lienzo').clientHeight + 2, foto: document.querySelector('.vitrina img').naturalWidth > 0 })`, returnByValue: true })).result?.value;
            const c = JSON.parse(q ?? '{}');
            if (c.alto || !c.foto) desbordes.push(`${archivo(x)} (${f.alto}): ${c.alto ? 'el contenido no cabe' : ''}${!c.foto ? ' sin foto' : ''}`);
            const img = await enviar('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
            fs.writeFileSync(path.join(DESTINO, f.id, `${archivo(x)}.jpg`), Buffer.from(img.data, 'base64'));
        }
        console.log(`  ${f.id}: ${listas.length} imágenes`);
    }
} finally { ws.close(); chrome.kill(); }
fs.writeFileSync(path.join(DESTINO, 'TEXTOS.txt'), [
    'PUBLICIDAD DE DICIEMBRE 2026 · DC Tecnology',
    'Una pieza por producto: «Feed 1080x1350» para Facebook/Instagram y «Historia 1080x1920» para estados, historias y TikTok.',
    `Precios vigentes al ${new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })} (si cambian, vuelve a correr: node herramientas/publicidad-diciembre.mjs).`, '',
    ...listas.flatMap((x) => [`==== ${archivo(x)}.jpg · ${x.g.tema} ====`, texto(x), '']),
].join('\r\n'));
console.log(`Listo: ${DESTINO}`);
if (desbordes.length) { console.log(`⚠ Revisar ${desbordes.length}:\n  ${desbordes.join('\n  ')}`); process.exitCode = 1; }
