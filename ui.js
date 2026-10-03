// ui.js — Utilidades compartidas por admin.html y portal.html:
// toasts, copiar, escape de HTML, sonidos cyber, detector de conexión y descargas.
// Requiere en la página: <div id="toasts"> y la animación CSS 'toast-progress'.

// Evita que datos de la base rompan el HTML o inyecten código
function escaparHTML(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/* ==================== TOASTS ==================== */

const TOAST_ESTILOS = {
    ok:    { anillo: 'ring-emerald-500/40', icono: 'fa-circle-check text-emerald-400', barra: 'bg-emerald-400' },
    info:  { anillo: 'ring-white/15',       icono: 'fa-circle-info text-sky-400',      barra: 'bg-sky-400' },
    nuevo: { anillo: 'ring-dcRed/60',       icono: 'fa-bell fa-shake text-dcRed',      barra: 'bg-dcRed' },
    error: { anillo: 'ring-red-500/40',     icono: 'fa-circle-exclamation text-red-400', barra: 'bg-red-400' },
};

// Notificación flotante con barra de tiempo de expiración
function mostrarToast(mensaje, tipo = 'ok', duracion = 3500) {
    const zona = document.getElementById('toasts');
    if (!zona) return;
    const e = TOAST_ESTILOS[tipo] ?? TOAST_ESTILOS.info;

    const toast = document.createElement('div');
    toast.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    toast.className = `pointer-events-auto relative overflow-hidden w-full sm:w-80 flex items-center gap-3 pl-4 pr-2 py-3 rounded-2xl bg-dcDarkCard/95 backdrop-blur-xl ring-1 ${e.anillo} shadow-2xl shadow-black/60 text-xs font-semibold text-white`;
    toast.innerHTML = `
        <i class="fa-solid ${e.icono} text-base shrink-0"></i>
        <span class="flex-1 min-w-0 leading-snug"></span>
        <button type="button" aria-label="Cerrar" class="shrink-0 w-9 h-9 grid place-items-center rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <i class="fa-solid fa-xmark"></i>
        </button>
        <span class="absolute left-0 bottom-0 h-0.5 w-full origin-left ${e.barra}" style="animation: toast-progress ${duracion}ms linear forwards"></span>`;
    toast.querySelector('span').textContent = mensaje;
    zona.appendChild(toast);

    toast.animate(
        [{ opacity: 0, transform: 'translateX(24px) scale(.96)' }, { opacity: 1, transform: 'none' }],
        { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' }
    );

    let cerrado = false;
    const cerrar = async () => {
        if (cerrado) return;
        cerrado = true;
        await toast.animate(
            [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(24px) scale(.96)' }],
            { duration: 220, easing: 'ease-in', fill: 'forwards' }
        ).finished;
        toast.remove();
    };
    toast.querySelector('button').addEventListener('click', cerrar);
    setTimeout(cerrar, duracion);
}

/* ==================== PORTAPAPELES Y DESCARGAS ==================== */

// Copia con un toque; si el navegador bloquea la API moderna, usa el método clásico
async function copiarTexto(texto, aviso = '¡Copiado!') {
    try {
        await navigator.clipboard.writeText(texto);
    } catch {
        const area = document.createElement('textarea');
        area.value = texto;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        if (!ok) {
            mostrarToast('No se pudo copiar. Cópialo manualmente.', 'error');
            return false;
        }
    }
    mostrarToast(aviso, 'ok', 2200);
    navigator.vibrate?.(15);
    return true;
}

function descargarArchivo(nombre, contenido, tipo = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
    const enlace = Object.assign(document.createElement('a'), { href: url, download: nombre });
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ==================== SONIDOS CYBER (Web Audio API, sin archivos) ==================== */

const CLAVE_SONIDO = 'dc_sonido';

const Sonidos = {
    ctx: null,

    // <html data-sonido="off"> silencia la página (p. ej. la tienda pública)
    activo() {
        if (document.documentElement.dataset.sonido === 'off') return false;
        try { return localStorage.getItem(CLAVE_SONIDO) !== '0'; } catch { return true; }
    },

    activar(encendido) {
        try { localStorage.setItem(CLAVE_SONIDO, encendido ? '1' : '0'); } catch { /* sin almacenamiento */ }
    },

    // notas: [frecuenciaHz, inicioSeg, duracionSeg]
    tono(notas, { tipo = 'sine', volumen = 0.12 } = {}) {
        if (!this.activo()) return;
        try {
            this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
            if (this.ctx.state === 'suspended') this.ctx.resume();
            const t0 = this.ctx.currentTime;
            notas.forEach(([frecuencia, inicio, duracion]) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = tipo;
                osc.frequency.setValueAtTime(frecuencia, t0 + inicio);
                gain.gain.setValueAtTime(0.0001, t0 + inicio);
                gain.gain.exponentialRampToValueAtTime(volumen, t0 + inicio + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, t0 + inicio + duracion);
                osc.connect(gain).connect(this.ctx.destination);
                osc.start(t0 + inicio);
                osc.stop(t0 + inicio + duracion + 0.02);
            });
        } catch { /* audio no disponible */ }
    },

    clic()      { this.tono([[1800, 0, 0.035]], { tipo: 'square', volumen: 0.02 }); },
    nuevo()     { this.tono([[660, 0, 0.12], [990, 0.11, 0.12], [1320, 0.22, 0.24]], { tipo: 'triangle', volumen: 0.14 }); },
    completar() { this.tono([[523, 0, 0.1], [784, 0.09, 0.1], [1047, 0.18, 0.3]], { tipo: 'sine', volumen: 0.14 }); },
    error()     { this.tono([[220, 0, 0.15], [165, 0.14, 0.22]], { tipo: 'sawtooth', volumen: 0.04 }); },
};

// Clic sutil al tocar cualquier botón o enlace-botón
document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a.btn-cyber')) Sonidos.clic();
}, { passive: true });

/* ==================== DETECTOR DE CONEXIÓN (Modo Sin Red) ==================== */

(function iniciarDetectorOffline() {
    const banner = document.createElement('div');
    banner.setAttribute('role', 'status');
    banner.hidden = navigator.onLine;
    banner.className = 'fixed z-[70] top-[max(.75rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2.5 rounded-full bg-amber-500/15 backdrop-blur-xl ring-1 ring-amber-500/40 text-amber-200 text-xs font-bold shadow-2xl shadow-black/50 whitespace-nowrap';
    banner.innerHTML = '<i class="fa-solid fa-plug-circle-xmark"></i> Modo sin red · reconectando…';
    document.body.appendChild(banner);

    window.addEventListener('offline', () => {
        banner.hidden = false;
        banner.animate(
            [{ opacity: 0, transform: 'translate(-50%, -12px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }],
            { duration: 300, easing: 'cubic-bezier(.2,.8,.2,1)' }
        );
        Sonidos.error();
    });
    window.addEventListener('online', () => {
        banner.hidden = true;
        mostrarToast('Conexión restablecida.', 'ok', 2500);
    });
})();

/* ==================== FORMAS DE PAGO (tienda, portal y modal de producto) ==================== */
// Recibe las filas de la RPC pública metodos_pago_publicos() (sin números ni direcciones) y las pinta
// agrupadas en "locales" y "cripto" con su ícono. En cripto muestra la red: es lo que evita pérdidas.
function htmlFormasDePago(metodos, { compacto = false } = {}) {
    const WA = window.PlantillasWA;
    if (!WA || !metodos?.length) return '';
    const chip = (m) => {
        const t = WA.tipoPago(m.tipo) ?? { icono: 'fa-solid fa-wallet', color: '#64748B', nombre: m.tipo };
        const red = m.categoria === 'cripto' && m.red && m.red !== 'BINANCE_PAY' ? ` · ${m.red}` : '';
        return `<span class="inline-flex items-center gap-2 rounded-xl bg-white/[0.04] ring-1 ring-white/10 ${compacto ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'} font-bold text-white">
            <span class="grid place-items-center w-6 h-6 rounded-lg text-white text-[11px]" style="background:${escaparHTML(t.color)}"><i class="${escaparHTML(t.icono)}"></i></span>
            ${escaparHTML(m.tipo === 'BINANCE_PAY' ? `Binance Pay${m.moneda ? ` (${m.moneda})` : ''}` : m.categoria === 'cripto' ? (m.moneda || t.nombre) : (m.nombre || t.nombre))}${escaparHTML(red)}</span>`;
    };
    const grupos = Object.entries(WA.CATEGORIAS_PAGO)
        .map(([cat, titulo]) => [cat, titulo, metodos.filter((m) => m.categoria === cat)])
        .filter(([, , lista]) => lista.length);
    return grupos.map(([cat, titulo, lista]) => `
        <div class="space-y-2">
            <p class="text-[10px] font-black uppercase tracking-widest text-neutral-400"><i class="fa-solid ${cat === 'cripto' ? 'fa-coins' : 'fa-wallet'} mr-1 text-dcRed"></i>${escaparHTML(titulo)}</p>
            <div class="flex flex-wrap gap-2">${lista.map(chip).join('')}</div>
            ${cat === 'cripto' ? '<p class="text-[11px] text-amber-300"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Envía solo por la red indicada: otra red = pérdida de los fondos.</p>' : ''}
        </div>`).join('');
}

// Frase corta para textos ("Nequi, Daviplata o cripto (USDT · TRC20)"); genérica si aún no hay datos
function resumenFormasDePago(metodos) {
    if (!metodos?.length) return 'transferencia o billetera digital';
    const locales = [...new Set(metodos.filter((m) => m.categoria !== 'cripto').map((m) => m.nombre || m.tipo))];
    const cripto = [...new Set(metodos.filter((m) => m.categoria === 'cripto').map((m) => (m.red && m.red !== 'BINANCE_PAY' ? `${m.moneda} ${m.red}` : m.nombre || m.tipo)))];
    const partes = [...locales.slice(0, 3)];
    if (cripto.length) partes.push(`cripto (${cripto.slice(0, 3).join(', ')})`);
    return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} o ${partes.at(-1)}` : partes[0];
}
