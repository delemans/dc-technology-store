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
    const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (instalada) document.documentElement.classList.add('app-instalada');
    if (esIOS && !instalada) { const p = document.getElementById('ayuda-ios'); if (p) p.hidden = false; }

    // Aviso para instalar (una vez por visita, a los 12 s, y no se repite en 14 días si lo cierran)
    const hasta = Number(leer('dc_app_aviso')) || 0;
    const puedeAvisar = () => !instalada && Date.now() > hasta && !sessionStorage.getItem('dc_app_aviso_visto') && window.top === window;
    function mostrarAviso(ios) {
        if (!puedeAvisar() || document.querySelector('.aviso-app')) return;
        try { sessionStorage.setItem('dc_app_aviso_visto', '1'); } catch { /* nada */ }
        const caja = document.createElement('div');
        caja.className = 'aviso-app';
        caja.setAttribute('role', 'dialog');
        caja.setAttribute('aria-label', 'Instalar la app');
        caja.innerHTML = `<img src="img/logo-dc-192.png" alt="" width="44" height="44">
            <div><b>Instala la app DC Tecnology</b><span>${ios ? 'Toca <i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i> Compartir y luego «Agregar a inicio».' : 'Abre más rápido y tus pedidos a un toque. Gratis, sin tienda de apps.'}</span></div>
            ${ios ? '' : '<button type="button" class="aviso-app__si" data-instalar>Instalar</button>'}
            <button type="button" class="aviso-app__no" aria-label="Ahora no"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>`;
        document.body.appendChild(caja);
        requestAnimationFrame(() => caja.classList.add('ver'));
        const cerrar = (recordar) => { caja.classList.remove('ver'); setTimeout(() => caja.remove(), 300); if (recordar) guardar('dc_app_aviso', String(Date.now() + 14 * 864e5)); };
        caja.querySelector('.aviso-app__no').addEventListener('click', () => cerrar(true));
        caja.querySelector('[data-instalar]')?.addEventListener('click', () => setTimeout(() => cerrar(false), 200));
    }
    addEventListener('beforeinstallprompt', () => setTimeout(() => mostrarAviso(false), 12000));
    if (esIOS && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)) setTimeout(() => mostrarAviso(true), 12000);

    /* ---------- Música de fondo (Web Audio) · 24/11/2026: ritmo caribeño PROPIO (no usa canciones con derechos) ----------
       Patrón sincopado tipo dancehall a 96 ppm: bombo, caja, shaker, bajo y una melodía de «steel drum» original
       (pentatónica de La menor). Suave (volumen bajo) y por compases programados con anticipación (no se entrecorta). */
    const VOLUMEN = 0.06;
    const PPM = 96, PASO = 60 / PPM / 4, COMPAS = PASO * 16;
    let ctx = null, salida = null, temporizador = null, encendida = false, siguiente = 0, ruido = null;
    // Am – F – C – G (raíces del bajo en Hz) y notas de la melodía (La menor pentatónica)
    const RAICES = [55, 43.65, 65.41, 49];
    const ESCALA = [440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5];
    let paso = 0;

    function crear() {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        salida = ctx.createGain();
        salida.gain.value = 0;
        const filtro = ctx.createBiquadFilter();
        filtro.type = 'lowpass';
        filtro.frequency.value = 2600;
        const eco = ctx.createDelay(1);
        eco.delayTime.value = PASO * 3;
        const reto = ctx.createGain();
        reto.gain.value = 0.22;
        eco.connect(reto).connect(eco);
        filtro.connect(salida);
        filtro.connect(eco);
        reto.connect(salida);
        salida.connect(ctx.destination);
        salida.filtro = filtro;
        ruido = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = ruido.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const env = (g, t, v, a, dur) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur); };
    function bombo(t) { const o = ctx.createOscillator(); o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(45, t + 0.12); const g = ctx.createGain(); env(g, t, 0.9, 0.003, 0.28); o.connect(g).connect(salida.filtro); o.start(t); o.stop(t + 0.35); }
    function caja(t, v = 0.35) { const b = ctx.createBufferSource(); b.buffer = ruido; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8; const g = ctx.createGain(); env(g, t, v, 0.002, 0.12); b.connect(f).connect(g).connect(salida.filtro); b.start(t, Math.random() * 0.5); b.stop(t + 0.16); }
    function shaker(t, v) { const b = ctx.createBufferSource(); b.buffer = ruido; const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = ctx.createGain(); env(g, t, v, 0.004, 0.05); b.connect(f).connect(g).connect(salida.filtro); b.start(t, Math.random() * 0.5); b.stop(t + 0.07); }
    function bajo(t, fr, dur) { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = fr; const g = ctx.createGain(); env(g, t, 0.55, 0.01, dur); o.connect(g).connect(salida.filtro); o.start(t); o.stop(t + dur + 0.05); }
    function steel(t, fr) { [[1, 1], [2.01, 0.35], [3.9, 0.12]].forEach(([r, a]) => { const o = ctx.createOscillator(); o.frequency.value = fr * r; const g = ctx.createGain(); env(g, t, 0.16 * a, 0.004, 0.45); o.connect(g).connect(salida.filtro); o.start(t); o.stop(t + 0.5); }); }

    function compas(t) {
        const raiz = RAICES[paso % RAICES.length];
        for (let i = 0; i < 16; i++) {
            const tt = t + i * PASO;
            if (i % 4 === 0) bombo(tt);                       // bombo en cada tiempo
            if (i === 3 || i === 6 || i === 11 || i === 14) caja(tt); // caja sincopada (patrón dancehall)
            shaker(tt, i % 2 ? 0.05 : 0.09);
        }
        bajo(t, raiz, PASO * 5); bajo(t + PASO * 7, raiz, PASO * 2); bajo(t + PASO * 10, raiz * 1.5, PASO * 4);
        // melodía: pocas notas y con aire, distinta en cada compás
        for (let i = 0; i < 16; i += 2) if (Math.random() < (i % 4 ? 0.22 : 0.4)) steel(t + i * PASO, ESCALA[Math.floor(Math.random() * ESCALA.length)]);
        paso += 1;
    }
    // Programador: siempre deja el compás siguiente listo (el sonido no depende de los temporizadores del navegador)
    function programar() { while (siguiente < ctx.currentTime + COMPAS * 1.5) { compas(siguiente); siguiente += COMPAS; } }

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
        if (!temporizador) { siguiente = ctx.currentTime + 0.1; programar(); temporizador = setInterval(programar, 500); }
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
    // Suena sola con el primer toque en la página (los navegadores lo exigen), salvo que la persona la haya apagado.
    // Si la intro de la marca está en pantalla, espera a que termine para no pisar su sonido.
    if (leer('dc_musica') !== 'no') {
        const cuandoTermineIntro = (fn) => { if (!document.getElementById('dc-intro')) return fn(); const v = setInterval(() => { if (!document.getElementById('dc-intro')) { clearInterval(v); fn(); } }, 300); };
        const primerToque = (e) => {
            if (e.target.closest?.('[data-musica]')) return;
            document.removeEventListener('pointerdown', primerToque); document.removeEventListener('keydown', primerToque);
            cuandoTermineIntro(() => { if (leer('dc_musica') !== 'no' && !encendida) encender(); });
        };
        document.addEventListener('pointerdown', primerToque);
        document.addEventListener('keydown', primerToque);
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && encendida) { apagar(false); encendida = false; document.documentElement.dataset.musicaPausada = '1'; }
        else if (!document.hidden && document.documentElement.dataset.musicaPausada) { delete document.documentElement.dataset.musicaPausada; encender(); }
    });
    pintar();
})();
