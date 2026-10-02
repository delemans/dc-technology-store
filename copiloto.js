// copiloto.js — Copiloto de ventas de la tienda (asistente por reglas, sin IA generativa).
// Responde con las MISMAS FAQ que usa el bot de WhatsApp (bot-conocimiento.json),
// recomienda productos reales del catálogo y pasa la conversación a un asesor por WhatsApp.
(() => {
    const WA = window.PlantillasWA;
    const panel = document.getElementById('copiloto-panel');
    const btnAbrir = document.getElementById('copiloto-abrir');
    const burbuja = document.getElementById('copiloto-burbuja');
    const mensajes = document.getElementById('copiloto-mensajes');
    const atajos = document.getElementById('copiloto-atajos');
    const form = document.getElementById('copiloto-form');
    const input = document.getElementById('copiloto-input');
    if (!panel || !WA) return;

    let faq = [];
    let iniciado = false;
    let ultimoProducto = null;

    // Respaldo mínimo si bot-conocimiento.json no carga (p. ej. abriendo el archivo sin servidor)
    const FAQ_RESPALDO = [
        { id: 'como_comprar', pregunta: '¿Cómo compro?', respuesta: 'Elige tu producto, toca "Comprar", acepta los términos y te abrimos WhatsApp con el pedido listo. Te enviamos los datos de pago y, al validar tu comprobante, procesamos tu pedido.' },
        { id: 'metodos_pago', pregunta: '¿Qué métodos de pago aceptan?', respuesta: 'Por ahora recibimos Nequi y Daviplata.' },
        { id: 'garantia', pregunta: '¿Tienen garantía?', respuesta: 'Sí: 30 días desde la entrega en cuentas, licencias y tecnología, si se respetan las reglas de uso.' },
        { id: 'horario_atencion', pregunta: '¿Horario?', respuesta: 'Lunes a sábado, 8:00 a.m. – 8:00 p.m.' },
    ];

    const RECOMENDACIONES = [
        { id: 'streaming', texto: 'Streaming', icono: 'fa-tv', tipos: ['streaming'] },
        { id: 'licencias', texto: 'Licencias', icono: 'fa-key', tipos: ['licencias'] },
        { id: 'reparacion', texto: 'Reparación / servicio', icono: 'fa-screwdriver-wrench', tipos: ['servicios', 'alquiler'] },
        { id: 'tecnologia', texto: 'Tecnología', icono: 'fa-headphones', tipos: ['tecnologia'] },
        { id: 'pines', texto: 'Pines y recargas', icono: 'fa-gamepad', tipos: ['pines', 'recargas'] },
    ];

    const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    async function cargarFAQ() {
        try {
            const r = await fetch('bot-conocimiento.json', { cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const datos = await r.json();
            faq = (datos.faq ?? []).filter((f) => !f.pendiente_configurar && f.respuesta);
        } catch (error) {
            console.warn('Copiloto: usando FAQ de respaldo.', error);
            faq = FAQ_RESPALDO;
        }
    }
    const respuestaFAQ = (id) => faq.find((f) => f.id === id) ?? FAQ_RESPALDO.find((f) => f.id === id);

    /* ---------- Mensajes ---------- */

    function agregar(html, de = 'bot') {
        const fila = document.createElement('div');
        fila.className = `flex ${de === 'bot' ? 'justify-start' : 'justify-end'}`;
        const globo = document.createElement('div');
        globo.className = de === 'bot'
            ? 'max-w-[88%] rounded-2xl rounded-tl-md bg-white/[0.06] ring-1 ring-white/10 px-4 py-3 text-sm text-neutral-200 space-y-2'
            : 'max-w-[80%] rounded-2xl rounded-tr-md bg-dcRed px-4 py-2.5 text-sm font-semibold text-white';
        if (de === 'bot') globo.innerHTML = html;
        else globo.textContent = html;
        fila.appendChild(globo);
        mensajes.appendChild(fila);
        fila.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
        mensajes.scrollTo({ top: mensajes.scrollHeight, behavior: 'smooth' });
        return globo;
    }

    const textoSeguro = (t) => escaparHTML(t).replace(/\n/g, '<br>');

    function botonAsesor(etiqueta = 'Hablar con un asesor') {
        const texto = ultimoProducto
            ? WA.comprarAhora({ producto: ultimoProducto.nombre })
            : 'Hola DC Technology, necesito asesoría para elegir un producto.';
        return `<a href="${WA.enlace(WA.NUMERO_TIENDA, texto)}" target="_blank" rel="noopener"
            class="btn-cyber verde mt-1 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-black uppercase tracking-wider text-white">
            <i class="fa-brands fa-whatsapp text-base"></i> ${escaparHTML(etiqueta)}</a>`;
    }

    function tarjetasProductos(lista) {
        const fmt = window.DCTienda?.formatearPrecio ?? ((v) => v);
        return `<div class="grid gap-2">${lista.map((p) => {
            const precios = (p.variantes ?? []).map((v) => Number(v.precio)).filter((n) => n > 0);
            const precio = precios.length ? `Desde ${fmt(Math.min(...precios))}` : 'A cotizar';
            return `<button type="button" data-producto="${escaparHTML(p.id)}" class="flex items-center gap-3 w-full min-h-[56px] text-left rounded-xl bg-dcDarkBg/70 ring-1 ring-white/10 hover:ring-dcRed/60 p-2 transition-all">
                <img src="${escaparHTML(p.imagen)}" alt="" class="w-12 h-12 rounded-lg object-contain bg-white/[0.04] shrink-0" loading="lazy">
                <span class="min-w-0"><span class="block text-xs font-bold text-white truncate">${escaparHTML(p.nombre)}</span>
                <span class="block text-[11px] text-dcRed font-black">${escaparHTML(precio)}</span></span>
                <i class="fa-solid fa-chevron-right ml-auto text-neutral-500 text-xs"></i></button>`;
        }).join('')}</div>`;
    }

    /* ---------- Intenciones ---------- */

    function responderFAQ(id, extra = '') {
        const f = respuestaFAQ(id);
        agregar(`<p>${textoSeguro(f?.respuesta ?? 'Te ayudo por WhatsApp.')}</p>${extra}`);
    }

    function pasosCompra() {
        agregar(`
            <p class="font-bold text-white">Comprar es muy fácil:</p>
            <ol class="list-decimal pl-5 space-y-1 text-[13px]">
                <li>Toca el producto y elige tu opción.</li>
                <li>Si tienes cupón, aplícalo (por ejemplo <b>DCTECH2026</b> en tu primera compra).</li>
                <li>Acepta los términos de uso.</li>
                <li>Te abrimos WhatsApp con el pedido listo y te enviamos los datos de pago.</li>
                <li>Al validar tu comprobante entregamos en máximo 15 minutos (lun–sáb, 8 a.m.–8 p.m.).</li>
            </ol>`);
    }

    function preguntarQueBusca() {
        const globo = agregar(`<p>¿Qué estás buscando?</p><div class="flex flex-wrap gap-2">${RECOMENDACIONES.map((r) =>
            `<button type="button" data-recomendar="${r.id}" class="inline-flex items-center gap-2 min-h-[40px] px-3 rounded-xl bg-dcDarkBg/70 ring-1 ring-white/10 hover:ring-dcRed/60 text-xs font-bold"><i class="fa-solid ${r.icono} text-dcRed"></i>${r.texto}</button>`).join('')}</div>`);
        return globo;
    }

    function recomendar(idCategoria) {
        const cat = RECOMENDACIONES.find((r) => r.id === idCategoria);
        const productos = (window.DCTienda?.productos() ?? []).filter((p) => cat.tipos.includes(p.tipo));
        if (!productos.length) {
            agregar(`<p>Aún estoy cargando el catálogo, intenta en un segundo.</p>`);
            return;
        }
        // Primero los que tienen mayor descuento real, luego por precio
        const puntaje = (p) => {
            const v = p.variantes?.[0] ?? {};
            const desc = Number(v.precio_anterior) > Number(v.precio) ? (v.precio_anterior - v.precio) / v.precio_anterior : 0;
            return desc;
        };
        const top = [...productos].sort((a, b) => puntaje(b) - puntaje(a)).slice(0, 3);
        agregar(`<p>Te recomiendo estas opciones de <b>${escaparHTML(cat.texto)}</b>:</p>${tarjetasProductos(top)}
            ${cat.id === 'reparacion' ? '<p class="text-[12px] text-neutral-400">También puedes usar el <a href="#servicios" data-ir-servicios class="text-dcRed underline">cotizador express</a>.</p>' : ''}`);
    }

    function responderTexto(texto) {
        const t = normalizar(texto);
        if (!t) return;

        // Intenciones directas
        if (/(como compr|pasos para compr|como hago (el|un) pedido)/.test(t)) return pasosCompra();
        if (/(recomiend|que me sirve|no se que|ayudame a elegir)/.test(t)) return preguntarQueBusca();
        if (/(asesor|humano|persona|hablar con)/.test(t)) return agregar(`<p>¡Claro! Te paso con un asesor:</p>${botonAsesor()}`);

        // Productos del catálogo que coinciden
        const palabras = t.split(/\s+/).filter((w) => w.length >= 3);
        const productos = (window.DCTienda?.productos() ?? []).filter((p) => {
            const nombre = normalizar(`${p.nombre} ${p.marca}`);
            return palabras.some((w) => nombre.includes(w));
        }).slice(0, 4);

        // FAQ por palabras clave (de bot-conocimiento.json)
        const mejorFAQ = faq
            .map((f) => ({ f, hits: (f.palabras_clave ?? []).filter((k) => t.includes(normalizar(k))).length }))
            .filter((x) => x.hits > 0)
            .sort((a, b) => b.hits - a.hits)[0]?.f;

        if (productos.length && (!mejorFAQ || productos.length <= 4)) {
            agregar(`<p>Encontré esto en el catálogo:</p>${tarjetasProductos(productos)}`);
            if (mejorFAQ) agregar(`<p>${textoSeguro(mejorFAQ.respuesta)}</p>`);
            return;
        }
        if (mejorFAQ) return agregar(`<p>${textoSeguro(mejorFAQ.respuesta)}</p>`);
        agregar(`<p>No tengo una respuesta exacta para eso, pero un asesor te ayuda enseguida.</p>${botonAsesor()}`);
    }

    const ATAJOS = [
        { texto: '¿Cómo comprar?', accion: pasosCompra },
        { texto: 'Métodos de pago', accion: () => responderFAQ('metodos_pago') },
        { texto: 'Garantías', accion: () => responderFAQ('garantia', `<p class="text-[12px] text-neutral-400">Para reclamar, usa el botón de garantía en <a href="portal.html" class="text-dcRed underline">Mi pedido</a>.</p>`) },
        { texto: 'Recomiéndame', accion: preguntarQueBusca },
        { texto: 'Soporte', accion: () => agregar(`<p>Si ya compraste, revisa el estado en <a href="portal.html" class="text-dcRed underline">Mi pedido</a>. Si necesitas ayuda ahora:</p>${botonAsesor('Escribir a soporte')}`) },
    ];

    function pintarAtajos() {
        atajos.replaceChildren(...ATAJOS.map(({ texto, accion }) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'shrink-0 min-h-[40px] px-3 rounded-xl bg-white/[0.04] ring-1 ring-white/10 hover:ring-dcRed/60 text-[11px] font-bold text-neutral-200 whitespace-nowrap';
            b.textContent = texto;
            b.addEventListener('click', () => { agregar(texto, 'usuario'); accion(); });
            return b;
        }));
    }

    /* ---------- Apertura y contexto ---------- */

    async function abrir() {
        burbuja.hidden = true;
        panel.hidden = false;
        btnAbrir.setAttribute('aria-expanded', 'true');
        btnAbrir.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        panel.animate([{ opacity: 0, transform: 'translateY(16px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
        try { sessionStorage.setItem('dc_copiloto_visto', '1'); } catch { /* sin almacenamiento */ }

        if (!iniciado) {
            iniciado = true;
            await cargarFAQ();
            pintarAtajos();
            agregar(`<p>¡Hola! Soy el <b>Copiloto DC</b> 👋 Te ayudo a elegir, resolver dudas y hacer tu pedido.</p>
                ${ultimoProducto ? `<p>Veo que estás mirando <b>${escaparHTML(ultimoProducto.nombre)}</b>. ¿Tienes dudas sobre él?</p>` : ''}`);
            preguntarQueBusca();
        }
        input.focus({ preventScroll: true });
    }

    function cerrar() {
        panel.hidden = true;
        btnAbrir.setAttribute('aria-expanded', 'false');
        btnAbrir.innerHTML = '<i class="fa-solid fa-robot"></i>';
    }

    btnAbrir.addEventListener('click', () => (panel.hidden ? abrir() : cerrar()));
    document.getElementById('copiloto-cerrar').addEventListener('click', cerrar);

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const texto = input.value.trim();
        if (!texto) return;
        agregar(texto, 'usuario');
        input.value = '';
        setTimeout(() => responderTexto(texto), 250);
    });

    // Delegación: botones dentro de los mensajes
    mensajes.addEventListener('click', (e) => {
        const prod = e.target.closest('[data-producto]');
        if (prod) {
            window.DCTienda?.abrirProducto(prod.dataset.producto);
            if (window.matchMedia('(max-width: 640px)').matches) cerrar();
            return;
        }
        const rec = e.target.closest('[data-recomendar]');
        if (rec) {
            agregar(rec.textContent.trim(), 'usuario');
            recomendar(rec.dataset.recomendar);
            return;
        }
        if (e.target.closest('[data-ir-servicios]') && window.matchMedia('(max-width: 640px)').matches) cerrar();
    });

    // Acompaña la navegación: recuerda el último producto visto para dar contexto al asesor
    document.addEventListener('dc:producto-visto', (e) => { ultimoProducto = e.detail; });

    // Invitación suave una sola vez por sesión
    let yaVisto = false;
    try { yaVisto = sessionStorage.getItem('dc_copiloto_visto') === '1'; } catch { /* sin almacenamiento */ }
    if (!yaVisto) {
        setTimeout(() => {
            if (!panel.hidden) return;
            burbuja.hidden = false;
            burbuja.animate([{ opacity: 0, transform: 'translateX(10px)' }, { opacity: 1, transform: 'none' }], { duration: 300 });
            setTimeout(() => { burbuja.hidden = true; }, 9000);
        }, 15000);
    }
})();
