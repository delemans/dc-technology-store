// copiloto.js — Copiloto de ventas de la tienda (asistente por reglas, sin IA generativa).
// Responde con las MISMAS FAQ que usa el bot de WhatsApp (bot-conocimiento.json),
// recomienda productos reales del catálogo, sugiere complementos (solo con precios y descuentos reales)
// y pasa la conversación a un asesor por WhatsApp.
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
    let cargaFAQ = null;            // promesa única: se precarga en reposo para que abrir sea inmediato
    let iniciado = false;
    let ultimoProducto = null;
    let ultimoSugerido = null;      // evita repetir sugerencias del mismo producto
    let promoMostrada = false;      // el cupón de primera compra se menciona una vez por sesión
    let sinResolver = 0;            // respuestas seguidas sin acierto → se ofrece el asesor
    let cola = Promise.resolve();   // las respuestas salen en orden, aunque el usuario escriba rápido

    const GARANTIA_DIAS = 30;
    const TIPOS_CON_GARANTIA = ['streaming', 'licencias', 'tecnologia'];
    const TIPOS_COTIZABLES = ['servicios', 'alquiler'];
    const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Respaldo mínimo si bot-conocimiento.json no carga (p. ej. abriendo el archivo sin servidor)
    const FAQ_RESPALDO = [
        { id: 'como_comprar', pregunta: '¿Cómo compro?', respuesta: 'Elige tu producto, toca "Comprar", acepta los términos y te abrimos WhatsApp con el pedido listo. Te enviamos los datos de pago y, al validar tu comprobante, procesamos tu pedido.' },
        { id: 'metodos_pago', pregunta: '¿Qué métodos de pago aceptan?', palabras_clave: ['pago', 'pagar', 'nequi', 'daviplata', 'tarjeta', 'efectivo', 'pse', 'bancolombia'], respuesta: 'Solo recibimos Nequi y Daviplata. No aceptamos tarjetas, efectivo, PSE, Bancolombia ni criptomonedas.' },
        { id: 'tiempo_entrega', pregunta: '¿Cuánto tarda la entrega?', palabras_clave: ['cuanto tarda', 'demora', 'entrega', 'cuando llega'], respuesta: `Entregamos en máximo ${WA.ENTREGA_MAX_MIN} minutos después de validar tu pago (${WA.HORARIO}).` },
        { id: 'cupon_primera_compra', pregunta: '¿Cómo funciona DCTECH2026?', palabras_clave: ['cupon', 'descuento', 'dctech2026', 'promo'], respuesta: 'DCTECH2026 te da 10% de descuento solo en tu primera compra (se verifica con tu WhatsApp al validar el pago). Un cupón por compra.' },
        { id: 'garantia', pregunta: '¿Tienen garantía?', palabras_clave: ['garantia', 'no funciona', 'reclamo'], respuesta: `Sí: ${GARANTIA_DIAS} días desde la entrega en cuentas, licencias y tecnología, si se respetan las reglas de uso.` },
        { id: 'horario_atencion', pregunta: '¿Horario?', palabras_clave: ['horario', 'atienden', 'abierto'], respuesta: `Atendemos ${WA.HORARIO}.` },
    ];

    const RECOMENDACIONES = [
        { id: 'streaming', texto: 'Streaming', icono: 'fa-tv', tipos: ['streaming'] },
        { id: 'licencias', texto: 'Licencias', icono: 'fa-key', tipos: ['licencias'] },
        { id: 'reparacion', texto: 'Reparación / servicio', icono: 'fa-screwdriver-wrench', tipos: ['servicios', 'alquiler'] },
        { id: 'tecnologia', texto: 'Tecnología', icono: 'fa-headphones', tipos: ['tecnologia'] },
        { id: 'pines', texto: 'Pines y recargas', icono: 'fa-gamepad', tipos: ['pines', 'recargas'] },
    ];

    // Palabras que no identifican un producto (ya normalizadas, sin tildes)
    const PALABRAS_VACIAS = new Set(('con que para por los las una uno unos unas del mas pero como cuanto cuando donde tengo quiero '
        + 'puedo tiene tienen hay esta este esto ese esa son sin mis tus sus muy algo hola buenas dias tardes noches gracias '
        + 'precio precios vale cuesta comprar compre compra pagar pago antes ahora hoy ya').split(' '));

    const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const fmt = (v) => (window.DCTienda?.formatearPrecio ?? WA.precioCOP)(v);
    const catalogo = () => window.DCTienda?.productos() ?? [];
    const esperar = (ms) => new Promise((r) => setTimeout(r, reducirMovimiento ? 0 : ms));

    function cargarFAQ() {
        cargaFAQ ??= fetch('bot-conocimiento.json', { cache: 'no-store' })
            .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then((datos) => {
                faq = (datos.faq ?? []).filter((f) => !f.pendiente_configurar && f.respuesta);
                if (!faq.length) throw new Error('FAQ vacías');
            })
            .catch((error) => {
                console.warn('Copiloto: usando FAQ de respaldo.', error);
                faq = FAQ_RESPALDO;
            });
        return cargaFAQ;
    }
    const respuestaFAQ = (id) => faq.find((f) => f.id === id) ?? FAQ_RESPALDO.find((f) => f.id === id);

    /* ---------- Formato: texto plano seguro → HTML limpio ---------- */

    // Escapa todo y solo después aplica **negrita** / *negrita* (estilo WhatsApp), enlaces y viñetas
    function formatear(texto) {
        const lineas = escaparHTML(texto).split(/\n/);
        const html = [];
        let lista = [];
        const cerrarLista = () => {
            if (lista.length) html.push(`<ul class="list-disc pl-5 space-y-1 text-[13px]">${lista.map((l) => `<li>${l}</li>`).join('')}</ul>`);
            lista = [];
        };
        const enLinea = (l) => l
            .replace(/\*\*(.+?)\*\*|\*(\S(?:.*?\S)?)\*/g, (_, a, b) => `<b class="text-white">${a ?? b}</b>`)
            // El texto ya viene escapado: la URL termina antes de &quot; / &#39; y de la puntuación final
            .replace(/https?:\/\/(?:(?!&quot;|&#39;)[^\s<])+?(?=[.,;:!?)]*(?:\s|$|&quot;|&#39;))/g, (url) =>
                `<a href="${url}" target="_blank" rel="noopener" class="text-dcRed underline break-all">${url.replace(/^https?:\/\//, '')}</a>`);
        lineas.forEach((l) => {
            const vineta = l.match(/^\s*[-•]\s+(.*)$/);
            if (vineta) { lista.push(enLinea(vineta[1])); return; }
            cerrarLista();
            if (l.trim()) html.push(`<p>${enLinea(l)}</p>`);
        });
        cerrarLista();
        return html.join('');
    }

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
        if (!reducirMovimiento) fila.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
        mensajes.scrollTo({ top: mensajes.scrollHeight, behavior: reducirMovimiento ? 'auto' : 'smooth' });
        return globo;
    }

    // "Escribiendo…" breve y proporcional a la respuesta: la conversación se siente viva sin hacer esperar
    function responder(accion, ms = 450) {
        cola = cola.then(async () => {
            const fila = document.createElement('div');
            fila.className = 'flex justify-start';
            fila.setAttribute('aria-label', 'El copiloto está escribiendo');
            fila.innerHTML = `<div class="rounded-2xl rounded-tl-md bg-white/[0.06] ring-1 ring-white/10 px-4 py-3.5 flex gap-1.5">
                ${[0, 150, 300].map((d) => `<span class="w-1.5 h-1.5 rounded-full bg-neutral-400 animate-bounce" style="animation-delay:${d}ms"></span>`).join('')}</div>`;
            mensajes.appendChild(fila);
            mensajes.scrollTo({ top: mensajes.scrollHeight });
            await esperar(ms);
            fila.remove();
            await accion();
        }).catch((error) => console.error('Copiloto:', error));
        return cola;
    }

    function botonAsesor(etiqueta = 'Hablar con un asesor') {
        const texto = ultimoProducto
            ? WA.comprarAhora({ producto: ultimoProducto.nombre })
            : 'Hola DC Technology, necesito asesoría para elegir un producto.';
        return `<a href="${WA.enlace(WA.NUMERO_TIENDA, texto)}" target="_blank" rel="noopener"
            class="btn-cyber verde mt-1 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-black uppercase tracking-wider text-white">
            <i class="fa-brands fa-whatsapp text-base"></i> ${escaparHTML(etiqueta)}</a>`;
    }

    function tarjetasProductos(lista) {
        return `<div class="grid gap-2">${lista.map((p) => {
            const precios = (p.variantes ?? []).map((v) => Number(v.precio)).filter((n) => n > 0);
            const precio = precios.length ? `Desde ${fmt(Math.min(...precios))}` : 'A cotizar';
            const desc = descuento(p);
            return `<button type="button" data-producto="${escaparHTML(p.id)}" class="flex items-center gap-3 w-full min-h-[56px] text-left rounded-xl bg-dcDarkBg/70 ring-1 ring-white/10 hover:ring-dcRed/60 p-2 transition-all">
                <img src="${escaparHTML(p.imagen)}" alt="" class="w-12 h-12 rounded-lg object-contain bg-white/[0.04] shrink-0" loading="lazy">
                <span class="min-w-0"><span class="block text-xs font-bold text-white truncate">${escaparHTML(p.nombre)}</span>
                <span class="block text-[11px] text-dcRed font-black">${escaparHTML(precio)}${desc >= 0.1 ? ` <span class="ml-1 text-emerald-300">-${Math.round(desc * 100)}%</span>` : ''}</span></span>
                <i class="fa-solid fa-chevron-right ml-auto text-neutral-500 text-xs"></i></button>`;
        }).join('')}</div>`;
    }

    /* ---------- Venta sugerida (solo datos reales del catálogo) ---------- */

    // Mayor descuento real entre las variantes (precio_anterior vs precio)
    function descuento(p) {
        return Math.max(0, ...(p.variantes ?? []).map((v) => {
            const antes = Number(v.precio_anterior);
            const ahora = Number(v.precio);
            return antes > ahora && ahora > 0 ? (antes - ahora) / antes : 0;
        }));
    }
    const mejores = (lista, n = 2) => [...lista].sort((a, b) => descuento(b) - descuento(a)).slice(0, n);
    const familia = (p) => normalizar(p.nombre).split(/\s+/)[0]; // reloj, diademas, auriculares, powerbank…

    // Duración en meses de una variante ("1 Mes", "3 Meses", "1 Año Completo"); null si no aplica
    function meses(nombre) {
        const t = normalizar(nombre);
        const m = t.match(/(\d+)\s*mes/);
        if (m) return Number(m[1]);
        const a = t.match(/(\d+)\s*ano/);
        return a ? Number(a[1]) * 12 : null;
    }

    // Plan más largo del MISMO tipo (pantalla con pantalla, cuenta con cuenta) que sale más barato por mes
    function mejorValor(p) {
        const grupos = new Map();
        (p.variantes ?? []).forEach((v) => {
            const m = meses(v.nombre);
            if (!m || !(Number(v.precio) > 0)) return;
            const clave = normalizar(v.nombre).replace(/\d+\s*(meses|mes|anos|ano)( completo)?/, '').replace(/\s+/g, ' ').trim();
            grupos.set(clave, [...(grupos.get(clave) ?? []), { ...v, meses: m, mensual: Number(v.precio) / m }]);
        });
        let mejor = null;
        grupos.forEach((lista) => {
            if (lista.length < 2) return;
            const base = lista.reduce((a, b) => (b.meses < a.meses ? b : a));
            const top = lista.filter((v) => v.meses > base.meses).reduce((a, b) => (!a || b.mensual < a.mensual ? b : a), null);
            if (!top) return;
            const ahorro = 1 - top.mensual / base.mensual;
            if (ahorro >= 0.1 && (!mejor || ahorro > mejor.ahorro)) mejor = { variante: top.nombre, mensual: top.mensual, ahorro };
        });
        return mejor;
    }

    // El mejor de cada familia: sugiere cosas distintas (audífonos + powerbank), no dos variantes de lo mismo
    const unoPorFamilia = (lista) => [...new Map(mejores(lista, lista.length).reverse().map((x) => [familia(x), x])).values()].reverse();

    // Complementos, no sustitutos: nunca otro producto de la misma familia (Office no sugiere otro Office)
    function complementos(p) {
        const todos = catalogo().filter((x) => x.id !== p.id && familia(x) !== familia(p));
        const mismaMarca = unoPorFamilia(todos.filter((x) => normalizar(x.marca) === normalizar(p.marca) && !/^dc /.test(normalizar(x.marca))));
        const microsoft = unoPorFamilia(todos.filter((x) => x.tipo === 'licencias' && normalizar(x.marca) === 'microsoft'));
        const instalacion = todos.filter((x) => x.id === 'servicio-instalacion-so-licenciamiento');
        const reglas = {
            streaming: { titulo: 'Arma tu combo de entretenimiento', lista: [...mismaMarca, ...mejores(todos.filter((x) => x.tipo === 'streaming' && x.marca !== p.marca))] },
            licencias: { titulo: 'Complementa tu licencia', lista: normalizar(p.marca) === 'microsoft'
                ? [...mismaMarca.slice(0, 1), ...instalacion, ...mismaMarca.slice(1)]
                : [...mismaMarca, ...unoPorFamilia(todos.filter((x) => x.tipo === 'licencias'))] },
            tecnologia: { titulo: 'Combínalo con', lista: unoPorFamilia(todos.filter((x) => x.tipo === 'tecnologia')) },
            servicios: { titulo: 'Deja tu equipo listo con', lista: mejores(microsoft) },
            alquiler: { titulo: 'Deja tu equipo listo con', lista: mejores(microsoft) },
            pines: { titulo: 'También te puede servir', lista: mismaMarca },
            recargas: { titulo: 'También te puede servir', lista: mismaMarca },
        };
        const regla = reglas[p.tipo];
        if (!regla) return null;
        const unicos = [...new Map(regla.lista.map((x) => [x.id, x])).values()].slice(0, 2);
        return unicos.length ? { titulo: regla.titulo, lista: unicos } : null;
    }

    function sugerir(p, { forzar = false } = {}) {
        if (!p || (!forzar && ultimoSugerido === p.id)) return false;
        ultimoSugerido = p.id;
        const partes = [];
        const valor = mejorValor(p);
        if (valor) {
            partes.push(formatear(`💡 *Mejor valor:* ${valor.variante} sale a ${fmt(Math.round(valor.mensual))}/mes, ahorras ${Math.round(valor.ahorro * 100)}% frente a pagar mes a mes.`));
        }
        if (TIPOS_CON_GARANTIA.includes(p.tipo)) partes.push(formatear(`🛡️ Incluye *garantía de ${GARANTIA_DIAS} días* desde la entrega.`));
        if (!promoMostrada && !TIPOS_COTIZABLES.includes(p.tipo)) {
            promoMostrada = true;
            partes.push(formatear('🎁 ¿Primera compra? Usa *DCTECH2026* y obtén 10% de descuento (se valida con tu WhatsApp).'));
        }
        const extra = complementos(p);
        if (extra) partes.push(`<p class="text-[12px] font-bold uppercase tracking-wider text-neutral-400">${escaparHTML(extra.titulo)}</p>${tarjetasProductos(extra.lista)}`);
        if (!partes.length) return false;
        agregar(partes.join(''));
        return true;
    }

    /* ---------- Intenciones ---------- */

    function responderFAQ(id, extra = '') {
        const f = respuestaFAQ(id);
        agregar(`${formatear(f?.respuesta ?? 'Te ayudo por WhatsApp.')}${extra}`);
    }

    function pasosCompra() {
        agregar(`
            <p class="font-bold text-white">Comprar es muy fácil:</p>
            <ol class="list-decimal pl-5 space-y-1 text-[13px]">
                <li>Toca el producto y elige tu opción.</li>
                <li>Si es tu primera compra, aplica <b>DCTECH2026</b> (10% de descuento).</li>
                <li>Acepta los términos de uso.</li>
                <li>Te abrimos WhatsApp con el pedido listo y te enviamos los datos de pago (<b>Nequi</b> o <b>Daviplata</b>).</li>
                <li>Al validar tu comprobante entregamos en máximo ${WA.ENTREGA_MAX_MIN} minutos (${escaparHTML(WA.HORARIO)}).</li>
            </ol>`);
    }

    function preguntarQueBusca() {
        agregar(`<p>¿Qué estás buscando?</p><div class="flex flex-wrap gap-2">${RECOMENDACIONES.map((r) =>
            `<button type="button" data-recomendar="${r.id}" class="inline-flex items-center gap-2 min-h-[40px] px-3 rounded-xl bg-dcDarkBg/70 ring-1 ring-white/10 hover:ring-dcRed/60 text-xs font-bold"><i class="fa-solid ${r.icono} text-dcRed"></i>${r.texto}</button>`).join('')}</div>`);
    }

    function recomendar(idCategoria) {
        const cat = RECOMENDACIONES.find((r) => r.id === idCategoria);
        const productos = catalogo().filter((p) => cat.tipos.includes(p.tipo));
        if (!productos.length) {
            agregar('<p>Aún estoy cargando el catálogo, intenta en un segundo.</p>');
            return;
        }
        // Primero los que tienen mayor descuento real
        agregar(`<p>Te recomiendo estas opciones de <b>${escaparHTML(cat.texto)}</b>:</p>${tarjetasProductos(mejores(productos, 3))}
            ${cat.id === 'reparacion' ? '<p class="text-[12px] text-neutral-400">También puedes usar el <a href="#servicios" data-ir-servicios class="text-dcRed underline">cotizador express</a>.</p>' : ''}`);
    }

    function escalar(motivo = '¡Claro! Te paso con un asesor humano:') {
        sinResolver = 0;
        agregar(`<p>${escaparHTML(motivo)}</p><p class="text-[12px] text-neutral-400">Atendemos ${escaparHTML(WA.HORARIO)}. Si tienes pedido, ten a mano su número.</p>${botonAsesor()}`);
    }

    function responderTexto(texto) {
        const t = normalizar(texto);
        if (!t) return;

        // Intenciones directas
        if (/(como compr|pasos para compr|como hago (el|un) pedido)/.test(t)) return pasosCompra();
        if (/(recomiend|que me sirve|no se que|ayudame a elegir)/.test(t)) return preguntarQueBusca();
        if (/(asesor|humano|persona|hablar con|agente|reclamo|reembolso|estafa|no me (ha )?llegado|no me llego)/.test(t)) return escalar();
        // Ofertas: las promociones del día que marcó el administrador (si hay); si no, el cupón y los mayores descuentos
        if (/(oferta|promo|rebaja|descuento|barato|economico|en promocion)/.test(t) && !/dctech|cupon/.test(t)) {
            const promos = window.DCTienda?.promociones() ?? [];
            const lista = promos.length ? promos.slice(0, 4) : mejores(catalogo(), 3);
            agregar(`<p>${promos.length ? '🔥 <b>Promociones del día</b> (solo hasta la medianoche):' : 'Estas son las opciones con mayor descuento hoy:'}</p>${tarjetasProductos(lista)}
                ${promoMostrada ? '' : '<p class="text-[12px] text-neutral-400">Si es tu primera compra, suma <b>DCTECH2026</b> (10%).</p>'}`);
            promoMostrada = true;
            return;
        }
        if (/(combo|complement|que mas|que otro|algo mas|acompan)/.test(t) && ultimoProducto) {
            if (!sugerir(ultimoProducto, { forzar: true })) escalar('Para armarte un combo a la medida, un asesor te ayuda:');
            return;
        }

        // Productos: una palabra útil debe coincidir con el INICIO de una palabra del nombre o la marca
        // ("antes" no debe encontrar "diamantes"; "con" no cuenta)
        const palabras = t.replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !PALABRAS_VACIAS.has(w));
        const palabrasProducto = new Set();
        const productos = catalogo().filter((p) => {
            const tokens = normalizar(`${p.nombre} ${p.marca}`).split(/[^a-z0-9ñ]+/);
            const hits = palabras.filter((w) => tokens.some((tk) => tk.startsWith(w)));
            hits.forEach((w) => palabrasProducto.add(w));
            return hits.length > 0;
        }).slice(0, 4);

        // FAQ por palabras clave (de bot-conocimiento.json), sobre lo que NO es nombre de producto:
        // "windows" muestra el producto, "cómo activo windows" además muestra los pasos de activación
        const limpio = ` ${t.replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ')} `;
        const resto = ` ${limpio.trim().split(' ').filter((w) => !palabrasProducto.has(w)).join(' ')} `;
        // Raíz simple para conjugaciones: "activar" también reconoce "activo" / "activé"
        const raiz = (k) => (k.length >= 6 && !k.includes(' ') ? k.slice(0, -2) : k);
        const aciertos = (f, texto) => (f.palabras_clave ?? []).filter((k) => texto.includes(` ${raiz(normalizar(k))}`)).length;
        const mejorFAQ = faq
            .map((f) => ({ f, hits: aciertos(f, resto), contexto: aciertos(f, limpio) }))
            .filter((x) => x.hits > 0)
            // Empate: gana la FAQ relacionada con el producto mencionado (activar + office → licencias)
            .sort((a, b) => b.hits - a.hits || b.contexto - a.contexto)[0]?.f;
        if (mejorFAQ?.id === 'cupon_primera_compra') promoMostrada = true;

        if (productos.length) {
            sinResolver = 0;
            agregar(`<p>Encontré esto en el catálogo:</p>${tarjetasProductos(productos)}`);
            if (mejorFAQ) agregar(formatear(mejorFAQ.respuesta));
            // Una sola coincidencia: es lo que busca → venta sugerida
            if (productos.length === 1) sugerir(productos[0]);
            return;
        }
        if (mejorFAQ) {
            sinResolver = 0;
            return agregar(formatear(mejorFAQ.respuesta));
        }
        sinResolver += 1;
        if (sinResolver >= 2) return escalar('Prefiero que lo resuelva una persona del equipo, así no pierdes tiempo:');
        agregar(`<p>No tengo una respuesta exacta para eso. Prueba con el nombre de un producto (por ejemplo <b>Netflix</b> u <b>Office</b>) o pregúntame por pagos, entrega o garantía.</p>${botonAsesor()}`);
    }

    const ATAJOS = [
        { texto: '🔥 Ofertas de hoy', accion: () => responderTexto('ofertas') },
        { texto: '¿Cómo comprar?', accion: pasosCompra },
        { texto: 'Métodos de pago', accion: () => responderFAQ('metodos_pago') },
        { texto: 'Tiempo de entrega', accion: () => responderFAQ('tiempo_entrega') },
        { texto: 'Cupón', accion: () => { promoMostrada = true; responderFAQ('cupon_primera_compra'); } },
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
            b.addEventListener('click', () => { agregar(texto, 'usuario'); responder(accion, 300); });
            return b;
        }));
    }

    /* ---------- Apertura y contexto ---------- */

    async function abrir() {
        burbuja.hidden = true;
        panel.hidden = false;
        btnAbrir.setAttribute('aria-expanded', 'true');
        btnAbrir.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        if (!reducirMovimiento) panel.animate([{ opacity: 0, transform: 'translateY(16px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
        try { sessionStorage.setItem('dc_copiloto_visto', '1'); } catch { /* sin almacenamiento */ }

        if (!iniciado) {
            iniciado = true;
            pintarAtajos();
            agregar(`<p>¡Hola! Soy el <b>Copiloto DC</b> 👋 Te ayudo a elegir, resolver dudas y hacer tu pedido.</p>
                ${ultimoProducto ? `<p>Veo que estás mirando <b>${escaparHTML(ultimoProducto.nombre)}</b>. Aquí tienes algunas ideas:</p>` : ''}`);
            await cargarFAQ();
            if (!ultimoProducto || !sugerir(ultimoProducto)) preguntarQueBusca();
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
        responder(async () => { await cargarFAQ(); responderTexto(texto); }, Math.min(300 + texto.length * 12, 800));
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
            responder(() => recomendar(rec.dataset.recomendar), 350);
            return;
        }
        if (e.target.closest('[data-ir-servicios]') && window.matchMedia('(max-width: 640px)').matches) cerrar();
    });

    // Acompaña la navegación: recuerda el último producto visto y, si el copiloto está abierto, sugiere complementos
    document.addEventListener('dc:producto-visto', (e) => {
        ultimoProducto = e.detail;
        if (!panel.hidden && iniciado) responder(() => sugerir(ultimoProducto), 500);
    });

    // Precarga en reposo: al abrir, las FAQ ya están listas
    (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 2500)))(() => cargarFAQ());

    // Invitación suave una sola vez por sesión
    let yaVisto = false;
    try { yaVisto = sessionStorage.getItem('dc_copiloto_visto') === '1'; } catch { /* sin almacenamiento */ }
    if (!yaVisto) {
        setTimeout(() => {
            if (!panel.hidden) return;
            burbuja.hidden = false;
            if (!reducirMovimiento) burbuja.animate([{ opacity: 0, transform: 'translateX(10px)' }, { opacity: 1, transform: 'none' }], { duration: 300 });
            setTimeout(() => { burbuja.hidden = true; }, 9000);
        }, 15000);
    }
})();
