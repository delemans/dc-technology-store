// T08 · Gastos fijos, utilidad real y punto de equilibrio (finanzas.js, funciones puras)
const __RAIZ = require('path').resolve(__dirname, '../..').replace(/\\/g, '/');
global.window = {};
require(__RAIZ + '/finanzas.js');
const F = window.Finanzas;
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const r = { pedidos: 12, sinCosto: 2, margen: 200000 }; // 10 pedidos con costo → $20.000 de margen por pedido
const gastos = [{ id: 1, nombre: 'Internet', valor_mensual: 90000, activo: true }, { id: 2, nombre: 'Contador', valor_mensual: 250000, activo: true }, { id: 3, nombre: 'Viejo', valor_mensual: 999999, activo: false }];
let u = F.utilidad(r, gastos, 30);
ok(u.mensual === 340000 && u.periodo === 340000, 'suma solo los gastos activos ($340.000 al mes)');
ok(u.utilidad === -140000, 'utilidad real = margen − gastos ($200.000 − $340.000)');
ok(u.margenPedido === 20000 && u.equilibrio === 17, 'punto de equilibrio: $340.000 ÷ $20.000 → 17 pedidos al mes');
u = F.utilidad(r, gastos, 7);
ok(u.periodo === Math.round(340000 * 7 / 30) && u.utilidad === 200000 - u.periodo, 'en 7 días se prorratea el gasto mensual');
ok(F.utilidad({ pedidos: 0, sinCosto: 0, margen: 0 }, gastos, 30).equilibrio === null, 'sin ventas con costo no inventa el punto de equilibrio');
ok(F.utilidad(r, [], 30).equilibrio === null && F.utilidad(r, [], 30).utilidad === 200000, 'sin gastos: utilidad = margen');
const html = F.bloqueGastos(r, gastos, 30);
ok(/Gastos fijos y utilidad real/.test(html) && /17 pedidos/.test(html) && (html.match(/data-guardar-gasto/g) ?? []).length === 4, 'bloque: indicadores, 3 gastos y una fila nueva para agregar');
ok(/wo-057/.test(F.bloqueGastos(r, null, 30)), 'sin wo-057 dice qué SQL aplicar');
ok(!/<script/.test(F.bloqueGastos(r, [{ id: 9, nombre: '<script>x</script>', valor_mensual: 1, activo: true }], 30)), 'el nombre del gasto se escapa');
