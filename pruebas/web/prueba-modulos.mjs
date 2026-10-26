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
const visible = (sel) => `(()=>{const e=document.querySelector('${sel}');return !!e && getComputedStyle(e).display!=='none' && e.getClientRects().length>0})()`;
for (const [ancho, alto, movil] of [[390, 844, true], [1366, 900, false]]) {
  await enviar('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: 1, mobile: movil });
  await enviar('Page.navigate', { url: 'http://localhost:5599/' }); await esperar(6500);
  ok(await ev(visible('#hero')) && !(await ev(visible('#catalogo'))) && !(await ev(visible('#cuenta'))), `${ancho}px: al abrir se ve solo Inicio`);
  ok(await ev(visible(movil ? '.menu-modulos' : '.modulos-nav')) && !(await ev(visible(movil ? '.modulos-nav' : '.menu-modulos'))), movil ? 'menú inferior con íconos (celular)' : 'pestañas de módulos (PC)');
  const nav = movil ? '.menu-modulos' : '.modulos-nav';
  await ev(`scrollTo(0,600)`); await esperar(200);
  await ev(`document.querySelector('${nav} [data-ir-vista="catalogo"]').click()`); await esperar(800);
  ok(await ev(visible('#catalogo')) && !(await ev(visible('#hero'))) && await ev(`scrollY`) === 0 && await ev(`document.querySelector('${nav} [data-ir-vista="catalogo"]').classList.contains('activo')`) && await ev('location.href') === 'http://localhost:5599/', 'Catálogo: solo el catálogo, arriba, pestaña activa y dirección limpia');
  ok(await ev(`document.querySelectorAll('#product-grid article').length`) > 0, 'el catálogo tiene productos');
  await ev(`document.querySelector('${nav} [data-ir-vista="servicios"]').click()`); await esperar(600);
  ok(await ev(visible('#servicios-destacados')) && await ev(visible('#desarrollos')) && !(await ev(visible('#catalogo'))), 'Servicios: servicios y desarrollos');
  await ev(`document.querySelector('${nav} [data-ir-vista="cuenta"]').click()`); await esperar(1200);
  ok(await ev(visible('#cuenta')) && !(await ev(visible('#servicios'))) && await ev(`document.getElementById('cuenta').innerText.length`) > 50, 'Pedidos: Mis pedidos pintado');
  await ev(`document.querySelector('${nav} [data-ir-vista="soporte"]').click()`); await esperar(1200);
  ok(await ev(visible('#soporte')) && await ev(`document.getElementById('soporte-contenido')?.innerText.length ?? 0`) > 20, 'Soporte: pintado');
  await ev(`history.back()`); await esperar(800);
  ok(await ev(visible('#cuenta')), 'Atrás del navegador vuelve al módulo anterior');
  await ev(`document.querySelector('${nav} [data-ir-vista="inicio"]').click()`); await esperar(600);
  await ev(`document.querySelector('#hero a[href="#catalogo"]')?.click()`); await esperar(800);
  ok(await ev(visible('#catalogo')), 'botón "Ver catálogo" de la portada abre el Catálogo');
  await ev(`document.querySelector('${nav} [data-ir-vista="inicio"]').click()`); await esperar(600);
  await ev(`(()=>{const a=[...document.querySelectorAll('#novedades a, #novedades button')].find(x=>/Ver los/.test(x.textContent)); a?.click(); return !!a})()`); await esperar(1000);
  ok(await ev(visible('#catalogo')), '"Ver los 180" (desde el código) abre el Catálogo');
  await enviar('Page.navigate', { url: 'http://localhost:5599/#desarrollos' }); await esperar(6000);
  ok(await ev(visible('#desarrollos')) && !(await ev(visible('#hero'))) && await ev(`Math.abs(document.getElementById('desarrollos').getBoundingClientRect().top) < 260`), 'enlace directo #desarrollos → módulo Servicios en esa sección');
  await enviar('Page.navigate', { url: 'http://localhost:5599/?pedido=DC-ABCDEF' }); await esperar(6000);
  ok(await ev(visible('#cuenta')) && !(await ev(visible('#hero'))), '?pedido= (avisos de WhatsApp) → Mis pedidos');
  if (movil) {
    await ev(`document.querySelector('.menu-modulos .central').click()`); await esperar(900);
    ok(await ev(`!document.getElementById('hoja').hidden`), 'carrito central abre el carrito');
    await ev(`document.querySelector('[data-cerrar-hoja]')?.click()`); await esperar(500);
    const solapa = await ev(`(()=>{const m=document.querySelector('.menu-modulos').getBoundingClientRect();const c=document.getElementById('copiloto').getBoundingClientRect();return c.bottom<=m.top+1})()`);
    ok(solapa, 'el bot queda encima del menú, sin taparlo');
  }
  ok(await ev(`document.documentElement.scrollWidth`) <= ancho, 'sin desborde horizontal');
  await enviar('Page.navigate', { url: 'http://localhost:5599/' }); await esperar(6000);
  const c = await enviar('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`modulos-${ancho}.png`, Buffer.from(c.data, 'base64'));
  await ev(`document.querySelector('${nav} [data-ir-vista="catalogo"]').click()`); await esperar(1500);
  const c2 = await enviar('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`modulos-${ancho}-cat.png`, Buffer.from(c2.data, 'base64'));
}
ok(errs.length === 0, `sin errores de JavaScript ${errs.join(' | ')}`);
ws.close(); chrome.kill();
