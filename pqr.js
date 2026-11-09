// pqr.js — Libro de PQR del panel (vista «Pagos & Agente Bot», wo-056): consultas, reclamos, peticiones y solicitudes de
// datos personales con su plazo legal en días hábiles. Lo que vence primero va arriba. La respuesta queda como constancia
// (al cliente se la envías tú por WhatsApp). Datos: pqr_panel(), crear_pqr(), responder_pqr() (solo administradores).
(() => {
    'use strict';
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const TIPOS = { consulta: 'Consulta', reclamo: 'Reclamo', peticion: 'Petición', datos: 'Datos personales' };
    const CANALES = { whatsapp: 'WhatsApp', panel: 'Panel', web: 'Web', correo: 'Correo' };
    const campo = 'min-h-[44px] bg-dcDarkBg/70 ring-1 ring-white/10 rounded-xl px-3 text-base sm:text-sm text-white focus:outline-none focus:ring-2 focus:ring-dcRed/60';
    const fecha = (d) => new Date(`${String(d).slice(0, 10)}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });

    // Días calendario que faltan para el vencimiento (hora de Colombia); negativo = vencida
    function diasPara(venceEl, ahora = new Date()) {
        const hoy = ahora.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
        return Math.round((Date.parse(`${String(venceEl).slice(0, 10)}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 864e5);
    }
    function semaforo(q, ahora) {
        if (q.estado === 'CERRADA') return { texto: 'Cerrada', clase: 'text-neutral-400' };
        const d = diasPara(q.vence_el, ahora);
        if (d < 0) return { texto: `Vencida hace ${-d} día${d === -1 ? '' : 's'}`, clase: 'text-rose-300' };
        if (d === 0) return { texto: 'Vence hoy', clase: 'text-rose-300' };
        if (d <= 3) return { texto: `Vence en ${d} día${d === 1 ? '' : 's'}`, clase: 'text-amber-300' };
        return { texto: `Vence el ${fecha(q.vence_el)}`, clase: 'text-emerald-300' };
    }

    function tarjeta(q, ahora) {
        const s = semaforo(q, ahora);
        return `<form class="rounded-2xl bg-dcDarkBg/50 ring-1 ring-white/10 p-4 space-y-2" data-pqr="${esc(q.id)}">
            <div class="flex flex-wrap items-start justify-between gap-2">
                <p class="text-sm font-bold">#${esc(q.id)} · ${esc(TIPOS[q.tipo] ?? q.tipo)}</p>
                <span class="text-[11px] font-bold ${s.clase}"><i class="fa-regular fa-clock"></i> ${esc(s.texto)}</span>
            </div>
            <p class="text-xs text-neutral-400">+${esc(q.whatsapp)} · ${esc(CANALES[q.canal] ?? q.canal)} · recibida ${esc(new Date(q.created_at).toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }))}</p>
            <p class="text-sm">${esc(q.detalle)}</p>
            ${q.respuesta ? `<p class="text-xs text-neutral-300"><b>Respuesta:</b> ${esc(q.respuesta)}</p>` : ''}
            ${q.estado === 'CERRADA' ? '' : `<div class="flex flex-wrap gap-2 pt-1">
                <a class="min-h-[44px] px-3 inline-flex items-center rounded-xl bg-emerald-600/20 ring-1 ring-emerald-500/40 text-emerald-300 text-xs font-bold" target="_blank" rel="noopener" href="https://wa.me/${esc(q.whatsapp)}"><i class="fa-brands fa-whatsapp mr-1"></i> Escribirle</a>
                <input name="respuesta" required minlength="3" maxlength="2000" placeholder="Qué le respondiste (queda como constancia)" aria-label="Respuesta a la PQR ${esc(q.id)}" class="${campo} flex-1 min-w-[12rem]" value="${esc(q.respuesta ?? '')}">
                <button type="submit" name="cerrar" value="no" class="min-h-[44px] px-4 rounded-xl bg-white/5 ring-1 ring-white/10 text-xs font-bold text-neutral-300 hover:text-white">Guardar</button>
                <button type="submit" name="cerrar" value="si" class="min-h-[44px] px-4 rounded-xl bg-dcRed text-white text-xs font-bold"><i class="fa-solid fa-check mr-1"></i> Responder y cerrar</button>
            </div>`}
        </form>`;
    }

    async function cargar(sb, caja, { avisar = () => {} } = {}) {
        if (!caja) return;
        const cuenta = document.getElementById('pqr-cuenta');
        const { data, error } = await sb.rpc('pqr_panel');
        if (error) {
            caja.innerHTML = `<p class="text-xs text-neutral-500">${error.code === 'PGRST202' || /pqr_panel/.test(error.message ?? '') ? 'Para llevar el libro de PQR aplica <b>supabase/wo-056-libro-pqr.sql</b> en Supabase.' : `No se pudo leer el libro: ${esc(error.message)}`}</p>`;
            return;
        }
        const filas = data ?? [];
        const abiertas = filas.filter((q) => q.estado !== 'CERRADA');
        if (cuenta) { cuenta.textContent = abiertas.length; cuenta.hidden = !abiertas.length; }
        caja.innerHTML = filas.length ? filas.map((q) => tarjeta(q)).join('') : '<p class="text-xs text-neutral-500"><i class="fa-solid fa-circle-check"></i> No hay PQR registradas.</p>';
        caja.querySelectorAll('form[data-pqr]').forEach((f) => f.addEventListener('submit', async (e) => {
            e.preventDefault();
            const cerrar = e.submitter?.value !== 'no';
            const { data: x, error: err } = await sb.rpc('responder_pqr', { p_id: Number(f.dataset.pqr), p_respuesta: f.respuesta.value.trim(), p_cerrar: cerrar });
            const r = x?.[0];
            avisar(r?.mensaje ?? err?.message ?? 'No se pudo guardar.', r?.ok ? 'ok' : 'error');
            if (r?.ok) cargar(sb, caja, { avisar });
        }));
    }

    async function crear(sb, form, caja, { avisar = () => {} } = {}) {
        const { data, error } = await sb.rpc('crear_pqr', { p_whatsapp: form.whatsapp.value, p_tipo: form.tipo.value, p_detalle: form.detalle.value, p_canal: form.canal.value });
        const r = data?.[0];
        avisar(r?.mensaje ?? error?.message ?? 'No se pudo registrar.', r?.ok ? 'ok' : 'error');
        if (r?.ok) { form.reset(); cargar(sb, caja, { avisar }); }
    }

    window.Pqr = { cargar, crear, diasPara, semaforo, tarjeta };
})();
