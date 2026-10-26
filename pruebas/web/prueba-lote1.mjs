// Lote 1 de mejoras: ?buscar= abre el catálogo filtrado, «Saltar al contenido», página 404 y sin errores
import { spawn } from 'node:child_process';
const BASE = process.argv[2] ?? 'http://localhost:5599';
const PUERTO = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${process.env.TEMP}/l1-${PUERTO}`, 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let lista; for (let i = 0; i < 50; i++) { try { lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); if (lista.some((t) => t.type === 'page')) break; } catch {} await esperar(200); }
const ws = new WebSocket(lista.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); });
const enviar = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (e) => { const r = await enviar('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.exceptionDetails ? 'ERROR' : r.result?.value; };
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
await enviar('Page.enable'); await enviar('Runtime.enable');
for (const [ancho, alto, movil] of [[390, 844, true], [1366, 900, false]]) {
    await enviar('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: movil });
    await enviar('Page.navigate', { url: `${BASE}/?buscar=roblox` }); await esperar(6500);
    const r = await ev(`({vista: document.documentElement.dataset.vistaActiva, valor: document.getElementById('searchInput').value, n: document.querySelectorAll('#product-grid article').length,
        todos: [...document.querySelectorAll('#product-grid article')].every(a => /roblox/i.test(a.textContent)), url: location.href})`);
    ok(r.vista === 'catalogo' && r.valor === 'roblox' && r.n > 0 && r.todos, `${ancho}px: ?buscar=roblox abre el Catálogo filtrado (${r.n} resultados)`);
    ok(!/buscar=/.test(r.url), `${ancho}px: la dirección queda limpia (${r.url})`);
    await enviar('Page.navigate', { url: `${BASE}/` }); await esperar(5000);
    await enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await esperar(300);
    const s = await ev(`(()=>{const a=document.activeElement;const b=a.getBoundingClientRect();return {cls:a.className, top:Math.round(b.top)}})()`);
    ok(s.cls === 'saltar' && s.top >= 0, `${ancho}px: el primer Tab muestra «Saltar al contenido» (${JSON.stringify(s)})`);
    await ev(`document.querySelector('.saltar').click()`); await esperar(500);
    ok(await ev(`document.activeElement.id === 'contenido' || document.getElementById('contenido').contains(document.activeElement)`) && await ev(`document.documentElement.dataset.vistaActiva`) === 'inicio', `${ancho}px: lleva el foco al contenido sin cambiar de módulo`);
}
await enviar('Page.navigate', { url: `${BASE}/404.html` }); await esperar(1500);
ok(await ev(`document.querySelector('h1').textContent.includes('no existe') && document.querySelector('form').action.includes('dctecnology.xyz')`), '404: mensaje y buscador hacia la tienda');
ok(await ev(`document.documentElement.scrollWidth <= innerWidth`), '404: sin desborde en 390 px');
ok(errs.length === 0, `sin errores de JS ${errs.join(' | ')}`);
ws.close(); chrome.kill();
