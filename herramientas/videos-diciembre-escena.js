// herramientas/videos-diciembre-escena.js — Animaciones de los videos de diciembre (corre dentro de Chrome).
// render(t) dibuja el cuadro exacto del segundo t (determinista: el video sale idéntico cada vez).
// 7 formatos distintos: regalo, trailer, ritmo, adviento, vitrina, tarjeta, ticket (+ «todos», el resumen del catálogo).
/* global D */
(() => {
    const W = 1080, H = 1920;
    const $ = (s) => document.querySelector(s);
    const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
    const seg = (t, a, b) => cl((t - a) / (b - a));
    const eo = (x) => 1 - Math.pow(1 - x, 3);
    const eio = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const eb = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
    const lerp = (a, b, x) => a + (b - a) * x;
    const S = (e, o, tr, extra) => { if (!e) return; e.style.opacity = o; if (tr !== undefined) e.style.transform = tr; if (extra) Object.assign(e.style, extra); };
    const cop = (v) => `$${Number(v).toLocaleString('es-CO')}`;
    const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    let semilla = 7;
    const azar = () => ((semilla = (semilla * 9301 + 49297) % 233280) / 233280);
    const palabras = (html) => { const out = []; html.replace(/<em>(.*?)<\/em>|([^<]+)/g, (m, em, tx) => { (em ?? tx).split(/\s+/).filter(Boolean).forEach((w) => out.push({ w, em: !!em })); }); return out; };

    const E = D.estilo;
    const claro = D.formato === 'tarjeta' ? true : !!E.claro;
    const texto = D.formato === 'tarjeta' ? '#2B1410' : E.texto;
    const acento = D.formato === 'tarjeta' ? '#C8102E' : E.acento;
    const planes = D.planes.slice(0, D.formato === 'ticket' ? 6 : 4);
    const pal = palabras(D.t);

    /* ---------- Partículas (canvas) ---------- */
    let fx;
    const P = Array.from({ length: 140 }, () => ({ x: azar(), y: azar(), r: azar(), s: azar(), c: Math.floor(azar() * 4), f: azar() }));
    const colores = [acento, '#E03445', '#FFFFFF', '#3BE38A'];
    const rafagas = [];
    const rafaga = (t0, x, y, n = 70, fuerza = 1) => rafagas.push({ t0, x, y, n, fuerza });
    function particulas(t) {
        fx ??= $('#fx').getContext('2d');
        fx.clearRect(0, 0, W, H);
        // bokeh suave: da profundidad a todos los fondos
        for (let i = 0; i < 9; i++) {
            const p = P[i];
            const x = (p.x * W + Math.sin(t * 0.3 + i) * 60), y = ((p.y * H - t * (20 + p.s * 30)) % (H + 400) + H + 400) % (H + 400) - 200;
            const g = fx.createRadialGradient(x, y, 0, x, y, 120 + p.r * 160);
            g.addColorStop(0, claro ? 'rgba(200,16,46,.10)' : 'rgba(255,220,150,.16)'); g.addColorStop(1, 'rgba(0,0,0,0)');
            fx.fillStyle = g; fx.fillRect(x - 300, y - 300, 600, 600);
        }
        const a = E.adorno;
        if (a === 'nieve' || a === 'cinta' || D.formato === 'tarjeta') {
            fx.fillStyle = claro ? 'rgba(130,160,200,.55)' : 'rgba(255,255,255,.8)';
            for (let i = 10; i < 110; i++) {
                const p = P[i]; const v = 60 + p.s * 140;
                const x = p.x * W + Math.sin(t * (0.6 + p.f) + i) * 40, y = ((p.y * H + t * v) % (H + 40)) - 20;
                fx.globalAlpha = 0.35 + p.r * 0.6; fx.beginPath(); fx.arc(x, y, 2 + p.r * 6, 0, 7); fx.fill();
            }
        } else if (a === 'confeti') {
            for (let i = 10; i < 90; i++) {
                const p = P[i]; const v = 120 + p.s * 160;
                const x = p.x * W + Math.sin(t * 2 + i) * 30, y = ((p.y * H + t * v) % (H + 60)) - 30;
                fx.save(); fx.translate(x, y); fx.rotate(t * (2 + p.f * 4) + i); fx.globalAlpha = 0.7; fx.fillStyle = colores[p.c]; fx.fillRect(-7, -13, 14, 26); fx.restore();
            }
        } else if (a === 'estrellas') {
            for (let i = 10; i < 70; i++) {
                const p = P[i]; const x = p.x * W, y = p.y * H * 0.75; const b = 0.5 + 0.5 * Math.sin(t * (2 + p.f * 3) + i * 3);
                fx.globalAlpha = 0.25 + b * 0.75; fx.fillStyle = i % 5 ? '#FFFFFF' : acento; const r = 2 + p.r * 5 * b;
                fx.beginPath(); fx.moveTo(x, y - r * 3); fx.lineTo(x + r * 0.6, y - r * 0.6); fx.lineTo(x + r * 3, y); fx.lineTo(x + r * 0.6, y + r * 0.6); fx.lineTo(x, y + r * 3); fx.lineTo(x - r * 0.6, y + r * 0.6); fx.lineTo(x - r * 3, y); fx.lineTo(x - r * 0.6, y - r * 0.6); fx.fill();
            }
        } else if (a === 'velas') {
            for (let i = 10; i < 70; i++) {
                const p = P[i]; const v = 40 + p.s * 70;
                const x = p.x * W + Math.sin(t + i) * 20, y = H - ((p.y * H + t * v) % H);
                fx.globalAlpha = (0.3 + p.r * 0.6) * (y / H); fx.fillStyle = i % 3 ? '#FFB23E' : '#FFE7B0'; fx.beginPath(); fx.arc(x, y, 2 + p.r * 4, 0, 7); fx.fill();
            }
        }
        if (a === 'luces') {
            // guirnalda que titila
            fx.globalAlpha = 1; fx.strokeStyle = 'rgba(0,0,0,.45)'; fx.lineWidth = 4; fx.beginPath();
            for (let x = 0; x <= W; x += 20) { const y = 60 + Math.sin(x / 170) * 26 + 20; x ? fx.lineTo(x, y) : fx.moveTo(x, y); } fx.stroke();
            for (let i = 0; i < 15; i++) {
                const x = 30 + i * 73, y = 86 + Math.sin(x / 170) * 26; const b = 0.55 + 0.45 * Math.sin(t * 4 + i * 1.7);
                const c = ['#F2C14E', '#E03445', '#3BE38A', '#5AA9FF'][i % 4];
                const g = fx.createRadialGradient(x, y + 14, 0, x, y + 14, 46); g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)');
                fx.globalAlpha = b * 0.8; fx.fillStyle = g; fx.fillRect(x - 50, y - 36, 100, 100);
                fx.globalAlpha = 0.6 + b * 0.4; fx.fillStyle = c; fx.beginPath(); fx.ellipse(x, y + 14, 11, 16, 0, 0, 7); fx.fill();
            }
        }
        // ráfagas de confeti en los momentos de revelación
        for (const r of rafagas) {
            const dt = t - r.t0; if (dt < 0 || dt > 2.6) continue;
            for (let i = 0; i < r.n; i++) {
                const p = P[(i * 7) % P.length]; const ang = (i / r.n) * Math.PI * 2 + p.f; const vel = (500 + p.s * 900) * r.fuerza;
                const x = r.x + Math.cos(ang) * vel * dt * (1 - dt * 0.18), y = r.y + Math.sin(ang) * vel * dt * (1 - dt * 0.18) + 520 * dt * dt;
                fx.save(); fx.translate(x, y); fx.rotate(dt * (6 + p.r * 8) + i); fx.globalAlpha = cl(1.2 - dt / 2.4); fx.fillStyle = colores[i % 4];
                i % 3 ? fx.fillRect(-8, -14, 16, 28) : (fx.beginPath(), fx.arc(0, 0, 9, 0, 7), fx.fill()); fx.restore();
            }
        }
        fx.globalAlpha = 1;
    }

    /* ---------- Estructura común ---------- */
    const root = $('#raiz');
    root.innerHTML = `
<div id="bg"></div><div id="viñeta"></div><canvas id="fx" width="1080" height="1920"></canvas><div id="escena"></div>
<div id="capa">
  <div id="marca"><img src="${D.logo}" alt="">DC <b>TECNOLOGY</b></div>
  <div id="tema">🎄 ${esc(D.tema)}</div>
  <h1 id="h1">${pal.map((p) => `<span class="w${p.em ? ' em' : ''}"><i>${esc(p.w)}</i></span>`).join(' ')}</h1>
  <div id="vit"><div id="halo"></div><img id="foto" src="${esc(D.imagen)}" alt="">${D.quedan && D.quedan <= 5 ? `<span id="quedan">⏳ Solo quedan ${D.quedan}</span>` : ''}</div>
  <div id="info">
    <ul id="bens">${D.b.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    <div id="precios">${planes.map((v) => `<div class="pr"><span>${esc(v.nombre)}</span><b>${cop(v.precio)}</b></div>`).join('')}</div>
  </div>
  <div id="pie"><span id="cta">💬 Pídelo: 322 328 4622</span><span id="web">dctecnology<b>.xyz</b></span></div>
</div>
<div id="flash"></div>`;
    document.documentElement.style.setProperty('--fondo', D.formato === 'tarjeta' ? 'radial-gradient(70% 45% at 50% 0%,#FFFFFF,#FFF4E6 60%,#F6E2C8)' : E.fondo);
    document.documentElement.style.setProperty('--texto', texto);
    document.documentElement.style.setProperty('--acento', acento);
    document.documentElement.style.setProperty('--carta', claro ? '#FFFFFF' : 'rgba(0,0,0,.38)');
    document.documentElement.style.setProperty('--carta-borde', claro ? 'rgba(15,17,26,.08)' : 'rgba(255,255,255,.16)');
    document.documentElement.style.setProperty('--precio', claro ? '#C8102E' : acento);
    document.documentElement.style.setProperty('--plan', claro ? '#1B1F2A' : texto);
    if (planes.length > 3) root.classList.add('muchos');
    root.classList.add(`f-${D.formato}`);
    if (claro) root.classList.add('claro');
    const esc2 = $('#escena');
    const ws = [...document.querySelectorAll('#h1 .w i')];
    const lis = [...document.querySelectorAll('#bens li')];
    const prs = [...document.querySelectorAll('#precios .pr')];
    const vit = $('#vit'), foto = $('#foto'), halo = $('#halo');

    // Posición del producto «en grande» en el centro de la pantalla respecto a su lugar final
    let heroe = { dx: 0, dy: 0 };
    function medir() { const r = vit.getBoundingClientRect(); heroe = { dx: W / 2 - (r.left + r.width / 2), dy: H / 2 - 40 - (r.top + r.height / 2), s: Math.min(1.45, 760 / r.width) }; }

    /* ---------- Piezas de animación reutilizables ---------- */
    function cabecera(t, t0, rapido = 1) {
        S($('#marca'), eo(seg(t, t0, t0 + 0.5)), `translateY(${lerp(-30, 0, eo(seg(t, t0, t0 + 0.5)))}px)`);
        const k = eb(seg(t, t0 + 0.2, t0 + 0.7));
        S($('#tema'), cl(k * 1.2), `translateY(${lerp(-40, 0, k)}px) scale(${lerp(0.7, 1, k)})`);
        ws.forEach((w, i) => { const x = eo(seg(t, t0 + 0.45 + i * 0.09 * rapido, t0 + 0.95 + i * 0.09 * rapido)); S(w, x, `translateY(${lerp(110, 0, x)}%)`); });
    }
    function productoEnSitio(t, desde, a, b, extra = '') {
        // de «en grande al centro» (desde) a su lugar en la composición, entre a y b
        const x = eio(seg(t, a, b)); const s0 = desde.s ?? heroe.s;
        const flota = Math.sin(t * 1.6) * 10 * x;
        S(vit, desde.o ?? 1, `translate(${lerp(heroe.dx + (desde.dx ?? 0), 0, x)}px,${lerp(heroe.dy + (desde.dy ?? 0), 0, x) + flota}px) scale(${lerp(s0, 1, x)}) ${extra}`);
    }
    function infoFinal(t, tb, tp, tc, sello = false) {
        lis.forEach((li, i) => {
            const x = eb(seg(t, tb + i * 0.32, tb + i * 0.32 + 0.45)); const fuera = tp ? eo(seg(t, tp - 0.45, tp - 0.05)) : 0;
            S(li, cl(x) * (1 - fuera), `translateX(${lerp(-120, 0, x) + fuera * 80}px)`);
        });
        prs.forEach((pr, i) => {
            const a = tp + i * 0.2; const x = sello ? eo(seg(t, a, a + 0.28)) : eb(seg(t, a, a + 0.5));
            S(pr, cl(x * 1.4), sello ? `scale(${lerp(1.7, 1, x)}) rotate(${lerp(-9, 0, x)}deg)` : `translateY(${lerp(80, 0, x)}px)`);
        });
        const c = eb(seg(t, tc, tc + 0.5)); const pulso = t > tc + 0.6 ? 1 + Math.max(0, Math.sin((t - tc) * 5)) * 0.045 : 1;
        S($('#cta'), cl(c), `scale(${lerp(0.6, 1, c) * pulso})`);
        S($('#web'), eo(seg(t, tc + 0.25, tc + 0.7)), `translateX(${lerp(40, 0, eo(seg(t, tc + 0.25, tc + 0.7)))}px)`);
        const q = $('#quedan'); if (q) { const x = eb(seg(t, tp + 0.6, tp + 1.1)); S(q, cl(x), `translateX(-50%) scale(${lerp(0.4, 1, x) * (1 + Math.max(0, Math.sin(t * 6)) * 0.05)})`); }
    }
    const brillo = (t, a) => { const x = seg(t, a, a + 1.1); S(halo, 0.9, undefined, { background: `linear-gradient(105deg,transparent ${lerp(-40, 110, x) - 20}%,rgba(255,255,255,.75) ${lerp(-40, 110, x)}%,transparent ${lerp(-40, 110, x) + 20}%)` }); };
    const flash = (t, a, fuerza = 0.85) => S($('#flash'), t < a ? 0 : Math.max(0, fuerza * (1 - (t - a) / 0.35)));

    /* ---------- Los 7 formatos ---------- */
    const F = {};
    // 1) Regalo sorpresa: la caja se sacude, sale la tapa y aparece el producto
    F.regalo = {
        dur: 12.5,
        eventos: [{ t: 0.1, tipo: 'whoosh' }, { t: 2.35, tipo: 'golpe' }, { t: 2.4, tipo: 'brillo' }, { t: 4.0, tipo: 'whoosh' }, { t: 8.0, tipo: 'brillo' }, { t: 9.0, tipo: 'golpe' }],
        init() {
            esc2.innerHTML = `<div id="rayos"></div><div id="caja"><div id="tapa"><i></i></div><div id="cuerpo"><i></i></div><div id="lazo">🎀</div></div>`;
            rafaga(2.35, W / 2, 900, 90, 1.1);
        },
        render(t) {
            const k = eb(seg(t, 0, 0.7));
            const sac = Math.sin(t * 34) * 7 * seg(t, 0.8, 2.3) * (t < 2.35 ? 1 : 0);
            S($('#caja'), 1 - seg(t, 3.0, 3.6), `translate(-50%,${eo(seg(t, 3.0, 3.6)) * 400}px) scale(${k}) rotate(${sac}deg)`);
            const tp = eo(seg(t, 2.35, 3.0));
            S($('#tapa'), 1 - seg(t, 2.8, 3.1), `translateY(${-tp * 900}px) rotate(${-tp * 50}deg)`);
            S($('#lazo'), 1 - seg(t, 2.35, 2.6), `translateX(-50%) translateY(${-tp * 700}px)`);
            S($('#rayos'), seg(t, 2.3, 2.6) * (1 - seg(t, 4.2, 4.8)) * 0.9, `translate(-50%,-50%) rotate(${t * 18}deg) scale(${lerp(0.3, 1.2, eo(seg(t, 2.3, 3.2)))})`);
            const sube = eb(seg(t, 2.5, 3.6));
            if (t < 3.9) S(vit, cl(sube * 2), `translate(${heroe.dx}px,${heroe.dy + lerp(260, 0, sube)}px) scale(${lerp(0.25, heroe.s, sube)})`);
            else productoEnSitio(t, {}, 3.9, 4.8);
            cabecera(t, 4.0);
            infoFinal(t, 5.4, 7.9, 9.0);
            brillo(t, 8.6);
            flash(t, 2.35, 0.6);
        },
    };
    // 2) Tráiler de cine (streaming): franjas negras, tarjetas de texto y revelación
    F.trailer = {
        dur: 13,
        eventos: [{ t: 0.2, tipo: 'drone' }, { t: 1.9, tipo: 'boom' }, { t: 3.7, tipo: 'boom' }, { t: 6.2, tipo: 'golpe' }, { t: 6.25, tipo: 'brillo' }, { t: 9.4, tipo: 'brillo' }, { t: 10.4, tipo: 'golpe' }],
        init() {
            esc2.innerHTML = `<div class="barra" id="b1"></div><div class="barra" id="b2"></div><div id="oscuro"></div>
<div class="tc" id="tc1">DC TECNOLOGY PRESENTA</div><div class="tc" id="tc2">ESTE<br>DICIEMBRE</div>
<div class="tc" id="tc3">${pal.map((p) => `<span class="${p.em ? 'em' : ''}">${esc(p.w)}</span>`).join(' ')}</div>`;
        },
        render(t) {
            const ab = eio(seg(t, 10.0, 10.6));
            S($('#b1'), 1, `translateY(${-ab * 100}%)`); S($('#b2'), 1, `translateY(${ab * 100}%)`);
            S($('#oscuro'), 1 - seg(t, 6.1, 6.5));
            const c1 = seg(t, 0.3, 0.9) * (1 - seg(t, 1.4, 1.8));
            S($('#tc1'), c1, `translate(-50%,-50%)`, { letterSpacing: `${lerp(0.2, 0.42, seg(t, 0.3, 1.8))}em` });
            const c2 = seg(t, 1.9, 2.4) * (1 - seg(t, 3.2, 3.6));
            S($('#tc2'), c2, `translate(-50%,-50%) scale(${lerp(1.18, 1, eo(seg(t, 1.9, 3.6)))})`, { filter: `blur(${lerp(14, 0, eo(seg(t, 1.9, 2.5)))}px)` });
            const c3 = seg(t, 3.7, 4.1) * (1 - seg(t, 5.8, 6.15));
            S($('#tc3'), c3, `translate(-50%,-50%) scale(${lerp(1.06, 1, eo(seg(t, 3.7, 6.1)))})`, { filter: `blur(${lerp(10, 0, eo(seg(t, 3.7, 4.3)))}px)` });
            S(vit, seg(t, 6.15, 6.3), `scale(${lerp(1.12, 1, eo(seg(t, 6.15, 9)))}) translateY(${Math.sin(t * 1.4) * 8}px)`);
            cabecera(t, 6.3, 0.6);
            infoFinal(t, 7.2, 9.8, 10.6);
            brillo(t, 9.2);
            flash(t, 6.15, 0.9);
        },
    };
    // 3) Ritmo: una palabra por golpe, el producto entra de golpe y el precio como sello
    const BEAT = 0.4;
    const tr = pal.length * BEAT + 0.3;
    F.ritmo = {
        dur: Math.ceil((tr + 7.4) * 2) / 2,
        eventos: [...pal.map((_, i) => ({ t: i * BEAT, tipo: 'bombo' })), { t: tr, tipo: 'golpe' }, { t: tr + 1.3, tipo: 'whoosh' }, { t: tr + 4.4, tipo: 'golpe' }, { t: tr + 5.4, tipo: 'brillo' }],
        beat: BEAT,
        init() {
            esc2.innerHTML = `<div id="destello"></div>${pal.map((p, i) => `<div class="gp${p.em ? ' em' : ''}" id="gp${i}" style="font-size:${Math.min(230, Math.floor(1700 / Math.max(3, p.w.length)))}px">${esc(p.w)}</div>`).join('')}`;
            rafaga(tr, W / 2, 900, 80, 1);
        },
        render(t) {
            const i = Math.floor(t / BEAT);
            pal.forEach((_, k) => { const x = seg(t, k * BEAT, k * BEAT + 0.12); const v = k === i && t < tr - 0.3 ? 1 : 0; S($(`#gp${k}`), v, `translate(-50%,-50%) scale(${lerp(1.35, 1, eo(x))}) rotate(${(k % 2 ? 1 : -1) * 3}deg)`); });
            S($('#destello'), t < tr - 0.3 ? (i % 2 ? 0.9 : 0) : 0);
            // sacudida de cámara al golpe
            const sh = t > tr && t < tr + 0.45 ? (1 - (t - tr) / 0.45) * 26 : 0;
            root.style.transform = sh ? `translate(${Math.sin(t * 90) * sh}px,${Math.cos(t * 77) * sh}px)` : '';
            const g = eo(seg(t, tr, tr + 0.25));
            if (t < tr + 1.2) S(vit, t < tr ? 0 : 1, `translate(${heroe.dx}px,${heroe.dy}px) scale(${lerp(2.6, heroe.s, g)})`);
            else productoEnSitio(t, {}, tr + 1.2, tr + 1.8);
            cabecera(t, tr + 1.3, 0.5);
            infoFinal(t, tr + 2.2, tr + 4.4, tr + 5.3, true);
            flash(t, tr, 0.7);
        },
    };
    // 4) Calendario de adviento: se abre la puerta del 24
    const orden = [7, 19, 3, 12, 22, 1, 15, 9, 24, 5, 17, 11, 2, 20, 8, 14, 23, 6, 18, 10, 4, 16, 21, 13];
    const p24 = orden.indexOf(24);
    F.adviento = {
        dur: 12.5,
        eventos: [...orden.map((_, i) => ({ t: 0.1 + i * 0.05, tipo: i % 4 ? null : 'tic' })).filter((e) => e.tipo), { t: 1.8, tipo: 'whoosh' }, { t: 3.05, tipo: 'golpe' }, { t: 3.1, tipo: 'brillo' }, { t: 4.8, tipo: 'whoosh' }, { t: 8.6, tipo: 'golpe' }],
        init() {
            esc2.innerHTML = `<div id="cal">${orden.map((n) => `<div class="pu${n === 24 ? ' p24' : ''}"><div class="hoja"><b>${n}</b></div><div class="dentro">🎁</div></div>`).join('')}</div>`;
            rafaga(3.1, W / 2, 960, 80, 1);
        },
        render(t) {
            document.querySelectorAll('.pu').forEach((d, i) => { const x = eb(seg(t, 0.1 + i * 0.05, 0.55 + i * 0.05)); S(d, cl(x), `scale(${x})`); });
            const col = p24 % 4, fil = Math.floor(p24 / 4);
            const cx = 120 + col * 210 + 95, cy = 300 + fil * 230 + 105;
            const z = eio(seg(t, 1.8, 3.0));
            S($('#cal'), 1 - seg(t, 3.5, 3.9), `translate(${lerp(0, W / 2 - cx, z)}px,${lerp(0, H / 2 - cy, z)}px) scale(${lerp(1, 3.2, z)})`, { transformOrigin: `${cx}px ${cy}px` });
            S($('.p24 .hoja'), 1, `perspective(900px) rotateY(${-eo(seg(t, 3.0, 3.6)) * 115}deg)`);
            const r = eb(seg(t, 3.5, 4.3));
            if (t < 4.8) S(vit, t < 3.5 ? 0 : 1, `translate(${heroe.dx}px,${heroe.dy}px) scale(${lerp(0.2, heroe.s, r)}) rotate(${lerp(-25, 0, r)}deg)`);
            else productoEnSitio(t, {}, 4.8, 5.5);
            cabecera(t, 4.9);
            infoFinal(t, 6.0, 8.5, 9.4);
            brillo(t, 9.0);
            flash(t, 3.05, 0.75);
        },
    };
    // 5) Vitrina giratoria: foco de luz, pedestal y las razones flotando alrededor
    F.vitrina = {
        dur: 11.5,
        eventos: [{ t: 0.3, tipo: 'whoosh' }, { t: 1.15, tipo: 'golpe' }, { t: 1.9, tipo: 'tic' }, { t: 2.7, tipo: 'tic' }, { t: 3.5, tipo: 'tic' }, { t: 4.6, tipo: 'whoosh' }, { t: 6.2, tipo: 'brillo' }, { t: 7.2, tipo: 'golpe' }],
        init() {
            esc2.innerHTML = `<div id="foco"></div><div id="pedestal"></div>${D.b.map((b, i) => `<div class="chip" id="ch${i}">★ ${esc(b)}</div>`).join('')}`;
        },
        render(t) {
            const fo = seg(t, 0, 0.6) * (1 - seg(t, 4.6, 5.2));
            S($('#foco'), fo * 0.9, 'translateX(-50%)'); S($('#pedestal'), fo, `translateX(-50%) scale(${lerp(0.6, 1, eo(seg(t, 0, 0.6)))})`);
            const gira = `perspective(1400px) rotateY(${Math.sin(t * 1.3) * 16}deg)`;
            const cae = seg(t, 0.3, 1.15); const y = cae < 1 ? lerp(-1300, 0, cae * cae) : -Math.abs(Math.sin((t - 1.15) * 7)) * 60 * Math.max(0, 1 - (t - 1.15) * 2.2);
            if (t < 4.6) S(vit, t < 0.3 ? 0 : 1, `translate(${heroe.dx}px,${heroe.dy - 60 + y}px) scale(${heroe.s * 0.92}) ${gira}`);
            else productoEnSitio(t, { s: heroe.s * 0.92, dy: -60 }, 4.6, 5.3, gira);
            D.b.forEach((_, i) => { const x = eb(seg(t, 1.9 + i * 0.8, 2.4 + i * 0.8)); const f = 1 - seg(t, 4.3, 4.7); S($(`#ch${i}`), cl(x) * f, `translateX(${lerp(i % 2 ? 300 : -300, 0, x)}px) translateY(${Math.sin(t * 2 + i) * 10}px)`); });
            cabecera(t, 4.8);
            infoFinal(t, 99, 5.9, 7.0);
            lis.forEach((li) => S(li, 0));
            brillo(t, 6.6);
        },
    };
    // 6) Tarjeta navideña: se abre el sobre y sale la tarjeta «Para: ti · De: DC Tecnology»
    F.tarjeta = {
        dur: 12,
        eventos: [{ t: 0.1, tipo: 'whoosh' }, { t: 1.0, tipo: 'tic' }, { t: 1.7, tipo: 'whoosh' }, { t: 3.0, tipo: 'brillo' }, { t: 4.2, tipo: 'golpe' }, { t: 8.0, tipo: 'golpe' }],
        init() {
            esc2.innerHTML = `<div id="sobre"><div id="carta"><div class="para">Para: <b>ti</b> 🎁</div><div class="de">De: DC Tecnology</div><div class="feliz">¡Feliz Navidad!</div></div><div id="sobre-c"></div><div id="solapa"></div></div><div id="marco"></div>`;
            rafaga(4.2, W / 2, 960, 60, 0.9);
        },
        render(t) {
            const e = eo(seg(t, 0, 0.8));
            const sale = eo(seg(t, 2.8, 3.4));
            S($('#sobre'), 1 - sale, `translate(-50%,${lerp(1200, 0, e) + sale * 900}px) rotate(${lerp(-10, 0, e)}deg)`);
            S($('#solapa'), 1, `rotateX(${eio(seg(t, 1.0, 1.6)) * 180}deg)`, { zIndex: t > 1.3 ? 1 : 4 });
            const c = eio(seg(t, 1.7, 2.7));
            S($('#carta'), 1 - seg(t, 3.3, 3.7), `translateY(${-c * 560}px) scale(${lerp(1, 1.12, c)})`);
            S($('#marco'), seg(t, 3.2, 3.7), `scale(${lerp(1.08, 1, eo(seg(t, 3.2, 3.9)))})`);
            const r = eb(seg(t, 4.2, 4.9));
            S(vit, cl(r * 1.4), `scale(${lerp(0.3, 1, r)}) rotate(${lerp(18, 0, r)}deg) translateY(${Math.sin(t * 1.5) * 9}px)`);
            cabecera(t, 3.6);
            infoFinal(t, 5.4, 7.8, 8.8);
            brillo(t, 8.4);
        },
    };
    // 7) Lista de regalos: un ticket que se imprime con los planes y precios
    F.ticket = {
        dur: 12,
        eventos: [{ t: 0.2, tipo: 'whoosh' }, ...planes.map((_, i) => ({ t: 2.2 + i * 0.45, tipo: 'tic' })), { t: 2.2 + planes.length * 0.45 + 0.5, tipo: 'golpe' }, { t: 6.4, tipo: 'brillo' }, { t: 8.4, tipo: 'golpe' }],
        init() {
            esc2.innerHTML = `<div id="ranura"></div><div id="corte"><div id="papel"><div class="tk-t">🎁 LISTA DE REGALOS</div><div class="tk-n">${esc(D.nombre)}</div><div class="tk-l"></div>
${planes.map((v, i) => `<div class="tk-r" id="tk${i}"><span>${esc(v.nombre)}</span><b>${cop(v.precio)}</b></div>`).join('')}<div class="tk-l"></div>
<div class="tk-p">${D.b.map((b) => `✓ ${esc(b)}`).join('<br>')}</div><div class="tk-c"></div></div></div><div id="sticker"><img src="${esc(D.imagen)}" alt=""></div>`;
        },
        render(t) {
            S($('#ranura'), eo(seg(t, 0.8, 1.3)), `translateX(-50%) scaleX(${eo(seg(t, 0.8, 1.3))})`);
            const alto = $('#papel').scrollHeight;
            const imp = eio(seg(t, 1.4, 2.2 + planes.length * 0.45 + 1.2));
            S($('#papel'), t < 1.4 ? 0 : 1, `translateX(-50%) translateY(${-alto + imp * alto}px)`);
            planes.forEach((_, i) => { const x = eo(seg(t, 2.2 + i * 0.45, 2.5 + i * 0.45)); S($(`#tk${i}`), x); });
            const st = eb(seg(t, 2.2 + planes.length * 0.45 + 0.5, 2.2 + planes.length * 0.45 + 1.0));
            S($('#sticker'), cl(st * 1.3), `scale(${lerp(0.2, 1, st)}) rotate(${lerp(-40, 8, st) + Math.sin(t * 1.8) * 3}deg)`);
            cabecera(t, 0.2);
            S(vit, 0);
            infoFinal(t, 99, 99, 8.4);
            lis.forEach((li) => S(li, 0)); prs.forEach((pr) => S(pr, 0));
        },
    };
    // Resumen: todo el catálogo de diciembre en un solo video (cortes rápidos)
    F.todos = {
        init() {
            const L = D.todos;
            this.corte = 0.75; this.ini = 2.4; this.dur = this.ini + L.length * this.corte + 4;
            esc2.innerHTML = `<div class="tc" id="ti">TODO PARA<br><span class="em">ESTA NAVIDAD</span></div>${L.map((x, i) => `<div class="cl" id="cl${i}" style="background:${x.estilo.fondo};color:${x.estilo.texto}">
<div class="cl-m">DC <b style="color:${x.estilo.claro ? '#C8102E' : x.estilo.acento}">TECNOLOGY</b> · ${String(i + 1).padStart(2, '0')}/${L.length}</div><div class="cl-v"><img src="${esc(x.imagen)}" alt=""></div><div class="cl-n">${esc(x.nombre)}</div><div class="cl-p" style="color:${x.estilo.claro ? '#C8102E' : x.estilo.acento}">${x.planes.length > 1 ? 'Desde ' : ''}${cop(Math.min(...x.planes.map((v) => v.precio)))}</div></div>`).join('')}
<div class="tc" id="tf">${L.length} regalos<br><span class="em">te esperan</span></div>
<div class="tc" id="ef">Tu regalo de Navidad<br><span class="em">está aquí</span><small>Escríbenos y te ayudamos a elegir 🎁</small></div>`;
            this.eventos = [{ t: 0.2, tipo: 'whoosh' }, { t: this.ini - 0.1, tipo: 'golpe' }, ...L.map((_, i) => ({ t: this.ini + i * this.corte, tipo: i % 2 ? 'tic' : 'bombo' })), { t: this.ini + L.length * this.corte, tipo: 'golpe' }, { t: this.ini + L.length * this.corte + 0.2, tipo: 'brillo' }];
            this.beat = this.corte / 2;
        },
        render(t) {
            const L = D.todos, ini = this.ini, c = this.corte, fin = ini + L.length * c;
            S($('#ti'), seg(t, 0.2, 0.7) * (1 - seg(t, ini - 0.3, ini)), `translate(-50%,-50%) scale(${lerp(0.85, 1.05, seg(t, 0.2, ini))})`);
            L.forEach((_, i) => {
                const a = ini + i * c; const x = eo(seg(t, a, a + 0.18)); const visible = t >= a && t < a + c + 0.18;
                S($(`#cl${i}`), visible ? 1 : 0, `translateX(${lerp(100, 0, x)}%)`, { zIndex: i + 2 });
                const im = $(`#cl${i} .cl-v img`); if (visible) im.style.transform = `scale(${lerp(0.85, 1.05, seg(t, a, a + c))})`;
            });
            const f = seg(t, fin, fin + 0.4);
            S($('#tf'), f * (1 - seg(t, fin + 1.6, fin + 1.9)), `translate(-50%,-50%) scale(${lerp(1.3, 1, eo(f))})`, { zIndex: 99 });
            S($('#capa'), seg(t, fin + 1.8, fin + 2.2), '', { zIndex: 100 });
            ['#marca', '#tema', '#h1', '#vit', '#info'].forEach((s) => S($(s), s === '#marca' ? 1 : 0));
            const e = eb(seg(t, fin + 1.9, fin + 2.4));
            S($('#ef'), cl(e), `translate(-50%,-50%) translateY(${lerp(60, 0, e)}px)`, { zIndex: 101 });
            const k = eb(seg(t, fin + 2.0, fin + 2.5));
            S($('#cta'), cl(k), `scale(${lerp(0.6, 1, k) * (1 + Math.max(0, Math.sin(t * 5)) * 0.04)})`); S($('#web'), cl(k));
            flash(t, fin, 0.6);
        },
    };

    const formato = F[D.formato];
    window.preparar = async () => {
        formato.init();
        await document.fonts.ready;
        await Promise.all([...document.images].map((i) => (i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 10000); }))));
        const info = $('#info'); if (D.formato !== 'ticket' && D.formato !== 'todos') info.style.height = `${Math.max(D.formato === 'vitrina' ? 0 : $('#bens').scrollHeight, $('#precios').scrollHeight) + 8}px`;
        medir();
        // ningún elemento arranca visible: cada formato los va mostrando
        ['#marca', '#tema', '#cta', '#web'].forEach((s) => S($(s), 0)); S(vit, 0); lis.forEach((l) => S(l, 0)); prs.forEach((p) => S(p, 0)); ws.forEach((w) => S(w, 0));
        const fallas = [];
        if (D.formato !== 'todos' && !(foto.naturalWidth > 0)) fallas.push('sin foto');
        const capa = $('#capa').getBoundingClientRect(); if ($('#pie').getBoundingClientRect().bottom > capa.bottom + 2 || (D.formato !== 'ticket' && D.formato !== 'todos' && vit.getBoundingClientRect().height < 300)) fallas.push('el contenido no cabe');
        if (D.formato === 'todos') document.querySelectorAll('.cl-v img').forEach((im, i) => { if (!(im.naturalWidth > 0)) fallas.push(`sin foto ${D.todos[i].id}`); });
        BASE = formato.dur;
        return { dur: BASE + OUTRO, eventos: [...formato.eventos, { t: BASE, tipo: 'whoosh' }, { t: BASE + 0.4, tipo: 'golpe' }, { t: BASE + 0.55, tipo: 'brillo' }], beat: formato.beat ?? null, fallas };
    };
    // Cierre de marca (todos los videos): el logo en grande, DC TECNOLOGY, WhatsApp y web
    const OUTRO = 2.2;
    let BASE = 0;
    const cierre = document.createElement('div');
    cierre.id = 'cierre';
    cierre.innerHTML = `<div class="ci-halo"></div><img src="${D.logo}" alt=""><div class="ci-m">DC <b>TECNOLOGY</b></div><div class="ci-l">Tecnología · Plataformas · Pines · Servicio técnico</div>
<div class="ci-w">💬 322 328 4622</div><div class="ci-u">www.dctecnology.xyz</div>`;
    root.appendChild(cierre);
    function outro(u) {
        if (u < 0) { cierre.style.display = 'none'; return; }
        cierre.style.display = 'flex';
        cierre.style.clipPath = `circle(${lerp(0, 150, eio(seg(u, 0, 0.5)))}% at 50% 50%)`;
        const k = eb(seg(u, 0.25, 0.85));
        S(cierre.querySelector('img'), cl(k * 1.3), `scale(${lerp(0.3, 1, k)}) rotate(${lerp(-20, 0, k)}deg)`);
        S(cierre.querySelector('.ci-m'), eo(seg(u, 0.5, 0.9)), `translateY(${lerp(40, 0, eo(seg(u, 0.5, 0.9)))}px)`);
        S(cierre.querySelector('.ci-l'), eo(seg(u, 0.7, 1.1)));
        S(cierre.querySelector('.ci-w'), eo(seg(u, 0.85, 1.25)), `scale(${lerp(0.7, 1, eb(seg(u, 0.85, 1.25)))})`);
        S(cierre.querySelector('.ci-u'), eo(seg(u, 1.0, 1.4)));
        S(cierre.querySelector('.ci-halo'), 0.9, `rotate(${u * 40}deg)`);
    }
    window.render = (t) => { particulas(t); formato.render(Math.min(t, BASE)); outro(t - BASE); };
})();
