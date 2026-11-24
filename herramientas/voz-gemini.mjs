// herramientas/voz-gemini.mjs — Locución con voz natural de Gemini TTS (clave IA_RESPALDO_KEY del .env, la de Gemini).
// hablar(texto, { voz, estilo }) → { pcm: Int16Array 24 kHz mono, segundos }. Guarda en caché (herramientas/salida/voz/)
// para no gastar cuota repitiendo el mismo texto. Pide hablar claro y completo (sin comerse palabras) y recorta los
// silencios de los extremos. Reintenta ante 429/503 con espera.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { cargarEntorno } = require('./entorno.js');
const env = cargarEntorno();
const CACHE = path.join(RAIZ, 'herramientas', 'salida', 'voz');
export const MODELOS = ['gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts', 'gemini-3.1-flash-tts-preview', 'gemini-3.8-flash-lite-tts', 'gemini-2.5-pro-preview-tts'];
const AGOTADOS = new Set(); // modelos sin cupo en esta corrida (429)
export const SR = 24000;
const ESTILO = 'Say in a warm, upbeat and natural Colombian Spanish radio-announcer voice, clear diction, every word fully pronounced';

// La marca y los precios como se dicen (el texto en pantalla no cambia)
const pronunciar = (t) => t.replace(/\$\s?([\d.]+)/g, (m, n) => `${Number(n.replace(/\./g, '')).toLocaleString('es-CO')} pesos`);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function recortar(pcm) {
    // quita silencios de los extremos (umbral bajo) y deja 60 ms de aire
    const umbral = 220; let a = 0, b = pcm.length - 1;
    while (a < b && Math.abs(pcm[a]) < umbral) a++;
    while (b > a && Math.abs(pcm[b]) < umbral) b--;
    const aire = Math.round(SR * 0.06);
    return pcm.slice(Math.max(0, a - aire), Math.min(pcm.length, b + aire));
}

export async function hablar(texto, { voz = 'Charon', estilo = ESTILO } = {}) {
    if (!env.IA_RESPALDO_KEY) throw new Error('Falta IA_RESPALDO_KEY (clave de Gemini) en .env');
    fs.mkdirSync(CACHE, { recursive: true });
    const clave = crypto.createHash('sha1').update(`v3|${voz}|${estilo}|${texto}`).digest('hex').slice(0, 20);
    const archivo = path.join(CACHE, `${clave}.pcm`);
    if (fs.existsSync(archivo)) { const b = fs.readFileSync(archivo); const pcm = new Int16Array(b.buffer, b.byteOffset, b.length / 2); return { pcm, segundos: pcm.length / SR }; }
    let ultimo = '';
    for (let intento = 0; intento < MODELOS.length * 2; intento++) {
        const libres = MODELOS.filter((m) => !AGOTADOS.has(m));
        if (!libres.length) { const e = new Error('CUOTA: se acabó el cupo diario de voz de Gemini (sigue mañana)'); e.cuota = true; throw e; }
        const modelo = libres[intento % libres.length];
        try {
            const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.IA_RESPALDO_KEY }, signal: AbortSignal.timeout(180000),
                body: JSON.stringify({ contents: [{ parts: [{ text: pronunciar(texto) }] }],
                    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } } } }),
            });
            const j = await r.json().catch(() => ({}));
            if (r.status === 429) { AGOTADOS.add(modelo); ultimo = `${modelo} sin cupo`; continue; }
            if (!r.ok) { ultimo = `${modelo} ${r.status} ${j.error?.status ?? ''}`; await esperar(4000); continue; }
            const datos = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
            if (!datos) { ultimo = `${modelo} sin audio`; await esperar(2000); continue; }
            const b = Buffer.from(datos, 'base64');
            const pcm = recortar(new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2)));
            if (pcm.length < SR * 0.4) { ultimo = `${modelo} audio vacío`; continue; }
            fs.writeFileSync(archivo, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
            return { pcm, segundos: pcm.length / SR, modelo };
        } catch (e) { ultimo = `${modelo} ${e.cause?.code ?? e.message}`; await esperar(3000); }
    }
    throw new Error(`Gemini TTS no respondió: ${ultimo}`);
}

export function wav(pcm) {
    const h = Buffer.alloc(44); const n = pcm.byteLength;
    h.write('RIFF', 0); h.writeUInt32LE(36 + n, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(n, 40);
    return Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, n)]);
}

// Prueba: node --use-system-ca herramientas/voz-gemini.mjs "texto" [voz]
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv[2]) {
    const { pcm, segundos, modelo } = await hablar(process.argv[2], { voz: process.argv[3] ?? 'Charon' });
    const f = path.join(CACHE, 'prueba.wav'); fs.writeFileSync(f, wav(pcm));
    console.log(`${segundos.toFixed(2)} s · ${modelo ?? 'caché'} → ${f}`);
}
