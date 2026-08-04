/**
 * Resolución de consultas generales contra el set de preguntas frecuentes.
 *
 * Deliberadamente no usa el LLM: para las FAQ alcanza con un matching por
 * palabras clave, es instantáneo, no cuesta tokens y da siempre la misma
 * respuesta (que es lo que la inmobiliaria quiere para datos como comisiones
 * o requisitos). Si no hay confianza suficiente, deriva a un humano.
 */

const { resolverPlaceholders } = require('./businessConfig');

const DIACRITICOS = new RegExp('[\\u0300-\\u036f]', 'g');

// Debajo de este puntaje se considera que no entendimos la consulta.
const UMBRAL_CONFIANZA = 1;

// Palabras demasiado comunes como para aportar señal.
const VACIAS = new Set([
  'que', 'cual', 'cuales', 'como', 'donde', 'cuando', 'cuanto', 'cuanta',
  'para', 'por', 'con', 'sin', 'los', 'las', 'una', 'uno', 'del', 'the',
  'hola', 'buenas', 'gracias', 'porfa', 'favor', 'quiero', 'saber', 'decir',
]);

// Un saludo no es una pregunta sin responder: es el primer mensaje de casi
// cualquiera. Derivarlo a un humano gasta una persona en contestar "hola".
//
// No se puede resolver agregando una entrada más a faq.json, porque estas
// palabras están en VACIAS y el matcher por palabras clave nunca las ve. El
// texto de la respuesta sí vive allá, en la entrada "faq-saludo".
const SALUDOS = new Set([
  'hola', 'holis', 'buenas', 'buen', 'dia', 'dias', 'tardes', 'noches',
  'tal', 'saludos', 'ey', 'hey', 'che', 'buenass',
]);

const ID_SALUDO = 'faq-saludo';

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

/**
 * ¿El mensaje es solo un saludo? Se pide que haya al menos una palabra de
 * saludo y ninguna palabra con contenido: "hola buenas" sí, "hola, tienen
 * departamentos?" no — eso es una consulta que empieza saludando.
 */
function esSoloSaludo(mensaje) {
  const palabras = normalizar(mensaje)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  return palabras.some((palabra) => SALUDOS.has(palabra)) && tokenizar(mensaje).length === 0;
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
 * @param {Array} faq entradas de faq.json o de la pestaña "faq" de la planilla
 * @param {{agencia?: string, negocio?: object}} contexto
 * @returns {{encontrada: boolean, id: string|null, respuesta: string, puntaje: number, derivar: boolean}}
 */
function answerFaq(mensaje, faq, contexto) {
  const negocio = (contexto && contexto.negocio) || null;
  const agencia = (contexto && contexto.agencia) || (negocio && negocio.nombre) || 'la inmobiliaria';
  // Las respuestas de la planilla pueden traer {{horarios}}, {{direccion}} o
  // {{telefono}}: se completan desde la pestaña "negocio", así cambiar el
  // horario en una celda se propaga a todas las respuestas que lo mencionan.
  const conDatos = (valor) => resolverPlaceholders(valor, negocio);
  const entradas = Array.isArray(faq) ? faq : [];
  const tokens = tokenizar(mensaje);

  const puntuadas = entradas
    .map((entrada) => ({ entrada, puntaje: puntuarEntrada(entrada, tokens) }))
    // Desempate por id para que sea determinístico.
    .sort((a, b) => b.puntaje - a.puntaje || a.entrada.id.localeCompare(b.entrada.id));

  const mejor = puntuadas[0];

  // Antes de darse por vencido: un saludo suelto se contesta saludando y
  // contando qué se puede hacer, que además encamina la conversación.
  const saludo = entradas.find((entrada) => entrada.id === ID_SALUDO);
  if ((!mejor || mejor.puntaje < UMBRAL_CONFIANZA) && saludo && esSoloSaludo(mensaje)) {
    return {
      encontrada: true,
      id: saludo.id,
      puntaje: 0,
      derivar: false,
      respuesta: conDatos(saludo.respuesta),
    };
  }

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
    respuesta: `${conDatos(mejor.entrada.respuesta)}\n\n¿Te quedó alguna otra duda? Estoy para ayudarte 😊`,
  };
}

module.exports = { answerFaq, tokenizar, normalizar, esSoloSaludo, UMBRAL_CONFIANZA };
