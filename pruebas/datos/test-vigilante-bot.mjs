// herramientas/vigilante-bot.ps1 (enciende n8n y Evolution, corre como SYSTEM) y avisar-director.mjs (sin llamar a WhatsApp)
import fs from 'node:fs';
const m = await import(new URL('../../herramientas/avisar-director.mjs', import.meta.url).href);
const ok = (c, msg) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${msg}`); if (!c) process.exitCode = 1; };

const a = m.argumentos(['--clave', 'n8n-caido', '--horas', '6', '⚠️ n8n', 'caído']);
ok(a.clave === 'n8n-caido' && a.horas === 6 && a.texto === '⚠️ n8n caído', 'avisar-director: lee clave, horas y texto');
ok(m.numeroAviso('322 328 4622') === '573223284622' && m.numeroAviso('+57 322 328 4622') === '573223284622', 'avisar-director: número con 57');

const bytes = fs.readFileSync(new URL('../../herramientas/vigilante-bot.ps1', import.meta.url));
const ps = bytes.toString('utf8');
ok(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF, 'vigilante: UTF-8 con BOM (PowerShell 5.1 lee bien las tildes del registro y del aviso)');
ok(/-UserId 'SYSTEM'/.test(ps) && /-AtStartup/.test(ps), 'vigilante: tarea como SYSTEM y al prender el PC');
ok(/if \(\$esSistema -or \$esAdmin\) \{\s*\$n8nVivo = EncenderN8n/.test(ps), 'vigilante: solo enciende n8n como SYSTEM o administrador (otra cuenta abriría un n8n viejo)');
ok(/N8N_USER_FOLDER = \$c\.Perfil/.test(ps) && /N8N_CARPETA/.test(ps), 'vigilante: n8n con su carpeta de datos (N8N_CARPETA o la base más reciente)');
ok(/\$versionN8n = '2\.43\.5'/.test(ps) && !/npx n8n"/.test(ps), 'vigilante: no salta de versión de n8n');
ok(/if \(-not \(Escucha 8080\)\)/.test(ps), 'vigilante: Evolution apagado se enciende de una vez');
