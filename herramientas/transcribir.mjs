// herramientas/transcribir.mjs — Control de calidad de la locución: transcribe un audio (AssemblyAI, ASSEMBLYAI_API_KEY
// del .env) y lo compara con el guion. Así se comprueba que la voz dijo TODAS las palabras y nada de más.
//   transcribir(wavBuffer) → texto · parecido(guion, texto) → 0..1 (palabras del guion presentes y sin sobrantes)
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { cargarEntorno } = require('./entorno.js');
const env = cargarEntorno();
const API = 'https://api.assemblyai.com/v2';

export async function transcribir(audio) {
    if (!env.ASSEMBLYAI_API_KEY) return null;
    const h = { authorization: env.ASSEMBLYAI_API_KEY };
    const up = await (await fetch(`${API}/upload`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/octet-stream' }, body: audio })).json();
    if (!up.upload_url) throw new Error(`AssemblyAI upload: ${JSON.stringify(up).slice(0, 120)}`);
    const t = await (await fetch(`${API}/transcript`, { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ audio_url: up.upload_url, language_code: 'es' }) })).json();
    for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await (await fetch(`${API}/transcript/${t.id}`, { headers: h })).json();
        if (s.status === 'completed') return s.text ?? '';
        if (s.status === 'error') throw new Error(`AssemblyAI: ${s.error}`);
    }
    throw new Error('AssemblyAI: tiempo agotado');
}

const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !/^\d+$/.test(w));
export function parecido(guion, dicho) {
    const g = norm(guion), d = norm(dicho);
    const cubiertas = g.filter((w) => d.includes(w)).length / Math.max(1, g.length);
    const sobrantes = Math.max(0, d.length - g.length * 1.35) / Math.max(1, g.length);
    return { cubiertas, sobrantes, faltan: g.filter((w) => !d.includes(w)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && process.argv[2]) {
    console.log(await transcribir(fs.readFileSync(process.argv[2])));
}
