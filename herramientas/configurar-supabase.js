// herramientas/configurar-supabase.js — Ejecuta un archivo .sql en Supabase y verifica el resultado.
//
//   Solo revisar el estado:   node herramientas/configurar-supabase.js
//   Aplicar wo-015.sql:       node herramientas/configurar-supabase.js --aplicar
//   Otro archivo:             node herramientas/configurar-supabase.js --aplicar --archivo supabase/wo-014-pagos.sql
//
// Requiere en .env: SUPABASE_URL y SUPABASE_ACCESS_TOKEN (token personal, empieza por sbp_).
// Por qué no la service_role: esa clave solo sirve para la API de datos (tablas y funciones), que no
// ejecuta SQL arbitrario. El SQL se corre con la API de administración de Supabase:
//   POST https://api.supabase.com/v1/projects/{ref}/database/query
// Los archivos de supabase/ son idempotentes: volver a ejecutarlos no duplica nada.

const fs = require('fs');
const path = require('path');
const { RAIZ, cargarEntorno, requerir, ocultar } = require('./entorno');

const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const archivoArg = args.includes('--archivo') ? args[args.indexOf('--archivo') + 1] : 'supabase/wo-015.sql';
const ARCHIVO = path.resolve(RAIZ, archivoArg);

const env = cargarEntorno();
requerir(env, ['SUPABASE_URL', 'SUPABASE_ACCESS_TOKEN']);
if (!/^sbp_/.test(env.SUPABASE_ACCESS_TOKEN)) {
    console.error('SUPABASE_ACCESS_TOKEN debe ser un token personal (empieza por sbp_), no la service_role ni la anon key.\n'
        + 'Créalo en https://supabase.com/dashboard/account/tokens');
    process.exit(1);
}
const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(env.SUPABASE_URL)?.[1];
if (!ref) { console.error(`SUPABASE_URL no parece de Supabase: ${env.SUPABASE_URL}`); process.exit(1); }
const API = (env.SUPABASE_API_BASE || 'https://api.supabase.com').replace(/\/+$/, '');

async function sql(query) {
    const r = await fetch(`${API}/v1/projects/${ref}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const texto = await r.text();
    if (!r.ok) {
        const pista = r.status === 401 ? ' (token inválido o vencido)' : r.status === 403 ? ' (el token no tiene acceso a este proyecto)' : '';
        throw new Error(`HTTP ${r.status}${pista}: ${texto.slice(0, 500)}`);
    }
    return texto ? JSON.parse(texto) : [];
}

const ESTADO = `
select to_regclass('public.notificaciones_whatsapp') is not null            as cola_notificaciones,
       to_regprocedure('public.tomar_notificaciones(integer)') is not null as rpc_tomar,
       to_regprocedure('public.marcar_notificacion(bigint, boolean, text, text)') is not null as rpc_marcar,
       to_regprocedure('public.es_admin()') is not null                    as es_admin,
       exists (select 1 from pg_trigger where tgname = 'trg_encolar_notificaciones') as trigger_posventa,
       (select count(*) from public.administradores)                       as administradores,
       (select count(*) from public.metodos_pago where activo)             as cuentas_pago_activas`;
// administradores puede no existir aún: se consulta por separado para no romper la verificación
const ESTADO_SEGURO = ESTADO.replace('(select count(*) from public.administradores)',
    "(case when to_regclass('public.administradores') is null then null else (select count(*) from public.administradores) end)");

async function mostrarEstado(titulo) {
    let fila;
    try {
        [fila] = await sql(ESTADO_SEGURO);
    } catch (error) {
        // administradores aún no existe (to_regclass no evita el error de compilación): versión mínima
        [fila] = await sql(ESTADO.replace(/,\s*\(select count\(\*\) from public\.administradores\)\s*as administradores/, ''));
    }
    console.log(`\n${titulo}`);
    for (const [k, v] of Object.entries(fila ?? {})) console.log(`  ${v === true ? '✔' : v === false ? '✘' : '·'} ${k}: ${v}`);
    return fila ?? {};
}

(async () => {
    console.log(`Proyecto: ${ref} · token ${ocultar(env.SUPABASE_ACCESS_TOKEN)}`);
    const antes = await mostrarEstado('Estado actual:');

    if (!APLICAR) {
        const listo = antes.cola_notificaciones && antes.rpc_tomar && antes.rpc_marcar && antes.trigger_posventa && antes.es_admin;
        console.log(listo
            ? '\nwo-015 ya está completo. No hace falta aplicar nada.'
            : `\nFalta aplicar ${path.relative(RAIZ, ARCHIVO)}. Ejecuta de nuevo con --aplicar.`);
        return;
    }

    if (!fs.existsSync(ARCHIVO)) throw new Error(`No existe ${ARCHIVO}`);
    console.log(`\nEjecutando ${path.relative(RAIZ, ARCHIVO)} …`);
    // Un solo envío: el archivo completo corre en una transacción; si algo falla, no queda a medias
    const resultado = await sql(`begin;\n${fs.readFileSync(ARCHIVO, 'utf8')}\ncommit;`);
    console.log('  ✔ SQL ejecutado.');
    if (Array.isArray(resultado) && resultado.length) {
        console.log('  Resultado de la última consulta del archivo:');
        console.table(resultado);
    }

    const despues = await mostrarEstado('Estado después:');
    if (Number(despues.cuentas_pago_activas) === 0) {
        console.log('\n⚠ No hay cuentas activas en metodos_pago: el bot no compartirá datos de pago (escalará a un asesor).');
    }
    console.log('\nRecuerda borrar el token personal en https://supabase.com/dashboard/account/tokens si no lo vas a seguir usando.');
})().catch((error) => {
    console.error(`\n✘ ${error.message}`);
    console.error('No se aplicó nada parcial: el archivo corre dentro de una transacción.');
    process.exitCode = 1;
});
