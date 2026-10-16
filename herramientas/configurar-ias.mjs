// herramientas/configurar-ias.mjs — Prueba las IA del bot (herramientas/proveedores-ia.mjs) con tus claves de .env.
//   node herramientas/configurar-ias.mjs            → prueba cada una, elige su modelo y muestra cuáles faltan (no cambia nada)
//   node herramientas/configurar-ias.mjs --aplicar  → además guarda en .env el modelo elegido (IA_<ID>_MODELO)
// Después: node herramientas/sincronizar-n8n.mjs --aplicar (lleva las claves al nodo "IA balanceada" de tu n8n).
// Las claves nunca se imprimen completas ni van a git.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PROVEEDORES_IA, armarProveedores } from './proveedores-ia.mjs';

const require = createRequire(import.meta.url);
const { RAIZ, cargarEntorno, ocultar } = require('./entorno.js');
const APLICAR = process.argv.includes('--aplicar');
const env = cargarEntorno();
const pista = (e) => (/CERT|SELF_SIGNED/i.test(String(e?.cause?.code ?? e?.cause ?? e)) ? 'certificado (Kaspersky): ejecuta con NODE_EXTRA_CA_CERTS' : String(e?.cause?.code ?? e?.message ?? e));

async function probar(url, clave, modelo) {
    const t = Date.now();
    try {
        const r = await fetch(`${url}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelo, max_tokens: 400, temperature: 0, messages: [ // 400: los modelos que "piensan" necesitan espacio (el bot usa 500)
                { role: 'system', content: 'Eres el asistente de DC Tecnology, tienda colombiana. Responde en español.' },
                { role: 'user', content: 'Responde solo la palabra: listo' }] }) });
        const j = await r.json().catch(() => ({}));
        const texto = String(j.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (r.ok && texto) return { ok: true, ms: Date.now() - t, texto };
        return { ok: false, motivo: `HTTP ${r.status} ${String(j.error?.message ?? j.message ?? j[0]?.error?.message ?? (r.ok ? 'respuesta vacía' : '')).replace(/\s+/g, ' ').slice(0, 140)}` };
    } catch (e) { return { ok: false, motivo: pista(e) }; }
}
async function modelos(url, clave) {
    try {
        const r = await fetch(`${url}/models`, { headers: { Authorization: `Bearer ${clave}` } });
        const j = await r.json().catch(() => ({}));
        return (Array.isArray(j) ? j : j.data ?? []).map((m) => String(m.id ?? m.name ?? '').replace(/^models\//, '')).filter(Boolean);
    } catch { return []; }
}

console.log(`\n${APLICAR ? 'APLICAR' : 'PRUEBA (usa --aplicar para guardar los modelos en .env)'} · IA del bot\n`);
const activas = armarProveedores(env);
const cambiosEnv = {};
for (const p of PROVEEDORES_IA) {
    const cfg = activas.find((a) => a.nombre === p.nombre);
    if (!cfg) {
        const apagada = String(env[p.claveEnv] ?? '').trim();
        console.log(`  · ${p.nombre.padEnd(13)} ${apagada ? 'apagada (IA_' + p.id + '_APAGADA)' : `sin clave → créala en ${p.registro} y ponla en .env como ${p.claveEnv}=…`}  (${p.nota})`);
        continue;
    }
    let r = await probar(cfg.url, cfg.clave, cfg.modelo);
    let elegido = cfg.modelo;
    if (!r.ok && !/HTTP 40[123]\b|HTTP 402/.test(r.motivo)) {
        // El modelo por defecto no está o cambió de nombre: se busca el mejor de su lista
        const ids = await modelos(cfg.url, cfg.clave);
        const candidatos = p.preferir.flatMap((re) => ids.filter((i) => re.test(i))).filter((x, i, a) => a.indexOf(x) === i && x !== cfg.modelo)
            .filter((x) => !activas.some((o) => o !== cfg && o.clave === cfg.clave && o.modelo === x)); // no repetir el modelo de otra entrada con la misma clave
        for (const c of candidatos.slice(0, 5)) {
            const otra = await probar(cfg.url, cfg.clave, c);
            if (otra.ok) { r = otra; elegido = c; break; }
        }
    }
    console.log(`  ${r.ok ? '✔' : '✘'} ${p.nombre.padEnd(13)} ${elegido} · clave ${ocultar(cfg.clave)} · peso ${cfg.peso} · ${r.ok ? `responde «${r.texto.slice(0, 20)}» en ${r.ms} ms` : r.motivo}`);
    if (r.ok && elegido !== cfg.modelo) cambiosEnv[p.modeloEnv ?? `IA_${p.id}_MODELO`] = elegido;
}
const listas = activas.length;
console.log(`\n  ${listas} IA con clave. El bot reparte entre ellas según su peso y salta a la siguiente si una falla.`);
if (Object.keys(cambiosEnv).length) {
    console.log(`  Modelos nuevos: ${Object.entries(cambiosEnv).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    if (APLICAR) {
        const archivo = path.join(RAIZ, '.env');
        let texto = fs.readFileSync(archivo, 'utf8');
        for (const [k, v] of Object.entries(cambiosEnv)) {
            const linea = `${k}=${v}`;
            texto = new RegExp(`^${k}=.*$`, 'm').test(texto) ? texto.replace(new RegExp(`^${k}=.*$`, 'm'), linea) : `${texto.replace(/\s*$/, '')}\n${linea}\n`;
        }
        fs.writeFileSync(archivo, texto);
        console.log('  ✔ guardados en .env');
    }
}
console.log('  Siguiente paso: node herramientas/sincronizar-n8n.mjs --aplicar\n');
