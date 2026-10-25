// admin-clave.js — Contraseña del panel (23/10/2026). La contraseña NO está guardada en ningún archivo: vive en Supabase Auth.
//  · «¿Olvidaste tu contraseña?» en el ingreso → Supabase envía un enlace al correo de administrador.
//  · Al volver desde ese enlace (evento PASSWORD_RECOVERY) → ventana para poner la nueva contraseña.
//  · Ajustes → «Cambiar contraseña» con la sesión abierta.
// Usa el supabaseClient de admin.js (se carga después de admin.js).
(() => {
    const sb = window.supabaseClient ?? (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
    if (!sb) return;
    const MIN = 10;
    const destino = `${location.origin}${location.pathname}`;

    // Ventana para escribir la contraseña nueva (sirve para recuperar y para cambiar)
    const ventana = document.createElement('div');
    ventana.id = 'clave-ventana';
    ventana.hidden = true;
    ventana.setAttribute('role', 'dialog');
    ventana.setAttribute('aria-modal', 'true');
    ventana.setAttribute('aria-labelledby', 'clave-titulo');
    ventana.className = 'clave-ventana';
    if (!document.getElementById('clave-estilos')) {
        const st = document.createElement('style');
        st.id = 'clave-estilos';
        st.textContent = '.clave-ventana{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:16px;background:rgb(8 10 14 / .72);backdrop-filter:blur(6px)}'
            + '.clave-ventana[hidden]{display:none!important}'
            + '.clave-ventana form{width:min(100%,24rem);display:grid;gap:14px;padding:24px;border-radius:24px;background:#fff;color:#0F111A;box-shadow:0 30px 80px -20px rgb(0 0 0 / .6)}'
            + 'html.dark .clave-ventana form{background:#151920;color:#F3F4F6}'
            + '.clave-ventana h2{margin:0;font:800 18px/1.3 Inter,system-ui,sans-serif}.clave-ventana p{margin:0;font-size:12px;opacity:.75}'
            + '.clave-ventana input{width:100%;min-height:50px;padding:0 14px;border-radius:14px;border:1px solid rgb(15 17 26 / .15);background:transparent;color:inherit;font:600 16px Inter,system-ui,sans-serif;box-sizing:border-box}'
            + '.clave-ventana input:focus{outline:none;border-color:#E03445;box-shadow:0 0 0 4px rgb(224 52 69 / .15)}'
            + '.clave-ventana .botones{display:flex;gap:8px}.clave-ventana button{flex:1;min-height:48px;border-radius:14px;font:800 14px Inter,system-ui,sans-serif;cursor:pointer;border:1px solid rgb(15 17 26 / .15);background:transparent;color:inherit}'
            + '.clave-ventana button[type=submit]{background:#E03445;border-color:#E03445;color:#fff}.clave-ventana button:disabled{opacity:.6}'
            + '#clave-aviso.ok{color:#059669}#clave-aviso.mal{color:#DC2626}';
        document.head.appendChild(st);
    }
    ventana.innerHTML = `
        <form id="clave-form" class="w-full max-w-sm rounded-3xl bg-dcDarkCard ring-1 ring-white/10 p-6 space-y-4 shadow-2xl">
            <h2 id="clave-titulo" class="font-black text-lg text-white">Nueva contraseña del panel</h2>
            <p class="text-xs text-neutral-400">Mínimo ${MIN} caracteres. Usa una que no uses en otro lado y guárdala en tu gestor de contraseñas.</p>
            <label class="block"><span class="sr-only">Contraseña nueva</span>
                <input type="password" id="clave-1" autocomplete="new-password" minlength="${MIN}" required placeholder="Contraseña nueva"
                    class="w-full min-h-[52px] bg-dcDarkBg/70 ring-1 ring-white/10 rounded-2xl px-4 text-base sm:text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-dcRed/70"></label>
            <label class="block"><span class="sr-only">Repite la contraseña</span>
                <input type="password" id="clave-2" autocomplete="new-password" minlength="${MIN}" required placeholder="Repítela"
                    class="w-full min-h-[52px] bg-dcDarkBg/70 ring-1 ring-white/10 rounded-2xl px-4 text-base sm:text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-dcRed/70"></label>
            <p id="clave-aviso" role="status" class="text-xs font-bold min-h-[1rem]"></p>
            <div class="botones">
                <button type="button" id="clave-cancelar" class="flex-1 min-h-[48px] rounded-2xl ring-1 ring-white/15 text-neutral-300 font-bold text-sm">Cancelar</button>
                <button type="submit" id="clave-guardar" class="flex-1 min-h-[48px] rounded-2xl bg-dcRed text-white font-black text-sm disabled:opacity-60">Guardar</button>
            </div>
        </form>`;
    document.body.appendChild(ventana);
    const aviso = ventana.querySelector('#clave-aviso');
    const abrir = () => { ventana.hidden = false; aviso.textContent = ''; ventana.querySelector('#clave-1').focus(); };
    const cerrar = () => { ventana.hidden = true; ventana.querySelector('#clave-form').reset(); };
    ventana.querySelector('#clave-cancelar').addEventListener('click', cerrar);
    ventana.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar(); });
    ventana.querySelector('#clave-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const a = ventana.querySelector('#clave-1').value, b = ventana.querySelector('#clave-2').value;
        aviso.className = 'mal';
        if (a.length < MIN) { aviso.textContent = `Debe tener al menos ${MIN} caracteres.`; return; }
        if (a !== b) { aviso.textContent = 'Las dos contraseñas no coinciden.'; return; }
        const btn = ventana.querySelector('#clave-guardar');
        btn.disabled = true;
        const { error } = await sb.auth.updateUser({ password: a });
        btn.disabled = false;
        if (error) { aviso.textContent = /session|sesi/i.test(error.message) ? 'El enlace venció. Pide uno nuevo con «¿Olvidaste tu contraseña?».' : `No se pudo: ${error.message}`; return; }
        aviso.className = 'ok';
        aviso.textContent = 'Listo: contraseña actualizada.';
        setTimeout(cerrar, 1400);
    });

    // «¿Olvidaste tu contraseña?» bajo el botón de ingreso
    const form = document.getElementById('form-login');
    if (form) {
        const caja = document.createElement('div');
        caja.className = 'text-center space-y-2';
        caja.innerHTML = `<button type="button" id="clave-olvido" class="text-xs font-bold text-neutral-400 hover:text-white underline underline-offset-4 min-h-[44px] px-2">¿Olvidaste tu contraseña?</button>
            <p id="clave-olvido-aviso" role="status" class="text-xs font-semibold text-neutral-300"></p>`;
        form.appendChild(caja);
        caja.querySelector('#clave-olvido').addEventListener('click', async () => {
            const correo = document.getElementById('login-email')?.value.trim();
            const msg = caja.querySelector('#clave-olvido-aviso');
            if (!correo) { msg.textContent = 'Escribe primero tu correo de administrador.'; document.getElementById('login-email')?.focus(); return; }
            const { error } = await sb.auth.resetPasswordForEmail(correo, { redirectTo: destino });
            // Mismo mensaje exista o no el correo (no se revela quién es administrador)
            msg.textContent = error && !/rate|seconds/i.test(error.message) ? `No se pudo enviar: ${error.message}` : 'Si ese correo es de un administrador, te llegó un enlace para crear una contraseña nueva (revisa también spam).';
        });
    }

    // Ajustes → «Cambiar contraseña» (con la sesión abierta)
    const fila = document.getElementById('ajustes-email')?.closest('div');
    if (fila && !document.getElementById('ajuste-cambiar-clave')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'ajuste-cambiar-clave';
        btn.className = 'w-full flex items-center justify-between gap-3 rounded-2xl bg-dcDarkBg/60 ring-1 ring-white/5 px-4 min-h-[52px] text-left';
        btn.innerHTML = '<span class="text-neutral-400 font-semibold"><i class="fa-solid fa-key mr-2 text-dcRed"></i>Cambiar contraseña del panel</span><i class="fa-solid fa-chevron-right text-neutral-500"></i>';
        btn.addEventListener('click', abrir);
        fila.after(btn);
    }

    // Volvió desde el enlace del correo: por el evento de Supabase o, si ya pasó antes de cargar este script, por la dirección
    let abierta = false;
    const abrirUnaVez = () => { if (abierta) return; abierta = true; abrir(); };
    sb.auth.onAuthStateChange((evento) => { if (evento === 'PASSWORD_RECOVERY') abrirUnaVez(); });
    if (/type=recovery/.test(location.hash) || /type=recovery/.test(location.search)) {
        // Espera a que Supabase guarde la sesión del enlace y abre la ventana encima de todo
        const intentar = async (n = 0) => {
            const { data } = await sb.auth.getSession();
            if (data?.session || n > 20) abrirUnaVez(); else setTimeout(() => intentar(n + 1), 250);
        };
        intentar();
    }
    // Error del enlace (vencido o ya usado): se explica en el ingreso
    const error = new URLSearchParams(location.hash.slice(1)).get('error_description');
    if (error) {
        const msg = document.getElementById('clave-olvido-aviso');
        if (msg) msg.textContent = /expired|invalid/i.test(error) ? 'El enlace del correo venció o ya se usó: pide uno nuevo con «¿Olvidaste tu contraseña?».' : `No se pudo usar el enlace: ${error}`;
    }
    window.DCClave = { abrir };
})();
