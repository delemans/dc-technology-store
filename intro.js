// intro.js — Apertura de marca al entrar a la tienda (pedidos del director del 24/11/2026). Original de DC Tecnology, con
// los colores del sitio (oscuro + rojo #E03445/#FF2A5F + blanco); nunca colores ni sonidos de terceros. Lenguaje visual
// de interfaz tecnológica (sin rebotes ni efectos de diapositiva):
//  0,0 s  ARRANQUE: línea de escaneo, circuitos que se dibujan, consola «DC://INIT … %».
//  0,9 s  ENSAMBLE: miles de partículas del propio logo llegan en 3D con profundidad mientras giran anillos HUD.
//  2,9 s  NÚCLEO: impacto, falla RGB breve y el logo queda nítido con destello de lente.
//  3,2 s  DESCIFRADO: «DC TECNOLOGY» se descifra carácter por carácter; luego dctecnology.xyz y el lema.
// Sonido propio (~6 s): zumbido de arranque + señales de datos, ascenso con pulsos que se aceleran, impacto grave de dos
// golpes («ta-dum») + campana metálica, chasquidos del descifrado, cola atmosférica y la bienvenida con voz natural
// (audio/bienvenida.wav). Los navegadores solo dejan sonar si el sitio ya tiene permiso o si la persona toca.
// Sale CADA VEZ que alguien entra desde afuera (no al navegar dentro del sitio), botón «Saltar», no bloquea la carga.
// Respeta «reducir movimiento». No sale en pruebas automáticas ni para buscadores (?sinintro la quita, ?intro la fuerza).
(() => {
    try {
        const q = new URLSearchParams(location.search);
        const forzar = q.has('intro');
        if (!forzar && (q.has('sinintro') || navigator.webdriver || /HeadlessChrome|Lighthouse|bot|crawl|spider/i.test(navigator.userAgent))) return;
        if (!forzar && document.referrer && new URL(document.referrer).origin === location.origin) return;
    } catch { /* si algo falla, igual se muestra */ }
    const menos = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const T_ARMA = 0.9, T_NUCLEO = 2.9, T_TEXTO = 3.2, DUR = menos ? 1600 : 5600;
    const ROJO = '#E03445', NEON = '#FF2A5F';

    const css = `
#dc-intro{position:fixed;inset:0;z-index:2147483000;overflow:hidden;cursor:pointer;background:#050608;transition:opacity .6s ease,visibility .6s;font-family:Inter,system-ui,sans-serif}
#dc-intro.fuera{opacity:0;visibility:hidden}
#dc-intro canvas{position:absolute;inset:0;width:100%;height:100%}
#dc-intro .dci-vineta{position:absolute;inset:0;background:radial-gradient(70% 60% at 50% 42%,transparent 40%,rgba(0,0,0,.75));pointer-events:none}
#dc-intro .dci-ruido{position:absolute;inset:-50%;opacity:.06;pointer-events:none;background-image:repeating-linear-gradient(0deg,rgba(255,255,255,.5) 0 1px,transparent 1px 3px);animation:dci-lineas .4s steps(2) infinite}
#dc-intro .dci-consola{position:absolute;left:18px;top:calc(16px + env(safe-area-inset-top));font:600 11px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;color:rgba(255,90,110,.85);letter-spacing:.08em;white-space:pre;text-shadow:0 0 8px rgba(255,42,95,.6)}
#dc-intro .dci-centro{position:absolute;left:50%;top:41%;transform:translate(-50%,calc(var(--tam) / -2));display:flex;flex-direction:column;align-items:center;gap:12px;width:100%}
#dc-intro .dci-logo{position:relative;width:var(--tam);height:var(--tam);opacity:0}
#dc-intro .dci-logo img{position:absolute;inset:0;width:100%;height:100%;border-radius:24%;box-shadow:0 0 0 2px rgba(255,255,255,.18),0 0 40px rgba(255,42,95,.55),0 0 120px rgba(224,52,69,.35)}
#dc-intro .dci-logo .dci-r,#dc-intro .dci-logo .dci-b{position:absolute;inset:0;border-radius:24%;background:url(img/logo-dc-192.png) center/cover;mix-blend-mode:screen;opacity:0}
#dc-intro .dci-logo .dci-r{filter:sepia(1) saturate(9) hue-rotate(-40deg)}#dc-intro .dci-logo .dci-b{filter:sepia(1) saturate(9) hue-rotate(160deg)}
#dc-intro.nucleo .dci-logo{opacity:1;animation:dci-entra .5s cubic-bezier(.2,.8,.2,1) both}
#dc-intro.nucleo .dci-logo .dci-r{animation:dci-rgb-r .45s steps(6) both}#dc-intro.nucleo .dci-logo .dci-b{animation:dci-rgb-b .45s steps(6) both}
#dc-intro.nucleo .dci-logo img{animation:dci-revela .7s cubic-bezier(.6,0,.2,1) both,dci-corte .4s .7s steps(5) both}
#dc-intro .dci-escaneo{position:absolute;left:-12%;right:-12%;height:3px;top:0;background:#fff;box-shadow:0 0 14px 4px #FF2A5F,0 0 40px 10px rgba(255,42,95,.6);opacity:0}
#dc-intro.nucleo .dci-escaneo{animation:dci-escaneo .7s cubic-bezier(.6,0,.2,1) both}
#dc-intro .dci-escena{position:absolute;inset:0;perspective:1100px}
#dc-intro .dci-centro{transition:transform .25s ease-out}
#dc-intro .dci-brillo{position:absolute;inset:-6px;border-radius:26%;overflow:hidden;pointer-events:none}
#dc-intro .dci-brillo::after{content:'';position:absolute;top:-40%;bottom:-40%;width:28%;left:-50%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.85),transparent);transform:skewX(-20deg)}
#dc-intro.nucleo .dci-brillo::after{animation:dci-barre 1s .55s cubic-bezier(.6,0,.2,1) forwards}
#dc-intro .dci-destello{position:absolute;left:50%;top:41%;width:900px;height:4px;margin:-2px 0 0 -450px;background:linear-gradient(90deg,transparent,rgba(255,42,95,.0),#fff,rgba(255,42,95,.0),transparent);filter:blur(1px);opacity:0}
#dc-intro.nucleo .dci-destello{animation:dci-destello 1.1s ease-out forwards}
#dc-intro .dci-nombre{font:800 clamp(30px,8.4vw,66px)/1 ui-monospace,"Outfit",Consolas,monospace;letter-spacing:.14em;color:#fff;white-space:nowrap;text-shadow:0 0 18px rgba(255,42,95,.45);min-height:1em}
#dc-intro .dci-nombre .r{color:${ROJO}}#dc-intro .dci-nombre .x{color:rgba(255,90,110,.55)}
#dc-intro .dci-linea{width:0;height:2px;background:linear-gradient(90deg,transparent,${NEON},transparent)}
#dc-intro.texto .dci-linea{animation:dci-linea .8s .5s ease-out forwards}
#dc-intro .dci-dominio{font:700 clamp(15px,4vw,22px)/1 ui-monospace,Consolas,monospace;letter-spacing:.22em;color:rgba(255,255,255,.92);opacity:0}
#dc-intro .dci-dominio b{color:${NEON};font-weight:700}
#dc-intro .dci-lema{font:600 clamp(10px,2.8vw,13px)/1.4 Inter,system-ui,sans-serif;letter-spacing:.3em;text-transform:uppercase;color:rgba(255,255,255,.62);opacity:0;text-align:center;padding:0 16px}
#dc-intro.texto .dci-dominio{animation:dci-in .5s 1.15s ease-out forwards}
#dc-intro.texto .dci-lema{animation:dci-in .6s 1.5s ease-out forwards}
#dc-intro .dci-saltar{position:absolute;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));min-height:44px;padding:10px 18px;border:1px solid rgba(255,255,255,.22);border-radius:10px;background:rgba(255,255,255,.05);color:#fff;font:600 12px/1 ui-monospace,Consolas,monospace;letter-spacing:.12em;cursor:pointer;z-index:2}
#dc-intro .dci-sonido{position:absolute;left:18px;bottom:calc(30px + env(safe-area-inset-bottom));color:rgba(255,255,255,.55);font:600 11px/1 ui-monospace,Consolas,monospace;letter-spacing:.1em;white-space:nowrap;opacity:0;animation:dci-in .4s .6s forwards}
#dc-intro.suena .dci-sonido{display:none}
@keyframes dci-lineas{to{transform:translateY(3px)}}
@keyframes dci-entra{from{transform:scale(1.08);filter:brightness(2.4) blur(2px)}to{transform:none;filter:none}}
@keyframes dci-rgb-r{0%{opacity:.9;transform:translate(-9px,2px)}50%{opacity:.7;transform:translate(6px,-3px)}100%{opacity:0;transform:none}}
@keyframes dci-rgb-b{0%{opacity:.9;transform:translate(9px,-2px)}50%{opacity:.7;transform:translate(-6px,3px)}100%{opacity:0;transform:none}}
@keyframes dci-corte{0%{clip-path:inset(10% 0 55% 0)}25%{clip-path:inset(60% 0 8% 0)}50%{clip-path:inset(30% 0 35% 0)}75%{clip-path:inset(0 0 70% 0)}100%{clip-path:inset(0)}}
@keyframes dci-barre{to{left:130%}}
@keyframes dci-revela{from{clip-path:inset(0 0 100% 0);filter:brightness(2.2)}to{clip-path:inset(0);filter:none}}
@keyframes dci-escaneo{0%{opacity:1;top:0}90%{opacity:1;top:100%}100%{opacity:0;top:100%}}
@keyframes dci-destello{0%{opacity:0;transform:scaleX(.1)}20%{opacity:1}100%{opacity:0;transform:scaleX(1.6)}}
@keyframes dci-linea{to{width:min(70vw,420px)}}
@keyframes dci-in{to{opacity:1}}
@media (prefers-reduced-motion: reduce){#dc-intro *{animation-duration:.01s!important;animation-delay:0s!important}}`;
    const estilo = document.createElement('style');
    estilo.textContent = css;
    document.head.appendChild(estilo);

    const tam = Math.round(Math.min(180, Math.max(118, window.innerWidth * 0.3)));
    const capa = document.createElement('div');
    capa.id = 'dc-intro';
    capa.setAttribute('role', 'presentation');
    capa.innerHTML = `<canvas aria-hidden="true"></canvas><div class="dci-ruido" aria-hidden="true"></div><div class="dci-vineta" aria-hidden="true"></div>
<div class="dci-consola" aria-hidden="true"></div><div class="dci-destello" aria-hidden="true"></div>
<div class="dci-centro" style="--tam:${tam}px">
  <div class="dci-logo" aria-hidden="true"><img src="img/logo-dc-192.png" alt=""><i class="dci-r"></i><i class="dci-b"></i><i class="dci-brillo"></i><i class="dci-escaneo"></i></div>
  <div class="dci-nombre" aria-label="DC Tecnology"></div>
  <div class="dci-linea" aria-hidden="true"></div>
  <div class="dci-dominio">dctecnology<b>.xyz</b></div>
  <div class="dci-lema">Tecnología · Plataformas · Pines · Servicio técnico</div>
</div>
<div class="dci-sonido" aria-hidden="true">🔊 TOCA PARA ACTIVAR EL SONIDO</div>
<button type="button" class="dci-saltar">SALTAR ›</button>`;
    const montar = () => document.body.prepend(capa);
    const centro = capa.querySelector('.dci-centro');
    let incX = 0, incY = 0;
    capa.addEventListener('pointermove', (e) => { incY = (e.clientX / window.innerWidth - 0.5) * 16; incX = -(e.clientY / window.innerHeight - 0.5) * 12; });
    window.addEventListener('deviceorientation', (e) => { if (e.gamma != null) { incY = Math.max(-10, Math.min(10, e.gamma / 3)); incX = Math.max(-8, Math.min(8, (e.beta - 45) / 4)); } });
    if (document.body) montar(); else document.addEventListener('DOMContentLoaded', montar, { once: true });

    let vivo = true, finMin = 0;
    let quitarEn = setTimeout(quitar, DUR);
    function quitar(ya) {
        clearTimeout(quitarEn);
        if (ya !== true && performance.now() < finMin) { quitarEn = setTimeout(quitar, finMin - performance.now()); return; }
        vivo = false; sonidoSalida(); capa.classList.add('fuera');
        setTimeout(() => { capa.remove(); estilo.remove(); }, 650);
    }
    capa.querySelector('.dci-saltar').addEventListener('click', (e) => {
        e.stopPropagation();
        // «Saltar» es un toque: deja sonar el efecto de salida aunque el sonido aún no se hubiera activado
        try { if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; ctx = new C(); } ctx.resume(); } catch { /* sin audio */ }
        quitar(true);
    });
    // Efecto de salida (original): barrido de aire que se abre hacia la tienda + golpe suave + brillo final
    let salio = false;
    function sonidoSalida() {
        if (salio || !ctx || ctx.state !== 'running') return; salio = true;
        try {
            const t = ctx.currentTime + 0.02, sr = ctx.sampleRate;
            const out = ctx.createGain(); out.gain.value = 0.55; out.connect(ctx.destination);
            const ruido = ctx.createBuffer(2, sr * 1.2, sr); for (let c = 0; c < 2; c++) { const d = ruido.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
            // barrido de aire (de grave a brillante, abierto en estéreo)
            const n = ctx.createBufferSource(); n.buffer = ruido; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
            bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(6000, t + 0.55);
            const gn = ctx.createGain(); gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(0.4, t + 0.22); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
            n.connect(bp).connect(gn).connect(out); n.start(t); n.stop(t + 0.8);
            // golpe suave con cuerpo
            const k = ctx.createOscillator(); k.frequency.setValueAtTime(110, t + 0.18); k.frequency.exponentialRampToValueAtTime(48, t + 0.45);
            const gk = ctx.createGain(); gk.gain.setValueAtTime(0.0001, t + 0.18); gk.gain.exponentialRampToValueAtTime(0.5, t + 0.2); gk.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
            k.connect(gk).connect(out); k.start(t + 0.18); k.stop(t + 0.65);
            // brillo final (tres notas de cristal que suben)
            [86, 93, 98].forEach((m, i) => { const tt = t + 0.3 + i * 0.06; const o = ctx.createOscillator(); o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
                const p = ctx.createStereoPanner(); p.pan.value = [-0.5, 0.5, 0][i]; const g = ctx.createGain();
                g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(0.08, tt + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.1);
                o.connect(g).connect(p).connect(out); o.start(tt); o.stop(tt + 1.2); });
        } catch { /* sin audio */ }
    }

    // Consola de arranque
    const consola = capa.querySelector('.dci-consola');
    const lineas = ['DC://SISTEMA', '> iniciando núcleo', '> enlazando catálogo', '> cifrado TLS ✓', '> pagos Nequi · Daviplata · Bre-B ✓'];
    // Descifrado del nombre
    const nombre = capa.querySelector('.dci-nombre');
    const OBJ = 'DC TECNOLOGY', SIMB = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&@<>/\\=+';
    function descifrar(t) {
        const fijos = Math.floor(Math.max(0, t - T_TEXTO) / 0.07);
        nombre.innerHTML = [...OBJ].map((c, i) => {
            if (c === ' ') return '&nbsp;';
            if (i < fijos) return i >= 3 ? `<span class="r">${c}</span>` : c;
            return `<span class="x">${SIMB[Math.floor(Math.random() * SIMB.length)]}</span>`;
        }).join('');
        return fijos >= OBJ.length;
    }

    // Lienzo: circuitos, escaneo, anillos HUD y partículas del logo
    const lienzo = capa.querySelector('canvas'); const g = lienzo.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0;
    const medir = () => { W = window.innerWidth; H = window.innerHeight; lienzo.width = W * dpr; lienzo.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    medir(); window.addEventListener('resize', medir);
    const azar = (() => { let s = 7; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); })();
    const pistas = Array.from({ length: 22 }, () => { // circuitos que nacen en los bordes y van hacia el centro
        const lado = Math.floor(azar() * 4); let x = lado === 0 ? 0 : lado === 1 ? 1 : azar(), y = lado === 2 ? 0 : lado === 3 ? 1 : azar();
        const pts = [[x, y]]; for (let k = 0; k < 4; k++) { if (k % 2) x += (0.5 - x) * (0.3 + azar() * 0.4); else y += (0.42 - y) * (0.3 + azar() * 0.4); pts.push([x, y]); }
        return { pts, d: azar() * 0.5 };
    });
    const estrellas = Array.from({ length: window.innerWidth < 700 ? 320 : 520 }, () => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random() * 1 + 0.05, b: Math.random() < 0.25 }));
    let zPrev = 0;
    const img = new Image(); let parts = null;
    img.onload = () => {
        try {
            const N = 96; const c = document.createElement('canvas'); c.width = N; c.height = N; const x = c.getContext('2d'); x.drawImage(img, 0, 0, N, N);
            const d = x.getImageData(0, 0, N, N).data; const paso = window.innerWidth < 700 ? 2 : 1.5; parts = [];
            for (let yy = 0; yy < N; yy += paso) for (let xx = 0; xx < N; xx += paso) {
                const k = (Math.floor(yy) * N + Math.floor(xx)) * 4; if (d[k + 3] < 140) continue;
                const th = Math.random() * Math.PI * 2, r = 380 + Math.random() * 700;
                parts.push({ tx: (xx / N - 0.5) * tam, ty: (yy / N - 0.5) * tam, sx: Math.cos(th) * r, sy: Math.sin(th) * r * 0.6, sz: -600 + Math.random() * 1400,
                    c: `rgb(${d[k]},${d[k + 1]},${d[k + 2]})`, oscuro: d[k] + d[k + 1] + d[k + 2] < 120, rt: Math.random() * 0.5, s: 0.9 + Math.random() * 1.4 });
            }
        } catch { parts = null; }
    };
    img.src = 'img/logo-dc-192.png';
    const t0 = performance.now();
    const suave = (x) => (x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x));
    const sale = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 4);
    let nucleo = false, texto = false;
    function cuadro(ahora) {
        if (!vivo) return;
        const t = (ahora - t0) / 1000;
        const L = capa.querySelector('.dci-logo').getBoundingClientRect(); const cx = L.left + L.width / 2, cy = L.top + L.height / 2;
        g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(5,6,8,0.32)'; g.fillRect(0, 0, W, H);
        // circuitos que se dibujan hacia el centro
        g.lineWidth = 1.2; g.strokeStyle = `rgba(224,52,69,${0.55 * (1 - suave((t - 3.4) / 1.2))})`; g.shadowColor = NEON; g.shadowBlur = 6;
        for (const p of pistas) {
            const k = sale((t - p.d) / 1.6); if (k <= 0) continue; const n = p.pts.length - 1; const hasta = k * n;
            g.beginPath(); g.moveTo(p.pts[0][0] * W, p.pts[0][1] * H);
            for (let i = 1; i <= Math.ceil(hasta); i++) { const a = p.pts[i - 1], b = p.pts[i]; const f = Math.min(1, hasta - (i - 1)); g.lineTo((a[0] + (b[0] - a[0]) * f) * W, (a[1] + (b[1] - a[1]) * f) * H); }
            g.stroke();
            const ult = p.pts[Math.min(n, Math.ceil(hasta))]; if (k < 1) { g.fillStyle = '#fff'; g.fillRect(ult[0] * W - 1.5, ult[1] * H - 1.5, 3, 3); }
        }
        g.shadowBlur = 0;
        // hiperespacio: velocidad que sube, luego frena al formarse el logo
        const vel = t < 1.1 ? suave(t / 1.1) * 1.6 : 1.6 * (1 - suave((t - 1.1) / (T_NUCLEO - 1.0)));
        const aW = 1 - suave((t - (T_NUCLEO - 0.4)) / 0.6);
        if (aW > 0) {
            const dt = Math.min(0.05, Math.max(0.001, t - zPrev)); zPrev = t; const foco = Math.max(W, H) * 0.55;
            g.lineCap = 'round';
            for (const e of estrellas) {
                const z0 = e.z; e.z -= vel * dt * 0.9; if (e.z <= 0.03) { e.z = 1 + Math.random() * 0.3; e.x = (Math.random() - 0.5) * 2; e.y = (Math.random() - 0.5) * 2; continue; }
                const x1 = cx + (e.x / z0) * foco * 0.35, y1 = cy + (e.y / z0) * foco * 0.35, x2 = cx + (e.x / e.z) * foco * 0.35, y2 = cy + (e.y / e.z) * foco * 0.35;
                const a = Math.min(1, (1 - e.z) * 1.4) * aW;
                g.strokeStyle = e.b ? `rgba(255,255,255,${a})` : `rgba(255,42,95,${a * 0.9})`; g.lineWidth = Math.max(0.6, (1 - e.z) * 2.6);
                g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
            }
        }
        // escena: inclinación 3D (mouse / celular) + deriva suave
        centro.style.transform = `translate(-50%, calc(var(--tam) / -2)) perspective(1100px) rotateX(${(incX + Math.sin(t * 0.9) * 2).toFixed(2)}deg) rotateY(${(incY + Math.cos(t * 0.7) * 3).toFixed(2)}deg)`;
        // línea de escaneo
        if (t < 1.2) { const y = sale(t / 1.1) * H; const gr = g.createLinearGradient(0, y - 60, 0, y); gr.addColorStop(0, 'rgba(255,42,95,0)'); gr.addColorStop(1, 'rgba(255,42,95,.35)'); g.fillStyle = gr; g.fillRect(0, y - 60, W, 60); g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(0, y, W, 1); }
        // anillos HUD
        const aH = suave((t - 0.6) / 0.6) * (1 - 0.85 * suave((t - T_TEXTO) / 0.6));
        if (aH > 0) {
            g.save(); g.translate(cx, cy); g.globalAlpha = aH; g.lineWidth = 1.5;
            [[tam * 0.95, 1.1, [40, 18]], [tam * 1.18, -0.7, [6, 10]], [tam * 1.42, 0.45, [120, 40, 10, 40]]].forEach(([r, vel, dash], i) => {
                g.setLineDash(dash); g.strokeStyle = i === 1 ? 'rgba(255,255,255,.45)' : 'rgba(255,42,95,.7)'; g.beginPath(); g.arc(0, 0, r, t * vel, t * vel + Math.PI * 1.6 * suave((t - 0.6) / 1)); g.stroke();
            });
            g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.5)';
            for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2 - t * 0.2; const r1 = tam * 1.55, r2 = r1 + (i % 4 ? 5 : 12); g.beginPath(); g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); g.stroke(); }
            g.restore(); g.globalAlpha = 1;
        }
        // partículas del logo
        if (parts && t >= T_ARMA - 0.2 && t < T_NUCLEO + 0.4) {
            g.globalCompositeOperation = 'lighter';
            const gira = (1 - sale((t - T_ARMA) / (T_NUCLEO - T_ARMA))) * 1.8; const cs = Math.cos(gira), sn = Math.sin(gira);
            for (const p of parts) {
                const k = sale((t - T_ARMA - p.rt * 0.6) / (T_NUCLEO - T_ARMA - p.rt * 0.6));
                const x = p.sx + (p.tx - p.sx) * k, y = p.sy + (p.ty - p.sy) * k, z = p.sz * (1 - k);
                const xr = x * cs - z * sn, zr = x * sn + z * cs; const e = 800 / (800 + zr); if (e <= 0) continue;
                const desenfoque = Math.min(1, Math.abs(zr) / 700); // profundidad de campo: lejos = más grande y tenue
                g.globalAlpha = 0.35 + 0.65 * (1 - desenfoque);
                g.fillStyle = k > 0.96 ? p.c : (p.oscuro ? NEON : p.c);
                const s = p.s * e * (1 + desenfoque * 2);
                g.fillRect(cx + xr * e - s / 2, cy + y * e - s / 2, s, s);
            }
            g.globalAlpha = 1;
        }
        // consola
        const pct = Math.min(100, Math.round(suave(t / T_NUCLEO) * 100));
        consola.textContent = t < 3.6 ? `${lineas.slice(0, Math.min(lineas.length, Math.floor(t / 0.45) + 1)).join('\n')}\n> cargando ${String(pct).padStart(3, ' ')}% ${'█'.repeat(Math.round(pct / 10))}${'░'.repeat(10 - Math.round(pct / 10))}` : '';
        if (!nucleo && t >= T_NUCLEO) { nucleo = true; capa.classList.add('nucleo'); }
        if (!texto && t >= T_TEXTO) { texto = true; capa.classList.add('texto'); }
        if (t >= T_TEXTO - 0.3) descifrar(t);
        requestAnimationFrame(cuadro);
    }
    if (menos) { capa.classList.add('nucleo', 'texto'); nombre.innerHTML = 'DC <span class="r">TECNOLOGY</span>'; }
    else requestAnimationFrame(cuadro);

    // Sello sonoro de DC Tecnology (original, estéreo, ~6 s): carga de energía → impacto en capas → firma de 3 notas
    // de cristal → cola de destellos; después, la bienvenida con voz natural.
    let ctx = null, sono = false;
    function sonido(desfase = 0) {
        if (sono || !ctx) return; sono = true; capa.classList.add('suena');
        finMin = performance.now() + Math.max(0, (T_NUCLEO + 0.95 + 3.6 - desfase) * 1000);
        const t = ctx.currentTime + 0.03 - Math.min(desfase, 2.5);
        const ti = t + T_NUCLEO; // instante en que aparece el logo
        const sr = ctx.sampleRate;
        const m2f = (m) => 440 * Math.pow(2, (m - 69) / 12);
        // Bus maestro: compresor tipo limitador + reverberación estéreo decorrelacionada (sala grande y brillante)
        const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.15; lim.connect(ctx.destination);
        const master = ctx.createGain(); master.gain.value = 0.7; master.connect(lim);
        const imp = ctx.createBuffer(2, sr * 3.8, sr);
        for (let c = 0; c < 2; c++) { const d = imp.getChannelData(c); let s = c ? 13 : 7; for (let i = 0; i < d.length; i++) { s = (s * 16807) % 2147483647; const tt = i / sr; d[i] = ((s / 2147483647) * 2 - 1) * Math.pow(1 - i / d.length, 2.2) * (tt < 0.012 ? tt / 0.012 : 1); } }
        const rev = ctx.createConvolver(); rev.buffer = imp; const revG = ctx.createGain(); revG.gain.value = 0.42; const revHp = ctx.createBiquadFilter(); revHp.type = 'highpass'; revHp.frequency.value = 250;
        revHp.connect(rev).connect(revG).connect(lim);
        const envio = (nodo, cant) => { const g = ctx.createGain(); g.gain.value = cant; nodo.connect(g).connect(revHp); };
        const ruido = ctx.createBuffer(2, sr * 4, sr); for (let c = 0; c < 2; c++) { const d = ruido.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
        const curva = (g, pts) => { g.gain.setValueAtTime(0.0001, pts[0][0]); for (const [tt, v] of pts.slice(1)) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v), tt); };
        const pan = (v) => { const p = ctx.createStereoPanner(); p.pan.value = v; return p; };

        // 1) CARGA DE ENERGÍA (0 → logo): barrido FM que sube + platillo invertido + descenso grave
        {
            const car = ctx.createOscillator(); car.type = 'sawtooth'; car.frequency.setValueAtTime(m2f(26), t + 0.3); car.frequency.exponentialRampToValueAtTime(m2f(62), ti);
            const mod = ctx.createOscillator(); mod.frequency.setValueAtTime(m2f(26) * 0.5, t + 0.3); mod.frequency.exponentialRampToValueAtTime(m2f(62) * 0.5, ti);
            const mg = ctx.createGain(); mg.gain.setValueAtTime(30, t + 0.3); mg.gain.exponentialRampToValueAtTime(900, ti); mod.connect(mg).connect(car.frequency);
            const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 8; lp.frequency.setValueAtTime(180, t + 0.3); lp.frequency.exponentialRampToValueAtTime(6500, ti);
            const g = ctx.createGain(); curva(g, [[t + 0.3], [ti - 0.15, 0.11], [ti + 0.05, 0.0001]]);
            car.connect(lp).connect(g).connect(master); envio(g, 0.3); car.start(t + 0.3); mod.start(t + 0.3); car.stop(ti + 0.1); mod.stop(ti + 0.1);
            // platillo invertido (el aire que «se aspira» hacia el impacto), abierto en estéreo
            [-0.6, 0.6].forEach((pv, i) => { const n = ctx.createBufferSource(); n.buffer = ruido; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.setValueAtTime(2500, ti - 1.4); hp.frequency.exponentialRampToValueAtTime(7000, ti);
                const gn = ctx.createGain(); gn.gain.setValueAtTime(0.0001, ti - 1.4); gn.gain.exponentialRampToValueAtTime(0.2, ti - 0.02); gn.gain.linearRampToValueAtTime(0.0001, ti); n.connect(hp).connect(gn).connect(pan(pv)).connect(master); n.start(ti - 1.4, i * 0.7); n.stop(ti + 0.02); });
            // descenso grave que «cae» en el impacto
            const sub = ctx.createOscillator(); sub.frequency.setValueAtTime(70, ti - 0.9); sub.frequency.exponentialRampToValueAtTime(34, ti); const sg = ctx.createGain(); curva(sg, [[ti - 0.9], [ti - 0.05, 0.35], [ti + 0.01, 0.0001]]); sub.connect(sg).connect(master); sub.start(ti - 0.9); sub.stop(ti + 0.05);
            // señales de datos sutiles durante el arranque
            for (let i = 0; i < 18; i++) { const tt = t + 0.15 + (i / 18) * (T_NUCLEO - 0.5) + Math.random() * 0.08; const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(1400 + Math.random() * 2600, tt); o.frequency.exponentialRampToValueAtTime(600 + Math.random() * 3000, tt + 0.05);
                const gg = ctx.createGain(); curva(gg, [[tt], [tt + 0.003, 0.03], [tt + 0.06, 0.0001]]); o.connect(gg).connect(pan(Math.random() * 1.6 - 0.8)).connect(master); o.start(tt); o.stop(tt + 0.08); }
        }
        // 2) IMPACTO EN CAPAS (aparece el logo)
        {
            const s1 = ctx.createOscillator(); s1.frequency.setValueAtTime(92, ti); s1.frequency.exponentialRampToValueAtTime(36, ti + 0.45); const g1 = ctx.createGain(); curva(g1, [[ti], [ti + 0.005, 1], [ti + 1.4, 0.0001]]); s1.connect(g1).connect(master); s1.start(ti); s1.stop(ti + 1.5);
            const k = ctx.createOscillator(); k.type = 'triangle'; k.frequency.setValueAtTime(180, ti); k.frequency.exponentialRampToValueAtTime(55, ti + 0.08); const gk = ctx.createGain(); curva(gk, [[ti], [ti + 0.002, 0.7], [ti + 0.18, 0.0001]]); k.connect(gk).connect(master); k.start(ti); k.stop(ti + 0.2);
            const cr = ctx.createBufferSource(); cr.buffer = ruido; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3800; bp.Q.value = 0.7; const gc = ctx.createGain(); curva(gc, [[ti], [ti + 0.002, 0.5], [ti + 0.22, 0.0001]]); cr.connect(bp).connect(gc).connect(master); envio(gc, 0.6); cr.start(ti); cr.stop(ti + 0.25);
            // anillo metálico (FM inarmónico) a lado y lado
            [[-0.5, 1.0], [0.5, 1.007]].forEach(([pv, det]) => { const c = ctx.createOscillator(); c.frequency.value = 523.25 * det; const m = ctx.createOscillator(); m.frequency.value = 523.25 * 2.76; const mg = ctx.createGain(); mg.gain.setValueAtTime(1600, ti); mg.gain.exponentialRampToValueAtTime(5, ti + 1.6); m.connect(mg).connect(c.frequency);
                const g = ctx.createGain(); curva(g, [[ti], [ti + 0.004, 0.09], [ti + 2.2, 0.0001]]); c.connect(g).connect(pan(pv)).connect(master); envio(g, 0.5); c.start(ti); m.start(ti); c.stop(ti + 2.3); m.stop(ti + 2.3); });
        }
        // 3) FIRMA DE MARCA: 3 notas de cristal (Re · La · Mi) que suben, abiertas en estéreo, sobre un colchón que se abre
        {
            [[ti + 0.12, 74, -0.35], [ti + 0.34, 81, 0.35], [ti + 0.56, 88, 0]].forEach(([tt, m, pv], i) => {
                const f = m2f(m); const out = pan(pv); out.connect(master); const gsend = ctx.createGain(); gsend.gain.value = 0.7; out.connect(gsend).connect(revHp);
                [[1, 1], [2, 0.4], [3.01, 0.18], [5.4, 0.06]].forEach(([r, a]) => { const o = ctx.createOscillator(); o.frequency.value = f * r; const g = ctx.createGain(); curva(g, [[tt], [tt + 0.006, (i === 2 ? 0.16 : 0.13) * a], [tt + (i === 2 ? 3 : 1.6), 0.0001]]); o.connect(g).connect(out); o.start(tt); o.stop(tt + 3.1); });
            });
            const pad = ctx.createGain(); curva(pad, [[ti], [ti + 0.6, 0.085], [ti + 2.6, 0.06], [ti + 4.2, 0.0001]]);
            const pf = ctx.createBiquadFilter(); pf.type = 'lowpass'; pf.Q.value = 3; pf.frequency.setValueAtTime(500, ti); pf.frequency.exponentialRampToValueAtTime(4200, ti + 1.4); pf.frequency.exponentialRampToValueAtTime(1100, ti + 4);
            pf.connect(pad); pad.connect(master); envio(pad, 0.5);
            [50, 57, 62, 64, 66, 69, 74].forEach((m, i) => [-11, 11].forEach((det, j) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = m2f(m); o.detune.value = det; const p = pan(j ? 0.55 : -0.55); o.connect(p).connect(pf); o.start(ti); o.stop(ti + 4.3); }));
        }
        // 4) COLA DE DESTELLOS (mientras se descifra el nombre)
        for (let i = 0; i < 14; i++) { const tt = t + T_TEXTO + i * 0.07; const f = m2f([86, 88, 90, 93, 95, 98, 100][i % 7]) ; const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); curva(g, [[tt], [tt + 0.003, 0.025], [tt + 0.35, 0.0001]]); o.connect(g).connect(pan((i % 2 ? 1 : -1) * 0.7)).connect(master); envio(g, 0.8); o.start(tt); o.stop(tt + 0.4); }
        // 5) bienvenida con voz natural (grabada y verificada), por encima de todo
        vozLista.then((buf) => { if (!buf) return; const src = ctx.createBufferSource(); src.buffer = buf; const vg = ctx.createGain(); vg.gain.value = 1.35; src.connect(vg).connect(lim); src.start(Math.max(ctx.currentTime + 0.02, ti + 1.1)); }).catch(() => {});
    }
    const inicio = performance.now();
    let vozLista = Promise.resolve(null);
    const cargarVoz = () => { vozLista = fetch('audio/bienvenida.wav').then((r) => (r.ok ? r.arrayBuffer() : null)).then((a) => (a ? ctx.decodeAudioData(a) : null)).catch(() => null); };
    try { const C = window.AudioContext || window.webkitAudioContext; ctx = new C(); cargarVoz(); ctx.resume().then(() => { if (ctx.state === 'running') sonido((performance.now() - inicio) / 1000); }).catch(() => {}); } catch { ctx = null; }
    capa.addEventListener('pointerdown', () => {
        if (sono) return;
        try { if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; ctx = new C(); cargarVoz(); } ctx.resume(); } catch { return; }
        sonido((performance.now() - inicio) / 1000);
    });
})();
