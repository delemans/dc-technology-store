document.addEventListener('DOMContentLoaded', () => {
    const productGrid = document.getElementById('product-grid');
    const productCount = document.getElementById('product-count');
    const categoryTitle = document.getElementById('category-title');
    const filterBtns = document.querySelectorAll('.filter-btn');
    const searchInput = document.getElementById('searchInput');
    
    // Modal Elements
    const modal = document.getElementById('product-modal');
    const modalBox = document.getElementById('modal-content-box');
    const closeModal = document.getElementById('close-modal');

    const numeroWhatsApp = "573223284622";
    let todosLosProductos = [];
    let productoSeleccionado = null;
    let varianteSeleccionada = null;

    // BASE DE DATOS COMPLETA INTEGRADA (Respaldo directo antierrores CORS local)
    const RAW_PRODUCTOS = [
      {
        "id": "reloj-inteligente-smartwatch-d16-con-auriculares-inalambricos-incorporados",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Reloj Inteligente Smartwatch D16 con Auriculares Inalámbricos incorporados",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-08-05t132417-472-cdb7b640d1b456e25917859545724174-640-0.webp",
        "variantes": [{ "nombre": "Unidad Completa", "precio": 180000, "precio_anterior": 250000 }]
      },
      {
        "id": "diademas-inalambricas-cr-8-con-luces-r9s7x",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Diademas Inalámbricas CR-8 con Luces LED",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-08-05t124115-373-36ef27e8fec107431017859523974607-640-0.webp",
        "variantes": [{ "nombre": "Unidad Completa", "precio": 100000, "precio_anterior": 180000 }]
      },
      {
        "id": "diademas-gamer-a3s-alambrico",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Diademas Gamer A3S Alámbrico",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-08-05t130350-966-4dfe07f4c2d364484917859531935783-640-0.webp",
        "variantes": [{ "nombre": "Unidad Gamer", "precio": 80000, "precio_anterior": 150000 }]
      },
      {
        "id": "reloj-inteligente-smartwatch-gt5-pro-en-acero-inoxidable",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Reloj Inteligente Smartwatch GT5 Pro En Acero Inoxidable",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-99-4c5ffc8ccc1753790217797441936117-640-0.webp",
        "variantes": [{ "nombre": "Acero Inoxidable", "precio": 140000, "precio_anterior": 250000 }]
      },
      {
        "id": "powerbank-portatil-recargable-20-000-mah",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Powerbank Portátil Recargable 20.000 mAh",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-08-05t131148-996-0889ddb93403eb4b7c17859537418984-640-0.webp",
        "variantes": [{ "nombre": "Carga Rápida 20.000 mAh", "precio": 120000, "precio_anterior": 180000 }]
      },
      {
        "id": "auriculares-inalambricos-de-gancho-sp16",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Auriculares Inalámbricos de Gancho SP16",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/d5daf6d4-fcfd8845691cefcb9a17356883269515-640-0.webp",
        "variantes": [{ "nombre": "Unidad Estándar", "precio": 75000, "precio_anterior": 130000 }]
      },
      {
        "id": "auriculares-inalambricos-m19-con-powerbank",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Auriculares Inalámbricos M19 (Con Powerbank)",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/69a3818b-ac5cbf4a784c7ed4bd17345638244173-640-0.webp",
        "variantes": [{ "nombre": "Powerbank M19", "precio": 40000, "precio_anterior": 80000 }]
      },
      {
        "id": "reloj-inteligente-smartwatch-h19",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Reloj Inteligente Smartwatch H19 en Acero Inoxidable",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-40-5133d512837827e1bd17696427986384-640-0.webp",
        "variantes": [{ "nombre": "Acero Inoxidable", "precio": 100000, "precio_anterior": 180000 }]
      },
      {
        "id": "auriculares-inalambricos-m25-con-powerbank",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Auriculares Inalámbricos M25 (Con Powerbank)",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/7d6805ef-2c9f36d3fd78cdc58617356911716233-640-0.webp",
        "variantes": [{ "nombre": "Gamer M25", "precio": 40000, "precio_anterior": 80000 }]
      },
      {
        "id": "reloj-inteligente-smartwatch-z90",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Reloj Inteligente Smartwatch Z90",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-36-961981d05a751785e617696425286798-640-0.webp",
        "variantes": [{ "nombre": "Deportivo Z90", "precio": 80000, "precio_anterior": 150000 }]
      },
      {
        "id": "reloj-inteligente-smartwatch-p13-de-lujo-en-acero-inoxidable",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Reloj Inteligente Smartwatch P13 de Lujo en Acero Inoxidable",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-38-f043210a056cc86cda17696429481904-640-0.webp",
        "variantes": [{ "nombre": "Acero de Lujo P13", "precio": 130000, "precio_anterior": 210000 }]
      },
      {
        "id": "reloj-inteligente-smartwatch-m9",
        "tipo": "tecnologia", "marca": "DC Technology",
        "nombre": "Reloj Inteligente Smartwatch M9",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-97-2890d094934ac49d2917797440145183-640-0.webp",
        "variantes": [{ "nombre": "Edición M9", "precio": 120000, "precio_anterior": 200000 }]
      },
      {
        "id": "netflix",
        "tipo": "streaming", "marca": "Netflix",
        "nombre": "Netflix Premium 4K",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2024-08-27t102440-663-92c3e993cc40c238fc17247722852386-640-0.webp",
        "variantes": [
          { "nombre": "Pantalla Colombia (1 Dispositivo)", "precio": 15000, "precio_anterior": 25000 },
          { "nombre": "Pantalla Internacional (1 Dispositivo)", "precio": 17000, "precio_anterior": 27000 }
        ]
      },
      {
        "id": "prime-video",
        "tipo": "streaming", "marca": "Amazon",
        "nombre": "Prime Video Ultra HD",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-87-58600aa95daca5fadc17247083377668-640-0.webp",
        "variantes": [
          { "nombre": "Pantalla (1 Dispositivo)", "precio": 10000, "precio_anterior": 18000 },
          { "nombre": "Cuenta Completa (6 Dispositivos)", "precio": 20000, "precio_anterior": 35000 }
        ]
      },
      {
        "id": "disney-plus",
        "tipo": "streaming", "marca": "Disney",
        "nombre": "Disney Plus Premium",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-91-9267e0a1730671bcf517247095798757-640-0.webp",
        "variantes": [{ "nombre": "Pantalla Premium", "precio": 15000, "precio_anterior": 25000 }]
      },
      {
        "id": "hbo-max",
        "tipo": "streaming", "marca": "Max",
        "nombre": "Max (HBO)",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2024-08-27t101929-364-5d53c57354216ecd4417247719752817-640-0.webp",
        "variantes": [
          { "nombre": "Pantalla 1 Mes", "precio": 8000, "precio_anterior": 15500 },
          { "nombre": "Cuenta Completa 1 Mes", "precio": 12000, "precio_anterior": 20000 },
          { "nombre": "Cuenta Completa 3 Meses", "precio": 18000, "precio_anterior": 27000 },
          { "nombre": "Cuenta Completa 6 Meses", "precio": 25000, "precio_anterior": 34000 }
        ]
      },
      {
        "id": "crunchyroll",
        "tipo": "streaming", "marca": "Crunchyroll",
        "nombre": "Crunchyroll Mega Fan",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-85-ddbcabd36470bf37cb17247079814050-640-0.webp",
        "variantes": [
          { "nombre": "Perfil Mega Fan 1 Mes", "precio": 10000, "precio_anterior": 18000 },
          { "nombre": "Cuenta Completa 1 Mes", "precio": 19000, "precio_anterior": 30000 }
        ]
      },
      {
        "id": "vix-premium",
        "tipo": "streaming", "marca": "Vix",
        "nombre": "Vix Premium",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-74-58eb29638bb8d2725f17247207045910-640-0.webp",
        "variantes": [
          { "nombre": "Pantalla 1 Mes", "precio": 8000, "precio_anterior": 13500 },
          { "nombre": "Cuenta Completa 1 Mes", "precio": 15000, "precio_anterior": 25000 }
        ]
      },
      {
        "id": "paramount-plus",
        "tipo": "streaming", "marca": "Paramount",
        "nombre": "Paramount Plus",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/image-8-1-1c0fae159cffedf49d17134749124740-640-0.webp",
        "variantes": [
          { "nombre": "Pantalla 1 Mes", "precio": 10000, "precio_anterior": 18000 },
          { "nombre": "Cuenta Completa 1 Mes", "precio": 20000, "precio_anterior": 25500 }
        ]
      },
      {
        "id": "universal-plus",
        "tipo": "streaming", "marca": "Universal",
        "nombre": "Universal Plus",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-89-0fd5d546fff75e881717247090664955-640-0.webp",
        "variantes": [
          { "nombre": "Pantalla 1 Mes", "precio": 10000, "precio_anterior": 18000 },
          { "nombre": "Cuenta Completa 1 Mes", "precio": 20000, "precio_anterior": 35000 }
        ]
      },
      {
        "id": "viki-rakuten",
        "tipo": "streaming", "marca": "Rakuten",
        "nombre": "Viki Rakuten Pass",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-71-f118630284a3d1b8c017246986683379-640-0.webp",
        "variantes": [{ "nombre": "Pantalla 1 Mes", "precio": 10000, "precio_anterior": 18000 }]
      },
      {
        "id": "apple-tv",
        "tipo": "streaming", "marca": "Apple",
        "nombre": "Apple TV Plus",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/con-o-sin-3-cafdcb979c4e928cc817534227138219-640-0.webp",
        "variantes": [
          { "nombre": "Perfil 1 Mes", "precio": 12000, "precio_anterior": 20000 },
          { "nombre": "Cuenta Completa 1 Mes", "precio": 24000, "precio_anterior": 35500 }
        ]
      },
      {
        "id": "mubi",
        "tipo": "streaming", "marca": "Mubi",
        "nombre": "Mubi Cinema",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2024-08-27t101739-823-7fb054275d672eafb417247718860579-640-0.webp",
        "variantes": [
          { "nombre": "Perfil 1 Mes", "precio": 10000, "precio_anterior": 18500 },
          { "nombre": "Cuenta Completa 1 Mes", "precio": 22000, "precio_anterior": 35000 }
        ]
      },
      {
        "id": "iptv-smarters",
        "tipo": "streaming", "marca": "IPTV",
        "nombre": "IPTV Smarters / Plex HD",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-81-f4fa3de76024ac6e3017247201256953-640-0.webp",
        "variantes": [
          { "nombre": "1 Mes (1 Dispositivo)", "precio": 13000, "precio_anterior": 22000 },
          { "nombre": "1 Mes (2 Dispositivos)", "precio": 23000, "precio_anterior": 32500 },
          { "nombre": "3 Meses (1 Dispositivo)", "precio": 35000, "precio_anterior": 60000 },
          { "nombre": "6 Meses (1 Dispositivo)", "precio": 55000, "precio_anterior": 80000 },
          { "nombre": "12 Meses (1 Dispositivo)", "precio": 80000, "precio_anterior": 120000 }
        ]
      },
      {
        "id": "capcut-pro",
        "tipo": "licencias", "marca": "CapCut",
        "nombre": "CapCut Pro Edición",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/con-o-sin-11-b62cd5366081340f5217534215681512-640-0.webp",
        "variantes": [{ "nombre": "Suscripción 1 Mes", "precio": 28000, "precio_anterior": 45000 }]
      },
      {
        "id": "canva-pro",
        "tipo": "licencias", "marca": "Canva",
        "nombre": "Canva Pro",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-78-092a1c711be9666f1e17246998999745-640-0.webp",
        "variantes": [
          { "nombre": "Acceso 1 Mes", "precio": 10000, "precio_anterior": 18500 },
          { "nombre": "Acceso 1 Año Completo", "precio": 40000, "precio_anterior": 85000 }
        ]
      },
      {
        "id": "duolingo-super",
        "tipo": "licencias", "marca": "Duolingo",
        "nombre": "Duolingo Super",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-94-e808b4d509a1e45f3f17247140783237-640-0.webp",
        "variantes": [{ "nombre": "Suscripción 1 Mes", "precio": 10000, "precio_anterior": 18500 }]
      },
      {
        "id": "mcafee-antivirus",
        "tipo": "licencias", "marca": "McAfee",
        "nombre": "McAfee Antivirus Total Protection",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-92-f51ee5b369b7a29c0917247098954661-640-0.webp",
        "variantes": [
          { "nombre": "Licencia 1 Año (1 PC)", "precio": 45000, "precio_anterior": 80000 },
          { "nombre": "Licencia 1 Año (5 PCs)", "precio": 130000, "precio_anterior": 180000 }
        ]
      },
      {
        "id": "office-365",
        "tipo": "licencias", "marca": "Microsoft",
        "nombre": "Office 365 Personal / Familiar",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-93-7002d700dab00f352517247104847099-640-0.webp",
        "variantes": [
          { "nombre": "Licencia 1 Año (5 Dispositivos)", "precio": 45000, "precio_anterior": 90000 },
          { "nombre": "Licencia Vitalicia", "precio": 80000, "precio_anterior": 150000 }
        ]
      },
      {
        "id": "office-2016-2019-2021-2024-pro-plus",
        "tipo": "licencias", "marca": "Microsoft",
        "nombre": "Office Pro Plus Vitalicio",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/1000062605-45b944d657592752c217680315104066-640-0.webp",
        "variantes": [
          { "nombre": "Office 2019 Pro Plus", "precio": 70000, "precio_anterior": 110000 },
          { "nombre": "Office 2021 Pro Plus", "precio": 80000, "precio_anterior": 120000 },
          { "nombre": "Office 2024 Pro Plus", "precio": 90000, "precio_anterior": 130000 }
        ]
      },
      {
        "id": "windows-10-y-11-pro-y-home",
        "tipo": "licencias", "marca": "Microsoft",
        "nombre": "Windows 10 y 11 Pro / Home",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/1000062604-dd415254400244ab9417680313695120-640-0.webp",
        "variantes": [
          { "nombre": "Windows 10 Pro Licencia", "precio": 70000, "precio_anterior": 120000 },
          { "nombre": "Windows 11 Pro Licencia", "precio": 80000, "precio_anterior": 140000 }
        ]
      },
      {
        "id": "gemini-ia-pro",
        "tipo": "licencias", "marca": "Google",
        "nombre": "Gemini IA Pro",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-54-17aa51c0fc27f7b51717566943436178-640-0.webp",
        "variantes": [{ "nombre": "Suscripción 1 Mes", "precio": 28000, "precio_anterior": 70000 }]
      },
      {
        "id": "pin-virtual-disney-plus-1tpu5",
        "tipo": "pines", "marca": "Disney",
        "nombre": "PIN Virtual Disney Plus",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-08-05t225121-178-fcafa0f7243b64a4e517859883063919-640-0.webp",
        "variantes": [
          { "nombre": "PIN de $25.900", "precio": 25900, "precio_anterior": null },
          { "nombre": "PIN de $36.900", "precio": 36900, "precio_anterior": null },
          { "nombre": "PIN de $54.900", "precio": 54900, "precio_anterior": null }
        ]
      },
      {
        "id": "pin-virtual-netflix",
        "tipo": "pines", "marca": "Netflix",
        "nombre": "PIN Virtual Netflix Colombia",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-07-25t230306-675-e59d09cb99d572efd717850386081961-640-0.webp",
        "variantes": [
          { "nombre": "PIN de $20.000", "precio": 20000, "precio_anterior": null },
          { "nombre": "PIN de $30.000", "precio": 30000, "precio_anterior": null },
          { "nombre": "PIN de $35.000", "precio": 35000, "precio_anterior": null },
          { "nombre": "PIN de $50.000", "precio": 50000, "precio_anterior": null }
        ]
      },
      {
        "id": "pin-virtual-directv-go",
        "tipo": "pines", "marca": "Directv",
        "nombre": "PIN Virtual Directv Go",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-07-25t214500-060-855f015f5c5735ec7417850339071276-640-0.webp",
        "variantes": [
          { "nombre": "PIN de $64.000", "precio": 64000, "precio_anterior": null },
          { "nombre": "PIN de $79.900", "precio": 79900, "precio_anterior": null },
          { "nombre": "PIN de $102.900", "precio": 102900, "precio_anterior": null }
        ]
      },
      {
        "id": "pin-virtual-win-play",
        "tipo": "pines", "marca": "Win Play",
        "nombre": "PIN Virtual Win Play",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-07-25t214417-236-5b6b496bb9a900387817850338654391-640-0.webp",
        "variantes": [{ "nombre": "PIN 1 Mes ($39.900)", "precio": 39900, "precio_anterior": null }]
      },
      {
        "id": "pin-virtual-vix",
        "tipo": "pines", "marca": "Vix",
        "nombre": "PIN Virtual Vix",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-07-25t214307-034-4b2b164dcfa777bf7317850337973553-640-0.webp",
        "variantes": [{ "nombre": "PIN de $22.900", "precio": 22900, "precio_anterior": null }]
      },
      {
        "id": "pin-virtual-deezer",
        "tipo": "pines", "marca": "Deezer",
        "nombre": "PIN Virtual Deezer",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-07-25t214214-093-3f4658a80701f1ff6017850337398853-640-0.webp",
        "variantes": [{ "nombre": "PIN de $19.500", "precio": 19500, "precio_anterior": null }]
      },
      {
        "id": "pin-google-play",
        "tipo": "pines", "marca": "Google Play",
        "nombre": "PIN Virtual Google Play",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-07-25t221452-314-511c9925f767810a1417850358454071-640-0.webp",
        "variantes": [
          { "nombre": "PIN de $10.000", "precio": 10000, "precio_anterior": null },
          { "nombre": "PIN de $30.000", "precio": 30000, "precio_anterior": null },
          { "nombre": "PIN de $50.000", "precio": 50000, "precio_anterior": null }
        ]
      },
      {
        "id": "pin-virtual-roblox",
        "tipo": "pines", "marca": "Roblox",
        "nombre": "PIN Virtual Roblox",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-07-25t214108-104-f8cd5b922136803efb17850336744052-640-0.webp",
        "variantes": [
          { "nombre": "PIN de $25.000", "precio": 25000, "precio_anterior": null },
          { "nombre": "PIN de $50.000", "precio": 50000, "precio_anterior": null },
          { "nombre": "PIN de $100.000", "precio": 100000, "precio_anterior": null }
        ]
      },
      {
        "id": "pin-virtual-razer-gold",
        "tipo": "pines", "marca": "Razer",
        "nombre": "PIN Virtual Razer Gold",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-07-25t215123-060-6394e99cdc8ffec1be17850342897501-640-0.webp",
        "variantes": [
          { "nombre": "PIN de $39.000", "precio": 39000, "precio_anterior": null },
          { "nombre": "PIN de $64.000", "precio": 64000, "precio_anterior": null },
          { "nombre": "PIN de $113.000", "precio": 113000, "precio_anterior": null }
        ]
      },
      {
        "id": "pin-virtual-imvu",
        "tipo": "pines", "marca": "IMVU",
        "nombre": "PIN Virtual IMVU",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-07-25t213332-080-79104d967af9fc67bb17850332587866-640-0.webp",
        "variantes": [
          { "nombre": "PIN de $24.000", "precio": 24000, "precio_anterior": null },
          { "nombre": "PIN de $48.000", "precio": 48000, "precio_anterior": null }
        ]
      },
      {
        "id": "directv-prepago-4s7gd",
        "tipo": "recargas", "marca": "Directv",
        "nombre": "DirecTV Prepago Recarga Directa",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-07-25t231938-128-24edfb96645621acb017850397301376-640-0.webp",
        "variantes": [
          { "nombre": "Saldo $12.000", "precio": 12000, "precio_anterior": null },
          { "nombre": "Saldo $20.000", "precio": 20000, "precio_anterior": null },
          { "nombre": "Saldo $30.000", "precio": 30000, "precio_anterior": null },
          { "nombre": "Saldo $50.000", "precio": 50000, "precio_anterior": null }
        ]
      },
      {
        "id": "free-fire-diamantes-vwx2s",
        "tipo": "recargas", "marca": "Free Fire",
        "nombre": "Free Fire Diamantes Directo",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-07-25t231212-297-36aa344724da05d45217850391442750-640-0.webp",
        "variantes": [
          { "nombre": "100 Diamantes ($4.200)", "precio": 4200, "precio_anterior": null },
          { "nombre": "310 Diamantes ($12.000)", "precio": 12000, "precio_anterior": null },
          { "nombre": "520 Diamantes ($19.600)", "precio": 19600, "precio_anterior": null },
          { "nombre": "1060 Diamantes ($38.600)", "precio": 38600, "precio_anterior": null }
        ]
      },
      {
        "id": "recargas-claro",
        "tipo": "recargas", "marca": "Claro",
        "nombre": "Recargas Móvil Claro",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-08-09t154051-697-0376254c21e77e4fb917863088460828-640-0.webp",
        "variantes": [
          { "nombre": "Saldo $5.000", "precio": 5000, "precio_anterior": null },
          { "nombre": "Saldo $10.000", "precio": 10000, "precio_anterior": null },
          { "nombre": "Saldo $20.000", "precio": 20000, "precio_anterior": null },
          { "nombre": "Saldo $50.000", "precio": 50000, "precio_anterior": null }
        ]
      },
      {
        "id": "recarga-betsson",
        "tipo": "recargas", "marca": "Betsson",
        "nombre": "Recarga Betsson Apuestas",
        "imagen": "https://acdn-us.mitiendanube.com/stores/004/384/271/products/diseno-sin-titulo-2026-08-09t163238-179-7c9b4bbed66ed5005e17863111630901-640-0.webp",
        "variantes": [
          { "nombre": "Saldo $10.000", "precio": 10000, "precio_anterior": null },
          { "nombre": "Saldo $20.000", "precio": 20000, "precio_anterior": null },
          { "nombre": "Saldo $50.000", "precio": 50000, "precio_anterior": null }
        ]
      }
    ];

    // Formateador seguro de pesos colombianos
    const formatearPrecio = (valor) => {
        let num = parseFloat(valor);
        if (isNaN(num) || num === null || num === undefined) num = 0;
        return new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: 'COP',
            minimumFractionDigits: 0
        }).format(num);
    };

    // Auto-categorizador por si algún item no lo trae
    const clasificarCategoria = (prod) => {
        if (prod.tipo && prod.tipo !== "digital") return prod.tipo;
        const id = (prod.id || '').toLowerCase();
        if (id.includes('reloj') || id.includes('smartwatch') || id.includes('diadema') || id.includes('auricular') || id.includes('powerbank')) return 'tecnologia';
        if (id.includes('pin')) return 'pines';
        if (id.includes('recarga') || id.includes('free-fire') || id.includes('directv-prepago')) return 'recargas';
        if (id.includes('office') || id.includes('windows') || id.includes('canva') || id.includes('capcut') || id.includes('duolingo') || id.includes('mcafee') || id.includes('gemini')) return 'licencias';
        return 'streaming';
    };

    // Renderizar tarjetas
    const renderizarProductos = (productos) => {
        productCount.textContent = `${productos.length} Productos`;
        productGrid.innerHTML = ''; 

        if (productos.length === 0) {
            productGrid.innerHTML = `
                <div class="col-span-full text-center py-16 text-gray-500">
                    <span class="text-4xl block mb-2">🔎</span>
                    <p class="font-bold">No se encontraron productos en esta sección.</p>
                </div>`;
            return;
        }

        productos.forEach(prod => {
            const varBase = (prod.variantes && prod.variantes.length > 0) 
                ? prod.variantes[0] 
                : { precio: 0, precio_anterior: null };

            const precioNum = parseFloat(varBase.precio) || 0;
            const precioAntNum = parseFloat(varBase.precio_anterior) || 0;
            const tieneDescuento = precioAntNum > precioNum;

            let badgeDescuento = '';
            if (tieneDescuento) {
                const pct = Math.round(((precioAntNum - precioNum) / precioAntNum) * 100);
                badgeDescuento = `<div class="absolute top-3 left-3 bg-dcRed text-white text-[10px] font-black px-2.5 py-1 rounded-full z-10 shadow-md">-${pct}% OFF</div>`;
            }

            const card = document.createElement('div');
            card.className = 'card-3d rounded-3xl p-5 flex flex-col justify-between cursor-pointer relative group';
            card.onclick = () => abrirModal(prod);

            card.innerHTML = `
                ${badgeDescuento}
                <div class="relative overflow-hidden mb-4 h-44 flex items-center justify-center bg-white rounded-2xl p-3 border border-gray-200">
                    <img src="${prod.imagen || 'https://via.placeholder.com/300'}" alt="${prod.nombre}" class="max-h-full object-contain group-hover:scale-105 transition-transform duration-300">
                </div>
                <div class="flex-grow flex flex-col text-left">
                    <span class="text-[10px] uppercase text-dcRed font-black tracking-widest mb-1">${prod.marca || "DC Technology"}</span>
                    <h3 class="text-xs md:text-sm font-bold text-white mb-2 line-clamp-2 leading-snug">${prod.nombre}</h3>
                    <div class="mt-auto mb-4">
                        ${tieneDescuento ? `<span class="text-gray-500 line-through text-xs mr-2">${formatearPrecio(precioAntNum)}</span>` : ''}
                        <strong class="text-lg md:text-xl font-black text-dcRed block">${prod.variantes && prod.variantes.length > 1 ? '<span class="text-xs text-gray-400 font-normal">Desde </span>' : ''}${formatearPrecio(precioNum)}</strong>
                    </div>
                </div>
                <button class="w-full bg-[#1A1D2B] hover:bg-dcRed text-white font-bold py-3 rounded-2xl text-xs transition-colors shadow-md">
                    Ver Opciones
                </button>
            `;
            productGrid.appendChild(card);
        });
    };

    // Modal
    const abrirModal = (prod) => {
        productoSeleccionado = prod;
        varianteSeleccionada = prod.variantes[0];

        document.getElementById('modal-img').src = prod.imagen;
        document.getElementById('modal-brand').textContent = prod.marca || "DC Technology";
        document.getElementById('modal-title').textContent = prod.nombre;

        renderizarVariantesModal();
        actualizarPreciosModal();

        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            modalBox.classList.remove('scale-95');
            modalBox.classList.add('scale-100');
        }, 10);
    };

    const cerrarModal = () => {
        modal.classList.add('opacity-0');
        modalBox.classList.remove('scale-100');
        modalBox.classList.add('scale-95');
        setTimeout(() => modal.classList.add('hidden'), 300);
    };

    closeModal.onclick = cerrarModal;
    modal.onclick = (e) => { if (e.target === modal) cerrarModal(); };

    const obtenerNombreVarianteLimpio = (v, index, total) => {
        let nombre = v.nombre;
        if (!nombre || nombre === "Única") {
            const cat = clasificarCategoria(productoSeleccionado);
            if (cat === "recargas" || cat === "pines") {
                return `Monto / Saldo (${formatearPrecio(v.precio)})`;
            }
            if (total > 1) {
                return `Plan ${index + 1} (${formatearPrecio(v.precio)})`;
            }
            return "Opción Estándar";
        }
        return nombre;
    };

    const renderizarVariantesModal = () => {
        const modalVariants = document.getElementById('modal-variants');
        modalVariants.innerHTML = '';

        const totalVars = productoSeleccionado.variantes.length;

        productoSeleccionado.variantes.forEach((v, idx) => {
            const labelNombre = obtenerNombreVarianteLimpio(v, idx, totalVars);
            const isActive = v === varianteSeleccionada;

            const btn = document.createElement('button');
            btn.className = `w-full text-left p-3 rounded-xl border-2 flex justify-between items-center transition-all ${isActive ? 'border-dcRed bg-dcRed/10 text-dcRed font-black' : 'border-gray-800 text-gray-400 hover:border-gray-700'}`;

            btn.innerHTML = `
                <div class="flex items-center gap-2.5">
                    <div class="w-4 h-4 rounded-full border-2 flex items-center justify-center ${isActive ? 'border-dcRed bg-dcRed' : 'border-gray-600'}">
                        ${isActive ? '<div class="w-1.5 h-1.5 bg-white rounded-full"></div>' : ''}
                    </div>
                    <span class="text-xs font-bold">${labelNombre}</span>
                </div>
                <span class="text-xs font-black">${formatearPrecio(v.precio)}</span>
            `;

            btn.onclick = () => {
                varianteSeleccionada = v;
                renderizarVariantesModal();
                actualizarPreciosModal();
            };
            modalVariants.appendChild(btn);
        });
    };

    const actualizarPreciosModal = () => {
        const pNum = parseFloat(varianteSeleccionada.precio) || 0;
        const pAntNum = parseFloat(varianteSeleccionada.precio_anterior) || 0;

        document.getElementById('modal-price').textContent = formatearPrecio(pNum);

        const oldPriceEl = document.getElementById('modal-old-price');
        const savingsEl = document.getElementById('modal-savings');
        const badgeEl = document.getElementById('modal-discount-badge');

        if (pAntNum > pNum) {
            const ahorro = pAntNum - pNum;
            const pct = Math.round((ahorro / pAntNum) * 100);

            oldPriceEl.textContent = formatearPrecio(pAntNum);
            savingsEl.textContent = `¡Ahorras ${formatearPrecio(ahorro)}!`;
            badgeEl.textContent = `-${pct}% OFF`;

            oldPriceEl.classList.remove('hidden');
            savingsEl.classList.remove('hidden');
            badgeEl.classList.remove('hidden');
        } else {
            oldPriceEl.classList.add('hidden');
            savingsEl.classList.add('hidden');
            badgeEl.classList.add('hidden');
        }
    };

    // Redirección WhatsApp
    document.getElementById('btn-whatsapp').onclick = () => {
        const totalVars = productoSeleccionado.variantes.length;
        const idx = productoSeleccionado.variantes.indexOf(varianteSeleccionada);
        const varianteNombre = obtenerNombreVarianteLimpio(varianteSeleccionada, idx, totalVars);

        const mensaje = `Hola DC Technology! 👋🏼 Deseo adquirir:\n\n📌 *Producto:* ${productoSeleccionado.nombre}\n⚙️ *Opción:* ${varianteNombre}\n💰 *Valor:* ${formatearPrecio(varianteSeleccionada.precio)}\n\n¿Me indican las instrucciones para realizar el pago vía Nequi / Daviplata / Bancolombia?`;
        
        window.open(`https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensaje)}`, '_blank');
    };

    // Intentar cargar JSON local/servidor; si falla por CORS local, usar RAW_PRODUCTOS automáticamente
    fetch('productos.json')
        .then(res => res.json())
        .then(data => {
            todosLosProductos = data.map(p => ({ ...p, tipo: clasificarCategoria(p) }));
            renderizarProductos(todosLosProductos);
        })
        .catch(err => {
            console.log("Carga de productos.json omitida por bloqueo CORS local. Usando base de datos interna de respaldo.");
            todosLosProductos = RAW_PRODUCTOS.map(p => ({ ...p, tipo: clasificarCategoria(p) }));
            renderizarProductos(todosLosProductos);
        });

    // Filtros
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => {
                b.classList.remove('bg-dcRed', 'text-white', 'font-black', 'shadow-lg');
                b.classList.add('text-gray-400');
            });

            const target = e.currentTarget;
            target.classList.add('bg-dcRed', 'text-white', 'font-black', 'shadow-lg');
            target.classList.remove('text-gray-400');

            const filtro = target.getAttribute('data-filter');
            categoryTitle.textContent = target.textContent.replace(/🔥|💻|🎬|🔑|🎮|💸|VER|→/g, '').trim();

            if (filtro === 'todos') {
                renderizarProductos(todosLosProductos);
            } else {
                const filtrados = todosLosProductos.filter(p => p.tipo === filtro);
                renderizarProductos(filtrados);
            }
        });
    });

    // Buscador
    searchInput.addEventListener('keyup', (e) => {
        const query = e.target.value.toLowerCase();
        const filtrados = todosLosProductos.filter(p => p.nombre.toLowerCase().includes(query) || (p.marca && p.marca.toLowerCase().includes(query)));
        categoryTitle.textContent = "Resultados de Búsqueda";
        renderizarProductos(filtrados);
    });
});