// herramientas/disponibilidad.js — Aplica disponibilidad.json (lo que ya no hay en ANC ni en Emprende Red) en Node: páginas de Google,
// Shopping y bot. La tienda usa la misma regla en app.js (window.DCFiltrarDisponibles).
const fs = require('fs');
const path = require('path');

function cargar(raiz = path.resolve(__dirname, '..')) {
    try { return JSON.parse(fs.readFileSync(path.join(raiz, 'disponibilidad.json'), 'utf8')); } catch { return null; }
}

// Para lo que se publica (Google, Shopping): fuera lo oculto y los planes que ya no hay
function filtrar(productos, disp = cargar()) {
    if (!disp) return productos.filter((p) => !p.agotado);
    const ocultos = disp.ocultos ?? {}, planes = disp.variantes ?? {};
    return productos.filter((p) => !ocultos[p.id] && !p.agotado).map((p) => {
        const fuera = planes[p.id];
        if (!fuera) return p;
        const variantes = (p.variantes ?? []).filter((v) => !fuera[v.nombre]);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
}

// Para el bot: lo que no hay queda marcado (oculto + motivo) para que n8n lo siga sincronizando pero nunca lo ofrezca
function marcar(productos, disp = cargar()) {
    if (!disp) return productos;
    const ocultos = disp.ocultos ?? {}, planes = disp.variantes ?? {};
    return productos.map((p) => {
        if (ocultos[p.id]) return { ...p, oculto: true, no_disponible: ocultos[p.id] };
        const fuera = planes[p.id];
        if (!fuera) return p;
        const variantes = (p.variantes ?? []).filter((v) => !fuera[v.nombre]);
        return variantes.length ? { ...p, variantes } : { ...p, oculto: true, no_disponible: 'Sin planes disponibles' };
    });
}

module.exports = { cargar, filtrar, marcar };
