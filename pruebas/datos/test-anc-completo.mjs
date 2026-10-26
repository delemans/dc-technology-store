// ANC completo (23/10/2026): plazos, cantidades, condiciones y diferencias para el vigilante
const m = await import(new URL('../../herramientas/catalogo_ancpagos.mjs', import.meta.url).href);
const ok = (c, x) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${x}`); if (!c) process.exitCode = 1; };
ok(m.plazoDias('Pantalla 26 dias') === 26 && m.plazoDias('1 Mes') === 30 && m.plazoDias('3 Meses') === 90 && m.plazoDias('Licencia 1 Año') === 365 && m.plazoDias('Pantalla') === null, 'plazos: días, meses y años');
ok(m.entidades('Regi&oacute;n &iexcl;ya! &#225; &amp;') === 'Región ¡ya! á &', 'decodifica acentos y signos');
const prev = { 'Netflix · Pantalla 26 dias': { precio: 15000, disponible: true, stock: null, plazo_dias: 26 }, 'Max · Pantalla': { precio: 8000, disponible: true, stock: 5, plazo_dias: null }, 'Roku · Plan': { precio: 1, disponible: false } };
const ah = { 'Netflix · Pantalla 30 dias': { precio: 15000, disponible: true, stock: null, plazo_dias: 30 }, 'Max · Pantalla': { precio: 9000, disponible: true, stock: 2, plazo_dias: null }, 'Roku · Plan': { precio: 1, disponible: true, stock: 3 }, 'Nuevo · X': { precio: 5000, disponible: true, stock: null } };
const d = m.diferenciasAnc(prev, ah).join('\n');
ok(d.includes('• Netflix · Pantalla 26 dias → Netflix · Pantalla 30 dias') && !d.includes('ya no ofrece'), 'de 26 a 30 días = cambio de plazo (no plan ido)');
ok(d.includes('Max · Pantalla: $8.000 → $9.000'), 'cambio de precio');
ok(d.includes('Max · Pantalla: quedan 2'), 'pocas unidades (≤ 2)');
ok(d.includes('• Roku · Plan (3 und.)'), 'vuelve con sus unidades');
ok(d.includes('• Nuevo · X · $5.000'), 'plan nuevo');
ok(m.diferenciasAnc(ah, ah).length === 0, 'sin cambios → nada');
ok(m.diferenciasAnc({ a: { precio: 1, disponible: true, stock: 2 } }, { a: { precio: 1, disponible: true, stock: 1 } }).length === 0, 'ya estaba en pocas unidades → no repite el aviso cada día');
// En vivo
const t = await m.leerTiendaAnc();
ok(t.tienda.length >= 30 && t.tienda.every((p) => p.url), `tienda de ANC: ${t.tienda.length} productos, todos con su enlace`);
ok(t.tienda.some((p) => p.variantes.some((v) => Number.isInteger(v.stock))), 'trae cantidades donde ANC las publica');
const c = await m.leerCondicionesAnc(t.tienda.filter((p) => /disney|diademas gamer/i.test(p.nombre)), { pausa: 200 });
const textos = Object.values(c);
ok(textos.length >= 2 && textos.every((x) => !/&[a-z]+;/i.test(x.texto)) && new Set(textos.map((x) => x.huella)).size === textos.length, `condiciones propias de cada producto, sin códigos HTML (${textos.map((x) => x.texto.slice(0, 60).replace(/\n/g, ' / ')).join(' || ')})`);
// Descripciones: nada del proveedor ni promesas ajenas; lo propio se conserva; productos.json intacto en lo demás
{
    const texto = ['Desde $XX, disfruta del Reloj Z90 con monitoreo. ¡Compra ya!', '🛡️ COMPRA 100% SEGURA', 'Encuéntranos en tu Marketplace favorito', '2. Falabella y Linio',
        '⚡ Batería Larga: Hasta 5 días de uso.', 'Garantía 26 días y soporte 24/7 con nosotros.', 'Lunes a Domingo 10:00 AM a 11:30 PM', '💬 Escribir a WhatsApp', 'Conexión estable: respuesta inmediata en la app.'].join('\n');
    const h = m.descripcionDesdeAnc(texto, 'Reloj Inteligente Smartwatch Z90');
    ok(h.startsWith('<p>Disfruta del Reloj Z90 con monitoreo.') && h.includes('<strong>Batería Larga:</strong>') && h.includes('respuesta inmediata'), 'conserva resumen y características (con mayúscula y sin «Desde $XX»)');
    ok(!/marketplace|falabella|whatsapp|26 días|24\/7|lunes|compra ya/i.test(h), 'quita marketplaces, WhatsApp del proveedor, su garantía, su horario y sus llamados a comprar');
    ok(m.descripcionDesdeAnc('Descubre el Smartwatch X31 con pantalla.\nPantalla HD: nítida y brillante.', 'Reloj Smartwatch H19') === null, 'si habla de otro modelo (X31 en la página del H19), no se usa');
    const d = await import(new URL('../../herramientas/descripciones-anc.mjs', import.meta.url).href);
    const c1 = d.combinar('<strong>RECOMENDACIONES:</strong><br>• Uso: con cuidado', '<p>Nuevo</p>');
    ok(c1 === '<!--anc--><p>Nuevo</p><!--/anc--><br><br><strong>RECOMENDACIONES:</strong><br>• Uso: con cuidado' && d.combinar(c1, '<p>Otro</p>').startsWith('<!--anc--><p>Otro</p><!--/anc--><br><br><strong>RECOMENDACIONES'), 'reemplaza solo el bloque de ANC y conserva tus recomendaciones');
    const json = '[\n  {\n    "id": "a",\n    "imagen": "x",\n    "variantes": []\n  },\n  {\n    "id": "b",\n    "descripcion": "viejo",\n    "variantes": []\n  }\n]';
    const j2 = d.ponerDescripcion(d.ponerDescripcion(json, 'a', 'nuevo "a"'), 'b', 'nuevo b');
    const o = JSON.parse(j2);
    ok(o[0].descripcion === 'nuevo "a"' && o[1].descripcion === 'nuevo b' && j2.split('\n').length === json.split('\n').length + 1, 'productos.json: agrega o reemplaza solo esa línea');
}
