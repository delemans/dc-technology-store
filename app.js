document.addEventListener('DOMContentLoaded', () => {
    const productGrid = document.getElementById('product-grid');
    const productCount = document.getElementById('product-count');
    const categoryTitle = document.getElementById('category-title');
    const filterBtns = document.querySelectorAll('.filter-btn');
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

    // Formateador Seguro de Moneda (Evita NaN)
    const formatearPrecio = (valor) => {
        let num = parseFloat(valor);
        if (isNaN(num) || num === null || num === undefined) num = 0;
        return new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP',
            minimumFractionDigits: 0
        }).format(num);
    };

    // Auto-categorizador robusto basado en ID o Nombre
    const clasificarCategoria = (prod) => {
        if (prod.tipo && prod.tipo !== "digital") return prod.tipo;

        const id = (prod.id || '').toLowerCase();
        const nombre = (prod.nombre || '').toLowerCase();

        if (id.includes('reloj') || id.includes('smartwatch') || id.includes('diadema') || id.includes('auricular') || id.includes('powerbank')) {
            return 'tecnologia';
        }
        if (id.includes('pin-') || id.startsWith('pin')) {
            return 'pines';
        }
        if (id.includes('recarga') || id.includes('free-fire') || id.includes('directv-prepago')) {
            return 'recargas';
        }
        if (id.includes('office') || id.includes('windows') || id.includes('canva') || id.includes('capcut') || id.includes('duolingo') || id.includes('mcafee') || id.includes('gemini')) {
            return 'licencias';
        }
        return 'streaming';
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

            let badgeDescuento = '';
            if (tieneDescuento) {
                const pct = Math.round(((precioAntNum - precioNum) / precioAntNum) * 100);
                badgeDescuento = `<div class="absolute top-3 left-3 bg-dcRed text-white text-[10px] font-black px-2.5 py-1 rounded-full z-10 tracking-wider">-${pct}% OFF</div>`;
            }

            const card = document.createElement('div');
            card.className = 'card-3d rounded-3xl p-5 flex flex-col justify-between cursor-pointer relative group';
            card.onclick = () => abrirModal(prod);

            card.innerHTML = `
                ${badgeDescuento}
                <div class="relative overflow-hidden mb-4 h-44 flex items-center justify-center bg-white rounded-2xl p-3 border border-gray-100">
                    <img src="${prod.imagen || 'https://via.placeholder.com/300'}" alt="${prod.nombre}" class="max-h-full object-contain group-hover:scale-105 transition-transform duration-300">
                </div>
                <div class="flex-grow flex flex-col text-left">
                    <span class="text-[10px] uppercase text-dcRed font-black tracking-widest mb-1">${prod.marca || "DC Technology"}</span>
                    <h3 class="text-xs md:text-sm font-bold text-gray-900 dark:text-white mb-2 line-clamp-2 leading-snug">${prod.nombre}</h3>
                    <div class="mt-auto mb-4">
                        ${tieneDescuento ? `<span class="text-gray-400 line-through text-xs mr-2">${formatearPrecio(precioAntNum)}</span>` : ''}
                        <strong class="text-lg md:text-xl font-black text-dcRed block">${prod.variantes && prod.variantes.length > 1 ? '<span class="text-xs text-gray-400 font-semibold">Desde </span>' : ''}${formatearPrecio(precioNum)}</strong>
                    </div>
                </div>
                <button class="w-full bg-gray-900 dark:bg-gray-800 hover:bg-dcRed dark:hover:bg-dcRed text-white font-bold py-3 rounded-2xl text-xs transition-colors shadow-md">
                    Ver Opciones / Comprar
                </button>
            `;
            productGrid.appendChild(card);
        });
    };

    // Abrir Modal de Producto
    const abrirModal = (prod) => {
        productoSeleccionado = prod;
        varianteSeleccionada = prod.variantes[0];

        document.getElementById('modal-img').src = prod.imagen;
        document.getElementById('modal-brand').textContent = prod.marca || "DC Technology";
        document.getElementById('modal-title').textContent = prod.nombre;

        renderizarVariantesModal();
        actualizarPreciosModal();

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

    // Formateador inteligente de etiquetas para las variantes
    const obtenerNombreVarianteLimpio = (v, index, total) => {
        let nombre = v.nombre;
        if (!nombre || nombre === "Única") {
            const cat = clasificarCategoria(productoSeleccionado);
            if (cat === "recargas" || cat === "pines") {
                return `Opción de Saldo / Monto (${formatearPrecio(v.precio)})`;
            }
            if (total > 1) {
                return `Plan / Opción ${index + 1} (${formatearPrecio(v.precio)})`;
            }
            return "Opción Estándar";
        }
        return nombre;
    };

    // Renderizar Variantes en el Modal
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

        document.getElementById('modal-price').textContent = formatearPrecio(pNum);

        const oldPriceEl = document.getElementById('modal-old-price');
        const savingsEl = document.getElementById('modal-savings');
        const badgeEl = document.getElementById('modal-discount-badge');

        if (pAntNum > pNum) {
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

    // Redirección a WhatsApp con Pedido Estructurado
    document.getElementById('btn-whatsapp').onclick = () => {
        const totalVars = productoSeleccionado.variantes.length;
        const idx = productoSeleccionado.variantes.indexOf(varianteSeleccionada);
        const varianteNombre = obtenerNombreVarianteLimpio(varianteSeleccionada, idx, totalVars);

        const mensaje = `Hola DC Technology! 👋🏼 Quiero realizar la compra de:\n\n📌 *Producto:* ${productoSeleccionado.nombre}\n⚙️ *Opción/Plan:* ${varianteNombre}\n💰 *Valor:* ${formatearPrecio(varianteSeleccionada.precio)}\n\n¿Me indican los datos para pagar por Nequi / Daviplata / Bancolombia?`;
        
        window.open(`https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`, '_blank');
    };

    // Cargar Base de Datos JSON
    fetch('productos.json')
        .then(res => res.json())
        .then(data => {
            todosLosProductos = data.map(p => ({
                ...p,
                tipo: clasificarCategoria(p)
            }));
            renderizarProductos(todosLosProductos);
        })
        .catch(err => console.error("Error al cargar productos.json", err));

    // Filtros por Categoría
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => {
                b.classList.remove('bg-dcRed', 'text-white', 'font-black', 'shadow-md');
                b.classList.add('text-gray-600', 'dark:text-gray-400');
            });

            const target = e.currentTarget;
            target.classList.add('bg-dcRed', 'text-white', 'font-black', 'shadow-md');
            target.classList.remove('text-gray-600', 'dark:text-gray-400');

            const filtro = target.getAttribute('data-filter');
            categoryTitle.textContent = target.textContent.replace(/🚀|💻|🎬|🔑|🎮|💸/g, '').trim();

            if (filtro === 'todos') {
                renderizarProductos(todosLosProductos);
            } else {
                const filtrados = todosLosProductos.filter(p => p.tipo === filtro);
                renderizarProductos(filtrados);
            }
        });
    });

    // Buscador en Tiempo Real
    searchInput.addEventListener('keyup', (e) => {
        const query = e.target.value.toLowerCase();
        const filtrados = todosLosProductos.filter(p => p.nombre.toLowerCase().includes(query) || (p.marca && p.marca.toLowerCase().includes(query)));
        categoryTitle.textContent = "Resultados de búsqueda";
        renderizarProductos(filtrados);
    });

    // Toggle Modo Claro / Oscuro
    themeToggle.onclick = () => {
        const isDark = document.documentElement.classList.toggle('dark');
        themeIcon.textContent = isDark ? '🌙' : '☀️';
    };
});