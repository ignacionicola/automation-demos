/**
 * Valida la salida del LLM antes de dejarla entrar al ruteo. Nunca confiamos
 * en que el modelo devolvió exactamente lo que le pedimos — sea cual sea el
 * proveedor configurado.
 */
const { extractLlmText } = require('./llmProviders');

const INTENTS_VALIDOS = ['consulta_propiedad', 'agendar_visita', 'consulta_general', 'derivar_humano'];
const CONFIANZA_MINIMA = 0.6;

// Tope para no volcar respuestas gigantes al log ni al item de n8n.
const LARGO_MAXIMO_DEBUG = 4000;

function truncar(texto) {
  if (typeof texto !== 'string') return texto;
  return texto.length > LARGO_MAXIMO_DEBUG ? texto.slice(0, LARGO_MAXIMO_DEBUG) + '… (truncado)' : texto;
}

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
 * @returns {{intent: string, confianza: number, entidades: object, motivoDerivacion: string|null, textoCrudo: string|null}}
 */
function parseClassification(opciones) {
  const datos = opciones || {};
  const texto = extractLlmText(datos.proveedor, datos.respuestaCruda);
  const parseado = extraerJson(texto);

  let intent = parseado ? parseado.intent : null;
  let confianza = parseado && typeof parseado.confianza === 'number' ? parseado.confianza : 0;
  let motivoDerivacion = null;
  // Solo se llena cuando el JSON no se pudo interpretar: es lo único que hace
  // falta ver para debuggear (el prompt y la config ya quedan en los nodos
  // anteriores). null en el resto de los casos para no inflar cada item.
  let textoCrudo = null;

  if (!parseado) {
    intent = 'derivar_humano';
    confianza = 0;
    motivoDerivacion = 'El clasificador devolvió una respuesta que no se pudo interpretar';
    textoCrudo = truncar(texto === null || texto === undefined ? '(sin texto extraído de la respuesta)' : texto);
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

  // Lo que el modelo escuchó en la nota de voz. Solo viene cuando el mensaje
  // era audio; en texto queda en null y el resto del flujo usa el texto original.
  const transcripcion =
    parseado && typeof parseado.transcripcion === 'string' && parseado.transcripcion.trim()
      ? parseado.transcripcion.trim()
      : null;

  return {
    intent,
    confianza,
    entidades: (parseado && parseado.entidades) || {},
    transcripcion,
    motivoDerivacion,
    textoCrudo,
  };
}

module.exports = { parseClassification, extraerJson, INTENTS_VALIDOS, CONFIANZA_MINIMA };
