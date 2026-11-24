// 24/11/2026 · Intro de marca y «Encuentra el regalo perfecto» (navidad.js): precios reales, filtros, enlace de publicidad,
// abre la ficha normal, sin desborde en celular y sin errores. La intro sale con ?intro, se salta y no tapa la tienda.
import { spawn } from 'node:child_process';
const BASE = process.argv[2] ?? 'http://localhost:5599';
const PUERTO = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${process.env.TEMP}/pn-${PUERTO}`, 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let lista; for (let i = 0; i < 50; i++) { try { lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); if (lista.some((t) => t.type === 'page')) break; } catch {} await esperar(200); }
const ws = new WebSocket(lista.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); });
const enviar = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (e) => (await enviar('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.value;
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
await enviar('Page.enable'); await enviar('Runtime.enable');
await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

// Intro de marca
await enviar('Page.navigate', { url: `${BASE}/?intro` }); for (let i = 0; i < 60 && !(await ev("!!document.getElementById('dc-intro')")); i++) await esperar(100);
ok(await ev(`!!document.getElementById('dc-intro') && /DC/.test(document.getElementById('dc-intro').innerText)`), 'la intro de marca sale al abrir (con ?intro)');
await ev(`document.querySelector('#dc-intro .dci-saltar').click()`); await esperar(800);
ok(await ev(`!document.getElementById('dc-intro')`), '«Saltar» la quita');
await enviar('Page.navigate', { url: `${BASE}/` }); await esperar(600);
ok(await ev(`!document.getElementById('dc-intro')`), 'en pruebas automáticas (y para buscadores) no sale');

// Buscador de regalos
await enviar('Page.navigate', { url: `${BASE}/?navidad#regalos?para=gamer` }); await esperar(6000);
ok(await ev(`!document.getElementById('regalos').hidden && /Faltan|Feliz|Mañana/.test(document.getElementById('regalos-cuenta').textContent)`), 'la sección de Navidad se ve con su cuenta regresiva');
ok(await ev(`document.querySelector('#regalos-para [aria-pressed="true"]')?.dataset.v === 'gamer'`), 'el enlace de publicidad #regalos?para=gamer deja elegido «Gamer»');
const precios = await ev(`(() => { const t = window.DCTienda.productos(); return [...document.querySelectorAll('#regalos-grid .nav-regalo')].map((b) => { const p = t.find((x) => x.id === b.dataset.id); const min = Math.min(...p.variantes.map((v) => Number(v.precio)).filter((v) => v > 0)); return b.getAttribute('aria-label').includes(window.DCTienda.formatearPrecio(min)); }); })()`);
ok(precios.length >= 2 && precios.every(Boolean), `los regalos muestran el precio vigente de la tienda (${precios.length})`);
await ev(`[...document.querySelectorAll('#regalos-presupuesto .nav-chip')].find((b) => b.dataset.v === '20000').click()`); await esperar(300);
ok(await ev(`(() => { const t = window.DCTienda.productos(); return [...document.querySelectorAll('#regalos-grid .nav-regalo')].every((b) => { const p = t.find((x) => x.id === b.dataset.id); return Math.min(...p.variantes.map((v) => Number(v.precio)).filter((v) => v > 0)) < 20000; }); })()`), 'el filtro «Menos de $20.000» respeta el precio');
await ev(`[...document.querySelectorAll('#regalos-para .nav-chip')].find((b) => b.dataset.v === 'todos').click()`); await ev(`[...document.querySelectorAll('#regalos-presupuesto .nav-chip')].find((b) => b.dataset.v === '0').click()`); await esperar(300);
ok(await ev(`new Set([...document.querySelectorAll('#regalos-grid .nav-regalo')].map((b) => window.DCTienda.productos().find((x) => x.id === b.dataset.id).tipo)).size >= 3`), '«Todos» mezcla tecnología, plataformas y pines');
await ev(`document.querySelector('#regalos-grid .nav-regalo').click()`); await esperar(900);
ok(await ev(`!document.getElementById('product-modal').classList.contains('hidden') || document.getElementById('product-modal').open || getComputedStyle(document.getElementById('product-modal')).display !== 'none'`), 'tocar un regalo abre su ficha de compra');
ok(await ev(`document.documentElement.scrollWidth <= innerWidth`), 'sin desborde en 390 px');
ok(errs.length === 0, `sin errores de JS ${errs.join(' | ')}`);
ws.close(); chrome.kill();
