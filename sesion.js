// sesion.js — "Mis pedidos" con sesión (WO-028 fase 1): acceso con un código de 6 dígitos que llega
// por el WhatsApp oficial (sin correos ni contraseñas), historial de pedidos y accesos protegidos.
// Servidor: supabase/wo-028-portal.sql (solicitar_otp, verificar_otp, mis_pedidos, ver_accesos,
// reverificar_sesion, cerrar_sesion_portal). En el navegador solo se guarda el token de la sesión.
(() => {
    const { sb, WA, abrirHoja, cerrarHoja, leerLocal, guardarLocal } = window.DC;
    const CLAVE_SESION = 'dc_cliente_sesion';
    const VIGENCIA_CODIGO_SEG = 300; // el código vence en 5 minutos (solicitar_otp)
    const ESPERA_REENVIO_SEG = 60;
    const OCULTAR_ACCESOS_SEG = 60;  // los accesos se ocultan solos

    const caja = () => document.getElementById('cuenta-sesion');
    const s = { paso: 'numero', numero: '', relojes: [], pedidos: null, filtro: 'todos' };

    const leerSesion = () => {
        const x = leerLocal(CLAVE_SESION, null);
        return x?.token && new Date(x.expira) > new Date() ? x : null;
    };
    const borrarSesion = () => { try { localStorage.removeItem(CLAVE_SESION); } catch { /* sin almacenamiento */ } };
    const soloDigitos = (v) => String(v ?? '').replace(/\D/g, '');
    const enmascarar = (n) => `••• ••• ${soloDigitos(n).slice(-4)}`;
    const detenerRelojes = () => { s.relojes.forEach(clearInterval); s.relojes = []; };
    const mmss = (seg) => `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
    const fecha = (f) => (f ? new Date(f).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

    async function rpc(nombre, args) {
        if (!sb) return { error: { message: 'Sin conexión con el servidor.' } };
        return sb.rpc(nombre, args);
    }

    /* ==================== Caja de 6 dígitos ==================== */

    // Avance automático, pegar el código completo, borrar hacia atrás y autocompletado del SMS/WhatsApp
    function cajaCodigo(alCompletar) {
        const grupo = document.createElement('div');
        grupo.className = 'otp';
        grupo.setAttribute('role', 'group');
        grupo.setAttribute('aria-label', 'Código de 6 dígitos');
        const casillas = Array.from({ length: 6 }, (_, i) => {
            const c = document.createElement('input');
            c.inputMode = 'numeric';
            c.autocomplete = i === 0 ? 'one-time-code' : 'off';
            c.maxLength = i === 0 ? 6 : 1;
            c.setAttribute('aria-label', `Dígito ${i + 1}`);
            grupo.append(c);
            return c;
        });
        const valor = () => casillas.map((c) => c.value).join('');
        const repartir = (desde, digitos) => {
            [...digitos].slice(0, 6 - desde).forEach((d, k) => { casillas[desde + k].value = d; casillas[desde + k].classList.add('lleno'); });
            const siguiente = casillas.find((c) => !c.value) ?? casillas[5];
            siguiente.focus();
            if (valor().length === 6) alCompletar(valor());
        };
        casillas.forEach((c, i) => {
            c.addEventListener('input', () => {
                const d = soloDigitos(c.value);
                c.value = '';
                c.classList.remove('lleno');
                if (d) repartir(i, d);
            });
            c.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && !c.value && i > 0) { casillas[i - 1].value = ''; casillas[i - 1].classList.remove('lleno'); casillas[i - 1].focus(); e.preventDefault(); }
                if (e.key === 'ArrowLeft' && i > 0) casillas[i - 1].focus();
                if (e.key === 'ArrowRight' && i < 5) casillas[i + 1].focus();
            });
            c.addEventListener('paste', (e) => {
                const d = soloDigitos(e.clipboardData?.getData('text'));
                if (!d) return;
                e.preventDefault();
                repartir(d.length >= 6 ? 0 : i, d);
            });
            c.addEventListener('focus', () => c.select());
        });
        return {
            nodo: grupo,
            enfocar: () => casillas[0].focus(),
            limpiar: () => { casillas.forEach((c) => { c.value = ''; c.classList.remove('lleno'); }); casillas[0].focus(); },
            sacudir: () => { grupo.classList.remove('error'); void grupo.offsetWidth; grupo.classList.add('error'); navigator.vibrate?.([30, 40, 30]); },
            ocupado: (si) => { casillas.forEach((c) => { c.disabled = si; }); grupo.classList.toggle('ocupado', si); },
            exito: () => grupo.classList.add('exito'),
        };
    }

    // Cuenta regresiva del código + botón de reenviar (espera 60 s entre envíos)
    function relojCodigo(contenedor, alReenviar) {
        let vence = VIGENCIA_CODIGO_SEG;
        let espera = ESPERA_REENVIO_SEG;
        const pintar = () => {
            contenedor.innerHTML = `
                <span class="${vence > 0 ? '' : 'text-amber-300'}"><i class="fa-regular fa-clock"></i> ${vence > 0 ? `Vence en <b class="font-mono">${mmss(vence)}</b>` : 'El código venció'}</span>
                <button type="button" class="reenviar" ${espera > 0 ? 'disabled' : ''}>${espera > 0 ? `Reenviar en ${espera}s` : '<i class="fa-solid fa-rotate-right"></i> Reenviar código'}</button>`;
            contenedor.querySelector('.reenviar').addEventListener('click', alReenviar);
        };
        pintar();
        const id = setInterval(() => {
            vence = Math.max(0, vence - 1);
            espera = Math.max(0, espera - 1);
            pintar();
            if (!vence && !espera) clearInterval(id);
        }, 1000);
        s.relojes.push(id);
    }

    /* ==================== Acceso: número → código ==================== */

    function pintarAcceso() {
        detenerRelojes();
        const c = caja();
        if (s.paso === 'numero') {
            c.innerHTML = `
                <div class="tarjeta acceso entrando-suave">
                    <div class="acceso-icono" aria-hidden="true"><i class="fa-brands fa-whatsapp"></i></div>
                    <p class="font-tech text-lg font-black">Entra con tu WhatsApp</p>
                    <p class="text-sm text-neutral-400 mt-1">Te enviamos un código de 6 dígitos al número con el que compraste. Sin correos ni contraseñas.</p>
                    <form class="mt-4 space-y-3" data-form-numero novalidate>
                        <label class="block">
                            <span class="etiqueta">Tu número de WhatsApp</span>
                            <span class="campo-prefijo"><span>+57</span><input class="campo font-mono" name="numero" type="tel" inputmode="numeric" autocomplete="tel-national" maxlength="14" placeholder="300 123 4567" value="${escaparHTML(s.numero)}" required></span>
                        </label>
                        <p class="text-xs text-red-300 min-h-[1rem]" data-error></p>
                        <button type="submit" class="btn-p w-full"><i class="fa-solid fa-paper-plane"></i> Enviarme el código</button>
                    </form>
                    <ul class="ventajas">
                        <li><i class="fa-solid fa-clock-rotate-left"></i> Todos tus pedidos</li>
                        <li><i class="fa-solid fa-key"></i> Tus accesos, seguros</li>
                        <li><i class="fa-solid fa-shield-halved"></i> Tu garantía al día</li>
                    </ul>
                </div>`;
            const form = c.querySelector('[data-form-numero]');
            form.numero.addEventListener('input', () => {
                const d = soloDigitos(form.numero.value).slice(-10);
                form.numero.value = d.replace(/^(\d{3})(\d{0,3})(\d{0,4}).*/, (_, a, b, e) => [a, b, e].filter(Boolean).join(' '));
            });
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const numero = soloDigitos(form.numero.value).slice(-10);
                if (!/^3\d{9}$/.test(numero)) {
                    form.querySelector('[data-error]').textContent = 'Escribe tu celular de 10 dígitos (empieza por 3).';
                    form.numero.focus();
                    return;
                }
                const boton = form.querySelector('button');
                boton.disabled = true;
                boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Enviando…';
                const r = await pedirCodigo(numero);
                boton.disabled = false;
                boton.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviarme el código';
                if (!r.ok) { form.querySelector('[data-error]').textContent = r.mensaje; return; }
                s.numero = numero;
                s.aviso = r.mensaje;
                s.paso = 'codigo';
                pintarAcceso();
            });
            return;
        }

        // Paso 2: el código
        c.innerHTML = `
            <div class="tarjeta acceso entrando-suave">
                <button type="button" class="volver" data-cambiar><i class="fa-solid fa-arrow-left"></i> Cambiar número</button>
                <div class="acceso-icono" aria-hidden="true"><i class="fa-solid fa-shield-halved"></i></div>
                <p class="font-tech text-lg font-black">Escribe tu código</p>
                <p class="text-sm text-neutral-400 mt-1">${escaparHTML(s.aviso ?? '')} <b class="text-white font-mono whitespace-nowrap">+57 ${escaparHTML(enmascarar(s.numero))}</b></p>
                <div class="mt-5" data-otp></div>
                <p class="text-xs text-center min-h-[1rem] mt-3 text-red-300" data-error></p>
                <div class="reloj-otp" data-reloj></div>
                <p class="text-[11px] text-neutral-500 text-center mt-4"><i class="fa-solid fa-lock"></i> Nunca te pediremos este código por llamada ni por chat.</p>
            </div>`;
        const error = c.querySelector('[data-error]');
        const otp = cajaCodigo(async (codigo) => {
            otp.ocupado(true);
            error.textContent = '';
            const { data, error: fallo } = await rpc('verificar_otp', { p_whatsapp: s.numero, p_codigo: codigo });
            const r = data?.[0];
            if (fallo || !r?.ok) {
                otp.ocupado(false);
                otp.sacudir();
                error.textContent = r?.mensaje ?? 'No pudimos verificar el código. Intenta de nuevo.';
                otp.limpiar();
                return;
            }
            otp.exito();
            guardarLocal(CLAVE_SESION, { token: r.token, expira: r.expira_at, numero: s.numero });
            navigator.vibrate?.(20);
            mostrarToast('¡Listo! Ya puedes ver tus pedidos.', 'ok');
            setTimeout(() => { s.paso = 'numero'; cargarHistorial(); }, 650);
        });
        c.querySelector('[data-otp]').append(otp.nodo);
        c.querySelector('[data-cambiar]').addEventListener('click', () => { s.paso = 'numero'; pintarAcceso(); });
        relojCodigo(c.querySelector('[data-reloj]'), async () => {
            const r = await pedirCodigo(s.numero);
            if (r.ok) { mostrarToast('Te enviamos un código nuevo.', 'ok'); pintarAcceso(); }
            else error.textContent = r.mensaje;
        });
        otp.enfocar();
    }

    async function pedirCodigo(numero) {
        const { data, error } = await rpc('solicitar_otp', { p_whatsapp: numero });
        if (error || !data?.[0]) return { ok: false, mensaje: 'No pudimos enviar el código. Revisa tu conexión e intenta de nuevo.' };
        return data[0];
    }

    /* ==================== Historial ==================== */

    // Línea de tiempo: Pedido → Pago validado → Preparando → Entregado
    const PASOS = [
        ['Pedido', 'fa-receipt'],
        ['Pago validado', 'fa-wallet'],
        ['Preparando', 'fa-gears'],
        ['Entregado', 'fa-circle-check'],
    ];
    const PASO_POR_ESTADO = { PENDIENTE_PAGO: 0, ESPERANDO_PROVEEDOR: 1, PEDIDO_REALIZADO: 2, RECIBIDA: 2, ENTREGADO: 3, ENTREGADO_INMEDIATO: 3 };
    // Estados del pedido que pesan más que el de la compra (pedidos.estado)
    const ESPECIALES = {
        EN_VALIDACION: ['Validando tu pago', 'fa-magnifying-glass-dollar', 'aviso'],
        EN_REVISION: ['En revisión · te contactamos', 'fa-user-shield', 'aviso'],
        RECHAZADO: ['Pago rechazado', 'fa-circle-xmark', 'malo'],
        EXPIRADO: ['Pedido vencido sin pago', 'fa-hourglass-end', 'apagado'],
        CANCELADO: ['Cancelado', 'fa-ban', 'apagado'],
        REEMBOLSADO: ['Reembolsado', 'fa-rotate-left', 'apagado'],
    };

    function resumenEstado(p) {
        if (ESPECIALES[p.estado_pedido]) return { texto: ESPECIALES[p.estado_pedido][0], icono: ESPECIALES[p.estado_pedido][1], tono: ESPECIALES[p.estado_pedido][2], paso: p.estado_pedido === 'EN_VALIDACION' ? 0 : null };
        if (p.estado === 'FALLIDA') return { texto: 'Con novedad · te contactamos', icono: 'fa-triangle-exclamation', tono: 'malo', paso: null };
        if (p.estado === 'CANCELADA') return { texto: 'Cancelado', icono: 'fa-ban', tono: 'apagado', paso: null };
        const [texto, icono] = window.DC.ESTADOS_TEXTO[p.estado] ?? [p.estado, 'fa-circle-info'];
        const paso = PASO_POR_ESTADO[p.estado] ?? 0;
        return { texto, icono, tono: paso === 3 ? 'bueno' : 'curso', paso };
    }

    const enCurso = (p) => { const e = resumenEstado(p); return e.paso !== null && e.paso < 3 || e.tono === 'aviso'; };
    const entregado = (p) => resumenEstado(p).paso === 3;
    const diasGarantia = (p) => (p.fecha_vencimiento ? Math.ceil((new Date(p.fecha_vencimiento) - Date.now()) / 864e5) : null);

    function lineaTiempo(paso) {
        if (paso === null) return '';
        return `<ol class="linea-tiempo" style="--avance:${paso / 3}" aria-label="Avance: ${PASOS[paso][0]}">
            ${PASOS.map(([t, i], k) => `<li class="${k < paso ? 'hecho' : k === paso ? 'actual' : ''}"><span><i class="fa-solid ${i}"></i></span><small>${t}</small></li>`).join('')}
        </ol>`;
    }

    function barraGarantia(p) {
        const dias = diasGarantia(p);
        if (!entregado(p) || dias === null) return '';
        const total = Number(p.garantia_dias) || 30;
        const resto = Math.max(0, Math.min(1, dias / total));
        return `<div class="garantia ${dias > 0 ? '' : 'vencida'}">
            <p><i class="fa-solid fa-shield-halved"></i> ${dias > 0 ? `Garantía activa · quedan <b>${dias}</b> día${dias === 1 ? '' : 's'}` : 'Garantía vencida'}<span>${dias > 0 ? `hasta el ${fecha(p.fecha_vencimiento)}` : ''}</span></p>
            <div class="barra"><i style="--resto:${resto}"></i></div>
        </div>`;
    }

    function tarjetaPedido(p, i) {
        const e = resumenEstado(p);
        const t = document.createElement('article');
        t.className = `pedido tono-${e.tono}`;
        t.style.setProperty('--i', i);
        t.innerHTML = `
            <header>
                <div class="min-w-0">
                    <p class="etiqueta !mb-1">Pedido <span class="font-mono">#${escaparHTML(p.codigo)}</span>${p.creado_at ? ` · ${escaparHTML(fecha(p.creado_at))}` : ''}</p>
                    <h3>${escaparHTML(p.producto ?? 'Tu producto')}</h3>
                </div>
                <span class="estado"><i class="fa-solid ${e.icono}"></i> ${escaparHTML(e.texto)}</span>
            </header>
            ${lineaTiempo(e.paso)}
            ${barraGarantia(p)}
            <div class="acciones">
                ${p.tiene_accesos ? '<button type="button" class="btn-p" data-accesos><i class="fa-solid fa-key"></i> Ver accesos</button>' : ''}
                ${entregado(p) ? '<button type="button" class="btn-s" data-falla><i class="fa-solid fa-screwdriver-wrench"></i> Reportar falla</button>' : ''}
                ${!entregado(p) ? `<a class="btn-s" target="_blank" rel="noopener" href="${escaparHTML(WA.enlace(WA.NUMERO_TIENDA, WA.consultarEstado({ pedido: p.codigo })))}"><i class="fa-brands fa-whatsapp"></i> Preguntar por este pedido</a>` : ''}
            </div>`;
        t.querySelector('[data-accesos]')?.addEventListener('click', (ev) => verAccesos(p, ev.currentTarget));
        t.querySelector('[data-falla]')?.addEventListener('click', () => {
            window.Soporte?.iniciarConPedido({ codigo: p.codigo, producto: p.producto, garantiaDias: diasGarantia(p), serialFinal: p.serial_final });
            location.hash = '#soporte';
        });
        return t;
    }

    function pintarHistorial() {
        detenerRelojes();
        const sesion = leerSesion();
        const pedidos = s.pedidos ?? [];
        const activas = pedidos.filter((p) => entregado(p) && diasGarantia(p) > 0).length;
        const filtros = [['todos', 'Todos', pedidos.length], ['curso', 'En curso', pedidos.filter(enCurso).length], ['entregados', 'Entregados', pedidos.filter(entregado).length]];
        const lista = pedidos.filter((p) => s.filtro === 'todos' || (s.filtro === 'curso' ? enCurso(p) : entregado(p)));
        const c = caja();
        c.innerHTML = `
            <div class="cabecera-sesion entrando-suave">
                <div class="flex items-center gap-3 min-w-0">
                    <span class="avatar" aria-hidden="true"><i class="fa-brands fa-whatsapp"></i></span>
                    <span class="min-w-0"><span class="etiqueta !mb-0.5">Sesión verificada</span><b class="font-mono text-sm">+57 ${escaparHTML(enmascarar(sesion?.numero))}</b></span>
                </div>
                <div class="flex gap-2">
                    <button type="button" class="icono-btn" data-recargar aria-label="Actualizar pedidos"><i class="fa-solid fa-rotate-right"></i></button>
                    <button type="button" class="icono-btn" data-salir aria-label="Cerrar sesión"><i class="fa-solid fa-right-from-bracket"></i></button>
                </div>
            </div>
            <div class="resumen-sesion">
                <div><b>${pedidos.length}</b><span>Pedidos</span></div>
                <div><b>${pedidos.filter(enCurso).length}</b><span>En curso</span></div>
                <div><b>${activas}</b><span>Garantías activas</span></div>
            </div>
            <div class="chips mt-4" role="tablist" aria-label="Filtrar pedidos" data-filtros></div>
            <div class="space-y-3 mt-4" data-lista></div>`;
        c.querySelector('[data-filtros]').replaceChildren(...filtros.map(([id, texto, n]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip';
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', String(s.filtro === id));
            b.innerHTML = `${escaparHTML(texto)} <span class="opacity-60">${n}</span>`;
            b.addEventListener('click', () => { s.filtro = id; pintarHistorial(); });
            return b;
        }));
        const zona = c.querySelector('[data-lista]');
        if (!lista.length) {
            zona.innerHTML = `<div class="tarjeta text-center py-8">
                <i class="fa-solid fa-box-open text-3xl text-dcRed"></i>
                <p class="font-bold mt-3">${pedidos.length ? 'No hay pedidos en este filtro' : 'Aún no vemos pedidos con este número'}</p>
                <p class="text-sm text-neutral-400 mt-1">${pedidos.length ? 'Prueba con otro filtro.' : 'Si compraste con otro número, cierra sesión y entra con ese.'}</p>
                ${pedidos.length ? '' : '<a href="#catalogo" class="btn-p mt-4"><i class="fa-solid fa-grip"></i> Ver catálogo</a>'}
            </div>`;
        } else zona.replaceChildren(...lista.map(tarjetaPedido));
        c.querySelector('[data-recargar]').addEventListener('click', (e) => { e.currentTarget.querySelector('i').classList.add('fa-spin'); cargarHistorial(); });
        c.querySelector('[data-salir]').addEventListener('click', cerrarSesion);
    }

    async function cargarHistorial() {
        const sesion = leerSesion();
        if (!sesion) { s.pedidos = null; pintarAcceso(); return; }
        if (!s.pedidos) caja().innerHTML = '<div class="skeleton" style="min-height:5rem"></div><div class="skeleton mt-3" style="min-height:11rem"></div><div class="skeleton mt-3" style="min-height:11rem"></div>';
        const { data, error } = await rpc('mis_pedidos', { p_token: sesion.token });
        if (error) {
            if (/SESION_INVALIDA/.test(error.message)) { sesionVencida(); return; }
            caja().innerHTML = `<div class="tarjeta"><p class="font-bold">No pudimos cargar tus pedidos</p><p class="text-sm text-neutral-400 mt-1">Revisa tu conexión.</p><button type="button" class="btn-s mt-3" data-reintentar><i class="fa-solid fa-rotate-right"></i> Reintentar</button></div>`;
            caja().querySelector('[data-reintentar]').addEventListener('click', cargarHistorial);
            return;
        }
        s.pedidos = data ?? [];
        pintarHistorial();
    }

    function sesionVencida() {
        const numero = leerLocal(CLAVE_SESION, null)?.numero ?? '';
        borrarSesion();
        s.pedidos = null;
        s.numero = numero;
        s.paso = 'numero';
        mostrarToast('Tu sesión terminó. Entra de nuevo con tu WhatsApp.', 'info');
        pintarAcceso();
    }

    async function cerrarSesion() {
        const sesion = leerSesion();
        if (sesion) await rpc('cerrar_sesion_portal', { p_token: sesion.token });
        borrarSesion();
        s.pedidos = null;
        s.numero = '';
        s.paso = 'numero';
        mostrarToast('Cerraste sesión en este dispositivo.', 'ok');
        pintarAcceso();
    }

    /* ==================== Accesos (con registro y re-verificación cada 24 h) ==================== */

    async function verAccesos(p, boton) {
        const sesion = leerSesion();
        if (!sesion) { sesionVencida(); return; }
        const original = boton.innerHTML;
        boton.disabled = true;
        boton.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Abriendo…';
        const { data, error } = await rpc('ver_accesos', { p_token: sesion.token, p_compra_id: p.compra_id });
        boton.disabled = false;
        boton.innerHTML = original;
        const r = data?.[0];
        if (error || !r) { mostrarToast('No pudimos abrir tus accesos. Intenta de nuevo.', 'error'); return; }
        if (r.mensaje === 'SESION_INVALIDA') { sesionVencida(); return; }
        if (r.mensaje === 'REVERIFICAR') { reverificar(p, boton); return; }
        if (!r.ok) { mostrarToast(r.mensaje, 'error'); return; }
        mostrarAccesos(p, r.accesos);
    }

    function mostrarAccesos(p, accesos) {
        const cuerpo = document.createElement('div');
        cuerpo.innerHTML = `
            <p class="text-sm text-neutral-400">Pedido <b class="font-mono text-white">#${escaparHTML(p.codigo)}</b> · ${escaparHTML(p.producto ?? '')}</p>
            <div class="accesos-caja mt-4 oculto" data-caja>
                <pre class="font-mono" data-texto></pre>
                <button type="button" class="velo" data-mostrar><i class="fa-solid fa-eye"></i> Toca para mostrar</button>
            </div>
            <div class="grid grid-cols-2 gap-2 mt-3">
                <button type="button" class="btn-s" data-alternar><i class="fa-solid fa-eye"></i> Mostrar</button>
                <button type="button" class="btn-p" data-copiar><i class="fa-solid fa-copy"></i> Copiar</button>
            </div>
            <p class="text-xs text-neutral-500 mt-3 text-center" data-cuenta></p>
            <div class="alerta-red mt-4"><i class="fa-solid fa-triangle-exclamation"></i> Para conservar tu garantía no cambies el correo ni la contraseña y usa solo tu perfil asignado. Este acceso quedó registrado por seguridad.</div>`;
        // textContent: la clave se muestra EXACTA (con * _ ~ y espacios), nunca como HTML
        cuerpo.querySelector('[data-texto]').textContent = accesos;
        const cajaAcc = cuerpo.querySelector('[data-caja]');
        const alternar = cuerpo.querySelector('[data-alternar]');
        const visible = (si) => {
            cajaAcc.classList.toggle('oculto', !si);
            alternar.innerHTML = si ? '<i class="fa-solid fa-eye-slash"></i> Ocultar' : '<i class="fa-solid fa-eye"></i> Mostrar';
        };
        cuerpo.querySelector('[data-mostrar]').addEventListener('click', () => visible(true));
        alternar.addEventListener('click', () => visible(cajaAcc.classList.contains('oculto')));
        cuerpo.querySelector('[data-copiar]').addEventListener('click', () => copiarTexto(accesos, 'Accesos copiados'));
        let resto = OCULTAR_ACCESOS_SEG;
        const cuenta = cuerpo.querySelector('[data-cuenta]');
        const tic = () => { cuenta.innerHTML = `<i class="fa-regular fa-clock"></i> Se cerrará solo en ${resto}s`; };
        tic();
        const id = setInterval(() => { resto -= 1; tic(); if (resto <= 0) cerrarHoja(); }, 1000);
        abrirHoja('Tus accesos', cuerpo, { alCerrar: () => { clearInterval(id); cuerpo.querySelector('[data-texto]').textContent = ''; } });
    }

    // Pasadas 24 h desde la última verificación se pide un código nuevo antes de mostrar claves
    async function reverificar(p, boton) {
        const sesion = leerSesion();
        const cuerpo = document.createElement('div');
        cuerpo.innerHTML = `
            <p class="text-sm text-neutral-400">Por tu seguridad, antes de mostrar claves confirmamos que sigues siendo tú. Te enviamos un código a <b class="font-mono text-white">+57 ${escaparHTML(enmascarar(sesion?.numero))}</b>.</p>
            <div class="mt-5" data-otp></div>
            <p class="text-xs text-center min-h-[1rem] mt-3 text-red-300" data-error></p>
            <div class="reloj-otp" data-reloj></div>`;
        const error = cuerpo.querySelector('[data-error]');
        const otp = cajaCodigo(async (codigo) => {
            otp.ocupado(true);
            const { data } = await rpc('reverificar_sesion', { p_token: sesion.token, p_codigo: codigo });
            const r = data?.[0];
            if (r?.mensaje === 'SESION_INVALIDA') { cerrarHoja(); sesionVencida(); return; }
            if (!r?.ok) { otp.ocupado(false); otp.sacudir(); otp.limpiar(); error.textContent = r?.mensaje ?? 'No pudimos verificar el código.'; return; }
            otp.exito();
            setTimeout(() => { cerrarHoja(); setTimeout(() => verAccesos(p, boton), 260); }, 450);
        });
        cuerpo.querySelector('[data-otp]').append(otp.nodo);
        const enviar = async () => {
            const r = await pedirCodigo(sesion.numero);
            if (!r.ok) error.textContent = r.mensaje;
        };
        const reloj = cuerpo.querySelector('[data-reloj]');
        const reenviar = async () => {
            await enviar();
            mostrarToast('Te enviamos un código nuevo.', 'ok');
            detenerRelojes();
            relojCodigo(reloj, reenviar);
            otp.limpiar();
        };
        relojCodigo(reloj, reenviar);
        abrirHoja('Confirma que eres tú', cuerpo, { alCerrar: detenerRelojes });
        otp.enfocar();
        await enviar();
    }

    /* ==================== Arranque ==================== */

    window.Sesion = { activa: () => Boolean(leerSesion()), cargarHistorial, cerrarSesion };

    document.addEventListener('DOMContentLoaded', () => {
        cargarHistorial();
        // Al volver a "Mis pedidos" se refresca el estado (los pedidos avanzan mientras el cliente navega)
        document.addEventListener('dc:vista', (e) => { if (e.detail === 'cuenta' && leerSesion() && s.pedidos) cargarHistorial(); });
    });
})();
