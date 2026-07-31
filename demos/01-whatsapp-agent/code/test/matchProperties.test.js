const test = require('node:test');
const assert = require('node:assert');

const { matchProperties, aPesos, USD_TO_ARS } = require('../src/matchProperties');
const { formatPropertyReply } = require('../src/formatPropertyReply');
const propiedades = require('../src/properties.json');

test('el catálogo de demo tiene 10 propiedades con los campos requeridos', () => {
  assert.strictEqual(propiedades.length, 10);
  for (const propiedad of propiedades) {
    for (const campo of ['id', 'titulo', 'operacion', 'tipo', 'barrio', 'dormitorios', 'precio', 'moneda']) {
      assert.ok(propiedad[campo] !== undefined, `${propiedad.id} no tiene ${campo}`);
    }
    assert.ok(['venta', 'alquiler'].includes(propiedad.operacion));
    assert.ok(['ARS', 'USD'].includes(propiedad.moneda));
  }
});

test('filtra por operación y tipo', () => {
  const { resultados, nivel } = matchProperties({ operacion: 'alquiler', tipo: 'departamento' }, propiedades);

  assert.strictEqual(nivel, 'exacto');
  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.strictEqual(propiedad.operacion, 'alquiler');
    assert.strictEqual(propiedad.tipo, 'departamento');
  }
});

test('el barrio matchea sin importar tildes ni mayúsculas', () => {
  const conTilde = matchProperties({ barrio: 'Nueva Córdoba', operacion: 'alquiler' }, propiedades);
  const sinTilde = matchProperties({ barrio: 'nueva cordoba', operacion: 'alquiler' }, propiedades);

  assert.strictEqual(sinTilde.nivel, 'exacto');
  assert.deepStrictEqual(
    sinTilde.resultados.map((p) => p.id),
    conTilde.resultados.map((p) => p.id),
  );
});

test('dormitorios funciona como mínimo, no como igualdad', () => {
  const { resultados } = matchProperties({ operacion: 'venta', dormitorios: 3 }, propiedades);

  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.ok(propiedad.dormitorios >= 3, `${propiedad.id} tiene ${propiedad.dormitorios} dormitorios`);
  }
});

test('respeta el presupuesto en pesos', () => {
  const tope = 400000;
  const { resultados } = matchProperties({ operacion: 'alquiler', presupuesto: tope, moneda: 'ARS' }, propiedades);

  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.ok(aPesos(propiedad.precio, propiedad.moneda) <= tope);
  }
});

test('compara presupuestos en USD contra propiedades en USD', () => {
  const { resultados } = matchProperties(
    { operacion: 'venta', presupuesto: 80000, moneda: 'USD' },
    propiedades,
  );

  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.ok(aPesos(propiedad.precio, propiedad.moneda) <= 80000 * USD_TO_ARS);
  }
});

test('devuelve como máximo 3 resultados', () => {
  const { resultados, total } = matchProperties({ operacion: 'alquiler' }, propiedades);

  assert.strictEqual(resultados.length, 3);
  assert.ok(total >= 3, 'total debe reflejar todas las coincidencias, no solo las devueltas');
});

test('prioriza el barrio pedido sobre el resto', () => {
  const { resultados } = matchProperties(
    { operacion: 'alquiler', tipo: 'departamento', barrio: 'General Paz' },
    propiedades,
  );

  assert.strictEqual(resultados[0].barrio, 'General Paz');
});

test('si el barrio no tiene stock, suelta el barrio y avisa', () => {
  const { resultados, nivel } = matchProperties(
    { operacion: 'venta', tipo: 'casa', barrio: 'Nueva Córdoba' },
    propiedades,
  );

  assert.strictEqual(nivel, 'sin_barrio');
  assert.ok(resultados.length > 0);
  for (const propiedad of resultados) {
    assert.strictEqual(propiedad.tipo, 'casa');
  }
});

test('si el presupuesto es muy bajo, lo amplía un 15% antes de rendirse', () => {
  // La casa más barata en venta son USD 78.000; con tope 70.000 solo entra al ampliar.
  const { nivel, resultados } = matchProperties(
    { operacion: 'venta', tipo: 'ph', presupuesto: 70000, moneda: 'USD' },
    propiedades,
  );

  assert.strictEqual(nivel, 'presupuesto_ampliado');
  assert.strictEqual(resultados[0].id, 'INM-009');
});

test('devuelve sin_resultados cuando de verdad no hay nada', () => {
  const { resultados, nivel, total } = matchProperties({ operacion: 'alquiler', tipo: 'castillo' }, propiedades);

  assert.strictEqual(nivel, 'sin_resultados');
  assert.strictEqual(resultados.length, 0);
  assert.strictEqual(total, 0);
});

test('es determinístico ante entradas iguales', () => {
  const criterios = { operacion: 'venta', dormitorios: 3 };
  const a = matchProperties(criterios, propiedades);
  const b = matchProperties(criterios, propiedades);

  assert.deepStrictEqual(a.resultados.map((p) => p.id), b.resultados.map((p) => p.id));
});

test('tolera criterios vacíos o inválidos sin romper', () => {
  assert.doesNotThrow(() => matchProperties(null, propiedades));
  assert.doesNotThrow(() => matchProperties({}, null));
  assert.strictEqual(matchProperties({}, null).nivel, 'sin_resultados');
});

test('formatPropertyReply arma un mensaje usable para WhatsApp', () => {
  const match = matchProperties({ operacion: 'alquiler', barrio: 'Nueva Córdoba' }, propiedades);
  const mensaje = formatPropertyReply(match, { agencia: 'Inmobiliaria Demo' });

  assert.match(mensaje, /Nueva Córdoba/);
  assert.match(mensaje, /Ref: INM-00/);
  assert.match(mensaje, /\*/, 'debe usar negrita de WhatsApp');
  assert.match(mensaje, /visita/i, 'debe cerrar invitando a coordinar');
  assert.ok(!mensaje.includes('\n\n\n'), 'no debe quedar con líneas en blanco de más');
});

test('formatPropertyReply avisa cuando no encontró nada', () => {
  const mensaje = formatPropertyReply({ resultados: [], nivel: 'sin_resultados', total: 0 }, {});

  assert.match(mensaje, /no encontré/i);
  assert.match(mensaje, /asesor/i, 'debe ofrecer la salida a un humano');
});

test('formatPropertyReply concuerda en singular con un solo resultado', () => {
  const match = matchProperties({ operacion: 'venta', tipo: 'departamento' }, propiedades);
  assert.strictEqual(match.resultados.length, 1, 'el caso de prueba necesita un único resultado');

  const mensaje = formatPropertyReply(match, {});

  assert.match(mensaje, /esta opción que encaja con/);
  assert.ok(!mensaje.includes('que encajan'), 'no debe usar el plural con un solo resultado');
  assert.match(mensaje, /¿Te interesa\?/);
});

test('formatPropertyReply aclara cuando relajó el barrio', () => {
  const match = matchProperties({ operacion: 'venta', tipo: 'casa', barrio: 'Nueva Córdoba' }, propiedades);
  const mensaje = formatPropertyReply(match, {});

  assert.match(mensaje, /barrio no tengo nada/i);
});
