// finanzas.js — Centro financiero del panel (vista "Finanzas" de admin.html). Datos: finanzas_panel() (wo-046).
// Solo lectura: cuánto entra (ventas cobradas), cuánto cuesta (costo real o cotizado), margen, lo que falta entregar,
// lo que falta cobrar e inventario de pines. Las cuentas son funciones puras (Finanzas.resumir) para probarlas aparte.
(() => {
    const COP = (v) => `$${Math.round(Number(v) || 0).toLocaleString('es-CO')}`;
    const pct = (v) => `${(Math.round((Number(v) || 0) * 10) / 10).toLocaleString('es-CO')} %`;
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const NOMBRES_TIPO = { streaming: 'Streaming', licencias: 'Licencias y apps', pines: 'Pines', recargas: 'Recargas', tecnologia: 'Tecnología', servicios: 'Servicios', alquiler: 'Alquiler', otro: 'Otros' };
    const diaDe = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

    // Rango de fechas (Colombia) para cada periodo
    function rango(periodo, ahora = new Date()) {
        const hoy = new Date(`${diaDe(ahora)}T00:00:00-05:00`);
        const dias = { hoy: 0, '7d': 6, '30d': 29 }[periodo];
        const desde = periodo === 'mes' ? new Date(`${diaDe(ahora).slice(0, 8)}01T00:00:00-05:00`) : new Date(hoy.getTime() - (dias ?? 29) * 864e5);
        return { desde, hasta: new Date(hoy.getTime() + 864e5) };
    }

    // Cuentas del periodo (puras): datos = respuesta de finanzas_panel; tipos = nombre de producto → tipo
    function resumir(datos, tipos = {}, { desde, hasta } = {}) {
        const movs = (datos?.movimientos ?? []).map((m) => ({ ...m, venta: Number(m.venta) || 0, costo: m.costo === null || m.costo === undefined ? null : Number(m.costo) }));
        const pagados = movs.filter((m) => m.pagado);
        const ventas = pagados.reduce((a, m) => a + m.venta, 0);
        const conCosto = pagados.filter((m) => m.costo !== null);
        const costo = conCosto.reduce((a, m) => a + m.costo, 0);
        const margen = conCosto.reduce((a, m) => a + (m.venta - m.costo), 0);
        const ventasConCosto = conCosto.reduce((a, m) => a + m.venta, 0);
        const porEntregar = pagados.filter((m) => m.estado !== 'ENTREGADO');
        const sinPago = movs.filter((m) => !m.pagado && m.estado === 'REVISION_MANUAL' && m.canal === 'whatsapp');
        const agrupar = (clave) => {
            const g = new Map();
            for (const m of pagados) {
                const k = clave(m);
                const x = g.get(k) ?? { clave: k, ventas: 0, margen: 0, pedidos: 0, conCosto: 0 };
                x.ventas += m.venta; x.pedidos += 1;
                if (m.costo !== null) { x.margen += m.venta - m.costo; x.conCosto += 1; }
                g.set(k, x);
            }
            return [...g.values()].sort((a, b) => b.ventas - a.ventas);
        };
        // Serie diaria continua (días sin ventas = 0), en hora de Colombia
        const serie = [];
        if (desde && hasta) {
            const porDia = new Map();
            for (const m of pagados) porDia.set(diaDe(m.fecha), (porDia.get(diaDe(m.fecha)) ?? 0) + m.venta);
            for (let t = desde.getTime(); t < hasta.getTime(); t += 864e5) { const d = diaDe(new Date(t + 6 * 3600e3)); serie.push({ dia: d, ventas: porDia.get(d) ?? 0 }); }
        }
        return {
            ventas, costo, margen, margenPct: ventasConCosto ? (margen / ventasConCosto) * 100 : 0, pedidos: pagados.length,
            ticket: pagados.length ? ventas / pagados.length : 0, sinCosto: pagados.length - conCosto.length,
            porEntregar: { pedidos: porEntregar.length, total: porEntregar.reduce((a, m) => a + m.venta, 0) },
            porCobrar: { pedidos: sinPago.length + (Number(datos?.por_cobrar?.ordenes) || 0), total: sinPago.reduce((a, m) => a + m.venta, 0) + (Number(datos?.por_cobrar?.total) || 0) },
            inventario: { codigos: Number(datos?.inventario?.codigos) || 0, costo: Number(datos?.inventario?.costo) || 0 },
            porCategoria: agrupar((m) => NOMBRES_TIPO[tipos[m.producto] ?? 'otro'] ?? 'Otros'),
            porCanal: agrupar((m) => (m.canal === 'web' ? 'Tienda web' : 'WhatsApp')),
            productos: agrupar((m) => m.producto).slice(0, 8),
            serie, movimientos: movs,
        };
    }

    function csv(r) {
        const filas = [['Referencia', 'Fecha', 'Producto', 'Plan', 'Canal', 'Estado', 'Pagado', 'Venta', 'Costo', 'Margen']];
        for (const m of r.movimientos) filas.push([m.referencia, new Date(m.fecha).toLocaleString('es-CO', { timeZone: 'America/Bogota' }), m.producto, m.variante ?? '', m.canal, m.estado, m.pagado ? 'sí' : 'no', m.venta, m.costo ?? '', m.costo === null ? '' : m.venta - m.costo]);
        return filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    }

    // Gráfico de barras de una serie (ventas cobradas por día): barras finas con punta redondeada y detalle al pasar
    function grafico(serie, ancho0 = 720) {
        const W = Math.max(260, Math.round(ancho0)), H = 220, M = { t: 12, r: 8, b: 26, l: 8 };
        const max = Math.max(1, ...serie.map((d) => d.ventas));
        const paso = (W - M.l - M.r) / Math.max(1, serie.length);
        const ancho = Math.min(24, Math.max(4, paso - 4));
        const y = (v) => M.t + (H - M.t - M.b) * (1 - v / max);
        const barras = serie.map((d, i) => {
            const x = M.l + i * paso + (paso - ancho) / 2, h = H - M.b - y(d.ventas);
            const r = Math.min(4, h / 2, ancho / 2);
            const camino = h > 0 ? `M${x},${H - M.b} v${-(h - r)} q0,${-r} ${r},${-r} h${ancho - 2 * r} q${r},0 ${r},${r} v${h - r} z` : '';
            return `<g data-i="${i}"><rect x="${M.l + i * paso}" y="${M.t}" width="${paso}" height="${H - M.t - M.b}" fill="transparent"/>${camino ? `<path d="${camino}" class="fin-barra"/>` : ''}</g>`;
        }).join('');
        const etiquetas = serie.map((d, i) => (serie.length <= 8 || i % Math.ceil(serie.length / 7) === 0 || i === serie.length - 1)
            ? `<text x="${M.l + i * paso + paso / 2}" y="${H - 8}" text-anchor="middle" class="fin-eje">${d.dia.slice(8)}/${d.dia.slice(5, 7)}</text>` : '').join('');
        return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="fin-svg" role="img" aria-label="Ventas cobradas por día">
            <line x1="${M.l}" x2="${W - M.r}" y1="${H - M.b}" y2="${H - M.b}" class="fin-base"/>${barras}${etiquetas}</svg>`;
    }

    function pintar(caja, r, { periodoTexto }) {
        const tile = (titulo, valor, detalle, tono = '') => `<div class="fin-tile ${tono}"><p class="fin-tile-t">${esc(titulo)}</p><p class="fin-tile-v">${valor}</p>${detalle ? `<p class="fin-tile-d">${detalle}</p>` : ''}</div>`;
        const tabla = (titulo, filas) => `<section class="fin-bloque"><h3>${esc(titulo)}</h3>${filas.length ? `<table class="fin-tabla"><thead><tr><th></th><th>Pedidos</th><th>Ventas</th><th>Margen</th></tr></thead><tbody>
            ${filas.map((f) => `<tr><td>${esc(f.clave)}</td><td>${f.pedidos}</td><td>${COP(f.ventas)}</td><td>${f.conCosto ? COP(f.margen) : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="fin-vacio">Sin ventas cobradas en el periodo.</p>'}</section>`;
        caja.innerHTML = `
            <div class="fin-tiles">
                ${tile('Ventas cobradas', COP(r.ventas), `${r.pedidos} pedidos · ticket ${COP(r.ticket)}`)}
                ${tile('Costo de lo vendido', COP(r.costo), r.sinCosto ? `⚠️ ${r.sinCosto} sin costo registrado` : 'Todo con costo registrado')}
                ${tile('Margen bruto', COP(r.margen), `${pct(r.margenPct)} sobre lo que tiene costo`, r.margen < 0 ? 'fin-mal' : 'fin-bien')}
                ${tile('Por entregar', COP(r.porEntregar.total), `${r.porEntregar.pedidos} pedidos pagados sin entregar`, r.porEntregar.pedidos ? 'fin-aviso' : '')}
                ${tile('Por cobrar', COP(r.porCobrar.total), `${r.porCobrar.pedidos} pedidos esperando pago`)}
                ${tile('Inventario de pines', COP(r.inventario.costo), `${r.inventario.codigos} códigos disponibles`)}
            </div>
            <section class="fin-bloque"><h3>Ventas cobradas por día · ${esc(periodoTexto)}</h3><div class="fin-grafico">${grafico(r.serie, (caja.clientWidth || 760) - 38)}<div class="fin-tip" hidden></div></div></section>
            <div class="fin-columnas">${tabla('Por categoría', r.porCategoria)}${tabla('Por canal', r.porCanal)}</div>
            ${tabla('Productos que más venden', r.productos)}
            <div class="fin-acciones"><button type="button" class="fin-btn" data-fin-csv><i class="fa-solid fa-file-csv"></i> Exportar movimientos (CSV)</button>
            <span class="fin-nota">Venta = precio del pedido. Costo = costo real registrado de la compra o, si falta, el cotizado al proveedor. Margen solo de pedidos con costo.</span></div>`;
        const tip = caja.querySelector('.fin-tip');
        caja.querySelectorAll('.fin-svg g[data-i]').forEach((g) => {
            const d = r.serie[Number(g.dataset.i)];
            const mostrar = (e) => {
                const zona = caja.querySelector('.fin-grafico').getBoundingClientRect();
                tip.hidden = false;
                tip.innerHTML = `<b>${new Date(`${d.dia}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })}</b><span>${COP(d.ventas)}</span>`;
                tip.style.left = `${Math.min(zona.width - 140, Math.max(0, e.clientX - zona.left - 60))}px`;
            };
            g.addEventListener('pointerenter', mostrar); g.addEventListener('pointermove', mostrar);
            g.addEventListener('pointerleave', () => { tip.hidden = true; });
        });
        caja.querySelector('[data-fin-csv]').addEventListener('click', () => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob(['﻿' + csv(r)], { type: 'text/csv;charset=utf-8' }));
            a.download = `dc-tecnology-finanzas-${new Date().toLocaleDateString('en-CA')}.csv`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        });
    }

    let tipos = null;
    async function cargar(sb, caja, periodo = '30d') {
        const { desde, hasta } = rango(periodo);
        caja.innerHTML = '<div class="fin-cargando">Cargando finanzas…</div>';
        if (!tipos) {
            try { tipos = Object.fromEntries((await (await fetch('/productos.json', { cache: 'no-cache' })).json()).map((p) => [p.nombre, p.tipo])); } catch { tipos = {}; }
        }
        const { data, error } = await sb.rpc('finanzas_panel', { p_desde: desde.toISOString(), p_hasta: hasta.toISOString() });
        if (error) {
            caja.innerHTML = `<div class="fin-vacio">⚠️ No pude leer las finanzas (${esc(error.message)}). Si dice que no existe la función, aplica <b>supabase/wo-046-finanzas.sql</b> en Supabase.</div>`;
            return;
        }
        const textos = { hoy: 'hoy', '7d': 'últimos 7 días', '30d': 'últimos 30 días', mes: 'este mes' };
        pintar(caja, resumir(data, tipos, { desde, hasta }), { periodoTexto: textos[periodo] });
    }

    window.Finanzas = { resumir, rango, csv, cargar };
})();
