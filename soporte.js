// soporte.js — Asistente de fallas del portal (cliente.html): guía al cliente con pasos concretos
// (soporte-arbol.json) y solo si no se resuelve abre WhatsApp con el diagnóstico ya escrito.
// Así el asesor no vuelve a preguntar lo mismo y muchos casos se resuelven sin chat.

(() => {
    const { WA, precioCOP } = window.DC;
    const s = { arbol: null, paso: 1, producto: null, problema: null, pedido: null, hechos: new Set() };

    async function cargarArbol() {
        if (s.arbol) return s.arbol;
        try {
            const r = await fetch('soporte-arbol.json', { cache: 'no-store' });
            s.arbol = await r.json();
        } catch {
            s.arbol = { productos: [] };
        }
        return s.arbol;
    }

    function marcarPasos() {
        document.querySelectorAll('[data-paso-soporte]').forEach((li) => {
            const n = Number(li.dataset.pasoSoporte);
            li.className = n === s.paso ? 'activo' : n < s.paso ? 'hecho' : '';
        });
    }

    async function pintar() {
        const caja = document.getElementById('soporte-contenido');
        if (!caja) return;
        const arbol = await cargarArbol();
        marcarPasos();
        const pedidoInfo = s.pedido ? `<p class="tarjeta text-sm mb-4"><i class="fa-solid fa-receipt text-dcRed"></i> Pedido <b>#${escaparHTML(s.pedido.codigo)}</b>${s.pedido.producto ? ` · ${escaparHTML(s.pedido.producto)}` : ''}</p>` : '';

        if (s.paso === 1) {
            caja.innerHTML = `${pedidoInfo}<p class="etiqueta">¿Con qué producto tienes el problema?</p><div class="grid grid-cols-2 sm:grid-cols-3 gap-3" data-lista></div>`;
            caja.querySelector('[data-lista]').replaceChildren(...arbol.productos.map((p) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'categoria';
                b.innerHTML = `<i class="fa-solid ${escaparHTML(p.icono)}"></i><b>${escaparHTML(p.texto)}</b><span>${escaparHTML(p.detalle)}</span>`;
                b.addEventListener('click', () => { s.producto = p; s.paso = 2; pintar(); });
                return b;
            }));
            return;
        }

        if (s.paso === 2) {
            caja.innerHTML = `${pedidoInfo}<p class="etiqueta">${escaparHTML(s.producto.texto)} · ¿Qué está pasando?</p><div class="space-y-2" data-lista></div>
                <button type="button" class="btn-s mt-4" data-atras><i class="fa-solid fa-arrow-left"></i> Atrás</button>`;
            caja.querySelector('[data-lista]').replaceChildren(...s.producto.problemas.map((pr) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'opcion';
                b.innerHTML = `<span class="text-sm font-bold">${escaparHTML(pr.texto)}</span><i class="fa-solid fa-chevron-right text-neutral-500"></i>`;
                b.addEventListener('click', () => { s.problema = pr; s.hechos.clear(); s.paso = 3; pintar(); });
                return b;
            }));
            caja.querySelector('[data-atras]').addEventListener('click', () => { s.paso = 1; pintar(); });
            return;
        }

        // Paso 3: pasos guiados (lista que el cliente va marcando) → ¿se resolvió?
        const pr = s.problema;
        const conGarantia = pr.garantia && s.pedido?.garantiaDias > 0;
        caja.innerHTML = `${pedidoInfo}
            <div class="tarjeta">
                <p class="font-tech font-black text-lg">${escaparHTML(pr.texto)}</p>
                ${pr.garantia ? `<p class="text-sm mt-1 ${conGarantia ? 'text-emerald-300' : 'text-neutral-400'}"><i class="fa-solid fa-shield-halved"></i> ${conGarantia ? `Lo cubre tu garantía (quedan ${s.pedido.garantiaDias} días).` : 'Lo cubre la garantía si está vigente (30 días desde la entrega).'}</p>` : ''}
                <ol class="space-y-2 mt-4" data-pasos></ol>
            </div>
            ${pr.escalar_directo ? '' : `<p class="etiqueta mt-5">¿Se resolvió?</p>
            <div class="grid grid-cols-2 gap-2"><button type="button" class="btn-p" data-si><i class="fa-solid fa-check"></i> Sí, ya funciona</button>
            <button type="button" class="btn-s" data-no>No, sigue igual</button></div>`}
            <div data-escalar ${pr.escalar_directo ? '' : 'hidden'} class="mt-5"></div>
            <button type="button" class="btn-s mt-4" data-atras><i class="fa-solid fa-arrow-left"></i> Atrás</button>`;
        caja.querySelector('[data-pasos]').replaceChildren(...pr.pasos.map((texto, i) => {
            const li = document.createElement('li');
            li.innerHTML = `<label class="opcion cursor-pointer" style="justify-content:flex-start">
                <input type="checkbox" class="w-5 h-5 accent-red-600 shrink-0" ${s.hechos.has(i) ? 'checked' : ''}>
                <span class="text-sm">${escaparHTML(texto)}</span></label>`;
            li.querySelector('input').addEventListener('change', (e) => { if (e.target.checked) s.hechos.add(i); else s.hechos.delete(i); });
            return li;
        }));
        caja.querySelector('[data-atras]').addEventListener('click', () => { s.paso = 2; pintar(); });
        caja.querySelector('[data-si]')?.addEventListener('click', () => {
            caja.innerHTML = `<div class="tarjeta text-center py-8"><i class="fa-solid fa-face-smile text-4xl text-emerald-400"></i>
                <p class="mt-3 font-tech text-xl font-black">¡Qué bien!</p><p class="text-sm text-neutral-400 mt-1">Si vuelve a pasar, aquí estamos.</p>
                <a href="#inicio" class="btn-s mt-5">Volver al inicio</a></div>`;
            reiniciar(false);
        });
        caja.querySelector('[data-no]')?.addEventListener('click', () => { pintarEscalar(caja.querySelector('[data-escalar]')); });
        if (pr.escalar_directo) pintarEscalar(caja.querySelector('[data-escalar]'));
    }

    // Último recurso: WhatsApp con el diagnóstico completo
    function pintarEscalar(zona) {
        zona.hidden = false;
        zona.innerHTML = `<form class="tarjeta space-y-3" data-form>
            <p class="etiqueta"><i class="fa-solid fa-headset text-dcRed"></i> Te pasamos con un asesor</p>
            ${s.pedido ? '' : '<label class="block"><span class="etiqueta">Código de tu pedido (si lo tienes)</span><input class="campo font-mono uppercase" name="pedido" autocomplete="off" placeholder="DC-…"></label>'}
            <label class="block"><span class="etiqueta">Cuéntanos qué ves (opcional)</span><textarea class="campo py-3" name="detalle" rows="3" maxlength="400" placeholder="Ej.: dice 'contraseña incorrecta' en el TV"></textarea></label>
            ${puedeRegistrar() ? '<button type="button" class="btn-p w-full" data-registrar><i class="fa-solid fa-clipboard-check"></i> Registrar reporte</button>' : ''}
            <button type="submit" class="${puedeRegistrar() ? 'btn-s' : 'btn-p btn-w'} w-full"><i class="fa-brands fa-whatsapp ${puedeRegistrar() ? 'text-emerald-400' : ''}"></i> Hablar con un asesor</button>
            ${!puedeRegistrar() && s.pedido ? '<p class="text-[11px] text-neutral-400"><i class="fa-solid fa-circle-info text-dcRed"></i> ¿Quieres dejarlo registrado con tu garantía? <a href="#cuenta" class="font-bold underline">Entra con tu WhatsApp en Mis pedidos</a> y repórtalo desde tu pedido.</p>' : ''}
            <p class="text-[11px] text-neutral-500">${puedeRegistrar() ? 'El reporte queda registrado con tu pedido y tu garantía, y un asesor te escribe por WhatsApp.' : 'Te enviamos con el resumen de lo que ya probaste: no tendrás que repetirlo.'}</p></form>`;
        zona.querySelector('[data-registrar]')?.addEventListener('click', (e) => registrarReporte(zona, e.currentTarget));
        zona.querySelector('[data-form]').addEventListener('submit', (e) => {
            e.preventDefault();
            const form = e.target;
            const pedido = s.pedido?.codigo ?? form.pedido?.value.trim().toUpperCase();
            const probados = s.problema.pasos.filter((_, i) => s.hechos.has(i));
            const texto = s.problema.garantia && s.pedido
                ? `${WA.reclamarGarantia({ idCompra: s.pedido.codigo, pedido: s.pedido.codigo, producto: s.pedido.producto ?? s.producto.texto, serialFinal: s.pedido.serialFinal })}\n• Falla: ${s.problema.texto}${form.detalle.value.trim() ? `\n• Detalle: ${WA.limpiarVariable(form.detalle.value, 300)}` : ''}`
                : [
                    'Hola DC Technology, necesito soporte (vengo del portal):',
                    pedido ? `• Pedido: #${WA.limpiarVariable(pedido, 30)}` : null,
                    `• Producto: ${s.pedido?.producto ? WA.limpiarVariable(s.pedido.producto) : s.producto.texto}`,
                    `• Problema: ${s.problema.texto}`,
                    probados.length ? `• Ya probé: ${probados.map((p) => p.replace(/\.$/, '')).join('; ')}` : null,
                    form.detalle.value.trim() ? `• Detalle: ${WA.limpiarVariable(form.detalle.value, 300)}` : null,
                ].filter(Boolean).join('\n');
            window.open(WA.enlace(WA.NUMERO_TIENDA, texto), '_blank', 'noopener');
            mostrarToast('Abrimos WhatsApp con tu caso. Envía el mensaje y un asesor te responde.', 'ok', 6000);
        });
    }

    // WO-032: el reporte queda en el panel con su pedido y su garantía (requiere sesión verificada por WhatsApp)
    const puedeRegistrar = () => Boolean(s.pedido?.compraId && window.Sesion?.activa?.() && window.DC.sb);
    async function registrarReporte(zona, boton) {
        const form = zona.querySelector('[data-form]');
        const probados = s.problema.pasos.filter((_, i) => s.hechos.has(i));
        const detalle = [
            probados.length ? `Ya probó: ${probados.map((p) => p.replace(/\.$/, '')).join('; ')}` : '',
            form.detalle.value.trim(),
        ].filter(Boolean).join(' · ').slice(0, 600);
        boton.disabled = true;
        boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Registrando…';
        const { data, error } = await window.DC.sb.rpc('reportar_falla', {
            p_token: window.Sesion.token(), p_compra_id: s.pedido.compraId, p_problema: s.problema.texto.slice(0, 160), p_detalle: detalle || null,
        });
        const r = data?.[0];
        if (error || !r?.ok) {
            boton.disabled = false;
            boton.innerHTML = '<i class="fa-solid fa-clipboard-check"></i> Registrar reporte';
            mostrarToast(r?.mensaje === 'SESION_INVALIDA' ? 'Tu sesión terminó: entra de nuevo en Mis pedidos.' : (r?.mensaje ?? 'No pudimos registrar el reporte. Escríbenos por WhatsApp.'), 'error', 6000);
            return;
        }
        zona.innerHTML = `<div class="tarjeta text-center py-6">
            <div class="exito-check" aria-hidden="true"><i class="fa-solid fa-check"></i></div>
            <p class="font-tech text-lg font-black mt-4">Reporte #${escaparHTML(r.reporte_id)} registrado</p>
            <p class="text-sm text-neutral-400 mt-1">${escaparHTML(r.mensaje)}</p>
            ${s.pedido.garantiaDias > 0 ? `<p class="text-sm text-emerald-300 mt-2"><i class="fa-solid fa-shield-halved"></i> Lo cubre tu garantía (quedan ${escaparHTML(s.pedido.garantiaDias)} días).</p>` : ''}
            <a href="#cuenta" class="btn-s mt-4"><i class="fa-solid fa-receipt"></i> Volver a Mis pedidos</a></div>`;
        navigator.vibrate?.(20);
    }

    function reiniciar(repintar = true) {
        s.paso = 1;
        s.producto = s.problema = null;
        s.hechos.clear();
        if (repintar) pintar();
    }

    // Desde "Mis pedidos": el producto se elige solo según el pedido
    async function iniciarConPedido(pedido) {
        s.pedido = pedido;
        const arbol = await cargarArbol();
        const texto = String(pedido.producto ?? '').toLowerCase();
        const catalogo = window.DC.estado.productos.find((p) => texto.includes(String(p.nombre).toLowerCase().split(' ')[0]));
        s.producto = arbol.productos.find((p) => p.id === catalogo?.tipo) ?? arbol.productos.find((p) => p.id === (catalogo?.tipo === 'recargas' ? 'pines' : 'streaming'));
        s.paso = s.producto ? 2 : 1;
        pintar();
    }

    document.addEventListener('dc:vista', (e) => { if (e.detail === 'soporte') pintar(); });
    window.Soporte = { iniciarConPedido, reiniciar, precioCOP };
})();
