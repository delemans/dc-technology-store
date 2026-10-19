// pedidos-tienda.js — "Mis pedidos" y "Soporte" DENTRO de la tienda (19/10/2026: una sola página).
// sesion.js (entrada con WhatsApp + historial) y soporte.js son los mismos del portal; aquí va lo que antes hacía
// cliente.js para la tienda: consulta como invitado con el código, pedidos consultados y enlaces ?pedido=.
// Anclas iguales a las del portal (#cuenta, #soporte): los enlaces viejos (cliente.html#cuenta) redirigen aquí.
(() => {
    const DC = window.DC;
    if (!DC) return;
    const { sb, WA, leerLocal, guardarLocal, ESTADOS_TEXTO } = DC;
    const $ = (id) => document.getElementById(id);
    const CLAVE_RECIENTES = 'dc_cliente_pedidos';

    async function consultarPedido(codigo) {
        const limpio = String(codigo ?? '').trim().toUpperCase();
        const caja = $('cuenta-resultado');
        if (!limpio || !caja) return;
        caja.innerHTML = '<div class="skeleton" style="min-height:8rem"></div>';
        const { data, error } = sb ? await sb.rpc('consultar_pedido', { p_codigo: limpio }).maybeSingle() : { data: null, error: true };
        if (error || !data) {
            caja.innerHTML = `<div class="tarjeta"><p class="font-bold">No encontramos el pedido ${escaparHTML(limpio)}</p>
                <p class="text-sm text-neutral-400 mt-1">Revisa el código que te enviamos por WhatsApp o escríbenos.</p>
                <a class="btn-w btn-p mt-3" target="_blank" rel="noopener" href="${escaparHTML(WA.enlace(WA.NUMERO_TIENDA, WA.consultarEstado({ pedido: limpio })))}"><i class="fa-brands fa-whatsapp"></i> Preguntar por WhatsApp</a></div>`;
            return;
        }
        guardarLocal(CLAVE_RECIENTES, [limpio, ...leerLocal(CLAVE_RECIENTES, []).filter((c) => c !== limpio)].slice(0, 6));
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
                    ${entregado ? '<button type="button" class="btn-s" data-reportar><i class="fa-solid fa-screwdriver-wrench"></i> Reportar una falla</button>' : ''}
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
        if (!caja) return;
        if (!lista.length) { caja.innerHTML = ''; return; }
        caja.innerHTML = '<p class="etiqueta">Consultados en este dispositivo</p><div class="chips"></div>';
        caja.querySelector('.chips').replaceChildren(...lista.map((c) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip font-mono';
            b.textContent = c;
            b.addEventListener('click', () => { $('rastreo-codigo').value = c; consultarPedido(c); });
            return b;
        }));
    }

    const iniciar = () => {
        $('form-rastreo')?.addEventListener('submit', (e) => { e.preventDefault(); consultarPedido($('rastreo-codigo').value); });
        pintarRecientes();
        // Enlace con ?pedido=DC-XXXXX (WhatsApp o el portal anterior): consulta directa
        const codigo = new URLSearchParams(location.search).get('pedido');
        if (codigo) {
            $('cuenta-invitado').open = true;
            $('rastreo-codigo').value = codigo;
            consultarPedido(codigo);
            if (!location.hash) location.hash = '#cuenta';
        }
        // Las secciones de abajo aparecen al bajar: con un enlace directo (#cuenta / #soporte) se muestran de una vez
        const ir = () => { const s = document.getElementById(location.hash.slice(1)); if (s && ['cuenta', 'soporte'].includes(s.id)) { s.classList.add('visible'); s.scrollIntoView({ block: 'start' }); } };
        window.addEventListener('hashchange', ir);
        if (location.hash) setTimeout(ir, 300);
        // soporte.js y sesion.js se pintan con el evento dc:vista (en el portal lo daba el cambio de pestaña):
        // aquí se avisa cuando cada sección asoma en pantalla o cuando un enlace lleva a ella
        const avisada = new Set();
        const avisar = (vista) => { if (avisada.has(vista)) return; avisada.add(vista); document.dispatchEvent(new CustomEvent('dc:vista', { detail: vista })); };
        window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v === 'soporte' || v === 'cuenta') { avisada.delete(v); avisar(v); } });
        if ('IntersectionObserver' in window) {
            const obs = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) avisar(e.target.id); }), { rootMargin: '200px 0px' });
            ['cuenta', 'soporte'].forEach((id) => { const s = $(id); if (s) obs.observe(s); });
        } else { avisar('cuenta'); avisar('soporte'); }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
