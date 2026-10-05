// carrito.js — Carrito, armado de combos y pago paso a paso del portal (cliente.html).
// El carrito vive en el dispositivo (sin datos sensibles). El pago se confirma hoy por WhatsApp con el
// pedido completo ya escrito; el bot entrega los datos del método elegido y recibe el comprobante.
// (Cuando se aplique supabase/wo-028-portal.sql: orden en la base, monto único y subida de comprobante.)

(() => {
    const { WA, abrirHoja, cerrarHoja, precioCOP, leerLocal, guardarLocal } = window.DC;
    const CLAVE = 'dc_cliente_carrito';
    const CLAVE_DATOS = 'dc_cliente_datos';
    const DIGITALES = ['streaming', 'licencias', 'pines', 'recargas'];

    let lineas = leerLocal(CLAVE, []);   // [{ uid, id, nombre, variante, precio, imagen, tipo, combo }]
    let cupon = null;                    // { codigo, porcentaje }
    const pago = { paso: 1, categoria: 'electronico', metodo: null };

    /* ---------- Estado del carrito ---------- */
    const total = () => lineas.reduce((s, l) => s + Number(l.precio || 0), 0);
    const descuento = () => (cupon ? Math.round((total() * cupon.porcentaje) / 100) : 0);
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
            ${cupon ? `<div class="total-fila text-emerald-300"><span>Cupón ${escaparHTML(cupon.codigo)} (-${cupon.porcentaje}%)</span><span>-${precioCOP(descuento())}</span></div>` : ''}
            <div class="total-fila grande"><span>Total</span><span>${precioCOP(total() - descuento())}</span></div>
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
            <div class="tarjeta mt-4 text-sm text-neutral-400"><i class="fa-brands fa-whatsapp text-emerald-400"></i> Al confirmar se abre WhatsApp con tu pedido listo: te damos los datos de pago y nos envías ahí el comprobante (o el hash si pagas en cripto).</div>
            <div class="flex gap-2 mt-4"><button type="button" class="btn-s" data-atras><i class="fa-solid fa-arrow-left"></i></button>
            <button type="button" class="btn-p btn-w flex-1" data-confirmar><i class="fa-brands fa-whatsapp"></i> Confirmar pedido</button></div>`;
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
    }

    // Mensaje de pedido completo (mismo formato que entiende el bot) y WhatsApp
    function confirmar() {
        const datos = leerLocal(CLAVE_DATOS, {});
        const m = pago.metodo;
        const metodo = !m ? 'Por definir' : m.categoria === 'cripto' ? `${m.moneda}${m.red && m.red !== 'BINANCE_PAY' ? ` (red ${m.red})` : ' (Binance Pay)'}` : (m.nombre || WA.tipoPago(m.tipo)?.nombre || m.tipo);
        const texto = [
            `Hola DC Technology, quiero hacer este pedido${datos.nombre ? ` (soy ${WA.limpiarVariable(datos.nombre, 40)})` : ''}:`,
            ...lineas.map((l) => `• ${WA.limpiarVariable(l.nombre)}${l.variante ? ` – ${WA.limpiarVariable(l.variante)}` : ''}: ${precioCOP(l.precio)}`),
            cupon ? `• Cupón: ${cupon.codigo} (-${cupon.porcentaje}%)` : null,
            `• Total: ${precioCOP(total() - descuento())}`,
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

        if (combo.paso === 1) {
            caja.innerHTML = `<div class="rejilla" data-lista></div>
                <div class="barra-combo tarjeta mt-4 flex items-center justify-between gap-3 sticky bottom-24 md:bottom-4 z-20">
                    <span class="text-sm"><b>${elegidos.length}</b> elegida${elegidos.length === 1 ? '' : 's'}</span>
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
                <div class="tarjeta mt-4 flex items-center justify-between gap-3"><span class="text-sm">Total del combo <b class="ml-1">${precioCOP(suma)}</b></span></div>
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
            <p class="text-sm text-neutral-400 mt-1">${elegidos.length} plataformas · ${precioCOP(suma)} en un solo pago.</p>
            <div class="flex flex-wrap justify-center gap-2 mt-5"><button type="button" class="btn-p" data-pagar>Ir a pagar</button><button type="button" class="btn-s" data-nuevo>Armar otro</button></div></div>`;
        caja.querySelector('[data-pagar]').addEventListener('click', () => { pago.paso = 1; abrirCarrito(); });
        caja.querySelector('[data-nuevo]').addEventListener('click', () => { combo.elegidos.clear(); iniciarCon(); });
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-abrir-carrito]').forEach((b) => b.addEventListener('click', () => { pago.paso = 1; abrirCarrito(); }));
        guardar();
    });
    document.addEventListener('dc:catalogo-listo', () => pintarCombo());
    document.addEventListener('dc:vista', (e) => { if (e.detail === 'combos') pintarCombo(); });

    window.Carrito = { agregar, abrir: abrirCarrito, lineas: () => lineas };
    window.Combos = { iniciarCon };
})();
