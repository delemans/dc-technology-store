// Cuentas del centro financiero (finanzas.js, funciones puras)
const __RAIZ = require('path').resolve(__dirname, '../..').replace(/\\/g, '/');
global.window = {};
require(__RAIZ + '/finanzas.js');
const F = window.Finanzas;
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const hoy = new Date('2026-10-19T15:00:00-05:00');
const r0 = F.rango('7d', hoy);
ok(r0.hasta.getTime() - r0.desde.getTime() === 7 * 864e5, '7 días = 7 días completos en hora de Colombia');
const datos = { movimientos: [
  { referencia: 'A', fecha: '2026-10-19T14:00:00-05:00', producto: 'Netflix Premium 4K', venta: 15000, costo: 14000, estado: 'ENTREGADO', canal: 'whatsapp', pagado: true },
  { referencia: 'B', fecha: '2026-10-18T10:00:00-05:00', producto: 'Office 365 Personal / Familiar', venta: 45000, costo: 30000, estado: 'REVISION_MANUAL', canal: 'web', pagado: true },
  { referencia: 'C', fecha: '2026-10-18T11:00:00-05:00', producto: 'Max (HBO)', venta: 8000, costo: null, estado: 'ESPERANDO_CREDENCIALES', canal: 'whatsapp', pagado: true },
  { referencia: 'D', fecha: '2026-10-17T11:00:00-05:00', producto: 'Max (HBO)', venta: 8000, costo: 8000, estado: 'REVISION_MANUAL', canal: 'whatsapp', pagado: false },
], por_cobrar: { ordenes: 2, total: 35000 }, inventario: { codigos: 3, costo: 72000 } };
const tipos = { 'Netflix Premium 4K': 'streaming', 'Office 365 Personal / Familiar': 'licencias', 'Max (HBO)': 'streaming' };
const r = F.resumir(datos, tipos, r0);
ok(r.ventas === 68000 && r.pedidos === 3, `ventas cobradas = solo pagados (${r.ventas})`);
ok(r.costo === 44000 && r.margen === 16000 && r.sinCosto === 1, `costo y margen solo de los que tienen costo; avisa 1 sin costo (${r.costo}, ${r.margen})`);
ok(Math.round(r.margenPct) === 27, `margen % sobre ventas con costo (${r.margenPct.toFixed(1)})`);
ok(r.porEntregar.pedidos === 2 && r.porEntregar.total === 53000, 'por entregar: pagados que no están ENTREGADO');
ok(r.porCobrar.pedidos === 3 && r.porCobrar.total === 43000, 'por cobrar: chats sin pago + órdenes web pendientes');
ok(r.porCategoria[0].clave === 'Licencias y apps' && r.porCategoria[0].ventas === 45000 && r.porCategoria[1].clave === 'Streaming' && r.porCategoria[1].ventas === 23000, 'por categoría con el tipo del catálogo, de mayor a menor');
ok(r.porCanal.find((x) => x.clave === 'Tienda web').ventas === 45000, 'por canal');
ok(r.serie.length === 7 && r.serie.at(-1).dia === '2026-10-19' && r.serie.at(-1).ventas === 15000 && r.serie.find((d) => d.dia === '2026-10-18').ventas === 53000, 'serie diaria continua con días en cero');
ok(r.inventario.codigos === 3 && r.inventario.costo === 72000, 'inventario de pines');
const c = F.csv(r).split('\r\n');
ok(c.length === 5 && c[0].startsWith('"Referencia"') && /"no"/.test(c[4]), 'CSV con todos los movimientos (pagados o no)');
