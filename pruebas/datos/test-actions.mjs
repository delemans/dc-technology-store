// Workflows de GitHub Actions (T13): hora, permisos, script correcto y sin claves escritas
import fs from 'node:fs'; import path from 'node:path';
const ok = (c, msg) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${msg}`); if (!c) process.exitCode = 1; };
const dir = new URL('../../.github/workflows/', import.meta.url);
const archivos = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)) : [];
ok(archivos.includes('vigilante-catalogo.yml'), 'existe el workflow del vigilante del catálogo');
const y = fs.readFileSync(new URL('vigilante-catalogo.yml', dir), 'utf8');
ok(/cron: '30 11 \* \* \*'/.test(y) && /workflow_dispatch:/.test(y), 'corre a diario 11:30 UTC (6:30 a. m. Bogotá) y también a mano');
ok(/contents: write/.test(y) && /fetch-depth: 0/.test(y), 'puede publicar en main (permiso y historial completo para pull --rebase)');
ok(/node herramientas\/vigilante-catalogo\.mjs/.test(y) && fs.existsSync(new URL('../../herramientas/vigilante-catalogo.mjs', import.meta.url)), 'ejecuta el mismo script que la tarea de Windows');
ok(!/--instalar|powershell/i.test(y), 'no usa nada de Windows');
for (const f of archivos) {
    const t = fs.readFileSync(new URL(f, dir), 'utf8');
    const valores = [...t.matchAll(/^\s*[A-Z_]+:\s*(.+)$/gm)].map((m) => m[1].trim()).filter((v) => !/^\$\{\{\s*secrets\.[A-Z_]+\s*\}\}$/.test(v) && !/^America\//.test(v));
    ok(!valores.length && !/(sk-|gsk_|nvapi-|AIza)[\w-]{10}/.test(t), `${f}: las variables vienen solo de secrets (sin claves escritas)`);
}
// El vigilante tolera no tener WhatsApp: solo envía el informe si existen las 4 variables
const v = fs.readFileSync(new URL('../../herramientas/vigilante-catalogo.mjs', import.meta.url), 'utf8');
ok(/env\.EVOLUTION_URL && env\.EVOLUTION_API_KEY && env\.EVOLUTION_INSTANCIA/.test(v), 'sin secretos de WhatsApp el vigilante no intenta enviar el informe');
ok(/'pull', '--rebase'/.test(v), 'el vigilante actualiza antes de subir (no choca con la tarea del PC)');
