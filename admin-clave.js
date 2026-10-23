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
    ventana.className = 'fixed inset-0 z-[90] grid place-items-center bg-black/70 backdrop-blur-sm p-4';
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
            <div class="flex gap-2">
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
        aviso.className = 'text-xs font-bold min-h-[1rem] text-red-300';
        if (a.length < MIN) { aviso.textContent = `Debe tener al menos ${MIN} caracteres.`; return; }
        if (a !== b) { aviso.textContent = 'Las dos contraseñas no coinciden.'; return; }
        const btn = ventana.querySelector('#clave-guardar');
        btn.disabled = true;
        const { error } = await sb.auth.updateUser({ password: a });
        btn.disabled = false;
        if (error) { aviso.textContent = /session|sesi/i.test(error.message) ? 'El enlace venció. Pide uno nuevo con «¿Olvidaste tu contraseña?».' : `No se pudo: ${error.message}`; return; }
        aviso.className = 'text-xs font-bold min-h-[1rem] text-emerald-300';
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

    // Volvió desde el enlace del correo
    sb.auth.onAuthStateChange((evento) => { if (evento === 'PASSWORD_RECOVERY') abrir(); });
    window.DCClave = { abrir };
})();
