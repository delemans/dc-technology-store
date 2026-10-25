// efectos.js — Movimiento de la identidad "Corriente DC" (estilos/corriente.css). Sin librerías.
// 1) Foco de la portada que sigue el puntero. 2) Aparición escalonada de secciones y tarjetas al bajar,
//    también para las tarjetas que app.js pinta después (filtros, búsqueda). Respeta "reducir movimiento".
(() => {
    const menosMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const hero = document.getElementById('hero');
    if (hero && !menosMovimiento) {
        let cuadro = 0;
        hero.addEventListener('pointermove', (e) => {
            if (cuadro) return;
            cuadro = requestAnimationFrame(() => {
                const r = hero.getBoundingClientRect();
                hero.style.setProperty('--px', `${e.clientX - r.left}px`);
                hero.style.setProperty('--py', `${e.clientY - r.top}px`);
                cuadro = 0;
            });
        });
    }

    // Indicador «En vivo» junto al conteo del catálogo: precios (y unidades, si la base ya las trae) leídos de la base al abrir
    const enVivo = (d) => {
        const conteo = document.getElementById('product-count');
        if (!conteo || !d || document.getElementById('en-vivo')) return;
        const chip = document.createElement('span');
        chip.id = 'en-vivo';
        chip.className = 'en-vivo';
        chip.setAttribute('title', 'Precios leídos de la base al abrir la tienda; los proveedores se sincronizan cada 6 horas');
        chip.innerHTML = '<i aria-hidden="true"></i><span></span>';
        chip.querySelector('span').textContent = `${d.conUnidades ? 'Precios y unidades' : 'Precios'} en vivo · ${d.hora.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}`;
        conteo.insertAdjacentElement('beforebegin', chip);
    };
    if (window.DCSincronizado) enVivo(window.DCSincronizado);
    window.addEventListener('dc:sincronizado', (e) => enVivo(e.detail));

    if (menosMovimiento || !('IntersectionObserver' in window)) return;
    // Titular de la portada: las palabras entran una tras otra (solo al abrir)
    const titulo = document.getElementById('hero-titulo');
    if (titulo && !titulo.dataset.animado) {
        titulo.dataset.animado = '1';
        let n = 0;
        const partir = (nodo) => {
            for (const hijo of [...nodo.childNodes]) {
                if (hijo.nodeType === 3) {
                    const frag = document.createDocumentFragment();
                    for (const parte of hijo.textContent.split(/(\s+)/)) {
                        if (!parte) continue;
                        if (/^\s+$/.test(parte)) { frag.appendChild(document.createTextNode(parte)); continue; }
                        const s = document.createElement('span');
                        s.className = 'palabra';
                        s.style.setProperty('--i', n++);
                        s.textContent = parte;
                        frag.appendChild(s);
                    }
                    hijo.replaceWith(frag);
                } else if (hijo.nodeType === 1) partir(hijo);
            }
        };
        partir(titulo);
    }
    const observador = new IntersectionObserver((entradas) => {
        for (const e of entradas) {
            if (!e.isIntersecting) continue;
            e.target.classList.add('visible');
            observador.unobserve(e.target);
        }
    // Basta con que asome: una sección más alta que la pantalla nunca llega a un porcentaje visible
    }, { rootMargin: '0px 0px -40px 0px', threshold: 0 });

    const preparar = (el, i = 0) => {
        if (el.classList.contains('revelar')) return;
        el.classList.add('revelar');
        el.style.setProperty('--retardo', `${Math.min(i, 8) * 60}ms`);
        observador.observe(el);
    };
    // El catálogo no se oculta entero: sus tarjetas aparecen una a una
    document.querySelectorAll('main > section:not(#hero):not(#catalogo)').forEach((s) => preparar(s));

    // Tarjetas del catálogo: escalonadas por fila, incluidas las que aparecen al filtrar o buscar
    const tarjetas = () => document.querySelectorAll('.tarjeta-3d:not(.revelar)').forEach((t, i) => preparar(t, i % 6));
    tarjetas();
    new MutationObserver(tarjetas).observe(document.querySelector('main') ?? document.body, { childList: true, subtree: true });
})();
