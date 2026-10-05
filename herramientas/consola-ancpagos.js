// Extrae el catálogo y el flujo de ancpagos.com desde la consola de Chrome.
// Uso: abre https://ancpagos.com, F12 → Consola, pega TODO este archivo y Enter.
// Solo LEE (peticiones GET del mismo sitio, una cada 400 ms). No envía formularios ni toca el carrito.
// En páginas de cuenta (mis_cuentas, pedidos, perfil) guarda solo la estructura, nunca el texto.
// Al terminar descarga ancpagos-flujo.json y lo deja copiado en el portapapeles.
(async () => {
    const MAX_PAGINAS = 150;
    const PAUSA_MS = 400;
    const PRIVADAS = /mis_cuentas|cuenta|perfil|pedido|logout|salir|cerrar/i;
    const NO_VISITAR = /logout|salir|cerrar_sesion|eliminar|borrar|\.(png|jpe?g|webp|svg|pdf|zip|js|css|json)(\?|$)/i;
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    const limpiar = (t) => (t ?? '').replace(/\s+/g, ' ').trim();

    // 1) Catálogo: variables globales de la página (const de nivel superior; la consola las ve por nombre)
    const leer = (nombre) => { try { return eval(`typeof ${nombre} !== 'undefined' ? ${nombre} : null`); } catch { return null; } };
    const VARIABLES = ['CATALOGO_INICIAL_IDX', 'STOCK_INICIAL_IDX', 'dictCategoriasPorProducto', 'COMBO_CANTIDAD_IDX', 'TARJETA_COMBO_IDX',
        'comboProductosPermitidosIdx', 'productosOcultosIdx', 'productosSinPaginaIdx', 'notasCatalogoIdx', 'imagenesProductoIdx', 'dictLogos', 'listaMusica'];
    const catalogo = Object.fromEntries(VARIABLES.map((n) => [n, leer(n)]));

    // 2) Estructura de una página: títulos, formularios (campos), botones, enlaces y scripts
    function analizar(doc, url) {
        const privada = PRIVADAS.test(url);
        const etiquetaDe = (el) => limpiar(el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.placeholder || el.name || el.id);
        return {
            url, titulo: limpiar(doc.title), privada,
            encabezados: [...doc.querySelectorAll('h1, h2, h3')].map((h) => `${h.tagName}: ${limpiar(h.textContent)}`).slice(0, 60),
            formularios: [...doc.querySelectorAll('form')].map((f) => ({
                id: f.id || null, accion: f.getAttribute('action'), metodo: (f.getAttribute('method') || 'get').toUpperCase(),
                campos: [...f.querySelectorAll('input, select, textarea')].filter((c) => c.type !== 'hidden')
                    .map((c) => ({ tipo: c.type || c.tagName.toLowerCase(), nombre: c.name || c.id || null, etiqueta: etiquetaDe(c), requerido: c.required })),
            })),
            // Campos fuera de <form> (pasos de checkout armados con JS)
            campos_sueltos: [...doc.querySelectorAll('input, select, textarea')].filter((c) => !c.closest('form') && c.type !== 'hidden')
                .map((c) => ({ tipo: c.type || c.tagName.toLowerCase(), nombre: c.name || c.id || null, etiqueta: etiquetaDe(c) })).slice(0, 80),
            botones: [...doc.querySelectorAll('button, [role="button"], a.btn, .btn')].map((b) => limpiar(b.textContent)).filter(Boolean).slice(0, 80),
            enlaces: [...new Set([...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')))].slice(0, 300),
            scripts: [...doc.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')),
            texto: privada ? null : limpiar(doc.body?.innerText ?? doc.body?.textContent).slice(0, 3000),
        };
    }

    // 3) Recorrido del sitio (mismo dominio), empezando por la página actual ya pintada
    const origen = location.origin;
    const normalizar = (href, base) => {
        try {
            const u = new URL(href, base);
            if (u.origin !== origen || NO_VISITAR.test(u.pathname)) return null;
            u.hash = '';
            return u.href;
        } catch { return null; }
    };
    const semillas = ['/', '/index', '/index?promo=1', '/checkout', '/login', '/registro', '/mis_cuentas', '/preguntas_frecuentes',
        '/tutoriales', '/novedades', '/resenas', '/blog'];
    const cola = [...new Set([location.href, ...semillas.map((s) => origen + s), ...[...document.querySelectorAll('a[href]')].map((a) => a.href)]
        .map((h) => normalizar(h, location.href)).filter(Boolean))];
    const vistas = new Set();
    const paginas = [];
    const parser = new DOMParser();
    paginas.push(analizar(document, location.href + ' (pintada)'));
    while (cola.length && paginas.length < MAX_PAGINAS) {
        const url = cola.shift();
        if (vistas.has(url)) continue;
        vistas.add(url);
        try {
            const r = await fetch(url, { credentials: 'same-origin', redirect: 'follow' });
            const tipo = r.headers.get('content-type') || '';
            if (!tipo.includes('html')) continue;
            const doc = parser.parseFromString(await r.text(), 'text/html');
            const p = analizar(doc, url);
            p.estado = r.status;
            p.redirige_a = r.redirected ? r.url : null;
            paginas.push(p);
            for (const href of p.enlaces) { const n = normalizar(href, url); if (n && !vistas.has(n) && !cola.includes(n)) cola.push(n); }
            console.log(`[${paginas.length}/${MAX_PAGINAS}] ${r.status} ${url}`);
        } catch (e) {
            paginas.push({ url, error: String(e) });
        }
        await esperar(PAUSA_MS);
    }

    // 4) Flujo: qué página lleva a cuál (solo enlaces internos)
    const flujo = paginas.filter((p) => p.enlaces).map((p) => ({
        desde: p.url, hacia: [...new Set(p.enlaces.map((h) => normalizar(h, p.url)).filter(Boolean))],
    }));
    const salida = { leido_at: new Date().toISOString(), sitio: origen, catalogo, paginas, flujo, pendientes_sin_visitar: cola };
    window.ancFlujo = salida; // para revisarlo en la consola sin abrir el archivo

    const json = JSON.stringify(salida, null, 2);
    try { copy(json); console.log('Copiado al portapapeles.'); } catch { /* copy() solo existe en la consola */ }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([json], { type: 'application/json' })), download: 'ancpagos-flujo.json' });
    document.body.appendChild(a); a.click(); a.remove();
    console.log(`Listo: ${paginas.length} páginas, ${Object.values(catalogo).filter(Boolean).length} variables de catálogo → ancpagos-flujo.json`);
})();
