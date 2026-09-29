document.addEventListener('DOMContentLoaded', () => {
    const productGrid = document.getElementById('product-grid');
    const productCount = document.getElementById('product-count');
    const categoryTitle = document.getElementById('category-title');
    const searchInput = document.getElementById('searchInput');
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    
    // Modal Elements
    const modal = document.getElementById('product-modal');
    const modalBox = document.getElementById('modal-content-box');
    const closeModal = document.getElementById('close-modal');

    const numeroWhatsApp = "573223284622";
    let todosLosProductos = [];
    let productoSeleccionado = null;
    let varianteSeleccionada = null;

    // Formateador Seguro de Moneda
    const formatearPrecio = (valor) => {
        let num = parseFloat(valor);
        if (isNaN(num) || num === null || num === undefined) num = 0;
        if (num === 0) return "A Cotizar";
        
        return new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP',
            minimumFractionDigits: 0
        }).format(num);
    };

    // Auto-categorizador robusto
    const clasificarCategoria = (prod) => {
        if (prod.tipo && prod.tipo !== "digital") return prod.tipo;

        const id = (prod.id || '').toLowerCase();
        if (id.includes('reloj') || id.includes('smartwatch') || id.includes('diadema') || id.includes('auricular') || id.includes('powerbank')) return 'tecnologia';
        if (id.includes('pin-') || id.startsWith('pin')) return 'pines';
        if (id.includes('recarga') || id.includes('free-fire') || id.includes('directv-prepago')) return 'recargas';
        if (id.includes('office') || id.includes('windows') || id.includes('canva') || id.includes('capcut') || id.includes('duolingo') || id.includes('mcafee') || id.includes('gemini')) return 'licencias';
        return 'streaming';
    };

    // MOTOR INTELIGENTE DE INSTRUCCIONES DIGITALES (DISEÑO PREMIUM)
    const generarInstruccionesDigitales = (producto) => {
        if (producto.tipo === 'tecnologia' || producto.tipo === 'servicios' || producto.tipo === 'alquiler') return '';

        // Soporte para descripciones personalizadas futuras vía n8n
        if (producto.descripcion && producto.descripcion.trim().length > 20) {
            return `<div class="mt-4 border-t border-gray-100 dark:border-white/10 pt-4 text-xs font-medium leading-relaxed dark:text-gray-300">${producto.descripcion}</div>`;
        }

        let reglasHTML = '';
        if (producto.tipo === 'streaming' || producto.tipo === 'licencias') {
            reglasHTML = `
                <li class="flex items-start gap-2.5"><svg class="w-4 h-4 text-dcRed mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> <span><strong>Prohibido</strong> usar en más dispositivos de los permitidos.</span></li>
                <li class="flex items-start gap-2.5"><svg class="w-4 h-4 text-dcRed mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> <span><strong>Prohibido</strong> modificar correo, contraseña o facturación.</span></li>
                <li class="flex items-start gap-2.5"><svg class="w-4 h-4 text-dcRed mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> <span><strong>Prohibido</strong> compartir, revender o transferir el acceso.</span></li>
                <li class="flex items-start gap-2.5"><svg class="w-4 h-4 text-dcRed mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> <span>Uso exclusivo del perfil asignado, sin excepciones.</span></li>
            `;
        } else {
            reglasHTML = `
                <li class="flex items-start gap-2.5"><svg class="w-4 h-4 text-dcRed mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> <span>El código/saldo se enviará al número que nos indiques.</span></li>
                <li class="flex items-start gap-2.5"><svg class="w-4 h-4 text-dcRed mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> <span>Verifica bien tus datos; las recargas no son reversibles.</span></li>
                <li class="flex items-start gap-2.5"><svg class="w-4 h-4 text-dcRed mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg> <span>Una vez entregado el PIN virtual, no hay devoluciones.</span></li>
            `;
        }

        return `
            <div class="space-y-4 mt-5 pt-5 border-t border-gray-100 dark:border-white/5">
                <!-- Advertencia de Garantía Premium -->
                <div class="relative overflow-hidden rounded-2xl border border-dcRed/30 bg-gradient-to-b from-dcRed/10 to-transparent p-5 shadow-sm">
                    <div class="flex items-center gap-3 mb-4">
                        <div class="flex-shrink-0 w-8 h-8 rounded-full bg-dcRed/20 flex items-center justify-center text-dcRed shadow-inner">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                        </div>
                        <h4 class="text-[13px] font-black text-dcRed uppercase tracking-wider">Condiciones y Garantía</h4>
                    </div>
                    <p class="text-[11.5px] text-gray-500 dark:text-gray-400 mb-3.5 font-medium">La garantía aplica únicamente si se respetan estas reglas:</p>
                    <ul class="text-[12px] text-gray-800 dark:text-gray-300 space-y-2.5 mb-5 font-medium">
                        ${reglasHTML}
                    </ul>
                    <div class="bg-gradient-to-r from-dcRed to-dcRedDark text-white text-[10px] font-black uppercase tracking-[0.15em] py-3 px-4 rounded-xl text-center shadow-[0_4px_15px_rgba(255,0,51,0.3)]">
                        ⚠️ Incumplir anula la garantía sin reembolso
                    </div>
                </div>

                <!-- Proceso de Entrega Premium -->
                <div class="relative overflow-hidden rounded-2xl border border-green-500/30 bg-gradient-to-b from-green-500/10 to-transparent p-5 shadow-sm">
                    <div class="flex items-center gap-3 mb-5">
                        <div class="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-500 shadow-inner">
                            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                        </div>
                        <h4 class="text-[13px] font-black text-green-600 dark:text-green-500 uppercase tracking-wider">Proceso de Entrega (1 a 10 min)</h4>
                    </div>
                    <div class="space-y-4">
                        <div class="flex gap-3 items-start">
                            <span class="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-[11px] font-black shrink-0 shadow-md">1</span>
                            <div><strong class="text-gray-900 dark:text-white block text-[12px] mb-0.5">Pagas tu plan</strong><span class="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Eliges tu opción y completas el pago en línea.</span></div>
                        </div>
                        <div class="flex gap-3 items-start">
                            <span class="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-[11px] font-black shrink-0 shadow-md">2</span>
                            <div><strong class="text-gray-900 dark:text-white block text-[12px] mb-0.5">Confirmas tu pago</strong><span class="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Nos envías el soporte a nuestro WhatsApp.</span></div>
                        </div>
                        <div class="flex gap-3 items-start">
                            <span class="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center text-[11px] font-black shrink-0 shadow-md">3</span>
                            <div><strong class="text-gray-900 dark:text-white block text-[12px] mb-0.5">Recibes y disfrutas</strong><span class="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Te enviamos el producto al instante.</span></div>
                        </div>
                    </div>
                </div>

                <!-- Soporte -->
                <div class="text-center bg-gray-100 dark:bg-white/5 py-3 rounded-xl border border-gray-200 dark:border-white/10 shadow-inner">
                    <p class="text-[10px] text-gray-500 dark:text-gray-400 font-black uppercase tracking-[0.15em] flex items-center justify-center gap-2">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        Soporte: Lunes a Domingo 10:00 AM - 11:30 PM
                    </p>
                </div>
            </div>
        `;
    };

    // Renderizado en Grilla
    const renderizarProductos = (productos) => {
        productCount.textContent = `${productos.length} productos`;
        productGrid.innerHTML = ''; 

        if (productos.length === 0) {
            productGrid.innerHTML = `
                <div class="col-span-full text-center py-16 text-gray-400">
                    <span class="text-4xl block mb-2">🔎</span>
                    <p class="font-bold">No hay productos en esta categoría.</p>
                </div>`;
            return;
        }

        productos.forEach(prod => {
            const varBase = (prod.variantes && prod.variantes.length > 0) 
                ? prod.variantes[0] 
                : { precio: 0, precio_anterior: null };

            const precioNum = parseFloat(varBase.precio) || 0;
            const precioAntNum = parseFloat(varBase.precio_anterior) || 0;
            const tieneDescuento = precioAntNum > precioNum;
            const esCotizacion = precioNum === 0;

            let descCorta = "Garantía oficial DC Technology";
            if (prod.tipo === 'streaming') descCorta = "Activación inmediata • Resolución UHD/4K";
            else if (prod.tipo === 'tecnologia') descCorta = "Envíos a todo el país • Calidad Premium";
            else if (prod.tipo === 'pines' || prod.tipo === 'recargas') descCorta = "Recarga automática 24/7 segura";
            else if (prod.tipo === 'licencias') descCorta = "Software 100% original • Soporte vitalicio";
            else if (prod.tipo === 'servicios' || prod.tipo === 'alquiler') descCorta = "Ejecución profesional • Asesoría personalizada";

            let badgeDescuento = '';
            if (tieneDescuento && !esCotizacion) {
                const pct = Math.round(((precioAntNum - precioNum) / precioAntNum) * 100);
                badgeDescuento = `<div class="absolute top-3 left-3 bg-dcRed text-white text-[10px] font-black px-2.5 py-1 rounded-md z-10 tracking-wider shadow-sm">-${pct}% OFF</div>`;
            }

            const card = document.createElement('div');
            card.className = 'card-3d rounded-3xl p-5 flex flex-col justify-between cursor-pointer relative group';
            
            card.onclick = () => {
                if (esCotizacion) {
                    const mensaje = `Hola DC Technology! 👋🏼 Quiero solicitar una cotización para el servicio de:\n\n📌 *${prod.nombre}*`;
                    window.open(`https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`, '_blank');
                } else {
                    abrirModal(prod);
                }
            };

            const textoPrecio = esCotizacion 
                ? 'A Cotizar' 
                : `${prod.variantes && prod.variantes.length > 1 ? '<span class="text-xs text-gray-500 font-semibold tracking-normal">Desde </span>' : ''}${formatearPrecio(precioNum)}`;
            
            const textoBoton = esCotizacion 
                ? 'Recibir cotización 📲' 
                : 'Ver Opciones / Comprar';
                
            const clasesBoton = esCotizacion
                ? 'bg-green-600 hover:bg-green-500' 
                : 'bg-gray-900 dark:bg-[#232838] hover:bg-dcRed dark:hover:bg-dcRed border border-transparent dark:border-gray-700'; 

            card.innerHTML = `
                ${badgeDescuento}
                <div class="relative overflow-hidden mb-5 h-44 flex items-center justify-center p-3 bg-transparent">
                    <img src="${prod.imagen || 'https://via.placeholder.com/300'}" alt="${prod.nombre}" class="img-360 max-h-full object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.05)] ${prod.tipo === 'tecnologia' ? 'rounded-2xl shadow-lg dark:shadow-white/5' : ''}">
                </div>
                <div class="flex-grow flex flex-col text-left">
                    <span class="text-[10px] uppercase text-dcRed font-black tracking-[0.15em] mb-1.5">${prod.marca || "DC Technology"}</span>
                    <h3 class="text-sm font-bold text-gray-900 dark:text-white mb-1.5 line-clamp-2 leading-snug font-tech">${prod.nombre}</h3>
                    <p class="text-[11px] text-gray-500 dark:text-gray-400 mb-3">${descCorta}</p>
                    <div class="mt-auto mb-4">
                        ${tieneDescuento && !esCotizacion ? `<span class="text-gray-400 line-through text-xs mr-2 font-medium">${formatearPrecio(precioAntNum)}</span>` : ''}
                        <strong class="precio-magico text-xl font-black text-dcRed block leading-none tracking-tight">${textoPrecio}</strong>
                    </div>
                </div>
                <button class="w-full ${clasesBoton} text-white font-bold py-3.5 rounded-xl text-xs transition-all shadow-sm group-hover:shadow-md">
                    ${textoBoton}
                </button>
            `;
            productGrid.appendChild(card);
        });
    };

    // Abrir Modal
    const abrirModal = (prod) => {
        productoSeleccionado = prod;
        varianteSeleccionada = prod.variantes[0];

        const imgEl = document.getElementById('modal-img');
        imgEl.src = prod.imagen;
        imgEl.className = "w-full h-56 md:h-72 object-contain drop-shadow-2xl transition-transform duration-700 hover:[transform:rotateY(360deg)_scale(1.1)] cursor-pointer";

        document.getElementById('modal-brand').textContent = prod.marca || "DC Technology";
        document.getElementById('modal-title').textContent = prod.nombre;

        renderizarVariantesModal();
        actualizarPreciosModal();

        let extraInfo = document.getElementById('modal-extra-info');
        if (!extraInfo) {
            extraInfo = document.createElement('div');
            extraInfo.id = 'modal-extra-info';
            const btnPagarContainer = document.getElementById('btn-pagar').parentNode;
            btnPagarContainer.parentNode.insertBefore(extraInfo, btnPagarContainer);
        }
        
        const htmlInstrucciones = generarInstruccionesDigitales(productoSeleccionado);
        extraInfo.innerHTML = htmlInstrucciones;
        if (htmlInstrucciones === '') {
            extraInfo.classList.add('hidden');
        } else {
            extraInfo.classList.remove('hidden');
        }

        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modalBox.classList.remove('scale-95');
            modalBox.classList.add('scale-100');
        }, 10);
    };

    const cerrarModal = () => {
        modal.classList.add('opacity-0');
        modalBox.classList.remove('scale-100');
        modalBox.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    };

    closeModal.onclick = cerrarModal;
    modal.onclick = (e) => { if (e.target === modal) cerrarModal(); };

    const obtenerNombreVarianteLimpio = (v, index, total) => {
        let nombre = v.nombre;
        if (!nombre || nombre === "Única") {
            const cat = clasificarCategoria(productoSeleccionado);
            if (cat === "recargas" || cat === "pines") {
                return `Opción / Monto (${formatearPrecio(v.precio)})`;
            }
            if (total > 1) {
                return `Opción ${index + 1} (${formatearPrecio(v.precio)})`;
            }
            return "Opción Estándar";
        }
        return nombre;
    };

    const renderizarVariantesModal = () => {
        const modalVariants = document.getElementById('modal-variants');
        modalVariants.innerHTML = '';

        const totalVars = productoSeleccionado.variantes.length;

        productoSeleccionado.variantes.forEach((v, idx) => {
            const labelNombre = obtenerNombreVarianteLimpio(v, idx, totalVars);
            const isActive = v === varianteSeleccionada;

            const btn = document.createElement('button');
            btn.className = `w-full text-left p-3 rounded-xl border-2 flex justify-between items-center transition-all ${isActive ? 'border-dcRed bg-red-500/10 text-dcRed font-black' : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'}`;

            btn.innerHTML = `
                <div class="flex items-center gap-2.5">
                    <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center ${isActive ? 'border-dcRed bg-dcRed' : 'border-gray-400'}">
                        ${isActive ? '<div class="w-1.5 h-1.5 bg-white rounded-full"></div>' : ''}
                    </div>
                    <span class="text-xs font-bold">${labelNombre}</span>
                </div>
                <span class="text-xs font-black">${formatearPrecio(v.precio)}</span>
            `;

            btn.onclick = () => {
                varianteSeleccionada = v;
                renderizarVariantesModal();
                actualizarPreciosModal();
            };
            modalVariants.appendChild(btn);
        });
    };

    const actualizarPreciosModal = () => {
        const pNum = parseFloat(varianteSeleccionada.precio) || 0;
        const pAntNum = parseFloat(varianteSeleccionada.precio_anterior) || 0;

        const mostrarDesde = (productoSeleccionado.tipo === 'alquiler' || productoSeleccionado.tipo === 'servicios') && pNum > 0;
        const htmlPrecio = mostrarDesde 
            ? `<span class="text-xl md:text-2xl text-gray-400 font-semibold mr-1 tracking-normal">Desde</span> ${formatearPrecio(pNum)}` 
            : formatearPrecio(pNum);

        document.getElementById('modal-price').innerHTML = htmlPrecio;

        const oldPriceEl = document.getElementById('modal-old-price');
        const savingsEl = document.getElementById('modal-savings');
        const badgeEl = document.getElementById('modal-discount-badge');
        const btnPagar = document.getElementById('btn-pagar');

        if (pNum === 0) {
            btnPagar.classList.add('hidden');
        } else {
            btnPagar.classList.remove('hidden');
        }

        if (pAntNum > pNum && pNum > 0) {
            const ahorro = pAntNum - pNum;
            const pct = Math.round((ahorro / pAntNum) * 100);

            oldPriceEl.textContent = formatearPrecio(pAntNum);
            savingsEl.textContent = `¡Ahorras ${formatearPrecio(ahorro)}!`;
            badgeEl.textContent = `-${pct}% OFF`;

            oldPriceEl.classList.remove('hidden');
            savingsEl.classList.remove('hidden');
            badgeEl.classList.remove('hidden');
        } else {
            oldPriceEl.classList.add('hidden');
            savingsEl.classList.add('hidden');
            badgeEl.classList.add('hidden');
        }
    };

    document.getElementById('btn-whatsapp').onclick = () => {
        const totalVars = productoSeleccionado.variantes.length;
        const idx = productoSeleccionado.variantes.indexOf(varianteSeleccionada);
        const varianteNombre = obtenerNombreVarianteLimpio(varianteSeleccionada, idx, totalVars);

        let mensaje = '';
        if (varianteSeleccionada.precio === 0) {
            mensaje = `Hola DC Technology! 👋🏼 Quiero solicitar una cotización para el servicio de:\n\n📌 *${productoSeleccionado.nombre}*\n⚙️ *Opción:* ${varianteNombre}`;
        } else {
            mensaje = `Hola DC Technology! 👋🏼 Quiero realizar la compra de:\n\n📌 *Producto:* ${productoSeleccionado.nombre}\n⚙️ *Opción/Plan:* ${varianteNombre}\n💰 *Valor:* ${formatearPrecio(varianteSeleccionada.precio)}\n\n¿Me indican los datos para pagar por Nequi / Daviplata / Bancolombia?`;
        }
        
        window.open(`https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`, '_blank');
    };

    if (document.getElementById('btn-pagar')) {
        document.getElementById('btn-pagar').onclick = () => {
            if (typeof iniciarCheckout === 'function') {
                iniciarCheckout(productoSeleccionado, varianteSeleccionada);
            } else {
                alert("Módulo de pago Nequi/Wompi en configuración.");
            }
        };
    }

    fetch('productos.json')
        .then(res => res.json())
        .then(data => {
            todosLosProductos = data.map(p => {
                const prod = { ...p, tipo: clasificarCategoria(p) };
                prod.subcat = obtenerSubcategoria(prod);
                return prod;
            });
            renderizarProductos(todosLosProductos);
            construirAcordeon();
        })
        .catch(err => console.error("Error al cargar productos.json", err));

    const CATEGORIAS = [
        { id: 'tecnologia', icon: '💻', label: 'Tecnología Física' },
        { id: 'streaming',  icon: '🎬', label: 'Cuentas Streaming' },
        { id: 'licencias',  icon: '🔑', label: 'Licencias Software' },
        { id: 'pines',      icon: '🎮', label: 'Pines Virtuales' },
        { id: 'recargas',   icon: '💸', label: 'Recargas & Apuestas' },
        { id: 'servicios',  icon: '🛠', label: 'Servicios & Soporte' },
        { id: 'alquiler',   icon: '💻', label: 'Alquiler de Equipos' }
    ];
    const acordeon = document.getElementById('category-accordion');
    let filtroActual = { cat: 'todos', sub: null };

    const obtenerSubcategoria = (p) => {
        const id = (p.id || '').toLowerCase();
        if (p.tipo === 'tecnologia') {
            if (id.includes('reloj')) return 'Smartwatches';
            if (id.includes('diadema')) return 'Diademas';
            if (id.startsWith('powerbank')) return 'Powerbanks';
            return 'Auriculares';
        }
        if (p.tipo === 'recargas') {
            if (['rushbet', 'bwin', 'betsson', 'luckia', 'sportium', 'ya-juego'].some(k => id.includes(k))) return 'Apuestas';
            if (id.startsWith('recargas-')) return 'Recargas móviles';
            return 'TV & Juegos';
        }
        return p.marca || 'Otros';
    };

    const chevron = '<svg class="acc-chev" viewBox="0 0 20 20" fill="currentColor"><path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z"/></svg>';

    const construirAcordeon = () => {
        let html = `<button class="acc-row" data-cat="todos">🚀 <span>Todos los Productos</span><span class="acc-count">${todosLosProductos.length}</span></button>`;
        CATEGORIAS.forEach(c => {
            const prods = todosLosProductos.filter(p => p.tipo === c.id);
            if (!prods.length) return;
            const conteo = {};
            prods.forEach(p => { conteo[p.subcat] = (conteo[p.subcat] || 0) + 1; });
            const subs = Object.keys(conteo).sort((x, y) => x.localeCompare(y, 'es'));
            const expandible = subs.length > 1;

            html += `<div>
                <button class="acc-row" data-cat="${c.id}" ${expandible ? 'data-expandable="1" aria-expanded="false" aria-controls="panel-' + c.id + '"' : ''}>
                    ${c.icon} <span>${c.label}</span><span class="acc-count">${prods.length}</span>${expandible ? chevron : ''}
                </button>
                ${expandible ? `<div class="acc-panel" id="panel-${c.id}" inert><div>
                    <div class="flex flex-wrap gap-1.5 px-2 pt-2 pb-3">
                        ${subs.map(s => `<button class="acc-chip" data-cat="${c.id}" data-sub="${s}">${s}<span>${conteo[s]}</span></button>`).join('')}
                    </div></div></div>` : ''}
            </div>`;
        });
        acordeon.innerHTML = html;
        pintarActivos();
    };

    const pintarActivos = () => {
        acordeon.querySelectorAll('.acc-row').forEach(r => {
            const esCat = r.dataset.cat === filtroActual.cat;
            r.dataset.active = String(esCat && !filtroActual.sub);
            r.dataset.parent = String(esCat && !!filtroActual.sub);
        });
        acordeon.querySelectorAll('.acc-chip').forEach(c => {
            c.dataset.active = String(c.dataset.cat === filtroActual.cat && c.dataset.sub === filtroActual.sub);
        });
    };

    const alternarPanel = (cat, abrir) => {
        acordeon.querySelectorAll('.acc-row[data-expandable]').forEach(row => {
            const panel = document.getElementById('panel-' + row.dataset.cat);
            const open = row.dataset.cat === cat ? abrir : false;
            row.setAttribute('aria-expanded', String(open));
            panel.classList.toggle('open', open);
            panel.inert = !open;
        });
    };

    const aplicarFiltro = (cat, sub = null) => {
        filtroActual = { cat, sub };
        let lista = todosLosProductos;
        if (cat !== 'todos') lista = lista.filter(p => p.tipo === cat);
        if (sub) lista = lista.filter(p => p.subcat === sub);
        categoryTitle.textContent = sub || (cat === 'todos' ? 'Catálogo Completo' : CATEGORIAS.find(c => c.id === cat).label);
        searchInput.value = '';
        renderizarProductos(lista);
        pintarActivos();
    };

    acordeon.addEventListener('click', (e) => {
        const chip = e.target.closest('.acc-chip');
        if (chip) return aplicarFiltro(chip.dataset.cat, chip.dataset.sub);
        const row = e.target.closest('.acc-row');
        if (!row) return;
        const cat = row.dataset.cat;
        if (row.dataset.expandable) {
            const abrir = row.getAttribute('aria-expanded') !== 'true';
            alternarPanel(cat, abrir);
            if (!abrir) return;
        } else {
            alternarPanel(null, false);
        }
        aplicarFiltro(cat);
    });

    searchInput.addEventListener('keyup', (e) => {
        const query = e.target.value.toLowerCase();
        const filtrados = todosLosProductos.filter(p => p.nombre.toLowerCase().includes(query) || (p.marca && p.marca.toLowerCase().includes(query)));
        categoryTitle.textContent = "Resultados de búsqueda";
        filtroActual = { cat: null, sub: null };
        pintarActivos();
        renderizarProductos(filtrados);
    });

    themeToggle.onclick = () => {
        const isDark = document.documentElement.classList.toggle('dark');
        themeIcon.textContent = isDark ? '🌙' : '☀️';
    };
});