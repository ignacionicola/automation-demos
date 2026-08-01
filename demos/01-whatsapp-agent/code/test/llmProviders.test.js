const test = require('node:test');
const assert = require('node:assert');

const {
  buildLlmRequest,
  extractLlmText,
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

  assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.0-flash:generateContent$/);
  assert.deepStrictEqual(headers, {});
  assert.strictEqual(body.system_instruction.parts[0].text, PROMPT_BASE.promptSistema);
  assert.strictEqual(body.contents[0].role, 'user');
  assert.strictEqual(body.contents[0].parts[0].text, PROMPT_BASE.mensajeUsuario);
  assert.strictEqual(body.generationConfig.temperature, 0);
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
