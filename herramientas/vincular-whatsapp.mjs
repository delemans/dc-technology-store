// herramientas/vincular-whatsapp.mjs — Página para volver a vincular el WhatsApp del bot (24/11/2026).
// Cuando Evolution pierde la sesión (state "close"/"connecting"), abre http://localhost:5601 con el QR siempre
// vigente (se renueva solo) y las instrucciones paso a paso. Al quedar conectado lo avisa y se cierra solo.
// Alternativa sin cámara: escribir el número del bot y la página da un código de 8 letras para WhatsApp.
//   node herramientas/vincular-whatsapp.mjs
import http from 'node:http';
import { exec } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { cargarEntorno, requerir } = require('./entorno.js');
const env = cargarEntorno();
requerir(env, ['EVOLUTION_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCIA']);
const EVO = env.EVOLUTION_URL.replace(/\/+$/, '');
const INST = env.EVOLUTION_INSTANCIA;
const PUERTO = 5601;

const evo = async (ruta) => {
    const r = await fetch(`${EVO}${ruta}`, { headers: { apikey: env.EVOLUTION_API_KEY } });
    return r.json().catch(() => ({}));
};

let qr = null;
let qrHora = 0;
let codigo = null;

async function estado() {
    const s = await evo(`/instance/connectionState/${INST}`).catch(() => null);
    const st = s?.instance?.state ?? 'sin-evolution';
    if (st === 'open') return { estado: 'open' };
    // QR nuevo cada 25 s (WhatsApp los vence a los ~40 s)
    if (!qr || Date.now() - qrHora > 25000) {
        const c = await evo(`/instance/connect/${INST}`).catch(() => ({}));
        if (c.base64) { qr = c.base64; qrHora = Date.now(); }
    }
    return { estado: st, qr, codigo };
}

const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Vincular WhatsApp del bot</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#0b3d2e;color:#fff;display:flex;justify-content:center}
.c{max-width:980px;width:100%;padding:24px 16px;display:grid;grid-template-columns:1fr 420px;gap:32px;align-items:start}
h1{margin:0 0 8px;font-size:30px} p{line-height:1.5;font-size:18px} ol{font-size:20px;line-height:1.7;padding-left:24px}
b{color:#ffd54f} .qr{background:#fff;border-radius:16px;padding:16px;text-align:center;color:#222}
.qr img{width:100%;image-rendering:pixelated} .t{font-size:14px;color:#555}
.ok{grid-column:1/-1;background:#1faa59;border-radius:16px;padding:40px;text-align:center;font-size:32px;display:none}
.alt{margin-top:24px;background:#0f513d;border-radius:12px;padding:16px}
input{font-size:18px;padding:8px;border-radius:8px;border:0;width:220px} button{font-size:18px;padding:8px 16px;border-radius:8px;border:0;background:#ffd54f;cursor:pointer}
.cod{font-size:40px;letter-spacing:6px;font-weight:700;color:#ffd54f;margin-top:8px}
@media(max-width:800px){.c{grid-template-columns:1fr}}
</style></head><body><div class="c">
<div id="ins"><h1>Vincular el WhatsApp del bot</h1>
<p>El «código» es el <b>cuadro QR</b> de la derecha. Se escanea con el <b>celular que tiene el número del bot</b> (el de la tienda), no con otro.</p>
<ol>
<li>En ese celular abre <b>WhatsApp</b> (o WhatsApp Business).</li>
<li>Toca los <b>tres puntos ⋮</b> (arriba a la derecha) o <b>Configuración</b> en iPhone.</li>
<li>Entra a <b>Dispositivos vinculados</b>.</li>
<li>Toca <b>Vincular un dispositivo</b> (pide tu huella o PIN).</li>
<li>Se abre la cámara: <b>apúntala al cuadro QR</b> de esta pantalla.</li>
<li>Espera unos segundos: esta página dirá <b>«¡Conectado!»</b>.</li>
</ol>
<p>Si ya aparece un dispositivo viejo llamado «dc-bot» o «Evolution», puedes cerrarlo primero.</p>
<div class="alt"><b>¿No puedes escanear?</b> Escribe el número del bot (con 57) y te doy un código de 8 letras.
En WhatsApp: Dispositivos vinculados → Vincular un dispositivo → <b>«Vincular con el número de teléfono»</b> y lo escribes.<br><br>
<input id="num" placeholder="57300…"> <button onclick="pedir()">Pedir código</button><div class="cod" id="cod"></div></div>
</div>
<div class="qr" id="caja"><img id="img" alt="QR"><div class="t" id="t">Cargando el QR…</div></div>
<div class="ok" id="ok">✅ ¡Conectado! El bot de WhatsApp ya quedó vinculado.<br><span style="font-size:20px">Ya puedes cerrar esta ventana.</span></div>
</div><script>
async function ver(){try{const r=await (await fetch('/estado')).json();
if(r.estado==='open'){document.getElementById('ok').style.display='block';document.getElementById('ins').style.display='none';document.getElementById('caja').style.display='none';return;}
if(r.qr){document.getElementById('img').src=r.qr;document.getElementById('t').textContent='Se renueva solo. Estado: '+r.estado;}
else document.getElementById('t').textContent='Esperando a Evolution… ('+r.estado+')';}catch(e){document.getElementById('t').textContent='Esta ventana perdió conexión con el programa.';}
setTimeout(ver,3000);}
async function pedir(){const n=document.getElementById('num').value.replace(/\\D/g,'');if(n.length<11){alert('Escribe el número con 57, por ejemplo 573001234567');return;}
document.getElementById('cod').textContent='…';const r=await (await fetch('/codigo?n='+n)).json();document.getElementById('cod').textContent=r.codigo||'No se pudo, usa el QR';}
ver();</script></body></html>`;

const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
        if (url.pathname === '/estado') {
            const e = await estado();
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(e));
            if (e.estado === 'open') { console.log('✅ WhatsApp del bot conectado.'); setTimeout(() => process.exit(0), 8000); }
            return;
        }
        if (url.pathname === '/codigo') {
            const n = (url.searchParams.get('n') ?? '').replace(/\D/g, '');
            const c = await evo(`/instance/connect/${INST}?number=${n}`);
            codigo = c.pairingCode ?? null;
            if (c.base64) { qr = c.base64; qrHora = Date.now(); }
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ codigo }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGINA);
    } catch (e) {
        res.writeHead(500).end(String(e.message));
    }
});
servidor.listen(PUERTO, '127.0.0.1', () => {
    console.log(`Abre http://localhost:${PUERTO} y escanea el QR con el celular del bot.`);
    if (!process.argv.includes('--sin-abrir')) exec(`start "" http://localhost:${PUERTO}`);
});
// Se cierra solo a las 3 horas si nadie escanea
setTimeout(() => process.exit(0), 3 * 60 * 60 * 1000);
