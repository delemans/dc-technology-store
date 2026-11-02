// T21 · Enlace de reseñas de Google: la solicitud de reseña lo ofrece solo si está configurado (jsCode REAL de «Armar mensaje»)
const flujo = require(process.argv[2]);
const nodo = (n) => flujo.nodes.find((x) => x.name === n);
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const config = nodo('Config bot').parameters.assignments.assignments;
const campo = config.find((a) => a.name === 'enlace_resena_google');
ok(Boolean(campo) && campo.value === '', 'Config bot trae enlace_resena_google vacío por defecto');
ok(nodo('Config posventa').parameters.assignments.assignments.some((a) => a.name === 'enlace_resena_google' && /Config bot/.test(a.value)), 'Config posventa lo copia de Config bot');

const armar = nodo('Armar mensaje');
ok(Boolean(armar), 'existe «Armar mensaje»');
const correr = (n, enlace) => new Function('$', '$input', '$getWorkflowStaticData', armar.parameters.jsCode)(
    (x) => ({ first: () => ({ json: x === 'Config posventa' ? { enlace_resena_google: enlace, numero_aviso_admin: '573000000000' } : {} }) }),
    { first: () => ({ json: n }), all: () => [{ json: n }] }, () => ({}))[0].json.texto;
const resena = { id: 1, tipo: 'SOLICITUD_RESENA', destino: '573001112233', variables: { producto: 'Netflix', codigo: 'DC-AB12' } };
const G = 'https://g.page/r/EjemploDC/review';

const sin = correr(resena, '');
ok(/Netflix/.test(sin) && /#resena/.test(sin) && !/Google/.test(sin), 'sin enlace → la solicitud queda igual (sin Google)');
const con = correr(resena, `  ${G}  `);
ok(con.includes(`🌟 ¿Nos ayudas también en Google?`) && con.includes(G), 'con enlace → ofrece la reseña en Google');
ok(con.indexOf(G) > con.indexOf('#resena') && con.indexOf(G) < con.indexOf('SOPORTE'), '… después de la reseña de la tienda y antes de SOPORTE');
ok(/responde \*NO\*/.test(con), '… y conserva la opción de no recibir más');
ok(!/Google/.test(correr(resena, 'g.page/sin-https')), 'un enlace sin https no se envía');
const entrega = correr({ id: 2, tipo: 'ENTREGA_CONFIRMADA', destino: '573001112233', variables: { producto: 'Netflix', codigo: 'DC-AB12', datos: 'x', fecha: 'hoy' } }, G);
ok(!entrega.includes(G), 'los demás mensajes no llevan el enlace');
