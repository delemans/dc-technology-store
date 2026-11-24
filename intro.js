// intro.js — Apertura de marca al entrar a la tienda (pedidos del director del 24/11/2026). Original de DC Tecnology,
// con los colores del sitio (oscuro + rojo #E03445/#FF2A5F + blanco), nunca colores ni sonidos de terceros:
//  1) El logo SE ARMA EN 3D con miles de partículas tomadas del propio logo, que llegan girando con perspectiva y estelas.
//  2) Destello + onda expansiva y el logo queda sólido en 3D (con volumen) y un brillo lo recorre.
//  3) «DC TECNOLOGY» letra a letra girando en 3D, «dctecnology.xyz» y lo que vende la tienda.
//  Sonido propio: ascenso que crece mientras se arma, impacto grave + acorde brillante, pitidos digitales por letra
//  y la bienvenida con voz natural grabada (audio/bienvenida.wav: «Bienvenido a la nueva era digital de DC Tecnology»). Los navegadores solo dejan sonar si el sitio ya tiene permiso o si la persona toca.
// Sale CADA VEZ que alguien entra desde afuera (no al navegar dentro del sitio), ~4,4 s, botón «Saltar»; no bloquea
// la carga de la tienda. Respeta «reducir movimiento». No sale en pruebas automáticas ni para buscadores
// (?sinintro la quita, ?intro la fuerza).
(() => {
    try {
        const q = new URLSearchParams(location.search);
        const forzar = q.has('intro');
        if (!forzar && (q.has('sinintro') || navigator.webdriver || /HeadlessChrome|Lighthouse|bot|crawl|spider/i.test(navigator.userAgent))) return;
        if (!forzar && document.referrer && new URL(document.referrer).origin === location.origin) return;
    } catch { /* si algo falla, igual se muestra */ }
    const menos = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ARMA = 1.9; // segundos que tarda el logo en armarse
    const DUR = menos ? 1400 : 4400;

    const css = `
#dc-intro{position:fixed;inset:0;z-index:2147483000;overflow:hidden;cursor:pointer;background:#07080C;transition:opacity .55s ease,visibility .55s}
#dc-intro.fuera{opacity:0;visibility:hidden}
#dc-intro .dci-aura{position:absolute;inset:-20%;background:radial-gradient(45% 35% at 50% 42%,rgba(224,52,69,.38),transparent 70%);opacity:0;animation:dci-aura 2.6s .2s ease-out forwards}
#dc-intro .dci-rejilla{position:absolute;left:-50%;right:-50%;bottom:-10%;height:55%;transform:perspective(500px) rotateX(62deg);transform-origin:50% 100%;opacity:0;
  background-image:linear-gradient(rgba(224,52,69,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(224,52,69,.35) 1px,transparent 1px);background-size:60px 60px;
  -webkit-mask:linear-gradient(transparent,#000 40%,#000 70%,transparent);mask:linear-gradient(transparent,#000 40%,#000 70%,transparent);animation:dci-rejilla 4s .1s ease-out forwards}
#dc-intro canvas{position:absolute;inset:0;width:100%;height:100%}
#dc-intro .dci-centro{position:absolute;left:50%;top:40%;transform:translate(-50%,calc(var(--tam) / -2));display:flex;flex-direction:column;align-items:center;gap:14px;width:100%;perspective:900px}
#dc-intro .dci-logo{position:relative;width:var(--tam);height:var(--tam);opacity:0;transform-style:preserve-3d}
#dc-intro .dci-logo img{position:absolute;inset:0;width:100%;height:100%;border-radius:26%;backface-visibility:hidden}
#dc-intro .dci-logo .dci-capa{position:absolute;inset:0;border-radius:26%;background:#7A0016}
#dc-intro .dci-logo .dci-luz{position:absolute;inset:0;border-radius:26%;overflow:hidden;transform:translateZ(2px)}
#dc-intro .dci-logo .dci-luz::after{content:'';position:absolute;top:-30%;bottom:-30%;width:35%;left:-60%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.75),transparent);transform:skewX(-18deg)}
#dc-intro.listo .dci-logo{opacity:1;animation:dci-gira 2.2s cubic-bezier(.2,.9,.25,1) forwards}
#dc-intro.listo .dci-logo .dci-luz::after{animation:dci-barre 1.1s .35s ease-in-out forwards}
#dc-intro .dci-onda{position:absolute;left:50%;top:40%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:3px solid #FF2A5F;box-shadow:0 0 30px #FF2A5F,inset 0 0 20px #FF2A5F;opacity:0}
#dc-intro.listo .dci-onda{animation:dci-onda 1s ease-out forwards}
#dc-intro .dci-flash{position:absolute;inset:0;background:radial-gradient(40% 30% at 50% 40%,#fff,rgba(255,42,95,.5) 40%,transparent 70%);opacity:0}
#dc-intro.listo .dci-flash{animation:dci-flash .6s ease-out forwards}
#dc-intro .dci-nombre{font:900 clamp(34px,9vw,72px)/1 Outfit,system-ui,sans-serif;letter-spacing:.06em;color:#fff;white-space:nowrap;text-shadow:0 0 26px rgba(255,42,95,.5);transform-style:preserve-3d}
#dc-intro .dci-nombre span{display:inline-block;opacity:0;transform:rotateX(90deg) translateY(20px);transform-origin:50% 100%}
#dc-intro.listo .dci-nombre span{animation:dci-letra .6s cubic-bezier(.2,1.3,.4,1) forwards}
#dc-intro .dci-nombre b{color:#E03445}
#dc-intro .dci-dominio{font:800 clamp(18px,4.8vw,30px)/1 Outfit,system-ui,sans-serif;letter-spacing:.08em;color:#fff;opacity:0}
#dc-intro .dci-dominio b{color:#FF2A5F}
#dc-intro .dci-lema{font:700 clamp(11px,3vw,15px)/1.4 Inter,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.72);opacity:0;text-align:center;padding:0 16px}
#dc-intro.listo .dci-dominio{animation:dci-sube .7s 1.05s cubic-bezier(.2,1.2,.4,1) forwards}
#dc-intro.listo .dci-lema{animation:dci-sube .7s 1.35s ease-out forwards}
#dc-intro .dci-saltar{position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));min-height:44px;padding:10px 18px;border:1px solid rgba(255,255,255,.25);border-radius:999px;background:rgba(255,255,255,.08);color:#fff;font:700 13px/1 Inter,system-ui,sans-serif;cursor:pointer;z-index:2}
#dc-intro .dci-sonido{position:absolute;left:16px;bottom:calc(28px + env(safe-area-inset-bottom));color:rgba(255,255,255,.6);font:600 12px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;white-space:nowrap;opacity:0;animation:dci-in .5s .8s forwards}
#dc-intro.suena .dci-sonido{display:none}
@keyframes dci-aura{50%{opacity:1}100%{opacity:.75}}
@keyframes dci-rejilla{30%{opacity:.55}100%{opacity:.25;background-position:0 120px}}
@keyframes dci-gira{0%{transform:rotateY(-35deg) rotateX(12deg) scale(.92)}60%{transform:rotateY(8deg) rotateX(-3deg) scale(1.04)}100%{transform:rotateY(0) rotateX(0) scale(1)}}
@keyframes dci-barre{to{left:130%}}
@keyframes dci-onda{0%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(42)}}
@keyframes dci-flash{0%{opacity:1}100%{opacity:0}}
@keyframes dci-letra{to{opacity:1;transform:none}}
@keyframes dci-sube{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes dci-in{to{opacity:1}}
@media (prefers-reduced-motion: reduce){#dc-intro *{animation-duration:.01s!important;animation-delay:0s!important}}`;
    const estilo = document.createElement('style');
    estilo.textContent = css;
    document.head.appendChild(estilo);

    const tam = Math.round(Math.min(190, Math.max(120, window.innerWidth * 0.32)));
    const letras = (t, desde) => [...t].map((c, i) => `<span style="animation-delay:${desde + i * 0.06}s">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
    const capas = Array.from({ length: 14 }, (_, i) => `<i class="dci-capa" style="transform:translateZ(${-(i + 1) * 1.6}px);filter:brightness(${1 - i * 0.04})"></i>`).join('');
    const capa = document.createElement('div');
    capa.id = 'dc-intro';
    capa.setAttribute('role', 'presentation');
    capa.innerHTML = `<div class="dci-aura" aria-hidden="true"></div><div class="dci-rejilla" aria-hidden="true"></div><canvas aria-hidden="true"></canvas>
<div class="dci-flash" aria-hidden="true"></div><div class="dci-onda" aria-hidden="true"></div>
<div class="dci-centro" style="--tam:${tam}px">
  <div class="dci-logo" aria-hidden="true">${capas}<img src="img/logo-dc-192.png" alt="" style="transform:translateZ(1px)"><i class="dci-luz"></i></div>
  <div class="dci-nombre" aria-label="DC Tecnology">${letras('DC ', 0.3)}<b>${letras('TECNOLOGY', 0.48)}</b></div>
  <div class="dci-dominio">dctecnology<b>.xyz</b></div>
  <div class="dci-lema">Tecnología · Plataformas · Pines · Servicio técnico</div>
</div>
<div class="dci-sonido" aria-hidden="true">🔊 Toca para escuchar</div>
<button type="button" class="dci-saltar">Saltar</button>`;
    const montar = () => document.body.prepend(capa);
    if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar, { once: true });

    let quitarEn = setTimeout(quitar, DUR + 900);
    let vivo = true;
    let finMin = 0; // si está sonando la bienvenida, la intro espera a que termine (salvo «Saltar»)
    function quitar(ya) {
        clearTimeout(quitarEn);
        if (ya !== true && performance.now() < finMin) { quitarEn = setTimeout(quitar, finMin - performance.now()); return; }
        vivo = false;
        capa.classList.add('fuera');
        setTimeout(() => { capa.remove(); estilo.remove(); }, 600);
    }
    capa.querySelector('.dci-saltar').addEventListener('click', (e) => { e.stopPropagation(); quitar(true); });
    const listo = () => { if (!capa.classList.contains('listo')) { capa.classList.add('listo'); clearTimeout(quitarEn); quitarEn = setTimeout(quitar, DUR - ARMA * 1000); } };

    // 1) Partículas: el logo se arma en 3D a partir de sus propios píxeles (en el mismo sitio donde queda el logo)
    const lienzo = capa.querySelector('canvas'); const g = lienzo.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0;
    const medir = () => { W = window.innerWidth; H = window.innerHeight; lienzo.width = W * dpr; lienzo.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    medir();
    const img = new Image();
    let parts = null, t0 = 0;
    img.onload = () => {
        try {
            const N = 96; const c = document.createElement('canvas'); c.width = N; c.height = N; const x = c.getContext('2d'); x.drawImage(img, 0, 0, N, N);
            const d = x.getImageData(0, 0, N, N).data; const paso = window.innerWidth < 700 ? 2 : 1.5; parts = [];
            for (let yy = 0; yy < N; yy += paso) for (let xx = 0; xx < N; xx += paso) {
                const k = (Math.floor(yy) * N + Math.floor(xx)) * 4; if (d[k + 3] < 140) continue;
                const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), r = 600 + Math.random() * 900;
                parts.push({ tx: (xx / N - 0.5) * tam, ty: (yy / N - 0.5) * tam, sx: r * Math.sin(ph) * Math.cos(th), sy: r * Math.sin(ph) * Math.sin(th), sz: r * Math.cos(ph),
                    c: `rgb(${d[k]},${d[k + 1]},${d[k + 2]})`, oscuro: d[k] + d[k + 1] + d[k + 2] < 120, rt: Math.random() * 0.35, tam: 1.2 + Math.random() * 1.6 });
            }
        } catch { parts = null; }
        t0 = performance.now(); if (!menos && parts) requestAnimationFrame(cuadro); else listo();
    };
    img.onerror = () => listo();
    img.src = 'img/logo-dc-192.png';
    setTimeout(() => { if (!t0) listo(); }, 1500);
    const ease = (x) => 1 - Math.pow(1 - x, 4);
    function cuadro(ahora) {
        if (!vivo) return;
        const t = (ahora - t0) / 1000;
        const logo = capa.querySelector('.dci-logo').getBoundingClientRect(); const cx = logo.left + logo.width / 2, cy = logo.top + logo.height / 2;
        g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(7,8,12,0.28)'; g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'lighter';
        const gira = (1 - ease(Math.min(1, t / ARMA))) * 2.4; const cosY = Math.cos(gira), sinY = Math.sin(gira);
        for (const p of parts) {
            const k = ease(Math.min(1, Math.max(0, (t - p.rt) / (ARMA - p.rt))));
            const x = p.sx + (p.tx - p.sx) * k, y = p.sy + (p.ty - p.sy) * k, z = p.sz * (1 - k);
            const xr = x * cosY - z * sinY, zr = x * sinY + z * cosY;
            const e = 700 / (700 + zr); if (e <= 0) continue;
            // en vuelo, los puntos oscuros del logo brillan en rojo; al llegar toman su color real
            g.fillStyle = k > 0.97 ? p.c : (p.oscuro ? '#FF2A5F' : p.c);
            const s = p.tam * e * (k > 0.97 ? 1.6 : 1);
            g.fillRect(cx + xr * e - s / 2, cy + y * e - s / 2, s, s);
        }
        if (t < ARMA + 0.05) requestAnimationFrame(cuadro);
        else { listo(); lienzo.style.transition = 'opacity .5s'; lienzo.style.opacity = '0'; }
    }
    window.addEventListener('resize', medir);

    // 2) Sonido de marca (original): ascenso → impacto con acorde → pitidos por letra → campana + voz
    let ctx = null, sono = false;
    function sonido(desfase = 0) {
        if (sono || !ctx) return; sono = true; capa.classList.add('suena');
        finMin = performance.now() + Math.max(0, (ARMA + 0.95 + 3.6 - desfase) * 1000);
        const t = ctx.currentTime + 0.03 - Math.min(desfase, 1.2);
        const master = ctx.createGain(); master.gain.value = 0.6; const comp = ctx.createDynamicsCompressor(); master.connect(comp).connect(ctx.destination);
        const eco = ctx.createDelay(); eco.delayTime.value = 0.22; const ecoG = ctx.createGain(); ecoG.gain.value = 0.25; master.connect(eco); eco.connect(ecoG).connect(eco); ecoG.connect(comp);
        const ruido = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate); const nd = ruido.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
        // ascenso: ruido filtrado que abre + tono que sube
        const n = ctx.createBufferSource(); n.buffer = ruido; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
        bp.frequency.setValueAtTime(220, t); bp.frequency.exponentialRampToValueAtTime(7000, t + ARMA);
        const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.35, t + ARMA - 0.1); ng.gain.exponentialRampToValueAtTime(0.0001, t + ARMA + 0.15);
        n.connect(bp).connect(ng).connect(master); n.start(t); n.stop(t + ARMA + 0.3);
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(560, t + ARMA);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(300, t); lp.frequency.exponentialRampToValueAtTime(3000, t + ARMA);
        const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.12, t + ARMA - 0.2); og.gain.exponentialRampToValueAtTime(0.0001, t + ARMA + 0.1);
        o.connect(lp).connect(og).connect(master); o.start(t); o.stop(t + ARMA + 0.2);
        // impacto: golpe grave + ruido + acorde brillante que se abre
        const ti = t + ARMA;
        const k = ctx.createOscillator(); k.frequency.setValueAtTime(95, ti); k.frequency.exponentialRampToValueAtTime(32, ti + 0.6);
        const kg = ctx.createGain(); kg.gain.setValueAtTime(1, ti); kg.gain.exponentialRampToValueAtTime(0.0001, ti + 1.1); k.connect(kg).connect(master); k.start(ti); k.stop(ti + 1.2);
        const b = ctx.createBufferSource(); b.buffer = ruido; const bl = ctx.createBiquadFilter(); bl.type = 'lowpass'; bl.frequency.value = 2500;
        const bg = ctx.createGain(); bg.gain.setValueAtTime(0.4, ti); bg.gain.exponentialRampToValueAtTime(0.0001, ti + 0.5); b.connect(bl).connect(bg).connect(master); b.start(ti); b.stop(ti + 0.6);
        const pad = ctx.createGain(); pad.gain.setValueAtTime(0.0001, ti); pad.gain.exponentialRampToValueAtTime(0.09, ti + 0.08); pad.gain.exponentialRampToValueAtTime(0.0001, ti + 2.4);
        const pl = ctx.createBiquadFilter(); pl.type = 'lowpass'; pl.frequency.setValueAtTime(800, ti); pl.frequency.exponentialRampToValueAtTime(5000, ti + 0.5); pl.connect(pad).connect(master);
        [50, 57, 62, 66, 69, 74, 76].forEach((m) => [-7, 7].forEach((det) => { const v = ctx.createOscillator(); v.type = 'sawtooth'; v.frequency.value = 440 * Math.pow(2, (m - 69) / 12); v.detune.value = det; v.connect(pl); v.start(ti); v.stop(ti + 2.5); }));
        // sello sonoro de DC Tecnology: dos golpes graves con cuerpo («ta-dum»), el segundo más alto y largo
        [[ti, 38, 0.9, 1.0], [ti + 0.34, 45, 1, 2.2]].forEach(([tt, m, v, d]) => {
            const f0 = 440 * Math.pow(2, (m - 69) / 12);
            [[1, 1], [2, 0.5], [3, 0.28], [4.01, 0.16], [6.02, 0.07]].forEach(([r, a]) => { const o2 = ctx.createOscillator(); o2.type = r === 1 ? 'triangle' : 'sine'; o2.frequency.value = f0 * r; const g2 = ctx.createGain();
                g2.gain.setValueAtTime(0.0001, tt); g2.gain.exponentialRampToValueAtTime(0.32 * v * a, tt + 0.015); g2.gain.exponentialRampToValueAtTime(0.0001, tt + d); o2.connect(g2).connect(master); o2.start(tt); o2.stop(tt + d + 0.05); });
            const k2 = ctx.createOscillator(); k2.frequency.setValueAtTime(120, tt); k2.frequency.exponentialRampToValueAtTime(40, tt + 0.25); const kg2 = ctx.createGain(); kg2.gain.setValueAtTime(0.8 * v, tt); kg2.gain.exponentialRampToValueAtTime(0.0001, tt + 0.45); k2.connect(kg2).connect(master); k2.start(tt); k2.stop(tt + 0.5);
        });
        // pitidos digitales por letra (DC TECNOLOGY)
        [81, 83, 86, 88, 90, 93, 95, 98, 100, 102, 105].forEach((m, i) => {
            const tt = ti + 0.3 + i * 0.06; const v = ctx.createOscillator(); v.type = 'square'; v.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
            const vg = ctx.createGain(); vg.gain.setValueAtTime(0.0001, tt); vg.gain.exponentialRampToValueAtTime(0.025, tt + 0.005); vg.gain.exponentialRampToValueAtTime(0.0001, tt + 0.09);
            v.connect(vg).connect(master); v.start(tt); v.stop(tt + 0.1);
        });
        // campana final
        [86, 93, 98].forEach((m, i) => { const tt = ti + 1.05 + i * 0.05; const v = ctx.createOscillator(); v.frequency.value = 440 * Math.pow(2, (m - 69) / 12); const vg = ctx.createGain();
            vg.gain.setValueAtTime(0.0001, tt); vg.gain.exponentialRampToValueAtTime(0.12, tt + 0.01); vg.gain.exponentialRampToValueAtTime(0.0001, tt + 1.8); v.connect(vg).connect(master); v.start(tt); v.stop(tt + 1.9); });
        // bienvenida con voz natural (audio/bienvenida.wav, voz grave de Gemini verificada): cuando aparece el mensaje
        vozLista.then((buf) => { if (!buf) return; const src = ctx.createBufferSource(); src.buffer = buf; const vg = ctx.createGain(); vg.gain.value = 1.25; src.connect(vg).connect(comp); src.start(Math.max(ctx.currentTime + 0.02, ti + 0.95)); }).catch(() => {});
    }
    const inicio = performance.now();
    let vozLista = Promise.resolve(null);
    const cargarVoz = () => { vozLista = fetch('audio/bienvenida.wav').then((r) => (r.ok ? r.arrayBuffer() : null)).then((a) => (a ? ctx.decodeAudioData(a) : null)).catch(() => null); };
    try { const C = window.AudioContext || window.webkitAudioContext; ctx = new C(); cargarVoz(); ctx.resume().then(() => { if (ctx.state === 'running') sonido((performance.now() - inicio) / 1000); }).catch(() => {}); } catch { ctx = null; }
    capa.addEventListener('pointerdown', () => {
        if (sono) return;
        try { if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; ctx = new C(); cargarVoz(); } ctx.resume(); } catch { return; }
        sonido((performance.now() - inicio) / 1000);
        clearTimeout(quitarEn); quitarEn = setTimeout(quitar, 4600); // que alcance a sonar el sello y la bienvenida
    });
})();
