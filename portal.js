// portal.js — Rastreo de pedidos para clientes (portal.html)
const supabaseClient = window.supabase.createClient(
  'https://vyqcizwfmjlflncdwzve.supabase.co',
  'sb_publishable_GvQiv6M7iSrlwsA90lXsOQ_5OfSYBwy'
);

const WHATSAPP_SOPORTE = '573223284622';
// El cliente es anónimo y la tabla está cerrada, así que no puede usar Realtime:
// se vuelve a consultar el estado vía RPC cada cierto tiempo mientras la pestaña está visible.
const SEGUNDOS_SINCRONIZACION = 30;
const CLAVE_RECIENTES = 'dc_portal_recientes';
const MAX_RECIENTES = 5;

// Badge de entrega con LED: verde = listo, amarillo = procesando, rojo = soporte requerido
const LED = {
  verde:    { clases: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30', punto: 'bg-emerald-400' },
  amarillo: { clases: 'bg-amber-500/10 text-amber-300 ring-amber-500/30', punto: 'bg-amber-400' },
  rojo:     { clases: 'bg-red-500/10 text-red-300 ring-red-500/30', punto: 'bg-red-400' },
};
const ESTADOS = {
  PENDIENTE_PAGO:      { ...LED.amarillo, texto: 'Verificando pago',    detalle: 'Recibimos tu pedido. Estamos verificando tu pago; te avisamos apenas se confirme.' },
  ENTREGADO_INMEDIATO: { ...LED.verde,    texto: 'Listo para usar',     detalle: 'Tu pago fue validado y tu servicio ya fue entregado. ¡Disfrútalo!' },
  ESPERANDO_PROVEEDOR: { ...LED.amarillo, texto: 'Procesando licencia', detalle: 'Recibimos tu pago y estamos gestionando tu servicio con el proveedor.' },
  PEDIDO_REALIZADO:    { ...LED.amarillo, texto: 'Procesando licencia', detalle: 'El proveedor ya tiene tu pedido. Pronto recibirás tus accesos.' },
  ENTREGADO:           { ...LED.verde,    texto: 'Listo para usar',     detalle: 'Tu servicio fue entregado y está activo. Si tienes fallas, contacta a soporte.' },
  RECIBIDA:            { ...LED.amarillo, texto: 'Preparando tu entrega', detalle: 'Ya recibimos tu servicio del proveedor y lo estamos verificando para enviártelo.' },
  FALLIDA:             { ...LED.rojo,     texto: 'Soporte requerido',   detalle: 'Hubo un problema con tu pedido. Escríbenos por WhatsApp y lo resolvemos de inmediato.' },
  CANCELADA:           { ...LED.rojo,     texto: 'Pedido cancelado',    detalle: 'Este pedido fue cancelado. Si crees que es un error, escríbenos por WhatsApp.' },
};
const ESTADO_DESCONOCIDO = { ...LED.amarillo, texto: 'En revisión', detalle: 'Tu pedido está registrado. Escríbenos si necesitas más información.' };
const ESTADO_LISTO = ESTADOS.ENTREGADO;
// Estados finales: ya no hace falta seguir consultando
const ESTADOS_FINALES = ['ENTREGADO', 'ENTREGADO_INMEDIATO', 'FALLIDA', 'CANCELADA'];

// Credenciales que la consulta podría devolver (solo se muestran si vienen en la respuesta)
const CAMPOS_CREDENCIALES = [
  { clave: 'usuario',      etiqueta: 'Usuario / correo', icono: 'fa-user',  secreto: false },
  { clave: 'clave',        etiqueta: 'Clave / PIN',      icono: 'fa-lock',  secreto: true },
  { clave: 'clave_serial', etiqueta: 'Serial / clave',   icono: 'fa-key',   secreto: true },
];

const form = document.getElementById('form-consulta');
const inputCodigo = document.getElementById('codigo-pedido');
const btnVerificar = form.querySelector('button[type="submit"]');
const resultadoBox = document.getElementById('resultado-pedido');
const badge = document.getElementById('status-badge');
const resPedido = document.getElementById('res-pedido');
const resProducto = document.getElementById('res-producto');
const resDetalle = document.getElementById('res-detalle');
const btnCopiarPedido = document.getElementById('btn-copiar-pedido');
const btnSoporte = document.getElementById('btn-soporte-pedido');
const cajaCredenciales = document.getElementById('credenciales');

let seguimiento = null; // { id, estado, segundos, temporizador }
let refActual = '';     // número de pedido mostrado (para copiar)

// Convierte lo que escribe el cliente en un id válido: acepta "1045", "DC-1045" o un UUID
function normalizarId(valor) {
  const limpio = valor.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(limpio)) {
    return limpio.toLowerCase();
  }
  const numero = limpio.toUpperCase().replace(/^DC-?/, '');
  return /^\d{1,18}$/.test(numero) ? numero : null;
}

async function consultarPedido(id) {
  // RPC: la tabla está cerrada al público; la función solo devuelve los campos permitidos de un id exacto
  return supabaseClient.rpc('consultar_pedido', { p_codigo: id }).maybeSingle();
}

/* ==================== CONSULTA ==================== */

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  detenerSeguimiento();

  const codigoIngresado = inputCodigo.value.trim().toUpperCase();
  const id = normalizarId(codigoIngresado);

  if (!id) {
    mostrarError('Código inválido', 'Revisa el código que te enviamos por WhatsApp (ej: DC-1045).', codigoIngresado);
    return;
  }

  ponerCargando(true);
  const { data, error } = await consultarPedido(id);
  ponerCargando(false);
  pintarEstadoSistema(!error);

  if (error) {
    console.error('Error al consultar el pedido:', error);
    mostrarError('Soporte requerido', 'No pudimos consultar tu pedido en este momento. Intenta de nuevo o escríbenos.', id);
    return;
  }

  if (!data) {
    mostrarError('Pedido no encontrado', `No encontramos ningún pedido con el código ${codigoIngresado}.`, id);
    return;
  }

  guardarReciente(codigoIngresado);
  mostrarPedido(id, data);
  Sonidos.completar();
  iniciarSeguimiento(id, data.estado);
  resultadoBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// La RPC devuelve: pedido_id, producto (referencia_externa o variante_id) y estado
function mostrarPedido(id, data, { actualizado = false } = {}) {
  const tieneCredenciales = CAMPOS_CREDENCIALES.some(({ clave }) => data[clave]);
  const estado = tieneCredenciales ? ESTADO_LISTO : (ESTADOS[data.estado] ?? ESTADO_DESCONOCIDO);
  const producto = data.producto ?? data.referencia_externa ?? data.variante_id ?? 'Servicio DC Technology';
  const ref = String(data.pedido_id ?? id);

  pintarResultado({
    ...estado,
    pulso: true,
    ref,
    titulo: producto,
    mensajeSoporte: mensajeSoporteVIP({ ref, producto, estado: estado.texto }),
    actualizado,
  });
  pintarCredenciales(data);
  pintarGarantia({ idCompra: id, ref, producto, data });
  pintarFormResena(id, data.estado);
}

/* ==================== RESEÑA VERIFICADA ==================== */

const formResena = document.getElementById('form-resena');
// Solo compras que el cliente ya recibió (igual que dejar_resena en supabase/wo-012.sql)
const ESTADOS_RESENABLES = ['ENTREGADO', 'ENTREGADO_INMEDIATO'];
let resenaCompraId = null;
let resenaCalificacion = 0;

function pintarFormResena(id, estadoPedido) {
  const yaResenada = (() => { try { return localStorage.getItem(`dc_resena_${id}`) === '1'; } catch { return false; } })();
  formResena.hidden = !ESTADOS_RESENABLES.includes(estadoPedido) || yaResenada;
  if (formResena.hidden) return;
  resenaCompraId = id;
  resenaCalificacion = 0;
  pintarEstrellas();
}

function pintarEstrellas() {
  const caja = document.getElementById('resena-estrellas');
  caja.replaceChildren(...[1, 2, 3, 4, 5].map((n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `${n} estrella${n === 1 ? '' : 's'}`);
    b.setAttribute('aria-pressed', String(n === resenaCalificacion));
    b.className = 'w-11 h-11 grid place-items-center rounded-xl text-2xl hover:scale-110 transition-transform';
    b.innerHTML = `<i class="fa-${n <= resenaCalificacion ? 'solid text-amber-400' : 'regular text-neutral-500'} fa-star"></i>`;
    b.addEventListener('click', () => { resenaCalificacion = n; pintarEstrellas(); });
    return b;
  }));
}

formResena.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!resenaCalificacion) {
    mostrarToast('Elige de 1 a 5 estrellas.', 'error');
    return;
  }
  const btn = formResena.querySelector('button[type="submit"]');
  btn.disabled = true;
  const { data, error } = await supabaseClient.rpc('dejar_resena', {
    p_compra_id: resenaCompraId,
    p_whatsapp_final: document.getElementById('resena-whatsapp').value.trim(),
    p_calificacion: resenaCalificacion,
    p_comentario: document.getElementById('resena-comentario').value.trim(),
    p_nombre: document.getElementById('resena-nombre').value.trim(),
  }).maybeSingle();
  btn.disabled = false;

  if (error || !data?.ok) {
    if (error) console.error('dejar_resena:', error);
    mostrarToast(data?.mensaje ?? 'No pudimos publicar tu reseña. Intenta más tarde.', 'error', 5000);
    return;
  }
  try { localStorage.setItem(`dc_resena_${resenaCompraId}`, '1'); } catch { /* sin almacenamiento */ }
  formResena.hidden = true;
  mostrarToast(data.mensaje, 'ok', 5000);
  Sonidos.completar();
});

/* ==================== GARANTÍA ==================== */

const cajaGarantia = document.getElementById('garantia');

// La RPC devuelve fecha_vencimiento (la calcula la BD al asignar la cuenta) y serial_final (últimos 4)
function pintarGarantia({ idCompra, ref, producto, data }) {
  const vence = data?.fecha_vencimiento ? new Date(data.fecha_vencimiento) : null;
  if (!vence || Number.isNaN(vence.getTime())) {
    cajaGarantia.hidden = true;
    return;
  }

  const dias = Math.ceil((vence.getTime() - Date.now()) / 86400000);
  const activa = dias > 0;
  const led = activa ? (dias <= 3 ? LED.amarillo : LED.verde) : LED.rojo;
  const venceTexto = vence.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

  const badgeGarantia = document.getElementById('garantia-badge');
  badgeGarantia.className = `inline-flex items-center gap-2 px-3 py-1.5 rounded-full ring-1 text-[10px] font-black uppercase tracking-widest ${led.clases}`;
  badgeGarantia.innerHTML = `
    <span class="relative flex h-2 w-2">
      ${activa ? `<span class="absolute inline-flex h-full w-full rounded-full ${led.punto} opacity-75 animate-ping"></span>` : ''}
      <span class="relative inline-flex h-2 w-2 rounded-full ${led.punto}"></span>
    </span>
    <span></span>`;
  badgeGarantia.lastElementChild.textContent = activa
    ? `Garantía activa · ${dias} día${dias === 1 ? '' : 's'}`
    : 'Garantía vencida';
  document.getElementById('garantia-vence').textContent = activa ? `Hasta el ${venceTexto}` : `Venció el ${venceTexto}`;

  const btnReclamar = document.getElementById('btn-reclamar-garantia');
  btnReclamar.hidden = !activa;
  btnReclamar.href = PlantillasWA.enlace(WHATSAPP_SOPORTE, PlantillasWA.reclamarGarantia({
    idCompra,
    pedido: ref,
    producto,
    serialFinal: data.serial_final,
    vence: venceTexto,
  }));

  cajaGarantia.hidden = false;
}

function mostrarError(titulo, detalle, codigo = '') {
  detenerSeguimiento();
  Sonidos.error();
  pintarCredenciales(null);
  cajaGarantia.hidden = true;
  formResena.hidden = true;
  pintarResultado({
    ...LED.rojo,
    texto: titulo,
    pulso: true,
    detalle,
    ref: codigo,
    titulo: codigo ? 'Revisa tu código' : 'Verifica tu código',
    mensajeSoporte: mensajeSoporteVIP({ ref: codigo || 'sin código', producto: 'No identificado', estado: titulo }),
  });
}

// Plantilla formal de soporte con ID, producto y hora de la consulta
function mensajeSoporteVIP({ ref, producto, estado }) {
  const hora = new Date().toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  return [
    'Hola, equipo de soporte DC Technology.',
    'Solicito asistencia con mi pedido:',
    `• Pedido: #${ref}`,
    `• Producto: ${producto}`,
    `• Estado: ${estado}`,
    `• Fecha y hora: ${hora}`,
    'Quedo atento(a). ¡Gracias!',
  ].join('\n');
}

function pintarResultado({ texto, pulso, clases, punto, detalle, ref, titulo, mensajeSoporte, actualizado = false }) {
  // textContent (no innerHTML) para que los datos de la BD nunca se interpreten como HTML
  badge.className = `inline-flex items-center gap-2 px-3 py-1.5 rounded-full ring-1 text-[10px] font-black uppercase tracking-widest mb-4 ${clases}`;
  badge.innerHTML = `
    <span class="relative flex h-2.5 w-2.5">
      ${pulso ? `<span class="absolute inline-flex h-full w-full rounded-full ${punto} opacity-75 animate-ping"></span>` : ''}
      <span class="relative inline-flex h-2.5 w-2.5 rounded-full ${punto} shadow-[0_0_8px_currentColor]"></span>
    </span>
    <span></span>`;
  badge.lastElementChild.textContent = texto;

  refActual = ref ? String(ref) : '';
  resPedido.textContent = refActual ? `Pedido #${refActual}` : '';
  btnCopiarPedido.hidden = !refActual;
  resProducto.textContent = titulo;
  resDetalle.textContent = detalle;
  btnSoporte.href = `https://wa.me/${WHATSAPP_SOPORTE}?text=${encodeURIComponent(mensajeSoporte)}`;

  const estabaOculto = resultadoBox.hidden;
  resultadoBox.hidden = false;
  if (actualizado) {
    // Cambio de estado detectado en segundo plano: destello en lugar de re-entrada
    resultadoBox.animate(
      [{ boxShadow: '0 0 0 2px rgba(16,185,129,.7), 0 0 40px rgba(16,185,129,.35)' }, { boxShadow: '0 0 0 0 rgba(16,185,129,0)' }],
      { duration: 1800, easing: 'ease-out' }
    );
    mostrarToast(`Tu pedido cambió a: ${texto}`, 'info', 5000);
    Sonidos.nuevo();
  } else {
    resultadoBox.animate(
      [{ opacity: 0, transform: estabaOculto ? 'translateY(16px) scale(.98)' : 'scale(.98)' }, { opacity: 1, transform: 'none' }],
      { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );
  }
}

btnCopiarPedido.addEventListener('click', () => {
  if (refActual) copiarTexto(refActual, `Pedido #${refActual} copiado`);
});

/* ==================== CREDENCIALES (1-tap copy + ojo) ==================== */

function pintarCredenciales(data) {
  const campos = data ? CAMPOS_CREDENCIALES.filter(({ clave }) => data[clave]) : [];
  cajaCredenciales.hidden = campos.length === 0;
  cajaCredenciales.replaceChildren(...campos.map(({ clave, etiqueta, icono, secreto }) => {
    const valor = String(data[clave]);
    const fila = document.createElement('div');
    fila.className = 'flex items-center gap-2 rounded-2xl bg-dcDarkBg/70 ring-1 ring-white/10 pl-4 pr-1.5 py-1.5';
    fila.innerHTML = `
      <div class="flex-1 min-w-0 py-1">
        <p class="text-[10px] font-bold uppercase tracking-wider text-neutral-500"><i class="fa-solid ${icono} mr-1 text-dcRed"></i> ${escaparHTML(etiqueta)}</p>
        <p class="valor mt-0.5 font-mono text-sm text-white break-all select-all"></p>
      </div>
      ${secreto ? `
      <button type="button" data-ojo aria-label="Mostrar ${escaparHTML(etiqueta)}" class="shrink-0 w-12 h-12 grid place-items-center rounded-xl text-neutral-400 hover:text-white hover:bg-white/5 active:scale-90 transition-all">
        <i class="fa-solid fa-eye"></i>
      </button>` : ''}
      <button type="button" data-copiar aria-label="Copiar ${escaparHTML(etiqueta)}" class="shrink-0 w-12 h-12 grid place-items-center rounded-xl bg-dcRed/10 ring-1 ring-dcRed/30 text-dcRed hover:bg-dcRed/20 active:scale-90 transition-all">
        <i class="fa-regular fa-copy"></i>
      </button>`;

    const textoValor = fila.querySelector('.valor');
    let visible = !secreto;
    const pintarValor = () => { textoValor.textContent = visible ? valor : '•'.repeat(Math.min(valor.length, 12)); };
    pintarValor();

    fila.querySelector('[data-ojo]')?.addEventListener('click', (e) => {
      visible = !visible;
      pintarValor();
      e.currentTarget.innerHTML = `<i class="fa-solid ${visible ? 'fa-eye-slash' : 'fa-eye'}"></i>`;
      e.currentTarget.setAttribute('aria-label', `${visible ? 'Ocultar' : 'Mostrar'} ${etiqueta}`);
    });
    fila.querySelector('[data-copiar]').addEventListener('click', () => copiarTexto(valor, `${etiqueta}: ¡Copiado!`));
    return fila;
  }));
}

/* ==================== SINCRONIZACIÓN AUTOMÁTICA ==================== */

const cajaSync = document.getElementById('sync');
const anilloSync = document.getElementById('sync-anillo');
const textoSync = document.getElementById('sync-texto');
const CIRCUNFERENCIA = 2 * Math.PI * 10;

function iniciarSeguimiento(id, estado) {
  if (ESTADOS_FINALES.includes(estado)) {
    cajaSync.hidden = true;
    return;
  }
  seguimiento = { id, estado, segundos: SEGUNDOS_SINCRONIZACION, temporizador: setInterval(tic, 1000) };
  cajaSync.hidden = false;
  pintarContador();
}

function detenerSeguimiento() {
  if (seguimiento) clearInterval(seguimiento.temporizador);
  seguimiento = null;
  cajaSync.hidden = true;
}

function tic() {
  if (!seguimiento || document.hidden) return; // en segundo plano se pausa
  seguimiento.segundos -= 1;
  if (seguimiento.segundos <= 0) {
    revisarCambios();
    if (seguimiento) seguimiento.segundos = SEGUNDOS_SINCRONIZACION;
  }
  pintarContador();
}

function pintarContador(sincronizando = false) {
  if (!seguimiento) return;
  const fraccion = seguimiento.segundos / SEGUNDOS_SINCRONIZACION;
  anilloSync.style.strokeDasharray = CIRCUNFERENCIA;
  anilloSync.style.strokeDashoffset = CIRCUNFERENCIA * (1 - fraccion);
  textoSync.textContent = sincronizando ? 'Sincronizando estado…' : `Sincronizando estado en ${seguimiento.segundos}s…`;
}

async function revisarCambios() {
  if (!seguimiento) return;
  const { id } = seguimiento;
  pintarContador(true);
  const { data, error } = await consultarPedido(id);
  pintarEstadoSistema(!error);
  // Fallos puntuales de red se ignoran: se reintenta en el siguiente ciclo
  if (error || !data || !seguimiento || seguimiento.id !== id) return;

  if (data.estado !== seguimiento.estado) {
    seguimiento.estado = data.estado;
    mostrarPedido(id, data, { actualizado: true });
    if (ESTADOS_FINALES.includes(data.estado)) detenerSeguimiento();
  }
}

// Al volver a la pestaña, revisar de inmediato en vez de esperar el siguiente ciclo
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && seguimiento) {
    seguimiento.segundos = SEGUNDOS_SINCRONIZACION;
    revisarCambios().then(() => pintarContador());
  }
});

function ponerCargando(activo) {
  btnVerificar.disabled = activo;
  btnVerificar.innerHTML = activo
    ? '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Consultando...'
    : 'Verificar Estado';
}

/* ==================== BÚSQUEDAS RECIENTES (localStorage) ==================== */

function leerRecientes() {
  try {
    const lista = JSON.parse(localStorage.getItem(CLAVE_RECIENTES) ?? '[]');
    return Array.isArray(lista) ? lista.filter((c) => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

function escribirRecientes(lista) {
  try { localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(lista)); } catch { /* almacenamiento no disponible */ }
  pintarRecientes();
}

function guardarReciente(codigo) {
  escribirRecientes([codigo, ...leerRecientes().filter((c) => c !== codigo)].slice(0, MAX_RECIENTES));
}

function pintarRecientes() {
  const lista = leerRecientes();
  const caja = document.getElementById('recientes');
  caja.hidden = lista.length === 0;
  document.getElementById('recientes-lista').replaceChildren(...lista.map((codigo) => {
    const chip = document.createElement('span');
    chip.className = 'inline-flex items-center rounded-xl bg-white/[0.04] ring-1 ring-white/10 overflow-hidden';
    chip.innerHTML = `
      <button type="button" class="min-h-[40px] pl-3 pr-2 text-xs font-black tracking-widest text-neutral-200 hover:text-white"></button>
      <button type="button" aria-label="Quitar ${escaparHTML(codigo)}" class="min-h-[40px] w-9 grid place-items-center text-neutral-500 hover:text-white hover:bg-white/5">
        <i class="fa-solid fa-xmark text-[10px]"></i>
      </button>`;
    const [btnCodigo, btnQuitar] = chip.querySelectorAll('button');
    btnCodigo.textContent = codigo;
    btnCodigo.addEventListener('click', () => {
      inputCodigo.value = codigo;
      form.requestSubmit();
    });
    btnQuitar.addEventListener('click', () => escribirRecientes(leerRecientes().filter((c) => c !== codigo)));
    return chip;
  }));
}

document.getElementById('btn-borrar-recientes').addEventListener('click', () => escribirRecientes([]));

/* ==================== ACORDEÓN DE LA GUÍA ==================== */

document.querySelectorAll('.acordeon > button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const abierto = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!abierto));
    btn.nextElementSibling.classList.toggle('grid-rows-[1fr]', !abierto);
    btn.nextElementSibling.classList.toggle('grid-rows-[0fr]', abierto);
    btn.querySelector('.fa-chevron-down').classList.toggle('rotate-180', !abierto);
  });
});

/* ==================== ESTADO DEL SISTEMA ==================== */

function pintarEstadoSistema(operativo) {
  const banner = document.getElementById('estado-sistema');
  const color = operativo ? 'bg-emerald-400' : 'bg-amber-400';
  banner.classList.toggle('text-emerald-300/80', operativo);
  banner.classList.toggle('text-amber-300/90', !operativo);
  banner.classList.remove('text-neutral-500');
  banner.innerHTML = `
    <span class="relative flex h-2 w-2">
      <span class="absolute inline-flex h-full w-full rounded-full ${color} opacity-75 animate-ping"></span>
      <span class="relative inline-flex h-2 w-2 rounded-full ${color}"></span>
    </span>
    ${operativo ? 'Servidores y entregas automáticas operativas' : 'Conexión inestable · reintentando'}`;
}

// Comprobación real al cargar: una consulta vacía a la RPC confirma que el servicio responde
(async () => {
  pintarRecientes();
  const { error } = await consultarPedido('0');
  pintarEstadoSistema(!error);

  // Enlace directo desde WhatsApp: portal.html?codigo=DC-1045
  const codigoURL = new URLSearchParams(location.search).get('codigo');
  if (codigoURL) {
    inputCodigo.value = codigoURL.toUpperCase();
    form.requestSubmit();
  }
})();
