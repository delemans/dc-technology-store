// Los enlaces dentro de un texto (en línea) quedan exentos del mínimo de 44 px, como dice WCAG 2.5.8.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const PUERTO = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${process.env.TEMP}/acc-${PUERTO}`, 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let lista; for (let i = 0; i < 50; i++) { try { lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); if (lista.some((t) => t.type === 'page')) break; } catch {} await esperar(200); }
const ws = new WebSocket(lista.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); const errs = [];
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); } else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 200)); });
const enviar = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (e) => { const r = await enviar('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) return 'ERROR ' + r.exceptionDetails.exception?.description?.slice(0, 150); return r.result?.value; };
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
// T09 · Accesibilidad en celular (390 px), modo claro y oscuro: áreas táctiles de 44 px, contraste AA y foco visible
await enviar('Page.enable'); await enviar('Runtime.enable');
await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const auditar = () => ev(`(${String.raw`() => {
  const vis = (e) => { const s = getComputedStyle(e); const b = e.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && b.width > 0 && b.height > 0 && !e.closest('[hidden],[aria-hidden=true]'); };
  const nombre = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase()) + '.' + String(e.className?.baseVal ?? e.className).split(' ').slice(0, 2).join('.') + ' «' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30) + '»';
  const peque = [...document.querySelectorAll('a,button,input,select,textarea,[role=button],[tabindex]:not([tabindex="-1"])')].filter(vis).filter((e) => { const b = e.getBoundingClientRect(); return (b.height < 44 || b.width < 44) && !(e.tagName === 'A' && (e.parentElement?.tagName === 'P' || getComputedStyle(e).display === 'inline')); }).map((e) => { const b = e.getBoundingClientRect(); return nombre(e) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height); });
  const rgb = (c) => { const m = c.match(/[\d.]+/g); return m ? m.map(Number) : null; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fondo = (e) => { for (let x = e; x; x = x.parentElement) { const s = getComputedStyle(x); const c = rgb(s.backgroundColor); if (s.backgroundImage !== 'none' && !c?.[3]) return null; if (c && (c.length < 4 || c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const malos = [];
  for (const e of document.querySelectorAll('body *')) {
    if (!vis(e) || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const s = getComputedStyle(e); const c = rgb(s.color); const f = fondo(e); if (!c || !f || (c[3] !== undefined && c[3] < 0.3)) continue;
    const a = c[3] ?? 1; const mezcla = [0, 1, 2].map((i) => c[i] * a + f[i] * (1 - a));
    const L1 = lum(mezcla), L2 = lum(f); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const grande = parseFloat(s.fontSize) >= 24 || (parseFloat(s.fontSize) >= 18.66 && Number(s.fontWeight) >= 700);
    if (ratio < (grande ? 3 : 4.5)) malos.push(nombre(e) + ' ' + ratio.toFixed(2) + ' ' + s.color + ' sobre rgb(' + f.join(',') + ')');
  }
  return JSON.stringify({ peque: [...new Set(peque)].slice(0, 40), contraste: [...new Set(malos)].slice(0, 40), nPeque: peque.length, nContraste: malos.length });
}`})()`);
for (const [pagina, url] of [['tienda', 'http://localhost:5599/'], ['panel', 'http://localhost:5599/admin.html']]) {
    for (const tema of ['light', 'dark']) {
        await enviar('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: tema }] });
        await enviar('Page.navigate', { url }); await esperar(7000);
        const r = JSON.parse(await auditar());
        const t = tema === 'light' ? 'claro' : 'oscuro';
        ok(r.nPeque === 0, `${pagina} (${t}): todo lo que se toca mide 44 px o más${r.nPeque ? ' · ' + r.peque.slice(0, 4).join(' | ') : ''}`);
        ok(r.nContraste === 0, `${pagina} (${t}): contraste AA en todos los textos${r.nContraste ? ' · ' + r.contraste.slice(0, 4).join(' | ') : ''}`);
    }
}
// Foco visible con el teclado (Tab) en la tienda
await enviar('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await enviar('Page.navigate', { url: 'http://localhost:5599/' }); await esperar(6000);
for (let i = 0; i < 3; i++) { await enviar('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await enviar('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); }
const foco = JSON.parse(await ev(`JSON.stringify((() => { const e = document.activeElement; const s = getComputedStyle(e); return { tag: e.tagName, estilo: s.outlineStyle, ancho: parseFloat(s.outlineWidth), sombra: s.boxShadow }; })())`));
ok(foco.tag !== 'BODY' && ((foco.estilo !== 'none' && foco.ancho >= 2) || foco.sombra !== 'none'), 'el foco del teclado se ve (' + JSON.stringify(foco) + ')');
ok(errs.length === 0, 'sin errores ' + errs.join('|'));
ws.close(); chrome.kill();
