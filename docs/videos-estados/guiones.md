# Videos para estados de WhatsApp — DC Technology

Un video corto por proceso, grabado sobre el sitio real (dctecnology.xyz). Esta carpeta es la
estructura de producción: guion por video, escenas y textos en pantalla. `escenas.json` describe las
mismas escenas en formato de máquina para poder automatizar la captura.

## Reglas de contenido (no negociables)
- **Cero datos inventados.** Precios, descuentos y combos salen del sitio en vivo (la base manda:
  `catalogo_precios`, `reglas_combo`). No se muestran reseñas, ventas ni "clientes felices" ficticios.
- **Pedidos y accesos de demostración:** se graban con una compra real hecha con tu propio número.
  Las claves se muestran veladas (el portal las vela por defecto) y nunca se revelan en cámara.
- **Números de WhatsApp de clientes:** solo enmascarados (`••• ••• 2233`), como los muestra el portal.
- Colores y tipografía de marca: rojo `#FF0033` / `#FF2A5F` → `#E50914` sobre `#0B0F19`, Outfit + Inter.

## Formato
| Parámetro | Valor |
|---|---|
| Relación | 9:16 vertical, 1080 × 1920 |
| Duración | 15–30 s (los estados cortan a los 60 s; menos es mejor) |
| Ritmo | gancho en los primeros 2 s, una idea por escena, cierre con llamada a la acción |
| Texto en pantalla | máx. 6 palabras por rótulo, centrado en el tercio superior (la parte baja la tapa la interfaz de WhatsApp) |
| Cierre (todas) | logo + "dctecnology.xyz" + "Escríbenos por WhatsApp" (2 s) |
| Audio | opcional; los estados se ven en silencio: todo debe entenderse sin sonido |

---

## 1 · "Compra en 3 toques" (≈20 s)
| # | Pantalla (cliente.html) | Acción | Rótulo |
|---|---|---|---|
| 1 | Inicio | carrusel "Más pedidos" desliza | **¿Tu plataforma favorita?** |
| 2 | Catálogo → Streaming | toca un producto | Elige tu plan |
| 3 | Hoja del producto | elige variante → "Agregar" (salta el contador del carrito) | Agrégalo al carrito |
| 4 | Carrito → Pago | método local | Paga como quieras |
| 5 | Cierre | — | dctecnology.xyz |

## 2 · "Arma tu combo y ahorra" (≈25 s)
| # | Pantalla | Acción | Rótulo |
|---|---|---|---|
| 1 | Combos | fichas de reglas vigentes (vienen de la base) | **Más plataformas, menos pagas** |
| 2 | Combos | elige 2 → sello "-10 %" y pista "agrega 1 más…" | Combina 2… |
| 3 | Combos | elige la 3.ª → sello "-15 %" (ficha se ilumina) | …o 3 y ahorra más |
| 4 | Paso 2 | subtotal, descuento y total del combo | Todo en un solo pago |
| 5 | Cierre | — | Arma el tuyo en dctecnology.xyz |
> Los porcentajes del rótulo deben coincidir con `reglas_combo` el día de la grabación.

## 3 · "Paga y sube tu comprobante" (≈25 s)
| # | Pantalla | Acción | Rótulo |
|---|---|---|---|
| 1 | Carrito → Pago | "Pagar y subir el comprobante aquí" | **Sin salir de la página** |
| 2 | Hoja "Paga tu pedido" | código de orden + total + copiar número | Copia y paga |
| 3 | Zona de archivo | elige la captura → vista previa | Sube tu comprobante |
| 4 | Éxito | check animado | Listo: lo validamos y te avisamos |
| 5 | Cierre | — | dctecnology.xyz |

## 4 · "Tus pedidos con tu WhatsApp" (≈25 s)
| # | Pantalla | Acción | Rótulo |
|---|---|---|---|
| 1 | Mis pedidos | número (enmascarado al final) → "Enviarme el código" | **Sin contraseñas** |
| 2 | Caja de 6 dígitos | pega el código → animación de éxito | Entra con un código |
| 3 | Historial | línea de tiempo + barra de garantía | Sigue cada pedido |
| 4 | Tarjeta entregada | "Ver accesos" → panel velado (NO tocar para revelar) | Tus accesos, seguros |
| 5 | Cierre | — | dctecnology.xyz |

## 5 · "Soporte y garantía" (≈20 s)
| # | Pantalla | Acción | Rótulo |
|---|---|---|---|
| 1 | Tarjeta del pedido | "Reportar falla" | **¿Algo falla?** |
| 2 | Soporte | elige el problema → pasos guiados | Te guiamos paso a paso |
| 3 | Final | "Registrar reporte" → confirmación con garantía | Queda registrado con tu garantía |
| 4 | Cierre | — | Respondemos por WhatsApp |

## 6 · "Atención por WhatsApp" (≈20 s, opcional)
Grabación de pantalla del chat real con el bot (tu número de prueba): pregunta por un combo → el bot
responde con el desglose exacto (marca [COMBO]) → métodos de pago. Rótulos: **Te respondemos al
instante** · Precios exactos · Pagas y listo.

---

## Lista de verificación antes de grabar
- [ ] Al menos un método de pago **activo** en el panel (hoy `metodos_pago_publicos` devuelve 0).
- [ ] Una compra de prueba con tu número, entregada (para los videos 4 y 5).
- [ ] `reglas_combo` y precios revisados en el panel (lo que se ve es lo que se cobra).
- [ ] Modo oscuro en el teléfono de grabación (los videos se ven mejor y consistentes).
- [ ] Notificaciones del teléfono silenciadas durante la captura.
