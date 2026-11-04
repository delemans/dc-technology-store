// Rotación de estados y redes (herramientas/rotacion.js): no repetir tema dos días seguidos ni el mismo video en 28 días
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { elegirVideo, idDeArchivo, temaDe } = require('../../herramientas/rotacion.js');
const plan = JSON.parse(fs.readFileSync(new URL('../../herramientas/estados-plan.json', import.meta.url), 'utf8'));
const ok = (c, msg) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${msg}`); if (!c) process.exitCode = 1; };
const campana = (id) => plan.campanas.find((c) => c.id === id);

// Lo que pasó el 3 y el 4/11/2026: reparación dos días seguidos
ok(idDeArchivo(plan, '25-reparacion-computadores-sulafat.mp4') === 'reparacion-computadores' && idDeArchivo(plan, '403-srv-reparacion-charon.mp4') === 'srv-reparacion'
    && idDeArchivo(plan, '212-p-pin-virtual-disney-plus-1tpu5-iapetus.mp4') === 'p-pin-virtual-disney-plus-1tpu5', 'reconoce el video de cada archivo publicado');
ok(temaDe(plan, 'reparacion-computadores') === temaDe(plan, 'srv-reparacion') && temaDe(plan, 'ing-mantenimiento') === temaDe(plan, 'srv-mantenimiento'), 'reparación y mantenimiento comparten tema entre campañas');
{
    const historial = [{ fecha: '2026-11-03', archivo: '25-reparacion-computadores-sulafat.mp4' }];
    const c = { id: 'x', videos: ['srv-reparacion', 'srv-alquiler'] };
    ok(elegirVideo({ plan, campana: c, diaCampana: 0, historial, hoy: '2026-11-04' }) === 'srv-alquiler', 'el día después de reparación no sale otra vez reparación');
    ok(elegirVideo({ plan, campana: c, diaCampana: 0, historial, hoy: '2026-11-07' }) === 'srv-reparacion', 'tres días después el tema ya puede volver');
    ok(elegirVideo({ plan, campana: c, diaCampana: 0, historial: [{ fecha: '2026-10-20', video: 'srv-reparacion' }], hoy: '2026-11-04' }) === 'srv-alquiler', 'un video que salió hace menos de 28 días cede el turno');
    ok(elegirVideo({ plan, campana: { videos: ['srv-reparacion'] }, diaCampana: 0, historial, hoy: '2026-11-04' }) === 'srv-reparacion', 'si no hay otra opción, publica igual (nunca se queda sin estado)');
    ok(elegirVideo({ plan, campana: c, diaCampana: 0, historial, hoy: '2026-11-04', disponible: () => false }) === null, 'sin videos disponibles devuelve null');
}
ok(!plan.campanas.some((c) => new Set(c.videos).size !== c.videos.length), 'ninguna campaña repite un video dentro de la misma semana');
ok(!campana('servicios-dc').videos.includes('reparacion-computadores'), 'Servicios DC ya no trae dos videos de reparación');
ok(plan.videos.every((v) => v.tema), 'cada video del plan tiene tema');

// Simulación de 20 semanas desde el registro real: nunca el mismo tema dos días seguidos
{
    const historial = [];
    let repetidos = 0, video14 = 0;
    for (let n = 0; n < 140; n++) {
        const dias = n, semana = Math.floor(dias / 7), d = dias % 7;
        const hoy = new Date(Date.parse(`${plan.inicio_campanas}T12:00:00-05:00`) + n * 864e5).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        const id = elegirVideo({ plan, campana: plan.campanas[semana % plan.campanas.length], diaCampana: d, historial, hoy });
        const ayer = historial.at(-1);
        if (ayer && temaDe(plan, ayer.video) === temaDe(plan, id)) repetidos++;
        if (historial.slice(-13).some((h) => h.video === id)) video14++;
        historial.push({ fecha: hoy, video: id });
    }
    ok(repetidos === 0, `20 semanas simuladas: ${repetidos} días con el mismo tema que el día anterior`);
    ok(video14 === 0, `20 semanas simuladas: ${video14} videos repetidos en menos de 14 días`);
}
