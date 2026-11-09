// T12 · Resumen semanal de redes y estados con registros de ejemplo (sin enviar nada)
const m = await import(new URL('../../herramientas/resumen-redes.mjs', import.meta.url).href);
const ok = (c, msg) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${msg}`); if (!c) process.exitCode = 1; };
const plan = { inicio_campanas: '2026-10-19', campanas: [{ nombre: 'A' }, { nombre: 'B' }, { nombre: 'C' }, { nombre: 'D' }] };
const ahora = Date.parse('2026-11-09T13:00:00Z'); // lunes 9/11, 8 a. m. en Colombia
const publicadas = {
    '2026-11-03T17:30:00.000Z|youtube': { en: '2026-11-03T17:41:00Z', url: 'https://youtu.be/x' },
    '2026-11-04T17:30:00.000Z|youtube': { en: '2026-11-04T17:41:00Z' },
    '2026-11-04T17:30:00.000Z|facebook': { en: '2026-11-04T17:42:00Z' },
    '2026-10-20T17:30:00.000Z|youtube': { en: '2026-10-20T17:41:00Z' }, // semana vieja: no cuenta
};
const log = [
    '2026-11-04T17:43:00.000Z instagram: FALLÓ 601-x.mp4 · Instagram: 400 {"message":"Invalid user id"}',
    '2026-11-05T17:43:00.000Z instagram: FALLÓ 602-x.mp4 · Instagram: 400 {"message":"Invalid user id"}',
    '2026-11-06T17:43:00.000Z tiktok: falta 603-x.mp4',
    '2026-10-01T17:43:00.000Z facebook: FALLÓ viejo.mp4 · antiguo',
    '2026-11-05T17:40:00.000Z youtube: publicado 602-x.mp4 {}',
].join('\n');
const estados = { publicados: [
    { fecha: '2026-11-02', tipo: 'video', contactos: 1200 }, { fecha: '2026-11-02', tipo: 'promo', contactos: 1200 },
    { fecha: '2026-11-03', tipo: 'video', contactos: 1210 }, { fecha: '2026-11-05', tipo: 'video', contactos: 1217 },
    { fecha: '2026-11-06', tipo: 'video' }, { fecha: '2026-11-07', tipo: 'video' }, { fecha: '2026-11-08', tipo: 'video' },
    { fecha: '2026-11-09', tipo: 'video' }, // hoy: es de la semana nueva
] };
const t = m.armarResumen({ publicadas, log, estados, plan, ahora });
ok(/Del lunes, 2 de noviembre al domingo, 8 de noviembre/.test(t), 'la semana que terminó ayer');
ok(/• YouTube: 2 publicados\n/.test(t) && /• Facebook: 1 publicado\n/.test(t), 'cuenta lo publicado por red (sin la semana vieja)');
ok(/• Instagram: 0 publicados · 2 con falla\n   ↳ Instagram: 400 \{"message":"Invalid user id"\}/.test(t) && (t.match(/Invalid user id/g) ?? []).length === 1, 'fallas con su motivo, sin repetirlo');
ok(/• TikTok: 0 publicados · 1 con falla\n   ↳ falta el video en la carpeta/.test(t), 'video faltante');
ok(!/antiguo/.test(t), 'fallas viejas no cuentan');
ok(/• 6 videos de 7 días · 1 promo de texto/.test(t) && /1\.217 contactos/.test(t) && /Días sin estado: miércoles/.test(t), 'estados: videos, promo, contactos y días sin estado');
ok(m.campanaDe(plan, '2026-11-09').nombre === 'D' && /campaña «D»/.test(t) && m.campanaDe(plan, '2026-11-16').nombre === 'A', 'campaña de la semana que empieza (3 semanas desde el 19/10 → la 4.ª; luego vuelve a la primera)');
ok(!/vista|seguidor|alcance|me gusta/i.test(t.replace('el número de vistas no lo da WhatsApp', '')), 'sin métricas inventadas');
const vacio = m.armarResumen({ plan, ahora });
ok(/No se publicó nada en redes/.test(vacio) && /0 videos de 7 días/.test(vacio), 'sin registros: lo dice tal cual');
