import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PUERTO = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${process.env.TEMP}/ori-${PUERTO}`, 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let lista; for (let i = 0; i < 50; i++) { try { lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); if (lista.some((t) => t.type === 'page')) break; } catch {} await esperar(200); }
const ws = new WebSocket(lista.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); });
const enviar = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (e) => { const r = await enviar('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'ERROR ' + r.exceptionDetails.exception?.description?.slice(0, 150); return r.result?.value; };
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
await enviar('Page.enable'); await enviar('Runtime.enable');
await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
// T05 · ?de=<red>: se guarda 30 días, la dirección queda limpia y Finanzas pinta «Tienda web por origen»
await enviar('Page.enable'); await enviar('Runtime.enable');
await enviar('Page.navigate', { url: 'http://localhost:5599/' }); await esperar(3000);
await ev(`localStorage.removeItem('dc_origen')`);
await enviar('Page.navigate', { url: 'http://localhost:5599/?de=TikTok&buscar=netflix' }); await esperar(6000);
ok(await ev('window.DCOrigen()') === 'tiktok', '?de=TikTok → origen «tiktok» guardado');
ok(!/de=/.test(await ev('location.search')), 'la dirección queda sin ?de= (' + (await ev('location.href')) + ')');
await enviar('Page.navigate', { url: 'http://localhost:5599/?de=spam' }); await esperar(5000);
ok(await ev('window.DCOrigen()') === 'tiktok', 'un origen desconocido no pisa el anterior');
await ev(`localStorage.setItem('dc_origen', JSON.stringify({ de: 'youtube', t: Date.now() - 31 * 864e5 }))`);
ok(await ev('window.DCOrigen()') === null, 'a los 30 días el origen vence');
await ev(`localStorage.setItem('dc_origen', '{roto')`);
ok(await ev('window.DCOrigen()') === null, 'dato dañado → sin origen (sin error)');
// Finanzas (función pura de la tabla)
await enviar('Page.navigate', { url: 'http://localhost:5599/admin.html' }); await esperar(5000);
const t = await ev(`window.Finanzas.tablaOrigen([{ origen: 'tiktok', ordenes: 3, pagadas: 2, cobrado: 75000 }, { origen: 'directo', ordenes: 1, pagadas: 0, cobrado: 0 }])`);
ok(/Tienda web por origen/.test(t) && /TikTok<\/td><td>3<\/td><td>2<\/td><td>\$75\.000/.test(t) && /Directo/.test(t), 'Finanzas: tabla con órdenes, pagadas y cobrado por red');
ok(/wo-055/.test(await ev('window.Finanzas.tablaOrigen(null)')), 'sin wo-055 dice qué SQL aplicar');
ok(errs.length === 0, 'sin errores ' + errs.join('|'));
ws.close(); chrome.kill();
