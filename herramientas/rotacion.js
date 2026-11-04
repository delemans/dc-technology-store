// herramientas/rotacion.js — Qué video sale cada día en estados de WhatsApp (publicar-estado.mjs) y redes (generar_redes.js).
// 04/11/2026: el director vio el mismo tema dos días seguidos (reparación el 3 y el 4/11; mantenimiento el 28/10 y el 2/11)
// porque cada campaña repetía temas y nada miraba lo ya publicado. Reglas:
//   · el orden de la campaña de la semana manda (se empieza por el video del día);
//   · no se repite un VIDEO publicado hace menos de DIAS_VIDEO días;
//   · no se repite un TEMA (estados-plan.json → videos[].tema) publicado hace menos de DIAS_TEMA días;
//   · si todo choca, sale el que lleva más tiempo sin salir (respetando el tema si se puede; nunca se queda sin publicar).
const DIAS_VIDEO = 28;
const DIAS_TEMA = 3;

const dia = (f) => Date.parse(`${String(f).slice(0, 10)}T12:00:00-05:00`) / 864e5;
const temaDe = (plan, id) => plan.videos.find((v) => v.archivo === id)?.tema ?? id;

// Id del video a partir del archivo publicado («403-srv-reparacion-charon.mp4» → «srv-reparacion»)
function idDeArchivo(plan, archivo) {
    const ids = plan.videos.map((v) => v.archivo).sort((a, b) => b.length - a.length);
    return ids.find((id) => new RegExp(`^(\\d+-)?${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-[a-z]+)?\\.mp4$`).test(archivo)) ?? null;
}

/**
 * @param plan       estados-plan.json
 * @param campana    campaña de la semana
 * @param diaCampana 0–6
 * @param historial  [{ fecha: 'AAAA-MM-DD', video?: id, archivo?: nombre }] lo ya publicado (o planeado antes)
 * @param hoy        'AAAA-MM-DD'
 * @param disponible (id) => true si hay un MP4 utilizable
 */
function elegirVideo({ plan, campana, diaCampana, historial, hoy, disponible = () => true }) {
    const orden = [...campana.videos.slice(diaCampana), ...campana.videos.slice(0, diaCampana)].filter(disponible);
    if (!orden.length) return null;
    const hace = (h) => dia(hoy) - dia(h.fecha);
    const previos = historial.map((h) => ({ ...h, video: h.video ?? (h.archivo ? idDeArchivo(plan, h.archivo) : null) }))
        .filter((h) => h.video && hace(h) > 0);
    const videoReciente = new Set(previos.filter((h) => hace(h) < DIAS_VIDEO).map((h) => h.video));
    const temaReciente = new Set(previos.filter((h) => hace(h) < DIAS_TEMA).map((h) => temaDe(plan, h.video)));
    const ultimaVez = (id) => Math.max(-1e9, ...previos.filter((h) => h.video === id).map((h) => dia(h.fecha)));
    const masViejo = (lista) => lista.reduce((a, id) => (ultimaVez(id) < ultimaVez(a) ? id : a));
    const sinTema = orden.filter((id) => !temaReciente.has(temaDe(plan, id)));
    return orden.find((id) => !videoReciente.has(id) && !temaReciente.has(temaDe(plan, id)))
        ?? (sinTema.length ? masViejo(sinTema) : masViejo(orden)); // todo salió hace poco: el que lleva más tiempo sin salir
}

module.exports = { elegirVideo, idDeArchivo, temaDe, DIAS_VIDEO, DIAS_TEMA };
