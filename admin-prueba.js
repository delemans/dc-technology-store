// admin-prueba.js — Panel → Prueba del sistema (WO-036).
// 1) En vivo (solo lectura): diagnostico_sistema() en Supabase → SQL aplicados, métodos de pago, colas y latido de n8n.
// 2) Simulación: una venta completa con el código REAL de los nodos del bot (n8n/simulador-nodos.js, generado).
//    No llama a la IA, no envía WhatsApp, no cobra, no escribe en la base y no toca ancpagos.com: lo externo
//    (respuesta de la IA, catálogo y página del pedido en ANC, extracción) se reemplaza por datos de prueba.

(() => {
    const caja = (id) => document.getElementById(id);
    const PRODUCTO = 'Netflix Premium 4K';
    const VARIANTE = 'Pantalla Colombia 26 días';
    const ANC = { producto: 'Netflix', plan: 'Pantalla 26 dias' };
    const CLIENTE = '573000000001';
    const ACCESOS = { usuario: 'demo.cliente@dctecnology.xyz', clave: 'Demo-2026*', perfil: '2', pin: '1234' };

    async function cargarSimulador() {
        if (window.SimuladorFlujo) return window.SimuladorFlujo;
        await new Promise((listo, falla) => {
            const s = document.createElement('script');
            s.src = `n8n/simulador-nodos.js?v=${Date.now()}`;
            s.onload = listo;
            s.onerror = () => falla(new Error('No se pudo cargar n8n/simulador-nodos.js (¿publicaste el sitio?)'));
            document.head.append(s);
        });
        return window.SimuladorFlujo;
    }

    /* ---------- 1) Revisión en vivo ---------- */
    async function revisarEnVivo() {
        const { data, error } = await supabaseClient.rpc('diagnostico_sistema');
        if (error) {
            const falta = error.code === 'PGRST202' || /diagnostico_sistema/.test(error.message ?? '');
            return [{ grupo: 'Base de datos', chequeo: 'Diagnóstico en vivo', ok: false,
                detalle: falta ? 'No encontrado' : error.message, arreglo: falta ? 'Ejecuta supabase/wo-036-diagnostico.sql' : 'Vuelve a iniciar sesión en el panel' }];
        }
        return data ?? [];
    }

    function pintarVivo(filas) {
        const grupos = [...new Set(filas.map((f) => f.grupo))];
        caja('prueba-sistema-vivo').innerHTML = `
            <p class="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 mb-2"><i class="fa-solid fa-satellite-dish mr-1"></i> En vivo · solo lectura</p>
            ${grupos.map((g) => `
                <div class="rounded-2xl bg-dcDarkBg/50 ring-1 ring-white/10 p-3 mb-3">
                    <p class="text-xs font-black uppercase tracking-wider mb-2">${escaparHTML(g)}</p>
                    <ul class="space-y-2">${filas.filter((f) => f.grupo === g).map((f) => `
                        <li class="flex items-start gap-2 text-xs" data-chequeo="${f.ok ? 'ok' : 'falla'}">
                            <i class="fa-solid ${f.ok ? 'fa-circle-check text-emerald-400' : 'fa-circle-xmark text-red-400'} mt-0.5"></i>
                            <span class="min-w-0"><b class="text-neutral-200">${escaparHTML(f.chequeo)}</b> · <span class="text-neutral-400">${escaparHTML(f.detalle ?? '')}</span>
                            ${f.arreglo ? `<span class="block text-amber-300 mt-0.5"><i class="fa-solid fa-wrench mr-1"></i>${escaparHTML(f.arreglo)}</span>` : ''}</span>
                        </li>`).join('')}
                    </ul>
                </div>`).join('')}`;
    }

    /* ---------- 2) Simulación de una venta completa ---------- */
    async function simular() {
        const S = await cargarSimulador();
        const memoria = {};
        const ejecutar = (nombre, datos, entrada = []) => {
            const fn = S.nodos[nombre];
            if (!fn) throw new Error(`El simulador no tiene el nodo "${nombre}"`);
            const $ = (n) => ({ first: () => ({ json: datos[n]?.[0] ?? {} }), all: () => (datos[n] ?? []).map((json) => ({ json })), item: { json: datos[n]?.[0] ?? {} } });
            const $input = { first: () => ({ json: entrada[0] ?? {} }), all: () => entrada.map((json) => ({ json })) };
            return fn($, $input, () => memoria);
        };
        const admin = String(S.config.numero_aviso_admin || '').replace(/\D/g, '') || '573000000009';
        // Solo para simular: tu correo para ANC vive en n8n (Config bot), aquí se usa uno de prueba
        const cfg = { ...S.config, numero_aviso_admin: admin, canal_compra: 'web', anc_correo: S.config.anc_correo || 'simulacion@dctecnology.xyz' };
        const pasos = [];
        const paso = (actor, titulo, texto, extra = {}) => pasos.push({ actor, titulo, texto, ok: true, ...extra });
        const evento = (numero, message, id) => ({ body: { event: 'messages.upsert', data: { key: { remoteJid: `${numero}@s.whatsapp.net`, fromMe: false, id }, pushName: 'Cliente de prueba', message } } });

        try {
            // 1. El cliente escribe
            const msg = ejecutar('Normalizar mensaje', { 'Config bot': [cfg], 'Webhook Evolution': [evento(CLIENTE, { conversation: 'Hola, quiero Netflix para una pantalla' }, 'SIM-1')] })[0]?.json;
            if (msg?.ruta !== 'ia') throw new Error(`El mensaje del cliente no llegó al agente (ruta: ${msg?.ruta ?? 'ninguna'})`);
            paso('cliente', 'El cliente escribe por WhatsApp', 'Hola, quiero Netflix para una pantalla');

            // 2. El agente responde (respuesta de la IA simulada; el precio lo pone el catálogo, no la IA)
            const respuestaIa = `¡Claro! ${PRODUCTO} – ${VARIANTE}. Te lo dejo listo 👌\n[PEDIDO_DIGITAL] ${JSON.stringify({ producto: PRODUCTO, variante: VARIANTE, precio: 1 })}`;
            const rv = ejecutar('Revisar respuesta', { 'Config bot': [cfg], 'Normalizar mensaje': [msg], 'Reglas combo': [{}], 'Metodos de pago': [{}] }, [{ output: respuestaIa }])[0]?.json;
            if (!rv?.pedido) throw new Error('El bot no reconoció el pedido del agente (¿el producto sigue en el catálogo?)');
            paso('bot', 'El agente responde (IA simulada)', rv.texto, { nota: `Precio validado contra el catálogo: ${WA_COP(rv.pedido.precio)} (la IA dijo $1)` });

            // 3. Pedido + compra al proveedor por el portal
            const t = ejecutar('Crear triangulación', { 'Config bot': [cfg], 'Normalizar mensaje': [{ ...msg, nombre: 'Cliente de prueba' }] }, [{ numero: CLIENTE, pedido: rv.pedido }])[0]?.json;
            if (!t?.referencia) throw new Error('No se creó el pedido al proveedor (revisa numero_aviso_admin en Config bot)');
            paso('sistema', `Pedido ${t.referencia} al proveedor`, `Canal de compra: ${t.canal === 'web' ? 'portal de ANC (ancpagos.com)' : 'WhatsApp del proveedor'}`);

            const html = `<script>const CATALOGO_INICIAL_IDX = ${JSON.stringify({ [ANC.producto]: { [ANC.plan]: { precio: rv.pedido.precio, bajo_pedido: 0 } } })};
                const STOCK_INICIAL_IDX = ${JSON.stringify({ [ANC.producto]: { [ANC.plan]: 3 } })};<\/script>`;
            const medios = { nequi: { nombre: 'Nequi', numero: '300 000 0000 (simulado)', titular: 'ANC' } };
            const base = { 'Config bot': [cfg], 'Crear triangulación': [t], 'Catálogo ANC': [{ data: html }], 'Medios de pago ANC': [medios], 'Vincular al panel': [{ ok: true }] };
            const cot = ejecutar('Cotización ANC', base)[0].json;
            const ev = ejecutar('Evaluar cotización', base, [cot])[0].json;
            paso('admin', 'Te llega la orden de compra (catálogo de ANC simulado)', ev.texto_admin);

            // 4. Tú pagas y respondes #pago con la captura
            const cmd = ejecutar('Normalizar mensaje', { 'Config bot': [cfg], 'Webhook Evolution': [evento(admin, { imageMessage: { caption: `#pago ${t.referencia}`, mimetype: 'image/jpeg' } }, 'SIM-2')] })[0]?.json;
            if (cmd?.accion !== 'pago') throw new Error('Tu "#pago" no se reconoció como comando de pago');
            const abierta = { referencia: t.referencia, estado: 'ESPERANDO_PAGO_ADMIN', esperando: 'PAGO_ADMIN', resume_url: 'https://n8n.simulado/espera', estado_compra: 'ESPERANDO_PROVEEDOR' };
            const sinPagar = ejecutar('Enrutar evento', { 'Config bot': [cfg], 'Normalizar mensaje': [cmd] }, [{ ...abierta, estado_compra: 'PENDIENTE_PAGO' }])[0]?.json;
            const ruta = ejecutar('Enrutar evento', { 'Config bot': [cfg], 'Normalizar mensaje': [cmd] }, [abierta])[0]?.json;
            if (ruta?.accion !== 'reanudar') throw new Error(`Tu #pago no reanudó el pedido: ${ruta?.texto ?? 'sin respuesta'}`);
            paso('admin', 'Envías la captura con #pago', `#pago ${t.referencia} 📷`, { nota: `Protección: si el cliente aún no hubiera pagado, el bot responde «${String(sinPagar?.texto ?? '').slice(0, 90)}…»` });

            // 5. El bot crea el pedido en ancpagos.com con tu comprobante
            ejecutar('Evaluar pago', { 'Crear triangulación': [t] }, [{ body: { tipo: 'pago', wamid: 'SIM-2' } }]);
            const datosAnc = { ...base, 'Cotización ANC': [cot] };
            const compra = ejecutar('Preparar compra ANC', datosAnc, [{ base64: 'iVBORw0KGgo=', mimetype: 'image/jpeg' }])[0];
            paso('sistema', 'Pedido para ancpagos.com (no se envía en la simulación)',
                `${compra.json.resumen_pedido} · ${compra.json.total_pagado} · ${compra.json.metodo}\nA nombre de ${compra.json.nombre_cliente} ${compra.json.apellido_cliente} · ${compra.json.correo}\nComprobante adjunto: ${compra.binary.comprobante.fileName}`);
            const creado = ejecutar('Pedido ANC creado', datosAnc, [{ statusCode: 200, body: '900001|simulado-token-123' }])[0].json;
            paso('admin', 'ANC crea el pedido (respuesta simulada)', creado.texto);

            // 6. La página del pedido muestra los accesos → misma extracción y validación de siempre
            const pagina = `<html><body><h1>Pedido #900001</h1><p>¡Tu pedido está listo!</p><p><b>Correo:</b> ${ACCESOS.usuario}</p><p><b>Contraseña:</b> ${ACCESOS.clave}</p><p>Perfil: ${ACCESOS.perfil} · PIN: ${ACCESOS.pin}</p></body></html>`;
            const res = ejecutar('Accesos en ANC', { 'Pedidos ANC esperando': [{ referencia: t.referencia, anc_pedido_id: '900001', anc_token: 'simulado-token-123', resume_url: 'https://n8n.simulado/espera' }] }, [{ statusCode: 200, body: pagina }]);
            if (!res.length) throw new Error('El lector de la página de ANC no encontró los accesos');
            paso('sistema', 'El bot lee la página del pedido en ANC (simulada)', res[0].json.cuerpo.texto);
            const prep = ejecutar('Preparar extracción', { 'Crear triangulación': [t] }, [{ body: res[0].json.cuerpo }])[0].json;
            const val = ejecutar('Validar credenciales', { 'Preparar extracción': [prep] }, [{ text: JSON.stringify({ ...ACCESOS, confianza: 0.97 }) }])[0].json;
            if (val.decision !== 'entregar') throw new Error(`La validación pidió revisión: ${val.problemas.join('; ')}`);
            paso('sistema', 'Extracción validada (IA simulada)', `Usuario y clave aparecen tal cual en la página · confianza ${val.confianza.toFixed(2)} (mínimo 0.90)`);

            // 7. Entrega al cliente
            const entrega = ejecutar('Mensaje de entrega', { 'Crear triangulación': [t] }, [val])[0].json;
            paso('cliente', 'El cliente recibe sus accesos por WhatsApp', entrega.texto, { nota: 'Queda en su portal (Mis pedidos) con la garantía activa' });
        } catch (e) {
            const m = /TERMINAR (\{[\s\S]*\})/.exec(String(e.message));
            let texto = e.message;
            if (m) { try { const d = JSON.parse(m[1]); texto = `El flujo terminó en ${d.estado}: ${d.avisoAdmin ?? ''}`; } catch { /* mensaje crudo */ } }
            pasos.push({ actor: 'error', titulo: 'La simulación se detuvo', texto, ok: false });
        }
        return pasos;
    }

    const WA_COP = (v) => `$${Number(v || 0).toLocaleString('es-CO')}`;
    const ACTORES = {
        cliente: ['fa-user', 'Cliente', 'text-sky-300 bg-sky-500/10 ring-sky-500/30'],
        bot: ['fa-robot', 'Bot', 'text-dcRed bg-dcRed/10 ring-dcRed/30'],
        admin: ['fa-user-shield', 'Tú', 'text-amber-300 bg-amber-500/10 ring-amber-500/30'],
        sistema: ['fa-gears', 'Sistema', 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30'],
        error: ['fa-triangle-exclamation', 'Falla', 'text-red-300 bg-red-500/10 ring-red-500/30'],
    };

    function pintarSimulacion(pasos) {
        caja('prueba-sistema-simulacion').innerHTML = `
            <p class="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 mb-2"><i class="fa-solid fa-flask mr-1"></i> Simulación · código real del bot, sin enviar nada</p>
            <ol class="space-y-3">${pasos.map((p, i) => {
                const [icono, nombre, color] = ACTORES[p.actor] ?? ACTORES.sistema;
                return `<li class="rounded-2xl bg-dcDarkBg/50 ring-1 ${p.ok ? 'ring-white/10' : 'ring-red-500/40'} p-3" data-paso="${p.ok ? 'ok' : 'falla'}">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg ring-1 text-[10px] font-black uppercase tracking-wider ${color}"><i class="fa-solid ${icono}"></i> ${nombre}</span>
                        <span class="text-xs font-bold text-neutral-200">${i + 1}. ${escaparHTML(p.titulo)}</span>
                    </div>
                    <p class="text-xs text-neutral-300 whitespace-pre-wrap break-words rounded-xl bg-white/[0.03] p-2.5">${escaparHTML(p.texto ?? '')}</p>
                    ${p.nota ? `<p class="text-[11px] text-neutral-500 mt-1.5"><i class="fa-solid fa-circle-info mr-1"></i>${escaparHTML(p.nota)}</p>` : ''}
                </li>`;
            }).join('')}</ol>`;
    }

    async function probarTodo() {
        const boton = caja('prueba-sistema-correr');
        boton.disabled = true;
        boton.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Probando…';
        caja('prueba-sistema-resultado').hidden = false;
        try {
            const [vivo, pasos] = await Promise.all([revisarEnVivo(), simular().catch((e) => [{ actor: 'error', titulo: 'No se pudo simular', texto: e.message, ok: false }])]);
            pintarVivo(vivo);
            pintarSimulacion(pasos);
            const fallasVivo = vivo.filter((f) => !f.ok).length;
            const fallasSim = pasos.filter((p) => !p.ok).length;
            const todoOk = !fallasVivo && !fallasSim;
            caja('prueba-sistema-resumen').innerHTML = `<p class="flex items-center gap-2 text-sm font-bold ${todoOk ? 'text-emerald-300' : 'text-amber-300'}" data-resumen="${todoOk ? 'ok' : 'falla'}">
                <i class="fa-solid ${todoOk ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i>
                En vivo: ${vivo.length - fallasVivo} de ${vivo.length} bien · Simulación: ${fallasSim ? 'se detuvo' : `${pasos.length} pasos completos`}
                ${todoOk ? '· todo listo para vender' : '· revisa lo marcado en rojo'}</p>`;
            if (todoOk) Sonidos.completar(); else Sonidos.error();
        } finally {
            boton.disabled = false;
            boton.innerHTML = '<i class="fa-solid fa-play mr-1"></i> Probar todo el sistema';
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        caja('prueba-sistema-correr')?.addEventListener('click', probarTodo);
    });
    window.PruebaSistema = { probarTodo, simular, revisarEnVivo };
})();
