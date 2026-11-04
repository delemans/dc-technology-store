// Parche de DC Tecnology sobre Evolution API 2.3.7 (el mismo que tiene el PC de la oficina desde el 16/10/2026):
// los mensajes de «Meta Business Agent» (JID …@bot) hacían fallar a Baileys 7.0.0-rc.9 con «Unknown message type»
// y trababan la cola (del 13 al 16/10 no entró ningún mensaje). Se ignoran en shouldIgnoreJid.
// Si el texto original cambió (otra versión de Evolution), la construcción de la imagen FALLA a propósito.
import fs from 'node:fs';

const archivo = process.argv[2] ?? 'src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts';
let s = fs.readFileSync(archivo, 'utf8');
const antes = '        const isNewsletter = isJidNewsletter(jid);\n';
const retorno = '        return isGroupJid || isBroadcast || isNewsletter;\n';
if (s.includes('isMetaBot')) { console.log('parche @bot: ya estaba'); process.exit(0); }
if (s.split(antes).length !== 2 || s.split(retorno).length !== 2) {
    console.error('parche @bot: no encontré el código esperado en shouldIgnoreJid (¿cambió la versión de Evolution?)');
    process.exit(1);
}
s = s.replace(antes, `${antes}        // DC Tecnology (16/10/2026): los mensajes de "Meta Business Agent" (…@bot) trababan la cola de Baileys. Se ignoran.\n        const isMetaBot = String(jid ?? '').endsWith('@bot');\n`)
    .replace(retorno, '        return isGroupJid || isBroadcast || isNewsletter || isMetaBot;\n');
fs.writeFileSync(archivo, s);
console.log('parche @bot: aplicado');
