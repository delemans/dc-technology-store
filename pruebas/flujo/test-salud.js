// Salud del sistema: jsCode REAL de "Revisar salud" con consultas reales y una simulada
const flujo = require(process.argv[2]);
const codigo = flujo.nodes.find((n) => n.name === 'Revisar salud').parameters.jsCode;
const config = flujo.nodes.find((n) => n.name === 'Config bot').parameters.assignments.assignments.reduce((a, x) => ({ ...a, [x.name]: x.value }), {});
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const AsyncF = Object.getPrototypeOf(async () => {}).constructor;
const memoria = {};
const real = { httpRequest: async (o) => { const r = await fetch(o.url, { headers: o.headers }); return { statusCode: r.status, body: await r.text() }; } };
const correr = (helpers, cfg = { ...config, numero_aviso_admin: '3125132325' }) => new AsyncF('$', '$getWorkflowStaticData', codigo).call({ helpers }, () => ({ first: () => ({ json: cfg }) }), () => memoria);
const conAnc = (estado) => ({ httpRequest: async (o) => o.url.includes('ancpagos') ? (estado === 'cae' ? { statusCode: 503, body: 'mantenimiento' } : { statusCode: 200, body: 'const CATALOGO_INICIAL_IDX = {}' }) : real.httpRequest(o) });
(async () => {
  let r = await correr(real);
  console.log('   estado real:', Object.entries(memoria.salud).map(([k, v]) => `${k}=${v.ok ? 'ok' : 'falla (' + v.detalle + ')'}`).join(' · '));
  ok(memoria.salud.tienda_anc.ok, 'tienda pública de ANC responde');
  ok(r.length === 0, '1.ª falla de ANC → aún no avisa (evita falsas alarmas)');
  r = await correr(conAnc('cae'));
  ok(r.length === 1 && r[0].json.numero === '573125132325' && /ancpagos\.com\) no responde/.test(r[0].json.texto) && /revisión manual/.test(r[0].json.texto), '2.ª falla seguida → te avisa una vez, con 57 en el número');
  console.log('   ' + r[0]?.json.texto.replace(/\n/g, '\n   '));
  r = await correr(conAnc('cae'));
  ok(r.length === 0, 'sigue caído → no repite el aviso');
  r = await correr(conAnc('vuelve'));
  ok(r.length === 1 && /volvió a funcionar/.test(r[0].json.texto), 'ANC vuelve → te avisa que volvió');
  r = await correr(conAnc('vuelve'));
  ok(r.length === 0, 'todo bien → silencio');
  const cfgSin = { ...config, numero_aviso_admin: '' };
  await correr(conAnc('cae'), cfgSin); r = await correr(conAnc('cae'), cfgSin);
  ok(r.length === 0, 'sin número de aviso configurado → no envía a nadie');
  ok(memoria.salud.sitio !== undefined, `sitio y conocimiento revisados (${memoria.salud.sitio.ok ? 'ok' : memoria.salud.sitio.detalle})`);
})();
// IA sin saldo (lo marca "IA balanceada") → aviso una vez; vuelve → aviso
setTimeout(async () => {
  memoria.iaEstado = { dia: 'x', p: { SiliconFlow: { sinSaldo: true, motivo: '402 Insufficient balance' }, Groq: { sinSaldo: false } } };
  let r = await correr(conAnc('vuelve'));
  const ia = r.filter((x) => /IA SiliconFlow/.test(x.json.texto));
  ok(ia.length === 1 && /sin saldo/.test(ia[0].json.texto) && /sigue respondiendo con: Groq/.test(ia[0].json.texto), 'IA sin saldo → te avisa y dice con cuál sigue respondiendo');
  r = await correr(conAnc('vuelve'));
  ok(r.length === 0, 'sigue sin saldo → no repite');
  memoria.iaEstado.p.SiliconFlow = { sinSaldo: false };
  r = await correr(conAnc('vuelve'));
  ok(r.length === 1 && /SiliconFlow volvió/.test(r[0].json.texto), 'recargada → te avisa que volvió');
}, 15000);
