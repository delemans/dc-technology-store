// herramientas/ia.mjs con IA simuladas: cascada ante saldo agotado, timeout, 429 y caída; pausas; registro; JSON; .env
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const m = await import(new URL('../../herramientas/ia.mjs', import.meta.url).href);
const { armarProveedores } = await import(new URL('../../herramientas/proveedores-ia.mjs', import.meta.url).href);
const ok = (c, msg) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${msg}`); if (!c) process.exitCode = 1; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-ia-'));
let n = 0;
const rutas = () => ({ estado: path.join(dir, `e${++n}.json`), uso: path.join(dir, `u${n}.jsonl`) });
const resp = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status });
const bien = (texto = 'listo') => resp({ choices: [{ message: { content: texto } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
const A = { nombre: 'A', url: 'https://a/v1', modelo: 'ma', clave: 'ka', peso: 1000 };
const B = { nombre: 'B', url: 'https://b/v1', modelo: 'mb', clave: 'kb', peso: 500 };
const C = { nombre: 'C', url: 'https://c/v1', modelo: 'mc', clave: 'kc', peso: 100 };
const lineas = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

// Sin saldo (402) → pasa a la siguiente, la deja en pausa 6 h y registra ambos intentos
{
    const r0 = rutas(); const t = 1_800_000_000_000;
    const f = async (url) => (url.startsWith('https://a') ? resp({ error: { message: 'Insufficient balance' } }, 402) : bien());
    const r = await m.pedirIA('hola', { tarea: 'prueba' }, { lista: [A, B], f, ahora: () => t, ...r0 });
    ok(r.ia === 'B' && r.intentos === 2 && r.texto === 'listo', 'sin saldo en A → responde B en el segundo intento');
    const est = JSON.parse(fs.readFileSync(r0.estado, 'utf8'));
    ok(est.p.A.hasta === t + 6 * 3600e3, 'A queda en pausa 6 h');
    const u = lineas(r0.uso);
    ok(u.length === 2 && !u[0].ok && u[0].codigo === 402 && u[1].ok && u[1].ia === 'B' && u[1].tarea === 'prueba' && u[1].entrada === 10, 'registro: falla de A y acierto de B con tarea y tokens');
    ok(!fs.readFileSync(r0.uso, 'utf8').includes('kb') && !fs.readFileSync(r0.estado, 'utf8').includes('ka'), 'registro y estado sin claves');
    // Siguiente consulta: A sigue en pausa → va directo a B
    const llam = []; const f2 = async (url) => { llam.push(url); return bien(); };
    await m.pedirIA('otra', {}, { lista: [A, B], f: f2, ahora: () => t + 1000, ...r0 });
    ok(llam.length === 1 && llam[0].startsWith('https://b'), 'IA en pausa no se intenta primero');
}
// Timeout, 429 y caída 500 → cascada hasta C; pausas de 5 min, 2 min y 1 min
{
    const r0 = rutas(); const t = 1_800_000_000_000;
    const f = async (url) => {
        if (url.startsWith('https://a')) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
        if (url.startsWith('https://b')) return resp({ error: { message: 'Rate limit' } }, 429);
        return bien('desde C');
    };
    const r = await m.pedirIA('x', {}, { lista: [A, B, C], f, ahora: () => t, ...r0 });
    const est = JSON.parse(fs.readFileSync(r0.estado, 'utf8'));
    ok(r.ia === 'C' && r.texto === 'desde C', 'timeout en A y 429 en B → responde C');
    ok(est.p.A.hasta === t + 5 * 60e3 && est.p.B.hasta === t + 2 * 60e3, 'pausas: timeout 5 min, 429 2 min');
    ok(m.clasificar(500, 'Internal').pausa === 60e3 && m.clasificar(0, 'ECONNREFUSED').pausa === 60e3 && m.clasificar(401, 'bad key').sinSaldo, 'clasificar: caída 1 min, clave mala = sin saldo');
}
// Todas sin saldo → error fatal con el detalle de cada una
{
    const f = async () => resp({ error: { message: 'quota exceeded' } }, 402);
    let e = null; try { await m.pedirIA('x', {}, { lista: [A, B], f, ...rutas() }); } catch (x) { e = x; }
    ok(e?.fatal === true && e.fallas.length === 2 && /A: 402/.test(e.message), 'todas sin saldo → error fatal con el motivo de cada una');
    const f2 = async (url) => (url.startsWith('https://a') ? resp({}, 402) : resp({}, 503));
    let e2 = null; try { await m.pedirIA('x', {}, { lista: [A, B], f: f2, ...rutas() }); } catch (x) { e2 = x; }
    ok(e2 && e2.fatal === false, 'si alguna solo está caída, el error no es fatal (se puede reintentar)');
    let e3 = null; try { await m.pedirIA('x', {}, { lista: [], ...rutas() }); } catch (x) { e3 = x; }
    ok(e3?.fatal && /ninguna IA configurada/i.test(e3.message), 'sin IA configuradas → mensaje claro');
}
// JSON: si una IA no acepta response_format, repite sin él en la misma IA
{
    const cuerpos = [];
    const f = async (url, o) => { const b = JSON.parse(o.body); cuerpos.push(b);
        return b.response_format ? resp({ error: { message: 'response_format is not supported' } }, 400) : bien('{"a":1}'); };
    const r = await m.pedirIA('x', { json: true, sistema: 'S' }, { lista: [A], f, ...rutas() });
    ok(r.ia === 'A' && cuerpos.length === 2 && !cuerpos[1].response_format && cuerpos[0].messages[0].role === 'system', 'JSON: reintenta sin response_format en la misma IA');
}
// Reparto por peso: con el mismo uso va primero la de más peso; con A muy usada, B
{
    const r0 = rutas(); const t = 1_800_000_000_000; const hoy = new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    fs.writeFileSync(r0.estado, JSON.stringify({ dia: hoy, p: { A: { usos: 900, hasta: 0 }, B: { usos: 10, hasta: 0 } } }));
    const llam = []; const f = async (url) => { llam.push(url); return bien(); };
    await m.pedirIA('x', {}, { lista: [A, B], f, ahora: () => t, ...r0 });
    ok(llam[0].startsWith('https://b'), 'reparto: A con 900/1000 de uso cede a B con 10/500');
}
// Proveedores nuevos: OpenAI (también con OPENAI_API_KEY) y modelo local sin clave
{
    const l = armarProveedores({ OPENAI_API_KEY: 'sk-x', IA_LOCAL_URL: 'http://localhost:11434/v1/', IA_LOCAL_MODELO: 'qwen2.5:7b' });
    const o = l.find((p) => p.nombre === 'OpenAI'), loc = l.find((p) => p.nombre === 'IA local');
    ok(o?.url === 'https://api.openai.com/v1' && o.clave === 'sk-x', 'OpenAI se activa con OPENAI_API_KEY');
    ok(loc?.url === 'http://localhost:11434/v1' && loc.modelo === 'qwen2.5:7b' && loc.clave === 'local', 'IA local: URL sin barra final, modelo de .env, sin clave');
    ok(!armarProveedores({}).some((p) => p.nombre === 'IA local'), 'IA local apagada si no hay IA_LOCAL_URL');
    ok(!armarProveedores({ IA_OPENAI_KEY: 'k', IA_OPENAI_APAGADA: 'si' }).some((p) => p.nombre === 'OpenAI'), 'IA_<ID>_APAGADA la apaga');
}
// Revisión del .env: encuentra los problemas sin mostrar valores y el arreglo no borra nada
{
    const secreto = 'sk-SECRETO-123';
    const env = `﻿# comentario\nexport IA_GROQ_KEY=${secreto}\nIA_MISTRAL_KEY = abc \nIA_MISTRAL_KEY=def\nSILICONFLOW_BASE_URL=https://api.siliconflow.cn/v1\nIA_LOCAL_URL=localhost:11434/v1/chat/completions\nIA_GROK_KEY=x\nIA_NVIDIA_KEY="abc\nlinea rota\n`;
    const r = m.revisarEnv(env);
    const todo = r.problemas.join('\n');
    ok(/BOM/.test(todo) && /export/.test(todo) && /espacios/.test(todo) && /repetida/.test(todo) && /\.cn/.test(todo) && /URL debe/.test(todo) && /IA_GROK_KEY/.test(todo) && /comillas/.test(todo) && /NOMBRE=valor/.test(todo), '.env: detecta BOM, export, espacios, repetidas, .cn, URL, nombre mal escrito, comillas y línea rota');
    ok(!todo.includes(secreto) && !todo.includes('def'), '.env: los avisos no muestran ningún valor');
    ok(r.cambia && r.arreglado.includes(`IA_GROQ_KEY=${secreto}`) && r.arreglado.includes('# (repetida; se usa la de abajo) IA_MISTRAL_KEY=abc') && r.arreglado.includes('IA_MISTRAL_KEY=def') && !r.arreglado.startsWith('﻿') && r.arreglado.includes('linea rota'), '.env arreglado: quita export/espacios/BOM, comenta la repetida y no borra nada');
    ok(!m.revisarEnv('A=1\nB=2\n').problemas.length && !m.revisarEnv('A=1\nB=2\n').cambia, '.env correcto: sin avisos ni cambios');
}
// Consumo y bot
{
    const t = Date.parse('2026-10-26T12:00:00Z');
    const u = m.resumirUso([{ at: '2026-10-26T11:00:00Z', ia: 'A', tarea: 'x', ok: true, ms: 100, entrada: 5, salida: 1 },
        { at: '2026-10-26T11:01:00Z', ia: 'B', tarea: 'x', ok: false, ms: 50, codigo: 402, motivo: 'saldo' },
        { at: '2026-10-10T11:00:00Z', ia: 'A', tarea: 'x', ok: true, ms: 1 }], t - 7 * 864e5);
    ok(u.por.A.ok === 1 && u.por.B.fallas === 1 && /402/.test(u.por.B.ultimaFalla) && u.tareas.x.A === 1, 'consumo: cuenta por IA y por tarea dentro del rango');
    const flujo = fs.readFileSync(new URL('../../n8n/flujo_bot_dctechnology.json', import.meta.url), 'utf8');
    ok(flujo.includes('iaHistorial'), 'el bot guarda su consumo diario por IA (iaHistorial)');
}
fs.rmSync(dir, { recursive: true, force: true });
