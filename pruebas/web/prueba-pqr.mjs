import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PUERTO = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${process.env.TEMP}/pqr-${PUERTO}`, 'about:blank'], { stdio: 'ignore' });
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
// T07 · Libro de PQR en el panel: sección, semáforo de plazos y tarjetas (sin sesión: funciones de pqr.js)
await enviar('Page.enable'); await enviar('Runtime.enable');
await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await enviar('Page.navigate', { url: 'http://localhost:5599/admin.html' }); await esperar(5000);
ok(await ev(`!!document.getElementById('libro-pqr') && !!document.getElementById('pqr-nueva') && typeof window.Pqr?.cargar === 'function'`), 'la sección «Libro de PQR» y pqr.js están en el panel');
const sem = JSON.parse(await ev(`JSON.stringify((() => { const a = new Date('2026-11-09T15:00:00Z'); const s = (v, e = 'ABIERTA') => window.Pqr.semaforo({ vence_el: v, estado: e }, a).texto; return [s('2026-11-08'), s('2026-11-09'), s('2026-11-11'), s('2026-11-30'), s('2026-11-01', 'CERRADA')]; })())`));
ok(sem[0] === 'Vencida hace 1 día' && sem[1] === 'Vence hoy' && sem[2] === 'Vence en 2 días' && /^Vence el /.test(sem[3]) && sem[4] === 'Cerrada', 'semáforo: vencida, hoy, pronto, a tiempo y cerrada (' + sem.join(' | ') + ')');
const html = await ev(`window.Pqr.tarjeta({ id: 7, tipo: 'datos', canal: 'whatsapp', whatsapp: '573001112233', detalle: '<b>Borrar</b> mis datos', estado: 'ABIERTA', vence_el: '2026-11-23', created_at: '2026-11-09T15:00:00Z' })`);
ok(/#7 · Datos personales/.test(html) && /wa\.me\/573001112233/.test(html) && /Responder y cerrar/.test(html), 'tarjeta: tipo, botón «Escribirle» y responder');
ok(/&lt;b&gt;Borrar/.test(html) && !/<b>Borrar/.test(html), 'el texto del cliente se muestra escapado (sin HTML)');
ok(!/Responder y cerrar/.test(await ev(`window.Pqr.tarjeta({ id: 8, tipo: 'reclamo', canal: 'panel', whatsapp: '573001112233', detalle: 'x', estado: 'CERRADA', respuesta: 'Listo', vence_el: '2026-11-23', created_at: '2026-11-09T15:00:00Z' })`)), 'una cerrada no muestra botones');
const toques = JSON.parse(await ev(`(() => { const f = document.getElementById('pqr-nueva').cloneNode(true); f.id = 'pqr-copia'; document.body.prepend(f); return JSON.stringify([...f.querySelectorAll('input, select, button')].map((e) => Math.round(e.getBoundingClientRect().height))); })()`));
ok(toques.length === 5 && toques.every((h) => h >= 44), 'campos y botón de 44 px o más en celular (' + toques.join(',') + ')');
ok(errs.length === 0, 'sin errores ' + errs.join('|'));
ws.close(); chrome.kill();
