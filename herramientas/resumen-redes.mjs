// herramientas/resumen-redes.mjs — Resumen semanal por WhatsApp (T12): qué salió en cada red y en los estados los
// últimos 7 días, qué falló (con su motivo) y la campaña de la semana que empieza. Solo lo que está en los registros:
// las vistas y los seguidores necesitan las APIs de estadísticas (bloqueada B7), así que no se mencionan.
//
//   node herramientas/resumen-redes.mjs            → se lo envía al número de aviso (NUMERO_AVISO_ADMIN) por Evolution
//   node herramientas/resumen-redes.mjs --probar   → solo lo imprime
//   node herramientas/resumen-redes.mjs --instalar → tarea «DC Tecnology - resumen de redes» (lunes, 8:00 a. m.)
//
// Fuentes: herramientas/salida/redes-publicadas.json (lo publicado), redes.log (las fallas) y estados.json (estados).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { RAIZ, cargarEntorno } = require('./entorno.js');
const SALIDA = path.join(RAIZ, 'herramientas', 'salida');
const NOMBRES = { youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' };
const diaBogota = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const fechaTexto = (dia) => new Date(`${dia}T12:00:00-05:00`).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });

// Campaña de la semana de un día (lunes a domingo, en orden desde inicio_campanas; igual que publicar-estado.mjs)
export function campanaDe(plan, dia) {
    const dias = Math.floor((Date.parse(`${dia}T12:00:00-05:00`) - Date.parse(`${plan.inicio_campanas}T12:00:00-05:00`)) / 864e5);
    return plan.campanas[((Math.floor(dias / 7) % plan.campanas.length) + plan.campanas.length) % plan.campanas.length];
}

// Fallas en redes.log: "<ISO> <red>: FALLÓ <archivo> · <motivo>" o "<ISO> <red>: falta <archivo>"
export function fallasDelLog(texto, desde) {
    const fallas = [];
    for (const l of String(texto ?? '').split(/\r?\n/)) {
        const m = /^(\S+) (youtube|facebook|instagram|tiktok): (?:FALLÓ (\S+) · (.*)|falta (\S+))$/.exec(l);
        if (!m || !(Date.parse(m[1]) >= desde)) continue;
        fallas.push({ red: m[2], archivo: m[3] ?? m[5], motivo: m[4] ? m[4].slice(0, 120) : 'falta el video en la carpeta' });
    }
    return fallas;
}

export function armarResumen({ publicadas = {}, log = '', estados = { publicados: [] }, plan, ahora = Date.now() }) {
    const desde = ahora - 7 * 864e5;
    const hoy = diaBogota(ahora);
    // La semana que terminó ayer (el resumen sale el lunes antes del estado del día)
    const dias7 = Array.from({ length: 7 }, (_, i) => diaBogota(ahora - (7 - i) * 864e5));
    const lineas = ['📊 *Resumen semanal de redes · DC Tecnology*', `Del ${fechaTexto(dias7[0])} al ${fechaTexto(dias7[6])}`, ''];

    // Redes: lo publicado (redes-publicadas.json: "<fecha>|<red>" → { en, url… }) y lo que falló
    const hechos = Object.entries(publicadas).map(([k, v]) => ({ red: k.split('|')[1], ...v })).filter((x) => Date.parse(x.en) >= desde);
    const fallas = fallasDelLog(log, desde);
    lineas.push('📣 *Redes*');
    for (const red of Object.keys(NOMBRES)) {
        const ok = hechos.filter((x) => x.red === red).length, mal = fallas.filter((x) => x.red === red);
        if (!ok && !mal.length) continue;
        lineas.push(`• ${NOMBRES[red]}: ${ok} publicado${ok === 1 ? '' : 's'}${mal.length ? ` · ${mal.length} con falla` : ''}`);
        const motivos = [...new Set(mal.map((x) => x.motivo))].slice(0, 2);
        for (const m of motivos) lineas.push(`   ↳ ${m}`);
    }
    if (!hechos.length && !fallas.length) lineas.push('• No se publicó nada en redes (REDES_AUTOMATICAS apagado o sin claves).');

    // Estados de WhatsApp (estados.json)
    const estadosSemana = (estados.publicados ?? []).filter((p) => dias7.includes(p.fecha));
    const videos = estadosSemana.filter((p) => p.tipo === 'video');
    const promos = estadosSemana.filter((p) => p.tipo === 'promo');
    const sinEstado = dias7.filter((d) => !videos.some((p) => p.fecha === d));
    lineas.push('', '🟢 *Estados de WhatsApp*');
    lineas.push(`• ${videos.length} video${videos.length === 1 ? '' : 's'} de 7 días${promos.length ? ` · ${promos.length} promo de texto` : ''}`);
    const contactos = videos.map((p) => Number(p.contactos)).filter((n) => n > 0);
    if (contactos.length) lineas.push(`• Enviados a ${Math.max(...contactos).toLocaleString('es-CO')} contactos (el número de vistas no lo da WhatsApp)`);
    if (sinEstado.length) lineas.push(`• Días sin estado: ${sinEstado.map((d) => fechaTexto(d).split(',')[0]).join(', ')}`);

    // Campaña de la semana que empieza (el resumen sale los lunes)
    if (plan?.campanas?.length) lineas.push('', `🗓️ *Esta semana:* campaña «${campanaDe(plan, hoy).nombre}»`);
    return lineas.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    if (args.includes('--instalar')) {
        const tarea = 'DC Tecnology - resumen de redes';
        const ps = `$a = New-ScheduledTaskAction -Execute '${process.execPath}' -Argument '"${path.join(RAIZ, 'herramientas', 'resumen-redes.mjs')}"' -WorkingDirectory '${RAIZ}';
$t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At '08:00';
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10);
Register-ScheduledTask -TaskName '${tarea}' -Action $a -Trigger $t -Settings $s -Description 'Resumen semanal de redes y estados por WhatsApp (DC Tecnology).' -Force | Out-Null`;
        execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
        console.log(`Tarea "${tarea}" instalada: los lunes a las 8:00 a. m. (si el PC estaba apagado, corre al encender).`);
        process.exit(0);
    }
    const leer = (f, x) => { try { const t = fs.readFileSync(path.join(SALIDA, f), 'utf8'); return f.endsWith('.json') ? JSON.parse(t) : t; } catch { return x; } };
    const texto = armarResumen({
        publicadas: leer('redes-publicadas.json', {}), log: leer('redes.log', ''), estados: leer('estados.json', { publicados: [] }),
        plan: JSON.parse(fs.readFileSync(path.join(RAIZ, 'herramientas', 'estados-plan.json'), 'utf8')),
    });
    if (args.includes('--probar')) { console.log(texto); process.exit(0); }
    const env = cargarEntorno();
    const numero = String(env.NUMERO_AVISO_ADMIN ?? '').replace(/\D/g, '').replace(/^(3\d{9})$/, '57$1');
    if (!numero || !env.EVOLUTION_URL || !env.EVOLUTION_INSTANCIA) { console.error('Falta NUMERO_AVISO_ADMIN o EVOLUTION_* en .env'); process.exit(1); }
    const r = await fetch(`${env.EVOLUTION_URL.replace(/\/+$/, '')}/message/sendText/${env.EVOLUTION_INSTANCIA}`, {
        method: 'POST', headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: numero, text: texto }), signal: AbortSignal.timeout(30000),
    }).catch(() => null);
    console.log(`resumen de redes: ${r?.ok ? 'enviado' : 'no se pudo enviar'}`);
    if (!r?.ok) process.exit(1);
}
