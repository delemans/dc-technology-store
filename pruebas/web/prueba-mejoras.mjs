import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PUERTO = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${process.env.TEMP}/mej-${PUERTO}`, 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let lista; for (let i = 0; i < 50; i++) { try { lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); if (lista.some((t) => t.type === 'page')) break; } catch {} await esperar(200); }
const ws = new WebSocket(lista.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); });
const enviar = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (e) => { const r = await enviar('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'ERROR ' + r.exceptionDetails.exception?.description?.slice(0, 150); return r.result?.value; };
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
await enviar('Page.enable'); await enviar('Runtime.enable');
for (const [ancho, alto, movil, tanda] of [[390, 844, true, 12], [1366, 900, false, 24]]) {
  await enviar('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: movil });
  await enviar('Page.navigate', { url: 'http://localhost:5599/#catalogo' }); await esperar(7000);
  await ev(`localStorage.removeItem('dc_orden')`);
  const n = () => ev(`document.querySelectorAll('#product-grid article').length`);
  ok(await n() === tanda, `${ancho}px: primera tanda de ${tanda} (${await n()})`);
  ok(/Viendo 12|Viendo 24/.test(await ev(`document.getElementById('catalogo-mas').textContent`)), 'texto "Viendo X de Y"');
  await ev(`document.querySelector('.catalogo-mas__boton').click()`); await esperar(500);
  ok(await n() === tanda * 2, `Ver más → ${tanda * 2} (${await n()})`);
  await ev(`(()=>{const s=document.getElementById('orden-catalogo');s.value=s.value==='az'?'menor':'az';s.dispatchEvent(new Event('change'))})()`); await esperar(400);
  ok(await n() === tanda, 'cambiar el orden vuelve a la primera tanda');
  ok(/\d+ productos/.test(await ev(`document.getElementById('product-count').textContent`)), 'el conteo sigue mostrando el total');
  await ev(`(()=>{const i=document.getElementById('searchInput');i.value='zzzqqq';i.dispatchEvent(new Event('input'))})()`); await esperar(600);
  ok(await ev(`document.querySelectorAll('[data-sugerencia]').length`) === 6 && await ev(`document.getElementById('catalogo-mas').hidden`) === true, 'sin resultados → 6 sugerencias y sin "Ver más"');
  await ev(`document.querySelector('[data-sugerencia="Netflix"]').click()`); await esperar(500);
  ok(await ev(`[...document.querySelectorAll('#product-grid article')].some(a=>/Netflix/.test(a.textContent))`) && await ev(`document.getElementById('searchInput').value`) === 'Netflix', 'tocar una sugerencia busca ese producto');
  await ev(`(()=>{const i=document.getElementById('searchInput');i.value='';i.dispatchEvent(new Event('input'))})()`); await esperar(500);
  ok(await ev(`document.querySelector('.volver-arriba').hidden`) === true, 'arriba: sin botón de volver');
  await ev(`document.querySelector('.catalogo-mas__boton')?.click(); scrollTo(0, 3000)`); await esperar(400);
  ok(await ev(`document.querySelector('.volver-arriba').hidden`) === false && /scaleX\(0\.\d+/.test(await ev(`document.querySelector('.barra-lectura').style.transform`)), 'al bajar: botón volver arriba y barra de lectura');
  if (!movil) {
    await ev(`document.activeElement.blur()`);
    await enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', text: '/', code: 'Slash' }); await enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash' }); await esperar(200);
    ok(await ev(`document.activeElement.id`) === 'searchInput', 'tecla "/" enfoca el buscador');
    ok(await ev(`getComputedStyle(document.getElementById('product-grid')).gridTemplateColumns.split(' ').length`) === 4, '4 columnas en PC');
  }
  await ev(`scrollTo(0,0)`); await esperar(300);
  const alto2 = await ev(`document.documentElement.scrollHeight`);
  console.log(`      alto de la página: ${alto2} px`);
  ok(await ev(`document.documentElement.scrollWidth`) <= ancho, 'sin desborde horizontal');
  await ev(`document.getElementById('catalogo-mas').scrollIntoView({block:'center'})`); await esperar(900);
  const c = await enviar('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`mejoras-${ancho}.png`, Buffer.from(c.data, 'base64'));
}
ok(errs.length === 0, `sin errores de JavaScript ${errs.join(' | ')}`);
ws.close(); chrome.kill();
