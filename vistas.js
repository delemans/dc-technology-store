// vistas.js — La tienda por módulos (como el portal): Inicio · Catálogo · Servicios · Pedidos · Soporte.
// Cada <section data-vista="…"> pertenece a un módulo y solo se ve el módulo activo. Menú inferior con íconos en
// celular (.menu-modulos) y pestañas en PC (.modulos-nav). Cualquier enlace #id (o un scrollIntoView del código)
// abre primero el módulo que contiene esa sección. La dirección queda SIEMPRE limpia (dctecnology.xyz, sin #catalogo):
// el módulo se guarda en el historial (Atrás funciona) y los enlaces viejos con # se limpian al entrar.
// Dentro de un iframe (estudio de videos) se ve todo, como antes.
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
        if (a.closest('.menu-modulos')) navigator.vibrate?.(8); // toque con vibración suave, como una app
        raiz.classList.remove('ocultar-menu');
        const antes = actual;
        ir(hash);
        if (actual !== antes) history.pushState({ vista: actual }, '', limpia());
    });
    // Dirección limpia: solo la ruta (y ?pedido= si vino de un aviso de WhatsApp), nunca el #
    const limpia = () => location.pathname.replace(/index.html$/, '') + location.search;
    const limpiar = () => { if (location.hash) history.replaceState({ vista: actual }, '', limpia()); };
    // El logo lleva al inicio (sus 6 toques al panel siguen igual)
    document.getElementById('secret-admin-logo')?.addEventListener('click', () => {
        const destino = 'inicio';
        if (actual !== destino) { mostrar(destino); history.pushState({ vista: destino }, '', limpia()); }
    });
    // Un # puesto por el código (p. ej. "Ir a Soporte") abre su módulo y la dirección se limpia
    window.addEventListener('hashchange', () => { if (!location.hash) return; const antes = actual; ir(location.hash); if (actual !== antes) history.replaceState({ vista: actual }, '', location.href); setTimeout(limpiar, 400); });
    window.addEventListener('popstate', (e) => { if (e.state?.vista) mostrar(e.state.vista); else if (location.hash) ir(location.hash); else mostrar('inicio'); });

    // Al abrir: la dirección manda (#catalogo, #cuenta…); con ?pedido= va a Mis pedidos
    const inicial = new URLSearchParams(location.search).get('pedido') && !location.hash ? '#cuenta' : location.hash;
    raiz.classList.add('con-modulos');
    ir(inicial);
    history.replaceState({ vista: actual }, '', location.href);
    // Los demás scripts (Mis pedidos, Soporte) leen el # al cargar: se limpia un instante después
    setTimeout(limpiar, 800);
    window.DCVistas = { mostrar, ir, get actual() { return actual; } };
})();
