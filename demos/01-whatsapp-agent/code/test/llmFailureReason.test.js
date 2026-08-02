const test = require('node:test');
const assert = require('node:assert');

const { describeLlmFailure } = require('../src/llmFailureReason');

// La forma real que deja el HTTP node de n8n en la rama de error, tomada de una
// ejecución con Gemini pasado de cuota.
const FALLO_429 = {
  error: {
    message: "Try spacing your requests out using the batching settings under 'Options'",
    name: 'AxiosError',
    code: 'ERR_BAD_REQUEST',
    status: 429,
  },
};

test('traduce el 429 sin filtrar el copy de n8n', () => {
  const motivo = describeLlmFailure(FALLO_429, 'gemini');

  assert.match(motivo, /límite de consultas/);
  assert.match(motivo, /HTTP 429/);
  assert.ok(!/batching settings/.test(motivo), 'no debe filtrar el mensaje interno de n8n');
  assert.ok(!/Options/.test(motivo));
});

test('nombra al proveedor configurado', () => {
  assert.match(describeLlmFailure(FALLO_429, 'groq'), /\(groq\)/);
  assert.match(describeLlmFailure(FALLO_429, 'anthropic'), /\(anthropic\)/);
});

test('cae en "desconocido" si no se sabe el proveedor', () => {
  assert.match(describeLlmFailure(FALLO_429, ''), /\(desconocido\)/);
});

test('distingue credenciales, modelo y error del proveedor', () => {
  assert.match(describeLlmFailure({ error: { status: 401 } }, 'gemini'), /credencial/);
  assert.match(describeLlmFailure({ error: { status: 403 } }, 'gemini'), /credencial/);
  assert.match(describeLlmFailure({ error: { status: 404 } }, 'gemini'), /modelo/);
  assert.match(describeLlmFailure({ error: { status: 500 } }, 'gemini'), /error interno/);
  assert.match(describeLlmFailure({ error: { status: 503 } }, 'gemini'), /error interno/);
});

test('usa un genérico para 4xx que no están mapeados', () => {
  assert.match(describeLlmFailure({ error: { status: 418 } }, 'gemini'), /rechazó la consulta/);
});

test('describe los fallos de red, que no traen estado', () => {
  assert.match(describeLlmFailure({ error: { code: 'ECONNABORTED' } }, 'gemini'), /tardó demasiado/);
  assert.match(describeLlmFailure({ error: { code: 'ENOTFOUND' } }, 'gemini'), /no se pudo conectar/);
  assert.ok(!/HTTP/.test(describeLlmFailure({ error: { code: 'ENOTFOUND' } }, 'gemini')));
});

test('conserva el mensaje crudo ante una forma de error imprevista', () => {
  const motivo = describeLlmFailure({ error: { message: 'algo muy raro pasó' } }, 'gemini');

  assert.match(motivo, /algo muy raro pasó/);
});

test('no rompe con entradas vacías', () => {
  assert.doesNotThrow(() => describeLlmFailure(null, 'gemini'));
  assert.doesNotThrow(() => describeLlmFailure({}, 'gemini'));
  assert.doesNotThrow(() => describeLlmFailure(undefined, undefined));
  assert.match(describeLlmFailure({}, 'gemini'), /error desconocido/);
});

test('acepta el error sin envolver', () => {
  assert.match(describeLlmFailure({ status: 429 }, 'gemini'), /límite de consultas/);
});
