// IA balanceada: jsCode REAL de los nodos con 4 IA falsas (servidor local) → reparto, saltos, pausas y memoria
const http = require('http');
const flujo = require(process.argv[2]);
const { conClaves } = { conClaves: (c, l) => c.split('[] /*__CLAVES_IA__*/').join(`${JSON.stringify(l)} /*__CLAVES_IA__*/`) };
const nodo = (n) => flujo.nodes.find((x) => x.name === n);
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const AsyncF = Object.getPrototypeOf(async () => {}).constructor;

// Comportamiento de cada IA falsa: 'ok' | 402 | 429 | 500 | 'vacia'
const modo = { A: 'ok', B: 'ok', C: 'ok', D: 'ok' };
const llamadas = [];
const servidor = http.createServer((req, res) => {
    let cuerpo = ''; req.on('data', (d) => (cuerpo += d)).on('end', () => {
        const ia = req.url.split('/')[1]; const j = JSON.parse(cuerpo || '{}');
        llamadas.push({ ia, mensajes: j.messages, auth: req.headers.authorization });
        const m = modo[ia];
        const enviar = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        if (m === 'ok') return enviar(200, { choices: [{ message: { content: `respuesta de ${ia}` } }] });
        if (m === 'vacia') return enviar(200, { choices: [{ message: { content: '' } }] });
        if (m === 402) return enviar(402, { error: { message: 'Insufficient balance' } });
        if (m === 429) return enviar(429, { error: { message: 'Rate limit reached for requests per minute' } });
        return enviar(500, { error: { message: 'internal' } });
    });
});
servidor.listen(0, async () => {
    const base = `http://127.0.0.1:${servidor.address().port}`;
    const ias = [{ nombre: 'A', peso: 1000 }, { nombre: 'B', peso: 1000 }, { nombre: 'C', peso: 500 }, { nombre: 'D', peso: 50 }]
        .map((p) => ({ ...p, url: `${base}/${p.nombre}`, modelo: 'm', clave: `clave-${p.nombre}` }));
    const memoria = {};
    const helpers = { httpRequest: async (o) => { const r = await fetch(o.url, { method: o.method, headers: o.headers, body: JSON.stringify(o.body), signal: o.timeout ? AbortSignal.timeout(o.timeout) : undefined }); return { statusCode: r.status, body: await r.json() }; } };
    const correr = (nombre, entrada, numero = '573001112233', lista = ias) => new AsyncF('$', '$input', '$getWorkflowStaticData', conClaves(nodo(nombre).parameters.jsCode, lista))
        .call({ helpers }, (n) => ({ first: () => ({ json: n === 'Normalizar mensaje' ? { numero } : n === 'Config bot' ? {} : {} }) }), { first: () => ({ json: entrada }) }, () => memoria);
    const chat = (texto, numero) => correr('IA balanceada', { sistema: 'Eres el bot', texto }, numero);

    // 1) Reparto proporcional al peso (A 1000, B 1000, C 500, D 50): 50 consultas
    for (let i = 0; i < 50; i++) await chat(`hola ${i}`, `5730000000${String(i).padStart(2, '0')}`);
    const cuenta = (ia) => llamadas.filter((l) => l.ia === ia).length;
    console.log(`   reparto en 50 consultas: A=${cuenta('A')} B=${cuenta('B')} C=${cuenta('C')} D=${cuenta('D')}`);
    ok(cuenta('A') >= 18 && cuenta('B') >= 18 && cuenta('C') >= 8 && cuenta('C') <= 12 && cuenta('D') <= 2, 'reparte según el peso: ninguna se gasta sola antes que las demás');
    ok(llamadas.every((l) => l.auth === `Bearer clave-${l.ia}`), 'cada IA recibe su propia clave');

    // 2) Sin saldo (402) → salta a la siguiente en el mismo mensaje y la pausa 6 h
    llamadas.length = 0; modo.A = 402; modo.B = 402;
    let r = (await chat('precio netflix', '573111111111'))[0].json;
    ok(r.output && /respuesta de [CD]/.test(r.output), `A y B sin saldo → responde ${r.ia} en el mismo mensaje`);
    ok(memoria.iaEstado.p.A.sinSaldo && memoria.iaEstado.p.A.hasta - Date.now() > 5 * 3600e3, 'la IA sin saldo queda en pausa 6 h (marcada sin saldo)');
    llamadas.length = 0; await chat('otra', '573111111112');
    ok(!llamadas.some((l) => l.ia === 'A' || l.ia === 'B'), 'en la pausa ya no se le pregunta (no gasta tiempo)');

    // 3) Límite por minuto (429) → pausa corta; caída (500) → 1 min; respuesta vacía → siguiente
    modo.C = 429; llamadas.length = 0;
    r = (await chat('hola', '573111111113'))[0].json;
    ok(r.ia === 'D' && memoria.iaEstado.p.C.hasta - Date.now() <= 2 * 60e3 && !memoria.iaEstado.p.C.sinSaldo, '429 → pausa de 2 min (no se marca sin saldo) y responde la siguiente');
    // 4) Todas fallan → error con la causa de cada una (Revisar respuesta te avisa)
    modo.D = 500;
    r = (await chat('hola', '573111111114'))[0].json;
    ok(!r.output && /A: 402 Insufficient balance/.test(r.error?.message) && /D: 500/.test(r.error.message), `todas fallan → error con la causa de cada una («${r.error?.message.slice(0, 90)}…»)`);
    // 5) Vuelve una (recargaron A): aunque esté en pausa, si todas fallan se reintenta y A responde
    modo.A = 'ok';
    r = (await chat('hola', '573111111115'))[0].json;
    ok(r.ia === 'A' && memoria.iaEstado.p.A.sinSaldo === false, 'recargaron A → vuelve a responder y deja de estar marcada sin saldo');

    // 6) Memoria de la conversación por cliente (últimas 8 idas y vueltas, sin mezclar clientes)
    Object.assign(modo, { A: 'ok', B: 'ok', C: 'ok', D: 'ok' }); memoria.iaEstado = undefined; llamadas.length = 0;
    await chat('quiero netflix', '573222222222');
    await chat('y cuánto vale?', '573222222222');
    const ultima = llamadas[llamadas.length - 1].mensajes;
    ok(ultima[0].role === 'system' && ultima.some((m) => m.content === 'quiero netflix') && ultima[ultima.length - 1].content === 'y cuánto vale?', 'recuerda lo que el cliente dijo antes');
    await chat('hola', '573333333333');
    ok(!llamadas[llamadas.length - 1].mensajes.some((m) => m.content === 'quiero netflix'), 'no mezcla la conversación de otro cliente');
    for (let i = 0; i < 12; i++) await chat(`m${i}`, '573222222222');
    ok(memoria.chatsIa['573222222222'].m.length === 8, 'guarda solo las últimas 4 idas y vueltas');

    // 7) Extracción de accesos: misma cadena; si ninguna responde, error (va a la salida de error → revisión)
    modo.A = 402;
    const ex = (await correr('Extraer accesos (IA)', { prompt: 'Extrae: usuario x clave y' }))[0].json;
    ok(/respuesta de [BCD]/.test(ex.text), `extracción de accesos con la cadena (respondió ${ex.ia}, salida "text" como antes)`);
    Object.assign(modo, { A: 402, B: 402, C: 500, D: 429 });
    let lanzo = null; try { await correr('Extraer accesos combo (IA)', { prompt: 'x' }); } catch (e) { lanzo = e.message; }
    ok(lanzo && /A: 402/.test(lanzo), 'ninguna IA → la extracción falla y el pedido va a revisión (no se inventan accesos)');
    // 8) Sin claves configuradas → error claro
    r = (await correr('IA balanceada', { sistema: 's', texto: 't' }, '573444444444', []))[0].json;
    ok(/No hay ninguna IA configurada/.test(r.error?.message), 'sin claves → error claro con qué hacer');
    // 9) Límite de tamaño: una IA con límite menor que la consulta ni se intenta (Groq gratis en el chat)
    Object.assign(modo, { A: 'ok', B: 'ok', C: 'ok', D: 'ok' }); memoria.iaEstado = undefined; llamadas.length = 0;
    const conLimite = ias.map((p) => (p.nombre === 'A' || p.nombre === 'B' ? { ...p, limite: 2000 } : p));
    await correr('IA balanceada', { sistema: 'x'.repeat(20000), texto: 'hola' }, '573555555555', conLimite);
    ok(llamadas.length && llamadas.every((l) => l.ia !== 'A' && l.ia !== 'B'), 'consulta grande → no se intenta en las IA con límite menor (no pierde tiempo)');
    llamadas.length = 0;
    const ex2 = (await correr('Extraer accesos (IA)', { prompt: 'corto' }, '573555555556', conLimite))[0].json;
    ok(['A', 'B', 'C', 'D'].includes(ex2.ia), 'consulta corta → sí puede usar esas IA');
    // 10) Tope total: si una IA se queda colgada, no se espera más de lo permitido
    modo.C = 'lenta'; modo.A = 402; modo.B = 402; modo.D = 'lenta'; memoria.iaEstado = undefined;
    servidor.removeAllListeners('request');
    servidor.on('request', (req, res) => { let b = ''; req.on('data', (d) => (b += d)).on('end', () => { const ia = req.url.split('/')[1]; if (modo[ia] === 'lenta') return; res.writeHead(402, { 'Content-Type': 'application/json' }); res.end('{"error":{"message":"Insufficient balance"}}'); }); });
    const t0 = Date.now();
    const lento = (await new AsyncF('$', '$input', '$getWorkflowStaticData', conClaves(nodo('IA balanceada').parameters.jsCode.replace('presupuestoMs: 40000', 'presupuestoMs: 9000').replace('timeoutMs: 20000', 'timeoutMs: 2000'), ias))
        .call({ helpers }, () => ({ first: () => ({ json: { numero: '573666666666' } }) }), { first: () => ({ json: { sistema: 's', texto: 't' } }) }, () => memoria))[0].json;
    ok(lento.error && Date.now() - t0 < 10000 && Date.now() - t0 > 1500, `IA colgada → se rinde a tiempo (${Date.now() - t0} ms) y el cliente recibe el aviso de espera`);
    ok(memoria.iaEstado.p.C?.hasta - Date.now() > 4 * 60e3 || memoria.iaEstado.p.D?.hasta - Date.now() > 4 * 60e3, 'la IA que no respondió a tiempo queda en pausa 5 min');
    servidor.closeAllConnections?.(); servidor.close(); setTimeout(() => process.exit(), 200);
});
