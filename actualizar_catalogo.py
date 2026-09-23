# -*- coding: utf-8 -*-
import json

print("Sincronizando catalogo de DC Technology...")

try:
    with open('productos.json', 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    print(f"Catalogo cargado correctamente: {len(data)} productos procesados.")

    with open('productos.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print("Archivo productos.json actualizado exitosamente.")

except Exception as e:
    print(f"Error al procesar el catalogo: {e}")
