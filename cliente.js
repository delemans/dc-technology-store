// cliente.js — Portal de clientes (cliente.html): navegación, catálogo, hoja modal y "Mis pedidos".
// carrito.js (carrito, combos y pago) y soporte.js (asistente de fallas) usan la API window.DC de este archivo.
// Datos reales: productos.json (catálogo), RPC públicas de Supabase (promociones, formas de pago, cupón, pedidos).

const SUPABASE_URL = 'https://vyqcizwfmjlflncdwzve.supabase.co';
const SUPABASE_CLAVE_PUBLICA = 'sb_publishable_GvQiv6M7iSrlwsA90lXsOQ_5OfSYBwy';
const sb = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA) : null;
const WA = window.PlantillasWA;
const $ = (id) => document.getElementById(id);

const CATEGORIAS = {
    streaming: { texto: 'Streaming', icono: 'fa-tv', detalle: 'Pantallas y cuentas' },
    licencias: { texto: 'Software', icono: 'fa-key', detalle: 'Office, Windows, IA' },
    pines: { texto: 'Pines', icono: 'fa-gamepad', detalle: 'Códigos y tarjetas' },
    recargas: { texto: 'Recargas', icono: 'fa-mobile-screen', detalle: 'Celular, juegos, TV' },
    tecnologia: { texto: 'Tecnología', icono: 'fa-headphones', detalle: 'Relojes y audio' },
    servicios: { texto: 'Servicios', icono: 'fa-screwdriver-wrench', detalle: 'Soporte técnico' },
    alquiler: { texto: 'Alquiler', icono: 'fa-laptop', detalle: 'Equipos de cómputo' },
};
const COTIZABLES = ['servicios', 'alquiler'];
const VISTAS = ['inicio', 'catalogo', 'combos', 'cuenta', 'soporte'];
const CLAVE_RECIENTES = 'dc_cliente_pedidos';

const estado = { productos: [], promos: [], metodos: [], filtro: 'todas', busqueda: '', vista: null };

/* ==================== Utilidades ==================== */

const precioCOP = (v) => (Number(v) > 0 ? WA.precioCOP(v) : 'A cotizar');
const desdeDe = (p) => {
    const precios = (p.variantes ?? []).map((v) => Number(v.precio)).filter((n) => n > 0);
    return precios.length ? Math.min(...precios) : 0;
};
const descuentoDe = (p) => Math.max(0, ...(p.variantes ?? []).map((v) => (Number(v.precio_anterior) > Number(v.precio) && v.precio > 0
    ? Math.round((1 - v.precio / v.precio_anterior) * 100) : 0)));
const leerLocal = (clave, porDefecto) => { try { return JSON.parse(localStorage.getItem(clave)) ?? porDefecto; } catch { return porDefecto; } };
const guardarLocal = (clave, valor) => { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ } };

/* ==================== Hoja modal (sube desde abajo) ==================== */

let alCerrarHoja = null;
function abrirHoja(titulo, contenido, { alCerrar } = {}) {
    const hoja = $('hoja');
    $('hoja-titulo').textContent = titulo;
    const cuerpo = $('hoja-cuerpo');
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
    const hoja = $('hoja');
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

/* ==================== Tarjeta de producto ==================== */

function tarjetaProducto(p, { alElegir, elegido = false, icono = 'fa-plus' } = {}) {
    const desde = desdeDe(p);
    const desc = descuentoDe(p);
    const t = document.createElement('article');
    t.className = `prod${elegido ? ' elegido' : ''}`;
    t.innerHTML = `
        ${desc ? `<span class="desc">-${desc}%</span>` : ''}
        <span class="marca-check" aria-hidden="true"><i class="fa-solid fa-check text-xs"></i></span>
        <div class="vitrina"><img src="${escaparHTML(p.imagen)}" alt="${escaparHTML(p.nombre)}" loading="lazy" decoding="async"></div>
        <h3>${escaparHTML(p.nombre)}</h3>
        <div class="precio">
            <span><small>${COTIZABLES.includes(p.tipo) ? 'Cotiza' : (p.variantes ?? []).length > 1 ? 'Desde' : 'Precio'}</small><b>${escaparHTML(precioCOP(desde))}</b></span>
            <button type="button" class="agregar" aria-label="${elegido ? 'Quitar' : 'Elegir'} ${escaparHTML(p.nombre)}"><i class="fa-solid ${icono}"></i></button>
        </div>`;
    const img = t.querySelector('img');
    img.addEventListener('error', () => { img.src = 'https://i.ibb.co/LDN4xyW0/Mesa-de-trabajo-1.png'; }, { once: true });
    const accion = (e) => { e.stopPropagation(); (alElegir ?? abrirProducto)(p, t); };
    t.querySelector('.agregar').addEventListener('click', accion);
    t.addEventListener('click', accion);
    return t;
}

// Hoja de producto: elegir plan y agregar al carrito
function abrirProducto(p) {
    if (COTIZABLES.includes(p.tipo)) {
        const texto = WA.agendarServicio({ servicio: p.nombre });
        abrirHoja(p.nombre, `
            <p class="text-sm text-neutral-400">Los servicios se cotizan según tu caso. Te atendemos por WhatsApp.</p>
            <a class="btn-w btn-p mt-4 w-full" href="${escaparHTML(WA.enlace(WA.NUMERO_TIENDA, texto))}" target="_blank" rel="noopener"><i class="fa-brands fa-whatsapp"></i> Cotizar por WhatsApp</a>`);
        return;
    }
    let elegida = (p.variantes ?? []).find((v) => Number(v.precio) > 0) ?? p.variantes?.[0];
    const cuerpo = document.createElement('div');
    const pintar = () => {
        cuerpo.innerHTML = `
            <div class="prod" style="pointer-events:none"><div class="vitrina"><img src="${escaparHTML(p.imagen)}" alt="" style="height:96px"></div></div>
            <p class="etiqueta mt-4">Elige tu plan</p>
            <div class="space-y-2" data-opciones></div>
            <button type="button" class="btn-p w-full mt-5" data-agregar><i class="fa-solid fa-cart-plus"></i> Agregar · <span data-precio></span></button>
            <button type="button" class="btn-s w-full mt-2" data-combo><i class="fa-solid fa-layer-group"></i> Agregar a un combo</button>`;
        cuerpo.querySelector('[data-precio]').textContent = precioCOP(elegida?.precio);
        cuerpo.querySelector('[data-opciones]').replaceChildren(...(p.variantes ?? []).map((v) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'opcion';
            b.setAttribute('aria-pressed', String(v === elegida));
            b.innerHTML = `<span class="flex items-center gap-3"><span class="radio"></span><span class="text-sm font-bold">${escaparHTML(v.nombre)}</span></span>
                <span class="text-right"><b class="text-sm">${escaparHTML(precioCOP(v.precio))}</b>${Number(v.precio_anterior) > Number(v.precio) ? `<s class="block text-[11px] text-neutral-500">${escaparHTML(precioCOP(v.precio_anterior))}</s>` : ''}</span>`;
            b.addEventListener('click', () => { elegida = v; pintar(); });
            return b;
        }));
        cuerpo.querySelector('[data-agregar]').addEventListener('click', () => {
            window.Carrito.agregar(p, elegida);
            cerrarHoja();
        });
        cuerpo.querySelector('[data-combo]').addEventListener('click', () => {
            cerrarHoja();
            window.Combos?.iniciarCon(p);
            location.hash = '#combos';
        });
    };
    pintar();
    abrirHoja(p.nombre, cuerpo);
}

/* ==================== Navegación por vistas ==================== */

function mostrarVista(vista) {
    if (!VISTAS.includes(vista)) vista = 'inicio';
    if (estado.vista === vista) return;
    const cambiar = () => {
        VISTAS.forEach((v) => { $(`vista-${v}`).hidden = v !== vista; });
        document.querySelectorAll('[data-nav]').forEach((a) => {
            const activo = a.dataset.nav === vista;
            a.classList.toggle('activo', activo);
            a.setAttribute('aria-current', activo ? 'page' : 'false');
        });
        const sec = $(`vista-${vista}`);
        if (!document.startViewTransition) {
            sec.classList.remove('entrando');
            void sec.offsetWidth;
            sec.classList.add('entrando');
        }
        window.scrollTo({ top: 0 });
        estado.vista = vista;
        document.dispatchEvent(new CustomEvent('dc:vista', { detail: vista }));
    };
    // Transición nativa entre vistas cuando el navegador la soporta
    if (document.startViewTransition && estado.vista && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(cambiar);
    else cambiar();
}

/* ==================== Inicio y catálogo ==================== */

function pintarInicio() {
    const conteo = (tipo) => estado.productos.filter((p) => p.tipo === tipo).length;
    $('inicio-categorias').replaceChildren(...Object.entries(CATEGORIAS).filter(([tipo]) => conteo(tipo)).map(([tipo, c]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'categoria';
        b.innerHTML = `<i class="fa-solid ${c.icono}"></i><b>${escaparHTML(c.texto)}</b><span>${escaparHTML(c.detalle)} · ${conteo(tipo)}</span>`;
        b.addEventListener('click', () => { estado.filtro = tipo; location.hash = '#catalogo'; pintarCatalogo(); });
        return b;
    }));
    // "Más pedidos": los de mayor descuento real del catálogo (no hay ventas inventadas)
    const destacados = [...estado.productos].filter((p) => !COTIZABLES.includes(p.tipo)).sort((a, b) => descuentoDe(b) - descuentoDe(a)).slice(0, 8);
    $('inicio-destacados').replaceChildren(...destacados.map((p) => tarjetaProducto(p)));
}

function pintarCatalogo() {
    const tipos = Object.keys(CATEGORIAS).filter((t) => estado.productos.some((p) => p.tipo === t));
    $('cat-filtros').replaceChildren(...[['todas', 'Todas'], ...tipos.map((t) => [t, CATEGORIAS[t].texto])].map(([id, texto]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(estado.filtro === id));
        b.textContent = texto;
        b.addEventListener('click', () => { estado.filtro = id; pintarCatalogo(); });
        return b;
    }));
    const q = estado.busqueda.toLowerCase();
    const lista = estado.productos.filter((p) => (estado.filtro === 'todas' || p.tipo === estado.filtro)
        && (!q || `${p.nombre} ${p.marca}`.toLowerCase().includes(q)));
    $('cat-cuenta').textContent = `${lista.length} producto${lista.length === 1 ? '' : 's'}`;
    $('cat-lista').replaceChildren(...lista.map((p) => tarjetaProducto(p)));
}

async function cargarDatos() {
    $('cat-lista').innerHTML = $('inicio-destacados').innerHTML = '<div class="skeleton"></div>'.repeat(4);
    try {
        const r = await fetch('productos.json', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        estado.productos = await r.json();
    } catch (error) {
        console.error('productos.json:', error);
        $('cat-lista').innerHTML = $('inicio-destacados').innerHTML = '<p class="tarjeta text-sm">No pudimos cargar el catálogo. Recarga la página.</p>';
        return;
    }
    pintarInicio();
    pintarCatalogo();
    document.dispatchEvent(new CustomEvent('dc:catalogo-listo'));

    if (!sb) return;
    // Promociones del día y formas de pago activas (si los SQL de wo-025 / wo-027 están aplicados)
    sb.rpc('promociones_del_dia').then(({ data }) => {
        const porId = new Map(estado.productos.map((p) => [p.id, p]));
        estado.promos = (data ?? []).map((d) => porId.get(d.producto_id)).filter(Boolean);
        $('inicio-promos').hidden = !estado.promos.length;
        $('inicio-promos-lista').replaceChildren(...estado.promos.map((p) => tarjetaProducto(p)));
    });
    sb.rpc('metodos_pago_publicos').then(({ data }) => { estado.metodos = data ?? []; });
}

/* ==================== Mis pedidos (rastreo por código) ==================== */

const ESTADOS_TEXTO = {
    PENDIENTE_PAGO: ['Esperando pago', 'fa-hourglass-half', 'text-amber-300'],
    ESPERANDO_PROVEEDOR: ['Pago validado · en preparación', 'fa-gears', 'text-sky-300'],
    PEDIDO_REALIZADO: ['En preparación', 'fa-gears', 'text-sky-300'],
    RECIBIDA: ['Listo para entregar', 'fa-box', 'text-sky-300'],
    ENTREGADO: ['Entregado', 'fa-circle-check', 'text-emerald-300'],
    ENTREGADO_INMEDIATO: ['Entregado', 'fa-circle-check', 'text-emerald-300'],
    FALLIDA: ['Con novedad · te contactamos', 'fa-triangle-exclamation', 'text-red-300'],
    CANCELADA: ['Cancelado', 'fa-ban', 'text-neutral-400'],
};

async function consultarPedido(codigo) {
    const limpio = codigo.trim().toUpperCase();
    const caja = $('cuenta-resultado');
    caja.innerHTML = '<div class="skeleton" style="min-height:8rem"></div>';
    const { data, error } = sb ? await sb.rpc('consultar_pedido', { p_codigo: limpio }).maybeSingle() : { data: null, error: true };
    if (error || !data) {
        caja.innerHTML = `<div class="tarjeta"><p class="font-bold">No encontramos el pedido ${escaparHTML(limpio)}</p>
            <p class="text-sm text-neutral-400 mt-1">Revisa el código que te enviamos por WhatsApp o escríbenos.</p>
            <a class="btn-w btn-p mt-3" target="_blank" rel="noopener" href="${escaparHTML(WA.enlace(WA.NUMERO_TIENDA, WA.consultarEstado({ pedido: limpio })))}"><i class="fa-brands fa-whatsapp"></i> Preguntar por WhatsApp</a></div>`;
        return;
    }
    const recientes = [limpio, ...leerLocal(CLAVE_RECIENTES, []).filter((c) => c !== limpio)].slice(0, 6);
    guardarLocal(CLAVE_RECIENTES, recientes);
    pintarRecientes();
    const [texto, icono, color] = ESTADOS_TEXTO[data.estado] ?? [data.estado, 'fa-circle-info', 'text-neutral-300'];
    const entregado = ['ENTREGADO', 'ENTREGADO_INMEDIATO'].includes(data.estado);
    const vence = data.fecha_vencimiento ? new Date(data.fecha_vencimiento) : null;
    const dias = vence ? Math.ceil((vence - Date.now()) / 864e5) : null;
    caja.innerHTML = `
        <div class="tarjeta space-y-3">
            <p class="etiqueta">Pedido #${escaparHTML(data.pedido_id ?? limpio)}</p>
            <p class="font-tech text-lg font-black">${escaparHTML(data.producto ?? 'Tu producto')}</p>
            <p class="flex items-center gap-2 font-bold ${color}"><i class="fa-solid ${icono}"></i> ${escaparHTML(texto)}</p>
            ${entregado && dias !== null ? `<p class="text-sm ${dias > 0 ? 'text-emerald-300' : 'text-neutral-400'}"><i class="fa-solid fa-shield-halved"></i> ${dias > 0 ? `Garantía activa: quedan ${dias} días` : 'Garantía vencida'}</p>` : ''}
            <div class="grid sm:grid-cols-2 gap-2 pt-1">
                ${entregado ? `<a class="btn-p" target="_blank" rel="noopener" href="${escaparHTML(WA.enlace(WA.NUMERO_TIENDA, `Hola, necesito que me reenvíen los accesos de mi pedido #${data.pedido_id ?? limpio} (${data.producto ?? ''}).`))}"><i class="fa-solid fa-key"></i> Pedir mis accesos</a>` : ''}
                ${entregado ? `<button type="button" class="btn-s" data-reportar><i class="fa-solid fa-screwdriver-wrench"></i> Reportar una falla</button>` : ''}
            </div>
        </div>`;
    caja.querySelector('[data-reportar]')?.addEventListener('click', () => {
        window.Soporte?.iniciarConPedido({ codigo: data.pedido_id ?? limpio, producto: data.producto, garantiaDias: dias, serialFinal: data.serial_final });
        location.hash = '#soporte';
    });
}

function pintarRecientes() {
    const lista = leerLocal(CLAVE_RECIENTES, []);
    const caja = $('cuenta-recientes');
    if (!lista.length) { caja.innerHTML = ''; return; }
    caja.innerHTML = `<p class="etiqueta">Consultados en este dispositivo</p><div class="chips"></div>`;
    caja.querySelector('.chips').replaceChildren(...lista.map((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip font-mono';
        b.textContent = c;
        b.addEventListener('click', () => { $('rastreo-codigo').value = c; consultarPedido(c); });
        return b;
    }));
}

/* ==================== Arranque ==================== */

window.DC = { estado, sb, WA, ESTADOS_TEXTO, abrirHoja, cerrarHoja, tarjetaProducto, abrirProducto, precioCOP, desdeDe, leerLocal, guardarLocal, CATEGORIAS, COTIZABLES };

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-cerrar-hoja]').forEach((el) => el.addEventListener('click', cerrarHoja));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarHoja(); });
    $('cat-buscar').addEventListener('input', (e) => { estado.busqueda = e.target.value.trim(); pintarCatalogo(); });
    $('form-rastreo').addEventListener('submit', (e) => { e.preventDefault(); consultarPedido($('rastreo-codigo').value); });
    window.addEventListener('hashchange', () => mostrarVista(location.hash.slice(1)));
    mostrarVista(location.hash.slice(1) || 'inicio');
    pintarRecientes();
    cargarDatos();
    const codigo = new URLSearchParams(location.search).get('pedido');
    if (codigo) { location.hash = '#cuenta'; $('cuenta-invitado').open = true; $('rastreo-codigo').value = codigo; consultarPedido(codigo); }
});
