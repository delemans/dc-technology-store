// herramientas/puente-ia.mjs — Puente local compatible con OpenAI: cualquier herramienta (Continue, Cline, Aider, scripts)
// apunta a http://127.0.0.1:4141/v1 con el modelo «dc-cascada» y por dentro se usa la cascada de herramientas/ia.mjs
// (Groq, SiliconFlow, NVIDIA, Gemini, OpenRouter, OpenAI…). Si una IA se queda sin saldo o falla, pasa sola a la siguiente.
// Las claves nunca salen de .env; solo escucha en tu PC (127.0.0.1).
//
//   node herramientas/puente-ia.mjs            → enciende el puente (VS Code lo abre solo con la tarea «IA en cascada»)
//   PUENTE_IA_PUERTO=4141 en .env para cambiar el puerto
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { pedirIA } from './ia.mjs';

const require = createRequire(import.meta.url);
const { cargarEntorno } = require('./entorno.js');
export const MODELO = 'dc-cascada';

export function crearPuente({ pedir = pedirIA, env } = {}) {
    return http.createServer(async (req, res) => {
        const enviar = (codigo, cuerpo) => { res.writeHead(codigo, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(cuerpo)); };
        const ruta = req.url.replace(/\?.*$/, '').replace(/\/+$/, '');
        if (req.method === 'GET' && /\/models$/.test(ruta)) return enviar(200, { object: 'list', data: [{ id: MODELO, object: 'model', owned_by: 'dc-tecnology' }] });
        if (req.method === 'GET' && (ruta === '' || ruta === '/v1')) return enviar(200, { ok: true, modelo: MODELO });
        if (req.method !== 'POST' || !/\/chat\/completions$/.test(ruta)) return enviar(404, { error: { message: 'Usa POST /v1/chat/completions' } });
        let datos = '';
        for await (const parte of req) datos += parte;
        let b;
        try { b = JSON.parse(datos); } catch { return enviar(400, { error: { message: 'JSON no válido' } }); }
        try {
            // Español siempre (las IA gratis tienden a razonar y responder en inglés)
            const mensajes = [{ role: 'system', content: 'Responde y razona SIEMPRE en español de Colombia, nunca en inglés, aunque el contexto o el código estén en inglés.' }, ...(b.messages ?? [])];
            const r = await pedir(mensajes, {
                tarea: `puente:${String(req.headers['user-agent'] ?? 'editor').split(/[\/ ]/)[0].slice(0, 20)}`,
                temperatura: b.temperature ?? 0.2, maxTokens: b.max_tokens ?? b.max_completion_tokens ?? 4000,
                herramientas: b.tools, eleccion: b.tool_choice, json: b.response_format?.type === 'json_object',
                timeoutMs: 60000, presupuestoMs: 240000,
            }, env ? { env } : {});
            const id = `dc-${Date.now()}`, creado = Math.floor(Date.now() / 1000);
            const mensaje = { role: 'assistant', content: r.texto || (r.llamadas ? null : ''), ...(r.llamadas ? { tool_calls: r.llamadas } : {}) };
            const fin = r.llamadas ? 'tool_calls' : r.fin === 'length' ? 'length' : 'stop';
            res.setHeader('X-DC-IA', `${r.ia} (${r.modelo})`);
            if (!b.stream) return enviar(200, { id, object: 'chat.completion', created: creado, model: `${MODELO}/${r.ia}`, choices: [{ index: 0, message: mensaje, finish_reason: fin }], usage: r.usage ?? undefined });
            // Las herramientas piden respuesta por partes (stream): se entrega completa en una parte, con el mismo formato
            res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
            const parte = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: creado, model: `${MODELO}/${r.ia}`, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
            parte({ role: 'assistant', ...(r.texto ? { content: r.texto } : {}), ...(r.llamadas ? { tool_calls: r.llamadas.map((t, index) => ({ index, ...t })) } : {}) });
            parte({}, fin);
            res.end('data: [DONE]\n\n');
        } catch (e) {
            // 503 + mensaje claro: la herramienta muestra por qué no hubo respuesta (todas sin saldo o caídas)
            enviar(503, { error: { message: `Ninguna IA respondió: ${String(e.fallas?.join(' | ') || e.message).slice(0, 600)}`, type: 'dc_cascada' } });
        }
    });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const env = cargarEntorno();
    const puerto = Number(env.PUENTE_IA_PUERTO) || 4141;
    crearPuente().listen(puerto, '127.0.0.1', () => {
        console.log(`Puente de IA en cascada listo: http://127.0.0.1:${puerto}/v1 · modelo «${MODELO}». Deja esta ventana abierta.`);
        console.log('Consumo: node herramientas/ia.mjs --uso');
    }).on('error', (e) => {
        if (e.code === 'EADDRINUSE') console.log(`El puente ya está encendido en el puerto ${puerto}.`);
        else console.error(e.message);
    });
}
