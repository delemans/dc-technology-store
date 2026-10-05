// app.js — Tienda DC Technology (index.html)
// Catálogo tri-módulo, checkout por WhatsApp con cupones validados en Supabase,
// prueba social con datos reales, reseñas verificadas y datos estructurados para Google.

const SUPABASE_URL = 'https://vyqcizwfmjlflncdwzve.supabase.co';
const SUPABASE_CLAVE_PUBLICA = 'sb_publishable_GvQiv6M7iSrlwsA90lXsOQ_5OfSYBwy';
// La tienda funciona aunque Supabase no responda: solo se pierden cupones, reseñas y contadores
const supabaseTienda = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA) : null;
const WA = window.PlantillasWA;

const SITIO = 'https://dctecnology.xyz/';
const CUPON_PROMO = 'DCTECH2026';
const UMBRAL_PRUEBA_SOCIAL = 10;  // ventas completadas necesarias para mostrar cifras
const GARANTIA_DIAS = 30;
const CANTIDAD_MAXIMA = 10;

// Tri-módulo: qué tipos de productos.json van en cada pestaña
const MODULOS = {
    todos:     { titulo: 'Catálogo completo', tipos: null },
    digitales: { titulo: 'Productos digitales', tipos: ['streaming', 'licencias', 'pines', 'recargas'] },
    fisicos:   { titulo: 'Tecnología física', tipos: ['tecnologia'] },
    servicios: { titulo: 'Servicios técnicos', tipos: ['servicios', 'alquiler'] },
};
const CATEGORIAS = {
    streaming:  { icono: 'fa-tv',                texto: 'Streaming' },
    licencias:  { icono: 'fa-key',               texto: 'Licencias' },
    pines:      { icono: 'fa-gamepad',           texto: 'Pines virtuales' },
    recargas:   { icono: 'fa-mobile-screen',     texto: 'Recargas' },
    tecnologia: { icono: 'fa-headphones',        texto: 'Tecnología' },
    servicios:  { icono: 'fa-screwdriver-wrench', texto: 'Servicios' },
    alquiler:   { icono: 'fa-laptop',            texto: 'Alquiler de equipos' },
};

// Condiciones que el cliente acepta antes de comprar (mismas reglas que la garantía)
const TERMINOS = {
    cuentas: [
        'Esta cuenta es de <b>uso personal</b>: prohibido cambiar la contraseña, el correo o la facturación.',
        'Prohibido usar en más dispositivos de los permitidos por tu plan.',
        'Prohibido compartir, revender o transferir el acceso.',
        'Usa solo el perfil asignado, sin excepciones.',
        `Garantía de ${GARANTIA_DIAS} días desde la entrega, solo si se cumplen estas reglas.`,
    ],
    pines: [
        'El código o saldo se envía al número / cuenta que nos indiques: <b>verifica bien tus datos</b>.',
        'Las recargas y pines entregados <b>no son reversibles</b> ni tienen devolución.',
    ],
    tecnologia: [
        '<b>Revisa la compatibilidad</b> de voltaje, puerto y sistema con tu equipo antes de comprar.',
        'No uses cargadores rápidos de más de 5V/1A (5W): el exceso de voltaje daña la batería y anula la garantía.',
        `Garantía de ${GARANTIA_DIAS} días por defectos de fábrica; no cubre golpes, humedad ni mal uso.`,
    ],
    servicios: [
        'El valor mostrado es <b>estimado</b>: el precio final se confirma tras el diagnóstico.',
        'Agenda sujeta a disponibilidad; te confirmamos por WhatsApp.',
    ],
};

// Cómo trabajamos en servicios técnicos
const FASES_SERVICIO = [
    { icono: 'fa-comments',      titulo: 'Diagnóstico', texto: 'Nos cuentas qué necesitas por WhatsApp y revisamos el equipo o el proyecto.' },
    { icono: 'fa-file-invoice',  titulo: 'Cotización',  texto: 'Te enviamos el valor final y el tiempo estimado antes de empezar.' },
    { icono: 'fa-gears',         titulo: 'Ejecución',   texto: 'Mantenimiento, instalación o desarrollo, con avances por WhatsApp.' },
    { icono: 'fa-circle-check',  titulo: 'Entrega y soporte', texto: 'Pruebas contigo y soporte posterior para cualquier ajuste.' },
];

const estado = {
    productos: [],
    filtro: { modulo: 'todos', categoria: null, busqueda: '' },
    seleccion: { producto: null, variante: null, cantidad: 1, cupon: null },
    resenas: [],
};

/* ==================== UTILIDADES ==================== */

const $ = (id) => document.getElementById(id);

const formatearPrecio = (valor) => {
    const num = Number.parseFloat(valor);
    if (!Number.isFinite(num) || num === 0) return 'A cotizar';
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(num);
};

const imagenRespaldo = (nombre) =>
    `https://ui-avatars.com/api/?name=${encodeURIComponent(String(nombre).slice(0, 2))}&background=181B26&color=FF0033&font-size=0.4&bold=true`;

/* ---------- Fondos blancos → transparentes ----------
   Muchas fotos (smartwatches, audífonos) traen un cuadro blanco que rompe el vidrio oscuro.
   mix-blend-mode: multiply sobre #121826 borraría el blanco pero oscurecería todo el producto,
   así que se recorta de verdad: se rellena desde los bordes solo el blanco CONECTADO al borde
   (el blanco dentro del producto se conserva) y se suaviza el contorno. Requiere CORS (Tiendanube
   y Unsplash lo permiten); si algo falla, se muestra la imagen original. */
const fondosLimpios = new Map(); // src → Promise<dataURL | null>

function quitarFondoBlanco(im) {
    const escala = Math.min(1, 560 / Math.max(im.naturalWidth, im.naturalHeight));
    const w = Math.max(1, Math.round(im.naturalWidth * escala));
    const h = Math.max(1, Math.round(im.naturalHeight * escala));
    const lienzo = document.createElement('canvas');
    lienzo.width = w;
    lienzo.height = h;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(im, 0, 0, w, h);
    const datos = ctx.getImageData(0, 0, w, h);
    const px = datos.data;
    const esBlanco = (p) => {
        const i = p * 4;
        const min = Math.min(px[i], px[i + 1], px[i + 2]);
        return px[i + 3] > 20 && min >= 228 && Math.max(px[i], px[i + 1], px[i + 2]) - min <= 20;
    };

    // 1) Solo si el borde es mayoritariamente blanco (logos transparentes o de color no se tocan)
    const borde = [];
    for (let x = 0; x < w; x++) borde.push(x, (h - 1) * w + x);
    for (let y = 1; y < h - 1; y++) borde.push(y * w, y * w + w - 1);
    const blancos = borde.filter(esBlanco).length;
    if (blancos / borde.length < 0.6) return null;

    // 2) Relleno por inundación desde el borde
    const visto = new Uint8Array(w * h);
    const cola = new Int32Array(w * h);
    let ini = 0;
    let fin = 0;
    borde.forEach((p) => { if (!visto[p] && esBlanco(p)) { visto[p] = 1; cola[fin++] = p; } });
    while (ini < fin) {
        const p = cola[ini++];
        px[p * 4 + 3] = 0;
        const x = p % w;
        const vecinos = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w];
        for (const v of vecinos) {
            if (v >= 0 && v < w * h && !visto[v] && esBlanco(v)) { visto[v] = 1; cola[fin++] = v; }
        }
    }

    // 3) Contorno suave: los píxeles claros pegados al fondo quedan semitransparentes (sin halo blanco)
    for (let p = 0; p < w * h; p++) {
        if (visto[p]) continue;
        const x = p % w;
        if (!((x > 0 && visto[p - 1]) || (x < w - 1 && visto[p + 1]) || (p >= w && visto[p - w]) || (p + w < w * h && visto[p + w]))) continue;
        const i = p * 4;
        const min = Math.min(px[i], px[i + 1], px[i + 2]);
        if (min > 170) px[i + 3] = Math.min(px[i + 3], Math.round(255 * (255 - min) / 85));
    }
    ctx.putImageData(datos, 0, 0);
    return lienzo.toDataURL('image/webp', 0.92); // Safari sin WebP → devuelve PNG automáticamente
}

function fondoLimpio(src) {
    if (!fondosLimpios.has(src)) {
        fondosLimpios.set(src, new Promise((resolve) => {
            const im = new Image();
            im.crossOrigin = 'anonymous';
            im.decoding = 'async';
            im.onload = () => {
                // Fuera del hilo de pintura inmediato para no trabar el scroll
                (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 0)))(() => {
                    try { resolve(quitarFondoBlanco(im)); } catch { resolve(null); } // canvas "contaminado" (sin CORS)
                }, { timeout: 600 });
            };
            im.onerror = () => resolve(null);
            im.src = src;
        }));
    }
    return fondosLimpios.get(src);
}

// La imagen queda oculta hasta tener su versión limpia (o 1,5 s como máximo): sin destello del cuadro blanco
function prepararImagen(img, src) {
    if (!src || src.startsWith('data:') || src.includes('ui-avatars.com')) return;
    img.classList.add('limpiando');
    const mostrar = (limpia) => {
        if (!img.classList.contains('limpiando')) return;
        if (limpia) { img.src = limpia; img.classList.add('sin-fondo'); }
        img.classList.remove('limpiando');
    };
    let tope = null;
    // El tope cuenta desde que la imagen cargó (con lazy puede tardar en empezar)
    const empezar = () => {
        tope = setTimeout(() => mostrar(null), 1500);
        fondoLimpio(src).then((limpia) => { clearTimeout(tope); mostrar(limpia); });
    };
    // Con loading="lazy" se espera a que el navegador decida cargarla (la tarjeta ya está cerca)
    if (img.complete && img.naturalWidth) empezar();
    else img.addEventListener('load', empezar, { once: true });
    img.addEventListener('error', () => { clearTimeout(tope); img.classList.remove('limpiando'); }, { once: true });
}

// Pantallas táctiles (sin hover): cada tarjeta da su giro 360° una vez, al entrar en pantalla
const observadorGiro = window.matchMedia('(hover: none)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    && 'IntersectionObserver' in window
    ? new IntersectionObserver((entradas) => {
        entradas.forEach((e) => {
            if (!e.isIntersecting) return;
            observadorGiro.unobserve(e.target);
            const img = e.target.querySelector('.marco-img img');
            if (!img) return;
            const girar = () => {
                img.classList.add('girar');
                img.addEventListener('animationend', () => img.classList.remove('girar'), { once: true });
            };
            // Si todavía está quitando el fondo blanco, gira cuando ya sea visible
            if (img.classList.contains('limpiando')) setTimeout(girar, 700);
            else girar();
        });
    }, { threshold: 0.6 })
    : null;

// Auto-categorizador robusto (para productos sin 'tipo' o con tipo 'digital')
function clasificarCategoria(prod) {
    if (prod.tipo && prod.tipo !== 'digital') return prod.tipo;
    const id = (prod.id || '').toLowerCase();
    if (['reloj', 'smartwatch', 'diadema', 'auricular', 'powerbank'].some((k) => id.includes(k))) return 'tecnologia';
    if (id.includes('pin-') || id.startsWith('pin')) return 'pines';
    if (['recarga', 'free-fire', 'directv-prepago'].some((k) => id.includes(k))) return 'recargas';
    if (['office', 'windows', 'canva', 'capcut', 'duolingo', 'mcafee', 'gemini'].some((k) => id.includes(k))) return 'licencias';
    return 'streaming';
}

function moduloDe(tipo) {
    return Object.keys(MODULOS).find((m) => MODULOS[m].tipos?.includes(tipo)) ?? 'digitales';
}

function grupoTerminos(tipo) {
    if (tipo === 'streaming' || tipo === 'licencias') return 'cuentas';
    if (tipo === 'pines' || tipo === 'recargas') return 'pines';
    if (tipo === 'tecnologia') return 'tecnologia';
    return 'servicios';
}

const esCotizable = (prod) => prod.tipo === 'servicios' || prod.tipo === 'alquiler';

// Insignias según el tipo: solo afirmaciones respaldadas por la operación real
function insignias(prod) {
    const lista = [];
    const variantes = (prod.variantes || []).map((v) => (v.nombre || '').toLowerCase()).join(' ');
    if (moduloDe(prod.tipo) === 'digitales') lista.push({ icono: 'fa-bolt', texto: 'Entrega ≤ 15 min', clase: 'text-amber-300 ring-amber-500/30 bg-amber-500/10' });
    if (prod.tipo === 'streaming') {
        if (/pantalla|perfil/.test(variantes)) lista.push({ icono: 'fa-user', texto: 'Perfil / pantalla', clase: 'text-sky-300 ring-sky-500/30 bg-sky-500/10' });
        if (/cuenta completa/.test(variantes)) lista.push({ icono: 'fa-users', texto: 'Cuenta completa', clase: 'text-sky-300 ring-sky-500/30 bg-sky-500/10' });
        lista.push({ icono: 'fa-display', texto: 'TV · Celular · PC', clase: 'text-neutral-300 ring-white/10 bg-white/[0.04]' });
    }
    if (prod.tipo === 'streaming' || prod.tipo === 'licencias' || prod.tipo === 'tecnologia') {
        lista.push({ icono: 'fa-shield-halved', texto: `Garantía ${GARANTIA_DIAS} días`, clase: 'text-emerald-300 ring-emerald-500/30 bg-emerald-500/10' });
    }
    if (prod.tipo === 'tecnologia') lista.push({ icono: 'fa-truck-fast', texto: 'Envíos a todo el país', clase: 'text-neutral-300 ring-white/10 bg-white/[0.04]' });
    if (esCotizable(prod)) lista.push({ icono: 'fa-calendar-check', texto: 'Agenda por WhatsApp', clase: 'text-neutral-300 ring-white/10 bg-white/[0.04]' });
    return lista;
}

const htmlInsignia = ({ icono, texto, clase }) =>
    `<span class="insignia inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ring-1 text-[10px] font-bold ${clase}"><i class="fa-solid ${icono}"></i>${escaparHTML(texto)}</span>`;

/* ==================== CATÁLOGO ==================== */

async function cargarCatalogo() {
    const grid = $('product-grid');
    grid.innerHTML = Array.from({ length: 8 }, () => `
        <div class="rounded-3xl bg-white/[0.03] ring-1 ring-white/10 p-4 space-y-3" aria-hidden="true">
            <div class="skeleton h-[8.25rem] rounded-2xl"></div><div class="skeleton h-3 w-20 rounded"></div>
            <div class="skeleton h-5 w-3/4 rounded"></div><div class="skeleton h-12 rounded-2xl"></div>
        </div>`).join('');

    try {
        const respuesta = await fetch('productos.json');
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        const datos = await respuesta.json();
        estado.productos = await aplicarPreciosBase(datos.map((p) => ({ ...p, tipo: clasificarCategoria(p) })));
    } catch (error) {
        console.error('Error al cargar productos.json', error);
        grid.innerHTML = `<p class="col-span-full rounded-3xl bg-red-500/10 ring-1 ring-red-500/30 p-6 text-center text-sm text-red-200">No pudimos cargar el catálogo. Recarga la página o escríbenos por WhatsApp.</p>`;
        return;
    }

    pintarModulos();
    renderizar();
    pintarCotizador();
    inyectarSEO();
    abrirDesdeEnlace();
    cargarPromocionesDia();
    cargarFormasDePago();
    document.dispatchEvent(new CustomEvent('dc:catalogo-listo')); // carrito.js: armador de combos
}

// Precios vigentes DESDE LA BASE (wo-032), los mismos que cobra el servidor al crear la orden web.
// Un producto que está en la base solo muestra sus variantes activas; uno que aún no está conserva
// productos.json. Si la base no responde en 3 s se pinta con productos.json (el servidor igual cobra lo de la base).
async function aplicarPreciosBase(productos) {
    if (!supabaseTienda) return productos;
    const consulta = supabaseTienda.rpc('precios_publicos').then(({ data, error }) => (error ? null : data));
    const data = await Promise.race([consulta, new Promise((r) => setTimeout(() => r(null), 3000))]).catch(() => null);
    if (!Array.isArray(data) || !data.length) return productos;
    const porProducto = new Map();
    data.forEach((x) => porProducto.set(x.producto_id, [...(porProducto.get(x.producto_id) ?? []), x]));
    return productos.map((p) => {
        const base = porProducto.get(p.id);
        if (!base) return p;
        const variantes = (p.variantes ?? []).map((v) => {
            const b = base.find((x) => x.variante === v.nombre);
            return b ? { ...v, precio: Number(b.precio), precio_anterior: b.precio_anterior === null ? null : Number(b.precio_anterior) } : null;
        }).filter(Boolean);
        return variantes.length ? { ...p, variantes } : null;
    }).filter(Boolean);
}

/* ==================== FORMAS DE PAGO (supabase/wo-027-metodos-pago.sql) ==================== */

// Solo tipo, nombre, moneda y red de los métodos ACTIVOS: los datos de cuenta los da el bot al pagar
async function cargarFormasDePago() {
    if (!supabaseTienda) return;
    const { data, error } = await supabaseTienda.rpc('metodos_pago_publicos');
    if (error) {
        if (error.code !== 'PGRST202') console.warn('metodos_pago_publicos:', error.message);
        return;
    }
    estado.metodosPago = data ?? [];
    const seccion = $('formas-pago');
    if (seccion && estado.metodosPago.length) {
        $('formas-pago-lista').innerHTML = htmlFormasDePago(estado.metodosPago);
        seccion.hidden = false;
    }
    // Si un producto ya estaba abierto (enlace directo ?producto=), se completa su bloque de pagos
    if (!$('product-modal').hidden && estado.seleccion.producto) pintarDescripcion(estado.seleccion.producto);
}

/* ==================== PROMOCIONES DEL DÍA (supabase/wo-025-promociones.sql) ==================== */

let relojPromos = null;

// Solo productos que el administrador marcó y que siguen vigentes; precios y descuentos del catálogo
async function cargarPromocionesDia() {
    const seccion = $('promociones-dia');
    if (!seccion || !supabaseTienda) return;
    const { data, error } = await supabaseTienda.rpc('promociones_del_dia');
    const porId = new Map(estado.productos.map((p) => [p.id, p]));
    const vigentes = (error ? [] : data ?? []).filter((d) => porId.has(d.producto_id) && new Date(d.vence_at).getTime() > Date.now());
    if (error && error.code !== 'PGRST202') console.warn('promociones_del_dia:', error.message);
    estado.promociones = vigentes.map((d) => porId.get(d.producto_id));
    clearInterval(relojPromos);
    if (!vigentes.length) {
        seccion.hidden = true;
        return;
    }

    // Tarjetas propias (no las del catálogo: un mismo nodo no puede estar en dos lugares)
    $('promos-grid').replaceChildren(...estado.promociones.map((p) => {
        const t = crearTarjeta(p);
        t.insertAdjacentHTML('afterbegin', '<span class="cinta-promo"><i class="fa-solid fa-fire"></i> Promo del día</span>');
        return t;
    }));
    seccion.hidden = false;

    // Cuenta regresiva real: hasta el vencimiento más próximo guardado en la base (medianoche de Colombia)
    const fin = Math.min(...vigentes.map((d) => new Date(d.vence_at).getTime()));
    const pintar = () => {
        const s = Math.max(0, Math.floor((fin - Date.now()) / 1000));
        $('promos-reloj').textContent = [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
        if (s === 0) {
            clearInterval(relojPromos);
            seccion.hidden = true;
            setTimeout(cargarPromocionesDia, 5000); // por si quedan otras vigentes
        }
    };
    pintar();
    relojPromos = setInterval(pintar, 1000);
}

function productosFiltrados() {
    const { modulo, categoria, busqueda } = estado.filtro;
    return estado.productos.filter((p) => {
        if (busqueda) {
            return `${p.nombre} ${p.marca ?? ''} ${p.tipo}`.toLowerCase().includes(busqueda);
        }
        if (MODULOS[modulo].tipos && !MODULOS[modulo].tipos.includes(p.tipo)) return false;
        if (categoria && p.tipo !== categoria) return false;
        return true;
    });
}

function pintarModulos() {
    document.querySelectorAll('[data-modulo]').forEach((btn) => {
        const activo = !estado.filtro.busqueda && btn.dataset.modulo === estado.filtro.modulo;
        btn.setAttribute('aria-selected', String(activo));
        btn.className = `min-h-[52px] rounded-2xl text-xs font-black uppercase tracking-wider transition-all ${
            activo ? 'bg-dcRed text-white shadow-[0_0_24px_rgba(255,0,51,.45)]' : 'text-neutral-400 hover:text-white hover:bg-white/5'}`;
    });

    // Chips de categoría del módulo activo
    const tipos = MODULOS[estado.filtro.modulo].tipos ?? Object.keys(CATEGORIAS);
    const presentes = tipos.filter((t) => estado.productos.some((p) => p.tipo === t));
    $('chips').replaceChildren(...[null, ...presentes].map((tipo) => {
        const activo = estado.filtro.categoria === tipo && !estado.filtro.busqueda;
        const total = tipo ? estado.productos.filter((p) => p.tipo === tipo).length
            : estado.productos.filter((p) => !MODULOS[estado.filtro.modulo].tipos || MODULOS[estado.filtro.modulo].tipos.includes(p.tipo)).length;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `btn-cyber shrink-0 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-2xl ring-1 text-[11px] font-bold uppercase tracking-wider ${
            activo ? 'bg-dcRed/15 ring-dcRed/50 text-white' : 'bg-white/[0.03] ring-white/10 text-neutral-400 hover:text-white'}`;
        const info = tipo ? CATEGORIAS[tipo] : { icono: 'fa-layer-group', texto: 'Todas' };
        chip.innerHTML = `<i class="fa-solid ${info.icono} ${activo ? 'text-dcRed' : ''}"></i>${info.texto}<span class="px-1.5 py-0.5 rounded-md bg-white/10 text-[10px]">${total}</span>`;
        chip.addEventListener('click', () => {
            estado.filtro.categoria = tipo;
            renderizar();
        });
        return chip;
    }));
}

function renderizar() {
    const lista = productosFiltrados();
    const { modulo, categoria, busqueda } = estado.filtro;
    $('category-title').textContent = busqueda ? `Resultados para “${busqueda}”`
        : categoria ? CATEGORIAS[categoria].texto : MODULOS[modulo].titulo;
    $('product-count').textContent = `${lista.length} producto${lista.length === 1 ? '' : 's'}`;
    pintarModulos();

    const grid = $('product-grid');
    if (lista.length === 0) {
        grid.innerHTML = `
            <div class="col-span-full rounded-3xl bg-white/[0.02] border border-dashed border-white/10 p-10 text-center">
                <i class="fa-solid fa-magnifying-glass text-3xl text-neutral-600 mb-3"></i>
                <p class="font-bold">No encontramos productos.</p>
                <p class="text-xs text-neutral-500 mt-1">Prueba con otra búsqueda o pregúntale al Copiloto.</p>
            </div>`;
        return;
    }
    // Sin cambios en la lista (p. ej. un espacio extra en la búsqueda): no se toca el DOM
    const ids = lista.map((p) => p.id).join('|');
    if (ids === idsPintados && grid.querySelector('article')) return;
    const antes = new Set(idsPintados.split('|'));
    idsPintados = ids;

    // Las tarjetas se reutilizan: al filtrar no se recrean ni recargan imágenes (sin parpadeo)
    const tarjetas = lista.map((p) => {
        if (!tarjetasCache.has(p.id)) tarjetasCache.set(p.id, crearTarjeta(p));
        return tarjetasCache.get(p.id);
    });
    grid.replaceChildren(...tarjetas);
    // Solo entran animadas las que no estaban visibles antes
    tarjetas.filter((t, i) => !antes.has(lista[i].id)).forEach((t, i) => {
        t.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
            { duration: 340, delay: Math.min(i, 10) * 35, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    });
}
const tarjetasCache = new Map(); // id → <article>
let idsPintados = '';

function crearTarjeta(prod) {
    const base = prod.variantes?.[0] ?? { precio: 0 };
    const precios = (prod.variantes ?? []).map((v) => Number(v.precio)).filter((n) => n > 0);
    const desde = precios.length ? Math.min(...precios) : 0;
    const anterior = Number(base.precio_anterior) || 0;
    const descuento = anterior > Number(base.precio) && Number(base.precio) > 0
        ? Math.round(((anterior - base.precio) / anterior) * 100) : 0;
    const cotizacion = desde === 0;

    const tarjeta = document.createElement('article');
    // Digitales = logos de marca (marco compacto); tecnología y servicios = fotos (marco más alto)
    const esLogo = MODULOS.digitales.tipos.includes(prod.tipo);

    tarjeta.className = 'tarjeta-3d group relative overflow-hidden rounded-3xl p-4 flex flex-col cursor-pointer';
    tarjeta.tabIndex = 0;
    tarjeta.setAttribute('aria-label', `${prod.nombre}, ${cotizacion ? 'a cotizar' : `desde ${formatearPrecio(desde)}`}`);
    tarjeta.innerHTML = `
        <div class="brillo pointer-events-none absolute inset-0"></div>
        ${descuento ? `<span class="insignia-desc absolute top-3 left-3 z-10 px-2.5 py-1 rounded-full bg-gradient-to-br from-dcNeon to-dcNeonDark text-[10px] font-black shadow-[0_0_14px_rgba(255,42,95,.6)]">-${descuento}%</span>` : ''}
        <div class="marco-img ${esLogo ? 'marco-logo' : 'marco-foto'} mb-4">
            <img src="${escaparHTML(prod.imagen || imagenRespaldo(prod.nombre))}" alt="${escaparHTML(prod.nombre)}" loading="lazy" decoding="async"
                class="${esLogo ? '' : 'rounded-xl'}">
        </div>
        <p class="text-[10px] font-black uppercase tracking-[0.22em] text-dcNeon">${escaparHTML(prod.marca || 'DC Technology')}</p>
        <h3 class="mt-1 font-tech font-bold text-[15px] sm:text-base leading-snug text-white line-clamp-2">${escaparHTML(prod.nombre)}</h3>
        <div class="mt-2.5 flex flex-wrap gap-1.5">${insignias(prod).slice(0, 2).map(htmlInsignia).join('')}</div>
        <div class="mt-auto pt-4 border-t border-white/[0.06] flex items-end justify-between gap-3">
            <div class="min-w-0">
                <p class="text-[9px] font-bold uppercase tracking-[0.2em] text-neutral-500">${cotizacion ? 'Precio' : precios.length > 1 ? 'Desde' : 'Precio'}</p>
                <p class="mt-1 font-tech text-[22px] font-black text-white leading-none tracking-tight">${cotizacion ? 'A cotizar' : formatearPrecio(desde)}</p>
                ${descuento && Number(base.precio) === desde ? `<p class="mt-1 text-[11px] text-neutral-500"><span class="line-through">${formatearPrecio(anterior)}</span> <span class="ml-1 font-bold text-emerald-300">Ahorras ${formatearPrecio(anterior - base.precio)}</span></p>` : ''}
            </div>
            <span class="btn-neon shrink-0 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-2xl text-[11px] font-black uppercase tracking-[0.14em]">
                ${esCotizable(prod) ? 'Cotizar' : 'Comprar'} <i class="fa-solid fa-arrow-right"></i>
            </span>
        </div>`;
    const img = tarjeta.querySelector('img');
    img.addEventListener('error', () => { img.src = imagenRespaldo(prod.nombre); }, { once: true });
    prepararImagen(img, prod.imagen);
    observadorGiro?.observe(tarjeta);

    tarjeta.addEventListener('click', () => abrirProducto(prod.id));
    tarjeta.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirProducto(prod.id); } });
    activarInclinacion(tarjeta);
    return tarjeta;
}

// Inclinación 3D siguiendo el puntero (solo con ratón; en táctil no se activa)
function activarInclinacion(tarjeta) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let marco = null;
    tarjeta.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        cancelAnimationFrame(marco);
        marco = requestAnimationFrame(() => {
            const r = tarjeta.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width;
            const y = (e.clientY - r.top) / r.height;
            tarjeta.style.setProperty('--ry', `${(x - 0.5) * 10}deg`);
            tarjeta.style.setProperty('--rx', `${(0.5 - y) * 10}deg`);
            tarjeta.style.setProperty('--mx', `${x * 100}%`);
            tarjeta.style.setProperty('--my', `${y * 100}%`);
        });
    });
    tarjeta.addEventListener('pointerleave', () => {
        cancelAnimationFrame(marco);
        tarjeta.style.setProperty('--rx', '0deg');
        tarjeta.style.setProperty('--ry', '0deg');
    });
}

/* ==================== MODAL DE PRODUCTO ==================== */

function abrirProducto(id) {
    const prod = estado.productos.find((p) => p.id === id);
    if (!prod) return;
    const precioValido = (prod.variantes ?? []).find((v) => Number(v.precio) > 0) ?? prod.variantes?.[0];
    estado.seleccion = { producto: prod, variante: precioValido, cantidad: 1, cupon: estado.seleccion.cupon };

    $('modal-brand').textContent = prod.marca || 'DC Technology';
    $('modal-title').textContent = prod.nombre;
    metaProducto(prod);
    $('modal-badges').innerHTML = insignias(prod).map(htmlInsignia).join('');
    pintarGaleria(prod);
    pintarFicha(prod);
    pintarVariantes();
    pintarCupon();
    actualizarTotal();

    pintarDescripcion(prod);
    pintarResenasProducto(prod);

    // Servicios: la cantidad y el cupón no aplican (se cotiza)
    const cotizable = esCotizable(prod);
    $('form-cupon').parentElement.hidden = cotizable;
    if (cotizable) $('cupon-estado').hidden = true;
    $('btn-continuar').innerHTML = cotizable
        ? '<i class="fa-solid fa-calendar-check"></i> Cotizar y agendar'
        : '<i class="fa-solid fa-cart-shopping"></i> Continuar con la compra';

    try { history.replaceState(null, '', `?producto=${encodeURIComponent(prod.id)}`); } catch { /* sin historial */ }
    document.dispatchEvent(new CustomEvent('dc:producto-visto', { detail: prod }));
    abrirModal($('product-modal'));
}

function pintarGaleria(prod) {
    const imagenes = (Array.isArray(prod.imagenes) && prod.imagenes.length ? prod.imagenes : [prod.imagen]).filter(Boolean);
    if (!imagenes.length) imagenes.push(imagenRespaldo(prod.nombre));
    const galeria = $('galeria');

    galeria.replaceChildren(...imagenes.map((src, i) => {
        const caja = document.createElement('div');
        caja.className = 'zoom-caja snap-center shrink-0 w-full h-64 sm:h-80 grid place-items-center overflow-hidden rounded-2xl bg-gradient-to-b from-white/[0.04] to-transparent';
        caja.innerHTML = `<img src="${escaparHTML(src)}" alt="${escaparHTML(prod.nombre)} — imagen ${i + 1}" class="w-full h-full object-contain select-none transition-opacity duration-300" draggable="false">`;
        const img = caja.querySelector('img');
        img.addEventListener('error', () => { img.src = imagenRespaldo(prod.nombre); }, { once: true });
        prepararImagen(img, src);
        // Zoom: sigue el cursor en escritorio; toque para activar/desactivar en móvil
        caja.addEventListener('pointermove', (e) => {
            const r = caja.getBoundingClientRect();
            caja.style.setProperty('--zx', `${((e.clientX - r.left) / r.width) * 100}%`);
            caja.style.setProperty('--zy', `${((e.clientY - r.top) / r.height) * 100}%`);
            if (e.pointerType === 'mouse') caja.classList.add('activo');
        });
        caja.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') caja.classList.remove('activo'); });
        caja.addEventListener('click', () => caja.classList.toggle('activo'));
        return caja;
    }));

    // Miniaturas solo si hay varias imágenes (deslizar también funciona en móvil)
    const miniaturas = $('galeria-miniaturas');
    miniaturas.replaceChildren(...(imagenes.length > 1 ? imagenes.map((src, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-12 h-12 rounded-xl overflow-hidden ring-1 ring-white/10 hover:ring-dcRed';
        btn.setAttribute('aria-label', `Ver imagen ${i + 1}`);
        btn.innerHTML = `<img src="${escaparHTML(src)}" alt="" class="w-full h-full object-cover">`;
        btn.addEventListener('click', () => galeria.children[i].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }));
        return btn;
    }) : []));
    galeria.scrollLeft = 0;
}

/* ---------- Descripción del producto ----------
   Solo hechos de la operación real (los mismos del bot, las FAQ y los términos): cómo se compra, cómo se
   recibe y qué reglas aplican. Nada de especificaciones inventadas. */
const COMO_FUNCIONA = {
    streaming: [
        { icono: 'fa-cart-shopping', titulo: 'Pides', texto: 'Elige tu opción y confirmamos el pedido por WhatsApp.' },
        { icono: 'fa-mobile-screen-button', titulo: 'Pagas', texto: 'Con {pago} y nos envías el comprobante.' },
        { icono: 'fa-bolt', titulo: 'Recibes', texto: 'Tus accesos llegan por WhatsApp en máximo 15 minutos tras validar el pago.' },
        { icono: 'fa-tv', titulo: 'Disfrutas', texto: 'Inicia sesión en la app oficial y entra solo a tu perfil asignado.' },
    ],
    licencias: [
        { icono: 'fa-cart-shopping', titulo: 'Pides', texto: 'Elige la versión y confirmamos el pedido por WhatsApp.' },
        { icono: 'fa-mobile-screen-button', titulo: 'Pagas', texto: 'Con {pago} y nos envías el comprobante.' },
        { icono: 'fa-bolt', titulo: 'Recibes', texto: 'Tu licencia o acceso llega por WhatsApp en máximo 15 minutos tras validar el pago.' },
        { icono: 'fa-key', titulo: 'Activas', texto: 'Copia el serial sin espacios y pégalo en "Activar licencia" o "Canjear código".' },
    ],
    pines: [
        { icono: 'fa-cart-shopping', titulo: 'Pides', texto: 'Elige el valor y, si es una recarga, envíanos el número o ID exacto.' },
        { icono: 'fa-mobile-screen-button', titulo: 'Pagas', texto: 'Con {pago} y nos envías el comprobante.' },
        { icono: 'fa-bolt', titulo: 'Recibes', texto: 'El código o la recarga llegan en máximo 15 minutos tras validar el pago.' },
    ],
    tecnologia: [
        { icono: 'fa-cart-shopping', titulo: 'Pides', texto: 'Elige el producto y confirmamos disponibilidad por WhatsApp.' },
        { icono: 'fa-mobile-screen-button', titulo: 'Pagas', texto: 'Con {pago} y nos envías el comprobante.' },
        { icono: 'fa-truck-fast', titulo: 'Recibes', texto: 'Coordinamos el envío a tu ciudad por WhatsApp.' },
    ],
};
const pasosDe = (prod) => (esCotizable(prod) ? FASES_SERVICIO
    : COMO_FUNCIONA[prod.tipo] ?? COMO_FUNCIONA[prod.tipo === 'recargas' ? 'pines' : 'streaming']);

// Ícono según el título de cada punto de la descripción del catálogo
const ICONOS_DETALLE = [
    [/carga|bater|volt/i, 'fa-bolt'], [/tiempo|hora/i, 'fa-clock'], [/agua|ip6/i, 'fa-droplet'],
    [/garant/i, 'fa-shield-halved'], [/compat/i, 'fa-plug'], [/env[ií]o/i, 'fa-truck-fast'],
];

// Convierte la descripción HTML del catálogo ("• <strong>Título:</strong> texto<br>…") en puntos con ícono
function detallesCatalogo(html) {
    const lineas = String(html ?? '').split(/<br\s*\/?>/i).map((l) => l.trim()).filter(Boolean);
    const texto = (l) => new DOMParser().parseFromString(l, 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
    let encabezado = '';
    const puntos = [];
    lineas.forEach((l) => {
        const limpio = texto(l).replace(/^[•\-–]\s*/, '');
        if (!limpio) return;
        const conTitulo = /^([^:]{2,40}):\s*(.+)$/.exec(limpio);
        if (!/^[•\-–]/.test(texto(l)) && !puntos.length && !encabezado && /:$/.test(limpio)) { encabezado = limpio.replace(/:$/, ''); return; }
        puntos.push(conTitulo ? { titulo: conTitulo[1], texto: conTitulo[2] } : { titulo: '', texto: limpio });
    });
    return { encabezado, puntos };
}

function pintarDescripcion(prod) {
    const caja = $('modal-extra-info');
    const pasos = pasosDe(prod);
    const variantes = (prod.variantes ?? []).map((v) => String(v.nombre).toLowerCase()).join(' ');
    const reglas = TERMINOS[grupoTerminos(prod.tipo)] ?? [];
    const catalogo = prod.descripcion && prod.descripcion.trim().length > 20 ? detallesCatalogo(prod.descripcion) : null;
    const seccion = (icono, titulo, contenido) => `
        <section class="desc-seccion">
            <h4 class="desc-titulo"><i class="fa-solid ${icono}"></i>${escaparHTML(titulo)}</h4>
            ${contenido}
        </section>`;

    const bloques = [];
    bloques.push(seccion(esCotizable(prod) ? 'fa-diagram-project' : 'fa-route', esCotizable(prod) ? 'Así trabajamos' : 'Cómo funciona', `
        <ol class="desc-pasos">${pasos.map((p, i) => `
            <li style="--i:${i}">
                <span class="desc-paso-icono"><i class="fa-solid ${p.icono}"></i></span>
                <span><b>${escaparHTML(p.titulo)}</b><span class="block">${escaparHTML(p.texto.replace('{pago}', resumenFormasDePago(estado.metodosPago)))}</span></span>
            </li>`).join('')}
        </ol>`));

    // Streaming con ambas modalidades: se explica la diferencia (sale de los nombres reales de las variantes)
    if (prod.tipo === 'streaming' && /pantalla|perfil/.test(variantes) && /cuenta completa/.test(variantes)) {
        bloques.push(seccion('fa-layer-group', '¿Pantalla o cuenta completa?', `
            <div class="desc-comparar">
                <div><i class="fa-solid fa-user"></i><b>Pantalla / perfil</b><span>Un perfil de uso personal dentro de la cuenta.</span></div>
                <div><i class="fa-solid fa-users"></i><b>Cuenta completa</b><span>Toda la cuenta del plan para ti y tu hogar.</span></div>
            </div>`));
    }

    if (catalogo?.puntos.length) {
        bloques.push(seccion('fa-circle-info', catalogo.encabezado || 'Detalles del producto', `
            <ul class="desc-detalles">${catalogo.puntos.map((p) => {
                const icono = ICONOS_DETALLE.find(([re]) => re.test(p.titulo))?.[1] ?? 'fa-circle-check';
                return `<li><i class="fa-solid ${icono}"></i><span>${p.titulo ? `<b>${escaparHTML(p.titulo)}</b>` : ''}${escaparHTML(p.texto)}</span></li>`;
            }).join('')}
            </ul>`));
    }

    // Formas de pago activas (las configura el administrador; sin números ni direcciones)
    if (!esCotizable(prod) && estado.metodosPago?.length) {
        bloques.push(seccion('fa-wallet', 'Formas de pago', `<div class="space-y-3">${htmlFormasDePago(estado.metodosPago, { compacto: true })}</div>`));
    }

    if (reglas.length) {
        bloques.push(seccion('fa-scale-balanced', esCotizable(prod) ? 'Ten en cuenta' : 'Reglas y garantía', `
            <ul class="desc-reglas">${reglas.map((r) => `<li>${r}</li>`).join('')}</ul>`)); // TERMINOS: texto propio con <b>
    }
    caja.innerHTML = bloques.join('');
}

// Ficha técnica para productos físicos (datos del propio catálogo, sin inventar stock)
function pintarFicha(prod) {
    const caja = $('modal-ficha');
    if (prod.tipo !== 'tecnologia') {
        caja.innerHTML = '';
        return;
    }
    const texto = String(prod.descripcion ?? '').replace(/<[^>]+>/g, ' ');
    // Busca "Garantía: 30 días…" (con número), no el título "…USO Y GARANTÍA:"
    const garantia = /Garant[ií]a:?\s*(\d[^.•]*)/i.exec(texto)?.[1]?.trim() || `${GARANTIA_DIAS} días por defectos de fábrica`;
    const filas = [
        ['Marca', prod.marca || 'DC Technology'],
        ['Modelo', prod.nombre],
        ['Garantía', garantia],
        ['Disponibilidad', 'Confirmada por WhatsApp al pedir'],
    ];
    caja.innerHTML = `
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-2xl bg-dcDarkBg/60 ring-1 ring-white/5 p-4 text-xs">
            ${filas.map(([k, v]) => `<dt class="text-neutral-500 font-bold uppercase tracking-wider text-[10px] pt-0.5">${k}</dt><dd class="text-neutral-200">${escaparHTML(v)}</dd>`).join('')}
        </dl>`; // la compatibilidad y la garantía se explican en "Reglas y garantía" (pintarDescripcion)
}

function pintarVariantes() {
    const { producto, variante } = estado.seleccion;
    const variantes = producto.variantes ?? [];
    $('modal-variants').replaceChildren(...variantes.map((v, i) => {
        const activa = v === variante;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('aria-pressed', String(activa));
        btn.className = `w-full min-h-[52px] text-left px-4 rounded-2xl ring-1 flex items-center justify-between gap-3 transition-all ${
            activa ? 'bg-dcRed/15 ring-dcRed/60 text-white' : 'bg-dcDarkBg/60 ring-white/10 text-neutral-300 hover:ring-white/30'}`;
        btn.innerHTML = `
            <span class="flex items-center gap-3 min-w-0">
                <span class="shrink-0 w-4 h-4 rounded-full ring-2 ${activa ? 'ring-dcRed bg-dcRed' : 'ring-neutral-500'}"></span>
                <span class="text-sm font-bold truncate">${escaparHTML(v.nombre || `Opción ${i + 1}`)}</span>
            </span>
            <span class="shrink-0 text-sm font-black ${activa ? 'text-dcRed' : ''}">${formatearPrecio(v.precio)}</span>`;
        btn.addEventListener('click', () => {
            estado.seleccion.variante = v;
            pintarVariantes();
            actualizarTotal();
        });
        return btn;
    }));
}

function totales() {
    const { variante, cantidad, cupon } = estado.seleccion;
    const unitario = Number(variante?.precio) || 0;
    const anterior = Number(variante?.precio_anterior) || 0;
    const bruto = unitario * cantidad;
    const descuentoCupon = cupon ? Math.round((bruto * cupon.porcentaje) / 100) : 0;
    return { unitario, anterior, bruto, descuentoCupon, total: bruto - descuentoCupon };
}

function actualizarTotal() {
    const { producto, cantidad } = estado.seleccion;
    const t = totales();
    $('cantidad').textContent = cantidad;
    $('cantidad-menos').disabled = cantidad <= 1;
    $('cantidad-mas').disabled = cantidad >= CANTIDAD_MAXIMA || esCotizable(producto);

    const cotizable = esCotizable(producto);
    $('modal-price').innerHTML = t.unitario === 0 ? 'A cotizar'
        : `${cotizable ? '<span class="text-sm text-neutral-400 font-semibold mr-1">Desde</span>' : ''}${formatearPrecio(t.total)}`;

    const ahorroLista = t.anterior > t.unitario && t.unitario > 0 ? (t.anterior - t.unitario) * cantidad : 0;
    $('modal-old-price').hidden = !(ahorroLista || t.descuentoCupon);
    $('modal-old-price').textContent = formatearPrecio(ahorroLista ? t.anterior * cantidad : t.bruto);
    const ahorro = ahorroLista + t.descuentoCupon;
    $('modal-savings').hidden = !ahorro;
    $('modal-savings').textContent = ahorro ? `¡Ahorras ${formatearPrecio(ahorro)}!` : '';

    const badge = $('modal-discount-badge');
    badge.hidden = !(t.anterior > t.unitario && t.unitario > 0);
    if (!badge.hidden) badge.textContent = `-${Math.round(((t.anterior - t.unitario) / t.anterior) * 100)}%`;
}

function cambiarCantidad(delta) {
    const s = estado.seleccion;
    s.cantidad = Math.min(CANTIDAD_MAXIMA, Math.max(1, s.cantidad + delta));
    actualizarTotal();
}

/* ==================== CUPONES (validados en Supabase) ==================== */

function pintarCupon() {
    const { cupon } = estado.seleccion;
    const estadoCupon = $('cupon-estado');
    $('cupon').value = cupon?.codigo ?? '';
    estadoCupon.hidden = !cupon;
    if (cupon) {
        estadoCupon.className = '-mt-3 text-xs text-emerald-400 font-semibold';
        estadoCupon.innerHTML = `<i class="fa-solid fa-ticket mr-1"></i>${escaparHTML(cupon.codigo)}: -${cupon.porcentaje}% · ${escaparHTML(cupon.mensaje)}
            <button type="button" id="quitar-cupon" class="ml-2 underline text-neutral-400 hover:text-white">Quitar</button>`;
        $('quitar-cupon').addEventListener('click', () => {
            estado.seleccion.cupon = null;
            pintarCupon();
            actualizarTotal();
        });
    }
}

async function consultarCupon(codigo) {
    if (!supabaseTienda) return { valido: false, mensaje: 'No pudimos conectar para validar el cupón.' };
    const { data, error } = await supabaseTienda.rpc('validar_cupon', { p_codigo: codigo }).maybeSingle();
    if (error) {
        console.error('validar_cupon:', error);
        return { valido: false, mensaje: 'No pudimos validar el cupón en este momento.' };
    }
    if (!data) return { valido: false, mensaje: 'Cupón no válido.' };
    // Tolerante a versiones de la función que no devuelven 'mensaje'
    return { ...data, mensaje: data.mensaje ?? (data.valido ? 'Cupón aplicado.' : 'Este cupón no existe o ya fue usado.') };
}

async function aplicarCupon(e) {
    e.preventDefault();
    const codigo = $('cupon').value.trim().toUpperCase();
    const estadoCupon = $('cupon-estado');
    if (!codigo) return;

    const btn = $('btn-cupon');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    const r = await consultarCupon(codigo);
    btn.disabled = false;
    btn.textContent = 'Aplicar';

    if (r.valido) {
        estado.seleccion.cupon = { codigo, porcentaje: r.porcentaje, tipo: r.tipo, mensaje: r.mensaje };
        pintarCupon();
        actualizarTotal();
        mostrarToast(`Cupón ${codigo} aplicado: -${r.porcentaje}%`, 'ok');
    } else {
        estado.seleccion.cupon = null;
        actualizarTotal();
        estadoCupon.hidden = false;
        estadoCupon.className = '-mt-3 text-xs text-red-400 font-semibold';
        estadoCupon.textContent = r.mensaje || 'Cupón no válido.';
    }
}

// Marquesina: solo se anuncia el cupón si está vigente en la base de datos
async function pintarBannerPromo() {
    const r = await consultarCupon(CUPON_PROMO);
    if (!r.valido) return;
    const texto = `🔥 ${r.porcentaje}% OFF en tu primera compra con el código: ${CUPON_PROMO}`;
    const item = `<span class="px-8">${escaparHTML(texto)}</span><span class="px-8">⚡ Entrega inmediata · máximo 15 minutos</span>`;
    $('banner-promo-pista').innerHTML = item.repeat(4);
    $('banner-promo').hidden = false;
}

/* ==================== TÉRMINOS Y ENVÍO DEL PEDIDO ==================== */

function continuarCompra() {
    const { producto } = estado.seleccion;
    if (!producto) return;
    $('terminos-lista').innerHTML = TERMINOS[grupoTerminos(producto.tipo)]
        .map((t) => `<li class="flex items-start gap-3"><i class="fa-solid fa-circle-exclamation text-amber-400 mt-1"></i><span>${t}</span></li>`).join('');
    $('terminos-acepto').checked = false;
    // Carrito con pago en la web (carrito.js): para todo lo que tiene precio. Lo que se cotiza sigue por WhatsApp.
    const conCarrito = Boolean(window.Carrito) && !esCotizable(producto) && totales().unitario > 0;
    $('btn-terminos-carrito').hidden = !conCarrito;
    $('btn-terminos-whatsapp').innerHTML = conCarrito
        ? '<i class="fa-brands fa-whatsapp text-lg"></i> Prefiero pedir por WhatsApp'
        : '<i class="fa-brands fa-whatsapp text-lg"></i> Aceptar y pedir por WhatsApp';
    abrirModal($('modal-terminos'));
}

// Agrega la selección al carrito (una línea por unidad) y abre el pago paso a paso
async function agregarAlCarrito() {
    const acepto = $('terminos-acepto');
    if (!acepto.checked) { acepto.reportValidity(); acepto.focus(); return; }
    const { producto, variante, cantidad, cupon } = estado.seleccion;
    for (let i = 0; i < cantidad; i++) window.Carrito.agregar(producto, variante, { silencioso: true });
    if (cupon) window.Carrito.usarCupon(cupon);
    await cerrarModal($('modal-terminos'));
    await cerrarModal($('product-modal'));
    mostrarToast(`${producto.nombre} agregado al carrito`, 'ok', 2500);
    window.Carrito.abrir();
}

function enviarPedido(e) {
    e.preventDefault();
    if (!$('terminos-acepto').checked) return;
    const { producto, variante, cantidad, cupon } = estado.seleccion;
    const t = totales();

    let texto;
    if (esCotizable(producto)) {
        texto = WA.agendarServicio({ servicio: producto.nombre, opcion: variante?.nombre, estimado: t.unitario || undefined });
    } else {
        texto = WA.pedidoTienda({
            producto: producto.nombre,
            variante: variante?.nombre,
            cantidad,
            precioUnitario: t.unitario,
            cupon: cupon?.codigo,
            porcentaje: cupon?.porcentaje,
            total: t.total,
        });
    }
    window.open(WA.enlace(WA.NUMERO_TIENDA, texto), '_blank', 'noopener');
    cerrarModal($('modal-terminos'));
    mostrarToast('Abrimos WhatsApp con tu pedido listo. ¡Te atendemos enseguida!', 'ok', 5000);
}

/* ==================== SERVICIOS: FASES + COTIZADOR ==================== */

function pintarCotizador() {
    $('servicio-fases').innerHTML = FASES_SERVICIO.map((f, i) => `
        <li class="flex gap-4 rounded-2xl bg-dcDarkBg/60 ring-1 ring-white/5 p-4">
            <span class="shrink-0 grid place-items-center w-12 h-12 rounded-2xl bg-dcRed/10 ring-1 ring-dcRed/30 text-dcRed"><i class="fa-solid ${f.icono}"></i></span>
            <span><span class="block text-[10px] font-black uppercase tracking-widest text-neutral-500">Fase ${i + 1}</span>
            <span class="block font-tech font-bold text-base">${f.titulo}</span>
            <span class="block text-xs text-neutral-400 mt-0.5">${f.texto}</span></span>
        </li>`).join('');

    const servicios = estado.productos.filter(esCotizable);
    const selServicio = $('cot-servicio');
    selServicio.innerHTML = servicios.map((s) => `<option value="${escaparHTML(s.id)}">${escaparHTML(s.nombre)}</option>`).join('');
    const hoy = new Date();
    $('cot-fecha').min = new Date(hoy.getTime() - hoy.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

    const pintarOpciones = () => {
        const s = servicios.find((x) => x.id === selServicio.value);
        $('cot-opcion').innerHTML = (s?.variantes ?? []).map((v, i) => `<option value="${i}">${escaparHTML(v.nombre)} — ${formatearPrecio(v.precio)}</option>`).join('');
        recalcular();
    };
    const recalcular = () => {
        const s = servicios.find((x) => x.id === selServicio.value);
        const v = s?.variantes?.[Number($('cot-opcion').value)];
        const cantidad = Math.max(1, Math.min(50, Number.parseInt($('cot-cantidad').value, 10) || 1));
        $('cot-total').textContent = v && Number(v.precio) > 0 ? formatearPrecio(Number(v.precio) * cantidad) : 'A cotizar';
    };
    selServicio.addEventListener('change', pintarOpciones);
    $('cot-opcion').addEventListener('change', recalcular);
    $('cot-cantidad').addEventListener('input', recalcular);
    pintarOpciones();

    $('cotizador').addEventListener('submit', (e) => {
        e.preventDefault();
        const s = servicios.find((x) => x.id === selServicio.value);
        const v = s?.variantes?.[Number($('cot-opcion').value)];
        const cantidad = Math.max(1, Math.min(50, Number.parseInt($('cot-cantidad').value, 10) || 1));
        const fecha = $('cot-fecha').value
            ? new Date(`${$('cot-fecha').value}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
            : '';
        const texto = WA.agendarServicio({
            servicio: s?.nombre,
            opcion: v ? `${v.nombre}${cantidad > 1 ? ` × ${cantidad}` : ''}` : undefined,
            fecha,
            franja: $('cot-franja').value,
            detalle: $('cot-detalle').value.trim(),
            estimado: v && Number(v.precio) > 0 ? Number(v.precio) * cantidad : undefined,
        });
        window.open(WA.enlace(WA.NUMERO_TIENDA, texto), '_blank', 'noopener');
    });
}

/* ==================== PRUEBA SOCIAL Y RESEÑAS (datos reales) ==================== */

async function pintarPruebaSocial() {
    const caja = $('prueba-social');
    if (!supabaseTienda) return;
    const { data, error } = await supabaseTienda.rpc('estadisticas_publicas').maybeSingle();
    if (error || !data) {
        if (error) console.error('estadisticas_publicas:', error);
        return; // se queda el texto neutro
    }
    const ventas = Number(data.ventas_completadas) || 0;
    const resenas = Number(data.resenas) || 0;
    if (ventas < UMBRAL_PRUEBA_SOCIAL) return; // por debajo del umbral: texto neutro

    const partes = [`<span><i class="fa-solid fa-circle-check text-emerald-400 mr-1.5"></i><b class="text-white">${ventas.toLocaleString('es-CO')}</b> ventas completadas</span>`];
    if (resenas > 0 && data.promedio) {
        partes.push(`<span><i class="fa-solid fa-star text-amber-400 mr-1.5"></i><b class="text-white">${Number(data.promedio).toLocaleString('es-CO')}</b>/5 en ${resenas} reseña${resenas === 1 ? '' : 's'} verificada${resenas === 1 ? '' : 's'}</span>`);
    }
    caja.innerHTML = partes.join('<span class="text-neutral-600">·</span>');
}

const estrellas = (n) => Array.from({ length: 5 }, (_, i) =>
    `<i class="fa-${i < n ? 'solid' : 'regular'} fa-star ${i < n ? 'text-amber-400' : 'text-neutral-600'}"></i>`).join('');

function tarjetaResena(r) {
    const fecha = new Date(r.created_at).toLocaleDateString('es-CO', { month: 'short', year: 'numeric' });
    return `
        <article class="rounded-3xl bg-white/[0.03] backdrop-blur-xl ring-1 ring-white/10 p-5 flex flex-col gap-3">
            <div class="flex items-center justify-between gap-2 text-sm">${estrellas(r.calificacion)}<span class="text-[10px] text-neutral-500">${escaparHTML(fecha)}</span></div>
            ${r.comentario ? `<p class="text-sm text-neutral-300 leading-relaxed">“${escaparHTML(r.comentario)}”</p>` : ''}
            <div class="mt-auto flex flex-wrap items-center justify-between gap-2">
                <span class="text-xs font-bold">${escaparHTML(r.nombre_publico)}${r.producto ? ` <span class="text-neutral-500 font-medium">· ${escaparHTML(r.producto)}</span>` : ''}</span>
                <span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/30 text-emerald-300 text-[9px] font-black uppercase tracking-wider">
                    <i class="fa-solid fa-circle-check"></i> Compra verificada por DC Technology
                </span>
            </div>
        </article>`;
}

async function cargarResenas() {
    const caja = $('lista-resenas');
    const vacio = `
        <div class="sm:col-span-2 lg:col-span-3 rounded-3xl bg-white/[0.02] border border-dashed border-white/10 p-8 text-center">
            <i class="fa-regular fa-star text-3xl text-amber-400 mb-3"></i>
            <p class="font-bold">Aún no hay reseñas publicadas.</p>
            <p class="text-xs text-neutral-500 mt-1">Solo publicamos opiniones de compras verificadas. ¿Ya compraste? Califícala desde “Mi pedido”.</p>
        </div>`;
    if (!supabaseTienda) { caja.innerHTML = vacio; return; }

    const { data, error } = await supabaseTienda.rpc('resenas_publicas', { p_limite: 30 });
    if (error) console.error('resenas_publicas:', error);
    estado.resenas = data ?? [];
    caja.innerHTML = estado.resenas.length ? estado.resenas.slice(0, 9).map(tarjetaResena).join('') : vacio;
}

// En el modal: reseñas cuyo producto coincide con la marca o el nombre
function pintarResenasProducto(prod) {
    const claves = [prod.marca, prod.nombre.split(' ')[0]].filter(Boolean).map((s) => s.toLowerCase());
    const propias = estado.resenas.filter((r) => claves.some((k) => String(r.producto ?? '').toLowerCase().includes(k)));
    $('modal-resenas').innerHTML = propias.length ? `
        <h3 class="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-2">Opiniones de clientes (${propias.length})</h3>
        <div class="grid gap-3">${propias.slice(0, 3).map(tarjetaResena).join('')}</div>` : '';
}

/* ==================== SEO: DATOS ESTRUCTURADOS ==================== */

// Inyecta el catálogo real como ItemList de Product/Service con sus ofertas en COP
function inyectarSEO() {
    const elementos = estado.productos.map((p, i) => {
        const precios = (p.variantes ?? []).map((v) => Number(v.precio)).filter((n) => n > 0);
        const item = esCotizable(p)
            ? { '@type': 'Service', name: p.nombre, provider: { '@id': `${SITIO}#organizacion` }, areaServed: 'CO', image: p.imagen }
            : { '@type': 'Product', name: p.nombre, image: p.imagen, url: `${SITIO}p/${p.id}.html`, brand: { '@type': 'Brand', name: p.marca || 'DC Technology' }, category: CATEGORIAS[p.tipo]?.texto };
        if (precios.length) {
            item.offers = precios.length === 1
                ? { '@type': 'Offer', price: precios[0], priceCurrency: 'COP', availability: 'https://schema.org/InStock', url: `${SITIO}p/${p.id}.html` }
                : { '@type': 'AggregateOffer', lowPrice: Math.min(...precios), highPrice: Math.max(...precios), offerCount: precios.length, priceCurrency: 'COP', availability: 'https://schema.org/InStock' };
        }
        return { '@type': 'ListItem', position: i + 1, item };
    });

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Catálogo DC Technology', itemListElement: elementos });
    document.head.appendChild(script);
}

// Enlace directo: ?producto=netflix abre el producto (lo usan el Copiloto y los mensajes)
function abrirDesdeEnlace() {
    const id = new URLSearchParams(location.search).get('producto');
    if (id && estado.productos.some((p) => p.id === id)) abrirProducto(id);
}

/* ==================== MODALES ==================== */

function bloquearScroll(bloquear) {
    if (bloquear) {
        // Se compensa el ancho de la barra de scroll: el contenido de fondo no "salta"
        const barra = window.innerWidth - document.documentElement.clientWidth;
        if (barra > 0) document.body.style.paddingRight = `${barra}px`;
        document.body.style.overflow = 'hidden';
    } else {
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }
}

function abrirModal(modal) {
    // Si se estaba cerrando (doble clic rápido), se cancela el cierre y se reabre limpio
    if (modal.dataset.cerrando) {
        modal.getAnimations({ subtree: true }).forEach((a) => a.cancel());
        delete modal.dataset.cerrando;
        modal.hidden = true;
    }
    if (!modal.hidden) return;
    modal.hidden = false;
    bloquearScroll(true);
    modal.querySelector('.modal-fondo').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250 });
    modal.querySelector('.modal-panel').animate(
        [{ opacity: 0, transform: 'translateY(40px) scale(.98)' }, { opacity: 1, transform: 'none' }],
        { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

async function cerrarModal(modal) {
    if (!modal || modal.hidden || modal.dataset.cerrando) return;
    modal.dataset.cerrando = '1';
    try {
        await Promise.all([
            modal.querySelector('.modal-fondo').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished,
            modal.querySelector('.modal-panel').animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(40px) scale(.98)' }],
                { duration: 220, easing: 'ease-in', fill: 'forwards' }).finished,
        ]);
    } catch {
        return; // animación cancelada: el modal se reabrió mientras se cerraba
    }
    modal.hidden = true;
    delete modal.dataset.cerrando;
    modal.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    if (!document.querySelector('[role="dialog"]:not([hidden]):not(#hoja)')) bloquearScroll(false);
    if (modal.id === 'product-modal') {
        try { history.replaceState(null, '', location.pathname); } catch { /* sin historial */ }
        metaProducto(null);
    }
}

// SEO: con un producto abierto, título, descripción y canonical son los de su página indexable (p/<id>.html)
const META_INICIAL = {
    titulo: document.title,
    descripcion: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? SITIO,
};
function metaProducto(prod) {
    const descripcion = document.querySelector('meta[name="description"]');
    const canonical = document.querySelector('link[rel="canonical"]');
    if (!prod) {
        document.title = META_INICIAL.titulo;
        descripcion?.setAttribute('content', META_INICIAL.descripcion);
        canonical?.setAttribute('href', META_INICIAL.canonical);
        return;
    }
    const precios = (prod.variantes ?? []).map((v) => Number(v.precio)).filter((n) => n > 0);
    document.title = `${prod.nombre}${precios.length ? ` desde ${formatearPrecio(Math.min(...precios))}` : ''} | DC Technology`;
    descripcion?.setAttribute('content', `${prod.nombre} en DC Technology Colombia. Paga con ${resumenFormasDePago(estado.metodosPago)} y recibe soporte por WhatsApp.`);
    canonical?.setAttribute('href', `${SITIO}p/${prod.id}.html`);
}

/* ==================== ARRANQUE ==================== */

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-modulo]').forEach((btn) => btn.addEventListener('click', () => {
        estado.filtro = { modulo: btn.dataset.modulo, categoria: null, busqueda: '' };
        $('searchInput').value = '';
        renderizar();
    }));

    let espera;
    $('searchInput').addEventListener('input', (e) => {
        clearTimeout(espera);
        espera = setTimeout(() => {
            estado.filtro.busqueda = e.target.value.trim().toLowerCase();
            renderizar();
        }, 150);
    });

    document.querySelectorAll('[data-cerrar]').forEach((el) => el.addEventListener('click', () => cerrarModal(el.closest('[role="dialog"]'))));
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') [...document.querySelectorAll('[role="dialog"]:not([hidden]):not(#hoja)')].reverse().slice(0, 1).forEach(cerrarModal);
    });
    $('cantidad-menos').addEventListener('click', () => cambiarCantidad(-1));
    $('cantidad-mas').addEventListener('click', () => cambiarCantidad(1));
    $('form-cupon').addEventListener('submit', aplicarCupon);
    $('btn-continuar').addEventListener('click', continuarCompra);
    $('form-terminos').addEventListener('submit', enviarPedido);
    $('btn-terminos-carrito').addEventListener('click', agregarAlCarrito);

    // Acceso discreto al panel: 6 clics seguidos al logo (el panel igual exige iniciar sesión)
    let clicsLogo = 0;
    let temporizadorLogo = null;
    $('secret-admin-logo')?.addEventListener('click', (e) => {
        e.preventDefault();
        clicsLogo += 1;
        clearTimeout(temporizadorLogo);
        if (clicsLogo >= 6) window.location.href = 'admin.html';
        temporizadorLogo = setTimeout(() => { clicsLogo = 0; }, 2000);
    });

    cargarCatalogo();
    pintarBannerPromo();
    pintarPruebaSocial();
    cargarResenas();
});

// API mínima para copiloto.js
window.DCTienda = {
    productos: () => estado.productos,
    promociones: () => estado.promociones ?? [],
    metodosPago: () => estado.metodosPago ?? [],
    abrirProducto,
    productoActual: () => estado.seleccion.producto,
    formatearPrecio,
    moduloDe,
};
