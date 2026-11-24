// 24/11/2026 · Publicidad de diciembre: cada producto de ANC visible tiene su pieza, con tema propio y sin datos inventados
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const RAIZ = new URL('../../', import.meta.url);
const salida = execFileSync(process.execPath, ['--use-system-ca', new URL('herramientas/publicidad-diciembre.mjs', RAIZ).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' '), '--probar', '--forzar-precios'], { encoding: 'utf8' });
ok(!/sin gancho/.test(salida), 'todos los productos visibles de ANC tienen su gancho de diciembre');
const filas = salida.split('\n').filter((l) => /^\s+\d{2} · /.test(l));
ok(filas.length >= 30, `una pieza por producto (${filas.length})`);
const temas = filas.map((l) => l.split(' · ')[1].trim());
ok(new Set(temas).size === temas.length, 'cada pieza tiene una temática distinta');
ok(filas.some((l) => /Mantenimiento/.test(l) && /\$60\.000/.test(l)), 'mantenimiento preventivo a $60.000');
ok(filas.some((l) => /Reparación/.test(l) && /\$25\.000/.test(l)), 'revisión del equipo a $25.000');
const codigo = fs.readFileSync(new URL('herramientas/publicidad-diciembre.mjs', RAIZ), 'utf8');
// Los textos que ve el cliente (ganchos) y el uso de precios: nada de «antes», % ni descuentos
const ganchos = codigo.split('const GANCHOS = {')[1].split('\n};')[0];
ok(!/precio_anterior/.test(codigo) && !/\d\s*%|descuento|ahorra|antes:|precio anterior/i.test(ganchos), 'sin precio «antes» ni descuentos en las piezas');
ok(!/\bANC\b|Emprende|allnecessary/i.test(codigo.split('/* ---------- Pieza HTML')[1] ?? ''), 'las piezas no nombran al proveedor');
