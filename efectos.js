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

    if (menosMovimiento || !('IntersectionObserver' in window)) return;
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

// Burbuja del Ingeniero DC en la portada: abre el copiloto
document.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-abrir-copiloto]')) return;
    const boton = document.getElementById('copiloto-abrir');
    if (boton && boton.getAttribute('aria-expanded') !== 'true') boton.click();
});
