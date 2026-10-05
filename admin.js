// Configuración de Supabase
const supabaseUrl = 'https://vyqcizwfmjlflncdwzve.supabase.co';
const supabaseKey = 'sb_publishable_GvQiv6M7iSrlwsA90lXsOQ_5OfSYBwy';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);

// Número de ALL NECESSARY COLOMBIA (proveedor)
const WHATSAPP_PROVEEDOR = '573223284622';
// Cuántos pedidos recientes se cargan para pestañas, KPIs y exportación
const LIMITE_PEDIDOS = 300;
// Días de soporte que se muestran en la tarjeta (política comercial, solo visual)
const GARANTIA_DIAS = 30;

// Apariencia de cada estado: badge con LED pulsante
const ESTADOS = {
    PENDIENTE_PAGO:      { texto: 'Pendiente de pago',   clases: 'bg-sky-500/10 text-sky-300 ring-sky-500/30', punto: 'bg-sky-400', pulso: true },
    ESPERANDO_PROVEEDOR: { texto: 'Esperando proveedor', clases: 'bg-amber-500/10 text-amber-300 ring-amber-500/30', punto: 'bg-amber-400', pulso: true },
    PEDIDO_REALIZADO:    { texto: 'Pedido al proveedor', clases: 'bg-violet-500/10 text-violet-300 ring-violet-500/30', punto: 'bg-violet-400', pulso: true },
    RECIBIDA:            { texto: 'Recibida del proveedor', clases: 'bg-violet-500/10 text-violet-300 ring-violet-500/30', punto: 'bg-violet-400', pulso: true },
    ENTREGADO:           { texto: 'Entregado',           clases: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30', punto: 'bg-emerald-400', pulso: false },
    ENTREGADO_INMEDIATO: { texto: 'Entregado inmediato', clases: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30', punto: 'bg-emerald-400', pulso: false },
    FALLIDA:             { texto: 'Fallida',             clases: 'bg-red-500/10 text-red-300 ring-red-500/30', punto: 'bg-red-400', pulso: false },
    CANCELADA:           { texto: 'Cancelada',           clases: 'bg-white/5 text-neutral-400 ring-white/10', punto: 'bg-neutral-500', pulso: false },
};
// Enum public.estado_compra: PENDIENTE_PAGO → ESPERANDO_PROVEEDOR → PEDIDO_REALIZADO → RECIBIDA → ENTREGADO
// (o ENTREGADO_INMEDIATO si había cuenta asignada al validar el pago); FALLIDA y CANCELADA cierran sin entrega.
const ESTADO_PENDIENTE = 'ESPERANDO_PROVEEDOR';
const ESTADO_PENDIENTE_PAGO = 'PENDIENTE_PAGO';
// "Pendientes" = todo lo que aún requiere una acción del admin
const ESTADOS_ACTIVOS = [ESTADO_PENDIENTE_PAGO, ESTADO_PENDIENTE, 'PEDIDO_REALIZADO', 'RECIBIDA'];
// En curso con el proveedor (KPI "Procesando")
const ESTADOS_EN_PROCESO = [ESTADO_PENDIENTE, 'PEDIDO_REALIZADO', 'RECIBIDA'];
// Listos para entregar al cliente (botón "Marcar como entregado")
const ESTADOS_POR_ENTREGAR = ['PEDIDO_REALIZADO', 'RECIBIDA'];
// Entregados al cliente: cuentan como venta completada, garantía y posventa
const ESTADOS_ENTREGADOS = ['ENTREGADO', 'ENTREGADO_INMEDIATO'];

// Métodos de pago que acepta el enum public.metodo_pago (por ahora solo estos dos)
// Métodos posibles al registrar un pago: los del catálogo (plantillas-whatsapp.js · wo-027)
// Ventanas del seguimiento posventa
const HORAS_SATISFACCION = 24;
const DIAS_MAX_SATISFACCION = 7;   // pasado este plazo ya no tiene sentido preguntar
const DIAS_AVISO_RENOVACION = 3;

// Mapeo de columnas de 'compras_proveedor' (id, pedido_id, variante_id, estado, clave_serial,
// referencia_externa, costo_real_cop, fecha y opcionalmente entregado_at). Se usa el primer nombre con valor.
const COLUMNAS = {
    pedido:    ['pedido_id'],
    producto:  ['referencia_externa', 'variante_id'],
    variante:  ['variante_id'],
    costo:     ['costo_real_cop'],
    cantidad:  ['cantidad'],
    fecha:     ['created_at', 'creado_at'],
    entregado: ['entregado_at'],
    // Columnas de WO-011 (supabase/wo-011.sql)
    whatsapp:     ['cliente_whatsapp'],
    vencimiento:  ['fecha_vencimiento'],
    garantiaDias: ['garantia_dias'],
};
// Nombres posibles de la columna de fecha para ordenar; se recuerda el que funcione
const COLUMNAS_FECHA = ['created_at', 'creado_at'];
let columnaFecha = null;

// Categorías por palabras clave en el nombre del producto (combos se evalúan primero)
const CATEGORIAS = [
    { id: 'combos',    texto: 'Combos',    icono: 'fa-layer-group', palabras: ['combo', 'pack', 'kit', ' + '] },
    { id: 'streaming', texto: 'Streaming', icono: 'fa-tv',          palabras: ['netflix', 'disney', 'hbo', 'max', 'prime', 'amazon', 'spotify', 'youtube', 'crunchyroll', 'paramount', 'star+', 'vix', 'apple tv', 'deezer', 'plex', 'iptv', 'pantalla'] },
    { id: 'licencias', texto: 'Licencias', icono: 'fa-key',         palabras: ['licencia', 'windows', 'office', '365', 'serial', 'key', 'antivirus', 'kaspersky', 'eset', 'norton', 'adobe', 'autocad', 'game pass', 'xbox', 'playstation', 'psn', 'steam', 'canva'] },
];
const CATEGORIA_OTROS = { id: 'otros', texto: 'Otros', icono: 'fa-box' };

// Simulador de stock de prueba (solo en este navegador; nunca se escribe en la BD)
const PRODUCTOS_PRUEBA = [
    { referencia: 'Licencia Windows 11 Pro', costo: 18000 },
    { referencia: 'Netflix 1 Pantalla',      costo: 9000 },
    { referencia: 'Game Pass Ultimate 1 Mes', costo: 22000 },
    { referencia: 'Office 365 Personal',     costo: 25000 },
    { referencia: 'Disney+ Premium Pantalla', costo: 7000 },
    { referencia: 'Spotify Premium 1 Mes',   costo: 6000 },
    { referencia: 'Combo Netflix + Spotify', costo: 15000 },
];

// Estado de la interfaz
const pedidos = new Map();          // id → fila de la BD (o de prueba)
const ui = { filtro: 'pendientes', categoria: 'todas', busqueda: '', vista: 'pedidos' };
let canalPedidos = null;            // suscripción Realtime activa
let pedidoEditando = null;          // id del pedido abierto en el modal de edición
let pedidoPagando = null;           // id del pedido abierto en el modal de pago
let metodosPago = [];               // filas de public.metodos_pago
let pagosPendientes = [];           // comprobantes PENDIENTE de public.pagos (RPC pagos_pendientes)
let errorPagos = null;              // mensaje si no se pudieron leer
let baseConocimiento = null;        // bot-conocimiento.json

document.addEventListener('DOMContentLoaded', async () => {
    const formLogin = document.getElementById('form-login');
    const inputEmail = document.getElementById('login-email');
    const inputPassword = document.getElementById('login-password');
    const btnLogin = document.getElementById('btn-login');
    const loginError = document.getElementById('login-error');
    const vistaLogin = document.getElementById('vista-login');
    const vistaDashboard = document.getElementById('vista-dashboard');

    // Limpieza del sistema anterior (clave maestra + sessionStorage)
    sessionStorage.removeItem('dc_admin_auth');

    async function mostrarDashboard() {
        vistaLogin.classList.add('hidden');
        vistaDashboard.classList.remove('hidden');
        vistaDashboard.animate(
            [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
            { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
        const { data: { user } } = await supabaseClient.auth.getUser();
        document.getElementById('ajustes-email').textContent = user?.email ?? '—';
        cargarPedidos();
        iniciarRealtime();
        cargarMetodosPago();
        cargarPagosPendientes();
        cargarNotificaciones();
        cargarBaseConocimiento();
    }

    function mostrarLogin() {
        detenerRealtime();
        document.querySelectorAll('[role="dialog"]').forEach(cerrarModal);
        vistaDashboard.classList.add('hidden');
        vistaLogin.classList.remove('hidden');
        vistaLogin.animate(
            [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
            { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
        inputPassword.value = '';
    }

    // 1. Sesión existente de Supabase Auth (persiste entre recargas)
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) mostrarDashboard();

    // Si la sesión expira o se cierra en otra pestaña, volver al login
    supabaseClient.auth.onAuthStateChange((evento) => {
        if (evento === 'SIGNED_OUT') mostrarLogin();
    });

    // 2. Inicio de sesión con Supabase Auth
    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();

        loginError.classList.add('hidden');
        btnLogin.disabled = true;
        btnLogin.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Verificando...';

        const { error } = await supabaseClient.auth.signInWithPassword({
            email: inputEmail.value.trim(),
            password: inputPassword.value,
        });

        btnLogin.disabled = false;
        btnLogin.textContent = 'Desbloquear Panel';

        if (error) {
            console.error('Error de inicio de sesión:', error.message);
            // Sin respuesta del servidor (DNS/firewall/sin internet) ≠ credenciales incorrectas
            const sinConexion = error.status === 0 || error.name === 'AuthRetryableFetchError' || /fetch/i.test(error.message);
            document.getElementById('login-error-texto').textContent = sinConexion
                ? 'Sin conexión con el servidor. Revisa tu conexión a internet.'
                : 'Correo o contraseña incorrectos. Acceso denegado.';
            loginError.classList.remove('hidden');
            loginError.animate(
                [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
                { duration: 300 }
            );
            Sonidos.error();
            inputPassword.value = '';
            return;
        }

        inputPassword.value = '';
        mostrarDashboard();
    });

    // 3. Cerrar sesión (barra lateral y ajustes)
    document.querySelectorAll('[data-logout]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const { error } = await supabaseClient.auth.signOut();
            if (error) console.error('Error al cerrar sesión:', error.message);
            mostrarLogin();
        });
    });

    // 4. Acciones de la cabecera y el dock
    document.getElementById('btn-recargar').addEventListener('click', cargarPedidos);
    document.querySelectorAll('[data-generar-prueba]').forEach((btn) => btn.addEventListener('click', generarPedidoPrueba));
    document.querySelectorAll('#btn-exportar, [data-exportar]').forEach((btn) => btn.addEventListener('click', exportarCSV));
    document.querySelectorAll('#btn-pantalla-completa, #ajuste-pantalla-completa').forEach((btn) => btn.addEventListener('click', alternarPantallaCompleta));
    document.addEventListener('fullscreenchange', pintarBotonPantallaCompleta);
    if (!document.fullscreenEnabled) {
        // iPhone/iPad no permiten pantalla completa en páginas web
        document.querySelectorAll('#btn-pantalla-completa, #ajuste-pantalla-completa').forEach((btn) => { btn.hidden = true; });
    }

    // 5. Filtros por estado, categoría y buscador
    document.querySelectorAll('[data-filtro]').forEach((tab) => {
        tab.addEventListener('click', () => cambiarFiltro(tab.dataset.filtro));
    });

    const buscador = document.getElementById('buscador');
    const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
    buscador.addEventListener('input', () => {
        ui.busqueda = buscador.value.trim().toLowerCase();
        btnLimpiar.hidden = !buscador.value;
        renderLista();
    });
    btnLimpiar.addEventListener('click', () => {
        buscador.value = '';
        buscador.dispatchEvent(new Event('input'));
        buscador.focus();
    });

    // 6. Navegación: Pedidos / Pagos & Bot / Ajustes
    document.querySelectorAll('[data-vista], [data-vista-dock]').forEach((btn) => {
        btn.addEventListener('click', () => {
            cerrarModal(document.getElementById('modal-ajustes'));
            mostrarVista(btn.dataset.vista ?? btn.dataset.vistaDock);
        });
    });
    pintarNavegacion();
    document.getElementById('btn-recargar-metodos').addEventListener('click', cargarMetodosPago);
    document.getElementById('btn-nuevo-metodo').addEventListener('click', () => abrirMetodo());
    document.getElementById('form-metodo').addEventListener('submit', protegido(guardarMetodo, 'modal-metodo'));
    document.getElementById('btn-recargar-notif').addEventListener('click', cargarNotificaciones);
    document.getElementById('promo-buscar').addEventListener('input', pintarPromociones);
    document.getElementById('comprobantes-web-recargar').addEventListener('click', cargarComprobantesWeb);
    document.getElementById('combo-regla-nueva').addEventListener('click', () => { reglasCombo.nueva = true; pintarReglasCombo(); document.querySelector('#combo-reglas-lista form:last-child [name="min"]')?.focus(); });
    document.getElementById('bot-buscar').addEventListener('input', pintarCatalogoBot);
    document.getElementById('form-pago').addEventListener('submit', protegido(guardarPago, 'modal-pago'));
    document.querySelectorAll('[data-abrir-ajustes]').forEach((btn) => {
        btn.addEventListener('click', () => abrirModal(document.getElementById('modal-ajustes')));
    });

    // 7. Modales: cerrar con fondo, botón o tecla Esc
    document.querySelectorAll('[data-cerrar-modal]').forEach((el) => {
        el.addEventListener('click', () => cerrarModal(el.closest('[role="dialog"]')));
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        document.querySelectorAll('[role="dialog"]:not([hidden])').forEach(cerrarModal);
    });
    document.getElementById('form-editar').addEventListener('submit', protegido(guardarEdicion, 'modal-editar'));

    // 8. Ojo de visibilidad para campos de contraseña / clave
    document.querySelectorAll('[data-ojo]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.ojo);
            const mostrar = input.type === 'password';
            input.type = mostrar ? 'text' : 'password';
            btn.innerHTML = `<i class="fa-solid ${mostrar ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
            btn.setAttribute('aria-label', mostrar ? 'Ocultar' : 'Mostrar');
        });
    });

    // 9. Sonido On/Off (preferencia compartida con ui.js)
    const ajusteSonido = document.getElementById('ajuste-sonido');
    ajusteSonido.checked = Sonidos.activo();
    ajusteSonido.addEventListener('change', () => {
        Sonidos.activar(ajusteSonido.checked);
        if (ajusteSonido.checked) Sonidos.completar();
    });

    pintarTabs();
    indicadorEnVivo(false);
});

/* ==================== CARGA DE DATOS ==================== */

async function cargarPedidos() {
    const contenedor = document.getElementById('lista-pedidos');
    const iconoRecargar = document.querySelector('#btn-recargar i');

    iconoRecargar?.classList.add('fa-spin');
    contenedor.innerHTML = Array.from({ length: 4 }, skeletonTarjeta).join('');

    const { data, error } = await consultarPedidos();
    iconoRecargar?.classList.remove('fa-spin');

    if (error) {
        console.error('Error al cargar pedidos:', error);
        contenedor.innerHTML = `
            <div class="col-span-full rounded-3xl bg-red-500/[0.06] ring-1 ring-red-500/30 p-8 text-center">
                <i class="fa-solid fa-triangle-exclamation text-red-400 text-3xl mb-3"></i>
                <p class="text-sm font-bold text-red-200">No se pudieron cargar los pedidos.</p>
                <p class="text-xs text-red-300/70 mt-1 break-words">${escaparHTML(error.message)}</p>
            </div>`;
        return;
    }

    // Los pedidos de prueba viven solo en memoria: se conservan al recargar
    const pruebas = [...pedidos.values()].filter((fila) => fila._prueba);
    pedidos.clear();
    data.forEach((fila) => pedidos.set(String(fila.id), fila));
    pruebas.forEach((fila) => pedidos.set(String(fila.id), fila));
    renderLista({ animar: true });
}

// Ordena por la columna de fecha que exista (created_at o creado_at); si ninguna existe, por id
async function consultarPedidos() {
    const candidatas = columnaFecha ? [columnaFecha] : [...COLUMNAS_FECHA, null];
    let ultimoError = null;

    for (const columna of candidatas) {
        let consulta = supabaseClient.from('compras_proveedor').select('*');
        if (columna) consulta = consulta.order(columna, { ascending: false });
        const { data, error } = await consulta.order('id', { ascending: false }).limit(LIMITE_PEDIDOS);

        if (!error) {
            columnaFecha = columna;
            return { data, error: null };
        }
        ultimoError = error;
        // 42703 = la columna no existe → probar la siguiente; cualquier otro error se reporta
        if (error.code !== '42703') break;
    }
    return { data: null, error: ultimoError };
}

/* ==================== FILTROS, BÚSQUEDA Y RENDER ==================== */

function esPendiente(fila) {
    return ESTADOS_ACTIVOS.includes(fila?.estado);
}

function esEntregado(fila) {
    return ESTADOS_ENTREGADOS.includes(fila?.estado);
}

function categoriaDe(fila) {
    const nombre = ` ${String(leerCampo(fila, 'producto', '')).toLowerCase()} `;
    return CATEGORIAS.find((c) => c.palabras.some((p) => nombre.includes(p))) ?? CATEGORIA_OTROS;
}

function coincideFiltro(fila) {
    if (ui.filtro === 'pendientes' && !esPendiente(fila)) return false;
    if (ui.filtro === 'entregados' && !esEntregado(fila)) return false;
    if (ui.categoria !== 'todas' && categoriaDe(fila).id !== ui.categoria) return false;
    if (!ui.busqueda) return true;
    const p = normalizarPedido(fila);
    return [p.id, p.pedidoId, p.producto, p.variante, fila.estado]
        .some((valor) => String(valor).toLowerCase().includes(ui.busqueda));
}

function filasOrdenadas() {
    const fecha = (fila) => new Date(leerCampo(fila, 'fecha', 0)).getTime() || 0;
    return [...pedidos.values()].sort((a, b) => fecha(b) - fecha(a) || (Number(b.id) || 0) - (Number(a.id) || 0));
}

function filasVisibles() {
    return filasOrdenadas().filter(coincideFiltro);
}

function renderLista({ animar = false } = {}) {
    const contenedor = document.getElementById('lista-pedidos');
    const visibles = filasVisibles();
    pintarTabs();

    if (visibles.length === 0) {
        mostrarVacio();
        return;
    }

    contenedor.replaceChildren(...visibles.map(crearTarjeta));
    if (!animar) return;
    contenedor.querySelectorAll('article').forEach((tarjeta, i) => {
        tarjeta.animate(
            [{ opacity: 0, transform: 'translateY(14px) scale(.98)' }, { opacity: 1, transform: 'none' }],
            { duration: 420, delay: Math.min(i, 8) * 60, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }
        );
    });
}

function mostrarVacio() {
    const mensajes = {
        pendientes: ['fa-circle-check', 'No hay pedidos pendientes', 'Todo al día. Usa “+” para generar un pedido de prueba.'],
        entregados: ['fa-box-open', 'Aún no hay entregas', 'Los pedidos marcados como realizados aparecerán aquí.'],
        todos:      ['fa-inbox', 'Sin pedidos registrados', 'Cuando entre el primer pago lo verás aquí en tiempo real.'],
    };
    let [icono, titulo, detalle] = mensajes[ui.filtro];
    if (ui.categoria !== 'todas') {
        [icono, titulo, detalle] = ['fa-filter', 'Nada en esta categoría', 'Prueba con otra categoría o con “Todas”.'];
    }
    if (ui.busqueda) {
        [icono, titulo, detalle] = ['fa-magnifying-glass', 'Sin resultados', `Ningún pedido coincide con “${ui.busqueda}”.`];
    }

    document.getElementById('lista-pedidos').innerHTML = `
        <div class="col-span-full rounded-3xl bg-white/[0.02] border border-dashed border-white/10 p-10 sm:p-14 text-center">
            <div class="mx-auto mb-5 grid place-items-center w-16 h-16 rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/30 shadow-lg shadow-emerald-500/10">
                <i class="fa-solid ${icono} text-emerald-400 text-2xl"></i>
            </div>
            <h3 class="font-tech text-lg font-black uppercase tracking-wider">${escaparHTML(titulo)}</h3>
            <p class="text-xs text-neutral-500 mt-2">${escaparHTML(detalle)}</p>
        </div>`;
}

function cambiarFiltro(filtro) {
    if (ui.filtro === filtro) return;
    ui.filtro = filtro;
    renderLista({ animar: true });
}

function cambiarCategoria(categoria) {
    if (ui.categoria === categoria) return;
    ui.categoria = categoria;
    renderLista({ animar: true });
}

// Pestañas de estado y categoría con contadores dinámicos + KPIs
function pintarTabs() {
    const filas = [...pedidos.values()];
    const totales = { pendientes: filas.filter(esPendiente).length, entregados: filas.filter(esEntregado).length, todos: filas.length };

    document.querySelectorAll('[data-contador]').forEach((el) => {
        el.textContent = totales[el.dataset.contador];
    });

    const orden = ['pendientes', 'entregados', 'todos'];
    document.querySelectorAll('[data-filtro]').forEach((tab) => {
        const activa = tab.dataset.filtro === ui.filtro;
        tab.setAttribute('aria-selected', String(activa));
        tab.classList.toggle('text-white', activa);
        tab.classList.toggle('text-neutral-400', !activa);
    });
    const indicador = document.getElementById('tab-indicador');
    if (indicador) indicador.style.transform = `translateX(calc(${orden.indexOf(ui.filtro)} * (100% + 0.25rem)))`;

    pintarCategorias(filas);
    pintarKPIs(filas);
    pintarPagosBot();
}

function pintarCategorias(filas) {
    const caja = document.getElementById('filtro-categorias');
    if (!caja) return;
    const conteo = { todas: filas.length };
    filas.forEach((fila) => {
        const id = categoriaDe(fila).id;
        conteo[id] = (conteo[id] ?? 0) + 1;
    });

    const opciones = [{ id: 'todas', texto: 'Todas', icono: 'fa-border-all' }, ...CATEGORIAS.slice().reverse(), CATEGORIA_OTROS];
    caja.replaceChildren(...opciones.map(({ id, texto, icono }) => {
        const activa = ui.categoria === id;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn-cyber shrink-0 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-2xl text-[11px] font-bold uppercase tracking-wider ring-1 ${
            activa ? 'bg-dcRed/15 ring-dcRed/50 text-white' : 'bg-white/[0.03] ring-white/10 text-neutral-400 hover:text-white'}`;
        btn.innerHTML = `<i class="fa-solid ${icono} ${activa ? 'text-dcRed' : ''}"></i> ${texto}
            <span class="px-1.5 py-0.5 rounded-md bg-white/10 text-[10px] text-neutral-300">${conteo[id] ?? 0}</span>`;
        btn.addEventListener('click', () => cambiarCategoria(id));
        return btn;
    }));
}

/* ==================== MICRO-DASHBOARD KPI ==================== */

function pintarKPIs(filas) {
    const hoy = new Date().toDateString();
    const pedidosHoy = filas.filter((fila) => {
        const f = leerCampo(fila, 'fecha', null);
        return f && new Date(f).toDateString() === hoy;
    }).length;

    document.getElementById('kpi-hoy').textContent = pedidosHoy;
    document.getElementById('kpi-procesando').textContent = filas.filter((fila) => ESTADOS_EN_PROCESO.includes(fila.estado)).length;

    // Tiempo promedio = entregado_at − fecha de creación (requiere la columna entregado_at)
    const tiempos = filas
        .map((fila) => {
            const inicio = new Date(leerCampo(fila, 'fecha', null)).getTime();
            const fin = new Date(leerCampo(fila, 'entregado', null)).getTime();
            return fin - inicio;
        })
        .filter((ms) => Number.isFinite(ms) && ms >= 0);

    const kpiTiempo = document.getElementById('kpi-tiempo');
    const nota = document.getElementById('kpi-tiempo-nota');
    if (tiempos.length) {
        kpiTiempo.textContent = formatearDuracion(tiempos.reduce((a, b) => a + b, 0) / tiempos.length);
        nota.textContent = `${tiempos.length} entrega${tiempos.length === 1 ? '' : 's'}`;
    } else {
        kpiTiempo.textContent = '—';
        nota.textContent = tieneColumnaEntregado() ? 'Sin entregas aún' : 'Falta columna entregado_at';
    }
}

function tieneColumnaEntregado() {
    return [...pedidos.values()].some((fila) => !fila._prueba && 'entregado_at' in fila);
}

function formatearDuracion(ms) {
    const minutos = Math.round(ms / 60000);
    if (minutos < 1) return '<1 min';
    if (minutos < 60) return `${minutos} min`;
    const horas = Math.floor(minutos / 60);
    if (horas < 24) return `${horas} h ${minutos % 60} min`;
    return `${Math.floor(horas / 24)} d ${horas % 24} h`;
}

/* ==================== TIEMPO REAL (Supabase Realtime) ==================== */

function iniciarRealtime() {
    if (canalPedidos) return;
    let yaConectado = false;

    canalPedidos = supabaseClient
        .channel('admin-compras-proveedor')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'compras_proveedor' }, manejarCambio)
        // Comprobantes nuevos o revisados en 'pagos' (n8n / WhatsApp)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos' }, ({ eventType, new: pago }) => {
            if (eventType === 'INSERT' && pago?.estado === 'PENDIENTE') {
                mostrarToast(`Nuevo comprobante ${textoMetodo(pago.metodo)} por verificar.`, 'nuevo', 6000);
                Sonidos.nuevo();
            }
            cargarPagosPendientes();
        })
        .subscribe((estado, err) => {
            const enVivo = estado === 'SUBSCRIBED';
            indicadorEnVivo(enVivo);
            if (err) console.error('Realtime:', estado, err);
            // Tras una reconexión se pudieron perder eventos: resincronizar
            if (enVivo && yaConectado) cargarPedidos();
            if (enVivo) yaConectado = true;
        });
}

async function detenerRealtime() {
    if (!canalPedidos) return;
    await supabaseClient.removeChannel(canalPedidos);
    canalPedidos = null;
    indicadorEnVivo(false);
}

// Aplica un INSERT / UPDATE / DELETE sin recargar la lista (también lo usa el simulador)
function manejarCambio({ eventType, new: nuevo, old: viejo }) {
    const id = String(nuevo?.id ?? viejo?.id ?? '');
    if (!id) return;

    const tarjeta = buscarTarjeta(id);
    // Una tarjeta que este panel está procesando o retirando ya se gestiona sola
    if (tarjeta?.dataset.procesando || tarjeta?.dataset.saliendo) return;

    if (eventType === 'DELETE') {
        pedidos.delete(id);
        if (tarjeta) retirarTarjeta(tarjeta);
        pintarTabs();
        return;
    }

    const esNuevo = eventType === 'INSERT' && !pedidos.has(id);
    // Un cambio de estado real puede haber encolado notificaciones en la BD
    if (!nuevo._prueba && pedidos.get(id)?.estado !== nuevo.estado) programarNotificaciones();
    pedidos.set(id, nuevo);
    pintarTabs();

    if (coincideFiltro(nuevo)) {
        if (tarjeta) tarjeta.replaceWith(crearTarjeta(nuevo));
        else agregarTarjeta(nuevo);
    } else if (tarjeta) {
        retirarTarjeta(tarjeta);
    }

    if (esNuevo) {
        const p = normalizarPedido(nuevo);
        const etiqueta = nuevo._prueba ? 'Pedido de prueba' : 'Nuevo pedido';
        mostrarToast(`${etiqueta} #${p.ref}: ${p.producto} x${p.cantidad}`, 'nuevo', 6000);
        Sonidos.nuevo();
    }
}

// El indicador "En vivo" aparece en la barra móvil, la cabecera y los ajustes
function indicadorEnVivo(activo) {
    document.querySelectorAll('[data-indicador-vivo]').forEach((indicador) => {
        const visibleEnEscritorio = indicador.classList.contains('md:inline-flex');
        indicador.className = `${visibleEnEscritorio ? 'hidden md:inline-flex' : 'inline-flex'} items-center gap-2 px-3 py-2 rounded-xl ring-1 text-[10px] font-black uppercase tracking-widest ${
            activo ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30' : 'bg-white/[0.04] text-neutral-500 ring-white/10'}`;
        indicador.title = activo ? 'Los cambios llegan automáticamente' : 'Sin conexión en tiempo real: usa el botón de actualizar';
        indicador.innerHTML = `
            <span class="relative flex h-2 w-2">
                ${activo ? '<span class="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping"></span>' : ''}
                <span class="relative inline-flex h-2 w-2 rounded-full ${activo ? 'bg-emerald-400' : 'bg-neutral-500'}"></span>
            </span>
            ${activo ? 'En vivo' : 'Sin conexión'}`;
    });
}

/* ==================== SIMULADOR DE PEDIDOS ==================== */

// Crea un pedido ficticio en memoria y lo pasa por el mismo flujo que un INSERT real
function generarPedidoPrueba() {
    const azar = (n) => Math.floor(Math.random() * n);
    const base = PRODUCTOS_PRUEBA[azar(PRODUCTOS_PRUEBA.length)];
    const bloque = () => Math.random().toString(36).slice(2, 7).toUpperCase().padEnd(5, 'X');

    const fila = {
        id: `prueba-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, // único aunque se generen varios en el mismo ms
        pedido_id: `TEST-${1000 + azar(9000)}`,
        variante_id: `VAR-${100 + azar(900)}`,
        estado: Math.random() < 0.35 ? ESTADO_PENDIENTE_PAGO : ESTADO_PENDIENTE,
        garantia_dias: GARANTIA_DIAS,
        clave_serial: Math.random() < 0.5 ? `${bloque()}-${bloque()}-${bloque()}-${bloque()}` : null,
        referencia_externa: base.referencia,
        costo_real_cop: base.costo,
        created_at: new Date().toISOString(),
        _prueba: true,
    };

    // Si el filtro actual ocultaría el pedido, volver a "Pendientes / Todas" para verlo entrar
    if (!coincideFiltro(fila)) {
        ui.filtro = 'pendientes';
        ui.categoria = 'todas';
        renderLista();
    }
    manejarCambio({ eventType: 'INSERT', new: fila });
}

/* ==================== TARJETAS ==================== */

function buscarTarjeta(id) {
    return document.querySelector(`#lista-pedidos article[data-id="${CSS.escape(String(id))}"]`);
}

// Primer valor no vacío entre los nombres de columna conocidos
function leerCampo(pedido, campo, porDefecto) {
    for (const columna of COLUMNAS[campo]) {
        const valor = pedido?.[columna];
        if (valor !== null && valor !== undefined && String(valor).trim() !== '') return valor;
    }
    return porDefecto;
}

// Convierte una fila de la BD en datos seguros para pintar (nunca null/undefined)
function normalizarPedido(pedido) {
    const cantidad = Number.parseInt(leerCampo(pedido, 'cantidad', 1), 10);
    const costo = Number(leerCampo(pedido, 'costo', NaN));
    const fechaBruta = leerCampo(pedido, 'fecha', null);
    const fecha = fechaBruta ? new Date(fechaBruta) : null;
    const id = pedido?.id ?? '—';
    const pedidoId = leerCampo(pedido, 'pedido', null);

    return {
        id,
        pedidoId: pedidoId === null ? '—' : String(pedidoId),
        ref: String(pedidoId ?? id), // número que se muestra y se envía por WhatsApp
        producto: String(leerCampo(pedido, 'producto', 'Producto sin referencia')),
        variante: String(leerCampo(pedido, 'variante', '—')),
        costoNumero: Number.isFinite(costo) ? costo : null,
        costo: Number.isFinite(costo)
            ? costo.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
            : '—',
        cantidad: Number.isFinite(cantidad) && cantidad > 0 ? cantidad : 1,
        fechaISO: fecha && !Number.isNaN(fecha.getTime()) ? fecha.toISOString() : '',
        fecha: fecha && !Number.isNaN(fecha.getTime())
            ? fecha.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
            : '—',
        estadoTexto: ESTADOS[pedido?.estado]?.texto ?? pedido?.estado ?? 'Sin estado',
        tieneClave: Boolean(pedido?.clave_serial),
        prueba: Boolean(pedido?._prueba),
    };
}

function mensajeProveedor(p) {
    return PlantillasWA.pedidoProveedor({ pedido: p.ref, producto: p.producto, cantidad: p.cantidad });
}

function enlaceProveedor(p) {
    return `https://wa.me/${WHATSAPP_PROVEEDOR}?text=${encodeURIComponent(mensajeProveedor(p))}`;
}

// Formato limpio para pegar en un chat
function resumenChat(p) {
    return `📦 PEDIDO #${p.ref} | 🔑 PRODUCTO: ${p.producto} | STATUS: ${p.estadoTexto}`;
}

// Días que faltan para que venza la garantía (null si no hay fecha de vencimiento)
function diasParaVencer(fila) {
    const vence = new Date(leerCampo(fila, 'vencimiento', null)).getTime();
    return Number.isFinite(vence) ? Math.ceil((vence - Date.now()) / 86400000) : null;
}

// Garantía: usa fecha_vencimiento (la calcula la BD al asignar la clave); si no existe, cuenta desde la entrega
function garantia(fila) {
    const dias = Number(leerCampo(fila, 'garantiaDias', GARANTIA_DIAS)) || GARANTIA_DIAS;
    if (['FALLIDA', 'CANCELADA'].includes(fila.estado)) {
        return { texto: 'Sin garantía (compra no entregada)', clases: 'text-neutral-500 ring-white/10 bg-white/[0.03]', icono: 'fa-shield' };
    }
    if (!esEntregado(fila) && !leerCampo(fila, 'vencimiento', null)) {
        return { texto: `Garantía ${dias} días · se activa al asignar la cuenta`, clases: 'text-neutral-400 ring-white/10 bg-white/[0.03]', icono: 'fa-shield' };
    }
    let restantes = diasParaVencer(fila);
    if (restantes === null) {
        const inicio = new Date(leerCampo(fila, 'entregado', null) ?? leerCampo(fila, 'fecha', null)).getTime();
        if (!Number.isFinite(inicio)) {
            return { texto: `Garantía ${dias} días activada`, clases: 'text-emerald-300 ring-emerald-500/30 bg-emerald-500/10', icono: 'fa-shield-halved' };
        }
        restantes = dias - Math.floor((Date.now() - inicio) / 86400000);
    }
    if (restantes <= 0) {
        return { texto: 'Garantía vencida', clases: 'text-neutral-500 ring-white/10 bg-white/[0.03]', icono: 'fa-shield' };
    }
    return {
        texto: `Garantía ${dias} días activada · quedan ${restantes}`,
        clases: restantes <= 5 ? 'text-amber-300 ring-amber-500/30 bg-amber-500/10' : 'text-emerald-300 ring-emerald-500/30 bg-emerald-500/10',
        icono: 'fa-shield-halved',
    };
}

// Crea el <article> de un pedido con sus botones conectados
function crearTarjeta(fila) {
    const plantilla = document.createElement('template');
    plantilla.innerHTML = tarjetaPedido(fila).trim();
    const tarjeta = plantilla.content.firstElementChild;
    const p = normalizarPedido(fila);

    tarjeta.querySelector('[data-accion="marcar"]')?.addEventListener('click', (e) => marcarComoPedido(String(p.id), e.currentTarget, p.ref));
    tarjeta.querySelector('[data-accion="pago"]')?.addEventListener('click', () => abrirPago(String(p.id)));
    tarjeta.querySelector('[data-accion="entregar"]')?.addEventListener('click', (e) => marcarComoEntregado(String(p.id), e.currentTarget, p.ref));
    tarjeta.querySelector('[data-accion="copiar"]').addEventListener('click', () => copiarTexto(mensajeProveedor(p), 'Pedido copiado para el proveedor'));
    tarjeta.querySelector('[data-accion="resumen"]').addEventListener('click', () => copiarTexto(resumenChat(p), 'Resumen copiado para chat'));
    tarjeta.querySelector('[data-accion="qr"]').addEventListener('click', () => abrirQR(p));
    tarjeta.querySelector('[data-accion="editar"]').addEventListener('click', () => abrirEdicion(String(p.id)));
    return tarjeta;
}

// Inserta una tarjeta nueva con entrada neón instantánea
function agregarTarjeta(fila) {
    const contenedor = document.getElementById('lista-pedidos');
    if (!contenedor.querySelector('article')) contenedor.innerHTML = ''; // quita el estado vacío
    const tarjeta = crearTarjeta(fila);
    contenedor.prepend(tarjeta); // la lista va de más reciente a más antiguo

    tarjeta.animate(
        [{ opacity: 0, transform: 'translateY(16px) scale(.94)' }, { opacity: 1, transform: 'none' }],
        { duration: 450, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );
    tarjeta.animate(
        [{ boxShadow: '0 0 0 2px rgba(255,0,51,.9), 0 0 60px rgba(255,0,51,.55)' }, { boxShadow: '0 0 0 0 rgba(255,0,51,0)' }],
        { duration: 2000, easing: 'ease-out' }
    );
}

// Salida fluida: contracción + desvanecido, luego eliminar
async function retirarTarjeta(tarjeta) {
    tarjeta.dataset.saliendo = '1';
    await tarjeta.animate(
        [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.88) translateY(-8px)' }],
        { duration: 380, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }
    ).finished;
    tarjeta.remove();
    if (!document.querySelector('#lista-pedidos article')) mostrarVacio();
}

function skeletonTarjeta() {
    return `
        <div class="rounded-3xl bg-white/[0.03] ring-1 ring-dcRed/10 p-5 space-y-4" aria-hidden="true">
            <div class="flex justify-between"><div class="skeleton h-6 w-36 rounded-full"></div><div class="skeleton h-4 w-16 rounded-md"></div></div>
            <div class="space-y-2"><div class="skeleton h-3 w-24 rounded"></div><div class="skeleton h-6 w-3/4 rounded-lg"></div></div>
            <div class="grid grid-cols-2 gap-2">${'<div class="skeleton h-14 rounded-2xl"></div>'.repeat(4)}</div>
            <div class="grid grid-cols-5 gap-2">${'<div class="skeleton h-12 rounded-2xl"></div>'.repeat(5)}</div>
            <div class="skeleton h-12 rounded-2xl"></div>
        </div>`;
}

// Plantilla de una tarjeta de pedido (cristal + hover elevado + glow si está pendiente)
function tarjetaPedido(fila) {
    const p = normalizarPedido(fila);
    const pendiente = esPendiente(fila);
    const categoria = categoriaDe(fila);
    const g = garantia(fila);
    const boton = 'btn-cyber grid place-items-center min-h-[48px] rounded-2xl bg-white/[0.04] ring-1 ring-white/10 text-neutral-300 hover:text-white';

    return `
        <article data-id="${escaparHTML(p.id)}"
            class="group relative overflow-hidden rounded-3xl bg-white/[0.03] backdrop-blur-xl ring-1 ${p.prueba ? 'ring-sky-400/30' : 'ring-white/10'} ${pendiente ? 'glow-activo' : ''} shadow-2xl shadow-black/40 p-5 flex flex-col gap-4 transform-gpu transition-all duration-300 hover:-translate-y-1 hover:ring-dcRed/40 hover:shadow-red-500/10">
            <div class="pointer-events-none absolute -top-20 -right-20 w-48 h-48 rounded-full bg-dcRed/20 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

            <div class="relative flex flex-wrap items-center justify-between gap-2">
                <span class="badge-estado">${badgeEstado(fila.estado)}</span>
                <span class="flex items-center gap-1.5">
                    ${p.prueba ? '<span class="px-2 py-1 rounded-full bg-sky-500/15 ring-1 ring-sky-400/40 text-sky-300 text-[9px] font-black uppercase tracking-widest">Prueba</span>' : ''}
                    ${p.tieneClave ? '<span class="badge-vip px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest"><i class="fa-solid fa-bolt mr-1"></i>VIP · Entrega inmediata</span>' : ''}
                </span>
            </div>

            <div class="relative min-w-0">
                <p class="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em] text-dcRed truncate">
                    Pedido #${escaparHTML(p.ref)}
                    <span class="text-neutral-500 tracking-wider"><i class="fa-solid ${categoria.icono} mr-1"></i>${escaparHTML(categoria.texto)}</span>
                </p>
                <h3 class="mt-1 font-tech text-xl font-black leading-tight text-white break-words">${escaparHTML(p.producto)}</h3>
            </div>

            <dl class="relative grid grid-cols-2 gap-2 text-xs">
                ${celda('fa-receipt', 'Pedido', p.pedidoId)}
                ${celda('fa-layer-group', 'Variante', p.variante)}
                ${celda('fa-coins', 'Costo', p.costo, 'text-emerald-300')}
                ${celda('fa-key', 'Clave', p.tieneClave ? 'Asignada' : 'Sin asignar', p.tieneClave ? 'text-emerald-300' : 'text-amber-300')}
            </dl>

            <div class="relative flex flex-wrap items-center justify-between gap-2 -mt-1">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ring-1 text-[10px] font-bold ${g.clases}">
                    <i class="fa-solid ${g.icono}"></i> ${escaparHTML(g.texto)}
                </span>
                <span class="text-[11px] text-neutral-500"><i class="fa-regular fa-clock mr-1"></i>${escaparHTML(p.fecha)}</span>
            </div>

            <div class="relative mt-auto grid grid-cols-5 gap-2">
                <a href="${enlaceProveedor(p)}" target="_blank" rel="noopener" title="Enviar al proveedor por WhatsApp" aria-label="Enviar al proveedor por WhatsApp"
                    class="${boton} hover:text-emerald-300"><i class="fa-brands fa-whatsapp text-lg"></i></a>
                <button type="button" data-accion="copiar" title="Copiar pedido para el proveedor" aria-label="Copiar pedido para el proveedor" class="${boton}">
                    <i class="fa-regular fa-copy"></i>
                </button>
                <button type="button" data-accion="resumen" title="Copiar resumen para chat" aria-label="Copiar resumen para chat" class="${boton}">
                    <i class="fa-regular fa-comment-dots"></i>
                </button>
                <button type="button" data-accion="qr" title="QR para enviar desde el celular" aria-label="QR para enviar desde el celular" class="${boton}">
                    <i class="fa-solid fa-qrcode"></i>
                </button>
                <button type="button" data-accion="editar" title="Edición rápida" aria-label="Edición rápida" class="${boton}">
                    <i class="fa-solid fa-pen-to-square"></i>
                </button>
            </div>
            ${fila.estado === ESTADO_PENDIENTE_PAGO ? `
            <button type="button" data-accion="pago"
                class="btn-cyber ancho relative flex items-center justify-center gap-2 min-h-[52px] rounded-2xl bg-sky-600 hover:bg-sky-500 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-sky-600/25">
                <i class="fa-solid fa-receipt text-sm"></i> Registrar pago
            </button>` : ''}
            ${fila.estado === ESTADO_PENDIENTE ? `
            <button type="button" data-accion="marcar"
                class="btn-cyber ancho relative flex items-center justify-center gap-2 min-h-[52px] rounded-2xl bg-dcRed hover:bg-dcRedDark text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-red-600/25 disabled:opacity-70 disabled:cursor-wait">
                <i class="fa-solid fa-truck-fast text-sm"></i> Marcar como Pedido
            </button>` : ''}
            ${ESTADOS_POR_ENTREGAR.includes(fila.estado) ? `
            <button type="button" data-accion="entregar"
                class="btn-cyber verde ancho relative flex items-center justify-center gap-2 min-h-[52px] rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-xs font-black uppercase tracking-wider text-white shadow-lg shadow-emerald-600/25 disabled:opacity-70 disabled:cursor-wait">
                <i class="fa-solid fa-box-open text-sm"></i> Marcar como entregado
            </button>` : ''}
        </article>`;
}

function celda(icono, etiqueta, valor, colorValor = 'text-white') {
    return `
        <div class="rounded-2xl bg-dcDarkBg/60 ring-1 ring-white/5 p-3 min-w-0">
            <dt class="text-[10px] uppercase font-bold tracking-wider text-neutral-500"><i class="fa-solid ${icono} mr-1"></i> ${etiqueta}</dt>
            <dd class="mt-1 font-bold truncate ${colorValor}" title="${escaparHTML(valor)}">${escaparHTML(valor)}</dd>
        </div>`;
}

// Badge con LED pulsante
function badgeEstado(estado) {
    const e = ESTADOS[estado] ?? { texto: estado ?? 'Sin estado', clases: 'bg-white/5 text-neutral-300 ring-white/10', punto: 'bg-neutral-400', pulso: false };
    return `
        <span class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full ring-1 text-[10px] font-black uppercase tracking-widest ${e.clases}">
            <span class="relative flex h-2 w-2">
                ${e.pulso ? `<span class="absolute inline-flex h-full w-full rounded-full ${e.punto} opacity-75 animate-ping"></span>` : ''}
                <span class="relative inline-flex h-2 w-2 rounded-full ${e.punto}"></span>
            </span>
            ${escaparHTML(e.texto)}
        </span>`;
}

/* ==================== ACCIONES ==================== */

// ESPERANDO_PROVEEDOR → PEDIDO_REALIZADO
/* ==================== OPERACIONES EN CURSO (cierre defensivo) ==================== */

let operacionesEnCurso = 0;

// Envuelve un flujo: cuenta la operación, marca el modal como ocupado y libera todo aunque falle
function protegido(fn, idModal = null) {
    return async (...args) => {
        const modal = idModal ? document.getElementById(idModal) : null;
        if (modal?.dataset.ocupado) return; // doble envío (Enter + clic)
        operacionesEnCurso += 1;
        if (modal) modal.dataset.ocupado = '1';
        try {
            return await fn(...args);
        } catch (error) {
            console.error('Operación interrumpida:', error);
            mostrarToast('Algo falló a mitad de la operación. Recarga y verifica el estado del pedido.', 'error', 7000);
            Sonidos.error();
        } finally {
            operacionesEnCurso -= 1;
            if (modal) delete modal.dataset.ocupado;
        }
    };
}

// Cerrar o recargar la pestaña con un guardado en vuelo deja el resultado sin confirmar
window.addEventListener('beforeunload', (e) => {
    if (operacionesEnCurso > 0) { e.preventDefault(); e.returnValue = ''; }
});

function marcarComoPedido(id, btn, ref = id) {
    return avanzarEstado(id, btn, ref, {
        desde: [ESTADO_PENDIENTE],
        hacia: 'PEDIDO_REALIZADO',
        aviso: `Pedido #${ref} enviado al proveedor.`,
    });
}

// PEDIDO_REALIZADO / RECIBIDA → ENTREGADO (registra la hora de entrega: garantía, KPI y posventa)
const ESPERA_CONFIRMACION_MS = 4000;

function marcarComoEntregado(id, btn, ref = id) {
    const fila = pedidos.get(String(id));
    // 1.er toque: pide confirmación (la entrega envía WhatsApp al cliente y activa la garantía)
    if (!fila?._prueba && btn.dataset.confirmar !== '1') {
        const avisos = [
            !fila?.clave_serial && ['streaming', 'licencias', 'combos'].includes(categoriaDe(fila).id) ? 'sin cuenta asignada' : null,
            !PlantillasWA.normalizarNumero(fila?.cliente_whatsapp) ? 'sin WhatsApp' : null,
        ].filter(Boolean);
        btn.dataset.confirmar = '1';
        btn.dataset.original = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-circle-question text-sm"></i> ¿Confirmar entrega?${avisos.length ? ` <span class="text-[10px] font-bold normal-case opacity-90">(${avisos.join(' · ')})</span>` : ''}`;
        btn.classList.add('ring-2', 'ring-amber-400');
        clearTimeout(Number(btn.dataset.temporizador));
        btn.dataset.temporizador = String(setTimeout(() => {
            if (btn.dataset.confirmar !== '1') return;
            delete btn.dataset.confirmar;
            btn.innerHTML = btn.dataset.original;
            btn.classList.remove('ring-2', 'ring-amber-400');
        }, ESPERA_CONFIRMACION_MS));
        return;
    }
    // 2.º toque: se restaura el botón y se procesa
    clearTimeout(Number(btn.dataset.temporizador));
    if (btn.dataset.original) btn.innerHTML = btn.dataset.original;
    delete btn.dataset.confirmar;
    btn.classList.remove('ring-2', 'ring-amber-400');
    return avanzarEstado(id, btn, ref, {
        desde: ESTADOS_POR_ENTREGAR,
        hacia: 'ENTREGADO',
        aviso: `Pedido #${ref} entregado al cliente.`,
    });
}

// id = clave de compras_proveedor (para el UPDATE); ref = pedido_id visible en los avisos
async function avanzarEstado(id, btn, ref, opciones) {
    const tarjeta = btn.closest('article');
    if (tarjeta?.dataset.procesando) return; // doble clic
    operacionesEnCurso += 1;
    try {
        await avanzarEstadoSeguro(id, btn, ref, opciones);
    } finally {
        operacionesEnCurso -= 1;
    }
}

async function avanzarEstadoSeguro(id, btn, ref, { desde, hacia, aviso }) {
    const tarjeta = btn.closest('article');
    const contenidoOriginal = btn.innerHTML;
    const filaActual = pedidos.get(String(id));

    // Spinner y bloqueo; Realtime ignora esta tarjeta mientras se procesa
    tarjeta.dataset.procesando = '1';
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-sm"></i> Procesando...';

    const cambios = { estado: hacia };
    // La hora de entrega solo se registra cuando el CLIENTE recibe (alimenta KPI, garantía y posventa)
    if (ESTADOS_ENTREGADOS.includes(hacia) && (filaActual?._prueba || tieneColumnaEntregado())) {
        cambios.entregado_at = new Date().toISOString();
    }

    let filaNueva;
    if (filaActual?._prueba) {
        await new Promise((r) => setTimeout(r, 500)); // simula la latencia de red
        filaNueva = { ...filaActual, ...cambios };
    } else {
        const { data, error } = await supabaseClient
            .from('compras_proveedor')
            .update(cambios)
            .eq('id', id)
            .in('estado', desde) // solo si sigue en el estado esperado
            .select('*');

        // Supabase no da error si RLS bloquea el update: devuelve 0 filas. Por eso se revisa data.length.
        if (error || !data || data.length === 0) {
            console.error(
                `Error al pasar el pedido #${ref} a ${hacia}:`,
                error ?? 'No se actualizó ninguna fila (el id no existe, cambió de estado, o RLS bloqueó el UPDATE).'
            );
            mostrarToast(`No se pudo actualizar el pedido #${ref}. Revisa la consola.`, 'error', 5000);
            Sonidos.error();
            delete tarjeta.dataset.procesando;
            btn.disabled = false;
            btn.innerHTML = contenidoOriginal;
            return;
        }
        filaNueva = data[0];
    }

    pedidos.set(String(id), filaNueva);
    pintarTabs();
    if (!filaNueva._prueba) programarNotificaciones();

    // Confirmación: badge del nuevo estado, botón "Listo"
    tarjeta.querySelector('.badge-estado').innerHTML = badgeEstado(hacia);
    tarjeta.classList.remove('glow-activo');
    tarjeta.classList.replace('ring-white/10', 'ring-emerald-500/50');
    btn.innerHTML = '<i class="fa-solid fa-check text-sm"></i> Listo';
    btn.classList.replace('bg-dcRed', 'bg-emerald-600');
    mostrarToast(aviso, 'ok');
    // Sin WhatsApp válido la BD no puede encolar la confirmación de entrega ni la reseña de 24 h
    if (ESTADOS_ENTREGADOS.includes(hacia) && !filaNueva._prueba && !PlantillasWA.normalizarNumero(filaNueva.cliente_whatsapp)) {
        mostrarToast(`#${ref} no tiene WhatsApp del cliente: no saldrá la confirmación automática. Agrégalo en "Editar".`, 'error', 7000);
    }
    Sonidos.completar();
    navigator.vibrate?.(20);

    await new Promise((r) => setTimeout(r, 650));
    if (coincideFiltro(filaNueva)) {
        // Sigue visible (pestaña "Todos"): reemplazar por la versión actualizada
        tarjeta.replaceWith(crearTarjeta(filaNueva));
    } else {
        retirarTarjeta(tarjeta);
    }
}

/* ==================== MODAL: QR DE WHATSAPP ==================== */

function abrirQR(p) {
    const lienzo = document.getElementById('qr-lienzo');
    const enlace = enlaceProveedor(p);
    document.getElementById('modal-qr-ref').textContent = `Pedido #${p.ref} · ${p.producto}`;
    document.getElementById('qr-abrir').href = enlace;

    lienzo.replaceChildren();
    if (typeof QRCode === 'function') {
        new QRCode(lienzo, { text: enlace, width: 220, height: 220, colorDark: '#0F111A', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    } else {
        lienzo.textContent = 'No se pudo cargar el generador de QR. Usa el botón de abajo.';
    }
    abrirModal(document.getElementById('modal-qr'));
}

/* ==================== MODAL DE EDICIÓN RÁPIDA ==================== */

function abrirEdicion(id) {
    const fila = pedidos.get(id);
    if (!fila) return;
    pedidoEditando = id;
    const p = normalizarPedido(fila);

    document.getElementById('modal-editar-ref').textContent = `Pedido #${p.ref} · compra ${p.id}${p.prueba ? ' · prueba' : ''}`;
    const inputClave = document.getElementById('editar-clave');
    inputClave.value = fila.clave_serial ?? '';
    inputClave.type = 'password';
    document.querySelector('[data-ojo="editar-clave"]').innerHTML = '<i class="fa-solid fa-eye"></i>';
    document.getElementById('editar-referencia').value = fila.referencia_externa ?? '';
    document.getElementById('editar-costo').value = fila.costo_real_cop ?? '';

    // Campos de WO-011: solo si la fila ya trae esas columnas (tras ejecutar supabase/wo-011.sql)
    const conWO011 = filaTieneWO011(fila);
    document.getElementById('campos-wo011').hidden = !conWO011;
    if (conWO011) {
        document.getElementById('editar-whatsapp').value = fila.cliente_whatsapp ?? '';
        document.getElementById('editar-garantia').value = fila.garantia_dias ?? GARANTIA_DIAS;
        const vence = leerCampo(fila, 'vencimiento', null);
        document.getElementById('editar-vencimiento').textContent = vence
            ? `Garantía vigente hasta ${formatearFecha(vence)}. Cambiar la clave o los días la recalcula.`
            : 'La fecha de vencimiento se calcula sola al asignar la clave / serial.';
    }

    abrirModal(document.getElementById('modal-editar'));
}

function filaTieneWO011(fila) {
    return Boolean(fila?._prueba) || (fila && 'cliente_whatsapp' in fila && 'garantia_dias' in fila);
}

function formatearFecha(valor) {
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? '—' : fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function guardarEdicion(e) {
    e.preventDefault();
    const id = pedidoEditando;
    if (!id) return;
    const btn = document.getElementById('btn-guardar-edicion');
    const costoTexto = document.getElementById('editar-costo').value.trim();
    const filaActual = pedidos.get(id);

    const cambios = {
        clave_serial: document.getElementById('editar-clave').value.trim() || null,
        referencia_externa: document.getElementById('editar-referencia').value.trim() || null,
        costo_real_cop: costoTexto === '' ? null : Number(costoTexto),
    };

    if (filaTieneWO011(filaActual)) {
        const whatsappTexto = document.getElementById('editar-whatsapp').value.trim();
        const whatsapp = whatsappTexto ? PlantillasWA.normalizarNumero(whatsappTexto) : null;
        if (whatsappTexto && !whatsapp) {
            mostrarToast('El WhatsApp no parece válido. Usa 10 dígitos (300…) o el número con indicativo.', 'error', 5000);
            document.getElementById('editar-whatsapp').focus();
            return;
        }
        cambios.cliente_whatsapp = whatsapp;
        const dias = Number.parseInt(document.getElementById('editar-garantia').value, 10);
        cambios.garantia_dias = Number.isFinite(dias) && dias >= 0 ? dias : GARANTIA_DIAS;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Guardando';

    let filaNueva;
    if (filaActual?._prueba) {
        filaNueva = { ...filaActual, ...cambios };
        // Imita el trigger de la BD: al asignar/cambiar clave o días se recalcula el vencimiento
        if (cambios.clave_serial && (cambios.clave_serial !== filaActual.clave_serial || cambios.garantia_dias !== filaActual.garantia_dias)) {
            filaNueva.fecha_vencimiento = new Date(Date.now() + (cambios.garantia_dias ?? GARANTIA_DIAS) * 86400000).toISOString();
        }
    } else {
        const { data, error } = await supabaseClient
            .from('compras_proveedor')
            .update(cambios)
            .eq('id', id)
            .select('*');

        if (error || !data || data.length === 0) {
            btn.disabled = false;
            btn.textContent = 'Guardar';
            console.error(`Error al editar la compra ${id}:`, error ?? 'No se actualizó ninguna fila (¿RLS?).');
            mostrarToast('No se pudieron guardar los cambios. Revisa la consola.', 'error', 5000);
            Sonidos.error();
            return;
        }
        filaNueva = data[0];
    }

    btn.disabled = false;
    btn.textContent = 'Guardar';
    pedidos.set(id, filaNueva);
    pintarTabs();

    const tarjeta = buscarTarjeta(id);
    if (tarjeta && coincideFiltro(filaNueva)) {
        const nueva = crearTarjeta(filaNueva);
        tarjeta.replaceWith(nueva);
        nueva.animate(
            [{ boxShadow: '0 0 0 2px rgba(16,185,129,.7), 0 0 40px rgba(16,185,129,.3)' }, { boxShadow: '0 0 0 0 rgba(16,185,129,0)' }],
            { duration: 1500, easing: 'ease-out' }
        );
    } else if (tarjeta) {
        retirarTarjeta(tarjeta); // p. ej. cambió de categoría y ya no coincide con el filtro
    }
    cerrarModal(document.getElementById('modal-editar'), { forzar: true });
    mostrarToast('Cambios guardados.', 'ok');
    Sonidos.completar();
}

/* ==================== VISTAS: PEDIDOS / PAGOS & BOT ==================== */

const CLASES_NAV_ACTIVA = ['bg-dcRed/15', 'ring-dcRed/40', 'text-white', 'font-bold', 'shadow-lg', 'shadow-red-600/10'];
const CLASES_NAV_INACTIVA = ['ring-transparent', 'text-neutral-400', 'hover:text-white', 'hover:bg-white/5', 'font-semibold'];

function mostrarVista(vista) {
    if (!['pedidos', 'pagos-bot', 'productos'].includes(vista)) return;
    const cambio = ui.vista !== vista;
    ui.vista = vista;
    document.getElementById('vista-pedidos').hidden = vista !== 'pedidos';
    document.getElementById('vista-pagos-bot').hidden = vista !== 'pagos-bot';
    if (vista === 'pagos-bot') cargarComprobantesWeb();
    document.getElementById('vista-productos').hidden = vista !== 'productos';
    if (vista === 'productos') { cargarPromociones(); cargarReglasCombo(); }
    pintarNavegacion();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.getElementById('zona-pedidos').scrollTo({ top: 0, behavior: 'smooth' });
    if (cambio) {
        document.getElementById(`vista-${vista}`).animate(
            [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }],
            { duration: 350, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
    }
}

/* ==================== PROMOCIONES DEL DÍA (public.promociones_dia · wo-025) ==================== */

const MAX_PROMOS = 12;
const TIPOS_PROMO = { streaming: 'Streaming', licencias: 'Licencias', pines: 'Pines', recargas: 'Recargas', tecnologia: 'Tecnología', servicios: 'Servicios', alquiler: 'Alquiler' };
const promo = { catalogo: [], activas: new Map(), filtro: 'todas', cargando: false, error: null, enCurso: new Set() };

async function cargarPromociones() {
    if (promo.cargando) return;
    promo.cargando = true;
    try {
        // El catálogo es el mismo archivo que publica la tienda
        if (!promo.catalogo.length) {
            const r = await fetch('productos.json', { cache: 'no-store' });
            if (!r.ok) throw new Error(`productos.json: HTTP ${r.status}`);
            promo.catalogo = await r.json();
        }
        const { data, error } = await supabaseClient.from('promociones_dia').select('producto_id, activa, vence_at');
        if (error) {
            promo.error = ['42P01', 'PGRST205'].includes(error.code)
                ? 'Ejecuta supabase/wo-025-promociones.sql para activar las promociones del día.'
                : `No se pudieron leer las promociones: ${error.message}`;
        } else {
            promo.error = null;
            const ahora = Date.now();
            promo.activas = new Map((data ?? [])
                .filter((p) => p.activa && new Date(p.vence_at).getTime() > ahora)
                .map((p) => [p.producto_id, p.vence_at]));
        }
    } catch (error) {
        console.error('Promociones:', error);
        promo.error = 'No se pudo cargar el catálogo (abre el panel desde el sitio o con Live Server).';
    } finally {
        promo.cargando = false;
    }
    pintarPromociones();
}

function pintarPromociones() {
    const caja = document.getElementById('promo-lista');
    if (!caja) return;
    const activas = promo.activas.size;
    document.getElementById('promo-resumen').innerHTML = `<i class="fa-solid fa-fire text-dcRed"></i> ${activas} de ${MAX_PROMOS} activas hoy`;
    document.querySelectorAll('[data-contador-promos]').forEach((el) => { el.textContent = activas; el.hidden = activas === 0; });
    document.getElementById('promo-aviso').innerHTML = promo.error ? filaVacia(promo.error, 'fa-triangle-exclamation') : '';

    const filtros = [['todas', 'Todas'], ['activas', `En promoción (${activas})`], ...Object.entries(TIPOS_PROMO)];
    document.getElementById('promo-filtros').replaceChildren(...filtros.map(([id, texto]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `shrink-0 min-h-[44px] px-3 rounded-xl ring-1 text-[11px] font-bold whitespace-nowrap ${promo.filtro === id ? 'bg-dcRed/15 ring-dcRed/50 text-white' : 'bg-white/[0.04] ring-white/10 text-neutral-400'}`;
        b.textContent = texto;
        b.addEventListener('click', () => { promo.filtro = id; pintarPromociones(); });
        return b;
    }));

    const termino = document.getElementById('promo-buscar').value.trim().toLowerCase();
    const lista = promo.catalogo.filter((p) => (promo.filtro === 'todas' || (promo.filtro === 'activas' ? promo.activas.has(p.id) : p.tipo === promo.filtro))
        && (!termino || `${p.nombre} ${p.marca}`.toLowerCase().includes(termino)))
        // Las activas primero
        .sort((a, b) => Number(promo.activas.has(b.id)) - Number(promo.activas.has(a.id)));

    if (!lista.length) {
        caja.innerHTML = filaVacia(promo.filtro === 'activas' ? 'No hay promociones activas hoy.' : 'Ningún producto coincide.', 'fa-box-open');
        return;
    }
    caja.replaceChildren(...lista.map(filaPromocion));
}

function filaPromocion(p) {
    const activa = promo.activas.has(p.id);
    const precios = (p.variantes ?? []).map((v) => Number(v.precio)).filter((n) => n > 0);
    const desc = Math.max(0, ...(p.variantes ?? []).map((v) => (Number(v.precio_anterior) > Number(v.precio) ? Math.round((1 - v.precio / v.precio_anterior) * 100) : 0)));
    const vence = activa ? new Date(promo.activas.get(p.id)).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }) : '';
    const fila = document.createElement('div');
    fila.className = `flex items-center gap-3 rounded-2xl ring-1 px-3 py-2.5 transition-colors ${activa ? 'bg-dcRed/10 ring-dcRed/40' : 'bg-dcDarkBg/60 ring-white/5'}`;
    fila.innerHTML = `
        <img src="${escaparHTML(p.imagen)}" alt="" loading="lazy" class="w-12 h-12 shrink-0 rounded-xl object-contain bg-[#121826] p-1">
        <div class="flex-1 min-w-0">
            <p class="text-sm font-bold text-white truncate">${escaparHTML(p.nombre)}</p>
            <p class="text-[11px] text-neutral-500 truncate">${escaparHTML(TIPOS_PROMO[p.tipo] ?? p.tipo)} · ${precios.length ? `desde ${escaparHTML(PlantillasWA.precioCOP(Math.min(...precios)))}` : 'a cotizar'}${desc ? ` · <b class="text-emerald-300">-${desc}%</b>` : ''}</p>
            ${activa ? `<p class="text-[10px] font-bold text-dcRed">En portada hasta las ${escaparHTML(vence)}</p>` : ''}
        </div>
        <button type="button" role="switch" aria-checked="${activa}" aria-label="Promoción del día: ${escaparHTML(p.nombre)}"
            class="relative shrink-0 w-14 h-8 rounded-full ring-1 transition-colors ${activa ? 'bg-dcRed ring-dcRed shadow-[0_0_14px_rgba(255,0,51,.5)]' : 'bg-white/10 ring-white/15'} disabled:opacity-50">
            <span class="absolute top-1 ${activa ? 'left-7' : 'left-1'} w-6 h-6 rounded-full bg-white shadow transition-all"></span>
        </button>`;
    fila.querySelector('button').addEventListener('click', (e) => alternarPromocion(p, !activa, e.currentTarget));
    return fila;
}

async function alternarPromocion(p, activar, boton) {
    if (promo.enCurso.has(p.id) || promo.error) return;
    if (activar && promo.activas.size >= MAX_PROMOS) {
        mostrarToast(`Máximo ${MAX_PROMOS} promociones a la vez: desactiva alguna primero.`, 'error', 5000);
        return;
    }
    promo.enCurso.add(p.id);
    boton.disabled = true;
    // Cambio optimista: se ve al instante y se revierte si la base lo rechaza
    const antes = promo.activas.get(p.id);
    if (activar) promo.activas.set(p.id, new Date(Date.now() + 3600e3).toISOString());
    else promo.activas.delete(p.id);
    pintarPromociones();

    const { data, error } = await supabaseClient.rpc('alternar_promocion', { p_producto_id: p.id, p_activa: activar }).maybeSingle();
    promo.enCurso.delete(p.id);
    if (error || !data?.ok) {
        console.error('alternar_promocion:', error ?? data);
        if (antes) promo.activas.set(p.id, antes); else promo.activas.delete(p.id);
        pintarPromociones();
        mostrarToast(data?.mensaje ?? (error?.code === 'PGRST202' ? 'Falta ejecutar supabase/wo-025-promociones.sql.' : 'No se pudo cambiar la promoción.'), 'error', 5000);
        Sonidos.error();
        return;
    }
    if (activar) promo.activas.set(p.id, data.vence_at);
    pintarPromociones();
    mostrarToast(activar ? `${p.nombre} está en la portada hasta la medianoche.` : `${p.nombre} salió de la portada.`, 'ok', 3500);
}

/* ==================== COMPROBANTES WEB (public.ordenes_web · wo-030) ==================== */

const ESTADOS_ORDEN_WEB = {
    ESPERANDO_PAGO: ['Sin comprobante', 'text-neutral-400'],
    COMPROBANTE_RECIBIDO: ['Por validar', 'text-sky-300'],
    RECHAZADO: ['Rechazado', 'text-red-300'],
};

async function cargarComprobantesWeb() {
    const caja = document.getElementById('comprobantes-web-lista');
    if (!caja) return;
    const { data, error } = await supabaseClient.from('ordenes_web')
        .select('codigo, whatsapp, nombre, items, total_declarado, metodo, red, cupon, estado, nota_admin, created_at, comprobantes_web(ruta, referencia, created_at)')
        .in('estado', ['COMPROBANTE_RECIBIDO', 'ESPERANDO_PAGO', 'RECHAZADO'])
        .order('created_at', { ascending: false })
        .limit(40);
    if (error) {
        caja.innerHTML = filaVacia(['42P01', 'PGRST205', 'PGRST200'].includes(error.code)
            ? 'Ejecuta supabase/wo-030-comprobantes.sql para recibir comprobantes desde el portal.'
            : `No se pudieron leer las órdenes web: ${error.message}`, 'fa-triangle-exclamation');
        return;
    }
    const porValidar = (data ?? []).filter((o) => o.estado === 'COMPROBANTE_RECIBIDO').length;
    const cuenta = document.getElementById('comprobantes-web-cuenta');
    cuenta.textContent = porValidar;
    cuenta.hidden = porValidar === 0;
    // Primero lo que tiene comprobante por validar
    const lista = (data ?? []).sort((a, b) => Number(b.estado === 'COMPROBANTE_RECIBIDO') - Number(a.estado === 'COMPROBANTE_RECIBIDO'));
    if (!lista.length) { caja.innerHTML = filaVacia('No hay comprobantes web pendientes.', 'fa-circle-check'); return; }
    caja.replaceChildren(...lista.map(tarjetaOrdenWeb));
}

function tarjetaOrdenWeb(o) {
    const [texto, color] = ESTADOS_ORDEN_WEB[o.estado] ?? [o.estado, 'text-neutral-300'];
    const comprobantes = [...(o.comprobantes_web ?? [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const t = document.createElement('article');
    t.className = 'rounded-2xl bg-dcDarkBg/50 ring-1 ring-white/10 p-4 space-y-3';
    t.innerHTML = `
        <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
                <p class="font-mono text-sm font-bold">${escaparHTML(o.codigo)} <span class="text-neutral-500 font-sans font-normal">· ${escaparHTML(new Date(o.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }))}</span></p>
                <p class="text-xs text-neutral-400 mt-0.5">+${escaparHTML(o.whatsapp)}${o.nombre ? ` · ${escaparHTML(o.nombre)}` : ''}</p>
            </div>
            <span class="text-xs font-bold ${color}">${escaparHTML(texto)}</span>
        </div>
        <ul class="text-xs text-neutral-300 space-y-0.5">${(o.items ?? []).map((i) => `<li>• ${escaparHTML(i.producto)}${i.variante ? ` – ${escaparHTML(i.variante)}` : ''}: ${escaparHTML(PlantillasWA.precioCOP(i.precio))}${i.combo ? ' <span class="text-dcRed">(combo)</span>' : ''}</li>`).join('')}</ul>
        <p class="text-sm"><b>Total declarado: ${escaparHTML(PlantillasWA.precioCOP(o.total_declarado))}</b> <span class="text-neutral-400">· ${escaparHTML(o.metodo)}${o.red ? ` (${escaparHTML(o.red)})` : ''}${o.cupon ? ` · cupón ${escaparHTML(o.cupon)}` : ''}</span></p>
        ${comprobantes.length ? `<div class="flex flex-wrap gap-2">${comprobantes.map((c, i) => `<button type="button" data-ver="${escaparHTML(c.ruta)}" class="min-h-[44px] px-3 rounded-xl bg-white/5 ring-1 ring-white/10 text-xs font-bold hover:ring-dcRed/50"><i class="fa-solid fa-file-image mr-1"></i> Comprobante ${comprobantes.length - i}${c.referencia ? ` · ref ${escaparHTML(c.referencia)}` : ''}</button>`).join('')}</div>` : '<p class="text-xs text-neutral-500">El cliente aún no sube el comprobante.</p>'}
        ${o.estado === 'RECHAZADO' && o.nota_admin ? `<p class="text-xs text-red-300">Motivo enviado: ${escaparHTML(o.nota_admin)}</p>` : ''}
        ${o.estado === 'COMPROBANTE_RECIBIDO' ? `
        <div class="flex flex-wrap gap-2">
            <input data-nota maxlength="300" placeholder="Motivo si lo rechazas (el cliente lo verá)" class="flex-1 min-w-[12rem] min-h-[44px] bg-dcDarkBg/70 ring-1 ring-white/10 rounded-xl px-3 text-base sm:text-sm text-white focus:outline-none focus:ring-2 focus:ring-dcRed/60">
            <button type="button" data-rechazar class="min-h-[44px] px-4 rounded-xl bg-white/5 ring-1 ring-white/10 text-xs font-bold text-red-300">Rechazar</button>
            <button type="button" data-validar class="min-h-[44px] px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold"><i class="fa-solid fa-check mr-1"></i> Validar</button>
        </div>` : ''}`;
    t.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', async () => {
        // Enlace firmado de 5 minutos: el bucket es privado
        const { data, error } = await supabaseClient.storage.from('comprobantes').createSignedUrl(b.dataset.ver, 300);
        if (error || !data?.signedUrl) { mostrarToast('No se pudo abrir el comprobante.', 'error'); return; }
        window.open(data.signedUrl, '_blank', 'noopener');
    }));
    const resolver = async (aprobar) => {
        const nota = t.querySelector('[data-nota]')?.value.trim() ?? '';
        const { data, error } = await supabaseClient.rpc('resolver_orden_web', { p_codigo: o.codigo, p_aprobar: aprobar, p_nota: nota || null }).maybeSingle();
        if (error || !data?.ok) { mostrarToast(data?.mensaje ?? 'No se pudo actualizar la orden.', 'error', 5000); Sonidos.error(); return; }
        mostrarToast(data.mensaje, 'ok', 5000);
        cargarComprobantesWeb();
    };
    t.querySelector('[data-validar]')?.addEventListener('click', () => resolver(true));
    t.querySelector('[data-rechazar]')?.addEventListener('click', () => resolver(false));
    return t;
}

/* ==================== DESCUENTO POR COMBO (public.reglas_combo · wo-029) ==================== */

const reglasCombo = { lista: [], error: null, nueva: false };

async function cargarReglasCombo() {
    const { data, error } = await supabaseClient.from('reglas_combo').select('min_plataformas, descuento_pct, activa').order('min_plataformas');
    reglasCombo.error = error
        ? (['42P01', 'PGRST205'].includes(error.code) ? 'Ejecuta supabase/wo-029-combos.sql para activar los descuentos por combo.' : `No se pudieron leer las reglas: ${error.message}`)
        : null;
    reglasCombo.lista = data ?? [];
    pintarReglasCombo();
}

function pintarReglasCombo() {
    const caja = document.getElementById('combo-reglas-lista');
    if (!caja) return;
    if (reglasCombo.error) { caja.innerHTML = filaVacia(reglasCombo.error, 'fa-triangle-exclamation'); return; }
    const filas = reglasCombo.lista.map((r) => filaReglaCombo(r));
    if (reglasCombo.nueva) filas.push(filaReglaCombo(null));
    if (!filas.length) { caja.innerHTML = filaVacia('Sin reglas: los combos se venden sin descuento.', 'fa-layer-group'); return; }
    caja.replaceChildren(...filas);
}

// Fila editable: mínimo de plataformas, % y activa. r = null → regla nueva
function filaReglaCombo(r) {
    const fila = document.createElement('form');
    fila.className = `flex flex-wrap items-end gap-2 rounded-2xl bg-dcDarkBg/50 ring-1 ${r?.activa === false ? 'ring-white/5 opacity-70' : 'ring-white/10'} p-3`;
    const campo = 'w-full min-h-[44px] bg-dcDarkBg/70 ring-1 ring-white/10 rounded-xl px-3 text-base sm:text-sm text-white focus:outline-none focus:ring-2 focus:ring-dcRed/60';
    fila.innerHTML = `
        <label class="flex-1 min-w-[6rem]"><span class="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Desde (plataformas)</span>
            <input name="min" type="number" min="2" max="10" step="1" required class="${campo}" value="${r ? r.min_plataformas : ''}" ${r ? 'readonly' : ''}></label>
        <label class="flex-1 min-w-[6rem]"><span class="block text-[10px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Descuento %</span>
            <input name="pct" type="number" min="0.1" max="50" step="0.1" required class="${campo}" value="${r ? Number(r.descuento_pct) : ''}"></label>
        <label class="flex items-center gap-2 min-h-[44px] text-xs font-bold text-neutral-300"><input name="activa" type="checkbox" class="w-5 h-5 accent-[#FF0033]" ${r?.activa === false ? '' : 'checked'}> Activa</label>
        <div class="flex gap-2">
            <button type="submit" class="min-h-[44px] px-4 rounded-xl bg-dcRed text-white text-xs font-bold" aria-label="Guardar regla"><i class="fa-solid fa-floppy-disk"></i></button>
            <button type="button" data-borrar class="min-h-[44px] px-4 rounded-xl bg-white/5 ring-1 ring-white/10 text-neutral-400 hover:text-red-300 text-xs font-bold" aria-label="${r ? 'Eliminar regla' : 'Cancelar'}"><i class="fa-solid ${r ? 'fa-trash-can' : 'fa-xmark'}"></i></button>
        </div>`;
    fila.addEventListener('submit', async (e) => {
        e.preventDefault();
        const min = Number(fila.min.value);
        const pct = Number(fila.pct.value);
        if (!r && reglasCombo.lista.some((x) => x.min_plataformas === min)) { mostrarToast(`Ya existe la regla de ${min} plataformas: edítala.`, 'error'); return; }
        const boton = fila.querySelector('[type="submit"]');
        boton.disabled = true;
        const { data, error } = await supabaseClient.rpc('guardar_regla_combo', { p_min: min, p_pct: pct, p_activa: fila.activa.checked }).maybeSingle();
        boton.disabled = false;
        if (error || !data?.ok) {
            mostrarToast(data?.mensaje ?? (error?.code === 'PGRST202' ? 'Falta ejecutar supabase/wo-029-combos.sql.' : 'No se pudo guardar la regla.'), 'error', 5000);
            Sonidos.error();
            return;
        }
        reglasCombo.nueva = false;
        mostrarToast(data.mensaje, 'ok');
        cargarReglasCombo();
    });
    fila.querySelector('[data-borrar]').addEventListener('click', async () => {
        if (!r) { reglasCombo.nueva = false; pintarReglasCombo(); return; }
        const boton = fila.querySelector('[data-borrar]');
        // Confirmación en dos toques (sin diálogos del navegador)
        if (boton.dataset.confirmar !== 'si') {
            boton.dataset.confirmar = 'si';
            boton.innerHTML = '¿Eliminar?';
            setTimeout(() => { if (boton.isConnected) { boton.dataset.confirmar = ''; boton.innerHTML = '<i class="fa-solid fa-trash-can"></i>'; } }, 3500);
            return;
        }
        const { data, error } = await supabaseClient.rpc('eliminar_regla_combo', { p_min: r.min_plataformas }).maybeSingle();
        if (error || !data?.ok) { mostrarToast(data?.mensaje ?? 'No se pudo eliminar la regla.', 'error'); return; }
        mostrarToast(data.mensaje, 'ok');
        cargarReglasCombo();
    });
    return fila;
}

function pintarNavegacion() {
    document.querySelectorAll('[data-vista]').forEach((btn) => {
        const activa = btn.dataset.vista === ui.vista;
        btn.classList.remove(...CLASES_NAV_ACTIVA, ...CLASES_NAV_INACTIVA);
        btn.classList.add(...(activa ? CLASES_NAV_ACTIVA : CLASES_NAV_INACTIVA));
        btn.querySelector('i').classList.toggle('text-dcRed', activa);
        btn.setAttribute('aria-current', activa ? 'page' : 'false');
    });
    document.querySelectorAll('[data-vista-dock]').forEach((btn) => {
        const activa = btn.dataset.vistaDock === ui.vista;
        btn.classList.toggle('text-dcRed', activa);
        btn.classList.toggle('text-neutral-400', !activa);
    });
}

// Pinta todo lo que depende de los pedidos en la vista Pagos & Bot
function pintarPagosBot() {
    if (!document.getElementById('vista-pagos-bot')) return;
    const filas = [...pedidos.values()];
    const porVerificar = filas.filter((fila) => fila.estado === ESTADO_PENDIENTE_PAGO);
    // Pendientes = comprobantes recibidos + compras esperando pago sin comprobante
    const conComprobante = new Set(pagosPendientes.map((pago) => String(pago.pedido_id)));
    const totalPorVerificar = pagosPendientes.length
        + porVerificar.filter((fila) => !conComprobante.has(String(fila.pedido_id))).length;

    document.getElementById('kpi-por-verificar').textContent = totalPorVerificar;
    document.querySelectorAll('[data-contador-verificar]').forEach((el) => {
        el.textContent = totalPorVerificar;
        el.hidden = totalPorVerificar === 0;
    });

    pintarPorVerificar(porVerificar);
    pintarFidelizacion(filas);
}

function filaVacia(texto, icono = 'fa-circle-check') {
    return `<p class="flex items-center gap-2 rounded-2xl bg-dcDarkBg/40 ring-1 ring-white/5 px-4 py-3 text-xs text-neutral-500"><i class="fa-solid ${icono}"></i> ${escaparHTML(texto)}</p>`;
}

/* ==================== MÉTODOS DE PAGO (public.metodos_pago · supabase/wo-027-metodos-pago.sql) ==================== */

// El catálogo de tipos (íconos, campos, redes) vive en plantillas-whatsapp.js: el mismo para tienda, bot y panel
const WA_PAGO = PlantillasWA;
const nombreMetodo = (fila) => fila.banco_alias || WA_PAGO.tipoPago(fila.tipo)?.nombre || 'Método sin nombre';
const textoMetodo = (valor) => WA_PAGO.tipoPago(valor)?.nombre ?? valor ?? '';
let metodoEditando = null; // id del método abierto en el modal (null = nuevo)

async function cargarMetodosPago() {
    const caja = document.getElementById('lista-metodos-pago');
    caja.innerHTML = '<div class="skeleton h-16 rounded-2xl"></div><div class="skeleton h-16 rounded-2xl"></div>';
    const { data, error } = await supabaseClient.from('metodos_pago').select('*');
    if (error) {
        console.error('Error al cargar metodos_pago:', error);
        metodosPago = [];
        caja.innerHTML = filaVacia(`No se pudo leer metodos_pago: ${error.message}`, 'fa-triangle-exclamation');
        return;
    }
    metodosPago = (data ?? []).sort((a, b) => String(a.categoria).localeCompare(String(b.categoria)) || (a.orden ?? 0) - (b.orden ?? 0));
    pintarMetodosPago();
}

// Estado de la tasa de un método cripto (el bot no cotiza con tasas de más de 24 h)
function estadoTasa(fila) {
    if (fila.categoria !== 'cripto') return null;
    if (!(Number(fila.tasa_cop) > 0)) return { texto: 'Sin tasa: el bot no cotiza en cripto', clase: 'text-amber-300' };
    const horas = (Date.now() - new Date(fila.tasa_actualizada_at).getTime()) / 3600e3;
    const tasa = `1 ${fila.moneda} = ${WA_PAGO.precioCOP(fila.tasa_cop)}`;
    return horas < 24
        ? { texto: `${tasa} · hace ${Math.max(0, Math.floor(horas))} h`, clase: 'text-emerald-300' }
        : { texto: `${tasa} · vencida (actualízala)`, clase: 'text-red-300' };
}

function pintarMetodosPago() {
    const caja = document.getElementById('lista-metodos-pago');
    if (metodosPago.length === 0) {
        caja.innerHTML = filaVacia('Aún no hay métodos de pago. Toca "Agregar" para crear el primero.', 'fa-circle-info');
        return;
    }
    const grupos = Object.entries(WA_PAGO.CATEGORIAS_PAGO).map(([cat, titulo]) => [titulo, metodosPago.filter((m) => (m.categoria ?? 'electronico') === cat)]).filter(([, l]) => l.length);
    caja.replaceChildren(...grupos.flatMap(([titulo, lista]) => {
        const encabezado = document.createElement('p');
        encabezado.className = 'pt-2 text-[10px] font-black uppercase tracking-widest text-neutral-500';
        encabezado.textContent = titulo;
        return [encabezado, ...lista.map(itemMetodo)];
    }));
}

function itemMetodo(fila) {
    const tipo = WA_PAGO.tipoPago(fila.tipo);
    const activo = fila.activo !== false;
    const tasa = estadoTasa(fila);
    const dato = fila.numero_cuenta || fila.url_pago || '';
    const item = document.createElement('div');
    item.className = `flex items-center gap-3 rounded-2xl bg-dcDarkBg/60 ring-1 ${activo ? 'ring-emerald-500/30' : 'ring-white/5 opacity-70'} px-3 py-3`;
    item.innerHTML = `
        <span class="shrink-0 w-10 h-10 grid place-items-center rounded-xl text-white" style="background:${escaparHTML(tipo?.color ?? '#475569')}"><i class="${escaparHTML(tipo?.icono ?? 'fa-solid fa-wallet')}"></i></span>
        <div class="flex-1 min-w-0">
            <p class="text-sm font-bold text-white truncate">${escaparHTML(nombreMetodo(fila))}
                ${fila.categoria === 'cripto' ? `<span class="ml-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-300 text-[9px] font-black">${escaparHTML(fila.moneda ?? '')} · ${escaparHTML(fila.red ?? '')}</span>` : ''}</p>
            <p class="text-xs font-mono text-neutral-300 truncate" title="${escaparHTML(dato)}">${escaparHTML(dato || 'Sin datos')}</p>
            ${tasa ? `<p class="text-[10px] font-bold ${tasa.clase}">${escaparHTML(tasa.texto)}</p>` : ''}
        </div>
        ${dato ? '<button type="button" data-copiar aria-label="Copiar" class="btn-cyber shrink-0 w-10 h-10 grid place-items-center rounded-xl bg-white/[0.04] ring-1 ring-white/10 text-neutral-300"><i class="fa-regular fa-copy"></i></button>' : ''}
        <button type="button" data-editar aria-label="Editar ${escaparHTML(nombreMetodo(fila))}" class="btn-cyber shrink-0 w-10 h-10 grid place-items-center rounded-xl bg-white/[0.04] ring-1 ring-white/10 text-neutral-300"><i class="fa-solid fa-pen"></i></button>
        <button type="button" data-alternar role="switch" aria-checked="${activo}" aria-label="${activo ? 'Desactivar' : 'Activar'} ${escaparHTML(nombreMetodo(fila))}"
            class="shrink-0 min-h-[40px] px-3 rounded-xl text-[10px] font-black uppercase tracking-wider ring-1 ${activo ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30' : 'bg-white/[0.04] text-neutral-400 ring-white/10'}">${activo ? 'Activo' : 'Inactivo'}</button>`;
    item.querySelector('[data-copiar]')?.addEventListener('click', () => copiarTexto(String(dato), `${nombreMetodo(fila)}: copiado`));
    item.querySelector('[data-editar]').addEventListener('click', () => abrirMetodo(fila));
    item.querySelector('[data-alternar]').addEventListener('click', (e) => alternarMetodo(fila, !activo, e.currentTarget));
    return item;
}

async function alternarMetodo(fila, activar, boton) {
    if (activar && fila.categoria === 'cripto' && !WA_PAGO.direccionValida(fila.red, fila.numero_cuenta)) {
        mostrarToast('La dirección no coincide con su red: edítala antes de activarla.', 'error', 6000);
        return;
    }
    boton.disabled = true;
    const { data, error } = await supabaseClient.rpc('estado_metodo_pago', { p_id: fila.id, p_activo: activar }).maybeSingle();
    boton.disabled = false;
    if (error || !data?.ok) {
        console.error('estado_metodo_pago:', error ?? data);
        mostrarToast(error?.code === 'PGRST202' ? 'Ejecuta supabase/wo-027-metodos-pago.sql.' : data?.mensaje ?? 'No se pudo cambiar el método.', 'error', 5000);
        return;
    }
    mostrarToast(`${nombreMetodo(fila)} ${activar ? 'activado: ya aparece en la tienda y el bot lo comparte' : 'desactivado'}.`, 'ok', 4500);
    cargarMetodosPago();
}

/* ---------- Modal crear / editar ---------- */

const $m = (id) => document.getElementById(id);

function prepararSelectTipos() {
    const select = $m('metodo-tipo');
    if (select.options.length) return;
    select.innerHTML = Object.entries(WA_PAGO.CATEGORIAS_PAGO).map(([cat, titulo]) => `<optgroup label="${escaparHTML(titulo)}">${
        WA_PAGO.TIPOS_PAGO.filter((t) => t.categoria === cat).map((t) => `<option value="${t.tipo}">${escaparHTML(t.nombre)}</option>`).join('')}</optgroup>`).join('');
    select.addEventListener('change', () => ajustarFormularioMetodo());
    $m('metodo-red').addEventListener('change', () => ajustarFormularioMetodo({ conservarMoneda: true }));
    $m('metodo-moneda').addEventListener('change', () => { $m('metodo-tasa-moneda').textContent = $m('metodo-moneda').value; });
    $m('metodo-numero').addEventListener('input', validarDatoMetodo);
}

function ajustarFormularioMetodo({ conservarMoneda = false } = {}) {
    const tipo = WA_PAGO.tipoPago($m('metodo-tipo').value);
    const cripto = tipo.categoria === 'cripto';
    $m('metodo-bloque-cripto').hidden = !cripto;
    $m('metodo-bloque-memo').hidden = !cripto || tipo.tipo === 'BINANCE_PAY';
    $m('metodo-bloque-tasa').hidden = !cripto;
    if (cripto) {
        const redActual = $m('metodo-red').value;
        $m('metodo-red').innerHTML = tipo.redes.map((r) => `<option value="${r}">${r === 'BINANCE_PAY' ? 'Binance Pay (interna)' : r}</option>`).join('');
        if (tipo.redes.includes(redActual)) $m('metodo-red').value = redActual;
        if (!conservarMoneda) $m('metodo-moneda').innerHTML = tipo.monedas.map((mo) => `<option value="${mo}">${mo}</option>`).join('');
        $m('metodo-tasa-moneda').textContent = $m('metodo-moneda').value;
    }
    $m('metodo-numero-etiqueta').textContent = tipo.campo;
    $m('metodo-bloque-numero').hidden = Boolean(tipo.requiereUrl);
    $m('metodo-url-etiqueta').textContent = tipo.requiereUrl ? 'Enlace de pago (obligatorio, https)' : 'Enlace de pago (opcional)';
    const aviso = $m('metodo-aviso-red');
    const red = $m('metodo-red').value;
    aviso.classList.toggle('hidden', !cripto || red === 'BINANCE_PAY');
    aviso.innerHTML = cripto ? `<i class="fa-solid fa-triangle-exclamation mr-1"></i> El bot exigirá al cliente enviar <b>solo ${escaparHTML($m('metodo-moneda').value)} por la red ${escaparHTML(red)}</b>. Un envío por otra red se pierde y no se puede recuperar.` : '';
    validarDatoMetodo();
}

// Valida en vivo: formato de la dirección según la red (cripto) o celular colombiano (Nequi / Daviplata)
function validarDatoMetodo() {
    const tipo = WA_PAGO.tipoPago($m('metodo-tipo').value);
    const valor = $m('metodo-numero').value.trim();
    const estado = $m('metodo-numero-estado');
    let ok = true;
    let texto = '';
    if (tipo.categoria === 'cripto' && valor) {
        ok = WA_PAGO.direccionValida($m('metodo-red').value, valor);
        texto = ok ? `✓ Formato válido para ${$m('metodo-red').value}` : `✗ No es una dirección de la red ${$m('metodo-red').value}`;
    } else if (['NEQUI', 'DAVIPLATA'].includes(tipo.tipo) && valor) {
        ok = /^3\d{9}$/.test(valor.replace(/\D/g, ''));
        texto = ok ? '✓ Celular válido' : '✗ Debe ser un celular de 10 dígitos (3xx…)';
    }
    estado.textContent = texto;
    estado.className = `mt-1.5 block text-[11px] font-bold ${ok ? 'text-emerald-300' : 'text-red-300'}`;
    return ok;
}

function abrirMetodo(fila = null) {
    prepararSelectTipos();
    metodoEditando = fila?.id ?? null;
    $m('modal-metodo-titulo').textContent = fila ? 'Editar método' : 'Nuevo método';
    $m('metodo-tipo').value = fila?.tipo && WA_PAGO.tipoPago(fila.tipo) ? fila.tipo : 'NEQUI';
    ajustarFormularioMetodo();
    if (fila?.moneda) $m('metodo-moneda').value = fila.moneda;
    if (fila?.red) $m('metodo-red').value = fila.red;
    ajustarFormularioMetodo({ conservarMoneda: true });
    $m('metodo-nombre').value = fila?.banco_alias ?? '';
    $m('metodo-numero').value = fila?.numero_cuenta ?? '';
    $m('metodo-titular').value = fila?.titular ?? '';
    $m('metodo-memo').value = fila?.memo ?? '';
    $m('metodo-url').value = fila?.url_pago ?? '';
    $m('metodo-qr').value = fila?.qr_url ?? '';
    $m('metodo-tasa').value = fila?.tasa_cop ?? '';
    $m('metodo-instrucciones').value = fila?.instrucciones ?? '';
    $m('metodo-activo').checked = fila ? fila.activo !== false : false;
    validarDatoMetodo();
    abrirModal($m('modal-metodo'));
}

async function guardarMetodo(e) {
    e.preventDefault();
    const tipo = WA_PAGO.tipoPago($m('metodo-tipo').value);
    const datos = {
        tipo: tipo.tipo,
        banco_alias: $m('metodo-nombre').value.trim() || tipo.nombre,
        numero_cuenta: tipo.requiereUrl ? null : $m('metodo-numero').value.trim(),
        titular: $m('metodo-titular').value.trim(),
        moneda: tipo.categoria === 'cripto' ? $m('metodo-moneda').value : null,
        red: tipo.categoria === 'cripto' ? $m('metodo-red').value : null,
        memo: $m('metodo-memo').value.trim(),
        url_pago: $m('metodo-url').value.trim(),
        qr_url: $m('metodo-qr').value.trim(),
        tasa_cop: tipo.categoria === 'cripto' ? $m('metodo-tasa').value : '',
        instrucciones: $m('metodo-instrucciones').value.trim(),
        activo: $m('metodo-activo').checked,
    };
    // Mismas reglas que la base: primero en el navegador para dar el error al instante
    const errores = [];
    if (tipo.requiereUrl && !/^https:\/\//.test(datos.url_pago)) errores.push('El enlace de pago debe empezar por https://');
    if (!tipo.requiereUrl && !datos.numero_cuenta) errores.push(`Falta: ${tipo.campo}`);
    if (!validarDatoMetodo()) errores.push('El dato no tiene un formato válido.');
    for (const url of [datos.url_pago, datos.qr_url]) if (url && !/^https:\/\//.test(url)) errores.push('Los enlaces deben empezar por https://');
    if (errores.length) {
        mostrarToast(errores[0], 'error', 6000);
        return;
    }
    const boton = $m('btn-guardar-metodo');
    boton.disabled = true;
    const { data, error } = await supabaseClient.rpc('guardar_metodo_pago', { p_id: metodoEditando, p_datos: datos }).maybeSingle();
    boton.disabled = false;
    if (error || !data?.ok) {
        console.error('guardar_metodo_pago:', error ?? data);
        mostrarToast(error?.code === 'PGRST202' ? 'Ejecuta supabase/wo-027-metodos-pago.sql para gestionar métodos.' : data?.mensaje ?? `No se pudo guardar: ${error?.message ?? ''}`, 'error', 7000);
        return;
    }
    cerrarModal($m('modal-metodo'), { forzar: true });
    mostrarToast(data.mensaje, 'ok', 4000);
    cargarMetodosPago();
}

/* ==================== REGISTRO Y VALIDACIÓN DE PAGOS (tabla public.pagos) ==================== */

// Comprobantes PENDIENTE que dejó n8n (o el cliente) en public.pagos
async function cargarPagosPendientes() {
    const { data, error } = await supabaseClient.rpc('pagos_pendientes');
    if (error) {
        console.error('pagos_pendientes:', error);
        pagosPendientes = [];
        errorPagos = error.code === 'PGRST202'
            ? 'Falta ejecutar supabase/wo-014-pagos.sql.'
            : `No se pudieron leer los pagos: ${error.message}`;
    } else {
        pagosPendientes = data ?? [];
        errorPagos = null;
    }
    pintarPagosBot();
}

function pintarPorVerificar(porVerificar) {
    const caja = document.getElementById('lista-por-verificar');
    const items = [];

    if (errorPagos) items.push(htmlANodo(filaVacia(errorPagos, 'fa-database')));

    // a) Comprobantes recibidos (pagos PENDIENTE): aprobar o rechazar
    pagosPendientes.forEach((pago) => {
        const item = document.createElement('div');
        item.className = 'rounded-2xl bg-dcDarkBg/60 ring-1 ring-sky-500/30 px-4 py-3 space-y-3';
        const alertas = pago.alertas && !['null', '[]', '{}', ''].includes(pago.alertas) ? pago.alertas : null;
        item.innerHTML = `
            <div class="flex items-start gap-3">
                <div class="flex-1 min-w-0">
                    <p class="text-[10px] font-black uppercase tracking-widest text-sky-300">Comprobante · ${escaparHTML(textoMetodo(pago.metodo))} · ${escaparHTML(pago.origen)}</p>
                    <p class="text-sm font-bold text-white truncate">${escaparHTML(pago.producto ?? 'Sin compra en PENDIENTE_PAGO')}</p>
                    <p class="text-[11px] text-neutral-400">
                        Declarado: <b class="text-neutral-200">${escaparHTML(PlantillasWA.precioCOP(pago.monto_declarado_cop))}</b>
                        ${pago.referencia ? ` · Ref. <span class="font-mono">${escaparHTML(pago.referencia)}</span>` : ''}
                    </p>
                    ${alertas ? `<p class="mt-1 text-[11px] text-amber-300"><i class="fa-solid fa-triangle-exclamation mr-1"></i>${escaparHTML(alertas)}</p>` : ''}
                </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <button type="button" data-aprobar ${pago.compra_id ? '' : 'disabled'} class="btn-cyber min-h-[44px] rounded-xl bg-sky-600 hover:bg-sky-500 text-[11px] font-black uppercase tracking-wider text-white disabled:opacity-40 disabled:cursor-not-allowed">
                    <i class="fa-solid fa-check mr-1"></i> Revisar y aprobar
                </button>
                <button type="button" data-rechazar class="btn-cyber min-h-[44px] rounded-xl bg-white/[0.04] ring-1 ring-red-500/40 text-[11px] font-black uppercase tracking-wider text-red-300">
                    <i class="fa-solid fa-xmark mr-1"></i> Rechazar
                </button>
            </div>
            <form data-form-rechazo class="flex gap-2" hidden>
                <input type="text" required maxlength="300" placeholder="Motivo del rechazo (lo verá el equipo)" class="min-w-0 flex-1 min-h-[44px] rounded-xl bg-dcDarkCard ring-1 ring-white/10 px-3 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-red-500/60">
                <button type="submit" class="shrink-0 min-h-[44px] px-3 rounded-xl bg-red-600 hover:bg-red-500 text-[11px] font-black uppercase text-white">Confirmar</button>
            </form>`;
        item.querySelector('[data-aprobar]').addEventListener('click', () => abrirPago(pago.compra_id, pago));
        const formRechazo = item.querySelector('[data-form-rechazo]');
        item.querySelector('[data-rechazar]').addEventListener('click', () => {
            formRechazo.hidden = !formRechazo.hidden;
            if (!formRechazo.hidden) formRechazo.querySelector('input').focus();
        });
        formRechazo.addEventListener('submit', (e) => {
            e.preventDefault();
            rechazarPago(pago, formRechazo.querySelector('input').value);
        });
        items.push(item);
    });

    // b) Compras en PENDIENTE_PAGO sin comprobante recibido: registro manual
    const pedidosConComprobante = new Set(pagosPendientes.map((pago) => String(pago.pedido_id)));
    porVerificar
        .filter((fila) => !pedidosConComprobante.has(String(fila.pedido_id)))
        .forEach((fila) => {
            const p = normalizarPedido(fila);
            const item = document.createElement('div');
            item.className = 'flex items-center gap-3 rounded-2xl bg-dcDarkBg/60 ring-1 ring-white/10 px-4 py-3';
            item.innerHTML = `
                <div class="flex-1 min-w-0">
                    <p class="text-[10px] font-black uppercase tracking-widest text-neutral-400">Sin comprobante · Pedido #${escaparHTML(p.ref)}${p.prueba ? ' · prueba' : ''}</p>
                    <p class="text-sm font-bold text-white truncate">${escaparHTML(p.producto)}</p>
                    <p class="text-[11px] text-neutral-500">${escaparHTML(p.fecha)}</p>
                </div>
                <button type="button" class="btn-cyber shrink-0 min-h-[44px] px-4 rounded-xl bg-white/[0.04] ring-1 ring-sky-500/40 text-[11px] font-black uppercase tracking-wider text-sky-300">
                    <i class="fa-solid fa-pen mr-1"></i> Registrar manual
                </button>`;
            item.querySelector('button').addEventListener('click', () => abrirPago(String(p.id)));
            items.push(item);
        });

    if (items.length === 0) {
        caja.innerHTML = filaVacia('No hay pagos por verificar.');
        return;
    }
    caja.replaceChildren(...items);
}

function htmlANodo(html) {
    const plantilla = document.createElement('template');
    plantilla.innerHTML = html.trim();
    return plantilla.content.firstElementChild;
}

// pago = comprobante PENDIENTE de public.pagos (si se abre desde "Revisar y aprobar"); null = registro manual
function abrirPago(id, pago = null) {
    const fila = pedidos.get(String(id));
    if (!fila) {
        mostrarToast('La compra de este pedido no está cargada en el panel. Actualiza la lista.', 'error', 5000);
        return;
    }
    if (!fila._prueba && !fila.pedido_id) {
        mostrarToast('Esta compra no tiene pedido_id: no se puede asociar el pago.', 'error', 6000);
        return;
    }
    pedidoPagando = String(id);
    const p = normalizarPedido(fila);
    document.getElementById('modal-pago-ref').textContent = pago
        ? `Comprobante ${pago.origen} · Pedido #${p.ref} · ${p.producto}`
        : `Registro manual · Pedido #${p.ref} · ${p.producto}`;

    // Solo los valores del enum public.metodo_pago
    const activos = [...new Set(metodosPago.filter((m) => m.activo !== false && m.tipo).map((m) => m.tipo))];
    const opciones = (activos.length ? activos : PlantillasWA.TIPOS_PAGO.map((t) => t.tipo))
        .concat(pago?.metodo && !activos.includes(pago.metodo) ? [pago.metodo] : [])
        .filter((v, i, a) => a.indexOf(v) === i)
        .map((valor) => ({ valor, texto: textoMetodo(valor) }));
    document.getElementById('pago-metodos').innerHTML = opciones.map(({ valor, texto }, i) => `
        <label class="cursor-pointer">
            <input type="radio" name="pago-metodo" value="${valor}" class="peer sr-only" ${i === 0 ? 'required' : ''} ${pago?.metodo === valor ? 'checked' : ''}>
            <span class="flex items-center justify-center text-center min-h-[48px] px-2 rounded-2xl bg-dcDarkBg/70 ring-1 ring-white/10 text-[11px] font-bold text-neutral-300 peer-checked:bg-dcRed/15 peer-checked:ring-dcRed/60 peer-checked:text-white peer-focus-visible:ring-2 transition-all">
                ${texto}
            </span>
        </label>`).join('');

    document.getElementById('pago-cupon').value = fila.cupon_aplicado ?? '';
    document.getElementById('pago-cupon').disabled = Boolean(fila.cupon_aplicado);
    document.getElementById('pago-referencia').value = pago?.referencia ?? '';
    // El monto se escribe tras verificarlo en la app del banco (no se copia el declarado)
    document.getElementById('pago-monto').value = '';
    document.getElementById('pago-monto').placeholder = pago?.monto_declarado_cop
        ? `Declarado: ${pago.monto_declarado_cop} — escribe el verificado` : 'Ej: 15000';
    document.getElementById('pago-confirmo').checked = false;
    // "Entregar ya" solo si ya hay cuenta/serial asignado: el admin decide (modo sombra)
    document.getElementById('btn-pago-entregar').hidden = !fila.clave_serial;

    abrirModal(document.getElementById('modal-pago'));
}

async function guardarPago(e) {
    e.preventDefault();
    const id = pedidoPagando;
    const filaActual = pedidos.get(id);
    if (!filaActual) return;

    const destino = e.submitter?.dataset.destino ?? ESTADO_PENDIENTE;
    const metodo = document.querySelector('input[name="pago-metodo"]:checked')?.value;
    const referencia = document.getElementById('pago-referencia').value.trim();
    const monto = Number(document.getElementById('pago-monto').value);
    if (!metodo || !referencia || !(monto > 0)) {
        mostrarToast('Completa método, referencia y monto verificado.', 'error');
        return;
    }

    const botones = document.querySelectorAll('#form-pago button[type="submit"]');
    botones.forEach((b) => { b.disabled = true; });
    e.submitter?.insertAdjacentHTML('afterbegin', '<i class="fa-solid fa-spinner fa-spin mr-2" data-cargando></i>');
    const restaurarBotones = () => {
        botones.forEach((b) => { b.disabled = false; });
        document.querySelector('#form-pago [data-cargando]')?.remove();
    };

    // Cupón: se verifica y consume en la base ANTES de validar el pago (si no es válido, no se valida)
    const cupon = document.getElementById('pago-cupon').value.trim().toUpperCase();
    if (cupon && !filaActual.cupon_aplicado && !filaActual._prueba) {
        const { data: canje, error: errorCanje } = await supabaseClient.rpc('canjear_cupon', { p_codigo: cupon, p_compra_id: id }).maybeSingle();
        if (errorCanje || !canje?.ok) {
            restaurarBotones();
            console.error('canjear_cupon:', errorCanje ?? canje);
            mostrarToast(canje?.mensaje ?? 'No se pudo verificar el cupón (¿ejecutaste supabase/wo-012.sql?).', 'error', 6000);
            Sonidos.error();
            return;
        }
        mostrarToast(`${canje.mensaje} (-${canje.porcentaje}%)`, 'ok', 4000);
        // El canje ya quedó en la BD: si validar_pago falla y se reintenta, no se vuelve a canjear
        // (la BD respondería "ya tiene un cupón aplicado" y bloquearía el pago)
        pedidos.set(id, { ...filaActual, cupon_aplicado: cupon });
    }

    let filasActualizadas;
    if (filaActual._prueba) {
        await new Promise((r) => setTimeout(r, 400));
        const ahora = new Date().toISOString();
        filasActualizadas = [{
            ...filaActual,
            estado: destino,
            pago_validado_at: ahora,
            ...(destino === 'ENTREGADO_INMEDIATO' ? { entregado_at: ahora } : {}),
            ...(cupon ? { cupon_aplicado: cupon } : {}),
        }];
    } else {
        // Aprueba el comprobante en 'pagos' y avanza las compras del pedido en una sola transacción
        const { data: r, error } = await supabaseClient.rpc('validar_pago', {
            p_compra_id: id,
            p_metodo: metodo,
            p_referencia: referencia,
            p_monto: monto,
            p_destino: destino,
        }).maybeSingle();

        if (error || !r?.ok) {
            restaurarBotones();
            console.error(`validar_pago (compra ${id}):`, error ?? r);
            const mensaje = error?.code === 'PGRST202' ? 'Falta ejecutar supabase/wo-014-pagos.sql.'
                : error?.code === '23505' ? 'Esa referencia ya fue aprobada en otro pago.'
                : r?.mensaje ?? 'No se pudo validar el pago. Revisa la consola.';
            mostrarToast(mensaje, 'error', 6000);
            Sonidos.error();
            return;
        }

        // Releer todas las compras del pedido (pudieron avanzar varias)
        const { data: filas, error: errorFilas } = await supabaseClient
            .from('compras_proveedor').select('*').eq('pedido_id', filaActual.pedido_id);
        if (errorFilas) console.error('Releer compras del pedido:', errorFilas);
        filasActualizadas = filas?.length ? filas : [];
    }

    restaurarBotones();
    filasActualizadas.forEach((fila) => pedidos.set(String(fila.id), fila));
    renderLista();
    cargarPagosPendientes();
    programarNotificaciones();

    cerrarModal(document.getElementById('modal-pago'), { forzar: true });
    const p = normalizarPedido(filaActual);
    mostrarToast(destino === 'ENTREGADO_INMEDIATO'
        ? `Pago aprobado y pedido #${p.ref} entregado.`
        : `Pago aprobado: pedido #${p.ref} pasa a esperar proveedor.`, 'ok', 4500);
    Sonidos.completar();
}

const rechazosEnCurso = new Set();

async function rechazarPago(pago, motivo) {
    if (rechazosEnCurso.has(pago.pago_id)) return;
    rechazosEnCurso.add(pago.pago_id);
    operacionesEnCurso += 1;
    try {
        await rechazarPagoSeguro(pago, motivo);
    } finally {
        rechazosEnCurso.delete(pago.pago_id);
        operacionesEnCurso -= 1;
    }
}

async function rechazarPagoSeguro(pago, motivo) {
    const { data: r, error } = await supabaseClient.rpc('rechazar_pago', { p_pago_id: pago.pago_id, p_motivo: motivo }).maybeSingle();
    if (error || !r?.ok) {
        console.error('rechazar_pago:', error ?? r);
        mostrarToast(r?.mensaje ?? 'No se pudo rechazar el pago. Revisa la consola.', 'error', 5000);
        Sonidos.error();
        return;
    }
    mostrarToast('Comprobante rechazado. La compra sigue esperando un pago válido.', 'ok', 4500);
    cargarPagosPendientes();
}

/* ==================== FIDELIZACIÓN (posventa) ==================== */

const COLUMNA_ENVIO = { satisfaccion: 'satisfaccion_enviada_at', renovacion: 'renovacion_enviada_at', cupon: 'cupon_enviado_at' };

// Momento desde el que se cuenta la posventa: entrega → validación del pago → creación
function momentoEntrega(fila) {
    return new Date(leerCampo(fila, 'entregado', null) ?? fila.pago_validado_at ?? leerCampo(fila, 'fecha', null)).getTime();
}

function colasFidelizacion(filas) {
    const ahora = Date.now();
    // Solo compras entregadas (nunca fallidas, canceladas o en curso)
    const candidatas = filas.filter((fila) => !fila._prueba && esEntregado(fila) && PlantillasWA.normalizarNumero(fila.cliente_whatsapp));

    return {
        satisfaccion: candidatas.filter((fila) => {
            const horas = (ahora - momentoEntrega(fila)) / 3600000;
            return !fila.satisfaccion_enviada_at && horas >= HORAS_SATISFACCION && horas <= DIAS_MAX_SATISFACCION * 24;
        }),
        renovacion: candidatas.filter((fila) => {
            const dias = diasParaVencer(fila);
            return !fila.renovacion_enviada_at && dias !== null && dias > 0 && dias <= DIAS_AVISO_RENOVACION;
        }),
        cupon: candidatas.filter((fila) => fila.satisfaccion_enviada_at && !fila.cupon_enviado_at),
    };
}

function pintarFidelizacion(filas) {
    const reales = filas.filter((fila) => !fila._prueba);
    const conColumnas = reales.some((fila) => 'cliente_whatsapp' in fila);
    const cajas = { satisfaccion: 'cola-satisfaccion', renovacion: 'cola-renovacion', cupon: 'cola-cupones' };

    if (!conColumnas) {
        Object.values(cajas).forEach((id) => {
            document.getElementById(id).innerHTML = filaVacia('Ejecuta supabase/wo-011.sql para activar el seguimiento.', 'fa-database');
        });
        ['kpi-satisfaccion', 'kpi-renovacion', 'kpi-cupones'].forEach((id) => { document.getElementById(id).textContent = '—'; });
        document.getElementById('kpi-con-whatsapp').textContent = '';
        return;
    }

    const colas = colasFidelizacion(reales);
    document.getElementById('kpi-satisfaccion').textContent = colas.satisfaccion.length;
    document.getElementById('kpi-renovacion').textContent = colas.renovacion.length;
    document.getElementById('kpi-cupones').textContent = reales.filter((fila) => fila.cupon_enviado_at).length;
    const conWhatsapp = reales.filter((fila) => PlantillasWA.normalizarNumero(fila.cliente_whatsapp)).length;
    document.getElementById('kpi-con-whatsapp').textContent = reales.length
        ? `${Math.round((conWhatsapp / reales.length) * 100)}% de compras con WhatsApp`
        : '';

    const vacios = {
        satisfaccion: 'Nadie cumple 24 h desde la entrega.',
        renovacion: 'Ninguna garantía vence en los próximos 3 días.',
        cupon: 'Los cupones se ofrecen después del mensaje de satisfacción.',
    };
    Object.entries(cajas).forEach(([tipo, idCaja]) => {
        const caja = document.getElementById(idCaja);
        if (colas[tipo].length === 0) {
            caja.innerHTML = filaVacia(vacios[tipo]);
            return;
        }
        caja.replaceChildren(...colas[tipo].map((fila) => {
            const p = normalizarPedido(fila);
            const detalle = tipo === 'renovacion' ? `Vence en ${diasParaVencer(fila)} día(s)` : `Entregado ${formatearFecha(momentoEntrega(fila))}`;
            const item = document.createElement('div');
            item.className = 'flex items-center gap-3 rounded-2xl bg-dcDarkBg/60 ring-1 ring-white/5 px-4 py-3';
            item.innerHTML = `
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-bold text-white truncate">${escaparHTML(p.producto)}</p>
                    <p class="text-[11px] text-neutral-500 truncate">#${escaparHTML(p.ref)} · ${escaparHTML(detalle)}</p>
                </div>
                <button type="button" aria-label="Enviar por WhatsApp" class="btn-cyber verde shrink-0 w-11 h-11 grid place-items-center rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white">
                    <i class="fa-brands fa-whatsapp text-lg"></i>
                </button>`;
            item.querySelector('button').addEventListener('click', (e) => enviarSeguimiento(tipo, fila, e.currentTarget));
            return item;
        }));
    });
}

// Código legible sin caracteres confusos (0/O, 1/I)
function generarCupon() {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const azar = crypto.getRandomValues(new Uint32Array(6));
    return `DC-${Array.from(azar, (n) => alfabeto[n % alfabeto.length]).join('')}`;
}

async function enviarSeguimiento(tipo, fila, btn) {
    const p = normalizarPedido(fila);
    const cupon = tipo === 'satisfaccion' ? null : (fila.cupon_codigo || generarCupon());
    const texto = {
        satisfaccion: () => PlantillasWA.satisfaccion24h({ producto: p.producto }),
        renovacion: () => PlantillasWA.renovacion3d({ producto: p.producto, cupon }),
        cupon: () => PlantillasWA.cuponFidelidad({ producto: p.producto, cupon }),
    }[tipo]();

    // Abrir WhatsApp primero (dentro del clic, para que el navegador no lo bloquee)
    window.open(PlantillasWA.enlace(fila.cliente_whatsapp, texto), '_blank', 'noopener');

    btn.disabled = true;
    const cambios = { [COLUMNA_ENVIO[tipo]]: new Date().toISOString() };
    if (cupon && cupon !== fila.cupon_codigo) cambios.cupon_codigo = cupon;

    const { data, error } = await supabaseClient.from('compras_proveedor').update(cambios).eq('id', fila.id).select('*');
    if (error || !data?.length) {
        btn.disabled = false;
        console.error('No se pudo registrar el envío:', error ?? 'RLS no permite el UPDATE');
        mostrarToast('Se abrió WhatsApp, pero no se registró el envío. Revisa la consola.', 'error', 6000);
        return;
    }
    pedidos.set(String(fila.id), data[0]);
    pintarPagosBot();
    mostrarToast(cupon ? `Mensaje registrado · cupón ${cupon}` : 'Mensaje de satisfacción registrado.', 'ok', 4000);
}

/* ==================== NOTIFICACIONES AUTOMÁTICAS (public.notificaciones_whatsapp) ==================== */

const LIMITE_NOTIFICACIONES = 25;
const TIPOS_NOTIFICACION = {
    PAGO_RECIBIDO:      { texto: 'Pago confirmado', icono: 'fa-circle-check', color: 'text-sky-300' },
    ENTREGA_CONFIRMADA: { texto: 'Entrega',         icono: 'fa-box-open',     color: 'text-emerald-300' },
    SOLICITUD_RESENA:   { texto: 'Reseña 24 h',     icono: 'fa-star',         color: 'text-amber-300' },
};
const ESTADOS_NOTIFICACION = {
    PENDIENTE:  'text-neutral-300 ring-white/10 bg-white/[0.04]',
    EN_PROCESO: 'text-sky-300 ring-sky-500/30 bg-sky-500/10',
    ENVIADO:    'text-emerald-300 ring-emerald-500/30 bg-emerald-500/10',
    FALLIDO:    'text-red-300 ring-red-500/40 bg-red-500/10',
    CANCELADO:  'text-neutral-500 ring-white/10 bg-white/[0.02]',
};
let temporizadorNotificaciones = null;

// Varios cambios seguidos (p. ej. aprobar un pedido con 3 compras) → una sola consulta
function programarNotificaciones() {
    clearTimeout(temporizadorNotificaciones);
    temporizadorNotificaciones = setTimeout(cargarNotificaciones, 1200);
}

async function cargarNotificaciones() {
    const caja = document.getElementById('lista-notificaciones');
    if (!caja) return;
    const { data, error } = await supabaseClient
        .from('notificaciones_whatsapp')
        .select('id, tipo, compra_id, pedido_id, destino, variables, estado, intentos, ultimo_error, enviar_despues, enviado_at, created_at')
        .order('id', { ascending: false })
        .limit(LIMITE_NOTIFICACIONES);

    const resumen = document.getElementById('notif-resumen');
    if (error) {
        console.error('notificaciones_whatsapp:', error);
        resumen.textContent = '';
        caja.innerHTML = ['42P01', 'PGRST205'].includes(error.code)
            ? filaVacia('Ejecuta supabase/wo-015.sql para activar las notificaciones automáticas.', 'fa-database')
            : filaVacia(`No se pudieron leer las notificaciones: ${error.message}`, 'fa-triangle-exclamation');
        return;
    }

    const filas = data ?? [];
    const fallidas = filas.filter((n) => n.estado === 'FALLIDO').length;
    const enCola = filas.filter((n) => ['PENDIENTE', 'EN_PROCESO'].includes(n.estado)).length;
    resumen.textContent = `${enCola} en cola${fallidas ? ` · ${fallidas} fallida(s)` : ''}`;
    resumen.className = `text-[10px] font-bold uppercase tracking-widest ${fallidas ? 'text-red-300' : 'text-neutral-500'}`;

    if (filas.length === 0) {
        caja.innerHTML = filaVacia('Aún no hay notificaciones. Se crean al validar pagos y marcar entregas de clientes con WhatsApp.', 'fa-paper-plane');
        return;
    }
    caja.replaceChildren(...filas.map(itemNotificacion));
}

function itemNotificacion(n) {
    const tipo = TIPOS_NOTIFICACION[n.tipo] ?? { texto: n.tipo, icono: 'fa-message', color: 'text-neutral-300' };
    const programada = n.estado === 'PENDIENTE' && new Date(n.enviar_despues).getTime() > Date.now();
    const cuando = n.enviado_at
        ? `Enviada ${formatearFecha(n.enviado_at)}`
        : programada ? `Programada ${formatearFecha(n.enviar_despues)}` : `Creada ${formatearFecha(n.created_at)}`;
    const reintentable = ['FALLIDO', 'CANCELADO'].includes(n.estado);

    const item = document.createElement('div');
    item.className = 'flex items-center gap-3 rounded-2xl bg-dcDarkBg/60 ring-1 ring-white/5 px-4 py-3';
    item.innerHTML = `
        <i class="fa-solid ${tipo.icono} ${tipo.color} w-5 text-center shrink-0"></i>
        <div class="flex-1 min-w-0">
            <p class="text-sm font-bold text-white truncate">${escaparHTML(tipo.texto)} · ${escaparHTML(n.variables?.producto ?? '')}</p>
            <p class="text-[11px] text-neutral-500 truncate">#${escaparHTML(n.pedido_id ?? n.compra_id)} · WhatsApp …${escaparHTML(String(n.destino).slice(-4))} · ${escaparHTML(cuando)}</p>
            ${n.ultimo_error ? `<p class="text-[11px] text-red-300/80 truncate" title="${escaparHTML(n.ultimo_error)}">${escaparHTML(n.ultimo_error)}</p>` : ''}
        </div>
        <span class="shrink-0 rounded-lg ring-1 px-2 py-1 text-[9px] font-black uppercase tracking-widest ${ESTADOS_NOTIFICACION[n.estado] ?? ''}">${escaparHTML(n.estado)}</span>
        ${reintentable ? `<button type="button" aria-label="Reintentar envío" class="btn-cyber shrink-0 w-11 h-11 grid place-items-center rounded-xl bg-white/[0.04] ring-1 ring-white/10 text-neutral-200"><i class="fa-solid fa-rotate-right"></i></button>` : ''}`;
    item.querySelector('button')?.addEventListener('click', (e) => reintentarNotificacion(n, e.currentTarget));
    return item;
}

async function reintentarNotificacion(n, btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    const { data, error } = await supabaseClient.rpc('reintentar_notificacion', { p_id: n.id }).maybeSingle();
    if (error || !data?.ok) {
        console.error('reintentar_notificacion:', error ?? data);
        mostrarToast(data?.mensaje ?? 'No se pudo reintentar. Revisa la consola.', 'error', 5000);
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-rotate-right"></i>';
        return;
    }
    mostrarToast('Notificación en cola de nuevo. n8n la enviará en el próximo ciclo.', 'ok', 4000);
    cargarNotificaciones();
}

/* ==================== AGENTE BOT · BASE DE CONOCIMIENTO ==================== */

async function cargarBaseConocimiento() {
    try {
        const respuesta = await fetch('bot-conocimiento.json', { cache: 'no-store' });
        if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
        baseConocimiento = await respuesta.json();
    } catch (error) {
        console.error('No se pudo leer bot-conocimiento.json:', error);
        baseConocimiento = null;
    }
    pintarBot();
}

const NOMBRES_PLANTILLAS = {
    comprar_ahora: 'Comprar ahora', consultar_estado: 'Consultar estado', solicitar_soporte: 'Solicitar soporte',
    reclamar_garantia: 'Reclamar garantía', satisfaccion_24h: 'Satisfacción 24 h', renovacion_3d: 'Renovación 3 días',
    cupon_fidelidad: 'Cupón de fidelidad', pedido_proveedor: 'Pedido al proveedor',
    pago_recibido: 'Auto · Pago confirmado', entrega_confirmada: 'Auto · Entrega', solicitud_resena: 'Auto · Reseña 24 h',
    escalar_asesor: 'Escalar a asesor',
};

function bloqueCopiable(titulo, texto, { pendiente = false } = {}) {
    const item = document.createElement('div');
    item.className = `rounded-2xl bg-dcDarkBg/60 ring-1 ${pendiente ? 'ring-amber-500/30' : 'ring-white/5'} p-3`;
    item.innerHTML = `
        <div class="flex items-start justify-between gap-2">
            <p class="text-xs font-bold text-white"></p>
            ${pendiente ? '<span class="shrink-0 text-[9px] font-black uppercase tracking-widest text-amber-300">Pendiente</span>' : `
            <button type="button" aria-label="Copiar" class="btn-cyber shrink-0 w-9 h-9 grid place-items-center rounded-lg bg-white/[0.04] ring-1 ring-white/10 text-neutral-300"><i class="fa-regular fa-copy"></i></button>`}
        </div>
        <p class="mt-1 text-[11px] leading-relaxed text-neutral-400 whitespace-pre-line"></p>`;
    item.querySelector('p').textContent = titulo;
    item.querySelectorAll('p')[1].textContent = pendiente ? 'Complétala en bot-conocimiento.json antes de que el bot la use.' : texto;
    item.querySelector('button')?.addEventListener('click', () => copiarTexto(texto, `"${titulo}" copiado`));
    return item;
}

function pintarBot() {
    const avisos = document.getElementById('bot-avisos');
    const faq = document.getElementById('bot-faq');
    const plantillas = document.getElementById('bot-plantillas');

    if (!baseConocimiento) {
        avisos.innerHTML = filaVacia('No se pudo leer bot-conocimiento.json. Abre el panel con Live Server (no como archivo) y verifica que el archivo exista.', 'fa-triangle-exclamation');
        faq.innerHTML = '';
        plantillas.innerHTML = '';
        document.getElementById('bot-catalogo').innerHTML = '';
        return;
    }

    const bc = baseConocimiento;
    document.getElementById('bot-version').textContent = `Generado ${formatearFecha(bc.version)} · ${bc.catalogo?.length ?? 0} productos`;

    const pendientes = [...(bc.faq ?? []), ...(bc.promociones ?? [])].filter((x) => x.pendiente_configurar);
    avisos.innerHTML = pendientes.length
        ? `<div class="rounded-2xl bg-amber-500/10 ring-1 ring-amber-500/30 px-4 py-3 text-xs text-amber-200">
               <i class="fa-solid fa-triangle-exclamation mr-1"></i> Por configurar en bot-conocimiento.json:
               <b>${pendientes.map((x) => escaparHTML(x.id)).join(', ')}</b>
           </div>`
        : '';

    faq.replaceChildren(...(bc.faq ?? []).map((f) => bloqueCopiable(f.pregunta, f.respuesta, { pendiente: f.pendiente_configurar || !f.respuesta })));
    plantillas.replaceChildren(...Object.entries(bc.plantillas ?? {})
        .filter(([clave]) => clave !== 'botones')
        .map(([clave, texto]) => bloqueCopiable(NOMBRES_PLANTILLAS[clave] ?? clave, texto)));
    pintarCatalogoBot();
}

function pintarCatalogoBot() {
    const caja = document.getElementById('bot-catalogo');
    if (!baseConocimiento) return;
    const termino = document.getElementById('bot-buscar').value.trim().toLowerCase();
    const resultados = (baseConocimiento.catalogo ?? [])
        .filter((p) => !termino || `${p.nombre} ${p.marca} ${p.tipo}`.toLowerCase().includes(termino))
        .slice(0, termino ? 12 : 6);

    if (resultados.length === 0) {
        caja.innerHTML = `<div class="sm:col-span-2">${filaVacia(`Ningún producto coincide con “${termino}”.`, 'fa-magnifying-glass')}</div>`;
        return;
    }

    caja.replaceChildren(...resultados.map((producto) => {
        const variantes = producto.variantes ?? [];
        const precios = [`${producto.nombre}:`, ...variantes.map((v) => `• ${v.nombre}: ${PlantillasWA.precioCOP(v.precio)}`)].join('\n');
        const masBarata = [...variantes].sort((a, b) => a.precio - b.precio)[0];
        const comprar = PlantillasWA.comprarAhora({ producto: producto.nombre, variante: masBarata?.nombre, precio: masBarata?.precio });

        const item = document.createElement('div');
        item.className = 'rounded-2xl bg-dcDarkBg/60 ring-1 ring-white/5 p-3 flex flex-col gap-2';
        item.innerHTML = `
            <div class="min-w-0">
                <p class="text-[10px] font-black uppercase tracking-widest text-dcRed">${escaparHTML(producto.tipo)}</p>
                <p class="text-sm font-bold text-white truncate">${escaparHTML(producto.nombre)}</p>
                <p class="text-[11px] text-neutral-400">Desde ${escaparHTML(PlantillasWA.precioCOP(producto.desde))} · ${variantes.length} opción(es)</p>
            </div>
            <div class="grid grid-cols-2 gap-2">
                <button type="button" data-copiar="precios" class="btn-cyber min-h-[40px] rounded-xl bg-white/[0.04] ring-1 ring-white/10 text-[10px] font-bold uppercase tracking-wider text-neutral-300"><i class="fa-solid fa-tags mr-1"></i> Precios</button>
                <button type="button" data-copiar="comprar" class="btn-cyber min-h-[40px] rounded-xl bg-white/[0.04] ring-1 ring-white/10 text-[10px] font-bold uppercase tracking-wider text-neutral-300"><i class="fa-solid fa-cart-shopping mr-1"></i> Comprar ahora</button>
            </div>`;
        item.querySelector('[data-copiar="precios"]').addEventListener('click', () => copiarTexto(precios, 'Precios copiados'));
        item.querySelector('[data-copiar="comprar"]').addEventListener('click', () => copiarTexto(comprar, 'Plantilla "Comprar ahora" copiada'));
        return item;
    }));
}

/* ==================== EXPORTAR CSV ==================== */

// Exporta lo que se ve (filtro + categoría + búsqueda). Excluye pedidos de prueba y NUNCA incluye clave_serial.
function exportarCSV() {
    const filas = filasVisibles().filter((fila) => !fila._prueba);
    if (filas.length === 0) {
        mostrarToast('No hay pedidos reales para exportar con este filtro.', 'info');
        return;
    }

    // Prefijo ' en celdas que empiezan por = + - @ para evitar fórmulas maliciosas en Excel
    const celdaCSV = (valor) => {
        let texto = String(valor ?? '');
        if (/^[=+\-@]/.test(texto)) texto = `'${texto}`;
        return `"${texto.replace(/"/g, '""')}"`;
    };
    const encabezado = ['ID compra', 'Pedido', 'Producto', 'Variante', 'Categoría', 'Estado', 'Costo COP', 'Fecha'];
    const lineas = filas.map((fila) => {
        const p = normalizarPedido(fila);
        return [p.id, p.pedidoId, p.producto, p.variante, categoriaDe(fila).texto, p.estadoTexto, p.costoNumero ?? '', p.fechaISO]
            .map(celdaCSV).join(';');
    });

    // BOM + ';' para que Excel en español abra tildes y columnas correctamente
    const contenido = '﻿' + [encabezado.map(celdaCSV).join(';'), ...lineas].join('\r\n');
    const fecha = new Date().toISOString().slice(0, 10);
    descargarArchivo(`dc-entregas-${ui.filtro}-${fecha}.csv`, contenido, 'text/csv;charset=utf-8');
    mostrarToast(`${filas.length} pedido${filas.length === 1 ? '' : 's'} exportado${filas.length === 1 ? '' : 's'} a CSV.`, 'ok');
}

/* ==================== MODO KIOSCO ==================== */

async function alternarPantallaCompleta() {
    try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
    } catch (error) {
        console.error('Pantalla completa no disponible:', error);
        mostrarToast('Este navegador no permite pantalla completa.', 'error');
    }
}

function pintarBotonPantallaCompleta() {
    const activa = Boolean(document.fullscreenElement);
    document.querySelectorAll('#btn-pantalla-completa i, #ajuste-pantalla-completa i.fa-expand, #ajuste-pantalla-completa i.fa-compress').forEach((icono) => {
        icono.classList.toggle('fa-expand', !activa);
        icono.classList.toggle('fa-compress', activa);
    });
}

/* ==================== MODALES (fade + slide) ==================== */

function abrirModal(modal) {
    if (!modal || !modal.hidden) return;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('.modal-fondo').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
    modal.querySelector('.modal-panel').animate(
        [{ opacity: 0, transform: 'translateY(40px) scale(.98)' }, { opacity: 1, transform: 'none' }],
        { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );
    modal.querySelector('input, button:not([data-cerrar-modal])')?.focus({ preventScroll: true });
}

async function cerrarModal(modal, { forzar = false } = {}) {
    if (!modal || modal.hidden || modal.dataset.cerrando) return;
    // No se cierra a mitad de una operación (el resultado se perdería de vista); el propio flujo lo cierra al terminar
    if (modal.dataset.ocupado && !forzar) {
        mostrarToast('Espera a que termine la operación en curso.', 'info', 2500);
        return;
    }
    modal.dataset.cerrando = '1';
    await Promise.all([
        modal.querySelector('.modal-fondo').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, fill: 'forwards' }).finished,
        modal.querySelector('.modal-panel').animate(
            [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(40px) scale(.98)' }],
            { duration: 220, easing: 'ease-in', fill: 'forwards' }
        ).finished,
    ]);
    modal.hidden = true;
    delete modal.dataset.cerrando;
    modal.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    if (!document.querySelector('[role="dialog"]:not([hidden])')) document.body.style.overflow = '';
    if (modal.id === 'modal-editar') pedidoEditando = null;
    if (modal.id === 'modal-pago') pedidoPagando = null;
}
