// admin-pro.js — Panel más profesional (25/10/2026): estado del sistema en vivo (tienda, catálogo, precios y existencias de la base),
// ingreso en dos columnas, «todo al día» cuando una lista de pedidos está vacía y pulso de los indicadores cuando cambian.
// Solo lee datos públicos (productos.json y precios_publicos con la llave pública): nada de clientes ni de pedidos.
(() => {
    const sb = typeof supabaseClient !== 'undefined' ? supabaseClient : null;
    const hora = () => new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const miles = (n) => Number(n).toLocaleString('es-CO');

    // Revisión del sistema: lo mismo para el ingreso y para la franja del tablero
    async function revisar() {
        const r = { tienda: null, productos: null, emprende: null, base: null, precios: null, existencias: null, agotados: null };
        try {
            const res = await fetch(`productos.json?r=${Date.now()}`, { cache: 'no-store' });
            r.tienda = res.ok;
            if (res.ok) { const p = await res.json(); r.productos = p.length; r.emprende = p.filter((x) => String(x.id).startsWith('er-')).length; }
        } catch { r.tienda = false; }
        if (sb) {
            try {
                const { data, error } = await sb.rpc('precios_publicos');
                r.base = !error;
                if (!error && Array.isArray(data)) {
                    r.precios = data.length;
                    r.existencias = data.length ? Object.prototype.hasOwnProperty.call(data[0], 'existencias') : null;
                    r.agotados = data.filter((x) => x.agotado === true).length;
                }
            } catch { r.base = false; }
        }
        return r;
    }

    const filas = (r) => [
        { ok: r.tienda, texto: 'Tienda en línea', valor: r.tienda ? 'www.dctecnology.xyz' : 'sin respuesta' },
        { ok: r.productos != null, texto: 'Catálogo publicado', valor: r.productos != null ? `${miles(r.productos)} productos` : '—' },
        { ok: r.base, texto: 'Precios en vivo (base de datos)', valor: r.precios != null ? `${miles(r.precios)} planes` : r.base === false ? 'sin conexión' : '—' },
        { ok: r.existencias, texto: 'Unidades y agotados', valor: r.existencias ? `en vivo · ${miles(r.agotados ?? 0)} agotados` : r.existencias === false ? 'aplica el SQL pendiente' : '—' },
    ];

    // ---------- Ingreso en dos columnas (PC) ----------
    const login = document.getElementById('vista-login');
    const tarjeta = login?.firstElementChild;
    if (login && tarjeta && !login.classList.contains('login-pro')) {
        login.classList.add('login-pro');
        const marco = document.createElement('div');
        marco.className = 'login-marco';
        const lado = document.createElement('aside');
        lado.className = 'login-lado';
        lado.setAttribute('aria-label', 'Estado del sistema');
        lado.innerHTML = `<div class="ll-marca"><img src="img/logo-dc-192.png" alt="" width="44" height="44"><span>DC <b>Tecnology</b></span></div>
            <div><h2>Centro de control <span>de tu tienda</span></h2><p>Pedidos, pagos por validar, finanzas, proveedores y el bot de WhatsApp en un solo lugar.</p></div>
            <div class="ll-estado" id="ll-estado"><h3>Estado del sistema</h3></div>
            <p class="ll-pie" id="ll-pie">Comprobando…</p>`;
        login.insertBefore(marco, tarjeta);
        marco.append(lado, tarjeta);
        revisar().then((r) => {
            const caja = document.getElementById('ll-estado');
            for (const f of filas(r)) {
                const d = document.createElement('div');
                d.className = 'll-fila';
                d.dataset.ok = f.ok === true ? 'si' : f.ok === false ? 'no' : '';
                d.innerHTML = '<i class="pt" aria-hidden="true"></i><span></span><b></b>';
                d.querySelector('span').textContent = f.texto;
                d.querySelector('b').textContent = f.valor;
                caja.appendChild(d);
            }
            document.getElementById('ll-pie').textContent = `Comprobado a las ${hora()} · Proveedores sincronizados cada 6 h y revisión completa a las 6:00 a. m.`;
        });
    }

    // ---------- Franja de sincronización en el tablero ----------
    const kpi = document.getElementById('kpi-hoy');
    const rejilla = kpi?.closest('.grid');
    if (rejilla && !document.getElementById('ap-estado')) {
        const franja = document.createElement('div');
        franja.id = 'ap-estado';
        franja.className = 'ap-estado';
        franja.setAttribute('role', 'status');
        franja.innerHTML = '<span class="ap-tit">Sincronización</span><span id="ap-chips" style="display:contents"></span><span class="ap-hora" id="ap-hora">Comprobando…</span><button type="button" id="ap-revisar">Revisar ahora</button>';
        rejilla.after(franja);
        const pintar = async () => {
            document.getElementById('ap-hora').textContent = 'Comprobando…';
            const r = await revisar();
            const chips = document.getElementById('ap-chips');
            chips.innerHTML = '';
            for (const f of filas(r)) {
                const c = document.createElement('span');
                c.className = 'ap-chip';
                c.dataset.ok = f.ok === true ? 'si' : f.ok === false ? 'no' : '';
                c.innerHTML = '<i class="pt" aria-hidden="true"></i><span></span><b></b>';
                c.querySelector('span').textContent = `${f.texto}:`;
                c.querySelector('b').textContent = f.valor;
                chips.appendChild(c);
            }
            document.getElementById('ap-hora').textContent = `Actualizado ${hora()}`;
        };
        document.getElementById('ap-revisar').addEventListener('click', pintar);
        // Al entrar al tablero y luego cada 5 minutos mientras está abierto
        const tablero = document.getElementById('vista-dashboard');
        let iniciado = false;
        const arrancar = () => { if (iniciado || tablero?.classList.contains('hidden')) return; iniciado = true; pintar(); setInterval(() => { if (!document.hidden) pintar(); }, 5 * 60e3); };
        if (tablero) new MutationObserver(arrancar).observe(tablero, { attributes: true, attributeFilter: ['class'] });
        arrancar();
    }

    // ---------- Indicadores: tarjeta con elevación y pulso al cambiar ----------
    for (const id of ['kpi-hoy', 'kpi-procesando', 'kpi-tiempo', 'kpi-por-verificar', 'kpi-satisfaccion', 'kpi-renovacion']) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.parentElement?.classList.add('ap-kpi');
        let antes = el.textContent;
        new MutationObserver(() => {
            if (el.textContent === antes) return;
            antes = el.textContent;
            el.classList.remove('ap-cambio'); void el.offsetWidth; el.classList.add('ap-cambio');
        }).observe(el, { childList: true, characterData: true, subtree: true });
    }

    // ---------- Lista de pedidos vacía: «todo al día» ----------
    const lista = document.getElementById('lista-pedidos');
    if (lista) {
        const vacio = () => {
            const reales = [...lista.children].filter((x) => !x.classList.contains('ap-vacio'));
            const aviso = lista.querySelector('.ap-vacio');
            if (!reales.length && !aviso) {
                const d = document.createElement('div');
                d.className = 'ap-vacio';
                d.innerHTML = '<span class="ic"><i class="fa-solid fa-circle-check"></i></span><b>Todo al día</b><span>No hay pedidos en esta vista. Los nuevos aparecen aquí al instante.</span>';
                lista.appendChild(d);
            } else if (reales.length && aviso) aviso.remove();
        };
        new MutationObserver(vacio).observe(lista, { childList: true });
        setTimeout(vacio, 1500);
    }

    // ---------- Menú lateral: marca el módulo activo para el indicador ----------
    const marcarActivo = () => {
        const visible = [...document.querySelectorAll('[id^="vista-"]')].find((v) => v.id !== 'vista-login' && v.id !== 'vista-dashboard' && !v.classList.contains('hidden') && !v.hidden);
        const nombre = visible?.id.replace(/^vista-/, '');
        document.querySelectorAll('nav button[data-vista]').forEach((b) => { if (b.dataset.vista === nombre) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    };
    document.addEventListener('click', (e) => { if (e.target.closest?.('nav button[data-vista]')) setTimeout(marcarActivo, 60); });
    setTimeout(marcarActivo, 800);
})();
