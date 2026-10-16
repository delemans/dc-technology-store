// portafolio.js — Sección "Desarrollos y automatizaciones" de la tienda: filtros por tipo, vista ampliada del pantallazo
// y frase rotativa de la portada ("También desarrollamos: …"). Sin dependencias; respeta "reducir movimiento".
(() => {
    const grid = document.getElementById('desarrollos-grid');
    if (grid) {
        const botones = [...document.querySelectorAll('.desarrollos__filtros [data-filtro]')];
        botones.forEach((b) => b.addEventListener('click', () => {
            const filtro = b.dataset.filtro;
            botones.forEach((x) => x.setAttribute('aria-selected', String(x === b)));
            grid.querySelectorAll('.proyecto').forEach((p) => {
                const ver = filtro === 'todos' || p.dataset.tipos.split(' ').includes(filtro);
                p.hidden = !ver;
            });
        }));

        // Vista ampliada (dialog nativo: Esc y clic afuera cierran)
        const visor = document.getElementById('visor-proyecto');
        const img = visor?.querySelector('img');
        grid.addEventListener('click', (e) => {
            const b = e.target.closest('[data-ampliar]');
            if (!b || !visor?.showModal) return;
            img.src = b.dataset.ampliar;
            img.alt = b.querySelector('img')?.alt ?? '';
            visor.showModal();
        });
        visor?.querySelector('.visor__cerrar')?.addEventListener('click', () => visor.close());
        visor?.addEventListener('click', (e) => { if (e.target === visor) visor.close(); });
    }

    // Portada: "También desarrollamos: dashboards / sistemas POS / …" (cambia cada 2,6 s)
    const rotador = document.getElementById('hero-rotador');
    if (rotador && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const frases = (rotador.dataset.frases || '').split('|').filter(Boolean);
        let i = 0;
        setInterval(() => {
            rotador.classList.add('saliendo');
            setTimeout(() => { i = (i + 1) % frases.length; rotador.textContent = frases[i]; rotador.classList.remove('saliendo'); }, 260);
        }, 2600);
    }
})();
