// herramientas/versionar.js — Marca los estilos y scripts propios con ?v=<fecha> en las 4 páginas.
//
//   node herramientas/versionar.js
//
// Por qué: GitHub Pages deja que el navegador guarde cada archivo hasta 10 minutos (y algunos navegadores más).
// Si el nombre no cambia, el cliente sigue viendo el diseño o el código viejo después de publicar. Con ?v= distinto
// en cada publicación, el navegador pide los archivos nuevos. Ejecutar antes de cada push que cambie la web.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const PAGINAS = ['index.html', 'cliente.html', 'admin.html', 'portal.html'];
const ahora = new Date();
const version = ahora.toISOString().slice(0, 16).replace(/[-:T]/g, ''); // 202610151420
let total = 0;
for (const pagina of PAGINAS) {
    const ruta = path.join(RAIZ, pagina);
    const antes = fs.readFileSync(ruta, 'utf8');
    // Solo archivos locales (sin http): estilos/x.css, tema.css, app.js…
    const despues = antes.replace(/((?:href|src)=")((?!https?:|\/\/|data:)[\w./-]+\.(?:css|js))(?:\?v=\d+)?(")/g, (_, a, archivo, c) => {
        total++;
        return `${a}${archivo}?v=${version}${c}`;
    });
    if (despues !== antes) fs.writeFileSync(ruta, despues);
}
console.log(`versión ${version}: ${total} enlaces a estilos y scripts en ${PAGINAS.length} páginas`);
