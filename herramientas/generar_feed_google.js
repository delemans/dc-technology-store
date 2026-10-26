// herramientas/generar_feed_google.js — Archivo de productos para Google Merchant Center (fichas gratuitas en Google Shopping).
//   node herramientas/generar_feed_google.js   (también corre con npm run seo)
// Salida: merchant/productos.xml (RSS 2.0 con el espacio g:). En Merchant Center: Productos → Fuentes de datos →
// «Archivo programado» con la URL https://dctecnology.xyz/merchant/productos.xml (Google lo vuelve a leer a diario).
// Solo tecnología física visible y con existencias: las cuentas de streaming, licencias y pines NO van (las políticas de
// Google Shopping limitan la reventa de suscripciones y claves; arriesgaría la cuenta). Precios = productos.json (los de
// las páginas p/, para que el precio del archivo y el de la página coincidan, como exige Google).
const fs = require('fs');
const path = require('path');
const RAIZ = path.resolve(__dirname, '..');
const SITIO = 'https://dctecnology.xyz';
const productos = require('./disponibilidad.js').filtrar(JSON.parse(fs.readFileSync(path.join(RAIZ, 'productos.json'), 'utf8')));
const xml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const texto = (html) => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const paginas = new Set(fs.readdirSync(path.join(RAIZ, 'p')).map((f) => f.replace(/\.html$/, '')));

const items = productos
    .filter((p) => (p.tipo === 'tecnologia' || p.tipo === 'variedades') && !p.oculto && paginas.has(p.id))
    .filter((p) => !p.agotado && (!Number.isFinite(p.existencias) || p.existencias > 0))
    .map((p) => {
        const v = (p.variantes ?? []).find((x) => Number(x.precio) > 0);
        if (!v || !p.imagen) return null;
        const descripcion = texto(p.descripcion) || `${p.nombre}. Garantía de 30 días por defectos de fábrica y envíos a todo Colombia.`;
        return `    <item>
      <g:id>${xml(p.id)}</g:id>
      <g:title>${xml(p.nombre.slice(0, 150))}</g:title>
      <g:description>${xml(descripcion.slice(0, 4900))}</g:description>
      <g:link>${SITIO}/p/${xml(p.id)}.html</g:link>
      <g:image_link>${xml(p.imagen)}</g:image_link>
      <g:availability>in_stock</g:availability>
      <g:price>${Math.round(Number(v.precio))} COP</g:price>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
      <g:google_product_category>${p.tipo === 'tecnologia' ? 'Electronics' : 'Home &amp; Garden'}</g:google_product_category>
      <g:product_type>${xml(p.tipo === 'tecnologia' ? 'Tecnología' : (p.categoria ?? 'Hogar y variedades'))}</g:product_type>
      ${Number.isFinite(p.existencias) ? `<g:sell_on_google_quantity>${p.existencias}</g:sell_on_google_quantity>` : ''}
    </item>`;
    })
    .filter(Boolean);

const salida = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>DC Tecnology · tecnología</title>
    <link>${SITIO}</link>
    <description>Productos de tecnología con garantía y envío a todo Colombia</description>
${items.join('\n')}
  </channel>
</rss>
`;
fs.mkdirSync(path.join(RAIZ, 'merchant'), { recursive: true });
fs.writeFileSync(path.join(RAIZ, 'merchant', 'productos.xml'), salida);
console.log(`Google Merchant Center: ${items.length} productos en merchant/productos.xml`);
