// 25/10/2026: lo que ya no hay NO sale: agotado en la base, oculto en disponibilidad.json (ANC / Emprende Red / sin proveedor)
import { spawn } from 'node:child_process';
const PUERTO = 9400 + Math.floor(Math.random() * 100);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${process.env.TEMP}/ag-${PUERTO}`, 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let lista; for (let i = 0; i < 50; i++) { try { lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); if (lista.some((t) => t.type === 'page')) break; } catch {} await esperar(200); }
const ws = new WebSocket(lista.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); const errs = [];
// precios_publicos simulado con wo-050: un producto de tecnología agotado y un plan de Max agotado
const vivos = await (await fetch('https://vyqcizwfmjlflncdwzve.supabase.co/rest/v1/rpc/precios_publicos', { method: 'POST', headers: { apikey: 'sb_publishable_GvQiv6M7iSrlwsA90lXsOQ_5OfSYBwy', 'Content-Type': 'application/json' }, body: '{}' })).json();
const tec = vivos.find((x) => x.producto_id.startsWith('er-'));
const sim = vivos.map((x) => ({ ...x, existencias: x.producto_id.startsWith('er-') ? 5 : null, agotado: x.producto_id === tec.producto_id || (x.producto_id === 'hbo-max' && /Platino/.test(x.variante) && /Pantalla/.test(x.variante)) }));
const enviar = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); }
  else if (m.method === 'Fetch.requestPaused') {
    const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'application/json' }];
    if (m.params.request.method === 'OPTIONS') enviar('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 204, responseHeaders: [...cors, { name: 'Access-Control-Allow-Headers', value: '*' }] });
    else enviar('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: cors, body: Buffer.from(JSON.stringify(sim)).toString('base64') });
  } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); });
const ev = async (e) => (await enviar('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
await enviar('Page.enable'); await enviar('Runtime.enable');
await enviar('Fetch.enable', { patterns: [{ urlPattern: '*rpc/precios_publicos*' }] });
await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await enviar('Page.navigate', { url: 'http://localhost:5599/#catalogo' }); await esperar(9000);
const ids = await ev(`window.DCTienda.productos().map(p => p.id)`);
ok(Array.isArray(ids) && ids.length > 50, `catálogo cargado (${ids?.length} productos)`);
ok(!ids.includes(tec.producto_id), 'agotado en la base → no sale');
const max = await ev(`JSON.stringify(window.DCTienda.productos().find(p => p.id === 'hbo-max')?.variantes.map(v => v.nombre))`);
ok(max && !/Pantalla Platino/.test(max) && /Pantalla Estándar/.test(max), `plan agotado no sale; los demás sí (${max})`);
// Un ejemplo vigente de cada motivo (el catálogo cambia a diario: Prime Video volvió el 31/10)
const ocultos = (await (await fetch('http://localhost:5599/disponibilidad.json')).json()).ocultos ?? {};
const ejemplo = (re) => Object.entries(ocultos).find(([, v]) => re.test(v.motivo ?? v))?.[0];
const muestra = [ejemplo(/ya no ofrece/), ejemplo(/Sin proveedor/), ejemplo(/Agotado/)].filter(Boolean);
ok(muestra.length === 3 && muestra.every((x) => !ids.includes(x)), `lo que ANC ya no tiene, lo sin proveedor y lo agotado en ANC no salen (${muestra.join(', ')})`);
// Ningún plan que el proveedor ya no ofrece aparece (sea cual sea el producto hoy)
const fuera = await ev(`JSON.stringify(Object.entries(window.DCDisponibilidad?.variantes ?? {}).flatMap(([id, vs]) => {
    const p = window.DCTienda.productos().find((x) => x.id === id);
    return p ? p.variantes.filter((v) => vs[v.nombre]).map((v) => id + ' · ' + v.nombre) : [];
}))`);
ok(fuera === '[]', `ningún plan que ANC ya no ofrece aparece en la tienda (${fuera})`);
// Tope de cantidades del proveedor (03/11/2026): la base dice 5 unidades de todo lo de Emprende Red; el archivo manda si tiene menos
const tope = await ev(`JSON.stringify((() => {
    const ex = window.DCDisponibilidad?.existencias ?? {};
    const conMenos = window.DCTienda.productos().filter((p) => typeof ex[p.id] === 'number' && ex[p.id] < 5);
    const mal = window.DCTienda.productos().filter((p) => typeof ex[p.id] === 'number' && Number(p.existencias) > ex[p.id]).map((p) => p.id);
    return { revisados: conMenos.length, mal };
})())`);
const t = JSON.parse(tope ?? '{}');
ok(t.revisados > 0 && t.mal.length === 0, `la tienda nunca muestra más unidades que el proveedor (${t.revisados} con menos de 5 en el proveedor; mal: ${t.mal?.join(', ')})`);
const f = await ev(`JSON.stringify(window.DCTopeExistencias([
    { id: 'a', existencias: 9, variantes: [{ nombre: 'U' }] }, { id: 'b', existencias: 2, variantes: [{ nombre: 'U' }] },
    { id: 'c', existencias: 3, variantes: [{ nombre: 'U' }] }, { id: 'd', variantes: [{ nombre: 'P1' }, { nombre: 'P2' }] },
    { id: 'e', variantes: [{ nombre: 'P1' }, { nombre: 'P2' }] }, { id: 'z', existencias: 7, variantes: [] }],
    { existencias: { a: 4, b: 6, c: 0, d: { P1: 2, P2: 0 }, e: { P1: 3 } } }))`);
const r = Object.fromEntries(JSON.parse(f).map((p) => [p.id, p]));
ok(r.a.existencias === 4 && r.b.existencias === 2, 'tope: si el proveedor tiene menos, manda el proveedor; nunca sube la cantidad de la base');
ok(!r.c, 'tope: 0 unidades en el proveedor → no sale');
ok(r.d.variantes.length === 1 && r.d.variantes[0].existencias === 2 && r.d.existencias === 2, 'tope ANC: plan con 0 sale de la lista; el producto queda con lo del plan');
ok(r.e.variantes.length === 2 && r.e.existencias === undefined && r.e.variantes[0].existencias === 3, 'tope ANC: plan sin cantidad publicada = sin límite');
ok(r.z.existencias === 7, 'tope: sin dato del proveedor queda como está');
ok(ids.includes('servicio-mantenimiento-computadores'), 'los servicios propios siguen');
await ev(`(()=>{const i=document.getElementById('searchInput');i.value='office';i.dispatchEvent(new Event('input'))})()`); await esperar(900);
ok(await ev(`![...document.querySelectorAll('#product-grid article')].some(a => /Office 365/i.test(a.textContent))`), 'buscar «office» no muestra lo que no hay');
await enviar('Page.navigate', { url: 'http://localhost:5599/?producto=recargas-claro' }); await esperar(6000);
ok(await ev(`!document.querySelector('#modal-producto:not(.hidden)') || !/Claro/.test(document.getElementById('modal-title')?.textContent || '')`), 'el enlace directo a algo que no hay no abre su ficha');
ok(errs.length === 0, `sin errores de JS ${errs.join(' | ')}`);
ws.close(); chrome.kill();
