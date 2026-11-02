// T06 · Páginas legales: sección de uso de inteligencia artificial y enlaces del pie
import fs from 'node:fs';
const RAIZ = new URL('../../', import.meta.url);
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const leer = (r) => fs.readFileSync(new URL(r, RAIZ), 'utf8');
const t = leer('legal/terminos.html');
const ia = t.match(/<h2>9\. Uso de inteligencia artificial<\/h2>([\s\S]*?)<\/section>/)?.[1] ?? '';
ok(Boolean(ia), 'los términos tienen la sección «Uso de inteligencia artificial»');
ok(/asistente automático con inteligencia artificial/.test(ia) && /persona valida siempre los pagos y las entregas/.test(ia), 'el asistente de WhatsApp usa IA y una persona valida pagos y entregas');
ok(/voz de nuestros videos es generada por inteligencia artificial/.test(ia), 'los videos usan voz generada por IA');
ok(/no usamos tus datos para entrenar modelos/.test(ia), 'no se usan los datos para entrenar modelos propios');
ok(/ASESOR/.test(ia) && /persona del equipo/.test(ia), 'el cliente puede pedir hablar con una persona (ASESOR)');
ok(/<h2>10\. Atención/.test(t) && /<h2>11\. Ley aplicable/.test(t), 'la numeración sigue en orden');
ok(/Última actualización: 1 de noviembre de 2026/.test(t), 'los términos muestran la fecha del cambio');
const kb = JSON.parse(leer('bot-conocimiento.json'));
ok(kb.escalamiento.palabras_clave.includes('asesor'), 'ASESOR de verdad pasa a una persona en el bot');
for (const p of ['terminos', 'privacidad', 'garantias', 'cookies']) {
    const h = leer(`legal/${p}.html`);
    ok(['terminos', 'privacidad', 'garantias', 'cookies'].every((x) => h.includes(`href="${x}.html"`)), `legal/${p}.html enlaza a las 4 páginas legales`);
}
const index = leer('index.html');
ok(['terminos', 'privacidad', 'garantias', 'cookies'].every((x) => index.includes(`legal/${x}.html`)), 'el pie de la tienda sigue enlazando las 4 páginas legales');
