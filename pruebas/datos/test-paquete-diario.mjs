// 24/11/2026 · Paquete diario de diciembre: 2 videos + 3 imágenes por día, sin repetir productos en el día
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const RAIZ = new URL('../../', import.meta.url);
const ruta = (f) => new URL(f, RAIZ).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ');
const salida = execFileSync(process.execPath, ['--use-system-ca', ruta('herramientas/paquete-diario.mjs'), '--probar'], { encoding: 'utf8' });
const dias = salida.split('\n').filter((l) => /^\s+2026-\d\d-\d\d · /.test(l));
ok(dias.length === 37 && dias[0].includes('2026-11-25') && dias.at(-1).includes('2026-12-31'), `un paquete por día del 25/11 al 31/12 (${dias.length})`);
ok(dias.every((l) => { const ids = l.split('productos: ')[1].split(' · ')[0].split(', '); return new Set(ids).size === ids.length; }), 'cada día muestra productos distintos');
ok(dias.filter((l) => l.slice(2, 12) >= '2026-12-18').every((l) => /\(digital\)/.test(l)), 'desde el 18/12 el regalo del día es digital (llega por WhatsApp)');
ok(dias[0].includes('30 días para Navidad') && dias.find((l) => l.includes('2026-12-24')).includes('HOY es Nochebuena'), 'cuenta regresiva correcta (30 días el 25/11, Nochebuena el 24/12)');
ok(new Set(dias.map((l) => l.split('promo: ')[1].trim())).size >= 8, 'las promociones rotan (8 o más distintas)');
const codigo = fs.readFileSync(ruta('herramientas/paquete-diario.mjs'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
ok(!/\bANC\b|Emprende|allnecessary/i.test(codigo), 'no nombra al proveedor');
ok(!/precio_anterior|descuento|ahorra|\d\s*%\s*(off|dto)/i.test(codigo), 'sin precio «antes» ni descuentos inventados');
ok(/Nequi, Daviplata o Llave Bre-B/.test(codigo) && /Envíos a todo el país/.test(codigo), 'pagos y envíos como los dice la tienda');
