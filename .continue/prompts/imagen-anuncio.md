---
name: imagen-anuncio
description: "Diseña un anuncio 1080x1350 con precio real (HTML que se convierte en imagen)"
invokable: true
---
Reglas: español; cero datos inventados (precios y existencias solo de docs/catalogo-resumen.md, de la página del producto o de precios_publicos; nada de descuentos, reseñas ni tiempos que no existan); marca «DC Tecnology» y «www.dctecnology.xyz»; WhatsApp 322 328 4622; nunca nombrar proveedores (ANC, Emprende Red); nunca abrir .env; trabaja en una rama gemini/<tema>.
Producto o tema: (lo que escriba el director después del comando).
1. Toma nombre y precio de docs/catalogo-resumen.md y la foto (campo imagen) buscando el id con grep en productos.json (campo de imagen real; no inventes fotos).
2. Crea docs/anuncios/<id>.html de 1080x1350 px:
   - fondo grafito (#1d1f22), acento rojo #C8102E solo en el precio o el botón, letra Inter;
   - logo img/logo-dc-512.png arriba;
   - foto grande, nombre, precio con formato $ 12.345 y «www.dctecnology.xyz · WhatsApp 322 328 4622».
3. Explica cómo sacar la imagen: abrir el HTML en Chrome → F12 → Ctrl+Shift+P → «Capture full size screenshot».
4. Además, entrega 3 textos cortos para acompañarlo en Facebook o Instagram.
