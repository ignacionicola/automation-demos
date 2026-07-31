const test = require('node:test');
const assert = require('node:assert');

const { answerFaq, tokenizar } = require('../src/answerFaq');
const faq = require('../src/faq.json');

test('las entradas de FAQ tienen la forma esperada', () => {
  assert.ok(faq.length >= 5);
  for (const entrada of faq) {
    assert.ok(entrada.id && entrada.pregunta && entrada.respuesta);
    assert.ok(Array.isArray(entrada.claves) && entrada.claves.length > 0);
  }
});

test('tokenizar descarta palabras vacías y signos', () => {
  const tokens = tokenizar('¿Cuál es el horario de atención?');

  assert.ok(tokens.includes('horario'));
  assert.ok(tokens.includes('atencion'), 'debe normalizar las tildes');
  assert.ok(!tokens.includes('cual'), 'debe descartar las palabras vacías');
});

test('responde el horario de atención', () => {
  const resultado = answerFaq('hola, qué horario tienen?', faq, {});

  assert.strictEqual(resultado.encontrada, true);
  assert.strictEqual(resultado.id, 'faq-horarios');
  assert.match(resultado.respuesta, /9 a 19/);
});

test('responde los requisitos para alquilar', () => {
  const resultado = answerFaq('qué requisitos necesito para alquilar?', faq, {});

  assert.strictEqual(resultado.encontrada, true);
  assert.strictEqual(resultado.id, 'faq-requisitos-alquiler');
  assert.match(resultado.respuesta, /garant/i);
});

test('responde por la comisión', () => {
  const resultado = answerFaq('cuánto cobran de comisión?', faq, {});

  assert.strictEqual(resultado.encontrada, true);
  assert.strictEqual(resultado.id, 'faq-comision');
});

test('responde por tasaciones', () => {
  const resultado = answerFaq('hacen tasaciones de casas?', faq, {});

  assert.strictEqual(resultado.encontrada, true);
  assert.strictEqual(resultado.id, 'faq-tasacion');
});

test('deriva a un humano cuando no entiende la consulta', () => {
  const resultado = answerFaq('me gustan mucho los helados de pistacho', faq, { agencia: 'Inmobiliaria Demo' });

  assert.strictEqual(resultado.encontrada, false);
  assert.strictEqual(resultado.derivar, true);
  assert.match(resultado.respuesta, /Inmobiliaria Demo/);
  assert.match(resultado.respuesta, /asesor/i);
});

test('no rompe con entradas vacías o inválidas', () => {
  assert.doesNotThrow(() => answerFaq('', faq, {}));
  assert.doesNotThrow(() => answerFaq(null, faq, {}));
  assert.doesNotThrow(() => answerFaq('hola', null, {}));
  assert.strictEqual(answerFaq('hola', null, {}).derivar, true);
});

test('es determinístico', () => {
  const a = answerFaq('qué horario tienen', faq, {});
  const b = answerFaq('qué horario tienen', faq, {});

  assert.strictEqual(a.id, b.id);
  assert.strictEqual(a.puntaje, b.puntaje);
});
