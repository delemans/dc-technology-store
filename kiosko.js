// kiosko.js — Modo kiosko (autoservicio en un punto físico: tableta o pantalla táctil).
// El cliente elige → carrito → sus datos → medio de pago → paga en su celular → la tableta le toma foto a la
// confirmación → el pedido entra al MISMO flujo automático de la web (orden + comprobante → aviso al director →
// tu #ok → entrega por WhatsApp). La pantalla se reinicia sola para el siguiente cliente y no guarda sus datos.
// Se activa en Pedidos → «Modo kiosko» o con dctecnology.xyz/?kiosko=1 (queda activo en esa tableta).
// Para salir: mantener presionado el logo 3 segundos.
(() => {
    'use strict';
    const CLAVE = 'dc_kiosko';
    const INACTIVO_S = 90;          // sin tocar la pantalla → «¿Sigues ahí?»
    const AVISO_S = 15;             // segundos para responder antes de reiniciar
    const GRACIAS_S = 20;           // pantalla de gracias tras enviar el comprobante
    const DATOS_CLIENTE = ['dc_cliente_carrito', 'dc_cliente_datos', 'dc_cliente_ordenes', 'dc_cliente_sesion'];
    const leer = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
    const guardar = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
    const raiz = document.documentElement;

    // Activación por dirección (?kiosko=1 / ?kiosko=0) y limpieza de la dirección
    const params = new URLSearchParams(location.search);
    if (params.has('kiosko')) {
        guardar(CLAVE, params.get('kiosko') === '0' ? null : '1');
        params.delete('kiosko');
        history.replaceState(history.state, '', location.pathname + (params.toString() ? `?${params}` : ''));
    }

    // Botón en Mis pedidos para encender el modo (lo usa quien administra la tableta)
    const cuenta = document.getElementById('cuenta');
    if (cuenta && !cuenta.querySelector('[data-kiosko-activar]')) {
        const caja = document.createElement('div');
        caja.className = 'kiosko-activar';
        caja.innerHTML = `<div><b><i class="fa-solid fa-tablet-screen-button" aria-hidden="true"></i> Modo kiosko · autoservicio</b>
            <p>Para una tableta o pantalla táctil en tu punto de venta: los clientes piden y pagan solos, y el pedido entra al flujo automático (validas con #ok y se entrega por WhatsApp). Se reinicia solo entre clientes.</p></div>
            <button type="button" data-kiosko-activar>Activar en este equipo</button>`;
        cuenta.appendChild(caja);
        caja.querySelector('[data-kiosko-activar]').addEventListener('click', () => { guardar(CLAVE, '1'); location.reload(); });
    }
    if (leer(CLAVE) !== '1') return;

    /* ---------- Modo kiosko encendido ---------- */
    raiz.classList.add('kiosko');
    const reiniciar = () => {
        DATOS_CLIENTE.forEach((k) => guardar(k, null));
        try { sessionStorage.clear(); } catch { /* nada */ }
        location.replace(location.pathname);
    };

    // Pantalla de bienvenida (al iniciar y después de cada cliente)
    const portada = document.createElement('div');
    portada.className = 'kiosko-portada';
    portada.innerHTML = `<img src="img/logo-dc-512.png" alt="">
        <h2>DC <b>Tecnology</b></h2>
        <p class="kiosko-frase">Streaming, licencias, pines y tecnología</p>
        <button type="button" class="kiosko-empezar"><i class="fa-solid fa-hand-pointer" aria-hidden="true"></i> Toca para hacer tu pedido</button>
        <p class="kiosko-pasos"><span>1 · Elige</span><span>2 · Paga en tu celular</span><span>3 · Recíbelo por WhatsApp</span></p>`;
    document.body.appendChild(portada);
    const frases = ['Streaming, licencias, pines y tecnología', 'Pagas con Nequi, Daviplata o Bre-B', 'Te llega por WhatsApp con garantía'];
    let f = 0;
    setInterval(() => { if (!portada.hidden) portada.querySelector('.kiosko-frase').textContent = frases[++f % frases.length]; }, 3500);
    portada.querySelector('.kiosko-empezar').addEventListener('click', () => {
        portada.hidden = true;
        raiz.requestFullscreen?.().catch(() => {});
        window.DCVistas?.mostrar('catalogo');
        tocado();
    });

    // Mantener la pantalla encendida
    let bloqueo = null;
    const despierta = async () => { try { bloqueo = await navigator.wakeLock?.request('screen'); } catch { /* no disponible */ } };
    despierta();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') despierta(); });

    // Nada de salir del kiosko: enlaces externos (WhatsApp, redes, páginas legales) se bloquean
    document.addEventListener('click', (e) => {
        const a = e.target.closest('a[href]');
        if (!a) return;
        const href = a.getAttribute('href');
        if (a.target === '_blank' || /^(https?:|mailto:|tel:|whatsapp:)/i.test(href)) {
            e.preventDefault();
            e.stopPropagation();
            window.mostrarToast?.('En el kiosko no se abren otras páginas. Pide ayuda si la necesitas.', 'info', 4000);
        }
    }, true);
    const abrirOriginal = window.open;
    window.open = (url, ...resto) => (/^https?:\/\/(wa\.me|api\.whatsapp)/i.test(String(url)) ? null : abrirOriginal.call(window, url, ...resto));

    // Inactividad: aviso con cuenta regresiva y reinicio (los datos del cliente anterior no quedan)
    const aviso = document.createElement('div');
    aviso.className = 'kiosko-aviso';
    aviso.hidden = true;
    aviso.innerHTML = `<div><p class="kiosko-aviso__t">¿Sigues ahí?</p><p>La pantalla se reinicia en <b data-seg>${AVISO_S}</b> s para el siguiente cliente.</p>
        <button type="button" data-seguir>Sigo aquí</button></div>`;
    document.body.appendChild(aviso);
    let ultimo = Date.now(), cuenta_atras = null;
    const tocado = () => { ultimo = Date.now(); if (!aviso.hidden) { aviso.hidden = true; clearInterval(cuenta_atras); } };
    ['pointerdown', 'keydown', 'input', 'scroll', 'touchstart'].forEach((t) => addEventListener(t, tocado, { passive: true, capture: true }));
    aviso.querySelector('[data-seguir]').addEventListener('click', tocado);
    setInterval(() => {
        if (!portada.hidden || !aviso.hidden) return;
        if (Date.now() - ultimo < INACTIVO_S * 1000) return;
        // Carrito vacío y sin nada abierto: vuelve a la portada sin preguntar
        const vacio = !(window.Carrito?.lineas?.().length) && document.getElementById('hoja')?.hidden !== false;
        if (vacio) { reiniciar(); return; }
        aviso.hidden = false;
        let s = AVISO_S;
        aviso.querySelector('[data-seg]').textContent = s;
        cuenta_atras = setInterval(() => {
            s -= 1;
            aviso.querySelector('[data-seg]').textContent = s;
            if (s <= 0) { clearInterval(cuenta_atras); reiniciar(); }
        }, 1000);
    }, 2000);

    // Comprobante enviado → gracias + reinicio automático
    document.addEventListener('dc:comprobante-enviado', (e) => {
        const { codigo } = e.detail ?? {};
        const gracias = document.createElement('div');
        gracias.className = 'kiosko-portada kiosko-gracias';
        gracias.innerHTML = `<div class="exito-check" aria-hidden="true"><i class="fa-solid fa-check"></i></div>
            <h2>¡Pedido recibido!</h2>
            <p>Tu orden <b>${String(codigo ?? '').replace(/[^\w-]/g, '')}</b> ya está en proceso. Validamos tu pago y te llega por <b>WhatsApp</b>.</p>
            <p class="kiosko-frase">Esta pantalla se reinicia en <b data-seg>${GRACIAS_S}</b> s</p>
            <button type="button" class="kiosko-empezar">Terminar</button>`;
        document.body.appendChild(gracias);
        let s = GRACIAS_S;
        const t = setInterval(() => { s -= 1; gracias.querySelector('[data-seg]').textContent = s; if (s <= 0) { clearInterval(t); reiniciar(); } }, 1000);
        gracias.querySelector('.kiosko-empezar').addEventListener('click', reiniciar);
    });

    // Salir: mantener presionado el logo 3 s
    const logo = document.getElementById('secret-admin-logo');
    let presion = null;
    logo?.addEventListener('pointerdown', () => {
        presion = setTimeout(() => {
            const salir = document.createElement('div');
            salir.className = 'kiosko-aviso';
            salir.innerHTML = `<div><p class="kiosko-aviso__t">¿Salir del modo kiosko?</p><p>La tienda vuelve a la versión normal en este equipo.</p>
                <div class="kiosko-salir"><button type="button" data-no>Seguir en kiosko</button><button type="button" data-si>Salir</button></div></div>`;
            document.body.appendChild(salir);
            salir.querySelector('[data-no]').addEventListener('click', () => salir.remove());
            salir.querySelector('[data-si]').addEventListener('click', () => { guardar(CLAVE, null); document.exitFullscreen?.().catch(() => {}); reiniciar(); });
        }, 3000);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => logo?.addEventListener(t, () => clearTimeout(presion)));
    window.DCKiosko = { reiniciar };
})();
