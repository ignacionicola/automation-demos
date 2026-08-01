const test = require('node:test');
const assert = require('node:assert');

const {
  buildLlmRequest,
  extractLlmText,
  esquemaClasificacionGemini,
  MODELOS_POR_DEFECTO,
  PROVEEDOR_POR_DEFECTO,
} = require('../src/llmProviders');

const PROMPT_BASE = {
  promptSistema: 'Sos un clasificador de mensajes.',
  mensajeUsuario: 'Fecha de hoy: 2026-08-03\n\nMensaje del cliente:\nHola',
};

test('gemini es el proveedor por defecto', () => {
  assert.strictEqual(PROVEEDOR_POR_DEFECTO, 'gemini');
});

test('buildLlmRequest arma la URL de Gemini con el modelo embebido', () => {
  const { url, headers, body } = buildLlmRequest({ proveedor: 'gemini', ...PROMPT_BASE });

  assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-flash-latest:generateContent$/);
  assert.deepStrictEqual(headers, {});
  assert.strictEqual(body.system_instruction.parts[0].text, PROMPT_BASE.promptSistema);
  assert.strictEqual(body.contents[0].role, 'user');
  assert.strictEqual(body.contents[0].parts[0].text, PROMPT_BASE.mensajeUsuario);
  assert.strictEqual(body.generationConfig.temperature, 0);
});

test('buildLlmRequest baja el thinking de Gemini al mínimo y sube el presupuesto de tokens', () => {
  // Los tokens de razonamiento se descuentan de maxOutputTokens: sin bajar el
  // thinking, el modelo gastaba ~700 pensando y devolvía el JSON cortado a
  // mitad (pasó de verdad con maxOutputTokens: 400 al armar esta demo).
  //
  // Tiene que ser thinkingLevel y NO thinkingBudget: los Gemini 3+ (a los que
  // apunta gemini-flash-latest) rechazan thinkingBudget con 400
  // INVALID_ARGUMENT — verificado contra la API real.
  const { body } = buildLlmRequest({ proveedor: 'gemini', ...PROMPT_BASE });

  assert.deepStrictEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  assert.strictEqual(body.generationConfig.maxOutputTokens, 1500);
  assert.ok(
    !('thinkingBudget' in body.generationConfig.thinkingConfig),
    'thinkingBudget rompe en Gemini 3+',
  );
});

test('el nivel de thinking de Gemini se puede sobreescribir', () => {
  const { body } = buildLlmRequest({ proveedor: 'gemini', nivelThinking: 'medium', ...PROMPT_BASE });

  assert.deepStrictEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'medium' });
});

test('nivelThinking "off" omite thinkingConfig entero (para modelos Gemini 2.5)', () => {
  // La familia 2.5 no entiende thinkingLevel, así que hay que poder no
  // mandar el campo en absoluto.
  const { body } = buildLlmRequest({ proveedor: 'gemini', nivelThinking: 'off', ...PROMPT_BASE });

  assert.ok(!('thinkingConfig' in body.generationConfig));
  assert.strictEqual(body.generationConfig.maxOutputTokens, 1500);
});

test('un nivelThinking vacío cae en el default', () => {
  for (const vacio of ['', null, undefined]) {
    const { body } = buildLlmRequest({ proveedor: 'gemini', nivelThinking: vacio, ...PROMPT_BASE });
    assert.deepStrictEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  }
});

test('el thinking level solo aplica a Gemini, no a los otros proveedores', () => {
  const groq = buildLlmRequest({ proveedor: 'groq', nivelThinking: 'high', ...PROMPT_BASE });
  const anthropic = buildLlmRequest({ proveedor: 'anthropic', nivelThinking: 'high', ...PROMPT_BASE });

  assert.ok(!('thinkingConfig' in groq.body));
  assert.ok(!('thinkingConfig' in anthropic.body));
});

test('buildLlmRequest pide JSON estructurado garantizado por schema para Gemini', () => {
  const { body } = buildLlmRequest({ proveedor: 'gemini', ...PROMPT_BASE });

  assert.strictEqual(body.generationConfig.responseMimeType, 'application/json');
  assert.deepStrictEqual(body.generationConfig.responseSchema, esquemaClasificacionGemini());
});

test('el schema de clasificación de Gemini usa tipos en mayúscula (protobuf Type, no JSON Schema)', () => {
  const schema = esquemaClasificacionGemini();

  assert.strictEqual(schema.type, 'OBJECT');
  assert.strictEqual(schema.properties.intent.type, 'STRING');
  assert.deepStrictEqual(schema.properties.intent.enum, [
    'consulta_propiedad',
    'agendar_visita',
    'consulta_general',
    'derivar_humano',
  ]);
  assert.strictEqual(schema.properties.confianza.type, 'NUMBER');
  assert.strictEqual(schema.properties.entidades.properties.dormitorios.nullable, true);
  assert.deepStrictEqual(schema.required, ['intent', 'confianza', 'entidades']);
});

test('buildLlmRequest arma el body de Anthropic con el header de versión', () => {
  const { url, headers, body } = buildLlmRequest({ proveedor: 'anthropic', ...PROMPT_BASE });

  assert.strictEqual(url, 'https://api.anthropic.com/v1/messages');
  assert.deepStrictEqual(headers, { 'anthropic-version': '2023-06-01' });
  assert.strictEqual(body.model, MODELOS_POR_DEFECTO.anthropic);
  assert.strictEqual(body.system, PROMPT_BASE.promptSistema);
  assert.strictEqual(body.messages[0].content, PROMPT_BASE.mensajeUsuario);
});

test('buildLlmRequest arma el body OpenAI-compatible de Groq', () => {
  const { url, headers, body } = buildLlmRequest({ proveedor: 'groq', ...PROMPT_BASE });

  assert.strictEqual(url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.deepStrictEqual(headers, {});
  assert.strictEqual(body.messages[0].role, 'system');
  assert.strictEqual(body.messages[0].content, PROMPT_BASE.promptSistema);
  assert.strictEqual(body.messages[1].role, 'user');
  assert.strictEqual(body.messages[1].content, PROMPT_BASE.mensajeUsuario);
});

test('usa gemini por defecto cuando no se especifica proveedor', () => {
  const { url } = buildLlmRequest({ ...PROMPT_BASE });
  assert.match(url, /generativelanguage\.googleapis\.com/);
});

// "Build LLM Request" (el Code node que llama a esta función) recibe modelo/
// apiUrl vacíos cada vez que $env no está disponible en la instancia de n8n
// (N8N_BLOCK_ENV_ACCESS_IN_NODE=true) o la variable simplemente no está
// seteada. Estos casos confirman que un string vacío, null o undefined en
// cualquiera de los dos campos cae siempre en el default del proveedor, en
// vez de armar una URL o un modelo rotos.
test('un modelo vacío (string, null o undefined) cae en el default del proveedor', () => {
  for (const modeloVacio of ['', null, undefined]) {
    const { body } = buildLlmRequest({ proveedor: 'groq', modelo: modeloVacio, ...PROMPT_BASE });
    assert.strictEqual(body.model, MODELOS_POR_DEFECTO.groq);
  }
});

test('un apiUrl vacío (string, null o undefined) cae en el endpoint por defecto del proveedor', () => {
  for (const apiUrlVacio of ['', null, undefined]) {
    const { url } = buildLlmRequest({ proveedor: 'gemini', apiUrl: apiUrlVacio, ...PROMPT_BASE });
    assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\//);
  }
});

test('un proveedor vacío (string, null o undefined) cae en gemini', () => {
  for (const proveedorVacio of ['', null, undefined]) {
    const { url } = buildLlmRequest({ proveedor: proveedorVacio, ...PROMPT_BASE });
    assert.match(url, /generativelanguage\.googleapis\.com/);
  }
});

test('el nombre del proveedor no distingue mayúsculas', () => {
  const a = buildLlmRequest({ proveedor: 'ANTHROPIC', ...PROMPT_BASE });
  const b = buildLlmRequest({ proveedor: 'anthropic', ...PROMPT_BASE });
  assert.strictEqual(a.url, b.url);
});

test('respeta el modelo explícito en vez del default', () => {
  const { body } = buildLlmRequest({ proveedor: 'groq', modelo: 'mixtral-8x7b', ...PROMPT_BASE });
  assert.strictEqual(body.model, 'mixtral-8x7b');
});

test('respeta LLM_API_URL como override completo, incluso para gemini', () => {
  const url = 'https://mi-proxy-interno.local/v1/chat';
  const { url: resultado } = buildLlmRequest({ proveedor: 'gemini', apiUrl: url, ...PROMPT_BASE });
  assert.strictEqual(resultado, url);
});

test('tira un error legible ante un proveedor desconocido', () => {
  assert.throws(
    () => buildLlmRequest({ proveedor: 'chatgpt', ...PROMPT_BASE }),
    /Proveedor de LLM desconocido: "chatgpt"/,
  );
});

test('extractLlmText lee el texto de una respuesta de Gemini', () => {
  const respuesta = {
    candidates: [{ content: { parts: [{ text: '{"intent":"consulta_general"}' }] } }],
  };
  assert.strictEqual(extractLlmText('gemini', respuesta), '{"intent":"consulta_general"}');
});

test('extractLlmText lee el texto de una respuesta de Anthropic', () => {
  const respuesta = { content: [{ type: 'text', text: '{"intent":"agendar_visita"}' }] };
  assert.strictEqual(extractLlmText('anthropic', respuesta), '{"intent":"agendar_visita"}');
});

test('extractLlmText lee el texto de una respuesta de Groq', () => {
  const respuesta = { choices: [{ message: { role: 'assistant', content: '{"intent":"derivar_humano"}' } }] };
  assert.strictEqual(extractLlmText('groq', respuesta), '{"intent":"derivar_humano"}');
});

test('extractLlmText devuelve null ante un bloqueo de seguridad de Gemini (sin candidates)', () => {
  const respuesta = { promptFeedback: { blockReason: 'SAFETY' } };
  assert.strictEqual(extractLlmText('gemini', respuesta), null);
});

test('extractLlmText devuelve null ante respuestas vacías o con forma inesperada', () => {
  assert.strictEqual(extractLlmText('gemini', {}), null);
  assert.strictEqual(extractLlmText('anthropic', {}), null);
  assert.strictEqual(extractLlmText('groq', {}), null);
  assert.strictEqual(extractLlmText('gemini', null), null);
  assert.strictEqual(extractLlmText('anthropic', { content: [] }), null);
  assert.strictEqual(extractLlmText('groq', { choices: [] }), null);
});

test('extractLlmText no rompe con un proveedor desconocido', () => {
  assert.doesNotThrow(() => extractLlmText('mistral', { anything: true }));
});
