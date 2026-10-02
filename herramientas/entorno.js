// herramientas/entorno.js — Lee el archivo .env de la raíz del proyecto (sin dependencias de npm).
// Las variables ya definidas en la terminal tienen prioridad sobre las del archivo.
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');

function cargarEntorno() {
    const ruta = path.join(RAIZ, '.env');
    const valores = {};
    if (fs.existsSync(ruta)) {
        for (const linea of fs.readFileSync(ruta, 'utf8').split(/\r?\n/)) {
            const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(linea);
            if (!m || linea.trim().startsWith('#')) continue;
            valores[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    return { ...valores, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k in valores || /^(N8N|SUPABASE|EVOLUTION|SILICONFLOW|NUMERO)_/.test(k))) };
}

// Exige variables; si falta alguna, explica cuál y termina sin hacer nada
function requerir(entorno, nombres) {
    const faltan = nombres.filter((n) => !entorno[n]);
    if (faltan.length) {
        console.error(`Faltan en .env: ${faltan.join(', ')}\nCopia .env.ejemplo como .env y complétalo.`);
        process.exit(1);
    }
}

// Muestra un secreto sin revelarlo: primeros 4 caracteres + largo
const ocultar = (v) => (v ? `${String(v).slice(0, 4)}… (${String(v).length} caracteres)` : '—');

module.exports = { RAIZ, cargarEntorno, requerir, ocultar };
