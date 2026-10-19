// detalles.js — Detalles de uso de la tienda: barra de lectura, volver arriba, atajo "/" para buscar,
// encabezado compacto al bajar y aviso accesible del conteo del catálogo. Sin dependencias.
(() => {
    'use strict';
    const raiz = document.documentElement;

    /* Barra de lectura (línea de corriente bajo el encabezado) y botón "volver arriba" */
    const barra = document.createElement('div');
    barra.className = 'barra-lectura';
    barra.setAttribute('aria-hidden', 'true');
    document.body.appendChild(barra);
    const arriba = document.createElement('button');
    arriba.type = 'button';
    arriba.className = 'volver-arriba';
    arriba.setAttribute('aria-label', 'Volver arriba');
    arriba.innerHTML = '<i class="fa-solid fa-arrow-up" aria-hidden="true"></i>';
    arriba.hidden = true;
    document.body.appendChild(arriba);
    const suave = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    arriba.addEventListener('click', () => {
        scrollTo({ top: 0, behavior: suave ? 'smooth' : 'auto' });
        document.getElementById('searchInput')?.focus({ preventScroll: true });
    });
    let pendiente = false;
    let ultimaY = scrollY;
    const medir = () => {
        pendiente = false;
        const alto = raiz.scrollHeight - innerHeight;
        barra.style.transform = `scaleX(${alto > 0 ? Math.min(1, scrollY / alto) : 0})`;
        arriba.hidden = scrollY < innerHeight * 1.5;
        raiz.classList.toggle('bajando', scrollY > 120);
        // Menú inferior: se esconde al bajar (más espacio para ver productos) y vuelve al subir o al llegar al final
        const y = scrollY, final = y + innerHeight >= raiz.scrollHeight - 40;
        if (Math.abs(y - ultimaY) > 8) { raiz.classList.toggle('ocultar-menu', y > ultimaY && y > 220 && !final); ultimaY = y; }
    };
    addEventListener('scroll', () => { if (!pendiente) { pendiente = true; requestAnimationFrame(medir); } }, { passive: true });
    addEventListener('resize', medir, { passive: true });
    medir();

    /* "/" enfoca el buscador (como en los sitios grandes); Esc lo limpia */
    document.addEventListener('keydown', (e) => {
        const campo = document.getElementById('searchInput');
        if (!campo) return;
        const escribiendo = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') || document.activeElement?.isContentEditable;
        if (e.key === '/' && !escribiendo && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            campo.focus();
            campo.select();
        } else if (e.key === 'Escape' && document.activeElement === campo && campo.value) {
            campo.value = '';
            campo.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    /* El conteo del catálogo se anuncia a lectores de pantalla cuando cambia */
    const conteo = document.getElementById('product-count');
    if (conteo) { conteo.setAttribute('aria-live', 'polite'); conteo.setAttribute('aria-atomic', 'true'); }
})();
