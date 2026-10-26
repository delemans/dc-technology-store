// herramientas/ia.mjs — IA en cascada para los scripts locales (la misma lógica del nodo «IA balanceada» del bot).
// Una sola función, pedirIA(), recorre las IA de proveedores-ia.mjs (Groq, Cerebras, Mistral, SiliconFlow, NVIDIA, Gemini,
// OpenRouter, OpenAI, GitHub Models y un modelo local) y, si una falla, pasa a la siguiente sin que el script se entere:
//   sin saldo / clave mala / cuota diaria (401, 402, 403) → pausa 6 h · límite por minuto (429, 413) → 2 min
//   lenta (timeout) → 5 min · caída o error del servidor → 1 min. Las pausas se guardan en herramientas/salida/ia-estado.json.
// Cada intento queda en herramientas/salida/ia-uso.jsonl (qué IA, modelo, tarea, ok, ms, tokens; nunca la clave ni el texto).
//
//   node herramientas/ia.mjs --probar            → una consulta corta por la cascada: dice qué IA respondió
//   node herramientas/ia.mjs --uso [días]        → consumo por IA y por tarea (scripts locales y, si n8n responde, el bot)
//   node herramientas/ia.mjs --revisar           → revisa el .env (formato, duplicadas, URL) sin mostrar ningún valor
//   node herramientas/ia.mjs --revisar --arreglar → corrige solo el formato (respaldo .env.respaldo-AAAA-MM-DD)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PROVEEDORES_IA, armarProveedores } from './proveedores-ia.mjs';

const require = createRequire(import.meta.url);
const { RAIZ, cargarEntorno } = require('./entorno.js');
const SALIDA = path.join(RAIZ, 'herramientas', 'salida');
export const ARCHIVO_ESTADO = path.join(SALIDA, 'ia-estado.json');
export const ARCHIVO_USO = path.join(SALIDA, 'ia-uso.jsonl');

const leerJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } };
const hoyBogota = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

// Qué hacer con una falla (igual que el bot)
export function clasificar(codigo, detalle) {
    const sinSaldo = [401, 402, 403].includes(codigo) || /insufficient|balance|credit|billing|saldo|quota|per ?day|daily/i.test(detalle);
    const lenta = !codigo && /timeout|timed out|ETIMEDOUT|aborted/i.test(detalle);
    const pausa = sinSaldo ? 6 * 3600e3 : codigo === 429 || codigo === 413 ? 2 * 60e3 : lenta ? 5 * 60e3 : codigo >= 500 || !codigo ? 60e3 : 10 * 60e3;
    return { sinSaldo, lenta, pausa };
}

function anotar(archivo, fila) {
    try {
        fs.mkdirSync(path.dirname(archivo), { recursive: true });
        // Tope ~2 MB: se conservan las últimas 5.000 líneas
        if (fs.existsSync(archivo) && fs.statSync(archivo).size > 2e6) fs.writeFileSync(archivo, fs.readFileSync(archivo, 'utf8').trim().split('\n').slice(-5000).join('\n') + '\n');
        fs.appendFileSync(archivo, JSON.stringify(fila) + '\n');
    } catch { /* el registro nunca detiene la consulta */ }
}

/**
 * Pide una respuesta a la primera IA disponible de la cascada.
 * @param mensajes [{role, content}] (o un texto: se manda como mensaje del usuario)
 * @param o { tarea, sistema, temperatura, maxTokens, json, timeoutMs, presupuestoMs }
 * @param d dependencias para pruebas: { env, f, ahora, estado, uso, lista }
 * @returns { texto, ia, modelo, intentos }  · lanza Error con .fallas y .fatal (todas sin saldo o sin configurar)
 */
export async function pedirIA(mensajes, o = {}, d = {}) {
    const { tarea = 'general', sistema, temperatura = 0.3, maxTokens = 700, json = false, timeoutMs = 45000, presupuestoMs = 150000 } = o;
    const env = d.env ?? cargarEntorno();
    const f = d.f ?? fetch;
    const reloj = d.ahora ?? Date.now;
    const archEstado = d.estado ?? ARCHIVO_ESTADO;
    const archUso = d.uso ?? ARCHIVO_USO;
    const msgs = [...(sistema ? [{ role: 'system', content: sistema }] : []), ...(typeof mensajes === 'string' ? [{ role: 'user', content: mensajes }] : mensajes)];
    const lista = (d.lista ?? armarProveedores(env)).filter((p) => p.url && p.modelo);
    if (!lista.length) throw Object.assign(new Error('No hay ninguna IA configurada: pon al menos una clave IA_* en .env (node herramientas/configurar-ias.mjs).'), { fatal: true, fallas: [] });

    const inicio = reloj();
    const hoy = hoyBogota(inicio);
    const previo = leerJson(archEstado, { dia: hoy, p: {} });
    const est = previo.dia === hoy ? previo : { dia: hoy, p: Object.fromEntries(Object.entries(previo.p ?? {}).map(([k, v]) => [k, { ...v, usos: 0 }])) };
    const e = (p) => (est.p[p.nombre] = est.p[p.nombre] ?? { usos: 0, hasta: 0, motivo: null });
    const carga = (p) => e(p).usos / Math.max(1, Number(p.peso) || 1);
    // Primero las libres (la de menos uso hoy según su peso); si todas están en pausa se intentan igual, por si ya se recargó alguna
    const orden = [...lista.filter((p) => e(p).hasta <= inicio).sort((a, b) => carga(a) - carga(b)),
                   ...lista.filter((p) => e(p).hasta > inicio).sort((a, b) => e(a).hasta - e(b).hasta)];
    const guardar = () => { try { fs.mkdirSync(path.dirname(archEstado), { recursive: true }); fs.writeFileSync(archEstado, JSON.stringify(est, null, 1)); } catch { /* sin estado no se rompe nada */ } };
    const fallas = [];
    let todasSinSaldo = true;

    for (const p of orden) {
        const resta = presupuestoMs - (reloj() - inicio);
        if (resta < 4000) { fallas.push('tiempo máximo agotado'); todasSinSaldo = false; break; }
        const s = e(p);
        const t0 = reloj();
        let codigo = 0, detalle = '', conFormato = json;
        for (let vuelta = 0; vuelta < 2; vuelta++) {
            codigo = 0; detalle = '';
            try {
                const r = await f(`${String(p.url).replace(/\/+$/, '')}/chat/completions`, {
                    method: 'POST', signal: AbortSignal.timeout(Math.min(timeoutMs, resta)),
                    headers: { Authorization: `Bearer ${p.clave}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: p.modelo, messages: msgs, temperature: temperatura,
                        max_tokens: Math.min(maxTokens, Number(p.maxTokens) > 0 ? Number(p.maxTokens) : maxTokens),
                        ...(conFormato ? { response_format: { type: 'json_object' } } : {}), ...(p.extra ?? {}) }),
                });
                codigo = Number(r.status) || 0;
                const j = await r.json().catch(() => ({}));
                const texto = String(j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                if (r.ok && texto) {
                    Object.assign(s, { usos: (s.usos ?? 0) + 1, hasta: 0, motivo: null, ultimo: new Date(reloj()).toISOString() });
                    guardar();
                    anotar(archUso, { at: new Date(reloj()).toISOString(), tarea, ia: p.nombre, modelo: p.modelo, ok: true, ms: reloj() - t0,
                        entrada: j.usage?.prompt_tokens ?? null, salida: j.usage?.completion_tokens ?? null });
                    return { texto, ia: p.nombre, modelo: p.modelo, intentos: fallas.length + 1 };
                }
                detalle = String(j.error?.message ?? j.message ?? j[0]?.error?.message ?? (r.ok ? 'respuesta vacía' : '')).replace(/\s+/g, ' ').slice(0, 160);
            } catch (err) { detalle = String(err?.name === 'TimeoutError' ? 'timeout' : err?.cause?.code ?? err?.message ?? err).slice(0, 160); }
            // Algunas IA no aceptan response_format: se repite una vez sin él (el prompt ya pide JSON)
            if (conFormato && codigo === 400 && /response_format|json/i.test(detalle)) { conFormato = false; continue; }
            break;
        }
        const c = clasificar(codigo, detalle);
        if (!c.sinSaldo) todasSinSaldo = false;
        Object.assign(s, { hasta: reloj() + c.pausa, motivo: `${codigo || 'sin respuesta'} ${detalle}`.trim() });
        guardar();
        anotar(archUso, { at: new Date(reloj()).toISOString(), tarea, ia: p.nombre, modelo: p.modelo, ok: false, ms: reloj() - t0, codigo, motivo: detalle.slice(0, 120) });
        fallas.push(`${p.nombre}: ${codigo || ''} ${detalle}`.replace(/\s+/g, ' ').trim());
    }
    throw Object.assign(new Error(`Ninguna IA respondió · ${fallas.join(' | ')}`), { fallas, fatal: todasSinSaldo });
}

// ---------- Consumo ----------
export function resumirUso(filas, desdeMs) {
    const por = {}, tareas = {};
    for (const x of filas) {
        if (Date.parse(x.at) < desdeMs) continue;
        const a = (por[x.ia] = por[x.ia] ?? { consultas: 0, ok: 0, fallas: 0, ms: 0, entrada: 0, salida: 0, ultimaFalla: null });
        a.consultas++; a[x.ok ? 'ok' : 'fallas']++; a.ms += x.ms ?? 0; a.entrada += x.entrada ?? 0; a.salida += x.salida ?? 0;
        if (!x.ok) a.ultimaFalla = `${x.codigo || ''} ${x.motivo ?? ''}`.trim();
        if (x.ok) tareas[x.tarea] = (tareas[x.tarea] ?? {}), tareas[x.tarea][x.ia] = (tareas[x.tarea][x.ia] ?? 0) + 1;
    }
    return { por, tareas };
}

// ---------- Revisión del .env (nunca muestra valores) ----------
export function revisarEnv(texto) {
    const problemas = [], arreglos = [];
    let lineas = texto.replace(/^﻿/, (b) => { if (b) problemas.push('el archivo empieza con BOM (marca invisible)'); return ''; }).split(/\r?\n/);
    const vistas = new Map();
    const conocidas = new Set(PROVEEDORES_IA.flatMap((p) => [p.claveEnv, p.claveAlt, p.urlEnv, p.modeloEnv].filter(Boolean)));
    lineas = lineas.map((l, i) => {
        const n = i + 1;
        if (!l.trim() || l.trim().startsWith('#')) return l;
        let x = l;
        if (/^\s*export\s+/i.test(x)) { problemas.push(`línea ${n}: sobra «export»`); x = x.replace(/^\s*export\s+/i, ''); }
        const m = /^\s*([^=\s]+)\s*=\s*(.*?)\s*$/.exec(x);
        if (!m) { problemas.push(`línea ${n}: no tiene la forma NOMBRE=valor (se ignora)`); return l; }
        const [, k, vRaw] = m;
        if (!/^[A-Z0-9_]+$/i.test(k)) problemas.push(`línea ${n}: nombre «${k}» con caracteres no válidos`);
        if (x !== `${k}=${vRaw}`) problemas.push(`línea ${n} (${k}): espacios alrededor del = o al final`);
        const comillas = /^(['"]).*\1$/.test(vRaw);
        if (!comillas && /^['"]|['"]$/.test(vRaw)) problemas.push(`línea ${n} (${k}): comillas sin cerrar`);
        const v = vRaw.replace(/^(['"])(.*)\1$/, '$2');
        if (vistas.has(k)) problemas.push(`${k} está repetida (líneas ${vistas.get(k)} y ${n}): vale la de abajo`);
        vistas.set(k, n);
        if (/_URL$/.test(k) && v && (!/^https?:\/\//.test(v) || /\/chat\/completions\/?$/.test(v))) problemas.push(`línea ${n} (${k}): la URL debe empezar por http(s):// y terminar en /v1 (sin /chat/completions)`);
        if (k === 'SILICONFLOW_BASE_URL' && /\.cn\b/.test(v)) problemas.push(`línea ${n}: SILICONFLOW_BASE_URL apunta a .cn (cuentas de China); la tuya es .com`);
        if (/(_KEY|_TOKEN|_SECRET)$/.test(k) && /\s/.test(v)) problemas.push(`línea ${n} (${k}): la clave tiene espacios por dentro (¿pegada dos veces?)`);
        if (/^IA_[A-Z0-9_]+_(KEY|MODELO|URL|PESO|APAGADA)$/.test(k) && !conocidas.has(k)) {
            const id = k.replace(/^IA_|_(KEY|MODELO|URL|PESO|APAGADA)$/g, '');
            if (!PROVEEDORES_IA.some((p) => p.id === id)) problemas.push(`línea ${n}: ${k} no corresponde a ninguna IA de la lista (¿nombre mal escrito?)`);
        }
        return `${k}=${vRaw}`;
    });
    // Arreglo seguro: formato y duplicadas comentadas (la de abajo es la que ya se usaba); nada se borra
    const ultima = new Map(); lineas.forEach((l, i) => { const m = /^([A-Z0-9_]+)=/i.exec(l); if (m) ultima.set(m[1], i); });
    const arreglado = lineas.map((l, i) => { const m = /^([A-Z0-9_]+)=/i.exec(l); return m && ultima.get(m[1]) !== i ? `# (repetida; se usa la de abajo) ${l}` : l; }).join('\n');
    if (arreglado !== texto.replace(/^﻿/, '').replace(/\r\n/g, '\n')) arreglos.push('formato y duplicadas');
    return { problemas, arreglado, cambia: arreglos.length > 0 };
}

// ---------- Uso por consola ----------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    const env = cargarEntorno();
    if (args.includes('--probar')) {
        try {
            const r = await pedirIA('Responde solo la palabra: listo', { tarea: 'prueba', maxTokens: 300, temperatura: 0 }, { env });
            console.log(`✔ Respondió ${r.ia} (${r.modelo}) en el intento ${r.intentos}: «${r.texto.slice(0, 40)}»`);
        } catch (e) { console.log(`✘ ${e.message}`); process.exitCode = 1; }
    } else if (args.includes('--uso')) {
        const dias = Number(args[args.indexOf('--uso') + 1]) || 7;
        const filas = fs.existsSync(ARCHIVO_USO) ? fs.readFileSync(ARCHIVO_USO, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
        const { por, tareas } = resumirUso(filas, Date.now() - dias * 864e5);
        console.log(`\nIA de los scripts locales · últimos ${dias} días\n`);
        if (!Object.keys(por).length) console.log('  (sin consultas registradas todavía)');
        for (const [ia, a] of Object.entries(por).sort((x, y) => y[1].ok - x[1].ok))
            console.log(`  ${ia.padEnd(16)} ${String(a.ok).padStart(5)} resueltas · ${String(a.fallas).padStart(4)} fallas · ${Math.round(a.ms / Math.max(1, a.consultas))} ms prom. · ${a.entrada + a.salida} tokens${a.ultimaFalla ? ` · última falla: ${a.ultimaFalla.slice(0, 60)}` : ''}`);
        for (const [t, x] of Object.entries(tareas)) console.log(`  · ${t}: ${Object.entries(x).map(([ia, n]) => `${ia} ${n}`).join(', ')}`);
        const est = leerJson(ARCHIVO_ESTADO, { p: {} });
        const pausadas = Object.entries(est.p ?? {}).filter(([, v]) => v.hasta > Date.now());
        if (pausadas.length) console.log(`\n  En pausa ahora: ${pausadas.map(([k, v]) => `${k} hasta ${new Date(v.hasta).toLocaleTimeString('es-CO')} (${String(v.motivo).slice(0, 50)})`).join(' · ')}`);
        // El bot (n8n) guarda su propio conteo por día en los datos del flujo
        if (env.N8N_API_KEY) {
            try {
                const base = String(env.N8N_URL || 'http://localhost:5678').replace(/\/+$/, '');
                const id = env.N8N_WORKFLOW_ID || 'qjwm3rqQRpQjvcR3';
                const r = await fetch(`${base}/api/v1/workflows/${id}`, { headers: { 'X-N8N-API-KEY': env.N8N_API_KEY }, signal: AbortSignal.timeout(8000) });
                const hist = (await r.json()).staticData?.global?.iaHistorial ?? {};
                const filasBot = Object.entries(hist).sort().slice(-dias);
                console.log(`\nIA del bot (n8n) por día:${filasBot.length ? '' : ' (sin datos todavía: se llena desde la próxima sincronización)'}`);
                for (const [dia, x] of filasBot) console.log(`  ${dia}: ${Object.entries(x).map(([ia, n]) => `${ia} ${n}`).join(', ')}`);
            } catch { console.log('\n(n8n no respondió: no se pudo leer el consumo del bot)'); }
        }
        console.log('');
    } else if (args.includes('--revisar')) {
        const ruta = path.join(RAIZ, '.env');
        if (!fs.existsSync(ruta)) { console.log('No existe .env (copia .env.ejemplo como .env).'); process.exit(1); }
        const texto = fs.readFileSync(ruta, 'utf8');
        const r = revisarEnv(texto);
        console.log(r.problemas.length ? `\n.env: ${r.problemas.length} detalle(s)\n${r.problemas.map((p) => `  · ${p}`).join('\n')}` : '\n.env: formato correcto');
        const activas = armarProveedores(env);
        console.log(`\nIA activas (${activas.length}): ${activas.map((p) => `${p.nombre} → ${p.url} · ${p.modelo}`).join('\n  ') || 'ninguna'}`);
        const sin = PROVEEDORES_IA.filter((p) => !activas.some((a) => a.nombre === p.nombre)).map((p) => p.nombre);
        if (sin.length) console.log(`Sin configurar o apagadas: ${sin.join(', ')} (opcionales)`);
        if (args.includes('--arreglar') && r.cambia) {
            const copia = path.join(RAIZ, `.env.respaldo-${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })}`);
            fs.copyFileSync(ruta, copia);
            fs.writeFileSync(ruta, r.arreglado.replace(/\n*$/, '\n'));
            console.log(`\n✔ .env corregido (copia del anterior: ${path.basename(copia)}). Prueba: node herramientas/ia.mjs --probar`);
        } else if (r.cambia) console.log('\nPara corregir el formato: node herramientas/ia.mjs --revisar --arreglar');
        console.log('');
    } else {
        console.log('Uso: node herramientas/ia.mjs --probar | --uso [días] | --revisar [--arreglar]');
    }
}
