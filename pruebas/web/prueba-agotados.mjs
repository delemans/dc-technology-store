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
ok(!ids.includes('office-365') && !ids.includes('recargas-claro') && !ids.includes('prime-video'), 'lo que ANC ya no tiene, lo sin proveedor y lo agotado en ANC no salen');
const net = await ev(`JSON.stringify(window.DCTienda.productos().find(p => p.id === 'netflix')?.variantes.map(v => v.nombre))`);
ok(net && !/Internacional/.test(net), `Netflix sin el plan internacional que ANC ya no ofrece (${net})`);
ok(ids.includes('servicio-mantenimiento-computadores'), 'los servicios propios siguen');
await ev(`(()=>{const i=document.getElementById('searchInput');i.value='office';i.dispatchEvent(new Event('input'))})()`); await esperar(900);
ok(await ev(`![...document.querySelectorAll('#product-grid article')].some(a => /Office 365/i.test(a.textContent))`), 'buscar «office» no muestra lo que no hay');
await enviar('Page.navigate', { url: 'http://localhost:5599/?producto=recargas-claro' }); await esperar(6000);
ok(await ev(`!document.querySelector('#modal-producto:not(.hidden)') || !/Claro/.test(document.getElementById('modal-title')?.textContent || '')`), 'el enlace directo a algo que no hay no abre su ficha');
ok(errs.length === 0, `sin errores de JS ${errs.join(' | ')}`);
ws.close(); chrome.kill();
