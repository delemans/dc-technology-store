// 03/11/2026 · Cantidades de los proveedores (disponibilidad.json → existencias): cálculo y horario cada 3 h en GitHub
import fs from 'node:fs';
const { calcular } = await import(new URL('../../herramientas/disponibilidad-proveedores.mjs', import.meta.url).href);
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };

const productos = [
    { id: 'er-bafle-1', existencias: 4, variantes: [{ nombre: 'Unidad' }] },
    { id: 'er-reloj-2', existencias: 0, variantes: [{ nombre: 'Unidad' }] },
    { id: 'netflix', tipo: 'streaming', variantes: [{ nombre: 'Pantalla 30 días' }, { nombre: 'Cuenta Completa 30 días' }] },
    { id: 'disney-plus', tipo: 'streaming', variantes: [{ nombre: 'Pantalla 1 Mes' }] },
];
const eq = { netflix: { proveedor: 'Netflix', variantes: { 'Pantalla 30 días': 'Pantalla 30 dias', 'Cuenta Completa 30 días': 'Completa 30 dias' } },
    'disney-plus': { proveedor: 'Disney', variantes: { 'Pantalla 1 Mes': 'Pantalla' } } };
const anc = [
    { producto: 'Netflix', variante: 'Pantalla 30 dias', agotado: false, stock: 3 },
    { producto: 'Netflix', variante: 'Completa 30 dias', agotado: false, stock: null },
    { producto: 'Disney', variante: 'Pantalla', agotado: false, stock: 0 },
];
const r = calcular(productos, eq, anc);
ok(r.existencias['er-bafle-1'] === 4, 'Emprende Red: guarda las unidades del producto');
ok(r.ocultos['er-reloj-2'] && !('er-reloj-2' in r.existencias), 'Emprende Red sin unidades: no sale y no lleva cantidad');
ok(r.existencias.netflix?.['Pantalla 30 días'] === 3 && !('Cuenta Completa 30 días' in r.existencias.netflix), 'ANC: cantidad por plan (sin cantidad publicada = sin límite)');
ok(r.ocultos['disney-plus'] && !('disney-plus' in r.existencias), 'ANC con 0 unidades: agotado, no sale');

const y = fs.readFileSync(new URL('../../.github/workflows/vigilante-catalogo.yml', import.meta.url), 'utf8');
ok(/cron: '0 \*\/3 \* \* \*'/.test(y) && /'--rapido'/.test(y), 'GitHub corre el vigilante rápido cada 3 h');
ok(/cron: '30 11 \* \* \*'/.test(y), '… y la revisión completa una vez al día');
const v = fs.readFileSync(new URL('../../herramientas/vigilante-catalogo.mjs', import.meta.url), 'utf8');
ok(/if \(!RAPIDO\) try \{/.test(v) && /if \(!RAPIDO\) \{\s*const antes = fs\.readFileSync\(RUTA_PRODUCTOS/.test(v) && /\/\* ---------- 3\) Políticas de los proveedores ---------- \*\/\s*if \(!RAPIDO\)/.test(v),
    'modo rápido: salta ANC al detalle, descripciones y políticas');
ok(!/if \(!RAPIDO\) \{\s*const antes = fs\.existsSync\(path\.join\(RAIZ, 'disponibilidad\.json'\)/.test(v), '… pero siempre recalcula la disponibilidad y las cantidades');
ok(/merge', '--ff-only'/.test(v) && /GITHUB_ACTIONS/.test(v), 'en el PC trae primero lo de GitHub (no trabaja sobre un catálogo viejo)');
const d = JSON.parse(fs.readFileSync(new URL('../../disponibilidad.json', import.meta.url), 'utf8'));
ok(d.existencias && typeof d.existencias === 'object', 'disponibilidad.json publicado trae las cantidades de los proveedores');
