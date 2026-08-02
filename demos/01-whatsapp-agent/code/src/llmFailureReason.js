/**
 * Traduce el fallo del llamado al LLM a un motivo legible por una persona.
 *
 * Por qué existe: cuando el clasificador falla, el motivo termina dentro del
 * WhatsApp que recibe el dueño de la inmobiliaria. Pegar ahí el `message` crudo
 * del error filtra copy interno de n8n a alguien que no tiene idea de qué es
 * n8n — un 429 de Gemini llega como *"Try spacing your requests out using the
 * batching settings under 'Options'"*, que además le sugiere tocar una
 * configuración que no existe en su mundo.
 *
 * El HTTP node deja el código de estado en `error.status`, así que se mapea eso
 * y el `message` crudo queda solo como último recurso.
 */

const MOTIVO_POR_ESTADO = {
  401: 'la credencial del proveedor fue rechazada',
  403: 'la credencial del proveedor fue rechazada',
  404: 'el modelo configurado ya no está disponible',
  408: 'el proveedor tardó demasiado en responder',
  429: 'se superó el límite de consultas del proveedor',
};

function motivoPorEstado(estado) {
  if (MOTIVO_POR_ESTADO[estado]) return MOTIVO_POR_ESTADO[estado];
  if (estado >= 500 && estado < 600) return 'el proveedor tuvo un error interno';
  if (estado >= 400 && estado < 500) return 'el proveedor rechazó la consulta';
  return null;
}

/**
 * @param {object} fallo el item que llega por la rama de error del HTTP node
 * @param {string} proveedor gemini | anthropic | groq
 * @returns {string} motivo listo para mostrar, sin jerga de n8n
 */
function describeLlmFailure(fallo, proveedor) {
  const error = (fallo && fallo.error) || fallo || {};
  const estado = Number(error.status || error.httpCode || 0);

  // Con el código de estado alcanza: es estable y no arrastra copy de n8n.
  let motivo = motivoPorEstado(estado);

  if (!motivo) {
    // Sin estado, el fallo es de red (DNS, timeout, conexión cortada). El
    // `code` de axios es más corto y estable que el `message`.
    const codigo = String(error.code || '').toUpperCase();
    if (codigo === 'ECONNABORTED' || codigo === 'ETIMEDOUT') {
      motivo = 'el proveedor tardó demasiado en responder';
    } else if (codigo) {
      motivo = 'no se pudo conectar con el proveedor';
    }
  }

  // Último recurso: el mensaje crudo, para no perder información si aparece
  // una forma de error que no previmos.
  if (!motivo) {
    motivo = String(error.message || 'error desconocido');
  }

  const nombreProveedor = proveedor || 'desconocido';
  const sufijoEstado = estado ? ` (HTTP ${estado})` : '';

  return `El clasificador de IA (${nombreProveedor}) no respondió: ${motivo}${sufijoEstado}`;
}

module.exports = {
  describeLlmFailure,
};
