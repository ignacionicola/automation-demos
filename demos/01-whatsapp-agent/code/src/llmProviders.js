/**
 * Config y parsing específicos de cada proveedor de LLM.
 *
 * Existe para que "Classify Intent (LLM)" funcione contra Gemini (tiene free
 * tier), Anthropic o Groq sin tocar el resto del flujo — alcanza con cambiar
 * las variables de entorno LLM_PROVIDER / LLM_MODEL / LLM_API_URL. Ver el
 * README de la demo para el detalle de cómo apuntar a cada uno.
 */

const PROVEEDOR_POR_DEFECTO = 'gemini';

const PROVEEDORES_SOPORTADOS = ['gemini', 'anthropic', 'groq'];

const MODELOS_POR_DEFECTO = {
  // Alias estable de Google, no una versión fechada: apunta siempre al
  // flash vigente, así que no se rompe cada vez que Google retira una
  // versión (p. ej. "gemini-2.5-flash" empezó a devolver 404 "no longer
  // available to new users" mientras se armaba esta demo).
  gemini: 'gemini-flash-latest',
  anthropic: 'claude-sonnet-5',
  groq: 'llama-3.3-70b-versatile',
};

function normalizarProveedor(proveedor) {
  return String(proveedor || PROVEEDOR_POR_DEFECTO).toLowerCase().trim();
}

function urlPorDefecto(proveedor, modelo) {
  if (proveedor === 'gemini') {
    return `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;
  }
  if (proveedor === 'anthropic') return 'https://api.anthropic.com/v1/messages';
  if (proveedor === 'groq') return 'https://api.groq.com/openai/v1/chat/completions';
  return null;
}

/**
 * Arma la request para el proveedor pedido. Devuelve url/headers/body como
 * datos planos: quien llama decide cómo pasárselos al HTTP Request node.
 *
 * @param {object} opciones { proveedor, modelo, apiUrl, promptSistema, mensajeUsuario }
 * @returns {{ url: string, headers: object, body: object }}
 */
function buildLlmRequest(opciones) {
  const datos = opciones || {};
  const proveedor = normalizarProveedor(datos.proveedor);
  const modelo = datos.modelo || MODELOS_POR_DEFECTO[proveedor] || MODELOS_POR_DEFECTO[PROVEEDOR_POR_DEFECTO];
  const promptSistema = datos.promptSistema || '';
  const mensajeUsuario = datos.mensajeUsuario || '';

  const url = datos.apiUrl || urlPorDefecto(proveedor, modelo);
  if (!url) {
    throw new Error(
      `Proveedor de LLM desconocido: "${datos.proveedor}". Usá uno de: ${PROVEEDORES_SOPORTADOS.join(', ')}; ` +
        'o configurá LLM_API_URL para apuntar a un endpoint compatible.',
    );
  }

  if (proveedor === 'gemini') {
    return {
      url,
      headers: {},
      body: {
        system_instruction: { parts: [{ text: promptSistema }] },
        contents: [{ role: 'user', parts: [{ text: mensajeUsuario }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 400 },
      },
    };
  }

  if (proveedor === 'groq') {
    return {
      url,
      headers: {},
      body: {
        model: modelo,
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: 'system', content: promptSistema },
          { role: 'user', content: mensajeUsuario },
        ],
      },
    };
  }

  // anthropic, y cualquier otro proveedor compatible con la Messages API
  return {
    url,
    headers: { 'anthropic-version': '2023-06-01' },
    body: {
      model: modelo,
      max_tokens: 400,
      temperature: 0,
      system: promptSistema,
      messages: [{ role: 'user', content: mensajeUsuario }],
    },
  };
}

/**
 * Saca el texto de la respuesta cruda de la API. Devuelve null (nunca tira
 * error) ante cualquier forma inesperada — por ejemplo, un bloqueo de
 * seguridad de Gemini que responde 200 sin "candidates". Quien llama trata
 * un null exactamente igual que una respuesta no parseable.
 *
 * @param {string} proveedor
 * @param {object} respuesta cuerpo ya parseado como JSON
 * @returns {string|null}
 */
function extractLlmText(proveedor, respuesta) {
  if (!respuesta || typeof respuesta !== 'object') return null;
  const p = normalizarProveedor(proveedor);

  if (p === 'gemini') {
    const candidato = Array.isArray(respuesta.candidates) ? respuesta.candidates[0] : null;
    const parte = candidato && candidato.content && Array.isArray(candidato.content.parts)
      ? candidato.content.parts[0]
      : null;
    return (parte && typeof parte.text === 'string' && parte.text) || null;
  }

  if (p === 'groq') {
    const eleccion = Array.isArray(respuesta.choices) ? respuesta.choices[0] : null;
    const contenido = eleccion && eleccion.message ? eleccion.message.content : null;
    return (typeof contenido === 'string' && contenido) || null;
  }

  // anthropic
  const bloque = Array.isArray(respuesta.content) ? respuesta.content[0] : null;
  return (bloque && typeof bloque.text === 'string' && bloque.text) || null;
}

module.exports = {
  PROVEEDOR_POR_DEFECTO,
  PROVEEDORES_SOPORTADOS,
  MODELOS_POR_DEFECTO,
  buildLlmRequest,
  extractLlmText,
};
