// Módulo Soporte → Videos de ayuda: tres videos que cargan, solo dentro de Soporte, sin desborde; portal con enlace y sin «automáticas»
import { spawn } from 'node:child_process';
const BASE = process.argv[2] ?? 'http://localhost:5599';
const PUERTO = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${process.env.TEMP}/pa-${PUERTO}`, 'about:blank'], { stdio: 'ignore' });
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
await enviar('Page.navigate', { url: `${BASE}/` }); await esperar(5000);
ok(await ev(`!document.getElementById('ayuda') || document.getElementById('ayuda').offsetParent === null`), 'en Inicio la ayuda no se ve (es del módulo Soporte)');
await ev(`document.querySelector('.menu-modulos [data-ir-vista="soporte"]').click()`); await esperar(1200);
ok(await ev(`document.getElementById('ayuda').offsetParent !== null && document.querySelectorAll('#ayuda video').length === 3`), 'Soporte muestra «Videos de ayuda» con 3 videos');
const cargan = await ev(`Promise.all([...document.querySelectorAll('#ayuda video')].map(v => new Promise(r => { v.preload = 'metadata'; v.onloadedmetadata = () => r(v.duration > 10); v.onerror = () => r(false); v.load(); setTimeout(() => r(false), 8000); })))`);
ok(cargan.every(Boolean), `los 3 videos cargan (${JSON.stringify(cargan)})`);
ok(await ev(`document.documentElement.scrollWidth <= innerWidth`), 'sin desborde en 390 px');
await enviar('Page.navigate', { url: `${BASE}/portal.html` }); await esperar(3500);
ok(await ev(`!/autom[aá]ticas operativas/i.test(document.body.innerText) && !!document.querySelector('a[href*="#ayuda"]')`), 'portal: sin «entregas automáticas» y con enlace a los videos de ayuda');
ok(errs.length === 0, `sin errores de JS ${errs.join(' | ')}`);
ws.close(); chrome.kill();
