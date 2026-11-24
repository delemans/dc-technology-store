// herramientas/voz-bienvenida.mjs — Voz de bienvenida de la intro del sitio (audio/bienvenida.wav), con voz natural
// de Gemini (Charon: grave, tranquila). Por defecto reutiliza la toma YA GRABADA del video de lanzamiento L3
// («Bienvenido a la nueva era digital de DC Tecnology», caché: no gasta cupo) y la recorta por sus silencios.
//   node --use-system-ca herramientas/voz-bienvenida.mjs                → desde la toma de L3 (caché)
//   node --use-system-ca herramientas/voz-bienvenida.mjs --texto "..."  → graba una frase nueva (gasta 1 del cupo)
// Siempre se verifica transcribiendo (AssemblyAI) antes de guardar.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hablar, wav, SR } from './voz-gemini.mjs';
import { transcribir } from './transcribir.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'audio', 'bienvenida.wav');
const args = process.argv.slice(2);
const L3 = ['Estuvimos trabajando para ti.', 'Para darte un servicio más rápido y mejor.', 'Bienvenido a la nueva era digital de DC Tecnology.',
    'Tecnología, plataformas, pines y servicio técnico, todo en un solo lugar.', 'Escríbenos hoy por WhatsApp.'];

function frases(pcm, n) {
    // silencios de 140 ms o más → cortes; se toman los n-1 más largos en orden
    const V = Math.round(SR * 0.02), act = [];
    for (let i = 0; i * V < pcm.length; i++) { let m = 0; for (let k = i * V; k < Math.min(pcm.length, (i + 1) * V); k++) m = Math.max(m, Math.abs(pcm[k])); act.push(m > 600); }
    const huecos = []; for (let i = 0; i < act.length;) { if (!act[i]) { let j = i; while (j < act.length && !act[j]) j++; if (i > 0 && j < act.length && j - i >= 7) huecos.push({ i, j, n: j - i }); i = j; } else i++; }
    const cortes = huecos.sort((a, b) => b.n - a.n).slice(0, n - 1).sort((a, b) => a.i - b.i).map((h) => Math.round((h.i + h.j) / 2) * V);
    const partes = []; let a = 0; for (const c of [...cortes, pcm.length]) { partes.push(pcm.slice(a, c)); a = c; }
    return partes;
}
const recorte = (p) => { let a = 0, b = p.length - 1; while (a < b && Math.abs(p[a]) < 220) a++; while (b > a && Math.abs(p[b]) < 220) b--; return p.slice(Math.max(0, a - 1200), Math.min(p.length, b + 2400)); };

let pcm = null, esperado;
if (args.includes('--texto')) {
    esperado = args[args.indexOf('--texto') + 1];
    pcm = (await hablar(esperado, { voz: 'Charon' })).pcm;
} else {
    esperado = L3[2];
    const todo = (await hablar(L3.join(' '), { voz: 'Charon' })).pcm;
    // se parte en TODAS las pausas y se busca, transcribiendo, el tramo que dice «Bienvenido … DC Tecnology»
    const partes = frases(todo, 40);
    for (let i = 0; i < partes.length && !pcm; i++) {
        const t1 = await transcribir(wav(partes[i])); if (!/bienvenid/i.test(t1 ?? '')) continue;
        let junto = partes[i], txt = t1;
        for (let j = i + 1; j < partes.length && !/\bD\.?\s?C\.?\s+Te[ck]h?n/i.test(txt); j++) { const u = new Int16Array(junto.length + partes[j].length); u.set(junto); u.set(partes[j], junto.length); junto = u; txt = await transcribir(wav(junto)); }
        pcm = junto;
    }
    if (!pcm) { console.log('✖ No encontré la frase de bienvenida en la toma.'); process.exit(1); }
}
pcm = recorte(pcm);
// suave entrada/salida para que no haga «clic»
const f = Math.round(SR * 0.03); for (let i = 0; i < f; i++) { pcm[i] = Math.round(pcm[i] * i / f); pcm[pcm.length - 1 - i] = Math.round(pcm[pcm.length - 1 - i] * i / f); }
const dicho = await transcribir(wav(pcm));
console.log(`Dice: «${dicho}» (${(pcm.length / SR).toFixed(2)} s)`);
if (!/bienvenid/i.test(dicho ?? '') || !/\bD\.?\s?C\.?\s+Te[ck]h?n/i.test(dicho ?? '')) { console.log('✖ No pasó el control: no se guarda.'); process.exit(1); }
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, wav(pcm));
console.log(`✔ ${SALIDA} (${Math.round(fs.statSync(SALIDA).size / 1024)} KB)`);
