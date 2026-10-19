// vistas.js — La tienda por módulos (como el portal): Inicio · Catálogo · Servicios · Pedidos · Soporte.
// Cada <section data-vista="…"> pertenece a un módulo y solo se ve el módulo activo. Menú inferior con íconos en
// celular (.menu-modulos) y pestañas en PC (.modulos-nav). Cualquier enlace #id (o un scrollIntoView del código)
// abre primero el módulo que contiene esa sección. Dentro de un iframe (estudio de videos) se ve todo, como antes.
(() => {
    'use strict';
    if (window.top !== window) return;
    const raiz = document.documentElement;
    const VISTAS = ['inicio', 'catalogo', 'servicios', 'cuenta', 'soporte'];
    const TITULOS = { inicio: 'Inicio', catalogo: 'Catálogo', servicios: 'Servicios', cuenta: 'Mis pedidos', soporte: 'Soporte' };
    const tituloBase = document.title;
    let actual = null;

    const vistaDe = (el) => el?.closest?.('[data-vista]')?.dataset.vista ?? null;
    const destinoDe = (hash) => {
        const id = decodeURIComponent(String(hash ?? '').replace(/^#/, ''));
        if (!id) return { vista: 'inicio', el: null };
        if (VISTAS.includes(id) && !document.getElementById(id)?.closest('[data-vista]')) return { vista: id, el: null };
        const el = document.getElementById(id);
        return { vista: vistaDe(el) ?? (VISTAS.includes(id) ? id : null), el };
    };

    function mostrar(vista, { arriba = true } = {}) {
        if (!VISTAS.includes(vista)) return;
        const cambia = vista !== actual;
        actual = vista;
        raiz.dataset.vistaActiva = vista;
        document.querySelectorAll('[data-ir-vista]').forEach((a) => {
            const activo = a.dataset.irVista === vista;
            a.classList.toggle('activo', activo);
            if (activo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
        document.title = vista === 'inicio' ? tituloBase : `${TITULOS[vista]} · DC Tecnology`;
        if (cambia) {
            if (arriba) scrollTo({ top: 0, behavior: 'auto' });
            // Las secciones que aparecen al bajar (efectos.js) se muestran de una vez en el módulo nuevo
            document.querySelectorAll(`[data-vista="${vista}"]`).forEach((s) => s.classList.add('visible'));
            document.dispatchEvent(new CustomEvent('dc:modulo', { detail: vista }));
        }
    }

    // Enlace a una sección: abre su módulo y baja hasta ella (salvo que sea la primera del módulo)
    function ir(hash) {
        const { vista, el } = destinoDe(hash);
        if (!vista) return;
        mostrar(vista);
        const primera = document.querySelector(`[data-vista="${vista}"]`);
        if (el && el !== primera && !VISTAS.includes(el.id)) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
    }

    // Si el código pide ver un elemento de otro módulo (p. ej. "Ver catálogo"), primero se abre ese módulo
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
        const vista = vistaDe(this);
        if (vista && vista !== actual) mostrar(vista, { arriba: false });
        return original.apply(this, args);
    };

    document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a || e.defaultPrevented || e.ctrlKey || e.metaKey) return;
        const hash = a.getAttribute('href');
        if (hash === '#') return;
        const { vista } = destinoDe(hash);
        if (!vista) return;
        e.preventDefault();
        if (location.hash !== hash) history.pushState(null, '', hash);
        ir(hash);
        // Los demás módulos del sitio (Mis pedidos, Soporte) escuchan el cambio de dirección
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    // El logo lleva al inicio (sus 6 toques al panel siguen igual)
    document.getElementById('secret-admin-logo')?.addEventListener('click', () => {
        if (location.hash) history.pushState(null, '', location.pathname + location.search);
        mostrar('inicio');
    });
    window.addEventListener('hashchange', () => ir(location.hash));
    window.addEventListener('popstate', () => ir(location.hash));

    // Al abrir: la dirección manda (#catalogo, #cuenta…); con ?pedido= va a Mis pedidos
    const inicial = new URLSearchParams(location.search).get('pedido') && !location.hash ? '#cuenta' : location.hash;
    raiz.classList.add('con-modulos');
    ir(inicial);
    window.DCVistas = { mostrar, ir, get actual() { return actual; } };
})();
