/**
 * Resolución de consultas generales contra el set de preguntas frecuentes.
 *
 * Deliberadamente no usa el LLM: para las FAQ alcanza con un matching por
 * palabras clave, es instantáneo, no cuesta tokens y da siempre la misma
 * respuesta (que es lo que la inmobiliaria quiere para datos como comisiones
 * o requisitos). Si no hay confianza suficiente, deriva a un humano.
 */

const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

// Debajo de este puntaje se considera que no entendimos la consulta.
const UMBRAL_CONFIANZA = 1;

// Palabras demasiado comunes como para aportar señal.
const VACIAS = new Set([
  'que', 'cual', 'cuales', 'como', 'donde', 'cuando', 'cuanto', 'cuanta',
  'para', 'por', 'con', 'sin', 'los', 'las', 'una', 'uno', 'del', 'the',
  'hola', 'buenas', 'gracias', 'porfa', 'favor', 'quiero', 'saber', 'decir',
]);

function normalizar(texto) {
  if (typeof texto !== 'string') return '';
  return texto.normalize('NFD').replace(DIACRITICOS, '').toLowerCase().trim();
}

function tokenizar(texto) {
  return normalizar(texto)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((palabra) => palabra.length > 2 && !VACIAS.has(palabra));
}

function puntuarEntrada(entrada, tokens) {
  const claves = (entrada.claves || []).map(normalizar);
  const enPregunta = tokenizar(entrada.pregunta);

  let puntos = 0;
  for (const token of tokens) {
    // Una clave explícita vale más que coincidir con el texto de la pregunta.
    if (claves.some((clave) => clave === token || clave.includes(token))) puntos += 2;
    else if (enPregunta.includes(token)) puntos += 1;
  }
  return puntos;
}

/**
 * @param {string} mensaje texto del cliente
 * @param {Array} faq entradas de faq.json
 * @param {{agencia?: string}} contexto
 * @returns {{encontrada: boolean, id: string|null, respuesta: string, puntaje: number, derivar: boolean}}
 */
function answerFaq(mensaje, faq, contexto) {
  const agencia = (contexto && contexto.agencia) || 'la inmobiliaria';
  const entradas = Array.isArray(faq) ? faq : [];
  const tokens = tokenizar(mensaje);

  const puntuadas = entradas
    .map((entrada) => ({ entrada, puntaje: puntuarEntrada(entrada, tokens) }))
    // Desempate por id para que sea determinístico.
    .sort((a, b) => b.puntaje - a.puntaje || a.entrada.id.localeCompare(b.entrada.id));

  const mejor = puntuadas[0];

  if (!mejor || mejor.puntaje < UMBRAL_CONFIANZA) {
    return {
      encontrada: false,
      id: null,
      puntaje: mejor ? mejor.puntaje : 0,
      derivar: true,
      respuesta: [
        `Mmm, esa no la tengo respondida acá 🤔`,
        '',
        `Le paso tu consulta a un asesor de ${agencia} para que te conteste bien. En un rato te escriben por acá.`,
        '',
        'Mientras tanto, si querés te puedo ayudar a buscar propiedades en alquiler o venta, o coordinar una visita.',
      ].join('\n'),
    };
  }

  return {
    encontrada: true,
    id: mejor.entrada.id,
    puntaje: mejor.puntaje,
    derivar: false,
    respuesta: `${mejor.entrada.respuesta}\n\n¿Te quedó alguna otra duda? Estoy para ayudarte 😊`,
  };
}

module.exports = { answerFaq, tokenizar, normalizar, UMBRAL_CONFIANZA };
