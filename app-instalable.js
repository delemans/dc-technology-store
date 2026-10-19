// app-instalable.js — La tienda como app (instalar en el celular o el PC) y música tecnológica tenue opcional.
// La música se genera en el navegador (sin archivos ni derechos de autor), arranca APAGADA y solo suena
// si el visitante la enciende; se recuerda en este navegador (dc_musica) y se pausa al cambiar de pestaña.
(() => {
    'use strict';
    const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
    const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

    /* ---------- App instalable ---------- */
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
        addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
    }
    let aviso = null;
    const botonesInstalar = () => document.querySelectorAll('[data-instalar]');
    addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        aviso = e;
        botonesInstalar().forEach((b) => { b.hidden = false; });
    });
    addEventListener('appinstalled', () => { aviso = null; botonesInstalar().forEach((b) => { b.hidden = true; }); });
    document.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-instalar]') || !aviso) return;
        aviso.prompt();
        await aviso.userChoice.catch(() => {});
        aviso = null;
        botonesInstalar().forEach((b) => { b.hidden = true; });
    });
    // iPhone no tiene botón de instalar: se explica cómo hacerlo (solo en Safari y si no está instalada)
    const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (esIOS && !instalada) { const p = document.getElementById('ayuda-ios'); if (p) p.hidden = false; }

    /* ---------- Música de fondo (Web Audio) ---------- */
    const VOLUMEN = 0.05;
    let ctx = null, salida = null, temporizador = null, encendida = false;
    // Acordes suaves en La menor (Am9 → Fmaj7 → C → G6), frecuencias en Hz
    const ACORDES = [[110, 164.81, 196, 246.94], [87.31, 130.81, 164.81, 220], [130.81, 196, 246.94, 329.63], [98, 146.83, 196, 246.94]];
    const NOTAS = [440, 523.25, 587.33, 659.25, 783.99, 880];
    let paso = 0;

    function crear() {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        salida = ctx.createGain();
        salida.gain.value = 0;
        const filtro = ctx.createBiquadFilter();
        filtro.type = 'lowpass';
        filtro.frequency.value = 1400;
        // Eco suave: da la sensación de espacio "tecnológico"
        const eco = ctx.createDelay(1);
        eco.delayTime.value = 0.38;
        const reto = ctx.createGain();
        reto.gain.value = 0.32;
        eco.connect(reto).connect(eco);
        filtro.connect(salida);
        filtro.connect(eco);
        reto.connect(salida);
        salida.connect(ctx.destination);
        salida.filtro = filtro;
    }

    function tono(frec, inicio, duracion, nivel, tipo) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = tipo;
        o.frequency.value = frec;
        o.detune.value = (Math.random() - 0.5) * 8;
        g.gain.setValueAtTime(0, inicio);
        g.gain.linearRampToValueAtTime(nivel, inicio + Math.min(1.8, duracion / 3));
        g.gain.linearRampToValueAtTime(0, inicio + duracion);
        o.connect(g).connect(salida.filtro);
        o.start(inicio);
        o.stop(inicio + duracion + 0.05);
    }

    function compas() {
        const t = ctx.currentTime + 0.05;
        const acorde = ACORDES[paso % ACORDES.length];
        acorde.forEach((f) => tono(f, t, 8.4, 0.06, 'sine'));
        tono(acorde[0] / 2, t, 8.4, 0.05, 'triangle');
        // Pulsos cortos tipo "dato" (pocos y al azar, para que no canse)
        for (let i = 0; i < 4; i++) {
            if (Math.random() < 0.55) tono(NOTAS[Math.floor(Math.random() * NOTAS.length)], t + i * 2 + 0.5, 0.6, 0.025, 'sine');
        }
        paso += 1;
    }

    function pintar() {
        document.querySelectorAll('[data-musica]').forEach((b) => {
            b.setAttribute('aria-pressed', String(encendida));
            const i = b.querySelector('i');
            if (i) i.className = `fa-solid ${encendida ? 'fa-volume-low' : 'fa-volume-xmark'}`;
            const s = b.querySelector('span');
            if (s) s.textContent = encendida ? 'Música: encendida' : 'Música de fondo';
        });
    }

    function encender() {
        if (!ctx) crear();
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        salida.gain.cancelScheduledValues(ctx.currentTime);
        salida.gain.linearRampToValueAtTime(VOLUMEN, ctx.currentTime + 2.5);
        if (!temporizador) { compas(); temporizador = setInterval(compas, 8000); }
        encendida = true;
        pintar();
    }

    function apagar(recordar = true) {
        encendida = false;
        if (ctx) {
            salida.gain.cancelScheduledValues(ctx.currentTime);
            salida.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
            setTimeout(() => { if (!encendida) { clearInterval(temporizador); temporizador = null; ctx.suspend().catch(() => {}); } }, 900);
        }
        if (recordar) guardar('dc_musica', 'no');
        pintar();
    }

    document.addEventListener('click', (e) => {
        if (!e.target.closest('[data-musica]')) return;
        if (encendida) apagar();
        else { guardar('dc_musica', 'si'); encender(); }
    });
    // Si la dejó encendida antes, vuelve a sonar con su primer toque en la página (los navegadores lo exigen)
    if (leer('dc_musica') === 'si') {
        const primerToque = (e) => {
            if (e.target.closest?.('[data-musica]')) return;
            if (leer('dc_musica') === 'si' && !encendida) encender();
        };
        document.addEventListener('pointerdown', primerToque, { once: true });
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && encendida) { apagar(false); encendida = false; document.documentElement.dataset.musicaPausada = '1'; }
        else if (!document.hidden && document.documentElement.dataset.musicaPausada) { delete document.documentElement.dataset.musicaPausada; encender(); }
    });
    pintar();
})();
