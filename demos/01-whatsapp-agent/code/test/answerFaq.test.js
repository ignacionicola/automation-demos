const test = require('node:test');
const assert = require('node:assert');

const FAQ_REAL = require('../src/faq.json');
const { esSoloSaludo } = require('../src/answerFaq');

test('un saludo se contesta saludando, no derivando a una persona', () => {
  // "hola" es el primer mensaje de casi cualquiera. Contestarle "esa no la
  // tengo respondida, te paso con un asesor" gasta una persona en decir hola.
  for (const saludo of ['hola buenas', 'Hola!', 'buen día', 'buenas tardes', 'que tal']) {
    const resultado = require('../src/answerFaq').answerFaq(saludo, FAQ_REAL, {});

    assert.strictEqual(resultado.derivar, false, `"${saludo}" no debería ir a un humano`);
    assert.strictEqual(resultado.id, 'faq-saludo');
    assert.match(resultado.respuesta, /buscar propiedades/i, 'y encamina la conversación');
  }
});

test('un saludo con una consulta adentro no es solo un saludo', () => {
  // "hola, tienen departamentos?" es una consulta que empieza saludando: si se
  // la trata como saludo, se pierde la pregunta.
  assert.strictEqual(esSoloSaludo('hola, buscan casas?'), false);
  assert.strictEqual(esSoloSaludo('buenas, que requisitos piden?'), false);
  assert.strictEqual(esSoloSaludo('hola buenas'), true);
  assert.strictEqual(esSoloSaludo('me robaron el depto'), false, 'esto sí tiene que ir a un humano');
});

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
