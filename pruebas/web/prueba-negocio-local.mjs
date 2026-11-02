// T21 · Google Maps: la portada publica la tienda local (ElectronicsStore) con JSON-LD válido, sin dirección ni horario inventados
const ok = (c, m) => { console.log(`${c ? 'OK   ' : 'FALLA'} ${m}`); if (!c) process.exitCode = 1; };
const html = await (await fetch('http://localhost:5599/index.html')).text();
const bloques = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const datos = [];
let validos = true;
for (const b of bloques) { try { datos.push(JSON.parse(b)); } catch { validos = false; } }
ok(bloques.length >= 2 && validos, `los ${bloques.length} bloques JSON-LD de la portada son JSON válido`);
const tienda = datos.find((d) => [].concat(d['@type']).includes('ElectronicsStore'));
ok(Boolean(tienda), 'hay una tienda local (ElectronicsStore, tipo de LocalBusiness)');
ok([].concat(tienda?.['@type']).includes('Organization') && tienda?.['@id'] === 'https://dctecnology.xyz/#organizacion', 'es la misma organización (#organizacion) a la que apuntan productos y categorías');
ok(tienda?.name === 'DC Tecnology' && tienda?.url === 'https://dctecnology.xyz/', 'nombre y dirección web');
ok(/^https:\/\/dctecnology\.xyz\/img\/logo-dc-512\.png$/.test(tienda?.logo ?? '') && Boolean(tienda?.image), 'logo e imagen');
ok(tienda?.telephone === '+57-322-328-4622' && tienda?.contactPoint?.telephone === '+57-322-328-4622', 'teléfono +57 322 328 4622');
ok(tienda?.areaServed?.name === 'Colombia', 'zona atendida: Colombia');
ok(!('address' in (tienda ?? {})) && !('openingHoursSpecification' in (tienda ?? {})), 'sin dirección ni horario de la tienda (pendientes del director, B3)');
ok(/TODO \(B3/.test(html), 'la dirección y el horario quedan como TODO en un comentario');
