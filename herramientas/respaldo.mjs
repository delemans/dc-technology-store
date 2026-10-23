// herramientas/respaldo.mjs — Respaldo semanal local de lo que no está en git: flujos de n8n (API), registros de herramientas/salida
// y la configuración de publicación. Queda en n8n/respaldos/AAAA-MM-DD/ (ignorado por git: los flujos llevan las claves de IA
// inyectadas en el código). Se conservan las 8 copias más recientes.
//   node herramientas/respaldo.mjs            → respalda ahora
//   node herramientas/respaldo.mjs --instalar → tarea semanal (domingo 2:00 a. m.)
// La base de Supabase no se respalda aquí (exigiría la service_role, que nunca se usa): ver el plan maestro, sección Seguridad.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { cargarEntorno } = require('./entorno.js');
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(RAIZ, 'n8n', 'respaldos');
const CONSERVAR = 8;

export function rotar(dir, conservar = CONSERVAR) {
    if (!fs.existsSync(dir)) return [];
    const copias = fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const borrar = copias.slice(0, Math.max(0, copias.length - conservar));
    for (const d of borrar) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
    return borrar;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    if (process.argv.includes('--instalar')) {
        const tarea = 'DC Tecnology - respaldo semanal';
        const ps = `$a = New-ScheduledTaskAction -Execute '${process.execPath}' -Argument '"${path.join(RAIZ, 'herramientas', 'respaldo.mjs')}"' -WorkingDirectory '${RAIZ}';
$t = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At '02:00';
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15);
Register-ScheduledTask -TaskName '${tarea}' -Action $a -Trigger $t -Settings $s -Description 'Respaldo semanal de flujos de n8n y registros (DC Tecnology).' -Force | Out-Null`;
        execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
        console.log(`Tarea "${tarea}" instalada: domingos 2:00 a. m. (si el PC estaba apagado, corre al encender).`);
        process.exit(0);
    }
    const env = cargarEntorno();
    const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const destino = path.join(BASE, hoy);
    fs.mkdirSync(destino, { recursive: true });
    const informe = [];
    // 1) Flujos de n8n
    if (env.N8N_URL && env.N8N_API_KEY) {
        try {
            const N8N = env.N8N_URL.replace(/\/+$/, '');
            const h = { 'X-N8N-API-KEY': env.N8N_API_KEY, Accept: 'application/json' };
            const lista = await (await fetch(`${N8N}/api/v1/workflows?limit=250`, { headers: h, signal: AbortSignal.timeout(30000) })).json();
            for (const w of lista.data ?? []) {
                const flujo = await (await fetch(`${N8N}/api/v1/workflows/${w.id}`, { headers: h, signal: AbortSignal.timeout(30000) })).json();
                fs.writeFileSync(path.join(destino, `n8n-${w.id}-${String(w.name).replace(/[^\w-]+/g, '_').slice(0, 60)}.json`), JSON.stringify(flujo, null, 1));
            }
            informe.push(`n8n: ${(lista.data ?? []).length} flujos`);
        } catch (e) { informe.push(`n8n: NO se pudo (${e.message})`); }
    } else informe.push('n8n: faltan N8N_URL y N8N_API_KEY en .env');
    // 2) Registros y estado de las herramientas (no están en git)
    const salida = path.join(RAIZ, 'herramientas', 'salida');
    let n = 0;
    if (fs.existsSync(salida)) {
        fs.mkdirSync(path.join(destino, 'salida'), { recursive: true });
        for (const f of fs.readdirSync(salida)) {
            const o = path.join(salida, f);
            if (fs.statSync(o).isFile() && fs.statSync(o).size < 20 * 1048576) { fs.copyFileSync(o, path.join(destino, 'salida', f)); n++; }
        }
    }
    informe.push(`registros: ${n} archivos`);
    const borradas = rotar(BASE);
    if (borradas.length) informe.push(`copias viejas borradas: ${borradas.join(', ')}`);
    const linea = `${new Date().toISOString()} respaldo ${hoy} · ${informe.join(' · ')}`;
    fs.appendFileSync(path.join(RAIZ, 'herramientas', 'salida', 'respaldo.log'), linea + '\n');
    console.log(linea);
}
