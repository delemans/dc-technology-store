// admin-clave.js: «¿Olvidaste tu contraseña?», validación de la nueva y botón en Ajustes (Supabase interceptado: no sale ningún correo)
import { spawn } from 'node:child_process';
const PUERTO = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${process.env.TEMP}/cl-${PUERTO}`, 'about:blank'], { stdio: 'ignore' });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let lista; for (let i = 0; i < 50; i++) { try { lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json(); if (lista.some((t) => t.type === 'page')) break; } catch {} await esperar(200); }
const ws = new WebSocket(lista.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pend = new Map(); const errs = []; const recover = [];
const enviar = (method, params = {}) => new Promise((r) => { const n = ++id; pend.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result ?? m.error); pend.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description?.slice(0, 200));
    if (m.method === 'Fetch.requestPaused') {
        const u = m.params.request.url;
        if (/\/auth\/v1\/recover/.test(u)) {
            const cors = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' }];
            if (m.params.request.method === 'OPTIONS') enviar('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 204, responseHeaders: cors });
            else { recover.push({ url: u, body: m.params.request.postData }); enviar('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200, responseHeaders: [...cors, { name: 'Content-Type', value: 'application/json' }], body: Buffer.from('{}').toString('base64') }); }
        }
        else enviar('Fetch.continueRequest', { requestId: m.params.requestId });
    }
});
const ev = async (e) => { const r = await enviar('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.exceptionDetails ? 'ERROR ' + r.exceptionDetails.exception?.description : r.result?.value; };
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
await enviar('Page.enable'); await enviar('Runtime.enable');
await enviar('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co/auth/*' }] });
await enviar('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await enviar('Page.navigate', { url: 'http://localhost:5599/admin.html' }); await esperar(4000);
ok(await ev(`!!document.getElementById('clave-olvido')`), 'el ingreso muestra «¿Olvidaste tu contraseña?»');
await ev(`document.getElementById('login-email').value=''; document.getElementById('clave-olvido').click()`); await esperar(400);
ok(/Escribe primero tu correo/.test(await ev(`document.getElementById('clave-olvido-aviso').textContent`)) && recover.length === 0, 'sin correo: pide escribirlo y no llama a Supabase');
await ev(`document.getElementById('login-email').value='admin@ejemplo.com'; document.getElementById('clave-olvido').click()`); await esperar(1500);
ok(recover.length >= 1 && /admin@ejemplo\.com/.test(recover[0].body) && /redirect_to=http%3A%2F%2Flocalhost%3A5599%2Fadmin\.html/.test(recover[0].url), `pide el enlace a Supabase con regreso al panel (${recover[0]?.url.slice(-60)})`);
ok(/te llegó un enlace/.test(await ev(`document.getElementById('clave-olvido-aviso').textContent`)), 'mensaje neutro (no revela si el correo es administrador)');
ok(await ev(`!!document.getElementById('ajuste-cambiar-clave')`), 'Ajustes tiene «Cambiar contraseña del panel»');
await ev(`window.DCClave.abrir()`); await esperar(300);
const capa = await ev(`(()=>{const v=document.getElementById('clave-ventana');const st=getComputedStyle(v);const i=document.getElementById('clave-1');const r=i.getBoundingClientRect();const arriba=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {pos:st.position,z:st.zIndex,encima:arriba===i,foco:document.activeElement===i}})()`);
ok(capa.pos === 'fixed' && capa.encima && capa.foco, `la ventana queda encima de todo y el campo recibe el cursor (${JSON.stringify(capa)})`);
await enviar('Input.insertText', { text: 'ClaveDePrueba-123' }); await esperar(100);
ok(await ev(`document.getElementById('clave-1').value`) === 'ClaveDePrueba-123', 'se puede escribir la contraseña nueva con el teclado');
await ev(`document.getElementById('clave-1').value=''`);
await ev(`document.getElementById('clave-1').value='corta'; document.getElementById('clave-2').value='corta'; document.getElementById('clave-form').requestSubmit()`); await esperar(300);
ok(/al menos 10/.test(await ev(`document.getElementById('clave-aviso').textContent`)), 'rechaza contraseñas de menos de 10 caracteres');
await ev(`document.getElementById('clave-1').value='unaClaveLarga2026'; document.getElementById('clave-2').value='otraClaveLarga2026'; document.getElementById('clave-form').requestSubmit()`); await esperar(300);
ok(/no coinciden/.test(await ev(`document.getElementById('clave-aviso').textContent`)), 'avisa si no coinciden');
await ev(`document.getElementById('clave-2').value='unaClaveLarga2026'; document.getElementById('clave-form').requestSubmit()`); await esperar(1500);
ok(/venció|No se pudo/.test(await ev(`document.getElementById('clave-aviso').textContent`)), `sin sesión no cambia nada y lo explica («${await ev(`document.getElementById('clave-aviso').textContent`)}»)`);
ok(await ev(`document.documentElement.scrollWidth <= innerWidth`), 'sin desborde en 390 px');
ok(errs.length === 0, `sin errores de JS ${errs.join(' | ')}`);
ws.close(); chrome.kill();
