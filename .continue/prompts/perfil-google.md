---
name: perfil-google
description: "Contenido semanal para el Perfil de Empresa de Google (Maps)"
invokable: true
---
Reglas: español; cero datos inventados (nada de reseñas, cifras de seguidores ni horarios que el director no haya dado); marca «DC Tecnology», www.dctecnology.xyz, WhatsApp 322 328 4622; nunca nombrar proveedores; no abrir .env; trabajo en una rama gemini/<tema> y entrega con /entregar.
Objetivo: subir en Google Maps con contenido real y constante.
1. Lee docs/catalogo-resumen.md (catálogo resumido con precios y páginas; NO leas productos.json entero: pesa 650 KB. Para un producto puntual busca su id con grep en productos.json) (servicios y tecnología visibles), herramientas/estados-plan.json (campaña de la semana) y guias/.
2. Escribe docs/maps/semana-<AAAA-MM-DD>.md con:
   - 2 publicaciones (novedad u oferta, 150-300 palabras): una de un servicio técnico y otra de un producto con precio real, cada una con un botón sugerido («Llamar» o «Más información» → una página p/ o c/ real) y la foto que se debe usar (archivo real de img/ o del producto);
   - 5 preguntas y respuestas para la sección «Preguntas y respuestas», sacadas de la FAQ de bot-conocimiento.json;
   - 3 respuestas modelo para reseñas (positiva, neutra y negativa), amables y sin prometer nada nuevo.
3. Incluye la lista de chequeo de constancia: nombre, teléfono y web idénticos en el sitio, Google, Facebook, Instagram y WhatsApp Business.
