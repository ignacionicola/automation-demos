/**
 * Matching de propiedades contra los criterios extraídos del mensaje del cliente.
 *
 * Es una función pura: recibe el catálogo por parámetro y no lee archivos ni
 * variables globales. Eso permite testearla con `node --test` y, al mismo
 * tiempo, inyectarla tal cual dentro de un Code node de n8n
 * (ver ../scripts/build-workflow.js).
 */

// Cotización de referencia para comparar propiedades en USD contra
// presupuestos en pesos. Es un valor de demo: en producción esto sale de una
// API de cotización o de una variable de entorno.
const USD_TO_ARS = 1450;

const MAX_RESULTADOS = 3;

// Si no hay match exacto, se van soltando restricciones en este orden en vez
// de responderle al cliente "no encontré nada".
const NIVELES_DE_BUSQUEDA = [
  { etiqueta: 'exacto', ignorarBarrio: false, toleranciaPresupuesto: 0 },
  { etiqueta: 'sin_barrio', ignorarBarrio: true, toleranciaPresupuesto: 0 },
  { etiqueta: 'presupuesto_ampliado', ignorarBarrio: true, toleranciaPresupuesto: 0.15 },
];

// Rango de tildes/diacríticos combinantes (U+0300 a U+036F). Se construye con
// new RegExp para que el archivo quede en ASCII puro y no dependa de cómo se
// guarde la codificación al inyectarlo en el Code node de n8n.
const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

function normalizarTexto(valor) {
  if (typeof valor !== 'string') return '';
  return valor.normalize('NFD').replace(DIACRITICOS, '').toLowerCase().trim();
}

/**
 * Compara barrios ignorando el "Barrio" de adelante.
 *
 * Hace falta porque el nombre propio a veces lo incluye ("Barrio Norte" en Río
 * Tercero) y a veces no ("Las Flores"), mientras que el cliente escribe
 * cualquiera de las dos formas. Sin esto, "tenés en barrio norte" no matchea
 * con "Barrio Norte", y "en Las Flores" no matchea si el modelo devuelve
 * "Barrio Las Flores".
 */
function normalizarBarrio(valor) {
  return normalizarTexto(valor).replace(/^barrio\s+/, '');
}

function aPesos(precio, moneda) {
  return moneda === 'USD' ? precio * USD_TO_ARS : precio;
}

/** Devuelve el tope de presupuesto en pesos, o null si el cliente no lo dijo. */
function presupuestoEnPesos(criterios) {
  const monto = criterios.presupuesto;
  if (typeof monto !== 'number' || !Number.isFinite(monto) || monto <= 0) return null;
  return aPesos(monto, criterios.moneda === 'USD' ? 'USD' : 'ARS');
}

/**
 * Todo el texto de una propiedad en el que tiene sentido buscar por nombre.
 *
 * Las inmobiliarias bautizan las propiedades ("la casa del molino", "el dúplex
 * de la esquina") y el cliente pregunta por ese nombre, no por metros
 * cuadrados. Sin esto, "la casa de Messi tenés?" no encuentra la propiedad
 * titulada exactamente así.
 */
function textoBuscable(propiedad) {
  const destacados = Array.isArray(propiedad.destacados) ? propiedad.destacados.join(' ') : '';
  return normalizarTexto(
    [propiedad.id, propiedad.titulo, propiedad.descripcion, propiedad.barrio, propiedad.direccion, destacados]
      .filter(Boolean)
      .join(' '),
  );
}

// Palabras que aparecen en cualquier consulta y no distinguen una propiedad de
// otra: si "casa" contara, "la casa de Messi" matchearía con todas las casas.
const PALABRAS_SIN_VALOR = new Set([
  'casa', 'departamento', 'depto', 'ph', 'local', 'propiedad', 'inmueble',
  'alquiler', 'venta', 'alquilar', 'comprar', 'tenes', 'tienen', 'hay',
  'una', 'uno', 'del', 'los', 'las', 'con', 'para', 'por', 'que', 'the',
]);

/**
 * ¿La propiedad responde a lo que el cliente nombró?
 *
 * Alcanza con que aparezca una palabra con contenido: el cliente escribe "la
 * casa de Messi" y el título es "Casa de Messi", así que exigir la frase
 * entera fallaría por cualquier artículo de más.
 */
function coincideConTexto(propiedad, texto) {
  const palabras = normalizarTexto(texto)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((palabra) => palabra.length > 2 && !PALABRAS_SIN_VALOR.has(palabra));

  if (palabras.length === 0) return true;

  const buscable = textoBuscable(propiedad);
  return palabras.some((palabra) => buscable.includes(palabra));
}

function cumpleFiltros(propiedad, criterios, nivel) {
  // Cuando el cliente nombra una propiedad, ese nombre manda: es lo único que
  // pidió, y arrastrarle los filtros de la búsqueda anterior es lo que hacía
  // que "la casa de Messi" devolviera dos casas cualquiera.
  if (criterios.busqueda_libre) {
    return coincideConTexto(propiedad, criterios.busqueda_libre);
  }
  if (criterios.operacion && normalizarTexto(propiedad.operacion) !== normalizarTexto(criterios.operacion)) {
    return false;
  }
  if (criterios.tipo && normalizarTexto(propiedad.tipo) !== normalizarTexto(criterios.tipo)) {
    return false;
  }
  // La ciudad no se relaja en ningún nivel, a diferencia del barrio: quien
  // pregunta por Río Tercero no quiere ver algo en Córdoba capital, a 100 km.
  // Si no hay nada en su ciudad, es preferible decirlo y ofrecer un asesor.
  if (criterios.ciudad && normalizarTexto(propiedad.ciudad) !== normalizarTexto(criterios.ciudad)) {
    return false;
  }
  if (!nivel.ignorarBarrio && criterios.barrio && normalizarBarrio(propiedad.barrio) !== normalizarBarrio(criterios.barrio)) {
    return false;
  }
  // Dormitorios y baños se interpretan como mínimos: quien pide 2 dormitorios
  // acepta uno de 3, pero no uno de 1.
  if (typeof criterios.dormitorios === 'number' && propiedad.dormitorios < criterios.dormitorios) {
    return false;
  }
  if (typeof criterios.banios === 'number' && propiedad.banios < criterios.banios) {
    return false;
  }

  const tope = presupuestoEnPesos(criterios);
  if (tope !== null) {
    const limite = tope * (1 + nivel.toleranciaPresupuesto);
    if (aPesos(propiedad.precio, propiedad.moneda) > limite) return false;
  }

  return true;
}

/**
 * Puntaje de relevancia. Premia el match exacto de barrio y dormitorios, y
 * que la propiedad aproveche el presupuesto sin pasarse.
 */
function puntuar(propiedad, criterios) {
  let puntos = 0;

  if (criterios.barrio && normalizarBarrio(propiedad.barrio) === normalizarBarrio(criterios.barrio)) {
    puntos += 40;
  }
  if (criterios.tipo && normalizarTexto(propiedad.tipo) === normalizarTexto(criterios.tipo)) {
    puntos += 20;
  }
  if (typeof criterios.dormitorios === 'number') {
    puntos += propiedad.dormitorios === criterios.dormitorios ? 20 : 8;
  }
  if (typeof criterios.banios === 'number') {
    puntos += propiedad.banios === criterios.banios ? 10 : 4;
  }

  const tope = presupuestoEnPesos(criterios);
  if (tope !== null) {
    const precio = aPesos(propiedad.precio, propiedad.moneda);
    if (precio <= tope) puntos += 15;
    // Cuanto más cerca del tope sin pasarse, mejor aprovecha el presupuesto.
    puntos += Math.max(0, 10 - Math.abs(1 - precio / tope) * 10);
  }

  if (propiedad.cochera) puntos += 2;

  return Math.round(puntos * 100) / 100;
}

/**
 * @param {object} criterios  { operacion, tipo, ciudad, barrio, dormitorios,
 *                              banios, presupuesto, moneda, busqueda_libre }
 * @param {Array}  propiedades catálogo completo
 * @param {object} [opciones]  { excluir: string[] } ids ya mostrados, para
 *                             cuando el cliente pide ver las otras
 * @returns {{resultados, nivel, total, totalSinExcluir, agotadas}}
 */
function matchProperties(criterios, propiedades, opciones) {
  const filtros = criterios && typeof criterios === 'object' ? criterios : {};
  const catalogo = Array.isArray(propiedades) ? propiedades : [];
  const excluir = new Set(((opciones || {}).excluir || []).map((id) => normalizarTexto(id)));

  for (const nivel of NIVELES_DE_BUSQUEDA) {
    const encontradas = catalogo.filter((propiedad) => cumpleFiltros(propiedad, filtros, nivel));
    if (encontradas.length === 0) continue;

    // Las ya mostradas se sacan recién acá, después de filtrar: así se puede
    // distinguir "no hay nada que encaje" de "ya te mostré todo lo que hay",
    // que para el cliente son dos respuestas muy distintas.
    const nuevas = encontradas.filter((propiedad) => !excluir.has(normalizarTexto(propiedad.id)));

    const ordenadas = nuevas
      .map((propiedad) => ({ ...propiedad, puntaje: puntuar(propiedad, filtros) }))
      // Desempate por id para que el resultado sea determinístico.
      .sort((a, b) => b.puntaje - a.puntaje || a.id.localeCompare(b.id))
      .slice(0, MAX_RESULTADOS);

    return {
      resultados: ordenadas,
      nivel: nivel.etiqueta,
      total: nuevas.length,
      totalSinExcluir: encontradas.length,
      agotadas: nuevas.length === 0 && excluir.size > 0,
    };
  }

  return { resultados: [], nivel: 'sin_resultados', total: 0, totalSinExcluir: 0, agotadas: false };
}

module.exports = {
  matchProperties,
  coincideConTexto,
  normalizarTexto,
  normalizarBarrio,
  aPesos,
  USD_TO_ARS,
  MAX_RESULTADOS,
};
