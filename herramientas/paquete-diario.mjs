// herramientas/paquete-diario.mjs — «Ultra paquete» de publicidad diaria (pedido del director el 24/11/2026):
// del 25/11 al 31/12/2026, cada día 2 VIDEOS + 3 IMÁGENES listos para publicar, con hora sugerida y texto:
//   07:30 imagen  · cuenta regresiva del día (única por día: novenas, velitas, Nochebuena, Año Nuevo) + producto del día
//   12:30 video   · versión 1 de un producto (herramientas/videos-diciembre.mjs)
//   15:00 imagen  · pieza de producto (publicidad-diciembre.mjs, feed)
//   19:30 video   · versión 2 de OTRO producto (titular con el precio)
//   21:00 imagen  · guía de regalos con precios reales («Por menos de $20.000», «Para el gamer»…) o «Cómo comprar»
// Datos REALES (los mismos de las imágenes: precios vigentes, unidades del proveedor; pagos y envíos como dice la
// tienda). Sin precio «antes», sin descuentos inventados, sin nombrar al proveedor. La marca va en todas las piezas.
// Desde el 18/12 el producto del día es digital (llega por WhatsApp al validar el pago: sin promesas de envío).
//
//   node --use-system-ca herramientas/paquete-diario.mjs              → genera imágenes nuevas y arma «Paquete diario»
//   node --use-system-ca herramientas/paquete-diario.mjs --publicar   → sube a los estados de WhatsApp las piezas de HOY
//                                                                      cuya hora ya pasó y no han salido
//   node herramientas/paquete-diario.mjs --instalar                    → tarea cada 30 min de 7:00 a 22:00 (--publicar)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DESTINO = path.join(process.env.USERPROFILE ?? 'C:/Users/dise12', 'Desktop', 'Anuncios DC Tecnology', 'Diciembre 2026');
const PAQUETE = path.join(DESTINO, 'Paquete diario');
const PROMOS = path.join(DESTINO, 'Promociones 1080x1350');
const CUENTA = path.join(DESTINO, 'Cuenta regresiva 1080x1920');
const REGISTRO = path.join(RAIZ, 'herramientas', 'salida', 'paquete-publicado.json');
const args = process.argv.slice(2);
const cop = (v) => `$${Number(v).toLocaleString('es-CO')}`;
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const WA = '322 328 4622';
const WEB = 'https://www.dctecnology.xyz';

if (args.includes('--instalar')) {
    const tarea = 'DC Tecnology - paquete diario';
    const ps = `$a = New-ScheduledTaskAction -Execute '${process.execPath}' -Argument '--use-system-ca "${path.join(RAIZ, 'herramientas', 'paquete-diario.mjs')}" --publicar' -WorkingDirectory '${RAIZ}';
$d = New-ScheduledTaskTrigger -Daily -At '07:00';
$d.Repetition = (New-ScheduledTaskTrigger -Once -At '07:00' -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Hours 15)).Repetition;
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20);
Register-ScheduledTask -TaskName '${tarea}' -Action $a -Trigger $d -Settings $s -Description 'Publica en los estados de WhatsApp el paquete diario de diciembre (2 videos y 3 imágenes a su hora). DC Tecnology.' -Force | Out-Null`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
    console.log(`Tarea "${tarea}" instalada: cada 30 min de 7:00 a 22:00 publica lo que ya tocaba hoy.`);
    process.exit(0);
}

/* ---------- Datos vigentes ---------- */
const salida = execFileSync(process.execPath, ['--use-system-ca', path.join(RAIZ, 'herramientas', 'publicidad-diciembre.mjs'), '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 });
const datos = JSON.parse(salida.split('@@DATOS@@')[1]);
const porId = Object.fromEntries(datos.map((x) => [x.id, x]));
const desde = (x) => Math.min(...x.planes.map((v) => v.precio));
const precioTxt = (x) => `${x.planes.length > 1 ? 'Desde ' : ''}${cop(desde(x))}`;
const digital = (x) => x.tipo !== 'tecnologia' && x.tipo !== 'servicios';
const corto = (n) => n.replace(/Reloj Inteligente /i, '').replace(/ con Auriculares Inalámbricos incorporados/i, ' 2 en 1').replace(/ En Acero Inoxidable| en Acero Inoxidable/gi, '')
    .replace(/Auriculares Inalámbricos/i, 'Auriculares').replace(/Diademas Inalámbricas/i, 'Diademas').replace(/ \(Con Powerbank\)/i, ' con powerbank')
    .replace(/ Alámbrico/i, '').replace(/Mantenimiento Preventivo y Correctivo de Equipos/i, 'Mantenimiento de PC').replace(/Reparación de Computadores y Venta de Repuestos/i, 'Revisión y reparación de PC')
    .replace(/McAfee Antivirus Total Protection/i, 'McAfee Antivirus').replace(/ con Luces LED/i, ' con luces LED').replace(/ de Lujo/i, ' de lujo');

/* ---------- Orden de rotación: se intercalan tecnología, plataformas, pines y servicios ---------- */
const grupos = ['tecnologia', 'streaming', 'pines', 'licencias', 'servicios'].map((t) => datos.filter((x) => x.tipo === t));
const orden = [];
for (let i = 0; orden.length < datos.length; i++) for (const g of grupos) if (g[i]) orden.push(g[i]);

/* ---------- Guías de regalos y tarjetas de compra (precios reales) ---------- */
const sel = (ids) => ids.map((i) => porId[i]).filter(Boolean);
const PROMO = [
    { id: 'menos-de-20000', titulo: 'Regalos por menos de <em>$20.000</em>', sub: 'Para el amigo secreto y los detalles de diciembre', items: datos.filter((x) => desde(x) < 20000).sort((a, b) => desde(a) - desde(b)).slice(0, 6) },
    { id: 'tecnologia', titulo: 'Tecnología para <em>regalar</em>', sub: 'Envíos a todo el país', items: datos.filter((x) => x.tipo === 'tecnologia').slice(0, 6) },
    { id: 'series', titulo: 'Para los que aman <em>las series</em>', sub: 'La pantalla llega por WhatsApp al validar tu pago', items: sel(['netflix', 'disney-plus', 'hbo-max', 'prime-video', 'vix-premium', 'apple-tv']) },
    { id: 'como-comprar', info: 'pasos' },
    { id: 'gamer', titulo: 'Para el <em>gamer</em> de la casa', sub: 'Vacaciones de pura partida', items: sel(['diademas-gamer-a3s-alambrico', 'pin-virtual-roblox', 'crunchyroll', 'diademas-inalambricas-cr-8-con-luces-r9s7x']) },
    { id: 'whatsapp', titulo: 'Regalos que llegan <em>por WhatsApp</em>', sub: 'Pines para regalar sin tarjeta de crédito', items: datos.filter((x) => x.tipo === 'pines').slice(0, 6) },
    { id: 'musica', titulo: 'La parranda <em>suena mejor</em>', sub: 'Música sin anuncios para diciembre', items: sel(['spotify-premium', 'youtube-premium', 'deezer-premium', 'pin-virtual-deezer']) },
    { id: 'por-que', info: 'razones' },
    { id: 'ninos', titulo: 'Vacaciones de <em>los niños</em>', sub: 'Películas, juegos y aprender jugando', items: sel(['disney-plus', 'pin-virtual-roblox', 'pin-virtual-disney-plus-1tpu5', 'duolingo-super']) },
    { id: 'mama', titulo: 'Un detalle para <em>mamá y la abuela</em>', sub: 'Novelas, cine y elegancia', items: sel(['vix-premium', 'pin-virtual-vix', 'reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable', 'paramount-plus']) },
    { id: 'futbol', titulo: 'Diciembre <em>de fútbol</em>', sub: 'Que no te cuenten el partido', items: sel(['directv-go', 'pin-virtual-win-play', 'pin-virtual-directv-go']) },
    { id: 'estudio', titulo: 'Arranca el 2027 <em>con todo</em>', sub: 'Para estudiar, trabajar y proteger tu PC', items: sel(['canva-pro', 'duolingo-super', 'mcafee-antivirus', 'servicio-mantenimiento-computadores', 'servicio-reparacion-repuestos', 'pin-virtual-datacredito']) },
    { id: 'ultimas', titulo: '<em>Últimas unidades</em>', sub: 'Unidades reales disponibles hoy', items: datos.filter((x) => x.tipo === 'tecnologia' && x.quedan && x.quedan <= 5).slice(0, 6) },
].filter((p) => p.info || p.items.length >= 3);

/* ---------- Calendario 25/11 → 31/12 ---------- */
const dias = [];
for (let d = new Date(Date.UTC(2026, 10, 25)); d <= new Date(Date.UTC(2026, 11, 31)); d = new Date(d.getTime() + 86400000)) dias.push(d);
const iso = (d) => d.toISOString().slice(0, 10);
const NAV = Date.UTC(2026, 11, 25), AN = Date.UTC(2027, 0, 1);
function cuenta(d) {
    const m = d.getUTCMonth() + 1, dd = d.getUTCDate(), faltan = Math.round((NAV - d.getTime()) / 86400000);
    if (m === 12 && dd === 24) return { grande: 'HOY', linea: 'es Nochebuena', etiqueta: 'Novena · día 9' };
    if (m === 12 && dd === 25) return { grande: '¡Feliz', linea: 'Navidad!', etiqueta: '25 de diciembre' };
    if (m === 12 && dd === 31) return { grande: '¡Feliz', linea: '2027!', etiqueta: 'Último día del año' };
    if (m === 12 && dd > 25) { const f = Math.round((AN - d.getTime()) / 86400000); return { grande: String(f), linea: f === 1 ? 'día para el 2027' : 'días para el 2027', etiqueta: 'Fin de año' }; }
    const etiqueta = m === 12 && dd === 7 ? 'Hoy: noche de velitas' : m === 12 && dd === 8 ? 'Día de la Inmaculada' : m === 12 && dd >= 16 ? `Novena · día ${dd - 15}` : 'Cuenta regresiva';
    return { grande: String(faltan), linea: faltan === 1 ? 'día para Navidad' : 'días para Navidad', etiqueta };
}
const N = orden.length;
// Campaña (24/11/2026): expectativa «Faltan 2 días» / «Falta 1 día», lanzamiento el 27/11 (bienvenida, «Lo que vas a
// encontrar», «Así de fácil») y desde el 28/11 el paquete diario de productos.
const LANZ = Date.UTC(2026, 10, 27);
const plan = dias.map((d) => {
    if (d.getTime() < LANZ) { const n = Math.round((LANZ - d.getTime()) / 864e5); return { d, fecha: iso(d), fase: 'expectativa', faltan: n, video: n === 1 ? 'L2-falta-1-dia' : 'L1-faltan-2-dias' }; }
    if (d.getTime() === LANZ) return { d, fecha: iso(d), fase: 'lanzamiento' };
    const i = Math.round((d.getTime() - LANZ) / 864e5) - 1;
    const pick = (k) => orden[((i + k) % N + N) % N];
    let prodDia = pick(26);
    if (d.getTime() >= Date.UTC(2026, 11, 18)) { for (let k = 26; !digital(prodDia); k++) prodDia = pick(k); }
    return { d, fase: 'productos', fecha: iso(d), video1: i === 0 ? 'resumen' : pick(0), video2: pick(13), cuenta: { ...cuenta(d), x: prodDia }, feed: pick(7), promo: PROMO[i % PROMO.length], i };
});

/* ---------- Diseño de las imágenes nuevas ---------- */
const LOGO = `data:image/png;base64,${fs.readFileSync(path.join(RAIZ, 'img', 'logo-dc-192.png')).toString('base64')}`;
const CSS = `*{box-sizing:border-box}html,body{margin:0;overflow:hidden;font-family:Inter,system-ui,sans-serif}
body{position:relative;display:flex;flex-direction:column;color:#fff;background:radial-gradient(70% 40% at 100% 0%,rgba(224,52,69,.55),transparent 60%),radial-gradient(70% 40% at 0% 100%,rgba(31,122,77,.55),transparent 60%),#0B0F1E}
em{font-style:normal;color:#F2C14E}
.copo{position:absolute;border-radius:50%;background:#fff;opacity:.5}
.cab{position:relative;display:flex;align-items:center;justify-content:center;gap:18px;padding:46px 0 0;font:900 40px/1 Outfit;letter-spacing:.06em}.cab img{width:76px;height:76px;border-radius:18px;background:#fff}.cab b{color:#F2C14E}
.pie{position:relative;margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:26px 56px;background:#000;font:800 34px/1 Inter}
.pie .w{display:flex;align-items:center;gap:12px;padding:16px 26px;border-radius:999px;background:#059669}.pie .u{font:900 34px/1 Outfit}.pie .u b{color:#F2C14E}
h1{position:relative;margin:30px 60px 0;font:900 84px/1.04 Outfit;letter-spacing:-.02em;text-align:center;text-wrap:balance}
.sub{position:relative;margin:16px 60px 0;font:600 32px/1.3 Inter;text-align:center;opacity:.85}
.grid{position:relative;flex:1;display:grid;grid-template-columns:repeat(3,1fr);gap:22px;padding:34px 56px;align-content:center}
.grid.dos{grid-template-columns:repeat(2,1fr);padding:34px 120px}
.it{display:flex;flex-direction:column;border-radius:28px;overflow:hidden;background:#fff;color:#141824;box-shadow:0 26px 50px -26px rgba(0,0,0,.8)}
.it .f{aspect-ratio:1.15;display:grid;place-items:center;background:radial-gradient(120% 90% at 50% 0%,#fff,#EEF0F4 60%,#DDE2E9)}.it .f img{width:76%;height:76%;object-fit:contain}
.it .n{padding:14px 16px 4px;font:800 25px/1.15 Inter;text-align:center;min-height:64px;display:grid;place-items:center}
.it .p{padding:0 16px 16px;font:900 36px/1 Outfit;color:#C8102E;text-align:center}
.it .q{margin:0 auto 14px;padding:6px 14px;border-radius:999px;background:#C8102E;color:#fff;font:800 18px/1 Inter}
.pasos{position:relative;flex:1;display:grid;gap:24px;padding:40px 70px;align-content:center}
.paso{display:flex;gap:28px;align-items:center;padding:30px 34px;border-radius:30px;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 2px rgba(255,255,255,.12)}
.paso i{flex:none;width:96px;height:96px;border-radius:50%;display:grid;place-items:center;font:900 52px/1 Outfit;font-style:normal;background:#F2C14E;color:#1A0B00}
.paso b{display:block;font:900 40px/1.1 Outfit}.paso span{display:block;margin-top:8px;font:600 28px/1.3 Inter;opacity:.85}
/* cuenta regresiva */
.etq{position:relative;align-self:center;margin-top:60px;padding:14px 30px;border-radius:999px;background:#C8102E;font:800 30px/1 Inter;letter-spacing:.16em;text-transform:uppercase}
.num{position:relative;text-align:center;margin-top:24px;font:900 330px/.85 Outfit;letter-spacing:-.04em;background:linear-gradient(180deg,#FFF6D8,#F2C14E 60%,#C98A1C);-webkit-background-clip:text;background-clip:text;color:transparent}
.num.txt{font-size:200px;line-height:.95}
.lin{position:relative;text-align:center;font:900 76px/1 Outfit;margin-top:10px}
.dia{position:relative;margin:56px 70px 0;flex:1;display:flex;flex-direction:column;border-radius:44px;overflow:hidden;background:#fff;color:#141824;box-shadow:0 40px 80px -30px rgba(0,0,0,.85),0 0 0 8px #F2C14E}
.dia .k{padding:22px;background:#F2C14E;color:#1A0B00;text-align:center;font:900 32px/1 Outfit;letter-spacing:.12em;text-transform:uppercase}
.dia .f{flex:1;min-height:0;display:grid;place-items:center;background:radial-gradient(120% 90% at 50% 0%,#fff,#EEF0F4 60%,#DDE2E9)}.dia .f img{max-width:70%;max-height:85%;object-fit:contain}
.dia .n{padding:22px 30px 6px;text-align:center;font:900 50px/1.1 Outfit}.dia .s{padding:0 40px;text-align:center;font:600 28px/1.3 Inter;color:#4A5160}
.dia .p{padding:16px 30px 30px;text-align:center;font:900 76px/1 Outfit;color:#C8102E}
.nota{position:relative;text-align:center;margin:28px 60px 34px;font:700 30px/1.3 Inter;opacity:.9}`;
const copos = (n, alto) => { let s = 3; const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280); return Array.from({ length: n }, () => `<b class="copo" style="left:${r() * 100}%;top:${r() * (alto - 40)}px;width:${3 + r() * 9}px;height:${3 + r() * 9}px"></b>`).join(''); };
const marco = (alto, cuerpo) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800&family=Outfit:wght@800;900&display=swap" rel="stylesheet">
<style>${CSS}html,body{width:1080px;height:${alto}px}</style></head><body>${copos(alto > 1500 ? 60 : 40, alto)}
<div class="cab"><img src="${LOGO}" alt="">DC <b>TECNOLOGY</b></div>${cuerpo}
<div class="pie"><span class="w">💬 ${WA}</span><span class="u">dctecnology<b>.xyz</b></span></div></body></html>`;
function htmlPromo(p) {
    if (p.info === 'pasos') return marco(1350, `<h1>Así de fácil <em>compras</em></h1><p class="sub">En 3 pasos, desde tu celular</p><div class="pasos">
<div class="paso"><i>1</i><div><b>Elige tu regalo</b><span>En dctecnology.xyz o escríbenos al ${WA}</span></div></div>
<div class="paso"><i>2</i><div><b>Paga desde tu app</b><span>Nequi, Daviplata o Llave Bre-B</span></div></div>
<div class="paso"><i>3</i><div><b>Recíbelo</b><span>Lo digital, por WhatsApp al validar tu pago. La tecnología, con envío a todo el país.</span></div></div></div>`);
    if (p.info === 'razones') return marco(1350, `<h1>¿Por qué <em>DC Tecnology</em>?</h1><p class="sub">Tu tienda de tecnología y entretenimiento</p><div class="pasos">
<div class="paso"><i>💬</i><div><b>Te atendemos por WhatsApp</b><span>Pregunta lo que quieras al ${WA}</span></div></div>
<div class="paso"><i>📱</i><div><b>Pagas desde tu app</b><span>Nequi, Daviplata o Llave Bre-B</span></div></div>
<div class="paso"><i>🚚</i><div><b>Envíos a todo el país</b><span>Y lo digital llega por WhatsApp al validar tu pago</span></div></div>
<div class="paso"><i>🛠</i><div><b>Servicio técnico</b><span>Revisión de tu PC por ${cop(desde(porId['servicio-reparacion-repuestos']))}</span></div></div></div>`);
    const it = p.items.slice(0, 6);
    return marco(1350, `<h1>${p.titulo}</h1><p class="sub">${esc(p.sub)}</p><div class="grid${it.length === 4 ? ' dos' : ''}">${it.map((x) => `<div class="it"><div class="f"><img src="${esc(x.imagen)}" alt=""></div><div class="n">${esc(corto(x.nombre))}</div><div class="p">${precioTxt(x)}</div>${x.quedan && x.quedan <= 5 ? `<div class="q">Solo quedan ${x.quedan}</div>` : ''}</div>`).join('')}</div>`);
}
const minimoTipo = (t) => cop(Math.min(...datos.filter((x) => x.tipo === t).map(desde)));
function htmlExpectativa(n) {
    return marco(1920, `<div class="etq">✨ Muy pronto</div><div class="num">${n}</div><div class="lin">${n === 1 ? 'día' : 'días'}</div>
<h1 style="margin-top:70px">La nueva era de<br><em>DC Tecnology</em></h1><p class="sub">Tecnología · Plataformas · Pines · Servicio técnico</p>
<div class="pasos"><div class="paso"><i>📅</i><div><b>Llega el 27 de noviembre</b><span>Estuvimos trabajando para darte un servicio más rápido y mejor</span></div></div>
<div class="paso"><i>💬</i><div><b>Guarda nuestro número</b><span>WhatsApp ${WA}</span></div></div></div>`);
}
function htmlBienvenida() {
    return marco(1920, `<div class="etq">🎉 ¡Ya llegó!</div><h1 style="margin-top:40px;font-size:96px">Bienvenido a la<br><em>nueva era digital</em></h1><p class="sub">Todo lo que necesitas, en un solo lugar</p>
<div class="pasos"><div class="paso"><i>⌚</i><div><b>Tecnología</b><span>Relojes y audífonos desde ${minimoTipo('tecnologia')} · envíos a todo el país</span></div></div>
<div class="paso"><i>🎬</i><div><b>Plataformas</b><span>Series y películas desde ${minimoTipo('streaming')} · llega por WhatsApp</span></div></div>
<div class="paso"><i>🎁</i><div><b>Pines</b><span>Regalos digitales desde ${minimoTipo('pines')}</span></div></div>
<div class="paso"><i>🛠</i><div><b>Servicio técnico</b><span>Revisión de tu PC por ${cop(desde(porId['servicio-reparacion-repuestos']))}</span></div></div></div>
<div class="nota">💬 Escríbenos: te ayudamos a elegir</div>`);
}
function htmlCuenta(c, fecha) {
    const x = c.x; const nota = digital(x) ? '⚡ Llega por WhatsApp al validar tu pago' : x.tipo === 'tecnologia' ? '🚚 Envíos a todo el país' : '🛠 Agenda por WhatsApp';
    return marco(1920, `<div class="etq">🎄 ${esc(c.etiqueta)}</div><div class="num${c.grande.length > 3 ? ' txt' : ''}">${esc(c.grande)}</div><div class="lin">${esc(c.linea)}</div>
<div class="dia"><div class="k">⭐ El regalo de hoy</div><div class="f"><img src="${esc(x.imagen)}" alt=""></div><div class="n">${esc(corto(x.nombre))}</div><div class="s">${esc(x.s)}</div><div class="p">${precioTxt(x)}</div></div>
<div class="nota">${nota}</div>`).replace('<!--x-->', fecha);
}

/* ---------- Textos para acompañar cada pieza ---------- */
const textoPromo = (p) => p.info === 'pasos' ? [`🎄 Así de fácil compras en DC Tecnology`, '1️⃣ Elige tu regalo en dctecnology.xyz o escríbenos', '2️⃣ Paga desde tu app: Nequi, Daviplata o Llave Bre-B', '3️⃣ Recíbelo: lo digital por WhatsApp al validar tu pago; la tecnología con envío a todo el país', '', `🛒 ${WEB}`, `💬 WhatsApp ${WA}`].join('\n')
    : p.info === 'razones' ? ['🎄 ¿Por qué DC Tecnology?', `💬 Te atendemos por WhatsApp: ${WA}`, '📱 Pagas desde tu app: Nequi, Daviplata o Llave Bre-B', '🚚 Envíos a todo el país; lo digital llega por WhatsApp', `🛠 Revisión de tu PC por ${cop(desde(porId['servicio-reparacion-repuestos']))}`, '', `🛒 ${WEB}`].join('\n')
        : [`🎄 ${p.titulo.replace(/<\/?em>/g, '')}`, p.sub, '', ...p.items.slice(0, 6).map((x) => `🎁 ${corto(x.nombre)}: ${precioTxt(x).toLowerCase()}`), '', `🛒 ${WEB}`, `💬 WhatsApp ${WA}`].join('\n');
const textoCuenta = (c) => [`🎄 ${c.grande} ${c.linea}${c.etiqueta !== 'Cuenta regresiva' ? ` · ${c.etiqueta}` : ''}`, `⭐ El regalo de hoy: ${corto(c.x.nombre)}`, c.x.s, `💰 ${precioTxt(c.x)}`,
    digital(c.x) ? '⚡ Llega por WhatsApp al validar tu pago' : '', `🛒 ${WEB}/p/${c.x.id}.html`, `💬 WhatsApp ${WA}`].filter(Boolean).join('\n');
const textoV2 = (x) => [`🎄 ${x.tema}: ${precioTxt(x).toLowerCase()}`, `${corto(x.nombre)} · ${x.s}`, '', ...x.b.map((b) => `✅ ${b}`), '', `🛒 ${WEB}/p/${x.id}.html`, `💬 WhatsApp ${WA}`].join('\n');
const TAGS = '#DCTecnology #Navidad2026 #RegalosDeNavidad #Colombia';

/* ---------- Piezas del día (rutas y textos) ---------- */
const VID = path.join(DESTINO, 'Videos 1080x1920');
const LAN = path.join(DESTINO, 'Lanzamiento 1080x1920');
// Festividades y oferta real (videos-diciembre.mjs --variante festivos): reemplazan el video de ese turno en su fecha
const FES = path.join(DESTINO, 'Festividades 1080x1920');
const FESTIVOS = {
    '2026-12-01': { hora: '12:30', archivo: 'F1-oferta-primera-compra', nombre: 'Oferta primera compra', t: '🎁 ¿Primera compra en DC Tecnology? Usa el código DCTECH2026 y tienes descuento en tu primera compra.\nPlataformas, pines y tecnología.' },
    '2026-12-07': { hora: '19:30', archivo: 'F2-noche-de-velitas', nombre: 'Noche de velitas', t: '🕯️ Feliz noche de velitas. Ilumina a los tuyos con un regalo: audífonos y relojes con envío a todo el país.' },
    '2026-12-09': { hora: '12:30', archivo: 'F1-oferta-primera-compra', nombre: 'Oferta primera compra', t: '🎁 ¿Primera compra? Código DCTECH2026 al pagar.' },
    '2026-12-12': { hora: '19:30', archivo: 'F3-amigo-secreto', nombre: 'Amigo secreto', t: '🤫 ¿Te tocó el amigo secreto? Regalos digitales que llegan por WhatsApp al validar tu pago.' },
    '2026-12-15': { hora: '19:30', archivo: 'F4-llego-la-prima', nombre: 'Llegó la prima', t: '💰 ¡Llegó la prima! Date el gusto: relojes inteligentes y el combo de plataformas.' },
    '2026-12-16': { hora: '19:30', archivo: 'F5-empieza-la-novena', nombre: 'Empieza la novena', t: '🎄 Empieza la novena: nueve días para regalar. Pines sin tarjeta de crédito.' },
    '2026-12-19': { hora: '12:30', archivo: 'F1-oferta-primera-compra', nombre: 'Oferta primera compra', t: '🎁 Código DCTECH2026: descuento en tu primera compra.' },
    '2026-12-24': { hora: '19:30', archivo: 'F6-nochebuena', nombre: 'Nochebuena', t: '🌟 ¿Te faltó un regalo? Lo digital llega por WhatsApp al validar tu pago. ¡Feliz Nochebuena!' },
    '2026-12-25': { hora: '12:30', archivo: 'F7-feliz-navidad', nombre: 'Feliz Navidad', t: '🎄 ¡Feliz Navidad! Gracias por confiar en DC Tecnology.' },
    '2026-12-31': { hora: '19:30', archivo: 'F8-feliz-2027', nombre: 'Feliz 2027', t: '🎆 ¡Feliz año nuevo! Arranca el 2027 con todo.' },
};
function piezas(p) {
    const lista = piezasBase(p); const fe = FESTIVOS[p.fecha];
    if (fe && p.fase === 'productos') { const k = lista.findIndex((x) => x.hora === fe.hora && x.tipo === 'video'); if (k >= 0) lista[k] = { hora: fe.hora, tipo: 'video', f: path.join(FES, `${fe.archivo}.mp4`), t: `${fe.t}\n\n🛒 ${WEB}\n💬 WhatsApp ${WA}`, nombre: `Especial: ${fe.nombre}` }; }
    return lista;
}
function piezasBase(p) {
    if (p.fase === 'expectativa') return [
        { hora: '07:30', tipo: 'imagen', f: path.join(CUENTA, `${p.fecha}.jpg`), t: [`✨ ${p.faltan === 1 ? 'Falta 1 día' : `Faltan ${p.faltan} días`} para la nueva era de DC Tecnology`, 'Estuvimos trabajando para darte un servicio más rápido y mejor.', '📅 Llega el 27 de noviembre', `💬 Guarda nuestro número: ${WA}`].join('\n'), nombre: `Expectativa: ${p.faltan === 1 ? 'falta 1 día' : `faltan ${p.faltan} días`}` },
        { hora: '19:30', tipo: 'video', f: path.join(LAN, `${p.video}.mp4`), t: [`✨ ${p.faltan === 1 ? 'Mañana todo cambia' : 'Estuvimos trabajando en algo grande'}`, 'Tecnología, plataformas, pines y servicio técnico, todo desde tu celular.', `💬 Guarda nuestro número: ${WA}`].join('\n'), nombre: `Video expectativa (${p.faltan === 1 ? '1 día' : `${p.faltan} días`})` },
    ];
    if (p.fase === 'lanzamiento') return [
        { hora: '07:30', tipo: 'imagen', f: path.join(CUENTA, `${p.fecha}.jpg`), t: ['🎉 ¡Bienvenido a la nueva era digital de DC Tecnology!', `⌚ Tecnología desde ${minimoTipo('tecnologia')} (envíos a todo el país)`, `🎬 Plataformas desde ${minimoTipo('streaming')} (llega por WhatsApp)`, `🎁 Pines desde ${minimoTipo('pines')}`, `🛠 Revisión de tu PC por ${cop(desde(porId['servicio-reparacion-repuestos']))}`, '', `🛒 ${WEB}`, `💬 WhatsApp ${WA}`].join('\n'), nombre: 'Bienvenida' },
        { hora: '12:30', tipo: 'video', f: path.join(LAN, 'L3-bienvenida-nueva-era.mp4'), t: ['🎉 Estuvimos trabajando para ti: bienvenido a la nueva era digital de DC Tecnology.', 'Tecnología · Plataformas · Pines · Servicio técnico, todo en un solo lugar.', '', `🛒 ${WEB}`, `💬 WhatsApp ${WA}`].join('\n'), nombre: 'Video bienvenida' },
        { hora: '15:00', tipo: 'imagen', f: path.join(PROMOS, 'como-comprar.jpg'), t: textoPromo(PROMO.find((x) => x.info === 'pasos')), nombre: 'Cómo comprar' },
        { hora: '19:30', tipo: 'video', f: path.join(LAN, 'L4-lo-que-vas-a-encontrar.mp4'), t: ['🎁 Esto es lo que vas a encontrar en DC Tecnology', `⌚ Tecnología desde ${minimoTipo('tecnologia')}`, `🎬 Plataformas desde ${minimoTipo('streaming')}`, `🎁 Pines desde ${minimoTipo('pines')}`, `💻 Licencias desde ${minimoTipo('licencias')}`, '', `🛒 ${WEB}`, `💬 WhatsApp ${WA}`].join('\n'), nombre: 'Video lo que vas a encontrar' },
        { hora: '21:00', tipo: 'video', f: path.join(LAN, 'L5-asi-de-facil-compras.mp4'), t: textoPromo(PROMO.find((x) => x.info === 'pasos')), nombre: 'Video así de fácil compras' },
    ];
    const v1 = p.video1 === 'resumen' ? { f: path.join(VID, '00-todo-el-catalogo-de-navidad.mp4'), t: `🎄 Todo para esta Navidad en DC Tecnology: ${datos.length} regalos entre tecnología, plataformas, pines y servicios.\n\n🛒 ${WEB}\n💬 WhatsApp ${WA}`, nombre: 'Resumen del catálogo' }
        : { f: path.join(VID, `${p.video1.archivo}.mp4`), t: p.video1.texto.replace(/#\S+/g, '').trim(), nombre: corto(p.video1.nombre) };
    return [
        { hora: '07:30', tipo: 'imagen', f: path.join(CUENTA, `${p.fecha}.jpg`), t: textoCuenta(p.cuenta), nombre: `Cuenta regresiva (${corto(p.cuenta.x.nombre)})` },
        { hora: '12:30', tipo: 'video', ...v1 },
        { hora: '15:00', tipo: 'imagen', f: path.join(DESTINO, 'Feed 1080x1350', `${p.feed.archivo}.jpg`), t: p.feed.texto.replace(/#\S+/g, '').trim(), nombre: corto(p.feed.nombre) },
        { hora: '19:30', tipo: 'video', f: path.join(VID, `${p.video2.archivo}-v2.mp4`), t: textoV2(p.video2), nombre: `${corto(p.video2.nombre)} (v2)` },
        { hora: '21:00', tipo: 'imagen', f: path.join(PROMOS, `${p.promo.id}.jpg`), t: textoPromo(p.promo), nombre: p.promo.titulo ? p.promo.titulo.replace(/<\/?em>/g, '') : p.promo.info === 'pasos' ? 'Cómo comprar' : 'Por qué DC Tecnology' },
    ];
}

if (args.includes('--probar')) {
    for (const p of plan) {
        if (p.fase !== 'productos') { console.log(`  ${p.fecha} · ${p.fase}${p.faltan ? ` (faltan ${p.faltan})` : ''} · ${piezas(p).map((x) => `${x.hora} ${x.tipo} ${x.nombre}`).join(' · ')}`); continue; }
        const ids = [p.video1 === 'resumen' ? 'resumen' : p.video1.id, p.video2.id, p.cuenta.x.id, p.feed.id];
        console.log(`  ${p.fecha} · ${p.cuenta.grande} ${p.cuenta.linea} · regalo del día: ${p.cuenta.x.id} (${digital(p.cuenta.x) ? 'digital' : p.cuenta.x.tipo}) · productos: ${ids.join(', ')} · promo: ${p.promo.id}`);
    }
    process.exit(0);
}

/* ---------- Publicar las piezas de HOY en estados de WhatsApp ---------- */
if (args.includes('--publicar')) {
    const { cargarEntorno, requerir } = require('./entorno.js');
    const env = cargarEntorno(); requerir(env, ['EVOLUTION_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCIA']);
    const EVO = env.EVOLUTION_URL.replace(/\/+$/, ''), INST = env.EVOLUTION_INSTANCIA;
    const evo = async (ruta, cuerpo, metodo = 'POST') => { const r = await fetch(`${EVO}${ruta}`, { method: metodo, headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' }, body: metodo === 'GET' ? undefined : JSON.stringify(cuerpo ?? {}), signal: AbortSignal.timeout(180000) }); const t = await r.text(); if (!r.ok) throw new Error(`Evolution ${r.status}: ${t.slice(0, 200)}`); return t ? JSON.parse(t) : {}; };
    const ahora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    const hoy = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
    const hhmm = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
    const p = plan.find((x) => x.fecha === hoy) ?? (args.includes('--dia') ? plan.find((x) => x.fecha === args[args.indexOf('--dia') + 1]) : null);
    if (!p) { console.log(`Hoy (${hoy}) no hay paquete (va del 25/11 al 31/12).`); process.exit(0); }
    const estado = await evo(`/instance/connectionState/${INST}`, null, 'GET');
    if (estado?.instance?.state !== 'open') { console.log(`WhatsApp no está conectado (${estado?.instance?.state}): no se publica. Vincúlalo con node herramientas/vincular-whatsapp.mjs`); process.exit(1); }
    const hechas = fs.existsSync(REGISTRO) ? JSON.parse(fs.readFileSync(REGISTRO, 'utf8')) : [];
    const todas = args.includes('--todo');
    const toca = piezas(p).filter((x, k) => (todas || x.hora <= hhmm) && !hechas.some((h) => h.fecha === p.fecha && h.k === k));
    if (!toca.length) { console.log(`Nada pendiente a las ${hhmm} (${p.fecha}).`); process.exit(0); }
    const contactos = await evo(`/chat/findContacts/${INST}`, {});
    const lista = [...new Set((Array.isArray(contactos) ? contactos : []).filter((c) => c.pushName && /^\d{8,15}@s\.whatsapp\.net$/.test(c.remoteJid ?? '')).map((c) => c.remoteJid))];
    if (!lista.length) throw new Error('Evolution no devolvió contactos: no se publica.');
    const servidor = http.createServer((req, res) => {
        const f = decodeURIComponent(req.url.slice(1)); if (!f.startsWith(DESTINO) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': f.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', 'Content-Length': fs.statSync(f).size }); fs.createReadStream(f).pipe(res);
    });
    await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
    try {
        for (const x of toca) {
            const k = piezas(p).findIndex((y) => y.f === x.f);
            if (!fs.existsSync(x.f)) { console.log(`⚠ falta ${x.f}: genera primero el paquete`); continue; }
            await evo(`/message/sendStatus/${INST}`, { type: x.tipo, content: `http://127.0.0.1:${servidor.address().port}/${encodeURIComponent(x.f)}`, caption: x.t, statusJidList: lista });
            hechas.push({ fecha: p.fecha, k, hora: x.hora, pieza: x.nombre, publicado: new Date().toISOString() });
            fs.mkdirSync(path.dirname(REGISTRO), { recursive: true }); fs.writeFileSync(REGISTRO, JSON.stringify(hechas, null, 1) + '\n');
            console.log(`✔ ${x.hora} ${x.tipo}: ${x.nombre} → estados (${lista.length} contactos)`);
            await new Promise((ok) => setTimeout(ok, 5000));
        }
    } finally { servidor.close(); }
    process.exit(0);
}

/* ---------- Generar imágenes nuevas (Chrome sin ventana) ---------- */
const TMP = path.join(RAIZ, 'herramientas', 'salida', 'paquete-html');
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
for (const d of [PROMOS, CUENTA]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); }
const trabajos = [
    ...PROMO.map((p) => ({ html: htmlPromo(p), alto: 1350, sale: path.join(PROMOS, `${p.id}.jpg`) })),
    ...plan.map((p) => ({ html: p.fase === 'expectativa' ? htmlExpectativa(p.faltan) : p.fase === 'lanzamiento' ? htmlBienvenida() : htmlCuenta(p.cuenta, p.fecha), alto: 1920, sale: path.join(CUENTA, `${p.fecha}.jpg`) })),
];
trabajos.forEach((t, i) => { t.tmp = path.join(TMP, `${i}.html`); fs.writeFileSync(t.tmp, t.html); });
const PUERTO = 9600 + Math.floor(Math.random() * 90);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', '--allow-file-access-from-files', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${path.join(TMP, 'perfil')}`, 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let pest; for (let i = 0; i < 80; i++) { try { pest = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); if (pest.some((t) => t.type === 'page')) break; } catch {} await esperar(250); }
const ws = new WebSocket(pest.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let n = 0; const pend = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const k = ++n; pend.set(k, r); ws.send(JSON.stringify({ id: k, method, params })); });
await cdp('Page.enable');
const fallas = [];
try {
    for (const t of trabajos) {
        await cdp('Emulation.setDeviceMetricsOverride', { width: 1080, height: t.alto, deviceScaleFactor: 1, mobile: false });
        await cdp('Page.navigate', { url: 'file:///' + t.tmp.replace(/\\/g, '/') });
        await esperar(900);
        const q = (await cdp('Runtime.evaluate', { expression: `Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 8000); }))]).then(() => JSON.stringify({ sinFoto: [...document.images].filter((i) => !(i.naturalWidth > 0)).length, desborda: document.querySelector('.pie').getBoundingClientRect().bottom > ${t.alto} + 2 }))`, awaitPromise: true, returnByValue: true })).result?.value;
        const c = JSON.parse(q ?? '{}'); if (c.sinFoto || c.desborda) fallas.push(`${path.basename(t.sale)}: ${c.sinFoto ? `${c.sinFoto} sin foto ` : ''}${c.desborda ? 'no cabe' : ''}`);
        await esperar(200);
        const img = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 90 });
        fs.writeFileSync(t.sale, Buffer.from(img.data, 'base64'));
    }
} finally { ws.close(); chrome.kill(); await new Promise((r) => { chrome.once('exit', r); setTimeout(r, 4000); }); }
console.log(`Imágenes nuevas: ${PROMO.length} promociones y ${plan.length} cuentas regresivas`);

/* ---------- Armar «Paquete diario» (una carpeta por día, archivos numerados por hora) ---------- */
fs.rmSync(PAQUETE, { recursive: true, force: true }); fs.mkdirSync(PAQUETE, { recursive: true });
const faltan = [];
const cal = ['CALENDARIO DE PUBLICIDAD · DC Tecnology · 25 de noviembre al 31 de diciembre de 2026',
    'Cada día: 2 videos + 3 imágenes. Horas sugeridas (Colombia): 07:30 · 12:30 · 15:00 · 19:30 · 21:00.',
    'Dónde: estados de WhatsApp (todo), historias y Reels de Instagram/Facebook (videos y cuenta regresiva), feed de Facebook/Instagram (imágenes 1080x1350), TikTok (videos).',
    'Automático en estados: node --use-system-ca herramientas/paquete-diario.mjs --publicar (o instala la tarea con --instalar).', ''];
const limpio = (s) => s.replace(/[\\/:*?"<>|]/g, '').slice(0, 60).trim();
for (const p of plan) {
    const dia = p.d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    const dir = path.join(PAQUETE, `${p.fecha} ${p.d.toLocaleDateString('es-CO', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')}`);
    fs.mkdirSync(dir, { recursive: true });
    const ps = piezas(p);
    const txt = [`PAQUETE DEL ${dia.toUpperCase()} · DC Tecnology`, ''];
    cal.push(`${p.fecha} (${dia}): ${ps.map((x) => `${x.hora} ${x.tipo} ${x.nombre}`).join(' · ')}`);
    ps.forEach((x, k) => {
        const nombre = `${k + 1} - ${x.hora.replace(':', 'h')} ${x.tipo} - ${limpio(x.nombre)}${path.extname(x.f)}`;
        if (!fs.existsSync(x.f)) { faltan.push(`${p.fecha}: ${path.basename(x.f)}`); } else {
            try { fs.linkSync(x.f, path.join(dir, nombre)); } catch { fs.copyFileSync(x.f, path.join(dir, nombre)); }
        }
        txt.push(`==== ${k + 1}. ${x.hora} · ${x.tipo.toUpperCase()} · ${x.nombre} (${nombre}) ====`, x.t, TAGS, '');
    });
    fs.writeFileSync(path.join(dir, 'TEXTOS DEL DIA.txt'), txt.join('\r\n'));
}
fs.writeFileSync(path.join(PAQUETE, 'CALENDARIO.txt'), cal.join('\r\n'));
// Plan de publicidad (HTML para leer en el celular o el computador): estrategia + calendario día a día
{
    const fila = (p) => { const ps = piezas(p); const etq = p.fase === 'expectativa' ? `Expectativa · faltan ${p.faltan}` : p.fase === 'lanzamiento' ? 'LANZAMIENTO' : FESTIVOS[p.fecha] ? `Especial: ${FESTIVOS[p.fecha].nombre}` : `${p.cuenta.grande} ${p.cuenta.linea}`;
        const dia = p.d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
        return `<article class="dia${p.fase !== 'productos' || FESTIVOS[p.fecha] ? ' esp' : ''}"><header><b>${esc(dia)}</b><span>${esc(etq)}</span></header><ol>${ps.map((x) => `<li><time>${x.hora}</time><i>${x.tipo === 'video' ? '🎬' : '🖼'}</i><div><b>${esc(x.nombre)}</b><small>${esc(x.t.split('\n')[0])}</small></div></li>`).join('')}</ol></article>`; };
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plan de publicidad · Diciembre 2026</title>
<style>body{margin:0;background:#0B0F1E;color:#EEF1F8;font:15px/1.5 Inter,system-ui,sans-serif}main{max-width:980px;margin:0 auto;padding:20px 16px 60px}h1{font:900 28px/1.1 system-ui;margin:8px 0}h1 em{color:#F2C14E;font-style:normal}h2{margin:34px 0 10px;font-size:19px;color:#F2C14E}
.tarj{background:#141A2E;border:1px solid #232B45;border-radius:16px;padding:16px 18px;margin:10px 0}ul{padding-left:20px;margin:6px 0}li{margin:4px 0}
.dia{background:#141A2E;border:1px solid #232B45;border-radius:16px;margin:12px 0;overflow:hidden}.dia.esp{border-color:#C8102E;box-shadow:0 0 0 1px #C8102E}
.dia header{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:10px 14px;background:#1B2340}.dia header b{text-transform:capitalize}.dia header span{color:#F2C14E;font-weight:700}
.dia ol{list-style:none;margin:0;padding:6px 10px}.dia li{display:flex;gap:10px;align-items:flex-start;padding:8px 4px;border-bottom:1px solid #1F2742}.dia li:last-child{border:0}
time{flex:none;width:46px;font-weight:800;color:#9FB0D9}i{font-style:normal}small{display:block;color:#9AA6C4}table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #232B45;text-align:left;vertical-align:top}</style></head><body><main>
<p style="color:#9AA6C4;margin:0">DC Tecnology · Plan de publicidad</p><h1>Diciembre <em>2026</em></h1>
<div class="tarj"><b>Objetivo:</b> vender más en la temporada navideña mostrando SOLO lo que hay: ${datos.length} productos y servicios (tecnología, plataformas, pines, licencias y servicio técnico), con precios vigentes y la marca en cada pieza.</div>
<h2>Cómo funciona</h2><div class="tarj"><ul>
<li><b>Fases:</b> 25 y 26 nov expectativa («Faltan 2 días», «Falta 1 día») · 27 nov lanzamiento (bienvenida, «Lo que vas a encontrar», «Así de fácil») · desde el 28 nov, paquete diario.</li>
<li><b>Cada día:</b> 2 videos con voz + 3 imágenes · 07:30 cuenta regresiva · 12:30 video · 15:00 producto · 19:30 video · 21:00 guía de regalos o «cómo comprar».</li>
<li><b>Dónde:</b> estados de WhatsApp (todo), Reels e historias de Instagram/Facebook y TikTok (videos y cuenta regresiva), feed de Facebook/Instagram (imágenes).</li>
<li><b>Fechas especiales:</b> oferta de primera compra (1, 9 y 19 dic, cupón real DCTECH2026), velitas (7), amigo secreto (12), prima (15), novena (16), Nochebuena (24), Navidad (25), Año Nuevo (31).</li>
<li><b>Desde el 18 dic</b> el regalo del día es digital: llega por WhatsApp al validar el pago (sin prometer envíos que no alcancen).</li>
<li><b>En la tienda:</b> «Encuentra el regalo perfecto» con enlaces directos para la publicidad: <code>dctecnology.xyz/#regalos?para=gamer</code> (también ninos, mama, el, ella, amigo, estudio) y <code>&hasta=20000</code>.</li>
<li><b>Reglas:</b> precios vigentes de la base · «Solo quedan N» solo con unidades reales · sin descuentos inventados · nunca se nombra al proveedor · cada locución se verifica (palabras completas, marca y precios).</li></ul></div>
<h2>Calendario día a día</h2>${plan.map(fila).join('')}
<p style="color:#9AA6C4">Archivos: Escritorio › Anuncios DC Tecnology › Diciembre 2026 › Paquete diario (una carpeta por día con los textos listos). Generado el ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}.</p></main></body></html>`;
    fs.writeFileSync(path.join(DESTINO, 'PLAN DE PUBLICIDAD DICIEMBRE 2026.html'), html);
}

fs.rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
console.log(`Listo: ${plan.length} días en ${PAQUETE} (${plan.length * 2} videos y ${plan.length * 3} imágenes programadas)`);
if (faltan.length) console.log(`⚠ Faltan ${faltan.length} archivos (¿ya corrió videos-diciembre.mjs?):\n  ${faltan.slice(0, 10).join('\n  ')}${faltan.length > 10 ? '\n  …' : ''}`);
if (fallas.length) { console.log(`⚠ Revisar ${fallas.length}:\n  ${fallas.join('\n  ')}`); process.exitCode = 1; }
