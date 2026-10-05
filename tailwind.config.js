// tailwind.config.js — Compilación de estilos (reemplaza el CDN de desarrollo de Tailwind).
//
//   npm install          (una sola vez)
//   npm run css          (genera estilos/tailwind.css, minificado)
//   npm run css:vigilar  (recompila al guardar mientras editas)
//
// Los colores leen variables CSS de tema.css: en modo claro "white" pasa a ser la tinta oscura, los grises
// se invierten y los tonos claros (emerald-300, amber-300…) se oscurecen para leerse sobre blanco.
// estilos/tailwind.css SÍ se sube al repositorio: GitHub Pages publica archivos, no ejecuta compilaciones.

const variable = (nombre) => `rgb(var(--${nombre}) / <alpha-value>)`;
const escala = (prefijo, tonos) => Object.fromEntries(tonos.map((t) => [t, variable(`${prefijo}${t}`)]));

module.exports = {
    // Solo las páginas y scripts que usan clases de Tailwind (las páginas p/ tienen su propio CSS)
    content: ['./index.html', './admin.html', './portal.html', './cliente.html', './app.js', './admin.js', './portal.js', './copiloto.js',
        './ui.js', './tema.js', './cliente.js', './carrito.js', './soporte.js', './sesion.js'],
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
