// 24/11/2026 · Videos de diciembre: un video por pieza, 7 formatos variados, sin datos inventados ni proveedor
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const RAIZ = new URL('../../', import.meta.url);
const ruta = (f) => new URL(f, RAIZ).pathname.replace(/^\/([A-Za-z]:)/, '$1').replace(/%20/g, ' ');
const salida = execFileSync(process.execPath, ['--use-system-ca', ruta('herramientas/videos-diciembre.mjs'), '--formatos'], { encoding: 'utf8' });
const filas = salida.split('\n').filter((l) => /^\s+\d{2} · /.test(l)).map((l) => l.split(' · ').map((s) => s.trim()));
ok(filas.length >= 31 && filas[0][0] === '00', `un video por pieza + el resumen (${filas.length})`);
const formatos = filas.slice(1).map((f) => f[1]);
ok(new Set(formatos).size === 7, 'se usan los 7 formatos de video');
ok(formatos.every((f, i) => i === 0 || f !== formatos[i - 1]), 'nunca dos videos seguidos con el mismo formato');
const codigo = ['herramientas/videos-diciembre-escena.js', 'herramientas/videos-diciembre-codificar.js', 'herramientas/videos-diciembre.css', 'herramientas/videos-diciembre.mjs']
    .map((f) => fs.readFileSync(ruta(f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/\*)/.test(l)).join('\n')).join('\n'); // sin comentarios internos
ok(!/\bANC\b|Emprende|allnecessary/i.test(codigo), 'los videos no nombran al proveedor');
ok(!/precio_anterior|ahorra|\bantes:/i.test(codigo) && /validar_cupon/.test(codigo) && codigo.split('\n').filter((l) => /descuento/i.test(l)).every((l) => /cupon|DCTECH2026|primera compra/i.test(l)), 'sin precio «antes» ni descuentos inventados (solo el cupón real, verificado en la base)');
ok(/revisarVoz/.test(codigo) && /dick\|dicks\|dizzy/.test(codigo) && /no se oyó el precio/.test(codigo), 'cada locución se transcribe y se valida: palabras completas, la marca bien dicha y los precios');
ok(/precios_publicos|--json/.test(codigo), 'los precios salen de los mismos datos vigentes de las imágenes');
