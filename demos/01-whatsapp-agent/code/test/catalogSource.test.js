const test = require('node:test');
const assert = require('node:assert');

const {
  CACHE_MS,
  ORIGEN_PLANILLA,
  ORIGEN_RESPALDO,
  estaVigenteElCache,
  construirConfig,
  configDeRespaldo,
  describirOrigen,
} = require('../src/catalogSource');

const RESPALDO = {
  propiedades: [{ id: 'INM-001', barrio: 'Nueva Córdoba' }],
  faq: [{ id: 'faq-horarios', claves: ['horario'], respuesta: 'De {{horarios}}.' }],
};

const LEIDO = {
  propiedades: [{ id: 'INM-101', barrio: 'Las Flores', precio: '$ 420.000' }],
  negocio: [{ clave: 'nombre', valor: 'Nicola' }],
  faq: [{ id: 'faq-comision', claves: 'comision', respuesta: 'Un mes.' }],
};

test('con planilla, manda la planilla', () => {
  const config = construirConfig(LEIDO, RESPALDO);

  assert.strictEqual(config.propiedades[0].id, 'INM-101');
  assert.strictEqual(config.propiedades[0].precio, 420000);
  assert.strictEqual(config.negocio.nombre, 'Nicola');
  assert.strictEqual(config.faq[0].id, 'faq-comision');
  assert.strictEqual(config.origen.propiedades, ORIGEN_PLANILLA);
});

test('si Sheets no contesta, se usa el catálogo del repo', () => {
  // Contestar "no tengo propiedades" le mentiría al cliente sobre el catálogo
  // de la inmobiliaria por un problema de infraestructura. Uno viejo es mejor
  // que ninguno.
  const config = construirConfig(null, RESPALDO);

  assert.strictEqual(config.propiedades[0].id, 'INM-001');
  assert.strictEqual(config.faq[0].id, 'faq-horarios');
  assert.strictEqual(config.origen.propiedades, ORIGEN_RESPALDO);
});

test('una pestaña vacía también cae al respaldo', () => {
  // Sheets puede contestar bien y devolver cero filas: el cliente todavía no
  // cargó nada, o borró la pestaña sin querer. Para quien pregunta qué hay en
  // alquiler, el resultado es el mismo que si la API estuviera caída.
  const config = construirConfig({ propiedades: [], negocio: [], faq: [] }, RESPALDO);

  assert.strictEqual(config.propiedades[0].id, 'INM-001');
  assert.strictEqual(config.origen.propiedades, ORIGEN_RESPALDO);
});

test('el negocio nunca queda vacío: se completa campo por campo', () => {
  // A diferencia del catálogo, acá no hay respaldo que valga — parsearNegocio
  // ya rellena lo que falte, así que una planilla a medio llenar sigue
  // aportando lo que sí tenga.
  const config = construirConfig({ propiedades: [], negocio: [{ clave: 'nombre', valor: 'Nicola' }] }, RESPALDO);

  assert.strictEqual(config.negocio.nombre, 'Nicola');
  assert.strictEqual(config.negocio.horaApertura, 9, 'lo que falta usa el default');
});

test('las filas sin código se cuentan para poder avisarlo', () => {
  const config = construirConfig({ ...LEIDO, propiedades: [...LEIDO.propiedades, {}, { titulo: 'nota' }] }, RESPALDO);

  assert.strictEqual(config.origen.filasDescartadas, 2);
  assert.match(describirOrigen(config), /2 filas sin código/);
});

test('el caché vale un rato y después se vence', () => {
  const ahora = 1_700_000_000_000;

  assert.strictEqual(estaVigenteElCache({ guardadoEn: ahora }, ahora), true);
  assert.strictEqual(estaVigenteElCache({ guardadoEn: ahora - CACHE_MS + 1000 }, ahora), true);
  assert.strictEqual(estaVigenteElCache({ guardadoEn: ahora - CACHE_MS - 1 }, ahora), false);
  assert.strictEqual(estaVigenteElCache(null, ahora), false);
  assert.strictEqual(estaVigenteElCache({}, ahora), false);
});

test('sin planilla configurada, la demo sigue andando con el repo', () => {
  const config = configDeRespaldo(RESPALDO);

  assert.strictEqual(config.propiedades.length, 1);
  assert.strictEqual(config.negocio.horaApertura, 9);
  assert.match(describirOrigen(config), /respaldo_local/);
});
