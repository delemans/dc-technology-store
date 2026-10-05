// carrito.js — Carrito, armado de combos y pago paso a paso del portal (cliente.html).
// El carrito vive en el dispositivo (sin datos sensibles). Dos formas de cerrar la compra:
//  · En la web (WO-030): crea la orden en Supabase, muestra los datos del método y el cliente sube su
//    comprobante (bucket privado, ruta de un solo uso). El equipo lo valida en el panel.
//  · Por WhatsApp: abre el chat con el pedido completo ya escrito (el bot da los datos de pago).
// Descuento por combo: reglas de supabase/wo-029-combos.sql (el cupón no se acumula con el combo).

(() => {
    const { WA, abrirHoja, cerrarHoja, precioCOP, leerLocal, guardarLocal } = window.DC;
    const CLAVE = 'dc_cliente_carrito';
    const CLAVE_DATOS = 'dc_cliente_datos';
    const CLAVE_ORDENES = 'dc_cliente_ordenes'; // [{ codigo, secreto, total, pago, items, estado, creado }] solo en este dispositivo
    const TIPOS_ARCHIVO = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
    const MAX_BYTES = 5 * 1024 * 1024;
    const DIGITALES = ['streaming', 'licencias', 'pines', 'recargas'];

    let lineas = leerLocal(CLAVE, []);   // [{ uid, id, nombre, variante, precio, imagen, tipo, combo }]
    let cupon = null;                    // { codigo, porcentaje }
    const pago = { paso: 1, categoria: 'electronico', metodo: null };

    /* ---------- Descuento por combo (reglas de public.reglas_combo, wo-029) ----------
       Se aplica la regla activa con el mayor mínimo que el combo alcance (igual que descuento_combo()
       en la base). Cuentan las plataformas DISTINTAS del combo; si quitas una, el descuento se recalcula. */
    const reglas = () => window.DC.estado.reglasCombo ?? [];
    const pctCombo = (n) => reglas().filter((r) => r.min <= n).sort((a, b) => b.min - a.min)[0]?.pct ?? 0;
    const siguienteRegla = (n) => reglas().filter((r) => r.min > n && r.pct > pctCombo(n)).sort((a, b) => a.min - b.min)[0] ?? null;
    const pctTexto = (pct) => `${String(pct).replace('.', ',')} %`;

    /* ---------- Estado del carrito ---------- */
    const sumar = (ls) => ls.reduce((s, l) => s + Number(l.precio || 0), 0);
    const total = () => sumar(lineas);
    // Un grupo por combo: { id, plataformas, subtotal, pct, descuento }
    function combos() {
        const grupos = new Map();
        lineas.filter((l) => l.combo).forEach((l) => grupos.set(l.combo, [...(grupos.get(l.combo) ?? []), l]));
        return [...grupos].map(([id, ls]) => {
            const plataformas = new Set(ls.map((l) => l.id)).size;
            const pct = pctCombo(plataformas);
            const subtotal = sumar(ls);
            return { id, plataformas, subtotal, pct, descuento: Math.round((subtotal * pct) / 100) };
        });
    }
    const descuentoCombos = () => combos().reduce((s, c) => s + c.descuento, 0);
    // El cupón no se acumula con el combo: aplica solo a lo que va fuera de combos
    const baseCupon = () => sumar(lineas.filter((l) => !l.combo));
    const descuento = () => (cupon ? Math.round((baseCupon() * cupon.porcentaje) / 100) : 0);
    const aPagar = () => total() - descuentoCombos() - descuento();
    function guardar() {
        guardarLocal(CLAVE, lineas);
        document.querySelectorAll('[data-contador-carrito]').forEach((c) => {
            c.hidden = lineas.length === 0;
            c.textContent = lineas.length;
            c.classList.remove('salta');
            void c.offsetWidth;
            c.classList.add('salta');
        });
    }
    function agregar(p, variante, { combo = null, silencioso = false } = {}) {
        lineas.push({ uid: crypto.randomUUID(), id: p.id, nombre: p.nombre, variante: variante?.nombre ?? '', precio: Number(variante?.precio) || 0, imagen: p.imagen, tipo: p.tipo, combo });
        guardar();
        if (!silencioso) mostrarToast(`${p.nombre} agregado al carrito`, 'ok', 2500);
    }
    function quitar(uid) {
        lineas = lineas.filter((l) => l.uid !== uid);
        if (!lineas.length) cupon = null;
        guardar();
        abrirCarrito();
    }

    /* ---------- Hoja del carrito + pago paso a paso ---------- */
    function abrirCarrito() {
        const cuerpo = document.createElement('div');
        if (!lineas.length) {
            cuerpo.innerHTML = `<div class="text-center py-6"><i class="fa-solid fa-cart-shopping text-4xl text-neutral-600"></i>
                <p class="mt-3 font-bold">Tu carrito está vacío</p><p class="text-sm text-neutral-400 mt-1">Agrega plataformas desde el catálogo o arma un combo.</p>
                <a href="#catalogo" class="btn-p mt-5" data-cerrar>Ver catálogo</a></div>`;
            cuerpo.querySelector('[data-cerrar]').addEventListener('click', cerrarHoja);
            abrirHoja('Carrito', cuerpo);
            return;
        }
        const pasos = ['Resumen', 'Tus datos', 'Pago'];
        cuerpo.innerHTML = `<ol class="stepper mb-5">${pasos.map((t, i) => `<li class="${i + 1 === pago.paso ? 'activo' : i + 1 < pago.paso ? 'hecho' : ''}"><span>${i + 1}</span>${t}</li>`).join('')}</ol><div data-paso></div>`;
        const zona = cuerpo.querySelector('[data-paso]');
        ({ 1: pasoResumen, 2: pasoDatos, 3: pasoPago })[pago.paso](zona);
        abrirHoja(pago.paso === 1 ? 'Tu carrito' : 'Finalizar compra', cuerpo, { alCerrar: () => { pago.paso = 1; } });
    }
    const irPaso = (n) => { pago.paso = n; abrirCarrito(); };

    function totales() {
        return `<div class="space-y-1.5 mt-4 pt-4 border-t border-white/10">
            <div class="total-fila"><span>Subtotal (${lineas.length} ítem${lineas.length === 1 ? '' : 's'})</span><span>${precioCOP(total())}</span></div>
            ${combos().filter((c) => c.descuento > 0).map((c) => `<div class="total-fila text-emerald-300"><span><i class="fa-solid fa-layer-group"></i> Combo · ${c.plataformas} plataformas (-${pctTexto(c.pct)})</span><span>-${precioCOP(c.descuento)}</span></div>`).join('')}
            ${cupon ? `<div class="total-fila text-emerald-300"><span>Cupón ${escaparHTML(cupon.codigo)} (-${cupon.porcentaje}%)</span><span>-${precioCOP(descuento())}</span></div>` : ''}
            ${cupon && lineas.some((l) => l.combo) ? '<p class="text-[11px] text-neutral-500">El cupón no se acumula con el descuento del combo: aplica a los productos fuera del combo.</p>' : ''}
            <div class="total-fila grande"><span>Total</span><span>${precioCOP(aPagar())}</span></div>
        </div>`;
    }

    function pasoResumen(zona) {
        zona.innerHTML = `<div class="space-y-2" data-lineas></div>
            <form class="flex gap-2 mt-4" data-cupon>
                <input class="campo uppercase" name="c" placeholder="Cupón (ej. DCTECH2026)" autocomplete="off" value="${escaparHTML(cupon?.codigo ?? '')}">
                <button type="submit" class="btn-s shrink-0">Aplicar</button>
            </form>
            <p class="text-[11px] text-neutral-500 mt-1.5" data-cupon-msg></p>
            ${totales()}
            <button type="button" class="btn-p w-full mt-5" data-seguir>Continuar <i class="fa-solid fa-arrow-right"></i></button>`;
        zona.querySelector('[data-lineas]').replaceChildren(...lineas.map((l) => {
            const fila = document.createElement('div');
            fila.className = 'linea-carrito';
            fila.innerHTML = `<img src="${escaparHTML(l.imagen)}" alt="">
                <div class="flex-1 min-w-0"><p class="text-sm font-bold truncate">${escaparHTML(l.nombre)}</p>
                <p class="text-[11px] text-neutral-500 truncate">${escaparHTML(l.variante)}${l.combo ? ' · combo' : ''}</p></div>
                <b class="text-sm whitespace-nowrap">${precioCOP(l.precio)}</b>
                <button type="button" class="w-10 h-10 grid place-items-center rounded-xl text-neutral-400 hover:text-red-300" aria-label="Quitar ${escaparHTML(l.nombre)}"><i class="fa-solid fa-trash-can"></i></button>`;
            fila.querySelector('button').addEventListener('click', () => quitar(l.uid));
            return fila;
        }));
        zona.querySelector('[data-cupon]').addEventListener('submit', async (e) => {
            e.preventDefault();
            const codigo = e.target.c.value.trim().toUpperCase();
            const msg = zona.querySelector('[data-cupon-msg]');
            if (!codigo) return;
            msg.textContent = 'Validando…';
            const { data, error } = window.DC.sb ? await window.DC.sb.rpc('validar_cupon', { p_codigo: codigo }).maybeSingle() : { error: true };
            if (error || !data?.valido) {
                cupon = null;
                msg.textContent = data?.mensaje ?? 'Este cupón no existe o ya fue usado.';
                return;
            }
            cupon = { codigo, porcentaje: Number(data.porcentaje) || 0 };
            abrirCarrito();
            mostrarToast(`${data.mensaje ?? 'Cupón aplicado.'} Se confirma al validar tu pago.`, 'ok', 4000);
        });
        zona.querySelector('[data-seguir]').addEventListener('click', () => irPaso(2));
    }

    function pasoDatos(zona) {
        const datos = leerLocal(CLAVE_DATOS, {});
        zona.innerHTML = `<p class="text-sm text-neutral-400">Compra como invitado: solo necesitamos tu WhatsApp para entregarte el pedido.</p>
            <form class="space-y-3 mt-4" data-form novalidate>
                <label class="block"><span class="etiqueta">Tu nombre</span><input class="campo" name="nombre" autocomplete="name" maxlength="40" value="${escaparHTML(datos.nombre ?? '')}"></label>
                <label class="block"><span class="etiqueta">Tu WhatsApp</span><input class="campo" name="whatsapp" inputmode="tel" autocomplete="tel" placeholder="300 123 4567" value="${escaparHTML(datos.whatsapp ?? '')}" required></label>
                <p class="text-[11px] text-red-300" data-error></p>
                <div class="flex gap-2 pt-2"><button type="button" class="btn-s" data-atras><i class="fa-solid fa-arrow-left"></i></button>
                <button type="submit" class="btn-p flex-1">Elegir cómo pagar <i class="fa-solid fa-arrow-right"></i></button></div>
            </form>`;
        const form = zona.querySelector('[data-form]');
        zona.querySelector('[data-atras]').addEventListener('click', () => irPaso(1));
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const numero = WA.normalizarNumero(form.whatsapp.value);
            if (!numero) { zona.querySelector('[data-error]').textContent = 'Escribe un WhatsApp válido (10 dígitos).'; return; }
            guardarLocal(CLAVE_DATOS, { nombre: form.nombre.value.trim(), whatsapp: form.whatsapp.value.trim() });
            irPaso(3);
        });
    }

    function pasoPago(zona) {
        const metodos = window.DC.estado.metodos;
        const cats = Object.entries(WA.CATEGORIAS_PAGO).filter(([cat]) => metodos.some((m) => m.categoria === cat));
        if (!cats.some(([cat]) => cat === pago.categoria)) pago.categoria = cats[0]?.[0] ?? 'electronico';
        const lista = metodos.filter((m) => m.categoria === pago.categoria);
        if (!lista.some((m) => m.tipo === pago.metodo?.tipo && m.red === pago.metodo?.red)) pago.metodo = lista[0] ?? null;

        zona.innerHTML = `
            ${cats.length > 1 ? `<div class="chips mb-3" role="tablist">${cats.map(([cat, titulo]) => `<button type="button" class="chip" role="tab" data-cat="${cat}" aria-selected="${cat === pago.categoria}"><i class="fa-solid ${cat === 'cripto' ? 'fa-coins' : 'fa-wallet'} mr-1"></i>${escaparHTML(cat === 'cripto' ? 'Cripto' : 'Pagos locales')}</button>`).join('')}</div>` : ''}
            <div class="space-y-2" data-metodos></div>
            ${!metodos.length ? '<p class="tarjeta text-sm text-neutral-400">Te enviamos las opciones de pago disponibles por WhatsApp.</p>' : ''}
            ${pago.metodo?.categoria === 'cripto' && pago.metodo.red !== 'BINANCE_PAY' ? `<p class="alerta-red mt-3"><i class="fa-solid fa-triangle-exclamation"></i> Envía <b>solo ${escaparHTML(pago.metodo.moneda)} por la red ${escaparHTML(pago.metodo.red)}</b>. Otra red = pérdida total de los fondos. El monto exacto en ${escaparHTML(pago.metodo.moneda)} te lo da el bot con la tasa del día.</p>` : ''}
            ${totales()}
            ${window.DC.sb && pago.metodo ? `<button type="button" class="btn-p w-full mt-5" data-pagar-web><i class="fa-solid fa-cloud-arrow-up"></i> Pagar y subir el comprobante aquí</button>
            <p class="text-[11px] text-neutral-500 text-center mt-2">Te damos los datos de pago y subes la captura sin salir de la página.</p>` : ''}
            <div class="flex gap-2 mt-3"><button type="button" class="btn-s" data-atras aria-label="Atrás"><i class="fa-solid fa-arrow-left"></i></button>
            <button type="button" class="${window.DC.sb && pago.metodo ? 'btn-s' : 'btn-p btn-w'} flex-1" data-confirmar><i class="fa-brands fa-whatsapp ${window.DC.sb && pago.metodo ? 'text-emerald-400' : ''}"></i> Confirmar por WhatsApp</button></div>`;
        zona.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { pago.categoria = b.dataset.cat; abrirCarrito(); }));
        zona.querySelector('[data-metodos]').replaceChildren(...lista.map((m) => {
            const t = WA.tipoPago(m.tipo) ?? { icono: 'fa-solid fa-wallet', color: '#64748B', nombre: m.tipo };
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'opcion';
            b.setAttribute('aria-pressed', String(m === pago.metodo));
            b.innerHTML = `<span class="flex items-center gap-3"><span class="radio"></span>
                <span class="w-8 h-8 grid place-items-center rounded-lg text-white text-sm" style="background:${escaparHTML(t.color)}"><i class="${escaparHTML(t.icono)}"></i></span>
                <span class="text-sm font-bold">${escaparHTML(m.categoria === 'cripto' ? `${m.moneda ?? t.nombre}${m.red && m.red !== 'BINANCE_PAY' ? ` · red ${m.red}` : ' · Binance Pay'}` : (m.nombre || t.nombre))}</span></span>`;
            b.addEventListener('click', () => { pago.metodo = m; abrirCarrito(); });
            return b;
        }));
        zona.querySelector('[data-atras]').addEventListener('click', () => irPaso(2));
        zona.querySelector('[data-confirmar]').addEventListener('click', confirmar);
        zona.querySelector('[data-pagar-web]')?.addEventListener('click', (e) => pagarWeb(e.currentTarget));
    }

    /* ---------- Pago en la web + comprobante (supabase/wo-030-comprobantes.sql) ---------- */
    const leerOrdenes = () => leerLocal(CLAVE_ORDENES, []);
    function guardarOrden(orden) {
        guardarLocal(CLAVE_ORDENES, [orden, ...leerOrdenes().filter((o) => o.codigo !== orden.codigo)].slice(0, 10));
    }

    async function pagarWeb(boton) {
        const datos = leerLocal(CLAVE_DATOS, {});
        const m = pago.metodo;
        boton.disabled = true;
        boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Creando tu orden…';
        const totalNavegador = aPagar();
        const items = lineas.map((l) => ({ producto: l.nombre, variante: l.variante, precio: l.precio, combo: l.combo ?? '' }));
        // wo-032: el navegador solo dice QUÉ compra; el precio, el combo y el cupón los calcula el servidor
        let { data, error } = await window.DC.sb.rpc('crear_orden_web', {
            p_whatsapp: datos.whatsapp, p_nombre: datos.nombre ?? null,
            p_items: lineas.map((l) => ({ producto_id: l.id, variante: l.variante, combo: l.combo ?? '' })),
            p_metodo: m.tipo, p_red: m.red ?? null, p_cupon: cupon?.codigo ?? null,
        });
        if (error?.code === 'PGRST202') {
            // Base sin wo-032 todavía: versión anterior (wo-030), el equipo valida el monto a mano
            ({ data, error } = await window.DC.sb.rpc('crear_orden_web', {
                p_whatsapp: datos.whatsapp, p_nombre: datos.nombre ?? null, p_items: items, p_total: totalNavegador,
                p_metodo: m.tipo, p_red: m.red ?? null, p_cupon: cupon?.codigo ?? null,
            }));
        }
        const r = data?.[0];
        if (error || !r?.ok) {
            boton.disabled = false;
            boton.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Pagar y subir el comprobante aquí';
            mostrarToast(r?.mensaje ?? (error?.code === 'PGRST202' ? 'El pago en la web aún no está activo: confirma por WhatsApp.' : 'No pudimos crear la orden. Intenta de nuevo o confirma por WhatsApp.'), 'error', 6000);
            return;
        }
        const total = Number(r.total) > 0 ? Number(r.total) : totalNavegador;
        if (total !== totalNavegador) mostrarToast(`Actualizamos el total con los precios vigentes: ${precioCOP(total)}.`, 'info', 6000);
        if (r.detalle?.cupon_mensaje) mostrarToast(r.detalle.cupon_mensaje, 'info', 6000);
        const orden = { codigo: r.codigo, secreto: r.secreto, total, pago: r.pago, items: r.detalle?.lineas ?? items, estado: 'ESPERANDO_PAGO', creado: new Date().toISOString() };
        guardarOrden(orden);
        lineas = [];
        cupon = null;
        pago.paso = 1;
        guardar();
        navigator.vibrate?.(20);
        abrirOrden(orden);
    }

    // Hoja de la orden: datos de pago del método elegido + subida del comprobante
    function abrirOrden(orden) {
        const pg = orden.pago ?? {};
        const cripto = pg.categoria === 'cripto';
        const monto = cripto ? WA.montoCripto(orden.total, pg) : null;
        const copiable = (etiqueta, valor) => (valor ? `<div class="dato-pago"><span><small>${escaparHTML(etiqueta)}</small><b class="font-mono">${escaparHTML(valor)}</b></span>
            <button type="button" class="icono-btn" data-copiar="${escaparHTML(valor)}" aria-label="Copiar ${escaparHTML(etiqueta)}"><i class="fa-regular fa-copy"></i></button></div>` : '');
        const cuerpo = document.createElement('div');
        cuerpo.innerHTML = `
            <div class="orden-cabecera">
                <span><small>Tu orden</small><b class="font-mono">${escaparHTML(orden.codigo)}</b></span>
                <span class="text-right"><small>Total a pagar</small><b>${precioCOP(orden.total)}</b></span>
            </div>
            <p class="etiqueta mt-5">1 · Paga con ${escaparHTML(pg.nombre ?? pg.tipo ?? 'el método elegido')}</p>
            <div class="space-y-2">
                ${cripto ? copiable(`Monto exacto en ${pg.moneda}`, monto !== null ? String(monto) : '') : ''}
                ${cripto && monto === null ? '<p class="alerta-red">La tasa de hoy no está publicada: un asesor te confirma el monto en cripto antes de pagar.</p>' : ''}
                ${copiable(cripto ? (pg.red === 'BINANCE_PAY' ? 'Pay ID / correo de Binance' : `Dirección ${pg.moneda} · red ${pg.red}`) : 'Número o cuenta', pg.numero_cuenta)}
                ${copiable('Memo / tag (obligatorio)', pg.memo)}
                ${pg.titular ? `<p class="text-xs text-neutral-400"><i class="fa-solid fa-user-check text-dcRed"></i> Titular: <b class="text-white">${escaparHTML(pg.titular)}</b></p>` : ''}
                ${pg.url_pago ? `<a class="btn-s w-full" href="${escaparHTML(pg.url_pago)}" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Abrir enlace de pago</a>` : ''}
                ${pg.qr_url ? `<img src="${escaparHTML(pg.qr_url)}" alt="Código QR de pago" class="qr-pago">` : ''}
                ${pg.instrucciones ? `<p class="text-xs text-neutral-400">${escaparHTML(pg.instrucciones)}</p>` : ''}
                ${cripto && pg.red !== 'BINANCE_PAY' ? `<p class="alerta-red"><i class="fa-solid fa-triangle-exclamation"></i> Envía <b>solo ${escaparHTML(pg.moneda)} por la red ${escaparHTML(pg.red)}</b>. Otra red = pérdida total de los fondos.</p>` : ''}
            </div>
            <p class="etiqueta mt-6">2 · Sube tu comprobante</p>
            <form data-subir novalidate>
                <label class="zona-archivo" data-zona>
                    <input type="file" name="archivo" accept="image/jpeg,image/png,image/webp,application/pdf" class="sr-only">
                    <span data-vista-previa><i class="fa-solid fa-cloud-arrow-up"></i><b>Toca para elegir la captura o el PDF</b><small>JPG, PNG, WEBP o PDF · máximo 5 MB</small></span>
                </label>
                <label class="block mt-3"><span class="etiqueta">${cripto ? 'Hash de la transacción (TXID)' : 'Número de referencia (opcional)'}</span>
                    <input class="campo font-mono" name="referencia" maxlength="120" autocomplete="off" spellcheck="false" placeholder="${cripto ? '0x… / hash' : 'Ej: M1234567'}"></label>
                <p class="text-xs text-red-300 min-h-[1rem] mt-2" data-error></p>
                <button type="submit" class="btn-p w-full mt-1" data-enviar disabled><i class="fa-solid fa-paper-plane"></i> Enviar comprobante</button>
            </form>
            <p class="text-[11px] text-neutral-500 text-center mt-3"><i class="fa-solid fa-lock"></i> El archivo va a un espacio privado: solo lo ve el equipo que valida tu pago.</p>`;
        cuerpo.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', () => copiarTexto(b.dataset.copiar)));
        const form = cuerpo.querySelector('[data-subir]');
        const error = cuerpo.querySelector('[data-error]');
        const enviar = cuerpo.querySelector('[data-enviar]');
        let archivo = null;
        let vista = null;
        form.archivo.addEventListener('change', () => {
            const f = form.archivo.files?.[0];
            error.textContent = '';
            if (vista) URL.revokeObjectURL(vista);
            archivo = null;
            enviar.disabled = true;
            if (!f) return;
            if (!TIPOS_ARCHIVO[f.type]) { error.textContent = 'Sube una foto (JPG, PNG, WEBP) o un PDF.'; return; }
            if (f.size > MAX_BYTES) { error.textContent = 'El archivo pesa más de 5 MB. Toma una captura más liviana.'; return; }
            archivo = f;
            enviar.disabled = false;
            const zona = cuerpo.querySelector('[data-vista-previa]');
            cuerpo.querySelector('[data-zona]').classList.add('con-archivo');
            if (f.type === 'application/pdf') zona.innerHTML = `<i class="fa-solid fa-file-pdf"></i><b>${escaparHTML(f.name)}</b><small>Toca para cambiarlo</small>`;
            else { vista = URL.createObjectURL(f); zona.innerHTML = `<img src="${vista}" alt="Vista previa del comprobante"><small>Toca para cambiarlo</small>`; }
        });
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!archivo) return;
            enviar.disabled = true;
            enviar.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Subiendo…';
            const r = await subirComprobante(orden, archivo, form.referencia.value.trim());
            if (!r.ok) {
                error.textContent = r.mensaje;
                enviar.disabled = false;
                enviar.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar comprobante';
                return;
            }
            if (vista) URL.revokeObjectURL(vista);
            guardarOrden({ ...orden, estado: 'COMPROBANTE_RECIBIDO' });
            ordenRecibida(orden);
        });
        abrirHoja('Paga tu pedido', cuerpo);
    }

    async function subirComprobante(orden, archivo, referencia) {
        const sb = window.DC.sb;
        const { data: a } = await sb.rpc('autorizar_subida', { p_codigo: orden.codigo, p_secreto: orden.secreto, p_extension: TIPOS_ARCHIVO[archivo.type] });
        if (!a?.[0]?.ok) return { ok: false, mensaje: a?.[0]?.mensaje ?? 'No pudimos preparar la subida. Intenta de nuevo.' };
        const ruta = a[0].ruta;
        const { error } = await sb.storage.from('comprobantes').upload(ruta, archivo, { contentType: archivo.type, upsert: false });
        if (error) return { ok: false, mensaje: 'No se pudo subir el archivo. Revisa tu conexión e intenta de nuevo.' };
        const { data: c } = await sb.rpc('registrar_comprobante', { p_codigo: orden.codigo, p_secreto: orden.secreto, p_ruta: ruta, p_referencia: referencia || null });
        return c?.[0] ?? { ok: false, mensaje: 'No pudimos registrar el comprobante. Intenta de nuevo.' };
    }

    function ordenRecibida(orden) {
        const aviso = `Hola DC Technology, acabo de subir el comprobante de mi orden ${orden.codigo} (${precioCOP(orden.total)}).`;
        abrirHoja('¡Comprobante recibido!', `
            <div class="text-center py-4">
                <div class="exito-check" aria-hidden="true"><i class="fa-solid fa-check"></i></div>
                <p class="font-tech text-xl font-black mt-4">Orden ${escaparHTML(orden.codigo)}</p>
                <p class="text-sm text-neutral-400 mt-2">Validamos tu pago y te avisamos por WhatsApp. Al validarlo, tu pedido sale en máximo ${WA.ENTREGA_MAX_MIN} minutos dentro del horario.</p>
                <div class="grid gap-2 mt-5">
                    <a href="#cuenta" class="btn-p" data-ir-pedidos><i class="fa-solid fa-receipt"></i> Seguir en Mis pedidos</a>
                    <a class="btn-s" target="_blank" rel="noopener" href="${escaparHTML(WA.enlace(WA.NUMERO_TIENDA, aviso))}"><i class="fa-brands fa-whatsapp text-emerald-400"></i> Avisar por WhatsApp (opcional)</a>
                </div>
            </div>`);
        document.querySelector('#hoja [data-ir-pedidos]')?.addEventListener('click', cerrarHoja);
        mostrarToast('Comprobante enviado ✅', 'ok');
    }

    // Mensaje de pedido completo (mismo formato que entiende el bot) y WhatsApp
    function confirmar() {
        const datos = leerLocal(CLAVE_DATOS, {});
        const m = pago.metodo;
        const metodo = !m ? 'Por definir' : m.categoria === 'cripto' ? `${m.moneda}${m.red && m.red !== 'BINANCE_PAY' ? ` (red ${m.red})` : ' (Binance Pay)'}` : (m.nombre || WA.tipoPago(m.tipo)?.nombre || m.tipo);
        const texto = [
            `Hola DC Technology, quiero hacer este pedido${datos.nombre ? ` (soy ${WA.limpiarVariable(datos.nombre, 40)})` : ''}:`,
            ...lineas.map((l) => `• ${WA.limpiarVariable(l.nombre)}${l.variante ? ` – ${WA.limpiarVariable(l.variante)}` : ''}: ${precioCOP(l.precio)}`),
            ...combos().filter((c) => c.descuento > 0).map((c) => `• Descuento combo (${c.plataformas} plataformas, -${pctTexto(c.pct)}): -${precioCOP(c.descuento)}`),
            cupon && descuento() > 0 ? `• Cupón: ${cupon.codigo} (-${cupon.porcentaje}%): -${precioCOP(descuento())}` : null,
            `• Total: ${precioCOP(aPagar())}`,
            `• Pago con: ${metodo}`,
            'Acepto los términos de uso. ¿Me envían los datos para pagar?',
        ].filter(Boolean).join('\n');
        window.open(WA.enlace(WA.NUMERO_TIENDA, texto), '_blank', 'noopener');
        lineas = [];
        cupon = null;
        pago.paso = 1;
        guardar();
        cerrarHoja();
        mostrarToast('Abrimos WhatsApp con tu pedido. Envía el mensaje para recibir los datos de pago.', 'ok', 6000);
    }

    /* ---------- Combos: varias plataformas en un solo pedido ---------- */
    const combo = { paso: 1, elegidos: new Map() }; // id → variante elegida

    function iniciarCon(p) {
        combo.paso = 1;
        if (p) combo.elegidos.set(p.id, p.variantes?.find((v) => Number(v.precio) > 0) ?? p.variantes?.[0]);
        pintarCombo();
    }

    function pintarCombo() {
        const caja = document.getElementById('combo-contenido');
        if (!caja) return;
        document.querySelectorAll('[data-paso-combo]').forEach((li) => {
            const n = Number(li.dataset.pasoCombo);
            li.className = n === combo.paso ? 'activo' : n < combo.paso ? 'hecho' : '';
        });
        const productos = window.DC.estado.productos.filter((p) => DIGITALES.includes(p.tipo));
        const elegidos = productos.filter((p) => combo.elegidos.has(p.id));
        const suma = elegidos.reduce((s, p) => s + Number(combo.elegidos.get(p.id)?.precio || 0), 0);
        const pct = pctCombo(elegidos.length);
        const ahorro = Math.round((suma * pct) / 100);
        const proxima = siguienteRegla(elegidos.length);
        const falta = proxima ? proxima.min - elegidos.length : 0;
        const pista = proxima ? `Agrega ${falta} plataforma${falta === 1 ? '' : 's'} más y ahorra ${pctTexto(proxima.pct)}` : pct ? '¡Tienes el mayor descuento!' : '';
        pintarReglas(elegidos.length);

        if (combo.paso === 1) {
            caja.innerHTML = `<div class="rejilla" data-lista></div>
                <div class="barra-combo tarjeta mt-4 flex items-center justify-between gap-3 sticky bottom-24 md:bottom-4 z-20">
                    <span class="text-sm min-w-0"><b>${elegidos.length}</b> elegida${elegidos.length === 1 ? '' : 's'}${pct ? ` <span class="sello-combo">-${pctTexto(pct)}</span>` : ''}
                        ${pista ? `<small class="block text-[11px] leading-snug text-neutral-400">${escaparHTML(pista)}</small>` : ''}</span>
                    <button type="button" class="btn-p" data-seguir ${elegidos.length < 2 ? 'disabled' : ''}>Elegir planes <i class="fa-solid fa-arrow-right"></i></button>
                </div>
                ${elegidos.length < 2 ? '<p class="text-[11px] text-neutral-500 mt-2 text-center">Elige al menos 2 plataformas.</p>' : ''}`;
            caja.querySelector('[data-lista]').replaceChildren(...productos.map((p) => window.DC.tarjetaProducto(p, {
                elegido: combo.elegidos.has(p.id),
                icono: combo.elegidos.has(p.id) ? 'fa-check' : 'fa-plus',
                alElegir: () => {
                    if (combo.elegidos.has(p.id)) combo.elegidos.delete(p.id);
                    else combo.elegidos.set(p.id, p.variantes?.find((v) => Number(v.precio) > 0) ?? p.variantes?.[0]);
                    pintarCombo();
                },
            })));
            caja.querySelector('[data-seguir]').addEventListener('click', () => { combo.paso = 2; pintarCombo(); });
            return;
        }
        if (combo.paso === 2) {
            caja.innerHTML = `<div class="space-y-4" data-planes></div>
                <div class="tarjeta mt-4 space-y-1.5">
                    ${pct ? `<div class="total-fila"><span>Subtotal</span><span>${precioCOP(suma)}</span></div>
                    <div class="total-fila text-emerald-300"><span>Descuento combo (-${pctTexto(pct)})</span><span>-${precioCOP(ahorro)}</span></div>` : ''}
                    <div class="total-fila grande"><span>Total del combo</span><span>${precioCOP(suma - ahorro)}</span></div>
                </div>
                <div class="flex gap-2 mt-4"><button type="button" class="btn-s" data-atras><i class="fa-solid fa-arrow-left"></i></button>
                <button type="button" class="btn-p flex-1" data-seguir>Agregar combo al carrito</button></div>`;
            caja.querySelector('[data-planes]').replaceChildren(...elegidos.map((p) => {
                const bloque = document.createElement('div');
                bloque.className = 'tarjeta';
                bloque.innerHTML = `<p class="font-bold mb-2">${escaparHTML(p.nombre)}</p><div class="space-y-2"></div>`;
                bloque.querySelector('.space-y-2').replaceChildren(...(p.variantes ?? []).map((v) => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'opcion';
                    b.setAttribute('aria-pressed', String(combo.elegidos.get(p.id) === v));
                    b.innerHTML = `<span class="flex items-center gap-3"><span class="radio"></span><span class="text-sm">${escaparHTML(v.nombre)}</span></span><b class="text-sm">${precioCOP(v.precio)}</b>`;
                    b.addEventListener('click', () => { combo.elegidos.set(p.id, v); pintarCombo(); });
                    return b;
                }));
                return bloque;
            }));
            caja.querySelector('[data-atras]').addEventListener('click', () => { combo.paso = 1; pintarCombo(); });
            caja.querySelector('[data-seguir]').addEventListener('click', () => {
                const id = `combo-${Date.now().toString(36)}`;
                elegidos.forEach((p) => agregar(p, combo.elegidos.get(p.id), { combo: id, silencioso: true }));
                combo.paso = 3;
                pintarCombo();
            });
            return;
        }
        caja.innerHTML = `<div class="tarjeta text-center py-8">
            <i class="fa-solid fa-circle-check text-4xl text-emerald-400"></i>
            <p class="mt-3 font-tech text-xl font-black">¡Combo en tu carrito!</p>
            <p class="text-sm text-neutral-400 mt-1">${elegidos.length} plataformas · ${precioCOP(suma - ahorro)} en un solo pago${ahorro ? ` · ahorras <b class="text-emerald-300">${precioCOP(ahorro)}</b>` : ''}.</p>
            <div class="flex flex-wrap justify-center gap-2 mt-5"><button type="button" class="btn-p" data-pagar>Ir a pagar</button><button type="button" class="btn-s" data-nuevo>Armar otro</button></div></div>`;
        caja.querySelector('[data-pagar]').addEventListener('click', () => { pago.paso = 1; abrirCarrito(); });
        caja.querySelector('[data-nuevo]').addEventListener('click', () => { combo.elegidos.clear(); iniciarCon(); });
    }

    // Fichas con los descuentos vigentes; se ilumina la que alcanza el combo actual
    function pintarReglas(n = 0) {
        const caja = document.getElementById('combo-reglas');
        if (!caja) return;
        const lista = reglas();
        caja.hidden = !lista.length;
        const actual = lista.filter((r) => r.min <= n).sort((a, b) => b.min - a.min)[0];
        caja.innerHTML = lista.map((r, i) => `<span class="${r === actual ? 'alcanzada' : ''}"><i class="fa-solid fa-layer-group"></i> ${r.min}${i === lista.length - 1 ? ' o más' : ''} plataformas <b>-${pctTexto(r.pct)}</b></span>`).join('');
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-abrir-carrito]').forEach((b) => b.addEventListener('click', () => { pago.paso = 1; abrirCarrito(); }));
        guardar();
    });
    document.addEventListener('dc:catalogo-listo', () => pintarCombo());
    document.addEventListener('dc:reglas-combo', () => pintarCombo());
    // Precios de la base: el carrito guardado en el dispositivo se pone al día (una variante que ya no se
    // vende sale del carrito con aviso)
    document.addEventListener('dc:precios-base', () => {
        const antes = lineas.length;
        lineas = lineas.map((l) => {
            const v = window.DC.estado.productos.find((p) => p.id === l.id)?.variantes?.find((x) => x.nombre === l.variante);
            return v ? { ...l, precio: Number(v.precio) || 0 } : null;
        }).filter(Boolean);
        if (lineas.length < antes) mostrarToast('Quitamos del carrito un producto que ya no está disponible.', 'info', 5000);
        guardar();
        pintarCombo();
    });
    document.addEventListener('dc:vista', (e) => { if (e.detail === 'combos') pintarCombo(); });

    window.Carrito = { agregar, abrir: abrirCarrito, lineas: () => lineas, combos, aPagar, pctCombo, abrirOrden, ordenes: leerOrdenes };
    window.Combos = { iniciarCon };
})();
