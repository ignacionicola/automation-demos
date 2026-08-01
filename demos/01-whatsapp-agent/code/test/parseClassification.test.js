const test = require('node:test');
const assert = require('node:assert');

const { parseClassification } = require('../src/parseClassification');

const respuestaGemini = (obj) => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
});
const respuestaAnthropic = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj) }] });
const respuestaGroq = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });

const CLASIFICACION_VALIDA = {
  intent: 'consulta_propiedad',
  confianza: 0.9,
  entidades: { barrio: 'Nueva Córdoba' },
};

test('acepta una clasificación válida desde Gemini', () => {
  const resultado = parseClassification({
    proveedor: 'gemini',
    respuestaCruda: respuestaGemini(CLASIFICACION_VALIDA),
    mensajeVacio: false,
  });

  assert.strictEqual(resultado.intent, 'consulta_propiedad');
  assert.strictEqual(resultado.confianza, 0.9);
  assert.deepStrictEqual(resultado.entidades, { barrio: 'Nueva Córdoba' });
  assert.strictEqual(resultado.motivoDerivacion, null);
});

test('acepta una clasificación válida desde Anthropic', () => {
  const resultado = parseClassification({
    proveedor: 'anthropic',
    respuestaCruda: respuestaAnthropic(CLASIFICACION_VALIDA),
    mensajeVacio: false,
  });

  assert.strictEqual(resultado.intent, 'consulta_propiedad');
});

test('acepta una clasificación válida desde Groq', () => {
  const resultado = parseClassification({
    proveedor: 'groq',
    respuestaCruda: respuestaGroq(CLASIFICACION_VALIDA),
    mensajeVacio: false,
  });

  assert.strictEqual(resultado.intent, 'consulta_propiedad');
});

test('tolera que el modelo envuelva el JSON en un bloque de markdown', () => {
  const conMarkdown = {
    candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(CLASIFICACION_VALIDA) + '\n```' }] } }],
  };
  const resultado = parseClassification({ proveedor: 'gemini', respuestaCruda: conMarkdown, mensajeVacio: false });

  assert.strictEqual(resultado.intent, 'consulta_propiedad');
});

test('deriva a un humano si el texto no es JSON parseable', () => {
  const invalida = { candidates: [{ content: { parts: [{ text: 'no puedo ayudarte con eso' }] } }] };
  const resultado = parseClassification({ proveedor: 'gemini', respuestaCruda: invalida, mensajeVacio: false });

  assert.strictEqual(resultado.intent, 'derivar_humano');
  assert.strictEqual(resultado.confianza, 0);
  assert.match(resultado.motivoDerivacion, /no se pudo interpretar/);
});

// Este es el caso real que motivó agregar textoCrudo: una respuesta cortada a
// mitad del JSON (Gemini se quedó sin presupuesto de tokens por el thinking).
test('cuando el JSON viene truncado, guarda el texto crudo para debug', () => {
  const cortada = {
    candidates: [{ content: { parts: [{ text: '{"intent":"consulta_propiedad","entidades":{"barrio":"Nueva' }] } }],
  };
  const resultado = parseClassification({ proveedor: 'gemini', respuestaCruda: cortada, mensajeVacio: false });

  assert.strictEqual(resultado.intent, 'derivar_humano');
  assert.strictEqual(resultado.textoCrudo, '{"intent":"consulta_propiedad","entidades":{"barrio":"Nueva');
});

test('textoCrudo queda en null cuando la clasificación es válida', () => {
  const resultado = parseClassification({
    proveedor: 'gemini',
    respuestaCruda: respuestaGemini(CLASIFICACION_VALIDA),
    mensajeVacio: false,
  });

  assert.strictEqual(resultado.textoCrudo, null);
});

test('trunca el texto crudo si es demasiado largo', () => {
  const textoGigante = 'x'.repeat(5000);
  const resultado = parseClassification({
    proveedor: 'gemini',
    respuestaCruda: { candidates: [{ content: { parts: [{ text: textoGigante }] } }] },
    mensajeVacio: false,
  });

  assert.ok(resultado.textoCrudo.length < textoGigante.length);
  assert.match(resultado.textoCrudo, /… \(truncado\)$/);
});

test('deriva a un humano ante un intent fuera del whitelist', () => {
  const resultado = parseClassification({
    proveedor: 'anthropic',
    respuestaCruda: respuestaAnthropic({ intent: 'comprar_pizza', confianza: 0.99, entidades: {} }),
    mensajeVacio: false,
  });

  assert.strictEqual(resultado.intent, 'derivar_humano');
  assert.match(resultado.motivoDerivacion, /intent desconocido/);
});

test('deriva a un humano si la confianza es menor a 0.6', () => {
  const resultado = parseClassification({
    proveedor: 'groq',
    respuestaCruda: respuestaGroq({ intent: 'consulta_propiedad', confianza: 0.4, entidades: {} }),
    mensajeVacio: false,
  });

  assert.strictEqual(resultado.intent, 'derivar_humano');
  assert.match(resultado.motivoDerivacion, /Confianza baja/);
});

test('deriva a un humano si el mensaje original venía vacío (audio/imagen)', () => {
  const resultado = parseClassification({
    proveedor: 'gemini',
    respuestaCruda: respuestaGemini(CLASIFICACION_VALIDA),
    mensajeVacio: true,
  });

  assert.strictEqual(resultado.intent, 'derivar_humano');
  assert.match(resultado.motivoDerivacion, /sin texto/);
});

test('deriva a un humano ante un bloqueo de seguridad de Gemini (sin candidates)', () => {
  const resultado = parseClassification({
    proveedor: 'gemini',
    respuestaCruda: { promptFeedback: { blockReason: 'SAFETY' } },
    mensajeVacio: false,
  });

  assert.strictEqual(resultado.intent, 'derivar_humano');
});

test('no rompe con una respuesta cruda vacía o inválida', () => {
  assert.doesNotThrow(() => parseClassification({ proveedor: 'gemini', respuestaCruda: null, mensajeVacio: false }));
  assert.doesNotThrow(() => parseClassification({}));
  assert.strictEqual(parseClassification({}).intent, 'derivar_humano');
});

test('es determinístico', () => {
  const opciones = { proveedor: 'gemini', respuestaCruda: respuestaGemini(CLASIFICACION_VALIDA), mensajeVacio: false };
  const a = parseClassification(opciones);
  const b = parseClassification(opciones);
  assert.deepStrictEqual(a, b);
});
