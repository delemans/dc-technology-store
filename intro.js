// intro.js — Apertura de marca al entrar a la tienda (pedidos del director del 24/11/2026): estilo «apertura mágica»
// (cielo nocturno, un arco de luz que cruza sobre el logo dejando brillos, destello, «DC TECNOLOGY» y «dctecnology.xyz»)
// con un sonido PROPIO de la marca (barrido de destellos + acorde; original, sin recursos de terceros).
// Sale CADA VEZ que alguien entra desde afuera (no al navegar dentro del sitio), ~3,4 s, botón «Saltar», no bloquea la
// página (el contenido carga debajo). Sonido: se intenta al abrir (los navegadores lo permiten en sitios que la persona
// ya usa); si lo bloquean, suena al primer toque durante la intro, con la voz «DC Tecnology». Respeta «reducir movimiento».
// No sale en pruebas automáticas ni para buscadores (?sinintro la quita, ?intro la fuerza).
(() => {
    try {
        const q = new URLSearchParams(location.search);
        const forzar = q.has('intro');
        if (!forzar && (q.has('sinintro') || navigator.webdriver || /HeadlessChrome|Lighthouse|bot|crawl|spider/i.test(navigator.userAgent))) return;
        // navegación dentro del mismo sitio (volver del detalle de un producto, etc.): no se repite
        if (!forzar && document.referrer && new URL(document.referrer).origin === location.origin) return;
    } catch { /* si algo falla, igual se muestra */ }
    const menos = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const DUR = menos ? 1200 : 3400;

    const css = `
#dc-intro{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;overflow:hidden;cursor:pointer;
  background:radial-gradient(70% 55% at 50% 38%,#16234A 0%,#0A1230 45%,#03050F 100%);transition:opacity .5s ease,visibility .5s}
#dc-intro.fuera{opacity:0;visibility:hidden}
#dc-intro .dci-cielo i{position:absolute;border-radius:50%;background:#fff;opacity:0;animation:dci-tit 2.6s ease-in-out infinite}
#dc-intro .dci-niebla{position:absolute;left:-10%;right:-10%;bottom:-20%;height:55%;background:radial-gradient(60% 60% at 50% 100%,rgba(90,130,255,.28),transparent 70%);filter:blur(10px)}
#dc-intro .dci-centro{position:relative;margin-top:-16vh;display:flex;flex-direction:column;align-items:center;gap:16px}
#dc-intro svg.dci-arco{position:absolute;left:50%;top:50%;width:min(96vw,620px);height:auto;transform:translate(-50%,-64%);overflow:visible}
#dc-intro svg.dci-arco path{fill:none;stroke:url(#dci-g);stroke-width:5;stroke-linecap:round;stroke-dasharray:1000;stroke-dashoffset:1000;filter:drop-shadow(0 0 12px #FFE9A8) drop-shadow(0 0 30px rgba(120,160,255,.8));animation:dci-arco 1.6s .2s cubic-bezier(.55,.05,.25,1) forwards}
#dc-intro .dci-chispa-caja{position:absolute;left:50%;top:50%;width:620px;height:290px;transform:translate(-50%,-64%) scale(var(--k,1))}
#dc-intro .dci-chispa{position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 0 20px 9px #FFE9A8,0 0 60px 26px rgba(140,180,255,.65);offset-path:path('M 20 260 Q 310 -100 600 260');offset-distance:0%;opacity:0;animation:dci-chispa 1.6s .2s cubic-bezier(.55,.05,.25,1) forwards}
#dc-intro .dci-polvo{position:absolute;width:4px;height:4px;border-radius:50%;background:#FFF6D8;box-shadow:0 0 8px 2px #FFE9A8;opacity:0;animation:dci-polvo 1.4s ease-out forwards}
#dc-intro .dci-destello{position:absolute;left:50%;top:50%;width:520px;height:520px;margin:-260px 0 0 -260px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.95),rgba(255,233,168,.5) 25%,transparent 60%);opacity:0;transform:scale(.2);animation:dci-destello 1s .75s ease-out forwards}
#dc-intro img{position:relative;width:clamp(116px,28vw,180px);height:auto;border-radius:28%;background:#fff;box-shadow:0 0 0 6px #F2C14E,0 0 60px 10px rgba(255,233,168,.45),0 30px 70px -20px rgba(0,0,0,.9);opacity:0;transform:scale(.55);filter:brightness(2.2);animation:dci-logo 1.1s .8s cubic-bezier(.2,1.3,.4,1) forwards}
#dc-intro .dci-nombre{position:relative;font:900 clamp(36px,9vw,70px)/1 Outfit,system-ui,sans-serif;letter-spacing:.06em;color:#fff;white-space:nowrap;text-shadow:0 0 24px rgba(140,180,255,.55)}
#dc-intro .dci-nombre span{display:inline-block;opacity:0;transform:translateY(26px) scale(.9);animation:dci-letra .55s cubic-bezier(.2,1.25,.4,1) forwards}
#dc-intro .dci-nombre b{color:#F2C14E}
#dc-intro .dci-dominio{position:relative;font:800 clamp(18px,4.6vw,28px)/1 Outfit,system-ui,sans-serif;letter-spacing:.08em;color:#fff;opacity:0;animation:dci-sube .7s 1.85s cubic-bezier(.2,1.2,.4,1) forwards}
#dc-intro .dci-dominio b{color:#F2C14E}
#dc-intro .dci-lema{position:relative;font:700 clamp(11px,3vw,15px)/1.3 Inter,system-ui,sans-serif;letter-spacing:.26em;text-transform:uppercase;color:rgba(255,255,255,.7);opacity:0;animation:dci-in .7s 2.2s forwards}
#dc-intro .dci-saltar{position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));min-height:44px;padding:10px 18px;border:1px solid rgba(255,255,255,.25);border-radius:999px;background:rgba(255,255,255,.08);color:#fff;font:700 13px/1 Inter,system-ui,sans-serif;cursor:pointer}
#dc-intro .dci-sonido{position:absolute;left:16px;bottom:calc(28px + env(safe-area-inset-bottom));color:rgba(255,255,255,.6);font:600 12px/1 Inter,system-ui,sans-serif;letter-spacing:.06em;white-space:nowrap;opacity:0;animation:dci-in .5s 1s forwards}
#dc-intro.suena .dci-sonido{display:none}
@keyframes dci-arco{to{stroke-dashoffset:0}}
@keyframes dci-chispa{0%{opacity:0;offset-distance:0%}8%{opacity:1}92%{opacity:1}100%{opacity:0;offset-distance:100%}}
@keyframes dci-polvo{0%{opacity:0}15%{opacity:1}100%{opacity:0;transform:translateY(38px)}}
@keyframes dci-destello{40%{opacity:1}100%{opacity:0;transform:scale(1.25)}}
@keyframes dci-logo{to{opacity:1;transform:scale(1);filter:brightness(1)}}
@keyframes dci-letra{to{opacity:1;transform:none}}
@keyframes dci-sube{from{transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes dci-in{to{opacity:1}}
@keyframes dci-tit{0%,100%{opacity:0}50%{opacity:.9}}
@media (prefers-reduced-motion: reduce){#dc-intro *{animation-duration:.01s!important;animation-delay:0s!important}}`;
    const estilo = document.createElement('style');
    estilo.textContent = css;
    document.head.appendChild(estilo);

    // Brillos que deja la chispa a lo largo del arco (misma curva: M 20 260 Q 310 -100 600 260)
    const punto = (t) => ({ x: (1 - t) * (1 - t) * 20 + 2 * (1 - t) * t * 310 + t * t * 600, y: (1 - t) * (1 - t) * 260 + 2 * (1 - t) * t * -100 + t * t * 260 });
    const polvo = Array.from({ length: 26 }, (_, i) => { const t = (i + 1) / 27; const p = punto(t); return `<i class="dci-polvo" style="left:${p.x + (Math.random() * 16 - 8)}px;top:${p.y + (Math.random() * 16 - 8)}px;animation-delay:${0.2 + t * 1.5}s"></i>`; }).join('');
    const letras = (t, desde) => [...t].map((c, i) => `<span style="animation-delay:${desde + i * 0.05}s">${c === ' ' ? '&nbsp;' : c}</span>`).join('');
    const capa = document.createElement('div');
    capa.id = 'dc-intro';
    capa.setAttribute('role', 'presentation');
    capa.innerHTML = `<div class="dci-cielo" aria-hidden="true">${Array.from({ length: 60 }, () => { const s = 1 + Math.random() * 2.5; return `<i style="left:${Math.random() * 100}%;top:${Math.random() * 75}%;width:${s}px;height:${s}px;animation-delay:${Math.random() * 2.4}s"></i>`; }).join('')}</div>
<div class="dci-niebla" aria-hidden="true"></div>
<div class="dci-centro">
  <svg class="dci-arco" viewBox="0 0 620 290" aria-hidden="true"><defs><linearGradient id="dci-g" x1="0" x2="1"><stop offset="0" stop-color="#7FA2FF" stop-opacity="0"/><stop offset=".35" stop-color="#BFD0FF"/><stop offset=".7" stop-color="#FFE9A8"/><stop offset="1" stop-color="#FFFFFF"/></linearGradient></defs><path d="M 20 260 Q 310 -100 600 260"/></svg>
  <div class="dci-chispa-caja" aria-hidden="true"><div class="dci-chispa"></div>${polvo}</div>
  <div class="dci-destello" aria-hidden="true"></div>
  <img src="img/logo-dc-192.png" alt="">
  <div class="dci-nombre" aria-label="DC Tecnology">${letras('DC ', 1.2)}<b>${letras('TECNOLOGY', 1.32)}</b></div>
  <div class="dci-dominio">dctecnology<b>.xyz</b></div>
  <div class="dci-lema">Bienvenido a la nueva era digital</div>
</div>
<div class="dci-sonido" aria-hidden="true">🔊 Toca para escuchar</div>
<button type="button" class="dci-saltar">Saltar</button>`;
    const montar = () => document.body.prepend(capa);
    if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar, { once: true });
    const ajustar = () => { const a = capa.querySelector('svg.dci-arco'); const c = capa.querySelector('.dci-chispa-caja'); if (a && c) c.style.setProperty('--k', a.getBoundingClientRect().width / 620); };
    requestAnimationFrame(ajustar);

    let quitarEn = setTimeout(quitar, DUR);
    function quitar() {
        clearTimeout(quitarEn);
        capa.classList.add('fuera');
        setTimeout(() => { capa.remove(); estilo.remove(); }, 550);
    }
    capa.querySelector('.dci-saltar').addEventListener('click', (e) => { e.stopPropagation(); quitar(); });

    // Sonido de marca (original): barrido mágico de destellos que sube + acorde cálido que se abre + campanita final
    let ctx = null, sono = false;
    function sonido(desfase = 0) {
        if (sono || !ctx) return; sono = true; capa.classList.add('suena');
        const t0 = ctx.currentTime + 0.03 - Math.min(desfase, 0.25);
        const master = ctx.createGain(); master.gain.value = 0.55;
        const comp = ctx.createDynamicsCompressor(); master.connect(comp).connect(ctx.destination);
        const eco = ctx.createDelay(); eco.delayTime.value = 0.18; const ecoG = ctx.createGain(); ecoG.gain.value = 0.28; master.connect(eco); eco.connect(ecoG).connect(eco); ecoG.connect(comp);
        const nota = (t, m, v, d, tipo = 'sine') => {
            const f = 440 * Math.pow(2, (m - 69) / 12);
            [[1, 1], [2, 0.35], [3.01, 0.14]].forEach(([r, a]) => {
                const o = ctx.createOscillator(); o.type = tipo; o.frequency.value = f * r; const g = ctx.createGain();
                g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v * a, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
                o.connect(g).connect(master); o.start(t); o.stop(t + d + 0.05);
            });
        };
        // 1) barrido de destellos (sigue a la chispa por el arco)
        [72, 76, 79, 83, 84, 88, 91, 95, 96, 100].forEach((m, i) => nota(t0 + 0.2 + i * 0.13, m, 0.09, 0.9));
        // 2) acorde que se abre cuando aparece el logo (Re mayor con novena)
        const pad = ctx.createGain(); pad.gain.setValueAtTime(0.0001, t0 + 0.75); pad.gain.exponentialRampToValueAtTime(0.06, t0 + 1.3); pad.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.4);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1600; lp.connect(pad).connect(master);
        [50, 57, 62, 66, 69, 76].forEach((m) => [-6, 6].forEach((det) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12); o.detune.value = det; o.connect(lp); o.start(t0 + 0.75); o.stop(t0 + 3.5); }));
        // 3) campanita final con el nombre
        [86, 90, 93, 98].forEach((m, i) => nota(t0 + 1.3 + i * 0.06, m, 0.12, 1.8));
        try { const voz = new SpeechSynthesisUtterance('DC Tecnology'); voz.lang = 'en-US'; voz.rate = 0.92; voz.pitch = 1.05; setTimeout(() => speechSynthesis.speak(voz), 1300); } catch { /* sin voz */ }
    }
    const inicio = performance.now();
    try {
        const C = window.AudioContext || window.webkitAudioContext;
        ctx = new C();
        // Si el navegador ya permite sonido en este sitio, suena solo desde el principio
        ctx.resume().then(() => { if (ctx.state === 'running') sonido((performance.now() - inicio) / 1000); }).catch(() => {});
    } catch { ctx = null; }
    capa.addEventListener('pointerdown', () => {
        if (sono) return;
        try { if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; ctx = new C(); } ctx.resume(); } catch { return; }
        sonido(0);
        clearTimeout(quitarEn); quitarEn = setTimeout(quitar, 3000); // que alcance a sonar
    });
})();
