// tema.js — Tema claro / oscuro compartido por la tienda, el portal y el panel.
// Va en el <head> justo después del CDN de Tailwind (sin defer): aplica el tema ANTES de pintar,
// así no hay destello del tema equivocado.
//
// Cómo funciona: los colores de Tailwind leen variables CSS (tema.css). En modo claro, "white" pasa a
// ser la tinta oscura, los grises se invierten y los tonos claros (emerald-300, amber-300…) se oscurecen
// para que se lean sobre blanco. Así no hay que duplicar clases en el HTML ni en el JS.
(function () {
    const CLAVE = 'dc_tema';
    const variable = (nombre) => `rgb(var(--${nombre}) / <alpha-value>)`;
    const escala = (prefijo, tonos) => Object.fromEntries(tonos.map((t) => [t, variable(`${prefijo}${t}`)]));

    window.tailwind = window.tailwind || {};
    window.tailwind.config = {
        darkMode: 'class',
        theme: {
            extend: {
                colors: {
                    white: variable('tinta'),
                    dcRed: variable('rojo'),
                    dcRedDark: '#CC0029',
                    dcNeon: '#FF2A5F',
                    dcNeonDark: '#E50914',
                    dcDarkBg: variable('fondo'),
                    dcDarkCard: variable('tarjeta'),
                    dcBorder: variable('borde'),
                    neutral: escala('n', [200, 300, 400, 500, 600, 700, 800]),
                    emerald: escala('em', [200, 300, 400]),
                    amber: escala('am', [200, 300, 400]),
                    sky: escala('sk', [300, 400]),
                    red: escala('rj', [200, 300, 400]),
                    violet: escala('vi', [300, 400]),
                },
                fontFamily: {
                    sans: ['Inter', 'system-ui', 'sans-serif'],
                    tech: ['Outfit', 'Inter', 'sans-serif'],
                },
            },
        },
    };

    const raiz = document.documentElement;
    const sistemaClaro = window.matchMedia('(prefers-color-scheme: light)');
    const leer = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };
    const actual = () => (raiz.classList.contains('tema-claro') ? 'claro' : 'oscuro');

    function pintarBoton(boton) {
        const claro = actual() === 'claro';
        boton.innerHTML = `<i class="fa-solid ${claro ? 'fa-moon' : 'fa-sun'}"></i>`;
        boton.setAttribute('aria-label', claro ? 'Activar modo oscuro' : 'Activar modo claro');
        boton.setAttribute('title', claro ? 'Modo oscuro' : 'Modo claro');
        boton.setAttribute('aria-pressed', String(claro));
    }

    function aplicar(tema) {
        const claro = tema === 'claro';
        raiz.classList.toggle('tema-claro', claro);
        raiz.style.colorScheme = claro ? 'light' : 'dark';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', claro ? '#F4F6FB' : '#0B0F19');
        document.querySelectorAll('[data-alternar-tema]').forEach(pintarBoton);
    }

    function alternar() {
        const nuevo = actual() === 'claro' ? 'oscuro' : 'claro';
        try { localStorage.setItem(CLAVE, nuevo); } catch { /* sin almacenamiento: dura esta visita */ }
        // Transición de colores solo durante el cambio (no afecta las animaciones normales)
        raiz.classList.add('tema-cambiando');
        aplicar(nuevo);
        setTimeout(() => raiz.classList.remove('tema-cambiando'), 400);
    }

    aplicar(leer() ?? (sistemaClaro.matches ? 'claro' : 'oscuro'));

    // Sin elección guardada, sigue al sistema; con varias pestañas abiertas, se sincronizan
    sistemaClaro.addEventListener('change', (e) => { if (!leer()) aplicar(e.matches ? 'claro' : 'oscuro'); });
    window.addEventListener('storage', (e) => { if (e.key === CLAVE && e.newValue) aplicar(e.newValue); });

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-alternar-tema]').forEach((boton) => {
            pintarBoton(boton);
            boton.addEventListener('click', alternar);
        });
    });

    window.TemaDC = { actual, alternar };
})();
