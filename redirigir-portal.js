// redirigir-portal.js — Desde el 19/10/2026 todo vive en la tienda (una sola página). cliente.html solo lleva a la
// sección equivalente, conservando el código del pedido: #cuenta, #soporte, #combos y #catalogo existen en la tienda.
(() => {
    const anclas = { cuenta: 'cuenta', soporte: 'soporte', combos: 'combos', catalogo: 'catalogo' };
    const ancla = anclas[location.hash.slice(1)] ?? '';
    location.replace(`./${location.search}${ancla ? `#${ancla}` : ''}`);
})();
