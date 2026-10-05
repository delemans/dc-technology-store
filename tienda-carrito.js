// tienda-carrito.js — La tienda (index.html) usa el MISMO carrito, combos y pago web del portal (carrito.js).
// Este archivo solo arma window.DC, la API que carrito.js espera, con lo que ya carga app.js
// (productos con precios de la base). Va después de app.js y antes de carrito.js.
// La verificación por WhatsApp (OTP) queda para "Mis pedidos" y soporte, en cliente.html.

(() => {
    const T = window.DCTienda;
    if (!T) return;
    const sb = typeof supabaseTienda !== 'undefined' ? supabaseTienda : null;
    const WA = window.PlantillasWA;
    const COTIZABLES = ['servicios', 'alquiler'];

    const estado = { metodos: [], reglasCombo: [], get productos() { return T.productos(); } };

    const precioCOP = (v) => (Number(v) > 0 ? WA.precioCOP(v) : 'A cotizar');
    const desdeDe = (p) => {
        const precios = (p.variantes ?? []).map((v) => Number(v.precio)).filter((n) => n > 0);
        return precios.length ? Math.min(...precios) : 0;
    };
    const descuentoDe = (p) => Math.max(0, ...(p.variantes ?? []).map((v) => (Number(v.precio_anterior) > Number(v.precio) && v.precio > 0
        ? Math.round((1 - v.precio / v.precio_anterior) * 100) : 0)));
    const leerLocal = (clave, porDefecto) => { try { return JSON.parse(localStorage.getItem(clave)) ?? porDefecto; } catch { return porDefecto; } };
    const guardarLocal = (clave, valor) => { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ } };

    /* ---------- Hoja modal del carrito (misma que el portal) ---------- */
    let alCerrarHoja = null;
    function abrirHoja(titulo, contenido, { alCerrar } = {}) {
        const hoja = document.getElementById('hoja');
        document.getElementById('hoja-titulo').textContent = titulo;
        const cuerpo = document.getElementById('hoja-cuerpo');
        if (typeof contenido === 'string') cuerpo.innerHTML = contenido;
        else cuerpo.replaceChildren(contenido);
        alCerrarHoja = alCerrar ?? null;
        hoja.classList.remove('cerrando');
        hoja.hidden = false;
        document.body.style.overflow = 'hidden';
        hoja.querySelector('.hoja-panel').scrollTop = 0;
        return cuerpo;
    }
    function cerrarHoja() {
        const hoja = document.getElementById('hoja');
        if (hoja.hidden || hoja.classList.contains('cerrando')) return;
        hoja.classList.add('cerrando');
        setTimeout(() => {
            hoja.hidden = true;
            hoja.classList.remove('cerrando');
            document.body.style.overflow = '';
            alCerrarHoja?.();
            alCerrarHoja = null;
        }, 220);
    }

    /* ---------- Tarjeta del armador de combos (misma del portal) ---------- */
    function tarjetaProducto(p, { alElegir, elegido = false, icono = 'fa-plus' } = {}) {
        const desc = descuentoDe(p);
        const t = document.createElement('article');
        t.className = `prod${elegido ? ' elegido' : ''}`;
        t.innerHTML = `
            ${desc ? `<span class="desc">-${desc}%</span>` : ''}
            <span class="marca-check" aria-hidden="true"><i class="fa-solid fa-check text-xs"></i></span>
            <div class="vitrina"><img src="${escaparHTML(p.imagen)}" alt="${escaparHTML(p.nombre)}" loading="lazy" decoding="async"></div>
            <h3>${escaparHTML(p.nombre)}</h3>
            <div class="precio">
                <span><small>${COTIZABLES.includes(p.tipo) ? 'Cotiza' : (p.variantes ?? []).length > 1 ? 'Desde' : 'Precio'}</small><b>${escaparHTML(precioCOP(desdeDe(p)))}</b></span>
                <button type="button" class="agregar" aria-label="${elegido ? 'Quitar' : 'Elegir'} ${escaparHTML(p.nombre)}"><i class="fa-solid ${icono}"></i></button>
            </div>`;
        const img = t.querySelector('img');
        img.addEventListener('error', () => { img.src = 'https://i.ibb.co/LDN4xyW0/Mesa-de-trabajo-1.png'; }, { once: true });
        const accion = (e) => { e.stopPropagation(); (alElegir ?? ((x) => T.abrirProducto(x.id)))(p, t); };
        t.querySelector('.agregar').addEventListener('click', accion);
        t.addEventListener('click', accion);
        return t;
    }

    window.DC = {
        estado, sb, WA, abrirHoja, cerrarHoja, tarjetaProducto, abrirProducto: (p) => T.abrirProducto(p.id),
        precioCOP, desdeDe, leerLocal, guardarLocal, COTIZABLES,
        rutaPedidos: 'cliente.html#cuenta', // el seguimiento con OTP vive en el portal
    };

    // Formas de pago activas y descuentos por combo (mismas RPC públicas que el portal)
    if (sb) {
        sb.rpc('metodos_pago_publicos').then(({ data }) => { estado.metodos = data ?? []; });
        sb.rpc('reglas_combo_publicas').then(({ data }) => {
            estado.reglasCombo = (data ?? []).map((r) => ({ min: Number(r.min_plataformas), pct: Number(r.descuento_pct) })).filter((r) => r.min >= 2 && r.pct > 0);
            document.dispatchEvent(new CustomEvent('dc:reglas-combo'));
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-cerrar-hoja]').forEach((el) => el.addEventListener('click', cerrarHoja));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarHoja(); });
        // El armador de combos se repinta al abrir la sección (con los precios y reglas ya cargados)
        document.getElementById('combos-caja')?.addEventListener('toggle', (e) => {
            if (e.target.open) document.dispatchEvent(new CustomEvent('dc:vista', { detail: 'combos' }));
        });
    });
})();
