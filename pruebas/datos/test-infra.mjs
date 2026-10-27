// Paquete del servidor (T14): 6 servicios que se reinician solos, variables documentadas y sin claves escritas
import fs from 'node:fs';
const ok = (c, msg) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${msg}`); if (!c) process.exitCode = 1; };
const dir = new URL('../../infra/servidor/', import.meta.url);
const leer = (f) => fs.readFileSync(new URL(f, dir), 'utf8');

const compose = leer('docker-compose.yml');
const ejemplo = leer('env-servidor-ejemplo.txt');

// Servicios: claves con 2 espacios dentro de «services:»
const bloque = compose.split(/^services:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
const servicios = [...bloque.matchAll(/^ {2}([a-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
for (const s of ['caddy', 'n8n', 'postgres_n8n', 'evolution', 'postgres_evo', 'redis']) ok(servicios.includes(s), `servicio ${s}`);
const partes = bloque.split(/^ {2}(?=[a-z0-9_-]+:\s*$)/m).filter((p) => p.trim());
ok(partes.length >= 6 && partes.every((p) => /restart: unless-stopped/.test(p)), 'todos los servicios llevan restart: unless-stopped');

const vars = [...new Set([...compose.matchAll(/\$\{([A-Z0-9_]+)\}/g)].map((m) => m[1]))];
ok(vars.length >= 6, `el compose usa variables (${vars.length})`);
for (const v of vars) ok(new RegExp(`^${v}=\\s*$`, 'm').test(ejemplo), `${v} está en el ejemplo, sin valor`);

for (const f of fs.readdirSync(dir)) {
    const t = leer(f);
    const conValor = f.startsWith('env-') && /^[A-Z0-9_]+=\S/m.test(t);
    ok(!/(sk-|gsk_|nvapi-|AIza|eyJ)[\w-]{10}/.test(t) && !conValor, `${f}: sin claves escritas`);
}
