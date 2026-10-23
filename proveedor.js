// proveedor.js — Panel admin: qué categorías de Emprende Red se muestran en la tienda y en el bot (wo-047).
// Cada categoría tiene un interruptor; al activarla, sus productos con stock aparecen al instante (precios_publicos)
// con tu precio = costo de distribuidor + 50 %. Las categorías nuevas del proveedor llegan ocultas.
(() => {
    'use strict';
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const cop = (n) => (Number(n) > 0 ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n) : '—');
    const ACENTOS = { RELOJERIA: 'Relojería', JOYERIA: 'Joyería', PAPELERIA: 'Papelería', PERFUMERIA: 'Perfumería', FERRETERIA: 'Ferretería', CACHARRERIA: 'Cacharrería', BARBERIA: 'Barbería', DULCERIA: 'Dulcería', TECNOLOGIA: 'Tecnología' };
    const nombre = (c) => c === 'GENERAL' ? 'Otros (sin categoría del proveedor)' : String(c ?? '').split(/\s+/).map((w, i) => { const a = ACENTOS[w] ?? w.charAt(0) + w.slice(1).toLowerCase(); return i ? a.toLowerCase() : a; }).join(' ');

    async function cargar(sb, caja) {
        caja.innerHTML = '<p class="prov-nota">Cargando categorías del proveedor…</p>';
        const { data, error } = await sb.rpc('categorias_proveedor', { p_proveedor: 'emprendered' });
        if (error) {
            caja.innerHTML = error.code === 'PGRST202' || /categorias_proveedor/.test(error.message ?? '')
                ? '<p class="prov-nota">Falta aplicar <b>supabase/wo-047-proveedor-y-rastreo.sql</b> en Supabase (está en APLICAR-PENDIENTES.sql). Mientras tanto solo se muestra Tecnología.</p>'
                : `<p class="prov-nota">No se pudieron leer las categorías: ${esc(error.message)}</p>`;
            return;
        }
        pintar(sb, caja, data ?? []);
    }

    function pintar(sb, caja, filas) {
        const visibles = filas.filter((f) => f.visible);
        caja.innerHTML = `
            <div class="prov-cabeza">
                <p>Tu precio = <b>costo de distribuidor + 50 %</b> (redondeado a $100). Stock y precios se actualizan solos cada 6 horas.
                Activa solo lo que puedas vender y respaldar: las réplicas, artículos para adultos, vapeadores y cuentas de streaming de terceros nunca se importan.</p>
                <span class="prov-resumen">${visibles.length} de ${filas.length} categorías visibles · ${visibles.reduce((s, f) => s + (f.con_stock ?? 0), 0)} productos en la tienda</span>
            </div>
            <div class="prov-lista">${filas.map((f) => `
                <label class="prov-fila${f.visible ? ' activa' : ''}">
                    <span class="prov-nombre"><b>${esc(nombre(f.categoria))}</b>
                        <small>${f.con_stock ?? 0} con stock de ${f.productos ?? 0} · costo prom. ${cop(f.costo_promedio)} → venta prom. ${cop(f.precio_promedio)}</small></span>
                    <input type="checkbox" class="prov-switch" data-cat="${esc(f.categoria)}" ${f.visible ? 'checked' : ''} aria-label="Mostrar ${esc(nombre(f.categoria))}">
                </label>`).join('')}</div>`;
        caja.querySelectorAll('[data-cat]').forEach((i) => i.addEventListener('change', async () => {
            i.disabled = true;
            const { data, error } = await sb.rpc('cambiar_categoria_proveedor', { p_proveedor: 'emprendered', p_categoria: i.dataset.cat, p_visible: i.checked });
            const r = data?.[0];
            if (error || !r?.ok) { i.checked = !i.checked; window.mostrarToast?.(r?.mensaje ?? error?.message ?? 'No se pudo cambiar.', 'error'); }
            else window.mostrarToast?.(`${nombre(i.dataset.cat)}: ${r.mensaje}`, 'ok');
            i.disabled = false;
            i.closest('.prov-fila').classList.toggle('activa', i.checked);
        }));
    }
    window.Proveedor = { cargar, nombre };
})();
