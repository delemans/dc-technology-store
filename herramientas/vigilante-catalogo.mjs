// herramientas/vigilante-catalogo.mjs — Vigilante diario de proveedores (Emprende Red y ANC) y de sus políticas.
//   node herramientas/vigilante-catalogo.mjs              → revisa, actualiza la tienda, publica y te avisa por WhatsApp
//   node herramientas/vigilante-catalogo.mjs --probar     → revisa y te muestra el informe aquí (no publica ni avisa)
//   node herramientas/vigilante-catalogo.mjs --instalar   → tarea programada diaria (6:00 a. m.) en este PC
// Qué vigila:
//   · Emprende Red: productos nuevos, retirados (desaparecen), agotados (quedan "Agotado"), repuestos, precios, nombres
//     y descripciones. Actualiza productos.json, páginas de Google, Shopping y el conocimiento del bot, y publica.
//   · ANC: planes nuevos o retirados, días (plazo), precios, cantidades, agotados, condiciones de cada producto y lo que aún no vendes.
//   · Políticas: términos, privacidad y devoluciones de ANC y términos de Emprende Red (te avisa si cambian).
// Precios y existencias en la base los actualiza n8n cada 6 h (con la credencial de servidor); este vigilante no la usa.
// Seguridad: si el proveedor devuelve muchos menos productos de los que había (caída a medias), NO se publica nada.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RAIZ, cargarEntorno } = require('./entorno.js');
const env = cargarEntorno();
const args = process.argv.slice(2);
const PROBAR = args.includes('--probar');
const SALIDA = path.join(RAIZ, 'herramientas', 'salida');
fs.mkdirSync(SALIDA, { recursive: true });
const ANTES_ANC = path.join(SALIDA, 'vigilante-anc.json');
const ANTES_POL = path.join(SALIDA, 'vigilante-politicas.json');
const REGISTRO = path.join(SALIDA, 'vigilante-catalogo.log');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const log = (t) => { const l = `${new Date().toISOString()} ${t}`; console.log(l); fs.appendFileSync(REGISTRO, l + '\n'); };
const cop = (n) => `$${Math.round(Number(n) || 0).toLocaleString('es-CO')}`;
const huella = (t) => crypto.createHash('sha256').update(String(t ?? '')).digest('hex').slice(0, 16);
const leerJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

if (args.includes('--instalar')) {
    const tarea = 'DC Tecnology - vigilante del catálogo';
    const ps = `$a = New-ScheduledTaskAction -Execute '${process.execPath}' -Argument '"${path.join(RAIZ, 'herramientas', 'vigilante-catalogo.mjs')}"' -WorkingDirectory '${RAIZ}';
$t = New-ScheduledTaskTrigger -Daily -At '06:00';
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 40);
Register-ScheduledTask -TaskName '${tarea}' -Action $a -Trigger $t -Settings $s -Description 'Revisa proveedores y políticas, actualiza y publica la tienda (DC Tecnology).' -Force | Out-Null`;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
    console.log(`Tarea "${tarea}" instalada: todos los días a las 6:00 a. m. (si el PC estaba apagado, corre al encender).`);
    process.exit(0);
}

const informe = [];
let publicar = false;

/* ---------- 1) Emprende Red ---------- */
const RUTA_PRODUCTOS = path.join(RAIZ, 'productos.json');
const crudoAntes = fs.readFileSync(RUTA_PRODUCTOS, 'utf8');
const antes = JSON.parse(crudoAntes).filter((p) => p.id.startsWith('er-'));
const r = spawnSync(process.execPath, [path.join(RAIZ, 'herramientas', 'sincronizar-emprendered.mjs'), '--tienda'], { cwd: RAIZ, encoding: 'utf8', timeout: 15 * 60e3 });
if (r.status !== 0) {
    fs.writeFileSync(RUTA_PRODUCTOS, crudoAntes);
    informe.push(`⚠️ No pude leer Emprende Red: ${String(r.stderr || r.stdout).trim().split('\n').pop()?.slice(0, 160)}. La tienda queda como estaba.`);
} else {
    const despues = JSON.parse(fs.readFileSync(RUTA_PRODUCTOS, 'utf8')).filter((p) => p.id.startsWith('er-'));
    if (despues.length < antes.length * 0.6) {
        fs.writeFileSync(RUTA_PRODUCTOS, crudoAntes);
        informe.push(`⚠️ Emprende Red devolvió ${despues.length} productos (antes ${antes.length}): parece una caída a medias. No cambié nada; reviso mañana.`);
    } else {
        const A = new Map(antes.map((p) => [p.id, p])), D = new Map(despues.map((p) => [p.id, p]));
        const visible = (p) => !p.oculto;
        const precio = (p) => Number(p?.variantes?.[0]?.precio) || 0;
        const nuevos = despues.filter((p) => !A.has(p.id));
        const retirados = antes.filter((p) => !D.has(p.id));
        const agotados = despues.filter((p) => p.agotado && A.has(p.id) && !A.get(p.id).agotado && visible(p));
        const repuestos = despues.filter((p) => !p.agotado && A.get(p.id)?.agotado && visible(p));
        const precios = despues.filter((p) => A.has(p.id) && precio(p) !== precio(A.get(p.id)) && visible(p));
        const textos = despues.filter((p) => A.has(p.id) && (huella(p.descripcion) !== huella(A.get(p.id).descripcion) || p.nombre !== A.get(p.id).nombre));
        const lista = (xs, f) => xs.slice(0, 8).map(f).join('\n') + (xs.length > 8 ? `\n… y ${xs.length - 8} más` : '');
        if (nuevos.length) informe.push(`🆕 Emprende Red · ${nuevos.length} nuevos (${nuevos.filter(visible).length} en categorías visibles):\n${lista(nuevos, (p) => `• ${p.nombre} · ${cop(precio(p))}${visible(p) ? '' : ' (oculto)'}`)}`);
        if (retirados.length) informe.push(`🗑️ Retirados por el proveedor (ya no salen en la tienda): ${retirados.length}\n${lista(retirados, (p) => `• ${p.nombre}`)}`);
        if (agotados.length) informe.push(`⛔ Se agotaron (salen «Agotado»): ${agotados.length}\n${lista(agotados, (p) => `• ${p.nombre}`)}`);
        if (repuestos.length) informe.push(`🔔 Volvieron: ${repuestos.length}\n${lista(repuestos, (p) => `• ${p.nombre} (${p.existencias} u.)`)}`);
        if (precios.length) informe.push(`💲 Cambiaron de precio: ${precios.length}\n${lista(precios, (p) => `• ${p.nombre}: ${cop(precio(A.get(p.id)))} → ${cop(precio(p))}`)}`);
        if (textos.length) informe.push(`📝 Cambió la descripción o el nombre: ${textos.length} (ya actualizado en la tienda)`);
        publicar = fs.readFileSync(RUTA_PRODUCTOS, 'utf8') !== crudoAntes;
    }
}

/* ---------- 2) ANC: TODO lo de su tienda (precios, cantidades, plazos, agotados, condiciones y productos que no vendes) ---------- */
try {
    const { leerTiendaAnc, leerCondicionesAnc, diferenciasAnc } = await import('./catalogo_ancpagos.mjs');
    const t = await leerTiendaAnc();
    const ahora = Object.fromEntries((t.tienda ?? []).flatMap((p) => p.variantes.map((v) => [`${p.nombre} · ${v.nombre || 'única'}`,
        { precio: v.precio, disponible: v.disponible, stock: v.stock ?? null, plazo_dias: v.plazo_dias ?? null }])));
    const previo = leerJson(ANTES_ANC, null);
    const completa = !previo || Object.keys(ahora).length >= Object.keys(previo).length * 0.6;
    if (previo && completa) informe.push(...diferenciasAnc(previo, ahora, { cop }));
    if (completa) fs.writeFileSync(ANTES_ANC, JSON.stringify(ahora, null, 1));
    // Condiciones y descripción de cada producto: aviso cuando cambian (garantías, región, reglas de uso…)
    const RUTA_COND = path.join(SALIDA, 'vigilante-anc-condiciones.json');
    const condPrevias = leerJson(RUTA_COND, null);
    const cond = await leerCondicionesAnc(t.tienda ?? []);
    if (condPrevias) {
        const cambiaron = Object.keys(cond).filter((k) => condPrevias[k] && condPrevias[k].huella !== cond[k].huella);
        if (cambiaron.length) informe.push(`📝 ANC cambió la descripción o las condiciones de:\n${cambiaron.slice(0, 10).map((k) => `• ${k} · ${cond[k].url}`).join('\n')}\nRevisa si cambia lo que le prometes al cliente.`);
    }
    if (Object.keys(cond).length >= Object.keys(condPrevias ?? {}).length * 0.6) fs.writeFileSync(RUTA_COND, JSON.stringify({ ...(condPrevias ?? {}), ...cond }, null, 1));
    // Productos de ANC que aún no vendes (se avisa cada uno una sola vez)
    const { _nota, ...eq } = leerJson(path.join(RAIZ, 'herramientas', 'equivalencias-ancpagos.json'), {});
    const plano = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const vendidos = new Set([...Object.values(eq).map((e) => plano(e.proveedor)), ...(t.filas ?? []).map((x) => plano(String(x.tienda ?? '').split(' · ')[0]))]);
    const RUTA_NO = path.join(SALIDA, 'vigilante-anc-no-vendidos.json');
    const avisados = new Set(leerJson(RUTA_NO, []));
    const noVendidos = (t.tienda ?? []).filter((p) => !vendidos.has(plano(p.nombre)) && !avisados.has(p.nombre));
    // ¿Ya lo tienes en tu tienda con otro nombre (precio manual, sin enlace a ANC)? Si el nombre trae modelo (D16, GT5…)
    // ese modelo debe estar; si no, las dos primeras palabras (sin «PIN virtual»)
    const propios = leerJson(path.join(RAIZ, 'productos.json'), []).filter((x) => !String(x.id).startsWith('er-')).map((x) => ` ${plano(x.nombre)} `);
    const claves = (x) => { const w = plano(x).replace(/^(pin virtual|pin) /, '').split(' '); const modelos = w.filter((t) => /\d/.test(t) && /[a-z]/.test(t)); return modelos.length ? modelos : w.slice(0, 2); };
    const yaLoTienes = (p) => propios.some((n) => claves(p.nombre).every((t) => n.includes(` ${t} `)));
    const linea = (p) => {
        const precios = p.variantes.map((x) => x.precio).filter(Boolean);
        const und = p.variantes.map((x) => x.stock).filter((x) => Number.isInteger(x));
        return `• ${p.nombre} · ${precios.length ? cop(Math.min(...precios)) : 's/p'}${und.length ? ` · ${und.reduce((x, y) => x + y, 0)} und.` : ''}`;
    };
    const sinEnlace = noVendidos.filter(yaLoTienes), nuevosAnc = noVendidos.filter((p) => !yaLoTienes(p));
    if (sinEnlace.length) informe.push(`🔗 Los vendes pero su precio no se ajusta solo desde ANC (falta enlazarlos en equivalencias-ancpagos.json):\n${sinEnlace.slice(0, 15).map(linea).join('\n')}`);
    if (nuevosAnc.length) informe.push(`🧾 ANC vende y tú aún no (decide si los agregas; su precio público es tu costo de referencia):\n${nuevosAnc.slice(0, 15).map(linea).join('\n')}${nuevosAnc.length > 15 ? `\n… y ${nuevosAnc.length - 15} más` : ''}`);
    if (noVendidos.length && !PROBAR) fs.writeFileSync(RUTA_NO, JSON.stringify([...avisados, ...noVendidos.map((p) => p.nombre)], null, 1));
} catch (e) {
    informe.push(`⚠️ No pude leer la tienda de ANC: ${String(e.message).slice(0, 140)}`);
}

/* ---------- 2b) Descripciones de ANC (tecnología y pines enlazados): se actualizan en productos.json y se publican ---------- */
{
    const antes = fs.readFileSync(RUTA_PRODUCTOS, 'utf8');
    const rd = spawnSync(process.execPath, [path.join(RAIZ, 'herramientas', 'descripciones-anc.mjs'), ...(PROBAR ? [] : ['--aplicar'])], { cwd: RAIZ, encoding: 'utf8', timeout: 10 * 60e3 });
    const n = /DESCRIPCIONES ANC: (\d+)/.exec(rd.stdout || '')?.[1];
    if (n && fs.readFileSync(RUTA_PRODUCTOS, 'utf8') !== antes) { publicar = true; informe.push(`📝 Descripciones de ANC actualizadas en tu tienda: ${n} productos`); }
    else if (rd.status !== 0) informe.push(`⚠️ No pude actualizar descripciones de ANC: ${String(rd.stderr || '').trim().split('\n').pop()?.slice(0, 140)}`);
}

/* ---------- 2c) Lo que ya no hay en ANC ni en Emprende Red no se muestra (disponibilidad.json); lo que vuelve, reaparece ---------- */
{
    const antes = fs.existsSync(path.join(RAIZ, 'disponibilidad.json')) ? fs.readFileSync(path.join(RAIZ, 'disponibilidad.json'), 'utf8') : '';
    const rd = spawnSync(process.execPath, [path.join(RAIZ, 'herramientas', 'disponibilidad-proveedores.mjs'), ...(PROBAR ? [] : ['--aplicar'])], { cwd: RAIZ, encoding: 'utf8', timeout: 10 * 60e3 });
    const ahora = fs.existsSync(path.join(RAIZ, 'disponibilidad.json')) ? fs.readFileSync(path.join(RAIZ, 'disponibilidad.json'), 'utf8') : '';
    if (/DISPONIBILIDAD: actualizada/.test(rd.stdout || '') && ahora !== antes) {
        publicar = true;
        const leer = (t) => { try { const j = JSON.parse(t); return new Set([...Object.keys(j.ocultos ?? {}), ...Object.entries(j.variantes ?? {}).flatMap(([id, v]) => Object.keys(v).map((x) => `${id} · ${x}`))]); } catch { return new Set(); } };
        const a = leer(antes), b = leer(ahora);
        const salen = [...b].filter((x) => !a.has(x)), vuelven = [...a].filter((x) => !b.has(x));
        if (salen.length) informe.push(`🙈 Ya no salen en la tienda (no los hay en el proveedor):\n${salen.slice(0, 12).map((x) => `• ${x}`).join('\n')}${salen.length > 12 ? `\n… y ${salen.length - 12} más` : ''}`);
        if (vuelven.length) informe.push(`✅ Volvieron a la tienda:\n${vuelven.slice(0, 12).map((x) => `• ${x}`).join('\n')}`);
    } else if (/Lectura incompleta/.test(rd.stdout || '')) informe.push('⚠️ No pude leer bien ANC: la disponibilidad queda como estaba.');
}

/* ---------- 3) Políticas de los proveedores ---------- */
const textoPlano = (html) => String(html ?? '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const POLITICAS = [
    { id: 'anc-terminos', nombre: 'Términos de ANC', url: 'https://allnecessarycolombia.com/terminos-y-condiciones/' },
    { id: 'anc-privacidad', nombre: 'Privacidad de ANC', url: 'https://allnecessarycolombia.com/politica-de-privacidad/' },
    { id: 'anc-devolucion', nombre: 'Devoluciones de ANC', url: 'https://allnecessarycolombia.com/politica-de-devolucion/' },
    { id: 'er-terminos', nombre: 'Términos de Emprende Red', url: 'https://emprendered.com.co/terminos-y-condiciones', inertia: true },
];
const polAntes = leerJson(ANTES_POL, {});
const polAhora = { ...polAntes };
for (const p of POLITICAS) {
    try {
        const res = await fetch(p.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
        if (!res.ok) continue;
        const html = await res.text();
        let texto;
        if (p.inertia) {
            const b = /<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
            texto = textoPlano(b ? JSON.stringify(JSON.parse(b[1]).props?.data ?? '') : '');
        } else {
            // Solo el contenido principal (sin menú ni pie que cambian solos)
            const cuerpo = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
            texto = textoPlano(cuerpo);
        }
        const h = huella(texto);
        if (polAntes[p.id] && polAntes[p.id].huella !== h) {
            const viejas = new Set(String(polAntes[p.id].texto).split(/(?<=[.!?])\s+/));
            const nuevas = texto.split(/(?<=[.!?])\s+/).filter((x) => x.length > 25 && !viejas.has(x)).slice(0, 3);
            informe.push(`📜 Cambió: ${p.nombre}\n${p.url}${nuevas.length ? `\nTexto nuevo:\n${nuevas.map((x) => `«${x.slice(0, 220)}»`).join('\n')}` : ''}\nRevisa si afecta tus garantías o tus páginas legales.`);
        }
        polAhora[p.id] = { huella: h, texto: texto.slice(0, 20000), url: p.url, revisado: new Date().toISOString() };
    } catch { /* la siguiente corrida lo intenta */ }
}
fs.writeFileSync(ANTES_POL, JSON.stringify(polAhora, null, 1));
if (polAhora['er-terminos'] && polAhora['er-terminos'].texto.length < 30 && !polAntes['er-terminos']) informe.push('📜 Emprende Red sigue sin términos publicados: pídeselos por escrito.');

/* ---------- 4) Publicar la tienda (si cambió el catálogo) ---------- */
if (publicar && !PROBAR) {
    try {
        const correr = (cmd, a) => execFileSync(cmd, a, { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10 * 60e3 });
        correr(process.execPath, [path.join(RAIZ, 'herramientas', 'generar_seo.js')]);
        correr(process.execPath, [path.join(RAIZ, 'herramientas', 'generar_feed_google.js')]);
        correr(process.execPath, [path.join(RAIZ, 'generar_bot_conocimiento.js')]);
        correr(process.execPath, [path.join(RAIZ, 'herramientas', 'versionar.js')]);
        JSON.parse(fs.readFileSync(RUTA_PRODUCTOS, 'utf8'));
        JSON.parse(fs.readFileSync(path.join(RAIZ, 'bot-conocimiento.json'), 'utf8'));
        const rutas = ['disponibilidad.json', 'productos.json', 'bot-conocimiento.json', 'p', 'c', 'guias', 'sitemap.xml', 'robots.txt', 'index.html', 'merchant', 'supabase/wo-041-emprendered.sql', 'admin.html', 'cliente.html', 'portal.html'];
        correr('git', ['add', '--', ...rutas.filter((x) => fs.existsSync(path.join(RAIZ, x)))]);
        const diff = correr('git', ['diff', '--cached']);
        if (/gsk_[a-z0-9]{10}|nvapi-[a-z0-9]{10}|sk-or-v1|AIza[0-9A-Za-z_-]{20}|ghp_[A-Za-z0-9]{20}|eyJhbGciOi/i.test(diff)) throw new Error('el cambio parece contener una clave: no se publica');
        if (diff.trim()) {
            correr('git', ['commit', '-m', `Catálogo al día (vigilante diario ${new Date().toISOString().slice(0, 10)})`]);
            correr('git', ['pull', '--rebase', 'origin', 'main']);
            correr('git', ['push', 'origin', 'main']);
            informe.push('✅ Tienda, páginas de Google y Shopping actualizadas y publicadas.');
        }
    } catch (e) {
        informe.push(`⚠️ No pude publicar la actualización: ${String(e.stderr || e.message).trim().split('\n').pop()?.slice(0, 160)}. Queda en el PC para revisarla.`);
    }
}

/* ---------- 4b) El sitio en vivo (páginas del sitemap, recursos, bot, Shopping y fotos) ---------- */
{
    const rs = spawnSync(process.execPath, [path.join(RAIZ, 'herramientas', 'revisar-sitio.mjs')], { cwd: RAIZ, encoding: 'utf8', timeout: 15 * 60e3 });
    const fallasSitio = (rs.stdout || '').split('\n').filter((l) => l.startsWith('FALLA')).map((l) => l.replace(/^FALLA\s+/, ''));
    if (rs.status !== 0) informe.push(`🌐 *El sitio tiene fallas*\n${(fallasSitio.length ? fallasSitio : ['la revisión no terminó']).map((l) => `• ${l}`).join('\n')}`);
}

/* ---------- 5) Informe ---------- */
const texto = informe.length ? ['🛰️ *Vigilante del catálogo · DC Tecnology*', '', ...informe].join('\n\n') : null;
log(texto ? texto.replace(/\n+/g, ' | ').slice(0, 900) : 'sin cambios');
if (PROBAR) { console.log(texto ?? 'Sin cambios en proveedores ni políticas.'); process.exit(0); }
const admin = String(env.NUMERO_AVISO_ADMIN ?? '').replace(/\D/g, '').replace(/^(3\d{9})$/, '57$1');
if (texto && admin && env.EVOLUTION_URL && env.EVOLUTION_API_KEY && env.EVOLUTION_INSTANCIA) {
    try {
        await fetch(`${env.EVOLUTION_URL.replace(/\/+$/, '')}/message/sendText/${env.EVOLUTION_INSTANCIA}`, { method: 'POST', headers: { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: admin, text: texto.slice(0, 3800) }), signal: AbortSignal.timeout(30000) });
    } catch (e) { log(`no pude enviarte el informe: ${e.message}`); }
}
