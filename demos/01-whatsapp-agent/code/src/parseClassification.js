/**
 * Valida la salida del LLM antes de dejarla entrar al ruteo. Nunca confiamos
 * en que el modelo devolvió exactamente lo que le pedimos — sea cual sea el
 * proveedor configurado.
 */
const { extractLlmText } = require('./llmProviders');

const INTENTS_VALIDOS = ['consulta_propiedad', 'agendar_visita', 'consulta_general', 'derivar_humano'];
const CONFIANZA_MINIMA = 0.6;

function extraerJson(texto) {
  if (typeof texto !== 'string') return null;
  // Por las dudas el modelo lo envuelva en un bloque de markdown.
  const limpio = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
  const desde = limpio.indexOf('{');
  const hasta = limpio.lastIndexOf('}');
  if (desde === -1 || hasta === -1) return null;
  try {
    return JSON.parse(limpio.slice(desde, hasta + 1));
  } catch (error) {
    return null;
  }
}

/**
 * @param {object} opciones { proveedor, respuestaCruda, mensajeVacio }
 * @returns {{intent: string, confianza: number, entidades: object, motivoDerivacion: string|null}}
 */
function parseClassification(opciones) {
  const datos = opciones || {};
  const texto = extractLlmText(datos.proveedor, datos.respuestaCruda);
  const parseado = extraerJson(texto);

  let intent = parseado ? parseado.intent : null;
  let confianza = parseado && typeof parseado.confianza === 'number' ? parseado.confianza : 0;
  let motivoDerivacion = null;

  if (!parseado) {
    intent = 'derivar_humano';
    confianza = 0;
    motivoDerivacion = 'El clasificador devolvió una respuesta que no se pudo interpretar';
  } else if (!INTENTS_VALIDOS.includes(intent)) {
    motivoDerivacion = 'El clasificador devolvió un intent desconocido: ' + String(intent);
    intent = 'derivar_humano';
    confianza = 0;
  } else if (confianza < CONFIANZA_MINIMA) {
    motivoDerivacion = 'Confianza baja del clasificador (' + confianza + ') sobre el intent "' + intent + '"';
    intent = 'derivar_humano';
  } else if (datos.mensajeVacio) {
    motivoDerivacion = 'El cliente mandó un mensaje sin texto (probablemente audio o imagen)';
    intent = 'derivar_humano';
  }

  return {
    intent,
    confianza,
    entidades: (parseado && parseado.entidades) || {},
    motivoDerivacion,
  };
}

module.exports = { parseClassification, extraerJson, INTENTS_VALIDOS, CONFIANZA_MINIMA };
