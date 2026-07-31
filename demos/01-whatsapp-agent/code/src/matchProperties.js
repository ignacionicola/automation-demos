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

function aPesos(precio, moneda) {
  return moneda === 'USD' ? precio * USD_TO_ARS : precio;
}

/** Devuelve el tope de presupuesto en pesos, o null si el cliente no lo dijo. */
function presupuestoEnPesos(criterios) {
  const monto = criterios.presupuesto;
  if (typeof monto !== 'number' || !Number.isFinite(monto) || monto <= 0) return null;
  return aPesos(monto, criterios.moneda === 'USD' ? 'USD' : 'ARS');
}

function cumpleFiltros(propiedad, criterios, nivel) {
  if (criterios.operacion && normalizarTexto(propiedad.operacion) !== normalizarTexto(criterios.operacion)) {
    return false;
  }
  if (criterios.tipo && normalizarTexto(propiedad.tipo) !== normalizarTexto(criterios.tipo)) {
    return false;
  }
  if (!nivel.ignorarBarrio && criterios.barrio && normalizarTexto(propiedad.barrio) !== normalizarTexto(criterios.barrio)) {
    return false;
  }
  if (typeof criterios.dormitorios === 'number' && propiedad.dormitorios < criterios.dormitorios) {
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

  if (criterios.barrio && normalizarTexto(propiedad.barrio) === normalizarTexto(criterios.barrio)) {
    puntos += 40;
  }
  if (criterios.tipo && normalizarTexto(propiedad.tipo) === normalizarTexto(criterios.tipo)) {
    puntos += 20;
  }
  if (typeof criterios.dormitorios === 'number') {
    puntos += propiedad.dormitorios === criterios.dormitorios ? 20 : 8;
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
 * @param {object} criterios  { operacion, tipo, barrio, dormitorios, presupuesto, moneda }
 * @param {Array}  propiedades catálogo completo
 * @returns {{resultados: Array, nivel: string, total: number}}
 */
function matchProperties(criterios, propiedades) {
  const filtros = criterios && typeof criterios === 'object' ? criterios : {};
  const catalogo = Array.isArray(propiedades) ? propiedades : [];

  for (const nivel of NIVELES_DE_BUSQUEDA) {
    const encontradas = catalogo.filter((propiedad) => cumpleFiltros(propiedad, filtros, nivel));
    if (encontradas.length === 0) continue;

    const ordenadas = encontradas
      .map((propiedad) => ({ ...propiedad, puntaje: puntuar(propiedad, filtros) }))
      // Desempate por id para que el resultado sea determinístico.
      .sort((a, b) => b.puntaje - a.puntaje || a.id.localeCompare(b.id))
      .slice(0, MAX_RESULTADOS);

    return { resultados: ordenadas, nivel: nivel.etiqueta, total: encontradas.length };
  }

  return { resultados: [], nivel: 'sin_resultados', total: 0 };
}

module.exports = { matchProperties, normalizarTexto, aPesos, USD_TO_ARS, MAX_RESULTADOS };
