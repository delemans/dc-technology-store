// marcas.js — Franja "Plataformas disponibles" bajo la portada (identidad Corriente DC).
// Logos REALES del catálogo (productos.json: streaming, licencias y pines, uno por marca) en una pista que avanza sola;
// cada logo abre la página del producto. Contador con los totales reales del catálogo. Sin librerías.
// "Reducir movimiento": la pista queda quieta y se desliza con el dedo; el contador muestra el número final.
// "Así se compra": el video se reproduce solo cuando está en pantalla (ahorra datos); con "reducir movimiento" queda la portada
(() => {
    const v = document.querySelector('video[data-asi]');
    if (!v) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) { v.controls = true; return; }
    new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => { v.controls = true; }); else v.pause(); }, { threshold: 0.35 }).observe(v);
})();

(() => {
    const seccion = document.getElementById('plataformas');
    const pista = document.getElementById('plataformas-pista');
    if (!seccion || !pista) return;
    const menosMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    fetch('productos.json', { cache: 'force-cache' }).then((r) => r.json()).then((productos) => {
        const vistos = new Set();
        const logos = productos.filter((p) => ['streaming', 'licencias', 'pines'].includes(p.tipo) && p.imagen).filter((p) => {
            const clave = String(p.marca || p.nombre).toLowerCase();
            if (vistos.has(clave)) return false;
            vistos.add(clave);
            return true;
        });
        if (logos.length < 4) { seccion.hidden = true; return; }
        const item = (p, oculto) => `<a class="plataformas__logo" href="p/${esc(p.id)}.html"${oculto ? ' tabindex="-1" aria-hidden="true"' : ''} title="${esc(p.nombre)}">
            <img src="${esc(p.imagen)}" alt="${oculto ? '' : esc(p.marca || p.nombre)}" loading="lazy" decoding="async" width="120" height="64"></a>`;
        // Se duplica la lista para que la pista sea continua (la copia no es navegable ni la lee el lector de pantalla)
        pista.innerHTML = `<div class="plataformas__fila">${logos.map((p) => item(p, false)).join('')}${menosMovimiento ? '' : logos.map((p) => item(p, true)).join('')}</div>`;
        pista.style.setProperty('--duracion', `${Math.max(30, logos.length * 3.2)}s`);

        // Contador: productos, plataformas digitales y operadores de recargas (reales)
        const totales = { productos: productos.length, plataformas: productos.filter((p) => ['streaming', 'licencias', 'pines'].includes(p.tipo)).length, recargas: productos.filter((p) => p.tipo === 'recargas').length };
        seccion.querySelectorAll('[data-contar]').forEach((el) => {
            const fin = totales[el.dataset.contar] ?? 0;
            if (menosMovimiento || !('IntersectionObserver' in window)) { el.textContent = fin; return; }
            const obs = new IntersectionObserver(([e]) => {
                if (!e.isIntersecting) return;
                obs.disconnect();
                const t0 = performance.now(), dur = 1100;
                const paso = (t) => { const k = Math.min(1, (t - t0) / dur); el.textContent = Math.round(fin * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(paso); };
                requestAnimationFrame(paso);
            });
            obs.observe(el);
        });
    }).catch(() => { seccion.hidden = true; });
})();
