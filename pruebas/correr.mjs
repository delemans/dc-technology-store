// pruebas/correr.mjs — Corre todas las pruebas del proyecto y resume. Úsalo antes de cualquier commit.
//   npm test                 → todo (flujo, datos, SQL y web)
//   npm test -- flujo web    → solo esos grupos (flujo · datos · sql · web)
// Requisitos: Node 20+, Google Chrome instalado (pruebas web) y `npm install` (PGlite para SQL). Las de datos leen ANC y
// Emprende Red en vivo (necesitan internet). Ninguna escribe en Supabase ni envía WhatsApp.
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..');
const FLUJO = path.join(RAIZ, 'n8n', 'flujo_bot_dctechnology.json');
const pedidos = process.argv.slice(2);
const grupos = pedidos.length ? pedidos : ['flujo', 'datos', 'sql', 'web'];
const resumen = [];

const correr = (archivo, args = []) => {
    const r = spawnSync(process.execPath, [archivo, ...args], { cwd: path.dirname(archivo), encoding: 'utf8', timeout: 6 * 60e3 });
    const salida = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const ok = (salida.match(/^OK\b/gm) ?? []).length;
    const fallas = salida.split('\n').filter((l) => /^FALLA\b/.test(l));
    const roto = r.status !== 0 && !fallas.length;
    resumen.push({ prueba: path.relative(RAIZ, archivo), ok, fallas: fallas.length + (roto ? 1 : 0) });
    console.log(`${fallas.length || roto ? '✗' : '✓'} ${path.relative(RAIZ, archivo)}: ${ok} OK${fallas.length ? `, ${fallas.length} FALLA` : ''}${roto ? ' · se detuvo con error' : ''}`);
    for (const f of fallas.slice(0, 5)) console.log(`    ${f}`);
    if (roto) console.log(`    ${salida.trim().split('\n').slice(-3).join('\n    ')}`);
};
const lista = (g) => (fs.existsSync(path.join(AQUI, g)) ? fs.readdirSync(path.join(AQUI, g)).filter((f) => /\.(m?js)$/.test(f)).sort().map((f) => path.join(AQUI, g, f)) : []);

if (grupos.includes('flujo')) {
    console.log('\n— Flujo del bot (código real de cada nodo, sin enviar nada) —');
    spawnSync(process.execPath, [path.join(RAIZ, 'n8n', 'generar_flujo_n8n.js')], { cwd: RAIZ });
    for (const f of lista('flujo')) correr(f, [FLUJO]);
}
if (grupos.includes('datos')) {
    console.log('\n— Datos y proveedores (lee ANC y Emprende Red en vivo) —');
    for (const f of lista('datos')) correr(f);
}
if (grupos.includes('sql')) {
    console.log('\n— SQL en PGlite (Postgres en memoria) —');
    let pglite = true;
    try { await import('@electric-sql/pglite'); } catch { pglite = false; }
    if (!pglite) console.log('  (falta PGlite: corre `npm install` una vez)');
    else for (const f of lista('sql')) correr(f, [RAIZ]);
}
if (grupos.includes('web')) {
    console.log('\n— Web en Chrome sin ventana (http://localhost:5599) —');
    let servidor = null;
    try { await fetch('http://localhost:5599/index.html'); } catch { servidor = spawn(process.execPath, [path.join(AQUI, 'servidor.js')], { stdio: 'ignore' }); await new Promise((r) => setTimeout(r, 1500)); }
    for (const f of lista('web')) correr(f);
    servidor?.kill();
}
const total = resumen.reduce((s, x) => s + x.ok, 0), fallas = resumen.reduce((s, x) => s + x.fallas, 0);
console.log(`\nResultado: ${total} OK · ${fallas} FALLA en ${resumen.length} archivos`);
process.exitCode = fallas ? 1 : 0;
