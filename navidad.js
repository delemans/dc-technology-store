// navidad.js — Temporada de diciembre en la tienda (pedido del director el 24/11/2026):
//  · Cuenta regresiva a Navidad (después del 25, a Año Nuevo). Se muestra del 15/11 al 6/01 (hora de Colombia).
//  · «Encuentra el regalo perfecto»: por persona (él, ella, niños, gamer, mamá, amigo secreto, estudio) y presupuesto,
//    con los productos y precios VIGENTES de la tienda (DCTienda: los mismos de la base). Tocar uno abre su ficha normal.
//  · Enlace directo para la publicidad: index.html#regalos?para=gamer&hasta=20000
// Sin descuentos inventados: solo precios reales, «Solo quedan N» con las unidades reales del catálogo.
(() => {
    const sec = document.getElementById('regalos');
    if (!sec) return;
    const bogota = () => { const s = new Date().toLocaleString('en-CA', { timeZone: 'America/Bogota', hour12: false }).slice(0, 10); return new Date(`${s}T00:00:00Z`); };
    const hoy = bogota();
    const a = hoy.getUTCFullYear(), m = hoy.getUTCMonth() + 1, d = hoy.getUTCDate();
    const temporada = (m === 11 && d >= 15) || m === 12 || (m === 1 && d <= 6);
    if (!temporada && !new URLSearchParams(location.search).has('navidad')) return;
    sec.hidden = false;

    // Cuenta regresiva
    const anioNav = m === 1 ? a - 1 : a;
    const nav = Date.UTC(anioNav, 11, 25), nuevo = Date.UTC(anioNav + 1, 0, 1);
    const dias = (f) => Math.round((f - hoy.getTime()) / 864e5);
    const cuenta = document.getElementById('regalos-cuenta');
    if (cuenta) {
        const dn = dias(nav), da = dias(nuevo);
        cuenta.textContent = dn > 1 ? `Faltan ${dn} días para Navidad` : dn === 1 ? '¡Mañana es Nochebuena… y pasado, Navidad!' : dn === 0 ? '¡Feliz Navidad!'
            : da > 1 ? `Faltan ${da} días para el ${anioNav + 1}` : da === 1 ? `¡Mañana es ${anioNav + 1}!` : `¡Feliz ${anioNav + 1}!`;
    }

    const PERSONAS = [
        { id: 'todos', txt: 'Todos', icono: '🎁' },
        { id: 'el', txt: 'Para él', icono: '👨', ids: ['reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable', 'reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados', 'auriculares-inalambricos-m25-con-powerbank', 'auriculares-inalambricos-de-gancho-sp16', 'directv-go', 'pin-virtual-win-play', 'pin-virtual-directv-go', 'netflix', 'hbo-max', 'mcafee-antivirus'] },
        { id: 'ella', txt: 'Para ella', icono: '👩', ids: ['reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable', 'diademas-inalambricas-cr-8-con-luces-r9s7x', 'vix-premium', 'disney-plus', 'spotify-premium', 'canva-pro', 'viki-rakuten', 'netflix', 'prime-video'] },
        { id: 'ninos', txt: 'Niños', icono: '🧒', ids: ['disney-plus', 'pin-virtual-roblox', 'pin-virtual-disney-plus-1tpu5', 'duolingo-super', 'diademas-inalambricas-cr-8-con-luces-r9s7x', 'youtube-premium'] },
        { id: 'gamer', txt: 'Gamer', icono: '🎮', ids: ['diademas-gamer-a3s-alambrico', 'pin-virtual-roblox', 'crunchyroll', 'diademas-inalambricas-cr-8-con-luces-r9s7x', 'auriculares-inalambricos-m25-con-powerbank'] },
        { id: 'mama', txt: 'Mamá y abuela', icono: '👵', ids: ['vix-premium', 'pin-virtual-vix', 'reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable', 'paramount-plus', 'universal-plus', 'netflix'] },
        { id: 'amigo', txt: 'Amigo secreto', icono: '🤫', tope: 25000 },
        { id: 'estudio', txt: 'Estudio y trabajo', icono: '💻', ids: ['canva-pro', 'duolingo-super', 'mcafee-antivirus', 'pin-virtual-mcafee', 'servicio-mantenimiento-computadores', 'servicio-reparacion-repuestos', 'pin-virtual-datacredito'] },
    ];
    const PRESUPUESTOS = [{ id: '0', txt: 'Cualquier precio' }, { id: '20000', txt: 'Menos de $20.000', max: 19999 }, { id: '50000', txt: '$20.000 a $50.000', min: 20000, max: 50000 }, { id: 'mas', txt: 'Más de $50.000', min: 50001 }];

    const estado = { para: 'todos', presupuesto: '0' };
    // Enlace de la publicidad: #regalos?para=gamer&hasta=20000
    const leerEnlace = () => {
        const h = location.hash; if (!h.startsWith('#regalos')) return false;
        const q = new URLSearchParams(h.split('?')[1] ?? '');
        if (PERSONAS.some((p) => p.id === q.get('para'))) estado.para = q.get('para');
        const hasta = Number(q.get('hasta')); if (hasta) estado.presupuesto = hasta <= 20000 ? '20000' : hasta <= 50000 ? '50000' : '0';
        return true;
    };
    const irAqui = leerEnlace();

    const $per = document.getElementById('regalos-para'), $pre = document.getElementById('regalos-presupuesto'), $grid = document.getElementById('regalos-grid'), $nota = document.getElementById('regalos-nota');
    const chips = (cont, lista, clave) => {
        cont.innerHTML = '';
        for (const o of lista) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'nav-chip'; b.dataset.v = o.id;
            b.textContent = `${o.icono ? `${o.icono} ` : ''}${o.txt}`; b.setAttribute('aria-pressed', String(estado[clave] === o.id));
            b.addEventListener('click', () => { estado[clave] = o.id; estado.mas = false; pintar(); });
            cont.appendChild(b);
        }
        const activo = cont.querySelector('[aria-pressed="true"]');
        if (activo) cont.scrollLeft = Math.max(0, activo.offsetLeft - cont.offsetLeft - 16);
    };
    const desde = (p) => { const v = (p.variantes ?? []).map((x) => Number(x.precio)).filter((x) => x > 0); return v.length ? Math.min(...v) : 0; };
    const fmt = (v) => (window.DCTienda?.formatearPrecio ? window.DCTienda.formatearPrecio(v) : `$${Number(v).toLocaleString('es-CO')}`);
    const unidades = (p) => { const e = window.DCDisponibilidad?.existencias?.[p.id]; return typeof e === 'number' ? e : e && typeof e === 'object' ? Math.max(...Object.values(e)) : null; };
    const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    function pintar() {
        chips($per, PERSONAS, 'para'); chips($pre, PRESUPUESTOS, 'presupuesto');
        const todos = (window.DCTienda?.productos() ?? []).filter((p) => !p.oculto && !p.agotado && desde(p) > 0);
        const per = PERSONAS.find((p) => p.id === estado.para), pre = PRESUPUESTOS.find((p) => p.id === estado.presupuesto);
        let lista = per.ids ? per.ids.map((id) => todos.find((p) => p.id === id)).filter(Boolean) : todos.slice();
        if (per.tope) lista = lista.filter((p) => desde(p) <= per.tope && p.tipo !== 'servicios');
        lista = lista.filter((p) => (pre.min == null || desde(p) >= pre.min) && (pre.max == null || desde(p) <= pre.max));
        if (!per.ids) {
            // «Todos»: se intercalan tecnología, plataformas, pines, licencias y servicios (cada grupo del más barato al más caro)
            const grupos = {}; lista.sort((x, y) => desde(x) - desde(y)).forEach((p) => (grupos[p.tipo] ??= []).push(p));
            const orden = ['tecnologia', 'streaming', 'pines', 'licencias', 'servicios', ...Object.keys(grupos)].filter((t, i, a) => grupos[t] && a.indexOf(t) === i);
            const mezcla = []; for (let i = 0; mezcla.length < lista.length; i++) for (const t of orden) if (grupos[t][i]) mezcla.push(grupos[t][i]);
            lista = mezcla;
        }
        const tope = estado.mas ? 40 : window.innerWidth < 768 ? 6 : 12;
        $grid.innerHTML = lista.length ? lista.slice(0, tope).map((p) => {
            const u = unidades(p); const varios = (p.variantes ?? []).filter((v) => Number(v.precio) > 0).length > 1;
            return `<button type="button" class="nav-regalo" data-id="${esc(p.id)}" aria-label="${esc(p.nombre)}, ${varios ? 'desde ' : ''}${fmt(desde(p))}">
<span class="nav-regalo__foto"><img src="${esc(p.imagen)}" alt="" loading="lazy" decoding="async"></span>
<span class="nav-regalo__nombre">${esc(p.nombre)}</span>
<span class="nav-regalo__precio">${varios ? '<small>Desde</small> ' : ''}${fmt(desde(p))}</span>
${u != null && u > 0 && u <= 5 && p.tipo === 'tecnologia' ? `<span class="nav-regalo__quedan">Solo quedan ${u}</span>` : ''}
<span class="nav-regalo__entrega">${p.tipo === 'tecnologia' ? '🚚 Envío a todo el país' : p.tipo === 'servicios' ? '🛠 Agenda por WhatsApp' : '⚡ Llega por WhatsApp'}</span></button>`;
        }).join('') + (lista.length > tope ? `<button type="button" class="nav-mas">Ver ${lista.length - tope} regalos más</button>` : '') : '<p class="nav-vacio">No hay regalos en ese rango. Prueba con otro presupuesto 🎁</p>';
        $grid.querySelector('.nav-mas')?.addEventListener('click', () => { estado.mas = true; pintar(); });
        $nota.textContent = `${lista.length} ${lista.length === 1 ? 'regalo' : 'regalos'} · precios vigentes de la tienda`;
        $grid.querySelectorAll('.nav-regalo').forEach((b) => b.addEventListener('click', () => window.DCTienda?.abrirProducto(b.dataset.id)));
    }

    // Espera a que la tienda tenga el catálogo con los precios de la base
    let intentos = 0;
    const listo = () => {
        if ((window.DCTienda?.productos() ?? []).length) {
            pintar();
            if (irAqui) setTimeout(() => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
        } else if (intentos++ < 80) setTimeout(listo, 150);
    };
    listo();
    window.addEventListener('hashchange', () => { if (leerEnlace()) { pintar(); sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
})();
